"use client"

import { useState } from "react"
import CurrentMarketPredictionChart, { Freq, FREQ_LABELS } from "@/components/charts/current-market-prediction-chart"
import EconomicQuadrantChart from "@/components/charts/economic-quadrant-chart"
import { cn } from "@/lib/utils"

export default function MarketPredictionSection() {
  const [freq, setFreq] = useState<Freq>("daily")

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-1">
        {(Object.keys(FREQ_LABELS) as Freq[]).map((f) => (
          <button
            key={f}
            onClick={() => setFreq(f)}
            className={cn(
              "px-2.5 py-0.5 rounded text-xs font-medium transition-colors",
              freq === f
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {FREQ_LABELS[f]}
          </button>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <CurrentMarketPredictionChart freq={freq} onFreqChange={setFreq} />
        <EconomicQuadrantChart freq={freq} />
      </div>
    </div>
  )
}
