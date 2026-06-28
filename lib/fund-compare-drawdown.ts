export interface ReturnPoint {
  d: string
  v: number
}

export function computeDrawdownSeries(points: ReturnPoint[]): number[] {
  if (points.length === 0) return []
  let peak = 1 + points[0].v / 100
  return points.map((p) => {
    const level = 1 + p.v / 100
    if (level > peak) peak = level
    return peak > 0 ? ((level - peak) / peak) * 100 : 0
  })
}

export function computeExcessReturnSeries(
  fund: ReturnPoint[],
  bench: ReturnPoint[],
): ReturnPoint[] {
  const benchMap = new Map(bench.map((p) => [p.d, p.v]))
  return fund
    .filter((p) => benchMap.has(p.d))
    .map((p) => ({ d: p.d, v: p.v - (benchMap.get(p.d) ?? 0) }))
}

export function mergeDates(seriesList: ReturnPoint[][]): string[] {
  const dates = new Set<string>()
  for (const series of seriesList) {
    for (const p of series) dates.add(p.d)
  }
  return [...dates].sort()
}

export function drawdownOnTimeline(
  dates: string[],
  points: ReturnPoint[],
): (number | null)[] {
  const sorted = [...points].sort((a, b) => a.d.localeCompare(b.d))
  if (sorted.length === 0) return dates.map(() => null)

  let peak = 1 + sorted[0].v / 100
  const ddByDate = new Map<string, number>()
  for (const p of sorted) {
    const level = 1 + p.v / 100
    if (level > peak) peak = level
    ddByDate.set(p.d, peak > 0 ? ((level - peak) / peak) * 100 : 0)
  }
  return dates.map((d) => ddByDate.get(d) ?? null)
}

export function monthAxisLabel(value: string, lastDate: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  const last = new Date(lastDate)
  if (d.getFullYear() === last.getFullYear() && d.getMonth() === 0) {
    return String(d.getFullYear())
  }
  return `${d.getMonth() + 1}月`
}

export function drawdownYMin(values: (number | null)[]): number {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (!finite.length) return -10
  const min = Math.min(...finite)
  return Math.floor(min / 3) * 3
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "")
  if (normalized.length !== 6) return `rgba(148,163,184,${alpha})`
  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
