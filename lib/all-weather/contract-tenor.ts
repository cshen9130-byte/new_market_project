import type { ContractTenor } from "@/lib/all-weather/setup"
import {
  CFFEX_BOND_PRODUCTS,
  CFFEX_INDEX_PRODUCTS,
  listedCffexBondContracts,
  listedCffexIndexContracts,
} from "@/lib/client/cffex-expiry"

const INDEX = new Set<string>(CFFEX_INDEX_PRODUCTS)
const BONDS = new Set<string>(CFFEX_BOND_PRODUCTS)

export type RankedQuote = {
  contract: string
  asset: string
  price: number
  oi: number
}

export function pickAssetContract(
  asset: string,
  quotes: RankedQuote[],
  tenor: ContractTenor,
  now = new Date(),
): string | null {
  if (INDEX.has(asset)) {
    const listed = listedCffexIndexContracts(asset, now)
    return (tenor === "following" ? listed[3] ?? listed[2] : listed[0]) ?? listed[0] ?? null
  }
  if (BONDS.has(asset)) {
    const listed = listedCffexBondContracts(asset, now)
    return (tenor === "following" ? listed[1] : listed[0]) ?? listed[0] ?? null
  }
  const ranked = quotes.filter((q) => q.asset === asset).sort((a, b) => b.oi - a.oi)
  if (!ranked.length) return null
  return tenor === "following" ? ranked[1]?.contract ?? ranked[0].contract : ranked[0].contract
}

export function pickContractsByTenor(
  quotes: RankedQuote[],
  assets: string[],
  tenor: ContractTenor,
  now = new Date(),
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const asset of assets) {
    const picked = pickAssetContract(asset, quotes, tenor, now)
    if (picked) out[asset] = picked
  }
  return out
}
