import { getNavFieldValue, type NavRow, type BenchmarkPoint } from "./shared"

export type PeriodGranularity = "week" | "month"

export interface PeriodReturnBar {
  label: string
  fundPct: number
  benchPct: number | null
  excessPct: number | null
}

function periodBucket(date: string, gran: PeriodGranularity): string {
  if (gran === "month") return date.slice(0, 7)
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d)
  monday.setDate(diff)
  return monday.toISOString().slice(0, 10)
}

function benchmarkAtDate(series: BenchmarkPoint[], date: string): number | null {
  let last: number | null = null
  for (const p of series) {
    if (p.date <= date) last = p.value
    else break
  }
  return last
}

export function computePeriodReturnBars(
  rows: NavRow[],
  navType: string,
  gran: PeriodGranularity,
  benchmarkSeries: BenchmarkPoint[],
): PeriodReturnBar[] {
  if (rows.length < 2) return []
  const sortedBench = [...benchmarkSeries].sort((a, b) => a.date.localeCompare(b.date))
  const bucketLast = new Map<string, NavRow>()
  for (const row of rows) bucketLast.set(periodBucket(row.price_date, gran), row)
  const buckets = [...bucketLast.keys()].sort()

  return buckets.map((bucket, i) => {
    const endRow = bucketLast.get(bucket)!
    const endNav = getNavFieldValue(endRow, navType)
    let baseNav: number, baseDate: string
    if (i === 0) {
      const firstRow = rows.find((r) => periodBucket(r.price_date, gran) === bucket)!
      baseNav = getNavFieldValue(firstRow, navType)
      baseDate = firstRow.price_date
    } else {
      const prevRow = bucketLast.get(buckets[i - 1])!
      baseNav = getNavFieldValue(prevRow, navType)
      baseDate = prevRow.price_date
    }
    const fundPct = baseNav > 0 ? (endNav / baseNav - 1) * 100 : 0
    const b0 = benchmarkAtDate(sortedBench, baseDate)
    const b1 = benchmarkAtDate(sortedBench, endRow.price_date)
    const benchPct = b0 && b1 && b0 > 0 ? (b1 / b0 - 1) * 100 : null
    return {
      label: gran === "month" ? bucket.slice(0, 7) : bucket,
      fundPct,
      benchPct,
      excessPct: benchPct !== null ? fundPct - benchPct : null,
    }
  })
}
