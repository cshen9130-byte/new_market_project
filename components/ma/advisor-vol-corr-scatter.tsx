"use client"

import { useState, useEffect, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type AdvisorPoint = {
  account: string
  vol: number
  corr: number
  pnl: number
  sector: string
}

const WINDOW_OPTIONS = [
  { value: "5",   label: "近 5 日" },
  { value: "10",  label: "近 10 日" },
  { value: "20",  label: "近 20 日" },
  { value: "60",  label: "近 60 日" },
]

// Distinct palette for sectors
const SECTOR_PALETTE = [
  "#f59e0b", "#3b82f6", "#a855f7", "#06b6d4", "#f97316",
  "#84cc16", "#ec4899", "#14b8a6", "#8b5cf6", "#ef4444",
  "#6366f1", "#22c55e",
]

export default function AdvisorVolCorrScatter({ height = 380 }: { height?: number }) {
  const [volWindow,  setVolWindow]  = useState("20")
  const [data,       setData]       = useState<AdvisorPoint[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [colorMode,  setColorMode]  = useState<"pnl" | "sector">("pnl")
  const [showLabels, setShowLabels] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/ma/api/mom-analysis/advisor-vol?window=${volWindow}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) { setError(j.error ?? "加载失败"); return }
        setData(
          (j.advisors ?? []).filter(
            (a: AdvisorPoint) => a.corr !== undefined && isFinite(a.corr),
          ) as AdvisorPoint[],
        )
      })
      .catch((e) => setError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setLoading(false))
  }, [volWindow])

  // Build sector → color map
  const sectorColorMap = useMemo(() => {
    const sectors = [...new Set(data.map((d) => d.sector))].sort()
    return new Map(sectors.map((s, i) => [s, SECTOR_PALETTE[i % SECTOR_PALETTE.length]]))
  }, [data])

  const option = useMemo(() => {
    if (data.length === 0) return {}

    const maxVol = Math.max(...data.map((d) => d.vol))

    if (colorMode === "sector") {
      // One series per sector so ECharts legend works
      const sectors = [...sectorColorMap.keys()]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const series: any[] = sectors.map((sector) => ({
        name: sector,
        type: "scatter",
        symbolSize: 10,
        itemStyle: { color: sectorColorMap.get(sector), borderWidth: 0 },
        label: { show: showLabels, position: "top", fontSize: 10,
          formatter: (p: { name: string }) => p.name },
        data: data
          .filter((d) => d.sector === sector)
          .map((d) => ({
            name: d.account.toUpperCase(),
            value: [d.corr, d.vol, d.pnl],
          })),
      }))

      return {
        backgroundColor: "transparent",
        animation: false,
        legend: {
          type: "scroll",
          bottom: 2,
          textStyle: { fontSize: 11 },
          itemWidth: 12,
          itemHeight: 8,
        },
        tooltip: {
          trigger: "item",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          formatter: (p: any) => {
            const [corr, vol, pnl] = p.value as [number, number, number]
            const sign = pnl >= 0 ? "+" : ""
            return [
              `<b>${p.name}</b>`,
              `分组: <b>${p.seriesName}</b>`,
              `相关性: <b>${corr.toFixed(3)}</b>`,
              `年化波动率: <b>${vol.toFixed(2)}%</b>`,
              `区间盈亏: <b>${sign}${(pnl / 10000).toFixed(1)}万</b>`,
            ].join("<br/>")
          },
        },
        grid: { left: 56, right: 20, top: 24, bottom: 56 },
        xAxis: {
          type: "value", name: "与组合相关性", nameLocation: "middle", nameGap: 28,
          nameTextStyle: { fontSize: 11 }, min: -1, max: 1,
          splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,0.2)" } },
          axisLine: { show: true, lineStyle: { color: "rgba(148,163,184,0.4)" } },
          axisTick: { show: false }, axisLabel: { fontSize: 10 },
        },
        yAxis: {
          type: "value", name: "年化波动率 (%)", nameLocation: "middle", nameGap: 44,
          nameTextStyle: { fontSize: 11 }, min: 0, max: Math.ceil(maxVol * 1.15),
          splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,0.2)" } },
          axisLabel: { fontSize: 10, formatter: (v: number) => v.toFixed(0) + "%" },
        },
        series,
      }
    }

    // PnL color mode (single series)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seriesData: any[] = data.map((d) => ({
      name: d.account.toUpperCase(),
      value: [d.corr, d.vol, d.pnl],
      itemStyle: {
        color: d.pnl >= 0 ? "rgba(239,68,68,0.85)" : "rgba(34,197,94,0.85)",
        borderColor: d.pnl >= 0 ? "#dc2626" : "#16a34a",
        borderWidth: 1,
      },
    }))

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "item",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => {
          const [corr, vol, pnl] = p.value as [number, number, number]
          const sign = pnl >= 0 ? "+" : ""
          return [
            `<b>${p.name}</b>`,
            `相关性: <b>${corr.toFixed(3)}</b>`,
            `年化波动率: <b>${vol.toFixed(2)}%</b>`,
            `区间盈亏: <b>${sign}${(pnl / 10000).toFixed(1)}万</b>`,
          ].join("<br/>")
        },
      },
      grid: { left: 56, right: 20, top: 24, bottom: 40 },
      xAxis: {
        type: "value", name: "与组合相关性", nameLocation: "middle", nameGap: 28,
        nameTextStyle: { fontSize: 11 }, min: -1, max: 1,
        splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,0.2)" } },
        axisLine: { show: true, lineStyle: { color: "rgba(148,163,184,0.4)" } },
        axisTick: { show: false }, axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: "value", name: "年化波动率 (%)", nameLocation: "middle", nameGap: 44,
        nameTextStyle: { fontSize: 11 }, min: 0, max: Math.ceil(maxVol * 1.15),
        splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,0.2)" } },
        axisLabel: { fontSize: 10, formatter: (v: number) => v.toFixed(0) + "%" },
      },
      series: [{
        type: "scatter",
        data: seriesData,
        symbolSize: 10,
        label: { show: showLabels, position: "top", fontSize: 10,
          formatter: (p: { name: string }) => p.name },
      }],
    }
  }, [data, colorMode, sectorColorMap, showLabels])

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">
            各账户波动率 vs 组合相关性
          </CardTitle>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLabels((v) => !v)}
              className={`h-7 rounded px-2.5 text-xs font-medium border transition-colors ${
                showLabels
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-input hover:text-foreground"
              }`}
            >
              账户名
            </button>
            <button
              onClick={() => setColorMode((m) => m === "pnl" ? "sector" : "pnl")}
              className={`h-7 rounded px-2.5 text-xs font-medium border transition-colors ${
                colorMode === "sector"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-input hover:text-foreground"
              }`}
            >
              {colorMode === "sector" ? "按分组" : "按盈亏"}
            </button>
            <select
              value={volWindow}
              onChange={(e) => setVolWindow(e.target.value)}
              className="rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {WINDOW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {colorMode === "sector"
            ? "X轴: 与组合相关性 · Y轴: 年化波动率 · 颜色: 投顾分组"
            : "X轴: 与组合相关性 · Y轴: 年化波动率 · 颜色: 区间盈亏（红盈绿亏）"}
        </p>
      </CardHeader>
      <CardContent className="pt-1">
        {loading ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            加载中…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center text-sm text-destructive px-4 text-center" style={{ height }}>
            {error}
          </div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            暂无数据
          </div>
        ) : (
          <ReactECharts
            key={`vol-corr-${volWindow}-${colorMode}-${data.length}`}
            option={option}
            style={{ height }}
          />
        )}
      </CardContent>
    </Card>
  )
}
