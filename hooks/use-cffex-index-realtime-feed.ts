"use client"

import { useEffect, useState } from "react"

import {
  INDEX_FUTURES,
  type CtpCandle,
  type CtpTick,
  mergeCandleSeries,
} from "@/lib/client/ctp-market"

type ProductRow = {
  product: string
  name: string
  symbol: string
  candles: CtpCandle[]
  quote: CtpTick
}

type ApiResponse = {
  ok?: boolean
  error?: string
  source?: string
  products?: ProductRow[]
}

const POLL_MS = 2000

export function useCffexIndexRealtimeFeed() {
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<string>("")
  const [updatedAt, setUpdatedAt] = useState<string>("")
  const [quotes, setQuotes] = useState<Record<string, CtpTick>>({})
  const [candles, setCandles] = useState<Record<string, CtpCandle[]>>({})
  const [symbols, setSymbols] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    async function load() {
      try {
        const res = await fetch("/ma/api/realtime-quotes/cffex", { cache: "no-store" })
        const json = (await res.json()) as ApiResponse
        if (!res.ok || json.ok === false) {
          throw new Error(json.error || `请求失败 ${res.status}`)
        }
        if (cancelled) return
        const nextQuotes: Record<string, CtpTick> = {}
        const nextCandles: Record<string, CtpCandle[]> = {}
        const nextSymbols: string[] = []
        for (const row of json.products || []) {
          nextSymbols.push(row.symbol)
          nextQuotes[row.symbol] = row.quote
          nextCandles[row.symbol] = row.candles
        }
        setQuotes(nextQuotes)
        setCandles((prev) => {
          const merged = { ...nextCandles }
          for (const [symbol, rows] of Object.entries(merged)) {
            const old = prev[symbol]
            if (old?.length >= 16 && rows.length < old.length * 0.6) {
              merged[symbol] = mergeCandleSeries(old, rows)
            }
          }
          return merged
        })
        setSymbols(nextSymbols)
        setSource(json.source || "sina")
        const times = (json.products || []).map((row) => row.quote.update_time).filter(Boolean)
        setUpdatedAt(times[0] || "")
        setError(null)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "实时行情获取失败")
        }
      }
      if (!cancelled) timer = window.setTimeout(load, POLL_MS)
    }

    void load()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  const productSymbol: Record<string, string> = {}
  for (const item of INDEX_FUTURES) {
    const match = symbols.find((s) => s.toUpperCase().startsWith(item.product))
    if (match) productSymbol[item.product] = match
  }

  return { error, source, updatedAt, quotes, candles, symbols, productSymbol }
}
