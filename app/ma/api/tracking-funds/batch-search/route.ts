import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"

export async function POST(req: NextRequest) {
  try {
    const { keywords } = await req.json() as { keywords: string[] }
    if (!Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json({ results: [] })
    }
    const terms = keywords.slice(0, 100).map((k) => String(k).trim()).filter(Boolean)
    if (terms.length === 0) return NextResponse.json({ results: [] })

    // For each term, find the best match (exact beian_hao > name/short_name prefix > partial)
    const results = await Promise.all(
      terms.map(async (term) => {
        const pattern = `%${term}%`
        const rows = await query<{ beian_hao: string; product_name: string; short_name: string | null; strategy_one: string | null }>(
          `SELECT beian_hao, product_name, short_name, strategy_one
           FROM private_fund_info_bfl
           WHERE product_name ILIKE $1
              OR short_name   ILIKE $1
              OR beian_hao    ILIKE $1
           ORDER BY
             CASE WHEN beian_hao    = $2      THEN 0
                  WHEN beian_hao    ILIKE $1  THEN 1
                  WHEN product_name ILIKE $3  THEN 2
                  ELSE 3
             END, product_name ASC
           LIMIT 5`,
          [pattern, term, `${term}%`]
        )
        return { term, rows }
      })
    )

    // Flatten: return best match per term (first row), deduplicated by beian_hao
    const seen = new Set<string>()
    const found: { beian_hao: string; product_name: string; short_name: string | null; strategy_one: string | null }[] = []
    for (const { rows } of results) {
      if (rows.length > 0) {
        const r = rows[0]
        if (!seen.has(r.beian_hao)) {
          seen.add(r.beian_hao)
          found.push(r)
        }
      }
    }

    return NextResponse.json({ results: found })
  } catch (err) {
    console.error("[batch-search]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
