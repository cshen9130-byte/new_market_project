"use client"

import { useEffect, useState } from "react"

export type BasisDiffPoint = {
  date: string
  basis_diff: number | null
  spot_close?: number | null
  futures_settle?: number | null
}

export type BasisContDiffResponse = {
  start_date: string
  end_date: string
  data: Record<string, Record<string, BasisDiffPoint[]>>
}

export function useBasisContDiffTimeseries() {
  const [data, setData] = useState<BasisContDiffResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch("/ma/api/basis/cont-diff-timeseries", { cache: "no-store" })
        const json = (await res.json()) as BasisContDiffResponse & { error?: string }
        if (!res.ok) throw new Error(json.error || `请求失败 ${res.status}`)
        if (cancelled) return
        setData(json)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "基差走势加载失败")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return { data, error, loading }
}
