"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent } from "@/components/ui/card"
import { PROD_NAMES, prodLabel } from "@/lib/ma/prod-sector"

const API_URL = "/ma/api/mom-analysis/var-mcr-timeseries?volDays=20&corrDays=252"
const POLL_MS = 60_000
const STALE_RETRY_MS = 8_000

const PRODUCT_SOFT = 30
const PRODUCT_HARD = 50
const SECTOR_SOFT = 50
const SECTOR_HARD = 65

const SECTOR_DISPLAY: Record<string, string> = {
  农产: "农产品",
}

const SECTOR_COLORS: Record<string, string> = {
  能源化工: "#1A365D",
  农产: "#C9A227",
  生鲜: "#DD6B20",
  黑色: "#4A5568",
  新能源: "#2B6CB0",
  有色: "#6B46C1",
  贵金属: "#B83280",
  股指: "#C53030",
  国债: "#2F855A",
  航运: "#2C7A7B",
  其他: "#A0AEC0",
}

const PRODUCT_COLORS: Record<string, string> = {
  MA: "#1A365D",
  EG: "#2B6CB0",
  JD: "#DD6B20",
  JM: "#C53030",
  AU: "#B83280",
  L: "#6B46C1",
  LC: "#2F855A",
  SF: "#975A16",
  M: "#2C7A7B",
  RB: "#4A5568",
  IM: "#9B2C2C",
}

const FALLBACK_PRODUCT_COLORS = [
  "#1A365D", "#2B6CB0", "#DD6B20", "#C53030", "#B83280",
  "#6B46C1", "#2F855A", "#975A16", "#2C7A7B", "#4A5568",
  "#9B2C2C", "#553C9A", "#2C5282",
]

const GOLD = "#C9A227"
const RED = "#C53030"
const TEAL = "#2B6CB0"
const GRAY_LINE = "#A0AEC0"
const PNL_LINE = "#1D4ED8"
const REST_SERIES = "其余品种（从未到 30%）"
const LINKED_LEFT = 56
const LINKED_RIGHT = 72

type PointerPayload = { axesInfo?: { axisDim?: string; value?: string | number }[] }

type LinkChart = {
  on: (event: string, handler: (payload: PointerPayload) => void) => void
  off: (event: string, handler: (payload: PointerPayload) => void) => void
  dispatchAction: (payload: object) => void
  convertToPixel: (finder: { xAxisIndex: number }, value: string) => number
  getHeight: () => number
  getOption: () => { xAxis?: { data?: string[] } | { data?: string[] }[] }
  isDisposed: () => boolean
}

function axisDateFromPointer(chart: LinkChart, payload: PointerPayload): string | null {
  const info = payload.axesInfo?.find(axis => axis.axisDim === "x")
  if (!info || info.value == null) return null
  if (typeof info.value === "number") {
    const axis = chart.getOption().xAxis
    const data = Array.isArray(axis) ? axis[0]?.data : axis?.data
    const raw = data?.[info.value]
    return raw ? String(raw).slice(0, 10) : null
  }
  return String(info.value).slice(0, 10)
}

function linkCharts(product: LinkChart, candle: LinkChart) {
  let lock = false
  const sync = (source: LinkChart, target: LinkChart) => (payload: PointerPayload) => {
    if (lock || target.isDisposed()) return
    const date = axisDateFromPointer(source, payload)
    if (!date) return
    const rawX = target.convertToPixel({ xAxisIndex: 0 }, date) as number | number[]
    const x = Array.isArray(rawX) ? rawX[0] : rawX
    if (typeof x !== "number" || Number.isNaN(x)) return
    lock = true
    target.dispatchAction({ type: "showTip", x, y: target.getHeight() / 2 })
    lock = false
  }
  const onProduct = sync(product, candle)
  const onCandle = sync(candle, product)
  const hide = (target: LinkChart) => () => {
    if (lock || target.isDisposed()) return
    target.dispatchAction({ type: "hideTip" })
    target.dispatchAction({ type: "updateAxisPointer", currTrigger: "leave" })
  }
  const hideCandle = hide(candle)
  const hideProduct = hide(product)
  product.on("updateAxisPointer", onProduct)
  candle.on("updateAxisPointer", onCandle)
  product.on("globalout", hideCandle)
  candle.on("globalout", hideProduct)
  return () => {
    if (!product.isDisposed()) {
      product.off("updateAxisPointer", onProduct)
      product.off("globalout", hideCandle)
    }
    if (!candle.isDisposed()) {
      candle.off("updateAxisPointer", onCandle)
      candle.off("globalout", hideProduct)
    }
  }
}

type CandleRow = { date: string; open: number; high: number; low: number; close: number; volume: number }
type PnlRow = { date: string; pnl: number; cumPnl: number }

function fmtYuan(v: number): string {
  const sign = v < 0 ? "-" : ""
  return `${sign}${Math.abs(Math.round(v)).toLocaleString("zh-CN")} 元`
}

function fmtWanAxis(v: number): string {
  const n = v / 10000
  const abs = Math.abs(n)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  return `${n < 0 ? "-" : ""}${abs.toFixed(digits)}万`
}

function alignPnl(dates: string[], rows: PnlRow[]): { cum: (number | null)[]; day: (number | null)[] } {
  const sorted = [...rows].sort((a, b) => axisDate(a.date).localeCompare(axisDate(b.date)))
  const byDate = new Map(sorted.map(r => [axisDate(r.date), r]))
  const first = dates[0] ?? ""
  let carry: number | null = null
  for (const r of sorted) {
    if (axisDate(r.date) < first) carry = r.cumPnl
    else break
  }
  const cum: (number | null)[] = []
  const day: (number | null)[] = []
  for (const d of dates) {
    const row = byDate.get(d)
    if (row) carry = row.cumPnl
    cum.push(carry)
    day.push(row ? row.pnl : carry == null ? null : 0)
  }
  return { cum, day }
}

function candlePnlOption(code: string, candles: CandleRow[], rows: PnlRow[], axisDates: string[]) {
  const dates = axisDates.length > 0 ? axisDates : candles.map(c => axisDate(c.date))
  const byCandle = new Map(candles.map(c => [axisDate(c.date), c]))
  const aligned = dates.map(d => byCandle.get(d) ?? null)
  const { cum, day } = alignPnl(dates, rows)
  const pnlName = "组合累计盈亏"
  return {
    title: {
      text: `${prodLabel(code)} K线与组合累计盈亏`,
      left: "center",
      top: 4,
      textStyle: { fontSize: 13, fontWeight: 600, color: "#1f2937" },
    },
    tooltip: {
      trigger: "axis" as const,
      axisPointer: { type: "line" as const, animation: false },
      formatter: (params: { dataIndex?: number; axisValue?: string }[]) => {
        const i = params[0]?.dataIndex ?? 0
        const r = aligned[i]
        const lines = [params[0]?.axisValue ?? dates[i]]
        if (r) lines.push(`开 ${r.open}　高 ${r.high}　低 ${r.low}　收 ${r.close}`)
        else lines.push("当日无K线")
        if (day[i] != null) lines.push(`当日盈亏 ${fmtYuan(day[i] as number)}`)
        lines.push(cum[i] != null ? `${pnlName} ${fmtYuan(cum[i] as number)}` : `${pnlName} —`)
        return lines.join("<br/>")
      },
    },
    legend: { top: 26, left: 8, itemWidth: 12, textStyle: { fontSize: 11 }, data: ["K线", pnlName] },
    grid: { left: LINKED_LEFT, right: LINKED_RIGHT, top: 56, bottom: 52 },
    dataZoom: [
      { type: "inside" as const, start: 0, end: 100 },
      { type: "slider" as const, height: 16, bottom: 8 },
    ],
    xAxis: {
      type: "category" as const,
      data: dates,
      boundaryGap: true,
      axisLabel: { fontSize: 9, hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: "value" as const,
        scale: true,
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { type: "dashed" as const, color: "#E2E8F0" } },
      },
      {
        type: "value" as const,
        scale: true,
        axisLabel: { fontSize: 9, formatter: (v: number) => fmtWanAxis(v) },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "K线",
        type: "candlestick" as const,
        yAxisIndex: 0,
        data: aligned.map(r => (r ? [r.open, r.close, r.low, r.high] : "-")),
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
        yAxisIndex: 1,
        data: cum,
        symbol: "none",
        lineStyle: { color: PNL_LINE, width: 2 },
        itemStyle: { color: PNL_LINE },
        z: 10,
      },
    ],
  }
}

function searchProducts(codes: string[], query: string): { code: string; label: string }[] {
  const raw = query.trim()
  const q = raw.toLowerCase()
  if (!raw) return []
  const rank = (code: string) => {
    const name = (PROD_NAMES[code] ?? "").toLowerCase()
    const c = code.toLowerCase()
    if (c === q || name === q || prodLabel(code) === raw) return 0
    if (c.startsWith(q) || name.startsWith(q)) return 1
    return 2
  }
  return [...new Set(codes.map(c => c.toUpperCase()))]
    .filter(code => /^[A-Z]{1,4}$/.test(code))
    .filter(code => {
      const name = PROD_NAMES[code] ?? ""
      return code.toLowerCase().includes(q)
        || name.includes(raw)
        || name.toLowerCase().includes(q)
        || prodLabel(code).toLowerCase().includes(q)
    })
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .slice(0, 12)
    .map(code => ({ code, label: prodLabel(code) }))
}

function ProductCandleSearch({
  codes,
  from,
  to,
  axisDates,
  onActiveChange,
  onCandleChart,
  children,
  chartAfter,
}: {
  codes: string[]
  from: string
  to: string
  axisDates: string[]
  onActiveChange?: (active: boolean) => void
  onCandleChart?: (chart: LinkChart | null) => void
  children?: ReactNode
  chartAfter?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [listOpen, setListOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [candles, setCandles] = useState<CandleRow[]>([])
  const [pnlRows, setPnlRows] = useState<PnlRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pnlCache = useRef<Record<string, PnlRow[]> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => searchProducts(codes, query), [codes, query])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!picked || !from || !to) return
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    setCandles([])
    setPnlRows([])
    const candleP = fetch(
      `/ma/api/mom-analysis/product-candle?product=${encodeURIComponent(picked)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { signal: ac.signal },
    ).then(r => r.json()) as Promise<{ ok?: boolean; data?: CandleRow[]; error?: string }>
    const pnlP = pnlCache.current
      ? Promise.resolve(pnlCache.current)
      : fetch("/ma/api/mom-analysis/category-pnl", { signal: ac.signal })
          .then(r => r.json())
          .then((j: { productData?: Record<string, PnlRow[]> }) => {
            pnlCache.current = j.productData ?? {}
            return pnlCache.current
          })
    Promise.all([candleP, pnlP])
      .then(([candle, productData]) => {
        if (ac.signal.aborted) return
        if (candle.ok === false) throw new Error(candle.error || "K线加载失败")
        setCandles(candle.data ?? [])
        setPnlRows(productData[picked] ?? [])
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted) return
        if (e instanceof DOMException && e.name === "AbortError") return
        setError(e instanceof Error ? e.message : "加载失败")
        setCandles([])
        setPnlRows([])
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false)
      })
    return () => ac.abort()
  }, [picked, from, to])

  const option = useMemo(
    () => (picked && candles.length > 0 ? candlePnlOption(picked, candles, pnlRows, axisDates) : null),
    [picked, candles, pnlRows, axisDates],
  )

  useEffect(() => {
    onActiveChange?.(open && !!picked)
  }, [open, picked, onActiveChange])

  useEffect(() => {
    if (!option) onCandleChart?.(null)
  }, [option, onCandleChart])

  function choose(code: string) {
    setPicked(code)
    setQuery(prodLabel(code))
    setListOpen(false)
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-end gap-2 px-1 pb-1">
        {children}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="text-xs px-2 py-0.5 rounded border border-border bg-background hover:bg-muted"
        >
          {open ? "收起品种K线" : "品种K线"}
        </button>
        {open && (
          <div className="relative w-56">
            <input
              ref={inputRef}
              value={query}
              autoComplete="off"
              placeholder="搜索品种，如 MA 或 甲醇"
              onChange={e => {
                setQuery(e.target.value)
                setListOpen(true)
              }}
              onFocus={() => setListOpen(true)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  const hit = searchProducts(codes, e.currentTarget.value)[0]
                  if (hit) {
                    e.preventDefault()
                    choose(hit.code)
                  }
                }
                if (e.key === "Escape") setListOpen(false)
              }}
              className="h-7 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring"
            />
            {listOpen && query.trim() && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-popover shadow-md">
                {matches.length === 0 ? (
                  <li className="px-2 py-1.5 text-xs text-muted-foreground">无匹配品种</li>
                ) : matches.map(m => (
                  <li key={m.code}>
                    <button
                      type="button"
                      className="w-full px-2 py-1.5 text-left text-xs hover:bg-muted"
                      onMouseDown={e => {
                        e.preventDefault()
                        choose(m.code)
                      }}
                    >
                      {m.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {open && picked && (
        <div className="mt-1 border-t border-border pt-2">
          {loading && <p className="px-1 text-xs text-muted-foreground">加载 {prodLabel(picked)} …</p>}
          {error && <p className="px-1 text-xs text-muted-foreground">{error}</p>}
          {!loading && !error && candles.length === 0 && (
            <p className="px-1 text-xs text-muted-foreground">没有 {prodLabel(picked)} 的K线</p>
          )}
          {option && (
            <ReactECharts
              option={option}
              style={{ height: 420 }}
              notMerge
              lazyUpdate={false}
              onChartReady={chart => onCandleChart?.(chart as unknown as LinkChart)}
            />
          )}
          {!loading && candles.length > 0 && pnlRows.length === 0 && (
            <p className="px-1 pb-1 text-[10px] text-muted-foreground">该品种没有组合盈亏记录，只显示K线。</p>
          )}
          {candles.length > 0 && (
            <p className="px-1 pb-1 text-[10px] text-muted-foreground">
              K线为主力连续合约。右轴是组合在该品种上的累计盈亏（平仓盈亏、持仓盈亏、手续费和权利金）。
            </p>
          )}
        </div>
      )}
      {chartAfter}
    </div>
  )
}

/** First included date: mature sample starts when n_prod first reaches 20. */
const HISTORY_START = "2025-08-06"

type McrPayload = {
  ok: boolean
  dates: string[]
  productData: Record<string, number[]>
  sectorData: Record<string, number[]>
  maxProductShare: number[]
  maxSectorShare: number[]
  distanceProduct: number[]
  distanceSector: number[]
  productSoft?: number
  productHard?: number
  sectorSoft?: number
  sectorHard?: number
  cacheStatus?: string
}

function sectorLabel(name: string): string {
  return SECTOR_DISPLAY[name] ?? name
}

function productColor(code: string, index: number): string {
  return PRODUCT_COLORS[code] ?? FALLBACK_PRODUCT_COLORS[index % FALLBACK_PRODUCT_COLORS.length]
}

function peakIndex(series: number[]): number {
  let best = 0
  for (let i = 1; i < series.length; i++) {
    if (series[i] > series[best]) best = i
  }
  return best
}

function axisDate(v: string): string {
  return (v ?? "").slice(0, 10)
}

function cropHistory(payload: McrPayload): McrPayload {
  const startIdx = payload.dates.findIndex(d => axisDate(d) >= HISTORY_START)
  if (startIdx <= 0) return payload
  const cut = <T,>(arr: T[]) => arr.slice(startIdx)
  const cutMap = (obj: Record<string, number[]>) =>
    Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, cut(v)]))
  return {
    ...payload,
    dates: cut(payload.dates),
    productData: cutMap(payload.productData),
    sectorData: cutMap(payload.sectorData),
    maxProductShare: cut(payload.maxProductShare),
    maxSectorShare: cut(payload.maxSectorShare),
    distanceProduct: cut(payload.distanceProduct),
    distanceSector: cut(payload.distanceSector),
  }
}

export default function VarMcrTimeseriesCharts() {
  const [data, setData] = useState<McrPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [legendOn, setLegendOn] = useState<Record<string, boolean> | null>(null)
  const [candleActive, setCandleActive] = useState(false)
  const onCandleActive = useCallback((active: boolean) => setCandleActive(active), [])
  const productChartRef = useRef<LinkChart | null>(null)
  const candleChartRef = useRef<LinkChart | null>(null)
  const unlinkRef = useRef<(() => void) | null>(null)
  const relinkPointers = useCallback(() => {
    unlinkRef.current?.()
    unlinkRef.current = null
    const product = productChartRef.current
    const candle = candleChartRef.current
    if (product && candle && !product.isDisposed() && !candle.isDisposed()) {
      unlinkRef.current = linkCharts(product, candle)
    }
  }, [])
  const onProductChart = useCallback((chart: LinkChart) => {
    productChartRef.current = chart
    relinkPointers()
  }, [relinkPointers])
  const onCandleChart = useCallback((chart: LinkChart | null) => {
    candleChartRef.current = chart
    relinkPointers()
  }, [relinkPointers])
  useEffect(() => () => unlinkRef.current?.(), [])
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const resp = await fetch(API_URL, { cache: "no-cache" })
      const json = (await resp.json()) as McrPayload
      if (!json?.ok) {
        setError((json as { error?: string }).error || "加载失败")
        return
      }
      setError(null)
      setData(json)
      const stale = resp.headers.get("X-Mom-Cache") === "stale" || json.cacheStatus === "stale"
      if (stale) {
        if (staleTimer.current) clearTimeout(staleTimer.current)
        staleTimer.current = setTimeout(() => { void load() }, STALE_RETRY_MS)
      }
    } catch {
      setError("加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const onVis = () => {
      if (document.visibilityState === "visible") void load()
    }
    document.addEventListener("visibilitychange", onVis)
    const poll = setInterval(() => { void load() }, POLL_MS)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      clearInterval(poll)
      if (staleTimer.current) clearTimeout(staleTimer.current)
    }
  }, [load])

  const view = useMemo(() => (data ? cropHistory(data) : null), [data])
  const productSoft = view?.productSoft ?? PRODUCT_SOFT
  const productHard = view?.productHard ?? PRODUCT_HARD
  const sectorSoft = view?.sectorSoft ?? SECTOR_SOFT
  const sectorHard = view?.sectorHard ?? SECTOR_HARD
  const dates = view?.dates ?? []
  const axisDates = useMemo(() => dates.map(axisDate), [dates])
  const searchCodes = useMemo(() => {
    const set = new Set<string>(Object.keys(PROD_NAMES))
    if (view) for (const code of Object.keys(view.productData)) set.add(code.toUpperCase())
    return [...set]
  }, [view])
  const candleFrom = dates.length > 0 ? axisDate(dates[0]) : ""
  const candleTo = dates.length > 0 ? axisDate(dates[dates.length - 1]) : ""

  const distanceOption = useMemo(() => {
    if (!view || dates.length === 0) return null
    return {
      title: {
        text: `距离建议软预警线（品种${productSoft}% / 板块${sectorSoft}%）`,
        left: "center",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 600, color: "#1f2937" },
      },
      tooltip: {
        trigger: "axis",
        formatter: (params: { seriesName: string; value: number; marker: string; axisValue: string }[]) => {
          const lines = params.map(p => `${p.marker}${p.seriesName}: ${Number(p.value).toFixed(1)} 百分点`)
          return [params[0]?.axisValue, ...lines].join("<br/>")
        },
      },
      legend: {
        data: ["距品种软预警（百分点，负值=已突破）", "距板块软预警（百分点）"],
        bottom: 0,
        itemWidth: 14,
        textStyle: { fontSize: 10 },
      },
      grid: { left: 52, right: 20, top: 36, bottom: 48 },
      xAxis: {
        type: "category",
        data: dates.map(axisDate),
        axisLabel: { fontSize: 9, hideOverlap: true },
        axisTick: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        type: "value",
        name: "距离（百分点）",
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 9 },
        splitLine: { lineStyle: { type: "dashed", color: "#E2E8F0" } },
      },
      series: [
        {
          name: "距品种软预警（百分点，负值=已突破）",
          type: "line",
          data: view.distanceProduct,
          symbol: "none",
          lineStyle: { width: 1.6, color: TEAL },
          itemStyle: { color: TEAL },
          z: 3,
        },
        {
          name: "距板块软预警（百分点）",
          type: "line",
          data: view.distanceSector,
          symbol: "none",
          lineStyle: { width: 1.6, color: GOLD },
          itemStyle: { color: GOLD },
          z: 3,
        },
        {
          name: "零线",
          type: "line",
          data: dates.map(() => 0),
          symbol: "none",
          lineStyle: { width: 1, color: RED },
          tooltip: { show: false },
          silent: true,
          z: 2,
        },
      ],
    }
  }, [view, dates, productSoft, sectorSoft])

  const productsOption = useMemo(() => {
    if (!view || dates.length === 0) return null
    const entries = Object.entries(view.productData)
    const peak = entries
      .map(([code, series]) => ({ code, series, max: Math.max(0, ...series) }))
      .sort((a, b) => b.max - a.max)
    const highlighted = peak.filter(p => p.max >= productSoft)
    const others = peak.filter(p => p.max < productSoft)
    const series: Record<string, unknown>[] = []

    if (others.length > 0) {
      others.forEach((p, i) => {
        series.push({
          name: REST_SERIES,
          type: "line",
          data: p.series,
          symbol: "none",
          lineStyle: { width: 0.7, color: GRAY_LINE, opacity: 0.45 },
          itemStyle: { color: GRAY_LINE },
          legendHoverLink: i === 0,
          z: 1,
        })
      })
    }

    highlighted.forEach((p, i) => {
      const color = productColor(p.code, i)
      const idx = peakIndex(p.series)
      series.push({
        name: prodLabel(p.code),
        type: "line",
        data: p.series,
        symbol: "none",
        lineStyle: { width: 1.7, color },
        itemStyle: { color },
        z: 3,
        markPoint: {
          symbol: "circle",
          symbolSize: 5,
          itemStyle: { color },
          label: {
            formatter: `${prodLabel(p.code)} ${Math.round(p.series[idx])}%`,
            fontSize: 10,
            color,
            offset: [0, -10],
          },
          data: [{ coord: [axisDate(dates[idx]), p.series[idx]] }],
        },
      })
    })

    series.push(
      {
        name: `品种软预警 ${productSoft}%`,
        type: "line",
        data: dates.map(() => productSoft),
        symbol: "none",
        lineStyle: { width: 1.2, type: "dashed", color: GOLD },
        itemStyle: { color: GOLD },
        tooltip: { show: false },
        z: 4,
      },
      {
        name: `品种硬干预 ${productHard}%`,
        type: "line",
        data: dates.map(() => productHard),
        symbol: "none",
        lineStyle: { width: 1.3, type: "dotted", color: RED },
        itemStyle: { color: RED },
        tooltip: { show: false },
        z: 4,
      },
    )

    const legendData = [
      ...highlighted.map(p => prodLabel(p.code)),
      ...(others.length ? [REST_SERIES] : []),
      `品种软预警 ${productSoft}%`,
      `品种硬干预 ${productHard}%`,
    ]

    return {
      title: {
        text: "全部品种边际波动贡献占比（时序，自 2025-08-06 起）",
        left: "center",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 600, color: "#1f2937" },
      },
      tooltip: {
        trigger: "axis",
        ...(candleActive ? { axisPointer: { type: "line" as const, animation: false } } : {}),
        formatter: (params: { seriesName: string; value: number; marker: string; axisValue: string }[]) => {
          const best = new Map<string, { seriesName: string; value: number; marker: string }>()
          for (const p of params) {
            if (p.seriesName.includes("预警") || p.seriesName.includes("干预")) continue
            if (typeof p.value !== "number" || p.value <= 0.5) continue
            const prev = best.get(p.seriesName)
            if (!prev || p.value > prev.value) best.set(p.seriesName, p)
          }
          const rows = [...best.values()]
            .sort((a, b) => b.value - a.value)
            .slice(0, 12)
            .map(p => `${p.marker}${p.seriesName}: ${p.value.toFixed(2)}%`)
          return [params[0]?.axisValue, ...rows].join("<br/>")
        },
      },
      legend: {
        type: "scroll",
        top: 24,
        right: 8,
        width: "70%",
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { fontSize: 10 },
        data: legendData,
        ...(legendOn
          ? { selected: Object.fromEntries(legendData.map(name => [name, legendOn[name] !== false])) }
          : {}),
      },
      grid: candleActive
        ? { left: LINKED_LEFT, right: LINKED_RIGHT, top: 72, bottom: 28 }
        : { left: 52, right: 20, top: 72, bottom: 28 },
      xAxis: {
        type: "category",
        data: axisDates,
        axisLabel: { fontSize: 9, hideOverlap: true },
        axisTick: { show: false },
        boundaryGap: candleActive,
      },
      yAxis: {
        type: "value",
        name: "贡献占比",
        nameTextStyle: { fontSize: 10 },
        min: 0,
        max: (value: { max: number }) => Math.max(90, Math.ceil((value.max + 5) / 10) * 10),
        axisLabel: { fontSize: 9, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { type: "dashed", color: "#E2E8F0" } },
      },
      series,
    }
  }, [view, dates, axisDates, productSoft, productHard, legendOn, candleActive])

  const sectorsOption = useMemo(() => {
    if (!view || dates.length === 0) return null
    const entries = Object.entries(view.sectorData)
      .map(([name, series]) => ({ name, series, max: Math.max(0, ...series) }))
      .sort((a, b) => b.max - a.max)

    const series: Record<string, unknown>[] = entries.map((s) => {
      const color = SECTOR_COLORS[s.name] ?? GRAY_LINE
      const crossed = s.max >= sectorSoft
      const idx = peakIndex(s.series)
      return {
        name: sectorLabel(s.name),
        type: "line",
        data: s.series,
        symbol: "none",
        lineStyle: { width: crossed ? 1.8 : 1.15, color, opacity: crossed ? 1 : 0.75 },
        itemStyle: { color },
        z: crossed ? 3 : 2,
        markPoint: crossed
          ? {
              symbol: "circle",
              symbolSize: 5,
              itemStyle: { color },
              label: {
                formatter: `${sectorLabel(s.name)} ${Math.round(s.series[idx])}%`,
                fontSize: 10,
                color,
                offset: [0, -10],
              },
              data: [{ coord: [axisDate(dates[idx]), s.series[idx]] }],
            }
          : undefined,
      }
    })

    series.push(
      {
        name: `板块软预警 ${sectorSoft}%`,
        type: "line",
        data: dates.map(() => sectorSoft),
        symbol: "none",
        lineStyle: { width: 1.2, type: "dashed", color: GOLD },
        itemStyle: { color: GOLD },
        tooltip: { show: false },
        z: 4,
      },
      {
        name: `板块硬干预 ${sectorHard}%`,
        type: "line",
        data: dates.map(() => sectorHard),
        symbol: "none",
        lineStyle: { width: 1.3, type: "dotted", color: RED },
        itemStyle: { color: RED },
        tooltip: { show: false },
        z: 4,
      },
    )

    return {
      title: {
        text: "全部板块边际波动贡献占比（时序，自 2025-08-06 起）",
        left: "center",
        top: 4,
        textStyle: { fontSize: 13, fontWeight: 600, color: "#1f2937" },
      },
      tooltip: {
        trigger: "axis",
        formatter: (params: { seriesName: string; value: number; marker: string; axisValue: string }[]) => {
          const rows = params
            .filter(p => !p.seriesName.includes("预警") && !p.seriesName.includes("干预"))
            .filter(p => typeof p.value === "number" && p.value > 0.05)
            .sort((a, b) => Number(b.value) - Number(a.value))
            .map(p => `${p.marker}${p.seriesName}: ${Number(p.value).toFixed(2)}%`)
          return [params[0]?.axisValue, ...rows].join("<br/>")
        },
      },
      legend: {
        type: "scroll",
        top: 24,
        right: 8,
        width: "70%",
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { fontSize: 10 },
      },
      grid: { left: 52, right: 20, top: 72, bottom: 28 },
      xAxis: {
        type: "category",
        data: dates.map(axisDate),
        axisLabel: { fontSize: 9, hideOverlap: true },
        axisTick: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        type: "value",
        name: "贡献占比",
        nameTextStyle: { fontSize: 10 },
        min: 0,
        max: (value: { max: number }) => Math.max(100, Math.ceil((value.max + 5) / 10) * 10),
        axisLabel: { fontSize: 9, formatter: (v: number) => `${v}%` },
        splitLine: { lineStyle: { type: "dashed", color: "#E2E8F0" } },
      },
      series,
    }
  }, [view, dates, sectorSoft, sectorHard])

  const footnote = dates.length > 0
    ? `口径对齐日间风控 VaR 沙盘（vol=20日, corr=252日, 含当日窗口）。共 ${Object.keys(view?.productData ?? {}).length} 个品种、${Object.keys(view?.sectorData ?? {}).length} 个板块，${dates[0]} 至 ${dates[dates.length - 1]}。建仓期（此前品种少、贡献易被放大）不进入本图。彩色品种线为这段样本中曾达到或超过 ${productSoft}% 的品种；加粗板块线为曾达到或超过 ${sectorSoft}% 软预警的板块。`
    : "口径对齐日间风控 VaR 沙盘（含当日窗口）。"

  if (loading && !data) {
    return (
      <section id="section-intraday-mcr-history" className="mt-4">
        <p className="text-sm text-muted-foreground">边际波动贡献时序加载中...</p>
      </section>
    )
  }

  if (error && !data) {
    return (
      <section id="section-intraday-mcr-history" className="mt-4">
        <p className="text-sm text-muted-foreground">{error}</p>
      </section>
    )
  }

  if (!data || dates.length === 0) {
    return (
      <section id="section-intraday-mcr-history" className="mt-4">
        <p className="text-sm text-muted-foreground">暂无边际波动贡献时序数据</p>
      </section>
    )
  }

  const productLegendNames = productsOption?.legend.data ?? []
  const productLinesOff = productLegendNames.length > 0 && productLegendNames.every(name => legendOn?.[name] === false)

  return (
    <section id="section-intraday-mcr-history" className="mt-4 space-y-4">
      <Card>
        <CardContent className="p-3 pb-2">
          {distanceOption && (
            <ReactECharts option={distanceOption} style={{ height: 340 }} notMerge lazyUpdate={false} />
          )}
          <p className="text-[10px] text-muted-foreground px-1 pb-1">
            把「还差几个百分点」显化。负值表示已突破软预警。与持续时间一同判读，避免单日刺破就报警。
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 pb-2">
          <ProductCandleSearch
            codes={searchCodes}
            from={candleFrom}
            to={candleTo}
            axisDates={axisDates}
            onActiveChange={onCandleActive}
            onCandleChart={onCandleChart}
            chartAfter={(
            <>
              {productsOption && (
                <ReactECharts
                  option={productsOption}
                  style={{ height: 420 }}
                  notMerge
                  lazyUpdate={false}
                  onChartReady={chart => onProductChart(chart as unknown as LinkChart)}
                  onEvents={{
                    legendselectchanged: (e: { selected?: Record<string, boolean> }) => {
                      if (e.selected) setLegendOn({ ...e.selected })
                    },
                  }}
                />
              )}
              <p className="text-[10px] text-muted-foreground px-1 pb-1">{footnote}</p>
            </>
          )}>
            <button
              type="button"
              onClick={() => {
                setLegendOn(productLinesOff ? null : Object.fromEntries(productLegendNames.map(name => [name, false])))
              }}
              className="text-xs px-2 py-0.5 rounded border border-border bg-background hover:bg-muted"
            >
              {productLinesOff ? "显示全部" : "关闭全部"}
            </button>
          </ProductCandleSearch>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-3 pb-2">
          {sectorsOption && (
            <ReactECharts option={sectorsOption} style={{ height: 420 }} notMerge lazyUpdate={false} />
          )}
          <p className="text-[10px] text-muted-foreground px-1 pb-1">{footnote}</p>
        </CardContent>
      </Card>
    </section>
  )
}
