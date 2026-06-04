import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface TeamTagRow {
  tag: string
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const requestedPool = searchParams.get("pool")
  const pool = requestedPool === "tracking" || requestedPool === "selected" || requestedPool === "core" || requestedPool === "hy" || requestedPool === "fof" ? requestedPool : "bfl"
  if (pool === "tracking" || pool === "selected" || pool === "core" || pool === "hy" || pool === "fof") {
    const rows = await query<TeamTagRow>(
      `SELECT DISTINCT BTRIM(tag_value) AS tag
       FROM type6_ops_team_full
       CROSS JOIN LATERAL jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(tag->'company') = 'array' THEN tag->'company' ELSE '[]'::jsonb END
       ) AS tag_values(tag_value)
       WHERE BTRIM(tag_value) <> ''
       ORDER BY tag`
    )

    return NextResponse.json(rows.map((r) => r.tag))
  }

  const rows = await query<TeamTagRow>(
    `SELECT DISTINCT BTRIM(tag) AS tag
     FROM private_fund_info_bfl
     CROSS JOIN LATERAL regexp_split_to_table(COALESCE(strategy_company, ''), ',') AS tag
     WHERE BTRIM(tag) <> ''
     ORDER BY tag`
  )

  return NextResponse.json(rows.map((r) => r.tag))
}