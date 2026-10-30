export const IV_LOOKBACKS = [
  { id: 1, label: "当日" },
  { id: 2, label: "2日" },
  { id: 5, label: "5日" },
  { id: 10, label: "10日" },
] as const

export type IvLookbackDays = (typeof IV_LOOKBACKS)[number]["id"]

export function isIvLookbackDays(value: number): value is IvLookbackDays {
  return IV_LOOKBACKS.some((item) => item.id === value)
}

export function clampIvLookbackDays(value: unknown, fallback: IvLookbackDays = 1): IvLookbackDays {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const rounded = Math.round(n)
  if (isIvLookbackDays(rounded)) return rounded
  // nearest allowed option
  let best: IvLookbackDays = fallback
  let bestDist = Infinity
  for (const item of IV_LOOKBACKS) {
    const dist = Math.abs(item.id - rounded)
    if (dist < bestDist) {
      best = item.id
      bestDist = dist
    }
  }
  return best
}

export function ivLookbackLabel(days: IvLookbackDays) {
  return IV_LOOKBACKS.find((item) => item.id === days)?.label || "当日"
}
