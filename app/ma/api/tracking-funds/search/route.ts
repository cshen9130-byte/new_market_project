import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface SearchResult {
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

  try {
    const rows = await query<SearchResult>(
      `SELECT beian_hao, product_name, short_name, strategy_one
       FROM private_fund_info_bfl
       WHERE product_name ILIKE $1
          OR short_name   ILIKE $1
          OR beian_hao    ILIKE $1
       ORDER BY
         CASE
           WHEN beian_hao    ILIKE $2 THEN 0
           WHEN product_name ILIKE $2 THEN 1
           ELSE 2
         END,
         product_name ASC
       LIMIT 20`,
      [`%${q}%`, `${q}%`]
    )
    return NextResponse.json(rows)
  } catch (err) {
    console.error("[tracking-funds/search]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
