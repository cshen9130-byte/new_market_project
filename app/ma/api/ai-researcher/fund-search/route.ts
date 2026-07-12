import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export interface FundSearchResult {
  beian_hao: string
  product_name: string
  manager: string
  strategy_l1: string | null
  strategy_l2: string | null
  inception_date: string | null
  latest_nav: string | null
  ret_1y: string | null
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get("q") || "").trim()
  const type = (searchParams.get("type") || "fund").trim() // "fund" | "manager"

  if (!q || q.length < 1) {
    return NextResponse.json([])
  }

  try {
    if (type === "manager") {
      const rows = await query<FundSearchResult>(
        `SELECT DISTINCT ON (i.manager)
           i.beian_hao, i.product_name, i.manager,
           i.strategy_l1, i.strategy_l2,
           i.inception_date::text AS inception_date,
           i.latest_nav::text AS latest_nav,
           i.ret_1y::text AS ret_1y
         FROM private_fund_info i
         WHERE i.manager ILIKE $1
         ORDER BY i.manager, i.inception_date DESC NULLS LAST
         LIMIT 15`,
        [`%${q}%`],
      )
      return NextResponse.json(rows)
    }

    const rows = await query<FundSearchResult>(
      `SELECT
         i.beian_hao, i.product_name, i.manager,
         i.strategy_l1, i.strategy_l2,
         i.inception_date::text AS inception_date,
         i.latest_nav::text AS latest_nav,
         i.ret_1y::text AS ret_1y
       FROM private_fund_info i
       WHERE i.product_name ILIKE $1
          OR i.beian_hao ILIKE $1
          OR i.manager ILIKE $1
       ORDER BY i.product_name ASC
       LIMIT 20`,
      [`%${q}%`],
    )
    return NextResponse.json(rows)
  } catch (err) {
    console.error("[ai-researcher/fund-search]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
