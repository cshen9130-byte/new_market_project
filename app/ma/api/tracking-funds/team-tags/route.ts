import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface TeamTagRow {
  tag: string
}

export async function GET() {
  const rows = await query<TeamTagRow>(
    `SELECT DISTINCT BTRIM(tag) AS tag
     FROM private_fund_info_bfl
     CROSS JOIN LATERAL regexp_split_to_table(COALESCE(strategy_company, ''), ',') AS tag
     WHERE BTRIM(tag) <> ''
     ORDER BY tag`
  )

  return NextResponse.json(rows.map((r) => r.tag))
}