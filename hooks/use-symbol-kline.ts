"use client"

import { useEffect, useMemo, useState } from "react"

import type { CtpCandle } from "@/lib/client/ctp-market"
import { mergeHistoryAndLive, type TimeframeId } from "@/lib/client/timeframes"

export function useSymbolKline(symbol: string | null, interval: TimeframeId, live1m: CtpCandle[]) {
  const [history, setHistory] = useState<CtpCandle[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!symbol) {
      setHistory([])
      return
    }
    if (interval === "1m") {
      setHistory([])
      setError(null)
      return
    }
    let cancelled = false
    setHistory([])
    async function load() {
      try {
        const res = await fetch(
          `/ma/api/realtime-quotes/kline?symbol=${encodeURIComponent(symbol!)}&interval=${interval}`,
          { cache: "no-store" },
        )
        const json = (await res.json()) as { ok?: boolean; error?: string; candles?: CtpCandle[] }
        if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
        if (!cancelled) {
          setHistory(json.candles || [])
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "K线获取失败")
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), interval === "1d" || interval === "1w" || interval === "1M" ? 60_000 : 20_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [symbol, interval])

  const candles = useMemo(
    () => mergeHistoryAndLive(history, live1m, interval),
    [history, live1m, interval],
  )

  return { candles, error }
}
