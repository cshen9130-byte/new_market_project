"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { ArrowLeftRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  buFenggeTargetSleeve,
  classifyRowFlow,
  decomposeNet,
  fmtFlowYuan,
  lookupFlow,
  pctRowDecision,
  type ActionKind,
  type ExposureMetric,
  type FlowMap,
  type FlowView,
  type RowDecision,
  type TsProductPoint,
  type TsSectorPoint,
} from "@/lib/ma/quant-vs-subjective-signals"
import { HelpCandle, HelpHoldingBar, HelpWaterfall } from "@/components/ma/quant-vs-subjective-help"

const ACTION_HEAT_COLOR: Record<ActionKind, string> = {
  加码: "#ef4444",
  暂缓加码: "#64748b",
  减码准备: "#ec4899",
  观望: "#8b5cf6",
  补风格: "#0ea5e9",
  控拥挤: "#f59e0b",
  扩容: "#10b981",
}

const ACTION_HEAT_CODE: Record<Exclude<ActionKind, "扩容">, number> = {
  加码: 1,
  观望: 2,
  补风格: 3,
  控拥挤: 4,
  暂缓加码: 6,
  减码准备: 7,
}

const MAX_SIGNAL_PROD_ROWS = 8
const SIGNAL_ROW_H = 36

function signalStripExtraHeight(n: number): number {
  return n > 0 ? 16 + SIGNAL_ROW_H * n : 0
}

function SignalLegend() {
  const items = [
    ["加码", ACTION_HEAT_COLOR.加码],
    ["暂缓加码", ACTION_HEAT_COLOR.暂缓加码],
    ["减码准备", ACTION_HEAT_COLOR.减码准备],
    ["观望", ACTION_HEAT_COLOR.观望],
    ["补风格", ACTION_HEAT_COLOR.补风格],
    ["控拥挤", ACTION_HEAT_COLOR.控拥挤],
  ] as const
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
          {label}
        </span>
      ))}
    </span>
  )
}

export interface HoldingProduct {
  code: string
  name: string
  cat: string
  sector: string
  subSector: string
}

export interface HoldingTs {
  dates: string[]
  products: HoldingProduct[]
  quantLong: number[][]
  quantShort: number[][]
  quantLongLots?: number[][]
  quantShortLots?: number[][]
  subjLong: number[][]
  subjShort: number[][]
  subjLongLots?: number[][]
  subjShortLots?: number[][]
  sigma: number[][]
}

const CAT_SERIES = [
  { cat: "商品", longName: "多-商品", shortName: "空-商品", longColor: "#38bdf8", shortColor: "#fb923c" },
  { cat: "股指", longName: "多-股指", shortName: "空-股指", longColor: "#818cf8", shortColor: "#f87171" },
  { cat: "国债", longName: "多-国债", shortName: "空-国债", longColor: "#2dd4bf", shortColor: "#e879f9" },
] as const

function fmtYi(v: number): string {
  const n = Math.round(Math.abs(v) / 1e8 * 100) / 100
  return `${v < 0 ? "-" : ""}${n}亿`
}

function fmtRisk(v: number): string {
  const n = Math.round(Math.abs(v) / 1e4)
  return `${v < 0 ? "-" : ""}${n}万`
}

function fmtWan(v: number): string {
  const n = Math.abs(v) / 1e4
  const body = n >= 10 ? n.toFixed(0) : n.toFixed(1)
  return `${v < 0 ? "-" : ""}${body}万`
}

function lineEndLabel(color: string, formatter: (p: { value: number }) => string) {
  return {
    show: true,
    formatter,
    color: "#fff",
    fontSize: 10,
    fontWeight: "bold" as const,
    align: "right" as const,
    verticalAlign: "middle" as const,
    offset: [-8, 0] as [number, number],
    backgroundColor: color,
    padding: [2, 5] as [number, number],
    borderRadius: 3,
  }
}

type CandleRow = { date: string; open: number; high: number; low: number; close: number; volume: number }

type StripDecision = RowDecision & { quantNetPct: number; subjNetPct: number }

type SignalStripRow = { name: string; byDate: Map<string, StripDecision> }

type SignalVerdict = {
  text: "好信号" | "坏信号" | "持平" | "待验证"
  pnl: number | null
  color: string
  asPct: boolean
}

function actionsByDate(pts: { date: string; quantNetPct: number; subjNetPct: number }[]): Map<string, StripDecision> {
  const map = new Map<string, StripDecision>()
  for (const p of pts) {
    const d = pctRowDecision(p.quantNetPct, p.subjNetPct)
    if (d.action === "中性" || d.action === "扩容") continue
    map.set(p.date, { ...d, quantNetPct: p.quantNetPct, subjNetPct: p.subjNetPct })
  }
  return map
}

function actionOnSleeve(d: RowDecision | undefined, sleeve: "量化" | "主观"): ActionKind | undefined {
  if (!d || d.action === "中性" || d.action === "扩容") return undefined
  if (d.action === "补风格") {
    const target = buFenggeTargetSleeve(d.kind)
    if (target && target !== sleeve) return undefined
  }
  return d.action
}

function streakEnd(actions: (ActionKind | undefined)[], start: number): number {
  const a = actions[start]
  let e = start
  while (e + 1 < actions.length && actions[e + 1] === a) e++
  return e
}

function verdictFromPnl(pnl: number, asPct: boolean, invert = false): SignalVerdict {
  const score = invert ? -pnl : pnl
  if (score > 1e-8) return { text: "好信号", pnl, color: "#dc2626", asPct }
  if (score < -1e-8) return { text: "坏信号", pnl, color: "#16a34a", asPct }
  return { text: "持平", pnl, color: "#64748b", asPct }
}

function pendingVerdict(asPct: boolean): SignalVerdict {
  return { text: "待验证", pnl: null, color: "#64748b", asPct }
}

function crowdedDir(decision: StripDecision | undefined, netMv: number): number {
  const fromPct = Math.sign((decision?.quantNetPct ?? 0) + (decision?.subjNetPct ?? 0))
  if (fromPct !== 0) return fromPct
  const q = Math.sign(decision?.quantNetPct ?? 0)
  if (q !== 0) return q
  return Math.sign(netMv)
}

/** 加码: hold this sleeve's signed position until the run ends. 补风格: fill in the other sleeve's direction, score with price. 控拥挤: reduce the crowded side; a later move against it is 好信号. */
function qualityAt(
  i: number,
  action: ActionKind | undefined,
  actions: (ActionKind | undefined)[],
  candles: CandleRow[],
  dates: string[],
  netMvByDate: Map<string, number>,
  decision: StripDecision | undefined,
): SignalVerdict | undefined {
  if (action !== "加码" && action !== "补风格" && action !== "控拥挤") return undefined
  const asPct = action === "补风格" || action === "控拥挤"
  const n = candles.length
  let to = streakEnd(actions, i)
  if (to <= i) to = i + 1
  if (to >= n) to = n - 1
  if (to <= i) return pendingVerdict(asPct)
  const c0 = candles[i]?.close ?? 0
  const c1 = candles[to]?.close ?? 0
  if (c0 <= 0 || c1 <= 0) return pendingVerdict(asPct)
  const ret = c1 / c0 - 1
  if (action === "加码") {
    return verdictFromPnl((netMvByDate.get(dates[i]) ?? 0) * ret, false)
  }
  if (action === "控拥挤") {
    const dir = crowdedDir(decision, netMvByDate.get(dates[i]) ?? 0)
    if (dir === 0) return pendingVerdict(true)
    return verdictFromPnl(dir * ret, true, true)
  }
  const dir = decision?.kind === "subj_only"
    ? Math.sign(decision.subjNetPct)
    : decision?.kind === "quant_only"
      ? Math.sign(decision.quantNetPct)
      : 0
  if (dir === 0) return pendingVerdict(true)
  return verdictFromPnl(dir * ret, true)
}

function formatVerdictHtml(action: string, v: SignalVerdict | undefined): string {
  if (!v) return action
  const pnlPart = v.pnl == null
    ? ""
    : v.asPct
      ? `　随后该方向 ${v.pnl >= 0 ? "+" : ""}${(v.pnl * 100).toFixed(1)}%`
      : `　随后盈亏 ${v.pnl > 0 ? "+" : ""}${fmtWan(v.pnl)}`
  return `${action}　<span style="color:${v.color};font-weight:600">${v.text}</span>${pnlPart}`
}

function buildFocusSignalRows(
  products: HoldingProduct[],
  sector: string,
  subSector: string,
  prod: string,
  sectorTs: TsSectorPoint[],
  productTs: TsProductPoint[],
): SignalStripRow[] {
  if (prod !== "全部") {
    const p = products.find((x) => x.code === prod)
    return [{ name: p?.name ?? prod, byDate: actionsByDate(productTs.filter((x) => x.product === prod)) }]
  }
  if (subSector !== "全部") {
    const plist = products.filter((p) => p.subSector === subSector)
    const seen = new Set<string>()
    const prodRows = plist.map((p) => {
      const name = seen.has(p.name) ? `${p.name} ${p.code}` : p.name
      seen.add(p.name)
      return { name, byDate: actionsByDate(productTs.filter((x) => x.product === p.code)) }
    })
    prodRows.sort((a, b) => b.byDate.size - a.byDate.size)
    const withSignal = prodRows.filter((r) => r.byDate.size > 0)
    return (withSignal.length ? withSignal : prodRows).slice(0, MAX_SIGNAL_PROD_ROWS)
  }
  if (sector !== "全部") {
    return [{ name: sector, byDate: actionsByDate(sectorTs.filter((x) => x.sector === sector)) }]
  }
  return []
}

function buildSleeveCandleOption(
  candles: CandleRow[],
  netMvByDate: Map<string, number>,
  priceLabel: string,
  sleeveName: "量化" | "主观",
  lineColor: string,
  signalRows: SignalStripRow[],
) {
  if (!candles.length) return {}
  const dates = candles.map((r) => r.date)
  const ohlc = candles.map((r) => [r.open, r.close, r.low, r.high])
  let cum = 0
  const cumPnl: (number | null)[] = []
  const dayPnl: number[] = []
  for (let i = 0; i < candles.length; i++) {
    if (i === 0 || candles[i - 1].close <= 0) {
      dayPnl.push(0)
      cumPnl.push(cum)
      continue
    }
    const ret = candles[i].close / candles[i - 1].close - 1
    const pos = netMvByDate.get(candles[i - 1].date) ?? 0
    const pnl = pos * ret
    dayPnl.push(pnl)
    cum += pnl
    cumPnl.push(cum)
  }
  const pnlName = `${sleeveName}累计盈亏`
  const hasSignal = signalRows.length > 0
  const heatH = hasSignal ? SIGNAL_ROW_H * signalRows.length : 0
  const heat: [number, number, number][] = []
  const quality: (SignalVerdict | undefined)[][] = signalRows.map(() => dates.map(() => undefined))
  if (hasSignal) {
    signalRows.forEach((row, yi) => {
      const actions = dates.map((d) => actionOnSleeve(row.byDate.get(d), sleeveName))
      dates.forEach((d, xi) => {
        const action = actions[xi]
        if (!action) return
        heat.push([xi, yi, ACTION_HEAT_CODE[action as Exclude<ActionKind, "扩容">] ?? 0])
        quality[yi][xi] = qualityAt(xi, action, actions, candles, dates, netMvByDate, row.byDate.get(d))
      })
    })
  }
  const codeToAction = (code: number) =>
    (Object.entries(ACTION_HEAT_CODE).find(([, v]) => v === code)?.[0] ?? "") as string

  return {
    tooltip: {
      trigger: "axis" as const,
      axisPointer: {
        type: "cross" as const,
        label: { fontSize: 10, backgroundColor: "#64748b", padding: [2, 4] },
      },
      formatter: (params: { seriesName: string; dataIndex: number; marker: string; axisValue: string }[]) => {
        const i = params[0]?.dataIndex ?? 0
        const r = candles[i]
        if (!r) return ""
        const up = r.close >= r.open
        const lines = [
          params[0]?.axisValue,
          `开 ${r.open.toFixed(2)}　高 ${r.high.toFixed(2)}　低 ${r.low.toFixed(2)}　收 ${r.close.toFixed(2)}　${up ? "涨" : "跌"}`,
          `${sleeveName}当日盈亏 ${fmtWan(dayPnl[i] ?? 0)}`,
          `${pnlName} ${fmtWan(cumPnl[i] ?? 0)}`,
        ]
        if (hasSignal) {
          const d = dates[i]
          for (let yi = 0; yi < signalRows.length; yi++) {
            const row = signalRows[yi]
            const action = actionOnSleeve(row.byDate.get(d), sleeveName)
            lines.push(`${row.name}　${formatVerdictHtml(action ?? "中性", quality[yi]?.[i])}`)
          }
        }
        return lines.join("<br/>")
      },
    },
    legend: { top: 4, left: 8, itemWidth: 12, textStyle: { fontSize: 11 }, data: ["K线", pnlName] },
    visualMap: hasSignal
      ? {
          show: false,
          type: "piecewise" as const,
          seriesIndex: 2,
          dimension: 2,
          pieces: [
            { value: 1, color: ACTION_HEAT_COLOR.加码 },
            { value: 2, color: ACTION_HEAT_COLOR.观望 },
            { value: 3, color: ACTION_HEAT_COLOR.补风格 },
            { value: 4, color: ACTION_HEAT_COLOR.控拥挤 },
            { value: 6, color: ACTION_HEAT_COLOR.暂缓加码 },
            { value: 7, color: ACTION_HEAT_COLOR.减码准备 },
          ],
        }
      : undefined,
    grid: hasSignal
      ? [
          { left: 72, right: 76, top: 36, bottom: 48 + heatH + 8 },
          { left: 72, right: 76, height: heatH, bottom: 48 },
        ]
      : { left: 52, right: 76, top: 36, bottom: 48 },
    dataZoom: [
      { type: "inside" as const, xAxisIndex: hasSignal ? [0, 1] : 0, start: 0, end: 100 },
      { type: "slider" as const, xAxisIndex: hasSignal ? [0, 1] : 0, height: 16, bottom: 4 },
    ],
    xAxis: hasSignal
      ? [
          {
            type: "category" as const,
            gridIndex: 0,
            data: dates,
            axisLabel: { show: false },
            axisTick: { show: false },
            boundaryGap: true,
          },
          {
            type: "category" as const,
            gridIndex: 1,
            data: dates,
            axisLabel: {
              fontSize: 10,
              rotate: 30,
              formatter: (v: string) => (v.length >= 10 ? v.slice(5) : v),
            },
            boundaryGap: true,
          },
        ]
      : {
          type: "category" as const,
          data: dates,
          axisLabel: {
            fontSize: 10,
            rotate: 30,
            formatter: (v: string) => (v.length >= 10 ? v.slice(5) : v),
          },
          boundaryGap: true,
        },
    yAxis: hasSignal
      ? [
          {
            type: "value" as const,
            gridIndex: 0,
            scale: true,
            name: priceLabel,
            nameGap: 8,
            nameTextStyle: { fontSize: 10 },
            axisLabel: { fontSize: 10, hideOverlap: true },
            splitLine: { lineStyle: { type: "dashed" as const } },
            axisPointer: {
              label: { formatter: (p: { value: number }) => Number(p.value).toFixed(0) },
            },
          },
          {
            type: "value" as const,
            gridIndex: 0,
            position: "right" as const,
            scale: true,
            name: "累计盈亏",
            nameGap: 10,
            nameTextStyle: { fontSize: 10 },
            axisLabel: { fontSize: 10, formatter: (v: number) => fmtWan(v), hideOverlap: true, margin: 8 },
            splitLine: { show: false },
            axisPointer: {
              label: { formatter: (p: { value: number }) => fmtWan(Number(p.value)) },
            },
          },
          {
            type: "category" as const,
            gridIndex: 1,
            data: signalRows.map((r) => r.name),
            axisLabel: { fontSize: 10 },
            axisTick: { show: false },
            splitLine: { show: false },
            inverse: true,
          },
        ]
      : [
          {
            type: "value" as const,
            scale: true,
            name: priceLabel,
            nameGap: 8,
            nameTextStyle: { fontSize: 10 },
            axisLabel: { fontSize: 10, hideOverlap: true },
            splitLine: { lineStyle: { type: "dashed" as const } },
            axisPointer: {
              label: { formatter: (p: { value: number }) => Number(p.value).toFixed(0) },
            },
          },
          {
            type: "value" as const,
            position: "right" as const,
            scale: true,
            name: "累计盈亏",
            nameGap: 10,
            nameTextStyle: { fontSize: 10 },
            axisLabel: { fontSize: 10, formatter: (v: number) => fmtWan(v), hideOverlap: true, margin: 8 },
            splitLine: { show: false },
            axisPointer: {
              label: { formatter: (p: { value: number }) => fmtWan(Number(p.value)) },
            },
          },
        ],
    series: [
      {
        name: "K线",
        type: "candlestick" as const,
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ohlc,
        itemStyle: {
          color: "#ef4444",
          color0: "#22c55e",
          borderColor: "#ef4444",
          borderColor0: "#22c55e",
        },
      },
      {
        name: pnlName,
        type: "line" as const,
        xAxisIndex: 0,
        yAxisIndex: 1,
        data: cumPnl,
        symbol: "none",
        lineStyle: { color: lineColor, width: 2 },
        itemStyle: { color: lineColor },
        endLabel: lineEndLabel(lineColor, (p) => fmtWan(p.value)),
        z: 10,
      },
      ...(hasSignal
        ? [{
            name: "决策信号",
            type: "heatmap" as const,
            xAxisIndex: 1,
            yAxisIndex: 2,
            data: heat,
            itemStyle: { borderColor: "transparent", borderWidth: 0 },
            tooltip: {
              formatter: (p: { data: [number, number, number] }) => {
                const [xi, yi, code] = p.data
                const action = codeToAction(code)
                const name = signalRows[yi]?.name ?? ""
                const q = quality[yi]?.[xi]
                return `${dates[xi]}<br/>${name}　${formatVerdictHtml(action, q)}`
              },
            },
            label: { show: false },
            emphasis: {
              itemStyle: { shadowBlur: 4, shadowColor: "rgba(0,0,0,0.25)" },
              label: {
                show: true,
                formatter: (p: { data: [number, number, number] }) => {
                  const q = quality[p.data[1]]?.[p.data[0]]
                  if (!q || q.text === "待验证") return ""
                  return q.text === "好信号" ? "好" : q.text === "坏信号" ? "坏" : "平"
                },
                color: "#fff",
                fontSize: 10,
                fontWeight: "bold" as const,
              },
            },
          }]
        : []),
    ],
  }
}

type SeriesCfg = { name: string; stack: "long" | "short"; color: string; data: number[] }

function sleeveDecomp(
  holdingTs: HoldingTs,
  idxs: number[],
  sleeve: "quant" | "subj",
) {
  const dates = holdingTs.dates
  const di = dates.length - 1
  if (di < 1) return null
  const prevDi = di - 1
  const long = sleeve === "quant" ? holdingTs.quantLong : holdingTs.subjLong
  const short = sleeve === "quant" ? holdingTs.quantShort : holdingTs.subjShort
  const longLots = sleeve === "quant" ? holdingTs.quantLongLots : holdingTs.subjLongLots
  const shortLots = sleeve === "quant" ? holdingTs.quantShortLots : holdingTs.subjShortLots
  let prevNet = 0
  let todayNet = 0
  let trade = 0
  let price = 0
  for (const pi of idxs) {
    const today = {
      longMv: long[di]?.[pi] ?? 0,
      shortMv: short[di]?.[pi] ?? 0,
      longLots: longLots?.[di]?.[pi] ?? 0,
      shortLots: shortLots?.[di]?.[pi] ?? 0,
    }
    const prev = {
      longMv: long[prevDi]?.[pi] ?? 0,
      shortMv: short[prevDi]?.[pi] ?? 0,
      longLots: longLots?.[prevDi]?.[pi] ?? 0,
      shortLots: shortLots?.[prevDi]?.[pi] ?? 0,
    }
    const d = decomposeNet(prev, today)
    prevNet += d.prevNet
    todayNet += d.todayNet
    trade += d.trade
    price += d.price
  }
  return { prevNet, todayNet, trade, price, delta: todayNet - prevNet, date: dates[di], prevDate: dates[prevDi] }
}

function buildWaterfallOption(
  q: NonNullable<ReturnType<typeof sleeveDecomp>>,
  s: NonNullable<ReturnType<typeof sleeveDecomp>>,
) {
  const cats = ["昨净仓", "价格损益", "主动调仓", "今净仓"]
  const qv = [q.prevNet, q.price, q.trade, q.todayNet]
  const sv = [s.prevNet, s.price, s.trade, s.todayNet]
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (params: { seriesName: string; dataIndex: number; marker: string; value: number }[]) => {
        const i = params[0]?.dataIndex ?? 0
        return [
          cats[i],
          ...params.map((p) => `${p.marker}${p.seriesName} ${fmtYi(p.value)}`),
        ].join("<br/>")
      },
    },
    legend: { top: 4, right: 8, textStyle: { fontSize: 11 }, data: ["量化", "主观"] },
    grid: { left: 56, right: 16, top: 32, bottom: 28 },
    xAxis: { type: "category" as const, data: cats, axisLabel: { fontSize: 11 } },
    yAxis: {
      type: "value" as const,
      axisLabel: { fontSize: 10, formatter: (v: number) => fmtYi(v) },
      splitLine: { lineStyle: { type: "dashed" as const, opacity: 0.25 } },
    },
    series: [
      { name: "量化", type: "bar" as const, data: qv, barMaxWidth: 18, itemStyle: { color: "#3b82f6", borderRadius: 2 } },
      { name: "主观", type: "bar" as const, data: sv, barMaxWidth: 18, itemStyle: { color: "#f59e0b", borderRadius: 2 } },
    ],
  }
}

function deltaLine(
  label: string,
  d: NonNullable<ReturnType<typeof sleeveDecomp>>,
  netDisplay: number,
  metric: ExposureMetric,
) {
  const fmtNet = metric === "risk" ? fmtRisk : fmtYi
  return `${label}净仓 ${fmtNet(netDisplay)}　市值 Δ ${fmtYi(d.delta)}（主动 ${fmtYi(d.trade)} · 价格 ${fmtYi(d.price)}）`
}

function buildOption(
  dates: string[],
  series: SeriesCfg[],
  net: number[],
  metric: ExposureMetric,
) {
  const fmt = metric === "risk" ? fmtRisk : fmtYi
  const axisFmt = metric === "risk"
    ? (v: number) => `${(v / 1e4).toFixed(0)}万`
    : (v: number) => `${(v / 1e8).toFixed(1)}亿`
  return {
    tooltip: {
      trigger: "axis" as const,
      formatter: (params: { seriesName: string; value: number; marker: string }[]) => {
        const date = (params[0] as unknown as { axisValue: string }).axisValue
        const longTotal = params.filter((p) => p.seriesName.startsWith("多")).reduce((s, p) => s + p.value, 0)
        const shortTotal = params.filter((p) => p.seriesName.startsWith("空")).reduce((s, p) => s + Math.abs(p.value), 0)
        const netV = params.find((p) => p.seriesName === "净持仓")?.value ?? (longTotal - shortTotal)
        const dot = (c: string) => `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin-right:4px"></span>`
        return [
          date,
          `${dot("#38bdf8")}多头合计: ${fmt(longTotal)}`,
          `${dot("#fb923c")}空头合计: ${fmt(shortTotal)}`,
          `${dot("#dc2626")}净持仓: ${fmt(netV)}`,
        ].join("<br/>")
      },
    },
    legend: { top: 5, itemWidth: 12, itemGap: 8, textStyle: { fontSize: 11 } },
    grid: { left: 58, right: 64, top: 36, bottom: 48 },
    dataZoom: [
      { type: "inside" as const, start: 0, end: 100 },
      { type: "slider" as const, height: 16, bottom: 4 },
    ],
    xAxis: {
      type: "category" as const,
      data: dates,
      axisLabel: { fontSize: 10, rotate: 30 },
    },
    yAxis: {
      type: "value" as const,
      axisLabel: { formatter: axisFmt, fontSize: 10 },
      splitLine: { lineStyle: { type: "dashed" as const } },
    },
    series: [
      ...series.map((c) => ({
        name: c.name,
        type: "bar" as const,
        stack: c.stack,
        data: c.data,
        itemStyle: { color: c.color },
        barMaxWidth: 14,
      })),
      {
        name: "净持仓",
        type: "line" as const,
        data: net,
        symbol: "none",
        lineStyle: { color: "#dc2626", width: 2.5 },
        itemStyle: { color: "#dc2626" },
        endLabel: {
          show: true,
          formatter: (p: { value: number }) => fmt(p.value),
          color: "#dc2626",
          fontSize: 11,
          fontWeight: "bold" as const,
        },
        z: 10,
      },
    ],
  }
}

export type HoldingFocus = { level: "sector" | "product"; key: string }

export default function QuantVsSubjectiveHoldingTs({
  holdingTs,
  metric,
  focus,
  sectorTs,
  productTs,
  flows,
}: {
  holdingTs: HoldingTs | null | undefined
  metric: ExposureMetric
  focus?: HoldingFocus | null
  sectorTs?: TsSectorPoint[]
  productTs?: TsProductPoint[]
  flows?: FlowMap
}) {
  const [cat, setCat] = useState("全部")
  const [sector, setSector] = useState("全部")
  const [subSector, setSubSector] = useState("全部")
  const [prod, setProd] = useState("全部")
  const [candles, setCandles] = useState<CandleRow[]>([])
  const [candleLoading, setCandleLoading] = useState(false)
  const [swapped, setSwapped] = useState(false)

  const products = holdingTs?.products ?? []
  const dates = holdingTs?.dates ?? []
  const focusLevel = focus?.level ?? ""
  const focusKey = focus?.key ?? ""
  const hasHoldings = (holdingTs?.products.length ?? 0) > 0
  const holdingTsRef = useRef(holdingTs)
  holdingTsRef.current = holdingTs

  useEffect(() => {
    const ts = holdingTsRef.current
    if (!focusLevel || !focusKey || !hasHoldings || !ts) return
    const list = ts.products
    if (focusLevel === "product") {
      const p = list.find((x) => x.code === focusKey)
      if (!p) return
      setCat(p.cat || "全部")
      setSector(p.sector || "全部")
      setSubSector(p.subSector || "全部")
      setProd(p.code)
      return
    }
    const p = list.find((x) => x.sector === focusKey)
    setCat(p?.cat || "全部")
    setSector(focusKey)
    setSubSector("全部")
    setProd("全部")
  }, [focusLevel, focusKey, hasHoldings])

  const candleKey = prod !== "全部"
    ? `p:${prod}`
    : subSector !== "全部"
      ? `u:${subSector}`
      : sector !== "全部"
        ? `s:${sector}`
        : ""
  const dateFrom = dates[0] ?? ""
  const dateTo = dates[dates.length - 1] ?? ""

  useEffect(() => {
    if (!candleKey || !dateFrom || !dateTo) {
      setCandles([])
      setCandleLoading(false)
      return
    }
    const ts = holdingTsRef.current
    if (!ts) return
    let codes: string[]
    if (candleKey.startsWith("p:")) codes = [candleKey.slice(2)]
    else if (candleKey.startsWith("s:")) codes = ts.products.filter((p) => p.sector === candleKey.slice(2)).map((p) => p.code)
    else codes = ts.products.filter((p) => p.subSector === candleKey.slice(2)).map((p) => p.code)
    codes = codes.slice(0, 24)
    if (!codes.length) {
      setCandles([])
      return
    }
    const ac = new AbortController()
    const qs = codes.length === 1
      ? `product=${encodeURIComponent(codes[0])}&from=${dateFrom}&to=${dateTo}`
      : `products=${encodeURIComponent(codes.join(","))}&from=${dateFrom}&to=${dateTo}`
    setCandleLoading(true)
    fetch(`/ma/api/mom-analysis/product-candle?${qs}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: CandleRow[] }) => {
        if (ac.signal.aborted) return
        setCandles(j.data ?? [])
      })
      .catch(() => {
        if (!ac.signal.aborted) setCandles([])
      })
      .finally(() => {
        if (!ac.signal.aborted) setCandleLoading(false)
      })
    return () => ac.abort()
  }, [candleKey, dateFrom, dateTo])

  const sectors = useMemo(() => {
    const rows = cat === "全部" ? products : products.filter((p) => p.cat === cat)
    return [...new Set(rows.map((p) => p.sector).filter((s) => s && s !== "其他"))].sort()
  }, [products, cat])

  const subSectors = useMemo(() => {
    let rows = products
    if (sector !== "全部") rows = rows.filter((p) => p.sector === sector)
    else if (cat !== "全部") rows = rows.filter((p) => p.cat === cat)
    return [...new Set(rows.map((p) => p.subSector).filter((s) => s && s !== "其他"))].sort()
  }, [products, cat, sector])

  const prodOptions = useMemo(() => {
    let rows = products
    if (subSector !== "全部") rows = rows.filter((p) => p.subSector === subSector)
    else if (sector !== "全部") rows = rows.filter((p) => p.sector === sector)
    else if (cat !== "全部") rows = rows.filter((p) => p.cat === cat)
    return rows
  }, [products, cat, sector, subSector])

  const selectedIdx = useMemo(() => {
    return products
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => {
        if (prod !== "全部") return p.code === prod
        if (subSector !== "全部") return p.subSector === subSector
        if (sector !== "全部") return p.sector === sector
        if (cat !== "全部") return p.cat === cat
        return true
      })
      .map(({ i }) => i)
  }, [products, cat, sector, subSector, prod])

  const sleeveSeries = useMemo(() => {
    if (!holdingTs || !dates.length) return { quant: [] as SeriesCfg[], subj: [] as SeriesCfg[], qNet: [] as number[], sNet: [] as number[] }

    const scale = (mv: number, di: number, pi: number) => {
      if (metric !== "risk") return mv
      return mv * (holdingTs.sigma[di]?.[pi] ?? 0)
    }

    const sumLong = (grid: number[][], di: number, idxs: number[]) =>
      idxs.reduce((s, pi) => s + scale(grid[di]?.[pi] ?? 0, di, pi), 0)
    const sumShort = (grid: number[][], di: number, idxs: number[]) =>
      idxs.reduce((s, pi) => s + scale(grid[di]?.[pi] ?? 0, di, pi), 0)

    const makePair = (longGrid: number[][], shortGrid: number[][]): { series: SeriesCfg[]; net: number[] } => {
      const onlyCat = cat !== "全部" && sector === "全部" && subSector === "全部" && prod === "全部"
      const allOpen = cat === "全部" && sector === "全部" && subSector === "全部" && prod === "全部"
      if (allOpen || onlyCat) {
        const cats = cat === "全部" ? CAT_SERIES : CAT_SERIES.filter((c) => c.cat === cat)
        const byCat = cats.map((c) => {
          const idxs = products.map((p, i) => (p.cat === c.cat && selectedIdx.includes(i) ? i : -1)).filter((i) => i >= 0)
          const long = dates.map((_, di) => sumLong(longGrid, di, idxs))
          const short = dates.map((_, di) => -sumShort(shortGrid, di, idxs))
          return { c, long, short }
        })
        const series: SeriesCfg[] = byCat.flatMap(({ c, long, short }) => [
          { name: c.longName, stack: "long" as const, color: c.longColor, data: long },
          { name: c.shortName, stack: "short" as const, color: c.shortColor, data: short },
        ])
        const net = dates.map((_, di) => byCat.reduce((s, x) => s + x.long[di] + x.short[di], 0))
        return { series, net }
      }
      const long = dates.map((_, di) => sumLong(longGrid, di, selectedIdx))
      const short = dates.map((_, di) => -sumShort(shortGrid, di, selectedIdx))
      return {
        series: [
          { name: "多", stack: "long", color: "#38bdf8", data: long },
          { name: "空", stack: "short", color: "#fb923c", data: short },
        ],
        net: dates.map((_, di) => long[di] + short[di]),
      }
    }

    const q = makePair(holdingTs.quantLong, holdingTs.quantShort)
    const s = makePair(holdingTs.subjLong, holdingTs.subjShort)
    return { quant: q.series, subj: s.series, qNet: q.net, sNet: s.net }
  }, [holdingTs, dates, products, selectedIdx, metric, cat, sector, subSector, prod])

  const qDecomp = useMemo(
    () => (holdingTs && selectedIdx.length ? sleeveDecomp(holdingTs, selectedIdx, "quant") : null),
    [holdingTs, selectedIdx],
  )
  const sDecomp = useMemo(
    () => (holdingTs && selectedIdx.length ? sleeveDecomp(holdingTs, selectedIdx, "subj") : null),
    [holdingTs, selectedIdx],
  )
  const waterfallOption = useMemo(
    () => (qDecomp && sDecomp ? buildWaterfallOption(qDecomp, sDecomp) : {}),
    [qDecomp, sDecomp],
  )
  const focusFlow: FlowView | null = useMemo(() => {
    if (!flows || !focus) return null
    const row = lookupFlow(flows, focus.level, focus.key)
    if (!row) return null
    const lastSec = (sectorTs ?? []).filter((x) => x.sector === focus.key).at(-1)
    const lastProd = (productTs ?? []).filter((x) => x.product === focus.key).at(-1)
    const q = focus.level === "sector" ? (lastSec?.quantNetPct ?? 0) : (lastProd?.quantNetPct ?? 0)
    const s = focus.level === "sector" ? (lastSec?.subjNetPct ?? 0) : (lastProd?.subjNetPct ?? 0)
    return classifyRowFlow(q, s, row)
  }, [flows, focus, sectorTs, productTs])

  const qOption = useMemo(
    () => buildOption(dates, sleeveSeries.quant, sleeveSeries.qNet, metric),
    [dates, sleeveSeries, metric],
  )
  const sOption = useMemo(
    () => buildOption(dates, sleeveSeries.subj, sleeveSeries.sNet, metric),
    [dates, sleeveSeries, metric],
  )

  const qNetMvByDate = useMemo(() => {
    const map = new Map<string, number>()
    if (!holdingTs || !dates.length) return map
    for (let di = 0; di < dates.length; di++) {
      let net = 0
      for (const pi of selectedIdx) {
        net += (holdingTs.quantLong[di]?.[pi] ?? 0) - (holdingTs.quantShort[di]?.[pi] ?? 0)
      }
      map.set(dates[di], net)
    }
    return map
  }, [holdingTs, dates, selectedIdx])

  const sNetMvByDate = useMemo(() => {
    const map = new Map<string, number>()
    if (!holdingTs || !dates.length) return map
    for (let di = 0; di < dates.length; di++) {
      let net = 0
      for (const pi of selectedIdx) {
        net += (holdingTs.subjLong[di]?.[pi] ?? 0) - (holdingTs.subjShort[di]?.[pi] ?? 0)
      }
      map.set(dates[di], net)
    }
    return map
  }, [holdingTs, dates, selectedIdx])

  const candleLabel = prod !== "全部"
    ? (products.find((p) => p.code === prod)?.name ?? prod)
    : subSector !== "全部"
      ? subSector
      : sector !== "全部"
        ? sector
        : ""

  const signalRows = useMemo(
    () => buildFocusSignalRows(products, sector, subSector, prod, sectorTs ?? [], productTs ?? []),
    [products, sector, subSector, prod, sectorTs, productTs],
  )

  const candleOption = useMemo(
    () => buildSleeveCandleOption(candles, qNetMvByDate, candleLabel || "价格", "量化", "#2563eb", signalRows),
    [candles, qNetMvByDate, candleLabel, signalRows],
  )
  const subjCandleOption = useMemo(
    () => buildSleeveCandleOption(candles, sNetMvByDate, candleLabel || "价格", "主观", "#d97706", signalRows),
    [candles, sNetMvByDate, candleLabel, signalRows],
  )
  const candleChartH = 320 + signalStripExtraHeight(signalRows.length)

  const unit = metric === "risk" ? "风险敞口 σ×市值" : "持仓市值"
  const filterKey = `${metric}-${cat}-${sector}-${subSector}-${prod}`

  const quantHoldingCard = (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">量化 · 多空持仓</CardTitle>
          <HelpHoldingBar metric={metric} sleeve="量化" />
        </div>
        {qDecomp && (
          <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
            {deltaLine("量化", qDecomp, sleeveSeries.qNet[sleeveSeries.qNet.length - 1] ?? 0, metric)}
          </p>
        )}
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {!holdingTs || !dates.length ? (
          <p className="text-sm text-muted-foreground px-4 py-10 text-center">暂无持仓数据</p>
        ) : (
          <ReactECharts key={`q-${filterKey}`} option={qOption} style={{ height: 360 }} notMerge />
        )}
      </CardContent>
    </Card>
  )
  const subjHoldingCard = (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">主观 · 多空持仓</CardTitle>
          <HelpHoldingBar metric={metric} sleeve="主观" />
        </div>
        {sDecomp && (
          <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
            {deltaLine("主观", sDecomp, sleeveSeries.sNet[sleeveSeries.sNet.length - 1] ?? 0, metric)}
          </p>
        )}
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {!holdingTs || !dates.length ? (
          <p className="text-sm text-muted-foreground px-4 py-10 text-center">暂无持仓数据</p>
        ) : (
          <ReactECharts key={`s-${filterKey}`} option={sOption} style={{ height: 360 }} notMerge />
        )}
      </CardContent>
    </Card>
  )
  const quantCandleCard = (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-medium">
              量化 · {candleLabel ? `${candleLabel} K线与累计盈亏` : "K线与累计盈亏"}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              昨日净市值 × 今日涨跌 = 当日盈亏。板块/细分为等权合成指数。下方色块为该筛选的 MOM 决策信号，与 K 线日期对齐；补风格只画在空仓一侧。
            </p>
            {signalRows.length > 0 && <div className="mt-1"><SignalLegend /></div>}
          </div>
          <HelpCandle sleeve="量化" />
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {!candleKey ? (
          <p className="text-sm text-muted-foreground px-4 py-10 text-center">请选择板块或品种以查看K线与量化累计盈亏</p>
        ) : candleLoading && !candles.length ? (
          <p className="text-sm text-muted-foreground px-4 py-10 text-center">加载K线…</p>
        ) : !candles.length ? (
          <p className="text-sm text-muted-foreground px-4 py-10 text-center">暂无K线数据</p>
        ) : (
          <ReactECharts key={`qc-${candleKey}`} option={candleOption} style={{ height: candleChartH }} notMerge />
        )}
      </CardContent>
    </Card>
  )
  const subjCandleCard = (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-medium">
              主观 · {candleLabel ? `${candleLabel} K线与累计盈亏` : "K线与累计盈亏"}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              昨日净市值 × 今日涨跌 = 当日盈亏。板块/细分为等权合成指数。下方色块为该筛选的 MOM 决策信号，与 K 线日期对齐；补风格只画在空仓一侧。
            </p>
            {signalRows.length > 0 && <div className="mt-1"><SignalLegend /></div>}
          </div>
          <HelpCandle sleeve="主观" />
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        {!candleKey ? (
          <p className="text-sm text-muted-foreground px-4 py-10 text-center">请选择板块或品种以查看K线与主观累计盈亏</p>
        ) : candleLoading && !candles.length ? (
          <p className="text-sm text-muted-foreground px-4 py-10 text-center">加载K线…</p>
        ) : !candles.length ? (
          <p className="text-sm text-muted-foreground px-4 py-10 text-center">暂无K线数据</p>
        ) : (
          <ReactECharts key={`sc-${candleKey}`} option={subjCandleOption} style={{ height: candleChartH }} notMerge />
        )}
      </CardContent>
    </Card>
  )

  return (
    <div id="section-holding-ts" className="space-y-2 scroll-mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">多空持仓时序</span>
        <span className="text-xs text-muted-foreground">
          {unit} · {swapped ? "左多空持仓 右K线盈亏" : "左量化 右主观"} · 与风控页同一套多空柱 + 净持仓线
        </span>
        <div className="flex flex-wrap items-center gap-2 ml-auto text-xs">
          <select
            className="border rounded px-2 py-0.5 bg-background"
            value={cat}
            onChange={(e) => { setCat(e.target.value); setSector("全部"); setSubSector("全部"); setProd("全部") }}
          >
            <option value="全部">全部大类</option>
            <option value="商品">商品</option>
            <option value="股指">股指</option>
            <option value="国债">国债</option>
          </select>
          <select
            className="border rounded px-2 py-0.5 bg-background"
            value={sector}
            onChange={(e) => { setSector(e.target.value); setSubSector("全部"); setProd("全部") }}
          >
            <option value="全部">全部板块</option>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            className="border rounded px-2 py-0.5 bg-background"
            value={subSector}
            onChange={(e) => { setSubSector(e.target.value); setProd("全部") }}
          >
            <option value="全部">全部细分</option>
            {subSectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            className="border rounded px-2 py-0.5 bg-background"
            value={prod}
            onChange={(e) => setProd(e.target.value)}
          >
            <option value="全部">全部品种</option>
            {prodOptions.map((p) => <option key={p.code} value={p.code}>{p.code} {p.name}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setSwapped((v) => !v)}
            className={`inline-flex items-center gap-1 border rounded px-2 py-0.5 ${
              swapped
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
            title="互换「主观 · 多空持仓」与「量化 · K线」位置"
          >
            <ArrowLeftRight className="h-3 w-3" />
            {swapped ? "恢复布局" : "互换位置"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {quantHoldingCard}
        {swapped ? quantCandleCard : subjHoldingCard}
        {swapped ? subjHoldingCard : quantCandleCard}
        {subjCandleCard}
      </div>
      {qDecomp && sDecomp && (
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <CardTitle className="text-sm font-medium">边际拆解 · 昨净仓 → 价格 → 主动调仓 → 今净仓</CardTitle>
                  <HelpWaterfall />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  市值口径 · {qDecomp.prevDate} → {qDecomp.date}
                  {focusFlow && focusFlow.tag !== "变化很小" ? ` · ${focusFlow.tag}${focusFlow.cutPnl ? ` · ${focusFlow.cutPnl}` : ""}` : ""}
                </p>
                {focusFlow && focusFlow.quantBreadth.total > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    量化 {focusFlow.quantBreadth.cut}/{focusFlow.quantBreadth.total} 户减多头
                    {focusFlow.quantCells.length > 0 ? `（${focusFlow.quantCells.filter((c) => c.trade < -5e5).map((c) => c.account).join("、") || "—"}）` : ""}
                    {focusFlow.subjBreadth.total > 0
                      ? ` · 主观 ${focusFlow.subjBreadth.add}/${focusFlow.subjBreadth.total} 户加多头`
                      : ""}
                  </p>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ReactECharts option={waterfallOption} style={{ height: 260, width: "100%" }} notMerge />
            <p className="text-[11px] text-muted-foreground px-1 pb-1">
              量化主动 {fmtFlowYuan(qDecomp.trade)} / 价格 {fmtFlowYuan(qDecomp.price)}
              <span className="mx-2">·</span>
              主观主动 {fmtFlowYuan(sDecomp.trade)} / 价格 {fmtFlowYuan(sDecomp.price)}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
