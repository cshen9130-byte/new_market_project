"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Freq } from "./current-market-prediction-chart"
import { FREQ_LABELS } from "./current-market-prediction-chart"

type Point = {
  date: string
  cluster: number | null
  pc1: number | null
  pc2: number | null
}

type ApiResponse = {
  data: Point[]
  latest: Point | null
  start_date: string | null
  end_date: string | null
  min_date: string | null
  max_date: string | null
  error?: string
}

const CLUSTER_COLORS = ["#1f77b4", "#ff7f0e", "#d62728", "#2ca02c"]
const CLUSTER_LABELS = ["簇 0", "簇 1", "簇 2", "簇 3"]

type Props = {
  freq: Freq
  onFreqChange: (f: Freq) => void
}

export default function PredictionTimeseriesChart({ freq, onFreqChange }: Props) {
  const [rows, setRows] = useState<Point[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minDate, setMinDate] = useState<string>("")
  const [maxDate, setMaxDate] = useState<string>("")
  const [startDate, setStartDate] = useState<string>("")
  const [endDate, setEndDate] = useState<string>("")

  async function load(range?: { start: string; end: string }) {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ freq })
      if (range?.start && range?.end) {
        params.set("start", range.start)
        params.set("end", range.end)
      }

      const res = await fetch(`/ma/api/macro/current-market-prediction?${params.toString()}`, {
        cache: "no-store",
      })
      const json: ApiResponse = await res.json()
      if (!res.ok || !json.data) throw new Error(json.error || "failed")

      setRows(json.data)
      setMinDate(json.min_date ?? "")
      setMaxDate(json.max_date ?? "")
      setStartDate(range?.start ?? json.start_date ?? "")
      setEndDate(range?.end ?? json.end_date ?? "")
    } catch (e: any) {
      setError(e?.message || "数据不可用")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [freq])

  const latest = useMemo(() => rows[rows.length - 1] ?? null, [rows])

  const clusterStats = useMemo(() => {
    if (!rows.length) return null
    const counts: Record<number, number> = {}
    let total = 0
    for (const r of rows) {
      if (r.cluster != null) {
        const c = Math.min(3, Math.max(0, r.cluster))
        counts[c] = (counts[c] ?? 0) + 1
        total++
      }
    }
    if (total === 0) return null
    return [0, 1, 2, 3]
      .map((c) => ({
        cluster: c,
        label: CLUSTER_LABELS[c],
        color: CLUSTER_COLORS[c],
        count: counts[c] ?? 0,
        pct: ((counts[c] ?? 0) / total) * 100,
      }))
      .filter((x) => x.count > 0)
  }, [rows])

  const clusterOption = useMemo(() => {
    if (!rows.length) return {}

    const lineData = rows.map((r) => [r.date, r.cluster])
    const scatterByCluster: [string, number, string, number | null, number | null][][] = [[], [], [], []]

    for (const row of rows) {
      if (row.cluster !== null) {
        const cluster = Math.min(3, Math.max(0, row.cluster))
        scatterByCluster[cluster].push([row.date, row.cluster, row.date, row.pc1, row.pc2])
      }
    }

    const scatterSeries = CLUSTER_LABELS.map((label, index) => ({
      name: label,
      type: "scatter" as const,
      data: scatterByCluster[index],
      symbolSize: 8,
      itemStyle: { color: CLUSTER_COLORS[index] },
      tooltip: {
        formatter: (p: any) => {
          const pc1 = p.data[3] == null ? "—" : (+p.data[3]).toFixed(4)
          const pc2 = p.data[4] == null ? "—" : (+p.data[4]).toFixed(4)
          return `日期: ${p.data[2]}<br/>簇: ${label}<br/>PC1: ${pc1}<br/>PC2: ${pc2}`
        },
      },
      z: 3,
    }))

    const latestSeries =
      latest?.cluster != null
        ? [{
            name: "最新交易日",
            type: "scatter" as const,
            data: [[latest.date, latest.cluster, latest.date]],
            symbolSize: 24,
            symbol: "circle",
            itemStyle: {
              color: "transparent",
              borderColor: "#e00",
              borderWidth: 3,
            },
            z: 5,
            tooltip: {
              formatter: () => `最新: ${latest.date}<br/>簇: ${latest.cluster}`,
            },
          }]
        : []

    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "axis" },
      legend: {
        data: [...CLUSTER_LABELS, "最新交易日"],
        bottom: 0,
        textStyle: { fontSize: 11 },
      },
      grid: { left: "9%", right: "4%", top: "8%", bottom: "15%" },
      xAxis: {
        type: "category" as const,
        data: rows.map((r) => r.date),
        axisLabel: {
          formatter: (value: string) => value.slice(0, 7),
          rotate: 30,
          fontSize: 10,
        },
      },
      yAxis: {
        type: "value" as const,
        min: -0.2,
        max: 3.2,
        interval: 1,
        name: "市场簇",
        nameLocation: "middle" as const,
        nameGap: 42,
        axisLabel: {
          formatter: (value: number) => CLUSTER_LABELS[value] ?? String(value),
        },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      series: [
        {
          name: "簇走势",
          type: "line" as const,
          step: "end" as const,
          data: lineData,
          symbol: "none",
          lineStyle: { color: "#64748b", width: 2, opacity: 0.7 },
          tooltip: { show: false },
          z: 1,
        },
        ...scatterSeries,
        ...latestSeries,
      ],
    }
  }, [latest, rows])

  const pcOption = useMemo(() => {
    const buildOption = (field: "pc1" | "pc2", title: string, axisName: string, color: string) => {
      if (!rows.length) return {}

      return {
        backgroundColor: "transparent",
        title: {
          text: title,
          left: "center",
          top: 2,
          textStyle: {
            fontSize: 12,
            fontWeight: 600,
            color: "#334155",
          },
        },
        tooltip: {
          trigger: "axis",
          formatter: (items: any[]) => {
            const item = items?.[0]
            if (!item) return ""
            const value = item.data?.[1]
            return `日期: ${item.axisValue}<br/>${title}: ${value == null ? "—" : (+value).toFixed(4)}`
          },
        },
        grid: { left: "12%", right: "6%", top: "18%", bottom: "18%" },
        xAxis: {
          type: "category" as const,
          data: rows.map((r) => r.date),
          axisLabel: {
            formatter: (value: string) => value.slice(0, 7),
            rotate: 30,
            fontSize: 10,
          },
        },
        yAxis: {
          type: "value" as const,
          name: axisName,
          nameLocation: "middle" as const,
          nameGap: 38,
          splitLine: { lineStyle: { opacity: 0.2 } },
        },
        series: [
          {
            name: title,
            type: "line" as const,
            data: rows.map((r) => [r.date, r[field]]),
            symbol: "none",
            connectNulls: false,
            lineStyle: { color, width: 2 },
            areaStyle: { color, opacity: 0.08 },
            markPoint: latest?.[field] != null
              ? {
                  symbol: "circle",
                  symbolSize: 18,
                  itemStyle: {
                    color: "transparent",
                    borderColor: color,
                    borderWidth: 2,
                  },
                  data: [{ coord: [latest.date, latest[field]] }],
                }
              : undefined,
          },
        ],
      }
    }

    return {
      pc1: buildOption("pc1", "PC1 时序图", "PC1（经济增长因子）", "#2563eb"),
      pc2: buildOption("pc2", "PC2 时序图", "PC2（避险/利率因子）", "#dc2626"),
    }
  }, [latest, rows])

  function onApplyRange() {
    if (!startDate || !endDate) {
      setError("请输入开始和结束日期")
      return
    }
    if (startDate > endDate) {
      setError("开始日期不能晚于结束日期")
      return
    }
    void load({ start: startDate, end: endDate })
  }

  function onResetLastYear() {
    void load()
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>市场预测时序图</CardTitle>
                <CardDescription>
                  默认显示近一年，可按任意开始/结束日期查询全量预测区间
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

            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
              <Input type="date" value={startDate} min={minDate || undefined} max={maxDate || undefined} onChange={(e) => setStartDate(e.target.value)} />
              <Input type="date" value={endDate} min={minDate || undefined} max={maxDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
              <button
                onClick={onApplyRange}
                className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
              >
                查询区间
              </button>
              <button
                onClick={onResetLastYear}
                className="h-9 rounded-md border border-input px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                近一年
              </button>
            </div>

            {minDate && maxDate ? (
              <div className="text-xs text-muted-foreground">
                全量数据范围：{minDate} 至 {maxDate}
              </div>
            ) : null}

            {clusterStats && clusterStats.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {clusterStats.map((s) => (
                  <span
                    key={s.cluster}
                    className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ backgroundColor: s.color }}
                  >
                    {s.label}:&nbsp;{s.pct.toFixed(1)}%
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">加载中...</div>
          ) : error ? (
            <div className="flex h-[360px] items-center justify-center text-sm text-destructive">{error}</div>
          ) : !rows.length ? (
            <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">该区间暂无预测数据</div>
          ) : (
            <ReactECharts option={clusterOption} style={{ height: "360px", width: "100%" }} />
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>PC1 预测时序图</CardTitle>
            <CardDescription>
              与左侧相同时间区间和频率
              {latest?.pc1 != null ? ` · 最新 ${latest.date} = ${latest.pc1.toFixed(4)}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-[170px] items-center justify-center text-sm text-muted-foreground">加载中...</div>
            ) : error ? (
              <div className="flex h-[170px] items-center justify-center text-sm text-destructive">{error}</div>
            ) : !rows.length ? (
              <div className="flex h-[170px] items-center justify-center text-sm text-muted-foreground">该区间暂无 PC1 数据</div>
            ) : (
              <ReactECharts option={pcOption.pc1} style={{ height: "170px", width: "100%" }} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>PC2 预测时序图</CardTitle>
            <CardDescription>
              与左侧相同时间区间和频率
              {latest?.pc2 != null ? ` · 最新 ${latest.date} = ${latest.pc2.toFixed(4)}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-[170px] items-center justify-center text-sm text-muted-foreground">加载中...</div>
            ) : error ? (
              <div className="flex h-[170px] items-center justify-center text-sm text-destructive">{error}</div>
            ) : !rows.length ? (
              <div className="flex h-[170px] items-center justify-center text-sm text-muted-foreground">该区间暂无 PC2 数据</div>
            ) : (
              <ReactECharts option={pcOption.pc2} style={{ height: "170px", width: "100%" }} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}