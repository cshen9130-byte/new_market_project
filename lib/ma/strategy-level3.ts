const SPLIT_RE = /[，,、/]/g

export function parseStrategyLevel3(value: string): string[] {
  return value
    .split(SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function joinStrategyLevel3(values: string[]): string {
  return values
    .map((part) => part.trim())
    .filter(Boolean)
    .join("、")
}

export function strategyLevel3SetsEqual(a: string, b: string): boolean {
  const left = [...new Set(parseStrategyLevel3(a))].sort((x, y) => x.localeCompare(y, "zh"))
  const right = [...new Set(parseStrategyLevel3(b))].sort((x, y) => x.localeCompare(y, "zh"))
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

/** Table cells use顿号; database stores comma-separated values. */
export function strategyLevel3ForDatabase(value: string): string {
  return parseStrategyLevel3(value).join(",")
}

export function strategyLevel3FromDatabase(value: string): string {
  return joinStrategyLevel3(parseStrategyLevel3(value))
}
