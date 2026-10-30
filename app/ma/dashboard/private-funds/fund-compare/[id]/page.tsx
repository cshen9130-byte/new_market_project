"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { FundCompareDetailView } from "@/components/ma/fund-compare-detail-view"
import { FundCompareSectionShell } from "@/components/ma/fund-compare-section-shell"
import {
  adoptOpenedFundCompare,
  type SavedFundCompare,
} from "@/lib/ma-fund-compare-storage"

export default function FundCompareDetailPage() {
  const params = useParams()
  const paramId = params.id
  const paramKey = Array.isArray(paramId) ? paramId.join("/") : typeof paramId === "string" ? paramId : ""
  const [compare, setCompare] = useState<SavedFundCompare | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    function sync() {
      const opened = adoptOpenedFundCompare({
        paramId: paramKey || undefined,
        pathname: window.location.pathname,
        hash: window.location.hash,
      })
      if (opened.persisted && window.location.hash.includes("fc=")) {
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}`,
        )
      }
      setCompare(opened.compare)
      setReady(true)
    }
    sync()
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
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
