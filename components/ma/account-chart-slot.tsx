"use client"

import dynamic from "next/dynamic"
import { useState, type ComponentType } from "react"

import { ChartStillProvider, useChartStill } from "@/hooks/chart-still"
import type { FomcChartPart } from "@/app/ma/dashboard/macro-market/global-fomc-section"
import type { FuturesChartPart } from "@/app/ma/dashboard/futures-market/page"
import type { FinancialChartPart } from "@/app/ma/dashboard/options-market/financial-options-section"
import type { CommodityChartPart } from "@/app/ma/dashboard/options-market/commodity-options-section"
import type { QuantVsSubjectivePart } from "@/components/ma/quant-vs-subjective-charts"
import type { QuantStrategyPart } from "@/components/ma/quant-strategy-charts"
import type { IndexProduct } from "@/lib/client/ctp-market"

type Freq = "daily" | "weekly" | "monthly"
type FreqChart = ComponentType<{ freq: Freq; onFreqChange?: (freq: Freq) => void }>
type HeightChart = ComponentType<{ height?: number }>

function ChartLoading() {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
      正在加载图表…
    </div>
  )
}

function load(loader: () => Promise<{ default: ComponentType }>) {
  return dynamic(loader, { ssr: false, loading: ChartLoading })
}

function withHeight(loader: () => Promise<{ default: HeightChart }>, height: number) {
  return load(async () => {
    const mod = await loader()
    function Slot() {
      return <mod.default height={height} />
    }
    return { default: Slot }
  })
}

function withFreq(loader: () => Promise<{ default: FreqChart }>) {
  return load(async () => {
    const mod = await loader()
    function Slot() {
      const [freq, setFreq] = useState<Freq>("daily")
      return <mod.default freq={freq} onFreqChange={setFreq} />
    }
    return { default: Slot }
  })
}

function fomcChart(part: FomcChartPart) {
  return load(async () => {
    const mod = await import("@/app/ma/dashboard/macro-market/global-fomc-section")
    function Slot() {
      return <mod.default part={part} />
    }
    return { default: Slot }
  })
}

function futuresChart(part: FuturesChartPart) {
  return load(async () => {
    const mod = await import("@/app/ma/dashboard/futures-market/page")
    function Slot() {
      return <mod.default part={part} />
    }
    return { default: Slot }
  })
}

function financialChart(part: FinancialChartPart) {
  return load(async () => {
    const mod = await import("@/app/ma/dashboard/options-market/financial-options-section")
    function Slot() {
      return <mod.default part={part} />
    }
    return { default: Slot }
  })
}

function commodityChart(part: CommodityChartPart) {
  return load(async () => {
    const mod = await import("@/app/ma/dashboard/options-market/commodity-options-section")
    function Slot() {
      return <mod.default part={part} />
    }
    return { default: Slot }
  })
}

function quantVsChart(part: QuantVsSubjectivePart) {
  return load(async () => {
    const mod = await import("@/components/ma/quant-vs-subjective-charts")
    function Slot() {
      return <mod.default part={part} />
    }
    return { default: Slot }
  })
}

function quantStrategyChart(part: QuantStrategyPart) {
  return load(async () => {
    const mod = await import("@/components/ma/quant-strategy-charts")
    function Slot() {
      return <mod.default part={part} />
    }
    return { default: Slot }
  })
}

function indexIv(product: IndexProduct, title: string) {
  return load(async () => {
    const mod = await import("@/components/ma/index-iv-chart")
    function Slot() {
      const still = useChartStill()
      if (still) return <mod.IndexIvChart title={title} product={product} interval="1d" hideTimeframe />
      return <mod.IndexIvChart title={title} product={product} />
    }
    return { default: Slot }
  })
}

const SLOTS: Record<string, ComponentType> = {
  "ashare-crowding": load(() => import("@/components/charts/ashare-crowding-chart")),
  "turnover-concentration": load(async () => {
    const mod = await import("@/components/ma/ashare-turnover-concentration-chart")
    return { default: mod.AshareTurnoverConcentrationChart }
  }),
  "scale-index-vol": load(async () => {
    const mod = await import("@/components/ma/scale-index-vol-chart")
    return { default: mod.ScaleIndexVolChart }
  }),
  "scale-index-cross-vol": load(async () => {
    const mod = await import("@/components/ma/scale-index-cross-vol-chart")
    return { default: mod.ScaleIndexCrossVolChart }
  }),
  "scale-index-beat": load(async () => {
    const mod = await import("@/components/ma/scale-index-beat-ratio-chart")
    return { default: mod.ScaleIndexBeatRatioChart }
  }),
  "iv-ih": indexIv("IH", "上证50"),
  "iv-if": indexIv("IF", "沪深300"),
  "iv-ic": indexIv("IC", "中证500"),
  "iv-im": indexIv("IM", "中证1000"),
  "regime-similarity": load(() => import("@/components/charts/regime-similarity-chart")),
  "market-state": withFreq(() => import("@/components/charts/current-market-prediction-chart")),
  "economic-quadrant": withFreq(() => import("@/components/charts/economic-quadrant-chart")),
  "pca-biplot": withFreq(() => import("@/components/charts/pca-biplot-chart")),
  "asset-returns": withFreq(() => import("@/components/charts/asset-returns-chart")),
  "regime-timeseries": withFreq(() => import("@/components/charts/prediction-timeseries-chart")),
  "money-credit": load(() => import("@/components/charts/money-credit-chart")),
  "fomc-fedwatch": fomcChart("fedwatch"),
  "fomc-core-mom": fomcChart("core-mom"),
  "fomc-aug-parts": fomcChart("aug-parts"),
  "fomc-nfp": fomcChart("nfp"),
  "fomc-unrate-2026": fomcChart("unrate-2026"),
  "fomc-nfp-unrate": fomcChart("nfp-unrate"),
  "fomc-unrate": fomcChart("unrate"),
  "fomc-u6": fomcChart("u6"),
  "fomc-sahm": fomcChart("sahm"),
  "fomc-participation": fomcChart("participation"),
  "fomc-cpi-yoy": fomcChart("cpi-yoy"),
  "fomc-core-cpi": fomcChart("core-cpi"),
  "fomc-core-pce": fomcChart("core-pce"),
  "fomc-cpi-mom": fomcChart("cpi-mom"),
  "fomc-meeting-cpi": fomcChart("meeting-cpi"),
  "fomc-surprise": fomcChart("surprise"),
  "fomc-funds": fomcChart("funds"),
  "fomc-cross": fomcChart("cross"),
  "fut-nhci": futuresChart("nhci"),
  "fut-sector": futuresChart("sector"),
  "fut-sector-vol": futuresChart("sector-vol"),
  "fut-sector-cs": futuresChart("sector-cs"),
  "fut-corr-matrix": futuresChart("corr-matrix"),
  "fut-corr-trend": futuresChart("corr-trend"),
  "fut-scatter": futuresChart("scatter"),
  "fut-dist": futuresChart("dist"),
  "fut-amount": futuresChart("amount"),
  "fut-basis-cont": futuresChart("basis-cont"),
  "fut-index-quote": futuresChart("index-quote"),
  "fut-basis-rate": futuresChart("basis-rate"),
  "fut-basis-ts": futuresChart("basis-ts"),
  "fut-basis-ann": futuresChart("basis-ann"),
  "fut-contract-ann": futuresChart("contract-ann"),
  "fin-summary": financialChart("summary"),
  "fin-summary-pct": financialChart("summary-pct"),
  "fin-qvix": financialChart("qvix"),
  "fin-percentile": financialChart("percentile"),
  "fin-term": financialChart("term"),
  "fin-smile": financialChart("smile"),
  "fin-chain": financialChart("chain"),
  "fin-surface": financialChart("surface"),
  "fin-iv-rv": financialChart("iv-rv"),
  "fin-peer-iv": financialChart("peer-iv"),
  "fin-skew": financialChart("skew-snapshot"),
  "fin-skew-hist": financialChart("skew-history"),
  "fin-pcr": financialChart("pcr-oi"),
  "fin-pcr-hist": financialChart("pcr-history"),
  "fin-term-slope": financialChart("term-slope"),
  "fin-vol-cone": financialChart("vol-cone"),
  "fin-iv-heat": financialChart("iv-heat"),
  "cmd-summary": commodityChart("summary"),
  "cmd-summary-pct": commodityChart("summary-pct"),
  "cmd-history": commodityChart("history"),
  "cmd-percentile": commodityChart("percentile"),
  "cmd-term": commodityChart("term"),
  "cmd-iv-rv": commodityChart("iv-rv"),
  "cmd-peer-iv": commodityChart("peer-iv"),
  "cmd-skew": commodityChart("skew-snapshot"),
  "cmd-skew-hist": commodityChart("skew-history"),
  "cmd-pcr": commodityChart("pcr-oi"),
  "cmd-pcr-hist": commodityChart("pcr-history"),
  "cmd-term-slope": commodityChart("term-slope"),
  "cmd-vol-cone": commodityChart("vol-cone"),
  "cmd-iv-heat": commodityChart("iv-heat"),
  "rolling-vol": withHeight(() => import("@/components/ma/rolling-vol-chart"), 260),
  "var-prediction": withHeight(() => import("@/components/ma/var-prediction-chart"), 320),
  "sector-position": withHeight(() => import("@/components/ma/sector-position-charts"), 300),
  "equity-curve": withHeight(() => import("@/components/ma/equity-curve-chart"), 420),
  "account-daily-pnl": withHeight(() => import("@/components/ma/account-daily-pnl-chart"), 260),
  "sector-daily-pnl": withHeight(() => import("@/components/ma/sector-daily-pnl-chart"), 300),
  "advisor-equity": withHeight(() => import("@/components/ma/advisor-equity-curve-chart"), 400),
  "advisor-pnl-hist": withHeight(() => import("@/components/ma/advisor-pnl-histogram-chart"), 320),
  "option-floating-pnl": withHeight(() => import("@/components/ma/option-floating-pnl-charts"), 280),
  "nhci-candle": withHeight(() => import("@/components/ma/nhci-candle-chart"), 360),
  "product-candle": withHeight(() => import("@/components/ma/product-candle-chart"), 360),
  "cross-account": withHeight(() => import("@/components/ma/cross-account-chart"), 360),
  "au-trading": load(() => import("@/components/ma/au-trading-chart")),
  "qvs-signals": quantVsChart("signals"),
  "qvs-allocation": quantVsChart("allocation"),
  "qvs-q-holding": quantVsChart("q-holding"),
  "qvs-s-holding": quantVsChart("s-holding"),
  "qvs-q-candle": quantVsChart("q-candle"),
  "qvs-s-candle": quantVsChart("s-candle"),
  "qvs-waterfall": quantVsChart("waterfall"),
  "qvs-sector-bar": quantVsChart("sector-bar"),
  "qvs-sector-scatter": quantVsChart("sector-scatter"),
  "qvs-sector-flow": quantVsChart("sector-flow"),
  "qvs-product-flow": quantVsChart("product-flow"),
  "qvs-product-bar": quantVsChart("product-bar"),
  "qvs-product-scatter": quantVsChart("product-scatter"),
  "qvs-sector-ts": quantVsChart("sector-ts"),
  "qvs-product-ts": quantVsChart("product-ts"),
  "qvs-signal-hist": quantVsChart("signal-hist"),
  "qvs-sector-table": quantVsChart("sector-table"),
  "qvs-product-table": quantVsChart("product-table"),
  "qs-edge-sector": quantStrategyChart("edge-sector"),
  "qs-edge-product": quantStrategyChart("edge-product"),
  "qs-alpha-nav": quantStrategyChart("alpha-nav"),
  "qs-alpha-cum": quantStrategyChart("alpha-cum"),
  "qs-alpha-sector": quantStrategyChart("alpha-sector"),
  "qs-book-sector": quantStrategyChart("book-sector"),
  "qs-book-product": quantStrategyChart("book-product"),
  "qs-freq": quantStrategyChart("freq"),
  "qs-sector-vol": quantStrategyChart("sector-vol"),
  "qs-roll-edge": quantStrategyChart("roll-edge"),
  "qs-mkt-edge": quantStrategyChart("mkt-edge"),
  "qs-hedge-corr": quantStrategyChart("hedge-corr"),
  "qs-hold-freq": quantStrategyChart("hold-freq"),
  "qs-linear": quantStrategyChart("linear"),
  "qs-mkt-book": quantStrategyChart("mkt-book"),
  "qs-mkt-cross": quantStrategyChart("mkt-cross"),
  "qs-equity": quantStrategyChart("equity"),
  "qs-pnl-hist": quantStrategyChart("pnl-hist"),
  "qs-trade-hist": quantStrategyChart("trade-hist"),
  "qs-factors": quantStrategyChart("factors"),
  "qs-sector-pnl": quantStrategyChart("sector-pnl"),
  "qs-carry": quantStrategyChart("carry"),
  "qs-risk": quantStrategyChart("risk"),
  "qs-after": quantStrategyChart("after"),
  "qs-payoff": quantStrategyChart("payoff"),
  "qs-hold": quantStrategyChart("hold"),
  "qs-session": quantStrategyChart("session"),
  "qs-ls": quantStrategyChart("ls"),
  "qs-hedge": quantStrategyChart("hedge"),
  "qs-products": quantStrategyChart("products"),
  "qs-asset-mv": quantStrategyChart("asset-mv"),
  "qs-var-share": quantStrategyChart("var-share"),
}

export function AccountChartSlot({ id, still = false }: { id: string; still?: boolean }) {
  const Chart = SLOTS[id]
  if (!Chart) return null
  if (!still) return <Chart />
  return (
    <ChartStillProvider>
      <Chart />
    </ChartStillProvider>
  )
}
