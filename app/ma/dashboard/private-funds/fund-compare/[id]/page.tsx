"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { FundCompareDetailView } from "@/components/ma/fund-compare-detail-view"
import { FundCompareSectionShell } from "@/components/ma/fund-compare-section-shell"
import { loadFundCompare } from "@/lib/ma-fund-compare-storage"

export default function FundCompareDetailPage() {
  const params = useParams()
  const id = typeof params.id === "string" ? params.id : ""
  const [compare, setCompare] = useState(() => (id ? loadFundCompare(id) : null))
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setCompare(loadFundCompare(id))
    setReady(true)
  }, [id])

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
