"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useChartAutoRefresh } from "@/hooks/use-chart-auto-refresh"
import {
  COMMODITY_KEY_TO_RANK,
  COMMODITY_KEY_TO_SECTOR,
  COMMODITY_PRODUCTS,
  COMMODITY_SECTOR_ORDER,
  commodityShortName,
  type CommoditySector,
} from "@/lib/commodity-option-meta"
import { cn } from "@/lib/utils"
import { DeeperAnalysisPanels, type PeerGroupConfig } from "./deeper-analysis-panels"

const CHART_FONT = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif"

const COLORS = {
  blue: "#2563eb",
  teal: "#0f766e",
  orange: "#ea580c",
  purple: "#7c3aed",
} as const

type Sector = CommoditySector
const SECTOR_ORDER = COMMODITY_SECTOR_ORDER
const KEY_TO_SECTOR = COMMODITY_KEY_TO_SECTOR

const PRODUCT_GROUPS = COMMODITY_PRODUCTS.map((p) => ({
  label: p.short,
  keys: [p.key],
  sector: p.sector,
  rank: p.rank,
}))

const SECTOR_BAND: Record<Sector, string> = {
  农产品: "rgba(34,197,94,0.10)",
  黑色: "rgba(71,85,105,0.12)",
  有色: "rgba(234,179,8,0.12)",
  能化: "rgba(249,115,22,0.12)",
}

const SECTOR_ROW_CLASS: Record<Sector, string> = {
  农产品: "bg-emerald-500/5",
  黑色: "bg-slate-500/5",
  有色: "bg-amber-500/5",
  能化: "bg-orange-500/5",
}

const SECTOR_ACCENT: Record<Sector, string> = {
  农产品: "border-emerald-500/40 text-emerald-700",
  黑色: "border-slate-500/40 text-slate-700",
  有色: "border-amber-500/40 text-amber-700",
  能化: "border-orange-500/40 text-orange-700",
}

const COMMODITY_PEER_GROUP: PeerGroupConfig = {
  keyToGroup: KEY_TO_SECTOR,
  groupOrder: [...SECTOR_ORDER],
  compareTitle: (group) => `${group} 板块 IV 对比`,
  compareDescription: "同板块品种近月系列 / ATM IV 走势",
  heatDescription: "按农产品 / 黑色 / 有色 / 能化排列的全历史与 1Y 分位（偏红越贵）",
}

type ChartPoint = Record<string, number | string | null | undefined>

type PercentileData = {
  latest_iv: number | null
  percentile_all: number | null
  percentile_1y: number | null
  series: ChartPoint[]
}

type UnderlyingPayload = {
  key: string
  label: string
  short_label?: string
  sector?: string
  group?: string
  current_iv: number | null
  percentile_all: number | null
  percentile_1y: number | null
  charts?: {
    history?: ChartPoint[] | null
    percentile?: PercentileData | null
    term_structure?: ChartPoint[] | null
    smile?: Record<string, unknown> | null
    smile_chain?: Record<string, unknown> | null
    iv_rv?: Record<string, unknown> | null
    skew?: Record<string, unknown> | null
    pcr?: Record<string, unknown> | null
    term_slope?: Record<string, unknown> | null
    vol_cone?: Record<string, unknown> | null
  }
}

type SummaryRow = {
  group_label: string
  keys: string[]
  iv_display: string
  percentile: number | null
  percentile_display?: string | null
  products: Array<{
    key: string
    label: string
    current_iv: number | null
    percentile_all: number | null
  }>
}

type CommodityPayload = {
  trade_date: string
  summary: SummaryRow[]
  underlyings: Record<string, UnderlyingPayload>
}

function chartBase() {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: CHART_FONT, fontSize: 11 },
  }
}

function pctLabel(v: number | null | undefined) {
  if (v == null) return "—"
  if (v >= 80) return "偏高"
  if (v >= 60) return "较高"
  if (v >= 40) return "中性"
  if (v >= 20) return "较低"
  return "偏低"
}

function pctColor(v: number | null | undefined) {
  if (v == null) return "text-muted-foreground"
  if (v >= 80) return "text-red-600"
  if (v >= 60) return "text-orange-600"
  if (v >= 40) return "text-foreground"
  if (v >= 20) return "text-emerald-600"
  return "text-blue-600"
}

function pctBarColor(v: number | null | undefined) {
  if (v == null) return "#94a3b8"
  if (v >= 80) return "#dc2626"
  if (v >= 60) return "#ea580c"
  if (v >= 40) return "#64748b"
  if (v >= 20) return "#059669"
  return "#2563eb"
}

function sectorForKeys(keys: string[]): Sector {
  for (const key of keys) {
    const s = KEY_TO_SECTOR[key]
    if (s) return s
  }
  return "能化"
}

function rankForKeys(keys: string[]): number {
  let best = Number.POSITIVE_INFINITY
  for (const key of keys) {
    const rank = COMMODITY_KEY_TO_RANK[key]
    if (rank != null) best = Math.min(best, rank)
  }
  return Number.isFinite(best) ? best : 999
}

type SummaryChartEntry =
  | { kind: "header"; sector: Sector; category: string }
  | { kind: "row"; sector: Sector; category: string; row: SummaryRow }

function rowCategoryId(row: SummaryRow): string {
  return row.keys[0] ? `__row__${row.keys[0]}` : `__row__${row.group_label}`
}

function organizeSummaryChartEntries(rows: SummaryRow[]): SummaryChartEntry[] {
  const entries: SummaryChartEntry[] = []
  for (const sector of SECTOR_ORDER) {
    const bucketRows = rows
      .filter((r) => sectorForKeys(r.keys) === sector)
      .sort((a, b) => rankForKeys(a.keys) - rankForKeys(b.keys))
    if (!bucketRows.length) continue
    entries.push({ kind: "header", sector, category: `__header__${sector}` })
    for (const row of bucketRows) {
      entries.push({ kind: "row", sector, category: rowCategoryId(row), row })
    }
  }
  return entries
}

function buildSummaryMarkAreaSections(entries: SummaryChartEntry[]) {
  const markAreaData: Array<[{ yAxis: number; itemStyle: { color: string } }, { yAxis: number }]> = []
  let sectionStart: number | null = null

  for (let i = 0; i < entries.length; i++) {
    if (entries[i].kind === "header") {
      if (sectionStart != null) {
        markAreaData.push([
          {
            yAxis: sectionStart,
            itemStyle: { color: SECTOR_BAND[entries[sectionStart].sector] },
          },
          { yAxis: i - 1 },
        ])
      }
      sectionStart = i
    }
  }
  if (sectionStart != null && entries.length) {
    markAreaData.push([
      {
        yAxis: sectionStart,
        itemStyle: { color: SECTOR_BAND[entries[sectionStart].sector] },
      },
      { yAxis: entries.length - 1 },
    ])
  }
  return markAreaData
}

function buildSummaryPercentileBarOption(entries: SummaryChartEntry[]) {
  if (!entries.some((e) => e.kind === "row")) return null
  const markAreaData = buildSummaryMarkAreaSections(entries)

  return {
    ...chartBase(),
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      textStyle: { fontFamily: CHART_FONT },
      formatter: (params: unknown) => {
        const items = (Array.isArray(params) ? params : [params]) as Array<{ dataIndex: number }>
        const item = items[0]
        if (!item) return ""
        const entry = entries[item.dataIndex]
        if (!entry || entry.kind !== "row") return ""
        const { row } = entry
        const pct = row.percentile
        const pctText = row.percentile_display ?? (pct != null ? `${pct.toFixed(1)}%` : "—")
        return [
          `${entry.sector} · ${row.group_label}`,
          `当前 IV：${row.iv_display}`,
          `历史分位：${pctText}`,
          `评价：${pctLabel(pct)}`,
        ].join("<br/>")
      },
    },
    grid: { left: 8, right: 52, top: 4, bottom: 22, containLabel: true },
    xAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT, formatter: "{value}%" },
      splitLine: { lineStyle: { opacity: 0.12 } },
    },
    yAxis: {
      type: "category",
      data: entries.map((e) => e.category),
      inverse: true,
      axisLabel: {
        fontSize: 10,
        fontFamily: CHART_FONT,
        width: 108,
        overflow: "truncate",
        rich: {
          header: { fontWeight: 700, color: "#475569", fontSize: 12, padding: [2, 0, 2, 0] },
          item: { color: "#334155", fontSize: 10, padding: [0, 0, 0, 8] },
        },
        formatter: (value: string) => {
          if (value.startsWith("__header__")) {
            return `{header|${value.slice("__header__".length)}}`
          }
          if (value.startsWith("__row__")) {
            const key = value.slice("__row__".length)
            const entry = entries.find((e) => e.kind === "row" && e.row.keys[0] === key)
            const label = entry && entry.kind === "row"
              ? (entry.row.group_label || shortName(undefined, key))
              : key
            return `{item|${label}}`
          }
          return `{item|${value}}`
        },
      },
      axisTick: { show: false },
      axisLine: { show: false },
    },
    series: [
      {
        name: "历史分位",
        type: "bar",
        data: entries.map((entry) => {
          if (entry.kind === "header") {
            return {
              value: "-",
              itemStyle: { color: "transparent", borderWidth: 0 },
              emphasis: { disabled: true },
              label: { show: false },
              tooltip: { show: false },
            }
          }
          const v = entry.row.percentile ?? null
          return {
            value: v,
            itemStyle: { color: pctBarColor(v), borderRadius: [0, 3, 3, 0] },
          }
        }),
        barMaxWidth: 18,
        label: {
          show: true,
          position: "right",
          fontSize: 10,
          fontFamily: CHART_FONT,
          formatter: (p: { value?: number | null | string }) =>
            typeof p.value === "number" ? `${p.value.toFixed(0)}%` : "",
        },
        markArea: markAreaData.length
          ? { silent: true, itemStyle: { borderWidth: 0 }, data: markAreaData }
          : undefined,
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { type: "dashed", opacity: 0.35, color: "#94a3b8" },
          label: { fontSize: 9, fontFamily: CHART_FONT, color: "#94a3b8" },
          data: [
            { xAxis: 20, label: { formatter: "20" } },
            { xAxis: 50, label: { formatter: "50" } },
            { xAxis: 80, label: { formatter: "80" } },
          ],
        },
      },
    ],
  }
}

function timeSeriesXAxis(dates: string[]) {
  const n = dates.length
  const tickCount = n > 200 ? 8 : n > 100 ? 10 : n > 50 ? 12 : undefined
  const step = tickCount ? Math.max(1, Math.ceil(n / tickCount)) : 1
  return {
    type: "category" as const,
    data: dates,
    boundaryGap: false,
    axisLabel: {
      fontSize: 10,
      fontFamily: CHART_FONT,
      hideOverlap: true,
      interval: tickCount ? (index: number) => index % step === 0 || index === n - 1 : "auto",
      formatter: (value: string) => {
        if (n > 80 && value.length >= 7) return value.slice(0, 7)
        if (n > 40 && value.length >= 10) return value.slice(2)
        return value
      },
    },
  }
}

function fmtChartNum(value: unknown): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : "—"
}

function axisTooltipTwoDecimals(params: unknown): string {
  const items = (Array.isArray(params) ? params : [params]) as Array<{
    axisValueLabel?: string
    name?: string
    seriesName?: string
    value?: number | [number, number]
    marker?: string
  }>
  if (!items.length) return ""
  const header = items[0].axisValueLabel ?? items[0].name ?? ""
  const lines = items.map((item) => {
    const raw = Array.isArray(item.value) ? item.value[item.value.length - 1] : item.value
    return `${item.marker ?? ""}${item.seriesName ?? ""}: ${fmtChartNum(raw)}`
  })
  return [header, ...lines].filter(Boolean).join("<br/>")
}

function buildHistoryOption(series: ChartPoint[]) {
  const dates = series.map((d) => String(d.trade_date))
  const ivs = series.map((d) => d.iv as number | null)
  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT }, formatter: axisTooltipTwoDecimals },
    grid: { left: 48, right: 24, top: 24, bottom: 36 },
    xAxis: timeSeriesXAxis(dates),
    yAxis: {
      type: "value",
      name: "IV (%)",
      nameTextStyle: { fontFamily: CHART_FONT },
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.15 } },
    },
    series: [{
      name: "系列 IV",
      type: "line",
      data: ivs,
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2, color: COLORS.teal },
      areaStyle: { color: "rgba(15,118,110,0.12)" },
      itemStyle: { color: COLORS.teal },
    }],
  }
}

function lineSeriesWithLastDot(values: Array<number | string | null | undefined>, lastSymbolSize = 7) {
  const last = values.length - 1
  return values.map((v, i) => ({
    value: v,
    symbol: i === last ? "circle" : "none",
    symbolSize: i === last ? lastSymbolSize : 0,
  }))
}

function buildPercentileOption(data: PercentileData) {
  const series = data.series ?? []
  const dates = series.map((d) => String(d.trade_date))
  return {
    ...chartBase(),
    tooltip: {
      trigger: "axis",
      textStyle: { fontFamily: CHART_FONT },
      formatter: axisTooltipTwoDecimals,
      axisPointer: { type: "line", snap: true },
    },
    legend: {
      data: ["IV", "全历史分位", "1Y滚动分位"],
      top: 0,
      left: "center",
      itemWidth: 14,
      itemGap: 16,
      textStyle: { fontSize: 11, fontFamily: CHART_FONT },
    },
    grid: { left: 48, right: 56, top: 36, bottom: 36 },
    xAxis: { ...timeSeriesXAxis(dates), boundaryGap: true },
    yAxis: [
      {
        type: "value",
        name: "IV (%)",
        nameTextStyle: { fontFamily: CHART_FONT },
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
        splitLine: { lineStyle: { opacity: 0.15 } },
      },
      {
        type: "value",
        name: "分位 (%)",
        min: 0,
        max: 100,
        nameTextStyle: { fontFamily: CHART_FONT },
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "IV",
        type: "line",
        data: lineSeriesWithLastDot(series.map((d) => d.iv)),
        smooth: true,
        showSymbol: true,
        lineStyle: { width: 1.5, color: COLORS.teal },
        itemStyle: { color: COLORS.teal },
      },
      {
        name: "全历史分位",
        type: "line",
        yAxisIndex: 1,
        data: lineSeriesWithLastDot(series.map((d) => d.percentile_all)),
        smooth: true,
        showSymbol: true,
        lineStyle: { width: 1.5, color: COLORS.blue },
        itemStyle: { color: COLORS.blue },
      },
      {
        name: "1Y滚动分位",
        type: "line",
        yAxisIndex: 1,
        data: lineSeriesWithLastDot(series.map((d) => d.percentile_1y)),
        smooth: true,
        showSymbol: true,
        lineStyle: { width: 1.5, color: COLORS.orange, type: "dashed" },
        itemStyle: { color: COLORS.orange },
      },
    ],
  }
}

function buildTermStructureOption(points: ChartPoint[]) {
  const sorted = [...points]
    .filter((d) => d.iv != null && Number.isFinite(Number(d.iv)))
    .sort((a, b) => Number(a.days_to_expiry ?? 0) - Number(b.days_to_expiry ?? 0))
  if (!sorted.length) return null

  const pairs = sorted.map((d) => [Number(d.days_to_expiry ?? 0), Number(d.iv)] as [number, number])
  const labels = sorted.map((d) => String(d.expiry_date ?? d.series ?? ""))
  const ivs = pairs.map((p) => p[1])
  const ivMin = Math.min(...ivs)
  const ivMax = Math.max(...ivs)
  const ivPad = Math.max(1, (ivMax - ivMin) * 0.12)

  return {
    ...chartBase(),
    tooltip: {
      trigger: "item",
      textStyle: { fontFamily: CHART_FONT },
      formatter: (p: { data: [number, number]; dataIndex: number }) => {
        const [days, iv] = p.data
        return `${labels[p.dataIndex] ?? ""}<br/>${days}D · IV ${iv.toFixed(2)}%`
      },
    },
    grid: { left: 56, right: 24, top: 40, bottom: 48 },
    xAxis: {
      type: "value",
      name: "Days to Expiry",
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { fontFamily: CHART_FONT, fontSize: 11 },
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.12 } },
    },
    yAxis: {
      type: "value",
      name: "ATM / Series IV (%)",
      nameTextStyle: { fontFamily: CHART_FONT, fontSize: 11 },
      min: Math.floor(ivMin - ivPad),
      max: Math.ceil(ivMax + ivPad),
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.15 } },
    },
    series: [{
      type: "line",
      data: pairs,
      symbol: "circle",
      symbolSize: 8,
      lineStyle: { width: 2, color: COLORS.purple },
      itemStyle: { color: COLORS.purple },
      label: {
        show: true,
        position: "top",
        distance: 6,
        fontSize: 9,
        fontFamily: CHART_FONT,
        color: "#64748b",
        formatter: (p: { dataIndex: number }) => labels[p.dataIndex] ?? "",
      },
      labelLayout: { hideOverlap: true },
    }],
  }
}

function shortName(u: UnderlyingPayload | undefined, key: string) {
  return u?.short_label || commodityShortName(key, u?.label)
}

export default function CommodityOptionsSection() {
  const [payload, setPayload] = useState<CommodityPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSector, setActiveSector] = useState<Sector>("有色")
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [summaryChartHeight, setSummaryChartHeight] = useState(360)
  const summaryTableRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async (showLoading: boolean) => {
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/ma/api/options/commodity?ts=${Date.now()}`, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok || !json.underlyings) throw new Error(json.error || "failed")
      setPayload(json)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "数据不可用")
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useChartAutoRefresh(load, [])

  const visibleGroups = useMemo(
    () =>
      PRODUCT_GROUPS.filter((g) => g.keys.some((k) => payload?.underlyings[k])),
    [payload],
  )

  const sectorKeys = useMemo(
    () => visibleGroups.filter((g) => g.sector === activeSector).flatMap((g) => g.keys)
      .filter((k) => payload?.underlyings[k]),
    [visibleGroups, activeSector, payload],
  )

  useEffect(() => {
    if (!payload) return
    const hasActive = activeSector && visibleGroups.some((g) => g.sector === activeSector)
    if (!hasActive) {
      const first = visibleGroups[0]?.sector
      if (first) setActiveSector(first)
    }
  }, [payload, activeSector, visibleGroups])

  const selectedKey = activeKey && sectorKeys.includes(activeKey)
    ? activeKey
    : sectorKeys[0] ?? null

  const selected = selectedKey ? payload?.underlyings[selectedKey] : null
  const charts = selected?.charts
  const productLabel = selectedKey ? shortName(selected, selectedKey) : null

  const summaryTableEntries = useMemo(
    () => organizeSummaryChartEntries(payload?.summary ?? []),
    [payload?.summary],
  )
  const summaryPctOption = useMemo(
    () => buildSummaryPercentileBarOption(summaryTableEntries),
    [summaryTableEntries],
  )

  const historyOption = useMemo(
    () => (charts?.history?.length ? buildHistoryOption(charts.history) : null),
    [charts?.history],
  )
  const percentileOption = useMemo(
    () => (charts?.percentile ? buildPercentileOption(charts.percentile) : null),
    [charts?.percentile],
  )
  const termOption = useMemo(
    () => (charts?.term_structure?.length ? buildTermStructureOption(charts.term_structure) : null),
    [charts?.term_structure],
  )

  useEffect(() => {
    const el = summaryTableRef.current
    if (!el) return
    const sync = () => {
      const h = Math.round(el.getBoundingClientRect().height)
      if (h > 0) setSummaryChartHeight(Math.max(h, 280))
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [summaryTableEntries])

  if (loading && !payload) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        加载商品期权数据…
      </div>
    )
  }

  if (error && !payload) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <p>{error}</p>
          <p className="text-sm mt-2">请运行夜间 ETL 的 commodity_option_iv 步骤以接入交易所波动率</p>
          <Button variant="outline" className="mt-4" onClick={() => load(true)}>重试</Button>
        </CardContent>
      </Card>
    )
  }

  const coveredSectors = SECTOR_ORDER.filter((s) =>
    visibleGroups.some((g) => g.sector === s),
  )

  return (
    <div className="space-y-6">
      {payload?.trade_date && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            数据日期：{payload.trade_date}
            {Object.keys(payload.underlyings).length > 0 && (
              <span className="ml-2">· {Object.keys(payload.underlyings).length} 个品种</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            近月系列 / ATM 隐含波动率 · 上期所 / 大商所 / 郑商所 / 广期所
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>隐含波动率概览</CardTitle>
            <CardDescription>按农产品 / 黑色 / 有色 / 能化分组，各品种当前 IV 与历史分位</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div ref={summaryTableRef} className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">品种</th>
                    <th className="py-3 pr-4 font-medium text-right">当前 IV</th>
                    <th className="py-3 pr-4 font-medium text-right">历史分位</th>
                    <th className="py-3 font-medium">分位评价</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryTableEntries.map((entry) =>
                    entry.kind === "header" ? (
                      <tr key={entry.category} className={cn(SECTOR_ROW_CLASS[entry.sector], "border-b")}>
                        <td colSpan={4} className="py-2 pr-4">
                          <span className={cn(
                            "inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold",
                            SECTOR_ACCENT[entry.sector],
                          )}>
                            {entry.sector}
                          </span>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={entry.category}
                        className={cn(
                          "border-b last:border-0 cursor-pointer transition-colors hover:bg-muted/40",
                          selectedKey && entry.row.keys.includes(selectedKey) && "bg-muted/50",
                        )}
                        onClick={() => {
                          const key = entry.row.keys[0]
                          const sector = sectorForKeys(entry.row.keys)
                          setActiveSector(sector)
                          setActiveKey(key)
                        }}
                      >
                        <td className="py-3 pr-4">
                          <div className="font-medium">
                            {shortName(undefined, entry.row.keys[0]) || entry.row.group_label}
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-right font-mono">{entry.row.iv_display}</td>
                        <td className={cn("py-3 pr-4 text-right font-mono", pctColor(entry.row.percentile))}>
                          {entry.row.percentile_display
                            ?? (entry.row.percentile != null ? `${entry.row.percentile.toFixed(1)}%` : "—")}
                        </td>
                        <td className={cn("py-3", pctColor(entry.row.percentile))}>
                          {pctLabel(entry.row.percentile)}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>全市场 IV 分位对比</CardTitle>
            <CardDescription>按板块分组比较全历史分位（虚线：20 / 50 / 80）</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {summaryPctOption ? (
              <ReactECharts
                key={`commodity-summary-pct-${summaryTableEntries.length}`}
                option={summaryPctOption}
                style={{ height: summaryChartHeight, width: "100%" }}
                notMerge
              />
            ) : (
              <div
                className="flex items-center justify-center text-sm text-muted-foreground"
                style={{ height: summaryChartHeight }}
              >
                暂无分位数据
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground w-10 shrink-0">板块</span>
          {coveredSectors.map((sector) => (
            <Button
              key={sector}
              variant={activeSector === sector ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setActiveSector(sector)
                setActiveKey(null)
              }}
            >
              {sector}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground w-10 shrink-0">品种</span>
          {sectorKeys.map((key) => {
            const u = payload?.underlyings[key]
            return (
              <Button
                key={key}
                variant={selectedKey === key ? "secondary" : "ghost"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setActiveKey(key)}
              >
                {shortName(u, key)}
                {u?.current_iv != null && (
                  <span className="ml-1.5 font-mono text-muted-foreground">
                    {u.current_iv.toFixed(0)}%
                  </span>
                )}
              </Button>
            )
          })}
        </div>
      </div>

      {selected && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">当前 IV</div>
                <div className="text-3xl font-semibold mt-1 font-mono">
                  {selected.current_iv != null ? `${selected.current_iv.toFixed(2)}%` : "—"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {productLabel} · 近月系列
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">全历史分位</div>
                <div className={cn("text-3xl font-semibold mt-1 font-mono", pctColor(selected.percentile_all))}>
                  {selected.percentile_all != null ? `${selected.percentile_all.toFixed(1)}%` : "—"}
                </div>
                <div className={cn("text-xs mt-1", pctColor(selected.percentile_all))}>
                  {pctLabel(selected.percentile_all)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">1Y 滚动分位</div>
                <div className="text-3xl font-semibold mt-1 font-mono">
                  {selected.percentile_1y != null ? `${selected.percentile_1y.toFixed(1)}%` : "—"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">所属板块</div>
                <div className="text-3xl font-semibold mt-1">
                  {selected.sector ?? selected.group ?? activeSector}
                </div>
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  {selected.label}
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-4">历史波动率分析</h2>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {productLabel ? `${productLabel} 系列 IV 时序` : "系列 IV 时序"}
                  </CardTitle>
                  <CardDescription>交易所公布的近月系列隐含波动率</CardDescription>
                </CardHeader>
                <CardContent>
                  {historyOption ? (
                    <ReactECharts option={historyOption} style={{ height: 300 }} notMerge />
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    {productLabel ? `${productLabel} IV 分位分析` : "IV 分位分析"}
                  </CardTitle>
                  <CardDescription>全历史与 1 年滚动分位</CardDescription>
                </CardHeader>
                <CardContent>
                  {percentileOption ? (
                    <ReactECharts option={percentileOption} style={{ height: 300 }} notMerge />
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                      历史样本不足，分位将随 ETL 累计
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-4">期限结构</h2>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {productLabel ? `${productLabel} IV 期限结构` : "IV 期限结构"}
                </CardTitle>
                <CardDescription>各合约系列 / 到期月 ATM 隐含波动率</CardDescription>
              </CardHeader>
              <CardContent>
                {termOption ? (
                  <ReactECharts option={termOption} style={{ height: 320 }} notMerge lazyUpdate />
                ) : (
                  <div className="h-[320px] flex items-center justify-center text-muted-foreground text-sm">暂无数据</div>
                )}
              </CardContent>
            </Card>
          </div>

          <DeeperAnalysisPanels
            selectedKey={selectedKey}
            productLabel={productLabel}
            charts={charts as never}
            underlyings={payload?.underlyings ?? {}}
            peerGroup={COMMODITY_PEER_GROUP}
          />
        </>
      )}
    </div>
  )
}
