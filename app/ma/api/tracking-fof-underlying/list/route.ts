import { NextResponse } from "next/server"
import { query, fmtIso } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  seq_no: "seq_no",
  manager_name: "manager_name",
  product_name: "product_name",
  beian_hao: "beian_hao",
  unit_nav: "unit_nav",
  nav_date: "nav_date",
  price_change: "price_change",
  ret_1w: "ret_1w",
  ret_1m: "ret_1m",
  ret_3m: "ret_3m",
  ret_6m: "ret_6m",
  ret_1y: "ret_1y",
  sharpe_1y: "sharpe_1y",
  calmar_1y: "calmar_1y",
}

interface TrackingFofUnderlyingRow {
  id: number
  seq_no: number | null
  manager_name: string
  product_name: string
  beian_hao: string
  unit_nav: string | null
  nav_date: string | null
  price_change: string | null
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
    const sortParam = searchParams.get("sort") || "seq_no"
    const sortKey = ALLOWED_SORT[sortParam] ? sortParam : "seq_no"
    const sortDir = searchParams.get("dir") === "asc" ? "ASC" : "DESC"
    const sortCol = ALLOWED_SORT[sortKey]
    const isExport = searchParams.get("export") === "1"
    const limit = isExport ? 100000 : pageSize
    const exportOffset = isExport ? 0 : offset

    const conditions: string[] = []
    const params: unknown[] = []
    let pi = 1

    if (keyword) {
      conditions.push(`(
        manager_name ILIKE $${pi}
        OR product_name ILIKE $${pi}
        OR beian_hao ILIKE $${pi}
      )`)
      params.push(`%${keyword}%`)
      pi++
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

    const countRows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM investment_tracking_fof_underlying ${where}`,
      params,
    )
    const total = parseInt(countRows[0]?.n || "0", 10)

    const rows = await query<{
      id: number
      seq_no: number | null
      manager_name: string
      product_name: string
      beian_hao: string
      unit_nav: string | number | null
      nav_date: string | Date | null
      price_change: string | number | null
      ret_1w: string | number | null
      ret_1m: string | number | null
      ret_3m: string | number | null
      ret_6m: string | number | null
      ret_1y: string | number | null
      sharpe_1y: string | number | null
      calmar_1y: string | number | null
    }>(
      `SELECT
         id,
         seq_no,
         manager_name,
         product_name,
         beian_hao,
         unit_nav,
         nav_date,
         price_change,
         ret_1w,
         ret_1m,
         ret_3m,
         ret_6m,
         ret_1y,
         sharpe_1y,
         calmar_1y
       FROM investment_tracking_fof_underlying
       ${where}
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, seq_no ASC NULLS LAST, id ASC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, exportOffset],
    )

    const data: TrackingFofUnderlyingRow[] = rows.map((r) => ({
      id: r.id,
      seq_no: r.seq_no,
      manager_name: r.manager_name,
      product_name: r.product_name,
      beian_hao: r.beian_hao,
      unit_nav: fmtNum(r.unit_nav),
      nav_date: r.nav_date ? fmtIso(r.nav_date) : null,
      price_change: fmtNum(r.price_change),
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
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    console.error("[tracking-fof-underlying/list]", err)
    return NextResponse.json({ error: "Failed to load FOF underlying products" }, { status: 500 })
  }
}
