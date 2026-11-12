import { pickContractsByTenor } from "@/lib/all-weather/contract-tenor"
import {
  listedCffexBondContracts,
  listedCffexIndexContracts,
  isCffexContractExpired,
  CFFEX_BOND_PRODUCTS,
  CFFEX_INDEX_PRODUCTS,
} from "@/lib/client/cffex-expiry"
import { loadLiveStrategySnapshot } from "@/lib/all-weather/live-universe"
import type { ContractTenor } from "@/lib/all-weather/setup"
import { loadStrategySnapshot } from "@/lib/all-weather/universe"
import type { CtpTick } from "@/lib/client/ctp-market"
import { ctpMarketBaseUrl } from "@/lib/server/ctp-market-proxy"
import { fetchSinaFuturesQuotes } from "@/lib/server/sina-futures-hq"

const SINA_HQ = "https://hq.sinajs.cn/list="
const SINA_HEADERS = {
  Referer: "https://finance.sina.com.cn/",
  "User-Agent": "Mozilla/5.0",
}


const INDEX_ASSETS = new Set<string>(CFFEX_INDEX_PRODUCTS)
const BOND_ASSETS = new Set<string>(CFFEX_BOND_PRODUCTS)

export type AllWeatherPriceSource = "sina" | "ctp" | "eastmoney" | "snapshot"

export function isLiveAllWeatherPriceSource(source: string | null | undefined): boolean {
  return source === "sina" || source === "ctp" || source === "eastmoney"
}

/** Calendar front / following month even when Sina OI quotes are unavailable. */
export function calendarContractsForTenor(
  assets: string[],
  tenor: ContractTenor,
  now = new Date(),
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const asset of assets) {
    if (INDEX_ASSETS.has(asset)) {
      const listed = listedCffexIndexContracts(asset, now)
      const picked = tenor === "following" ? listed[3] ?? listed[2] : listed[0]
      if (picked) out[asset] = picked
      continue
    }
    if (BOND_ASSETS.has(asset)) {
      const listed = listedCffexBondContracts(asset, now)
      const picked = tenor === "following" ? listed[1] : listed[0]
      if (picked) out[asset] = picked
    }
  }
  return out
}

function dropExpiredContracts(contracts: Record<string, string>, now = new Date()) {
  const out: Record<string, string> = {}
  for (const [asset, contract] of Object.entries(contracts)) {
    if (contract && !isCffexContractExpired(contract, now)) out[asset] = contract
  }
  return out
}

function sinaContinuous(asset: string): string {
  return `nf_${asset}0`
}

function candidateMonths(from = new Date(), count = 14): string[] {
  const out: string[] = []
  const y = from.getFullYear()
  const m = from.getMonth() + 1
  for (let i = 0; i < count; i++) {
    const dt = new Date(y, m - 1 + i, 1)
    out.push(`${String(dt.getFullYear()).slice(2)}${String(dt.getMonth() + 1).padStart(2, "0")}`)
  }
  return out
}

export function normalizeListedContract(raw: string | null | undefined, asset: string): string | null {
  if (!raw) return null
  const s = String(raw).replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
  const m = s.match(/^([A-Z]+)(\d{3,4})$/)
  if (!m) return null
  const digits = m[2].length === 3 ? `2${m[2]}` : m[2]
  return `${m[1]}${digits}`
}

export function allWeatherHqSymbols(): string[] {
  const snapshot = loadLiveStrategySnapshot()
  const out: string[] = []
  const seen = new Set<string>()
  for (const spec of snapshot.specs) {
    const c = normalizeListedContract(spec.refContract, spec.asset)
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

function snapshotContracts(): Record<string, string> {
  const snapshot = loadLiveStrategySnapshot()
  const out: Record<string, string> = {}
  for (const spec of snapshot.specs) {
    const c = normalizeListedContract(spec.refContract, spec.asset)
    if (c) out[spec.asset] = c
  }
  return out
}

function parseContinuousPrices(body: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const line of body.split(";")) {
    const m = line.match(/hq_str_nf_([A-Z0-9]+)0="([^"]*)"/i)
    if (!m || !m[2]) continue
    const asset = m[1].toUpperCase()
    const fields = m[2].split(",")
    const first = Number(fields[0])
    const idxs = Number.isFinite(first) && first > 0 ? [3, 7, 8] : [8, 7, 6, 3]
    const price = idxs.map((i) => Number(fields[i])).find((n) => Number.isFinite(n) && n > 0)
    if (price != null) out[asset] = price
  }
  return out
}

type SpecificQuote = { contract: string; asset: string; price: number; oi: number }

function parseSpecificQuotes(body: string): SpecificQuote[] {
  const out: SpecificQuote[] = []
  const re = /hq_str_nf_([A-Z]+\d{4})="([^"]*)"/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(body))) {
    const contract = match[1].toUpperCase()
    if (!match[2]) continue
    const fields = match[2].split(",")
    const asset = contract.replace(/\d+$/, "")
    const first = Number(fields[0])
    const commodityStyle = !Number.isFinite(first) || first <= 0
    const priceIdxs = commodityStyle ? [8, 7, 6] : [3, 7]
    const price = priceIdxs.map((i) => Number(fields[i])).find((n) => Number.isFinite(n) && n > 0)
    const oi = commodityStyle ? Number(fields[13]) : Number(fields[6])
    if (price == null) continue
    out.push({
      contract,
      asset,
      price,
      oi: Number.isFinite(oi) ? oi : 0,
    })
  }
  return out
}

async function sinaList(codes: string[]): Promise<string> {
  const chunks: string[] = []
  for (let i = 0; i < codes.length; i += 80) {
    const res = await fetch(`${SINA_HQ}${codes.slice(i, i + 80).join(",")}`, {
      headers: SINA_HEADERS,
      cache: "no-store",
    })
    if (!res.ok) throw new Error(`sina ${res.status}`)
    chunks.push(Buffer.from(await res.arrayBuffer()).toString("latin1"))
  }
  return chunks.join("\n")
}

function tickLast(tick: CtpTick | undefined | null) {
  const n = tick?.last
  return n != null && Number.isFinite(n) && n > 0 ? n : null
}

/** Server-side CTP lasts for held contracts. Empty when ctp_market is down (typical on localhost). */
export async function fetchCtpContractLasts(contracts: string[]): Promise<Record<string, number>> {
  const wanted = new Set(contracts.map((c) => c.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()).filter(Boolean))
  if (!wanted.size) return {}
  try {
    const res = await fetch(`${ctpMarketBaseUrl()}/api/live`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    })
    if (!res.ok) return {}
    const json = (await res.json()) as {
      items?: Record<string, { tick?: CtpTick | null; last?: number | null }>
      quotes?: Record<string, CtpTick>
    }
    const out: Record<string, number> = {}
    const bags: Array<Record<string, unknown> | undefined> = [json.items, json.quotes]
    for (const bag of bags) {
      if (!bag) continue
      for (const [sym, item] of Object.entries(bag)) {
        const key = String(sym).replace(/[^a-zA-Z0-9]/g, "").toUpperCase()
        if (!wanted.has(key)) continue
        const raw = item && typeof item === "object" && "tick" in item ? (item as { tick?: CtpTick }).tick : item
        const last = tickLast(raw as CtpTick)
        if (last != null) out[key] = last
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Live ticks for the 全天候 book: Sina (+ Eastmoney book overlay), then CTP lasts.
 * Used by the page when the local ctp_market sidecar is down.
 */
export async function fetchAllWeatherLiveTicks(symbols: string[]): Promise<{
  quotes: Record<string, CtpTick>
  source: AllWeatherPriceSource
}> {
  const unique = [...new Set(symbols.map((s) => s.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()).filter(Boolean))]
  const quotes: Record<string, CtpTick> = {}
  let source: AllWeatherPriceSource = "snapshot"
  if (unique.length) {
    try {
      const sina = await fetchSinaFuturesQuotes(unique)
      for (const [sym, tick] of sina) {
        quotes[sym.toUpperCase()] = { ...tick, symbol: sym.toUpperCase() }
      }
      if (Object.values(quotes).some((t) => tickLast(t) != null)) source = "sina"
    } catch {
      // CTP may still cover index futures
    }
    const missing = unique.filter((s) => tickLast(quotes[s]) == null)
    if (missing.length) {
      const ctpLasts = await fetchCtpContractLasts(missing)
      for (const [sym, last] of Object.entries(ctpLasts)) {
        quotes[sym] = {
          ...(quotes[sym] ?? {
            symbol: sym,
            last,
            bid: null,
            ask: null,
            volume: null,
            open_interest: null,
            pre_close: null,
            pre_settlement: null,
            update_time: null,
            update_millis: null,
          }),
          symbol: sym,
          last,
        }
        if (source === "snapshot") source = "ctp"
      }
    }
  }
  return { quotes, source }
}

export async function fetchLiveFuturesPrices(
  assets: string[],
  tenor: ContractTenor = "current",
): Promise<{
  prices: Record<string, number>
  contracts: Record<string, string>
  source: AllWeatherPriceSource
  fetchedAt: string
  missing: string[]
}> {
  const snapshot = loadLiveStrategySnapshot()
  const fallbackPrices: Record<string, number> = {}
  for (const p of snapshot.positions) {
    if (p.price != null) fallbackPrices[p.asset] = p.price
  }
  const raw = loadStrategySnapshot()
  for (const p of raw.positions) {
    if (fallbackPrices[p.asset] == null && p.price != null) fallbackPrices[p.asset] = p.price
  }
  const fallbackContracts = snapshotContracts()
  const unique = [...new Set(assets.filter(Boolean))]
  const months = candidateMonths()
  const specificCodes = unique.flatMap((asset) => months.map((ym) => `nf_${asset}${ym}`))

  const empty = (source: AllWeatherPriceSource, prices: Record<string, number>, contracts: Record<string, string>, missing: string[]) => ({
    prices,
    contracts,
    source,
    fetchedAt: new Date().toISOString(),
    missing,
  })

  try {
    const [contBody, specBody] = await Promise.all([
      sinaList(unique.map(sinaContinuous)),
      sinaList(specificCodes),
    ])
    const parsedPrices = parseContinuousPrices(contBody)
    const specific = parseSpecificQuotes(specBody)
    const contracts = {
      ...fallbackContracts,
      ...pickContractsByTenor(specific, unique, tenor),
    }
    const byContract = new Map(specific.map((q) => [q.contract, q.price]))
    const prices: Record<string, number> = {}
    const missing: string[] = []
    for (const asset of unique) {
      const listed = contracts[asset]
      const specificPx = listed ? byContract.get(listed) : undefined
      if (specificPx != null) prices[asset] = specificPx
      else if (parsedPrices[asset] != null) prices[asset] = parsedPrices[asset]
      else missing.push(asset)
    }

    // Do not fill holes with the backtest snapshot. Try Sina-by-contract and CTP lasts instead.
    if (missing.length) {
      const wanted = missing.map((asset) => contracts[asset]).filter(Boolean)
      try {
        const ticks = await fetchSinaFuturesQuotes(wanted)
        const still: string[] = []
        for (const asset of missing) {
          const last = tickLast(ticks.get(contracts[asset]?.toUpperCase() ?? "") ?? ticks.get(contracts[asset] ?? ""))
          if (last != null) prices[asset] = last
          else still.push(asset)
        }
        missing.length = 0
        missing.push(...still)
      } catch {
        // keep missing for the CTP pass
      }
    }
    if (missing.length) {
      const ctpLasts = await fetchCtpContractLasts(missing.map((asset) => contracts[asset]).filter(Boolean))
      const still: string[] = []
      for (const asset of missing) {
        const last = ctpLasts[String(contracts[asset] || "").toUpperCase()]
        if (last != null) prices[asset] = last
        else still.push(asset)
      }
      missing.length = 0
      missing.push(...still)
    }

    const gotSina = Object.keys(parsedPrices).length > 0 || specific.length > 0
    const source: AllWeatherPriceSource =
      Object.keys(prices).length === 0 ? "snapshot" : gotSina ? "sina" : "ctp"
    return empty(source, prices, contracts, missing)
  } catch {
    // Bulk Sina list failed: try per-contract Sina/EM, then CTP, but never pretend snapshot is live.
    const contracts = { ...fallbackContracts }
    const prices: Record<string, number> = {}
    try {
      const ticks = await fetchSinaFuturesQuotes(Object.values(contracts).filter(Boolean))
      for (const asset of unique) {
        const last = tickLast(ticks.get(String(contracts[asset] || "").toUpperCase()))
        if (last != null) prices[asset] = last
      }
    } catch {
      // fall through to CTP
    }
    const missing = unique.filter((asset) => prices[asset] == null)
    if (missing.length) {
      const ctpLasts = await fetchCtpContractLasts(missing.map((asset) => contracts[asset]).filter(Boolean))
      for (const asset of missing) {
        const last = ctpLasts[String(contracts[asset] || "").toUpperCase()]
        if (last != null) prices[asset] = last
      }
    }
    const stillMissing = unique.filter((asset) => prices[asset] == null)
    const source: AllWeatherPriceSource =
      Object.keys(prices).length === 0 ? "snapshot" : unique.length - stillMissing.length > 0 && Object.keys(prices).length
        ? stillMissing.length === unique.length
          ? "snapshot"
          : "ctp"
        : "sina"
    const liveSource: AllWeatherPriceSource =
      Object.keys(prices).length === 0 ? "snapshot" : source === "snapshot" ? "ctp" : source
    // If we got any live prices after a bulk failure, prefer sina when fetchSina succeeded.
    const finalSource: AllWeatherPriceSource = Object.keys(prices).length === 0 ? "snapshot" : liveSource
    return empty(finalSource, prices, contracts, stillMissing)
  }
}
