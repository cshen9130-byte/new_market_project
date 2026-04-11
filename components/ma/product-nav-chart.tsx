"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface NavPoint {
  date: string
  nav: number
  cumCapital: number
  dailyReturn: number
  netFlow: number
  pnl: number
}

interface BenchmarkPoint {
  date: string
  close: number
}

interface TurnoverPoint {
  date: string
  turnoverPct: number
}

interface HoldingPoint {
  date: string
  avgHoldingDays: number
  closeCount: number
}

interface ProductNavResponse {
  ok: boolean
  data?: NavPoint[]
  turnoverSeries?: TurnoverPoint[]
  holdingSeries?: HoldingPoint[]
  error?: string
}

function fmtPct(v: number): string {
  return (v >= 0 ? "+" : "") + (v * 100).toFixed(3) + "%"
}
function fmtNav(v: number): string {
  return v.toFixed(4)
}
function fmtMoney(v: number): string {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
}

function fmtPctPoints(v: number): string {
  return `${(v * 100).toFixed(2)}%`
}

function fmtDays(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "-"
  return `${v.toFixed(1)}天`
}

function getChinaMarketColor(value: number): string {
  return value >= 0 ? "#ef4444" : "#22c55e"
}

function getChinaMarketTextClass(value: number): string {
  return value >= 0 ? "text-red-500" : "text-green-500"
}

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}
function isoMonthOffset(m: number) {
  const d = new Date()
  d.setMonth(d.getMonth() + m)
  return d.toISOString().slice(0, 10)
}

const QUICK_RANGES = [
  { label: "近一月",   from: () => isoMonthOffset(-1)  },
  { label: "近三月",   from: () => isoMonthOffset(-3)  },
  { label: "近六月",   from: () => isoMonthOffset(-6)  },
  { label: "近一年",   from: () => isoMonthOffset(-12) },
  { label: "全部",     from: () => "2020-01-01"        },
]

interface Props {
  productCode?: string
  height?: number
}

export default function ProductNavChart({ productCode, height = 360 }: Props) {
  const [allData, setAllData] = useState<NavPoint[]>([])
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkPoint[]>([])
  const [turnoverSeries, setTurnoverSeries] = useState<TurnoverPoint[]>([])
  const [holdingSeries, setHoldingSeries] = useState<HoldingPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingBenchmark, setLoadingBenchmark] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rangeFrom, setRangeFrom] = useState("2020-01-01")
  const [showBenchmark, setShowBenchmark] = useState(true)
  const [productName, setProductName] = useState(() => typeof window !== "undefined" ? localStorage.getItem("pf_productName") ?? "" : "")
  const [openDate, setOpenDate] = useState(() => typeof window !== "undefined" ? localStorage.getItem("pf_openDate") ?? "" : "")
  const [shareClass, setShareClass] = useState(() => typeof window !== "undefined" ? localStorage.getItem("pf_shareClass") ?? "" : "")
  const [feeStructure, setFeeStructure] = useState(() => typeof window !== "undefined" ? localStorage.getItem("pf_feeStructure") ?? "" : "")
  const [redemptionFee, setRedemptionFee] = useState(() => typeof window !== "undefined" ? localStorage.getItem("pf_redemptionFee") ?? "" : "")
  const [editingProduct, setEditingProduct] = useState(false)
  const [distFit, setDistFit] = useState<"normal" | "t" | "laplace" | "logistic" | "kde">("normal")
  const [showDistStats, setShowDistStats] = useState(false)
  const [volWindow, setVolWindow] = useState<5 | 10 | 20>(20)
  const [sharpeWindow, setSharpeWindow] = useState<20 | 60 | 120>(60)
  const [wSharpeSpan, setWSharpeSpan] = useState<10 | 20 | 60>(20)
  const [categoryPnlData, setCategoryPnlData] = useState<Record<string, { date: string; pnl: number; cumPnl: number }[]>>({})
  const [sectorPnlData, setSectorPnlData] = useState<Record<string, { date: string; pnl: number; cumPnl: number }[]>>({})
  const [subSectorPnlData, setSubSectorPnlData] = useState<Record<string, { date: string; pnl: number; cumPnl: number }[]>>({})
  const [productPnlData, setProductPnlData] = useState<Record<string, { date: string; pnl: number; cumPnl: number }[]>>({})
  const [loadingCategoryPnl, setLoadingCategoryPnl] = useState(false)
  const [catLineShowAll, setCatLineShowAll] = useState(true)
  const [sectorLineShowAll, setSectorLineShowAll] = useState(true)
  const [sectorCatFilter, setSectorCatFilter] = useState<"全部" | "商品" | "股指" | "国债">("全部")
  const [subLineShowAll, setSubLineShowAll] = useState(true)
  const [subCatFilter, setSubCatFilter] = useState<"全部" | "商品" | "股指" | "国债">("全部")
  const [subSectorFilter, setSubSectorFilter] = useState<string>("全部")
  const [prodLineShowAll, setProdLineShowAll] = useState(true)
  const [prodCatFilter, setProdCatFilter] = useState<string>("全部")
  const [prodSectorFilter, setProdSectorFilter] = useState<string>("全部")
  const [prodSubSectorFilter, setProdSubSectorFilter] = useState<string>("全部")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (productCode) params.set("product_code", productCode)
      const res = await fetch(`/ma/api/mom-analysis/product-nav?${params}`)
      const json = (await res.json()) as ProductNavResponse
      if (!res.ok || !json.ok) throw new Error(json.error || "请求失败")
      setAllData(json.data ?? [])
      setTurnoverSeries(json.turnoverSeries ?? [])
      setHoldingSeries(json.holdingSeries ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
      setTurnoverSeries([])
      setHoldingSeries([])
    } finally {
      setLoading(false)
    }
  }, [productCode])

  const loadBenchmark = useCallback(async (from: string, to: string) => {
    setLoadingBenchmark(true)
    try {
      const params = new URLSearchParams({ from, to, codes: "NHCI.NH" })
      const res = await fetch(`/ma/api/mom-analysis/benchmark?${params}`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setBenchmarkData([])
        return
      }
      const series = json.series?.[0]
      setBenchmarkData(series?.data ?? [])
    } catch {
      setBenchmarkData([])
    } finally {
      setLoadingBenchmark(false)
    }
  }, [])

  const loadCategoryPnl = useCallback(async () => {
    setLoadingCategoryPnl(true)
    try {
      const params = new URLSearchParams()
      if (productCode) params.set("product_code", productCode)
      const res = await fetch(`/ma/api/mom-analysis/category-pnl?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "请求失败")
      setCategoryPnlData(json.data ?? {})
      setSectorPnlData(json.sectorData ?? {})
      setSubSectorPnlData(json.subSectorData ?? {})
      setProductPnlData(json.productData ?? {})
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingCategoryPnl(false)
    }
  }, [productCode])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadCategoryPnl() }, [loadCategoryPnl])

  // Persist product element fields to localStorage
  useEffect(() => { localStorage.setItem("pf_productName", productName) }, [productName])
  useEffect(() => { localStorage.setItem("pf_openDate", openDate) }, [openDate])
  useEffect(() => { localStorage.setItem("pf_shareClass", shareClass) }, [shareClass])
  useEffect(() => { localStorage.setItem("pf_feeStructure", feeStructure) }, [feeStructure])
  useEffect(() => { localStorage.setItem("pf_redemptionFee", redemptionFee) }, [redemptionFee])

  useEffect(() => {
    if (allData.length === 0) {
      setBenchmarkData([])
      return
    }

    const firstDate = allData[0]?.date
    const lastDate = allData[allData.length - 1]?.date
    if (!firstDate || !lastDate) {
      setBenchmarkData([])
      return
    }

    loadBenchmark(firstDate, lastDate)
  }, [allData, loadBenchmark])

  // Filter by rangeFrom
  const displayData = allData.filter((p) => p.date >= rangeFrom)
  const displayBenchmarkData = benchmarkData.filter((point) => point.date >= rangeFrom)
  const displayTurnoverSeries = turnoverSeries.filter((point) => point.date >= rangeFrom)
  const displayHoldingSeries = holdingSeries.filter((point) => point.date >= rangeFrom)

  // Fix NAV to start at 1.0 for the selected range
  const startNav = displayData.length > 0 ? displayData[0].nav : 1
  const normalizedData = displayData.map((p) => ({
    ...p,
    navNorm: p.nav / startNav,
  }))
  const benchmarkBase = displayBenchmarkData.length > 0 ? displayBenchmarkData[0].close : 1
  const normalizedBenchmarkData = displayBenchmarkData.map((point) => ({
    ...point,
    returnPct: Math.round((((point.close / benchmarkBase) - 1) * 100) * 100) / 100,
  }))

  // Summary stats
  const lastPoint = normalizedData[normalizedData.length - 1]
  const totalReturn = lastPoint ? lastPoint.navNorm - 1 : 0
  const maxDrawdown = (() => {
    let peak = 1, maxDd = 0
    for (const p of normalizedData) {
      if (p.navNorm > peak) peak = p.navNorm
      const dd = (peak - p.navNorm) / peak
      if (dd > maxDd) maxDd = dd
    }
    return maxDd
  })()
  const annReturn = (() => {
    if (normalizedData.length < 2) return null
    const days = normalizedData.length
    const years = days / 252
    return Math.pow(lastPoint!.navNorm, 1 / years) - 1
  })()
  const tradingDays = normalizedData.length
  const profitDays = normalizedData.filter((point) => point.pnl > 0).length
  const lossDays = normalizedData.filter((point) => point.pnl < 0).length
  const decisionDays = profitDays + lossDays
  const winRate = decisionDays > 0 ? profitDays / decisionDays : tradingDays > 0 ? profitDays / tradingDays : 0
  const grossProfit = normalizedData.reduce((sum, point) => sum + (point.pnl > 0 ? point.pnl : 0), 0)
  const grossLoss = Math.abs(normalizedData.reduce((sum, point) => sum + (point.pnl < 0 ? point.pnl : 0), 0))
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null
  const avgTurnover = displayTurnoverSeries.length > 0
    ? displayTurnoverSeries.reduce((sum, point) => sum + point.turnoverPct, 0) / displayTurnoverSeries.length
    : null
  const avgHoldingPeriod = displayHoldingSeries.length > 0
    ? displayHoldingSeries.reduce((sum, point) => sum + point.avgHoldingDays * point.closeCount, 0)
      / displayHoldingSeries.reduce((sum, point) => sum + point.closeCount, 0)
    : null
  const capitalMaxDrawdown = (() => {
    let peak = Number.NEGATIVE_INFINITY
    let maxDd = 0
    for (const point of displayData) {
      if (point.cumCapital > peak) peak = point.cumCapital
      if (peak > 0) {
        const dd = (peak - point.cumCapital) / peak
        if (dd > maxDd) maxDd = dd
      }
    }
    return maxDd
  })()
  const performanceColor = getChinaMarketColor(totalReturn)
  const benchmarkLastPoint = normalizedBenchmarkData[normalizedBenchmarkData.length - 1]
  const showBenchmarkSeries = showBenchmark && normalizedBenchmarkData.length > 0

  const option = {
    animation: false,
    backgroundColor: "transparent",
    legend: showBenchmarkSeries
      ? {
          top: 0,
          right: 0,
          icon: "roundRect",
          itemWidth: 10,
          itemHeight: 6,
          textStyle: { fontSize: 11 },
          data: ["收益率", "南华商品指数"],
        }
      : undefined,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (params: unknown[]) => {
        const entries = params as Array<{ seriesName: string; value: [string, number] }>
        const primary = entries.find((entry) => entry.seriesName === "收益率") ?? entries[0]
        if (!primary) return ""
        const date = primary.value[0]
        const retPct = primary.value[1]
        const pt = normalizedData.find((d) => d.date === date)
        const benchmarkPoint = normalizedBenchmarkData.find((d) => d.date === date)
        const dailyRet = pt ? fmtPct(pt.dailyReturn) : "—"
        const capital = pt ? fmtMoney(pt.cumCapital) : "—"
        const pnl = pt ? fmtMoney(pt.pnl) : "—"
        const flow = pt && pt.netFlow !== 0 ? `<br/>资金流入 ${fmtMoney(pt.netFlow)}` : ""
        const returnColor = getChinaMarketColor(retPct)
        const dailyReturnColor = pt ? getChinaMarketColor(pt.dailyReturn) : "#64748b"
        const benchmarkLine = benchmarkPoint && showBenchmarkSeries
          ? `<br/>南华商品指数 <span style="color:#f59e0b">${benchmarkPoint.returnPct >= 0 ? "+" : ""}${benchmarkPoint.returnPct.toFixed(2)}%</span>`
          : ""
        return `<b>${date}</b><br/>收益率 <span style="color:${returnColor}">${retPct >= 0 ? "+" : ""}${retPct.toFixed(2)}%</span>${benchmarkLine}<br/>当日收益 <span style="color:${dailyReturnColor}">${dailyRet}</span><br/>当日盈亏 ${pnl}<br/>累计规模 ${capital}${flow}`
      },
    },
    grid: { left: 60, right: 20, top: showBenchmarkSeries ? 48 : 30, bottom: 50 },
    xAxis: {
      type: "category",
      data: normalizedData.map((p) => p.date),
      boundaryGap: false,
      axisLabel: {
        rotate: 30,
        fontSize: 11,
        formatter: (v: string) => v.slice(0, 10),
      },
    },
    yAxis: {
      type: "value",
      name: "收益率(%)",
      nameTextStyle: { fontSize: 11, padding: [0, 0, 0, 40] },
      axisLabel: {
        fontSize: 11,
        formatter: (v: number) => (v >= 0 ? "+" : "") + v.toFixed(0) + "%",
      },
      splitLine: { lineStyle: { opacity: 0.3 } },
    },
    dataZoom: [
      { type: "slider", bottom: 4, height: 20 },
      { type: "inside" },
    ],
    series: [
      {
        name: "收益率",
        type: "line",
        data: normalizedData.map((p) => [p.date, Math.round((p.navNorm - 1) * 10000) / 100]),
        symbol: "none",
        lineStyle: { color: performanceColor, width: 2 },
        itemStyle: { color: performanceColor },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: totalReturn >= 0 ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)" },
              { offset: 1, color: totalReturn >= 0 ? "rgba(239,68,68,0.02)" : "rgba(34,197,94,0.02)" },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ yAxis: 0, lineStyle: { color: "#888", type: "dashed", width: 1 }, label: { show: false } }],
        },
      },
      ...(showBenchmarkSeries
        ? [
            {
              name: "南华商品指数",
              type: "line",
              data: normalizedBenchmarkData.map((point) => [point.date, point.returnPct]),
              symbol: "none",
              lineStyle: { color: "#f59e0b", width: 1.5, type: "dashed" },
              itemStyle: { color: "#f59e0b" },
            },
          ]
        : []),
    ],
  }

  const reversedData = useMemo(() => [...normalizedData].reverse(), [normalizedData])

  // ── Monthly returns (from allData, rebased to annual start) ───────────
  const monthlyReturns = useMemo(() => {
    if (allData.length === 0) return {}
    // Group all nav points by year-month
    const byMonth: Record<string, NavPoint[]> = {}
    for (const p of allData) {
      const ym = p.date.slice(0, 7)
      ;(byMonth[ym] ??= []).push(p)
    }
    // For each month compute return relative to first nav of that month
    const result: Record<string, Record<number, number | null>> = {}
    for (const [ym, points] of Object.entries(byMonth)) {
      const year = parseInt(ym.slice(0, 4))
      const month = parseInt(ym.slice(5, 7))
      const first = points[0].nav
      const last = points[points.length - 1].nav
      const ret = first > 0 ? (last / first - 1) : null
      ;(result[year] ??= {})[month] = ret
    }
    // Annual return = last nav of year / first nav of year
    for (const year of Object.keys(result)) {
      const yPoints = allData.filter((p) => p.date.startsWith(year))
      if (yPoints.length > 0) {
        const first = yPoints[0].nav
        const last = yPoints[yPoints.length - 1].nav
        result[parseInt(year)][0] = first > 0 ? (last / first - 1) : null
      }
    }
    return result
  }, [allData])

  const monthlyYears = useMemo(() => Object.keys(monthlyReturns).map(Number).sort((a, b) => b - a), [monthlyReturns])
  const MONTH_LABELS = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"]

  // ── Comparison / risk stats (computed from normalizedData & normalizedBenchmarkData) ──
  const comparisonStats = useMemo(() => {
    const n = normalizedData.length
    if (n < 2) return null

    const dailyRets = normalizedData.map((p) => p.dailyReturn)
    const mean = dailyRets.reduce((s, r) => s + r, 0) / n
    const variance = dailyRets.reduce((s, r) => s + (r - mean) ** 2, 0) / n
    const stdDev = Math.sqrt(variance)
    const annVol = stdDev * Math.sqrt(252)

    const years = n / 252
    const annRet = annReturn ?? 0
    const rf = 0 // assume 0 risk-free rate for simplicity

    const sharpe = annVol > 0 ? (annRet - rf) / annVol : null

    // Downside deviation
    const downside = dailyRets.filter((r) => r < 0)
    const downVar = downside.length > 0 ? downside.reduce((s, r) => s + r ** 2, 0) / downside.length : 0
    const downStd = Math.sqrt(downVar) * Math.sqrt(252)
    const sortino = downStd > 0 ? (annRet - rf) / downStd : null

    // Calmar
    const calmar = maxDrawdown > 0 ? annRet / maxDrawdown : null

    // Max drawdown recovery period
    let maxDdEnd = 0, maxDdPeak = 0, maxDdDays = 0
    {
      let peak = 1, peakIdx = 0
      let curDd = 0
      for (let i = 0; i < normalizedData.length; i++) {
        if (normalizedData[i].navNorm > peak) { peak = normalizedData[i].navNorm; peakIdx = i }
        const dd = (peak - normalizedData[i].navNorm) / peak
        if (dd > curDd) { curDd = dd; maxDdPeak = peakIdx; maxDdEnd = i }
      }
      // recovery = next time nav >= peak after maxDdEnd
      let recovered = normalizedData.length - maxDdEnd  // still in drawdown = days remaining
      for (let i = maxDdEnd + 1; i < normalizedData.length; i++) {
        if (normalizedData[i].navNorm >= normalizedData[maxDdPeak].navNorm) {
          recovered = i - maxDdEnd
          break
        }
      }
      maxDdDays = recovered
    }

    // Max consecutive days not making new high
    let maxConsec = 0, curConsec = 0
    let runningPeak = 0
    for (const p of normalizedData) {
      if (p.navNorm > runningPeak) { runningPeak = p.navNorm; curConsec = 0 }
      else { curConsec++; if (curConsec > maxConsec) maxConsec = curConsec }
    }

    // VaR 95%
    const sorted = [...dailyRets].sort((a, b) => a - b)
    const varIdx = Math.floor(sorted.length * 0.05)
    const var95 = sorted[varIdx] ?? 0

    // Skewness & Kurtosis
    const skew = stdDev > 0
      ? dailyRets.reduce((s, r) => s + ((r - mean) / stdDev) ** 3, 0) / n
      : null
    const kurt = stdDev > 0
      ? dailyRets.reduce((s, r) => s + ((r - mean) / stdDev) ** 4, 0) / n - 3
      : null

    // Benchmark stats
    let correlation: number | null = null
    let infoRatio: number | null = null
    let trackingError: number | null = null
    let alpha: number | null = null
    let beta: number | null = null

    // align dates
    const bmDates = new Set(normalizedBenchmarkData.map((p) => p.date))
    const aligned = normalizedData.filter((p) => bmDates.has(p.date))
    const bmAligned = aligned.map((p) => {
      const b = normalizedBenchmarkData.find((bm) => bm.date === p.date)!
      return b
    })

    if (aligned.length > 2) {
      const pRets = aligned.map((p) => p.dailyReturn)
      const bRets: number[] = []
      for (let i = 1; i < bmAligned.length; i++) {
        bRets.push(bmAligned[i - 1].close > 0 ? (bmAligned[i].close / bmAligned[i - 1].close - 1) : 0)
      }
      const pRets2 = pRets.slice(1)
      const na = pRets2.length
      const pMean = pRets2.reduce((s, r) => s + r, 0) / na
      const bMean = bRets.reduce((s, r) => s + r, 0) / na
      const cov = pRets2.reduce((s, r, i) => s + (r - pMean) * (bRets[i] - bMean), 0) / na
      const bVar = bRets.reduce((s, r) => s + (r - bMean) ** 2, 0) / na
      const pVar = pRets2.reduce((s, r) => s + (r - pMean) ** 2, 0) / na
      beta = bVar > 0 ? cov / bVar : null
      alpha = annRet - (beta ?? 0) * (bMean * 252)
      const diffRets = pRets2.map((r, i) => r - bRets[i])
      const diffMean = diffRets.reduce((s, r) => s + r, 0) / na
      const diffStd = Math.sqrt(diffRets.reduce((s, r) => s + (r - diffMean) ** 2, 0) / na) * Math.sqrt(252)
      trackingError = diffStd
      infoRatio = diffStd > 0 ? (diffMean * 252) / diffStd : null
      const denom = Math.sqrt(pVar * bVar)
      correlation = denom > 0 ? cov / denom : null
    }

    return { annRet, annVol, sharpe, sortino, calmar, downStd, maxDrawdown, maxDdDays, maxConsec, var95, skew, kurt, correlation, infoRatio, trackingError, alpha, beta }
  }, [normalizedData, normalizedBenchmarkData, annReturn, maxDrawdown])

  // Benchmark-side stats
  const benchmarkStats = useMemo(() => {
    const pts = normalizedBenchmarkData
    if (pts.length < 2) return null
    // daily returns from close prices
    const bRets: number[] = []
    for (let i = 1; i < pts.length; i++) {
      bRets.push(pts[i - 1].close > 0 ? pts[i].close / pts[i - 1].close - 1 : 0)
    }
    const n = bRets.length
    const first = pts[0].close, last = pts[pts.length - 1].close
    const years = pts.length / 252
    const annRet = Math.pow(last / first, 1 / years) - 1
    const mean = bRets.reduce((s, r) => s + r, 0) / n
    const variance = bRets.reduce((s, r) => s + (r - mean) ** 2, 0) / n
    const stdDev = Math.sqrt(variance)
    const annVol = stdDev * Math.sqrt(252)
    const sharpe = annVol > 0 ? annRet / annVol : null
    const downside = bRets.filter((r) => r < 0)
    const downStd = downside.length > 0
      ? Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / downside.length) * Math.sqrt(252)
      : 0
    const sortino = downStd > 0 ? annRet / downStd : null
    // max drawdown
    let peak = 1, maxDd = 0, maxDdEnd = 0, maxDdPeak = 0
    const navs = pts.map((p) => p.close / first)
    for (let i = 0; i < navs.length; i++) {
      if (navs[i] > peak) { peak = navs[i]; maxDdPeak = i }
      const dd = (peak - navs[i]) / peak
      if (dd > maxDd) { maxDd = dd; maxDdEnd = i }
    }
    const calmar = maxDd > 0 ? annRet / maxDd : null
    // drawdown recovery
    let maxDdDays = navs.length - maxDdEnd
    for (let i = maxDdEnd + 1; i < navs.length; i++) {
      if (navs[i] >= navs[maxDdPeak]) { maxDdDays = i - maxDdEnd; break }
    }
    // max consec days not making new high
    let maxConsec = 0, curConsec = 0, runPeak = 0
    for (const v of navs) {
      if (v > runPeak) { runPeak = v; curConsec = 0 } else { curConsec++; if (curConsec > maxConsec) maxConsec = curConsec }
    }
    // skew / kurt
    const skew = stdDev > 0 ? bRets.reduce((s, r) => s + ((r - mean) / stdDev) ** 3, 0) / n : null
    const kurt = stdDev > 0 ? bRets.reduce((s, r) => s + ((r - mean) / stdDev) ** 4, 0) / n - 3 : null
    return { annRet, annVol, sharpe, sortino, calmar, downStd, maxDd, maxDdDays, maxConsec, skew, kurt }
  }, [normalizedBenchmarkData])

  const benchmarkAnnRet = benchmarkStats?.annRet ?? null

  const summaryItems = [
    { label: "区间收益",   value: `${(totalReturn * 100).toFixed(2)}%`,                                                        valueClassName: getChinaMarketTextClass(totalReturn) },
    { label: "年化收益",   value: comparisonStats?.annRet != null ? `${(comparisonStats.annRet * 100).toFixed(2)}%` : "—",     valueClassName: comparisonStats?.annRet != null ? getChinaMarketTextClass(comparisonStats.annRet) : "" },
    { label: "年化波动率", value: comparisonStats ? `${(comparisonStats.annVol * 100).toFixed(2)}%` : "—" },
    { label: "夏普比率",   value: comparisonStats?.sharpe?.toFixed(3) ?? "—" },
    { label: "最大回撤",   value: `-${(maxDrawdown * 100).toFixed(2)}%`,                                                        valueClassName: "text-green-500" },
    { label: "交易天数",   value: `${tradingDays}` },
    { label: "盈利天数",   value: `${profitDays}`,                                                                              valueClassName: "text-red-500" },
    { label: "亏损天数",   value: `${lossDays}`,                                                                                valueClassName: "text-green-500" },
    { label: "胜率",       value: fmtPctPoints(winRate),                                                                        valueClassName: getChinaMarketTextClass(winRate) },
    { label: "盈亏指数",   value: profitFactor !== null ? profitFactor.toFixed(2) : "—" },
    { label: "日均换手率", value: avgTurnover !== null ? fmtPctPoints(avgTurnover) : "—" },
    { label: "索提诺比率", value: comparisonStats?.sortino?.toFixed(3) ?? "—" },
  ]

  // ── Drawdown series ───────────────────────────
  const fundDrawdownSeries = useMemo(() => {
    let peak = 1
    return normalizedData.map((p) => {
      if (p.navNorm > peak) peak = p.navNorm
      const dd = peak > 0 ? ((p.navNorm - peak) / peak) * 100 : 0
      return [p.date, Math.round(dd * 10000) / 10000] as [string, number]
    })
  }, [normalizedData])

  const benchmarkDrawdownSeries = useMemo(() => {
    if (normalizedBenchmarkData.length === 0) return []
    const base = normalizedBenchmarkData[0].close
    let peak = base
    return normalizedBenchmarkData.map((p) => {
      if (p.close > peak) peak = p.close
      const dd = peak > 0 ? ((p.close - peak) / peak) * 100 : 0
      return [p.date, Math.round(dd * 10000) / 10000] as [string, number]
    })
  }, [normalizedBenchmarkData])

  const drawdownOption = {
    animation: false,
    backgroundColor: "transparent",
    legend: {
      top: 4,
      right: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 6,
      textStyle: { fontSize: 11 },
      data: ["基金回撤", "南华商品指数回撤"],
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (params: unknown[]) => {
        const entries = params as Array<{ seriesName: string; value: [string, number] }>
        if (!entries[0]) return ""
        const date = entries[0].value[0]
        return entries.map((e) => {
          const color = e.seriesName === "基金回撤" ? getChinaMarketColor(-1) : "#f59e0b"
          return `<b>${date}</b><br/><span style="color:${color}">${e.seriesName}</span> ${e.value[1].toFixed(2)}%`
        }).join("<br/>")
      },
    },
    grid: { left: 60, right: 20, top: 40, bottom: 50 },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: fundDrawdownSeries.map((p) => p[0]),
      axisLabel: { rotate: 30, fontSize: 11, formatter: (v: string) => v.slice(0, 10) },
    },
    yAxis: {
      type: "value",
      name: "回撤(%)",
      nameTextStyle: { fontSize: 11, padding: [0, 0, 0, 40] },
      axisLabel: { fontSize: 11, formatter: (v: number) => v.toFixed(0) + "%" },
      splitLine: { lineStyle: { opacity: 0.3 } },
    },
    dataZoom: [
      { type: "slider", bottom: 4, height: 20 },
      { type: "inside" },
    ],
    series: [
      {
        name: "基金回撤",
        type: "line",
        data: fundDrawdownSeries,
        symbol: "none",
        lineStyle: { color: "#22c55e", width: 1.5 },
        itemStyle: { color: "#22c55e" },
        areaStyle: {
          color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: "rgba(34,197,94,0.05)" }, { offset: 1, color: "rgba(34,197,94,0.25)" }] },
        },
      },
      ...(showBenchmarkSeries && benchmarkDrawdownSeries.length > 0 ? [{
        name: "南华商品指数回撤",
        type: "line",
        data: benchmarkDrawdownSeries,
        symbol: "none",
        lineStyle: { color: "#f59e0b", width: 1.5, type: "dashed" as const },
        itemStyle: { color: "#f59e0b" },
      }] : []),
    ],
  }

  return (
  <>
    {/* ══ 产品要素 ══════════════════════════════════════════════════════ */}
    <div id="section-product" className="flex items-center gap-2 mb-3" style={{ scrollMarginTop: "3rem" }}>
      <h2 className="text-sm font-semibold whitespace-nowrap">产品要素</h2>
      <div className="h-px flex-1 bg-border" />
      <button
        onClick={() => setEditingProduct((v) => !v)}
        className="rounded border border-input bg-background px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
      >
        {editingProduct ? "完成" : "编辑"}
      </button>
    </div>
    <Card>
      <CardContent className="px-4 py-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-6 gap-y-4 text-xs">
          {/* 产品名称 */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">产品名称</span>
            {editingProduct ? (
              <input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="请输入"
                className="rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            ) : (
              <span className="px-2 py-1 font-medium">{productName || "—"}</span>
            )}
          </div>
          {/* 当前规模 — auto */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">当前规模(万)</span>
            <span className="px-2 py-1 font-medium tabular-nums">
              {lastPoint && lastPoint.cumCapital > 0 ? (lastPoint.cumCapital / 10000).toFixed(2) : "—"}
            </span>
          </div>
          {/* 开放日 */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">开放日</span>
            {editingProduct ? (
              <input
                value={openDate}
                onChange={(e) => setOpenDate(e.target.value)}
                placeholder="如：每月最后一个工作日"
                className="rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            ) : (
              <span className="px-2 py-1 font-medium">{openDate || "—"}</span>
            )}
          </div>
          {/* 份额分类 */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">份额分类</span>
            {editingProduct ? (
              <input
                value={shareClass}
                onChange={(e) => setShareClass(e.target.value)}
                placeholder="如：A类"
                className="rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            ) : (
              <span className="px-2 py-1 font-medium">{shareClass || "—"}</span>
            )}
          </div>
          {/* 费率结构 */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">费率结构</span>
            {editingProduct ? (
              <input
                value={feeStructure}
                onChange={(e) => setFeeStructure(e.target.value)}
                placeholder="如：管理费1%+业绩报酬20%"
                className="rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            ) : (
              <span className="px-2 py-1 font-medium">{feeStructure || "—"}</span>
            )}
          </div>
          {/* 赎回费 */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">赎回费</span>
            {editingProduct ? (
              <input
                value={redemptionFee}
                onChange={(e) => setRedemptionFee(e.target.value)}
                placeholder="如：持有1年以上免赎回费"
                className="rounded border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            ) : (
              <span className="px-2 py-1 font-medium">{redemptionFee || "—"}</span>
            )}
          </div>
          {/* 报告周期 — auto */}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground">报告周期</span>
            <span className="px-2 py-1 font-medium tabular-nums">
              {allData.length > 0 && lastPoint ? `${allData[0].date} ~ ${lastPoint.date}` : "—"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>

    {/* ══ 业绩指标 ══════════════════════════════════════════════════════ */}
    <div id="section-performance" className="mt-5 flex items-center gap-2 mb-3" style={{ scrollMarginTop: "3rem" }}>
      <h2 className="text-sm font-semibold whitespace-nowrap">业绩指标</h2>
      <div className="h-px flex-1 bg-border" />
    </div>

    <div className="grid grid-cols-2 gap-3">
      {/* 左：净值曲线 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">净值曲线</CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">基准</span>
                <select
                  value={showBenchmark ? "show" : "hide"}
                  onChange={(event) => setShowBenchmark(event.target.value === "show")}
                  className="rounded border border-input bg-background px-2 py-0.5 text-xs"
                >
                  <option value="show">显示 NHCI</option>
                  <option value="hide">隐藏 NHCI</option>
                </select>
              </div>
              <button
                onClick={load}
                disabled={loading}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                title="刷新"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          <div className="mt-1 flex flex-wrap gap-1">
            {QUICK_RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setRangeFrom(r.from())}
                className={`rounded border px-2 py-0.5 text-xs transition-colors ${
                  rangeFrom === r.from()
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {normalizedData.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
              <span>
                <span className="text-muted-foreground">累计收益 </span>
                <span className={getChinaMarketTextClass(totalReturn)}>{fmtPct(totalReturn)}</span>
              </span>
              {annReturn !== null && (
                <span>
                  <span className="text-muted-foreground">年化收益 </span>
                  <span className={getChinaMarketTextClass(annReturn)}>{fmtPct(annReturn)}</span>
                </span>
              )}
              <span>
                <span className="text-muted-foreground">最大回撤 </span>
                <span className="text-green-500">-{(maxDrawdown * 100).toFixed(2)}%</span>
              </span>
              <span>
                <span className="text-muted-foreground">最新净值 </span>
                <span>{fmtNav(lastPoint?.navNorm ?? 1)}</span>
              </span>
              {showBenchmarkSeries && benchmarkLastPoint && (
                <span>
                  <span className="text-muted-foreground">NHCI累计 </span>
                  <span className="text-amber-500">
                    {benchmarkLastPoint.returnPct >= 0 ? "+" : ""}
                    {benchmarkLastPoint.returnPct.toFixed(2)}%
                  </span>
                </span>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent className="pt-0">
          {error && <div className="py-4 text-center text-sm text-red-500">{error}</div>}
          {!error && allData.length === 0 && !loading && (
            <div className="py-4 text-center text-sm text-muted-foreground">
              暂无数据 — 请先导入基金交易记录及日报数据
            </div>
          )}
          {(allData.length > 0 || loading || loadingBenchmark) && (
            <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
          )}
        </CardContent>
      </Card>

      {/* 右：统计概览 + 净值明细 并排在同一个卡片内 */}
      <Card>
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-base">数据明细</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
            {/* 统计概览 */}
            <div>
              <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">统计概览</h4>
              <div className="overflow-hidden rounded-lg border">
                <table className="text-xs">
                  <tbody>
                    {summaryItems.map((item) => (
                      <tr key={item.label} className="border-b last:border-b-0">
                        <td className="whitespace-nowrap bg-muted/30 px-2 py-1.5 text-muted-foreground">{item.label}</td>
                        <td className={`whitespace-nowrap px-2 py-1.5 text-right font-medium ${item.valueClassName ?? ""}`}>{item.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 净值明细 */}
            <div className="min-w-0">
              <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">净值明细</h4>
              {normalizedData.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">暂无数据</div>
              ) : (
                <div className="overflow-auto rounded-lg border" style={{ maxHeight: `${summaryItems.length * 28 + (summaryItems.length - 1)}px` }}>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card shadow-sm">
                      <tr className="border-b text-left">
                        <th className="px-2 py-1.5 text-center font-medium">日期</th>
                        <th className="px-2 py-1.5 text-right font-medium">单位净值</th>
                        <th className="px-2 py-1.5 text-right font-medium">累计净值</th>
                        <th className="px-2 py-1.5 text-right font-medium">复权净值</th>
                        <th className="px-2 py-1.5 text-right font-medium">涨跌幅</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reversedData.map((point) => (
                        <tr key={point.date} className="border-b last:border-b-0">
                          <td className="whitespace-nowrap px-2 py-1 text-center">{point.date}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtNav(point.navNorm)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtNav(point.navNorm)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{fmtNav(point.navNorm)}</td>
                          <td className={`px-2 py-1 text-right tabular-nums ${getChinaMarketTextClass(point.dailyReturn)}`}>
                            {fmtPct(point.dailyReturn)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    {/* ── 回撤对比 / 对比统计 / 月度收益 ──────── */}
    {/* Row 1: 回撤对比 (left) + 对比统计 (right) — same height */}
    <div className="mt-3 grid grid-cols-2 items-stretch gap-3">
      {fundDrawdownSeries.length > 0 && (
        <Card className="flex flex-col">
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-sm">回撤对比</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col pt-0">
            <ReactECharts option={drawdownOption} style={{ flex: 1, minHeight: 260 }} notMerge lazyUpdate />
          </CardContent>
        </Card>
      )}

      {comparisonStats && (
        <Card>
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-sm">对比统计</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="w-[150px] px-2 py-1 text-left font-medium text-muted-foreground">指标</th>
                <th className="px-2 py-1 text-right font-medium">基金</th>
                <th className="px-2 py-1 text-right font-medium text-amber-500">南华商品指数</th>
                <th className="w-6" />
                <th className="w-[150px] px-2 py-1 text-left font-medium text-muted-foreground">指标</th>
                <th className="px-2 py-1 text-right font-medium">基金</th>
                <th className="px-2 py-1 text-right font-medium text-amber-500">南华商品指数</th>
              </tr>
            </thead>
            <tbody>
              {[
                [
                  { label: "区间收益",          fund: `${(totalReturn * 100).toFixed(2)}%`,                          bench: benchmarkLastPoint ? `${benchmarkLastPoint.returnPct.toFixed(2)}%` : "—" },
                  { label: "索提诺比率",         fund: comparisonStats.sortino?.toFixed(3) ?? "—",                    bench: benchmarkStats?.sortino?.toFixed(3) ?? "—" },
                ],
                [
                  { label: "年化收益",           fund: comparisonStats.annRet != null ? `${(comparisonStats.annRet * 100).toFixed(2)}%` : "—", bench: benchmarkAnnRet != null ? `${(benchmarkAnnRet * 100).toFixed(2)}%` : "—" },
                  { label: "相关系数",           fund: comparisonStats.correlation?.toFixed(4) ?? "—",                bench: "—" },
                ],
                [
                  { label: "年化波动率",         fund: `${(comparisonStats.annVol * 100).toFixed(2)}%`,               bench: benchmarkStats ? `${(benchmarkStats.annVol * 100).toFixed(2)}%` : "—" },
                  { label: "信息比率",           fund: comparisonStats.infoRatio?.toFixed(3) ?? "—",                  bench: "—" },
                ],
                [
                  { label: "夏普比率",           fund: comparisonStats.sharpe?.toFixed(3) ?? "—",                     bench: benchmarkStats?.sharpe?.toFixed(3) ?? "—" },
                  { label: "跟踪误差",           fund: comparisonStats.trackingError != null ? `${(comparisonStats.trackingError * 100).toFixed(2)}%` : "—", bench: "—" },
                ],
                [
                  { label: "卡玛比率",           fund: comparisonStats.calmar?.toFixed(3) ?? "—",                     bench: benchmarkStats?.calmar?.toFixed(3) ?? "—" },
                  { label: "Alpha",              fund: comparisonStats.alpha != null ? `${(comparisonStats.alpha * 100).toFixed(2)}%` : "—",   bench: "—" },
                ],
                [
                  { label: "下行风险",           fund: `${(comparisonStats.downStd * 100).toFixed(2)}%`,              bench: benchmarkStats ? `${(benchmarkStats.downStd * 100).toFixed(2)}%` : "—" },
                  { label: "Beta",               fund: comparisonStats.beta?.toFixed(4) ?? "—",                       bench: "—" },
                ],
                [
                  { label: "最大回撤",           fund: `-${(comparisonStats.maxDrawdown * 100).toFixed(2)}%`,         bench: benchmarkStats ? `-${(benchmarkStats.maxDd * 100).toFixed(2)}%` : "—" },
                  { label: "偏度",               fund: comparisonStats.skew?.toFixed(4) ?? "—",                       bench: benchmarkStats?.skew?.toFixed(4) ?? "—" },
                ],
                [
                  { label: "最大回撤回补期(天)",  fund: `${comparisonStats.maxDdDays}`,                               bench: benchmarkStats ? `${benchmarkStats.maxDdDays}` : "—" },
                  { label: "峰度",               fund: comparisonStats.kurt?.toFixed(4) ?? "—",                       bench: benchmarkStats?.kurt?.toFixed(4) ?? "—" },
                ],
                [
                  { label: "最长连续不创新高(天)", fund: `${comparisonStats.maxConsec}`,                              bench: benchmarkStats ? `${benchmarkStats.maxConsec}` : "—" },
                  { label: "卡玛比率(NHCI)",      fund: "—",                                                          bench: benchmarkStats?.calmar?.toFixed(3) ?? "—" },
                ],
              ].map((pair, i) => (
                <tr key={i} className="border-b last:border-b-0">
                  <td className="bg-muted/30 px-2 py-1 text-muted-foreground">{pair[0].label}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{pair[0].fund}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-amber-500">{pair[0].bench}</td>
                  <td />
                  <td className="bg-muted/30 px-2 py-1 text-muted-foreground">{pair[1].label}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{pair[1].fund}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-amber-500">{pair[1].bench}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
        </Card>
      )}
    </div>

    {/* Row 2: 月度收益 — full width */}
    {monthlyYears.length > 0 && (
      <Card className="mt-3">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-sm">月度收益</CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto px-3 pb-3 pt-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-muted-foreground">年份</th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} className="whitespace-nowrap px-2 py-1.5 text-right font-medium text-muted-foreground">{m}</th>
                ))}
                <th className="whitespace-nowrap px-2 py-1.5 text-right font-medium text-muted-foreground">全年</th>
              </tr>
            </thead>
            <tbody>
              {monthlyYears.map((year) => {
                const row = monthlyReturns[year] ?? {}
                return (
                  <tr key={year} className="border-b last:border-b-0">
                    <td className="whitespace-nowrap px-2 py-1.5 font-medium">{year}</td>
                    {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => {
                      const v = row[m]
                      return (
                        <td key={m} className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${v == null ? "text-muted-foreground" : getChinaMarketTextClass(v)}`}>
                          {v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`}
                        </td>
                      )
                    })}
                    <td className={`whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums ${row[0] == null ? "text-muted-foreground" : getChinaMarketTextClass(row[0]!)}`}>
                      {row[0] == null ? "—" : `${row[0] >= 0 ? "+" : ""}${(row[0] * 100).toFixed(2)}%`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    )}

    {/* ══ 波动分析 ══════════════════════════════════════════════════════ */}
    <div id="section-volatility" className="mt-5 flex items-center gap-2 mb-3" style={{ scrollMarginTop: "3rem" }}>
      <h2 className="text-sm font-semibold whitespace-nowrap">波动分析</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
    {normalizedData.length > 0 && (
      <div className="grid grid-cols-2 gap-3">
        <Card>
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-sm">每日收益率</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ReactECharts
            option={{
              animation: false,
              backgroundColor: "transparent",
              tooltip: {
                trigger: "axis",
                formatter: (params: unknown[]) => {
                  const p = (params as Array<{ value: [string, number] }>)[0]
                  if (!p) return ""
                  const pct = p.value[1]
                  return `${p.value[0]}<br/>${pct >= 0 ? "+" : ""}${(pct * 100).toFixed(3)}%`
                },
              },
              xAxis: {
                type: "time",
                axisLabel: { fontSize: 11 },
                splitLine: { show: false },
              },
              yAxis: {
                type: "value",
                axisLabel: {
                  fontSize: 11,
                  formatter: (v: number) => `${(v * 100).toFixed(1)}%`,
                },
                splitLine: { lineStyle: { type: "dashed", opacity: 0.4 } },
              },
              series: [
                {
                  name: "日收益率",
                  type: "bar",
                  data: normalizedData.map((p) => [p.date, p.dailyReturn]),
                  itemStyle: {
                    color: (params: { value: [string, number] }) =>
                      params.value[1] >= 0 ? "#ef4444" : "#22c55e",
                  },
                  barMaxWidth: 6,
                },
              ],
              dataZoom: [
                { type: "inside", start: 0, end: 100 },
                { type: "slider", height: 20, bottom: 0, start: 0, end: 100 },
              ],
              grid: { top: 12, right: 16, bottom: 48, left: 60 },
            }}
            style={{ height: 280 }}
            notMerge
            lazyUpdate
          />
        </CardContent>
        </Card>

        <Card>
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-sm">每日收益率分布</CardTitle>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowDistStats((v) => !v)}
              className="rounded border border-input bg-background px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              {showDistStats ? "图表" : "统计"}
            </button>
            {!showDistStats && (
              <select
                value={distFit}
                onChange={(e) => setDistFit(e.target.value as typeof distFit)}
                className="rounded border border-input bg-background px-2 py-0.5 text-xs"
              >
                <option value="normal">正态分布</option>
                <option value="t">t 分布</option>
                <option value="laplace">拉普拉斯分布</option>
                <option value="logistic">Logistic 分布</option>
                <option value="kde">核密度估计 (KDE)</option>
              </select>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {showDistStats ? (() => {
            const rets = normalizedData.map((p) => p.dailyReturn)
            const n = rets.length
            const mean = rets.reduce((s, r) => s + r, 0) / n
            const sorted = [...rets].sort((a, b) => a - b)
            const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / n
            const std = Math.sqrt(variance)
            const skew = std > 0 ? rets.reduce((s, r) => s + ((r - mean) / std) ** 3, 0) / n : 0
            const kurt = std > 0 ? rets.reduce((s, r) => s + ((r - mean) / std) ** 4, 0) / n - 3 : 0
            const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)]
            const pct = (q: number) => sorted[Math.min(Math.floor(q * n), n - 1)]
            const rows = [
              { label: "样本数",       value: `${n}` },
              { label: "均值",         value: `${mean >= 0 ? "+" : ""}${(mean * 100).toFixed(4)}%` },
              { label: "中位数",       value: `${median >= 0 ? "+" : ""}${(median * 100).toFixed(4)}%` },
              { label: "标准差",       value: `${(std * 100).toFixed(4)}%` },
              { label: "年化波动率",   value: `${(std * Math.sqrt(252) * 100).toFixed(2)}%` },
              { label: "偏度",         value: skew.toFixed(4) },
              { label: "峰度(超额)",   value: kurt.toFixed(4) },
              { label: "最小值",       value: `${(sorted[0] * 100).toFixed(4)}%` },
              { label: "1% 分位数",    value: `${(pct(0.01) * 100).toFixed(4)}%` },
              { label: "5% 分位数",    value: `${(pct(0.05) * 100).toFixed(4)}%` },
              { label: "25% 分位数",   value: `${(pct(0.25) * 100).toFixed(4)}%` },
              { label: "75% 分位数",   value: `${(pct(0.75) * 100).toFixed(4)}%` },
              { label: "95% 分位数",   value: `${(pct(0.95) * 100).toFixed(4)}%` },
              { label: "99% 分位数",   value: `${(pct(0.99) * 100).toFixed(4)}%` },
              { label: "最大值",       value: `${(sorted[n - 1] * 100).toFixed(4)}%` },
            ]
            return (
              <div className="overflow-auto rounded-lg border text-xs" style={{ height: 280 }}>
                <table className="w-full">
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label} className="border-b last:border-b-0">
                        <td className="bg-muted/30 px-3 py-1.5 text-muted-foreground whitespace-nowrap">{row.label}</td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })() : (
          <ReactECharts
            option={(() => {
              const rets = normalizedData.map((p) => p.dailyReturn)
              const n = rets.length
              const mean = rets.reduce((s, r) => s + r, 0) / n
              const std = Math.sqrt(rets.reduce((s, r) => s + (r - mean) ** 2, 0) / n)
              const min = Math.min(...rets)
              const max = Math.max(...rets)
              const binCount = 40
              const binWidth = (max - min) / binCount
              const bins: number[] = Array(binCount).fill(0)
              for (const r of rets) {
                const idx = Math.min(Math.floor((r - min) / binWidth), binCount - 1)
                bins[idx]++
              }
              const binData = bins.map((count, i) => {
                const center = min + (i + 0.5) * binWidth
                return { value: [center, count] as [number, number], center }
              })

              // Lanczos log-gamma for t-distribution
              function logGamma(z: number): number {
                const g = 7
                const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7]
                if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.abs(Math.sin(Math.PI * z))) - logGamma(1 - z)
                let zz = z - 1, x = c[0]
                for (let i = 1; i < g + 2; i++) x += c[i] / (zz + i)
                const t = zz + g + 0.5
                return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x)
              }

              const excessKurt = std > 0
                ? rets.reduce((s, r) => s + ((r - mean) / std) ** 4, 0) / n - 3
                : 0

              const curvePoints = 300
              const pad = (max - min) * 0.05
              const x0 = min - pad, x1 = max + pad
              const step = (x1 - x0) / curvePoints

              let fitLabel = "正态拟合"
              const curveData = Array.from({ length: curvePoints + 1 }, (_, i) => {
                const x = x0 + i * step
                let pdf = 0
                if (distFit === "normal") {
                  fitLabel = "正态拟合"
                  pdf = (1 / (std * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * ((x - mean) / std) ** 2)
                } else if (distFit === "t") {
                  fitLabel = "t 分布拟合"
                  const nu = Math.max(4.01, excessKurt > 0 ? 6 / excessKurt + 4 : 30)
                  const s = std * Math.sqrt((nu - 2) / nu)
                  const zt = (x - mean) / s
                  const logC = logGamma((nu + 1) / 2) - 0.5 * Math.log(nu * Math.PI) - logGamma(nu / 2)
                  pdf = Math.exp(logC - (nu + 1) / 2 * Math.log(1 + zt * zt / nu)) / s
                } else if (distFit === "laplace") {
                  fitLabel = "拉普拉斯拟合"
                  const b = rets.reduce((s, r) => s + Math.abs(r - mean), 0) / n
                  pdf = (1 / (2 * b)) * Math.exp(-Math.abs(x - mean) / b)
                } else if (distFit === "logistic") {
                  fitLabel = "Logistic 拟合"
                  const s = std * Math.sqrt(3) / Math.PI
                  const e = Math.exp(-(x - mean) / s)
                  pdf = e / (s * (1 + e) * (1 + e))
                } else if (distFit === "kde") {
                  fitLabel = "KDE"
                  const h = 1.06 * std * Math.pow(n, -0.2)
                  pdf = rets.reduce((s, r) => s + Math.exp(-0.5 * ((x - r) / h) ** 2), 0)
                       / (n * h * Math.sqrt(2 * Math.PI))
                }
                return [x, pdf * n * binWidth] as [number, number]
              })

              return {
                animation: false,
                backgroundColor: "transparent",
                legend: {
                  top: 4, right: 0,
                  icon: "roundRect",
                  itemWidth: 10, itemHeight: 6,
                  textStyle: { fontSize: 10 },
                  data: ["分布", fitLabel],
                },
                tooltip: {
                  trigger: "axis",
                  formatter: (params: unknown[]) => {
                    const entries = params as Array<{ seriesName: string; data: { value: [number, number] } | [number, number] }>
                    const bar = entries.find((e) => e.seriesName === "分布")
                    const line = entries.find((e) => e.seriesName === fitLabel)
                    const x = bar
                      ? (bar.data as { value: [number, number] }).value[0]
                      : (line?.data as [number, number])?.[0]
                    const xStr = x != null ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%` : ""
                    const countStr = bar ? `频次: ${(bar.data as { value: [number, number] }).value[1]}` : ""
                    const fitStr = line ? `${fitLabel}: ${((line.data as [number, number])[1]).toFixed(2)}` : ""
                    return [xStr, countStr, fitStr].filter(Boolean).join("<br/>")
                  },
                },
                xAxis: {
                  type: "value",
                  axisLabel: { fontSize: 11, formatter: (v: number) => `${(v * 100).toFixed(1)}%` },
                  splitLine: { show: false },
                },
                yAxis: {
                  type: "value",
                  name: "频次",
                  nameTextStyle: { fontSize: 10 },
                  axisLabel: { fontSize: 11 },
                  splitLine: { lineStyle: { type: "dashed", opacity: 0.4 } },
                },
                series: [
                  {
                    name: "分布",
                    type: "bar",
                    data: binData.map((d) => ({
                      value: d.value,
                      itemStyle: { color: d.center >= 0 ? "#ef444466" : "#22c55e66" },
                    })),
                    barWidth: "98%",
                  },
                  {
                    name: fitLabel,
                    type: "line",
                    data: curveData,
                    smooth: true,
                    symbol: "none",
                    lineStyle: { color: "#f59e0b", width: 2 },
                    itemStyle: { color: "#f59e0b" },
                    z: 10,
                  },
                ],
                grid: { top: 28, right: 16, bottom: 36, left: 52 },
              }
            })()}
            style={{ height: 280 }}
            notMerge
            lazyUpdate
          />
          )}
        </CardContent>
        </Card>
      </div>
    )}

    {/* ── 滚动波动率 + 滚动夏普 ────────────────────────── */}
    {normalizedData.length > volWindow && (
      <div className="mt-3 grid grid-cols-2 gap-3">
        {/* 滚动波动率 */}
        <Card>
          <CardHeader className="pb-2 pt-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{volWindow}日滚动波动率（年化）</CardTitle>
              <div className="flex gap-1">
                {([5, 10, 20] as const).map((w) => (
                  <button key={w} onClick={() => setVolWindow(w)}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                      volWindow === w ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"
                    }`}>{w}日</button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ReactECharts
              option={(() => {
                const WINDOW = volWindow
                const ANN = Math.sqrt(252)
                const fundVol: [string, number][] = []
                for (let i = WINDOW; i < normalizedData.length; i++) {
                  const slice = normalizedData.slice(i - WINDOW, i).map((p) => p.dailyReturn)
                  const mu = slice.reduce((s, r) => s + r, 0) / WINDOW
                  const vol = Math.sqrt(slice.reduce((s, r) => s + (r - mu) ** 2, 0) / (WINDOW - 1)) * ANN
                  fundVol.push([normalizedData[i].date, parseFloat((vol * 100).toFixed(4))])
                }
                const bmVol: [string, number][] = []
                if (normalizedBenchmarkData.length > WINDOW) {
                  for (let i = WINDOW; i < normalizedBenchmarkData.length; i++) {
                    const slice = normalizedBenchmarkData.slice(i - WINDOW, i + 1)
                    const bmRets = slice.slice(1).map((p, j) => (p.close - slice[j].close) / slice[j].close)
                    const mu = bmRets.reduce((s, r) => s + r, 0) / bmRets.length
                    const vol = Math.sqrt(bmRets.reduce((s, r) => s + (r - mu) ** 2, 0) / (bmRets.length - 1)) * ANN
                    bmVol.push([normalizedBenchmarkData[i].date, parseFloat((vol * 100).toFixed(4))])
                  }
                }
                return {
                  animation: false,
                  backgroundColor: "transparent",
                  legend: { top: 4, right: 72, icon: "roundRect", itemWidth: 10, itemHeight: 4, textStyle: { fontSize: 10 } },
                  tooltip: {
                    trigger: "axis",
                    formatter: (params: unknown[]) => {
                      const ps = params as Array<{ seriesName: string; value: [string, number]; marker: string }>
                      if (!ps.length) return ""
                      return [ps[0].value[0], ...ps.map((p) =>
                        p.seriesName === "波动比率" ? `${p.marker}${p.seriesName}: ${p.value[1].toFixed(3)}x` : `${p.marker}${p.seriesName}: ${p.value[1].toFixed(2)}%`
                      )].join("<br/>")
                    },
                  },
                  xAxis: { type: "time", axisLabel: { fontSize: 11 }, splitLine: { show: false } },
                  yAxis: [
                    { type: "value", name: "波动率", nameTextStyle: { fontSize: 10 }, axisLabel: { fontSize: 11, formatter: (v: number) => `${v.toFixed(0)}%` }, splitLine: { lineStyle: { type: "dashed", opacity: 0.4 } } },
                    { type: "value", name: "比率", nameTextStyle: { fontSize: 10 }, position: "right", axisLabel: { fontSize: 11, formatter: (v: number) => `${v.toFixed(1)}x` }, splitLine: { show: false } },
                  ],
                  series: [
                    { name: "产品", type: "line", yAxisIndex: 0, data: fundVol, smooth: false, symbol: "none", lineStyle: { color: "#ef4444", width: 1.5 }, itemStyle: { color: "#ef4444" }, areaStyle: { color: "#ef444422" } },
                    ...(bmVol.length > 0 ? [
                      { name: "南华商品", type: "line", yAxisIndex: 0, data: bmVol, smooth: false, symbol: "none", lineStyle: { color: "#60a5fa", width: 1.5 }, itemStyle: { color: "#60a5fa" }, areaStyle: { color: "#60a5fa22" } },
                      { name: "波动比率", type: "line", yAxisIndex: 1,
                        data: (() => { const m = new Map(bmVol.map(([d,v]) => [d,v])); return fundVol.filter(([d]) => m.has(d) && m.get(d)! > 0).map(([d,fv]) => [d, parseFloat((fv / m.get(d)!).toFixed(4))] as [string,number]) })(),
                        smooth: true, symbol: "none", lineStyle: { color: "#a78bfa", width: 1.5, type: "dashed" }, itemStyle: { color: "#a78bfa" } },
                    ] : []),
                  ],
                  dataZoom: [{ type: "inside", start: 0, end: 100 }, { type: "slider", height: 20, bottom: 0, start: 0, end: 100 }],
                  grid: { top: 28, right: 52, bottom: 48, left: 56 },
                }
              })()}
              style={{ height: 260 }} notMerge lazyUpdate
            />
          </CardContent>
        </Card>

        {/* 滚动夏普比率 */}
        {normalizedData.length > sharpeWindow && (
          <Card>
            <CardHeader className="pb-2 pt-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{sharpeWindow}日滚动夏普比率</CardTitle>
                <div className="flex gap-1">
                  {([20, 60, 120] as const).map((w) => (
                    <button key={w} onClick={() => setSharpeWindow(w)}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                        sharpeWindow === w ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"
                      }`}>{w}日</button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <ReactECharts
                option={(() => {
                  const W = sharpeWindow
                  const ANN = Math.sqrt(252)
                  const sharpeData: [string, number][] = []
                  for (let i = W; i < normalizedData.length; i++) {
                    const slice = normalizedData.slice(i - W, i).map((p) => p.dailyReturn)
                    const mu = slice.reduce((s, r) => s + r, 0) / W
                    const std = Math.sqrt(slice.reduce((s, r) => s + (r - mu) ** 2, 0) / (W - 1))
                    const sharpe = std > 0 ? (mu / std) * ANN : 0
                    sharpeData.push([normalizedData[i].date, parseFloat(sharpe.toFixed(4))])
                  }
                  const maxAbs = sharpeData.reduce((m, [, v]) => Math.max(m, Math.abs(v)), 0)
                  const yMax = Math.ceil(maxAbs * 1.1 * 10) / 10
                  return {
                    animation: false,
                    backgroundColor: "transparent",
                    tooltip: {
                      trigger: "axis",
                      formatter: (params: unknown[]) => {
                        const ps = params as Array<{ value: [string, number]; marker: string }>
                        if (!ps.length) return ""
                        return `${ps[0].value[0]}<br/>${ps[0].marker}夏普比率: ${ps[0].value[1].toFixed(3)}`
                      },
                    },
                    xAxis: { type: "time", axisLabel: { fontSize: 11 }, splitLine: { show: false } },
                    yAxis: { type: "value", min: -yMax, max: yMax, axisLabel: { fontSize: 11, formatter: (v: number) => v.toFixed(1) }, splitLine: { lineStyle: { type: "dashed", opacity: 0.4 } } },
                    series: [{ name: "夏普比率", type: "line", data: sharpeData, smooth: false, symbol: "none", lineStyle: { color: "#f59e0b", width: 1.5 }, itemStyle: { color: "#f59e0b" } }],
                    dataZoom: [{ type: "inside", start: 0, end: 100 }, { type: "slider", height: 20, bottom: 0, start: 0, end: 100 }],
                    grid: { top: 12, right: 16, bottom: 48, left: 52 },
                  }
                })()}
                style={{ height: 260 }} notMerge lazyUpdate
              />
            </CardContent>
          </Card>
        )}
      </div>
    )}

    {/* ── EWMA 加权夏普比率（抄底信号） ── */}
    {normalizedData.length > wSharpeSpan * 2 && (
      <div className="mt-3 grid grid-cols-2 gap-3">
      <Card>
        <CardHeader className="pb-2 pt-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">EWMA 加权夏普比率</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">绿色三角为 Sharpe 从下方穿越 −1.0 向上的反转信号（潜在抄底点）</p>
            </div>
            <div className="flex gap-1">
              {([10, 20, 60] as const).map((w) => (
                <button key={w} onClick={() => setWSharpeSpan(w)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    wSharpeSpan === w ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"
                  }`}>span {w}</button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <ReactECharts
            option={(() => {
              const alpha = 2 / (wSharpeSpan + 1)
              const ANN = Math.sqrt(252)
              const SIGNAL_THRESH = -1.0
              const wSharpeData: [string, number][] = []
              let ewMu = 0, ewVar = 0
              for (let i = 0; i < normalizedData.length; i++) {
                const r = normalizedData[i].dailyReturn
                const prevMu = ewMu
                ewMu = alpha * r + (1 - alpha) * ewMu
                ewVar = (1 - alpha) * ewVar + alpha * (r - prevMu) ** 2
                if (i >= wSharpeSpan) {
                  const s = ewVar > 0 ? (ewMu / Math.sqrt(ewVar)) * ANN : 0
                  wSharpeData.push([normalizedData[i].date, parseFloat(s.toFixed(4))])
                }
              }
              const signals: [string, number][] = []
              for (let i = 1; i < wSharpeData.length; i++) {
                if (wSharpeData[i - 1][1] < SIGNAL_THRESH && wSharpeData[i][1] >= SIGNAL_THRESH)
                  signals.push([wSharpeData[i][0], wSharpeData[i][1]])
              }
              const maxAbs = wSharpeData.reduce((m, [, v]) => Math.max(m, Math.abs(v)), 0)
              const yMax = Math.ceil(maxAbs * 1.1 * 10) / 10
              return {
                animation: false,
                backgroundColor: "transparent",
                legend: { top: 4, left: "center", icon: "roundRect", itemWidth: 10, itemHeight: 4, textStyle: { fontSize: 10 }, data: ["EWMA 夏普", "抄底信号"] },
                tooltip: {
                  trigger: "axis",
                  formatter: (params: unknown[]) => {
                    const ps = params as Array<{ seriesName: string; value: [string, number]; marker: string }>
                    const main = ps.find((p) => p.seriesName === "EWMA 夏普")
                    if (!main) return ""
                    const sig = ps.find((p) => p.seriesName === "抄底信号")
                    const lines = [`${main.value[0]}`, `${main.marker}EWMA 夏普: ${main.value[1].toFixed(3)}`]
                    if (sig) lines.push(`${sig.marker}抄底信号 ↑`)
                    return lines.join("<br/>")
                  },
                },
                xAxis: { type: "time", axisLabel: { fontSize: 11 }, splitLine: { show: false } },
                yAxis: { type: "value", min: -yMax, max: yMax, axisLabel: { fontSize: 11, formatter: (v: number) => v.toFixed(1) }, splitLine: { lineStyle: { type: "dashed", opacity: 0.4 } } },
                series: [
                  {
                    name: "EWMA 夏普",
                    type: "line",
                    data: wSharpeData,
                    smooth: false,
                    symbol: "none",
                    lineStyle: { color: "#f59e0b", width: 1.5 },
                    itemStyle: { color: "#f59e0b" },
                    markLine: {
                      silent: true, symbol: "none", label: { fontSize: 10 },
                      data: [
                        { yAxis: 0,    lineStyle: { color: "#888",    type: "solid",  width: 1   }, label: { formatter: "0",  position: "end" } },
                        { yAxis: 1.0,  lineStyle: { color: "#ef4444", type: "dashed", width: 0.8 }, label: { formatter: "+1", position: "end" } },
                        { yAxis: -1.0, lineStyle: { color: "#22c55e", type: "dashed", width: 0.8 }, label: { formatter: "-1", position: "end" } },
                      ],
                    },
                  },
                  {
                    name: "抄底信号",
                    type: "scatter",
                    data: signals.map(([d, v]) => ({ value: [d, v] })),
                    symbol: "triangle",
                    symbolSize: 10,
                    itemStyle: { color: "#22c55e" },
                  },
                ],
                dataZoom: [{ type: "inside", start: 0, end: 100 }, { type: "slider", height: 20, bottom: 0, start: 0, end: 100 }],
                grid: { top: 28, right: 56, bottom: 48, left: 52 },
              }
            })()}
            style={{ height: 260 }} notMerge lazyUpdate
          />
        </CardContent>
      </Card>

      {/* 持有窗口最大回撤 */}
      {normalizedData.length > 10 && (
        <Card>
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-sm">持有N日最大回撤分布</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">任意时点买入、持有 1–10 个交易日，历史最差回撤</p>
          </CardHeader>
          <CardContent className="pt-0">
            <ReactECharts
              option={(() => {
                const navs = normalizedData.map((p) => p.navNorm)
                const MAX_WINDOW = 10
                // For each window length w, scan all entry points and find worst drawdown
                const barData = Array.from({ length: MAX_WINDOW }, (_, w) => {
                  const days = w + 1
                  let worst = 0
                  for (let start = 0; start + days <= navs.length; start++) {
                    const entry = navs[start]
                    for (let k = 1; k < days; k++) {
                      const dd = (entry - navs[start + k]) / entry
                      if (dd > worst) worst = dd
                    }
                    // also check final day vs entry
                    const ddFinal = (entry - navs[start + days - 1]) / entry
                    if (ddFinal > worst) worst = ddFinal
                  }
                  return parseFloat((worst * 100).toFixed(3))
                })

                return {
                  animation: false,
                  backgroundColor: "transparent",
                  tooltip: {
                    trigger: "axis",
                    formatter: (params: unknown[]) => {
                      const ps = params as Array<{ value: number; dataIndex: number; marker: string }>
                      if (!ps.length) return ""
                      return `持有 ${ps[0].dataIndex + 1} 日<br/>${ps[0].marker}最大回撤: -${ps[0].value.toFixed(3)}%`
                    },
                  },
                  xAxis: {
                    type: "category",
                    data: Array.from({ length: MAX_WINDOW }, (_, i) => `${i + 1}日`),
                    axisLabel: { fontSize: 11 },
                    axisTick: { alignWithLabel: true },
                  },
                  yAxis: {
                    type: "value",
                    name: "最大回撤",
                    nameTextStyle: { fontSize: 10 },
                    axisLabel: { fontSize: 11, formatter: (v: number) => `-${v.toFixed(1)}%` },
                    splitLine: { lineStyle: { type: "dashed", opacity: 0.4 } },
                    inverse: false,
                  },
                  series: [
                    {
                      name: "最大回撤",
                      type: "bar",
                      data: barData.map((v) => ({
                        value: v,
                        itemStyle: { color: v > 3 ? "#ef4444" : v > 1.5 ? "#f97316" : "#22c55e" },
                      })),
                      label: {
                        show: true,
                        position: "top",
                        fontSize: 10,
                        formatter: (p: { value: number }) => `-${p.value.toFixed(2)}%`,
                      },
                      barMaxWidth: 36,
                    },
                  ],
                  grid: { top: 32, right: 16, bottom: 28, left: 60 },
                }
              })()}
              style={{ height: 260 }}
              notMerge
              lazyUpdate
            />
          </CardContent>
        </Card>
      )}
      </div>
    )}

    {/* ══ 分类盈亏 ═══════════════════════════════════════════════════ */}
    <div id="section-pnl" className="mt-5 flex items-center gap-2 mb-3" style={{ scrollMarginTop: "3rem" }}>
      <h2 className="text-sm font-semibold whitespace-nowrap">分类盈亏</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
    {loadingCategoryPnl && <p className="text-sm text-muted-foreground">加载中...</p>}
    {!loadingCategoryPnl && Object.keys(categoryPnlData).length > 0 && (() => {
      const CATS = [
        { key: "股指", color: "#ef4444" },
        { key: "国债", color: "#3b82f6" },
        { key: "商品", color: "#22c55e" },
        { key: "合计", color: "#f59e0b", lineType: "dashed" as const },
      ]
      const catOption = {
        tooltip: {
          trigger: "axis",
          formatter: (params: { seriesName: string; value: [string, number]; marker: string }[]) => {
            const date = params[0]?.value[0] ?? ""
            const lines = [...params]
              .sort((a, b) => Number(b.value[1]) - Number(a.value[1]))
              .map((p) => `${p.marker}${p.seriesName}: ${Number(p.value[1]).toLocaleString("zh-CN")} 元`)
            return [date, ...lines].join("<br/>")
          },
        },
        legend: { data: CATS.map((c) => c.key), top: 5, right: 10, selected: Object.fromEntries(CATS.map((c) => [c.key, catLineShowAll])) },
        grid: { left: 60, right: 20, top: 30, bottom: 50 },
        xAxis: { type: "time", boundaryGap: false },
        yAxis: {
          type: "value",
          name: "累计盈亏（元）",
          nameTextStyle: { color: "#888", fontSize: 11 },
          axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
        },
        dataZoom: [
          { type: "inside", start: 0, end: 100 },
          { type: "slider", height: 20, bottom: 10 },
        ],
        series: CATS.map((cat) => ({
          name: cat.key,
          type: "line",
          smooth: false,
          symbol: "none",
          lineStyle: { color: cat.color, width: cat.key === "合计" ? 2 : 1.5, type: cat.lineType ?? "solid" },
          itemStyle: { color: cat.color },
          data: (categoryPnlData[cat.key] ?? []).map((r) => [r.date, r.cumPnl]),
        })),
      }
      const barCatsSorted = [...CATS]
        .filter((cat) => cat.key !== "合计")
        .map((cat) => { const rows = categoryPnlData[cat.key] ?? []; return { key: cat.key, total: rows.length > 0 ? rows[rows.length - 1].cumPnl : 0 } })
        .sort((a, b) => b.total - a.total)
      const barOption = {
        tooltip: {
          trigger: "axis",
          formatter: (params: { seriesName: string; value: number; name: string }[]) =>
            params.map((p) => `${p.name}: ${Number(p.value).toLocaleString("zh-CN")} 元`).join("<br/>"),
        },
        grid: { left: 70, right: 20, top: 30, bottom: 30 },
        xAxis: {
          type: "category",
          data: barCatsSorted.map((c) => c.key),
          axisLabel: { fontSize: 12 },
        },
        yAxis: {
          type: "value",
          axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
        },
        series: [
          {
            type: "bar",
            data: barCatsSorted.map((item) => ({
              value: item.total,
              itemStyle: { color: item.total >= 0 ? "#ef4444" : "#22c55e" },
            })),
            label: {
              show: true,
              position: "top",
              formatter: (p: { value: number }) => (p.value / 10000).toFixed(1) + "万",
              fontSize: 10,
            },
          },
        ],
      }
      return (
        <div className="grid grid-cols-2 gap-3 mt-3">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">大类资产累计盈亏曲线</CardTitle>
            <button onClick={() => setCatLineShowAll((v) => !v)} className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted">{catLineShowAll ? "隐藏全部" : "显示全部"}</button>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ReactECharts option={catOption} style={{ height: 300 }} notMerge lazyUpdate />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">大类资产总盈亏</CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-2">
            <ReactECharts option={barOption} style={{ height: 300 }} notMerge lazyUpdate />
          </CardContent>
        </Card>
        </div>
      )
    })()}
    {!loadingCategoryPnl && Object.keys(sectorPnlData).length > 0 && (() => {
      const SECTOR_CAT: Record<string, "商品" | "股指" | "国债"> = {
        农产: "商品", 生鲜: "商品", 贵金属: "商品", 有色: "商品",
        新能源: "商品", 黑色: "商品", 能源化工: "商品", 航运: "商品",
        股指: "股指", 国债: "国债",
      }
      const ALL_SECTORS = [
        { key: "农产",    color: "#84cc16" },
        { key: "生鲜",    color: "#f97316" },
        { key: "贵金属",  color: "#eab308" },
        { key: "有色",    color: "#a855f7" },
        { key: "新能源",  color: "#10b981" },
        { key: "黑色",    color: "#78716c" },
        { key: "能源化工", color: "#06b6d4" },
        { key: "航运",    color: "#0ea5e9" },
        { key: "股指",    color: "#ef4444" },
        { key: "国债",    color: "#3b82f6" },
      ].filter((s) => (sectorPnlData[s.key] ?? []).length > 0)
      const SECTORS = sectorCatFilter === "全部"
        ? ALL_SECTORS
        : ALL_SECTORS.filter((s) => SECTOR_CAT[s.key] === sectorCatFilter)

      const sectorLineOption = {
        tooltip: {
          trigger: "axis",
          formatter: (params: { seriesName: string; value: [string, number]; marker: string }[]) => {
            const date = params[0]?.value[0] ?? ""
            const lines = [...params]
              .sort((a, b) => Number(b.value[1]) - Number(a.value[1]))
              .map((p) => `${p.marker}${p.seriesName}: ${Number(p.value[1]).toLocaleString("zh-CN")} 元`)
            return [date, ...lines].join("<br/>")
          },
        },
        legend: { data: SECTORS.map((s) => s.key), top: 5, right: 10, type: "scroll", selected: Object.fromEntries(SECTORS.map((s) => [s.key, sectorLineShowAll])) },
        grid: { left: 60, right: 20, top: 40, bottom: 30 },
        xAxis: { type: "time", boundaryGap: false },
        yAxis: {
          type: "value",
          name: "累计盈亏（元）",
          nameTextStyle: { color: "#888", fontSize: 11 },
          axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
        },
        dataZoom: [{ type: "inside", start: 0, end: 100 }],
        series: SECTORS.map((s) => ({
          name: s.key,
          type: "line",
          smooth: false,
          symbol: "none",
          lineStyle: { color: s.color, width: 1.5 },
          itemStyle: { color: s.color },
          data: (sectorPnlData[s.key] ?? []).map((r) => [r.date, r.cumPnl]),
        })),
      }

      const sectorBarSorted = [...SECTORS]
        .map((s) => { const rows = sectorPnlData[s.key] ?? []; return { key: s.key, total: rows.length > 0 ? rows[rows.length - 1].cumPnl : 0 } })
        .sort((a, b) => b.total - a.total)
      const sectorBarOption = {
        tooltip: {
          trigger: "axis",
          formatter: (params: { name: string; value: number }[]) =>
            params.map((p) => `${p.name}: ${Number(p.value).toLocaleString("zh-CN")} 元`).join("<br/>"),
        },
        grid: { left: 70, right: 20, top: 30, bottom: 60 },
        xAxis: {
          type: "category",
          data: sectorBarSorted.map((s) => s.key),
          axisLabel: { fontSize: 11, rotate: 30 },
        },
        yAxis: {
          type: "value",
          axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
        },
        series: [
          {
            type: "bar",
            data: sectorBarSorted.map((item) => ({ value: item.total, itemStyle: { color: item.total >= 0 ? "#ef4444" : "#22c55e" } })),
            label: {
              show: true,
              position: "top",
              formatter: (p: { value: number }) => (p.value / 10000).toFixed(1) + "万",
              fontSize: 10,
            },
          },
        ],
      }

      return (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">板块累计盈亏曲线</CardTitle>
              <div className="flex items-center gap-1">
                <select value={sectorCatFilter} onChange={(e) => setSectorCatFilter(e.target.value as typeof sectorCatFilter)} className="text-xs px-2 py-0.5 rounded border border-border bg-background hover:bg-muted">
                  <option value="全部">大类资产</option>
                  {(["商品", "股指", "国债"] as const).map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <button onClick={() => setSectorLineShowAll((v) => !v)} className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted ml-1">{sectorLineShowAll ? "隐藏全部" : "显示全部"}</button>
              </div>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <ReactECharts option={sectorLineOption} style={{ height: 300 }} notMerge lazyUpdate />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">板块总盈亏</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <ReactECharts option={sectorBarOption} style={{ height: 300 }} notMerge lazyUpdate />
            </CardContent>
          </Card>
        </div>
      )
    })()}
    {!loadingCategoryPnl && Object.keys(subSectorPnlData).length > 0 && (() => {
      const SUB_SECTOR_ORDER = [
        "谷物","油脂油料","软商品","林业","生鲜",
        "贵金属","有色","新能源",
        "原材","成材","煤炭","建材",
        "油品","聚酯","烯烃","芳烃","橡胶","盐化工","煤化工",
        "航运","股指","国债",
      ]
      // sub-sector → 板块
      const SUB_TO_SECTOR: Record<string, string> = {
        谷物: "农产", 油脂油料: "农产", 软商品: "农产", 林业: "农产",
        生鲜: "生鲜",
        贵金属: "贵金属",
        有色: "有色",
        新能源: "新能源",
        原材: "黑色", 成材: "黑色", 煤炭: "黑色", 建材: "黑色",
        油品: "能源化工", 聚酯: "能源化工", 烯烃: "能源化工", 芳烃: "能源化工",
        橡胶: "能源化工", 盐化工: "能源化工", 煤化工: "能源化工",
        航运: "航运",
        股指: "股指",
        国债: "国债",
      }
      // sub-sector → 大类资产
      const SUB_TO_CAT: Record<string, "商品" | "股指" | "国债"> = {
        谷物: "商品", 油脂油料: "商品", 软商品: "商品", 林业: "商品",
        生鲜: "商品", 贵金属: "商品", 有色: "商品", 新能源: "商品",
        原材: "商品", 成材: "商品", 煤炭: "商品", 建材: "商品",
        油品: "商品", 聚酯: "商品", 烯烃: "商品", 芳烃: "商品",
        橡胶: "商品", 盐化工: "商品", 煤化工: "商品",
        航运: "商品", 股指: "股指", 国债: "国债",
      }
      const SECTOR_OPTIONS = ["全部", "农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运", "股指", "国债"]
      const SUB_SECTOR_COLORS: Record<string, string> = {
        谷物: "#84cc16", 油脂油料: "#a3e635", 软商品: "#fbbf24", 林业: "#6ee7b7",
        生鲜: "#f97316", 贵金属: "#eab308", 有色: "#a855f7", 新能源: "#10b981",
        原材: "#78716c", 成材: "#a8a29e", 煤炭: "#57534e", 建材: "#d6d3d1",
        油品: "#06b6d4", 聚酯: "#0891b2", 烯烃: "#0e7490", 芳烃: "#155e75",
        橡胶: "#22d3ee", 盐化工: "#818cf8", 煤化工: "#6366f1",
        航运: "#0ea5e9", 股指: "#ef4444", 国债: "#3b82f6",
      }
      const SUBS = SUB_SECTOR_ORDER
        .filter((s) => (subSectorPnlData[s] ?? []).length > 0)
        .filter((s) => subCatFilter === "全部" || SUB_TO_CAT[s] === subCatFilter)
        .filter((s) => subSectorFilter === "全部" || SUB_TO_SECTOR[s] === subSectorFilter)
        .map((s) => ({ key: s, color: SUB_SECTOR_COLORS[s] ?? "#94a3b8" }))

      const subLineOption = {
        tooltip: {
          trigger: "axis",
          formatter: (params: { seriesName: string; value: [string, number]; marker: string }[]) => {
            const date = params[0]?.value[0] ?? ""
            const lines = [...params]
              .sort((a, b) => Number(b.value[1]) - Number(a.value[1]))
              .map((p) => `${p.marker}${p.seriesName}: ${Number(p.value[1]).toLocaleString("zh-CN")} 元`)
            return [date, ...lines].join("<br/>")
          },
        },
        legend: { data: SUBS.map((s) => s.key), top: 5, left: 70, right: 30, type: "scroll", itemWidth: 12, itemHeight: 8, itemGap: 8, textStyle: { fontSize: 10 }, selected: Object.fromEntries(SUBS.map((s) => [s.key, subLineShowAll])) },
        grid: { left: 60, right: 20, top: 65, bottom: 30 },
        xAxis: { type: "time", boundaryGap: false },
        yAxis: {
          type: "value",
          name: "累计盈亏（元）",
          nameTextStyle: { color: "#888", fontSize: 11 },
          axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
        },
        dataZoom: [{ type: "inside", start: 0, end: 100 }],
        series: SUBS.map((s) => ({
          name: s.key,
          type: "line",
          smooth: false,
          symbol: "none",
          lineStyle: { color: s.color, width: 1.5 },
          itemStyle: { color: s.color },
          data: (subSectorPnlData[s.key] ?? []).map((r) => [r.date, r.cumPnl]),
        })),
      }

      const subBarSorted = [...SUBS]
        .map((s) => { const rows = subSectorPnlData[s.key] ?? []; return { key: s.key, total: rows.length > 0 ? rows[rows.length - 1].cumPnl : 0 } })
        .sort((a, b) => b.total - a.total)
      const subBarOption = {
        tooltip: {
          trigger: "axis",
          formatter: (params: { name: string; value: number }[]) =>
            params.map((p) => `${p.name}: ${Number(p.value).toLocaleString("zh-CN")} 元`).join("<br/>"),
        },
        grid: { left: 70, right: 20, top: 30, bottom: 70 },
        xAxis: {
          type: "category",
          data: subBarSorted.map((s) => s.key),
          axisLabel: { fontSize: 10, rotate: 45 },
        },
        yAxis: {
          type: "value",
          axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
        },
        series: [
          {
            type: "bar",
            data: subBarSorted.map((item) => ({ value: item.total, itemStyle: { color: item.total >= 0 ? "#ef4444" : "#22c55e" } })),
            label: {
              show: true,
              position: "top",
              rotate: 45,
              formatter: (p: { value: number }) => (p.value / 10000).toFixed(1) + "万",
              fontSize: 10,
            },
          },
        ],
      }

      return (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">细分板块累计盈亏曲线</CardTitle>
              <div className="flex items-center gap-1">
                <select value={subCatFilter} onChange={(e) => { setSubCatFilter(e.target.value as typeof subCatFilter); setSubSectorFilter("全部") }} className="text-xs px-2 py-0.5 rounded border border-border bg-background hover:bg-muted">
                  <option value="全部">大类资产</option>
                  {(["商品", "股指", "国债"] as const).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={subSectorFilter} onChange={(e) => setSubSectorFilter(e.target.value)} className="text-xs px-2 py-0.5 rounded border border-border bg-background hover:bg-muted">
                  {SECTOR_OPTIONS.filter((s) => s === "全部" || subCatFilter === "全部" || (s !== "股指" && s !== "国债" ? subCatFilter === "商品" : subCatFilter === s)).map((s) => <option key={s} value={s}>{s === "全部" ? "板块" : s}</option>)}
                </select>
                <button onClick={() => setSubLineShowAll((v) => !v)} className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted ml-1">{subLineShowAll ? "隐藏全部" : "显示全部"}</button>
              </div>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <ReactECharts option={subLineOption} style={{ height: 300 }} notMerge lazyUpdate />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">细分板块总盈亏</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <ReactECharts option={subBarOption} style={{ height: 300 }} notMerge lazyUpdate />
            </CardContent>
          </Card>
        </div>
      )
    })()}
    {!loadingCategoryPnl && Object.keys(productPnlData).length > 0 && (() => {
      const PROD_NAMES: Record<string, string> = {
        C:"玉米",CS:"淀粉",WH:"强麦",PM:"普麦",RR:"粳米",RI:"早籼稻",JR:"粳稻",LR:"晚籼稻",
        A:"黄大豆1号",B:"黄大豆2号",M:"豆粕",Y:"豆油",RM:"菜籽粕",OI:"菜籽油",RS:"油菜籽",PK:"花生",P:"棕榈油",
        SR:"白糖",CF:"棉花",CY:"棉纱",LG:"原木",SP:"纸浆",OP:"双胶纸",
        AP:"苹果",CJ:"红枣",LH:"生猪",JD:"鸡蛋",
        AU:"黄金",AG:"白银",PT:"铂",PD:"钯",
        CU:"沪铜",BC:"国际铜",AL:"沪铝",AO:"氧化铝",AD:"铝合金",ZN:"沪锌",PB:"沪铅",NI:"沪镍",SN:"沪锡",
        LC:"碳酸锂",PS:"多晶硅",SI:"工业硅",
        I:"铁矿石",SF:"硅铁",SM:"锰硅",RB:"螺纹钢",HC:"热卷",SS:"不锈钢",WR:"线材",
        JM:"焦煤",J:"煤炭",ZC:"动力煤",FG:"玻璃",BB:"胶合板",FB:"纤维板",
        SC:"原油",FU:"燃料油",LU:"低硫燃料油",PG:"液化石油气",BU:"沥青",
        TA:"PTA",EG:"乙二醇",PF:"短纤",PR:"瓶片",PL:"丙烯",PP:"聚丙烯",L:"塑料",
        BZ:"纯苯",PX:"对二甲苯",EB:"苯乙烯",
        RU:"天然橡胶",BR:"丁二烯橡胶",NR:"20号胶",
        SA:"纯碱",SH:"烧碱",V:"PVC",UR:"尿素",MA:"甲醇",
        EC:"航运指数",
        IH:"上证50",IF:"沪深300",IC:"中证500",IM:"中证1000",MO:"中证1000期权",
        TS:"2年期国债",TF:"5年期国债",T:"10年期国债",TL:"30年期国债",
      }
      // Sort products by absolute total PnL descending so the most impactful are first
      // Prod → category / sector / sub-sector lookup
      const PROD_CAT: Record<string, string> = {
        C:"商品",CS:"商品",WH:"商品",PM:"商品",RR:"商品",RI:"商品",JR:"商品",LR:"商品",
        A:"商品",B:"商品",M:"商品",Y:"商品",RM:"商品",OI:"商品",RS:"商品",PK:"商品",P:"商品",
        SR:"商品",CF:"商品",CY:"商品",LG:"商品",SP:"商品",OP:"商品",
        AP:"商品",CJ:"商品",LH:"商品",JD:"商品",
        AU:"商品",AG:"商品",PT:"商品",PD:"商品",
        CU:"商品",BC:"商品",AL:"商品",AO:"商品",AD:"商品",ZN:"商品",PB:"商品",NI:"商品",SN:"商品",
        LC:"商品",PS:"商品",SI:"商品",
        I:"商品",SF:"商品",SM:"商品",RB:"商品",HC:"商品",SS:"商品",WR:"商品",
        JM:"商品",J:"商品",ZC:"商品",FG:"商品",BB:"商品",FB:"商品",
        SC:"商品",FU:"商品",LU:"商品",PG:"商品",BU:"商品",
        TA:"商品",EG:"商品",PF:"商品",PR:"商品",PL:"商品",PP:"商品",L:"商品",
        BZ:"商品",PX:"商品",EB:"商品",
        RU:"商品",BR:"商品",NR:"商品",
        SA:"商品",SH:"商品",V:"商品",UR:"商品",MA:"商品",
        EC:"商品",
        IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
        TS:"国债",TF:"国债",T:"国债",TL:"国债",
      }
      const PROD_SECTOR: Record<string, string> = {
        C:"农产",CS:"农产",WH:"农产",PM:"农产",RR:"农产",RI:"农产",JR:"农产",LR:"农产",
        A:"农产",B:"农产",M:"农产",Y:"农产",RM:"农产",OI:"农产",RS:"农产",PK:"农产",P:"农产",
        SR:"农产",CF:"农产",CY:"农产",LG:"农产",SP:"农产",OP:"农产",
        AP:"生鲜",CJ:"生鲜",LH:"生鲜",JD:"生鲜",
        AU:"贵金属",AG:"贵金属",PT:"贵金属",PD:"贵金属",
        CU:"有色",BC:"有色",AL:"有色",AO:"有色",AD:"有色",ZN:"有色",PB:"有色",NI:"有色",SN:"有色",
        LC:"新能源",PS:"新能源",SI:"新能源",
        I:"黑色",SF:"黑色",SM:"黑色",RB:"黑色",HC:"黑色",SS:"黑色",WR:"黑色",
        JM:"黑色",J:"黑色",ZC:"黑色",FG:"黑色",BB:"黑色",FB:"黑色",
        SC:"能源化工",FU:"能源化工",LU:"能源化工",PG:"能源化工",BU:"能源化工",
        TA:"能源化工",EG:"能源化工",PF:"能源化工",PR:"能源化工",PL:"能源化工",PP:"能源化工",L:"能源化工",
        BZ:"能源化工",PX:"能源化工",EB:"能源化工",
        RU:"能源化工",BR:"能源化工",NR:"能源化工",
        SA:"能源化工",SH:"能源化工",V:"能源化工",UR:"能源化工",MA:"能源化工",
        EC:"航运",
        IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
        TS:"国债",TF:"国债",T:"国债",TL:"国债",
      }
      const PROD_SUB_SECTOR: Record<string, string> = {
        C:"谷物",CS:"谷物",WH:"谷物",PM:"谷物",RR:"谷物",RI:"谷物",JR:"谷物",LR:"谷物",
        A:"油脂油料",B:"油脂油料",M:"油脂油料",Y:"油脂油料",RM:"油脂油料",OI:"油脂油料",RS:"油脂油料",PK:"油脂油料",P:"油脂油料",
        SR:"软商品",CF:"软商品",CY:"软商品",
        LG:"林业",SP:"林业",OP:"林业",
        AP:"生鲜",CJ:"生鲜",LH:"生鲜",JD:"生鲜",
        AU:"贵金属",AG:"贵金属",PT:"贵金属",PD:"贵金属",
        CU:"有色",BC:"有色",AL:"有色",AO:"有色",AD:"有色",ZN:"有色",PB:"有色",NI:"有色",SN:"有色",
        LC:"新能源",PS:"新能源",SI:"新能源",
        I:"原材",SF:"原材",SM:"原材",
        RB:"成材",HC:"成材",SS:"成材",WR:"成材",
        JM:"煤炭",J:"煤炭",ZC:"煤炭",
        FG:"建材",BB:"建材",FB:"建材",
        SC:"油品",FU:"油品",LU:"油品",PG:"油品",BU:"油品",
        TA:"聚酯",EG:"聚酯",PF:"聚酯",PR:"聚酯",
        PL:"烯烃",PP:"烯烃",L:"烯烃",
        BZ:"芳烃",PX:"芳烃",EB:"芳烃",
        RU:"橡胶",BR:"橡胶",NR:"橡胶",
        SA:"盐化工",SH:"盐化工",V:"盐化工",
        UR:"煤化工",MA:"煤化工",
        EC:"航运",
        IH:"股指",IF:"股指",IC:"股指",IM:"股指",MO:"股指",
        TS:"国债",TF:"国债",T:"国债",TL:"国债",
      }
      // Build available sector/sub-sector options based on current filters
      const availableSectors = ["全部", ...Array.from(new Set(Object.values(PROD_SECTOR))).filter(
        (s) => prodCatFilter === "全部" || Object.entries(PROD_SECTOR).some(([k, v]) => v === s && PROD_CAT[k] === prodCatFilter)
      )]
      const availableSubSectors = ["全部", ...Array.from(new Set(Object.values(PROD_SUB_SECTOR))).filter(
        (ss) => {
          return Object.entries(PROD_SUB_SECTOR).some(([k, v]) => v === ss &&
            (prodCatFilter === "全部" || PROD_CAT[k] === prodCatFilter) &&
            (prodSectorFilter === "全部" || PROD_SECTOR[k] === prodSectorFilter)
          )
        }
      )]
      const PRODS = Object.keys(productPnlData)
        .map((key) => {
          const rows = productPnlData[key]
          const total = rows.length > 0 ? rows[rows.length - 1].cumPnl : 0
          return { key, total }
        })
        .filter((p) => prodCatFilter === "全部" || PROD_CAT[p.key] === prodCatFilter)
        .filter((p) => prodSectorFilter === "全部" || PROD_SECTOR[p.key] === prodSectorFilter)
        .filter((p) => prodSubSectorFilter === "全部" || PROD_SUB_SECTOR[p.key] === prodSubSectorFilter)
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))

      // Generate a color palette by evenly spacing hues
      const prodColors = PRODS.map((_, i) => `hsl(${Math.round((i / PRODS.length) * 360)}, 65%, 50%)`)

      const prodLineOption = {
        tooltip: {
          trigger: "axis",
          formatter: (params: { seriesName: string; value: [string, number]; marker: string }[]) => {
            const date = params[0]?.value[0] ?? ""
            const lines = params
              .filter((p) => p.value[1] !== 0)
              .sort((a, b) => Number(b.value[1]) - Number(a.value[1]))
              .slice(0, 10)
              .map((p) => { const cn = PROD_NAMES[p.seriesName]; const label = cn ? `${p.seriesName}（${cn}）` : p.seriesName; return `${p.marker}${label}: ${Number(p.value[1]).toLocaleString("zh-CN")} 元` })
            return [date, ...lines].join("<br/>")
          },
        },
        legend: { data: PRODS.map((p) => p.key), top: 5, left: 70, right: 30, type: "scroll", itemWidth: 12, itemHeight: 8, itemGap: 8, textStyle: { fontSize: 10 }, selected: Object.fromEntries(PRODS.map((p) => [p.key, prodLineShowAll])) },
        grid: { left: 60, right: 20, top: 65, bottom: 30 },
        xAxis: { type: "time", boundaryGap: false },
        yAxis: {
          type: "value",
          name: "累计盈亏（元）",
          nameTextStyle: { color: "#888", fontSize: 11 },
          axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
        },
        dataZoom: [{ type: "inside", start: 0, end: 100 }],
        series: PRODS.map((p, i) => ({
          name: p.key,
          type: "line",
          smooth: false,
          symbol: "none",
          lineStyle: { color: prodColors[i], width: 1.5 },
          itemStyle: { color: prodColors[i] },
          data: (productPnlData[p.key] ?? []).map((r) => [r.date, r.cumPnl]),
        })),
      }

      const prodBarOption = {
        tooltip: {
          trigger: "axis",
          formatter: (params: { name: string; value: number }[]) =>
            params.map((p) => {
              const cn = PROD_NAMES[p.name]
              const label = cn ? `${p.name}（${cn}）` : p.name
              return `${label}: ${Number(p.value).toLocaleString("zh-CN")} 元`
            }).join("<br/>"),
        },
        grid: { left: 55, right: 10, top: 10, bottom: 50 },
        xAxis: {
          type: "category",
          data: [...PRODS].sort((a, b) => b.total - a.total).map((p) => p.key),
          axisLabel: { fontSize: 10, rotate: 45 },
        },
        yAxis: {
          type: "value",
          axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + "万" },
        },
        series: [
          {
            type: "bar",
            data: [...PRODS].sort((a, b) => b.total - a.total).map((p) => ({
              value: p.total,
              itemStyle: { color: p.total >= 0 ? "#ef4444" : "#22c55e" },
            })),
            label: { show: false },
          },
        ],
      }

      return (
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">品种累计盈亏曲线</CardTitle>
              <div className="flex items-center gap-1">
                <select value={prodCatFilter} onChange={(e) => { setProdCatFilter(e.target.value); setProdSectorFilter("全部"); setProdSubSectorFilter("全部") }} className="text-xs px-2 py-0.5 rounded border border-border bg-background hover:bg-muted">
                  <option value="全部">大类资产</option>
                  {["商品","股指","国债"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={prodSectorFilter} onChange={(e) => { setProdSectorFilter(e.target.value); setProdSubSectorFilter("全部") }} className="text-xs px-2 py-0.5 rounded border border-border bg-background hover:bg-muted">
                  {availableSectors.map((s) => <option key={s} value={s}>{s === "全部" ? "板块" : s}</option>)}
                </select>
                <select value={prodSubSectorFilter} onChange={(e) => setProdSubSectorFilter(e.target.value)} className="text-xs px-2 py-0.5 rounded border border-border bg-background hover:bg-muted">
                  {availableSubSectors.map((s) => <option key={s} value={s}>{s === "全部" ? "细分板块" : s}</option>)}
                </select>
                <button onClick={() => setProdLineShowAll((v) => !v)} className="text-xs px-2 py-0.5 rounded border border-border hover:bg-muted ml-1">{prodLineShowAll ? "隐藏全部" : "显示全部"}</button>
              </div>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <ReactECharts option={prodLineOption} style={{ height: 420 }} notMerge lazyUpdate />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">品种总盈亏</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-2">
              <ReactECharts option={prodBarOption} style={{ height: 420 }} notMerge lazyUpdate />
            </CardContent>
          </Card>
        </div>
      )
    })()}
  </>
  )
}
