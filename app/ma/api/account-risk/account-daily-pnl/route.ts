/**
 * account-risk/account-daily-pnl
 * One series per account from public.cfmmc_daily_summary.daily_pnl (equity path).
 */
import { NextResponse } from "next/server"
import { publicQuery } from "@/lib/db"
import { scopeWhere, withCfmmcAccount } from "@/lib/server/account-risk-scope"
import { toNum } from "@/lib/server/account-risk-classify"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withCfmmcAccount(async function GET() {
  try {
    const params: unknown[] = []
    const rows = await publicQuery(`
      SELECT account_no AS account, trade_date::text AS date,
             COALESCE(daily_pnl, 0) AS daily_pnl,
             COALESCE(margin_occupied, 0) AS margin_occupied
      FROM public.cfmmc_daily_summary
      WHERE ${scopeWhere(params)}
      ORDER BY trade_date, account_no
    `, params)

    const accountMap: Record<string, { date: string; pnl: number; cumPnl: number }[]> = {}
    for (const row of rows.rows as { account: string; date: string; daily_pnl: number | string }[]) {
      const pnl = toNum(row.daily_pnl)
      if (!accountMap[row.account]) accountMap[row.account] = []
      const prev = accountMap[row.account]
      const cumPnl = (prev.length > 0 ? prev[prev.length - 1].cumPnl : 0) + pnl
      prev.push({ date: row.date, pnl, cumPnl })
    }

    const latestParams: unknown[] = []
    const latestScope = scopeWhere(latestParams)
    const latest = await publicQuery(`
      SELECT COUNT(DISTINCT account_no) AS cnt,
             COUNT(DISTINCT account_no) FILTER (WHERE COALESCE(margin_occupied, 0) = 0) AS empty_cnt
      FROM public.cfmmc_daily_summary
      WHERE trade_date = (SELECT MAX(trade_date) FROM public.cfmmc_daily_summary WHERE ${latestScope})
        AND ${latestScope}
    `, latestParams)
    const subAccountCount = toNum((latest.rows[0] as { cnt?: string } | undefined)?.cnt) || Object.keys(accountMap).length
    const emptyAccountCount = toNum((latest.rows[0] as { empty_cnt?: string } | undefined)?.empty_cnt)

    return NextResponse.json({
      ok: true,
      accountData: accountMap,
      subAccountCount,
      emptyAccountCount,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, accountData: {}, notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
})
