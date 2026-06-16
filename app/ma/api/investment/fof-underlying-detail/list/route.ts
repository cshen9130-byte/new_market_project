import { NextResponse } from "next/server"
import { query, fmtIso } from "@/lib/db"
import {
  buildEmailNavLatestExprs,
  buildEmailNavLatestJoins,
} from "@/lib/server/email-nav-query"
import {
  buildFofUnderlyingBeianJoins,
  FOF_UNDERLYING_BEIAN_EXPR,
  fofUnderlyingShortExpr,
} from "@/lib/server/fof-underlying-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRODUCT_EXPR = "d.product_name"
const BEIAN_EXPR = `COALESCE(NULLIF(BTRIM(d.beian_hao), ''), ${FOF_UNDERLYING_BEIAN_EXPR})`
const SHORT_EXPR = fofUnderlyingShortExpr(PRODUCT_EXPR)

const ALLOWED_SORT: Record<string, string> = {
  seq_no: "seq_no",
  fof_fund_name: "fof_fund_name",
  product_name: "product_name",
  beian_hao: "beian_hao",
  unit_nav: "unit_nav",
  nav_date: "nav_date",
  price_change: "price_change",
  investment_shares: "investment_shares",
  market_value: "market_value",
  market_value_pct: "market_value_pct",
  ret_1w: "ret_1w",
  ret_1m: "ret_1m",
  ret_3m: "ret_3m",
  ret_6m: "ret_6m",
  ret_1y: "ret_1y",
  sharpe_1y: "sharpe_1y",
  calmar_1y: "calmar_1y",
}

interface FofDetailRow {
  id: string
  seq_no: number | null
  fof_fund_name: string
  product_name: string
  short_name: string | null
  beian_hao: string | null
  unit_nav: string | null
  nav_date: string | null
  price_change: string | null
  investment_shares: string | null
  market_value: string | null
  market_value_pct: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
}

function fmtNum(v: unknown): string | null {
  if (v == null) return null
  return String(v)
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const offset = (page - 1) * pageSize
    const keyword = (searchParams.get("keyword") || "").trim()
    const fofFundName = (searchParams.get("fof_fund_name") || "").trim()
    const valuationDate = (searchParams.get("valuation_date") || "").trim()
    const sortParam = searchParams.get("sort") || ""
    const sortKey = ALLOWED_SORT[sortParam] ? sortParam : "seq_no"
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC"
    const sortCol = ALLOWED_SORT[sortKey]

    const conditions: string[] = []
    const params: unknown[] = []
    let pi = 1

    if (keyword) {
      conditions.push(`(
        d.fof_fund_name ILIKE $${pi}
        OR d.product_name ILIKE $${pi}
        OR COALESCE(${BEIAN_EXPR}, '') ILIKE $${pi}
      )`)
      params.push(`%${keyword}%`)
      pi++
    }

    if (fofFundName) {
      conditions.push(`d.fof_fund_name = $${pi}`)
      params.push(fofFundName)
      pi++
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(valuationDate)) {
      conditions.push(`d.nav_date = $${pi}::date`)
      params.push(valuationDate)
      pi++
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

    const baseFrom = `
      FROM fof_underlying_detail d
      ${buildFofUnderlyingBeianJoins(PRODUCT_EXPR)}
    `

    const [countRows, totalMvRows] = await Promise.all([
      query<{ n: string }>(`SELECT COUNT(*)::text AS n ${baseFrom} ${where}`, params),
      query<{ total_mv: string }>(
        `SELECT COALESCE(SUM(d.market_value), 0)::text AS total_mv ${baseFrom} ${where}`,
        params,
      ),
    ])
    const total = parseInt(countRows[0]?.n || "0", 10)
    const totalMarketValue = totalMvRows[0]?.total_mv ?? "0"

    const cutoffExpr = "CURRENT_DATE"
    const fallbackNavExpr = "d.unit_nav::numeric"
    const fallbackDateExpr = "d.nav_date"
    const fallbackPctExpr = "d.price_change::numeric / 100"
    const emailNavJoins = buildEmailNavLatestJoins(BEIAN_EXPR, PRODUCT_EXPR, SHORT_EXPR, cutoffExpr)
    const { navExpr: currentNavExpr, dateExpr: currentDateExpr, pctExpr: currentPctExpr } =
      buildEmailNavLatestExprs(fallbackNavExpr, fallbackDateExpr, fallbackPctExpr)

    const rows = await query<{
      id: number
      seq_no: number | null
      fof_fund_name: string
      product_name: string
      short_name: string | null
      beian_hao: string | null
      unit_nav: string | number | null
      nav_date: string | Date | null
      price_change: string | number | null
      investment_shares: string | number | null
      market_value: string | number | null
      market_value_pct: string | number | null
      ret_1w: string | number | null
      ret_1m: string | number | null
      ret_3m: string | number | null
      ret_6m: string | number | null
      ret_1y: string | number | null
      sharpe_1y: string | number | null
      calmar_1y: string | number | null
    }>(
      `SELECT
         d.id,
         d.seq_no,
         d.fof_fund_name,
         d.product_name,
         ${SHORT_EXPR} AS short_name,
         ${BEIAN_EXPR} AS beian_hao,
         (${currentNavExpr})::text AS unit_nav,
         ${currentDateExpr} AS nav_date,
         (${currentPctExpr})::text AS price_change,
         d.investment_shares,
         d.market_value,
         d.market_value_pct,
         d.ret_1w,
         d.ret_1m,
         d.ret_3m,
         d.ret_6m,
         d.ret_1y,
         d.sharpe_1y,
         d.calmar_1y
       ${baseFrom}
       ${emailNavJoins}
       ${where}
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, d.seq_no ASC NULLS LAST, d.id ASC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, pageSize, offset],
    )

    const data: FofDetailRow[] = rows.map((r) => ({
      id: String(r.id),
      seq_no: r.seq_no,
      fof_fund_name: r.fof_fund_name,
      product_name: r.product_name,
      short_name: r.short_name,
      beian_hao: r.beian_hao,
      unit_nav: fmtNum(r.unit_nav),
      nav_date: r.nav_date ? fmtIso(r.nav_date) : null,
      price_change: r.price_change != null ? String(parseFloat(r.price_change)) : null,
      investment_shares: fmtNum(r.investment_shares),
      market_value: fmtNum(r.market_value),
      market_value_pct: fmtNum(r.market_value_pct),
      ret_1w: fmtNum(r.ret_1w),
      ret_1m: fmtNum(r.ret_1m),
      ret_3m: fmtNum(r.ret_3m),
      ret_6m: fmtNum(r.ret_6m),
      ret_1y: fmtNum(r.ret_1y),
      sharpe_1y: fmtNum(r.sharpe_1y),
      calmar_1y: fmtNum(r.calmar_1y),
    }))

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      totalMarketValue,
    })
  } catch (err) {
    console.error("[investment/fof-underlying-detail/list]", err)
    return NextResponse.json({ error: "Failed to load FOF underlying detail data" }, { status: 500 })
  }
}
