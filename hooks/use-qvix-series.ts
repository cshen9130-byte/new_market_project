"use client"

import { useEffect, useMemo, useState } from "react"

import { useChartStill } from "@/hooks/chart-still"
import type { IndexProduct } from "@/lib/client/ctp-market"
import type { IvLookbackDays } from "@/lib/client/iv-lookback"
import { qvixBarsForTimeframe, sliceOverlayByLookbackDays } from "@/lib/client/qvix-series"
import { type IvSnapshot, type OverlayPoint } from "@/lib/client/realtime-overlay"
import { aggregateCloseSeries, isIntradayTimeframe, type TimeframeId } from "@/lib/client/timeframes"

const dailyCache = new Map<IndexProduct, OverlayPoint[]>()
const monthCache = new Map<string, OverlayPoint[]>()
const windowCache = new Map<string, { bars: OverlayPoint[]; source: string | null; resolution: string | null }>()

export function useQvixSeries(
  product: IndexProduct,
  interval: TimeframeId,
  iv?: IvSnapshot,
  month?: string | null,
  lookbackDays: IvLookbackDays = 1,
) {
  const history = !isIntradayTimeframe(interval)
  const monthKey = (month || "").trim().toUpperCase() || null
  const days = lookbackDays > 0 ? lookbackDays : 1
  const needWindow = (!!monthKey || days > 1) && (isIntradayTimeframe(interval) || !!monthKey)
  const still = useChartStill()
  const [daily, setDaily] = useState<OverlayPoint[]>(() => dailyCache.get(product) || [])
  const [windowBars, setWindowBars] = useState<OverlayPoint[]>([])
  const [windowSource, setWindowSource] = useState<string | null>(null)
  const [windowResolution, setWindowResolution] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (monthKey) return
    if (!history) return
    let cancelled = false
    async function load() {
      if (!dailyCache.has(product)) setLoading(true)
      try {
        const res = await fetch(`/ma/api/realtime-quotes/qvix?product=${product}`, { cache: "no-store" })
        const json = (await res.json()) as { ok?: boolean; error?: string; bars?: OverlayPoint[] }
        if (!res.ok || json.ok === false) throw new Error(json.error || `load failed ${res.status}`)
        const bars = json.bars || []
        dailyCache.set(product, bars)
        if (!cancelled) {
          setDaily(bars)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "QVIX load failed")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    if (still) {
      return () => {
        cancelled = true
      }
    }
    const timer = window.setInterval(() => void load(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [history, product, still, monthKey])

  useEffect(() => {
    if (!needWindow) {
      setWindowBars([])
      setWindowSource(null)
      setWindowResolution(null)
      return
    }
    let cancelled = false
    const cacheId = `${product}:${monthKey || ""}:d${days}`
    async function load() {
      if (!windowCache.has(cacheId)) setLoading(true)
      try {
        const qs = new URLSearchParams({ product, days: String(days) })
        if (monthKey) qs.set("month", monthKey)
        const res = await fetch(`/ma/api/realtime-quotes/qvix?${qs.toString()}`, { cache: "no-store" })
        const json = (await res.json()) as {
          ok?: boolean
          error?: string
          bars?: OverlayPoint[]
          source?: string | null
          resolution?: string | null
        }
        if (!res.ok || json.ok === false) throw new Error(json.error || `load failed ${res.status}`)
        const bars = json.bars || []
        const packed = { bars, source: json.source || null, resolution: json.resolution || null }
        windowCache.set(cacheId, packed)
        if (!cancelled) {
          setWindowBars(bars)
          setWindowSource(packed.source)
          setWindowResolution(packed.resolution)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "IV window load failed")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    if (still) {
      return () => {
        cancelled = true
      }
    }
    const timer = window.setInterval(() => void load(), days > 1 ? 60_000 : 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [needWindow, monthKey, product, still, days])

  return useMemo(() => {
    if (needWindow) {
      let bars = windowBars
      // If API degraded to daily closes while an intraday interval is selected, keep points as-is.
      if (windowResolution !== "daily" && bars.length) {
        bars = isIntradayTimeframe(interval) ? aggregateCloseSeries(bars, interval) : bars
      }
      if (days > 1 && bars.length) bars = sliceOverlayByLookbackDays(bars, days)
      return {
        bars,
        mode: bars.length
          ? windowResolution === "daily"
            ? ("history" as const)
            : ("intraday" as const)
          : ("unavailable" as const),
        error,
        loading: loading && bars.length === 0,
        source: windowSource,
        resolution: windowResolution,
        degradedToDaily: windowResolution === "daily",
      }
    }
    const series = qvixBarsForTimeframe(interval, iv, daily)
    let bars = series.bars
    if (history && days > 1 && bars.length) bars = sliceOverlayByLookbackDays(bars, days)
    return {
      ...series,
      bars,
      error,
      loading: history && loading && bars.length === 0,
      source: iv?.source ?? null,
      resolution: series.mode === "history" ? "daily" : "minute",
      degradedToDaily: false,
    }
  }, [daily, days, error, history, interval, iv, loading, needWindow, windowBars, windowResolution, windowSource])
}
