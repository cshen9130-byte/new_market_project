/**
 * account-risk/product-nav
 * Serves NAV curve data from public.cfmmc_daily_summary.
 * Returns the same JSON shape as mom-analysis/product-nav so ProductNavChart works as-is.
 */
import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await publicQuery(`
      SELECT
        trade_date::text AS date,
        account_no,
        COALESCE(client_equity,   0) AS client_equity,
        COALESCE(daily_pnl,       0) AS daily_pnl,
        COALESCE(deposit_wd,      0) AS deposit_wd
      FROM public.cfmmc_daily_summary
      ORDER BY trade_date ASC, account_no ASC
    `)

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
    let nav = 1.0
    let cumCapital = 0

    const data = dates.map((date) => {
      const { equity, pnl, flow } = dateMap.get(date)!
      const netFlow = flow
      const dailyReturn = cumCapital > 0 ? pnl / cumCapital : 0
      nav = nav * (1 + dailyReturn)
      cumCapital = cumCapital === 0
        ? equity          // bootstrap: use first day's equity as capital
        : cumCapital + netFlow + pnl
      return {
        date,
        nav:         Math.round(nav * 1e6) / 1e6,
        cumCapital:  Math.round(cumCapital),
        dailyReturn: Math.round(dailyReturn * 1e6) / 1e6,
        netFlow:     Math.round(netFlow),
        pnl:         Math.round(pnl),
      }
    })

    return NextResponse.json({ ok: true, data, turnoverSeries: [], holdingSeries: [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
