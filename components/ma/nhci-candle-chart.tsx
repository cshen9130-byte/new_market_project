"use client"

import { useCallback, useEffect, useState } from "react"
import ReactECharts from "echarts-for-react"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// ── Types ─────────────────────────────────────────────────────────────────────

type CandleRow = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type ApiResponse = {
  ok: boolean
  data: CandleRow[]
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null
    const sum = closes.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0)
    return parseFloat((sum / period).toFixed(4))
  })
}

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}
function isoMonthOffset(months: number) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

const QUICK_RANGES = [
  { label: "近一月", from: () => isoMonthOffset(-1),  to: () => isoToday() },
  { label: "近三月", from: () => isoMonthOffset(-3),  to: () => isoToday() },
  { label: "近六月", from: () => isoMonthOffset(-6),  to: () => isoToday() },
  { label: "近一年", from: () => isoMonthOffset(-12), to: () => isoToday() },
  { label: "全部",   from: () => "2025-01-01",         to: () => isoToday() },
]

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  height?: number
}

export default function NhciCandleChart({ height = 300 }: Props) {
  const [fromDate, setFromDate] = useState(() => isoMonthOffset(-3))
  const [toDate,   setToDate]   = useState(() => isoToday())
  const [data,     setData]     = useState<CandleRow[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams()
      if (from) p.set("from", from)
      if (to)   p.set("to",   to)
      const res = await fetch(`/ma/api/mom-analysis/nhci-candle?${p}`)
      const d: ApiResponse = await res.json()
      if (!d.ok) throw new Error(d.error || "加载失败")
      setData(d.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(fromDate, toDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Chart data ─────────────────────────────────────────────────────────────

  const dates  = data.map(r => r.date)
  const ohlcv  = data.map(r => [r.open, r.close, r.low, r.high])
  const closes = data.map(r => r.close)
  const ma5    = calcMA(closes, 5)
  const ma20   = calcMA(closes, 20)

  const volumes = data.map(r => ({
    value: r.volume ?? 0,
    itemStyle: { color: r.close >= r.open ? "#ef4444" : "#22c55e" },
  }))
  const hasVolume = volumes.some(v => (v.value ?? 0) > 0)

  // ── ECharts option ─────────────────────────────────────────────────────────

  const option = {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const candle = params.find((p: any) => p.seriesName === "NHCI")
        if (!candle) return ""
        const [o, c, l, h] = candle.data as number[]
        const arrow = c >= o
          ? `<span style="color:#ef4444">▲</span>`
          : `<span style="color:#22c55e">▼</span>`
        const lines = [
          `<b>${candle.axisValue}</b> ${arrow}`,
          `开&nbsp;${o?.toFixed(2)}&nbsp;&nbsp;收&nbsp;<b>${c?.toFixed(2)}</b>`,
          `高&nbsp;${h?.toFixed(2)}&nbsp;&nbsp;低&nbsp;${l?.toFixed(2)}`,
        ]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ma5p  = params.find((p: any) => p.seriesName === "MA5")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ma20p = params.find((p: any) => p.seriesName === "MA20")
        if (ma5p?.data  != null) lines.push(`MA5&nbsp;&nbsp;${Number(ma5p.data).toFixed(2)}`)
        if (ma20p?.data != null) lines.push(`MA20&nbsp;${Number(ma20p.data).toFixed(2)}`)
        return lines.join("<br/>")
      },
    },
    legend: {
      top: 4,
      data: ["NHCI", "MA5", "MA20"],
      textStyle: { fontSize: 11 },
    },
    grid: [
      { left: 64, right: 16, top: 36, bottom: hasVolume ? 130 : 56 },
      ...(hasVolume ? [{ left: 64, right: 16, top: "73%", bottom: 56 }] : []),
    ],
    xAxis: [
      {
        type: "category",
        data: dates,
        gridIndex: 0,
        axisLabel: { show: false },
        axisPointer: { label: { show: false } },
        boundaryGap: true,
      },
      ...(hasVolume
        ? [{
            type: "category",
            data: dates,
            gridIndex: 1,
            axisLabel: { fontSize: 10, rotate: 30 },
            boundaryGap: true,
          }]
        : []),
    ],
    yAxis: [
      {
        scale: true,
        gridIndex: 0,
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      ...(hasVolume
        ? [{
            gridIndex: 1,
            axisLabel: { show: false },
            splitLine: { show: false },
          }]
        : []),
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: hasVolume ? [0, 1] : [0],
        start: 0,
        end: 100,
      },
      {
        type: "slider",
        xAxisIndex: hasVolume ? [0, 1] : [0],
        bottom: 12,
        height: 28,
      },
    ],
    series: [
      {
        name: "NHCI",
        type: "candlestick",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ohlcv,
        itemStyle: {
          color:        "#ef4444",
          color0:       "#22c55e",
          borderColor:  "#ef4444",
          borderColor0: "#22c55e",
        },
      },
      {
        name: "MA5",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ma5,
        smooth: false,
        lineStyle: { width: 1.5, color: "#f59e0b" },
        symbol: "none",
        connectNulls: true,
      },
      {
        name: "MA20",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ma20,
        smooth: false,
        lineStyle: { width: 1.5, color: "#8b5cf6" },
        symbol: "none",
        connectNulls: true,
      },
      ...(hasVolume
        ? [{
            name: "成交量",
            type: "bar",
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: volumes,
            barMaxWidth: 8,
          }]
        : []),
    ],
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">
            南华商品指数（NHCI.NH）日K线
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {/* quick-range buttons */}
            <div className="flex items-center gap-1">
              {QUICK_RANGES.map(r => {
                const active = fromDate === r.from() && toDate === r.to()
                return (
                  <button
                    key={r.label}
                    onClick={() => {
                      const f = r.from()
                      const t = r.to()
                      setFromDate(f)
                      setToDate(t)
                      load(f, t)
                    }}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
            {/* manual date pickers */}
            <div className="flex items-center gap-1 text-xs">
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="rounded border border-input bg-background px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-muted-foreground">—</span>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="rounded border border-input bg-background px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => load(fromDate, toDate)}
              disabled={loading}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-2 pb-4">
        {error && (
          <div className="flex items-center justify-center text-sm text-destructive" style={{ height }}>
            {error}
          </div>
        )}
        {!error && loading && (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            加载中…
          </div>
        )}
        {!error && !loading && data.length === 0 && (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            暂无数据
          </div>
        )}
        {!error && !loading && data.length > 0 && (
          <ReactECharts
            option={option}
            style={{ height: `${height}px` }}
            notMerge={true}
          />
        )}
      </CardContent>
    </Card>
  )
}
