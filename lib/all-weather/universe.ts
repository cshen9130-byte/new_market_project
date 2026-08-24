import snapshot from "./strategy-snapshot.json"

export const IM_SPEC = {
  asset: "IM",
  refContract: "IM2609",
  refPrice: 7000,
  multiplier: 200,
  marginRate: 0.12,
  feeOpen: 36.2,
  feeClose: 36.2,
}

export const SLEEVE_KEYS = ["Equity", "Bonds", "Gold", "Commodity"] as const
export type SleeveKey = (typeof SLEEVE_KEYS)[number]

export const SLEEVE_LABELS: Record<SleeveKey, string> = {
  Equity: "权益",
  Bonds: "债券",
  Gold: "黄金",
  Commodity: "商品",
}

export const SLEEVE_COLORS: Record<SleeveKey, string> = {
  Equity: "#2563eb",
  Bonds: "#0f766e",
  Gold: "#ca8a04",
  Commodity: "#c2410c",
}

export type SnapshotPosition = (typeof snapshot.positions)[number]
export type StrategySnapshot = typeof snapshot

export function loadStrategySnapshot(): StrategySnapshot {
  return snapshot
}

export function isSleeveKey(value: string): value is SleeveKey {
  return (SLEEVE_KEYS as readonly string[]).includes(value)
}

export function sleeveFromContract(symbol: string): SleeveKey | null {
  const asset = assetFromContract(symbol)
  if (!asset) return null
  if (asset === "IF" || asset === "IH" || asset === "IC" || asset === "IM") return "Equity"
  if (asset === "AU") return "Gold"
  if (asset === "T" || asset === "TF" || asset === "TS" || asset === "TL") return "Bonds"
  const pos = snapshot.positions.find((item) => item.asset === asset)
  if (pos && isSleeveKey(pos.sleeve)) return pos.sleeve
  return "Commodity"
}

const ASSETS_BY_LEN = [...new Set([...snapshot.specs.map((s) => s.asset), IM_SPEC.asset])].sort(
  (a, b) => b.length - a.length,
)

export function assetFromContract(symbol: string) {
  const u = symbol.trim().toUpperCase()
  if (!u) return null
  return ASSETS_BY_LEN.find((asset) => u === asset || (u.startsWith(asset) && /^\d/.test(u.slice(asset.length)))) || null
}

export function specForAsset(asset: string) {
  const code = asset.toUpperCase()
  if (code === IM_SPEC.asset) return IM_SPEC
  return snapshot.specs.find((s) => s.asset.toUpperCase() === code) || null
}

export function multiplierForContract(symbol: string) {
  const asset = assetFromContract(symbol)
  const spec = asset ? specForAsset(asset) : null
  return spec?.multiplier ?? null
}

const INDEX_MARGIN_FALLBACK: Record<string, number> = {
  IF: 0.12,
  IH: 0.12,
  IC: 0.12,
  IM: 0.12,
}

export function marginRateForContract(symbol: string) {
  const asset = assetFromContract(symbol)
  const spec = asset ? specForAsset(asset) : null
  if (spec?.marginRate && spec.marginRate > 0) return spec.marginRate
  const prefix = (symbol.replace(/\d+$/i, "") || symbol).toUpperCase()
  return INDEX_MARGIN_FALLBACK[prefix] ?? null
}

export function brokerMarginMultiplier() {
  const n = snapshot.brokerMarginMult
  return typeof n === "number" && n > 0 ? n : 1
}

/** 黄金 AU + AU2610 → 黄金 AU2610 */
export function displayListedName(label: string, contract?: string | null): string {
  if (!contract) return label
  const zh = label.replace(/\s+[A-Z]{1,3}$/, "").trim()
  return zh ? `${zh} ${contract}` : contract
}
