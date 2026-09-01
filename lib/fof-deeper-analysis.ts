/**
 * Deeper FOF charts: vol control, allocation vs risk, and market-condition attribution.
 */

import {
  fofHoldingKey,
  normalizeFofDisplayName,
  strategyHead,
  type FofPortfolioVarResult,
} from "@/lib/fof-portfolio-var"
import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"

export type NavPoint = { date: string; nav: number }
export type BenchPoint = { date: string; value: number }

export const FOF_STRATEGY_POLICY_BANDS: Record<string, { min: number; max: number }> = {
  股票对冲: { min: 15, max: 45 },
  期货策略: { min: 10, max: 40 },
  套利策略: { min: 5, max: 25 },
  债券策略: { min: 0, max: 20 },
  多资产策略: { min: 0, max: 25 },
  股票多头: { min: 0, max: 25 },
  期权策略: { min: 0, max: 15 },
  组合策略: { min: 0, max: 30 },
  其他: { min: 0, max: 15 },
  未配置: { min: 0, max: 15 },
}

export const STRATEGY_CHART_COLORS: Record<string, string> = {
  组合策略: "#1A73E8",
  股票多头: "#D93025",
  期货策略: "#FBBC04",
  股票对冲: "#9333ea",
  套利策略: "#22c55e",
  多资产策略: "#14b8a6",
  债券策略: "#8B5CF6",
  期权策略: "#EC4899",
  其他: "#78716C",
  未配置: "#9ca3af",
}

const PALETTE = ["#e54d42", "#5b9bd5", "#ed7d31", "#14b8a6", "#8b5cf6", "#eab308", "#64748b", "#ec4899"]

export function strategyColor(name: string, index = 0): string {
  return STRATEGY_CHART_COLORS[name] ?? PALETTE[index % PALETTE.length]
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0
}

function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1))
}

function lastNavByWeek(points: NavPoint[]): NavPoint[] {
  const byWeek = new Map<string, number>()
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    const d = new Date(`${p.date.slice(0, 10)}T12:00:00`)
    const dow = d.getDay()
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    byWeek.set(`${y}-${m}-${day}`, p.nav)
  }
  return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, nav]) => ({ date, nav }))
}

function lastNavByMonth(points: NavPoint[]): NavPoint[] {
  const byMonth = new Map<string, number>()
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    byMonth.set(p.date.slice(0, 7), p.nav)
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, nav]) => ({ date: `${ym}-28`, nav }))
}

function periodReturns(points: NavPoint[]): { date: string; ret: number }[] {
  const out: { date: string; ret: number }[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].nav
    const curr = points[i].nav
    if (prev > 0 && Number.isFinite(curr)) out.push({ date: points[i].date, ret: curr / prev - 1 })
  }
  return out
}

function alignOnDates(points: NavPoint[], dates: string[]): Array<number | null> {
  const byDate = new Map(points.map((p) => [p.date.slice(0, 10), p.nav]))
  let last: number | null = null
  return dates.map((d) => {
    const hit = byDate.get(d.slice(0, 10))
    if (hit != null) last = hit
    return last
  })
}

export function pickRollingVolWindows(returnCount: number): number[] {
  if (returnCount >= 26) return [13, 26]
  if (returnCount >= 13) return [8, 13]
  if (returnCount >= 8) return [8]
  if (returnCount >= 4) return [4]
  return []
}

function rollingVolFromReturns(
  rets: Array<{ date: string; ret: number }>,
  ppy: number,
  windows?: number[],
): {
  dates: string[]
  series: Array<{ window: number; values: Array<number | null> }>
  windows: number[]
  ppy: number
} {
  const chosen = windows?.length ? windows : pickRollingVolWindows(rets.length)
  const dates = rets.map((r) => r.date)
  const series = chosen.map((window) => ({
    window,
    values: rets.map((_, i) => {
      if (i + 1 < window) return null
      const slice = rets.slice(i + 1 - window, i + 1).map((r) => r.ret)
      const vol = sampleStd(slice) * Math.sqrt(ppy) * 100
      return Number.isFinite(vol) ? +vol.toFixed(2) : null
    }),
  }))
  return { dates, series, windows: chosen, ppy }
}

export function computeRollingVolSeries(
  navPoints: NavPoint[],
  windows?: number[],
): {
  dates: string[]
  series: Array<{ window: number; values: Array<number | null> }>
  windows: number[]
  ppy: number
} {
  const weekly = lastNavByWeek(navPoints)
  return rollingVolFromReturns(periodReturns(weekly), 52, windows)
}

export function computeRollingVolFromPortfolio(
  result: FofPortfolioVarResult | null,
  windows?: number[],
): {
  dates: string[]
  series: Array<{ window: number; values: Array<number | null> }>
  windows: number[]
  ppy: number
} {
  if (!result || result.portPeriodReturns.length < 4) {
    return { dates: [], series: [], windows: [], ppy: 52 }
  }
  const ppy = result.periodsPerYear > 0 ? result.periodsPerYear : 52
  const rets = result.alignedDates.map((date, i) => ({
    date,
    ret: result.portPeriodReturns[i] ?? 0,
  })).filter((r) => r.date)
  return rollingVolFromReturns(rets, ppy, windows)
}

export type VarBacktestPoint = {
  date: string
  predictedVaRPct: number
  realizedLossPct: number
  exception: boolean
}

export function computeVarBacktest(
  result: FofPortfolioVarResult | null,
  trailing = 12,
): { points: VarBacktestPoint[]; exceptionCount: number; obsCount: number } {
  if (!result || result.portPeriodReturns.length < trailing + 2) {
    return { points: [], exceptionCount: 0, obsCount: 0 }
  }
  const z = result.zScore
  const rets = result.portPeriodReturns
  const dates = result.alignedDates
  const points: VarBacktestPoint[] = []
  for (let t = trailing; t < rets.length; t++) {
    const trail = rets.slice(t - trailing, t)
    const sigma = sampleStd(trail)
    const predictedVaRPct = z * sigma * 100
    const realizedLossPct = -rets[t] * 100
    points.push({
      date: dates[t] ?? "",
      predictedVaRPct: +predictedVaRPct.toFixed(3),
      realizedLossPct: +realizedLossPct.toFixed(3),
      exception: realizedLossPct > predictedVaRPct && predictedVaRPct > 0,
    })
  }
  return {
    points,
    exceptionCount: points.filter((p) => p.exception).length,
    obsCount: points.length,
  }
}

export type CrcAreaPoint = {
  date: string
  values: Record<string, number>
}

export type CrcFundRef = {
  key: string
  name: string
  strategy: string | null
}

export type TrailingCrcByFund = {
  dates: string[]
  funds: CrcFundRef[]
  rows: CrcAreaPoint[]
}

export type CrcLabelFn = (fund: CrcFundRef) => string | string[]

export type CrcStrategyLabels = {
  l1: string
  l2: string
  l3s: string[]
}

export type CrcHoldingRef = {
  fundName: string
  beianHao?: string | null
  valuationCode?: string | null
  fundStrategy?: string | null
  strategyL1?: string | null
  strategyL2?: string | null
  strategyL3?: string | null
}

const CRC_UNCONFIGURED = "未配置"

function splitStrategyPath(strategy: string | null | undefined): string[] {
  return (strategy ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
}

function splitStrategyL3(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[，,、]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function addCrcShare(values: Record<string, number>, labels: string | string[], crc: number) {
  const parts = (Array.isArray(labels) ? labels : [labels]).map((n) => n.trim() || CRC_UNCONFIGURED)
  const keys = parts.length > 0 ? parts : [CRC_UNCONFIGURED]
  const share = crc / keys.length
  for (const key of keys) values[key] = (values[key] ?? 0) + share
}

export function parseCrcStrategyLabels(h: {
  fundStrategy?: string | null
  strategyL1?: string | null
  strategyL2?: string | null
  strategyL3?: string | null
}): CrcStrategyLabels {
  const fromPath = splitStrategyPath(h.fundStrategy)
  const l1 = h.strategyL1?.trim() || fromPath[0] || CRC_UNCONFIGURED
  const l2 = h.strategyL2?.trim() || fromPath[1] || CRC_UNCONFIGURED
  const l3s = splitStrategyL3(h.strategyL3)
  return { l1, l2, l3s: l3s.length > 0 ? l3s : [CRC_UNCONFIGURED] }
}

export function buildCrcStrategyLookup(holdings: CrcHoldingRef[]): Map<string, CrcStrategyLabels> {
  const map = new Map<string, CrcStrategyLabels>()
  const set = (key: string | null | undefined, labels: CrcStrategyLabels) => {
    const k = key?.trim()
    if (k) map.set(k, labels)
  }
  for (const h of holdings) {
    const labels = parseCrcStrategyLabels(h)
    set(fofHoldingKey({
      fundName: h.fundName,
      beianHao: h.beianHao ?? null,
      valuationCode: h.valuationCode ?? null,
    }), labels)
    set(h.beianHao, labels)
    set(h.valuationCode?.trim().toUpperCase(), labels)
    set(h.fundName, labels)
    const stripped = stripValuationSubjectPathPrefix(h.fundName) || h.fundName
    set(stripped, labels)
    set(normalizeFofDisplayName(h.fundName), labels)
    set(normalizeFofDisplayName(stripped), labels)
  }
  return map
}

export function crcLabelsForFund(
  fund: CrcFundRef,
  lookup: Map<string, CrcStrategyLabels>,
): CrcStrategyLabels {
  return lookup.get(fund.key)
    ?? lookup.get(fund.name)
    ?? lookup.get(normalizeFofDisplayName(fund.key))
    ?? lookup.get(normalizeFofDisplayName(fund.name))
    ?? parseCrcStrategyLabels({ fundStrategy: fund.strategy })
}

export function crcGroupLabel(labels: CrcStrategyLabels, level: 1 | 2 | 3): string | string[] {
  if (level === 1) return labels.l1
  if (level === 2) {
    if (labels.l2 === CRC_UNCONFIGURED) {
      return labels.l1 === CRC_UNCONFIGURED ? CRC_UNCONFIGURED : `${labels.l1}/${CRC_UNCONFIGURED}`
    }
    return `${labels.l1}/${labels.l2}`
  }
  if (labels.l3s.length === 1 && labels.l3s[0] === CRC_UNCONFIGURED) return CRC_UNCONFIGURED
  const prefix = labels.l2 !== CRC_UNCONFIGURED
    ? `${labels.l1}/${labels.l2}`
    : labels.l1
  return labels.l3s.map((l3) => (l3 === CRC_UNCONFIGURED ? CRC_UNCONFIGURED : `${prefix}/${l3}`))
}

export function shareTrendToCrcByFund(
  trend: { dates: string[]; series: Array<{ name: string; values: number[] }> } | null | undefined,
  fromDate?: string,
  toDate?: string,
): TrailingCrcByFund {
  if (!trend || trend.dates.length === 0 || trend.series.length === 0) {
    return { dates: [], funds: [], rows: [] }
  }
  const from = fromDate?.slice(0, 10)
  const to = toDate?.slice(0, 10)
  const keep = trend.dates
    .map((date, i) => ({ date, i }))
    .filter(({ date }) => {
      if (from && date < from) return false
      if (to && date > to) return false
      return true
    })
  if (keep.length === 0) return { dates: [], funds: [], rows: [] }
  const funds = trend.series.map((s) => ({
    key: s.name,
    name: s.name,
    strategy: s.name.includes("/") ? s.name : null,
  }))
  const rows = keep.map(({ date, i }) => {
    const values: Record<string, number> = {}
    for (const s of trend.series) values[s.name] = s.values[i] ?? 0
    return { date, values }
  })
  return { dates: rows.map((r) => r.date), funds, rows }
}

function nameAliases(name: string): string[] {
  const stripped = stripValuationSubjectPathPrefix(name) || name
  return [...new Set([
    name.trim(),
    stripped.trim(),
    normalizeFofDisplayName(name),
    normalizeFofDisplayName(stripped),
  ].filter(Boolean))]
}

function matchWeightKeys(
  funds: Array<{ key: string; name: string }>,
  weightKeys: string[],
): Array<string | null> {
  const byAlias = new Map<string, string>()
  for (const key of weightKeys) {
    for (const alias of nameAliases(key)) {
      if (!byAlias.has(alias)) byAlias.set(alias, key)
    }
  }
  return funds.map((fund) => {
    for (const alias of [...nameAliases(fund.key), ...nameAliases(fund.name)]) {
      const hit = byAlias.get(alias)
      if (hit) return hit
    }
    return null
  })
}

function sampleCov(slices: number[][]): number[][] {
  const n = slices.length
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => {
      const a = slices[i]
      const b = slices[j]
      const m = Math.min(a.length, b.length)
      if (m < 3) return 0
      const ma = mean(a)
      const mb = mean(b)
      let s = 0
      for (let k = 0; k < m; k++) s += (a[k] - ma) * (b[k] - mb)
      return s / (m - 1)
    }),
  )
}

export function computeTrailingCrcByFund(
  result: FofPortfolioVarResult | null,
  window = 12,
  historicalWeights: TrailingCrcByFund | null = null,
): TrailingCrcByFund {
  if (
    !result
    || !historicalWeights
    || historicalWeights.rows.length < 2
    || result.fundReturns.length === 0
    || result.alignedDates.length < window + 1
  ) {
    return { dates: [], funds: [], rows: [] }
  }
  const funds = result.fundReturns
  const T = result.alignedDates.length
  const weightKeys = matchWeightKeys(funds, historicalWeights.funds.map((f) => f.key))
  if (weightKeys.every((k) => k == null)) {
    return { dates: [], funds: [], rows: [] }
  }
  const rows: CrcAreaPoint[] = []
  let t = -1
  for (const snap of historicalWeights.rows) {
    while (t + 1 < T && result.alignedDates[t + 1] <= snap.date) t++
    if (t < window) continue
    const raw = funds.map((_, i) => {
      const key = weightKeys[i]
      const v = key ? snap.values[key] ?? 0 : 0
      return Number.isFinite(v) && v > 0 ? v : 0
    })
    const sum = raw.reduce((s, v) => s + v, 0)
    if (sum < 1e-8) continue
    const w = raw.map((v) => v / sum)
    const slices = funds.map((f) => f.returns.slice(t - window, t))
    const cov = sampleCov(slices)
    const n = funds.length
    let portVar = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) portVar += w[i] * w[j] * cov[i][j]
    }
    const values: Record<string, number> = {}
    if (portVar > 1e-16) {
      for (let i = 0; i < n; i++) {
        let sigmaW = 0
        for (let j = 0; j < n; j++) sigmaW += cov[i][j] * w[j]
        values[funds[i].key] = (w[i] * sigmaW / portVar) * 100
      }
    } else {
      for (const f of funds) values[f.key] = 0
    }
    rows.push({ date: snap.date, values })
  }
  return {
    dates: rows.map((r) => r.date),
    funds: funds.map((f) => ({ key: f.key, name: f.name, strategy: f.strategy })),
    rows,
  }
}

export function filterTrailingCrcByFund(
  source: TrailingCrcByFund,
  pred: (fund: CrcFundRef) => boolean,
): TrailingCrcByFund {
  const funds = source.funds.filter(pred)
  return {
    dates: source.dates,
    funds,
    rows: source.rows.map((row) => {
      const values: Record<string, number> = {}
      for (const fund of funds) values[fund.key] = row.values[fund.key] ?? 0
      return { date: row.date, values }
    }),
  }
}

export function groupTrailingCrcArea(
  source: TrailingCrcByFund,
  labelOf: CrcLabelFn,
  topN = 8,
): { dates: string[]; names: string[]; rows: CrcAreaPoint[] } {
  if (source.rows.length === 0 || source.funds.length === 0) {
    return { dates: [], names: [], rows: [] }
  }
  const latest = source.rows[source.rows.length - 1]
  const latestTotals: Record<string, number> = {}
  for (const fund of source.funds) {
    addCrcShare(latestTotals, labelOf(fund), latest.values[fund.key] ?? 0)
  }
  const names = Object.entries(latestTotals)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, topN)
    .map(([name]) => name)
  const nameSet = new Set(names)
  const rows = source.rows.map((row) => {
    const values: Record<string, number> = { 其他: 0 }
    for (const name of names) values[name] = 0
    for (const fund of source.funds) {
      const raw = labelOf(fund)
      const parts = (Array.isArray(raw) ? raw : [raw])
        .map((n) => n.trim() || CRC_UNCONFIGURED)
      const keys = parts.length > 0 ? parts : [CRC_UNCONFIGURED]
      const share = (row.values[fund.key] ?? 0) / keys.length
      for (const key of keys) {
        const dest = nameSet.has(key) ? key : "其他"
        values[dest] = (values[dest] ?? 0) + share
      }
    }
    return { date: row.date, values }
  })
  return { dates: source.dates, names: [...names, "其他"], rows }
}

export function renormalizeCrcArea(area: {
  dates: string[]
  names: string[]
  rows: CrcAreaPoint[]
}): { dates: string[]; names: string[]; rows: CrcAreaPoint[] } {
  return {
    dates: area.dates,
    names: area.names,
    rows: area.rows.map((row) => {
      const sum = Object.values(row.values).reduce((s, v) => s + v, 0)
      if (Math.abs(sum) < 1e-8) return { date: row.date, values: { ...row.values } }
      const values: Record<string, number> = {}
      for (const [key, value] of Object.entries(row.values)) {
        values[key] = (value / sum) * 100
      }
      return { date: row.date, values }
    }),
  }
}

export function renormalizeTrailingByFund(source: TrailingCrcByFund): TrailingCrcByFund {
  if (source.rows.length === 0) return source
  return {
    dates: source.dates,
    funds: source.funds,
    rows: source.rows.map((row) => {
      const sum = Object.values(row.values).reduce((s, v) => s + v, 0)
      if (Math.abs(sum) < 1e-8) return { date: row.date, values: { ...row.values } }
      const values: Record<string, number> = {}
      for (const [key, value] of Object.entries(row.values)) {
        values[key] = (value / sum) * 100
      }
      return { date: row.date, values }
    }),
  }
}

export function computeTrailingCrcArea(
  result: FofPortfolioVarResult | null,
  window = 12,
  topN = 8,
): { dates: string[]; names: string[]; rows: CrcAreaPoint[] } {
  return groupTrailingCrcArea(
    computeTrailingCrcByFund(result, window),
    (fund) => fund.name,
    topN,
  )
}

export type StrategyMixRow = {
  strategy: string
  capitalPct: number
  riskPct: number
}

export function computeStrategyCapitalVsRisk(result: FofPortfolioVarResult | null): StrategyMixRow[] {
  if (!result) return []
  const by = new Map<string, { capital: number; risk: number }>()
  for (const f of result.funds) {
    if (f.status !== "ok") continue
    const key = strategyHead(f.strategy) || "未配置"
    const cur = by.get(key) ?? { capital: 0, risk: 0 }
    cur.capital += f.weightPct
    cur.risk += f.riskContribPct ?? 0
    by.set(key, cur)
  }
  return [...by.entries()]
    .map(([strategy, v]) => ({ strategy, capitalPct: v.capital, riskPct: v.risk }))
    .sort((a, b) => b.riskPct - a.riskPct)
}

export function effectiveBets(weightsPct: number[]): number | null {
  const w = weightsPct.filter((x) => Number.isFinite(x) && x > 0).map((x) => x / 100)
  const sum = w.reduce((s, v) => s + v, 0)
  if (sum <= 0) return null
  const norm = w.map((v) => v / sum)
  const herfindahl = norm.reduce((s, v) => s + v * v, 0)
  return herfindahl > 0 ? 1 / herfindahl : null
}

export type EnbPoint = { date: string; capital: number | null }

export function computeEnbTimeSeries(
  dates: string[],
  series: Array<{ name: string; values: number[] }>,
): EnbPoint[] {
  if (!dates.length || !series.length) return []
  return dates.map((date, i) => {
    const weights = series.map((s) => s.values[i] ?? 0)
    const n = effectiveBets(weights)
    return { date, capital: n != null ? +n.toFixed(2) : null }
  })
}

export type PolicyBandRow = {
  strategy: string
  currentPct: number
  min: number
  max: number
  status: "in" | "below" | "above"
}

export function computePolicyBandSnapshot(
  latestWeights: Array<{ name: string; pct: number }>,
): PolicyBandRow[] {
  return latestWeights
    .filter((w) => w.pct > 0.05)
    .map((w) => {
      const band = FOF_STRATEGY_POLICY_BANDS[w.name] ?? { min: 0, max: Math.max(20, w.pct * 1.5) }
      const status: PolicyBandRow["status"] =
        w.pct < band.min - 0.5 ? "below" : w.pct > band.max + 0.5 ? "above" : "in"
      return { strategy: w.name, currentPct: w.pct, min: band.min, max: band.max, status }
    })
    .sort((a, b) => b.currentPct - a.currentPct)
}

export type MonthlyRet = { ym: string; date: string; ret: number }

export function monthlyReturnsFromNav(points: NavPoint[]): MonthlyRet[] {
  return periodReturns(lastNavByMonth(points)).map((r) => ({
    ym: r.date.slice(0, 7),
    date: r.date,
    ret: r.ret,
  }))
}

export function monthlyReturnsFromBench(points: BenchPoint[]): MonthlyRet[] {
  return monthlyReturnsFromNav(points.map((p) => ({ date: p.date, nav: p.value })))
}

function joinMonthlyPair(fund: MonthlyRet[], bench: MonthlyRet[]): Array<{ ym: string; fund: number; bench: number }> {
  const mb = new Map(bench.map((r) => [r.ym, r.ret]))
  return fund.flatMap((r) => {
    const b = mb.get(r.ym)
    return b == null ? [] : [{ ym: r.ym, fund: r.ret, bench: b }]
  })
}

export type RegimeBucket = {
  key: string
  label: string
  count: number
  avgFundPct: number
  avgBenchPct: number
}

export function computeEquityRegimes(
  fundMonthly: MonthlyRet[],
  equityMonthly: MonthlyRet[],
): RegimeBucket[] {
  const joined = joinMonthlyPair(fundMonthly, equityMonthly)
  const buckets: Record<string, { fund: number[]; bench: number[] }> = {
    up: { fund: [], bench: [] },
    chop: { fund: [], bench: [] },
    down: { fund: [], bench: [] },
  }
  for (const row of joined) {
    const key = row.bench > 0.01 ? "up" : row.bench < -0.01 ? "down" : "chop"
    buckets[key].fund.push(row.fund)
    buckets[key].bench.push(row.bench)
  }
  return [
    { key: "up", label: "股市上涨月", ...summarizeBucket(buckets.up) },
    { key: "chop", label: "股市震荡月", ...summarizeBucket(buckets.chop) },
    { key: "down", label: "股市下跌月", ...summarizeBucket(buckets.down) },
  ]
}

export function computeVolRegimes(
  fundMonthly: MonthlyRet[],
  equityMonthly: MonthlyRet[],
): RegimeBucket[] {
  const joined = joinMonthlyPair(fundMonthly, equityMonthly)
  if (joined.length < 6) return []
  const abs = joined.map((r) => Math.abs(r.bench)).sort((a, b) => a - b)
  const p33 = abs[Math.floor(abs.length * 0.33)] ?? 0
  const p67 = abs[Math.floor(abs.length * 0.67)] ?? 0
  const buckets: Record<string, { fund: number[]; bench: number[] }> = {
    low: { fund: [], bench: [] },
    mid: { fund: [], bench: [] },
    high: { fund: [], bench: [] },
  }
  for (const row of joined) {
    const a = Math.abs(row.bench)
    const key = a <= p33 ? "low" : a >= p67 ? "high" : "mid"
    buckets[key].fund.push(row.fund)
    buckets[key].bench.push(row.bench)
  }
  return [
    { key: "low", label: "低波动月", ...summarizeBucket(buckets.low) },
    { key: "mid", label: "中波动月", ...summarizeBucket(buckets.mid) },
    { key: "high", label: "高波动月", ...summarizeBucket(buckets.high) },
  ]
}

function summarizeBucket(b: { fund: number[]; bench: number[] }): {
  count: number
  avgFundPct: number
  avgBenchPct: number
} {
  return {
    count: b.fund.length,
    avgFundPct: b.fund.length ? mean(b.fund) * 100 : 0,
    avgBenchPct: b.bench.length ? mean(b.bench) * 100 : 0,
  }
}

export type CaptureRow = {
  label: string
  up: number | null
  down: number | null
}

export function computeUpDownCapture(
  fundMonthly: MonthlyRet[],
  benches: Array<{ label: string; series: MonthlyRet[] }>,
): CaptureRow[] {
  return benches.map(({ label, series }) => {
    const joined = joinMonthlyPair(fundMonthly, series)
    const upF = joined.filter((r) => r.bench > 0)
    const dnF = joined.filter((r) => r.bench < 0)
    const upB = upF.reduce((s, r) => s + r.bench, 0)
    const dnB = dnF.reduce((s, r) => s + r.bench, 0)
    const up = upB !== 0 ? upF.reduce((s, r) => s + r.fund, 0) / upB : null
    const down = dnB !== 0 ? dnF.reduce((s, r) => s + r.fund, 0) / dnB : null
    return { label, up, down }
  })
}

export type StressMonthRow = {
  ym: string
  benchPct: number
  fundPct: number
}

export function computeStressMonths(
  fundMonthly: MonthlyRet[],
  equityMonthly: MonthlyRet[],
  n = 10,
): { worst: StressMonthRow[]; best: StressMonthRow[] } {
  const joined = joinMonthlyPair(fundMonthly, equityMonthly)
    .map((r) => ({ ym: r.ym, benchPct: r.bench * 100, fundPct: r.fund * 100 }))
  const worst = [...joined].sort((a, b) => a.benchPct - b.benchPct).slice(0, n)
  const best = [...joined].sort((a, b) => b.benchPct - a.benchPct).slice(0, n)
  return { worst, best }
}

export type DrawdownPoint = {
  date: string
  fundDD: number
  benchDD: number | null
}

export function computeDrawdownCoincidence(
  fundNav: NavPoint[],
  bench: BenchPoint[],
): DrawdownPoint[] {
  const dates = [...new Set(fundNav.map((p) => p.date.slice(0, 10)))].sort()
  const fundAligned = alignOnDates(fundNav, dates)
  const benchAligned = alignOnDates(bench.map((p) => ({ date: p.date, nav: p.value })), dates)
  let fundPeak: number | null = null
  let benchPeak: number | null = null
  return dates.map((date, i) => {
    const fv = fundAligned[i]
    const bv = benchAligned[i]
    if (fv != null && fv > 0) fundPeak = fundPeak == null ? fv : Math.max(fundPeak, fv)
    if (bv != null && bv > 0) benchPeak = benchPeak == null ? bv : Math.max(benchPeak, bv)
    return {
      date,
      fundDD: fv != null && fundPeak ? +(((fv - fundPeak) / fundPeak) * 100).toFixed(3) : 0,
      benchDD: bv != null && benchPeak ? +(((bv - benchPeak) / benchPeak) * 100).toFixed(3) : null,
    }
  })
}

export type SleeveRegimeRow = {
  strategy: string
  buckets: RegimeBucket[]
}

export function computeSleeveEquityRegimes(
  result: FofPortfolioVarResult | null,
  equityMonthly: MonthlyRet[],
): SleeveRegimeRow[] {
  if (!result || result.fundReturns.length === 0) return []
  const by = new Map<string, { weight: number; returns: number[] }[]>()
  for (const f of result.fundReturns) {
    const key = strategyHead(f.strategy) || "未配置"
    const list = by.get(key) ?? []
    list.push({ weight: f.weightPct, returns: f.returns })
    by.set(key, list)
  }
  const dates = result.alignedDates
  const out: SleeveRegimeRow[] = []
  for (const [strategy, members] of by) {
    const tot = members.reduce((s, m) => s + m.weight, 0) || 1
    const sleeveNav = new Map<string, number>()
    for (let t = 0; t < dates.length; t++) {
      let r = 0
      for (const m of members) r += (m.weight / tot) * (m.returns[t] ?? 0)
      const ym = dates[t].slice(0, 7)
      sleeveNav.set(ym, (sleeveNav.get(ym) ?? 1) * (1 + r))
    }
    const fundMonthly: MonthlyRet[] = [...sleeveNav.entries()].map(([ym, nav]) => ({
      ym,
      date: `${ym}-28`,
      ret: nav - 1,
    }))
    out.push({ strategy, buckets: computeEquityRegimes(fundMonthly, equityMonthly) })
  }
  return out.sort((a, b) => a.strategy.localeCompare(b.strategy))
}

/** L1 strategies treated as ~100% long A-share beta. */
export const STOCK_LONG_ONLY_L1 = new Set(["股票多头", "股票策略"])
/** L1 strategies with a smaller net long after the fund's own hedge. */
export const STOCK_HEDGE_L1 = new Set(["股票对冲"])
/** Default net-long ratio applied to 股票对冲 capital when the fund does not disclose exposure. */
export const DEFAULT_LS_NET_EXPOSURE_PCT = 20
/** Default risk weight for 打板 / 股票多头 / 直持股票 / ETF. */
export const DEFAULT_FULL_LONG_WEIGHT_PCT = 100
export const MAX_PRODUCT_RISK_WEIGHT_PCT = 300

export type FofEquityBucket =
  | "limit_up"
  | "long_only"
  | "hedge"
  | "direct_stock"
  | "etf"
  | "other"

export type FofHedgeHolding = {
  fundName: string
  fundStrategy?: string | null
  strategyL1?: string | null
  strategyL2?: string | null
  strategyL3?: string | null
  marketValue: number
  marketPct: number
  rowKind?: string
  valuationCode?: string | null
  beianHao?: string | null
}

export type FofHedgeOtherHolding = {
  assetName: string
  category?: string
  marketValue: number
}

export type FofHedgeBucketFactors = {
  longOnlyPct: number
  limitUpPct: number
  hedgePct: number
}

export type FofStockHedgeSnapshot = {
  longOnlyMv: number
  longOnlyPct: number
  longOnlyGrossMv: number
  limitUpMv: number
  limitUpPct: number
  limitUpGrossMv: number
  lsGrossMv: number
  lsNetMv: number
  lsNetPct: number
  lsEffectivePct: number
  directStockMv: number
  directStockPct: number
  etfMv: number
  etfPct: number
  otherRiskMv: number
  otherRiskPct: number
  existingHedgeMv: number
  existingHedgePct: number
  grossLongMv: number
  grossLongPct: number
  netExposureMv: number
  netExposurePct: number
  hedgeNotionalMv: number
  hedgeSide: "short_futures" | "long_futures" | "none"
  lsNetAssumptionPct: number
  hasEquityBook: boolean
}

export type FofStockHedgePoint = {
  date: string
  longOnlyPct: number
  limitUpPct: number
  lsNetPct: number
  netPct: number
}

function holdingL1(h: FofHedgeHolding): string {
  return (h.strategyL1?.trim() || strategyHead(h.fundStrategy) || "")
}

function holdingL2(h: FofHedgeHolding): string {
  return (h.strategyL2?.trim() || "")
}

function holdingStrategyText(h: FofHedgeHolding): string {
  return [h.strategyL1, h.strategyL2, h.strategyL3, h.fundStrategy].filter(Boolean).join("/")
}

export function isLimitUpStrategy(l1: string, l2: string, text: string): boolean {
  return /打板/.test(`${l1}/${l2}/${text}`)
}

export function isHedgeStrategy(l1: string, text: string): boolean {
  if (/打板/.test(text)) return false
  return STOCK_HEDGE_L1.has(l1) || /股票对冲/.test(text)
}

export function isLongOnlyStrategy(l1: string, text: string): boolean {
  if (isLimitUpStrategy(l1, "", text) || isHedgeStrategy(l1, text)) return false
  if (STOCK_LONG_ONLY_L1.has(l1)) return true
  return /股票多头/.test(text)
}

export function isDirectEquityHolding(h: FofHedgeHolding): boolean {
  if (/ETF/u.test(h.fundName)) return false
  if (h.rowKind === "stock") return true
  if (h.rowKind === "fund_or_stock") {
    const code = (h.valuationCode ?? "").replace(/\.(SZ|SH|BJ)$/i, "").trim()
    if (/^\d{6}$/.test(code)) return true
    if (!h.valuationCode && !h.beianHao) return true
  }
  return false
}

export function isEquityEtfHolding(h: FofHedgeHolding): boolean {
  return /ETF/u.test(h.fundName)
}

export function classifyFofEquityHolding(h: FofHedgeHolding): FofEquityBucket {
  if (isDirectEquityHolding(h)) return "direct_stock"
  if (isEquityEtfHolding(h)) return "etf"
  const l1 = holdingL1(h)
  const l2 = holdingL2(h)
  const text = holdingStrategyText(h)
  if (isLimitUpStrategy(l1, l2, text)) return "limit_up"
  if (isHedgeStrategy(l1, text)) return "hedge"
  if (isLongOnlyStrategy(l1, text)) return "long_only"
  return "other"
}

export function fofEquityBucketLabel(bucket: FofEquityBucket): string {
  if (bucket === "limit_up") return "打板"
  if (bucket === "long_only") return "股票多头"
  if (bucket === "hedge") return "股票对冲"
  if (bucket === "direct_stock") return "直持股票"
  if (bucket === "etf") return "ETF"
  return "其他"
}

export function hedgeHoldingKey(
  h: Pick<FofHedgeHolding, "fundName" | "beianHao" | "valuationCode">,
): string {
  return (h.beianHao?.trim() || h.valuationCode?.trim() || h.fundName).toUpperCase()
}

export function defaultHedgeRiskWeightPct(
  bucket: FofEquityBucket,
  lsNetAssumptionPct = DEFAULT_LS_NET_EXPOSURE_PCT,
): number {
  if (bucket === "hedge") return Math.max(0, lsNetAssumptionPct)
  if (bucket === "other") return 0
  return DEFAULT_FULL_LONG_WEIGHT_PCT
}

export function resolveHedgeRiskWeightPct(
  h: FofHedgeHolding,
  overrides: Record<string, number> | undefined,
  lsNetAssumptionPct = DEFAULT_LS_NET_EXPOSURE_PCT,
): number {
  const raw = overrides?.[hedgeHoldingKey(h)]
  if (raw != null && Number.isFinite(raw) && raw >= 0) {
    return Math.min(raw, MAX_PRODUCT_RISK_WEIGHT_PCT)
  }
  return defaultHedgeRiskWeightPct(classifyFofEquityHolding(h), lsNetAssumptionPct)
}

export function computeFofHedgeBucketFactors(
  holdings: FofHedgeHolding[],
  overrides: Record<string, number> | undefined,
  lsNetAssumptionPct = DEFAULT_LS_NET_EXPOSURE_PCT,
): FofHedgeBucketFactors {
  let longOnlyMv = 0
  let longOnlyRisk = 0
  let limitUpMv = 0
  let limitUpRisk = 0
  let hedgeMv = 0
  let hedgeRisk = 0
  for (const h of holdings) {
    const mv = h.marketValue
    if (!Number.isFinite(mv) || mv === 0) continue
    const bucket = classifyFofEquityHolding(h)
    const risk = mv * resolveHedgeRiskWeightPct(h, overrides, lsNetAssumptionPct) / 100
    if (bucket === "long_only") {
      longOnlyMv += mv
      longOnlyRisk += risk
    } else if (bucket === "limit_up") {
      limitUpMv += mv
      limitUpRisk += risk
    } else if (bucket === "hedge") {
      hedgeMv += mv
      hedgeRisk += risk
    }
  }
  return {
    longOnlyPct: longOnlyMv > 0 ? (longOnlyRisk / longOnlyMv) * 100 : DEFAULT_FULL_LONG_WEIGHT_PCT,
    limitUpPct: limitUpMv > 0 ? (limitUpRisk / limitUpMv) * 100 : DEFAULT_FULL_LONG_WEIGHT_PCT,
    hedgePct: hedgeMv > 0 ? (hedgeRisk / hedgeMv) * 100 : Math.max(0, lsNetAssumptionPct),
  }
}

function isIndexFuturesName(name: string, category?: string): boolean {
  const text = `${name} ${category ?? ""}`
  return /股指期货|(^|[^A-Za-z])(IF|IH|IC|IM)\d{3,4}/i.test(text)
}

export function computeFofStockHedgeSnapshot(
  holdings: FofHedgeHolding[],
  netAssetValue: number,
  lsNetAssumptionPct = DEFAULT_LS_NET_EXPOSURE_PCT,
  otherHoldings: FofHedgeOtherHolding[] = [],
  productWeightOverrides?: Record<string, number>,
): FofStockHedgeSnapshot {
  const nav = netAssetValue > 0 ? netAssetValue : 0
  const pct = (mv: number) => (nav > 0 ? (mv / nav) * 100 : 0)

  let longOnlyMv = 0
  let longOnlyGrossMv = 0
  let limitUpMv = 0
  let limitUpGrossMv = 0
  let lsGrossMv = 0
  let lsNetMv = 0
  let directStockMv = 0
  let etfMv = 0
  let otherRiskMv = 0

  for (const h of holdings) {
    const mv = h.marketValue
    if (!Number.isFinite(mv) || mv === 0) continue
    const bucket = classifyFofEquityHolding(h)
    const weight = resolveHedgeRiskWeightPct(h, productWeightOverrides, lsNetAssumptionPct)
    const riskMv = mv * weight / 100
    if (bucket === "direct_stock") {
      directStockMv += riskMv
    } else if (bucket === "etf") {
      etfMv += riskMv
    } else if (bucket === "limit_up") {
      limitUpGrossMv += mv
      limitUpMv += riskMv
    } else if (bucket === "long_only") {
      longOnlyGrossMv += mv
      longOnlyMv += riskMv
    } else if (bucket === "hedge") {
      lsGrossMv += mv
      lsNetMv += riskMv
    } else if (weight > 0) {
      otherRiskMv += riskMv
    }
  }

  let existingHedgeMv = 0
  for (const o of otherHoldings) {
    if (isIndexFuturesName(o.assetName, o.category)) existingHedgeMv += o.marketValue
  }

  const lsEffectivePct = lsGrossMv > 0 ? (lsNetMv / lsGrossMv) * 100 : Math.max(0, lsNetAssumptionPct)
  const grossLongMv = longOnlyMv + limitUpMv + lsNetMv + directStockMv + etfMv + otherRiskMv
  const netExposureMv = grossLongMv + existingHedgeMv
  const netExposurePct = pct(netExposureMv)
  const hedgeSide: FofStockHedgeSnapshot["hedgeSide"] =
    Math.abs(netExposurePct) < 0.05
      ? "none"
      : netExposureMv > 0
        ? "short_futures"
        : "long_futures"

  return {
    longOnlyMv,
    longOnlyPct: pct(longOnlyMv),
    longOnlyGrossMv,
    limitUpMv,
    limitUpPct: pct(limitUpMv),
    limitUpGrossMv,
    lsGrossMv,
    lsNetMv,
    lsNetPct: pct(lsNetMv),
    lsEffectivePct,
    directStockMv,
    directStockPct: pct(directStockMv),
    etfMv,
    etfPct: pct(etfMv),
    otherRiskMv,
    otherRiskPct: pct(otherRiskMv),
    existingHedgeMv,
    existingHedgePct: pct(existingHedgeMv),
    grossLongMv,
    grossLongPct: pct(grossLongMv),
    netExposureMv,
    netExposurePct,
    hedgeNotionalMv: Math.abs(netExposureMv),
    hedgeSide,
    lsNetAssumptionPct,
    hasEquityBook:
      Math.abs(grossLongMv) + Math.abs(existingHedgeMv) + Math.abs(lsGrossMv) + Math.abs(limitUpGrossMv) > 1,
  }
}

export function computeFofStockHedgeSeries(
  dates: string[],
  series: Array<{ name: string; values: number[] }>,
  lsNetAssumptionPct = DEFAULT_LS_NET_EXPOSURE_PCT,
  bucketFactors?: Partial<FofHedgeBucketFactors>,
): FofStockHedgePoint[] {
  const longOnlyFactor = Math.max(0, bucketFactors?.longOnlyPct ?? DEFAULT_FULL_LONG_WEIGHT_PCT) / 100
  const limitUpFactor = Math.max(0, bucketFactors?.limitUpPct ?? DEFAULT_FULL_LONG_WEIGHT_PCT) / 100
  const lsFactor = Math.max(0, bucketFactors?.hedgePct ?? lsNetAssumptionPct) / 100
  return dates.map((date, i) => {
    let longOnlyPct = 0
    let limitUpPct = 0
    let lsGrossPct = 0
    for (const s of series) {
      const l1 = strategyHead(s.name)
      const v = s.values[i] ?? 0
      if (isLimitUpStrategy(l1, "", s.name)) limitUpPct += v
      else if (isHedgeStrategy(l1, s.name)) lsGrossPct += v
      else if (isLongOnlyStrategy(l1, s.name)) longOnlyPct += v
    }
    const longOnlyRisk = longOnlyPct * longOnlyFactor
    const limitUpRisk = limitUpPct * limitUpFactor
    const lsNetPct = lsGrossPct * lsFactor
    return {
      date,
      longOnlyPct: +longOnlyRisk.toFixed(2),
      limitUpPct: +limitUpRisk.toFixed(2),
      lsNetPct: +lsNetPct.toFixed(2),
      netPct: +(longOnlyRisk + limitUpRisk + lsNetPct).toFixed(2),
    }
  })
}