"use client"

import { useEffect, useState } from "react"

interface TrendPoint {
  d: string
  v: number
}

interface TrendData {
  fund: TrendPoint[]
  bench: TrendPoint[]
  name: string
}

type TrendHoverChartProps = {
  beian_hao: string
  /** "return" = cumulative return %; "nav" = unit NAV */
  mode?: "return" | "nav"
  days?: number
}

export function TrendHoverChart({
  beian_hao,
  mode = "return",
  days = 90,
}: TrendHoverChartProps) {
  const [data, setData] = useState<TrendData | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    const params = new URLSearchParams({
      beian_hao,
      days: String(days),
      mode,
    })
    fetch(`/ma/api/tracking-funds/chart-preview?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [beian_hao, mode, days])

  const W = 340
  const H = 160
  const PAD = { t: 12, r: 12, b: 28, l: 40 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b

  if (!data) {
    return (
      <div className="flex h-[160px] w-[340px] items-center justify-center text-xs text-muted-foreground">
        加载中…
      </div>
    )
  }

  const { fund, bench, name } = data
  const fundSeries = Array.isArray(fund) ? fund : []
  const benchSeries = mode === "return" && Array.isArray(bench) ? bench : []
  if (fundSeries.length < 2) {
    return (
      <div className="flex h-[160px] w-[340px] items-center justify-center text-xs text-muted-foreground">
        暂无净值数据
      </div>
    )
  }

  const allVals = [...fundSeries.map((p) => p.v), ...benchSeries.map((p) => p.v)]
  const minV = Math.min(...allVals)
  const maxV = Math.max(...allVals)
  const pad = (maxV - minV) * 0.12 || (mode === "nav" ? 0.01 : 1)
  const lo = minV - pad
  const hi = maxV + pad

  const allDates = Array.from(
    new Set([...fundSeries.map((p) => p.d), ...benchSeries.map((p) => p.d)]),
  ).sort()
  const xScale = (d: string) =>
    PAD.l + (allDates.indexOf(d) / Math.max(allDates.length - 1, 1)) * cW
  const yScale = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * cH

  const toPath = (pts: TrendPoint[]) =>
    pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.d).toFixed(1)},${yScale(p.v).toFixed(1)}`)
      .join(" ")

  const tickCount = 5
  const yTicks = Array.from({ length: tickCount }, (_, i) => lo + (hi - lo) * (i / (tickCount - 1)))

  const xTickIndices = [
    0,
    Math.floor(allDates.length * 0.33),
    Math.floor(allDates.length * 0.66),
    allDates.length - 1,
  ].filter((v, i, a) => a.indexOf(v) === i)

  const fmtDate = (d: string) => {
    const [, m, day] = d.split("-")
    return `${parseInt(m, 10)}月${parseInt(day, 10)}`
  }

  const fmtY = (v: number) =>
    mode === "nav" ? v.toFixed(v >= 10 ? 2 : 4) : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`

  const fundColor = "#ef4444"
  const benchColor = "#3b82f6"

  return (
    <div className="w-[340px]">
      <div className="flex items-center gap-3 px-3 pb-1 pt-2 text-xs">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-5 rounded bg-red-500" />
          {name}
        </span>
        {benchSeries.length >= 2 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-5 rounded bg-blue-500" />
            沪深300
          </span>
        )}
      </div>
      <svg width={W} height={H} className="overflow-visible">
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              y1={yScale(v)}
              x2={PAD.l + cW}
              y2={yScale(v)}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeWidth={1}
            />
            <text
              x={PAD.l - 4}
              y={yScale(v)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={9}
              fill="currentColor"
              opacity={0.5}
            >
              {fmtY(v)}
            </text>
          </g>
        ))}
        {mode === "return" && (
          <line
            x1={PAD.l}
            y1={yScale(0)}
            x2={PAD.l + cW}
            y2={yScale(0)}
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={1}
            strokeDasharray="3,3"
          />
        )}
        {benchSeries.length >= 2 && (
          <path
            d={toPath(benchSeries)}
            fill="none"
            stroke={benchColor}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        )}
        <path
          d={toPath(fundSeries)}
          fill="none"
          stroke={fundColor}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {xTickIndices.map((i) => (
          <text
            key={i}
            x={xScale(allDates[i])}
            y={H - 6}
            textAnchor="middle"
            fontSize={9}
            fill="currentColor"
            opacity={0.5}
          >
            {fmtDate(allDates[i])}
          </text>
        ))}
      </svg>
    </div>
  )
}
