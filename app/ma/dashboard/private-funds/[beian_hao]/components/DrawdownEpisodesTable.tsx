"use client"

import { memo, useMemo, useState, type ReactNode } from "react"
import { HelpCircle } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { GREEN, RED, getNavFieldValue, type NavRow, type BenchmarkPoint } from "./shared"
import { buildAlignedBenchmarkValues, prepareNavRowsForChart } from "./performanceChartUtils"

function HeaderHelp({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex text-zinc-400 hover:text-zinc-700 transition-colors"
          aria-label={`${label}说明`}
          onClick={(e) => e.stopPropagation()}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 p-3 text-xs leading-relaxed text-zinc-600">
        <div className="font-semibold text-zinc-800 mb-1.5">{label}</div>
        <div className="space-y-1.5">{children}</div>
      </PopoverContent>
    </Popover>
  )
}

export interface DrawdownEpisode {
  peakIdx: number
  troughIdx: number
  recoveryIdx: number | null
  maxDrawdown: number
  peakDate: string
  troughDate: string
  recoveryDate: string | null
  peakValue: number
}

export interface DrawdownEpisodeRow extends DrawdownEpisode {
  recoveryDays: number | null
  benchReturn: number | null
}

export function findNearestDrawdownPoint<T extends { date: string }>(
  data: T[],
  targetDate: string,
): T | null {
  if (!data.length) return null
  const exact = data.find((d) => d.date === targetDate)
  if (exact) return exact
  const targetTs = new Date(targetDate).getTime()
  let best = data[0]
  let bestDiff = Math.abs(new Date(best.date).getTime() - targetTs)
  for (let i = 1; i < data.length; i++) {
    const diff = Math.abs(new Date(data[i].date).getTime() - targetTs)
    if (diff < bestDiff) {
      best = data[i]
      bestDiff = diff
    }
  }
  return best
}

export type DrawdownEpisodeMark = { date: string; y: number; no: number }

/** Map 回撤区间 trough dates onto any chart series (drawdown / return / nav). */
export function buildDrawdownEpisodeMarks<T extends { date: string }>(
  data: T[],
  episodes: Array<{ troughDate: string }>,
  getY: (point: T) => number | null | undefined,
): DrawdownEpisodeMark[] {
  return episodes.flatMap((ep, idx) => {
    const point = findNearestDrawdownPoint(data, ep.troughDate)
    if (!point) return []
    const y = getY(point)
    if (y === null || y === undefined || !Number.isFinite(y)) return []
    return [{ date: point.date, y, no: idx + 1 }]
  })
}

export function DrawdownEpisodeMarkLabel({
  viewBox,
  value,
}: {
  viewBox?: { x?: number; y?: number }
  value?: number | string
}) {
  const x = viewBox?.x ?? 0
  const y = viewBox?.y ?? 0
  return (
    <g transform={`translate(${x}, ${y})`} style={{ pointerEvents: "none" }}>
      <circle r={12} fill="#ffffff" stroke="#dc2626" strokeWidth={2.5} />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill="#dc2626"
        fontSize={13}
        fontWeight={800}
        style={{ fontFamily: "system-ui, sans-serif" }}
      >
        {value}
      </text>
    </g>
  )
}

export function computeDrawdownEpisodes(rows: NavRow[], navType: string): DrawdownEpisode[] {
  if (rows.length < 2) return []

  const dates = rows.map((r) => r.price_date)
  const values = rows.map((r) => getNavFieldValue(r, navType))
  const episodes: DrawdownEpisode[] = []

  let peakIdx = 0
  let peakVal = values[0]
  let inEpisode = false
  let troughIdx = 0
  let maxDD = 0

  for (let i = 1; i < values.length; i++) {
    const v = values[i]
    if (v >= peakVal) {
      if (inEpisode && maxDD > 0) {
        episodes.push({
          peakIdx,
          troughIdx,
          recoveryIdx: i,
          maxDrawdown: maxDD,
          peakDate: dates[peakIdx],
          troughDate: dates[troughIdx],
          recoveryDate: dates[i],
          peakValue: peakVal,
        })
      }
      peakIdx = i
      peakVal = v
      inEpisode = false
      maxDD = 0
    } else {
      inEpisode = true
      const dd = peakVal > 0 ? (peakVal - v) / peakVal : 0
      if (dd > maxDD) {
        maxDD = dd
        troughIdx = i
      }
    }
  }

  if (inEpisode && maxDD > 0) {
    episodes.push({
      peakIdx,
      troughIdx,
      recoveryIdx: null,
      maxDrawdown: maxDD,
      peakDate: dates[peakIdx],
      troughDate: dates[troughIdx],
      recoveryDate: null,
      peakValue: peakVal,
    })
  }

  return episodes.sort((a, b) => b.maxDrawdown - a.maxDrawdown).slice(0, 5)
}

export function buildDrawdownEpisodeRows(
  rows: NavRow[],
  navType: string,
  hasBenchmark: boolean,
  benchmarkSeries: BenchmarkPoint[],
): DrawdownEpisodeRow[] {
  if (rows.length < 2) return []

  const prepared = prepareNavRowsForChart(rows)
  const episodes = computeDrawdownEpisodes(prepared, navType)
  const benchValues = hasBenchmark && benchmarkSeries.length
    ? buildAlignedBenchmarkValues(prepared, benchmarkSeries, "nav", navType)
    : prepared.map(() => null)
  const dateTs = prepared.map((r) => new Date(r.price_date).getTime())

  return episodes.map((ep) => {
    const recoveryDays = ep.recoveryIdx !== null
      ? Math.round((dateTs[ep.recoveryIdx] - dateTs[ep.troughIdx]) / 86400000)
      : null

    const benchPeak = benchValues[ep.peakIdx]
    const benchTrough = benchValues[ep.troughIdx]
    const benchReturn = benchPeak !== null && benchTrough !== null && benchPeak > 0
      ? benchTrough / benchPeak - 1
      : null

    return { ...ep, recoveryDays, benchReturn }
  })
}

export const DrawdownEpisodesTable = memo(function DrawdownEpisodesTable({
  episodes,
  benchmarkLabel,
  hasBenchmark,
}: {
  episodes: DrawdownEpisodeRow[]
  benchmarkLabel: string
  hasBenchmark: boolean
}) {
  const [showRange, setShowRange] = useState(false)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div className="text-sm font-semibold text-zinc-700">回撤区间</div>
        <button
          type="button"
          onClick={() => setShowRange((v) => !v)}
          className="inline-flex items-center gap-1.5 select-none text-xs text-zinc-600 hover:text-zinc-900 transition-colors"
        >
          <span
            aria-hidden="true"
            className={[
              "inline-flex h-3.5 w-3.5 items-center justify-center rounded border",
              showRange ? "border-zinc-700 bg-zinc-700" : "border-zinc-300 bg-white",
            ].join(" ")}
          >
            {showRange && (
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 6l3 3 5-5" />
              </svg>
            )}
          </span>
          显示区间
        </button>
      </div>
      <div className="overflow-y-auto flex-1 rounded-lg border border-zinc-100">
        {episodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-zinc-400 py-8">暂无回撤区间</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="px-2 py-2 text-left text-xs font-medium text-zinc-500 whitespace-nowrap">序号</th>
                <th className="px-2 py-2 text-right text-xs font-medium text-zinc-500 whitespace-nowrap">最大回撤</th>
                <th className="px-2 py-2 text-right text-xs font-medium text-zinc-500 whitespace-nowrap">
                  <span className="inline-flex items-center justify-end gap-1">
                    回补期（天）
                    <HeaderHelp label="最大回撤回补期（天）">
                      <p>
                        从该次回撤的最低点日期起，到净值重新回到或超过该次回撤前高所需的自然日天数。
                      </p>
                      <p>
                        若截至当前区间终点仍未回到前高，则显示「未回补」。
                      </p>
                    </HeaderHelp>
                  </span>
                </th>
                {hasBenchmark && (
                  <th className="px-2 py-2 text-right text-xs font-medium text-zinc-500 whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-1">
                      {benchmarkLabel}
                      <HeaderHelp label={`同期${benchmarkLabel}（基准）收益`}>
                        <p>
                          取基金该次回撤对应的前高日到低点日，计算基准在同一区间的收益率：
                        </p>
                        <p className="rounded bg-zinc-50 px-2 py-1.5 font-mono text-[11px] text-zinc-700">
                          (低点日基准 − 前高日基准) / 前高日基准
                        </p>
                        <p>
                          用于对比基金回撤期间基准同期表现。
                        </p>
                      </HeaderHelp>
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {episodes.map((ep, idx) => (
                <tr key={`${ep.peakDate}-${ep.troughDate}`} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/60">
                  <td className="px-2 py-2 text-xs text-zinc-700 whitespace-nowrap">{idx + 1}</td>
                  <td className="px-2 py-2 text-right text-xs tabular-nums whitespace-nowrap">
                    <div className="text-zinc-900 font-medium">{(ep.maxDrawdown * 100).toFixed(2)}%</div>
                    <div className={`text-[10px] text-zinc-400 mt-0.5 min-h-[0.875rem] ${showRange ? "" : "invisible"}`}>
                      {ep.peakDate} ~ {ep.troughDate}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right text-xs text-zinc-700 tabular-nums whitespace-nowrap">
                    <div>{ep.recoveryDays === null ? "未回补" : ep.recoveryDays}</div>
                    {ep.recoveryDate && (
                      <div className={`text-[10px] text-zinc-400 mt-0.5 min-h-[0.875rem] ${showRange ? "" : "invisible"}`}>
                        {ep.troughDate} ~ {ep.recoveryDate}
                      </div>
                    )}
                  </td>
                  {hasBenchmark && (
                    <td className="px-2 py-2 text-right text-xs tabular-nums whitespace-nowrap">
                      {ep.benchReturn === null ? (
                        <span className="text-zinc-400">—</span>
                      ) : (
                        <>
                          <div className="font-medium" style={{ color: ep.benchReturn < 0 ? GREEN : ep.benchReturn > 0 ? RED : undefined }}>
                            {(ep.benchReturn >= 0 ? "+" : "") + (ep.benchReturn * 100).toFixed(2)}%
                          </div>
                          <div className={`text-[10px] text-zinc-400 mt-0.5 min-h-[0.875rem] ${showRange ? "" : "invisible"}`}>
                            {ep.peakDate} ~ {ep.troughDate}
                          </div>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="text-[11px] text-zinc-400 mt-2 text-right flex-shrink-0">共 {episodes.length} 条</div>
    </div>
  )
})
DrawdownEpisodesTable.displayName = "DrawdownEpisodesTable"

export function useDrawdownEpisodeRows(
  rows: NavRow[],
  navType: string,
  hasBenchmark: boolean,
  benchmarkSeries: BenchmarkPoint[],
): DrawdownEpisodeRow[] {
  return useMemo(
    () => buildDrawdownEpisodeRows(rows, navType, hasBenchmark, benchmarkSeries),
    [rows, navType, hasBenchmark, benchmarkSeries],
  )
}
