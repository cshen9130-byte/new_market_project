"use client"

import { useState } from "react"
import ReactECharts from "echarts-for-react"
import { RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export interface EquityPoint {
  date: string
  cumPnl: number
}

export interface EquitySeries {
  account: string
  data: EquityPoint[]
}

interface Props {
  series: EquitySeries[]
  loading: boolean
  error: string | null
  height?: number
}

const LINE_COLOR = "#3b82f6"

function fmtNum(v: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v)
}

export default function EquityCurveChart({ series, loading, error, height = 420 }: Props) {
  const [selectedAccount, setSelectedAccount] = useState<string>("")

  // Derive the active account: use selectedAccount if it's in the current series,
  // otherwise fall back to the first account available
  const resolvedAccount =
    selectedAccount && series.find((s) => s.account === selectedAccount)
      ? selectedAccount
      : series[0]?.account ?? ""

  const activeSeries = series.find((s) => s.account === resolvedAccount) ?? null

  const header = (
    <CardHeader className="pb-2 pt-4 px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-sm font-medium">
          盘手收益曲线（{resolvedAccount.toUpperCase()}）
        </CardTitle>
        {series.length > 0 && (
          <select
            value={resolvedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="rounded border border-input bg-background px-2 py-0.5 text-xs w-28"
          >
            {series.map((s) => (
              <option key={s.account} value={s.account}>
                {s.account.toUpperCase()}
              </option>
            ))}
          </select>
        )}
      </div>
    </CardHeader>
  )

  if (loading) {
    return (
      <Card>
        {header}
        <CardContent className="px-4 pb-4">
          <div className="flex items-center justify-center text-muted-foreground" style={{ height }}>
            <RefreshCw className="h-5 w-5 animate-spin" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        {header}
        <CardContent className="px-4 pb-4">
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!activeSeries) {
    return (
      <Card>
        {header}
        <CardContent className="px-4 pb-4">
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            所选日期范围内无数据。
          </div>
        </CardContent>
      </Card>
    )
  }

  const option = {
    animation: false,
    grid: { top: 16, right: 24, bottom: 56, left: 80 },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ axisValue: string; value: [string, number]; color: string }>) => {
        const date = params[0]?.axisValue ?? ""
        const p = params[0]
        if (!p) return date
        const val = p.value?.[1] ?? 0
        const sign = val >= 0 ? "+" : ""
        return `${date}<br/><span style="display:inline-block;margin-right:5px;border-radius:2px;width:10px;height:10px;background:${p.color}"></span>${resolvedAccount}: <b>${sign}${fmtNum(val)}</b>`
      },
    },
    xAxis: {
      type: "time",
      axisLabel: { fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: 11,
        formatter: (v: number) => {
          if (Math.abs(v) >= 10000) return (v / 10000).toFixed(0) + "万"
          return v.toString()
        },
      },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.4 } },
    },
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      { type: "slider", bottom: 28, height: 18, start: 0, end: 100 },
    ],
    series: [{
      name: resolvedAccount,
      type: "line",
      smooth: false,
      symbol: "none",
      lineStyle: { width: 2, color: LINE_COLOR },
      itemStyle: { color: LINE_COLOR },
      areaStyle: { color: LINE_COLOR, opacity: 0.08 },
      data: activeSeries.data.map((d) => [d.date, d.cumPnl]),
    }],
  }

  return (
    <Card>
      {header}
      <CardContent className="px-4 pb-4">
        <ReactECharts option={option} style={{ height }} notMerge />
      </CardContent>
    </Card>
  )
}
