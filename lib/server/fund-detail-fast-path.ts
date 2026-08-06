/**
 * Fast paths for private-fund detail pages.
 *
 * Reuses the same list-cache identities / BatchNavResolver pipeline that makes
 * FOF底层 / 在管产品 tables snappy: hydrate the header from precomputed caches,
 * resolve 备案号 without fuzzy name joins when possible, and fall back to the
 * shared NAV merge (+ valuation history) for the chart series.
 */

import { query } from "@/lib/db"
import { isChinaTradingDay } from "@/lib/server/china-trading-calendar"
import {
  loadMergedFundNavRows,
} from "@/lib/server/fund-nav-series"
import { resolveRouteFundId } from "@/lib/server/fof-underlying-query"
import {
  addDays,
  BatchNavResolver,
  calendarDaysBetween,
  NAV_HISTORY_LOOKBACK_DAYS,
  type NavPoint,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"

/**
 * Extend 平台数据 with FOF 估值表 holdings only when platform/email lags by this many
 * calendar days. Short 1–2 day 市价 leads (BSJ74B) stay off detail; multi-week
 * holdings-only tips (BGW80A / VN917B) are applied so product pages match FOF底层.
 */
const VALUATION_EXTEND_MIN_GAP_DAYS = 5
import { loadFundValuationNavFallbackSeries } from "@/lib/server/managed-fof-underlying-pg"
import {
  collectFundNameAliases,
  isPlausibleEmailUnitNav,
  mergeNavSeriesWithEmail,
  type EmailNavPoint,
  type LegacyNavRow,
} from "@/lib/server/email-nav-query"
import { applyFundNavCorrectionToLegacyRows } from "@/lib/server/fund-nav-correction-rules"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"

export type ListCacheFundHeader = {
  source: "fof" | "managed" | "tracking"
  beian_hao: string | null
  product_name: string
  short_name: string | null
  unit_nav: string | null
  nav_date: string | null
  return_pct: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  company_strategy_l1: string | null
  company_strategy_l2: string | null
  company_strategy_l3: string | null
  platform_strategy_l1: string | null
  platform_strategy_l2: string | null
  platform_strategy_l3: string | null
}

/** List-cache returns are fractions; detail page formats them as percent points. */
function fractionToPercentText(raw: string | null): string | null {
  if (raw == null || raw === "") return null
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return null
  return (n * 100).toFixed(4)
}

function fmtDate(d: string | Date | null | undefined): string | null {
  if (d == null) return null
  const s = typeof d === "string" ? d : d.toISOString()
  return s.slice(0, 10)
}

/**
 * Look up a fund in the nightly/intraday list caches (FOF底层 → 在管产品 → 跟踪产品).
 * Identity match is by 备案号 first, then exact product / short name.
 */
export async function lookupListCacheFundHeader(
  rawId: string,
): Promise<ListCacheFundHeader | null> {
  const id = rawId.trim()
  if (!id) return null

  // Tracking cache stores full L1–L3 for both sources; FOF/managed only keep L1.
  const selectCols = (source: ListCacheFundHeader["source"]) => `
    beian_hao,
    product_name,
    short_name,
    unit_nav::text AS unit_nav,
    nav_date,
    return_pct::text AS return_pct,
    ret_1w::text AS ret_1w,
    ret_1m::text AS ret_1m,
    ret_3m::text AS ret_3m,
    ret_6m::text AS ret_6m,
    ret_1y::text AS ret_1y,
    sharpe_1y::text AS sharpe_1y,
    calmar_1y::text AS calmar_1y,
    company_strategy_l1,
    ${source === "tracking" ? "company_strategy_l2, company_strategy_l3," : "NULL::text AS company_strategy_l2, NULL::text AS company_strategy_l3,"}
    platform_strategy_l1,
    ${source === "tracking" ? "platform_strategy_l2, platform_strategy_l3" : "NULL::text AS platform_strategy_l2, NULL::text AS platform_strategy_l3"}
  `

  type Row = {
    beian_hao: string | null
    product_name: string
    short_name: string | null
    unit_nav: string | null
    nav_date: string | Date | null
    return_pct: string | null
    ret_1w: string | null
    ret_1m: string | null
    ret_3m: string | null
    ret_6m: string | null
    ret_1y: string | null
    sharpe_1y: string | null
    calmar_1y: string | null
    company_strategy_l1: string | null
    company_strategy_l2: string | null
    company_strategy_l3: string | null
    platform_strategy_l1: string | null
    platform_strategy_l2: string | null
    platform_strategy_l3: string | null
  }

  const tryTable = async (
    table: string,
    source: ListCacheFundHeader["source"],
  ): Promise<ListCacheFundHeader | null> => {
    try {
      // Prefer exact 备案号 match, then name — single round-trip.
      const rows = await query<Row>(
        `SELECT ${selectCols(source)}
         FROM ${table}
         WHERE beian_hao = $1 OR product_name = $1 OR short_name = $1
         ORDER BY
           CASE WHEN beian_hao = $1 THEN 0 ELSE 1 END,
           refreshed_at DESC NULLS LAST
         LIMIT 1`,
        [id],
      )
      if (rows[0]) {
        return {
          source,
          ...rows[0],
          nav_date: fmtDate(rows[0].nav_date),
        }
      }
    } catch {
      // table may not exist yet
    }
    return null
  }

  const [fof, managed, tracking] = await Promise.all([
    tryTable("ops_fof_overview_list_cache", "fof"),
    tryTable("ops_managed_products_list_cache", "managed"),
    tryTable("ops_tracking_funds_list_cache", "tracking"),
  ])
  return fof ?? managed ?? tracking
}

/**
 * Resolve a route id to 备案号, preferring list-cache / override hits so we skip
 * the expensive fuzzy fund-name lateral join on the common FOF底层 click path.
 */
export async function resolveRouteFundIdFast(rawId: string): Promise<string> {
  const id = rawId.trim()
  if (!id) return id

  const override =
    lookupManagedProductOverride(id)
  if (override?.beian_hao) return override.beian_hao

  const cached = await lookupListCacheFundHeader(id)
  if (cached?.beian_hao?.trim()) return cached.beian_hao.trim()

  // Direct code hit — same as resolveFundBeianHao's first branch, without name join.
  try {
    const direct = await query<{ code: string }>(
      `SELECT beian_hao AS code FROM private_fund_info WHERE beian_hao = $1
       UNION ALL
       SELECT beian_hao FROM private_fund_info_bfl WHERE beian_hao = $1
       UNION ALL
       SELECT register_number FROM type6_ops_team_full WHERE register_number = $1
       LIMIT 1`,
      [id],
    )
    if (direct[0]?.code) return direct[0].code
  } catch {
    // fall through
  }

  return resolveRouteFundId(id)
}

export type DetailHeaderPayload = {
  partial: true
  info: {
    beian_hao: string
    product_name: string
    strategy_l1: string | null
    strategy_l2: string | null
    strategy_l3: string | null
    manager: string
    manager_names: string | null
    manager_registration_no: string | null
    scale: string | null
    inception_date: string | null
    operation_date: string | null
    benchmark: string | null
    ret_1w: string | null
    ret_1m: string | null
    ret_3m: string | null
    ret_6m: string | null
    ret_1y: string | null
    sharpe_1y: string | null
    calmar_1y: string | null
  }
  nav_series: []
  nav_data_source: "platform"
  metrics: {
    latest_nav: string | null
    latest_nav_date: string | null
    latest_cum_nav: string | null
    latest_cum_nav_reinvested: string | null
    ret_since_inception: string | null
    ann_ret: string | null
    ytd_ret: string | null
    max_drawdown: string | null
    sharpe_since_inception: string | null
  }
}

/** Build a partial detail payload from list-cache so the UI can paint before the series loads. */
export function buildDetailHeaderFromListCache(
  rawId: string,
  cached: ListCacheFundHeader,
): DetailHeaderPayload {
  const beian = (cached.beian_hao ?? rawId).trim()
  const navDate = cached.nav_date ? String(cached.nav_date).slice(0, 10) : null
  const tradingNavDate = navDate && isChinaTradingDay(navDate) ? navDate : null
  // 团队策略 > 平台策略 for the header paint path as well.
  const hasTeam = Boolean(
    cached.company_strategy_l1 || cached.company_strategy_l2 || cached.company_strategy_l3,
  )
  return {
    partial: true,
    info: {
      beian_hao: beian,
      product_name: cached.product_name,
      strategy_l1: hasTeam ? cached.company_strategy_l1 : cached.platform_strategy_l1,
      strategy_l2: hasTeam ? cached.company_strategy_l2 : cached.platform_strategy_l2,
      strategy_l3: hasTeam ? cached.company_strategy_l3 : cached.platform_strategy_l3,
      manager: "",
      manager_names: null,
      manager_registration_no: null,
      scale: null,
      inception_date: null,
      operation_date: null,
      benchmark: null,
      ret_1w: fractionToPercentText(cached.ret_1w),
      ret_1m: fractionToPercentText(cached.ret_1m),
      ret_3m: fractionToPercentText(cached.ret_3m),
      ret_6m: fractionToPercentText(cached.ret_6m),
      ret_1y: fractionToPercentText(cached.ret_1y),
      sharpe_1y: cached.sharpe_1y,
      calmar_1y: cached.calmar_1y,
    },
    nav_series: [],
    nav_data_source: "platform",
    metrics: {
      // Hide weekend forward-fill tips until the full trading-day series arrives.
      latest_nav: tradingNavDate ? cached.unit_nav : null,
      latest_nav_date: tradingNavDate,
      latest_cum_nav: null,
      latest_cum_nav_reinvested: null,
      ret_since_inception: null,
      ann_ret: null,
      ytd_ret: null,
      max_drawdown: null,
      sharpe_since_inception: null,
    },
  }
}

function navPointsToLegacyRows(
  points: Array<{ nav: number; nav_date: string }>,
): LegacyNavRow[] {
  return points.flatMap((p) => {
    const price_date = p.nav_date.slice(0, 10)
    if (!isChinaTradingDay(price_date)) return []
    const nav = String(p.nav)
    return [{
      price_date,
      nav,
      cumulative_nav: nav,
      cum_nav_withdrawal: nav,
      price_change: "",
    }]
  })
}

/** Minimal series from list-cache so the page never stays blank while heavier sources load. */
function seriesFromListHeader(header: ListCacheFundHeader | null | undefined): LegacyNavRow[] {
  if (!header?.nav_date || header.unit_nav == null || header.unit_nav === "") return []
  const priceDate = header.nav_date.slice(0, 10)
  if (!isChinaTradingDay(priceDate)) return []
  const nav = String(header.unit_nav)
  const n = parseFloat(nav)
  if (!Number.isFinite(n) || n <= 0) return []
  return [{
    price_date: priceDate,
    nav,
    cumulative_nav: nav,
    cum_nav_withdrawal: nav,
    price_change: "",
  }]
}

function valuationPointsToNavMaps(
  beian_hao: string,
  product_name: string,
  short_name: string,
  points: EmailNavPoint[],
): { byCode: Map<string, NavPoint[]>; byName: Map<string, NavPoint[]> } {
  const byCode = new Map<string, NavPoint[]>()
  const byName = new Map<string, NavPoint[]>()
  const code = beian_hao.trim().toUpperCase()
  const names = [...new Set([product_name, short_name].map((s) => s.trim()).filter(Boolean))]
  const navPoints: NavPoint[] = []
  for (const p of points) {
    const nav = parseFloat(String(p.nav ?? ""))
    if (!Number.isFinite(nav) || !isPlausibleEmailUnitNav(nav)) continue
    navPoints.push({ nav, nav_date: p.price_date.slice(0, 10) })
  }
  navPoints.sort((a, b) => b.nav_date.localeCompare(a.nav_date))
  if (code) byCode.set(code, navPoints)
  for (const name of names) byName.set(name, navPoints)
  return { byCode, byName }
}

/** True when a unit-only 估值表 mark would crash a pre-dividend tip (no 累计 to preserve). */
function isSparseGapUnitOnlyCrash(
  navSeries: LegacyNavRow[],
  unitNav: number,
  pointCum: number | null,
): boolean {
  if (pointCum != null && Number.isFinite(pointCum) && pointCum - unitNav > 0.03) return false
  const tip = navSeries[navSeries.length - 1]
  if (!tip) return false
  const tipUnit = tip.nav != null ? parseFloat(String(tip.nav)) : NaN
  const tipCumRaw = tip.cum_nav_withdrawal || tip.cumulative_nav
  const tipCum = tipCumRaw != null && tipCumRaw !== "" ? parseFloat(String(tipCumRaw)) : NaN
  if (!Number.isFinite(tipUnit) || tipUnit <= 0 || !Number.isFinite(tipCum)) return false
  // Pre-div tip (unit≈cum) + sharp unit drop without 累计 → SBBC18 FOF holdings false crash.
  if (tipCum - tipUnit > 0.03) return false
  return unitNav < tipUnit * 0.95
}

function extendSeriesWithPoints(
  navSeries: LegacyNavRow[],
  fundContext: { beian_hao: string; product_name: string; short_name: string | null },
  latestSeriesDate: string,
  targetDate: string,
  points: EmailNavPoint[],
  resolvedNav?: number | null,
): LegacyNavRow[] {
  const extensionByDate = new Map<string, EmailNavPoint>()
  for (const point of points) {
    const date = point.price_date.slice(0, 10)
    if (!isChinaTradingDay(date)) continue
    if (latestSeriesDate && date <= latestSeriesDate) continue
    if (targetDate && date > targetDate) continue
    const pointNav = point.nav != null ? parseFloat(String(point.nav)) : NaN
    const pointCum =
      point.cumulative_nav != null && point.cumulative_nav !== ""
        ? parseFloat(String(point.cumulative_nav))
        : null
    if (
      Number.isFinite(pointNav)
      && isSparseGapUnitOnlyCrash(
        navSeries,
        pointNav,
        pointCum != null && Number.isFinite(pointCum) ? pointCum : null,
      )
    ) {
      continue
    }
    extensionByDate.set(date, point)
  }
  if (
    resolvedNav != null
    && targetDate
    && isChinaTradingDay(targetDate)
    && (!latestSeriesDate || targetDate > latestSeriesDate)
    && !extensionByDate.has(targetDate)
    && !isSparseGapUnitOnlyCrash(navSeries, resolvedNav, null)
  ) {
    extensionByDate.set(targetDate, {
      price_date: targetDate,
      nav: String(resolvedNav),
      cumulative_nav: null,
    })
  }
  const extension = [...extensionByDate.values()].sort((a, b) =>
    a.price_date.localeCompare(b.price_date),
  )
  if (extension.length === 0) return navSeries
  return applyFundNavCorrectionToLegacyRows(
    mergeNavSeriesWithEmail(navSeries, extension, fundContext),
    fundContext,
  )
}

function valuationTipDate(points: EmailNavPoint[]): string {
  return points.length > 0 ? points[points.length - 1]!.price_date.slice(0, 10) : ""
}

/** True when 估值表 tip leads platform/email by enough days to treat as holdings-only lag. */
function isStaleValuationLead(seriesTip: string, valuationTip: string): boolean {
  if (!valuationTip) return false
  if (!seriesTip) return true
  if (valuationTip <= seriesTip) return false
  return calendarDaysBetween(valuationTip, seriesTip) >= VALUATION_EXTEND_MIN_GAP_DAYS
}

/**
 * Load the full detail NAV series.
 *
 * Fast path (most FOF底层 clicks): one merge query. Skip BatchNavResolver when the
 * series already reaches the list-cache latest date and is not far behind FOF 估值表
 * holdings. Extend with targeted 估值表 when the merge is empty, behind the cache, or
 * holdings-only lag (cache may have been sync'd back to a stale platform tip).
 */
export async function loadDetailNavSeriesFast(opts: {
  beian_hao: string
  product_name: string
  short_name: string
  rawId?: string
  emailNameAliases?: Array<string | null | undefined>
  /** Pre-fetched list-cache row — avoids a second lookup and enables the fast path. */
  listHeader?: ListCacheFundHeader | null
}): Promise<LegacyNavRow[]> {
  const {
    beian_hao,
    product_name,
    short_name,
    rawId,
    emailNameAliases = [],
    listHeader: listHeaderOpt,
  } = opts
  const fundContext = {
    beian_hao,
    product_name,
    short_name: short_name || null,
  }

  const asOfDate = new Date().toISOString().slice(0, 10)
  const sinceDate = addDays(asOfDate, NAV_HISTORY_LOOKBACK_DAYS)
  const identity: ProductNavIdentity = {
    beian_hao,
    product_name,
    short_name: short_name || null,
  }

  const [navSeries, listHeader] = await Promise.all([
    loadMergedFundNavRows(beian_hao, product_name, short_name),
    listHeaderOpt !== undefined
      ? Promise.resolve(listHeaderOpt)
      : lookupListCacheFundHeader(beian_hao).then(
          (hit) => hit ?? lookupListCacheFundHeader(product_name),
        ),
  ])

  const latestSeriesDate = navSeries[navSeries.length - 1]?.price_date ?? ""
  const cacheTargetDate = listHeader?.nav_date ?? ""
  const behindCache =
    Boolean(cacheTargetDate) && (!latestSeriesDate || latestSeriesDate < cacheTargetDate)
  // Cache tip can lag FOF 估值表 after syncFofCacheLatestReturnFromDetail pulls the list
  // back to platform/email — probe valuation only when the series tip itself is stale
  // enough that a short BSJ74B-style 市价 lead would not qualify.
  const mayNeedStaleValuationExtend =
    navSeries.length > 0
    && Boolean(latestSeriesDate)
    && calendarDaysBetween(asOfDate, latestSeriesDate) >= VALUATION_EXTEND_MIN_GAP_DAYS

  // Hot path: covers list-cache tip and not a candidate for holdings-only valuation extend.
  if (navSeries.length > 0 && !behindCache && !mayNeedStaleValuationExtend) {
    return navSeries
  }

  const valuationOpts = {
    sinceDate,
    extraBeianCodes: [...new Set([rawId, beian_hao].filter(Boolean) as string[])],
    extraNames: collectFundNameAliases(
      product_name,
      short_name || null,
      emailNameAliases,
    ),
  }

  const seededFromCache = seriesFromListHeader(listHeader)
  const cacheNav =
    listHeader?.unit_nav != null ? parseFloat(listHeader.unit_nav) : null

  try {
    // Non-empty merge behind cache and/or far behind FOF 估值表 holdings.
    if (navSeries.length > 0 && (behindCache || mayNeedStaleValuationExtend)) {
      const targetedFallback = await loadFundValuationNavFallbackSeries(
        beian_hao,
        product_name,
        short_name || null,
        valuationOpts,
      )
      const valuationTip = valuationTipDate(targetedFallback)
      const staleValuationLead = isStaleValuationLead(latestSeriesDate, valuationTip)
      const targetCandidates = [
        behindCache ? cacheTargetDate : "",
        staleValuationLead ? valuationTip : "",
      ].filter(Boolean)
      const targetDate = targetCandidates.sort().at(-1) ?? ""
      if (!targetDate || (latestSeriesDate && latestSeriesDate >= targetDate)) {
        return navSeries
      }
      const tipNavFromValuation = targetedFallback
        .filter((p) => p.price_date.slice(0, 10) === targetDate)
        .at(-1)
      const tipNav = tipNavFromValuation?.nav != null
        ? parseFloat(String(tipNavFromValuation.nav))
        : targetDate === cacheTargetDate && Number.isFinite(cacheNav)
          ? cacheNav
          : null
      return extendSeriesWithPoints(
        navSeries,
        fundContext,
        latestSeriesDate,
        targetDate,
        targetedFallback,
        tipNav != null && Number.isFinite(tipNav) ? tipNav : null,
      )
    }

    // Empty merge (common for holdings-only FOF underlyings like 赢仕木盛1号).
    // Do NOT call loadManagedUnderlyingNavHistoryIncremental here — when its history
    // table is cold it runs a full-table scan and hangs the detail request.
    if (navSeries.length === 0) {
      // 1) Targeted 估值表 first (same source list cache often used; cheap SQL).
      const targetedFallback = await loadFundValuationNavFallbackSeries(
        beian_hao,
        product_name,
        short_name || null,
        valuationOpts,
      )
      if (targetedFallback.length > 0) {
        const valuationTip = valuationTipDate(targetedFallback)
        // Do not clamp to a stale list-cache tip (e.g. platform June after detail sync).
        const capDate =
          cacheTargetDate && valuationTip && cacheTargetDate >= valuationTip
            ? cacheTargetDate
            : valuationTip || cacheTargetDate
        const fallback = capDate
          ? targetedFallback.filter((p) => p.price_date <= capDate)
          : targetedFallback
        const series = applyFundNavCorrectionToLegacyRows(
          mergeNavSeriesWithEmail([], fallback.length > 0 ? fallback : targetedFallback, fundContext),
          fundContext,
        )
        if (series.length > 0) return series
      }

      // 2) BatchNavResolver for email/type6/legacy — inject targeted points as valuation.
      const resolver = await BatchNavResolver.create([identity], asOfDate)
      const maps = valuationPointsToNavMaps(
        beian_hao,
        product_name,
        short_name,
        targetedFallback,
      )
      resolver.setValuationNavHistory(maps.byCode, maps.byName)
      const resolved = resolver.resolveAt(identity, asOfDate)
      const resolvedDate = resolved?.nav_date ?? cacheTargetDate
      const resolverHistory = resolver.mergedHistory(identity, sinceDate)
      const historyToResolved = resolvedDate
        ? resolverHistory.filter((p) => p.nav_date <= resolvedDate)
        : resolverHistory
      if (historyToResolved.length > 0) {
        return applyFundNavCorrectionToLegacyRows(
          navPointsToLegacyRows(historyToResolved),
          fundContext,
        )
      }

      // 3) Last resort: list-cache point so the page is not stuck blank.
      return seededFromCache
    }

    return navSeries
  } catch (err) {
    console.error("[loadDetailNavSeriesFast] valuation/resolver extend failed:", err)
    if (navSeries.length > 0) return navSeries
    return seededFromCache
  }
}
