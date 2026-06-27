import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") || "").trim()
  if (!q) {
    return NextResponse.json([])
  }

  try {
    const rows = await query<{ manager_name: string }>(
      `SELECT DISTINCT TRIM(manager) AS manager_name
       FROM private_fund_info
       WHERE TRIM(manager) <> ''
         AND manager ILIKE $1
       ORDER BY manager_name ASC
       LIMIT 20`,
      [`${q}%`],
    )
    return NextResponse.json(rows.map((r) => r.manager_name).filter(Boolean))
  } catch (err) {
    console.error("[private-funds/managers/search]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
