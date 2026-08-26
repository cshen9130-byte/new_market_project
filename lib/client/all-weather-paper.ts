import type { ContractTenor } from "@/lib/all-weather/setup"
import { isSleeveKey, SLEEVE_KEYS, type SleeveKey } from "@/lib/all-weather/universe"
import { authService } from "@/lib/auth"
import type { AllWeatherHolding } from "@/lib/client/paper-trading"

function openedAtMs(ymd: string) {
  const [y, m, d] = String(ymd || "").split("-").map(Number)
  if (!y || !m || !d) return Date.now()
  const stamp = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T09:00:00+08:00`
  const ms = Date.parse(stamp)
  return Number.isFinite(ms) ? ms : Date.now()
}

export type AllWeatherTradeMark = {
  contract: string
  date: string
  side: string
  price: number
  lots: number
}

export type AllWeatherDailyNav = {
  date: string
  equity: number
  dailyPnl: number
  sleevePnl: Record<SleeveKey, number>
  productPnl: Record<string, number>
}

export type AllWeatherSleevePnl = {
  dailyPnl: number
  cumPnl: number
}

export type AllWeatherBookMeta = {
  name: string
  asOf: string
  startedAt: string
  equity: number
  dailyPnl: number
  cumPnl: number
  initialCapital: number
  lastBudget: Record<string, number>
  contractTenor: ContractTenor
  trades: AllWeatherTradeMark[]
  daily: AllWeatherDailyNav[]
  /** Yesterday's settlement (or book prevPrice) per contract, for live daily P/L. */
  prevMarks: Record<string, number>
  /** Book's last close per contract. Not the live extraMarks cache. */
  bookMarks: Record<string, number>
  sleeves: Record<SleeveKey, AllWeatherSleevePnl>
  positions: Record<string, AllWeatherSleevePnl & { sleeve: string }>
}

type AwPosition = {
  contract?: string
  asset?: string
  label?: string
  sleeve?: string
  lots?: number
  price?: number
  prevPrice?: number
  multiplier?: number
  dailyPnl?: number
  cumPnl?: number
}

type AwResponse = {
  ok?: boolean
  error?: string
  strategy?: { name?: string; lastBudget?: Record<string, number> }
  settings?: { contractTenor?: ContractTenor }
  book?: {
    asOf?: string
    startedAt?: string
    equity?: number
    dailyPnl?: number
    cumPnl?: number
    initialCapital?: number
    positions?: AwPosition[]
    daily?: Array<{
      date?: string
      equity?: number
      dailyPnl?: number
      sleevePnl?: Record<string, number>
      productPnl?: Record<string, number>
    }>
  }
  sleeves?: Array<{ sleeve?: string; dailyPnl?: number; cumPnl?: number }>
  rebalanceTrades?: Array<{
    date?: string
    contract?: string
    prevContract?: string
    side?: string
    price?: number
    delta?: number
    newLots?: number
    prevLots?: number
  }>
}

function headers(): Record<string, string> {
  const user = authService.getCurrentUser()
  return user ? { "x-market-user-id": user.id, "Content-Type": "application/json" } : { "Content-Type": "application/json" }
}

export async function fetchAllWeatherOverview(refresh = false) {
  const res = await fetch(`/api/all-weather${refresh ? "?refresh=1" : ""}`, {
    headers: headers(),
    cache: "no-store",
  })
  const data = (await res.json()) as AwResponse
  if (!res.ok || data.ok === false) throw new Error(data.error || `加载失败 ${res.status}`)
  const positions = data.book?.positions || []
  const startedAt = data.book?.startedAt || data.book?.asOf || ""
  const trades: AllWeatherTradeMark[] = (data.rebalanceTrades || [])
    .filter((t) => t.contract && t.date)
    .map((t) => ({
      contract: String(t.contract).toUpperCase(),
      date: String(t.date),
      side: String(t.side || "开仓"),
      price: Number(t.price) || 0,
      lots: Math.abs(Number(t.delta ?? (t.newLots || 0) - (t.prevLots || 0))),
    }))
  const holdings: AllWeatherHolding[] = positions
    .filter((p) => (p.lots || 0) > 0 && p.contract && (p.price || 0) > 0)
    .map((p) => {
      const contract = String(p.contract).toUpperCase()
      const openTrade = trades.find((t) => t.contract === contract && (t.side === "开仓" || t.side === "加仓"))
      return {
        contract,
        asset: String(p.asset || "").toUpperCase(),
        label: p.label || String(p.contract),
        sleeve: p.sleeve || "Commodity",
        lots: Number(p.lots),
        price: Number(p.price),
        prevPrice: Number(p.prevPrice || p.price),
        multiplier: Number(p.multiplier) || 0,
        openedAt: openedAtMs(openTrade?.date || startedAt),
        dailyPnl: Number(p.dailyPnl) || 0,
        cumPnl: Number(p.cumPnl) || 0,
      }
    })
  const marks: Record<string, number> = {}
  const prevMarks: Record<string, number> = {}
  const positionBooks: AllWeatherBookMeta["positions"] = {}
  for (const h of holdings) {
    marks[h.contract] = h.price
    prevMarks[h.contract] = h.prevPrice > 0 ? h.prevPrice : h.price
    positionBooks[h.contract] = {
      sleeve: h.sleeve,
      dailyPnl: h.dailyPnl ?? 0,
      cumPnl: h.cumPnl ?? 0,
    }
  }
  const sleeves = Object.fromEntries(SLEEVE_KEYS.map((key) => [key, { dailyPnl: 0, cumPnl: 0 }])) as Record<
    SleeveKey,
    AllWeatherSleevePnl
  >
  for (const row of data.sleeves || []) {
    if (!isSleeveKey(row.sleeve)) continue
    sleeves[row.sleeve] = { dailyPnl: Number(row.dailyPnl) || 0, cumPnl: Number(row.cumPnl) || 0 }
  }
  if (!data.sleeves?.length) {
    for (const h of holdings) {
      if (!isSleeveKey(h.sleeve)) continue
      sleeves[h.sleeve].dailyPnl += h.dailyPnl ?? 0
      sleeves[h.sleeve].cumPnl += h.cumPnl ?? 0
    }
  }
  const meta: AllWeatherBookMeta = {
    name: data.strategy?.name || "全天候策略",
    asOf: data.book?.asOf || "",
    startedAt,
    equity: data.book?.equity ?? 0,
    dailyPnl: data.book?.dailyPnl ?? 0,
    cumPnl: data.book?.cumPnl ?? 0,
    initialCapital: data.book?.initialCapital ?? 20_000_000,
    lastBudget: data.strategy?.lastBudget || {},
    contractTenor: data.settings?.contractTenor === "following" ? "following" : "current",
    trades,
    daily: (data.book?.daily || [])
      .filter((row) => row.date && Number.isFinite(Number(row.equity)))
      .map((row) => ({
        date: String(row.date),
        equity: Number(row.equity),
        dailyPnl: Number(row.dailyPnl) || 0,
        sleevePnl: Object.fromEntries(
          SLEEVE_KEYS.map((key) => [key, Number(row.sleevePnl?.[key]) || 0]),
        ) as Record<SleeveKey, number>,
        productPnl: Object.fromEntries(
          Object.entries(row.productPnl || {}).map(([asset, pnl]) => [String(asset).toUpperCase(), Number(pnl) || 0]),
        ),
      })),
    prevMarks,
    bookMarks: marks,
    sleeves,
    positions: positionBooks,
  }
  return { holdings, marks, meta }
}

export async function saveAllWeatherSetup(contractTenor: ContractTenor) {
  const res = await fetch("/api/all-weather", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ action: "setup", contractTenor }),
  })
  const data = (await res.json()) as AwResponse
  if (!res.ok || data.ok === false) throw new Error(data.error || `设置失败 ${res.status}`)
  return fetchAllWeatherOverview()
}
