"use client"

import { useEffect, useState } from "react"

import type { CtpTick } from "@/lib/client/ctp-market"

type ApiResponse = {
  ok?: boolean
  error?: string
  quotes?: Record<string, CtpTick>
  asOf?: string | null
}

const POLL_MS = 15_000

export function useCffexListedQuotes() {
  const [quotes, setQuotes] = useState<Record<string, CtpTick>>({})
  const [asOf, setAsOf] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    async function load() {
      try {
        const res = await fetch("/ma/api/realtime-quotes/listed-quotes", { cache: "no-store" })
        const json = (await res.json()) as ApiResponse
        if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
        if (cancelled) return
        setQuotes((prev) => ({ ...prev, ...(json.quotes || {}) }))
        if (json.asOf) setAsOf(json.asOf)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "合约行情获取失败")
      }
      if (!cancelled) timer = window.setTimeout(load, POLL_MS)
    }

    void load()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  return { quotes, asOf, error }
}
