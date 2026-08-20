"use client"

import { useEffect, useState } from "react"

import { stabilizeOverlay, type LiveOverlayResponse } from "@/lib/client/realtime-overlay"

const POLL_MS = 2000

export function useRealtimeOverlayFeed() {
  const [data, setData] = useState<LiveOverlayResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    async function poll() {
      if (cancelled) return
      try {
        const res = await fetch("/ma/api/realtime-quotes/overlay", { cache: "no-store" })
        const json = (await res.json()) as LiveOverlayResponse
        if (!res.ok || json.ok === false) {
          throw new Error(json.error || `请求失败 ${res.status}`)
        }
        if (!cancelled) {
          setData((prev) => stabilizeOverlay(prev, json))
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "现货/IV 行情获取失败")
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS)
    }

    void poll()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  return { spots: data?.spots || {}, iv: data?.iv || {}, error }
}
