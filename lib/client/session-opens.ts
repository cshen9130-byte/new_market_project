/** Shared CFFEX session open markers (Asia/Shanghai wall clock stored as UTC fields). */

export type SessionOpenMark = { label: string; hhmm: number }

export const CFFEX_SESSION_OPENS: SessionOpenMark[] = [
  { label: "09:30", hhmm: 930 },
  { label: "13:00", hhmm: 1300 },
]

function utcHhmm(unix: number) {
  const d = new Date(unix * 1000)
  return d.getUTCHours() * 100 + d.getUTCMinutes()
}

function shanghaiDayKey(unix: number) {
  const d = new Date(unix * 1000)
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
}

/** Index of first bar at/after hhmm (HHMM as number, e.g. 930 / 1300). */
export function sessionOpenIndex(barTimes: number[], hhmm: number): number {
  return barTimes.findIndex((t) => utcHhmm(t) >= hhmm)
}

/**
 * Every bar index that opens a CFFEX session segment (per Shanghai calendar day).
 * Skips days that never reach the mark (e.g. morning-only tape for 13:00).
 */
export function sessionOpenIndices(barTimes: number[], hhmm: number): number[] {
  const out: number[] = []
  let prevDay: string | null = null
  let marked = false
  for (let i = 0; i < barTimes.length; i++) {
    const t = barTimes[i]
    const day = shanghaiDayKey(t)
    if (day !== prevDay) {
      prevDay = day
      marked = false
    }
    if (marked) continue
    if (utcHhmm(t) >= hhmm) {
      out.push(i)
      marked = true
    }
  }
  return out
}

function markLineShell(color: string, data: Array<Record<string, unknown>>) {
  return {
    silent: true,
    symbol: "none",
    animation: false,
    lineStyle: { color, type: "dashed", width: 1 },
    label: { show: true, color, fontSize: 10, position: "insideEndTop" },
    data,
  }
}

/**
 * Build one echarts markLine covering all session opens present in the category axis.
 * Uses numeric xAxis indices (not category labels) so marks stay valid under dataZoom.
 * Callers with dataZoom must use filterMode "none" / "weakFilter" — "filter" drops
 * off-window categories and ECharts then throws reading getRawIndex on undefined.
 */
export function sessionOpenEchartsMarkLine(
  categoryTimes: string[],
  barUnix: number[],
  dark = false,
  extraData: Array<Record<string, unknown>> = [],
): Record<string, unknown> | undefined {
  const color = dark ? "#4a5568" : "#94a3b8"
  const data: Array<Record<string, unknown>> = []
  const n = Math.min(categoryTimes.length, barUnix.length)
  if (n > 0) {
    const times = barUnix.length === n ? barUnix : barUnix.slice(0, n)
    for (const mark of CFFEX_SESSION_OPENS) {
      for (const idx of sessionOpenIndices(times, mark.hhmm)) {
        if (idx < 0 || idx >= n) continue
        data.push({
          // Numeric category index — stable vs formatted label collisions.
          xAxis: idx,
          label: { formatter: mark.label, show: true, color, fontSize: 10, position: "insideEndTop" },
        })
      }
    }
  }
  for (const row of extraData) data.push(row)
  if (!data.length) return undefined
  return markLineShell(color, data)
}