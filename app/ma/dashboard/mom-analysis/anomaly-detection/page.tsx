"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Info, RefreshCw, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import dynamic from "next/dynamic"

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false })

// ── types ─────────────────────────────────────────────────────────────────────

type Severity = "critical" | "warning" | "info"

interface Anomaly {
  id: string
  date: string
  account: string | null
  type: string
  severity: Severity
  title: string
  detail: string
  value: number | null
  threshold: number | null
  unit?: string
}

interface DailySummary {
  date: string
  critical: number
  warning: number
  info: number
  total: number
}

interface ApiResponse {
  ok: boolean
  latestDate: string | null
  anomalies: Anomaly[]
  dailySummary: DailySummary[]
  notYetRun?: boolean
  error?: string
}

// ── helpers ───────────────────────────────────────────────────────────────────

const ANOMALY_TYPE_LABELS: Record<string, string> = {
  HIGH_RISK_RATIO: "高风险度",
  LOW_AVAILABLE_FUNDS: "可用资金不足",
  MARGIN_OVERUSE: "保证金占用过高",
  LARGE_DAILY_LOSS: "当日亏损",
  NEGATIVE_EQUITY: "权益为负",
}

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"]

function severityLabel(s: Severity) {
  return { critical: "严重", warning: "警告", info: "提示" }[s]
}

function severityIcon(s: Severity) {
  if (s === "critical") return <AlertCircle className="h-4 w-4 text-red-500" />
  if (s === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500" />
  return <Info className="h-4 w-4 text-blue-500" />
}

function severityBadgeVariant(s: Severity): "destructive" | "outline" | "secondary" {
  if (s === "critical") return "destructive"
  if (s === "warning") return "outline"
  return "secondary"
}

function severityBorderClass(s: Severity): string {
  if (s === "critical") return "border-red-500/50 bg-red-500/5"
  if (s === "warning") return "border-yellow-500/50 bg-yellow-500/5"
  return "border-blue-500/50 bg-blue-500/5"
}

function stepDate(dateStr: string, delta: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}

// ── component ─────────────────────────────────────────────────────────────────

export default function AnomalyDetectionPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const load = useCallback(async (nocache = false) => {
    setLoading(true)
    try {
      const url = `/ma/api/mom-analysis/anomaly-detection?lookback=30${nocache ? "&nocache=1" : ""}`
      const res = await fetch(url)
      const json: ApiResponse = await res.json()
      setData(json)
      if (json.latestDate && !selectedDate) {
        setSelectedDate(json.latestDate)
      }
    } catch {
      setData({ ok: false, latestDate: null, anomalies: [], dailySummary: [], error: "网络请求失败" })
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  useEffect(() => {
    load()
  }, [refreshKey])

  // Available dates from summary
  const availableDates = useMemo(() => {
    if (!data) return []
    return data.dailySummary.map((d) => d.date).sort()
  }, [data])

  const currentIndex = selectedDate ? availableDates.indexOf(selectedDate) : -1
  const canPrev = currentIndex > 0
  const canNext = currentIndex < availableDates.length - 1

  // Anomalies for selected date
  const dayAnomalies = useMemo(() => {
    if (!data || !selectedDate) return []
    return data.anomalies
      .filter((a) => a.date === selectedDate)
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
  }, [data, selectedDate])

  const daySummary = useMemo(() => {
    if (!data || !selectedDate) return null
    return data.dailySummary.find((d) => d.date === selectedDate) ?? null
  }, [data, selectedDate])

  // ECharts option for historical anomaly bar chart
  const chartOption = useMemo(() => {
    if (!data || data.dailySummary.length === 0) return null
    const summaries = [...data.dailySummary].sort((a, b) => a.date.localeCompare(b.date))
    const dates = summaries.map((s) => s.date)
    const criticals = summaries.map((s) => s.critical)
    const warnings = summaries.map((s) => s.warning)
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: any[]) => {
          const date = params[0]?.axisValue ?? ""
          const lines = params.map((p: any) => `${p.marker}${p.seriesName}: ${p.value}`)
          return [date, ...lines].join("<br/>")
        },
      },
      legend: {
        data: ["严重", "警告"],
        textStyle: { color: "#94a3b8", fontSize: 11 },
        right: 0,
        top: 0,
      },
      grid: { left: 0, right: 16, top: 28, bottom: 0, containLabel: true },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: {
          color: "#94a3b8",
          fontSize: 10,
          rotate: 35,
          formatter: (v: string) => v.slice(5),
        },
        axisLine: { lineStyle: { color: "#334155" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: "#94a3b8", fontSize: 10 },
        splitLine: { lineStyle: { color: "#1e293b" } },
      },
      series: [
        {
          name: "严重",
          type: "bar",
          stack: "total",
          data: criticals,
          itemStyle: { color: "#ef4444", borderRadius: [0, 0, 0, 0] },
          emphasis: { itemStyle: { color: "#dc2626" } },
        },
        {
          name: "警告",
          type: "bar",
          stack: "total",
          data: warnings,
          itemStyle: { color: "#eab308", borderRadius: [3, 3, 0, 0] },
          emphasis: { itemStyle: { color: "#ca8a04" } },
        },
      ],
    }
  }, [data])

  // Group anomalies by type for the selected day
  const byType = useMemo(() => {
    const map: Record<string, Anomaly[]> = {}
    for (const a of dayAnomalies) {
      if (!map[a.type]) map[a.type] = []
      map[a.type].push(a)
    }
    return map
  }, [dayAnomalies])

  // ── render ──

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" />
        加载中…
      </div>
    )
  }

  if (data?.notYetRun) {
    return (
      <div className="space-y-6 pt-6">
        <div className="flex items-center gap-3">
          <Link href="/ma/dashboard/mom-analysis">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" /> 返回
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">异常监测</h1>
            <p className="text-sm text-muted-foreground mt-1">每日自动检测账户风险指标异常</p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <ShieldAlert className="h-10 w-10 opacity-30" />
          <p className="text-sm">暂无数据，请先完成数据导入。</p>
        </div>
      </div>
    )
  }

  if (data?.error && !data.ok) {
    return (
      <div className="space-y-6 pt-6">
        <div className="flex items-center gap-3">
          <Link href="/ma/dashboard/mom-analysis">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" /> 返回
            </Button>
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">异常监测</h1>
        </div>
        <p className="text-sm text-red-500">{data.error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 pt-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/ma/dashboard/mom-analysis">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" /> 返回
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">异常监测</h1>
            <p className="text-sm text-muted-foreground mt-1">每日自动检测账户风险指标异常，覆盖近 30 个交易日</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => { setRefreshKey((k) => k + 1); load(true) }}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {/* Historical bar chart */}
      {chartOption && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">近期异常趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <ReactECharts
              option={chartOption}
              style={{ height: 160 }}
              notMerge
              opts={{ renderer: "svg" }}
              onEvents={{
                click: (params: { dataIndex: number }) => {
                  const d = data?.dailySummary[params.dataIndex]?.date
                  if (d) setSelectedDate(d)
                },
              }}
            />
            <p className="text-xs text-muted-foreground mt-1 text-center">点击柱形可跳转至对应日期</p>
          </CardContent>
        </Card>
      )}

      {/* Date navigator */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={!canPrev}
          onClick={() => setSelectedDate(availableDates[currentIndex - 1])}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium tabular-nums w-28 text-center">{selectedDate ?? "—"}</span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          disabled={!canNext}
          onClick={() => setSelectedDate(availableDates[currentIndex + 1])}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* Summary badges */}
        {daySummary && (
          <div className="flex items-center gap-2 ml-2">
            {daySummary.critical > 0 && (
              <Badge variant="destructive" className="text-xs">
                {daySummary.critical} 严重
              </Badge>
            )}
            {daySummary.warning > 0 && (
              <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600 dark:text-yellow-400">
                {daySummary.warning} 警告
              </Badge>
            )}
            {daySummary.total === 0 && (
              <Badge variant="secondary" className="text-xs text-green-600 dark:text-green-400 border-green-500/30">
                无异常
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Anomaly list */}
      {dayAnomalies.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <ShieldAlert className="h-10 w-10 opacity-20" />
          <p className="text-sm">{selectedDate ? `${selectedDate} 无异常检测结果` : "请选择日期"}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(byType).map(([type, items]) => (
            <Card key={type}>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {severityIcon(items[0].severity)}
                  {ANOMALY_TYPE_LABELS[type] ?? type}
                  <span className="text-muted-foreground font-normal ml-1">({items.length} 条)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="divide-y divide-border/60">
                  {items.map((anomaly) => (
                    <div
                      key={anomaly.id}
                      className={`flex items-start gap-3 px-3 py-3 rounded-md border my-1 ${severityBorderClass(anomaly.severity)}`}
                    >
                      <div className="mt-0.5 shrink-0">{severityIcon(anomaly.severity)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{anomaly.title}</span>
                          <Badge
                            variant={severityBadgeVariant(anomaly.severity)}
                            className="text-[10px] h-4 px-1.5"
                          >
                            {severityLabel(anomaly.severity)}
                          </Badge>
                          {anomaly.account && (
                            <span className="text-xs font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                              {anomaly.account}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{anomaly.detail}</p>
                      </div>
                      {anomaly.value !== null && (
                        <div className="shrink-0 text-right">
                          <div
                            className={`text-sm font-semibold tabular-nums ${
                              anomaly.severity === "critical"
                                ? "text-red-500"
                                : anomaly.severity === "warning"
                                  ? "text-yellow-500"
                                  : "text-blue-500"
                            }`}
                          >
                            {anomaly.value.toLocaleString("zh-CN", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 2,
                            })}
                            {anomaly.unit ?? ""}
                          </div>
                          {anomaly.threshold !== null && (
                            <div className="text-[10px] text-muted-foreground">
                              阈值 {anomaly.threshold}
                              {anomaly.unit ?? ""}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
