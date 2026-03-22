"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Maximize2, Minimize2, RefreshCw } from "lucide-react"
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
  { label: "近一月",  from: () => isoMonthOffset(-1), to: () => isoToday() },
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
function fmtPnl(v: number) {
  const abs = Math.abs(v)
  const sign = v >= 0 ? "+" : "-"
  if (abs >= 1e6) return sign + (abs / 1e4).toFixed(1) + "万"
  if (abs >= 1e3) return sign + (abs / 1e4).toFixed(2) + "万"
  return sign + abs.toFixed(0)
}
function fmtSignPct(v: number) {
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%"
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
  // Stock index futures
  IH: "上证50股指期货", IF: "沪深300股指期货", IC: "中证500股指期货", IM: "中证1000股指期货",
  // Treasury bond futures
  TS: "2年期国债期货", TF: "5年期国债期货", T: "10年期国债期货", TL: "30年期国债期货",
}
function productLabel(code: string) { return PRODUCT_LABEL[code] ? `${PRODUCT_LABEL[code]}(${code})` : code }
function indexLabel(code: string) { return PRODUCT_LABEL[code] ? `南华${PRODUCT_LABEL[code]}指数` : `${code}指数` }

const SECTOR_RULES: Record<string, Set<string>> = {
  "农产":   new Set(["C","CS","WH","PM","RR","RI","JR","LR","A","B","M","Y","RM","OI","RS","PK","P","SR","CF","CY","AP","CJ","LH","JD","LG","SP","OP"]),
  "贵金属": new Set(["AU","AG","PT","PD"]),
  "有色":   new Set(["CU","BC","AL","AO","AD","ZN","PB","NI","SN"]),
  "新能源": new Set(["LC","PS","SI"]),
  "黑色":   new Set(["I","SF","SM","RB","HC","SS","WR","JM","J","ZC","FG","BB","FB"]),
  "能源化工":new Set(["SC","FU","LU","PG","BU","TA","EG","PF","PR","PL","PP","L","BZ","PX","EB","RU","BR","NR","SA","SH","V","UR","MA"]),
  "航运":   new Set(["EC"]),
  "股指":   new Set(["IH","IF","IC","IM","MO"]),
  "国债":   new Set(["TS","TF","T","TL"]),
}

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
  from?: string        // controlled: if provided, overrides internal state on change
  to?: string          // controlled: if provided, overrides internal state on change
  chartHeight?: number
  // Starting capital used to convert absolute P&L (yuan) to a return ratio.
  // Defaults to 1,000,000 yuan (100万). Adjust to match actual account equity.
  initialCapital?: number
  onProductChange?: (product: string) => void
  onAccountChange?: (account: string) => void
}

// ── Component ────────────────────────────────────────────────────────────────

export default function AuTradingChart({ account: defaultAccount = "rx000", product: defaultProduct = "AU", method: defaultMethod = "mom", bench: defaultBench = "dominant", from: propFrom, to: propTo, chartHeight = 540, initialCapital = 1_000_000, onProductChange, onAccountChange }: Props) {
  const [from, setFrom] = useState(() => propFrom ?? isoMonthOffset(-6))
  const [to,   setTo]   = useState(() => propTo   ?? isoToday())
  const [account, setAccount] = useState(defaultAccount)
  const [product, setProduct] = useState(defaultProduct)
  const [method, setMethod] = useState<PnlMethod>(defaultMethod)
  const [bench, setBench] = useState<BenchType>(defaultBench)
  const [data,    setData]    = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [availableAccounts, setAvailableAccounts] = useState<string[]>([])
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const [sector, setSector] = useState<string>("全部")

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

  // React to externally-driven product changes (e.g. clicking a row in the stats table)
  useEffect(() => {
    if (defaultProduct && defaultProduct !== product) {
      setProduct(defaultProduct)
      onProductChange?.(defaultProduct)
      load(from, to, account, defaultProduct, method, bench)
    }
  }, [defaultProduct]) // eslint-disable-line react-hooks/exhaustive-deps

  const [isFullscreen, setIsFullscreen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  useEffect(() => {
    if (!isFullscreen) { setContentHeight(null); return }
    const el = contentRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setContentHeight(entries[0].contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [isFullscreen])

  // Sync when parent-controlled from/to props change
  useEffect(() => {
    if (propFrom && propTo && (propFrom !== from || propTo !== to)) {
      setFrom(propFrom)
      setTo(propTo)
      load(propFrom, propTo, account, product, method, bench)
    }
  }, [propFrom, propTo]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const bar = bm[idx]
      if (!bar) continue
      const isOpen = !t.action || t.action.includes("开")
      // Place marker outside the candle wick so it never hides price action:
      //   买开 → below the low (upward triangle pointing at price)
      //   卖开 → above the high (downward triangle pointing at price)
      //   平仓 → above the high (diamond above candle)
      const offset = (bar.high - bar.low) * 0.4 || bar.close * 0.008
      if (isOpen && t.direction === "买")        openLong.push([idx, bar.low  - offset])
      else if (isOpen && t.direction === "卖")   openShort.push([idx, bar.high + offset])
      else                                       closePos.push([idx, bar.high + offset])
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
                // Match chart symbols: 买开=▲red, 卖开=▽green, 平仓=◆amber
                let icon: string
                if      (t.name === "买开") icon = `<span style="color:#ef4444">▲</span>`
                else if (t.name === "卖开") icon = `<span style="color:#22c55e">▽</span>`
                else                        icon = `<span style="color:#f59e0b">◆</span>`
                lines.push(`${icon} <span style="color:${t.name === "买开" ? "#ef4444" : t.name === "卖开" ? "#22c55e" : "#f59e0b"}">${t.name}${priceStr}${lotsStr}</span>`)
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
          itemStyle: { color: "#ef4444", borderColor: "#fff", borderWidth: 1.5 },
          tooltip: { show: false },
        },
        // Trade open markers — 卖开 (short entry): green downward triangle
        {
          name: "卖开",
          type: "scatter", xAxisIndex: 0, yAxisIndex: 0,
          data: openShort,
          symbol: "triangle", symbolRotate: 180, symbolSize: 10,
          itemStyle: { color: "#22c55e", borderColor: "#fff", borderWidth: 1.5 },
          tooltip: { show: false },
        },
        // Close markers — 平仓 (both long/short exit): grey diamond
        {
          name: "平仓",
          type: "scatter", xAxisIndex: 0, yAxisIndex: 0,
          data: closePos,
          symbol: "diamond", symbolSize: 9,
          itemStyle: { color: "#f59e0b", borderColor: "#fff", borderWidth: 1.5 },
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

  const effectiveChartHeight = isFullscreen
    ? (contentHeight ?? (typeof window !== "undefined" ? window.innerHeight - 200 : chartHeight))
    : chartHeight

  // ── Statistics ─────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!data || data.dailyPnl.length === 0) return null
    const pnls    = data.dailyPnl.map(r => r.pnl)
    const cumPnls = data.dailyPnl.map(r => r.cumPnl)
    const n       = pnls.length

    const totalPnl = cumPnls[n - 1] ?? 0
    const winDays  = pnls.filter(p => p > 0).length
    const winRate  = n > 0 ? winDays / n : 0

    const mean    = pnls.reduce((s, v) => s + v, 0) / n
    const std     = Math.sqrt(pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
    const sharpe  = std > 0 ? (mean / std) * Math.sqrt(252) : (mean > 0 ? 99 : 0)

    // Max drawdown (yuan, then as % of initialCapital)
    let peak = -Infinity, peakEquity = initialCapital, maxDD = 0
    for (const cp of cumPnls) {
      const equity = initialCapital + cp
      if (equity > peakEquity) peakEquity = equity
      const dd = peakEquity - equity
      if (dd > maxDD) { maxDD = dd; peak = peakEquity }
    }
    const maxDDPct = peak > 0 ? (maxDD / peak) * 100 : 0

    // Annualized return (simple, calendar-day basis)
    const ms = new Date(data.dailyPnl[n - 1].date).getTime() - new Date(data.dailyPnl[0].date).getTime()
    const calDays = ms / 86_400_000 + 1
    const annReturn = calDays > 0 ? (totalPnl / initialCapital) * (365 / calDays) * 100 : 0

    // Close transaction count
    const closeTrades = data.trades.filter(t => t.action && !t.action.includes("开")).length

    // Profit factor (sum of winning days / sum of losing days magnitude)
    const winSum  = pnls.filter(v => v > 0).reduce((s, v) => s + v, 0)
    const lossSum = Math.abs(pnls.filter(v => v < 0).reduce((s, v) => s + v, 0))
    const profitFactor = lossSum > 0 ? winSum / lossSum : null

    return { totalPnl, tradingDays: n, winRate, sharpe, maxDDPct, annReturn, closeTrades, profitFactor }
  }, [data, initialCapital])

  return (
    <Card className={isFullscreen
      ? "fixed inset-0 z-50 flex flex-col bg-background overflow-hidden rounded-none"
      : "flex flex-col h-full"
    }>
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
                onChange={e => { const a = e.target.value; setAccount(a); onAccountChange?.(a); load(from, to, a, product, method, bench) }}
                className="rounded border border-input bg-background px-2 py-0.5 text-xs w-24"
              >
                {(availableAccounts.length ? availableAccounts : [account]).map(a => (
                  <option key={a} value={a}>{a.toUpperCase()}</option>
                ))}
              </select>
              {/* Product selector */}
              <select
                value={product}
                onChange={e => { const p = e.target.value; setProduct(p); onProductChange?.(p); load(from, to, account, p, method, bench) }}
                className="rounded border border-input bg-background px-2 py-0.5 text-xs w-[6rem] truncate"
              >
                {(() => {
                  const base = availableProducts.length ? availableProducts : [product]
                  const filtered = sector === "全部" ? base : base.filter(p => SECTOR_RULES[sector]?.has(p))
                  const list = filtered.length ? filtered : base
                  return list.map(p => <option key={p} value={p}>{productLabel(p)}</option>)
                })()}
              </select>
              {QUICK_RANGES.map(r => {
                const isActive = from === r.from() && to === r.to()
                return (
                  <button
                    key={r.label}
                    onClick={() => { const f = r.from(); const t = r.to(); setFrom(f); setTo(t); load(f, t, account, product, method, bench) }}
                    className={`rounded px-2 py-0.5 text-xs transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                )
              })}
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
              <button
                onClick={() => setIsFullscreen(v => !v)}
                title={isFullscreen ? "退出全屏 (Esc)" : "全屏"}
                className="rounded border border-input bg-background p-0.5 hover:bg-muted transition-colors"
              >
                {isFullscreen
                  ? <Minimize2 className="h-3.5 w-3.5" />
                  : <Maximize2 className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          {/* Row 2: free-text inputs + sector/bench/method filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              defaultValue={account}
              placeholder="账户名，回车确认"
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const a = (e.currentTarget.value || "").trim()
                  if (a) { setAccount(a); onAccountChange?.(a); load(from, to, a, product, method, bench) }
                }
              }}
              onBlur={e => {
                const a = e.currentTarget.value.trim()
                if (a && a !== account) { setAccount(a); onAccountChange?.(a); load(from, to, a, product, method, bench) }
              }}
              className="rounded border border-input bg-background px-2 py-0.5 text-xs w-24"
            />
            <input
              type="text"
              defaultValue={product}
              placeholder="品种代码"
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const p = (e.currentTarget.value || "").trim().toUpperCase()
                  if (/^[A-Z]{1,4}$/.test(p)) { setProduct(p); onProductChange?.(p); load(from, to, account, p, method, bench) }
                }
              }}
              onBlur={e => {
                const p = e.currentTarget.value.trim().toUpperCase()
                if (/^[A-Z]{1,4}$/.test(p) && p !== product) { setProduct(p); onProductChange?.(p); load(from, to, account, p, method, bench) }
              }}
              className="rounded border border-input bg-background px-2 py-0.5 text-xs w-[6rem] uppercase"
            />
            <span className="text-xs text-muted-foreground">板块:</span>
            <select
              value={sector}
              onChange={e => {
                const s = e.target.value
                setSector(s)
                if (s !== "全部" && SECTOR_RULES[s] && !SECTOR_RULES[s].has(product)) {
                  const base = availableProducts.length ? availableProducts : [product]
                  const first = base.find(p => SECTOR_RULES[s].has(p))
                  if (first) { setProduct(first); onProductChange?.(first); load(from, to, account, first, method, bench) }
                }
              }}
              className="rounded border border-input bg-background px-2 py-0.5 text-xs"
            >
              <option value="全部">全部</option>
              {Object.keys(SECTOR_RULES).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">基准:</span>
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
            <span className="text-xs text-muted-foreground">盈亏法:</span>
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

      <CardContent className="flex-1 p-0 pb-1 min-h-0 overflow-hidden">
        <div ref={contentRef} className="h-full w-full relative">
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
            style={{ height: effectiveChartHeight }}
            opts={{ renderer: "canvas" }}
            notMerge
          />
        )}
        </div>
      </CardContent>

      {/* ── Stats strip ──────────────────────────────────────────────────── */}
      {stats && (
        <div className="px-4 py-2.5 border-t border-border/60 grid grid-cols-4 gap-x-6 gap-y-2.5">
          {([
            { label: "\u603b\u76c8\u4e8f",    value: fmtPnl(stats.totalPnl),    color: stats.totalPnl >= 0 ? "text-red-500" : "text-green-500" },
            { label: "\u5e74\u5316\u6536\u76ca\u7387", value: fmtSignPct(stats.annReturn),  color: stats.annReturn >= 0 ? "text-red-500" : "text-green-500" },
            { label: "\u65e5\u80dc\u7387",    value: `${(stats.winRate * 100).toFixed(1)}%`, color: "" },
            { label: "\u590f\u666e\u6bd4\u7387",   value: stats.sharpe >= 99 ? "\u221e" : stats.sharpe.toFixed(2), color: stats.sharpe >= 1 ? "text-red-500" : stats.sharpe < 0 ? "text-green-500" : "" },
            { label: "\u6700\u5927\u56de\u64a4",   value: `-${stats.maxDDPct.toFixed(1)}%`, color: "text-green-500" },
            { label: "\u76c8\u4e8f\u6bd4",    value: stats.profitFactor != null ? stats.profitFactor.toFixed(2) : "N/A", color: "" },
            { label: "\u5e73\u4ed3\u7b14\u6570",   value: `${stats.closeTrades}\u7b14`, color: "" },
            { label: "\u4ea4\u6613\u5929\u6570",   value: `${stats.tradingDays}\u5929`, color: "" },
          ] as { label: string; value: string; color: string }[]).map(({ label, value, color }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground leading-none">{label}</span>
              <span className={`text-sm font-semibold leading-none ${color}`}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
