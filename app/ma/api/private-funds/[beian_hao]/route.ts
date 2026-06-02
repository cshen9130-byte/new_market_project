import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ beian_hao: string }> }
) {
  const { beian_hao } = await params

  const infoRows = await query<{
    beian_hao:      string
    product_name:   string
    short_name:     string | null
    strategy_l1:    string | null
    strategy_l2:    string | null
    manager:        string
    inception_date: string | null
    benchmark:      string | null
    ret_1w:         string | null
    ret_1m:         string | null
    ret_3m:         string | null
    ret_6m:         string | null
    ret_1y:         string | null
    sharpe_1y:      string | null
    calmar_1y:      string | null
  }>(
    `SELECT beian_hao, product_name, NULL::text AS short_name, strategy_l1, strategy_l2, manager,
            inception_date::text AS inception_date, benchmark,
            ret_1w::text, ret_1m::text, ret_3m::text, ret_6m::text, ret_1y::text,
            sharpe_1y::text, calmar_1y::text
     FROM private_fund_info WHERE beian_hao = $1`,
    [beian_hao]
  )

  const bflRows = infoRows[0]
    ? []
    : await query<{
        beian_hao:      string
        product_name:   string
        short_name:     string | null
        strategy_l1:    string | null
        strategy_l2:    string | null
        manager:        string
        inception_date: string | null
        benchmark:      string | null
        ret_1w:         string | null
        ret_1m:         string | null
        ret_3m:         string | null
        ret_6m:         string | null
        ret_1y:         string | null
        sharpe_1y:      string | null
        calmar_1y:      string | null
      }>(
        `SELECT beian_hao, product_name, short_name,
                strategy_one AS strategy_l1,
                strategy_two AS strategy_l2,
                ''::text     AS manager,
                NULL::text   AS inception_date,
                NULL::text   AS benchmark,
                NULL::text   AS ret_1w,
                NULL::text   AS ret_1m,
                NULL::text   AS ret_3m,
                NULL::text   AS ret_6m,
                NULL::text   AS ret_1y,
                NULL::text   AS sharpe_1y,
                NULL::text   AS calmar_1y
         FROM private_fund_info_bfl
         WHERE beian_hao = $1`,
        [beian_hao]
      )

  const info = infoRows[0] ?? bflRows[0]
  if (!info) return NextResponse.json({ error: "Fund not found" }, { status: 404 })

  const productName = info.product_name ?? ""
  const shortName = info.short_name ?? ""

  const navRows = await query<{
    price_date:         string
    nav:                string
    cumulative_nav:     string
    cum_nav_withdrawal: string
    price_change:       string
  }>(
    `SELECT DISTINCT ON (price_date)
        price_date::text AS price_date,
        nav::text,
        cumulative_nav::text,
        cum_nav_withdrawal::text,
        price_change::text
     FROM (
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 0 AS pri
       FROM private_fund_nav_group
       WHERE beian_hao = $1

       UNION ALL

       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 1 AS pri
       FROM private_fund_nav_group
       WHERE $2 <> '' AND product_name = $2

       UNION ALL

       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 2 AS pri
       FROM private_fund_nav_group
       WHERE $3 <> '' AND product_name = $3

       UNION ALL

       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 3 AS pri
       FROM private_fund_nav
       WHERE beian_hao = $1

       UNION ALL

       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 4 AS pri
       FROM private_fund_nav
       WHERE $2 <> '' AND product_name = $2

       UNION ALL

       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 5 AS pri
       FROM private_fund_nav
       WHERE $3 <> '' AND product_name = $3
     ) nav_union
     ORDER BY price_date ASC, pri ASC`,
    [beian_hao, productName, shortName]
  )

  const nav_series = navRows
  const first = nav_series[0]
  const latest = nav_series[nav_series.length - 1]

  // Headline returns should follow the reinvested series, which matches the source system.
  const latestReinvestedNav = latest ? parseFloat(latest.cumulative_nav) : null
  const firstReinvestedNav = first ? parseFloat(first.cumulative_nav) : null
  const ret_since_inception =
    latestReinvestedNav !== null && firstReinvestedNav !== null && firstReinvestedNav > 0
      ? latestReinvestedNav / firstReinvestedNav - 1
      : null

  // Days since inception
  const inceptionDate = first  ? new Date(first.price_date)  : null
  const latestDate    = latest ? new Date(latest.price_date) : null
  const days =
    inceptionDate && latestDate
      ? (latestDate.getTime() - inceptionDate.getTime()) / 86_400_000
      : null

  // Annualized since inception
  const ann_ret =
    ret_since_inception !== null && days && days > 0
      ? Math.pow(1 + ret_since_inception, 365 / days) - 1
      : null

  // YTD return: use the last value before year start when available, otherwise the
  // first value inside the year. This matches common fund-reporting conventions.
  const yearPrefix = latest ? latest.price_date.slice(0, 4) + "-01-01" : null
  const ytdBase = yearPrefix
    ? [...nav_series].reverse().find((r) => r.price_date < yearPrefix) ?? nav_series.find((r) => r.price_date >= yearPrefix) ?? null
    : null
  const ytd_ret =
    ytdBase && latest
      ? parseFloat(latest.cumulative_nav) / parseFloat(ytdBase.cumulative_nav) - 1
      : null

  // Max drawdown + daily returns for Sharpe (from cumulative_nav reinvested series)
  let peak = -Infinity
  let maxDrawdown = 0
  const dailyReturns: number[] = []
  for (let i = 0; i < nav_series.length; i++) {
    const v = parseFloat(nav_series[i].cumulative_nav)
    if (v > peak) peak = v
    const dd = peak > 0 ? (peak - v) / peak : 0
    if (dd > maxDrawdown) maxDrawdown = dd
    if (i > 0) {
      const prev = parseFloat(nav_series[i - 1].cumulative_nav)
      if (prev > 0) dailyReturns.push(v / prev - 1)
    }
  }

  // Since-inception Sharpe = annualised return / annualised volatility (rf = 0)
  // Use actual records-per-year so weekly/daily funds both annualise correctly
  let sharpe_since_inception: string | null = null
  if (ann_ret !== null && dailyReturns.length > 1 && days && days > 0) {
    const totalYears = days / 365
    const recordsPerYear = dailyReturns.length / totalYears
    const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
    const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length
    const annVol = Math.sqrt(variance) * Math.sqrt(recordsPerYear)
    if (annVol > 0) sharpe_since_inception = (ann_ret / annVol).toFixed(2)
  }

  return NextResponse.json({
    info,
    nav_series,
    metrics: {
      latest_nav:                latest?.nav              ?? null,
      latest_nav_date:           latest?.price_date       ?? null,
      latest_cum_nav:            latest?.cum_nav_withdrawal ?? null,
      latest_cum_nav_reinvested: latest?.cumulative_nav   ?? null,
      ret_since_inception: ret_since_inception !== null ? (ret_since_inception * 100).toFixed(2) : null,
      ann_ret:             ann_ret             !== null ? (ann_ret             * 100).toFixed(2) : null,
      ytd_ret:             ytd_ret             !== null ? (ytd_ret             * 100).toFixed(2) : null,
      max_drawdown:        maxDrawdown > 0               ? (maxDrawdown        * 100).toFixed(2) : null,
      sharpe_since_inception,
    },
  })
}
