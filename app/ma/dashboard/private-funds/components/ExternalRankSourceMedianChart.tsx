"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Loader2 } from "lucide-react"
import type { ExternalRankWeekCompare } from "@/lib/ma/external-rank-week"

const UP = "#C00000"
const DOWN = "#006600"
const FLAT = "#a1a1aa"

function pctLabel(value: number): string {
  const pct = value * 100
  const text = `${pct >= 0 ? "" : ""}${pct.toFixed(2)}%`
  return pct > 0 ? `+${pct.toFixed(2)}%` : text
}

function barColor(value: number): string {
  if (value > 0) return UP
  if (value < 0) return DOWN
  return FLAT
}

export function ExternalRankSourceMedianChart({
  data,
  loading,
  error,
}: {
  data: ExternalRankWeekCompare | null
  loading: boolean
  error: string
}) {
  const option = useMemo(() => {
    if (!data || data.strategies.length === 0) return null
    const categories = data.strategies.map((row) => row.strategy)
    return {
      backgroundColor: "transparent",
      animationDuration: 300,
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        formatter: (params: Array<{ seriesName: string; value: number | null; data?: { n?: number; raw?: number }; axisValue: string; marker: string }>) => {
          if (!params?.length) return ""
          const lines = params
            .filter((item) => item.value != null && Number.isFinite(item.value))
            .map((item) => {
              const n = item.data?.n
              const raw = typeof item.data?.raw === "number" ? item.data.raw : (item.value as number) / 100
              const count = typeof n === "number" ? `　${n} 条` : ""
              return `${item.marker}${item.seriesName}　中位数 ${pctLabel(raw)}${count}`
            })
          if (!lines.length) return `${params[0].axisValue}<br/>本周各来源都没有近一周收益`
          return [`<div style="font-weight:600;margin-bottom:4px">${params[0].axisValue}</div>`, ...lines].join("<br/>")
        },
      },
      legend: { show: false },
      grid: { left: 52, right: 16, top: 16, bottom: 72 },
      xAxis: {
        type: "category" as const,
        data: categories,
        axisLabel: {
          fontSize: 11,
          color: "#71717a",
          rotate: 35,
          interval: 0,
          hideOverlap: false,
        },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "中位数",
        nameTextStyle: { fontSize: 11, color: "#71717a", padding: [0, 0, 0, 8] },
        axisLabel: {
          fontSize: 11,
          color: "#a1a1aa",
          formatter: (value: number) => `${value}%`,
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" as const } },
      },
      series: data.sources.map((source, index) => ({
        name: source.label,
        type: "bar" as const,
        barMaxWidth: 18,
        barGap: "25%",
        barCategoryGap: "32%",
        data: data.strategies.map((row) => {
          const hit = row.values.find((value) => value.source === source.key)
          if (!hit) return null
          return {
            value: Math.round(hit.median * 10000) / 100,
            raw: hit.median,
            n: hit.n,
            itemStyle: { color: barColor(hit.median) },
          }
        }),
        ...(index === 0
          ? {
              markLine: {
                silent: true,
                symbol: "none" as const,
                lineStyle: { color: "#d4d4d8", width: 1 },
                label: { show: false },
                data: [{ yAxis: 0 }],
              },
            }
          : {}),
      })),
    }
  }, [data])

  return (
    <div className="rounded-xl border bg-background shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b">
        <div className="text-sm font-medium">各来源近一周收益率中位数</div>
        <p className="mt-1 text-xs text-muted-foreground">
          同一报告周、同一策略下，各数据源产品近一周收益率的中位数。某来源没有该策略则留空，不按 0 计。柱形按涨跌着色：红涨绿跌。
        </p>
        {data && data.sources.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-300">
            {data.sources.map((source, index) => (
              <span key={source.key} className="inline-flex items-center gap-1.5">
                <span className="inline-flex h-2.5 w-4 items-end justify-center gap-0.5" aria-hidden>
                  {data.sources.map((item, inner) => (
                    <span
                      key={item.key}
                      className={`inline-block w-1 rounded-sm ${inner === index ? "bg-zinc-800 dark:bg-zinc-200" : "bg-zinc-300 dark:bg-zinc-600"}`}
                      style={{ height: inner === index ? 10 : 6 }}
                    />
                  ))}
                </span>
                {index === 0 ? "左柱" : index === data.sources.length - 1 ? "右柱" : `第${index + 1}柱`} {source.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在汇总各来源中位数…
        </div>
      ) : error && !data ? (
        <div className="py-12 px-5 text-center text-sm text-red-600">{error}</div>
      ) : !option ? (
        <div className="py-12 px-5 text-center text-sm text-muted-foreground">这一周还没有可比较的近一周收益。</div>
      ) : (
        <div className="relative px-2 pb-2 pt-1">
          {loading && (
            <div className="absolute right-4 top-2 z-10 text-xs text-muted-foreground">更新中…</div>
          )}
          <ReactECharts option={option} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
        </div>
      )}
    </div>
  )
}
