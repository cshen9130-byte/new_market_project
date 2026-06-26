import type { BenchmarkPoint, NavRow } from "./shared"
import { getNavFieldValue } from "./shared"

export type ScenarioAssetClass = "futures" | "stock" | "option"

export type ScenarioIndicatorKey =
  | "tsVol"
  | "amplitude"
  | "gap"
  | "trend"
  | "crossSection"
  | "volumeOi"

export interface OhlcBar {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
}

export interface ScenarioChartPoint {
  date: string
  indicator: number | null
  fundReturn: number | null
  benchReturn: number | null
  excessReturn: number | null
}

const INDICATOR_LABELS: Record<ScenarioIndicatorKey, string> = {
  tsVol: "时序波动率",
  amplitude: "市场振幅",
  gap: "市场跳空",
  trend: "趋势强弱",
  crossSection: "截面强弱",
  volumeOi: "成交持仓比",
}

const INDICATOR_AXIS_LABELS: Record<ScenarioIndicatorKey, string> = {
  tsVol: "波动率(%)",
  amplitude: "振幅(%)",
  gap: "跳空(%)",
  trend: "趋势强弱",
  crossSection: "截面强弱(%)",
  volumeOi: "成交持仓比",
}

export function scenarioIndicatorLabel(key: ScenarioIndicatorKey, assetClass: ScenarioAssetClass): string {
  const base = INDICATOR_LABELS[key]
  if (key === "tsVol") {
    if (assetClass === "futures") return `期货${base}`
    if (assetClass === "stock") return `股票${base}`
  }
  return base
}

export function scenarioIndicatorAxisLabel(key: ScenarioIndicatorKey): string {
  return INDICATOR_AXIS_LABELS[key]
}

function rollingLogVol(closes: number[], window: number): number | null {
  if (closes.length < 2 || window < 2) return null
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]))
  }
  if (rets.length < 2) return null
  const slice = rets.slice(-window)
  if (slice.length < 2) return null
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (slice.length - 1)
  return +(Math.sqrt(variance * 252) * 100).toFixed(4)
}

function rollingAmplitude(bars: OhlcBar[], window: number): number | null {
  if (bars.length < window) return null
  const slice = bars.slice(-window)
  const ranges = slice
    .map((b) => {
      if (!b.high || !b.low || !b.close || b.close <= 0) return null
      return ((b.high - b.low) / b.close) * 100
    })
    .filter((v): v is number => v !== null && Number.isFinite(v))
  if (!ranges.length) return null
  return +(ranges.reduce((s, v) => s + v, 0) / ranges.length).toFixed(4)
}

function rollingGap(bars: OhlcBar[], window: number): number | null {
  if (bars.length < window + 1) return null
  const slice = bars.slice(-(window + 1))
  const gaps: number[] = []
  for (let i = 1; i < slice.length; i++) {
    const prevClose = slice[i - 1].close
    const open = slice[i].open
    if (!prevClose || prevClose <= 0 || !open) continue
    gaps.push(Math.abs(open / prevClose - 1) * 100)
  }
  if (!gaps.length) return null
  return +(gaps.reduce((s, v) => s + v, 0) / gaps.length).toFixed(4)
}

function rollingTrend(bars: OhlcBar[], window: number): number | null {
  if (bars.length < window + 1) return null
  const slice = bars.slice(-(window + 1))
  const first = slice[0].close
  const last = slice[slice.length - 1].close
  if (!first || !last || first <= 0) return null
  const totalRet = (last / first - 1) * 100
  const closes = slice.map((b) => b.close).filter((c): c is number => c !== null && c > 0)
  const vol = rollingLogVol(closes, Math.min(window, closes.length - 1))
  if (!vol || vol <= 0) return null
  return +(totalRet / vol).toFixed(4)
}

function computeCrossSectionStrength(allSeries: OhlcBar[][], window: number): Map<string, number | null> {
  const result = new Map<string, number | null>()
  if (allSeries.length < 2) return result

  const seriesMaps = allSeries.map((series) => {
    const map = new Map<string, number>()
    for (const bar of series) {
      if (bar.close !== null && bar.close > 0) map.set(bar.date, bar.close)
    }
    return map
  })

  const dates = Array.from(new Set(allSeries.flatMap((s) => s.map((b) => b.date)))).sort()

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]
    if (i < window - 1) {
      result.set(date, null)
      continue
    }
    const windowDates = dates.slice(i - window + 1, i + 1)
    const startDate = windowDates[0]
    const endDate = windowDates[windowDates.length - 1]
    const rets: number[] = []
    for (const map of seriesMaps) {
      const start = map.get(startDate)
      const end = map.get(endDate)
      if (!start || !end || start <= 0) continue
      rets.push((end / start - 1) * 100)
    }
    if (rets.length < 2) {
      result.set(date, null)
      continue
    }
    result.set(date, +(Math.max(...rets) - Math.min(...rets)).toFixed(4))
  }

  return result
}

function computeIndicatorAt(
  bars: OhlcBar[],
  endIndex: number,
  window: number,
  indicator: ScenarioIndicatorKey,
  crossSectionMap?: Map<string, number | null>,
): number | null {
  const date = bars[endIndex]?.date
  if (!date) return null
  if (indicator === "crossSection") return crossSectionMap?.get(date) ?? null
  if (indicator === "volumeOi") return null

  const slice = bars.slice(0, endIndex + 1)
  if (indicator === "tsVol") {
    const closes = slice.map((b) => b.close).filter((c): c is number => c !== null && c > 0)
    return rollingLogVol(closes, window)
  }
  if (indicator === "amplitude") return rollingAmplitude(slice, window)
  if (indicator === "gap") return rollingGap(slice, window)
  if (indicator === "trend") return rollingTrend(slice, window)
  return null
}

function alignReturnSeries(
  navDates: string[],
  navReturns: Map<string, number>,
  benchReturns: Map<string, number>,
): Array<{ date: string; fundReturn: number | null; benchReturn: number | null; excessReturn: number | null }> {
  return navDates.map((date) => {
    const fundReturn = navReturns.get(date) ?? null
    const benchReturn = benchReturns.get(date) ?? null
    const excessReturn =
      fundReturn !== null && benchReturn !== null ? +(fundReturn - benchReturn).toFixed(4) : null
    return { date, fundReturn, benchReturn, excessReturn }
  })
}

function buildCumulativeReturnMap(rows: NavRow[], navType: string): Map<string, number> {
  const map = new Map<string, number>()
  if (rows.length < 2) return map
  const base = getNavFieldValue(rows[0], navType)
  if (!Number.isFinite(base) || base <= 0) return map
  for (const row of rows) {
    const val = getNavFieldValue(row, navType)
    if (!Number.isFinite(val) || val <= 0) continue
    map.set(row.price_date, +(((val / base) - 1) * 100).toFixed(4))
  }
  return map
}

function buildBenchmarkReturnMap(benchmarkSeries: BenchmarkPoint[], navDates: string[]): Map<string, number> {
  const map = new Map<string, number>()
  if (!benchmarkSeries.length || !navDates.length) return map

  let idx = 0
  let last: number | null = null
  for (const date of navDates) {
    while (idx < benchmarkSeries.length && benchmarkSeries[idx].date <= date) {
      last = benchmarkSeries[idx].value
      idx += 1
    }
    if (last === null) continue
  }

  const baseDate = navDates.find((d) => {
    let v: number | null = null
    let i = 0
    while (i < benchmarkSeries.length && benchmarkSeries[i].date <= d) {
      v = benchmarkSeries[i].value
      i += 1
    }
    return v !== null && v > 0
  })

  if (!baseDate) return map
  let baseVal: number | null = null
  let j = 0
  while (j < benchmarkSeries.length && benchmarkSeries[j].date <= baseDate) {
    baseVal = benchmarkSeries[j].value
    j += 1
  }
  if (!baseVal || baseVal <= 0) return map

  idx = 0
  last = null
  for (const date of navDates) {
    while (idx < benchmarkSeries.length && benchmarkSeries[idx].date <= date) {
      last = benchmarkSeries[idx].value
      idx += 1
    }
    if (last !== null && last > 0) {
      map.set(date, +(((last / baseVal) - 1) * 100).toFixed(4))
    }
  }
  return map
}

export function buildScenarioChartSeries({
  marketBars,
  crossSectionBars,
  navRows,
  navType,
  benchmarkSeries,
  indicator,
  windowDays,
}: {
  marketBars: OhlcBar[]
  crossSectionBars?: OhlcBar[][]
  navRows: NavRow[]
  navType: string
  benchmarkSeries: BenchmarkPoint[]
  indicator: ScenarioIndicatorKey
  windowDays: number
}): ScenarioChartPoint[] {
  if (!marketBars.length || !navRows.length) return []

  const navDates = navRows.map((r) => r.price_date)
  const navDateSet = new Set(navDates)
  const fundReturns = buildCumulativeReturnMap(navRows, navType)
  const benchReturns = buildBenchmarkReturnMap(benchmarkSeries, navDates)
  const returns = alignReturnSeries(navDates, fundReturns, benchReturns)

  const crossSectionMap =
    indicator === "crossSection" && crossSectionBars?.length
      ? computeCrossSectionStrength(crossSectionBars, windowDays)
      : undefined

  const marketByDate = new Map(marketBars.map((b, i) => [b.date, i]))
  const points: ScenarioChartPoint[] = []

  for (const ret of returns) {
    if (!navDateSet.has(ret.date)) continue
    const marketIdx = marketByDate.get(ret.date)
    const indicatorValue =
      marketIdx !== undefined
        ? computeIndicatorAt(marketBars, marketIdx, windowDays, indicator, crossSectionMap)
        : null
    points.push({
      date: ret.date,
      indicator: indicatorValue,
      fundReturn: ret.fundReturn,
      benchReturn: ret.benchReturn,
      excessReturn: ret.excessReturn,
    })
  }

  return points
}

export function computeIndicatorDomain(points: ScenarioChartPoint[]): [number, number] {
  const vals = points.map((p) => p.indicator).filter((v): v is number => v !== null && Number.isFinite(v))
  if (!vals.length) return [0, 30]
  const max = Math.max(...vals)
  const min = Math.min(...vals, 0)
  const pad = Math.max((max - min) * 0.1, 1)
  return [Math.floor(min - pad), Math.ceil(max + pad)]
}

export function buildEventReturnSeries(
  navRows: NavRow[],
  navType: string,
  benchmarkSeries: BenchmarkPoint[],
): ScenarioChartPoint[] {
  if (!navRows.length) return []
  const navDates = navRows.map((r) => r.price_date)
  const fundReturns = buildCumulativeReturnMap(navRows, navType)
  const benchReturns = buildBenchmarkReturnMap(benchmarkSeries, navDates)
  return alignReturnSeries(navDates, fundReturns, benchReturns).map((p) => ({
    date: p.date,
    indicator: null,
    fundReturn: p.fundReturn,
    benchReturn: p.benchReturn,
    excessReturn: p.excessReturn,
  }))
}

export interface EventBand {
  from: string
  to: string
  tone: "blue" | "red"
  label: string
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[idx]
}

function mergeClassSegments(
  dates: string[],
  classes: Array<"calm" | "stress" | null>,
  tone: EventBand["tone"],
  label: string,
): EventBand[] {
  const bands: EventBand[] = []
  let start: string | null = null
  for (let i = 0; i < dates.length; i++) {
    const cls = classes[i]
    const active = tone === "blue" ? cls === "calm" : cls === "stress"
    if (active && !start) start = dates[i]
    if ((!active || i === dates.length - 1) && start) {
      const end = active && i === dates.length - 1 ? dates[i] : dates[i - 1]
      if (end >= start) bands.push({ from: start, to: end, tone, label })
      start = null
    }
  }
  return bands
}

export function detectAllEventBands(
  points: ScenarioChartPoint[],
  benchmarkSeries: BenchmarkPoint[],
  windowDays = 20,
): EventBand[] {
  if (points.length < windowDays + 3 || benchmarkSeries.length < windowDays + 3) return []

  const benchDates = benchmarkSeries.map((p) => p.date)
  const benchRets: number[] = []
  for (let i = 1; i < benchmarkSeries.length; i++) {
    const prev = benchmarkSeries[i - 1].value
    const curr = benchmarkSeries[i].value
    benchRets.push(prev > 0 ? (curr / prev - 1) * 100 : 0)
  }

  const rollingVol: number[] = []
  const rollingAbsRet: number[] = []
  for (let i = windowDays - 1; i < benchRets.length; i++) {
    const slice = benchRets.slice(i - windowDays + 1, i + 1)
    const mean = slice.reduce((s, v) => s + v, 0) / slice.length
    const vol = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(slice.length - 1, 1))
    rollingVol.push(vol)
    rollingAbsRet.push(slice.reduce((s, v) => s + Math.abs(v), 0))
  }

  if (rollingVol.length < 5) return []

  const volP25 = percentile(rollingVol, 0.25)
  const volP75 = percentile(rollingVol, 0.75)
  const absP75 = percentile(rollingAbsRet, 0.75)

  const eventDates = benchDates.slice(windowDays)
  const classes: Array<"calm" | "stress" | null> = rollingVol.map((vol, i) => {
    if (vol <= volP25) return "calm"
    if (vol >= volP75 || rollingAbsRet[i] >= absP75) return "stress"
    return null
  })

  const clipToNavRange = (band: EventBand): EventBand | null => {
    const navDates = points.map((p) => p.date).filter((d) => d >= band.from && d <= band.to)
    if (navDates.length < 2) return null
    return { ...band, from: navDates[0], to: navDates[navDates.length - 1] }
  }

  const calmBands = mergeClassSegments(eventDates, classes, "blue", "低波动")
    .map(clipToNavRange)
    .filter((b): b is EventBand => b !== null)

  const stressBands = mergeClassSegments(eventDates, classes, "red", "高波动")
    .map(clipToNavRange)
    .filter((b): b is EventBand => b !== null)

  return [...calmBands, ...stressBands]
}

export function detectEventBands(
  points: ScenarioChartPoint[],
  benchmarkSeries: BenchmarkPoint[],
  windowDays = 20,
): EventBand[] {
  const all = detectAllEventBands(points, benchmarkSeries, windowDays)
  const calmBands = all
    .filter((b) => b.tone === "blue")
    .sort((a, b) => new Date(b.to).getTime() - new Date(b.from).getTime() - (new Date(a.to).getTime() - new Date(a.from).getTime()))
  const stressBands = all
    .filter((b) => b.tone === "red")
    .sort((a, b) => new Date(b.to).getTime() - new Date(b.from).getTime() - (new Date(a.to).getTime() - new Date(a.from).getTime()))

  const picked: EventBand[] = []
  if (calmBands[0]) picked.push(calmBands[0])
  if (stressBands[0]) picked.push(stressBands[0])
  return picked
}

export interface CustomScenarioEvent {
  id: string
  name: string
  from: string
  to: string
}

export interface EventScenarioRow {
  id: string
  name: string
  from: string
  to: string
  fundReturn: number | null
  benchReturn: number | null
  custom: boolean
}

function computePeriodFundReturn(navRows: NavRow[], navType: string, from: string, to: string): number | null {
  const slice = navRows.filter((r) => r.price_date >= from && r.price_date <= to)
  if (slice.length < 2) return null
  const start = getNavFieldValue(slice[0], navType)
  const end = getNavFieldValue(slice[slice.length - 1], navType)
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end)) return null
  return +(((end / start) - 1) * 100).toFixed(2)
}

function computePeriodBenchReturn(benchmarkSeries: BenchmarkPoint[], from: string, to: string): number | null {
  if (!benchmarkSeries.length) return null
  let startVal: number | null = null
  let endVal: number | null = null
  for (const point of benchmarkSeries) {
    if (point.date < from) continue
    if (point.date > to) break
    if (startVal === null) startVal = point.value
    endVal = point.value
  }
  if (startVal === null || endVal === null || startVal <= 0) return null
  return +(((endVal / startVal) - 1) * 100).toFixed(2)
}

function buildAutoEventName(band: EventBand, fundReturn: number | null, benchReturn: number | null): string {
  const year = band.from.slice(0, 4)
  const month = parseInt(band.from.slice(5, 7), 10)
  if (band.tone === "red") {
    if (benchReturn !== null && benchReturn < -1) return `${year}年${month}月基准回调情景`
    if (fundReturn !== null && benchReturn !== null && fundReturn - benchReturn >= 3) {
      return `${year}年${month}月超额占优情景`
    }
    return `${year}年${month}月高波动情景`
  }
  if (benchReturn !== null && benchReturn >= 3) return `${year}年${month}月基准上行窗口`
  return `${year}年${month}月低波动情景`
}

function toScenarioRow(
  id: string,
  name: string,
  from: string,
  to: string,
  navRows: NavRow[],
  navType: string,
  benchmarkSeries: BenchmarkPoint[],
  custom: boolean,
): EventScenarioRow {
  return {
    id,
    name,
    from,
    to,
    fundReturn: computePeriodFundReturn(navRows, navType, from, to),
    benchReturn: computePeriodBenchReturn(benchmarkSeries, from, to),
    custom,
  }
}

export function buildEventScenarioRows({
  navRows,
  navType,
  benchmarkSeries,
  chartData,
  customEvents = [],
}: {
  navRows: NavRow[]
  navType: string
  benchmarkSeries: BenchmarkPoint[]
  chartData: ScenarioChartPoint[]
  customEvents?: CustomScenarioEvent[]
}): EventScenarioRow[] {
  const autoBands = detectAllEventBands(chartData, benchmarkSeries)
  const autoRows: EventScenarioRow[] = autoBands.map((band) => {
    const fundReturn = computePeriodFundReturn(navRows, navType, band.from, band.to)
    const benchReturn = computePeriodBenchReturn(benchmarkSeries, band.from, band.to)
    return {
      id: `auto-${band.tone}-${band.from}-${band.to}`,
      name: buildAutoEventName(band, fundReturn, benchReturn),
      from: band.from,
      to: band.to,
      fundReturn,
      benchReturn,
      custom: false,
    }
  })

  const customRows = customEvents.map((event) =>
    toScenarioRow(event.id, event.name, event.from, event.to, navRows, navType, benchmarkSeries, true),
  )

  const merged = [...customRows, ...autoRows]
  const seen = new Set<string>()
  return merged.filter((row) => {
    const key = `${row.from}|${row.to}|${row.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function computeReturnDomain(points: ScenarioChartPoint[], showExcess: boolean): [number, number] {
  const vals = points.flatMap((p) => {
    if (showExcess) return p.excessReturn !== null ? [p.excessReturn] : []
    return [p.fundReturn, p.benchReturn].filter((v): v is number => v !== null && Number.isFinite(v))
  })
  if (!vals.length) return [-10, 10]
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const pad = Math.max((max - min) * 0.08, 5)
  return [Math.floor(min - pad), Math.ceil(max + pad)]
}

export function computeEventReturnDomain(points: ScenarioChartPoint[], showExcess: boolean): [number, number] {
  return computeReturnDomain(points, showExcess)
}

export const STYLE_SCENARIO_TABS = [
  { key: "market", label: "市场风格分析", indexKey: "IF", indexLabel: "中证800" },
  { key: "cap", label: "市值风格分析", indexKey: "IM", indexLabel: "中证1000" },
  { key: "valuation", label: "估值风格分析", indexKey: "IH", indexLabel: "上证50" },
] as const

export type StyleScenarioTabKey = (typeof STYLE_SCENARIO_TABS)[number]["key"]

export interface StyleScenarioChartPoint {
  date: string
  fundReturn: number | null
  styleReturn: number | null
  benchReturn: number | null
  excessReturn: number | null
}

export function buildStyleScenarioChartSeries(
  navRows: NavRow[],
  navType: string,
  styleSeries: BenchmarkPoint[],
  benchmarkSeries: BenchmarkPoint[],
): StyleScenarioChartPoint[] {
  if (!navRows.length) return []
  const navDates = navRows.map((r) => r.price_date)
  const fundReturns = buildCumulativeReturnMap(navRows, navType)
  const styleReturns = buildBenchmarkReturnMap(styleSeries, navDates)
  const benchReturns = buildBenchmarkReturnMap(benchmarkSeries, navDates)

  return navDates.map((date) => {
    const fundReturn = fundReturns.get(date) ?? null
    const styleReturn = styleReturns.get(date) ?? null
    const benchReturn = benchReturns.get(date) ?? null
    const excessReturn =
      fundReturn !== null && benchReturn !== null ? +(fundReturn - benchReturn).toFixed(4) : null
    return { date, fundReturn, styleReturn, benchReturn, excessReturn }
  })
}

export function computeStyleReturnDomain(
  points: StyleScenarioChartPoint[],
  showExcess: boolean,
): [number, number] {
  const vals = points.flatMap((p) => {
    if (showExcess) return p.excessReturn !== null ? [p.excessReturn] : []
    return [p.fundReturn, p.styleReturn, p.benchReturn].filter(
      (v): v is number => v !== null && Number.isFinite(v),
    )
  })
  if (!vals.length) return [-10, 10]
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const pad = Math.max((max - min) * 0.08, 5)
  return [Math.floor(min - pad), Math.ceil(max + pad)]
}

export function stylePointsForBandDetection(points: StyleScenarioChartPoint[]): ScenarioChartPoint[] {
  return points.map((p) => ({
    date: p.date,
    indicator: null,
    fundReturn: p.fundReturn,
    benchReturn: p.benchReturn,
    excessReturn: p.excessReturn,
  }))
}

export interface StyleScenarioTableRow {
  id: string
  styleLabel: string
  from: string
  to: string
  fundReturn: number | null
  styleReturn: number | null
  benchReturn: number | null
}

type MarketStyleKind = "bull" | "bear" | "range"

function computePeriodIndexReturn(series: BenchmarkPoint[], from: string, to: string): number | null {
  return computePeriodBenchReturn(series, from, to)
}

function classifyMarketStyle(returnPct: number): MarketStyleKind {
  if (returnPct >= 5) return "bull"
  if (returnPct <= -5) return "bear"
  return "range"
}

function marketStyleLabel(kind: MarketStyleKind, returnPct: number): string {
  if (kind === "bull") return returnPct >= 10 ? "单边牛市" : "牛市"
  if (kind === "bear") return returnPct <= -10 ? "单边熊市" : "熊市"
  return "震荡市"
}

function classifyCapStyle(styleReturn: number, largeCapReturn: number | null): string {
  if (largeCapReturn === null) return "均衡"
  const spread = styleReturn - largeCapReturn
  if (spread >= 3) return "小盘占优"
  if (spread <= -3) return "大盘占优"
  return "均衡"
}

function classifyValuationStyle(valueReturn: number, growthReturn: number | null): string {
  if (growthReturn === null) return "均衡"
  const spread = valueReturn - growthReturn
  if (spread >= 3) return "价值占优"
  if (spread <= -3) return "成长占优"
  return "均衡"
}

function splitNavDatesIntoStylePeriods(
  navDates: string[],
  styleSeries: BenchmarkPoint[],
  labelForReturn: (returnPct: number) => string,
  minDays = 15,
): Array<{ from: string; to: string; styleLabel: string; styleReturn: number }> {
  if (navDates.length < minDays) return []

  const segments: Array<{ from: string; to: string; styleLabel: string; styleReturn: number }> = []
  let startIdx = 0

  while (startIdx < navDates.length - 1) {
    let endIdx = Math.min(startIdx + minDays - 1, navDates.length - 1)
    let periodRet = computePeriodIndexReturn(styleSeries, navDates[startIdx], navDates[endIdx])
    if (periodRet === null) {
      startIdx += 1
      continue
    }
    let kind = classifyMarketStyle(periodRet)

    while (endIdx + 1 < navDates.length) {
      const nextRet = computePeriodIndexReturn(styleSeries, navDates[startIdx], navDates[endIdx + 1])
      if (nextRet === null) break
      if (classifyMarketStyle(nextRet) !== kind) break
      endIdx += 1
      periodRet = nextRet
    }

    segments.push({
      from: navDates[startIdx],
      to: navDates[endIdx],
      styleLabel: labelForReturn(periodRet),
      styleReturn: periodRet,
    })
    startIdx = endIdx + 1
  }

  return segments
}

function splitNavDatesIntoLabeledPeriods(
  navDates: string[],
  styleSeries: BenchmarkPoint[],
  labelForSegment: (from: string, to: string, styleReturn: number) => string,
  minDays = 15,
): Array<{ from: string; to: string; styleLabel: string; styleReturn: number }> {
  if (navDates.length < minDays) return []

  const segments: Array<{ from: string; to: string; styleLabel: string; styleReturn: number }> = []
  let startIdx = 0

  while (startIdx < navDates.length - 1) {
    let endIdx = Math.min(startIdx + minDays - 1, navDates.length - 1)
    let styleRet = computePeriodIndexReturn(styleSeries, navDates[startIdx], navDates[endIdx])
    if (styleRet === null) {
      startIdx += 1
      continue
    }
    let label = labelForSegment(navDates[startIdx], navDates[endIdx], styleRet)

    while (endIdx + 1 < navDates.length) {
      const nextStyleRet = computePeriodIndexReturn(styleSeries, navDates[startIdx], navDates[endIdx + 1])
      if (nextStyleRet === null) break
      const nextLabel = labelForSegment(navDates[startIdx], navDates[endIdx + 1], nextStyleRet)
      if (nextLabel !== label) break
      endIdx += 1
      styleRet = nextStyleRet
      label = nextLabel
    }

    segments.push({
      from: navDates[startIdx],
      to: navDates[endIdx],
      styleLabel: label,
      styleReturn: styleRet,
    })
    startIdx = endIdx + 1
  }

  return segments
}

export function buildStyleScenarioTableRows({
  navRows,
  navType,
  styleSeries,
  benchmarkSeries,
  tabKey,
  largeCapSeries = [],
}: {
  navRows: NavRow[]
  navType: string
  styleSeries: BenchmarkPoint[]
  benchmarkSeries: BenchmarkPoint[]
  tabKey: StyleScenarioTabKey
  largeCapSeries?: BenchmarkPoint[]
}): StyleScenarioTableRow[] {
  if (!navRows.length || !styleSeries.length) return []

  const navDates = navRows.map((r) => r.price_date)
  let segments: Array<{ from: string; to: string; styleLabel: string; styleReturn: number }>

  if (tabKey === "market") {
    segments = splitNavDatesIntoStylePeriods(
      navDates,
      styleSeries,
      (ret) => marketStyleLabel(classifyMarketStyle(ret), ret),
    )
  } else if (tabKey === "cap") {
    segments = splitNavDatesIntoLabeledPeriods(
      navDates,
      styleSeries,
      (from, to, styleRet) =>
        classifyCapStyle(styleRet, computePeriodIndexReturn(largeCapSeries, from, to)),
    )
  } else {
    segments = splitNavDatesIntoLabeledPeriods(
      navDates,
      styleSeries,
      (from, to, styleRet) =>
        classifyValuationStyle(styleRet, computePeriodIndexReturn(largeCapSeries, from, to)),
    )
  }

  return segments.map((seg, i) => ({
    id: `${tabKey}-${seg.from}-${seg.to}-${i}`,
    styleLabel: seg.styleLabel,
    from: seg.from,
    to: seg.to,
    fundReturn: computePeriodFundReturn(navRows, navType, seg.from, seg.to),
    styleReturn: computePeriodIndexReturn(styleSeries, seg.from, seg.to),
    benchReturn: computePeriodBenchReturn(benchmarkSeries, seg.from, seg.to),
  }))
}

export function styleScenarioTableFootnote(tabKey: StyleScenarioTabKey): string {
  if (tabKey === "market") {
    return "A股市场的牛市、熊市、震荡市的划分以中证800指数涨跌幅为基准作为参考进行划分。"
  }
  if (tabKey === "cap") {
    return "市值风格划分以中证1000与中证800指数相对强弱为参考进行划分。"
  }
  return "估值风格划分以上证50与中证800指数相对强弱为参考进行划分。"
}

export function styleScenarioStyleColumnLabel(tabKey: StyleScenarioTabKey): string {
  if (tabKey === "market") return "市场风格"
  if (tabKey === "cap") return "市值风格"
  return "估值风格"
}

export const FUTURES_CATEGORY_OPTIONS = [
  { code: "NHCI.NH", label: "南华商品指数" },
  { code: "NHAI.NH", label: "南华农产品指数" },
  { code: "NHECI.NH", label: "南华能化指数" },
  { code: "NHFI.NH", label: "南华黑色指数" },
  { code: "NHPMI.NH", label: "南华贵金属指数" },
  { code: "NHNEI.NH", label: "南华新能源指数" },
  { code: "NHNFI.NH", label: "南华有色金属指数" },
] as const

export const STOCK_CATEGORY_OPTIONS = [
  { code: "IF", label: "沪深300" },
  { code: "IC", label: "中证500" },
  { code: "IM", label: "中证1000" },
  { code: "IH", label: "上证50" },
] as const

export const ROLLING_WINDOW_OPTIONS = [
  { days: 5, label: "5日" },
  { days: 10, label: "10日" },
  { days: 20, label: "20日" },
  { days: 60, label: "60日" },
] as const

export const FUTURES_INDICATORS: ScenarioIndicatorKey[] = [
  "tsVol", "amplitude", "gap", "trend", "crossSection", "volumeOi",
]

export const STOCK_INDICATORS: ScenarioIndicatorKey[] = [
  "tsVol", "amplitude", "gap", "trend", "crossSection",
]

export const OPTION_INDICATORS: ScenarioIndicatorKey[] = [
  "tsVol", "amplitude", "gap", "trend",
]
