import { QUANT_ACCOUNT_IDS } from "@/lib/ma/quant-accounts"

/** Calendar date in Beijing (UTC+8), matching mom-cache file dates. */
export function beijingYmd(ms = Date.now()): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10)
}

/** Shift a Beijing calendar date by whole months. */
export function beijingMonthOffset(months: number, ms = Date.now()): string {
  const d = new Date(ms + 8 * 3600_000)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

export const QUANT_ALL_FROM = "2025-01-01"

export const QUANT_STRATEGY_RANGES = [
  { label: "近一月", months: -1 },
  { label: "近三月", months: -3 },
  { label: "近六月", months: -6 },
  { label: "近一年", months: -12 },
  { label: "全部", months: null },
] as const

export type QuantStrategyRangeLabel = (typeof QUANT_STRATEGY_RANGES)[number]["label"]

export function quantStrategyBounds(
  label: QuantStrategyRangeLabel,
  ms = Date.now(),
): { from: string; to: string } {
  const spec = QUANT_STRATEGY_RANGES.find((r) => r.label === label) ?? QUANT_STRATEGY_RANGES[QUANT_STRATEGY_RANGES.length - 1]
  const to = beijingYmd(ms)
  const from = spec.months == null ? QUANT_ALL_FROM : beijingMonthOffset(spec.months, ms)
  return { from, to }
}

export type QuantStrategyWarmQuery = {
  account: string
  from: string
  to: string
  scope: "core" | "full"
}

/**
 * Every payload the 量化策略分析 page can request:
 * 7 accounts × 5 ranges × (core paint + full factor panel).
 * Default view (rx319, 全部, core then full) comes first.
 */
export function quantStrategyWarmQueries(ms = Date.now()): QuantStrategyWarmQuery[] {
  const out: QuantStrategyWarmQuery[] = []
  const accounts = [319, ...QUANT_ACCOUNT_IDS.filter((id) => id !== 319)]
  const rangeLabels: QuantStrategyRangeLabel[] = ["全部", "近一年", "近六月", "近三月", "近一月"]
  for (const label of rangeLabels) {
    for (const id of accounts) {
      const { from, to } = quantStrategyBounds(label, ms)
      out.push({ account: String(id), from, to, scope: "core" })
      out.push({ account: String(id), from, to, scope: "full" })
    }
  }
  return out
}
