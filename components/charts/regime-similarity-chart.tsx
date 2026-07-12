"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useChartAutoRefresh } from "@/hooks/use-chart-auto-refresh"

// ── Types ─────────────────────────────────────────────────────────────────────
type ZScores = {
  pmi_chg: number | null
  yield_chg: number | null
  spread_chg: number | null
  nhci_yoy: number | null
  afre: number | null
  m1: number | null
  cpi: number | null
}

type Top20Item = {
  date: string        // "YYYY-MM"
  rank: number
  distance: number | null
  pmi_chg_z: number | null
  yield_chg_z: number | null
  spread_chg_z: number | null
  nhci_yoy_z: number | null
  afre_z: number | null
  m1_z: number | null
  cpi_z: number | null
}

type DistItem = {
  date: string        // "YYYY-MM"
  distance: number | null
  in_top20: boolean
}

type ApiResponse = {
  run_date: string | null
  current_month: string | null
  current_zscores: ZScores | null
  top20: Top20Item[]
  all_distances: DistItem[]
  data_note?: string | null
  blocking_indicators?: string[]
}

// ── ERA colour coding (mirrors Python plot) ───────────────────────────────────
const ERA_COLORS: Record<string, string> = Object.fromEntries([
  ...["2006","2007","2008","2009"].map((y) => [y, "#4e79a7"]),
  ...["2010","2011","2012","2013","2014","2015","2016","2017"].map((y) => [y, "#f28e2b"]),
  ...["2018","2019"].map((y) => [y, "#e15759"]),
  ...["2020","2021","2022","2023"].map((y) => [y, "#76b7b2"]),
  ...["2024","2025","2026"].map((y) => [y, "#59a14f"]),
])

function eraColor(dateStr: string) {
  return ERA_COLORS[dateStr.slice(0, 4)] ?? "#bab0ac"
}

const ERA_LEGEND = [
  { label: "2006–2009", color: "#4e79a7" },
  { label: "2010–2017", color: "#f28e2b" },
  { label: "2018–2019（贸易战）", color: "#e15759" },
  { label: "2020–2023", color: "#76b7b2" },
  { label: "2024–今", color: "#59a14f" },
]

const VAR_LABELS: Record<keyof ZScores, string> = {
  pmi_chg:    "PMI变化（同比）",
  yield_chg:  "10Y收益率变化",
  spread_chg: "期限利差变化",
  nhci_yoy:   "南华工业品指数同比",
  afre:       "社融存量同比",
  m1:         "M1同比",
  cpi:        "CPI同比",
}

const Z_KEYS = ["pmi_chg", "yield_chg", "spread_chg", "nhci_yoy", "afre", "m1", "cpi"] as const

// ── Component ─────────────────────────────────────────────────────────────────
export default function RegimeSimilarityChart() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"similarity" | "timeline">("similarity")
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/ma/api/macro/regime-similarity?ts=${Date.now()}`, {
        cache: "no-store",
      })
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error || "加载失败")
      }

      const payload = json as ApiResponse
      if (!payload.run_date && !payload.top20?.length) {
        setData(null)
        setError("暂无计算结果，请先运行 calc_regime_similarity.py")
        return
      }

      setData(payload)
      setLastUpdated(new Date().toLocaleString("zh-CN", { hour12: false }))
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useChartAutoRefresh(loadData, [])

  // ── Chart 1: Top-20 similarity (horizontal bar) ──────────────────────────
  const similarityOption = useMemo(() => {
    if (!data?.top20?.length) return {}
    const items = [...data.top20].sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0))
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: (p: any) =>
          `${p.name}<br/>欧氏距离: ${(+p.value).toFixed(3)}`,
      },
      grid: { left: "18%", right: "10%", top: "4%", bottom: "8%" },
      xAxis: {
        type: "value" as const,
        name: "欧氏距离（Z分数空间）",
        nameLocation: "middle" as const,
        nameGap: 28,
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      yAxis: {
        type: "category" as const,
        data: items.map((d) => d.date),
        axisLabel: { fontSize: 9 },
      },
      series: [
        {
          type: "bar" as const,
          data: items.map((d) => ({
            value: d.distance ?? 0,
            name: d.date,
            itemStyle: { color: eraColor(d.date) },
            label: {
              show: true,
              position: "right" as const,
              formatter: ({ value }: { value: number }) => value.toFixed(3),
              fontSize: 8,
              color: "#555",
            },
          })),
          barWidth: 12,
        },
      ],
    }
  }, [data])

  // ── Chart 2: Current macro fingerprint (z-score bar) ─────────────────────
  const fingerprintOption = useMemo(() => {
    const zs = data?.current_zscores
    if (!zs) return {}
    const keys = Z_KEYS.filter((k) => zs[k] != null)
    const values = keys.map((k) => zs[k] as number)
    const labels = keys.map((k) => VAR_LABELS[k])
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: (p: any) => `${p.name}<br/>Z分数: ${(+p.value).toFixed(4)}`,
      },
      grid: { left: "38%", right: "14%", top: "4%", bottom: "8%" },
      xAxis: {
        type: "value" as const,
        min: -3.2,
        max: 3.2,
        name: "Z分数（滚动120月窗口）",
        nameLocation: "middle" as const,
        nameGap: 28,
        nameTextStyle: { fontSize: 10 },
        axisLabel: {
          fontSize: 9,
          formatter: (v: number) => v.toFixed(0),
        },
        splitLine: { lineStyle: { opacity: 0.2 } },
        markLine: {
          silent: true,
          data: [
            { xAxis: -2, lineStyle: { color: "#ccc", type: "dashed" } },
            { xAxis: -1, lineStyle: { color: "#aaa", type: "dashed" } },
            { xAxis:  0, lineStyle: { color: "#333", width: 1 } },
            { xAxis:  1, lineStyle: { color: "#aaa", type: "dashed" } },
            { xAxis:  2, lineStyle: { color: "#ccc", type: "dashed" } },
          ],
        },
      },
      yAxis: {
        type: "category" as const,
        data: labels,
        axisLabel: { fontSize: 9 },
      },
      series: [
        {
          type: "bar" as const,
          data: values.map((v, i) => ({
            value: v,
            name: labels[i],
            itemStyle: { color: v < 0 ? "#e15759" : "#4e79a7" },
            label: {
              show: true,
              position: v >= 0 ? ("right" as const) : ("left" as const),
              formatter: ({ value }: { value: number }) =>
                (value >= 0 ? "+" : "") + value.toFixed(2),
              fontSize: 9,
              fontWeight: "bold" as const,
              color: "#333",
            },
          })),
          barWidth: 14,
        },
      ],
    }
  }, [data])

  // ── Chart 3: Timeline scatter (all distances) ─────────────────────────────
  const timelineOption = useMemo(() => {
    if (!data?.all_distances?.length) return {}

    const top20Set = new Set(data.top20.map((d) => d.date))
    const regular = data.all_distances.filter((d) => !d.in_top20 && d.distance != null)
    const highlighted = data.all_distances.filter(
      (d) => d.in_top20 && d.distance != null
    )

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: (p: any) => {
          const [dateStr, dist] = p.data as [string, number]
          const inTop = top20Set.has(dateStr)
          return `${dateStr}<br/>距离: ${dist.toFixed(3)}${inTop ? "<br/>★ 前20相似月份" : ""}`
        },
      },
      legend: {
        data: ["历史月份", "前20相似月份"],
        top: 4,
        right: 8,
        textStyle: { fontSize: 10 },
      },
      grid: { left: "6%", right: "4%", top: "14%", bottom: "14%" },
      xAxis: {
        type: "category" as const,
        data: [...new Set(data.all_distances.map((d) => d.date))].sort(),
        axisLabel: {
          formatter: (v: string) => v.slice(0, 7),
          rotate: 30,
          fontSize: 9,
          interval: Math.floor(data.all_distances.length / 12),
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "欧氏距离",
        nameLocation: "middle" as const,
        nameGap: 38,
        nameTextStyle: { fontSize: 10 },
        splitLine: { lineStyle: { opacity: 0.2 } },
        axisLabel: { fontSize: 9 },
      },
      series: [
        {
          name: "历史月份",
          type: "scatter" as const,
          data: regular.map((d) => [d.date, d.distance]),
          symbolSize: 5,
          itemStyle: { color: "#94a3b8", opacity: 0.5 },
          z: 1,
        },
        {
          name: "前20相似月份",
          type: "scatter" as const,
          data: highlighted.map((d) => [d.date, d.distance]),
          symbolSize: 12,
          itemStyle: { color: "#e15759", borderColor: "#333", borderWidth: 1 },
          label: {
            show: true,
            position: "top" as const,
            formatter: (p: any) => (p.data as [string, number])[0],
            fontSize: 8,
            color: "#333",
          },
          z: 3,
        },
      ],
    }
  }, [data])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        加载经济体制相似性数据…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (!data) return null

  const currentMonth = data.current_month ?? "—"
  const runDate = data.run_date ?? "—"

  return (
    <div className="flex flex-col gap-6">
      {/* Header + tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            最新计算：{runDate} · 当期参考月份：{currentMonth}
          </p>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground">最近刷新：{lastUpdated}</p>
          )}
          {data.data_note && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{data.data_note}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadData(true)}
            disabled={loading}
            className="h-8 gap-2"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            刷新
          </Button>
          <div className="flex gap-1">
          {(["similarity", "timeline"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                activeTab === tab
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {tab === "similarity" ? "相似性分析" : "历史时序"}
            </button>
          ))}
          </div>
        </div>
      </div>

      {activeTab === "similarity" && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Chart 1 – similarity ranking */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                与{currentMonth}最相似的前20个历史月份
              </CardTitle>
              <CardDescription>
                欧氏距离越小表示宏观环境越相似；按距离升序排列
              </CardDescription>
              {/* Era legend */}
              <div className="flex flex-wrap gap-2 pt-1">
                {ERA_LEGEND.map((e) => (
                  <span key={e.label} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: e.color }}
                    />
                    {e.label}
                  </span>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {data.top20.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                  暂无数据
                </div>
              ) : (
                <ReactECharts
                  option={similarityOption}
                  style={{ height: 420 }}
                  notMerge
                />
              )}
            </CardContent>
          </Card>

          {/* Chart 2 – current macro fingerprint */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                当前宏观特征指纹（{currentMonth}）
              </CardTitle>
              <CardDescription>
                滚动120个月Z分数；蓝色=偏强，红色=偏弱（相对历史均值）
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!data.current_zscores ? (
                <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                  暂无数据
                </div>
              ) : (
                <ReactECharts
                  option={fingerprintOption}
                  style={{ height: 420 }}
                  notMerge
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "timeline" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              各历史月份与当前宏观环境（{currentMonth}）的距离
            </CardTitle>
            <CardDescription>
              距离越小越相似；红色大点为前20个最相似月份
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.all_distances.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                暂无数据
              </div>
            ) : (
              <ReactECharts
                option={timelineOption}
                style={{ height: 380 }}
                notMerge
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
