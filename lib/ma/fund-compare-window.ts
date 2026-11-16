/** Window and curve alignment used by the 基金对比 detail table. */

export type CurvePoint = { d: string; v: number }

export function shiftCompareDate(dateStr: string, n: number, unit: "day" | "month" | "year"): string {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`)
  if (unit === "year") d.setFullYear(d.getFullYear() - n)
  else if (unit === "month") d.setMonth(d.getMonth() - n)
  else d.setDate(d.getDate() - n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Page default is 近一年, ending on the newest净值日 among the selected funds. */
export function resolveCompareWindow(input: {
  period?: string
  startDate?: string
  endDate?: string
  latestDates: string[]
  inceptionDates: string[]
}): { period: string; start_date: string; end_date: string } | null {
  const latest = input.latestDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1)
  const end = /^\d{4}-\d{2}-\d{2}$/.test(input.endDate ?? "") ? input.endDate!.slice(0, 10) : latest
  if (!end) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(input.startDate ?? "")) {
    const start = input.startDate!.slice(0, 10)
    if (start > end) return null
    return { period: "自定义", start_date: start, end_date: end }
  }
  const period = (input.period || "近一年").trim()
  const yearMatch = /^(\d{4})年$/.exec(period)
  let start = shiftCompareDate(end, 1, "year")
  let to = end
  if (period === "成立以来" || period === "运作以来") {
    start = input.inceptionDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()[0] || "2000-01-01"
    if (start > to) start = to
  } else if (period === "今年以来") {
    start = `${end.slice(0, 4)}-01-01`
  } else if (period === "近一周") {
    start = shiftCompareDate(end, 7, "day")
  } else if (period === "近一月") {
    start = shiftCompareDate(end, 1, "month")
  } else if (period === "近三月") {
    start = shiftCompareDate(end, 3, "month")
  } else if (period === "近六月") {
    start = shiftCompareDate(end, 6, "month")
  } else if (period === "近两年") {
    start = shiftCompareDate(end, 2, "year")
  } else if (period === "近三年") {
    start = shiftCompareDate(end, 3, "year")
  } else if (period === "近五年") {
    start = shiftCompareDate(end, 5, "year")
  } else if (period === "近十年") {
    start = shiftCompareDate(end, 10, "year")
  } else if (yearMatch) {
    start = `${yearMatch[1]}-01-01`
    const endOfYear = `${yearMatch[1]}-12-31`
    to = endOfYear < end ? endOfYear : end
  }
  return { period: period === "近1年" ? "近一年" : period, start_date: start, end_date: to }
}

/** Same rebase as the page checkbox「对齐起点」: later common start, then subtract that day's cumulative percent. */
export function alignReturnCurves<T extends { points: CurvePoint[] }>(series: T[], align: boolean): T[] {
  if (!align || series.length === 0) return series
  const latestStart = series.reduce((max, item) => {
    const start = item.points[0]?.d ?? ""
    return start > max ? start : max
  }, "")
  if (!latestStart) return series
  return series.map((item) => {
    const filtered = item.points.filter((point) => point.d >= latestStart)
    if (filtered.length === 0) return { ...item, points: [] }
    const base = filtered[0].v
    return {
      ...item,
      points: filtered.map((point) => ({
        d: point.d,
        v: Number.parseFloat((point.v - base).toFixed(4)),
      })),
    }
  })
}

export function rebaseLevels(points: Array<{ d: string; v: number }>): CurvePoint[] {
  const base = points.find((point) => Number.isFinite(point.v) && point.v > 0)?.v
  if (base == null) return []
  return points.map((point) => ({
    d: point.d,
    v: Number.parseFloat((((point.v / base) - 1) * 100).toFixed(4)),
  }))
}

/** Clip a benchmark to the aligned fund start and rebase, matching the compare page. */
export function clipBenchmarkReturns(
  levels: Array<{ d: string; v: number }>,
  startDate: string,
): CurvePoint[] {
  const navPoints = levels.filter((point) => point.d >= startDate && point.v > 0)
  return rebaseLevels(navPoints)
}
