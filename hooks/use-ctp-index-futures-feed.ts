"use client"

import { useEffect, useRef, useState } from "react"

import {
  type CtpCandle,
  type CtpStatus,
  type CtpTick,
  upsertCandle,
} from "@/lib/client/ctp-market"

const DEFAULT_WS_URL = "ws://127.0.0.1:8000/ws"
const INDEX_SYMBOL_RE = /^(IH|IF|IC|IM)\d{4}$/i

function wsUrl() {
  return process.env.NEXT_PUBLIC_CTP_MARKET_WS_URL || DEFAULT_WS_URL
}

function isIndexSymbol(symbol: string) {
  return INDEX_SYMBOL_RE.test(symbol)
}

function tickFromMessage(raw: Record<string, unknown> | null | undefined): CtpTick | null {
  if (!raw || typeof raw.symbol !== "string") return null
  return {
    symbol: raw.symbol,
    last: typeof raw.last === "number" ? raw.last : null,
    bid: typeof raw.bid === "number" ? raw.bid : null,
    ask: typeof raw.ask === "number" ? raw.ask : null,
    volume: typeof raw.volume === "number" ? raw.volume : null,
    open_interest: typeof raw.open_interest === "number" ? raw.open_interest : null,
    pre_close: typeof raw.pre_close === "number" ? raw.pre_close : null,
    pre_settlement: typeof raw.pre_settlement === "number" ? raw.pre_settlement : null,
    update_time: typeof raw.update_time === "string" ? raw.update_time : null,
    update_millis: typeof raw.update_millis === "number" ? raw.update_millis : null,
  }
}

export function useCtpIndexFuturesFeed() {
  const [status, setStatus] = useState<CtpStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [symbols, setSymbols] = useState<string[]>([])
  const [quotes, setQuotes] = useState<Record<string, CtpTick>>({})
  const [candles, setCandles] = useState<Record<string, CtpCandle[]>>({})
  const candlesRef = useRef<Record<string, CtpCandle[]>>({})
  const quotesRef = useRef<Record<string, CtpTick>>({})
  const requestedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let stopped = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | undefined
    let quotesRaf = 0
    let candlesTimer: number | undefined
    let candlesDirty = false

    function flushQuotes() {
      quotesRaf = 0
      setQuotes({ ...quotesRef.current })
    }

    function scheduleQuotes() {
      if (!quotesRaf) quotesRaf = requestAnimationFrame(flushQuotes)
    }

    function flushCandles() {
      candlesTimer = undefined
      if (!candlesDirty) return
      candlesDirty = false
      setCandles({ ...candlesRef.current })
    }

    function scheduleCandles() {
      candlesDirty = true
      if (candlesTimer == null) candlesTimer = window.setTimeout(flushCandles, 200)
    }

    function applyTick(tick: CtpTick, candle?: CtpCandle | null) {
      quotesRef.current = { ...quotesRef.current, [tick.symbol]: tick }
      scheduleQuotes()
      if (candle?.time) {
        candlesRef.current = {
          ...candlesRef.current,
          [tick.symbol]: upsertCandle(candlesRef.current[tick.symbol], candle),
        }
        scheduleCandles()
      }
    }

    async function seedFromHttp() {
      try {
        const res = await fetch("/ma/api/ctp-market/live", { cache: "no-store" })
        const json = (await res.json()) as {
          ok?: boolean
          items?: Record<string, { tick: CtpTick | null; candle: CtpCandle | null }>
          index_symbols?: string[]
          symbols?: string[]
          connected?: boolean
          logged_in?: boolean
          message?: string
          tick_count?: number
        }
        if (stopped || json.ok === false || !json.items) return
        const list = json.index_symbols || json.symbols || []
        if (list.length) setSymbols(list)
        for (const [symbol, item] of Object.entries(json.items)) {
          if (item.tick) applyTick(item.tick, item.candle)
          else if (item.candle) {
            candlesRef.current = {
              ...candlesRef.current,
              [symbol]: upsertCandle(candlesRef.current[symbol], item.candle),
            }
            scheduleCandles()
          }
        }
      } catch {
        // WS snapshot still covers candles if the HTTP cache endpoint is down.
      }
    }

    function requestSnapshots(ws: WebSocket, list: string[]) {
      for (const symbol of list) {
        if (!isIndexSymbol(symbol) || requestedRef.current.has(symbol)) continue
        requestedRef.current.add(symbol)
        ws.send(JSON.stringify({ type: "snapshot", symbol }))
      }
    }

    function connect() {
      if (stopped) return
      const ws = new WebSocket(wsUrl())
      socket = ws

      ws.onopen = () => {
        if (stopped) return
        setError(null)
        void seedFromHttp()
      }

      ws.onclose = () => {
        if (stopped) return
        setError("CTP WebSocket 已断开，正在重连…")
        requestedRef.current.clear()
        reconnectTimer = window.setTimeout(connect, 1500)
      }

      ws.onerror = () => {
        if (stopped) return
        setError("无法连接 CTP 行情 WebSocket（默认 ws://127.0.0.1:8000/ws）。请确认 ctp_market 已运行 python server.py")
      }

      ws.onmessage = (event) => {
        if (stopped) return
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(String(event.data))
        } catch {
          return
        }
        const type = msg.type

        if (type === "status") {
          const list = Array.isArray(msg.symbols) ? (msg.symbols as string[]) : []
          setStatus({
            connected: Boolean(msg.connected),
            logged_in: Boolean(msg.logged_in),
            profile: typeof msg.profile === "string" ? msg.profile : undefined,
            front: typeof msg.front === "string" ? msg.front : undefined,
            message: typeof msg.message === "string" ? msg.message : undefined,
            tick_count: typeof msg.tick_count === "number" ? msg.tick_count : undefined,
            symbols: list,
            index_symbols: list.filter(isIndexSymbol),
          })
          setSymbols(list)
          requestSnapshots(ws, list)
          return
        }

        if (type === "snapshot") {
          const symbol = String(msg.symbol || "")
          const rows = Array.isArray(msg.candles) ? (msg.candles as CtpCandle[]) : []
          if (!symbol) return
          candlesRef.current = { ...candlesRef.current, [symbol]: rows }
          scheduleCandles()
          return
        }

        if (type === "tick") {
          const rawTick = (msg.tick && typeof msg.tick === "object" ? msg.tick : msg) as Record<string, unknown>
          const tick = tickFromMessage(rawTick)
          if (!tick || !isIndexSymbol(tick.symbol)) return
          applyTick(tick, msg.candle as CtpCandle | undefined)
        }
      }
    }

    connect()

    return () => {
      stopped = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (quotesRaf) cancelAnimationFrame(quotesRaf)
      if (candlesTimer) window.clearTimeout(candlesTimer)
      socket?.close()
    }
  }, [])

  return { status, error, symbols, quotes, candles }
}
