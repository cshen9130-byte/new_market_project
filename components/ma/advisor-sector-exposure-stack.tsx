"use client"

import { useState, useEffect, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const SECTORS = ["农产","生鲜","贵金属","有色","新能源","黑色","能源化工","航运","股指","国债","其他"]

type SeriesPoint = Record<string, number> & { date: string }

export default function AdvisorSectorExposureStack({ height = 320 }: { height?: number }) {
  const [data, setData] = useState<SeriesPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<"latest" | "timeseries">("latest")

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch("/ma/api/mom-analysis/category-exposure")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) { setError(j.error ?? "加载失败"); return }
        setData(j.series ?? [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setLoading(false))
  }, [])

  const latestOption = useMemo(() => {
    if (!data.length) return {}
    const latest = data[data.length - 1]
    // Filter sectors that have any exposure
    const activeSectors = SECTORS.filter(
      (s) => (latest[`long_s_${s}`] ?? 0) !== 0 || (latest[`short_s_${s}`] ?? 0) !== 0
    )
    if (!activeSectors.length) return {}

    // Sort by net (long + short, where short is negative)
    const sorted = [...activeSectors].sort((a, b) => {
      const netA = (latest[`long_s_${a}`] ?? 0) + (latest[`short_s_${a}`] ?? 0)
      const netB = (latest[`long_s_${b}`] ?? 0) + (latest[`short_s_${b}`] ?? 0)
      return netB - netA
    })

    const longVals  = sorted.map((s) => Math.round(latest[`long_s_${s}`]  ?? 0))
    const shortVals = sorted.map((s) => Math.round(latest[`short_s_${s}`] ?? 0)) // already negative

    return {
      grid: { left: 72, right: 20, top: 36, bottom: 36 },
      legend: { top: 4, right: 10, data: ["净多头", "净空头"], textStyle: { fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
      xAxis: {
        type: "value",
        name: "名义市值 (元)",
        nameLocation: "middle",
        nameGap: 22,
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10, formatter: (v: number) => `${(v / 10000).toFixed(0)}万` },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.2 } },
      },
      yAxis: {
        type: "category",
        data: sorted,
        axisLabel: { fontSize: 11 },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { seriesName: string; value: number; dataIndex: number }[]) => {
          const sector = sorted[params[0].dataIndex]
          const lv = longVals[params[0].dataIndex]
          const sv = shortVals[params[0].dataIndex]
          const net = lv + sv
          const netColor = net >= 0 ? "#ef4444" : "#22c55e"
          return [
            `<b>${sector}</b>`,
            `净多头：${lv.toLocaleString()} 元`,
            `净空头：${sv.toLocaleString()} 元`,
            `<span style="color:${netColor}">净敞口：${net >= 0 ? "+" : ""}${net.toLocaleString()} 元</span>`,
          ].join("<br/>")
        },
      },
      series: [
        {
          name: "净多头",
          type: "bar",
          stack: "exposure",
          data: longVals,
          barMaxWidth: 16,
          itemStyle: { color: "rgba(239,68,68,0.8)", borderRadius: [0, 3, 3, 0] },
        },
        {
          name: "净空头",
          type: "bar",
          stack: "exposure",
          data: shortVals,
          barMaxWidth: 16,
          itemStyle: { color: "rgba(34,197,94,0.8)", borderRadius: [3, 0, 0, 3] },
        },
      ],
    }
  }, [data, mode])

  const timeseriesOption = useMemo(() => {
    if (!data.length) return {}
    const dates = data.map((d) => d.date.slice(5)) // MM-DD

    // Net per sector over time
    const activeSectors = SECTORS.filter((s) =>
      data.some((d) => (d[`long_s_${s}`] ?? 0) !== 0 || (d[`short_s_${s}`] ?? 0) !== 0)
    )

    const PALETTE = ["#ef4444","#f59e0b","#22c55e","#0ea5e9","#a855f7","#ec4899","#14b8a6","#f97316","#84cc16","#06b6d4","#6366f1"]

    return {
      grid: { left: 60, right: 16, top: 36, bottom: 52 },
      legend: {
        top: 4, type: "scroll", textStyle: { fontSize: 9 }, itemWidth: 10, itemHeight: 8,
        data: activeSectors,
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { fontSize: 9, rotate: 45, interval: Math.max(0, Math.floor(dates.length / 15)) },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: "净敞口 (元)",
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10, formatter: (v: number) => `${(v / 10000).toFixed(0)}万` },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.2 } },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (params: { seriesName: string; value: number; color: string }[]) => {
          const lines = params
            .filter((p) => p.value !== 0)
            .sort((a, b) => b.value - a.value)
            .map((p) => `<span style="color:${p.color}">●</span> ${p.seriesName}: ${p.value >= 0 ? "+" : ""}${Math.round(p.value).toLocaleString()} 元`)
          return lines.join("<br/>")
        },
      },
      dataZoom: [
        { type: "slider", xAxisIndex: 0, bottom: 4, height: 14, start: Math.max(0, 100 - 6000 / dates.length), end: 100, textStyle: { fontSize: 9 } },
      ],
      series: activeSectors.map((s, i) => ({
        name: s,
        type: "bar",
        stack: "net",
        data: data.map((d) => Math.round((d[`long_s_${s}`] ?? 0) + (d[`short_s_${s}`] ?? 0))),
        itemStyle: { color: PALETTE[i % PALETTE.length] },
        emphasis: { focus: "series" },
      })),
    }
  }, [data])

  const option  = mode === "latest" ? latestOption : timeseriesOption
  const chartKey = mode === "latest" ? `ls-latest-${data.length}` : `ls-ts-${data.length}`

  return (
    <Card className="h-full">
      <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm font-medium">板块多空敞口分布</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {mode === "latest"
              ? `截面：最新日 · 红=净多头 绿=净空头 · 单位：名义市值（元）`
              : "时序：各板块净敞口（多 + 空）堆叠柱"}
          </p>
        </div>
        <div className="flex items-center rounded border border-border overflow-hidden text-xs flex-shrink-0">
          <button onClick={() => setMode("latest")} className={`px-2 py-0.5 transition-colors ${mode === "latest" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            截面
          </button>
          <button onClick={() => setMode("timeseries")} className={`px-2 py-0.5 border-l border-border transition-colors ${mode === "timeseries" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            时序
          </button>
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        {loading ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>加载中…</div>
        ) : error ? (
          <div className="flex items-center justify-center text-sm text-destructive" style={{ height }}>{error}</div>
        ) : !data.length ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>暂无数据</div>
        ) : (
          <ReactECharts key={chartKey} option={option} style={{ height, width: "100%" }} notMerge />
        )}
      </CardContent>
    </Card>
  )
}
