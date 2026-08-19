"use client"

import { useCallback, useEffect, useState } from "react"
import ReactECharts from "echarts-for-react"
import { FileDown, RefreshCw } from "lucide-react"
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
const COMPARE_COLOR = "#8b5cf6"
const BENCHMARK_COLOR = "#f97316"
const INITIAL_CAPITAL = 10_000_000 // 1000万

type DisplayMode = "return" | "pnl"

const BENCHMARK_OPTIONS = [
  { code: "none",     name: "无基准" },
  { code: "NHCI.NH",  name: "南华商品指数" },
  { code: "NHAI.NH",  name: "南华农产品指数" },
  { code: "NHECI.NH", name: "南华能化指数" },
  { code: "NHFI.NH",  name: "南华黑色指数" },
  { code: "NHPMI.NH", name: "南华贵金属指数" },
  { code: "NHNEI.NH", name: "南华新能源指数" },
  { code: "NHNFI.NH", name: "南华有色金属指数" },
]

function fmtNum(v: number): string {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
}
function fmtReturn(v: number): string {
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%"
}

function fmtDateLabel(v: string | number): string {
  const d = new Date(v)
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  return String(v)
}

/** 20-day rolling annualised volatility (%) from cumPnl series */
function computeVolatility(data: EquityPoint[], win = 20): Array<[string, number]> {
  const result: Array<[string, number]> = []
  for (let i = win; i < data.length; i++) {
    const slice = data.slice(i - win, i + 1)
    const rets = slice.slice(1).map((pt, j) => (pt.cumPnl - slice[j].cumPnl) / INITIAL_CAPITAL)
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)
    result.push([data[i].date, Math.sqrt(variance * 252) * 100])
  }
  return result
}

/** Drawdown (%) relative to INITIAL_CAPITAL + running peak cumPnl */
function computeDrawdown(data: EquityPoint[]): Array<[string, number]> {
  let peak = INITIAL_CAPITAL
  return data.map(pt => {
    const val = INITIAL_CAPITAL + pt.cumPnl
    if (val > peak) peak = val
    return [pt.date, ((val - peak) / peak) * 100] as [string, number]
  })
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
  const [accountSearch, setAccountSearch] = useState("")
  const [compareAccount, setCompareAccount] = useState("")
  const [compareSearch, setCompareSearch] = useState("")
  const [mode, setMode] = useState<DisplayMode>("return")
  const [selectedBenchmark, setSelectedBenchmark] = useState("NHCI.NH")
  const [benchmarkData, setBenchmarkData] = useState<Array<{ date: string; close: number }>>([])  
  const [loadingBenchmark, setLoadingBenchmark] = useState(false)
  const [profiling, setProfiling] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

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

  const loadBenchmark = useCallback(async (code: string, f: string, t: string) => {
    if (code === "none") { setBenchmarkData([]); return }
    setLoadingBenchmark(true)
    try {
      const params = new URLSearchParams({ from: f, to: t, codes: code })
      const res = await fetch(`/ma/api/mom-analysis/benchmark?${params}`)
      const json = await res.json()
      if (!res.ok || !json.ok) { setBenchmarkData([]); return }
      const s = json.series?.[0]
      setBenchmarkData(s?.data ?? [])
    } catch {
      setBenchmarkData([])
    } finally {
      setLoadingBenchmark(false)
    }
  }, [])

  useEffect(() => {
    if (mode === "return") loadBenchmark(selectedBenchmark, from, to)
    else setBenchmarkData([])
  }, [selectedBenchmark, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const sortedAccounts = [...allSeries].sort((a, b) => a.account.localeCompare(b.account))

  const selectAccountBySearch = () => {
    const q = accountSearch.trim().toLowerCase()
    if (!q) return
    if (q === "全部") {
      setSelectedAccount("全部")
      return
    }
    const exact = sortedAccounts.find(s => s.account.toLowerCase() === q)
    if (exact) {
      setSelectedAccount(exact.account)
      return
    }
    const partial = sortedAccounts.find(s => s.account.toLowerCase().includes(q))
    if (partial) setSelectedAccount(partial.account)
  }

  const selectCompareBySearch = () => {
    const q = compareSearch.trim().toLowerCase()
    if (!q) {
      setCompareAccount("")
      return
    }
    const exact = sortedAccounts.find(s => s.account.toLowerCase() === q)
    if (exact) {
      setCompareAccount(exact.account)
      return
    }
    const partial = sortedAccounts.find(s => s.account.toLowerCase().includes(q))
    if (partial) setCompareAccount(partial.account)
  }

  const downloadProfile = async () => {
    if (!selectedAccount || selectedAccount === "全部") {
      setProfileError("请先选择一个账户")
      return
    }
    setProfiling(true)
    setProfileError(null)
    try {
      const params = new URLSearchParams({ account: selectedAccount })
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      const res = await fetch(`/ma/api/mom-analysis/trader-profile?${params}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({} as { error?: string; detail?: string }))
        throw new Error(json.error || json.detail || `生成失败（${res.status}）`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${selectedAccount.toUpperCase()}_盘手侧写.docx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "侧写报告生成失败")
    } finally {
      setProfiling(false)
    }
  }

  const showAll = selectedAccount === "全部"
  const primarySeries = allSeries.find(s => s.account === selectedAccount)
  const compareSeries = allSeries.find(s => s.account === compareAccount)
  const visibleSeries = showAll
    ? allSeries
    : [
        ...(primarySeries ? [primarySeries] : []),
        ...(compareSeries && compareSeries.account !== selectedAccount ? [compareSeries] : []),
      ]

  const toDisplayValue = (cumPnl: number) =>
    mode === "return" ? (cumPnl / INITIAL_CAPITAL) * 100 : cumPnl

  // Determine the first date of the visible account curve so the benchmark starts there
  const accountStartDate: string | null = (() => {
    if (showAll) {
      // Start at the earliest date across all visible series
      let earliest: string | null = null
      for (const s of visibleSeries) {
        if (s.data.length > 0) {
          const d = s.data[0].date
          if (earliest === null || d < earliest) earliest = d
        }
      }
      return earliest
    }
    const s = visibleSeries[0]
    return s?.data?.[0]?.date ?? null
  })()

  // Benchmark: rebase to 0 at the first benchmark point >= accountStartDate
  const trimmedBenchmarkData = mode === "return" && selectedBenchmark !== "none"
    ? (accountStartDate ? benchmarkData.filter(pt => pt.date >= accountStartDate) : benchmarkData)
    : []

  const benchmarkReturnSeries: Array<[string, number]> = []
  if (trimmedBenchmarkData.length > 0) {
    const base = trimmedBenchmarkData[0].close
    for (const pt of trimmedBenchmarkData) {
        benchmarkReturnSeries.push([pt.date, ((pt.close - base) / base) * 100])
    }
  }

  const benchmarkDrawdownSeries: Array<[string, number]> = []
  if (trimmedBenchmarkData.length > 0) {
    let peak = trimmedBenchmarkData[0].close
    for (const pt of trimmedBenchmarkData) {
      if (pt.close > peak) peak = pt.close
      benchmarkDrawdownSeries.push([pt.date, ((pt.close - peak) / peak) * 100])
    }
  }
  const benchmarkName = BENCHMARK_OPTIONS.find(b => b.code === selectedBenchmark)?.name ?? selectedBenchmark
  const showLegend = showAll || benchmarkReturnSeries.length > 0

  // Right-side charts — computed from visible series
  const smallChartHeight = 220

  const volSeries = visibleSeries.map((s, i) => ({
    name: s.account,
    type: "line" as const,
    smooth: false,
    symbol: "none",
    lineStyle: {
      width: showAll ? 1.5 : 1.8,
      color: showAll
        ? LINE_COLORS[i % LINE_COLORS.length]
        : (s.account === compareAccount ? COMPARE_COLOR : LINE_COLOR),
    },
    itemStyle: {
      color: showAll
        ? LINE_COLORS[i % LINE_COLORS.length]
        : (s.account === compareAccount ? COMPARE_COLOR : LINE_COLOR),
    },
    data: computeVolatility(s.data),
  }))

  const ddSeries = visibleSeries.map((s, i) => ({
    name: s.account,
    type: "line" as const,
    smooth: false,
    symbol: "none",
    lineStyle: {
      width: showAll ? 1.5 : 1.8,
      color: showAll
        ? LINE_COLORS[i % LINE_COLORS.length]
        : (s.account === compareAccount ? COMPARE_COLOR : "#ef4444"),
    },
    itemStyle: {
      color: showAll
        ? LINE_COLORS[i % LINE_COLORS.length]
        : (s.account === compareAccount ? COMPARE_COLOR : "#ef4444"),
    },
    ...(showAll || s.account === compareAccount ? {} : { areaStyle: { color: "#ef4444", opacity: 0.1 } }),
    data: computeDrawdown(s.data),
  }))

  const ddSeriesWithBenchmark = benchmarkDrawdownSeries.length > 0
    ? [
        ...ddSeries,
        {
          name: benchmarkName,
          type: "line" as const,
          smooth: false,
          symbol: "none",
          lineStyle: { width: 1.5, color: BENCHMARK_COLOR, type: "dashed" as const },
          itemStyle: { color: BENCHMARK_COLOR },
          data: benchmarkDrawdownSeries,
        },
      ]
    : ddSeries

  const smallGrid = { top: 8, right: 10, bottom: 32, left: 52 }
  const smallDataZoom = [{ type: "inside" as const, start: 0, end: 100 }]

  const volOption = volSeries.some(s => s.data.length > 0) ? {
    animation: false,
    grid: smallGrid,
    tooltip: {
      trigger: "axis" as const,
      formatter: (params: Array<{ axisValue: string | number; seriesName: string; value: [string | number, number]; color: string }>) => {
        if (!params.length) return ""
        const date = fmtDateLabel(params[0].value?.[0] ?? params[0].axisValue)
        const uniq = new Map<string, { seriesName: string; value: [string | number, number]; color: string }>()
        for (const p of params) {
          const key = `${p.seriesName}__${fmtDateLabel(p.value?.[0] ?? p.axisValue)}`
          if (!uniq.has(key)) uniq.set(key, p)
        }
        return date + "<br/>" + Array.from(uniq.values()).map(p =>
          `<span style="display:inline-block;margin-right:4px;border-radius:2px;width:8px;height:8px;background:${p.color}"></span>${p.seriesName.toUpperCase()}: <b>${(p.value?.[1] ?? 0).toFixed(1)}%</b>`
        ).join("<br/>")
      },
    },
    xAxis: { type: "time" as const, axisLabel: { fontSize: 9, formatter: (v: string | number) => fmtDateLabel(v) }, splitLine: { show: false } },
    yAxis: { type: "value" as const, axisLabel: { fontSize: 9, formatter: (v: number) => v.toFixed(0) + "%" }, splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.4 } } },
    dataZoom: smallDataZoom,
    series: volSeries,
  } : null

  const ddOption = ddSeriesWithBenchmark.some(s => s.data.length > 0) ? {
    animation: false,
    grid: smallGrid,
    tooltip: {
      trigger: "axis" as const,
      formatter: (params: Array<{ axisValue: string | number; seriesName: string; value: [string | number, number]; color: string }>) => {
        if (!params.length) return ""
        const date = fmtDateLabel(params[0].value?.[0] ?? params[0].axisValue)
        const uniq = new Map<string, { seriesName: string; value: [string | number, number]; color: string }>()
        for (const p of params) {
          const key = `${p.seriesName}__${fmtDateLabel(p.value?.[0] ?? p.axisValue)}`
          if (!uniq.has(key)) uniq.set(key, p)
        }
        return date + "<br/>" + Array.from(uniq.values()).map(p =>
          `<span style="display:inline-block;margin-right:4px;border-radius:2px;width:8px;height:8px;background:${p.color}"></span>${p.seriesName.toUpperCase()}: <b>${(p.value?.[1] ?? 0).toFixed(2)}%</b>`
        ).join("<br/>")
      },
    },
    xAxis: { type: "time" as const, axisLabel: { fontSize: 9, formatter: (v: string | number) => fmtDateLabel(v) }, splitLine: { show: false } },
    yAxis: { type: "value" as const, max: 0, axisLabel: { fontSize: 9, formatter: (v: number) => v.toFixed(0) + "%" }, splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.4 } } },
    dataZoom: smallDataZoom,
    series: ddSeriesWithBenchmark,
  } : null

  const option = visibleSeries.length > 0 ? {
    animation: false,
    grid: { top: 16, right: 24, bottom: showAll ? 56 : 56, left: 80 },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ axisValue: string | number; seriesName: string; value: [string | number, number]; color: string }>) => {
        if (!params.length) return ""
        const date = fmtDateLabel(params[0].value?.[0] ?? params[0].axisValue)
        const uniq = new Map<string, { seriesName: string; value: [string | number, number]; color: string }>()
        for (const p of params) {
          const key = `${p.seriesName}__${fmtDateLabel(p.value?.[0] ?? p.axisValue)}`
          if (!uniq.has(key)) uniq.set(key, p)
        }
        const lines = Array.from(uniq.values())
          .sort((a, b) => (b.value?.[1] ?? 0) - (a.value?.[1] ?? 0))
          .map(p => {
            const val = p.value?.[1] ?? 0
            const formatted = mode === "return" ? fmtReturn(val) : (val >= 0 ? "+" : "") + fmtNum(val)
            return `<span style="display:inline-block;margin-right:5px;border-radius:2px;width:10px;height:10px;background:${p.color}"></span>${p.seriesName.toUpperCase()}: <b>${formatted}</b>`
          })
        return `${date}<br/>${lines.join("<br/>")}`
      },
    },
    xAxis: { type: "time", axisLabel: { fontSize: 11, formatter: (v: string | number) => fmtDateLabel(v) }, splitLine: { show: false } },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: 11,
        formatter: mode === "return"
          ? (v: number) => v.toFixed(1) + "%"
          : (v: number) => Math.abs(v) >= 10000 ? (v / 10000).toFixed(0) + "万" : v.toString(),
      },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.4 } },
    },
    legend: showLegend ? { type: "scroll" as const, bottom: 4, textStyle: { fontSize: 10 } } : undefined,
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      { type: "slider", bottom: showLegend ? 28 : 28, height: 18, start: 0, end: 100 },
    ],
    series: [
      ...visibleSeries.map((s, i) => ({
        name: s.account,
        type: "line",
        smooth: false,
        symbol: "none",
        lineStyle: {
          width: showAll ? 1.5 : 2,
          color: showAll
            ? LINE_COLORS[i % LINE_COLORS.length]
            : (s.account === compareAccount ? COMPARE_COLOR : LINE_COLOR),
        },
        itemStyle: {
          color: showAll
            ? LINE_COLORS[i % LINE_COLORS.length]
            : (s.account === compareAccount ? COMPARE_COLOR : LINE_COLOR),
        },
        ...(showAll || s.account === compareAccount ? {} : { areaStyle: { color: LINE_COLOR, opacity: 0.08 } }),
        data: s.data.map(d => [d.date, toDisplayValue(d.cumPnl)]),
      })),
      ...(benchmarkReturnSeries.length > 0 ? [{
        name: benchmarkName,
        type: "line",
        smooth: false,
        symbol: "none",
        lineStyle: { width: 1.5, color: BENCHMARK_COLOR, type: "dashed" as const },
        itemStyle: { color: BENCHMARK_COLOR },
        data: benchmarkReturnSeries,
      }] : []),
    ],
  } : null

  return (
    <div className="flex gap-3 items-stretch">
    {/* Left: main equity curve */}
    <div className="w-1/2 min-w-0 flex flex-col">
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex flex-col gap-1.5">
          {/* Row 1: title + mode toggle + account selector + quick ranges + dates + refresh */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium">
              盘手{mode === "return" ? "收益率" : "盈亏"}曲线（{showAll ? "全部" : selectedAccount.toUpperCase()}）
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Mode toggle */}
              <div className="flex rounded border border-input overflow-hidden text-xs">
                <button
                  onClick={() => setMode("return")}
                  className={`px-2 py-0.5 transition-colors ${
                    mode === "return" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  收益率
                </button>
                <button
                  onClick={() => setMode("pnl")}
                  className={`px-2 py-0.5 transition-colors ${
                    mode === "pnl" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  盈亏
                </button>
              </div>
              {/* Account selector */}
              <select
                value={selectedAccount}
                onChange={e => setSelectedAccount(e.target.value)}
                className="rounded border border-input bg-background px-2 py-0.5 text-xs w-24"
              >
                <option value="全部">全部</option>
                {sortedAccounts.map(s => (
                  <option key={s.account} value={s.account}>{s.account.toUpperCase()}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={downloadProfile}
                disabled={profiling || selectedAccount === "全部"}
                title={selectedAccount === "全部" ? "请先选择单个账户" : "下载当前账户的盘手侧写 Word 报告"}
                className="inline-flex items-center gap-1 rounded border border-input bg-background px-2 py-0.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
              >
                <FileDown className={`h-3.5 w-3.5 ${profiling ? "animate-pulse" : ""}`} />
                {profiling ? "生成中…" : "盘手侧写"}
              </button>
              {/* Quick ranges */}
              {QUICK_RANGES.map(r => {
                const isActive = from === r.from() && to === r.to()
                return (
                  <button
                    key={r.label}
                    onClick={() => { const f = r.from(); const t = r.to(); setFrom(f); setTo(t); load(f, t); if (mode === "return") loadBenchmark(selectedBenchmark, f, t) }}
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
              <button onClick={() => { load(from, to); if (mode === "return") loadBenchmark(selectedBenchmark, from, to) }}
                className="rounded border border-input bg-background p-0.5 hover:bg-muted transition-colors">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          {/* Row 2: account search + compare account + benchmark selector (return mode only) */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">搜索账户</span>
            <input
              type="text"
              value={accountSearch}
              onChange={e => setAccountSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  selectAccountBySearch()
                }
              }}
              placeholder="输入账户名后回车"
              className="rounded border border-input bg-background px-2 py-0.5 text-xs w-36"
            />
            <span className="text-xs text-muted-foreground ml-2">对比账户</span>
            <input
              type="text"
              value={compareSearch}
              onChange={e => {
                const v = e.target.value
                setCompareSearch(v)
                if (!v.trim()) setCompareAccount("")
              }}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  selectCompareBySearch()
                }
              }}
              placeholder="输入对比账户后回车"
              className="rounded border border-input bg-background px-2 py-0.5 text-xs w-40"
            />
            {mode === "return" && (
              <>
                <span className="text-xs text-muted-foreground ml-2">基准对比</span>
                <select
                  value={selectedBenchmark}
                  onChange={e => setSelectedBenchmark(e.target.value)}
                  className={`rounded border border-input bg-background px-2 py-0.5 text-xs w-40 ${
                    loadingBenchmark ? "opacity-60" : ""
                  }`}
                >
                  {BENCHMARK_OPTIONS.map(b => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>
          {profileError && (
            <div className="text-xs text-destructive">{profileError}</div>
          )}
          {profiling && !profileError && (
            <div className="text-xs text-muted-foreground">正在生成侧写报告，大约需要 20–40 秒…</div>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex-1 min-h-0">
        {loading && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
        )}
        {!loading && error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {!loading && !error && !option && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            所选日期范围内无数据。
          </div>
        )}
        {!loading && !error && option && (
          <ReactECharts option={option} style={{ height: "100%" }} notMerge />
        )}
      </CardContent>
    </Card>
    </div>

    {/* Right: volatility + drawdown stacked */}
    {visibleSeries.length > 0 && (
      <div className="w-1/2 flex flex-col gap-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">滚动波动率（20日年化）</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {volOption
              ? <ReactECharts option={volOption} style={{ height: smallChartHeight }} notMerge />
              : <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height: smallChartHeight }}>数据不足</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">最大回撤曲线</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-2">
            {ddOption
              ? <ReactECharts option={ddOption} style={{ height: smallChartHeight }} notMerge />
              : <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height: smallChartHeight }}>数据不足</div>}
          </CardContent>
        </Card>
      </div>
    )}
    </div>
  )
}
