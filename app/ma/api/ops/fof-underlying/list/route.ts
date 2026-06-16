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
} from "@/lib/server/fof-underlying-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
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

function buildFofUnderlyingBaseFrom(productNameExpr: string): string {
  return buildFofUnderlyingSummaryFrom(productNameExpr)
}

const BEIAN_EXPR = FOF_UNDERLYING_BEIAN_EXPR

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
    const sortParam = searchParams.get("sort") || ""
    const sortKey = ALLOWED_SORT[sortParam] ? sortParam : "sequence_no"
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC"
    const sortCol = sortKey === "sequence_no" ? "f.sequence_no" : ALLOWED_SORT[sortKey]

    const strategyCol = strategySource === "platform" ? "o.platform_strategy_one" : "o.company_strategy_one"
    const strategyExpr = `COALESCE(NULLIF(BTRIM(${strategyCol}), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`

    const conditions: string[] = ["f.product_name <> '合计'"]
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
      conditions.push(`COALESCE(f.market_value, 0) > 0`)
    } else if (holdingStatus === "cleared") {
      conditions.push(`COALESCE(f.market_value, 0) <= 0`)
    }

    const where = conditions.join(" AND ")
    const baseFrom = buildFofUnderlyingBaseFrom("f.product_name")

    const countRows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n ${baseFrom} WHERE ${where}`,
      params,
    )
    const total = parseInt(countRows[0]?.n || "0", 10)

    const productExpr = "f.product_name"
    const shortExpr = fofUnderlyingShortExpr(productExpr)
    const cutoffExpr = "CURRENT_DATE"
    const fallbackNavExpr = "f.latest_unit_nav::numeric"
    const fallbackDateExpr = "f.latest_nav_date"
    const fallbackPctExpr = "f.latest_return_pct::numeric / 100"
    const emailNavJoins = buildEmailNavLatestJoins(BEIAN_EXPR, productExpr, shortExpr, cutoffExpr)
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
      `SELECT
         f.id::text AS id,
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
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, f.sequence_no ASC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, pageSize, offset],
    )

    const data: FofRow[] = rows.map((r) => ({
      id: r.id,
      beian_hao: r.beian_hao,
      product_name: r.product_name,
      short_name: r.short_name,
      strategy_l1: r.strategy_l1,
      latest_nav: r.latest_unit_nav,
      latest_nav_date: r.latest_nav_date ? fmtIso(r.latest_nav_date) : null,
      latest_price_change: r.latest_return_pct != null ? String(parseFloat(r.latest_return_pct)) : null,
      nav_estimated: r.latest_unit_nav != null,
      valuation_date: null,
    }))

    return NextResponse.json({
      data,
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
