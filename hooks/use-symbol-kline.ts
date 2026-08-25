"use client"

import { useEffect, useMemo, useState } from "react"

import type { CtpCandle, CtpTick } from "@/lib/client/ctp-market"
import { isCffexProduct, isCffexSession, overlaySinaQuote } from "@/lib/client/market-hours"
import { applyLiveQuoteBar, mergeHistoryAndLive, type TimeframeId } from "@/lib/client/timeframes"

export function useSymbolKline(symbol: string | null, interval: TimeframeId, live1m: CtpCandle[], quote?: CtpTick) {
  const [history, setHistory] = useState<CtpCandle[]>([])
  const [historyKey, setHistoryKey] = useState<string | null>(null)
  const [readyKey, setReadyKey] = useState<string | null>(null)
  const [sinaQuote, setSinaQuote] = useState<CtpTick | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = symbol ? `${symbol}:${interval}` : null

  useEffect(() => {
    if (!symbol) {
      setHistory([])
      setHistoryKey(null)
      setReadyKey(null)
      setSinaQuote(null)
      return
    }
    let cancelled = false
    const seriesKey = `${symbol}:${interval}`
    setHistory([])
    setHistoryKey(null)
    setSinaQuote(null)
    async function load() {
      try {
        const res = await fetch(
          `/ma/api/realtime-quotes/kline?symbol=${encodeURIComponent(symbol!)}&interval=${interval}`,
          { cache: "no-store" },
        )
        const json = (await res.json()) as {
          ok?: boolean
          error?: string
          candles?: CtpCandle[]
          quote?: CtpTick | null
        }
        if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
        if (cancelled) return
        const incoming = json.candles || []
        setHistory((prev) => {
          if (!incoming.length) return prev
          // Same-symbol poll only: Sina min-line sometimes returns only the current session.
          if (prev.length >= 16 && incoming.length < prev.length * 0.6) {
            return mergeHistoryAndLive(prev, incoming, interval)
          }
          return incoming
        })
        if (json.quote?.last) setSinaQuote({ ...json.quote, symbol: symbol! })
        setHistoryKey(seriesKey)
        setReadyKey(seriesKey)
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "K线获取失败")
          setReadyKey(seriesKey)
        }
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
  }, [symbol, interval])

  const sessionQuote = useMemo(
    () => (symbol ? overlaySinaQuote(symbol, quote, sinaQuote) : quote),
    [symbol, quote, sinaQuote],
  )

  const candles = useMemo(() => {
    const hist = key && historyKey === key ? history : []
    const useCtpLive = !!symbol && isCffexProduct(symbol) && isCffexSession()
    return applyLiveQuoteBar(
      mergeHistoryAndLive(hist, useCtpLive ? live1m : [], interval),
      sessionQuote,
      interval,
      symbol,
    )
  }, [history, historyKey, key, live1m, interval, sessionQuote, symbol])

  return { candles, quote: sessionQuote, error, loading: key != null && readyKey !== key }
}
