"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ExposureMetric } from "@/lib/ma/quant-vs-subjective-signals"

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
  subjLong: number[][]
  subjShort: number[][]
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

type CandleRow = { date: string; open: number; high: number; low: number; close: number; volume: number }

function buildSleeveCandleOption(
  candles: CandleRow[],
  netMvByDate: Map<string, number>,
  priceLabel: string,
  sleeveName: string,
  lineColor: string,
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
  return {
    tooltip: {
      trigger: "axis" as const,
      axisPointer: { type: "cross" as const },
      formatter: (params: { seriesName: string; dataIndex: number; marker: string; axisValue: string }[]) => {
        const i = params[0]?.dataIndex ?? 0
        const r = candles[i]
        if (!r) return ""
        const up = r.close >= r.open
        return [
          params[0]?.axisValue,
          `开 ${r.open.toFixed(2)}　高 ${r.high.toFixed(2)}　低 ${r.low.toFixed(2)}　收 ${r.close.toFixed(2)}　${up ? "涨" : "跌"}`,
          `${sleeveName}当日盈亏 ${fmtWan(dayPnl[i] ?? 0)}`,
          `${pnlName} ${fmtWan(cumPnl[i] ?? 0)}`,
        ].join("<br/>")
      },
    },
    legend: { top: 4, itemWidth: 12, textStyle: { fontSize: 11 }, data: ["K线", pnlName] },
    grid: { left: 52, right: 64, top: 36, bottom: 48 },
    dataZoom: [
      { type: "inside" as const, start: 0, end: 100 },
      { type: "slider" as const, height: 16, bottom: 4 },
    ],
    xAxis: {
      type: "category" as const,
      data: dates,
      axisLabel: { fontSize: 10, rotate: 30 },
      boundaryGap: true,
    },
    yAxis: [
      {
        type: "value" as const,
        scale: true,
        name: priceLabel,
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { type: "dashed" as const } },
      },
      {
        type: "value" as const,
        scale: true,
        name: "累计盈亏",
        nameTextStyle: { fontSize: 10 },
        axisLabel: { fontSize: 10, formatter: (v: number) => fmtWan(v) },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "K线",
        type: "candlestick" as const,
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
        yAxisIndex: 1,
        data: cumPnl,
        symbol: "none",
        lineStyle: { color: lineColor, width: 2 },
        itemStyle: { color: lineColor },
        endLabel: {
          show: true,
          formatter: (p: { value: number }) => fmtWan(p.value),
          color: lineColor,
          fontSize: 11,
          fontWeight: "bold" as const,
        },
        z: 10,
      },
    ],
  }
}

type SeriesCfg = { name: string; stack: "long" | "short"; color: string; data: number[] }

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
}: {
  holdingTs: HoldingTs | null | undefined
  metric: ExposureMetric
  focus?: HoldingFocus | null
}) {
  const [cat, setCat] = useState("全部")
  const [sector, setSector] = useState("全部")
  const [subSector, setSubSector] = useState("全部")
  const [prod, setProd] = useState("全部")
  const [candles, setCandles] = useState<CandleRow[]>([])
  const [candleLoading, setCandleLoading] = useState(false)

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

  const candleOption = useMemo(
    () => buildSleeveCandleOption(candles, qNetMvByDate, candleLabel || "价格", "量化", "#2563eb"),
    [candles, qNetMvByDate, candleLabel],
  )
  const subjCandleOption = useMemo(
    () => buildSleeveCandleOption(candles, sNetMvByDate, candleLabel || "价格", "主观", "#d97706"),
    [candles, sNetMvByDate, candleLabel],
  )

  const unit = metric === "risk" ? "风险敞口 σ×市值" : "持仓市值"
  const filterKey = `${metric}-${cat}-${sector}-${subSector}-${prod}`

  return (
    <div id="section-holding-ts" className="space-y-2 scroll-mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">多空持仓时序</span>
        <span className="text-xs text-muted-foreground">{unit} · 左量化 右主观 · 与风控页同一套多空柱 + 净持仓线</span>
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
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium">量化 · 多空持仓</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              {!holdingTs || !dates.length ? (
                <p className="text-sm text-muted-foreground px-4 py-10 text-center">暂无持仓数据</p>
              ) : (
                <ReactECharts key={`q-${filterKey}`} option={qOption} style={{ height: 360 }} notMerge />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium">
                量化 · {candleLabel ? `${candleLabel} K线与累计盈亏` : "K线与累计盈亏"}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                昨日净市值 × 今日涨跌 = 当日盈亏。板块/细分为等权合成指数。
              </p>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              {!candleKey ? (
                <p className="text-sm text-muted-foreground px-4 py-10 text-center">请选择板块或品种以查看K线与量化累计盈亏</p>
              ) : candleLoading && !candles.length ? (
                <p className="text-sm text-muted-foreground px-4 py-10 text-center">加载K线…</p>
              ) : !candles.length ? (
                <p className="text-sm text-muted-foreground px-4 py-10 text-center">暂无K线数据</p>
              ) : (
                <ReactECharts key={`qc-${candleKey}`} option={candleOption} style={{ height: 320 }} notMerge />
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium">主观 · 多空持仓</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              {!holdingTs || !dates.length ? (
                <p className="text-sm text-muted-foreground px-4 py-10 text-center">暂无持仓数据</p>
              ) : (
                <ReactECharts key={`s-${filterKey}`} option={sOption} style={{ height: 360 }} notMerge />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium">
                主观 · {candleLabel ? `${candleLabel} K线与累计盈亏` : "K线与累计盈亏"}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                昨日净市值 × 今日涨跌 = 当日盈亏。板块/细分为等权合成指数。
              </p>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              {!candleKey ? (
                <p className="text-sm text-muted-foreground px-4 py-10 text-center">请选择板块或品种以查看K线与主观累计盈亏</p>
              ) : candleLoading && !candles.length ? (
                <p className="text-sm text-muted-foreground px-4 py-10 text-center">加载K线…</p>
              ) : !candles.length ? (
                <p className="text-sm text-muted-foreground px-4 py-10 text-center">暂无K线数据</p>
              ) : (
                <ReactECharts key={`sc-${candleKey}`} option={subjCandleOption} style={{ height: 320 }} notMerge />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
