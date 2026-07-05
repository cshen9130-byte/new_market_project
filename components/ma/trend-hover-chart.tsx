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
  /** YYYY-MM-DD — vertical marker for due diligence date */
  markerDate?: string | null
}

function dateToMs(d: string): number {
  return new Date(`${d}T00:00:00`).getTime()
}

function getFundValueAtDate(series: TrendPoint[], date: string): number | null {
  if (series.length === 0) return null
  let best = series[0]
  for (const p of series) {
    if (p.d <= date) best = p
    else break
  }
  return best.v
}

export function TrendHoverChart({
  beian_hao,
  mode = "return",
  days = 90,
  markerDate = null,
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
  const chartMinDate = allDates[0]
  const chartMaxDate = allDates[allDates.length - 1]
  const axisMinDate =
    markerDate && markerDate < chartMinDate ? markerDate : chartMinDate
  const axisMaxDate =
    markerDate && markerDate > chartMaxDate ? markerDate : chartMaxDate
  const minDateMs = dateToMs(axisMinDate)
  const maxDateMs = dateToMs(axisMaxDate)
  const dateSpan = Math.max(maxDateMs - minDateMs, 1)
  const xScale = (d: string) =>
    PAD.l + ((dateToMs(d) - minDateMs) / dateSpan) * cW
  const yScale = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * cH

  const markerInRange = Boolean(markerDate && markerDate >= axisMinDate && markerDate <= axisMaxDate)
  const markerX = markerInRange && markerDate ? xScale(markerDate) : null
  const markerY =
    markerInRange && markerDate
      ? yScale(getFundValueAtDate(fundSeries, markerDate) ?? lo)
      : null

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
        {markerX != null && markerY != null && markerDate && (
          <g>
            <line
              x1={markerX}
              y1={PAD.t}
              x2={markerX}
              y2={PAD.t + cH}
              stroke="#2563eb"
              strokeWidth={1.5}
              strokeDasharray="4,3"
              strokeOpacity={0.85}
            />
            <circle
              cx={markerX}
              cy={markerY}
              r={3.5}
              fill="#2563eb"
              stroke="#fff"
              strokeWidth={1.5}
            />
            <text
              x={markerX}
              y={PAD.t - 2}
              textAnchor="middle"
              fontSize={9}
              fill="#2563eb"
              fontWeight={600}
            >
              尽调
            </text>
          </g>
        )}
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
