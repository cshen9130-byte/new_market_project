"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowLeft, BarChart3, ChevronDown, ChevronUp, Database, FileSpreadsheet, Mail, Save, ScanSearch, Trash2, TrendingUp, UploadCloud } from "lucide-react"
import { Input } from "@/components/ui/input"

import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false })

type SettlementAnalysisChartItem = {
  label: string
  value: number
  netValue?: number
  mtmPl?: number
}

type SettlementAnalysisSectorItem = {
  sector: string
  longValue: number
  shortValue: number
  grossValue: number
  netValue: number
  mtmPl: number
}

type SettlementAnalysisPosition = {
  symbol: string
  productCode: string
  productName: string
  instrument: string
  exchange: string
  sector: string
  longLots: number
  shortLots: number
  longMarketValue: number
  shortMarketValue: number
  grossMarketValue: number
  netMarketValue: number
  mtmPl: number
  marginOccupied: number
}

type SettlementAnalysisResponse = {
  sourceFileName: string
  summary: {
    clientId: string
    clientName: string
    tradeDate: string
    dateRangeRaw: string
    clientEquity: number | null
    balanceCf: number | null
    marginOccupied: number | null
    fundAvailable: number | null
    riskDegreeRatio: number | null
    realizedPl: number | null
    mtmPl: number | null
    longMarketValue: number
    shortMarketValue: number
    grossExposure: number
    netExposure: number
    grossLeverage: number | null
    netExposureRatio: number | null
    positionCount: number
    detailRowCount: number
    sectorCount: number
    topPositionName: string | null
    topPositionShare: number | null
    topSectorName: string | null
    topSectorShare: number | null
  }
  charts: {
    holdings: SettlementAnalysisChartItem[]
    sectors: SettlementAnalysisSectorItem[]
    directions: SettlementAnalysisChartItem[]
    exchanges: SettlementAnalysisChartItem[]
  }
  positions: SettlementAnalysisPosition[]
  strategyInference: {
    primaryStrategy: string
    candidateStrategies: string[]
    confidence: "high" | "medium" | "low"
    bias: "long" | "short" | "neutral"
    signals: string[]
    risks: string[]
  }
  warnings: string[]
}

type AxisTooltipParam = {
  seriesName: string
  value: number
  color: string
  dataIndex: number
}

// ---- DB analysis types (mirror lib/server/guoxin-db-analysis.ts) ----

type GuoxinEquityPoint = {
  date: string
  clientEquity: number
  riskDegree: number
  marginOccupied: number
  mtmPl: number
  realizedPl: number
}

type GuoxinEquityStats = {
  startDate: string
  endDate: string
  startEquity: number
  endEquity: number
  returnPct: number
  feeTotal: number
  maxRiskDegree: number
  totalDays: number
}

type GuoxinTurnoverItem = {
  product: string
  turnover: number
  turnoverPct: number
  lots: number
}

type GuoxinNettingRow = {
  settlementDate: string
  product: string
  longLots: number
  shortLots: number
  netLots: number
  mtmPl: number
  margin: number
}

type GuoxinTradeClusterItem = {
  instrument: string
  bs: string
  lots: number
  avgPrice: number
  turnover: number
  fees: number
}

type GuoxinTradeCluster = {
  tradeDate: string
  product: string
  items: GuoxinTradeClusterItem[]
  totalTurnover: number
  totalFees: number
}

type GuoxinCloseClusterItem = {
  instrument: string
  bs: string
  lots: number
  realizedPl: number
}

type GuoxinCloseCluster = {
  settlementDate: string
  product: string
  totalLots: number
  totalRealizedPl: number
  items: GuoxinCloseClusterItem[]
}

type GuoxinDBAnalysisResponse = {
  dateRange: { start: string; end: string }
  equityStats: GuoxinEquityStats
  equityHistory: GuoxinEquityPoint[]
  turnover: GuoxinTurnoverItem[]
  productNetting: GuoxinNettingRow[]
  tradeClusters: GuoxinTradeCluster[]
  closeClusters: GuoxinCloseCluster[]
  uniqueProducts: string[]
}

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".xlsb"]

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }
  return fallback
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "--"
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatSignedCurrency(value: number | null | undefined) {
  if (value == null) return "--"
  const sign = value > 0 ? "+" : value < 0 ? "-" : ""
  return `${sign}${formatCurrency(Math.abs(value))}`
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return "--"
  return `${(value * 100).toFixed(1)}%`
}

function formatMultiple(value: number | null | undefined) {
  if (value == null) return "--"
  return `${value.toFixed(2)}x`
}

function formatCompact(value: number) {
  const abs = Math.abs(value)
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)}亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(1)}万`
  return `${value.toFixed(0)}`
}

function confidenceLabel(value: SettlementAnalysisResponse["strategyInference"]["confidence"]) {
  if (value === "high") return "高"
  if (value === "medium") return "中"
  return "低"
}

function biasLabel(value: SettlementAnalysisResponse["strategyInference"]["bias"]) {
  if (value === "long") return "偏多"
  if (value === "short") return "偏空"
  return "中性"
}

function buildHoldingsOption(items: SettlementAnalysisChartItem[]) {
  const rows = [...items].reverse()
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: AxisTooltipParam[]) => {
        const item = rows[params[0]?.dataIndex ?? 0] ?? null
        const header = item ? `${item.label}<br/>` : ""
        return [
          header,
          ...params.map((entry) => `${entry.color} ${entry.seriesName}: ${formatCurrency(entry.value)}`),
          item?.mtmPl != null ? `盯市盈亏: ${formatSignedCurrency(item.mtmPl)}` : "",
        ].filter(Boolean).join("<br/>")
      },
    },
    legend: { top: 0 },
    grid: { left: 110, right: 24, top: 42, bottom: 18, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatCompact(value) },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
    },
    yAxis: {
      type: "category",
      data: rows.map((item) => item.label),
      axisTick: { show: false },
    },
    series: [
      {
        name: "总敞口",
        type: "bar",
        data: rows.map((item) => item.value),
        itemStyle: { color: "#0f766e", borderRadius: [0, 6, 6, 0] },
      },
      {
        name: "净敞口",
        type: "bar",
        data: rows.map((item) => item.netValue ?? 0),
        itemStyle: {
          color: (params: { value: number }) => (params.value >= 0 ? "#2563eb" : "#dc2626"),
          borderRadius: [0, 6, 6, 0],
        },
      },
    ],
  }
}

function buildSectorOption(items: SettlementAnalysisSectorItem[]) {
  const rows = [...items].reverse()
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: AxisTooltipParam[]) => {
        const label = rows[params[0]?.dataIndex ?? 0]?.sector ?? ""
        const sector = rows[params[0]?.dataIndex ?? 0]
        return [
          `${label}<br/>`,
          ...params.map((entry) => `${entry.color} ${entry.seriesName}: ${formatCurrency(Math.abs(entry.value))}`),
          sector ? `板块盯市盈亏: ${formatSignedCurrency(sector.mtmPl)}` : "",
        ].filter(Boolean).join("<br/>")
      },
    },
    legend: { top: 0 },
    grid: { left: 88, right: 24, top: 42, bottom: 18, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatCompact(value) },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
    },
    yAxis: {
      type: "category",
      data: rows.map((item) => item.sector),
      axisTick: { show: false },
    },
    series: [
      {
        name: "多头敞口",
        type: "bar",
        stack: "exposure",
        data: rows.map((item) => item.longValue),
        itemStyle: { color: "#2563eb", borderRadius: [0, 6, 6, 0] },
      },
      {
        name: "空头敞口",
        type: "bar",
        stack: "exposure",
        data: rows.map((item) => -item.shortValue),
        itemStyle: { color: "#dc2626", borderRadius: [6, 0, 0, 6] },
      },
      {
        name: "净敞口",
        type: "line",
        smooth: true,
        data: rows.map((item) => item.netValue),
        itemStyle: { color: "#0f766e" },
        lineStyle: { width: 2 },
      },
    ],
  }
}

function buildPieOption(items: SettlementAnalysisChartItem[], seriesName: string) {
  return {
    tooltip: {
      trigger: "item",
      formatter: (params: { name: string; value: number; percent: number }) => {
        return `${params.name}<br/>${formatCurrency(params.value)}<br/>占比 ${params.percent.toFixed(1)}%`
      },
    },
    legend: { bottom: 0, left: "center" },
    series: [
      {
        name: seriesName,
        type: "pie",
        radius: ["42%", "70%"],
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        label: { formatter: "{b}\n{d}%" },
        data: items.map((item) => ({ name: item.label, value: item.value })),
      },
    ],
  }
}

// ---- DB analysis chart builders ----

function buildEquityOption(history: GuoxinEquityPoint[]) {
  const dates = history.map((h) => h.date)
  const equities = history.map((h) => h.clientEquity)
  const risks = history.map((h) => +(h.riskDegree * 100).toFixed(2))
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
    legend: { top: 0 },
    grid: { left: 70, right: 70, top: 40, bottom: 52 },
    xAxis: {
      type: "category",
      data: dates,
      axisLabel: { rotate: 30, formatter: (v: string) => v.slice(5) },
    },
    yAxis: [
      {
        type: "value",
        name: "权益",
        axisLabel: { formatter: (v: number) => formatCompact(v) },
        splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
      },
      {
        type: "value",
        name: "风险度%",
        axisLabel: { formatter: (v: number) => `${v}%` },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "客户权益",
        type: "line",
        smooth: true,
        data: equities,
        yAxisIndex: 0,
        itemStyle: { color: "#2563eb" },
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.06 },
        symbol: "none",
      },
      {
        name: "风险度",
        type: "line",
        smooth: true,
        data: risks,
        yAxisIndex: 1,
        itemStyle: { color: "#dc2626" },
        lineStyle: { width: 1.5, type: "dashed" },
        symbol: "none",
      },
    ],
  }
}

function buildTurnoverOption(items: GuoxinTurnoverItem[]) {
  const rows = [...items].reverse()
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: AxisTooltipParam[]) => {
        const row = rows[params[0]?.dataIndex ?? 0]
        return row
          ? `${row.product}<br/>成交额: ${formatCurrency(row.turnover)}<br/>占比: ${formatPercent(row.turnoverPct)}<br/>手数: ${row.lots.toFixed(0)} 手`
          : ""
      },
    },
    grid: { left: 70, right: 60, top: 16, bottom: 18, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => formatCompact(v) },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
    },
    yAxis: {
      type: "category",
      data: rows.map((r) => r.product),
      axisTick: { show: false },
    },
    series: [
      {
        name: "成交额",
        type: "bar",
        data: rows.map((r) => r.turnover),
        itemStyle: { color: "#0f766e", borderRadius: [0, 6, 6, 0] },
        label: {
          show: true,
          position: "right",
          formatter: (params: { dataIndex: number }) => formatPercent(rows[params.dataIndex]?.turnoverPct),
        },
      },
    ],
  }
}

function buildMarginOption(history: GuoxinEquityPoint[]) {
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 70, right: 24, top: 16, bottom: 52 },
    xAxis: {
      type: "category",
      data: history.map((h) => h.date),
      axisLabel: { rotate: 30, formatter: (v: string) => v.slice(5) },
    },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (v: number) => formatCompact(v) },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.18)" } },
    },
    series: [
      {
        name: "保证金占用",
        type: "bar",
        data: history.map((h) => h.marginOccupied),
        itemStyle: { color: "#0f766e", opacity: 0.75 },
      },
    ],
  }
}

function StrategyReportPanels({
  analysis,
  equityChartOption,
  turnoverChartOption,
  marginChartOption,
  expandedClusters,
  toggleCluster,
}: {
  analysis: GuoxinDBAnalysisResponse
  equityChartOption: ReturnType<typeof buildEquityOption> | null
  turnoverChartOption: ReturnType<typeof buildTurnoverOption> | null
  marginChartOption: ReturnType<typeof buildMarginOption> | null
  expandedClusters: Set<string>
  toggleCluster: (key: string) => void
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>期间收益率</CardDescription>
            <CardTitle className={`text-2xl ${analysis.equityStats.returnPct >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {formatPercent(analysis.equityStats.returnPct)}
            </CardTitle>
            <div className="text-sm text-muted-foreground">{analysis.equityStats.startDate} ~ {analysis.equityStats.endDate}</div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>期末权益</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(analysis.equityStats.endEquity)}</CardTitle>
            <div className="text-sm text-muted-foreground">期初 {formatCurrency(analysis.equityStats.startEquity)}</div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>累计手续费</CardDescription>
            <CardTitle className="text-2xl text-red-700">{formatCurrency(analysis.equityStats.feeTotal)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>最高风险度</CardDescription>
            <CardTitle className="text-2xl">{formatPercent(analysis.equityStats.maxRiskDegree)}</CardTitle>
            <div className="text-sm text-muted-foreground">交易天数 {analysis.equityStats.totalDays}</div>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>账户权益与风险度</CardTitle>
            <CardDescription>蓝线为客户权益（左轴），红虚线为风险度（右轴）。</CardDescription>
          </CardHeader>
          <CardContent>
            {equityChartOption ? (
              <ReactECharts option={equityChartOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
            ) : (
              <div className="py-24 text-center text-sm text-muted-foreground">暂无权益数据。</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>品种成交额占比</CardTitle>
            <CardDescription>按成交金额排序，右侧标注占总成交额的百分比。</CardDescription>
          </CardHeader>
          <CardContent>
            {turnoverChartOption ? (
              <ReactECharts option={turnoverChartOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
            ) : (
              <div className="py-24 text-center text-sm text-muted-foreground">暂无成交数据。</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>逐日保证金占用</CardTitle>
          <CardDescription>每个交易日的保证金占用金额变化趋势。</CardDescription>
        </CardHeader>
        <CardContent>
          {marginChartOption ? (
            <ReactECharts option={marginChartOption} style={{ height: 260, width: "100%" }} notMerge lazyUpdate />
          ) : (
            <div className="py-16 text-center text-sm text-muted-foreground">暂无保证金数据。</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>品种成交明细</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>品种</TableHead>
                <TableHead className="text-right">成交额</TableHead>
                <TableHead className="text-right">占比</TableHead>
                <TableHead className="text-right">手数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.turnover.map((row) => (
                <TableRow key={row.product}>
                  <TableCell className="font-medium">{row.product}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.turnover)}</TableCell>
                  <TableCell className="text-right">{formatPercent(row.turnoverPct)}</TableCell>
                  <TableCell className="text-right">{row.lots.toFixed(0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>开仓批次解读</CardTitle>
          <CardDescription>按交易日和品种聚合，点击行展开明细合约。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>交易日</TableHead>
                <TableHead>品种</TableHead>
                <TableHead className="text-right">批次成交额</TableHead>
                <TableHead className="text-right">手续费</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.tradeClusters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">暂无开仓记录。</TableCell>
                </TableRow>
              ) : analysis.tradeClusters.map((cluster) => {
                const key = `open-${cluster.tradeDate}-${cluster.product}`
                const isExpanded = expandedClusters.has(key)
                return (
                  <Fragment key={key}>
                    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleCluster(key)}>
                      <TableCell className="font-medium">{cluster.tradeDate}</TableCell>
                      <TableCell>{cluster.product}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cluster.totalTurnover)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(cluster.totalFees)}</TableCell>
                      <TableCell className="text-right">
                        {isExpanded ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                      </TableCell>
                    </TableRow>
                    {isExpanded ? cluster.items.map((item, idx) => (
                      <TableRow key={`${key}-${idx}`} className="bg-muted/20 text-sm">
                        <TableCell></TableCell>
                        <TableCell className="text-muted-foreground">{item.instrument}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{item.bs} {item.lots.toFixed(0)} 手 @ {item.avgPrice.toFixed(2)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{formatCurrency(item.turnover)}</TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    )) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>平仓批次解读</CardTitle>
          <CardDescription>按结算日和品种聚合，含已实现盈亏，点击行展开明细。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>结算日</TableHead>
                <TableHead>品种</TableHead>
                <TableHead className="text-right">平仓手数</TableHead>
                <TableHead className="text-right">实现盈亏</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.closeClusters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">暂无平仓记录。</TableCell>
                </TableRow>
              ) : analysis.closeClusters.map((cluster) => {
                const key = `close-${cluster.settlementDate}-${cluster.product}`
                const isExpanded = expandedClusters.has(key)
                return (
                  <Fragment key={key}>
                    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleCluster(key)}>
                      <TableCell className="font-medium">{cluster.settlementDate}</TableCell>
                      <TableCell>{cluster.product}</TableCell>
                      <TableCell className="text-right">{cluster.totalLots.toFixed(0)}</TableCell>
                      <TableCell className={`text-right ${cluster.totalRealizedPl >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {formatSignedCurrency(cluster.totalRealizedPl)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isExpanded ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
                      </TableCell>
                    </TableRow>
                    {isExpanded ? cluster.items.map((item, idx) => (
                      <TableRow key={`${key}-${idx}`} className="bg-muted/20 text-sm">
                        <TableCell></TableCell>
                        <TableCell className="text-muted-foreground">{item.instrument}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{item.bs} {item.lots.toFixed(0)} 手</TableCell>
                        <TableCell className={`text-right ${item.realizedPl >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {formatSignedCurrency(item.realizedPl)}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    )) : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>附录：逐日品种净敞口汇总</CardTitle>
          <CardDescription>每日各品种多空手数与净手数，最多展示 300 行。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>结算日</TableHead>
                <TableHead>品种</TableHead>
                <TableHead className="text-right">多头</TableHead>
                <TableHead className="text-right">空头</TableHead>
                <TableHead className="text-right">净手数</TableHead>
                <TableHead className="text-right">盯市盈亏</TableHead>
                <TableHead className="text-right">保证金</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.productNetting.slice(0, 300).map((row, idx) => (
                <TableRow key={`netting-${idx}`}>
                  <TableCell>{row.settlementDate}</TableCell>
                  <TableCell>{row.product}</TableCell>
                  <TableCell className="text-right text-blue-700">{row.longLots.toFixed(0)}</TableCell>
                  <TableCell className="text-right text-red-700">{row.shortLots.toFixed(0)}</TableCell>
                  <TableCell className={`text-right font-medium ${row.netLots >= 0 ? "text-blue-700" : "text-red-700"}`}>
                    {row.netLots > 0 ? "+" : ""}{row.netLots.toFixed(0)}
                  </TableCell>
                  <TableCell className={`text-right ${row.mtmPl >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedCurrency(row.mtmPl)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(row.margin)}</TableCell>
                </TableRow>
              ))}
              {analysis.productNetting.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">暂无持仓记录。</TableCell>
                </TableRow>
              ) : null}
              {analysis.productNetting.length > 300 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-4 text-center text-sm text-muted-foreground">
                    仅显示前 300 条，共 {analysis.productNetting.length} 条。
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}

export default function SettlementAnalysisPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()

  const [analysis, setAnalysis] = useState<SettlementAnalysisResponse | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  function isAcceptedFile(file: File) {
    const dotIndex = file.name.lastIndexOf(".")
    const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : ""
    return ACCEPTED_EXTENSIONS.includes(extension) || /交易结算单|结算单/i.test(file.name)
  }

  async function handleAnalyze() {
    if (!pendingFile) {
      toast({
        title: "未选择文件",
        description: "请先拖入或点击选择一个结算单文件。",
        variant: "destructive",
      })
      return
    }

    if (!isAcceptedFile(pendingFile)) {
      toast({
        title: "文件格式不支持",
        description: `仅支持 ${ACCEPTED_EXTENSIONS.join(" / ")} 结算单文件。`,
        variant: "destructive",
      })
      return
    }

    setIsAnalyzing(true)
    try {
      const formData = new FormData()
      formData.append("file", pendingFile)

      const response = await fetch("/ma/api/tools/settlement-analysis/analyze", {
        method: "POST",
        body: formData,
      })
      const payload = (await response.json()) as SettlementAnalysisResponse | { error: string }
      if (!response.ok) {
        throw new Error(readErrorMessage(payload, "结算单分析失败。"))
      }

      setAnalysis(payload as SettlementAnalysisResponse)
      toast({
        title: "分析完成",
        description: "已生成持仓、板块、多空结构与策略推断结果。",
      })
    } catch (error) {
      toast({
        title: "分析失败",
        description: error instanceof Error ? error.message : "结算单分析失败。",
        variant: "destructive",
      })
    } finally {
      setIsAnalyzing(false)
    }
  }

  function clearAll() {
    setAnalysis(null)
    setPendingFile(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(true)
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    if (!isAcceptedFile(file)) {
      toast({
        title: "文件格式不支持",
        description: `仅支持 ${ACCEPTED_EXTENSIONS.join(" / ")} 结算单文件。`,
        variant: "destructive",
      })
      return
    }
    setPendingFile(file)
  }

  const holdingsOption = useMemo(
    () => (analysis?.charts.holdings.length ? buildHoldingsOption(analysis.charts.holdings) : null),
    [analysis],
  )
  const sectorOption = useMemo(
    () => (analysis?.charts.sectors.length ? buildSectorOption(analysis.charts.sectors) : null),
    [analysis],
  )
  const directionOption = useMemo(
    () => (analysis?.charts.directions.length ? buildPieOption(analysis.charts.directions, "多空结构") : null),
    [analysis],
  )
  const exchangeOption = useMemo(
    () => (analysis?.charts.exchanges.length ? buildPieOption(analysis.charts.exchanges, "交易所分布") : null),
    [analysis],
  )

  const [dbAnalysis, setDbAnalysis] = useState<GuoxinDBAnalysisResponse | null>(null)
  const [isLoadingDb, setIsLoadingDb] = useState(false)
  const [dbError, setDbError] = useState<string | null>(null)
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set())

  const [yinheAnalysis, setYinheAnalysis] = useState<GuoxinDBAnalysisResponse | null>(null)
  const [isLoadingYinhe, setIsLoadingYinhe] = useState(false)
  const [yinheError, setYinheError] = useState<string | null>(null)
  const [yinheExpandedClusters, setYinheExpandedClusters] = useState<Set<string>>(new Set())
  const [yinheCfg, setYinheCfg] = useState({
    email: "ch_c7h8@163.com",
    imapHost: "imap.163.com",
    imapPort: 993,
    sender: "galaxyfutures_data@vip.126.com",
    lookbackDays: 120,
    mailboxReady: false,
    mailboxSource: null as "crawl-email" | "local-config" | null,
    crawlStatus: null as string | null,
    resolveError: null as string | null,
    crawlAccounts: [] as {
      account: string
      emailType: string
      imapHost: string
      imapPort: number
      crawlStatus: string
      remark: string
    }[],
  })
  const [isSavingYinheCfg, setIsSavingYinheCfg] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const resp = await fetch("/ma/api/tools/settlement-analysis/yinhe-config")
        if (!resp.ok) return
        const payload = (await resp.json()) as {
          email?: string
          defaultEmail?: string
          imapHost?: string
          imapPort?: number
          sender?: string
          lookbackDays?: number
          mailboxReady?: boolean
          mailboxSource?: "crawl-email" | "local-config" | null
          crawlStatus?: string | null
          resolveError?: string | null
          crawlAccounts?: {
            account: string
            emailType: string
            imapHost: string
            imapPort: number
            crawlStatus: string
            remark: string
          }[]
        }
        setYinheCfg((c) => ({
          ...c,
          email: payload.email || payload.defaultEmail || c.email,
          imapHost: payload.imapHost ?? c.imapHost,
          imapPort: payload.imapPort ?? c.imapPort,
          sender: payload.sender ?? c.sender,
          lookbackDays: payload.lookbackDays ?? c.lookbackDays,
          mailboxReady: Boolean(payload.mailboxReady),
          mailboxSource: payload.mailboxSource ?? null,
          crawlStatus: payload.crawlStatus ?? null,
          resolveError: payload.resolveError ?? null,
          crawlAccounts: payload.crawlAccounts ?? [],
        }))
      } catch {
        /* ignore */
      }
    })()
  }, [])

  async function handleLoadDbAnalysis() {
    setIsLoadingDb(true)
    setDbError(null)
    try {
      const resp = await fetch("/ma/api/tools/settlement-analysis/db-analyze")
      const payload = (await resp.json()) as GuoxinDBAnalysisResponse | { error: string }
      if (!resp.ok) throw new Error(readErrorMessage(payload, "分析失败"))
      setDbAnalysis(payload as GuoxinDBAnalysisResponse)
    } catch (e) {
      setDbError(e instanceof Error ? e.message : "数据库分析失败")
    } finally {
      setIsLoadingDb(false)
    }
  }

  async function handleSaveYinheConfig() {
    setIsSavingYinheCfg(true)
    try {
      const resp = await fetch("/ma/api/tools/settlement-analysis/yinhe-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: yinheCfg.email,
          sender: yinheCfg.sender,
          lookbackDays: yinheCfg.lookbackDays,
        }),
      })
      const payload = (await resp.json()) as { ok?: boolean; error?: string }
      if (!resp.ok) throw new Error(payload.error || "保存失败")
      // Refresh readiness from crawl-email store
      const refresh = await fetch("/ma/api/tools/settlement-analysis/yinhe-config")
      if (refresh.ok) {
        const next = (await refresh.json()) as {
          mailboxReady?: boolean
          mailboxSource?: "crawl-email" | "local-config" | null
          crawlStatus?: string | null
          resolveError?: string | null
          imapHost?: string
          imapPort?: number
        }
        setYinheCfg((c) => ({
          ...c,
          mailboxReady: Boolean(next.mailboxReady),
          mailboxSource: next.mailboxSource ?? null,
          crawlStatus: next.crawlStatus ?? null,
          resolveError: next.resolveError ?? null,
          imapHost: next.imapHost ?? c.imapHost,
          imapPort: next.imapPort ?? c.imapPort,
        }))
      }
      toast({ title: "银河期货邮箱配置已保存" })
    } catch (e) {
      toast({
        title: "保存失败",
        description: e instanceof Error ? e.message : "无法保存邮箱配置",
        variant: "destructive",
      })
    } finally {
      setIsSavingYinheCfg(false)
    }
  }

  async function handleLoadYinheAnalysis(skipFetch = false) {
    setIsLoadingYinhe(true)
    setYinheError(null)
    try {
      const qs = skipFetch ? "?skipFetch=1" : ""
      const resp = await fetch(`/ma/api/tools/settlement-analysis/yinhe-analyze${qs}`)
      const payload = (await resp.json()) as (GuoxinDBAnalysisResponse & { meta?: unknown }) | { error: string }
      if (!resp.ok) throw new Error(readErrorMessage(payload, "分析失败"))
      if ("error" in payload) throw new Error(payload.error)
      const { meta: _meta, ...analysis } = payload as GuoxinDBAnalysisResponse & { meta?: unknown }
      setYinheAnalysis(analysis)
    } catch (e) {
      setYinheError(e instanceof Error ? e.message : "银河期货邮件分析失败")
    } finally {
      setIsLoadingYinhe(false)
    }
  }

  function toggleCluster(key: string) {
    setExpandedClusters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleYinheCluster(key: string) {
    setYinheExpandedClusters((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const equityChartOption = useMemo(
    () => (dbAnalysis?.equityHistory.length ? buildEquityOption(dbAnalysis.equityHistory) : null),
    [dbAnalysis],
  )

  const turnoverChartOption = useMemo(
    () => (dbAnalysis?.turnover.length ? buildTurnoverOption(dbAnalysis.turnover) : null),
    [dbAnalysis],
  )

  const marginChartOption = useMemo(
    () => (dbAnalysis?.equityHistory.length ? buildMarginOption(dbAnalysis.equityHistory) : null),
    [dbAnalysis],
  )

  const yinheEquityChartOption = useMemo(
    () => (yinheAnalysis?.equityHistory.length ? buildEquityOption(yinheAnalysis.equityHistory) : null),
    [yinheAnalysis],
  )

  const yinheTurnoverChartOption = useMemo(
    () => (yinheAnalysis?.turnover.length ? buildTurnoverOption(yinheAnalysis.turnover) : null),
    [yinheAnalysis],
  )

  const yinheMarginChartOption = useMemo(
    () => (yinheAnalysis?.equityHistory.length ? buildMarginOption(yinheAnalysis.equityHistory) : null),
    [yinheAnalysis],
  )

  return (
    <div className="space-y-6 pt-6">
      <div className="space-y-2">
        <Link href="/ma/dashboard/tools" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          返回小工具
        </Link>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">结算单分析</h1>
          <p className="mt-2 text-muted-foreground">拖入国信交易结算单(盯市)后，分析持仓敞口、板块分布、多空结构，并推断可能的交易风格。</p>
        </div>
      </div>

      <Alert>
        <FileSpreadsheet className="h-4 w-4" />
        <AlertTitle>支持格式</AlertTitle>
        <AlertDescription>
          支持 xlsx、xls、xlsm、xlsb 结算单文件。上传文件只在分析请求期间进入内存，不会落盘保存。策略判断为启发式推断，用于快速读表，不替代人工复核。
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>1. 上传并分析</CardTitle>
          <CardDescription>拖入结算单文件，点击“开始分析”后自动识别持仓汇总、持仓明细与账户摘要。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
              isDragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/60 hover:bg-muted/30"
            } ${isAnalyzing ? "pointer-events-none opacity-60" : ""}`}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !isAnalyzing && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.xlsm,.xlsb"
              className="sr-only"
              disabled={isAnalyzing}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) setPendingFile(file)
              }}
            />
            <UploadCloud className={`h-10 w-10 transition-colors ${isDragOver ? "text-primary" : pendingFile ? "text-green-600" : "text-muted-foreground"}`} />
            <div>
              <p className="text-sm font-medium">
                {isDragOver ? "松开鼠标以上传" : pendingFile ? pendingFile.name : "拖拽结算单到此处，或点击选择文件"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pendingFile ? "文件已就绪，点击下方按钮开始分析" : "示例：交易结算单(盯市)_20260525.xlsx"}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button type="button" variant={pendingFile ? "default" : "outline"} size="sm" disabled={isAnalyzing} onClick={(event) => { event.stopPropagation(); void handleAnalyze() }}>
                <ScanSearch className="h-4 w-4" />
                {isAnalyzing ? "分析中..." : pendingFile ? "开始分析" : "选择文件"}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!pendingFile && !analysis} onClick={(event) => { event.stopPropagation(); clearAll() }}>
                <Trash2 className="h-4 w-4" />
                清空
              </Button>
            </div>
          </div>

          {analysis ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">文件：{analysis.sourceFileName}</Badge>
              <Badge variant="outline">客户：{analysis.summary.clientName || analysis.summary.clientId}</Badge>
              <Badge variant="outline">交易日：{analysis.summary.tradeDate}</Badge>
              <Badge variant="outline">持仓合约：{analysis.summary.positionCount}</Badge>
              <Badge variant="outline">板块数：{analysis.summary.sectorCount}</Badge>
              <Badge variant="outline">策略置信度：{confidenceLabel(analysis.strategyInference.confidence)}</Badge>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {analysis ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>客户权益</CardDescription>
                <CardTitle className="text-2xl">{formatCurrency(analysis.summary.clientEquity)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>总敞口 / 杠杆</CardDescription>
                <CardTitle className="text-2xl">{formatCurrency(analysis.summary.grossExposure)}</CardTitle>
                <div className="text-sm text-muted-foreground">杠杆 {formatMultiple(analysis.summary.grossLeverage)}</div>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>净敞口</CardDescription>
                <CardTitle className={`text-2xl ${analysis.summary.netExposure >= 0 ? "text-blue-700" : "text-red-700"}`}>
                  {formatSignedCurrency(analysis.summary.netExposure)}
                </CardTitle>
                <div className="text-sm text-muted-foreground">占权益 {formatPercent(analysis.summary.netExposureRatio)}</div>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>风险度 / 可用资金</CardDescription>
                <CardTitle className="text-2xl">{formatPercent(analysis.summary.riskDegreeRatio)}</CardTitle>
                <div className="text-sm text-muted-foreground">可用 {formatCurrency(analysis.summary.fundAvailable)}</div>
              </CardHeader>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>持仓敞口 Top 12</CardTitle>
                <CardDescription>按合约总敞口排序，同时显示净敞口与盯市盈亏倾向。</CardDescription>
              </CardHeader>
              <CardContent>
                {holdingsOption ? (
                  <ReactECharts option={holdingsOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
                ) : (
                  <div className="py-24 text-center text-sm text-muted-foreground">暂无可展示的持仓数据。</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>板块多空结构</CardTitle>
                <CardDescription>多头和空头敞口以左右展开，辅助判断是否存在板块对冲或主题集中。</CardDescription>
              </CardHeader>
              <CardContent>
                {sectorOption ? (
                  <ReactECharts option={sectorOption} style={{ height: 360, width: "100%" }} notMerge lazyUpdate />
                ) : (
                  <div className="py-24 text-center text-sm text-muted-foreground">暂无可展示的板块数据。</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>多空敞口占比</CardTitle>
                <CardDescription>快速观察组合当前是偏多、偏空还是接近中性。</CardDescription>
              </CardHeader>
              <CardContent>
                {directionOption ? (
                  <ReactECharts option={directionOption} style={{ height: 320, width: "100%" }} notMerge lazyUpdate />
                ) : (
                  <div className="py-20 text-center text-sm text-muted-foreground">暂无多空占比数据。</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>交易所分布</CardTitle>
                <CardDescription>识别仓位更集中在股指、上期、郑商、大商等哪类市场。</CardDescription>
              </CardHeader>
              <CardContent>
                {exchangeOption ? (
                  <ReactECharts option={exchangeOption} style={{ height: 320, width: "100%" }} notMerge lazyUpdate />
                ) : (
                  <div className="py-20 text-center text-sm text-muted-foreground">暂无交易所分布数据。</div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>可能交易策略</CardTitle>
                  <Badge variant="outline">{confidenceLabel(analysis.strategyInference.confidence)}置信度</Badge>
                  <Badge variant="outline">{biasLabel(analysis.strategyInference.bias)}</Badge>
                </div>
                <CardDescription>基于板块权重、多空结构、权益占用与集中度做的启发式判断。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border bg-muted/30 p-4">
                  <div className="text-sm text-muted-foreground">主判断</div>
                  <div className="mt-1 text-2xl font-semibold">{analysis.strategyInference.primaryStrategy}</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {analysis.strategyInference.candidateStrategies.map((item) => (
                    <Badge key={item} variant="secondary">{item}</Badge>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">判断依据</div>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {analysis.strategyInference.signals.map((signal) => (
                      <li key={signal} className="rounded-md border bg-background px-3 py-2">{signal}</li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">主要风险提示</div>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {analysis.strategyInference.risks.map((risk) => (
                      <li key={risk} className="rounded-md border bg-background px-3 py-2">{risk}</li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>快照摘要</CardTitle>
                <CardDescription>把最容易忽略的账户级信息聚合到一起，便于快速判断仓位状态。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">结算单区间</span>
                  <span className="font-medium">{analysis.summary.dateRangeRaw || "--"}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">多头市值</span>
                  <span className="font-medium text-blue-700">{formatCurrency(analysis.summary.longMarketValue)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">空头市值</span>
                  <span className="font-medium text-red-700">{formatCurrency(analysis.summary.shortMarketValue)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">盯市盈亏</span>
                  <span className={`font-medium ${analysis.summary.mtmPl != null && analysis.summary.mtmPl >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedCurrency(analysis.summary.mtmPl)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">平仓盈亏</span>
                  <span className={`font-medium ${analysis.summary.realizedPl != null && analysis.summary.realizedPl >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedCurrency(analysis.summary.realizedPl)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">最大合约</span>
                  <span className="font-medium">{analysis.summary.topPositionName || "--"}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">最大板块</span>
                  <span className="font-medium">{analysis.summary.topSectorName || "--"}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">最大板块占比</span>
                  <span className="font-medium">{formatPercent(analysis.summary.topSectorShare)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">保证金占用</span>
                  <span className="font-medium">{formatCurrency(analysis.summary.marginOccupied)}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-muted-foreground">持仓明细行数</span>
                  <span className="font-medium">{analysis.summary.detailRowCount}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {analysis.warnings.length ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>分析提示</AlertTitle>
              <AlertDescription>
                {analysis.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                <CardTitle>持仓明细表</CardTitle>
              </div>
              <CardDescription>按总敞口排序，可快速查看每个合约的多空手数、净敞口与盯市盈亏。</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>合约</TableHead>
                    <TableHead>品种</TableHead>
                    <TableHead>板块</TableHead>
                    <TableHead>交易所</TableHead>
                    <TableHead className="text-right">多头手数</TableHead>
                    <TableHead className="text-right">空头手数</TableHead>
                    <TableHead className="text-right">总敞口</TableHead>
                    <TableHead className="text-right">净敞口</TableHead>
                    <TableHead className="text-right">盯市盈亏</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.positions.slice(0, 24).map((position, idx) => (
                    <TableRow key={`${idx}-${position.symbol}-${position.exchange}`}>
                      <TableCell className="font-medium">{position.symbol}</TableCell>
                      <TableCell>{position.productName}</TableCell>
                      <TableCell>{position.sector}</TableCell>
                      <TableCell>{position.exchange}</TableCell>
                      <TableCell className="text-right">{position.longLots.toFixed(0)}</TableCell>
                      <TableCell className="text-right">{position.shortLots.toFixed(0)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(position.grossMarketValue)}</TableCell>
                      <TableCell className={`text-right ${position.netMarketValue >= 0 ? "text-blue-700" : "text-red-700"}`}>{formatSignedCurrency(position.netMarketValue)}</TableCell>
                      <TableCell className={`text-right ${position.mtmPl >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedCurrency(position.mtmPl)}</TableCell>
                    </TableRow>
                  ))}
                  {analysis.positions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                        当前结算单未提取到有效持仓。
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* ============================================================ */}
      {/* 国信期货账户策略报告 (数据库) */}
      {/* ============================================================ */}

      <div className="space-y-2 border-t pt-8">
        <h2 className="text-2xl font-semibold tracking-tight">国信期货账户策略报告</h2>
        <p className="text-muted-foreground">从 PostgreSQL 数据库直接读取历史账户与交易数据，生成策略报告，无需上传结算单文件。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            从数据库生成报告
          </CardTitle>
          <CardDescription>读取 guosen_account_summary、guosen_transaction_records、guosen_position_summary、guosen_position_closed 四张表，分析至最新结算日。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Button onClick={() => void handleLoadDbAnalysis()} disabled={isLoadingDb}>
            <TrendingUp className="h-4 w-4" />
            {isLoadingDb ? "加载中…" : dbAnalysis ? "重新生成" : "生成策略报告"}
          </Button>
          <Button
            variant="outline"
            onClick={() => { window.open("/ma/api/tools/settlement-analysis/download-report", "_blank") }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            下载 Word 报告
          </Button>
          {dbAnalysis ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">区间：{dbAnalysis.dateRange.start} ~ {dbAnalysis.dateRange.end}</Badge>
              <Badge variant="outline">交易天数：{dbAnalysis.equityStats.totalDays}</Badge>
              <Badge variant="outline">交易品种：{dbAnalysis.uniqueProducts.length}</Badge>
            </div>
          ) : null}
          {dbError ? <p className="text-sm text-red-600">{dbError}</p> : null}
        </CardContent>
      </Card>

      {dbAnalysis ? (
        <StrategyReportPanels
          analysis={dbAnalysis}
          equityChartOption={equityChartOption}
          turnoverChartOption={turnoverChartOption}
          marginChartOption={marginChartOption}
          expandedClusters={expandedClusters}
          toggleCluster={toggleCluster}
        />
      ) : null}

      {/* ============================================================ */}
      {/* 银河期货账户策略报告 (邮件) */}
      {/* ============================================================ */}

      <div className="space-y-2 border-t pt-8">
        <h2 className="text-2xl font-semibold tracking-tight">银河期货账户策略报告</h2>
        <p className="text-muted-foreground">
          从邮箱拉取银河期货结算邮件（发件人 galaxyfutures_data@vip.126.com），解析 TXT/XLS 附件后生成策略报告。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            邮箱配置
          </CardTitle>
          <CardDescription>
            复用「运维 → 抓取邮箱设置」中的 IMAP 账号（默认 ch_c7h8@163.com），拉取发件人 galaxyfutures_data@vip.126.com 的结算附件。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {yinheCfg.mailboxReady ? (
              <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                凭据就绪
                {yinheCfg.mailboxSource === "crawl-email" ? " · 来自抓取邮箱设置" : " · 本地配置"}
                {yinheCfg.crawlStatus ? ` · ${yinheCfg.crawlStatus}` : ""}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-red-300 text-red-700">
                凭据未就绪
              </Badge>
            )}
            <span className="text-muted-foreground font-mono text-xs">{yinheCfg.imapHost}:{yinheCfg.imapPort}</span>
          </div>
          {yinheCfg.resolveError ? (
            <p className="text-sm text-red-600">{yinheCfg.resolveError}</p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">收件邮箱（抓取邮箱设置）</label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={yinheCfg.email}
                onChange={(e) => {
                  const account = e.target.value
                  const hit = yinheCfg.crawlAccounts.find((a) => a.account === account)
                  setYinheCfg((c) => ({
                    ...c,
                    email: account,
                    imapHost: hit?.imapHost || c.imapHost,
                    imapPort: hit?.imapPort || c.imapPort,
                    crawlStatus: hit?.crawlStatus ?? c.crawlStatus,
                  }))
                }}
              >
                {yinheCfg.crawlAccounts.length === 0 ? (
                  <option value={yinheCfg.email}>{yinheCfg.email || "ch_c7h8@163.com"}</option>
                ) : (
                  yinheCfg.crawlAccounts.map((a) => (
                    <option key={a.account} value={a.account}>
                      {a.account}
                      {a.remark ? `（${a.remark}）` : ""}
                      {a.crawlStatus ? ` · ${a.crawlStatus}` : ""}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">发件人过滤</label>
              <Input
                className="h-9 text-sm font-mono"
                value={yinheCfg.sender}
                onChange={(e) => setYinheCfg((c) => ({ ...c, sender: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">回看天数</label>
              <Input
                className="h-9 text-sm"
                type="number"
                min={7}
                max={730}
                value={yinheCfg.lookbackDays}
                onChange={(e) =>
                  setYinheCfg((c) => ({ ...c, lookbackDays: Number(e.target.value) || 120 }))
                }
              />
            </div>
          </div>
          <Button variant="outline" onClick={() => void handleSaveYinheConfig()} disabled={isSavingYinheCfg}>
            <Save className="h-4 w-4" />
            {isSavingYinheCfg ? "保存中…" : "保存配置"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            从邮件生成报告
          </CardTitle>
          <CardDescription>
            使用抓取邮箱拉取结算附件 → 解析入库（yinhe_* 表）→ 生成与国信同结构的策略分析。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Button
            onClick={() => void handleLoadYinheAnalysis(false)}
            disabled={isLoadingYinhe || !yinheCfg.mailboxReady}
          >
            <TrendingUp className="h-4 w-4" />
            {isLoadingYinhe ? "拉取并分析中…" : yinheAnalysis ? "重新拉取并生成" : "生成策略报告"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleLoadYinheAnalysis(true)}
            disabled={isLoadingYinhe}
          >
            仅用已下载附件分析
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.open("/ma/api/tools/settlement-analysis/yinhe-download-report", "_blank")
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            下载 Word 报告
          </Button>
          {yinheAnalysis ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">区间：{yinheAnalysis.dateRange.start} ~ {yinheAnalysis.dateRange.end}</Badge>
              <Badge variant="outline">交易天数：{yinheAnalysis.equityStats.totalDays}</Badge>
              <Badge variant="outline">交易品种：{yinheAnalysis.uniqueProducts.length}</Badge>
            </div>
          ) : null}
          {yinheError ? <p className="w-full text-sm text-red-600">{yinheError}</p> : null}
        </CardContent>
      </Card>

      {yinheAnalysis ? (
        <StrategyReportPanels
          analysis={yinheAnalysis}
          equityChartOption={yinheEquityChartOption}
          turnoverChartOption={yinheTurnoverChartOption}
          marginChartOption={yinheMarginChartOption}
          expandedClusters={yinheExpandedClusters}
          toggleCluster={toggleYinheCluster}
        />
      ) : null}
    </div>
  )
}