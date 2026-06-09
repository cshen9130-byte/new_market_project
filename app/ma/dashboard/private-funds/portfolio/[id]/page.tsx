"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { PortfolioDetailView } from "@/components/ma/portfolio-detail-view"
import { PortfolioSectionShell } from "@/components/ma/portfolio-free-create-wizard"
import { loadPortfolio, type SavedPortfolio } from "@/lib/ma-portfolio-storage"

export default function PortfolioDetailPage() {
  const params = useParams()
  const id = typeof params.id === "string" ? params.id : ""
  const [portfolio, setPortfolio] = useState<SavedPortfolio | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setPortfolio(loadPortfolio(id))
    setReady(true)
  }, [id])

  if (!ready) {
    return (
      <PortfolioSectionShell activeSideItem="port-simulated">
        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">加载中…</div>
      </PortfolioSectionShell>
    )
  }

  if (!portfolio) {
    return (
      <PortfolioSectionShell activeSideItem="port-simulated">
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-sm text-muted-foreground">
          <p>未找到该组合</p>
          <a href="/ma/dashboard/private-funds?tab=portfolio&side=port-simulated" className="text-red-600 hover:underline">
            返回模拟组合列表
          </a>
        </div>
      </PortfolioSectionShell>
    )
  }

  return (
    <PortfolioSectionShell activeSideItem="port-simulated">
      <PortfolioDetailView portfolio={portfolio} />
    </PortfolioSectionShell>
  )
}
