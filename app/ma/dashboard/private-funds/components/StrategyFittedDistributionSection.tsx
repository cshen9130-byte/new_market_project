"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import type { EChartsOption } from "echarts"
import { Menu, Settings2 } from "lucide-react"
import type {
  ReturnGranularity,
  StrategyObservationDistribution,
  StrategyObservationDistParams,
  StrategyObservationResponse,
} from "@/lib/ma/strategy-observation"
import { DateInput } from "@/components/ui/date-input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  densityPoints,
  fitMethodLabel,
  frequencyHistogram,
  frequencyStepPoints,
  type FitChoice,
  type FitMethod,
  type FrequencyBin,
} from "@/lib/ma/distribution-fit"
import { ChartCalcHelpButton } from "../[beian_hao]/valuation/ChartCalcHelpButton"
import {
  fittedDistributionHelp,
  STRATEGY_OBSERVATION_HELP_POPOVER,
} from "./strategy-observation-calc-help"

const FIT_DISTRIBUTION_CHARTS = [
  { label: "股票市场中性", showExcessToggle: false },
  { label: "1000指增", showExcessToggle: true },
  { label: "500指增", showExcessToggle: true },
  { label: "300指增", showExcessToggle: true },
  { label: "A500指增", showExcessToggle: true },
  { label: "2000指增", showExcessToggle: false },
  { label: "量化选股", showExcessToggle: false },
] as const

const FIT_DISTRIBUTION_CHARTS_SECOND = [
  { label: "主观多头", showExcessToggle: false },
  { label: "量化多头", showExcessToggle: false },
  { label: "主观期货", showExcessToggle: false },
  { label: "期货策略", showExcessToggle: false },
  { label: "股票对冲", showExcessToggle: false },
  { label: "股票多头", showExcessToggle: false },
] as const

const FIT_DISTRIBUTION_CHARTS_THIRD = [
  { label: "套利策略", showExcessToggle: false },
  { label: "期权策略", showExcessToggle: false },
  { label: "多资产策略", showExcessToggle: false },
  { label: "债券策略", showExcessToggle: false },
  { label: "组合策略", showExcessToggle: false },
  { label: "可转债多头", showExcessToggle: false },
] as const

const RED = "#D93025"
const BLUE = "#1A73E8"

const FREQUENCY_OPTIONS: { key: ReturnGranularity; label: string }[] = [
  { key: "week", label: "周度" },
  { key: "month", label: "月度" },
  { key: "quarter", label: "季度" },
  { key: "half", label: "半年度" },
  { key: "year", label: "年度" },
  { key: "phase", label: "阶段" },
]

type StatisticSetting = {
  from: string
  to: string
  frequency: ReturnGranularity
}

function defaultStatisticRange(year: number, cutoff: string): { from: string; to: string } {
  const from = `${year}-01-01`
  const yearEnd = `${year}-12-31`
  const to = cutoff >= from && cutoff <= yearEnd ? cutoff : yearEnd
  return { from, to: to < from ? from : to }
}

function frequencyLabel(frequency: ReturnGranularity): string {
  return FREQUENCY_OPTIONS.find((item) => item.key === frequency)?.label ?? frequency
}

const STAT_MARKS = [
  { key: "mean" as const, label: "均值", color: "#18181b", type: "solid" as const },
  { key: "median" as const, label: "中位数", color: "#52525b", type: "dashed" as const },
  { key: "p90" as const, label: "90%分位", color: "#c2410c", type: "dotted" as const },
]

function formatStatPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`
}

function statValueClass(value: number): string {
  if (value > 0) return "tabular-nums text-red-500"
  if (value < 0) return "tabular-nums text-green-600"
  return "tabular-nums text-zinc-700"
}

function hasDistributionStats(
  params: StrategyObservationDistParams | null | undefined,
): params is StrategyObservationDistParams {
  return !!params
    && params.n > 0
    && Number.isFinite(params.mean)
    && Number.isFinite(params.median)
    && Number.isFinite(params.p90)
}

function resolveAxisBounds(
  current: { mean: number; std: number; median?: number; p90?: number },
  previous: { mean: number; std: number; median?: number; p90?: number },
): { xMin: number; xMax: number } {
  const marked = [current.median, current.p90, previous.median, previous.p90]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .map((value) => Math.abs(value))
  const span = Math.max(
    3,
    Math.abs(current.mean) + 3 * current.std,
    Math.abs(previous.mean) + 3 * previous.std,
    ...marked,
  )
  return { xMin: -Math.ceil(span), xMax: Math.ceil(span) }
}

const FIT_CHOICES: { id: FitChoice; label: string }[] = [
  { id: "auto", label: "自动（最佳）" },
  { id: "frequency", label: "实际频率" },
  { id: "normal", label: "正态" },
  { id: "t", label: "t 分布" },
  { id: "laplace", label: "拉普拉斯" },
  { id: "logistic", label: "Logistic" },
  { id: "kde", label: "核密度" },
]

function formatWeekRange(endDate: string): string {
  const end = new Date(`${endDate}T12:00:00`)
  if (Number.isNaN(end.getTime())) return `周报(${endDate})`
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return `周报(${start.toISOString().slice(0, 10)}~${endDate})`
}

function formatDistributionPeriod(key: string, frequency: ReturnGranularity): string {
  if (frequency === "week") return formatWeekRange(key)
  if (frequency === "month") return `月报(${key})`
  if (frequency === "quarter") return `季报(${key})`
  if (frequency === "half") return `半年报(${key})`
  if (frequency === "phase") return `阶段(${key.replace(/-phase$/, "")})`
  return `年报(${key})`
}

function buildDistributionChartOption(
  current: StrategyObservationDistParams | null,
  previous: StrategyObservationDistParams | null,
  currentLabel: string,
  previousLabel: string,
  yAxisName: "概率" | "频率" = "概率",
  fitChoice: FitChoice = "auto",
  showBothCurves = true,
): { option: EChartsOption; currentMethod: FitMethod; previousMethod: FitMethod } {
  const currentSafe = current ?? { mean: 0, std: 1.2, n: 0 }
  const previousSafe = previous ?? { mean: 0, std: 1.2, n: 0 }
  const { xMin, xMax } = resolveAxisBounds(currentSafe, showBothCurves ? previousSafe : currentSafe)
  const empirical = fitChoice === "frequency"
  const currentBins = empirical ? frequencyHistogram(current?.sample, xMin, xMax) : []
  const previousBins = empirical ? frequencyHistogram(previous?.sample, xMin, xMax) : []
  let currentPoints: [number, number][]
  let previousPoints: [number, number][]
  let currentMethod: FitMethod = "normal"
  let previousMethod: FitMethod = "normal"
  if (empirical) {
    currentPoints = frequencyStepPoints(currentBins)
    previousPoints = frequencyStepPoints(previousBins)
  } else {
    const currentCurve = densityPoints(
      current?.sample,
      fitChoice,
      xMin,
      xMax,
      { mean: currentSafe.mean, std: currentSafe.std },
    )
    const previousCurve = densityPoints(
      previous?.sample,
      fitChoice,
      xMin,
      xMax,
      { mean: previousSafe.mean, std: previousSafe.std },
    )
    currentPoints = currentCurve.points
    previousPoints = previousCurve.points
    currentMethod = currentCurve.method
    previousMethod = previousCurve.method
  }
  const yMax = Math.max(
    ...currentPoints.map((p) => p[1]),
    ...(showBothCurves ? previousPoints.map((p) => p[1]) : []),
    5,
  )
  const yTop = Math.ceil(yMax / 2.5) * 2.5

  const option: EChartsOption = {
    animation: false,
    legend: {
      top: 0,
      left: 0,
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { fontSize: 10, color: "#71717a" },
      data: showBothCurves ? [currentLabel, previousLabel] : [currentLabel],
    },
    grid: { left: 42, right: 8, top: 36, bottom: 28 },
    tooltip: {
      trigger: "axis",
      confine: true,
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as Array<{
          seriesName?: string
          value?: [number, number]
          color?: string
        }>
        if (!items.length) return ""
        const x = items[0].value?.[0] ?? 0
        const fitNote = empirical
          ? "实际频率"
          : !showBothCurves || currentMethod === previousMethod
            ? `拟合 ${fitMethodLabel(currentMethod)}`
            : `本期 ${fitMethodLabel(currentMethod)} · 上期 ${fitMethodLabel(previousMethod)}`
        const lines = [
          `<div style="color:#71717a;margin-bottom:4px">${empirical ? "区间" : "收益率"} ${x.toFixed(2)}% · ${fitNote}</div>`,
        ]
        for (const item of items) {
          const y = item.value?.[1]
          if (y == null) continue
          if (empirical) {
            const bins = item.seriesName === currentLabel ? currentBins : previousBins
            const bin = bins.find((entry) => x >= entry.left && x < entry.right)
              ?? bins.find((entry) => x === entry.right)
            lines.push(
              `<div style="font-weight:600;color:${item.color ?? "#333"}">${item.seriesName}: ${bin ? `${bin.count} 只 · ${bin.pct.toFixed(2)}%` : `${y.toFixed(2)}%`}</div>`,
            )
          } else {
            lines.push(
              `<div style="font-weight:600;color:${item.color ?? "#333"}">${item.seriesName}: ${y.toFixed(2)}%</div>`,
            )
          }
        }
        if (hasDistributionStats(current)) {
          lines.push(
            `<div style="margin-top:4px;color:#71717a">均值 ${formatStatPct(current.mean)} · 中位数 ${formatStatPct(current.median)} · 90%分位 ${formatStatPct(current.p90)}</div>`,
          )
        }
        return lines.join("")
      },
    },
    xAxis: {
      type: "value",
      min: xMin,
      max: xMax,
      axisLabel: {
        fontSize: 10,
        color: "#a1a1aa",
        formatter: (v: number) => `${v.toFixed(1).replace(/\.0$/, "")}%`,
      },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      splitLine: { show: false },
      name: "收益率",
      nameLocation: "middle",
      nameGap: 22,
      nameTextStyle: { fontSize: 10, color: "#a1a1aa" },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: yTop,
      interval: yTop <= 5 ? 2.5 : 5,
      axisLabel: { fontSize: 10, color: "#a1a1aa", formatter: "{value}%" },
      splitLine: { lineStyle: { type: "dashed", color: "#f4f4f5" } },
      name: empirical ? "频率" : yAxisName,
      nameLocation: "middle",
      nameGap: 32,
      nameTextStyle: { fontSize: 10, color: "#a1a1aa" },
    },
    series: [
      {
        name: currentLabel,
        type: "line",
        data: currentPoints,
        showSymbol: false,
        lineStyle: { color: RED, width: 1.5 },
        itemStyle: { color: RED },
        areaStyle: { color: "rgba(217,48,37,0.35)" },
        z: 2,
        markLine: hasDistributionStats(current)
          ? {
              silent: true,
              symbol: "none",
              animation: false,
              label: { show: false },
              data: STAT_MARKS.map((stat) => ({
                xAxis: current[stat.key],
                lineStyle: { color: stat.color, type: stat.type, width: 1 },
                label: { show: false },
              })),
            }
          : undefined,
      },
      ...(showBothCurves
        ? [{
            name: previousLabel,
            type: "line" as const,
            data: previousPoints,
            showSymbol: false,
            lineStyle: { color: BLUE, width: 1.5 },
            itemStyle: { color: BLUE },
            areaStyle: { color: "rgba(26,115,232,0.3)" },
            z: 1,
          }]
        : []),
    ],
  }
  return { option, currentMethod, previousMethod }
}

function fitCaption(
  choice: FitChoice,
  currentMethod: FitMethod,
  previousMethod: FitMethod,
  showBothCurves: boolean,
): string {
  if (choice === "frequency") return "实际频率"
  if (!showBothCurves || currentMethod === previousMethod) return `拟合 ${fitMethodLabel(currentMethod)}`
  return `本期 ${fitMethodLabel(currentMethod)} · 上期 ${fitMethodLabel(previousMethod)}`
}

function FittedDistributionChart({
  strategy,
  showExcessToggle,
  distribution,
  currentLabel,
  previousLabel,
  yAxisName = "概率",
  fitChoice,
  showBothCurves,
}: {
  strategy: string
  showExcessToggle: boolean
  distribution?: StrategyObservationDistribution
  currentLabel: string
  previousLabel: string
  yAxisName?: "概率" | "频率"
  fitChoice: FitChoice
  showBothCurves: boolean
}) {
  const [showExcess, setShowExcess] = useState(false)
  const shownCurrent = showExcess ? distribution?.excessCurrent ?? null : distribution?.current ?? null
  const stats = hasDistributionStats(shownCurrent) ? shownCurrent : null

  const built = useMemo(
    () =>
      buildDistributionChartOption(
        showExcess ? distribution?.excessCurrent ?? null : distribution?.current ?? null,
        showExcess ? distribution?.excessPrevious ?? null : distribution?.previous ?? null,
        currentLabel,
        previousLabel,
        yAxisName,
        fitChoice,
        showBothCurves,
      ),
    [distribution, currentLabel, previousLabel, showExcess, yAxisName, fitChoice, showBothCurves],
  )

  return (
    <div className="rounded-lg border border-zinc-100 bg-white p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h4 className="inline-flex items-center gap-1 text-sm font-medium text-zinc-800">
          {strategy}
          <ChartCalcHelpButton
            heading={`${strategy} · 拟合分布计算说明`}
            blocks={fittedDistributionHelp(strategy)}
            contentClassName={STRATEGY_OBSERVATION_HELP_POPOVER}
          />
        </h4>
        <div className="flex items-center gap-2 shrink-0">
          {showExcessToggle && (
            <button
              type="button"
              onClick={() => setShowExcess((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 transition-colors"
            >
              <span
                className={[
                  "inline-flex h-3 w-3 items-center justify-center rounded border",
                  showExcess ? "border-red-500 bg-red-500" : "border-zinc-300 bg-white",
                ].join(" ")}
              >
                {showExcess && (
                  <svg viewBox="0 0 12 12" className="h-2 w-2 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              超额
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center justify-center h-6 w-6 rounded text-zinc-400 hover:text-zinc-600 hover:bg-zinc-50 transition-colors"
            title="图表菜单"
          >
            <Menu className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {stats ? (
        <div className="mb-2 grid grid-cols-3 gap-1.5">
          {STAT_MARKS.map((stat) => (
            <div key={stat.key} className="rounded bg-zinc-50 px-2 py-1">
              <div className="flex items-center gap-1.5 text-[10px] leading-4 text-zinc-400">
                <span
                  className="inline-block w-4 border-t"
                  style={{ borderTopColor: stat.color, borderTopStyle: stat.type }}
                />
                {stat.label}
              </div>
              <div className={["text-sm font-medium leading-5", statValueClass(stats[stat.key])].join(" ")}>
                {formatStatPct(stats[stat.key])}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mb-1 text-[10px] leading-4 text-zinc-400">{fitCaption(fitChoice, built.currentMethod, built.previousMethod, showBothCurves)}</div>
      <ReactECharts option={built.option} style={{ height: 220, width: "100%" }} notMerge lazyUpdate />
    </div>
  )
}

function DistributionChartGrid({
  charts,
  distributions,
  currentLabel,
  previousLabel,
  yAxisName = "概率",
  fitChoice,
  showBothCurves,
}: {
  charts: readonly { label: string; showExcessToggle: boolean }[]
  distributions: Record<string, StrategyObservationDistribution>
  currentLabel: string
  previousLabel: string
  yAxisName?: "概率" | "频率"
  fitChoice: FitChoice
  showBothCurves: boolean
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {charts.map((chart) => (
        <FittedDistributionChart
          key={chart.label}
          strategy={chart.label}
          showExcessToggle={chart.showExcessToggle}
          distribution={distributions[chart.label]}
          currentLabel={currentLabel}
          previousLabel={previousLabel}
          yAxisName={yAxisName}
          fitChoice={fitChoice}
          showBothCurves={showBothCurves}
        />
      ))}
    </div>
  )
}

export function StrategyFittedDistributionSection({
  periodKeys,
  distributions,
  year,
  granularity,
  cutoff,
}: {
  periodKeys: string[]
  distributions: Record<string, StrategyObservationDistribution>
  year: number
  granularity: ReturnGranularity
  cutoff: string
}) {
  const pageRange = useMemo(() => defaultStatisticRange(year, cutoff), [year, cutoff])
  const [fitChoice, setFitChoice] = useState<FitChoice>("auto")
  const [showBothCurves, setShowBothCurves] = useState(true)
  const [rangeOpen, setRangeOpen] = useState(false)
  const [applied, setApplied] = useState<StatisticSetting | null>(null)
  const [draftFrom, setDraftFrom] = useState(pageRange.from)
  const [draftTo, setDraftTo] = useState(pageRange.to)
  const [draftFrequency, setDraftFrequency] = useState<ReturnGranularity>(granularity)
  const [rangeError, setRangeError] = useState<string | null>(null)
  const [override, setOverride] = useState<StrategyObservationResponse | null>(null)
  const [loadingRange, setLoadingRange] = useState(false)
  const [rangeLoadError, setRangeLoadError] = useState<string | null>(null)

  const activeFrequency = override?.granularity ?? granularity
  const activeKeys = override?.periodKeys ?? periodKeys
  const activeDistributions = override?.distributions ?? distributions
  const { currentLabel, previousLabel } = useMemo(() => {
    const current = activeKeys[activeKeys.length - 1]
    const previous = activeKeys[activeKeys.length - 2]
    return {
      currentLabel: current ? formatDistributionPeriod(current, activeFrequency) : "本期",
      previousLabel: previous ? formatDistributionPeriod(previous, activeFrequency) : "上期",
    }
  }, [activeFrequency, activeKeys])

  const summary = applied
    ? `${applied.from} ~ ${applied.to} · ${frequencyLabel(applied.frequency)}`
    : `${pageRange.from} ~ ${pageRange.to} · ${frequencyLabel(granularity)}`

  useEffect(() => {
    if (!applied) {
      setOverride(null)
      setLoadingRange(false)
      setRangeLoadError(null)
      return
    }
    const controller = new AbortController()
    setLoadingRange(true)
    setRangeLoadError(null)
    const params = new URLSearchParams({
      year: applied.to.slice(0, 4),
      granularity: applied.frequency,
      from: applied.from,
      to: applied.to,
    })
    fetch(`/ma/api/private-funds/market/strategy-observation?${params}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || "加载拟合分布失败")
        setOverride(json as StrategyObservationResponse)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setOverride(null)
        setRangeLoadError(err instanceof Error ? err.message : "加载拟合分布失败")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingRange(false)
      })
    return () => controller.abort()
  }, [applied])

  function handleRangeOpenChange(open: boolean) {
    setRangeOpen(open)
    if (!open) return
    const source = applied ?? { ...pageRange, frequency: granularity }
    setDraftFrom(source.from)
    setDraftTo(source.to)
    setDraftFrequency(source.frequency)
    setRangeError(null)
  }

  function applyStatisticSetting() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draftFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(draftTo)) {
      setRangeError("请选择开始和结束日期")
      return
    }
    if (draftFrom > draftTo) {
      setRangeError("开始日期须早于结束日期")
      return
    }
    const spanDays = (Date.parse(`${draftTo}T12:00:00`) - Date.parse(`${draftFrom}T12:00:00`)) / 86400000
    if (spanDays > 366 * 3) {
      setRangeError("统计区间请不超过 3 年")
      return
    }
    const next = { from: draftFrom, to: draftTo, frequency: draftFrequency }
    const sameAsPage = next.frequency === granularity && next.from === pageRange.from && next.to === pageRange.to
    setRangeError(null)
    setApplied(sameAsPage ? null : next)
    setRangeOpen(false)
  }

  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
          拟合分布
          <ChartCalcHelpButton
            heading="拟合分布 · 计算说明"
            blocks={fittedDistributionHelp()}
            contentClassName={STRATEGY_OBSERVATION_HELP_POPOVER}
          />
        </div>
        <div className="flex items-center gap-3">
        <div className="inline-flex overflow-hidden rounded border border-zinc-200">
          <button
            type="button"
            onClick={() => setShowBothCurves(false)}
            className={[
              "px-2 py-1 text-xs transition-colors",
              showBothCurves ? "bg-white text-zinc-600 hover:bg-zinc-50" : "bg-zinc-800 text-white",
            ].join(" ")}
          >
            一条
          </button>
          <button
            type="button"
            onClick={() => setShowBothCurves(true)}
            className={[
              "border-l border-zinc-200 px-2 py-1 text-xs transition-colors",
              showBothCurves ? "bg-zinc-800 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50",
            ].join(" ")}
          >
            两条
          </button>
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
          拟合
          <select
            value={fitChoice}
            onChange={(event) => setFitChoice(event.target.value as FitChoice)}
            className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700"
            aria-label="拟合方法"
          >
            {FIT_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>{choice.label}</option>
            ))}
          </select>
        </label>
        <Dialog open={rangeOpen} onOpenChange={handleRangeOpenChange}>
          <DialogTrigger asChild>
            <button
              type="button"
              className={[
                "inline-flex items-center gap-1.5 text-xs transition-colors",
                applied ? "text-red-600 hover:text-red-700" : "text-zinc-500 hover:text-zinc-800",
              ].join(" ")}
              aria-label="区间设置"
            >
              <Settings2 className="h-3.5 w-3.5" />
              区间设置
              <span className="tabular-nums">{summary}</span>
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>区间设置</DialogTitle>
              <DialogDescription>
                选择统计区间和统计频率。红线是该区间内最近一期，蓝线是上一期。
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-zinc-500">
                开始日期
                <DateInput
                  value={draftFrom}
                  onChange={setDraftFrom}
                  placeholder="开始日期"
                  max={draftTo || undefined}
                  className="mt-1"
                  inputClassName="h-8 px-2 text-xs"
                  displayClassName="left-2 text-xs"
                />
              </label>
              <label className="block text-xs text-zinc-500">
                结束日期
                <DateInput
                  value={draftTo}
                  onChange={setDraftTo}
                  placeholder="结束日期"
                  min={draftFrom || undefined}
                  className="mt-1"
                  inputClassName="h-8 px-2 text-xs"
                  displayClassName="left-2 text-xs"
                />
              </label>
            </div>
            <div>
              <div className="mb-1.5 text-xs text-zinc-500">统计频率</div>
              <div className="flex flex-wrap gap-1.5">
                {FREQUENCY_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setDraftFrequency(option.key)}
                    className={[
                      "rounded border px-2 py-1 text-xs transition-colors",
                      draftFrequency === option.key
                        ? "border-red-500 bg-red-50 text-red-600"
                        : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {rangeError ? <p className="text-xs text-red-500">{rangeError}</p> : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraftFrom(pageRange.from)
                  setDraftTo(pageRange.to)
                  setDraftFrequency(granularity)
                  setRangeError(null)
                  setApplied(null)
                  setRangeOpen(false)
                }}
                className="rounded border border-zinc-200 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50 transition-colors"
              >
                恢复默认
              </button>
              <button
                type="button"
                onClick={applyStatisticSetting}
                className="rounded bg-red-500 px-3 py-1 text-xs text-white hover:bg-red-600 transition-colors"
              >
                应用
              </button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {loadingRange ? (
        <p className="mb-3 text-xs text-zinc-400">正在按统计区间重算拟合分布…</p>
      ) : null}
      {rangeLoadError ? (
        <p className="mb-3 text-xs text-red-500">{rangeLoadError}</p>
      ) : null}
      {!loadingRange && !rangeLoadError && activeKeys.length < 2 ? (
        <p className="mb-3 text-xs text-zinc-400">该统计区间内不足两期，无法对比分布。</p>
      ) : null}

      <DistributionChartGrid
        charts={FIT_DISTRIBUTION_CHARTS}
        distributions={activeDistributions}
        currentLabel={currentLabel}
        previousLabel={previousLabel}
        yAxisName="概率"
        fitChoice={fitChoice}
        showBothCurves={showBothCurves}
      />

      <div className="mt-3">
        <DistributionChartGrid
          charts={FIT_DISTRIBUTION_CHARTS_SECOND}
          distributions={activeDistributions}
          currentLabel={currentLabel}
          previousLabel={previousLabel}
          yAxisName="频率"
          fitChoice={fitChoice}
        showBothCurves={showBothCurves}
        />
      </div>

      <div className="mt-3">
        <DistributionChartGrid
          charts={FIT_DISTRIBUTION_CHARTS_THIRD}
          distributions={activeDistributions}
          currentLabel={currentLabel}
          previousLabel={previousLabel}
          yAxisName="频率"
          fitChoice={fitChoice}
        showBothCurves={showBothCurves}
        />
      </div>
    </div>
  )
}
