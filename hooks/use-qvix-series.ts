"use client"

import { useEffect, useMemo, useState } from "react"

import type { IndexProduct } from "@/lib/client/ctp-market"
import { qvixBarsForTimeframe } from "@/lib/client/qvix-series"
import { type IvSnapshot, type OverlayPoint } from "@/lib/client/realtime-overlay"
import { isIntradayTimeframe, type TimeframeId } from "@/lib/client/timeframes"

const dailyCache = new Map<IndexProduct, OverlayPoint[]>()

export function useQvixSeries(product: IndexProduct, interval: TimeframeId, iv?: IvSnapshot) {
  const history = !isIntradayTimeframe(interval)
  const [daily, setDaily] = useState<OverlayPoint[]>(() => dailyCache.get(product) || [])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!history) return
    let cancelled = false
    async function load() {
      if (!dailyCache.has(product)) setLoading(true)
      try {
        const res = await fetch(`/ma/api/realtime-quotes/qvix?product=${product}`, { cache: "no-store" })
        const json = (await res.json()) as { ok?: boolean; error?: string; bars?: OverlayPoint[] }
        if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
        const bars = json.bars || []
        dailyCache.set(product, bars)
        if (!cancelled) {
          setDaily(bars)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "QVIX 日线获取失败")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [history, product])

  return useMemo(() => {
    const series = qvixBarsForTimeframe(interval, iv, daily)
    return {
      ...series,
      error,
      loading: history && loading && series.bars.length === 0,
    }
  }, [daily, error, history, interval, iv, loading])
}
