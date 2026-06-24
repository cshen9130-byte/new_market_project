import { NextResponse } from "next/server"
import { resolveManagedProductBeian, lookupManagedProductOverride } from "@/lib/server/managed-product-beian"
import { computeManagedProductOneYearRiskMetrics } from "@/lib/server/managed-product-nav-seed"
import { query, fmtIso } from "@/lib/db"
import {
  buildEmailNavLatestExprs,
  buildEmailNavLatestJoins,
} from "@/lib/server/email-nav-query"
import {
  buildManagedProductsFrom,
  fofUnderlyingShortExpr,
} from "@/lib/server/fof-underlying-query"
import { managedNavAtOffsetJoin, MANAGED_BEIAN_EXPR } from "@/lib/server/managed-products-nav-query"
import {
  ensureManagedProductsListCachePopulated,
  useManagedProductsListCache,
} from "@/lib/server/managed-products-list-cache-pg"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  product_name: "m.product_name",
  latest_nav: "cache.unit_nav",
  latest_nav_date: "cache.nav_date",
  latest_price_change: "cache.return_pct",
  custody_balance: "COALESCE(cache.custody_balance, m.custody_account_balance)",
  net_asset_value: "COALESCE(cache.net_asset_value, m.net_asset_value)",
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
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  custody_balance: string | null
  net_asset_value: string | null
  valuation_date: string | null
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
  latest_unit_nav: string | null
  latest_nav_date: string | Date | null
  latest_return_pct: string | null
  custody_account_balance: string | null
  net_asset_value: string | null
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
    latest_nav: r.latest_unit_nav,
    latest_nav_date: r.latest_nav_date ? fmtIso(r.latest_nav_date) : null,
    latest_price_change: r.latest_return_pct != null ? String(parseFloat(r.latest_return_pct)) : null,
    custody_balance: r.custody_account_balance,
    net_asset_value: r.net_asset_value,
    valuation_date: r.latest_nav_date ? fmtIso(r.latest_nav_date) : null,
    ret_1w: r.ret_1w,
    ret_1m: r.ret_1m,
    ret_3m: r.ret_3m,
    ret_6m: r.ret_6m,
    ret_1y: r.ret_1y,
    sharpe_1y: r.sharpe_1y,
    calmar_1y: r.calmar_1y,
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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page        = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize    = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const offset      = (page - 1) * pageSize
    const keyword     = (searchParams.get("keyword") || "").trim()
    const strategySource = searchParams.get("strategy_source") === "platform" ? "platform" : "company"
    const strategyL1  = (searchParams.get("strategy_l1") || "").trim()
    const runStatus   = searchParams.get("run_status") || "running"
    const teamTagMode = searchParams.get("team_tag_mode") === "or" ? "or" : "and"
    const teamTags    = searchParams.getAll("team_tag").map((t) => t.trim()).filter(Boolean)
    const sortParam   = searchParams.get("sort") || ""
    const sortDir     = searchParams.get("dir") === "asc" ? "ASC" : "DESC"
    const cutoffRaw   = (searchParams.get("cutoff") || "").trim()
    const hasCutoff   = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)
    const useCache    = useManagedProductsListCache(cutoffRaw)

    // ─── FAST PATH — plain 2-table join, no lateral scans ───────────────────
    if (useCache) {
      await ensureManagedProductsListCachePopulated()

      const stratCol = strategySource === "platform"
        ? "cache.platform_strategy_l1"
        : "cache.company_strategy_l1"
      const tagsCol  = "COALESCE(cache.team_tags, '[]'::jsonb)"
      const sortCol  = ALLOWED_SORT[sortParam] ?? "m.sequence_no"

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

      if (runStatus === "running") {
        conditions.push(`(COALESCE(cache.net_asset_value, m.net_asset_value) IS NULL OR COALESCE(cache.net_asset_value, m.net_asset_value) > 0)`)
      } else if (runStatus === "liquidated") {
        conditions.push(`(COALESCE(cache.net_asset_value, m.net_asset_value) IS NOT NULL AND COALESCE(cache.net_asset_value, m.net_asset_value) <= 0)`)
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

      const where = conditions.join(" AND ")
      const baseFrom = `
        FROM managed_products m
        INNER JOIN ops_managed_products_list_cache cache ON cache.managed_product_id = m.id
      `

      const [countRow, navRow] = await Promise.all([
        query<{ n: string }>(`SELECT COUNT(*)::text AS n ${baseFrom} WHERE ${where}`, params),
        query<{ t: string }>(`SELECT COALESCE(SUM(COALESCE(cache.net_asset_value, m.net_asset_value)), 0)::text AS t ${baseFrom} WHERE ${where}`, params),
      ])
      const total             = parseInt(countRow[0]?.n || "0", 10)
      const totalNetAssetValue = navRow[0]?.t ?? "0"

      const rows = await query<{
        id: string; beian_hao: string | null; product_name: string; short_name: string | null
        strategy_l1: string | null; latest_unit_nav: string | null; latest_nav_date: string | null
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
           cache.unit_nav::text                 AS latest_unit_nav,
           cache.nav_date::text                 AS latest_nav_date,
           cache.return_pct::text               AS latest_return_pct,
           COALESCE(cache.custody_balance, m.custody_account_balance)::text AS custody_account_balance,
           COALESCE(cache.net_asset_value, m.net_asset_value)::text AS net_asset_value,
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

      return NextResponse.json({
        data: rows.map(mapRow).map(applyManagedRiskOverride),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        totalNetAssetValue,
      })
    }

    // ─── SLOW PATH — historical cutoff, recompute on the fly ────────────────
    const strategyCol  = strategySource === "platform" ? "o.platform_strategy_one" : "o.company_strategy_one"
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
    const fallbackNavExpr = "m.latest_unit_nav::numeric"
    const fallbackDateExpr = "m.latest_nav_date"
    const fallbackPctExpr = "m.latest_return_pct::numeric / 100"
    const emailNavJoins = buildEmailNavLatestJoins(BEIAN_EXPR, PRODUCT_EXPR, SHORT_EXPR, cutoffExpr)
    const { navExpr, dateExpr, pctExpr } = buildEmailNavLatestExprs(fallbackNavExpr, fallbackDateExpr, fallbackPctExpr)
    const histJoins = [7, 30, 90, 180, 365]
      .map((days, i) => managedNavAtOffsetJoin(["h1w","h1m","h3m","h6m","h1y"][i], BEIAN_EXPR, PRODUCT_EXPR, SHORT_EXPR, days, cutoffExpr))
      .join("\n")

    const rows = await query<{
      id: string; beian_hao: string | null; product_name: string; short_name: string | null
      strategy_l1: string | null; latest_unit_nav: string | null; latest_nav_date: string | Date | null
      latest_return_pct: string | null; custody_account_balance: string | null
      net_asset_value: string | null; sequence_no: number | null
      ret_1w: string | null; ret_1m: string | null; ret_3m: string | null
      ret_6m: string | null; ret_1y: string | null
      sharpe_1y: string | null; calmar_1y: string | null
    }>(
      `SELECT * FROM (
         SELECT
           m.id::text AS id,
           m.sequence_no,
           ${BEIAN_EXPR} AS beian_hao,
           m.product_name,
           ${SHORT_EXPR} AS short_name,
           ${strategyExpr} AS strategy_l1,
           (${navExpr})::text AS latest_unit_nav,
           ${dateExpr} AS latest_nav_date,
           (${pctExpr})::text AS latest_return_pct,
           m.custody_account_balance::text AS custody_account_balance,
           m.net_asset_value::text AS net_asset_value,
           CASE WHEN h1w.nav IS NOT NULL AND h1w.nav <> 0 THEN ((${navExpr}) / h1w.nav - 1)::text END AS ret_1w,
           CASE WHEN h1m.nav IS NOT NULL AND h1m.nav <> 0 THEN ((${navExpr}) / h1m.nav - 1)::text END AS ret_1m,
           CASE WHEN h3m.nav IS NOT NULL AND h3m.nav <> 0 THEN ((${navExpr}) / h3m.nav - 1)::text END AS ret_3m,
           CASE WHEN h6m.nav IS NOT NULL AND h6m.nav <> 0 THEN ((${navExpr}) / h6m.nav - 1)::text END AS ret_6m,
           CASE WHEN h1y.nav IS NOT NULL AND h1y.nav <> 0 THEN ((${navExpr}) / h1y.nav - 1)::text END AS ret_1y,
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
      data: rows.map(mapRow).map(applyManagedRiskOverride),
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
