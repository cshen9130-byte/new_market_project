"use client"

import { useMemo } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent } from "@/components/ui/card"
import { underlyingCnLabel } from "@/lib/option-iv-labels"
import { cn } from "@/lib/utils"
import { ChartCardHeader } from "./chart-help"

const CHART_FONT = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif"

const COLORS = {
  blue: "#2563eb",
  purple: "#7c3aed",
  teal: "#0f766e",
  orange: "#ea580c",
  sky: "#0ea5e9",
  red: "#dc2626",
  callBar: "rgba(239,68,68,0.85)",
  putBar: "rgba(34,197,94,0.85)",
} as const

type SizeBucket = "小盘" | "中盘" | "大盘"

const KEY_TO_SIZE_BUCKET: Record<string, SizeBucket> = {
  "1000index": "小盘",
  cyb: "小盘",
  kcb: "小盘",
  kcb_efund: "小盘",
  "500etf": "中盘",
  "500etf_sz": "中盘",
  "100etf": "大盘",
  "300etf": "大盘",
  "300etf_sz": "大盘",
  "300index": "大盘",
  "50etf": "大盘",
  "50index": "大盘",
}

const SIZE_BUCKET_ORDER: SizeBucket[] = ["小盘", "中盘", "大盘"]

export type PeerGroupConfig = {
  keyToGroup: Record<string, string>
  groupOrder: string[]
  compareTitle?: (group: string) => string
  compareDescription?: string
  heatDescription?: string
}

const DEFAULT_PEER_GROUP: PeerGroupConfig = {
  keyToGroup: KEY_TO_SIZE_BUCKET,
  groupOrder: SIZE_BUCKET_ORDER,
  compareTitle: (group) => `${group} 同档 QVIX 对比`,
  compareDescription: "同市值档品种近一年 ATM/QVIX 走势",
  heatDescription: "各品种全历史 / 1Y 滚动分位一览（偏红越贵）",
}

type ChartPoint = Record<string, number | string | null | undefined>

export type DeeperCharts = {
  iv_rv?: {
    latest_iv?: number | null
    latest_rv_20?: number | null
    latest_rv_60?: number | null
    latest_iv_rv_20?: number | null
    latest_iv_rv_60?: number | null
    series?: ChartPoint[]
  } | null
  skew?: {
    risk_reversal?: number | null
    butterfly?: number | null
    put_wing_5pct?: number | null
    call_wing_5pct?: number | null
    atm_iv?: number | null
    metrics?: Array<{ key: string; label: string; value: number | null }>
    series?: ChartPoint[]
    expiry_code?: string
    days_to_expiry?: number
  } | null
  pcr?: {
    put_oi?: number | null
    call_oi?: number | null
    pcr_oi?: number | null
    by_strike?: Array<{ strike: number; call_oi: number; put_oi: number; pcr?: number | null }>
    series?: ChartPoint[]
    expiry_code?: string
    days_to_expiry?: number
  } | null
  term_slope?: {
    near_iv?: number | null
    far_iv?: number | null
    slope?: number | null
    slope_per_30d?: number | null
    near_dte?: number | null
    far_dte?: number | null
    regime?: string | null
    points?: ChartPoint[]
    series?: ChartPoint[]
  } | null
  vol_cone?: {
    windows?: number[]
    bands?: Array<{
      window: number
      p5: number
      p25: number
      p50: number
      p75: number
      p95: number
      current_rv?: number | null
      current_iv?: number | null
    }>
  } | null
  history?: ChartPoint[] | null
}

type UnderlyingLite = {
  key: string
  label: string
  short_label?: string
  current_iv: number | null
  percentile_all: number | null
  percentile_1y: number | null
  charts?: DeeperCharts
}

function chartBase() {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: CHART_FONT, fontSize: 11 },
  }
}

function fmt(v: number | null | undefined, digits = 2) {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toFixed(digits)
}

/** Short history (ETL just started) needs visible markers — a 1-point line is invisible with showSymbol:false. */
function historyAxis(dates: string[]) {
  const short = dates.length < 8
  return {
    type: "category" as const,
    data: dates,
    boundaryGap: short,
    axisLabel: {
      fontSize: 10,
      fontFamily: CHART_FONT,
      hideOverlap: true,
      formatter: (v: string) => {
        if (short && v.length >= 10) return v.slice(5) // MM-DD
        return v.length >= 7 ? v.slice(0, 7) : v
      },
    },
  }
}

function historyLineStyle(n: number, color: string, opts?: { dashed?: boolean; width?: number }) {
  const short = n < 8
  const veryShort = n <= 3
  return {
    type: "line" as const,
    showSymbol: true,
    showAllSymbol: short,
    symbolSize: veryShort ? 12 : short ? 8 : 5,
    connectNulls: true,
    lineStyle: {
      width: opts?.width ?? 1.6,
      color,
      ...(opts?.dashed ? { type: "dashed" as const } : {}),
    },
    itemStyle: { color },
    label: veryShort
      ? {
          show: true,
          position: "top" as const,
          distance: 8,
          fontSize: 10,
          fontFamily: CHART_FONT,
          color,
          formatter: (p: { value?: number | string | null }) => {
            const v = Number(p.value)
            return Number.isFinite(v) ? v.toFixed(2) : ""
          },
        }
      : { show: false },
  }
}

function Empty({ height = 280, hint = "暂无数据" }: { height?: number; hint?: string }) {
  return (
    <div
      className="flex items-center justify-center text-sm text-muted-foreground border border-dashed rounded-lg"
      style={{ height }}
    >
      {hint}
    </div>
  )
}

function MetricTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: "pos" | "neg" | "neutral"
}) {
  const color =
    tone === "pos" ? "text-red-600" : tone === "neg" ? "text-emerald-600" : "text-foreground"
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-xl font-semibold", color)}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

function buildIvRvOption(series: ChartPoint[]) {
  const dates = series.map((d) => String(d.trade_date))
  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
    legend: {
      data: ["IV", "RV 20D", "RV 60D", "IV−RV20"],
      top: 0,
      textStyle: { fontSize: 10, fontFamily: CHART_FONT },
    },
    grid: { left: 48, right: 48, top: 36, bottom: 36 },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLabel: {
        fontSize: 10,
        fontFamily: CHART_FONT,
        hideOverlap: true,
        formatter: (v: string) => (v.length >= 7 ? v.slice(0, 7) : v),
      },
    },
    yAxis: [
      {
        type: "value",
        name: "Vol %",
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
        splitLine: { lineStyle: { opacity: 0.12 } },
      },
      {
        type: "value",
        name: "Spread",
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "IV",
        type: "line",
        data: series.map((d) => d.iv),
        showSymbol: false,
        lineStyle: { width: 1.6, color: COLORS.teal },
        itemStyle: { color: COLORS.teal },
      },
      {
        name: "RV 20D",
        type: "line",
        data: series.map((d) => d.rv_20),
        showSymbol: false,
        lineStyle: { width: 1.3, color: COLORS.blue },
        itemStyle: { color: COLORS.blue },
      },
      {
        name: "RV 60D",
        type: "line",
        data: series.map((d) => d.rv_60),
        showSymbol: false,
        lineStyle: { width: 1.3, color: COLORS.sky, type: "dashed" },
        itemStyle: { color: COLORS.sky },
      },
      {
        name: "IV−RV20",
        type: "line",
        yAxisIndex: 1,
        data: series.map((d) => d.iv_rv_20),
        showSymbol: false,
        lineStyle: { width: 1.2, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
        areaStyle: { color: "rgba(234,88,12,0.08)" },
      },
    ],
  }
}

function buildBucketCompareOption(
  selectedKey: string,
  underlyings: Record<string, UnderlyingLite>,
  peerGroup: PeerGroupConfig = DEFAULT_PEER_GROUP,
) {
  const bucket = peerGroup.keyToGroup[selectedKey] ?? peerGroup.groupOrder[0] ?? ""
  const peers = Object.values(underlyings).filter(
    (u) => peerGroup.keyToGroup[u.key] === bucket && (u.charts?.history?.length ?? 0) > 5,
  )
  if (peers.length < 1) return null

  // Align on intersection of last ~252 dates from richest peer history
  const richest = [...peers].sort(
    (a, b) => (b.charts?.history?.length ?? 0) - (a.charts?.history?.length ?? 0),
  )[0]
  const baseDates = (richest.charts?.history ?? [])
    .map((d) => String(d.trade_date))
    .slice(-252)
  if (baseDates.length < 5) return null

  const series = peers.map((u) => {
    const map = new Map(
      (u.charts?.history ?? []).map((d) => [String(d.trade_date), Number(d.iv)]),
    )
    return {
      name: underlyingCnLabel(u.key, u.short_label ?? u.label),
      type: "line" as const,
      showSymbol: baseDates.length < 8,
      lineStyle: { width: u.key === selectedKey ? 2.2 : 1.2 },
      data: baseDates.map((d) => map.get(d) ?? null),
    }
  })

  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
    legend: {
      type: "scroll",
      top: 0,
      textStyle: { fontSize: 10, fontFamily: CHART_FONT },
    },
    grid: { left: 48, right: 24, top: 40, bottom: 36 },
    xAxis: {
      type: "category",
      data: baseDates,
      boundaryGap: false,
      axisLabel: {
        fontSize: 10,
        fontFamily: CHART_FONT,
        hideOverlap: true,
        formatter: (v: string) => (v.length >= 7 ? v.slice(0, 7) : v),
      },
    },
    yAxis: {
      type: "value",
      name: "IV %",
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.12 } },
    },
    series,
  }
}

function buildSkewBarsOption(skew: NonNullable<DeeperCharts["skew"]>) {
  const metrics = (skew.metrics ?? []).filter((m) => m.value != null)
  if (!metrics.length) return null
  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
    grid: { left: 72, right: 40, top: 16, bottom: 24, containLabel: true },
    xAxis: {
      type: "value",
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT, formatter: "{value}%" },
      splitLine: { lineStyle: { opacity: 0.12 } },
    },
    yAxis: {
      type: "category",
      data: metrics.map((m) => m.label),
      inverse: true,
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
    },
    series: [
      {
        type: "bar",
        data: metrics.map((m) => ({
          value: m.value,
          itemStyle: {
            color:
              m.key === "rr"
                ? (m.value ?? 0) >= 0
                  ? COLORS.red
                  : COLORS.teal
                : m.key === "put_wing"
                  ? COLORS.putBar // CN: put = green
                  : m.key === "call_wing"
                    ? COLORS.callBar // CN: call = red
                    : COLORS.blue,
            borderRadius: [0, 3, 3, 0],
          },
        })),
        barMaxWidth: 22,
        label: {
          show: true,
          position: "right",
          fontSize: 10,
          fontFamily: CHART_FONT,
          formatter: (p: { value?: number }) =>
            p.value != null ? `${Number(p.value).toFixed(1)}%` : "",
        },
      },
    ],
  }
}

function buildSkewHistoryOption(series: ChartPoint[]) {
  const dates = series.map((d) => String(d.trade_date))
  const n = series.length
  // Single day: bar snapshot is clearer than an invisible 1-point line
  if (n === 1) {
    const row = series[0]
    return {
      ...chartBase(),
      tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
      grid: { left: 48, right: 32, top: 28, bottom: 36, containLabel: true },
      xAxis: {
        type: "category",
        data: ["Risk Reversal", "Butterfly"],
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      },
      yAxis: {
        type: "value",
        name: "IV pts",
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
        splitLine: { lineStyle: { opacity: 0.12 } },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 48,
          data: [
            {
              value: row.risk_reversal,
              itemStyle: { color: COLORS.red, borderRadius: [3, 3, 0, 0] },
            },
            {
              value: row.butterfly,
              itemStyle: { color: COLORS.purple, borderRadius: [3, 3, 0, 0] },
            },
          ],
          label: {
            show: true,
            position: "top",
            fontSize: 11,
            fontFamily: CHART_FONT,
            formatter: (p: { value?: number }) =>
              p.value != null ? Number(p.value).toFixed(2) : "",
          },
        },
      ],
    }
  }
  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
    legend: {
      data: ["Risk Reversal", "Butterfly"],
      top: 0,
      textStyle: { fontSize: 10, fontFamily: CHART_FONT },
    },
    grid: { left: 48, right: 28, top: 36, bottom: 36 },
    xAxis: historyAxis(dates),
    yAxis: {
      type: "value",
      name: "IV pts",
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.12 } },
    },
    series: [
      {
        name: "Risk Reversal",
        data: series.map((d) => d.risk_reversal),
        ...historyLineStyle(n, COLORS.red, { width: 1.5 }),
      },
      {
        name: "Butterfly",
        data: series.map((d) => d.butterfly),
        ...historyLineStyle(n, COLORS.purple, { dashed: true, width: 1.3 }),
      },
    ],
  }
}

function buildPcrStrikeOption(byStrike: NonNullable<NonNullable<DeeperCharts["pcr"]>["by_strike"]>) {
  const sorted = [...byStrike].sort((a, b) => a.strike - b.strike)
  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
    legend: {
      data: ["Call OI", "Put OI"],
      top: 0,
      textStyle: { fontSize: 10, fontFamily: CHART_FONT },
    },
    grid: { left: 48, right: 24, top: 36, bottom: 40 },
    xAxis: {
      type: "category",
      data: sorted.map((d) => String(d.strike)),
      axisLabel: { fontSize: 9, fontFamily: CHART_FONT, rotate: 45, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      name: "OI",
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.12 } },
    },
    series: [
      {
        name: "Call OI",
        type: "bar",
        data: sorted.map((d) => d.call_oi),
        itemStyle: { color: COLORS.callBar },
        barMaxWidth: 14,
      },
      {
        name: "Put OI",
        type: "bar",
        data: sorted.map((d) => d.put_oi),
        itemStyle: { color: COLORS.putBar },
        barMaxWidth: 14,
      },
    ],
  }
}

function buildPcrHistoryOption(series: ChartPoint[]) {
  const dates = series.map((d) => String(d.trade_date))
  const n = series.length
  if (n === 1) {
    const v = series[0].pcr_oi
    return {
      ...chartBase(),
      tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
      grid: { left: 48, right: 32, top: 28, bottom: 36, containLabel: true },
      xAxis: {
        type: "category",
        data: [dates[0]],
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      },
      yAxis: {
        type: "value",
        name: "PCR",
        min: 0,
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
        splitLine: { lineStyle: { opacity: 0.12 } },
      },
      series: [
        {
          name: "PCR OI",
          type: "bar",
          barMaxWidth: 56,
          data: [{ value: v, itemStyle: { color: COLORS.orange, borderRadius: [3, 3, 0, 0] } }],
          label: {
            show: true,
            position: "top",
            fontSize: 12,
            fontFamily: CHART_FONT,
            formatter: (p: { value?: number }) =>
              p.value != null ? Number(p.value).toFixed(2) : "",
          },
          markLine: {
            silent: true,
            symbol: "none",
            data: [{ yAxis: 1, label: { formatter: "1.0", fontSize: 10 } }],
            lineStyle: { type: "dashed", color: "#94a3b8" },
          },
        },
      ],
    }
  }
  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
    grid: { left: 48, right: 28, top: 28, bottom: 36 },
    xAxis: historyAxis(dates),
    yAxis: {
      type: "value",
      name: "PCR",
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.12 } },
    },
    series: [
      {
        name: "PCR OI",
        data: series.map((d) => d.pcr_oi),
        ...historyLineStyle(n, COLORS.orange),
        areaStyle: { color: "rgba(234,88,12,0.1)" },
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ yAxis: 1, label: { formatter: "1.0" } }],
          lineStyle: { type: "dashed", color: "#94a3b8" },
        },
      },
    ],
  }
}

function buildTermSlopeHistoryOption(series: ChartPoint[]) {
  const dates = series.map((d) => String(d.trade_date))
  const n = series.length
  if (n === 1) {
    const v = series[0].slope
    const color = Number(v) >= 0 ? COLORS.red : COLORS.teal
    return {
      ...chartBase(),
      tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
      grid: { left: 48, right: 32, top: 28, bottom: 36, containLabel: true },
      xAxis: {
        type: "category",
        data: [dates[0]],
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      },
      yAxis: {
        type: "value",
        name: "Far−Near",
        axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
        splitLine: { lineStyle: { opacity: 0.12 } },
      },
      series: [
        {
          name: "期限斜率",
          type: "bar",
          barMaxWidth: 56,
          data: [{ value: v, itemStyle: { color, borderRadius: Number(v) >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } }],
          label: {
            show: true,
            position: Number(v) >= 0 ? "top" : "bottom",
            fontSize: 12,
            fontFamily: CHART_FONT,
            formatter: (p: { value?: number }) =>
              p.value != null ? Number(p.value).toFixed(2) : "",
          },
          markLine: {
            silent: true,
            symbol: "none",
            data: [{ yAxis: 0 }],
            lineStyle: { type: "dashed", color: "#94a3b8" },
          },
        },
      ],
    }
  }
  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
    grid: { left: 48, right: 28, top: 28, bottom: 36 },
    xAxis: historyAxis(dates),
    yAxis: {
      type: "value",
      name: "Far−Near",
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.12 } },
    },
    series: [
      {
        name: "期限斜率",
        data: series.map((d) => d.slope),
        ...historyLineStyle(n, COLORS.blue),
        areaStyle: { color: "rgba(37,99,235,0.08)" },
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ yAxis: 0 }],
          lineStyle: { type: "dashed", color: "#94a3b8" },
        },
      },
    ],
  }
}

function buildVolConeOption(bands: NonNullable<NonNullable<DeeperCharts["vol_cone"]>["bands"]>) {
  const cats = bands.map((b) => `${b.window}D`)
  return {
    ...chartBase(),
    tooltip: { trigger: "axis", textStyle: { fontFamily: CHART_FONT } },
    legend: {
      data: ["P5", "P25", "P50", "P75", "P95", "当前 RV", "当前 IV"],
      top: 0,
      textStyle: { fontSize: 10, fontFamily: CHART_FONT },
    },
    grid: { left: 48, right: 24, top: 40, bottom: 36 },
    xAxis: {
      type: "category",
      data: cats,
      boundaryGap: false,
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
    },
    yAxis: {
      type: "value",
      name: "Vol %",
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitLine: { lineStyle: { opacity: 0.12 } },
    },
    series: [
      {
        name: "P95",
        type: "line",
        data: bands.map((b) => b.p95),
        showSymbol: false,
        lineStyle: { width: 1, color: "rgba(37,99,235,0.35)", type: "dashed" },
        itemStyle: { color: COLORS.blue },
      },
      {
        name: "P75",
        type: "line",
        data: bands.map((b) => b.p75),
        showSymbol: false,
        lineStyle: { width: 1.2, color: "rgba(37,99,235,0.55)" },
        itemStyle: { color: COLORS.blue },
      },
      {
        name: "P50",
        type: "line",
        data: bands.map((b) => b.p50),
        showSymbol: true,
        symbolSize: 6,
        lineStyle: { width: 2, color: COLORS.blue },
        itemStyle: { color: COLORS.blue },
      },
      {
        name: "P25",
        type: "line",
        data: bands.map((b) => b.p25),
        showSymbol: false,
        lineStyle: { width: 1.2, color: "rgba(37,99,235,0.55)" },
        itemStyle: { color: COLORS.blue },
      },
      {
        name: "P5",
        type: "line",
        data: bands.map((b) => b.p5),
        showSymbol: false,
        lineStyle: { width: 1, color: "rgba(37,99,235,0.35)", type: "dashed" },
        itemStyle: { color: COLORS.blue },
      },
      {
        name: "当前 RV",
        type: "scatter",
        data: bands.map((b) => b.current_rv),
        symbolSize: 10,
        itemStyle: { color: COLORS.orange },
      },
      {
        name: "当前 IV",
        type: "scatter",
        data: bands.map((b) => b.current_iv),
        symbolSize: 10,
        itemStyle: { color: COLORS.teal, borderColor: "#fff", borderWidth: 1 },
      },
    ],
  }
}

function buildPercentileHeatOption(
  underlyings: Record<string, UnderlyingLite>,
  peerGroup: PeerGroupConfig = DEFAULT_PEER_GROUP,
) {
  const items = Object.values(underlyings).filter(
    (u) => u.percentile_all != null || u.percentile_1y != null,
  )
  if (!items.length) return null

  const ordered = peerGroup.groupOrder.flatMap((b) =>
    items
      .filter((u) => peerGroup.keyToGroup[u.key] === b)
      .sort((a, b2) => (b2.percentile_all ?? 0) - (a.percentile_all ?? 0)),
  )
  // Include ungrouped leftovers
  const grouped = new Set(ordered.map((u) => u.key))
  for (const u of items) {
    if (!grouped.has(u.key)) ordered.push(u)
  }

  const yLabels = ordered.map((u) => underlyingCnLabel(u.key, u.short_label ?? u.label))
  const xLabels = ["全历史分位", "1Y滚动分位"]
  const data: Array<[number, number, number | null]> = []
  ordered.forEach((u, yi) => {
    data.push([0, yi, u.percentile_all])
    data.push([1, yi, u.percentile_1y])
  })

  return {
    ...chartBase(),
    tooltip: {
      position: "top",
      textStyle: { fontFamily: CHART_FONT },
      formatter: (p: { value?: [number, number, number | null] }) => {
        if (!p.value) return ""
        const [x, y, v] = p.value
        return `${yLabels[y]}<br/>${xLabels[x]}: ${v != null ? `${v.toFixed(1)}%` : "—"}`
      },
    },
    grid: { left: 110, right: 40, top: 16, bottom: 40, containLabel: false },
    xAxis: {
      type: "category",
      data: xLabels,
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
      splitArea: { show: true },
    },
    yAxis: {
      type: "category",
      data: yLabels,
      axisLabel: { fontSize: 10, fontFamily: CHART_FONT },
    },
    visualMap: {
      min: 0,
      max: 100,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: {
        color: ["#2563eb", "#94a3b8", "#ea580c", "#dc2626"],
      },
      textStyle: { fontSize: 10, fontFamily: CHART_FONT },
    },
    series: [
      {
        type: "heatmap",
        data: data.map(([x, y, v]) => [x, y, v ?? 0]),
        label: {
          show: true,
          fontSize: 10,
          fontFamily: CHART_FONT,
          formatter: (p: { value?: [number, number, number] }) =>
            p.value?.[2] != null ? `${p.value[2].toFixed(0)}` : "",
        },
        itemStyle: { borderColor: "#fff", borderWidth: 1 },
      },
    ],
  }
}

function regimeLabel(regime: string | null | undefined) {
  if (regime === "backwardation") return "Backwardation（近贵远便宜）"
  if (regime === "steep_contango") return "陡 Contango"
  if (regime === "contango") return "Contango"
  return "—"
}

export function DeeperAnalysisPanels({
  selectedKey,
  productLabel,
  charts,
  underlyings,
  peerGroup = DEFAULT_PEER_GROUP,
}: {
  selectedKey: string
  productLabel: string | null
  charts: DeeperCharts | undefined
  underlyings: Record<string, UnderlyingLite>
  peerGroup?: PeerGroupConfig
}) {
  const title = productLabel ?? "当前品种"
  const bucket = peerGroup.keyToGroup[selectedKey] ?? peerGroup.groupOrder[0] ?? ""

  const ivRvOption = useMemo(
    () => (charts?.iv_rv?.series?.length ? buildIvRvOption(charts.iv_rv.series) : null),
    [charts?.iv_rv],
  )
  const bucketOption = useMemo(
    () => buildBucketCompareOption(selectedKey, underlyings, peerGroup),
    [selectedKey, underlyings, peerGroup],
  )
  const skewBarsOption = useMemo(
    () => (charts?.skew ? buildSkewBarsOption(charts.skew) : null),
    [charts?.skew],
  )
  const skewHistOption = useMemo(
    () => (charts?.skew?.series && charts.skew.series.length >= 1
      ? buildSkewHistoryOption(charts.skew.series)
      : null),
    [charts?.skew?.series],
  )
  const pcrStrikeOption = useMemo(
    () => (charts?.pcr?.by_strike?.length ? buildPcrStrikeOption(charts.pcr.by_strike) : null),
    [charts?.pcr?.by_strike],
  )
  const pcrHistOption = useMemo(
    () => (charts?.pcr?.series && charts.pcr.series.length >= 1
      ? buildPcrHistoryOption(charts.pcr.series)
      : null),
    [charts?.pcr?.series],
  )
  const termSlopeHistOption = useMemo(
    () => (charts?.term_slope?.series && charts.term_slope.series.length >= 1
      ? buildTermSlopeHistoryOption(charts.term_slope.series)
      : null),
    [charts?.term_slope?.series],
  )
  const volConeOption = useMemo(
    () => (charts?.vol_cone?.bands?.length ? buildVolConeOption(charts.vol_cone.bands) : null),
    [charts?.vol_cone],
  )
  const heatOption = useMemo(
    () => buildPercentileHeatOption(underlyings, peerGroup),
    [underlyings, peerGroup],
  )

  const ivRv = charts?.iv_rv
  const skew = charts?.skew
  const pcr = charts?.pcr
  const term = charts?.term_slope

  return (
    <div className="space-y-8">
      {/* 1. Relative value */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">相对价值分析</h2>
          <p className="text-sm text-muted-foreground mt-1">
            IV 相对实现波动是否偏贵，以及同组品种谁更贵
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label="当前 IV" value={`${fmt(ivRv?.latest_iv)}%`} />
          <MetricTile label="RV 20D" value={`${fmt(ivRv?.latest_rv_20)}%`} />
          <MetricTile
            label="IV − RV20"
            value={`${fmt(ivRv?.latest_iv_rv_20)}%`}
            hint=">0 隐含偏贵"
            tone={
              ivRv?.latest_iv_rv_20 == null
                ? "neutral"
                : ivRv.latest_iv_rv_20 >= 0
                  ? "pos"
                  : "neg"
            }
          />
          <MetricTile
            label="IV − RV60"
            value={`${fmt(ivRv?.latest_iv_rv_60)}%`}
            tone={
              ivRv?.latest_iv_rv_60 == null
                ? "neutral"
                : ivRv.latest_iv_rv_60 >= 0
                  ? "pos"
                  : "neg"
            }
          />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <ChartCardHeader
              className="pb-2"
              titleClassName="text-base"
              chartId="iv-rv"
              title={`${title} IV vs 实现波动率`}
              description="ATM / 系列 IV 对比 20D·60D 实现波动，右轴为溢价"
            />
            <CardContent>
              {ivRvOption ? (
                <ReactECharts option={ivRvOption} style={{ height: 320 }} notMerge />
              ) : (
                <Empty height={320} />
              )}
            </CardContent>
          </Card>
          <Card>
            <ChartCardHeader
              className="pb-2"
              titleClassName="text-base"
              chartId="peer-iv"
              title={peerGroup.compareTitle?.(bucket) ?? `${bucket} 同组 IV 对比`}
              description={peerGroup.compareDescription ?? "同组品种 ATM / 系列 IV 走势"}
            />
            <CardContent>
              {bucketOption ? (
                <ReactECharts option={bucketOption} style={{ height: 320 }} notMerge />
              ) : (
                <Empty height={320} />
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 2. Skew & positioning */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">偏度与仓位</h2>
          <p className="text-sm text-muted-foreground mt-1">
            微笑翼部定价（Risk Reversal）与 Put/Call 持仓结构
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label="Risk Reversal"
            value={`${fmt(skew?.risk_reversal)}%`}
            hint="Put翼 − Call翼"
            tone={(skew?.risk_reversal ?? 0) >= 0 ? "pos" : "neg"}
          />
          <MetricTile label="Butterfly" value={`${fmt(skew?.butterfly)}%`} hint="凸性溢价" />
          <MetricTile
            label="PCR (OI)"
            value={fmt(pcr?.pcr_oi)}
            hint={`Put ${fmt(pcr?.put_oi, 0)} / Call ${fmt(pcr?.call_oi, 0)}`}
          />
          <MetricTile
            label="近月"
            value={skew?.expiry_code ? String(skew.expiry_code) : "—"}
            hint={skew?.days_to_expiry != null ? `${skew.days_to_expiry}D` : undefined}
          />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <ChartCardHeader
              className="pb-2"
              titleClassName="text-base"
              chartId="skew-snapshot"
              title={`${title} 当日偏度结构`}
              description="±5% moneyness 翼部 IV 与 RR / Butterfly"
            />
            <CardContent>
              {skewBarsOption ? (
                <ReactECharts option={skewBarsOption} style={{ height: 280 }} notMerge />
              ) : (
                <Empty />
              )}
            </CardContent>
          </Card>
          <Card>
            <ChartCardHeader
              className="pb-2"
              titleClassName="text-base"
              chartId="skew-history"
              title={`${title} 偏度时序`}
              description={
                skewHistOption
                  ? (charts?.skew?.series?.length ?? 0) <= 1
                    ? `当日快照 ${String(charts?.skew?.series?.[0]?.trade_date ?? "")} · 历史将随每日 ETL 变长`
                    : (charts?.skew?.series?.length ?? 0) < 5
                      ? "日度沉淀刚开始，点会随每日 ETL 变长"
                      : "历史 Risk Reversal / Butterfly（ETL 日度沉淀）"
                  : "暂无偏度历史"
              }
            />
            <CardContent>
              {skewHistOption ? (
                <ReactECharts option={skewHistOption} style={{ height: 280 }} notMerge />
              ) : (
                <Empty />
              )}
            </CardContent>
          </Card>
          <Card>
            <ChartCardHeader
              className="pb-2"
              titleClassName="text-base"
              chartId="pcr-oi"
              title={`${title} Put/Call OI`}
              description={
                pcr?.expiry_code
                  ? `${pcr.expiry_code} · ${pcr.days_to_expiry ?? "—"}D 链上持仓`
                  : "近月链 Call / Put 持仓量"
              }
            />
            <CardContent>
              {pcrStrikeOption ? (
                <ReactECharts option={pcrStrikeOption} style={{ height: 280 }} notMerge />
              ) : (
                <Empty />
              )}
            </CardContent>
          </Card>
          <Card>
            <ChartCardHeader
              className="pb-2"
              titleClassName="text-base"
              chartId="pcr-history"
              title={`${title} PCR 时序`}
              description={
                pcrHistOption
                  ? (charts?.pcr?.series?.length ?? 0) <= 1
                    ? `当日快照 ${String(charts?.pcr?.series?.[0]?.trade_date ?? "")} · 历史将随每日 ETL 变长`
                    : (charts?.pcr?.series?.length ?? 0) < 5
                      ? "日度沉淀刚开始，点会随每日 ETL 变长"
                      : "Put/Call OI 比率历史"
                  : "暂无 PCR 历史"
              }
            />
            <CardContent>
              {pcrHistOption ? (
                <ReactECharts option={pcrHistOption} style={{ height: 280 }} notMerge />
              ) : (
                <Empty />
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 3. Term & vol cone */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">期限结构与波动率锥</h2>
          <p className="text-sm text-muted-foreground mt-1">
            近远月斜率形态，以及实现波动在历史分布中的位置
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile
            label="近月 IV"
            value={`${fmt(term?.near_iv)}%`}
            hint={term?.near_dte != null ? `${fmt(term.near_dte, 0)}D` : undefined}
          />
          <MetricTile
            label="远月 IV"
            value={`${fmt(term?.far_iv)}%`}
            hint={term?.far_dte != null ? `${fmt(term.far_dte, 0)}D` : undefined}
          />
          <MetricTile
            label="斜率 (Far−Near)"
            value={`${fmt(term?.slope)}%`}
            hint={regimeLabel(term?.regime)}
            tone={(term?.slope ?? 0) < 0 ? "pos" : "neutral"}
          />
          <MetricTile
            label="斜率 / 30D"
            value={`${fmt(term?.slope_per_30d)}%`}
            hint="标准化斜率"
          />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <ChartCardHeader
              className="pb-2"
              titleClassName="text-base"
              chartId="term-slope"
              title={`${title} 期限斜率时序`}
              description={
                termSlopeHistOption
                  ? (charts?.term_slope?.series?.length ?? 0) <= 1
                    ? `当日快照 ${String(charts?.term_slope?.series?.[0]?.trade_date ?? "")} · 历史将随每日 ETL 变长`
                    : (charts?.term_slope?.series?.length ?? 0) < 5
                      ? "日度沉淀刚开始，点会随每日 ETL 变长"
                      : "远月 − 近月 ATM IV 历史"
                  : "暂无斜率历史"
              }
            />
            <CardContent>
              {termSlopeHistOption ? (
                <ReactECharts option={termSlopeHistOption} style={{ height: 300 }} notMerge />
              ) : (
                <Empty height={300} />
              )}
            </CardContent>
          </Card>
          <Card>
            <ChartCardHeader
              className="pb-2"
              titleClassName="text-base"
              chartId="vol-cone"
              title={`${title} 实现波动率锥`}
              description="各窗口 RV 历史分位带 vs 当前 RV / IV"
            />
            <CardContent>
              {volConeOption ? (
                <ReactECharts option={volConeOption} style={{ height: 300 }} notMerge />
              ) : (
                <Empty height={300} />
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* 4. Cross-section heatmap */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">全市场分位热力</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {peerGroup.heatDescription ?? "各品种全历史 / 1Y 滚动分位一览（偏红越贵）"}
          </p>
        </div>
        <Card>
          <ChartCardHeader
            className="pb-2"
            titleClassName="text-base"
            chartId="iv-heat"
            title="IV 分位热力图"
            description="按小盘 / 中盘 / 大盘分组展示"
          />
          <CardContent>
            {heatOption ? (
              <ReactECharts
                option={heatOption}
                style={{ height: Math.max(320, Object.keys(underlyings).length * 28 + 80) }}
                notMerge
              />
            ) : (
              <Empty height={320} />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
