"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useChartAutoRefresh } from "@/hooks/use-chart-auto-refresh"

type Point = {
  date: string
  cluster: number | null
  pc1: number | null
  pc2: number | null
}

export type Freq = "daily" | "weekly" | "monthly"

export const FREQ_LABELS: Record<Freq, string> = { daily: "当日", weekly: "当周", monthly: "当月" }
const FREQ_DESC: Record<Freq, string> = {
  daily:   "近一年，每日数据",
  weekly:  "近一年，每周数据",
  monthly: "近一年，每月数据",
}

// Colours mirror plot_current_prediction.py
const CLUSTER_COLORS = ["#1f77b4", "#ff7f0e", "#d62728", "#2ca02c"]
const CLUSTER_LABELS = ["簇 0", "簇 1", "簇 2", "簇 3"]

type Props = {
  freq: Freq
  onFreqChange: (f: Freq) => void
}

export default function CurrentMarketPredictionChart({ freq, onFreqChange }: Props) {
  const [rows, setRows] = useState<Point[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/ma/api/macro/current-market-prediction?freq=${freq}&ts=${Date.now()}`, {
        cache: "no-store",
      })
      const json = await res.json()
      if (!res.ok || !json.data) throw new Error(json.error || "failed")
      setRows(json.data)
    } catch (e: any) {
      setError(e?.message || "数据不可用")
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [freq])

  useChartAutoRefresh(load, [freq])

  const latest = useMemo(() => rows[rows.length - 1], [rows])

  const option = useMemo(() => {
    if (!rows.length) return {}

    // Split historical points by cluster for separate coloured series
    const byCluster: [number, number, string][][] = [[], [], [], []]
    for (const r of rows) {
      if (r.cluster !== null && r.pc1 !== null && r.pc2 !== null) {
        const c = Math.min(3, Math.max(0, r.cluster))
        byCluster[c].push([r.pc1, r.pc2, r.date])
      }
    }

    const historySeries = CLUSTER_LABELS.map((name, c) => ({
      name,
      type: "scatter" as const,
      data: byCluster[c],
      symbolSize: 6,
      itemStyle: { color: CLUSTER_COLORS[c], opacity: 0.55 },
      tooltip: {
        formatter: (p: any) =>
          `日期: ${p.data[2]}<br/>PC1: ${(+p.data[0]).toFixed(4)}<br/>PC2: ${(+p.data[1]).toFixed(4)}<br/>簇: ${p.seriesName}`,
      },
    }))

    const latestSeries =
      latest?.pc1 != null && latest?.pc2 != null
        ? [{
            name: "最新交易日",
            type: "scatter" as const,
            data: [[latest.pc1, latest.pc2, latest.date]],
            symbolSize: 28,
            symbol: "circle",
            itemStyle: {
              color: "transparent",
              borderColor: "#e00",
              borderWidth: 3,
            },
            label: {
              show: true,
              formatter: `${latest.date}  簇 ${latest.cluster}`,
              position: "top" as const,
              fontSize: 11,
              color: "#e00",
              fontWeight: "bold" as const,
            },
            z: 10,
            tooltip: {
              formatter: () =>
                `最新: ${latest.date}<br/>PC1: ${latest.pc1?.toFixed(4)}<br/>PC2: ${latest.pc2?.toFixed(4)}<br/>簇: ${latest.cluster}`,
            },
          }]
        : []

    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "item" },
      legend: {
        data: [...CLUSTER_LABELS, "最新交易日"],
        bottom: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { left: "10%", right: "6%", top: "8%", bottom: "15%" },
      xAxis: {
        type: "value",
        name: "PC1（经济增长因子）",
        nameLocation: "middle",
        nameGap: 28,
        splitLine: { lineStyle: { opacity: 0.25 } },
      },
      yAxis: {
        type: "value",
        name: "PC2（避险/利率因子）",
        nameLocation: "middle",
        nameGap: 46,
        splitLine: { lineStyle: { opacity: 0.25 } },
      },
      series: [...historySeries, ...latestSeries],
    }
  }, [rows, latest])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>当前市场状态预测</CardTitle>
            <CardDescription>
              PCA 空间中的市场聚类分布（{FREQ_DESC[freq]}）
              {latest ? ` · 最新 ${latest.date}，所属簇 ${latest.cluster ?? "—"}` : ""}
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-1 mt-0.5">
            {(Object.keys(FREQ_LABELS) as Freq[]).map((f) => (
              <button
                key={f}
                onClick={() => onFreqChange(f)}
                className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium transition-colors",
                  freq === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {FREQ_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground">加载中...</div>
        ) : error ? (
          <div className="h-[420px] flex items-center justify-center text-sm text-destructive">{error}</div>
        ) : !rows.length ? (
          <div className="h-[420px] flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <span>暂无{FREQ_LABELS[freq]}预测数据，请稍候再试</span>
          </div>
        ) : (
          <ReactECharts option={option} style={{ height: "420px", width: "100%" }} />
        )}
      </CardContent>
    </Card>
  )
}
