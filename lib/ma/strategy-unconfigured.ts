/** Sentinel sent by 未分类 strategy-level filters. */
export const STRATEGY_UNCONFIGURED = "__unconfigured__"
export const STRATEGY_UNCONFIGURED_LABEL = "未分类"

export function isStrategyUnconfigured(value: string | null | undefined): boolean {
  return (value || "").trim() === STRATEGY_UNCONFIGURED
}

export function matchesStrategyLevelFilter(
  stored: string | null | undefined,
  filter: string,
  match: "eq" | "includes" = "eq",
): boolean {
  const f = filter.trim()
  if (!f) return true
  const s = (stored || "").trim()
  if (f === STRATEGY_UNCONFIGURED) return !s
  if (match === "includes") return s.includes(f)
  return s === f
}

/** Append a 一级/二级/三级 filter. `__unconfigured__` matches empty values. */
export function appendStrategyLevelFilter(
  value: string,
  expr: string,
  where: string[],
  params: { length: number; push(...items: unknown[]): number },
  match: "eq" | "ilike" = "eq",
): void {
  const v = (value || "").trim()
  if (!v) return
  if (v === STRATEGY_UNCONFIGURED) {
    where.push(`${expr} IS NULL`)
    return
  }
  if (match === "ilike") {
    params.push(`%${v}%`)
    where.push(`COALESCE(${expr}, '') ILIKE $${params.length}`)
    return
  }
  params.push(v)
  where.push(`${expr} = $${params.length}`)
}
