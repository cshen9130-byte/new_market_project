/** Min/max without spread — safe for large series (dates × contracts). */
export function numericMin(values: Iterable<number>, bound = Infinity): number {
  let min = bound
  for (const v of values) {
    if (v < min) min = v
  }
  return min
}

export function numericMax(values: Iterable<number>, bound = -Infinity): number {
  let max = bound
  for (const v of values) {
    if (v > max) max = v
  }
  return max
}
