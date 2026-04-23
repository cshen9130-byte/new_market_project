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

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

function calcMaxDrawdown(rets: number[]): number {
  let peak = 1, value = 1, mdd = 0
  for (const r of rets) {
    value *= (1 + r)
    if (value > peak) peak = value
    const dd = (peak - value) / peak
    if (dd > mdd) mdd = dd
  }
  return Math.round(mdd * 10000) / 100 // percentage, 2dp
}

async function _GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const WINDOW = searchParams.has("window")
    ? Math.max(10, Math.min(500, parseInt(searchParams.get("window")!, 10)))
    : null // null = full history
  const CAP_PARAM = parseFloat(searchParams.get("cap") ?? "0.15")
  const USER_CAP = isNaN(CAP_PARAM) ? 0.15 : Math.max(0.01, Math.min(1, CAP_PARAM))
  const SIM_COUNT = 3000

  try {
    const [rows, sectorRows] = await Promise.all([
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
      query<{ account: string; sector: string }>(
        `SELECT account_code AS account, COALESCE(sector, '其他') AS sector FROM mom_advisor_info`,
      ).catch(() => [] as { account: string; sector: string }[]),
    ])

    const sectorMap = new Map(sectorRows.map((r) => [r.account, r.sector]))
    const accountMap: Record<string, Record<string, number>> = {}
    const allDatesSet = new Set<string>()

    for (const row of rows) {
      const pnl = toNum(row.daily_pnl)
      const equity = toNum(row.equity)
      if (!accountMap[row.account]) accountMap[row.account] = {}
      accountMap[row.account][row.date] = equity > 0 ? pnl / equity : 0
      allDatesSet.add(row.date)
    }

    // Add guoxin (guosen account 665300200077)
    const guosenRRRows = await query<{ date: string; daily_pnl: string; equity: string }>(
      `SELECT trade_date::text AS date,
              (realized_pl + mtm_pl + exercise_pl - commission)::text AS daily_pnl,
              client_equity::text AS equity
       FROM guosen_account_summary
       WHERE client_id = '665300200077'
       ORDER BY trade_date`,
    )
    sectorMap.set("guoxin", "商品")
    if (!accountMap["guoxin"]) accountMap["guoxin"] = {}
    for (const r of guosenRRRows) {
      const pnl    = toNum(r.daily_pnl)
      const equity = toNum(r.equity)
      accountMap["guoxin"][r.date] = equity > 0 ? pnl / equity : 0
      allDatesSet.add(r.date)
    }

    const allDates = [...allDatesSet].sort()
    const windowDates = WINDOW ? allDates.slice(-WINDOW) : allDates
    const T = windowDates.length

    // Build returns matrix — only accounts with enough non-zero activity
    const accounts: string[] = []
    const returnsMatrix: number[][] = []

    for (const [account, dateMap] of Object.entries(accountMap)) {
      const rets = windowDates.map((d) => dateMap[d] ?? 0)
      if (rets.filter((r) => r !== 0).length < Math.min(5, T * 0.1)) continue
      accounts.push(account)
      returnsMatrix.push(rets)
    }

    const N = accounts.length
    if (N < 2) {
      return NextResponse.json({ ok: true, accounts: [], simPoints: [], frontier: [], window: WINDOW ?? T })
    }

    // Per-account annualized return and vol
    const annualReturns = returnsMatrix.map((r) => mean(r) * 252 * 100)
    const annualVols = returnsMatrix.map((r) => stdDev(r) * Math.sqrt(252) * 100)

    // Annualized covariance matrix (as decimals, not percent)
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

    // Monte Carlo: sample random long-only portfolios with configurable weight cap
    // Track weights alongside so we can find max-Sharpe portfolio
    const MAX_WEIGHT = Math.max(USER_CAP, 1 / N) // feasibility guard for small N
    const simPoints: { vol: number; ret: number }[] = []
    let maxSharpe = -Infinity
    let maxSharpeWeights: number[] = Array(N).fill(1 / N)

    // Iterative proportional clipping: cap each weight at MAX_WEIGHT and redistribute
    function capWeights(raw: number[]): number[] {
      const s0 = raw.reduce((a, b) => a + b, 0)
      let w = raw.map((x) => x / s0)
      for (let iter = 0; iter < 50; iter++) {
        let capSum = 0; let freeSum = 0; let anyOver = false
        for (const x of w) { if (x > MAX_WEIGHT) { capSum += MAX_WEIGHT; anyOver = true } else freeSum += x }
        if (!anyOver) break
        if (freeSum <= 1e-12) return w.map(() => 1 / N)
        const scale = (1 - capSum) / freeSum
        w = w.map((x) => x > MAX_WEIGHT ? MAX_WEIGHT : x * scale)
      }
      return w
    }

    // Add single-account (100% weight) portfolios to simPoints for frontier visualization.
    // These are NOT eligible for max-Sharpe (they violate the cap), but they ensure the
    // frontier line extends to the full vol range covered by individual account dots.
    for (let i = 0; i < N; i++) {
      const portVol = Math.sqrt(Math.max(cov[i][i], 0)) * 100
      simPoints.push({ vol: Math.round(portVol * 100) / 100, ret: Math.round(annualReturns[i] * 100) / 100 })
    }

    for (let s = 0; s < SIM_COUNT; s++) {
      // Exponential trick for uniform Dirichlet sampling
      const raw = Array.from({ length: N }, () => -Math.log(Math.random() + 1e-15))
      const w = capWeights(raw)

      const portRet = w.reduce((acc, wi, i) => acc + wi * annualReturns[i], 0)
      let portVar = 0
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          portVar += w[i] * w[j] * cov[i][j]
        }
      }
      const portVol = Math.sqrt(Math.max(portVar, 0)) * 100
      simPoints.push({
        vol: Math.round(portVol * 100) / 100,
        ret: Math.round(portRet * 100) / 100,
      })
      const sharpe = portVol > 0 ? portRet / portVol : -Infinity
      if (sharpe > maxSharpe) { maxSharpe = sharpe; maxSharpeWeights = [...w] }
    }

    // Extract the efficient frontier (upper-left envelope of simulation cloud)
    // Bin by vol, take max return per bin, keep only monotonically increasing portion
    const volValues = simPoints.map((p) => p.vol)
    const minVol = Math.min(...volValues)
    const maxVol = Math.max(...volValues)
    const BIN_COUNT = 60
    const binWidth = (maxVol - minVol) / BIN_COUNT || 1
    const bins: (number | null)[] = Array(BIN_COUNT).fill(null)

    for (const p of simPoints) {
      const bin = Math.min(Math.floor((p.vol - minVol) / binWidth), BIN_COUNT - 1)
      if (bins[bin] === null || p.ret > (bins[bin] as number)) {
        bins[bin] = p.ret
      }
    }

    // Efficient frontier = upper half: return increases left-to-right up to the peak, then we stop
    const frontierRaw: { vol: number; ret: number }[] = []
    for (let i = 0; i < BIN_COUNT; i++) {
      if (bins[i] !== null) {
        frontierRaw.push({
          vol: Math.round((minVol + (i + 0.5) * binWidth) * 100) / 100,
          ret: Math.round((bins[i] as number) * 100) / 100,
        })
      }
    }

    // Keep only the monotonically increasing (from left) portion = efficient half
    let peak = -Infinity
    const frontier: { vol: number; ret: number }[] = []
    for (const p of frontierRaw) {
      if (p.ret >= peak) {
        peak = p.ret
        frontier.push(p)
      }
    }

    // Account scatter points + max-Sharpe optimal weight
    const equalWeight = Math.round((1 / N) * 10000) / 10000
    const accountPoints = accounts.map((acc, i) => ({
      account: acc,
      vol: Math.round(annualVols[i] * 100) / 100,
      annualReturn: Math.round(annualReturns[i] * 100) / 100,
      maxDrawdown: calcMaxDrawdown(returnsMatrix[i]),
      sharpe: annualVols[i] > 0
        ? Math.round((annualReturns[i] / annualVols[i]) * 1000) / 1000
        : 0,
      sector: sectorMap.get(acc) ?? "其他",
      optimalWeight: Math.round(maxSharpeWeights[i] * 10000) / 10000,
      equalWeight,
    }))

    return NextResponse.json({
      ok: true,
      accounts: accountPoints,
      simPoints,
      frontier,
      window: WINDOW ?? T,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("mom_daily_reports") || msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, accounts: [], simPoints: [], frontier: [], notYetRun: true })
    }
    console.error("[risk-return]", err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export const GET = withMomCache("risk-return", _GET)
