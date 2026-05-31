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

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length
}

function cov(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 2) return 0
  const mx = mean(xs), my = mean(ys)
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / (n - 1)
}

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
  // compare = number of trading days to look back for the previous period
  const COMPARE = searchParams.has("compare")
    ? Math.max(1, Math.min(500, parseInt(searchParams.get("compare")!, 10)))
    : null

  try {
    const [rows, sectorRows] = await Promise.all([
      query<{
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
      ),
      query<{ account: string; sector: string }>(
        `SELECT account_code AS account, COALESCE(sector, '其他') AS sector FROM mom_advisor_info`,
      ).catch(() => [] as { account: string; sector: string }[]),
    ])

    const sectorMap = new Map(sectorRows.map((r) => [r.account, r.sector]))

    // Group by date: total pnl and equity across all accounts
    const datePnl: Record<string, number> = {}
    const dateEquity: Record<string, number> = {}

    // Group by account: array of {date, pnl, equity}
    const accountMap: Record<string, { date: string; pnl: number; equity: number }[]> = {}
    for (const row of rows) {
      if (!accountMap[row.account]) accountMap[row.account] = []
      const pnl = toNum(row.daily_pnl)
      const equity = toNum(row.equity)
      accountMap[row.account].push({ date: row.date, pnl, equity })
      datePnl[row.date] = (datePnl[row.date] ?? 0) + pnl
      dateEquity[row.date] = (dateEquity[row.date] ?? 0) + equity
    }

    // All dates sorted (unsliced — needed to reach back for prev period)
    const allDates = Object.keys(datePnl).sort()
    const curDates = allDates.slice(-WINDOW)

    // Previous-period dates: WINDOW days ending COMPARE trading days before the last date
    const prevDates: string[] = []
    if (COMPARE !== null) {
      const prevEnd = allDates.length - COMPARE
      if (prevEnd > 0) {
        prevDates.push(...allDates.slice(Math.max(0, prevEnd - WINDOW), prevEnd))
      }
    }

    // Portfolio daily returns — current period
    const portReturns = curDates.map((d) => {
      const eq = dateEquity[d] ?? 0
      return eq > 0 ? (datePnl[d] ?? 0) / eq : 0
    })
    const portVol = stdDev(portReturns)

    // Portfolio daily returns — previous period
    const prevPortReturns = prevDates.map((d) => {
      const eq = dateEquity[d] ?? 0
      return eq > 0 ? (datePnl[d] ?? 0) / eq : 0
    })
    const prevPortVol = stdDev(prevPortReturns)

    // Per-account annualized vol + marginal vol
    const result: { account: string; vol: number; marginalVol: number; pnl: number; mvolChange?: number; window: number }[] = []
    for (const [account, series] of Object.entries(accountMap)) {
      // Build full date → return map for this account
      const acctReturn: Record<string, number> = {}
      const acctPnl: Record<string, number> = {}
      for (const d of series) {
        acctReturn[d.date] = d.equity > 0 ? d.pnl / d.equity : 0
        acctPnl[d.date] = d.pnl
      }

      const curReturns = curDates.map((d) => acctReturn[d] ?? 0)
      if (curReturns.filter((r) => isFinite(r)).length < 2) continue

      const windowPnl = curDates.reduce((s, d) => s + (acctPnl[d] ?? 0), 0)

      const vol = stdDev(curReturns) * Math.sqrt(252) * 100

      // Marginal vol = Cov(r_i, r_port) / σ_port * sqrt(252) * 100
      const marginalVol = portVol > 0
        ? (cov(curReturns, portReturns) / portVol) * Math.sqrt(252) * 100
        : 0

      // Pearson correlation to portfolio returns
      const corr = Math.round(pearsonCorr(curReturns, portReturns) * 1000) / 1000

      // Previous period marginal vol (only when compare requested)
      let mvolChange: number | undefined
      if (COMPARE !== null && prevDates.length >= 2 && prevPortVol > 0) {
        const prevReturns = prevDates.map((d) => acctReturn[d] ?? 0)
        const prevMarginalVol = (cov(prevReturns, prevPortReturns) / prevPortVol) * Math.sqrt(252) * 100
        mvolChange = Math.round((marginalVol - prevMarginalVol) * 100) / 100
      }

      result.push({
        account,
        vol: Math.round(vol * 100) / 100,
        marginalVol: Math.round(marginalVol * 100) / 100,
        corr,
        pnl: Math.round(windowPnl),
        sector: sectorMap.get(account) ?? "其他",
        ...(mvolChange !== undefined ? { mvolChange } : {}),
        window: curReturns.length,
      })
    }

    result.sort((a, b) => b.vol - a.vol)

    return NextResponse.json({ ok: true, advisors: result, window: WINDOW })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, advisors: [], notYetRun: true })
    }
    console.error("[advisor-vol]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("advisor-vol", _GET)
