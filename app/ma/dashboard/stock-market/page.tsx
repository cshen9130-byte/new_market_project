"use client"

import dynamic from "next/dynamic"

const AshareCrowdingChart = dynamic(
  () => import("@/components/charts/ashare-crowding-chart"),
  { ssr: false },
)

export default function StockMarketPage() {
  return (
    <div className="space-y-6 pt-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">股票市场分析</h1>
        <p className="text-muted-foreground mt-2">A股市场情绪与成交额集中度分析</p>
      </div>

      <AshareCrowdingChart />
    </div>
  )
}
