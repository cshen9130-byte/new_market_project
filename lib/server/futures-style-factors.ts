/**
 * Futures style-factor daily / cumulative returns from real continuous futures.
 *
 * Primary price source: raw_akshare_futures_daily (AkShare main continuous *0.EXCH).
 * OI / near-far for basis, term-structure, carry, position & speculative factors:
 * raw_futures_contracts_daily (EMQuant), ranked by open interest per product.
 *
 * In-house L/S portfolios on the commodity universe (REPORT_FIT price/OI reconstructions
 * for CTA-report-named factors). data/gtjaqh_closes.csv is offline calibration ground truth only —
 * not used as the live chart source (USE_WIND_GTJAQH defaults false).
 */

import { readFileSync, existsSync } from "fs"
import path from "path"
import { fmtIso, n, query } from "@/lib/db"
import { getPrefix } from "@/lib/server/prod-utils"

export type FuturesStyleSector =
  | "all"
  | "commodity"
  | "black"
  | "nonferrous"
  | "energy"
  | "agri"

export type FuturesStyleFactorKey =
  | "ts_mom_short"
  | "ts_mom_mid"
  | "ts_mom_long"
  | "cs_mom_short"
  | "cs_mom"
  | "term_structure"
  | "basis_mom_short"
  | "basis_mom"
  | "vol_short"
  | "vol"
  | "liquidity"
  | "price_dev"
  | "skew"
  | "kurtosis"
  | "basis"
  | "carry_value"
  | "spec_willingness"
  | "position_chg"
  /** CTA weekly-report style names (in-house reconstructions). */
  | "report_basis"
  | "report_cs_long"
  | "report_pv_corr"
  | "report_long_rule"
  | "report_basis_mom"
  | "report_mid_mom"
  | "report_inventory"
  | "report_profit"
  | "report_long_mom"
  | "report_vol"
  | "report_reversal"
  | "report_skew_wind"
  | "report_term_basis"
  | "report_warehouse"

export type FactorMeta = {
  key: FuturesStyleFactorKey
  cardName: string
  cumName: string
  intervalName: string
  sector: FuturesStyleSector | "all"
  color: string
  /** Which UI surfaces include this factor */
  surfaces: Array<"card" | "daily" | "cum" | "interval">
}

export const FUTURES_STYLE_FACTOR_META: FactorMeta[] = [
  { key: "ts_mom_short", cardName: "时间序列动量(短)", cumName: "短期时间序列动量", intervalName: "短周期时间序列动量", sector: "all", color: "#D93025", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "ts_mom_mid", cardName: "时间序列动量(中)", cumName: "时间序列动量", intervalName: "时间序列动量", sector: "all", color: "#1A73E8", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "ts_mom_long", cardName: "时间序列动量(长)", cumName: "长期时间序列动量", intervalName: "长周期时间序列动量", sector: "all", color: "#FBBC04", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "cs_mom_short", cardName: "截面动量(短)", cumName: "短期截面动量", intervalName: "期限幅度动量", sector: "all", color: "#22c55e", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "cs_mom", cardName: "截面动量", cumName: "截面动量", intervalName: "截面动量", sector: "all", color: "#eab308", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "term_structure", cardName: "期限结构因子", cumName: "期限结构因子", intervalName: "期限结构因子", sector: "all", color: "#84cc16", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "basis_mom_short", cardName: "期限基差动量", cumName: "短期基差动量", intervalName: "期限基差动量", sector: "energy", color: "#9333ea", surfaces: ["cum", "interval"] },
  { key: "basis_mom", cardName: "基差动量(旧)", cumName: "基差动量(旧)", intervalName: "基差动量(旧)", sector: "black", color: "#06b6d4", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "vol_short", cardName: "波动因子(短)", cumName: "低波动因子", intervalName: "短期波动因子", sector: "all", color: "#78716C", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "vol", cardName: "波动因子", cumName: "波动因子", intervalName: "波动因子", sector: "all", color: "#14b8a6", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "liquidity", cardName: "流动性因子", cumName: "流动性因子", intervalName: "流动性因子", sector: "all", color: "#64748b", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "price_dev", cardName: "价格偏离因子", cumName: "均价突破因子", intervalName: "均价突破因子", sector: "all", color: "#b91c1c", surfaces: ["card", "daily", "interval"] },
  { key: "skew", cardName: "偏度因子", cumName: "偏度因子", intervalName: "偏度因子", sector: "all", color: "#EC4899", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "kurtosis", cardName: "峰度因子", cumName: "峰度因子", intervalName: "峰度因子", sector: "all", color: "#2563eb", surfaces: ["cum"] },
  { key: "basis", cardName: "基差因子", cumName: "价值收益因子", intervalName: "基差因子", sector: "energy", color: "#2563eb", surfaces: ["card", "daily", "interval"] },
  { key: "carry_value", cardName: "价值收益因子", cumName: "价值收益因子", intervalName: "价值收益因子", sector: "all", color: "#b91c1c", surfaces: ["cum"] },
  { key: "spec_willingness", cardName: "投机意愿因子", cumName: "投机意愿因子", intervalName: "投机意愿因子", sector: "all", color: "#f97316", surfaces: ["card", "daily"] },
  { key: "position_chg", cardName: "持仓变化因子", cumName: "持仓变化因子", intervalName: "持仓变化因子", sector: "all", color: "#0ea5e9", surfaces: ["card", "daily", "cum", "interval"] },
  // CTA周报名 — REPORT_FIT reconstructions from local futures prices/OI (not vendor NAVs)
  { key: "report_basis", cardName: "基差", cumName: "基差", intervalName: "基差", sector: "all", color: "#7c3aed", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_cs_long", cardName: "长期截面", cumName: "长期截面", intervalName: "长期截面", sector: "all", color: "#db2777", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_pv_corr", cardName: "量价相关性", cumName: "量价相关性", intervalName: "量价相关性", sector: "all", color: "#ea580c", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_long_rule", cardName: "长期规则", cumName: "长期规则", intervalName: "长期规则", sector: "all", color: "#0891b2", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_inventory", cardName: "库存", cumName: "库存", intervalName: "库存", sector: "all", color: "#65a30d", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_profit", cardName: "利润", cumName: "利润", intervalName: "利润", sector: "all", color: "#be123c", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_basis_mom", cardName: "基差动量", cumName: "基差动量", intervalName: "基差动量", sector: "all", color: "#4f46e5", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_mid_mom", cardName: "中期动量", cumName: "中期动量", intervalName: "中期动量", sector: "all", color: "#ca8a04", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_long_mom", cardName: "长期动量", cumName: "长期动量", intervalName: "长期动量", sector: "all", color: "#0d9488", surfaces: [] /* Wind-calib only; no live recon yet */ },
  { key: "report_vol", cardName: "波动", cumName: "波动", intervalName: "波动", sector: "all", color: "#57534e", surfaces: [] /* Wind-calib only; no live recon yet */ },
  { key: "report_reversal", cardName: "反转", cumName: "反转", intervalName: "反转", sector: "all", color: "#c026d3", surfaces: [] /* Wind-calib only; no live recon yet */ },
  { key: "report_skew_wind", cardName: "偏度(报告)", cumName: "偏度(报告)", intervalName: "偏度(报告)", sector: "all", color: "#db2777", surfaces: [] /* Wind-calib only; no live recon yet */ },
  { key: "report_term_basis", cardName: "期限基差", cumName: "期限基差", intervalName: "期限基差", sector: "all", color: "#7c3aed", surfaces: [] /* Wind-calib only; no live recon yet */ },
  { key: "report_warehouse", cardName: "仓单", cumName: "仓单", intervalName: "仓单", sector: "all", color: "#a16207", surfaces: [] /* Wind-calib only; no live recon yet */ },
]

const CFFEX = new Set(["IH", "IF", "IC", "IM", "MO", "T", "TF", "TS", "TL"])

const AKSHARE_SPECIAL: Record<string, string> = {
  SCM: "SC", LCM: "LC", SIM: "SI", ECM: "EC", BCM: "BC",
  NRM: "NR", PDM: "PD", PSM: "PS", PTM: "PT", LUM: "LU",
}

const PRODUCT_SECTOR: Record<string, FuturesStyleSector> = {
  C: "agri", CS: "agri", WH: "agri", PM: "agri", RR: "agri", RI: "agri", JR: "agri", LR: "agri",
  A: "agri", B: "agri", M: "agri", Y: "agri", RM: "agri", OI: "agri", RS: "agri", PK: "agri", P: "agri",
  SR: "agri", CF: "agri", CY: "agri", LG: "agri", SP: "agri", OP: "agri",
  AP: "agri", CJ: "agri", LH: "agri", JD: "agri",
  CU: "nonferrous", BC: "nonferrous", AL: "nonferrous", AO: "nonferrous", AD: "nonferrous",
  ZN: "nonferrous", PB: "nonferrous", NI: "nonferrous", SN: "nonferrous",
  I: "black", SF: "black", SM: "black", RB: "black", HC: "black", SS: "black", WR: "black",
  JM: "black", J: "black", ZC: "black", FG: "black", BB: "black", FB: "black",
  SC: "energy", FU: "energy", LU: "energy", PG: "energy", BU: "energy",
  TA: "energy", EG: "energy", PF: "energy", PR: "energy",
  PL: "energy", PP: "energy", L: "energy",
  BZ: "energy", PX: "energy", EB: "energy",
  RU: "energy", BR: "energy", NR: "energy",
  SA: "energy", SH: "energy", V: "energy", UR: "energy", MA: "energy",
  LC: "energy", PS: "energy", SI: "energy", EC: "energy",
  AU: "energy", AG: "energy", PT: "energy", PD: "energy",
}

/** Extract YYMM / month token from contract e.g. RB2610.SHF → 2610 */
function monthKey(contract: string): string {
  const m = contract.toUpperCase().match(/(\d{3,4})/)
  return m ? m[1] : contract
}

export function productFromAkshareCode(code: string): string {
  const base = code.split(".")[0]?.toUpperCase() ?? ""
  if (/^[A-Z]+0$/.test(base)) return base.slice(0, -1)
  if (AKSHARE_SPECIAL[base]) return AKSHARE_SPECIAL[base]
  return getPrefix(base)
}

function sectorOfProduct(product: string): FuturesStyleSector | null {
  if (CFFEX.has(product)) return null
  return PRODUCT_SECTOR[product] ?? null
}

function productInSector(product: string, sector: FuturesStyleSector): boolean {
  const s = sectorOfProduct(product)
  if (!s) return false
  if (sector === "all" || sector === "commodity") return true
  return s === sector
}

function mean(xs: number[]): number {
  if (!xs.length) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

function skewness(xs: number[]): number {
  if (xs.length < 5) return 0
  const m = mean(xs)
  const s = stdev(xs)
  if (s < 1e-12) return 0
  return mean(xs.map((x) => ((x - m) / s) ** 3))
}

function excessKurtosis(xs: number[]): number {
  if (xs.length < 5) return 0
  const m = mean(xs)
  const s = stdev(xs)
  if (s < 1e-12) return 0
  return mean(xs.map((x) => ((x - m) / s) ** 4)) - 3
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

function rollingCorr(
  xs: (number | null)[],
  ys: number[],
  endIdx: number,
  window: number,
): number | null {
  const a: number[] = []
  const b: number[] = []
  for (let i = endIdx - window + 1; i <= endIdx; i++) {
    if (i < 0) continue
    const x = xs[i]
    const y = ys[i]
    if (x == null || !Number.isFinite(x) || y == null || !Number.isFinite(y)) continue
    a.push(x)
    b.push(y)
  }
  if (a.length < Math.max(8, Math.floor(window * 0.6))) return null
  const mx = mean(a)
  const my = mean(b)
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < a.length; i++) {
    const vx = a[i] - mx
    const vy = b[i] - my
    num += vx * vy
    dx += vx * vx
    dy += vy * vy
  }
  if (dx < 1e-18 || dy < 1e-18) return null
  return num / Math.sqrt(dx * dy)
}


/** OLS of log(price) on time: return slope and R². Used for 长期截面「价格对时间回归」. */
function priceTimeRegression(
  closes: number[],
  endIdx: number,
  window: number,
): { slope: number; r2: number; z: number } | null {
  // Match report-fit searcher: require a full window of index span before fitting.
  if (endIdx + 1 < window) return null
  const xs: number[] = []
  const ys: number[] = []
  const start = endIdx - window + 1
  for (let i = start; i <= endIdx; i++) {
    if (i < 0) continue
    const px = closes[i]
    if (!(px > 0) || !Number.isFinite(px)) continue
    // Calendar offset inside the window (keeps gaps); matches report-fit searcher.
    xs.push(i - start)
    ys.push(Math.log(px))
  }
  // Allow ~1/3 coverage so long-L fits (e.g. L=195) still populate; search fit used max(10, L/3).
  if (xs.length < Math.max(10, Math.floor(window / 3))) return null
  const n = xs.length
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    num += dx * (ys[i] - my)
    den += dx * dx
  }
  if (den < 1e-18) return null
  const slope = num / den
  const intercept = my - slope * mx
  let ssTot = 0
  let ssRes = 0
  const fits: number[] = []
  for (let i = 0; i < n; i++) {
    const fit = intercept + slope * xs[i]
    fits.push(fit)
    ssTot += (ys[i] - my) ** 2
    ssRes += (ys[i] - fit) ** 2
  }
  const r2 = ssTot < 1e-18 ? 0 : 1 - ssRes / ssTot
  const sig = Math.sqrt(ssRes / Math.max(n - 2, 1))
  const z = sig > 1e-12 ? (ys[n - 1] - fits[n - 1]) / sig : 0
  return { slope, r2, z }
}

function tsMomEqualWeight(
  products: string[],
  closeHist: Record<string, number[]>,
  endIdx: number,
  nextRet: Record<string, number>,
  window: number,
): number | null {
  const signed: Array<{ product: string; s: number }> = []
  for (const p of products) {
    const closes = closeHist[p]
    if (!closes) continue
    const R = rollingReturn(closes, endIdx, window)
    if (R == null || nextRet[p] == null) continue
    const s = Math.sign(R)
    if (s !== 0) signed.push({ product: p, s })
  }
  if (signed.length < 4) return null
  return mean(signed.map((x) => x.s * nextRet[x.product]))
}



function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

type PxRow = { date: string; product: string; close: number; volume: number }
type ContractRow = {
  date: string
  product: string
  contract: string
  close: number
  volume: number
  oi: number
  amount: number
  changeOi: number | null
}

async function loadAksharePrices(from: string, to: string): Promise<PxRow[]> {
  const rows = await query<{
    trade_date: Date | string
    code: string
    close: string | number | null
    volume: string | number | null
  }>(
    `SELECT trade_date, code, close, volume
     FROM raw_akshare_futures_daily
     WHERE trade_date >= $1 AND trade_date <= $2
       AND close IS NOT NULL AND CAST(close AS float8) > 0
     ORDER BY trade_date ASC, code ASC`,
    [from, to],
  )
  const out: PxRow[] = []
  for (const row of rows) {
    const product = productFromAkshareCode(row.code)
    if (!sectorOfProduct(product)) continue
    const close = n(row.close)
    if (close == null || close <= 0) continue
    out.push({
      date: fmtIso(row.trade_date),
      product,
      close,
      volume: n(row.volume) ?? 0,
    })
  }
  return out
}

async function loadContractLegs(from: string, to: string): Promise<ContractRow[]> {
  const rows = await query<{
    trade_date: Date | string
    contract: string
    close: string | number | null
    volume: string | number | null
    hqoi: string | number | null
    amount: string | number | null
    change_oi: string | number | null
  }>(
    `SELECT trade_date, contract, close, volume, hqoi, amount, change_oi
     FROM raw_futures_contracts_daily
     WHERE trade_date >= $1 AND trade_date <= $2
       AND close IS NOT NULL AND CAST(close AS float8) > 0
       AND hqoi IS NOT NULL AND CAST(hqoi AS float8) > 0
     ORDER BY trade_date ASC, hqoi DESC`,
    [from, to],
  )
  const out: ContractRow[] = []
  for (const row of rows) {
    const product = getPrefix(row.contract)
    if (!sectorOfProduct(product)) continue
    const close = n(row.close)
    const oi = n(row.hqoi)
    if (close == null || close <= 0 || oi == null || oi <= 0) continue
    out.push({
      date: fmtIso(row.trade_date),
      product,
      contract: row.contract,
      close,
      volume: n(row.volume) ?? 0,
      oi,
      amount: n(row.amount) ?? 0,
      changeOi: n(row.change_oi),
    })
  }
  return out
}

type DayPanel = {
  products: string[]
  ret: Record<string, number>
  close: Record<string, number>
  volume: Record<string, number>
  amount: Record<string, number>
  oi: Record<string, number>
  /** Annualized-ish roll score: ln(near/far). >0 ≈ 贴水/backwardation (near richer than deferred). */
  nearFarCarry: Record<string, number>
  nearClose: Record<string, number>
  farClose: Record<string, number>
  dOi: Record<string, number>
}

function buildPanels(
  prices: PxRow[],
  contracts: ContractRow[],
  sector: FuturesStyleSector,
): { dates: string[]; panels: DayPanel[] } {
  const byDatePx = new Map<string, PxRow[]>()
  for (const row of prices) {
    if (!productInSector(row.product, sector)) continue
    const list = byDatePx.get(row.date) ?? []
    list.push(row)
    byDatePx.set(row.date, list)
  }
  const byDateCtr = new Map<string, ContractRow[]>()
  for (const row of contracts) {
    if (!productInSector(row.product, sector)) continue
    const list = byDateCtr.get(row.date) ?? []
    list.push(row)
    byDateCtr.set(row.date, list)
  }

  const dates = [...byDatePx.keys()].sort()
  const panels: DayPanel[] = []
  let prevOi: Record<string, number> = {}
  let prevClose: Record<string, number> = {}

  for (const date of dates) {
    const pxRows = byDatePx.get(date) ?? []
    const close: Record<string, number> = {}
    const volume: Record<string, number> = {}
    const ret: Record<string, number> = {}
    for (const row of pxRows) {
      close[row.product] = row.close
      volume[row.product] = row.volume
      const pc = prevClose[row.product]
      if (pc != null && pc > 0) ret[row.product] = row.close / pc - 1
    }

    const ctrRows = byDateCtr.get(date) ?? []
    const byProd = new Map<string, ContractRow[]>()
    for (const row of ctrRows) {
      const list = byProd.get(row.product) ?? []
      list.push(row)
      byProd.set(row.product, list)
    }
    const oi: Record<string, number> = {}
    const amount: Record<string, number> = {}
    const nearFarCarry: Record<string, number> = {}
    const nearClose: Record<string, number> = {}
    const farClose: Record<string, number> = {}
    const dOi: Record<string, number> = {}
    for (const [product, list] of byProd) {
      list.sort((a, b) => b.oi - a.oi)
      const near = list[0]
      oi[product] = near.oi
      amount[product] = near.amount
      nearClose[product] = near.close
      const prev = prevOi[product]
      if (near.changeOi != null && Number.isFinite(near.changeOi)) dOi[product] = near.changeOi
      else if (prev != null && prev > 0) dOi[product] = near.oi / prev - 1
      // Prefer next calendar month with OI; else second by OI.
      const far =
        list.find((c) => c.contract !== near.contract && monthKey(c.contract) !== monthKey(near.contract))
        ?? list.find((c) => c.contract !== near.contract)
      if (far && far.close > 0) {
        farClose[product] = far.close
        // ln(near/far): >0 near richer than deferred → 贴水/backwardation roll yield
        nearFarCarry[product] = Math.log(near.close / far.close)
      }
    }

    panels.push({
      products: Object.keys(close),
      ret,
      close,
      volume,
      amount,
      oi,
      nearFarCarry,
      nearClose,
      farClose,
      dOi,
    })
    prevClose = { ...prevClose, ...close }
    prevOi = { ...prevOi, ...oi }
  }

  return { dates, panels }
}

function rollingReturn(closes: number[], endIdx: number, window: number): number | null {
  if (endIdx - window < 0) return null
  const a = closes[endIdx - window]
  const b = closes[endIdx]
  if (!(a > 0) || !(b > 0)) return null
  return b / a - 1
}

function rollingStdFromRets(rets: (number | null)[], endIdx: number, window: number): number | null {
  const xs: number[] = []
  for (let i = endIdx - window + 1; i <= endIdx; i++) {
    if (i < 0) continue
    const v = rets[i]
    if (v != null && Number.isFinite(v)) xs.push(v)
  }
  if (xs.length < Math.max(5, Math.floor(window * 0.6))) return null
  return stdev(xs)
}

/**
 * Deck CS construction: 多第一组空最后一组，多空市值相等，无净敞口.
 * Equal-dollar: equal weight within long basket and short basket; long top/bottom quintile.
 */
function crossSectionLs(
  scores: Array<{ product: string; score: number }>,
  nextRet: Record<string, number>,
  longHigh: boolean,
  topFrac = 0.2,
): number | null {
  const usable = scores.filter((s) => Number.isFinite(s.score) && nextRet[s.product] != null)
  if (usable.length < 6) return null
  usable.sort((a, b) => a.score - b.score)
  const nTake = Math.max(1, Math.floor(usable.length * topFrac))
  const low = usable.slice(0, nTake)
  const high = usable.slice(-nTake)
  const longSide = longHigh ? high : low
  const shortSide = longHigh ? low : high
  // Equal notional long vs short ⇒ mean(long) − mean(short); net exposure ≈ 0
  return mean(longSide.map((x) => nextRet[x.product])) - mean(shortSide.map((x) => nextRet[x.product]))
}

/** Mid-horizon MA cross: sign(MA_fast − MA_slow), vol-scaled TS weights (deck: 均线交叉 → 中期动量). */
function maCrossTsReturn(
  products: string[],
  closeHist: Record<string, number[]>,
  retHist: Record<string, (number | null)[]>,
  endIdx: number,
  nextRet: Record<string, number>,
  fast: number,
  slow: number,
): number | null {
  const weights: Array<{ product: string; w: number }> = []
  for (const p of products) {
    const closes = closeHist[p]
    const rets = retHist[p]
    if (!closes || !rets || endIdx + 1 < slow) continue
    if (nextRet[p] == null) continue
    let sumF = 0
    let sumS = 0
    let nF = 0
    let nS = 0
    for (let i = endIdx - slow + 1; i <= endIdx; i++) {
      if (i < 0) continue
      const px = closes[i]
      if (!(px > 0)) continue
      sumS += px
      nS += 1
      if (i > endIdx - fast) {
        sumF += px
        nF += 1
      }
    }
    if (nF < fast * 0.6 || nS < slow * 0.6) continue
    const maF = sumF / nF
    const maS = sumS / nS
    const signal = Math.sign(maF - maS)
    if (signal === 0) continue
    const vol = rollingStdFromRets(rets, endIdx, 60)
    const sigma = vol != null && vol > 1e-8 ? vol : 0.01
    weights.push({ product: p, w: signal / sigma })
  }
  if (weights.length < 4) return null
  const denom = weights.reduce((s, x) => s + Math.abs(x.w), 0)
  if (denom < 1e-12) return null
  return weights.reduce((s, x) => s + (x.w / denom) * nextRet[x.product], 0)
}

function tsMomReturn(
  products: string[],
  closeHist: Record<string, number[]>,
  retHist: Record<string, (number | null)[]>,
  endIdx: number,
  nextRet: Record<string, number>,
  window: number,
  volWindow = 60,
  equalWeight = false,
): number | null {
  const weights: Array<{ product: string; w: number }> = []
  for (const p of products) {
    const closes = closeHist[p]
    const rets = retHist[p]
    if (!closes || !rets) continue
    const R = rollingReturn(closes, endIdx, window)
    const vol = rollingStdFromRets(rets, endIdx, volWindow)
    if (R == null || nextRet[p] == null) continue
    const sigma = vol != null && vol > 1e-8 ? vol : 0.01
    const w = equalWeight ? Math.sign(R) : Math.sign(R) / sigma
    if (w !== 0) weights.push({ product: p, w })
  }
  if (weights.length < 4) return null
  const denom = weights.reduce((s, x) => s + Math.abs(x.w), 0)
  if (denom < 1e-12) return null
  return weights.reduce((s, x) => s + (x.w / denom) * nextRet[x.product], 0)
}


/** Live charts use REPORT_FIT reconstructions. Keep false in production.
 * loadGtjaqhCloses / WIND_GTJAQH_FACTOR_MAP remain for offline calibration scripts only.
 * Set true only for local A/B against cached Wind NAVs — never the preferred path. */
export const USE_WIND_GTJAQH = false

/**
 * Code→UI factor mapping from the user Wind Excel (CTA因子 sheet).
 * NOTE: numbering differs from CTA3 deck GTJAQH017/019/… labels.
 * 长期截面 ← GTJAQH013「截面动量」(closest label in file; not a dedicated「长期截面」code).
 */
export const WIND_GTJAQH_FACTOR_MAP: Partial<Record<FuturesStyleFactorKey, string>> = {
  report_long_mom: "GTJAQH001.WI", // 长期动量
  report_vol: "GTJAQH002.WI", // 波动
  report_reversal: "GTJAQH003.WI", // 反转
  report_term_basis: "GTJAQH004.WI", // 期限基差
  report_warehouse: "GTJAQH005.WI", // 仓单
  report_skew_wind: "GTJAQH006.WI", // 偏度
  report_inventory: "GTJAQH007.WI", // 库存
  report_mid_mom: "GTJAQH008.WI", // 中期动量
  report_profit: "GTJAQH009.WI", // 利润
  report_long_rule: "GTJAQH010.WI", // 长期规则动量
  report_pv_corr: "GTJAQH011.WI", // 量价相关性
  report_basis: "GTJAQH012.WI", // 基差
  report_cs_long: "GTJAQH013.WI", // 截面动量 → UI「长期截面」
}

type GtjaqhTable = {
  dates: string[]
  /** code → date → close */
  closes: Record<string, Record<string, number>>
  minDate: string | null
  maxDate: string | null
}

let _gtjaqhCache: GtjaqhTable | null = null

export function loadGtjaqhCloses(csvPath?: string): GtjaqhTable {
  if (_gtjaqhCache && !csvPath) return _gtjaqhCache
  const file = csvPath ?? path.join(process.cwd(), "data", "gtjaqh_closes.csv")
  if (!existsSync(file)) {
    return { dates: [], closes: {}, minDate: null, maxDate: null }
  }
  const raw = readFileSync(file, "utf-8")
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return { dates: [], closes: {}, minDate: null, maxDate: null }
  const header = lines[0].split(",").map((h) => h.trim())
  const dateIdx = header.indexOf("date")
  const codes = header.filter((h) => h !== "date")
  const closes: Record<string, Record<string, number>> = {}
  for (const c of codes) closes[c] = {}
  const dates: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",")
    const d = (cols[dateIdx] ?? "").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    dates.push(d)
    for (const c of codes) {
      const j = header.indexOf(c)
      const v = Number(cols[j])
      if (Number.isFinite(v) && v > 0) closes[c][d] = v
    }
  }
  const table: GtjaqhTable = {
    dates,
    closes,
    minDate: dates[0] ?? null,
    maxDate: dates[dates.length - 1] ?? null,
  }
  if (!csvPath) _gtjaqhCache = table
  return table
}

/** Forward-fill closes onto an arbitrary date grid; daily frac from aligned levels. */
function windSeriesOnDates(
  table: GtjaqhTable,
  code: string,
  dates: string[],
): { daily: (number | null)[]; cumPct: number[]; closes: (number | null)[] } {
  const series = table.closes[code] ?? {}
  const aligned: (number | null)[] = []
  let last: number | null = null
  for (const d of dates) {
    const px = series[d]
    if (px != null && px > 0) last = px
    aligned.push(last)
  }
  const daily: (number | null)[] = Array(dates.length).fill(null)
  for (let i = 1; i < aligned.length; i++) {
    const a = aligned[i - 1]
    const b = aligned[i]
    if (a != null && b != null && a > 0) daily[i] = b / a - 1
  }
  // Cumulative index return from first valid close in range: (P_t / P_0 - 1) * 100
  let p0: number | null = null
  const cumPct: number[] = []
  for (const px of aligned) {
    if (px != null && px > 0 && p0 == null) p0 = px
    if (p0 != null && px != null && px > 0) cumPct.push(round2((px / p0 - 1) * 100))
    else cumPct.push(cumPct.length ? cumPct[cumPct.length - 1] : 0)
  }
  return { daily, cumPct, closes: aligned }
}


/** REPORT_FIT knobs. Refined 2026-10-26 vs Wind GTJAQH closes (3m+1y). Live charts use these — NOT Wind NAVs. */
let REPORT_FIT = {
  basisTopFrac: 0.2,
  basisScale: 0.1,
  // round12 CE: 5-leg blend (pow1.25 secNegZ L185 + negSlope L250@{0.2,0.15,0.12} + negZ L100)
  csLongL: 120,
  csLongR2: 0.15,
  csLongTopFrac: 0.15,
  csLongNegZ: false,
  csLongDemean: true,
  csLongSectorNeutral: true,
  csLongScale: -1.0,
  csLongBlend: {
    enabled: false,
    scale: 1.8787244025697993,
    legs: [
      { kind: "neg_z" as const, L: 185, topFrac: 0.15, sectorNeutral: true, powerDaily: 1.25, weight: 0.3639555533765323 },
      { kind: "neg_slope" as const, L: 250, topFrac: 0.2, sectorNeutral: false, power: 1, weight: -0.6373164850616742 },
      { kind: "neg_slope" as const, L: 250, topFrac: 0.15, sectorNeutral: false, power: 1, weight: 0.8327017069261762 },
      { kind: "neg_z" as const, L: 100, topFrac: 0.2, sectorNeutral: false, power: 1, weight: 0.07272317876321709 },
      { kind: "neg_slope" as const, L: 250, topFrac: 0.12, sectorNeutral: false, power: 1, weight: -0.2479341337315459 },
    ],
  },
  // round14 CE: 8-leg multi-field shock blend (ret~0.56 lvl~0.90)
  pvKind: "dOiShockBlend" as const,
  pvCorrL: 50,
  pvCorrMode: "absret" as const,
  pvCorrLongHigh: false,
  pvTopFrac: 0.1,
  pvCorrScale: 1.0,
  pvHighPass: 0,
  pvBlend: {
    scale: -0.18297100853639145,
    legs: [
      { key: "dOi" as const, L: 50, hp: 35, topFrac: 0.1, weight: -0.13598887160806117 },
      { key: "dOi" as const, L: 50, hp: 25, topFrac: 0.1, weight: -0.4146705952137717 },
      { key: "oiPct" as const, L: 30, hp: 15, topFrac: 0.1, weight: 0.33239138173293237 },
      { key: "signRetDoi" as const, L: 20, hp: 25, topFrac: 0.1, weight: -0.11625363592342036 },
      { key: "turnover" as const, L: 30, hp: 25, topFrac: 0.1, weight: 0.3010914901022196 },
      { key: "amount" as const, L: 20, hp: 15, topFrac: 0.1, weight: -0.3266460862556671 },
      { key: "dOi" as const, L: 50, hp: 10, topFrac: 0.1, weight: 0.19216294471797335 },
      { key: "dOi" as const, L: 20, hp: 0, topFrac: 0.1, weight: -0.03369502007943511 },
    ],
  },
  // close-enough winner round7: momLowVol L=98 cap=0.6 inv-vol weights flip
  longRuleL: 150,
  longRuleEqualW: false,
  longRuleFlip: true,
  longRuleVolL: 40,
  longRuleVolCap: 1.2,
  longRuleScale: -0.7,
  invTopFrac: 0.25,
  invScale: 0.4,
  profitTopFrac: 0.25,
  profitScale: 0.1,
}

/** Calibration-only: shallow-merge knobs (and nested blend objects). Do not use in UI path. */
export function getReportFit() {
  return REPORT_FIT
}
export function setReportFitOverride(partial: Record<string, unknown> | null) {
  if (!partial) return
  const next: any = { ...REPORT_FIT, ...partial }
  if (partial.csLongBlend && typeof partial.csLongBlend === "object") {
    next.csLongBlend = { ...(REPORT_FIT as any).csLongBlend, ...(partial as any).csLongBlend }
    if ((partial as any).csLongBlend.legs) next.csLongBlend.legs = (partial as any).csLongBlend.legs
  }
  if (partial.pvBlend && typeof partial.pvBlend === "object") {
    next.pvBlend = { ...(REPORT_FIT as any).pvBlend, ...(partial as any).pvBlend }
    if ((partial as any).pvBlend.legs) next.pvBlend.legs = (partial as any).pvBlend.legs
  }
  REPORT_FIT = next
}
export function resetReportFit(base: typeof REPORT_FIT) {
  REPORT_FIT = base
}


function computeDailyFactorReturns(
  dates: string[],
  panels: DayPanel[],
): Record<FuturesStyleFactorKey, (number | null)[]> {
  const keys = FUTURES_STYLE_FACTOR_META.map((m) => m.key)
  const uniqueKeys = [...new Set(keys)]
  const out = Object.fromEntries(uniqueKeys.map((k) => [k, Array(dates.length).fill(null)])) as Record<
    FuturesStyleFactorKey,
    (number | null)[]
  >

  const pvRawHist: (number | null)[] = Array(dates.length).fill(null)
  const pvLegRaw: (number | null)[][] = (REPORT_FIT.pvBlend?.legs ?? []).map(() => Array(dates.length).fill(null))
  const closeHist: Record<string, number[]> = {}
  const retHist: Record<string, (number | null)[]> = {}
  const carryHist: Record<string, (number | null)[]> = {}
  const dOiHist: Record<string, (number | null)[]> = {}
  const volHist: Record<string, number[]> = {}
  const amtHist: Record<string, number[]> = {}
  const oiHist: Record<string, (number | null)[]> = {}

  for (let i = 0; i < dates.length; i++) {
    const panel = panels[i]
    for (const p of panel.products) {
      if (!closeHist[p]) { closeHist[p] = []; retHist[p] = []; carryHist[p] = []; dOiHist[p] = []; volHist[p] = []; amtHist[p] = []; oiHist[p] = [] }
      while (closeHist[p].length < i) {
        const prevClose = closeHist[p].length ? closeHist[p][closeHist[p].length - 1] : NaN
        closeHist[p].push(Number.isFinite(prevClose) ? prevClose : NaN)
        retHist[p].push(null)
        carryHist[p].push(null)
        dOiHist[p].push(null)
        volHist[p].push(volHist[p].length ? volHist[p][volHist[p].length - 1] : 0)
        amtHist[p].push(amtHist[p].length ? amtHist[p][amtHist[p].length - 1] : 0)
        oiHist[p].push(null)
      }
      closeHist[p].push(panel.close[p])
      retHist[p].push(panel.ret[p] ?? null)
      carryHist[p].push(panel.nearFarCarry[p] ?? null)
      dOiHist[p].push(panel.dOi[p] ?? null)
      volHist[p].push(panel.volume[p] ?? 0)
      amtHist[p].push(panel.amount[p] ?? 0)
      oiHist[p].push(panel.oi[p] ?? null)
    }

    if (i + 1 >= dates.length) continue
    const nextRet = panels[i + 1].ret
    const products = panel.products.filter((p) => nextRet[p] != null)
    if (products.length < 4) continue

    out.ts_mom_short[i + 1] = tsMomReturn(products, closeHist, retHist, i, nextRet, 20)
    out.ts_mom_mid[i + 1] = tsMomReturn(products, closeHist, retHist, i, nextRet, 60)
    out.ts_mom_long[i + 1] = tsMomReturn(products, closeHist, retHist, i, nextRet, 120)

    const cs20: Array<{ product: string; score: number }> = []
    const cs60: Array<{ product: string; score: number }> = []
    for (const p of products) {
      const r20 = rollingReturn(closeHist[p], i, 20)
      const r60 = rollingReturn(closeHist[p], i, 60)
      if (r20 != null) cs20.push({ product: p, score: r20 })
      if (r60 != null) cs60.push({ product: p, score: r60 })
    }
    out.cs_mom_short[i + 1] = crossSectionLs(cs20, nextRet, true)
    out.cs_mom[i + 1] = crossSectionLs(cs60, nextRet, true)

    const carryScores: Array<{ product: string; score: number }> = []
    const basisMomScores: Array<{ product: string; score: number }> = []
    for (const p of products) {
      const c = panel.nearFarCarry[p]
      if (c != null) carryScores.push({ product: p, score: c })
      const hist = carryHist[p]
      if (hist && i >= 20) {
        const now = hist[i]
        const past = hist[i - 20]
        if (now != null && past != null) basisMomScores.push({ product: p, score: now - past })
      }
    }
    out.term_structure[i + 1] = crossSectionLs(carryScores, nextRet, true)
    out.basis[i + 1] = crossSectionLs(carryScores, nextRet, true)
    out.carry_value[i + 1] = out.basis[i + 1]
    out.basis_mom_short[i + 1] = crossSectionLs(basisMomScores, nextRet, true)
    out.basis_mom[i + 1] = out.basis_mom_short[i + 1]

    const vol20: Array<{ product: string; score: number }> = []
    const vol60: Array<{ product: string; score: number }> = []
    const liq: Array<{ product: string; score: number }> = []
    const dev: Array<{ product: string; score: number }> = []
    const skewScores: Array<{ product: string; score: number }> = []
    const kurtScores: Array<{ product: string; score: number }> = []
    const specScores: Array<{ product: string; score: number }> = []
    const posScores: Array<{ product: string; score: number }> = []

    for (const p of products) {
      const v20 = rollingStdFromRets(retHist[p], i, 20)
      const v60 = rollingStdFromRets(retHist[p], i, 60)
      if (v20 != null) vol20.push({ product: p, score: v20 })
      if (v60 != null) vol60.push({ product: p, score: v60 })

      const rets20: number[] = []
      let volSum = 0
      let volN = 0
      for (let j = i - 19; j <= i; j++) {
        if (j < 0) continue
        const r = retHist[p][j]
        if (r != null) rets20.push(r)
        const vv = volHist[p][j]
        if (vv != null && vv > 0) { volSum += vv; volN += 1 }
      }
      const avgVol = volN > 0 ? volSum / volN : 0
      const lastRet = retHist[p][i]
      if (lastRet != null && avgVol > 0) {
        liq.push({ product: p, score: Math.abs(lastRet) / avgVol })
      }

      if (closeHist[p].length > 20) {
        const windowCloses = closeHist[p].slice(Math.max(0, i - 19), i + 1).filter((x) => Number.isFinite(x) && x > 0)
        if (windowCloses.length >= 10) {
          const ma = mean(windowCloses)
          if (ma > 0) dev.push({ product: p, score: closeHist[p][i] / ma - 1 })
        }
      }

      if (rets20.length >= 10) {
        skewScores.push({ product: p, score: skewness(rets20) })
        kurtScores.push({ product: p, score: excessKurtosis(rets20) })
      }

      const oi = panel.oi[p]
      const volume = panel.volume[p]
      if (oi != null && oi > 0 && volume != null) {
        specScores.push({ product: p, score: volume / oi })
      }
      const dOi = panel.dOi[p]
      const r = panel.ret[p]
      if (dOi != null && r != null) {
        posScores.push({ product: p, score: Math.sign(r) * dOi })
      }
    }

    // Long low-vol / short high-vol
    out.vol_short[i + 1] = crossSectionLs(vol20, nextRet, false)
    out.vol[i + 1] = crossSectionLs(vol60, nextRet, false)
    // Amihud: long low / short high
    out.liquidity[i + 1] = crossSectionLs(liq, nextRet, false)
    // Price deviation: reverse — long low Dev / short high
    out.price_dev[i + 1] = crossSectionLs(dev, nextRet, false)
    out.skew[i + 1] = crossSectionLs(skewScores, nextRet, false)
    out.kurtosis[i + 1] = crossSectionLs(kurtScores, nextRet, false)
    out.spec_willingness[i + 1] = crossSectionLs(specScores, nextRet, true)
    out.position_chg[i + 1] = crossSectionLs(posScores, nextRet, true)

    // ── CTA周报-style reconstructions (NOT GTJAQH*.WI / Wind). Fit knobs in REPORT_FIT. ──
    // CS: equal-dollar long top / short bottom. Scales shrink amp toward 周报「最近三个月」.

    // 基差: ln(near/far), long 贴水 / short 升水, topFrac≈6%, then amp scale.
    {
      const r = crossSectionLs(carryScores, nextRet, true, REPORT_FIT.basisTopFrac)
      out.report_basis[i + 1] = r == null ? null : r * REPORT_FIT.basisScale
    }

    const slopeScores: Array<{ product: string; score: number }> = []
    const pvScores: Array<{ product: string; score: number }> = []
    const rollYieldMomScores: Array<{ product: string; score: number }> = []
    for (const p of products) {
      // 长期截面 legA: log(P)~t OLS residual z (optional sector-neutral later)
      const reg = priceTimeRegression(closeHist[p], i, REPORT_FIT.csLongL)
      if (reg != null && reg.r2 >= REPORT_FIT.csLongR2) {
        const score = REPORT_FIT.csLongNegZ ? -reg.z : reg.slope
        slopeScores.push({ product: p, score })
      }

      // 量价: OI-change shock z-score (change_oi), long LOW shock
      if (REPORT_FIT.pvKind === "dOiShock") {
        const series = dOiHist[p]
        if (series) {
          const L = REPORT_FIT.pvCorrL
          const vals: number[] = []
          for (let j = i - L + 1; j <= i; j++) {
            if (j < 0) continue
            const v = series[j]
            if (v != null && Number.isFinite(v)) vals.push(v)
          }
          if (vals.length >= Math.max(3, Math.floor(L / 3))) {
            const m = mean(vals)
            const s = stdev(vals)
            const last = series[i]
            if (last != null && s > 1e-12) pvScores.push({ product: p, score: (last - m) / s })
          }
        }
      } else {
        const closes = closeHist[p]
        const vols = volHist[p]
        if (closes && vols) {
          const rets = retHist[p] ?? []
          const absRet: (number | null)[] = []
          const volSeries: (number | null)[] = []
          for (let k = 0; k < closes.length; k++) {
            const rv = rets[k]
            absRet.push(rv == null ? null : Math.abs(rv))
            const vv = vols[k]
            volSeries.push(vv != null && Number.isFinite(vv) ? vv : null)
          }
          const c = rollingCorr(absRet, volSeries, i, REPORT_FIT.pvCorrL)
          if (c != null) pvScores.push({ product: p, score: c })
        }
      }

      // 基差动量
      const hist = carryHist[p]
      if (hist && i >= 20) {
        const now = hist[i]
        const past = hist[i - 20]
        if (now != null && past != null) rollYieldMomScores.push({ product: p, score: now - past })
      }
    }
    const demeanInPlace = (scores: Array<{ product: string; score: number }>, sectorNeutral: boolean) => {
      if (sectorNeutral && scores.length >= 3) {
        const bySec = new Map<string, Array<{ product: string; score: number }>>()
        for (const s of scores) {
          const sec = sectorOfProduct(s.product) ?? "x"
          const list = bySec.get(sec) ?? []
          list.push(s)
          bySec.set(sec, list)
        }
        for (const list of bySec.values()) {
          if (list.length < 3) continue
          const mm = mean(list.map((x) => x.score))
          for (const s of list) s.score -= mm
        }
      }
      if (REPORT_FIT.csLongDemean && scores.length >= 6) {
        const m0 = mean(scores.map((s) => s.score))
        const sd = stdev(scores.map((s) => s.score)) || 1
        for (const s of scores) s.score = (s.score - m0) / sd
      }
    }
    if (REPORT_FIT.csLongBlend?.enabled && REPORT_FIT.csLongBlend.legs?.length) {
      let mixed = 0
      let any = false
      for (const leg of REPORT_FIT.csLongBlend.legs) {
        const scores: Array<{ product: string; score: number }> = []
        for (const p of products) {
          const reg = priceTimeRegression(closeHist[p], i, leg.L)
          if (reg == null || reg.r2 < REPORT_FIT.csLongR2) continue
          const score = leg.kind === "neg_slope" ? -reg.slope : leg.kind === "z" ? reg.z : -reg.z
          scores.push({ product: p, score })
        }
        demeanInPlace(scores, !!leg.sectorNeutral)
        let r = crossSectionLs(scores, nextRet, true, leg.topFrac)
        if (r != null && leg.powerDaily && leg.powerDaily !== 1) {
          r = Math.sign(r) * Math.pow(Math.abs(r), leg.powerDaily)
        }
        if (r != null) { mixed += leg.weight * r; any = true }
      }
      out.report_cs_long[i + 1] = any ? mixed * REPORT_FIT.csLongBlend.scale : null
    } else {
      demeanInPlace(slopeScores, !!REPORT_FIT.csLongSectorNeutral)
      const rA = crossSectionLs(slopeScores, nextRet, true, REPORT_FIT.csLongTopFrac)
      out.report_cs_long[i + 1] = rA == null ? null : rA * REPORT_FIT.csLongScale
    }
    {
      const hpApply = (series: (number | null)[], end: number, hp: number): number | null => {
        if (!hp) return series[end]
        const a = 2 / (hp + 1)
        let ewma: number | null = null
        let outR: number | null = null
        for (let j = 0; j <= end; j++) {
          const v = series[j]
          if (v == null || !Number.isFinite(v)) continue
          ewma = ewma == null ? v : a * v + (1 - a) * ewma
          if (j === end) outR = v - (ewma ?? 0)
        }
        return outR
      }
      if (REPORT_FIT.pvKind === "dOiShockBlend" && REPORT_FIT.pvBlend?.legs?.length) {
        let mixed = 0
        let any = false
        REPORT_FIT.pvBlend.legs.forEach((leg, li) => {
          const scores: Array<{ product: string; score: number }> = []
          for (const p of products) {
            const L = leg.L
            let series: (number | null)[] = []
            const key = (leg as { key?: string }).key ?? "dOi"
            if (key === "dOi") series = dOiHist[p] ?? []
            else if (key === "amount") series = (amtHist[p] ?? []).map((v) => (Number.isFinite(v) ? v : null))
            else if (key === "oiPct") {
              const oi = oiHist[p] ?? []
              series = oi.map((v, ii) => {
                const prev = ii > 0 ? oi[ii - 1] : null
                return v != null && prev != null && prev > 0 ? v / prev - 1 : null
              })
            } else if (key === "turnover") {
              const amt = amtHist[p] ?? []
              const oi = oiHist[p] ?? []
              series = amt.map((a, ii) => {
                const o = oi[ii]
                return a != null && o != null && o > 0 ? a / o : null
              })
            } else if (key === "signRetDoi") {
              const rets = retHist[p] ?? []
              const d = dOiHist[p] ?? []
              series = rets.map((r, ii) => (r != null && d[ii] != null ? Math.sign(r) * (d[ii] as number) : null))
            } else series = dOiHist[p] ?? []
            const vals: number[] = []
            for (let j = i - L + 1; j <= i; j++) {
              if (j < 0) continue
              const v = series[j]
              if (v != null && Number.isFinite(v)) vals.push(v)
            }
            if (vals.length >= Math.max(3, Math.floor(L / 3))) {
              const m0 = mean(vals)
              const s0 = stdev(vals)
              const last = series[i]
              if (last != null && s0 > 1e-12) scores.push({ product: p, score: (last - m0) / s0 })
            }
          }
          const r = crossSectionLs(scores, nextRet, false, leg.topFrac)
          pvLegRaw[li][i + 1] = r
          const hpd = hpApply(pvLegRaw[li], i + 1, leg.hp)
          if (hpd != null) {
            mixed += leg.weight * hpd
            any = true
          }
        })
        out.report_pv_corr[i + 1] = any ? mixed * (REPORT_FIT.pvBlend.scale ?? 1) : null
      } else {
        const r = crossSectionLs(pvScores, nextRet, REPORT_FIT.pvCorrLongHigh, REPORT_FIT.pvTopFrac ?? 0.2)
        const scaled = r == null ? null : r * REPORT_FIT.pvCorrScale
        pvRawHist[i + 1] = scaled
        const hp = REPORT_FIT.pvHighPass ?? 0
        out.report_pv_corr[i + 1] = hp && scaled != null ? hpApply(pvRawHist, i + 1, hp) : scaled
      }
    }
    out.report_basis_mom[i + 1] = crossSectionLs(rollYieldMomScores, nextRet, true)

    // 长期规则: equal-weight mom L, skip high-vol regime (v20 > cap*v120), optional flip
    {
      const signalProducts: string[] = []
      const closeH = closeHist
      const retH = retHist
      const weights: Array<{ product: string; w: number }> = []
      for (const p of products) {
        const R = rollingReturn(closeH[p], i, REPORT_FIT.longRuleL)
        const v20 = rollingStdFromRets(retH[p], i, 20)
        const v120 = rollingStdFromRets(retH[p], i, 120)
        if (R == null || nextRet[p] == null) continue
        if (v20 != null && v120 != null && v20 > (REPORT_FIT.longRuleVolCap ?? 1) * v120) continue
        let sig = Math.sign(R)
        if (sig === 0) continue
        if (REPORT_FIT.longRuleFlip) sig = -sig
        if (REPORT_FIT.longRuleEqualW) weights.push({ product: p, w: sig })
        else {
          const vol = rollingStdFromRets(retH[p], i, REPORT_FIT.longRuleVolL)
          const sigma = vol != null && vol > 1e-8 ? vol : 0.01
          weights.push({ product: p, w: sig / sigma })
        }
        signalProducts.push(p)
      }
      let r: number | null = null
      if (weights.length >= 4) {
        const denom = weights.reduce((s, x) => s + Math.abs(x.w), 0)
        if (denom >= 1e-12) r = weights.reduce((s, x) => s + (x.w / denom) * nextRet[x.product], 0)
      }
      out.report_long_rule[i + 1] = r == null ? null : r * REPORT_FIT.longRuleScale
    }
    // 中期动量: MA20 vs MA60, vol-scaled TS.
    out.report_mid_mom[i + 1] = maCrossTsReturn(products, closeHist, retHist, i, nextRet, 20, 60)

    // 库存 proxy (no fundamental inventory feed): long contracts with falling OI / short rising OI
    {
      const scores: Array<{ product: string; score: number }> = []
      for (const p of products) {
        const d = panel.dOi[p]
        if (d != null && Number.isFinite(d)) scores.push({ product: p, score: -d })
      }
      const r = crossSectionLs(scores, nextRet, true, (REPORT_FIT as any).invTopFrac ?? 0.2)
      out.report_inventory[i + 1] = r == null ? null : r * ((REPORT_FIT as any).invScale ?? 0.5)
    }
    // 利润 proxy: long high carry (backwardation) / short low — industry "processing margin" often tracks term structure
    {
      const r = crossSectionLs(carryScores, nextRet, true, (REPORT_FIT as any).profitTopFrac ?? 0.15)
      out.report_profit[i + 1] = r == null ? null : r * ((REPORT_FIT as any).profitScale ?? 0.4)
    }


  }

  return out
}

function cumulativeFromDaily(dailyPct: (number | null)[]): number[] {
  let cum = 0
  return dailyPct.map((v, i) => {
    if (i === 0) return 0
    if (v == null || !Number.isFinite(v)) return round2(cum)
    cum += v
    return round2(cum)
  })
}

function compoundReturnPct(dailyFrac: (number | null)[], fromIdx: number, toIdx: number): number {
  let acc = 1
  for (let i = fromIdx; i <= toIdx; i++) {
    const v = dailyFrac[i]
    if (v == null || !Number.isFinite(v)) continue
    acc *= 1 + v
  }
  return round2((acc - 1) * 100)
}

function findDateIdx(dates: string[], target: string): number {
  let best = -1
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] <= target) best = i
    else break
  }
  return best
}

export type FuturesStyleReturnsPayload = {
  ok: true
  from: string
  to: string
  sector: FuturesStyleSector
  auto: boolean
  minDate: string | null
  maxDate: string | null
  dates: string[]
  source: {
    prices: string
    oiCarry: string
    note: string
  }
  cards: Array<{ key: FuturesStyleFactorKey; name: string; value: number; sector: FactorMeta["sector"] }>
  daily: Array<{ key: FuturesStyleFactorKey; name: string; color: string; data: number[] }>
  cumulative: Array<{ key: FuturesStyleFactorKey; name: string; color: string; data: number[] }>
  interval: Array<{ key: FuturesStyleFactorKey; name: string; sector: FactorMeta["sector"]; returns: number[] }>
}


export type FuturesStyleDataBounds = {
  minDate: string | null
  maxDate: string | null
}

/** Latest / earliest trade dates available for style-factor construction. */
export async function getFuturesStyleDataBounds(): Promise<FuturesStyleDataBounds> {
  const rows = await query<{ min_d: Date | string | null; max_d: Date | string | null }>(
    `SELECT MIN(trade_date) AS min_d, MAX(trade_date) AS max_d
     FROM raw_akshare_futures_daily
     WHERE close IS NOT NULL AND CAST(close AS float8) > 0`,
  )
  const row = rows[0]
  return {
    minDate: row?.min_d != null ? fmtIso(row.min_d) : null,
    maxDate: row?.max_d != null ? fmtIso(row.max_d) : null,
  }
}

/** Default window ≈ prior Mar–Jun UX (~94 calendar days / ~3 months) ending at latest data. */
export function defaultFuturesStyleRange(maxDate: string): { from: string; to: string } {
  return { from: shiftDate(maxDate, -94), to: maxDate }
}

export async function resolveFuturesStyleRange(
  from: string | null | undefined,
  to: string | null | undefined,
): Promise<{ from: string; to: string; maxDate: string | null; minDate: string | null; auto: boolean }> {
  const bounds = await getFuturesStyleDataBounds()
  const hasFrom = !!(from && /^\d{4}-\d{2}-\d{2}$/.test(from))
  const hasTo = !!(to && /^\d{4}-\d{2}-\d{2}$/.test(to))
  if (hasFrom && hasTo) {
    return { from: from!, to: to!, maxDate: bounds.maxDate, minDate: bounds.minDate, auto: false }
  }
  if (!bounds.maxDate) {
    // Fallback only when DB empty — still avoid stale hardcoded Jun 2026
    const today = new Date()
    const iso = today.toISOString().slice(0, 10)
    const def = defaultFuturesStyleRange(iso)
    return { ...def, maxDate: null, minDate: null, auto: true }
  }
  const def = defaultFuturesStyleRange(bounds.maxDate)
  return {
    from: hasFrom ? from! : def.from,
    to: hasTo ? to! : def.to,
    maxDate: bounds.maxDate,
    minDate: bounds.minDate,
    auto: !(hasFrom && hasTo),
  }
}

export async function buildFuturesStyleReturns(
  from: string,
  to: string,
  sector: FuturesStyleSector,
  opts?: { auto?: boolean; minDate?: string | null; maxDate?: string | null },
): Promise<FuturesStyleReturnsPayload> {
  const lookbackFrom = shiftDate(from, -320) // need ≥195 trading days warm-up for report CS/rules
  const [prices, contracts] = await Promise.all([
    loadAksharePrices(lookbackFrom, to),
    loadContractLegs(lookbackFrom, to),
  ])

  const { dates: allDates, panels } = buildPanels(prices, contracts, sector)
  const dailyFrac = computeDailyFactorReturns(allDates, panels)

  // Optional offline overlay (USE_WIND_GTJAQH=true only). Default path is REPORT_FIT above.
  const windTable = USE_WIND_GTJAQH ? loadGtjaqhCloses() : null
  if (windTable && windTable.maxDate) {
    for (const [key, code] of Object.entries(WIND_GTJAQH_FACTOR_MAP) as Array<[FuturesStyleFactorKey, string]>) {
      if (!windTable.closes[code]) continue
      const { daily, cumPct } = windSeriesOnDates(windTable, code, allDates)
      // Overlay daily onto full hist so slice/interval/cards all see Wind
      for (let i = 0; i < allDates.length; i++) {
        if (!dailyFrac[key]) dailyFrac[key] = Array(allDates.length).fill(null)
        dailyFrac[key][i] = daily[i]
      }
      void cumPct
    }
  }


  const rangeDates = allDates.filter((d) => d >= from && d <= to)
  const rangeIdx = rangeDates.map((d) => allDates.indexOf(d))

  const visibleMeta = (surface: "card" | "daily" | "cum" | "interval") =>
    FUTURES_STYLE_FACTOR_META.filter((m) => {
      if (!m.surfaces.includes(surface)) return false
      if (sector === "all" || sector === "commodity") return true
      return m.sector === "all" || m.sector === sector
    })

  // Deduplicate by display name within each surface (basis/carry share names carefully)
  const pickUnique = (metas: FactorMeta[], nameOf: (m: FactorMeta) => string) => {
    const seen = new Set<string>()
    const out: FactorMeta[] = []
    for (const m of metas) {
      const name = nameOf(m)
      if (seen.has(name)) continue
      seen.add(name)
      out.push(m)
    }
    return out
  }

  const cardMetas = pickUnique(visibleMeta("card"), (m) => m.cardName)
  const dailyMetas = pickUnique(visibleMeta("daily"), (m) => m.cardName)
  const cumMetas = pickUnique(visibleMeta("cum"), (m) => m.cumName)
  const intervalMetas = pickUnique(visibleMeta("interval"), (m) => m.intervalName)

  const sliceDailyPct = (key: FuturesStyleFactorKey): number[] =>
    rangeIdx.map((idx) => {
      const v = dailyFrac[key][idx]
      if (v == null || !Number.isFinite(v)) return 0
      return round2(v * 100)
    })

  const sliceDailyFrac = (key: FuturesStyleFactorKey): (number | null)[] =>
    rangeIdx.map((idx) => dailyFrac[key][idx])

  const lastIdx = rangeIdx.length ? rangeIdx[rangeIdx.length - 1] : -1

  const cards = cardMetas.map((m) => {
    const v = lastIdx >= 0 ? dailyFrac[m.key][lastIdx] : null
    return {
      key: m.key,
      name: m.cardName,
      value: v == null || !Number.isFinite(v) ? 0 : round2(v * 100),
      sector: m.sector,
    }
  })

  const daily = dailyMetas.map((m) => ({
    key: m.key,
    name: m.cardName,
    color: m.color,
    data: sliceDailyPct(m.key).map((v) => Math.max(-3.8, Math.min(3.8, v))),
  }))

  const cumulative = cumMetas.map((m) => {
    // Wind GTJAQH: index return from first close in displayed range (P_t/P_0 - 1)*100
    if (windTable && WIND_GTJAQH_FACTOR_MAP[m.key]) {
      const code = WIND_GTJAQH_FACTOR_MAP[m.key]!
      const { cumPct } = windSeriesOnDates(windTable, code, rangeDates)
      return { key: m.key, name: m.cumName, color: m.color, data: cumPct }
    }
    // Legacy REPORT_FIT reconstructions: compound unrounded daily fracs
    if (m.key.startsWith("report_")) {
      const fracs = sliceDailyFrac(m.key)
      let cum = 1
      const data: number[] = []
      for (const v of fracs) {
        if (v != null && Number.isFinite(v)) cum *= 1 + v
        data.push(round2((cum - 1) * 100))
      }
      return { key: m.key, name: m.cumName, color: m.color, data }
    }
    return {
      key: m.key,
      name: m.cumName,
      color: m.color,
      data: cumulativeFromDaily(sliceDailyPct(m.key)),
    }
  })

  const endDate = rangeDates[rangeDates.length - 1] ?? to
  const endAllIdx = findDateIdx(allDates, endDate)

  const windows: Array<{ label: string; startDate: string }> = [
    { label: "近一周", startDate: shiftDate(endDate, -7) },
    { label: "近一月", startDate: shiftDate(endDate, -31) },
    { label: "近三月", startDate: shiftDate(endDate, -93) },
    { label: "近六月", startDate: shiftDate(endDate, -186) },
    { label: "近一年", startDate: shiftDate(endDate, -372) },
    { label: "今年以来", startDate: `${endDate.slice(0, 4)}-01-01` },
  ]

  const interval = intervalMetas.map((m) => {
    const series = dailyFrac[m.key]
    const returns = windows.map((w) => {
      const startIdx = findDateIdx(allDates, w.startDate)
      if (endAllIdx < 0 || startIdx < 0) return 0
      // start at day after startIdx so window is ~inclusive of returns realized after startDate
      const fromIdx = Math.min(endAllIdx, startIdx + 1)
      return compoundReturnPct(series, fromIdx, endAllIdx)
    })
    return {
      key: m.key,
      name: m.intervalName,
      sector: m.sector,
      returns,
    }
  })

  return {
    ok: true,
    from,
    to,
    sector,
    auto: opts?.auto ?? false,
    minDate: opts?.minDate ?? null,
    maxDate: opts?.maxDate ?? null,
    dates: rangeDates,
    source: {
      prices: "raw_akshare_futures_daily (AkShare main continuous)",
      oiCarry: "raw_futures_contracts_daily (EMQuant OI-ranked near/far)",
      note:
        USE_WIND_GTJAQH && windTable?.maxDate
          ? `DEBUG overlay: Wind GTJAQH*.WI from data/gtjaqh_closes.csv thru ${windTable.maxDate} (not production).`
          : "CTA-report factors: REPORT_FIT price/OI reconstructions (AkShare+EMQuant). Wind CSV is calibration-only, not live chart source. 库存/利润 need local proxies or stay empty.",
    },
    cards,
    daily,
    cumulative,
    interval,
  }
}


/** Offline calibration: load panels once, recompute daily factors under REPORT_FIT overrides. */
let _calibCache: {
  key: string
  dates: string[]
  panels: DayPanel[]
} | null = null

export async function calibLoadPanels(from: string, to: string, sector: FuturesStyleSector = "all") {
  const lookbackFrom = shiftDate(from, -420)
  const key = `${lookbackFrom}|${to}|${sector}`
  if (_calibCache?.key === key) return _calibCache
  const [prices, contracts] = await Promise.all([
    loadAksharePrices(lookbackFrom, to),
    loadContractLegs(lookbackFrom, to),
  ])
  const { dates, panels } = buildPanels(prices, contracts, sector)
  _calibCache = { key, dates, panels }
  return _calibCache
}

export function calibComputeDaily(
  dates: string[],
  panels: DayPanel[],
  fitPartial?: Record<string, unknown> | null,
) {
  const base = JSON.parse(JSON.stringify(REPORT_FIT))
  if (fitPartial) setReportFitOverride(fitPartial)
  try {
    return computeDailyFactorReturns(dates, panels)
  } finally {
    REPORT_FIT = base
  }
}
