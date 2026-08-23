"use client"

import { useEffect, useState } from "react"

export type TurnoverConcentrationPoint = {
  date: string
  top1: number
  top5: number
  top10: number
  top25: number
}

type ApiResponse = {
  ok?: boolean
  error?: string
  points?: TurnoverConcentrationPoint[]
}

let cached: { points: TurnoverConcentrationPoint[]; error: string | null } | null = null
let inflight: Promise<{ points: TurnoverConcentrationPoint[]; error: string | null }> | null = null

async function load() {
  if (cached) return cached
  if (!inflight) {
    inflight = fetch("/ma/api/realtime-quotes/turnover-concentration", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as ApiResponse
        if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
        cached = { points: json.points || [], error: null }
        return cached
      })
      .catch((err) => {
        const error = err instanceof Error ? err.message : "成交集中度加载失败"
        if (!cached) cached = { points: [], error }
        return { points: cached.points, error }
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useAshareTurnoverConcentration() {
  const [points, setPoints] = useState<TurnoverConcentrationPoint[]>(cached?.points ?? [])
  const [error, setError] = useState<string | null>(cached?.error ?? null)
  const [loading, setLoading] = useState(!cached)

  useEffect(() => {
    let cancelled = false
    void load().then((state) => {
      if (cancelled) return
      setPoints(state.points)
      setError(state.error)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { points, error, loading }
}
