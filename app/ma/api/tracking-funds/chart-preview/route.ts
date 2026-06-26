import { NextResponse } from "next/server"
import { loadFundNavSeries, resolveFundNames } from "@/lib/server/fund-nav-series"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

// GET /ma/api/tracking-funds/chart-preview?beian_hao=XXX&days=90
// GET /ma/api/tracking-funds/chart-preview?beian_hao=XXX&from=2020-01-01&to=2024-12-31
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const beian_hao = (searchParams.get("beian_hao") || "").trim()
  const product_name = (searchParams.get("product_name") || "").trim()
  const from = (searchParams.get("from") || "").trim()
  const to = (searchParams.get("to") || "").trim()
  const days = Math.max(30, Math.min(3650, Number(searchParams.get("days") || 90)))
  if (!beian_hao) return NextResponse.json({ error: "missing beian_hao" }, { status: 400 })

  const useRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)
  if (useRange && from > to) {
    return NextResponse.json({ fund: [], bench: [], error: "invalid date range" })
  }
  const names = await resolveFundNames(beian_hao, product_name)
  const fundName = names.product_name

  const navRows = await loadFundNavSeries(
    beian_hao,
    names.product_name,
    names.short_name,
    useRange ? { from, to } : { days },
  )

  const benchRows = await query<{ trade_date: string; value: string }>(
    `SELECT trade_date::text AS trade_date, value::text
     FROM raw_etf_daily
     WHERE ticker = '510300.SH' AND field = 'ORIGINALUNIT'
       AND ${useRange ? "trade_date >= $1::date AND trade_date <= $2::date" : "trade_date >= CURRENT_DATE - ($1::int)"}
     ORDER BY trade_date ASC`,
    useRange ? [from, to] : [days],
  )

  const fund: { d: string; v: number }[] = []
  if (navRows.length > 0) {
    const firstVal = parseFloat(navRows[0].level)
    if (Number.isFinite(firstVal) && firstVal > 0) {
      for (const row of navRows) {
        const val = parseFloat(row.level)
        if (!Number.isFinite(val)) continue
        fund.push({
          d: row.price_date.slice(0, 10),
          v: parseFloat(((val / firstVal - 1) * 100).toFixed(4)),
        })
      }
    }
  }

  const bench: { d: string; v: number }[] = []
  if (benchRows.length > 0) {
    const firstVal = parseFloat(benchRows[0].value)
    if (Number.isFinite(firstVal) && firstVal > 0) {
      for (const row of benchRows) {
        const val = parseFloat(row.value)
        if (!Number.isFinite(val)) continue
        bench.push({
          d: row.trade_date.slice(0, 10),
          v: parseFloat(((val / firstVal - 1) * 100).toFixed(4)),
        })
      }
    }
  }

  return NextResponse.json({ fund, bench, name: fundName })
}
