/**
 * JY 跟踪池周度回顾 Excel — layout follows 博孚利周度回顾（股票）:
 * 目录 + 股票市场回顾 + one sheet per 团队策略 bucket.
 */

import { randomUUID } from "crypto"
import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { fmtIso, n, query, queryUnbounded } from "@/lib/db"
import { computeFundNavMetrics, isPlausibleRiskRatio } from "@/lib/fund-nav-metrics"
import { parseStrategyLevel3 } from "@/lib/ma/strategy-level3"
import { isChinaTradingDay, shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
import {
  addDays,
  calcPeriodReturnsFromHistory,
  calcReturn,
  computeOneYearRiskMetrics,
  enrichReturnNavSeries,
  expandBeiansWithShareClassFamily,
  NAV_HISTORY_LOOKBACK_DAYS,
  type NavPoint,
} from "@/lib/server/list-cache-nav-batch"

const HEADER_FILL = "1F4E79"
const ALT_FILL = "F2F2F2"
const RED = "C00000"
const GREEN = "006600"
const FONT_NAME = "宋体"

const EQUITY_L1 = new Set(["股票多头", "股票对冲", "股票策略"])

/** Preferred sheet order for equity buckets (sample 3.0–3.12). */
const BUCKET_ORDER = [
  "500指增",
  "1000指增",
  "2000指增",
  "300指增",
  "A500指增",
  "指数增强",
  "高换手",
  "中换手",
  "低换手",
  "指增T0",
  "空气指增",
  "量化中性",
  "中性",
  "强势股",
  "择时择股",
  "可转债",
  "转债策略",
  "打板",
  "DMA",
  "股票多空",
  "港股对冲",
]

const EXCESS_BUCKET_RE = /^(500指增|1000指增|2000指增|300指增|A500指增|指数增强|高换手|中换手|低换手|指增T0|2000指增T0)$/

type MetricMode = "excess" | "absolute"

export type WeeklyReviewFund = {
  beian_hao: string
  product_name: string
  short_name: string | null
  l1: string | null
  l2: string | null
  l3: string | null
}

export type WeeklyReviewGroupPreview = {
  bucket: string
  mode: MetricMode
  count: number
}

export type WeeklyReviewPreview = {
  week_start: string
  week_end: string
  as_of: string
  fund_count: number
  groups: WeeklyReviewGroupPreview[]
}

type PeriodKey = "ret_1w" | "ret_1m" | "ret_3m" | "ret_6m" | "ret_1y"

type FundMetrics = {
  beian_hao: string
  name: string
  bucket: string
  mode: MetricMode
  ret: Record<PeriodKey, number | null>
  excess: Record<PeriodKey, number | null>
  excess_dd_6m: number | null
  excess_dd_1y: number | null
  sharpe_1y: number | null
  calmar_1y: number | null
}

const MARKET_INDICES: Array<{ name: string; codes: string[]; spot?: string }> = [
  { name: "上证50", codes: ["000016.SH", "000016"], spot: "IH" },
  { name: "沪深300", codes: ["000300.SH", "000300"], spot: "IF" },
  { name: "中证500", codes: ["000905.SH", "000905"], spot: "IC" },
  { name: "中证1000", codes: ["000852.SH", "000852"], spot: "IM" },
  { name: "中证2000", codes: ["932000.CSI", "932000.SH", "932000"] },
  { name: "创业板指", codes: ["399006.SZ", "399006"] },
  { name: "万得全A", codes: ["000985.SH", "000985"] },
  { name: "全A等权", codes: ["EQW.CN"] },
  { name: "上证指数", codes: ["000001.SH", "000001"] },
  { name: "恒生指数", codes: ["HSI.HI", "HSI"] },
  { name: "恒生科技", codes: ["HSTECH.HI", "HSTECH"] },
  { name: "中证A500", codes: ["000510.SH", "000510", "399850.SZ"] },
]

const STYLE_INDICES: Array<{ name: string; codes: string[] }> = [
  { name: "大盘成长", codes: ["399372.SZ", "399372"] },
  { name: "大盘价值", codes: ["399373.SZ", "399373"] },
  { name: "中盘成长", codes: ["399374.SZ", "399374"] },
  { name: "中盘价值", codes: ["399375.SZ", "399375"] },
  { name: "小盘成长", codes: ["399376.SZ", "399376"] },
  { name: "小盘价值", codes: ["399377.SZ", "399377"] },
  { name: "茅指数", codes: ["BK0999.EM", "399997.SZ", "399997"] },
  { name: "宁组合", codes: ["BK1000.EM", "399808.SZ", "399808"] },
  { name: "微盘股指数", codes: ["BK1158.EM", "399303.SZ", "399303"] },
  { name: "红利指数", codes: ["000015.SH", "000015"] },
  { name: "北证50", codes: ["899050.BJ", "899050"] },
  { name: "科创50", codes: ["000688.SH", "000688"] },
]

const SECTOR_INDICES: Array<{ name: string; codes: string[] }> = [
  { name: "周期", codes: ["801271.SI", "801271", "BK1639.EM"] },
  { name: "先进制造", codes: ["801272.SI", "801272", "BK1710.EM"] },
  { name: "消费", codes: ["801273.SI", "801273", "BK1711.EM"] },
  { name: "科技TMT", codes: ["801275.SI", "801275", "BK1713.EM"] },
  { name: "金融地产", codes: ["801276.SI", "801276", "BK1714.EM"] },
  { name: "医药医疗", codes: ["801274.SI", "801274", "BK1712.EM"] },
]

const BENCH_BY_BUCKET: Record<string, string[]> = {
  "500指增": ["000905.SH", "000905"],
  "1000指增": ["000852.SH", "000852"],
  "2000指增": ["932000.CSI", "932000", "000852.SH"],
  "2000指增T0": ["932000.CSI", "932000", "000852.SH"],
  指增T0: ["932000.CSI", "932000", "000852.SH"],
  "300指增": ["000300.SH", "000300"],
  "A500指增": ["000510.SH", "000510", "000300.SH"],
  指数增强: ["000905.SH", "000905"],
  高换手: ["000905.SH", "000905"],
  中换手: ["000905.SH", "000905"],
  低换手: ["000905.SH", "000905"],
}

function isoFromLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function defaultWeeklyReviewWeekEnd(today = shanghaiTodayIsoDate()): string {
  const d = new Date(`${today}T12:00:00`)
  const day = d.getDay()
  const back = day >= 5 ? day - 5 : day + 2
  d.setDate(d.getDate() - back)
  return isoFromLocalDate(d)
}

export function mondayOfWeek(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return isoFromLocalDate(d)
}

export function resolveWeekWindow(weekEndRaw: string): { weekStart: string; weekEnd: string; asOf: string } {
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(weekEndRaw) ? weekEndRaw : defaultWeeklyReviewWeekEnd()
  return { weekStart: mondayOfWeek(asOf), weekEnd: asOf, asOf }
}

function displayName(productName: string, shortName: string | null): string {
  const raw = (shortName || productName || "").trim()
  return raw
    .replace(/私募证券投资基金/g, "")
    .replace(/证券投资基金/g, "")
    .replace(/\s+/g, " ")
    .trim() || productName
}

function inferIndexEnhBucket(productName: string, l3: string | null): string | null {
  const hay = `${productName} ${l3 ?? ""}`
  if (/空气指增|空气增强/.test(hay)) return "空气指增"
  if (/A500|中证A500/.test(hay)) return "A500指增"
  if (/2000/.test(hay)) return /T0/.test(hay) ? "指增T0" : "2000指增"
  if (/1000/.test(hay)) return "1000指增"
  if (/沪深300|HS300|300指增|300增强/.test(hay)) return "300指增"
  if (/(?<![A1])500/.test(hay) || /中证500/.test(hay)) return "500指增"
  if (/高换手/.test(hay)) return "高换手"
  if (/中换手/.test(hay)) return "中换手"
  if (/低换手|基本面/.test(hay)) return "低换手"
  return null
}

export function bucketForFund(fund: Pick<WeeklyReviewFund, "l1" | "l2" | "l3" | "product_name">): string {
  const l3s = parseStrategyLevel3(fund.l3 || "")
  for (const tag of l3s) {
    if (BUCKET_ORDER.includes(tag) || /指增$/.test(tag) || tag === "指增T0") return tag
  }
  const l2 = (fund.l2 || "").trim()
  if (l2 === "指数增强") {
    return inferIndexEnhBucket(fund.product_name, fund.l3) ?? "指数增强"
  }
  if (l2) return l2
  const inferred = inferIndexEnhBucket(fund.product_name, fund.l3)
  if (inferred) return inferred
  const l1 = (fund.l1 || "").trim()
  return l1 || "未分类"
}

export function metricModeForBucket(bucket: string): MetricMode {
  if (/空气指增/.test(bucket)) return "absolute"
  if (EXCESS_BUCKET_RE.test(bucket) || /指增$/.test(bucket)) return "excess"
  return "absolute"
}

function navValue(p: NavPoint | null | undefined): number | null {
  if (!p) return null
  const v = p.return_nav ?? p.nav
  return Number.isFinite(v) && v > 0 ? v : null
}

function closeOnOrBefore(series: Map<string, number>, date: string): { date: string; value: number } | null {
  let best: { date: string; value: number } | null = null
  for (const [d, v] of series) {
    if (d <= date && (best == null || d > best.date)) best = { date: d, value: v }
  }
  return best
}

function periodReturnFromSeries(series: Map<string, number>, asOf: string, days: number): number | null {
  const end = closeOnOrBefore(series, asOf)
  const start = closeOnOrBefore(series, addDays(asOf, days))
  if (!end || !start || start.date >= end.date) return null
  return calcReturn(end.value, start.value)
}

async function loadAshareCloses(codes: string[], from: string, to: string): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  if (codes.length === 0) return out
  const rows = await query<{ ts_code: string; trade_date: Date | string; close: string | number | null }>(
    `SELECT ts_code, trade_date, close
     FROM raw_ashare_index_daily
     WHERE ts_code = ANY($1::text[])
       AND trade_date >= $2::date
       AND trade_date <= $3::date
       AND close IS NOT NULL AND close > 0
     ORDER BY ts_code, trade_date ASC`,
    [codes, from, to],
  ).catch(() => [])
  for (const row of rows) {
    const value = n(row.close)
    if (value == null) continue
    const code = String(row.ts_code)
    if (!out.has(code)) out.set(code, new Map())
    out.get(code)!.set(fmtIso(row.trade_date), value)
  }
  return out
}

async function loadSpotCloses(symbols: string[], from: string, to: string): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  if (symbols.length === 0) return out
  const rows = await query<{ symbol: string; trade_date: Date | string; close: string | number | null }>(
    `SELECT DISTINCT ON (symbol, trade_date) symbol, trade_date, close
     FROM raw_spot_daily
     WHERE symbol = ANY($1::text[])
       AND trade_date >= $2::date
       AND trade_date <= $3::date
       AND close IS NOT NULL AND close > 0
     ORDER BY symbol, trade_date ASC, fetched_at DESC`,
    [symbols, from, to],
  ).catch(() => [])
  for (const row of rows) {
    const value = n(row.close)
    if (value == null) continue
    const symbol = String(row.symbol)
    if (!out.has(symbol)) out.set(symbol, new Map())
    out.get(symbol)!.set(fmtIso(row.trade_date), value)
  }
  return out
}

function pickSeries(
  ashare: Map<string, Map<string, number>>,
  spot: Map<string, Map<string, number>>,
  codes: string[],
  spotSymbol?: string,
): { code: string; series: Map<string, number> } | null {
  for (const code of codes) {
    const series = ashare.get(code)
    if (series && series.size >= 2) return { code, series }
  }
  if (spotSymbol) {
    const series = spot.get(spotSymbol)
    if (series && series.size >= 2) return { code: spotSymbol, series }
  }
  return null
}

function alignBenchToDates(dates: string[], bench: Map<string, number>): number[] {
  const sorted = [...bench.keys()].sort()
  const out: number[] = []
  let idx = 0
  let last: number | null = null
  for (const date of dates) {
    while (idx < sorted.length && sorted[idx] <= date) {
      last = bench.get(sorted[idx]) ?? last
      idx++
    }
    out.push(last ?? NaN)
  }
  return out
}

function windowSlice(dates: string[], values: number[], asOf: string, days: number): { dates: string[]; values: number[] } {
  const since = addDays(asOf, days)
  const outDates: string[] = []
  const outVals: number[] = []
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= since && dates[i] <= asOf) {
      outDates.push(dates[i])
      outVals.push(values[i])
    }
  }
  return { dates: outDates, values: outVals }
}

function excessWindows(
  fundHist: NavPoint[],
  bench: Map<string, number>,
  asOf: string,
): {
  excess: Record<PeriodKey, number | null>
  excess_dd_6m: number | null
  excess_dd_1y: number | null
} {
  const empty = {
    excess: { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null } as Record<PeriodKey, number | null>,
    excess_dd_6m: null,
    excess_dd_1y: null,
  }
  const since = addDays(asOf, 365)
  const slice = fundHist.filter((p) => p.nav_date >= since && p.nav_date <= asOf)
  if (slice.length < 2 || bench.size < 2) return empty
  const dates = slice.map((p) => p.nav_date)
  const fundVals = slice.map((p) => navValue(p) ?? NaN)
  const benchVals = alignBenchToDates(dates, bench)
  const firstFund = fundVals.find((v) => Number.isFinite(v) && v > 0)
  const firstBench = benchVals.find((v) => Number.isFinite(v) && v > 0)
  if (firstFund == null || firstBench == null) return empty

  const excessDates: string[] = []
  const excessVals: number[] = []
  for (let i = 0; i < dates.length; i++) {
    const fv = fundVals[i]
    const bv = benchVals[i]
    if (!Number.isFinite(fv) || !Number.isFinite(bv) || fv <= 0 || bv <= 0) continue
    excessDates.push(dates[i])
    excessVals.push((fv / firstFund) / (bv / firstBench))
  }
  if (excessVals.length < 2) return empty

  const period = (days: number): number | null => {
    const w = windowSlice(excessDates, excessVals, asOf, days)
    if (w.values.length < 2) return null
    const ret = w.values[w.values.length - 1] / w.values[0] - 1
    return Number.isFinite(ret) ? ret : null
  }
  const dd = (days: number): number | null => {
    const w = windowSlice(excessDates, excessVals, asOf, days)
    if (w.values.length < 2) return null
    const metrics = computeFundNavMetrics(w)
    return metrics && Number.isFinite(metrics.maxDD) ? metrics.maxDD : null
  }
  return {
    excess: {
      ret_1w: period(7),
      ret_1m: period(30),
      ret_3m: period(90),
      ret_6m: period(180),
      ret_1y: period(365),
    },
    excess_dd_6m: dd(180),
    excess_dd_1y: dd(365),
  }
}

export async function loadJyTrackingPoolFunds(): Promise<WeeklyReviewFund[]> {
  const rows = await query<WeeklyReviewFund>(
    `SELECT DISTINCT ON (UPPER(BTRIM(p.register_number)))
        p.register_number AS beian_hao,
        COALESCE(NULLIF(BTRIM(c.product_name), ''), NULLIF(BTRIM(p.product_name), ''), p.register_number) AS product_name,
        NULLIF(BTRIM(c.short_name), '') AS short_name,
        NULLIF(BTRIM(c.company_strategy_l1), '') AS l1,
        NULLIF(BTRIM(c.company_strategy_l2), '') AS l2,
        NULLIF(BTRIM(c.company_strategy_l3), '') AS l3
     FROM tracking_pool p
     LEFT JOIN ops_tracking_funds_list_cache c ON c.beian_hao = p.register_number
     WHERE p.register_number IS NOT NULL AND BTRIM(p.register_number) <> ''
     ORDER BY UPPER(BTRIM(p.register_number)), p.imported_at DESC NULLS LAST`,
  )
  return rows.filter((r) => r.beian_hao)
}

const NON_EQUITY_L1 = new Set([
  "期货策略",
  "管理期货",
  "债券策略",
  "固定收益",
  "固收策略",
  "多资产策略",
  "组合策略",
  "套利策略",
  "期权策略",
  "其他策略",
  "其他",
])

function isEquityFund(fund: WeeklyReviewFund): boolean {
  const l1 = (fund.l1 || "").trim()
  if (l1 && NON_EQUITY_L1.has(l1)) return false
  if (l1 && EQUITY_L1.has(l1)) return true
  const hay = `${fund.l2 ?? ""} ${fund.l3 ?? ""} ${fund.product_name}`
  if (/指增|中性|打板|转债|强势|择时|DMA|股票多空|港股|量化多头/.test(hay)) return true
  return !l1
}

export function previewWeeklyReview(funds: WeeklyReviewFund[]): WeeklyReviewGroupPreview[] {
  const counts = new Map<string, number>()
  for (const fund of funds) {
    const bucket = bucketForFund(fund)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }
  const known = BUCKET_ORDER.filter((b) => counts.has(b)).map((bucket) => ({
    bucket,
    mode: metricModeForBucket(bucket),
    count: counts.get(bucket) ?? 0,
  }))
  const rest = [...counts.keys()]
    .filter((b) => !BUCKET_ORDER.includes(b))
    .sort((a, b) => a.localeCompare(b, "zh"))
    .map((bucket) => ({
      bucket,
      mode: metricModeForBucket(bucket),
      count: counts.get(bucket) ?? 0,
    }))
  return [...known, ...rest]
}

export async function buildWeeklyReviewPreview(weekEnd: string): Promise<WeeklyReviewPreview> {
  const { weekStart, weekEnd: end, asOf } = resolveWeekWindow(weekEnd)
  const funds = (await loadJyTrackingPoolFunds()).filter(isEquityFund)
  return {
    week_start: weekStart,
    week_end: end,
    as_of: asOf,
    fund_count: funds.length,
    groups: previewWeeklyReview(funds),
  }
}

function groupSortKey(bucket: string): string {
  const idx = BUCKET_ORDER.indexOf(bucket)
  return idx >= 0 ? `${String(idx).padStart(3, "0")}_${bucket}` : `999_${bucket}`
}

function pushPoint(target: Map<string, Map<string, NavPoint>>, key: string, point: NavPoint) {
  const k = key.trim()
  if (!k || !isChinaTradingDay(point.nav_date) || !(point.nav > 0)) return
  if (!target.has(k)) target.set(k, new Map())
  const byDate = target.get(k)!
  const prev = byDate.get(point.nav_date)
  if (!prev) {
    byDate.set(point.nav_date, point)
    return
  }
  const prevRet = prev.return_nav ?? prev.nav
  const nextRet = point.return_nav ?? point.nav
  if (nextRet !== point.nav && prevRet === prev.nav) byDate.set(point.nav_date, point)
}

async function loadWeeklyReviewNavHistories(
  funds: WeeklyReviewFund[],
  asOf: string,
): Promise<Map<string, NavPoint[]>> {
  const since = addDays(asOf, NAV_HISTORY_LOOKBACK_DAYS)
  const beians = funds.map((f) => f.beian_hao.trim()).filter(Boolean)
  const codes = expandBeiansWithShareClassFamily(beians)
  const names = [...new Set(funds.flatMap((f) => [f.product_name, f.short_name ?? ""]).map((s) => s.trim()).filter(Boolean))]

  type EmailRow = {
    code: string | null
    fund_name: string | null
    nav_date: string
    nav: string | number | null
    cumulative_nav: string | number | null
  }
  type LegacyRow = {
    beian_hao: string
    product_name: string | null
    price_date: string
    nav: string | number | null
    cumulative_nav: string | number | null
    cum_nav_withdrawal: string | number | null
  }

  const [emailRows, legacyRows] = await Promise.all([
    queryUnbounded<EmailRow>(
      `SELECT BTRIM(product_code) AS code, NULLIF(BTRIM(fund_name), '') AS fund_name,
              nav_date::text AS nav_date, nav, cumulative_nav
       FROM ops_email_nav_records
       WHERE nav IS NOT NULL
         AND nav_date >= $2::date AND nav_date <= $3::date
         AND (
           BTRIM(product_code) = ANY($1::text[])
           OR fund_name = ANY($4::text[])
         )`,
      [codes, since, asOf, names],
    ).catch(() => [] as EmailRow[]),
    queryUnbounded<LegacyRow>(
      `SELECT beian_hao, NULLIF(BTRIM(product_name), '') AS product_name,
              price_date::text AS price_date, nav, cumulative_nav, cum_nav_withdrawal
       FROM private_fund_nav
       WHERE beian_hao = ANY($1::text[])
         AND price_date >= $2::date AND price_date <= $3::date
         AND nav IS NOT NULL`,
      [beians, since, asOf],
    ).catch(() => [] as LegacyRow[]),
  ])

  const byKey = new Map<string, Map<string, NavPoint>>()
  for (const row of legacyRows) {
    const unit = n(row.nav)
    if (unit == null || unit <= 0) continue
    const adj = n(row.cum_nav_withdrawal) ?? n(row.cumulative_nav)
    const point: NavPoint = {
      nav: unit,
      nav_date: row.price_date.slice(0, 10),
      return_nav: adj != null && adj > 0 ? adj : unit,
    }
    pushPoint(byKey, row.beian_hao, point)
    if (row.product_name) pushPoint(byKey, row.product_name, point)
  }
  for (const row of emailRows) {
    const unit = n(row.nav)
    if (unit == null || unit <= 0) continue
    const adj = n(row.cumulative_nav)
    const point: NavPoint = {
      nav: unit,
      nav_date: row.nav_date.slice(0, 10),
      return_nav: adj != null && adj > 0 ? adj : unit,
    }
    if (row.code) pushPoint(byKey, row.code, point)
    if (row.fund_name) pushPoint(byKey, row.fund_name, point)
  }

  const seriesOf = (keys: string[]): NavPoint[] => {
    const byDate = new Map<string, NavPoint>()
    for (const key of keys) {
      const points = byKey.get(key) ?? byKey.get(key.toUpperCase())
      if (!points) continue
      for (const [d, p] of points) {
        const prev = byDate.get(d)
        if (!prev) byDate.set(d, p)
        else if ((p.return_nav ?? p.nav) !== p.nav && (prev.return_nav ?? prev.nav) === prev.nav) byDate.set(d, p)
      }
    }
    return [...byDate.values()].sort((a, b) => a.nav_date.localeCompare(b.nav_date))
  }

  const out = new Map<string, NavPoint[]>()
  for (const fund of funds) {
    const keys = [
      fund.beian_hao,
      fund.beian_hao.toUpperCase(),
      fund.beian_hao.replace(/[ABC]$/i, ""),
      fund.product_name,
      fund.short_name ?? "",
    ]
    out.set(fund.beian_hao, seriesOf(keys.filter(Boolean)))
  }
  return out
}

async function computeFundMetrics(
  funds: WeeklyReviewFund[],
  asOf: string,
): Promise<FundMetrics[]> {
  console.time("[jy-weekly-review] load nav histories")
  const histories = await loadWeeklyReviewNavHistories(funds, asOf)
  console.timeEnd("[jy-weekly-review] load nav histories")
  const from = addDays(asOf, NAV_HISTORY_LOOKBACK_DAYS + 40)
  const benchCodes = [...new Set(Object.values(BENCH_BY_BUCKET).flat())]
  const [ashare, spot] = await Promise.all([
    loadAshareCloses(benchCodes, from, asOf),
    loadSpotCloses(["IH", "IF", "IC", "IM"], from, asOf),
  ])
  const benchCache = new Map<string, Map<string, number>>()
  function benchForBucket(bucket: string): Map<string, number> | null {
    if (benchCache.has(bucket)) return benchCache.get(bucket)!
    const codes = BENCH_BY_BUCKET[bucket] ?? BENCH_BY_BUCKET["指数增强"]
    const picked = pickSeries(ashare, spot, codes, bucket.includes("300") ? "IF" : bucket.includes("1000") ? "IM" : "IC")
    const series = picked?.series ?? null
    if (series) benchCache.set(bucket, series)
    return series
  }

  const out: FundMetrics[] = []
  for (const fund of funds) {
    const bucket = bucketForFund(fund)
    const mode = metricModeForBucket(bucket)
    const history = enrichReturnNavSeries(histories.get(fund.beian_hao) ?? [])
    const latest = history.filter((p) => p.nav_date <= asOf).at(-1) ?? null
    const unitNav = latest?.nav ?? navValue(latest) ?? 0
    const ret = latest
      ? calcPeriodReturnsFromHistory(history, unitNav, asOf, latest)
      : { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null }
    const risk = mode === "absolute"
      ? computeOneYearRiskMetrics(asOf, history.filter((p) => p.nav_date >= addDays(asOf, 365)))
      : { sharpe_1y: null, calmar_1y: null }

    let excess: Record<PeriodKey, number | null> = {
      ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null,
    }
    let excess_dd_6m: number | null = null
    let excess_dd_1y: number | null = null
    if (mode === "excess") {
      const bench = benchForBucket(bucket)
      if (bench) {
        const win = excessWindows(history, bench, asOf)
        excess = win.excess
        excess_dd_6m = win.excess_dd_6m
        excess_dd_1y = win.excess_dd_1y
      }
    }

    out.push({
      beian_hao: fund.beian_hao,
      name: displayName(fund.product_name, fund.short_name),
      bucket,
      mode,
      ret,
      excess,
      excess_dd_6m,
      excess_dd_1y,
      sharpe_1y: isPlausibleRiskRatio(risk.sharpe_1y) ? risk.sharpe_1y : null,
      calmar_1y: isPlausibleRiskRatio(risk.calmar_1y) ? risk.calmar_1y : null,
    })
  }
  return out
}

function fmtSlashDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${y}/${Number(m)}/${Number(d)}`
}

type CellStyle = {
  font?: { name?: string; sz?: number; bold?: boolean; color?: { rgb: string } }
  fill?: { patternType: "solid"; fgColor: { rgb: string } }
  alignment?: { wrapText?: boolean; vertical?: string; horizontal?: string }
  numFmt?: string
  border?: Record<string, { style: string; color: { rgb: string } }>
}

function headerStyle(): CellStyle {
  return {
    font: { name: FONT_NAME, sz: 11, bold: true, color: { rgb: "FFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: HEADER_FILL } },
    alignment: { wrapText: true, vertical: "center" },
  }
}

function bodyStyle(alt: boolean, color?: string, numFmt?: string): CellStyle {
  const s: CellStyle = {
    font: { name: FONT_NAME, sz: 11, color: color ? { rgb: color } : undefined },
    alignment: { wrapText: true, vertical: "center" },
  }
  if (alt) s.fill = { patternType: "solid", fgColor: { rgb: ALT_FILL } }
  if (numFmt) s.numFmt = numFmt
  return s
}

function signedColor(v: number | null): string | undefined {
  if (v == null || !Number.isFinite(v) || v === 0) return undefined
  return v > 0 ? RED : GREEN
}

function sheetName(seq: number, title: string): string {
  return `${String(seq).padStart(2, "0")}_${title}`.replace(/[:\\/?*[\]]/g, " ").slice(0, 31)
}

async function loadMarketBreadth(from: string, to: string): Promise<Array<{
  date: string
  amountYi: number | null
  advancers: number | null
}>> {
  const rows = await query<{
    trade_date: Date | string
    total_amount: string | number | null
    advancers: string | number | null
  }>(
    `SELECT trade_date, total_amount, advancers
     FROM derived_ashare_market_breadth_daily
     WHERE trade_date >= $1::date AND trade_date <= $2::date
     ORDER BY trade_date ASC`,
    [from, to],
  ).catch(() => [])
  return rows.map((row) => {
    const amount = n(row.total_amount)
    const amountYi = amount == null ? null : amount >= 1e6 ? amount / 1e8 : amount
    return {
      date: fmtIso(row.trade_date),
      amountYi,
      advancers: n(row.advancers),
    }
  })
}

async function buildMarketRows(weekStart: string, weekEnd: string) {
  const from = addDays(weekEnd, 20)
  const allCodes = [
    ...MARKET_INDICES.flatMap((x) => x.codes),
    ...STYLE_INDICES.flatMap((x) => x.codes),
    ...SECTOR_INDICES.flatMap((x) => x.codes),
  ]
  const spots = MARKET_INDICES.map((x) => x.spot).filter((s): s is string => !!s)
  const [ashare, spot, breadth] = await Promise.all([
    loadAshareCloses(allCodes, from, weekEnd),
    loadSpotCloses(spots, from, weekEnd),
    loadMarketBreadth(weekStart, weekEnd),
  ])

  function weeklyRet(codes: string[], spotSymbol?: string): { code: string | null; ret: number | null } {
    const picked = pickSeries(ashare, spot, codes, spotSymbol)
    if (!picked) return { code: null, ret: null }
    return { code: picked.code, ret: periodReturnFromSeries(picked.series, weekEnd, 7) }
  }

  const broad = MARKET_INDICES.map((idx) => ({
    name: idx.name,
    ...weeklyRet(idx.codes, idx.spot),
  }))
  const style = STYLE_INDICES.map((idx) => ({
    name: idx.name,
    ...weeklyRet(idx.codes),
  }))
  const sector = SECTOR_INDICES.map((idx) => ({
    name: idx.name,
    ...weeklyRet(idx.codes),
  }))
  const amountPts = breadth.filter((r) => r.amountYi != null)
  const advPts = breadth.filter((r) => r.advancers != null)
  const avgAmount = amountPts.length
    ? amountPts.reduce((s, r) => s + (r.amountYi as number), 0) / amountPts.length
    : null
  const avgAdv = advPts.length
    ? advPts.reduce((s, r) => s + (r.advancers as number), 0) / advPts.length
    : null
  return {
    broad,
    style,
    sector,
    breadth,
    avgAmount: Number.isFinite(avgAmount) ? avgAmount : null,
    avgAdv: Number.isFinite(avgAdv) ? avgAdv : null,
    rangeLabel: `${fmtSlashDate(weekStart)} ~ ${fmtSlashDate(weekEnd)}`,
  }
}

export async function generateJyWeeklyReviewWorkbook(weekEndRaw: string): Promise<{
  buffer: Buffer
  fileName: string
  fundCount: number
  groupCount: number
}> {
  const { weekStart, weekEnd, asOf } = resolveWeekWindow(weekEndRaw)
  const funds = (await loadJyTrackingPoolFunds()).filter(isEquityFund)
  if (funds.length === 0) {
    throw new Error("JY跟踪池中没有可导出的股票策略产品")
  }

  const [metrics, market] = await Promise.all([
    computeFundMetrics(funds, asOf),
    buildMarketRows(weekStart, weekEnd),
  ])

  const xlsxMod = await import("xlsx-js-style") as {
    default?: typeof import("xlsx")
    utils?: typeof import("xlsx")["utils"]
    write?: (wb: unknown, opts: { bookType: string; type: string; cellStyles?: boolean }) => Buffer
  }
  const XLSX = (xlsxMod.utils ? xlsxMod : xlsxMod.default) as typeof import("xlsx") & {
    write: (wb: unknown, opts: { bookType: string; type: string; cellStyles?: boolean }) => Buffer
  }

  const wb = XLSX.utils.book_new()
  const groups = new Map<string, FundMetrics[]>()
  for (const row of metrics) {
    const list = groups.get(row.bucket) ?? []
    list.push(row)
    groups.set(row.bucket, list)
  }
  const orderedBuckets = [...groups.keys()].sort((a, b) => groupSortKey(a).localeCompare(groupSortKey(b), "zh"))

  const tocRows: unknown[][] = [["页码", "工作表", "标题", "行数", "列数"]]
  const sheets: Array<{ name: string; title: string; rows: number; cols: number; aoa: unknown[][]; styles: Map<string, CellStyle> }> = []

  // ── market sheet ────────────────────────────────────────────────────────
  {
    const aoa: unknown[][] = []
    const styles = new Map<string, CellStyle>()
    const set = (r: number, c: number, v: unknown, s?: CellStyle) => {
      while (aoa.length <= r) aoa.push([])
      aoa[r][c] = v
      if (s) styles.set(`${r},${c}`, s)
    }
    const dateHeader: CellStyle = {
      ...headerStyle(),
      alignment: { wrapText: false, vertical: "center" },
    }
    set(0, 0, "起止日期", dateHeader)
    set(0, 1, market.rangeLabel, dateHeader)
    const headers = ["宽基指数", "代码", "涨跌幅", "风格指数", "代码", "涨跌幅", "全A成交量", "上涨家数", "大类指数", "代码", "涨跌幅"]
    headers.forEach((h, c) => set(1, c, h, bodyStyle(true)))
    const nRows = Math.max(market.broad.length, market.style.length, market.sector.length)
    for (let i = 0; i < nRows; i++) {
      const alt = i % 2 === 1
      const b = market.broad[i]
      const st = market.style[i]
      const se = market.sector[i]
      if (b) {
        set(2 + i, 0, b.name, bodyStyle(alt))
        set(2 + i, 1, b.code, bodyStyle(alt))
        set(2 + i, 2, b.ret, bodyStyle(alt, signedColor(b.ret), "0.00%"))
      }
      if (st) {
        set(2 + i, 3, st.name, bodyStyle(alt))
        set(2 + i, 4, st.code, bodyStyle(alt))
        set(2 + i, 5, st.ret, bodyStyle(alt, signedColor(st.ret), "0.00%"))
      }
      if (se) {
        set(2 + i, 8, se.name, bodyStyle(alt))
        set(2 + i, 9, se.code, bodyStyle(alt))
        set(2 + i, 10, se.ret, bodyStyle(alt, signedColor(se.ret), "0.00%"))
      }
    }
    market.breadth.slice(0, 5).forEach((day, i) => {
      const alt = i % 2 === 1
      const amount = day.amountYi == null ? null : Math.round(day.amountYi)
      const adv = day.advancers == null ? null : Math.round(day.advancers)
      set(2 + i, 6, amount, bodyStyle(alt, undefined, "#,##0"))
      set(2 + i, 7, adv, bodyStyle(alt, undefined, "#,##0"))
    })
    set(7, 6, "日均成交量", bodyStyle(true))
    set(7, 7, "平均上涨家数", bodyStyle(true))
    set(8, 6, market.avgAmount == null ? null : Math.round(market.avgAmount), bodyStyle(false, undefined, "#,##0"))
    set(8, 7, market.avgAdv == null ? null : Math.round(market.avgAdv), bodyStyle(false, undefined, "#,##0"))
    const commentRow = 2 + nRows + 1
    set(commentRow, 0, "原文评述", undefined)
    set(commentRow + 1, 0, "", undefined)
    const name = sheetName(3, "股票市场回顾")
    sheets.push({ name, title: "股票市场回顾", rows: nRows, cols: 11, aoa, styles })
    tocRows.push([3, name, "股票市场回顾", nRows, 11])
  }

  let seq = 4
  for (const bucket of orderedBuckets) {
    const rows = groups.get(bucket) ?? []
    if (rows.length === 0) continue
    const mode = metricModeForBucket(bucket)
    const headers = mode === "excess"
      ? ["产品名称", "近一周超额收益", "近一月超额收益", "近三月超额收益", "近六月超额收益", "近六月超额最大回撤", "近一年超额收益", "近一年超额最大回撤"]
      : ["产品名称", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普比率", "近一年卡玛比率"]
    const sorted = [...rows].sort((a, b) => {
      const av = mode === "excess" ? a.excess.ret_1w : a.ret.ret_1w
      const bv = mode === "excess" ? b.excess.ret_1w : b.ret.ret_1w
      return (bv ?? -Infinity) - (av ?? -Infinity)
    })
    const aoa: unknown[][] = []
    const styles = new Map<string, CellStyle>()
    const set = (r: number, c: number, v: unknown, s?: CellStyle) => {
      while (aoa.length <= r) aoa.push([])
      aoa[r][c] = v ?? null
      if (s) styles.set(`${r},${c}`, s)
    }
    headers.forEach((h, c) => set(0, c, h, headerStyle()))
    sorted.forEach((row, i) => {
      const alt = i % 2 === 0
      set(i + 1, 0, row.name, bodyStyle(alt))
      if (mode === "excess") {
        const vals = [
          row.excess.ret_1w, row.excess.ret_1m, row.excess.ret_3m, row.excess.ret_6m,
          row.excess_dd_6m, row.excess.ret_1y, row.excess_dd_1y,
        ]
        vals.forEach((v, ci) => {
          const isDd = ci === 4 || ci === 6
          set(i + 1, ci + 1, v, bodyStyle(alt, isDd ? undefined : signedColor(v), "0.00%"))
        })
      } else {
        const pcts = [row.ret.ret_1w, row.ret.ret_1m, row.ret.ret_3m, row.ret.ret_6m, row.ret.ret_1y]
        pcts.forEach((v, ci) => set(i + 1, ci + 1, v, bodyStyle(alt, signedColor(v), "0.00%")))
        set(i + 1, 6, row.sharpe_1y, bodyStyle(alt, undefined, "0.0000"))
        set(i + 1, 7, row.calmar_1y, bodyStyle(alt, undefined, "0.0000"))
      }
    })
    const name = sheetName(seq, bucket)
    sheets.push({ name, title: bucket, rows: sorted.length, cols: 8, aoa, styles })
    tocRows.push([seq, name, bucket, sorted.length, 8])
    seq += 1
  }

  const tocWs = XLSX.utils.aoa_to_sheet(tocRows)
  styleAoaSheet(tocWs, tocRows.length, 5, (r, c) => (r === 0 ? headerStyle() : undefined), XLSX)
  tocWs["!cols"] = [{ wch: 10 }, { wch: 28 }, { wch: 22 }, { wch: 10 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, tocWs, "目录")

  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.aoa)
    const maxCol = Math.max(0, ...sheet.aoa.map((r) => r.length))
    styleAoaSheet(ws, sheet.aoa.length, maxCol, (r, c) => sheet.styles.get(`${r},${c}`), XLSX)
    if (sheet.title === "股票市场回顾") {
      ws["!cols"] = [
        { wch: 14 }, { wch: 22 }, { wch: 10 },
        { wch: 12 }, { wch: 14 }, { wch: 10 },
        { wch: 14 }, { wch: 14 },
        { wch: 12 }, { wch: 12 }, { wch: 10 },
      ]
      ws["!rows"] = Array.from({ length: sheet.aoa.length }, (_, i) => ({ hpt: i === 0 ? 20 : 22 }))
    } else {
      ws["!cols"] = [{ wch: 22 }, ...Array.from({ length: Math.max(0, maxCol - 1) }, () => ({ wch: 14 }))]
      ws["!rows"] = Array.from({ length: sheet.aoa.length }, () => ({ hpt: 27 }))
    }
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }

  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer", cellStyles: true }) as unknown as Buffer
  const yy = weekEnd.slice(2, 4)
  const mm = weekEnd.slice(5, 7)
  const dd = weekEnd.slice(8, 10)
  const fileName = `JY跟踪池周度回顾（股票） - ${yy}.${mm}.${dd}.xlsx`
  return { buffer, fileName, fundCount: funds.length, groupCount: orderedBuckets.length }
}

function styleAoaSheet(
  ws: Record<string, unknown>,
  rows: number,
  cols: number,
  styleAt: (r: number, c: number) => CellStyle | undefined,
  XLSX: typeof import("xlsx"),
) {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = ws[addr] as { t?: string; v?: unknown; s?: CellStyle; z?: string } | undefined
      if (!cell) continue
      const style = styleAt(r, c)
      if (style) {
        cell.s = style
        if (style.numFmt) cell.z = style.numFmt
      }
    }
  }
}

const JOB_ROOT = path.join(process.cwd(), ".tmp", "jy-weekly-review")

export type WeeklyReviewJobPhase = "pending" | "running" | "done" | "error"

export type WeeklyReviewJobStatus = {
  status: WeeklyReviewJobPhase
  jobId: string
  updatedAt: string
  error?: string
  fileName?: string
  fundCount?: number
  groupCount?: number
}

export function isValidWeeklyReviewJobId(id: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(id)
}

function jobDir(jobId: string): string {
  return path.join(JOB_ROOT, jobId)
}

function jobStatusPath(jobId: string): string {
  return path.join(jobDir(jobId), "status.json")
}

function jobFilePath(jobId: string): string {
  return path.join(jobDir(jobId), "report.xlsx")
}

async function writeJobStatus(status: WeeklyReviewJobStatus): Promise<void> {
  await mkdir(jobDir(status.jobId), { recursive: true })
  await writeFile(jobStatusPath(status.jobId), JSON.stringify(status), "utf8")
}

export async function prepareWeeklyReviewJob(): Promise<string> {
  const jobId = randomUUID()
  await writeJobStatus({
    status: "pending",
    jobId,
    updatedAt: new Date().toISOString(),
  })
  return jobId
}

export async function getWeeklyReviewJobStatus(jobId: string): Promise<WeeklyReviewJobStatus> {
  if (!isValidWeeklyReviewJobId(jobId)) throw new Error("无效的任务 ID")
  const raw = await readFile(jobStatusPath(jobId), "utf8").catch(() => null)
  if (!raw) throw new Error("任务不存在")
  return JSON.parse(raw) as WeeklyReviewJobStatus
}

export async function readWeeklyReviewJobFile(jobId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const status = await getWeeklyReviewJobStatus(jobId)
  if (status.status !== "done" || !status.fileName) throw new Error("文件尚未生成")
  const buffer = await readFile(jobFilePath(jobId))
  return { buffer, fileName: status.fileName }
}

export async function runWeeklyReviewJob(jobId: string, weekEnd: string): Promise<void> {
  await writeJobStatus({
    status: "running",
    jobId,
    updatedAt: new Date().toISOString(),
  })
  try {
    console.time("[jy-weekly-review] generate workbook")
    const result = await generateJyWeeklyReviewWorkbook(weekEnd)
    console.timeEnd("[jy-weekly-review] generate workbook")
    await mkdir(jobDir(jobId), { recursive: true })
    await writeFile(jobFilePath(jobId), result.buffer)
    await writeJobStatus({
      status: "done",
      jobId,
      updatedAt: new Date().toISOString(),
      fileName: result.fileName,
      fundCount: result.fundCount,
      groupCount: result.groupCount,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[jy-weekly-review] job failed:", message)
    await writeJobStatus({
      status: "error",
      jobId,
      updatedAt: new Date().toISOString(),
      error: message,
    })
  }
}

