"use client"

import { useState, useEffect, useRef } from "react"
import * as echarts from "echarts/core"
import { HeatmapChart } from "echarts/charts"
import { GridComponent, TooltipComponent, VisualMapComponent, DataZoomComponent } from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

echarts.use([HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, DataZoomComponent, CanvasRenderer])

const WINDOW_OPTIONS = [
  { value: "60",  label: "近 60 日" },
  { value: "120", label: "近 120 日" },
  { value: "250", label: "近 250 日" },
  { value: "",    label: "全部" },
]

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background border border-border rounded-lg shadow-xl p-5 max-w-lg w-full mx-4 text-sm max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-base">板块杠杆热力图：计算方法</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="space-y-4 text-muted-foreground leading-relaxed">
          <p>每个格子表示某板块在某交易日的 <strong className="text-foreground">名义保证金占用（万元）</strong>，公式为：</p>
          <div className="bg-muted rounded px-3 py-2 font-mono text-xs space-y-1">
            <div>utilization_i = 保证金占用_i / 客户权益_i</div>
            <div>deployed_i = equity_wan_i × utilization_i</div>
            <div>cell(sector, date) = Σᵢ∈sector deployed_i</div>
          </div>
          <ul className="list-disc list-inside text-xs space-y-1">
            <li><strong className="text-foreground">equity_wan</strong>：来自投顾信息表的额定配置规模（万元），固定值，排除日常权益浮动影响。</li>
            <li><strong className="text-foreground">utilization</strong>：当日实际保证金占用 ÷ 客户权益，反映该账户的杠杆程度。</li>
            <li>颜色越深 → 该板块当日部署的资本越多；颜色骤变 → 可能存在仓位调整或风险事件。</li>
            <li>横向对比板块：识别哪个板块在同一时期资本集中度最高。</li>
            <li>纵向观察单板块：识别该板块的周期性建仓 / 减仓规律。</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default function AdvisorSectorLeverageHeatmap({ height = 320 }: { height?: number }) {
  const [win, setWin] = useState("120")
  const [showHelp, setShowHelp] = useState(false)
  const [data, setData] = useState<{ dates: string[]; sectors: string[]; data: [number, number, number][] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<echarts.ECharts | null>(null)

  // Dispose echarts instance when window changes so the next render reinitialises on the live div
  useEffect(() => {
    instanceRef.current?.dispose()
    instanceRef.current = null
  }, [win])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const url = win ? `/ma/api/mom-analysis/sector-leverage-heatmap?window=${win}` : "/ma/api/mom-analysis/sector-leverage-heatmap"
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) { setError(j.error ?? "加载失败"); return }
        setData({ dates: j.dates ?? [], sectors: j.sectors ?? [], data: j.data ?? [] })
      })
      .catch((e) => setError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setLoading(false))
  }, [win])

  useEffect(() => {
    if (!chartRef.current || !data) return
    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current, undefined, { renderer: "canvas" })
    }
    const chart = instanceRef.current

    const { dates, sectors, data: cells } = data
    // Format x labels: show every N-th date to avoid crowding
    const step = Math.max(1, Math.floor(dates.length / 20))
    const xLabels = dates.map((d, i) => (i % step === 0 ? d.slice(5) : "")) // MM-DD

    // Compute max for visual map
    const vals = cells.map((c) => c[2])
    const maxVal = vals.length ? Math.max(...vals) : 1
    const minVal = 0

    const option: echarts.EChartsOption = {
      grid: { left: 72, right: 100, top: 16, bottom: 60 },
      xAxis: {
        type: "category",
        data: xLabels,
        splitArea: { show: false },
        axisLabel: { fontSize: 9, rotate: 45, interval: 0 },
        axisTick: { show: false },
      },
      yAxis: {
        type: "category",
        data: sectors,
        splitArea: { show: true, areaStyle: { color: ["rgba(128,128,128,0.04)", "transparent"] } },
        axisLabel: { fontSize: 11 },
      },
      visualMap: {
        min: minVal,
        max: maxVal,
        calculable: true,
        orient: "vertical",
        right: 8,
        top: "center",
        itemHeight: 140,
        textStyle: { fontSize: 10 },
        inRange: { color: ["#1e293b", "#0ea5e9", "#f59e0b", "#ef4444"] },
        formatter: (v: number) => `${v.toFixed(0)}万`,
      },
      tooltip: {
        trigger: "item",
        formatter: (params: { data: [number, number, number] }) => {
          const [di, si, val] = params.data
          return [
            `<b>${sectors[si]}</b>`,
            `日期：${dates[di]}`,
            `名义保证金：${val.toFixed(1)} 万`,
          ].join("<br/>")
        },
      },
      dataZoom: [
        { type: "slider", xAxisIndex: 0, bottom: 4, height: 14, start: 0, end: 100, textStyle: { fontSize: 9 } },
      ],
      series: [{
        type: "heatmap",
        data: cells,
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.4)" } },
      }],
    }

    chart.setOption(option, { notMerge: true })
  }, [data])

  useEffect(() => {
    const obs = new ResizeObserver(() => instanceRef.current?.resize())
    if (chartRef.current) obs.observe(chartRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => () => { instanceRef.current?.dispose(); instanceRef.current = null }, [])

  return (
    <Card className="h-full">
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm font-medium">板块杠杆热力图</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">名义保证金占用（万）= Σ equity_wan × 保证金占用率 · 颜色越深 = 部署越多</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {WINDOW_OPTIONS.map((o) => (
            <button key={o.value} onClick={() => setWin(o.value)} className={`px-2 py-0.5 text-xs rounded border transition-colors ${win === o.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {o.label}
            </button>
          ))}
          <button onClick={() => setShowHelp(true)} className="flex-shrink-0 w-5 h-5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground text-xs flex items-center justify-center transition-colors" title="计算说明">
            ?
          </button>
        </div>
      </CardHeader>
      <CardContent className="pt-1 relative">
        {/* Chart div always stays mounted so the echarts instance stays valid across window changes */}
        <div ref={chartRef} style={{ height, width: "100%", visibility: (!loading && !error && !!data?.sectors.length) ? "visible" : "hidden" }} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">加载中…</div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-destructive">{error}</div>
        )}
        {!loading && !error && !data?.sectors.length && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">暂无数据</div>
        )}
      </CardContent>
    </Card>
  )
}
