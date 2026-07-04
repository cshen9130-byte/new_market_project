"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useChartAutoRefresh } from "@/hooks/use-chart-auto-refresh"
import type { Freq } from "./current-market-prediction-chart"

// ── types ─────────────────────────────────────────────────────────────────────
type AssetMeta = { key: string; label: string }
type DataPoint = { date: string; value: number }
type LatestReturn = { key: string; label: string; date: string | null; value: number | null }
type PeriodReturn = { key: string; label: string; date: string | null; value: number | null }
type ApiResponse = {
  assets: AssetMeta[]
  series: Record<string, DataPoint[]>
  latest_returns: LatestReturn[]
  period_returns: PeriodReturn[]
  period_label: string
  favored_asset_keys: string[]
  favored_asset_stars?: Record<string, 1 | 2 | 3>
}

type ViewMode = "cumulative" | "period"

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
  { label: "当日", days: 1 },
  { label: "近1月", days: 30 },
  { label: "近3月", days: 90 },
  { label: "近6月", days: 180 },
  { label: "近1年", days: 365 },
] as const
type Range = typeof RANGE_OPTIONS[number]["days"]

// ── component ─────────────────────────────────────────────────────────────────
type Props = {
  freq: Freq
}

export default function AssetReturnsChart({ freq }: Props) {
  const [range, setRange] = useState<Range>(365)
  const [viewMode, setViewMode] = useState<ViewMode>("cumulative")
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/ma/api/macro/asset-returns?days=${range}&freq=${freq}&ts=${Date.now()}`,
        { cache: "no-store" },
      )
      const d: ApiResponse = await res.json()
      setData(d)
    } catch (e: any) {
      setError(e?.message || "数据不可用")
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [freq, range])

  useChartAutoRefresh(load, [freq, range])

  const cumulativeOption = useMemo(() => {
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

  const periodOption = useMemo(() => {
    if (!data?.period_returns?.length) return {}

    const rows = [...data.period_returns]
      .filter((item) => item.value != null)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))

    if (!rows.length) return {}

    const periodTitle = range <= 1 ? "当日收益率" : `${data.period_label}收益率`

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: (p: any) => `${p.name}<br/>${periodTitle}: ${(+p.value).toFixed(2)}%`,
      },
      grid: { left: "10%", right: "4%", top: "12%", bottom: "22%" },
      xAxis: {
        type: "category" as const,
        data: rows.map((item) => item.label),
        axisLabel: {
          interval: 0,
          rotate: 22,
          fontSize: 10,
        },
      },
      yAxis: {
        type: "value" as const,
        name: "收益率 (%)",
        nameLocation: "middle" as const,
        nameGap: 42,
        axisLabel: {
          formatter: (v: number) => `${v.toFixed(1)}%`,
          fontSize: 10,
        },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      series: [
        {
          type: "bar" as const,
          data: rows.map((item) => {
            const stars = data.favored_asset_stars?.[item.key] ?? 0
            const isFavored = stars > 0
            const starStr = isFavored ? "★".repeat(stars) : ""
            return {
              value: item.value,
              name: item.label,
              itemStyle: {
                color: isFavored
                  ? "#f59e0b"
                  : (item.value ?? 0) >= 0
                    ? "#dc2626"
                    : "#2563eb",
                borderColor: isFavored ? "#92400e" : "transparent",
                borderWidth: isFavored ? 2 : 0,
              },
              label: {
                show: true,
                position: (item.value ?? 0) >= 0 ? "top" : "bottom",
                formatter: ({ value }: { value: number }) =>
                  isFavored ? `${value.toFixed(2)}%${starStr}` : `${value.toFixed(2)}%`,
                color: isFavored ? "#b45309" : "#334155",
                fontSize: 11,
                fontWeight: isFavored ? "bold" : "normal",
              },
            }
          }),
          barWidth: 28,
        },
      ],
    }
  }, [data, range])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>各资产累计收益</CardTitle>
            <CardDescription>
              {viewMode === "cumulative"
                ? "累计对数收益率（基期=0，按选定时间段起始日重置）"
                : `${data?.period_label ?? "当期"}各资产收益率${ (data?.favored_asset_keys?.length ?? 0) > 0 ? " · ★为预测偏强资产" : ""}`}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col gap-2 mt-0.5">
            <div className="flex justify-end gap-1">
              <button
                onClick={() => setViewMode("cumulative")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  viewMode === "cumulative"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                累计收益
              </button>
              <button
                onClick={() => setViewMode("period")}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  viewMode === "period"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                当期收益
              </button>
            </div>
            <div className="flex justify-end gap-1">
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
          <ReactECharts
            key={`${viewMode}-${range}-${freq}-${data?.period_label ?? ""}`}
            option={viewMode === "cumulative" ? cumulativeOption : periodOption}
            style={{ height: 380 }}
            notMerge
            lazyUpdate={false}
          />
        )}
      </CardContent>
    </Card>
  )
}
