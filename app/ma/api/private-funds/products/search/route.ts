import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface PickerSearchResult {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_one: string | null
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") || "").trim()
  if (!q) {
    return NextResponse.json([])
  }

  const format = (searchParams.get("format") || "").trim()

  try {
    if (format === "picker") {
      const rows = await query<PickerSearchResult>(
        `SELECT beian_hao, product_name, NULL::text AS short_name, strategy_l1 AS strategy_one
         FROM private_fund_info
         WHERE TRIM(product_name) <> ''
           AND (product_name ILIKE $1 OR beian_hao ILIKE $1)
         ORDER BY
           CASE
             WHEN beian_hao    ILIKE $2 THEN 0
             WHEN product_name ILIKE $2 THEN 1
             ELSE 2
           END,
           product_name ASC
         LIMIT 20`,
        [`%${q}%`, `${q}%`],
      )
      return NextResponse.json(rows)
    }

    const rows = await query<{ product_name: string }>(
      `SELECT DISTINCT TRIM(product_name) AS product_name
       FROM private_fund_info
       WHERE TRIM(product_name) <> ''
         AND (product_name ILIKE $1 OR beian_hao ILIKE $1)
       ORDER BY product_name ASC
       LIMIT 20`,
      [`${q}%`],
    )
    return NextResponse.json(rows.map((r) => r.product_name).filter(Boolean))
  } catch (err) {
    console.error("[private-funds/products/search]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
