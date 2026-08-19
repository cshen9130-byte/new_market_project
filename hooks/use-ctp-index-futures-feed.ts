"use client"

import { useEffect, useRef, useState } from "react"

import {
  type CtpCandle,
  type CtpStatus,
  type CtpTick,
  upsertCandle,
} from "@/lib/client/ctp-market"

type LiveResponse = CtpStatus & {
  ok?: boolean
  error?: string
  items?: Record<string, { tick: CtpTick | null; candle: CtpCandle | null }>
  index_symbols?: string[]
  symbols?: string[]
}

type BarsResponse = {
  ok?: boolean
  error?: string
  candles?: Record<string, CtpCandle[]>
}

const POLL_MS = 800
const BARS_REFRESH_MS = 15_000

export function useCtpIndexFuturesFeed() {
  const [status, setStatus] = useState<CtpStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [symbols, setSymbols] = useState<string[]>([])
  const [quotes, setQuotes] = useState<Record<string, CtpTick>>({})
  const [candles, setCandles] = useState<Record<string, CtpCandle[]>>({})
  const candlesRef = useRef<Record<string, CtpCandle[]>>({})
  const quotesRef = useRef<Record<string, CtpTick>>({})

  useEffect(() => {
    let cancelled = false
    let pollTimer: number | undefined
    let barsTimer: number | undefined

    async function readJson<T>(path: string) {
      const res = await fetch(path, { cache: "no-store" })
      const json = (await res.json()) as T & { ok?: boolean; error?: string }
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `请求失败 ${res.status}`)
      }
      return json
    }

    function applyLive(json: LiveResponse) {
      const list = json.index_symbols || json.symbols || []
      setStatus({
        connected: json.connected,
        logged_in: json.logged_in,
        profile: json.profile,
        front: json.front,
        message: json.message,
        tick_count: json.tick_count,
        symbols: list,
        index_symbols: json.index_symbols || list,
      })
      if (list.length) setSymbols(list)
      const nextQuotes = { ...quotesRef.current }
      const nextCandles = { ...candlesRef.current }
      let candlesChanged = false
      for (const [symbol, item] of Object.entries(json.items || {})) {
        if (item.tick) nextQuotes[symbol] = item.tick
        if (item.candle) {
          nextCandles[symbol] = upsertCandle(nextCandles[symbol], item.candle)
          candlesChanged = true
        }
      }
      quotesRef.current = nextQuotes
      setQuotes(nextQuotes)
      if (candlesChanged) {
        candlesRef.current = nextCandles
        setCandles(nextCandles)
      }
    }

    async function loadBars() {
      const bars = await readJson<BarsResponse>("/ma/api/ctp-market/bars")
      if (cancelled) return
      const history = bars.candles || {}
      const merged = { ...candlesRef.current }
      for (const [symbol, rows] of Object.entries(history)) {
        merged[symbol] = rows
      }
      candlesRef.current = merged
      setCandles(merged)
    }

    async function pollLive() {
      if (cancelled) return
      try {
        const live = await readJson<LiveResponse>("/ma/api/ctp-market/live")
        if (cancelled) return
        applyLive(live)
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "CTP 行情服务连接失败")
        }
      }
      if (!cancelled) pollTimer = window.setTimeout(pollLive, POLL_MS)
    }

    async function start() {
      try {
        await loadBars()
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "CTP 行情服务未启动")
        }
      }
      await pollLive()
    }

    void start()
    barsTimer = window.setInterval(() => {
      void loadBars().catch(() => {})
    }, BARS_REFRESH_MS)

    return () => {
      cancelled = true
      if (pollTimer) window.clearTimeout(pollTimer)
      if (barsTimer) window.clearInterval(barsTimer)
    }
  }, [])

  return { status, error, symbols, quotes, candles }
}
