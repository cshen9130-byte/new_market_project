"use client"

import { useState } from "react"
import CurrentMarketPredictionChart, { Freq } from "@/components/charts/current-market-prediction-chart"
import EconomicQuadrantChart from "@/components/charts/economic-quadrant-chart"
import PcaBiplotChart from "@/components/charts/pca-biplot-chart"
import AssetReturnsChart from "@/components/charts/asset-returns-chart"

export default function MarketPredictionSection() {
  const [freq, setFreq] = useState<Freq>("daily")

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <CurrentMarketPredictionChart freq={freq} onFreqChange={setFreq} />
        <EconomicQuadrantChart freq={freq} onFreqChange={setFreq} />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <PcaBiplotChart freq={freq} onFreqChange={setFreq} />
        <AssetReturnsChart />
      </div>
    </div>
  )
}
