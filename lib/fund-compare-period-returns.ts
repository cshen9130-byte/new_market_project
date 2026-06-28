export type ReturnGranularity = "week" | "month" | "quarter" | "half" | "year" | "phase"

export interface NavPoint {
  d: string
  v: number
}

export const RETURN_GRANULARITY_OPTIONS: { key: ReturnGranularity; label: string }[] = [
  { key: "week", label: "周度" },
  { key: "month", label: "月度" },
  { key: "quarter", label: "季度" },
  { key: "half", label: "半年度" },
  { key: "year", label: "年度" },
  { key: "phase", label: "阶段" },
]

export function periodBucket(date: string, gran: ReturnGranularity): string {
  const y = parseInt(date.slice(0, 4), 10)
  const m = parseInt(date.slice(5, 7), 10)
  if (gran === "month") return date.slice(0, 7)
  if (gran === "year") return String(y)
  if (gran === "quarter") return `${y}-Q${Math.ceil(m / 3)}`
  if (gran === "half") return `${y}-H${m <= 6 ? 1 : 2}`
  if (gran === "phase") return "phase"
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setDate(diff)
  return monday.toISOString().slice(0, 10)
}

export function formatBucketLabel(bucket: string, gran: ReturnGranularity): string {
  if (gran === "month") return bucket
  if (gran === "week") return bucket.length >= 7 ? bucket.slice(0, 7) : bucket
  return bucket
}

export function yearsInRange(from: string, to: string): number[] {
  const startYear = parseInt(from.slice(0, 4), 10)
  const endYear = parseInt(to.slice(0, 4), 10)
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return [new Date().getFullYear()]
  const years: number[] = []
  for (let y = endYear; y >= startYear; y--) years.push(y)
  return years.length > 0 ? years : [new Date().getFullYear()]
}

export function filterPointsToYear(points: NavPoint[], year: number): NavPoint[] {
  const prefix = `${year}-`
  return points.filter((p) => p.d.startsWith(prefix))
}

export function computePeriodReturnsFromNav(
  points: NavPoint[],
  gran: ReturnGranularity,
): { label: string; pct: number }[] {
  const sorted = [...points].sort((a, b) => a.d.localeCompare(b.d))
  if (sorted.length < 2) return []

  if (gran === "phase") {
    const start = sorted[0].v
    const end = sorted.at(-1)!.v
    return [{
      label: sorted[0].d.slice(0, 7),
      pct: start > 0 ? parseFloat(((end / start - 1) * 100).toFixed(2)) : 0,
    }]
  }

  const bucketLast = new Map<string, NavPoint>()
  for (const row of sorted) bucketLast.set(periodBucket(row.d, gran), row)
  const buckets = [...bucketLast.keys()].sort()

  return buckets.map((bucket, i) => {
    const endRow = bucketLast.get(bucket)!
    let baseNav: number
    if (i === 0) {
      const firstRow = sorted.find((r) => periodBucket(r.d, gran) === bucket)!
      baseNav = firstRow.v
    } else {
      baseNav = bucketLast.get(buckets[i - 1])!.v
    }
    const pct = baseNav > 0 ? (endRow.v / baseNav - 1) * 100 : 0
    return {
      label: formatBucketLabel(bucket, gran),
      pct: parseFloat(pct.toFixed(2)),
    }
  })
}

export function alignPeriodLabels(seriesList: { label: string; pct: number }[][]): string[] {
  const labels = new Set<string>()
  for (const series of seriesList) {
    for (const pt of series) labels.add(pt.label)
  }
  return [...labels].sort()
}

export function seriesToAlignedData(
  series: { label: string; pct: number }[],
  labels: string[],
): number[] {
  const map = new Map(series.map((p) => [p.label, p.pct]))
  return labels.map((label) => {
    const v = map.get(label)
    return v == null ? NaN : v
  })
}

export function statsCutoffFromPoints(points: NavPoint[]): string | null {
  return points.at(-1)?.d?.slice(0, 10) ?? null
}

export const CALENDAR_MONTHS = [
  "1月", "2月", "3月", "4月", "5月", "6月",
  "7月", "8月", "9月", "10月", "11月", "12月",
] as const

export function computeMonthlyReturnsForYear(
  points: NavPoint[],
  year: number,
): (number | null)[] {
  const sorted = [...points].sort((a, b) => a.d.localeCompare(b.d))
  const monthLast = new Map<string, NavPoint>()
  for (const p of sorted) monthLast.set(p.d.slice(0, 7), p)

  const result: (number | null)[] = Array(12).fill(null)
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, "0")}`
    const endRow = monthLast.get(ym)
    if (!endRow) continue
    const prevNav = sorted.filter((p) => p.d < `${ym}-01`).at(-1)?.v
    if (prevNav && prevNav > 0) {
      result[m - 1] = parseFloat(((endRow.v / prevNav - 1) * 100).toFixed(2))
    }
  }
  return result
}

export function computeMonthlyWinRate(monthly: (number | null)[]): number | null {
  const valid = monthly.filter((v): v is number => v != null)
  if (!valid.length) return null
  return Math.round((valid.filter((v) => v > 0).length / valid.length) * 10000) / 100
}

export function computeFullYearFromMonthly(monthly: (number | null)[]): number | null {
  const valid = monthly.filter((v): v is number => v != null)
  if (!valid.length) return null
  const compounded = valid.reduce((acc, v) => acc * (1 + v / 100), 1)
  return Math.round((compounded - 1) * 10000) / 100
}

export function fmtMonthlyPct(value: number | null): string {
  if (value == null) return "—"
  return `${value.toFixed(2)}%`
}

export function monthlyPctClass(value: number | null): string {
  if (value == null) return "text-muted-foreground"
  if (value > 0) return "text-red-500"
  if (value < 0) return "text-green-500"
  return "text-foreground"
}
