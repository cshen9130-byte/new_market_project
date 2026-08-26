"use client"

import { useEffect } from "react"

const PING_MS = 20_000

/** Tells the server which logged-in user still has this tab open. */
export function usePresenceHeartbeat(userId: string | null | undefined, pathname: string) {
  useEffect(() => {
    const id = userId?.trim()
    if (!id) return

    let cancelled = false
    const ping = () => {
      if (cancelled || (typeof document !== "undefined" && document.visibilityState === "hidden")) return
      fetch(`/api/presence?path=${encodeURIComponent(pathname || "/")}`, {
        headers: { "x-market-user-id": id },
        cache: "no-store",
      }).catch(() => {})
    }

    ping()
    const timer = setInterval(ping, PING_MS)
    const onVis = () => {
      if (document.visibilityState === "visible") ping()
    }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [userId, pathname])
}
