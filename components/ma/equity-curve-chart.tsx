"use client"

import { useCallback, useEffect, useState } from "react"
import ReactECharts from "echarts-for-react"
import { RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface EquityPoint { date: string; cumPnl: number }
interface EquitySeries { account: string; data: EquityPoint[] }

function isoToday() { return new Date().toISOString().slice(0, 10) }
function isoMonthOffset(m: number) {
  const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10)
}

const QUICK_RANGES = [
  { label: "今日",     from: () => isoToday(),          to: () => isoToday()          },
  { label: "近一周",   from: () => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10) }, to: () => isoToday() },
  { label: "近一月",   from: () => isoMonthOffset(-1),  to: () => isoToday()          },
  { label: "近一季度", from: () => isoMonthOffset(-3),  to: () => isoToday()          },
  { label: "近一年",   from: () => isoMonthOffset(-12), to: () => isoToday()          },
  { label: "全部",     from: () => "2020-01-01",         to: () => isoToday()          },
]

const LINE_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7",
  "#06b6d4", "#f97316", "#ec4899", "#14b8a6", "#8b5cf6",
  "#84cc16", "#0ea5e9", "#d946ef", "#fb923c", "#6366f1",
]
const LINE_COLOR = "#3b82f6"

function fmtNum(v: number): string {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
}

interface Props {
  height?: number
  defaultFrom?: string
  defaultTo?: string
}

export default function EquityCurveChart({ height = 480, defaultFrom, defaultTo }: Props) {
  const [from, setFrom] = useState(defaultFrom ?? "2020-01-01")
  const [to, setTo]     = useState(defaultTo ?? isoToday())

  const [allSeries, setAllSeries] = useState<EquitySeries[]>([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const [selectedAccount, setSelectedAccount] = useState("rx000")

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (f) params.set("from", f)
      if (t) params.set("to", t)
      const res = await fetch(`/ma/api/mom-analysis/equity-curve?${params}`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || "请求失败")
      setAllSeries(json.series ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(from, to) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const showAll = selectedAccount === "全部"
  const visibleSeries = showAll ? allSeries : allSeries.filter(s => s.account === selectedAccount)

  const option = visibleSeries.length > 0 ? {
    animation: false,
    grid: { top: 16, right: 24, bottom: showAll ? 56 : 56, left: 80 },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ axisValue: string; seriesName: string; value: [string, number]; color: string }>) => {
        if (!params.length) return ""
        const date = params[0].axisValue
        const lines = [...params]
          .sort((a, b) => (b.value?.[1] ?? 0) - (a.value?.[1] ?? 0))
          .map(p => {
            const val = p.value?.[1] ?? 0
            const sign = val >= 0 ? "+" : ""
            return `<span style="display:inline-block;margin-right:5px;border-radius:2px;width:10px;height:10px;background:${p.color}"></span>${p.seriesName.toUpperCase()}: <b>${sign}${fmtNum(val)}</b>`
          })
        return `${date}<br/>${lines.join("<br/>")}`
      },
    },
    xAxis: { type: "time", axisLabel: { fontSize: 11 }, splitLine: { show: false } },
    yAxis: {
      type: "value",
      axisLabel: { fontSize: 11, formatter: (v: number) => Math.abs(v) >= 10000 ? (v / 10000).toFixed(0) + "万" : v.toString() },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.4 } },
    },
    ...(showAll ? {} : {}),
    legend: showAll ? { type: "scroll" as const, bottom: 4, textStyle: { fontSize: 10 } } : undefined,
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      { type: "slider", bottom: showAll ? 28 : 28, height: 18, start: 0, end: 100 },
    ],
    series: visibleSeries.map((s, i) => ({
      name: s.account,
      type: "line",
      smooth: false,
      symbol: "none",
      lineStyle: { width: showAll ? 1.5 : 2, color: showAll ? LINE_COLORS[i % LINE_COLORS.length] : LINE_COLOR },
      itemStyle: { color: showAll ? LINE_COLORS[i % LINE_COLORS.length] : LINE_COLOR },
      ...(showAll ? {} : { areaStyle: { color: LINE_COLOR, opacity: 0.08 } }),
      data: s.data.map(d => [d.date, d.cumPnl]),
    })),
  } : null

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex flex-col gap-1.5">
          {/* Row 1: title + account selector + quick ranges + dates + refresh */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium">
              盘手收益曲线（{showAll ? "全部" : selectedAccount.toUpperCase()}）
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Account selector */}
              <select
                value={selectedAccount}
                onChange={e => setSelectedAccount(e.target.value)}
                className="rounded border border-input bg-background px-2 py-0.5 text-xs w-24"
              >
                <option value="全部">全部</option>
                {allSeries.map(s => (
                  <option key={s.account} value={s.account}>{s.account.toUpperCase()}</option>
                ))}
              </select>
              {/* Quick ranges */}
              {QUICK_RANGES.map(r => {
                const isActive = from === r.from() && to === r.to()
                return (
                  <button
                    key={r.label}
                    onClick={() => { const f = r.from(); const t = r.to(); setFrom(f); setTo(t); load(f, t) }}
                    className={`rounded px-2 py-0.5 text-xs transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                )
              })}
              {/* Date inputs */}
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="rounded border border-input bg-background px-2 py-0.5 text-xs" />
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="rounded border border-input bg-background px-2 py-0.5 text-xs" />
              {/* Refresh */}
              <button onClick={() => load(from, to)}
                className="rounded border border-input bg-background p-0.5 hover:bg-muted transition-colors">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex-1">
        {loading && (
          <div className="flex items-center justify-center text-muted-foreground" style={{ height }}>
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
        )}
        {!loading && error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {!loading && !error && !option && (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            所选日期范围内无数据。
          </div>
        )}
        {!loading && !error && option && (
          <ReactECharts option={option} style={{ height }} notMerge />
        )}
      </CardContent>
    </Card>
  )
}
