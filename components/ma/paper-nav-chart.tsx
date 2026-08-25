"use client"

import { useMemo } from "react"
import { LineChart } from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { PaperTradingApi } from "@/hooks/use-paper-trading"
import { ALL_WEATHER_PORTFOLIO_ID, fmtNav, fmtPct, paperNavCurve } from "@/lib/client/paper-trading"
import { cn } from "@/lib/utils"

function yuanWan(v: number) {
  return `${Math.round(v / 10_000)}万`
}

export function PaperNavChart({ paper, onClose }: { paper: PaperTradingApi; onClose: () => void }) {
  const aw = paper.selectedPortfolioId === ALL_WEATHER_PORTFOLIO_ID
  const startedAt = aw && paper.awMeta?.startedAt ? Date.parse(`${paper.awMeta.startedAt}T09:00:00+08:00`) : paper.selectedPortfolio?.createdAt
  const data = useMemo(
    () =>
      paperNavCurve({
        initialCapital: paper.summary.initialCapital,
        liveNav: paper.summary.nav,
        startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
        positions: paper.state.positions.filter((p) => !paper.selectedPortfolio || p.portfolioId === paper.selectedPortfolio.id),
        daily: aw ? paper.awMeta?.daily : undefined,
      }),
    [aw, paper.awMeta?.daily, paper.selectedPortfolio, paper.state.positions, paper.summary.initialCapital, paper.summary.nav, startedAt],
  )
  const first = data[0]?.nav
  const last = data.at(-1)?.nav
  const ret = first && first > 0 && last != null ? (last - first) / first : null
  const empty = data.length < 2

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#131722]">
      <div className="flex shrink-0 items-center justify-between border-b border-[#2a2e39] bg-[#1e222d] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <LineChart className="size-3.5 text-[#4c84ff]" />
          <span className="text-[12px] text-white">净值曲线</span>
          <span className="truncate text-[11px] text-[#787b86]">{paper.selectedPortfolio?.name || "--"}</span>
          <span className="font-mono text-[11px] text-[#d1d4dc]">{fmtNav(paper.summary.nav)}</span>
          <span className={cn("font-mono text-[11px]", ret == null ? "text-[#787b86]" : ret >= 0 ? "text-[#ef5350]" : "text-[#26a69a]")}>
            {fmtPct(ret)}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-0.5 text-[11px] text-[#adb3bd] hover:bg-[#2a2e39] hover:text-white"
        >
          返回K线
        </button>
      </div>
      <div className="min-h-0 flex-1 px-2 py-2">
        {empty ? (
          <div className="flex h-full items-center justify-center text-sm text-[#787b86]">
            {aw ? "跟踪刚开始，次日刷新后会画出净值曲线。" : "暂无净值历史。平仓或同步全天候后将生成曲线。"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <defs>
                <linearGradient id="paperNavFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4c84ff" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#4c84ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e222d" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#787b86" }} axisLine={{ stroke: "#2a2e39" }} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: "#787b86" }}
                axisLine={{ stroke: "#2a2e39" }}
                tickLine={false}
                width={52}
                tickFormatter={yuanWan}
                domain={["auto", "auto"]}
              />
              <Tooltip
                contentStyle={{ background: "#1e222d", border: "1px solid #2a2e39", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "#adb3bd" }}
                formatter={(value) => [fmtNav(Number(value)), "净值"]}
              />
              <Area type="monotone" dataKey="nav" stroke="#4c84ff" fill="url(#paperNavFill)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
