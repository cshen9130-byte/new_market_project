"use client"

import { useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import type { FofPortfolioVarResult } from "@/lib/fof-portfolio-var"
import {
  computeRollingVolSeries,
  computeTrailingCrcArea,
  computeVarBacktest,
  type NavPoint,
} from "@/lib/fof-deeper-analysis"
import { FofAnalysisChartCard } from "./FofAnalysisChartCard"

const CRC_COLORS = [
  "#e54d42", "#5b9bd5", "#ed7d31", "#14b8a6", "#8b5cf6",
  "#eab308", "#64748b", "#ec4899", "#a1a1aa",
]

type Props = {
  result: FofPortfolioVarResult | null
  productNav: NavPoint[]
}

export function FofVolControlCharts({ result, productNav }: Props) {
  const [bandLow, setBandLow] = useState("8")
  const [bandHigh, setBandHigh] = useState("12")
  const low = Number(bandLow) || 8
  const high = Number(bandHigh) || 12

  const rolling = useMemo(() => computeRollingVolSeries(productNav), [productNav])
  const backtest = useMemo(() => computeVarBacktest(result), [result])
  const crcArea = useMemo(() => computeTrailingCrcArea(result), [result])
  const heatmap = useMemo(() => {
    if (!result || result.corrMatrix.length === 0) return null
    const ranked = [...result.fundReturns]
      .sort((a, b) => Math.abs(b.weightPct) - Math.abs(a.weightPct))
      .slice(0, 12)
    const idx = ranked.map((f) => result.fundReturns.findIndex((x) => x.key === f.key))
    const names = ranked.map((f) => f.name)
    const data: Array<[number, number, number]> = []
    for (let i = 0; i < idx.length; i++) {
      for (let j = 0; j < idx.length; j++) {
        data.push([j, i, +((result.corrMatrix[idx[i]]?.[idx[j]] ?? 0).toFixed(2))])
      }
    }
    return { names, data }
  }, [result])

  const volOption = useMemo(() => {
    const w13 = rolling.series.find((s) => s.window === 13)?.values ?? []
    const w26 = rolling.series.find((s) => s.window === 26)?.values ?? []
    return {
      grid: { left: 48, right: 20, top: 36, bottom: 28 },
      legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: rolling.dates,
        axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: string) => v.slice(0, 7) },
      },
      yAxis: {
        type: "value",
        name: "%",
        axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: number) => `${v}` },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: [
        {
          name: "13周波动",
          type: "line",
          data: w13,
          showSymbol: false,
          lineStyle: { width: 1.6, color: "#ef4444" },
          itemStyle: { color: "#ef4444" },
        },
        {
          name: "26周波动",
          type: "line",
          data: w26,
          showSymbol: false,
          lineStyle: { width: 1.6, color: "#3b82f6" },
          itemStyle: { color: "#3b82f6" },
        },
        {
          name: "风控上沿",
          type: "line",
          data: rolling.dates.map(() => high),
          showSymbol: false,
          lineStyle: { width: 1, type: "dashed", color: "#f59e0b" },
          itemStyle: { color: "#f59e0b" },
        },
        {
          name: "风控下沿",
          type: "line",
          data: rolling.dates.map(() => low),
          showSymbol: false,
          areaStyle: { color: "rgba(245,158,11,0.08)" },
          lineStyle: { width: 1, type: "dashed", color: "#f59e0b" },
          itemStyle: { color: "#f59e0b" },
        },
      ],
    }
  }, [rolling, low, high])

  const backtestOption = useMemo(() => ({
    grid: { left: 52, right: 20, top: 36, bottom: 36 },
    legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ dataIndex: number }>) => {
        const i = params[0]?.dataIndex
        if (i == null) return ""
        const p = backtest.points[i]
        return [
          `<b>${p.date}</b>`,
          `预测 VaR：${p.predictedVaRPct.toFixed(2)}%`,
          `实现损失：${p.realizedLossPct.toFixed(2)}%`,
          p.exception ? '<span style="color:#ef4444">突破</span>' : "未突破",
        ].join("<br/>")
      },
    },
    xAxis: {
      type: "category",
      data: backtest.points.map((p) => p.date),
      axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: string) => v.slice(0, 7) },
    },
    yAxis: {
      type: "value",
      name: "%",
      axisLabel: { fontSize: 10, color: "#71717a" },
      splitLine: { lineStyle: { color: "#f4f4f5" } },
    },
    series: [
      {
        name: `预测 VaR(${result?.confidence ?? 95}%)`,
        type: "line",
        data: backtest.points.map((p) => p.predictedVaRPct),
        showSymbol: false,
        lineStyle: { width: 1.5, color: "#71717a" },
        itemStyle: { color: "#71717a" },
      },
      {
        name: "实现损失",
        type: "bar",
        data: backtest.points.map((p) => ({
          value: p.realizedLossPct,
          itemStyle: { color: p.exception ? "rgba(239,68,68,0.85)" : "rgba(16,185,129,0.7)" },
        })),
        barMaxWidth: 8,
      },
    ],
  }), [backtest, result?.confidence])

  const crcOption = useMemo(() => ({
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    legend: { top: 4, type: "scroll", textStyle: { fontSize: 10 } },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: crcArea.dates,
      axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: string) => v.slice(0, 7) },
    },
    yAxis: {
      type: "value",
      name: "%",
      axisLabel: { fontSize: 10, color: "#71717a" },
      splitLine: { lineStyle: { color: "#f4f4f5" } },
    },
    series: crcArea.names.filter((n) => n !== "其他" || crcArea.rows.some((r) => Math.abs(r.values["其他"] ?? 0) > 0.5)).map((name, i) => ({
      name,
      type: "line",
      showSymbol: false,
      lineStyle: { width: 1.6 },
      itemStyle: { color: CRC_COLORS[i % CRC_COLORS.length] },
      data: crcArea.rows.map((r) => +(r.values[name] ?? 0).toFixed(2)),
    })),
  }), [crcArea])

  const heatHeight = Math.max(280, (heatmap?.names.length ?? 0) * 18 + 80)
  const heatOption = useMemo(() => {
    if (!heatmap) return {}
    return {
      grid: { left: 108, right: 48, top: 8, bottom: 88 },
      tooltip: {
        formatter: (p: { value: [number, number, number] }) => {
          const [x, y, v] = p.value
          return `${heatmap.names[y]} vs ${heatmap.names[x]}<br/>相关 ${v.toFixed(2)}`
        },
      },
      visualMap: {
        min: -1,
        max: 1,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 8,
        inRange: { color: ["#3b82f6", "#f8fafc", "#ef4444"] },
        textStyle: { fontSize: 10 },
      },
      xAxis: {
        type: "category",
        data: heatmap.names,
        axisLabel: { fontSize: 9, rotate: 50, width: 80, overflow: "truncate" },
      },
      yAxis: {
        type: "category",
        data: heatmap.names,
        axisLabel: { fontSize: 9, width: 100, overflow: "truncate" },
      },
      series: [{
        type: "heatmap",
        data: heatmap.data,
        label: {
          show: heatmap.names.length <= 12,
          fontSize: 9,
          formatter: (p: { value: [number, number, number] }) => p.value[2].toFixed(2),
        },
      }],
    }
  }, [heatmap])

  return (
    <>
      <FofAnalysisChartCard
        title="滚动波动 vs 风控带"
        hint="产品自身净值的 13 / 26 周年化波动。默认 8%–12% 为观察带，突破上沿表示波动放大、控制变弱。"
        calcHelp={{
          heading: "滚动波动 vs 风控带 · 计算说明",
          blocks: [
            {
              title: "周收益",
              paragraphs: [
                "把产品净值按自然周取最后一个点，再算相邻周收益 r_t = NAV_t / NAV_{t-1} − 1。",
              ],
            },
            {
              title: "年化波动",
              paragraphs: [
                "对过去 13 周或 26 周收益算样本标准差，再乘 √52 换成百分数。窗口不足时该点为空。",
              ],
              formula: "σ_ann = stdev(r_{t−w+1} … r_t) × √52 × 100",
            },
            {
              title: "风控带",
              paragraphs: [
                `黄虚线为右侧输入的观察带（当前 ${low}%–${high}%），不是合同止损线。13 周线穿出上沿表示近期波动放大。`,
              ],
            },
          ],
        }}
        extra={(
          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
            带
            <input
              type="number"
              min={0}
              step={0.5}
              value={bandLow}
              onChange={(e) => setBandLow(e.target.value)}
              className="w-12 h-6 rounded border border-zinc-200 px-1 text-right tabular-nums"
            />
            –
            <input
              type="number"
              min={0}
              step={0.5}
              value={bandHigh}
              onChange={(e) => setBandHigh(e.target.value)}
              className="w-12 h-6 rounded border border-zinc-200 px-1 text-right tabular-nums"
            />
            %
          </span>
        )}
      >
        {rolling.dates.length < 8 ? (
          <EmptyChart text="产品净值样本不足，无法计算滚动波动" />
        ) : (
          <ReactECharts option={volOption} style={{ height: 280 }} notMerge />
        )}
      </FofAnalysisChartCard>

      <FofAnalysisChartCard
        title="预测 VaR vs 实现损失"
        hint={`用过去 ${12} 个共同窗口收益估计下一期 VaR，再与当期实际损失比较。红柱为突破次数 ${backtest.exceptionCount}/${backtest.obsCount || "—"}。`}
        calcHelp={{
          heading: "预测 VaR vs 实现损失 · 计算说明",
          blocks: [
            {
              title: "预测 VaR",
              paragraphs: [
                "在每个共同窗口 t，用过去 12 期组合收益的样本标准差 σ，乘当前置信度对应的 z（95%→1.65，99%→2.33）。",
              ],
              formula: "预测 VaR_t = z × σ_{t−12…t−1} × 100",
            },
            {
              title: "实现损失",
              paragraphs: [
                "当期组合收益取负：实现损失_t = −r_t × 100。收益为正时损失为负（盈利）。",
              ],
            },
            {
              title: "突破",
              paragraphs: [
                `红柱表示实现损失 > 预测 VaR（且预测 VaR > 0）。本期 ${backtest.exceptionCount}/${backtest.obsCount || 0} 次。`,
              ],
            },
          ],
        }}
      >
        {backtest.points.length < 4 ? (
          <EmptyChart text="共同窗口不足，无法回测 VaR" />
        ) : (
          <ReactECharts option={backtestOption} style={{ height: 280 }} notMerge />
        )}
      </FofAnalysisChartCard>

      <FofAnalysisChartCard
        title="风险贡献走势"
        hint="按当前市值权重、滚动 12 期协方差做欧拉分解。观察是否有单只基金风险贡献持续抬升。"
        calcHelp={{
          heading: "风险贡献走势 · 计算说明",
          blocks: [
            {
              title: "权重固定、协方差滚动",
              paragraphs: [
                "每期用当前估值日的市值权重 w，对过去 12 个共同窗口收益重估协方差 Σ_t，再做欧拉分解。只画最新风险贡献最高的 8 只，其余并入「其他」。",
              ],
              formula: "CRC_i,t = w_i × (Σ_t w)_i / (w' Σ_t w) × 100",
            },
            {
              title: "怎么读",
              bullets: [
                "某只基金 CRC 持续抬升：它对组合波动的贡献在变大。",
                "权重未变而 CRC 上升，通常是它与组合的相关/波动变高。",
              ],
            },
          ],
        }}
      >
        {crcArea.rows.length < 3 ? (
          <EmptyChart text="样本不足，无法展开风险贡献走势" />
        ) : (
          <ReactECharts option={crcOption} style={{ height: 300 }} notMerge />
        )}
      </FofAnalysisChartCard>

      <FofAnalysisChartCard
        title="底层基金相关矩阵"
        hint="市值最大的 12 只纳入基金两两相关。大面积红色表示分散化偏弱，组合更像少数几个因子。"
        calcHelp={{
          heading: "底层基金相关矩阵 · 计算说明",
          blocks: [
            {
              title: "样本",
              paragraphs: [
                "在共同窗口收益上，按 |市值权重| 取最大的 12 只已纳入基金，计算两两 Pearson 相关系数。",
              ],
              formula: "ρ_ij = Cov(r_i, r_j) / (σ_i σ_j)",
            },
            {
              title: "颜色",
              bullets: [
                "红：正相关，蓝：负相关，白：接近 0。",
                "对角线恒为 1。大面积深红说明底层挤在同一方向。",
              ],
            },
          ],
        }}
      >
        {!heatmap || heatmap.names.length < 2 ? (
          <EmptyChart text="纳入基金不足，无法绘制相关矩阵" />
        ) : (
          <ReactECharts option={heatOption} style={{ height: heatHeight }} notMerge />
        )}
      </FofAnalysisChartCard>
    </>
  )
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="h-[200px] flex items-center justify-center text-sm text-zinc-400 px-4 text-center">
      {text}
    </div>
  )
}
