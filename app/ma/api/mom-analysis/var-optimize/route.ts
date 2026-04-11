import { NextResponse } from "next/server"
import { query } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// ── helpers ───────────────────────────────────────────────────────────────────
function getPrefix(contract: string): string {
  return (contract.match(/^[A-Z]+/i)?.[0] ?? contract).toUpperCase()
}
function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}
const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

const AKSHARE_CODE: Record<string, string> = {
  A: "A0.DCE",   AD: "AD0.SHF", AG: "AG0.SHF", AL: "AL0.SHF", AO: "AO0.SHF", AP: "AP0.CZC",
  AU: "AU0.SHF", B: "B0.DCE",   BB: "BB0.DCE", BC: "BCM.INE", BR: "BR0.SHF", BU: "BU0.SHF",
  BZ: "BZ0.DCE", C: "C0.DCE",   CF: "CF0.CZC", CJ: "CJ0.CZC", CS: "CS0.DCE", CU: "CU0.SHF",
  CY: "CY0.CZC", EB: "EB0.DCE", EC: "ECM.INE", EG: "EG0.DCE", FB: "FB0.DCE", FG: "FG0.CZC",
  FU: "FU0.SHF", HC: "HC0.SHF", I: "I0.DCE",   IC: "IC0.CFE", IF: "IF0.CFE", IH: "IH0.CFE",
  IM: "IM0.CFE", J: "J0.DCE",   JD: "JD0.DCE", JM: "JM0.DCE", JR: "JR0.CZC", L: "L0.DCE",
  LC: "LCM.GFE", LG: "LG0.DCE", LH: "LH0.DCE", LR: "LR0.CZC", LU: "LUM.INE", M: "M0.DCE",
  MA: "MA0.CZC", NI: "NI0.SHF", NR: "NRM.INE", OI: "OI0.CZC", OP: "OP0.SHF", P: "P0.DCE",
  PB: "PB0.SHF", PD: "PDM.GFE", PF: "PF0.CZC", PG: "PG0.DCE", PK: "PK0.CZC", PL: "PL0.CZC",
  PM: "PM0.CZC", PP: "PP0.DCE", PR: "PR0.CZC", PS: "PSM.GFE", PT: "PTM.GFE", PX: "PX0.CZC",
  RB: "RB0.SHF", RI: "RI0.CZC", RM: "RM0.CZC", RR: "RR0.DCE", RS: "RS0.CZC", RU: "RU0.SHF",
  SA: "SA0.CZC", SC: "SCM.INE", SF: "SF0.CZC", SH: "SH0.CZC", SI: "SIM.GFE", SM: "SM0.CZC",
  SN: "SN0.SHF", SP: "SP0.SHF", SR: "SR0.CZC", SS: "SS0.SHF", TA: "TA0.CZC", T: "T0.CFE",
  TF: "TF0.CFE", TL: "TL0.CFE", TS: "TS0.CFE", UR: "UR0.CZC", V: "V0.DCE",   WH: "WH0.CZC",
  WR: "WR0.SHF", Y: "Y0.DCE",   ZC: "ZC0.CZC", ZN: "ZN0.SHF",
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
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

// ── quantile tables ───────────────────────────────────────────────────────────
const Z_TABLE:       Record<string, number> = { "90": 1.282, "95": 1.645, "99": 2.326 }
const T6_TABLE:      Record<string, number> = { "90": 1.440, "95": 1.943, "99": 3.143 }
const LAPLACE_TABLE: Record<string, number> = { "90": 1.138, "95": 1.629, "99": 2.767 }
const LOGISTIC_TABLE:Record<string, number> = { "90": 1.211, "95": 1.623, "99": 2.532 }

function getZScore(confidence: string, distModel: string): number {
  if (distModel === "t")        return T6_TABLE[confidence]       ?? 1.943
  if (distModel === "laplace")  return LAPLACE_TABLE[confidence]  ?? 1.629
  if (distModel === "logistic") return LOGISTIC_TABLE[confidence] ?? 1.623
  return Z_TABLE[confidence] ?? 1.645
}

// ── parameter grid ────────────────────────────────────────────────────────────
const CONFIDENCES  = ["90", "95", "99"] as const
const VOL_WINDOWS  = [5, 10, 20, 30, 60]
const CORR_WINDOWS = [5, 10, 20, 30, 60, 126, 252]
const DIST_MODELS  = ["normal", "t", "laplace", "logistic", "kde"] as const

// ── statistics + scoring ──────────────────────────────────────────────────────
function computeStats(results: { var: number; actual: number }[], confidence: string) {
  const valid = results.filter((r) => r.var > 0)
  const N = valid.length
  if (N < 10) return null

  const p_exp = (100 - parseInt(confidence, 10)) / 100
  const N1 = valid.filter((r) => r.actual > r.var).length
  const N0 = N - N1
  const p_obs = N1 / N

  const safeLn = (x: number) => (x > 0 ? Math.log(x) : -30)
  const lr_pof =
    N1 > 0 && N0 > 0
      ? -2 * (
          N1 * safeLn(p_exp) + N0 * safeLn(1 - p_exp)
          - N1 * safeLn(p_obs) - N0 * safeLn(1 - p_obs)
        )
      : N1 === 0
      ? -2 * N * safeLn(1 - p_exp)  // all non-breaches vs expected non-breach rate
      : -2 * N * safeLn(p_exp)

  let T00 = 0, T01 = 0, T10 = 0, T11 = 0
  for (let i = 1; i < valid.length; i++) {
    const prev = valid[i - 1].actual > valid[i - 1].var ? 1 : 0
    const curr = valid[i].actual   > valid[i].var   ? 1 : 0
    if (prev === 0 && curr === 0) T00++
    else if (prev === 0 && curr === 1) T01++
    else if (prev === 1 && curr === 0) T10++
    else T11++
  }
  const pi01 = T00 + T01 > 0 ? T01 / (T00 + T01) : 0
  const pi11 = T10 + T11 > 0 ? T11 / (T10 + T11) : 0
  const lr_ind =
    T01 + T11 > 0 && T00 + T10 > 0
      ? -2 * (
          (T00 + T01) * safeLn(1 - p_obs) + (T01 + T11) * safeLn(p_obs)
          - (T00 * safeLn(1 - pi01) + (T01 > 0 ? T01 * safeLn(pi01) : 0))
          - (T10 * safeLn(1 - pi11) + (T11 > 0 ? T11 * safeLn(pi11) : 0))
        )
      : 0
  const lr_cc = lr_pof + lr_ind

  const residuals  = valid.map((r) => r.actual - r.var)
  const mae        = residuals.reduce((a, v) => a + Math.abs(v), 0) / N
  const rmse       = Math.sqrt(residuals.reduce((a, v) => a + v ** 2, 0) / N)
  const avgVar     = valid.reduce((a, r) => a + r.var,    0) / N
  const avgActual  = valid.reduce((a, r) => a + r.actual, 0) / N
  const coverageRatio = avgVar > 0 ? avgActual / avgVar : 0

  // Composite score (lower = better):
  //   - penalise breach rate above expected (hard)
  //   - penalise coverage ratio far from 1 (capital efficiency)
  //   - include test statistics as soft penalty
  const breachExcess = Math.max(0, p_obs - p_exp) / p_exp
  const score =
    breachExcess * 15 +
    Math.abs(coverageRatio - 1) * 3 +
    Math.max(0, lr_pof) * 0.3 +
    Math.max(0, lr_cc)  * 0.2

  return {
    N,
    breaches: N1,
    breachRate:   Math.round(p_obs  * 1000) / 10,
    expectedRate: Math.round(p_exp  * 1000) / 10,
    kupiecLR:     Math.round(lr_pof * 1000) / 1000,
    ccLR:         Math.round(lr_cc  * 1000) / 1000,
    kupiecPass:   lr_pof < 3.84,
    ccPass:       lr_cc  < 5.99,
    mae:          Math.round(mae    / 10000) / 100,   // 万
    rmse:         Math.round(rmse   / 10000) / 100,   // 万
    avgVar:       Math.round(avgVar / 10000) / 100,   // 万
    coverageRatio: Math.round(coverageRatio * 1000) / 1000,
    score:        Math.round(score  * 1000) / 1000,
  }
}

// ── main handler ──────────────────────────────────────────────────────────────
export async function GET() {
  try {
    // 1. Fetch all DB data once
    const [closeRows, posRows, mvRows] = await Promise.all([
      query<{ date: string; contract: string; pnl: string }>(
        `SELECT "交易日期"::text AS date, UPPER(TRIM("合约")) AS contract,
                SUM(${numExpr("平仓盈亏")})::text AS pnl
         FROM mom_futures_trade_details
         WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
         GROUP BY "交易日期", UPPER(TRIM("合约")) ORDER BY 1`,
      ),
      query<{ date: string; contract: string; pnl: string }>(
        `SELECT "交易日期"::text AS date, UPPER(TRIM("合约")) AS contract,
                SUM(${numExpr("持仓盈亏")})::text AS pnl
         FROM mom_position_details
         WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
         GROUP BY "交易日期", UPPER(TRIM("合约")) ORDER BY 1`,
      ),
      query<{ date: string; contract: string; mv: string }>(
        `SELECT "交易日期"::text AS date, UPPER(TRIM("合约")) AS contract,
                SUM(
                  CASE WHEN ${numExpr("买持仓")} > 0
                       THEN  ${numExpr("持仓市値")}
                       ELSE -${numExpr("持仓市値")}
                  END
                )::text AS mv
         FROM mom_position_details
         WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
         GROUP BY "交易日期", UPPER(TRIM("合约")) ORDER BY 1`,
      ),
    ])

    let feeRows: { date: string; contract: string; fee: string; premium: string }[] = []
    try {
      feeRows = await query<{ date: string; contract: string; fee: string; premium: string }>(
        `SELECT trade_date::text AS date, UPPER(TRIM("合约")) AS contract,
                SUM(${numExpr("手续费")})::text AS fee,
                SUM(${numExpr("权利金收支")})::text AS premium
         FROM mom_trade_details
         WHERE trade_date IS NOT NULL AND "合约" IS NOT NULL
         GROUP BY trade_date, UPPER(TRIM("合约")) ORDER BY 1`,
      )
    } catch { /* optional */ }

    // 2. Build maps
    const prodPnlMap  = new Map<string, Map<string, number>>()
    const prodMvMap   = new Map<string, Map<string, number>>()
    const totalPnlMap = new Map<string, number>()

    const addPnl = (contract: string, date: string, pnl: number) => {
      const prod = getPrefix(contract)
      if (!prodPnlMap.has(prod)) prodPnlMap.set(prod, new Map())
      prodPnlMap.get(prod)!.set(date, (prodPnlMap.get(prod)!.get(date) ?? 0) + pnl)
      totalPnlMap.set(date, (totalPnlMap.get(date) ?? 0) + pnl)
    }
    for (const r of closeRows) addPnl(r.contract, r.date, toNum(r.pnl))
    for (const r of posRows)   addPnl(r.contract, r.date, toNum(r.pnl))
    for (const r of feeRows)   addPnl(r.contract, r.date, -toNum(r.fee) + toNum(r.premium))

    for (const r of mvRows) {
      const prod = getPrefix(r.contract)
      if (!prodMvMap.has(prod)) prodMvMap.set(prod, new Map())
      prodMvMap.get(prod)!.set(r.date, (prodMvMap.get(prod)!.get(r.date) ?? 0) + toNum(r.mv))
    }

    const allProds     = [...prodPnlMap.keys()]
    const tradingDates = [...totalPnlMap.keys()].sort()
    if (tradingDates.length < 15) {
      return NextResponse.json({ ok: true, results: [], notEnoughData: true })
    }

    // 3. Fetch market returns
    const akCodes = [...new Set(allProds.map((p) => AKSHARE_CODE[p]).filter(Boolean))]
    const pctRows = await query<{ date: string; code: string; pct: string }>(
      `SELECT trade_date::text AS date, code, pct_change::text AS pct
       FROM raw_akshare_futures_daily
       WHERE code = ANY($1) AND pct_change IS NOT NULL
       ORDER BY trade_date`,
      [akCodes],
    )
    const pctMap = new Map<string, Map<string, number>>()
    for (const r of pctRows) {
      if (!pctMap.has(r.code)) pctMap.set(r.code, new Map())
      pctMap.get(r.code)!.set(r.date, toNum(r.pct) / 100)
    }
    const getPctSeries = (prod: string, dates: string[]): number[] => {
      const code = AKSHARE_CODE[prod]
      if (!code) return dates.map(() => 0)
      const m = pctMap.get(code)
      return dates.map((dt) => m?.get(dt) ?? 0)
    }
    const allMktDates  = [...new Set(pctRows.map((r) => r.date))].sort()
    const mktDateIndex = new Map<string, number>()
    allMktDates.forEach((d, i) => mktDateIndex.set(d, i))

    const Np = allProds.length

    // 4. Precompute corr matrices (one per unique corrDays)
    const corrMatrices = new Map<number, number[][]>()
    for (const cd of CORR_WINDOWS) {
      const corrDates = allMktDates.slice(-cd)
      const retSeries = allProds.map((p) => getPctSeries(p, corrDates))
      corrMatrices.set(
        cd,
        Array.from({ length: Np }, (_, i) =>
          Array.from({ length: Np }, (__, j) =>
            i === j ? 1 : pearsonCorr(retSeries[i], retSeries[j])
          )
        ),
      )
    }

    // 5. Precompute dollarVols per (volDays): array indexed by loop iteration k
    //    dollarVolsCache[vd][k] = dollarVols[] at tradingDates[vd + k]
    //    dateActualCache[vd][k] = { dNext, actualAbs }
    type DvEntry = { dNext: string; actualAbs: number; dollarVols: number[] }
    const dvCache = new Map<number, DvEntry[]>()

    for (const vd of VOL_WINDOWS) {
      const entries: DvEntry[] = []
      for (let di = vd; di < tradingDates.length - 1; di++) {
        const d     = tradingDates[di]
        const dNext = tradingDates[di + 1]
        const mi    = mktDateIndex.get(d) ?? -1
        const volDates =
          mi >= vd
            ? allMktDates.slice(mi - vd, mi)
            : mi > 0
            ? allMktDates.slice(0, mi)
            : []

        const dollarVols = allProds.map((prod) => {
          const mvD = prodMvMap.get(prod)?.get(d) ?? 0
          if (Math.abs(mvD) < 1000) return 0
          const rets = getPctSeries(prod, volDates).filter((r) => r !== 0)
          return stdDev(rets) * mvD
        })
        entries.push({
          dNext,
          actualAbs: Math.abs(Math.round(totalPnlMap.get(dNext) ?? 0)),
          dollarVols,
        })
      }
      dvCache.set(vd, entries)
    }

    // 6. Precompute portVars per (volDays, corrDays)
    //    portVarCache[`${vd}:${cd}`][k] = portVar scalar
    const portVarCache = new Map<string, number[]>()
    for (const vd of VOL_WINDOWS) {
      const entries = dvCache.get(vd)!
      for (const cd of CORR_WINDOWS) {
        const corrMatrix = corrMatrices.get(cd)!
        const portVars = entries.map(({ dollarVols: dv }) => {
          let pv = 0
          for (let i = 0; i < Np; i++) {
            if (dv[i] === 0) continue
            for (let j = 0; j < Np; j++) {
              if (dv[j] === 0) continue
              pv += dv[i] * dv[j] * corrMatrix[i][j]
            }
          }
          return pv
        })
        portVarCache.set(`${vd}:${cd}`, portVars)
      }
    }

    // 7. Sweep all combinations
    type OptRow = {
      confidence: string; volDays: number; corrDays: number; distModel: string
      N: number; breaches: number; breachRate: number; expectedRate: number
      kupiecLR: number; ccLR: number; kupiecPass: boolean; ccPass: boolean
      mae: number; rmse: number; avgVar: number; coverageRatio: number; score: number
    }
    const allResults: OptRow[] = []

    for (const confidence of CONFIDENCES) {
      for (const distModel of DIST_MODELS) {
        if (distModel === "kde") {
          // Non-parametric: uses corrDays as history window; volDays irrelevant
          for (const cd of CORR_WINDOWS) {
            const alpha = 1 - parseInt(confidence, 10) / 100
            const kdeResults: { var: number; actual: number }[] = []
            for (let di = 5; di < tradingDates.length - 1; di++) {
              const dNext = tradingDates[di + 1]
              const hist  = tradingDates
                .slice(Math.max(0, di - cd), di)
                .map((dt) => totalPnlMap.get(dt) ?? 0)
                .sort((a, b) => a - b)
              if (hist.length < 5) continue
              const idx      = Math.max(0, Math.floor(alpha * hist.length) - 1)
              const varValue = Math.abs(Math.round(hist[idx] ?? 0))
              const actual   = Math.abs(Math.round(totalPnlMap.get(dNext) ?? 0))
              if (varValue > 0 || actual > 0) kdeResults.push({ var: varValue, actual })
            }
            const stats = computeStats(kdeResults, confidence)
            if (stats) allResults.push({ confidence, volDays: 0, corrDays: cd, distModel: "kde", ...stats })
          }
          continue
        }

        const Z_SCORE = getZScore(confidence, distModel)
        for (const vd of VOL_WINDOWS) {
          const entries  = dvCache.get(vd)!
          for (const cd of CORR_WINDOWS) {
            const portVars = portVarCache.get(`${vd}:${cd}`)!
            const results  = entries.map((e, k) => ({
              var:    portVars[k] > 0 ? Math.round(Z_SCORE * Math.sqrt(portVars[k])) : 0,
              actual: e.actualAbs,
            }))
            const stats = computeStats(results, confidence)
            if (stats) allResults.push({ confidence, volDays: vd, corrDays: cd, distModel, ...stats })
          }
        }
      }
    }

    // 8. Sort: best score first; ties broken by coverage ratio closest to 1
    allResults.sort((a, b) =>
      a.score !== b.score
        ? a.score - b.score
        : Math.abs(a.coverageRatio - 1) - Math.abs(b.coverageRatio - 1)
    )

    return NextResponse.json({
      ok: true,
      results: allResults.slice(0, 40),
      total: allResults.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[var-optimize]", msg)
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, results: [], notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
