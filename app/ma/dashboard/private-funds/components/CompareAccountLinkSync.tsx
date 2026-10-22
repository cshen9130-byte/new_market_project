"use client"

import { useEffect } from "react"
import type { User } from "@/lib/auth"
import { canAccessTraderManage, canModifyCompareAccount } from "@/lib/permissions"

const STORAGE_PREFIX = "pf-compare-account:"

/** Upload this browser's remembered MOM compare accounts so MOM底层 can list them. */
export function CompareAccountLinkSync({ user }: { user: User }) {
  const userId = user?.id ?? ""
  const allowed = canModifyCompareAccount(user) || canAccessTraderManage(user)

  useEffect(() => {
    if (!userId || !allowed) return
    const flag = `pf-compare-links-synced:${userId}`
    try {
      if (sessionStorage.getItem(flag)) return
    } catch {
      return
    }

    const prefix = `${STORAGE_PREFIX}${userId}:`
    const links: Array<{ beian_hao: string; account: string }> = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key?.startsWith(prefix)) continue
        const beian = key.slice(prefix.length).trim()
        const account = (localStorage.getItem(key) || "").trim()
        if (!beian || !account || account.toLowerCase().startsWith("cfmmc:")) continue
        links.push({ beian_hao: beian, account })
      }
    } catch {
      return
    }

    if (links.length === 0) {
      try { sessionStorage.setItem(flag, "1") } catch { /* ignore */ }
      return
    }

    fetch("/ma/api/ops/fund-mom-accounts/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-market-user-id": userId,
      },
      body: JSON.stringify({ mode: "fill", links }),
    })
      .then((res) => {
        if (res.ok) {
          try { sessionStorage.setItem(flag, "1") } catch { /* ignore */ }
        }
      })
      .catch(() => {})
  }, [userId, allowed])

  return null
}
