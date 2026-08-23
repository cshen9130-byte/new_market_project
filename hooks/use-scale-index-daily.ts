"use client"

import { useEffect, useState } from "react"

import type { ScaleIndexSeries } from "@/lib/client/scale-indices"

type ApiResponse = {
  ok?: boolean
  error?: string
  start_date?: string | null
  end_date?: string | null
  series?: ScaleIndexSeries[]
}

type HookState = {
  series: ScaleIndexSeries[]
  error: string | null
}

let cached: HookState | null = null
let inflight: Promise<HookState> | null = null

async function loadScaleIndexDaily(): Promise<HookState> {
  if (cached) return cached
  if (!inflight) {
    inflight = fetch("/ma/api/realtime-quotes/scale-index-daily", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as ApiResponse
        if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
        cached = { series: json.series || [], error: null }
        return cached
      })
      .catch((err) => {
        const error = err instanceof Error ? err.message : "规模指数加载失败"
        if (!cached) cached = { series: [], error }
        return { series: cached.series, error }
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useScaleIndexDaily() {
  const [series, setSeries] = useState<ScaleIndexSeries[]>(cached?.series ?? [])
  const [error, setError] = useState<string | null>(cached?.error ?? null)
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    let cancelled = false
    void loadScaleIndexDaily().then((state) => {
      if (cancelled) return
      setSeries(state.series)
      setError(state.error)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { series, error, loading }
}
