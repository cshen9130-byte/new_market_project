import { NextResponse } from "next/server"
import { resolveManagedProductBeian, lookupManagedProductOverride, MANAGED_PRODUCT_BEIAN_OVERRIDES } from "@/lib/server/managed-product-beian"
import {
  buildManagedProductListNavHistory,
  computeManagedProductOneYearRiskMetrics,
  resolveManagedProductListNavAt,
  resolveTeamSeriesListNavAt,
} from "@/lib/server/managed-product-nav-seed"
import { calcPeriodReturnsFromHistory } from "@/lib/server/list-cache-nav-batch"
import { isChinaTradingDay } from "@/lib/server/china-trading-calendar"
import { query, fmtIso } from "@/lib/db"
import { sanitizeRiskMetricText } from "@/lib/fund-nav-metrics"
import {
  buildManagedProductsFrom,
  fofUnderlyingShortExpr,
} from "@/lib/server/fof-underlying-query"
import {
  buildManagedProductsMetricSelectSql,
  managedNavAtOffsetJoin,
  managedValuationMetricsJoin,
  MANAGED_BEIAN_EXPR,
  MANAGED_NAV_IS_TEAM_EXPR,
} from "@/lib/server/managed-products-nav-query"
import {
  ensureManagedProductsListCachePopulated,
  shouldUseManagedProductsListCache,
} from "@/lib/server/managed-products-list-cache-pg"
import { loadManagedProductPostSeedExtensions, loadManagedProductTeamNavBatch } from "@/lib/server/team-nav-manage-pg"
import {
  loadEmailFundMetricsLookup,
  resolveEmailFundMetrics,
} from "@/lib/server/email-valuation-cache-enrich"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Prefer list-cache AUM/custody even when null — COALESCE to managed_products
 *  restored stale SBKM53 资产净值 after 金舆锡泰一号 name-match was rejected. */
const CACHE_AUM_EXPR =
  "CASE WHEN cache.managed_product_id IS NOT NULL THEN cache.net_asset_value ELSE m.net_asset_value END"
const CACHE_CUSTODY_EXPR =
  "CASE WHEN cache.managed_product_id IS NOT NULL THEN cache.custody_balance ELSE m.custody_account_balance END"

const ALLOWED_SORT: Record<string, string> = {
  product_name: "m.product_name",
  latest_nav: "cache.unit_nav",
  latest_nav_date: "cache.nav_date",
  latest_price_change: "cache.return_pct",
  custody_balance: CACHE_CUSTODY_EXPR,
  net_asset_value: CACHE_AUM_EXPR,
  ret_1w: "cache.ret_1w",
  ret_1m: "cache.ret_1m",
  ret_3m: "cache.ret_3m",
  ret_6m: "cache.ret_6m",
  ret_1y: "cache.ret_1y",
  sharpe_1y: "cache.sharpe_1y",
  calmar_1y: "cache.calmar_1y",
}

const ALLOWED_SORT_SLOW: Record<string, string> = {
  product_name: "m.product_name",
  latest_nav: "latest_unit_nav",
  latest_nav_date: "latest_nav_date",
  latest_price_change: "latest_return_pct",
  custody_balance: "m.custody_account_balance",
  net_asset_value: "m.net_asset_value",
  ret_1w: "ret_1w",
  ret_1m: "ret_1m",
  ret_3m: "ret_3m",
  ret_6m: "ret_6m",
  ret_1y: "ret_1y",
  sharpe_1y: "sharpe_1y",
  calmar_1y: "calmar_1y",
}

const BEIAN_EXPR = MANAGED_BEIAN_EXPR
const PRODUCT_EXPR = "m.product_name"
const SHORT_EXPR = fofUnderlyingShortExpr(PRODUCT_EXPR)

interface ManagedRow {
  id: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  custody_balance: string | null
  net_asset_value: string | null
  valuation_date: string | null
  nav_is_team: boolean
  platform_strategy_l1?: string | null
  platform_strategy_l2?: string | null
  platform_strategy_l3?: string | null
  company_strategy_l1?: string | null
  company_strategy_l2?: string | null
  company_strategy_l3?: string | null
  ret_1w?: string | null
  ret_1m?: string | null
  ret_3m?: string | null
  ret_6m?: string | null
  ret_1y?: string | null
  sharpe_1y?: string | null
  calmar_1y?: string | null
}

function mapRow(r: {
  id: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2?: string | null
  strategy_l3?: string | null
  platform_strategy_l1?: string | null
  platform_strategy_l2?: string | null
  platform_strategy_l3?: string | null
  company_strategy_l1?: string | null
  company_strategy_l2?: string | null
  company_strategy_l3?: string | null
  latest_unit_nav: string | null
  latest_nav_date: string | Date | null
  latest_return_pct: string | null
  custody_account_balance: string | null
  net_asset_value: string | null
  valuation_date?: string | Date | null
  nav_is_team?: boolean | null
  ret_1w?: string | null
  ret_1m?: string | null
  ret_3m?: string | null
  ret_6m?: string | null
  ret_1y?: string | null
  sharpe_1y?: string | null
  calmar_1y?: string | null
}): ManagedRow {
  return {
    id: r.id,
    beian_hao: resolveManagedProductBeian(r.product_name, r.beian_hao),
    product_name: r.product_name,
    short_name: r.short_name,
    strategy_l1: r.strategy_l1,
    strategy_l2: r.strategy_l2 ?? null,
    strategy_l3: r.strategy_l3 ?? null,
    platform_strategy_l1: r.platform_strategy_l1 ?? null,
    platform_strategy_l2: r.platform_strategy_l2 ?? null,
    platform_strategy_l3: r.platform_strategy_l3 ?? null,
    company_strategy_l1: r.company_strategy_l1 ?? null,
    company_strategy_l2: r.company_strategy_l2 ?? null,
    company_strategy_l3: r.company_strategy_l3 ?? null,
    latest_nav: r.latest_unit_nav,
    latest_nav_date: r.latest_nav_date ? fmtIso(r.latest_nav_date) : null,
    latest_price_change: r.latest_return_pct != null ? String(parseFloat(r.latest_return_pct)) : null,
    custody_balance: r.custody_account_balance,
    net_asset_value: r.net_asset_value,
    valuation_date: r.valuation_date
      ? fmtIso(r.valuation_date)
      : r.latest_nav_date
        ? fmtIso(r.latest_nav_date)
        : null,
    nav_is_team: Boolean(r.nav_is_team),
    ret_1w: r.ret_1w,
    ret_1m: r.ret_1m,
    ret_3m: r.ret_3m,
    ret_6m: r.ret_6m,
    ret_1y: r.ret_1y,
    sharpe_1y: sanitizeRiskMetricText(r.sharpe_1y),
    calmar_1y: sanitizeRiskMetricText(r.calmar_1y),
  }
}

function resolveManagedOverrideListNav(
  overrideBeian: string,
  asOfDate: string,
  postSeedTeamNav: Array<{ nav_date: string; unit_nav: string }>,
  fullTeamNav: Array<{ nav_date: string; unit_nav: string }>,
) {
  return (
    resolveManagedProductListNavAt(overrideBeian, asOfDate, postSeedTeamNav)
    ?? resolveTeamSeriesListNavAt(fullTeamNav, asOfDate)
  )
}

function applyManagedSeedNavOverride(
  row: ManagedRow,
  asOfDate: string,
  postSeedTeamNavByBeian: Map<string, Array<{ nav_date: string; unit_nav: string }>>,
  fullTeamNavByBeian: Map<string, Array<{ nav_date: string; unit_nav: string }>>,
): ManagedRow {
  const override =
    lookupManagedProductOverride(row.product_name)
    ?? (row.beian_hao ? lookupManagedProductOverride(row.beian_hao) : null)
  const beian_hao = resolveManagedProductBeian(row.product_name, row.beian_hao)
  if (!override) return { ...row, beian_hao }

  const postSeed = postSeedTeamNavByBeian.get(override.beian_hao) ?? []
  const fullTeam = fullTeamNavByBeian.get(override.beian_hao) ?? []
  const listPoint = resolveManagedOverrideListNav(
    override.beian_hao,
    asOfDate,
    postSeed,
    fullTeam,
  )
  if (!listPoint) return { ...row, beian_hao }

  const unitNav = parseFloat(listPoint.nav)
  let latest_price_change = row.latest_price_change
  if (listPoint.prev_nav != null) {
    const prev = parseFloat(listPoint.prev_nav)
    if (Number.isFinite(unitNav) && Number.isFinite(prev) && prev !== 0) {
      latest_price_change = String(unitNav / prev - 1)
    }
  }

  // Period returns must use the same team/seed series as list NAV — not the
  // contaminated BatchNavResolver merge that produced SAVW72 近一周 −11.89%.
  // Seed products (SBAH99) carry 复权净值 so 近一年 is not the post-分红 unit NAV.
  const history = buildManagedProductListNavHistory(override.beian_hao, postSeed, fullTeam)
  const period =
    Number.isFinite(unitNav) && history.length > 0
      ? calcPeriodReturnsFromHistory(history, unitNav, listPoint.nav_date)
      : null
  const fmtRet = (v: number | null | undefined) => (v != null ? String(v) : null)

  return {
    ...row,
    beian_hao,
    latest_nav: listPoint.nav,
    latest_nav_date: listPoint.nav_date,
    latest_price_change,
    nav_is_team: true,
    ...(period
      ? {
          ret_1w: fmtRet(period.ret_1w),
          ret_1m: fmtRet(period.ret_1m),
          ret_3m: fmtRet(period.ret_3m),
          ret_6m: fmtRet(period.ret_6m),
          ret_1y: fmtRet(period.ret_1y),
        }
      : {}),
  }
}

function applyManagedRiskOverride(row: ManagedRow): ManagedRow {
  const override =
    lookupManagedProductOverride(row.product_name)
    ?? (row.beian_hao ? lookupManagedProductOverride(row.beian_hao) : null)
  if (!override || !row.latest_nav_date) return row
  const risk = computeManagedProductOneYearRiskMetrics(
    override.beian_hao,
    row.latest_nav_date,
  )
  return {
    ...row,
    sharpe_1y: risk.sharpe_1y != null ? String(risk.sharpe_1y) : row.sharpe_1y ?? null,
    calmar_1y: risk.calmar_1y != null ? String(risk.calmar_1y) : row.calmar_1y ?? null,
  }
}

/** Fill empty list NAV from 估值表 metrics (same source as 托管账户余额 / 资产净值). */
function applyValuationMetricsNavFallback(
  row: ManagedRow,
  metricsLookup: Awaited<ReturnType<typeof loadEmailFundMetricsLookup>>,
): ManagedRow {
  if (row.latest_nav != null && row.latest_nav_date != null) return row
  const metrics = resolveEmailFundMetrics(row.product_name, row.beian_hao, metricsLookup)
  if (
    metrics.unit_nav == null
    || !metrics.valuation_date
    || !isChinaTradingDay(metrics.valuation_date)
  ) {
    return row
  }
  return {
    ...row,
    latest_nav: String(metrics.unit_nav),
    latest_nav_date: metrics.valuation_date,
    valuation_date: row.valuation_date ?? metrics.valuation_date,
    custody_balance: row.custody_balance ?? (metrics.custody_balance != null ? String(metrics.custody_balance) : null),
    net_asset_value: row.net_asset_value ?? (metrics.net_asset_value != null ? String(metrics.net_asset_value) : null),
  }
}

/** Re-resolve list NAV when cache still has a weekend/holiday forward-fill date. */
function clampManagedRowNavToTradingDay(
  row: ManagedRow,
  asOfDate: string,
  postSeedTeamNavByBeian: Map<string, Array<{ nav_date: string; unit_nav: string }>>,
  fullTeamNavByBeian: Map<string, Array<{ nav_date: string; unit_nav: string }>>,
): ManagedRow {
  if (!row.latest_nav_date || isChinaTradingDay(row.latest_nav_date)) return row

  const beian = row.beian_hao
  const override =
    lookupManagedProductOverride(row.product_name)
    ?? (beian ? lookupManagedProductOverride(beian) : null)
  const listPoint = beian
    ? (
      resolveManagedProductListNavAt(
        override?.beian_hao ?? beian,
        asOfDate,
        postSeedTeamNavByBeian.get(override?.beian_hao ?? beian) ?? [],
      )
      ?? resolveTeamSeriesListNavAt(fullTeamNavByBeian.get(beian) ?? [], asOfDate)
    )
    : null

  if (!listPoint) {
    return { ...row, latest_nav: null, latest_nav_date: null, latest_price_change: null }
  }

  const unitNav = parseFloat(listPoint.nav)
  let latest_price_change = row.latest_price_change
  if (listPoint.prev_nav != null) {
    const prev = parseFloat(listPoint.prev_nav)
    if (Number.isFinite(unitNav) && Number.isFinite(prev) && prev !== 0) {
      latest_price_change = String(unitNav / prev - 1)
    }
  }

  return {
    ...row,
    latest_nav: listPoint.nav,
    latest_nav_date: listPoint.nav_date,
    latest_price_change,
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page        = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize    = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const offset      = (page - 1) * pageSize
    const keyword     = (searchParams.get("keyword") || "").trim()
    const strategySource = searchParams.get("strategy_source") === "platform" ? "platform" : "company"
    const strategyL1  = (searchParams.get("strategy_l1") || "").trim()
    const strategyL2  = (searchParams.get("strategy_l2") || "").trim()
    const strategyL3  = (searchParams.get("strategy_l3") || "").trim()
    const runStatus   = searchParams.get("run_status") || "running"
    const teamTagMode = searchParams.get("team_tag_mode") === "or" ? "or" : "and"
    const teamTags    = searchParams.getAll("team_tag").map((t) => t.trim()).filter(Boolean)
    const sortParam   = searchParams.get("sort") || ""
    const sortDir     = searchParams.get("dir") === "asc" ? "ASC" : "DESC"
    const cutoffRaw   = (searchParams.get("cutoff") || "").trim()
    const hasCutoff   = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)
    const asOfDate    = hasCutoff ? cutoffRaw : new Date().toISOString().slice(0, 10)
    const useCache    = await shouldUseManagedProductsListCache(cutoffRaw)

    // ─── FAST PATH — plain 2-table join, no lateral scans ───────────────────
    if (useCache) {
      await ensureManagedProductsListCachePopulated()

      const stratPrefix = strategySource === "platform" ? "platform" : "company"
      const stratCol = `cache.${stratPrefix}_strategy_l1`
      const stratL2Col = `cache.${stratPrefix}_strategy_l2`
      const stratL3Col = `cache.${stratPrefix}_strategy_l3`
      const tagsCol  = "COALESCE(cache.team_tags, '[]'::jsonb)"

      const conditions: string[] = ["m.product_name <> '合计'"]
      const params: unknown[] = []
      let pi = 1

      if (keyword) {
        conditions.push(`(m.product_name ILIKE $${pi} OR cache.beian_hao ILIKE $${pi})`)
        params.push(`%${keyword}%`)
        pi++
      }

      if (strategyL1 === "__unconfigured__") {
        conditions.push(`${stratCol} IS NULL`)
      } else if (strategyL1) {
        conditions.push(`${stratCol} = $${pi}`)
        params.push(strategyL1)
        pi++
      }
      if (strategyL2) {
        conditions.push(`${stratL2Col} = $${pi}`)
        params.push(strategyL2)
        pi++
      }
      if (strategyL3) {
        conditions.push(`COALESCE(${stratL3Col}, '') ILIKE $${pi}`)
        params.push(`%${strategyL3}%`)
        pi++
      }

      if (runStatus === "running") {
        conditions.push(`(${CACHE_AUM_EXPR} IS NULL OR ${CACHE_AUM_EXPR} > 0)`)
      } else if (runStatus === "liquidated") {
        conditions.push(`(${CACHE_AUM_EXPR} IS NOT NULL AND ${CACHE_AUM_EXPR} <= 0)`)
      }

      if (teamTags.length > 0) {
        if (teamTagMode === "or") {
          conditions.push(
            `EXISTS (SELECT 1 FROM jsonb_array_elements_text(${tagsCol}) t WHERE BTRIM(t) = ANY($${pi}::text[]))`,
          )
        } else {
          conditions.push(
            `NOT EXISTS (SELECT 1 FROM unnest($${pi}::text[]) req(tag) WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${tagsCol}) t WHERE BTRIM(t) = req.tag))`,
          )
        }
        params.push(teamTags)
        pi++
      }

      const sortCol = ALLOWED_SORT[sortParam] ?? "m.sequence_no"
      const where = conditions.join(" AND ")
      const baseFrom = `
        FROM managed_products m
        INNER JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
      `

      const [countRow, navRow] = await Promise.all([
        query<{ n: string }>(`SELECT COUNT(*)::text AS n ${baseFrom} WHERE ${where}`, params),
        query<{ t: string }>(`SELECT COALESCE(SUM(${CACHE_AUM_EXPR}), 0)::text AS t ${baseFrom} WHERE ${where}`, params),
      ])
      const total             = parseInt(countRow[0]?.n || "0", 10)
      const totalNetAssetValue = navRow[0]?.t ?? "0"

      const rows = await query<{
        id: string; beian_hao: string | null; product_name: string; short_name: string | null
        strategy_l1: string | null
        strategy_l2: string | null
        strategy_l3: string | null
        platform_strategy_l1: string | null
        platform_strategy_l2: string | null
        platform_strategy_l3: string | null
        company_strategy_l1: string | null
        company_strategy_l2: string | null
        company_strategy_l3: string | null
        latest_unit_nav: string | null; latest_nav_date: string | null
        latest_return_pct: string | null; custody_account_balance: string | null
        net_asset_value: string | null; sequence_no: number | null
        ret_1w: string | null; ret_1m: string | null; ret_3m: string | null
        ret_6m: string | null; ret_1y: string | null
        sharpe_1y: string | null; calmar_1y: string | null
      }>(
        `SELECT
           m.id::text                           AS id,
           m.sequence_no,
           cache.beian_hao,
           m.product_name,
           cache.short_name,
           ${stratCol}                          AS strategy_l1,
           ${stratL2Col}                        AS strategy_l2,
           ${stratL3Col}                        AS strategy_l3,
           cache.platform_strategy_l1,
           cache.platform_strategy_l2,
           cache.platform_strategy_l3,
           cache.company_strategy_l1,
           cache.company_strategy_l2,
           cache.company_strategy_l3,
           cache.unit_nav::text                 AS latest_unit_nav,
           cache.nav_date::text                 AS latest_nav_date,
           cache.return_pct::text               AS latest_return_pct,
           ${CACHE_CUSTODY_EXPR}::text AS custody_account_balance,
           ${CACHE_AUM_EXPR}::text AS net_asset_value,
           cache.ret_1w::text,
           cache.ret_1m::text,
           cache.ret_3m::text,
           cache.ret_6m::text,
           cache.ret_1y::text,
           cache.sharpe_1y::text,
           cache.calmar_1y::text
         ${baseFrom}
         WHERE ${where}
         ORDER BY ${sortCol} ${sortDir} NULLS LAST, m.sequence_no ASC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, pageSize, offset],
      )

      // Cache already has NAV / period metrics from the worker — do not re-run
      // team-nav / valuation lookups on every page view (was ~5s+ on this host).
      const data = rows.map(mapRow).map(applyManagedRiskOverride)
      return NextResponse.json({
        data,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        totalNetAssetValue,
      })
    }

    // ─── SLOW PATH — historical cutoff, recompute on the fly ────────────────
    const overrideBeians = Object.values(MANAGED_PRODUCT_BEIAN_OVERRIDES)
    const overrideItems = Object.entries(MANAGED_PRODUCT_BEIAN_OVERRIDES).map(
      ([product_name, beian_hao]) => ({ product_name, beian_hao }),
    )
    const [postSeedTeamNavByBeian, fullTeamNavByBeian, metricsLookup] = await Promise.all([
      loadManagedProductPostSeedExtensions(overrideBeians),
      loadManagedProductTeamNavBatch(overrideItems),
      loadEmailFundMetricsLookup(),
    ])

    async function finalizeManagedRows(rows: ManagedRow[]): Promise<ManagedRow[]> {
      const weekendItems = rows
        .filter((row) => row.latest_nav_date && !isChinaTradingDay(row.latest_nav_date) && row.beian_hao)
        .filter((row) => !fullTeamNavByBeian.has(row.beian_hao!))
        .map((row) => ({
          beian_hao: row.beian_hao!,
          product_name: row.product_name,
          short_name: row.short_name,
        }))
      if (weekendItems.length > 0) {
        const extra = await loadManagedProductTeamNavBatch(weekendItems)
        for (const [beian, series] of extra) fullTeamNavByBeian.set(beian, series)
      }

      return rows.map((row) =>
        clampManagedRowNavToTradingDay(
          applyValuationMetricsNavFallback(
            applyManagedSeedNavOverride(row, asOfDate, postSeedTeamNavByBeian, fullTeamNavByBeian),
            metricsLookup,
          ),
          asOfDate,
          postSeedTeamNavByBeian,
          fullTeamNavByBeian,
        ),
      )
    }

    const strategyPrefix = strategySource === "platform" ? "platform" : "company"
    const strategyCol  = `o.${strategyPrefix}_strategy_one`
    const strategyL2Expr = `NULLIF(BTRIM(o.${strategyPrefix}_strategy_two), '')`
    const strategyL3Expr = `NULLIF(BTRIM(o.${strategyPrefix}_strategy_three), '')`
    const strategyExpr = `COALESCE(NULLIF(BTRIM(${strategyCol}), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`
    const teamTagsExpr = `CASE WHEN jsonb_typeof(o.tag->'company') = 'array' THEN o.tag->'company' ELSE '[]'::jsonb END`
    const sortCol      = ALLOWED_SORT_SLOW[sortParam] ?? "sequence_no"

    const conditions: string[] = ["m.product_name <> '合计'"]
    const params: unknown[] = []
    let pi = 1

    if (keyword) {
      conditions.push(`(m.product_name ILIKE $${pi} OR ${BEIAN_EXPR} ILIKE $${pi})`)
      params.push(`%${keyword}%`)
      pi++
    }
    if (strategyL1 === "__unconfigured__") {
      conditions.push(`${strategyExpr} IS NULL`)
    } else if (strategyL1) {
      conditions.push(`${strategyExpr} = $${pi}`)
      params.push(strategyL1)
      pi++
    }
    if (strategyL2) {
      conditions.push(`${strategyL2Expr} = $${pi}`)
      params.push(strategyL2)
      pi++
    }
    if (strategyL3) {
      conditions.push(`COALESCE(${strategyL3Expr}, '') ILIKE $${pi}`)
      params.push(`%${strategyL3}%`)
      pi++
    }
    if (runStatus === "running") {
      conditions.push(`(m.net_asset_value IS NULL OR m.net_asset_value > 0)`)
    } else if (runStatus === "liquidated") {
      conditions.push(`(m.net_asset_value IS NOT NULL AND m.net_asset_value <= 0)`)
    }
    if (teamTags.length > 0) {
      if (teamTagMode === "or") {
        conditions.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${teamTagsExpr}) AS tv(v) WHERE BTRIM(tv.v) = ANY($${pi}::text[]))`)
      } else {
        conditions.push(`NOT EXISTS (SELECT 1 FROM unnest($${pi}::text[]) AS req(tag) WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${teamTagsExpr}) AS tv(v) WHERE BTRIM(tv.v) = req.tag))`)
      }
      params.push(teamTags)
      pi++
    }

    const where = conditions.join(" AND ")
    const baseFrom = `
      ${buildManagedProductsFrom(PRODUCT_EXPR)}
      LEFT JOIN private_fund_info pinfo ON pinfo.beian_hao = ${BEIAN_EXPR}
    `

    const [countRows, totalNavRows] = await Promise.all([
      query<{ n: string }>(`SELECT COUNT(*)::text AS n ${baseFrom} WHERE ${where}`, params),
      query<{ total_nav: string }>(`SELECT COALESCE(SUM(m.net_asset_value), 0)::text AS total_nav ${baseFrom} WHERE ${where}`, params),
    ])
    const total             = parseInt(countRows[0]?.n || "0", 10)
    const totalNetAssetValue = totalNavRows[0]?.total_nav ?? "0"

    const listParams = [...params]
    let cutoffExpr = "CURRENT_DATE"
    if (hasCutoff) {
      listParams.push(cutoffRaw)
      cutoffExpr = `$${listParams.length}::date`
    }
    const metricSql = buildManagedProductsMetricSelectSql(cutoffExpr)
    const { navExpr, dateExpr, pctExpr } = {
      navExpr: metricSql.currentNavExpr,
      dateExpr: metricSql.currentDateExpr,
      pctExpr: metricSql.currentPctExpr,
    }
    const emailNavJoins = metricSql.emailNavJoins
    const valuationJoin = managedValuationMetricsJoin(metricSql.beianExpr, PRODUCT_EXPR)
    const histJoins = [7, 30, 90, 180, 365]
      .map((days, i) => managedNavAtOffsetJoin(["h1w","h1m","h3m","h6m","h1y"][i], BEIAN_EXPR, PRODUCT_EXPR, SHORT_EXPR, days, cutoffExpr))
      .join("\n")

    const rows = await query<{
      id: string; beian_hao: string | null; product_name: string; short_name: string | null
      strategy_l1: string | null
      strategy_l2: string | null
      strategy_l3: string | null
      platform_strategy_l1: string | null
      platform_strategy_l2: string | null
      platform_strategy_l3: string | null
      company_strategy_l1: string | null
      company_strategy_l2: string | null
      company_strategy_l3: string | null
      latest_unit_nav: string | null; latest_nav_date: string | Date | null
      latest_return_pct: string | null; custody_account_balance: string | null
      net_asset_value: string | null; valuation_date: string | null
      nav_is_team: boolean; sequence_no: number | null
      ret_1w: string | null; ret_1m: string | null; ret_3m: string | null
      ret_6m: string | null; ret_1y: string | null
      sharpe_1y: string | null; calmar_1y: string | null
    }>(
      `SELECT * FROM (
         SELECT
           m.id::text AS id,
           m.sequence_no,
           ${metricSql.beianExpr} AS beian_hao,
           m.product_name,
           ${SHORT_EXPR} AS short_name,
           ${strategyExpr} AS strategy_l1,
           ${strategyL2Expr} AS strategy_l2,
           ${strategyL3Expr} AS strategy_l3,
           NULLIF(BTRIM(o.company_strategy_one), '') AS company_strategy_l1,
           NULLIF(BTRIM(o.company_strategy_two), '') AS company_strategy_l2,
           NULLIF(BTRIM(o.company_strategy_three), '') AS company_strategy_l3,
           NULLIF(BTRIM(o.platform_strategy_one), '') AS platform_strategy_l1,
           NULLIF(BTRIM(o.platform_strategy_two), '') AS platform_strategy_l2,
           NULLIF(BTRIM(o.platform_strategy_three), '') AS platform_strategy_l3,
           (${navExpr})::text AS latest_unit_nav,
           ${dateExpr} AS latest_nav_date,
           (${pctExpr})::text AS latest_return_pct,
           m.custody_account_balance::text AS custody_account_balance,
           m.net_asset_value::text AS net_asset_value,
           vm.valuation_date,
           ${MANAGED_NAV_IS_TEAM_EXPR} AS nav_is_team,
           CASE WHEN h1w.nav IS NOT NULL AND h1w.nav <> 0 THEN ((${navExpr}) / h1w.nav - 1)::text END AS ret_1w,
           CASE WHEN h1m.nav IS NOT NULL AND h1m.nav <> 0 THEN ((${navExpr}) / h1m.nav - 1)::text END AS ret_1m,
           CASE WHEN h3m.nav IS NOT NULL AND h3m.nav <> 0 THEN ((${navExpr}) / h3m.nav - 1)::text END AS ret_3m,
           CASE WHEN h6m.nav IS NOT NULL AND h6m.nav <> 0 THEN ((${navExpr}) / h6m.nav - 1)::text END AS ret_6m,
           CASE WHEN h1y.nav IS NOT NULL AND h1y.nav <> 0 THEN ((${navExpr}) / h1y.nav - 1)::text END AS ret_1y,
           pinfo.sharpe_1y::text AS sharpe_1y,
           pinfo.calmar_1y::text AS calmar_1y
         ${baseFrom}
         ${emailNavJoins}
         ${valuationJoin}
         ${histJoins}
         WHERE ${where}
       ) rows
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, sequence_no ASC
       LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`,
      [...listParams, pageSize, offset],
    )

    const data = (await finalizeManagedRows(rows.map(mapRow))).map(applyManagedRiskOverride)
    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      totalNetAssetValue,
    })
  } catch (err) {
    console.error("[managed-products/list]", err)
    return NextResponse.json({ error: "Failed to load managed products" }, { status: 500 })
  }
}
