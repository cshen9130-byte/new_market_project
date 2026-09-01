"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import type { FofPortfolioVarResult } from "@/lib/fof-portfolio-var"
import {
  buildCrcStrategyLookup,
  computeRollingVolFromPortfolio,
  computeRollingVolSeries,
  computeTrailingCrcByFund,
  computeVarBacktest,
  crcGroupLabel,
  crcLabelsForFund,
  filterTrailingCrcByFund,
  groupTrailingCrcArea,
  renormalizeCrcArea,
  renormalizeTrailingByFund,
  shareTrendToCrcByFund,
  strategyColor,
  type CrcFundRef,
  type CrcHoldingRef,
  type CrcStrategyLabels,
  type NavPoint,
} from "@/lib/fof-deeper-analysis"
import { FofAnalysisChartCard } from "./FofAnalysisChartCard"
import type { ChartCalcHelp } from "./ChartCalcHelpButton"
import type { FofShareTrendData } from "./FofShareTrendPanel"

const CRC_COLORS = [
  "#e54d42", "#5b9bd5", "#ed7d31", "#14b8a6", "#8b5cf6",
  "#eab308", "#64748b", "#ec4899", "#a1a1aa",
]

type Props = {
  result: FofPortfolioVarResult | null
  productNav: NavPoint[]
  holdings?: CrcHoldingRef[]
  shareTrend?: FofShareTrendData | null
  strategyTrend?: FofShareTrendData | null
  fromDate?: string
  toDate?: string
}

type CrcMetric = "risk" | "mv"

type CrcSelection = {
  l1: string | null
  l2: string | null
  l3: string | null
}

const EMPTY_CRC_SEL: CrcSelection = { l1: null, l2: null, l3: null }

function roundHalf(n: number): number {
  return Math.round(n * 2) / 2
}

function suggestVolBand(values: Array<number | null>): { low: number; high: number } | null {
  const vols = values
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b)
  if (vols.length < 2) return null
  const mid = vols[Math.floor(vols.length / 2)]
  const p90 = vols[Math.min(vols.length - 1, Math.floor(vols.length * 0.9))]
  const low = Math.max(0, roundHalf(mid * 0.55))
  const high = Math.max(low + 1, roundHalf(Math.max(mid * 1.75, p90 * 1.2)))
  return { low, high }
}

export function FofVolControlCharts({
  result,
  productNav,
  holdings = [],
  shareTrend = null,
  strategyTrend = null,
  fromDate,
  toDate,
}: Props) {
  const [customLow, setCustomLow] = useState<string | null>(null)
  const [customHigh, setCustomHigh] = useState<string | null>(null)
  const [crcSel, setCrcSel] = useState<CrcSelection>(EMPTY_CRC_SEL)
  const [metric, setMetric] = useState<CrcMetric>("risk")

  const productRolling = useMemo(() => computeRollingVolSeries(productNav), [productNav])
  const portRolling = useMemo(() => computeRollingVolFromPortfolio(result), [result])
  const rollingSource = productRolling.dates.length >= 8 ? "product" as const : "portfolio" as const
  const rolling = rollingSource === "product" ? productRolling : portRolling
  const hasRollingVol = rolling.series.some((s) => s.values.some((v) => v != null))
  const suggestedBand = useMemo(
    () => suggestVolBand(rolling.series.flatMap((s) => s.values)),
    [rolling],
  )
  const parsedLow = customLow != null ? Number(customLow) : NaN
  const parsedHigh = customHigh != null ? Number(customHigh) : NaN
  const low = Number.isFinite(parsedLow) ? parsedLow : (suggestedBand?.low ?? 8)
  const high = Number.isFinite(parsedHigh) ? parsedHigh : (suggestedBand?.high ?? 12)
  const bandLo = Math.min(low, high)
  const bandHi = Math.max(low, high)
  const backtest = useMemo(() => computeVarBacktest(result), [result])
  const strategyLookup = useMemo(() => buildCrcStrategyLookup(holdings), [holdings])
  const mvUnderlying = useMemo(() => {
    const inRange = shareTrendToCrcByFund(shareTrend, fromDate, toDate)
    return inRange.rows.length >= 2 ? inRange : shareTrendToCrcByFund(shareTrend)
  }, [shareTrend, fromDate, toDate])
  const mvByFund = useMemo(() => {
    if (mvUnderlying.rows.length >= 2) return mvUnderlying
    const inRange = shareTrendToCrcByFund(strategyTrend, fromDate, toDate)
    return inRange.rows.length >= 2 ? inRange : shareTrendToCrcByFund(strategyTrend)
  }, [mvUnderlying, strategyTrend, fromDate, toDate])
  const crcByFund = useMemo(
    () => computeTrailingCrcByFund(result, 12, mvUnderlying.rows.length >= 2 ? mvUnderlying : null),
    [result, mvUnderlying],
  )
  const source = useMemo(
    () => (metric === "risk" ? crcByFund : renormalizeTrailingByFund(mvByFund)),
    [metric, crcByFund, mvByFund],
  )
  const metricLabel = metric === "risk" ? "风险贡献" : "市值"
  const hasMvHistory = mvUnderlying.rows.length >= 2
  const labelsOf = (fund: CrcFundRef) => crcLabelsForFund(fund, strategyLookup)
  const crcForL2 = useMemo(
    () => crcSel.l1
      ? filterTrailingCrcByFund(source, (f) => labelsOf(f).l1 === crcSel.l1)
      : source,
    [source, crcSel.l1, strategyLookup],
  )
  const crcForL3 = useMemo(
    () => filterTrailingCrcByFund(source, (f) => {
      const labels = labelsOf(f)
      if (crcSel.l1 && labels.l1 !== crcSel.l1) return false
      if (crcSel.l2 && labels.l2 !== crcSel.l2) return false
      return true
    }),
    [source, crcSel.l1, crcSel.l2, strategyLookup],
  )
  const crcForFunds = useMemo(
    () => filterTrailingCrcByFund(source, (f) => {
      const labels = labelsOf(f)
      if (crcSel.l1 && labels.l1 !== crcSel.l1) return false
      if (crcSel.l2 && labels.l2 !== crcSel.l2) return false
      if (crcSel.l3 && !labels.l3s.includes(crcSel.l3)) return false
      return true
    }),
    [source, crcSel.l1, crcSel.l2, crcSel.l3, strategyLookup],
  )
  const l1Crc = useMemo(() => {
    const grouped = groupTrailingCrcArea(source, (f) => crcGroupLabel(labelsOf(f), 1), 12)
    return metric === "mv" ? renormalizeCrcArea(grouped) : grouped
  }, [source, strategyLookup, metric])
  const l2Crc = useMemo(() => {
    const grouped = groupTrailingCrcArea(
      crcForL2,
      (f) => (crcSel.l1 ? labelsOf(f).l2 : crcGroupLabel(labelsOf(f), 2)),
      10,
    )
    return metric === "mv" || crcSel.l1 ? renormalizeCrcArea(grouped) : grouped
  }, [crcForL2, crcSel.l1, strategyLookup, metric])
  const l3Crc = useMemo(() => {
    const grouped = groupTrailingCrcArea(
      crcForL3,
      (f) => (crcSel.l2 ? labelsOf(f).l3s : crcGroupLabel(labelsOf(f), 3)),
      8,
    )
    return metric === "mv" || crcSel.l1 || crcSel.l2 ? renormalizeCrcArea(grouped) : grouped
  }, [crcForL3, crcSel.l1, crcSel.l2, strategyLookup, metric])
  const fundCrc = useMemo(() => {
    const grouped = groupTrailingCrcArea(crcForFunds, (f) => f.name, 8)
    return metric === "mv" || crcSel.l1 || crcSel.l2 || crcSel.l3 ? renormalizeCrcArea(grouped) : grouped
  }, [crcForFunds, crcSel.l1, crcSel.l2, crcSel.l3, metric])

  function labeledFunds(): Array<{ fund: CrcFundRef; labels: CrcStrategyLabels }> {
    return source.funds.map((fund) => ({ fund, labels: labelsOf(fund) }))
  }

  function handleL1Click(name: string) {
    if (name === "其他") return
    if (crcSel.l1 === name) {
      setCrcSel(EMPTY_CRC_SEL)
      return
    }
    setCrcSel({ l1: name, l2: null, l3: null })
  }

  function handleL2Click(name: string) {
    if (name === "其他") return
    const matches = labeledFunds().filter(({ labels }) => {
      if (crcSel.l1 && labels.l1 !== crcSel.l1) return false
      const label = crcSel.l1 ? labels.l2 : crcGroupLabel(labels, 2)
      return label === name || labels.l2 === name
    })
    const l1 = crcSel.l1 ?? matches[0]?.labels.l1 ?? null
    const l2 = matches[0]?.labels.l2 ?? name.split("/").pop() ?? name
    if (crcSel.l1 === l1 && crcSel.l2 === l2) {
      setCrcSel({ l1, l2: null, l3: null })
      return
    }
    setCrcSel({ l1, l2, l3: null })
  }

  function handleL3Click(name: string) {
    if (name === "其他") return
    const matches = labeledFunds().filter(({ labels }) => {
      if (crcSel.l1 && labels.l1 !== crcSel.l1) return false
      if (crcSel.l2 && labels.l2 !== crcSel.l2) return false
      const raw = crcSel.l2 ? labels.l3s : crcGroupLabel(labels, 3)
      const keys = Array.isArray(raw) ? raw : [raw]
      return keys.includes(name) || labels.l3s.includes(name)
    })
    const first = matches[0]?.labels
    const l1 = crcSel.l1 ?? first?.l1 ?? null
    const l2 = crcSel.l2 ?? first?.l2 ?? null
    const l3 = first?.l3s.find((tag) => name === tag || name.endsWith(`/${tag}`))
      ?? name.split("/").pop()
      ?? name
    if (crcSel.l1 === l1 && crcSel.l2 === l2 && crcSel.l3 === l3) {
      setCrcSel({ l1, l2, l3: null })
      return
    }
    setCrcSel({ l1, l2, l3 })
  }

  function resetCrcSel(level: 0 | 1 | 2) {
    if (level === 0) setCrcSel(EMPTY_CRC_SEL)
    else if (level === 1) setCrcSel({ l1: crcSel.l1, l2: null, l3: null })
    else setCrcSel({ l1: crcSel.l1, l2: crcSel.l2, l3: null })
  }

  const crcCrumb = [crcSel.l1, crcSel.l2, crcSel.l3].filter(Boolean) as string[]
  const l2Hint = crcSel.l1
    ? `${crcSel.l1} 内${metricLabel}重算为 100% · 再点色块筛三级与底层`
    : `直接点色块下钻；未选一级时图例为 一级/二级`
  const l3Hint = crcSel.l2
    ? `${crcSel.l1} / ${crcSel.l2} 内${metricLabel}重算为 100% · 再点色块筛底层`
    : crcSel.l1
      ? `${crcSel.l1} 内全部三级，已重算为 100%`
      : "直接点色块下钻；一只基金多个三级标签时等权拆分"
  const fundHint = crcCrumb.length
    ? `当前范围 ${crcCrumb.join(" / ")} 内${metricLabel}重算为 100%`
    : metric === "risk"
      ? (hasMvHistory
        ? "各估值日当时市值权重 + 滚动 12 期协方差。点上级色块可缩小到底层。"
        : "没有历史估值市值，不能画底层基金风险贡献走势。")
      : "各估值日底层基金在纳入基金内的市值占比（合计 100%，不含现金）。点上级色块可缩小到底层。"
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
    const ppy = rolling.ppy || 52
    const unit = ppy >= 200 ? "日" : ppy >= 40 ? "周" : ppy >= 20 ? "双周" : "期"
    const lineColors = ["#ef4444", "#3b82f6", "#8b5cf6"]
    const vols = rolling.series.flatMap((s) => s.values).filter((v): v is number => v != null)
    const dataMax = vols.length ? Math.max(...vols) : bandHi
    const yMax = Math.max(bandHi, dataMax, 1) * 1.15
    const volSeries = rolling.series.map((s, i) => ({
      name: `${s.window}${unit}波动`,
      type: "line" as const,
      data: s.values,
      showSymbol: false,
      lineStyle: { width: 1.6, color: lineColors[i % lineColors.length] },
      itemStyle: { color: lineColors[i % lineColors.length] },
      markArea: i === 0 ? {
        silent: true,
        itemStyle: { color: "rgba(245,158,11,0.10)" },
        data: [[{ yAxis: bandLo }, { yAxis: bandHi }]],
      } : undefined,
    }))
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
        min: 0,
        max: +yMax.toFixed(1),
        axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: number) => `${v}` },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: [
        ...volSeries,
        {
          name: "风控上沿",
          type: "line" as const,
          data: rolling.dates.map(() => bandHi),
          showSymbol: false,
          lineStyle: { width: 1, type: "dashed", color: "#f59e0b" },
          itemStyle: { color: "#f59e0b" },
        },
        {
          name: "风控下沿",
          type: "line" as const,
          data: rolling.dates.map(() => bandLo),
          showSymbol: false,
          lineStyle: { width: 1, type: "dashed", color: "#f59e0b" },
          itemStyle: { color: "#f59e0b" },
        },
      ],
    }
  }, [rolling, bandLo, bandHi])

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
        hint={
          rollingSource === "product"
            ? `产品自身净值的 ${rolling.windows.join(" / ")} 期年化波动。黄带为观察区间（当前 ${bandLo}%–${bandHi}%），默认按滚动波动自动框住曲线。`
            : `产品净值点过少，改用底层组合共同窗口收益的 ${rolling.windows.join(" / ")} 期年化波动（与下方 VaR 回测同一套样本）。黄带 ${bandLo}%–${bandHi}% 按当前波动自动框住。`
        }
        calcHelp={{
          heading: "滚动波动 vs 风控带 · 计算说明",
          blocks: [
            {
              title: "收益序列",
              paragraphs: rollingSource === "product"
                ? ["优先用产品自身净值：按自然周取最后一个点，再算周收益 r_t = NAV_t / NAV_{t-1} − 1。"]
                : ["当前产品净值周样本不足 8 期，改用波动分析里底层基金共同窗口的组合收益（与「预测 VaR vs 实现损失」同一序列）。"],
            },
            {
              title: "滚动窗口",
              paragraphs: [
                "样本够长时用 13 与 26 期；不够则自动缩短为 8 / 13 或 8 期，避免整张图空白。",
              ],
              formula: `σ_ann = stdev(r_{t−w+1} … r_t) × √${rolling.ppy || 52} × 100；当前窗口 ${rolling.windows.join("、") || "—"} 期`,
            },
            {
              title: "风控带",
              paragraphs: [
                `黄虚线为观察带（当前 ${bandLo}%–${bandHi}%），默认按滚动波动中位值自动框住曲线，也可手改。不是合同止损线。曲线穿出上沿表示近期波动放大。`,
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
              value={customLow ?? String(bandLo)}
              onChange={(e) => setCustomLow(e.target.value)}
              className="w-12 h-6 rounded border border-zinc-200 px-1 text-right tabular-nums"
            />
            –
            <input
              type="number"
              min={0}
              step={0.5}
              value={customHigh ?? String(bandHi)}
              onChange={(e) => setCustomHigh(e.target.value)}
              className="w-12 h-6 rounded border border-zinc-200 px-1 text-right tabular-nums"
            />
            %
            {customLow != null || customHigh != null ? (
              <button
                type="button"
                className="ml-1 text-zinc-400 hover:text-zinc-600"
                onClick={() => {
                  setCustomLow(null)
                  setCustomHigh(null)
                }}
              >
                自动
              </button>
            ) : null}
          </span>
        )}
      >
        {hasRollingVol ? (
          <ReactECharts option={volOption} style={{ height: 280 }} notMerge />
        ) : (
          <EmptyChart text="产品净值与组合收益样本均不足，无法计算滚动波动" />
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

      <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-zinc-400">
            {metric === "mv"
              ? (mvByFund.rows.length >= 2
                ? "市值按纳入基金内归一，各层合计 100%（不含现金等非基金资产）。直接点色块下钻，下级仍为 100%。"
                : "当前区间没有历史估值市值，无法画走势。")
              : (hasMvHistory
                ? "风险贡献用各估值日当时的市值权重 + 此前 12 期收益协方差。直接点色块下钻。"
                : "没有历史估值市值，不能画历史风险贡献（不会用当前权重假装成历史）。")}
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-1 text-xs text-zinc-500">
            <button type="button" className="hover:text-red-500" onClick={() => resetCrcSel(0)}>
              全部
            </button>
            {crcCrumb.map((name, i) => (
              <span key={`${i}-${name}`} className="inline-flex items-center gap-1">
                <span className="text-zinc-300">/</span>
                <button
                  type="button"
                  className={i === crcCrumb.length - 1 ? "text-red-500 font-medium" : "hover:text-red-500"}
                  onClick={() => resetCrcSel((i + 1) as 1 | 2)}
                >
                  {name}
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded border border-zinc-200 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setMetric("risk")}
              className={metric === "risk" ? "px-2.5 py-1 bg-red-500 text-white" : "px-2.5 py-1 text-zinc-600 hover:bg-zinc-50"}
            >
              风险贡献
            </button>
            <button
              type="button"
              onClick={() => setMetric("mv")}
              className={metric === "mv" ? "px-2.5 py-1 bg-red-500 text-white" : "px-2.5 py-1 text-zinc-600 hover:bg-zinc-50"}
            >
              市值
            </button>
          </div>
          <button
            type="button"
            onClick={() => resetCrcSel(0)}
            disabled={!crcSel.l1 && !crcSel.l2 && !crcSel.l3}
            className="px-3 py-1 text-xs rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
          >
            重置
          </button>
        </div>
      </div>

      <CrcStackedChart
        title={`一级策略${metricLabel}走势`}
        hint={
          metric === "mv"
            ? "纳入基金内合计 100%。直接点色块筛选二级、三级与底层。"
            : "直接点色块筛选二级、三级与底层。下级在该一级内重算为 100%。"
        }
        emptyText={
          metric === "risk" && !hasMvHistory
            ? "没有历史估值市值，无法展开一级策略风险贡献走势"
            : metric === "mv" && mvByFund.rows.length < 2
              ? "没有历史估值市值，无法展开一级策略市值走势"
              : `样本不足，无法展开一级策略${metricLabel}`
        }
        crcArea={l1Crc}
        colorBy="strategy"
        selectedName={crcSel.l1}
        onSeriesClick={handleL1Click}
        fillToHundred={metric === "mv"}
        calcHelp={strategyCrcHelp("一级", metric)}
      />

      <CrcStackedChart
        title={`二级策略${metricLabel}走势`}
        hint={l2Hint}
        emptyText={
          metric === "risk" && !hasMvHistory
            ? "没有历史估值市值，无法展开二级策略风险贡献走势"
            : metric === "mv" && mvByFund.rows.length < 2
              ? "没有历史估值市值，无法展开二级策略市值走势"
              : `样本不足，无法展开二级策略${metricLabel}`
        }
        crcArea={l2Crc}
        colorBy="strategy"
        selectedName={crcSel.l2}
        onSeriesClick={handleL2Click}
        fillToHundred={metric === "mv"}
        calcHelp={strategyCrcHelp("二级", metric)}
      />

      <CrcStackedChart
        title={`三级策略${metricLabel}走势`}
        hint={l3Hint}
        emptyText={
          metric === "risk" && !hasMvHistory
            ? "没有历史估值市值，无法展开三级策略风险贡献走势"
            : metric === "mv" && mvByFund.rows.length < 2
              ? "没有历史估值市值，无法展开三级策略市值走势"
              : `样本不足，无法展开三级策略${metricLabel}`
        }
        crcArea={l3Crc}
        colorBy="strategy"
        selectedName={crcSel.l3}
        onSeriesClick={handleL3Click}
        fillToHundred={metric === "mv"}
        calcHelp={strategyCrcHelp("三级", metric)}
      />

      <CrcStackedChart
        title={`底层基金${metricLabel}走势`}
        hint={fundHint}
        emptyText={
          metric === "risk" && !hasMvHistory
            ? "没有历史估值市值，无法展开底层基金风险贡献走势"
            : metric === "mv" && mvByFund.rows.length < 2
              ? "没有历史估值市值，无法展开底层基金市值走势"
              : `样本不足，无法展开底层基金${metricLabel}走势`
        }
        crcArea={fundCrc}
        colorBy="series"
        fillToHundred={metric === "mv"}
        calcHelp={fundCrcHelp(metric)}
      />

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

function crcSeriesColor(name: string, index: number, colorBy: "series" | "strategy"): string {
  if (name === "其他") return "#a1a1aa"
  if (colorBy === "strategy") return strategyColor(name.split("/")[0], index)
  return CRC_COLORS[index % CRC_COLORS.length]
}

function strategyCrcHelp(level: "一级" | "二级" | "三级", metric: CrcMetric): ChartCalcHelp {
  const noun = metric === "risk" ? "风险贡献" : "市值"
  return {
    heading: `${level}策略${noun}走势 · 计算说明`,
    blocks: [
      {
        title: metric === "risk" ? "先分解基金，再按策略加总" : "按估值日市值加总",
        paragraphs: metric === "risk"
          ? [
            "每个估值日用当日市值权重（邮件估值表写入数据库的历史持仓），对截止该日的 12 个共同窗口收益估协方差，再欧拉分解后按策略加总。没有历史估值则不画。",
          ]
          : [
            "用历史估值表里各估值日的底层基金市值，在纳入基金内归一成 100%（现金等非基金资产不进图）。没有历史估值时不画。",
          ],
        formula: metric === "risk"
          ? (level === "三级"
            ? "CRC_策略,t = Σ (CRC_i,t / 该基金三级标签数)"
            : "CRC_策略,t = Σ CRC_i,t")
          : (level === "三级"
            ? "市值_策略,t = Σ (市值权重_i,t / 该基金三级标签数)"
            : "市值_策略,t = Σ 市值权重_i,t"),
      },
      {
        title: "怎么读",
        bullets: [
          metric === "mv"
            ? `堆叠合计 100%，是各${level}策略占纳入基金市值的比重。`
            : `未下钻时堆叠为各${level}策略占组合的${noun}。`,
          `直接点图里的色块下钻。下级图只保留该范围内的基金，并把它们的${noun}重新归一成 100%。再点一次取消。`,
          level === "三级"
            ? "一只基金有多个三级标签时，在标签间等权拆分。"
            : metric === "risk"
              ? "面积抬升：该策略当日权重变大，或它与组合的相关/波动变高。"
              : "某层变厚：该策略在组合里的市值占比上升。",
          metric === "risk" ? "负面积表示该策略在对冲组合风险。" : "市值权重通常非负。",
        ],
      },
    ],
  }
}

function fundCrcHelp(metric: CrcMetric): ChartCalcHelp {
  if (metric === "mv") {
    return {
      heading: "底层基金市值走势 · 计算说明",
      blocks: [
        {
          title: "每个点",
          paragraphs: [
            "各估值日该底层基金占纳入基金总市值的比重。只画最新市值最高的 8 只，其余并入「其他」。现金等非基金资产不进图。",
          ],
          formula: "市值权重_i,t = 基金市值_i,t / Σ 纳入基金市值_t × 100",
        },
        {
          title: "怎么读",
          bullets: [
            "堆叠合计 100%。某层变厚：该基金在纳入基金里的市值占比上升。",
            "从上级策略点进来后，只保留该范围内的基金并重算为 100%。",
          ],
        },
      ],
    }
  }
  return {
    heading: "底层基金风险贡献走势 · 计算说明",
    blocks: [
      {
        title: "当日权重、滚动协方差",
        paragraphs: [
          "每个估值日用当日市值权重 w_t（纳入基金内归一），对截止该日的 12 个共同窗口收益估 Σ_t，再欧拉分解。没有历史估值市值则不画。只画最新风险贡献最高的 8 只，其余并入「其他」。",
        ],
        formula: "CRC_i,t = w_{i,t} × (Σ_t w_t)_i / (w_t' Σ_t w_t) × 100",
      },
      {
        title: "怎么读",
        bullets: [
          "堆叠面积之和约为 100%。某层持续变厚：该基金对组合波动的贡献在变大。",
          "可能是它当日市值权重上升，或与组合的相关/波动变高。负面积表示该基金在对冲组合风险。",
        ],
      },
    ],
  }
}

function hitStackedBand(names: string[], values: Record<string, number>, y: number): string | null {
  if (y >= 0) {
    let acc = 0
    for (const name of names) {
      const v = Math.max(0, values[name] ?? 0)
      if (v <= 1e-8) continue
      const next = acc + v
      if (y >= acc && y <= next + 1e-6) return name
      acc = next
    }
  } else {
    let acc = 0
    for (const name of names) {
      const v = Math.min(0, values[name] ?? 0)
      if (v >= -1e-8) continue
      const next = acc + v
      if (y <= acc && y >= next - 1e-6) return name
      acc = next
    }
  }
  return null
}

function CrcStackedChart({
  title,
  hint,
  emptyText,
  crcArea,
  colorBy,
  calcHelp,
  selectedName = null,
  onSeriesClick,
  fillToHundred = false,
}: {
  title: string
  hint: string
  emptyText: string
  crcArea: { dates: string[]; names: string[]; rows: Array<{ date: string; values: Record<string, number> }> }
  colorBy: "series" | "strategy"
  calcHelp: ChartCalcHelp
  selectedName?: string | null
  onSeriesClick?: (name: string) => void
  fillToHundred?: boolean
}) {
  const chartRef = useRef<ReactECharts>(null)
  const names = crcArea.names.filter(
    (n) => n !== "其他" || crcArea.rows.some((r) => Math.abs(r.values["其他"] ?? 0) > 0.5),
  )
  const clickRef = useRef({ names, rows: crcArea.rows, onSeriesClick })
  clickRef.current = { names, rows: crcArea.rows, onSeriesClick }

  useEffect(() => {
    if (!onSeriesClick) return
    const handler = (e: { offsetX: number; offsetY: number }) => {
      const chart = chartRef.current?.getEchartsInstance()
      if (!chart) return
      const pixel = [e.offsetX, e.offsetY]
      if (!chart.containPixel({ gridIndex: 0 }, pixel)) return
      const point = chart.convertFromPixel({ gridIndex: 0 }, pixel)
      if (!point || point.length < 2) return
      const { names: bandNames, rows, onSeriesClick: click } = clickRef.current
      if (!click) return
      const dataIndex = Math.min(rows.length - 1, Math.max(0, Math.round(point[0])))
      const name = hitStackedBand(bandNames, rows[dataIndex]?.values ?? {}, point[1])
      if (name && name !== "其他") click(name)
    }
    const bind = () => {
      const chart = chartRef.current?.getEchartsInstance()
      chart?.getZr().on("click", handler)
    }
    const unbind = () => {
      const chart = chartRef.current?.getEchartsInstance()
      chart?.getZr().off("click", handler)
    }
    bind()
    const timer = window.setTimeout(bind, 0)
    return () => {
      window.clearTimeout(timer)
      unbind()
    }
  }, [onSeriesClick])

  const option = {
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    legend: {
      top: 4,
      type: "scroll",
      selectedMode: false,
      textStyle: { fontSize: 10 },
      data: names,
    },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ seriesName: string; dataIndex: number; marker: string }>) => {
        const i = params[0]?.dataIndex
        if (i == null) return ""
        const seen = new Set<string>()
        const lines = [`<b>${crcArea.dates[i]}</b>`]
        for (const p of params) {
          if (seen.has(p.seriesName)) continue
          seen.add(p.seriesName)
          const v = crcArea.rows[i]?.values[p.seriesName] ?? 0
          lines.push(`${p.marker}${p.seriesName}　${v.toFixed(1)}%`)
        }
        if (fillToHundred) {
          const total = names.reduce((s, n) => s + (crcArea.rows[i]?.values[n] ?? 0), 0)
          lines.push(`合计　${total.toFixed(1)}%`)
        }
        return lines.join("<br/>")
      },
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: crcArea.dates,
      axisLabel: { fontSize: 10, color: "#71717a", formatter: (v: string) => v.slice(0, 7) },
    },
    yAxis: {
      type: "value",
      name: "%",
      min: fillToHundred ? 0 : undefined,
      max: fillToHundred ? 100 : undefined,
      axisLabel: { fontSize: 10, color: "#71717a" },
      splitLine: { lineStyle: { color: "#f4f4f5" } },
    },
    series: names.flatMap((name, i) => {
      const color = crcSeriesColor(name, i, colorBy)
      const values = crcArea.rows.map((r) => +(r.values[name] ?? 0).toFixed(2))
      const active = !selectedName || selectedName === name
      const base = {
        name,
        type: "line" as const,
        showSymbol: false,
        symbol: "none" as const,
        smooth: false,
        stackStrategy: "samesign" as const,
        triggerLineEvent: true,
        cursor: onSeriesClick && name !== "其他" ? "pointer" : "default",
        lineStyle: { width: selectedName === name ? 1.4 : 0.5, color },
        areaStyle: { color, opacity: active ? 0.88 : 0.22 },
        itemStyle: { color },
        emphasis: { focus: "series" as const },
      }
      return [
        {
          ...base,
          id: `${name}__pos`,
          stack: "crc-pos",
          data: values.map((v) => (v > 0 ? v : 0)),
        },
        {
          ...base,
          id: `${name}__neg`,
          stack: "crc-neg",
          data: values.map((v) => (v < 0 ? v : 0)),
        },
      ]
    }),
  }

  return (
    <FofAnalysisChartCard title={title} hint={hint} calcHelp={calcHelp}>
      {crcArea.rows.length < 3 ? (
        <EmptyChart text={emptyText} />
      ) : (
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ height: 300, cursor: onSeriesClick ? "pointer" : undefined }}
          notMerge
        />
      )}
    </FofAnalysisChartCard>
  )
}
