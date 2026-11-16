/**
 * Read-only product ↔ account linkage for the fund-data API.
 * Same overlap math as the product page「账户对比」.
 * MOM series come from public.mom_daily_reports. 单账户 series come from public.cfmmc_daily_summary.
 * This module does not write either table.
 */
import { filterPointsByFrequency, type NavFrequencyFilter } from "@/app/ma/dashboard/private-funds/[beian_hao]/components/shared"
import { isPlausibleRiskRatio } from "@/lib/fund-nav-metrics"
import {
  buildAccountCompareAnalysis,
  type CompareNavPoint,
} from "@/lib/ma/fund-account-compare"
import type { MomUnderlyingKind } from "@/lib/ma/mom-underlying"
import { loadMomAccountCompareSeries } from "@/lib/server/account-compare-series"
import {
  cfmmcCompareId,
  loadCfmmcCompareSeries,
  parseCfmmcCompareId,
  resolveLinkedCfmmcCompareIds,
} from "@/lib/server/account-risk-compare"
import {
  fundDataErr,
  fundDataOk,
  getFundPrice,
  resolvePriceIdentity,
  type FundDataEnvelope,
  type FundPricePoint,
} from "@/lib/server/fund-data-api"
import { listMomUnderlyingProducts } from "@/lib/server/mom-underlying-list"
import { resolveFundMomAccountLinks } from "@/lib/server/ops-fund-mom-accounts"

const METHOD_NOTE =
  "与产品页「账户对比」同一口径。产品默认用复权净值。MOM 对比账户按结算日报日复利：（当日盈亏−手续费+权利金净额）/ 上日结存。单账户用客户权益路径复权净值，出入金不计入收益。重叠起点归一为 0%。收益相关性和跟踪误差只在产品净值披露日上配对。跟踪误差是超额日收益的样本标准差乘以年化频率的平方根。"

export function parseAccountLinkFreq(raw: string | undefined): NavFrequencyFilter | null {
  const text = (raw ?? "").trim()
  if (!text || text === "all" || text === "全部") return "全部"
  if (text === "daily" || text === "日频") return "日频"
  if (text === "weekly" || text === "周频") return "周频"
  if (text === "monthly" || text === "月频") return "月频"
  return null
}

export function parseAccountLinkNav(raw: string | undefined): "adjusted" | "unit" | "accumulated" | null {
  const text = (raw ?? "").trim().toLowerCase()
  if (!text || text === "adjusted" || text === "复权净值") return "adjusted"
  if (text === "unit" || text === "单位净值") return "unit"
  if (text === "accumulated" || text === "累计净值") return "accumulated"
  return null
}

function navLabel(nav: "adjusted" | "unit" | "accumulated"): string {
  if (nav === "unit") return "单位净值"
  if (nav === "accumulated") return "累计净值"
  return "复权净值"
}

function pointValue(point: FundPricePoint, nav: "adjusted" | "unit" | "accumulated"): number | null {
  const raw = nav === "unit" ? point.nav : nav === "accumulated" ? point.cumulative_nav_withdrawal : point.cumulative_nav
  return raw != null && Number.isFinite(raw) && raw > 0 ? raw : null
}

function isoDate(raw: string | undefined): string | null {
  const text = (raw ?? "").trim()
  if (!text) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function pctPoints(ratio: number | null | undefined): number | null {
  if (ratio == null || !Number.isFinite(ratio)) return null
  return Math.round(ratio * 10000) / 100
}

function ratio2(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || !isPlausibleRiskRatio(value)) return null
  return Math.round(value * 100) / 100
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100
}

export function shapeAccountLinkCompare(
  fund: CompareNavPoint[],
  account: CompareNavPoint[],
  freq: NavFrequencyFilter,
) {
  const fundPts = filterPointsByFrequency(fund, freq)
  const accountPts = filterPointsByFrequency(account, freq)
  const empty = {
    summary: null,
    curve: [] as Array<{ date: string; fund_pct: number; account_pct: number; excess_pct: number }>,
    message: "所选区间内产品与账户没有重叠日期",
  }
  if (fundPts.length < 2 || accountPts.length < 2) return empty
  const analysis = buildAccountCompareAnalysis(fundPts, accountPts)
  if (analysis.overlay.length < 2 || !analysis.difference || !analysis.fundMetrics || !analysis.accountMetrics) {
    return empty
  }
  const excess = analysis.fundMetrics.periodRet - analysis.accountMetrics.periodRet
  return {
    summary: {
      overlap_start: analysis.difference.overlapStart,
      overlap_end: analysis.difference.overlapEnd,
      pair_count: analysis.difference.pairCount,
      fund_period_return_pct: pctPoints(analysis.fundMetrics.periodRet),
      account_period_return_pct: pctPoints(analysis.accountMetrics.periodRet),
      excess_return_pct: pctPoints(excess),
      correlation: ratio2(analysis.difference.correlation),
      tracking_error_pct: pctPoints(analysis.difference.trackingError),
      information_ratio: ratio2(analysis.difference.informationRatio),
      hit_rate_pct: pctPoints(analysis.difference.hitRate),
      fund_max_drawdown_pct: pctPoints(analysis.fundMetrics.maxDD),
      account_max_drawdown_pct: pctPoints(analysis.accountMetrics.maxDD),
    },
    curve: analysis.overlay.map((point) => ({
      date: point.date,
      fund_pct: roundPct(point.fundPct),
      account_pct: roundPct(point.accountPct),
      excess_pct: roundPct(point.excessPct),
    })),
    message: null as string | null,
  }
}

function kindOf(raw: string | undefined): MomUnderlyingKind | null {
  const text = (raw ?? "").trim().toLowerCase()
  if (!text) return null
  if (text === "compare" || text === "mom") return "compare"
  if (text === "account" || text === "cfmmc" || text === "single") return "account"
  return null
}

export async function listAccountLinks(
  params: Record<string, string | undefined>,
): Promise<FundDataEnvelope<unknown>> {
  const kind = kindOf(params.kind)
  if ((params.kind ?? "").trim() && !kind) return fundDataErr(1, "kind must be compare or account")
  const q = (params.q ?? "").trim().toLowerCase()
  let rows
  try {
    rows = await listMomUnderlyingProducts()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return fundDataErr(3, msg)
  }
  const links = rows
    .filter((row) => !kind || row.kind === kind)
    .filter((row) => {
      if (!q) return true
      const hay = [row.beian_hao, row.product_name, row.account, row.account_note, row.note, row.strategy]
        .map((part) => String(part ?? "").toLowerCase())
        .join(" ")
      return hay.includes(q)
    })
    .map((row) => ({
      kind: row.kind,
      link_source: row.link_source,
      reg_code: row.beian_hao,
      fund_name: row.product_name,
      account: row.account,
      account_id: row.kind === "account" ? cfmmcCompareId(row.account) : row.account,
      note: row.note,
      account_note: row.account_note,
      strategy: row.strategy,
      latest_nav: row.latest_nav,
      latest_nav_date: row.latest_nav_date,
      equity: row.equity,
      equity_date: row.equity_date,
    }))
  return fundDataOk({ total: links.length, links })
}

async function linkedAccountId(regCodes: string[], kind: MomUnderlyingKind | null): Promise<string | null> {
  for (const code of regCodes) {
    if (kind !== "account") {
      const mom = await resolveFundMomAccountLinks(code).catch(() => [])
      const account = mom[0]?.account?.trim().toLowerCase()
      if (account) return account
    }
    if (kind !== "compare") {
      const singles = await resolveLinkedCfmmcCompareIds(code).catch(() => [])
      if (singles[0]) return singles[0]
    }
  }
  return null
}

export async function compareAccountLink(
  params: Record<string, string | undefined>,
): Promise<FundDataEnvelope<unknown>> {
  const regCode = (params.reg_code || params.register_number || "").trim()
  if (!regCode) return fundDataErr(1, "reg_code is required")
  const start = isoDate(params.start_date)
  const end = isoDate(params.end_date)
  if ((params.start_date ?? "").trim() && !start) return fundDataErr(1, "start_date must be YYYY-MM-DD")
  if ((params.end_date ?? "").trim() && !end) return fundDataErr(1, "end_date must be YYYY-MM-DD")
  if (start && end && start > end) return fundDataErr(1, "start_date must be on or before end_date")
  const freq = parseAccountLinkFreq(params.freq)
  if (!freq) return fundDataErr(1, "freq must be all, daily, weekly, or monthly")
  const nav = parseAccountLinkNav(params.nav)
  if (!nav) return fundDataErr(1, "nav must be adjusted, unit, or accumulated")
  const requestedKind = kindOf(params.kind)
  if ((params.kind ?? "").trim() && !requestedKind) return fundDataErr(1, "kind must be compare or account")

  const identity = await resolvePriceIdentity(regCode)
  if (!identity) return fundDataErr(2, `fund not found: ${regCode}`)
  const regCodes = [...new Set(
    [identity.queried, identity.priceRegCode, identity.parentRegCode]
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
  )]

  const requested = (params.account ?? "").trim()
  let accountId = requested
  const linked = !requested
  if (!accountId) {
    accountId = (await linkedAccountId(regCodes, requestedKind)) ?? ""
    if (!accountId) return fundDataErr(2, "这个产品还没有保存对比账户或单账户关联")
  }

  const explicitSingle = requestedKind === "account" && !accountId.toLowerCase().startsWith("cfmmc:")
  const cfmmcAccountNo = parseCfmmcCompareId(accountId) || (explicitSingle ? accountId : null)
  const source = cfmmcAccountNo ? "cfmmc" as const : "mom" as const
  const from = start ?? ""
  const to = end ?? ""

  let series: Array<{ date: string; nav: number }> = []
  let company: string | null = null
  let accountFundName: string | null = null
  let advisorName: string | null = null
  let emptyMessage: string | null = null
  try {
    if (cfmmcAccountNo) {
      const loaded = await loadCfmmcCompareSeries(cfmmcAccountNo, from, to)
      series = loaded.series
      company = loaded.company || null
      accountFundName = loaded.fundName || null
      if (!series.length) emptyMessage = "单账户结算数据尚未导入或该区间没有数据"
    } else {
      const loaded = await loadMomAccountCompareSeries(accountId, from, to)
      series = loaded.series
      company = loaded.advisor?.company ?? null
      advisorName = loaded.advisor?.advisor_name ?? null
      if (!series.length) emptyMessage = "MOM 结算数据尚未导入或该区间没有数据"
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return fundDataErr(2, source === "cfmmc" ? "单账户结算数据尚未导入" : "MOM 结算数据尚未导入")
    }
    return fundDataErr(3, msg)
  }

  const price = await getFundPrice({
    reg_code: identity.priceRegCode,
    start_date: start,
    end_date: end,
    order: "1",
    order_by: "price_date",
  })
  if ("error_code" in price && price.error_code !== 0) return price
  const fundPoints: CompareNavPoint[] = []
  for (const point of price.data ?? []) {
    const value = pointValue(point, nav)
    if (value == null) continue
    fundPoints.push({ d: point.price_date, v: value })
  }

  const shaped = emptyMessage
    ? { summary: null, curve: [], message: emptyMessage }
    : shapeAccountLinkCompare(
        fundPoints,
        series.map((row) => ({ d: row.date, v: row.nav })),
        freq,
      )

  const code = cfmmcAccountNo ?? accountId.toLowerCase()
  const labelParts = source === "cfmmc"
    ? [accountFundName, company, code].filter((part): part is string => Boolean(part))
    : [`MOM ${code}`]
  const label = [...new Set(labelParts)].join(" · ")

  return fundDataOk({
    reg_code: identity.priceRegCode,
    queried_reg_code: identity.queried,
    fund_name: identity.fundName,
    nav: navLabel(nav),
    freq,
    used_saved_link: linked,
    account: {
      id: source === "cfmmc" ? cfmmcCompareId(cfmmcAccountNo!) : code,
      source,
      kind: source === "cfmmc" ? "account" : "compare",
      code,
      label,
      company,
      account_fund_name: accountFundName,
      advisor_name: advisorName,
    },
    summary: shaped.summary,
    curve: shaped.curve,
    truncated: "truncated" in price ? price.truncated === true : false,
    message: shaped.message,
    note: METHOD_NOTE,
  })
}
