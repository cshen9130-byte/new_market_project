"use client"

import { useEffect, useMemo, useState } from "react"

import type { IndexProduct } from "@/lib/client/ctp-market"
import type { OverlayPoint, SpotSnapshot } from "@/lib/client/realtime-overlay"
import {
  aggregateCloseSeries,
  bucketTime,
  shanghaiWallUnix,
  type TimeframeId,
} from "@/lib/client/timeframes"

function mergeCloseSeries(history: OverlayPoint[], live: OverlayPoint[], id: TimeframeId) {
  const higherTf = id === "1d" || id === "1w" || id === "1M"
  if (!history.length) return higherTf ? [] : live
  if (!live.length) return history
  const map = new Map<number, OverlayPoint>()
  for (const bar of history) map.set(bar.time, bar)
  for (const bar of live) {
    const prev = map.get(bar.time)
    if (!prev) {
      if (!higherTf) map.set(bar.time, bar)
      continue
    }
    map.set(bar.time, { time: prev.time, close: bar.close })
  }
  return [...map.values()].sort((a, b) => a.time - b.time)
}

function applyLiveClose(bars: OverlayPoint[], price: number, id: TimeframeId) {
  if (!(price > 0) || (id !== "1d" && id !== "1w" && id !== "1M")) return bars
  const time = bucketTime(shanghaiWallUnix(), id)
  const next = bars.slice()
  const idx = next.findIndex((bar) => bar.time === time)
  if (idx < 0) {
    next.push({ time, close: price })
    return next.sort((a, b) => a.time - b.time)
  }
  next[idx] = { time, close: price }
  return next
}

export function useSpotKline(product: IndexProduct, interval: TimeframeId, live?: SpotSnapshot) {
  const [history, setHistory] = useState<OverlayPoint[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setHistory([])
    async function load() {
      try {
        const res = await fetch(
          `/ma/api/realtime-quotes/spot-kline?product=${encodeURIComponent(product)}&interval=${interval}`,
          { cache: "no-store" },
        )
        const json = (await res.json()) as { ok?: boolean; error?: string; bars?: OverlayPoint[] }
        if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
        if (cancelled) return
        const incoming = json.bars || []
        setHistory((prev) => {
          if (!incoming.length) return prev
          if (prev.length >= 16 && incoming.length < prev.length * 0.6) {
            return mergeCloseSeries(prev, incoming, interval)
          }
          return incoming
        })
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "现货K线获取失败")
      }
    }
    void load()
    const timer = window.setInterval(
      () => void load(),
      interval === "1d" || interval === "1w" || interval === "1M" ? 60_000 : 20_000,
    )
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [product, interval])

  const bars = useMemo(() => {
    const liveAgg = aggregateCloseSeries(live?.bars || [], interval)
    const merged = mergeCloseSeries(history, liveAgg, interval)
    return live?.price != null ? applyLiveClose(merged, live.price, interval) : merged
  }, [history, interval, live])

  return { bars, error }
}
