import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface ManagerBatchResult {
  manager_name: string
  registration_no: string | null
}

function resultKey(r: ManagerBatchResult): string {
  return r.registration_no || r.manager_name
}

export async function POST(req: NextRequest) {
  try {
    const { keywords } = await req.json() as { keywords: string[] }
    if (!Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json({ results: [] })
    }
    const terms = keywords.slice(0, 100).map((k) => String(k).trim()).filter(Boolean)
    if (terms.length === 0) return NextResponse.json({ results: [] })

    const results = await Promise.all(
      terms.map(async (term) => {
        const pattern = `%${term}%`
        const rows = await query<ManagerBatchResult>(
          `SELECT DISTINCT
             COALESCE(NULLIF(TRIM(manager), ''), NULLIF(TRIM(investment_advisor), '')) AS manager_name,
             NULLIF(TRIM(registration_no), '') AS registration_no
           FROM private_fund_info_bfl
           WHERE manager ILIKE $1
              OR investment_advisor ILIKE $1
              OR registration_no ILIKE $1
           ORDER BY
             CASE WHEN registration_no = $2 THEN 0
                  WHEN registration_no ILIKE $1 THEN 1
                  WHEN manager ILIKE $3 THEN 2
                  ELSE 3
             END,
             manager_name ASC NULLS LAST
           LIMIT 5`,
          [pattern, term, `${term}%`],
        )
        return { term, rows: rows.filter((r) => r.manager_name) }
      }),
    )

    const seen = new Set<string>()
    const found: ManagerBatchResult[] = []
    for (const { rows } of results) {
      if (rows.length > 0) {
        const r = rows[0]
        const key = resultKey(r)
        if (!seen.has(key)) {
          seen.add(key)
          found.push(r)
        }
      }
    }

    return NextResponse.json({ results: found })
  } catch (err) {
    console.error("[tracking-managers/batch-search]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
