"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { isValuationCashHoldingName } from "@/lib/valuation-holding-display-name"
import { computeFofPortfolioVar } from "@/lib/fof-portfolio-var"
import {
  computeEnbTimeSeries,
  computePolicyBandSnapshot,
  computeStrategyCapitalVsRisk,
  effectiveBets,
  strategyColor,
} from "@/lib/fof-deeper-analysis"
import type { ReturnCurveSeries } from "./FofReturnCurvePanel"
import type { FundHoldingRow } from "./FofFundsPanel"
import type { OtherHoldingRow } from "./OtherHoldingsPanel"
import type { FofShareTrendData } from "./FofShareTrendPanel"
import { FofAnalysisChartCard } from "./FofAnalysisChartCard"
import { FofStockHedgeChart } from "./FofStockHedgeChart"

type Props = {
  series: ReturnCurveSeries[]
  fundHoldings: FundHoldingRow[]
  fromDate?: string
  toDate?: string
  strategyTrend: FofShareTrendData | null
  loading?: boolean
  netAssetValue?: number | null
  otherHoldings?: OtherHoldingRow[]
}

function isStockRow(row: FundHoldingRow): boolean {
  if (/ETF/u.test(row.fundName)) return false
  if (row.rowKind === "stock") return true
  if (row.rowKind === "fund_or_stock") {
    const code = (row.valuationCode ?? "").replace(/\.(SZ|SH|BJ)$/i, "").trim()
    if (/^\d{6}$/.test(code)) return true
    if (!row.valuationCode && !row.beianHao) return true
  }
  return false
}

function isCashOrNonFundRow(row: FundHoldingRow): boolean {
  if (["bank_deposit", "settlement_reserve", "margin_deposit", "payable", "clearing"].includes(row.rowKind)) {
    return true
  }
  return isValuationCashHoldingName(row.fundName)
}

export function FofAllocationRiskCharts({
  series,
  fundHoldings,
  fromDate,
  toDate,
  strategyTrend,
  loading,
  netAssetValue,
  otherHoldings = [],
}: Props) {
  const holdings = useMemo(
    () => fundHoldings.filter((r) => !isStockRow(r) && !isCashOrNonFundRow(r) && r.marketValue > 0),
    [fundHoldings],
  )

  const result = useMemo(
    () => computeFofPortfolioVar({ holdings, series, fromDate, toDate }),
    [holdings, series, fromDate, toDate],
  )

  const mix = useMemo(() => computeStrategyCapitalVsRisk(result), [result])
  const capitalEnb = useMemo(
    () => effectiveBets((result?.funds ?? []).filter((f) => f.status === "ok").map((f) => f.weightPct)),
    [result],
  )
  const riskEnb = useMemo(
    () => effectiveBets((result?.funds ?? []).filter((f) => f.status === "ok").map((f) => Math.max(0, f.riskContribPct ?? 0))),
    [result],
  )
  const enbSeries = useMemo(
    () => computeEnbTimeSeries(strategyTrend?.dates ?? [], strategyTrend?.series ?? []),
    [strategyTrend],
  )
  const policyRows = useMemo(() => {
    const dates = strategyTrend?.dates ?? []
    const last = dates.length - 1
    if (last < 0) return []
    return computePolicyBandSnapshot(
      (strategyTrend?.series ?? []).map((s) => ({ name: s.name, pct: s.values[last] ?? 0 })),
    )
  }, [strategyTrend])

  const mixOption = useMemo(() => ({
    grid: { left: 88, right: 24, top: 36, bottom: 28 },
    legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "value",
      name: "%",
      axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: number) => `${v}` },
      splitLine: { lineStyle: { color: "#f4f4f5" } },
    },
    yAxis: {
      type: "category",
      data: mix.map((r) => r.strategy),
      axisLabel: { fontSize: 11, color: "#52525b" },
    },
    series: [
      {
        name: "市值权重",
        type: "bar",
        data: mix.map((r) => ({
          value: +r.capitalPct.toFixed(2),
          itemStyle: { color: "rgba(113,113,122,0.55)", borderRadius: [0, 3, 3, 0] },
        })),
        barMaxWidth: 12,
      },
      {
        name: "风险贡献",
        type: "bar",
        data: mix.map((r) => ({
          value: +r.riskPct.toFixed(2),
          itemStyle: { color: strategyColor(r.strategy), borderRadius: [0, 3, 3, 0] },
        })),
        barMaxWidth: 12,
      },
    ],
  }), [mix])

  const enbOption = useMemo(() => ({
    grid: { left: 44, right: 20, top: 36, bottom: 28 },
    legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: enbSeries.map((p) => p.date),
      axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: string) => v.slice(0, 7) },
    },
    yAxis: {
      type: "value",
      name: "只",
      min: 0,
      axisLabel: { fontSize: 10, color: "#71717a" },
      splitLine: { lineStyle: { color: "#f4f4f5" } },
    },
    series: [{
      name: "策略有效个数",
      type: "line",
      showSymbol: false,
      data: enbSeries.map((p) => p.capital),
      lineStyle: { width: 1.8, color: "#ef4444" },
      itemStyle: { color: "#ef4444" },
    }],
  }), [enbSeries])

  const policyOption = useMemo(() => ({
    grid: { left: 88, right: 24, top: 36, bottom: 28 },
    legend: { top: 4, right: 8, textStyle: { fontSize: 11 }, data: ["政策带", "当前权重"] },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const i = params[0]?.dataIndex
        if (i == null) return ""
        const r = policyRows[i]
        const tag = r.status === "in" ? "在带内" : r.status === "above" ? "超上沿" : "低于下沿"
        return `<b>${r.strategy}</b><br/>当前 ${r.currentPct.toFixed(2)}%<br/>政策带 ${r.min}–${r.max}%<br/>${tag}`
      },
    },
    xAxis: {
      type: "value",
      name: "%",
      axisLabel: { fontSize: 10, color: "#71717a" },
      splitLine: { lineStyle: { color: "#f4f4f5" } },
    },
    yAxis: {
      type: "category",
      data: policyRows.map((r) => r.strategy),
      axisLabel: { fontSize: 11, color: "#52525b" },
    },
    series: [
      {
        name: "下沿占位",
        type: "bar",
        stack: "band",
        data: policyRows.map((r) => r.min),
        itemStyle: { color: "transparent" },
        silent: true,
        barMaxWidth: 14,
      },
      {
        name: "政策带",
        type: "bar",
        stack: "band",
        data: policyRows.map((r) => Math.max(0, r.max - r.min)),
        itemStyle: { color: "rgba(245,158,11,0.35)" },
        barMaxWidth: 14,
      },
      {
        name: "当前权重",
        type: "scatter",
        data: policyRows.map((r) => ({
          value: [+r.currentPct.toFixed(2), r.strategy],
          itemStyle: { color: r.status === "in" ? "#059669" : "#ef4444" },
        })),
        symbolSize: 11,
        z: 3,
      },
    ],
  }), [policyRows])

  if (loading) {
    return (
      <div className="mt-4 h-[200px] flex items-center justify-center text-sm text-zinc-400 bg-white rounded-lg border border-zinc-100">
        加载配置与风险分解…
      </div>
    )
  }

  return (
    <>
      <FofStockHedgeChart
        fundHoldings={fundHoldings}
        otherHoldings={otherHoldings}
        netAssetValue={netAssetValue}
        strategyTrend={strategyTrend}
      />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric
          label="资本有效个数"
          value={capitalEnb != null ? capitalEnb.toFixed(2) : "—"}
          hint="1 / Σ w²，按当前市值权重"
        />
        <Metric
          label="风险有效个数"
          value={riskEnb != null ? riskEnb.toFixed(2) : "—"}
          hint="1 / Σ CRC²，按风险贡献"
        />
      </div>

      <FofAnalysisChartCard
        title="策略市值权重 vs 风险贡献"
        hint="资本配置与风险配置是否一致。风险柱明显高于灰色权重，说明该策略在用更少的钱承担更多波动。"
        calcHelp={{
          heading: "策略市值权重 vs 风险贡献 · 计算说明",
          blocks: [
            {
              title: "市值权重",
              paragraphs: [
                "把当前估值日纳入 VaR 的底层基金，按一级策略加总其分析权重。分析权重 = 该基金市值 / 纳入基金市值合计。",
              ],
              formula: "市值权重_策略 = Σ 基金市值_i / 纳入基金市值",
            },
            {
              title: "风险贡献",
              paragraphs: [
                "用底层基金共同窗口收益估计协方差 Σ，组合方差 σ_p² = w'Σw。单只基金欧拉分解后再按一级策略加总。",
              ],
              formula: "CRC_i = w_i × (Σw)_i / σ_p²\n风险贡献_策略 = Σ CRC_i",
            },
            {
              title: "怎么读",
              bullets: [
                "灰柱是钱的配置，彩柱是波动的配置。",
                "彩柱明显高于灰柱：该策略用更少资本承担更多组合风险。",
                "彩柱可为负：该策略与组合负相关，起对冲作用。",
              ],
            },
          ],
        }}
      >
        {mix.length === 0 ? (
          <EmptyChart text="暂无足够净值估计策略风险贡献" />
        ) : (
          <ReactECharts option={mixOption} style={{ height: Math.max(220, mix.length * 36 + 56) }} notMerge />
        )}
      </FofAnalysisChartCard>

      <FofAnalysisChartCard
        title="策略有效个数走势"
        hint="按各期策略市值权重计算。下行表示配置向少数策略集中。"
        calcHelp={{
          heading: "策略有效个数 · 计算说明",
          blocks: [
            {
              title: "有效个数（ENB）",
              paragraphs: [
                "把当期一级策略市值权重归一化后算赫芬达尔指数的倒数。配置越分散，有效个数越接近策略只数；越集中，越接近 1。",
              ],
              formula: "w̃_i = w_i / Σ w\nENB = 1 / Σ w̃_i²",
            },
            {
              title: "上方两张卡片",
              bullets: [
                "资本有效个数：对当前市值权重复用同一公式。",
                "风险有效个数：把风险贡献 CRC 当作权重（负值截为 0）再算。",
              ],
            },
          ],
        }}
      >
        {enbSeries.filter((p) => p.capital != null).length < 2 ? (
          <EmptyChart text="策略配置走势样本不足" />
        ) : (
          <ReactECharts option={enbOption} style={{ height: 260 }} notMerge />
        )}
      </FofAnalysisChartCard>

      <FofAnalysisChartCard
        title="策略配置 vs 政策带"
        hint="黄条为一级策略的默认政策区间（股票对冲 15–45%、期货 10–40% 等）。绿点在带内，红点偏离。可按产品目标自行解读，并非合同约束。"
        calcHelp={{
          heading: "策略配置 vs 政策带 · 计算说明",
          blocks: [
            {
              title: "当前权重",
              paragraphs: [
                "取策略配置走势最后一个估值日，各一级策略市值 / 资产净值。权重 ≤ 0.05% 的策略不画。",
              ],
            },
            {
              title: "政策带（观察带，非合同）",
              bullets: [
                "股票对冲 15–45%",
                "期货策略 10–40%",
                "套利策略 5–25%",
                "债券策略 0–20%、多资产 0–25%、股票多头 0–25%",
                "期权 0–15%、组合策略 0–30%、其他/未配置 0–15%",
                "未列出的策略：下沿 0%，上沿 max(20%, 当前权重×1.5)",
              ],
            },
            {
              title: "颜色",
              paragraphs: [
                "绿点：当前权重在 [min−0.5%, max+0.5%] 内；红点：低于下沿或高于上沿。",
              ],
            },
          ],
        }}
      >
        {policyRows.length === 0 ? (
          <EmptyChart text="暂无策略配置时点数据" />
        ) : (
          <ReactECharts option={policyOption} style={{ height: Math.max(240, policyRows.length * 32 + 48) }} notMerge />
        )}
      </FofAnalysisChartCard>
    </>
  )
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-zinc-100 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-900">{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-400">{hint}</div>
    </div>
  )
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="h-[180px] flex items-center justify-center text-sm text-zinc-400 px-4 text-center">
      {text}
    </div>
  )
}
