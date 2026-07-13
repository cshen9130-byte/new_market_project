"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type Point = {
  date: string
  crowding_pct: number | null
}

type IndexPoint = {
  date: string
  all_a_index: number | null
}

type Props = {
  series: Point[]
  indexSeries: IndexPoint[]
  latestDate?: string
  loading?: boolean
  error?: string | null
}

function expandingStats(values: (number | null)[]) {
  const mean: (number | null)[] = []
  const std: (number | null)[] = []
  const buf: number[] = []

  for (const v of values) {
    if (v == null) {
      mean.push(null)
      std.push(null)
      continue
    }
    buf.push(v)
    const m = buf.reduce((s, x) => s + x, 0) / buf.length
    const variance = buf.reduce((s, x) => s + (x - m) ** 2, 0) / buf.length
    mean.push(m)
    std.push(Math.sqrt(variance))
  }
  return { mean, std }
}

function detectSentimentBottoms(
  crowding: (number | null)[],
  mean: (number | null)[],
  std: (number | null)[],
): number[] {
  const idxs: number[] = []
  for (let i = 1; i < crowding.length - 1; i++) {
    const v = crowding[i]
    const m = mean[i]
    const s = std[i]
    if (v == null || m == null || s == null) continue
    const prev = crowding[i - 1]
    const next = crowding[i + 1]
    if (prev == null || next == null) continue
    const lower15 = m - 1.5 * s
    const isTrough = v <= prev && v <= next
    if (isTrough && v <= lower15) idxs.push(i)
  }
  return idxs
}

export default function AshareCrowdingSentimentChart({
  series,
  indexSeries,
  latestDate,
  loading,
  error,
}: Props) {
  const option = useMemo(() => {
    if (!series.length) return {}

    const dates = series.map((d) => d.date)
    const crowding = series.map((d) => d.crowding_pct)
    const indexByDate = new Map(indexSeries.map((d) => [d.date, d.all_a_index]))
    const allA = dates.map((d) => indexByDate.get(d) ?? null)

    const { mean, std } = expandingStats(crowding)
    const meanPlus1 = mean.map((m, i) => (m != null && std[i] != null ? m + std[i]! : null))
    const meanMinus1 = mean.map((m, i) => (m != null && std[i] != null ? m - std[i]! : null))
    const meanPlus15 = mean.map((m, i) => (m != null && std[i] != null ? m + 1.5 * std[i]! : null))
    const meanMinus15 = mean.map((m, i) => (m != null && std[i] != null ? m - 1.5 * std[i]! : null))

    const bottomIdxs = detectSentimentBottoms(crowding, mean, std)
    const bottomMarks = bottomIdxs.map((i) => ({
      value: [dates[i], crowding[i]],
      date: dates[i],
    }))

    const latestCrowding = crowding[crowding.length - 1]
    const latestMean = mean[mean.length - 1]
    const latestStd = std[std.length - 1]
    const isLatestBottom =
      latestCrowding != null
      && latestMean != null
      && latestStd != null
      && latestCrowding <= latestMean - 1.5 * latestStd

    return {
      backgroundColor: "transparent",
      title: isLatestBottom
        ? {
            text: "全A拥挤度指标再度提示短期情绪底部",
            subtext: latestDate ? `截至 ${latestDate}` : undefined,
            left: "center",
            top: 0,
            textStyle: { fontSize: 13, fontWeight: 600 },
            subtextStyle: { fontSize: 11 },
          }
        : undefined,
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ seriesName: string; value: number | [string, number]; axisValue?: string }>) => {
          const date = params[0]?.axisValue ?? ""
          const lines = params
            .filter((p) => p.value != null && p.seriesName !== "")
            .map((p) => {
              const val = Array.isArray(p.value) ? p.value[1] : p.value
              const suffix = p.seriesName.includes("全A") ? "" : "%"
              return `${p.seriesName}: ${typeof val === "number" ? val.toFixed(2) : val}${suffix}`
            })
          return [date, ...lines].join("<br/>")
        },
      },
      legend: {
        data: ["全A拥挤度指标", "均值", "均值±1倍标准差", "均值±1.5倍标准差", "全A", "情绪底部"],
        bottom: 0,
        textStyle: { fontSize: 10 },
        itemWidth: 18,
      },
      grid: { left: 52, right: 52, top: isLatestBottom ? 48 : 28, bottom: 56 },
      xAxis: {
        type: "category",
        data: dates,
        axisLabel: { fontSize: 10, formatter: (v: string) => v.slice(0, 7) },
      },
      yAxis: [
        {
          type: "value",
          name: "拥挤度 (%)",
          min: 0,
          max: 100,
          axisLabel: { fontSize: 10 },
          splitLine: { lineStyle: { opacity: 0.15 } },
        },
        {
          type: "value",
          name: "全A",
          scale: true,
          axisLabel: { fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "均值±1.5倍标准差",
          type: "line",
          data: meanPlus15,
          symbol: "none",
          lineStyle: { type: "dashed", width: 1, color: "#93c5fd", opacity: 0.8 },
          itemStyle: { color: "#93c5fd" },
          z: 1,
        },
        {
          name: "均值±1.5倍标准差",
          type: "line",
          data: meanMinus15,
          symbol: "none",
          lineStyle: { type: "dashed", width: 1, color: "#93c5fd", opacity: 0.8 },
          itemStyle: { color: "#93c5fd" },
          z: 1,
        },
        {
          name: "均值±1倍标准差",
          type: "line",
          data: meanPlus1,
          symbol: "none",
          lineStyle: { type: "dashed", width: 1, color: "#9ca3af", opacity: 0.9 },
          itemStyle: { color: "#9ca3af" },
          z: 2,
        },
        {
          name: "均值±1倍标准差",
          type: "line",
          data: meanMinus1,
          symbol: "none",
          lineStyle: { type: "dashed", width: 1, color: "#9ca3af", opacity: 0.9 },
          itemStyle: { color: "#9ca3af" },
          z: 2,
        },
        {
          name: "均值",
          type: "line",
          data: mean,
          symbol: "none",
          lineStyle: { type: "dashed", width: 1.5, color: "#6b7280" },
          itemStyle: { color: "#6b7280" },
          z: 3,
        },
        {
          name: "全A拥挤度指标",
          type: "line",
          data: crowding,
          symbol: "none",
          smooth: true,
          lineStyle: { width: 2.5, color: "#1e3a8a" },
          itemStyle: { color: "#1e3a8a" },
          z: 5,
        },
        {
          name: "全A",
          type: "line",
          yAxisIndex: 1,
          data: allA,
          symbol: "none",
          smooth: true,
          lineStyle: { width: 2, color: "#dc2626" },
          itemStyle: { color: "#dc2626" },
          z: 4,
        },
        {
          name: "情绪底部",
          type: "scatter",
          data: bottomMarks.map((m) => m.value),
          symbolSize: 14,
          itemStyle: { color: "rgba(244, 114, 182, 0.55)", borderColor: "#ec4899", borderWidth: 2 },
          z: 6,
          tooltip: {
            formatter: (p: { data: [string, number] }) =>
              `${p.data[0]}<br/>情绪底部信号<br/>拥挤度: ${p.data[1]?.toFixed(1)}%`,
          },
        },
      ],
    }
  }, [series, indexSeries, latestDate])

  return (
    <Card>
      <CardHeader>
        <CardTitle>全A拥挤度 vs 全A走势</CardTitle>
        <CardDescription>
          拥挤度（左轴，250 日换手率分位 + 20 日平滑）叠加均值与标准差通道；红色为全 A 价格指数（首日=5000，链式收益合成）；粉色标记为拥挤度跌破均值-1.5σ的局部低点
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground">加载中...</div>
        ) : error ? (
          <div className="h-[420px] flex items-center justify-center text-sm text-destructive">{error}</div>
        ) : !series.length ? (
          <div className="h-[420px] flex items-center justify-center text-sm text-muted-foreground">暂无数据</div>
        ) : (
          <ReactECharts option={option} style={{ height: "420px", width: "100%" }} notMerge />
        )}
      </CardContent>
    </Card>
  )
}
