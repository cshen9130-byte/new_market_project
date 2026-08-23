import { pickContractsByTenor } from "@/lib/all-weather/contract-tenor"
import { loadLiveStrategySnapshot } from "@/lib/all-weather/live-universe"
import type { ContractTenor } from "@/lib/all-weather/setup"
import { loadStrategySnapshot } from "@/lib/all-weather/universe"

const SINA_HQ = "https://hq.sinajs.cn/list="
const SINA_HEADERS = {
  Referer: "https://finance.sina.com.cn/",
  "User-Agent": "Mozilla/5.0",
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

export async function fetchLiveFuturesPrices(
  assets: string[],
  tenor: ContractTenor = "current",
): Promise<{
  prices: Record<string, number>
  contracts: Record<string, string>
  source: "sina" | "snapshot"
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
      else if (fallbackPrices[asset] != null) {
        prices[asset] = fallbackPrices[asset]
        missing.push(asset)
      } else {
        missing.push(asset)
      }
    }
    return {
      prices,
      contracts,
      source: Object.keys(parsedPrices).length > 0 || specific.length > 0 ? "sina" : "snapshot",
      fetchedAt: new Date().toISOString(),
      missing,
    }
  } catch {
    return {
      prices: fallbackPrices,
      contracts: fallbackContracts,
      source: "snapshot",
      fetchedAt: new Date().toISOString(),
      missing: unique.filter((a) => fallbackPrices[a] == null),
    }
  }
}
