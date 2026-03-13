"use client"

import { useState } from "react"
import CurrentMarketPredictionChart, { Freq } from "@/components/charts/current-market-prediction-chart"
import EconomicQuadrantChart from "@/components/charts/economic-quadrant-chart"

export default function MarketPredictionSection() {
  const [freq, setFreq] = useState<Freq>("daily")

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <CurrentMarketPredictionChart freq={freq} onFreqChange={setFreq} />
      <EconomicQuadrantChart freq={freq} />
    </div>
  )
}
