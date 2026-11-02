"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

import {
  ACCOUNT_SHORTCUTS_EVENT,
  DEFAULT_ACCOUNT_SHORTCUTS,
  SHORTCUT_CAPTURE_ATTR,
  shortcutComboFromEvent,
  type AccountShortcut,
} from "@/lib/ma/account-shortcuts"
import type { AccountDashboardPrefs } from "@/lib/ma/account-dashboard"

export function AccountShortcutListener({ userId }: { userId: string }) {
  const router = useRouter()
  const shortcutsRef = useRef<AccountShortcut[]>(DEFAULT_ACCOUNT_SHORTCUTS)

  useEffect(() => {
    let cancelled = false
    let localEdit = false
    function apply(next: AccountShortcut[]) {
      shortcutsRef.current = next
    }
    apply(DEFAULT_ACCOUNT_SHORTCUTS)
    function onUpdate(event: Event) {
      const detail = (event as CustomEvent<AccountShortcut[]>).detail
      if (!Array.isArray(detail)) return
      localEdit = true
      apply(detail)
    }
    window.addEventListener(ACCOUNT_SHORTCUTS_EVENT, onUpdate)
    fetch("/ma/api/account-dashboard", {
      headers: { "x-market-user-id": userId },
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.ok) return
        const prefs = data.prefs as AccountDashboardPrefs
        if (!cancelled && !localEdit && Array.isArray(prefs?.shortcuts)) apply(prefs.shortcuts)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      window.removeEventListener(ACCOUNT_SHORTCUTS_EVENT, onUpdate)
    }
  }, [userId])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (document.documentElement.hasAttribute(SHORTCUT_CAPTURE_ATTR)) return
      const combo = shortcutComboFromEvent(event)
      if (!combo) return
      const hit = shortcutsRef.current.find((item) => item.combo === combo)
      if (!hit) return
      event.preventDefault()
      event.stopPropagation()
      if (hit.newTab) {
        const opened = window.open(hit.href, "_blank")
        if (opened) opened.opener = null
        else router.push(hit.href)
        return
      }
      router.push(hit.href)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [router])

  return null
}
