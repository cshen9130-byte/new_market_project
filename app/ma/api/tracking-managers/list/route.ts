import { NextResponse } from "next/server"
import { query, fmtIso } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  manager_name: "manager_name",
  mgmt_scale: "mgmt_scale",
  active_product_count: "active_product_count",
  inception_date: "inception_date",
  tracking_date: "tracking_date",
}

interface TrackingManagerRow {
  id: number
  seq_no: number | null
  manager_name: string
  core_strategy: string | null
  mgmt_scale: string | null
  active_product_count: number | null
  inception_date: string | null
  member_type: string | null
  registration_no: string
  contact_person: string | null
  tracking_date: string | null
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const offset = (page - 1) * pageSize
    const keyword = (searchParams.get("keyword") || "").trim()
    const coreStrategy = (searchParams.get("core_strategy") || "").trim()
    const sortParam = searchParams.get("sort") || "tracking_date"
    const sortKey = ALLOWED_SORT[sortParam] ? sortParam : "tracking_date"
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
        OR registration_no ILIKE $${pi}
      )`)
      params.push(`%${keyword}%`)
      pi++
    }

    if (coreStrategy) {
      conditions.push(`core_strategy = $${pi}`)
      params.push(coreStrategy)
      pi++
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

    const countRows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM investment_tracking_managers ${where}`,
      params,
    )
    const total = parseInt(countRows[0]?.n || "0", 10)

    const rows = await query<{
      id: number
      seq_no: number | null
      manager_name: string
      core_strategy: string | null
      mgmt_scale: string | null
      active_product_count: number | null
      inception_date: string | Date | null
      member_type: string | null
      registration_no: string
      contact_person: string | null
      tracking_date: string | Date | null
    }>(
      `SELECT
         id,
         seq_no,
         manager_name,
         core_strategy,
         mgmt_scale,
         active_product_count,
         inception_date,
         member_type,
         registration_no,
         contact_person,
         tracking_date
       FROM investment_tracking_managers
       ${where}
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, seq_no ASC NULLS LAST, id ASC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, exportOffset],
    )

    const data: TrackingManagerRow[] = rows.map((r) => ({
      id: r.id,
      seq_no: r.seq_no,
      manager_name: r.manager_name,
      core_strategy: r.core_strategy,
      mgmt_scale: r.mgmt_scale,
      active_product_count: r.active_product_count,
      inception_date: r.inception_date ? fmtIso(r.inception_date) : null,
      member_type: r.member_type,
      registration_no: r.registration_no,
      contact_person: r.contact_person,
      tracking_date: r.tracking_date ? fmtIso(r.tracking_date) : null,
    }))

    return NextResponse.json({
      data,
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    console.error("[tracking-managers/list]", err)
    return NextResponse.json({ error: "Failed to load tracking managers" }, { status: 500 })
  }
}
