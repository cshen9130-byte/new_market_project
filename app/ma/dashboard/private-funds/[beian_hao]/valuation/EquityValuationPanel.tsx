"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { AssetHoldingsTable, type AssetHoldingTableRow } from "./AssetHoldingsTable"

export type ValuationHoldingDetailRow = AssetHoldingTableRow

export type StockRiskExposure = {
  stockLongMv: number
  stockLongPct: number
  stockShortMv: number
  stockShortPct: number
  indexLongMv: number
  indexLongPct: number
  indexShortMv: number
  indexShortPct: number
  etfLongMv: number
  etfLongPct: number
  totalExposurePct: number
}

type Props = {
  stockHoldings: ValuationHoldingDetailRow[]
  bondHoldings: ValuationHoldingDetailRow[]
  wealthHoldings: ValuationHoldingDetailRow[]
  otherHoldings: ValuationHoldingDetailRow[]
  stockRiskExposure: StockRiskExposure | null
  valuationDate: string | null
  displayName: string
}

function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`
}

function fmtWan(n: number): string {
  return `${(n / 10_000).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 万`
}

function AnalyticsPlaceholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm p-4">
      <div className="text-red-500 font-semibold text-sm mb-2">{title}</div>
      <div className="h-32 flex items-center justify-center text-sm text-zinc-400 border border-dashed border-zinc-200 rounded-lg">
        {hint}
      </div>
    </div>
  )
}

function StockRiskExposurePanel({ exposure }: { exposure: StockRiskExposure }) {
  const rows = [
    { label: "股票多头", mv: exposure.stockLongMv, pct: exposure.stockLongPct },
    { label: "股票空头", mv: exposure.stockShortMv, pct: exposure.stockShortPct },
    { label: "股指多头", mv: exposure.indexLongMv, pct: exposure.indexLongPct },
    { label: "股指空头", mv: exposure.indexShortMv, pct: exposure.indexShortPct },
    { label: "ETF多头", mv: exposure.etfLongMv, pct: exposure.etfLongPct },
  ]

  const netMv = exposure.stockLongMv - exposure.stockShortMv
    + exposure.etfLongMv + exposure.indexLongMv - exposure.indexShortMv
  const netPct = exposure.stockLongPct - exposure.stockShortPct
    + exposure.etfLongPct + exposure.indexLongPct - exposure.indexShortPct
  const hedgeSide = Math.abs(netPct) < 0.05
    ? "none"
    : netMv > 0
      ? "short_futures"
      : "long_futures"

  const waterfallOption = useMemo(() => {
    const steps = [
      { name: "股票多头", value: exposure.stockLongPct },
      { name: "ETF多头", value: exposure.etfLongPct },
      { name: "股指多头", value: exposure.indexLongPct },
      { name: "股票空头", value: -exposure.stockShortPct },
      { name: "股指空头", value: -exposure.indexShortPct },
    ]
    const names = [...steps.map((s) => s.name), "单边敞口"]
    const help: Array<number | string> = []
    const up: Array<number | string> = []
    const down: Array<number | string> = []
    let acc = 0
    for (const step of steps) {
      if (step.value >= 0) {
        help.push(+acc.toFixed(2))
        up.push(+step.value.toFixed(2))
        down.push("-")
        acc += step.value
      } else {
        acc += step.value
        help.push(+acc.toFixed(2))
        up.push("-")
        down.push(+Math.abs(step.value).toFixed(2))
      }
    }
    help.push("-")
    const total = +acc.toFixed(2)
    up.push(total >= 0 ? total : "-")
    down.push(total < 0 ? Math.abs(total) : "-")
    return {
      grid: { left: 48, right: 20, top: 28, bottom: 36 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: Array<{ seriesName: string; value: number | string; axisValue: string }>) => {
          const shown = params.filter((p) => p.seriesName !== "辅助" && p.value !== "-")
          const v = shown[0]?.value
          const n = typeof v === "number" ? v : Number(v)
          if (!Number.isFinite(n)) return shown[0]?.axisValue ?? ""
          return `${shown[0]?.axisValue}<br/>${n >= 0 ? "+" : ""}${n.toFixed(2)}% NAV`
        },
      },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { fontSize: 10, color: "#71717a", interval: 0 },
      },
      yAxis: {
        type: "value",
        name: "% NAV",
        axisLabel: { fontSize: 10, color: "#71717a" },
        splitLine: { lineStyle: { color: "#f4f4f5" } },
      },
      series: [
        { name: "辅助", type: "bar", stack: "wf", data: help, itemStyle: { color: "transparent" }, silent: true, barMaxWidth: 36 },
        { name: "增加", type: "bar", stack: "wf", data: up, itemStyle: { color: "#ef4444" }, barMaxWidth: 36 },
        { name: "减少", type: "bar", stack: "wf", data: down, itemStyle: { color: "#10b981" }, barMaxWidth: 36 },
      ],
    }
  }, [exposure])

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-zinc-100">
        <div className="text-red-500 font-semibold text-sm">股票风险敞口</div>
        <div className="text-[11px] text-zinc-400 mt-0.5">
          单边敞口 = 股票/ETF/股指多头 − 股票/股指空头。净多头时可用股指期货开空自行对冲。
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-50 border-b border-zinc-100 text-xs">
            <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-28" />
            {rows.map((r) => (
              <th key={r.label} className="px-3 py-2.5 text-center font-semibold text-zinc-500 whitespace-nowrap">
                {r.label}
              </th>
            ))}
            <th className="px-3 py-2.5 text-center font-semibold text-zinc-500 whitespace-nowrap">敞口合计</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-zinc-50">
            <td className="px-4 py-2.5 text-zinc-600 font-medium">市值</td>
            {rows.map((r) => (
              <td key={`${r.label}-mv`} className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                {fmtMoney(r.mv)}
              </td>
            ))}
            <td className="px-3 py-2.5 text-center tabular-nums text-zinc-400">—</td>
          </tr>
          <tr>
            <td className="px-4 py-2.5 text-zinc-600 font-medium">市值占比 (%)</td>
            {rows.map((r) => (
              <td key={`${r.label}-pct`} className="px-3 py-2.5 text-center tabular-nums text-zinc-800">
                {fmtPct(r.pct)}
              </td>
            ))}
            <td className="px-3 py-2.5 text-center tabular-nums text-red-500 font-medium">
              {fmtPct(exposure.totalExposurePct)}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 px-4 pt-3">
        <div className="rounded-md border border-zinc-100 bg-zinc-50/70 px-3 py-2">
          <div className="text-[11px] text-zinc-500">单边敞口</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900">{fmtPct(netPct)}</div>
          <div className="mt-0.5 text-[11px] text-zinc-400">{fmtWan(netMv)}</div>
        </div>
        <div className="rounded-md border border-zinc-100 bg-zinc-50/70 px-3 py-2">
          <div className="text-[11px] text-zinc-500">建议对冲名义</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900">{fmtWan(Math.abs(netMv))}</div>
          <div className="mt-0.5 text-[11px] text-zinc-400">
            {hedgeSide === "short_futures" ? "建议开空股指期货" : hedgeSide === "long_futures" ? "建议开多股指期货" : "无需额外对冲"}
          </div>
        </div>
        <div className="rounded-md border border-zinc-100 bg-zinc-50/70 px-3 py-2 col-span-2 lg:col-span-1">
          <div className="text-[11px] text-zinc-500">已有股指空头</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900">{fmtPct(exposure.indexShortPct)}</div>
          <div className="mt-0.5 text-[11px] text-zinc-400">{fmtWan(exposure.indexShortMv)}</div>
        </div>
      </div>
      <ReactECharts option={waterfallOption} style={{ height: 260 }} notMerge />
      <p className="px-4 pb-3 text-[11px] leading-5 text-zinc-400">
        {hedgeSide === "none"
          ? "多空已经基本对冲，不必再开股指期货。"
          : hedgeSide === "short_futures"
            ? `净多头 ${fmtPct(netPct)}，若要自行对冲可在 IF/IC/IM/IH 开空，名义约 ${fmtWan(Math.abs(netMv))}。`
            : `净空头 ${fmtPct(netPct)}，若要回到中性可在股指期货开多，名义约 ${fmtWan(Math.abs(netMv))}。`}
      </p>
    </div>
  )
}

export function EquityValuationPanel({
  stockHoldings,
  bondHoldings,
  wealthHoldings,
  otherHoldings,
  stockRiskExposure,
  valuationDate,
  displayName,
}: Props) {
  return (
    <>
      <AnalyticsPlaceholder
        title="股票风格统计"
        hint="风格统计需接入指数成分数据，后续版本开放"
      />
      <AnalyticsPlaceholder
        title="股票市值统计"
        hint="市值分布需接入个股市值数据，后续版本开放"
      />
      <AnalyticsPlaceholder
        title="股票行业配置 / 行业偏离度"
        hint="行业分析需接入申万行业分类数据，后续版本开放"
      />

      {stockRiskExposure && <StockRiskExposurePanel exposure={stockRiskExposure} />}

      <AnalyticsPlaceholder
        title="股票风格归因"
        hint="CNE5 风格归因需接入因子暴露数据，后续版本开放"
      />

      <AssetHoldingsTable
        title="Top50 股票持仓"
        rows={stockHoldings}
        valuationDate={valuationDate}
        displayName={displayName}
        exportLabel="Top50股票持仓"
        topN={50}
        statusColumnLabel="停牌信息"
      />

      <AssetHoldingsTable
        title="债券"
        subtitle="债券持仓"
        rows={bondHoldings}
        valuationDate={valuationDate}
        displayName={displayName}
        exportLabel="债券持仓"
        accent="red"
        statusColumnLabel="停牌信息"
      />

      <AssetHoldingsTable
        title="理财"
        subtitle="理财持仓"
        rows={wealthHoldings}
        valuationDate={valuationDate}
        displayName={displayName}
        exportLabel="理财持仓"
        accent="red"
        statusColumnLabel="停牌信息"
      />

      <AssetHoldingsTable
        title="其他持仓"
        rows={otherHoldings}
        valuationDate={valuationDate}
        displayName={displayName}
        exportLabel="其他持仓"
        accent="red"
        showCategory
        statusColumnLabel="停牌信息"
      />
    </>
  )
}
