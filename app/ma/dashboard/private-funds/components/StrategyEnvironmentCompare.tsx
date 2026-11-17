"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import type { StrategyComparePayload } from "@/lib/server/strategy-environment-compare"

const FUND_COLORS = ["#2563eb", "#d97706", "#7c3aed", "#0891b2", "#be123c"]

function monthsBefore(ymd: string, months: number): string {
  const [year, month, day] = ymd.split("-").map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 - months, day))
  return shifted.toISOString().slice(0, 10)
}

function latestZoom(dates: string[]): { startValue: string; endValue: string } {
  const endValue = dates[dates.length - 1] ?? ""
  const cutoff = endValue ? monthsBefore(endValue, 6) : ""
  const startValue = dates.find((date) => date >= cutoff) ?? dates[0] ?? ""
  return { startValue, endValue }
}

type SearchHit = { beian_hao: string; product_name: string; short_name: string | null }

function useDark(): boolean {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const root = document.documentElement
    const read = () => setDark(root.classList.contains("dark"))
    read()
    const obs = new MutationObserver(read)
    obs.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])
  return dark
}

export function StrategyEnvironmentCompare({ strategyKey, strategyName }: { strategyKey: string; strategyName: string }) {
  const dark = useDark()
  const [picked, setPicked] = useState<SearchHit[]>([])
  const [queryText, setQueryText] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [payload, setPayload] = useState<StrategyComparePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const fundParam = picked.map((item) => item.beian_hao).join(",")

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    setPayload(null)
    const params = new URLSearchParams({ key: strategyKey })
    if (fundParam) params.set("funds", fundParam)
    fetch(`/ma/api/private-funds/market/strategy-environment/compare?${params}`, { signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || "加载失败")
        setPayload(json)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setError(err instanceof Error ? err.message : "加载失败")
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })
    return () => ctrl.abort()
  }, [strategyKey, fundParam])

  useEffect(() => {
    const q = queryText.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    const ctrl = new AbortController()
    const timer = window.setTimeout(() => {
      setSearching(true)
      fetch(`/ma/api/private-funds/products/search?format=picker&q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(async (res) => {
          const json = await res.json()
          if (!Array.isArray(json)) throw new Error("搜索失败")
          setHits(json.slice(0, 8))
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return
          setHits([])
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false)
        })
    }, 250)
    return () => {
      ctrl.abort()
      window.clearTimeout(timer)
    }
  }, [queryText])

  const option = useMemo(() => {
    if (!payload) return null
    const axis = dark ? "#a1a1aa" : "#71717a"
    const split = dark ? "#3f3f46" : "#e4e4e7"
    const dates = payload.points.map((point) => point.date)
    const zoom = latestZoom(dates)
    const series = [
      {
        name: "环境分",
        type: "line",
        yAxisIndex: 0,
        showSymbol: false,
        data: payload.points.map((point) => point.score),
        lineStyle: { width: 2, color: "#e11d48" },
        itemStyle: { color: "#e11d48" },
      },
      {
        name: `同类平均（${payload.peerCount}）`,
        type: "line",
        yAxisIndex: 1,
        showSymbol: false,
        connectNulls: false,
        data: payload.points.map((point) => point.peer),
        lineStyle: { width: 2, color: "#ca8a04" },
        itemStyle: { color: "#ca8a04" },
      },
      ...payload.funds.map((fund, index) => ({
        name: fund.name,
        type: "line",
        yAxisIndex: 1,
        showSymbol: false,
        connectNulls: false,
        data: fund.values,
        lineStyle: { width: 1.5, color: FUND_COLORS[index % FUND_COLORS.length] },
        itemStyle: { color: FUND_COLORS[index % FUND_COLORS.length] },
      })),
    ]
    return {
      animation: false,
      grid: { left: 48, right: 52, top: 32, bottom: 64 },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          filterMode: "filter",
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          startValue: zoom.startValue,
          endValue: zoom.endValue,
        },
        {
          type: "slider",
          xAxisIndex: 0,
          filterMode: "filter",
          height: 22,
          bottom: 8,
          startValue: zoom.startValue,
          endValue: zoom.endValue,
          borderColor: split,
          backgroundColor: dark ? "#27272a" : "#f4f4f5",
          fillerColor: dark ? "rgba(161,161,170,0.28)" : "rgba(24,24,27,0.12)",
          handleStyle: { color: dark ? "#e4e4e7" : "#3f3f46" },
          textStyle: { color: axis, fontSize: 10 },
          dataBackground: {
            lineStyle: { color: "#e11d48", width: 1 },
            areaStyle: { color: "rgba(225,29,72,0.15)" },
          },
        },
      ],
      legend: { type: "scroll", top: 0, textStyle: { color: axis, fontSize: 12 } },
      tooltip: {
        trigger: "axis",
        backgroundColor: dark ? "#18181b" : "#fff",
        borderColor: split,
        textStyle: { color: dark ? "#e4e4e7" : "#27272a", fontSize: 12 },
      },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { color: axis, fontSize: 11 },
        axisLine: { lineStyle: { color: split } },
      },
      yAxis: [
        {
          type: "value",
          name: "环境分",
          min: 0,
          max: 100,
          nameTextStyle: { color: axis, fontSize: 11 },
          axisLabel: { color: axis, fontSize: 11 },
          splitLine: { lineStyle: { color: split } },
        },
        {
          type: "value",
          name: "净值=100",
          scale: true,
          nameTextStyle: { color: axis, fontSize: 11 },
          axisLabel: { color: axis, fontSize: 11 },
          splitLine: { show: false },
        },
      ],
      series,
    }
  }, [payload, dark])

  function addFund(hit: SearchHit) {
    setPicked((current) => {
      if (current.some((item) => item.beian_hao.toUpperCase() === hit.beian_hao.toUpperCase())) return current
      return [...current, hit].slice(0, 5)
    })
    setQueryText("")
    setHits([])
  }

  return (
    <section className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{strategyName}的分数和净值</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            打开时显示最近 6 个月。拖动下方滚动条可以看更早的交易日，在图上滚动鼠标可以继续缩放。左轴是环境分。右轴把累计净值换成整段第一天为 100。
            同类平均是{payload?.peerLabel ?? "对应策略"}里有净值的产品，按当天新公布净值的等权收益连乘，样本 {payload?.peerCount ?? "—"} 只。
          </p>
        </div>
        <div className="relative w-full max-w-sm">
          <input
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            placeholder="搜索基金名称或备案号，最多 5 只"
            className="w-full rounded border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-800 outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          {(hits.length > 0 || searching) && queryText.trim().length >= 2 && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
              {searching && hits.length === 0 && <div className="px-3 py-2 text-xs text-zinc-400">搜索中</div>}
              {hits.map((hit) => (
                <button
                  key={hit.beian_hao}
                  type="button"
                  onClick={() => addFund(hit)}
                  className="block w-full truncate px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {hit.short_name || hit.product_name}
                  <span className="ml-2 text-xs text-zinc-400">{hit.beian_hao}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {picked.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {picked.map((fund) => (
            <button
              key={fund.beian_hao}
              type="button"
              onClick={() => setPicked((current) => current.filter((item) => item.beian_hao !== fund.beian_hao))}
              className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            >
              {fund.short_name || fund.product_name}
              <span className="ml-1 text-zinc-400">×</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && option && (
          <ReactECharts option={option} style={{ height: 380 }} notMerge lazyUpdate={false} />
        )}
        {loading && !payload && <div className="h-80 animate-pulse rounded bg-zinc-50 dark:bg-zinc-900" />}
      </div>
    </section>
  )
}
