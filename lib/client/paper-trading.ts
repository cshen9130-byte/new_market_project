import {
  assetFromContract,
  brokerMarginMultiplier,
  isSleeveKey,
  loadStrategySnapshot,
  marginRateForContract,
  multiplierForContract,
  sleeveFromContract,
  specForAsset,
  SLEEVE_KEYS,
  type SleeveKey,
} from "@/lib/all-weather/universe"
import type { CtpCandle, CtpTick, IndexProduct } from "@/lib/client/ctp-market"
import { isLiveSessionFor, quoteOf, validMark, weekdayClosedLast } from "@/lib/client/market-hours"
import { productOfSymbol } from "@/lib/client/pro-trading"
import {
  aggregateCloseSeries,
  formatCandleTime,
  isIntradayTimeframe,
  shanghaiWallUnix,
  type TimeframeId,
} from "@/lib/client/timeframes"

export const PAPER_STORAGE_KEY = "ma_index_paper_trading_v1"
export const ALL_WEATHER_PORTFOLIO_ID = "all-weather"
export const ALL_WEATHER_STRATEGY_ID = "stg-all-weather"
export const DEFAULT_PAPER_CAPITAL = 10_000_000

export type PaperSide = "long" | "short"
export type PaperEntryMode = "market" | "breakout" | "ma_cross"
export type PaperStrategyStatus = "armed" | "filled" | "stopped" | "disabled"
export type PaperPositionStatus = "open" | "closed"
export type PaperAccountKind = "manual" | "strategy" | "all-weather"
export type PaperScope = "team" | "mine"

export type PaperPortfolio = {
  id: string
  name: string
  createdAt: number
  kind?: PaperAccountKind
  /** Starting capital in yuan. NAV = initialCapital + realized + unrealized. */
  initialCapital?: number
  /** team = shared for every login; mine = this user only, synced across their computers. */
  scope?: PaperScope
}

export type PaperProduct = {
  id: string
  portfolioId: string
  symbol: string
  label?: string
  sleeve?: string
}

export type PaperPosition = {
  id: string
  portfolioId: string
  productId: string
  strategyId?: string
  symbol: string
  side: PaperSide
  lots: number
  entryPrice: number
  entryTime: number
  exitPrice?: number
  exitTime?: number
  status: PaperPositionStatus
  closeReason?: string
  multiplier?: number
  sleeve?: string
  label?: string
  source?: "manual" | "strategy" | "all-weather"
}

export type PaperStrategy = {
  id: string
  portfolioId: string
  productId?: string
  name: string
  symbol: string
  side: PaperSide
  lots: number
  entryMode: PaperEntryMode
  entryLevel?: number
  entryCompare?: "above" | "below"
  maFast: number
  maSlow: number
  stopLossPts?: number | null
  takeProfitPts?: number | null
  status: PaperStrategyStatus
  createdAt: number
  filledAt?: number
  positionId?: string
  lastNote?: string
}

export type PaperState = {
  portfolios: PaperPortfolio[]
  products: PaperProduct[]
  positions: PaperPosition[]
  strategies: PaperStrategy[]
}

export type PaperStrategyDraft = {
  portfolioId: string
  name: string
  symbol: string
  side: PaperSide
  lots: number
  entryMode: PaperEntryMode
  entryLevel?: number
  entryCompare?: "above" | "below"
  maFast?: number
  maSlow?: number
  stopLossPts?: number | null
  takeProfitPts?: number | null
}

export type AllWeatherHolding = {
  contract: string
  asset: string
  label: string
  sleeve: string
  lots: number
  price: number
  prevPrice: number
  multiplier: number
  openedAt?: number
  dailyPnl?: number
  cumPnl?: number
}

const MULTIPLIER: Record<IndexProduct, number> = {
  IH: 300,
  IF: 300,
  IC: 200,
  IM: 200,
}

export function nid(prefix = "") {
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function accountKind(portfolio: PaperPortfolio | null | undefined): PaperAccountKind {
  if (!portfolio) return "manual"
  if (portfolio.id === ALL_WEATHER_PORTFOLIO_ID || portfolio.kind === "all-weather") return "all-weather"
  return portfolio.kind === "strategy" ? "strategy" : "manual"
}

export function portfolioScope(portfolio: PaperPortfolio | null | undefined): PaperScope {
  if (!portfolio) return "mine"
  if (portfolio.id === ALL_WEATHER_PORTFOLIO_ID || portfolio.kind === "all-weather") return "team"
  return portfolio.scope === "team" ? "team" : "mine"
}

function filterStateByPortfolioIds(state: PaperState, ids: Set<string>): PaperState {
  return {
    portfolios: state.portfolios.filter((p) => ids.has(p.id)),
    products: state.products.filter((p) => ids.has(p.portfolioId)),
    positions: state.positions.filter((p) => ids.has(p.portfolioId)),
    strategies: state.strategies.filter((s) => ids.has(s.portfolioId)),
  }
}

export function splitPaperState(state: PaperState): { team: PaperState; mine: PaperState } {
  const teamIds = new Set(
    state.portfolios.filter((p) => portfolioScope(p) === "team" && p.id !== ALL_WEATHER_PORTFOLIO_ID).map((p) => p.id),
  )
  const mineIds = new Set(state.portfolios.filter((p) => portfolioScope(p) === "mine").map((p) => p.id))
  return {
    team: filterStateByPortfolioIds(state, teamIds),
    mine: filterStateByPortfolioIds(state, mineIds),
  }
}

export function mergePaperStates(team: PaperState, mine: PaperState): PaperState {
  const mineIds = new Set(mine.portfolios.map((p) => p.id))
  const teamPortfolios = team.portfolios.filter(
    (p) => p.id !== ALL_WEATHER_PORTFOLIO_ID && portfolioScope(p) === "team" && !mineIds.has(p.id),
  )
  return {
    portfolios: [...teamPortfolios, ...mine.portfolios.filter((p) => p.id !== ALL_WEATHER_PORTFOLIO_ID)],
    products: [
      ...team.products.filter((p) => p.portfolioId !== ALL_WEATHER_PORTFOLIO_ID && !mineIds.has(p.portfolioId)),
      ...mine.products.filter((p) => p.portfolioId !== ALL_WEATHER_PORTFOLIO_ID),
    ],
    positions: [
      ...team.positions.filter((p) => p.portfolioId !== ALL_WEATHER_PORTFOLIO_ID && !mineIds.has(p.portfolioId)),
      ...mine.positions.filter((p) => p.portfolioId !== ALL_WEATHER_PORTFOLIO_ID),
    ],
    strategies: [
      ...team.strategies.filter((s) => s.portfolioId !== ALL_WEATHER_PORTFOLIO_ID && !mineIds.has(s.portfolioId)),
      ...mine.strategies.filter((s) => s.portfolioId !== ALL_WEATHER_PORTFOLIO_ID),
    ],
  }
}

export function unionPaperSlice(base: PaperState, extra: PaperState): PaperState {
  const ids = new Set(base.portfolios.map((p) => p.id))
  const extraPfs = extra.portfolios.filter((p) => !ids.has(p.id) && p.id !== ALL_WEATHER_PORTFOLIO_ID)
  if (!extraPfs.length) return base
  const extraIds = new Set(extraPfs.map((p) => p.id))
  return {
    portfolios: [...base.portfolios, ...extraPfs],
    products: [...base.products, ...extra.products.filter((p) => extraIds.has(p.portfolioId))],
    positions: [...base.positions, ...extra.positions.filter((p) => extraIds.has(p.portfolioId))],
    strategies: [...base.strategies, ...extra.strategies.filter((s) => extraIds.has(s.portfolioId))],
  }
}

export function ensureAllWeatherPortfolio(state: PaperState, now = Date.now()): PaperState {
  const existing = state.portfolios.find((p) => p.id === ALL_WEATHER_PORTFOLIO_ID)
  const aw: PaperPortfolio = {
    id: ALL_WEATHER_PORTFOLIO_ID,
    name: "全天候策略",
    kind: "all-weather",
    scope: "team",
    createdAt: existing?.createdAt || now,
    initialCapital: existing?.initialCapital || DEFAULT_PAPER_CAPITAL,
  }
  if (!existing) {
    return { ...state, portfolios: [aw, ...state.portfolios] }
  }
  return {
    ...state,
    portfolios: state.portfolios.map((p) => (p.id === ALL_WEATHER_PORTFOLIO_ID ? { ...p, ...aw } : p)),
  }
}

export function paperSliceHasUserData(state: PaperState) {
  return (
    state.portfolios.some((p) => p.id !== "default" && p.id !== ALL_WEATHER_PORTFOLIO_ID) ||
    state.products.length > 0 ||
    state.positions.length > 0 ||
    state.strategies.some((s) => s.id !== ALL_WEATHER_STRATEGY_ID)
  )
}

export function attachAllWeatherSlice(target: PaperState, source: PaperState): PaperState {
  const hydrated = hydratePaperState(target)
  return {
    portfolios: hydrated.portfolios,
    products: [
      ...source.products.filter((p) => p.portfolioId === ALL_WEATHER_PORTFOLIO_ID),
      ...hydrated.products.filter((p) => p.portfolioId !== ALL_WEATHER_PORTFOLIO_ID),
    ],
    positions: [
      ...source.positions.filter((p) => p.portfolioId === ALL_WEATHER_PORTFOLIO_ID),
      ...hydrated.positions.filter((p) => p.portfolioId !== ALL_WEATHER_PORTFOLIO_ID),
    ],
    strategies: [
      ...source.strategies.filter((s) => s.portfolioId === ALL_WEATHER_PORTFOLIO_ID),
      ...hydrated.strategies.filter((s) => s.portfolioId !== ALL_WEATHER_PORTFOLIO_ID),
    ],
  }
}

export function accountKindLabel(kind: PaperAccountKind) {
  if (kind === "all-weather") return "自动"
  if (kind === "strategy") return "策略"
  return "手动"
}

export function isAllWeatherAccount(portfolioId: string | null | undefined) {
  return portfolioId === ALL_WEATHER_PORTFOLIO_ID
}

export function allWeatherHoldingsKey(rows: Array<{ contract?: string; symbol?: string; lots: number }>) {
  return rows
    .filter((row) => row.lots > 0)
    .map((row) => `${String(row.contract || row.symbol || "").toUpperCase()}:${row.lots}`)
    .sort()
    .join("|")
}

export function parsePaperCapital(raw: string, fallback = DEFAULT_PAPER_CAPITAL): number | null {
  const n = Number(String(raw).replace(/[,，\s]/g, ""))
  if (Number.isFinite(n) && n > 0) return n
  if (!String(raw).trim()) return fallback
  return null
}

export function paperNav(initialCapital: number, realized: number, unrealized: number) {
  return initialCapital + realized + unrealized
}

export function paperReturn(initialCapital: number, realized: number, unrealized: number) {
  if (!(initialCapital > 0)) return null
  return (realized + unrealized) / initialCapital
}

export { allWeatherLiveNav } from "@/lib/client/all-weather-nav"

export function fmtNav(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "--"
  return `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`
}

export type PaperNavPoint = { date: string; nav: number }

function beijingYmd(ms = Date.now()) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })
}

function pad2(n: number) {
  return String(n).padStart(2, "0")
}

function ymdToUnix(ymd: string) {
  const [y, m, d] = String(ymd || "").split("-").map(Number)
  if (!y || !m || !d) return null
  return Math.floor(Date.UTC(y, m - 1, d) / 1000)
}

function unixWallYmd(unix: number) {
  const d = new Date(unix * 1000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

function msToWallUnix(ms: number) {
  return shanghaiWallUnix(new Date(ms))
}

function navAxisLabel(unix: number, id: TimeframeId) {
  const d = new Date(unix * 1000)
  if (id === "1M") return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`
  if (id === "1d" || id === "1w") return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  return formatCandleTime(unix, id)
}

function toNavPoints(series: Array<{ time: number; close: number }>, interval: TimeframeId): PaperNavPoint[] {
  return series.map((row) => ({ date: navAxisLabel(row.time, interval), nav: row.close }))
}

function resampleNav(
  series: Array<{ time: number; close: number }>,
  interval: TimeframeId,
): Array<{ time: number; close: number }> {
  if (!series.length || interval === "1d" || isIntradayTimeframe(interval)) return series
  const aggregated = aggregateCloseSeries(series, interval)
  if (aggregated.length === 1 && series.length > 1) return [series[0], aggregated[0]]
  return aggregated
}

function lastCloseAtOrBefore(bars: Array<{ time: number; close: number }>, t: number) {
  let lo = 0
  let hi = bars.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid].time <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans >= 0 ? bars[ans].close : null
}

function firstBarOn(bars: Array<{ time: number; close: number; open?: number }>, ymd: string) {
  return bars.find((bar) => unixWallYmd(bar.time) === ymd) ?? null
}

function equityBefore(daily: Array<{ date: string; equity: number }>, ymd: string, fallback: number) {
  let best: number | null = null
  for (const row of daily) {
    if (row.date < ymd) best = row.equity
  }
  return best ?? fallback
}

function dailyNavSeries(opts: {
  initialCapital: number
  liveNav: number
  startedAt?: number
  daily: Array<{ date: string; equity: number }>
}): Array<{ time: number; close: number }> {
  const today = beijingYmd()
  const series: Array<{ time: number; close: number }> = []
  for (const row of opts.daily) {
    const time = ymdToUnix(row.date)
    if (time == null) continue
    series.push({ time, close: row.date === today ? opts.liveNav : row.equity })
  }
  const last = opts.daily[opts.daily.length - 1]
  if (last && last.date !== today) {
    const time = ymdToUnix(today)
    if (time != null) series.push({ time, close: opts.liveNav })
  }
  if (series.length === 1) {
    const startMs = opts.startedAt && opts.startedAt > 0 ? opts.startedAt : Date.now()
    series.unshift({ time: msToWallUnix(startMs), close: opts.initialCapital })
  }
  return series
}

function eventNavSeries(opts: {
  initialCapital: number
  liveNav: number
  startedAt?: number
  positions?: PaperPosition[]
}): Array<{ time: number; close: number }> {
  const closes = (opts.positions || [])
    .filter((p) => p.status === "closed" && p.exitTime)
    .map((p) => ({ t: p.exitTime!, pnl: positionPnl(p, p.exitPrice ?? null) ?? 0 }))
    .sort((a, b) => a.t - b.t)
  const start = opts.startedAt && opts.startedAt > 0 ? opts.startedAt : closes[0]?.t || Date.now()
  const series: Array<{ time: number; close: number }> = [{ time: msToWallUnix(start), close: opts.initialCapital }]
  let nav = opts.initialCapital
  for (const close of closes) {
    nav += close.pnl
    series.push({ time: msToWallUnix(close.t), close: nav })
  }
  series.push({ time: msToWallUnix(Date.now()), close: opts.liveNav })
  return series
}

function intradayNavSeries(opts: {
  initialCapital: number
  liveNav: number
  positions: PaperPosition[]
  daily?: Array<{ date: string; equity: number }>
  marksBySymbol: Record<string, Array<{ time: number; close: number; open?: number }>>
  prevMarks?: Record<string, number>
  bookEquity?: number
  bookDailyPnl?: number
}): Array<{ time: number; close: number }> | null {
  const times = new Set<number>()
  const barsOf = new Map<string, Array<{ time: number; close: number }>>()
  for (const [symbol, bars] of Object.entries(opts.marksBySymbol)) {
    const key = symbol.toUpperCase()
    const sorted = bars.filter((bar) => bar.time > 0 && bar.close > 0).sort((a, b) => a.time - b.time)
    if (!sorted.length) continue
    barsOf.set(key, sorted)
    for (const bar of sorted) times.add(bar.time)
  }
  const timeline = [...times].sort((a, b) => a - b)
  if (timeline.length < 2) return null

  const today = beijingYmd()
  const daily = opts.daily || []
  const useBook = daily.length > 0
  const series: Array<{ time: number; close: number }> = []
  let lastYmd = ""
  let baseNav = opts.initialCapital
  const anchors = new Map<string, number>()

  for (const t of timeline) {
    const ymd = unixWallYmd(t)
    if (ymd !== lastYmd) {
      lastYmd = ymd
      anchors.clear()
      if (useBook) {
        baseNav =
          ymd === today && opts.bookEquity != null && opts.bookDailyPnl != null
            ? opts.bookEquity - opts.bookDailyPnl
            : equityBefore(daily, ymd, opts.initialCapital)
      }
      for (const pos of opts.positions) {
        const key = pos.symbol.toUpperCase()
        const bars = barsOf.get(key)
        let anchor: number | null = null
        if (ymd === today) {
          const prev = opts.prevMarks?.[key] ?? opts.prevMarks?.[pos.symbol]
          if (prev != null && prev > 0) anchor = prev
        }
        if (anchor == null && bars) {
          const first = firstBarOn(bars, ymd)
          if (first) anchor = first.open && first.open > 0 ? first.open : first.close
        }
        if (anchor == null || !(anchor > 0)) anchor = pos.entryPrice
        anchors.set(pos.id, anchor)
      }
    }

    let mtm = 0
    if (useBook) {
      for (const pos of opts.positions) {
        if (pos.status === "closed" && pos.exitTime && pos.exitTime <= t * 1000) continue
        if (pos.entryTime > t * 1000) continue
        const key = pos.symbol.toUpperCase()
        const mark = lastCloseAtOrBefore(barsOf.get(key) || [], t)
        const anchor = anchors.get(pos.id)
        if (mark == null || anchor == null) continue
        const pnl = positionPnl({ ...pos, status: "open", entryPrice: anchor, exitPrice: undefined }, mark)
        if (pnl != null) mtm += pnl
      }
      series.push({ time: t, close: baseNav + mtm })
      continue
    }

    for (const pos of opts.positions) {
      const key = pos.symbol.toUpperCase()
      const mark = lastCloseAtOrBefore(barsOf.get(key) || [], t)
      if (pos.status === "closed" && pos.exitTime && pos.exitTime <= t * 1000) {
        mtm += positionPnl(pos, pos.exitPrice ?? null) ?? 0
        continue
      }
      if (pos.entryTime > t * 1000) continue
      const pnl = positionPnl({ ...pos, status: "open", exitPrice: undefined }, mark)
      if (pnl != null) mtm += pnl
    }
    series.push({ time: t, close: opts.initialCapital + mtm })
  }

  if (series.length && Number.isFinite(opts.liveNav)) {
    series[series.length - 1] = { time: series[series.length - 1].time, close: opts.liveNav }
  }
  return series
}

export function paperNavCurve(opts: {
  initialCapital: number
  liveNav: number
  startedAt?: number
  positions?: PaperPosition[]
  daily?: Array<{ date: string; equity: number }>
  interval?: TimeframeId
  marksBySymbol?: Record<string, Array<{ time: number; close: number; open?: number }>>
  prevMarks?: Record<string, number>
  bookEquity?: number
  bookDailyPnl?: number
}): PaperNavPoint[] {
  const interval = opts.interval || "1d"
  const daily = (opts.daily || []).filter((row) => row.date && Number.isFinite(row.equity))
  const backbone =
    daily.length > 0
      ? dailyNavSeries({
          initialCapital: opts.initialCapital,
          liveNav: opts.liveNav,
          startedAt: opts.startedAt,
          daily,
        })
      : eventNavSeries({
          initialCapital: opts.initialCapital,
          liveNav: opts.liveNav,
          startedAt: opts.startedAt,
          positions: opts.positions,
        })

  if (isIntradayTimeframe(interval) && opts.marksBySymbol) {
    const intra = intradayNavSeries({
      initialCapital: opts.initialCapital,
      liveNav: opts.liveNav,
      positions: opts.positions || [],
      daily,
      marksBySymbol: opts.marksBySymbol,
      prevMarks: opts.prevMarks,
      bookEquity: opts.bookEquity,
      bookDailyPnl: opts.bookDailyPnl,
    })
    if (intra && intra.length >= 2) return toNavPoints(intra, interval)
  }

  return toNavPoints(resampleNav(backbone, interval), interval)
}

export type PaperSleeveDaily = { date: string; sleevePnl?: Partial<Record<SleeveKey, number>> | Record<string, number> }
export type PaperSleeveNavPoint = { date: string } & Record<SleeveKey, number>

function emptySleeveNav(capital: number): Record<SleeveKey, number> {
  return Object.fromEntries(SLEEVE_KEYS.map((key) => [key, capital])) as Record<SleeveKey, number>
}

function sleevePnlOf(row: PaperSleeveDaily | undefined, key: SleeveKey) {
  return Number(row?.sleevePnl?.[key]) || 0
}

function sleeveEquityBefore(daily: PaperSleeveDaily[], ymd: string, sleeveCapital: number): Record<SleeveKey, number> {
  const running = emptySleeveNav(0)
  for (const row of daily) {
    if (row.date >= ymd) break
    for (const key of SLEEVE_KEYS) running[key] += sleevePnlOf(row, key)
  }
  return Object.fromEntries(SLEEVE_KEYS.map((key) => [key, sleeveCapital + running[key]])) as Record<SleeveKey, number>
}

function toSleeveNavPoints(
  series: Array<{ time: number } & Record<SleeveKey, number>>,
  interval: TimeframeId,
): PaperSleeveNavPoint[] {
  return series.map((row) => {
    const point = { date: navAxisLabel(row.time, interval) } as PaperSleeveNavPoint
    for (const key of SLEEVE_KEYS) point[key] = row[key]
    return point
  })
}

function resampleSleeveNav(
  series: Array<{ time: number } & Record<SleeveKey, number>>,
  interval: TimeframeId,
  sleeveCapital: number,
): Array<{ time: number } & Record<SleeveKey, number>> {
  if (!series.length || interval === "1d" || isIntradayTimeframe(interval)) return series
  const byKey = Object.fromEntries(
    SLEEVE_KEYS.map((key) => [key, resampleNav(series.map((row) => ({ time: row.time, close: row[key] })), interval)]),
  ) as Record<SleeveKey, Array<{ time: number; close: number }>>
  const times = new Set<number>()
  for (const key of SLEEVE_KEYS) for (const row of byKey[key]) times.add(row.time)
  return [...times]
    .sort((a, b) => a - b)
    .map((time) => {
      const row = { time } as { time: number } & Record<SleeveKey, number>
      for (const key of SLEEVE_KEYS) {
        row[key] = lastCloseAtOrBefore(byKey[key], time) ?? sleeveCapital
      }
      return row
    })
}

function dailySleeveSeries(opts: {
  initialCapital: number
  liveSleeveNav: Record<SleeveKey, number>
  startedAt?: number
  daily: PaperSleeveDaily[]
}): Array<{ time: number } & Record<SleeveKey, number>> {
  const sleeveCapital = opts.initialCapital / SLEEVE_KEYS.length
  const today = beijingYmd()
  const running = emptySleeveNav(0)
  const series: Array<{ time: number } & Record<SleeveKey, number>> = []
  for (const row of opts.daily) {
    const time = ymdToUnix(row.date)
    if (time == null) continue
    for (const key of SLEEVE_KEYS) running[key] += sleevePnlOf(row, key)
    const navs = Object.fromEntries(
      SLEEVE_KEYS.map((key) => [key, row.date === today ? opts.liveSleeveNav[key] : sleeveCapital + running[key]]),
    ) as Record<SleeveKey, number>
    series.push({ time, ...navs })
  }
  const last = opts.daily[opts.daily.length - 1]
  if (last && last.date !== today) {
    const time = ymdToUnix(today)
    if (time != null) series.push({ time, ...opts.liveSleeveNav })
  }
  if (series.length === 1) {
    const startMs = opts.startedAt && opts.startedAt > 0 ? opts.startedAt : Date.now()
    series.unshift({ time: msToWallUnix(startMs), ...emptySleeveNav(sleeveCapital) })
  }
  return series
}

function eventSleeveSeries(opts: {
  initialCapital: number
  liveSleeveNav: Record<SleeveKey, number>
  startedAt?: number
  positions?: PaperPosition[]
}): Array<{ time: number } & Record<SleeveKey, number>> {
  const sleeveCapital = opts.initialCapital / SLEEVE_KEYS.length
  const start = opts.startedAt && opts.startedAt > 0 ? opts.startedAt : Date.now()
  return [
    { time: msToWallUnix(start), ...emptySleeveNav(sleeveCapital) },
    { time: msToWallUnix(Date.now()), ...opts.liveSleeveNav },
  ]
}

function intradaySleeveSeries(opts: {
  initialCapital: number
  liveSleeveNav: Record<SleeveKey, number>
  positions: PaperPosition[]
  daily?: PaperSleeveDaily[]
  marksBySymbol: Record<string, Array<{ time: number; close: number; open?: number }>>
  prevMarks?: Record<string, number>
}): Array<{ time: number } & Record<SleeveKey, number>> | null {
  const times = new Set<number>()
  const barsOf = new Map<string, Array<{ time: number; close: number }>>()
  for (const [symbol, bars] of Object.entries(opts.marksBySymbol)) {
    const key = symbol.toUpperCase()
    const sorted = bars.filter((bar) => bar.time > 0 && bar.close > 0).sort((a, b) => a.time - b.time)
    if (!sorted.length) continue
    barsOf.set(key, sorted)
    for (const bar of sorted) times.add(bar.time)
  }
  const timeline = [...times].sort((a, b) => a - b)
  if (timeline.length < 2) return null

  const sleeveCapital = opts.initialCapital / SLEEVE_KEYS.length
  const today = beijingYmd()
  const daily = opts.daily || []
  const useBook = daily.length > 0
  const series: Array<{ time: number } & Record<SleeveKey, number>> = []
  let lastYmd = ""
  let baseNav = emptySleeveNav(sleeveCapital)
  const anchors = new Map<string, number>()

  for (const t of timeline) {
    const ymd = unixWallYmd(t)
    if (ymd !== lastYmd) {
      lastYmd = ymd
      anchors.clear()
      baseNav = useBook ? sleeveEquityBefore(daily, ymd, sleeveCapital) : emptySleeveNav(sleeveCapital)
      for (const pos of opts.positions) {
        const key = pos.symbol.toUpperCase()
        const bars = barsOf.get(key)
        let anchor: number | null = null
        if (ymd === today) {
          const prev = opts.prevMarks?.[key] ?? opts.prevMarks?.[pos.symbol]
          if (prev != null && prev > 0) anchor = prev
        }
        if (anchor == null && bars) {
          const first = firstBarOn(bars, ymd)
          if (first) anchor = first.open && first.open > 0 ? first.open : first.close
        }
        if (anchor == null || !(anchor > 0)) anchor = pos.entryPrice
        anchors.set(pos.id, anchor)
      }
    }

    const mtm = emptySleeveNav(0)
    for (const pos of opts.positions) {
      const sleeve = resolveSleeve(pos)
      if (!sleeve) continue
      const key = pos.symbol.toUpperCase()
      if (useBook) {
        if (pos.status === "closed" && pos.exitTime && pos.exitTime <= t * 1000) continue
        if (pos.entryTime > t * 1000) continue
        const mark = lastCloseAtOrBefore(barsOf.get(key) || [], t)
        const anchor = anchors.get(pos.id)
        if (mark == null || anchor == null) continue
        const pnl = positionPnl({ ...pos, status: "open", entryPrice: anchor, exitPrice: undefined }, mark)
        if (pnl != null) mtm[sleeve] += pnl
        continue
      }
      const mark = lastCloseAtOrBefore(barsOf.get(key) || [], t)
      if (pos.status === "closed" && pos.exitTime && pos.exitTime <= t * 1000) {
        mtm[sleeve] += positionPnl(pos, pos.exitPrice ?? null) ?? 0
        continue
      }
      if (pos.entryTime > t * 1000) continue
      const pnl = positionPnl({ ...pos, status: "open", exitPrice: undefined }, mark)
      if (pnl != null) mtm[sleeve] += pnl
    }
    const row = { time: t } as { time: number } & Record<SleeveKey, number>
    for (const key of SLEEVE_KEYS) row[key] = baseNav[key] + mtm[key]
    series.push(row)
  }

  if (series.length) {
    series[series.length - 1] = { time: series[series.length - 1].time, ...opts.liveSleeveNav }
  }
  return series
}

export function paperSleeveNavCurve(opts: {
  initialCapital: number
  liveSleeveNav: Record<SleeveKey, number>
  startedAt?: number
  positions?: PaperPosition[]
  daily?: PaperSleeveDaily[]
  interval?: TimeframeId
  marksBySymbol?: Record<string, Array<{ time: number; close: number; open?: number }>>
  prevMarks?: Record<string, number>
}): PaperSleeveNavPoint[] {
  const interval = opts.interval || "1d"
  const sleeveCapital = opts.initialCapital / SLEEVE_KEYS.length
  const daily = (opts.daily || []).filter((row) => row.date)
  const backbone =
    daily.length > 0
      ? dailySleeveSeries({
          initialCapital: opts.initialCapital,
          liveSleeveNav: opts.liveSleeveNav,
          startedAt: opts.startedAt,
          daily,
        })
      : eventSleeveSeries({
          initialCapital: opts.initialCapital,
          liveSleeveNav: opts.liveSleeveNav,
          startedAt: opts.startedAt,
          positions: opts.positions,
        })

  if (isIntradayTimeframe(interval) && opts.marksBySymbol) {
    const intra = intradaySleeveSeries({
      initialCapital: opts.initialCapital,
      liveSleeveNav: opts.liveSleeveNav,
      positions: opts.positions || [],
      daily,
      marksBySymbol: opts.marksBySymbol,
      prevMarks: opts.prevMarks,
    })
    if (intra && intra.length >= 2) return toSleeveNavPoints(intra, interval)
  }

  return toSleeveNavPoints(resampleSleeveNav(backbone, interval, sleeveCapital), interval)
}

export type PaperProductDaily = { date: string; productPnl?: Record<string, number> }
export type PaperProductNavPoint = { date: string } & Record<string, number>

function emptyKeyed(keys: string[], value: number): Record<string, number> {
  return Object.fromEntries(keys.map((key) => [key, value]))
}

function productPnlOf(row: PaperProductDaily | undefined, key: string) {
  if (!row?.productPnl) return 0
  return Number(row.productPnl[key] ?? row.productPnl[key.toUpperCase()]) || 0
}

function productEquityBefore(
  keys: string[],
  daily: PaperProductDaily[],
  ymd: string,
  capitalOf: (key: string) => number,
): Record<string, number> {
  const running = emptyKeyed(keys, 0)
  for (const row of daily) {
    if (row.date >= ymd) break
    for (const key of keys) running[key] += productPnlOf(row, key)
  }
  return Object.fromEntries(keys.map((key) => [key, capitalOf(key) + running[key]]))
}

function toProductNavPoints(
  series: Array<{ time: number } & Record<string, number>>,
  keys: string[],
  interval: TimeframeId,
): PaperProductNavPoint[] {
  return series.map((row) => {
    const point: PaperProductNavPoint = { date: navAxisLabel(row.time, interval) }
    for (const key of keys) point[key] = row[key] ?? 0
    return point
  })
}

function resampleProductNav(
  series: Array<{ time: number } & Record<string, number>>,
  keys: string[],
  interval: TimeframeId,
  capitalOf: (key: string) => number,
): Array<{ time: number } & Record<string, number>> {
  if (!series.length || interval === "1d" || isIntradayTimeframe(interval)) return series
  const byKey = Object.fromEntries(
    keys.map((key) => [key, resampleNav(series.map((row) => ({ time: row.time, close: row[key] ?? capitalOf(key) })), interval)]),
  ) as Record<string, Array<{ time: number; close: number }>>
  const times = new Set<number>()
  for (const key of keys) for (const row of byKey[key] || []) times.add(row.time)
  return [...times]
    .sort((a, b) => a - b)
    .map((time) => {
      const row: { time: number } & Record<string, number> = { time }
      for (const key of keys) row[key] = lastCloseAtOrBefore(byKey[key] || [], time) ?? capitalOf(key)
      return row
    })
}

function dailyProductSeries(opts: {
  keys: string[]
  capitalOf: (key: string) => number
  liveNav: Record<string, number>
  startedAt?: number
  daily: PaperProductDaily[]
}): Array<{ time: number } & Record<string, number>> {
  const today = beijingYmd()
  const running = emptyKeyed(opts.keys, 0)
  const series: Array<{ time: number } & Record<string, number>> = []
  for (const row of opts.daily) {
    const time = ymdToUnix(row.date)
    if (time == null) continue
    for (const key of opts.keys) running[key] += productPnlOf(row, key)
    const navs: { time: number } & Record<string, number> = { time }
    for (const key of opts.keys) {
      navs[key] = row.date === today ? opts.liveNav[key] ?? opts.capitalOf(key) + running[key] : opts.capitalOf(key) + running[key]
    }
    series.push(navs)
  }
  const last = opts.daily[opts.daily.length - 1]
  if (last && last.date !== today) {
    const time = ymdToUnix(today)
    if (time != null) series.push({ time, ...opts.liveNav })
  }
  if (series.length === 1) {
    const startMs = opts.startedAt && opts.startedAt > 0 ? opts.startedAt : Date.now()
    const start: { time: number } & Record<string, number> = { time: msToWallUnix(startMs) }
    for (const key of opts.keys) start[key] = opts.capitalOf(key)
    series.unshift(start)
  }
  return series
}

function eventProductSeries(opts: {
  keys: string[]
  capitalOf: (key: string) => number
  liveNav: Record<string, number>
  startedAt?: number
}): Array<{ time: number } & Record<string, number>> {
  const start = opts.startedAt && opts.startedAt > 0 ? opts.startedAt : Date.now()
  const open: { time: number } & Record<string, number> = { time: msToWallUnix(start) }
  for (const key of opts.keys) open[key] = opts.capitalOf(key)
  return [open, { time: msToWallUnix(Date.now()), ...opts.liveNav }]
}

function positionAssetKey(pos: PaperPosition) {
  return assetFromContract(pos.symbol) || pos.symbol.replace(/\d+$/i, "").toUpperCase() || null
}

function intradayProductSeries(opts: {
  keys: string[]
  capitalOf: (key: string) => number
  liveNav: Record<string, number>
  positions: PaperPosition[]
  daily?: PaperProductDaily[]
  marksBySymbol: Record<string, Array<{ time: number; close: number; open?: number }>>
  prevMarks?: Record<string, number>
}): Array<{ time: number } & Record<string, number>> | null {
  const keySet = new Set(opts.keys)
  const times = new Set<number>()
  const barsOf = new Map<string, Array<{ time: number; close: number }>>()
  for (const [symbol, bars] of Object.entries(opts.marksBySymbol)) {
    const key = symbol.toUpperCase()
    const sorted = bars.filter((bar) => bar.time > 0 && bar.close > 0).sort((a, b) => a.time - b.time)
    if (!sorted.length) continue
    barsOf.set(key, sorted)
    for (const bar of sorted) times.add(bar.time)
  }
  const timeline = [...times].sort((a, b) => a - b)
  if (timeline.length < 2) return null

  const today = beijingYmd()
  const daily = opts.daily || []
  const useBook = daily.length > 0
  const series: Array<{ time: number } & Record<string, number>> = []
  let lastYmd = ""
  let baseNav = emptyKeyed(opts.keys, 0)
  const anchors = new Map<string, number>()

  for (const t of timeline) {
    const ymd = unixWallYmd(t)
    if (ymd !== lastYmd) {
      lastYmd = ymd
      anchors.clear()
      baseNav = useBook
        ? productEquityBefore(opts.keys, daily, ymd, opts.capitalOf)
        : Object.fromEntries(opts.keys.map((key) => [key, opts.capitalOf(key)]))
      for (const pos of opts.positions) {
        const asset = positionAssetKey(pos)
        if (!asset || !keySet.has(asset)) continue
        const key = pos.symbol.toUpperCase()
        const bars = barsOf.get(key)
        let anchor: number | null = null
        if (ymd === today) {
          const prev = opts.prevMarks?.[key] ?? opts.prevMarks?.[pos.symbol]
          if (prev != null && prev > 0) anchor = prev
        }
        if (anchor == null && bars) {
          const first = firstBarOn(bars, ymd)
          if (first) anchor = first.open && first.open > 0 ? first.open : first.close
        }
        if (anchor == null || !(anchor > 0)) anchor = pos.entryPrice
        anchors.set(pos.id, anchor)
      }
    }

    const mtm = emptyKeyed(opts.keys, 0)
    for (const pos of opts.positions) {
      const asset = positionAssetKey(pos)
      if (!asset || !keySet.has(asset)) continue
      const key = pos.symbol.toUpperCase()
      if (useBook) {
        if (pos.status === "closed" && pos.exitTime && pos.exitTime <= t * 1000) continue
        if (pos.entryTime > t * 1000) continue
        const mark = lastCloseAtOrBefore(barsOf.get(key) || [], t)
        const anchor = anchors.get(pos.id)
        if (mark == null || anchor == null) continue
        const pnl = positionPnl({ ...pos, status: "open", entryPrice: anchor, exitPrice: undefined }, mark)
        if (pnl != null) mtm[asset] += pnl
        continue
      }
      const mark = lastCloseAtOrBefore(barsOf.get(key) || [], t)
      if (pos.status === "closed" && pos.exitTime && pos.exitTime <= t * 1000) {
        mtm[asset] += positionPnl(pos, pos.exitPrice ?? null) ?? 0
        continue
      }
      if (pos.entryTime > t * 1000) continue
      const pnl = positionPnl({ ...pos, status: "open", exitPrice: undefined }, mark)
      if (pnl != null) mtm[asset] += pnl
    }
    const row: { time: number } & Record<string, number> = { time: t }
    for (const key of opts.keys) row[key] = (baseNav[key] ?? opts.capitalOf(key)) + (mtm[key] ?? 0)
    series.push(row)
  }

  if (series.length) series[series.length - 1] = { time: series[series.length - 1].time, ...opts.liveNav }
  return series
}

export function paperProductNavCurve(opts: {
  keys: string[]
  capitalOf: (key: string) => number
  liveNav: Record<string, number>
  startedAt?: number
  positions?: PaperPosition[]
  daily?: PaperProductDaily[]
  interval?: TimeframeId
  marksBySymbol?: Record<string, Array<{ time: number; close: number; open?: number }>>
  prevMarks?: Record<string, number>
}): PaperProductNavPoint[] {
  const keys = opts.keys.filter(Boolean)
  if (!keys.length) return []
  const interval = opts.interval || "1d"
  const daily = (opts.daily || []).filter((row) => row.date)
  const backbone =
    daily.length > 0
      ? dailyProductSeries({
          keys,
          capitalOf: opts.capitalOf,
          liveNav: opts.liveNav,
          startedAt: opts.startedAt,
          daily,
        })
      : eventProductSeries({
          keys,
          capitalOf: opts.capitalOf,
          liveNav: opts.liveNav,
          startedAt: opts.startedAt,
        })

  if (isIntradayTimeframe(interval) && opts.marksBySymbol) {
    const intra = intradayProductSeries({
      keys,
      capitalOf: opts.capitalOf,
      liveNav: opts.liveNav,
      positions: opts.positions || [],
      daily,
      marksBySymbol: opts.marksBySymbol,
      prevMarks: opts.prevMarks,
    })
    if (intra && intra.length >= 2) return toProductNavPoints(intra, keys, interval)
  }

  return toProductNavPoints(resampleProductNav(backbone, keys, interval, opts.capitalOf), keys, interval)
}

function defaultMinePortfolio(): PaperPortfolio {
  return { id: "default", name: "手动账户", kind: "manual", scope: "mine", createdAt: 0, initialCapital: DEFAULT_PAPER_CAPITAL }
}

function migratePortfolio(raw: Partial<PaperPortfolio> & { id?: string; name?: string; createdAt?: number }): PaperPortfolio | null {
  if (!raw.id) return null
  const id = String(raw.id)
  const kind: PaperAccountKind =
    id === ALL_WEATHER_PORTFOLIO_ID || raw.kind === "all-weather"
      ? "all-weather"
      : raw.kind === "strategy"
        ? "strategy"
        : "manual"
  const name =
    id === ALL_WEATHER_PORTFOLIO_ID
      ? "全天候策略"
      : id === "default" && (!raw.name || raw.name === "默认组合")
        ? "手动账户"
        : String(raw.name || "模拟账户")
  const capital = Number(raw.initialCapital)
  const initialCapital = Number.isFinite(capital) && capital > 0 ? capital : DEFAULT_PAPER_CAPITAL
  const scope: PaperScope = kind === "all-weather" || raw.scope === "team" ? "team" : "mine"
  return { id, name, createdAt: Number(raw.createdAt) || 0, kind, initialCapital, scope }
}

export function emptyPaperState(): PaperState {
  return {
    portfolios: [defaultMinePortfolio()],
    products: [],
    positions: [],
    strategies: [],
  }
}

export function parsePaperState(raw: unknown): PaperState {
  const parsed = raw && typeof raw === "object" ? (raw as Partial<PaperState>) : {}
  return {
    portfolios: Array.isArray(parsed.portfolios)
      ? parsed.portfolios.map((item) => migratePortfolio(item)).filter((item): item is PaperPortfolio => !!item)
      : [],
    products: Array.isArray(parsed.products) ? parsed.products : [],
    positions: Array.isArray(parsed.positions) ? parsed.positions : [],
    strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
  }
}

export function hydratePaperState(state: PaperState): PaperState {
  let next = ensureAllWeatherPortfolio(state)
  if (!next.portfolios.some((p) => portfolioScope(p) === "mine")) {
    next = { ...next, portfolios: [...next.portfolios, defaultMinePortfolio()] }
  }
  return next
}

export function loadPaperState(): PaperState {
  if (typeof window === "undefined") return hydratePaperState(emptyPaperState())
  try {
    const raw = localStorage.getItem(PAPER_STORAGE_KEY)
    if (!raw) return hydratePaperState(emptyPaperState())
    return hydratePaperState(parsePaperState(JSON.parse(raw)))
  } catch {
    return hydratePaperState(emptyPaperState())
  }
}

export function savePaperState(state: PaperState) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // private mode / quota
  }
}

export function priceDigits(symbol: string) {
  const asset = (symbol.replace(/\d+$/i, "") || symbol).toUpperCase()
  if (asset === "T" || asset === "TF" || asset === "TS" || asset === "TL") return 3
  if (asset === "AU" || asset === "AG") return 2
  if (asset === "IF" || asset === "IH" || asset === "IC" || asset === "IM") return 1
  return null
}

export function contractMultiplier(symbol: string, override?: number | null) {
  if (override && override > 0) return override
  const product = productOfSymbol(symbol)
  if (product) return MULTIPLIER[product]
  return multiplierForContract(symbol) ?? 300
}

export function markPrice(
  symbol: string,
  quotes: Record<string, CtpTick>,
  candles: Record<string, CtpCandle[]>,
  extraMarks?: Record<string, number>,
) {
  const key = symbol.toUpperCase()
  const quote = quoteOf(quotes, key)
  const live = validMark(quote?.last)
  const extra = validMark(extraMarks?.[key] ?? extraMarks?.[symbol])
  const hist = validMark(candles[key]?.at(-1)?.close ?? candles[symbol]?.at(-1)?.close)
  const settle = validMark(quote?.pre_settlement) ?? validMark(quote?.pre_close)
  // Closed session: ignore live last. SimNow / 新浪 still print on Sunday and that
  // made 现价 look unchanged (rounding) while 浮动盈亏 hopped between sources.
  // Weekday lunch / tea is different: last is this morning (or last night), not settle.
  if (!isLiveSessionFor(key)) return weekdayClosedLast(key, quote) ?? extra ?? settle ?? hist
  return live ?? extra ?? hist ?? settle
}

export function positionPnl(pos: PaperPosition, mark: number | null) {
  const px = pos.status === "closed" && pos.exitPrice != null ? pos.exitPrice : mark
  if (px == null) return null
  const dir = pos.side === "long" ? 1 : -1
  return (px - pos.entryPrice) * pos.lots * contractMultiplier(pos.symbol, pos.multiplier) * dir
}

/** Price return: (mark - entry) / entry * direction. */
export function positionReturn(pos: PaperPosition, mark: number | null) {
  const px = pos.status === "closed" && pos.exitPrice != null ? pos.exitPrice : mark
  if (px == null || !(pos.entryPrice > 0)) return null
  const dir = pos.side === "long" ? 1 : -1
  return ((px - pos.entryPrice) / pos.entryPrice) * dir
}

/** 保证金占用 = 现价 × 手数 × 乘数 × 保证金率 × 券商保证金系数 */
export function positionMargin(pos: Pick<PaperPosition, "symbol" | "lots" | "multiplier" | "entryPrice">, mark: number | null) {
  const px = mark != null && mark > 0 ? mark : pos.entryPrice
  if (px == null || px <= 0 || pos.lots <= 0) return null
  const rate = marginRateForContract(pos.symbol)
  if (rate == null) return null
  return px * pos.lots * contractMultiplier(pos.symbol, pos.multiplier) * rate * brokerMarginMultiplier()
}

export function positionNotional(
  pos: Pick<PaperPosition, "symbol" | "lots" | "multiplier" | "entryPrice">,
  mark: number | null,
) {
  const px = mark != null && mark > 0 ? mark : pos.entryPrice
  if (px == null || px <= 0 || pos.lots <= 0) return null
  return px * pos.lots * contractMultiplier(pos.symbol, pos.multiplier)
}

function resolveSleeve(pos: PaperPosition): SleeveKey | null {
  if (pos.sleeve && isSleeveKey(pos.sleeve)) return pos.sleeve
  return sleeveFromContract(pos.symbol)
}

export function sleeveLeadPositions(
  rows: Array<{ position: PaperPosition; mark: number | null }>,
  opts?: { snapshotFallback?: boolean },
): Record<SleeveKey, { position: PaperPosition; mark: number | null; notional: number } | null> {
  const out = Object.fromEntries(SLEEVE_KEYS.map((key) => [key, null])) as Record<
    SleeveKey,
    { position: PaperPosition; mark: number | null; notional: number } | null
  >
  for (const row of rows) {
    if (row.position.status !== "open") continue
    const sleeve = resolveSleeve(row.position)
    if (!sleeve) continue
    const notional = positionNotional(row.position, row.mark)
    if (notional == null) continue
    const cur = out[sleeve]
    if (!cur || notional > cur.notional) out[sleeve] = { ...row, notional }
  }
  if (opts?.snapshotFallback) {
    for (const sleeve of SLEEVE_KEYS) {
      if (out[sleeve]) continue
      const fallback = snapshotSleeveLead(sleeve)
      if (fallback) out[sleeve] = fallback
    }
  }
  return out
}

function snapshotSleeveLead(sleeve: SleeveKey): { position: PaperPosition; mark: number | null; notional: number } | null {
  const snap = loadStrategySnapshot()
  const candidates = snap.positions.filter((item) => item.sleeve === sleeve && item.lots > 0)
  if (!candidates.length) {
    if (sleeve !== "Equity") return null
    const spec = specForAsset("IF")
    if (!spec) return null
    const symbol = spec.refContract.toUpperCase()
    return {
      position: {
        id: "lead-IF",
        portfolioId: ALL_WEATHER_PORTFOLIO_ID,
        productId: "lead-IF",
        symbol,
        side: "long",
        lots: 1,
        entryPrice: spec.refPrice,
        entryTime: 0,
        status: "open",
        multiplier: spec.multiplier,
        sleeve: "Equity",
        label: "沪深300 IF",
      },
      mark: spec.refPrice,
      notional: spec.refPrice * spec.multiplier,
    }
  }
  const best = candidates.reduce((a, b) => (b.lots * b.price * b.multiplier > a.lots * a.price * a.multiplier ? b : a))
  const spec = specForAsset(best.asset)
  const symbol = (spec?.refContract || best.asset).toUpperCase()
  return {
    position: {
      id: `lead-${best.asset}`,
      portfolioId: ALL_WEATHER_PORTFOLIO_ID,
      productId: `lead-${best.asset}`,
      symbol,
      side: "long",
      lots: best.lots,
      entryPrice: best.price,
      entryTime: 0,
      status: "open",
      multiplier: best.multiplier,
      sleeve,
      label: best.label,
    },
    mark: best.price,
    notional: best.lots * best.price * best.multiplier,
  }
}

export function fmtYuan(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "--"
  return `¥${Math.abs(n).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`
}

export function fmtMoney(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "--"
  const abs = Math.abs(n).toLocaleString("zh-CN", { maximumFractionDigits: 0 })
  if (n > 0) return `+¥${abs}`
  if (n < 0) return `-¥${abs}`
  return `¥${abs}`
}

export function fmtPct(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "--"
  const pct = n * 100
  const abs = Math.abs(pct).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
  if (pct > 0) return `+${abs}%`
  if (pct < 0) return `-${abs}%`
  return `${abs}%`
}

export function sideLabel(side: PaperSide) {
  return side === "long" ? "多" : "空"
}

export function entryModeLabel(mode: PaperEntryMode) {
  if (mode === "market") return "市价"
  if (mode === "breakout") return "突破"
  return "均线交叉"
}

export function strategyStatusLabel(status: PaperStrategyStatus) {
  if (status === "armed") return "监控中"
  if (status === "filled") return "持仓中"
  if (status === "stopped") return "已结束"
  return "已停用"
}

function sma(closes: number[], period: number) {
  if (closes.length < period || period <= 0) return null
  let sum = 0
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i]
  return sum / period
}

export function maCrossSignal(closes: number[], fast: number, slow: number): "golden" | "death" | null {
  if (fast <= 0 || slow <= 0 || fast >= slow) return null
  if (closes.length < slow + 1) return null
  const prev = closes.slice(0, -1)
  const currFast = sma(closes, fast)
  const currSlow = sma(closes, slow)
  const prevFast = sma(prev, fast)
  const prevSlow = sma(prev, slow)
  if (currFast == null || currSlow == null || prevFast == null || prevSlow == null) return null
  if (prevFast <= prevSlow && currFast > currSlow) return "golden"
  if (prevFast >= prevSlow && currFast < currSlow) return "death"
  return null
}

export function ensureProduct(state: PaperState, portfolioId: string, symbol: string) {
  const existing = state.products.find((p) => p.portfolioId === portfolioId && p.symbol === symbol)
  if (existing) return { state, product: existing }
  const product: PaperProduct = { id: nid("prd-"), portfolioId, symbol }
  return { state: { ...state, products: [...state.products, product] }, product }
}

export function applyAllWeatherBook(
  state: PaperState,
  holdings: AllWeatherHolding[],
  now = Date.now(),
  marks?: Record<string, number>,
  initialCapital?: number,
): PaperState {
  const live = holdings.filter((h) => h.lots > 0)
  const existingAw = state.portfolios.find((p) => p.id === ALL_WEATHER_PORTFOLIO_ID)
  const capital =
    initialCapital != null && initialCapital > 0
      ? initialCapital
      : existingAw?.initialCapital
  const awAccount: PaperPortfolio = {
    id: ALL_WEATHER_PORTFOLIO_ID,
    name: "全天候策略",
    kind: "all-weather",
    scope: "team",
    createdAt: existingAw?.createdAt || now,
    initialCapital: capital,
  }
  const portfolios = state.portfolios.some((p) => p.id === ALL_WEATHER_PORTFOLIO_ID)
    ? state.portfolios.map((p) => (p.id === ALL_WEATHER_PORTFOLIO_ID ? { ...p, ...awAccount } : p))
    : [awAccount, ...state.portfolios]

  const oldProducts = state.products.filter((p) => p.portfolioId === ALL_WEATHER_PORTFOLIO_ID)
  const products: PaperProduct[] = live.map((h) => {
    const old = oldProducts.find((p) => p.symbol === h.contract)
    return {
      id: old?.id || nid("prd-"),
      portfolioId: ALL_WEATHER_PORTFOLIO_ID,
      symbol: h.contract,
      label: h.label,
      sleeve: h.sleeve,
    }
  })
  const productIdOf = (symbol: string) => products.find((p) => p.symbol === symbol)?.id || nid("prd-")

  const existingOpen = state.positions.filter((p) => p.portfolioId === ALL_WEATHER_PORTFOLIO_ID && p.status === "open")
  const existingBySymbol = new Map(existingOpen.map((p) => [p.symbol, p]))
  const liveByContract = new Map(live.map((h) => [h.contract, h]))

  const nextOpen: PaperPosition[] = live.map((h) => {
    const prev = existingBySymbol.get(h.contract)
    if (prev) {
      return {
        ...prev,
        productId: productIdOf(h.contract),
        lots: h.lots,
        multiplier: h.multiplier,
        sleeve: h.sleeve,
        label: h.label,
        source: "all-weather",
        strategyId: ALL_WEATHER_STRATEGY_ID,
      }
    }
    return {
      id: nid("pos-"),
      portfolioId: ALL_WEATHER_PORTFOLIO_ID,
      productId: productIdOf(h.contract),
      strategyId: ALL_WEATHER_STRATEGY_ID,
      symbol: h.contract,
      side: "long" as const,
      lots: h.lots,
      entryPrice: h.prevPrice > 0 ? h.prevPrice : h.price,
      entryTime: h.openedAt || now,
      status: "open" as const,
      multiplier: h.multiplier,
      sleeve: h.sleeve,
      label: h.label,
      source: "all-weather" as const,
    }
  })

  const newlyClosed: PaperPosition[] = existingOpen
    .filter((prev) => !liveByContract.has(prev.symbol))
    .map((prev) => {
      const exit = marks?.[prev.symbol] ?? marks?.[prev.symbol.toUpperCase()] ?? prev.entryPrice
      return {
        ...prev,
        status: "closed" as const,
        exitPrice: exit,
        exitTime: now,
        closeReason: "策略自动平仓",
      }
    })

  const history = state.positions.filter((p) => p.portfolioId !== ALL_WEATHER_PORTFOLIO_ID || p.status === "closed")
  const focus = live.find((h) => h.asset === "IF") || live.find((h) => h.asset === "IC") || live[0]
  const opened = live.filter((h) => !existingBySymbol.has(h.contract)).length
  const closed = newlyClosed.length
  const resized = live.filter((h) => {
    const prev = existingBySymbol.get(h.contract)
    return prev != null && prev.lots !== h.lots
  }).length
  const note =
    opened || closed || resized
      ? `策略自动执行 · 开${opened} 平${closed} 调${resized}`
      : live.length
        ? `策略自动执行 · ${live.length} 个品种`
        : "无持仓"

  const strategy: PaperStrategy = {
    id: ALL_WEATHER_STRATEGY_ID,
    portfolioId: ALL_WEATHER_PORTFOLIO_ID,
    name: "全天候 · 风险平价",
    symbol: focus?.contract || "IF2609",
    side: "long",
    lots: live.reduce((sum, h) => sum + h.lots, 0),
    entryMode: "market",
    maFast: 5,
    maSlow: 20,
    status: live.length ? "filled" : "disabled",
    createdAt: now,
    lastNote: note,
  }
  return {
    portfolios,
    products: [...state.products.filter((p) => p.portfolioId !== ALL_WEATHER_PORTFOLIO_ID), ...products],
    positions: [...history, ...newlyClosed, ...nextOpen],
    strategies: [...state.strategies.filter((s) => s.portfolioId !== ALL_WEATHER_PORTFOLIO_ID), strategy],
  }
}

export function openPosition(
  state: PaperState,
  args: {
    portfolioId: string
    symbol: string
    side: PaperSide
    lots: number
    entryPrice: number
    strategyId?: string
    now?: number
    multiplier?: number
    sleeve?: string
    label?: string
    source?: PaperPosition["source"]
  },
) {
  if (args.lots <= 0 || args.entryPrice <= 0) return { state, error: "手数和价格必须大于 0" }
  const open = state.positions.find(
    (p) => p.portfolioId === args.portfolioId && p.symbol === args.symbol && p.status === "open",
  )
  if (open) return { state, error: `${args.symbol} 已有持仓` }
  const ensured = ensureProduct(state, args.portfolioId, args.symbol)
  const pos: PaperPosition = {
    id: nid("pos-"),
    portfolioId: args.portfolioId,
    productId: ensured.product.id,
    strategyId: args.strategyId,
    symbol: args.symbol,
    side: args.side,
    lots: args.lots,
    entryPrice: args.entryPrice,
    entryTime: args.now ?? Date.now(),
    status: "open",
    multiplier: args.multiplier ?? contractMultiplier(args.symbol),
    sleeve: args.sleeve,
    label: args.label,
    source: args.source ?? (args.strategyId ? "strategy" : "manual"),
  }
  return {
    state: { ...ensured.state, positions: [...ensured.state.positions, pos] },
    position: pos,
    error: null as string | null,
  }
}

export function closePosition(state: PaperState, positionId: string, exitPrice: number, reason: string, now = Date.now()) {
  let changed = false
  const positions = state.positions.map((p) => {
    if (p.id !== positionId || p.status !== "open") return p
    changed = true
    return { ...p, status: "closed" as const, exitPrice, exitTime: now, closeReason: reason }
  })
  if (!changed) return state
  const strategies = state.strategies.map((s) => {
    if (s.positionId !== positionId || s.status !== "filled") return s
    return { ...s, status: "stopped" as const, lastNote: reason }
  })
  return { ...state, positions, strategies }
}

export function evaluatePaperTrading(
  state: PaperState,
  quotes: Record<string, CtpTick>,
  candles: Record<string, CtpCandle[]>,
  prevMarks: Record<string, number>,
  extraMarks?: Record<string, number>,
  now = Date.now(),
): PaperState {
  let next = state
  let changed = false

  for (const strategy of next.strategies) {
    if (strategy.id === ALL_WEATHER_STRATEGY_ID) continue
    if (strategy.status !== "armed") continue
    const mark = markPrice(strategy.symbol, quotes, candles, extraMarks)
    if (mark == null) continue

    let hit = false
    if (strategy.entryMode === "breakout") {
      const level = strategy.entryLevel
      const prev = prevMarks[strategy.symbol]
      if (level == null || prev == null) continue
      if (strategy.entryCompare === "above" && prev < level && mark >= level) hit = true
      if (strategy.entryCompare === "below" && prev > level && mark <= level) hit = true
    } else if (strategy.entryMode === "ma_cross") {
      const closes = (candles[strategy.symbol] || []).map((c) => c.close)
      const signal = maCrossSignal(closes, strategy.maFast, strategy.maSlow)
      if (strategy.side === "long" && signal === "golden") hit = true
      if (strategy.side === "short" && signal === "death") hit = true
    }

    if (!hit) continue
    const opened = openPosition(next, {
      portfolioId: strategy.portfolioId,
      symbol: strategy.symbol,
      side: strategy.side,
      lots: strategy.lots,
      entryPrice: mark,
      strategyId: strategy.id,
      now,
    })
    if (opened.error || !opened.position) continue
    changed = true
    next = {
      ...opened.state,
      strategies: opened.state.strategies.map((s) =>
        s.id === strategy.id
          ? { ...s, status: "filled" as const, filledAt: now, positionId: opened.position!.id, lastNote: "入场成交" }
          : s,
      ),
    }
  }

  for (const strategy of next.strategies) {
    if (strategy.id === ALL_WEATHER_STRATEGY_ID) continue
    if (strategy.status !== "filled" || !strategy.positionId) continue
    const pos = next.positions.find((p) => p.id === strategy.positionId && p.status === "open")
    if (!pos) continue
    const mark = markPrice(pos.symbol, quotes, candles, extraMarks)
    if (mark == null) continue
    const move = (mark - pos.entryPrice) * (pos.side === "long" ? 1 : -1)
    if (strategy.stopLossPts && move <= -strategy.stopLossPts) {
      next = closePosition(next, pos.id, mark, "止损", now)
      changed = true
      continue
    }
    if (strategy.takeProfitPts && move >= strategy.takeProfitPts) {
      next = closePosition(next, pos.id, mark, "止盈", now)
      changed = true
    }
  }

  return changed ? next : state
}
