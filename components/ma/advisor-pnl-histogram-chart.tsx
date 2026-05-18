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

const DIST_OPTIONS = [
  { label: "无",        value: "none",    color: "" },
  { label: "正态",      value: "normal",  color: "#f59e0b" },
  { label: "拉普拉斯",  value: "laplace", color: "#a78bfa" },
  { label: "t (df=3)", value: "t3",      color: "#38bdf8" },
  { label: "t (df=5)", value: "t5",      color: "#34d399" },
]

// Lanczos gamma approximation (7-term, good to 15 digits)
function gammaFn(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z))
  z -= 1
  const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,
             771.32342877765313,-176.61502916214059,12.507343278686905,
             -0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7]
  let x = c[0]
  for (let i = 1; i < 9; i++) x += c[i] / (z + i)
  const t = z + 7.5
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x
}

export default function AdvisorPnlHistogramChart({ height = 320 }: { height?: number; window?: string }) {
  const [selectedWindow, setSelectedWindow] = useState("1")
  const [distType, setDistType] = useState("normal")
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
    const bound = Math.max(Math.abs(minVal), Math.abs(maxVal)) || 1
    const BIN_COUNT = 10
    const binSize = (2 * bound) / BIN_COUNT
    const bins: { label: string; count: number; profit: boolean }[] = []
    for (let i = 0; i < BIN_COUNT; i++) {
      const lo = -bound + i * binSize
      const hi = lo + binSize
      const count = pnls.filter((v) => i === BIN_COUNT - 1 ? v >= lo && v <= hi : v >= lo && v < hi).length
      const mid = (lo + hi) / 2
      const fmt = (v: number) => Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${Math.round(v)}`
      bins.push({ label: `${fmt(lo)}~${fmt(hi)}`, count, profit: mid >= 0 })
    }

    const n = pnls.length
    const mean = pnls.reduce((s, v) => s + v, 0) / n
    const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / n
    const std = Math.sqrt(variance) || 1

    // Sorted pnls for median
    const sorted = [...pnls].sort((a, b) => a - b)
    const median = n % 2 === 0 ? (sorted[n/2-1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)]
    const mad = sorted.map(v => Math.abs(v - median)).reduce((s, v) => s + v, 0) / n || 1  // mean absolute deviation

    // Build scaled PDF curve based on selected distribution
    const binMids = bins.map((_, i) => -bound + (i + 0.5) * binSize)
    const scale = n * binSize  // converts density → expected count

    let pdfCurve: number[] = []
    let curveName = ""
    let curveColor = ""

    if (distType === "normal") {
      curveName = "正态拟合"
      curveColor = "#f59e0b"
      pdfCurve = binMids.map(x =>
        parseFloat((Math.exp(-0.5 * ((x - mean) / std) ** 2) / (std * Math.sqrt(2 * Math.PI)) * scale).toFixed(3))
      )
    } else if (distType === "laplace") {
      curveName = "拉普拉斯拟合"
      curveColor = "#a78bfa"
      pdfCurve = binMids.map(x =>
        parseFloat((Math.exp(-Math.abs(x - median) / mad) / (2 * mad) * scale).toFixed(3))
      )
    } else if (distType === "t3" || distType === "t5") {
      const df = distType === "t3" ? 3 : 5
      curveName = `t(df=${df})拟合`
      curveColor = distType === "t3" ? "#38bdf8" : "#34d399"
      const tConst = gammaFn((df + 1) / 2) / (Math.sqrt(df * Math.PI) * gammaFn(df / 2) * std)
      pdfCurve = binMids.map(x => {
        const z = (x - mean) / std
        return parseFloat((tConst * Math.pow(1 + z * z / df, -(df + 1) / 2) * scale).toFixed(3))
      })
    }

    const distSeries = distType !== "none" ? [{
      name: curveName,
      type: "line",
      data: pdfCurve,
      smooth: true,
      symbol: "none",
      lineStyle: { color: curveColor, width: 2, type: "dashed" },
      z: 10,
    }] : []

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
        formatter: (params: { seriesName: string; name: string; value: number }[]) => {
          const name = params[0]?.name ?? ""
          return [
            `<b>${name}</b>`,
            ...params.map(p => `${p.seriesName}：${typeof p.value === "number" ? p.value.toFixed(2) : p.value}`),
          ].join("<br/>")
        },
      },
      series: [
        {
          name: "账户数",
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
        },
        ...distSeries,
      ],
    }
  }, [advisorPnl, distType])

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">投顾盈亏分布直方图</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
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
            <div className="flex items-center gap-1 border-l pl-2">
              <span className="text-xs text-muted-foreground">拟合：</span>
              <select
                value={distType}
                onChange={e => setDistType(e.target.value)}
                className="text-xs border rounded px-1.5 py-0.5 bg-background"
              >
                {DIST_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
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