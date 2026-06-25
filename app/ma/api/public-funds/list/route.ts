import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  product_name: "fund_name",
  latest_nav_date: "latest_nav_date",
  ret_ytd: "ret_ytd",
  ret_ann: "ret_ann_since_inception",
  inception_date: "inception_date",
}

interface PublicFundRow {
  fund_code: string
  fund_name: string
  fund_company: string | null
  latest_nav_date: string | null
  ret_ytd: string | null
  ret_ann_since_inception: string | null
  inception_date: string | null
}

/** Public mutual fund list — queries public_fund_info when available. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
  const offset = (page - 1) * pageSize
  const keyword = (searchParams.get("keyword") || "").trim()
  const sortParam = searchParams.get("sort") || "product_name"
  const sortKey = ALLOWED_SORT[sortParam] ? sortParam : "product_name"
  const sortDir = searchParams.get("dir") === "desc" ? "DESC" : "ASC"
  const sortCol = ALLOWED_SORT[sortKey]
  const cutoffRaw = (searchParams.get("cutoff") || "").trim()
  const cutoffDate = /^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw) ? cutoffRaw : null

  if (!keyword) {
    return NextResponse.json({ data: [], total: 0, page, pageSize, totalPages: 0 })
  }

  try {
    const conditions: string[] = []
    const params: unknown[] = []
    let pi = 1

    conditions.push(`(
      fund_name ILIKE $${pi}
      OR fund_code ILIKE $${pi}
      OR COALESCE(fund_company, '') ILIKE $${pi}
    )`)
    params.push(`%${keyword}%`)
    pi++

    if (cutoffDate) {
      conditions.push(`(latest_nav_date IS NULL OR latest_nav_date <= $${pi})`)
      params.push(cutoffDate)
      pi++
    }

    const where = `WHERE ${conditions.join(" AND ")}`

    const countRows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public_fund_info ${where}`,
      params,
    )
    const total = parseInt(countRows[0]?.n || "0", 10)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    const rows = await query<PublicFundRow>(
      `SELECT
         fund_code,
         fund_name,
         fund_company,
         latest_nav_date::text AS latest_nav_date,
         ret_ytd::text AS ret_ytd,
         ret_ann_since_inception::text AS ret_ann_since_inception,
         inception_date::text AS inception_date
       FROM public_fund_info
       ${where}
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, fund_code ASC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, pageSize, offset],
    )

    return NextResponse.json({
      data: rows.map((row) => ({
        fund_code: row.fund_code,
        fund_name: row.fund_name,
        fund_company: row.fund_company,
        latest_nav_date: row.latest_nav_date,
        ret_ytd: row.ret_ytd,
        ret_ann_since_inception: row.ret_ann_since_inception,
        inception_date: row.inception_date,
      })),
      total,
      page,
      pageSize,
      totalPages,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("public_fund_info") && msg.includes("does not exist")) {
      return NextResponse.json({ data: [], total: 0, page, pageSize, totalPages: 0 })
    }
    console.error("[public-funds/list]", msg)
    return NextResponse.json({ error: "db_error", detail: msg }, { status: 500 })
  }
}
