"use client"

import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { getNavFieldValue, type NavRow } from "../components/shared"
import { computeFofPortfolioVar } from "@/lib/fof-portfolio-var"
import { isValuationCashHoldingName } from "@/lib/valuation-holding-display-name"
import {
  computeDrawdownCoincidence,
  computeEquityRegimes,
  computeSleeveEquityRegimes,
  computeStressMonths,
  computeUpDownCapture,
  computeVolRegimes,
  monthlyReturnsFromBench,
  monthlyReturnsFromNav,
  strategyColor,
  type BenchPoint,
} from "@/lib/fof-deeper-analysis"
import type { ReturnCurveSeries } from "./FofReturnCurvePanel"
import type { FundHoldingRow } from "./FofFundsPanel"
import { FofAnalysisChartCard } from "./FofAnalysisChartCard"
import { ValuationEmptyAnalysis } from "./ValuationEmptyAnalysis"

type Props = {
  displayName: string
  navRows: NavRow[]
  navType: string
  fromDate?: string
  toDate?: string
  series: ReturnCurveSeries[]
  fundHoldings: FundHoldingRow[]
  navLoading?: boolean
  curvesLoading?: boolean
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

async function fetchBench(key: string, from: string, to: string): Promise<BenchPoint[]> {
  const r = await fetch(
    `/ma/api/private-funds/benchmark?key=${encodeURIComponent(key)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  )
  if (!r.ok) return []
  const json = await r.json() as { ok?: boolean; data?: BenchPoint[] }
  return json.ok && Array.isArray(json.data) ? json.data : []
}

export function FofRegimeAttributionPanel({
  displayName,
  navRows,
  navType,
  fromDate,
  toDate,
  series,
  fundHoldings,
  navLoading,
  curvesLoading,
}: Props) {
  const [equity, setEquity] = useState<BenchPoint[]>([])
  const [cta, setCta] = useState<BenchPoint[]>([])
  const [bond, setBond] = useState<BenchPoint[]>([])
  const [benchLoading, setBenchLoading] = useState(false)

  useEffect(() => {
    if (!fromDate || !toDate) return
    const controller = new AbortController()
    setBenchLoading(true)
    void Promise.all([
      fetchBench("IF", fromDate, toDate),
      fetchBench("NHCI.NH", fromDate, toDate),
      fetchBench("511010.SH", fromDate, toDate),
    ]).then(([eq, nh, bd]) => {
      if (controller.signal.aborted) return
      setEquity(eq)
      setCta(nh)
      setBond(bd)
    }).finally(() => {
      if (!controller.signal.aborted) setBenchLoading(false)
    })
    return () => controller.abort()
  }, [fromDate, toDate])

  const fundNav = useMemo(() => {
    return navRows
      .map((row) => {
        const nav = getNavFieldValue(row, navType)
        const date = row.price_date?.slice(0, 10)
        if (!date || !Number.isFinite(nav) || nav <= 0) return null
        return { date, nav }
      })
      .filter((p): p is { date: string; nav: number } => p != null)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [navRows, navType])

  const holdings = useMemo(
    () => fundHoldings.filter((r) => !isStockRow(r) && !isValuationCashHoldingName(r.fundName) && r.marketValue > 0),
    [fundHoldings],
  )

  const varResult = useMemo(
    () => computeFofPortfolioVar({ holdings, series, fromDate, toDate }),
    [holdings, series, fromDate, toDate],
  )

  const fundMonthly = useMemo(() => monthlyReturnsFromNav(fundNav), [fundNav])
  const eqMonthly = useMemo(() => monthlyReturnsFromBench(equity), [equity])
  const ctaMonthly = useMemo(() => monthlyReturnsFromBench(cta), [cta])
  const bondMonthly = useMemo(() => monthlyReturnsFromBench(bond), [bond])

  const equityRegimes = useMemo(
    () => computeEquityRegimes(fundMonthly, eqMonthly),
    [fundMonthly, eqMonthly],
  )
  const volRegimes = useMemo(
    () => computeVolRegimes(fundMonthly, eqMonthly),
    [fundMonthly, eqMonthly],
  )
  const sleeveRegimes = useMemo(
    () => computeSleeveEquityRegimes(varResult, eqMonthly),
    [varResult, eqMonthly],
  )
  const capture = useMemo(
    () => computeUpDownCapture(fundMonthly, [
      { label: "沪深300", series: eqMonthly },
      { label: "南华商品", series: ctaMonthly },
      { label: "国债ETF", series: bondMonthly },
    ]),
    [fundMonthly, eqMonthly, ctaMonthly, bondMonthly],
  )
  const stress = useMemo(
    () => computeStressMonths(fundMonthly, eqMonthly, 10),
    [fundMonthly, eqMonthly],
  )
  const dd = useMemo(
    () => computeDrawdownCoincidence(fundNav, equity),
    [fundNav, equity],
  )

  const regimeOption = useMemo(() => {
    const cats = [...equityRegimes.map((b) => b.label), ...volRegimes.map((b) => b.label)]
    const fund = [...equityRegimes, ...volRegimes].map((b) => +b.avgFundPct.toFixed(2))
    const bench = [...equityRegimes, ...volRegimes].map((b) => +b.avgBenchPct.toFixed(2))
    return {
      grid: { left: 48, right: 16, top: 36, bottom: 48 },
      legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
      tooltip: {
        trigger: "axis",
        formatter: (params: Array<{ dataIndex: number; seriesName: string; value: number }>) => {
          const i = params[0]?.dataIndex
          if (i == null) return ""
          const row = [...equityRegimes, ...volRegimes][i]
          return `<b>${row.label}</b>（${row.count} 个月）<br/>${displayName} ${row.avgFundPct.toFixed(2)}%<br/>沪深300 ${row.avgBenchPct.toFixed(2)}%`
        },
      },
      xAxis: {
        type: "category",
        data: cats,
        axisLabel: { fontSize: 10, color: "#52525b", interval: 0, rotate: 20 },
      },
      yAxis: {
        type: "value",
        name: "%",
        axisLabel: { fontSize: 10, color: "#71717a" },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: [
        {
          name: displayName,
          type: "bar",
          data: fund.map((v) => ({
            value: v,
            itemStyle: { color: v >= 0 ? "rgba(239,68,68,0.85)" : "rgba(16,185,129,0.8)", borderRadius: [3, 3, 0, 0] },
          })),
          barMaxWidth: 18,
        },
        {
          name: "沪深300",
          type: "bar",
          data: bench.map((v) => ({
            value: v,
            itemStyle: { color: "rgba(113,113,122,0.45)", borderRadius: [3, 3, 0, 0] },
          })),
          barMaxWidth: 18,
        },
      ],
    }
  }, [displayName, equityRegimes, volRegimes])

  const sleeveOption = useMemo(() => {
    const strategies = sleeveRegimes.map((s) => s.strategy)
    const labels = ["股市上涨月", "股市震荡月", "股市下跌月"]
    return {
      grid: { left: 48, right: 16, top: 36, bottom: 36 },
      legend: { top: 4, type: "scroll", textStyle: { fontSize: 10 } },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { fontSize: 11, color: "#52525b" },
      },
      yAxis: {
        type: "value",
        name: "%",
        axisLabel: { fontSize: 10, color: "#71717a" },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: sleeveRegimes.map((s, i) => ({
        name: s.strategy,
        type: "bar",
        data: labels.map((lab) => {
          const b = s.buckets.find((x) => x.label === lab)
          return b ? +b.avgFundPct.toFixed(2) : 0
        }),
        itemStyle: { color: strategyColor(s.strategy, i) },
        barMaxWidth: 14,
      })),
    }
  }, [sleeveRegimes])

  const captureOption = useMemo(() => ({
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
    tooltip: {
      trigger: "axis",
      formatter: (params: Array<{ seriesName: string; value: number; dataIndex: number }>) => {
        const i = params[0]?.dataIndex
        if (i == null) return ""
        const row = capture[i]
        return `<b>${row.label}</b><br/>上涨捕获 ${row.up == null ? "—" : row.up.toFixed(2)}<br/>下跌捕获 ${row.down == null ? "—" : row.down.toFixed(2)}`
      },
    },
    xAxis: {
      type: "category",
      data: capture.map((c) => c.label),
      axisLabel: { fontSize: 11, color: "#52525b" },
    },
    yAxis: {
      type: "value",
      name: "捕获比",
      axisLabel: { fontSize: 10, color: "#71717a" },
      splitLine: { lineStyle: { color: "#f4f4f5" } },
    },
    series: [
      {
        name: "上涨捕获",
        type: "bar",
        data: capture.map((c) => (c.up == null ? null : +c.up.toFixed(2))),
        itemStyle: { color: "rgba(239,68,68,0.85)", borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 22,
      },
      {
        name: "下跌捕获",
        type: "bar",
        data: capture.map((c) => (c.down == null ? null : +c.down.toFixed(2))),
        itemStyle: { color: "rgba(16,185,129,0.85)", borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 22,
      },
    ],
  }), [capture])

  const stressOption = useMemo(() => {
    const worst = [...stress.worst].reverse()
    return {
      grid: { left: 64, right: 16, top: 36, bottom: 28 },
      legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "value",
        name: "%",
        axisLabel: { fontSize: 10, color: "#71717a" },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      yAxis: {
        type: "category",
        data: worst.map((r) => r.ym),
        axisLabel: { fontSize: 10, color: "#52525b" },
      },
      series: [
        {
          name: "沪深300",
          type: "bar",
          data: worst.map((r) => +r.benchPct.toFixed(2)),
          itemStyle: { color: "rgba(113,113,122,0.45)" },
          barMaxWidth: 8,
        },
        {
          name: displayName,
          type: "bar",
          data: worst.map((r) => +r.fundPct.toFixed(2)),
          itemStyle: { color: "rgba(239,68,68,0.85)" },
          barMaxWidth: 8,
        },
      ],
    }
  }, [displayName, stress])

  const ddOption = useMemo(() => ({
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    legend: { top: 4, right: 8, textStyle: { fontSize: 11 } },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: dd.map((p) => p.date),
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
        name: displayName,
        type: "line",
        showSymbol: false,
        data: dd.map((p) => p.fundDD),
        lineStyle: { width: 1.6, color: "#ef4444" },
        areaStyle: { color: "rgba(239,68,68,0.08)" },
        itemStyle: { color: "#ef4444" },
      },
      {
        name: "沪深300",
        type: "line",
        showSymbol: false,
        data: dd.map((p) => p.benchDD),
        lineStyle: { width: 1.4, color: "#71717a" },
        itemStyle: { color: "#71717a" },
      },
    ],
  }), [dd, displayName])

  const busy = navLoading || benchLoading || curvesLoading

  if (busy && fundNav.length < 2) {
    return (
      <div className="bg-white rounded-lg border border-zinc-100 p-12 text-center text-sm text-zinc-400">
        加载净值与市场环境…
      </div>
    )
  }

  if (fundNav.length < 4) {
    return <ValuationEmptyAnalysis message="所选区间净值不足，无法做市场环境归因。" />
  }

  return (
    <>
      <FofAnalysisChartCard
        title="环境收益：股市涨跌与波动分档"
        hint="按沪深300当月收益划分上涨（>1%）、震荡、下跌（<-1%）；再按月绝对收益分低/中/高波动。灰柱为同期指数，红/绿为产品。"
      >
        {equityRegimes.every((b) => b.count === 0) ? (
          <EmptyChart text="沪深300 或产品月度收益不足" />
        ) : (
          <ReactECharts option={regimeOption} style={{ height: 300 }} notMerge />
        )}
      </FofAnalysisChartCard>

      <FofAnalysisChartCard
        title="策略在股市环境中的表现"
        hint="用当前持仓市值权重把底层净值合成策略袖套，看各一级策略更吃上涨、震荡还是下跌月。"
      >
        {sleeveRegimes.length === 0 ? (
          <EmptyChart text="底层净值不足，无法拆策略环境收益" />
        ) : (
          <ReactECharts option={sleeveOption} style={{ height: 300 }} notMerge />
        )}
      </FofAnalysisChartCard>

      <FofAnalysisChartCard
        title="上涨 / 下跌捕获比"
        hint="捕获比 = 产品在基准上涨（或下跌）月份的累计收益 / 基准同期累计收益。下跌捕获接近 0 表示股灾月保护好；接近 1 则几乎跟着基准跌。"
      >
        {capture.every((c) => c.up == null && c.down == null) ? (
          <EmptyChart text="基准序列不足，无法计算捕获比" />
        ) : (
          <ReactECharts option={captureOption} style={{ height: 280 }} notMerge />
        )}
      </FofAnalysisChartCard>

      <FofAnalysisChartCard
        title="沪深300 最差 10 个月"
        hint="指数最差的月份里产品是否同步深亏。若红柱接近 0 而灰柱很负，波动控制在起作用。"
      >
        {stress.worst.length === 0 ? (
          <EmptyChart text="重叠月份不足" />
        ) : (
          <ReactECharts option={stressOption} style={{ height: Math.max(260, stress.worst.length * 22 + 56) }} notMerge />
        )}
      </FofAnalysisChartCard>

      <FofAnalysisChartCard
        title="回撤是否与股市同步"
        hint="产品和沪深300各自相对前高的回撤。低谷错开说明分散化有效；重叠则组合在股灾中没有对冲。"
      >
        {dd.length < 8 ? (
          <EmptyChart text="净值样本不足，无法画回撤对照" />
        ) : (
          <ReactECharts option={ddOption} style={{ height: 300 }} notMerge />
        )}
      </FofAnalysisChartCard>
    </>
  )
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="h-[180px] flex items-center justify-center text-sm text-zinc-400 px-4 text-center">
      {text}
    </div>
  )
}
