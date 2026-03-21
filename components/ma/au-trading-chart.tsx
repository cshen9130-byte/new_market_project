"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// ── Types ─────────────────────────────────────────────────────────────────────

interface BenchmarkRow {
  date: string; open: number; high: number; low: number; close: number; volume: number
}
interface DailyPnlRow { date: string; pnl: number; cumPnl: number }
interface TradeMarker {
  date: string; contract: string; direction: string; action: string
  price: number | null; lots: number | null
}
interface ApiData {
  ok: boolean
  benchmark: BenchmarkRow[]
  dailyPnl: DailyPnlRow[]
  trades: TradeMarker[]
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoToday() { return new Date().toISOString().slice(0, 10) }
function isoMonthOffset(m: number) {
  const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10)
}
function isoYearOffset(y: number) {
  const d = new Date(); d.setFullYear(d.getFullYear() + y); return d.toISOString().slice(0, 10)
}

const QUICK_RANGES = [
  { label: "近三月",  from: () => isoMonthOffset(-3), to: () => isoToday() },
  { label: "近六月",  from: () => isoMonthOffset(-6), to: () => isoToday() },
  { label: "近一年",  from: () => isoYearOffset(-1),  to: () => isoToday() },
  { label: "全部",    from: () => "2025-01-01",        to: () => isoToday() },
]

function calcMA(data: (number | null)[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null
    const slice = data.slice(i - period + 1, i + 1)
    if (slice.some(v => v === null)) return null
    return (slice as number[]).reduce((s, v) => s + v, 0) / period
  })
}

function fmtYuan(v: number) {
  if (Math.abs(v) >= 1e6) return (v / 1e4).toFixed(1) + "万"
  if (Math.abs(v) >= 1e3) return (v / 1e4).toFixed(2) + "万"
  return v.toFixed(0)
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  account?: string
  chartHeight?: number
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AuTradingChart({ account = "rx000", chartHeight = 540 }: Props) {
  const [from, setFrom] = useState(() => "2025-01-01")
  const [to,   setTo]   = useState(() => isoToday())
  const [data,    setData]    = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: f, to: t, account })
      const res  = await fetch(`/ma/api/mom-analysis/au-trading?${params}`)
      const json: ApiData = await res.json()
      if (!json.ok) throw new Error(json.error || "请求失败")
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [account])

  useEffect(() => { load(from, to) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build ECharts option ──────────────────────────────────────────────────

  const option = useRef<object>({})

  if (data) {
    const bench = data.benchmark
    const bmDates = bench.map(b => b.date)
    const bmIdxMap = new Map(bmDates.map((d, i) => [d, i] as [string, number]))

    // Best-effort index lookup: exact match, else nearest previous trading day
    function getDateIdx(date: string): number {
      if (bmIdxMap.has(date)) return bmIdxMap.get(date)!
      let best = -1
      for (const [d, idx] of bmIdxMap) {
        if (d <= date && idx > best) best = idx
      }
      return best
    }

    const ohlc   = bench.map(b => [b.open, b.close, b.low, b.high])
    const closes = bench.map(b => b.close)
    const ma5    = calcMA(closes, 5)
    const ma20   = calcMA(closes, 20)

    // Benchmark % return from first close
    const base = bench[0]?.close || 1
    const bmReturn = bench.map(b => +((b.close - base) / base * 100).toFixed(3))

    // Align daily P&L to bmDates
    const pnlByDate = new Map(data.dailyPnl.map(r => [r.date, r]))
    let lastCum = 0
    const alignedDailyPnl = bmDates.map(d => {
      const r = pnlByDate.get(d)
      return r ? r.pnl : null
    })
    const alignedCumPnl = bmDates.map(d => {
      const r = pnlByDate.get(d)
      if (r) { lastCum = r.cumPnl; return r.cumPnl }
      // Forward fill on non-trading days (holidays between data points)
      return lastCum || null
    })

    // ── Trade markers (scatter on benchmark chart) ───────────────────────────
    // Group: 买开 / 卖开 / 平仓 (vague — includes both 卖平 and 买平)
    const openLong:  [number, number][] = []
    const openShort: [number, number][] = []
    const closePos:  [number, number][] = []

    for (const t of data.trades) {
      const idx = getDateIdx(t.date)
      if (idx < 0) continue
      const y = bench[idx]?.close
      if (y === undefined) continue

      const isOpen = !t.action || t.action.includes("开")
      if (isOpen && t.direction === "买")  openLong.push([idx, y])
      else if (isOpen && t.direction === "卖") openShort.push([idx, y])
      else closePos.push([idx, y])
    }

    option.current = {
      backgroundColor: "transparent",
      animation: false,
      legend: {
        top: 4, right: 8,
        textStyle: { fontSize: 10 },
        data: ["MA5", "MA20", "累计盈亏", "指数涨跌(%)"],
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", link: [{ xAxisIndex: "all" }] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter(params: any[]) {
          if (!params?.length) return ""
          const idx = params[0].dataIndex as number
          const date = bmDates[idx] ?? ""
          const lines: string[] = [`<b>${date}</b>`]
          for (const p of params) {
            if (p.seriesType === "candlestick") {
              const [o, c, l, h] = p.value as number[]
              const arrow = c >= o ? `<span style="color:#ef4444">▲</span>` : `<span style="color:#22c55e">▼</span>`
              lines.push(`${arrow} 开${o?.toFixed(2)} 收<b>${c?.toFixed(2)}</b> 高${h?.toFixed(2)} 低${l?.toFixed(2)}`)
            } else if (p.value !== null && p.value !== undefined && p.seriesName !== "买开" && p.seriesName !== "卖开" && p.seriesName !== "平仓") {
              const v = typeof p.value === "number" ? p.value : (p.value as number[])[1]
              if (v === null || v === undefined) continue
              const label = p.seriesName === "累计盈亏" ? fmtYuan(v) + "元" : v.toFixed(2) + "%"
              lines.push(`${p.marker}${p.seriesName}: ${label}`)
            }
          }
          return lines.join("<br/>")
        },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        // Panel 0: benchmark candle  (top 8% → 8%+40% = 48%)
        { left: 55, right: 12, top: "8%",  height: "40%" },
        // Panel 1: cumulative P&L    (top 52% → 52%+20% = 72%)
        { left: 55, right: 55, top: "52%", height: "19%" },
        // Panel 2: daily P&L bars   (top 75% → 75%+16% = 91%)
        { left: 55, right: 12, top: "75%", height: "15%" },
      ],
      xAxis: [
        // Grid 0 — benchmark candle
        {
          gridIndex: 0, type: "category", data: bmDates,
          axisLabel: { show: false },
          axisLine: { onZero: false },
          boundaryGap: true,
          splitLine: { show: false },
        },
        // Grid 1 — P&L lines (same dates)
        {
          gridIndex: 1, type: "category", data: bmDates,
          axisLabel: { show: false },
          axisLine: { onZero: false },
          splitLine: { show: false },
        },
        // Grid 2 — daily P&L bars (same dates)
        {
          gridIndex: 2, type: "category", data: bmDates,
          axisLabel: { fontSize: 9, rotate: 30 },
          boundaryGap: true,
          splitLine: { show: false },
        },
      ],
      yAxis: [
        // Grid 0: benchmark price
        { gridIndex: 0, scale: true, splitNumber: 4, axisLabel: { fontSize: 9 }, splitLine: { lineStyle: { opacity: 0.15 } } },
        // Grid 1 left: cum P&L (yuan)
        { gridIndex: 1, name: "元", nameTextStyle: { fontSize: 8 }, scale: true, splitNumber: 3, axisLabel: { fontSize: 8 }, splitLine: { lineStyle: { opacity: 0.15 } } },
        // Grid 1 right: benchmark return (%)
        { gridIndex: 1, name: "%", nameTextStyle: { fontSize: 8 }, position: "right", scale: true, splitNumber: 3, axisLabel: { fontSize: 8 }, splitLine: { show: false } },
        // Grid 2: daily P&L
        { gridIndex: 2, scale: true, splitNumber: 2, axisLabel: { fontSize: 8 }, splitLine: { show: false } },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1, 2], start: 0, end: 100 },
        { type: "slider",  xAxisIndex: [0, 1, 2], bottom: 4, height: 20 },
      ],
      series: [
        // ── Panel 0: benchmark candlestick ─────────────────────────────────
        {
          name: "南华黄金指数",
          type: "candlestick",
          xAxisIndex: 0, yAxisIndex: 0,
          data: ohlc,
          itemStyle: {
            color: "#ef4444", color0: "#22c55e",
            borderColor: "#ef4444", borderColor0: "#22c55e",
          },
        },
        {
          name: "MA5",
          type: "line", xAxisIndex: 0, yAxisIndex: 0,
          data: ma5, smooth: false, symbol: "none", connectNulls: true,
          lineStyle: { width: 1.5, color: "#f59e0b" },
        },
        {
          name: "MA20",
          type: "line", xAxisIndex: 0, yAxisIndex: 0,
          data: ma20, smooth: false, symbol: "none", connectNulls: true,
          lineStyle: { width: 1.5, color: "#8b5cf6" },
        },
        // Trade open markers — 买开 (long entry): red upward triangle
        {
          name: "买开",
          type: "scatter", xAxisIndex: 0, yAxisIndex: 0,
          data: openLong,
          symbol: "triangle", symbolSize: 10,
          itemStyle: { color: "#ef4444" },
          tooltip: { show: false },
        },
        // Trade open markers — 卖开 (short entry): green downward triangle
        {
          name: "卖开",
          type: "scatter", xAxisIndex: 0, yAxisIndex: 0,
          data: openShort,
          symbol: "triangle", symbolRotate: 180, symbolSize: 10,
          itemStyle: { color: "#22c55e" },
          tooltip: { show: false },
        },
        // Close markers — 平仓 (both long/short exit): grey diamond
        {
          name: "平仓",
          type: "scatter", xAxisIndex: 0, yAxisIndex: 0,
          data: closePos,
          symbol: "diamond", symbolSize: 8,
          itemStyle: { color: "#94a3b8", borderColor: "#64748b", borderWidth: 1 },
          tooltip: { show: false },
        },

        // ── Panel 1: cumulative P&L (left y) + benchmark return (right y) ──
        {
          name: "累计盈亏",
          type: "line", xAxisIndex: 1, yAxisIndex: 1,
          data: alignedCumPnl, smooth: false, symbol: "none", connectNulls: true,
          lineStyle: { width: 2, color: "#3b82f6" },
          areaStyle: { opacity: 0.08, color: "#3b82f6" },
        },
        {
          name: "指数涨跌(%)",
          type: "line", xAxisIndex: 1, yAxisIndex: 2,
          data: bmReturn, smooth: false, symbol: "none",
          lineStyle: { width: 1.5, color: "#f59e0b", type: "dashed" },
        },

        // ── Panel 2: daily P&L bars ─────────────────────────────────────────
        {
          name: "当日盈亏",
          type: "bar", xAxisIndex: 2, yAxisIndex: 3,
          data: alignedDailyPnl.map(v =>
            v === null ? null : {
              value: v,
              itemStyle: { color: v >= 0 ? "#ef4444" : "#22c55e" },
            }
          ),
          barMaxWidth: 6,
        },
      ],
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">
            南华黄金指数 · AU交易回顾（{account.toUpperCase()}）
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_RANGES.map(r => (
              <button
                key={r.label}
                onClick={() => { const f = r.from(); const t = r.to(); setFrom(f); setTo(t); load(f, t) }}
                className="rounded px-2 py-0.5 text-xs bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
              >
                {r.label}
              </button>
            ))}
            <input
              type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="rounded border border-input bg-background px-2 py-0.5 text-xs"
            />
            <input
              type="date" value={to} onChange={e => setTo(e.target.value)}
              className="rounded border border-input bg-background px-2 py-0.5 text-xs"
            />
            <button
              onClick={() => load(from, to)}
              className="rounded border border-input bg-background p-0.5 hover:bg-muted transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 relative p-0 pb-1 min-h-0">
        {loading && !data && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="text-sm text-destructive text-center">{error}</p>
          </div>
        )}
        {!loading && !error && data?.benchmark.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="text-sm text-muted-foreground">
              暂无 NHAU.NH 基准数据。<br />
              请先运行 ETL：<code>--step nanhua_commodity_indices</code>
            </p>
          </div>
        )}
        {data && data.benchmark.length > 0 && (
          <ReactECharts
            option={option.current}
            style={{ height: chartHeight }}
            opts={{ renderer: "canvas" }}
            notMerge
          />
        )}
      </CardContent>
    </Card>
  )
}
