"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Download } from "lucide-react"

export type ReturnCurvePoint = {
  date: string
  nav: number
  returnPct: number
}

export type ReturnCurveSeries = {
  fundName: string
  displayName: string
  beianHao: string | null
  valuationCode: string | null
  points: ReturnCurvePoint[]
}

type Props = {
  series: ReturnCurveSeries[]
  displayName: string
  fromDate?: string
  toDate?: string
  benchmark?: string
  loading?: boolean
}

const BENCHMARK_COLOR = "#14b8a6"

function benchmarkKeyFromFilter(label: string | undefined): string | null {
  if (!label || label === "无") return null
  if (label.includes("沪深300")) return "IF"
  if (label.includes("中证500")) return "IC"
  if (label.includes("中证1000")) return "IM"
  if (label.includes("上证50")) return "IH"
  if (label.includes("南华商品")) return "NHCI.NH"
  if (label.includes("国债")) return "511010.SH"
  if (label.includes("黄金")) return "518880.SH"
  return null
}

function buildAlignedBenchmarkReturns(
  dates: string[],
  benchData: Array<{ date: string; value: number }>,
): (number | null)[] {
  if (!benchData.length || !dates.length) return dates.map(() => null)

  const firstDate = dates[0]
  let baseVal: number | null = null
  for (const row of benchData) {
    if (row.date <= firstDate) baseVal = row.value
    else break
  }
  if (baseVal == null || baseVal <= 0) {
    const first = benchData.find((r) => r.date >= firstDate)
    baseVal = first?.value ?? null
  }
  if (baseVal == null || baseVal <= 0) return dates.map(() => null)

  let benchIdx = 0
  let lastVal = baseVal
  return dates.map((date) => {
    while (benchIdx < benchData.length && benchData[benchIdx].date <= date) {
      lastVal = benchData[benchIdx].value
      benchIdx += 1
    }
    if (lastVal <= 0) return null
    return +(((lastVal / baseVal) - 1) * 100).toFixed(4)
  })
}

const SERIES_COLORS = [
  "#ef4444",
  "#3b82f6",
  "#f97316",
  "#14b8a6",
  "#8b5cf6",
  "#eab308",
  "#ec4899",
  "#64748b",
]

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`
}

function sliceAndRebaseSeries(
  points: ReturnCurvePoint[],
  fromDate?: string,
  toDate?: string,
): ReturnCurvePoint[] {
  let sliced = points
  if (fromDate) sliced = sliced.filter((p) => p.date >= fromDate.slice(0, 10))
  if (toDate) sliced = sliced.filter((p) => p.date <= toDate.slice(0, 10))
  if (sliced.length < 2) return []
  const baseNav = sliced[0].nav
  if (!Number.isFinite(baseNav) || baseNav <= 0) return []
  return sliced.map((p) => ({
    ...p,
    returnPct: (p.nav / baseNav - 1) * 100,
  }))
}

export function FofReturnCurvePanel({ series, displayName, fromDate, toDate, benchmark, loading }: Props) {
  const [selectAll, setSelectAll] = useState(true)
  const [showNodes, setShowNodes] = useState(true)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [benchMeta, setBenchMeta] = useState<{ label: string; data: Array<{ date: string; value: number }> } | null>(null)

  const benchLegendName = benchMeta ? `${benchMeta.label}(基准)` : null

  useEffect(() => {
    const key = benchmarkKeyFromFilter(benchmark)
    if (!key || !fromDate || !toDate) {
      setBenchMeta(null)
      return
    }
    const controller = new AbortController()
    fetch(
      `/ma/api/private-funds/benchmark?key=${encodeURIComponent(key)}&from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`,
      { signal: controller.signal },
    )
      .then((r) => r.json())
      .then((json: { ok?: boolean; label?: string; data?: Array<{ date: string; value: number }> }) => {
        if (!json.ok || !json.label || !Array.isArray(json.data) || json.data.length < 2) {
          setBenchMeta(null)
          return
        }
        setBenchMeta({ label: json.label, data: json.data })
      })
      .catch(() => {
        if (!controller.signal.aborted) setBenchMeta(null)
      })
    return () => controller.abort()
  }, [benchmark, fromDate, toDate])

  const prepared = useMemo(() => {
    return series
      .map((s) => ({
        ...s,
        points: sliceAndRebaseSeries(s.points, fromDate, toDate),
      }))
      .filter((s) => s.points.length >= 2)
  }, [series, fromDate, toDate])

  const activeSeries = useMemo(() => {
    return prepared.filter((s) => !hidden.has(s.displayName))
  }, [prepared, hidden])

  const dates = useMemo(() => {
    const set = new Set<string>()
    for (const s of prepared) {
      for (const p of s.points) set.add(p.date)
    }
    return [...set].sort()
  }, [prepared])

  const legendNames = useMemo(() => {
    const names = prepared.map((s) => s.displayName)
    if (benchLegendName) names.push(benchLegendName)
    return names
  }, [prepared, benchLegendName])

  const benchSeriesData = useMemo(() => {
    if (!benchMeta || dates.length < 2) return []
    return buildAlignedBenchmarkReturns(dates, benchMeta.data)
  }, [benchMeta, dates])

  const showBenchmark = benchLegendName != null
    && !hidden.has(benchLegendName)
    && benchSeriesData.some((v) => v != null)

  const option = useMemo(() => {
    const hasFundSeries = activeSeries.length > 0
    if ((!hasFundSeries && !showBenchmark) || dates.length < 2) return {}
    const byDate = (points: ReturnCurvePoint[]) => {
      const map = new Map(points.map((p) => [p.date, p.returnPct]))
      return dates.map((d) => (map.has(d) ? map.get(d)! : null))
    }

    const chartSeries = activeSeries.map((s) => ({
      type: "line" as const,
      name: s.displayName,
      data: byDate(s.points),
      smooth: true,
      showSymbol: showNodes,
      symbolSize: 5,
      connectNulls: true,
      lineStyle: { width: 2 },
    }))

    if (showBenchmark && benchLegendName) {
      chartSeries.push({
        type: "line" as const,
        name: benchLegendName,
        data: benchSeriesData,
        smooth: true,
        showSymbol: showNodes,
        symbolSize: 5,
        connectNulls: true,
        lineStyle: { width: 2, type: "dashed" as const, color: BENCHMARK_COLOR },
        itemStyle: { color: BENCHMARK_COLOR },
      })
    }

    return {
      color: SERIES_COLORS,
      grid: { left: 56, right: 24, top: 48, bottom: 48 },
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ seriesName: string; data: number | null; axisValue: string }>) => {
          if (!params?.length) return ""
          const lines = [`${params[0].axisValue}`]
          for (const p of params) {
            if (p.data == null) continue
            lines.push(`${p.seriesName}：${fmtPct(p.data)}`)
          }
          return lines.join("<br/>")
        },
      },
      legend: {
        type: "scroll",
        top: 4,
        left: 0,
        right: 0,
        itemWidth: 14,
        itemHeight: 8,
        textStyle: { fontSize: 11, color: "#52525b" },
        data: legendNames,
        selected: Object.fromEntries(
          legendNames.map((name) => [name, !hidden.has(name)]),
        ),
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { fontSize: 11, color: "#71717a" },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
      },
      yAxis: {
        type: "value",
        name: "收益率(%)",
        nameTextStyle: { fontSize: 11, color: "#71717a" },
        axisLabel: {
          fontSize: 11,
          color: "#71717a",
          formatter: (v: number) => `${v.toFixed(1)}%`,
        },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: chartSeries,
    }
  }, [activeSeries, benchLegendName, benchSeriesData, dates, hidden, legendNames, showBenchmark, showNodes])

  function handleLegendSelect(changed: Record<string, boolean>) {
    const next = new Set(hidden)
    for (const [name, visible] of Object.entries(changed)) {
      if (!visible) next.add(name)
      else next.delete(name)
    }
    setHidden(next)
    setSelectAll(next.size === 0)
  }

  function handleExport() {
    if (!prepared.length && !showBenchmark) return
    const headers = ["日期", ...prepared.map((s) => s.displayName)]
    if (benchLegendName) headers.push(benchLegendName)
    const lines = [headers.join(",")]
    for (const date of dates) {
      const cols = [date, ...prepared.map((s) => {
        const p = s.points.find((pt) => pt.date === date)
        return p != null ? p.returnPct.toFixed(4) : ""
      })]
      if (benchLegendName) {
        const idx = dates.indexOf(date)
        const v = benchSeriesData[idx]
        cols.push(v != null ? v.toFixed(4) : "")
      }
      lines.push(cols.join(","))
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_FOF底层收益曲线_${fromDate ?? dates[0] ?? "export"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const rangeLabel = fromDate && toDate ? `${fromDate} ~ ${toDate}` : null

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <div className="text-red-500 font-semibold text-sm">收益曲线</div>
          {rangeLabel && (
            <div className="text-xs text-zinc-400 mt-1 tabular-nums">统计区间: {rangeLabel}</div>
          )}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={prepared.length === 0 && !showBenchmark}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          导出
        </button>
      </div>

      {prepared.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 px-4 pb-2 text-xs text-zinc-600">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              className="rounded h-3 w-3"
              checked={selectAll && hidden.size === 0}
              onChange={(e) => {
                const checked = e.target.checked
                setSelectAll(checked)
                if (checked) {
                  setHidden(new Set())
                } else {
                  const all = prepared.map((s) => s.displayName)
                  if (benchLegendName) all.push(benchLegendName)
                  setHidden(new Set(all))
                }
              }}
            />
            全选
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              className="rounded h-3 w-3"
              checked={showNodes}
              onChange={(e) => setShowNodes(e.target.checked)}
            />
            节点
          </label>
          <span className="text-zinc-400">复权单位净值</span>
        </div>
      )}

      <div className="px-2 pb-4">
        {prepared.length >= 1 && dates.length >= 2 ? (
          <ReactECharts
            option={option}
            style={{ height: 320 }}
            notMerge
            onEvents={{
              legendselectchanged: (e: { selected: Record<string, boolean> }) => {
                handleLegendSelect(e.selected)
              },
            }}
          />
        ) : (
          <div className="h-[320px] flex items-center justify-center text-sm text-zinc-400">
            {loading
              ? "加载收益曲线…"
              : series.length === 0
                ? "暂无底层基金净值数据"
                : "暂无足够净值数据生成收益曲线"}
          </div>
        )}
      </div>
    </div>
  )
}
