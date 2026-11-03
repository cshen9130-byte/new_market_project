"use client"

import { useEffect, useState } from "react"

import type { CffexContractRole } from "@/lib/client/cffex-expiry"
import type { IndexProduct } from "@/lib/client/ctp-market"
import { isIntradayTimeframe, type TimeframeId } from "@/lib/client/timeframes"

export type BasisRatePoint = { time: number; value: number }

type RoleBook = Partial<Record<CffexContractRole, BasisRatePoint[]>>

export function useRollingBasisRate(product: IndexProduct | null, interval: TimeframeId) {
  const higher = !isIntradayTimeframe(interval)
  const [roles, setRoles] = useState<RoleBook | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!product || !higher) return
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/ma/api/realtime-quotes/basis-rate?product=${product}`, { cache: "no-store" })
        const json = (await res.json()) as { ok?: boolean; error?: string; roles?: RoleBook }
        if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
        if (cancelled) return
        setRoles(json.roles ?? {})
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "基差率获取失败")
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [higher, product])

  return { roles: higher ? roles : null, error: higher ? error : null }
}

export function useOwnContractBasis(symbol: string | null, interval: TimeframeId) {
  const higher = !isIntradayTimeframe(interval)
  const [points, setPoints] = useState<BasisRatePoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!symbol || !higher) return
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(
          `/ma/api/realtime-quotes/basis-rate?symbol=${encodeURIComponent(symbol!)}`,
          { cache: "no-store" },
        )
        const json = (await res.json()) as { ok?: boolean; error?: string; points?: BasisRatePoint[] }
        if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`)
        if (cancelled) return
        setPoints(json.points ?? [])
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "基差率获取失败")
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [higher, symbol])

  return { points: higher ? points : null, error: higher ? error : null }
}
