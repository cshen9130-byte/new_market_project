"use client"

import { memo, useState, useMemo } from "react"
import { ChevronDown } from "lucide-react"
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Legend, ResponsiveContainer,
} from "recharts"
import { ANNUAL_METRIC_COLUMNS, type MetricKey } from "@/lib/fund-nav-metrics"
import { type PeerYearlyRow } from "./shared"

const RADAR_METRIC_KEYS: MetricKey[] = ["periodRet", "annVol", "sharpe", "calmar", "maxDD"]
const ANNUAL_RADAR_METRICS = ANNUAL_METRIC_COLUMNS.filter((c) =>
  (RADAR_METRIC_KEYS as string[]).includes(c.key),
)
const YEAR_RADAR_COLORS = ["#ef4444", "#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2"]

function peerHasRadarRanks(peer: PeerYearlyRow): boolean {
  return ANNUAL_RADAR_METRICS.some((c) => peer.rank[c.key as MetricKey] !== null)
}

function radarScore(rank: number, sampleN: number): number {
  if (sampleN <= 0) return 0
  return +((1 - (rank - 1) / sampleN) * 100).toFixed(2)
}

export const AnnualRankRadarPanel = memo(function AnnualRankRadarPanel({
  peerByYear,
}: {
  peerByYear: Map<number, PeerYearlyRow>
}) {
  const INITIAL_YEARS = 2
  const [expanded, setExpanded] = useState(false)

  const rankedYears = useMemo(
    () => [...peerByYear.entries()]
      .filter(([, peer]) => peerHasRadarRanks(peer))
      .sort((a, b) => b[0] - a[0]),
    [peerByYear],
  )

  const visibleYears = useMemo(
    () => (expanded ? rankedYears : rankedYears.slice(0, INITIAL_YEARS)),
    [rankedYears, expanded],
  )
  const hasMore = rankedYears.length > INITIAL_YEARS

  const radarData = useMemo(() => {
    return ANNUAL_RADAR_METRICS.map((col) => {
      const row: Record<string, string | number> = { metric: col.label }
      for (const [year, peer] of visibleYears) {
        const rank = peer.rank[col.key as MetricKey]
        if (rank !== null) row[`y${year}`] = radarScore(rank, peer.sample_n)
      }
      return row
    })
  }, [visibleYears])

  if (!rankedYears.length) return null

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-col lg:flex-row gap-6 items-stretch">
        <div className="flex-1 min-w-0">
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="72%">
                <PolarGrid stroke="#e4e4e7" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "#71717a" }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#a1a1aa" }} axisLine={false} tickCount={5} />
                {visibleYears.map(([year], i) => (
                  <Radar
                    key={year}
                    name={`${year}年`}
                    dataKey={`y${year}`}
                    stroke={YEAR_RADAR_COLORS[i % YEAR_RADAR_COLORS.length]}
                    fill={YEAR_RADAR_COLORS[i % YEAR_RADAR_COLORS.length]}
                    fillOpacity={0.12}
                    strokeWidth={1.5}
                    dot={{ r: 2.5 }}
                    isAnimationActive={false}
                  />
                ))}
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "#71717a" }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="overflow-x-auto rounded-lg border border-zinc-100 flex-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-100">
                  <th className="px-4 py-2.5 text-left font-medium text-zinc-500">指标</th>
                  {visibleYears.map(([year]) => (
                    <th key={year} className="px-4 py-2.5 text-center font-medium text-zinc-500 whitespace-nowrap">{year}年排名</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ANNUAL_RADAR_METRICS.map((col) => (
                  <tr key={col.key} className="border-b border-zinc-50 last:border-0">
                    <td className="px-4 py-2.5 text-zinc-700">{col.label}</td>
                    {visibleYears.map(([year, peer]) => {
                      const rank = peer.rank[col.key as MetricKey]
                      return (
                        <td key={year} className="px-4 py-2.5 text-center tabular-nums text-zinc-600">
                          {rank !== null ? `${rank}/${peer.sample_n}` : "—"}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {hasMore && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full inline-flex items-center justify-center gap-1 text-xs text-blue-500 hover:text-blue-600 transition-colors py-1">
          {expanded ? "收起" : "展开更多"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  )
})
AnnualRankRadarPanel.displayName = "AnnualRankRadarPanel"
