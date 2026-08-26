"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import {
  computeFofStockHedgeSeries,
  computeFofStockHedgeSnapshot,
  DEFAULT_LS_NET_EXPOSURE_PCT,
} from "@/lib/fof-deeper-analysis"
import type { FundHoldingRow } from "./FofFundsPanel"
import type { OtherHoldingRow } from "./OtherHoldingsPanel"
import type { FofShareTrendData } from "./FofShareTrendPanel"
import { FofAnalysisChartCard } from "./FofAnalysisChartCard"

type Props = {
  fundHoldings: FundHoldingRow[]
  otherHoldings?: OtherHoldingRow[]
  netAssetValue?: number | null
  strategyTrend?: FofShareTrendData | null
}

function fmtPct(n: number, digits = 2): string {
  return `${n.toFixed(digits)}%`
}

function fmtWan(n: number): string {
  return `${(n / 10_000).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 万`
}

function hedgeSideLabel(side: "short_futures" | "long_futures" | "none"): string {
  if (side === "short_futures") return "建议开空股指期货"
  if (side === "long_futures") return "建议开多股指期货"
  return "无需额外对冲"
}

export function FofStockHedgeChart({
  fundHoldings,
  otherHoldings = [],
  netAssetValue,
  strategyTrend,
}: Props) {
  const [lsNetDraft, setLsNetDraft] = useState(String(DEFAULT_LS_NET_EXPOSURE_PCT))
  const lsNet = Number(lsNetDraft)
  const lsNetPct = Number.isFinite(lsNet) && lsNet >= 0 ? lsNet : DEFAULT_LS_NET_EXPOSURE_PCT

  const snapshot = useMemo(
    () => computeFofStockHedgeSnapshot(
      fundHoldings,
      netAssetValue ?? 0,
      lsNetPct,
      otherHoldings,
    ),
    [fundHoldings, netAssetValue, lsNetPct, otherHoldings],
  )

  const seriesPoints = useMemo(
    () => computeFofStockHedgeSeries(
      strategyTrend?.dates ?? [],
      strategyTrend?.series ?? [],
      lsNetPct,
    ),
    [strategyTrend, lsNetPct],
  )

  const waterfallOption = useMemo(() => {
    const steps = [
      { name: "股票多头", value: snapshot.longOnlyPct },
      { name: "对冲基金净敞口", value: snapshot.lsNetPct },
      { name: "直持股票/ETF", value: snapshot.directStockPct + snapshot.etfPct },
      { name: "已有股指对冲", value: snapshot.existingHedgePct },
    ]
    const names = [...steps.map((s) => s.name), "单边敞口"]
    const help: Array<number | string> = []
    const up: Array<number | string> = []
    const down: Array<number | string> = []
    let acc = 0
    for (const step of steps) {
      if (step.value >= 0) {
        help.push(+acc.toFixed(2))
        up.push(+step.value.toFixed(2))
        down.push("-")
        acc += step.value
      } else {
        acc += step.value
        help.push(+acc.toFixed(2))
        up.push("-")
        down.push(+Math.abs(step.value).toFixed(2))
      }
    }
    help.push("-")
    const total = +acc.toFixed(2)
    const totalItem = {
      value: Math.abs(total),
      itemStyle: { color: "#1e3a5f" },
    }
    if (total >= 0) {
      up.push(totalItem)
      down.push("-")
    } else {
      up.push("-")
      down.push(totalItem)
    }

    return {
      grid: { left: 48, right: 20, top: 36, bottom: 36 },
      legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: Array<{ seriesName: string; value: number | string | { value: number }; axisValue: string }>) => {
          const shown = params.filter((p) => p.seriesName !== "辅助" && p.value !== "-" && p.value != null)
          const raw = shown[0]?.value
          const n = typeof raw === "number"
            ? raw
            : typeof raw === "object" && raw && "value" in raw
              ? Number(raw.value)
              : Number(raw)
          const label = shown[0]?.axisValue ?? ""
          if (!Number.isFinite(n)) return label
          const signed = shown[0]?.seriesName === "减少" ? -n : n
          return `${label}<br/>${signed >= 0 ? "+" : ""}${signed.toFixed(2)}% NAV`
        },
      },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { fontSize: 10, color: "#71717a", interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "% NAV",
        axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: number) => `${v}` },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: [
        {
          name: "辅助",
          type: "bar",
          stack: "wf",
          data: help,
          itemStyle: { color: "transparent" },
          silent: true,
          barMaxWidth: 36,
        },
        {
          name: "增加",
          type: "bar",
          stack: "wf",
          data: up,
          itemStyle: { color: "#ef4444" },
          barMaxWidth: 36,
        },
        {
          name: "减少",
          type: "bar",
          stack: "wf",
          data: down,
          itemStyle: { color: "#10b981" },
          barMaxWidth: 36,
        },
      ],
    }
  }, [snapshot])

  const trendOption = useMemo(() => ({
    grid: { left: 48, right: 20, top: 36, bottom: 28 },
    legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ seriesName: string; value: number; axisValue: string; marker: string }>) => {
        if (!Array.isArray(params) || params.length === 0) return ""
        const i = seriesPoints.findIndex((p) => p.date === params[0].axisValue)
        const point = i >= 0 ? seriesPoints[i] : null
        const lines = [`<b>${params[0].axisValue}</b>`]
        for (const p of params) {
          if (p.value == null || !Number.isFinite(p.value)) continue
          lines.push(`${p.marker}${p.seriesName}：${fmtPct(p.value)}`)
        }
        if (point) lines.push(`单边敞口合计：${fmtPct(point.netPct)}`)
        return lines.join("<br/>")
      },
    },
    xAxis: {
      type: "category",
      data: seriesPoints.map((p) => p.date),
      axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: string) => v.slice(0, 7) },
    },
    yAxis: {
      type: "value",
      name: "% NAV",
      axisLabel: { fontSize: 10, color: "#71717a" },
      splitLine: { lineStyle: { color: "#f4f4f5" } },
    },
    series: [
      {
        name: "股票多头",
        type: "line",
        stack: "exp",
        data: seriesPoints.map((p) => p.longOnlyPct),
        showSymbol: false,
        areaStyle: { color: "rgba(217,48,37,0.18)" },
        lineStyle: { width: 1.4, color: "#D93025" },
        itemStyle: { color: "#D93025" },
      },
      {
        name: "对冲基金净敞口",
        type: "line",
        stack: "exp",
        data: seriesPoints.map((p) => p.lsNetPct),
        showSymbol: false,
        areaStyle: { color: "rgba(147,51,234,0.16)" },
        lineStyle: { width: 1.4, color: "#9333ea" },
        itemStyle: { color: "#9333ea" },
      },
      {
        name: "单边敞口",
        type: "line",
        data: seriesPoints.map((p) => p.netPct),
        showSymbol: false,
        lineStyle: { width: 1.8, color: "#e54d42" },
        itemStyle: { color: "#e54d42" },
      },
    ],
  }), [seriesPoints])

  const extra = (
    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
      对冲基金净敞口
      <input
        type="number"
        min={0}
        max={100}
        step={5}
        value={lsNetDraft}
        onChange={(e) => setLsNetDraft(e.target.value)}
        className="w-12 h-6 rounded border border-zinc-200 px-1 text-right tabular-nums"
      />
      %
    </span>
  )

  return (
    <>
      <FofAnalysisChartCard
        title="股票单边敞口"
        hint="股票多头按满仓计，股票对冲按右侧净敞口假设计，再加直持股票/ETF、减去已有股指期货。得到的净敞口即母基金可用股指期货反向开仓自行对冲的名义。"
        extra={extra}
      >
        {!snapshot.hasEquityBook ? (
          <EmptyChart text="当前持仓未识别到股票多头、股票对冲或直持股票，单边敞口按 0 计" />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 px-2 pt-1 pb-3">
              <Metric
                label="单边敞口"
                value={fmtPct(snapshot.netExposurePct)}
                hint={fmtWan(snapshot.netExposureMv)}
              />
              <Metric
                label="建议对冲名义"
                value={fmtWan(snapshot.hedgeNotionalMv)}
                hint={hedgeSideLabel(snapshot.hedgeSide)}
              />
              <Metric
                label="股票多头"
                value={fmtPct(snapshot.longOnlyPct)}
                hint={fmtWan(snapshot.longOnlyMv)}
              />
              <Metric
                label="对冲基金净敞口"
                value={fmtPct(snapshot.lsNetPct)}
                hint={`资本 ${fmtWan(snapshot.lsGrossMv)} × ${lsNetPct}%`}
              />
            </div>
            <ReactECharts option={waterfallOption} style={{ height: 260 }} notMerge />
            <p className="px-3 pt-1 text-[11px] leading-5 text-zinc-400">
              {snapshot.hedgeSide === "none"
                ? "净敞口接近 0，母基金层面不必再开股指期货。"
                : snapshot.hedgeSide === "short_futures"
                  ? `若要把股票方向降到中性，可在 IF/IC/IM/IH 上开空，对冲名义约 ${fmtWan(snapshot.hedgeNotionalMv)}。`
                  : `净敞口为空头，若要回到中性可在股指期货上开多，名义约 ${fmtWan(snapshot.hedgeNotionalMv)}。`}
              {snapshot.existingHedgePct !== 0
                ? ` 估值表已识别股指对冲 ${fmtPct(snapshot.existingHedgePct)}。`
                : ""}
            </p>
          </>
        )}
      </FofAnalysisChartCard>

      <FofAnalysisChartCard
        title="股票单边敞口走势"
        hint="按各期一级策略市值权重重算：股票多头 100% + 股票对冲 × 净敞口假设。不含直持股票与已有股指期货。"
      >
        {seriesPoints.filter((p) => Math.abs(p.netPct) > 0.05).length < 2 ? (
          <EmptyChart text="策略配置时序不足，无法绘制单边敞口走势" />
        ) : (
          <ReactECharts option={trendOption} style={{ height: 280 }} notMerge />
        )}
      </FofAnalysisChartCard>
    </>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-zinc-100 bg-zinc-50/70 px-3 py-2">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900">{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-400 leading-4">{hint}</div>
    </div>
  )
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="h-[180px] flex items-center justify-center text-sm text-zinc-400 px-4 text-center">
      {text}
    </div>
  )
}
