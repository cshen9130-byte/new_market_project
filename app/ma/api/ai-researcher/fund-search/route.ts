import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import {
  sqlResolvedStrategySelect,
  sqlType6LatestStrategyJoin,
} from "@/lib/server/fund-strategy-resolve"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export interface FundSearchResult {
  beian_hao: string
  product_name: string
  manager: string
  strategy_l1: string | null
  strategy_l2: string | null
  strategy_l3: string | null
  inception_date: string | null
  latest_nav: string | null
  ret_1y: string | null
}

const FUND_SEARCH_SELECT = `
         i.beian_hao, i.product_name, i.manager,
         ${sqlResolvedStrategySelect("i")},
         i.inception_date::text AS inception_date,
         i.latest_nav::text AS latest_nav,
         i.ret_1y::text AS ret_1y`

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
           ${FUND_SEARCH_SELECT}
         FROM private_fund_info i
         ${sqlType6LatestStrategyJoin("i.beian_hao")}
         WHERE i.manager ILIKE $1
         ORDER BY i.manager, i.inception_date DESC NULLS LAST
         LIMIT 15`,
        [`%${q}%`],
      )
      return NextResponse.json(rows)
    }

    const rows = await query<FundSearchResult>(
      `SELECT
         ${FUND_SEARCH_SELECT}
       FROM private_fund_info i
       ${sqlType6LatestStrategyJoin("i.beian_hao")}
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
