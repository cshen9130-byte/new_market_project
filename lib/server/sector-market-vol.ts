import { publicQuery } from "@/lib/db"
import { getCategory, getSector, getSubSector } from "@/lib/server/account-risk-classify"
import { stdDev, zeroRolloverSpikes } from "@/lib/server/mom-position-var-math"

/** 板块市场波动: 20-day annualized vol of an equal-weight main-contract basket. */
export const SECTOR_MARKET_VOL_WINDOW = 20
const MIN_OBS = 15
const PRICE_SINCE = "2024-11-01"
/** Drop a cleaned return at or above this absolute daily move (decimal). */
const MAX_ABS_RET = 0.15

/** AkShare 主力连续 code. Same map the position-VaR paths use. */
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

const CODE_TO_PRODUCT = new Map(Object.entries(AKSHARE_CODE).map(([product, code]) => [code, product]))

/** Published sector indexes. Rows without one stay on the equal-weight main-contract basket. */
const NANHUA_BY_SECTOR: Record<string, string> = {
  农产: "NHAI.NH",
  能源化工: "NHECI.NH",
  黑色: "NHFI.NH",
  贵金属: "NHPMI.NH",
  新能源: "NHNEI.NH",
  有色: "NHNFI.NH",
}
const NANHUA_BY_CATEGORY: Record<string, string> = {
  商品: "NHCI.NH",
}

export type DatedReturn = { date: string; ret: number }

export type SectorMarketVolPayload = {
  window: number
  asOf: string | null
  dates: string[]
  category: Record<string, Array<number | null>>
  sector: Record<string, Array<number | null>>
  sub: Record<string, Array<number | null>>
}

type LabeledSeries = {
  category: string
  sector: string
  sub: string
  points: DatedReturn[]
}

/** Close-to-close simple returns. Flat days stay in; prints of 15% or more are dropped. */
export function closesToReturns(points: Array<{ date: string; close: number }>): DatedReturn[] {
  const ordered = points.filter((point) => point.close > 0).sort((a, b) => a.date.localeCompare(b.date))
  const out: DatedReturn[] = []
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1].close
    const ret = ordered[i].close / prev - 1
    if (!Number.isFinite(ret) || Math.abs(ret) >= MAX_ABS_RET) continue
    out.push({ date: ordered[i].date, ret })
  }
  return out
}

/** Drop rollover spikes and other non-market prints. `ret` is a decimal daily return. */
export function cleanProductReturns(points: DatedReturn[]): DatedReturn[] {
  if (points.length === 0) return []
  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const cleaned = zeroRolloverSpikes(ordered.map((point) => point.ret))
  const out: DatedReturn[] = []
  for (let i = 0; i < ordered.length; i++) {
    const ret = cleaned[i]
    if (ret == null || !Number.isFinite(ret) || ret === 0 || Math.abs(ret) >= MAX_ABS_RET) continue
    out.push({ date: ordered[i].date, ret })
  }
  return out
}

function equalWeightSeries(members: DatedReturn[][]): DatedReturn[] {
  const byDate = new Map<string, number[]>()
  for (const series of members) {
    for (const point of series) {
      const list = byDate.get(point.date)
      if (list) list.push(point.ret)
      else byDate.set(point.date, [point.ret])
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rets]) => ({
      date,
      ret: rets.reduce((sum, ret) => sum + ret, 0) / rets.length,
    }))
}

function rollingAnnVol(series: DatedReturn[]): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = 0; i < series.length; i++) {
    const window = series.slice(Math.max(0, i - SECTOR_MARKET_VOL_WINDOW + 1), i + 1)
    if (window.length < MIN_OBS) continue
    const vol = stdDev(window.map((point) => point.ret)) * Math.sqrt(252) * 100
    if (!Number.isFinite(vol)) continue
    out.set(series[i].date, Math.round(vol * 10) / 10)
  }
  return out
}

function align(groups: Map<string, Map<string, number>>, dates: string[]): Record<string, Array<number | null>> {
  const out: Record<string, Array<number | null>> = {}
  for (const [name, byDate] of groups) {
    out[name] = dates.map((date) => byDate.get(date) ?? null)
  }
  return out
}

/** Annualized vol, in percent, of each 大类 / 板块 / 细分 equal-weight basket. */
export function buildSectorMarketVol(series: LabeledSeries[]): SectorMarketVolPayload {
  const buckets = {
    category: new Map<string, DatedReturn[][]>(),
    sector: new Map<string, DatedReturn[][]>(),
    sub: new Map<string, DatedReturn[][]>(),
  }
  const push = (map: Map<string, DatedReturn[][]>, name: string, points: DatedReturn[]) => {
    if (!name || name === "其他" || points.length === 0) return
    const list = map.get(name)
    if (list) list.push(points)
    else map.set(name, [points])
  }
  for (const row of series) {
    push(buckets.category, row.category, row.points)
    push(buckets.sector, row.sector, row.points)
    push(buckets.sub, row.sub, row.points)
  }

  const volMaps = {
    category: new Map<string, Map<string, number>>(),
    sector: new Map<string, Map<string, number>>(),
    sub: new Map<string, Map<string, number>>(),
  }
  const dates = new Set<string>()
  for (const key of ["category", "sector", "sub"] as const) {
    for (const [name, members] of buckets[key]) {
      const vol = rollingAnnVol(equalWeightSeries(members))
      if (vol.size === 0) continue
      volMaps[key].set(name, vol)
      for (const date of vol.keys()) dates.add(date)
    }
  }
  const ordered = [...dates].sort()
  return {
    window: SECTOR_MARKET_VOL_WINDOW,
    asOf: ordered[ordered.length - 1] ?? null,
    dates: ordered,
    category: align(volMaps.category, ordered),
    sector: align(volMaps.sector, ordered),
    sub: align(volMaps.sub, ordered),
  }
}

type PriceRow = { date: string; code: string; pct: string | number | null }
type IndexRow = { date: string; code: string; close: string | number | null }

function overlay(
  base: Record<string, Array<number | null>>,
  baseDates: string[],
  over: Record<string, Array<number | null>>,
  overDates: string[],
) {
  for (const [name, vals] of Object.entries(over)) {
    const byDate = new Map<string, number>()
    overDates.forEach((date, i) => {
      const value = vals[i]
      if (value != null) byDate.set(date, value)
    })
    if (byDate.size === 0) continue
    base[name] = baseDates.map((date) => byDate.get(date) ?? null)
  }
}

/**
 * 板块市场波动.
 * 农产 / 能化 / 黑色 / 贵金属 / 新能源 / 有色 and 商品 use the Nanhua index.
 * 生鲜 / 航运 / 股指 / 国债 and 细分板块 use an equal-weight main-contract basket.
 * Reads public.raw_nanhua_indices_daily and public.raw_akshare_futures_daily only.
 */
export async function loadSectorMarketVol(): Promise<SectorMarketVolPayload> {
  const codes = [...CODE_TO_PRODUCT.keys()]
  const indexCodes = [...new Set([...Object.values(NANHUA_BY_SECTOR), ...Object.values(NANHUA_BY_CATEGORY)])]
  const [result, indexResult] = await Promise.all([
    publicQuery(
      `SELECT trade_date::text AS date, code, pct_change::text AS pct
       FROM public.raw_akshare_futures_daily
       WHERE code = ANY($1::text[])
         AND trade_date >= $2::date
         AND pct_change IS NOT NULL
       ORDER BY code, trade_date`,
      [codes, PRICE_SINCE],
    ),
    publicQuery(
      `SELECT trade_date::text AS date, code, close::text AS close
       FROM public.raw_nanhua_indices_daily
       WHERE code = ANY($1::text[])
         AND trade_date >= $2::date
         AND close IS NOT NULL
         AND close > 0
       ORDER BY code, trade_date`,
      [indexCodes, PRICE_SINCE],
    ),
  ])
  const rows = result.rows as PriceRow[]
  const byProduct = new Map<string, DatedReturn[]>()
  for (const row of rows) {
    const product = CODE_TO_PRODUCT.get(row.code)
    const date = String(row.date).slice(0, 10)
    const pct = typeof row.pct === "number" ? row.pct : parseFloat(String(row.pct))
    if (!product || !date || !Number.isFinite(pct)) continue
    const list = byProduct.get(product)
    const point = { date, ret: pct / 100 }
    if (list) list.push(point)
    else byProduct.set(product, [point])
  }

  const labeled: LabeledSeries[] = []
  for (const [product, points] of byProduct) {
    const cleaned = cleanProductReturns(points)
    if (cleaned.length === 0) continue
    labeled.push({
      category: getCategory(product),
      sector: getSector(product),
      sub: getSubSector(product),
      points: cleaned,
    })
  }
  const basket = buildSectorMarketVol(labeled)

  const closesByCode = new Map<string, Array<{ date: string; close: number }>>()
  for (const row of indexResult.rows as IndexRow[]) {
    const date = String(row.date).slice(0, 10)
    const close = typeof row.close === "number" ? row.close : parseFloat(String(row.close))
    if (!date || !Number.isFinite(close) || close <= 0) continue
    const list = closesByCode.get(row.code)
    const point = { date, close }
    if (list) list.push(point)
    else closesByCode.set(row.code, [point])
  }
  const indexSeries: LabeledSeries[] = []
  for (const [sector, code] of Object.entries(NANHUA_BY_SECTOR)) {
    const points = closesToReturns(closesByCode.get(code) ?? [])
    if (points.length) indexSeries.push({ category: "", sector, sub: "", points })
  }
  for (const [category, code] of Object.entries(NANHUA_BY_CATEGORY)) {
    const points = closesToReturns(closesByCode.get(code) ?? [])
    if (points.length) indexSeries.push({ category, sector: "", sub: "", points })
  }
  const indexed = buildSectorMarketVol(indexSeries)
  overlay(basket.sector, basket.dates, indexed.sector, indexed.dates)
  overlay(basket.category, basket.dates, indexed.category, indexed.dates)
  return basket
}
