export const NHCI_SYMBOL = "NHCI"
export const NHCI_CODE = "NHCI.NH"
export const NHCI_NAME = "南华商品指数"

export function isNhciSymbol(raw?: string | null) {
  const q = String(raw || "").trim().toUpperCase().replace(/\s+/g, "")
  if (!q) return false
  if (q === NHCI_SYMBOL || q === NHCI_CODE || q === "NHCI.NH") return true
  const compact = q.replace(/[.\-_]/g, "")
  return compact === "NHCI" || compact === "NHCINH"
}

export function looksLikeNhciInput(raw?: string | null) {
  if (isNhciSymbol(raw)) return true
  const text = String(raw || "").trim()
  if (!text) return false
  return /南华商品/.test(text) || text === "南华"
}

export function normalizeNhciSymbol(raw?: string | null) {
  return looksLikeNhciInput(raw) ? NHCI_SYMBOL : null
}
