"use client"

import { useEffect, useState } from "react"

import type { ScaleIndexBeatSeries, ScaleIndexFreq } from "@/lib/client/scale-indices"

type ApiResponse = {
  ok?: boolean
  error?: string
  series?: ScaleIndexBeatSeries[]
}

type HookState = {
  series: ScaleIndexBeatSeries[]
  error: string | null
}

const cached = new Map<ScaleIndexFreq, HookState>()
const inflight = new Map<ScaleIndexFreq, Promise<HookState>>()

async function loadBeatRatio(freq: ScaleIndexFreq): Promise<HookState> {
  const hit = cached.get(freq)
  if (hit) return hit
  const pending = inflight.get(freq)
  if (pending) return pending
  const req = fetch(`/ma/api/realtime-quotes/scale-index-beat-ratio?freq=${freq}`, { cache: "no-store" })
    .then(async (res) => {
      const json = (await res.json()) as ApiResponse
      if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
      const state = { series: json.series || [], error: null }
      cached.set(freq, state)
      return state
    })
    .catch((err) => {
      const error = err instanceof Error ? err.message : "跑赢占比加载失败"
      const prev = cached.get(freq)
      if (!prev) cached.set(freq, { series: [], error })
      return { series: prev?.series ?? [], error }
    })
    .finally(() => {
      inflight.delete(freq)
    })
  inflight.set(freq, req)
  return req
}

export function useScaleIndexBeatRatio(freq: ScaleIndexFreq) {
  const initial = cached.get(freq)
  const [series, setSeries] = useState<ScaleIndexBeatSeries[]>(initial?.series ?? [])
  const [error, setError] = useState<string | null>(initial?.error ?? null)
  const [loading, setLoading] = useState(!initial)

  useEffect(() => {
    let cancelled = false
    const hit = cached.get(freq)
    if (hit) {
      setSeries(hit.series)
      setError(hit.error)
      setLoading(false)
    } else {
      setLoading(true)
    }
    void loadBeatRatio(freq).then((state) => {
      if (cancelled) return
      setSeries(state.series)
      setError(state.error)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [freq])

  return { series, error, loading }
}
