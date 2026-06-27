import { NextResponse } from "next/server"
import { query, fmtIso } from "@/lib/db"
import { resolveRouteFundId } from "@/lib/server/fof-underlying-query"
import { extractManagerBrand, resolveCompanyManagerName } from "@/lib/server/fund-company-query"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  product_name: "i.product_name",
  latest_nav: "i.latest_nav",
  ret_1w: "i.ret_1w",
  ret_1m: "i.ret_1m",
  ret_3m: "i.ret_3m",
  ret_6m: "i.ret_6m",
  ret_1y: "i.ret_1y",
  sharpe_1y: "i.sharpe_1y",
  calmar_1y: "i.calmar_1y",
  inception_date: "i.inception_date",
}

interface ProductRow {
  beian_hao: string
  product_name: string
  strategy_l1: string | null
  strategy_l2: string | null
  inception_date: string | null
  benchmark: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  latest_nav: string | null
  latest_nav_date: string | null
}

function fmtNum(v: unknown): string | null {
  if (v == null) return null
  return String(v)
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ beian_hao: string }> },
) {
  try {
    const { beian_hao: rawId } = await params
    const beian_hao = await resolveRouteFundId(rawId)
    if (!beian_hao) {
      return NextResponse.json({ error: "Missing beian_hao" }, { status: 400 })
    }

    const managerName = await resolveCompanyManagerName(beian_hao)
    if (!managerName) {
      return NextResponse.json({ data: [], total: 0, page: 1, pageSize: 50, totalPages: 1, strategies: [], cutoff_date: null })
    }

    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const offset = (page - 1) * pageSize
    const keyword = (searchParams.get("keyword") || "").trim()
    const strategy = (searchParams.get("strategy") || "").trim()
    const sortParam = searchParams.get("sort") || "product_name"
    const sortKey = ALLOWED_SORT[sortParam] ? sortParam : "product_name"
    const sortDir = searchParams.get("dir") === "desc" ? "DESC" : "ASC"
    const sortCol = ALLOWED_SORT[sortKey]
    const cutoffDate = (searchParams.get("cutoff") || new Date().toISOString().slice(0, 10)).trim()

    const brand = extractManagerBrand(managerName)
    const conditions: string[] = ["(i.manager ILIKE $1 OR ($2 <> '' AND i.product_name ILIKE $3))"]
    const filterParams: unknown[] = [`%${managerName}%`, brand ?? "", brand ? `%${brand}%` : ""]
    let pi = 4

    if (keyword) {
      conditions.push(`(i.product_name ILIKE $${pi} OR i.beian_hao ILIKE $${pi})`)
      filterParams.push(`%${keyword}%`)
      pi++
    }

    if (strategy && strategy !== "全部") {
      conditions.push(`(i.strategy_l1 = $${pi} OR i.strategy_l2 = $${pi})`)
      filterParams.push(strategy)
      pi++
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`

    const strategyRows = await query<{ strategy_l1: string | null }>(
      `SELECT DISTINCT i.strategy_l1
       FROM private_fund_info i
       WHERE (i.manager ILIKE $1 OR ($2 <> '' AND i.product_name ILIKE $3))
         AND i.strategy_l1 IS NOT NULL AND BTRIM(i.strategy_l1) <> ''
       ORDER BY i.strategy_l1`,
      [`%${managerName}%`, brand ?? "", brand ? `%${brand}%` : ""],
    ).catch(() => [] as { strategy_l1: string | null }[])

    const [countRow, rows] = await Promise.all([
      query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM private_fund_info i ${whereClause}`,
        filterParams,
      ),
      query<{
        beian_hao: string
        product_name: string
        strategy_l1: string | null
        strategy_l2: string | null
        inception_date: string | Date | null
        benchmark: string | null
        ret_1w: string | number | null
        ret_1m: string | number | null
        ret_3m: string | number | null
        ret_6m: string | number | null
        ret_1y: string | number | null
        sharpe_1y: string | number | null
        calmar_1y: string | number | null
        latest_nav: string | number | null
        latest_nav_date: string | Date | null
      }>(
        `SELECT
           i.beian_hao,
           i.product_name,
           i.strategy_l1,
           i.strategy_l2,
           i.inception_date,
           i.benchmark,
           i.ret_1w::text,
           i.ret_1m::text,
           i.ret_3m::text,
           i.ret_6m::text,
           i.ret_1y::text,
           i.sharpe_1y::text,
           i.calmar_1y::text,
           i.latest_nav::text,
           i.latest_nav_date::text
         FROM private_fund_info i
         ${whereClause}
         ORDER BY ${sortCol} ${sortDir} NULLS LAST, i.product_name ASC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...filterParams, pageSize, offset],
      ),
    ])

    const total = parseInt(countRow[0]?.total || "0", 10)
    const data: ProductRow[] = rows.map((r) => ({
      beian_hao: r.beian_hao,
      product_name: r.product_name,
      strategy_l1: r.strategy_l1,
      strategy_l2: r.strategy_l2,
      inception_date: r.inception_date ? fmtIso(r.inception_date) : null,
      benchmark: r.benchmark,
      ret_1w: fmtNum(r.ret_1w),
      ret_1m: fmtNum(r.ret_1m),
      ret_3m: fmtNum(r.ret_3m),
      ret_6m: fmtNum(r.ret_6m),
      ret_1y: fmtNum(r.ret_1y),
      sharpe_1y: fmtNum(r.sharpe_1y),
      calmar_1y: fmtNum(r.calmar_1y),
      latest_nav: fmtNum(r.latest_nav),
      latest_nav_date: r.latest_nav_date ? fmtIso(r.latest_nav_date) : null,
    }))

    return NextResponse.json({
      data,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      strategies: strategyRows.map((r) => r.strategy_l1).filter(Boolean),
      cutoff_date: cutoffDate,
      manager_name: managerName,
    })
  } catch (err) {
    console.error("[private-funds/company/products]", err)
    return NextResponse.json({ error: "Failed to load company products" }, { status: 500 })
  }
}
