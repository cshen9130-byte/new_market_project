"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// ── types ─────────────────────────────────────────────────────────────────────
type AssetMeta = { key: string; label: string }
type DataPoint = { date: string; value: number }
type ApiResponse = {
  assets: AssetMeta[]
  series: Record<string, DataPoint[]>
}

// ── colors: each asset gets a distinct color ──────────────────────────────────
const ASSET_COLORS: Record<string, string> = {
  "510300.SH":  "#1f77b4",   // 沪深300ETF — blue
  "510500.SH":  "#d62728",   // 中证500ETF — red
  "511010.SH":  "#2ca02c",   // 国债ETF    — green
  "511220.SH":  "#9467bd",   // 公司债ETF  — purple
  "511880.SH":  "#8c564b",   // 货币基金   — brown
  "518880.SH":  "#f5c518",   // 黄金ETF    — yellow
  "NHCI":       "#ff7f0e",   // 南华商品   — orange
}

// ── day-range selector ────────────────────────────────────────────────────────
const RANGE_OPTIONS = [
  { label: "近1月", days: 30 },
  { label: "近3月", days: 90 },
  { label: "近6月", days: 180 },
  { label: "近1年", days: 365 },
] as const
type Range = typeof RANGE_OPTIONS[number]["days"]

// ── component ─────────────────────────────────────────────────────────────────
export default function AssetReturnsChart() {
  const [range, setRange] = useState<Range>(365)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/ma/api/macro/asset-returns?days=${range}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ApiResponse) => {
        if (!cancelled) { setData(d); setLoading(false) }
      })
      .catch((e) => {
        if (!cancelled) { setError(e?.message || "数据不可用"); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [range])

  const option = useMemo(() => {
    if (!data?.assets?.length) return {}

    const allDates = Array.from(
      new Set(
        data.assets.flatMap((a) => (data.series[a.key] ?? []).map((p) => p.date))
      )
    ).sort()

    const lineSeries = data.assets.map((a) => {
      const pointMap: Record<string, number> = {}
      for (const p of data.series[a.key] ?? []) pointMap[p.date] = p.value

      return {
        name: a.label,
        type: "line" as const,
        data: allDates.map((d) => pointMap[d] ?? null),
        symbol: "none",
        lineStyle: { width: 2, color: ASSET_COLORS[a.key] },
        itemStyle: { color: ASSET_COLORS[a.key] },
        connectNulls: false,
        emphasis: { lineStyle: { width: 3 } },
        tooltip: {
          valueFormatter: (v: any) => v == null ? "—" : `${(+v).toFixed(2)}%`,
        },
      }
    })

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" as const },
      },
      legend: {
        data: data.assets.map((a) => a.label),
        bottom: 0,
        type: "scroll" as const,
        textStyle: { fontSize: 11 },
      },
      grid: { left: "8%", right: "4%", top: "6%", bottom: "15%" },
      xAxis: {
        type: "category" as const,
        data: allDates,
        axisLabel: {
          formatter: (v: string) => v.slice(0, 7),
          rotate: 30,
          fontSize: 10,
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "累计对数收益率 (%)",
        nameLocation: "middle" as const,
        nameGap: 50,
        axisLabel: {
          formatter: (v: number) => `${v.toFixed(1)}%`,
          fontSize: 10,
        },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      series: lineSeries,
    }
  }, [data])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>各资产累计收益</CardTitle>
            <CardDescription>
              累计对数收益率（基期=0，按选定时间段起始日重置）
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-1 mt-0.5">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                onClick={() => setRange(opt.days)}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  range === opt.days
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : error ? (
          <div className="flex h-64 items-center justify-center text-sm text-destructive">
            {error}
          </div>
        ) : !data?.assets?.length ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            暂无数据
          </div>
        ) : (
          <ReactECharts option={option} style={{ height: 380 }} />
        )}
      </CardContent>
    </Card>
  )
}
