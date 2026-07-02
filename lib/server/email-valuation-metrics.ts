/**
 * Extract fund-level metrics (托管户余额, 资产净值) and FOF underlying 市值
 * from parsed 估值表 portfolio rows.
 */

import type { ValuationAnalysis, ValuationRow, ValuationSummary } from "@/lib/server/valuation-analyzer"
import { pickRowCost, pickRowMarketValue } from "@/lib/server/valuation-analyzer"
import { isDirectEquityOrListedEtfHolding, resolveFundHoldingCode } from "@/lib/server/fund-holding-code"

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

  const rowKind = String(row.row_kind ?? "")
  if (NON_UNDERLYING_ROW_KINDS.has(rowKind)) return false
  if (UNDERLYING_ROW_KINDS.has(rowKind)) return true

  const code = String(row.code ?? "").replace(/\s+/g, "").replace(/\./g, "")
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

  return bestValue
}

function resolvePaidInCapital(rows: ValuationRow[], netAssetValue: number, unitNav: number): number {
  let bestValue = 0
  for (const row of rows) {
    const name = normalizeText(row.name)
    if (!/实收资本/.test(name)) continue
    const qty = parseAmount(row.quantity ?? row.position ?? row.volume)
    const cost = parseAmount(row.cost ?? row.signed_cost)
    const mv = pickRowMarketValue(row) || pickRowCost(row)
    const value = qty > 0 ? qty : cost > 0 ? cost : mv
    if (value > bestValue) bestValue = value
  }

  if (bestValue <= 0 && netAssetValue > 0 && unitNav > 0.05) {
    const inferred = netAssetValue / unitNav
    if (inferred > 1000) return inferred
  }

  return bestValue
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

function resolveNetAssetValue(summary: ValuationAnalysis["summary"], rows: ValuationRow[]): number {
  for (const row of rows) {
    const name = normalizeText(row.name)
    if (!/^(基金)?资产净值$/.test(name) && !/^净资产$/.test(name)) continue
    const amount = pickRowMarketValue(row) || pickRowCost(row)
    if (amount > 1000 && !isPlausibleUnitNav(amount)) return amount
  }

  if (summary.total_asset > 0 && summary.total_liability >= 0) {
    const derived = summary.total_asset - summary.total_liability
    if (derived > 1000) return derived
  }

  const fromRows = resolveTotalsFromRows(rows)
  if (fromRows.totalAsset > 0) {
    const derived = fromRows.totalAsset - fromRows.totalLiability
    if (derived > 1000) return derived
  }

  if (summary.nav > 1000 && !isPlausibleUnitNav(summary.nav)) {
    return summary.nav
  }

  return 0
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
