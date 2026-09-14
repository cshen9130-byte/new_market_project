"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Info, X } from "lucide-react"

export type ShareClassChild = {
  beian_hao: string
  product_name: string
  synthetic?: boolean
  latest_nav_date?: string | null
  share_class?: "A" | "B" | "C" | null
}

function parentCandidates(beian: string): string[] {
  const c = beian.trim().toUpperCase()
  if (!c) return []
  const out = new Set([c])
  if (/[ABC]$/i.test(c)) {
    let family = c.replace(/[ABC]$/i, "")
    if (family.startsWith("S") && family.length > 1) {
      const withoutS = family.slice(1)
      if (/^[A-Z][A-Z0-9]{4,7}$/.test(withoutS)) family = withoutS
    }
    if (family) {
      out.add(family)
      out.add(`S${family}`)
    }
  }
  return [...out]
}

function shortClassName(name: string): string {
  return name
    .replace(/私募证券投资基金/g, "")
    .replace(/私募股权投资基金/g, "")
    .replace(/私募基金/g, "")
    .trim() || name
}

function sameBeian(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase()
}

export function ShareClassNavBanner({ beianHao }: { beianHao: string }) {
  const [rows, setRows] = useState<ShareClassChild[]>([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const parents = parentCandidates(beianHao)
    if (parents.length === 0) {
      setRows([])
      setDismissed(false)
      return
    }

    let cancelled = false
    setDismissed(false)
    setRows([])

    fetch(`/ma/api/private-funds/share-classes?parents=${encodeURIComponent(parents.join(","))}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { data?: Record<string, ShareClassChild[]> } | null) => {
        if (cancelled) return
        const seen = new Set<string>()
        const merged: ShareClassChild[] = []
        for (const list of Object.values(payload?.data ?? {})) {
          for (const row of list ?? []) {
            const key = (row.beian_hao ?? "").trim().toUpperCase()
            if (!key || seen.has(key) || sameBeian(key, beianHao)) continue
            if (row.synthetic) continue
            seen.add(key)
            merged.push(row)
          }
        }
        merged.sort((a, b) => (a.share_class ?? "Z").localeCompare(b.share_class ?? "Z"))
        setRows(merged)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })

    return () => {
      cancelled = true
    }
  }, [beianHao])

  if (dismissed || rows.length === 0) return null

  return (
    <div className="mb-4 rounded border border-[#c5e0f5] bg-[#eef6fc] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#2b7bb9]" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          {rows.map((row) => {
            const name = shortClassName(row.product_name)
            const date = (row.latest_nav_date ?? "").slice(0, 10)
            const text = date
              ? `${name}, 净值已更新至${date}, 您可点击前往查看净值分析`
              : `${name}, 您可点击前往查看净值分析`
            return (
              <Link
                key={row.beian_hao}
                href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beian_hao)}`}
                className="block text-sm text-[#2b7bb9] hover:underline"
                title={row.product_name}
              >
                {text}
              </Link>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded p-0.5 text-[#7aa7c9] hover:bg-white/70 hover:text-[#2b7bb9]"
          aria-label="关闭分级提示"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
