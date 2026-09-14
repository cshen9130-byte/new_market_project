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

type Props = {
  monthly: MonthlyCpi[]
  meetings: Meeting[]
  height?: number
}

function symbolFor(action: Action): { symbol: string; rotate?: number } {
  if (action === "Hike") return { symbol: "triangle" }
  if (action === "Cut") return { symbol: "triangle", rotate: 180 }
  if (action === "Pending") return { symbol: "diamond" }
  return { symbol: "rect" }
}

export default function FomcCpiMomChart({ monthly, meetings, height = 340 }: Props) {
  const option = useMemo(() => {
    const pts = monthly
      .filter((d) => d.mom != null)
      .map((d) => ({
        t: toUtc(d.released),
        mom: d.mom as number,
        core: d.core,
      }))
    if (!pts.length) return {}

    const t0 = pts[0].t
    const t1 = Math.max(pts[pts.length - 1].t, toUtc("2026-09-16"))
    const vals = pts.flatMap((p) => [p.mom, p.core ?? p.mom])
    const yMin = Math.min(-0.5, ...vals) - 0.1
    const yMax = Math.max(0.6, ...vals) + 0.15
    const linePts = pts.map((p) => ({ t: p.t, v: p.mom }))

    const meetPts = meetings.filter((m) => {
      const t = toUtc(m.decision)
      return t >= t0 - 20 * 86400000 && t <= toUtc("2026-09-20")
    })
    const byAction: Record<Action, Meeting[]> = { Hike: [], Hold: [], Cut: [], Pending: [] }
    for (const m of meetPts) byAction[m.action].push(m)

    const series: Record<string, unknown>[] = [
      {
        name: "CPI 环比",
        type: "line",
        data: pts.map((p) => [p.t, p.mom]),
        showSymbol: false,
        lineStyle: { width: 2, color: "#4C72B0" },
        itemStyle: { color: "#4C72B0" },
        z: 3,
        markLine: {
          silent: true,
          symbol: "none",
          data: [
            {
              yAxis: 0.2,
              label: { formatter: "2% 年化", fontSize: 10, color: "#888" },
              lineStyle: { type: "dashed", color: "#999", width: 1.2 },
            },
          ],
        },
      },
      {
        name: "核心环比",
        type: "line",
        data: pts.filter((p) => p.core != null).map((p) => [p.t, p.core as number]),
        showSymbol: false,
        lineStyle: { width: 2, color: "#C44E52" },
        itemStyle: { color: "#C44E52" },
        z: 3,
      },
    ]

    for (const action of ["Hike", "Hold", "Cut", "Pending"] as Action[]) {
      const rows = byAction[action]
      if (!rows.length) continue
      const { symbol, rotate } = symbolFor(action)
      series.push({
        name: ACTION_LABEL[action],
        type: "scatter",
        data: rows.map((m) => ({
          value: [toUtc(m.decision), interpAt(toUtc(m.decision), linePts)],
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
            return `${m.decision}<br/>${decisionTag(m)}`
          },
        },
      })
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 48, right: 16, top: 28, bottom: 36 },
      tooltip: { trigger: "axis", valueFormatter: (v: number) => `${Number(v).toFixed(1)}%` },
      legend: { top: 0, right: 8, textStyle: { fontSize: 11 }, itemWidth: 14, itemHeight: 8 },
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
        name: "环比 (%)",
        nameTextStyle: { fontSize: 11, color: "#666" },
        axisLabel: { fontSize: 10, formatter: (v: number) => v.toFixed(1) },
        splitLine: { lineStyle: { color: "#eee" } },
      },
      series,
    }
  }, [monthly, meetings])

  return <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
}
