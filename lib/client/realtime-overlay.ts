import { INDEX_FUTURES, type IndexProduct } from "@/lib/client/ctp-market"

export const INDEX_SPOT = {
  IH: { sina: "sh000016", name: "上证50指数" },
  IF: { sina: "sh000300", name: "沪深300指数" },
  IC: { sina: "sh000905", name: "中证500指数" },
  IM: { sina: "sh000852", name: "中证1000指数" },
} as const satisfies Record<IndexProduct, { sina: string; name: string }>

export const INDEX_IV = {
  IH: { key: "50etf", fallback: "50index", option: "HO", name: "上证50期权 QVIX" },
  IF: { key: "300etf", fallback: "300index", option: "IO", name: "沪深300期权 QVIX" },
  IC: { key: "500etf", fallback: "500etf", option: "510500", name: "中证500ETF期权 QVIX" },
  IM: { key: "1000index", fallback: "1000etf", option: "MO", name: "中证1000股指期权 QVIX" },
} as const satisfies Record<
  IndexProduct,
  { key: string; fallback: string; option: string; name: string }
>

export const INDEX_CHART_COLOR: Record<IndexProduct, string> = {
  IH: "#2563eb",
  IF: "#0d9488",
  IC: "#d97706",
  IM: "#e11d48",
}

export type OverlayPoint = { time: number; close: number }

export type SpotSnapshot = {
  product: IndexProduct
  sina: string
  name: string
  price: number | null
  preClose: number | null
  change: number | null
  pct: number | null
  updateTime: string | null
  bars: OverlayPoint[]
}

export type IvSnapshot = {
  product: IndexProduct
  key: string
  option: string
  name: string
  value: number | null
  change: number | null
  pct: number | null
  source: string | null
  bars: OverlayPoint[]
}

export type LiveOverlayResponse = {
  ok?: boolean
  error?: string
  spots?: Record<string, SpotSnapshot>
  iv?: Record<string, IvSnapshot>
}

export const INDEX_PRODUCTS = INDEX_FUTURES.map((item) => item.product)

function barSpan(bars: OverlayPoint[]) {
  if (bars.length < 2) return 0
  return bars[bars.length - 1].time - bars[0].time
}

export function isDailyOverlayBars(bars: OverlayPoint[], source?: string | null) {
  return !!source?.startsWith("db:") || !!source?.startsWith("optbbs-pre:") || barSpan(bars) > 36 * 3600
}

function unionOverlayBars(prev: OverlayPoint[], incoming: OverlayPoint[]) {
  const map = new Map<number, OverlayPoint>()
  for (const bar of prev) map.set(bar.time, bar)
  for (const bar of incoming) map.set(bar.time, bar)
  return [...map.values()].sort((a, b) => a.time - b.time)
}

/** Keep last good minute series when a poll returns empty, short, or daily fallback. */
export function stabilizeOverlay(
  prev: LiveOverlayResponse | null,
  next: LiveOverlayResponse,
): LiveOverlayResponse {
  if (!prev) return next
  const spots = { ...(next.spots || {}) }
  const iv = { ...(next.iv || {}) }
  for (const product of INDEX_PRODUCTS) {
    const prevSpot = prev.spots?.[product]
    const nextSpot = spots[product]
    if (prevSpot?.bars?.length && nextSpot) {
      if ((nextSpot.bars?.length || 0) < 8) {
        spots[product] = { ...nextSpot, bars: prevSpot.bars }
      } else if (prevSpot.bars.length > nextSpot.bars.length * 1.4) {
        spots[product] = { ...nextSpot, bars: unionOverlayBars(prevSpot.bars, nextSpot.bars) }
      }
    }
    const prevIv = prev.iv?.[product]
    const nextIv = iv[product]
    if (prevIv?.bars?.length && nextIv) {
      const prevIntraday = !isDailyOverlayBars(prevIv.bars, prevIv.source)
      const nextDaily = isDailyOverlayBars(nextIv.bars, nextIv.source)
      if (prevIntraday && nextDaily) {
        iv[product] = { ...prevIv, value: prevIv.value, change: prevIv.change, pct: prevIv.pct }
      } else if (prevIntraday && (nextIv.bars?.length || 0) < 8) {
        iv[product] = { ...nextIv, bars: prevIv.bars, source: prevIv.source }
      } else if (prevIntraday && prevIv.bars.length > (nextIv.bars?.length || 0) * 1.4) {
        iv[product] = { ...nextIv, bars: unionOverlayBars(prevIv.bars, nextIv.bars), source: nextIv.source || prevIv.source }
      }
    }
  }
  return { ...next, spots, iv }
}
