import type { ContractTenor } from "@/lib/all-weather/setup"
import { authService } from "@/lib/auth"
import type { AllWeatherHolding } from "@/lib/client/paper-trading"

export type AllWeatherBookMeta = {
  name: string
  asOf: string
  equity: number
  dailyPnl: number
  cumPnl: number
  initialCapital: number
  lastBudget: Record<string, number>
  contractTenor: ContractTenor
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
}

type AwResponse = {
  ok?: boolean
  error?: string
  strategy?: { name?: string; lastBudget?: Record<string, number> }
  settings?: { contractTenor?: ContractTenor }
  book?: {
    asOf?: string
    equity?: number
    dailyPnl?: number
    cumPnl?: number
    initialCapital?: number
    positions?: AwPosition[]
  }
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
  const holdings: AllWeatherHolding[] = positions
    .filter((p) => (p.lots || 0) > 0 && p.contract && (p.price || 0) > 0)
    .map((p) => ({
      contract: String(p.contract).toUpperCase(),
      asset: String(p.asset || "").toUpperCase(),
      label: p.label || String(p.contract),
      sleeve: p.sleeve || "Commodity",
      lots: Number(p.lots),
      price: Number(p.price),
      prevPrice: Number(p.prevPrice || p.price),
      multiplier: Number(p.multiplier) || 0,
    }))
  const marks: Record<string, number> = {}
  for (const h of holdings) marks[h.contract] = h.price
  const meta: AllWeatherBookMeta = {
    name: data.strategy?.name || "全天候策略",
    asOf: data.book?.asOf || "",
    equity: data.book?.equity ?? 0,
    dailyPnl: data.book?.dailyPnl ?? 0,
    cumPnl: data.book?.cumPnl ?? 0,
    initialCapital: data.book?.initialCapital ?? 20_000_000,
    lastBudget: data.strategy?.lastBudget || {},
    contractTenor: data.settings?.contractTenor === "following" ? "following" : "current",
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
