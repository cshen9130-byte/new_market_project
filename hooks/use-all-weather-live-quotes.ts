"use client"

import { useEffect, useRef, useState } from "react"

import { authService } from "@/lib/auth"
import type { CtpTick } from "@/lib/client/ctp-market"

type ApiResponse = {
  ok?: boolean
  error?: string
  quotes?: Record<string, CtpTick>
  source?: string
  liveCount?: number
}

const POLL_MS = 5_000
const ERROR_POLL_MS = 8_000

function headers() {
  const user = authService.getCurrentUser()
  return user
    ? { "x-market-user-id": user.id, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" }
}

function quotesFingerprint(quotes: Record<string, CtpTick>) {
  let out = ""
  for (const key of Object.keys(quotes).sort()) {
    const t = quotes[key]
    out += `${key}:${t.last}:${t.bid}:${t.ask}:${t.update_time};`
  }
  return out
}

export function useAllWeatherLiveQuotes(enabled: boolean, variantId: string) {
  const [quotes, setQuotes] = useState<Record<string, CtpTick>>({})
  const [source, setSource] = useState<string | null>(null)
  const [liveCount, setLiveCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fpRef = useRef("")

  useEffect(() => {
    if (!enabled || !variantId) return
    let cancelled = false
    let timer: number | undefined

    async function load() {
      const started = Date.now()
      let ok = false
      try {
        const res = await fetch(`/api/all-weather/live-quotes?variant=${encodeURIComponent(variantId)}`, {
          headers: headers(),
          cache: "no-store",
        })
        const json = (await res.json()) as ApiResponse
        if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
        if (cancelled) return
        const next = json.quotes || {}
        const fp = quotesFingerprint(next)
        if (fp !== fpRef.current) {
          fpRef.current = fp
          setQuotes(next)
        }
        setSource(json.source ?? "sina")
        setLiveCount(json.liveCount ?? 0)
        setError(null)
        ok = true
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "备用行情获取失败")
      }
      if (!cancelled) {
        const delay = Math.max(0, (ok ? POLL_MS : ERROR_POLL_MS) - (Date.now() - started))
        timer = window.setTimeout(load, delay)
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [enabled, variantId])

  return { quotes, source, liveCount, error }
}
