import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

type Row = {
  account: string
  win_days: string
  loss_days: string
  avg_win: string | null
  avg_loss: string | null
  total_pnl: string
  first_date: string | null
  last_date: string | null
}

function r1(n: number): number {
  return Math.round(n * 10) / 10
}
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

async function _GET() {
  try {
    const pnl = `(
      ${numExpr("当日盈亏")}
      - ${numExpr("当日手续费")}
      + ${numExpr("权利金收入")}
      - ${numExpr("权利金支出")}
    )`
    const rows = await query<Row>(
      `WITH daily AS (
         SELECT
           "账户" AS account,
           LEFT("交易日期"::text, 10) AS date,
           SUM(${pnl}) AS pnl
         FROM mom_daily_reports
         GROUP BY 1, 2
       )
       SELECT
         account,
         COUNT(*) FILTER (WHERE pnl > 0)::text AS win_days,
         COUNT(*) FILTER (WHERE pnl < 0)::text AS loss_days,
         AVG(pnl) FILTER (WHERE pnl > 0)::text AS avg_win,
         AVG(pnl) FILTER (WHERE pnl < 0)::text AS avg_loss,
         COALESCE(SUM(pnl), 0)::text AS total_pnl,
         MIN(date)::text AS first_date,
         MAX(date)::text AS last_date
       FROM daily
       GROUP BY account`,
    )

    let from: string | null = null
    let to: string | null = null
    const accounts = rows.flatMap((row) => {
      const winDays = parseInt(row.win_days, 10) || 0
      const lossDays = parseInt(row.loss_days, 10) || 0
      const decided = winDays + lossDays
      if (decided < 1 || !row.account) return []
      const avgWin = row.avg_win == null ? null : parseFloat(row.avg_win)
      const avgLoss = row.avg_loss == null ? null : parseFloat(row.avg_loss)
      const payoff = avgWin != null && avgLoss != null && avgLoss < 0 ? avgWin / Math.abs(avgLoss) : null
      if (row.first_date && (!from || row.first_date < from)) from = row.first_date
      if (row.last_date && (!to || row.last_date > to)) to = row.last_date
      return [{
        account: row.account,
        winRate: r1((winDays / decided) * 100),
        payoff: payoff == null ? null : r2(payoff),
        winDays,
        lossDays,
        avgWin: avgWin == null ? null : Math.round(avgWin),
        avgLoss: avgLoss == null ? null : Math.round(avgLoss),
        totalPnl: Math.round(parseFloat(row.total_pnl) || 0),
      }]
    })
    accounts.sort((a, b) => a.account.localeCompare(b.account))

    return NextResponse.json({ ok: true, from, to, accounts })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, from: null, to: null, accounts: [], notYetRun: true })
    }
    console.error("[advisor-win-payoff]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("advisor-win-payoff", _GET)
