"use client"

import { memo, useMemo } from "react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { RED, type PeerMonthlyRow } from "./shared"

interface RankPoint {
  ym:    string
  pct:   number
  rank:  number
  total: number
}

function RankPercentileTooltip({
  active, payload, label,
}: {
  active?: boolean
  payload?: Array<{ value?: number; payload?: RankPoint }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload!
  return (
    <div className="bg-white border border-zinc-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="font-semibold text-zinc-700 mb-1">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="text-zinc-500">排名分位：</span>
        <span className="tabular-nums font-medium" style={{ color: RED }}>{d.pct.toFixed(2)}%</span>
      </div>
      <div className="text-zinc-400 mt-0.5 tabular-nums">{d.rank} / {d.total}</div>
    </div>
  )
}

export const RankPercentileTrendChart = memo(function RankPercentileTrendChart({
  peerMonthly, dateRangeLabel,
}: {
  peerMonthly: PeerMonthlyRow[]
  dateRangeLabel: string
}) {
  const chartData = useMemo((): RankPoint[] =>
    peerMonthly
      .filter((r) => r.rank_num !== null && r.sample_n > 0)
      .map((r) => ({
        ym:    r.ym,
        pct:   +((r.rank_num! - 1) / r.sample_n * 100).toFixed(2),
        rank:  r.rank_num!,
        total: r.sample_n,
      })),
  [peerMonthly])

  if (!chartData.length) return null

  const firstYm = chartData[0].ym
  const lastYm  = chartData[chartData.length - 1].ym
  const rangeLabel = dateRangeLabel || `${firstYm} ~ ${lastYm}`

  function exportCsv() {
    const bom = "\uFEFF"
    const headers = ["月份", "排名分位", "排名", "样本数"]
    const lines = chartData.map((d) => [d.ym, d.pct.toFixed(2) + "%", d.rank, d.total].join(","))
    const blob = new Blob([bom + [headers.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = "排名分位走势.csv"; a.click()
    URL.revokeObjectURL(url)
  }

  const Y_TICKS = [0, 20, 40, 60, 80, 100]

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            区间收益排名分位走势
          </div>
          <div className="text-xs text-zinc-400 mt-1">统计区间：{rangeLabel}&nbsp;&nbsp;排名周期：月度</div>
        </div>
        <button type="button" onClick={exportCsv} title="导出CSV"
          className="p-1.5 rounded hover:bg-zinc-50 text-zinc-400 hover:text-zinc-600 transition-colors">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="3" y1="4"  x2="13" y2="4"  strokeLinecap="round" />
            <line x1="3" y1="8"  x2="13" y2="8"  strokeLinecap="round" />
            <line x1="3" y1="12" x2="13" y2="12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-3 mt-2">
        <span className="inline-block w-6 h-0.5 rounded" style={{ backgroundColor: RED }} />
        排名分位
      </div>

      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
            <XAxis dataKey="ym" tick={{ fontSize: 11, fill: "#a1a1aa" }} interval="preserveStartEnd" minTickGap={40} />
            <YAxis reversed domain={[0, 100]} ticks={Y_TICKS} tick={{ fontSize: 11, fill: "#a1a1aa" }} width={44}
              tickFormatter={(v: number) => v === 0 ? "0%" : `+${v}%`} />
            <Tooltip content={(props) => (
              <RankPercentileTooltip active={props.active}
                payload={props.payload as Array<{ value?: number; payload?: RankPoint }>}
                label={props.label as string} />
            )} />
            <ReferenceLine y={25} stroke="#e4e4e7" strokeDasharray="4 2" />
            <ReferenceLine y={50} stroke="#e4e4e7" strokeDasharray="4 2" />
            <ReferenceLine y={75} stroke="#e4e4e7" strokeDasharray="4 2" />
            <Line type="linear" dataKey="pct" stroke={RED} strokeWidth={1.5} dot={false}
              activeDot={{ r: 4, fill: RED }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})
RankPercentileTrendChart.displayName = "RankPercentileTrendChart"
