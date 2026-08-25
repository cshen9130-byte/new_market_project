import {
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
import { isLiveSessionFor, quoteOf, validMark } from "@/lib/client/market-hours"
import { productOfSymbol } from "@/lib/client/pro-trading"

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

export function fmtNav(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "--"
  return `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`
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
  if (!isLiveSessionFor(key)) return extra ?? settle ?? hist
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
