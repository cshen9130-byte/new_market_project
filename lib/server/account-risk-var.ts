/**
 * Market-vol helpers for 单账户 VaR (sandbox + next-day prediction).
 * Reads public.raw_akshare_futures_daily only — never public.mom_*.
 */
import { publicQuery } from "@/lib/db"
import { toNum } from "@/lib/server/account-risk-classify"
import { getPrefix } from "@/lib/server/prod-utils"

export const AKSHARE_CODE: Record<string, string> = {
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

const Z_TABLE: Record<string, number> = { "90": 1.282, "95": 1.6449, "99": 2.326 }
const T6_TABLE: Record<string, number> = { "90": 1.440, "95": 1.943, "99": 3.143 }
const LAPLACE_TABLE: Record<string, number> = { "90": 1.138, "95": 1.629, "99": 2.767 }
const LOGISTIC_TABLE: Record<string, number> = { "90": 1.211, "95": 1.623, "99": 2.532 }

export function zScoreFor(distModel: string, confidence: string): number {
  if (distModel === "t") return T6_TABLE[confidence] ?? 1.943
  if (distModel === "laplace") return LAPLACE_TABLE[confidence] ?? 1.629
  if (distModel === "logistic") return LOGISTIC_TABLE[confidence] ?? 1.623
  return Z_TABLE[confidence] ?? 1.6449
}

export function normDate(d: string): string {
  return d.slice(0, 10)
}

export function floorIndex(arr: string[], target: string): number {
  let lo = 0, hi = arr.length - 1, idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= target) { idx = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return idx
}

export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

export function pearsonCorr(x: number[], y: number[]): number {
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

/** Zero contract-rollover spikes so .filter(r => r !== 0) drops them. */
export function zeroRolloverSpikes(rets: number[]): number[] {
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

export type MarketReturns = {
  pctMap: Map<string, Map<string, number>>
  allMktDates: string[]
  cleanPctByCode: Map<string, number[]>
}

/**
 * Product-level daily returns from CFMMC 今结算价.
 * Return is computed per contract, then abs-MV weighted up to the product.
 * Do NOT average prices across months first — a CF409→CF501 roll would look
 * like a 10–30% move and dominate 持仓VaR for one vol window.
 */
export async function loadCfmmcSettleReturns(prods: string[]): Promise<MarketReturns> {
  const empty: MarketReturns = { pctMap: new Map(), allMktDates: [], cleanPctByCode: new Map() }
  if (prods.length === 0) return empty

  const result = await publicQuery(`
    SELECT trade_date::text AS date,
           UPPER(TRIM(instrument)) AS contract,
           AVG(settl_price)::text AS settle,
           SUM(ABS(COALESCE(notional_mv, 0)))::text AS abs_mv
    FROM public.cfmmc_positions
    WHERE settl_price IS NOT NULL AND settl_price > 0
      AND instrument IS NOT NULL AND TRIM(instrument) <> ''
    GROUP BY trade_date, UPPER(TRIM(instrument))
    ORDER BY 1
  `)

  type SettleRow = { date: string; contract: string; settle: string; abs_mv: string }
  const byContract = new Map<string, Map<string, { settle: number; absMv: number }>>()
  const allMktDates = [...new Set(
    (result.rows as SettleRow[]).map(r => normDate(r.date)),
  )].sort()

  for (const r of result.rows as SettleRow[]) {
    if (!isFuturesInstrument(r.contract)) continue
    const prod = getPrefix(r.contract)
    if (prods.length && !prods.includes(prod)) continue
    const d = normDate(r.date)
    if (!byContract.has(r.contract)) byContract.set(r.contract, new Map())
    byContract.get(r.contract)!.set(d, { settle: toNum(r.settle), absMv: Math.max(toNum(r.abs_mv), 1) })
  }

  const pctMap = new Map<string, Map<string, number>>()
  const cleanPctByCode = new Map<string, number[]>()
  for (const prod of prods) {
    const byDate = new Map<string, number>()
    for (let i = 1; i < allMktDates.length; i++) {
      const d = allMktDates[i]
      const prevD = allMktDates[i - 1]
      let num = 0, den = 0
      for (const series of byContract.values()) {
        const today = series.get(d)
        const yest = series.get(prevD)
        if (!today || !yest || yest.settle <= 0 || today.settle <= 0) continue
        // Only contracts that exist on both days — new/expired months add 0.
        num += (today.settle / yest.settle - 1) * today.absMv
        den += today.absMv
      }
      byDate.set(d, den > 0 ? num / den : 0)
    }
    byDate.set(allMktDates[0] ?? "", 0)
    pctMap.set(prod, byDate)
    cleanPctByCode.set(prod, zeroRolloverSpikes(allMktDates.map(d => byDate.get(d) ?? 0)))
  }

  return { pctMap, allMktDates, cleanPctByCode }
}

/** Prefer akshare when it overlaps the book; otherwise CFMMC 今结算价 returns. */
export async function loadVarMarketReturns(
  prods: string[],
  latestDate?: string,
): Promise<MarketReturns & { source: "akshare" | "cfmmc" }> {
  const akCodes = [...new Set(prods.map(p => AKSHARE_CODE[p]).filter(Boolean))]
  const ak = await loadAkshareReturns(akCodes)
  const lastAk = ak.allMktDates.at(-1) ?? ""
  const asOf = latestDate ? normDate(latestDate) : ""
  // Any history is not enough — last print must reach the settlement window.
  if (ak.allMktDates.length >= 5 && (!asOf || lastAk >= asOf)) {
    return { ...ak, source: "akshare" }
  }
  const cfmmc = await loadCfmmcSettleReturns(prods)
  if (cfmmc.allMktDates.length >= 5) return { ...cfmmc, source: "cfmmc" }
  if (ak.allMktDates.length >= 5) return { ...ak, source: "akshare" }
  return { ...cfmmc, source: "cfmmc" }
}

export async function loadAkshareReturns(akCodes: string[]): Promise<MarketReturns> {
  const empty: MarketReturns = { pctMap: new Map(), allMktDates: [], cleanPctByCode: new Map() }
  if (akCodes.length === 0) return empty

  const result = await publicQuery(
    `SELECT trade_date::text AS date, code, pct_change::text AS pct
     FROM public.raw_akshare_futures_daily
     WHERE code = ANY($1) AND pct_change IS NOT NULL
     ORDER BY trade_date`,
    [akCodes],
  )

  const pctMap = new Map<string, Map<string, number>>()
  for (const r of result.rows as { date: string; code: string; pct: string }[]) {
    const d = normDate(r.date)
    if (!pctMap.has(r.code)) pctMap.set(r.code, new Map())
    pctMap.get(r.code)!.set(d, toNum(r.pct) / 100)
  }
  const allMktDates = [...new Set(
    (result.rows as { date: string }[]).map(r => normDate(r.date)),
  )].sort()

  const cleanPctByCode = new Map<string, number[]>()
  for (const code of akCodes) {
    const m = pctMap.get(code)
    cleanPctByCode.set(code, zeroRolloverSpikes(allMktDates.map(d => m?.get(d) ?? 0)))
  }
  return { pctMap, allMktDates, cleanPctByCode }
}

export function sigmaFromClean(cleanRets: number[], volDays: number): number {
  const rets = cleanRets.slice(-volDays).filter(r => r !== 0)
  return stdDev(rets)
}

export function lookupPct(
  pctMap: Map<string, Map<string, number>>,
  prod: string,
  date: string,
): number {
  return pctMap.get(AKSHARE_CODE[prod] ?? "")?.get(date)
    ?? pctMap.get(prod)?.get(date)
    ?? 0
}

export function lookupClean(cleanPctByCode: Map<string, number[]>, prod: string): number[] {
  return cleanPctByCode.get(AKSHARE_CODE[prod] ?? "")
    ?? cleanPctByCode.get(prod)
    ?? []
}

export function corrMatrixFor(
  prods: string[],
  pctMap: Map<string, Map<string, number>>,
  corrDates: string[],
): number[][] {
  const retSeries = prods.map(prod => {
    const m = pctMap.get(AKSHARE_CODE[prod] ?? "") ?? pctMap.get(prod)
    if (!m) return corrDates.map(() => 0)
    return corrDates.map(d => m.get(d) ?? 0)
  })
  const N = prods.length
  return Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (__, j) =>
      i === j ? 1 : Math.round(pearsonCorr(retSeries[i], retSeries[j]) * 10000) / 10000,
    ),
  )
}

export function isFuturesInstrument(contract: string): boolean {
  const c = contract.trim()
  if (!c) return false
  if (c.includes("-") && c.split("-").length >= 3) return false
  if (/[0-9][CP][0-9]/i.test(c)) return false
  return true
}
