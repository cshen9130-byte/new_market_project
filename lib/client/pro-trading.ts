import { assetFromContract } from "@/lib/all-weather/universe"
import {
  INDEX_FUTURES,
  type CtpTick,
  type IndexProduct,
  pickMostActiveContract,
} from "@/lib/client/ctp-market"

const LISTED_FUTURES = /^[A-Z]{1,3}\d{3,4}$/

export function productOfSymbol(symbol: string): IndexProduct | null {
  const code = symbol.slice(0, 2).toUpperCase()
  if (code === "IH" || code === "IF" || code === "IC" || code === "IM") return code
  return null
}

export function resolveSymbolInput(
  raw: string,
  symbols: string[],
  quotes: Record<string, CtpTick>,
): string | null {
  const q = raw.trim().toUpperCase()
  if (!q) return null
  const exact = symbols.find((s) => s.toUpperCase() === q)
  if (exact) return exact
  if (LISTED_FUTURES.test(q)) return q
  const byName = INDEX_FUTURES.find((item) => item.product === q || item.name.includes(raw.trim()))
  if (byName) return pickMostActiveContract(symbols, byName.product, quotes)
  const byAsset = symbols.find((s) => assetFromContract(s) === q)
  if (byAsset) return byAsset
  const starts = symbols.filter((s) => s.toUpperCase().startsWith(q)).sort()
  if (starts.length) return starts[0]
  const contains = symbols.filter((s) => s.toUpperCase().includes(q))
  return contains[0] || null
}
