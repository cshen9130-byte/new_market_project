import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { withMomCache } from "@/lib/server/mom-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

function pearsonCorr(x: number[], y: number[]): number {
  const n = x.length
  if (n < 3) return 0
  const mx = x.reduce((s, v) => s + v, 0) / n
  const my = y.reduce((s, v) => s + v, 0) / n
  let num = 0, sx = 0, sy = 0
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx, yi = y[i] - my
    num += xi * yi; sx += xi * xi; sy += yi * yi
  }
  const denom = Math.sqrt(sx * sy)
  return denom < 1e-10 ? 0 : num / denom
}

async function _GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const WINDOW = Math.max(5, Math.min(120, parseInt(searchParams.get("window") ?? "20", 10)))

  try {
    const rows = await query<{
      account: string
      date: string
      daily_pnl: string
      equity: string
    }>(
      `SELECT
         "账户" AS account,
         "交易日期"::text AS date,
         (
           ${numExpr("当日盈亏")}
           - ${numExpr("当日手续费")}
           + ${numExpr("权利金收入")}
           - ${numExpr("权利金支出")}
         )::text AS daily_pnl,
         ${numExpr("客户权益")}::text AS equity
       FROM mom_daily_reports
       ORDER BY "交易日期", "账户"`,
    )

    const datePnl: Record<string, number> = {}
    const dateEquity: Record<string, number> = {}
    const accountMap: Record<string, Record<string, number>> = {}

    for (const row of rows) {
      const pnl = toNum(row.daily_pnl)
      const equity = toNum(row.equity)
      datePnl[row.date] = (datePnl[row.date] ?? 0) + pnl
      dateEquity[row.date] = (dateEquity[row.date] ?? 0) + equity
      if (!accountMap[row.account]) accountMap[row.account] = {}
      accountMap[row.account][row.date] = equity > 0 ? pnl / equity : 0
    }

    // Add guoxin (guosen account 665300200077)
    const guosenCorrRows = await query<{ date: string; daily_pnl: string; equity: string }>(
      `SELECT trade_date::text AS date,
              (realized_pl + mtm_pl + exercise_pl - commission)::text AS daily_pnl,
              client_equity::text AS equity
       FROM guosen_account_summary
       WHERE client_id = '665300200077'
       ORDER BY trade_date`,
    )
    if (!accountMap["guoxin"]) accountMap["guoxin"] = {}
    for (const r of guosenCorrRows) {
      const pnl    = toNum(r.daily_pnl)
      const equity = toNum(r.equity)
      datePnl[r.date]   = (datePnl[r.date]   ?? 0) + pnl
      dateEquity[r.date] = (dateEquity[r.date] ?? 0) + equity
      accountMap["guoxin"][r.date] = equity > 0 ? pnl / equity : 0
    }

    const allDates = Object.keys(datePnl).sort()

    const accounts = Object.keys(accountMap)
    const N = accounts.length
    const accountReturnArrays = accounts.map((acc) =>
      allDates.map((d) => accountMap[acc][d] ?? 0),
    )

    // For each date (from index WINDOW-1 onward), compute:
    //   avgPairwiseCorr = mean of all pairwise Pearson correlations among ACTIVE accounts
    //   effectiveN      = n / (1 + (n-1) * avgPairwiseCorr)  (diversification ratio)
    // Only accounts with non-zero variance in the window are considered "active".
    const dates: string[] = []
    const avgCorr: number[] = []
    const effN: number[] = []

    function hasVariance(xs: number[]): boolean {
      if (xs.length < 2) return false
      const m = xs.reduce((s, v) => s + v, 0) / xs.length
      return xs.some((v) => Math.abs(v - m) > 1e-10)
    }

    for (let i = WINDOW - 1; i < allDates.length; i++) {
      // Only include accounts active (non-zero variance) in this window
      const activeSlices: number[][] = []
      for (const r of accountReturnArrays) {
        const slice = r.slice(i - WINDOW + 1, i + 1)
        if (hasVariance(slice)) activeSlices.push(slice)
      }
      const n = activeSlices.length
      let pairSum = 0
      let pairCount = 0
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          pairSum += pearsonCorr(activeSlices[a], activeSlices[b])
          pairCount++
        }
      }
      const rhoBar = pairCount > 0 ? pairSum / pairCount : 0
      const en = n > 1 ? n / (1 + (n - 1) * Math.max(rhoBar, 0)) : n
      dates.push(allDates[i])
      avgCorr.push(Math.round(rhoBar * 1000) / 1000)
      effN.push(Math.round(en * 100) / 100)
    }

    return NextResponse.json({ ok: true, dates, avgCorr, effN, accountCount: N, window: WINDOW })  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, dates: [], avgCorr: [], effN: [], accountCount: 0, notYetRun: true })
    }
    console.error("[advisor-corr-ts]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("advisor-corr-ts", _GET)
