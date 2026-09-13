"use client"

import { useMemo, useState } from "react"
import type {
  StrategyObservationIndicatorRow,
  StrategyObservationIndicatorTab,
} from "@/lib/ma/strategy-observation"

const METRIC_TABS = [
  { key: "return", label: "收益分位" },
  { key: "sharpe", label: "夏普比率分位" },
  { key: "maxdd", label: "最大回撤分位" },
  { key: "vol", label: "年化波动率分位" },
  { key: "calmar", label: "卡玛比率分位" },
] as const

type MetricTabKey = StrategyObservationIndicatorTab

function formatMetric(value: number, tab: MetricTabKey): string {
  if (tab === "sharpe" || tab === "calmar") return value.toFixed(2)
  return `${value.toFixed(2)}%`
}

function valueColorClass(value: number): string {
  if (value > 0) return "text-red-500"
  if (value < 0) return "text-green-600"
  return "text-zinc-700"
}

export function StrategyIndicatorDistributionSection({
  statsCutoff,
  indicators,
}: {
  statsCutoff: string
  indicators: Record<StrategyObservationIndicatorTab, StrategyObservationIndicatorRow[]>
}) {
  const [activeTab, setActiveTab] = useState<MetricTabKey>("return")

  const rows = useMemo(
    () => indicators[activeTab] ?? [],
    [activeTab, indicators],
  )

  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-3">
        <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
        指标分布
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-zinc-100 pb-2 mb-3">
        {METRIC_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={[
              "relative pb-2 text-sm transition-colors",
              activeTab === tab.key
                ? "text-red-600 font-medium after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-red-500"
                : "text-zinc-500 hover:text-zinc-800",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="text-xs text-zinc-400 mb-3">近一年（截止日期：{statsCutoff}）</div>

      <div className="overflow-x-auto rounded border border-zinc-100">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr className="bg-zinc-50 text-zinc-500">
              <th className="sticky left-0 z-20 bg-zinc-50 px-3 py-2 text-left font-medium border-b border-zinc-100 min-w-[7rem]">分类</th>
              <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 whitespace-nowrap">样本量</th>
              <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 whitespace-nowrap">平均值</th>
              <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 whitespace-nowrap">10%分位</th>
              <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 whitespace-nowrap">25%分位</th>
              <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 whitespace-nowrap">50%分位</th>
              <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 whitespace-nowrap">75%分位</th>
              <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 whitespace-nowrap">90%分位</th>
              <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 whitespace-nowrap">正收益比例</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.category} className={rowIndex % 2 === 1 ? "bg-zinc-50/60" : "bg-white"}>
                <td className={[
                  "sticky left-0 z-10 px-3 py-1.5 text-left text-zinc-700 border-b border-zinc-50 whitespace-nowrap",
                  rowIndex % 2 === 1 ? "bg-zinc-50/60" : "bg-white",
                ].join(" ")}>
                  {row.category}
                </td>
                <td className="px-3 py-1.5 text-center tabular-nums border-b border-zinc-50 text-zinc-700">{row.sampleSize}</td>
                <td className={["px-3 py-1.5 text-center tabular-nums border-b border-zinc-50", valueColorClass(row.average)].join(" ")}>
                  {formatMetric(row.average, activeTab)}
                </td>
                <td className={["px-3 py-1.5 text-center tabular-nums border-b border-zinc-50", valueColorClass(row.p10)].join(" ")}>
                  {formatMetric(row.p10, activeTab)}
                </td>
                <td className={["px-3 py-1.5 text-center tabular-nums border-b border-zinc-50", valueColorClass(row.p25)].join(" ")}>
                  {formatMetric(row.p25, activeTab)}
                </td>
                <td className={["px-3 py-1.5 text-center tabular-nums border-b border-zinc-50", valueColorClass(row.p50)].join(" ")}>
                  {formatMetric(row.p50, activeTab)}
                </td>
                <td className={["px-3 py-1.5 text-center tabular-nums border-b border-zinc-50", valueColorClass(row.p75)].join(" ")}>
                  {formatMetric(row.p75, activeTab)}
                </td>
                <td className={["px-3 py-1.5 text-center tabular-nums border-b border-zinc-50", valueColorClass(row.p90)].join(" ")}>
                  {formatMetric(row.p90, activeTab)}
                </td>
                <td className="px-3 py-1.5 text-center tabular-nums border-b border-zinc-50 text-zinc-700">
                  {formatMetric(row.positiveRatio, "return")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-2 text-[11px] leading-relaxed text-zinc-400">
        <p>
          <span className="text-zinc-500">计算方法：</span>
          观测指标基于本库私募基金净值（净值日期 6 个月以内，约 1.2 万只）。收益/夏普/卡玛取产品页预计算近一年指标；分位按从高到低排列（10% 分位为较优一侧）。收益率为等权统计。
        </p>
        <p>
          <span className="text-zinc-500">分类说明：</span>
          分类样本均为可观测私募产品。所展示的产品和信息均来源于公开或授权资料，但并不保证其完整和准确，相关分析表述仅供参考，不代表任何确定性判断，亦不构成任何推荐或投资建议。
        </p>
      </div>
    </div>
  )
}
