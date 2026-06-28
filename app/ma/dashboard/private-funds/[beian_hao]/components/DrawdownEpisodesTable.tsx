"use client"

import { memo, useMemo, useState } from "react"
import { HelpCircle } from "lucide-react"
import { GREEN, RED, getNavFieldValue, type NavRow, type BenchmarkPoint } from "./shared"
import { buildAlignedBenchmarkValues, prepareNavRowsForChart } from "./performanceChartUtils"

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

  if (episodes.length === 0) return null

  return (
    <div className="mt-5">
      <div className="flex items-center justify-end mb-2">
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
      <div className="overflow-x-auto rounded-lg border border-zinc-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-100">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500 w-16">序号</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">最大回撤</th>
              <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">
                <span className="inline-flex items-center justify-center gap-1">
                  最大回撤回补期（天）
                  <HelpCircle className="h-3.5 w-3.5 text-zinc-400" title="从回撤低点到净值恢复至前高所需的天数" />
                </span>
              </th>
              {hasBenchmark && (
                <th className="px-4 py-2.5 text-center text-xs font-medium text-zinc-500">
                  <span className="inline-flex items-center justify-center gap-1">
                    同期{benchmarkLabel}（基准）收益
                    <HelpCircle className="h-3.5 w-3.5 text-zinc-400" title="基准在相同回撤区间（前高至低点）的收益率" />
                  </span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {episodes.map((ep, idx) => (
              <tr key={`${ep.peakDate}-${ep.troughDate}`} className="border-b border-zinc-50 last:border-0">
                <td className="px-4 py-2.5 text-xs text-zinc-700">{idx + 1}</td>
                <td className="px-4 py-2.5 text-center text-xs tabular-nums">
                  <div className="text-zinc-900 font-medium">{(ep.maxDrawdown * 100).toFixed(2)}%</div>
                  <div className={`text-[11px] text-zinc-400 mt-0.5 min-h-[1rem] ${showRange ? "" : "invisible"}`}>
                    {ep.peakDate} ~ {ep.troughDate}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-center text-xs text-zinc-700 tabular-nums">
                  <div>{ep.recoveryDays === null ? "未回补" : ep.recoveryDays}</div>
                  {ep.recoveryDate && (
                    <div className={`text-[11px] text-zinc-400 mt-0.5 min-h-[1rem] ${showRange ? "" : "invisible"}`}>
                      {ep.troughDate} ~ {ep.recoveryDate}
                    </div>
                  )}
                </td>
                {hasBenchmark && (
                  <td className="px-4 py-2.5 text-center text-xs tabular-nums">
                    {ep.benchReturn === null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <>
                        <div className="font-medium" style={{ color: ep.benchReturn < 0 ? GREEN : ep.benchReturn > 0 ? RED : undefined }}>
                          {(ep.benchReturn >= 0 ? "+" : "") + (ep.benchReturn * 100).toFixed(2)}%
                        </div>
                        <div className={`text-[11px] text-zinc-400 mt-0.5 min-h-[1rem] ${showRange ? "" : "invisible"}`}>
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
      </div>
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
