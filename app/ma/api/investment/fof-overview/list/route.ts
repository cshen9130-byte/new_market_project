import { NextResponse } from "next/server"
import { query, fmtIso } from "@/lib/db"
import { sanitizeRiskMetricText } from "@/lib/fund-nav-metrics"
import {
  buildEmailNavLatestExprs,
  buildEmailNavLatestJoins,
} from "@/lib/server/email-nav-query"
import {
  buildFofUnderlyingSummaryFrom,
  FOF_UNDERLYING_BEIAN_EXPR,
  fofUnderlyingShortExpr,
} from "@/lib/server/fof-underlying-query"
import {
  ensureFofOverviewListCachePopulated,
  shouldUseFofOverviewListCache,
} from "@/lib/server/fof-overview-list-cache-pg"
import { sqlExcludeFofUnderlyingProduct } from "@/lib/server/fund-holding-code"
import { managedUnderlyingMarketValueExpr } from "@/lib/server/managed-fof-underlying-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  product_name: "f.product_name",
  latest_nav: "cache.unit_nav",
  latest_nav_date: "cache.nav_date",
  latest_price_change: "cache.return_pct",
  market_value: "managed_market_value",
  ret_1w: "cache.ret_1w",
  ret_1m: "cache.ret_1m",
  ret_3m: "cache.ret_3m",
  ret_6m: "cache.ret_6m",
  ret_1y: "cache.ret_1y",
  sharpe_1y: "cache.sharpe_1y",
  calmar_1y: "cache.calmar_1y",
}

const ALLOWED_SORT_SLOW: Record<string, string> = {
  product_name: "product_name",
  latest_nav: "latest_unit_nav",
  latest_nav_date: "latest_nav_date",
  latest_price_change: "latest_return_pct",
  market_value: "market_value",
  ret_1w: "ret_1w",
  ret_1m: "ret_1m",
  ret_3m: "ret_3m",
  ret_6m: "ret_6m",
  ret_1y: "ret_1y",
  sharpe_1y: "sharpe_1y",
  calmar_1y: "calmar_1y",
}

const BEIAN_EXPR = FOF_UNDERLYING_BEIAN_EXPR
const PRODUCT_EXPR = "f.product_name"
const SHORT_EXPR = fofUnderlyingShortExpr(PRODUCT_EXPR)

function fofNavScalarExpr(days: number, cutoffExpr: string): string {
  return `COALESCE(
    (SELECT ngc.nav::numeric FROM private_fund_nav_group ngc
     WHERE ngc.beian_hao = ${BEIAN_EXPR} AND ${BEIAN_EXPR} IS NOT NULL
       AND ngc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngc.price_date DESC LIMIT 1),
    (SELECT ngn.nav::numeric FROM private_fund_nav_group ngn
     WHERE ngn.product_name = ${PRODUCT_EXPR}
       AND ngn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngn.price_date DESC LIMIT 1),
    (SELECT ngs.nav::numeric FROM private_fund_nav_group ngs
     WHERE ${SHORT_EXPR} IS NOT NULL AND ngs.product_name = ${SHORT_EXPR}
       AND ngs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY ngs.price_date DESC LIMIT 1),
    (SELECT nhc.nav::numeric FROM private_fund_nav_group_hy nhc
     WHERE nhc.beian_hao = ${BEIAN_EXPR} AND ${BEIAN_EXPR} IS NOT NULL
       AND nhc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhc.price_date DESC LIMIT 1),
    (SELECT nhn.nav::numeric FROM private_fund_nav_group_hy nhn
     WHERE nhn.product_name = ${PRODUCT_EXPR}
       AND nhn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhn.price_date DESC LIMIT 1),
    (SELECT nhs.nav::numeric FROM private_fund_nav_group_hy nhs
     WHERE ${SHORT_EXPR} IS NOT NULL AND nhs.product_name = ${SHORT_EXPR}
       AND nhs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nhs.price_date DESC LIMIT 1),
    (SELECT nfc.nav::numeric FROM private_fund_nav nfc
     WHERE nfc.beian_hao = ${BEIAN_EXPR} AND ${BEIAN_EXPR} IS NOT NULL
       AND nfc.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfc.price_date DESC LIMIT 1),
    (SELECT nfn.nav::numeric FROM private_fund_nav nfn
     WHERE nfn.product_name = ${PRODUCT_EXPR}
       AND nfn.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfn.price_date DESC LIMIT 1),
    (SELECT nfs.nav::numeric FROM private_fund_nav nfs
     WHERE ${SHORT_EXPR} IS NOT NULL AND nfs.product_name = ${SHORT_EXPR}
       AND nfs.price_date <= ${cutoffExpr} - INTERVAL '${days} days'
     ORDER BY nfs.price_date DESC LIMIT 1)
  )`
}

function navAtOffset(alias: string, days: number, cutoffExpr: string): string {
  return `LEFT JOIN LATERAL (
    SELECT ${fofNavScalarExpr(days, cutoffExpr)} AS nav
  ) ${alias} ON true`
}

interface FofOverviewRow {
  id: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  market_value: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
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
  latest_unit_nav: string | null
  latest_nav_date: string | Date | null
  latest_return_pct: string | null
  market_value: string | null
  ret_1w?: string | null
  ret_1m?: string | null
  ret_3m?: string | null
  ret_6m?: string | null
  ret_1y?: string | null
  sharpe_1y?: string | null
  calmar_1y?: string | null
}): FofOverviewRow {
  return {
    id: r.id,
    beian_hao: r.beian_hao,
    product_name: r.product_name,
    short_name: r.short_name,
    strategy_l1: r.strategy_l1,
    latest_nav: r.latest_unit_nav,
    latest_nav_date: r.latest_nav_date ? fmtIso(r.latest_nav_date) : null,
    latest_price_change: r.latest_return_pct != null ? String(parseFloat(r.latest_return_pct)) : null,
    market_value: r.market_value,
    ret_1w: r.ret_1w,
    ret_1m: r.ret_1m,
    ret_3m: r.ret_3m,
    ret_6m: r.ret_6m,
    ret_1y: r.ret_1y,
    sharpe_1y: sanitizeRiskMetricText(r.sharpe_1y),
    calmar_1y: sanitizeRiskMetricText(r.calmar_1y),
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const offset = (page - 1) * pageSize
    const keyword = (searchParams.get("keyword") || "").trim()
    const strategySource = searchParams.get("strategy_source") === "platform" ? "platform" : "company"
    const strategyL1 = (searchParams.get("strategy_l1") || "").trim()
    const holdingStatus = searchParams.get("holding_status") || "holding"
    const teamTagMode = searchParams.get("team_tag_mode") === "or" ? "or" : "and"
    const teamTags = searchParams.getAll("team_tag").map((t) => t.trim()).filter(Boolean)
    const fofRegister = (searchParams.get("fof_register_number") || "").trim()
    const sortParam = searchParams.get("sort") || ""
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC"
    const cutoffRaw = (searchParams.get("cutoff") || "").trim()
    const hasCutoff = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)
    const useCache = await shouldUseFofOverviewListCache(cutoffRaw)

    // ─── FAST PATH — 2-table join on precomputed cache only (no lateral NAV / 市值 scans) ──
    if (useCache) {
      await ensureFofOverviewListCachePopulated()

      // Holding 市值 must come from latest 在管估值表 (cache), never the static
      // fof_underlying_summary spreadsheet — otherwise cleared underlyings stay in 持仓中.
      const marketValueExpr = `COALESCE(cache.market_value, 0)`
      const displayNameExpr = `CASE
        WHEN cache.short_name IS NOT NULL
          AND f.product_name ~ '[ABC]类'
          AND COALESCE(cache.short_name, '') !~ '[ABC]类'
        THEN f.product_name
        ELSE COALESCE(cache.short_name, f.product_name)
      END`

      const stratCol = strategySource === "platform"
        ? "cache.platform_strategy_l1"
        : "cache.company_strategy_l1"
      const tagsCol = "COALESCE(cache.team_tags, '[]'::jsonb)"
      const sortKey = ALLOWED_SORT[sortParam] ? sortParam : "sequence_no"
      const sortCol = sortKey === "sequence_no"
        ? "f.sequence_no"
        : sortKey === "market_value"
          ? marketValueExpr
          : ALLOWED_SORT[sortKey]

      const conditions: string[] = [
        "f.product_name <> '合计'",
        sqlExcludeFofUnderlyingProduct("f.product_name", "cache.beian_hao"),
      ]
      const params: unknown[] = []
      let pi = 1

      if (keyword) {
        conditions.push(`(
          f.product_name ILIKE $${pi}
          OR cache.beian_hao ILIKE $${pi}
        )`)
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

      if (holdingStatus === "holding") {
        conditions.push(`${marketValueExpr} > 0`)
      } else if (holdingStatus === "cleared") {
        conditions.push(`${marketValueExpr} <= 0`)
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

      if (fofRegister) {
        conditions.push(`f.fof_fund_name = (SELECT product_name FROM fof_mom_tracking WHERE register_number = $${pi} LIMIT 1)`)
        params.push(fofRegister)
        pi++
      }

      const where = conditions.join(" AND ")
      const baseFrom = `
        FROM fof_underlying_summary f
        LEFT JOIN ops_fof_overview_list_cache cache ON cache.fof_underlying_id = f.id
      `

      const [countRows, totalMvRows] = await Promise.all([
        query<{ n: string }>(`SELECT COUNT(*)::text AS n ${baseFrom} WHERE ${where}`, params),
        query<{ total_mv: string }>(
          `SELECT COALESCE(SUM(${marketValueExpr}), 0)::text AS total_mv ${baseFrom} WHERE ${where}`,
          params,
        ),
      ])
      const total = parseInt(countRows[0]?.n || "0", 10)
      const totalMarketValue = totalMvRows[0]?.total_mv ?? "0"

      if (total === 0) {
        return NextResponse.json({
          data: [],
          total: 0,
          page,
          pageSize,
          totalPages: 1,
          totalMarketValue: "0",
        })
      }

      const rows = await query<{
        id: string
        beian_hao: string | null
        product_name: string
        short_name: string | null
        strategy_l1: string | null
        latest_unit_nav: string | null
        latest_nav_date: string | null
        latest_return_pct: string | null
        market_value: string | null
        sequence_no: number | null
        ret_1w: string | null
        ret_1m: string | null
        ret_3m: string | null
        ret_6m: string | null
        ret_1y: string | null
        sharpe_1y: string | null
        calmar_1y: string | null
      }>(
        `SELECT
           f.id::text                           AS id,
           f.sequence_no,
           cache.beian_hao,
           f.product_name,
           ${displayNameExpr}                     AS short_name,
           ${stratCol}                          AS strategy_l1,
           COALESCE(cache.unit_nav, f.latest_unit_nav)::text AS latest_unit_nav,
           COALESCE(cache.nav_date, f.latest_nav_date)::text AS latest_nav_date,
           COALESCE(cache.return_pct, f.latest_return_pct)::text AS latest_return_pct,
           ${marketValueExpr}::text             AS market_value,
           cache.ret_1w::text,
           cache.ret_1m::text,
           cache.ret_3m::text,
           cache.ret_6m::text,
           cache.ret_1y::text,
           cache.sharpe_1y::text,
           cache.calmar_1y::text
         ${baseFrom}
         WHERE ${where}
         ORDER BY ${sortCol} ${sortDir} NULLS LAST, f.sequence_no ASC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, pageSize, offset],
      )

      // Serve precomputed cache as-is. Per-request BatchNavResolver / detail-series
      // patches used to take tens of seconds and freeze the 2-vCPU host; freshness
      // is the worker's job (email parse + 15m cache refresh).
      const data = rows.map(mapRow)

      return NextResponse.json({
        data,
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        totalMarketValue,
      })
    }

    // ─── SLOW PATH — historical cutoff, recompute on the fly ────────────────
    const strategyCol = strategySource === "platform" ? "o.platform_strategy_one" : "o.company_strategy_one"
    const strategyExpr = `COALESCE(NULLIF(BTRIM(${strategyCol}), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`
    const teamTagsExpr = `CASE WHEN jsonb_typeof(o.tag->'company') = 'array' THEN o.tag->'company' ELSE '[]'::jsonb END`
    const marketValueExpr = `COALESCE(${managedUnderlyingMarketValueExpr(BEIAN_EXPR, PRODUCT_EXPR)}, 0)`
    const sortKey = ALLOWED_SORT_SLOW[sortParam] ? sortParam : "sequence_no"
    // Outer ORDER BY uses the subquery alias; inner SELECT projects managed 市值 as market_value.
    const sortCol = sortKey === "sequence_no" ? "sequence_no" : ALLOWED_SORT_SLOW[sortKey]

    const conditions: string[] = [
      "f.product_name <> '合计'",
      sqlExcludeFofUnderlyingProduct("f.product_name", BEIAN_EXPR),
    ]
    const params: unknown[] = []
    let pi = 1

    if (keyword) {
      conditions.push(`(
        f.product_name ILIKE $${pi}
        OR ${BEIAN_EXPR} ILIKE $${pi}
      )`)
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

    if (holdingStatus === "holding") {
      conditions.push(`${marketValueExpr} > 0`)
    } else if (holdingStatus === "cleared") {
      conditions.push(`${marketValueExpr} <= 0`)
    }

    if (teamTags.length > 0) {
      if (teamTagMode === "or") {
        conditions.push(`EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${teamTagsExpr}) AS tag_values(tag_value)
          WHERE BTRIM(tag_value) = ANY($${pi}::text[])
        )`)
        params.push(teamTags)
        pi++
      } else {
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM unnest($${pi}::text[]) AS req(tag)
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(${teamTagsExpr}) AS tag_values(tag_value)
            WHERE BTRIM(tag_value) = req.tag
          )
        )`)
        params.push(teamTags)
        pi++
      }
    }

    if (fofRegister) {
      conditions.push(`f.fof_fund_name = (SELECT product_name FROM fof_mom_tracking WHERE register_number = $${pi} LIMIT 1)`)
      params.push(fofRegister)
      pi++
    }

    const where = conditions.join(" AND ")

    const baseFrom = `
      ${buildFofUnderlyingSummaryFrom(PRODUCT_EXPR)}
      LEFT JOIN private_fund_info pinfo ON pinfo.beian_hao = ${BEIAN_EXPR}
    `

    const [countRows, totalMvRows] = await Promise.all([
      query<{ n: string }>(`SELECT COUNT(*)::text AS n ${baseFrom} WHERE ${where}`, params),
      query<{ total_mv: string }>(
        `SELECT COALESCE(SUM(${marketValueExpr}), 0)::text AS total_mv ${baseFrom} WHERE ${where}`,
        params,
      ),
    ])
    const total = parseInt(countRows[0]?.n || "0", 10)
    const totalMarketValue = totalMvRows[0]?.total_mv ?? "0"

    if (total === 0) {
      return NextResponse.json({
        data: [],
        total: 0,
        page,
        pageSize,
        totalPages: 1,
        totalMarketValue: "0",
      })
    }

    const listParams = [...params]
    let cutoffExpr = "CURRENT_DATE"
    if (hasCutoff) {
      listParams.push(cutoffRaw)
      cutoffExpr = `$${listParams.length}::date`
    }
    const fallbackNavExpr = "f.latest_unit_nav::numeric"
    const fallbackDateExpr = "f.latest_nav_date"
    const fallbackPctExpr = "f.latest_return_pct::numeric / 100"
    const emailNavJoins = buildEmailNavLatestJoins(BEIAN_EXPR, PRODUCT_EXPR, SHORT_EXPR, cutoffExpr)
    const { navExpr: currentNavExpr, dateExpr: currentDateExpr, pctExpr: currentPctExpr } =
      buildEmailNavLatestExprs(fallbackNavExpr, fallbackDateExpr, fallbackPctExpr)
    const histJoins = [
      navAtOffset("h1w", 7, cutoffExpr),
      navAtOffset("h1m", 30, cutoffExpr),
      navAtOffset("h3m", 90, cutoffExpr),
      navAtOffset("h6m", 180, cutoffExpr),
      navAtOffset("h1y", 365, cutoffExpr),
    ].join("\n")

    const rows = await query<{
      id: string
      beian_hao: string | null
      product_name: string
      short_name: string | null
      strategy_l1: string | null
      latest_unit_nav: string | null
      latest_nav_date: string | Date | null
      latest_return_pct: string | null
      market_value: string | null
      sequence_no: number | null
      ret_1w: string | null
      ret_1m: string | null
      ret_3m: string | null
      ret_6m: string | null
      ret_1y: string | null
      sharpe_1y: string | null
      calmar_1y: string | null
    }>(
      `SELECT * FROM (
         SELECT
           f.id::text AS id,
           f.sequence_no,
           ${BEIAN_EXPR} AS beian_hao,
           f.product_name,
           ${SHORT_EXPR} AS short_name,
           ${strategyExpr} AS strategy_l1,
           (${currentNavExpr})::text AS latest_unit_nav,
           ${currentDateExpr} AS latest_nav_date,
           (${currentPctExpr})::text AS latest_return_pct,
           ${marketValueExpr}::text AS market_value,
           CASE WHEN h1w.nav IS NOT NULL AND h1w.nav <> 0
             THEN ((${currentNavExpr}) / h1w.nav - 1)::text END AS ret_1w,
           CASE WHEN h1m.nav IS NOT NULL AND h1m.nav <> 0
             THEN ((${currentNavExpr}) / h1m.nav - 1)::text END AS ret_1m,
           CASE WHEN h3m.nav IS NOT NULL AND h3m.nav <> 0
             THEN ((${currentNavExpr}) / h3m.nav - 1)::text END AS ret_3m,
           CASE WHEN h6m.nav IS NOT NULL AND h6m.nav <> 0
             THEN ((${currentNavExpr}) / h6m.nav - 1)::text END AS ret_6m,
           CASE WHEN h1y.nav IS NOT NULL AND h1y.nav <> 0
             THEN ((${currentNavExpr}) / h1y.nav - 1)::text END AS ret_1y,
           pinfo.sharpe_1y::text AS sharpe_1y,
           pinfo.calmar_1y::text AS calmar_1y
         ${baseFrom}
         ${emailNavJoins}
         ${histJoins}
         WHERE ${where}
       ) rows
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, sequence_no ASC
       LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`,
      [...listParams, pageSize, offset],
    )

    return NextResponse.json({
      data: rows.map(mapRow),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      totalMarketValue,
    })
  } catch (err) {
    console.error("[investment/fof-overview/list]", err)
    return NextResponse.json({ error: "Failed to load FOF overview data" }, { status: 500 })
  }
}
