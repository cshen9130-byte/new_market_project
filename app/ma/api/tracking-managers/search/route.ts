import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface ManagerSearchResult {
  manager_name: string
  registration_no: string | null
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") || "").trim()
  if (!q) {
    return NextResponse.json([])
  }

  try {
    const rows = await query<ManagerSearchResult>(
      `SELECT DISTINCT
         COALESCE(NULLIF(TRIM(manager), ''), NULLIF(TRIM(investment_advisor), '')) AS manager_name,
         NULLIF(TRIM(registration_no), '') AS registration_no
       FROM private_fund_info_bfl
       WHERE manager ILIKE $1
          OR investment_advisor ILIKE $1
          OR registration_no ILIKE $1
          OR product_name ILIKE $1
       ORDER BY manager_name ASC NULLS LAST
       LIMIT 20`,
      [`%${q}%`],
    )

    const seen = new Set<string>()
    const data = rows
      .filter((r) => r.manager_name)
      .filter((r) => {
        const key = `${r.manager_name}::${r.registration_no ?? ""}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

    return NextResponse.json(data)
  } catch (err) {
    console.error("[tracking-managers/search]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
