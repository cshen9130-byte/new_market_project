import fs from "fs"
import path from "path"
import { LIVE_UNIVERSE_VERSION, loadLiveStrategySnapshot, universeKey } from "@/lib/all-weather/live-universe"
import type { ContractTenor } from "@/lib/all-weather/setup"
import {
  SLEEVE_KEYS,
  SLEEVE_LABELS,
  type SleeveKey,
  loadStrategySnapshot,
  type StrategySnapshot,
} from "@/lib/all-weather/universe"
import { fetchLiveFuturesPrices, normalizeListedContract } from "@/lib/server/all-weather-prices"
import { readAllWeatherSettings, type AllWeatherSettings } from "@/lib/server/all-weather-settings"

const DATA_DIR = path.join(process.cwd(), "data", "all-weather")
const BOOK_FILE = path.join(DATA_DIR, "book.json")

export type BookPosition = {
  asset: string
  label: string
  contract: string
  sleeve: SleeveKey
  lots: number
  price: number
  prevPrice: number
  multiplier: number
  marginRate: number
  targetWeight: number
  /** Model risk share from last rebalance; kept even if lots round to 0. */
  targetRiskShare: number
  /** Live risk share: 0 when no lots, otherwise the model target. */
  riskShare: number
  assetVol: number | null
  rawLots: number
  notional: number
  margin: number
  dailyPnl: number
  cumPnl: number
}

export type DailyRow = {
  date: string
  equity: number
  dailyPnl: number
  sleevePnl: Record<SleeveKey, number>
  productPnl: Record<string, number>
}

export type RebalanceSide = "开仓" | "加仓" | "减仓" | "平仓" | "移仓"

export type RebalanceTrade = {
  date: string
  asset: string
  label: string
  sleeve: SleeveKey
  prevContract: string
  contract: string
  prevLots: number
  newLots: number
  delta: number
  side: RebalanceSide
  price: number
  tradeNotional: number
}

export type PaperBook = {
  startedAt: string
  asOf: string
  initialCapital: number
  equity: number
  dailyPnl: number
  cumPnl: number
  priceSource: "sina" | "snapshot"
  pricesFetchedAt: string | null
  missingPrices: string[]
  positions: BookPosition[]
  daily: DailyRow[]
  lastRebalanceDate: string | null
  isRebalanceDay: boolean
  rebalanceTrades: RebalanceTrade[]
  contractTenor?: ContractTenor
  universeVersion?: number
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

function todayStamp(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function isMonthEndTradingDay(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number)
  if (!y || !m || !d) return false
  const last = new Date(y, m, 0)
  while (last.getDay() === 0 || last.getDay() === 6) {
    last.setDate(last.getDate() - 1)
  }
  return todayStamp(last) === dateStr
}

function rebalanceSide(prevLots: number, newLots: number, contractChanged: boolean): RebalanceSide | null {
  if (prevLots === 0 && newLots > 0) return "开仓"
  if (prevLots > 0 && newLots === 0) return "平仓"
  if (newLots > prevLots) return "加仓"
  if (newLots < prevLots) return "减仓"
  if (contractChanged) return "移仓"
  return null
}

function openingTrades(positions: BookPosition[], asOf: string): RebalanceTrade[] {
  return positions
    .filter((p) => p.lots > 0)
    .map((p) => ({
      date: asOf,
      asset: p.asset,
      label: p.label,
      sleeve: p.sleeve,
      prevContract: "",
      contract: p.contract,
      prevLots: 0,
      newLots: p.lots,
      delta: p.lots,
      side: "开仓" as const,
      price: p.price,
      tradeNotional: p.lots * p.price * p.multiplier,
    }))
}

function applyMonthEndRebalance(
  book: PaperBook,
  snapshot: StrategySnapshot,
  prices: Record<string, number>,
  contracts: Record<string, string> | undefined,
  asOf: string,
): PaperBook {
  if (book.lastRebalanceDate == null) {
    book = {
      ...book,
      lastRebalanceDate: book.startedAt,
      rebalanceTrades: book.rebalanceTrades?.length ? book.rebalanceTrades : openingTrades(book.positions, book.startedAt),
      isRebalanceDay: book.startedAt === asOf,
    }
  }
  if (book.lastRebalanceDate === asOf) {
    return { ...book, isRebalanceDay: (book.rebalanceTrades?.length ?? 0) > 0 }
  }
  if (!isMonthEndTradingDay(asOf)) {
    return { ...book, isRebalanceDay: false }
  }

  const trades: RebalanceTrade[] = []
  const positions = book.positions.map((p) => {
    const src = snapshot.positions.find((s) => s.asset === p.asset)
    const price = prices[p.asset] ?? p.price
    const targetWeight = src?.targetWeight ?? p.targetWeight
    const newLots = sizeLots(targetWeight, book.equity, price, p.multiplier)
    const newContract = contracts?.[p.asset] || p.contract
    const side = rebalanceSide(p.lots, newLots, Boolean(newContract && p.contract && newContract !== p.contract))
    if (side) {
      trades.push({
        date: asOf,
        asset: p.asset,
        label: p.label,
        sleeve: p.sleeve,
        prevContract: p.contract,
        contract: newContract,
        prevLots: p.lots,
        newLots,
        delta: newLots - p.lots,
        side,
        price,
        tradeNotional: Math.abs(newLots - p.lots) * price * p.multiplier,
      })
    }
    const targetRiskShare = src?.riskShare ?? p.targetRiskShare
    return markPosition(
      {
        ...p,
        lots: newLots,
        rawLots: newLots,
        contract: newContract,
        price,
        targetWeight,
        targetRiskShare,
        riskShare: newLots > 0 ? targetRiskShare : 0,
      },
      snapshot.brokerMarginMult,
    )
  })

  return {
    ...book,
    positions,
    lastRebalanceDate: asOf,
    isRebalanceDay: trades.length > 0,
    rebalanceTrades: trades,
  }
}

function sizeLots(targetWeight: number, capital: number, price: number, multiplier: number): number {
  if (!price || !multiplier || !Number.isFinite(targetWeight)) return 0
  return Math.max(0, Math.round((targetWeight * capital) / (price * multiplier)))
}

function markPosition(
  pos: Omit<BookPosition, "notional" | "margin" | "dailyPnl"> & { dailyPnl?: number },
  brokerMarginMult: number,
): BookPosition {
  const notional = pos.lots * pos.price * pos.multiplier
  const margin = notional * pos.marginRate * brokerMarginMult
  const dailyPnl = pos.dailyPnl ?? pos.lots * (pos.price - pos.prevPrice) * pos.multiplier
  return { ...pos, notional, margin, dailyPnl }
}

function emptySleevePnl(): Record<SleeveKey, number> {
  return { Equity: 0, Bonds: 0, Gold: 0, Commodity: 0 }
}

function buildPositions(
  snapshot: StrategySnapshot,
  prices: Record<string, number>,
  capital: number,
  prevByAsset?: Map<string, BookPosition>,
  contracts?: Record<string, string>,
): BookPosition[] {
  return snapshot.positions.map((src) => {
    const prev = prevByAsset?.get(src.asset)
    const price = prices[src.asset] ?? src.price ?? 0
    const prevPrice = prev?.price ?? price
    const rawLots = prev?.rawLots ?? sizeLots(src.targetWeight, capital, price, src.multiplier)
    const lots = prev?.lots ?? rawLots
    const targetRiskShare = src.riskShare ?? 0
    const spec = snapshot.specs.find((s) => s.asset === src.asset)
    const contract =
      contracts?.[src.asset] ||
      prev?.contract ||
      normalizeListedContract(spec?.refContract, src.asset) ||
      src.asset
    return markPosition(
      {
        asset: src.asset,
        label: src.label,
        contract,
        sleeve: src.sleeve as SleeveKey,
        lots,
        price,
        prevPrice,
        multiplier: src.multiplier,
        marginRate: src.marginRate,
        targetWeight: src.targetWeight,
        targetRiskShare,
        riskShare: lots > 0 ? targetRiskShare : 0,
        assetVol: src.assetVol ?? null,
        rawLots,
        cumPnl: prev?.cumPnl ?? 0,
        dailyPnl: prev ? lots * (price - prev.price) * src.multiplier : 0,
      },
      snapshot.brokerMarginMult,
    )
  })
}

function applyDay(book: PaperBook, positions: BookPosition[], asOf: string, priceSource: PaperBook["priceSource"], fetchedAt: string, missing: string[]): PaperBook {
  const sleevePnl = emptySleevePnl()
  const productPnl: Record<string, number> = {}
  let dailyPnl = 0
  const nextPositions = positions.map((p) => {
    dailyPnl += p.dailyPnl
    sleevePnl[p.sleeve] += p.dailyPnl
    productPnl[p.asset] = p.dailyPnl
    return { ...p, cumPnl: p.cumPnl + p.dailyPnl }
  })
  const equity = book.equity + dailyPnl
  const daily = book.daily.filter((r) => r.date !== asOf)
  daily.push({ date: asOf, equity, dailyPnl, sleevePnl, productPnl })
  daily.sort((a, b) => a.date.localeCompare(b.date))
  return {
    ...book,
    asOf,
    equity,
    dailyPnl,
    cumPnl: equity - book.initialCapital,
    priceSource,
    pricesFetchedAt: fetchedAt,
    missingPrices: missing,
    positions: nextPositions,
    daily,
    lastRebalanceDate: book.lastRebalanceDate ?? null,
    isRebalanceDay: book.isRebalanceDay ?? false,
    rebalanceTrades: book.rebalanceTrades ?? [],
  }
}

function initBook(snapshot: StrategySnapshot, prices: Record<string, number>, asOf: string, priceSource: PaperBook["priceSource"], fetchedAt: string, missing: string[], contracts?: Record<string, string>, tenor?: ContractTenor): PaperBook {
  const capital = snapshot.initialCapital
  const positions = buildPositions(snapshot, prices, capital, undefined, contracts).map((p) => ({
    ...p,
    prevPrice: p.price,
    dailyPnl: 0,
    cumPnl: 0,
  }))
  return {
    startedAt: asOf,
    asOf,
    initialCapital: capital,
    equity: capital,
    dailyPnl: 0,
    cumPnl: 0,
    priceSource,
    pricesFetchedAt: fetchedAt,
    missingPrices: missing,
    positions,
    lastRebalanceDate: asOf,
    isRebalanceDay: true,
    rebalanceTrades: openingTrades(positions, asOf),
    contractTenor: tenor,
    universeVersion: LIVE_UNIVERSE_VERSION,
    daily: [
      {
        date: asOf,
        equity: capital,
        dailyPnl: 0,
        sleevePnl: emptySleevePnl(),
        productPnl: Object.fromEntries(positions.map((p) => [p.asset, 0])),
      },
    ],
  }
}

export function readPaperBook(): PaperBook | null {
  if (!fs.existsSync(BOOK_FILE)) return null
  try {
    return JSON.parse(fs.readFileSync(BOOK_FILE, "utf-8")) as PaperBook
  } catch {
    return null
  }
}

const ALWAYS_ON_INDEX = new Set(["IF", "IH", "IC", "IM"])

/** Held 全天候 contracts that are not on the always-on 股指 CTP feed. */
export function allWeatherWatchContracts(extra: string[] = []): string[] {
  const book = readPaperBook()
  const merged = [
    ...(book?.positions ?? [])
      .filter((p) => (p.lots || 0) > 0 && p.contract)
      .map((p) => String(p.contract).replace(/[^a-zA-Z0-9]/g, "").toUpperCase()),
    ...extra.map((s) => String(s || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase()),
  ]
  const out: string[] = []
  const seen = new Set<string>()
  for (const symbol of merged) {
    if (!/^[A-Z]{1,3}\d{3,4}$/.test(symbol) || seen.has(symbol)) continue
    if (ALWAYS_ON_INDEX.has(symbol.replace(/\d+$/, ""))) continue
    seen.add(symbol)
    out.push(symbol)
  }
  return out
}

function writePaperBook(book: PaperBook) {
  ensureDir()
  fs.writeFileSync(BOOK_FILE, JSON.stringify(book, null, 2), "utf-8")
}

export type SleeveView = {
  sleeve: SleeveKey
  label: string
  lots: number
  notional: number
  margin: number
  riskShare: number
  dailyPnl: number
  cumPnl: number
  products: BookPosition[]
}

export type OverviewPayload = {
  strategy: {
    name: string
    method: string
    universe: string
    backtestStart: string
    backtestEnd: string
    lastRebalance: string
    volTarget: number
    volMandate: number
    riskBudgetHub: number
    budgetLo: number
    budgetHi: number
    summary: StrategySnapshot["summary"]
    sleeveBacktest: StrategySnapshot["sleeveBacktest"]
    lastBudget: StrategySnapshot["lastBudget"]
  }
  settings: AllWeatherSettings
  book: PaperBook
  isRebalanceDay: boolean
  rebalanceTrades: RebalanceTrade[]
  sleeves: SleeveView[]
  totals: {
    lots: number
    notional: number
    margin: number
    marginUtil: number
    riskShare: number
  }
}

function normalizePosition(p: BookPosition): BookPosition {
  const targetRiskShare = p.targetRiskShare ?? p.riskShare ?? 0
  const snapshot = loadLiveStrategySnapshot()
  const spec = snapshot.specs.find((s) => s.asset === p.asset)
  return {
    ...p,
    contract: p.contract || normalizeListedContract(spec?.refContract, p.asset) || p.asset,
    rawLots: p.rawLots ?? p.lots,
    targetRiskShare,
    riskShare: p.lots > 0 ? targetRiskShare : 0,
    notional: p.lots * p.price * p.multiplier,
    margin: p.lots > 0 ? p.margin : 0,
  }
}

function sleeveViews(positions: BookPosition[]): SleeveView[] {
  return SLEEVE_KEYS.map((sleeve) => {
    const products = positions.filter((p) => p.sleeve === sleeve)
    return {
      sleeve,
      label: SLEEVE_LABELS[sleeve],
      lots: products.reduce((s, p) => s + p.lots, 0),
      notional: products.reduce((s, p) => s + p.notional, 0),
      margin: products.reduce((s, p) => s + p.margin, 0),
      riskShare: products.reduce((s, p) => s + p.riskShare, 0),
      dailyPnl: products.reduce((s, p) => s + p.dailyPnl, 0),
      cumPnl: products.reduce((s, p) => s + p.cumPnl, 0),
      products,
    }
  })
}

function toOverview(book: PaperBook): OverviewPayload {
  const snapshot = loadStrategySnapshot()
  const live = loadLiveStrategySnapshot()
  const settings = readAllWeatherSettings()
  if (book.lastRebalanceDate == null && book.startedAt === book.asOf) {
    book = {
      ...book,
      lastRebalanceDate: book.startedAt,
      isRebalanceDay: true,
      rebalanceTrades: book.rebalanceTrades?.length ? book.rebalanceTrades : openingTrades(book.positions, book.startedAt),
    }
  }
  const positions = book.positions.map(normalizePosition)
  book = { ...book, positions }
  const sleeves = sleeveViews(positions)
  const notional = book.positions.reduce((s, p) => s + p.notional, 0)
  const margin = book.positions.reduce((s, p) => s + p.margin, 0)
  return {
    strategy: {
      name: snapshot.name,
      method: snapshot.method,
      universe: live.universe,
      backtestStart: snapshot.backtestStart,
      backtestEnd: snapshot.backtestEnd,
      lastRebalance: snapshot.lastRebalance,
      volTarget: snapshot.volTarget,
      volMandate: snapshot.volMandate,
      riskBudgetHub: snapshot.riskBudgetHub,
      budgetLo: snapshot.budgetLo,
      budgetHi: snapshot.budgetHi,
      summary: snapshot.summary,
      sleeveBacktest: snapshot.sleeveBacktest,
      lastBudget: live.lastBudget,
    },
    settings,
    book,
    isRebalanceDay: Boolean(book.isRebalanceDay && book.lastRebalanceDate === book.asOf),
    rebalanceTrades: book.rebalanceTrades ?? [],
    sleeves,
    totals: {
      lots: book.positions.reduce((s, p) => s + p.lots, 0),
      notional,
      margin,
      marginUtil: book.equity > 0 ? margin / book.equity : 0,
      riskShare: book.positions.reduce((s, p) => s + p.riskShare, 0),
    },
  }
}

function bookNeedsRebuild(book: PaperBook, snapshot: StrategySnapshot, tenor: ContractTenor): boolean {
  if (book.universeVersion != null && book.universeVersion !== LIVE_UNIVERSE_VERSION) return true
  if (book.contractTenor && book.contractTenor !== tenor) return true
  return universeKey(book.positions) !== universeKey(snapshot.positions)
}

export async function refreshPaperBook(opts?: { reset?: boolean }): Promise<OverviewPayload> {
  const snapshot = loadLiveStrategySnapshot()
  const settings = readAllWeatherSettings()
  const assets = snapshot.positions.map((p) => p.asset)
  const quotes = await fetchLiveFuturesPrices(assets, settings.contractTenor)
  const asOf = todayStamp()
  const existing = opts?.reset ? null : readPaperBook()
  const stale = existing && bookNeedsRebuild(existing, snapshot, settings.contractTenor)

  let book: PaperBook
  if (!existing || stale) {
    book = initBook(
      snapshot,
      quotes.prices,
      asOf,
      quotes.source,
      quotes.fetchedAt,
      quotes.missing,
      quotes.contracts,
      settings.contractTenor,
    )
  } else if (existing.asOf === asOf) {
    const prevMap = new Map(existing.positions.map((p) => [p.asset, p]))
    const positions = buildPositions(snapshot, quotes.prices, existing.initialCapital, prevMap, quotes.contracts).map((p) => {
      const prev = prevMap.get(p.asset)
      const base = prev?.prevPrice ?? p.prevPrice
      const dailyPnl = p.lots * (p.price - base) * p.multiplier
      return markPosition(
        {
          ...p,
          prevPrice: base,
          dailyPnl,
          cumPnl: (prev?.cumPnl ?? 0) - (prev?.dailyPnl ?? 0),
        },
        snapshot.brokerMarginMult,
      )
    })
    const sleevePnl = emptySleevePnl()
    const productPnl: Record<string, number> = {}
    let dailyPnl = 0
    const nextPositions = positions.map((p) => {
      dailyPnl += p.dailyPnl
      sleevePnl[p.sleeve] += p.dailyPnl
      productPnl[p.asset] = p.dailyPnl
      return { ...p, cumPnl: p.cumPnl + p.dailyPnl }
    })
    const equity = existing.initialCapital + nextPositions.reduce((s, p) => s + p.cumPnl, 0)
    const daily = existing.daily.filter((r) => r.date !== asOf)
    daily.push({ date: asOf, equity, dailyPnl, sleevePnl, productPnl })
    daily.sort((a, b) => a.date.localeCompare(b.date))
    book = {
      ...existing,
      asOf,
      equity,
      dailyPnl,
      cumPnl: equity - existing.initialCapital,
      priceSource: quotes.source,
      pricesFetchedAt: quotes.fetchedAt,
      missingPrices: quotes.missing,
      positions: nextPositions,
      daily,
      contractTenor: settings.contractTenor,
      universeVersion: LIVE_UNIVERSE_VERSION,
    }
  } else {
    const prevMap = new Map(existing.positions.map((p) => [p.asset, p]))
    const positions = buildPositions(snapshot, quotes.prices, existing.initialCapital, prevMap, quotes.contracts)
    book = applyDay(existing, positions, asOf, quotes.source, quotes.fetchedAt, quotes.missing)
    book.contractTenor = settings.contractTenor
    book.universeVersion = LIVE_UNIVERSE_VERSION
  }

  book = applyMonthEndRebalance(book, snapshot, quotes.prices, quotes.contracts, asOf)
  writePaperBook(book)
  return toOverview(book)
}

export async function getOverview(refresh = false): Promise<OverviewPayload> {
  const book = readPaperBook()
  const live = loadLiveStrategySnapshot()
  const settings = readAllWeatherSettings()
  if (
    refresh ||
    !book ||
    book.positions.some((p) => !p.contract) ||
    bookNeedsRebuild(book, live, settings.contractTenor)
  ) {
    return refreshPaperBook()
  }
  return toOverview(book)
}

export function resetPaperBook(): void {
  if (fs.existsSync(BOOK_FILE)) fs.unlinkSync(BOOK_FILE)
}
