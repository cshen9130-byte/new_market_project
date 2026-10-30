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
  | "report_basis_spot"
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
  // CTA周报因子 — REPORT_FIT reconstructions; order matches 国君 6-factor layout then 期限基差/动量
  { key: "report_basis_spot", cardName: "基差", cumName: "基差", intervalName: "基差", sector: "all", color: "#D93025", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_cs_long", cardName: "长期截面", cumName: "长期截面", intervalName: "长期截面", sector: "all", color: "#1A73E8", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_inventory", cardName: "库存", cumName: "库存", intervalName: "库存", sector: "all", color: "#16a34a", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_pv_corr", cardName: "量价相关性", cumName: "量价相关性", intervalName: "量价相关性", sector: "all", color: "#eab308", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_long_rule", cardName: "长期规则", cumName: "长期规则", intervalName: "长期规则", sector: "all", color: "#9333ea", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_profit", cardName: "利润", cumName: "利润", intervalName: "利润", sector: "all", color: "#0d9488", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_basis", cardName: "期限基差", cumName: "期限基差", intervalName: "期限基差", sector: "all", color: "#7c3aed", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_basis_mom", cardName: "基差动量", cumName: "基差动量", intervalName: "基差动量", sector: "all", color: "#4f46e5", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_mid_mom", cardName: "中期动量", cumName: "中期动量", intervalName: "中期动量", sector: "all", color: "#ea580c", surfaces: ["card", "daily", "cum", "interval"] },
  { key: "report_long_mom", cardName: "长期动量", cumName: "长期动量", intervalName: "长期动量", sector: "all", color: "#0d9488", surfaces: [] /* Wind-calib only; no live recon yet */ },
  { key: "report_vol", cardName: "波动", cumName: "波动", intervalName: "波动", sector: "all", color: "#57534e", surfaces: [] /* Wind-calib only; no live recon yet */ },
  { key: "report_reversal", cardName: "反转", cumName: "反转", intervalName: "反转", sector: "all", color: "#c026d3", surfaces: [] /* Wind-calib only; no live recon yet */ },
  { key: "report_skew_wind", cardName: "偏度(报告)", cumName: "偏度(报告)", intervalName: "偏度(报告)", sector: "all", color: "#db2777", surfaces: [] /* Wind-calib only; no live recon yet */ },
  { key: "report_term_basis", cardName: "期限基差(别名)", cumName: "期限基差(别名)", intervalName: "期限基差(别名)", sector: "all", color: "#7c3aed", surfaces: [] /* Excel GTJAQH004 alias; live UI uses report_basis */ },
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

/** Approx calendar days from isoDate to near-contract month mid (day 15). Clamp [5, 370]. */
function daysToNearExpiry(isoDate: string, contract: string): number {
  const key = monthKey(contract)
  let yy: number
  let mm: number
  if (key.length >= 4) {
    yy = 2000 + parseInt(key.slice(0, 2), 10)
    mm = parseInt(key.slice(2, 4), 10)
  } else if (key.length === 3) {
    yy = 2000 + parseInt(key.slice(0, 1), 10)
    mm = parseInt(key.slice(1, 3), 10)
  } else {
    return 30
  }
  if (!(mm >= 1 && mm <= 12) || !Number.isFinite(yy)) return 30
  const exp = Date.UTC(yy, mm - 1, 15)
  const now = Date.parse(isoDate + "T12:00:00Z")
  if (!Number.isFinite(now) || !Number.isFinite(exp)) return 30
  const d = Math.round((exp - now) / 86400000)
  return Math.max(5, Math.min(370, d))
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
): { slope: number; r2: number; z: number; tStat: number } | null {
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
  // t-stat of slope (WP「强度」candidate alongside R²)
  const seSlope = den > 1e-18 ? sig / Math.sqrt(den) : 0
  const tStat = seSlope > 1e-12 ? slope / seSlope : 0
  return { slope, r2, z, tStat }
}

/** Map OLS regression to CS score. WP 长期截面: 因子值 = 回归系数 × 强度 (R² or |t|). */
function olsCsScore(
  reg: { slope: number; r2: number; z: number; tStat?: number },
  kind: string,
): number | null {
  const tAbs = Math.abs(Number(reg.tStat ?? 0))
  switch (kind) {
    case "slope":
    case "ols_slope":
      return reg.slope
    case "neg_slope":
    case "ols_neg_slope":
      return -reg.slope
    case "z":
    case "ols_z":
      return reg.z
    case "neg_z":
    case "ols_neg_z":
      return -reg.z
    case "slope_r2":
    case "ols_slope_r2":
      return reg.slope * reg.r2
    case "neg_slope_r2":
    case "ols_neg_slope_r2":
      return -reg.slope * reg.r2
    case "slope_t":
    case "ols_slope_t":
      return reg.slope * tAbs
    case "neg_slope_t":
    case "ols_neg_slope_t":
      return -reg.slope * tAbs
    default:
      return null
  }
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
  /** OI-ranked near contract code (e.g. RB2510.SHF); used for ann basis TTM. */
  nearContract?: Record<string, string>
  dOi: Record<string, number>
  /** Choice FTREGORDERVOL registered warehouse receipts (product-level). */
  warehouse?: Record<string, number>
  /** Choice EDB EMI processing / industry margins (sparse; forward-filled). */
  profit?: Record<string, number>
  /** Choice EDB social/exchange inventory (best priority per product; ffill). */
  socialInv?: Record<string, number>
  /** Choice EDB physical commodity spot (best priority per product; ffill). */
  commoditySpot?: Record<string, number>
}


type WhRow = { date: string; product: string; vol: number }
type ProfitRow = { date: string; product: string; value: number }

async function loadWarehouseReceipts(from: string, to: string): Promise<WhRow[]> {
  try {
    const rows = await query<{
      trade_date: Date | string
      product: string
      ftregordervol: string | number | null
    }>(
      `SELECT trade_date, product, ftregordervol
       FROM raw_futures_warehouse_receipts_daily
       WHERE trade_date >= $1 AND trade_date <= $2
         AND ftregordervol IS NOT NULL
       ORDER BY trade_date ASC`,
      [from, to],
    )
    const out: WhRow[] = []
    for (const row of rows) {
      const product = String(row.product || "").toUpperCase()
      if (!product || !sectorOfProduct(product)) continue
      const vol = n(row.ftregordervol)
      if (vol == null || !Number.isFinite(vol)) continue
      out.push({ date: fmtIso(row.trade_date), product, vol })
    }
    return out
  } catch {
    // Table may be missing on older DBs — inventory falls back to -ΔOI.
    return []
  }
}

async function loadEdbIndustryProfit(from: string, to: string): Promise<ProfitRow[]> {
  try {
    // Prefer one series per (date, product): daily > weekly; curated primary EMI over siblings
    // (soy agri/汇易, CU 精炼铜毛利 else TC, AL 电解铝 primary). Avoid TC/RC + margin overwrite.
    const rows = await query<{
      trade_date: Date | string
      product: string | null
      value: string | number | null
    }>(
      `SELECT DISTINCT ON (trade_date, product) trade_date, product, value
       FROM raw_edb_industry_profit_daily
       WHERE trade_date >= $1 AND trade_date <= $2
         AND value IS NOT NULL
         AND product IS NOT NULL
       ORDER BY trade_date ASC, product ASC,
         CASE WHEN COALESCE(freq_hint,'') = 'daily' THEN 0 ELSE 1 END ASC,
         CASE UPPER(emi_code)
           WHEN 'EMI01732831' THEN 0
           WHEN 'EMI01793711' THEN 0
           WHEN 'EMI02082699' THEN 0
           WHEN 'EMM01855422' THEN 1
           WHEN 'EMI01961310' THEN 0
           WHEN 'EMI02082712' THEN 1
           WHEN 'EMI02082696' THEN 0
           ELSE 5
         END ASC,
         emi_code ASC`,
      [from, to],
    )
    const out: ProfitRow[] = []
    for (const row of rows) {
      const product = String(row.product || "").toUpperCase()
      if (!product || !sectorOfProduct(product)) continue
      const value = n(row.value)
      if (value == null || !Number.isFinite(value)) continue
      out.push({ date: fmtIso(row.trade_date), product, value })
    }
    return out
  } catch {
    return []
  }
}


type SocialInvRow = { date: string; product: string; value: number; priority: number }

async function loadEdbCommodityInventory(from: string, to: string): Promise<SocialInvRow[]> {
  try {
    const rows = await query<{
      trade_date: Date | string
      product: string | null
      value: string | number | null
      priority: string | number | null
      region_hint: string | null
    }>(
      `SELECT trade_date, product, value, priority, region_hint
       FROM raw_edb_commodity_inventory_daily
       WHERE trade_date >= $1 AND trade_date <= $2
         AND value IS NOT NULL
         AND product IS NOT NULL
         AND COALESCE(region_hint, 'cn') <> 'lme'
       ORDER BY trade_date ASC, priority ASC`,
      [from, to],
    )
    const out: SocialInvRow[] = []
    for (const row of rows) {
      const product = String(row.product || "").toUpperCase()
      if (!product || !sectorOfProduct(product)) continue
      const value = n(row.value)
      if (value == null || !Number.isFinite(value)) continue
      out.push({
        date: fmtIso(row.trade_date),
        product,
        value,
        priority: Number(row.priority ?? 50),
      })
    }
    return out
  } catch {
    return []
  }
}


type SpotRow = { date: string; product: string; value: number; priority: number }

/** Catalog unit/FX hygiene: store raw EMI in DB; apply unitScale (+ optional fxCode) live. */
type SpotUnitMeta = { unitScale: number; fxCode?: string; role?: string }
let _spotUnitMeta: Map<string, SpotUnitMeta> | null = null
function loadSpotUnitMeta(): Map<string, SpotUnitMeta> {
  if (_spotUnitMeta) return _spotUnitMeta
  const map = new Map<string, SpotUnitMeta>()
  try {
    const file = path.join(process.cwd(), "data", "edb_commodity_spot_catalog.json")
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf-8")) as {
        series?: Array<{ emi_code?: string; unitScale?: number; fxCode?: string; role?: string }>
      }
      for (const s of raw.series ?? []) {
        const emi = String(s.emi_code || "").toUpperCase()
        if (!emi) continue
        const unitScale = Number(s.unitScale ?? 1)
        map.set(emi, {
          unitScale: Number.isFinite(unitScale) && unitScale > 0 ? unitScale : 1,
          fxCode: s.fxCode ? String(s.fxCode).toUpperCase() : undefined,
          role: s.role ? String(s.role) : undefined,
        })
      }
    }
  } catch {
    // catalog optional; default scale 1
  }
  _spotUnitMeta = map
  return map
}

async function loadEdbCommoditySpot(from: string, to: string): Promise<SpotRow[]> {
  try {
    const rows = await query<{
      trade_date: Date | string
      product: string | null
      emi_code: string | null
      value: string | number | null
      priority: string | number | null
    }>(
      `SELECT trade_date, product, emi_code, value, priority
       FROM raw_edb_commodity_spot_daily
       WHERE trade_date >= $1 AND trade_date <= $2
         AND value IS NOT NULL
         AND product IS NOT NULL
       ORDER BY trade_date ASC, priority ASC`,
      [from, to],
    )
    const meta = loadSpotUnitMeta()
    // Daily USDCNY (and any role=fx) for USD→CNY live mul. Forward-fill below.
    const fxRaw = new Map<string, number>()
    for (const row of rows) {
      const product = String(row.product || "").toUpperCase()
      const emi = String(row.emi_code || "").toUpperCase()
      const m = meta.get(emi)
      if (product === "USDCNY" || m?.role === "fx") {
        const v = n(row.value)
        if (v != null && Number.isFinite(v) && v > 0) fxRaw.set(fmtIso(row.trade_date), v)
      }
    }
    const fxDates = [...fxRaw.keys()].sort()
    let lastFx: number | null = null
    const fxFF = new Map<string, number>()
    for (const d of fxDates) {
      lastFx = fxRaw.get(d) ?? lastFx
      if (lastFx != null) fxFF.set(d, lastFx)
    }
    const fxOnOrBefore = (d: string): number | null => {
      if (fxFF.has(d)) return fxFF.get(d)!
      let best: number | null = null
      for (const fd of fxDates) {
        if (fd > d) break
        best = fxFF.get(fd) ?? best
      }
      return best
    }

    const out: SpotRow[] = []
    for (const row of rows) {
      const product = String(row.product || "").toUpperCase()
      if (product === "USDCNY") continue
      if (!product || !sectorOfProduct(product)) continue
      let value = n(row.value)
      if (value == null || !Number.isFinite(value) || value <= 0) continue
      const emi = String(row.emi_code || "").toUpperCase()
      const m = meta.get(emi)
      const scale = m?.unitScale ?? 1
      value *= scale
      if (m?.fxCode) {
        const fx = fxOnOrBefore(fmtIso(row.trade_date))
        if (fx == null || !(fx > 0)) continue
        value *= fx
      }
      out.push({
        date: fmtIso(row.trade_date),
        product,
        value,
        priority: Number(row.priority ?? 50),
      })
    }
    return out
  } catch {
    // Table may be missing until ETL migration runs.
    return []
  }
}

/** Attach warehouse + forward-filled EDB profit onto existing day panels. */
function attachFundamentals(
  dates: string[],
  panels: DayPanel[],
  warehouse: WhRow[],
  profit: ProfitRow[],
  socialInv: SocialInvRow[] = [],
  commoditySpot: SpotRow[] = [],
): void {
  const whByDate = new Map<string, Record<string, number>>()
  for (const row of warehouse) {
    const m = whByDate.get(row.date) ?? {}
    m[row.product] = row.vol
    whByDate.set(row.date, m)
  }
  const profitByDate = new Map<string, Record<string, number>>()
  for (const row of profit) {
    const m = profitByDate.get(row.date) ?? {}
    m[row.product] = row.value
    profitByDate.set(row.date, m)
  }
  // Best (lowest) priority series per product per date
  const socialByDate = new Map<string, Record<string, { value: number; priority: number }>>()
  for (const row of socialInv) {
    const m = socialByDate.get(row.date) ?? {}
    const prev = m[row.product]
    if (!prev || row.priority < prev.priority) m[row.product] = { value: row.value, priority: row.priority }
    socialByDate.set(row.date, m)
  }
  const spotByDate = new Map<string, Record<string, { value: number; priority: number }>>()
  for (const row of commoditySpot) {
    const m = spotByDate.get(row.date) ?? {}
    const prev = m[row.product]
    if (!prev || row.priority < prev.priority) m[row.product] = { value: row.value, priority: row.priority }
    spotByDate.set(row.date, m)
  }
  let lastProfit: Record<string, number> = {}
  let lastSocial: Record<string, number> = {}
  let lastSpot: Record<string, number> = {}
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i]
    const panel = panels[i]
    panel.warehouse = whByDate.get(d) ?? {}
    const dayP = profitByDate.get(d)
    if (dayP) lastProfit = { ...lastProfit, ...dayP }
    panel.profit = { ...lastProfit }
    const dayS = socialByDate.get(d)
    if (dayS) {
      const next = { ...lastSocial }
      for (const [prod, v] of Object.entries(dayS)) next[prod] = v.value
      lastSocial = next
    }
    panel.socialInv = { ...lastSocial }
    const daySpot = spotByDate.get(d)
    if (daySpot) {
      const next = { ...lastSpot }
      for (const [prod, v] of Object.entries(daySpot)) next[prod] = v.value
      lastSpot = next
    }
    panel.commoditySpot = { ...lastSpot }
  }
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
    const nearContract: Record<string, string> = {}
    const dOi: Record<string, number> = {}
    for (const [product, list] of byProd) {
      list.sort((a, b) => b.oi - a.oi)
      const near = list[0]
      oi[product] = near.oi
      amount[product] = near.amount
      nearClose[product] = near.close
      nearContract[product] = near.contract
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
      nearContract,
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
  topN?: number | null,
): number | null {
  const usable = scores.filter((s) => Number.isFinite(s.score) && nextRet[s.product] != null)
  if (usable.length < 6) return null
  usable.sort((a, b) => a.score - b.score)
  const nTake =
    topN != null && topN > 0
      ? Math.max(1, Math.min(Math.floor(topN), Math.floor(usable.length / 2)))
      : Math.max(1, Math.floor(usable.length * topFrac))
  const low = usable.slice(0, nTake)
  const high = usable.slice(-nTake)
  const longSide = longHigh ? high : low
  const shortSide = longHigh ? low : high
  // Equal notional long vs short ⇒ mean(long) − mean(short); net exposure ≈ 0
  return mean(longSide.map((x) => nextRet[x.product])) - mean(shortSide.map((x) => nextRet[x.product]))
}

/** ISO date YYYY-MM-DD → UTC weekday (0=Sun … 6=Sat). Used for weeklyWed/Fri rebal. */
function isoDow(iso: string): number {
  return new Date(iso + "T12:00:00Z").getUTCDay()
}

/**
 * CS L/S with optional hysteresis buffer (enterFrac / exitFrac). Equal-weight legs.
 * Returns baskets so weekly rebalance can hold weights between rebal days.
 */
function crossSectionLsBuffered(
  scores: Array<{ product: string; score: number }>,
  nextRet: Record<string, number>,
  opts: {
    longHigh: boolean
    topFrac?: number
    topN?: number | null
    buffer?: { enterFrac: number; exitFrac: number } | null
    prevLong?: Set<string>
    prevShort?: Set<string>
  },
): { r: number | null; long: Set<string>; short: Set<string> } {
  const usable = scores.filter((s) => Number.isFinite(s.score) && nextRet[s.product] != null)
  if (usable.length < 6) return { r: null, long: new Set(), short: new Set() }
  usable.sort((a, b) => a.score - b.score)
  const n = usable.length

  let longSet = new Set<string>()
  let shortSet = new Set<string>()

  const nTake =
    opts.topN != null && opts.topN > 0
      ? Math.max(1, Math.min(Math.floor(opts.topN), Math.floor(n / 2)))
      : Math.max(1, Math.floor(n * (opts.topFrac ?? 0.2)))

  if (opts.buffer && opts.prevLong && opts.prevShort) {
    const enterN = Math.max(1, Math.floor(n * opts.buffer.enterFrac))
    const exitN = Math.max(enterN, Math.floor(n * opts.buffer.exitFrac))
    const enterHigh = new Set(usable.slice(-enterN).map((x) => x.product))
    const enterLow = new Set(usable.slice(0, enterN).map((x) => x.product))
    const keepHigh = new Set(usable.slice(-exitN).map((x) => x.product))
    const keepLow = new Set(usable.slice(0, exitN).map((x) => x.product))
    const prevL = opts.longHigh ? opts.prevLong : opts.prevShort
    const prevS = opts.longHigh ? opts.prevShort : opts.prevLong
    const nextHigh = new Set<string>()
    const nextLow = new Set<string>()
    for (const p of enterHigh) nextHigh.add(p)
    for (const p of prevL) if (keepHigh.has(p)) nextHigh.add(p)
    for (const p of enterLow) nextLow.add(p)
    for (const p of prevS) if (keepLow.has(p)) nextLow.add(p)
    if (!nextHigh.size) for (const p of enterHigh) nextHigh.add(p)
    if (!nextLow.size) for (const p of enterLow) nextLow.add(p)
    longSet = opts.longHigh ? nextHigh : nextLow
    shortSet = opts.longHigh ? nextLow : nextHigh
  } else {
    const low = usable.slice(0, nTake)
    const high = usable.slice(-nTake)
    longSet = new Set((opts.longHigh ? high : low).map((x) => x.product))
    shortSet = new Set((opts.longHigh ? low : high).map((x) => x.product))
  }

  const longArr = [...longSet].filter((p) => nextRet[p] != null)
  const shortArr = [...shortSet].filter((p) => nextRet[p] != null)
  if (longArr.length < 1 || shortArr.length < 1) return { r: null, long: longSet, short: shortSet }

  // Equal notional long vs short
  let r = 0
  for (const p of longArr) r += nextRet[p] / longArr.length
  for (const p of shortArr) r -= nextRet[p] / shortArr.length
  return { r, long: longSet, short: shortSet }
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
  report_term_basis: "GTJAQH004.WI", // 期限基差 (Excel alias; live=report_basis)
  report_warehouse: "GTJAQH005.WI", // 仓单
  report_skew_wind: "GTJAQH006.WI", // 偏度
  report_inventory: "GTJAQH007.WI", // 库存
  report_mid_mom: "GTJAQH008.WI", // 中期动量
  report_profit: "GTJAQH009.WI", // 利润
  report_long_rule: "GTJAQH010.WI", // 长期规则动量
  report_pv_corr: "GTJAQH011.WI", // 量价相关性
  report_basis: "GTJAQH004.WI", // 期限基差 near/far ln
  report_basis_spot: "GTJAQH012.WI", // 基差 spot-futures
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
  // 2026-10-28 trough pass: exclude EC (extreme near/far outlier; distorted Jun30 P&L),
  // topN=8 (was 10). vs GTJAQH012: 3m corr_ret 0.725 vs 0.661, 1y 0.221 vs 0.215,
  // YTD NAV~1.072 vs Wind~1.061; Jul trough date moves to ~Jul3 (Wind Jul2).
  // Apr'26: Wind/PDF digitized basis has NO distinct Apr DD (late-Mar trough near 4/1 tick).
  // Jul'26 Wind maxDD~-2.3%; CS-neutral continuous L/S at amp-matching scale cannot fully
  // reproduce depth (crash week both legs fall) — timing/corr improved, depth still shallow.
  // PRIOR: basisTopN 10, no exclude, basisScale 0.1
  // 期限基差 (report_basis): ln(near/far) CS L/S → GTJAQH004.WI. topN=8 excl EC scale 0.1.
  // 基差 (report_basis_spot): physical spot vs near → GTJAQH012.WI.
  basisTopFrac: 0.2,
  basisTopN: 8 as number | null,
  basisScale: 0.1,
  basisExclude: ["EC"] as string[],
  // 2026-10-28 HARDER: EMI 22→33 (I/J/L/PP/BU/RU/FG/AO/SS/SH/LH) via mx+EmQuant.
  // Same skeleton pct_fut|buf|eq|Wed|LH; exit 0.30→0.35 (YTD/1y soft lift), scale 0.05→0.27
  // for Jul'26 maxDD≈−2.3% timing 7/2. vs GTJAQH012 after expand: 3m cr 0.771 / lvl 0.837,
  // YTD cr 0.475, 1y cr 0.418 (was 0.313/0.277/0.217 on 22 names). Blend term did not win.
  // PRIOR: exit0.30 scale0.05 on 22 EMI — 3m cr 0.313.
  // 2026-10-28 JOINT grid: dollar-neutral LS cancelled YTD drift (end~0% vs Wind~+5%).
  // Long-only top-basis + Fri rebal + spotLag=1 + scale0.45 restores path:
  // 3m cr0.815/lvl0.955 end~+5.9%; YTD cr0.490/lvl0.682 end~+6.1% (Wind~+6.2%);
  // 1y cr0.479/lvl0.777 end~+6.3% (Wind~+7.2%). Keep labels: spot->012, term->004.
  // PRIOR HARDER: LS Wed exit0.35 scale0.27 on 33 EMI — 3m cr0.771 but YTD end~0%/lvl-0.29.
  // 2026-10-28 H1 pass: exclude SH (staleFrac~0.68 + extremeSF~97% days, median S/F~1.44
  // unit/staleness rule — not day-matched to Wind). Ease scale 0.45->0.30, buf 20/40, topN=5,
  // spotLag 0. Official vs GTJAQH012 (calib only): 3m cr0.833/lvl0.953 end~+3.1% (was 0.809/0.929/+4.3%);
  // YTD cr0.518/lvl0.775 end~+4.6% DD-3.3% (was 0.483/0.638/+5.0% DD-5.3%); H1 cr0.177 (was 0.122).
  // PRIOR JOINT: LO Fri scale0.45 excl EC lag1 buf15/35 topFrac0.15.
  basisSpotKind: "ann_pct_over_fut" as "pct_over_fut" | "pct_over_spot" | "ln_spot_over_fut" | "ann_pct_over_fut",
  basisSpotTopFrac: 0.15,
  // With buffer on, enter/exit fracs size the basket; topN is unused by crossSectionLsBuffered (kept as doc intent).
    basisSpotTopN: 5 as number | null,
    // 2026-10-29 May->Jul path amp: enter 0.15->0.18 / exit 0.35->0.38 + scale 0.22->0.16 + gate 75x0.5.
  // 2026-10-29 H1 dir pass: long_only cannot match 012 Jan-Apr (ours up, 012 down/flat; JA cr~0.03).
  // Promote mode=ls + csWeight=invvol + scale 0.16->0.22 (keep e18/38 g75x0.5). vs LO LIVE:
  // JA cr 0.027->0.284; J/F/M/A 0.36/1.05/1.67/1.63 -> -0.41/1.09/-0.04/0.80; H1 cr 0.339->0.476;
  // 3m 0.884->0.858; YTD 0.647->0.680 end +4.03->+3.54; summer 2.43->0.01 to 2.25->0.23.
  // See docs/cta_basis_spot_h1_dir_20261029.md.
  // 2026-10-29 peer research: no public GTJAQH012 formula. 华泰 require_expand / 中泰 Δ failed on LS+invvol.
  // Residual pass: enter 0.18→0.19 / exit 0.38→0.39 + nameClip 0.18 + scale 0.22→0.24.
  // vs LIVE ls+invvol: JA 0.284→0.326; JFM -0.41/1.09/-0.04/0.80 → -0.62/0.90/0.02/1.07;
  // H1 0.476→0.499; 3m 0.858→0.852; YTD 0.680→0.698 end +3.54→+5.34 (012~+5.6);
  // summer 2.25→0.23 to 3.05→0.86 (012 3.34→0.93). See docs/cta_basis_spot_peer_20261029.md.
  basisSpotScale: 0.24,
  basisSpotExclude: ["EC", "SH"] as string[],
  basisSpotLive: true,
  basisSpotRebal: "weeklyFri" as "daily" | "weeklyWed" | "weeklyFri",
  basisSpotEnterFrac: 0.19,
  basisSpotExitFrac: 0.39,
  basisSpotLongHigh: true,
  basisSpotMode: "ls" as "ls" | "long_only" | "long_bias",
  basisSpotShortScale: 0,
  basisSpotSpotLag: 0,
  // CS basket weights within long (and short) legs. equal = prior live.
  // invvol: high-vol names (e.g. EC) get small weight — 国君 vol-adjusted hypothesis.
  // vol: high-vol gets larger weight. Vol lookback = basisSpotVolL (rets).
  // basisSpotRuleHygiene: per-rebal drop stale spot or extreme |S/F-1|>0.25 (rule-based, not Wind day-match).
  // zscore|abs_score: within-basket magnitude weights (not full-book vol CS). Default equal.
  basisSpotCsWeight: "invvol" as "equal" | "invvol" | "vol" | "zscore" | "abs_score",
  basisSpotVolL: 20,
  // 2026-10-28 research: 华泰 ann_pct=(S/F-1)*365/T Pareto vs level on 3m+YTD+H1 (0.881/0.626/0.312); scale 0.30→0.25 end match. See docs/cta_basis_factor_research_20261028.md + tmp_basis_spot_research_grid.md
  basisSpotRuleHygiene: true,
  // 2026-10-28 amp pass: mktVolGate 80pct×0.7 + scale 0.25→0.22. Jul DD -4.25→-3.39 (012 -2.33); roll20 σ-ratio 1.58→1.34; 3m cr flat 0.880, YTD 0.626→0.638, H1 0.312→0.324. See tmp_basis_spot_amp_*.
  // Amplitude levers (default off / null = LIVE unchanged). See tmp_basis_spot_amp_*.
  // minOiQuantile: drop names below OI quantile of spot-eligible set before CS rank.
  basisSpotMinOiQuantile: null as number | null,
  // volTarget: scale gross so trailing portfolio daily vol ≈ target (e.g. 0.0025≈012).
  basisSpotVolTarget: null as number | null,
  basisSpotVolTargetL: 20,
  basisSpotVolTargetClip: [0.35, 1.5] as [number, number],
  // mktVolGate: when CS median |ret| > historical percentile, multiply gross.
  basisSpotMktVolGatePct: 0.75 as number | null,
  basisSpotMktVolGateScale: 0.5,
  basisSpotMktVolGateL: 60,
  // sectorNeutral: demean scores within sector before rank; sectorCap: max sector weight.
  basisSpotSectorNeutral: false,
  basisSpotSectorCap: null as number | null,
  // nameClip: max |w| per name after equal/invvol (softens concentration).
  basisSpotNameClip: 0.18 as number | null,
  // dynScaleDispersion: scale *= clip(medDisp/curDisp, lo, hi) using score |ann| of held.
  basisSpotDynScaleDisp: false,
  basisSpotDynScaleClip: [0.5, 1.25] as [number, number],
    // 2026-10-27 cs_long push: 3-leg blend beats simple L120 (3m 0.333/0.776, 1y 0.679/0.944 vs 0.211/0.639, 0.637/0.930)
  // 2026-10-29 research: brochure CTA3 = GTJAQH022 价格对时间回归; Excel calib = GTJAQH013 截面动量 (022 absent
  // from 001–013 dump — same naming mismatch pattern as 基差 021 vs 012). No public Guojun closed-form.
  // Peers: 华泰 panel mom R=120/250; 东证 CS L/S top/bot 50% multi-window; MatrixCQY 252d tercile.
  // Empirically: raise z/neg_z weights (0.2/0.35/0.45) + scale 0.95 vs LIVE 0.5/0.25/0.25×1:
  // 3m cr 0.333→0.461 lvl 0.776→0.858; YTD cr 0.705→0.723 end 19.4→12.4 (013~+12.5); H1 0.779→0.788.
  // Residual: Jan–Feb misses 013 early DD (ours flat/+). See docs/cta_cs_long_research_20261029.md.
  // PRIOR: weights 0.5/0.25/0.25 scale 1.
  csLongL: 120,
  csLongR2: 0.15,
  csLongTopFrac: 0.15,
  csLongNegZ: false,
  csLongDemean: true,
  csLongSectorNeutral: true,
  csLongScale: -1.0,
  csLongBlend: {
    enabled: true,
    scale: 0.95,
    legs: [
      { kind: "neg_slope" as const, L: 120, topFrac: 0.15, sectorNeutral: true, powerDaily: 1, weight: 0.2 },
      { kind: "z" as const, L: 120, topFrac: 0.2, sectorNeutral: false, powerDaily: 1, weight: 0.35 },
      { kind: "neg_z" as const, L: 250, topFrac: 0.2, sectorNeutral: true, powerDaily: 1, weight: 0.45 },
    ],
  },
  // 2026-10-29 csLong V2: peer/other-AI score formulas + LO/LS + weekly/buffer (calib vs GTJAQH013).
  // When csLongV2=true, replaces blend/simple OLS path below.
  csLongV2: false,
  csLongScoreKind: "ret" as "ret" | "risk_adj" | "avg_mom" | "ols_slope" | "ols_neg_slope" | "ols_z" | "ols_neg_z" | "ols_slope_r2" | "ols_neg_slope_r2" | "ols_slope_t" | "ols_neg_slope_t",
  csLongK: 120,
  csLongAvgMomN: 6,
  csLongSkip: 0,
  csLongMode: "ls" as "ls" | "long_only",
  csLongLongHigh: true,
  csLongRebal: "daily" as "daily" | "weeklyFri" | "monthly",
  csLongEnterFrac: 0.2,
  csLongExitFrac: 0.4,
  csLongUseBuffer: false,
  csLongTopN: 8 as number | null,
  csLongSmooth: 0,
  csLongV2Scale: 1.0,
  csLongV2Exclude: [] as string[],
  csLongV2Demean: true,
  csLongV2SectorNeutral: false,
  // Hybrid: (1-w)*legacy blend + w*V2 series.
  // 2026-10-29 3m-shape promote: w=0.38 scaleH=0.6 ols_neg_slope K60 long_only weeklyFri topN10.
  // Priority: visual Jul-Oct path vs 国君/GTJAQH013 (not corr alone).
  // BEFORE (hy K120 ls w0.3 s0.85): 3m julMin -4.68 end +2.62 lateSep -0.59 cr 0.43; YTD end 12.56 cr 0.76.
  // AFTER: 3m julMin -1.17 end +5.63 lateSep -0.14 cr 0.38; YTD end 12.98 cr 0.69. Wind 3m jul -0.64 end +4.49.
  // Honest: Wind CSV max 2026-10-02 (last real 9/30); 国君 chart to 10/08 not in calib; late-Sep hockey-stick only partially matched.
  // See docs/cta_cs_long_loop_20261029.md.
  csLongHybridW: 0.38,
  csLongHybridKind: 'ols_neg_slope' as 'ret' | 'risk_adj' | 'avg_mom' | 'ols_slope' | 'ols_neg_slope' | 'ols_z' | 'ols_neg_z' | 'ols_slope_r2' | 'ols_neg_slope_r2' | 'ols_slope_t' | 'ols_neg_slope_t',
  csLongHybridK: 60,
  csLongHybridMode: 'long_only' as 'ls' | 'long_only',
  csLongHybridRebal: 'weeklyFri' as 'daily' | 'weeklyFri' | 'monthly',
  csLongHybridTopN: 10 as number | null,
  csLongHybridUseBuffer: false,
  csLongHybridEnterFrac: 0.2,
  csLongHybridExitFrac: 0.4,
  csLongHybridSmooth: 0,
  csLongHybridScale: 0.6,
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
  // 长期规则: brochure WP p13 = short/long MA cross TS (GTJAQH019 slogan); Excel calib GTJAQH010
  // 2026-10-30 promote: momLowVol L=200 cap=1.0 inv-vol no-flip scale=0.5 vs LIVE L150/flip/-0.7
  // Fair verify vs 010: 3m cr 0.736→0.819 lvl 0.841→0.972 end 3.2→2.81 (W2.76); YTD cr 0.447→0.549 lvl 0.548→0.699
  // Mar-Apr hybrid grid (649): deepened Mar23 -1.36~-2.0 (W~-3.8) but YTD end -0.25~-0.8 — NO promote
  // Brochure maCross 60/240 helped H1 cr but wrecked 3m/YTD ends — kept as longRuleKind alt, not LIVE
  longRuleKind: "momLowVol" as const, // "momLowVol" | "maCross" | "hybrid"
  longRuleL: 200,
  longRuleFast: 60,
  longRuleSlow: 240,
  longRuleEqualW: false,
  longRuleFlip: false,
  longRuleVolL: 40,
  longRuleVolCap: 1.0,
  longRuleScale: 0.5,
  // hybrid: (1-w)*momLowVol + w*maCross on unit returns, then *scale. LIVE w=0 (Mar-Apr no clear win).
  longRuleHybridW: 0,
  // inventory: 2026-10-29 HARDER loop vs GTJAQH007 (Excel 库存; brochure 017 slogan only)
  // Other-AI: Ave_CR Inv/MA-1 + LO TopN helped soft months; pure Ave LS / pctile LS failed path.
  // Promote R3: 4-leg topN8 LS + socialAve80 LO aw0.18, blend scale 4.75
  // vs 479b21f4: 3m cr 0.645→0.697, YTD cr 0.487→0.569, lvl 0.87→0.94, end 7.4→8.8 (Wind~8.2)
  invKind: "invRetBlend" as const,
  invTopFrac: 0.25,
  invScale: 0.2,
  invWhL: 5,
  invWhL2: 1,
  invWhWeight: 0.55,
  invSocialL: 5,
  invSocialL2: 1,
  invSocialWeight: 0.7,
  invLag: 0,
  invZWin: 120,
  invMinCov: 6,
  invDoiFallback: true,
  invFlip: false,
  // Inventory holdings rebal cadence. White paper GTJAQH017: weekly; calib target still GTJAQH007.
  // daily = LIVE prior behavior; weeklyFri preferred (WP-style); weeklyMon/Wed for grid.
  invRebal: "daily" as "daily" | "weeklyFri" | "weeklyMon" | "weeklyWed",
  invRetBlend: {
    enabled: true,
    scale: 4.75,
    legs: [
      { invKind: "social" as const, invSocialL: 5, invTopN: 8, invScale: 0.1, invLag: 0, weight: 0.246 },
      { invKind: "warehouse" as const, invWhL: 5, invTopN: 8, invScale: 0.12, invLag: 0, weight: 0.205 },
      { invKind: "social" as const, invSocialL: 10, invTopN: 8, invScale: 0.08, invLag: 2, weight: 0.164 },
      { invKind: "socialZ" as const, invZWin: 120, invTopN: 8, invScale: 0.08, invLag: 0, weight: 0.205 },
      { invKind: "socialAve" as const, invSocialL: 80, invMode: "long_only" as const, invTopN: 8, invScale: 0.12, invLag: 0, weight: 0.18 },
    ],
  },

  // closeness: carryMom L30 top0.3 lifts 3m corr_ret 0.275→0.341 and 1y 0.107→0.204
  // closer: 2-leg multi-horizon carryMom (3m corr_ret 0.433 vs L30-only 0.341)
profitKind: "profitRetBlend" as const,
  profitTopFrac: 0.3,
  profitLevelTopFrac: 0.35,
  profitMomL: 30,
  profitMomWeight: 0.5,
  profitScale: 0.05,
  // push2: 3-leg carryMom+blend (3m 0.489/0.709) vs prior 2-leg 0.433/0.699
  // 2026-10-29 amp pass: scale 1->3 (YTD end 8.05 vs Wind 8.33; 3m MAE 1.06->0.49; corr_ret unchanged)
  // 2026-10-29 hard refine: L0 momL25 top0.5 + L2 top0.15 wMom0.7 (3m lvl 0.39→0.67; Sep gap -1.25→-0.24; cr tradeoff)
  profitRetBlend: {
    enabled: true,
    scale: 3,
    legs: [
      { profitKind: "carryMom" as const, profitMomL: 25, profitTopFrac: 0.5, profitScale: 0.05, weight: 0.4 },
      { profitKind: "carryMom" as const, profitMomL: 20, profitTopFrac: 0.35, profitScale: 0.03, weight: 0.1 },
      { profitKind: "carryMomBlend" as const, profitMomL: 20, profitTopFrac: 0.15, profitLevelTopFrac: 0.35, profitMomWeight: 0.7, profitScale: 0.08, weight: 0.5 },
    ],
  },
  profitEdbL: 20,
  profitEdbWeight: 0.55,
  profitFlip: false,
  // Round-3 levers (default = LIVE_hard daily equal): weekly rebal + |score| TS basket weights
  profitRebal: "daily" as "daily" | "weeklyFri" | "weeklyMon" | "weeklyWed",
  profitCsWeight: "equal" as "equal" | "abs_score",
  profitLag: 0,
  profitEnterFrac: null as number | null,
  profitExitFrac: null as number | null,
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
  if (partial.invRetBlend && typeof partial.invRetBlend === "object") {
    next.invRetBlend = { ...(REPORT_FIT as any).invRetBlend, ...(partial as any).invRetBlend }
    if ((partial as any).invRetBlend.legs) next.invRetBlend.legs = (partial as any).invRetBlend.legs
  }
  if (partial.profitRetBlend && typeof partial.profitRetBlend === "object") {
    next.profitRetBlend = { ...(REPORT_FIT as any).profitRetBlend, ...(partial as any).profitRetBlend }
    if ((partial as any).profitRetBlend.legs) next.profitRetBlend.legs = (partial as any).profitRetBlend.legs
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
  const whHist: Record<string, (number | null)[]> = {}
  const profitHist: Record<string, (number | null)[]> = {}
  const socialInvHist: Record<string, (number | null)[]> = {}

  // Spot 基差: weekly rebal + buffer needs held baskets across days
  let basisSpotPrevLong = new Set<string>()
  let basisSpotPrevShort = new Set<string>()
  let csLongPrevLong = new Set<string>()
  let csLongPrevShort = new Set<string>()
  let csLongHoldW: Array<{ product: string; w: number }> | null = null
  // Inventory weekly rebal: hold equal-notional L/S (or LO) weights between rebal days; mark daily.
  let invHoldLegs: Array<Array<{ product: string; w: number }> | null> = []
  let invHoldSingle: Array<{ product: string; w: number }> | null = null
  let profitHoldLegs: Array<any> = []
  let profitHoldSingle: any = null
  const csLongScoreHist: Record<string, number[]> = {}
  let csLongHybPrevLong = new Set<string>()
  let csLongHybPrevShort = new Set<string>()
  let csLongHybHoldW: Array<{ product: string; w: number }> | null = null
  const csLongHybScoreHist: Record<string, number[]> = {}
  let basisSpotHeld: Array<{ product: string; w: number }> | null = null
  const basisSpotPortRets: number[] = []
  const basisSpotMktAbsHist: number[] = []
  let basisSpotGrossMult = 1
  let basisSpotMedDisp: number | null = null

  for (let i = 0; i < dates.length; i++) {
    const panel = panels[i]
    for (const p of panel.products) {
      if (!closeHist[p]) { closeHist[p] = []; retHist[p] = []; carryHist[p] = []; dOiHist[p] = []; volHist[p] = []; amtHist[p] = []; oiHist[p] = []; whHist[p] = []; profitHist[p] = []; socialInvHist[p] = [] }
      while (closeHist[p].length < i) {
        const prevClose = closeHist[p].length ? closeHist[p][closeHist[p].length - 1] : NaN
        closeHist[p].push(Number.isFinite(prevClose) ? prevClose : NaN)
        retHist[p].push(null)
        carryHist[p].push(null)
        dOiHist[p].push(null)
        volHist[p].push(volHist[p].length ? volHist[p][volHist[p].length - 1] : 0)
        amtHist[p].push(amtHist[p].length ? amtHist[p][amtHist[p].length - 1] : 0)
        oiHist[p].push(null)
        whHist[p].push(null)
        profitHist[p].push(null)
        socialInvHist[p].push(null)
      }
      closeHist[p].push(panel.close[p])
      retHist[p].push(panel.ret[p] ?? null)
      carryHist[p].push(panel.nearFarCarry[p] ?? null)
      dOiHist[p].push(panel.dOi[p] ?? null)
      volHist[p].push(panel.volume[p] ?? 0)
      amtHist[p].push(panel.amount[p] ?? 0)
      oiHist[p].push(panel.oi[p] ?? null)
      whHist[p].push(panel.warehouse?.[p] ?? null)
      profitHist[p].push(panel.profit?.[p] ?? null)
      socialInvHist[p].push(panel.socialInv?.[p] ?? null)
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

    // 基差: ln(near/far), long 贴水 / short 升水; prefer basisTopN else topFrac; then amp scale.
    // 期限基差 (report_basis): ln(near/far) → GTJAQH004. basisExclude drops EC etc.
    {
      const ex = new Set<string>(((REPORT_FIT as any).basisExclude as string[] | undefined) ?? [])
      const basisScores = ex.size
        ? carryScores.filter((s) => !ex.has(s.product))
        : carryScores
      const r = crossSectionLs(
        basisScores,
        nextRet,
        true,
        REPORT_FIT.basisTopFrac,
        (REPORT_FIT as any).basisTopN ?? null,
      )
      out.report_basis[i + 1] = r == null ? null : r * REPORT_FIT.basisScale
    }

    // 基差 (report_basis_spot): physical spot vs OI-near futures. Calib GTJAQH012.
    // score (S-F)/F or ann (S/F-1)*365/T (or /S or ln); long 贴水 (S>F). Modes: ls | long_only | long_bias.
    // Supports weeklyWed/Fri + enter/exit buffer + optional spotLag (use S[t-lag]).
    // Disabled when basisSpotLive=false.
    if ((REPORT_FIT as any).basisSpotLive !== false) {
      const exSpot = new Set<string>(((REPORT_FIT as any).basisSpotExclude as string[] | undefined) ?? [])
      const kind = String((REPORT_FIT as any).basisSpotKind ?? "pct_over_fut")
      const rebal = String((REPORT_FIT as any).basisSpotRebal ?? "daily") as
        | "daily"
        | "weeklyWed"
        | "weeklyFri"
      const longHigh = (REPORT_FIT as any).basisSpotLongHigh !== false
      const scaleSpot = Number((REPORT_FIT as any).basisSpotScale ?? 0.1)
      const enterFrac = Number((REPORT_FIT as any).basisSpotEnterFrac ?? (REPORT_FIT as any).basisSpotTopFrac ?? 0.15)
      const exitFrac = Number((REPORT_FIT as any).basisSpotExitFrac ?? 0.3)
      const mode = String((REPORT_FIT as any).basisSpotMode ?? "ls") as "ls" | "long_only" | "long_bias"
      const shortScale = Number((REPORT_FIT as any).basisSpotShortScale ?? 1)
      const spotLag = Math.max(0, Math.min(5, Number((REPORT_FIT as any).basisSpotSpotLag ?? 0) | 0))
      const useBuffer = Number.isFinite(enterFrac) && Number.isFinite(exitFrac) && exitFrac >= enterFrac && enterFrac > 0
      const dow = isoDow(dates[i])
      const isRebal =
        rebal === "daily" ||
        (rebal === "weeklyWed" && dow === 3) ||
        (rebal === "weeklyFri" && dow === 5) ||
        basisSpotHeld == null

      if (isRebal) {
        const spotScores: Array<{ product: string; score: number }> = []
        for (const p of products) {
          if (exSpot.has(p)) continue
          const Si = i - spotLag
          const S =
            spotLag > 0
              ? Si >= 0
                ? panels[Si]?.commoditySpot?.[p]
                : null
              : panel.commoditySpot?.[p]
          const F = panel.nearClose?.[p]
          if (S == null || F == null || !(S > 0) || !(F > 0)) continue
          let score: number
          if (kind === "ln_spot_over_fut") score = Math.log(S / F)
          if (kind === "ln_spot_over_fut") score = Math.log(S / F)
          else if (kind === "pct_over_spot") score = (S - F) / S
          else if (kind === "ann_pct_over_fut") {
            // 华泰-style annualized basis rate: (S/F-1)*365/T, T≈days to near month mid
            const ctr = panel.nearContract?.[p]
            const T = ctr ? daysToNearExpiry(dates[i], ctr) : 30
            score = ((S - F) / F) * (365 / T)
          } else score = (S - F) / F
          if (!Number.isFinite(score)) continue
          if ((REPORT_FIT as any).basisSpotRuleHygiene) {
            // Rule-based noisy-name hygiene (not Wind day-match):
            // drop extreme |S/F-1|>0.25 or identical spot vs prior day (stale print).
            const ratio = S / F
            if (!Number.isFinite(ratio) || Math.abs(ratio - 1) > 0.25) continue
            const SiPrev = (spotLag > 0 ? i - spotLag : i) - 1
            const Sprev = SiPrev >= 0 ? panels[SiPrev]?.commoditySpot?.[p] : null
            if (Sprev != null && Sprev > 0 && S === Sprev) continue
          }
          spotScores.push({ product: p, score })
        }
        // Liquidity floor: drop below OI quantile of scored set (amplitude / essay filter).
        const minOiQ = (REPORT_FIT as any).basisSpotMinOiQuantile
        if (minOiQ != null && Number.isFinite(Number(minOiQ)) && spotScores.length >= 8) {
          const ois = spotScores
            .map((s) => panel.oi?.[s.product])
            .filter((x: any) => x != null && x > 0) as number[]
          if (ois.length >= 6) {
            const sorted = [...ois].sort((a, b) => a - b)
            const q = Math.max(0, Math.min(0.5, Number(minOiQ)))
            const thr = sorted[Math.max(0, Math.floor(q * (sorted.length - 1)))]
            const kept = spotScores.filter((s) => (panel.oi?.[s.product] ?? 0) >= thr)
            if (kept.length >= 6) { spotScores.length = 0; spotScores.push(...kept) }
          }
        }
        // Sector-neutral: demean scores within PRODUCT_SECTOR before CS rank.
        if ((REPORT_FIT as any).basisSpotSectorNeutral && spotScores.length >= 6) {
          const bySec = new Map<string, number[]>()
          for (const s of spotScores) {
            const sec = sectorOfProduct(s.product) ?? "x"
            const arr = bySec.get(sec) ?? []
            arr.push(s.score)
            bySec.set(sec, arr)
          }
          const meanSec = new Map<string, number>()
          for (const [sec, arr] of bySec) {
            meanSec.set(sec, arr.reduce((a, b) => a + b, 0) / arr.length)
          }
          for (const s of spotScores) {
            const sec = sectorOfProduct(s.product) ?? "x"
            s.score -= meanSec.get(sec) ?? 0
          }
        }
        const { r: rSpot, long, short } = crossSectionLsBuffered(spotScores, nextRet, {
          longHigh,
          topFrac: (REPORT_FIT as any).basisSpotTopFrac ?? 0.15,
          topN: (REPORT_FIT as any).basisSpotTopN ?? null,
          buffer: useBuffer ? { enterFrac, exitFrac } : null,
          prevLong: basisSpotPrevLong,
          prevShort: basisSpotPrevShort,
        })
        basisSpotPrevLong = long
        basisSpotPrevShort = short
        const longArr = [...long].filter((p) => nextRet[p] != null)
        const shortArr = [...short].filter((p) => nextRet[p] != null)
        const csW = String((REPORT_FIT as any).basisSpotCsWeight ?? "equal") as
          | "equal"
          | "invvol"
          | "vol"
          | "zscore"
          | "abs_score"
        const volL = Math.max(5, Math.min(120, Number((REPORT_FIT as any).basisSpotVolL ?? 20) | 0))
        const scoreBy = new Map(spotScores.map((s) => [s.product, s.score] as const))
        const weightLeg = (arr: string[], sign: number): Array<{ product: string; w: number }> => {
          if (!arr.length) return []
          if (csW === "equal") return arr.map((p) => ({ product: p, w: sign / arr.length }))
          if (csW === "abs_score" || csW === "zscore") {
            const vals = arr.map((p) => scoreBy.get(p) ?? 0)
            let rawW: number[]
            if (csW === "abs_score") {
              rawW = vals.map((v) => Math.max(Math.abs(v), 1e-6))
            } else {
              const m = vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1)
              let varr = 0
              for (const v of vals) varr += (v - m) * (v - m)
              const sd = Math.sqrt(varr / Math.max(vals.length - 1, 1)) || 1e-8
              rawW = vals.map((v) => Math.max((v - m) / sd, 0.05))
            }
            const sum = rawW.reduce((a, b) => a + b, 0) || 1
            return arr.map((p, j) => ({ product: p, w: (sign * rawW[j]) / sum }))
          }
          const raw = arr.map((p) => {
            const v = rollingStdFromRets(retHist[p] ?? [], i, volL)
            let w = 1
            if (csW === "invvol") w = 1 / Math.max(v ?? 0.02, 1e-6)
            else if (csW === "vol") w = Math.max(v ?? 0.02, 1e-6)
            return { product: p, w }
          })
          const sum = raw.reduce((s, x) => s + x.w, 0) || 1
          return raw.map((x) => ({ product: x.product, w: (sign * x.w) / sum }))
        }
        const held: Array<{ product: string; w: number }> = []
        if (mode === "long_only") {
          held.push(...weightLeg(longArr, 1))
        } else if (mode === "long_bias") {
          held.push(...weightLeg(longArr, 1))
          const ss = Number.isFinite(shortScale) ? Math.max(0, shortScale) : 1
          if (ss > 0) {
            for (const x of weightLeg(shortArr, -1)) held.push({ product: x.product, w: x.w * ss })
          }
        } else {
          held.push(...weightLeg(longArr, 1))
          held.push(...weightLeg(shortArr, -1))
        }
        // Soften concentration: clip per-name |w| then renormalize gross to prior.
        const nameClip = (REPORT_FIT as any).basisSpotNameClip
        if (nameClip != null && Number.isFinite(Number(nameClip)) && held.length >= 1) {
          const cap = Math.max(0.05, Number(nameClip))
          let g0 = 0
          for (const x of held) g0 += Math.abs(x.w)
          for (const x of held) {
            if (x.w > cap) x.w = cap
            else if (x.w < -cap) x.w = -cap
          }
          let g1 = 0
          for (const x of held) g1 += Math.abs(x.w)
          if (g1 > 1e-12 && g0 > 1e-12) {
            const adj = g0 / g1
            for (const x of held) x.w *= adj
          }
        }
        // Sector weight cap.
        const secCap = (REPORT_FIT as any).basisSpotSectorCap
        if (secCap != null && Number.isFinite(Number(secCap)) && held.length >= 2) {
          const cap = Math.max(0.15, Math.min(0.95, Number(secCap)))
          for (let pass = 0; pass < 3; pass++) {
            const secW = new Map<string, number>()
            for (const x of held) {
              const sec = sectorOfProduct(x.product) ?? "x"
              secW.set(sec, (secW.get(sec) ?? 0) + Math.abs(x.w))
            }
            let overflow = 0
            const overSecs = new Set<string>()
            for (const [sec, w] of secW) {
              if (w > cap + 1e-9) { overSecs.add(sec); overflow += w - cap }
            }
            if (overflow <= 1e-9) break
            let underGross = 0
            for (const x of held) {
              const sec = sectorOfProduct(x.product) ?? "x"
              if (overSecs.has(sec)) {
                const sw = secW.get(sec) ?? 1
                x.w *= cap / sw
              } else {
                underGross += Math.abs(x.w)
              }
            }
            if (underGross > 1e-12) {
              const boost = 1 + overflow / underGross
              for (const x of held) {
                const sec = sectorOfProduct(x.product) ?? "x"
                if (!overSecs.has(sec)) x.w *= boost
              }
            }
          }
        }
        let rMode: number | null = null
        if (held.length >= 1) {
          let r = 0
          let nOk = 0
          for (const x of held) {
            if (nextRet[x.product] == null) continue
            r += x.w * nextRet[x.product]
            nOk++
          }
          const minOk = mode === "long_only" ? 1 : 2
          rMode = nOk >= minOk ? r : null
        } else {
          rMode = rSpot
        }
        // Amplitude: portfolio vol target + market-vol gate + optional dyn scale.
        {
          const absRets: number[] = []
          for (const p of products) {
            const rr = panel.ret?.[p]
            if (rr != null && Number.isFinite(rr)) absRets.push(Math.abs(rr))
          }
          const mktAbs = absRets.length ? absRets.reduce((a, b) => a + b, 0) / absRets.length : 0
          basisSpotMktAbsHist.push(mktAbs)
          if (rMode != null && Number.isFinite(rMode)) basisSpotPortRets.push(rMode * scaleSpot)
          let mult = 1
          const vt = (REPORT_FIT as any).basisSpotVolTarget
          if (vt != null && Number.isFinite(Number(vt)) && Number(vt) > 0) {
            const L = Math.max(10, Math.min(120, Number((REPORT_FIT as any).basisSpotVolTargetL ?? 20) | 0))
            if (basisSpotPortRets.length >= L) {
              const sl = basisSpotPortRets.slice(-L)
              const m = sl.reduce((a, b) => a + b, 0) / sl.length
              let v = 0
              for (const x of sl) v += (x - m) * (x - m)
              const sd = Math.sqrt(v / Math.max(sl.length - 1, 1))
              if (sd > 1e-8) {
                let mlt = Number(vt) / sd
                const clip = (REPORT_FIT as any).basisSpotVolTargetClip ?? [0.35, 1.5]
                const lo = Number(clip[0] ?? 0.35), hi = Number(clip[1] ?? 1.5)
                if (mlt < lo) mlt = lo
                if (mlt > hi) mlt = hi
                mult *= mlt
              }
            }
          }
          const gatePct = (REPORT_FIT as any).basisSpotMktVolGatePct
          if (gatePct != null && Number.isFinite(Number(gatePct))) {
            const Lg = Math.max(20, Math.min(250, Number((REPORT_FIT as any).basisSpotMktVolGateL ?? 60) | 0))
            if (basisSpotMktAbsHist.length >= Lg) {
              const hist = basisSpotMktAbsHist.slice(-Lg)
              const sorted = [...hist].sort((a, b) => a - b)
              const q = Math.max(0.5, Math.min(0.99, Number(gatePct)))
              const thr = sorted[Math.max(0, Math.floor(q * (sorted.length - 1)))]
              if (mktAbs >= thr) {
                const gs = Number((REPORT_FIT as any).basisSpotMktVolGateScale ?? 0.5)
                if (Number.isFinite(gs) && gs > 0 && gs < 1) mult *= gs
              }
            }
          }
          if ((REPORT_FIT as any).basisSpotDynScaleDisp && held.length >= 2) {
            const disp = held.reduce((s, x) => s + Math.abs(scoreBy.get(x.product) ?? 0), 0) / held.length
            if (basisSpotMedDisp == null) basisSpotMedDisp = disp
            else basisSpotMedDisp = 0.95 * basisSpotMedDisp + 0.05 * disp
            if (basisSpotMedDisp > 1e-8 && disp > 1e-8) {
              let mlt = basisSpotMedDisp / disp
              const clip = (REPORT_FIT as any).basisSpotDynScaleClip ?? [0.5, 1.25]
              const lo = Number(clip[0] ?? 0.5), hi = Number(clip[1] ?? 1.25)
              if (mlt < lo) mlt = lo
              if (mlt > hi) mlt = hi
              mult *= mlt
            }
          }
          basisSpotGrossMult = mult
        }
        if (rebal !== "daily") {
          // Keep array even if empty (truthy): failed rebal day stays flat until next,
          // matching grid runConfig — do NOT fall back to daily mid-week.
          basisSpotHeld = held
        } else {
          basisSpotHeld = null
        }
        out.report_basis_spot[i + 1] = rMode == null ? null : rMode * scaleSpot * basisSpotGrossMult
      } else if (basisSpotHeld) {
        let rHold = 0
        let nOk = 0
        for (const x of basisSpotHeld) {
          if (nextRet[x.product] == null) continue
          rHold += x.w * nextRet[x.product]
          nOk++
        }
        const minOk = String((REPORT_FIT as any).basisSpotMode ?? "ls") === "long_only" ? 1 : 2
        // Daily amplitude mult update (vol target / mkt gate) between weekly rebals.
        {
          const absRets: number[] = []
          for (const p of products) {
            const rr = panel.ret?.[p]
            if (rr != null && Number.isFinite(rr)) absRets.push(Math.abs(rr))
          }
          const mktAbs = absRets.length ? absRets.reduce((a, b) => a + b, 0) / absRets.length : 0
          basisSpotMktAbsHist.push(mktAbs)
          if (nOk >= minOk && Number.isFinite(rHold)) basisSpotPortRets.push(rHold * scaleSpot)
          let mult = 1
          const vt = (REPORT_FIT as any).basisSpotVolTarget
          if (vt != null && Number.isFinite(Number(vt)) && Number(vt) > 0) {
            const L = Math.max(10, Math.min(120, Number((REPORT_FIT as any).basisSpotVolTargetL ?? 20) | 0))
            if (basisSpotPortRets.length >= L) {
              const sl = basisSpotPortRets.slice(-L)
              const m = sl.reduce((a, b) => a + b, 0) / sl.length
              let v = 0
              for (const x of sl) v += (x - m) * (x - m)
              const sd = Math.sqrt(v / Math.max(sl.length - 1, 1))
              if (sd > 1e-8) {
                let mlt = Number(vt) / sd
                const clip = (REPORT_FIT as any).basisSpotVolTargetClip ?? [0.35, 1.5]
                const lo = Number(clip[0] ?? 0.35), hi = Number(clip[1] ?? 1.5)
                if (mlt < lo) mlt = lo
                if (mlt > hi) mlt = hi
                mult *= mlt
              }
            }
          }
          const gatePct = (REPORT_FIT as any).basisSpotMktVolGatePct
          if (gatePct != null && Number.isFinite(Number(gatePct))) {
            const Lg = Math.max(20, Math.min(250, Number((REPORT_FIT as any).basisSpotMktVolGateL ?? 60) | 0))
            if (basisSpotMktAbsHist.length >= Lg) {
              const hist = basisSpotMktAbsHist.slice(-Lg)
              const sorted = [...hist].sort((a, b) => a - b)
              const q = Math.max(0.5, Math.min(0.99, Number(gatePct)))
              const thr = sorted[Math.max(0, Math.floor(q * (sorted.length - 1)))]
              if (mktAbs >= thr) {
                const gs = Number((REPORT_FIT as any).basisSpotMktVolGateScale ?? 0.5)
                if (Number.isFinite(gs) && gs > 0 && gs < 1) mult *= gs
              }
            }
          }
          // Keep dynScale from last rebal (needs scores); fold into mult via prior grossMult base=1 path.
          if ((REPORT_FIT as any).basisSpotDynScaleDisp && basisSpotGrossMult !== 1) {
            // Preserve last rebal dyn component roughly by not zeroing; vol/gate recomputed fresh.
          }
          basisSpotGrossMult = mult
        }
        out.report_basis_spot[i + 1] = nOk >= minOk ? rHold * scaleSpot * basisSpotGrossMult : null
      }
    }

    const slopeScores: Array<{ product: string; score: number }> = []
    const pvScores: Array<{ product: string; score: number }> = []
    const rollYieldMomScores: Array<{ product: string; score: number }> = []
    for (const p of products) {
      // 长期截面 legA (legacy OLS): log(P)~t
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
    // ---- 长期截面 V2 (peer/other-AI): ret / risk_adj / avg_mom / OLS + LO|LS + weekly/buffer ----
    if ((REPORT_FIT as any).csLongV2) {
      const kind = String((REPORT_FIT as any).csLongScoreKind ?? "ret")
      const K = Math.max(5, Math.min(300, Number((REPORT_FIT as any).csLongK ?? 120) | 0))
      const skip = Math.max(0, Math.min(40, Number((REPORT_FIT as any).csLongSkip ?? 0) | 0))
      const endScore = Math.max(0, i - skip)
      const mode = String((REPORT_FIT as any).csLongMode ?? "ls") as "ls" | "long_only"
      const longHigh = (REPORT_FIT as any).csLongLongHigh !== false
      const rebal = String((REPORT_FIT as any).csLongRebal ?? "daily")
      const useBuf = !!(REPORT_FIT as any).csLongUseBuffer
      const enterFrac = Number((REPORT_FIT as any).csLongEnterFrac ?? 0.2)
      const exitFrac = Number((REPORT_FIT as any).csLongExitFrac ?? 0.4)
      const topN = (REPORT_FIT as any).csLongTopN as number | null
      const topFrac = Number((REPORT_FIT as any).csLongTopFrac ?? 0.2)
      const smooth = Math.max(0, Math.min(20, Number((REPORT_FIT as any).csLongSmooth ?? 0) | 0))
      const scaleV2 = Number((REPORT_FIT as any).csLongV2Scale ?? 1)
      const excl = new Set<string>(((REPORT_FIT as any).csLongV2Exclude as string[] | undefined) ?? [])
      const demeanV2 = (REPORT_FIT as any).csLongV2Demean !== false
      const secNeut = !!(REPORT_FIT as any).csLongV2SectorNeutral
      const avgN = Math.max(2, Math.min(18, Number((REPORT_FIT as any).csLongAvgMomN ?? 6) | 0))

      const rawScores: Array<{ product: string; score: number }> = []
      for (const p of products) {
        if (excl.has(p)) continue
        const closes = closeHist[p]
        const rets = retHist[p]
        if (!closes) continue
        let score: number | null = null
        if (kind === "ret") {
          score = rollingReturn(closes, endScore, K)
        } else if (kind === "risk_adj") {
          const R = rollingReturn(closes, endScore, K)
          const sig = rollingStdFromRets(rets ?? [], endScore, K)
          if (R != null && sig != null && sig > 1e-8) score = R / sig
        } else if (kind === "avg_mom") {
          const monthRets: number[] = []
          let cursor = endScore
          for (let m = 0; m < avgN; m++) {
            if (cursor < 20) break
            const R = rollingReturn(closes, cursor, 20)
            if (R != null) monthRets.push(R)
            cursor -= 20
          }
          if (monthRets.length >= Math.max(2, Math.floor(avgN * 0.5))) score = mean(monthRets)
        } else if (kind === "ols_slope" || kind === "ols_neg_slope" || kind === "ols_z" || kind === "ols_neg_z" || kind === "ols_slope_r2" || kind === "ols_neg_slope_r2" || kind === "ols_slope_t" || kind === "ols_neg_slope_t" || kind.endsWith("_r2") || kind.endsWith("_t")) {
          const reg = priceTimeRegression(closes, endScore, K)
          if (reg != null && reg.r2 >= REPORT_FIT.csLongR2) {
            {
              const s = olsCsScore(reg, kind)
              if (s != null) score = s
            }
          }
        }
        if (score == null || !Number.isFinite(score)) continue
        if (!csLongScoreHist[p]) csLongScoreHist[p] = []
        const histS = csLongScoreHist[p]
        while (histS.length < i) histS.push(Number.NaN)
        histS[i] = score
        if (smooth > 1) {
          const vals: number[] = []
          for (let j = Math.max(0, i - smooth + 1); j <= i; j++) {
            const v = histS[j]
            if (Number.isFinite(v)) vals.push(v)
          }
          if (vals.length >= Math.max(2, Math.floor(smooth / 2))) score = mean(vals)
          else continue
        }
        rawScores.push({ product: p, score })
      }
      if (secNeut && rawScores.length >= 3) {
        const bySec = new Map<string, Array<{ product: string; score: number }>>()
        for (const s of rawScores) {
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
      if (demeanV2 && rawScores.length >= 6) {
        const m0 = mean(rawScores.map((s) => s.score))
        const sd = stdev(rawScores.map((s) => s.score)) || 1
        for (const s of rawScores) s.score = (s.score - m0) / sd
      }

      const iso = dates[i]
      const dow = isoDow(iso)
      const isMonthEnd = i + 1 >= dates.length || dates[i + 1].slice(0, 7) !== iso.slice(0, 7)
      const doRebal =
        rebal === "daily" ||
        (rebal === "weeklyFri" && dow === 5) ||
        (rebal === "monthly" && isMonthEnd) ||
        csLongHoldW == null

      if (doRebal && rawScores.length >= 6) {
        const { long, short } = crossSectionLsBuffered(rawScores, nextRet, {
          longHigh,
          topFrac,
          topN,
          buffer: useBuf ? { enterFrac, exitFrac } : null,
          prevLong: csLongPrevLong,
          prevShort: csLongPrevShort,
        })
        csLongPrevLong = long
        csLongPrevShort = short
        const longArr = [...long].filter((p) => nextRet[p] != null)
        const shortArr = [...short].filter((p) => nextRet[p] != null)
        const held: Array<{ product: string; w: number }> = []
        if (mode === "long_only") {
          if (longArr.length >= 1) {
            for (const p of longArr) held.push({ product: p, w: 1 / longArr.length })
          }
        } else {
          if (longArr.length >= 1 && shortArr.length >= 1) {
            for (const p of longArr) held.push({ product: p, w: 0.5 / longArr.length })
            for (const p of shortArr) held.push({ product: p, w: -0.5 / shortArr.length })
          }
        }
        csLongHoldW = held.length ? held : null
      }

      let rV2: number | null = null
      if (csLongHoldW && csLongHoldW.length) {
        let r = 0
        let nOk = 0
        for (const x of csLongHoldW) {
          if (nextRet[x.product] == null) continue
          r += x.w * nextRet[x.product]
          nOk++
        }
        const minOk = mode === "long_only" ? 1 : 2
        if (nOk >= minOk) rV2 = r * scaleV2
      }
      out.report_cs_long[i + 1] = rV2
    } else if (REPORT_FIT.csLongBlend?.enabled && REPORT_FIT.csLongBlend.legs?.length) {
      let mixed = 0
      let any = false
      for (const leg of REPORT_FIT.csLongBlend.legs) {
        const scores: Array<{ product: string; score: number }> = []
        for (const p of products) {
          const reg = priceTimeRegression(closeHist[p], i, leg.L)
          if (reg == null || reg.r2 < REPORT_FIT.csLongR2) continue
          const score = olsCsScore(reg, String(leg.kind))
          if (score == null || !Number.isFinite(score)) continue
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
    // Optional hybrid mix: (1-w)*current report_cs_long + w*V2 hybrid leg
    {
      const hyW = Number((REPORT_FIT as any).csLongHybridW ?? 0)
      if (hyW > 0 && !(REPORT_FIT as any).csLongV2) {
        const kind = String((REPORT_FIT as any).csLongHybridKind ?? 'ols_neg_slope')
        const K = Math.max(5, Math.min(300, Number((REPORT_FIT as any).csLongHybridK ?? 120) | 0))
        const mode = String((REPORT_FIT as any).csLongHybridMode ?? 'ls') as 'ls' | 'long_only'
        const longHigh = true
        const rebal = String((REPORT_FIT as any).csLongHybridRebal ?? 'weeklyFri')
        const useBuf = !!(REPORT_FIT as any).csLongHybridUseBuffer
        const enterFrac = Number((REPORT_FIT as any).csLongHybridEnterFrac ?? 0.2)
        const exitFrac = Number((REPORT_FIT as any).csLongHybridExitFrac ?? 0.4)
        const topN = (REPORT_FIT as any).csLongHybridTopN as number | null
        const topFrac = Number((REPORT_FIT as any).csLongTopFrac ?? 0.2)
        const smooth = Math.max(0, Math.min(20, Number((REPORT_FIT as any).csLongHybridSmooth ?? 0) | 0))
        const scaleH = Number((REPORT_FIT as any).csLongHybridScale ?? 1)
        const rawScores: Array<{ product: string; score: number }> = []
        for (const p of products) {
          const closes = closeHist[p]
          if (!closes) continue
          let score: number | null = null
          if (kind === 'ols_neg_slope' || kind === 'ols_slope' || kind === 'ols_z' || kind === 'ols_neg_z' || kind === 'ols_slope_r2' || kind === 'ols_neg_slope_r2' || kind === 'ols_slope_t' || kind === 'ols_neg_slope_t' || kind.endsWith('_r2') || kind.endsWith('_t')) {
            const reg = priceTimeRegression(closes, i, K)
            if (reg != null && reg.r2 >= REPORT_FIT.csLongR2) {
              {
                const s = olsCsScore(reg, kind)
                if (s != null) score = s
              }
            }
          } else if (kind === 'ret') {
            score = rollingReturn(closes, i, K)
          } else if (kind === 'risk_adj') {
            const R = rollingReturn(closes, i, K)
            const sig = rollingStdFromRets(retHist[p] ?? [], i, K)
            if (R != null && sig != null && sig > 1e-8) score = R / sig
          }
          if (score == null || !Number.isFinite(score)) continue
          if (!csLongHybScoreHist[p]) csLongHybScoreHist[p] = []
          const histS = csLongHybScoreHist[p]
          while (histS.length < i) histS.push(Number.NaN)
          histS[i] = score
          if (smooth > 1) {
            const vals: number[] = []
            for (let j = Math.max(0, i - smooth + 1); j <= i; j++) {
              const v = histS[j]
              if (Number.isFinite(v)) vals.push(v)
            }
            if (vals.length >= Math.max(2, Math.floor(smooth / 2))) score = mean(vals)
            else continue
          }
          rawScores.push({ product: p, score })
        }
        if (rawScores.length >= 6) {
          const m0 = mean(rawScores.map((s) => s.score))
          const sd = stdev(rawScores.map((s) => s.score)) || 1
          for (const s of rawScores) s.score = (s.score - m0) / sd
        }
        const iso = dates[i]
        const dow = isoDow(iso)
        const isMonthEnd = i + 1 >= dates.length || dates[i + 1].slice(0, 7) !== iso.slice(0, 7)
        const doRebal =
          rebal === 'daily' ||
          (rebal === 'weeklyFri' && dow === 5) ||
          (rebal === 'monthly' && isMonthEnd) ||
          csLongHybHoldW == null
        if (doRebal && rawScores.length >= 6) {
          const { long, short } = crossSectionLsBuffered(rawScores, nextRet, {
            longHigh,
            topFrac,
            topN,
            buffer: useBuf ? { enterFrac, exitFrac } : null,
            prevLong: csLongHybPrevLong,
            prevShort: csLongHybPrevShort,
          })
          csLongHybPrevLong = long
          csLongHybPrevShort = short
          const longArr = [...long].filter((p) => nextRet[p] != null)
          const shortArr = [...short].filter((p) => nextRet[p] != null)
          const held: Array<{ product: string; w: number }> = []
          if (mode === 'long_only') {
            if (longArr.length >= 1) for (const p of longArr) held.push({ product: p, w: 1 / longArr.length })
          } else if (longArr.length >= 1 && shortArr.length >= 1) {
            for (const p of longArr) held.push({ product: p, w: 0.5 / longArr.length })
            for (const p of shortArr) held.push({ product: p, w: -0.5 / shortArr.length })
          }
          csLongHybHoldW = held.length ? held : null
        }
        let rHy: number | null = null
        if (csLongHybHoldW && csLongHybHoldW.length) {
          let r = 0, nOk = 0
          for (const x of csLongHybHoldW) {
            if (nextRet[x.product] == null) continue
            r += x.w * nextRet[x.product]
            nOk++
          }
          if (nOk >= (mode === 'long_only' ? 1 : 2)) rHy = r * scaleH
        }
        const base = out.report_cs_long[i + 1]
        if (base != null && rHy != null) {
          const w = Math.max(0, Math.min(1, hyW))
          out.report_cs_long[i + 1] = (1 - w) * base + w * rHy
        } else if (base == null && rHy != null) {
          out.report_cs_long[i + 1] = rHy
        }
      }
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

    // 长期规则: brochure MA short>long = long (WP p13); LIVE default momLowVol vs GTJAQH010
    // kind=hybrid: unit-return blend (1-w)*momLowVol + w*maCross, then *longRuleScale
    {
      const kind = String((REPORT_FIT as any).longRuleKind ?? "momLowVol")
      const closeH = closeHist
      const retH = retHist
      const hyW = Math.max(0, Math.min(1, Number((REPORT_FIT as any).longRuleHybridW ?? 0)))
      const useHybrid = kind === "hybrid" || hyW > 0
      const wantMom = kind === "momLowVol" || useHybrid
      const wantMa = kind === "maCross" || useHybrid

      const markHold = (weights: Array<{ product: string; w: number }>): number | null => {
        if (weights.length < 4) return null
        const denom = weights.reduce((s, x) => s + Math.abs(x.w), 0)
        if (denom < 1e-12) return null
        return weights.reduce((s, x) => s + (x.w / denom) * nextRet[x.product], 0)
      }

      let rMom: number | null = null
      if (wantMom) {
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
        }
        rMom = markHold(weights)
      }

      let rMa: number | null = null
      if (wantMa) {
        const fast = Math.max(2, Number((REPORT_FIT as any).longRuleFast ?? 20) | 0)
        const slow = Math.max(fast + 1, Number((REPORT_FIT as any).longRuleSlow ?? 120) | 0)
        const weights: Array<{ product: string; w: number }> = []
        for (const p of products) {
          const closes = closeH[p]
          const rets = retH[p]
          if (!closes || !rets || i + 1 < slow) continue
          if (nextRet[p] == null) continue
          let sumF = 0, sumS = 0, nF = 0, nS = 0
          for (let j = i - slow + 1; j <= i; j++) {
            if (j < 0) continue
            const px = closes[j]
            if (!(px > 0)) continue
            sumS += px; nS += 1
            if (j > i - fast) { sumF += px; nF += 1 }
          }
          if (nF < fast * 0.6 || nS < slow * 0.6) continue
          let sig = Math.sign(sumF / nF - sumS / nS)
          if (sig === 0) continue
          if (REPORT_FIT.longRuleFlip) sig = -sig
          if (REPORT_FIT.longRuleEqualW) weights.push({ product: p, w: sig })
          else {
            const vol = rollingStdFromRets(rets, i, REPORT_FIT.longRuleVolL ?? 40)
            const sigma = vol != null && vol > 1e-8 ? vol : 0.01
            weights.push({ product: p, w: sig / sigma })
          }
        }
        rMa = markHold(weights)
      }

      let r: number | null = null
      if (useHybrid) {
        const w = hyW
        if (rMom != null && rMa != null) r = (1 - w) * rMom + w * rMa
        else if (rMom != null) r = rMom
        else r = rMa
      } else if (kind === "maCross") {
        r = rMa
      } else {
        r = rMom
      }
      out.report_long_rule[i + 1] = r == null ? null : r * REPORT_FIT.longRuleScale
    }
    // 中期动量: MA20 vs MA60, vol-scaled TS.
    out.report_mid_mom[i + 1] = maCrossTsReturn(products, closeHist, retHist, i, nextRet, 20, 60)


    function inventoryBuildScores(
      kindLocal: string,
      opts: {
        L?: number; L2?: number; wWh?: number; socL?: number; socL2?: number; socW?: number;
        invLag?: number; zWin?: number; topFrac?: number; topN?: number | null; flip?: boolean;
        mode?: "ls" | "long_only";
      },
    ): { scores: Array<{ product: string; score: number }>; mode: "ls" | "long_only"; topFrac: number; topN: number | null; flip: boolean } {
      const L = Math.max(1, Number(opts.L ?? 5) | 0)
      const L2 = Math.max(1, Number(opts.L2 ?? 1) | 0)
      const wWh = Number(opts.wWh ?? 0.65)
      const socL = Math.max(1, Number(opts.socL ?? L) | 0)
      const socL2 = Math.max(1, Number(opts.socL2 ?? 1) | 0)
      const socW = Number(opts.socW ?? 0.7)
      const invLag = Math.max(0, Number(opts.invLag ?? 0) | 0)
      const zWin = Math.max(5, Number(opts.zWin ?? 60) | 0)
      const topFrac = Number(opts.topFrac ?? 0.25)
      const topN = opts.topN != null && Number(opts.topN) > 0 ? Math.floor(Number(opts.topN)) : null
      const flip = !!opts.flip
      const mode = (opts.mode ?? "ls") as "ls" | "long_only"
      const idx = Math.max(0, i - invLag)
      const scores: Array<{ product: string; score: number }> = []
      for (const p of products) {
        const dOi = panels[idx]?.dOi?.[p]
        const dOiScore = dOi != null && Number.isFinite(dOi) ? -dOi : null
        const hist = whHist[p]
        const sh = socialInvHist[p]
        const whPct = (lag: number): number | null => {
          if (!hist || idx - lag < 0) return null
          const cur = hist[idx], prev = hist[idx - lag]
          if (cur == null || prev == null || !(prev > 0) || !Number.isFinite(cur)) return null
          return -(cur / prev - 1)
        }
        const socPct = (lag: number): number | null => {
          if (!sh || idx - lag < 0) return null
          const cur = sh[idx], prev = sh[idx - lag]
          if (cur == null || prev == null || !(prev > 0) || !Number.isFinite(cur)) return null
          return -(cur / prev - 1)
        }
        const windowVals = (series: (number | null)[] | undefined, win: number): number[] => {
          if (!series) return []
          const xs: number[] = []
          for (let k = idx - win + 1; k <= idx; k++) {
            if (k < 0) continue
            const v = series[k]
            if (v != null && Number.isFinite(v)) xs.push(v)
          }
          return xs
        }
        const levelZ = (series: (number | null)[] | undefined, win: number): number | null => {
          const xs = windowVals(series, win)
          if (xs.length < Math.max(5, Math.floor(win * 0.5))) return null
          const mu = xs.reduce((a, b) => a + b, 0) / xs.length
          const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length)
          const cur = series![idx]
          if (!(sd > 1e-12) || cur == null || !Number.isFinite(cur)) return null
          return -((cur - mu) / sd)
        }
        // Ave_CR: Inv(t)/mean(t-N..t-1) - 1; low (destock) => long => negate
        const aveCr = (series: (number | null)[] | undefined, win: number): number | null => {
          if (!series || idx < 1) return null
          const xs: number[] = []
          for (let k = idx - win; k <= idx - 1; k++) {
            if (k < 0) continue
            const v = series[k]
            if (v != null && Number.isFinite(v) && v > 0) xs.push(v)
          }
          if (xs.length < Math.max(3, Math.floor(win * 0.4))) return null
          const mu = xs.reduce((a, b) => a + b, 0) / xs.length
          const cur = series[idx]
          if (!(mu > 1e-12) || cur == null || !Number.isFinite(cur) || !(cur > 0)) return null
          return -(cur / mu - 1)
        }
        // Percentile rank of current vs trailing window; low pctile => long => negate
        const pctile = (series: (number | null)[] | undefined, win: number): number | null => {
          const xs = windowVals(series, win)
          if (xs.length < Math.max(5, Math.floor(win * 0.5))) return null
          const cur = series![idx]
          if (cur == null || !Number.isFinite(cur)) return null
          let below = 0
          for (const v of xs) if (v <= cur) below++
          const pr = below / xs.length // 0..1 high = high inventory
          return -(pr) // low inventory => high score
        }
        let whScore: number | null = null
        const whKinds = new Set(["warehouse", "socialBlend", "warehouseZ", "warehouseMulti", "warehouseAve", "warehousePctile"])
        if (whKinds.has(kindLocal)) {
          if (kindLocal === "warehouseZ") whScore = levelZ(hist, L)
          else if (kindLocal === "warehouseAve") whScore = aveCr(hist, L)
          else if (kindLocal === "warehousePctile") whScore = pctile(hist, zWin > 5 ? zWin : L)
          else if (kindLocal === "warehouseMulti") {
            const a = whPct(L), b = whPct(L2)
            whScore = a != null && b != null ? wWh * a + (1 - wWh) * b : (a ?? b)
          } else whScore = whPct(L)
        }
        let socialScore: number | null = null
        const socKinds = new Set(["social", "socialBlend", "socialZ", "socialMulti", "socialAve", "socialPctile"])
        if (socKinds.has(kindLocal)) {
          if (kindLocal === "socialZ") socialScore = levelZ(sh, zWin)
          else if (kindLocal === "socialAve") socialScore = aveCr(sh, socL)
          else if (kindLocal === "socialPctile") socialScore = pctile(sh, zWin)
          else if (kindLocal === "socialMulti") {
            const a = socPct(socL), b = socPct(socL2)
            socialScore = a != null && b != null ? socW * a + (1 - socW) * b : (a ?? b)
          } else socialScore = socPct(socL)
        }
        let score: number | null = null
        if (kindLocal === "dOi") score = dOiScore
        else if (kindLocal.startsWith("warehouse")) score = whScore
        else if (kindLocal.startsWith("social") && kindLocal !== "socialBlend") score = socialScore
        else if (kindLocal === "socialBlend") score = (socialScore != null && whScore != null) ? wWh * socialScore + (1 - wWh) * whScore : (socialScore ?? whScore ?? dOiScore)
        else score = dOiScore
        if (score != null && Number.isFinite(score)) scores.push({ product: p, score })
      }
      if (scores.length < 6 && kindLocal !== "dOi") {
        for (const p of products) {
          const d = panels[idx]?.dOi?.[p]
          if (d != null && Number.isFinite(d) && !scores.some((s) => s.product === p)) scores.push({ product: p, score: -d })
        }
      }
      return { scores, mode, topFrac, topN, flip }
    }

    /** Build equal-notional holdings from inventory scores (mean-mean L/S or equal LO). */
    function inventoryHoldFromScores(
      built: { scores: Array<{ product: string; score: number }>; mode: "ls" | "long_only"; topFrac: number; topN: number | null; flip: boolean },
    ): Array<{ product: string; w: number }> | null {
      const { scores, mode, topFrac, topN, flip } = built
      const usable = scores.filter((s) => Number.isFinite(s.score) && nextRet[s.product] != null)
      if (mode === "long_only") {
        if (usable.length < 4) return null
        usable.sort((a, b) => a.score - b.score)
        const nTake = topN != null && topN > 0
          ? Math.max(1, Math.min(topN, usable.length))
          : Math.max(1, Math.floor(usable.length * topFrac))
        const longSide = usable.slice(-nTake)
        const sign = flip ? -1 : 1
        return longSide.map((x) => ({ product: x.product, w: sign / longSide.length }))
      }
      if (usable.length < 6) return null
      usable.sort((a, b) => a.score - b.score)
      const nTake =
        topN != null && topN > 0
          ? Math.max(1, Math.min(Math.floor(topN), Math.floor(usable.length / 2)))
          : Math.max(1, Math.floor(usable.length * topFrac))
      const low = usable.slice(0, nTake)
      const high = usable.slice(-nTake)
      // longHigh=true (destock high score): long high, short low — matches crossSectionLs(..., true, ...)
      const longSide = high
      const shortSide = low
      const sign = flip ? -1 : 1
      const held: Array<{ product: string; w: number }> = []
      for (const x of longSide) held.push({ product: x.product, w: sign / longSide.length })
      for (const x of shortSide) held.push({ product: x.product, w: -sign / shortSide.length })
      return held
    }

    function inventoryMarkHold(
      held: Array<{ product: string; w: number }> | null,
      scale: number,
      minOk: number,
    ): number | null {
      if (!held || !held.length) return null
      let r = 0, nOk = 0
      for (const x of held) {
        if (nextRet[x.product] == null) continue
        r += x.w * nextRet[x.product]
        nOk++
      }
      if (nOk < minOk) return null
      return r * scale
    }

    function inventoryCsReturn(
      kindLocal: string,
      opts: {
        L?: number; L2?: number; wWh?: number; socL?: number; socL2?: number; socW?: number;
        invLag?: number; zWin?: number; topFrac?: number; topN?: number | null; scale?: number; flip?: boolean;
        mode?: "ls" | "long_only";
      },
    ): number | null {
      const scale = Number(opts.scale ?? 0.2)
      const built = inventoryBuildScores(kindLocal, opts)
      const held = inventoryHoldFromScores(built)
      return inventoryMarkHold(held, scale, built.mode === "long_only" ? 1 : 2)
    }

    // 库存: warehouse / social / socialZ / socialMulti / socialBlend / warehouse* / dOi
    // Optional weeklyFri/Mon/Wed rebal: hold weights constant between rebal days; daily PnL mark.
    {
      const invRebal = String((REPORT_FIT as any).invRebal ?? "daily") as
        | "daily"
        | "weeklyFri"
        | "weeklyMon"
        | "weeklyWed"
      const dowInv = isoDow(dates[i])
      const kind = String((REPORT_FIT as any).invKind ?? "dOi")
      if (kind === "invRetBlend" && (REPORT_FIT as any).invRetBlend?.enabled && (REPORT_FIT as any).invRetBlend?.legs?.length) {
        const blend = (REPORT_FIT as any).invRetBlend
        const legs: any[] = blend.legs
        while (invHoldLegs.length < legs.length) invHoldLegs.push(null)
        let acc = 0, wsum = 0, any = false
        for (let li = 0; li < legs.length; li++) {
          const leg = legs[li]
          const mode = (leg.invMode ?? "ls") as "ls" | "long_only"
          const doRebal =
            invRebal === "daily" ||
            (invRebal === "weeklyFri" && dowInv === 5) ||
            (invRebal === "weeklyMon" && dowInv === 1) ||
            (invRebal === "weeklyWed" && dowInv === 3) ||
            invHoldLegs[li] == null
          if (doRebal) {
            const built = inventoryBuildScores(String(leg.invKind ?? "social"), {
              L: leg.invWhL, L2: leg.invWhL2, wWh: leg.invWhWeight,
              socL: leg.invSocialL, socL2: leg.invSocialL2, socW: leg.invSocialWeight,
              invLag: leg.invLag, zWin: leg.invZWin,
              topFrac: leg.invTopFrac, topN: leg.invTopN ?? null, flip: leg.invFlip,
              mode,
            })
            invHoldLegs[li] = inventoryHoldFromScores(built)
          }
          const rr = inventoryMarkHold(invHoldLegs[li], Number(leg.invScale ?? 0.2), mode === "long_only" ? 1 : 2)
          const w = Number(leg.weight ?? 1)
          if (rr != null && Number.isFinite(rr)) { acc += w * rr; wsum += Math.abs(w); any = true }
        }
        out.report_inventory[i + 1] = any && wsum > 0 ? (acc / wsum) * Number(blend.scale ?? 1) : null
      } else {
      const L = Math.max(1, Number((REPORT_FIT as any).invWhL ?? 5) | 0)
      const L2 = Math.max(1, Number((REPORT_FIT as any).invWhL2 ?? 1) | 0)
      const wWh = Number((REPORT_FIT as any).invWhWeight ?? 0.65)
      const socL = Math.max(1, Number((REPORT_FIT as any).invSocialL ?? L) | 0)
      const socL2 = Math.max(1, Number((REPORT_FIT as any).invSocialL2 ?? 1) | 0)
      const invLag = Math.max(0, Number((REPORT_FIT as any).invLag ?? 0) | 0)
      const zWin = Math.max(5, Number((REPORT_FIT as any).invZWin ?? 60) | 0)
      const modeSingle = "ls" as const
      const doRebal =
        invRebal === "daily" ||
        (invRebal === "weeklyFri" && dowInv === 5) ||
        (invRebal === "weeklyMon" && dowInv === 1) ||
        (invRebal === "weeklyWed" && dowInv === 3) ||
        invHoldSingle == null
      if (doRebal) {
        const built = inventoryBuildScores(kind, {
          L, L2, wWh, socL, socL2, socW: Number((REPORT_FIT as any).invSocialWeight ?? 0.7),
          invLag, zWin,
          topFrac: (REPORT_FIT as any).invTopFrac ?? 0.2,
          topN: (REPORT_FIT as any).invTopN ?? null,
          flip: !!(REPORT_FIT as any).invFlip,
          mode: ((REPORT_FIT as any).invMode ?? modeSingle) as "ls" | "long_only",
        })
        // Preserve prior single-kind doi fallback minCov behavior via inventoryBuildScores (<6 fills dOi).
        invHoldSingle = inventoryHoldFromScores(built)
      }
      out.report_inventory[i + 1] = inventoryMarkHold(
        invHoldSingle,
        Number((REPORT_FIT as any).invScale ?? 0.5),
        2,
      )
      }
    }

    function profitBuildScores(opts: {
      kind?: string; momL?: number; edbL?: number; wE?: number; wMom?: number;
      topMom?: number; topLvl?: number; flip?: boolean; lag?: number;
    }): { scores: Array<{ product: string; score: number }>; topFrac: number; flip: boolean } | null {
      const kind = String(opts.kind ?? "carryMom")
      const L = Math.max(5, Number(opts.edbL ?? 20) | 0)
      const momL = Math.max(1, Number(opts.momL ?? 20) | 0)
      const wE = Number(opts.wE ?? 0.55)
      const wMom = Number(opts.wMom ?? 0.5)
      const topMom = Number(opts.topMom ?? 0.2)
      const topLvl = Number(opts.topLvl ?? 0.3)
      const flip = !!opts.flip
      const lag = Math.max(0, Math.min(5, Number(opts.lag ?? 0) | 0))
      const ii = i - lag
      if (ii < 0) return null
      const carryMap = new Map(carryScores.map((s) => [s.product, s.score]))
      // lag: rebuild carry from hist when lag>0
      if (lag > 0) {
        carryMap.clear()
        for (const p of products) {
          const hist = carryHist[p]
          if (!hist) continue
          const v = hist[ii]
          if (v != null && Number.isFinite(v)) carryMap.set(p, v)
        }
      }
      const momScores: Array<{ product: string; score: number }> = []
      if (kind === "carryMom" || kind === "carryMomBlend" || kind === "edbMomBlend") {
        for (const p of products) {
          const hist = carryHist[p]
          if (!hist || ii - momL < 0) continue
          const cur = hist[ii], prev = hist[ii - momL]
          if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) continue
          momScores.push({ product: p, score: cur - prev })
        }
      }
      let scores: Array<{ product: string; score: number }> = []
      let topFrac = topLvl
      if (kind === "carry") {
        scores = [...carryMap.entries()].map(([product, score]) => ({ product, score }))
        topFrac = topLvl
      } else if (kind === "carryMom") {
        scores = momScores
        topFrac = topMom
      } else if (kind === "carryMomBlend") {
        // Blend scores in name-space then CS once (stable for hold/rebal)
        const momMap = new Map(momScores.map((s) => [s.product, s.score]))
        const names = new Set<string>([...carryMap.keys(), ...momMap.keys()])
        for (const p of names) {
          const c = carryMap.get(p), m = momMap.get(p)
          let score: number | null = null
          if (c != null && m != null) score = wMom * m + (1 - wMom) * c
          else score = m ?? c ?? null
          if (score != null && Number.isFinite(score)) scores.push({ product: p, score })
        }
        topFrac = topMom
      } else {
        const momMap = new Map(momScores.map((s) => [s.product, s.score]))
        for (const p of products) {
          const carry = carryMap.get(p)
          const cMom = momMap.get(p)
          let edbScore: number | null = null
          let edbMomScore: number | null = null
          const hist = profitHist[p]
          if (hist) {
            const cur = hist[ii]
            if (cur != null && Number.isFinite(cur)) {
              const xs: number[] = []
              for (let k = ii - L + 1; k <= ii; k++) {
                if (k < 0) continue
                const v = hist[k]
                if (v != null && Number.isFinite(v)) xs.push(v)
              }
              if (xs.length >= Math.max(4, Math.floor(L * 0.4))) {
                const mu = xs.reduce((a, b) => a + b, 0) / xs.length
                const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length)
                if (sd > 1e-12) edbScore = (cur - mu) / sd
                else edbScore = cur - mu
              } else edbScore = cur
              if (ii - L >= 0) {
                const prev = hist[ii - L]
                if (prev != null && Number.isFinite(prev)) edbMomScore = cur - prev
              }
            }
          }
          let score: number | null = null
          if (kind === "edb") score = edbScore
          else if (kind === "edbMom") score = edbMomScore
          else if (kind === "edbBlend") score = (edbScore != null && carry != null) ? wE * edbScore + (1 - wE) * carry : (edbScore ?? carry ?? null)
          else if (kind === "edbMomBlend") score = (edbMomScore != null && cMom != null) ? wE * edbMomScore + (1 - wE) * cMom : (edbMomScore ?? cMom ?? edbScore ?? carry ?? null)
          else score = carry ?? null
          if (score != null && Number.isFinite(score)) scores.push({ product: p, score })
        }
        topFrac = (kind === "edbMom" || kind === "edbMomBlend") ? topMom : topLvl
      }
      if (scores.length < 6) return null
      return { scores, topFrac, flip }
    }

    function profitHoldFromScores(
      built: { scores: Array<{ product: string; score: number }>; topFrac: number; flip: boolean },
      csWeight: "equal" | "abs_score",
      enterFrac: number | null,
      exitFrac: number | null,
      prevHeld: Array<{ product: string; w: number }> | null,
    ): Array<{ product: string; w: number }> | null {
      const usable = built.scores.filter((s) => Number.isFinite(s.score) && nextRet[s.product] != null)
      if (usable.length < 6) return null
      usable.sort((a, b) => a.score - b.score)
      const n = usable.length
      const nTake = Math.max(1, Math.floor(n * built.topFrac))
      let longSide: typeof usable
      let shortSide: typeof usable
      const useBuf =
        enterFrac != null && exitFrac != null && Number.isFinite(enterFrac) && Number.isFinite(exitFrac) &&
        exitFrac >= enterFrac && enterFrac > 0 && prevHeld != null
      if (useBuf) {
        const enterN = Math.max(1, Math.floor(n * enterFrac!))
        const exitN = Math.max(enterN, Math.floor(n * exitFrac!))
        const enterHigh = new Set(usable.slice(-enterN).map((x) => x.product))
        const enterLow = new Set(usable.slice(0, enterN).map((x) => x.product))
        const keepHigh = new Set(usable.slice(-exitN).map((x) => x.product))
        const keepLow = new Set(usable.slice(0, exitN).map((x) => x.product))
        const prevLong = new Set(prevHeld!.filter((h) => h.w > 0).map((h) => h.product))
        const prevShort = new Set(prevHeld!.filter((h) => h.w < 0).map((h) => h.product))
        const nextHigh = new Set<string>()
        const nextLow = new Set<string>()
        for (const p of enterHigh) nextHigh.add(p)
        for (const p of prevLong) if (keepHigh.has(p)) nextHigh.add(p)
        for (const p of enterLow) nextLow.add(p)
        for (const p of prevShort) if (keepLow.has(p)) nextLow.add(p)
        if (!nextHigh.size) for (const p of enterHigh) nextHigh.add(p)
        if (!nextLow.size) for (const p of enterLow) nextLow.add(p)
        const by = new Map(usable.map((x) => [x.product, x]))
        longSide = [...nextHigh].map((p) => by.get(p)!).filter(Boolean)
        shortSide = [...nextLow].map((p) => by.get(p)!).filter(Boolean)
      } else {
        longSide = usable.slice(-nTake)
        shortSide = usable.slice(0, nTake)
      }
      if (longSide.length < 1 || shortSide.length < 1) return null
      const sign = built.flip ? -1 : 1
      const held: Array<{ product: string; w: number }> = []
      if (csWeight === "abs_score") {
        const lAbs = longSide.map((x) => Math.abs(x.score))
        const sAbs = shortSide.map((x) => Math.abs(x.score))
        const lSum = lAbs.reduce((a, b) => a + b, 0)
        const sSum = sAbs.reduce((a, b) => a + b, 0)
        if (!(lSum > 0) || !(sSum > 0)) {
          for (const x of longSide) held.push({ product: x.product, w: sign / longSide.length })
          for (const x of shortSide) held.push({ product: x.product, w: -sign / shortSide.length })
        } else {
          for (let j = 0; j < longSide.length; j++) held.push({ product: longSide[j].product, w: sign * (lAbs[j] / lSum) })
          for (let j = 0; j < shortSide.length; j++) held.push({ product: shortSide[j].product, w: -sign * (sAbs[j] / sSum) })
        }
      } else {
        for (const x of longSide) held.push({ product: x.product, w: sign / longSide.length })
        for (const x of shortSide) held.push({ product: x.product, w: -sign / shortSide.length })
      }
      return held
    }

    function profitMarkHold(held: Array<{ product: string; w: number }> | null, scale: number): number | null {
      if (!held || !held.length) return null
      let r = 0, nOk = 0
      for (const x of held) {
        if (nextRet[x.product] == null) continue
        r += x.w * nextRet[x.product]
        nOk++
      }
      if (nOk < 2) return null
      return r * scale
    }

    // 利润: carry | carryMom | carryMomBlend | edb* | profitRetBlend
    // Round-3: optional weeklyFri/Mon/Wed rebal + equal|abs_score basket weights; lag/buffer knobs.
    {
      const profitRebal = String((REPORT_FIT as any).profitRebal ?? "daily") as
        | "daily" | "weeklyFri" | "weeklyMon" | "weeklyWed"
      const csWeight = String((REPORT_FIT as any).profitCsWeight ?? "equal") as "equal" | "abs_score"
      const profitLag = Math.max(0, Math.min(5, Number((REPORT_FIT as any).profitLag ?? 0) | 0))
      const enterFrac = (REPORT_FIT as any).profitEnterFrac
      const exitFrac = (REPORT_FIT as any).profitExitFrac
      const enter = enterFrac == null ? null : Number(enterFrac)
      const exit = exitFrac == null ? null : Number(exitFrac)
      const dowP = isoDow(dates[i])
      const kind = String((REPORT_FIT as any).profitKind ?? "carry")

      if (kind === "profitRetBlend" && (REPORT_FIT as any).profitRetBlend?.enabled && (REPORT_FIT as any).profitRetBlend?.legs?.length) {
        const blend = (REPORT_FIT as any).profitRetBlend
        const legs: any[] = blend.legs
        while (profitHoldLegs.length < legs.length) profitHoldLegs.push(null)
        let acc = 0, wsum = 0, ok = 0
        for (let li = 0; li < legs.length; li++) {
          const leg = legs[li]
          const doRebal =
            profitRebal === "daily" ||
            (profitRebal === "weeklyFri" && dowP === 5) ||
            (profitRebal === "weeklyMon" && dowP === 1) ||
            (profitRebal === "weeklyWed" && dowP === 3) ||
            profitHoldLegs[li] == null
          if (doRebal) {
            const lk = String(leg.profitKind ?? "carryMom")
            const cw = (leg.profitCsWeight ?? csWeight) as "equal" | "abs_score"
            const prev = profitHoldLegs[li]
            if (lk === "carryMomBlend") {
              const bMom = profitBuildScores({
                kind: "carryMom", momL: leg.profitMomL, edbL: leg.profitEdbL,
                wE: leg.profitEdbWeight, wMom: leg.profitMomWeight,
                topMom: leg.profitTopFrac, topLvl: leg.profitLevelTopFrac ?? leg.profitTopFrac,
                flip: leg.profitFlip, lag: leg.profitLag ?? profitLag,
              })
              const bLvl = profitBuildScores({
                kind: "carry", momL: leg.profitMomL, edbL: leg.profitEdbL,
                wE: leg.profitEdbWeight, wMom: leg.profitMomWeight,
                topMom: leg.profitTopFrac, topLvl: leg.profitLevelTopFrac ?? leg.profitTopFrac,
                flip: leg.profitFlip, lag: leg.profitLag ?? profitLag,
              })
              const prevMom = prev && prev.kind === "blend" ? prev.mom : null
              const prevLvl = prev && prev.kind === "blend" ? prev.lvl : null
              profitHoldLegs[li] = {
                kind: "blend",
                wMom: Number(leg.profitMomWeight ?? 0.5),
                mom: bMom ? profitHoldFromScores(bMom, cw, enter, exit, prevMom) : null,
                lvl: bLvl ? profitHoldFromScores(bLvl, cw, enter, exit, prevLvl) : null,
              }
            } else {
              const built = profitBuildScores({
                kind: lk, momL: leg.profitMomL, edbL: leg.profitEdbL,
                wE: leg.profitEdbWeight, wMom: leg.profitMomWeight,
                topMom: leg.profitTopFrac, topLvl: leg.profitLevelTopFrac ?? leg.profitTopFrac,
                flip: leg.profitFlip, lag: leg.profitLag ?? profitLag,
              })
              const prevH = prev && prev.kind === "blend" ? null : prev
              profitHoldLegs[li] = built ? profitHoldFromScores(built, cw, enter, exit, prevH) : null
            }
          }
          let rr: number | null = null
          const held = profitHoldLegs[li]
          const sc = Number(leg.profitScale ?? 0.08)
          if (held && held.kind === "blend") {
            const rMom = profitMarkHold(held.mom, sc)
            const rLvl = profitMarkHold(held.lvl, sc)
            const wm = Number(held.wMom ?? 0.5)
            if (rMom != null && rLvl != null) rr = wm * rMom + (1 - wm) * rLvl
            else rr = rMom ?? rLvl
          } else {
            rr = profitMarkHold(held, sc)
          }
          const w = Number(leg.weight ?? 1)
          if (rr != null && Number.isFinite(rr)) { acc += w * rr; wsum += Math.abs(w); ok++ }
        }
        out.report_profit[i + 1] = ok === blend.legs.length && wsum > 0 ? (acc / wsum) * Number(blend.scale ?? 1) : null
      } else {
        const doRebal =
          profitRebal === "daily" ||
          (profitRebal === "weeklyFri" && dowP === 5) ||
          (profitRebal === "weeklyMon" && dowP === 1) ||
          (profitRebal === "weeklyWed" && dowP === 3) ||
          profitHoldSingle == null
        if (doRebal) {
          const cw = csWeight
          const prev = profitHoldSingle
          if (kind === "carryMomBlend") {
            const bMom = profitBuildScores({
              kind: "carryMom",
              momL: (REPORT_FIT as any).profitMomL,
              edbL: (REPORT_FIT as any).profitEdbL,
              wE: (REPORT_FIT as any).profitEdbWeight,
              wMom: (REPORT_FIT as any).profitMomWeight,
              topMom: (REPORT_FIT as any).profitTopFrac,
              topLvl: (REPORT_FIT as any).profitLevelTopFrac ?? (REPORT_FIT as any).profitTopFrac,
              flip: !!(REPORT_FIT as any).profitFlip,
              lag: profitLag,
            })
            const bLvl = profitBuildScores({
              kind: "carry",
              momL: (REPORT_FIT as any).profitMomL,
              edbL: (REPORT_FIT as any).profitEdbL,
              wE: (REPORT_FIT as any).profitEdbWeight,
              wMom: (REPORT_FIT as any).profitMomWeight,
              topMom: (REPORT_FIT as any).profitTopFrac,
              topLvl: (REPORT_FIT as any).profitLevelTopFrac ?? (REPORT_FIT as any).profitTopFrac,
              flip: !!(REPORT_FIT as any).profitFlip,
              lag: profitLag,
            })
            const prevMom = prev && prev.kind === "blend" ? prev.mom : null
            const prevLvl = prev && prev.kind === "blend" ? prev.lvl : null
            profitHoldSingle = {
              kind: "blend",
              wMom: Number((REPORT_FIT as any).profitMomWeight ?? 0.5),
              mom: bMom ? profitHoldFromScores(bMom, cw, enter, exit, prevMom) : null,
              lvl: bLvl ? profitHoldFromScores(bLvl, cw, enter, exit, prevLvl) : null,
            }
          } else {
            const built = profitBuildScores({
              kind,
              momL: (REPORT_FIT as any).profitMomL,
              edbL: (REPORT_FIT as any).profitEdbL,
              wE: (REPORT_FIT as any).profitEdbWeight,
              wMom: (REPORT_FIT as any).profitMomWeight,
              topMom: (REPORT_FIT as any).profitTopFrac,
              topLvl: (REPORT_FIT as any).profitLevelTopFrac ?? (REPORT_FIT as any).profitTopFrac,
              flip: !!(REPORT_FIT as any).profitFlip,
              lag: profitLag,
            })
            const prevH = prev && prev.kind === "blend" ? null : prev
            profitHoldSingle = built ? profitHoldFromScores(built, cw, enter, exit, prevH) : null
          }
        }
        {
          const sc = Number((REPORT_FIT as any).profitScale ?? 0.4)
          const held = profitHoldSingle
          let rr: number | null = null
          if (held && held.kind === "blend") {
            const rMom = profitMarkHold(held.mom, sc)
            const rLvl = profitMarkHold(held.lvl, sc)
            const wm = Number(held.wMom ?? 0.5)
            if (rMom != null && rLvl != null) rr = wm * rMom + (1 - wm) * rLvl
            else rr = rMom ?? rLvl
          } else {
            rr = profitMarkHold(held, sc)
          }
          out.report_profit[i + 1] = rr
        }
      }
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
    warehouse?: string
    profit?: string
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
  const [prices, contracts, warehouse, profit, socialInv, commoditySpot] = await Promise.all([
    loadAksharePrices(lookbackFrom, to),
    loadContractLegs(lookbackFrom, to),
    loadWarehouseReceipts(lookbackFrom, to),
    loadEdbIndustryProfit(lookbackFrom, to),
    loadEdbCommodityInventory(lookbackFrom, to),
    loadEdbCommoditySpot(lookbackFrom, to),
  ])

  const { dates: allDates, panels } = buildPanels(prices, contracts, sector)
  attachFundamentals(allDates, panels, warehouse, profit, socialInv, commoditySpot)
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
      warehouse: "raw_futures_warehouse_receipts_daily (Choice FTREGORDERVOL)",
      spot: "raw_edb_commodity_spot_daily (Choice EDB EMI physical spot)",
      profit: "raw_edb_industry_profit_daily (Choice EDB EMI margins)",
      note:
        USE_WIND_GTJAQH && windTable?.maxDate
          ? `DEBUG overlay: Wind GTJAQH*.WI from data/gtjaqh_closes.csv thru ${windTable.maxDate} (not production).`
          : "CTA-report factors: REPORT_FIT reconstructions (AkShare+EMQuant + Choice 仓单/EDB利润 when available). Wind CSV calibration-only.",
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
  const [prices, contracts, warehouse, profit, socialInv, commoditySpot] = await Promise.all([
    loadAksharePrices(lookbackFrom, to),
    loadContractLegs(lookbackFrom, to),
    loadWarehouseReceipts(lookbackFrom, to),
    loadEdbIndustryProfit(lookbackFrom, to),
    loadEdbCommodityInventory(lookbackFrom, to),
    loadEdbCommoditySpot(lookbackFrom, to),
  ])
  const { dates, panels } = buildPanels(prices, contracts, sector)
  attachFundamentals(dates, panels, warehouse, profit, socialInv, commoditySpot)
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
