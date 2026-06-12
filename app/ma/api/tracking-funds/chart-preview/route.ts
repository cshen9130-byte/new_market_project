import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

// GET /ma/api/tracking-funds/chart-preview?beian_hao=XXX&days=90
// Returns rebased cumulative returns for the fund + HS300 benchmark
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  const days = Math.max(30, Math.min(365, Number(searchParams.get("days") || 90)))
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  // Fund name lookup
  const nameRow = await query<{ product_name: string; fund_short_name: string | null }>(
    `SELECT COALESCE(b.fund_short_name, t.product_name) AS product_name, b.fund_short_name
     FROM type6_ops_team_full t
     LEFT JOIN basicinfo_bfl_track b ON b.register_number = t.register_number
     WHERE t.register_number = $1
     LIMIT 1`,
    [beian_hao]
  ).catch(() => [] as { product_name: string; fund_short_name: string | null }[])

  const fundName = nameRow[0]?.product_name ?? beian_hao

  // NAV series from the fund
  const navRows = await query<{ price_date: string; level: string }>(
    `WITH candidates AS (
       SELECT price_date::text AS price_date, COALESCE(cumulative_nav, nav)::text AS level, 0 AS pri
       FROM private_fund_nav_group_type6 WHERE beian_hao = $1
       UNION ALL
       SELECT price_date::text, COALESCE(cumulative_nav, nav)::text, 1
       FROM private_fund_nav_group WHERE beian_hao = $1
       UNION ALL
       SELECT price_date::text, COALESCE(cumulative_nav, nav)::text, 2
       FROM private_fund_nav_group_hy WHERE beian_hao = $1
       UNION ALL
       SELECT price_date::text, COALESCE(cumulative_nav, nav)::text, 3
       FROM private_fund_nav WHERE beian_hao = $1
     ),
     best AS (SELECT MIN(pri) AS pri FROM candidates),
     deduped AS (
       SELECT DISTINCT ON (price_date) price_date, level
       FROM candidates c JOIN best b ON c.pri = b.pri
       ORDER BY price_date ASC
     )
     SELECT price_date, level
     FROM deduped
     WHERE price_date >= (CURRENT_DATE - ($2::int))::text
     ORDER BY price_date ASC`,
    [beian_hao, days]
  )

  // HS300 ETF (510300.SH) benchmark
  const benchRows = await query<{ trade_date: string; value: string }>(
    `SELECT trade_date::text AS trade_date, value::text
     FROM raw_etf_daily
     WHERE ticker = '510300.SH' AND field = 'ORIGINALUNIT'
       AND trade_date >= CURRENT_DATE - ($1::int)
     ORDER BY trade_date ASC`,
    [days]
  )

  // Rebase both series to 0% at first overlapping date
  const fundMap = new Map(navRows.map((r) => [r.price_date, parseFloat(r.level)]))
  const benchMap = new Map(benchRows.map((r) => [r.trade_date, parseFloat(r.value)]))

  // Union of all dates
  const allDates = Array.from(new Set([...fundMap.keys(), ...benchMap.keys()])).sort()
  if (allDates.length === 0) return NextResponse.json({ fund: [], bench: [], name: fundName })

  // Find base values at first date each series has data
  const firstFundDate = navRows[0]?.price_date ?? null
  const firstBenchDate = benchRows[0]?.trade_date ?? null
  const firstFundVal = firstFundDate ? fundMap.get(firstFundDate) ?? null : null
  const firstBenchVal = firstBenchDate ? benchMap.get(firstBenchDate) ?? null : null

  const fund: { d: string; v: number }[] = []
  const bench: { d: string; v: number }[] = []

  for (const d of allDates) {
    if (fundMap.has(d) && firstFundVal && firstFundVal > 0)
      fund.push({ d, v: parseFloat(((fundMap.get(d)! / firstFundVal - 1) * 100).toFixed(4)) })
    if (benchMap.has(d) && firstBenchVal && firstBenchVal > 0)
      bench.push({ d, v: parseFloat(((benchMap.get(d)! / firstBenchVal - 1) * 100).toFixed(4)) })
  }

  return NextResponse.json({ fund, bench, name: fundName })
}
