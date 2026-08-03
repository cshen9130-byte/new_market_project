import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { searchPrivateFundProductsForFastPicker } from "@/lib/server/private-fund-product-search"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") || "").trim()
  if (!q) {
    return NextResponse.json([])
  }

  const format = (searchParams.get("format") || "").trim()

  try {
    if (format === "picker") {
      // Fast prefix search + in-memory A/B/C synthesis (no multi-table fuzzy path).
      const rows = await searchPrivateFundProductsForFastPicker(q, 20)
      return NextResponse.json(rows)
    }

    const rows = await query<{ product_name: string }>(
      `SELECT DISTINCT TRIM(product_name) AS product_name
       FROM private_fund_info
       WHERE product_name ILIKE $1 OR beian_hao ILIKE $1
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
