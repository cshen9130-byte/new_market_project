import type { NavPoint } from "@/lib/fund-compare-period-returns"
import { correlationCellStyle } from "@/lib/fund-compare-correlation"

export interface MatrixEntity {
  key: string
  name: string
  isBenchmark: boolean
}

export interface CorrelationMatrixResult {
  entities: MatrixEntity[]
  values: (number | null)[][]
}

function pearsonCorrelation(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let cov = 0
  let va = 0
  let vb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma
    const db = b[i] - mb
    cov += da * db
    va += da * da
    vb += db * db
  }
  const den = Math.sqrt(va * vb)
  return den > 0 ? cov / den : null
}

export function dailyReturnMap(
  points: NavPoint[],
  from: string,
  to: string,
): Map<string, number> {
  const sorted = [...points]
    .filter((p) => p.d >= from && p.d <= to)
    .sort((a, b) => a.d.localeCompare(b.d))
  const map = new Map<string, number>()
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].v
    const curr = sorted[i].v
    if (prev > 0 && curr > 0) map.set(sorted[i].d, curr / prev - 1)
  }
  return map
}

export function excessReturnMap(
  fundMap: Map<string, number>,
  benchMap: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const [d, r] of fundMap) {
    const b = benchMap.get(d)
    if (b != null) out.set(d, r - b)
  }
  return out
}

export function correlateReturnMaps(a: Map<string, number>, b: Map<string, number>): number | null {
  const dates = [...a.keys()].filter((d) => b.has(d)).sort()
  if (dates.length < 3) return null
  return pearsonCorrelation(
    dates.map((d) => a.get(d)!),
    dates.map((d) => b.get(d)!),
  )
}

export function buildCorrelationMatrix(
  items: Array<{ key: string; name: string; returnMap: Map<string, number>; isBenchmark?: boolean }>,
): CorrelationMatrixResult {
  const n = items.length
  const values: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) values[i][j] = 1
      else values[i][j] = correlateReturnMaps(items[i].returnMap, items[j].returnMap)
    }
  }
  return {
    entities: items.map((item) => ({
      key: item.key,
      name: item.name,
      isBenchmark: !!item.isBenchmark,
    })),
    values,
  }
}

export function sortCorrelationMatrix(
  result: CorrelationMatrixResult,
): CorrelationMatrixResult {
  const { entities, values } = result
  const scores = entities.map((_, i) => {
    const row = values[i].filter((v, j) => j !== i && v != null) as number[]
    return row.length ? row.reduce((s, v) => s + v, 0) / row.length : 0
  })
  const order = entities.map((_, i) => i).sort((a, b) => scores[b] - scores[a])
  return {
    entities: order.map((i) => entities[i]),
    values: order.map((i) => order.map((j) => values[i][j])),
  }
}

export function fmtMatrixCorrelation(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toFixed(4)
}

export { correlationCellStyle }
