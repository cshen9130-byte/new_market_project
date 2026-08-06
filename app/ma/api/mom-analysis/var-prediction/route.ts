import { NextResponse } from "next/server"
import { query } from "@/lib/db"
import { paramKey, readCache, writeCache } from "@/lib/server/mom-cache"
import { getPrefix } from "@/lib/server/prod-utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function toNum(v: unknown): number {
  if (v == null) return 0
  const n = parseFloat(String(v).replace(/[,%\s]/g, ""))
  return isNaN(n) ? 0 : n
}

/** Normalise DATE/TIMESTAMP text to YYYY-MM-DD for map keys / joins. */
function normDate(d: string): string {
  return d.slice(0, 10)
}

/** Binary search: last index i such that arr[i] <= target, or -1 if none. */
function floorIndex(arr: string[], target: string): number {
  let lo = 0, hi = arr.length - 1, idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= target) { idx = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return idx
}

const numExpr = (col: string) =>
  `COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("${col}"::text, ''), ',', ''), ' ', ''), '')::numeric, 0)`

// Product prefix → continuous contract code in raw_akshare_futures_daily
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

/**
 * Zero out contract-rollover spike returns so .filter(r=>r!==0) excludes them.
 * Uses rolling MAD: excludes returns > max(6%, median_abs + 12*MAD*1.4826).
 */
function zeroRolloverSpikes(rets: number[]): number[] {
  if (rets.length < 2) return [...rets]
  const MIN_THRESHOLD = 0.06, K = 12, LOOKBACK = 40
  const out = [...rets]
  for (let i = LOOKBACK; i < rets.length; i++) {
    const win = rets.slice(i - LOOKBACK, i).map(Math.abs).sort((a, b) => a - b)
    const med = win[Math.floor(win.length / 2)]
    const devs = win.map(v => Math.abs(v - med)).sort((a, b) => a - b)
    const mad = devs[Math.floor(devs.length / 2)]
    const thr = Math.max(MIN_THRESHOLD, med + K * mad * 1.4826)
    if (Math.abs(rets[i]) > thr) out[i] = 0
  }
  return out
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

// z-score for confidence level (normal distribution)
const Z_TABLE: Record<string, number> = { "90": 1.282, "95": 1.645, "99": 2.326 }

// quantile multiplier for t-distribution (df=6, commonly used for fat tails in finance)
const T6_TABLE: Record<string, number> = { "90": 1.440, "95": 1.943, "99": 3.143 }

// Laplace: -ln(2*(1-p)) / sqrt(2)   (derived from Laplace(0, σ/√2) quantile)
const LAPLACE_TABLE: Record<string, number> = { "90": 1.138, "95": 1.629, "99": 2.767 }

// Logistic: (√3/π) * ln(p/(1-p))   (derived from Logistic(0, σ√3/π) quantile)
const LOGISTIC_TABLE: Record<string, number> = { "90": 1.211, "95": 1.623, "99": 2.532 }

async function _GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const confidence  = searchParams.get("confidence")  ?? "95"    // "90"|"95"|"99"
  const volDays     = Math.max(5, Math.min(120, parseInt(searchParams.get("volDays")  ?? "20",  10)))
  const corrDays    = Math.max(5, Math.min(756, parseInt(searchParams.get("corrDays") ?? "252", 10)))
  const distModel   = searchParams.get("distModel") ?? "normal"  // "normal"|"t"|"laplace"|"logistic"|"kde"
  // Optional product prefix whitelist (comma-separated, e.g. "PP,L,PL")
  const prodsParam  = searchParams.get("prods")
  const prodsFilter = prodsParam ? new Set(prodsParam.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)) : null

  try {
    const VOL_WINDOW  = volDays
    const CORR_WINDOW = corrDays
    const Z_SCORE     = distModel === "t"
      ? (T6_TABLE[confidence]   ?? 1.943)
      : distModel === "laplace"
      ? (LAPLACE_TABLE[confidence]  ?? 1.629)
      : distModel === "logistic"
      ? (LOGISTIC_TABLE[confidence] ?? 1.623)
      : (Z_TABLE[confidence]   ?? 1.645)  // normal or kde (kde ignores Z_SCORE)

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
    } catch { /* optional table */ }

    // Build maps: prod → date → value
    const prodPnlMap  = new Map<string, Map<string, number>>()
    const prodMvMap   = new Map<string, Map<string, number>>()
    const totalPnlMap = new Map<string, number>()

    const addPnl = (contract: string, date: string, pnl: number) => {
      const d = normDate(date)
      const prod = getPrefix(contract)
      if (!prodPnlMap.has(prod)) prodPnlMap.set(prod, new Map())
      const m = prodPnlMap.get(prod)!
      m.set(d, (m.get(d) ?? 0) + pnl)
      totalPnlMap.set(d, (totalPnlMap.get(d) ?? 0) + pnl)
    }
    for (const r of closeRows) addPnl(r.contract, r.date, toNum(r.pnl))
    for (const r of posRows)   addPnl(r.contract, r.date, toNum(r.pnl))
    for (const r of feeRows)   addPnl(r.contract, r.date, -toNum(r.fee) + toNum(r.premium))

    for (const r of mvRows) {
      const d = normDate(r.date)
      const prod = getPrefix(r.contract)
      if (!prodMvMap.has(prod)) prodMvMap.set(prod, new Map())
      const m = prodMvMap.get(prod)!
      m.set(d, (m.get(d) ?? 0) + toNum(r.mv))  // signed: positive = net long
    }

    const allProds     = [...prodPnlMap.keys()].filter(p => !prodsFilter || prodsFilter.has(p))
    // When filtering products, totalPnlMap must also be scoped to those products
    const filteredTotalPnlMap = prodsFilter
      ? (() => {
          const m = new Map<string, number>()
          for (const prod of allProds) {
            for (const [date, pnl] of (prodPnlMap.get(prod) ?? [])) {
              m.set(date, (m.get(date) ?? 0) + pnl)
            }
          }
          return m
        })()
      : totalPnlMap
    const tradingDates = [...filteredTotalPnlMap.keys()].sort()
    if (tradingDates.length < VOL_WINDOW + 2) {
      return NextResponse.json({ ok: true, data: [], notEnoughData: true })
    }

    const results: { date: string; var: number; actual: number }[] = []

    // ── VaR via correlation matrix (same method for total and filtered groups) ──
    // sigma_i = stdDev of last VOL_WINDOW pct_change values ending at day d
    // w_i     = sigma_i * |mv_i_d|   (dollar volatility, signed by direction)
    // VaR     = Z_SCORE * sqrt(w' * Corr * w)
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
      const d = normDate(r.date)
      if (!pctMap.has(r.code)) pctMap.set(r.code, new Map())
      pctMap.get(r.code)!.set(d, toNum(r.pct) / 100)
    }

    const getPctSeries = (prod: string, dates: string[]): number[] => {
      const code = AKSHARE_CODE[prod]
      if (!code) return dates.map(() => 0)
      const m = pctMap.get(code)
      return dates.map((dt) => m?.get(dt) ?? 0)
    }

    const allMktDates = [...new Set(pctRows.map((r) => normDate(r.date)))].sort()
    const corrDates   = allMktDates.slice(-CORR_WINDOW)
    const retSeries   = allProds.map((p) => getPctSeries(p, corrDates))
    const N           = allProds.length

    // Precompute rollover-cleaned return series per code (same indices as allMktDates)
    const cleanPctByCode = new Map<string, number[]>()
    for (const code of akCodes) {
      const m = pctMap.get(code)
      cleanPctByCode.set(code, zeroRolloverSpikes(allMktDates.map(d => m?.get(d) ?? 0)))
    }

    const corrMatrix: number[][] = Array.from({ length: N }, (_, i) =>
      Array.from({ length: N }, (__, j) =>
        i === j ? 1 : pearsonCorr(retSeries[i], retSeries[j])
      )
    )

    // Helper: compute parametric VaR for a single day d using that day's MV and recent vol window.
    // Market dates may lag MOM settlement dates — use floorIndex (same as var-sector-timeseries /
    // var-sandbox) so a missing akshare day does not silently zero VaR.
    const computeVar = (d: string): number => {
      const day = normDate(d)
      const mi  = floorIndex(allMktDates, day)
      if (mi < 1) return 0

      const dollarVols = allProds.map((prod) => {
        const mvD = prodMvMap.get(prod)?.get(day) ?? 0
        if (Math.abs(mvD) < 1000) return 0
        const code = AKSHARE_CODE[prod]
        const cleanRets = cleanPctByCode.get(code ?? "") ?? []
        const rets = (mi >= VOL_WINDOW
          ? cleanRets.slice(mi - VOL_WINDOW, mi)
          : cleanRets.slice(0, mi)).filter(r => r !== 0)
        const sigma = stdDev(rets)
        return sigma * mvD
      })

      let portVar = 0
      for (let i = 0; i < N; i++) {
        if (dollarVols[i] === 0) continue
        for (let j = 0; j < N; j++) {
          if (dollarVols[j] === 0) continue
          portVar += dollarVols[i] * dollarVols[j] * corrMatrix[i][j]
        }
      }
      return portVar > 0 ? Math.round(Z_SCORE * Math.sqrt(portVar)) : 0
    }

    for (let di = VOL_WINDOW; di < tradingDates.length - 1; di++) {
      const d     = tradingDates[di]
      const dNext = tradingDates[di + 1]

      let varValue: number
      if (distModel === "kde") {
        const histPnl = tradingDates
          .slice(Math.max(0, di - CORR_WINDOW), di)
          .map((dt) => filteredTotalPnlMap.get(dt) ?? 0)
          .sort((a, b) => a - b)
        if (histPnl.length < 5) { continue }
        const alpha = 1 - parseInt(confidence, 10) / 100
        const idx   = Math.max(0, Math.floor(alpha * histPnl.length) - 1)
        varValue = Math.abs(Math.round(histPnl[idx] ?? 0))
      } else {
        varValue = computeVar(d)
      }
      const actualAbs = Math.abs(Math.round(filteredTotalPnlMap.get(dNext) ?? 0))
      if (varValue > 0 || actualAbs > 0) {
        results.push({ date: dNext, var: varValue, actual: actualAbs })
      }
    }

    // Compute next-day prediction using the most recent trading day's positions
    const lastD      = tradingDates[tradingDates.length - 1]
    const nextDayVar = distModel !== "kde" ? computeVar(lastD) : 0

    const valid      = results.filter((r) => r.var > 0)
    const breaches   = valid.filter((r) => r.actual > r.var).length
    const breachRate = valid.length > 0 ? breaches / valid.length : 0

    return NextResponse.json({
      ok: true,
      data: results.slice(-180),
      nextDayVar,
      breachRate: Math.round(breachRate * 1000) / 10,
      params: { confidence, volDays: VOL_WINDOW, corrDays: CORR_WINDOW, distModel },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[var-prediction]", msg)
    // Tables not yet populated → return empty gracefully
    if (msg.includes("does not exist")) {
      return NextResponse.json({ ok: true, data: [], notYetRun: true })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

/**
 * Cache wrapper with tip-zero bypass: when akshare lags MOM dates, a stale daily
 * cache can freeze VaR=0 on the latest point even after market data catches up.
 * Recompute (and overwrite) those bad entries instead of serving them.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const noCache = url.searchParams.get("nocache") === "1"
  const key = "var-prediction" + paramKey(url.searchParams)
  const cacheHeaders = { "Cache-Control": "no-cache" }

  if (!noCache) {
    const cached = readCache<{
      data?: { date: string; var: number; actual: number }[]
      nextDayVar?: number
    }>(key)
    if (cached != null) {
      const last = cached.data?.at(-1)
      // Bad tip from market-data lag (exact indexOf miss) — recompute instead of serving.
      const tipBroken = !!last && last.var === 0 && last.actual > 0
      if (!tipBroken) {
        return NextResponse.json(cached, { headers: cacheHeaders })
      }
    }
  }

  const resp = await _GET(req)
  if (resp.status === 200) {
    try {
      const body = await resp.json()
      writeCache(key, body)
      return NextResponse.json(body, { headers: cacheHeaders })
    } catch {
      // fall through
    }
  }
  return resp
}
