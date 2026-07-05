"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import ReactECharts from "echarts-for-react"
import { ChevronRight } from "lucide-react"
import { FundCompanyProductList } from "@/app/ma/dashboard/private-funds/[beian_hao]/components/FundCompanyProductList"

interface DistributionSlice {
  name: string
  count: number
  pct: number
}

interface RepresentativeProduct {
  beian_hao: string
  product_name: string
  benchmark: string | null
}

interface FundsSummary {
  manager_name: string
  representative_products: RepresentativeProduct[]
  strategy_distribution_l1: DistributionSlice[]
  strategy_distribution_l2: DistributionSlice[]
  custodian_distribution: DistributionSlice[]
}

interface ChartPoint {
  d: string
  v: number
}

const PIE_COLORS = ["#ef4444", "#3b82f6", "#f59e0b", "#14b8a6", "#8b5cf6", "#78716c", "#ec4899", "#06b6d4"]

function SectionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-4">
        <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
        {title}
      </div>
      {children}
    </div>
  )
}

function buildPieOption(title: string, slices: DistributionSlice[]): Record<string, unknown> {
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "item",
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>${p.value}只 (${p.percent}%)`,
    },
    legend: {
      type: "scroll",
      orient: "vertical",
      right: 0,
      top: "middle",
      textStyle: { fontSize: 11, color: "#52525b" },
      itemWidth: 10,
      itemHeight: 10,
      pageIconSize: 10,
      pageTextStyle: { fontSize: 10, color: "#a1a1aa" },
    },
    series: [
      {
        name: title,
        type: "pie",
        radius: ["42%", "68%"],
        center: ["32%", "50%"],
        avoidLabelOverlap: true,
        label: { show: false },
        data: slices.map((s, i) => ({
          name: `${s.name} ${s.pct.toFixed(2)}%`,
          value: s.count,
          itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] },
        })),
      },
    ],
  }
}

function buildReturnChartOption(
  fund: ChartPoint[],
  bench: ChartPoint[],
  fundName: string,
  benchmarkLabel: string,
): Record<string, unknown> | null {
  if (fund.length < 2) return null

  const dateSet = new Set<string>()
  for (const p of fund) dateSet.add(p.d)
  for (const p of bench) dateSet.add(p.d)
  const dates = Array.from(dateSet).sort()

  const fundMap = new Map(fund.map((p) => [p.d, p.v]))
  const benchMap = new Map(bench.map((p) => [p.d, p.v]))

  let lastFund: number | null = null
  let lastBench: number | null = null
  const fundData: Array<number | null> = []
  const benchData: Array<number | null> = []

  for (const d of dates) {
    if (fundMap.has(d)) lastFund = fundMap.get(d)!
    if (benchMap.has(d)) lastBench = benchMap.get(d)!
    fundData.push(lastFund)
    benchData.push(lastBench)
  }

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      top: 0,
      left: 0,
      textStyle: { fontSize: 11, color: "#52525b" },
      data: [fundName, benchmarkLabel],
    },
    grid: { left: 56, right: 24, top: 48, bottom: 36, containLabel: true },
    xAxis: {
      type: "category",
      data: dates,
      axisLabel: {
        fontSize: 11,
        color: "#a1a1aa",
        interval: Math.max(0, Math.floor(dates.length / 8)),
      },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      name: "收益率(%)",
      nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
    },
    series: [
      {
        name: fundName,
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#ef4444" },
        itemStyle: { color: "#ef4444" },
        data: fundData,
      },
      {
        name: benchmarkLabel,
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 1.75, color: "#93c5fd", type: "dashed" },
        itemStyle: { color: "#93c5fd" },
        data: benchData,
      },
    ],
  }
}

export function ManagerFundsPanel({ registrationNo }: { registrationNo: string }) {
  const [summary, setSummary] = useState<FundsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [strategyLevel, setStrategyLevel] = useState<"l1" | "l2">("l1")
  const [selectedRep, setSelectedRep] = useState<RepresentativeProduct | null>(null)
  const [chartFund, setChartFund] = useState<ChartPoint[]>([])
  const [chartBench, setChartBench] = useState<ChartPoint[]>([])
  const [chartLoading, setChartLoading] = useState(false)
  const chartRef = useRef<ReactECharts>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/ma/api/private-fund-managers/${encodeURIComponent(registrationNo)}/funds/summary`)
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败")
        return res.json() as Promise<FundsSummary>
      })
      .then((json) => {
        if (cancelled) return
        setSummary(json)
        setSelectedRep(json.representative_products[0] ?? null)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [registrationNo])

  useEffect(() => {
    if (!selectedRep) {
      setChartFund([])
      setChartBench([])
      return
    }
    let cancelled = false
    setChartLoading(true)
    fetch(
      `/ma/api/tracking-funds/chart-preview?beian_hao=${encodeURIComponent(selectedRep.beian_hao)}&days=3650&mode=return`,
    )
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        setChartFund(Array.isArray(json.fund) ? json.fund : [])
        setChartBench(Array.isArray(json.bench) ? json.bench : [])
      })
      .catch(() => {
        if (!cancelled) {
          setChartFund([])
          setChartBench([])
        }
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedRep])

  const strategySlices =
    strategyLevel === "l1"
      ? summary?.strategy_distribution_l1 ?? []
      : summary?.strategy_distribution_l2 ?? []

  const benchmarkLabel = selectedRep?.benchmark?.trim() || "沪深300指数"
  const chartOption = useMemo(
    () =>
      selectedRep
        ? buildReturnChartOption(chartFund, chartBench, selectedRep.product_name, benchmarkLabel)
        : null,
    [selectedRep, chartFund, chartBench, benchmarkLabel],
  )

  useEffect(() => {
    if (!chartOption) return
    const resize = () => chartRef.current?.getEchartsInstance()?.resize()
    resize()
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [chartOption])

  if (loading) {
    return (
      <div className="space-y-4 w-full animate-pulse">
        <div className="h-28 rounded-lg bg-zinc-100" />
        <div className="h-[360px] rounded-lg bg-zinc-100" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-72 rounded-lg bg-zinc-100" />
          <div className="h-72 rounded-lg bg-zinc-100" />
        </div>
        <div className="h-96 rounded-lg bg-zinc-100" />
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="flex items-center justify-center h-40 text-red-500 text-sm rounded-lg border border-zinc-100 bg-white w-full">
        加载失败：{error ?? "未知错误"}
      </div>
    )
  }

  const repCount = summary.representative_products.length

  return (
    <div className="space-y-4 w-full">
      <SectionBlock title={`代表产品(${repCount})`}>
        {repCount > 0 ? (
          <div className="flex flex-wrap gap-3">
            {summary.representative_products.map((rep) => {
              const active = selectedRep?.beian_hao === rep.beian_hao
              return (
                <button
                  key={rep.beian_hao}
                  type="button"
                  onClick={() => setSelectedRep(rep)}
                  className={[
                    "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors max-w-full",
                    active
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300",
                  ].join(" ")}
                >
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-red-100 text-red-500 text-xs font-semibold shrink-0">
                    代
                  </span>
                  <span className="truncate">{rep.product_name}</span>
                  <Link
                    href={`/ma/dashboard/private-funds/${encodeURIComponent(rep.beian_hao)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-zinc-400 hover:text-zinc-700 shrink-0"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">暂无代表产品</p>
        )}
      </SectionBlock>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        {chartLoading ? (
          <div className="h-[360px] flex items-center justify-center text-sm text-zinc-400">加载走势…</div>
        ) : chartOption ? (
          <div className="w-full min-w-0">
            <ReactECharts
              ref={chartRef}
              option={chartOption}
              style={{ height: 360, width: "100%" }}
              className="!w-full"
              notMerge
              lazyUpdate
            />
          </div>
        ) : (
          <div className="h-[360px] flex items-center justify-center text-sm text-zinc-400">
            {selectedRep ? "暂无走势数据" : "请选择代表产品查看走势"}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 w-full">
        <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
              <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
              存续产品策略分布
            </div>
            <div className="inline-flex rounded border border-zinc-200 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setStrategyLevel("l1")}
                className={[
                  "px-2.5 py-1 transition-colors",
                  strategyLevel === "l1" ? "bg-red-500 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50",
                ].join(" ")}
              >
                一级
              </button>
              <button
                type="button"
                onClick={() => setStrategyLevel("l2")}
                className={[
                  "px-2.5 py-1 transition-colors",
                  strategyLevel === "l2" ? "bg-red-500 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50",
                ].join(" ")}
              >
                二级
              </button>
            </div>
          </div>
          {strategySlices.length > 0 ? (
            <ReactECharts
              option={buildPieOption("策略分布", strategySlices)}
              style={{ height: 280, width: "100%" }}
              notMerge
              lazyUpdate
            />
          ) : (
            <div className="h-[280px] flex items-center justify-center text-sm text-zinc-400">暂无数据</div>
          )}
        </div>

        <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-3">
            <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
            存续产品托管分布
          </div>
          {summary.custodian_distribution.length > 0 ? (
            <ReactECharts
              option={buildPieOption("托管分布", summary.custodian_distribution)}
              style={{ height: 280, width: "100%" }}
              notMerge
              lazyUpdate
            />
          ) : (
            <div className="h-[280px] flex items-center justify-center text-sm text-zinc-400">暂无数据</div>
          )}
        </div>
      </div>

      <FundCompanyProductList registrationNo={registrationNo} />
    </div>
  )
}
