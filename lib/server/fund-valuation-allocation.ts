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
import { lookupAmacMandatorName } from "@/lib/server/amac-fund-metadata"
import { resolveValuationCustodian, normalizeRegistrationCustodian } from "@/lib/server/email-valuation-custodian"
import { fetchListedFundNavBatch } from "@/lib/server/listed-fund-eastmoney-nav"
import {
  extractListedFundCodeFromName,
  isListedFundCode,
  isValuationClearingSubjectCode,
  listedFundCodeToTickers,
  lookupFundCodeByProductName,
  resolveFundHoldingCode,
} from "@/lib/server/fund-holding-code"
import {
  isFundHoldingMergeCandidate,
  mergeSameProductFundHoldings,
} from "@/lib/server/fund-holding-merge"
import { resolveRouteFundId, lookupFundInfoFallback } from "@/lib/server/fof-underlying-query"
import { resolveRouteFundIdFast } from "@/lib/server/fund-detail-fast-path"
import { loadFundLatestUnitNav, loadFundNavSeries, resolveFundNames } from "@/lib/server/fund-nav-series"
import { sqlFundNameMatch } from "@/lib/server/fund-name-match"
import { lookupManagedProductOverride, lookupManagedProductCustodian, remapManagedProductBeianCode } from "@/lib/server/managed-product-beian"
import { loadManagedProductNavSeed } from "@/lib/server/managed-product-nav-seed"
import {
  cacheFreshValuationSnapshot,
  readValuationCacheIfFresh,
} from "@/lib/server/valuation-cache-refresh"
import {
  isValuationCashHoldingName,
  stripValuationSubjectPathPrefix,
} from "@/lib/valuation-holding-display-name"

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

export type ValuationLayoutType = "fof" | "derivative" | "equity"

export type ValuationHoldingDetailRow = {
  index: number
  assetName: string
  valuationCode: string | null
  category: string | null
  quantity: number | null
  price: number | null
  marketValue: number
  marketPct: number
  cost: number | null
  unrealizedPnl: number | null
  settlementStatus: string
}

export type StockRiskExposure = {
  stockLongMv: number
  stockLongPct: number
  stockShortMv: number
  stockShortPct: number
  indexLongMv: number
  indexLongPct: number
  indexShortMv: number
  indexShortPct: number
  etfLongMv: number
  etfLongPct: number
  totalExposurePct: number
}

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
  price: number | null
  marketValue: number
  marketPct: number
  shares: number | null
  cost: number | null
  unrealizedPnl: number | null
  settlementStatus: string
  suspensionInfo: string
  beianHao: string | null
  rowKind: string
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
  stock_holdings: ValuationHoldingDetailRow[]
  bond_holdings: ValuationHoldingDetailRow[]
  wealth_holdings: ValuationHoldingDetailRow[]
  equity_other_holdings: ValuationHoldingDetailRow[]
  stock_risk_exposure: StockRiskExposure | null
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

  let custodian = firstNonEmptyCustodian(
    normalizeRegistrationCustodian(track?.mandator_name),
    normalizeRegistrationCustodian(bfl?.custodian),
  )
  if (!custodian) {
    custodian = normalizeRegistrationCustodian(await lookupAmacMandatorName(beian_hao))
  }

  return {
    product_name: pfi?.product_name ?? bfl?.product_name ?? override?.product_name ?? productNameHint ?? null,
    manager: pfi?.manager ?? null,
    custodian,
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

const EQUITY_ALLOCATION_ORDER = [
  "bank_deposit",
  "margin_deposit",
  "bond",
  "stock",
  "wealth",
  "other",
] as const

const EQUITY_ALLOCATION_LABELS: Record<(typeof EQUITY_ALLOCATION_ORDER)[number], string> = {
  bank_deposit: "托管户现金",
  margin_deposit: "存出保证金",
  bond: "债券",
  stock: "股票",
  wealth: "理财",
  other: "其他",
}

function isWealthHolding(h: HoldingRow): boolean {
  const kind = h.row_kind ?? "other"
  if (kind === "repo" || kind === "money_fund") return true
  const name = String(h.subject_name ?? "")
  if (/GC\d{3}|R-\d+|回购|理财|国债回购/.test(name)) return true
  const code = String(h.symbol ?? resolveHoldingValuationCode(h) ?? "")
  return /^204\d{3}$/.test(code)
}

function isBondHoldingRow(h: HoldingRow): boolean {
  const kind = h.row_kind ?? "other"
  const name = String(h.subject_name ?? "")
  if (/利息|应计/.test(name)) return false
  if (kind === "bond") return true
  return /转债/.test(name)
}

function isDirectEquityStock(h: HoldingRow): boolean {
  if (h.include_in_detail === false || !hasEconomicHoldingValue(h)) return false
  if (/ETF/u.test(String(h.subject_name ?? ""))) return false
  const kind = h.row_kind ?? "other"
  if (kind === "stock") return true
  if (kind === "fund_or_stock") {
    const code = (resolveHoldingValuationCode(h) ?? "").replace(/\.(SZ|SH|BJ)$/i, "").trim()
    if (!/^\d{6}$/.test(code)) return false
    if (/基金|私募|ETF/.test(String(h.subject_name ?? ""))) return false
    const subj = String(h.subject_code ?? "").replace(/\s/g, "")
    return subj.startsWith("1102") || subj.startsWith("1001")
  }
  return false
}

function isCashLikeHoldingKind(kind: string | null | undefined): boolean {
  return [
    "bank_deposit",
    "settlement_reserve",
    "margin_deposit",
    "payable",
    "receivable",
    "clearing",
    "paid_in_capital",
  ].includes(kind ?? "")
}

function isUnderlyingFundInvestment(h: HoldingRow): boolean {
  if (!isFundHoldingRow(h) || isDirectEquityStock(h)) return false
  const kind = h.row_kind ?? "other"
  if (isCashLikeHoldingKind(kind)) return false
  if (["private_fund", "fund", "money_fund"].includes(kind)) return true
  // Avoid matching 银行存款…金舆锡泰一号私募证券投资基金 custody labels.
  if (/私募/.test(String(h.subject_name ?? "")) && !/^银行存款|^结算备付金|^存出保证金/.test(String(h.subject_name ?? ""))) {
    return true
  }
  const code = String(h.subject_code ?? "").replace(/\s/g, "")
  if (code.startsWith("1109") || code.startsWith("1108")) return true
  if (extractListedFundCodeFromName(String(h.subject_name ?? ""))) return true
  return kind === "fund_or_stock"
}

function sumHoldingMarketValue(holdings: HoldingRow[], pred: (h: HoldingRow) => boolean): number {
  return holdings
    .filter((h) => h.include_in_detail !== false && pred(h))
    .reduce((s, h) => s + Math.abs(rowMarketValue(h)), 0)
}

function mapHoldingToDetailRow(h: HoldingRow, netAssetValue: number): Omit<ValuationHoldingDetailRow, "index"> {
  const signedMv = parseNum(h.signed_market_value) || parseNum(h.market_value)
  const signedCost = parseNum(h.signed_cost) || parseNum(h.cost)
  const price = parseNum(h.price) || null
  const extra = h.extra ?? {}
  return {
    assetName: String(h.subject_name ?? h.symbol ?? "").trim(),
    valuationCode: resolveHoldingValuationCode(h),
    category: labelForRowKind(h.row_kind ?? "other"),
    quantity: (() => {
      const qty = parseNum(h.quantity)
      return qty > 0 ? qty : null
    })(),
    price,
    marketValue: signedMv,
    marketPct: normalizeMarketWeightPct(parseNum(h.market_weight), signedMv, netAssetValue),
    cost: signedCost !== 0 ? signedCost : null,
    unrealizedPnl: parseNum(h.unrealized_pnl) || null,
    settlementStatus: extractSettlementStatus(extra, price != null && price > 0),
  }
}

function buildEquityDetailHoldings(
  holdings: HoldingRow[],
  netAssetValue: number,
  filter: (h: HoldingRow) => boolean,
): ValuationHoldingDetailRow[] {
  return holdings
    .filter((h) => h.include_in_detail !== false && filter(h))
    .filter((h) => Math.abs(rowMarketValue(h)) > 0)
    .map((h) => mapHoldingToDetailRow(h, netAssetValue))
    .filter((r) => r.assetName)
    .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue))
    .map((row, i) => ({ index: i + 1, ...row }))
}

function buildStockRiskExposure(holdings: HoldingRow[], netAssetValue: number): StockRiskExposure {
  const nav = netAssetValue > 0 ? netAssetValue : 1
  let stockLong = 0
  let stockShort = 0
  let indexLong = 0
  let indexShort = 0
  let etfLong = 0

  for (const h of holdings) {
    if (h.include_in_detail === false) continue
    const mv = parseNum(h.signed_market_value) || parseNum(h.market_value)
    if (Math.abs(mv) <= 0) continue
    const kind = h.row_kind ?? "other"
    const name = String(h.subject_name ?? "")
    const symbol = String(h.symbol ?? "")

    if (isDirectEquityStock(h)) {
      if (mv >= 0) stockLong += mv
      else stockShort += Math.abs(mv)
      continue
    }
    if (/ETF/u.test(name) || (kind === "fund" && /ETF/.test(name))) {
      if (mv >= 0) etfLong += mv
      continue
    }
    if (kind === "derivative" && /^(IF|IH|IC|IM)/.test(symbol)) {
      if (mv >= 0) indexLong += Math.abs(mv)
      else indexShort += Math.abs(mv)
    }
  }

  const pct = (v: number) => (v / nav) * 100
  return {
    stockLongMv: stockLong,
    stockLongPct: pct(stockLong),
    stockShortMv: stockShort,
    stockShortPct: pct(stockShort),
    indexLongMv: indexLong,
    indexLongPct: pct(indexLong),
    indexShortMv: indexShort,
    indexShortPct: pct(indexShort),
    etfLongMv: etfLong,
    etfLongPct: pct(etfLong),
    totalExposurePct: pct(stockLong - stockShort + etfLong),
  }
}

function aggregateEquityAllocation(
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

  const settlement = aggregateMajorKind(holdings, "settlement_reserve")
  if (settlement > 0) {
    sums.set("bank_deposit", (sums.get("bank_deposit") ?? 0) + settlement)
  }

  const margin = aggregateMajorKind(holdings, "margin_deposit")
  if (margin > 0) sums.set("margin_deposit", margin)

  for (const h of holdings) {
    if (h.include_in_detail === false) continue
    const mv = rowMarketValue(h)
    if (mv <= 0) continue
    const kind = h.row_kind ?? "other"
    if (CASH_ROW_KINDS.has(kind)) continue

    if (isDirectEquityStock(h)) {
      sums.set("stock", (sums.get("stock") ?? 0) + mv)
    } else if (isBondHoldingRow(h)) {
      sums.set("bond", (sums.get("bond") ?? 0) + mv)
    } else if (isWealthHolding(h)) {
      sums.set("wealth", (sums.get("wealth") ?? 0) + mv)
    } else if (isUnderlyingFundInvestment(h) || kind === "derivative" || kind === "option") {
      continue
    } else {
      sums.set("other", (sums.get("other") ?? 0) + mv)
    }
  }

  const entries = EQUITY_ALLOCATION_ORDER
    .map((key) => [key, sums.get(key) ?? 0] as const)
    .filter(([, value]) => value > 0)

  const navBase = netAssetValue > 0
    ? netAssetValue
    : entries.reduce((s, [, v]) => s + v, 0)

  return entries.map(([key, value], i) => ({
    index: i + 1,
    category: EQUITY_ALLOCATION_LABELS[key],
    rowKind: key,
    value,
    pct: navBase > 0 ? (value / navBase) * 100 : 0,
  }))
}

function isEquityOtherHolding(h: HoldingRow): boolean {
  const kind = h.row_kind ?? "other"
  if (CASH_ROW_KINDS.has(kind)) return false
  if (isDirectEquityStock(h) || isBondHoldingRow(h) || isWealthHolding(h)) return false
  if (isUnderlyingFundInvestment(h)) return false
  if (kind === "derivative" || kind === "option") return false
  return Math.abs(rowMarketValue(h)) > 0
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
  if (
    isValuationClearingSubjectCode(h.subject_code)
    || isValuationClearingSubjectCode(h.original_subject_code)
  ) {
    return false
  }

  const kind = h.row_kind ?? "other"
  if (isCashLikeHoldingKind(kind)) return false
  if (["private_fund", "fund_or_stock", "fund", "money_fund", "stock"].includes(kind)) return true

  const code = String(h.subject_code ?? "").replace(/\s/g, "")
  if (code.startsWith("1109") || code.startsWith("1108")) return true
  const name = String(h.subject_name ?? "")
  if (/^银行存款|^结算备付金|^存出保证金/.test(name)) return false
  if (/私募证券投资基金|私募基金/.test(name)) return true
  if (kind === "other" && String(h.symbol ?? "").trim()) return true
  return false
}

function resolveHoldingValuationCode(h: HoldingRow): string | null {
  const name = String(h.subject_name ?? "")
  return resolveFundHoldingCode(
    String(h.subject_code ?? ""),
    name,
    h.symbol,
    h.original_subject_code,
  ) ?? extractListedFundCodeFromName(name)
}

function fundHoldingIdentityKey(h: HoldingRow): string | null {
  const code = resolveHoldingValuationCode(h)
    ?? String(h.symbol ?? "").trim().toUpperCase()
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

/** One row per underlying fund — same fund may split across 1109/1108/99/3003 科目. */
function dedupeFundHoldings(holdings: HoldingRow[]): HoldingRow[] {
  return mergeSameProductFundHoldings(holdings.filter(isFundHoldingMergeCandidate))
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
  const fundMv = sumHoldingMarketValue(holdings, isUnderlyingFundInvestment)
  const stockMv = sumHoldingMarketValue(holdings, isDirectEquityStock)
  const derivMv = sumHoldingMarketValue(
    holdings,
    (h) => (h.row_kind === "derivative" || isOptionHolding(h)),
  )

  if (fundMv > 0 && fundMv >= stockMv * 0.25) return "fof"
  if (derivMv > Math.max(stockMv, fundMv) && derivMv > 0) return "derivative"
  if (stockMv > 0 && fundMv < stockMv * 0.25) return "equity"
  if (fundMv > 0) return "fof"
  if (derivMv > 0) return "derivative"
  if (stockMv > 0) return "equity"
  return "derivative"
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

const MAX_DAILY_RETURN = 0.5

function calcPriceChangePct(decimal: number | null): number | null {
  if (decimal == null || !Number.isFinite(decimal)) return null
  if (Math.abs(decimal) > MAX_DAILY_RETURN) return null
  return decimal * 100
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

function extractSettlementStatus(extra: Record<string, unknown>, hasPrice: boolean): string {
  const raw = String(
    extra.settlement_status
    ?? extra.结算状态
    ?? extra.rights_info
    ?? extra.权益信息
    ?? extra.suspension_info
    ?? extra.停牌信息
    ?? "",
  ).trim()
  if (raw) return raw.startsWith("【") ? raw : `【${raw}】`
  return hasPrice ? "【正常交易】" : "【无行情】"
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

type EmailNavDetail = {
  unitNav: number | null
  cumulativeNav: number | null
  navDate: string
  priceChangePct?: number | null
}

async function loadListedFundMarketNavBatch(
  codes: string[],
  asOfDate: string,
): Promise<Map<string, EmailNavDetail>> {
  const out = new Map<string, EmailNavDetail>()
  const listedCodes = [...new Set(codes.filter(isListedFundCode))]
  if (listedCodes.length === 0) return out

  const tickerToCode = new Map<string, string>()
  const tickers: string[] = []
  for (const code of listedCodes) {
    for (const ticker of listedFundCodeToTickers(code)) {
      if (!tickerToCode.has(ticker)) {
        tickerToCode.set(ticker, code)
        tickers.push(ticker)
      }
    }
  }
  if (tickers.length === 0) return out

  const rows = await query<{ ticker: string; trade_date: string; value: string; field: string; rn: string }>(
    `WITH ranked AS (
       SELECT
         ticker,
         trade_date::text AS trade_date,
         value::text AS value,
         field,
         ROW_NUMBER() OVER (PARTITION BY ticker, field ORDER BY trade_date DESC) AS rn
       FROM raw_etf_daily
       WHERE ticker = ANY($1::text[])
         AND field IN ('ORIGINALUNIT', 'ACCUMULATEDUNIT', 'ACCUNIT')
         AND trade_date <= $2::date
         AND value IS NOT NULL
         AND value > 0
     )
     SELECT ticker, trade_date, value, field, rn::text AS rn
     FROM ranked
     WHERE rn <= 2`,
    [tickers, asOfDate],
  )

  const unitPointsByCode = new Map<string, Array<{ navDate: string; unitNav: number }>>()
  const cumByCode = new Map<string, number>()

  for (const row of rows) {
    const code = tickerToCode.get(row.ticker)
    if (!code) continue
    const value = parsePlausibleNav(row.value)
    if (value == null) continue
    const field = row.field.toUpperCase()
    if (field === "ORIGINALUNIT") {
      const list = unitPointsByCode.get(code) ?? []
      list.push({ navDate: row.trade_date.slice(0, 10), unitNav: value })
      unitPointsByCode.set(code, list)
    } else if ((field === "ACCUMULATEDUNIT" || field === "ACCUNIT") && !cumByCode.has(code)) {
      cumByCode.set(code, value)
    }
  }

  for (const code of listedCodes) {
    const points = (unitPointsByCode.get(code) ?? [])
      .sort((a, b) => b.navDate.localeCompare(a.navDate))
    const latest = points[0]
    if (!latest) continue
    const prev = points[1]
    let priceChangePct: number | null = null
    if (prev && prev.unitNav > 0) {
      priceChangePct = calcPriceChangePct(latest.unitNav / prev.unitNav - 1)
    }
    out.set(code, {
      unitNav: latest.unitNav,
      cumulativeNav: cumByCode.get(code) ?? latest.unitNav,
      navDate: latest.navDate,
      priceChangePct,
    })
  }

  const missing = listedCodes.filter((code) => !out.has(code))
  if (missing.length > 0) {
    const fetched = await fetchListedFundNavBatch(missing, asOfDate)
    for (const [code, detail] of fetched) {
      out.set(code, detail)
    }
  }

  return out
}

async function loadEmailNavDetailsBatch(
  beianCodes: string[],
  productNames: string[],
  asOfDate: string,
): Promise<Map<string, EmailNavDetail>> {
  const out = new Map<string, EmailNavDetail>()
  const sinceDate = asOfDate.slice(0, 10)
  const codes = [...new Set(beianCodes.map((c) => c.trim()).filter(Boolean))]
  if (codes.length > 0) {
    // Two points per code → daily涨跌幅 without BatchNavResolver full history.
    const rows = await query<{
      code: string
      nav_date: string
      nav: string
      cumulative_nav: string | null
      rn: string
    }>(
      `WITH ranked AS (
         SELECT
           BTRIM(product_code) AS code,
           nav_date::text AS nav_date,
           nav::text AS nav,
           cumulative_nav::text AS cumulative_nav,
           ROW_NUMBER() OVER (
             PARTITION BY BTRIM(product_code)
             ORDER BY nav_date DESC, id DESC
           ) AS rn
         FROM ops_email_nav_records
         WHERE BTRIM(product_code) = ANY($1::text[])
           AND nav IS NOT NULL
           AND nav_date <= $2::date
       )
       SELECT code, nav_date, nav, cumulative_nav, rn::text AS rn
       FROM ranked
       WHERE rn <= 2`,
      [codes, sinceDate],
    )
    const pointsByCode = new Map<string, Array<{ navDate: string; unitNav: number; cumulativeNav: number | null }>>()
    for (const r of rows) {
      const unitNav = parsePlausibleNav(r.nav)
      if (unitNav == null) continue
      const list = pointsByCode.get(r.code) ?? []
      list.push({
        navDate: r.nav_date.slice(0, 10),
        unitNav,
        cumulativeNav: parsePlausibleNav(r.cumulative_nav ?? ""),
      })
      pointsByCode.set(r.code, list)
    }
    for (const [code, points] of pointsByCode) {
      const sorted = points.sort((a, b) => b.navDate.localeCompare(a.navDate))
      const latest = sorted[0]
      const prev = sorted[1]
      let priceChangePct: number | null = null
      if (prev && prev.unitNav > 0) {
        priceChangePct = calcPriceChangePct(latest.unitNav / prev.unitNav - 1)
      }
      out.set(code, {
        unitNav: latest.unitNav,
        cumulativeNav: latest.cumulativeNav ?? latest.unitNav,
        navDate: latest.navDate,
        priceChangePct,
      })
    }
  }

  // Name join is expensive (ILIKE/regexp); only for identities that lack a code hit.
  const names = [...new Set(productNames.map((n) => n.trim()).filter(Boolean))]
    .filter((name) => !out.has(name))
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
  const sign = signedMv < 0 ? -1 : 1
  const computed = netAssetValue > 0 && Math.abs(signedMv) > 0
    ? (signedMv / netAssetValue) * 100
    : 0

  if (weightRaw === 0 || netAssetValue <= 0 || Math.abs(signedMv) <= 0) {
    return computed
  }

  const fromWeight = (Math.abs(weightRaw) <= 1 ? weightRaw * 100 : weightRaw) * sign
  const absFrom = Math.abs(fromWeight)
  const absComputed = Math.abs(computed)
  if (absComputed > 0) {
    const ratio = absFrom / absComputed
    // Guard against cost_weight mis-map or stale 估值表 pct columns (e.g. ETF rows).
    if (ratio > 3 || ratio < 1 / 3) return computed
  }
  return fromWeight
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
      const valuationCode = resolveHoldingValuationCode(h)
      const signedCost = parseNum(h.signed_cost) || parseNum(h.cost)
      const price = parseNum(h.price) || null
      return {
        fundName: fundHoldingDisplayName(h) || String(h.symbol ?? "").trim(),
        valuationCode,
        navDate: valuationDate?.slice(0, 10) ?? null,
        virtualUnitNav,
        unitNav: null as number | null,
        cumulativeNav: null as number | null,
        priceChangePct: null as number | null,
        price,
        marketValue: signedMv,
        marketPct: normalizeMarketWeightPct(parseNum(h.market_weight), signedMv, netAssetValue),
        shares: qty > 0 ? qty : null,
        cost: signedCost !== 0 ? signedCost : null,
        unrealizedPnl: parseNum(h.unrealized_pnl) || null,
        beianHao: valuationCode,
        rowKind: h.row_kind ?? "other",
        extra: h.extra ?? {},
      }
    })
    .filter((r) => r.fundName)
    .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue))

  if (fundRows.length === 0) return []

  // Resolve missing product codes once per unique name (no per-row resolveFundBeianHao).
  // Cap lookups — each name hits multiple fuzzy tables and can stack past statement_timeout.
  const nameCache = new Map<string, string | null>()
  const missingNames = [
    ...new Set(
      fundRows
        .filter((row) => !row.valuationCode)
        .map((row) => row.fundName)
        .filter(Boolean),
    ),
  ].slice(0, 20)
  const CODE_LOOKUP_CONCURRENCY = 4
  for (let i = 0; i < missingNames.length; i += CODE_LOOKUP_CONCURRENCY) {
    const chunk = missingNames.slice(i, i + CODE_LOOKUP_CONCURRENCY)
    await Promise.all(
      chunk.map(async (name) => {
        const listed = extractListedFundCodeFromName(name)
        if (listed) {
          nameCache.set(name, listed)
          return
        }
        nameCache.set(name, await lookupFundCodeByProductName(name))
      }),
    )
  }
  for (const row of fundRows) {
    if (row.valuationCode) continue
    const lookedUp = nameCache.get(row.fundName)
    if (lookedUp) {
      row.valuationCode = lookedUp
      row.beianHao = lookedUp
    }
  }

  const asOfDate = valuationDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  const beianCodes = fundRows.map((r) => r.beianHao).filter(Boolean) as string[]

  // Code-first loads avoid fuzzy name joins over the whole underlying book.
  const [strategyMap, emailNavMap, marketNavMap] = await Promise.all([
    loadCompanyStrategyBatch(beianCodes, []),
    loadEmailNavDetailsBatch(beianCodes, [], asOfDate),
    loadListedFundMarketNavBatch(beianCodes, asOfDate),
  ])

  // Cap fuzzy name joins — large FOF books time out on ILIKE/regexp joins.
  const NAME_JOIN_CAP = 12
  const namesNeedingStrategy = [
    ...new Set(
      fundRows
        .filter((row) => {
          const key = row.valuationCode ?? row.beianHao
          return !(key && strategyMap.has(key))
        })
        .map((row) => row.fundName),
    ),
  ].slice(0, NAME_JOIN_CAP)
  const namesNeedingNav = [
    ...new Set(
      fundRows
        .filter((row) => {
          const key = row.valuationCode ?? row.beianHao
          return !(key && emailNavMap.has(key))
        })
        .map((row) => row.fundName),
    ),
  ].slice(0, NAME_JOIN_CAP)

  if (namesNeedingStrategy.length > 0 || namesNeedingNav.length > 0) {
    const [strategyByName, emailByName] = await Promise.all([
      namesNeedingStrategy.length > 0
        ? loadCompanyStrategyBatch([], namesNeedingStrategy)
        : Promise.resolve(new Map()),
      namesNeedingNav.length > 0
        ? loadEmailNavDetailsBatch([], namesNeedingNav, asOfDate)
        : Promise.resolve(new Map()),
    ])
    for (const [key, value] of strategyByName) {
      if (!strategyMap.has(key)) strategyMap.set(key, value)
    }
    for (const [key, value] of emailByName) {
      if (!emailNavMap.has(key)) emailNavMap.set(key, value)
    }
  }

  return fundRows.map((row, i) => {
    const beianHao = row.beianHao ?? row.valuationCode
    const valuationCode = row.valuationCode ?? (isListedFundCode(beianHao) ? beianHao : null)
    const navKey = valuationCode ?? beianHao
    const emailNav = (navKey ? emailNavMap.get(navKey) : null)
      ?? emailNavMap.get(row.fundName)
    const marketNav = navKey ? marketNavMap.get(navKey) : null
    const officialNav = emailNav ?? marketNav

    let unitNav: number | null = null
    let cumulativeNav: number | null = null
    let navDate = row.navDate

    if (officialNav?.unitNav != null) {
      unitNav = officialNav.unitNav
      cumulativeNav = officialNav.cumulativeNav
      navDate = officialNav.navDate
    } else if (row.virtualUnitNav != null) {
      unitNav = row.virtualUnitNav
    }

    const strategyRow = (navKey ? strategyMap.get(navKey) : null)
      ?? strategyMap.get(row.fundName)
    const fundStrategy = formatFundStrategy(strategyRow?.l1, strategyRow?.l2)

    const hasOfficialNav = officialNav?.unitNav != null
      || (unitNav != null && unitNav !== row.virtualUnitNav)
    const suspensionInfo = extractSuspensionInfo(row.extra, hasOfficialNav)

    let priceChangePct: number | null = null
    if (officialNav?.priceChangePct != null) {
      priceChangePct = officialNav.priceChangePct
    } else if (marketNav?.priceChangePct != null) {
      priceChangePct = marketNav.priceChangePct
    }

    const hasMarketPrice = row.price != null && row.price > 0

    return {
      index: i + 1,
      fundName: row.fundName,
      valuationCode,
      fundStrategy,
      navDate,
      virtualUnitNav: row.virtualUnitNav,
      unitNav,
      cumulativeNav,
      priceChangePct,
      price: row.price,
      marketValue: row.marketValue,
      marketPct: row.marketPct,
      shares: row.shares,
      cost: row.cost,
      unrealizedPnl: row.unrealizedPnl,
      settlementStatus: extractSettlementStatus(row.extra, hasMarketPrice),
      suspensionInfo,
      beianHao,
      rowKind: row.rowKind,
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

async function loadEmailNavSeriesForHolding(
  holding: FundHoldingRow,
  from: string,
  to: string,
): Promise<Array<{ date: string; nav: number }>> {
  const codes = [...new Set(
    [holding.beianHao, holding.valuationCode]
      .map((c) => c?.trim())
      .filter(Boolean) as string[],
  )]

  if (codes.length > 0) {
    const rows = await query<{ nav_date: string; nav: string }>(
      `SELECT nav_date::text AS nav_date, nav::text AS nav
       FROM ops_email_nav_records
       WHERE BTRIM(product_code) = ANY($1::text[])
         AND nav_date >= $2::date
         AND nav_date <= $3::date
         AND nav IS NOT NULL
       ORDER BY nav_date ASC, id DESC`,
      [codes, from, to],
    )
    const points = rows
      .map((row) => {
        const nav = parsePlausibleNav(row.nav)
        if (nav == null) return null
        return { date: row.nav_date.slice(0, 10), nav }
      })
      .filter((p): p is { date: string; nav: number } => p != null)
    if (points.length > 0) return dedupeNavPointsByDate(points)
  }

  const name = holding.fundName.trim()
  if (!name) return []

  const rows = await query<{ nav_date: string; nav: string }>(
    `SELECT nav_date::text AS nav_date, nav::text AS nav
     FROM ops_email_nav_records
     WHERE ${sqlFundNameMatch("fund_name", "$1")}
       AND nav_date >= $2::date
       AND nav_date <= $3::date
       AND nav IS NOT NULL
     ORDER BY nav_date ASC, id DESC`,
    [name, from, to],
  )

  return dedupeNavPointsByDate(
    rows
      .map((row) => {
        const nav = parsePlausibleNav(row.nav)
        if (nav == null) return null
        return { date: row.nav_date.slice(0, 10), nav }
      })
      .filter((p): p is { date: string; nav: number } => p != null),
  )
}

async function loadNavSeriesForHolding(
  holding: FundHoldingRow,
  from: string,
  to: string,
): Promise<Array<{ date: string; nav: number }>> {
  const lookupId = holding.beianHao ?? holding.valuationCode ?? holding.fundName
  if (!lookupId) return []

  const names = await resolveFundNames(lookupId, holding.fundName)
  const navRows = await loadFundNavSeries(
    lookupId,
    names.product_name,
    names.short_name ?? "",
    { from, to },
  )
  if (navRows.length < 1) return []

  return navRows
    .map((point) => {
      const nav = parseFloat(point.level)
      if (!Number.isFinite(nav) || nav <= 0) return null
      return { date: point.price_date.slice(0, 10), nav }
    })
    .filter((p): p is { date: string; nav: number } => p != null)
}

function extractNavFromFundHolding(h: HoldingRow): number | null {
  const signedMv = parseNum(h.signed_market_value) || parseNum(h.market_value)
  return parsePlausibleNav(h.price) ?? deriveNavFromShares(h.quantity, signedMv)
}

function dedupeNavPointsByDate(
  points: Array<{ date: string; nav: number }>,
): Array<{ date: string; nav: number }> {
  const byDate = new Map<string, number>()
  for (const p of points) {
    byDate.set(p.date.slice(0, 10), p.nav)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, nav]) => ({ date, nav }))
}

function normalizeFundDisplayName(fundName: string): string {
  return fundName
    .replace(/私募证券投资基金/g, "")
    .replace(/私募基金/g, "")
    .trim() || fundName
}

function fundHoldingRowLookupKeys(row: FundHoldingRow): string[] {
  const keys = new Set<string>()
  if (row.beianHao) keys.add(`code:${row.beianHao.trim().toUpperCase()}`)
  if (row.valuationCode) keys.add(`code:${row.valuationCode.trim().toUpperCase()}`)
  keys.add(`name:${row.fundName.trim()}`)
  keys.add(`name:${normalizeFundDisplayName(row.fundName)}`)
  return [...keys]
}

function snapshotHoldingLookupKeys(h: HoldingRow): string[] {
  const keys = new Set<string>()
  const identityKey = fundHoldingIdentityKey(h)
  if (identityKey) keys.add(identityKey)
  const code = String(h.symbol ?? h.subject_code ?? "").trim().toUpperCase()
  if (code) keys.add(`code:${code}`)
  const name = fundHoldingDisplayName(h)
  if (name) {
    keys.add(`name:${name}`)
    keys.add(`name:${normalizeFundDisplayName(name)}`)
  }
  return [...keys]
}

function resolveSnapshotNavPoints(
  holding: FundHoldingRow,
  pointsByKey: Map<string, Array<{ date: string; nav: number }>>,
): Array<{ date: string; nav: number }> {
  let best: Array<{ date: string; nav: number }> = []
  for (const key of fundHoldingRowLookupKeys(holding)) {
    const points = pointsByKey.get(key)
    if (points && points.length > best.length) {
      best = dedupeNavPointsByDate(points)
    }
  }
  return best
}

async function buildUnderlyingReturnCurves(
  rawBeianHao: string,
  fundHoldings: FundHoldingRow[],
  fromDate: string | null,
  toDate: string | null,
): Promise<ReturnCurveSeries[]> {
  if (fundHoldings.length === 0) return []

  const to = toDate?.slice(0, 10)
    ?? fundHoldings.find((h) => h.navDate)?.navDate?.slice(0, 10)
    ?? new Date().toISOString().slice(0, 10)
  const defaultFrom = new Date(`${to}T12:00:00`)
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1)
  const from = fromDate?.slice(0, 10) ?? defaultFrom.toISOString().slice(0, 10)

  const snapshots = await loadFundValuationTrendSnapshots(rawBeianHao, from, to)
  const pointsByKey = new Map<string, Array<{ date: string; nav: number }>>()

  for (const snapshot of snapshots) {
    for (const h of dedupeFundHoldings(snapshot.holdings)) {
      const nav = extractNavFromFundHolding(h)
      if (nav == null) continue
      const date = snapshot.date.slice(0, 10)
      for (const key of snapshotHoldingLookupKeys(h)) {
        const list = pointsByKey.get(key) ?? []
        list.push({ date, nav })
        pointsByKey.set(key, list)
      }
    }
  }

  const tasks = fundHoldings.map(async (holding) => {
    const displayName = normalizeFundDisplayName(holding.fundName)
    let navPoints = resolveSnapshotNavPoints(holding, pointsByKey)

    if (navPoints.length < 2) {
      const emailFallback = await loadEmailNavSeriesForHolding(holding, from, to)
      if (emailFallback.length >= navPoints.length) {
        navPoints = emailFallback
      }
    }

    if (navPoints.length < 2) {
      const fallback = await loadNavSeriesForHolding(holding, from, to)
      if (fallback.length >= navPoints.length) {
        navPoints = dedupeNavPointsByDate(fallback)
      }
    }

    const baseNav = navPoints[0]?.nav ?? 0
    const points: ReturnCurvePoint[] = navPoints.map((p) => ({
      date: p.date,
      nav: p.nav,
      returnPct: baseNav > 0 ? (p.nav / baseNav - 1) * 100 : 0,
    }))

    return {
      fundName: holding.fundName,
      displayName,
      beianHao: holding.beianHao,
      valuationCode: holding.valuationCode,
      points,
    } satisfies ReturnCurveSeries
  })

  return Promise.all(tasks)
}

export async function getFundValuationAllocation(
  rawBeianHao: string,
  mode: AllocationMode = "major",
  fetchOptions?: { includeReturnCurves?: boolean; curvesFrom?: string; curvesTo?: string },
): Promise<FundValuationAllocationResult> {
  const includeReturnCurves = fetchOptions?.includeReturnCurves ?? false
  const curvesFrom = fetchOptions?.curvesFrom ?? null
  const curvesTo = fetchOptions?.curvesTo ?? null

  // ── Serve from pre-computed cache when possible ───────────────────────────
  if (mode === "major") {
    if (!includeReturnCurves) {
      const cached = await readValuationCacheIfFresh<FundValuationAllocationResult>(
        rawBeianHao,
        "snapshot",
      )
      if (cached) return sanitizeAllocationDisplayNames(cached)
    } else if (curvesFrom && curvesTo) {
      // Curves request: try combining cached snapshot + cached curves
      const [snapshot, curves] = await Promise.all([
        readValuationCacheIfFresh<FundValuationAllocationResult>(rawBeianHao, "snapshot"),
        readValuationCacheIfFresh<ReturnCurveSeries[]>(rawBeianHao, "curves", {
          fromDate: curvesFrom,
          toDate: curvesTo,
        }),
      ])
      if (snapshot && curves) {
        return sanitizeAllocationDisplayNames({ ...snapshot, return_curves: curves })
      }
      if (snapshot) return sanitizeAllocationDisplayNames(snapshot)
    }
  }

  const beian_hao = await resolveRouteFundIdFast(rawBeianHao)
  const product_name = await resolveFundName(beian_hao)

  const candidateCodes = new Set<string>([beian_hao])
  const remapped = remapManagedProductBeianCode(beian_hao)
  if (remapped) candidateCodes.add(remapped)
  const override = lookupManagedProductOverride(beian_hao)
  if (override?.beian_hao) candidateCodes.add(override.beian_hao)

  const fundMetaPromise = resolveFundMeta(beian_hao, product_name, { includeLatestNav: false })

  let metrics: Awaited<ReturnType<typeof listFundMetricsLatest>>[number] | null = null
  let holdings: Awaited<ReturnType<typeof listFundLatestValuationHoldings>>["holdings"] = []
  let match_method: string | null = null
  let matchedCode: string | null = null
  let matchedFundName: string | null = null

  const candidateHits = await Promise.all(
    [...candidateCodes].map(async (code) => {
      const [mRows, hResult] = await Promise.all([
        listFundMetricsLatest({ productCode: code }),
        listFundLatestValuationHoldings({
          productCode: code,
          includeAnalysisOnly: false,
          limit: 2000,
          skipTotal: true,
        }),
      ])
      return {
        code,
        metrics: mRows[0] ?? null,
        holdings: hResult.holdings,
      }
    }),
  )
  const codeHit = candidateHits.find((hit) => hit.metrics || hit.holdings.length > 0)
  if (codeHit) {
    metrics = codeHit.metrics
    holdings = codeHit.holdings
    match_method = "product_code"
    matchedCode = codeHit.code
    matchedFundName = codeHit.metrics?.fund_name ?? codeHit.holdings[0]?.fund_name ?? null
  }

  if (!metrics && holdings.length === 0 && product_name) {
    const [mRows, hResult] = await Promise.all([
      listFundMetricsLatest({ fundName: product_name }),
      listFundLatestValuationHoldings({
        fundName: product_name,
        includeAnalysisOnly: false,
        limit: 2000,
        skipTotal: true,
      }),
    ])
    metrics = mRows[0] ?? null
    holdings = hResult.holdings
    if (metrics || holdings.length > 0) {
      match_method = "fund_name"
      matchedFundName = metrics?.fund_name ?? holdings[0]?.fund_name ?? product_name
      matchedCode = metrics?.product_code ?? holdings[0]?.product_code ?? null
    }
  }

  const fundMeta = await fundMetaPromise

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
  let allocation = layout_type === "fof"
    ? aggregateFofAllocation(holdings, net_asset_value, custody_balance)
    : layout_type === "equity"
      ? aggregateEquityAllocation(holdings, net_asset_value, custody_balance)
      : buildAllocation(sums, net_asset_value)

  // FOF: major-kind NAV fallback is cash-only; prefer sum of FOF allocation buckets.
  if (
    layout_type === "fof"
    && !(metrics && parseNum(metrics.net_asset_value) > 0)
    && allocation.length > 0
  ) {
    const allocNav = allocation.reduce((s, row) => s + row.value, 0)
    if (allocNav > 0) {
      net_asset_value = allocNav
      allocation = aggregateFofAllocation(holdings, net_asset_value, custody_balance)
    }
  }

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
  const stock_holdings = layout_type === "equity"
    ? buildEquityDetailHoldings(holdings, net_asset_value, isDirectEquityStock)
    : []
  const bond_holdings = layout_type === "equity"
    ? buildEquityDetailHoldings(holdings, net_asset_value, isBondHoldingRow)
    : []
  const wealth_holdings = layout_type === "equity"
    ? buildEquityDetailHoldings(holdings, net_asset_value, isWealthHolding)
    : []
  const equity_other_holdings = layout_type === "equity"
    ? buildEquityDetailHoldings(holdings, net_asset_value, isEquityOtherHolding)
    : []
  const stock_risk_exposure = layout_type === "equity"
    ? buildStockRiskExposure(holdings, net_asset_value)
    : null
  const other_holdings = layout_type === "fof"
    ? buildOtherHoldings(holdings, net_asset_value)
    : []
  const return_curves = layout_type === "fof" && includeReturnCurves
    ? await buildUnderlyingReturnCurves(
      rawBeianHao,
      fund_holdings,
      curvesFrom ?? null,
      curvesTo ?? valuation_date,
    )
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

  const result = {
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
    stock_holdings,
    bond_holdings,
    wealth_holdings,
    equity_other_holdings,
    stock_risk_exposure,
    return_curves,
    other_holdings,
    derivatives,
    derivative_sector_shares,
    options: derivativeOptions,
    greek_letters,
    term_analysis,
    has_data: allocation.length > 0
      || fund_holdings.length > 0
      || stock_holdings.length > 0
      || derivatives.length > 0,
    match_method,
  }

  const sanitized = sanitizeAllocationDisplayNames(result)

  if (mode === "major" && !includeReturnCurves && sanitized.has_data) {
    void cacheFreshValuationSnapshot(rawBeianHao, sanitized)
  }

  return sanitized
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

export type SectorWeightTrendSeries = {
  sector: string
  values: number[]
}

export type SectorWeightTrendResult = {
  dates: string[]
  speculation: SectorWeightTrendSeries[]
  hedging: SectorWeightTrendSeries[]
  has_data: boolean
  point_count: number
}

export type ValuationTrendAnalysisResult = AllocationTrendResult & {
  sector_trend: SectorWeightTrendResult
  long_short_trend: LongShortMvTrendResult
  contract_mv_trend: ContractMvShareTrendResult
  contract_equity_trend: ContractEquityTrendResult
  fof_trend: FofTrendAnalysisResult | null
}

export type ContractMvShareSeries = {
  contract: string
  sector: string
  values: number[]
}

export type ContractMvShareTrendResult = {
  dates: string[]
  series: ContractMvShareSeries[]
  has_data: boolean
  point_count: number
}

export type ContractEquityTrendResult = {
  dates: string[]
  speculation: ContractMvShareSeries[]
  hedging: ContractMvShareSeries[]
  has_data: boolean
  point_count: number
}

export type FofShareTrendSeries = {
  name: string
  values: number[]
}

export type FofShareTrendResult = {
  dates: string[]
  series: FofShareTrendSeries[]
  has_data: boolean
  point_count: number
}

export type FofTrendAnalysisResult = {
  underlying_trend: FofShareTrendResult
  strategy_trend: FofShareTrendResult
  month_end_underlying: FofShareTrendResult
  month_end_strategy: FofShareTrendResult
}

export type LongShortMvTrendPoint = {
  longPct: number
  shortPct: number
  netPct: number
}

export type LongShortMvTrendResult = {
  dates: string[]
  speculation: LongShortMvTrendPoint[]
  hedging: LongShortMvTrendPoint[]
  has_data: boolean
  point_count: number
}

const SECTOR_TREND_ORDER = ["股指", "国债", "黑色", "有色", "能化", "农产"] as const

type ValuationTrendSnapshot = {
  date: string
  holdings: HoldingRow[]
  netAssetValue: number
  custodyBalance: number
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
    : layout_type === "equity"
      ? aggregateEquityAllocation(holdings, nav, custodyBalance)
      : buildAllocation(sums, nav)
}

function sectorWeightPctByMode(
  shares: DerivativeSectorShareRow[],
  mode: "speculation" | "hedging",
): Map<string, number> {
  const weights = new Map<string, number>()
  for (const sector of SECTOR_TREND_ORDER) {
    const row = shares.find((s) => s.sector === sector)
    if (!row) {
      weights.set(sector, 0)
      continue
    }
    weights.set(
      sector,
      mode === "speculation"
        ? row.longMarketValue + row.shortMarketValue
        : Math.abs(row.netMarketValue),
    )
  }
  const total = [...weights.values()].reduce((sum, v) => sum + v, 0)
  if (total <= 0) return weights
  for (const [sector, value] of weights) {
    weights.set(sector, (value / total) * 100)
  }
  return weights
}

function buildSectorWeightTrend(
  snapshots: ValuationTrendSnapshot[],
): SectorWeightTrendResult {
  const empty: SectorWeightTrendResult = {
    dates: [],
    speculation: [],
    hedging: [],
    has_data: false,
    point_count: 0,
  }
  if (snapshots.length === 0) return empty

  const datedSnapshots: Array<{
    date: string
    speculation: Map<string, number>
    hedging: Map<string, number>
  }> = []

  for (const snapshot of snapshots) {
    const derivatives = buildDerivatives(snapshot.holdings, snapshot.netAssetValue)
    if (derivatives.length === 0) continue
    const shares = buildDerivativeSectorShares(derivatives, snapshot.netAssetValue)
    datedSnapshots.push({
      date: snapshot.date,
      speculation: sectorWeightPctByMode(shares, "speculation"),
      hedging: sectorWeightPctByMode(shares, "hedging"),
    })
  }

  if (datedSnapshots.length === 0) return empty

  const dates = datedSnapshots.map((s) => s.date)
  const buildSeries = (mode: "speculation" | "hedging"): SectorWeightTrendSeries[] =>
    SECTOR_TREND_ORDER.map((sector) => ({
      sector,
      values: datedSnapshots.map((snapshot) => +(snapshot[mode].get(sector) ?? 0).toFixed(4)),
    }))

  const speculation = buildSeries("speculation")
  const hedging = buildSeries("hedging")

  return {
    dates,
    speculation,
    hedging,
    has_data: speculation.some((s) => s.values.some((v) => v > 0)),
    point_count: dates.length,
  }
}

function filterDerivativesByPositionMode(
  derivatives: DerivativeRow[],
  mode: "speculation" | "hedging",
): DerivativeRow[] {
  if (mode === "speculation") return derivatives
  return derivatives.filter((d) => d.sector === "股指" || d.sector === "国债")
}

function computeLongShortMvPct(
  derivatives: DerivativeRow[],
  netAssetValue: number,
): LongShortMvTrendPoint {
  const navBase = netAssetValue > 0 ? netAssetValue : 1
  let longTotal = 0
  let shortTotal = 0
  for (const d of derivatives) {
    const absMv = Math.abs(d.marketValue)
    if (d.direction === "short") shortTotal += absMv
    else longTotal += absMv
  }
  const longPct = (longTotal / navBase) * 100
  const shortPct = (shortTotal / navBase) * 100
  return {
    longPct,
    shortPct: -shortPct,
    netPct: longPct - shortPct,
  }
}

function buildLongShortMvTrend(
  snapshots: ValuationTrendSnapshot[],
): LongShortMvTrendResult {
  const empty: LongShortMvTrendResult = {
    dates: [],
    speculation: [],
    hedging: [],
    has_data: false,
    point_count: 0,
  }
  if (snapshots.length === 0) return empty

  const datedSnapshots: Array<{
    date: string
    speculation: LongShortMvTrendPoint
    hedging: LongShortMvTrendPoint
  }> = []

  for (const snapshot of snapshots) {
    const derivatives = buildDerivatives(snapshot.holdings, snapshot.netAssetValue)
    if (derivatives.length === 0) continue
    datedSnapshots.push({
      date: snapshot.date,
      speculation: computeLongShortMvPct(
        filterDerivativesByPositionMode(derivatives, "speculation"),
        snapshot.netAssetValue,
      ),
      hedging: computeLongShortMvPct(
        filterDerivativesByPositionMode(derivatives, "hedging"),
        snapshot.netAssetValue,
      ),
    })
  }

  if (datedSnapshots.length === 0) return empty

  return {
    dates: datedSnapshots.map((s) => s.date),
    speculation: datedSnapshots.map((s) => s.speculation),
    hedging: datedSnapshots.map((s) => s.hedging),
    has_data: datedSnapshots.some((s) => s.speculation.longPct > 0 || s.speculation.shortPct < 0),
    point_count: datedSnapshots.length,
  }
}

function derivativeContractLabel(row: DerivativeRow): string {
  const name = row.contractName?.trim()
  if (name) return name
  return row.symbol?.trim() ?? ""
}

function buildContractMvShareTrend(
  snapshots: ValuationTrendSnapshot[],
): ContractMvShareTrendResult {
  const empty: ContractMvShareTrendResult = {
    dates: [],
    series: [],
    has_data: false,
    point_count: 0,
  }
  if (snapshots.length === 0) return empty

  const datedMaps: Array<{ date: string; weights: Map<string, { pct: number; sector: string }> }> = []

  for (const snapshot of snapshots) {
    const derivatives = buildDerivatives(snapshot.holdings, snapshot.netAssetValue)
    if (derivatives.length === 0) continue

    const navBase = snapshot.netAssetValue > 0 ? snapshot.netAssetValue : 1
    const weights = new Map<string, { pct: number; sector: string }>()
    for (const d of derivatives) {
      const key = derivativeContractLabel(d)
      if (!key) continue
      const pct = (Math.abs(d.marketValue) / navBase) * 100
      const prev = weights.get(key)
      if (prev) {
        weights.set(key, { pct: prev.pct + pct, sector: prev.sector || d.sector })
      } else {
        weights.set(key, { pct, sector: d.sector })
      }
    }
    if (weights.size === 0) continue
    datedMaps.push({ date: snapshot.date, weights })
  }

  if (datedMaps.length === 0) return empty

  const contractMeta = new Map<string, { sector: string; total: number }>()
  for (const { weights } of datedMaps) {
    for (const [contract, { pct, sector }] of weights) {
      const meta = contractMeta.get(contract) ?? { sector, total: 0 }
      meta.total += pct
      if (sector && sector !== "其他") meta.sector = sector
      contractMeta.set(contract, meta)
    }
  }

  const sortedContracts = [...contractMeta.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([contract, meta]) => ({ contract, sector: meta.sector }))

  const dates = datedMaps.map((d) => d.date)
  const series: ContractMvShareSeries[] = sortedContracts.map(({ contract, sector }) => ({
    contract,
    sector,
    values: datedMaps.map(({ weights }) => +(weights.get(contract)?.pct ?? 0).toFixed(4)),
  }))

  return {
    dates,
    series,
    has_data: series.some((s) => s.values.some((v) => v > 0)),
    point_count: dates.length,
  }
}

function buildContractSignedWeights(
  derivatives: DerivativeRow[],
  netAssetValue: number,
): Map<string, { pct: number; sector: string }> {
  const navBase = netAssetValue > 0 ? netAssetValue : 1
  const weights = new Map<string, { pct: number; sector: string }>()
  for (const d of derivatives) {
    const key = derivativeContractLabel(d)
    if (!key) continue
    const pct = (d.marketValue / navBase) * 100
    const prev = weights.get(key)
    if (prev) {
      weights.set(key, { pct: prev.pct + pct, sector: prev.sector || d.sector })
    } else {
      weights.set(key, { pct, sector: d.sector })
    }
  }
  return weights
}

function buildContractEquitySeriesForMode(
  datedMaps: Array<{ date: string; weights: Map<string, { pct: number; sector: string }> }>,
): ContractMvShareSeries[] {
  const contractMeta = new Map<string, { sector: string; total: number }>()
  for (const { weights } of datedMaps) {
    for (const [contract, { pct, sector }] of weights) {
      const meta = contractMeta.get(contract) ?? { sector, total: 0 }
      meta.total += Math.abs(pct)
      if (sector && sector !== "其他") meta.sector = sector
      contractMeta.set(contract, meta)
    }
  }

  const sortedContracts = [...contractMeta.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([contract, meta]) => ({ contract, sector: meta.sector }))

  return sortedContracts.map(({ contract, sector }) => ({
    contract,
    sector,
    values: datedMaps.map(({ weights }) => +(weights.get(contract)?.pct ?? 0).toFixed(4)),
  }))
}

function buildContractEquityTrend(
  snapshots: ValuationTrendSnapshot[],
): ContractEquityTrendResult {
  const empty: ContractEquityTrendResult = {
    dates: [],
    speculation: [],
    hedging: [],
    has_data: false,
    point_count: 0,
  }
  if (snapshots.length === 0) return empty

  const speculationMaps: Array<{ date: string; weights: Map<string, { pct: number; sector: string }> }> = []
  const hedgingMaps: Array<{ date: string; weights: Map<string, { pct: number; sector: string }> }> = []

  for (const snapshot of snapshots) {
    const derivatives = buildDerivatives(snapshot.holdings, snapshot.netAssetValue)
    if (derivatives.length === 0) continue

    const specWeights = buildContractSignedWeights(
      filterDerivativesByPositionMode(derivatives, "speculation"),
      snapshot.netAssetValue,
    )
    if (specWeights.size > 0) {
      speculationMaps.push({ date: snapshot.date, weights: specWeights })
    }

    const hedgeWeights = buildContractSignedWeights(
      filterDerivativesByPositionMode(derivatives, "hedging"),
      snapshot.netAssetValue,
    )
    if (hedgeWeights.size > 0) {
      hedgingMaps.push({ date: snapshot.date, weights: hedgeWeights })
    }
  }

  const dates = [...new Set([
    ...speculationMaps.map((d) => d.date),
    ...hedgingMaps.map((d) => d.date),
  ])].sort()

  if (dates.length === 0) return empty

  const alignMaps = (
    maps: Array<{ date: string; weights: Map<string, { pct: number; sector: string }> }>,
  ) => {
    const byDate = new Map(maps.map((d) => [d.date, d.weights]))
    return dates.map((date) => ({ date, weights: byDate.get(date) ?? new Map() }))
  }

  const speculation = buildContractEquitySeriesForMode(alignMaps(speculationMaps))
  const hedging = buildContractEquitySeriesForMode(alignMaps(hedgingMaps))

  const hasValues = (series: ContractMvShareSeries[]) =>
    series.some((s) => s.values.some((v) => Math.abs(v) > 0.001))

  return {
    dates,
    speculation,
    hedging,
    has_data: hasValues(speculation) || hasValues(hedging),
    point_count: dates.length,
  }
}

function fundHoldingDisplayName(h: HoldingRow): string {
  return stripValuationSubjectPathPrefix(String(h.subject_name ?? h.symbol ?? ""))
}

function sanitizeAllocationDisplayNames(
  result: FundValuationAllocationResult,
): FundValuationAllocationResult {
  if (!result.fund_holdings?.length) return result
  const fund_holdings = result.fund_holdings
    .filter((h) => !isCashLikeHoldingKind(h.rowKind) && !isValuationCashHoldingName(h.fundName))
    .map((h, i) => {
      const fundName = stripValuationSubjectPathPrefix(h.fundName) || h.fundName
      return { ...h, index: i + 1, fundName }
    })
  return { ...result, fund_holdings }
}

function fundHoldingBeianCode(h: HoldingRow): string | null {
  const code = String(h.symbol ?? "").trim().toUpperCase()
  return code || null
}

function extractUnderlyingFundWeights(
  holdings: HoldingRow[],
  netAssetValue: number,
): Map<string, number> {
  const navBase = netAssetValue > 0 ? netAssetValue : 1
  const weights = new Map<string, number>()
  for (const h of dedupeFundHoldings(holdings)) {
    const name = fundHoldingDisplayName(h)
    if (!name) continue
    const mv = rowMarketValue(h)
    if (mv <= 0) continue
    weights.set(name, (weights.get(name) ?? 0) + (mv / navBase) * 100)
  }
  return weights
}

function extractStrategyFundWeights(
  holdings: HoldingRow[],
  netAssetValue: number,
  strategyMap: Map<string, CompanyStrategyRow>,
): Map<string, number> {
  const navBase = netAssetValue > 0 ? netAssetValue : 1
  const weights = new Map<string, number>()
  for (const h of dedupeFundHoldings(holdings)) {
    const mv = rowMarketValue(h)
    if (mv <= 0) continue
    const beian = fundHoldingBeianCode(h)
    const name = fundHoldingDisplayName(h)
    const strategyRow = (beian ? strategyMap.get(beian) : null) ?? strategyMap.get(name)
    const label = formatFundStrategy(strategyRow?.l1, strategyRow?.l2) ?? "未配置"
    weights.set(label, (weights.get(label) ?? 0) + (mv / navBase) * 100)
  }
  return weights
}

function buildFofShareSeriesFromMaps(
  datedMaps: Array<{ date: string; weights: Map<string, number> }>,
): FofShareTrendSeries[] {
  const nameMeta = new Map<string, number>()
  for (const { weights } of datedMaps) {
    for (const [name, pct] of weights) {
      nameMeta.set(name, (nameMeta.get(name) ?? 0) + Math.abs(pct))
    }
  }

  const sortedNames = [...nameMeta.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)

  return sortedNames.map((name) => ({
    name,
    values: datedMaps.map(({ weights }) => +(weights.get(name) ?? 0).toFixed(4)),
  }))
}

function emptyFofShareTrend(): FofShareTrendResult {
  return { dates: [], series: [], has_data: false, point_count: 0 }
}

function finalizeFofShareTrend(
  dates: string[],
  series: FofShareTrendSeries[],
): FofShareTrendResult {
  return {
    dates,
    series,
    has_data: series.some((s) => s.values.some((v) => v > 0.001)),
    point_count: dates.length,
  }
}

function pickMonthEndDates(dates: string[]): string[] {
  const byMonth = new Map<string, string>()
  for (const d of dates) {
    byMonth.set(d.slice(0, 7), d)
  }
  return [...byMonth.values()].sort()
}

async function buildFofTrendAnalysis(
  snapshots: ValuationTrendSnapshot[],
): Promise<FofTrendAnalysisResult | null> {
  const fofSnapshots = snapshots.filter(
    (s) => detectValuationLayoutType(s.holdings) === "fof",
  )
  if (fofSnapshots.length === 0) return null

  const beianCodes: string[] = []
  const productNames: string[] = []
  for (const snapshot of fofSnapshots) {
    for (const h of dedupeFundHoldings(snapshot.holdings)) {
      const code = fundHoldingBeianCode(h)
      const name = fundHoldingDisplayName(h)
      if (code) beianCodes.push(code)
      if (name) productNames.push(name)
    }
  }

  const strategyMap = await loadCompanyStrategyBatch(beianCodes, productNames)

  const underlyingMaps: Array<{ date: string; weights: Map<string, number> }> = []
  const strategyMaps: Array<{ date: string; weights: Map<string, number> }> = []

  for (const snapshot of fofSnapshots) {
    const underlying = extractUnderlyingFundWeights(snapshot.holdings, snapshot.netAssetValue)
    if (underlying.size === 0) continue
    underlyingMaps.push({ date: snapshot.date, weights: underlying })
    strategyMaps.push({
      date: snapshot.date,
      weights: extractStrategyFundWeights(snapshot.holdings, snapshot.netAssetValue, strategyMap),
    })
  }

  if (underlyingMaps.length === 0) {
    return {
      underlying_trend: emptyFofShareTrend(),
      strategy_trend: emptyFofShareTrend(),
      month_end_underlying: emptyFofShareTrend(),
      month_end_strategy: emptyFofShareTrend(),
    }
  }

  const dates = underlyingMaps.map((d) => d.date)
  const monthEndDates = pickMonthEndDates(dates)
  const filterMonthEnd = (
    maps: Array<{ date: string; weights: Map<string, number> }>,
  ) => maps.filter((m) => monthEndDates.includes(m.date))

  const underlyingSeries = buildFofShareSeriesFromMaps(underlyingMaps)
  const strategySeries = buildFofShareSeriesFromMaps(strategyMaps)
  const monthEndUnderlyingMaps = filterMonthEnd(underlyingMaps)
  const monthEndStrategyMaps = filterMonthEnd(strategyMaps)

  return {
    underlying_trend: finalizeFofShareTrend(dates, underlyingSeries),
    strategy_trend: finalizeFofShareTrend(dates, strategySeries),
    month_end_underlying: finalizeFofShareTrend(
      monthEndDates,
      buildFofShareSeriesFromMaps(monthEndUnderlyingMaps),
    ),
    month_end_strategy: finalizeFofShareTrend(
      monthEndDates,
      buildFofShareSeriesFromMaps(monthEndStrategyMaps),
    ),
  }
}

async function loadFundValuationTrendSnapshots(
  rawBeianHao: string,
  fromDate: string,
  toDate: string,
): Promise<ValuationTrendSnapshot[]> {
  const from = fromDate.slice(0, 10)
  const to = toDate.slice(0, 10)
  if (!from || !to || from > to) return []

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
      [`%${product_name.trim()}%`, from, to],
    )
  }

  if (records.length === 0) return []

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

  const snapshots: ValuationTrendSnapshot[] = []
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

    snapshots.push({
      date: record.valuation_date.slice(0, 10),
      holdings,
      netAssetValue: parseNum(record.net_asset_value),
      custodyBalance: parseNum(record.custody_balance),
    })
  }

  return snapshots
}

function buildAllocationTrendFromSnapshots(
  snapshots: ValuationTrendSnapshot[],
  mode: AllocationMode,
): AllocationTrendResult {
  const empty: AllocationTrendResult = {
    dates: [],
    series: [],
    has_data: false,
    point_count: 0,
  }

  const allocationSnapshots: { date: string; allocation: AllocationRow[] }[] = []
  for (const snapshot of snapshots) {
    const allocation = computeSnapshotAllocation(
      snapshot.holdings,
      mode,
      snapshot.custodyBalance,
      snapshot.netAssetValue,
    )
    if (allocation.length === 0) continue
    allocationSnapshots.push({ date: snapshot.date, allocation })
  }

  if (allocationSnapshots.length === 0) return empty

  const dates = allocationSnapshots.map((s) => s.date)
  const categoryOrder = new Map<string, { rowKind: string; order: number }>()
  let orderIdx = 0

  for (const snapshot of allocationSnapshots) {
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
    values: allocationSnapshots.map((snapshot) => {
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

export async function getFundValuationTrendAnalysis(
  rawBeianHao: string,
  fromDate: string,
  toDate: string,
  mode: AllocationMode = "major",
): Promise<ValuationTrendAnalysisResult> {
  // ── Serve from pre-computed cache when possible ───────────────────────────
  if (mode === "major") {
    const cached = await readValuationCacheIfFresh<ValuationTrendAnalysisResult>(
      rawBeianHao,
      "trend",
      { fromDate, toDate },
    )
    if (cached) return cached
  }

  const snapshots = await loadFundValuationTrendSnapshots(rawBeianHao, fromDate, toDate)
  const fof_trend = await buildFofTrendAnalysis(snapshots)
  return {
    ...buildAllocationTrendFromSnapshots(snapshots, mode),
    sector_trend: buildSectorWeightTrend(snapshots),
    long_short_trend: buildLongShortMvTrend(snapshots),
    contract_mv_trend: buildContractMvShareTrend(snapshots),
    contract_equity_trend: buildContractEquityTrend(snapshots),
    fof_trend,
  }
}

export async function getFundAllocationTrend(
  rawBeianHao: string,
  fromDate: string,
  toDate: string,
  mode: AllocationMode = "major",
): Promise<AllocationTrendResult> {
  const snapshots = await loadFundValuationTrendSnapshots(rawBeianHao, fromDate, toDate)
  return buildAllocationTrendFromSnapshots(snapshots, mode)
}

async function enrichCandidateCodesFromValuationHistory(
  candidateCodes: Set<string>,
  productName: string | null,
): Promise<void> {
  if (!productName?.trim()) return
  await ensureEmailValuationTable()
  const rows = await query<{ product_code: string }>(
    `SELECT DISTINCT BTRIM(product_code) AS product_code
     FROM ops_email_valuation_records
     WHERE BTRIM(COALESCE(product_code, '')) <> ''
       AND ${sqlFundNameMatch("fund_name", "$1")}
     LIMIT 50`,
    [productName.trim()],
  )
  for (const row of rows) {
    if (row.product_code) candidateCodes.add(row.product_code)
  }
}

function buildFundValuationRecordWhere(
  candidateCodes: string[],
  productName: string | null,
): { clause: string; params: unknown[] } {
  const params: unknown[] = [candidateCodes]
  let clause = `product_code = ANY($1::text[])`
  if (productName?.trim()) {
    params.push(productName.trim())
    clause = `(${clause} OR ${sqlFundNameMatch("fund_name", "$2")})`
  }
  return { clause, params }
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
  await enrichCandidateCodesFromValuationHistory(candidateCodes, product_name)
  return { beian_hao, product_name, candidateCodes: [...candidateCodes] }
}

export async function listFundValuationEmailRecords(
  rawBeianHao: string,
  options?: { limit?: number; offset?: number },
): Promise<{ records: EmailValuationRecordRow[]; total: number }> {
  await ensureEmailValuationTable()
  const { product_name, candidateCodes } = await resolveFundValuationCandidateCodes(rawBeianHao)
  const { clause, params } = buildFundValuationRecordWhere(candidateCodes, product_name)
  const limit = Math.min(options?.limit ?? 50, 500)
  const offset = options?.offset ?? 0

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ops_email_valuation_records
     WHERE ${clause} AND valuation_date IS NOT NULL`,
    params,
  )
  const total = parseInt(countRows[0]?.count ?? "0", 10)

  const records = await query<EmailValuationRecordRow>(
    `SELECT * FROM ops_email_valuation_records
     WHERE ${clause} AND valuation_date IS NOT NULL
     ORDER BY valuation_date DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )

  return { records, total }
}

export async function getFundValuationCalendarSummary(rawBeianHao: string): Promise<{
  total: number
  dateFrom: string | null
  dateTo: string | null
  dates: string[]
  entries: Array<{ date: string; id: number; attachmentFilename: string | null }>
  inceptionDate: string | null
  needsEmailBackfill: boolean
}> {
  await ensureEmailValuationTable()
  const { beian_hao, product_name, candidateCodes } = await resolveFundValuationCandidateCodes(rawBeianHao)
  const { clause, params } = buildFundValuationRecordWhere(candidateCodes, product_name)

  const fundMeta = await resolveFundMeta(beian_hao, product_name, { includeLatestNav: false })
  const inceptionDate = fundMeta.inception_date?.slice(0, 10) ?? null

  const summaryRows = await query<{ total: string; date_from: string | null; date_to: string | null }>(
    `SELECT COUNT(*)::text AS total,
            MIN(valuation_date)::text AS date_from,
            MAX(valuation_date)::text AS date_to
     FROM ops_email_valuation_records
     WHERE ${clause} AND valuation_date IS NOT NULL`,
    params,
  )
  const dateRows = await query<{ valuation_date: string }>(
    `SELECT DISTINCT valuation_date::text AS valuation_date
     FROM ops_email_valuation_records
     WHERE ${clause} AND valuation_date IS NOT NULL
     ORDER BY valuation_date`,
    params,
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
     WHERE ${clause} AND valuation_date IS NOT NULL
     ORDER BY valuation_date ASC, id DESC`,
    params,
  )

  const summary = summaryRows[0]
  const dateFrom = summary?.date_from?.slice(0, 10) ?? null
  const dateTo = summary?.date_to?.slice(0, 10) ?? null

  let needsEmailBackfill = false
  const seedRows = loadManagedProductNavSeed(beian_hao)
  const seedStart = seedRows.length > 0
    ? seedRows.reduce((min, row) => {
        const d = row.price_date?.slice(0, 10)
        return d && (!min || d < min) ? d : min
      }, null as string | null)
    : null
  const expectedStart = seedStart ?? inceptionDate

  if (expectedStart && dateFrom) {
    const expectedMs = Date.parse(expectedStart)
    const earliestMs = Date.parse(dateFrom)
    if (Number.isFinite(expectedMs) && Number.isFinite(earliestMs) && earliestMs - expectedMs > 45 * 86400000) {
      needsEmailBackfill = true
    }
  } else if (inceptionDate && dateFrom) {
    const inceptionMs = Date.parse(inceptionDate)
    const earliestMs = Date.parse(dateFrom)
    if (Number.isFinite(inceptionMs) && Number.isFinite(earliestMs) && earliestMs - inceptionMs > 45 * 86400000) {
      needsEmailBackfill = true
    }
  } else if (!dateFrom || (summary && parseInt(summary.total ?? "0", 10) < 30)) {
    needsEmailBackfill = true
  } else if (seedRows.length > 0 && summary) {
    const total = parseInt(summary.total ?? "0", 10)
    if (total + 30 < seedRows.length) needsEmailBackfill = true
  }

  return {
    total: parseInt(summary?.total ?? "0", 10),
    dateFrom,
    dateTo,
    dates: dateRows.map((r) => r.valuation_date.slice(0, 10)),
    entries: entryRows.map((r) => ({
      date: r.valuation_date.slice(0, 10),
      id: r.id,
      attachmentFilename: r.attachment_filename,
    })),
    inceptionDate,
    needsEmailBackfill,
  }
}

export async function syncFundValuationEmailsFromMailbox(
  rawBeianHao: string,
  options?: { days?: number },
): Promise<{ days: number; valuationSaved: number; zipBatchSaved: number; errors: string[] }> {
  const { beian_hao, product_name } = await resolveFundValuationCandidateCodes(rawBeianHao)
  const fundMeta = await resolveFundMeta(beian_hao, product_name, { includeLatestNav: false })
  const inception = fundMeta.inception_date?.slice(0, 10) ?? null
  const seedRows = loadManagedProductNavSeed(beian_hao)
  const seedStart = seedRows.length > 0
    ? seedRows.reduce((min, row) => {
        const d = row.price_date?.slice(0, 10)
        return d && (!min || d < min) ? d : min
      }, null as string | null)
    : null
  const rangeStart = seedStart ?? inception

  const { emailLookbackDaysForDateRange, resolveEmailParseLookbackDays } = await import(
    "@/lib/server/email-parse-lookback"
  )
  const days = options?.days != null
    ? resolveEmailParseLookbackDays(options.days)
    : rangeStart
      ? emailLookbackDaysForDateRange(rangeStart)
      : resolveEmailParseLookbackDays()

  const errors: string[] = []
  const { ingestZipValuationBatchEmails } = await import("@/lib/server/email-valuation-zip-ingest")
  const zipResult = await ingestZipValuationBatchEmails({ days })
  errors.push(...zipResult.errors)

  const { fetchEmailParseRecords } = await import("@/lib/server/email-parse-fetch")
  const result = await fetchEmailParseRecords({ days })
  errors.push(...result.errors)

  return {
    days,
    valuationSaved: result.valuationSaved + zipResult.recordsSaved,
    zipBatchSaved: zipResult.recordsSaved,
    errors,
  }
}
