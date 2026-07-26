/**
 * Fast paths for private-fund detail pages.
 *
 * Reuses the same list-cache identities / BatchNavResolver pipeline that makes
 * FOF底层 / 在管产品 tables snappy: hydrate the header from precomputed caches,
 * resolve 备案号 without fuzzy name joins when possible, and fall back to the
 * shared NAV merge (+ valuation history) for the chart series.
 */

import { query } from "@/lib/db"
import {
  loadMergedFundNavRows,
} from "@/lib/server/fund-nav-series"
import { resolveRouteFundId } from "@/lib/server/fof-underlying-query"
import {
  addDays,
  BatchNavResolver,
  NAV_HISTORY_LOOKBACK_DAYS,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"
import {
  loadFundValuationNavFallbackSeries,
  loadManagedUnderlyingNavHistoryIncremental,
} from "@/lib/server/managed-fof-underlying-pg"
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
  platform_strategy_l1: string | null
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

  const selectCols = `
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
    platform_strategy_l1
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
    platform_strategy_l1: string | null
  }

  const tryTable = async (
    table: string,
    source: ListCacheFundHeader["source"],
  ): Promise<ListCacheFundHeader | null> => {
    try {
      const byCode = await query<Row>(
        `SELECT ${selectCols}
         FROM ${table}
         WHERE beian_hao = $1
         ORDER BY refreshed_at DESC NULLS LAST
         LIMIT 1`,
        [id],
      )
      if (byCode[0]) {
        return {
          source,
          ...byCode[0],
          nav_date: fmtDate(byCode[0].nav_date),
        }
      }
      const byName = await query<Row>(
        `SELECT ${selectCols}
         FROM ${table}
         WHERE product_name = $1 OR short_name = $1
         ORDER BY refreshed_at DESC NULLS LAST
         LIMIT 1`,
        [id],
      )
      if (byName[0]) {
        return {
          source,
          ...byName[0],
          nav_date: fmtDate(byName[0].nav_date),
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
  return {
    partial: true,
    info: {
      beian_hao: beian,
      product_name: cached.product_name,
      strategy_l1: cached.company_strategy_l1 ?? cached.platform_strategy_l1,
      strategy_l2: null,
      strategy_l3: null,
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
      latest_nav: cached.unit_nav,
      latest_nav_date: cached.nav_date,
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
  return points.map((p) => {
    const nav = String(p.nav)
    return {
      price_date: p.nav_date.slice(0, 10),
      nav,
      cumulative_nav: nav,
      cum_nav_withdrawal: nav,
      price_change: "",
    }
  })
}

/**
 * Load the full detail NAV series using the shared merge path, then align the
 * series end with BatchNavResolver.resolveAt() — the same latest-date rule as
 * FOF底层 list cache (newest among email / type6 / legacy / 估值表).
 */
export async function loadDetailNavSeriesFast(opts: {
  beian_hao: string
  product_name: string
  short_name: string
  rawId?: string
  emailNameAliases?: Array<string | null | undefined>
}): Promise<LegacyNavRow[]> {
  const {
    beian_hao,
    product_name,
    short_name,
    rawId,
    emailNameAliases = [],
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

  const [navSeries, resolver, valuationHistory, targetedFallback] = await Promise.all([
    loadMergedFundNavRows(beian_hao, product_name, short_name),
    BatchNavResolver.create([identity], asOfDate),
    loadManagedUnderlyingNavHistoryIncremental(sinceDate, [
      { product_name, beian_hao },
    ]),
    loadFundValuationNavFallbackSeries(beian_hao, product_name, short_name || null, {
      sinceDate,
      extraBeianCodes: [...new Set([rawId, beian_hao].filter(Boolean) as string[])],
      extraNames: collectFundNameAliases(
        product_name,
        short_name || null,
        emailNameAliases,
      ),
    }),
  ])

  try {
    resolver.setValuationNavHistory(valuationHistory.byCode, valuationHistory.byName)
    // Authoritative latest — same function the FOF list cache uses for 最新净值日期.
    const resolved = resolver.resolveAt(identity, asOfDate)
    const resolvedDate = resolved?.nav_date ?? ""
    const resolverHistory = resolver.mergedHistory(identity, sinceDate)
    const latestSeriesDate = navSeries[navSeries.length - 1]?.price_date ?? ""

    // Empty platform/email merge — use list-cache-equivalent series wholesale.
    if (navSeries.length === 0) {
      const historyToResolved = resolvedDate
        ? resolverHistory.filter((p) => p.nav_date <= resolvedDate)
        : resolverHistory
      if (historyToResolved.length > 0) {
        return applyFundNavCorrectionToLegacyRows(
          navPointsToLegacyRows(historyToResolved),
          fundContext,
        )
      }
      if (targetedFallback.length > 0) {
        const fallback = resolvedDate
          ? targetedFallback.filter((p) => p.price_date <= resolvedDate)
          : targetedFallback
        return applyFundNavCorrectionToLegacyRows(
          mergeNavSeriesWithEmail([], fallback, fundContext),
          fundContext,
        )
      }
      return navSeries
    }

    // Drop points past the shared latest rule (stale platform tails, bad merges).
    if (resolvedDate && latestSeriesDate > resolvedDate) {
      const trimmed = navSeries.filter((row) => row.price_date <= resolvedDate)
      return trimmed.length > 0 ? trimmed : navSeries
    }

    // Extend stale platform/email series up to resolveAt (includes fresher 估值表).
    if (!resolvedDate || (latestSeriesDate && resolvedDate <= latestSeriesDate)) {
      return navSeries
    }

    const extensionByDate = new Map<string, EmailNavPoint>()
    for (const point of resolverHistory) {
      if (!isPlausibleEmailUnitNav(point.nav)) continue
      if (point.nav_date <= latestSeriesDate || point.nav_date > resolvedDate) continue
      extensionByDate.set(point.nav_date, {
        price_date: point.nav_date,
        nav: String(point.nav),
        cumulative_nav: null,
      })
    }
    for (const point of targetedFallback) {
      if (point.price_date <= latestSeriesDate || point.price_date > resolvedDate) continue
      if (extensionByDate.has(point.price_date)) continue
      extensionByDate.set(point.price_date, point)
    }
    // Ensure the exact resolveAt point is present even if history layers omitted it.
    if (resolved && !extensionByDate.has(resolvedDate) && resolvedDate > latestSeriesDate) {
      extensionByDate.set(resolvedDate, {
        price_date: resolvedDate,
        nav: String(resolved.nav),
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
  } catch (err) {
    console.error("[loadDetailNavSeriesFast] BatchNavResolver/valuation extend failed:", err)
    return navSeries
  }
}
