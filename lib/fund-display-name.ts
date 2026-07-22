/** Strip legal fund-type suffixes for UI display; preserve A/B/C share class. */
export function normalizeFundDisplayName(raw: string): string {
  const s = raw.trim()
  if (!s) return s
  const m = s.match(/^(.+?)(?:私募证券投资基金|私募基金|证券投资基金|投资基金)?([ABC]类|[ABC])?$/)
  if (!m?.[1]) return s
  const base = m[1].trim()
  let shareClass = (m[2] ?? "").trim()
  if (shareClass.length === 1 && /[ABC]/.test(shareClass)) shareClass += "类"
  return `${base}${shareClass}`
}

/** Preferred table/chart label: short name when set, else shortened product name. */
export function resolveFundDisplayLabel(
  shortName: string | null | undefined,
  productName: string,
): string {
  const raw = shortName?.trim() || productName.trim()
  if (/[ABC]类/u.test(raw)) return raw
  return normalizeFundDisplayName(raw)
}
