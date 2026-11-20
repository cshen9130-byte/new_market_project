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
const windowCache = new Map<string, { bars: OverlayPoint[]; source: string | null; resolution: string | null; contract: string | null }>()
const atmCache = new Map<string, { bars: OverlayPoint[]; source: string | null; contract: string | null; months: AtmMonthOption[] }>()

export type AtmMonthOption = { id: string; label: string; expireDay: string }
export type IvSeriesKind = "qvix" | "atm"

export function useQvixSeries(
  product: IndexProduct,
  interval: TimeframeId,
  iv?: IvSnapshot,
  month?: string | null,
  lookbackDays: IvLookbackDays = 1,
  strike?: number | null,
  series: IvSeriesKind = "qvix",
  atmMonth?: string | null,
) {
  const history = !isIntradayTimeframe(interval)
  const monthKey = (month || "").trim().toUpperCase() || null
  const days = lookbackDays > 0 ? lookbackDays : 1
  const strikeKey = strike != null && Number.isFinite(strike) && strike > 0 ? String(strike) : ""
  const needWindow = (!!monthKey || days > 1 || !!strikeKey) && (isIntradayTimeframe(interval) || !!monthKey || !!strikeKey)
  const still = useChartStill()
  const [daily, setDaily] = useState<OverlayPoint[]>(() => dailyCache.get(product) || [])
  const [windowBars, setWindowBars] = useState<OverlayPoint[]>([])
  const [windowSource, setWindowSource] = useState<string | null>(null)
  const [windowResolution, setWindowResolution] = useState<string | null>(null)
  const [windowContract, setWindowContract] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [atmBars, setAtmBars] = useState<OverlayPoint[]>([])
  const [atmSource, setAtmSource] = useState<string | null>(null)
  const [atmContract, setAtmContract] = useState<string | null>(null)
  const [atmMonths, setAtmMonths] = useState<AtmMonthOption[]>([])
  const atmKey = `${product}:${atmMonth || ""}`

  useEffect(() => {
    if (series === "atm") return
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
  }, [history, product, still, monthKey, series])

  useEffect(() => {
    if (series !== "atm" || !history) {
      setAtmBars([])
      setAtmSource(null)
      setAtmContract(null)
      setAtmMonths([])
      return
    }
    let cancelled = false
    const cached = atmCache.get(atmKey)
    async function load() {
      if (!cached) setLoading(true)
      try {
        const qs = new URLSearchParams({ product, series: "atm" })
        if (atmMonth && /^\d{4}$/.test(atmMonth)) qs.set("atmMonth", atmMonth)
        const res = await fetch(`/ma/api/realtime-quotes/qvix?${qs.toString()}`, { cache: "no-store" })
        const json = (await res.json()) as {
          ok?: boolean
          error?: string
          bars?: OverlayPoint[]
          source?: string | null
          contract?: string | null
          months?: AtmMonthOption[]
        }
        if (!res.ok || json.ok === false) throw new Error(json.error || `load failed ${res.status}`)
        const packed = {
          bars: json.bars || [],
          source: json.source || null,
          contract: json.contract || null,
          months: json.months || [],
        }
        atmCache.set(atmKey, packed)
        if (!cancelled) {
          setAtmBars(packed.bars)
          setAtmSource(packed.source)
          setAtmContract(packed.contract)
          setAtmMonths(packed.months)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "平值日线加载失败")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (cached) {
      setAtmBars(cached.bars)
      setAtmSource(cached.source)
      setAtmContract(cached.contract)
      setAtmMonths(cached.months)
    }
    void load()
    if (still) {
      return () => {
        cancelled = true
      }
    }
    const timer = window.setInterval(() => void load(), 5 * 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [atmKey, atmMonth, history, product, series, still])

  useEffect(() => {
    if (!needWindow) {
      setWindowBars([])
      setWindowSource(null)
      setWindowResolution(null)
      setWindowContract(null)
      return
    }
    let cancelled = false
    const cacheId = `${product}:${monthKey || ""}:d${days}:k${strikeKey}`
    async function load() {
      if (!windowCache.has(cacheId)) {
        setWindowBars([])
        setWindowSource(null)
        setWindowResolution(null)
        setWindowContract(null)
        setLoading(true)
      }
      try {
        const qs = new URLSearchParams({ product, days: String(days) })
        if (monthKey) qs.set("month", monthKey)
        if (strikeKey) qs.set("strike", strikeKey)
        const res = await fetch(`/ma/api/realtime-quotes/qvix?${qs.toString()}`, { cache: "no-store" })
        const json = (await res.json()) as {
          ok?: boolean
          error?: string
          bars?: OverlayPoint[]
          source?: string | null
          resolution?: string | null
          contract?: string | null
        }
        if (!res.ok || json.ok === false) throw new Error(json.error || `load failed ${res.status}`)
        const bars = json.bars || []
        const packed = {
          bars,
          source: json.source || null,
          resolution: json.resolution || null,
          contract: json.contract || null,
        }
        windowCache.set(cacheId, packed)
        if (!cancelled) {
          setWindowBars(bars)
          setWindowSource(packed.source)
          setWindowResolution(packed.resolution)
          setWindowContract(packed.contract)
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
    const timer = window.setInterval(() => void load(), strikeKey ? 10_000 : days > 1 ? 60_000 : 30_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [needWindow, monthKey, product, still, days, strikeKey])

  return useMemo(() => {
    if (series === "atm" && history) {
      const packed = qvixBarsForTimeframe(interval, undefined, atmBars)
      let bars = packed.bars
      if (days > 1 && bars.length) bars = sliceOverlayByLookbackDays(bars, days)
      return {
        bars,
        mode: bars.length ? ("history" as const) : ("unavailable" as const),
        error,
        loading: loading && bars.length === 0,
        source: atmSource,
        resolution: "daily" as const,
        contract: atmContract,
        degradedToDaily: false,
        months: atmMonths,
      }
    }
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
        contract: windowContract,
        degradedToDaily: windowResolution === "daily",
        months: [] as AtmMonthOption[],
      }
    }
    const historySeries = qvixBarsForTimeframe(interval, iv, daily)
    let bars = historySeries.bars
    if (history && days > 1 && bars.length) bars = sliceOverlayByLookbackDays(bars, days)
    return {
      ...historySeries,
      bars,
      error,
      loading: history && loading && bars.length === 0,
      source: iv?.source ?? null,
      contract: iv?.contract ?? null,
      resolution: historySeries.mode === "history" ? "daily" : "minute",
      degradedToDaily: false,
      months: [] as AtmMonthOption[],
    }
  }, [atmBars, atmContract, atmMonths, atmSource, daily, days, error, history, interval, iv, loading, needWindow, series, windowBars, windowContract, windowResolution, windowSource])
}
