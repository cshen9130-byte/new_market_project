/**
 * account-risk/margin-risk
 * 组合风险度 = 保证金占用 / 客户权益. Account 风险度 from the statement.
 */
import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { getSector, toNum } from "@/lib/server/account-risk-classify"
import { scopeWhere, withCfmmcAccount } from "@/lib/server/account-risk-scope"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET() {
  try {
    const dailyParams: unknown[] = []
    const daily = await publicQuery(`
      SELECT trade_date::text AS date,
             SUM(COALESCE(margin_occupied, 0)) AS margin,
             SUM(COALESCE(client_equity, 0)) AS equity,
             SUM(COALESCE(available, 0)) AS available
      FROM public.cfmmc_daily_summary
      WHERE ${scopeWhere(dailyParams)}
      GROUP BY trade_date
      ORDER BY trade_date
    `, dailyParams)
    const lsParams: unknown[] = []
    const ls = await publicQuery(`
      SELECT trade_date::text AS date,
             SUM(CASE WHEN COALESCE(buy_lots, 0) > 0 OR bs = '买' THEN COALESCE(allocated_margin, 0) ELSE 0 END) AS long_margin,
             SUM(CASE WHEN COALESCE(sell_lots, 0) > 0 OR bs = '卖' THEN COALESCE(allocated_margin, 0) ELSE 0 END) AS short_margin
      FROM public.cfmmc_positions
      WHERE ${scopeWhere(lsParams)}
      GROUP BY trade_date
    `, lsParams)
    const lsMap = new Map<string, { long_margin: number; short_margin: number }>()
    for (const r of ls.rows as { date: string; long_margin: number | string; short_margin: number | string }[]) {
      lsMap.set(r.date, { long_margin: toNum(r.long_margin), short_margin: toNum(r.short_margin) })
    }

    const timeseries = (daily.rows as { date: string; margin: number | string; equity: number | string; available: number | string }[]).map((r) => {
      const margin = toNum(r.margin)
      const equity = toNum(r.equity)
      const fundNav = equity
      const lsRow = lsMap.get(r.date)
      const lm = lsRow?.long_margin ?? 0
      const sm = lsRow?.short_margin ?? 0
      const lsTotal = lm + sm
      return {
        date: r.date,
        margin,
        equity,
        available: toNum(r.available),
        fundNav: equity > 0 ? equity : null,
        riskRatio: equity > 0 ? (margin / equity) * 100 : null,
        longMarginRatio: equity > 0 && margin > 0 && lsTotal > 0 ? ((margin * (lm / lsTotal)) / equity) * 100 : null,
        shortMarginRatio: equity > 0 && margin > 0 && lsTotal > 0 ? ((margin * (sm / lsTotal)) / equity) * 100 : null,
      }
    })

    const acctParams: unknown[] = []
    const acctRows = await publicQuery(`
      SELECT account_no AS account, trade_date::text AS date,
             risk_ratio, margin_occupied AS margin, client_equity AS equity, available
      FROM public.cfmmc_daily_summary
      WHERE ${scopeWhere(acctParams)}
      ORDER BY trade_date, account_no
    `, acctParams)
    const acctMap = new Map<string, { date: string; riskRatio: number | null; margin: number; equity: number; available: number }[]>()
    for (const r of acctRows.rows as {
      account: string; date: string; risk_ratio: number | string | null
      margin: number | string; equity: number | string; available: number | string
    }[]) {
      if (!acctMap.has(r.account)) acctMap.set(r.account, [])
      const margin = toNum(r.margin)
      const equity = toNum(r.equity)
      const raw = r.risk_ratio == null ? null : toNum(r.risk_ratio)
      // stored as fraction (0.009); UI shows percent
      const riskRatio = raw != null ? (raw <= 1 ? raw * 100 : raw) : (equity > 0 ? (margin / equity) * 100 : null)
      acctMap.get(r.account)!.push({ date: r.date, riskRatio, margin, equity, available: toNum(r.available) })
    }
    const accounts = Array.from(acctMap.entries()).map(([account, series]) => ({ account, series }))
    const latest = accounts.map((a) => {
      const last = a.series[a.series.length - 1]
      return { account: a.account, ...last, sector: "未分类" }
    }).sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0))

    const posParams: unknown[] = []
    const posSector = await publicQuery(`
      SELECT trade_date::text AS date, instrument, COALESCE(allocated_margin, 0) AS margin
      FROM public.cfmmc_positions
      WHERE ${scopeWhere(posParams)}
    `, posParams)
    const sectorDay = new Map<string, number>()
    for (const r of posSector.rows as { date: string; instrument: string; margin: number | string }[]) {
      const sec = getSector(r.instrument)
      const k = `${r.date}|${sec}`
      sectorDay.set(k, (sectorDay.get(k) ?? 0) + toNum(r.margin))
    }
    const fundNavMap = new Map(timeseries.map((r) => [r.date, r.fundNav]))
    const sectorMap = new Map<string, { date: string; riskRatio: number | null }[]>()
    for (const [k, sm] of sectorDay) {
      const [date, sector] = k.split("|")
      if (!sectorMap.has(sector)) sectorMap.set(sector, [])
      const fundNav = fundNavMap.get(date) ?? null
      sectorMap.get(sector)!.push({
        date,
        riskRatio: fundNav != null && fundNav > 0 ? (sm / fundNav) * 100 : null,
      })
    }
    const sectorSeries = Array.from(sectorMap.entries()).map(([sector, series]) => ({ sector, series }))

    return NextResponse.json({
      ok: true,
      timeseries,
      accounts,
      latest,
      sectorSeries,
      sectorLsSeries: [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, timeseries: [], accounts: [], latest: [] })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
