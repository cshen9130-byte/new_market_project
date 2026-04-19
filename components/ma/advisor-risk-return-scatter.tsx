"use client"

import { useState, useEffect, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type AccountPoint = { account: string; vol: number; annualReturn: number; maxDrawdown: number; sector: string }
type SimPoint = { vol: number; ret: number }
type FrontierPoint = { vol: number; ret: number }

const WINDOW_OPTIONS = [
  { value: "20",  label: "近 20 日" },
  { value: "60",  label: "近 60 日" },
  { value: "120", label: "近 120 日" },
  { value: "",    label: "全部" },
]

const SECTOR_PALETTE = [
  "#f59e0b", "#3b82f6", "#a855f7", "#06b6d4", "#f97316",
  "#84cc16", "#ec4899", "#14b8a6", "#8b5cf6", "#ef4444",
  "#6366f1", "#22c55e",
]

export default function AdvisorRiskReturnScatter({ height = 400 }: { height?: number }) {
  const [win,           setWin]           = useState("60")
  const [mode,          setMode]          = useState<"vol" | "mdd">("vol")
  const [accountPoints, setAccountPoints] = useState<AccountPoint[]>([])
  const [simPoints,     setSimPoints]     = useState<SimPoint[]>([])
  const [frontier,      setFrontier]      = useState<FrontierPoint[]>([])
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const url = win ? `/ma/api/mom-analysis/risk-return?window=${win}` : "/ma/api/mom-analysis/risk-return"
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) { setError(j.error ?? "加载失败"); return }
        setAccountPoints(j.accounts ?? [])
        setSimPoints(j.simPoints ?? [])
        setFrontier(j.frontier ?? [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setLoading(false))
  }, [win])

  const sectorColorMap = useMemo(() => {
    const sectors = [...new Set(accountPoints.map((p) => p.sector))].sort()
    return new Map(sectors.map((s, i) => [s, SECTOR_PALETTE[i % SECTOR_PALETTE.length]]))
  }, [accountPoints])

  const option = useMemo(() => {
    const sectorGroups = new Map<string, AccountPoint[]>()
    for (const p of accountPoints) {
      if (!sectorGroups.has(p.sector)) sectorGroups.set(p.sector, [])
      sectorGroups.get(p.sector)!.push(p)
    }

    const isMdd = mode === "mdd"
    const xValues = isMdd
      ? accountPoints.map((p) => p.maxDrawdown)
      : [...accountPoints.map((p) => p.vol), ...simPoints.map((p) => p.vol)]
    const yValues = isMdd
      ? accountPoints.map((p) => p.annualReturn)
      : [...accountPoints.map((p) => p.annualReturn), ...simPoints.map((p) => p.ret)]

    const xMin = xValues.length ? Math.max(0, Math.min(...xValues) - 1) : 0
    const xMax = xValues.length ? Math.max(...xValues) + 1 : 50
    const retMin = yValues.length ? Math.min(...yValues) - 5 : -20
    const retMax = yValues.length ? Math.max(...yValues) + 5 : 50

    const series: object[] = []

    if (isMdd) {
      // Pareto envelope: upper-left boundary of account dots in MDD-return space
      const BIN = 20
      const mddMin = xMin, mddMax = xMax
      const binW = (mddMax - mddMin) / BIN || 1
      const bins: (number | null)[] = Array(BIN).fill(null)
      for (const p of accountPoints) {
        const b = Math.min(Math.floor((p.maxDrawdown - mddMin) / binW), BIN - 1)
        if (bins[b] === null || p.annualReturn > (bins[b] as number)) bins[b] = p.annualReturn
      }
      let peak = -Infinity
      const paretoFrontier: [number, number][] = []
      for (let i = 0; i < BIN; i++) {
        if (bins[i] !== null && (bins[i] as number) >= peak) {
          peak = bins[i] as number
          paretoFrontier.push([Math.round((mddMin + (i + 0.5) * binW) * 100) / 100, Math.round(peak * 100) / 100])
        }
      }
      series.push({
        name: "卡玛前沿",
        type: "line",
        data: paretoFrontier,
        showSymbol: false,
        lineStyle: { width: 2.5, color: "#ef4444", type: "dashed" },
        itemStyle: { color: "#ef4444" },
        z: 10,
      })
    } else {
      series.push(
        // Background Monte Carlo cloud
        {
          name: "随机组合",
          type: "scatter",
          data: simPoints.map((p) => [p.vol, p.ret]),
          symbolSize: 3,
          itemStyle: { color: "rgba(140,140,140,0.2)" },
          large: true,
          silent: true,
          legendHoverLink: false,
          tooltip: { show: false },
        },
        // Efficient frontier line
        {
          name: "有效前沿",
          type: "line",
          data: frontier.map((p) => [p.vol, p.ret]),
          showSymbol: false,
          lineStyle: { width: 2.5, color: "#ef4444" },
          itemStyle: { color: "#ef4444" },
          z: 10,
        },
      )
    }

    // Per-sector account dots
    series.push(
      ...[...sectorGroups.entries()].map(([sector, points]) => ({
        name: sector,
        type: "scatter",
        data: points.map((p) => ({
          value: isMdd ? [p.maxDrawdown, p.annualReturn] : [p.vol, p.annualReturn],
          name: p.account,
        })),
        symbolSize: 9,
        itemStyle: {
          color: sectorColorMap.get(sector) ?? "#888",
          borderColor: "#fff",
          borderWidth: 1,
        },
        z: 20,
      })),
    )

    const sectorNames = [...sectorGroups.keys()]
    const legendData = isMdd ? ["卡玛前沿", ...sectorNames] : ["有效前沿", ...sectorNames]

    return {
      grid: { left: 56, right: 28, top: 52, bottom: 48 },
      legend: {
        top: 4,
        left: "center",
        textStyle: { fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8,
        data: legendData,
      },
      xAxis: {
        type: "value",
        name: isMdd ? "最大回撤 (%)" : "年化波动率 (%)",
        nameLocation: "middle",
        nameGap: 30,
        nameTextStyle: { fontSize: 11 },
        min: xMin,
        max: xMax,
        axisLabel: { fontSize: 10, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
      },
      yAxis: {
        type: "value",
        name: "年化收益率 (%)",
        nameLocation: "end",
        nameTextStyle: { fontSize: 11 },
        min: retMin,
        max: retMax,
        axisLabel: { fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
      },
      tooltip: {
        trigger: "item",
        formatter: (params: { seriesName: string; name?: string; value: [number, number] }) => {
          if (params.seriesName === "随机组合") return ""
          if (params.seriesName === "有效前沿") {
            return `有效前沿<br/>波动率：${params.value[0].toFixed(2)}%<br/>收益率：${params.value[1].toFixed(2)}%`
          }
          if (params.seriesName === "卡玛前沿") {
            return `卡玛前沿（回撤帕累托边界）<br/>最大回撤：${params.value[0].toFixed(2)}%<br/>收益率：${params.value[1].toFixed(2)}%`
          }
          if (isMdd) {
            return `${params.name ?? ""}<br/>最大回撤：${params.value[0].toFixed(2)}%<br/>年化收益率：${params.value[1].toFixed(2)}%<br/>分组：${params.seriesName}`
          }
          return `${params.name ?? ""}<br/>年化波动率：${params.value[0].toFixed(2)}%<br/>年化收益率：${params.value[1].toFixed(2)}%<br/>分组：${params.seriesName}`
        },
      },
      series,
    }
  }, [accountPoints, simPoints, frontier, sectorColorMap, mode])

  return (
    <Card className="h-full">
      <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm font-medium">各账户风险-收益 & 有效前沿</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {mode === "vol"
              ? "X轴: 年化波动率 · Y轴: 年化收益率 · 红线: 长多有效前沿"
              : "X轴: 最大回撤 · Y轴: 年化收益率 · 红虚线: 回撤-收益帕累托边界"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Mode toggle */}
          <div className="flex items-center rounded border border-border overflow-hidden text-xs">
            <button
              onClick={() => setMode("vol")}
              className={`px-2 py-0.5 transition-colors ${mode === "vol" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >波动率</button>
            <button
              onClick={() => setMode("mdd")}
              className={`px-2 py-0.5 transition-colors border-l border-border ${mode === "mdd" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >最大回撤</button>
          </div>
          {/* Window */}
          <div className="flex items-center gap-1">
            {WINDOW_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setWin(o.value)}
                className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                  win === o.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        {loading ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            加载中…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center text-sm text-destructive" style={{ height }}>
            {error}
          </div>
        ) : accountPoints.length === 0 ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            暂无数据
          </div>
        ) : (
          <ReactECharts
            key={`rr-${win}-${mode}-${accountPoints.length}`}
            option={option}
            style={{ height, width: "100%" }}
            notMerge
          />
        )}
      </CardContent>
    </Card>
  )
}
