"use client"

import { useEffect, useState } from "react"

import type { IndexProduct } from "@/lib/client/ctp-market"

export type IvContractOption = { id: string; label: string; atm: boolean }

export function useIvContracts(product: IndexProduct, month?: string | null) {
  const monthKey = (month || "").trim().toUpperCase()
  const [contracts, setContracts] = useState<IvContractOption[]>([])

  useEffect(() => {
    let cancelled = false
    setContracts([])
    async function load() {
      try {
        const qs = new URLSearchParams({ product })
        if (monthKey) qs.set("month", monthKey)
        const res = await fetch(`/ma/api/realtime-quotes/iv-contracts?${qs.toString()}`, { cache: "no-store" })
        const json = (await res.json()) as { ok?: boolean; contracts?: IvContractOption[] }
        if (!res.ok || json.ok === false) return
        if (!cancelled) setContracts(json.contracts || [])
      } catch {
        if (!cancelled) setContracts([])
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [monthKey, product])

  return contracts
}
