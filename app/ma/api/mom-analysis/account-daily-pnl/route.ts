import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function _GET() {
  try {
    const numExpr = (col: string) =>
      `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}", ''), ',', ''), ' ', ''), '')::numeric, 0)`

    // Per-account daily PnL using same formula as product-nav
    const rows = await query<{ account: string; date: string; daily_pnl: string }>(
      `SELECT
         "账户" AS account,
         "交易日期"::text AS date,
         (
           ${numExpr("当日盈亏")}
           - ${numExpr("当日手续费")}
           + ${numExpr("权利金收入")}
           - ${numExpr("权利金支出")}
         )::text AS daily_pnl
       FROM mom_daily_reports
       ORDER BY "交易日期", "账户"`,
    )

    // Group by account → array of {date, pnl, cumPnl}
    const accountMap: Record<string, { date: string; pnl: number; cumPnl: number }[]> = {}
    for (const row of rows) {
      const pnl = parseFloat(row.daily_pnl) || 0
      if (!accountMap[row.account]) accountMap[row.account] = []
      const prev = accountMap[row.account]
      const cumPnl = (prev.length > 0 ? prev[prev.length - 1].cumPnl : 0) + pnl
      prev.push({ date: row.date, pnl, cumPnl })
    }

    // Merge guosen (国信) account from guosen_account_summary — same filter as 业绩报酬测算
    try {
      const guosenRows = await query<{
        trade_date: string
        realized_pl: string; mtm_pl: string; exercise_pl: string; commission: string
      }>(
        `SELECT trade_date::text AS trade_date,
                COALESCE(realized_pl, 0)::text AS realized_pl,
                COALESCE(mtm_pl, 0)::text AS mtm_pl,
                COALESCE(exercise_pl, 0)::text AS exercise_pl,
                COALESCE(commission, 0)::text AS commission
         FROM guosen_account_summary
         WHERE client_id = '665300200077'
         ORDER BY trade_date`,
      )
      // Overwrite any existing guoxin entry (ensures single source of truth)
      accountMap["guoxin"] = []
      for (const row of guosenRows) {
        const pnl = (parseFloat(row.realized_pl) || 0)
                  + (parseFloat(row.mtm_pl) || 0)
                  + (parseFloat(row.exercise_pl) || 0)
                  - (parseFloat(row.commission) || 0)
        const prev = accountMap["guoxin"]
        const cumPnl = (prev.length > 0 ? prev[prev.length - 1].cumPnl : 0) + pnl
        prev.push({ date: row.trade_date, pnl, cumPnl })
      }
      // If no guosen data was found, remove the empty guoxin entry
      if (accountMap["guoxin"].length === 0) delete accountMap["guoxin"]
    } catch {
      // guosen_account_summary not available — skip gracefully
    }

    // Count registered sub-accounts from advisor info (source of truth) + 1 for guoxin
    let subAccountCount: number | null = null
    try {
      const countRow = await query<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM mom_advisor_info`)
      const rxCount = parseInt(countRow[0]?.cnt ?? "0", 10)
      const hasGuoxin = Object.prototype.hasOwnProperty.call(accountMap, "guoxin")
      subAccountCount = rxCount + (hasGuoxin ? 1 : 0)
    } catch {
      // mom_advisor_info not available — fall back to accountData keys
      subAccountCount = Object.keys(accountMap).length
    }

    return NextResponse.json({ ok: true, accountData: accountMap, subAccountCount })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, accountData: {}, notYetRun: true })
    }
    console.error("[account-daily-pnl]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("account-daily-pnl", _GET)
