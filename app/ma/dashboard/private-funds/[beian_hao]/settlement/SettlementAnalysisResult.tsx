"use client"

import dynamic from "next/dynamic"
import { AlertTriangle, BarChart3 } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { SettlementWorkbookAnalysis } from "@/lib/server/settlement-account-etl"

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false })

type ChartItem = SettlementWorkbookAnalysis["charts"]["holdings"][number]
type SectorItem = SettlementWorkbookAnalysis["charts"]["sectors"][number]

type AxisTooltipParam = {
  seriesName: string
  value: number
  color: string
  dataIndex: number
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

function confidenceLabel(value: SettlementWorkbookAnalysis["strategyInference"]["confidence"]) {
  if (value === "high") return "高"
  if (value === "medium") return "中"
  return "低"
}

function biasLabel(value: SettlementWorkbookAnalysis["strategyInference"]["bias"]) {
  if (value === "long") return "偏多"
  if (value === "short") return "偏空"
  return "中性"
}

function buildHoldingsOption(items: ChartItem[]) {
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
          ...params.map((entry) => `${entry.seriesName}: ${formatCurrency(entry.value)}`),
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

function buildSectorOption(items: SectorItem[]) {
  const rows = [...items].reverse()
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: AxisTooltipParam[]) => {
        const sector = rows[params[0]?.dataIndex ?? 0]
        return [
          `${sector?.sector ?? ""}<br/>`,
          ...params.map((entry) => `${entry.seriesName}: ${formatCurrency(Math.abs(entry.value))}`),
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
    ],
  }
}

function buildPieOption(items: ChartItem[], seriesName: string) {
  return {
    tooltip: {
      trigger: "item",
      formatter: (params: { name: string; value: number; percent: number }) =>
        `${params.name}<br/>${formatCurrency(params.value)}<br/>占比 ${params.percent.toFixed(1)}%`,
    },
    legend: { bottom: 0, left: "center" },
    series: [
      {
        name: seriesName,
        type: "pie",
        radius: ["42%", "70%"],
        data: items.map((item) => ({ name: item.label, value: item.value })),
      },
    ],
  }
}

export function SettlementAnalysisResult({ analysis }: { analysis: SettlementWorkbookAnalysis }) {
  const visibleWarnings = analysis.warnings.filter((w) => !w.startsWith("[DBG]") && !w.startsWith("[SUM"))
  const holdingsOption = analysis.charts.holdings.length ? buildHoldingsOption(analysis.charts.holdings) : null
  const sectorOption = analysis.charts.sectors.length ? buildSectorOption(analysis.charts.sectors) : null
  const directionOption = analysis.charts.directions.length
    ? buildPieOption(analysis.charts.directions, "多空敞口")
    : null
  const exchangeOption = analysis.charts.exchanges.length
    ? buildPieOption(analysis.charts.exchanges, "交易所")
    : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="outline">文件：{analysis.sourceFileName}</Badge>
        <Badge variant="outline">客户：{analysis.summary.clientName || analysis.summary.clientId}</Badge>
        <Badge variant="outline">交易日：{analysis.summary.tradeDate}</Badge>
        <Badge variant="outline">持仓合约：{analysis.summary.positionCount}</Badge>
        <Badge variant="outline">板块数：{analysis.summary.sectorCount}</Badge>
        <Badge variant="outline">策略置信度：{confidenceLabel(analysis.strategyInference.confidence)}</Badge>
      </div>

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
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {[
              ["结算日", analysis.summary.tradeDate || "--"],
              ["多头市值", formatCurrency(analysis.summary.longMarketValue)],
              ["空头市值", formatCurrency(analysis.summary.shortMarketValue)],
              ["盯市盈亏", formatSignedCurrency(analysis.summary.mtmPl)],
              ["平仓盈亏", formatSignedCurrency(analysis.summary.realizedPl)],
              ["最大合约", analysis.summary.topPositionName || "--"],
              ["最大板块", analysis.summary.topSectorName || "--"],
              ["最大板块占比", formatPercent(analysis.summary.topSectorShare)],
              ["保证金占用", formatCurrency(analysis.summary.marginOccupied)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {visibleWarnings.length > 0 ? (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>分析提示</AlertTitle>
          <AlertDescription>
            {visibleWarnings.map((warning) => (
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
              {analysis.positions.slice(0, 40).map((position, idx) => (
                <TableRow key={`${idx}-${position.symbol}-${position.exchange}`}>
                  <TableCell className="font-medium">{position.symbol}</TableCell>
                  <TableCell>{position.productName}</TableCell>
                  <TableCell>{position.sector}</TableCell>
                  <TableCell>{position.exchange}</TableCell>
                  <TableCell className="text-right">{position.longLots.toFixed(0)}</TableCell>
                  <TableCell className="text-right">{position.shortLots.toFixed(0)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(position.grossMarketValue)}</TableCell>
                  <TableCell className={`text-right ${position.netMarketValue >= 0 ? "text-blue-700" : "text-red-700"}`}>
                    {formatSignedCurrency(position.netMarketValue)}
                  </TableCell>
                  <TableCell className={`text-right ${position.mtmPl >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {formatSignedCurrency(position.mtmPl)}
                  </TableCell>
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
    </div>
  )
}
