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

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length
}

async function _GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const WINDOW = searchParams.has("window")
    ? Math.max(10, Math.min(500, parseInt(searchParams.get("window")!, 10)))
    : null

  try {
    const [rows, infoRows] = await Promise.all([
      query<{ account: string; date: string; daily_pnl: string; equity: string }>(
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
      query<{ account: string; sector: string; equity_wan: string }>(
        `SELECT account_code AS account,
                COALESCE(sector, '其他') AS sector,
                COALESCE(equity_wan::text, '0') AS equity_wan
         FROM mom_advisor_info`,
      ).catch(() => [] as { account: string; sector: string; equity_wan: string }[]),
    ])

    const sectorMap    = new Map(infoRows.map((r) => [r.account, r.sector]))
    const equityWanMap = new Map(infoRows.map((r) => [r.account, toNum(r.equity_wan)]))

    const accountMap: Record<string, Record<string, number>> = {}
    const allDatesSet = new Set<string>()

    for (const row of rows) {
      const pnl    = toNum(row.daily_pnl)
      const equity = toNum(row.equity)
      if (!accountMap[row.account]) accountMap[row.account] = {}
      accountMap[row.account][row.date] = equity > 0 ? pnl / equity : 0
      allDatesSet.add(row.date)
    }

    const allDates    = [...allDatesSet].sort()
    const windowDates = WINDOW ? allDates.slice(-WINDOW) : allDates
    const T = windowDates.length

    const accounts: string[]       = []
    const returnsMatrix: number[][] = []

    for (const [account, dateMap] of Object.entries(accountMap)) {
      const rets = windowDates.map((d) => dateMap[d] ?? 0)
      if (rets.filter((r) => r !== 0).length < Math.min(5, T * 0.1)) continue
      accounts.push(account)
      returnsMatrix.push(rets)
    }

    const N = accounts.length
    if (N < 2) {
      return NextResponse.json({ ok: true, accounts: [], totalAUM: 0, window: WINDOW ?? T })
    }

    // Annualized covariance matrix (daily → annual)
    const means = returnsMatrix.map(mean)
    const cov: number[][] = Array.from({ length: N }, () => Array(N).fill(0))
    for (let i = 0; i < N; i++) {
      for (let j = i; j < N; j++) {
        let c = 0
        for (let t = 0; t < T; t++) {
          c += (returnsMatrix[i][t] - means[i]) * (returnsMatrix[j][t] - means[j])
        }
        c = (c / (T - 1)) * 252
        cov[i][j] = cov[j][i] = c
      }
    }

    // Capital weights: equity_wan / totalAUM (with equal-weight fallback for missing data)
    const rawWans    = accounts.map((a) => equityWanMap.get(a) ?? 0)
    const totalKnown = rawWans.reduce((s, v) => s + v, 0)
    const totalAUM   = totalKnown > 0 ? totalKnown : N * 1000
    const fallback   = totalAUM / N
    const capitalW   = rawWans.map((w) => (w > 0 ? w : fallback) / totalAUM)

    // Portfolio variance using current capital weights
    let portVar = 0
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        portVar += capitalW[i] * capitalW[j] * cov[i][j]
      }
    }
    // portVar is annualized; avoid division by zero
    const portVarSafe = Math.max(portVar, 1e-12)

    // Risk Contribution: RC_i = w_i * (Σw)_i / σ_p²   (sums to 1)
    // (Σw)_i = Σ_j cov[i][j] * w_j
    const riskContrib = accounts.map((_, i) => {
      const sigmaW_i = capitalW.reduce((s, wj, j) => s + cov[i][j] * wj, 0)
      return capitalW[i] * sigmaW_i / portVarSafe
    })

    // Normalise so they sum exactly to 1 (floating point safety)
    const rcSum = riskContrib.reduce((s, v) => s + v, 0)
    const rcNorm = rcSum > 1e-12 ? riskContrib.map((v) => v / rcSum) : riskContrib.map(() => 1 / N)

    const accountPoints = accounts.map((acc, i) => {
      const capitalSharePct = Math.round(capitalW[i] * 10000) / 100    // %
      const riskContribPct  = Math.round(rcNorm[i]   * 10000) / 100    // %
      const overContrib     = Math.round((riskContribPct - capitalSharePct) * 100) / 100
      return {
        account:        acc,
        sector:         sectorMap.get(acc) ?? "其他",
        nominalWan:     Math.round((rawWans[i] > 0 ? rawWans[i] : fallback) * 10) / 10,
        capitalSharePct,
        riskContribPct,
        overContrib,
      }
    })

    return NextResponse.json({
      ok: true,
      accounts: accountPoints,
      totalAUM:   Math.round(totalAUM * 10) / 10,
      portVolPct: Math.round(Math.sqrt(portVarSafe) * 10000) / 100, // annualised portfolio vol %
      window:     WINDOW ?? T,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, accounts: [], totalAUM: 0, notYetRun: true })
    }
    console.error("[risk-contribution]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("risk-contribution", _GET)
