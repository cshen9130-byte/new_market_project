"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Menu } from "lucide-react"
import { FuturesStyleCalcHelp } from "./FuturesStyleCalcHelp"

const SECTOR_TABS = [
  { key: "all", label: "全部" },
  { key: "commodity", label: "商品" },
  { key: "black", label: "黑色" },
  { key: "nonferrous", label: "有色" },
  { key: "energy", label: "能化" },
  { key: "agri", label: "农产" },
] as const

type SectorKey = (typeof SECTOR_TABS)[number]["key"]

const INTERVAL_PERIOD_COLUMNS = [
  "近一周收益",
  "近一月收益",
  "近三月收益",
  "近六月收益",
  "近一年收益",
  "今年以来收益",
] as const

type ApiPayload = {
  ok: true
  from: string
  to: string
  sector: SectorKey
  auto?: boolean
  minDate?: string | null
  maxDate?: string | null
  dates: string[]
  source: { prices: string; oiCarry: string; note: string }
  cards: Array<{ key: string; name: string; value: number; sector: string }>
  daily: Array<{ key: string; name: string; color: string; data: number[] }>
  cumulative: Array<{ key: string; name: string; color: string; data: number[] }>
  interval: Array<{ key: string; name: string; sector: string; returns: number[] }>
}

type ApiError = { ok: false; error?: string }

function returnColorClass(value: number): string {
  if (value > 0) return "text-red-500"
  if (value < 0) return "text-green-600"
  return "text-zinc-500"
}

function cardBgClass(value: number): string {
  if (value > 0) return "bg-red-50/70 border-red-100"
  if (value < 0) return "bg-green-50/70 border-green-100"
  return "bg-zinc-50/50 border-zinc-100"
}

function formatReturnPct(value: number): string {
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
}

function formatCumulativeAxisLabel(value: string, index: number, allDates: string[]): string {
  const d = new Date(`${value}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ""
  const day = d.getDate()
  const month = d.getMonth() + 1
  const prev = index > 0 ? new Date(`${allDates[index - 1]}T12:00:00`) : null
  if (!prev || prev.getMonth() !== d.getMonth()) {
    if (day <= 3) return `${month}月`
  }
  if ([8, 15, 22, 29].includes(day)) return String(day)
  return ""
}

function intervalReturnColorClass(value: number): string {
  if (value < 0) return "text-red-500"
  if (value > 0) return "text-green-600"
  return "text-zinc-500"
}

function formatIntervalReturnPct(value: number): string {
  const sign = value > 0 ? "+" : ""
  return `${sign}${value.toFixed(2)}%`
}

function SortableHeader({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-0.5">
      {label}
      <span className="inline-flex flex-col leading-none text-zinc-300">
        <svg viewBox="0 0 8 5" className="h-1.5 w-1.5" aria-hidden="true">
          <path d="M4 0 8 5H0Z" fill="currentColor" />
        </svg>
        <svg viewBox="0 0 8 5" className="h-1.5 w-1.5 rotate-180" aria-hidden="true">
          <path d="M4 0 8 5H0Z" fill="currentColor" />
        </svg>
      </span>
    </span>
  )
}

function yAxisRange(series: Array<{ data: number[] }>, fallbackMin: number, fallbackMax: number) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const s of series) {
    for (const v of s.data) {
      if (!Number.isFinite(v)) continue
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: fallbackMin, max: fallbackMax }
  if (min === max) {
    return { min: min - 1, max: max + 1 }
  }
  const pad = Math.max(0.5, (max - min) * 0.08)
  return { min: Math.floor((min - pad) * 2) / 2, max: Math.ceil((max + pad) * 2) / 2 }
}

function buildSingleFactorCumulativeOption(
  factorName: string,
  color: string,
  dates: string[],
  data: number[],
) {
  const y = yAxisRange([{ data }], -5, 5)
  return {
    backgroundColor: "transparent",
    animation: false,
    grid: { left: 44, right: 12, top: 28, bottom: 28 },
    tooltip: {
      trigger: "axis" as const,
      formatter: (params: Array<{ seriesName: string; value: number; marker: string; axisValue: string }>) => {
        if (!params?.length) return ""
        const p = params[0]
        const sign = p.value > 0 ? "+" : ""
        return `<div style="font-weight:600;margin-bottom:2px">${p.axisValue}</div>${p.marker}${factorName}: ${sign}${Number(p.value).toFixed(2)}%`
      },
    },
    xAxis: {
      type: "category" as const,
      data: dates,
      boundaryGap: false,
      axisLabel: {
        fontSize: 10,
        color: "#999999",
        formatter: (value: string, index: number) =>
          formatCumulativeAxisLabel(value, index, dates),
      },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value" as const,
      min: y.min,
      max: y.max,
      axisLabel: {
        fontSize: 10,
        color: "#999999",
        formatter: (v: number) => `${v}%`,
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: "#eeeeee", type: "solid" as const } },
    },
    series: [
      {
        name: factorName,
        type: "line" as const,
        symbol: "none" as const,
        smooth: false,
        lineStyle: { color, width: 1.5 },
        itemStyle: { color },
        data,
        markLine: {
          silent: true,
          symbol: "none" as const,
          lineStyle: { color: "#cccccc", width: 1 },
          label: { show: false },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  }
}



export function FuturesStyleView() {
  const [draftFrom, setDraftFrom] = useState("")
  const [draftTo, setDraftTo] = useState("")
  /** Empty applied range => request auto (latest data window). */
  const [appliedFrom, setAppliedFrom] = useState("")
  const [appliedTo, setAppliedTo] = useState("")
  const [rangeAuto, setRangeAuto] = useState(true)
  const [dataMaxDate, setDataMaxDate] = useState<string | null>(null)
  const [activeSector, setActiveSector] = useState<SectorKey>("all")
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set())
  const [selectAllSeries, setSelectAllSeries] = useState(true)
  const [hiddenCumulativeSeries, setHiddenCumulativeSeries] = useState<Set<string>>(new Set())
  const [selectAllCumulativeSeries, setSelectAllCumulativeSeries] = useState(true)

  const [payload, setPayload] = useState<ApiPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleQuery = useCallback(() => {
    if (draftFrom && draftTo) {
      setAppliedFrom(draftFrom)
      setAppliedTo(draftTo)
      setRangeAuto(false)
    } else {
      setAppliedFrom("")
      setAppliedTo("")
      setRangeAuto(true)
    }
    setHiddenSeries(new Set())
    setSelectAllSeries(true)
    setHiddenCumulativeSeries(new Set())
    setSelectAllCumulativeSeries(true)
  }, [draftFrom, draftTo])

  const handleUseLatest = useCallback(() => {
    setDraftFrom("")
    setDraftTo("")
    setAppliedFrom("")
    setAppliedTo("")
    setRangeAuto(true)
    setHiddenSeries(new Set())
    setSelectAllSeries(true)
    setHiddenCumulativeSeries(new Set())
    setSelectAllCumulativeSeries(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const qs = new URLSearchParams({ sector: activeSector })
        if (rangeAuto || !appliedFrom || !appliedTo) {
          qs.set("auto", "1")
        } else {
          qs.set("from", appliedFrom)
          qs.set("to", appliedTo)
        }
        const res = await fetch(`/ma/api/style-factors/returns?${qs}`, {
          signal: controller.signal,
          cache: "no-store",
        })
        const json = (await res.json()) as ApiPayload | ApiError
        if (cancelled) return
        if (!res.ok || !json || (json as ApiError).ok === false) {
          setPayload(null)
          setError((json as ApiError)?.error || `加载失败 (${res.status})`)
          return
        }
        const data = json as ApiPayload
        setPayload(data)
        if (data.maxDate) setDataMaxDate(data.maxDate)
        // Sync date inputs with resolved range. Keep applied* empty while auto
        // so the effect does not re-fire with concrete dates.
        setDraftFrom(data.from)
        setDraftTo(data.to)
        if (!(data.auto || rangeAuto)) {
          setAppliedFrom(data.from)
          setAppliedTo(data.to)
        }
      } catch (e) {
        if (cancelled) return
        if ((e as Error)?.name === "AbortError") return
        setPayload(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [activeSector, rangeAuto, appliedFrom, appliedTo])

  const chartDates = payload?.dates ?? []
  const latestDate = chartDates[chartDates.length - 1] ?? appliedTo

  const chartSeries = useMemo(
    () =>
      (payload?.daily ?? []).map((s) => ({
        name: s.name,
        color: s.color,
        data: s.data,
      })),
    [payload],
  )

  const chartOption = useMemo(() => {
    const zoomWindow = chartDates.length > 8 ? Math.round((8 / chartDates.length) * 100) : 100
    const zoomStart = 100 - zoomWindow
    const y = yAxisRange(chartSeries, -4, 4)

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "shadow" as const },
        formatter: (params: Array<{ seriesName: string; value: number; marker: string; axisValue: string }>) => {
          if (!params?.length) return ""
          const lines = params
            .filter((p) => p.value != null && !Number.isNaN(p.value))
            .sort((a, b) => b.value - a.value)
            .map((p) => {
              const sign = p.value > 0 ? "+" : ""
              return `${p.marker}${p.seriesName}: ${sign}${p.value.toFixed(2)}%`
            })
          return [`<div style="font-weight:600;margin-bottom:4px">${params[0].axisValue}</div>`, ...lines].join("<br/>")
        },
      },
      legend: {
        type: "plain" as const,
        top: 4,
        left: 0,
        right: 72,
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 12,
        textStyle: { fontSize: 11, color: "#666666" },
        selected: Object.fromEntries(chartSeries.map((s) => [s.name, !hiddenSeries.has(s.name)])),
      },
      grid: { left: 52, right: 16, top: 92, bottom: 48 },
      dataZoom: [
        { type: "inside" as const, start: zoomStart, end: 100 },
        {
          type: "slider" as const,
          start: zoomStart,
          end: 100,
          bottom: 8,
          height: 22,
          borderColor: "#e4e4e7",
          backgroundColor: "#fafafa",
          fillerColor: "rgba(26,115,232,0.15)",
          handleStyle: { color: "#1A73E8", borderColor: "#1A73E8" },
          moveHandleStyle: { color: "#1A73E8" },
          dataBackground: {
            lineStyle: { color: "#cbd5e1", width: 1 },
            areaStyle: { color: "rgba(148,163,184,0.12)" },
          },
          selectedDataBackground: {
            lineStyle: { color: "#94a3b8", width: 1 },
            areaStyle: { color: "rgba(148,163,184,0.2)" },
          },
        },
      ],
      xAxis: {
        type: "category" as const,
        data: chartDates,
        axisLabel: { fontSize: 11, color: "#999999", rotate: 0, margin: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "收益率(%)",
        nameLocation: "end" as const,
        nameGap: 8,
        nameTextStyle: { fontSize: 11, color: "#999999", align: "left" as const },
        min: y.min,
        max: y.max,
        axisLabel: {
          fontSize: 11,
          color: "#999999",
          formatter: (v: number) => `${v}%`,
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#eeeeee", type: "solid" as const } },
      },
      series: chartSeries.map((s, index) => ({
        name: s.name,
        type: "bar" as const,
        barMaxWidth: 5,
        barGap: "15%",
        barCategoryGap: "35%",
        itemStyle: { color: s.color },
        data: s.data,
        ...(index === 0
          ? {
              markLine: {
                silent: true,
                symbol: "none" as const,
                lineStyle: { color: "#cccccc", width: 1 },
                label: { show: false },
                data: [{ yAxis: 0 }],
              },
            }
          : {}),
      })),
    }
  }, [chartDates, chartSeries, hiddenSeries])

  const cardValues = payload?.cards ?? []

  const intervalTableRows = useMemo(
    () =>
      (payload?.interval ?? []).map((factor, index) => ({
        index: index + 1,
        name: factor.name,
        returns: factor.returns,
      })),
    [payload],
  )

  const statsCutoff = latestDate

  const cumulativeSeries = useMemo(
    () =>
      (payload?.cumulative ?? []).map((s) => ({
        name: s.name,
        color: s.color,
        data: s.data,
      })),
    [payload],
  )

  const cumulativeChartOption = useMemo(() => {
    const y = yAxisRange(cumulativeSeries, -20, 15)
    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis" as const,
        formatter: (params: Array<{ seriesName: string; value: number; marker: string; axisValue: string }>) => {
          if (!params?.length) return ""
          const lines = params
            .filter((p) => p.value != null && !Number.isNaN(p.value))
            .sort((a, b) => b.value - a.value)
            .map((p) => {
              const sign = p.value > 0 ? "+" : ""
              return `${p.marker}${p.seriesName}: ${sign}${p.value.toFixed(2)}%`
            })
          return [`<div style="font-weight:600;margin-bottom:4px">${params[0].axisValue}</div>`, ...lines].join("<br/>")
        },
      },
      legend: {
        type: "plain" as const,
        top: 4,
        left: 0,
        right: 72,
        itemWidth: 14,
        itemHeight: 2,
        itemGap: 12,
        icon: "rect" as const,
        textStyle: { fontSize: 11, color: "#666666" },
        selected: Object.fromEntries(
          cumulativeSeries.map((s) => [s.name, !hiddenCumulativeSeries.has(s.name)]),
        ),
      },
      grid: { left: 52, right: 16, top: 92, bottom: 48 },
      xAxis: {
        type: "category" as const,
        data: chartDates,
        boundaryGap: false,
        axisLabel: {
          fontSize: 11,
          color: "#999999",
          formatter: (value: string, index: number) =>
            formatCumulativeAxisLabel(value, index, chartDates),
        },
        axisLine: { lineStyle: { color: "#e4e4e7" } },
        axisTick: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "收益率(%)",
        nameLocation: "end" as const,
        nameGap: 8,
        nameTextStyle: { fontSize: 11, color: "#999999", align: "left" as const },
        min: y.min,
        max: y.max,
        axisLabel: {
          fontSize: 11,
          color: "#999999",
          formatter: (v: number) => `${v}%`,
        },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#eeeeee", type: "solid" as const } },
      },
      series: cumulativeSeries.map((s, index) => ({
        name: s.name,
        type: "line" as const,
        symbol: "none" as const,
        smooth: false,
        lineStyle: { color: s.color, width: 1.5 },
        itemStyle: { color: s.color },
        data: s.data,
        ...(index === 0
          ? {
              markLine: {
                silent: true,
                symbol: "none" as const,
                lineStyle: { color: "#cccccc", width: 1 },
                label: { show: false },
                data: [{ yAxis: 0 }],
              },
            }
          : {}),
      })),
    }
  }, [chartDates, cumulativeSeries, hiddenCumulativeSeries])

  const handleToggleAllSeries = useCallback(() => {
    setSelectAllSeries((prev) => {
      const next = !prev
      setHiddenSeries(next ? new Set() : new Set(chartSeries.map((f) => f.name)))
      return next
    })
  }, [chartSeries])

  const handleLegendSelectChanged = useCallback((params: { selected?: Record<string, boolean> }) => {
    const selected = params.selected ?? {}
    const hidden = new Set<string>()
    for (const [name, visible] of Object.entries(selected)) {
      if (!visible) hidden.add(name)
    }
    setHiddenSeries(hidden)
    setSelectAllSeries(hidden.size === 0)
  }, [])

  const handleToggleAllCumulativeSeries = useCallback(() => {
    setSelectAllCumulativeSeries((prev) => {
      const next = !prev
      setHiddenCumulativeSeries(next ? new Set() : new Set(cumulativeSeries.map((f) => f.name)))
      return next
    })
  }, [cumulativeSeries])

  const handleCumulativeLegendSelectChanged = useCallback(
    (params: { selected?: Record<string, boolean> }) => {
      const selected = params.selected ?? {}
      const hidden = new Set<string>()
      for (const [name, visible] of Object.entries(selected)) {
        if (!visible) hidden.add(name)
      }
      setHiddenCumulativeSeries(hidden)
      setSelectAllCumulativeSeries(hidden.size === 0)
    },
    [],
  )

  return (
    <div className="flex flex-col gap-4 -m-1">
      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-600 shrink-0">请选择时间范围：</span>
          <input
            type="date"
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            className="h-8 w-[9.5rem] rounded-sm border border-zinc-200 px-2 text-sm text-zinc-700 bg-white"
          />
          <span className="text-zinc-500 text-sm">~</span>
          <input
            type="date"
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            className="h-8 w-[9.5rem] rounded-sm border border-zinc-200 px-2 text-sm text-zinc-700 bg-white"
          />
          <button
            type="button"
            onClick={handleQuery}
            className="h-8 min-w-[4rem] px-4 rounded-sm border border-zinc-200 bg-white text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            查询
          </button>
          <button
            type="button"
            onClick={handleUseLatest}
            className="h-8 min-w-[4rem] px-4 rounded-sm border border-red-200 bg-red-50 text-sm text-red-600 hover:bg-red-100 transition-colors"
            title={dataMaxDate ? `用数据库最新交易日 ${dataMaxDate} 作为结束日，向前约 3 个月` : "用数据库最新交易日自动取近约 3 个月"}
          >
            最新
          </button>
          {rangeAuto && (
            <span className="text-xs text-emerald-600 shrink-0">自动跟踪最新数据</span>
          )}
          {loading && <span className="text-xs text-zinc-400">加载真实因子收益中…</span>}
          {error && <span className="text-xs text-red-500">加载失败：{error}</span>}
          {!loading && !error && payload?.source && (
            <span className="text-xs text-zinc-400 truncate max-w-[28rem]" title={payload.source.note}>
              数据：AkShare/EMQuant 本地代理（非 GTJAQH*.WI 周报净值）
              {dataMaxDate ? ` · 最新交易日 ${dataMaxDate}` : ""}
            </span>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
        <div className="flex items-center gap-0 border-b border-zinc-100 mb-4">
          {SECTOR_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveSector(tab.key)}
              className={[
                "px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px",
                activeSector === tab.key
                  ? "border-red-500 text-red-600 font-medium"
                  : "border-transparent text-zinc-700 hover:text-zinc-900",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mb-4">
          <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
          <span className="text-sm font-semibold text-zinc-800">最新风格因子收益</span>
          <span className="text-sm text-zinc-400">{latestDate}</span>
          <FuturesStyleCalcHelp section="latest" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {cardValues.map((card) => (
            <div
              key={card.name}
              className={["rounded border px-3 py-3 text-center", cardBgClass(card.value)].join(" ")}
            >
              <div className="text-xs text-zinc-500 mb-2 leading-snug min-h-[2rem] flex items-center justify-center">
                {card.name}
              </div>
              <div className={["text-xl font-semibold tabular-nums", returnColorClass(card.value)].join(" ")}>
                {formatReturnPct(card.value)}
              </div>
            </div>
          ))}
          {!loading && cardValues.length === 0 && (
            <div className="col-span-full text-sm text-zinc-400 py-6 text-center">暂无因子收益数据</div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 pt-4 pb-2">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
            单日风格因子收益
            <FuturesStyleCalcHelp section="daily" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleToggleAllSeries}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              <span
                className={[
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm",
                  selectAllSeries ? "bg-red-500" : "border border-zinc-300 bg-white",
                ].join(" ")}
              >
                {selectAllSeries && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              全选
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center h-7 w-7 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition-colors"
              title="图表设置"
            >
              <Menu className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {chartDates.length === 0 ? (
          <div className="flex items-center justify-center h-80 text-sm text-zinc-400">
            {loading ? "加载中…" : "请选择有效的时间范围后点击查询"}
          </div>
        ) : (
          <ReactECharts
            option={chartOption}
            style={{ height: 480, width: "100%" }}
            notMerge
            lazyUpdate
            onEvents={{ legendselectchanged: handleLegendSelectChanged }}
          />
        )}
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
        <div className="mb-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
            <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
            区间统计
            <FuturesStyleCalcHelp section="interval" />
          </div>
          <div className="text-xs text-zinc-400 mt-1 ml-3">
            当前区间统计截止点为: {statsCutoff}
          </div>
        </div>
        <div className="overflow-x-auto rounded border border-zinc-100">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-50 text-zinc-500">
                <th className="px-3 py-2.5 text-center font-medium border-b border-zinc-100 w-12">序号</th>
                <th className="px-3 py-2.5 text-left font-medium border-b border-zinc-100 min-w-[9rem]">因子名称</th>
                {INTERVAL_PERIOD_COLUMNS.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-2.5 text-center font-medium border-b border-zinc-100 whitespace-nowrap min-w-[5.5rem]"
                  >
                    <SortableHeader label={col} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {intervalTableRows.map((row, rowIndex) => {
                const rowBg = rowIndex % 2 === 1 ? "bg-zinc-50/60" : "bg-white"
                return (
                  <tr key={row.name} className={rowBg}>
                    <td className={["px-3 py-2 text-center text-zinc-500 border-b border-zinc-50 tabular-nums", rowBg].join(" ")}>
                      {row.index}
                    </td>
                    <td className={["px-3 py-2 text-left text-zinc-700 border-b border-zinc-50 whitespace-nowrap", rowBg].join(" ")}>
                      {row.name}
                    </td>
                    {row.returns.map((value, colIndex) => (
                      <td
                        key={`${row.name}-${colIndex}`}
                        className={[
                          "px-3 py-2 text-center tabular-nums border-b border-zinc-50 whitespace-nowrap",
                          intervalReturnColorClass(value),
                          rowBg,
                        ].join(" ")}
                      >
                        {formatIntervalReturnPct(value)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 pt-4 pb-2">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
              <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
              风格因子累计收益
              <FuturesStyleCalcHelp section="cumulative" />
            </div>
            <div className="text-xs text-zinc-400 mt-1 ml-3">
              统计区间: {payload?.from ?? draftFrom ?? "—"} ~ {statsCutoff}
              {rangeAuto ? "（自动最新）" : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleToggleAllCumulativeSeries}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-900 transition-colors"
            >
              <span
                className={[
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm",
                  selectAllCumulativeSeries ? "bg-red-500" : "border border-zinc-300 bg-white",
                ].join(" ")}
              >
                {selectAllCumulativeSeries && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </span>
              全选
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center h-7 w-7 rounded border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition-colors"
              title="图表设置"
            >
              <Menu className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {chartDates.length === 0 ? (
          <div className="flex items-center justify-center h-80 text-sm text-zinc-400">
            {loading ? "加载中…" : "请选择有效的时间范围后点击查询"}
          </div>
        ) : (
          <>
            <ReactECharts
              option={cumulativeChartOption}
              style={{ height: 420, width: "100%" }}
              notMerge
              lazyUpdate
              onEvents={{ legendselectchanged: handleCumulativeLegendSelectChanged }}
            />

            <div className="mt-4 border-t border-zinc-100 pt-4">
              <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-zinc-800">
                <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
                分因子累计收益
                <span className="text-xs font-normal text-zinc-400">
                  每个因子单独展示累计路径（与上方同一区间）
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {cumulativeSeries.map((series) => (
                  <div
                    key={series.name}
                    className="rounded-lg border border-zinc-100 bg-zinc-50/40 px-3 pt-3 pb-1"
                  >
                    <div className="flex items-center gap-2 mb-1 min-h-[1.25rem]">
                      <span
                        className="inline-block h-0.5 w-3 rounded-sm shrink-0"
                        style={{ backgroundColor: series.color }}
                      />
                      <span className="text-xs font-medium text-zinc-700 truncate" title={series.name}>
                        {series.name}
                      </span>
                      <span
                        className={[
                          "ml-auto text-xs tabular-nums font-semibold shrink-0",
                          (series.data.at(-1) ?? 0) > 0
                            ? "text-red-500"
                            : (series.data.at(-1) ?? 0) < 0
                              ? "text-green-600"
                              : "text-zinc-500",
                        ].join(" ")}
                      >
                        {formatReturnPct(series.data.at(-1) ?? 0)}
                      </span>
                    </div>
                    <ReactECharts
                      option={buildSingleFactorCumulativeOption(
                        series.name,
                        series.color,
                        chartDates,
                        series.data,
                      )}
                      style={{ height: 200, width: "100%" }}
                      notMerge
                      lazyUpdate
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
