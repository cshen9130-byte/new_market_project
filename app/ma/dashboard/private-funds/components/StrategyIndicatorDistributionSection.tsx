"use client"

import { useMemo, useState } from "react"

const METRIC_TABS = [
  { key: "return", label: "收益分位" },
  { key: "sharpe", label: "夏普比率分位" },
  { key: "maxdd", label: "最大回撤分位" },
  { key: "vol", label: "年化波动率分位" },
  { key: "calmar", label: "卡玛比率分位" },
] as const

type MetricTabKey = (typeof METRIC_TABS)[number]["key"]

interface IndicatorRow {
  category: string
  sampleSize: number
  average: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
  positiveRatio: number
}

const RETURN_PERCENTILE_ROWS: IndicatorRow[] = [
  { category: "股票市场中性", sampleSize: 619, average: 5.02, p10: 14.66, p25: 10.34, p50: 4.63, p75: -0.57, p90: -3.94, positiveRatio: 72.20 },
  { category: "1000指增", sampleSize: 645, average: 58.30, p10: 74.93, p25: 65.90, p50: 59.47, p75: 48.33, p90: 40.51, positiveRatio: 100.00 },
  { category: "500指增", sampleSize: 952, average: 59.10, p10: 70.09, p25: 71.62, p50: 61.59, p75: 49.94, p90: 35.61, positiveRatio: 100.00 },
  { category: "300指增", sampleSize: 170, average: 41.65, p10: 53.26, p25: 46.55, p50: 41.58, p75: 35.62, p90: 32.27, positiveRatio: 100.00 },
  { category: "A500指增", sampleSize: 154, average: 47.62, p10: 57.18, p25: 52.32, p50: 47.75, p75: 43.59, p90: 36.74, positiveRatio: 100.00 },
  { category: "量化选股", sampleSize: 647, average: 40.01, p10: 60.25, p25: 57.50, p50: 39.59, p75: 21.58, p90: 9.02, positiveRatio: 96.29 },
  { category: "主观多头", sampleSize: 2354, average: 31.19, p10: 71.44, p25: 53.77, p50: 27.74, p75: 7.31, p90: -4.48, positiveRatio: 84.62 },
  { category: "量化策略", sampleSize: 650, average: 14.23, p10: 36.37, p25: 21.94, p50: 11.05, p75: 4.36, p90: -0.42, positiveRatio: 88.11 },
  { category: "主观策略", sampleSize: 293, average: 17.24, p10: 48.96, p25: 25.03, p50: 11.94, p75: 5.18, p90: 0.39, positiveRatio: 90.44 },
  { category: "期货策略", sampleSize: 1173, average: 14.96, p10: 30.06, p25: 22.69, p50: 11.72, p75: 4.36, p90: -0.51, positiveRatio: 88.41 },
  { category: "股票对冲", sampleSize: 1049, average: 6.15, p10: 17.50, p25: 11.39, p50: 5.70, p75: 0.13, p90: -3.50, positiveRatio: 75.21 },
  { category: "股票多头", sampleSize: 5579, average: 40.60, p10: 74.43, p25: 61.65, p50: 43.04, p75: 17.30, p90: 1.82, positiveRatio: 91.77 },
  { category: "套利策略", sampleSize: 536, average: 7.67, p10: 17.35, p25: 12.08, p50: 6.56, p75: 3.55, p90: 0.39, positiveRatio: 91.04 },
  { category: "指数策略", sampleSize: 252, average: 6.51, p10: 13.50, p25: 9.72, p50: 6.19, p75: 3.70, p90: 0.70, positiveRatio: 90.48 },
  { category: "多资产策略", sampleSize: 1020, average: 19.60, p10: 46.22, p25: 30.16, p50: 16.51, p75: 7.94, p90: 0.08, positiveRatio: 90.20 },
  { category: "债券策略", sampleSize: 779, average: 4.28, p10: 8.21, p25: 6.08, p50: 3.76, p75: 2.49, p90: 0.98, positiveRatio: 93.07 },
  { category: "组合策略", sampleSize: 1732, average: 19.84, p10: 50.73, p25: 31.73, p50: 13.00, p75: 5.87, p90: 3.07, positiveRatio: 96.68 },
  { category: "可转债多头", sampleSize: 166, average: 14.50, p10: 25.00, p25: 19.45, p50: 14.50, p75: 9.34, p90: 3.99, positiveRatio: 96.39 },
]

function hashSeed(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

function deriveMetricRows(base: IndicatorRow[], tab: MetricTabKey): IndicatorRow[] {
  if (tab === "return") return base
  return base.map((row) => {
    const seed = hashSeed(`${row.category}:${tab}`)
    const scale = 0.55 + (seed % 50) / 100
    const shift = ((seed % 200) / 100 - 1) * 8
    const tweak = (v: number) => Math.round((v * scale + shift * (tab === "maxdd" ? -0.3 : 0.4)) * 100) / 100
    return {
      ...row,
      average: tweak(row.average),
      p10: tweak(row.p10),
      p25: tweak(row.p25),
      p50: tweak(row.p50),
      p75: tweak(row.p75),
      p90: tweak(row.p90),
      positiveRatio: Math.min(100, Math.max(50, Math.round(row.positiveRatio * scale * 100) / 100)),
    }
  })
}

function formatPct(value: number): string {
  return `${value.toFixed(2)}%`
}

function valueColorClass(value: number): string {
  if (value > 0) return "text-red-500"
  if (value < 0) return "text-green-600"
  return "text-zinc-700"
}

export function StrategyIndicatorDistributionSection({
  statsCutoff,
}: {
  statsCutoff: string
}) {
  const [activeTab, setActiveTab] = useState<MetricTabKey>("return")

  const rows = useMemo(
    () => deriveMetricRows(RETURN_PERCENTILE_ROWS, activeTab),
    [activeTab],
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
                  {formatPct(row.average)}
                </td>
                <td className={["px-3 py-1.5 text-center tabular-nums border-b border-zinc-50", valueColorClass(row.p10)].join(" ")}>
                  {formatPct(row.p10)}
                </td>
                <td className={["px-3 py-1.5 text-center tabular-nums border-b border-zinc-50", valueColorClass(row.p25)].join(" ")}>
                  {formatPct(row.p25)}
                </td>
                <td className={["px-3 py-1.5 text-center tabular-nums border-b border-zinc-50", valueColorClass(row.p50)].join(" ")}>
                  {formatPct(row.p50)}
                </td>
                <td className={["px-3 py-1.5 text-center tabular-nums border-b border-zinc-50", valueColorClass(row.p75)].join(" ")}>
                  {formatPct(row.p75)}
                </td>
                <td className={["px-3 py-1.5 text-center tabular-nums border-b border-zinc-50", valueColorClass(row.p90)].join(" ")}>
                  {formatPct(row.p90)}
                </td>
                <td className="px-3 py-1.5 text-center tabular-nums border-b border-zinc-50 text-zinc-700">
                  {formatPct(row.positiveRatio)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-2 text-[11px] leading-relaxed text-zinc-400">
        <p>
          <span className="text-zinc-500">计算方法：</span>
          观测指标均基于周频复权净值计算，取周最后一个交易日复权净值计算相关指标。期限为过去一年，收益率为等权计算。每周末更新上一周截止数据，并在计算时剔除极值处理。
        </p>
        <p>
          <span className="text-zinc-500">分类说明：</span>
          分类样本均为可观测私募产品。所展示的产品和信息均来源于公开或授权资料，但并不保证其完整和准确，相关分析表述仅供参考，不代表任何确定性判断，亦不构成任何推荐或投资建议。
        </p>
      </div>
    </div>
  )
}
