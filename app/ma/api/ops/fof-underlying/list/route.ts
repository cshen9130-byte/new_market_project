import { NextResponse } from "next/server"
import { query, fmtIso } from "@/lib/db"
import {
  buildEmailNavLatestExprs,
  buildEmailNavLatestJoins,
} from "@/lib/server/email-nav-query"
import {
  buildFofUnderlyingSummaryFrom,
  FOF_UNDERLYING_BEIAN_EXPR,
  fofUnderlyingShortExpr,
  sqlFofUnderlyingIdentityKey,
  sqlFofUnderlyingIdentityTiebreak,
} from "@/lib/server/fof-underlying-query"
import {
  ensureFofOverviewListCachePopulated,
  shouldUseFofOverviewListCache,
} from "@/lib/server/fof-overview-list-cache-pg"
import {
  sqlExcludeFofUnderlyingProduct,
  sqlFofUnderlyingFundClassFilter,
  type FofUnderlyingFundClass,
} from "@/lib/server/fund-holding-code"
import { managedUnderlyingMarketValueExpr } from "@/lib/server/managed-fof-underlying-pg"
import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  product_name: "f.product_name",
  latest_nav: "cache.unit_nav",
  latest_nav_date: "cache.nav_date",
  latest_price_change: "cache.return_pct",
}

const ALLOWED_SORT_SLOW: Record<string, string> = {
  product_name: "f.product_name",
  latest_nav: "f.latest_unit_nav",
  latest_nav_date: "f.latest_nav_date",
  latest_price_change: "f.latest_return_pct",
}

interface FofRow {
  id: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  nav_estimated: boolean
  valuation_date: string | null
}

const BEIAN_EXPR = FOF_UNDERLYING_BEIAN_EXPR
const PRODUCT_EXPR = "f.product_name"
const SHORT_EXPR = fofUnderlyingShortExpr(PRODUCT_EXPR)

function mapRow(r: {
  id: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  latest_unit_nav: string | null
  latest_nav_date: string | Date | null
  latest_return_pct: string | null
}): FofRow {
  const navDate = r.latest_nav_date ? fmtIso(r.latest_nav_date) : null
  const productName = stripValuationSubjectPathPrefix(r.product_name) || r.product_name
  const shortName = r.short_name
    ? (stripValuationSubjectPathPrefix(r.short_name) || r.short_name)
    : null
  return {
    id: r.id,
    beian_hao: r.beian_hao,
    product_name: productName,
    short_name: shortName,
    strategy_l1: r.strategy_l1,
    latest_nav: r.latest_unit_nav,
    latest_nav_date: navDate,
    latest_price_change: r.latest_return_pct != null ? String(parseFloat(r.latest_return_pct)) : null,
    nav_estimated: r.latest_unit_nav != null,
    valuation_date: navDate,
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
    const fundClass: FofUnderlyingFundClass =
      searchParams.get("fund_class") === "public" ? "public" : "private"
    const fofRegister = (searchParams.get("fof_register_number") || "").trim()
    const sortParam = searchParams.get("sort") || ""
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC"
    const cutoffRaw = (searchParams.get("cutoff") || "").trim()
    const hasCutoff = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)
    const useCache = await shouldUseFofOverviewListCache(cutoffRaw)

    // ─── FAST PATH — precomputed nightly cache, instant page load ───────────
    if (useCache) {
      await ensureFofOverviewListCachePopulated()

      const stratCol = strategySource === "platform"
        ? "cache.platform_strategy_l1"
        : "cache.company_strategy_l1"
      const sortKey = ALLOWED_SORT[sortParam] ? sortParam : "sequence_no"

      const conditions: string[] = [
        "f.product_name <> '合计'",
        sqlExcludeFofUnderlyingProduct("f.product_name", "cache.beian_hao"),
        sqlFofUnderlyingFundClassFilter(fundClass, "f.product_name", "cache.beian_hao"),
      ]
      const params: unknown[] = []
      let pi = 1

      if (keyword) {
        conditions.push(`(f.product_name ILIKE $${pi} OR cache.beian_hao ILIKE $${pi})`)
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

      // Same rule as FOF概览: holding status follows latest 在管估值表 cache, not the static spreadsheet.
      const marketValueExpr = `COALESCE(cache.market_value, 0)`
      if (holdingStatus === "holding") {
        conditions.push(`${marketValueExpr} > 0`)
      } else if (holdingStatus === "cleared") {
        conditions.push(`${marketValueExpr} <= 0`)
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
      const identityKey = sqlFofUnderlyingIdentityKey("cache.beian_hao", "f.id")
      const identityTie = sqlFofUnderlyingIdentityTiebreak("f.product_name", "f.id")
      const outerSort =
        sortKey === "sequence_no" ? "sequence_no"
          : sortKey === "product_name" ? "product_name"
            : sortKey === "latest_nav" ? "latest_unit_nav"
              : sortKey === "latest_nav_date" ? "latest_nav_date"
                : sortKey === "latest_price_change" ? "latest_return_pct"
                  : "sequence_no"
      const dedupedSelect = `
        SELECT DISTINCT ON (${identityKey})
           f.id::text                           AS id,
           f.sequence_no,
           cache.beian_hao,
           f.product_name,
           COALESCE(cache.short_name, f.product_name) AS short_name,
           ${stratCol}                          AS strategy_l1,
           COALESCE(cache.unit_nav, f.latest_unit_nav)::text AS latest_unit_nav,
           COALESCE(cache.nav_date, f.latest_nav_date)::text AS latest_nav_date,
           COALESCE(cache.return_pct, f.latest_return_pct)::text AS latest_return_pct
         ${baseFrom}
         WHERE ${where}
         ORDER BY ${identityKey}, ${identityTie}
      `

      const countRows = await query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM (${dedupedSelect}) x`,
        params,
      )
      const total = parseInt(countRows[0]?.n || "0", 10)

      if (total === 0) {
        return NextResponse.json({
          data: [],
          total: 0,
          page,
          pageSize,
          totalPages: 1,
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
        sequence_no: number | null
      }>(
        `SELECT
           id,
           sequence_no,
           beian_hao,
           product_name,
           short_name,
           strategy_l1,
           latest_unit_nav,
           latest_nav_date,
           latest_return_pct
         FROM (${dedupedSelect}) rows
         ORDER BY ${outerSort} ${sortDir} NULLS LAST, sequence_no ASC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, pageSize, offset],
      )

      return NextResponse.json({
        data: rows.map(mapRow),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      })
    }

    // ─── SLOW PATH — historical cutoff, recompute on the fly ────────────────
    const strategyCol = strategySource === "platform" ? "o.platform_strategy_one" : "o.company_strategy_one"
    const strategyExpr = `COALESCE(NULLIF(BTRIM(${strategyCol}), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`
    const sortKey = ALLOWED_SORT_SLOW[sortParam] ? sortParam : "sequence_no"
    const sortCol = sortKey === "sequence_no" ? "sequence_no"
      : sortKey === "latest_nav" ? "latest_unit_nav"
        : sortKey === "latest_nav_date" ? "latest_nav_date"
          : sortKey === "latest_price_change" ? "latest_return_pct"
            : "product_name"

    const conditions: string[] = [
      "f.product_name <> '合计'",
      sqlExcludeFofUnderlyingProduct("f.product_name", BEIAN_EXPR),
      sqlFofUnderlyingFundClassFilter(fundClass, "f.product_name", BEIAN_EXPR),
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

    const marketValueExpr = `COALESCE(${managedUnderlyingMarketValueExpr(BEIAN_EXPR, PRODUCT_EXPR)}, 0)`
    if (holdingStatus === "holding") {
      conditions.push(`${marketValueExpr} > 0`)
    } else if (holdingStatus === "cleared") {
      conditions.push(`${marketValueExpr} <= 0`)
    }

    if (fofRegister) {
      conditions.push(`f.fof_fund_name = (SELECT product_name FROM fof_mom_tracking WHERE register_number = $${pi} LIMIT 1)`)
      params.push(fofRegister)
      pi++
    }

    const where = conditions.join(" AND ")
    const baseFrom = buildFofUnderlyingSummaryFrom(PRODUCT_EXPR)
    const identityKey = sqlFofUnderlyingIdentityKey(BEIAN_EXPR, "f.id")
    const identityTie = sqlFofUnderlyingIdentityTiebreak("f.product_name", "f.id")

    const countRows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM (
         SELECT DISTINCT ON (${identityKey}) f.id
         ${baseFrom}
         WHERE ${where}
         ORDER BY ${identityKey}, ${identityTie}
       ) x`,
      params,
    )
    const total = parseInt(countRows[0]?.n || "0", 10)

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

    const rows = await query<{
      id: string
      beian_hao: string | null
      product_name: string
      short_name: string | null
      strategy_l1: string | null
      latest_unit_nav: string | null
      latest_nav_date: string | Date | null
      latest_return_pct: string | null
    }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (${identityKey})
           f.id::text AS id,
           f.sequence_no,
           ${BEIAN_EXPR} AS beian_hao,
           f.product_name,
           COALESCE(b.short_name, o.fund_short_name, f.product_name) AS short_name,
           ${strategyExpr} AS strategy_l1,
           (${currentNavExpr})::text AS latest_unit_nav,
           ${currentDateExpr} AS latest_nav_date,
           (${currentPctExpr})::text AS latest_return_pct
         ${baseFrom}
         ${emailNavJoins}
         WHERE ${where}
         ORDER BY ${identityKey}, ${identityTie}
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
    })
  } catch (err) {
    console.error("[fof-underlying/list]", err)
    return NextResponse.json({ error: "Failed to load FOF underlying data" }, { status: 500 })
  }
}
