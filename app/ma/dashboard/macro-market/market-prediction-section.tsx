"use client"

import { useState } from "react"
import CurrentMarketPredictionChart, { Freq } from "@/components/charts/current-market-prediction-chart"
import EconomicQuadrantChart from "@/components/charts/economic-quadrant-chart"
import PcaBiplotChart from "@/components/charts/pca-biplot-chart"
import AssetReturnsChart from "@/components/charts/asset-returns-chart"
import PredictionTimeseriesChart from "@/components/charts/prediction-timeseries-chart"
import RegimeSimilarityChart from "@/components/charts/regime-similarity-chart"
import MoneyCreditChart from "@/components/charts/money-credit-chart"

export default function MarketPredictionSection() {
  const [freq, setFreq] = useState<Freq>("daily")

  return (
    <div className="flex flex-col gap-6">
      <div id="pca-section" className="flex items-center gap-3 scroll-mt-4">
        <h2 className="text-lg font-semibold tracking-tight">PCA 聚类模型</h2>
        <div className="flex-1 border-t border-border" />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <CurrentMarketPredictionChart freq={freq} onFreqChange={setFreq} />
        <EconomicQuadrantChart freq={freq} onFreqChange={setFreq} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <PcaBiplotChart freq={freq} onFreqChange={setFreq} />
        <AssetReturnsChart freq={freq} />
      </div>
      <PredictionTimeseriesChart freq={freq} onFreqChange={setFreq} />

      <div id="regime-section" className="flex items-center gap-3 scroll-mt-4">
        <h2 className="text-lg font-semibold tracking-tight">经济体制相似性模型</h2>
        <div className="flex-1 border-t border-border" />
      </div>
      <RegimeSimilarityChart />

      <div id="money-credit-section" className="flex items-center gap-3 scroll-mt-4">
        <h2 className="text-lg font-semibold tracking-tight">货币+信用 周期模型</h2>
        <div className="flex-1 border-t border-border" />
      </div>
      <MoneyCreditChart />
    </div>
  )
}
