"use client"

import { useCallback, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { useChartAutoRefresh } from "@/hooks/use-chart-auto-refresh"

// ── Types ─────────────────────────────────────────────────────────────────────
type TimeseriesRow = {
  date: string           // "YYYY-MM"
  social: number | null
  shibor: number | null
  social_ma: number | null
  shibor_ma: number | null
  quadrant: string | null
}

type DistributionRow = {
  quadrant: string
  count: number
}

type Recent36Row = {
  date: string
  quadrant: string | null
}

type StateSpaceRow = {
  date: string
  social_ma: number
  shibor_ma: number
  quadrant: string | null
}

type CurrentState = {
  date: string
  monetary_state: string | null
  credit_state: string | null
  monetary: string | null
  credit: string | null
  quadrant: string | null
  social_ma: number | null
  shibor_ma: number | null
}

type ApiResponse = {
  current: CurrentState | null
  timeseries: TimeseriesRow[]
  distribution: DistributionRow[]
  recent36: Recent36Row[]
  stateSpace: StateSpaceRow[]
  data_note?: string | null
}

// ── Colours ───────────────────────────────────────────────────────────────────
const QUADRANT_COLORS: Record<string, string> = {
  "衰退/防御": "#4C72B0",
  "复苏/进攻": "#55A868",
  "过热/商品": "#DD8452",
  "滞胀/现金": "#C44E52",
  "中性":      "#8C8C8C",
}

const QUADRANT_ORDER = ["衰退/防御", "复苏/进攻", "过热/商品", "滞胀/现金", "中性"]

function qColor(q: string | null) {
  return QUADRANT_COLORS[q ?? "中性"] ?? "#8C8C8C"
}

// ── Helper: build background markAreas for quadrant shading on time axis ──────
function buildMarkAreas(timeseries: TimeseriesRow[]) {
  const areas: [{ xAxis: string; itemStyle: { color: string; opacity: number } }, { xAxis: string }][] = []
  let prevQ: string | null = null
  let prevDate: string | null = null

  const rows = timeseries.filter((r) => r.quadrant != null)
  for (let i = 0; i < rows.length; i++) {
    const { date, quadrant } = rows[i]
    if (prevQ === null) {
      prevQ = quadrant
      prevDate = date
      continue
    }
    if (quadrant !== prevQ || i === rows.length - 1) {
      const endDate = i === rows.length - 1 ? date : rows[i - 1].date
      areas.push([
        { xAxis: prevDate!, itemStyle: { color: qColor(prevQ), opacity: 0.18 } },
        { xAxis: endDate },
      ])
      prevQ = quadrant
      prevDate = date
    }
  }
  return areas
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
type Tab = "timeseries" | "distribution" | "statespace" | "recent36"

// ── Component ─────────────────────────────────────────────────────────────────
export default function MoneyCreditChart() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>("timeseries")

  const load = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/ma/api/macro/money-credit?ts=${Date.now()}`, { cache: "no-store" })
      const json: ApiResponse = await res.json()
      if (!json.timeseries?.length) {
        setError("暂无计算结果，请先运行 calc_money_credit.py")
      } else {
        setData(json)
      }
    } catch (e: any) {
      setError(e.message || "加载失败")
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useChartAutoRefresh(load, [])

  // ── Chart 1: Dual timeseries with quadrant background ─────────────────────
  const timeseriesOption = useMemo(() => {
    if (!data?.timeseries?.length) return {}
    const ts = data.timeseries
    const dates = ts.map((r) => r.date)
    const markAreas = buildMarkAreas(ts)

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (params: any[]) => {
          const date = params[0]?.axisValue ?? ""
          const lines = params.map((p: any) =>
            `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px"></span>${p.seriesName}: ${p.data != null ? (+p.data).toFixed(2) : "—"}`
          )
          return `<b>${date}</b><br/>${lines.join("<br/>")}`
        },
      },
      legend: {
        data: ["SHIBOR 3M（月末）", "SHIBOR 3月均值", "社融存量同比", "社融 3月均值"],
        top: 4,
        textStyle: { fontSize: 10 },
      },
      grid: [
        { left: "6%", right: "3%", top: "14%", height: "35%" },
        { left: "6%", right: "3%", top: "56%", height: "35%" },
      ],
      xAxis: [
        { type: "category", data: dates, gridIndex: 0, axisLabel: { show: false }, boundaryGap: false, axisLine: { show: false } },
        { type: "category", data: dates, gridIndex: 1, axisLabel: { fontSize: 9, rotate: 30, formatter: (v: string) => v }, boundaryGap: false },
      ],
      yAxis: [
        { type: "value", gridIndex: 0, name: "SHIBOR 3M (%)", nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 }, splitLine: { lineStyle: { opacity: 0.2 } } },
        { type: "value", gridIndex: 1, name: "社融存量同比 (%)", nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 }, splitLine: { lineStyle: { opacity: 0.2 } } },
      ],
      series: [
        {
          name: "SHIBOR 3M（月末）",
          type: "line",
          data: ts.map((r) => r.shibor),
          xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { width: 1.2, color: "#1f77b4" },
          itemStyle: { color: "#1f77b4" },
          showSymbol: false,
          markArea: { data: markAreas },
        },
        {
          name: "SHIBOR 3月均值",
          type: "line",
          data: ts.map((r) => r.shibor_ma),
          xAxisIndex: 0, yAxisIndex: 0,
          lineStyle: { width: 2, color: "#1f77b4", type: "dashed" },
          itemStyle: { color: "#1f77b4" },
          showSymbol: false,
        },
        {
          name: "社融存量同比",
          type: "line",
          data: ts.map((r) => r.social),
          xAxisIndex: 1, yAxisIndex: 1,
          lineStyle: { width: 1.2, color: "#d62728" },
          itemStyle: { color: "#d62728" },
          showSymbol: false,
          markArea: { data: markAreas.map(([s, e]) => [{ ...s }, e]) },
        },
        {
          name: "社融 3月均值",
          type: "line",
          data: ts.map((r) => r.social_ma),
          xAxisIndex: 1, yAxisIndex: 1,
          lineStyle: { width: 2, color: "#d62728", type: "dashed" },
          itemStyle: { color: "#d62728" },
          showSymbol: false,
        },
      ],
    }
  }, [data])

  // ── Chart 2: Distribution (donut + horizontal bar side-by-side) ───────────
  const distributionOption = useMemo(() => {
    if (!data?.distribution?.length) return {}
    const ordered = QUADRANT_ORDER
      .map((q) => ({ name: q, value: data.distribution.find((d) => d.quadrant === q)?.count ?? 0 }))
      .filter((d) => d.value > 0)
    const colors = ordered.map((d) => qColor(d.name))

    return {
      backgroundColor: "transparent",
      tooltip: { trigger: "item", formatter: "{b}: {c} 个月 ({d}%)" },
      legend: { orient: "vertical", left: "2%", top: "middle", textStyle: { fontSize: 10 } },
      series: [
        {
          type: "pie",
          radius: ["38%", "68%"],
          center: ["60%", "50%"],
          data: ordered.map((d, i) => ({ name: d.name, value: d.value, itemStyle: { color: colors[i] } })),
          label: { formatter: "{b}\n{d}%", fontSize: 10 },
          labelLine: { length: 10, length2: 8 },
        },
      ],
    }
  }, [data])

  // ── Chart 3: State space scatter ──────────────────────────────────────────
  const stateSpaceOption = useMemo(() => {
    if (!data?.stateSpace?.length) return {}
    const byQuadrant: Record<string, [number, number, string][]> = {}
    for (const r of data.stateSpace) {
      const q = r.quadrant ?? "中性"
      if (!byQuadrant[q]) byQuadrant[q] = []
      byQuadrant[q].push([r.social_ma, r.shibor_ma, r.date])
    }

    const latest = data.stateSpace[data.stateSpace.length - 1]

    const series: any[] = Object.entries(byQuadrant).map(([q, pts]) => ({
      name: q,
      type: "scatter",
      data: pts.map(([x, y]) => [x, y]),
      symbolSize: 7,
      itemStyle: { color: qColor(q), opacity: 0.7 },
    }))

    if (latest) {
      series.push({
        name: "当前",
        type: "scatter",
        data: [[latest.social_ma, latest.shibor_ma]],
        symbolSize: 18,
        itemStyle: { color: qColor(latest.quadrant), borderColor: "#000", borderWidth: 1.5 },
        label: {
          show: true,
          position: "top",
          formatter: `最新\n${latest.date}`,
          fontSize: 9,
          fontWeight: "bold",
          color: "#333",
        },
        z: 10,
      })
    }

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: (p: any) => {
          const [x, y] = p.data as [number, number]
          return `${p.seriesName}<br/>社融同比MA: ${x.toFixed(2)}%<br/>SHIBOR MA: ${y.toFixed(2)}%`
        },
      },
      legend: {
        data: QUADRANT_ORDER.filter((q) => byQuadrant[q]),
        top: 4,
        textStyle: { fontSize: 10 },
      },
      grid: { left: "8%", right: "4%", top: "16%", bottom: "10%" },
      xAxis: {
        type: "value",
        name: "社融存量同比 3月均值 (%)",
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      yAxis: {
        type: "value",
        name: "SHIBOR 3M 3月均值 (%)",
        nameLocation: "middle",
        nameGap: 38,
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      series,
    }
  }, [data])

  // ── Chart 4: Recent 36 months timeline (colored blocks) ───────────────────
  // Rendered as custom HTML (CSS grid) — simpler than ECharts for this pattern
  const recent36 = data?.recent36 ?? []

  // ── Loading / Error ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        加载货币+信用周期数据…
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

  const current = data.current

  const TABS: { key: Tab; label: string }[] = [
    { key: "timeseries",   label: "历史走势" },
    { key: "distribution", label: "象限分布" },
    { key: "statespace",   label: "状态空间" },
    { key: "recent36",     label: "近36月" },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Current state banner */}
      {current && (
        <div
          className="flex flex-wrap items-center gap-4 rounded-lg border px-4 py-3"
          style={{ borderColor: qColor(current.quadrant), backgroundColor: qColor(current.quadrant) + "18" }}
        >
          <div>
            <span className="text-xs text-muted-foreground">当期（{current.date}）</span>
            <div className="mt-0.5 flex items-center gap-2">
              <span
                className="rounded px-2 py-0.5 text-sm font-bold text-white"
                style={{ backgroundColor: qColor(current.quadrant) }}
              >
                {current.quadrant}
              </span>
            </div>
          </div>
          <div className="flex gap-6 text-sm">
            <span>
              <span className="text-muted-foreground text-xs">货币</span>
              <span className="ml-1 font-medium">{current.monetary_state}</span>
              <span className="ml-1 text-xs text-muted-foreground">（{current.monetary}）</span>
            </span>
            <span>
              <span className="text-muted-foreground text-xs">信用</span>
              <span className="ml-1 font-medium">{current.credit_state}</span>
              <span className="ml-1 text-xs text-muted-foreground">（{current.credit}）</span>
            </span>
          </div>
        </div>
      )}
      {data.data_note && (
        <p className="-mt-3 text-xs text-amber-700 dark:text-amber-400">{data.data_note}</p>
      )}

      {/* Tab selector */}
      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              activeTab === t.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Quadrant legend */}
      <div className="flex flex-wrap gap-3">
        {QUADRANT_ORDER.map((q) => (
          <span key={q} className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: qColor(q) }} />
            {q}
          </span>
        ))}
      </div>

      {/* Chart content */}
      {activeTab === "timeseries" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">SHIBOR 3M & 社融存量同比历史走势</CardTitle>
            <CardDescription>背景色块为当期象限；虚线为3月均值</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={timeseriesOption} style={{ height: 480 }} notMerge />
          </CardContent>
        </Card>
      )}

      {activeTab === "distribution" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">各象限历史分布</CardTitle>
            <CardDescription>统计 2006-10 以来各货币+信用象限的月份占比</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={distributionOption} style={{ height: 360 }} notMerge />
          </CardContent>
        </Card>
      )}

      {activeTab === "statespace" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">货币-信用状态空间</CardTitle>
            <CardDescription>横轴=社融同比3月均值；纵轴=SHIBOR 3M 3月均值；颜色=象限</CardDescription>
          </CardHeader>
          <CardContent>
            <ReactECharts option={stateSpaceOption} style={{ height: 420 }} notMerge />
          </CardContent>
        </Card>
      )}

      {activeTab === "recent36" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">最近 36 个月象限状态</CardTitle>
            <CardDescription>每格为一个月；右侧为最新月份</CardDescription>
          </CardHeader>
          <CardContent>
            {recent36.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            ) : (
              <div className="overflow-x-auto pb-2">
                <div className="flex min-w-max gap-0.5">
                  {recent36.map((r, i) => (
                    <div
                      key={r.date}
                      className="relative flex flex-col items-center"
                      style={{ width: 42 }}
                    >
                      <div
                        className="flex h-14 w-full items-center justify-center rounded text-center"
                        style={{
                          backgroundColor: qColor(r.quadrant) + "dd",
                        }}
                        title={`${r.date} — ${r.quadrant}`}
                      >
                        <span
                          className="text-white font-bold leading-tight"
                          style={{ fontSize: 8, writingMode: "vertical-rl" }}
                        >
                          {r.quadrant}
                        </span>
                      </div>
                      {i % 6 === 0 && (
                        <span className="mt-1 text-center text-muted-foreground" style={{ fontSize: 8 }}>
                          {r.date.slice(0, 7)}
                        </span>
                      )}
                      {i === recent36.length - 1 && (
                        <span className="mt-1 text-center text-xs font-bold">▶</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
