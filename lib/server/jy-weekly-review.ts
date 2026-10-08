/**
 * JY 跟踪池周度回顾 Excel — layout follows 博孚利周度回顾（股票）:
 * 目录 + 口径说明 + 股票市场回顾 + one sheet per 团队策略 bucket.
 */

import { randomUUID } from "crypto"
import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { fmtIso, n, query, queryUnbounded } from "@/lib/db"
import { computeFundNavMetrics, isPlausibleRiskRatio } from "@/lib/fund-nav-metrics"
import { isPlausibleEmailUnitNav, recoverPlausibleEmailUnitNav } from "@/lib/server/email-nav-query"
import { parseStrategyLevel3 } from "@/lib/ma/strategy-level3"
import { resolveFundDisplayLabel } from "@/lib/fund-display-name"
import { beianFamilyKey } from "@/lib/server/share-class-product"
import { isChinaTradingDay, shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
import {
  addDays,
  calcPeriodReturnsFromHistory,
  calendarDaysBetween,
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

export type MetricMode = "excess" | "absolute"

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

export type FundMetrics = {
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

export const BENCH_BY_BUCKET: Record<string, string[]> = {
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

export function displayName(
  productName: string,
  shortName: string | null,
  beianHao?: string | null,
): string {
  return resolveFundDisplayLabel(shortName, productName, beianHao) || productName
}

/** Sheet label with share-class / 份额 markers removed, so parent and A/B/C match. */
function weeklyReviewNameKey(fund: WeeklyReviewFund): string {
  const base = displayName(fund.product_name, fund.short_name)
    .replace(/[ABC]类份额$/u, "")
    .replace(/份额$/u, "")
    .replace(/[ABC]类$/u, "")
    .replace(/\s+/g, "")
  return base || fund.beian_hao.trim().toUpperCase()
}

/** Share class before the main filing when NAV coverage ties; A before B before C. */
function representativeRank(beian: string): [number, number] {
  const code = beian.trim().toUpperCase()
  const classRank = /A$/.test(code) ? 0 : /B$/.test(code) ? 1 : /C$/.test(code) ? 2 : 3
  const sRank = code.startsWith("S") ? 0 : 1
  return [classRank, sRank]
}

function navCoverageOf(fund: WeeklyReviewFund, coverage: Map<string, number> | undefined): number {
  if (!coverage) return 0
  return coverage.get(fund.beian_hao.trim().toUpperCase()) ?? 0
}

function preferWeeklyReviewFund(
  a: WeeklyReviewFund,
  b: WeeklyReviewFund,
  coverage?: Map<string, number>,
): WeeklyReviewFund {
  const na = navCoverageOf(a, coverage)
  const nb = navCoverageOf(b, coverage)
  if (na !== nb) return na > nb ? a : b
  const [ca, sa] = representativeRank(a.beian_hao)
  const [cb, sb] = representativeRank(b.beian_hao)
  if (ca !== cb) return ca < cb ? a : b
  if (sa !== sb) return sa < sb ? a : b
  return a
}

function collapseByKey(
  funds: WeeklyReviewFund[],
  keyOf: (fund: WeeklyReviewFund) => string,
  coverage?: Map<string, number>,
): WeeklyReviewFund[] {
  const best = new Map<string, WeeklyReviewFund>()
  const order: string[] = []
  for (const fund of funds) {
    const key = keyOf(fund)
    const prev = best.get(key)
    if (!prev) {
      best.set(key, fund)
      order.push(key)
      continue
    }
    best.set(key, preferWeeklyReviewFund(prev, fund, coverage))
  }
  return order.map((key) => best.get(key)!)
}

/**
 * One row per product inside a strategy sheet.
 * Parent + A/B/C (and same-name alias codes) stay separate when they fall in different buckets.
 */
export function collapseWeeklyReviewFunds(
  funds: WeeklyReviewFund[],
  coverage?: Map<string, number>,
): WeeklyReviewFund[] {
  const byFamily = collapseByKey(funds, (fund) => {
    const family = beianFamilyKey(fund.beian_hao) || fund.beian_hao.trim().toUpperCase()
    return `${family}\0${bucketForFund(fund)}`
  }, coverage)
  return collapseByKey(byFamily, (fund) => `${weeklyReviewNameKey(fund)}\0${bucketForFund(fund)}`, coverage)
}

function fundsNeedingCoverage(funds: WeeklyReviewFund[]): WeeklyReviewFund[] {
  const collisions = (keyOf: (fund: WeeklyReviewFund) => string) => {
    const groups = new Map<string, WeeklyReviewFund[]>()
    for (const fund of funds) {
      const key = keyOf(fund)
      const list = groups.get(key) ?? []
      list.push(fund)
      groups.set(key, list)
    }
    return [...groups.values()].filter((list) => list.length > 1).flat()
  }
  const familyKey = (fund: WeeklyReviewFund) => {
    const family = beianFamilyKey(fund.beian_hao) || fund.beian_hao.trim().toUpperCase()
    return `${family}\0${bucketForFund(fund)}`
  }
  const seen = new Set<string>()
  const out: WeeklyReviewFund[] = []
  for (const fund of [...collisions(familyKey), ...collisions((fund) => `${weeklyReviewNameKey(fund)}\0${bucketForFund(fund)}`)]) {
    const code = fund.beian_hao.trim().toUpperCase()
    if (seen.has(code)) continue
    seen.add(code)
    out.push(fund)
  }
  return out
}
/**
 * Own-series length for parent vs A/B/C that share a sheet row.
 * Sibling codes are not merged, so the invested email class can win when it has more points.
 */
export async function loadWeeklyReviewNavCoverage(
  funds: WeeklyReviewFund[],
  asOf: string,
): Promise<Map<string, number>> {
  const codes = [...new Set(fundsNeedingCoverage(funds).map((f) => f.beian_hao.trim().toUpperCase()).filter(Boolean))]
  const out = new Map<string, number>()
  if (codes.length === 0) return out
  const rows = await query<{ code: string; n: string | number }>(
    `WITH email AS (
       SELECT UPPER(BTRIM(product_code)) AS code, COUNT(DISTINCT nav_date)::int AS n
       FROM ops_email_nav_records
       WHERE nav IS NOT NULL
         AND nav_date <= $2::date
         AND BTRIM(product_code) <> ''
         AND UPPER(BTRIM(product_code)) = ANY($1::text[])
       GROUP BY 1
     ),
     legacy AS (
       SELECT UPPER(BTRIM(beian_hao)) AS code, COUNT(DISTINCT price_date)::int AS n
       FROM private_fund_nav
       WHERE nav IS NOT NULL
         AND price_date <= $2::date
         AND UPPER(BTRIM(beian_hao)) = ANY($1::text[])
       GROUP BY 1
     ),
     cache AS (
       SELECT UPPER(BTRIM(beian_hao)) AS code,
              jsonb_array_length(COALESCE(nav_series, '[]'::jsonb)) AS n
       FROM ops_private_fund_detail_nav_cache
       WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])
     )
     SELECT code, MAX(n)::int AS n
     FROM (
       SELECT code, n FROM email
       UNION ALL SELECT code, n FROM legacy
       UNION ALL SELECT code, n FROM cache
     ) src
     WHERE code IS NOT NULL
     GROUP BY code`,
    [codes, asOf],
  ).catch((err: unknown) => {
    console.error("[jy-weekly-review] nav coverage failed:", err)
    return [] as Array<{ code: string; n: string | number }>
  })
  for (const row of rows) {
    const nPoints = Number(row.n)
    if (row.code && Number.isFinite(nPoints)) out.set(row.code, nPoints)
  }
  return out
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

export function periodReturnFromSeries(series: Map<string, number>, asOf: string, days: number): number | null {
  const end = closeOnOrBefore(series, asOf)
  const start = closeOnOrBefore(series, addDays(asOf, days))
  if (!end || !start || start.date >= end.date) return null
  return calcReturn(end.value, start.value)
}

export async function loadAshareCloses(codes: string[], from: string, to: string): Promise<Map<string, Map<string, number>>> {
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

export async function loadSpotCloses(symbols: string[], from: string, to: string): Promise<Map<string, Map<string, number>>> {
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

export function pickSeries(
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

/**
 * Period return ending at the last NAV on/before asOf, not a tight [asOf-days, asOf] box.
 * minEndDate rejects a window whose end print is older than the report week.
 */
function periodReturnAt(
  dates: string[],
  values: number[],
  asOf: string,
  days: number,
  minEndDate?: string,
): number | null {
  let endIdx = -1
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] <= asOf) endIdx = i
  }
  if (endIdx < 1) return null
  const endDate = dates[endIdx]
  if (minEndDate && endDate < minEndDate) return null
  const target = addDays(endDate, days)
  let startIdx = -1
  for (let i = 0; i < endIdx; i++) {
    if (dates[i] <= target) startIdx = i
  }
  const slack = Math.max(days <= 9 ? 8 : 5, Math.floor(days * 0.2))
  const minSpan = Math.floor(days * 0.65)
  const gapOf = (idx: number) => calendarDaysBetween(endDate, dates[idx])
  const acceptable = (idx: number) => {
    if (idx < 0 || idx >= endIdx) return false
    const gap = gapOf(idx)
    if (gap <= 0) return false
    if (days <= 90 && gap > days + slack) return false
    if (gap < minSpan && days > 14) return false
    return true
  }
  if (!acceptable(startIdx)) {
    // Lookback date falls in a publication hole (天演 2026-05-22→06-26).
    // Use the first NAV after the hole when the remaining window is still most of the period.
    let inside = -1
    for (let i = Math.max(startIdx, 0); i < endIdx; i++) {
      if (dates[i] > target) {
        inside = i
        break
      }
    }
    if (acceptable(inside)) startIdx = inside
    else if (days >= 180 && acceptable(0)) startIdx = 0
    else if (days <= 14 && endIdx >= 1) startIdx = endIdx - 1
    else return null
  }
  const ret = values[endIdx] / values[startIdx] - 1
  return Number.isFinite(ret) ? ret : null
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
  const latestDate = excessDates.filter((d) => d <= asOf).at(-1) ?? asOf
  const weekStart = mondayOfWeek(asOf)

  const dd = (days: number): number | null => {
    const w = windowSlice(excessDates, excessVals, latestDate, days)
    if (w.values.length < 2) return null
    const metrics = computeFundNavMetrics(w)
    return metrics && Number.isFinite(metrics.maxDD) ? metrics.maxDD : null
  }
  return {
    excess: {
      ret_1w: periodReturnAt(excessDates, excessVals, asOf, 7, weekStart),
      ret_1m: periodReturnAt(excessDates, excessVals, asOf, 30),
      ret_3m: periodReturnAt(excessDates, excessVals, asOf, 90),
      ret_6m: periodReturnAt(excessDates, excessVals, asOf, 180),
      ret_1y: periodReturnAt(excessDates, excessVals, asOf, 365),
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

export function isEquityFund(fund: WeeklyReviewFund): boolean {
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
  const equity = (await loadJyTrackingPoolFunds()).filter(isEquityFund)
  const coverage = await loadWeeklyReviewNavCoverage(equity, asOf)
  const funds = collapseWeeklyReviewFunds(equity, coverage)
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

/** Keep unit and 复权 on a per-share scale. Asset-value rows (SBPC20 基金资产净值) are repaired or dropped. */
function weeklyReturnPoint(
  date: string,
  unitRaw: number | null,
  cumulativeRaw: number | null,
  adjustedRaw: number | null,
): NavPoint | null {
  const unit = recoverPlausibleEmailUnitNav(unitRaw, cumulativeRaw ?? adjustedRaw)
  if (unit == null) return null
  let returnNav = unit
  for (const candidate of [adjustedRaw, cumulativeRaw]) {
    if (candidate == null || !isPlausibleEmailUnitNav(candidate)) continue
    const ratio = candidate / unit
    if (ratio < 0.85 || ratio > 2.5) continue
    if (candidate >= returnNav) returnNav = candidate
  }
  return { nav: unit, nav_date: date.slice(0, 10), return_nav: returnNav }
}

/** Cache that stops or jumps while email still has a dense recent series (贞元虎踞一号) should not win. */
function recentHole(points: NavPoint[], asOf: string): boolean {
  const recent = points.filter((p) => p.nav_date >= addDays(asOf, 45) && p.nav_date <= asOf)
  if (recent.length < 2) return true
  for (let i = 1; i < recent.length; i++) {
    if (calendarDaysBetween(recent[i].nav_date, recent[i - 1].nav_date) > 14) return true
  }
  return false
}

function preferWeeklyNavSeries(
  cached: NavPoint[] | undefined,
  emailSeries: NavPoint[],
  asOf: string,
): NavPoint[] {
  if (!cached || cached.length < 2) return emailSeries
  if (emailSeries.length < 2) return cached
  const cacheTip = cached[cached.length - 1]?.nav_date ?? ""
  const emailTip = emailSeries[emailSeries.length - 1]?.nav_date ?? ""
  if (emailTip > cacheTip) return emailSeries
  if (recentHole(cached, asOf) && !recentHole(emailSeries, asOf)) return emailSeries
  if (emailSeries.length > cached.length && emailTip >= cacheTip && !recentHole(emailSeries, asOf)) return emailSeries
  return cached
}

function pushPoint(target: Map<string, Map<string, NavPoint>>, key: string, point: NavPoint) {
  const k = key.trim()
  if (!k || !isChinaTradingDay(point.nav_date) || !(point.nav > 0)) return
  for (const mapKey of [k, k.toUpperCase()]) {
    if (!target.has(mapKey)) target.set(mapKey, new Map())
    const byDate = target.get(mapKey)!
    const prev = byDate.get(point.nav_date)
    if (!prev) {
      byDate.set(point.nav_date, point)
      continue
    }
    const prevRet = prev.return_nav ?? prev.nav
    const nextRet = point.return_nav ?? point.nav
    if (nextRet !== point.nav && prevRet === prev.nav) byDate.set(point.nav_date, point)
  }
}

export async function loadWeeklyReviewNavHistories(
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
    adjusted_nav: string | number | null
  }
  type CacheRow = {
    beian_hao: string
    nav_series: Array<{
      price_date?: string
      nav?: string | number | null
      cumulative_nav?: string | number | null
      cum_nav_withdrawal?: string | number | null
    }>
  }
  type LegacyRow = {
    beian_hao: string
    product_name: string | null
    price_date: string
    nav: string | number | null
    cumulative_nav: string | number | null
    cum_nav_withdrawal: string | number | null
  }

  const [emailRows, legacyRows, cacheRows] = await Promise.all([
    queryUnbounded<EmailRow>(
      `SELECT BTRIM(product_code) AS code, NULLIF(BTRIM(fund_name), '') AS fund_name,
              nav_date::text AS nav_date, nav, cumulative_nav, adjusted_nav
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
    queryUnbounded<CacheRow>(
      `SELECT UPPER(BTRIM(beian_hao)) AS beian_hao, nav_series
       FROM ops_private_fund_detail_nav_cache
       WHERE UPPER(BTRIM(beian_hao)) = ANY($1::text[])`,
      [beians.map((b) => b.toUpperCase())],
    ).catch(() => [] as CacheRow[]),
  ])

  const byKey = new Map<string, Map<string, NavPoint>>()
  const cacheByBeian = new Map<string, NavPoint[]>()
  for (const row of cacheRows) {
    const points: NavPoint[] = []
    for (const item of row.nav_series ?? []) {
      const date = String(item.price_date ?? "").slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > asOf || date < since) continue
      const point = weeklyReturnPoint(
        date,
        n(item.nav),
        n(item.cumulative_nav),
        n(item.cum_nav_withdrawal),
      )
      if (point) points.push(point)
    }
    if (points.length >= 2) cacheByBeian.set(row.beian_hao.toUpperCase(), points)
  }
  for (const row of legacyRows) {
    const point = weeklyReturnPoint(
      row.price_date,
      n(row.nav),
      n(row.cumulative_nav),
      n(row.cum_nav_withdrawal),
    )
    if (!point) continue
    pushPoint(byKey, row.beian_hao, point)
    if (row.product_name) pushPoint(byKey, row.product_name, point)
  }
  for (const row of emailRows) {
    const point = weeklyReturnPoint(row.nav_date, n(row.nav), n(row.cumulative_nav), n(row.adjusted_nav))
    if (!point) continue
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
    const trimmed = fund.beian_hao.trim()
    const noClass = trimmed.replace(/[ABC]$/i, "")
    const withS = /^S/i.test(noClass) ? noClass : `S${noClass}`
    const keys = [
      ...expandBeiansWithShareClassFamily([trimmed]),
      trimmed,
      trimmed.toUpperCase(),
      noClass,
      withS,
      fund.product_name,
      fund.short_name ?? "",
    ]
    const cached = cacheByBeian.get(trimmed.toUpperCase())
    const emailSeries = seriesOf([...new Set(keys.map((k) => k.trim()).filter(Boolean))])
    out.set(fund.beian_hao, preferWeeklyNavSeries(cached, emailSeries, asOf))
  }
  return out
}

export type FundMetricsOptions = {
  bucketFor?: (fund: WeeklyReviewFund) => string
  modeFor?: (bucket: string) => MetricMode
}

export async function computeFundMetrics(
  funds: WeeklyReviewFund[],
  asOf: string,
  preloadedHistories?: Map<string, NavPoint[]>,
  opts?: FundMetricsOptions,
): Promise<FundMetrics[]> {
  const resolveBucket = opts?.bucketFor ?? bucketForFund
  const resolveMode = opts?.modeFor ?? metricModeForBucket
  console.time("[jy-weekly-review] load nav histories")
  const histories = preloadedHistories ?? await loadWeeklyReviewNavHistories(funds, asOf)
  console.timeEnd("[jy-weekly-review] load nav histories")
  const from = addDays(asOf, NAV_HISTORY_LOOKBACK_DAYS + 40)
  const needsExcess = opts
    ? funds.some((fund) => resolveMode(resolveBucket(fund)) === "excess")
    : true
  const benchCodes = [...new Set(Object.values(BENCH_BY_BUCKET).flat())]
  const [ashare, spot] = needsExcess
    ? await Promise.all([
      loadAshareCloses(benchCodes, from, asOf),
      loadSpotCloses(["IH", "IF", "IC", "IM"], from, asOf),
    ])
    : [new Map<string, Map<string, number>>(), new Map<string, Map<string, number>>()]
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
    const bucket = resolveBucket(fund)
    const mode = resolveMode(bucket)
    const history = enrichReturnNavSeries(histories.get(fund.beian_hao) ?? [])
    const latest = history.filter((p) => p.nav_date <= asOf).at(-1) ?? null
    const unitNav = latest?.nav ?? navValue(latest) ?? 0
    const retAsOf = latest && latest.nav_date <= asOf ? latest.nav_date : asOf
    const ret = latest
      ? calcPeriodReturnsFromHistory(history, unitNav, retAsOf, latest)
      : { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null }
    // 近一周 must end on a print inside the report week. A 9/18 NAV is last week, not 9/21–9/25.
    if (!latest || latest.nav_date < mondayOfWeek(asOf)) ret.ret_1w = null
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
      name: displayName(fund.product_name, fund.short_name, fund.beian_hao),
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

export async function buildMarketRows(weekStart: string, weekEnd: string) {
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

const BENCH_CODE_NAME: Record<string, string> = {
  "000905.SH": "中证500",
  "000905": "中证500",
  "000852.SH": "中证1000",
  "000852": "中证1000",
  "932000.CSI": "中证2000",
  "932000": "中证2000",
  "932000.SH": "中证2000",
  "000300.SH": "沪深300",
  "000300": "沪深300",
  "000510.SH": "中证A500",
  "000510": "中证A500",
}

function describeBenchCodes(codes: string[]): string {
  const parts: string[] = []
  const seen = new Set<string>()
  for (const code of codes) {
    const name = BENCH_CODE_NAME[code] ?? code
    if (seen.has(name)) continue
    seen.add(name)
    const display = codes.find((c) => (BENCH_CODE_NAME[c] ?? c) === name && c.includes(".")) ?? code
    parts.push(`${name}（${display}）`)
  }
  if (parts.length <= 1) return parts[0] ?? ""
  return `${parts[0]}；序列缺失时依次改用 ${parts.slice(1).join("、")}`
}

type MethodologyRow =
  | { kind: "title"; text: string }
  | { kind: "pair"; label: string; text: string }
  | { kind: "spacer" }

/** Reader-facing notes for the weekly workbook. Wording tracks the calculators above. */
export function buildWeeklyReviewMethodologyRows(weekStart: string, weekEnd: string): MethodologyRow[] {
  const benchRows: MethodologyRow[] = Object.entries(BENCH_BY_BUCKET).map(([bucket, codes]) => ({
    kind: "pair" as const,
    label: bucket,
    text: describeBenchCodes(codes),
  }))
  return [
    { kind: "title", text: `口径说明（统计区间 ${fmtSlashDate(weekStart)} ~ ${fmtSlashDate(weekEnd)}，截止日 ${weekEnd}）` },
    {
      kind: "pair",
      label: "样本范围",
      text: "只含 JY 跟踪池里的股票策略产品。一级策略为期货、债券、固收、多资产、套利、期权或其他的产品不进入本表。同一备案号只保留最新一条跟踪记录。",
    },
    {
      kind: "pair",
      label: "份额合并",
      text: "同一策略分组内，同一产品的母份额与 A/B/C 份额合并为一行。优先采用截止日前净值点数更多的份额；点数相同则 A 优先于 B、C，S 开头的备案号优先。同一产品落在不同策略分组时仍各占一行。",
    },
    {
      kind: "pair",
      label: "统计截止",
      text: "收益、超额、回撤和风险比率都不用截止日之后的数据。近一周收益和近一周超额的期末净值必须落在统计区间内（该周周一至截止日）。区间内没有净值时这两格留空，不用上一周的涨跌代替本周。近一月及更长区间截止到截止日当日或之前最近一条已公布净值；若尚未公布到截止日，那些窗口的终点会早于截止日。",
    },
    {
      kind: "pair",
      label: "净值取值",
      text: "收益用复权净值：累计净值或复权净值相对单位净值处于 0.85–2.5 倍、且不低于单位净值时采用该值，否则用单位净值。之后若出现只有单位净值的点，会沿用最近一次有效的复权比例。只保留 A 股交易日。净值来自邮件净值、历史净值表和产品详情缓存，近期更完整、没有超过 14 天断档的序列优先。回看约 400 个自然日。",
    },
    {
      kind: "pair",
      label: "指标选择",
      text: "指数增强类分组（名称以「指增」结尾，以及高换手、中换手、低换手）列超额收益和超额最大回撤。空气指增，以及量化中性、强势股、择时择股、转债、打板、DMA、股票多空等分组列绝对收益、近一年夏普和近一年卡玛。",
    },
    {
      kind: "pair",
      label: "绝对收益",
      text: "近一周 / 近一月 / 近三月 / 近六月 / 近一年分别对应期末净值日前 7 / 30 / 90 / 180 / 365 个自然日。收益 = 期末复权净值 / 期初复权净值 − 1。期初取目标日当日或之前最近一条净值。近一周的期末必须落在统计区间内，否则留空。近一周要求期初与期末处于约 ±6% 的同一份额尺度，近一月约 ±10%，更长区间在净值路径连续时允许复利后的涨跌，否则约 ±15%。跌幅若大于该净值序列的最大回撤，单元格留空。",
    },
    {
      kind: "pair",
      label: "夏普比率",
      text: "只出现在绝对收益表。取截止日前 365 个自然日内的复权净值，至少 20 个点。年化收益按日历跨度复利（一年按 365.25 天）。年化波动为相邻净值收益率的样本标准差（分母 n−1）乘以 √年化期数：中位间隔不超过 2 天按 252，不超过 10 天按 52，更疏的公布频率相应降为 26、12 或 4。夏普 =（年化收益 − 2% 无风险利率）/ 年化波动。绝对值超过 50 或样本不足时留空，保留四位小数。",
    },
    {
      kind: "pair",
      label: "卡玛比率",
      text: "与夏普使用同一个近一年窗口。最大回撤 =（区间最高复权净值 − 其后最低净值）/ 最高净值。卡玛 = 年化收益 / 最大回撤。回撤不足 0.01% 或比值绝对值超过 50 时留空。",
    },
    {
      kind: "pair",
      label: "超额收益",
      text: "先把基金复权净值和基准收盘价各自归一到近一年窗口内的首个有效点，超额净值 = 基金归一净值 / 基准归一净值。基准对齐到每个基金净值日当日或之前的最近收盘价。各期超额 = 超额净值的区间涨跌幅，窗口同样是 7 / 30 / 90 / 180 / 365 个自然日。近一周超额只在期末净值日落在统计区间内时计算，期末早于该周周一则留空。回看日若落在净值空档中，近一月及以上改用空档之后、且仍覆盖该窗口大部分的第一条净值；近一周在期末已落在统计区间内时，退回到期末的前一条净值。覆盖不足时留空。",
    },
    {
      kind: "pair",
      label: "超额最大回撤",
      text: "近六月、近一年超额最大回撤是对应窗口内超额净值的最大回撤，算法与绝对收益的最大回撤相同。表内以正数表示，0.05 即从超额高点回落 5%。",
    },
    {
      kind: "pair",
      label: "股票市场回顾",
      text: "宽基、风格和大类指数的涨跌幅，是截止日收盘相对约 7 个自然日前收盘的涨跌幅，两端都取当日或之前最近收盘。数据来自指数日行情；上证50、沪深300、中证500、中证1000在指数缺失时改用 IH、IF、IC、IM。全A成交量是当日全市场成交额，换算成亿元后四舍五入到整数；上涨家数为当日上涨家数。日均成交量和平均上涨家数是统计区间内有数据交易日的算术平均。",
    },
    {
      kind: "pair",
      label: "排序与颜色",
      text: "各策略表按近一周超额（绝对收益表则按近一周收益）从高到低排列。正收益为红色，负收益为绿色。回撤、夏普、卡玛不按涨跌着色。百分比单元格存的是小数（1% 为 0.01）。",
    },
    {
      kind: "pair",
      label: "空值",
      text: "净值点数不足、基准缺失、窗口被公布空档打断，或风险比率超出合理范围时，对应单元格留空，不填 0。绝对收益、夏普、卡玛与投资分析列表使用同一套净值算法；超额收益和超额回撤只在本周报里按下列基准计算。",
    },
    { kind: "spacer" },
    { kind: "title", text: "超额基准对照" },
    ...benchRows,
    {
      kind: "pair",
      label: "空气指增",
      text: "不计算超额，改为绝对收益、近一年夏普和近一年卡玛。",
    },
    {
      kind: "pair",
      label: "其他指增",
      text: "名称以「指增」结尾、但上表没有单列的分组，默认对中证500（000905.SH）。指数序列缺失时，分组名含 300 的用 IF，含 1000 的（含 1000 指增、2000 指增）用 IM，其余用 IC。",
    },
  ]
}

function methodologySheet(weekStart: string, weekEnd: string): {
  aoa: unknown[][]
  styles: Map<string, CellStyle>
  rowHeights: number[]
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>
} {
  const aoa: unknown[][] = []
  const styles = new Map<string, CellStyle>()
  const rowHeights: number[] = []
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = []
  const title: CellStyle = {
    ...headerStyle(),
    alignment: { wrapText: true, vertical: "center", horizontal: "left" },
  }
  const label: CellStyle = {
    font: { name: FONT_NAME, sz: 11, bold: true, color: { rgb: HEADER_FILL } },
    alignment: { wrapText: true, vertical: "top", horizontal: "left" },
  }
  const body: CellStyle = {
    font: { name: FONT_NAME, sz: 11 },
    alignment: { wrapText: true, vertical: "top", horizontal: "left" },
  }
  for (const row of buildWeeklyReviewMethodologyRows(weekStart, weekEnd)) {
    const r = aoa.length
    if (row.kind === "spacer") {
      aoa.push([])
      rowHeights.push(12)
      continue
    }
    if (row.kind === "title") {
      aoa.push([row.text, " "])
      styles.set(`${r},0`, title)
      styles.set(`${r},1`, title)
      merges.push({ s: { r, c: 0 }, e: { r, c: 1 } })
      rowHeights.push(24)
      continue
    }
    aoa.push([row.label, row.text])
    styles.set(`${r},0`, label)
    styles.set(`${r},1`, body)
    rowHeights.push(Math.min(120, Math.max(22, Math.ceil(row.text.length / 40) * 18)))
  }
  return { aoa, styles, rowHeights, merges }
}

export async function generateJyWeeklyReviewWorkbook(weekEndRaw: string): Promise<{
  buffer: Buffer
  fileName: string
  fundCount: number
  groupCount: number
}> {
  const { weekStart, weekEnd, asOf } = resolveWeekWindow(weekEndRaw)
  const equity = (await loadJyTrackingPoolFunds()).filter(isEquityFund)
  const coverage = await loadWeeklyReviewNavCoverage(equity, asOf)
  const funds = collapseWeeklyReviewFunds(equity, coverage)
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
  const sheets: Array<{
    name: string
    title: string
    rows: number
    cols: number
    aoa: unknown[][]
    styles: Map<string, CellStyle>
    rowHeights?: number[]
    merges?: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>
  }> = []

  {
    const note = methodologySheet(weekStart, weekEnd)
    sheets.push({
      name: "口径说明",
      title: "口径说明",
      rows: note.aoa.length,
      cols: 2,
      aoa: note.aoa,
      styles: note.styles,
      rowHeights: note.rowHeights,
      merges: note.merges,
    })
    tocRows.push(["—", "口径说明", "口径说明", note.aoa.filter((row) => row.some((cell) => String(cell ?? "").trim())).length, 2])
  }

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
    if (sheet.merges?.length) ws["!merges"] = sheet.merges
    if (sheet.title === "口径说明") {
      ws["!cols"] = [{ wch: 16 }, { wch: 92 }]
      ws["!rows"] = sheet.rowHeights?.map((hpt) => ({ hpt }))
    } else if (sheet.title === "股票市场回顾") {
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

