/**
 * account-risk/product-nav
 * Serves NAV curve data from public.cfmmc_daily_summary.
 * Returns the same JSON shape as mom-analysis/product-nav so ProductNavChart works as-is.
 */
import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { aggregateEquityByDate, compoundAccountRiskNav } from "@/lib/server/account-risk-nav"
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

    const data = compoundAccountRiskNav(aggregateEquityByDate(rows.rows as Array<{
      date: string
      client_equity: unknown
      daily_pnl: unknown
      deposit_wd: unknown
    }>))

    return NextResponse.json({ ok: true, data, turnoverSeries: [], holdingSeries: [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
