"use client"

import { useEffect, useMemo, useState } from "react"

import { useChartStill } from "@/hooks/chart-still"
import type { IndexProduct } from "@/lib/client/ctp-market"
import { qvixBarsForTimeframe } from "@/lib/client/qvix-series"
import { type IvSnapshot, type OverlayPoint } from "@/lib/client/realtime-overlay"
import { isIntradayTimeframe, type TimeframeId } from "@/lib/client/timeframes"

const dailyCache = new Map<IndexProduct, OverlayPoint[]>()
const monthCache = new Map<string, OverlayPoint[]>()

export function useQvixSeries(
  product: IndexProduct,
  interval: TimeframeId,
  iv?: IvSnapshot,
  month?: string | null,
) {
  const history = !isIntradayTimeframe(interval)
  const monthKey = (month || "").trim().toUpperCase() || null
  const still = useChartStill()
  const [daily, setDaily] = useState<OverlayPoint[]>(() => dailyCache.get(product) || [])
  const [monthBars, setMonthBars] = useState<OverlayPoint[]>(() =>
    monthKey ? monthCache.get(`${product}:${monthKey}`) || [] : [],
  )
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [monthSource, setMonthSource] = useState<string | null>(null)

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
    if (!monthKey) {
      setMonthBars([])
      setMonthSource(null)
      return
    }
    let cancelled = false
    const cacheId = `${product}:${monthKey}`
    async function load() {
      if (!monthCache.has(cacheId)) setLoading(true)
      try {
        const res = await fetch(
          `/ma/api/realtime-quotes/qvix?product=${product}&month=${encodeURIComponent(monthKey)}`,
          { cache: "no-store" },
        )
        const json = (await res.json()) as {
          ok?: boolean
          error?: string
          bars?: OverlayPoint[]
          source?: string | null
        }
        if (!res.ok || json.ok === false) throw new Error(json.error || `load failed ${res.status}`)
        const bars = json.bars || []
        monthCache.set(cacheId, bars)
        if (!cancelled) {
          setMonthBars(bars)
          setMonthSource(json.source || `em-atm:${monthKey}`)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "IV month load failed")
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
    const timer = window.setInterval(() => void load(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [monthKey, product, still])

  return useMemo(() => {
    if (monthKey) {
      const bars = monthBars
      return {
        bars,
        mode: bars.length ? ("intraday" as const) : ("unavailable" as const),
        error,
        loading: loading && bars.length === 0,
        source: monthSource,
      }
    }
    const series = qvixBarsForTimeframe(interval, iv, daily)
    return {
      ...series,
      error,
      loading: history && loading && series.bars.length === 0,
      source: iv?.source ?? null,
    }
  }, [daily, error, history, interval, iv, loading, monthBars, monthKey, monthSource])
}
