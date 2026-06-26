"use client"

import { memo, useState, useMemo, useEffect } from "react"
import { HelpCircle, Menu } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const LINE_COLOR = "#92400e"
const Y_TICKS = [0, 20, 40, 60, 80, 100]

interface RankPoint {
  date: string
  pct: number
  rank: number
  sample_n: number
  fund_ret: number | null
}

function RankTooltip({
  active, payload, label,
}: {
  active?: boolean
  payload?: Array<{ payload?: RankPoint }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload!
  return (
    <div className="bg-white border border-zinc-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="font-semibold text-zinc-700 mb-1">{label}</div>
      <div className="flex items-center gap-1.5">
        <span className="text-zinc-500">排名分位：</span>
        <span className="tabular-nums font-medium" style={{ color: LINE_COLOR }}>{d.pct.toFixed(2)}%</span>
      </div>
      <div className="text-zinc-400 mt-0.5 tabular-nums">{d.rank} / {d.sample_n}</div>
    </div>
  )
}

export const RollingRankPercentileTrendChart = memo(function RollingRankPercentileTrendChart({
  beian_hao, productName, dateRangeLabel, sampleGroup, companyStrategy,
}: {
  beian_hao: string
  productName: string
  dateRangeLabel: string
  sampleGroup: string | null
  companyStrategy: string | null
}) {
  const [pool, setPool] = useState<"company" | "platform">("platform")
  const [points, setPoints] = useState<RankPoint[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!beian_hao) return
    setLoading(true)
    const qs = new URLSearchParams({ pool, windowMonths: "12" })
    if (pool === "company" && companyStrategy) qs.set("strategy", companyStrategy)
    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/peer-rolling-rank?${qs}`)
      .then((r) => r.ok ? r.json() : { points: [] })
      .then((d) => setPoints(Array.isArray(d.points) ? d.points : []))
      .catch(() => setPoints([]))
      .finally(() => setLoading(false))
  }, [beian_hao, pool, companyStrategy])

  const chartData = useMemo(() => {
    if (!dateRangeLabel) return points
    const [from, to] = dateRangeLabel.split("~").map((s) => s.trim().slice(0, 7))
    if (!from || !to) return points
    return points.filter((p) => p.date >= from && p.date <= to.slice(0, 7))
  }, [points, dateRangeLabel])

  const rangeLabel = dateRangeLabel || (chartData.length
    ? `${chartData[0].date} ~ ${chartData[chartData.length - 1].date}`
    : "")

  function exportCsv() {
    const headers = ["日期", "排名分位", "排名", "样本数", "滚动收益"]
    const lines = chartData.map((d) => [
      d.date,
      `${d.pct.toFixed(2)}%`,
      d.rank,
      d.sample_n,
      d.fund_ret !== null ? `${d.fund_ret.toFixed(2)}%` : "",
    ].join(","))
    const blob = new Blob(["\uFEFF" + [headers.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${productName}_滚动收益排名分位走势.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const companyLabel = sampleGroup || companyStrategy || "策略样本"

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            滚动收益排名分位走势
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            统计区间：{rangeLabel || "—"}&nbsp;&nbsp;排名周期：一年
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
          <span className="text-zinc-500">样本组：</span>
          <div className="inline-flex rounded border border-zinc-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setPool("company")}
              className={[
                "px-2.5 py-1 transition-colors border-r border-zinc-200 max-w-[120px] truncate",
                pool === "company"
                  ? "bg-red-500 text-white font-medium"
                  : "bg-white text-zinc-600 hover:bg-zinc-50",
              ].join(" ")}
              title={companyLabel}
            >
              {companyLabel}
            </button>
            <button
              type="button"
              onClick={() => setPool("platform")}
              className={[
                "px-2.5 py-1 transition-colors",
                pool === "platform"
                  ? "bg-red-500 text-white font-medium"
                  : "bg-white text-zinc-600 hover:bg-zinc-50",
              ].join(" ")}
            >
              平台
            </button>
          </div>
          <HelpCircle className="h-3.5 w-3.5 text-zinc-300" aria-label="排名分位说明" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="p-1 text-zinc-400 hover:text-zinc-600 rounded transition-colors" aria-label="图表菜单">
                <Menu className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[7.5rem] text-xs">
              <DropdownMenuItem onClick={exportCsv}>下载数据</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-3 mt-2">
        <span className="inline-block w-6 h-0.5 rounded" style={{ backgroundColor: LINE_COLOR }} />
        {productName}
      </div>

      {loading ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-zinc-400">加载中…</div>
      ) : !chartData.length ? (
        <div className="h-[240px] flex items-center justify-center text-sm text-zinc-400">暂无排名数据</div>
      ) : (
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#a1a1aa" }}
                tickFormatter={(v: string) => v.slice(2, 4)}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                reversed
                domain={[0, 100]}
                ticks={Y_TICKS}
                tick={{ fontSize: 11, fill: "#a1a1aa" }}
                width={44}
                tickFormatter={(v: number) => (v === 0 ? "0%" : `+${v}%`)}
                label={{ value: "排名分位", angle: -90, position: "insideLeft", offset: 10, style: { fontSize: 11, fill: "#a1a1aa" } }}
              />
              <Tooltip content={(props) => (
                <RankTooltip
                  active={props.active}
                  payload={props.payload as Array<{ payload?: RankPoint }>}
                  label={props.label as string}
                />
              )} />
              <ReferenceLine y={25} stroke="#e4e4e7" strokeDasharray="4 2" />
              <ReferenceLine y={50} stroke="#e4e4e7" strokeDasharray="4 2" />
              <ReferenceLine y={75} stroke="#e4e4e7" strokeDasharray="4 2" />
              <Line
                type="linear"
                dataKey="pct"
                stroke={LINE_COLOR}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 4, fill: LINE_COLOR }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
})
RollingRankPercentileTrendChart.displayName = "RollingRankPercentileTrendChart"
