"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// ── Types ─────────────────────────────────────────────────────────────────────

interface BenchmarkRow {
  date: string; open: number; high: number; low: number; close: number; volume: number
}
interface DailyPnlRow { date: string; pnl: number; cumPnl: number }
interface TradeMarker {
  date: string; contract: string; direction: string; action: string
  price: number | null; lots: number | null
}
interface ApiData {
  ok: boolean
  method?: PnlMethod
  bench?: BenchType
  benchmark: BenchmarkRow[]
  dailyPnl: DailyPnlRow[]
  trades: TradeMarker[]
  positionHistory: { date: string; totalLots: number }[]
  error?: string
}

type PnlMethod = "continuous" | "mom"
type BenchType = "nh" | "dominant"

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoToday() { return new Date().toISOString().slice(0, 10) }
function isoMonthOffset(m: number) {
  const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10)
}
function isoYearOffset(y: number) {
  const d = new Date(); d.setFullYear(d.getFullYear() + y); return d.toISOString().slice(0, 10)
}

const QUICK_RANGES = [
  { label: "近三月",  from: () => isoMonthOffset(-3), to: () => isoToday() },
  { label: "近六月",  from: () => isoMonthOffset(-6), to: () => isoToday() },
  { label: "近一年",  from: () => isoYearOffset(-1),  to: () => isoToday() },
  { label: "全部",    from: () => "2025-01-01",        to: () => isoToday() },
]

function calcMA(data: (number | null)[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null
    const slice = data.slice(i - period + 1, i + 1)
    if (slice.some(v => v === null)) return null
    return (slice as number[]).reduce((s, v) => s + v, 0) / period
  })
}

function fmtYuan(v: number) {
  if (Math.abs(v) >= 1e6) return (v / 1e4).toFixed(1) + "万"
  if (Math.abs(v) >= 1e3) return (v / 1e4).toFixed(2) + "万"
  return v.toFixed(0)
}

// ── Product info (label shown in dropdown + series name) ──────────────────────
const PRODUCT_LABEL: Record<string, string> = {
  // Grains
  C: "玉米", CS: "玉米淀粉", WH: "强麦", PM: "普麦",
  RR: "粳米", RI: "早籼稻", JR: "粳稻", LR: "晚籼稻",
  // Oilseeds
  A: "黄大豆1号", B: "黄大豆2号", M: "豆粕", Y: "豆油",
  RM: "菜籽粕", OI: "菜籽油", RS: "油菜籽", PK: "花生", P: "棕榈油",
  // Soft
  SR: "白糖", CF: "棉花", CY: "棉纱", AP: "苹果", CJ: "红枣", LH: "生猪", JD: "鸡蛋",
  // Forestry / paper
  LG: "原木", SP: "纸浆", OP: "双胶纸", BB: "胶合板", FB: "纤维板",
  // Precious metals
  AU: "黄金", AG: "白银", PT: "铂", PD: "钯",
  // Base metals
  CU: "沪铜", BC: "国际铜", AL: "沪铝", AO: "氧化铝", AD: "铝合金",
  ZN: "沪锌", PB: "沪铅", NI: "沪镍", SN: "沪锡",
  LC: "碳酸锂", PS: "多晶硅", SI: "工业硅",
  // Ferrous
  I: "铁矿石", SF: "硅铁", SM: "锰硅", RB: "螺纹钢", HC: "热卷", SS: "不锈钢", WR: "线材",
  // Coal
  JM: "焦煤", J: "焦炭", ZC: "动力煤",
  // Building materials
  FG: "玻璃",
  // Energy
  SC: "原油", FU: "燃料油", LU: "低硫燃料油", PG: "液化石油气", BU: "沥青", EC: "航运",
  // Petrochemicals
  TA: "PTA", EG: "乙二醇", PF: "短纤", PR: "瓶片", PL: "丙烯",
  PP: "聚丙烯", L: "塑料", BZ: "纯苯", PX: "对二甲苯", EB: "苯乙烯",
  // Rubber
  RU: "天然橡胶", BR: "丁二烯橡胶", NR: "20号胶",
  // Chemicals
  SA: "纯碱", SH: "烧碱", V: "PVC", UR: "尿素", MA: "甲醇",
}
function productLabel(code: string) { return PRODUCT_LABEL[code] ? `${PRODUCT_LABEL[code]}(${code})` : code }
function indexLabel(code: string) { return PRODUCT_LABEL[code] ? `南华${PRODUCT_LABEL[code]}指数` : `${code}指数` }

// ── Props ────────────────────────────────────────────────────────────────────

interface MetaData {
  ok: boolean
  accounts: string[]
  products: string[]
}

interface Props {
  account?: string
  product?: string
  method?: PnlMethod
  bench?: BenchType
  chartHeight?: number
  // Starting capital used to convert absolute P&L (yuan) to a return ratio.
  // Defaults to 1,000,000 yuan (100万). Adjust to match actual account equity.
  initialCapital?: number
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AuTradingChart({ account: defaultAccount = "rx000", product: defaultProduct = "AU", method: defaultMethod = "continuous", bench: defaultBench = "nh", chartHeight = 540, initialCapital = 1_000_000 }: Props) {
  const [from, setFrom] = useState(() => "2025-01-01")
  const [to,   setTo]   = useState(() => isoToday())
  const [account, setAccount] = useState(defaultAccount)
  const [product, setProduct] = useState(defaultProduct)
  const [method, setMethod] = useState<PnlMethod>(defaultMethod)
  const [bench, setBench] = useState<BenchType>(defaultBench)
  const [data,    setData]    = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [availableAccounts, setAvailableAccounts] = useState<string[]>([])
  const [availableProducts, setAvailableProducts] = useState<string[]>([])

  // Fetch available accounts and products from meta endpoint
  useEffect(() => {
    fetch("/ma/api/mom-analysis/au-trading/meta")
      .then(r => r.json())
      .then((m: MetaData) => {
        if (m.ok) {
          if (m.accounts.length) setAvailableAccounts(m.accounts)
          if (m.products.length) setAvailableProducts(m.products)
        }
      })
      .catch(() => { /* non-critical, keep defaults */ })
  }, [])

  const load = useCallback(async (f: string, t: string, acc: string, prod: string, pnlMethod: PnlMethod, benchType: BenchType) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: f, to: t, account: acc, product: prod, method: pnlMethod, bench: benchType })
      const res  = await fetch(`/ma/api/mom-analysis/au-trading?${params}`)
      const json: ApiData = await res.json()
      if (!json.ok) throw new Error(json.error || "请求失败")
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(from, to, account, product, method, bench) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build ECharts option (useMemo ensures a new object ref when data changes)

  const option = useMemo<object>(() => {
    const bmLabel = bench === "dominant" ? `${PRODUCT_LABEL[product] ?? product}主连合约` : indexLabel(product)
    if (!data) return {}

    const bm      = data.benchmark
    const bmDates = bm.map(b => b.date)
    const bmIdxMap = new Map(bmDates.map((d, i) => [d, i] as [string, number]))

    // Best-effort index lookup: exact match, else nearest previous trading day
    const getDateIdx = (date: string): number => {
      if (bmIdxMap.has(date)) return bmIdxMap.get(date)!
      let best = -1
      for (const [d, idx] of bmIdxMap) {
        if (d <= date && idx > best) best = idx
      }
      return best
    }

    const ohlc   = bm.map(b => [b.open, b.close, b.low, b.high])
    const closes = bm.map(b => b.close)
    const ma5    = calcMA(closes, 5)
    const ma20   = calcMA(closes, 20)

    // ── Align daily P&L to bmDates ──────────────────────────────────────────
    const pnlByDate = new Map(data.dailyPnl.map(r => [r.date, r]))
    let lastCum = 0
    const alignedDailyPnl = bmDates.map(d => {
      const r = pnlByDate.get(d)
      return r ? r.pnl : null
    })
    const alignedCumPnl = bmDates.map(d => {
      const r = pnlByDate.get(d)
      if (r) { lastCum = r.cumPnl; return r.cumPnl }
      return lastCum  // forward-fill holidays
    })

    // ── Indexed returns: both start at 1.0 at first trading day in window ────
    const firstClose  = bm[0]?.close || 1
    const bmIndexed   = bm.map(b => +(b.close / firstClose).toFixed(6))

    const firstPnlDate = data.dailyPnl[0]?.date ?? ""
    const pnlAtStart   = data.dailyPnl[0]?.cumPnl ?? 0
    const equityIndexed = alignedCumPnl.map((v, i) =>
      bmDates[i] < firstPnlDate
        ? null
        : +(1 + (v - pnlAtStart) / initialCapital).toFixed(6)
    )

    // ── Align position history to bmDates (forward-fill) ─────────────────────
    const posMap = new Map((data.positionHistory ?? []).map(r => [r.date, r.totalLots]))
    let lastLots = 0
    const alignedLots = bmDates.map(d => {
      if (posMap.has(d)) { lastLots = posMap.get(d)!; return lastLots }
      return lastLots // forward-fill non-trading days
    })

    // ── Trade markers (scatter on benchmark chart) ───────────────────────────
    const openLong:  [number, number][] = []
    const openShort: [number, number][] = []
    const closePos:  [number, number][] = []

    for (const t of data.trades) {
      const idx = getDateIdx(t.date)
      if (idx < 0) continue
      const y = bm[idx]?.close
      if (y === undefined) continue
      const isOpen = !t.action || t.action.includes("开")
      if (isOpen && t.direction === "买")        openLong.push([idx, y])
      else if (isOpen && t.direction === "卖")   openShort.push([idx, y])
      else                                       closePos.push([idx, y])
    }

    // Build per-date-index trade detail lookup for tooltip
    type TradeDetail = { name: string; direction: string; action: string; price: number | null; lots: number | null }
    const tradesByIdx = new Map<number, TradeDetail[]>()
    for (const t of data.trades) {
      const idx = getDateIdx(t.date)
      if (idx < 0) continue
      const isOpen2 = !t.action || t.action.includes("开")
      const name = isOpen2 ? (t.direction === "买" ? "买开" : "卖开") : (t.direction === "买" ? "买平" : "卖平")
      if (!tradesByIdx.has(idx)) tradesByIdx.set(idx, [])
      tradesByIdx.get(idx)!.push({ name, direction: t.direction, action: t.action, price: t.price, lots: t.lots })
    }

    return {
      backgroundColor: "transparent",
      animation: false,
      legend: {
        top: 4, right: 8,
        textStyle: { fontSize: 10 },
        data: ["MA5", "MA20", "权益累计涨跌%", `${bmLabel}涨跌%`],
        selected: { "MA5": false, "MA20": false },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", link: [{ xAxisIndex: "all" }] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter(params: any[]) {
          if (!params?.length) return ""
          const dataIdx  = params[0].dataIndex as number
          const axisIdx  = params[0].axisIndex  as number
          const date     = bmDates[dataIdx] ?? ""
          const lines: string[] = [`<b>${date}</b>`]

          if (axisIdx === 0) {
            // ── Panel 0: OHLC + trade order details ────────────────────────
            for (const p of params) {
              if (p.seriesType === "candlestick") {
                const [o, c, l, h] = p.value as number[]
                // Use a filled square (▪) for OHLC — keeps triangles reserved for orders
                const sq = c >= o ? `<span style="color:#ef4444">▪</span>` : `<span style="color:#22c55e">▪</span>`
                lines.push(`${sq} 开${o?.toFixed(2)} 收<b>${c?.toFixed(2)}</b> 高${h?.toFixed(2)} 低${l?.toFixed(2)}`)
              }
            }
            const trades = tradesByIdx.get(dataIdx)
            if (trades?.length) {
              for (const t of trades) {
                const priceStr = t.price != null ? ` @${t.price.toFixed(2)}` : ""
                const lotsStr  = t.lots  != null ? ` ${Math.round(t.lots)}手` : ""
                // Match chart symbols: 买开=▲red, 卖开=▽green, 买平/卖平=◆grey
                let icon: string
                if      (t.name === "买开") icon = `<span style="color:#ef4444">▲</span>`
                else if (t.name === "卖开") icon = `<span style="color:#22c55e">▽</span>`
                else                        icon = `<span style="color:#94a3b8">◆</span>`
                lines.push(`${icon} <span style="color:${t.name === "买开" ? "#ef4444" : t.name === "卖开" ? "#22c55e" : "#94a3b8"}">${t.name}${priceStr}${lotsStr}</span>`)
              }
            }

          } else if (axisIdx === 1) {
            // ── Panel 1: cumulative returns + cumulative raw P&L ───────────
            for (const p of params) {
              const v = typeof p.value === "number" ? p.value : (Array.isArray(p.value) ? (p.value as number[])[1] : null)
              if (v === null || v === undefined) continue
              const pct = ((v - 1) * 100).toFixed(2) + "%"
              if (p.seriesName === "权益累计涨跌%") {
                lines.push(`${p.marker}权益累计涨跌%: ${pct}`)
              } else if (p.seriesName === `${bmLabel}涨跌%`) {
                lines.push(`${p.marker}${bmLabel}涨跌%: ${pct}`)
              }
            }
            const relCum = alignedCumPnl[dataIdx] - pnlAtStart
            const cumCol = relCum >= 0 ? "#ef4444" : "#22c55e"
            lines.push(`<span style="color:${cumCol}">权益累计盈亏: ${fmtYuan(relCum)}元</span>`)

          } else if (axisIdx === 2) {
            // ── Panel 2: daily P&L only ────────────────────────────────────
            for (const p of params) {
              if (p.seriesName === "当日盈亏") {
                const v = typeof p.value === "number" ? p.value : (Array.isArray(p.value) ? (p.value as number[])[1] : null)
                if (v != null) {
                  const col = v >= 0 ? "#ef4444" : "#22c55e"
                  lines.push(`<span style="color:${col}">${p.marker}当日盈亏: ${fmtYuan(v)}元</span>`)
                }
              }
            }
          } else if (axisIdx === 3) {
            // ── Panel 3: net position ──────────────────────────────────────
            const lots = alignedLots[dataIdx] ?? 0
            const col  = lots > 0 ? "#ef4444" : lots < 0 ? "#22c55e" : "#94a3b8"
            const dir  = lots > 0 ? "净多" : lots < 0 ? "净空" : "空仓"
            lines.push(`<span style="color:#a78bfa">●</span> <span style="color:${col}">${dir} ${Math.abs(lots)}手</span>`)
          }

          return lines.join("<br/>")
        },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        // All panels share identical left/right so x-axis ticks align perfectly
        // Panel 0: benchmark candle  (top 6% → 43%)
        { left: 55, right: 45, top: "6%",  height: "37%" },
        // Panel 1: indexed returns   (top 47% → 64%)
        { left: 55, right: 45, top: "47%", height: "16%" },
        // Panel 2: daily P&L bars   (top 67% → 79%)
        { left: 55, right: 45, top: "67%", height: "12%" },
        // Panel 3: net position (lots)  (top 82% → 92%)
        { left: 55, right: 45, top: "82%", height: "10%" },
      ],
      xAxis: [
        // Grid 0 — benchmark candle
        {
          gridIndex: 0, type: "category", data: bmDates,
          axisLabel: { show: false },
          axisLine: { onZero: false },
          boundaryGap: true,
          splitLine: { show: false },
        },
        // Grid 1 — indexed return lines (same dates)
        {
          gridIndex: 1, type: "category", data: bmDates,
          axisLabel: { show: false },
          axisLine: { onZero: false },
          boundaryGap: true,
          splitLine: { show: false },
        },
        // Grid 2 — daily P&L bars (same dates)
        {
          gridIndex: 2, type: "category", data: bmDates,
          axisLabel: { show: false },
          boundaryGap: true,
          splitLine: { show: false },
        },
        // Grid 3 — net position
        {
          gridIndex: 3, type: "category", data: bmDates,
          axisLabel: { fontSize: 9, rotate: 30 },
          boundaryGap: true,
          splitLine: { show: false },
        },
      ],
      yAxis: [
        // yAxisIndex 0 — Grid 0: benchmark price
        { gridIndex: 0, scale: true, splitNumber: 4, axisLabel: { fontSize: 9 }, splitLine: { lineStyle: { opacity: 0.15 } } },
        // yAxisIndex 1 — Grid 1: indexed return (both lines share this axis)
        {
          gridIndex: 1, scale: true, splitNumber: 3,
          axisLabel: {
            fontSize: 8,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter: (v: any) => `${((v - 1) * 100).toFixed(0)}%`,
          },
          splitLine: { lineStyle: { opacity: 0.15 } },
        },
        // yAxisIndex 2 — Grid 2: daily P&L (yuan)
        { gridIndex: 2, scale: true, splitNumber: 2, axisLabel: { fontSize: 8 }, splitLine: { show: false } },
        // yAxisIndex 3 — Grid 3: net position (lots)
        {
          gridIndex: 3, splitNumber: 2,
          axisLabel: { fontSize: 8,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter: (v: any) => `${v}手`
          },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1, 2, 3], start: 0, end: 100 },
        { type: "slider",  xAxisIndex: [0, 1, 2, 3], bottom: 4, height: 20 },
      ],
      series: [
        // ── Panel 0: benchmark candlestick ─────────────────────────────────
        {
          name: bmLabel,
          type: "candlestick",
          xAxisIndex: 0, yAxisIndex: 0,
          data: ohlc,
          itemStyle: {
            color: "#ef4444", color0: "#22c55e",
            borderColor: "#ef4444", borderColor0: "#22c55e",
          },
        },
        {
          name: "MA5",
          type: "line", xAxisIndex: 0, yAxisIndex: 0,
          data: ma5, smooth: false, symbol: "none", connectNulls: true,
          lineStyle: { width: 1.5, color: "#f59e0b" },
        },
        {
          name: "MA20",
          type: "line", xAxisIndex: 0, yAxisIndex: 0,
          data: ma20, smooth: false, symbol: "none", connectNulls: true,
          lineStyle: { width: 1.5, color: "#8b5cf6" },
        },
        // Trade open markers — 买开 (long entry): red upward triangle
        {
          name: "买开",
          type: "scatter", xAxisIndex: 0, yAxisIndex: 0,
          data: openLong,
          symbol: "triangle", symbolSize: 10,
          itemStyle: { color: "#ef4444" },
          tooltip: { show: false },
        },
        // Trade open markers — 卖开 (short entry): green downward triangle
        {
          name: "卖开",
          type: "scatter", xAxisIndex: 0, yAxisIndex: 0,
          data: openShort,
          symbol: "triangle", symbolRotate: 180, symbolSize: 10,
          itemStyle: { color: "#22c55e" },
          tooltip: { show: false },
        },
        // Close markers — 平仓 (both long/short exit): grey diamond
        {
          name: "平仓",
          type: "scatter", xAxisIndex: 0, yAxisIndex: 0,
          data: closePos,
          symbol: "diamond", symbolSize: 8,
          itemStyle: { color: "#94a3b8", borderColor: "#64748b", borderWidth: 1 },
          tooltip: { show: false },
        },

        // ── Panel 1: both lines rebased to 1.0 at window start ──────────────
        {
          name: "权益累计涨跌%",
          type: "line", xAxisIndex: 1, yAxisIndex: 1,
          data: equityIndexed, smooth: false, symbol: "none", connectNulls: false,
          color: "#3b82f6",
          lineStyle: { width: 2, color: "#3b82f6" },
          areaStyle: { opacity: 0.08, color: "#3b82f6" },
        },
        {
          name: `${bmLabel}涨跌%`,
          type: "line", xAxisIndex: 1, yAxisIndex: 1,
          data: bmIndexed, smooth: false, symbol: "none",
          color: "#f59e0b",
          lineStyle: { width: 1.5, color: "#f59e0b", type: "dashed" },
        },

        // ── Panel 2: daily P&L bars ─────────────────────────────────────────
        {
          name: "当日盈亏",
          type: "bar", xAxisIndex: 2, yAxisIndex: 2,
          data: alignedDailyPnl.map(v =>
            v === null ? null : {
              value: v,
              itemStyle: { color: v >= 0 ? "#ef4444" : "#22c55e" },
            }
          ),
          barMaxWidth: 6,
        },

        // ── Panel 3: net holding position (lots) ────────────────────────────
        {
          name: "持仓手数",
          type: "line",
          step: "end",
          xAxisIndex: 3, yAxisIndex: 3,
          data: alignedLots,
          symbol: "none",
          color: "#a78bfa",
          lineStyle: { width: 1.5, color: "#a78bfa" },
          areaStyle: {
            opacity: 0.25,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            color: (params: any) => {
              const v = typeof params === "number" ? params : 0
              return v >= 0 ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"
            },
          },
          markLine: {
            silent: true,
            symbol: "none",
            data: [{ yAxis: 0 }],
            lineStyle: { color: "#64748b", width: 1, type: "solid" },
            label: { show: false },
          },
        },
      ],
    }
  }, [data, initialCapital, product, bench])

  // Benchmark panel title depends on which benchmark is selected
  const benchLabel = bench === "dominant"
    ? `${PRODUCT_LABEL[product] ?? product}主连合约`
    : indexLabel(product)

  // ── Render ──────────────────────────────────────────────────

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex flex-col gap-1.5">
          {/* Row 1: title + account/product/date controls */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium">
              {benchLabel} · {productLabel(product)}交易回顾（{account.toUpperCase()}）
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Account selector */}
              <select
                value={account}
                onChange={e => { const a = e.target.value; setAccount(a); load(from, to, a, product, method, bench) }}
                className="rounded border border-input bg-background px-2 py-0.5 text-xs"
              >
                {(availableAccounts.length ? availableAccounts : [account]).map(a => (
                  <option key={a} value={a}>{a.toUpperCase()}</option>
                ))}
              </select>
              {/* Product selector */}
              <select
                value={product}
                onChange={e => { const p = e.target.value; setProduct(p); load(from, to, account, p, method, bench) }}
                className="rounded border border-input bg-background px-2 py-0.5 text-xs"
              >
                {(availableProducts.length ? availableProducts : [product]).map(p => (
                  <option key={p} value={p}>{productLabel(p)}</option>
                ))}
              </select>
              {QUICK_RANGES.map(r => (
                <button
                  key={r.label}
                  onClick={() => { const f = r.from(); const t = r.to(); setFrom(f); setTo(t); load(f, t, account, product, method, bench) }}
                  className="rounded px-2 py-0.5 text-xs bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
                >
                  {r.label}
                </button>
              ))}
              <input
                type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="rounded border border-input bg-background px-2 py-0.5 text-xs"
              />
              <input
                type="date" value={to} onChange={e => setTo(e.target.value)}
                className="rounded border border-input bg-background px-2 py-0.5 text-xs"
              />
              <button
                onClick={() => load(from, to, account, product, method, bench)}
                className="rounded border border-input bg-background p-0.5 hover:bg-muted transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          {/* Row 2: free-text account + product inputs · benchmark + calculation method filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">账户:</span>
            <input
              type="text"
              defaultValue={account}
              placeholder="输入账户名，回车确认"
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const a = (e.currentTarget.value || "").trim()
                  if (a) { setAccount(a); load(from, to, a, product, method, bench) }
                }
              }}
              onBlur={e => {
                const a = e.currentTarget.value.trim()
                if (a && a !== account) { setAccount(a); load(from, to, a, product, method, bench) }
              }}
              className="rounded border border-input bg-background px-2 py-0.5 text-xs w-32"
            />
            <span className="text-xs text-muted-foreground ml-2">品种:</span>
            <input
              type="text"
              defaultValue={product}
              placeholder="输入品种代码，回车确认"
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const p = (e.currentTarget.value || "").trim().toUpperCase()
                  if (/^[A-Z]{1,4}$/.test(p)) { setProduct(p); load(from, to, account, p, method, bench) }
                }
              }}
              onBlur={e => {
                const p = e.currentTarget.value.trim().toUpperCase()
                if (/^[A-Z]{1,4}$/.test(p) && p !== product) { setProduct(p); load(from, to, account, p, method, bench) }
              }}
              className="rounded border border-input bg-background px-2 py-0.5 text-xs w-24 uppercase"
            />
            <span className="text-xs text-muted-foreground ml-2">基准:</span>
            <select
              value={bench}
              onChange={e => {
                const b = e.target.value as BenchType
                setBench(b)
                load(from, to, account, product, method, b)
              }}
              className="rounded border border-input bg-background px-2 py-0.5 text-xs"
            >
              <option value="nh">南华指数</option>
              <option value="dominant">主连合约</option>
            </select>
            <span className="text-xs text-muted-foreground ml-2">盈亏法:</span>
            <select
              value={method}
              onChange={e => {
                const nextMethod = e.target.value as PnlMethod
                setMethod(nextMethod)
                load(from, to, account, product, nextMethod, bench)
              }}
              className="rounded border border-input bg-background px-2 py-0.5 text-xs"
            >
              <option value="continuous">连续价格MTM</option>
              <option value="mom">MOM核算表</option>
            </select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 relative p-0 pb-1 min-h-0">
        {loading && !data && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
            <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="text-sm text-destructive text-center">{error}</p>
          </div>
        )}
        {!loading && !error && data?.benchmark.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
            <p className="text-sm text-muted-foreground">
              暂无基准行情数据（{product}）。如已有交易数据，盈亏图表仍将正常显示。
            </p>
          </div>
        )}
        {data && data.benchmark.length > 0 && (
          <ReactECharts
            option={option}
            style={{ height: chartHeight }}
            opts={{ renderer: "canvas" }}
            notMerge
          />
        )}
      </CardContent>
    </Card>
  )
}
