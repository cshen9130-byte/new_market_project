"use client"

import MarketPredictionSection from "./market-prediction-section"

export default function Page() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">宏观市场分析</h1>
        <p className="text-muted-foreground mt-2">经济指标与全球市场趋势</p>
      </div>
      <MarketPredictionSection />
    </div>
  )
}
