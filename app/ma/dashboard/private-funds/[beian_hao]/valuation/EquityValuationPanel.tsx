"use client"

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

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-zinc-100">
        <div className="text-red-500 font-semibold text-sm">股票风险敞口</div>
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
