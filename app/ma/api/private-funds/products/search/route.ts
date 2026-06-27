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
