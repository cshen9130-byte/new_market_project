/**
 * 2,000 万纸面账户：只交易 MOM「加码」同向，其余空仓。
 * 规则对齐 mom_signal_strategy/_mom_20m_account.py + generate_jiaama_only_report.py。
 */

import {
  decomposeNet,
  emptySleeveFlow,
  lotsPrice,
  rowDecision,
  type HoldingPos,
  type SleeveFlow,
  type SleevePct,
} from "@/lib/ma/quant-vs-subjective-signals"

const CFFEX = new Set(["IH", "IF", "IC", "IM", "MO", "TS", "TF", "T", "TL"])
const NO_NIGHT = new Set(["JD", "LH", "AP", "CJ", "RI", "JR", "LR", "WH", "PM", "RS", "FB", "BB"])

function isCffexProduct(prod: string): boolean {
  return CFFEX.has(prod)
}

function hasNightSession(prod: string): boolean {
  return !isCffexProduct(prod) && !NO_NIGHT.has(prod)
}

export const START_EQUITY = 20_000_000
const BROKER_MARGIN_MULT = 1.1
const MAX_MARGIN_UTIL = 0.5
const TARGET_GROSS_LEV = 2.2
const MAX_NAMES = 8
const RISK_CAP_NAV = 0.012
const COMM_RATE = 0.00012
const SLIP_RATE = 0.00015
const FEE_FLOOR_YUAN = 3
const MIN_LOT_NOTIONAL = 80_000
const VOL_DAYS = 20
const TOP_N_PRODUCTS = 40
const LOOKBACK_SPIKE = 40

export const MULTIPLIER: Record<string, number> = {
  C: 10, CS: 10, WH: 20, PM: 50, RR: 10, RI: 20, JR: 20, LR: 10,
  A: 10, B: 10, M: 10, Y: 10, RM: 10, OI: 10, RS: 10, PK: 10, P: 10,
  SR: 10, CF: 5, CY: 5, AP: 10, CJ: 5, LH: 16, JD: 10,
  LG: 90, SP: 10, OP: 20, BB: 500, FB: 500,
  AU: 1000, AG: 15, PT: 1000, PD: 1000,
  CU: 5, BC: 5, AL: 5, AO: 20, AD: 5, ZN: 5, PB: 5, NI: 1, SN: 1,
  LC: 1, PS: 5, SI: 5,
  I: 100, SF: 5, SM: 5, RB: 10, HC: 10, SS: 5, WR: 10,
  JM: 60, J: 100, ZC: 100, FG: 20,
  SC: 1000, FU: 10, LU: 10, PG: 20, BU: 10, EC: 50,
  TA: 5, EG: 10, PF: 5, PR: 15,
  PL: 20, PP: 5, L: 5,
  BZ: 30, PX: 5, EB: 5,
  RU: 10, BR: 5, NR: 10,
  SA: 20, SH: 30, V: 5, UR: 20, MA: 10,
  IH: 300, IF: 300, IC: 200, IM: 200, MO: 100,
  TS: 20000, TF: 10000, T: 10000, TL: 10000,
}

const MARGIN_RATE: Record<string, number> = {
  AU: 0.16, AG: 0.16, PT: 0.16, PD: 0.16,
  SC: 0.16, FU: 0.12, LU: 0.12, PG: 0.12, BU: 0.12,
  CU: 0.11, AL: 0.11, ZN: 0.11, PB: 0.11, NI: 0.14, SN: 0.14, BC: 0.11, AO: 0.12, AD: 0.12,
  LC: 0.15, PS: 0.14, SI: 0.14,
  I: 0.11, RB: 0.09, HC: 0.09, J: 0.12, JM: 0.12, ZC: 0.12, SF: 0.10, SM: 0.10, SS: 0.10, FG: 0.09,
  IF: 0.12, IH: 0.12, IC: 0.12, IM: 0.12,
  T: 0.02, TF: 0.012, TS: 0.005, TL: 0.035,
  LH: 0.08, JD: 0.08, AP: 0.08, CJ: 0.08,
}

export const SECTOR_MAP: Record<string, string> = {
  C: "农产", CS: "农产", WH: "农产", PM: "农产", RR: "农产", RI: "农产", JR: "农产", LR: "农产",
  A: "农产", B: "农产", M: "农产", Y: "农产", RM: "农产", OI: "农产", RS: "农产", PK: "农产", P: "农产",
  SR: "农产", CF: "农产", CY: "农产", LG: "农产", SP: "农产", OP: "农产",
  AP: "生鲜", CJ: "生鲜", LH: "生鲜", JD: "生鲜",
  AU: "贵金属", AG: "贵金属", PT: "贵金属", PD: "贵金属",
  CU: "有色", BC: "有色", AL: "有色", AO: "有色", AD: "有色", ZN: "有色", PB: "有色", NI: "有色", SN: "有色",
  LC: "新能源", PS: "新能源", SI: "新能源",
  I: "黑色", SF: "黑色", SM: "黑色", RB: "黑色", HC: "黑色", SS: "黑色", WR: "黑色",
  JM: "黑色", J: "黑色", ZC: "黑色", FG: "黑色", BB: "黑色", FB: "黑色",
  SC: "能源化工", FU: "能源化工", LU: "能源化工", PG: "能源化工", BU: "能源化工",
  TA: "能源化工", EG: "能源化工", PF: "能源化工", PR: "能源化工",
  PL: "能源化工", PP: "能源化工", L: "能源化工",
  BZ: "能源化工", PX: "能源化工", EB: "能源化工",
  RU: "能源化工", BR: "能源化工", NR: "能源化工",
  SA: "能源化工", SH: "能源化工", V: "能源化工",
  UR: "能源化工", MA: "能源化工",
  EC: "航运",
  IH: "股指", IF: "股指", IC: "股指", IM: "股指", MO: "股指",
  TS: "国债", TF: "国债", T: "国债", TL: "国债",
}

export const PROD_NAMES: Record<string, string> = {
  C: "玉米", CS: "淀粉", WH: "强麦", PM: "普麦", RR: "粳米", RI: "早籼稻", JR: "粳稻", LR: "晚籼稻",
  A: "黄大豆1号", B: "黄大豆2号", M: "豆粕", Y: "豆油", RM: "菜籽粕", OI: "菜籽油", RS: "油菜籽", PK: "花生", P: "棕榈油",
  SR: "白糖", CF: "棉花", CY: "棉纱", LG: "原木", SP: "纸浆", OP: "双胶纸",
  AP: "苹果", CJ: "红枣", LH: "生猪", JD: "鸡蛋",
  AU: "黄金", AG: "白银", PT: "铂", PD: "钯",
  CU: "沪铜", BC: "国际铜", AL: "沪铝", AO: "氧化铝", AD: "铝合金", ZN: "沪锌", PB: "沪铅", NI: "沪镍", SN: "沪锡",
  LC: "碳酸锂", PS: "多晶硅", SI: "工业硅",
  I: "铁矿石", SF: "硅铁", SM: "锰硅", RB: "螺纹钢", HC: "热卷", SS: "不锈钢", WR: "线材",
  JM: "焦煤", J: "焦炭", ZC: "动力煤", FG: "玻璃", BB: "胶合板", FB: "纤维板",
  SC: "原油", FU: "燃料油", LU: "低硫燃料油", PG: "液化石油气", BU: "沥青",
  TA: "PTA", EG: "乙二醇", PF: "短纤", PR: "瓶片", PL: "丙烯", PP: "聚丙烯", L: "塑料",
  BZ: "纯苯", PX: "对二甲苯", EB: "苯乙烯",
  RU: "天然橡胶", BR: "丁二烯橡胶", NR: "20号胶",
  SA: "纯碱", SH: "烧碱", V: "PVC", UR: "尿素", MA: "甲醇",
  EC: "航运指数",
  IH: "上证50", IF: "沪深300", IC: "中证500", IM: "中证1000", MO: "中证1000期权",
  TS: "2年期国债", TF: "5年期国债", T: "10年期国债", TL: "30年期国债",
}

export const AKSHARE_CODE: Record<string, string> = {
  A: "A0.DCE", AD: "AD0.SHF", AG: "AG0.SHF", AL: "AL0.SHF", AO: "AO0.SHF", AP: "AP0.CZC",
  AU: "AU0.SHF", B: "B0.DCE", BB: "BB0.DCE", BC: "BCM.INE", BR: "BR0.SHF", BU: "BU0.SHF",
  BZ: "BZ0.DCE", C: "C0.DCE", CF: "CF0.CZC", CJ: "CJ0.CZC", CS: "CS0.DCE", CU: "CU0.SHF",
  CY: "CY0.CZC", EB: "EB0.DCE", EC: "ECM.INE", EG: "EG0.DCE", FB: "FB0.DCE", FG: "FG0.CZC",
  FU: "FU0.SHF", HC: "HC0.SHF", I: "I0.DCE", IC: "IC0.CFE", IF: "IF0.CFE", IH: "IH0.CFE",
  IM: "IM0.CFE", J: "J0.DCE", JD: "JD0.DCE", JM: "JM0.DCE", JR: "JR0.CZC", L: "L0.DCE",
  LC: "LCM.GFE", LG: "LG0.DCE", LH: "LH0.DCE", LR: "LR0.CZC", LU: "LUM.INE", M: "M0.DCE",
  MA: "MA0.CZC", NI: "NI0.SHF", NR: "NRM.INE", OI: "OI0.CZC", OP: "OP0.SHF", P: "P0.DCE",
  PB: "PB0.SHF", PD: "PDM.GFE", PF: "PF0.CZC", PG: "PG0.DCE", PK: "PK0.CZC", PL: "PL0.CZC",
  PM: "PM0.CZC", PP: "PP0.DCE", PR: "PR0.CZC", PS: "PSM.GFE", PT: "PTM.GFE", PX: "PX0.CZC",
  RB: "RB0.SHF", RI: "RI0.CZC", RM: "RM0.CZC", RR: "RR0.DCE", RS: "RS0.CZC", RU: "RU0.SHF",
  SA: "SA0.CZC", SC: "SCM.INE", SF: "SF0.CZC", SH: "SH0.CZC", SI: "SIM.GFE", SM: "SM0.CZC",
  SN: "SN0.SHF", SP: "SP0.SHF", SR: "SR0.CZC", SS: "SS0.SHF", TA: "TA0.CZC", T: "T0.CFE",
  TF: "TF0.CFE", TL: "TL0.CFE", TS: "TS0.CFE", UR: "UR0.CZC", V: "V0.DCE", WH: "WH0.CZC",
  WR: "WR0.SHF", Y: "Y0.DCE", ZC: "ZC0.CZC", ZN: "ZN0.SHF",
}

export const CODE_TO_PROD: Record<string, string> = Object.fromEntries(
  Object.entries(AKSHARE_CODE).map(([prod, code]) => [code, prod]),
)

export interface PosBar {
  longMv: number
  shortMv: number
  longLots: number
  shortLots: number
}

export interface MarketBar {
  date: string
  product: string
  ret: number
  close: number
}

export interface DominantBar {
  date: string
  product: string
  contract: string
  px: number
}

export interface ProductSignal {
  date: string
  product: string
  name: string
  sector: string
  qPct: number
  sPct: number
  kind: string
  action: string
  tradeDir: number
}

export interface ContractBar {
  date: string
  product: string
  contract: string
  px: number
  oi: number
  vol: number
}

export interface RolloverEvent {
  date: string
  product: string
  fromContract: string
  toContract: string
}

export interface RollBook {
  contractOn(product: string, dt: string): string
  price(contract: string, dt: string): number
  contractRet(contract: string, start: string, end: string): number | null
}

function normContract(c: string): string {
  return String(c || "").trim().toUpperCase().split(".")[0] || ""
}

export function buildRollBook(bars: ContractBar[], events: RolloverEvent[] = []): RollBook {
  const px = new Map<string, number>()
  const dominant = new Map<string, string>()
  const dates = new Set<string>()
  const ranked = new Map<string, ContractBar>()
  for (const r of bars) {
    const dt = r.date.slice(0, 10)
    const prod = r.product
    const root = normContract(r.contract)
    if (!dt || !prod || !root || !(r.px > 0)) continue
    dates.add(dt)
    px.set(`${dt}|${root}`, r.px)
    const key = `${dt}|${prod}`
    const cur = ranked.get(key)
    if (!cur || r.oi > cur.oi || (r.oi === cur.oi && r.vol > cur.vol)) ranked.set(key, { ...r, date: dt, contract: root })
  }
  for (const [key, r] of ranked) dominant.set(key, r.contract)
  const cal = [...dates].sort()
  const last = new Map<string, string>()
  for (const dt of cal) {
    for (const [p, c] of last) {
      const key = `${dt}|${p}`
      if (!dominant.has(key)) dominant.set(key, c)
    }
    for (const [key, c] of dominant) {
      if (key.startsWith(`${dt}|`)) last.set(key.slice(dt.length + 1), c)
    }
  }
  for (const ev of events) {
    const dt = ev.date.slice(0, 10)
    const prod = ev.product.trim().toUpperCase()
    const to = normContract(ev.toContract)
    if (dt && prod && to) dominant.set(`${dt}|${prod}`, to)
  }
  const floorDom = (product: string, dt: string): string => {
    const exact = dominant.get(`${dt}|${product}`)
    if (exact) return exact
    const idx = floorIndex(cal, dt)
    for (let i = idx; i >= 0; i--) {
      const v = dominant.get(`${cal[i]}|${product}`)
      if (v) return v
    }
    return ""
  }
  return {
    contractOn(product, dt) {
      return floorDom(product, dt.slice(0, 10))
    },
    price(contract, dt) {
      const root = normContract(contract)
      const day = dt.slice(0, 10)
      return px.get(`${day}|${root}`) || 0
    },
    contractRet(contract, start, end) {
      const a = this.price(contract, start)
      const b = this.price(contract, end)
      return a > 0 && b > 0 ? b / a - 1 : null
    },
  }
}

function nextMarketDate(dates: string[], dt: string): string {
  let lo = 0
  let hi = dates.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (dates[mid] <= dt) lo = mid + 1
    else hi = mid
  }
  return lo < dates.length ? dates[lo] : ""
}

export interface BookPos {
  product: string
  name: string
  sector: string
  action: string
  kind: string
  dir: number
  lots: number
  price: number
  mult: number
  notional: number
  margin: number
  sigma: number
  qPct: number
  sPct: number
  contract: string
  markDate?: string
  pnl?: number
  ret?: number
  openedAt: string
  openedSession: "夜盘" | "日盘"
  entryPrice: number
  entrySignalDate: string
}

export interface DailyPoint {
  signalDate: string
  returnDate: string
  equity: number
  nav: number
  pnlGross: number
  commission: number
  slippage: number
  cost: number
  pnlNet: number
  ret: number
  dd: number
  n: number
  nSignals: number
  grossNotional: number
  margin: number
  marginUtil: number
}

export interface HoldingRow {
  signalDate: string
  holdDate: string
  product: string
  name: string
  sector: string
  action: string
  kind: string
  dir: "多" | "空"
  lots: number
  price: number
  contract: string
  notional: number
  margin: number
  qPct: number
  sPct: number
  pnl: number
  ret: number
  openedAt: string
  openedSession: "夜盘" | "日盘"
  entryPrice: number
  entrySignalDate: string
  cumPnl?: number
}

export interface TradeRow {
  signalDate: string
  tradeDate: string
  product: string
  name: string
  sector: string
  action: string
  side: string
  offset: string
  bs: string
  oldLots: number
  newLots: number
  dLots: number
  price: number
  contract: string
  fromContract: string
  toContract: string
  notional: number
  commission: number
  slippage: number
  cost: number
  session: "夜盘" | "日盘"
  openAt: string
  openHint: string
  status: "待执行" | "已成交"
  rollSpread?: number
}

export interface AccountStats {
  start: number
  end: number
  pnl: number
  nav: number
  cagr: number | null
  vol: number | null
  sharpe: number | null
  maxdd: number | null
  hit: number | null
  n: number
  avgNames: number
  totalCost: number
}

export interface JiaamaAccount {
  daily: DailyPoint[]
  holds: HoldingRow[]
  trades: TradeRow[]
  pendingTrades: TradeRow[]
  pendingBook: BookPos[]
  lastBook: BookPos[]
  stats: AccountStats
}

function r1(n: number): number {
  return Math.round(n * 10) / 10
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

export function multiplier(prod: string): number {
  return MULTIPLIER[prod] ?? 10
}

export function marginRate(prod: string): number {
  return (MARGIN_RATE[prod] ?? 0.1) * BROKER_MARGIN_MULT
}

export function getSector(prod: string): string {
  return SECTOR_MAP[prod] ?? "其他"
}

export function prodName(prod: string): string {
  return PROD_NAMES[prod] ?? prod
}

function emptyPos(): HoldingPos {
  return { longMv: 0, shortMv: 0, longLots: 0, shortLots: 0 }
}

function posKey(dt: string, sleeve: string, prod: string): string {
  return `${dt}|${sleeve}|${prod}`
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

export function zeroRolloverSpikes(rets: number[]): number[] {
  if (rets.length < 2) return [...rets]
  const out = [...rets]
  for (let i = LOOKBACK_SPIKE; i < rets.length; i++) {
    const win = rets.slice(i - LOOKBACK_SPIKE, i).map(Math.abs).sort((a, b) => a - b)
    const med = win[Math.floor(win.length / 2)]
    const devs = win.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
    const mad = devs[Math.floor(devs.length / 2)]
    const thr = Math.max(0.06, med + 12 * mad * 1.4826)
    if (Math.abs(rets[i]) > thr) out[i] = 0
  }
  return out
}

export function floorIndex(arr: string[], target: string): number {
  let lo = 0
  let hi = arr.length - 1
  let idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= target) {
      idx = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return idx
}

export function nextWeekday(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  for (let i = 0; i < 8; i++) {
    dt.setUTCDate(dt.getUTCDate() + 1)
    const week = dt.getUTCDay()
    if (week !== 0 && week !== 6) {
      return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`
    }
  }
  return ymd
}

export function orderSession(product: string, signalDate: string, tradeDate: string): {
  session: "夜盘" | "日盘"
  openAt: string
  openHint: string
} {
  if (isCffexProduct(product)) {
    return {
      session: "日盘",
      openAt: `${tradeDate} 09:30`,
      openHint: "股指/国债无夜盘，下一交易日 09:30 开盘",
    }
  }
  if (hasNightSession(product)) {
    return {
      session: "夜盘",
      openAt: `${signalDate} 21:00`,
      openHint: "有夜盘：信号日当晚 21:00 即可开/平",
    }
  }
  return {
    session: "日盘",
    openAt: `${tradeDate} 09:00`,
    openHint: "无夜盘：下一交易日 09:00 开盘",
  }
}

function tradeCost(notionalAbs: number, lotsAbs: number): { comm: number; slip: number } {
  if (notionalAbs <= 0 || lotsAbs <= 0) return { comm: 0, slip: 0 }
  return {
    comm: Math.max(notionalAbs * COMM_RATE, lotsAbs * FEE_FLOOR_YUAN),
    slip: notionalAbs * SLIP_RATE,
  }
}

function consensusDir(kind: string, qPct: number, sPct: number): number {
  if (kind === "consensus_long") return 1
  if (kind === "consensus_short") return -1
  if (kind === "crowded") return qPct > 0 ? 1 : -1
  if ((qPct > 0 && sPct > 0) || (qPct < 0 && sPct < 0)) return qPct + sPct > 0 ? 1 : -1
  return 0
}

function sleevePct(risk: number): SleevePct {
  return { riskPctGroup: risk, equityPctGroup: 0, riskPctBook: 0, equityPctBook: 0 }
}

function sleeveFromDecomp(
  d: ReturnType<typeof decomposeNet>,
  trade5d: number,
): SleeveFlow {
  return {
    ...emptySleeveFlow(),
    trade1d: d.trade,
    trade5d,
    price1d: d.price,
    prevNet: d.prevNet,
    todayNet: d.todayNet,
  }
}

export function buildJiaamaSignals(
  posRows: { date: string; sleeve: string; product: string; longMv: number; shortMv: number; longLots: number; shortLots: number }[],
  mktDates: string[],
  cleanByProd: Map<string, number[]>,
): ProductSignal[] {
  const posMap = new Map<string, HoldingPos>()
  const dates = new Set<string>()
  const products = new Set<string>()
  for (const r of posRows) {
    const dt = r.date.slice(0, 10)
    const prod = r.product
    if (!dt || !prod) continue
    dates.add(dt)
    products.add(prod)
    posMap.set(posKey(dt, r.sleeve, prod), {
      longMv: r.longMv,
      shortMv: r.shortMv,
      longLots: r.longLots,
      shortLots: r.shortLots,
    })
  }
  const cal = [...dates].sort()
  const prods = [...products].sort()

  const sigmaOn = (prod: string, asOf: string): number => {
    const clean = cleanByProd.get(prod)
    if (!clean) return 0
    const idx = floorIndex(mktDates, asOf)
    if (idx < 2) return 0
    const start = Math.max(0, idx - VOL_DAYS)
    const window = clean.slice(start, idx).filter((x) => x !== 0)
    return stdDev(window)
  }

  const out: ProductSignal[] = []
  for (let di = 1; di < cal.length; di++) {
    const dt = cal[di]
    const prev = cal[di - 1]
    const look5 = cal[Math.max(0, di - 5)]
    const dayProds = prods.filter((p) => posMap.has(posKey(dt, "quant", p)) || posMap.has(posKey(dt, "subjective", p)))
    const sigToday = new Map<string, number>()
    const rawSig: number[] = []
    for (const p of dayProds) {
      const s = sigmaOn(p, dt)
      sigToday.set(p, s)
      if (s > 0) rawSig.push(s)
    }
    rawSig.sort((a, b) => a - b)
    const med = rawSig.length ? rawSig[Math.floor(rawSig.length / 2)] : 0

    let qAbs = 0
    let sAbs = 0
    const nets = new Map<string, { q: HoldingPos; s: HoldingPos; qNet: number; sNet: number; qRisk: number; sRisk: number }>()
    for (const p of dayProds) {
      const sig = (sigToday.get(p) || 0) > 0 ? sigToday.get(p)! : med
      const q = posMap.get(posKey(dt, "quant", p)) ?? emptyPos()
      const s = posMap.get(posKey(dt, "subjective", p)) ?? emptyPos()
      const qNet = q.longMv - q.shortMv
      const sNet = s.longMv - s.shortMv
      const qRisk = sig * qNet
      const sRisk = sig * sNet
      nets.set(p, { q, s, qNet, sNet, qRisk, sRisk })
      qAbs += Math.abs(qRisk)
      sAbs += Math.abs(sRisk)
    }

    const scored = [...nets.entries()].map(([p, n]) => ({
      p,
      qPct: qAbs > 0 ? (n.qRisk / qAbs) * 100 : 0,
      sPct: sAbs > 0 ? (n.sRisk / sAbs) * 100 : 0,
      ...n,
    }))
    scored.sort((a, b) => Math.abs(b.qPct) + Math.abs(b.sPct) - (Math.abs(a.qPct) + Math.abs(a.sPct)))
    const top = scored.slice(0, TOP_N_PRODUCTS)

    for (const row of top) {
      const qPrev = posMap.get(posKey(prev, "quant", row.p)) ?? emptyPos()
      const sPrev = posMap.get(posKey(prev, "subjective", row.p)) ?? emptyPos()
      const q5 = posMap.get(posKey(look5, "quant", row.p)) ?? emptyPos()
      const s5 = posMap.get(posKey(look5, "subjective", row.p)) ?? emptyPos()
      const qd = decomposeNet(qPrev, row.q)
      const sd = decomposeNet(sPrev, row.s)
      const qPx = lotsPrice(row.q) || lotsPrice(q5)
      const sPx = lotsPrice(row.s) || lotsPrice(s5)
      const qTrade5 = ((row.q.longLots - row.q.shortLots) - (q5.longLots - q5.shortLots)) * qPx
      const sTrade5 = ((row.s.longLots - row.s.shortLots) - (s5.longLots - s5.shortLots)) * sPx
      const qPct = r1(row.qPct)
      const sPct = r1(row.sPct)
      const decision = rowDecision(
        sleevePct(qPct),
        sleevePct(sPct),
        "risk",
        { quant: sleeveFromDecomp(qd, qTrade5), subjective: sleeveFromDecomp(sd, sTrade5) },
      )
      if (decision.action === "中性") continue
      const tradeDir = consensusDir(decision.kind, qPct, sPct)
      out.push({
        date: dt,
        product: row.p,
        name: prodName(row.p),
        sector: getSector(row.p),
        qPct,
        sPct,
        kind: decision.kind,
        action: decision.action,
        tradeDir,
      })
    }
  }
  return out
}

function priceOn(close: Map<string, Map<string, number>>, dt: string, prod: string, dates: string[]): number {
  const exact = close.get(dt)?.get(prod)
  if (exact && exact > 0) return exact
  const idx = floorIndex(dates, dt)
  for (let i = idx; i >= 0; i--) {
    const v = close.get(dates[i])?.get(prod)
    if (v && v > 0) return v
  }
  return 0
}

function sigmaOnClean(clean: Map<string, number[]>, dates: string[], dt: string, prod: string): number {
  const arr = clean.get(prod)
  if (!arr) return 0
  const idx = floorIndex(dates, dt)
  if (idx < 2) return 0
  const start = Math.max(0, idx - VOL_DAYS)
  return stdDev(arr.slice(start, idx).filter((x) => x !== 0))
}

function retOn(rets: Map<string, Map<string, number>>, dt: string, prod: string): number | null {
  const v = rets.get(dt)?.get(prod)
  return v == null || !Number.isFinite(v) ? null : v
}

function sizeBook(
  targets: { product: string; name: string; sector: string; action: string; kind: string; dir: number; qPct: number; sPct: number; strength: number }[],
  equity: number,
  close: Map<string, Map<string, number>>,
  clean: Map<string, number[]>,
  mktDates: string[],
  asOf: string,
  roll: RollBook,
): Map<string, BookPos> {
  const raw = new Map<string, BookPos>()
  if (equity <= 0 || !targets.length) return raw
  const ranked = [...targets].sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength)).slice(0, MAX_NAMES)
  const budget = (equity * TARGET_GROSS_LEV) / ranked.length
  for (const t of ranked) {
    const px = priceOn(close, asOf, t.product, mktDates)
    const mult = multiplier(t.product)
    if (px <= 0 || mult <= 0) continue
    const point = px * mult
    const sigma = sigmaOnClean(clean, mktDates, asOf, t.product)
    let notional = budget
    if (sigma > 1e-6) notional = Math.min(notional, (equity * RISK_CAP_NAV) / sigma)
    let lots = Math.round(notional / point)
    if (lots <= 0 || (point < MIN_LOT_NOTIONAL && lots * point < MIN_LOT_NOTIONAL)) {
      if (point <= equity * 0.08) lots = 1
      else continue
    }
    const signed = lots * (t.dir > 0 ? 1 : -1)
    raw.set(t.product, {
      product: t.product,
      name: t.name,
      sector: t.sector,
      action: t.action,
      kind: t.kind,
      dir: t.dir,
      lots: signed,
      price: px,
      mult,
      notional: Math.abs(signed) * point,
      margin: Math.abs(signed) * point * marginRate(t.product),
      sigma,
      qPct: t.qPct,
      sPct: t.sPct,
      contract: roll.contractOn(t.product, asOf),
      openedAt: "",
      openedSession: "日盘",
      entryPrice: px,
      entrySignalDate: asOf,
    })
  }
  const margin = [...raw.values()].reduce((s, v) => s + v.margin, 0)
  const cap = equity * MAX_MARGIN_UTIL
  if (margin > cap && cap > 0) {
    const scale = cap / margin
    for (const [p, v] of [...raw.entries()]) {
      const lots = Math.trunc(Math.abs(v.lots) * scale)
      if (lots <= 0) {
        raw.delete(p)
        continue
      }
      const signed = lots * (v.lots > 0 ? 1 : -1)
      const point = v.price * v.mult
      v.lots = signed
      v.notional = Math.abs(signed) * point
      v.margin = Math.abs(signed) * point * marginRate(p)
    }
  }
  return raw
}

function sideOf(oldLots: number, newLots: number): { side: string; offset: string; bs: string } {
  if (newLots === 0) {
    return {
      side: "平仓",
      offset: "平仓",
      bs: oldLots > 0 ? "卖出" : "买入",
    }
  }
  if (oldLots === 0) {
    return {
      side: "开/加",
      offset: "开仓",
      bs: newLots > 0 ? "买入" : "卖出",
    }
  }
  if (oldLots * newLots > 0 && Math.abs(newLots) > Math.abs(oldLots)) {
    return {
      side: "开/加",
      offset: "加仓",
      bs: newLots > 0 ? "买入" : "卖出",
    }
  }
  if (oldLots * newLots > 0) {
    return {
      side: "减",
      offset: "减仓",
      bs: oldLots > 0 ? "卖出" : "买入",
    }
  }
  return {
    side: "反手/平",
    offset: "反手",
    bs: newLots > 0 ? "买入" : "卖出",
  }
}

function makeTrade(
  signalDate: string,
  tradeDate: string,
  product: string,
  meta: { name: string; sector: string; action: string },
  oldLots: number,
  newLots: number,
  price: number,
  contract: string,
  fromContract: string,
  status: "待执行" | "已成交",
): TradeRow | null {
  const dLots = newLots - oldLots
  if (dLots === 0 || price <= 0) return null
  const notion = Math.abs(dLots) * price * multiplier(product)
  const { comm, slip } = tradeCost(notion, Math.abs(dLots))
  const { side, offset, bs } = sideOf(oldLots, newLots)
  const sess = orderSession(product, signalDate, tradeDate)
  return {
    signalDate,
    tradeDate,
    product,
    name: meta.name,
    sector: meta.sector,
    action: meta.action,
    side,
    offset,
    bs,
    oldLots,
    newLots,
    dLots,
    price,
    contract: contract || fromContract,
    fromContract,
    toContract: contract || fromContract,
    notional: notion,
    commission: comm,
    slippage: slip,
    cost: comm + slip,
    session: sess.session,
    openAt: sess.openAt,
    openHint: sess.openHint,
    status,
  }
}

function targetsFromSignals(rows: ProductSignal[]) {
  const targets: { product: string; name: string; sector: string; action: string; kind: string; dir: number; qPct: number; sPct: number; strength: number }[] = []
  for (const r of rows) {
    if (r.action !== "加码") continue
    const dir = consensusDir(r.kind, r.qPct, r.sPct)
    if (dir === 0) continue
    targets.push({
      product: r.product,
      name: r.name,
      sector: r.sector,
      action: r.action,
      kind: r.kind,
      dir,
      qPct: r.qPct,
      sPct: r.sPct,
      strength: Math.abs(r.qPct) + Math.abs(r.sPct),
    })
  }
  return targets
}

function bookToArray(book: Map<string, BookPos>): BookPos[] {
  return [...book.values()].sort((a, b) => Math.abs(b.notional) - Math.abs(a.notional))
}

function stampEntries(
  prev: Map<string, BookPos>,
  book: Map<string, BookPos>,
  signalDate: string,
  tradeDate: string,
  dayTrades: TradeRow[],
) {
  const pxByProd = new Map(dayTrades.map((t) => [t.product, t.price]))
  for (const [p, pos] of book) {
    const old = prev.get(p)
    const sameDir = !!old && old.lots * pos.lots > 0 && old.openedAt
    if (sameDir && old) {
      pos.openedAt = old.openedAt
      pos.openedSession = old.openedSession
      pos.entryPrice = old.entryPrice
      pos.entrySignalDate = old.entrySignalDate
      continue
    }
    const sess = orderSession(p, signalDate, tradeDate)
    pos.openedAt = sess.openAt
    pos.openedSession = sess.session
    pos.entryPrice = pxByProd.get(p) || pos.price
    pos.entrySignalDate = signalDate
  }
}

function tradesBetween(
  prev: Map<string, BookPos>,
  next: Map<string, BookPos>,
  signalDate: string,
  tradeDate: string,
  close: Map<string, Map<string, number>>,
  mktDates: string[],
  roll: RollBook,
  status: "待执行" | "已成交",
): { trades: TradeRow[]; comm: number; slip: number; nRolls: number } {
  const names = new Set([...prev.keys(), ...next.keys()])
  const out: TradeRow[] = []
  let comm = 0
  let slip = 0
  let nRolls = 0
  for (const p of names) {
    const oldPos = prev.get(p)
    const newPos = next.get(p)
    const oldLots = oldPos?.lots ?? 0
    const newLots = newPos?.lots ?? 0
    const oldC = oldPos?.contract || roll.contractOn(p, signalDate)
    let newC = roll.contractOn(p, tradeDate) || roll.contractOn(p, signalDate) || oldC
    if (newLots && newC && next.has(p)) next.get(p)!.contract = newC
    const rolled = !!(oldLots && newLots && oldC && newC && oldC !== newC)
    const meta = {
      name: newPos?.name || oldPos?.name || prodName(p),
      sector: newPos?.sector || oldPos?.sector || getSector(p),
      action: newPos?.action || oldPos?.action || (newLots === 0 ? "平仓" : "加码"),
    }
    if (rolled) {
      const pxOld = roll.price(oldC, tradeDate) || priceOn(close, tradeDate, p, mktDates) || priceOn(close, signalDate, p, mktDates)
      const pxNew = roll.price(newC, tradeDate) || pxOld
      const costOld = pxOld > 0 ? tradeCost(Math.abs(oldLots) * pxOld * multiplier(p), Math.abs(oldLots)) : { comm: 0, slip: 0 }
      const costNew = pxNew > 0 ? tradeCost(Math.abs(newLots) * pxNew * multiplier(p), Math.abs(newLots)) : { comm: 0, slip: 0 }
      comm += costOld.comm + costNew.comm
      slip += costOld.slip + costNew.slip
      if (pxNew > 0) {
        nRolls += 1
        const sess = orderSession(p, signalDate, tradeDate)
        const notion = (pxOld > 0 ? Math.abs(oldLots) * pxOld : 0) + Math.abs(newLots) * pxNew
        out.push({
          signalDate,
          tradeDate,
          product: p,
          name: meta.name,
          sector: meta.sector,
          action: meta.action,
          side: "移仓",
          offset: "移仓",
          bs: "移仓",
          oldLots,
          newLots,
          dLots: newLots - oldLots,
          price: pxNew,
          contract: newC,
          fromContract: oldC,
          toContract: newC,
          notional: notion * multiplier(p),
          commission: costOld.comm + costNew.comm,
          slippage: costOld.slip + costNew.slip,
          cost: costOld.comm + costOld.slip + costNew.comm + costNew.slip,
          session: sess.session,
          openAt: sess.openAt,
          openHint: `主力换月 ${oldC}→${newC}，旧约平、新约开`,
          status,
          rollSpread: pxOld > 0 ? pxNew - pxOld : 0,
        })
      }
      continue
    }
    if (newLots && next.has(p)) next.get(p)!.contract = newC || oldC
    const px = (newC && roll.price(newC, tradeDate))
      || (oldC && roll.price(oldC, tradeDate))
      || priceOn(close, tradeDate, p, mktDates)
      || priceOn(close, signalDate, p, mktDates)
      || newPos?.price
      || oldPos?.price
      || 0
    const t = makeTrade(signalDate, tradeDate, p, meta, oldLots, newLots, px, newC || oldC, oldC, status)
    if (t) {
      comm += t.commission
      slip += t.slippage
      out.push(t)
    }
  }
  return {
    trades: out.sort((a, b) => Math.abs(b.notional) - Math.abs(a.notional)),
    comm,
    slip,
    nRolls,
  }
}

function emptyStats(): AccountStats {
  return {
    start: START_EQUITY,
    end: START_EQUITY,
    pnl: 0,
    nav: 1,
    cagr: null,
    vol: null,
    sharpe: null,
    maxdd: null,
    hit: null,
    n: 0,
    avgNames: 0,
    totalCost: 0,
  }
}

export function accountStats(daily: DailyPoint[]): AccountStats {
  if (!daily.length) return emptyStats()
  const rets = daily.map((d) => d.ret)
  const n = rets.length
  const years = n / 252
  const start = START_EQUITY
  const end = daily[daily.length - 1].equity
  const mean = rets.reduce((s, x) => s + x, 0) / n
  const vol = n > 1 ? stdDev(rets) * Math.sqrt(252) : null
  const sharpe = vol && vol > 0 ? (mean / (vol / Math.sqrt(252))) * Math.sqrt(252) : null
  const maxdd = Math.min(...daily.map((d) => d.dd))
  const cagr = years > 0 && end > 0 ? (end / start) ** (1 / years) - 1 : null
  return {
    start,
    end,
    pnl: end - start,
    nav: end / start,
    cagr,
    vol,
    sharpe,
    maxdd,
    hit: daily.filter((d) => d.pnlNet > 0).length / n,
    n,
    avgNames: daily.reduce((s, d) => s + d.n, 0) / n,
    totalCost: daily.reduce((s, d) => s + d.cost, 0),
  }
}

export function runJiaamaAccount(
  signals: ProductSignal[],
  mktDates: string[],
  close: Map<string, Map<string, number>>,
  cleanRets: Map<string, Map<string, number>>,
  cleanByProd: Map<string, number[]>,
  roll: RollBook,
): JiaamaAccount {
  const byDate = new Map<string, ProductSignal[]>()
  for (const s of signals) {
    const list = byDate.get(s.date) ?? []
    list.push(s)
    byDate.set(s.date, list)
  }
  const signalDates = [...byDate.keys()].sort()
  let equity = START_EQUITY
  let prev = new Map<string, BookPos>()
  const daily: DailyPoint[] = []
  const holds: HoldingRow[] = []
  const trades: TradeRow[] = []
  let lastBook = new Map<string, BookPos>()
  let pendingBook = new Map<string, BookPos>()
  let pendingTrades: TradeRow[] = []

  for (const dt of signalDates) {
    const nxt = nextMarketDate(mktDates, dt)
    const targets = targetsFromSignals(byDate.get(dt) ?? [])
    const book = sizeBook(targets, equity, close, cleanByProd, mktDates, dt, roll)
    for (const [p, pos] of book) {
      const c = roll.contractOn(p, nxt || dt) || pos.contract
      if (c) pos.contract = c
    }

    if (!nxt) {
      const tradeDate = nextWeekday(dt)
      const pending = tradesBetween(prev, book, dt, tradeDate, close, mktDates, roll, "待执行")
      pendingTrades = pending.trades
      stampEntries(prev, book, dt, tradeDate, pendingTrades)
      pendingBook = book
      lastBook = prev
      break
    }

    const day = tradesBetween(prev, book, dt, nxt, close, mktDates, roll, "已成交")
    stampEntries(prev, book, dt, nxt, day.trades)
    trades.push(...day.trades)
    const comm = day.comm
    const slip = day.slip

    let gross = 0
    let nLive = 0
    for (const [p, pos] of book) {
      const held = pos.contract || roll.contractOn(p, nxt)
      const prevC = prev.get(p)?.contract || held
      const markFrom = prev.get(p)?.markDate || dt
      let r = prevC ? roll.contractRet(prevC, markFrom, nxt) : null
      if (r == null) r = retOn(cleanRets, nxt, p)
      if (r == null) continue
      let px = pos.price || priceOn(close, nxt, p, mktDates)
      if (held) px = roll.price(held, nxt) || roll.price(prevC, nxt) || px
      let notion = Math.abs(pos.lots) * (priceOn(close, nxt, p, mktDates) || px) * pos.mult
      if (held && roll.price(held, nxt)) notion = Math.abs(pos.lots) * roll.price(held, nxt) * pos.mult
      const pnl = (pos.lots > 0 ? 1 : -1) * notion * r
      pos.pnl = pnl
      pos.ret = r
      pos.notional = notion
      pos.margin = notion * marginRate(p)
      pos.price = px
      pos.contract = held || prevC
      pos.markDate = nxt
      gross += pnl
      nLive += 1
      holds.push({
        signalDate: dt,
        holdDate: nxt,
        product: p,
        name: pos.name,
        sector: pos.sector,
        action: pos.action,
        kind: pos.kind,
        dir: pos.lots > 0 ? "多" : "空",
        lots: pos.lots,
        price: px,
        contract: pos.contract,
        notional: notion,
        margin: pos.margin,
        qPct: pos.qPct,
        sPct: pos.sPct,
        pnl,
        ret: r,
        openedAt: pos.openedAt,
        openedSession: pos.openedSession,
        entryPrice: pos.entryPrice,
        entrySignalDate: pos.entrySignalDate,
      })
    }

    const cost = comm + slip
    const net = gross - cost
    const prevEq = equity
    equity = equity + net
    daily.push({
      signalDate: dt,
      returnDate: nxt,
      equity,
      nav: equity / START_EQUITY,
      pnlGross: gross,
      commission: comm,
      slippage: slip,
      cost,
      pnlNet: net,
      ret: prevEq > 0 ? net / prevEq : 0,
      dd: 0,
      n: nLive,
      nSignals: targets.length,
      grossNotional: [...book.values()].reduce((s, v) => s + Math.abs(v.notional), 0),
      margin: [...book.values()].reduce((s, v) => s + v.margin, 0),
      marginUtil: equity > 0 ? [...book.values()].reduce((s, v) => s + v.margin, 0) / equity : 0,
    })
    prev = book
    lastBook = book
  }

  let peak = START_EQUITY
  for (const d of daily) {
    peak = Math.max(peak, d.equity)
    d.dd = peak > 0 ? d.equity / peak - 1 : 0
    d.nav = d.equity / START_EQUITY
    d.equity = r2(d.equity)
    d.nav = r2(d.nav * 10000) / 10000
    d.pnlNet = r2(d.pnlNet)
    d.pnlGross = r2(d.pnlGross)
    d.cost = r2(d.cost)
    d.ret = r2(d.ret * 10000) / 10000
    d.dd = r2(d.dd * 10000) / 10000
  }

  return {
    daily,
    holds,
    trades,
    pendingTrades,
    pendingBook: bookToArray(pendingBook),
    lastBook: bookToArray(lastBook),
    stats: accountStats(daily),
  }
}

export function holdingsOn(holds: HoldingRow[], date: string): HoldingRow[] {
  if (!holds.length) return []
  const dates = [...new Set(holds.map((h) => h.holdDate))].sort()
  const idx = floorIndex(dates, date)
  if (idx < 0) return []
  const holdDate = dates[idx]
  return holds
    .filter((h) => h.holdDate === holdDate)
    .sort((a, b) => Math.abs(b.notional) - Math.abs(a.notional))
}

function markToEntry(h: { lots: number; dir?: string; price: number; entryPrice?: number; notional: number }): number {
  const entry = h.entryPrice ?? 0
  const px = h.price
  if (!(entry > 0) || !(px > 0) || !(h.notional > 0)) return 0
  const sign = h.lots < 0 || h.dir === "空" ? -1 : 1
  return sign * h.notional * (px - entry) / px
}

export function withCumPnl<T extends HoldingRow>(live: T[], history: HoldingRow[]): T[] {
  return live.map((h) => {
    const streak = history.filter((x) =>
      x.product === h.product
      && x.entrySignalDate === h.entrySignalDate
      && x.holdDate <= h.holdDate,
    )
    const summed = streak.reduce((s, x) => s + x.pnl, 0)
    const marked = markToEntry(h)
    const cumPnl = streak.length ? summed : marked
    return { ...h, cumPnl }
  })
}
