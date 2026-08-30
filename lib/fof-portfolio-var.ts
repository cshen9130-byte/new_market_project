/**
 * FOF sleeve VaR and Euler risk contribution from underlying NAV histories
 * plus current market-value weights.
 */

import { stripValuationSubjectPathPrefix } from "@/lib/valuation-holding-display-name"

export type FofNavPoint = {
  date: string
  nav: number
}

export type FofVarSeries = {
  fundName: string
  displayName: string
  beianHao: string | null
  valuationCode: string | null
  points: FofNavPoint[]
}

export type FofVarHolding = {
  fundName: string
  beianHao: string | null
  valuationCode: string | null
  fundStrategy: string | null
  marketValue: number
  marketPct: number
}

export type FofVarConfidence = 95 | 99
export type FofVarMethod = "parametric" | "historical"

export type FofVarFill = "proxy" | "assume"

export type FofVarFundRow = {
  key: string
  name: string
  strategy: string | null
  marketValue: number
  marketPct: number
  weightPct: number
  annVolPct: number | null
  corrToPort: number | null
  riskContribPct: number | null
  varContrib: number | null
  overContribPct: number | null
  obsCount: number
  status: "ok" | "insufficient"
  fill?: FofVarFill | null
  fillNote?: string | null
}

export type FofNavGapReason = "no_nav" | "too_short" | "late_start" | "flat_window"

export type FofProxyOption = {
  key: string
  name: string
  strategy: string | null
}

export type FofNavGap = {
  key: string
  name: string
  strategy: string | null
  marketValue: number
  marketPct: number
  obsCount: number
  reason: FofNavGapReason
  suggestedProxies: FofProxyOption[]
}

export type FofGapAction =
  | { kind: "ignore" }
  | { kind: "proxy"; proxyKey: string; proxyName?: string }
  | { kind: "assume"; annVolPct: number; corr: number }

export type FofPortfolioVarResult = {
  method: FofVarMethod
  confidence: FofVarConfidence
  zScore: number
  obsCount: number
  dateFrom: string | null
  dateTo: string | null
  medianGapDays: number
  periodsPerYear: number
  freqLabel: string
  includedCount: number
  excludedCount: number
  coveredMv: number
  totalMv: number
  portfolioAnnVolPct: number
  diversificationRatio: number | null
  nextPeriodVar: number
  oneDayVar: number
  nextPeriodVarPct: number
  oneDayVarPct: number
  funds: FofVarFundRow[]
  gaps: FofNavGap[]
  alignedDates: string[]
  portPeriodReturns: number[]
  fundReturns: Array<{
    key: string
    name: string
    strategy: string | null
    weightPct: number
    returns: number[]
  }>
  corrMatrix: number[][]
}

const Z_SCORE: Record<FofVarConfidence, number> = {
  95: 1.64485,
  99: 2.32635,
}

const MIN_RETURNS = 8
const COVERAGE = 0.5

export function normalizeFofDisplayName(fundName: string): string {
  return fundName
    .replace(/私募证券投资基金/g, "")
    .replace(/私募基金/g, "")
    .trim() || fundName
}

function nameKeys(name: string): string[] {
  const stripped = stripValuationSubjectPathPrefix(name) || name
  return [...new Set([
    name.trim(),
    stripped.trim(),
    normalizeFofDisplayName(name),
    normalizeFofDisplayName(stripped),
  ].filter(Boolean))]
}

export function fofHoldingKey(
  holding: Pick<FofVarHolding, "fundName" | "beianHao" | "valuationCode">,
): string {
  return (holding.beianHao?.trim() || holding.valuationCode?.trim() || holding.fundName).toUpperCase()
}

export function strategyHead(strategy: string | null | undefined): string {
  return (strategy ?? "").split("/")[0].trim()
}

export function matchHoldingSeries<T extends FofVarSeries>(
  holding: Pick<FofVarHolding, "fundName" | "beianHao" | "valuationCode">,
  series: T[],
): T | null {
  const beian = holding.beianHao?.trim()
  if (beian) {
    const hit = series.find((s) => s.beianHao?.trim() === beian)
    if (hit) return hit
  }
  const code = holding.valuationCode?.trim().toUpperCase()
  if (code) {
    const hit = series.find((s) => s.valuationCode?.trim().toUpperCase() === code)
    if (hit) return hit
  }
  const keys = new Set(nameKeys(holding.fundName))
  return series.find((s) =>
    nameKeys(s.fundName).some((k) => keys.has(k))
    || nameKeys(s.displayName).some((k) => keys.has(k)),
  ) ?? null
}

function slicePoints(points: FofNavPoint[], fromDate?: string, toDate?: string): FofNavPoint[] {
  let sliced = points.filter((p) => Number.isFinite(p.nav) && p.nav > 0)
  if (fromDate) sliced = sliced.filter((p) => p.date >= fromDate.slice(0, 10))
  if (toDate) sliced = sliced.filter((p) => p.date <= toDate.slice(0, 10))
  const byDate = new Map<string, number>()
  for (const p of sliced) byDate.set(p.date.slice(0, 10), p.nav)
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, nav]) => ({ date, nav }))
}

function nativeReturns(points: FofNavPoint[]): number[] {
  const rets: number[] = []
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].nav
    const curr = points[i].nav
    if (prev > 0 && Number.isFinite(curr)) rets.push(curr / prev - 1)
  }
  return rets
}

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length
}

function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1))
}

function sampleCov(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length)
  if (n < 2) return 0
  const mx = mean(x.slice(0, n))
  const my = mean(y.slice(0, n))
  let s = 0
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my)
  return s / (n - 1)
}

function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length)
  if (n < 3) return null
  const sx = sampleStd(x.slice(0, n))
  const sy = sampleStd(y.slice(0, n))
  if (sx < 1e-12 || sy < 1e-12) return null
  return sampleCov(x, y) / (sx * sy)
}

function quantile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = (sortedAsc.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] * (hi - idx) + sortedAsc[hi] * (idx - lo)
}

function periodsPerYear(medianGapDays: number): { ppy: number; freqLabel: string } {
  if (medianGapDays <= 2) return { ppy: 252, freqLabel: "日度" }
  if (medianGapDays <= 10) return { ppy: 52, freqLabel: "周度" }
  if (medianGapDays <= 20) return { ppy: 26, freqLabel: "双周" }
  if (medianGapDays <= 45) return { ppy: 12, freqLabel: "月度" }
  return { ppy: 4, freqLabel: "季度" }
}

function medianGap(dates: string[]): number {
  if (dates.length < 2) return 7
  const gaps: number[] = []
  for (let i = 1; i < dates.length; i++) {
    const a = new Date(`${dates[i - 1]}T12:00:00`).getTime()
    const b = new Date(`${dates[i]}T12:00:00`).getTime()
    const days = (b - a) / 86400000
    if (days > 0) gaps.push(days)
  }
  if (!gaps.length) return 7
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

type PreparedFund = {
  key: string
  holding: FofVarHolding
  name: string
  points: FofNavPoint[]
  nativeAnnVol: number | null
  actualDates: Set<string>
  fill?: FofVarFill | null
  fillNote?: string | null
}

export function gapReasonLabel(reason: FofNavGapReason): string {
  if (reason === "no_nav") return "无净值序列"
  if (reason === "too_short") return "净值点过少"
  if (reason === "flat_window") return "共同窗口内净值几乎不变，无法估计相关"
  return "起始过晚，未进入共同窗口"
}

function hashUnit(seed: string, t: number): number {
  let h = 2166136261
  const text = `${seed}:${t}`
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000
}

function gaussianNoise(seed: string, t: number): number {
  const u = Math.max(1e-6, hashUnit(seed, t))
  const v = Math.max(1e-6, hashUnit(seed, t + 997))
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function firstDate(fund: PreparedFund): string {
  return fund.points[0]?.date ?? ""
}

function lastDate(fund: PreparedFund): string {
  return fund.points[fund.points.length - 1]?.date ?? ""
}

/** Keep funds whose histories overlap long enough to cover most of current MV. */
function selectAnalysisUniverse(funds: PreparedFund[]): PreparedFund[] {
  if (funds.length <= 1) return funds
  const totalMv = funds.reduce((s, f) => s + Math.max(f.holding.marketValue, 0), 0)
  const last = funds.reduce((m, f) => (lastDate(f) > m ? lastDate(f) : m), "")
  const starts = [...new Set(funds.map(firstDate).filter(Boolean))].sort()

  let best = funds
  let bestScore = -1
  for (const start of starts) {
    const included = funds.filter((f) => firstDate(f) <= start && lastDate(f) >= start)
    const mv = included.reduce((s, f) => s + Math.max(f.holding.marketValue, 0), 0)
    if (included.length < 1 || mv < totalMv * 0.7) continue
    const days = Math.max(
      1,
      (new Date(`${last}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86400000,
    )
    const score = days * mv
    if (score > bestScore) {
      best = included
      bestScore = score
    }
  }
  return best
}

type AlignPeriod = "week" | "month"

function isoWeekStart(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00`)
  const dow = d.getDay()
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow))
  return d.toISOString().slice(0, 10)
}

function monthEnd(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number)
  const d = new Date(Date.UTC(year, month, 0))
  return d.toISOString().slice(0, 10)
}

function lastNavByWeek(points: FofNavPoint[]): FofNavPoint[] {
  const byWeek = new Map<string, number>()
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    byWeek.set(isoWeekStart(p.date), p.nav)
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, nav]) => ({ date, nav }))
}

function lastNavByMonth(points: FofNavPoint[]): FofNavPoint[] {
  const byMonth = new Map<string, number>()
  for (const p of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    byMonth.set(p.date.slice(0, 7), p.nav)
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, nav]) => ({ date: monthEnd(month), nav }))
}

function bucketPoints(points: FofNavPoint[], period: AlignPeriod): FofNavPoint[] {
  return period === "month" ? lastNavByMonth(points) : lastNavByWeek(points)
}

function preferredAlignPeriods(funds: PreparedFund[]): AlignPeriod[] {
  const gaps = funds.map((f) => medianGap(f.points.map((p) => p.date))).sort((a, b) => a - b)
  const med = gaps[Math.floor(gaps.length / 2)] ?? 7
  return med > 10 ? ["month", "week"] : ["week", "month"]
}

function alignReturnsOn(
  funds: PreparedFund[],
  period: AlignPeriod,
): { dates: string[]; returns: number[][] } | null {
  const bucketed = funds.map((f) => {
    const points = bucketPoints(f.points, period)
    return { ...f, points, actualDates: new Set(points.map((p) => p.date)) }
  })
  const dateSet = new Set<string>()
  for (const f of bucketed) {
    for (const p of f.points) dateSet.add(p.date)
  }
  const allDates = [...dateSet].sort()
  if (allDates.length < 3) return null

  const actualCount = allDates.map((d) => bucketed.filter((f) => f.actualDates.has(d)).length)
  const minCover = Math.max(1, Math.ceil(bucketed.length * COVERAGE))
  const grid = allDates.filter((_, i) => actualCount[i] >= minCover)
  if (grid.length < 3) return null

  const navs = bucketed.map((f) => {
    const byDate = new Map(f.points.map((p) => [p.date, p.nav]))
    let last: number | null = null
    return grid.map((d) => {
      const v = byDate.get(d)
      if (v != null) last = v
      return last
    })
  })

  let start = 0
  while (start < grid.length && navs.some((row) => row[start] == null)) start += 1
  if (grid.length - start < 3) return null

  const dates: string[] = []
  const returns: number[][] = funds.map(() => [])
  for (let t = start + 1; t < grid.length; t++) {
    const periodRets: number[] = []
    let ok = true
    for (let i = 0; i < funds.length; i++) {
      const prev = navs[i][t - 1]
      const curr = navs[i][t]
      if (prev == null || curr == null || prev <= 0) {
        ok = false
        break
      }
      periodRets.push(curr / prev - 1)
    }
    if (!ok) continue
    dates.push(grid[t])
    for (let i = 0; i < funds.length; i++) returns[i].push(periodRets[i])
  }

  if (dates.length < MIN_RETURNS) return null
  return { dates, returns }
}

function alignReturns(funds: PreparedFund[]): { dates: string[]; returns: number[][] } | null {
  if (funds.length === 0) return null
  for (const period of preferredAlignPeriods(funds)) {
    const hit = alignReturnsOn(funds, period)
    if (hit) return hit
  }
  return null
}

function selectAlignableUniverse(funds: PreparedFund[]): PreparedFund[] {
  const core = selectAnalysisUniverse(funds)
  if (funds.length === 0) return core
  if (alignReturns(core)) return core

  const ranked = [...core].sort((a, b) => {
    const byStart = firstDate(a).localeCompare(firstDate(b))
    if (byStart !== 0) return byStart
    return b.points.length - a.points.length
  })
  for (let keep = ranked.length - 1; keep >= 1; keep--) {
    const subset = ranked.slice(0, keep)
    if (alignReturns(subset)) return subset
  }
  return core
}

function suggestProxies(
  gap: { key: string; strategy: string | null },
  candidates: Array<{ key: string; name: string; strategy: string | null; marketValue: number }>,
): FofProxyOption[] {
  const head = strategyHead(gap.strategy)
  return [...candidates]
    .filter((c) => c.key !== gap.key)
    .sort((a, b) => {
      const aSame = head && strategyHead(a.strategy) === head ? 1 : 0
      const bSame = head && strategyHead(b.strategy) === head ? 1 : 0
      if (aSame !== bSame) return bSame - aSame
      return b.marketValue - a.marketValue
    })
    .slice(0, 8)
    .map((c) => ({ key: c.key, name: c.name, strategy: c.strategy }))
}

function seriesMatchesProxyKey(series: FofVarSeries, proxyKey: string): boolean {
  const key = proxyKey.trim().toUpperCase()
  if (!key) return false
  if ((series.beianHao?.trim() || "").toUpperCase() === key) return true
  if ((series.valuationCode?.trim() || "").toUpperCase() === key) return true
  if (fofHoldingKey({
    fundName: series.fundName,
    beianHao: series.beianHao,
    valuationCode: series.valuationCode,
  }) === key) return true
  return nameKeys(series.fundName).some((k) => k.toUpperCase() === key)
    || nameKeys(series.displayName).some((k) => k.toUpperCase() === key)
}

function resolveProxySource(
  proxyKey: string,
  classified: Array<{
    key: string
    name: string
    points: FofNavPoint[]
    nativeAnnVol: number | null
    ready: boolean
  }>,
  extraSeries: FofVarSeries[],
  fromDate?: string,
  toDate?: string,
): { name: string; points: FofNavPoint[]; nativeAnnVol: number | null } | null {
  const fromHolding = classified.find((c) => c.key === proxyKey && c.ready)
  if (fromHolding) {
    return {
      name: fromHolding.name,
      points: fromHolding.points,
      nativeAnnVol: fromHolding.nativeAnnVol,
    }
  }

  const extra = extraSeries.find((s) => seriesMatchesProxyKey(s, proxyKey))
  if (!extra) return null
  const points = slicePoints(extra.points, fromDate, toDate)
  const rets = nativeReturns(points)
  if (rets.length < MIN_RETURNS || points.length < MIN_RETURNS + 1) return null
  const gap = medianGap(points.map((p) => p.date))
  const { ppy } = periodsPerYear(gap)
  const nativeAnnVol = rets.length >= 2 ? sampleStd(rets) * Math.sqrt(ppy) : null
  return {
    name: extra.displayName || normalizeFofDisplayName(extra.fundName),
    points,
    nativeAnnVol,
  }
}

function synthesizeReturns(
  length: number,
  annVol: number,
  ppy: number,
  corr: number,
  portRets: number[],
  seed: string,
): number[] {
  const sigma = Math.max(0, annVol) / Math.sqrt(Math.max(ppy, 1))
  const portVol = sampleStd(portRets)
  const rho = Math.max(-0.95, Math.min(0.95, corr))
  const idio = Math.sqrt(Math.max(0, 1 - rho * rho))
  return Array.from({ length }, (_, t) => {
    const zPort = portVol > 1e-12 ? portRets[t] / portVol : 0
    return sigma * (rho * zPort + idio * gaussianNoise(seed, t))
  })
}

function emptyResult(
  input: {
    method: FofVarMethod
    confidence: FofVarConfidence
    zScore: number
    fromDate?: string
    toDate?: string
  },
  totalMv: number,
  insufficient: FofVarFundRow[],
  gaps: FofNavGap[],
): FofPortfolioVarResult {
  return {
    method: input.method,
    confidence: input.confidence,
    zScore: input.zScore,
    obsCount: 0,
    dateFrom: input.fromDate?.slice(0, 10) ?? null,
    dateTo: input.toDate?.slice(0, 10) ?? null,
    medianGapDays: 7,
    periodsPerYear: 52,
    freqLabel: "周度",
    includedCount: 0,
    excludedCount: insufficient.length,
    coveredMv: 0,
    totalMv,
    portfolioAnnVolPct: 0,
    diversificationRatio: null,
    nextPeriodVar: 0,
    oneDayVar: 0,
    nextPeriodVarPct: 0,
    oneDayVarPct: 0,
    funds: insufficient,
    gaps,
    alignedDates: [],
    portPeriodReturns: [],
    fundReturns: [],
    corrMatrix: [],
  }
}

export function computeFofPortfolioVar(input: {
  holdings: FofVarHolding[]
  series: FofVarSeries[]
  fromDate?: string
  toDate?: string
  confidence?: FofVarConfidence
  method?: FofVarMethod
  overrides?: Record<string, FofGapAction>
  proxySeries?: FofVarSeries[]
}): FofPortfolioVarResult | null {
  const confidence = input.confidence ?? 95
  const method = input.method ?? "parametric"
  const zScore = Z_SCORE[confidence]
  const overrides = input.overrides ?? {}
  const proxySeries = input.proxySeries ?? []
  const totalMv = input.holdings.reduce((s, h) => s + Math.max(h.marketValue, 0), 0)
  if (totalMv <= 0 || input.holdings.length === 0) return null

  type Classified = {
    key: string
    holding: FofVarHolding
    name: string
    points: FofNavPoint[]
    nativeAnnVol: number | null
    obsCount: number
    ready: boolean
  }

  const classified: Classified[] = input.holdings.map((holding) => {
    const key = fofHoldingKey(holding)
    const matched = matchHoldingSeries(holding, input.series)
    const points = slicePoints(matched?.points ?? [], input.fromDate, input.toDate)
    const rets = nativeReturns(points)
    const gap = medianGap(points.map((p) => p.date))
    const { ppy } = periodsPerYear(gap)
    const nativeAnnVol = rets.length >= 2 ? sampleStd(rets) * Math.sqrt(ppy) : null
    const name = normalizeFofDisplayName(
      stripValuationSubjectPathPrefix(holding.fundName) || holding.fundName,
    )
    return {
      key,
      holding,
      name,
      points,
      nativeAnnVol,
      obsCount: rets.length,
      ready: rets.length >= MIN_RETURNS && points.length >= MIN_RETURNS + 1,
    }
  })

  const readyCandidates = classified
    .filter((c) => c.ready)
    .map((c) => ({
      key: c.key,
      name: c.name,
      strategy: c.holding.fundStrategy,
      marketValue: c.holding.marketValue,
    }))

  const prepared: PreparedFund[] = []
  const pending: Classified[] = []

  for (const item of classified) {
    const action = overrides[item.key]
    if (item.ready && action?.kind !== "ignore") {
      prepared.push({
        key: item.key,
        holding: item.holding,
        name: item.name,
        points: item.points,
        nativeAnnVol: item.nativeAnnVol,
        actualDates: new Set(item.points.map((p) => p.date)),
      })
      continue
    }
    pending.push(item)
  }

  const universeCore = selectAlignableUniverse(prepared)
  const lateDropped = prepared.filter((f) => !universeCore.includes(f))
  let universe = [...universeCore]

  const gaps: FofNavGap[] = []
  const insufficient: FofVarFundRow[] = []

  function pushGap(item: Classified, reason: FofNavGapReason) {
    gaps.push({
      key: item.key,
      name: item.name,
      strategy: item.holding.fundStrategy,
      marketValue: item.holding.marketValue,
      marketPct: item.holding.marketPct,
      obsCount: item.obsCount,
      reason,
      suggestedProxies: suggestProxies(
        { key: item.key, strategy: item.holding.fundStrategy },
        readyCandidates,
      ),
    })
  }

  function insufficientRow(item: Classified, extra?: Partial<FofVarFundRow>): FofVarFundRow {
    return {
      key: item.key,
      name: item.name,
      strategy: item.holding.fundStrategy,
      marketValue: item.holding.marketValue,
      marketPct: item.holding.marketPct,
      weightPct: 0,
      annVolPct: item.nativeAnnVol != null ? item.nativeAnnVol * 100 : null,
      corrToPort: null,
      riskContribPct: null,
      varContrib: null,
      overContribPct: null,
      obsCount: item.obsCount,
      status: "insufficient",
      fill: extra?.fill ?? null,
      fillNote: extra?.fillNote ?? null,
    }
  }

  function applyProxy(item: Classified, proxyKey: string): boolean {
    const proxy = resolveProxySource(proxyKey, classified, proxySeries, input.fromDate, input.toDate)
    if (!proxy) return false
    universe.push({
      key: item.key,
      holding: item.holding,
      name: item.name,
      points: proxy.points,
      nativeAnnVol: proxy.nativeAnnVol,
      actualDates: new Set(proxy.points.map((p) => p.date)),
      fill: "proxy",
      fillNote: `代理 ${proxy.name}`,
    })
    return true
  }

  for (const item of pending) {
    const action = overrides[item.key] ?? { kind: "ignore" }
    if (action.kind === "proxy" && applyProxy(item, action.proxyKey)) {
      continue
    }
    if (action.kind === "assume") {
      continue
    }
    pushGap(item, item.obsCount <= 0 ? "no_nav" : "too_short")
    insufficient.push(insufficientRow(item))
  }

  for (const f of lateDropped) {
    const item = classified.find((c) => c.key === f.key)
    if (!item) continue
    const action = overrides[item.key] ?? { kind: "ignore" }
    if (action.kind === "proxy" && applyProxy(item, action.proxyKey)) {
      continue
    }
    if (action.kind === "assume") continue
    pushGap(item, "late_start")
    insufficient.push(insufficientRow(item))
  }

  const assumeItems = classified.filter((item) => overrides[item.key]?.kind === "assume")
    .filter((item) => !universe.some((u) => u.key === item.key))

  let aligned = universe.length > 0 ? alignReturns(universe) : null
  if (aligned && universe.length > 0) {
    const liveIdx: number[] = []
    const flatIdx: number[] = []
    aligned.returns.forEach((rets, i) => {
      if (sampleStd(rets) > 1e-8) liveIdx.push(i)
      else flatIdx.push(i)
    })
    for (const i of flatIdx) {
      const item = classified.find((c) => c.key === universe[i].key)
      if (!item) continue
      if (overrides[item.key]?.kind === "assume") continue
      pushGap(item, "flat_window")
      insufficient.push(insufficientRow(item))
    }
    if (flatIdx.length > 0 && liveIdx.length > 0) {
      universe = liveIdx.map((i) => universe[i])
      aligned = alignReturns(universe)
    } else if (liveIdx.length === 0) {
      aligned = null
    }
  }
  if ((!aligned || universe.length === 0) && assumeItems.length > 0 && classified.some((c) => c.ready)) {
    const fallback = classified.filter((c) => c.ready).slice(0, 3).map((c) => ({
      key: c.key,
      holding: c.holding,
      name: c.name,
      points: c.points,
      nativeAnnVol: c.nativeAnnVol,
      actualDates: new Set(c.points.map((p) => p.date)),
    }))
    universe = fallback
    aligned = alignReturns(fallback)
  }

  if (!aligned || universe.length === 0) {
    for (const item of assumeItems) {
      pushGap(item, item.obsCount <= 0 ? "no_nav" : "too_short")
      insufficient.push(insufficientRow(item))
    }
    if (insufficient.length === 0 && gaps.length === 0) return null
    return emptyResult({ method, confidence, zScore, fromDate: input.fromDate, toDate: input.toDate }, totalMv, insufficient, gaps)
  }

  let { dates, returns } = aligned
  const gapDays = medianGap(dates)
  const { ppy, freqLabel } = periodsPerYear(gapDays)
  const coreN = universe.length
  const coreMv = universe.reduce((s, f) => s + Math.max(f.holding.marketValue, 0), 0)
  const coreW = universe.map((f) => f.holding.marketValue / Math.max(coreMv, 1e-9))
  const corePortRets = dates.map((_, t) => {
    let r = 0
    for (let i = 0; i < coreN; i++) r += coreW[i] * returns[i][t]
    return r
  })

  for (const item of assumeItems) {
    const action = overrides[item.key]
    if (action?.kind !== "assume") continue
    const synth = synthesizeReturns(
      dates.length,
      action.annVolPct / 100,
      ppy,
      action.corr,
      corePortRets,
      item.key,
    )
    universe.push({
      key: item.key,
      holding: item.holding,
      name: item.name,
      points: item.points,
      nativeAnnVol: action.annVolPct / 100,
      actualDates: new Set(dates),
      fill: "assume",
      fillNote: `假设波动 ${action.annVolPct.toFixed(1)}%`,
    })
    returns = [...returns, synth]
  }

  const n = universe.length
  const tCount = dates.length
  const coveredMv = universe.reduce((s, f) => s + Math.max(f.holding.marketValue, 0), 0)
  const weights = universe.map((f) => f.holding.marketValue / coveredMv)

  const cov: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => sampleCov(returns[i], returns[j])),
  )

  let portVar = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      portVar += weights[i] * weights[j] * cov[i][j]
    }
  }
  const portVol = portVar > 0 ? Math.sqrt(portVar) : 0

  const portRets = Array.from({ length: tCount }, (_, t) => {
    let r = 0
    for (let i = 0; i < n; i++) r += weights[i] * returns[i][t]
    return r
  })

  const sigmaW = universe.map((_, i) => {
    let s = 0
    for (let j = 0; j < n; j++) s += cov[i][j] * weights[j]
    return s
  })

  const parametricNext = zScore * portVol * coveredMv
  const sorted = [...portRets].sort((a, b) => a - b)
  const histQ = quantile(sorted, 1 - confidence / 100)
  const historicalNext = Math.max(0, -histQ) * coveredMv
  const nextPeriodVar = method === "historical" ? historicalNext : parametricNext
  const scale = gapDays > 0 ? 1 / Math.sqrt(gapDays) : 1
  const oneDayVar = nextPeriodVar * scale

  const standaloneVols = universe.map((f, i) => {
    const alignedStd = sampleStd(returns[i])
    return alignedStd > 0 ? alignedStd : (f.nativeAnnVol != null ? f.nativeAnnVol / Math.sqrt(ppy) : 0)
  })
  const weightedStandVol = weights.reduce((s, w, i) => s + w * standaloneVols[i], 0)
  const diversificationRatio = portVol > 1e-12 ? weightedStandVol / portVol : null

  const corrMatrix: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => {
      const rho = pearson(returns[i], returns[j])
      return rho != null && Number.isFinite(rho) ? rho : (i === j ? 1 : 0)
    }),
  )

  const fundReturns = universe.map((f, i) => ({
    key: f.key,
    name: f.name,
    strategy: f.holding.fundStrategy,
    weightPct: weights[i] * 100,
    returns: returns[i],
  }))

  const okRows: FofVarFundRow[] = universe.map((f, i) => {
    const riskContribPct = portVar > 1e-16
      ? (weights[i] * sigmaW[i] / portVar) * 100
      : (n === 1 ? 100 : 0)
    const weightPct = weights[i] * 100
    return {
      key: f.key,
      name: f.name,
      strategy: f.holding.fundStrategy,
      marketValue: f.holding.marketValue,
      marketPct: f.holding.marketPct,
      weightPct,
      annVolPct: f.nativeAnnVol != null ? f.nativeAnnVol * 100 : standaloneVols[i] * Math.sqrt(ppy) * 100,
      corrToPort: pearson(returns[i], portRets),
      riskContribPct,
      varContrib: nextPeriodVar * (riskContribPct / 100),
      overContribPct: riskContribPct - weightPct,
      obsCount: tCount,
      status: "ok",
      fill: f.fill ?? null,
      fillNote: f.fillNote ?? null,
    }
  })

  const funds = [...okRows, ...insufficient].sort((a, b) => {
    if (a.status !== b.status) return a.status === "ok" ? -1 : 1
    return (b.riskContribPct ?? -1) - (a.riskContribPct ?? -1)
  })

  return {
    method,
    confidence,
    zScore,
    obsCount: tCount,
    dateFrom: dates[0] ?? null,
    dateTo: dates[dates.length - 1] ?? null,
    medianGapDays: +gapDays.toFixed(1),
    periodsPerYear: ppy,
    freqLabel,
    includedCount: n,
    excludedCount: insufficient.length,
    coveredMv,
    totalMv,
    portfolioAnnVolPct: portVol * Math.sqrt(ppy) * 100,
    diversificationRatio,
    nextPeriodVar,
    oneDayVar,
    nextPeriodVarPct: coveredMv > 0 ? (nextPeriodVar / coveredMv) * 100 : 0,
    oneDayVarPct: coveredMv > 0 ? (oneDayVar / coveredMv) * 100 : 0,
    funds,
    gaps,
    alignedDates: dates,
    portPeriodReturns: portRets,
    fundReturns,
    corrMatrix,
  }
}
