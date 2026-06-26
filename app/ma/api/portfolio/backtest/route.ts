import { NextResponse } from "next/server"
import { loadFundNavSeries, loadFundNavRange, resolveFundNames } from "@/lib/server/fund-nav-series"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

interface FundInput {
  beian_hao: string
  product_name: string
  initial_subscribe_date?: string
  initial_amount?: string
  nav_start_date?: string
  latest_nav_date?: string | null
}

interface CurvePoint {
  d: string
  v: number
}

function maxDate(dates: string[]) {
  return dates.filter(Boolean).sort().at(-1) ?? ""
}

function minDate(dates: string[]) {
  return dates.filter(Boolean).sort()[0] ?? ""
}

function effectiveFundStart(f: FundInput): string {
  const nav = (f.nav_start_date || "").slice(0, 10)
  const sub = (f.initial_subscribe_date || "").slice(0, 10)
  if (nav && sub) return nav > sub ? nav : sub
  return nav || sub
}

function mergePortfolioSeries(
  seriesList: { weight: number; points: CurvePoint[] }[],
): CurvePoint[] {
  if (seriesList.length === 0) return []
  const dateSet = new Set<string>()
  seriesList.forEach((s) => s.points.forEach((p) => dateSet.add(p.d)))
  const dates = Array.from(dateSet).sort()
  const maps = seriesList.map((s) => ({
    weight: s.weight,
    map: new Map(s.points.map((p) => [p.d, p.v])),
  }))

  return dates.flatMap((d) => {
    let weighted = 0
    let totalWeight = 0
    maps.forEach(({ weight, map }) => {
      const v = map.get(d)
      if (v != null) {
        weighted += v * weight
        totalWeight += weight
      }
    })
    if (totalWeight <= 0) return []
    return [{ d, v: weighted / totalWeight }]
  })
}

function rebaseSeries(rows: { price_date: string; level: string }[]): CurvePoint[] {
  if (rows.length === 0) return []
  const firstVal = parseFloat(rows[0].level)
  if (!Number.isFinite(firstVal) || firstVal <= 0) return []
  return rows.flatMap((row) => {
    const val = parseFloat(row.level)
    if (!Number.isFinite(val)) return []
    return [{
      d: row.price_date.slice(0, 10),
      v: parseFloat(((val / firstVal - 1) * 100).toFixed(4)),
    }]
  })
}

async function loadBenchSeries(from: string, to: string): Promise<CurvePoint[]> {
  const benchRows = await query<{ trade_date: string; value: string }>(
    `SELECT trade_date::text AS trade_date, value::text
     FROM raw_etf_daily
     WHERE ticker = '510300.SH' AND field = 'ORIGINALUNIT'
       AND trade_date >= $1::date AND trade_date <= $2::date
     ORDER BY trade_date ASC`,
    [from, to],
  )
  if (benchRows.length === 0) return []
  const firstVal = parseFloat(benchRows[0].value)
  if (!Number.isFinite(firstVal) || firstVal <= 0) return []
  return benchRows.flatMap((row) => {
    const val = parseFloat(row.value)
    if (!Number.isFinite(val)) return []
    return [{
      d: row.trade_date.slice(0, 10),
      v: parseFloat(((val / firstVal - 1) * 100).toFixed(4)),
    }]
  })
}

// POST /ma/api/portfolio/backtest
export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      funds?: FundInput[]
      from?: string
      to?: string
      benchmark?: string
    }

    const funds = body.funds ?? []
    const benchmark = body.benchmark ?? "hs300"
    if (funds.length === 0) {
      return NextResponse.json({ error: "missing funds" }, { status: 400 })
    }

    const today = new Date().toISOString().slice(0, 10)
    const suggestedFrom = maxDate(funds.map(effectiveFundStart).filter(Boolean))
    const suggestedTo = today

    let from = (body.from || suggestedFrom || "").slice(0, 10)
    let to = (body.to || suggestedTo || today).slice(0, 10)
    if (!from || !to) {
      return NextResponse.json({ error: "missing date range" }, { status: 400 })
    }
    if (from > to) {
      to = from
    }

    const totalAmount = funds.reduce((sum, f) => sum + (parseFloat(f.initial_amount || "0") || 0), 0) || 1

    const seriesList: { weight: number; points: CurvePoint[] }[] = []
    const skipped: string[] = []

    for (const fund of funds) {
      const names = await resolveFundNames(fund.beian_hao, fund.product_name)
      const range = await loadFundNavRange(fund.beian_hao, names.product_name, names.short_name)
      const fundFrom = maxDate([from, effectiveFundStart({
        ...fund,
        nav_start_date: range.nav_start_date ?? fund.nav_start_date,
      })])
      const fundTo = minDate([
        to,
        (range.latest_nav_date || fund.latest_nav_date || to).slice(0, 10) || to,
      ])
      if (!fundFrom || fundFrom > fundTo) {
        skipped.push(fund.product_name || fund.beian_hao)
        continue
      }
      const navRows = await loadFundNavSeries(
        fund.beian_hao,
        names.product_name,
        names.short_name,
        { from: fundFrom, to: fundTo },
      )
      const points = rebaseSeries(navRows)
      if (points.length === 0) {
        skipped.push(fund.product_name || fund.beian_hao)
        continue
      }

      seriesList.push({
        weight: (parseFloat(fund.initial_amount || "0") || 0) / totalAmount,
        points,
      })
    }

    const portfolio = mergePortfolioSeries(seriesList)
    const bench = benchmark === "hs300" && portfolio.length > 0
      ? await loadBenchSeries(portfolio[0].d, portfolio.at(-1)!.d)
      : []

    return NextResponse.json({
      portfolio,
      bench,
      from,
      to,
      skipped,
      suggestedFrom,
      suggestedTo,
    })
  } catch (err) {
    console.error("[portfolio/backtest]", err)
    return NextResponse.json({ error: "backtest failed" }, { status: 500 })
  }
}
