"use client"

import { useEffect, useMemo, useState } from "react"

import type { CtpCandle, CtpTick } from "@/lib/client/ctp-market"
import { isCffexProduct, isCffexSession } from "@/lib/client/market-hours"
import {
  applyLiveQuoteBar,
  isIntradayTimeframe,
  mergeHistoryAndLive,
  type TimeframeId,
} from "@/lib/client/timeframes"

export function useSymbolsKline(
  symbols: string[],
  interval: TimeframeId,
  live1m: Record<string, CtpCandle[]>,
  quotes: Record<string, CtpTick>,
  enabled = true,
) {
  const unique = useMemo(
    () => [...new Set(symbols.map((item) => item.trim().toUpperCase()).filter(Boolean))].sort(),
    [symbols.join(",")],
  )
  const key = enabled && unique.length ? `${unique.join(",")}:${interval}` : null
  const [history, setHistory] = useState<Record<string, CtpCandle[]>>({})
  const [historyKey, setHistoryKey] = useState<string | null>(null)
  const [readyKey, setReadyKey] = useState<string | null>(null)

  useEffect(() => {
    if (!key) {
      setHistory({})
      setHistoryKey(null)
      setReadyKey(null)
      return
    }
    let cancelled = false
    const seriesKey = key
    const list = seriesKey.slice(0, seriesKey.lastIndexOf(":")).split(",").filter(Boolean)
    setHistoryKey(null)
    async function load() {
      try {
        const qs = new URLSearchParams({ interval, symbols: list.join(",") })
        const res = await fetch(`/ma/api/realtime-quotes/kline?${qs}`, { cache: "no-store" })
        const json = (await res.json()) as {
          ok?: boolean
          error?: string
          candles?: CtpCandle[]
          symbol?: string
          series?: Record<string, CtpCandle[]>
        }
        if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
        if (cancelled) return
        const incoming: Record<string, CtpCandle[]> = json.series
          ? json.series
          : json.symbol
            ? { [json.symbol]: json.candles || [] }
            : {}
        setHistory((prev) => {
          const next: Record<string, CtpCandle[]> = {}
          for (const item of list) {
            const bars = incoming[item] || incoming[item.toUpperCase()] || []
            const had = prev[item] || []
            if (had.length >= 16 && bars.length < had.length * 0.6) {
              next[item] = mergeHistoryAndLive(had, bars, interval)
            } else {
              next[item] = bars
            }
          }
          return next
        })
        setHistoryKey(seriesKey)
        setReadyKey(seriesKey)
      } catch {
        if (!cancelled) setReadyKey(seriesKey)
      }
    }
    void load()
    const timer = window.setInterval(
      () => void load(),
      isIntradayTimeframe(interval) ? 20_000 : 60_000,
    )
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [key, interval])

  const candles = useMemo(() => {
    const hist = key && historyKey === key ? history : {}
    const out: Record<string, CtpCandle[]> = {}
    for (const symbol of unique) {
      const live = live1m[symbol] || live1m[symbol.toUpperCase()] || []
      const useCtpLive = isCffexProduct(symbol) && isCffexSession()
      out[symbol] = applyLiveQuoteBar(
        mergeHistoryAndLive(hist[symbol] || [], useCtpLive ? live : [], interval),
        quotes[symbol] || quotes[symbol.toUpperCase()],
        interval,
        symbol,
      )
    }
    return out
  }, [history, historyKey, key, live1m, interval, quotes, unique])

  return { candles, loading: key != null && readyKey !== key }
}
