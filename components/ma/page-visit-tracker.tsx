"use client"

import { useEffect, useRef } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import {
  isTrackableUserId,
  mergeRecentPages,
  normalizePageHref,
  parseRecentPagesPayload,
  readLocalRecentPages,
  recordPageVisit,
  shouldApplyHeadingHint,
  shouldTrackHref,
  writeLocalRecentPages,
} from "@/lib/client/recent-pages"

const SYNC_DEBOUNCE_MS = 2500

function authHeaders(userId: string): HeadersInit {
  return { "x-market-user-id": userId, "Content-Type": "application/json" }
}

function pageHeading(): string {
  if (typeof document === "undefined") return ""
  const h1 = document.querySelector("main h1, h1")
  return (h1?.textContent || "").replace(/\s+/g, " ").trim()
}

export function PageVisitTracker({ userId }: { userId: string | null | undefined }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const id = userId?.trim()
    if (!isTrackableUserId(id) || !id) return

    const href = normalizePageHref(pathname || "/", `?${searchParams.toString()}`)
    if (!shouldTrackHref(href)) return

    recordPageVisit(id, href)

    const headingTimer = window.setTimeout(() => {
      const heading = pageHeading()
      if (heading && shouldApplyHeadingHint(href, heading)) {
        recordPageVisit(id, href, heading)
      }
    }, 1400)

    if (syncTimer.current) clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => {
      const local = readLocalRecentPages(id)
      fetch("/ma/api/recent-pages", {
        method: "PUT",
        headers: authHeaders(id),
        body: JSON.stringify({ pages: local }),
        cache: "no-store",
      })
        .then((r) => r.json().catch(() => ({})))
        .then((data) => {
          const remote = parseRecentPagesPayload(data?.pages)
          if (!remote.length) return
          writeLocalRecentPages(id, mergeRecentPages(readLocalRecentPages(id), remote))
        })
        .catch(() => {})
    }, SYNC_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(headingTimer)
    }
  }, [userId, pathname, searchParams.toString()])

  return null
}
