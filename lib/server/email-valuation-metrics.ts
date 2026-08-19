/**
 * Extract fund-level metrics (托管户余额, 资产净值) and FOF underlying 市值
 * from parsed 估值表 portfolio rows.
 */

import type { ValuationAnalysis, ValuationRow, ValuationSummary } from "@/lib/server/valuation-analyzer"
import { pickRowCost, pickRowMarketValue } from "@/lib/server/valuation-analyzer"
import { isDirectEquityOrListedEtfHolding, isValuationIncrementSubjectCode, resolveFundHoldingCode } from "@/lib/server/fund-holding-code"

export type EnrichedValuationSummary = ValuationSummary & {
  unit_nav: number
  net_asset_value: number
  custody_balance: number
  paid_in_capital: number
}

export type FofUnderlyingMetric = {
  underlyingProductCode: string | null
  underlyingName: string
  subjectCode: string
  rowKind: string | null
  marketValue: number | null
  quantity: number | null
  cost: number | null
  marketWeight: number | null
}

const UNDERLYING_ROW_KINDS = new Set([
  "private_fund",
  "fund_or_stock",
  "fund",
  "money_fund",
])

const NON_UNDERLYING_ROW_KINDS = new Set([
  "bank_deposit",
  "receivable",
  "payable",
  "settlement_reserve",
  "margin_deposit",
  "clearing",
  "derivative",
  "stock",
  "bond",
  "repo",
  "paid_in_capital",
])

/** Whether a 估值表 row represents a FOF underlying fund holding. */
export function isFofUnderlyingHolding(row: {
  row_kind?: string | null
  code?: string | null
  name?: string | null
  symbol?: string | null
}): boolean {
  if (isDirectEquityOrListedEtfHolding({
    subjectCode: row.code,
    subjectName: row.name,
    symbol: row.symbol,
    rowKind: row.row_kind,
  })) {
    return false
  }

  const code = String(row.code ?? "").replace(/\s+/g, "").replace(/\./g, "")
  if (code.startsWith("3003")) return false
  if (isValuationIncrementSubjectCode(code)) return false

  const rowKind = String(row.row_kind ?? "")
  if (NON_UNDERLYING_ROW_KINDS.has(rowKind)) return false
  if (UNDERLYING_ROW_KINDS.has(rowKind)) return true

  const name = String(row.name ?? "")
  if (code.startsWith("1109") || code.startsWith("1108")) return true
  if (/私募证券投资基金|私募基金/.test(name)) return true
  if (rowKind === "other" && String(row.symbol ?? "").trim()) return true
  return false
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/[\s\u3000:：]/g, "")
}

function normalizeCode(code: string): string {
  return code.replace(/\s+/g, "").replace(/\./g, "")
}

function parseAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const text = String(value ?? "").replace(/,/g, "").trim()
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}

function isPlausibleUnitNav(n: number): boolean {
  return n > 0.05 && n < 500
}

function pickUnitNavFromRow(row: ValuationRow): number | null {
  const keys = ["price", "current_price", "market_value", "unit_cost", "cost"]
  for (const k of keys) {
    const n = parseAmount(row[k])
    if (isPlausibleUnitNav(n)) return n
  }
  return null
}

function isDemandDepositRow(code: string, name: string): boolean {
  const normalizedName = normalizeText(name)
  if (/应计利息/.test(normalizedName)) return false

  if (
    normalizedName === "活期存款"
    || normalizedName === "银行存款_活期"
    || normalizedName === "银行存款活期"
    || normalizedName === "活期银行存款"
  ) {
    return true
  }

  const compact = normalizeCode(code)
  // Level-3 subject 1002.01 only — not deeper bank sub-accounts (1002.01.01 / 10020111).
  if (compact === "100201") {
    return normalizedName === "活期存款"
      || /银行存款/.test(normalizedName) && /活期/.test(normalizedName)
  }

  const segments = String(code).replace(/\s+/g, "").split(".").filter(Boolean)
  return segments.length === 2
    && segments[0] === "1002"
    && segments[1] === "01"
    && /活期/.test(normalizedName)
    && !/应计/.test(normalizedName)
}

/** Prefer the canonical 活期存款 row over bank sub-account detail rows. */
function demandDepositRowPriority(code: string, name: string): number {
  const normalizedName = normalizeText(name)
  if (
    normalizedName === "活期存款"
    || normalizedName === "银行存款_活期"
    || normalizedName === "银行存款活期"
  ) {
    return 100
  }
  if (normalizeCode(code) === "100201") return 90
  const segments = String(code).replace(/\s+/g, "").split(".").filter(Boolean)
  if (segments.length === 2 && segments[0] === "1002" && segments[1] === "01") return 90
  return 50
}

function isCustodyBalanceRow(code: string, name: string): boolean {
  const normalizedName = normalizeText(name)
  if (/应计利息/.test(normalizedName)) return false
  if (isDemandDepositRow(code, name)) return true
  if (/托管户|托管账户|托管银行存款|托管户余额|托管账户余额/.test(normalizedName)) return true
  if (normalizeCode(code).startsWith("1002") && /托管/.test(normalizedName)) return true
  if (code.startsWith("1021") && /托管/.test(normalizedName)) return true
  return false
}

function custodyRowPriority(code: string, name: string): number {
  const normalizedName = normalizeText(name)
  if (isDemandDepositRow(code, name)) return demandDepositRowPriority(code, name)
  if (/托管户|托管账户|托管银行存款|托管户余额|托管账户余额/.test(normalizedName)) return 80
  if (code.startsWith("1021") && /托管/.test(normalizedName)) return 40
  return 0
}

/** Parent 1002 银行存款 only — not 1002.01 活期 / 定期 sub-accounts. */
function isParentBankDepositRow(code: string, name: string): boolean {
  if (normalizeText(name) !== "银行存款") return false
  return normalizeCode(code) === "1002"
}

function resolveCustodyBalance(rows: ValuationRow[]): number {
  // Policy: 托管账户余额 always comes from 活期存款 市值 when present.
  const demandRows = rows.filter((row) =>
    isDemandDepositRow(String(row.original_code ?? row.code ?? ""), String(row.name ?? "")),
  )

  if (demandRows.length > 0) {
    let bestPriority = -1
    let bestValue = 0
    for (const row of demandRows) {
      const code = String(row.original_code ?? row.code ?? "")
      const name = String(row.name ?? "")
      const priority = demandDepositRowPriority(code, name)
      const amount = pickRowMarketValue(row) || pickRowCost(row)
      if (amount <= 0) continue
      if (priority > bestPriority || (priority === bestPriority && amount > bestValue)) {
        bestPriority = priority
        bestValue = amount
      }
    }
    if (bestValue > 0) return bestValue
  }

  // Fallback for formats without an explicit 活期存款 row.
  let bestPriority = -1
  let bestValue = 0
  for (const row of rows) {
    const code = String(row.original_code ?? row.code ?? "")
    const name = String(row.name ?? "")
    if (!isCustodyBalanceRow(code, name)) continue
    if (normalizeText(name) === "银行存款") continue

    const priority = custodyRowPriority(code, name)
    const amount = pickRowMarketValue(row) || pickRowCost(row)
    if (amount <= 0) continue

    if (priority > bestPriority || (priority === bestPriority && amount > bestValue)) {
      bestPriority = priority
      bestValue = amount
    }
  }
  if (bestValue > 0) return bestValue

  // CMS omits 0 活期 sub-accounts; leftover cash stays on parent 1002 银行存款.
  let parentBank = 0
  for (const row of rows) {
    const code = String(row.original_code ?? row.code ?? "")
    const name = String(row.name ?? "")
    if (!isParentBankDepositRow(code, name)) continue
    const amount = pickRowMarketValue(row) || pickRowCost(row)
    if (amount > parentBank) parentBank = amount
  }
  return parentBank
}

function resolvePaidInCapital(rows: ValuationRow[], netAssetValue: number, unitNav: number): number {
  const implied =
    netAssetValue > 1000 && unitNav > 0.05 ? netAssetValue / unitNav : 0
  const underlyingQty = new Set<number>()
  for (const row of rows) {
    if (!isFofUnderlyingHolding(row)) continue
    const qty = parseAmount(row.quantity ?? row.position ?? row.volume)
    if (qty > 1000) underlyingQty.add(qty)
  }
  const matchesUnderlying = (value: number) =>
    [...underlyingQty].some((qty) => Math.abs(qty - value) / value < 0.01)

  const candidates: number[] = []
  for (const row of rows) {
    const name = normalizeText(row.name)
    const code = String(row.original_code ?? row.code ?? "").replace(/[\s.]/g, "")
    // Exact 实收资本 / 4001 only. Nested holding names and max() across rows
    // picked 锡和鑫安's ~207M shares as 金舆锡泰一号 实收资本.
    if (!/^实收资本$/.test(name) && !/^4001/.test(code)) continue
    const qty = parseAmount(row.quantity ?? row.position ?? row.volume)
    const cost = parseAmount(row.cost ?? row.signed_cost)
    const mv = pickRowMarketValue(row) || pickRowCost(row)
    const value = qty > 0 ? qty : cost > 0 ? cost : mv
    if (value > 1000 && !matchesUnderlying(value)) candidates.push(value)
  }

  if (implied > 1000) {
    const close = candidates.filter((value) => value <= implied * 2.5 && implied <= value * 2.5)
    if (close.length > 0) {
      return close.reduce((best, value) =>
        Math.abs(value - implied) < Math.abs(best - implied) ? value : best)
    }
    return implied
  }

  return candidates.length > 0 ? Math.min(...candidates) : 0
}

function resolveTotalsFromRows(rows: ValuationRow[]): { totalAsset: number; totalLiability: number } {
  let totalAsset = 0
  let totalLiability = 0
  for (const row of rows) {
    const name = normalizeText(row.name)
    const amount = pickRowMarketValue(row) || pickRowCost(row)
    if (/^(资产类合计|资产合计|资产总值|资产类总计)$/.test(name) && amount > 0) {
      totalAsset = amount
    }
    if (/^(负债类合计|负债合计|负债总值|负债类总计)$/.test(name) && amount > 0) {
      totalLiability = Math.abs(amount)
    }
  }
  return { totalAsset, totalLiability }
}

/**
 * When 估值表 footer rows (资产净值 / 资产类合计) were not kept in portfolio_data —
 * common for 华泰 merged-header .xls — derive NAV from leaf asset − liability amounts.
 */
function deriveNetAssetValueFromHoldings(rows: ValuationRow[]): number {
  const LIABILITY_KINDS = new Set(["payable"])
  const SKIP_KINDS = new Set(["paid_in_capital"])
  const assetAmounts: number[] = []
  let liabilities = 0

  for (const row of rows) {
    const kind = String(row.row_kind ?? "other")
    if (SKIP_KINDS.has(kind)) continue
    if (row.is_leaf === false) continue
    const amount = pickRowMarketValue(row) || pickRowCost(row)
    if (amount <= 0) continue
    if (LIABILITY_KINDS.has(kind) || /^22/.test(String(row.code ?? "").replace(/[\s.]/g, ""))) {
      liabilities += amount
      continue
    }
    assetAmounts.push(amount)
  }

  if (assetAmounts.length === 0) return 0
  let assets = assetAmounts.reduce((sum, n) => sum + n, 0)
  // One leaf 市值 at the underlying fund's full AUM (锡和鑫安 ~207M) must not
  // be treated as this FOF's assets.
  if (assetAmounts.length >= 2) {
    const max = Math.max(...assetAmounts)
    const rest = assets - max
    if (rest > 1000 && max > rest * 2.5) assets = rest
  }

  const derived = assets - liabilities
  return derived > 1000 ? derived : 0
}

function resolveNetAssetValue(summary: ValuationAnalysis["summary"], rows: ValuationRow[]): number {
  let footer = 0
  for (const row of rows) {
    const name = normalizeText(row.name)
    if (!/^(基金)?资产净值$/.test(name) && !/^净资产$/.test(name)) continue
    const amount = pickRowMarketValue(row) || pickRowCost(row)
    if (amount > 1000 && !isPlausibleUnitNav(amount)) footer = amount
  }

  let fromTotals = 0
  if (summary.total_asset > 0 && summary.total_liability >= 0) {
    const derived = summary.total_asset - summary.total_liability
    if (derived > 1000) fromTotals = derived
  }
  if (fromTotals <= 0) {
    const rowTotals = resolveTotalsFromRows(rows)
    if (rowTotals.totalAsset > 0) {
      const derived = rowTotals.totalAsset - rowTotals.totalLiability
      if (derived > 1000) fromTotals = derived
    }
  }

  const fromSummary =
    summary.nav > 1000 && !isPlausibleUnitNav(summary.nav) ? summary.nav : 0
  const fromHoldings = deriveNetAssetValueFromHoldings(rows)

  const consistentWithHoldings = (nav: number) =>
    nav > 1000 && (fromHoldings < 1000 || nav <= fromHoldings * 2.5)

  // Footer 资产净值 can be the underlying's AUM. Prefer 资产合计−负债合计 when
  // that matches this fund's own holdings; otherwise holdings.
  if (consistentWithHoldings(footer)) return footer
  if (consistentWithHoldings(fromTotals)) return fromTotals
  if (consistentWithHoldings(fromSummary)) return fromSummary
  if (fromHoldings > 1000) return fromHoldings
  return footer || fromTotals || fromSummary || 0
}

/** Extract product code like TA891A (uppercase, with share class) from underlying fund holding. */
export function extractUnderlyingProductCode(row: ValuationRow): string | null {
  const name = String(row.name ?? "")
  const code = String(row.original_code ?? row.code ?? "")
  const existing = row.symbol != null ? String(row.symbol) : null
  return resolveFundHoldingCode(code, name, existing)
}

export function enrichValuationMetrics(analysis: ValuationAnalysis): {
  summary: EnrichedValuationSummary
  underlyingHoldings: FofUnderlyingMetric[]
} {
  const rows = analysis.portfolio_data
  let unitNav = 0

  for (const row of rows) {
    const name = normalizeText(row.name)
    // Skip 昨日/上日单位净值 — CMS sheets put prior-day NAV in the body; using it
    // shifts the published 单位净值 back one trading day.
    if (/昨日|上日|前一|上一|前天/.test(name)) continue
    if (/^单位净值$/.test(name) || (/单位净值/.test(name) && !/累计/.test(name))) {
      const n = pickUnitNavFromRow(row)
      if (n != null) unitNav = n
    }
  }

  const netAssetValue = resolveNetAssetValue(analysis.summary, rows)
  const custodyBalance = resolveCustodyBalance(rows)
  const paidInCapital = resolvePaidInCapital(rows, netAssetValue, unitNav)

  if (!unitNav && isPlausibleUnitNav(analysis.summary.nav)) {
    unitNav = analysis.summary.nav
  }

  const summary: EnrichedValuationSummary = {
    ...analysis.summary,
    unit_nav: unitNav,
    net_asset_value: netAssetValue,
    custody_balance: custodyBalance,
    paid_in_capital: paidInCapital,
    nav: netAssetValue || analysis.summary.nav,
  }

  const underlyingHoldings: FofUnderlyingMetric[] = rows
    .filter((row) => row.include_in_detail && isFofUnderlyingHolding(row))
    .map((row) => ({
      underlyingProductCode: extractUnderlyingProductCode(row),
      underlyingName: String(row.name ?? ""),
      subjectCode: String(row.code ?? ""),
      rowKind: row.row_kind != null ? String(row.row_kind) : null,
      marketValue: parseAmount(row.market_value ?? row.signed_market_value) || null,
      quantity: parseAmount(row.quantity ?? row.position ?? row.volume) || null,
      cost: parseAmount(row.cost ?? row.signed_cost) || null,
      marketWeight: parseAmount(row.market_weight) || null,
    }))
    .filter((row) => (row.marketValue ?? 0) > 0 || (row.cost ?? 0) > 0)

  return { summary, underlyingHoldings }
}
