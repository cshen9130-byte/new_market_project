import { query } from "@/lib/db"
import { PROD_SECTOR } from "@/lib/ma/prod-sector"
import {
  BOOK_CAP_MIN,
  MV_MIN,
  PRODUCT_SOFT,
  SECTOR_SOFT,
  asDate,
  portfolioVar95,
  productSector,
  shapleyDriver,
  type DriverKind,
  type VarProduct,
} from "@/lib/ma/var-mcr-policy"
import {
  MATURE_MIN_PRODUCTS,
  attachBookState,
  classifyRegimeFlags,
  driverLabelFor,
  episodeWindowIndices,
  firstProductText,
  formatMdDate,
  formatSharePct,
  formatWan,
  prodLabel,
  prodShortName,
  regimeThresholds,
  sectorLabel,
  type BookDayState,
  type DailyEventInput,
  type EventTableBlock,
  type EventTableRow,
  type EventTablesPayload,
  type RegimeFlags,
  type RegimeMetrics,
} from "@/lib/ma/var-mcr-event-table"
import { getPrefix } from "@/lib/server/prod-utils"

export const ACCOUNT_FILTER = `
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
         AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
         AND TRIM("账户"::text) NOT LIKE '%国信%'
         AND TRIM("账户"::text) <> '665300200077'
         AND UPPER(TRIM("合约")) !~ '[0-9][CP][0-9]'
         AND TRIM("合约") NOT LIKE '%-%-%'`

const Z95 = 1.6449

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

function toNum(value: unknown): number {
  if (value == null) return 0
  const n = parseFloat(String(value).replace(/[,%\s]/g, ""))
  return Number.isFinite(n) ? n : 0
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
  for (let i = 0; i < n; i += 1) {
    const xi = x[i] - mx, yi = y[i] - my
    num += xi * yi; sx += xi * xi; sy += yi * yi
  }
  const denom = Math.sqrt(sx * sy)
  return denom < 1e-10 ? 0 : num / denom
}

function zeroRolloverSpikes(rets: number[]): number[] {
  if (rets.length < 2) return [...rets]
  const MIN_THRESHOLD = 0.06, K = 12, LOOKBACK = 40
  const out = [...rets]
  for (let i = LOOKBACK; i < rets.length; i += 1) {
    const win = rets.slice(i - LOOKBACK, i).map(Math.abs).sort((a, b) => a - b)
    const med = win[Math.floor(win.length / 2)]
    const devs = win.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
    const mad = devs[Math.floor(devs.length / 2)]
    const thr = Math.max(MIN_THRESHOLD, med + K * mad * 1.4826)
    if (Math.abs(rets[i]) > thr) out[i] = 0
  }
  return out
}

function floorIndex(arr: string[], target: string): number {
  let lo = 0, hi = arr.length - 1, idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= target) { idx = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return idx
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const xs = [...values].sort((a, b) => a - b)
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

function corrKey(a: string, b: string): string {
  return `${a}\u0000${b}`
}

type MarketPack = {
  dates: string[]
  pctMap: Map<string, Map<string, number>>
  cleanPctByCode: Map<string, number[]>
  spikeByCode: Map<string, boolean[]>
  volume: Map<string, Array<number | null>>
  open: Map<string, Array<number | null>>
  close: Map<string, Array<number | null>>
  settle: Map<string, Array<number | null>>
}

async function loadMarket(codes: string[]): Promise<MarketPack> {
  const empty: MarketPack = {
    dates: [], pctMap: new Map(), cleanPctByCode: new Map(), spikeByCode: new Map(),
    volume: new Map(), open: new Map(), close: new Map(), settle: new Map(),
  }
  if (codes.length === 0) return empty
  const rows = await query<{
    date: string; code: string; pct: string | null; volume: string | null
    open: string | null; close: string | null; settle: string | null
  }>(
    `SELECT trade_date::text AS date, code,
            pct_change::text AS pct, volume::text AS volume,
            open::text AS open, close::text AS close, clear::text AS settle
     FROM raw_akshare_futures_daily
     WHERE code = ANY($1)
     ORDER BY trade_date`,
    [codes],
  )
  const pctMap = new Map<string, Map<string, number>>()
  const volMap = new Map<string, Map<string, number>>()
  const openMap = new Map<string, Map<string, number>>()
  const closeMap = new Map<string, Map<string, number>>()
  const settleMap = new Map<string, Map<string, number>>()
  const dateSet = new Set<string>()
  for (const row of rows) {
    const date = asDate(row.date)
    if (!date) continue
    dateSet.add(date)
    if (row.pct != null) {
      if (!pctMap.has(row.code)) pctMap.set(row.code, new Map())
      pctMap.get(row.code)!.set(date, toNum(row.pct) / 100)
    }
    if (row.volume != null) {
      if (!volMap.has(row.code)) volMap.set(row.code, new Map())
      volMap.get(row.code)!.set(date, toNum(row.volume))
    }
    if (row.open != null) {
      if (!openMap.has(row.code)) openMap.set(row.code, new Map())
      openMap.get(row.code)!.set(date, toNum(row.open))
    }
    if (row.close != null) {
      if (!closeMap.has(row.code)) closeMap.set(row.code, new Map())
      closeMap.get(row.code)!.set(date, toNum(row.close))
    }
    if (row.settle != null) {
      if (!settleMap.has(row.code)) settleMap.set(row.code, new Map())
      settleMap.get(row.code)!.set(date, toNum(row.settle))
    }
  }
  const dates = [...dateSet].sort()
  const align = (src: Map<string, Map<string, number>>, code: string): Array<number | null> =>
    dates.map((date) => src.get(code)?.has(date) ? src.get(code)!.get(date)! : null)
  const cleanPctByCode = new Map<string, number[]>()
  const spikeByCode = new Map<string, boolean[]>()
  const volume = new Map<string, Array<number | null>>()
  const open = new Map<string, Array<number | null>>()
  const close = new Map<string, Array<number | null>>()
  const settle = new Map<string, Array<number | null>>()
  for (const code of codes) {
    const raw = dates.map((date) => pctMap.get(code)?.get(date) ?? 0)
    const clean = zeroRolloverSpikes(raw)
    cleanPctByCode.set(code, clean)
    spikeByCode.set(code, raw.map((value, i) => Math.abs(value) > 0 && clean[i] === 0))
    volume.set(code, align(volMap, code))
    open.set(code, align(openMap, code))
    close.set(code, align(closeMap, code))
    settle.set(code, align(settleMap, code))
  }
  return { dates, pctMap, cleanPctByCode, spikeByCode, volume, open, close, settle }
}

async function readRoute(loader: () => Promise<(req: Request) => Promise<Response>>, url: string): Promise<Record<string, unknown>> {
  const GET = await loader()
  const res = await GET(new Request(url))
  const body = await res.json()
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "empty response" }
  return body as Record<string, unknown>
}

async function loadCumCapitalSeries(): Promise<Array<{ date: string; capital: number }>> {
  try {
    const nav = await readRoute(
      () => import("@/app/ma/api/mom-analysis/product-nav/route").then((mod) => mod.GET),
      "http://localhost/ma/api/mom-analysis/product-nav",
    )
    const series = Array.isArray(nav.data) ? nav.data as Array<{ date?: string; cumCapital?: number }> : []
    return series
      .filter((row) => typeof row.cumCapital === "number" && row.date)
      .map((row) => ({ date: asDate(row.date), capital: Number(row.cumCapital) }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return []
  }
}

function capitalOnOrBefore(series: Array<{ date: string; capital: number }>, date: string): number | null {
  let found: number | null = null
  for (const row of series) {
    if (row.date <= date) found = row.capital
    else break
  }
  return found
}

function packCorr(prods: string[], corr: number[][]): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 0; i < prods.length; i += 1) {
    for (let j = 0; j < prods.length; j += 1) {
      map.set(corrKey(prods[i], prods[j]), corr[i]?.[j] ?? (i === j ? 1 : 0))
    }
  }
  return map
}

function fillCorr(src: Map<string, number>, fallback: Map<string, number>, prods: string[]): Map<string, number> {
  const out = new Map(src)
  for (const a of prods) {
    for (const b of prods) {
      const key = corrKey(a, b)
      if (!out.has(key)) {
        out.set(key, fallback.get(key) ?? (a === b ? 1 : 0))
      }
    }
  }
  return out
}

function varFromMaps(
  mv: Record<string, number>,
  sigmas: Record<string, number>,
  corr: Map<string, number>,
  prods: string[],
): number {
  const ps = prods.filter((prod) => Math.abs(mv[prod] ?? 0) >= MV_MIN || (sigmas[prod] ?? 0) > 0)
  if (ps.length === 0) return 0
  const products: VarProduct[] = ps.map((prod) => ({ prod, mv: mv[prod] ?? 0, sigma: sigmas[prod] ?? 0 }))
  const mat = products.map((_, i) => products.map((__, j) => (
    i === j ? 1 : (corr.get(corrKey(ps[i], ps[j])) ?? 0)
  )))
  return portfolioVar95(products, mat, Z95)
}

type PackedDay = {
  date: string
  prods: string[]
  mvs: Record<string, number>
  sigmas: Record<string, number>
  corr: Map<string, number>
  productShare: Record<string, number>
  sectorShare: Record<string, number>
  maxProd: string
  maxProdShare: number
  maxSec: string
  maxSecShare: number
  var95: number
  varPct: number | null
  capOk: boolean
  nProd: number
  metrics: RegimeMetrics
}

function marketMetrics(
  prods: string[],
  date: string,
  market: MarketPack,
): Omit<RegimeMetrics, "medSigma" | "dMedSigma" | "meanCorr"> & { nHeldMkt: number } {
  const idx = floorIndex(market.dates, date)
  if (idx < 0 || market.dates[idx] !== date) {
    return { breadth: null, gapMed: null, jumpMed: null, maxAbsR: null, nLiqGap: 0, nSpike: 0, nHeldMkt: 0 }
  }
  const absRets: number[] = []
  const signed: number[] = []
  const gaps: number[] = []
  let nLiqGap = 0
  let nSpike = 0
  let nHeldMkt = 0
  for (const prod of prods) {
    const code = AKSHARE_CODE[prod]
    if (!code) continue
    nHeldMkt += 1
    const raw = market.pctMap.get(code)?.get(date) ?? 0
    absRets.push(Math.abs(raw))
    signed.push(raw)
    if (market.spikeByCode.get(code)?.[idx]) nSpike += 1
    const vols = market.volume.get(code)
    const todayVol = vols?.[idx]
    if (todayVol != null) {
      const hist: number[] = []
      const start = Math.max(0, idx - 20)
      for (let i = start; i < idx; i += 1) {
        const value = vols?.[i]
        if (value != null && Number.isFinite(value)) hist.push(value)
      }
      const med = median(hist)
      if (hist.length >= 5 && med != null && med > 0 && todayVol / med < 0.3) nLiqGap += 1
    }
    if (idx > 0) {
      const o = market.open.get(code)?.[idx]
      let prev = market.settle.get(code)?.[idx - 1]
      if (prev == null) prev = market.close.get(code)?.[idx - 1]
      if (o != null && prev != null && prev !== 0) gaps.push(Math.abs(o / prev - 1))
    }
  }
  let breadth: number | null = null
  let maxAbsR: number | null = null
  if (signed.length > 0) {
    const posFrac = signed.filter((value) => value > 0).length / signed.length
    const negFrac = signed.filter((value) => value < 0).length / signed.length
    breadth = Math.max(posFrac, negFrac)
    maxAbsR = Math.max(...absRets)
  }
  return {
    breadth,
    gapMed: median(gaps),
    jumpMed: median(absRets),
    maxAbsR,
    nLiqGap,
    nSpike,
    nHeldMkt,
  }
}

function argmaxShare(shares: Record<string, number>): { name: string; share: number } {
  let name = ""
  let share = -1
  for (const [key, value] of Object.entries(shares)) {
    if (value > share || (value === share && key.localeCompare(name) < 0)) {
      name = key
      share = value
    }
  }
  return { name, share: share < 0 ? 0 : share }
}

const FOOTNOTE = "口径与 VaR 沙盘、历史贡献图、处置建议相同（20 日波动、252 日相关、含当日窗口；账户与合约过滤一致）。表格跟踪最新日（或所选日）VaR 贡献最大的品种与板块，窗口为当前拥挤片段：软线脉冲间隔不超过 5 个交易日则拼接，并保留 2 个交易日导入、至少 8 日上下文。驱动是持仓/市场 Shapley 分解；正式动作是组合层面的 MOM-lite 分类，与报告案例表同一规则（不是处置建议里按对象给出的立场）。"

function emptyPayload(volDays: number, corrDays: number, date = ""): EventTablesPayload {
  return {
    ok: true,
    date,
    latestDate: date,
    selectedDate: date,
    productTable: null,
    sectorTable: null,
    footnote: FOOTNOTE,
    volDays,
    corrDays,
    window: "inclusive",
  }
}

function packTable(
  kind: "product" | "sector",
  name: string,
  days: BookDayState[],
  history: PackedDay[],
  start: number,
  end: number,
): EventTableBlock {
  const label = kind === "product" ? prodLabel(name) : sectorLabel(name)
  const shareHeader = kind === "product" ? prodShortName(name) : sectorLabel(name)
  const secondHeader = kind === "product"
    ? sectorLabel(productSector(name))
    : "第一品种"
  const rows: EventTableRow[] = []
  for (let i = start; i <= end; i += 1) {
    const day = days[i]
    const packed = history[i]
    const sharePct = kind === "product"
      ? (packed.productShare[name] ?? 0)
      : (packed.sectorShare[name] ?? 0)
    const prevShare = i > 0
      ? (kind === "product" ? (history[i - 1].productShare[name] ?? 0) : (history[i - 1].sectorShare[name] ?? 0))
      : null
    const short = kind === "product" && (packed.mvs[name] ?? 0) < 0 && sharePct > 0
    let secondPct = 0
    let secondText = "—"
    if (kind === "product") {
      const sector = productSector(name)
      secondPct = packed.sectorShare[sector] ?? 0
      secondText = formatSharePct(secondPct)
    } else {
      secondPct = packed.maxProdShare
      secondText = packed.maxProd ? firstProductText(packed.maxProd, packed.maxProdShare) : "—"
    }
    rows.push({
      date: day.date,
      dateShort: formatMdDate(day.date),
      sharePct,
      shareText: formatSharePct(sharePct, short),
      secondPct,
      secondText,
      driver: day.driver,
      driverLabel: driverLabelFor(kind, {
        driver: day.driver,
        dVar: day.dVar,
        sharePct,
        prevSharePct: prevShare,
        jump: Boolean(day.flags.jump),
      }),
      dVar: day.dVar,
      dVarText: formatWan(day.dVar),
      varPct: day.varPct,
      varPctText: day.varPct == null || !Number.isFinite(day.varPct) ? "—" : `${day.varPct.toFixed(2)}%`,
      nSigns: day.nSigns,
      signs: day.signs,
      signsCn: day.signsCn,
      action: day.action,
      actionDisplay: day.actionDisplay,
    })
  }
  return {
    kind,
    name,
    label,
    shareHeader,
    secondHeader,
    windowFrom: days[start]?.date ?? "",
    windowTo: days[end]?.date ?? "",
    asOfSharePct: rows.length ? rows[rows.length - 1].sharePct : 0,
    rows,
  }
}

export async function buildVarMcrEvents(req: Request): Promise<EventTablesPayload> {
  const url = new URL(req.url)
  const volDays = Math.max(5, Math.min(120, parseInt(url.searchParams.get("volDays") ?? "20", 10)))
  const corrDays = Math.max(5, Math.min(756, parseInt(url.searchParams.get("corrDays") ?? "252", 10)))
  const requested = asDate(url.searchParams.get("date") ?? "")

  const mvRows = await query<{ date: string; contract: string; mv: string }>(
    `SELECT "交易日期"::text AS date, UPPER(TRIM("合约")) AS contract,
            SUM(
              CASE WHEN ${numExpr("买持仓")} > 0
                   THEN  ${numExpr("持仓市値")}
                   ELSE -${numExpr("持仓市値")}
              END
            )::text AS mv
     FROM mom_position_details
     WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
     ${ACCOUNT_FILTER}
     GROUP BY "交易日期", UPPER(TRIM("合约"))
     ORDER BY 1`,
  )
  if (mvRows.length === 0) return emptyPayload(volDays, corrDays)

  const prodMvByDate = new Map<string, Map<string, number>>()
  const tradingDatesSet = new Set<string>()
  for (const row of mvRows) {
    const prod = getPrefix(row.contract)
    const date = asDate(row.date)
    if (!prod || !date) continue
    tradingDatesSet.add(date)
    if (!prodMvByDate.has(date)) prodMvByDate.set(date, new Map())
    const byProd = prodMvByDate.get(date)!
    byProd.set(prod, (byProd.get(prod) ?? 0) + toNum(row.mv))
  }
  const tradingDates = [...tradingDatesSet].sort()
  const allProds = [...new Set([...prodMvByDate.values()].flatMap((map) => [...map.keys()]))]
  const akCodes = [...new Set(allProds.map((prod) => AKSHARE_CODE[prod]).filter(Boolean))]
  if (akCodes.length === 0) return emptyPayload(volDays, corrDays)

  const market = await loadMarket(akCodes)
  const capitalSeries = await loadCumCapitalSeries()
  const neededHistory = Math.max(volDays, corrDays)
  const history: PackedDay[] = []

  for (const date of tradingDates) {
    const mktIdx = floorIndex(market.dates, date)
    if (mktIdx < neededHistory - 1) continue
    const mvMap = prodMvByDate.get(date) ?? new Map()
    const active = [...mvMap.entries()]
      .filter(([prod, mv]) => Boolean(AKSHARE_CODE[prod]) && Math.abs(mv) >= MV_MIN)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    if (active.length === 0) continue

    const volStart = mktIdx - volDays + 1
    const corrStart = mktIdx - corrDays + 1
    const corrDates = market.dates.slice(corrStart, mktIdx + 1)
    const products: VarProduct[] = active.map(([prod, mv]) => {
      const code = AKSHARE_CODE[prod]
      const clean = market.cleanPctByCode.get(code) ?? []
      const rets = clean.slice(volStart, mktIdx + 1).filter((r) => r !== 0)
      return { prod, mv, sigma: stdDev(rets) }
    })
    const retSeries = active.map(([prod]) => {
      const code = AKSHARE_CODE[prod]
      const m = market.pctMap.get(code)
      return corrDates.map((d) => m?.get(d) ?? 0)
    })
    const n = products.length
    const corr: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
    for (let i = 0; i < n; i += 1) {
      corr[i][i] = 1
      for (let j = i + 1; j < n; j += 1) {
        const c = pearsonCorr(retSeries[i], retSeries[j])
        corr[i][j] = c
        corr[j][i] = c
      }
    }

    const dv = products.map((product) => product.sigma * product.mv)
    const productMcr: Record<string, number> = {}
    const sectorMcr: Record<string, number> = {}
    let totalMcr = 0
    for (let i = 0; i < n; i += 1) {
      if (dv[i] === 0) continue
      let covSum = 0
      for (let j = 0; j < n; j += 1) covSum += dv[j] * corr[i][j]
      const mcr = Math.abs(dv[i] * covSum)
      if (mcr < 1) continue
      const { prod } = products[i]
      const sector = PROD_SECTOR[prod] ?? "其他"
      productMcr[prod] = (productMcr[prod] ?? 0) + mcr
      sectorMcr[sector] = (sectorMcr[sector] ?? 0) + mcr
      totalMcr += mcr
    }
    if (totalMcr === 0) continue

    const productShare: Record<string, number> = {}
    const sectorShare: Record<string, number> = {}
    for (const [key, value] of Object.entries(productMcr)) {
      productShare[key] = Math.round(value / totalMcr * 10000) / 100
    }
    for (const [key, value] of Object.entries(sectorMcr)) {
      sectorShare[key] = Math.round(value / totalMcr * 10000) / 100
    }
    const maxProd = argmaxShare(productShare)
    const maxSec = argmaxShare(sectorShare)
    const var95 = portfolioVar95(products, corr, Z95)
    const capital = capitalOnOrBefore(capitalSeries, date)
    const capOk = capital != null && capital >= BOOK_CAP_MIN
    const varPct = capital != null && capital > 0 ? (var95 / capital) * 100 : null
    const heldSig = products.map((product) => product.sigma).filter((sigma) => sigma > 0)
    const meanCorr = n >= 2
      ? (() => {
          let sum = 0, count = 0
          for (let i = 0; i < n; i += 1) {
            for (let j = i + 1; j < n; j += 1) {
              sum += corr[i][j]
              count += 1
            }
          }
          return count ? sum / count : null
        })()
      : null
    const mkt = marketMetrics(products.map((product) => product.prod), date, market)
    history.push({
      date,
      prods: products.map((product) => product.prod),
      mvs: Object.fromEntries(active),
      sigmas: Object.fromEntries(products.map((product) => [product.prod, product.sigma])),
      corr: packCorr(products.map((product) => product.prod), corr),
      productShare,
      sectorShare,
      maxProd: maxProd.name,
      maxProdShare: maxProd.share,
      maxSec: maxSec.name,
      maxSecShare: maxSec.share,
      var95,
      varPct,
      capOk,
      nProd: n,
      metrics: {
        medSigma: median(heldSig),
        dMedSigma: null,
        meanCorr,
        breadth: mkt.breadth,
        gapMed: mkt.gapMed,
        jumpMed: mkt.jumpMed,
        maxAbsR: mkt.maxAbsR,
        nLiqGap: mkt.nLiqGap,
        nSpike: mkt.nSpike,
      },
    })
  }

  if (history.length === 0) return emptyPayload(volDays, corrDays)

  for (let i = 0; i < history.length; i += 1) {
    const prev = i > 0 ? history[i - 1].metrics.medSigma : null
    const cur = history[i].metrics.medSigma
    history[i].metrics.dMedSigma = prev != null && cur != null ? cur - prev : null
  }

  const mature = history.filter((day) => day.nProd >= MATURE_MIN_PRODUCTS).map((day) => day.metrics)
  const thresholds = regimeThresholds(mature)
  const flagsByDate = new Map<string, RegimeFlags>()
  for (const day of history) {
    flagsByDate.set(day.date, classifyRegimeFlags(day.metrics, thresholds))
  }

  const eventInputs: DailyEventInput[] = history.map((day, i) => {
    let driver: DriverKind = "na"
    let dVar: number | null = null
    let attrPos: number | null = null
    let attrMkt: number | null = null
    if (i > 0) {
      const prev = history[i - 1]
      const prods = [...new Set([...prev.prods, ...day.prods])].sort()
      const mv0: Record<string, number> = {}
      const mv1: Record<string, number> = {}
      const s0: Record<string, number> = { ...prev.sigmas }
      const s1: Record<string, number> = { ...day.sigmas }
      for (const prod of prods) {
        mv0[prod] = prev.mvs[prod] ?? 0
        mv1[prod] = day.mvs[prod] ?? 0
        if (s0[prod] == null && s1[prod] != null) s0[prod] = s1[prod]
        if (s1[prod] == null && s0[prod] != null) s1[prod] = s0[prod]
      }
      const c0 = fillCorr(prev.corr, day.corr, prods)
      const c1 = fillCorr(day.corr, prev.corr, prods)
      const v00 = varFromMaps(mv0, s0, c0, prods)
      const v10 = varFromMaps(mv1, s0, c0, prods)
      const v01 = varFromMaps(mv0, s1, c1, prods)
      const v11 = varFromMaps(mv1, s1, c1, prods)
      const info = shapleyDriver(v00, v10, v01, v11)
      driver = info.driver
      dVar = info.dVar
      attrPos = info.attrPos
      attrMkt = info.attrMkt
    }
    // Drop packed corr after the next day has used it, to keep memory bounded.
    if (i > 0) history[i - 1].corr = new Map()
    return {
      date: day.date,
      maxProd: day.maxProd,
      maxProdShare: day.maxProdShare,
      maxSec: day.maxSec,
      maxSecShare: day.maxSecShare,
      driver,
      dVar,
      attrPos,
      attrMkt,
      varPct: day.varPct,
      capOk: day.capOk,
      nProd: day.nProd,
      flags: flagsByDate.get(day.date) ?? {},
    }
  })

  const days = attachBookState(eventInputs)
  const latestDate = days[days.length - 1].date
  const selectedDate = requested && days.some((day) => day.date === requested) ? requested : latestDate
  const asOfIndex = days.findIndex((day) => day.date === selectedDate)
  const asOf = days[asOfIndex]
  const productShares = history.map((day) => day.productShare[asOf.maxProd] ?? 0)
  const sectorShares = history.map((day) => day.sectorShare[asOf.maxSec] ?? 0)
  const productWindow = episodeWindowIndices(productShares, PRODUCT_SOFT, asOfIndex)
  const sectorWindow = episodeWindowIndices(sectorShares, SECTOR_SOFT, asOfIndex)

  return {
    ok: true,
    date: selectedDate,
    latestDate,
    selectedDate,
    productTable: asOf.maxProd ? packTable("product", asOf.maxProd, days, history, productWindow.start, productWindow.end) : null,
    sectorTable: asOf.maxSec ? packTable("sector", asOf.maxSec, days, history, sectorWindow.start, sectorWindow.end) : null,
    footnote: FOOTNOTE,
    volDays,
    corrDays,
    window: "inclusive",
  }
}
