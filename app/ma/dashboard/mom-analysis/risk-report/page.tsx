"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"
import { BarChart2, ShieldAlert, PieChart, Users, ScanSearch, AlertCircle, AlertTriangle, Info, ChevronLeft, ChevronRight, RefreshCw, Droplets } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const ProductNavChart           = dynamic(() => import("@/components/ma/product-nav-chart"),            { ssr: false })
const AdvisorEquityCurveChart  = dynamic(() => import("@/components/ma/advisor-equity-curve-chart"), { ssr: false })
const AdvisorVolCorrScatter    = dynamic(() => import("@/components/ma/advisor-vol-corr-scatter"),   { ssr: false })
const AdvisorCorrTimeseries    = dynamic(() => import("@/components/ma/advisor-corr-timeseries"),    { ssr: false })
const AdvisorRiskReturnScatter = dynamic(() => import("@/components/ma/advisor-risk-return-scatter"), { ssr: false })
const AdvisorMaxSharpeWeights  = dynamic(() => import("@/components/ma/advisor-max-sharpe-weights"),  { ssr: false })
const AdvisorCapitalEfficiency    = dynamic(() => import("@/components/ma/advisor-capital-efficiency"),        { ssr: false })
const AdvisorReallocation         = dynamic(() => import("@/components/ma/advisor-reallocation"),            { ssr: false })
const AdvisorSectorLeverageHeatmap  = dynamic(() => import("@/components/ma/advisor-sector-leverage-heatmap"),  { ssr: false })
const AdvisorSectorExposureStack   = dynamic(() => import("@/components/ma/advisor-sector-exposure-stack"),   { ssr: false })

const subNavItems = [
  { key: "overview",  name: "产品总览", icon: BarChart2 },
  { key: "intraday",  name: "日间风控", icon: ShieldAlert },
  { key: "position",  name: "持仓分析", icon: PieChart },
  { key: "advisor",   name: "投顾分析", icon: Users },
  { key: "anomaly",   name: "异常监测", icon: ScanSearch },
] as const

type TabKey = (typeof subNavItems)[number]["key"]

const jsonResponseCache = new Map<string, unknown>()
const inflightJsonRequests = new Map<string, Promise<unknown>>()

function fetchJsonCached(url: string): Promise<any> {
  if (jsonResponseCache.has(url)) {
    return Promise.resolve(jsonResponseCache.get(url))
  }
  const inflight = inflightJsonRequests.get(url)
  if (inflight) {
    return inflight
  }
  const request = fetch(url)
    .then((r) => r.json())
    .then((json) => {
      jsonResponseCache.set(url, json)
      return json
    })
    .finally(() => {
      inflightJsonRequests.delete(url)
    })
  inflightJsonRequests.set(url, request)
  return request
}

function PlaceholderContent({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
      <p className="text-lg font-medium">{title}</p>
      <p className="text-sm">页面建设中，敬请期待。</p>
    </div>
  )
}

function AdvisorContent() {
  const [volWindow, setVolWindow] = useState("20")
  const [advisorVol, setAdvisorVol] = useState<{ account: string; vol: number; marginalVol: number }[]>([])
  const [volLoading, setVolLoading] = useState(false)
  const [volError, setVolError] = useState<string | null>(null)

  const [mvolWindow, setMvolWindow] = useState("20")
  const [advisorMvol, setAdvisorMvol] = useState<{ account: string; vol: number; marginalVol: number }[]>([])
  const [mvolLoading, setMvolLoading] = useState(false)
  const [mvolError, setMvolError] = useState<string | null>(null)

  const [mvolCompare, setMvolCompare] = useState("1")
  const [advisorMvolChange, setAdvisorMvolChange] = useState<{ account: string; mvolChange: number }[]>([])
  const [mvolChangeLoading, setMvolChangeLoading] = useState(false)
  const [mvolChangeError, setMvolChangeError] = useState<string | null>(null)
  const [mvolChangePieView, setMvolChangePieView] = useState(false)

  const [pnlWindow, setPnlWindow] = useState("20")
  const [advisorPnl, setAdvisorPnl] = useState<{ account: string; pnl: number }[]>([])
  const [pnlLoading, setPnlLoading] = useState(false)
  const [pnlError, setPnlError] = useState<string | null>(null)

  const fetchAdvisorVol = useCallback((window: string) => {
    setVolLoading(true)
    setVolError(null)
    fetchJsonCached(`/ma/api/mom-analysis/advisor-vol?window=${window}`)
      .then((j) => {
        if (j.ok === false) { setVolError(j.error ?? "加载失败"); return }
        setAdvisorVol(j.advisors ?? [])
      })
      .catch((e) => setVolError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setVolLoading(false))
  }, [])

  const fetchAdvisorMvol = useCallback((window: string) => {
    setMvolLoading(true)
    setMvolError(null)
    fetchJsonCached(`/ma/api/mom-analysis/advisor-vol?window=${window}`)
      .then((j) => {
        if (j.ok === false) { setMvolError(j.error ?? "加载失败"); return }
        setAdvisorMvol(j.advisors ?? [])
      })
      .catch((e) => setMvolError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setMvolLoading(false))
  }, [])

  const fetchAdvisorMvolChange = useCallback((window: string, compare: string) => {
    setMvolChangeLoading(true)
    setMvolChangeError(null)
    fetchJsonCached(`/ma/api/mom-analysis/advisor-vol?window=${window}&compare=${compare}`)
      .then((j) => {
        if (j.ok === false) { setMvolChangeError(j.error ?? "加载失败"); return }
        setAdvisorMvolChange((j.advisors ?? []).filter((a: { mvolChange?: number }) => a.mvolChange !== undefined) as { account: string; mvolChange: number }[])
      })
      .catch((e) => setMvolChangeError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setMvolChangeLoading(false))
  }, [])

  const fetchAdvisorPnl = useCallback((window: string) => {
    setPnlLoading(true)
    setPnlError(null)
    fetchJsonCached(`/ma/api/mom-analysis/advisor-vol?window=${window}`)
      .then((j) => {
        if (j.ok === false) { setPnlError(j.error ?? "加载失败"); return }
        setAdvisorPnl((j.advisors ?? []) as { account: string; pnl: number }[])
      })
      .catch((e) => setPnlError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setPnlLoading(false))
  }, [])

  useEffect(() => { fetchAdvisorVol(volWindow) }, [])
  useEffect(() => { fetchAdvisorMvolChange(mvolWindow, mvolCompare) }, [])

  // Fetch vol data once and share with mvol + pnl (same endpoint, same window)
  useEffect(() => {
    setMvolLoading(true)
    setPnlLoading(true)
    fetchJsonCached(`/ma/api/mom-analysis/advisor-vol?window=${pnlWindow}`)
      .then((j) => {
        if (j.ok === false) {
          setMvolError(j.error ?? "加载失败")
          setPnlError(j.error ?? "加载失败")
          return
        }
        setAdvisorMvol(j.advisors ?? [])
        setAdvisorPnl((j.advisors ?? []) as { account: string; pnl: number }[])
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "请求失败"
        setMvolError(msg)
        setPnlError(msg)
      })
      .finally(() => { setMvolLoading(false); setPnlLoading(false) })
  }, [])

  const volChartOption = useMemo(() => {
    const sorted = [...advisorVol].sort((a, b) => b.vol - a.vol)
    const accounts = sorted.map((d) => d.account)
    const vols = sorted.map((d) => d.vol)
    return {
      grid: { left: 40, right: 20, top: 16, bottom: 60 },
      xAxis: {
        type: "category",
        data: accounts,
        axisLabel: { fontSize: 11, rotate: 45, interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "年化波动率 (%)",
        nameLocation: "end",
        nameTextStyle: { fontSize: 11 },
        axisLabel: { fontSize: 11, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params[0]
          return `${p.name}<br/>年化波动率：${p.value.toFixed(2)}%`
        },
      },
      series: [{
        type: "bar",
        data: vols,
        barMaxWidth: 28,
        itemStyle: {
          color: (params: { dataIndex: number }) => {
            const v = vols[params.dataIndex]
            if (v >= 20) return "#ef4444"
            if (v >= 10) return "#f97316"
            return "#3b82f6"
          },
        },
        label: { show: false },
      }],
    }
  }, [advisorVol])

  const pieChartOption = useMemo(() => {
    const sorted = [...advisorVol].sort((a, b) => b.vol - a.vol)
    const COLORS = ["#3b82f6","#f97316","#ef4444","#22c55e","#a855f7","#eab308","#06b6d4","#ec4899","#14b8a6","#f43f5e"]
    const total = sorted.reduce((s, d) => s + d.vol, 0)
    return {
      tooltip: {
        trigger: "item",
        formatter: (p: { name: string; value: number; percent: number }) =>
          `${p.name}<br/>年化波动率：${p.value.toFixed(2)}%<br/>占比：${p.percent.toFixed(1)}%`,
      },
      legend: {
        orient: "vertical",
        right: 8,
        top: "middle",
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { fontSize: 11 },
        formatter: (name: string) => {
          const d = sorted.find((x) => x.account === name)
          if (!d) return name
          const pct = total > 0 ? ((d.vol / total) * 100).toFixed(1) : "0.0"
          return `${name}  ${pct}%`
        },
      },
      series: [{
        type: "pie",
        radius: "65%",
        center: ["36%", "50%"],
        data: sorted.map((d, i) => ({
          name: d.account,
          value: d.vol,
          itemStyle: { color: COLORS[i % COLORS.length] },
        })),
        label: { show: false },
        emphasis: { label: { show: true, fontSize: 12, fontWeight: "bold" } },
      }],
    }
  }, [advisorVol])

  const mvolChartOption = useMemo(() => {
    const sorted = [...advisorMvol].sort((a, b) => b.marginalVol - a.marginalVol)
    const accounts = sorted.map((d) => d.account)
    const mvols = sorted.map((d) => d.marginalVol)
    return {
      grid: { left: 40, right: 20, top: 16, bottom: 60 },
      xAxis: {
        type: "category",
        data: accounts,
        axisLabel: { fontSize: 11, rotate: 45, interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "边际波动率 (%)",
        nameLocation: "end",
        nameTextStyle: { fontSize: 11 },
        axisLabel: { fontSize: 11, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params?.[0]
          if (!p) return ""
          return `${p.name}<br/>边际波动率：${(p.value ?? 0).toFixed(2)}%`
        },
      },
      series: [{
        type: "bar",
        data: mvols,
        barMaxWidth: 28,
        itemStyle: {
          color: (params: { dataIndex: number }) => {
            const v = mvols[params.dataIndex]
            if (v < 0) return "#22c55e"
            if (v >= 20) return "#ef4444"
            if (v >= 10) return "#f97316"
            return "#3b82f6"
          },
        },
        label: { show: false },
      }],
    }
  }, [advisorMvol])

  const mvolChangeChartOption = useMemo(() => {
    const sorted = [...advisorMvolChange].sort((a, b) => b.mvolChange - a.mvolChange)
    const accounts = sorted.map((d) => d.account)
    const changes = sorted.map((d) => d.mvolChange)
    return {
      grid: { left: 40, right: 20, top: 16, bottom: 60 },
      xAxis: {
        type: "category",
        data: accounts,
        axisLabel: { fontSize: 11, rotate: 45, interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "边际波动率变化 (%)",
        nameLocation: "end",
        nameTextStyle: { fontSize: 11 },
        axisLabel: { fontSize: 11, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params?.[0]
          if (!p) return ""
          return `${p.name}<br/>边际波动率变化：${(p.value ?? 0).toFixed(2)}%`
        },
      },
      series: [{
        type: "bar",
        data: changes,
        barMaxWidth: 28,
        itemStyle: {
          color: (params: { dataIndex: number }) => {
            const v = changes[params.dataIndex]
            return v < 0 ? "#22c55e" : "#ef4444"
          },
        },
        label: { show: false },
      }],
    }
  }, [advisorMvolChange])

  const mvolChangePieOption = useMemo(() => {
    const COLORS = ["#3b82f6","#f97316","#ef4444","#22c55e","#a855f7","#eab308","#06b6d4","#ec4899","#14b8a6","#f43f5e"]
    const pos = advisorMvol.filter((d) => d.marginalVol >= 0)
    const neg = advisorMvol.filter((d) => d.marginalVol < 0)
    const makePie = (data: typeof pos, center: string) => ({
      type: "pie" as const,
      radius: "55%",
      center: [center, "50%"],
      data: data.map((d, i) => ({
        name: d.account,
        value: Math.round(Math.abs(d.marginalVol) * 100) / 100,
        itemStyle: { color: COLORS[i % COLORS.length] },
      })),
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 12, fontWeight: "bold" } },
    })
    const posTotal = pos.reduce((s, d) => s + Math.abs(d.marginalVol), 0)
    const negTotal = neg.reduce((s, d) => s + Math.abs(d.marginalVol), 0)
    return {
      tooltip: {
        trigger: "item",
        formatter: (p: { seriesName: string; name: string; value: number; percent: number }) =>
          `${p.seriesName}<br/>${p.name}<br/>边际波动率：${p.value.toFixed(2)}%<br/>占比：${p.percent.toFixed(1)}%`,
      },
      legend: { show: false },
      graphic: [
        { type: "text", left: "22%", top: 8, style: { text: `正向 (${pos.length}账户)`, fontSize: 11, fill: "#888", textAlign: "center" } },
        { type: "text", left: "72%", top: 8, style: { text: `负向 (${neg.length}账户)`, fontSize: 11, fill: "#888", textAlign: "center" } },
        posTotal > 0 ? { type: "text", left: "22%", bottom: 8, style: { text: `合计 ${posTotal.toFixed(1)}%`, fontSize: 11, fill: "#888", textAlign: "center" } } : null,
        negTotal > 0 ? { type: "text", left: "72%", bottom: 8, style: { text: `合计 ${negTotal.toFixed(1)}%`, fontSize: 11, fill: "#888", textAlign: "center" } } : null,
      ].filter(Boolean),
      series: [
        { ...makePie(pos, "25%"), name: "边际波动率占比正" },
        { ...makePie(neg, "75%"), name: "边际波动率占比负" },
      ],
    }
  }, [advisorMvol])

  const pnlChartOption = useMemo(() => {
    const sorted = [...advisorPnl].sort((a, b) => b.pnl - a.pnl)
    const accounts = sorted.map((d) => d.account)
    const pnls = sorted.map((d) => d.pnl)
    return {
      grid: { left: 56, right: 20, top: 16, bottom: 60 },
      xAxis: {
        type: "category",
        data: accounts,
        axisLabel: { fontSize: 11, rotate: 45, interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "盈亏 (元)",
        nameLocation: "end",
        nameTextStyle: { fontSize: 11 },
        axisLabel: {
          fontSize: 11,
          formatter: (v: number) => v >= 10000 || v <= -10000 ? `${(v / 10000).toFixed(1)}万` : `${v}`,
        },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params?.[0]
          if (!p) return ""
          const val = p.value ?? 0
          const display = Math.abs(val) >= 10000
            ? `${(val / 10000).toFixed(2)} 万元`
            : `${val.toLocaleString("zh-CN")} 元`
          return `${p.name}<br/>盈亏：${display}`
        },
      },
      series: [{
        type: "bar",
        data: pnls,
        barMaxWidth: 28,
        itemStyle: {
          color: (params: { dataIndex: number }) => pnls[params.dataIndex] >= 0 ? "#ef4444" : "#22c55e",
        },
        label: { show: false },
      }],
    }
  }, [advisorPnl])

  const pnlHistChartOption = useMemo(() => {
    if (advisorPnl.length === 0) return {}
    const pnls = advisorPnl.map((d) => d.pnl)
    const minVal = Math.min(...pnls)
    const maxVal = Math.max(...pnls)
    const range = maxVal - minVal || 1
    const BIN_COUNT = Math.min(10, advisorPnl.length)
    const binSize = range / BIN_COUNT
    const bins: { label: string; count: number; profit: boolean }[] = []
    for (let i = 0; i < BIN_COUNT; i++) {
      const lo = minVal + i * binSize
      const hi = lo + binSize
      const count = pnls.filter((v) => i === BIN_COUNT - 1 ? v >= lo && v <= hi : v >= lo && v < hi).length
      const mid = (lo + hi) / 2
      const fmt = (v: number) => Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${Math.round(v)}`
      bins.push({ label: `${fmt(lo)}~${fmt(hi)}`, count, profit: mid >= 0 })
    }
    return {
      grid: { left: 36, right: 20, top: 16, bottom: 80 },
      xAxis: {
        type: "category",
        data: bins.map((b) => b.label),
        axisLabel: { fontSize: 10, rotate: 40, interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "账户数",
        nameLocation: "end",
        nameTextStyle: { fontSize: 11 },
        minInterval: 1,
        axisLabel: { fontSize: 11 },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.3 } },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params?.[0]; if (!p) return ""
          return `${p.name}<br/>账户数：${p.value}`
        },
      },
      series: [{
        type: "bar",
        data: bins.map((b) => b.count),
        barMaxWidth: 40,
        itemStyle: {
          color: (params: { dataIndex: number }) => bins[params.dataIndex].profit ? "#ef4444" : "#22c55e",
        },
        label: { show: true, position: "top", fontSize: 11,
          formatter: (p: { value: number }) => p.value > 0 ? String(p.value) : "",
        },
      }],
    }
  }, [advisorPnl])

  return (
    <div className="space-y-6">
      <div id="section-advisor-daily" className="flex items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">当日分析</h2>
        <div className="flex-1 border-t border-border" />
      </div>

      {/* charts row */}
      <div className="flex gap-4">
        {/* 投顾年化波动率排序 */}
        <Card className="flex-1">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-medium">投顾年化波动率排序</CardTitle>
            <select
              value={volWindow}
              onChange={(e) => { setVolWindow(e.target.value); fetchAdvisorVol(e.target.value) }}
              className="rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="5">近 5 日</option>
              <option value="10">近 10 日</option>
              <option value="20">近 20 日</option>
            </select>
          </CardHeader>
          <CardContent>
            {volLoading ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : volError ? (
              <div className="flex h-48 items-center justify-center text-sm text-destructive px-4 text-center">{volError}</div>
            ) : advisorVol.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            ) : (
              <ReactECharts key={`vol-${volWindow}-${advisorVol.length}`} option={volChartOption} style={{ height: 320 }} />
            )}
          </CardContent>
        </Card>

        {/* 投顾年化波动率当日占比 */}
        <Card className="flex-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">投顾年化波动率当日占比</CardTitle>
          </CardHeader>
          <CardContent>
            {volLoading ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : volError ? (
              <div className="flex h-48 items-center justify-center text-sm text-destructive px-4 text-center">{volError}</div>
            ) : advisorVol.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            ) : (
              <ReactECharts key={`pie-${volWindow}-${advisorVol.length}`} option={pieChartOption} style={{ height: 320 }} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* 投顾边际波动率排序 */}
      <div className="flex gap-4">
        <Card className="flex-1">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-medium">投顾边际波动率排序</CardTitle>
            <select
              value={mvolWindow}
              onChange={(e) => { setMvolWindow(e.target.value); fetchAdvisorMvol(e.target.value); fetchAdvisorMvolChange(e.target.value, mvolCompare) }}
              className="rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="5">近 5 日</option>
              <option value="10">近 10 日</option>
              <option value="20">近 20 日</option>
            </select>
          </CardHeader>
          <CardContent>
            {mvolLoading ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : mvolError ? (
              <div className="flex h-48 items-center justify-center text-sm text-destructive px-4 text-center">{mvolError}</div>
            ) : advisorMvol.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            ) : (
              <ReactECharts key={`mvol-${mvolWindow}-${advisorMvol.length}`} option={mvolChartOption} style={{ height: 320 }} />
            )}
          </CardContent>
        </Card>
        {/* 投顾边际波动率变化排序 */}
        <Card className="flex-1">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-medium">
              {mvolChangePieView ? "投顾边际波动率占比" : "投顾边际波动率变化排序"}
            </CardTitle>
            <div className="flex items-center gap-2">
              {!mvolChangePieView && (<>
                <select
                  value={mvolWindow}
                  onChange={(e) => { setMvolWindow(e.target.value); fetchAdvisorMvol(e.target.value); fetchAdvisorMvolChange(e.target.value, mvolCompare) }}
                  className="rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="5">近 5 日</option>
                  <option value="10">近 10 日</option>
                  <option value="20">近 20 日</option>
                </select>
                <select
                  value={mvolCompare}
                  onChange={(e) => { setMvolCompare(e.target.value); fetchAdvisorMvolChange(mvolWindow, e.target.value) }}
                  className="rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="1">日变化</option>
                  <option value="5">周变化</option>
                  <option value="20">月变化</option>
                  <option value="252">年变化</option>
                </select>
              </>)}
              <button
                onClick={() => setMvolChangePieView((v) => !v)}
                className="rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm hover:bg-muted transition-colors"
              >
                {mvolChangePieView ? "变化排序" : "占比饼图"}
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {mvolChangePieView ? (
              mvolLoading ? (
                <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">加载中…</div>
              ) : mvolError ? (
                <div className="flex h-48 items-center justify-center text-sm text-destructive px-4 text-center">{mvolError}</div>
              ) : advisorMvol.length === 0 ? (
                <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
              ) : (
                <ReactECharts key={`mvolpie-${mvolWindow}-${advisorMvol.length}`} option={mvolChangePieOption} style={{ height: 320 }} />
              )
            ) : (
              mvolChangeLoading ? (
                <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">加载中…</div>
              ) : mvolChangeError ? (
                <div className="flex h-48 items-center justify-center text-sm text-destructive px-4 text-center">{mvolChangeError}</div>
              ) : advisorMvolChange.length === 0 ? (
                <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
              ) : (
                <ReactECharts key={`mvolchange-${mvolWindow}-${mvolCompare}-${advisorMvolChange.length}`} option={mvolChangeChartOption} style={{ height: 320 }} />
              )
            )}
          </CardContent>
        </Card>
      </div>

      {/* 投顾盈亏情况排序 */}
      <div className="flex gap-4">
        <Card className="flex-1">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-medium">投顾盈亏情况排序</CardTitle>
            <select
              value={pnlWindow}
              onChange={(e) => { setPnlWindow(e.target.value); fetchAdvisorPnl(e.target.value) }}
              className="rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="5">近 5 日</option>
              <option value="10">近 10 日</option>
              <option value="20">近 20 日</option>
            </select>
          </CardHeader>
          <CardContent>
            {pnlLoading ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : pnlError ? (
              <div className="flex h-48 items-center justify-center text-sm text-destructive px-4 text-center">{pnlError}</div>
            ) : advisorPnl.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            ) : (
              <ReactECharts key={`pnl-${pnlWindow}-${advisorPnl.length}`} option={pnlChartOption} style={{ height: 320 }} />
            )}
          </CardContent>
        </Card>
        {/* 投顾盈亏分布直方图 */}
        <Card className="flex-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">投顾盈亏分布直方图</CardTitle>
          </CardHeader>
          <CardContent>
            {pnlLoading ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">加载中…</div>
            ) : pnlError ? (
              <div className="flex h-48 items-center justify-center text-sm text-destructive px-4 text-center">{pnlError}</div>
            ) : advisorPnl.length === 0 ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            ) : (
              <ReactECharts key={`pnlhist-${pnlWindow}-${advisorPnl.length}`} option={pnlHistChartOption} style={{ height: 320 }} />
            )}
          </CardContent>
        </Card>
      </div>

      <div id="section-advisor-history" className="flex items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">历史回溯</h2>
        <div className="flex-1 border-t border-border" />
      </div>

      <AdvisorEquityCurveChart height={400} />

      <div id="section-advisor-optimize" className="flex items-center gap-3 mt-4">
        <h2 className="text-lg font-semibold tracking-tight">投顾优化</h2>
        <div className="flex-1 border-t border-border" />
      </div>

      <div className="flex gap-4 items-stretch">
        <div className="w-1/2 flex flex-col">
          <AdvisorVolCorrScatter height={380} />
        </div>
        <div className="w-1/2 flex flex-col">
          <AdvisorCorrTimeseries height={380} />
        </div>
      </div>

      <div className="mt-4 flex gap-4 items-stretch">
        <div className="w-1/2 flex flex-col">
          <AdvisorRiskReturnScatter height={420} />
        </div>
        <div className="w-1/2 flex flex-col">
          <AdvisorMaxSharpeWeights height={420} />
        </div>
      </div>

      <div className="mt-4 flex gap-4 items-stretch">
        <div className="w-1/2 flex flex-col">
          <AdvisorCapitalEfficiency height={480} />
        </div>
        <div className="w-1/2 flex flex-col">
          <AdvisorReallocation height={480} />
        </div>
      </div>

      <div className="mt-4 flex gap-4 items-stretch">
        <div className="w-1/2 flex flex-col">
          <AdvisorSectorLeverageHeatmap height={320} />
        </div>
        <div className="w-1/2 flex flex-col">
          <AdvisorSectorExposureStack height={320} />
        </div>
      </div>
    </div>
  )
}

function OverviewContent() {
  return (
    <div className="space-y-4">
      <div className="w-full">
        <ProductNavChart height={380} />
      </div>
    </div>
  )
}

const PROD_CAT: Record<string, string> = {
  C:"商品",CS:"商品",WH:"商品",PM:"商品",RR:"商品",RI:"商品",JR:"商品",LR:"商品",
  A:"商品",B:"商品",M:"商品",Y:"商品",RM:"商品",OI:"商品",RS:"商品",PK:"商品",P:"商品",
  SR:"商品",CF:"商品",CY:"商品",LG:"商品",SP:"商品",OP:"商品",
  AP:"商品",CJ:"商品",LH:"商品",JD:"商品",
  AU:"商品",AG:"商品",PT:"商品",PD:"商品",
  CU:"商品",BC:"商品",AL:"商品",AO:"商品",AD:"商品",ZN:"商品",PB:"商品",NI:"商品",SN:"商品",
  LC:"商品",PS:"商品",SI:"商品",
  I:"商品",SF:"商品",SM:"商品",RB:"商品",HC:"商品",SS:"商品",WR:"商品",
  JM:"商品",J:"商品",ZC:"商品",FG:"商品",BB:"商品",FB:"商品",
  SC:"商品",FU:"商品",LU:"商品",PG:"商品",BU:"商品",
  TA:"商品",EG:"商品",PF:"商品",PR:"商品",PL:"商品",PP:"商品",L:"商品",
  BZ:"商品",PX:"商品",EB:"商品",
  RU:"商品",BR:"商品",NR:"商品",
  SA:"商品",SH:"商品",V:"商品",UR:"商品",MA:"商品",
  EC:"商品",
  IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
  TS:"国债",TF:"国债",T:"国债",TL:"国债",
}
const PROD_SECTOR: Record<string, string> = {
  C:"农产",CS:"农产",WH:"农产",PM:"农产",RR:"农产",RI:"农产",JR:"农产",LR:"农产",
  A:"农产",B:"农产",M:"农产",Y:"农产",RM:"农产",OI:"农产",RS:"农产",PK:"农产",P:"农产",
  SR:"农产",CF:"农产",CY:"农产",LG:"农产",SP:"农产",OP:"农产",
  AP:"生鲜",CJ:"生鲜",LH:"生鲜",JD:"生鲜",
  AU:"贵金属",AG:"贵金属",PT:"贵金属",PD:"贵金属",
  CU:"有色",BC:"有色",AL:"有色",AO:"有色",AD:"有色",ZN:"有色",PB:"有色",NI:"有色",SN:"有色",
  LC:"新能源",PS:"新能源",SI:"新能源",
  I:"黑色",SF:"黑色",SM:"黑色",RB:"黑色",HC:"黑色",SS:"黑色",WR:"黑色",
  JM:"黑色",J:"黑色",ZC:"黑色",FG:"黑色",BB:"黑色",FB:"黑色",
  SC:"能源化工",FU:"能源化工",LU:"能源化工",PG:"能源化工",BU:"能源化工",
  TA:"能源化工",EG:"能源化工",PF:"能源化工",PR:"能源化工",PL:"能源化工",PP:"能源化工",L:"能源化工",
  BZ:"能源化工",PX:"能源化工",EB:"能源化工",
  RU:"能源化工",BR:"能源化工",NR:"能源化工",
  SA:"能源化工",SH:"能源化工",V:"能源化工",UR:"能源化工",MA:"能源化工",
  EC:"航运",
  IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
  TS:"国债",TF:"国债",T:"国债",TL:"国债",
}
const PROD_SUB_SECTOR: Record<string, string> = {
  C:"谷物",CS:"谷物",WH:"谷物",PM:"谷物",RR:"谷物",RI:"谷物",JR:"谷物",LR:"谷物",
  A:"油脂油料",B:"油脂油料",M:"油脂油料",Y:"油脂油料",RM:"油脂油料",OI:"油脂油料",RS:"油脂油料",PK:"油脂油料",P:"油脂油料",
  SR:"软商品",CF:"软商品",CY:"软商品",
  LG:"林业",SP:"林业",OP:"林业",
  AP:"生鲜",CJ:"生鲜",LH:"生鲜",JD:"生鲜",
  AU:"贵金属",AG:"贵金属",PT:"贵金属",PD:"贵金属",
  CU:"有色",BC:"有色",AL:"有色",AO:"有色",AD:"有色",ZN:"有色",PB:"有色",NI:"有色",SN:"有色",
  LC:"新能源",PS:"新能源",SI:"新能源",
  I:"原材",SF:"原材",SM:"原材",
  RB:"成材",HC:"成材",SS:"成材",WR:"成材",
  JM:"煤炭",J:"煤炭",ZC:"煤炭",
  FG:"建材",BB:"建材",FB:"建材",
  SC:"油品",FU:"油品",LU:"油品",PG:"油品",BU:"油品",
  TA:"聚酯",EG:"聚酯",PF:"聚酯",PR:"聚酯",
  PL:"烯烃",PP:"烯烃",L:"烯烃",
  BZ:"芳烃",PX:"芳烃",EB:"芳烃",
  RU:"橡胶",BR:"橡胶",NR:"橡胶",
  SA:"盐化工",SH:"盐化工",V:"盐化工",
  UR:"煤化工",MA:"煤化工",
  EC:"航运",
  IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
  TS:"国债",TF:"国债",T:"国债",TL:"国债",
}
const PROD_NAMES: Record<string, string> = {
  C:"玉米",CS:"淀粉",WH:"强麦",PM:"普麦",RR:"粳米",RI:"早籼稻",JR:"粳稻",LR:"晚籼稻",
  A:"黄大豆1号",B:"黄大豆2号",M:"豆粕",Y:"豆油",RM:"菜籽粕",OI:"菜籽油",RS:"油菜籽",PK:"花生",P:"棕榈油",
  SR:"白糖",CF:"棉花",CY:"棉纱",LG:"原木",SP:"纸浆",OP:"双胶纸",
  AP:"苹果",CJ:"红枣",LH:"生猪",JD:"鸡蛋",
  AU:"黄金",AG:"白银",PT:"铂",PD:"钯",
  CU:"沪铜",BC:"国际铜",AL:"沪铝",AO:"氧化铝",AD:"铝合金",ZN:"沪锌",PB:"沪铅",NI:"沪镍",SN:"沪锡",
  LC:"碳酸锂",PS:"多晶硅",SI:"工业硅",
  I:"铁矿石",SF:"硅铁",SM:"锰硅",RB:"螺纹钢",HC:"热卷",SS:"不锈钢",WR:"线材",
  JM:"焦煤",J:"煤炭",ZC:"动力煤",FG:"玻璃",BB:"胶合板",FB:"纤维板",
  SC:"原油",FU:"燃料油",LU:"低硫燃料油",PG:"液化石油气",BU:"沥青",
  TA:"PTA",EG:"乙二醇",PF:"短纤",PR:"瓶片",PL:"丙烯",PP:"聚丙烯",L:"塑料",
  BZ:"纯苯",PX:"对二甲苯",EB:"苯乙烯",
  RU:"天然橡胶",BR:"丁二烯橡胶",NR:"20号胶",
  SA:"纯碱",SH:"烧碱",V:"PVC",UR:"尿素",MA:"甲醇",
  EC:"航运指数",
  IH:"上证50",IF:"沪深300",IC:"中证500",IM:"中证1000",MO:"中证1000期权",
  TS:"2年期国债",TF:"5年期国债",T:"10年期国债",TL:"30年期国债",
}

// ── VaR Sandbox ──────────────────────────────────────────────────────────────
function VarSandboxContent() {
  type SbProd = { prod: string; mv: number; lots: number; sigma: number; lotMv: number }

  const [sbDate, setSbDate]           = useState("")
  const [sbProds, setSbProds]         = useState<SbProd[]>([])
  const [sbOrigProds, setSbOrigProds] = useState<SbProd[]>([])
  const [sbCorrMatrix, setSbCorrMatrix] = useState<number[][]>([])
  const [sbZScore, setSbZScore]       = useState(1.6449)
  const [sbConfidence, setSbConfidence] = useState("95")
  const [sbNetCapital, setSbNetCapital] = useState(0)
  const [sbLoading, setSbLoading]     = useState(true)
  const [sbSearchInput, setSbSearchInput] = useState("")
  const [sbSearch, setSbSearch]       = useState("")
  const [sbSort, setSbSort]           = useState("mv_abs")
  const [sbCatFilter, setSbCatFilter] = useState("全部")
  const [sbSectorFilter, setSbSectorFilter] = useState("全部")
  const [sbDirFilter, setSbDirFilter] = useState("全部")

  useEffect(() => {
    let doneCount = 0
    const maybeFinish = () => { if (++doneCount >= 2) setSbLoading(false) }

    fetch("/ma/api/mom-analysis/var-sandbox").then(r => r.json()).then(j => {
      if (j.ok && j.products?.length > 0) {
        setSbDate(j.date ?? "")
        setSbProds(j.products)
        setSbOrigProds(j.products.map((p: SbProd) => ({ ...p })))
        setSbCorrMatrix(j.corrMatrix ?? [])
        setSbZScore(j.zScore ?? 1.6449)
        setSbConfidence(j.confidence ?? "95")
      }
    }).catch(() => {}).finally(maybeFinish)

    fetch("/ma/api/mom-analysis/product-nav").then(r => r.json()).then(navJ => {
      const navData: { cumCapital?: number }[] = navJ.data ?? []
      if (navData.length > 0) {
        setSbNetCapital(navData[navData.length - 1].cumCapital ?? 0)
      }
    }).catch(() => {}).finally(maybeFinish)
  }, [])

  const updateMv = useCallback((prod: string, newMv: number) => {
    setSbProds(prev => prev.map(p => {
      if (p.prod !== prod) return p
      const lots = p.lotMv > 0 ? Math.round(newMv / p.lotMv) : p.lots
      return { ...p, mv: newMv, lots }
    }))
  }, [])

  const updateLots = (prod: string, newLots: number) => {
    setSbProds(prev => prev.map(p => {
      if (p.prod !== prod) return p
      return { ...p, lots: newLots, mv: Math.round(newLots * p.lotMv) }
    }))
  }

  // stable scale from original positions — never changes during drag so other bars stay fixed
  const origMvMap = useMemo(() => new Map(sbOrigProds.map(p => [p.prod, p.mv])), [sbOrigProds])

  const origMaxAbsMv = useMemo(() => Math.max(...sbOrigProds.map(p => Math.abs(p.mv)), 1), [sbOrigProds])

  const sbListRef = useRef<HTMLDivElement>(null)
  const fsRef = useRef<HTMLDivElement>(null)
  const [isFs, setIsFs] = useState(false)
  const barDragRef = useRef<{ prod: string; startX: number; startMv: number; lotMv: number; halfW: number } | null>(null)

  useEffect(() => {
    const onFsChange = () => setIsFs(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onFsChange)
    return () => document.removeEventListener("fullscreenchange", onFsChange)
  }, [])

  const toggleFs = () => {
    if (!isFs) fsRef.current?.requestFullscreen()
    else document.exitFullscreen()
  }

  // Stable display order from original positions — never changes during drag
  const displayOrder = useMemo(() => {
    const filtered = sbOrigProds.filter(p => {
      if (sbCatFilter !== "全部" && PROD_CAT[p.prod] !== sbCatFilter) return false
      if (sbSectorFilter !== "全部" && PROD_SECTOR[p.prod] !== sbSectorFilter) return false
      if (sbDirFilter === "多" && p.mv <= 0) return false
      if (sbDirFilter === "空" && p.mv >= 0) return false
      return true
    })
    const sorted = [...filtered]
    if      (sbSort === "mv_abs") sorted.sort((a, b) => Math.abs(b.mv) - Math.abs(a.mv))
    else if (sbSort === "mv")     sorted.sort((a, b) => b.mv - a.mv)
    else if (sbSort === "sigma")  sorted.sort((a, b) => b.sigma - a.sigma)
    else if (sbSort === "prod")   sorted.sort((a, b) => a.prod.localeCompare(b.prod))
    else if (sbSort === "marginal") {
      // Marginal vol contribution: |dv_i * Σ_j(dv_j * corr_ij)|
      const origIdx = new Map(sbOrigProds.map((p, i) => [p.prod, i]))
      const allDv = sbOrigProds.map(p => p.sigma * p.mv)
      const mcrMap = new Map<string, number>()
      for (const p of sorted) {
        const i = origIdx.get(p.prod)!
        let covSum = 0
        for (let j = 0; j < allDv.length; j++) covSum += allDv[j] * (sbCorrMatrix[i]?.[j] ?? 0)
        mcrMap.set(p.prod, Math.abs(allDv[i] * covSum))
      }
      sorted.sort((a, b) => (mcrMap.get(b.prod) ?? 0) - (mcrMap.get(a.prod) ?? 0))
    }
    return sorted.map(p => p.prod)
  }, [sbOrigProds, sbCorrMatrix, sbCatFilter, sbSectorFilter, sbDirFilter, sbSort])

  // Map stable order to current (possibly dragged) values
  const displayProds = useMemo(() => {
    const prodMap = new Map(sbProds.map(p => [p.prod, p]))
    return displayOrder.map(code => prodMap.get(code)!).filter(Boolean)
  }, [sbProds, displayOrder])

  const sandboxVaR = useMemo(() => {
    if (displayProds.length === 0 || sbCorrMatrix.length < sbProds.length) return 0
    const fullIdx = new Map(sbProds.map((p, i) => [p.prod, i]))
    const indices = displayProds.map(p => fullIdx.get(p.prod)!)
    const dv = displayProds.map(p => p.sigma * p.mv)
    const M = indices.length
    let portVar = 0
    for (let a = 0; a < M; a++) {
      if (dv[a] === 0) continue
      for (let b = 0; b < M; b++) {
        if (dv[b] === 0) continue
        portVar += dv[a] * dv[b] * (sbCorrMatrix[indices[a]]?.[indices[b]] ?? 0)
      }
    }
    return portVar > 0 ? Math.round(sbZScore * Math.sqrt(portVar)) : 0
  }, [sbProds, displayProds, sbCorrMatrix, sbZScore])

  const totalNetMv = useMemo(() => displayProds.reduce((s, p) => s + p.mv, 0), [displayProds])

  // Marginal vol contribution per product: |dv_i * Σ_j(dv_j * corr_ij)|
  // Uses displayProds so it responds to 类别/板块/方向 filters
  const prodMcrData = useMemo(() => {
    if (displayProds.length === 0 || sbCorrMatrix.length < sbProds.length) return []
    const fullIdx = new Map(sbProds.map((p, i) => [p.prod, i]))
    const dv = sbProds.map(p => p.sigma * p.mv)
    return displayProds.map(p => {
      const i = fullIdx.get(p.prod)!
      let covSum = 0
      for (let j = 0; j < dv.length; j++) covSum += dv[j] * (sbCorrMatrix[i]?.[j] ?? 0)
      return { name: p.prod, value: Math.abs(dv[i] * covSum) }
    }).filter(d => d.value > 0).sort((a, b) => b.value - a.value)
  }, [sbProds, displayProds, sbCorrMatrix])

  // Marginal vol contribution per sector
  const sectorMcrData = useMemo(() => {
    const sectorMap = new Map<string, number>()
    for (const { name, value } of prodMcrData) {
      const sector = PROD_SECTOR[name] ?? "其他"
      sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + value)
    }
    return Array.from(sectorMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [prodMcrData])

  const handleDragMove = useCallback((e: PointerEvent) => {
    const drag = barDragRef.current
    if (!drag) return
    e.preventDefault()
    const deltaMv = ((e.clientX - drag.startX) / drag.halfW) * origMaxAbsMv
    const raw     = drag.startMv + deltaMv
    const snapped = drag.lotMv > 0 ? Math.round(raw / drag.lotMv) * drag.lotMv : Math.round(raw)
    updateMv(drag.prod, snapped)
  }, [origMaxAbsMv, updateMv])

  const handleDragEnd = useCallback(() => {
    barDragRef.current = null
    document.body.style.cursor = ""
    window.removeEventListener("pointermove", handleDragMove)
    window.removeEventListener("pointerup", handleDragEnd)
  }, [handleDragMove])

  const onBarPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, prod: string, mv: number, lotMv: number) => {
    e.preventDefault()
    // The circle is inside the bar container; walk up to get bar width
    const barEl = e.currentTarget.parentElement!
    const rect = barEl.getBoundingClientRect()
    const halfW = rect.width * 0.47
    if (halfW < 1) return
    barDragRef.current = { prod, startX: e.clientX, startMv: mv, lotMv, halfW }
    document.body.style.cursor = "grabbing"
    window.addEventListener("pointermove", handleDragMove)
    window.addEventListener("pointerup", handleDragEnd)
  }, [handleDragMove, handleDragEnd])

  // Cleanup drag listeners on unmount
  useEffect(() => () => {
    window.removeEventListener("pointermove", handleDragMove)
    window.removeEventListener("pointerup", handleDragEnd)
  }, [handleDragMove, handleDragEnd])

  const doSearch = (code: string) => {
    setSbSearch(code)
    if (!code) return
    // find matching element inside the scrollable list and scroll to it
    const el = sbListRef.current?.querySelector<HTMLElement>(`[data-prod="${code}"]`)
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  const sbAvailSectors = useMemo(() =>
    ["全部", ...Array.from(new Set(sbProds.map(p => PROD_SECTOR[p.prod]).filter(Boolean)))],
    [sbProds]
  )

  if (sbLoading) {
    return (
      <section>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          VaR 沙盒
          <span className="h-px flex-1 bg-border" />
        </h2>
        <p className="text-sm text-muted-foreground">加载中...</p>
      </section>
    )
  }
  if (sbProds.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          VaR 沙盒
          <span className="h-px flex-1 bg-border" />
        </h2>
        <p className="text-sm text-muted-foreground">暂无持仓数据</p>
      </section>
    )
  }

  return (
    <div ref={fsRef} className={`flex gap-4 items-stretch${isFs ? " bg-background p-4 overflow-auto" : ""}`}>
      {/* Left: sandbox card */}
      <div className="flex-1 min-w-0">
      <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">VaR沙盒 &mdash; {sbDate}</CardTitle>
          <button
            onClick={toggleFs}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors shrink-0"
            title={isFs ? "退出全屏" : "全屏"}
          >{isFs ? "✕ 退出全屏" : "⛶ 全屏"}</button>
        </div>
        <p className="text-xs text-muted-foreground">
          搜索定位品种使用滑块或数值输入调整持仓，VaR实时更新。
        </p>
      </CardHeader>
      <CardContent>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input
          className="text-xs border rounded px-2 py-1 bg-background w-44"
          placeholder="输入品种代码（如 CU）"
          value={sbSearchInput}
          onChange={e => setSbSearchInput(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === "Enter") doSearch(sbSearchInput) }}
        />
        <button
          className="text-xs px-2.5 py-1 rounded border border-border hover:bg-muted transition-colors"
          onClick={() => doSearch(sbSearchInput)}
        >搜索</button>
        <button
          className="text-xs px-2.5 py-1 rounded border border-border hover:bg-muted transition-colors"
          onClick={() => {
            setSbProds(sbOrigProds.map(p => ({ ...p })))
            setSbSearch("")
            setSbSearchInput("")
            setSbCatFilter("全部")
            setSbSectorFilter("全部")
            setSbDirFilter("全部")
          }}
        >重置为默认</button>
        <span className="text-xs text-muted-foreground ml-1">排序：</span>
        <select
          className="text-xs border rounded px-1 py-0.5 bg-background"
          value={sbSort}
          onChange={e => setSbSort(e.target.value)}
        >
          <option value="mv_abs">按持仓净市值</option>
          <option value="mv">按市值（多先）</option>
          <option value="sigma">按波动率</option>
          <option value="prod">按品种代码</option>
          <option value="marginal">按边际波动贡献</option>
        </select>
        <span className="text-xs text-muted-foreground">类别：</span>
        <select
          className="text-xs border rounded px-1 py-0.5 bg-background"
          value={sbCatFilter}
          onChange={e => { setSbCatFilter(e.target.value); setSbSectorFilter("全部") }}
        >
          <option value="全部">全部</option>
          {["商品", "股指", "国债"].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">板块：</span>
        <select
          className="text-xs border rounded px-1 py-0.5 bg-background"
          value={sbSectorFilter}
          onChange={e => setSbSectorFilter(e.target.value)}
        >
          {sbAvailSectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">方向：</span>
        <select
          className="text-xs border rounded px-1 py-0.5 bg-background"
          value={sbDirFilter}
          onChange={e => setSbDirFilter(e.target.value)}
        >
          <option value="全部">全部</option>
          <option value="多">多</option>
          <option value="空">空</option>
        </select>
      </div>

      {/* Product list */}
      <div ref={sbListRef} className="border rounded-lg bg-card overflow-y-auto" style={{ maxHeight: 520 }}>
        {displayProds.map((p, vi) => {
          // Always use origMaxAbsMv for scale — stable, never changes during drag
          const pct    = Math.min(Math.abs(p.mv) / origMaxAbsMv, 1)
          const isLong = p.mv >= 0
          const cn     = PROD_NAMES[p.prod] ?? ""
          const origMv = origMvMap.get(p.prod) ?? p.mv
          const step   = Math.max(Math.round(Math.abs(origMv) / 10), 1)
          return (
            <div
              key={p.prod}
              data-prod={p.prod}
              className={`flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0 transition-colors ${
                sbSearch && p.prod === sbSearch
                  ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
                  : vi % 2 === 0 ? "" : "bg-muted/20"
              }`}
            >
              {/* Label */}
              <div className="w-52 shrink-0 text-xs leading-tight">
                <span className="text-muted-foreground text-[10px]">{String(vi + 1).padStart(2, "0")}品种：</span>
                <span className="font-semibold">{p.prod}</span>
                {cn && <span className="text-muted-foreground">（{cn}）</span>}
              </div>

              {/* Bar visualization — draggable */}
              <div
                className="flex-1 relative h-6 min-w-0 select-none"
                style={{ touchAction: "none" }}
              >
                {/* Center line */}
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border/60 z-10" />
                {/* Long bar */}
                {p.mv > 0 && (
                  <div
                    className="absolute rounded-r pointer-events-none"
                    style={{ left: "50%", width: `${pct * 47}%`, top: "30%", bottom: "30%", backgroundColor: "#60a5fa" }}
                  />
                )}
                {/* Short bar */}
                {p.mv < 0 && (
                  <div
                    className="absolute rounded-l pointer-events-none"
                    style={{ right: "50%", width: `${pct * 47}%`, top: "30%", bottom: "30%", backgroundColor: "#f87171" }}
                  />
                )}
                {/* Circle at bar end */}
                {p.mv !== 0 && (
                  <div
                    className="absolute w-3 h-3 rounded-full border-2 bg-card z-20"
                    style={{
                      cursor: "grab",
                      borderColor: isLong ? "#60a5fa" : "#f87171",
                      top: "50%",
                      transform: "translateY(-50%)",
                      ...(isLong
                        ? { left:  `calc(50% + ${pct * 47}% - 6px)` }
                        : { right: `calc(50% + ${pct * 47}% - 6px)` }
                      ),
                    }}
                    onPointerDown={e => onBarPointerDown(e, p.prod, p.mv, p.lotMv)}
                  />
                )}
              </div>

              {/* MV input + ─ / + */}
              <input
                type="text"
                inputMode="numeric"
                className="text-xs border rounded px-1 py-0.5 w-28 text-right bg-background font-mono shrink-0"
                value={p.mv.toLocaleString("zh-CN")}
                onChange={e => updateMv(p.prod, parseInt(e.target.value.replace(/,/g, ""), 10) || 0)}
              />
              <button
                className="text-xs w-5 h-5 rounded border border-border hover:bg-muted flex items-center justify-center shrink-0"
                onClick={() => updateMv(p.prod, p.mv - step)}
              >−</button>
              <button
                className="text-xs w-5 h-5 rounded border border-border hover:bg-muted flex items-center justify-center shrink-0"
                onClick={() => updateMv(p.prod, p.mv + step)}
              >+</button>

              {/* Lots input + ─ / + */}
              <span className="text-xs text-muted-foreground shrink-0">手数：</span>
              <input
                type="number"
                className="text-xs border rounded px-1 py-0.5 w-16 text-right bg-background font-mono shrink-0"
                value={p.lots}
                onChange={e => updateLots(p.prod, parseInt(e.target.value, 10) || 0)}
              />
              <button
                className="text-xs w-5 h-5 rounded border border-border hover:bg-muted flex items-center justify-center shrink-0"
                onClick={() => updateLots(p.prod, p.lots - 1)}
              >−</button>
              <button
                className="text-xs w-5 h-5 rounded border border-border hover:bg-muted flex items-center justify-center shrink-0"
                onClick={() => updateLots(p.prod, p.lots + 1)}
              >+</button>
            </div>
          )
        })}
      </div>

      {/* Summary footer */}
      <div className="mt-3 text-sm space-y-1">
        <div className="text-muted-foreground text-xs">
          组合净市值：<span className="font-mono font-medium text-foreground">{totalNetMv.toLocaleString("zh-CN")}</span>
        </div>
        <div className="text-muted-foreground text-xs">
          1日VaR（置信度=0.{sbConfidence}，z={sbZScore.toFixed(4)}）：
          <span className="font-mono font-semibold text-orange-500 ml-1">
            {sandboxVaR.toLocaleString("zh-CN")}
          </span>
        </div>
        {sbNetCapital > 0 && (
          <div className="text-muted-foreground text-xs">
            VaR占组合累计净资本比例（累计净资本：{sbNetCapital.toLocaleString("zh-CN")}）：
            <span className="font-mono font-medium text-foreground ml-1">
              {(sandboxVaR / sbNetCapital * 100).toFixed(2)}%
            </span>
          </div>
        )}
      </div>
      </CardContent>
    </Card>
    </div>{/* end left */}

      {/* Right: two pie charts stacked */}
      <div className="w-[460px] shrink-0 flex flex-col gap-4">
        <Card className="flex-1">
          <CardContent className="p-3 pb-2">
            <ReactECharts
              option={{
                color: ['#5470c6','#91cc75','#fac858','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc','#48b0f1','#70d9a2','#f7a35c','#a0d8ef','#c9b4d4','#7cb5ec','#f4a460','#e4d354','#2b908f','#b0c4de','#7798bf','#aaeeee','#d4e157','#ffb74d','#80cbc4','#ce93d8','#80deea'],
                title: { text: "品种边际波动贡献占比(%)（沙盒持仓）", textStyle: { fontSize: 12, fontWeight: "bold" }, top: 0, left: 0 },
                tooltip: { trigger: "item", formatter: (p: { name: string; percent: number }) => {
                    const cn = PROD_NAMES[p.name]
                    return `${p.name}${cn ? `（${cn}）` : ""}: ${p.percent.toFixed(2)}%`
                  }
                },
                legend: {
                  type: "scroll", orient: "vertical", right: 0, top: 30, bottom: 10,
                  textStyle: { fontSize: 11 },
                  formatter: (name: string) => {
                    const total = prodMcrData.reduce((s, d) => s + d.value, 0)
                    const item = prodMcrData.find(d => d.name === name)
                    const pct = total > 0 && item ? (item.value / total * 100).toFixed(2) : "0.00"
                    const cn = PROD_NAMES[name]
                    return `${name}${cn ? `（${cn}）` : ""}, ${pct}%`
                  },
                },
                series: [{
                  type: "pie", radius: "60%", center: ["30%", "55%"],
                  label: { show: false },
                  labelLine: { show: false },
                  data: prodMcrData.map(d => d.name === "IM" ? { ...d, itemStyle: { color: "#ef4444" } } : d),
                }],
              }}
              style={{ height: 300 }}
              notMerge
            />
          </CardContent>
        </Card>
        <Card className="flex-1">
          <CardContent className="p-3 pb-2">
            <ReactECharts
              option={{
                color: ['#5470c6','#91cc75','#fac858','#ef4444','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc'],
                title: { text: "板块边际波动贡献占比(%)（沙盒持仓）", textStyle: { fontSize: 12, fontWeight: "bold" }, top: 0, left: 0 },
                tooltip: { trigger: "item", formatter: (p: { name: string; percent: number }) => `${p.name}: ${p.percent.toFixed(2)}%` },
                legend: {
                  type: "scroll", orient: "vertical", right: 0, top: 30, bottom: 10,
                  textStyle: { fontSize: 11 },
                  formatter: (name: string) => {
                    const total = sectorMcrData.reduce((s, d) => s + d.value, 0)
                    const item = sectorMcrData.find(d => d.name === name)
                    const pct = total > 0 && item ? (item.value / total * 100).toFixed(2) : "0.00"
                    return `${name}, ${pct}%`
                  },
                },
                series: [{
                  type: "pie", radius: "60%", center: ["30%", "55%"],
                  label: { show: false },
                  labelLine: { show: false },
                  data: sectorMcrData.map(d => d.name === "股指" ? { ...d, itemStyle: { color: "#ef4444" } } : d),
                }],
              }}
              style={{ height: 300 }}
              notMerge
            />
          </CardContent>
        </Card>
      </div>{/* end right */}
    </div>
  )
}

function IntradayContent() {
  const [pnlData, setPnlData] = useState<{ date: string; pnl: number }[]>([])
  const [sectorLatest, setSectorLatest] = useState<{ sector: string; pnl: number }[]>([])
  const [prodLatest, setProdLatest] = useState<{ key: string; pnl: number }[]>([])
  const [accountLatest, setAccountLatest] = useState<{ account: string; pnl: number }[]>([])
  const [sectorView, setSectorView] = useState<"total" | "ls">("total")
  const [sectorLS, setSectorLS] = useState<{ sector: string; long: number; short: number }[]>([])
  const [prodView, setProdView] = useState<"total" | "ls">("total")
  const [prodLS, setProdLS] = useState<{ prod: string; long: number; short: number }[]>([])
  const [volBarData, setVolBarData] = useState<{ prod: string; sector: string; vol: number }[]>([])
  const [mvcData, setMvcData] = useState<{ prod: string; sector: string; mvc: number }[]>([])
  const [corrMatrixData, setCorrMatrixData] = useState<{ prods: string[]; data: [number, number, number][] } | null>(null)
  const [volWindow, setVolWindow] = useState("20")
  const [corrWindow, setCorrWindow] = useState("20")
  const [corrLookupA, setCorrLookupA] = useState("")
  const [corrLookupB, setCorrLookupB] = useState("")
  const [varData, setVarData] = useState<{ date: string; var: number; actual: number }[]>([])
  const [varBreachRate, setVarBreachRate] = useState<number | null>(null)
  const [varLoading, setVarLoading] = useState(false)
  const [varConfidence, setVarConfidence] = useState("95")
  const [varVolDays, setVarVolDays] = useState("20")
  const [varCorrDays, setVarCorrDays] = useState("252")
  const [varDistModel, setVarDistModel] = useState("normal")
  const [varZoom, setVarZoom] = useState<{ start: number; end: number }>({ start: 60, end: 100 })
  const [varFitView, setVarFitView] = useState<"chart" | "table">("chart")
  type OptResult = {
    confidence: string; volDays: number; corrDays: number; distModel: string
    N: number; breaches: number; breachRate: number; expectedRate: number
    kupiecLR: number; ccLR: number; kupiecPass: boolean; ccPass: boolean
    mae: number; rmse: number; avgVar: number; coverageRatio: number; score: number
  }
  const [varOptResults, setVarOptResults] = useState<OptResult[]>([])
  const [varOptLoading, setVarOptLoading] = useState(false)
  const [varOptOpen, setVarOptOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [prodCatFilter, setProdCatFilter] = useState("全部")
  const [prodSectorFilter, setProdSectorFilter] = useState("全部")
  const [prodSubSectorFilter, setProdSubSectorFilter] = useState("全部")

  type MarginTs = { date: string; margin: number; equity: number; available: number; fundNav: number | null; riskRatio: number | null; longMarginRatio: number | null; shortMarginRatio: number | null }
  type MarginAcct = { account: string; series: MarginTs[] }
  type MarginLatest = { account: string; date: string; riskRatio: number | null; margin: number; equity: number; available: number; sector: string; longMarginRatio: number | null; shortMarginRatio: number | null }
  type SectorTs = { sector: string; series: { date: string; riskRatio: number | null }[] }
  type SectorLsTs = { sector: string; series: { date: string; longMarginRatio: number | null; shortMarginRatio: number | null }[] }
  const [marginTs, setMarginTs] = useState<MarginTs[]>([])
  const [marginAccts, setMarginAccts] = useState<MarginAcct[]>([])
  const [marginLatest, setMarginLatest] = useState<MarginLatest[]>([])
  const [sectorSeries, setSectorSeries] = useState<SectorTs[]>([])
  const [sectorLsSeries, setSectorLsSeries] = useState<SectorLsTs[]>([])
  const [sectorFilter, setSectorFilter] = useState<string>("全部")
  const [acctRankFilter, setAcctRankFilter] = useState<string>("全部")
  const [marginLoading, setMarginLoading] = useState(true)

  const fetchVolBar = (window: string) => {
    fetch(`/ma/api/mom-analysis/vol-corr-scatter?window=${window}&corrWindow=${corrWindow}`)
      .then((r) => r.json())
      .then((j) => {
        const pts: { prod: string; sector: string; vol: number; mvc: number }[] = j.points ?? []
        setVolBarData([...pts].sort((a, b) => b.vol - a.vol))
        setMvcData([...pts].sort((a, b) => b.mvc - a.mvc))
        setCorrMatrixData(j.corrMatrix ?? null)
      })
      .catch(() => {})
  }

  const fetchCorrMatrix = (cw: string) => {
    fetch(`/ma/api/mom-analysis/vol-corr-scatter?window=${volWindow}&corrWindow=${cw}`)
      .then((r) => r.json())
      .then((j) => setCorrMatrixData(j.corrMatrix ?? null))
      .catch(() => {})
  }

  const fetchVar = (confidence: string, volDays: string, corrDays: string, distModel: string) => {
    setVarLoading(true)
    const params = new URLSearchParams({ confidence, volDays, corrDays, distModel })
    fetch(`/ma/api/mom-analysis/var-prediction?${params}`)
      .then((r) => r.json())
      .then((varJson) => {
        setVarData(varJson.data ?? [])
        if (varJson.breachRate != null) setVarBreachRate(varJson.breachRate)
      })
      .catch(() => {})
      .finally(() => setVarLoading(false))
  }

  useEffect(() => {
    fetch("/ma/api/mom-analysis/margin-risk")
      .then(r => r.json())
      .then(j => {
        setMarginTs(j.timeseries ?? [])
        setMarginAccts(j.accounts ?? [])
        setMarginLatest(j.latest ?? [])
        setSectorSeries(j.sectorSeries ?? [])
        setSectorLsSeries(j.sectorLsSeries ?? [])
      })
      .catch(() => {})
      .finally(() => setMarginLoading(false))
  }, [])

  useEffect(() => {
    // Fetch each endpoint independently so charts render progressively
    let doneCount = 0
    const maybeFinish = () => { if (++doneCount >= 5) setLoading(false) }

    fetch("/ma/api/mom-analysis/product-nav").then(r => r.json()).then(navJson => {
      const rows: { date: string; pnl: number }[] = (navJson.data ?? []).map(
        (r: { date: string; pnl: number }) => ({ date: r.date, pnl: r.pnl })
      )
      setPnlData(rows)
    }).catch(() => {}).finally(maybeFinish)

    fetch("/ma/api/mom-analysis/category-pnl").then(r => r.json()).then(catJson => {
      const sectorData: Record<string, { date: string; pnl: number; cumPnl: number }[]> = catJson.sectorData ?? {}
      const latest = Object.entries(sectorData)
        .map(([sector, rows]) => ({ sector, pnl: rows.length > 0 ? rows[rows.length - 1].pnl : 0 }))
        .filter((s) => s.pnl !== 0)
        .sort((a, b) => b.pnl - a.pnl)
      setSectorLatest(latest)

      const productData: Record<string, { date: string; pnl: number; cumPnl: number }[]> = catJson.productData ?? {}
      const prodList = Object.entries(productData)
        .map(([key, rows]) => ({ key, pnl: rows.length > 0 ? rows[rows.length - 1].pnl : 0 }))
        .filter((p) => p.pnl !== 0)
        .sort((a, b) => b.pnl - a.pnl)
      setProdLatest(prodList)
    }).catch(() => {}).finally(maybeFinish)

    fetch("/ma/api/mom-analysis/account-daily-pnl").then(r => r.json()).then(acctJson => {
      const accountData: Record<string, { date: string; pnl: number; cumPnl: number }[]> = acctJson.accountData ?? {}
      const acctList = Object.entries(accountData)
        .map(([account, rows]) => ({ account, pnl: rows.length > 0 ? rows[rows.length - 1].pnl : 0 }))
        .filter((a) => a.pnl !== 0)
        .sort((a, b) => b.pnl - a.pnl)
      setAccountLatest(acctList)
    }).catch(() => {}).finally(maybeFinish)

    fetch("/ma/api/mom-analysis/sector-ls-pnl").then(r => r.json()).then(lsJson => {
      const rawLS: { sector: string; long: number; short: number }[] = lsJson.sectorLS ?? []
      setSectorLS([...rawLS].sort((a, b) => (b.long + b.short) - (a.long + a.short)))

      const rawProdLS: { prod: string; long: number; short: number }[] = lsJson.productLS ?? []
      setProdLS([...rawProdLS].sort((a, b) => (b.long + b.short) - (a.long + a.short)))
    }).catch(() => {}).finally(maybeFinish)

    fetch("/ma/api/mom-analysis/vol-corr-scatter?window=20&corrWindow=20").then(r => r.json()).then(scatterJson => {
      const pts: { prod: string; sector: string; vol: number; mvc: number }[] = scatterJson.points ?? []
      setVolBarData([...pts].sort((a, b) => b.vol - a.vol))
      setMvcData([...pts].sort((a, b) => b.mvc - a.mvc))
      setCorrMatrixData(scatterJson.corrMatrix ?? null)
    }).catch(() => {}).finally(maybeFinish)

    // var-prediction is not cached — fetch separately so it doesn't block PnL rendering
    fetch(`/ma/api/mom-analysis/var-prediction?confidence=${varConfidence}&volDays=${varVolDays}&corrDays=${varCorrDays}&distModel=${varDistModel}`)
      .then((r) => r.json())
      .then((varJson) => {
        setVarData(varJson.data ?? [])
        if (varJson.breachRate != null) setVarBreachRate(varJson.breachRate)
      })
      .catch(() => {})
  }, [])

  const barOption = {
    tooltip: {
      trigger: "axis",
      formatter: (params: { name: string; value: number; marker: string }[]) =>
        params.map((p) => `${p.marker}${p.name}: ${Number(p.value).toLocaleString("zh-CN")} 元`).join("<br/>"),
    },
    grid: { left: 60, right: 20, top: 20, bottom: 50 },
    xAxis: {
      type: "category",
      data: pnlData.map((r) => r.date),
      axisLabel: { fontSize: 10, rotate: 30 },
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
    },
    dataZoom: [
      { type: "inside", start: 80, end: 100 },
      { type: "slider", height: 20, bottom: 5 },
    ],
    series: [
      {
        type: "bar",
        data: pnlData.map((r) => ({
          value: r.pnl,
          itemStyle: { color: r.pnl >= 0 ? "#ef4444" : "#22c55e" },
        })),
      },
    ],
  }

  const sectorBarOption = {
    tooltip: {
      trigger: "axis",
      formatter: (params: { name: string; value: number; marker: string }[]) =>
        params.map((p) => `${p.marker}${p.name}: ${Number(p.value).toLocaleString("zh-CN")} 元`).join("<br/>"),
    },
    grid: { left: 70, right: 20, top: 20, bottom: 60 },
    xAxis: {
      type: "category",
      data: sectorLatest.map((s) => s.sector),
      axisLabel: { fontSize: 11, rotate: 30 },
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" },
    },
    series: [
      {
        type: "bar",
        data: sectorLatest.map((s) => ({
          value: s.pnl,
          itemStyle: { color: s.pnl >= 0 ? "#ef4444" : "#22c55e" },
        })),
        label: {
          show: true,
          position: "top",
          formatter: (p: { value: number }) => (p.value / 10000).toFixed(1) + "万",
          fontSize: 10,
        },
      },
    ],
  }

  const availableSectors = ["全部", ...Array.from(new Set(
    Object.entries(PROD_SECTOR)
      .filter(([k]) => prodCatFilter === "全部" || PROD_CAT[k] === prodCatFilter)
      .map(([, v]) => v)
  ))]
  const availableSubSectors = ["全部", ...Array.from(new Set(
    Object.entries(PROD_SUB_SECTOR)
      .filter(([k]) => prodCatFilter === "全部" || PROD_CAT[k] === prodCatFilter)
      .filter(([k]) => prodSectorFilter === "全部" || PROD_SECTOR[k] === prodSectorFilter)
      .map(([, v]) => v)
  ))]
  const filteredProdLatest = prodLatest
    .filter((p) => prodCatFilter === "全部" || PROD_CAT[p.key] === prodCatFilter)
    .filter((p) => prodSectorFilter === "全部" || PROD_SECTOR[p.key] === prodSectorFilter)
    .filter((p) => prodSubSectorFilter === "全部" || PROD_SUB_SECTOR[p.key] === prodSubSectorFilter)
  const filteredProdLS = prodLS
    .filter((p) => prodCatFilter === "全部" || PROD_CAT[p.prod] === prodCatFilter)
    .filter((p) => prodSectorFilter === "全部" || PROD_SECTOR[p.prod] === prodSectorFilter)
    .filter((p) => prodSubSectorFilter === "全部" || PROD_SUB_SECTOR[p.prod] === prodSubSectorFilter)
    .sort((a, b) => (b.long + b.short) - (a.long + a.short))

  return (
    <div className="space-y-6">
      <section>
        <h2 id="section-intraday-pnl" className="text-sm font-semibold mb-3 flex items-center gap-2">
          当日盈亏
          <span className="h-px flex-1 bg-border" />
        </h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">加载中...</p>
        ) : (
          <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">组合每日盈亏</CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <ReactECharts option={barOption} style={{ height: 300 }} notMerge />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">板块当日盈亏</CardTitle>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setSectorView("total")}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${sectorView === "total" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      合计
                    </button>
                    <button
                      onClick={() => setSectorView("ls")}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${sectorView === "ls" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      多空
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                {sectorView === "total" ? (
                  <ReactECharts option={sectorBarOption} style={{ height: 300 }} notMerge />
                ) : (
                  <ReactECharts
                    option={{
                      tooltip: {
                        trigger: "axis",
                        formatter: (params: { seriesName: string; name: string; value: number; marker: string }[]) => {
                          const valid = params.filter((p) => p.seriesName === "多头" || p.seriesName === "空头")
                          const lines = valid.map((p) => `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`)
                          const net = valid.reduce((s, p) => s + Number(p.value), 0)
                          lines.push(`合计: ${net.toLocaleString("zh-CN")} 元`)
                          return [params[0]?.name, ...lines].join("<br/>")
                        },
                      },
                      legend: { data: ["多头", "空头"], top: 5, itemWidth: 12, itemGap: 8 },
                      grid: { left: 70, right: 20, top: 35, bottom: 60 },
                      xAxis: {
                        type: "category",
                        data: sectorLS.map((s) => s.sector),
                        axisLabel: { fontSize: 11, rotate: 30 },
                      },
                      yAxis: {
                        type: "value",
                        axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" },
                      },
                      series: [
                        {
                          name: "多头",
                          type: "bar",
                          stack: "ls",
                          data: sectorLS.map((s) => ({
                            value: s.long,
                            itemStyle: { color: s.long >= 0 ? "#ef4444" : "#22c55e" },
                          })),
                        },
                        {
                          name: "空头",
                          type: "bar",
                          stack: "ls",
                          data: sectorLS.map((s) => ({
                            value: s.short,
                            itemStyle: { color: s.short >= 0 ? "#ef444488" : "#22c55e88" },
                          })),
                        },
                      ],
                    }}
                    style={{ height: 300 }}
                    notMerge
                  />
                )}
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <Card>
              <CardHeader className="pb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-sm">品种当日盈亏</CardTitle>
                  <div className="flex gap-1 ml-auto">
                    <button
                      onClick={() => setProdView("total")}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${prodView === "total" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >合计</button>
                    <button
                      onClick={() => setProdView("ls")}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${prodView === "ls" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >多空</button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <select
                    className="text-xs border rounded px-1 py-0.5 bg-background"
                    value={prodCatFilter}
                    onChange={(e) => { setProdCatFilter(e.target.value); setProdSectorFilter("全部"); setProdSubSectorFilter("全部") }}
                  >
                    <option value="全部">大类资产</option>
                    {["商品","股指","国债"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select
                    className="text-xs border rounded px-1 py-0.5 bg-background"
                    value={prodSectorFilter}
                    onChange={(e) => { setProdSectorFilter(e.target.value); setProdSubSectorFilter("全部") }}
                  >
                    {availableSectors.map((s) => <option key={s} value={s}>{s === "全部" ? "板块" : s}</option>)}
                  </select>
                  <select
                    className="text-xs border rounded px-1 py-0.5 bg-background"
                    value={prodSubSectorFilter}
                    onChange={(e) => setProdSubSectorFilter(e.target.value)}
                  >
                    {availableSubSectors.map((ss) => <option key={ss} value={ss}>{ss === "全部" ? "细分板块" : ss}</option>)}
                  </select>
                  {(prodCatFilter !== "全部" || prodSectorFilter !== "全部" || prodSubSectorFilter !== "全部") && (
                    <button
                      onClick={() => { setProdCatFilter("全部"); setProdSectorFilter("全部"); setProdSubSectorFilter("全部") }}
                      className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
                    >重置</button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                {prodView === "total" ? (
                  <ReactECharts
                    option={{
                      tooltip: {
                        trigger: "axis",
                        formatter: (params: { name: string; value: number; marker: string }[]) =>
                          params.map((p) => {
                            const cn = PROD_NAMES[p.name]
                            const label = cn ? `${p.name}（${cn}）` : p.name
                            return `${p.marker}${label}: ${Number(p.value).toLocaleString("zh-CN")} 元`
                          }).join("<br/>"),
                      },
                      grid: { left: 55, right: 10, top: 15, bottom: 50 },
                      xAxis: {
                        type: "category",
                        data: filteredProdLatest.map((p) => p.key),
                        axisLabel: { fontSize: 10, rotate: 45 },
                      },
                      yAxis: {
                        type: "value",
                        axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" },
                      },
                      series: [{
                        type: "bar",
                        data: filteredProdLatest.map((p) => ({
                          value: p.pnl,
                          itemStyle: { color: p.pnl >= 0 ? "#ef4444" : "#22c55e" },
                        })),
                        label: { show: false },
                      }],
                    }}
                    style={{ height: 240 }}
                    notMerge
                  />
                ) : (
                  <ReactECharts
                    option={{
                      tooltip: {
                        trigger: "axis",
                        formatter: (params: { seriesName: string; name: string; value: number; marker: string }[]) => {
                          const valid = params.filter((p) => p.seriesName === "多头" || p.seriesName === "空头")
                          const cn = PROD_NAMES[params[0]?.name]
                          const label = cn ? `${params[0].name}（${cn}）` : params[0]?.name
                          const lines = valid.map((p) => `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`)
                          const net = valid.reduce((s, p) => s + Number(p.value), 0)
                          lines.push(`合计: ${net.toLocaleString("zh-CN")} 元`)
                          return [label, ...lines].join("<br/>")
                        },
                      },
                      legend: { data: ["多头", "空头"], top: 5, itemWidth: 12, itemGap: 8 },
                      grid: { left: 55, right: 10, top: 30, bottom: 50 },
                      xAxis: {
                        type: "category",
                        data: filteredProdLS.map((p) => p.prod),
                        axisLabel: { fontSize: 10, rotate: 45 },
                      },
                      yAxis: {
                        type: "value",
                        axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" },
                      },
                      series: [
                        {
                          name: "多头",
                          type: "bar",
                          stack: "ls",
                          data: filteredProdLS.map((p) => ({
                            value: p.long,
                            itemStyle: { color: p.long >= 0 ? "#ef4444" : "#22c55e" },
                          })),
                        },
                        {
                          name: "空头",
                          type: "bar",
                          stack: "ls",
                          data: filteredProdLS.map((p) => ({
                            value: p.short,
                            itemStyle: { color: p.short >= 0 ? "#ef444488" : "#22c55e88" },
                          })),
                        },
                      ],
                    }}
                    style={{ height: 240 }}
                    notMerge
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">账户当日盈亏</CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <ReactECharts
                  option={{
                    tooltip: {
                      trigger: "axis",
                      formatter: (params: { name: string; value: number; marker: string }[]) =>
                        params.map((p) => `${p.marker}${p.name}: ${Number(p.value).toLocaleString("zh-CN")} 元`).join("<br/>"),
                    },
                    grid: { left: 55, right: 10, top: 15, bottom: 60 },
                    xAxis: {
                      type: "category",
                      data: accountLatest.map((a) => a.account),
                      axisLabel: { fontSize: 10, rotate: 30 },
                    },
                    yAxis: {
                      type: "value",
                      axisLabel: { formatter: (v: number) => (v / 10000).toFixed(1) + "万" },
                    },
                    series: [{
                      type: "bar",
                      data: accountLatest.map((a) => ({
                        value: a.pnl,
                        itemStyle: { color: a.pnl >= 0 ? "#ef4444" : "#22c55e" },
                      })),
                      label: { show: false },
                    }],
                  }}
                  style={{ height: 260 }}
                  notMerge
                />
              </CardContent>
            </Card>
          </div>
          </div>
        )}
      </section>
      <section>
        <h2 id="section-intraday-var" className="text-sm font-semibold mb-3 flex items-center gap-2">
          次日预测
          <span className="h-px flex-1 bg-border" />
          {varBreachRate != null && (
            <span className="text-xs text-muted-foreground font-normal">
              VaR({varConfidence}%) 突破率 {varBreachRate}%
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <label className="text-xs text-muted-foreground">置信度</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varConfidence}
            onChange={(e) => { setVarConfidence(e.target.value); fetchVar(e.target.value, varVolDays, varCorrDays, varDistModel) }}
          >
            <option value="90">90%</option>
            <option value="95">95%</option>
            <option value="99">99%</option>
          </select>
          <label className="text-xs text-muted-foreground ml-2">波动率窗口</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varVolDays}
            onChange={(e) => { setVarVolDays(e.target.value); fetchVar(varConfidence, e.target.value, varCorrDays, varDistModel) }}
          >
            {["5","10","20","30","60"].map((d) => <option key={d} value={d}>{d} 天</option>)}
          </select>
          <label className="text-xs text-muted-foreground ml-2">相关系数窗口</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varCorrDays}
            onChange={(e) => { setVarCorrDays(e.target.value); fetchVar(varConfidence, varVolDays, e.target.value, varDistModel) }}
          >
            {["5","10","20","30","60","126","252","504"].map((d) => <option key={d} value={d}>{d} 天</option>)}
          </select>
          <label className="text-xs text-muted-foreground ml-2">分布</label>
          <select
            className="text-xs border rounded px-1 py-0.5 bg-background"
            value={varDistModel}
            onChange={(e) => { setVarDistModel(e.target.value); fetchVar(varConfidence, varVolDays, varCorrDays, e.target.value) }}
          >
            <option value="normal">正态分布</option>
            <option value="t">t 分布 (df=6)</option>
            <option value="laplace">拉普拉斯分布</option>
            <option value="logistic">Logistic 分布</option>
            <option value="kde">核密度估计 KDE</option>
          </select>
          {varLoading && <span className="text-xs text-muted-foreground ml-2">计算中...</span>}
          <button
            className="ml-auto text-xs px-2.5 py-0.5 rounded border border-border hover:bg-muted transition-colors flex items-center gap-1"
            disabled={varOptLoading}
            onClick={() => {
              setVarOptLoading(true)
              setVarOptOpen(true)
              fetch("/ma/api/mom-analysis/var-optimize")
                .then((r) => r.json())
                .then((j) => setVarOptResults(j.results ?? []))
                .catch(() => {})
                .finally(() => setVarOptLoading(false))
            }}
          >
            {varOptLoading ? "搜索中…" : "🔍 最优参数搜索"}
          </button>
        </div>
        {!loading && varData.length > 0 && (() => {
          const ROLL = 20
          // residual = actual - var; positive → breach
          const residuals = varData.map((r) => r.actual - r.var)
          // rolling breach rate: fraction of last ROLL days where actual > var
          const rollBreach = varData.map((_, i) => {
            const window = varData.slice(Math.max(0, i - ROLL + 1), i + 1)
            return Math.round((window.filter((r) => r.actual > r.var).length / window.length) * 1000) / 10
          })
          const handleZoom = (params: { start?: number; end?: number; batch?: { start: number; end: number }[] }) => {
            const s = params.batch ? params.batch[0].start : (params.start ?? varZoom.start)
            const e = params.batch ? params.batch[0].end   : (params.end   ?? varZoom.end)
            setVarZoom({ start: s, end: e })
          }
          return (
            <div className="flex gap-3">
              {/* Left: VaR prediction vs actual */}
              <div className="flex-1 min-w-0">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">VaR({varConfidence}%) 预测 vs 实际 |盈亏|</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 pb-2">
                    <ReactECharts
                      option={{
                        tooltip: {
                          trigger: "axis",
                          formatter: (params: { seriesName: string; name: string; value: number; marker: string }[]) => {
                            const lines = params.map((p) => `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`)
                            return [params[0]?.name, ...lines].join("<br/>")
                          },
                        },
                        legend: { data: ["实际|盈亏|", `VaR(${varConfidence}%)`], top: 5, itemWidth: 12, itemGap: 8 },
                        grid: { left: 65, right: 20, top: 35, bottom: 50 },
                        xAxis: {
                          type: "category",
                          data: varData.map((r) => r.date),
                          axisLabel: { fontSize: 10, rotate: 30 },
                        },
                        yAxis: {
                          type: "value",
                          axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
                        },
                        dataZoom: [
                          { type: "inside", start: varZoom.start, end: varZoom.end },
                          { type: "slider", height: 20, bottom: 5, start: varZoom.start, end: varZoom.end },
                        ],
                        series: [
                          {
                            name: "实际|盈亏|",
                            type: "bar",
                            data: varData.map((r) => ({
                              value: r.actual,
                              itemStyle: { color: r.actual > r.var ? "#ef4444" : "#94a3b8" },
                            })),
                            barMaxWidth: 12,
                          },
                          {
                            name: `VaR(${varConfidence}%)`,
                            type: "line",
                            data: varData.map((r) => r.var),
                            lineStyle: { color: "#f97316", width: 2 },
                            itemStyle: { color: "#f97316" },
                            symbol: "none",
                            z: 10,
                          },
                        ],
                      }}
                      style={{ height: 320 }}
                      notMerge
                      onEvents={{ dataZoom: handleZoom }}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Right: model fit metrics */}
              <div className="flex-1 min-w-0">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">
                        模型拟合评估 — 残差 & 滚动超标率
                        <span className="ml-3 text-muted-foreground font-normal">
                          全期超标率 {varBreachRate != null ? `${varBreachRate}%` : "—"}
                          　期望 {100 - parseInt(varConfidence, 10)}%
                        </span>
                      </CardTitle>
                      <button
                        className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted transition-colors"
                        onClick={() => setVarFitView(varFitView === "chart" ? "table" : "chart")}
                      >
                        {varFitView === "chart" ? "统计表" : "图表"}
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 pb-2">
                    {varFitView === "chart" ? (
                    <ReactECharts
                      option={{
                        tooltip: {
                          trigger: "axis",
                          formatter: (params: { seriesName: string; name: string; value: number; marker: string; axisIndex?: number }[]) => {
                            const lines = params.map((p) => {
                              if (p.seriesName === `${ROLL}日滚动超标率`) return `${p.marker}${p.seriesName}: ${p.value}%`
                              return `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`
                            })
                            return [params[0]?.name, ...lines].join("<br/>")
                          },
                        },
                        legend: { data: ["残差 (实际−VaR)", `${ROLL}日滚动超标率`], top: 5, itemWidth: 12, itemGap: 8 },
                        grid: { left: 65, right: 55, top: 35, bottom: 50 },
                        xAxis: {
                          type: "category",
                          data: varData.map((r) => r.date),
                          axisLabel: { fontSize: 10, rotate: 30 },
                        },
                        yAxis: [
                          {
                            type: "value",
                            name: "残差",
                            nameTextStyle: { fontSize: 10 },
                            axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万", fontSize: 10 },
                            splitLine: { lineStyle: { type: "dashed" } },
                          },
                          {
                            type: "value",
                            name: "超标率%",
                            nameTextStyle: { fontSize: 10 },
                            position: "right",
                            axisLabel: { formatter: (v: number) => v + "%", fontSize: 10 },
                            splitLine: { show: false },
                            min: 0,
                            max: 100,
                          },
                        ],
                        dataZoom: [
                          { type: "inside", start: varZoom.start, end: varZoom.end },
                          { type: "slider", height: 20, bottom: 5, start: varZoom.start, end: varZoom.end },
                        ],
                        series: [
                          {
                            name: "残差 (实际−VaR)",
                            type: "bar",
                            yAxisIndex: 0,
                            data: residuals.map((v) => ({
                              value: v,
                              itemStyle: { color: v > 0 ? "#ef4444" : "#22c55e" },
                            })),
                            barMaxWidth: 12,
                          },
                          {
                            name: `${ROLL}日滚动超标率`,
                            type: "line",
                            yAxisIndex: 1,
                            data: rollBreach,
                            lineStyle: { color: "#a78bfa", width: 2 },
                            itemStyle: { color: "#a78bfa" },
                            symbol: "none",
                            z: 10,
                          },
                        ],
                      }}
                      style={{ height: 320 }}
                      notMerge
                      onEvents={{ dataZoom: handleZoom }}
                    />
                    ) : (() => {
                      const N      = varData.length
                      const N1     = varData.filter((r) => r.actual > r.var).length
                      const N0     = N - N1
                      const p_exp  = (100 - parseInt(varConfidence, 10)) / 100
                      const p_obs  = N > 0 ? N1 / N : 0
                      // Kupiec POF LR statistic (chi-squared df=1)
                      const safeLn = (x: number) => x > 0 ? Math.log(x) : -999
                      const lr_pof = N > 0 && N1 > 0 && N0 > 0
                        ? -2 * (N1 * safeLn(p_exp) + N0 * safeLn(1 - p_exp) - N1 * safeLn(p_obs) - N0 * safeLn(1 - p_obs))
                        : 0
                      // Christoffersen independence: consecutive breach runs
                      let T00=0,T01=0,T10=0,T11=0
                      for (let i=1;i<N;i++) {
                        const prev = varData[i-1].actual > varData[i-1].var ? 1 : 0
                        const curr = varData[i].actual   > varData[i].var   ? 1 : 0
                        if (prev===0&&curr===0) T00++
                        else if (prev===0&&curr===1) T01++
                        else if (prev===1&&curr===0) T10++
                        else T11++
                      }
                      const pi01 = T00+T01>0 ? T01/(T00+T01) : 0
                      const pi11 = T10+T11>0 ? T11/(T10+T11) : 0
                      const lr_ind = T01+T11>0 && T00+T10>0
                        ? -2 * (
                            (T00+T01)*safeLn(1-p_obs) + (T01+T11)*safeLn(p_obs)
                            - (T00*safeLn(1-pi01)+(T01>0?T01*safeLn(pi01):0))
                            - (T10*safeLn(1-pi11)+(T11>0?T11*safeLn(pi11):0))
                          )
                        : 0
                      const lr_cc  = lr_pof + lr_ind  // conditional coverage, df=2; crit 5.99
                      // residual stats
                      const mean_r = N > 0 ? residuals.reduce((a,b)=>a+b,0)/N : 0
                      const std_r  = N > 1 ? Math.sqrt(residuals.reduce((a,v)=>a+(v-mean_r)**2,0)/(N-1)) : 0
                      const mae    = N > 0 ? residuals.reduce((a,v)=>a+Math.abs(v),0)/N : 0
                      const rmse   = N > 0 ? Math.sqrt(residuals.reduce((a,v)=>a+v**2,0)/N) : 0
                      const maxBreach = Math.max(0, ...residuals.filter(v=>v>0))
                      const maxBreachDate = maxBreach > 0 ? varData[residuals.indexOf(maxBreach)]?.date ?? "—" : "—"
                      const maxConsec = (() => {
                        let best=0,cur=0
                        for (const r of varData) { cur = r.actual>r.var ? cur+1 : 0; best=Math.max(best,cur) }
                        return best
                      })()
                      const avgVar    = N > 0 ? varData.reduce((a,r)=>a+r.var,0)/N : 0
                      const avgActual = N > 0 ? varData.reduce((a,r)=>a+r.actual,0)/N : 0
                      const fmt = (v: number) => (v/10000).toFixed(2)+"万"
                      const fmtPct = (v: number) => (v*100).toFixed(2)+"%"
                      const cell = "px-3 py-1.5 text-xs"
                      const rows: { label: string; value: string; note?: string; warn?: boolean }[] = [
                        { label: "观测天数 N", value: N.toString() },
                        { label: "超标次数", value: `${N1} 天`, warn: p_obs > p_exp * 1.5 },
                        { label: "实际超标率", value: fmtPct(p_obs), warn: p_obs > p_exp * 1.5 },
                        { label: "期望超标率", value: fmtPct(p_exp) },
                        { label: "最长连续超标", value: `${maxConsec} 天`, warn: maxConsec >= 3 },
                        { label: "Kupiec LR (df=1)", value: lr_pof.toFixed(3), note: lr_pof>6.63?"❌ p<1%":lr_pof>3.84?"⚠ p<5%":"✓ 通过", warn: lr_pof>3.84 },
                        { label: "CC 检验 (df=2)", value: lr_cc.toFixed(3),  note: lr_cc>9.21?"❌ p<1%":lr_cc>5.99?"⚠ p<5%":"✓ 通过",  warn: lr_cc>5.99 },
                        { label: "均值残差", value: fmt(mean_r), note: mean_r>0?"模型倾向低估":"模型倾向高估" },
                        { label: "残差标准差", value: fmt(std_r) },
                        { label: "MAE", value: fmt(mae) },
                        { label: "RMSE", value: fmt(rmse) },
                        { label: "最大超标额", value: maxBreach>0?fmt(maxBreach):"无", note: maxBreach>0?maxBreachDate:undefined, warn: maxBreach>avgVar*2 },
                        { label: "平均 VaR", value: fmt(avgVar) },
                        { label: "平均实际|盈亏|", value: fmt(avgActual) },
                        { label: "覆盖比 (实/VaR)", value: avgVar>0?(avgActual/avgVar).toFixed(3):"—", warn: avgVar>0&&avgActual/avgVar>1 },
                      ]
                      return (
                        <>{(() => {
                          const half = Math.ceil(rows.length / 2)
                          const left = rows.slice(0, half)
                          const right = rows.slice(half)
                          const td = "px-2 py-1 text-xs"
                          const th = "px-2 py-1 text-xs font-medium text-muted-foreground"
                          return (
                            <div className="overflow-y-auto" style={{ height: 320 }}>
                              <table className="w-full text-xs border-collapse">
                                <thead className="sticky top-0 bg-muted/80">
                                  <tr>
                                    <th className={th+" text-left"}>指标</th>
                                    <th className={th+" text-right"}>数值</th>
                                    <th className={th+" text-left"}>说明</th>
                                    <th className={th+" text-left border-l border-border pl-3"}>指标</th>
                                    <th className={th+" text-right"}>数值</th>
                                    <th className={th+" text-left"}>说明</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {left.map((row, i) => {
                                    const r = right[i]
                                    return (
                                      <tr key={row.label} className={i%2===0?"bg-background":"bg-muted/30"}>
                                        <td className={td+" text-muted-foreground whitespace-nowrap"}>{row.label}</td>
                                        <td className={td+" text-right font-mono whitespace-nowrap "+(row.warn?"text-red-500 font-semibold":"")}>{row.value}</td>
                                        <td className={td+" text-muted-foreground/70 whitespace-nowrap"}>{row.note ?? ""}</td>
                                        {r ? (
                                          <>
                                            <td className={td+" text-muted-foreground whitespace-nowrap border-l border-border pl-3"}>{r.label}</td>
                                            <td className={td+" text-right font-mono whitespace-nowrap "+(r.warn?"text-red-500 font-semibold":"")}>{r.value}</td>
                                            <td className={td+" text-muted-foreground/70 whitespace-nowrap"}>{r.note ?? ""}</td>
                                          </>
                                        ) : <td colSpan={3} />}
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )
                        })()}</>
                      )
                    })()}
                  </CardContent>
                </Card>
              </div>
            </div>
          )
        })()}
        {!loading && varData.length === 0 && (
          <p className="text-sm text-muted-foreground">数据不足（需至少 22 个交易日）</p>
        )}

        {!loading && (volBarData.length > 0 || (corrMatrixData && corrMatrixData.prods.length > 1)) && (
          <div className="flex gap-3 mt-3">
            {/* Left: vol + mvc stacked */}
            <div className="flex flex-col gap-3 w-1/2">
              {volBarData.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">品种市场收益率波动率（日，%）</CardTitle>
                      <select
                        className="text-xs border rounded px-1 py-0.5 bg-background font-normal"
                        value={volWindow}
                        onChange={(e) => { setVolWindow(e.target.value); fetchVolBar(e.target.value) }}
                      >
                        {["5", "10", "20"].map((d) => <option key={d} value={d}>{d} 天</option>)}
                      </select>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 pb-2">
                    <ReactECharts
                      option={{
                        tooltip: {
                          trigger: "axis",
                          formatter: (params: { name: string; value: number; marker: string }[]) =>
                            params.map((p) => `${p.marker}${p.name} ${PROD_NAMES[p.name] ? `(${PROD_NAMES[p.name]})` : ""}: ${p.value}%`).join("<br/>"),
                        },
                        grid: { left: 50, right: 20, top: 10, bottom: 60 },
                        xAxis: { type: "category", data: volBarData.map((d) => d.prod), axisLabel: { fontSize: 9, rotate: 45 } },
                        yAxis: { type: "value", axisLabel: { fontSize: 10, formatter: (v: number) => v + "%" }, splitLine: { lineStyle: { type: "dashed" } } },
                        series: [{ type: "bar", data: volBarData.map((d) => ({ value: d.vol })), barMaxWidth: 20, itemStyle: { color: "#60a5fa" }, label: { show: false } }],
                      }}
                      style={{ height: 200 }}
                      notMerge
                    />
                  </CardContent>
                </Card>
              )}
              {mvcData.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm">品种边际波动率贡献（占组合波动率 %）</CardTitle>
                      <span className="text-xs text-muted-foreground font-normal">{volWindow} 天窗口</span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 pb-2">
                    <ReactECharts
                      option={{
                        tooltip: {
                          trigger: "axis",
                          formatter: (params: { name: string; value: number; marker: string }[]) =>
                            params.map((p) => `${p.marker}${p.name}${PROD_NAMES[p.name] ? ` (${PROD_NAMES[p.name]})` : ""}: ${p.value}%`).join("<br/>"),
                        },
                        grid: { left: 50, right: 20, top: 10, bottom: 60 },
                        xAxis: { type: "category", data: mvcData.map((d) => d.prod), axisLabel: { fontSize: 9, rotate: 45 } },
                        yAxis: { type: "value", axisLabel: { fontSize: 10, formatter: (v: number) => v + "%" }, splitLine: { lineStyle: { type: "dashed" } } },
                        series: [{ type: "bar", data: mvcData.map((d) => ({ value: d.mvc, itemStyle: { color: d.mvc >= 0 ? "#f97316" : "#22c55e" } })), barMaxWidth: 20, label: { show: false } }],
                      }}
                      style={{ height: 200 }}
                      notMerge
                    />
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Right: correlation heatmap */}
            {corrMatrixData && corrMatrixData.prods.length > 1 && (() => {
              const { prods, data } = corrMatrixData
              return (
                <div className="flex-1 min-w-0">
                  <Card className="h-full">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">品种相关性矩阵（市场收益率）</CardTitle>
                        <select
                          className="text-xs border rounded px-1 py-0.5 bg-background font-normal"
                          value={corrWindow}
                          onChange={(e) => { setCorrWindow(e.target.value); fetchCorrMatrix(e.target.value) }}
                        >
                          {["5","10","20","30","60","120"].map((d) => <option key={d} value={d}>{d} 天</option>)}
                        </select>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0 pb-2 overflow-y-auto" style={{ maxHeight: 460 }}>
                      <ReactECharts
                        option={{
                          tooltip: {
                            formatter: (p: { data: [number, number, number] }) =>
                              `${prods[p.data[1]]} \u2194 ${prods[p.data[0]]}: ${p.data[2]}`,
                          },
                          grid: { left: 40, right: 80, top: 10, bottom: 40 },
                          xAxis: { type: "category", data: prods, axisLabel: { fontSize: 8, rotate: 45, interval: 0 }, splitArea: { show: true } },
                          yAxis: { type: "category", data: prods, inverse: true, axisLabel: { fontSize: 8, interval: 0 }, splitArea: { show: true } },
                          visualMap: {
                            min: -1, max: 1,
                            calculable: false,
                            orient: "vertical",
                            right: 5, top: "center",
                            itemHeight: 160,
                            textStyle: { fontSize: 9 },
                            inRange: { color: ["#3b82f6", "#f8fafc", "#ef4444"] },
                          },
                          series: [{
                            type: "heatmap",
                            data,
                            emphasis: { itemStyle: { shadowBlur: 6, shadowColor: "rgba(0,0,0,0.2)" } },
                          }],
                        }}
                        style={{ height: prods.length * 13 + 60 }}
                        notMerge
                      />
                    </CardContent>
                    {/* Pairwise lookup */}
                    <div className="flex items-center gap-2 px-3 py-2 border-t">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">查询相关性</span>
                      <input
                        className="text-xs border rounded px-2 py-0.5 w-16 bg-background uppercase"
                        placeholder="LH"
                        value={corrLookupA}
                        onChange={(e) => setCorrLookupA(e.target.value.toUpperCase())}
                      />
                      <span className="text-xs text-muted-foreground">↔</span>
                      <input
                        className="text-xs border rounded px-2 py-0.5 w-16 bg-background uppercase"
                        placeholder="AU"
                        value={corrLookupB}
                        onChange={(e) => setCorrLookupB(e.target.value.toUpperCase())}
                      />
                      {(() => {
                        if (!corrLookupA || !corrLookupB || !corrMatrixData) return null
                        const { prods, data } = corrMatrixData
                        const xi = prods.indexOf(corrLookupA)
                        const yi = prods.indexOf(corrLookupB)
                        if (xi === -1 || yi === -1) return <span className="text-xs text-muted-foreground">产品不在持仓</span>
                        const entry = data.find(([x, y]) => x === xi && y === yi)
                        const val = entry ? entry[2] : (xi === yi ? 1 : null)
                        if (val == null) return null
                        const color = val > 0.6 ? "text-red-500" : val < -0.3 ? "text-blue-500" : "text-foreground"
                        return <span className={`text-sm font-mono font-semibold ${color}`}>{val}</span>
                      })()}
                    </div>
                  </Card>
                </div>
              )
            })()}
          </div>
        )}

        {/* Optimization results panel */}
        {varOptOpen && (
          <div className="mt-3 border rounded-lg bg-card">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="text-sm font-medium">
                最优参数搜索结果
                {varOptLoading
                  ? " — 遍历所有参数组合中…"
                  : varOptResults.length > 0
                  ? ` — 共 ${varOptResults.length} 条（按综合得分排序，越低越好）`
                  : ""}
              </span>
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setVarOptOpen(false)}
              >
                关闭 ✕
              </button>
            </div>
            {varOptLoading ? (
              <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                正在遍历所有参数组合，通常需要 5–15 秒…
              </div>
            ) : varOptResults.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground text-center">无结果</div>
            ) : (() => {
              const DIST_LABEL: Record<string, string> = {
                normal: "正态", t: "t(6)", laplace: "拉普拉斯", logistic: "Logistic", kde: "KDE",
              }
              const th = "px-2 py-1.5 text-xs font-medium text-muted-foreground text-right whitespace-nowrap"
              const td = "px-2 py-1 text-xs text-right whitespace-nowrap"
              return (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 bg-muted/80">
                      <tr>
                        <th className={th + " text-center"}>#</th>
                        <th className={th}>置信度</th>
                        <th className={th}>波动率窗口</th>
                        <th className={th}>相关系数窗口</th>
                        <th className={th}>分布</th>
                        <th className={th}>超标率</th>
                        <th className={th}>期望超标率</th>
                        <th className={th}>Kupiec LR</th>
                        <th className={th}>CC 检验</th>
                        <th className={th}>MAE(万)</th>
                        <th className={th}>RMSE(万)</th>
                        <th className={th}>平均VaR(万)</th>
                        <th className={th}>覆盖比</th>
                        <th className={th + " text-orange-500"}>综合得分</th>
                        <th className={th}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {varOptResults.map((r, i) => {
                        const bothPass = r.kupiecPass && r.ccPass
                        const isActive =
                          r.confidence === varConfidence &&
                          String(r.volDays) === varVolDays &&
                          String(r.corrDays) === varCorrDays &&
                          r.distModel === varDistModel
                        return (
                          <tr
                            key={i}
                            className={
                              isActive
                                ? "bg-primary/10 font-semibold"
                                : i % 2 === 0
                                ? "bg-background"
                                : "bg-muted/30"
                            }
                          >
                            <td className={td + " text-center text-muted-foreground"}>{i + 1}</td>
                            <td className={td}>{r.confidence}%</td>
                            <td className={td}>{r.volDays > 0 ? `${r.volDays}天` : "—"}</td>
                            <td className={td}>{r.corrDays}天</td>
                            <td className={td}>{DIST_LABEL[r.distModel] ?? r.distModel}</td>
                            <td className={td + (r.breachRate > r.expectedRate * 1.5 ? " text-red-500 font-semibold" : "")}>
                              {r.breachRate}%
                            </td>
                            <td className={td + " text-muted-foreground"}>{r.expectedRate}%</td>
                            <td className={td + (r.kupiecPass ? " text-green-600" : " text-red-500 font-semibold")}>
                              {r.kupiecLR} {r.kupiecPass ? "✓" : "✗"}
                            </td>
                            <td className={td + (r.ccPass ? " text-green-600" : " text-red-500 font-semibold")}>
                              {r.ccLR} {r.ccPass ? "✓" : "✗"}
                            </td>
                            <td className={td}>{r.mae}</td>
                            <td className={td}>{r.rmse}</td>
                            <td className={td}>{r.avgVar}</td>
                            <td className={td + (r.coverageRatio >= 0.7 ? " text-green-600" : r.coverageRatio >= 0.4 ? "" : " text-orange-500")}>
                              {r.coverageRatio}
                            </td>
                            <td className={td + " font-mono " + (bothPass ? "text-green-700" : "text-muted-foreground")}>
                              {r.score}
                            </td>
                            <td className="px-2 py-1">
                              <button
                                className="text-xs px-2 py-0.5 rounded bg-primary/10 hover:bg-primary/20 text-primary transition-colors whitespace-nowrap"
                                onClick={() => {
                                  setVarConfidence(r.confidence)
                                  setVarVolDays(r.distModel === "kde" ? varVolDays : String(r.volDays))
                                  setVarCorrDays(String(r.corrDays))
                                  setVarDistModel(r.distModel)
                                  fetchVar(
                                    r.confidence,
                                    r.distModel === "kde" ? varVolDays : String(r.volDays),
                                    String(r.corrDays),
                                    r.distModel,
                                  )
                                }}
                              >
                                应用
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        )}
      </section>
      <div id="section-intraday-sandbox">
        <VarSandboxContent />
      </div>

      <section id="section-intraday-margin">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          风险水平（保证金）
          <span className="h-px flex-1 bg-border" />
        </h2>
        {marginLoading ? (
          <p className="text-sm text-muted-foreground">加载中...</p>
        ) : marginTs.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无数据</p>
        ) : (
          <>
          <div className="grid grid-cols-2 gap-4 items-stretch">
            {/* Portfolio risk ratio time-series chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-3">
                  组合历史风险度
                  {marginTs.length > 0 && (() => {
                    const last = marginTs[marginTs.length - 1]
                    const r = last?.riskRatio
                    return r != null ? (
                      <span className={`text-base font-bold tabular-nums ${r > 80 ? "text-red-500" : r > 60 ? "text-orange-500" : "text-green-600"}`}>
                        {r.toFixed(2)}%
                      </span>
                    ) : null
                  })()}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <ReactECharts
                  option={{
                    tooltip: {
                      trigger: "axis",
                      formatter: (params: { seriesName: string; value: number; marker: string; dataIndex: number }[]) => {
                        const idx = params[0]?.dataIndex ?? 0
                        const date = marginTs[idx]?.date ?? ""
                        const total = marginTs[idx]?.riskRatio
                        const totalLine = total != null ? `<br/><b>合计: ${total.toFixed(2)}%</b>` : ""
                        return [
                          `<b>${date}</b>`,
                          ...params.filter(p => p.value != null).map(p => `${p.marker}${p.seriesName}: ${Number(p.value).toFixed(2)}%`),
                        ].join("<br/>") + totalLine
                      },
                    },
                    legend: { top: 2, textStyle: { fontSize: 11 }, data: ["多头保证金/权益", "空头保证金/权益"] },
                    grid: { left: 55, right: 20, top: 35, bottom: 50 },
                    xAxis: { type: "category", data: marginTs.map(r => r.date), axisLabel: { fontSize: 10, rotate: 30 } },
                    yAxis: { type: "value", axisLabel: { formatter: (v: number) => v.toFixed(1) + "%" } },
                    dataZoom: [{ type: "inside", start: 60, end: 100 }, { type: "slider", height: 20, bottom: 5 }],
                    series: [
                      {
                        name: "多头保证金/权益",
                        type: "bar",
                        stack: "margin",
                        itemStyle: { color: "#3b82f6" },
                        data: marginTs.map(r => r.longMarginRatio ?? (r.shortMarginRatio == null ? r.riskRatio : null)),
                        label: { show: false },
                      },
                      {
                        name: "空头保证金/权益",
                        type: "bar",
                        stack: "margin",
                        itemStyle: { color: "#f59e0b" },
                        data: marginTs.map(r => r.shortMarginRatio),
                      },
                    ],
                  }}
                  style={{ height: 280 }}
                  notMerge
                />
              </CardContent>
            </Card>

            {/* Sector risk ratio chart */}
            {(() => {
              const SECTOR_COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#f97316","#6366f1","#ec4899","#14b8a6"]
              const allSectors = [...sectorSeries].sort((a, b) => a.sector.localeCompare(b.sector, "zh"))
              const allDates = marginTs.map(r => r.date)
              const isSingleSector = sectorFilter !== "全部"

              // Single sector: show long/short bars like 组合历史风险度
              const selectedLs = isSingleSector
                ? sectorLsSeries.find(s => s.sector === sectorFilter)
                : null

              const sectorOption = isSingleSector && selectedLs
                ? {
                    tooltip: {
                      trigger: "axis" as const,
                      formatter: (params: { seriesName: string; value: number | null; marker: string; axisValueLabel: string }[]) => {
                        const total = params.reduce((sum, p) => sum + (p.value != null ? Number(p.value) : 0), 0)
                        return [
                          `<b>${params[0]?.axisValueLabel ?? ""}</b>`,
                          ...params.filter(p => p.value != null).map(p => `${p.marker}${p.seriesName}: ${Number(p.value).toFixed(2)}%`),
                          `<b>合计: ${total.toFixed(2)}%</b>`,
                        ].join("<br/>")
                      },
                    },
                    legend: { top: 2, textStyle: { fontSize: 11 }, data: ["多头保证金/权益", "空头保证金/权益"] },
                    grid: { left: 55, right: 20, top: 35, bottom: 50 },
                    xAxis: { type: "category" as const, data: allDates, axisLabel: { fontSize: 10, rotate: 30 } },
                    yAxis: { type: "value" as const, axisLabel: { formatter: (v: number) => v.toFixed(1) + "%" } },
                    dataZoom: [{ type: "inside", start: 60, end: 100 }, { type: "slider", height: 20, bottom: 5 }],
                    series: (() => {
                      const lsMap = new Map(selectedLs.series.map(r => [r.date, r]))
                      return [
                        {
                          name: "多头保证金/权益",
                          type: "bar" as const,
                          stack: "sector",
                          itemStyle: { color: "#3b82f6" },
                          data: allDates.map(d => lsMap.get(d)?.longMarginRatio ?? null),
                          label: { show: false },
                        },
                        {
                          name: "空头保证金/权益",
                          type: "bar" as const,
                          stack: "sector",
                          itemStyle: { color: "#f59e0b" },
                          data: allDates.map(d => lsMap.get(d)?.shortMarginRatio ?? null),
                        },
                      ]
                    })(),
                  }
                : {
                    // All sectors: stacked by sector
                    tooltip: {
                      trigger: "axis" as const,
                      formatter: (params: { seriesName: string; value: number | null; marker: string; axisValueLabel: string }[]) => {
                        const total = params.reduce((sum, p) => sum + (p.value != null ? Number(p.value) : 0), 0)
                        return [
                          `<b>${params[0]?.axisValueLabel ?? ""}</b>`,
                          ...params.filter(p => p.value != null && Number(p.value) > 0).map(p => `${p.marker}${p.seriesName}: ${Number(p.value).toFixed(2)}%`),
                          `<b>合计: ${total.toFixed(2)}%</b>`,
                        ].filter(Boolean).join("<br/>")
                      },
                    },
                    legend: { top: 2, textStyle: { fontSize: 11 }, data: allSectors.map(s => s.sector) },
                    grid: { left: 55, right: 20, top: 35, bottom: 50 },
                    xAxis: { type: "category" as const, data: allDates, axisLabel: { fontSize: 10, rotate: 30 } },
                    yAxis: { type: "value" as const, axisLabel: { formatter: (v: number) => v.toFixed(1) + "%" } },
                    dataZoom: [{ type: "inside", start: 60, end: 100 }, { type: "slider", height: 20, bottom: 5 }],
                    series: allSectors.map((s, i) => {
                      const dateToRatio = new Map(s.series.map(r => [r.date, r.riskRatio]))
                      return {
                        name: s.sector,
                        type: "bar" as const,
                        stack: "sector",
                        itemStyle: { color: SECTOR_COLORS[i % SECTOR_COLORS.length] },
                        data: allDates.map(d => dateToRatio.get(d) ?? null),
                        label: { show: false },
                      }
                    }),
                  }

              return (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-3">
                      分类投顾历史风险度
                      <div className="ml-auto">
                        <select
                          className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          value={sectorFilter}
                          onChange={e => setSectorFilter(e.target.value)}
                        >
                          <option value="全部">全部板块</option>
                          {allSectors.map(s => (
                            <option key={s.sector} value={s.sector}>{s.sector}</option>
                          ))}
                        </select>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 pb-2">
                    <ReactECharts
                      option={sectorOption}
                      style={{ height: 280 }}
                      notMerge
                    />
                  </CardContent>
                </Card>
              )
            })()}
          </div>

          {/* Latest snapshot table */}
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">账户最新风险度快照</CardTitle></CardHeader>
              <CardContent className="p-0 pb-2 overflow-x-auto overflow-y-auto" style={{ maxHeight: 320 }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-3 py-1.5 font-medium">账户</th>
                      <th className="text-right px-3 py-1.5 font-medium">日期</th>
                      <th className="text-right px-3 py-1.5 font-medium">保证金占用</th>
                      <th className="text-right px-3 py-1.5 font-medium">客户权益</th>
                      <th className="text-right px-3 py-1.5 font-medium">可用资金</th>
                      <th className="text-right px-3 py-1.5 font-medium">风险度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...marginLatest].sort((a, b) => {
                      const ra = a.riskRatio ?? (a.equity > 0 ? a.margin / a.equity * 100 : null)
                      const rb = b.riskRatio ?? (b.equity > 0 ? b.margin / b.equity * 100 : null)
                      if (ra == null && rb == null) return 0
                      if (ra == null) return 1
                      if (rb == null) return -1
                      return rb - ra
                    }).map((r, i) => {
                      const ratio = r.riskRatio ?? (r.equity > 0 ? r.margin / r.equity * 100 : null)
                      const danger = ratio != null && ratio > 80
                      const warning = ratio != null && ratio > 60 && ratio <= 80
                      return (
                        <tr key={r.account} className={`border-b last:border-b-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                          <td className="px-3 py-1.5 font-medium">{r.account}</td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">{r.date}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{r.margin.toLocaleString("zh-CN")}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{r.equity.toLocaleString("zh-CN")}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{r.available.toLocaleString("zh-CN")}</td>
                          <td className={`px-3 py-1.5 text-right font-mono font-semibold ${danger ? "text-red-500" : warning ? "text-orange-500" : "text-green-600"}`}>
                            {ratio != null ? ratio.toFixed(2) + "%" : "—"}
                          </td>
                        </tr>
                      )
                    })}
                    {/* Portfolio total */}
                    {(() => {
                      const last = marginTs[marginTs.length - 1]
                      if (!last) return null
                      return (
                        <tr className="border-t bg-muted/50 font-semibold">
                          <td className="px-3 py-1.5">合计</td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">{last.date}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{last.margin.toLocaleString("zh-CN")}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{last.equity.toLocaleString("zh-CN")}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{last.available.toLocaleString("zh-CN")}</td>
                          <td className={`px-3 py-1.5 text-right font-mono ${last.riskRatio != null && last.riskRatio > 80 ? "text-red-500" : last.riskRatio != null && last.riskRatio > 60 ? "text-orange-500" : "text-green-600"}`}>
                            {last.riskRatio != null ? last.riskRatio.toFixed(2) + "%" : "—"}
                          </td>
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* 投顾当日风险排序 bar chart */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-3">
                  投顾当日风险排序
                  <div className="ml-auto">
                    <select
                      className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      value={acctRankFilter}
                      onChange={e => setAcctRankFilter(e.target.value)}
                    >
                      <option value="全部">全部板块</option>
                      {[...new Set(marginLatest.map(r => r.sector).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh")).map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                {(() => {
                  const ranked = [...marginLatest]
                    .filter(r => acctRankFilter === "全部" || r.sector === acctRankFilter)
                    .map(r => {
                      const total = r.riskRatio ?? (r.equity > 0 ? r.margin / r.equity * 100 : null)
                      const lp = r.longMarginRatio   // proportion 0–1
                      const sp = r.shortMarginRatio  // proportion 0–1
                      const hasLs = lp != null && sp != null
                      return {
                        account: r.account,
                        longRatio:  hasLs && total != null ? total * lp! : null,
                        shortRatio: hasLs && total != null ? total * sp! : null,
                        totalRatio: total,
                      }
                    })
                    .filter(r => r.totalRatio != null)
                    .sort((a, b) => (b.totalRatio ?? 0) - (a.totalRatio ?? 0))
                  const accounts = ranked.map(r => r.account)
                  return (
                    <ReactECharts
                      option={{
                        tooltip: {
                          trigger: "axis",
                          formatter: (params: { seriesName: string; value: number | null; marker: string; axisValue: string }[]) => {
                            const total = params.reduce((s, p) => s + (p.value != null ? Number(p.value) : 0), 0)
                            return [
                              `<b>${params[0]?.axisValue ?? ""}</b>`,
                              ...params.filter(p => p.value != null).map(p => `${p.marker}${p.seriesName}: ${Number(p.value).toFixed(2)}%`),
                              `<b>合计: ${total.toFixed(2)}%</b>`,
                            ].join("<br/>")
                          },
                        },
                        legend: { top: 2, textStyle: { fontSize: 11 }, data: ["多头保证金/权益", "空头保证金/权益"] },
                        grid: { left: 40, right: 20, top: 30, bottom: 60 },
                        xAxis: { type: "category", data: accounts, axisLabel: { fontSize: 10, rotate: 45 } },
                        yAxis: { type: "value", axisLabel: { formatter: (v: number) => v.toFixed(0) + "%" }, splitLine: { lineStyle: { type: "dashed" } } },
                        series: [
                          {
                            name: "多头保证金/权益",
                            type: "bar",
                            stack: "ls",
                            itemStyle: { color: "#3b82f6" },
                            data: ranked.map(r => r.longRatio ?? (r.shortRatio == null ? r.totalRatio : null)),
                            barMaxWidth: 24,
                          },
                          {
                            name: "空头保证金/权益",
                            type: "bar",
                            stack: "ls",
                            itemStyle: { color: "#f59e0b" },
                            data: ranked.map(r => r.shortRatio),
                            barMaxWidth: 24,
                          },
                        ],
                      }}
                      style={{ height: 280 }}
                      notMerge
                    />
                  )
                })()}
              </CardContent>
            </Card>
          </div>
          </>
        )}
      </section>
    </div>
  )
}

type ExposureRow = {
  date: string
  long商品: number; long股指: number; long国债: number
  short商品: number; short股指: number; short国债: number
  net: number
  [key: string]: number | string
}

const EXPOSURE_CATS = ["全部", "商品", "股指", "国债"] as const
type ExposureCat = (typeof EXPOSURE_CATS)[number]

const EXPOSURE_SECTORS = ["全部", "农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运", "股指", "国债"] as const
type ExposureSector = (typeof EXPOSURE_SECTORS)[number]

const EXPOSURE_SUB_SECTORS = ["全部","谷物","油脂油料","软商品","林业","生鲜","贵金属","有色","新能源","原材","成材","煤炭","建材","油品","聚酯","烯烃","芳烃","橡胶","盐化工","煤化工","航运","股指","国债"] as const
type ExposureSubSector = (typeof EXPOSURE_SUB_SECTORS)[number]

// Sector order and colors for the weight stacked area chart
const WEIGHT_SECTORS = ["农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运", "股指", "国债", "其他"] as const
const SECTOR_COLORS: Record<string, string> = {
  农产: "#a3e635",
  生鲜: "#fb7185",
  贵金属: "#fbbf24",
  有色: "#fb923c",
  新能源: "#34d399",
  黑色: "#60a5fa",
  能源化工: "#2dd4bf",
  航运: "#8b5cf6",
  股指: "#c084fc",
  国债: "#ef4444",
  其他: "#94a3b8",
}
const CAT_WEIGHT_GROUPS = ["商品", "股指", "国债"] as const
const CAT_COLORS: Record<string, string> = {
  商品: "#fb923c",
  股指: "#818cf8",
  国债: "#ef4444",
}
const WEIGHT_SUB_SECTORS = ["谷物","油脂油料","软商品","林业","生鲜","贵金属","有色","新能源","原材","成材","煤炭","建材","油品","聚酯","烯烃","芳烃","橡胶","盐化工","煤化工","航运","股指","国债","其他"] as const
const SUB_SECTOR_COLORS: Record<string, string> = {
  谷物: "#84cc16",油脂油料: "#a3e635",软商品: "#facc15",林业: "#86efac",
  生鲜: "#fb7185",贵金属: "#fbbf24",有色: "#fb923c",新能源: "#34d399",
  原材: "#38bdf8",成材: "#60a5fa",煤炭: "#6366f1",建材: "#a78bfa",
  油品: "#f87171",聚酯: "#2dd4bf",烯烃: "#0ea5e9",芳烃: "#e879f9",
  橡胶: "#f472b6",盐化工: "#c084fc",煤化工: "#818cf8",航运: "#8b5cf6",
  股指: "#d946ef",国债: "#ef4444",其他: "#94a3b8",
}

// Maps each sector to its sub-sectors for cascading filter
const SECTOR_TO_SUB_SECTORS: Record<string, readonly string[]> = {
  农产: ["谷物", "油脂油料", "软商品", "林业"],
  生鲜: ["生鲜"],
  贵金属: ["贵金属"],
  有色: ["有色"],
  新能源: ["新能源"],
  黑色: ["原材", "成材", "煤炭", "建材"],
  能源化工: ["油品", "聚酯", "烯烃", "芳烃", "橡胶", "盐化工", "煤化工"],
  航运: ["航运"],
  股指: ["股指"],
  国债: ["国债"],
}

// Maps each sector to its 大类 category for filtering
const SECTOR_TO_CAT: Record<string, string> = {
  农产: "商品", 生鲜: "商品", 贵金属: "商品", 有色: "商品",
  新能源: "商品", 黑色: "商品", 能源化工: "商品", 航运: "商品",
  股指: "股指", 国债: "国债",
}

const CAT_TO_SECTORS: Record<string, readonly string[]> = {
  商品: ["农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运"],
  股指: ["股指"],
  国债: ["国债"],
}

const EXPOSURE_SERIES_CFG = [
  { key: "long商品",  name: "多-商品", stack: "long",  cat: "商品", color: "#38bdf8" },
  { key: "long股指",  name: "多-股指", stack: "long",  cat: "股指", color: "#818cf8" },
  { key: "long国债",  name: "多-国债", stack: "long",  cat: "国债", color: "#2dd4bf" },
  { key: "short商品", name: "空-商品", stack: "short", cat: "商品", color: "#fb923c" },
  { key: "short股指", name: "空-股指", stack: "short", cat: "股指", color: "#f87171" },
  { key: "short国债", name: "空-国债", stack: "short", cat: "国债", color: "#e879f9" },
] as const

type OptionRow = {
  account: string; contract: string; tradeSeq: string
  longLots: number; buyPrice: number; shortLots: number; sellPrice: number
  prevSettle: number; todaySettle: number; hedgeType: string; tradeDate: string
  margin: number; exchange: string; multiplier: number
  cost: number; marketValue: number; floatingPnl: number; optionType: string
}

type PcRow = {
  prod: string; todayMv: number; yesterdayMv: number; deltaMv: number
  todayLots: number; yesterdayLots: number; deltaLots: number
}

type PcDetailRow = {
  prod: string; account: string; isOpt: boolean
  todayLots: number; yesterdayLots: number; deltaLots: number
  todayMv: number; yesterdayMv: number; deltaMv: number
}

function PositionChangeDetailTable({ prodFilter, setProdFilter, catFilter2, setCatFilter2, sectorFilter2, setSectorFilter2, subSectorFilter2, setSubSectorFilter2, onTodayDetail, onYesterdayDetail }: {
  prodFilter: string; setProdFilter: (v: string) => void
  catFilter2: ExposureCat; setCatFilter2: (v: ExposureCat) => void
  sectorFilter2: ExposureSector; setSectorFilter2: (v: ExposureSector) => void
  subSectorFilter2: ExposureSubSector; setSubSectorFilter2: (v: ExposureSubSector) => void
  onTodayDetail: () => void
  onYesterdayDetail: () => void
}) {
  const [rows, setRows]           = useState<PcDetailRow[]>([])
  const [today, setToday]         = useState("")
  const [yesterday, setYesterday] = useState("")
  const [loading, setLoading]     = useState(true)
  const [accountFilter, setAccountFilter] = useState("全部")
  const [optFilter2, setOptFilter2] = useState("仅期货")

  useEffect(() => {
    fetchJsonCached("/ma/api/mom-analysis/position-change-detail")
      .then(j => { if (j.ok) { setRows(j.rows ?? []); setToday(j.today ?? ""); setYesterday(j.yesterday ?? "") } })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const prods    = useMemo(() => ["全部", ...Array.from(new Set(rows.map(r => r.prod))).sort()], [rows])
  const accounts = useMemo(() => ["全部", ...Array.from(new Set(rows.map(r => r.account))).sort()], [rows])

  // Auto-cascade filters when prodFilter changes from parent (bar click)
  useEffect(() => {
    if (prodFilter === "全部") return
    const cat       = PROD_CAT[prodFilter]       as ExposureCat       | undefined
    const sector    = PROD_SECTOR[prodFilter]    as ExposureSector    | undefined
    const subSector = PROD_SUB_SECTOR[prodFilter] as ExposureSubSector | undefined
    if (cat)       setCatFilter2(cat)
    if (sector)    setSectorFilter2(sector)
    if (subSector) setSubSectorFilter2(subSector)
  }, [prodFilter])

  const availableProds2 = useMemo(() => {
    const allProds = Array.from(new Set(rows.map(r => r.prod)))
    if (subSectorFilter2 !== "全部") return allProds.filter(p => PROD_SUB_SECTOR[p] === subSectorFilter2)
    if (sectorFilter2    !== "全部") return allProds.filter(p => PROD_SECTOR[p]     === sectorFilter2)
    if (catFilter2       !== "全部") return allProds.filter(p => PROD_CAT[p]        === catFilter2)
    return allProds
  }, [rows, catFilter2, sectorFilter2, subSectorFilter2])

  const filtered = useMemo(() => {
    let f = rows
    if (prodFilter    !== "全部") f = f.filter(r => r.prod    === prodFilter)
    if (accountFilter !== "全部") f = f.filter(r => r.account === accountFilter)
    if (subSectorFilter2 !== "全部") f = f.filter(r => PROD_SUB_SECTOR[r.prod] === subSectorFilter2)
    else if (sectorFilter2 !== "全部") f = f.filter(r => PROD_SECTOR[r.prod] === sectorFilter2)
    else if (catFilter2    !== "全部") f = f.filter(r => PROD_CAT[r.prod]     === catFilter2)
    f = f.filter(r => {
      if (optFilter2 === "仅期货" && r.isOpt) return false
      if (optFilter2 === "仅期权" && !r.isOpt) return false
      return true
    })
    return f.slice(0, 500)
  }, [rows, prodFilter, accountFilter, optFilter2, catFilter2, sectorFilter2, subSectorFilter2])

  const totalAbsDelta = useMemo(() => filtered.reduce((s, r) => s + Math.abs(r.deltaLots), 0), [filtered])
  const totals = useMemo(() => ({
    deltaLots:     filtered.reduce((s, r) => s + r.deltaLots, 0),
    todayLots:     filtered.reduce((s, r) => s + r.todayLots, 0),
    yesterdayLots: filtered.reduce((s, r) => s + r.yesterdayLots, 0),
    todayMv:       filtered.reduce((s, r) => s + r.todayMv, 0),
    yesterdayMv:   filtered.reduce((s, r) => s + r.yesterdayMv, 0),
    deltaMv:       filtered.reduce((s, r) => s + r.deltaMv, 0),
  }), [filtered])

  const fmt      = (v: number) => v.toLocaleString("zh-CN")
  const fmtSign  = (v: number) => v === 0 ? "0" : `${v > 0 ? "+" : ""}${v.toLocaleString("zh-CN")}`
  const clr      = (v: number) => v > 0 ? "text-orange-500" : v < 0 ? "text-teal-400" : ""

  return (
    <Card id="section-pos-change" className="flex-1 min-w-0 h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3 flex-wrap">
          <CardTitle className="text-sm shrink-0">子账户-品种净持仓日变化汇总</CardTitle>
          <span className="text-[11px] text-muted-foreground">数据日期：今日 {today}；昨日 {yesterday}</span>
          <button
            onClick={onTodayDetail}
            className="ml-auto text-[11px] px-2.5 py-0.5 rounded border border-primary text-primary font-medium hover:bg-primary hover:text-primary-foreground transition-colors shrink-0"
          >今日详情 ↓</button>
          <button
            onClick={onYesterdayDetail}
            className="text-[11px] px-2.5 py-0.5 rounded border border-primary text-primary font-medium hover:bg-primary hover:text-primary-foreground transition-colors shrink-0"
          >昨日详情 ↓</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">账户名称：</span>
            <select className="border rounded px-2 py-0.5 bg-background text-xs" value={accountFilter} onChange={e => setAccountFilter(e.target.value)}>
              {accounts.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
              <span className="text-muted-foreground">品种类型：</span>
              <select className="border rounded px-2 py-0.5 bg-background text-xs" value={optFilter2} onChange={e => setOptFilter2(e.target.value)}>
                <option value="全部">全部</option>
                <option value="仅期货">仅期货</option>
                <option value="仅期权">仅期权</option>
              </select>
            </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">大类：</span>
            <select className="border rounded px-2 py-0.5 bg-background text-xs" value={catFilter2}
              onChange={e => { setCatFilter2(e.target.value as ExposureCat); setSectorFilter2("全部"); setSubSectorFilter2("全部"); setProdFilter("全部") }}>
              {EXPOSURE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">板块：</span>
            <select className="border rounded px-2 py-0.5 bg-background text-xs" value={sectorFilter2}
              onChange={e => { setSectorFilter2(e.target.value as ExposureSector); setSubSectorFilter2("全部"); setProdFilter("全部") }}>
              <option value="全部">全部</option>
              {(catFilter2 !== "全部" ? (CAT_TO_SECTORS[catFilter2] ?? []) : EXPOSURE_SECTORS.slice(1)).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">细分：</span>
            <select className="border rounded px-2 py-0.5 bg-background text-xs" value={subSectorFilter2}
              onChange={e => { setSubSectorFilter2(e.target.value as ExposureSubSector); setProdFilter("全部") }}>
              <option value="全部">全部</option>
              {(sectorFilter2 !== "全部"
                ? (SECTOR_TO_SUB_SECTORS[sectorFilter2] ?? [])
                : catFilter2 !== "全部"
                ? (CAT_TO_SECTORS[catFilter2] ?? []).flatMap(s => SECTOR_TO_SUB_SECTORS[s] ?? [])
                : EXPOSURE_SUB_SECTORS.slice(1)
              ).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">品种代码：</span>
            <select className="border rounded px-2 py-0.5 bg-background text-xs" value={prodFilter} onChange={e => setProdFilter(e.target.value)}>
              <option value="全部">全部</option>
              {availableProds2.sort().map(p => <option key={p} value={p}>{p === "全部" ? "全部" : `${p} ${PROD_NAMES[p] ?? ""}`}</option>)}
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto overflow-y-auto flex-1" style={{ minHeight: 0, maxHeight: '100%' }}>
        {loading ? (
          <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
        ) : (
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b bg-muted/30">
                <td className="px-3 py-1.5 font-semibold">合计</td>
                <td className="px-3 py-1.5">-</td>
                <td className="px-3 py-1.5">-</td>
                <td className={`px-3 py-1.5 text-right font-semibold ${clr(totals.deltaLots)}`}>{fmtSign(totals.deltaLots)}</td>
                <td className="px-3 py-1.5 text-right">100.00%</td>
                <td className="px-3 py-1.5 text-right">{totals.todayLots}</td>
                <td className="px-3 py-1.5 text-right">{totals.yesterdayLots}</td>
                <td className="px-3 py-1.5 text-right">{fmt(totals.todayMv)}</td>
                <td className="px-3 py-1.5 text-right">{fmt(totals.yesterdayMv)}</td>
                <td className={`px-3 py-1.5 text-right font-semibold ${clr(totals.deltaMv)}`}>{fmtSign(totals.deltaMv)}</td>
              </tr>
              <tr className="border-b bg-muted/50 text-muted-foreground">
                {["品种代码","品种名称","账户名称","手数变化","手数变化占比","今日净持仓手数","昨日净持仓手数","今日净持仓市值","昨日净持仓市值","市值变化"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const pct = totalAbsDelta > 0 ? (Math.abs(r.deltaLots) / totalAbsDelta * 100).toFixed(2) : "0.00"
                return (
                  <tr key={i} className="border-b hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-1.5 font-mono">{r.prod}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{PROD_NAMES[r.prod] ?? ""}</td>
                    <td className="px-3 py-1.5">{r.account}</td>
                    <td className={`px-3 py-1.5 text-right ${clr(r.deltaLots)}`}>{fmtSign(r.deltaLots)}</td>
                    <td className="px-3 py-1.5 text-right">{pct}%</td>
                    <td className="px-3 py-1.5 text-right">{r.todayLots}</td>
                    <td className="px-3 py-1.5 text-right">{r.yesterdayLots}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(r.todayMv)}</td>
                    <td className="px-3 py-1.5 text-right">{fmt(r.yesterdayMv)}</td>
                    <td className={`px-3 py-1.5 text-right ${clr(r.deltaMv)}`}>{fmtSign(r.deltaMv)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

function PositionChangeChart({ onProdClick, sectorFilter, subSectorFilter }: { onProdClick: (prod: string) => void; sectorFilter: string; subSectorFilter: string }) {
  const [posDataRaw, setPosDataRaw]   = useState<PcRow[]>([])
  const [varProds, setVarProds] = useState<{ prod: string; sigma: number; mv: number }[]>([])
  const [corrMatrix, setCorrMatrix] = useState<number[][]>([])
  const [today, setToday]           = useState("")
  const [yesterday, setYesterday]   = useState("")
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    let doneCount = 0
    const maybeFinish = () => { if (++doneCount >= 2) setLoading(false) }

    fetchJsonCached("/ma/api/mom-analysis/position-change").then(pcJ => {
      if (pcJ.ok) { setPosDataRaw(pcJ.products ?? []); setToday(pcJ.today ?? ""); setYesterday(pcJ.yesterday ?? "") }
    }).catch(() => {}).finally(maybeFinish)

    fetchJsonCached("/ma/api/mom-analysis/var-sandbox").then(varJ => {
      if (varJ.ok) { setVarProds(varJ.products ?? []); setCorrMatrix(varJ.corrMatrix ?? []) }
    }).catch(() => {}).finally(maybeFinish)
  }, [])

  // Apply sector / sub-sector filter
  const posData = useMemo(() => posDataRaw.filter(d => {
    if (sectorFilter !== "全部" && (PROD_SECTOR[d.prod] ?? "其他") !== sectorFilter) return false
    if (subSectorFilter !== "全部" && (PROD_SUB_SECTOR[d.prod] ?? "其他") !== subSectorFilter) return false
    return true
  }), [posDataRaw, sectorFilter, subSectorFilter])

  // Marginal risk coefficients (mrc_i) — used for both ΔVaR and ordering
  const deltaVarMap = useMemo(() => {
    if (!varProds.length || !corrMatrix.length) return new Map<string, number>()
    const Z = 2.326 // 99% confidence
    const n = varProds.length
    const dv = varProds.map(p => p.sigma * p.mv) // σ_i × mv_i
    let varPort = 0
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        varPort += dv[i] * (corrMatrix[i]?.[j] ?? 0) * dv[j]
    const sigmaPort = Math.sqrt(varPort)
    if (sigmaPort === 0) return new Map<string, number>()
    const prodToIdx = new Map(varProds.map((p, i) => [p.prod, i]))
    const mrc = varProds.map((p, i) => {
      let sum = 0
      for (let j = 0; j < n; j++) sum += (corrMatrix[i]?.[j] ?? 0) * dv[j]
      return p.sigma * sum / sigmaPort
    })
    const map = new Map<string, number>()
    for (const d of posData) {
      const idx = prodToIdx.get(d.prod)
      if (idx !== undefined) map.set(d.prod, Math.round(Z * mrc[idx] * d.deltaMv))
    }
    return map
  }, [varProds, corrMatrix, posData])

  // Sort changed products by |ΔVaR| descending, append any with no VaR data at end
  const chartData = useMemo(() => {
    return [...posData].sort((a, b) => {
      const da = Math.abs(deltaVarMap.get(a.prod) ?? 0)
      const db = Math.abs(deltaVarMap.get(b.prod) ?? 0)
      if (db !== da) return db - da
      return Math.abs(b.deltaMv) - Math.abs(a.deltaMv)
    })
  }, [posData, deltaVarMap])

  // Marginal VaR contribution order from var-sandbox data (kept for reference, no longer used for sort)
  const marginalOrder = useMemo(() => {
    if (!varProds.length || !corrMatrix.length) return []
    const dv = varProds.map(p => p.sigma * p.mv)
    return varProds
      .map((p, i) => {
        let covSum = 0
        for (let j = 0; j < dv.length; j++) covSum += dv[j] * (corrMatrix[i]?.[j] ?? 0)
        return { prod: p.prod, mcr: Math.abs(dv[i] * covSum) }
      })
      .sort((a, b) => b.mcr - a.mcr)
      .map(x => x.prod)
  }, [varProds, corrMatrix])

  const option = useMemo(() => {
    if (!chartData.length) return {}
    // Reverse for ECharts (bottom-to-top axis with inverse:true shows first item at top)
    const data = [...chartData].reverse()
    const categories = data.map(d => `${d.prod} (${PROD_NAMES[d.prod] ?? d.prod})`)
    const sign = (n: number) => `${n > 0 ? "+" : ""}${n}`
    const fmtWan = (v: number) => `${v > 0 ? "+" : ""}${(v / 10000).toFixed(1)}万`

    const fmtVarWan = (v: number) => `${v > 0 ? "+" : ""}${(v / 10000).toFixed(2)}万`

    return {
      title: {
        text: `持仓变化与颠个風险贡献（${today} vs ${yesterday}）`,
        textStyle: { fontSize: 12, fontWeight: "normal" },
        show: false,
      },
      legend: {
        data: ["市值变化", "ΔVaR贡献(99%)"],
        bottom: 4,
        textStyle: { fontSize: 11 },
        itemWidth: 14, itemHeight: 10,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { dataIndex: number; name: string }[]) => {
          const p = params[0]
          const d = data[p.dataIndex]
          if (!d) return ""
          const dvar = deltaVarMap.get(d.prod) ?? 0
          const dvarStr = dvar > 0
            ? `<span style="color:#f97316">+${(dvar/10000).toFixed(2)}万 ▲风险增加</span>`
            : dvar < 0
            ? `<span style="color:#60a5fa">${(dvar/10000).toFixed(2)}万 ▼风险降低</span>`
            : "—"
          return [
            `<b>${p.name}</b>`,
            `手数变化：<b>${sign(d.deltaLots)}手</b>`,
            `市值变化：<b>${fmtWan(d.deltaMv)}</b>`,
            `ΔVaR贡献：<b>${dvarStr}</b>`,
            `今日仓位：${sign(d.todayLots)}手 / ${fmtWan(d.todayMv)}`,
            `昨日仓位：${sign(d.yesterdayLots)}手 / ${fmtWan(d.yesterdayMv)}`,
          ].join("<br/>")
        },
      },
      grid: { left: 4, right: 24, top: 24, bottom: 30, containLabel: true },
      xAxis: [
        {
          type: "value",
          axisLabel: { formatter: (v: number) => `${(v / 10000).toFixed(0)}万`, fontSize: 10 },
          splitLine: { lineStyle: { type: "dashed" } },
        },
        {
          type: "value",
          position: "top",
          axisLabel: { formatter: (v: number) => `${(v / 10000).toFixed(1)}万`, fontSize: 10 },
          splitLine: { show: false },
          axisLine: { show: true, lineStyle: { color: "#f97316", opacity: 0.6 } },
          axisTick: { show: true },
        },
      ],
      yAxis: {
        type: "category",
        data: categories,
        axisLabel: { fontSize: 11 },
      },
      dataZoom: [
        {
          type: "slider",
          yAxisIndex: 0,
          orient: "vertical",
          right: 0,
          startValue: data.length - 1 - 0,       // top item (highest |ΔVaR|)
          endValue: data.length - 1 - Math.min(11, data.length - 1), // show ~12
          width: 14,
          handleSize: "80%",
          brushSelect: false,
          fillerColor: "rgba(100,100,100,0.15)",
          borderColor: "transparent",
        },
        { type: "inside", yAxisIndex: 0, zoomOnMouseWheel: false, moveOnMouseWheel: true, moveOnMouseMove: false },
      ],
      series: [
        {
          name: "市值变化",
          type: "bar",
          xAxisIndex: 0,
          barMaxWidth: 20,
          data: data.map(d => ({
            value: d.deltaMv,
            itemStyle: { color: d.deltaMv >= 0 ? "#10b981" : "#f87171" },
          })),
          label: {
            show: true,
            formatter: (params: { dataIndex: number }) => {
              const d = data[params.dataIndex]
              return `${sign(d.deltaLots)}手`
            },
            position: (params: { value: number }) => params.value >= 0 ? "right" : "left",
            color: "#888",
            fontSize: 11,
          },
        },
        {
          name: "ΔVaR贡献(99%)",
          type: "bar",
          xAxisIndex: 1,
          barMaxWidth: 14,
          barGap: "20%",
          data: data.map(d => {
            const dv = deltaVarMap.get(d.prod) ?? 0
            return {
              value: dv,
              itemStyle: { color: dv > 0 ? "rgba(249,115,22,0.75)" : "rgba(96,165,250,0.75)" },
            }
          }),
          label: {
            show: true,
            formatter: (params: { value: unknown }) => {
              const v = typeof params.value === "number" ? params.value : 0
              return v !== 0 ? fmtVarWan(v) : ""
            },
            position: (params: { value: unknown }) => (typeof params.value === "number" ? params.value : 0) >= 0 ? "right" : "left",
            color: "#888",
            fontSize: 10,
          },
        },
      ],
    }
  }, [chartData, today, yesterday, deltaVarMap])

  if (loading) return <p className="text-sm text-muted-foreground py-4">加载中...</p>
  if (!chartData.length) return <p className="text-sm text-muted-foreground py-4">暂无持仓变化数据</p>

  const onEvents = {
    click: (params: { dataIndex: number; componentType: string }) => {
      if (params.componentType !== "series") return
      const d = [...chartData].reverse()[params.dataIndex]
      if (d) onProdClick(d.prod)
    },
  }

  return <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge onEvents={onEvents} />
}

function OptionHoldingContent() {
  const [rows, setRows] = useState<OptionRow[]>([])
  const [date, setDate] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [tableExpanded, setTableExpanded] = useState(false)
  const [contractSearch, setContractSearch] = useState("")
  const [accountFilter, setAccountFilter] = useState("全部")
  const [tradeDateFilter, setTradeDateFilter] = useState("全部")
  const [prodFilter2, setProdFilter2] = useState("全部")
  const [dirFilter, setDirFilter] = useState("全部")
  const [optTypeFilter, setOptTypeFilter] = useState("全部")
  const [pnlFilter, setPnlFilter] = useState("全部")

  useEffect(() => {
    if (!tableExpanded || hasLoadedOnce) return
    setLoading(true)
    fetchJsonCached("/ma/api/mom-analysis/option-positions")
      .then(j => {
        if (j.ok) {
          setRows(j.rows ?? [])
          setDate(j.date ?? "")
          setHasLoadedOnce(true)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tableExpanded, hasLoadedOnce])

  const accounts   = useMemo(() => ["全部", ...Array.from(new Set(rows.map(r => r.account))).sort()], [rows])
  const tradeDates = useMemo(() => ["全部", ...Array.from(new Set(rows.map(r => r.tradeDate).filter(Boolean))).sort().reverse()], [rows])
  const prodCodes  = useMemo(() => {
    const codes = Array.from(new Set(rows.map(r => r.contract.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "").filter(Boolean))).sort()
    return ["全部", ...codes]
  }, [rows])

  const filtered = useMemo(() => rows.filter(r => {
    if (contractSearch && !r.contract.toLowerCase().includes(contractSearch.toLowerCase())) return false
    if (prodFilter2 !== "全部" && (r.contract.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "") !== prodFilter2) return false
    if (accountFilter !== "全部" && r.account !== accountFilter) return false
    if (tradeDateFilter !== "全部" && r.tradeDate !== tradeDateFilter) return false
    if (dirFilter !== "全部") {
      if (dirFilter === "买入" && r.longLots <= 0) return false
      if (dirFilter === "卖出" && r.shortLots <= 0) return false
    }
    if (optTypeFilter !== "全部" && r.optionType !== optTypeFilter) return false
    if (pnlFilter !== "全部") {
      if (pnlFilter === "盈利" && r.floatingPnl <= 0) return false
      if (pnlFilter === "亏损" && r.floatingPnl >= 0) return false
    }
    return true
  }), [rows, contractSearch, prodFilter2, accountFilter, tradeDateFilter, dirFilter, optTypeFilter, pnlFilter])

  const totalMargin    = filtered.reduce((s, r) => s + r.margin, 0)
  const totalCost      = filtered.reduce((s, r) => s + r.cost, 0)
  const totalMv        = filtered.reduce((s, r) => s + r.marketValue, 0)
  const totalPnl       = filtered.reduce((s, r) => s + r.floatingPnl, 0)
  const totalLongLots  = filtered.reduce((s, r) => s + r.longLots, 0)
  const totalShortLots = filtered.reduce((s, r) => s + r.shortLots, 0)

  const fmt = (v: number) => v.toLocaleString("zh-CN")
  const fmtP = (v: number) => <span className={v > 0 ? "text-orange-500" : v < 0 ? "text-teal-400" : ""}>{fmt(v)}</span>

  const resetFilters = () => {
    setContractSearch(""); setProdFilter2("全部"); setAccountFilter("全部"); setTradeDateFilter("全部")
    setDirFilter("全部"); setOptTypeFilter("全部"); setPnlFilter("全部")
  }

  return (
    <Card className="mt-6">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">期权持仓明细（最新交易日汇总）{date && <span className="ml-2 text-xs font-normal text-muted-foreground">{date}</span>}</CardTitle>
          <button
            type="button"
            onClick={() => setTableExpanded((v) => !v)}
            className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            {tableExpanded ? "收起" : "展开"}
          </button>
        </div>
        {!tableExpanded && <p className="mt-2 text-xs text-muted-foreground">默认收起，点击“展开”查看筛选和明细表。</p>}
        {tableExpanded && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">合约：</span>
                <input
                  className="border rounded px-2 py-0.5 bg-background w-28 text-xs"
                  placeholder="包含..."
                  value={contractSearch}
                  onChange={e => setContractSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">品种：</span>
                <select className="border rounded px-2 py-0.5 bg-background text-xs" value={prodFilter2} onChange={e => setProdFilter2(e.target.value)}>
                  {prodCodes.map(p => <option key={p} value={p}>{p === "全部" ? "全部" : `${p} ${PROD_NAMES[p] ?? ""}`}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">账户：</span>
                <select className="border rounded px-2 py-0.5 bg-background text-xs" value={accountFilter} onChange={e => setAccountFilter(e.target.value)}>
                  {accounts.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">成交日期：</span>
                <select className="border rounded px-2 py-0.5 bg-background text-xs" value={tradeDateFilter} onChange={e => setTradeDateFilter(e.target.value)}>
                  {tradeDates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">方向：</span>
                <select className="border rounded px-2 py-0.5 bg-background text-xs" value={dirFilter} onChange={e => setDirFilter(e.target.value)}>
                  {["全部","买入","卖出"].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">期权类型：</span>
                <select className="border rounded px-2 py-0.5 bg-background text-xs" value={optTypeFilter} onChange={e => setOptTypeFilter(e.target.value)}>
                  {["全部","C","P"].map(t => <option key={t} value={t}>{t === "C" ? "C（认购）" : t === "P" ? "P（认沽）" : "全部"}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">浮动盈亏：</span>
                <select className="border rounded px-2 py-0.5 bg-background text-xs" value={pnlFilter} onChange={e => setPnlFilter(e.target.value)}>
                  {["全部","盈利","亏损"].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <button onClick={resetFilters} className="px-2.5 py-0.5 border rounded text-xs hover:bg-muted transition-colors">重置</button>
            </div>
          </>
        )}
      </CardHeader>
      {tableExpanded && (
      <CardContent className="p-0 overflow-x-auto overflow-y-auto" style={{ maxHeight: 480 }}>
        {loading ? (
          <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground px-4 py-6">暂无期权持仓数据</p>
        ) : (
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="sticky top-0 bg-card z-10">
              {/* Totals summary row */}
              <tr className="border-b bg-muted/30 text-muted-foreground">
                <td colSpan={3} />
                <td className="px-3 py-1 text-right font-medium text-orange-500">{totalLongLots > 0 ? totalLongLots : ""}</td>
                <td />
                <td className="px-3 py-1 text-right font-medium text-teal-400">{totalShortLots > 0 ? totalShortLots : ""}</td>
                <td colSpan={4} />
                <td className="px-3 py-1 text-right font-medium text-foreground">{fmt(totalMargin)}</td>
                <td colSpan={2} />
                <td className="px-3 py-1 text-right font-medium text-foreground">{fmt(totalCost)}</td>
                <td className="px-3 py-1 text-right font-medium text-foreground">{fmt(totalMv)}</td>
                <td className={`px-3 py-1 text-right font-medium ${totalPnl > 0 ? "text-orange-500" : totalPnl < 0 ? "text-teal-400" : "text-foreground"}`}>{fmt(totalPnl)}</td>
              </tr>
              {/* Column headers */}
              <tr className="border-b bg-muted/50 text-muted-foreground">
                {["合约","品种","账户","买持仓","买入价","卖持仓","卖出价","昨结算价","投机/套保","成交日期","保证金","交易所","合约乘数","成本","市值","浮动盈亏"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-1.5 font-mono">{r.contract}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{PROD_NAMES[r.contract.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? ""] ?? ""}</td>
                  <td className="px-3 py-1.5">{r.account}</td>
                  <td className={`px-3 py-1.5 text-right ${r.longLots > 0 ? "text-orange-500" : "text-muted-foreground"}`}>{r.longLots}</td>
                  <td className="px-3 py-1.5 text-right">{r.buyPrice > 0 ? r.buyPrice.toFixed(2) : "0.00"}</td>
                  <td className={`px-3 py-1.5 text-right ${r.shortLots > 0 ? "text-teal-400" : "text-muted-foreground"}`}>{r.shortLots}</td>
                  <td className="px-3 py-1.5 text-right">{r.sellPrice > 0 ? r.sellPrice.toFixed(2) : "0.00"}</td>
                  <td className="px-3 py-1.5 text-right">{r.prevSettle.toFixed(2)}</td>
                  <td className="px-3 py-1.5">{r.hedgeType}</td>
                  <td className="px-3 py-1.5">{r.tradeDate}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(r.margin)}</td>
                  <td className="px-3 py-1.5">{r.exchange}</td>
                  <td className="px-3 py-1.5 text-right">{r.multiplier}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(r.cost)}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(r.marketValue)}</td>
                  <td className="px-3 py-1.5 text-right">{fmtP(r.floatingPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
      )}
    </Card>
  )
}

// ── Today Position Detail ─────────────────────────────────────────────────────
type TodayPosRow = {
  account: string; contract: string
  longLots: number; buyPrice: number
  shortLots: number; sellPrice: number
  prevSettle: number; positionPnl: number
  hedgeType: string; tradeDateRaw: string
  positionMv: number; margin: number; exchange: string
}

function TodayPositionSection({ prodOverride, onScrollBack, dateOverride, dayRank, sectionId, dayLabel, expandTrigger }: {
  prodOverride?: string
  onScrollBack?: () => void
  dateOverride?: string
  dayRank?: number
  sectionId?: string
  dayLabel?: string
  expandTrigger?: number
}) {
  const [rows, setRows]       = useState<TodayPosRow[]>([])
  const [date, setDate]       = useState("")
  const [loading, setLoading] = useState(false)
  const [sectionExpanded, setSectionExpanded] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)

  // Parent can force-open by incrementing expandTrigger
  useEffect(() => {
    if (expandTrigger && expandTrigger > 0) setSectionExpanded(true)
  }, [expandTrigger])

  // filters
  const [contractInput, setContractInput] = useState("")
  const [prodSelect, setProdSelect]       = useState("全部")

  // Sync with external product override
  useEffect(() => {
    if (prodOverride != null) setProdSelect(prodOverride)
  }, [prodOverride])
  const [accountFilter, setAccountFilter] = useState("全部")
  const [catFilter, setCatFilter]         = useState("全部")
  const [sectorFilter, setSectorFilter]   = useState("全部")
  const [dirFilter, setDirFilter]         = useState("全部")   // 全部 / 买 / 卖
  const [optFilter, setOptFilter]         = useState("仅期货")   // 全部 / 仅期货 / 仅期权

  useEffect(() => {
    if (!sectionExpanded || hasLoadedOnce) return
    setLoading(true)
    const url = dateOverride
      ? `/ma/api/mom-analysis/today-position-detail?date=${dateOverride}`
      : dayRank === 2
      ? "/ma/api/mom-analysis/today-position-detail?rank=2"
      : "/ma/api/mom-analysis/today-position-detail"
    fetchJsonCached(url)
      .then(j => { if (j.ok) { setRows(j.rows ?? []); setDate(j.date ?? ""); setHasLoadedOnce(true) } })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [sectionExpanded, hasLoadedOnce])

  const getProd = (contract: string) => contract.match(/^[A-Z]+/)?.[0] ?? ""

  // unique filter options
  const prods    = useMemo(() => ["全部", ...Array.from(new Set(rows.map(r => getProd(r.contract)))).filter(Boolean).sort()], [rows])
  const accounts = useMemo(() => ["全部", ...Array.from(new Set(rows.map(r => r.account))).filter(Boolean).sort()], [rows])
  const cats     = useMemo(() => ["全部", ...Array.from(new Set(rows.map(r => PROD_CAT[getProd(r.contract)] ?? "其他"))).sort()], [rows])
  const sectors  = useMemo(() => ["全部", ...Array.from(new Set(rows.map(r => PROD_SECTOR[getProd(r.contract)] ?? "其他"))).sort()], [rows])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const prod = getProd(r.contract)
      if (contractInput && !r.contract.includes(contractInput.toUpperCase())) return false
      if (prodSelect !== "全部" && prod !== prodSelect) return false
      if (accountFilter !== "全部" && r.account !== accountFilter) return false
      if (catFilter !== "全部" && (PROD_CAT[prod] ?? "其他") !== catFilter) return false
      if (sectorFilter !== "全部" && (PROD_SECTOR[prod] ?? "其他") !== sectorFilter) return false
      if (dirFilter === "买" && r.longLots <= 0) return false
      if (dirFilter === "卖" && r.shortLots <= 0) return false
      const isOpt = /^[A-Z]+\d+-?[CP]-?\d+$/.test(r.contract)
      if (optFilter === "仅期货" && isOpt) return false
      if (optFilter === "仅期权" && !isOpt) return false
      return true
    })
  }, [rows, contractInput, prodSelect, accountFilter, catFilter, sectorFilter, dirFilter, optFilter])

  const [pieDim, setPieDim] = useState<"account" | "product" | "contract">("account")
  const [mergeMode, setMergeMode] = useState<"none" | "byAccount" | "allAccount">("none")
  const [barStack, setBarStack] = useState(false)

  // Auto-switch pie dimension based on table filters / merge mode
  useEffect(() => {
    if (mergeMode !== "none") setPieDim("contract")
    else if (prodSelect !== "全部") setPieDim("account")
    else if (accountFilter !== "全部") setPieDim("product")
  }, [mergeMode, prodSelect, accountFilter])

  // Pie source rows: apply table filters (all except dirFilter, since pies already split by long/short)
  const pieSourceRows = useMemo(() => rows.filter(r => {
    const prod = getProd(r.contract)
    if (contractInput && !r.contract.includes(contractInput.toUpperCase())) return false
    if (prodSelect !== "全部" && prod !== prodSelect) return false
    if (accountFilter !== "全部" && r.account !== accountFilter) return false
    if (catFilter !== "全部" && (PROD_CAT[prod] ?? "其他") !== catFilter) return false
    if (sectorFilter !== "全部" && (PROD_SECTOR[prod] ?? "其他") !== sectorFilter) return false
    const isOpt = /^[A-Z]+\d+-?[CP]-?\d+$/.test(r.contract)
    if (optFilter === "仅期货" && isOpt) return false
    if (optFilter === "仅期权" && !isOpt) return false
    return true
  }), [rows, contractInput, prodSelect, accountFilter, catFilter, sectorFilter, optFilter])

  // Pie chart data: aggregate by selected dimension from filtered source
  const buildPieData = (dimKey: "account" | "product" | "contract", dir: "long" | "short") => {
    const map = new Map<string, number>()
    for (const r of pieSourceRows) {
      if (dir === "long"  && r.longLots  <= 0) continue
      if (dir === "short" && r.shortLots <= 0) continue
      const key = dimKey === "account" ? r.account
                : dimKey === "product" ? getProd(r.contract)
                : r.contract
      map.set(key, (map.get(key) ?? 0) + r.positionMv)
    }
    return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }

  const longPieData  = useMemo(() => buildPieData(pieDim, "long"),  [pieSourceRows, pieDim])
  const shortPieData = useMemo(() => buildPieData(pieDim, "short"), [pieSourceRows, pieDim])

  const totalLongMv  = useMemo(() => longPieData.reduce((s, d) => s + d.value, 0), [longPieData])
  const totalShortMv = useMemo(() => shortPieData.reduce((s, d) => s + d.value, 0), [shortPieData])

  const barData = useMemo(() => {
    const longMap  = new Map(longPieData.map(d => [d.name, d.value]))
    const shortMap = new Map(shortPieData.map(d => [d.name, d.value]))
    const keys = [...new Set([...longPieData.map(d => d.name), ...shortPieData.map(d => d.name)])]
    return keys
      .map(k => ({ name: k, long: longMap.get(k) ?? 0, short: shortMap.get(k) ?? 0 }))
      .sort((a, b) => (b.long + b.short) - (a.long + a.short))
  }, [longPieData, shortPieData])

  const PIE_COLORS = [
    "#4E9FD4","#5CB87A","#F5A623","#E8605A","#9B72CF","#F07E3B","#3ABFB1","#E05C8A",
    "#2E86AB","#D4A017","#6A5ACD","#2EAF7D","#D45A3A","#5B8DD9","#C97B2C","#8E6BB0",
  ]
  const pieOption = (title: string, data: { name: string; value: number }[], total: number) => ({
    color: PIE_COLORS,
    title: title ? { text: title, textStyle: { fontSize: 12, fontWeight: "normal" as const }, left: "center", top: 4 } : undefined,
    tooltip: {
      trigger: "item" as const,
      formatter: (p: { name: string; value: number; percent: number }) => {
        let label = p.name
        if (pieDim === "product") {
          const cn = PROD_NAMES[p.name] ?? ""
          if (cn) label = `${p.name} ${cn}`
        } else if (pieDim === "contract") {
          const prefix = p.name.match(/^[A-Z]+/)?.[0] ?? ""
          const cn = PROD_NAMES[prefix] ?? ""
          if (cn) label = `${p.name} ${cn}`
        }
        return `${label}<br/>市值：${Math.round(p.value / 1e4)}万<br/>占比：${p.percent.toFixed(2)}%`
      },
    },
    legend: {
      type: "scroll" as const,
      orient: "vertical" as const,
      right: 4,
      top: 30,
      bottom: 4,
      textStyle: { fontSize: 10 },
      pageTextStyle: { fontSize: 10 },
      formatter: (name: string) => {
        const d = data.find(x => x.name === name)
        if (!d || total === 0) return name
        const pct = (d.value / total * 100).toFixed(2)
        if (pieDim === "product") {
          const cn = PROD_NAMES[name] ?? ""
          return cn ? `${name} ${cn} ${pct}%` : `${name} ${pct}%`
        }
        if (pieDim === "contract") {
          const prefix = name.match(/^[A-Z]+/)?.[0] ?? ""
          const cn = PROD_NAMES[prefix] ?? ""
          return cn ? `${name} ${cn} ${pct}%` : `${name} ${pct}%`
        }
        return `${name} ${pct}%`
      },
    },
    series: [{
      type: "pie" as const,
      radius: "70%",
      center: ["30%", "55%"],
      data: data.length > 0 ? data : [{ name: "暂无数据", value: 1, itemStyle: { color: "#ccc" } }],
      label: { show: false },
      labelLine: { show: false },
      emphasis: { label: { show: false } },
    }],
  })

  const barDimLabel = (name: string) => {
    if (pieDim === "product") { const cn = PROD_NAMES[name] ?? ""; return cn ? `${name} ${cn}` : name }
    if (pieDim === "contract") { const prefix = name.match(/^[A-Z]+/)?.[0] ?? ""; const cn = PROD_NAMES[prefix] ?? ""; return cn ? `${name} ${cn}` : name }
    return name
  }
  const label = dayLabel ?? "今日"
  const barTitle = pieDim === "account" ? `${label}账户持仓市值` : pieDim === "product" ? "品种持仓市值" : "合约持仓市值"
  const barOption = () => {
    if (barStack) {
      // Stacked mode: 2 categories (买持仓 / 卖持仓), each key is a series segment
      const stackSeries = barData.map((d, i) => ({
        name: barDimLabel(d.name),
        type: "bar" as const,
        stack: "total",
        data: [d.long, d.short],
        itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] },
        barMaxWidth: 60,
      }))
      return {
        tooltip: {
          trigger: "axis" as const,
          axisPointer: { type: "shadow" as const },
          formatter: (params: { seriesName: string; value: number }[]) => {
            const total = params.reduce((s, p) => s + (p.value || 0), 0)
            const lines = params
              .filter(p => p.value > 0)
              .sort((a, b) => b.value - a.value)
              .map(p => `${p.seriesName}：${Math.round(p.value / 1e4)}万`)
            return `合计：${Math.round(total / 1e4)}万<br/>` + lines.join("<br/>")
          },
        },
        legend: { show: false },
        grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
        xAxis: { type: "category" as const, data: ["买持仓", "卖持仓"], axisLabel: { fontSize: 11 } },
        yAxis: { type: "value" as const, axisLabel: { fontSize: 9, formatter: (v: number) => `${(v / 1e4).toFixed(0)}万` } },
        series: stackSeries,
      }
    }
    return {
      color: ["#4E9FD4", "#E8605A"],
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        formatter: (params: { seriesName: string; name: string; value: number }[]) =>
          `${barDimLabel(params[0].name)}<br/>` +
          params.map(p => `${p.seriesName}：${Math.round(p.value / 1e4)}万`).join("<br/>")
      },
      legend: { data: ["买持仓", "卖持仓"], top: 4, textStyle: { fontSize: 10 } },
      grid: { left: 8, right: 8, top: 36, bottom: 4, containLabel: true },
      xAxis: {
        type: "category" as const,
        data: barData.map(d => d.name),
        axisLabel: { fontSize: 9, rotate: 45, formatter: (name: string) => barDimLabel(name) },
      },
      yAxis: { type: "value" as const, axisLabel: { fontSize: 9, formatter: (v: number) => `${(v / 1e4).toFixed(0)}万` } },
      series: [
        { name: "买持仓", type: "bar" as const, data: barData.map(d => d.long),  barMaxWidth: 16 },
        { name: "卖持仓", type: "bar" as const, data: barData.map(d => d.short), barMaxWidth: 16 },
      ],
    }
  }

  const fmt      = (v: number) => v.toLocaleString("zh-CN")
  const fmtSign  = (v: number) => v === 0 ? "0" : `${v > 0 ? "+" : ""}${v.toLocaleString("zh-CN")}`
  const pnlColor = (v: number) => v > 0 ? "text-orange-500" : v < 0 ? "text-teal-400" : ""

  const displayRows = useMemo(() => {
    if (mergeMode === "none") return filtered
    const map = new Map<string, TodayPosRow & { _count: number; _netMv: number }>()
    for (const r of filtered) {
      const key = mergeMode === "byAccount" ? `${r.contract}||${r.account}` : r.contract
      const ex = map.get(key)
      const rNetMv = r.longLots > 0 ? r.positionMv : -r.positionMv
      if (!ex) {
        map.set(key, { ...r, _count: 1, _netMv: rNetMv })
      } else {
        const totalLong  = ex.longLots  + r.longLots
        const totalShort = ex.shortLots + r.shortLots
        ex.buyPrice    = totalLong  > 0 ? (ex.buyPrice  * ex.longLots  + r.buyPrice  * r.longLots)  / totalLong  : 0
        ex.sellPrice   = totalShort > 0 ? (ex.sellPrice * ex.shortLots + r.sellPrice * r.shortLots) / totalShort : 0
        ex.prevSettle  = (ex.prevSettle * ex._count + r.prevSettle) / (ex._count + 1)
        ex.longLots    = totalLong
        ex.shortLots   = totalShort
        ex.positionPnl += r.positionPnl
        ex.positionMv  += r.positionMv
        ex.margin      += r.margin
        ex._netMv      += rNetMv
        ex.account     = mergeMode === "allAccount" ? "全部账户" : ex.account
        ex.tradeDateRaw = "-"
        ex.hedgeType   = ex.hedgeType === r.hedgeType ? ex.hedgeType : "混合"
        ex._count++
      }
    }
    return [...map.values()]
  }, [filtered, mergeMode])

  const uniqueAccounts = useMemo(() => new Set(filtered.map(r => r.account)).size, [filtered])

  // totals for summary row
  const totals = useMemo(() => ({
    netMv:  displayRows.reduce((s, r) => s + ((r as any)._netMv ?? (r.longLots > 0 ? r.positionMv : -r.positionMv)), 0),
    netLots: displayRows.reduce((s, r) => s + r.longLots - r.shortLots, 0),
    longLots: displayRows.reduce((s, r) => s + r.longLots, 0),
    shortLots: displayRows.reduce((s, r) => s + r.shortLots, 0),
    pnl: displayRows.reduce((s, r) => s + r.positionPnl, 0),
    positionMv: displayRows.reduce((s, r) => s + r.positionMv, 0),
    margin: displayRows.reduce((s, r) => s + r.margin, 0),
  }), [displayRows])

  return (
    <div id={sectionId ?? "section-today-position"} className="mt-6">
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">子账户{label}持仓明细{date && <span className="ml-2 text-xs font-normal text-muted-foreground">{date}</span>}</CardTitle>
            <button
              type="button"
              onClick={() => setSectionExpanded((v) => !v)}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              {sectionExpanded ? "收起" : "展开"}
            </button>
          </div>
          {!sectionExpanded && <p className="mt-2 text-xs text-muted-foreground">默认收起，点击"展开"查看图表和明细表。</p>}
        </CardHeader>
      </Card>

      {sectionExpanded && (<>
      {/* Pie charts row */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-xs font-medium">{label}买持仓市值</CardTitle>
              <div className="flex border rounded overflow-hidden text-[11px]">
                {([["account", "账户"], ["product", "品种"], ["contract", "合约"]] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setPieDim(val)}
                    className={`px-2 py-0.5 transition-colors ${pieDim === val ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            {loading
              ? <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">加载中...</div>
              : <ReactECharts option={pieOption("", longPieData, totalLongMv)} style={{ height: 280 }} notMerge />
            }
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-xs font-medium">{label}卖持仓市值</CardTitle>
              <div className="flex border rounded overflow-hidden text-[11px]">
                {([["account", "账户"], ["product", "品种"], ["contract", "合约"]] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setPieDim(val)}
                    className={`px-2 py-0.5 transition-colors ${pieDim === val ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            {loading
              ? <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">加载中...</div>
              : <ReactECharts option={pieOption("", shortPieData, totalShortMv)} style={{ height: 280 }} notMerge />
            }
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-xs font-medium">{barTitle}</CardTitle>
              <button onClick={() => setBarStack(v => !v)}
                className={`text-[11px] border rounded px-2 py-0.5 transition-colors ${barStack ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                合并
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            {loading
              ? <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">加载中...</div>
              : <ReactECharts option={barOption()} style={{ height: 280 }} notMerge />
            }
          </CardContent>
        </Card>
      </div>

      {/* Detail table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-sm shrink-0">子账户{label}持仓明细</CardTitle>
            <span className="text-[11px] text-muted-foreground">
              最新日期：{date}，展示行数：{displayRows.length}（过滤后：{filtered.length}，总行数：{rows.length}），账户数：{uniqueAccounts}
            </span>
            <button
              onClick={onScrollBack}
              className="ml-auto text-[11px] px-2.5 py-0.5 rounded border border-primary text-primary font-medium hover:bg-primary hover:text-primary-foreground transition-colors shrink-0"
            >↑ 返回持仓变化</button>
            <div className="flex border rounded overflow-hidden text-[11px]">
              {([["none", "明细"] , ["byAccount", "合并(按账户)"], ["allAccount", "合并(全账户)"]] as const).map(([val, label]) => (
                <button key={val} onClick={() => setMergeMode(val)}
                  className={`px-2 py-0.5 transition-colors ${mergeMode === val ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-2 text-xs">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">品种代码：</span>
              <input
                className="border rounded px-2 py-0.5 bg-background text-xs w-24"
                placeholder="输入品种代码"
                value={contractInput}
                onChange={e => setContractInput(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">品种选择：</span>
              <select className="border rounded px-2 py-0.5 bg-background text-xs" value={prodSelect} onChange={e => setProdSelect(e.target.value)}>
                {prods.map(p => <option key={p} value={p}>{p === "全部" ? "全部" : `${p} ${PROD_NAMES[p] ?? ""}`}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">账户名称：</span>
              <select className="border rounded px-2 py-0.5 bg-background text-xs" value={accountFilter} onChange={e => setAccountFilter(e.target.value)}>
                {accounts.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">合约分类：</span>
              <select className="border rounded px-2 py-0.5 bg-background text-xs" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">板块分类：</span>
              <select className="border rounded px-2 py-0.5 bg-background text-xs" value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}>
                {sectors.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">方向：</span>
              <select className="border rounded px-2 py-0.5 bg-background text-xs" value={dirFilter} onChange={e => setDirFilter(e.target.value)}>
                <option value="全部">全部</option>
                <option value="买">买持仓</option>
                <option value="卖">卖持仓</option>
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">品种类型：</span>
              <select className="border rounded px-2 py-0.5 bg-background text-xs" value={optFilter} onChange={e => setOptFilter(e.target.value)}>
                <option value="全部">全部</option>
                <option value="仅期货">仅期货</option>
                <option value="仅期权">仅期权</option>
              </select>
            </div>
            <button className="text-xs border rounded px-2 py-0.5 bg-background hover:bg-muted"
              onClick={() => { setContractInput(""); setProdSelect("全部"); setAccountFilter("全部"); setCatFilter("全部"); setSectorFilter("全部"); setDirFilter("全部"); setOptFilter("全部") }}>
              重置
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto overflow-y-auto" style={{ maxHeight: 480 }}>
          {loading ? (
            <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
          ) : (
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="sticky top-0 bg-card z-10">
                {/* Summary row */}
                <tr className="border-b bg-muted/30 text-xs">
                  <td className="px-3 py-1.5 font-semibold">合计</td>
                  <td className="px-3 py-1.5 text-muted-foreground">账户数：{uniqueAccounts}</td>
                  <td className="px-3 py-1.5">品种数：{new Set(displayRows.map(r => getProd(r.contract))).size}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${pnlColor(totals.netMv)}`}>{fmtSign(totals.netMv)}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${pnlColor(totals.netLots)}`}>{fmtSign(totals.netLots)}</td>
                  <td className="px-3 py-1.5 text-right">{totals.longLots}</td>
                  <td className="px-3 py-1.5 text-right">{totals.shortLots}</td>
                  <td className="px-3 py-1.5">-</td>
                  <td className="px-3 py-1.5">-</td>
                  <td className="px-3 py-1.5">-</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${pnlColor(totals.pnl)}`}>{fmtSign(totals.pnl)}</td>
                  <td className="px-3 py-1.5">-</td>
                  <td className="px-3 py-1.5 text-right">{fmt(totals.positionMv)}</td>
                  <td className="px-3 py-1.5 text-right">{fmt(totals.margin)}</td>
                  <td className="px-3 py-1.5">-</td>
                  <td className="px-3 py-1.5">-</td>
                  <td className="px-3 py-1.5">-</td>
                  <td className="px-3 py-1.5">-</td>
                </tr>
                {/* Header row */}
                <tr className="border-b bg-muted/50 text-muted-foreground">
                  {["合约","账户名称","品种代码","净持仓市值","净持仓","买持仓","卖持仓","买入价","卖出价","昨结算价","持仓盈亏","实际成交日期","持仓市值","保证金","交易所","持仓日期","合约分类","板块分类"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r, i) => {
                  const prod    = getProd(r.contract)
                  const netLots = r.longLots - r.shortLots
                  const netMv   = (r as any)._netMv ?? (r.longLots > 0 ? r.positionMv : -r.positionMv)
                  return (
                    <tr key={i} className="border-b hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-1.5 font-mono">{r.contract}</td>
                      <td className="px-3 py-1.5">{r.account}</td>
                      <td className="px-3 py-1.5 font-mono">{prod}</td>
                      <td className={`px-3 py-1.5 text-right ${pnlColor(netMv)}`}>{fmtSign(netMv)}</td>
                      <td className={`px-3 py-1.5 text-right ${pnlColor(netLots)}`}>{fmtSign(netLots)}</td>
                      <td className="px-3 py-1.5 text-right">{r.longLots || "-"}</td>
                      <td className="px-3 py-1.5 text-right">{r.shortLots || "-"}</td>
                      <td className="px-3 py-1.5 text-right">{r.buyPrice > 0 ? r.buyPrice.toLocaleString("zh-CN") : "-"}</td>
                      <td className="px-3 py-1.5 text-right">{r.sellPrice > 0 ? r.sellPrice.toLocaleString("zh-CN") : "-"}</td>
                      <td className="px-3 py-1.5 text-right">{r.prevSettle > 0 ? r.prevSettle.toLocaleString("zh-CN") : "-"}</td>
                      <td className={`px-3 py-1.5 text-right ${pnlColor(r.positionPnl)}`}>{fmtSign(r.positionPnl)}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.tradeDateRaw || "-"}</td>
                      <td className="px-3 py-1.5 text-right">{fmt(r.positionMv)}</td>
                      <td className="px-3 py-1.5 text-right">{fmt(r.margin)}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.exchange}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{date}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{PROD_CAT[prod] ?? "-"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{PROD_SECTOR[prod] ?? "-"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      </>)}
    </div>
  )
}

function PositionContent() {
  const [series, setSeries] = useState<ExposureRow[]>([])
  const [capitalMap, setCapitalMap] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [catFilter, setCatFilter] = useState<ExposureCat>("商品")
  const [sectorFilter, setSectorFilter] = useState<ExposureSector>("全部")
  const [subSectorFilter, setSubSectorFilter] = useState<ExposureSubSector>("全部")
  const [prodFilter, setProdFilter] = useState<string>("全部")
  const [pcChartSector, setPcChartSector] = useState<string>("全部")
  const [pcChartSubSector, setPcChartSubSector] = useState<string>("全部")
  const [pcProdFilter, setPcProdFilter] = useState<string>("全部")
  const [pcCatFilter, setPcCatFilter]           = useState<ExposureCat>("全部")
  const [todayDetailProd, setTodayDetailProd] = useState<string>("全部")
  const [yesterdayDetailProd, setYesterdayDetailProd] = useState<string>("全部")
  const [todayExpandTrigger, setTodayExpandTrigger] = useState(0)
  const [yesterdayExpandTrigger, setYesterdayExpandTrigger] = useState(0)
  const [pcYesterday, setPcYesterday] = useState<string>("")
  const [pcSectorFilter, setPcSectorFilter]     = useState<ExposureSector>("全部")
  const [pcSubSectorFilter, setPcSubSectorFilter] = useState<ExposureSubSector>("全部")
  const [weightMode, setWeightMode] = useState<"大类" | "板块" | "细分">("大类")
  const [weightCalcMode, setWeightCalcMode] = useState<"gross" | "net">("net")
  const [sectorBarSort, setSectorBarSort] = useState<{ col: "sector" | "longMv" | "longPct" | "shortMv" | "shortPct" | "netMv" | "netPctNorm"; dir: "asc" | "desc" } | null>({ col: "longMv", dir: "desc" })
  const [sectorBarMode, setSectorBarMode] = useState<"大类" | "板块" | "细分">("大类")
  const [sectorBarDate, setSectorBarDate] = useState<string>("")
  const [scatterDim, setScatterDim] = useState<"大类" | "板块" | "细分">("大类")

  // Sync scatter dim with pc filter selection
  useEffect(() => {
    if (pcProdFilter !== "全部" || pcSubSectorFilter !== "全部") setScatterDim("细分")
    else if (pcSectorFilter !== "全部") setScatterDim("板块")
    else setScatterDim("大类")
  }, [pcProdFilter, pcSubSectorFilter, pcSectorFilter, pcCatFilter])

  const [varGroupData, setVarGroupData] = useState<{ date: string; var: number; actual: number }[]>([])
  const [varGroupLoading, setVarGroupLoading] = useState(true)
  const [varGroupConf, setVarGroupConf] = useState<"90" | "95" | "99">("99")
  const [varGroupNextDayVar, setVarGroupNextDayVar] = useState<number | null>(null)
  const [card3View, setCard3View] = useState<"timeseries" | "breakdown">("breakdown")
  const [breakdownDim, setBreakdownDim] = useState<"大类" | "板块" | "细分板块">("大类")
  const [varBreakdownProds, setVarBreakdownProds] = useState<{ prod: string; sigma: number; mv: number }[]>([])
  const [varBreakdownCorr, setVarBreakdownCorr] = useState<number[][]>([])
  const [varBDeltaMvMap, setVarBDeltaMvMap] = useState<Map<string, number>>(new Map())

  // VaR weight timeseries state
  const [varWeightView, setVarWeightView] = useState<"weight" | "var" | "pnl" | "margvol" | "cvar">("weight")
  const [varChartHelpOpen, setVarChartHelpOpen] = useState(false)
  const [varSectorDates, setVarSectorDates]               = useState<string[]>([])
  const [varSectorCatData, setVarSectorCatData]           = useState<Record<string, number[]>>({})
  const [varSectorSectorData, setVarSectorSectorData]     = useState<Record<string, number[]>>({})
  const [varSectorSubData, setVarSectorSubData]           = useState<Record<string, number[]>>({})
  const [varSectorLoading, setVarSectorLoading]           = useState(true)

  useEffect(() => {
    fetchJsonCached("/ma/api/mom-analysis/var-sector-timeseries?corrDays=252").then(j => {
      if (j.ok) {
        setVarSectorDates(j.dates ?? [])
        setVarSectorCatData(j.catData ?? {})
        setVarSectorSectorData(j.sectorData ?? {})
        setVarSectorSubData(j.subSectorData ?? {})
      }
    }).catch(() => {}).finally(() => setVarSectorLoading(false))
  }, [])

  // PnL sector timeseries state
  const [pnlSectorDates, setPnlSectorDates]               = useState<string[]>([])
  const [pnlSectorCatData, setPnlSectorCatData]           = useState<Record<string, number[]>>({})
  const [pnlSectorSectorData, setPnlSectorSectorData]     = useState<Record<string, number[]>>({})
  const [pnlSectorSubData, setPnlSectorSubData]           = useState<Record<string, number[]>>({})
  const [pnlSectorLoading, setPnlSectorLoading]           = useState(true)

  useEffect(() => {
    fetchJsonCached("/ma/api/mom-analysis/pnl-sector-timeseries").then(j => {
      if (j.ok) {
        setPnlSectorDates(j.dates ?? [])
        setPnlSectorCatData(j.catData ?? {})
        setPnlSectorSectorData(j.sectorData ?? {})
        setPnlSectorSubData(j.subSectorData ?? {})
      }
    }).catch(() => {}).finally(() => setPnlSectorLoading(false))
  }, [])

  // Marginal vol sector timeseries state
  const [margVolDates, setMargVolDates]               = useState<string[]>([])
  const [margVolCatData, setMargVolCatData]           = useState<Record<string, number[]>>({})
  const [margVolSectorData, setMargVolSectorData]     = useState<Record<string, number[]>>({})
  const [margVolSubData, setMargVolSubData]           = useState<Record<string, number[]>>({})
  const [margVolLoading, setMargVolLoading]           = useState(true)

  useEffect(() => {
    fetchJsonCached("/ma/api/mom-analysis/marginal-vol-timeseries").then(j => {
      if (j.ok) {
        setMargVolDates(j.dates ?? [])
        setMargVolCatData(j.catData ?? {})
        setMargVolSectorData(j.sectorData ?? {})
        setMargVolSubData(j.subSectorData ?? {})
      }
    }).catch(() => {}).finally(() => setMargVolLoading(false))
  }, [])

  // CVaR sector timeseries state
  const [cvarSectorDates, setCvarSectorDates]               = useState<string[]>([])
  const [cvarSectorCatData, setCvarSectorCatData]           = useState<Record<string, number[]>>({})
  const [cvarSectorSectorData, setCvarSectorSectorData]     = useState<Record<string, number[]>>({})
  const [cvarSectorSubData, setCvarSectorSubData]           = useState<Record<string, number[]>>({})
  const [cvarSectorLoading, setCvarSectorLoading]           = useState(true)

  useEffect(() => {
    fetchJsonCached("/ma/api/mom-analysis/cvar-sector-timeseries").then(j => {
      if (j.ok) {
        setCvarSectorDates(j.dates ?? [])
        setCvarSectorCatData(j.catData ?? {})
        setCvarSectorSectorData(j.sectorData ?? {})
        setCvarSectorSubData(j.subSectorData ?? {})
      }
    }).catch(() => {}).finally(() => setCvarSectorLoading(false))
  }, [])

  useEffect(() => {
    if (pcSubSectorFilter !== "全部" || pcProdFilter !== "全部") setBreakdownDim("细分板块")
    else if (pcSectorFilter !== "全部") setBreakdownDim("板块")
    else setBreakdownDim("大类")
  }, [pcCatFilter, pcSectorFilter, pcSubSectorFilter, pcProdFilter])
  const barLeftRef = useRef<HTMLDivElement>(null)
  const [barLeftHeight, setBarLeftHeight] = useState<number | undefined>()
  useEffect(() => {
    const el = barLeftRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setBarLeftHeight(el.offsetHeight))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    let doneCount = 0
    const maybeFinish = () => { if (++doneCount >= 3) setLoading(false) }

    fetchJsonCached("/ma/api/mom-analysis/category-exposure").then(expJ => {
      if (expJ.ok) setSeries(expJ.series ?? [])
    }).catch(() => {}).finally(maybeFinish)

    fetchJsonCached("/ma/api/mom-analysis/product-nav").then(navJ => {
      const navData: { date: string; cumCapital: number }[] = navJ.data ?? []
      const map = new Map<string, number>()
      for (const d of navData) if (d.cumCapital > 0) map.set(d.date, d.cumCapital)
      setCapitalMap(map)
    }).catch(() => {}).finally(maybeFinish)

    fetchJsonCached("/ma/api/mom-analysis/position-change").then(pcJ => {
      if (pcJ.ok && pcJ.yesterday) setPcYesterday(pcJ.yesterday)
    }).catch(() => {}).finally(maybeFinish)
  }, [])

  // Derive VaR group from current filters (one level up)
  const varGroupProds = useMemo<string[] | null>(() => {
    if (pcProdFilter !== "全部") {
      const ss = PROD_SUB_SECTOR[pcProdFilter]
      if (!ss) return null
      return Object.keys(PROD_SUB_SECTOR).filter(p => PROD_SUB_SECTOR[p] === ss)
    }
    if (pcSubSectorFilter !== "全部") {
      // find the 板块 for this 细分
      const sec = Object.keys(PROD_SUB_SECTOR).find(p => PROD_SUB_SECTOR[p] === pcSubSectorFilter)
      const sect = sec ? PROD_SECTOR[sec] : undefined
      if (!sect) return null
      return Object.keys(PROD_SECTOR).filter(p => PROD_SECTOR[p] === sect)
    }
    if (pcSectorFilter !== "全部") {
      // find the 大类 for this 板块
      const pc = Object.keys(PROD_SECTOR).find(p => PROD_SECTOR[p] === pcSectorFilter)
      const cat = pc ? PROD_CAT[pc] : undefined
      if (!cat) return null
      return Object.keys(PROD_CAT).filter(p => PROD_CAT[p] === cat)
    }
    if (pcCatFilter !== "全部") {
      return Object.keys(PROD_CAT).filter(p => PROD_CAT[p] === pcCatFilter)
    }
    return null // total
  }, [pcProdFilter, pcSubSectorFilter, pcSectorFilter, pcCatFilter])

  const varGroupLabel = useMemo<string>(() => {
    if (pcProdFilter !== "全部") return PROD_SUB_SECTOR[pcProdFilter] ?? pcProdFilter
    if (pcSubSectorFilter !== "全部") {
      const sec = Object.keys(PROD_SUB_SECTOR).find(p => PROD_SUB_SECTOR[p] === pcSubSectorFilter)
      return (sec ? PROD_SECTOR[sec] : undefined) ?? pcSubSectorFilter
    }
    if (pcSectorFilter !== "全部") {
      const pc = Object.keys(PROD_SECTOR).find(p => PROD_SECTOR[p] === pcSectorFilter)
      return (pc ? PROD_CAT[pc] : undefined) ?? pcSectorFilter
    }
    if (pcCatFilter !== "全部") return pcCatFilter
    return "全部"
  }, [pcProdFilter, pcSubSectorFilter, pcSectorFilter, pcCatFilter])

  useEffect(() => {
    setVarGroupLoading(true)
    const params = new URLSearchParams({ confidence: varGroupConf, volDays: "20", corrDays: "252", distModel: "normal" })
    if (varGroupProds) params.set("prods", varGroupProds.join(","))
    fetchJsonCached(`/ma/api/mom-analysis/var-prediction?${params}`)
      .then(j => { setVarGroupData(j.data ?? []); setVarGroupNextDayVar(j.nextDayVar ?? null) })
      .catch(() => { setVarGroupData([]); setVarGroupNextDayVar(null) })
      .finally(() => setVarGroupLoading(false))
  }, [varGroupProds, varGroupConf])

  useEffect(() => {
    fetchJsonCached("/ma/api/mom-analysis/var-sandbox?volDays=20&corrDays=252").then(varJ => {
      if (varJ.ok) { setVarBreakdownProds(varJ.products ?? []); setVarBreakdownCorr(varJ.corrMatrix ?? []) }
    }).catch(() => {})

    fetchJsonCached("/ma/api/mom-analysis/position-change").then(pcJ => {
      if (pcJ.ok) {
        const m = new Map<string, number>()
        for (const p of (pcJ.products ?? [])) m.set(p.prod, p.deltaMv)
        setVarBDeltaMvMap(m)
      }
    }).catch(() => {})
  }, [])

  const varBreakdownOption = useMemo(() => {
    if (!varBreakdownProds.length || !varBreakdownCorr.length || !varBDeltaMvMap.size) return null
    const Z = varGroupConf === "99" ? 2.326 : varGroupConf === "95" ? 1.6449 : 1.282
    const n = varBreakdownProds.length
    // dv = σ_i × mv_i (TODAY's positions) — used to compute mrc
    const dv = varBreakdownProds.map(p => p.sigma * p.mv)
    let varPort = 0
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        varPort += dv[i] * (varBreakdownCorr[i]?.[j] ?? 0) * dv[j]
    const sigmaPort = Math.sqrt(varPort)
    if (sigmaPort === 0) return null
    // mrc_i = σ_i × Σ_j(ρ_ij × dv_j) / σ_port
    const mrc = varBreakdownProds.map((p, i) => {
      let sum = 0
      for (let j = 0; j < n; j++) sum += (varBreakdownCorr[i]?.[j] ?? 0) * dv[j]
      return p.sigma * sum / sigmaPort
    })
    // ΔVaR_i = Z × mrc_i × deltaMv_i  (same formula as Chart 1)
    const groupMap = new Map<string, number>()
    varBreakdownProds.forEach((p, i) => {
      const deltaMv = varBDeltaMvMap.get(p.prod) ?? 0
      if (deltaMv === 0) return
      const dvar = Z * mrc[i] * deltaMv
      const grp = breakdownDim === "大类" ? (PROD_CAT[p.prod] ?? "其他")
                : breakdownDim === "板块" ? (PROD_SECTOR[p.prod] ?? "其他")
                : (PROD_SUB_SECTOR[p.prod] ?? "其他")
      groupMap.set(grp, (groupMap.get(grp) ?? 0) + dvar)
    })
    if (!groupMap.size) return null
    const groups = [...groupMap.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    const fmtWan = (v: number) => `${v > 0 ? "+" : ""}${(v / 10000).toFixed(1)}万`
    const totalDVar = [...groupMap.values()].reduce((s, v) => s + v, 0)
    return {
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { dataIndex: number; name: string; value: number }[]) => {
          const p = params[0]
          const pct = totalDVar !== 0 ? Math.abs(p.value / totalDVar * 100).toFixed(1) : "0"
          return `<b>${p.name}</b><br/>ΔVaR：<b>${fmtWan(p.value)}</b><br/>占比：${pct}%<br/>${p.value > 0 ? '<span style="color:#f97316">▲风险增加</span>' : '<span style="color:#60a5fa">▼风险降低</span>'}`
        },
      },
      grid: { left: 4, right: 4, top: 8, bottom: 30, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { formatter: (v: number) => `${(v / 10000).toFixed(0)}万`, fontSize: 10 },
        splitLine: { lineStyle: { type: "dashed" } },
      },
      yAxis: {
        type: "category",
        data: [...groups].reverse().map(([g]) => g),
        axisLabel: { fontSize: 11 },
      },
      series: [{
        type: "bar",
        barMaxWidth: 24,
        data: [...groups].reverse().map(([, v]) => ({
          value: Math.round(v),
          itemStyle: { color: v > 0 ? "#f97316" : "#60a5fa" },
        })),
        label: {
          show: true,
          formatter: (params: { value: unknown }) => fmtWan(typeof params.value === "number" ? params.value : 0),
          position: (params: { value: unknown }) => (typeof params.value === "number" ? params.value : 0) >= 0 ? "right" : "left",
          fontSize: 10, color: "#888",
        },
      }],
    }
  }, [varBreakdownProds, varBreakdownCorr, varBDeltaMvMap, breakdownDim, varGroupConf])

  const dates = series.map(r => r.date)

  const scatterDimData = useMemo(() => {
    const today = series[series.length - 1]
    const yest  = series[series.length - 2]
    if (!today || !yest) return null

    let items: string[]
    let longKey: (item: string) => string
    let shortKey: (item: string) => string

    if (scatterDim === "大类") {
      items = ["商品", "股指", "国债"]
      longKey  = (c) => `long${c}`
      shortKey = (c) => `short${c}`
    } else if (scatterDim === "板块") {
      items = [...EXPOSURE_SECTORS.slice(1)]
      longKey  = (s) => `long_s_${s}`
      shortKey = (s) => `short_s_${s}`
    } else {
      items = [...EXPOSURE_SUB_SECTORS.slice(1)]
      longKey  = (ss) => `long_ss_${ss}`
      shortKey = (ss) => `short_ss_${ss}`
    }

    const cats = items.map(item => {
      const longToday  = (today[longKey(item)]  as number) ?? 0
      const longYest   = (yest[longKey(item)]   as number) ?? 0
      const shortToday = Math.abs((today[shortKey(item)] as number) ?? 0)
      const shortYest  = Math.abs((yest[shortKey(item)]  as number) ?? 0)
      const deltaLong  = longToday  - longYest
      const deltaShort = shortToday - shortYest
      const netToday   = longToday  - shortToday
      const netYest    = longYest   - shortYest
      return { cat: item, longToday, longYest, deltaLong, shortToday, shortYest, deltaShort, netToday, netYest, deltaNet: netToday - netYest }
    }).filter(d => d.longToday !== 0 || d.shortToday !== 0 || d.longYest !== 0 || d.shortYest !== 0)

    return { todayDate: today.date, yesterdayDate: yest.date, cats }
  }, [series, scatterDim])

  const catScatterOption = useMemo(() => {
    if (!scatterDimData) return null
    const FIXED: Record<string, string> = { "商品": "#F5A623", "股指": "#4E9FD4", "国债": "#5CB87A" }
    const PALETTE = ["#F5A623","#4E9FD4","#5CB87A","#E8684A","#9B59B6","#1ABC9C","#E74C3C","#3498DB","#F39C12","#8E44AD","#D35400","#2980B9","#16A085","#C0392B","#7F8C8D","#E67E22","#1E8BC3","#26A65B","#96281B","#4B77BE","#6C5CE7","#00CEC9","#FDCB6E"]
    const colorOf = (name: string, idx: number) => FIXED[name] ?? PALETTE[idx % PALETTE.length]
    const allDeltas = scatterDimData.cats.flatMap(d => [Math.abs(d.deltaLong), Math.abs(d.deltaShort)])
    const maxDelta  = Math.max(...allDeltas, 1)
    const fmtB = (v: number) => `${(v / 1e8).toFixed(2)}亿`
    const pad  = maxDelta * 0.35
    return {
      tooltip: {
        trigger: "item" as const,
        formatter: (p: { seriesName: string; data: [number, number, string, number] }) => {
          const [x, y, cat, netMv] = p.data
          const deltaNet = scatterDimData.cats.find(d => d.cat === cat)?.deltaNet ?? 0
          const borderCol = Math.abs(deltaNet) < 1e5 ? "#888" : deltaNet > 0 ? "#4ade80" : "#f87171"
          const sign = deltaNet >= 0 ? "▲" : "▼"
          return [
            `<b>${cat}</b>  (${scatterDimData.yesterdayDate} → ${scatterDimData.todayDate})`,
            `多头变化：${x >= 0 ? "+" : ""}${fmtB(x)}`,
            `空头变化：${y >= 0 ? "+" : ""}${fmtB(y)}`,
            `净持仓：${fmtB(netMv)}`,
            `<span style="color:${borderCol}">${sign}净变化：${fmtB(Math.abs(deltaNet))}</span>`,
          ].join("<br/>")
        }
      },
      legend: {
        type: "scroll" as const,
        bottom: 2,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { fontSize: 9 },
        pageTextStyle: { fontSize: 9 },
      },
      grid: { left: "14%", right: "4%", top: "8%", bottom: "28%", containLabel: false },
      xAxis: {
        type: "value" as const,
        name: "多头变化",
        nameLocation: "middle" as const,
        nameGap: 28,
        min: -maxDelta - pad, max: maxDelta + pad,
        axisLabel: { fontSize: 9, formatter: (v: number) => `${(v / 1e8).toFixed(1)}亿` },
        splitLine: { show: false },
        axisLine: { onZero: true },
      },
      yAxis: {
        type: "value" as const,
        name: "空头变化",
        nameLocation: "middle" as const,
        nameGap: 52,
        min: -maxDelta - pad, max: maxDelta + pad,
        axisLabel: { fontSize: 9, formatter: (v: number) => `${(v / 1e8).toFixed(1)}亿` },
        splitLine: { show: false },
        axisLine: { onZero: true },
      },
      graphic: [
        { type: "text", left: "60%", top: "10%", style: { text: "多空同增", fill: "#ccc", fontSize: 9 } },
        { type: "text", left: "18%", top: "10%", style: { text: "多减空增", fill: "#ccc", fontSize: 9 } },
        { type: "text", left: "60%", top: "72%", style: { text: "多增空减", fill: "#ccc", fontSize: 9 } },
        { type: "text", left: "18%", top: "72%", style: { text: "多空同减", fill: "#ccc", fontSize: 9 } },
      ],
      series: scatterDimData.cats.map((d, idx) => {
        return {
          name: d.cat,
          type: "scatter" as const,
          symbolSize: 8,
          data: [[d.deltaLong, d.deltaShort, d.cat, d.netToday]],
          itemStyle: { color: colorOf(d.cat, idx) },
          label: { show: false },
        }
      }),
    }
  }, [scatterDimData])

  // Mini exposure chart — driven by PositionChangeDetailTable filters
  const miniVisibleCfg = useMemo(() => {
    if (pcProdFilter !== "全部") {
      return [
        { key: `long_p_${pcProdFilter}`,  name: "多", stack: "long",  color: "#38bdf8" },
        { key: `short_p_${pcProdFilter}`, name: "空", stack: "short", color: "#fb923c" },
      ]
    }
    if (pcSubSectorFilter !== "全部") return [
      { key: `long_ss_${pcSubSectorFilter}`,  name: "多", stack: "long",  color: "#38bdf8" },
      { key: `short_ss_${pcSubSectorFilter}`, name: "空", stack: "short", color: "#fb923c" },
    ]
    if (pcSectorFilter !== "全部") return [
      { key: `long_s_${pcSectorFilter}`,  name: "多", stack: "long",  color: "#38bdf8" },
      { key: `short_s_${pcSectorFilter}`, name: "空", stack: "short", color: "#fb923c" },
    ]
    return EXPOSURE_SERIES_CFG.filter(c => pcCatFilter === "全部" || c.cat === pcCatFilter) as { key: string; name: string; stack: string; color: string }[]
  }, [pcProdFilter, pcCatFilter, pcSectorFilter, pcSubSectorFilter])

  const miniFilteredNet = useMemo(() => {
    if (pcProdFilter !== "全部") return series.map(r => ((r as Record<string,number>)[`long_p_${pcProdFilter}`] ?? 0) + ((r as Record<string,number>)[`short_p_${pcProdFilter}`] ?? 0))
    if (pcSubSectorFilter !== "全部") return series.map(r => ((r as Record<string,number>)[`long_ss_${pcSubSectorFilter}`] ?? 0) + ((r as Record<string,number>)[`short_ss_${pcSubSectorFilter}`] ?? 0))
    if (pcSectorFilter !== "全部") return series.map(r => ((r as Record<string,number>)[`long_s_${pcSectorFilter}`] ?? 0) + ((r as Record<string,number>)[`short_s_${pcSectorFilter}`] ?? 0))
    if (pcCatFilter === "全部") return series.map(r => r.net)
    return series.map(r => ((r as Record<string,number>)[`long${pcCatFilter}`] ?? 0) + ((r as Record<string,number>)[`short${pcCatFilter}`] ?? 0))
  }, [series, pcProdFilter, pcCatFilter, pcSectorFilter, pcSubSectorFilter])

  // Zoom to last 90 trading days (~last 15% of a 600-day window)
  const miniZoomStart = series.length > 0 ? Math.max(0, Math.round((1 - 90 / series.length) * 100)) : 80

  const miniExposureOption = useMemo(() => ({
    tooltip: {
      trigger: "axis" as const,
      formatter: (params: { seriesName: string; value: number; marker: string }[]) => {
        const date = (params[0] as unknown as { axisValue: string }).axisValue
        const fmt = (v: number) => `${(Math.abs(v) / 1e8).toFixed(2)}亿`
        const fmtNet = (v: number) => `${v < 0 ? "-" : ""}${(Math.abs(v) / 1e8).toFixed(2)}亿`
        const longTotal  = params.filter(p => p.seriesName === "多" || p.seriesName.startsWith("多-")).reduce((s, p) => s + p.value, 0)
        const shortTotal = params.filter(p => p.seriesName === "空" || p.seriesName.startsWith("空-")).reduce((s, p) => s + Math.abs(p.value), 0)
        const net        = params.find(p => p.seriesName === "净持仓")?.value ?? (longTotal - shortTotal)
        const dot = (c: string) => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:3px"></span>`
        return [date, `${dot("#38bdf8")}多: ${fmt(longTotal)}`, `${dot("#fb923c")}空: ${fmt(shortTotal)}`, `${dot("#dc2626")}净: ${fmtNet(net)}`].join("<br/>")
      },
    },
    grid: { left: 52, right: 16, top: 8, bottom: 36 },
    dataZoom: [
      { type: "inside" as const, start: miniZoomStart, end: 100 },
      { type: "slider" as const, height: 14, bottom: 2, textStyle: { fontSize: 8 } },
    ],
    xAxis: { type: "category" as const, data: dates, axisLabel: { fontSize: 8, rotate: 30, interval: "auto" as const } },
    yAxis: { type: "value" as const, axisLabel: { fontSize: 8, formatter: (v: number) => (v / 1e8).toFixed(1) + "亿" }, splitLine: { lineStyle: { type: "dashed" as const } } },
    series: [
      ...miniVisibleCfg.map(c => ({
        name: c.name,
        type: "bar" as const,
        stack: c.stack,
        data: series.map(r => (r as Record<string, number>)[c.key] ?? 0),
        itemStyle: { color: c.color },
      })),
      {
        name: "净持仓",
        type: "line" as const,
        data: miniFilteredNet,
        symbol: "none",
        lineStyle: { color: "#dc2626", width: 2 },
        itemStyle: { color: "#dc2626" },
        z: 10,
      },
    ],
  }), [series, dates, miniVisibleCfg, miniFilteredNet, miniZoomStart])

  const varGroupOption = useMemo(() => {
    if (!varGroupData.length) return null
    const lastRow    = varGroupData[varGroupData.length - 1]
    const nextVar    = varGroupNextDayVar ?? lastRow.var   // true next-day prediction from API
    const nextLabel  = "次日预测"
    // Append a synthetic "next day" point using the real next-day VaR
    const varDates   = [...varGroupData.map(r => r.date), nextLabel]
    const confLabel  = `VaR(${varGroupConf}%)`
    const zoomStart  = Math.max(0, Math.round((1 - 90 / varDates.length) * 100))
    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; name: string; value: number | null; marker: string }[]) => {
          const lines = params
            .filter(p => p.value != null)
            .map(p => `${p.marker}${p.seriesName}: ${Number(p.value).toLocaleString("zh-CN")} 元`)
          return [params[0]?.name, ...lines].join("<br/>")
        },
      },
      legend: { data: ["实际|盈亏|", confLabel], top: 5, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 9 } },
      grid: { left: 60, right: 16, top: 30, bottom: 42 },
      dataZoom: [
        { type: "inside" as const, start: zoomStart, end: 100 },
        { type: "slider" as const, height: 14, bottom: 2, textStyle: { fontSize: 8 } },
      ],
      xAxis: { type: "category" as const, data: varDates, axisLabel: { fontSize: 8, rotate: 30, interval: "auto" as const } },
      yAxis: { type: "value" as const, axisLabel: { fontSize: 8, formatter: (v: number) => (v / 1e4).toFixed(0) + "万" }, splitLine: { lineStyle: { type: "dashed" as const } } },
      series: [
        {
          name: "实际|盈亏|",
          type: "bar" as const,
          // no bar for the synthetic next-day point
          data: [...varGroupData.map(r => ({
            value: r.actual,
            itemStyle: { color: r.actual > r.var ? "#ef4444" : "#94a3b8" },
          })), { value: null as unknown as number, itemStyle: { color: "transparent" } }],
          barMaxWidth: 12,
        },
        {
          name: confLabel,
          type: "line" as const,
          // Historical VaR solid up to last known day, then dashed to the next-day prediction
          data: [
            ...varGroupData.map(r => ({ value: r.var })),
            // true next-day VaR computed from today's positions
            { value: nextVar },
          ],
          lineStyle: { color: "#f97316", width: 2 },
          itemStyle: { color: "#f97316" },
          // Show a distinct dot only on the prediction point
          symbol: (_value: number, params: { dataIndex: number }) =>
            params.dataIndex === varDates.length - 1 ? "circle" : "none",
          symbolSize: (_value: number, params: { dataIndex: number }) =>
            params.dataIndex === varDates.length - 1 ? 8 : 0,
          z: 10,
          // Dashed segment from last known point to the prediction
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { type: "dashed" as const, color: "#f97316", width: 2, opacity: 0.8 },
            data: [
              [{ coord: [varGroupData.length - 1, lastRow.var] }, { coord: [varGroupData.length, nextVar] }],
            ],
          },
        },
      ],
    }
  }, [varGroupData, varGroupConf, varGroupNextDayVar])

  // Cascading available products for the product filter dropdown
  const availableProds = useMemo(() => {
    const allProds = Object.keys(PROD_NAMES)
    if (subSectorFilter !== "全部") return allProds.filter(p => PROD_SUB_SECTOR[p] === subSectorFilter)
    if (sectorFilter !== "全部") return allProds.filter(p => PROD_SECTOR[p] === sectorFilter)
    if (catFilter !== "全部") return allProds.filter(p => PROD_CAT[p] === catFilter)
    return allProds
  }, [catFilter, sectorFilter, subSectorFilter])

  // When a sector filter is active, it overrides the cat filter
  const SECTOR_CFG = [
    { key: "long_sector",  name: "多",  stack: "long",  color: "#38bdf8" },
    { key: "short_sector", name: "空",  stack: "short", color: "#fb923c" },
  ] as const

  const visibleCfg  = prodFilter !== "全部"
    ? SECTOR_CFG.map(c => ({ ...c, key: c.key.replace("_sector", `_p_${prodFilter}`) }))
    : subSectorFilter !== "全部"
    ? SECTOR_CFG.map(c => ({ ...c, key: c.key.replace("_sector", `_ss_${subSectorFilter}`) }))
    : sectorFilter !== "全部"
    ? SECTOR_CFG.map(c => ({ ...c, key: c.key.replace("_sector", `_s_${sectorFilter}`) }))
    : EXPOSURE_SERIES_CFG.filter(c => catFilter  === "全部" || c.cat === catFilter)

  const visibleCfg2 = visibleCfg

  const filteredNet = useMemo(() => {
    if (prodFilter !== "全部") {
      return series.map(r => {
        const lv = (r as Record<string, number>)[`long_p_${prodFilter}`] ?? 0
        const sv = (r as Record<string, number>)[`short_p_${prodFilter}`] ?? 0
        return lv + sv
      })
    }
    if (subSectorFilter !== "全部") {
      return series.map(r => {
        const lv = (r as Record<string, number>)[`long_ss_${subSectorFilter}`] ?? 0
        const sv = (r as Record<string, number>)[`short_ss_${subSectorFilter}`] ?? 0
        return lv + sv
      })
    }
    if (sectorFilter !== "全部") {
      return series.map(r => {
        const lv = (r as Record<string, number>)[`long_s_${sectorFilter}`] ?? 0
        const sv = (r as Record<string, number>)[`short_s_${sectorFilter}`] ?? 0
        return lv + sv
      })
    }
    if (catFilter === "全部") return series.map(r => r.net)
    return series.map(r => {
      const longKey  = `long${catFilter}`  as keyof ExposureRow
      const shortKey = `short${catFilter}` as keyof ExposureRow
      return (r[longKey] as number) + (r[shortKey] as number)
    })
  }, [series, catFilter, sectorFilter, subSectorFilter, prodFilter])

  const filteredNet2 = filteredNet

  // Divide a raw MV value by the capital for that date (returns multiplier, e.g. 1.96)
  const toRatio = useCallback((mv: number, date: string) => {
    const cap = capitalMap.get(date)
    if (!cap || cap === 0) return 0
    return Math.round(mv / cap * 10000) / 10000
  }, [capitalMap])

  const exposureOption = useMemo(() => ({
    tooltip: {
      trigger: "axis" as const,
      formatter: (params: { seriesName: string; value: number; marker: string; color: string }[]) => {
        const date = (params[0] as unknown as { axisValue: string }).axisValue
        const fmt = (v: number) => `${Math.round(Math.abs(v) / 1e8 * 100) / 100}亿`
        const fmtNet = (v: number) => `${v < 0 ? "-" : ""}${Math.round(Math.abs(v) / 1e8 * 100) / 100}亿`
        if (prodFilter !== "全部" || subSectorFilter !== "全部" || sectorFilter !== "全部" || catFilter === "全部") {
          const longTotal  = params.filter(p => ["多", "多-商品", "多-股指", "多-国债"].includes(p.seriesName) || p.seriesName.startsWith("多-")).reduce((s, p) => s + p.value, 0)
          const shortTotal = params.filter(p => ["空", "空-商品", "空-股指", "空-国债"].includes(p.seriesName) || p.seriesName.startsWith("空-")).reduce((s, p) => s + Math.abs(p.value), 0)
          const net        = params.find(p => p.seriesName === "净持仓")?.value ?? (longTotal - shortTotal)
          const dot = (color: string) => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:4px"></span>`
          return [
            date,
            `${dot("#38bdf8")}多头合计: ${fmt(longTotal)}`,
            `${dot("#fb923c")}空头合计: ${fmt(shortTotal)}`,
            `${dot("#dc2626")}净持仓: ${fmtNet(net)}`,
          ].join("<br/>")
        }
        const rows = params
          .filter(p => p.value !== 0)
          .map(p => `${p.marker}${p.seriesName}: ${p.seriesName === "净持仓" ? fmtNet(p.value) : fmt(p.value)}`)
        return [date, ...rows].join("<br/>")
      },
    },
    legend: { top: 5, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 11 } },
    grid: { left: 65, right: 70, top: 40, bottom: 50 },
    dataZoom: [
      { type: "inside" as const, start: 0, end: 100 },
      { type: "slider" as const, height: 18, bottom: 5 },
    ],
    xAxis: {
      type: "category" as const,
      data: dates,
      axisLabel: { fontSize: 10, rotate: 30 },
    },
    yAxis: {
      type: "value" as const,
      axisLabel: { formatter: (v: number) => (v / 1e8).toFixed(1) + "亿" },
      splitLine: { lineStyle: { type: "dashed" as const } },
    },
    series: [
      ...visibleCfg.map(c => ({
        name: c.name,
        type: "bar" as const,
        stack: c.stack,
        data: series.map(r => (r as Record<string, number>)[c.key] ?? 0),
        itemStyle: { color: c.color },
      })),
      {
        name: "净持仓",
        type: "line" as const,
        data: filteredNet,
        symbol: "none",
        lineStyle: { color: "#dc2626", width: 3 },
        itemStyle: { color: "#dc2626" },
        endLabel: {
          show: true,
          formatter: (p: { value: number }) => {
            const v = p.value
            return `${v < 0 ? "-" : ""}${Math.round(Math.abs(v) / 1e8 * 100) / 100}亿`
          },
          color: "#dc2626",
          fontSize: 11,
          fontWeight: "bold" as const,
        },
        z: 10,
      },
    ],
  }), [series, dates, visibleCfg, filteredNet, catFilter, sectorFilter, subSectorFilter, prodFilter])

  const ratioOption = useMemo(() => ({
    tooltip: {
      trigger: "axis" as const,
      formatter: (params: { seriesName: string; value: number; marker: string; color: string }[]) => {
        const date = (params[0] as unknown as { axisValue: string }).axisValue
        const fmt = (v: number) => Math.abs(v).toFixed(2)
        const fmtNet = (v: number) => v.toFixed(2)
        if (prodFilter !== "全部" || subSectorFilter !== "全部" || sectorFilter !== "全部" || catFilter === "全部") {
          const longTotal  = params.filter(p => p.seriesName.startsWith("多")).reduce((s, p) => s + p.value, 0)
          const shortTotal = params.filter(p => p.seriesName.startsWith("空")).reduce((s, p) => s + Math.abs(p.value), 0)
          const net        = params.find(p => p.seriesName === "净持仓/净资本")?.value ?? (longTotal - shortTotal)
          const dot = (color: string) => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:4px"></span>`
          return [
            date,
            `${dot("#38bdf8")}多头市值/净资本: ${fmt(longTotal)}`,
            `${dot("#fb923c")}空头市值/净资本: ${fmt(shortTotal)}`,
            `${dot("#dc2626")}净持仓/净资本: ${fmtNet(net)}`,
          ].join("<br/>")
        }
        const rows = params
          .filter(p => p.value !== 0)
          .map(p => `${p.marker}${p.seriesName}: ${p.seriesName === "净持仓/净资本" ? fmtNet(p.value) : fmt(p.value)}`)
        return [date, ...rows].join("<br/>")
      },
    },
    legend: { top: 5, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 11 } },
    grid: { left: 60, right: 60, top: 40, bottom: 50 },
    dataZoom: [
      { type: "inside" as const, start: 0, end: 100 },
      { type: "slider" as const, height: 18, bottom: 5 },
    ],
    xAxis: {
      type: "category" as const,
      data: dates,
      axisLabel: { fontSize: 10, rotate: 30 },
    },
    yAxis: {
      type: "value" as const,
      axisLabel: { formatter: (v: number) => v.toFixed(2) },
      splitLine: { lineStyle: { type: "dashed" as const } },
    },
    series: [
      ...visibleCfg2.map(c => ({
        name: c.name + "/净资本",
        type: "bar" as const,
        stack: c.stack,
        data: series.map(r => toRatio((r as Record<string, number>)[c.key] ?? 0, r.date)),
        itemStyle: { color: c.color },
      })),
      {
        name: "净持仓/净资本",
        type: "line" as const,
        data: filteredNet2.map((v, i) => toRatio(v, series[i]?.date ?? "")),      
        symbol: "none",
        lineStyle: { color: "#dc2626", width: 3 },
        itemStyle: { color: "#dc2626" },
        endLabel: {
          show: true,
          formatter: (p: { value: number }) => p.value.toFixed(2),
          color: "#dc2626",
          fontSize: 11,
          fontWeight: "bold" as const,
        },
        z: 10,
      },
    ],
  }), [series, dates, visibleCfg2, filteredNet2, catFilter, sectorFilter, subSectorFilter, prodFilter, toRatio])

  const sectorBarRows = useMemo(() => {
    let row: ExposureRow | undefined
    if (sectorBarDate) {
      row = series.find(r => r.date === sectorBarDate)
    }
    if (!row) row = series[series.length - 1]
    if (!row) return []
    let capital = 0
    const rowIdx = series.indexOf(row)
    for (let i = rowIdx; i >= 0; i--) {
      const c = capitalMap.get(series[i].date)
      if (c && c > 0) { capital = c; break }
    }
    const groups: readonly string[] =
      sectorBarMode === "大类" ? CAT_WEIGHT_GROUPS
      : sectorBarMode === "板块" ? EXPOSURE_SECTORS.slice(1)
      : EXPOSURE_SUB_SECTORS.slice(1)
    const raw = groups.map(g => {
      let lv: number, sv: number
      if (sectorBarMode === "大类") {
        lv = (row as Record<string, number>)[`long${g}`] ?? 0
        sv = (row as Record<string, number>)[`short${g}`] ?? 0
      } else if (sectorBarMode === "板块") {
        lv = (row as Record<string, number>)[`long_s_${g}`] ?? 0
        sv = (row as Record<string, number>)[`short_s_${g}`] ?? 0
      } else {
        lv = (row as Record<string, number>)[`long_ss_${g}`] ?? 0
        sv = (row as Record<string, number>)[`short_ss_${g}`] ?? 0
      }
      const absShort = Math.abs(sv)
      const net = lv + sv  // sv is negative
      return {
        sector: g,
        longMv: lv,
        longPct: capital > 0 ? lv / capital * 100 : 0,
        shortMv: absShort,
        shortPct: capital > 0 ? absShort / capital * 100 : 0,
        netMv: net,
        netPctNorm: 0, // filled in second pass
      }
    })
    const totalAbsNet = raw.reduce((s, r) => s + Math.abs(r.netMv), 0)
    return raw.map(r => ({ ...r, netPctNorm: totalAbsNet > 0 ? Math.abs(r.netMv) / totalAbsNet * 100 : 0 }))
  }, [series, capitalMap, sectorBarMode, sectorBarDate])

  const sectorBarOption = useMemo(() => {
    if (sectorBarRows.length === 0) return {}

    // Use sorted row order so chart matches the table sort
    const sorted = [...sectorBarRows].sort((a, b) => {
      if (!sectorBarSort) return 0
      const { col, dir } = sectorBarSort
      const va = a[col], vb = b[col]
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return dir === "asc" ? cmp : -cmp
    })

    const sectors = sorted.map(r => r.sector)
    const longVals = sorted.map(r => Math.round(r.longPct * 10) / 10)
    const shortVals = sorted.map(r => Math.round(r.shortPct * 10) / 10)

    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; name: string; value: number; marker: string }[]) => {
          const name = params[0]?.name ?? ""
          const rows = params.map(p => `${p.marker}${p.seriesName}: +${p.value.toFixed(1)}%`)
          return [name, ...rows].join("<br/>")
        },
      },
      legend: { top: 5, itemWidth: 12, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 20, top: 36, bottom: 36 },
      xAxis: { type: "category" as const, data: sectors, axisLabel: { fontSize: 11 } },
      yAxis: {
        type: "value" as const,
        axisLabel: {
          fontSize: 10,
          formatter: (v: number) => `+${v}%`,
        },
        splitLine: { lineStyle: { type: "dashed" as const } },
      },
      series: [
        {
          name: "多头",
          type: "bar" as const,
          data: longVals,
          itemStyle: { color: "#dc2626" },
          label: { show: false },
        },
        {
          name: "空头",
          type: "bar" as const,
          data: shortVals,
          itemStyle: { color: "#3b82f6" },
          label: { show: false },
        },
      ],
    }
  }, [sectorBarRows, sectorBarSort])

  const sectorWeightOption = useMemo(() => {
    type GroupKey = string
    const groups: readonly GroupKey[] =
      weightMode === "大类" ? CAT_WEIGHT_GROUPS
      : weightMode === "板块" ? WEIGHT_SECTORS
      : WEIGHT_SUB_SECTORS
    const colorMap: Record<string, string> =
      weightMode === "大类" ? CAT_COLORS
      : weightMode === "板块" ? SECTOR_COLORS
      : SUB_SECTOR_COLORS
    const keyPrefix =
      weightMode === "大类" ? "" // uses long商品 etc.
      : weightMode === "板块" ? "s"
      : "ss"

    const weightData: Record<GroupKey, number[]> = {}
    for (const g of groups) weightData[g] = []

    for (const r of series) {
      const mv: Record<GroupKey, number> = {}
      let total = 0
      for (const g of groups) {
        let lv: number, sv: number
        if (weightMode === "大类") {
          lv = (r as Record<string, number>)[`long${g}`] ?? 0
          sv = (r as Record<string, number>)[`short${g}`] ?? 0   // stored negative
        } else {
          lv = (r as Record<string, number>)[`long_${keyPrefix}_${g}`] ?? 0
          sv = (r as Record<string, number>)[`short_${keyPrefix}_${g}`] ?? 0  // stored negative
        }
        const v = weightCalcMode === "net" ? Math.abs(lv + sv) : lv - sv
        mv[g] = v
        total += v
      }
      for (const g of groups) {
        weightData[g].push(total > 0 ? Math.round(mv[g] / total * 10000) / 100 : 0)
      }
    }

    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; value: number; marker: string }[]) => {
          const date = (params[0] as unknown as { axisValue: string }).axisValue
          const rows = params
            .filter(p => p.value > 0)
            .sort((a, b) => b.value - a.value)
            .map(p => `${p.marker}${p.seriesName}: ${p.value.toFixed(1)}%`)
          return [date, ...rows].join("<br/>")
        },
      },
      legend: { top: 5, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 20, top: 40, bottom: 50 },
      dataZoom: [
        { type: "inside" as const, start: 0, end: 100 },
        { type: "slider" as const, height: 18, bottom: 5 },
      ],
      xAxis: {
        type: "category" as const,
        data: dates,
        axisLabel: { fontSize: 10, rotate: 30 },
      },
      yAxis: {
        type: "value" as const,
        min: 0,
        max: 100,
        axisLabel: { formatter: (v: number) => v + "%" },
        splitLine: { lineStyle: { type: "dashed" as const } },
      },
      series: groups.map(g => ({
        name: g,
        type: "line" as const,
        stack: "total",
        areaStyle: { color: colorMap[g] ?? "#94a3b8" },
        lineStyle: { width: 0, color: colorMap[g] ?? "#94a3b8" },
        itemStyle: { color: colorMap[g] ?? "#94a3b8" },
        symbol: "none",
        data: weightData[g],
        emphasis: { focus: "series" as const },
      })),
    }
  }, [series, dates, weightMode, weightCalcMode])

  // VaR weight timeseries chart option (same group logic as sectorWeightOption)
  const sectorVarOption = useMemo(() => {
    type GroupKey = string
    const groups: readonly GroupKey[] =
      weightMode === "大类" ? (CAT_WEIGHT_GROUPS as readonly string[])
      : weightMode === "板块" ? (WEIGHT_SECTORS as readonly string[])
      : (WEIGHT_SUB_SECTORS as readonly string[])
    const colorMap: Record<string, string> =
      weightMode === "大类" ? CAT_COLORS
      : weightMode === "板块" ? SECTOR_COLORS
      : SUB_SECTOR_COLORS
    const rawData: Record<string, number[]> =
      weightMode === "大类" ? varSectorCatData
      : weightMode === "板块" ? varSectorSectorData
      : varSectorSubData

    if (varSectorDates.length === 0) return null

    // Only keep groups that have data
    const activeGroups = groups.filter(g => rawData[g]?.some(v => v > 0))
    // Include any group found in raw data but not in the ordered list
    const extraGroups = Object.keys(rawData).filter(g => !groups.includes(g) && rawData[g]?.some(v => v > 0))
    const allGroups = [...activeGroups, ...extraGroups]

    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; value: number; marker: string }[]) => {
          const date = (params[0] as unknown as { axisValue: string }).axisValue
          const rows = params
            .filter(p => p.value > 0)
            .sort((a, b) => b.value - a.value)
            .map(p => `${p.marker}${p.seriesName}: ${p.value.toFixed(1)}%`)
          return [date, ...rows].join("<br/>")
        },
      },
      legend: { top: 5, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 20, top: 40, bottom: 50 },
      dataZoom: [
        { type: "inside" as const, start: 0, end: 100 },
        { type: "slider" as const, height: 18, bottom: 5 },
      ],
      xAxis: {
        type: "category" as const,
        data: varSectorDates,
        axisLabel: { fontSize: 10, rotate: 30 },
      },
      yAxis: {
        type: "value" as const,
        min: 0,
        max: 100,
        axisLabel: { formatter: (v: number) => v + "%" },
        splitLine: { lineStyle: { type: "dashed" as const } },
      },
      series: allGroups.map(g => ({
        name: g,
        type: "line" as const,
        stack: "total",
        areaStyle: { color: colorMap[g] ?? "#94a3b8" },
        lineStyle: { width: 0, color: colorMap[g] ?? "#94a3b8" },
        itemStyle: { color: colorMap[g] ?? "#94a3b8" },
        symbol: "none",
        data: rawData[g] ?? varSectorDates.map(() => 0),
        emphasis: { focus: "series" as const },
      })),
    }
  }, [weightMode, varSectorDates, varSectorCatData, varSectorSectorData, varSectorSubData])

  // |PnL| sector timeseries chart option
  const sectorPnlOption = useMemo(() => {
    type GroupKey = string
    const groups: readonly GroupKey[] =
      weightMode === "大类" ? (CAT_WEIGHT_GROUPS as readonly string[])
      : weightMode === "板块" ? (WEIGHT_SECTORS as readonly string[])
      : (WEIGHT_SUB_SECTORS as readonly string[])
    const colorMap: Record<string, string> =
      weightMode === "大类" ? CAT_COLORS
      : weightMode === "板块" ? SECTOR_COLORS
      : SUB_SECTOR_COLORS
    const rawData: Record<string, number[]> =
      weightMode === "大类" ? pnlSectorCatData
      : weightMode === "板块" ? pnlSectorSectorData
      : pnlSectorSubData

    if (pnlSectorDates.length === 0) return null

    const activeGroups = groups.filter(g => rawData[g]?.some(v => v > 0))
    const extraGroups  = Object.keys(rawData).filter(g => !groups.includes(g) && rawData[g]?.some(v => v > 0))
    const allGroups    = [...activeGroups, ...extraGroups]

    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; value: number; marker: string }[]) => {
          const date = (params[0] as unknown as { axisValue: string }).axisValue
          const rows = params
            .filter(p => p.value > 0)
            .sort((a, b) => b.value - a.value)
            .map(p => `${p.marker}${p.seriesName}: ${p.value.toFixed(1)}%`)
          return [date, ...rows].join("<br/>")
        },
      },
      legend: { top: 5, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 20, top: 40, bottom: 50 },
      dataZoom: [
        { type: "inside" as const, start: 0, end: 100 },
        { type: "slider" as const, height: 18, bottom: 5 },
      ],
      xAxis: {
        type: "category" as const,
        data: pnlSectorDates,
        axisLabel: { fontSize: 10, rotate: 30 },
      },
      yAxis: {
        type: "value" as const,
        min: 0,
        max: 100,
        axisLabel: { formatter: (v: number) => v + "%" },
        splitLine: { lineStyle: { type: "dashed" as const } },
      },
      series: allGroups.map(g => ({
        name: g,
        type: "line" as const,
        stack: "total",
        areaStyle: { color: colorMap[g] ?? "#94a3b8" },
        lineStyle: { width: 0, color: colorMap[g] ?? "#94a3b8" },
        itemStyle: { color: colorMap[g] ?? "#94a3b8" },
        symbol: "none",
        data: rawData[g] ?? pnlSectorDates.map(() => 0),
        emphasis: { focus: "series" as const },
      })),
    }
  }, [weightMode, pnlSectorDates, pnlSectorCatData, pnlSectorSectorData, pnlSectorSubData])

  // Marginal vol sector timeseries chart option
  const sectorMargVolOption = useMemo(() => {
    type GroupKey = string
    const groups: readonly GroupKey[] =
      weightMode === "大类" ? (CAT_WEIGHT_GROUPS as readonly string[])
      : weightMode === "板块" ? (WEIGHT_SECTORS as readonly string[])
      : (WEIGHT_SUB_SECTORS as readonly string[])
    const colorMap: Record<string, string> =
      weightMode === "大类" ? CAT_COLORS
      : weightMode === "板块" ? SECTOR_COLORS
      : SUB_SECTOR_COLORS
    const rawData: Record<string, number[]> =
      weightMode === "大类" ? margVolCatData
      : weightMode === "板块" ? margVolSectorData
      : margVolSubData

    if (margVolDates.length === 0) return null

    const activeGroups = groups.filter(g => rawData[g]?.some(v => v > 0))
    const extraGroups  = Object.keys(rawData).filter(g => !groups.includes(g) && rawData[g]?.some(v => v > 0))
    const allGroups    = [...activeGroups, ...extraGroups]

    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; value: number; marker: string }[]) => {
          const date = (params[0] as unknown as { axisValue: string }).axisValue
          const rows = params
            .filter(p => p.value > 0)
            .sort((a, b) => b.value - a.value)
            .map(p => `${p.marker}${p.seriesName}: ${p.value.toFixed(1)}%`)
          return [date, ...rows].join("<br/>")
        },
      },
      legend: { top: 5, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 20, top: 40, bottom: 50 },
      dataZoom: [
        { type: "inside" as const, start: 0, end: 100 },
        { type: "slider" as const, height: 18, bottom: 5 },
      ],
      xAxis: {
        type: "category" as const,
        data: margVolDates,
        axisLabel: { fontSize: 10, rotate: 30 },
      },
      yAxis: {
        type: "value" as const,
        min: 0,
        max: 100,
        axisLabel: { formatter: (v: number) => v + "%" },
        splitLine: { lineStyle: { type: "dashed" as const } },
      },
      series: allGroups.map(g => ({
        name: g,
        type: "line" as const,
        stack: "total",
        areaStyle: { color: colorMap[g] ?? "#94a3b8" },
        lineStyle: { width: 0, color: colorMap[g] ?? "#94a3b8" },
        itemStyle: { color: colorMap[g] ?? "#94a3b8" },
        symbol: "none",
        data: rawData[g] ?? margVolDates.map(() => 0),
        emphasis: { focus: "series" as const },
      })),
    }
  }, [weightMode, margVolDates, margVolCatData, margVolSectorData, margVolSubData])

  // CVaR sector timeseries chart option (historical simulation ES, 95% confidence)
  const sectorCVarOption = useMemo(() => {
    type GroupKey = string
    const groups: readonly GroupKey[] =
      weightMode === "大类" ? (CAT_WEIGHT_GROUPS as readonly string[])
      : weightMode === "板块" ? (WEIGHT_SECTORS as readonly string[])
      : (WEIGHT_SUB_SECTORS as readonly string[])
    const colorMap: Record<string, string> =
      weightMode === "大类" ? CAT_COLORS
      : weightMode === "板块" ? SECTOR_COLORS
      : SUB_SECTOR_COLORS
    const rawData: Record<string, number[]> =
      weightMode === "大类" ? cvarSectorCatData
      : weightMode === "板块" ? cvarSectorSectorData
      : cvarSectorSubData

    if (cvarSectorDates.length === 0) return null

    const activeGroups = groups.filter(g => rawData[g]?.some(v => v > 0))
    const extraGroups  = Object.keys(rawData).filter(g => !groups.includes(g) && rawData[g]?.some(v => v > 0))
    const allGroups    = [...activeGroups, ...extraGroups]

    return {
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: { seriesName: string; value: number; marker: string }[]) => {
          const date = (params[0] as unknown as { axisValue: string }).axisValue
          const rows = params
            .filter(p => p.value > 0)
            .sort((a, b) => b.value - a.value)
            .map(p => `${p.marker}${p.seriesName}: ${p.value.toFixed(1)}%`)
          return [date, ...rows].join("<br/>")
        },
      },
      legend: { top: 5, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 11 } },
      grid: { left: 60, right: 20, top: 40, bottom: 50 },
      dataZoom: [
        { type: "inside" as const, start: 0, end: 100 },
        { type: "slider" as const, height: 18, bottom: 5 },
      ],
      xAxis: {
        type: "category" as const,
        data: cvarSectorDates,
        axisLabel: { fontSize: 10, rotate: 30 },
      },
      yAxis: {
        type: "value" as const,
        min: 0,
        max: 100,
        axisLabel: { formatter: (v: number) => v + "%" },
        splitLine: { lineStyle: { type: "dashed" as const } },
      },
      series: allGroups.map(g => ({
        name: g,
        type: "line" as const,
        stack: "total",
        areaStyle: { color: colorMap[g] ?? "#94a3b8" },
        lineStyle: { width: 0, color: colorMap[g] ?? "#94a3b8" },
        itemStyle: { color: colorMap[g] ?? "#94a3b8" },
        symbol: "none",
        data: rawData[g] ?? cvarSectorDates.map(() => 0),
        emphasis: { focus: "series" as const },
      })),
    }
  }, [weightMode, cvarSectorDates, cvarSectorCatData, cvarSectorSectorData, cvarSectorSubData])

  return (
    <div className="space-y-6">
      <section id="section-pos-timeseries">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          分类持仓时序
          <span className="h-px flex-1 bg-border" />
        </h2>
        <div className="flex gap-4">
        <div className="w-1/2">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm">大类资产多空持仓市值</CardTitle>
              <select
                className="text-xs border rounded px-2 py-0.5 bg-background"
                value={catFilter}
                onChange={e => { setCatFilter(e.target.value as ExposureCat); setSectorFilter("全部"); setSubSectorFilter("全部"); setProdFilter("全部") }}
              >
                {EXPOSURE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                className="text-xs border rounded px-2 py-0.5 bg-background"
                value={sectorFilter}
                onChange={e => { setSectorFilter(e.target.value as ExposureSector); setSubSectorFilter("全部"); setProdFilter("全部") }}
              >
                <option value="全部">全部板块</option>
                {(catFilter !== "全部" ? (CAT_TO_SECTORS[catFilter] ?? []) : EXPOSURE_SECTORS.slice(1)).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                className="text-xs border rounded px-2 py-0.5 bg-background"
                value={subSectorFilter}
                onChange={e => { setSubSectorFilter(e.target.value as ExposureSubSector); setProdFilter("全部") }}
              >
                <option value="全部">全部细分</option>
                {(sectorFilter !== "全部"
                  ? (SECTOR_TO_SUB_SECTORS[sectorFilter] ?? [])
                  : catFilter !== "全部"
                  ? (CAT_TO_SECTORS[catFilter] ?? []).flatMap(s => SECTOR_TO_SUB_SECTORS[s] ?? [])
                  : EXPOSURE_SUB_SECTORS.slice(1)
                ).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                className="text-xs border rounded px-2 py-0.5 bg-background"
                value={prodFilter}
                onChange={e => setProdFilter(e.target.value)}
              >
                <option value="全部">全部品种</option>
                {availableProds.map(p => <option key={p} value={p}>{p} {PROD_NAMES[p]}</option>)}
              </select>
            </div>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            {loading ? (
              <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
            ) : series.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-6">暂无持仓数据</p>
            ) : (
              <ReactECharts option={exposureOption} style={{ height: 380 }} notMerge />
            )}
          </CardContent>
        </Card>
        </div>
        <div className="w-1/2">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm">大类资产多空持仓市值/净资本</CardTitle>
              <select
                className="text-xs border rounded px-2 py-0.5 bg-background"
                value={catFilter}
                onChange={e => { setCatFilter(e.target.value as ExposureCat); setSectorFilter("全部"); setSubSectorFilter("全部"); setProdFilter("全部") }}
              >
                {EXPOSURE_CATS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                className="text-xs border rounded px-2 py-0.5 bg-background"
                value={sectorFilter}
                onChange={e => { setSectorFilter(e.target.value as ExposureSector); setSubSectorFilter("全部"); setProdFilter("全部") }}
              >
                <option value="全部">全部板块</option>
                {(catFilter !== "全部" ? (CAT_TO_SECTORS[catFilter] ?? []) : EXPOSURE_SECTORS.slice(1)).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                className="text-xs border rounded px-2 py-0.5 bg-background"
                value={subSectorFilter}
                onChange={e => { setSubSectorFilter(e.target.value as ExposureSubSector); setProdFilter("全部") }}
              >
                <option value="全部">全部细分</option>
                {(sectorFilter !== "全部"
                  ? (SECTOR_TO_SUB_SECTORS[sectorFilter] ?? [])
                  : catFilter !== "全部"
                  ? (CAT_TO_SECTORS[catFilter] ?? []).flatMap(s => SECTOR_TO_SUB_SECTORS[s] ?? [])
                  : EXPOSURE_SUB_SECTORS.slice(1)
                ).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                className="text-xs border rounded px-2 py-0.5 bg-background"
                value={prodFilter}
                onChange={e => setProdFilter(e.target.value)}
              >
                <option value="全部">全部品种</option>
                {availableProds.map(p => <option key={p} value={p}>{p} {PROD_NAMES[p]}</option>)}
              </select>
            </div>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            {loading ? (
              <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
            ) : series.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-6">暂无持仓数据</p>
            ) : (
              <ReactECharts option={ratioOption} style={{ height: 380 }} notMerge />
            )}
          </CardContent>
        </Card>
        </div>
        </div>
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="flex text-xs border rounded overflow-hidden">
                  {([["weight", "持仓权重"], ["var", "持仓VaR"], ["margvol", "市值加权波动率"], ["cvar", "持仓CVaR"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setVarWeightView(val)}
                    className={`px-2.5 py-0.5 transition-colors ${
                      varWeightView === val
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >{label}</button>
                ))}
              </div>
              <CardTitle className="text-sm">
                {varWeightView === "weight"
                  ? `持仓权重走势（${weightCalcMode === "net" ? "净市值/净总市值" : "总市值/期货总市值"}）`
                  : varWeightView === "var"
                  ? "持仓VaR走势（各板块VaR占比）"
                  : varWeightView === "pnl"
                  ? "持仓|盈亏|走势（各板块|盈亏|占比）"
                  : varWeightView === "margvol"
                  ? "持仓边际波动率走势（各板块边际波动率占比）"
                  : "持仓CVaR走势（各板块CVaR/ES贡献占比，历史模拟95%）"}
              </CardTitle>
              <div className="flex text-xs border rounded overflow-hidden">
                {([["大类", "大类资产"], ["板块", "板块"], ["细分", "细分板块"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setWeightMode(val)}
                    className={`px-2.5 py-0.5 transition-colors ${
                      weightMode === val
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >{label}</button>
                ))}
              </div>
              {varWeightView === "weight" && (
                <div className="flex text-xs border rounded overflow-hidden">
                  {([["总市值", "gross"], ["净市值", "net"]] as const).map(([label, val]) => (
                    <button
                      key={val}
                      onClick={() => setWeightCalcMode(val)}
                      className={`px-2.5 py-0.5 transition-colors ${
                        weightCalcMode === val
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >{label}</button>
                  ))}
                </div>
              )}
              <div className="relative ml-auto">
                <button
                  onClick={() => setVarChartHelpOpen(v => !v)}
                  className="w-5 h-5 rounded-full border text-xs font-bold text-muted-foreground hover:text-foreground hover:border-foreground transition-colors flex items-center justify-center"
                  title="查看公式说明"
                >?</button>
                {varChartHelpOpen && (
                  <div
                    className="absolute right-0 top-7 z-50 w-[520px] rounded-lg border bg-popover text-popover-foreground shadow-lg p-4 text-xs leading-relaxed"
                    style={{ maxHeight: "70vh", overflowY: "auto" }}
                  >
                    <button
                      onClick={() => setVarChartHelpOpen(false)}
                      className="float-right text-muted-foreground hover:text-foreground leading-none ml-2"
                    >✕</button>
                    {varWeightView === "weight" && (
                      <div className="space-y-2">
                        <p className="font-semibold text-sm">持仓权重走势</p>
                        <p>每个板块占总持仓市值的比例。</p>
                        <p className="font-medium mt-1">总市值模式（gross）</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`weight_s = (long_s + |short_s|) / Σ(long + |short|)`}</p>
                        <p>将多头和空头市值累加，反映各板块占用资金规模。</p>
                        <p className="font-medium mt-1">净市值模式（net）</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`weight_s = |long_s - |short_s|| / Σ|long - |short||`}</p>
                        <p>反映各板块净敞口，多空对冲会减小权重。</p>
                      </div>
                    )}
                    {varWeightView === "var" && (
                      <div className="space-y-2">
                        <p className="font-semibold text-sm">持仓VaR走势（边际风险贡献占比）</p>
                        <p>每个板块对组合整体方差的边际贡献占比，与日间风控VaR沙盒的"板块边际波动贡献占比"饼图完全一致。</p>
                        <p className="font-medium mt-1">Step 1 — 签名美元波动率 dv&#7522;</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`σ_i  = StdDev(r_{i,t})  t ∈ [-20, 0) 交易日\ndv_i = σ_i × MV_i        (MV带符号：多>0 / 空<0)`}</p>
                        <p className="font-medium mt-1">Step 2 — 相关矩阵 ρ&#7522;ⱼ</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`ρ_{ij} = PearsonCorr(r_i, r_j)  t ∈ [-252, 0)`}</p>
                        <p className="font-medium mt-1">Step 3 — 边际风险贡献 MCR&#7522;</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`MCR_i = |dv_i × Σ_j(dv_j × ρ_{ij})|`}</p>
                        <p className="font-medium mt-1">Step 4 — 板块占比</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`VaR_s   = Σ_{i∈s} MCR_i\nweight_s = VaR_s / Σ VaR_s × 100%`}</p>
                        <p>相关性高的板块共同放大组合风险，对冲排列封面会减小占比。</p>
                      </div>
                    )}
                    {varWeightView === "pnl" && (
                      <div className="space-y-2">
                        <p className="font-semibold text-sm">持仓|盈亏|走势</p>
                        <p>各板块实际持仓盈亏的绝对值占全部各板块绝对盈亏之和的比例。</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`PnL_s   = Σ_{i∈s} 持仓盈亏_i\nweight_s = |PnL_s| / Σ_s |PnL_s| × 100%`}</p>
                        <p>直接反映各板块对产品组合实际收益的贡献度，不需要历史行情数据。</p>
                      </div>
                    )}
                    {varWeightView === "margvol" && (
                      <div className="space-y-2">
                        <p className="font-semibold text-sm">边际波动率走势（板块级山岳法）</p>
                        <p>各板块独立计算自身市值加权波动率，板块间相关性被忽略。</p>
                        <p className="font-medium mt-1">Step 1 — 板块加权收益率</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`r_{s,t} = Σ_{i∈s} (|MV_i| / |MV_s|) × r_{i,t}`}</p>
                        <p className="font-medium mt-1">Step 2 — 板块美元波动率</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`dv_s     = StdDev(r_{s,t}) × |MV_s|\nweight_s = dv_s / Σ dv_s × 100%`}</p>
                        <p>回答"如果各板块是独立的，市值加权波动率各占多少？"</p>
                      </div>
                    )}
                    {varWeightView === "cvar" && (
                      <div className="space-y-2">
                        <p className="font-semibold text-sm">持仓CVaR走势（历史模拟预期损失贡献占比）</p>
                        <p>基于历史场景模拟，识别尾部最差平仓日，计算各产品对组合尾部损失的周边贡献。</p>
                        <p className="font-medium mt-1">Step 1 — 组合模拟盈亏</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`PnL_t = Σ_i MV_i × r_{i,t}    t ∈ [-252, 0)`}</p>
                        <p className="font-medium mt-1">Step 2 — 5%尾部场景（置信水平95%）</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`T* = {最差的 ⌊histDays × 5%⌋ 个日期}`}</p>
                        <p className="font-medium mt-1">Step 3 — 周边CVaR贡献</p>
                        <p className="font-mono bg-muted rounded px-2 py-1 whitespace-pre">{`CompCVaR_i = -mean_{t∈T*}(MV_i × r_{i,t})\nweight_s   = Σ_{i∈s} |CompCVaR_i| / Σ|CompCVaR_i| × 100%`}</p>
                        <p>与VaR MCR的区别：VaR用协方差矩阵（全分布），CVaR仅用尾部场景，对极端市场应力更敏感。</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            {varWeightView === "weight" ? (
              loading ? (
                <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
              ) : series.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">暂无持仓数据</p>
              ) : (
                <ReactECharts option={sectorWeightOption} style={{ height: 360 }} notMerge />
              )
            ) : varWeightView === "var" ? (
              varSectorLoading ? (
                <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
              ) : !sectorVarOption ? (
                <p className="text-sm text-muted-foreground px-4 py-6">暂无VaR数据</p>
              ) : (
                <ReactECharts option={sectorVarOption} style={{ height: 360 }} notMerge />
              )
            ) : varWeightView === "pnl" ? (
              pnlSectorLoading ? (
                <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
              ) : !sectorPnlOption ? (
                <p className="text-sm text-muted-foreground px-4 py-6">暂无盈亏数据</p>
              ) : (
                <ReactECharts option={sectorPnlOption} style={{ height: 360 }} notMerge />
              )
            ) : varWeightView === "margvol" ? (
              margVolLoading ? (
                <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
              ) : !sectorMargVolOption ? (
                <p className="text-sm text-muted-foreground px-4 py-6">暂无边际波动率数据</p>
              ) : (
                <ReactECharts option={sectorMargVolOption} style={{ height: 360 }} notMerge />
              )
            ) : (
              cvarSectorLoading ? (
                <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
              ) : !sectorCVarOption ? (
                <p className="text-sm text-muted-foreground px-4 py-6">暂无CVaR数据</p>
              ) : (
                <ReactECharts option={sectorCVarOption} style={{ height: 360 }} notMerge />
              )
            )}
          </CardContent>
        </Card>
      </section>
      <section id="section-pos-cross">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          分类持仓截面
          <span className="h-px flex-1 bg-border" />
        </h2>
        <div className="flex gap-4 items-start">
        <div className="w-1/2" ref={barLeftRef}>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm">期货市值占比（市值/净资本）</CardTitle>
              <div className="flex items-center gap-1">
                <button
                  className="text-xs border rounded px-1.5 py-0.5 bg-background hover:bg-muted disabled:opacity-30"
                  disabled={(() => { const cur = sectorBarDate || (series[series.length - 1]?.date ?? ""); return !cur || cur <= (series[0]?.date ?? "") })()}
                  onClick={() => {
                    const cur = sectorBarDate || (series[series.length - 1]?.date ?? "")
                    const idx = series.findIndex(r => r.date === cur)
                    if (idx > 0) setSectorBarDate(series[idx - 1].date)
                  }}
                >◀</button>
                <input
                  type="date"
                  className="text-xs border rounded px-2 py-0.5 bg-background"
                  value={sectorBarDate || (series[series.length - 1]?.date ?? "")}
                  min={series[0]?.date ?? ""}
                  max={series[series.length - 1]?.date ?? ""}
                  onChange={e => setSectorBarDate(e.target.value)}
                />
                <button
                  className="text-xs border rounded px-1.5 py-0.5 bg-background hover:bg-muted disabled:opacity-30"
                  disabled={(() => { const cur = sectorBarDate || (series[series.length - 1]?.date ?? ""); return !cur || cur >= (series[series.length - 1]?.date ?? "") })()}
                  onClick={() => {
                    const cur = sectorBarDate || (series[series.length - 1]?.date ?? "")
                    const idx = series.findIndex(r => r.date === cur)
                    if (idx >= 0 && idx < series.length - 1) setSectorBarDate(series[idx + 1].date)
                  }}
                >▶</button>
                {sectorBarDate && sectorBarDate !== series[series.length - 1]?.date && (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSectorBarDate("")}
                  >最新</button>
                )}
              </div>
              <div className="flex text-xs border rounded overflow-hidden">
                {([["大类", "大类资产"], ["板块", "板块"], ["细分", "细分板块"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setSectorBarMode(val)}
                    className={`px-2.5 py-0.5 transition-colors ${
                      sectorBarMode === val
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >{label}</button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            {loading ? (
              <p className="text-sm text-muted-foreground px-4 py-6">加载中...</p>
            ) : series.length === 0 ? (
              <p className="text-sm text-muted-foreground px-4 py-6">暂无持仓数据</p>
            ) : (
              <ReactECharts option={sectorBarOption} style={{ height: 300 }} notMerge />
            )}
          </CardContent>
        </Card>
        </div>
        <div className="w-1/2 flex flex-col" style={{ height: barLeftHeight }}>
        <Card className="overflow-hidden flex flex-col h-full">
          <CardContent className="p-0 overflow-y-auto flex-1 min-h-0">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b bg-muted/40">
                  {(["sector","longMv","longPct","shortMv","shortPct","netMv","netPctNorm"] as const).map((col, ci) => {
                    const labels: Record<string, string> = { sector:"板块", longMv:"多头市值(元)", longPct:"多头占比", shortMv:"空头市值(元)", shortPct:"空头占比", netMv:"轧差市值(元)", netPctNorm:"轧差市值占比(归一)" }
                    const active = sectorBarSort?.col === col
                    const dir = active ? sectorBarSort!.dir : null
                    return (
                      <th key={col} className={`${ci === 0 ? "text-left" : "text-right"} px-3 py-2 font-medium cursor-pointer select-none hover:bg-muted/60 whitespace-nowrap`}
                        onClick={() => setSectorBarSort(prev =>
                          prev?.col === col ? { col, dir: prev.dir === "desc" ? "asc" : "desc" } : { col, dir: "desc" }
                        )}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          {labels[col]}
                          <span className="text-muted-foreground text-[10px]">{dir === "desc" ? "↓" : dir === "asc" ? "↑" : "↕"}</span>
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...sectorBarRows].sort((a, b) => {
                  if (!sectorBarSort) return 0
                  const { col, dir } = sectorBarSort
                  const va = a[col], vb = b[col]
                  const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)
                  return dir === "asc" ? cmp : -cmp
                }).map((row) => (
                  <tr key={row.sector} className="hover:bg-muted/30">
                    <td className="px-3 py-1.5 font-medium">{row.sector}</td>
                    <td className="px-3 py-1.5 text-right">{Math.round(row.longMv).toLocaleString("zh-CN")}</td>
                    <td className="px-3 py-1.5 text-right">{row.longPct.toFixed(1)}%</td>
                    <td className="px-3 py-1.5 text-right">{Math.round(row.shortMv).toLocaleString("zh-CN")}</td>
                    <td className="px-3 py-1.5 text-right">{row.shortPct.toFixed(1)}%</td>
                    <td className={`px-3 py-1.5 text-right ${row.netMv < 0 ? "text-blue-500" : "text-orange-500"}`}>
                      {Math.round(row.netMv).toLocaleString("zh-CN")}
                    </td>
                    <td className={`px-3 py-1.5 text-right ${row.netMv < 0 ? "text-blue-500" : "text-orange-500"}`}>
                      {row.netPctNorm.toFixed(1)}%
                    </td>
                  </tr>
                ))}
                {sectorBarRows.length > 0 && (() => {
                  const totalLong = sectorBarRows.reduce((s, r) => s + r.longMv, 0)
                  const totalShort = sectorBarRows.reduce((s, r) => s + r.shortMv, 0)
                  const totalLongPct = sectorBarRows.reduce((s, r) => s + r.longPct, 0)
                  const totalShortPct = sectorBarRows.reduce((s, r) => s + r.shortPct, 0)
                  const totalNet = sectorBarRows.reduce((s, r) => s + r.netMv, 0)
                  const totalNetPctNorm = sectorBarRows.reduce((s, r) => s + r.netPctNorm, 0)
                  return (
                    <tr className="border-t-2 font-semibold bg-muted/40">
                      <td className="px-3 py-1.5">合计</td>
                      <td className="px-3 py-1.5 text-right">{Math.round(totalLong).toLocaleString("zh-CN")}</td>
                      <td className="px-3 py-1.5 text-right">{totalLongPct.toFixed(1)}%</td>
                      <td className="px-3 py-1.5 text-right">{Math.round(totalShort).toLocaleString("zh-CN")}</td>
                      <td className="px-3 py-1.5 text-right">{totalShortPct.toFixed(1)}%</td>
                      <td className={`px-3 py-1.5 text-right ${totalNet < 0 ? "text-blue-500" : "text-orange-500"}`}>
                        {Math.round(totalNet).toLocaleString("zh-CN")}
                      </td>
                      <td className={`px-3 py-1.5 text-right ${totalNetPctNorm < 0 ? "text-blue-500" : "text-orange-500"}`}>
                        {totalNetPctNorm.toFixed(1)}%
                      </td>
                    </tr>
                  )
                })()}
              </tbody>
            </table>
          </CardContent>
        </Card>
        </div>
        </div>
      </section>

      <OptionHoldingContent />

      <section id="section-pos-change-area" className="mt-6">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          持仓变化
          <span className="h-px flex-1 bg-border" />
        </h2>
        <div className="flex gap-4" style={{ height: 460 }}>
          <div className="w-1/3 shrink-0 h-full">
            <Card className="h-full flex flex-col">
              <CardHeader className="shrink-0 pb-1 pt-3 px-3">
                <CardTitle className="text-sm">
                  品种持仓变化 |ΔVaR|降序
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">今日 vs 昨日</span>
                </CardTitle>
                <div className="flex items-center gap-2 mt-1 text-[11px]">
                  <select className="border rounded px-1.5 py-0.5 bg-background text-xs" value={pcChartSector}
                    onChange={e => { setPcChartSector(e.target.value); setPcChartSubSector("全部") }}>
                    <option value="全部">板块:全部</option>
                    {EXPOSURE_SECTORS.filter(s => s !== "全部").map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className="border rounded px-1.5 py-0.5 bg-background text-xs" value={pcChartSubSector}
                    onChange={e => setPcChartSubSector(e.target.value)}>
                    <option value="全部">细分:全部</option>
                    {(pcChartSector !== "全部" ? (SECTOR_TO_SUB_SECTORS[pcChartSector] ?? []) : EXPOSURE_SUB_SECTORS.filter(s => s !== "全部")).map(s =>
                      <option key={s} value={s}>{s}</option>
                    )}
                  </select>
                </div>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-2 pt-0">
                <PositionChangeChart onProdClick={setPcProdFilter} sectorFilter={pcChartSector} subSectorFilter={pcChartSubSector} />
              </CardContent>
            </Card>
          </div>
          <PositionChangeDetailTable
            prodFilter={pcProdFilter} setProdFilter={setPcProdFilter}
            catFilter2={pcCatFilter} setCatFilter2={setPcCatFilter}
            sectorFilter2={pcSectorFilter} setSectorFilter2={setPcSectorFilter}
            subSectorFilter2={pcSubSectorFilter} setSubSectorFilter2={setPcSubSectorFilter}
            onTodayDetail={() => {
              setTodayDetailProd(pcProdFilter)
              setTodayExpandTrigger(n => n + 1)
              setTimeout(() => {
                const scroller = document.getElementById("pos-main-scroll")
                const target = document.getElementById("section-today-position")
                if (scroller && target) {
                  const scrollerRect = scroller.getBoundingClientRect()
                  const targetRect = target.getBoundingClientRect()
                  scroller.scrollBy({ top: targetRect.top - scrollerRect.top - 12, behavior: "smooth" })
                }
              }, 50)
            }}
            onYesterdayDetail={() => {
              setYesterdayDetailProd(pcProdFilter)
              setYesterdayExpandTrigger(n => n + 1)
              setTimeout(() => {
                const scroller = document.getElementById("pos-main-scroll")
                const target = document.getElementById("section-yesterday-position")
                if (scroller && target) {
                  const scrollerRect = scroller.getBoundingClientRect()
                  const targetRect = target.getBoundingClientRect()
                  scroller.scrollBy({ top: targetRect.top - scrollerRect.top - 12, behavior: "smooth" })
                }
              }, 50)
            }}
          />
        </div>

        {/* Three placeholder charts */}
        <div className="grid grid-cols-3 gap-4 mt-4">
          <Card>
            <CardHeader className="pb-1 pt-3 px-3">
              <div className="flex items-center gap-2">
                <CardTitle className="text-xs font-medium">多空变化象限图</CardTitle>
                <div className="flex text-[10px] border rounded overflow-hidden">
                  {(["大类", "板块", "细分"] as const).map(val => (
                    <button
                      key={val}
                      onClick={() => setScatterDim(val)}
                      className={`px-2 py-0.5 transition-colors ${
                        scatterDim === val
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >{val === "细分" ? "细分板块" : val === "大类" ? "大类资产" : "板块"}</button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              {loading || !catScatterOption
                ? <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">加载中...</div>
                : <ReactECharts option={catScatterOption} style={{ height: 300 }} notMerge />
              }
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-3">
              <CardTitle className="text-xs font-medium">
                多空持仓市值走势
                {pcProdFilter !== "全部" ? ` — ${pcProdFilter}${PROD_NAMES[pcProdFilter] ? ` ${PROD_NAMES[pcProdFilter]}` : ""}` : pcSubSectorFilter !== "全部" ? ` — ${pcSubSectorFilter}` : pcSectorFilter !== "全部" ? ` — ${pcSectorFilter}` : pcCatFilter !== "全部" ? ` — ${pcCatFilter}` : " — 全部"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              {loading
                ? <div className="h-[300px] flex items-center justify-center text-xs text-muted-foreground">加载中...</div>
                : <ReactECharts option={miniExposureOption} style={{ height: 300 }} notMerge />
              }
            </CardContent>
          </Card>
          <Card key={3}>
            <CardHeader className="pb-1 pt-3 px-3">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-xs font-medium">
                  {card3View === "timeseries"
                    ? <>VaR预测 vs 实际 |盈亏|{varGroupLabel !== "全部" ? ` — ${varGroupLabel}` : " — 全部"}</>
                    : <>ΔVaR分解 — {breakdownDim}</>
                  }
                </CardTitle>
                <button
                  className="ml-auto text-[10px] border rounded px-1.5 py-0.5 bg-background hover:bg-muted transition-colors"
                  onClick={() => setCard3View(v => v === "timeseries" ? "breakdown" : "timeseries")}
                >
                  {card3View === "timeseries" ? "ΔVaR分布 →" : "← VaR走势"}
                </button>
                {card3View === "breakdown"
                  ? (["大类", "板块", "细分板块"] as const).map(dim => (
                      <button
                        key={dim}
                        className={`text-[10px] border rounded px-1.5 py-0.5 transition-colors ${breakdownDim === dim ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                        onClick={() => setBreakdownDim(dim)}
                      >
                        {dim}
                      </button>
                    ))
                  : <select
                      className="text-[10px] border rounded px-1 py-0.5 bg-background"
                      value={varGroupConf}
                      onChange={e => setVarGroupConf(e.target.value as "90" | "95" | "99")}
                    >
                      <option value="90">90%</option>
                      <option value="95">95%</option>
                      <option value="99">99%</option>
                    </select>
                }
              </div>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              {card3View === "timeseries"
                ? varGroupLoading
                  ? <div className="h-[300px] flex items-center justify-center text-xs text-muted-foreground">加载中...</div>
                  : !varGroupOption
                  ? <div className="h-[300px] flex items-center justify-center text-xs text-muted-foreground">暂无数据</div>
                  : <ReactECharts option={varGroupOption} style={{ height: 300 }} notMerge />
                : !varBreakdownOption
                ? <div className="h-[300px] flex items-center justify-center text-xs text-muted-foreground">{varBreakdownProds.length === 0 ? "加载中..." : "暂无数据"}</div>
                : <ReactECharts option={varBreakdownOption} style={{ height: 300 }} notMerge />
              }
            </CardContent>
          </Card>
        </div>

        <TodayPositionSection
          prodOverride={todayDetailProd}
          sectionId="section-today-position"
          dayLabel="今日"
          expandTrigger={todayExpandTrigger}
          onScrollBack={() => {
            const scroller = document.getElementById("pos-main-scroll")
            const target = document.getElementById("section-pos-change")
            if (scroller && target) {
              const scrollerRect = scroller.getBoundingClientRect()
              const targetRect = target.getBoundingClientRect()
              scroller.scrollBy({ top: targetRect.top - scrollerRect.top - 12, behavior: "smooth" })
            }
          }}
        />
        <TodayPositionSection
          dayRank={2}
          prodOverride={yesterdayDetailProd}
          sectionId="section-yesterday-position"
          dayLabel="昨日"
          expandTrigger={yesterdayExpandTrigger}
          onScrollBack={() => {
            const scroller = document.getElementById("pos-main-scroll")
            const target = document.getElementById("section-pos-change")
            if (scroller && target) {
              const scrollerRect = scroller.getBoundingClientRect()
              const targetRect = target.getBoundingClientRect()
              scroller.scrollBy({ top: targetRect.top - scrollerRect.top - 12, behavior: "smooth" })
            }
          }}
        />
      </section>
    </div>
  )
}

// ── Anomaly Detection ──────────────────────────────────────────────────────

type AnomalySeverity = "critical" | "warning" | "info"

interface Anomaly {
  id: string
  date: string
  account: string | null
  type: string
  severity: AnomalySeverity
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

const ANOMALY_TYPE_LABELS: Record<string, string> = {
  HIGH_RISK_RATIO: "高风险度",
  LOW_AVAILABLE_FUNDS: "可用资金不足",
  MARGIN_OVERUSE: "保证金占用过高",
  LARGE_DAILY_LOSS: "当日亏损",
  NEGATIVE_EQUITY: "权益为负",
}

const SEVERITY_ORDER: AnomalySeverity[] = ["critical", "warning", "info"]

function anomalySeverityIcon(s: AnomalySeverity) {
  if (s === "critical") return <AlertCircle className="h-4 w-4 text-red-500" />
  if (s === "warning") return <AlertTriangle className="h-4 w-4 text-yellow-500" />
  return <Info className="h-4 w-4 text-blue-500" />
}

function anomalySeverityLabel(s: AnomalySeverity) {
  return { critical: "严重", warning: "警告", info: "提示" }[s]
}

function anomalySeverityBadgeVariant(s: AnomalySeverity): "destructive" | "outline" | "secondary" {
  if (s === "critical") return "destructive"
  if (s === "warning") return "outline"
  return "secondary"
}

function anomalySeverityBorderClass(s: AnomalySeverity): string {
  if (s === "critical") return "border-red-500/50 bg-red-500/5"
  if (s === "warning") return "border-yellow-500/50 bg-yellow-500/5"
  return "border-blue-500/50 bg-blue-500/5"
}

interface LiqDaySummary {
  date: string
  liqCritical: number
  liqWarning: number
}

function AnomalyContent() {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([])
  const [dailySummary, setDailySummary] = useState<DailySummary[]>([])
  const [liqHistory, setLiqHistory] = useState<LiqDaySummary[]>([])
  const [latestDate, setLatestDate] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notYetRun, setNotYetRun] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liqDetail, setLiqDetail] = useState<ContractLiquidity[] | null>(null)
  const [liqDetailLoading, setLiqDetailLoading] = useState(false)

  const load = useCallback(async (nocache = false) => {
    setLoading(true)
    setError(null)
    try {
      const suffix = nocache ? "&nocache=1" : ""
      const [anomalyRes, liqRes] = await Promise.all([
        fetch(`/ma/api/mom-analysis/anomaly-detection?lookback=30${suffix}`),
        fetch(`/ma/api/mom-analysis/liquidity-history?lookback=30${suffix}`),
      ])
      const json = await anomalyRes.json()
      if (!json.ok && json.error) { setError(json.error); return }
      setNotYetRun(!!json.notYetRun)
      setAnomalies(json.anomalies ?? [])
      setDailySummary(json.dailySummary ?? [])
      setLatestDate(json.latestDate ?? null)
      if (json.latestDate) setSelectedDate((prev) => prev ?? json.latestDate)
      const liqJson = await liqRes.json()
      if (liqJson.ok) setLiqHistory(liqJson.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [])

  const liqMap = useMemo(() => {
    const m = new Map<string, LiqDaySummary>()
    for (const d of liqHistory) m.set(d.date, d)
    return m
  }, [liqHistory])

  // Fetch liquidity details for the selected date when it has liquidity issues
  useEffect(() => {
    if (!selectedDate) { setLiqDetail(null); return }
    const summary = liqMap.get(selectedDate)
    if (!summary || (summary.liqCritical === 0 && summary.liqWarning === 0)) {
      setLiqDetail(null); return
    }
    setLiqDetailLoading(true)
    fetch(`/ma/api/mom-analysis/liquidity-scan?date=${selectedDate}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          const flagged = (j.contracts as ContractLiquidity[]).filter((c) => c.severity !== "ok")
          setLiqDetail(flagged.length > 0 ? flagged : null)
        }
      })
      .catch(() => {})
      .finally(() => setLiqDetailLoading(false))
  }, [selectedDate, liqMap])

  const availableDates = useMemo(() => dailySummary.map((d) => d.date).sort(), [dailySummary])
  const currentIndex = selectedDate ? availableDates.indexOf(selectedDate) : -1
  const canPrev = currentIndex > 0
  const canNext = currentIndex < availableDates.length - 1

  const dayAnomalies = useMemo(() =>
    (anomalies.filter((a) => a.date === selectedDate)
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))),
    [anomalies, selectedDate]
  )

  const daySummary = useMemo(() =>
    dailySummary.find((d) => d.date === selectedDate) ?? null,
    [dailySummary, selectedDate]
  )

  const byType = useMemo(() => {
    const map: Record<string, Anomaly[]> = {}
    for (const a of dayAnomalies) {
      if (!map[a.type]) map[a.type] = []
      map[a.type].push(a)
    }
    return map
  }, [dayAnomalies])

  const dayLiq = useMemo(() =>
    selectedDate ? (liqMap.get(selectedDate) ?? null) : null,
    [liqMap, selectedDate]
  )

  const chartOption = useMemo(() => {
    if (dailySummary.length === 0) return null
    const sorted = [...dailySummary].sort((a, b) => a.date.localeCompare(b.date))
    const hasLiq = liqHistory.length > 0
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: any[]) => {
          const date = params[0]?.axisValue ?? ""
          const lines = params
            .filter((p: any) => p.value > 0)
            .map((p: any) => `${p.marker}${p.seriesName}: ${p.value}`)
          return lines.length ? [date, ...lines].join("<br/>") : date + "<br/>无异常"
        },
      },
      legend: {
        data: hasLiq ? ["异常严重", "异常警告", "流动性严重", "流动性警告"] : ["严重", "警告"],
        textStyle: { color: "#94a3b8", fontSize: 10 },
        right: 0,
        top: 0,
      },
      grid: { left: 0, right: 16, top: 28, bottom: 0, containLabel: true },
      xAxis: {
        type: "category",
        data: sorted.map((s) => s.date),
        axisLabel: { color: "#94a3b8", fontSize: 10, rotate: 35, formatter: (v: string) => v.slice(5) },
        axisLine: { lineStyle: { color: "#334155" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: { color: "#94a3b8", fontSize: 10 },
        splitLine: { lineStyle: { color: "#1e293b" } },
      },
      series: hasLiq ? [
        { name: "异常严重",   type: "bar", stack: "total", data: sorted.map((s) => s.critical),                       itemStyle: { color: "#ef4444" }, emphasis: { itemStyle: { color: "#dc2626" } } },
        { name: "异常警告",   type: "bar", stack: "total", data: sorted.map((s) => s.warning),                        itemStyle: { color: "#eab308" }, emphasis: { itemStyle: { color: "#ca8a04" } } },
        { name: "流动性严重", type: "bar", stack: "total", data: sorted.map((s) => liqMap.get(s.date)?.liqCritical ?? 0), itemStyle: { color: "#f97316" }, emphasis: { itemStyle: { color: "#ea6c00" } } },
        { name: "流动性警告", type: "bar", stack: "total", data: sorted.map((s) => liqMap.get(s.date)?.liqWarning  ?? 0), itemStyle: { color: "#fb923c", borderRadius: [3, 3, 0, 0] }, emphasis: { itemStyle: { color: "#f97316" } } },
      ] : [
        { name: "严重", type: "bar", stack: "total", data: sorted.map((s) => s.critical), itemStyle: { color: "#ef4444" }, emphasis: { itemStyle: { color: "#dc2626" } } },
        { name: "警告", type: "bar", stack: "total", data: sorted.map((s) => s.warning),  itemStyle: { color: "#eab308", borderRadius: [3, 3, 0, 0] }, emphasis: { itemStyle: { color: "#ca8a04" } } },
      ],
    }
  }, [dailySummary, liqHistory, liqMap])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <RefreshCw className="h-5 w-5 animate-spin mr-2" />加载中…
      </div>
    )
  }

  if (notYetRun) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
        <ScanSearch className="h-10 w-10 opacity-30" />
        <p className="text-sm">暂无数据，请先完成数据导入。</p>
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-red-500 pt-4">{error}</p>
  }

  return (
    <div className="space-y-6">
      {/* Refresh */}
      <div className="flex justify-end">
        <button
          onClick={() => load(true)}
          className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />刷新
        </button>
      </div>

      {/* Bar chart */}
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
                  const d = dailySummary[params.dataIndex]?.date
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
        <button
          disabled={!canPrev}
          onClick={() => setSelectedDate(availableDates[currentIndex - 1])}
          className="rounded-md border border-input bg-background p-1 shadow-sm disabled:opacity-40 hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium tabular-nums w-28 text-center">{selectedDate ?? "—"}</span>
        <button
          disabled={!canNext}
          onClick={() => setSelectedDate(availableDates[currentIndex + 1])}
          className="rounded-md border border-input bg-background p-1 shadow-sm disabled:opacity-40 hover:bg-muted transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 ml-2">
          {daySummary && daySummary.critical > 0 && (
            <Badge variant="destructive" className="text-xs">{daySummary.critical} 异常严重</Badge>
          )}
          {daySummary && daySummary.warning > 0 && (
            <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600 dark:text-yellow-400">{daySummary.warning} 异常警告</Badge>
          )}
          {dayLiq && dayLiq.liqCritical > 0 && (
            <Badge variant="outline" className="text-xs border-orange-500 text-orange-600 dark:text-orange-400">{dayLiq.liqCritical} 流动性严重</Badge>
          )}
          {dayLiq && dayLiq.liqWarning > 0 && (
            <Badge variant="outline" className="text-xs border-orange-400/60 text-orange-500 dark:text-orange-300">{dayLiq.liqWarning} 流动性警告</Badge>
          )}
          {daySummary && daySummary.total === 0 && (!dayLiq || (dayLiq.liqCritical === 0 && dayLiq.liqWarning === 0)) && (
            <Badge variant="secondary" className="text-xs text-green-600 dark:text-green-400 border-green-500/30">无异常</Badge>
          )}
        </div>
      </div>

      {/* Anomaly list */}
      {dayAnomalies.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <ScanSearch className="h-10 w-10 opacity-20" />
          <p className="text-sm">{selectedDate ? `${selectedDate} 无异常` : "请选择日期"}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(byType).map(([type, items]) => (
            <Card key={type}>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {anomalySeverityIcon(items[0].severity)}
                  {ANOMALY_TYPE_LABELS[type] ?? type}
                  <span className="text-muted-foreground font-normal ml-1">({items.length} 条)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-1.5">
                  {items.map((anomaly) => (
                    <div
                      key={anomaly.id}
                      className={`flex items-start gap-3 px-3 py-3 rounded-md border ${anomalySeverityBorderClass(anomaly.severity)}`}
                    >
                      <div className="mt-0.5 shrink-0">{anomalySeverityIcon(anomaly.severity)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{anomaly.title}</span>
                          <Badge variant={anomalySeverityBadgeVariant(anomaly.severity)} className="text-[10px] h-4 px-1.5">
                            {anomalySeverityLabel(anomaly.severity)}
                          </Badge>
                          {anomaly.account && (
                            <span className="text-xs font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">{anomaly.account}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{anomaly.detail}</p>
                      </div>
                      {anomaly.value !== null && (
                        <div className="shrink-0 text-right">
                          <div className={`text-sm font-semibold tabular-nums ${
                            anomaly.severity === "critical" ? "text-red-500" : anomaly.severity === "warning" ? "text-yellow-500" : "text-blue-500"
                          }`}>
                            {anomaly.value.toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}{anomaly.unit ?? ""}
                          </div>
                          {anomaly.threshold !== null && (
                            <div className="text-[10px] text-muted-foreground">阈值 {anomaly.threshold}{anomaly.unit ?? ""}</div>
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

      {/* ── Historical liquidity detail for selected date ─────────────── */}
      {(liqDetailLoading || liqDetail) && (
        <Card>
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Droplets className="h-4 w-4 text-orange-500" />
              {selectedDate} 流动性风险合约
              {liqDetailLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />}
            </CardTitle>
          </CardHeader>
          {liqDetail && liqDetail.length > 0 && (
            <CardContent className="pt-0">
              <div className="space-y-1.5">
                {liqDetail.map((c) => (
                  <div
                    key={c.contract}
                    className={`flex items-start gap-3 px-3 py-3 rounded-md border ${
                      c.severity === "critical"
                        ? "border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-900/10"
                        : "border-orange-200 dark:border-orange-900/60 bg-orange-50/40 dark:bg-orange-900/10"
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">{liqSeverityIcon(c.severity)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold font-mono">{c.contract}</span>
                        {c.exchange && <span className="text-xs text-muted-foreground">{c.exchange}</span>}
                        <Badge
                          variant="outline"
                          className={`text-[10px] h-4 px-1.5 ${
                            c.severity === "critical"
                              ? "border-red-500 text-red-600 dark:text-red-400"
                              : "border-orange-500 text-orange-600 dark:text-orange-400"
                          }`}
                        >
                          {c.severity === "critical" ? "严重" : "警告"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">净持仓 {c.netLots} 手</span>
                      </div>
                      {c.accounts && c.accounts.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.accounts.map((a) => (
                            <span
                              key={a.account}
                              className="inline-flex items-center gap-1 text-[10px] font-mono bg-muted/70 px-1.5 py-0.5 rounded border border-border/60"
                            >
                              <span className="font-medium">{a.account}</span>
                              <span className="text-muted-foreground">
                                {a.longLots > 0 && a.shortLots > 0
                                  ? `多${a.longLots}/空${a.shortLots}手`
                                  : `${a.netLots}手`}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                        {c.volume !== null && (
                          <span className="text-xs text-muted-foreground">日成交 {c.volume.toLocaleString()} 手</span>
                        )}
                        {c.participationRate !== null && (
                          <span className={`text-xs font-medium ${c.participationRate >= 15 ? "text-red-500" : c.participationRate >= 5 ? "text-orange-500" : "text-muted-foreground"}`}>
                            成交占比 {c.participationRate.toFixed(1)}%
                          </span>
                        )}
                        {c.openInterest !== null && (
                          <span className="text-xs text-muted-foreground">持仓量 {c.openInterest.toLocaleString()} 手</span>
                        )}
                        {c.oiConcentration !== null && (
                          <span className={`text-xs font-medium ${c.oiConcentration >= 8 ? "text-red-500" : c.oiConcentration >= 3 ? "text-orange-500" : "text-muted-foreground"}`}>
                            持仓占比 {c.oiConcentration.toFixed(1)}%
                          </span>
                        )}
                      </div>
                      {c.warnings.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {c.warnings.map((w, i) => (
                            <li key={i} className="text-xs text-muted-foreground leading-relaxed">• {w}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Liquidity Scan ───────────────────────────────────────────── */}
      <LiquiditySection />
    </div>
  )
}

// ── Liquidity types ───────────────────────────────────────────────────────────

type LiquiditySeverity = "critical" | "warning" | "ok"

interface ContractLiquidityAccount {
  account: string
  longLots: number
  shortLots: number
  netLots: number
}

interface ContractLiquidity {
  contract: string
  product: string
  exchange: string
  netLots: number
  longLots: number
  shortLots: number
  positionMv: number
  margin: number
  volume: number | null
  openInterest: number | null
  participationRate: number | null
  oiConcentration: number | null
  severity: LiquiditySeverity
  warnings: string[]
  dataDate: string
  mktDate: string | null
  accounts: ContractLiquidityAccount[]
}

interface LiquidityScanResult {
  ok: boolean
  date: string | null
  mktDate: string | null
  contracts: ContractLiquidity[]
  summary: { total: number; critical: number; warning: number; ok: number; noMktData: number } | null
  notYetRun?: boolean
  error?: string
}

function liqSeverityIcon(s: LiquiditySeverity) {
  if (s === "critical") return <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
  if (s === "warning")  return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
  return <Info className="h-4 w-4 text-emerald-500 shrink-0" />
}

function liqSeverityBorderClass(s: LiquiditySeverity) {
  if (s === "critical") return "border-red-500/40 bg-red-500/5"
  if (s === "warning")  return "border-yellow-500/40 bg-yellow-500/5"
  return "border-border"
}

function fmtLots(n: number | null) {
  if (n === null) return "—"
  return n.toLocaleString("zh-CN")
}

function fmtRate(n: number | null) {
  if (n === null) return "—"
  return `${n.toFixed(2)}%`
}

function LiquiditySection() {
  const [data, setData] = useState<LiquidityScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async (nocache = false) => {
    setLoading(true)
    try {
      const res = await fetch(`/ma/api/mom-analysis/liquidity-scan${nocache ? "?nocache=1" : ""}`)
      const json: LiquidityScanResult = await res.json()
      setData(json)
    } catch {
      setData({ ok: false, date: null, mktDate: null, contracts: [], summary: null, error: "请求失败" })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [])

  const atRisk = useMemo(
    () => data?.contracts.filter((c) => c.severity !== "ok") ?? [],
    [data],
  )
  const shown = showAll ? (data?.contracts ?? []) : atRisk

  return (
    <div className="space-y-3 pt-2">
      {/* Section header */}
      <div className="flex items-center gap-3 pt-4">
        <div className="flex-1 border-t border-border" />
        <div className="flex items-center gap-2">
          <ScanSearch className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">流动性扫描</span>
        </div>
        <div className="flex-1 border-t border-border" />
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          扫描当前持仓合约流动性风险（成交量占比、持仓量浓度、市场深度）
          {data?.date && <span className="ml-1 font-mono">持仓日期 {data.date}</span>}
          {data?.mktDate && data.mktDate !== data.date && (
            <span className="ml-1 font-mono text-yellow-600 dark:text-yellow-400">市场数据 {data.mktDate}</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {data?.summary && (
            <div className="flex items-center gap-1.5">
              {data.summary.critical > 0 && (
                <Badge variant="destructive" className="text-xs">{data.summary.critical} 严重</Badge>
              )}
              {data.summary.warning > 0 && (
                <Badge variant="outline" className="text-xs border-yellow-500 text-yellow-600 dark:text-yellow-400">{data.summary.warning} 警告</Badge>
              )}
              {data.summary.ok > 0 && (
                <Badge variant="secondary" className="text-xs text-emerald-600 dark:text-emerald-400">{data.summary.ok} 正常</Badge>
              )}
              {data.summary.noMktData > 0 && (
                <Badge variant="outline" className="text-xs text-muted-foreground">{data.summary.noMktData} 无市场数据</Badge>
              )}
            </div>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium shadow-sm hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
          <RefreshCw className="h-4 w-4 animate-spin mr-2" />加载中…
        </div>
      ) : data?.notYetRun ? (
        <div className="flex flex-col items-center justify-center h-24 text-muted-foreground gap-1">
          <ScanSearch className="h-8 w-8 opacity-20" />
          <p className="text-xs">暂无持仓数据</p>
        </div>
      ) : data?.error ? (
        <p className="text-xs text-red-500">{data.error}</p>
      ) : shown.length === 0 && !showAll ? (
        <div className="flex flex-col items-center justify-center h-24 text-muted-foreground gap-1">
          <ScanSearch className="h-8 w-8 opacity-20" />
          <p className="text-xs">所有持仓合约流动性正常</p>
          {(data?.contracts.length ?? 0) > 0 && (
            <button onClick={() => setShowAll(true)} className="text-xs text-primary hover:underline mt-1">
              查看全部 {data!.contracts.length} 个合约
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Table header */}
          <div className="grid grid-cols-[2rem_minmax(7rem,1fr)_5rem_5rem_5rem_6rem_6rem_6rem] gap-2 px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-b border-border">
            <div />
            <div>合约</div>
            <div className="text-right">净持仓(手)</div>
            <div className="text-right">日成交量</div>
            <div className="text-right">持仓量</div>
            <div className="text-right">成交量占比</div>
            <div className="text-right">持仓量占比</div>
            <div className="text-right">保证金(万)</div>
          </div>

          {shown.map((c) => (
            <div
              key={c.contract}
              className={`grid grid-cols-[2rem_minmax(7rem,1fr)_5rem_5rem_5rem_6rem_6rem_6rem] gap-2 items-start px-3 py-2.5 rounded-md border ${liqSeverityBorderClass(c.severity)}`}
            >
              <div>{liqSeverityIcon(c.severity)}</div>
              <div>
                <div className="text-xs font-semibold font-mono">{c.contract}</div>
                {c.exchange && <div className="text-[10px] text-muted-foreground">{c.exchange}</div>}
                {c.accounts && c.accounts.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-0.5">
                    {c.accounts.map((a) => (
                      <span
                        key={a.account}
                        className="inline-flex items-center gap-0.5 text-[9px] font-mono bg-muted/70 px-1 py-0 rounded border border-border/50 leading-4"
                      >
                        <span className="font-medium">{a.account}</span>
                        <span className="text-muted-foreground">
                          {a.longLots > 0 && a.shortLots > 0
                            ? `多${a.longLots}/空${a.shortLots}`
                            : `${a.netLots}手`}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-right text-xs tabular-nums">
                <div>{fmtLots(c.netLots)}</div>
                <div className="text-[10px] text-muted-foreground">
                  {c.longLots > 0 && `多${c.longLots}`}{c.longLots > 0 && c.shortLots > 0 && "/"}{c.shortLots > 0 && `空${c.shortLots}`}
                </div>
              </div>
              <div className={`text-right text-xs tabular-nums ${c.volume !== null && c.volume < 1000 ? "text-yellow-600 dark:text-yellow-400 font-medium" : ""}`}>
                {c.volume !== null ? c.volume.toLocaleString("zh-CN") : <span className="text-muted-foreground/50 text-[10px]">无数据</span>}
              </div>
              <div className="text-right text-xs tabular-nums text-muted-foreground">
                {c.openInterest !== null ? c.openInterest.toLocaleString("zh-CN") : <span className="text-[10px]">—</span>}
              </div>
              <div className={`text-right text-xs tabular-nums font-medium ${
                c.participationRate !== null && c.participationRate >= 15 ? "text-red-500" :
                c.participationRate !== null && c.participationRate >= 5  ? "text-yellow-600 dark:text-yellow-400" :
                "text-muted-foreground"
              }`}>
                {fmtRate(c.participationRate)}
              </div>
              <div className={`text-right text-xs tabular-nums font-medium ${
                c.oiConcentration !== null && c.oiConcentration >= 8 ? "text-red-500" :
                c.oiConcentration !== null && c.oiConcentration >= 3 ? "text-yellow-600 dark:text-yellow-400" :
                "text-muted-foreground"
              }`}>
                {fmtRate(c.oiConcentration)}
              </div>
              <div className="text-right text-xs tabular-nums text-muted-foreground">
                {c.margin > 0 ? (c.margin / 10000).toLocaleString("zh-CN", { maximumFractionDigits: 0 }) : "—"}
              </div>
            </div>
          ))}

          {/* Warning details for at-risk contracts */}
          {atRisk.map((c) => c.warnings.length > 0 && (
            <div key={`warn-${c.contract}`} className="px-3 py-2 rounded-md bg-muted/40 space-y-0.5">
              <p className="text-[10px] font-semibold text-muted-foreground">{c.contract} 预警详情</p>
              {c.warnings.map((w, i) => (
                <p key={i} className="text-xs text-muted-foreground flex items-start gap-1">
                  <span className="shrink-0 mt-0.5">⚠</span>{w}
                </p>
              ))}
            </div>
          ))}

          {/* Toggle show all */}
          {!showAll && (data?.contracts.length ?? 0) > atRisk.length && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full text-xs text-primary hover:underline py-1"
            >
              显示全部 {data!.contracts.length} 个持仓合约
            </button>
          )}
          {showAll && (
            <button
              onClick={() => setShowAll(false)}
              className="w-full text-xs text-primary hover:underline py-1"
            >
              仅显示异常合约
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function RiskReportNewPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview")
  const activeItem = subNavItems.find((i) => i.key === activeTab)!

  const handleTabChange = (key: TabKey) => {
    setActiveTab(key)
  }

  return (
    <div className="flex -mx-6 -mb-6" style={{ height: "calc(100% + 1.5rem)" }}>
      {/* Secondary sidebar */}
      <aside className="w-44 shrink-0 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">MOM 风控报告</p>
          <p className="text-[11px] text-muted-foreground/60 mt-0.5">新版</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {subNavItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                onClick={() => handleTabChange(item.key)}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                  activeTab === item.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.name}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Content area */}
      <div id={activeTab === "position" ? "pos-main-scroll" : undefined} className="flex-1 overflow-y-auto px-6 pb-6">
        {activeTab === "position" && (
          <div className="sticky top-0 z-10 -mx-6 flex items-center gap-2 border-b border-border bg-background px-6 py-2">
            <span className="text-xs text-muted-foreground">快捷导航：</span>
            <button
              onClick={() => document.getElementById("section-pos-timeseries")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >时序持仓 ↓</button>
            <button
              onClick={() => document.getElementById("section-pos-cross")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >截面持仓 ↓</button>
            <button
              onClick={() => document.getElementById("section-pos-change-area")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >持仓变化 ↓</button>
            <button
              onClick={() => document.getElementById("section-today-position")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >今日持仓 ↓</button>
            <button
              onClick={() => document.getElementById("section-yesterday-position")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >昨日持仓 ↓</button>
            <button
              onClick={() => document.getElementById("section-top")?.scrollIntoView({ behavior: "smooth" })}
              className="ml-auto rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >↑ 回到顶部</button>
          </div>
        )}
        {activeTab === "intraday" && (
          <div className="sticky top-0 z-10 -mx-6 flex items-center gap-2 border-b border-border bg-background px-6 py-2">
            <span className="text-xs text-muted-foreground">快捷导航：</span>
            <button
              onClick={() => document.getElementById("section-intraday-pnl")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >当日盈亏 ↓</button>
            <button
              onClick={() => document.getElementById("section-intraday-var")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >次日预测 ↓</button>
            <button
              onClick={() => document.getElementById("section-intraday-sandbox")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >VaR沙盒 ↓</button>
            <button
              onClick={() => document.getElementById("section-intraday-margin")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >风险水平 ↓</button>
            <button
              onClick={() => document.getElementById("section-top")?.scrollIntoView({ behavior: "smooth" })}
              className="ml-auto rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >↑ 回到顶部</button>
          </div>
        )}
        {activeTab === "overview" && (
          <div className="sticky top-0 z-10 -mx-6 flex items-center gap-2 border-b border-border bg-background px-6 py-2">
            <span className="text-xs text-muted-foreground">快捷导航：</span>
            <button
              onClick={() => document.getElementById("section-product")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              产品要素 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-performance")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              业绩指标 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-volatility")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              波动分析 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-pnl")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              分类盈亏 ↓
            </button>
            <button
              onClick={() => document.getElementById("section-top")?.scrollIntoView({ behavior: "smooth" })}
              className="ml-auto rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              ↑ 回到顶部
            </button>
          </div>
        )}
        {activeTab === "advisor" && (
          <div className="sticky top-0 z-10 -mx-6 flex items-center gap-2 border-b border-border bg-background px-6 py-2">
            <span className="text-xs text-muted-foreground">快捷导航：</span>
            <button
              onClick={() => document.getElementById("section-advisor-daily")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >当日分析 ↓</button>
            <button
              onClick={() => document.getElementById("section-advisor-history")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >历史回溯 ↓</button>
            <button
              onClick={() => document.getElementById("section-advisor-optimize")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >投顾优化 ↓</button>
            <button
              onClick={() => document.getElementById("section-top")?.scrollIntoView({ behavior: "smooth" })}
              className="ml-auto rounded border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >↑ 回到顶部</button>
          </div>
        )}

        <h1 id="section-top" className="text-2xl font-semibold tracking-tight pt-6 mb-4">{activeItem.name}</h1>
        {activeTab === "overview" && <OverviewContent />}
        {activeTab === "intraday" && <IntradayContent />}
        {activeTab === "position" && <PositionContent />}
        {activeTab === "advisor" && <AdvisorContent />}
        {activeTab === "anomaly" && <AnomalyContent />}
      </div>
    </div>
  )
}
