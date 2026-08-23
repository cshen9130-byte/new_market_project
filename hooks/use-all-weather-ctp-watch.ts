"use client"

import { useEffect, useRef } from "react"

import { authService } from "@/lib/auth"

const HEARTBEAT_MS = 12_000

function headers() {
  const user = authService.getCurrentUser()
  return user
    ? { "x-market-user-id": user.id, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" }
}

export function useAllWeatherCtpWatch(enabled: boolean, extraSymbols: string[] = []) {
  const extrasRef = useRef(extraSymbols)
  extrasRef.current = extraSymbols

  useEffect(() => {
    if (!enabled) return
    const watcherId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? `aw-${crypto.randomUUID()}`
        : `aw-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let cancelled = false
    let timer: number | undefined

    async function beat() {
      if (cancelled || document.visibilityState !== "visible") return
      try {
        await fetch("/ma/api/ctp-market/watch", {
          method: "POST",
          headers: headers(),
          cache: "no-store",
          body: JSON.stringify({ watcherId, symbols: extrasRef.current }),
        })
      } catch {
        // ctp_market may be offline; Sina marks still cover the book
      }
    }

    async function stop() {
      try {
        await fetch("/ma/api/ctp-market/unwatch", {
          method: "POST",
          headers: headers(),
          cache: "no-store",
          keepalive: true,
          body: JSON.stringify({ watcherId }),
        })
      } catch {
        // TTL drops the watcher if this request is lost
      }
    }

    function onVis() {
      if (document.visibilityState === "visible") void beat()
      else void stop()
    }

    const onHide = () => {
      void stop()
    }

    void beat()
    timer = window.setInterval(() => void beat(), HEARTBEAT_MS)
    document.addEventListener("visibilitychange", onVis)
    window.addEventListener("pagehide", onHide)

    return () => {
      cancelled = true
      if (timer) window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVis)
      window.removeEventListener("pagehide", onHide)
      void stop()
    }
  }, [enabled])
}
