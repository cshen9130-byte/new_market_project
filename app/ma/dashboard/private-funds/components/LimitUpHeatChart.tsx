"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Menu } from "lucide-react"
import type { LimitUpIntradayPayload, LimitUpIntradayPoint } from "@/lib/server/limit-up-intraday"
import { LimitUpAdvanceRatioChart } from "./LimitUpAdvanceRatioChart"

const LIMIT_COLOR = "#c4544c"
const INDEX_COLOR = "#c4a84a"
const POLL_MS = 30_000

const EMPTY: LimitUpIntradayPayload = { asOf: null, asOfTime: null, points: [] }

function pctAxis(values: number[]) {
  if (!values.length) return { min: -0.6, max: 0.6, interval: 0.3 }
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = Math.max(hi - lo, 0.3)
  const interval = span <= 2.2 ? 0.3 : span <= 4 ? 0.5 : span <= 8 ? 1 : 2
  const pad = Math.min(Math.max(span * 0.08, interval * 0.35), interval * 0.85)
  const round = (n: number) => Math.round(n * 1000) / 1000
  let min = Math.floor((lo - pad) / interval) * interval
  let max = Math.ceil((hi + pad) / interval) * interval
  if (max <= min) max = min + interval * 4
  return { min: round(min), max: round(max), interval }
}

function formatTick(value: number) {
  const n = Math.round(value * 10) / 10
  if (Math.abs(n) < 0.05) return "0%"
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1)
  return n > 0 ? `+${text}%` : `${text}%`
}

function isTenMinute(time: string) {
  const minute = Number(time.slice(3, 5))
  return Number.isFinite(minute) && minute % 10 === 0
}

function lineSeries(name: string, color: string, values: number[], times: string[], z: number) {
  return {
    name,
    type: "line" as const,
    data: values.map((value, index) => {
      const show = isTenMinute(times[index] ?? "")
      return {
        value,
        label: {
          show,
          position: "top" as const,
          distance: 4,
          color,
          fontSize: 11,
          formatter: show ? `${value.toFixed(2)}%` : "",
        },
      }
    }),
    smooth: 0,
    clip: false,
    // Labels are drawn on symbols. `symbol: "none"` skips them entirely,
    // so use a transparent dot and only turn labels on at 10-minute marks.
    showSymbol: true,
    showAllSymbol: true,
    symbol: "circle",
    symbolSize: 4,
    z,
    lineStyle: { width: 1.6, color },
    itemStyle: { color: "transparent", borderWidth: 0 },
    label: { show: true, color, fontSize: 11 },
    labelLayout: { hideOverlap: false },
    emphasis: { disabled: true },
  }
}

export function LimitUpHeatChart() {
  const [payload, setPayload] = useState<LimitUpIntradayPayload>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const chartRef = useRef<ReactECharts>(null)

  const load = useCallback((initial: boolean) => {
    if (initial) {
      setLoading(true)
      setError(null)
    }
    return fetch("/ma/api/private-funds/market/limit-up-intraday", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as LimitUpIntradayPayload & { error?: string }
        if (!res.ok) throw new Error(json.error || "加载涨停表现失败")
        return json
      })
      .then((json) => {
        setPayload({
          asOf: json.asOf ?? null,
          asOfTime: json.asOfTime ?? null,
          points: Array.isArray(json.points) ? json.points : [],
        })
        setError(null)
      })
      .catch((err: unknown) => {
        if (initial) setError(err instanceof Error ? err.message : "加载涨停表现失败")
      })
      .finally(() => {
        if (initial) setLoading(false)
      })
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = (initial: boolean) => {
      if (cancelled) return
      void load(initial)
    }
    run(true)
    const timer = window.setInterval(() => run(false), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [load])

  const points: LimitUpIntradayPoint[] = payload.points
  const axis = useMemo(
    () => pctAxis(points.flatMap((p) => [p.limitUp, p.index])),
    [points],
  )

  const option = useMemo(() => {
    const times = points.map((p) => p.time)
    return {
      animationDuration: 300,
      color: [LIMIT_COLOR, INDEX_COLOR],
      tooltip: {
        trigger: "axis" as const,
        backgroundColor: "rgba(255,255,255,0.96)",
        borderColor: "#e5e7eb",
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: "#334155", fontSize: 12 },
        axisPointer: {
          type: "line" as const,
          lineStyle: { color: "#94a3b8", type: "dashed" as const, width: 1 },
        },
        valueFormatter: (v: number) => (typeof v === "number" ? `${v.toFixed(2)}%` : "-"),
      },
      grid: { left: 8, right: 64, top: 36, bottom: 8, containLabel: true },
      xAxis: {
        type: "category" as const,
        data: times,
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#e5e7eb" } },
        axisTick: { show: false },
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          hideOverlap: false,
          margin: 10,
          interval: (_index: number, value: string) => isTenMinute(value),
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value" as const,
        name: "涨跌幅(%)",
        nameLocation: "middle" as const,
        nameGap: 46,
        nameTextStyle: { color: "#94a3b8", fontSize: 11 },
        min: axis.min,
        max: axis.max,
        interval: axis.interval,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: "#94a3b8",
          fontSize: 11,
          formatter: (v: number) => formatTick(v),
        },
        splitLine: { lineStyle: { color: "#eef2f6", type: "dashed" as const, width: 1 } },
      },
      series: [
        lineSeries(
          "涨停板表现",
          LIMIT_COLOR,
          points.map((p) => p.limitUp),
          times,
          3,
        ),
        lineSeries(
          "上证指数",
          INDEX_COLOR,
          points.map((p) => p.index),
          times,
          2,
        ),
      ],
    }
  }, [axis.interval, axis.max, axis.min, points])

  const handleDownload = useCallback(() => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const url = inst.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" })
    const a = document.createElement("a")
    a.href = url
    a.download = `昨日涨停股今日表现_${payload.asOf ?? "intraday"}.png`
    a.click()
  }, [payload.asOf])

  return (
    <>
    <div className="px-1 pt-2">
      <div className="flex items-center gap-2">
        <span className="inline-block h-3.5 w-[3px] rounded-sm bg-red-500" />
        <span className="text-sm font-semibold text-zinc-800">昨日涨停股今日表现 (不含盘前一字板)</span>
      </div>
      <p className="mt-1 ml-[11px] text-xs text-zinc-400">
        统计截止点：{payload.asOf ?? "—"}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4" style={{ backgroundColor: LIMIT_COLOR }} />
            涨停板表现
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-4" style={{ backgroundColor: INDEX_COLOR }} />
            上证指数
          </span>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-colors"
          title="导出图片"
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>
      {loading ? (
        <div className="flex h-[420px] items-center justify-center text-sm text-zinc-400">正在加载…</div>
      ) : error ? (
        <div className="flex h-[420px] items-center justify-center text-sm text-red-500">{error}</div>
      ) : points.length ? (
        <ReactECharts ref={chartRef} option={option} style={{ height: 420 }} notMerge lazyUpdate />
      ) : (
        <div className="flex h-[420px] items-center justify-center text-sm text-zinc-400">暂无分时数据</div>
      )}
    </div>
    <LimitUpAdvanceRatioChart />
    </>
  )
}


