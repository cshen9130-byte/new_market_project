import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_SORT: Record<string, string> = {
  seq_no: "seq_no",
  manager_name: "manager_name",
  private_fund_manager_company: "private_fund_manager_company",
  years_of_experience: "years_of_experience",
  funds_under_management: "funds_under_management",
  representative_fund: "representative_fund",
  tenure_return_pct: "tenure_return_pct",
}

interface ManagerRow {
  id: number
  seq_no: number
  manager_name: string
  private_fund_manager_company: string
  years_of_experience: number | null
  funds_under_management: number | null
  representative_fund: string | null
  tenure_return_pct: number | null
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10))
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10)))
    const offset = (page - 1) * pageSize
    const keyword = (searchParams.get("keyword") || "").trim() // Filter by Manager Name
    const companyKeyword = (searchParams.get("company_keyword") || "").trim() // Filter by Company Name
    const yearsOfExp = (searchParams.get("years_of_experience") || "").trim() // Experience range
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
      conditions.push(`manager_name ILIKE $${pi}`)
      params.push(`%${keyword}%`)
      pi++
    }

    if (companyKeyword) {
      conditions.push(`private_fund_manager_company ILIKE $${pi}`)
      params.push(`%${companyKeyword}%`)
      pi++
    }

    if (yearsOfExp && yearsOfExp !== "不限") {
      if (yearsOfExp === "20年以上") {
        conditions.push(`years_of_experience >= $${pi}`)
        params.push(20)
        pi++
      } else if (yearsOfExp === "15-20年") {
        conditions.push(`years_of_experience >= $${pi} AND years_of_experience < $${pi + 1}`)
        params.push(15, 20)
        pi += 2
      } else if (yearsOfExp === "10-15年") {
        conditions.push(`years_of_experience >= $${pi} AND years_of_experience < $${pi + 1}`)
        params.push(10, 15)
        pi += 2
      } else if (yearsOfExp === "5-10年") {
        conditions.push(`years_of_experience >= $${pi} AND years_of_experience < $${pi + 1}`)
        params.push(5, 10)
        pi += 2
      } else if (yearsOfExp === "0-5年") {
        conditions.push(`years_of_experience >= $${pi} AND years_of_experience < $${pi + 1}`)
        params.push(0, 5)
        pi += 2
      }
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

    const countRows = await query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM private_fund_managers ${where}`,
      params,
    )
    const total = parseInt(countRows[0]?.n || "0", 10)

    const rows = await query<{
      id: number
      seq_no: number
      manager_name: string
      private_fund_manager_company: string
      years_of_experience: string | null
      funds_under_management: number | null
      representative_fund: string | null
      tenure_return_pct: string | null
    }>(
      `SELECT
         id,
         seq_no,
         manager_name,
         private_fund_manager_company,
         years_of_experience,
         funds_under_management,
         representative_fund,
         tenure_return_pct
       FROM private_fund_managers
       ${where}
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, seq_no ASC NULLS LAST, id ASC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, exportOffset],
    )

    const data: ManagerRow[] = rows.map((r) => ({
      id: r.id,
      seq_no: r.seq_no,
      manager_name: r.manager_name,
      private_fund_manager_company: r.private_fund_manager_company,
      years_of_experience: r.years_of_experience ? parseFloat(r.years_of_experience) : null,
      funds_under_management: r.funds_under_management,
      representative_fund: r.representative_fund,
      tenure_return_pct: r.tenure_return_pct ? parseFloat(r.tenure_return_pct) : null,
    }))

    return NextResponse.json({
      data,
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    })
  } catch (err) {
    console.error("[private-fund-managers/list-details]", err)
    return NextResponse.json({ error: "Failed to load private fund managers details" }, { status: 500 })
  }
}
