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
       WHERE COALESCE(TRIM("账户"::text), '') <> ''
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
         AND TRIM("账户"::text) NOT LIKE '%国信%'
         AND TRIM("账户"::text) <> '665300200077'
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

    // Count sub-accounts on the latest trading date from daily reports (operational source of truth).
    // 空仓: no margin occupied and no option market value remaining at settlement.
    const countRow = await query<{ cnt: string; empty_cnt: string }>(
      `SELECT
         COUNT(DISTINCT "账户") AS cnt,
         COUNT(DISTINCT "账户") FILTER (
           WHERE ${numExpr("保证金占用")} = 0
             AND ${numExpr("多头期权市値")} = 0
             AND ${numExpr("空头期权市値")} = 0
         ) AS empty_cnt
       FROM mom_daily_reports
       WHERE "交易日期" = (SELECT MAX("交易日期") FROM mom_daily_reports)
         AND COALESCE(TRIM("账户"::text), '') <> ''
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
         AND TRIM("账户"::text) NOT LIKE '%国信%'
         AND TRIM("账户"::text) <> '665300200077'`,
    )
    const subAccountCount = parseInt(countRow[0]?.cnt ?? String(Object.keys(accountMap).length), 10)
    const emptyAccountCount = parseInt(countRow[0]?.empty_cnt ?? "0", 10)

    return NextResponse.json({ ok: true, accountData: accountMap, subAccountCount, emptyAccountCount })
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
