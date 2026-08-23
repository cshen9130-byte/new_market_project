import { multiplierForContract } from "@/lib/all-weather/universe"
import type { CtpCandle, CtpTick, IndexProduct } from "@/lib/client/ctp-market"
import { productOfSymbol } from "@/lib/client/pro-trading"

export const PAPER_STORAGE_KEY = "ma_index_paper_trading_v1"
export const ALL_WEATHER_PORTFOLIO_ID = "all-weather"
export const ALL_WEATHER_STRATEGY_ID = "stg-all-weather"

export type PaperSide = "long" | "short"
export type PaperEntryMode = "market" | "breakout" | "ma_cross"
export type PaperStrategyStatus = "armed" | "filled" | "stopped" | "disabled"
export type PaperPositionStatus = "open" | "closed"

export type PaperPortfolio = {
  id: string
  name: string
  createdAt: number
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
  source?: "manual" | "all-weather"
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

export function emptyPaperState(): PaperState {
  return {
    portfolios: [{ id: "default", name: "默认组合", createdAt: 0 }],
    products: [],
    positions: [],
    strategies: [],
  }
}

export function loadPaperState(): PaperState {
  if (typeof window === "undefined") return emptyPaperState()
  try {
    const raw = localStorage.getItem(PAPER_STORAGE_KEY)
    if (!raw) return emptyPaperState()
    const parsed = JSON.parse(raw) as Partial<PaperState>
    const state: PaperState = {
      portfolios: Array.isArray(parsed.portfolios) ? parsed.portfolios : [],
      products: Array.isArray(parsed.products) ? parsed.products : [],
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
    }
    if (!state.portfolios.length) state.portfolios = emptyPaperState().portfolios
    return state
  } catch {
    return emptyPaperState()
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
  return quotes[symbol]?.last ?? extraMarks?.[symbol] ?? candles[symbol]?.at(-1)?.close ?? null
}

export function positionPnl(pos: PaperPosition, mark: number | null) {
  const px = pos.status === "closed" && pos.exitPrice != null ? pos.exitPrice : mark
  if (px == null) return null
  const dir = pos.side === "long" ? 1 : -1
  return (px - pos.entryPrice) * pos.lots * contractMultiplier(pos.symbol, pos.multiplier) * dir
}

export function fmtMoney(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "--"
  const abs = Math.abs(n).toLocaleString("zh-CN", { maximumFractionDigits: 0 })
  if (n > 0) return `+¥${abs}`
  if (n < 0) return `-¥${abs}`
  return `¥${abs}`
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

export function applyAllWeatherBook(state: PaperState, holdings: AllWeatherHolding[], now = Date.now()): PaperState {
  const live = holdings.filter((h) => h.lots > 0)
  const portfolios = state.portfolios.some((p) => p.id === ALL_WEATHER_PORTFOLIO_ID)
    ? state.portfolios.map((p) => (p.id === ALL_WEATHER_PORTFOLIO_ID ? { ...p, name: "全天候策略" } : p))
    : [...state.portfolios, { id: ALL_WEATHER_PORTFOLIO_ID, name: "全天候策略", createdAt: now }]
  const products: PaperProduct[] = live.map((h) => ({
    id: nid("prd-"),
    portfolioId: ALL_WEATHER_PORTFOLIO_ID,
    symbol: h.contract,
    label: h.label,
    sleeve: h.sleeve,
  }))
  const positions: PaperPosition[] = live.map((h, i) => ({
    id: nid("pos-"),
    portfolioId: ALL_WEATHER_PORTFOLIO_ID,
    productId: products[i].id,
    strategyId: ALL_WEATHER_STRATEGY_ID,
    symbol: h.contract,
    side: "long",
    lots: h.lots,
    entryPrice: h.prevPrice > 0 ? h.prevPrice : h.price,
    entryTime: h.openedAt || now,
    status: "open",
    multiplier: h.multiplier,
    sleeve: h.sleeve,
    label: h.label,
    source: "all-weather",
  }))
  const focus = live.find((h) => h.asset === "IF") || live.find((h) => h.asset === "IC") || live[0]
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
    lastNote: live.length ? `已加载 ${live.length} 个品种` : "无持仓",
  }
  return {
    portfolios,
    products: [...state.products.filter((p) => p.portfolioId !== ALL_WEATHER_PORTFOLIO_ID), ...products],
    positions: [...state.positions.filter((p) => p.portfolioId !== ALL_WEATHER_PORTFOLIO_ID), ...positions],
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
    source: args.source,
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
