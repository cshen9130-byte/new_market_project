"use client"

import { useState, useEffect } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface VarPoint { date: string; var: number; actual: number }

export default function VarPredictionChart({ height = 320 }: { height?: number }) {
  const [varData, setVarData]             = useState<VarPoint[]>([])
  const [varBreachRate, setVarBreachRate] = useState<number | null>(null)
  const [varLoading, setVarLoading]       = useState(false)
  const [varConfidence, setVarConfidence] = useState("95")
  const [varVolDays, setVarVolDays]       = useState("20")
  const [varCorrDays, setVarCorrDays]     = useState("252")
  const [varDistModel, setVarDistModel]   = useState("normal")
  const [varZoom, setVarZoom]             = useState({ start: 0, end: 100 })

  const fetchVar = (confidence: string, volDays: string, corrDays: string, distModel: string) => {
    setVarLoading(true)
    const params = new URLSearchParams({ confidence, volDays, corrDays, distModel })
    fetch(`/ma/api/mom-analysis/var-prediction?${params}`)
      .then((r) => r.json())
      .then((j) => {
        const rows: VarPoint[] = j.data ?? []
        setVarData(rows)
        setVarZoom({ start: rows.length < 40 ? 0 : 60, end: 100 })
        if (j.breachRate != null) setVarBreachRate(j.breachRate)
      })
      .catch(() => {})
      .finally(() => setVarLoading(false))
  }

  useEffect(() => { fetchVar(varConfidence, varVolDays, varCorrDays, varDistModel) }, [])

  const handleZoom = (params: { start?: number; end?: number; batch?: { start: number; end: number }[] }) => {
    const s = params.batch ? params.batch[0].start : (params.start ?? varZoom.start)
    const e = params.batch ? params.batch[0].end   : (params.end   ?? varZoom.end)
    setVarZoom({ start: s, end: e })
  }

  const option = {
    tooltip: {
      trigger: "axis",
      formatter: (params: { seriesName: string; name: string; value: number; marker: string }[]) => {
        const lines = params.map((p) => `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`)
        return [params[0]?.name, ...lines].join("<br/>")
      },
    },
    legend: { data: ["实际|盈亏|", `VaR(${varConfidence}%)`], top: 5, itemWidth: 12, itemGap: 8 },
    grid: { left: 65, right: 20, top: 35, bottom: 50 },
    xAxis: {
      type: "category",
      data: varData.map((r) => r.date),
      axisLabel: { fontSize: 10, rotate: 30 },
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
    },
    dataZoom: [
      { type: "inside", start: varZoom.start, end: varZoom.end },
      { type: "slider", height: 20, bottom: 5, start: varZoom.start, end: varZoom.end },
    ],
    series: [
      {
        name: "实际|盈亏|",
        type: "bar",
        data: varData.map((r) => ({
          value: r.actual,
          itemStyle: { color: r.actual > r.var ? "#ef4444" : "#94a3b8" },
        })),
        barMaxWidth: 12,
      },
      {
        name: `VaR(${varConfidence}%)`,
        type: "line",
        data: varData.map((r) => r.var),
        lineStyle: { color: "#f97316", width: 2 },
        itemStyle: { color: "#f97316" },
        symbol: "none",
        z: 10,
      },
    ],
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm">
            VaR({varConfidence}%) 预测 vs 实际 |盈亏|
            {varBreachRate != null && (
              <span className="ml-3 text-xs font-normal text-muted-foreground">
                超标率 {varBreachRate}%　期望 {100 - parseInt(varConfidence, 10)}%
              </span>
            )}
          </CardTitle>
          {varLoading && <span className="text-xs text-muted-foreground">计算中…</span>}
        </div>
        {/* Filters inside card header */}
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <label className="text-xs text-muted-foreground">置信度</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varConfidence}
            onChange={(e) => { setVarConfidence(e.target.value); fetchVar(e.target.value, varVolDays, varCorrDays, varDistModel) }}
          >
            <option value="90">90%</option>
            <option value="95">95%</option>
            <option value="99">99%</option>
          </select>
          <label className="text-xs text-muted-foreground ml-2">波动率窗口</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varVolDays}
            onChange={(e) => { setVarVolDays(e.target.value); fetchVar(varConfidence, e.target.value, varCorrDays, varDistModel) }}
          >
            {["5","10","20","30","60"].map((d) => <option key={d} value={d}>{d} 天</option>)}
          </select>
          <label className="text-xs text-muted-foreground ml-2">相关系数窗口</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varCorrDays}
            onChange={(e) => { setVarCorrDays(e.target.value); fetchVar(varConfidence, varVolDays, e.target.value, varDistModel) }}
          >
            {["5","10","20","30","60","126","252","504"].map((d) => <option key={d} value={d}>{d} 天</option>)}
          </select>
          <label className="text-xs text-muted-foreground ml-2">分布</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varDistModel}
            onChange={(e) => { setVarDistModel(e.target.value); fetchVar(varConfidence, varVolDays, varCorrDays, e.target.value) }}
          >
            <option value="normal">正态分布</option>
            <option value="t">t 分布 (df=6)</option>
            <option value="laplace">拉普拉斯分布</option>
            <option value="logistic">Logistic 分布</option>
            <option value="kde">核密度估计 KDE</option>
          </select>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {varData.length === 0 && !varLoading && (
          <p className="text-sm text-muted-foreground text-center py-6">暂无数据</p>
        )}
        {(varData.length > 0 || varLoading) && (
          <ReactECharts option={option} style={{ height }} notMerge onEvents={{ dataZoom: handleZoom }} />
        )}
      </CardContent>
    </Card>
  )
}
