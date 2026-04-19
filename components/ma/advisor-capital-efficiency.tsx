"use client"

import { useState, useEffect, useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type AccountData = {
  account: string
  avgMarginUtil: number   // %
  annualReturn: number    // %
  returnPerMargin: number // annualReturn% / avgMarginUtil%
  nominalEquityWan: number // 万
  sector: string
}

const WINDOW_OPTIONS = [
  { value: "20",  label: "近 20 日" },
  { value: "60",  label: "近 60 日" },
  { value: "120", label: "近 120 日" },
  { value: "",    label: "全部" },
]

const SECTOR_PALETTE = [
  "#f59e0b", "#3b82f6", "#a855f7", "#06b6d4", "#f97316",
  "#84cc16", "#ec4899", "#14b8a6", "#8b5cf6", "#ef4444",
  "#6366f1", "#22c55e",
]

export default function AdvisorCapitalEfficiency({ height = 480 }: { height?: number }) {
  const [win,      setWin]      = useState("60")
  const [accounts, setAccounts] = useState<AccountData[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const url = win
      ? `/ma/api/mom-analysis/capital-efficiency?window=${win}`
      : "/ma/api/mom-analysis/capital-efficiency"
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) { setError(j.error ?? "加载失败"); return }
        setAccounts(j.accounts ?? [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : "请求失败"))
      .finally(() => setLoading(false))
  }, [win])

  const sectorColorMap = useMemo(() => {
    const sectors = [...new Set(accounts.map((p) => p.sector))].sort()
    return new Map(sectors.map((s, i) => [s, SECTOR_PALETTE[i % SECTOR_PALETTE.length]]))
  }, [accounts])

  const option = useMemo(() => {
    if (!accounts.length) return {}

    const sectorGroups = new Map<string, AccountData[]>()
    for (const p of accounts) {
      if (!sectorGroups.has(p.sector)) sectorGroups.set(p.sector, [])
      sectorGroups.get(p.sector)!.push(p)
    }

    const meanX = accounts.reduce((s, p) => s + p.avgMarginUtil, 0) / accounts.length
    const meanY = accounts.reduce((s, p) => s + p.annualReturn, 0) / accounts.length

    // Bubble size: area ∝ nominalEquityWan
    const equities = accounts.map((p) => p.nominalEquityWan).filter((e) => e > 0)
    const maxEquity = equities.length ? Math.max(...equities) : 1
    const sizeOf = (wan: number) => Math.max(8, Math.min(52, (Math.sqrt(wan / maxEquity)) * 52))

    const xs = accounts.map((p) => p.avgMarginUtil)
    const ys = accounts.map((p) => p.annualReturn)
    const xMin = Math.max(0, Math.min(...xs) - 2)
    const xMax = Math.max(...xs) + 2
    const yMin = Math.min(...ys) - 5
    const yMax = Math.max(...ys) + 5

    const series: object[] = [
      // Mean vertical line
      {
        name: "_vline",
        type: "line",
        data: [[meanX, yMin], [meanX, yMax]],
        showSymbol: false,
        lineStyle: { width: 1, type: "dashed", color: "rgba(148,163,184,0.5)" },
        silent: true, legendHoverLink: false, tooltip: { show: false }, z: 1,
      },
      // Mean horizontal line
      {
        name: "_hline",
        type: "line",
        data: [[xMin, meanY], [xMax, meanY]],
        showSymbol: false,
        lineStyle: { width: 1, type: "dashed", color: "rgba(148,163,184,0.5)" },
        silent: true, legendHoverLink: false, tooltip: { show: false }, z: 1,
      },
      // Per-sector bubbles
      ...[...sectorGroups.entries()].map(([sector, points]) => ({
        name: sector,
        type: "scatter",
        data: points.map((p) => ({
          value: [p.avgMarginUtil, p.annualReturn, p.nominalEquityWan],
          name: p.account,
        })),
        symbolSize: (val: number[]) => sizeOf(val[2]),
        itemStyle: {
          color: sectorColorMap.get(sector) ?? "#888",
          borderColor: "#fff",
          borderWidth: 1,
          opacity: 0.85,
        },
        z: 10,
      })),
    ]

    return {
      grid: { left: 60, right: 28, top: 52, bottom: 52 },
      legend: {
        top: 4,
        left: "center",
        textStyle: { fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8,
        data: [...sectorGroups.keys()],
      },
      xAxis: {
        type: "value",
        name: "平均保证金占用率 (%)",
        nameLocation: "middle",
        nameGap: 32,
        nameTextStyle: { fontSize: 11 },
        min: xMin,
        max: xMax,
        axisLabel: { fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.2 } },
      },
      yAxis: {
        type: "value",
        name: "年化收益率 (%)",
        nameLocation: "end",
        nameTextStyle: { fontSize: 11 },
        min: yMin,
        max: yMax,
        axisLabel: { fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` },
        splitLine: { lineStyle: { type: "dashed", opacity: 0.2 } },
      },
      tooltip: {
        trigger: "item",
        formatter: (params: { seriesName: string; name?: string; value: [number, number, number] }) => {
          if (params.seriesName.startsWith("_")) return ""
          const p = accounts.find((a) => a.account === params.name)
          if (!p) return params.name ?? ""
          return [
            `<b>${p.account}</b> · ${p.sector}`,
            `名义规模：${p.nominalEquityWan.toFixed(0)} 万`,
            `保证金占用率：${p.avgMarginUtil.toFixed(1)}%`,
            `年化收益率：${p.annualReturn.toFixed(1)}%`,
            `收益/保证金效率：${p.returnPerMargin.toFixed(2)}x`,
          ].join("<br/>")
        },
      },
      graphic: [
        {
          type: "text", left: "7%", top: "14%",
          style: { text: "高效低杠杆\n↑ 增配候选", fontSize: 10, fill: "rgba(34,197,94,0.75)", align: "center", lineHeight: 16 },
        },
        {
          type: "text", right: "4%", top: "14%",
          style: { text: "高效高杠杆\n满负荷运转", fontSize: 10, fill: "rgba(234,179,8,0.75)", align: "center", lineHeight: 16 },
        },
        {
          type: "text", left: "7%", bottom: "14%",
          style: { text: "低效低杠杆\n资本闲置", fontSize: 10, fill: "rgba(148,163,184,0.75)", align: "center", lineHeight: 16 },
        },
        {
          type: "text", right: "4%", bottom: "14%",
          style: { text: "低效高杠杆\n↓ 减配候选", fontSize: 10, fill: "rgba(239,68,68,0.75)", align: "center", lineHeight: 16 },
        },
        {
          type: "text", right: 8, top: 36,
          style: { text: "气泡大小 = 名义规模", fontSize: 9, fill: "#94a3b8" },
        },
      ],
      series,
    }
  }, [accounts, sectorColorMap])

  return (
    <Card className="h-full">
      <CardHeader className="pb-1 flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-sm font-medium">资本效率分析：保证金占用 vs 年化收益</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            X轴: 平均保证金占用率（保证金/权益）· Y轴: 年化收益率 · 气泡: 名义规模 · 虚线: 均值
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {WINDOW_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setWin(o.value)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                win === o.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-1">
        {loading ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            加载中…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center text-sm text-destructive" style={{ height }}>
            {error}
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            暂无数据
          </div>
        ) : (
          <ReactECharts
            key={`cap-eff-${win}-${accounts.length}`}
            option={option}
            style={{ height, width: "100%" }}
            notMerge
          />
        )}
      </CardContent>
    </Card>
  )
}
