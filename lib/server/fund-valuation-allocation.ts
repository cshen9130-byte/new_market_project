/**
 * Per-fund 资产配置 from latest email 估值表 holdings.
 */

import { query } from "@/lib/db"
import { buildGreekLetters, buildTermAnalysis, type GreekLetterRow, type TermAnalysisRow } from "@/lib/server/derivative-greeks-term"
import {
  extractOptionContractFromText,
  normalizeOptionContractCode,
} from "@/lib/server/option-contract-code"
import { loadOptionMarketGreeks } from "@/lib/server/option-greeks-market"
import { inferDerivativeSector, DERIVATIVE_SECTOR_CHART_ORDER, type DerivativeSector } from "@/lib/server/derivative-sector"
import {
  listFundLatestValuationHoldings,
  mapValuationRowsToHoldings,
  type FundLatestHoldingRow,
  type ValuationHoldingInsert,
} from "@/lib/server/email-valuation-holdings-pg"
import { ensureEmailValuationTable, listEmailValuationRecords, lookupLatestValuationCustodian, lookupValuationCustodianByRecordId, type EmailValuationRecordRow } from "@/lib/server/email-valuation-pg"
import type { ValuationRow } from "@/lib/server/valuation-analyzer"
import { listFundMetricsLatest } from "@/lib/server/email-valuation-metrics-pg"
import { resolveValuationCustodian, normalizeRegistrationCustodian } from "@/lib/server/email-valuation-custodian"
import { resolveRouteFundId, lookupFundInfoFallback, resolveFundBeianHao } from "@/lib/server/fof-underlying-query"
import { loadFundLatestUnitNav, loadFundNavSeries, resolveFundNames } from "@/lib/server/fund-nav-series"
import { sqlFundNameMatch } from "@/lib/server/fund-name-match"
import { lookupManagedProductOverride, lookupManagedProductCustodian, remapManagedProductBeianCode } from "@/lib/server/managed-product-beian"

export type AllocationMode = "major" | "all"

export type AllocationRow = {
  index: number
  category: string
  rowKind: string
  value: number
  pct: number
}

export type DerivativeRow = {
  index: number
  contractName: string
  symbol: string | null
  sector: DerivativeSector
  direction: "long" | "short"
  directionLabel: "多头" | "空头"
  quantity: number
  price: number | null
  marketValue: number
  marketPct: number
  cost: number | null
  unrealizedPnl: number | null
}

export type DerivativeSectorShareRow = {
  sector: string
  longMarketValue: number
  longMarketPct: number
  shortMarketValue: number
  shortMarketPct: number
  netMarketValue: number
}

export type OptionRow = {
  index: number
  assetName: string
  directionLabel: "买方" | "卖方"
  valuationCode: string
  quantity: number
  price: number | null
  marketValue: number
  marketPct: number
  cost: number | null
  unrealizedPnl: number | null
}

export type ValuationLayoutType = "fof" | "derivative"

export type FundHoldingRow = {
  index: number
  fundName: string
  valuationCode: string | null
  fundStrategy: string | null
  navDate: string | null
  virtualUnitNav: number | null
  unitNav: number | null
  cumulativeNav: number | null
  priceChangePct: number | null
  marketValue: number
  marketPct: number
  shares: number | null
  suspensionInfo: string
  beianHao: string | null
}

export type OtherHoldingRow = {
  index: number
  assetName: string
  category: string
  marketValue: number
  marketPct: number
  quantity: number | null
  cost: number | null
}

export type ReturnCurvePoint = {
  date: string
  nav: number
  returnPct: number
}

export type ReturnCurveSeries = {
  fundName: string
  displayName: string
  beianHao: string | null
  valuationCode: string | null
  points: ReturnCurvePoint[]
}

export type FundValuationAllocationResult = {
  beian_hao: string
  product_name: string | null
  product_code: string | null
  fund_name: string | null
  valuation_date: string | null
  unit_nav: number | null
  unit_nav_date: string | null
  latest_nav_date: string | null
  net_asset_value: number | null
  total_asset: number | null
  custody_balance: number | null
  settlement_reserve: number | null
  margin_deposit: number | null
  paid_in_capital: number | null
  manager: string | null
  custodian: string | null
  inception_date: string | null
  layout_type: ValuationLayoutType
  allocation: AllocationRow[]
  fund_holdings: FundHoldingRow[]
  return_curves: ReturnCurveSeries[]
  other_holdings: OtherHoldingRow[]
  derivatives: DerivativeRow[]
  derivative_sector_shares: DerivativeSectorShareRow[]
  options: OptionRow[]
  greek_letters: GreekLetterRow[]
  term_analysis: TermAnalysisRow[]
  has_data: boolean
  match_method: string | null
}

const ROW_KIND_LABELS: Record<string, string> = {
  bank_deposit: "托管户现金",
  settlement_reserve: "清算备付金",
  margin_deposit: "存出保证金",
  clearing: "证券清算款",
  derivative: "衍生品",
  stock: "股票",
  bond: "债券",
  private_fund: "私募基金",
  fund: "基金",
  fund_or_stock: "基金/股票",
  money_fund: "货币基金",
  repo: "回购",
  receivable: "应收款",
  payable: "应付款",
  other: "其他",
}

const MAJOR_ROW_KINDS = ["bank_deposit", "settlement_reserve", "margin_deposit"] as const

const DISPLAY_ORDER = [
  ...MAJOR_ROW_KINDS,
  "clearing",
  "derivative",
  "stock",
  "bond",
  "private_fund",
  "fund",
  "fund_or_stock",
  "money_fund",
  "repo",
  "receivable",
  "other",
]

const SKIP_ROW_KINDS = new Set(["payable"])

function parseNum(v: string | null | undefined): number {
  if (v == null || v === "") return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function rowMarketValue(h: {
  signed_market_value: string | null
  market_value: string | null
}): number {
  return Math.abs(parseNum(h.signed_market_value) || parseNum(h.market_value))
}

function labelForRowKind(kind: string): string {
  return ROW_KIND_LABELS[kind] ?? "其他"
}

function subjectDepth(code: string | null | undefined): number {
  return String(code ?? "").replace(/\s+/g, "").split(".").filter(Boolean).length
}

function firstNonEmptyCustodian(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = value?.trim()
    if (normalized) return normalized
  }
  return null
}

async function resolveFundName(beian_hao: string): Promise<string | null> {
  const rows = await query<{ product_name: string }>(
    `SELECT product_name FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
    [beian_hao],
  )
  if (rows[0]?.product_name) return rows[0].product_name

  const fallback = await lookupFundInfoFallback(beian_hao)
  if (fallback?.product_name) return fallback.product_name

  return lookupManagedProductOverride(beian_hao)?.product_name ?? null
}

async function resolveFundMeta(
  beian_hao: string,
  productNameHint?: string | null,
  options?: { includeLatestNav?: boolean },
): Promise<{
  product_name: string | null
  manager: string | null
  custodian: string | null
  inception_date: string | null
  latest_nav: number | null
  latest_nav_date: string | null
}> {
  let pfi: { product_name: string; manager: string | null; inception_date: string | null } | undefined
  let bfl: {
    product_name: string | null
    short_name: string | null
    custodian: string | null
    inception_date: string | null
    registration_date: string | null
  } | undefined
  let track: {
    mandator_name: string | null
    inception_date: string | null
    puton_date: string | null
  } | undefined

  try {
    const rows = await query<{
      product_name: string
      manager: string | null
      inception_date: string | null
    }>(
      `SELECT product_name, manager, inception_date::text AS inception_date
       FROM private_fund_info WHERE beian_hao = $1 LIMIT 1`,
      [beian_hao],
    )
    pfi = rows[0]
  } catch {
    // optional
  }

  try {
    const rows = await query<{
      product_name: string | null
      short_name: string | null
      custodian: string | null
      inception_date: string | null
      registration_date: string | null
    }>(
      `SELECT product_name, short_name, custodian, inception_date::text, registration_date::text
       FROM private_fund_info_bfl WHERE beian_hao = $1 LIMIT 1`,
      [beian_hao],
    )
    bfl = rows[0]
  } catch {
    // optional
  }

  const productName = pfi?.product_name ?? bfl?.product_name ?? productNameHint ?? ""
  const shortName = bfl?.short_name ?? ""
  try {
    const rows = await query<{
      mandator_name: string | null
      inception_date: string | null
      puton_date: string | null
    }>(
      `SELECT mandator_name, inception_date::text, puton_date::text
       FROM basicinfo_bfl_track
       WHERE register_number = $1
          OR record_key = $1
          OR ($2 <> '' AND (fund_name = $2 OR fund_short_name = $2))
          OR ($3 <> '' AND (fund_name = $3 OR fund_short_name = $3))
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [beian_hao, productName, shortName],
    )
    track = rows[0]
  } catch {
    // optional
  }

  const override = lookupManagedProductOverride(beian_hao)

  let latest_nav: number | null = null
  let latest_nav_date: string | null = null

  if (options?.includeLatestNav !== false) {
    try {
      const latest = await loadFundLatestUnitNav(beian_hao, pfi?.product_name ?? bfl?.product_name ?? productNameHint ?? undefined)
      latest_nav = latest.nav
      latest_nav_date = latest.price_date
    } catch {
      // optional
    }
  }

  const inception_date =
    track?.inception_date?.slice(0, 10) ??
    bfl?.inception_date?.slice(0, 10) ??
    pfi?.inception_date?.slice(0, 10) ??
    null

  return {
    product_name: pfi?.product_name ?? bfl?.product_name ?? override?.product_name ?? productNameHint ?? null,
    manager: pfi?.manager ?? null,
    custodian: firstNonEmptyCustodian(
      normalizeRegistrationCustodian(track?.mandator_name),
      normalizeRegistrationCustodian(bfl?.custodian),
    ),
    inception_date,
    latest_nav,
    latest_nav_date,
  }
}

function extractPaidInCapital(
  holdings: Awaited<ReturnType<typeof listFundLatestValuationHoldings>>["holdings"],
): number | null {
  for (const h of holdings) {
    const name = String(h.subject_name ?? "").replace(/\s/g, "")
    if (!/实收资本/.test(name)) continue
    const qty = parseNum(h.quantity)
    if (qty > 0) return qty
    const cost = parseNum(h.cost)
    if (cost > 0) return cost
  }
  return null
}

function extractUnitNavFromHoldings(
  holdings: Awaited<ReturnType<typeof listFundLatestValuationHoldings>>["holdings"],
): number | null {
  for (const h of holdings) {
    const name = String(h.subject_name ?? "").replace(/\s/g, "")
    if (!/^单位净值$/.test(name) && !(name.includes("单位净值") && !name.includes("累计"))) continue
    const price = parseNum(h.price)
    if (price > 0.05 && price < 500) return price
    const mv = rowMarketValue(h)
    if (mv > 0.05 && mv < 500) return mv
  }
  return null
}

/** 大类配置 — one total per major bucket; avoid summing nested children or derivatives. */
function aggregateMajorKind(
  holdings: Awaited<ReturnType<typeof listFundLatestValuationHoldings>>["holdings"],
  kind: string,
): number {
  const rows = holdings
    .filter((h) => h.row_kind === kind)
    .map((h) => ({ h, depth: subjectDepth(h.subject_code), mv: rowMarketValue(h) }))
    .filter((r) => r.mv > 0)

  if (!rows.length) return 0

  const minDepth = Math.min(...rows.map((r) => r.depth))
  const shallow = rows.filter((r) => r.depth === minDepth)
  return Math.max(...shallow.map((r) => r.mv))
}

function matchesCashHeaderKind(
  h: HoldingRow,
  kind: "settlement_reserve" | "margin_deposit",
): boolean {
  if (h.row_kind === kind) return true
  const code = String(h.subject_code ?? "").replace(/\s+/g, "")
  const name = String(h.subject_name ?? "").replace(/\s/g, "")
  if (kind === "settlement_reserve") {
    return code.startsWith("1021") || /清算备付金/.test(name)
  }
  return code.startsWith("1031") || /存出保证金|交易保证金/.test(name)
}

/** Header 清算备付金 / 存出保证金 — row_kind, subject code, or name; default 0 when absent. */
function extractCashHeaderMetric(
  holdings: HoldingRow[],
  kind: "settlement_reserve" | "margin_deposit",
): number {
  const fromKind = aggregateMajorKind(holdings, kind)
  if (fromKind > 0) return fromKind

  const rows = holdings
    .filter((h) => matchesCashHeaderKind(h, kind))
    .map((h) => ({ depth: subjectDepth(h.subject_code), mv: rowMarketValue(h) }))
    .filter((r) => r.mv > 0)

  if (!rows.length) return 0

  const minDepth = Math.min(...rows.map((r) => r.depth))
  const shallow = rows.filter((r) => r.depth === minDepth)
  return Math.max(...shallow.map((r) => r.mv))
}

function aggregateByRowKind(
  holdings: Awaited<ReturnType<typeof listFundLatestValuationHoldings>>["holdings"],
  mode: AllocationMode,
): Map<string, number> {
  if (mode === "major") {
    const out = new Map<string, number>()
    for (const kind of MAJOR_ROW_KINDS) {
      const value = aggregateMajorKind(holdings, kind)
      if (value > 0) out.set(kind, value)
    }
    return out
  }

  const leafSums = new Map<string, number>()
  const maxByKind = new Map<string, number>()

  for (const h of holdings) {
    const kind = h.row_kind ?? "other"
    if (SKIP_ROW_KINDS.has(kind)) continue

    const mv = rowMarketValue(h)
    if (mv <= 0) continue

    maxByKind.set(kind, Math.max(maxByKind.get(kind) ?? 0, mv))

    if (h.is_leaf !== false) {
      leafSums.set(kind, (leafSums.get(kind) ?? 0) + mv)
    }
  }

  const out = new Map<string, number>()
  const kinds = new Set([...leafSums.keys(), ...maxByKind.keys()])
  for (const kind of kinds) {
    const leaf = leafSums.get(kind) ?? 0
    const max = maxByKind.get(kind) ?? 0
    const value = leaf > 0 ? leaf : max
    if (value > 0) out.set(kind, value)
  }
  return out
}

function buildAllocation(
  sums: Map<string, number>,
  net_asset_value: number,
): AllocationRow[] {
  const entries = [...sums.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => {
      const ai = DISPLAY_ORDER.indexOf(a[0])
      const bi = DISPLAY_ORDER.indexOf(b[0])
      const ao = ai >= 0 ? ai : 999
      const bo = bi >= 0 ? bi : 999
      if (ao !== bo) return ao - bo
      return b[1] - a[1]
    })

  const navBase = net_asset_value > 0
    ? net_asset_value
    : entries.reduce((s, [, v]) => s + v, 0)

  return entries.map(([rowKind, value], i) => ({
    index: i + 1,
    category: labelForRowKind(rowKind),
    rowKind,
    value,
    pct: navBase > 0 ? (value / navBase) * 100 : 0,
  }))
}

type HoldingRow = Awaited<ReturnType<typeof listFundLatestValuationHoldings>>["holdings"][number]

function isOptionHolding(h: HoldingRow): boolean {
  if (h.row_kind === "option") return true
  if (h.asset_class === "期权") return true
  const name = String(h.subject_name ?? "")
  if (/期权/.test(name)) return true
  return /[A-Za-z]{1,4}\d{3,4}[CPcp]\d+/.test(`${h.symbol ?? ""}${name}`)
}

function extractValuationCode(h: HoldingRow): string {
  if (h.symbol) return String(h.symbol).toUpperCase()
  const name = String(h.subject_name ?? "")
  const match = name.match(/([A-Za-z]+\d{3,4}[CPcp]\d+)/)
  if (match) return match[1].toUpperCase()
  return String(h.original_subject_code ?? h.subject_code ?? "").replace(/\s/g, "")
}

function resolveOptionDirection(
  h: HoldingRow,
  signedMv: number,
  signedCost: number,
): { directionLabel: "买方" | "卖方" } {
  const name = String(h.subject_name ?? "")
  if (/卖方/.test(name)) return { directionLabel: "卖方" }
  if (/买方/.test(name)) return { directionLabel: "买方" }
  if (h.direction === "short" || signedMv < 0 || signedCost < 0) return { directionLabel: "卖方" }
  return { directionLabel: "买方" }
}

function buildDerivatives(holdings: HoldingRow[], netAssetValue: number): DerivativeRow[] {
  const rows = holdings
    .filter((h) => h.row_kind === "derivative" && !isOptionHolding(h))
    .filter((h) => {
      const qty = Math.abs(parseNum(h.quantity))
      const mv = parseNum(h.signed_market_value) || parseNum(h.market_value)
      return qty > 0 || Math.abs(mv) > 0
    })
    .map((h) => {
      const signedMv = parseNum(h.signed_market_value) || parseNum(h.market_value)
      const signedCost = parseNum(h.signed_cost) || parseNum(h.cost)
      const direction: "long" | "short" =
        h.direction === "short" || signedMv < 0 || signedCost < 0 ? "short" : "long"
      const weightRaw = parseNum(h.market_weight)
      const marketPct =
        weightRaw !== 0
          ? (Math.abs(weightRaw) <= 1 ? weightRaw * 100 : weightRaw) * (signedMv < 0 ? -1 : 1)
          : netAssetValue > 0
            ? (signedMv / netAssetValue) * 100
            : 0

      return {
        contractName: String(h.subject_name ?? h.symbol ?? "").trim(),
        symbol: h.symbol,
        sector: inferDerivativeSector(h.symbol, String(h.subject_name ?? ""), h.asset_class),
        direction,
        directionLabel: direction === "short" ? "空头" : "多头",
        quantity: Math.abs(parseNum(h.quantity)),
        price: parseNum(h.price) || null,
        marketValue: signedMv,
        marketPct,
        cost: signedCost !== 0 ? signedCost : null,
        unrealizedPnl: parseNum(h.unrealized_pnl) || null,
      }
    })
    .filter((r) => r.contractName)
    .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue))

  return rows.map((row, i) => ({ index: i + 1, ...row }))
}

function buildDerivativeSectorShares(
  derivatives: DerivativeRow[],
  netAssetValue: number,
): DerivativeSectorShareRow[] {
  const buckets = new Map<string, { long: number; short: number }>()
  for (const sector of DERIVATIVE_SECTOR_CHART_ORDER) {
    buckets.set(sector, { long: 0, short: 0 })
  }

  for (const row of derivatives) {
    if (row.sector === "其他") continue
    const bucket = buckets.get(row.sector)
    if (!bucket) continue
    const absMv = Math.abs(row.marketValue)
    if (row.direction === "short") bucket.short += absMv
    else bucket.long += absMv
  }

  const navBase = netAssetValue > 0 ? netAssetValue : 1
  return DERIVATIVE_SECTOR_CHART_ORDER.map((sector) => {
    const { long, short } = buckets.get(sector) ?? { long: 0, short: 0 }
    return {
      sector,
      longMarketValue: long,
      longMarketPct: (long / navBase) * 100,
      shortMarketValue: short,
      shortMarketPct: (short / navBase) * 100,
      netMarketValue: long - short,
    }
  }).filter((r) => r.longMarketValue > 0 || r.shortMarketValue > 0)
}

function buildOptions(holdings: HoldingRow[], netAssetValue: number): OptionRow[] {
  const rows = holdings
    .filter((h) => isOptionHolding(h))
    .filter((h) => {
      const qty = Math.abs(parseNum(h.quantity))
      const mv = parseNum(h.signed_market_value) || parseNum(h.market_value)
      return qty > 0 || Math.abs(mv) > 0
    })
    .map((h) => {
      const signedMv = parseNum(h.signed_market_value) || parseNum(h.market_value)
      const signedCost = parseNum(h.signed_cost) || parseNum(h.cost)
      const { directionLabel } = resolveOptionDirection(h, signedMv, signedCost)
      const weightRaw = parseNum(h.market_weight)
      const marketPct =
        weightRaw !== 0
          ? (Math.abs(weightRaw) <= 1 ? weightRaw * 100 : weightRaw) * (signedMv < 0 ? -1 : 1)
          : netAssetValue > 0
            ? (signedMv / netAssetValue) * 100
            : 0

      return {
        assetName: String(h.subject_name ?? h.symbol ?? "").trim(),
        directionLabel,
        valuationCode: extractValuationCode(h),
        quantity: Math.abs(parseNum(h.quantity)),
        price: parseNum(h.price) || null,
        marketValue: signedMv,
        marketPct,
        cost: signedCost !== 0 ? signedCost : null,
        unrealizedPnl: parseNum(h.unrealized_pnl) || null,
      }
    })
    .filter((r) => r.assetName)
    .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue))

  return rows.map((row, i) => ({ index: i + 1, ...row }))
}

const CASH_ROW_KINDS = new Set(["bank_deposit", "settlement_reserve", "margin_deposit", "payable"])

const FOF_ALLOCATION_ORDER = ["bank_deposit", "private_fund", "public_fund", "other"] as const

const FOF_ALLOCATION_LABELS: Record<(typeof FOF_ALLOCATION_ORDER)[number], string> = {
  bank_deposit: "托管户现金",
  private_fund: "私募基金",
  public_fund: "公募基金",
  other: "其他",
}

function hasEconomicHoldingValue(h: HoldingRow): boolean {
  const qty = Math.abs(parseNum(h.quantity))
  const mv = parseNum(h.signed_market_value) || parseNum(h.market_value)
  const cost = parseNum(h.signed_cost) || parseNum(h.cost)
  return qty > 0 || Math.abs(mv) > 0 || Math.abs(cost) > 0
}

function isFundHoldingRow(h: HoldingRow): boolean {
  if (h.include_in_detail === false) return false
  if (h.is_leaf === false) return false
  if (!hasEconomicHoldingValue(h)) return false

  const kind = h.row_kind ?? "other"
  if (["private_fund", "fund_or_stock", "fund", "money_fund"].includes(kind)) return true

  const code = String(h.subject_code ?? "").replace(/\s/g, "")
  if (code.startsWith("1109") || code.startsWith("1108")) return true
  if (/私募证券投资基金|私募基金/.test(String(h.subject_name ?? ""))) return true
  if (kind === "other" && String(h.symbol ?? "").trim()) return true
  return false
}

function fundHoldingIdentityKey(h: HoldingRow): string | null {
  const code = String(h.symbol ?? "").trim().toUpperCase()
  if (code) return `code:${code}`
  const name = String(h.subject_name ?? "").trim()
  if (!name) return null
  return `name:${name}`
}

function scoreFundHoldingCandidate(h: HoldingRow): number {
  let score = 0
  if (h.is_leaf === true) score += 1_000
  if (Math.abs(parseNum(h.quantity)) > 0) score += 500
  if (parsePlausibleNav(h.price) != null) score += 200
  const kind = h.row_kind ?? "other"
  if (["private_fund", "fund", "money_fund", "fund_or_stock"].includes(kind)) score += 100
  score += Math.abs(rowMarketValue(h))
  return score
}

/** One row per underlying fund — same fund may appear under multiple 科目 codes in 估值表. */
function dedupeFundHoldings(holdings: HoldingRow[]): HoldingRow[] {
  const byKey = new Map<string, HoldingRow>()
  for (const h of holdings) {
    if (!isFundHoldingRow(h)) continue
    const key = fundHoldingIdentityKey(h)
    if (!key) continue
    const prev = byKey.get(key)
    if (!prev || scoreFundHoldingCandidate(h) > scoreFundHoldingCandidate(prev)) {
      byKey.set(key, h)
    }
  }
  return [...byKey.values()].sort((a, b) => Math.abs(rowMarketValue(b)) - Math.abs(rowMarketValue(a)))
}

function classifyFundHoldingKind(h: HoldingRow): "private_fund" | "public_fund" {
  const kind = h.row_kind ?? "other"
  if (kind === "private_fund") return "private_fund"
  if (kind === "fund" || kind === "money_fund") return "public_fund"
  if (kind === "fund_or_stock") {
    return /私募/.test(String(h.subject_name ?? "")) ? "private_fund" : "public_fund"
  }
  const code = String(h.subject_code ?? "").replace(/\s/g, "")
  if (code.startsWith("1109") || code.startsWith("1108") || /私募/.test(String(h.subject_name ?? ""))) {
    return "private_fund"
  }
  return "public_fund"
}

export function detectValuationLayoutType(holdings: HoldingRow[]): ValuationLayoutType {
  return holdings.some(isFundHoldingRow) ? "fof" : "derivative"
}

function aggregateFofAllocation(
  holdings: HoldingRow[],
  netAssetValue: number,
  custodyBalance: number,
): AllocationRow[] {
  const sums = new Map<string, number>()

  if (custodyBalance > 0) {
    sums.set("bank_deposit", custodyBalance)
  } else {
    const cash = aggregateMajorKind(holdings, "bank_deposit")
    if (cash > 0) sums.set("bank_deposit", cash)
  }

  for (const kind of ["settlement_reserve", "margin_deposit"] as const) {
    const value = aggregateMajorKind(holdings, kind)
    if (value > 0) sums.set("bank_deposit", (sums.get("bank_deposit") ?? 0) + value)
  }

  for (const h of dedupeFundHoldings(holdings)) {
    const bucket = classifyFundHoldingKind(h)
    const mv = rowMarketValue(h)
    if (mv <= 0) continue
    sums.set(bucket, (sums.get(bucket) ?? 0) + mv)
  }

  for (const h of holdings) {
    const kind = h.row_kind ?? "other"
    if (CASH_ROW_KINDS.has(kind) || isFundHoldingRow(h)) continue
    if (h.include_in_detail === false) continue
    const mv = rowMarketValue(h)
    if (mv <= 0) continue
    sums.set("other", (sums.get("other") ?? 0) + mv)
  }

  const entries = FOF_ALLOCATION_ORDER
    .map((key) => [key, sums.get(key) ?? 0] as const)
    .filter(([, value]) => value > 0)

  const navBase = netAssetValue > 0
    ? netAssetValue
    : entries.reduce((s, [, v]) => s + v, 0)

  return entries.map(([key, value], i) => ({
    index: i + 1,
    category: FOF_ALLOCATION_LABELS[key],
    rowKind: key,
    value,
    pct: navBase > 0 ? (value / navBase) * 100 : 0,
  }))
}

function deriveNavFromShares(quantity: unknown, marketValue: unknown): number | null {
  const shares = parseNum(String(quantity ?? ""))
  const mv = parseNum(String(marketValue ?? ""))
  if (shares > 0 && mv > 0) {
    const nav = mv / shares
    if (nav > 0.05 && nav < 500) return nav
  }
  return null
}

function parsePlausibleNav(value: unknown): number | null {
  const n = typeof value === "number" ? value : parseNum(String(value ?? ""))
  if (n > 0.05 && n < 500) return n
  return null
}

function formatFundStrategy(l1: string | null | undefined, l2: string | null | undefined): string | null {
  const s1 = l1?.trim() || null
  const s2 = l2?.trim() || null
  if (s1 && s2) return `${s1}/${s2}`
  return s1 ?? s2
}

function extractSuspensionInfo(extra: Record<string, unknown>, hasOfficialNav: boolean): string {
  const raw = String(extra.suspension_info ?? extra.停牌信息 ?? "").trim()
  if (raw) return raw.startsWith("【") ? raw : `【${raw}】`
  return hasOfficialNav ? "【正常交易_手工维护】" : "【无行情】"
}

type CompanyStrategyRow = { key: string; l1: string | null; l2: string | null }

async function loadCompanyStrategyBatch(
  beianCodes: string[],
  productNames: string[],
): Promise<Map<string, CompanyStrategyRow>> {
  const out = new Map<string, CompanyStrategyRow>()
  const codes = [...new Set(beianCodes.map((c) => c.trim()).filter(Boolean))]
  if (codes.length > 0) {
    const rows = await query<{ register_number: string; l1: string | null; l2: string | null }>(
      `SELECT DISTINCT ON (register_number)
         register_number,
         NULLIF(BTRIM(company_strategy_one), '') AS l1,
         NULLIF(BTRIM(company_strategy_two), '') AS l2
       FROM type6_ops_team_full
       WHERE register_number = ANY($1::text[])
       ORDER BY register_number, updated_at DESC NULLS LAST, id DESC`,
      [codes],
    )
    for (const r of rows) {
      out.set(r.register_number, { key: r.register_number, l1: r.l1, l2: r.l2 })
    }
  }

  const names = [...new Set(productNames.map((n) => n.trim()).filter(Boolean))]
  if (names.length > 0) {
    const rows = await query<{ product_name: string; l1: string | null; l2: string | null }>(
      `SELECT DISTINCT ON (n.name)
         n.name AS product_name,
         NULLIF(BTRIM(o.company_strategy_one), '') AS l1,
         NULLIF(BTRIM(o.company_strategy_two), '') AS l2
       FROM unnest($1::text[]) AS n(name)
       JOIN type6_ops_team_full o ON (
         ${sqlFundNameMatch("o.fund_name", "n.name")}
         OR ${sqlFundNameMatch("o.fund_short_name", "n.name")}
       )
       ORDER BY n.name, o.updated_at DESC NULLS LAST, o.id DESC`,
      [names],
    )
    for (const r of rows) {
      if (!out.has(r.product_name)) {
        out.set(r.product_name, { key: r.product_name, l1: r.l1, l2: r.l2 })
      }
    }
  }

  return out
}

type EmailNavDetail = { unitNav: number | null; cumulativeNav: number | null; navDate: string }

async function loadEmailNavDetailsBatch(
  beianCodes: string[],
  productNames: string[],
  asOfDate: string,
): Promise<Map<string, EmailNavDetail>> {
  const out = new Map<string, EmailNavDetail>()
  const sinceDate = asOfDate.slice(0, 10)
  const codes = [...new Set(beianCodes.map((c) => c.trim()).filter(Boolean))]
  if (codes.length > 0) {
    const rows = await query<{ code: string; nav_date: string; nav: string; cumulative_nav: string | null }>(
      `SELECT DISTINCT ON (BTRIM(product_code))
         BTRIM(product_code) AS code,
         nav_date::text AS nav_date,
         nav::text AS nav,
         cumulative_nav::text AS cumulative_nav
       FROM ops_email_nav_records
       WHERE BTRIM(product_code) = ANY($1::text[])
         AND nav IS NOT NULL
         AND nav_date <= $2::date
       ORDER BY BTRIM(product_code), nav_date DESC, id DESC`,
      [codes, sinceDate],
    )
    for (const r of rows) {
      const unitNav = parsePlausibleNav(r.nav)
      const cumulativeNav = parsePlausibleNav(r.cumulative_nav ?? "")
      out.set(r.code, {
        unitNav,
        cumulativeNav: cumulativeNav ?? unitNav,
        navDate: r.nav_date.slice(0, 10),
      })
    }
  }

  const names = [...new Set(productNames.map((n) => n.trim()).filter(Boolean))]
  if (names.length > 0) {
    const rows = await query<{ product_name: string; nav_date: string; nav: string; cumulative_nav: string | null }>(
      `SELECT DISTINCT ON (n.name)
         n.name AS product_name,
         e.nav_date::text AS nav_date,
         e.nav::text AS nav,
         e.cumulative_nav::text AS cumulative_nav
       FROM unnest($1::text[]) AS n(name)
       JOIN ops_email_nav_records e ON ${sqlFundNameMatch("e.fund_name", "n.name")}
       WHERE e.nav IS NOT NULL
         AND e.nav_date <= $2::date
       ORDER BY n.name, e.nav_date DESC, e.id DESC`,
      [names, sinceDate],
    )
    for (const r of rows) {
      if (out.has(r.product_name)) continue
      const unitNav = parsePlausibleNav(r.nav)
      const cumulativeNav = parsePlausibleNav(r.cumulative_nav ?? "")
      out.set(r.product_name, {
        unitNav,
        cumulativeNav: cumulativeNav ?? unitNav,
        navDate: r.nav_date.slice(0, 10),
      })
    }
  }

  return out
}

function normalizeMarketWeightPct(weightRaw: number, signedMv: number, netAssetValue: number): number {
  if (weightRaw !== 0) {
    return (Math.abs(weightRaw) <= 1 ? weightRaw * 100 : weightRaw) * (signedMv < 0 ? -1 : 1)
  }
  return netAssetValue > 0 ? (signedMv / netAssetValue) * 100 : 0
}

async function buildFundHoldings(
  holdings: HoldingRow[],
  netAssetValue: number,
  valuationDate: string | null,
): Promise<FundHoldingRow[]> {
  const fundRows = dedupeFundHoldings(holdings)
    .map((h) => {
      const signedMv = parseNum(h.signed_market_value) || parseNum(h.market_value)
      const qty = parseNum(h.quantity)
      const derivedNav = deriveNavFromShares(h.quantity, signedMv)
      const virtualUnitNav = parsePlausibleNav(h.price) ?? derivedNav
      return {
        fundName: String(h.subject_name ?? h.symbol ?? "").trim(),
        valuationCode: h.symbol ? String(h.symbol).toUpperCase() : null,
        navDate: valuationDate?.slice(0, 10) ?? null,
        virtualUnitNav,
        unitNav: null as number | null,
        cumulativeNav: null as number | null,
        priceChangePct: null as number | null,
        marketValue: signedMv,
        marketPct: normalizeMarketWeightPct(parseNum(h.market_weight), signedMv, netAssetValue),
        shares: qty > 0 ? qty : null,
        beianHao: h.symbol ? String(h.symbol).trim().toUpperCase() : null,
        extra: h.extra ?? {},
      }
    })
    .filter((r) => r.fundName)
    .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue))

  if (fundRows.length === 0) return []

  const asOfDate = valuationDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  const beianCodes = fundRows.map((r) => r.beianHao).filter(Boolean) as string[]
  const productNames = fundRows.map((r) => r.fundName)

  const [strategyMap, emailNavMap, resolvedBeians] = await Promise.all([
    loadCompanyStrategyBatch(beianCodes, productNames),
    loadEmailNavDetailsBatch(beianCodes, productNames, asOfDate),
    Promise.all(fundRows.map((row) =>
      row.beianHao ? Promise.resolve(row.beianHao) : resolveFundBeianHao(row.fundName),
    )),
  ])

  return fundRows.map((row, i) => {
    const emailNav = (row.beianHao ? emailNavMap.get(row.beianHao) : null)
      ?? emailNavMap.get(row.fundName)

    let unitNav: number | null = null
    let cumulativeNav: number | null = null
    let navDate = row.navDate

    if (emailNav?.unitNav != null) {
      unitNav = emailNav.unitNav
      cumulativeNav = emailNav.cumulativeNav
      navDate = emailNav.navDate
    } else if (row.virtualUnitNav != null) {
      unitNav = row.virtualUnitNav
    }

    const strategyRow = (row.beianHao ? strategyMap.get(row.beianHao) : null)
      ?? strategyMap.get(row.fundName)
    const fundStrategy = formatFundStrategy(strategyRow?.l1, strategyRow?.l2)

    const hasOfficialNav = unitNav != null && unitNav !== row.virtualUnitNav
    const suspensionInfo = extractSuspensionInfo(row.extra, hasOfficialNav)

    return {
      index: i + 1,
      fundName: row.fundName,
      valuationCode: row.valuationCode,
      fundStrategy,
      navDate,
      virtualUnitNav: row.virtualUnitNav,
      unitNav,
      cumulativeNav,
      priceChangePct: null,
      marketValue: row.marketValue,
      marketPct: row.marketPct,
      shares: row.shares,
      suspensionInfo,
      beianHao: resolvedBeians[i] ?? row.beianHao,
    }
  })
}

function buildOtherHoldings(holdings: HoldingRow[], netAssetValue: number): OtherHoldingRow[] {
  const rows = holdings
    .filter((h) => {
      const kind = h.row_kind ?? "other"
      if (CASH_ROW_KINDS.has(kind) || isFundHoldingRow(h)) return false
      if (h.include_in_detail === false) return false
      return rowMarketValue(h) > 0
    })
    .map((h) => {
      const signedMv = parseNum(h.signed_market_value) || parseNum(h.market_value)
      const kind = h.row_kind ?? "other"
      return {
        assetName: String(h.subject_name ?? h.symbol ?? "").trim(),
        category: labelForRowKind(kind),
        marketValue: signedMv,
        marketPct: normalizeMarketWeightPct(parseNum(h.market_weight), signedMv, netAssetValue),
        quantity: parseNum(h.quantity) || null,
        cost: parseNum(h.signed_cost) || parseNum(h.cost) || null,
      }
    })
    .filter((r) => r.assetName)
    .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue))

  return rows.map((row, i) => ({ index: i + 1, ...row }))
}

async function buildUnderlyingReturnCurves(
  fundHoldings: FundHoldingRow[],
  valuationDate: string | null,
): Promise<ReturnCurveSeries[]> {
  if (fundHoldings.length === 0) return []

  const to = valuationDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  const fromDate = new Date(`${to}T12:00:00`)
  fromDate.setFullYear(fromDate.getFullYear() - 1)
  const from = fromDate.toISOString().slice(0, 10)

  const tasks = fundHoldings.map(async (holding) => {
    const lookupId = holding.beianHao ?? holding.valuationCode ?? holding.fundName
    if (!lookupId) return null

    const names = await resolveFundNames(lookupId, holding.fundName)
    const navRows = await loadFundNavSeries(
      lookupId,
      names.product_name,
      names.short_name ?? "",
      { from, to },
    )
    if (navRows.length < 2) return null

    const baseNav = parseFloat(navRows[0].level)
    if (!Number.isFinite(baseNav) || baseNav <= 0) return null

    const points = navRows.map((point) => {
      const nav = parseFloat(point.level)
      return {
        date: point.price_date,
        nav,
        returnPct: Number.isFinite(nav) && baseNav > 0 ? (nav / baseNav - 1) * 100 : 0,
      }
    })

    const displayName = holding.fundName
      .replace(/私募证券投资基金/g, "")
      .replace(/私募基金/g, "")
      .trim() || holding.fundName

    return {
      fundName: holding.fundName,
      displayName,
      beianHao: holding.beianHao,
      valuationCode: holding.valuationCode,
      points,
    } satisfies ReturnCurveSeries
  })

  const results = await Promise.all(tasks)
  return results
    .filter((s): s is ReturnCurveSeries => s != null)
    .sort((a, b) => {
      const aLast = a.points.at(-1)?.returnPct ?? 0
      const bLast = b.points.at(-1)?.returnPct ?? 0
      return bLast - aLast
    })
}

export async function getFundValuationAllocation(
  rawBeianHao: string,
  mode: AllocationMode = "major",
  fetchOptions?: { includeReturnCurves?: boolean },
): Promise<FundValuationAllocationResult> {
  const includeReturnCurves = fetchOptions?.includeReturnCurves ?? false
  const beian_hao = await resolveRouteFundId(rawBeianHao)
  const product_name = await resolveFundName(beian_hao)

  const candidateCodes = new Set<string>([beian_hao])
  const remapped = remapManagedProductBeianCode(beian_hao)
  if (remapped) candidateCodes.add(remapped)
  const override = lookupManagedProductOverride(beian_hao)
  if (override?.beian_hao) candidateCodes.add(override.beian_hao)

  const fundMeta = await resolveFundMeta(beian_hao, product_name, { includeLatestNav: false })

  let metrics: Awaited<ReturnType<typeof listFundMetricsLatest>>[number] | null = null
  let holdings: Awaited<ReturnType<typeof listFundLatestValuationHoldings>>["holdings"] = []
  let match_method: string | null = null
  let matchedCode: string | null = null
  let matchedFundName: string | null = null

  for (const code of candidateCodes) {
    const m = (await listFundMetricsLatest({ productCode: code }))[0] ?? null
    const h = (
      await listFundLatestValuationHoldings({
        productCode: code,
        includeAnalysisOnly: false,
        limit: 2000,
      })
    ).holdings
    if (m || h.length > 0) {
      metrics = m
      holdings = h
      match_method = "product_code"
      matchedCode = code
      matchedFundName = m?.fund_name ?? h[0]?.fund_name ?? null
      break
    }
  }

  if (!metrics && holdings.length === 0 && product_name) {
    metrics = (await listFundMetricsLatest({ fundName: product_name }))[0] ?? null
    holdings = (
      await listFundLatestValuationHoldings({
        fundName: product_name,
        includeAnalysisOnly: false,
        limit: 2000,
      })
    ).holdings
    if (metrics || holdings.length > 0) {
      match_method = "fund_name"
      matchedFundName = metrics?.fund_name ?? holdings[0]?.fund_name ?? product_name
      matchedCode = metrics?.product_code ?? holdings[0]?.product_code ?? null
    }
  }

  const custody_balance = metrics ? parseNum(metrics.custody_balance) : 0
  const valuation_unit_nav = metrics ? parseNum(metrics.unit_nav) : 0
  let net_asset_value = metrics ? parseNum(metrics.net_asset_value) : 0
  const total_asset = metrics ? parseNum(metrics.total_asset) : 0
  const valuation_date = metrics?.valuation_date ?? holdings[0]?.valuation_date ?? null

  const sums = aggregateByRowKind(holdings, mode)
  if (custody_balance > 0) {
    sums.set("bank_deposit", custody_balance)
  }

  if (net_asset_value <= 0) {
    net_asset_value = [...sums.values()].reduce((s, v) => s + v, 0)
  }

  const layout_type = detectValuationLayoutType(holdings)
  const allocation = layout_type === "fof"
    ? aggregateFofAllocation(holdings, net_asset_value, custody_balance)
    : buildAllocation(sums, net_asset_value)

  const derivatives = layout_type === "derivative"
    ? buildDerivatives(holdings, net_asset_value)
    : []
  const derivative_sector_shares = layout_type === "derivative"
    ? buildDerivativeSectorShares(derivatives, net_asset_value)
    : []
  const derivativeOptions = layout_type === "derivative"
    ? buildOptions(holdings, net_asset_value)
    : []

  const fund_holdings = layout_type === "fof"
    ? await buildFundHoldings(holdings, net_asset_value, valuation_date)
    : []
  const other_holdings = layout_type === "fof"
    ? buildOtherHoldings(holdings, net_asset_value)
    : []
  const return_curves = layout_type === "fof" && includeReturnCurves
    ? await buildUnderlyingReturnCurves(fund_holdings, valuation_date)
    : []

  const holdingExtras = layout_type === "derivative"
    ? holdings.map((h) => ({
      subject_name: h.subject_name,
      symbol: h.symbol,
      asset_class: h.asset_class,
      row_kind: h.row_kind,
      direction: h.direction,
      quantity: h.quantity,
      cost: h.cost,
      signed_cost: h.signed_cost,
      market_weight: h.market_weight,
      signed_market_value: h.signed_market_value,
      market_value: h.market_value,
      extra: (h.extra as Record<string, unknown>) ?? {},
    }))
    : []

  const optionContracts = layout_type === "derivative"
    ? holdings
      .filter((h) => isOptionHolding(h))
      .map((h) => {
        const raw = extractOptionContractFromText(h.symbol, h.subject_name)
        return raw ? normalizeOptionContractCode(raw) : null
      })
      .filter((c): c is string => Boolean(c))
    : []

  const marketGreeks = layout_type === "derivative"
    ? await loadOptionMarketGreeks(optionContracts, valuation_date)
    : new Map()
  const greek_letters = layout_type === "derivative"
    ? buildGreekLetters(holdingExtras, marketGreeks)
    : []
  const term_analysis = layout_type === "derivative"
    ? buildTermAnalysis(holdingExtras, valuation_date, net_asset_value)
    : []

  const metricsPaidIn = metrics ? parseNum(metrics.paid_in_capital) : 0
  let paid_in_capital: number | null =
    metricsPaidIn > 0 ? metricsPaidIn : extractPaidInCapital(holdings)
  if ((paid_in_capital ?? 0) <= 0 && net_asset_value > 0 && fundMeta.latest_nav != null && fundMeta.latest_nav > 0) {
    paid_in_capital = net_asset_value / fundMeta.latest_nav
  }

  // 最新净值 — same merged NAV series as fund detail page (单位净值).
  let unit_nav = fundMeta.latest_nav != null && fundMeta.latest_nav > 0 ? fundMeta.latest_nav : null
  let unit_nav_date = fundMeta.latest_nav_date
  if (unit_nav == null && valuation_unit_nav > 0) unit_nav = valuation_unit_nav
  if (unit_nav == null) unit_nav = extractUnitNavFromHoldings(holdings)
  if (unit_nav == null && net_asset_value > 0 && paid_in_capital != null && paid_in_capital > 0) {
    unit_nav = net_asset_value / paid_in_capital
  }
  if (unit_nav_date == null) unit_nav_date = valuation_date?.slice(0, 10) ?? null

  const managedOverride = lookupManagedProductOverride(beian_hao)
  const managedCustodian = lookupManagedProductCustodian(
    product_name ?? matchedFundName ?? managedOverride?.product_name,
    beian_hao,
  )

  let emailCustodian: string | null = null
  if (!managedCustodian) {
    emailCustodian =
      (await lookupValuationCustodianByRecordId(holdings[0]?.valuation_record_id))
      ?? (await lookupValuationCustodianByRecordId(metrics?.valuation_record_id))
    if (!emailCustodian) {
      emailCustodian = await lookupLatestValuationCustodian({
        productCodes: [...candidateCodes, matchedCode].filter((c): c is string => Boolean(c)),
        fundName: matchedFundName ?? product_name,
      })
    }
  }

  const metricsCustodian = metrics?.custodian
    ? (resolveValuationCustodian(metrics.custodian) ?? normalizeRegistrationCustodian(metrics.custodian))
    : null

  return {
    beian_hao,
    product_name: product_name ?? fundMeta.product_name ?? lookupManagedProductOverride(beian_hao)?.product_name ?? null,
    product_code: matchedCode,
    fund_name: matchedFundName,
    valuation_date,
    unit_nav,
    unit_nav_date,
    latest_nav_date: fundMeta.latest_nav_date,
    net_asset_value: net_asset_value > 0 ? net_asset_value : null,
    total_asset: total_asset > 0 ? total_asset : null,
    custody_balance: custody_balance > 0 ? custody_balance : (sums.get("bank_deposit") ?? null),
    settlement_reserve: sums.get("settlement_reserve") ?? null,
    margin_deposit: sums.get("margin_deposit") ?? null,
    paid_in_capital,
    manager: fundMeta.manager,
    custodian: firstNonEmptyCustodian(
      managedCustodian,
      emailCustodian,
      metricsCustodian,
      fundMeta.custodian,
    ),
    inception_date: fundMeta.inception_date,
    layout_type,
    allocation,
    fund_holdings,
    return_curves,
    other_holdings,
    derivatives,
    derivative_sector_shares,
    options: derivativeOptions,
    greek_letters,
    term_analysis,
    has_data: allocation.length > 0 || fund_holdings.length > 0 || derivatives.length > 0,
    match_method,
  }
}

export type AllocationTrendSeries = {
  category: string
  rowKind: string
  values: number[]
}

export type AllocationTrendResult = {
  dates: string[]
  series: AllocationTrendSeries[]
  has_data: boolean
  point_count: number
}

function holdingInsertToRow(h: ValuationHoldingInsert): HoldingRow {
  const numStr = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? null : String(v)

  return {
    id: 0,
    valuation_record_id: h.valuationRecordId,
    product_code: h.productCode,
    fund_name: h.fundName,
    valuation_date: h.valuationDate,
    row_index: h.rowIndex,
    subject_code: h.subjectCode,
    original_subject_code: h.originalSubjectCode,
    subject_name: h.subjectName,
    symbol: h.symbol,
    row_kind: h.rowKind,
    direction: h.direction,
    exchange: h.exchange,
    asset_class: h.assetClass,
    currency: h.currency,
    fx_rate: numStr(h.fxRate),
    quantity: numStr(h.quantity),
    unit_cost: numStr(h.unitCost),
    cost: numStr(h.cost),
    signed_cost: numStr(h.signedCost),
    price: numStr(h.price),
    market_value: numStr(h.marketValue),
    signed_market_value: numStr(h.signedMarketValue),
    unrealized_pnl: numStr(h.unrealizedPnl),
    cost_weight: numStr(h.costWeight),
    market_weight: numStr(h.marketWeight),
    is_leaf: h.isLeaf,
    include_in_detail: h.includeInDetail,
    include_in_analysis: h.includeInAnalysis,
    extra: h.extra,
    refreshed_at: "",
  }
}

function jsonHoldingsToRows(
  recordId: number,
  meta: { productCode: string | null; fundName: string | null; valuationDate: string },
  holdings: ValuationRow[],
): HoldingRow[] {
  if (!Array.isArray(holdings) || holdings.length === 0) return []
  return mapValuationRowsToHoldings(holdings, {
    valuationRecordId: recordId,
    productCode: meta.productCode,
    fundName: meta.fundName,
    valuationDate: meta.valuationDate,
  })
    .filter((h) => h.subjectCode && h.subjectName)
    .map(holdingInsertToRow)
}

function computeSnapshotAllocation(
  holdings: HoldingRow[],
  mode: AllocationMode,
  custodyBalance: number,
  netAssetValue: number,
): AllocationRow[] {
  const sums = aggregateByRowKind(holdings, mode)
  if (custodyBalance > 0) {
    sums.set("bank_deposit", custodyBalance)
  }

  let nav = netAssetValue
  if (nav <= 0) {
    nav = [...sums.values()].reduce((s, v) => s + v, 0)
  }

  const layout_type = detectValuationLayoutType(holdings)
  return layout_type === "fof"
    ? aggregateFofAllocation(holdings, nav, custodyBalance)
    : buildAllocation(sums, nav)
}

export async function getFundAllocationTrend(
  rawBeianHao: string,
  fromDate: string,
  toDate: string,
  mode: AllocationMode = "major",
): Promise<AllocationTrendResult> {
  const empty: AllocationTrendResult = {
    dates: [],
    series: [],
    has_data: false,
    point_count: 0,
  }

  const from = fromDate.slice(0, 10)
  const to = toDate.slice(0, 10)
  if (!from || !to || from > to) return empty

  const { product_name, candidateCodes } = await resolveFundValuationCandidateCodes(rawBeianHao)
  await ensureEmailValuationTable()

  const namePattern = product_name?.trim() ? `%${product_name.trim()}%` : null
  const recordParams: unknown[] = [candidateCodes]
  let nameClause = ""
  if (namePattern) {
    recordParams.push(namePattern)
    nameClause = `OR fund_name ILIKE $${recordParams.length}`
  }
  recordParams.push(from, to)

  let records = await query<{
    id: string
    product_code: string | null
    fund_name: string | null
    valuation_date: string
    custody_balance: string | null
    net_asset_value: string | null
    holdings: ValuationRow[]
  }>(
    `SELECT DISTINCT ON (valuation_date)
       id,
       product_code,
       fund_name,
       valuation_date::text AS valuation_date,
       custody_balance::text AS custody_balance,
       net_asset_value::text AS net_asset_value,
       holdings
     FROM ops_email_valuation_records
     WHERE (product_code = ANY($1::text[]) ${nameClause})
       AND valuation_date >= $${recordParams.length - 1}::date
       AND valuation_date <= $${recordParams.length}::date
       AND jsonb_array_length(holdings) > 0
     ORDER BY valuation_date ASC, id DESC`,
    recordParams,
  )

  if (records.length === 0 && product_name) {
    const fallbackParams: unknown[] = [`%${product_name.trim()}%`, from, to]
    records = await query<{
      id: string
      product_code: string | null
      fund_name: string | null
      valuation_date: string
      custody_balance: string | null
      net_asset_value: string | null
      holdings: ValuationRow[]
    }>(
      `SELECT DISTINCT ON (valuation_date)
         id,
         product_code,
         fund_name,
         valuation_date::text AS valuation_date,
         custody_balance::text AS custody_balance,
         net_asset_value::text AS net_asset_value,
         holdings
       FROM ops_email_valuation_records
       WHERE fund_name ILIKE $1
         AND valuation_date >= $2::date
         AND valuation_date <= $3::date
         AND jsonb_array_length(holdings) > 0
       ORDER BY valuation_date ASC, id DESC`,
      fallbackParams,
    )
  }

  if (records.length === 0) return empty

  const recordIds = records.map((r) => parseInt(r.id, 10)).filter((id) => Number.isFinite(id))
  const holdingRows = recordIds.length > 0
    ? await query<FundLatestHoldingRow>(
      `SELECT *
       FROM ops_email_valuation_holdings
       WHERE valuation_record_id = ANY($1::bigint[])
       ORDER BY valuation_record_id, row_index`,
      [recordIds],
    )
    : []

  const holdingsByRecord = new Map<number, HoldingRow[]>()
  for (const row of holdingRows) {
    const id = row.valuation_record_id
    const list = holdingsByRecord.get(id)
    if (list) list.push(row)
    else holdingsByRecord.set(id, [row])
  }

  const snapshots: { date: string; allocation: AllocationRow[] }[] = []
  for (const record of records) {
    const recordId = parseInt(record.id, 10)
    let holdings = holdingsByRecord.get(recordId) ?? []
    if (holdings.length === 0) {
      holdings = jsonHoldingsToRows(recordId, {
        productCode: record.product_code,
        fundName: record.fund_name,
        valuationDate: record.valuation_date.slice(0, 10),
      }, Array.isArray(record.holdings) ? record.holdings : [])
    }
    if (holdings.length === 0) continue

    const custodyBalance = parseNum(record.custody_balance)
    const netAssetValue = parseNum(record.net_asset_value)
    const allocation = computeSnapshotAllocation(holdings, mode, custodyBalance, netAssetValue)
    if (allocation.length === 0) continue

    snapshots.push({
      date: record.valuation_date.slice(0, 10),
      allocation,
    })
  }

  if (snapshots.length === 0) return empty

  const dates = snapshots.map((s) => s.date)
  const categoryOrder = new Map<string, { rowKind: string; order: number }>()
  let orderIdx = 0

  for (const snapshot of snapshots) {
    for (const row of snapshot.allocation) {
      if (!categoryOrder.has(row.category)) {
        categoryOrder.set(row.category, { rowKind: row.rowKind, order: orderIdx++ })
      }
    }
  }

  const sortedCategories = [...categoryOrder.entries()]
    .sort((a, b) => {
      const ai = DISPLAY_ORDER.indexOf(a[1].rowKind)
      const bi = DISPLAY_ORDER.indexOf(b[1].rowKind)
      const ao = ai >= 0 ? ai : 999
      const bo = bi >= 0 ? bi : 999
      if (ao !== bo) return ao - bo
      return a[1].order - b[1].order
    })

  const series: AllocationTrendSeries[] = sortedCategories.map(([category, meta]) => ({
    category,
    rowKind: meta.rowKind,
    values: snapshots.map((snapshot) => {
      const row = snapshot.allocation.find((r) => r.category === category)
      return row?.pct ?? 0
    }),
  }))

  return {
    dates,
    series,
    has_data: series.some((s) => s.values.some((v) => v > 0)),
    point_count: dates.length,
  }
}

async function resolveFundValuationCandidateCodes(rawBeianHao: string): Promise<{
  beian_hao: string
  product_name: string | null
  candidateCodes: string[]
}> {
  const beian_hao = await resolveRouteFundId(rawBeianHao)
  const product_name = await resolveFundName(beian_hao)
  const candidateCodes = new Set<string>([beian_hao])
  const remapped = remapManagedProductBeianCode(beian_hao)
  if (remapped) candidateCodes.add(remapped)
  const override = lookupManagedProductOverride(beian_hao)
  if (override?.beian_hao) candidateCodes.add(override.beian_hao)
  return { beian_hao, product_name, candidateCodes: [...candidateCodes] }
}

export async function listFundValuationEmailRecords(
  rawBeianHao: string,
  options?: { limit?: number; offset?: number },
): Promise<{ records: EmailValuationRecordRow[]; total: number }> {
  const { product_name, candidateCodes } = await resolveFundValuationCandidateCodes(rawBeianHao)

  const byCode = await listEmailValuationRecords({
    productCodes: candidateCodes,
    limit: options?.limit ?? 50,
    offset: options?.offset ?? 0,
  })
  if (byCode.total > 0 || !product_name) return byCode

  return listEmailValuationRecords({
    fundName: product_name,
    limit: options?.limit ?? 50,
    offset: options?.offset ?? 0,
  })
}

export async function getFundValuationCalendarSummary(rawBeianHao: string): Promise<{
  total: number
  dateFrom: string | null
  dateTo: string | null
  dates: string[]
  entries: Array<{ date: string; id: number; attachmentFilename: string | null }>
}> {
  await ensureEmailValuationTable()
  const { product_name, candidateCodes } = await resolveFundValuationCandidateCodes(rawBeianHao)

  async function querySummary(whereClause: string, queryParams: unknown[]) {
    const summaryRows = await query<{ total: string; date_from: string | null; date_to: string | null }>(
      `SELECT COUNT(*)::text AS total,
              MIN(valuation_date)::text AS date_from,
              MAX(valuation_date)::text AS date_to
       FROM ops_email_valuation_records
       WHERE ${whereClause} AND valuation_date IS NOT NULL`,
      queryParams,
    )
    const dateRows = await query<{ valuation_date: string }>(
      `SELECT DISTINCT valuation_date::text AS valuation_date
       FROM ops_email_valuation_records
       WHERE ${whereClause} AND valuation_date IS NOT NULL
       ORDER BY valuation_date`,
      queryParams,
    )
    const entryRows = await query<{
      valuation_date: string
      id: number
      attachment_filename: string | null
    }>(
      `SELECT DISTINCT ON (valuation_date)
              valuation_date::text AS valuation_date,
              id,
              attachment_filename
       FROM ops_email_valuation_records
       WHERE ${whereClause} AND valuation_date IS NOT NULL
       ORDER BY valuation_date ASC, id DESC`,
      queryParams,
    )
    const summary = summaryRows[0]
    return {
      total: parseInt(summary?.total ?? "0", 10),
      dateFrom: summary?.date_from?.slice(0, 10) ?? null,
      dateTo: summary?.date_to?.slice(0, 10) ?? null,
      dates: dateRows.map((r) => r.valuation_date.slice(0, 10)),
      entries: entryRows.map((r) => ({
        date: r.valuation_date.slice(0, 10),
        id: r.id,
        attachmentFilename: r.attachment_filename,
      })),
    }
  }

  const byCode = await querySummary("product_code = ANY($1::text[])", [candidateCodes])
  if (byCode.total > 0 || !product_name) return byCode

  return querySummary("fund_name ILIKE $1", [`%${product_name}%`])
}
