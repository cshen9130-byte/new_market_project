"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type DirectionFilter = "买方" | "卖方"

type OptionRow = {
  account: string
  contract: string
  floatingPnl: number
  longLots?: number
  shortLots?: number
  buyPrice?: number
  sellPrice?: number
  todaySettle?: number
  multiplier?: number
  longFloatingPnl?: number
  shortFloatingPnl?: number
}

function directionalPnl(r: OptionRow, dir: DirectionFilter): number | null {
  if (dir === "买方") {
    if ((r.longLots ?? 0) <= 0) return null
    if (typeof r.longFloatingPnl === "number") return r.longFloatingPnl
    return Math.round(((r.todaySettle ?? 0) - (r.buyPrice ?? 0)) * (r.longLots ?? 0) * (r.multiplier ?? 0))
  }
  if ((r.shortLots ?? 0) <= 0) return null
  if (typeof r.shortFloatingPnl === "number") return r.shortFloatingPnl
  return Math.round(((r.sellPrice ?? 0) - (r.todaySettle ?? 0)) * (r.shortLots ?? 0) * (r.multiplier ?? 0))
}

function buildPnlBarOption(
  bars: { key: string; pnl: number }[],
  labelFn?: (key: string) => string,
) {
  return {
    tooltip: {
      trigger: "axis" as const,
      axisPointer: { type: "shadow" as const },
      formatter: (params: { name: string; value: number; marker: string }[]) => {
        const p = params[0]
        if (!p) return ""
        const label = labelFn ? labelFn(p.name) : p.name
        return `${p.marker}${label}<br/>浮动盈亏：${p.value.toLocaleString("zh-CN")}`
      },
    },
    grid: { left: 16, right: 16, top: 24, bottom: 8, containLabel: true },
    xAxis: {
      type: "category" as const,
      data: bars.map((d) => d.key),
      axisLabel: {
        fontSize: 10,
        rotate: bars.length > 8 ? 35 : 0,
        formatter: (name: string) => (labelFn ? labelFn(name) : name),
      },
    },
    yAxis: {
      type: "value" as const,
      axisLabel: {
        fontSize: 10,
        formatter: (v: number) => {
          const abs = Math.abs(v)
          if (abs >= 1e4) return `${(v / 1e4).toFixed(abs >= 1e5 ? 0 : 1)}万`
          return String(v)
        },
      },
      splitLine: { lineStyle: { type: "dashed" as const } },
    },
    series: [{
      type: "bar" as const,
      data: bars.map((d) => ({
        value: Math.round(d.pnl),
        itemStyle: { color: d.pnl > 0 ? "#f97316" : d.pnl < 0 ? "#2dd4bf" : "#94a3b8" },
      })),
      barMaxWidth: 36,
      label: {
        show: bars.length <= 16,
        position: "top" as const,
        fontSize: 9,
        formatter: (p: { value: number }) => p.value.toLocaleString("zh-CN"),
      },
    }],
  }
}

export default function OptionFloatingPnlCharts({
  height = 280,
  prodNameMap = {},
  className = "",
  hideAccountChart = false,
}: {
  height?: number
  prodNameMap?: Record<string, string>
  className?: string
  hideAccountChart?: boolean
}) {
  const [rows, setRows] = useState<OptionRow[]>([])
  const [date, setDate] = useState("")
  const [loading, setLoading] = useState(true)
  const [dirFilter, setDirFilter] = useState<DirectionFilter>("卖方")

  useEffect(() => {
    setLoading(true)
    fetch("/ma/api/mom-analysis/option-positions")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setRows(j.rows ?? [])
          setDate(j.date ?? "")
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const accountPnlBars = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      const pnl = directionalPnl(r, dirFilter)
      if (pnl == null) continue
      map.set(r.account, (map.get(r.account) ?? 0) + pnl)
    }
    return Array.from(map.entries())
      .map(([key, pnl]) => ({ key, pnl }))
      .sort((a, b) => b.pnl - a.pnl)
  }, [rows, dirFilter])

  const productPnlBars = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of rows) {
      const pnl = directionalPnl(r, dirFilter)
      if (pnl == null) continue
      const prod = r.contract.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? "未知"
      map.set(prod, (map.get(prod) ?? 0) + pnl)
    }
    return Array.from(map.entries())
      .map(([key, pnl]) => ({ key, pnl }))
      .sort((a, b) => b.pnl - a.pnl)
  }, [rows, dirFilter])

  const accountPnlTotal = useMemo(
    () => accountPnlBars.reduce((s, d) => s + d.pnl, 0),
    [accountPnlBars],
  )
  const productPnlTotal = useMemo(
    () => productPnlBars.reduce((s, d) => s + d.pnl, 0),
    [productPnlBars],
  )

  const accountPnlChartOption = useMemo(
    () => buildPnlBarOption(accountPnlBars),
    [accountPnlBars],
  )
  const productPnlChartOption = useMemo(
    () => buildPnlBarOption(productPnlBars, (key) => {
      const cn = prodNameMap[key] ?? ""
      return cn ? `${key} ${cn}` : key
    }),
    [productPnlBars, prodNameMap],
  )

  const fmt = (v: number) => v.toLocaleString("zh-CN")

  const dirToggle = (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">方向</span>
      <div className="inline-flex rounded border border-border overflow-hidden">
        {(["买方", "卖方"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirFilter(d)}
            className={`px-2.5 py-0.5 text-xs transition-colors ${
              dirFilter === d
                ? "bg-[#1a3a5c] text-white font-medium"
                : "bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className={className}>
      <div className="flex items-center justify-end mb-2">
        {dirToggle}
      </div>
      <div className="flex gap-4">
      {!hideAccountChart && (
      <Card className="w-1/2 min-w-0">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">
              账户期权浮动盈亏
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">{dirFilter}</span>
              {date && <span className="ml-2 text-xs font-normal text-muted-foreground">{date}</span>}
            </CardTitle>
            {!loading && accountPnlBars.length > 0 && (
              <span className={`text-xs font-medium ${accountPnlTotal > 0 ? "text-orange-500" : accountPnlTotal < 0 ? "text-teal-400" : "text-muted-foreground"}`}>
                合计 {fmt(Math.round(accountPnlTotal))}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-3">
          {loading ? (
            <p className="text-sm text-muted-foreground px-1 py-8">加载中...</p>
          ) : accountPnlBars.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1 py-8">暂无期权浮动盈亏数据</p>
          ) : (
            <ReactECharts
              option={accountPnlChartOption}
              style={{ height, width: "100%" }}
              notMerge
              lazyUpdate
            />
          )}
        </CardContent>
      </Card>
      )}

      <Card className={hideAccountChart ? "w-full min-w-0" : "w-1/2 min-w-0"}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm">
              品种期权浮动盈亏
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">{dirFilter}</span>
              {date && <span className="ml-2 text-xs font-normal text-muted-foreground">{date}</span>}
            </CardTitle>
            {!loading && productPnlBars.length > 0 && (
              <span className={`text-xs font-medium ${productPnlTotal > 0 ? "text-orange-500" : productPnlTotal < 0 ? "text-teal-400" : "text-muted-foreground"}`}>
                合计 {fmt(Math.round(productPnlTotal))}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-3">
          {loading ? (
            <p className="text-sm text-muted-foreground px-1 py-8">加载中...</p>
          ) : productPnlBars.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1 py-8">暂无期权浮动盈亏数据</p>
          ) : (
            <ReactECharts
              option={productPnlChartOption}
              style={{ height, width: "100%" }}
              notMerge
              lazyUpdate
            />
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
