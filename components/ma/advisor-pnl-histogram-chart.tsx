"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type AdvisorPnl = { account: string; pnl: number }

const WINDOW_OPTIONS = [
  { label: "最新一日", value: "1" },
  { label: "近一周",   value: "5" },
  { label: "近两周",   value: "10" },
  { label: "近一月",   value: "20" },
  { label: "近三月",   value: "60" },
]

export default function AdvisorPnlHistogramChart({ height = 320 }: { height?: number; window?: string }) {
  const [selectedWindow, setSelectedWindow] = useState("1")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [advisorPnl, setAdvisorPnl] = useState<AdvisorPnl[]>([])

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/ma/api/mom-analysis/advisor-vol?window=${selectedWindow}&nocache=1`)
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) throw new Error(j?.error || "加载失败")
        setAdvisorPnl((j.advisors ?? []) as AdvisorPnl[])
      })
      .catch((e) => setError(String(e?.message || "加载失败")))
      .finally(() => setLoading(false))
  }, [selectedWindow])

  const option = useMemo(() => {
    if (advisorPnl.length === 0) return {}
    const pnls = advisorPnl.map((d) => d.pnl)
    const minVal = Math.min(...pnls)
    const maxVal = Math.max(...pnls)
    const range = maxVal - minVal || 1
    const BIN_COUNT = Math.min(10, advisorPnl.length)
    const binSize = range / BIN_COUNT
    const bins: { label: string; count: number; profit: boolean }[] = []
    for (let i = 0; i < BIN_COUNT; i++) {
      const lo = minVal + i * binSize
      const hi = lo + binSize
      const count = pnls.filter((v) => i === BIN_COUNT - 1 ? v >= lo && v <= hi : v >= lo && v < hi).length
      const mid = (lo + hi) / 2
      const fmt = (v: number) => Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${Math.round(v)}`
      bins.push({ label: `${fmt(lo)}~${fmt(hi)}`, count, profit: mid >= 0 })
    }
    return {
      grid: { left: 36, right: 20, top: 16, bottom: 80 },
      xAxis: {
        type: "category",
        data: bins.map((b) => b.label),
        axisLabel: { fontSize: 10, rotate: 40, interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "账户数",
        nameLocation: "end",
        nameTextStyle: { fontSize: 11 },
        minInterval: 1,
        axisLabel: { fontSize: 11 },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params?.[0]
          if (!p) return ""
          return `${p.name}<br/>账户数：${p.value}`
        },
      },
      series: [{
        type: "bar",
        data: bins.map((b) => b.count),
        barMaxWidth: 40,
        itemStyle: {
          color: (params: { dataIndex: number }) => bins[params.dataIndex].profit ? "#ef4444" : "#22c55e",
        },
        label: {
          show: true,
          position: "top",
          fontSize: 11,
          formatter: (p: { value: number }) => p.value > 0 ? String(p.value) : "",
        },
      }],
    }
  }, [advisorPnl])

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">投顾盈亏分布直方图</CardTitle>
          <div className="flex items-center gap-1">
            {WINDOW_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setSelectedWindow(o.value)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  selectedWindow === o.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : error ? (
          <div className="flex h-48 items-center justify-center text-sm text-destructive px-4 text-center">{error}</div>
        ) : advisorPnl.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
        ) : (
          <ReactECharts option={option} style={{ height }} notMerge />
        )}
      </CardContent>
    </Card>
  )
}