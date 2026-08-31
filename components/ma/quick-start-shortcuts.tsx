"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Clock3 } from "lucide-react"
import { authService, type User } from "@/lib/auth"
import {
  canAccessAiKnowledge,
  canAccessAiResearcher,
  canAccessInvestmentTab,
  canAccessPfOperations,
  isAllowedInvestmentSideItem,
} from "@/lib/permissions"
import {
  describePage,
  formatVisitMeta,
  mergeRecentPages,
  parseRecentPagesPayload,
  rankFrequentPages,
  readLocalRecentPages,
  writeLocalRecentPages,
  type RecentPageHit,
} from "@/lib/client/recent-pages"

function canOpenHref(user: User | null, href: string): boolean {
  if (!user) return false
  const [path, qs = ""] = href.split("?")
  const params = new URLSearchParams(qs)
  if (path.startsWith("/ma/dashboard/ai-knowledge") && !canAccessAiKnowledge(user)) return false
  if (path.startsWith("/ma/dashboard/ai-researcher") && !canAccessAiResearcher(user)) return false
  if (path.startsWith("/ma/dashboard/mom-analysis") && user.role !== "admin" && !user.permissions?.mom) {
    return false
  }
  if (path === "/ma/dashboard/private-funds") {
    const tab = params.get("tab") || ""
    const side = params.get("side") || ""
    if (tab === "operations" && !canAccessPfOperations(user)) return false
    if (tab === "investment") {
      if (!canAccessInvestmentTab(user)) return false
      if (side && !isAllowedInvestmentSideItem(user, side)) return false
    }
  }
  return true
}

export function QuickStartShortcuts() {
  const [user, setUser] = useState<User | null>(null)
  const [pages, setPages] = useState<RecentPageHit[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const current = authService.getCurrentUser()
    setUser(current)
    if (!current?.id) {
      setReady(true)
      return
    }
    const local = readLocalRecentPages(current.id)
    setPages(local)
    setReady(true)
    let cancelled = false
    fetch("/ma/api/recent-pages", {
      headers: { "x-market-user-id": current.id },
      cache: "no-store",
    })
      .then((r) => r.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return
        const remote = parseRecentPagesPayload(data?.pages)
        if (!remote.length) return
        const merged = mergeRecentPages(readLocalRecentPages(current.id), remote)
        writeLocalRecentPages(current.id, merged)
        setPages(merged)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const shortcuts = useMemo(() => {
    const ranked = rankFrequentPages(pages, 8)
    return ranked.filter((hit) => canOpenHref(user, hit.href))
  }, [pages, user])

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {!ready ? (
        <div className="col-span-full rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          正在加载常用入口…
        </div>
      ) : shortcuts.length === 0 ? (
        <div className="col-span-full flex items-start gap-3 rounded-lg border border-dashed p-6">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">暂无常用页面</p>
            <p className="mt-1 text-sm text-muted-foreground">
              浏览各板块后，这里会按当前登录账号显示你最近常用的快捷入口。
            </p>
          </div>
        </div>
      ) : (
        shortcuts.map((hit) => {
          const meta = describePage(hit.href)
          const title = hit.title?.trim() || meta.title
          return (
            <Link
              key={hit.href}
              href={hit.href}
              className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
            >
              <h3 className="font-semibold mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground">{meta.description}</p>
              <p className="mt-2 text-xs text-muted-foreground">{formatVisitMeta(hit)}</p>
            </Link>
          )
        })
      )}
    </div>
  )
}
