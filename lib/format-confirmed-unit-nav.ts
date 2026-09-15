/** 确认单位净值 always 4 decimal places: 1.021265 → 1.0213. */
export function formatConfirmedUnitNav(value: unknown): string | null {
  if (value == null || value === "") return null
  if (typeof value !== "string" && typeof value !== "number") return null
  const raw = String(value).trim()
  if (!raw) return null
  const n = Number(raw.replace(/,/g, ""))
  if (!Number.isFinite(n)) return raw
  return n.toFixed(4)
}
