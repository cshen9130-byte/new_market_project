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
  const CAP_PARAM = parseFloat(searchParams.get("cap") ?? "0.15")
  const USER_CAP = isNaN(CAP_PARAM) ? 0.15 : Math.max(0.01, Math.min(1, CAP_PARAM))
  const SIM_COUNT = 3000

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

    const sectorMap   = new Map(infoRows.map((r) => [r.account, r.sector]))
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

    const allDates   = [...allDatesSet].sort()
    const windowDates = WINDOW ? allDates.slice(-WINDOW) : allDates
    const T = windowDates.length

    const accounts: string[]     = []
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

    const annualReturns = returnsMatrix.map((r) => mean(r) * 252 * 100)
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

    const MAX_WEIGHT = Math.max(USER_CAP, 1 / N)

    function capWeights(raw: number[]): number[] {
      const s0 = raw.reduce((a, b) => a + b, 0)
      let w = raw.map((x) => x / s0)
      for (let iter = 0; iter < 50; iter++) {
        let capSum = 0; let freeSum = 0; let anyOver = false
        for (const x of w) {
          if (x > MAX_WEIGHT) { capSum += MAX_WEIGHT; anyOver = true } else freeSum += x
        }
        if (!anyOver) break
        if (freeSum <= 1e-12) return w.map(() => 1 / N)
        const scale = (1 - capSum) / freeSum
        w = w.map((x) => x > MAX_WEIGHT ? MAX_WEIGHT : x * scale)
      }
      return w
    }

    let maxSharpe = -Infinity
    let maxSharpeWeights: number[] = Array(N).fill(1 / N)

    for (let s = 0; s < SIM_COUNT; s++) {
      const raw = Array.from({ length: N }, () => -Math.log(Math.random() + 1e-15))
      const w = capWeights(raw)
      const portRet = w.reduce((acc, wi, i) => acc + wi * annualReturns[i], 0)
      let portVar = 0
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) portVar += w[i] * w[j] * cov[i][j]
      }
      const portVol = Math.sqrt(Math.max(portVar, 0)) * 100
      const sharpe  = portVol > 0 ? portRet / portVol : -Infinity
      if (sharpe > maxSharpe) { maxSharpe = sharpe; maxSharpeWeights = [...w] }
    }

    // Total AUM: sum of known equity_wan for accounts in optimization
    // If a known account has equity_wan=0, fallback to equal share of known total or 1000万
    const knownWans = accounts.map((a) => equityWanMap.get(a) ?? 0)
    const totalKnown = knownWans.reduce((s, v) => s + v, 0)
    const totalAUM   = totalKnown > 0 ? totalKnown : N * 1000
    const fallbackPerAccount = totalAUM / N

    const accountPoints = accounts.map((acc, i) => {
      const rawWan       = equityWanMap.has(acc) ? (equityWanMap.get(acc) ?? 0) : 0
      const currentWan   = rawWan > 0 ? rawWan : fallbackPerAccount
      const optimalWeight = maxSharpeWeights[i]
      const optimalWan   = Math.round(optimalWeight * totalAUM * 10) / 10
      const delta        = Math.round((optimalWan - currentWan) * 10) / 10
      return {
        account:       acc,
        sector:        sectorMap.get(acc) ?? "其他",
        currentWan:    Math.round(currentWan * 10) / 10,
        optimalWan,
        delta,
        optimalWeight: Math.round(optimalWeight * 10000) / 10000,
      }
    })

    return NextResponse.json({
      ok: true,
      accounts: accountPoints,
      totalAUM: Math.round(totalAUM * 10) / 10,
      window: WINDOW ?? T,
      cap: USER_CAP,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, accounts: [], totalAUM: 0, notYetRun: true })
    }
    console.error("[reallocation]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("reallocation", _GET)
