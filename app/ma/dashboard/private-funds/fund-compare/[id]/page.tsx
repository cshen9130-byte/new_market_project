"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { FundCompareDetailView } from "@/components/ma/fund-compare-detail-view"
import { FundCompareSectionShell } from "@/components/ma/fund-compare-section-shell"
import {
  adoptOpenedFundCompare,
  saveFundCompare,
  type SavedFundCompare,
} from "@/lib/ma-fund-compare-storage"

export default function FundCompareDetailPage() {
  const params = useParams()
  const paramId = params.id
  const paramKey = Array.isArray(paramId) ? paramId.join("/") : typeof paramId === "string" ? paramId : ""
  const [compare, setCompare] = useState<SavedFundCompare | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function sync() {
      const opened = adoptOpenedFundCompare({
        paramId: paramKey || undefined,
        pathname: window.location.pathname,
        hash: window.location.hash,
      })
      if (opened.compare) {
        if (opened.persisted && window.location.hash.includes("fc=")) {
          window.history.replaceState(
            window.history.state,
            "",
            `${window.location.pathname}${window.location.search}`,
          )
        }
        if (!cancelled) {
          setCompare(opened.compare)
          setReady(true)
        }
        return
      }
      if (/^cmp-\d+$/.test(paramKey)) {
        try {
          const res = await fetch(`/ma/api/fund-compare/open?id=${encodeURIComponent(paramKey)}`, { cache: "no-store" })
          const json = await res.json() as { compare?: SavedFundCompare }
          if (!cancelled && json.compare?.id === paramKey) {
            saveFundCompare(json.compare)
            setCompare(json.compare)
            setReady(true)
            return
          }
        } catch {
          // The page still shows the missing-group state below.
        }
      }
      if (!cancelled) {
        setCompare(null)
        setReady(true)
      }
    }
    function onStorage() {
      void sync()
    }
    void sync()
    window.addEventListener("storage", onStorage)
    return () => {
      cancelled = true
      window.removeEventListener("storage", onStorage)
    }
  }, [paramKey])

  if (!ready) {
    return (
      <FundCompareSectionShell>
        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">加载中…</div>
      </FundCompareSectionShell>
    )
  }

  if (!compare) {
    return (
      <FundCompareSectionShell>
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-sm text-muted-foreground">
          <p>未找到该对比组</p>
          <a href="/ma/dashboard/private-funds?tab=investment&side=inv-compare" className="text-red-600 hover:underline">
            返回基金对比列表
          </a>
        </div>
      </FundCompareSectionShell>
    )
  }

  return (
    <FundCompareSectionShell>
      <FundCompareDetailView compare={compare} />
    </FundCompareSectionShell>
  )
}
