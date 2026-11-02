import { bucketTime, getTimeframe, isIntradayTimeframe, type TimeframeId } from "@/lib/client/timeframes"

/** Category index on a side chart for the main chart's hovered bar. -1 when that date is not on screen. */
export function crosshairIndex(times: number[], time: number, interval: TimeframeId): number {
  if (!times.length || !Number.isFinite(time)) return -1
  if (!isIntradayTimeframe(interval)) {
    const bucket = bucketTime(time, interval)
    const exact = times.findIndex((item) => bucketTime(item, interval) === bucket)
    if (exact >= 0) return exact
  } else {
    const step = Math.max(60, getTimeframe(interval).seconds)
    const bucket = Math.floor(time / step) * step
    const exact = times.findIndex((item) => Math.floor(item / step) * step === bucket)
    if (exact >= 0) return exact
  }
  let best = -1
  let bestAbs = Number.POSITIVE_INFINITY
  for (let i = 0; i < times.length; i += 1) {
    const delta = Math.abs(times[i]! - time)
    if (delta < bestAbs) {
      best = i
      bestAbs = delta
    }
  }
  const limit = isIntradayTimeframe(interval) ? Math.max(60, getTimeframe(interval).seconds) : 86400 * 4
  return best >= 0 && bestAbs <= limit ? best : -1
}
