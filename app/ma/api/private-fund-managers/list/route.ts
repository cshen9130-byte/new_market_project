import { NextResponse } from "next/server"
import { query, fmtIso } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  manager_name: "manager_name",
  mgmt_scale: "mgmt_scale",
  active_product_count: "active_product_count",
  inception_date: "inception_date",
  member_type: "member_type",
  registration_no: "registration_no",
  seq_no: "seq_no",
}

const MGMT_SCALE_MAP: Record<string, string> = {
  "100亿以上": "100亿元以上",
  "50-100亿": "50-100亿元",
  "20-50亿": "20-50亿元",
  "10-20亿": "10-20亿元",
  "5-10亿": "5-10亿元",
  "0-5亿": "0-5亿元",
}

interface ManagerRow {
  id: number
  seq_no: number | null
  manager_name: string
  core_strategy: string | null
  mgmt_scale: string | null
  active_product_count: number | null
  inception_date: string | null
  member_type: string | null
  registration_no: string
}

function inceptionBounds(period: string): [string | null, string | null] {
  const today = new Date()
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const addMonths = (m: number) => {
    const d = new Date(today)
    d.setMonth(d.getMonth() - m)
    return fmt(d)
  }
  const addYears = (y: number) => {
    const d = new Date(today)
    d.setFullYear(d.getFullYear() - y)
    return fmt(d)
  }
  switch (period) {
    case "6个月以内": return [addMonths(6), null]
    case "6个月-1年": return [addYears(1), addMonths(6)]
    case "1-3年": return [addYears(3), addYears(1)]
    case "3-5年": return [addYears(5), addYears(3)]
    case "5年以上": return [null, addYears(5)]
    default: return [null, null]
  }
}

function productCountBounds(range: string): [number | null, number | null] {
  switch (range) {
    case "0-10": return [0, 10]
    case "10-50": return [10, 50]
    case "50-100": return [50, 100]
    case "100-500": return [100, 500]
    case "500以上": return [500, null]
    default: return [null, null]
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const offset = (page - 1) * pageSize
    const keyword = (searchParams.get("keyword") || "").trim()
    const coreStrategy = (searchParams.get("core_strategy") || "").trim()
    const mgmtScale = (searchParams.get("mgmt_scale") || "").trim()
    const memberType = (searchParams.get("member_type") || "").trim()
    const inceptionPeriod = (searchParams.get("inception") || "").trim()
    const productCount = (searchParams.get("product_count") || "").trim()
    const sortParam = searchParams.get("sort") || "seq_no"
    const sortKey = ALLOWED_SORT[sortParam] ? sortParam : "seq_no"
    const sortDir = searchParams.get("dir") === "desc" ? "DESC" : "ASC"
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
      conditions.push(`core_strategy ILIKE $${pi}`)
      params.push(`%${coreStrategy}%`)
      pi++
    }

    if (mgmtScale) {
      const mapped = MGMT_SCALE_MAP[mgmtScale] ?? mgmtScale
      conditions.push(`mgmt_scale = $${pi}`)
      params.push(mapped)
      pi++
    }

    if (memberType) {
      conditions.push(`member_type = $${pi}`)
      params.push(memberType)
      pi++
    }

    const [incMin, incMax] = inceptionBounds(inceptionPeriod)
    if (incMin) {
      conditions.push(`inception_date >= $${pi}::date`)
      params.push(incMin)
      pi++
    }
    if (incMax) {
      conditions.push(`inception_date < $${pi}::date`)
      params.push(incMax)
      pi++
    }

    const [pcMin, pcMax] = productCountBounds(productCount)
    if (pcMin != null) {
      conditions.push(`active_product_count >= $${pi}`)
      params.push(pcMin)
      pi++
    }
    if (pcMax != null) {
      conditions.push(`active_product_count < $${pi}`)
      params.push(pcMax)
      pi++
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

    const countRows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM private_fund_managers_list ${where}`,
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
         registration_no
       FROM private_fund_managers_list
       ${where}
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, seq_no ASC NULLS LAST, id ASC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, exportOffset],
    )

    const data: ManagerRow[] = rows.map((r) => ({
      id: r.id,
      seq_no: r.seq_no,
      manager_name: r.manager_name,
      core_strategy: r.core_strategy,
      mgmt_scale: r.mgmt_scale,
      active_product_count: r.active_product_count,
      inception_date: r.inception_date ? fmtIso(r.inception_date) : null,
      member_type: r.member_type,
      registration_no: r.registration_no,
    }))

    return NextResponse.json({
      data,
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    console.error("[private-fund-managers/list]", err)
    return NextResponse.json({ error: "Failed to load private fund managers" }, { status: 500 })
  }
}
