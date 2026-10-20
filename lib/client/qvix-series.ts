import { isDailyOverlayBars, type IvSnapshot, type OverlayPoint } from "@/lib/client/realtime-overlay"
import { aggregateCloseSeries, bucketTime, isIntradayTimeframe, type TimeframeId } from "@/lib/client/timeframes"

export type QvixSeriesMode = "intraday" | "history" | "unavailable"

export function qvixBarsForTimeframe(
  interval: TimeframeId,
  iv: Pick<IvSnapshot, "bars" | "source" | "value"> | undefined,
  daily: OverlayPoint[],
): { bars: OverlayPoint[]; mode: QvixSeriesMode } {
  if (isIntradayTimeframe(interval)) {
    if (!iv?.bars.length || isDailyOverlayBars(iv.bars, iv.source)) {
      return { bars: [], mode: "unavailable" }
    }
    return { bars: aggregateCloseSeries(iv.bars, interval), mode: "intraday" }
  }
  const history = stampLiveDaily(daily, iv)
  if (history.length) return { bars: aggregateCloseSeries(history, interval), mode: "history" }
  if (iv && isDailyOverlayBars(iv.bars, iv.source) && iv.bars.length) {
    return { bars: aggregateCloseSeries(iv.bars, interval), mode: "history" }
  }
  return { bars: [], mode: "history" }
}

function stampLiveDaily(
  daily: OverlayPoint[],
  iv: Pick<IvSnapshot, "bars" | "source" | "value"> | undefined,
) {
  const value = iv?.value
  const liveTime = iv?.bars.at(-1)?.time
  if (value == null || !(value > 0) || liveTime == null) return daily
  if (!iv || isDailyOverlayBars(iv.bars, iv.source)) return daily
  const day = bucketTime(liveTime, "1d")
  const next = daily.slice()
  const idx = next.findIndex((bar) => bucketTime(bar.time, "1d") === day)
  if (idx >= 0) {
    next[idx] = { time: next[idx].time, close: value }
    return next
  }
  next.push({ time: liveTime, close: value })
  next.sort((a, b) => a.time - b.time)
  return next
}
