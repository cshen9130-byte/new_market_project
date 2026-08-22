/**
 * account-risk/product-nav
 * Serves NAV curve data from public.cfmmc_daily_summary.
 * Returns the same JSON shape as mom-analysis/product-nav so ProductNavChart works as-is.
 */
import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { scopeWhere, withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET() {
  try {
    const params: unknown[] = []
    const rows = await publicQuery(`
      SELECT
        trade_date::text AS date,
        account_no,
        COALESCE(client_equity,   0) AS client_equity,
        COALESCE(daily_pnl,       0) AS daily_pnl,
        COALESCE(deposit_wd,      0) AS deposit_wd
      FROM public.cfmmc_daily_summary
      WHERE ${scopeWhere(params)}
      ORDER BY trade_date ASC, account_no ASC
    `, params)

    if (rows.rows.length === 0) {
      return NextResponse.json({ ok: true, data: [], turnoverSeries: [], holdingSeries: [] })
    }

    // Aggregate across all accounts for each date
    type DayRow = { date: string; account_no: string; client_equity: number; daily_pnl: number; deposit_wd: number }
    const dayRows = rows.rows as DayRow[]

    // Group by date, sum across accounts
    const dateMap = new Map<string, { equity: number; pnl: number; flow: number }>()
    for (const r of dayRows) {
      const eq = typeof r.client_equity === "string" ? parseFloat(r.client_equity) : Number(r.client_equity)
      const pnl = typeof r.daily_pnl === "string" ? parseFloat(r.daily_pnl) : Number(r.daily_pnl)
      const flow = typeof r.deposit_wd === "string" ? parseFloat(r.deposit_wd) : Number(r.deposit_wd)
      const existing = dateMap.get(r.date)
      if (existing) {
        existing.equity += (isFinite(eq) ? eq : 0)
        existing.pnl    += (isFinite(pnl) ? pnl : 0)
        existing.flow   += (isFinite(flow) ? flow : 0)
      } else {
        dateMap.set(r.date, {
          equity: isFinite(eq) ? eq : 0,
          pnl:    isFinite(pnl) ? pnl : 0,
          flow:   isFinite(flow) ? flow : 0,
        })
      }
    }

    const dates = Array.from(dateMap.keys()).sort()
    // Keep every file date, including leading equity=0 (e.g. Aug 17 empty account).
    let nav = 1.0
    let prevEquity = 0
    let cumPnl = 0

    const data = dates.map((date) => {
      const { equity, pnl, flow } = dateMap.get(date)!
      const netFlow = flow
      const economicPnl = prevEquity > 0 || equity !== 0 || netFlow !== 0
        ? equity - prevEquity - netFlow
        : pnl
      const dailyReturn = prevEquity > 0 ? economicPnl / prevEquity : 0
      nav = nav * (1 + dailyReturn)
      // First snapshot is the capital base; do not treat starting 客户权益 as today's profit.
      const countedPnl = prevEquity > 0 ? economicPnl : 0
      cumPnl += countedPnl
      prevEquity = equity
      return {
        date,
        nav:         Math.round(nav * 1e6) / 1e6,
        cumCapital:  Math.round(equity),
        dailyReturn: Math.round(dailyReturn * 1e6) / 1e6,
        netFlow:     Math.round(netFlow),
        pnl:         Math.round(countedPnl),
        cumPnl:      Math.round(cumPnl),
      }
    })

    return NextResponse.json({ ok: true, data, turnoverSeries: [], holdingSeries: [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
