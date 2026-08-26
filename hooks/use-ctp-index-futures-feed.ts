"use client"

import { useEffect, useRef, useState } from "react"

import {
  type CtpCandle,
  type CtpStatus,
  type CtpTick,
  mergeCandleSeries,
  mergeQuoteTicks,
  upsertCandle,
} from "@/lib/client/ctp-market"

type LiveResponse = CtpStatus & {
  ok?: boolean
  error?: string
  type?: string
  items?: Record<string, { tick: CtpTick | null; candle: CtpCandle | null }>
  index_symbols?: string[]
  symbols?: string[]
  tick?: CtpTick
  candle?: CtpCandle
  symbol?: string
  last?: number | null
}

type BarsResponse = {
  ok?: boolean
  error?: string
  candles?: Record<string, CtpCandle[]>
}

const SNAPSHOT_MS = 5_000
const ERROR_POLL_MS = 800
const HIDDEN_POLL_MS = 2_000
const BARS_REFRESH_MS = 15_000

function quotesFingerprint(quotes: Record<string, CtpTick>) {
  let out = ""
  for (const key of Object.keys(quotes).sort()) {
    const t = quotes[key]
    out += `${key}:${t.last}:${t.bid}:${t.ask}:${t.volume}:${t.update_time}:${t.update_millis};`
  }
  return out
}

function asTick(raw: Record<string, unknown> | CtpTick | null | undefined): CtpTick | null {
  if (!raw || typeof raw !== "object") return null
  const symbol = String((raw as CtpTick).symbol || "").toUpperCase()
  if (!symbol) return null
  return { ...(raw as CtpTick), symbol }
}

export function useCtpIndexFuturesFeed() {
  const [status, setStatus] = useState<CtpStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [symbols, setSymbols] = useState<string[]>([])
  const [quotes, setQuotes] = useState<Record<string, CtpTick>>({})
  const [candles, setCandles] = useState<Record<string, CtpCandle[]>>({})
  const candlesRef = useRef<Record<string, CtpCandle[]>>({})
  const quotesRef = useRef<Record<string, CtpTick>>({})
  const quotesFpRef = useRef("")
  const streamingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    let pollTimer: number | undefined
    let barsTimer: number | undefined
    let source: EventSource | null = null
    let retryTimer: number | undefined

    async function readJson<T>(path: string) {
      const res = await fetch(path, { cache: "no-store" })
      const json = (await res.json()) as T & { ok?: boolean; error?: string }
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || `请求失败 ${res.status}`)
      }
      return json
    }

    function commitQuotes(nextQuotes: Record<string, CtpTick>) {
      quotesRef.current = nextQuotes
      const fp = quotesFingerprint(nextQuotes)
      if (fp === quotesFpRef.current) return
      quotesFpRef.current = fp
      setQuotes(nextQuotes)
    }

    function applyStatus(json: LiveResponse, list: string[]) {
      setStatus({
        connected: json.connected,
        logged_in: json.logged_in,
        profile: json.profile,
        front: json.front,
        message: json.message,
        tick_count: json.tick_count,
        symbols: list,
        index_symbols: json.index_symbols?.length ? json.index_symbols : list,
        extra_symbols: json.extra_symbols,
      })
      if (list.length) setSymbols(list)
    }

    function upsertQuote(quotes: Record<string, CtpTick>, tick: CtpTick) {
      const key = tick.symbol.toUpperCase()
      const incoming = { ...tick, symbol: key }
      const prev = quotes[key]
      quotes[key] = prev ? mergeQuoteTicks(prev, incoming) : incoming
    }

    function applyLive(json: LiveResponse) {
      const indexList = json.index_symbols || []
      const extraList = json.extra_symbols || []
      const list = [...new Set([...(json.symbols || []), ...indexList, ...extraList])]
      applyStatus(json, list)
      const nextQuotes = { ...quotesRef.current }
      const nextCandles = { ...candlesRef.current }
      let candlesChanged = false
      for (const [symbol, item] of Object.entries(json.items || {})) {
        const key = symbol.toUpperCase()
        if (item.tick) upsertQuote(nextQuotes, { ...item.tick, symbol: key })
        if (item.candle) {
          nextCandles[key] = upsertCandle(nextCandles[key], item.candle)
          candlesChanged = true
        }
      }
      commitQuotes(nextQuotes)
      if (candlesChanged) {
        candlesRef.current = nextCandles
        setCandles(nextCandles)
      }
    }

    function applyTick(tick: CtpTick, candle?: CtpCandle | null) {
      const key = tick.symbol.toUpperCase()
      const nextQuotes = { ...quotesRef.current }
      upsertQuote(nextQuotes, tick)
      commitQuotes(nextQuotes)
      if (!candle) return
      const nextCandles = { ...candlesRef.current, [key]: upsertCandle(candlesRef.current[key], candle) }
      candlesRef.current = nextCandles
      setCandles(nextCandles)
    }

    function ingest(msg: LiveResponse) {
      if (msg?.type === "error" && msg.error) {
        setError(String(msg.error))
        return
      }
      if (msg?.type === "snapshot" || msg.items) {
        applyLive(msg)
        setError(null)
        return
      }
      if (msg?.type === "status" && !msg.symbol) {
        const indexList = msg.index_symbols || []
        const extraList = msg.extra_symbols || []
        applyStatus(msg, [...new Set([...(msg.symbols || []), ...indexList, ...extraList])])
        return
      }
      const nested = msg.tick && typeof msg.tick === "object" ? msg.tick : msg
      const tick = asTick(nested)
      if (!tick) return
      applyTick(tick, msg.candle)
      setError(null)
    }

    async function loadBars() {
      const bars = await readJson<BarsResponse>("/ma/api/ctp-market/bars")
      if (cancelled) return
      const history = bars.candles || {}
      const merged = { ...candlesRef.current }
      for (const [symbol, rows] of Object.entries(history)) {
        merged[symbol] = mergeCandleSeries(merged[symbol], rows)
      }
      candlesRef.current = merged
      setCandles(merged)
    }

    function nextDelay(ok: boolean, started: number) {
      const target =
        document.visibilityState !== "visible"
          ? HIDDEN_POLL_MS
          : streamingRef.current
            ? SNAPSHOT_MS
            : ok
              ? 200
              : ERROR_POLL_MS
      return Math.max(0, target - (Date.now() - started))
    }

    async function pollLive() {
      if (cancelled || inFlight) return
      inFlight = true
      const started = Date.now()
      let ok = false
      try {
        const live = await readJson<LiveResponse>("/ma/api/ctp-market/live")
        if (!cancelled) {
          applyLive(live)
          setError(null)
          ok = true
        }
      } catch (err) {
        if (!cancelled && !streamingRef.current) {
          setError(err instanceof Error ? err.message : "CTP 行情服务连接失败")
        }
      } finally {
        inFlight = false
        if (!cancelled) pollTimer = window.setTimeout(pollLive, nextDelay(ok, started))
      }
    }

    function startStream() {
      if (cancelled || source) return
      try {
        source = new EventSource("/ma/api/ctp-market/stream")
      } catch {
        streamingRef.current = false
        return
      }
      source.onmessage = (event) => {
        if (cancelled) return
        try {
          ingest(JSON.parse(event.data) as LiveResponse)
          streamingRef.current = true
        } catch {
          // ignore a bad frame
        }
      }
      source.onerror = () => {
        streamingRef.current = false
        source?.close()
        source = null
        if (cancelled) return
        if (document.visibilityState === "visible") void pollLive()
        if (retryTimer) window.clearTimeout(retryTimer)
        retryTimer = window.setTimeout(() => {
          if (!cancelled && !source) startStream()
        }, 1_000)
      }
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
      startStream()
      await pollLive()
    }

    void start()
    barsTimer = window.setInterval(() => {
      void loadBars().catch(() => {})
    }, BARS_REFRESH_MS)

    function onVis() {
      if (document.visibilityState !== "visible") return
      if (!source) startStream()
      if (pollTimer) window.clearTimeout(pollTimer)
      void pollLive()
    }
    document.addEventListener("visibilitychange", onVis)

    return () => {
      cancelled = true
      streamingRef.current = false
      document.removeEventListener("visibilitychange", onVis)
      source?.close()
      if (retryTimer) window.clearTimeout(retryTimer)
      if (pollTimer) window.clearTimeout(pollTimer)
      if (barsTimer) window.clearInterval(barsTimer)
    }
  }, [])

  return { status, error, symbols, quotes, candles }
}
