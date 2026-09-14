"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import {
  ACTION_COLOR,
  ACTION_LABEL,
  decisionTag,
  interpAt,
  toUtc,
  type Action,
  type Meeting,
  type MonthlyCpi,
} from "@/lib/ma/fomc-cpi"

type Overlay = {
  name: string
  color: string
  monthly: MonthlyCpi[]
}

type Props = {
  monthly: MonthlyCpi[]
  meetings: Meeting[]
  yMin: number
  yMax: number
  valueLabel: string
  height?: number
  showForecast?: boolean
  seriesName?: string
  lineColor?: string
  referenceLines?: { value: number; label: string }[]
  overlays?: Overlay[]
}

function symbolFor(action: Action): { symbol: string; rotate?: number } {
  if (action === "Hike") return { symbol: "triangle" }
  if (action === "Cut") return { symbol: "triangle", rotate: 180 }
  if (action === "Pending") return { symbol: "diamond" }
  return { symbol: "rect" }
}

export default function FomcCpiMarkedChart({
  monthly,
  meetings,
  yMin,
  yMax,
  valueLabel,
  height = 380,
  showForecast = true,
  seriesName = "实际",
  lineColor = "#C44E52",
  referenceLines = [],
  overlays = [],
}: Props) {
  const option = useMemo(() => {
    if (!monthly.length) return {}

    const actualPts = monthly.map((d) => ({ t: toUtc(d.released), v: d.actual }))
    const forecastPts = monthly
      .filter((d) => d.forecast != null)
      .map((d) => [toUtc(d.released), d.forecast as number] as [number, number])

    const t0 = actualPts[0].t
    const t1 = Math.max(actualPts[actualPts.length - 1].t, toUtc("2026-09-16"))
    const meetPts = meetings.filter((m) => {
      const t = toUtc(m.decision)
      return t >= t0 - 20 * 86400000 && t <= toUtc("2026-09-20")
    })

    const byAction: Record<Action, Meeting[]> = { Hike: [], Hold: [], Cut: [], Pending: [] }
    for (const m of meetPts) byAction[m.action].push(m)

    const series: Record<string, unknown>[] = [
      {
        name: seriesName,
        type: "line",
        data: actualPts.map((p) => [p.t, p.v]),
        showSymbol: false,
        lineStyle: { width: 2, color: lineColor },
        itemStyle: { color: lineColor },
        z: 3,
        markLine: referenceLines.length
          ? {
              silent: true,
              symbol: "none",
              data: referenceLines.map((r) => ({
                yAxis: r.value,
                label: { formatter: r.label, fontSize: 10, color: "#888" },
                lineStyle: { type: "dashed", color: "#999", width: 1.2 },
              })),
            }
          : undefined,
      },
    ]

    if (showForecast && forecastPts.length) {
      series.push({
        name: "预测",
        type: "line",
        data: forecastPts,
        showSymbol: false,
        lineStyle: { width: 1.5, type: "dashed", color: "#4C72B0" },
        itemStyle: { color: "#4C72B0" },
        z: 2,
      })
    }

    for (const overlay of overlays) {
      series.push({
        name: overlay.name,
        type: "line",
        data: overlay.monthly.map((d) => [toUtc(d.released), d.actual]),
        showSymbol: false,
        lineStyle: { width: 2, color: overlay.color },
        itemStyle: { color: overlay.color },
        z: 2,
      })
    }

    for (const action of ["Hike", "Hold", "Cut", "Pending"] as Action[]) {
      const rows = byAction[action]
      if (!rows.length) continue
      const { symbol, rotate } = symbolFor(action)
      series.push({
        name: ACTION_LABEL[action],
        type: "scatter",
        data: rows.map((m) => ({
          value: [toUtc(m.decision), interpAt(toUtc(m.decision), actualPts)],
          meeting: m,
        })),
        symbol,
        symbolRotate: rotate,
        symbolSize: action === "Hold" ? 7 : 10,
        itemStyle: { color: ACTION_COLOR[action], borderColor: "#fff", borderWidth: 1 },
        z: 5,
        tooltip: {
          formatter: (p: { data: { meeting: Meeting } }) => {
            const m = p.data.meeting
            const extra = m.fundsHi != null ? `<br/>联邦基金上限: ${m.fundsHi.toFixed(2)}%` : ""
            const note = m.note ? `<br/>${m.note}` : ""
            return `${m.decision}<br/>${decisionTag(m)}${extra}${note}`
          },
        },
      })
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 48, right: 16, top: 28, bottom: 36 },
      tooltip: { trigger: "axis" },
      legend: {
        top: 0,
        right: 8,
        textStyle: { fontSize: 11 },
        itemWidth: 14,
        itemHeight: 8,
      },
      xAxis: {
        type: "time",
        min: t0,
        max: t1,
        axisLabel: { fontSize: 10, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: yMin,
        max: yMax,
        name: valueLabel,
        nameTextStyle: { fontSize: 11, color: "#666" },
        axisLabel: { fontSize: 10, formatter: (v: number) => v.toFixed(1) },
        splitLine: { lineStyle: { color: "#eee" } },
      },
      series,
    }
  }, [monthly, meetings, yMin, yMax, valueLabel, showForecast, seriesName, lineColor, referenceLines, overlays])

  return <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
}
