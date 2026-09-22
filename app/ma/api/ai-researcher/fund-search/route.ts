import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import {
  sqlResolvedStrategySelect,
  sqlType6LatestStrategyJoin,
} from "@/lib/server/fund-strategy-resolve"
import { fundNameKey, sqlFundNameKey } from "@/lib/server/fund-name-match"

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

    const key = fundNameKey(q)
    const rows = await query<FundSearchResult>(
      `SELECT
         ${FUND_SEARCH_SELECT}
       FROM private_fund_info i
       ${sqlType6LatestStrategyJoin("i.beian_hao")}
       WHERE i.product_name ILIKE $1
          OR i.beian_hao ILIKE $1
          OR i.manager ILIKE $1
          OR ($2::text IS NOT NULL AND ${sqlFundNameKey("i.product_name")} = $2)
       ORDER BY i.product_name ASC
       LIMIT 20`,
      [`%${q}%`, key],
    )
    const have = new Set(rows.map((r) => r.beian_hao.trim().toUpperCase()))
    const bfl = await query<FundSearchResult>(
      `SELECT
         BTRIM(b.beian_hao) AS beian_hao,
         COALESCE(NULLIF(BTRIM(b.product_name), ''), BTRIM(b.beian_hao)) AS product_name,
         COALESCE(i.manager, '') AS manager,
         i.strategy_l1, i.strategy_l2, i.strategy_l3,
         i.inception_date::text AS inception_date,
         i.latest_nav::text AS latest_nav,
         i.ret_1y::text AS ret_1y
       FROM private_fund_info_bfl b
       LEFT JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = UPPER(BTRIM(b.beian_hao))
       WHERE b.product_name ILIKE $1
          OR b.beian_hao ILIKE $1
          OR ($2::text IS NOT NULL AND ${sqlFundNameKey("b.product_name")} = $2)
       ORDER BY b.product_name ASC
       LIMIT 20`,
      [`%${q}%`, key],
    ).catch(() => [] as FundSearchResult[])
    const extra = bfl.filter((r) => {
      const code = r.beian_hao.trim().toUpperCase()
      if (have.has(code)) return false
      have.add(code)
      return true
    })
    return NextResponse.json([...extra, ...rows].slice(0, 20))
  } catch (err) {
    console.error("[ai-researcher/fund-search]", err)
    return NextResponse.json({ error: "db_error" }, { status: 500 })
  }
}
