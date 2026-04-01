"use client"


import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { useEffect, useState } from "react"
import ReactECharts from "echarts-for-react"
import { MoreVertical } from "lucide-react"

// Removed placeholder commodity and futures charts

type LinePoint = { date: string; close: number | null }
type SectorIndexSeries = { code: string; name: string; data: LinePoint[] }
type FuturesVolCorrScatterPoint = {
  code: string
  label: string
  volatility: number
  correlation: number
  observations: number
  latest_date: string
}

export default function FuturesMarketPage() {
  const [nhci, setNhci] = useState<Array<{ date: string; close: number }>>([])
  const [loadingNhci, setLoadingNhci] = useState(true)
  const [errorNhci, setErrorNhci] = useState<string | null>(null)
  const [sectorIndices, setSectorIndices] = useState<SectorIndexSeries[]>([])
  const [loadingSectorIndices, setLoadingSectorIndices] = useState(true)
  const [errorSectorIndices, setErrorSectorIndices] = useState<string | null>(null)
  const [futuresVolCorrScatter, setFuturesVolCorrScatter] = useState<{
    as_of: string
    volWindow: string
    corrWindow: string
    benchmark: string
    points: FuturesVolCorrScatterPoint[]
  } | null>(null)
  const [loadingFuturesVolCorrScatter, setLoadingFuturesVolCorrScatter] = useState(true)
  const [errorFuturesVolCorrScatter, setErrorFuturesVolCorrScatter] = useState<string | null>(null)
  const [volWindowOpt, setVolWindowOpt] = useState("20d")
  const [corrWindowOpt, setCorrWindowOpt] = useState("20d")

  const [indexRange, setIndexRange] = useState<"1m" | "3m" | "6m" | "1y">("1y")
  const getIndexCutoff = (range: "1m" | "3m" | "6m" | "1y"): string => {
    const d = new Date()
    if (range === "1m") d.setMonth(d.getMonth() - 1)
    else if (range === "3m") d.setMonth(d.getMonth() - 3)
    else if (range === "6m") d.setMonth(d.getMonth() - 6)
    else d.setFullYear(d.getFullYear() - 1)
    return d.toISOString().slice(0, 10)
  }

  const [futLatest, setFutLatest] = useState<Record<string, {
    trade_date: string;
    close: number | null;
    settle: number | null;
    settle_return: number | null;
    source: string;
    near_ts_code?: string | null;
    near_close?: number | null;
    near_settle?: number | null;
    near_settle_return?: number | null;
    far_ts_code?: string | null;
    far_close?: number | null;
    far_settle?: number | null;
    far_settle_return?: number | null;
  }>>({})
  const [loadingFut, setLoadingFut] = useState(true)
  const [errorFut, setErrorFut] = useState<string | null>(null)

  const [basisFar, setBasisFar] = useState<Record<string, { annualized_basis_pct: number | null; trade_date: string; spot_close: number | null; far_close: number | null }>>({})
  const [loadingBasis, setLoadingBasis] = useState(true)
  const [errorBasis, setErrorBasis] = useState<string | null>(null)
  const [basisNear, setBasisNear] = useState<Record<string, { annualized_basis_pct: number | null; trade_date: string; spot_close: number | null; near_settle: number | null }>>({})
  const [loadingBasisNear, setLoadingBasisNear] = useState(true)
  const [errorBasisNear, setErrorBasisNear] = useState<string | null>(null)
  const [basisTs, setBasisTs] = useState<{ start_date: string; end_date: string; data: Record<string, Array<{ date: string; annualized_basis_pct: number | null }>> } | null>(null)
  const [loadingBasisTs, setLoadingBasisTs] = useState(true)
  const [errorBasisTs, setErrorBasisTs] = useState<string | null>(null)
  const [basisDiffTs, setBasisDiffTs] = useState<{ start_date: string; end_date: string; data: Record<string, Array<{ date: string; basis_diff: number | null }>> } | null>(null)
  const [loadingBasisDiffTs, setLoadingBasisDiffTs] = useState(true)
  const [errorBasisDiffTs, setErrorBasisDiffTs] = useState<string | null>(null)
  const [basisNearTs, setBasisNearTs] = useState<{ start_date: string; end_date: string; data: Record<string, Array<{ date: string; annualized_basis_pct: number | null }>> } | null>(null)
  const [loadingBasisNearTs, setLoadingBasisNearTs] = useState(true)
  const [errorBasisNearTs, setErrorBasisNearTs] = useState<string | null>(null)
  const [basisNearDiffTs, setBasisNearDiffTs] = useState<{ start_date: string; end_date: string; data: Record<string, Array<{ date: string; basis_diff: number | null }>> } | null>(null)
  const [loadingBasisNearDiffTs, setLoadingBasisNearDiffTs] = useState(true)
  const [errorBasisNearDiffTs, setErrorBasisNearDiffTs] = useState<string | null>(null)
  const [basisContDiffTs, setBasisContDiffTs] = useState<{ start_date: string; end_date: string; data: Record<string, Record<string, Array<{ date: string; basis_diff: number | null }>>> } | null>(null)
  const [loadingBasisContDiffTs, setLoadingBasisContDiffTs] = useState(true)
  const [errorBasisContDiffTs, setErrorBasisContDiffTs] = useState<string | null>(null)
  const [selectedCode, setSelectedCode] = useState<"IH" | "IF" | "IC" | "IM">("IF")
  const [showFar, setShowFar] = useState(true)
  const [choiceHeatmap, setChoiceHeatmap] = useState<{ trade_date: string; total_amount: number; data: Array<{ name: string; children: Array<{ name: string; value: number; ret: number | null }> }> } | null>(null)
  const [loadingChoiceHeatmap, setLoadingChoiceHeatmap] = useState(true)
  const [errorChoiceHeatmap, setErrorChoiceHeatmap] = useState<string | null>(null)

  const q = (force: boolean) => (force ? `?force=1&_=${Date.now()}` : "")

  // localStorage cache helpers: save on success, restore on fetch failure
  const LS_PREFIX = "fm_cache_"
  const lsSave = (key: string, data: unknown) => { try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(data)) } catch {} }
  const lsLoad = (key: string) => { try { const v = localStorage.getItem(LS_PREFIX + key); return v ? JSON.parse(v) : null } catch { return null } }

  const reloadNhci = async (force = false) => {
    setLoadingNhci(true)
    setErrorNhci(null)
    try {
      const res = await fetch(`/ma/api/nanhua${q(force)}`, force ? { cache: "no-store" } : undefined)
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
        setNhci(json.data)
        lsSave("nhci", json.data)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad("nhci")
      if (cached) setNhci(cached)
      else setErrorNhci("数据不可用")
    } finally {
      setLoadingNhci(false)
    }
  }

  const reloadSectorIndices = async (force = false) => {
    setLoadingSectorIndices(true)
    setErrorSectorIndices(null)
    try {
      const res = await fetch(`/ma/api/nanhua-sector-indices${q(force)}`, force ? { cache: "no-store" } : undefined)
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.series && Array.isArray(json.series) && json.series.length > 0) {
        setSectorIndices(json.series)
        lsSave("sectorIndices", json.series)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad("sectorIndices")
      if (cached) setSectorIndices(cached)
      else setErrorSectorIndices("数据不可用")
    } finally {
      setLoadingSectorIndices(false)
    }
  }

  const reloadFuturesVolCorrScatter = async (force = false, vw = volWindowOpt, cw = corrWindowOpt) => {
    setLoadingFuturesVolCorrScatter(true)
    setErrorFuturesVolCorrScatter(null)
    try {
      const sep = force ? "?force=1&" : "?"
      const res = await fetch(
        `/ma/api/futures/vol-corr-scatter${sep}volWindow=${vw}&corrWindow=${cw}`,
        force ? { cache: "no-store" } : undefined,
      )
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.points && Array.isArray(json.points) && json.points.length > 0) {
        const value = {
          as_of: json.as_of,
          volWindow: json.volWindow,
          corrWindow: json.corrWindow,
          benchmark: json.benchmark,
          points: json.points,
        }
        setFuturesVolCorrScatter(value)
        lsSave(`futuresVolCorrScatter_${vw}_${cw}`, value)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad(`futuresVolCorrScatter_${vw}_${cw}`)
      if (cached) setFuturesVolCorrScatter(cached)
      else setErrorFuturesVolCorrScatter("数据不可用")
    } finally {
      setLoadingFuturesVolCorrScatter(false)
    }
  }

  const reloadBasisFar = async (force = false) => {
    setLoadingBasis(true)
    setErrorBasis(null)
    try {
      const res = await fetch(`/ma/api/basis/far${q(force)}`, force ? { cache: "no-store" } : undefined)
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.data && typeof json.data === "object") {
        setBasisFar(json.data)
        lsSave("basisFar", json.data)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad("basisFar")
      if (cached) setBasisFar(cached)
      else setErrorBasis("数据不可用")
    } finally {
      setLoadingBasis(false)
    }
  }

  const reloadBasisNear = async (force = false) => {
    setLoadingBasisNear(true)
    setErrorBasisNear(null)
    try {
      const res = await fetch(`/ma/api/basis/near${q(force)}`, force ? { cache: "no-store" } : undefined)
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.data && typeof json.data === "object") {
        setBasisNear(json.data)
        lsSave("basisNear", json.data)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad("basisNear")
      if (cached) setBasisNear(cached)
      else setErrorBasisNear("数据不可用")
    } finally {
      setLoadingBasisNear(false)
    }
  }

  const reloadBasisTs = async (force = false) => {
    setLoadingBasisTs(true)
    setErrorBasisTs(null)
    try {
      const res = await fetch(`/ma/api/basis/timeseries${q(force)}`, force ? { cache: "no-store" } : undefined)
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.data && typeof json.data === "object") {
        const v = { start_date: json.start_date, end_date: json.end_date, data: json.data }
        setBasisTs(v)
        lsSave("basisTs", v)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad("basisTs")
      if (cached) setBasisTs(cached)
      else setErrorBasisTs("数据不可用")
    } finally {
      setLoadingBasisTs(false)
    }
  }

  const reloadBasisDiffTs = async (force = false) => {
    setLoadingBasisDiffTs(true)
    setErrorBasisDiffTs(null)
    try {
      const res = await fetch(`/ma/api/basis/diff-timeseries${q(force)}`, force ? { cache: "no-store" } : undefined)
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.data && typeof json.data === "object") {
        const v = { start_date: json.start_date, end_date: json.end_date, data: json.data }
        setBasisDiffTs(v)
        lsSave("basisDiffTs", v)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad("basisDiffTs")
      if (cached) setBasisDiffTs(cached)
      else setErrorBasisDiffTs("数据不可用")
    } finally {
      setLoadingBasisDiffTs(false)
    }
  }

  const reloadBasisNearTs = async (force = false) => {
    setLoadingBasisNearTs(true)
    setErrorBasisNearTs(null)
    try {
      const res = await fetch(`/ma/api/basis/near-timeseries${q(force)}`, force ? { cache: "no-store" } : undefined)
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.data && typeof json.data === "object") {
        const v = { start_date: json.start_date, end_date: json.end_date, data: json.data }
        setBasisNearTs(v)
        lsSave("basisNearTs", v)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad("basisNearTs")
      if (cached) setBasisNearTs(cached)
      else setErrorBasisNearTs("数据不可用")
    } finally {
      setLoadingBasisNearTs(false)
    }
  }

  const reloadBasisNearDiffTs = async (force = false) => {
    setLoadingBasisNearDiffTs(true)
    setErrorBasisNearDiffTs(null)
    try {
      const res = await fetch(`/ma/api/basis/near-diff-timeseries${q(force)}`, force ? { cache: "no-store" } : undefined)
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.data && typeof json.data === "object") {
        const v = { start_date: json.start_date, end_date: json.end_date, data: json.data }
        setBasisNearDiffTs(v)
        lsSave("basisNearDiffTs", v)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad("basisNearDiffTs")
      if (cached) setBasisNearDiffTs(cached)
      else setErrorBasisNearDiffTs("数据不可用")
    } finally {
      setLoadingBasisNearDiffTs(false)
    }
  }

  const reloadFutLatest = async (force = false) => {
    setLoadingFut(true)
    setErrorFut(null)
    try {
      const res = await fetch(`/ma/api/futures/latest${q(force)}`, force ? { cache: "no-store" } : undefined)
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.data && typeof json.data === "object") {
        setFutLatest(json.data)
        lsSave("futLatest", json.data)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad("futLatest")
      if (cached) setFutLatest(cached)
      else setErrorFut("数据不可用")
    } finally {
      setLoadingFut(false)
    }
  }

  const reloadBasisContDiffTs = async (force = false) => {
    setLoadingBasisContDiffTs(true)
    setErrorBasisContDiffTs(null)
    try {
      const res = await fetch(`/ma/api/basis/cont-diff-timeseries${q(force)}`, force ? { cache: "no-store" } : undefined)
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.data && typeof json.data === "object") {
        const v = { start_date: json.start_date, end_date: json.end_date, data: json.data }
        setBasisContDiffTs(v)
        lsSave("basisContDiffTs", v)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad("basisContDiffTs")
      if (cached) setBasisContDiffTs(cached)
      else setErrorBasisContDiffTs("数据不可用")
    } finally {
      setLoadingBasisContDiffTs(false)
    }
  }

  const reloadChoiceHeatmap = async (force = false) => {
    setLoadingChoiceHeatmap(true)
    setErrorChoiceHeatmap(null)
    try {
      const res = await fetch(`/ma/api/choice/amount-heatmap${q(force)}`, force ? { cache: "no-store" } : undefined)
      const json = await res.json()
      if (json?.error) throw new Error("api")
      if (json?.data && Array.isArray(json.data)) {
        setChoiceHeatmap(json)
        lsSave("choiceHeatmap", json)
      } else throw new Error("empty")
    } catch {
      const cached = lsLoad("choiceHeatmap")
      if (cached) setChoiceHeatmap(cached)
      else setErrorChoiceHeatmap("数据不可用")
    } finally {
      setLoadingChoiceHeatmap(false)
    }
  }

  useEffect(() => { reloadNhci(true) }, [])
  useEffect(() => { reloadSectorIndices(true) }, [])
  useEffect(() => { reloadFuturesVolCorrScatter(true) }, [])
  useEffect(() => { reloadFuturesVolCorrScatter(true, volWindowOpt, corrWindowOpt) }, [volWindowOpt, corrWindowOpt])

  useEffect(() => { reloadBasisFar(true) }, [])

  useEffect(() => { reloadBasisNear(true) }, [])

  useEffect(() => { reloadBasisTs(true) }, [])

  useEffect(() => { reloadBasisDiffTs(true) }, [])

  useEffect(() => { reloadBasisNearTs(true) }, [])

  useEffect(() => { reloadBasisNearDiffTs(true) }, [])

  useEffect(() => { reloadBasisContDiffTs(true) }, [])

  useEffect(() => { reloadChoiceHeatmap(true) }, [])

  useEffect(() => { reloadFutLatest(true) }, [])
  return (
    <div className="space-y-6 pt-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">期货市场分析</h1>
        <p className="text-muted-foreground mt-2">大宗商品期货与合约分析</p>
      </div>

      <Tabs defaultValue="commodity" className="w-full">
        <TabsList className="mb-2">
          <TabsTrigger value="commodity">商品期货</TabsTrigger>
          <TabsTrigger value="equity">股指期货</TabsTrigger>
          <TabsTrigger value="bond">国债期货</TabsTrigger>
        </TabsList>

        <TabsContent value="commodity" className="space-y-6 mt-0">


      <div className="flex items-center gap-1.5">
        {(["1m", "3m", "6m", "1y"] as const).map((r) => (
          <Button
            key={r}
            size="sm"
            variant={indexRange === r ? "default" : "outline"}
            className="h-7 px-3 text-xs"
            onClick={() => setIndexRange(r)}
          >
            {r === "1m" ? "近一个月" : r === "3m" ? "近三个月" : r === "6m" ? "近六个月" : "近一年"}
          </Button>
        ))}
      </div>

      <div className="flex gap-4">
      <div className="flex-1 min-w-0">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>南华商品指数</CardTitle>
                <CardDescription>去年至今每日收盘价</CardDescription>
              </div>
              {nhci.length > 0 && (() => {
                const latest = nhci[nhci.length - 1]
                const prev = nhci[nhci.length - 2]
                const chg = prev ? latest.close - prev.close : null
                const chgPct = prev ? (chg! / prev.close) * 100 : null
                const up = chg === null ? null : chg >= 0
                return (
                  <div className="text-right">
                    <div className="text-2xl font-bold tabular-nums">{latest.close.toFixed(2)}</div>
                    <div className={`text-xs font-medium ${up === null ? "text-muted-foreground" : up ? "text-emerald-500" : "text-red-500"}`}>
                      {chg !== null ? `${up ? "▲" : "▼"} ${Math.abs(chg).toFixed(2)} (${Math.abs(chgPct!).toFixed(2)}%)` : ""}
                      <span className="ml-1 text-muted-foreground font-normal">{latest.date}</span>
                    </div>
                  </div>
                )
              })()}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loadingNhci ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorNhci ? (
              <div className="text-sm text-destructive">{errorNhci}</div>
            ) : (
              (() => {
                const cutoff = getIndexCutoff(indexRange)
                const nhciSlice = nhci.filter((d) => d.date >= cutoff)
                const values = nhciSlice
                  .map((d) => d.close)
                  .filter((v) => typeof v === "number" && isFinite(v)) as number[]
                const minVal = values.length ? Math.min(...values) : 2000
                const maxVal = values.length ? Math.max(...values) : 3000
                const range = Math.max(1, maxVal - minVal)
                const pad = Math.max(5, range * 0.05)
                const yMin = Math.max(0, Math.floor(minVal - pad))
                const yMax = Math.ceil(maxVal + pad)

                const option = {
                  grid: { top: 16, right: 16, bottom: 40, left: 56 },
                  tooltip: {
                    trigger: "axis",
                    backgroundColor: "rgba(15,23,42,0.85)",
                    borderColor: "transparent",
                    textStyle: { color: "#f8fafc", fontSize: 12 },
                    formatter: (params: any) => {
                      const p = params[0]
                      if (!p) return ""
                      return `<span style="color:#94a3b8">${p.axisValue}</span><br/>${p.marker} <b>${typeof p.value === "number" ? p.value.toFixed(2) : "-"}</b>`
                    },
                    axisPointer: { lineStyle: { color: "#475569", type: "dashed" as const } },
                  },
                  xAxis: {
                    type: "category" as const,
                    data: nhciSlice.map((d) => d.date),
                    axisLine: { lineStyle: { color: "#334155" } },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 11,
                      interval: Math.max(1, Math.floor(nhciSlice.length / 7)),
                      formatter: (v: string) => v.slice(5),
                    },
                    splitLine: { show: false },
                  },
                  yAxis: {
                    type: "value" as const,
                    min: yMin,
                    max: yMax,
                    scale: true,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: { color: "#64748b", fontSize: 11 },
                    splitLine: { lineStyle: { color: "#1e293b", type: "dashed" as const } },
                  },
                  series: [
                    {
                      type: "line",
                      name: "南华商品指数",
                      data: nhciSlice.map((d) => d.close),
                      smooth: 0.3,
                      symbol: "none",
                      lineStyle: { width: 2.5, color: "#38bdf8" },
                      areaStyle: {
                        color: {
                          type: "linear",
                          x: 0, y: 0, x2: 0, y2: 1,
                          colorStops: [
                            { offset: 0, color: "rgba(56,189,248,0.28)" },
                            { offset: 1, color: "rgba(56,189,248,0.02)" },
                          ],
                        },
                      },
                    },
                  ],
                }
                return <ReactECharts option={option} style={{ height: 320 }} notMerge lazyUpdate />
              })()
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 min-w-0">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>南华板块指数</CardTitle>
                <CardDescription>去年至今累计涨跌幅对比（同一起始点）</CardDescription>
              </div>
              {sectorIndices.length > 0 && (() => {
                const latestDate = sectorIndices
                  .flatMap((item) => item.data.map((point) => point.date))
                  .sort()
                  .at(-1)
                return (
                  <div className="text-right">
                    <div className="text-2xl font-bold tabular-nums">{sectorIndices.length}</div>
                    <div className="text-xs font-medium text-muted-foreground">
                      条指数
                      {latestDate ? <span className="ml-1 font-normal">最新 {latestDate}</span> : null}
                    </div>
                  </div>
                )
              })()}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loadingSectorIndices ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorSectorIndices ? (
              <div className="text-sm text-destructive">{errorSectorIndices}</div>
            ) : (
              (() => {
                const cutoff = getIndexCutoff(indexRange)
                const sectorSlice = sectorIndices.map((item) => ({
                  ...item,
                  data: item.data.filter((point) => point.date >= cutoff),
                }))
                const dates = Array.from(
                  new Set(sectorSlice.flatMap((item) => item.data.map((point) => point.date))),
                ).sort()

                // Compute cumulative return for each series relative to its own first valid close
                const returnSeries = sectorSlice.map((item) => {
                  const pointMap = new Map(item.data.map((point) => [point.date, point.close]))
                  const firstClose = item.data.find((point) => point.close != null && point.close > 0)?.close ?? null
                  return {
                    name: item.name,
                    data: dates.map((date) => {
                      const close = pointMap.get(date) ?? null
                      if (close == null || firstClose == null || firstClose === 0) return null
                      return +((close / firstClose - 1) * 100).toFixed(4)
                    }),
                  }
                })

                const allReturnValues = returnSeries
                  .flatMap((item) => item.data)
                  .filter((v): v is number => v != null && isFinite(v))
                const minRet = allReturnValues.length ? Math.min(...allReturnValues) : -20
                const maxRet = allReturnValues.length ? Math.max(...allReturnValues) : 20
                const retRange = Math.max(1, maxRet - minRet)
                const retPad = Math.max(0.5, retRange * 0.04)
                const yMin = Math.floor(minRet - retPad)
                const yMax = Math.ceil(maxRet + retPad)
                const lineColors = ["#f97316", "#22c55e", "#64748b", "#f59e0b", "#06b6d4", "#a855f7"]

                const option = {
                  color: lineColors,
                  grid: { top: 48, right: 24, bottom: 40, left: 64 },
                  legend: {
                    top: 8,
                    left: 8,
                    itemWidth: 14,
                    itemHeight: 8,
                    textStyle: { color: "#64748b", fontSize: 11 },
                  },
                  tooltip: {
                    trigger: "axis",
                    backgroundColor: "rgba(15,23,42,0.85)",
                    borderColor: "transparent",
                    textStyle: { color: "#f8fafc", fontSize: 12 },
                    formatter: (params: any) => {
                      if (!params?.length) return ""
                      const lines = params
                        .filter((item: any) => typeof item.value === "number")
                        .sort((a: any, b: any) => b.value - a.value)
                        .map((item: any) => {
                          const sign = item.value >= 0 ? "+" : ""
                          return `${item.marker} ${item.seriesName}: <b>${sign}${item.value.toFixed(2)}%</b>`
                        })
                      return [`<span style="color:#94a3b8">${params[0].axisValue}</span>`, ...lines].join("<br/>")
                    },
                    axisPointer: { lineStyle: { color: "#475569", type: "dashed" as const } },
                  },
                  xAxis: {
                    type: "category" as const,
                    data: dates,
                    axisLine: { lineStyle: { color: "#334155" } },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 11,
                      interval: Math.max(1, Math.floor(dates.length / 7)),
                      formatter: (v: string) => v.slice(5),
                    },
                    splitLine: { show: false },
                  },
                  yAxis: {
                    type: "value" as const,
                    min: yMin,
                    max: yMax,
                    scale: false,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 11,
                      formatter: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`,
                    },
                    splitLine: { lineStyle: { color: "#1e293b", type: "dashed" as const } },
                  },
                  series: returnSeries.map((item, index) => ({
                    type: "line",
                    name: item.name,
                    data: item.data,
                    smooth: 0.25,
                    symbol: "none",
                    connectNulls: false,
                    lineStyle: { width: 2 },
                    emphasis: { focus: "series" as const },
                    z: lineColors.length - index,
                  })),
                }
                return <ReactECharts option={option} style={{ height: 320 }} notMerge lazyUpdate />
              })()
            )}
          </CardContent>
        </Card>
      </div>
      </div>

      <div className="flex gap-4">
      <div className="flex-1 min-w-0">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>南华板块指数 — 滚动波动率</CardTitle>
                <CardDescription>20日滚动年化波动率（日收益率标准差 × √252）</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loadingSectorIndices ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorSectorIndices ? (
              <div className="text-sm text-destructive">{errorSectorIndices}</div>
            ) : (
              (() => {
                const WINDOW = 20
                const cutoff = getIndexCutoff(indexRange)

                // Build volatility series — need a WINDOW-day look-back before cutoff
                const volSeries = sectorIndices.map((item) => {
                  // Sort all data (already sorted from API)
                  const sorted = [...item.data].sort((a, b) => a.date.localeCompare(b.date))
                  // Find the index of the first date >= cutoff
                  const startIdx = sorted.findIndex((p) => p.date >= cutoff)
                  // Include WINDOW extra bars before the cutoff for the rolling window burn-in
                  const sliceFrom = Math.max(0, startIdx - WINDOW)
                  const working = sliceFrom >= 0 ? sorted.slice(sliceFrom) : sorted

                  const volPoints: Array<{ date: string; vol: number | null }> = []
                  for (let i = 0; i < working.length; i++) {
                    if (i < WINDOW) { volPoints.push({ date: working[i].date, vol: null }); continue }
                    const window = working.slice(i - WINDOW, i + 1)
                    const closes = window.map((p) => p.close).filter((c): c is number => c != null && c > 0)
                    if (closes.length < 2) { volPoints.push({ date: working[i].date, vol: null }); continue }
                    const logRets: number[] = []
                    for (let j = 1; j < closes.length; j++) logRets.push(Math.log(closes[j] / closes[j - 1]))
                    const mean = logRets.reduce((s, v) => s + v, 0) / logRets.length
                    const variance = logRets.reduce((s, v) => s + (v - mean) ** 2, 0) / (logRets.length - 1)
                    volPoints.push({ date: working[i].date, vol: +(Math.sqrt(variance * 252) * 100).toFixed(4) })
                  }
                  // Only keep dates within the cutoff range
                  const visible = volPoints.filter((p) => p.date >= cutoff && p.vol != null)
                  return { name: item.name, points: visible }
                })

                const allDates = Array.from(
                  new Set(volSeries.flatMap((s) => s.points.map((p) => p.date))),
                ).sort()

                const allVols = volSeries.flatMap((s) => s.points.map((p) => p.vol)).filter((v): v is number => v != null)
                const maxVol = allVols.length ? Math.ceil(Math.max(...allVols) * 1.08) : 100
                const lineColors = ["#f97316", "#22c55e", "#64748b", "#f59e0b", "#06b6d4", "#a855f7"]

                const option = {
                  color: lineColors,
                  grid: { top: 48, right: 24, bottom: 40, left: 64 },
                  legend: {
                    top: 8,
                    left: 8,
                    itemWidth: 14,
                    itemHeight: 8,
                    textStyle: { color: "#64748b", fontSize: 11 },
                  },
                  tooltip: {
                    trigger: "axis",
                    backgroundColor: "rgba(15,23,42,0.85)",
                    borderColor: "transparent",
                    textStyle: { color: "#f8fafc", fontSize: 12 },
                    formatter: (params: any) => {
                      if (!params?.length) return ""
                      const lines = params
                        .filter((item: any) => typeof item.value === "number")
                        .sort((a: any, b: any) => b.value - a.value)
                        .map((item: any) => `${item.marker} ${item.seriesName}: <b>${item.value.toFixed(2)}%</b>`)
                      return [`<span style="color:#94a3b8">${params[0].axisValue}</span>`, ...lines].join("<br/>")
                    },
                    axisPointer: { lineStyle: { color: "#475569", type: "dashed" as const } },
                  },
                  xAxis: {
                    type: "category" as const,
                    data: allDates,
                    axisLine: { lineStyle: { color: "#334155" } },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 11,
                      interval: Math.max(1, Math.floor(allDates.length / 7)),
                      formatter: (v: string) => v.slice(5),
                    },
                    splitLine: { show: false },
                  },
                  yAxis: {
                    type: "value" as const,
                    min: 0,
                    max: maxVol,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 11,
                      formatter: (v: number) => `${v.toFixed(0)}%`,
                    },
                    splitLine: { lineStyle: { color: "#1e293b", type: "dashed" as const } },
                  },
                  series: volSeries.map((s, index) => {
                    const dateVolMap = new Map(s.points.map((p) => [p.date, p.vol]))
                    return {
                      type: "line",
                      name: s.name,
                      data: allDates.map((d) => dateVolMap.get(d) ?? null),
                      smooth: 0.3,
                      symbol: "none",
                      connectNulls: false,
                      lineStyle: { width: 2 },
                      emphasis: { focus: "series" as const },
                      z: lineColors.length - index,
                    }
                  }),
                }
                return <ReactECharts option={option} style={{ height: 320 }} notMerge lazyUpdate />
              })()
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 min-w-0">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>南华板块截面波动率</CardTitle>
                <CardDescription>每日各板块指数日收益率的截面标准差（衡量板块间分化程度）</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loadingSectorIndices ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorSectorIndices ? (
              <div className="text-sm text-destructive">{errorSectorIndices}</div>
            ) : (
              (() => {
                const cutoff = getIndexCutoff(indexRange)

                // Build per-index daily return maps (need one extra day before cutoff for first return)
                const returnMaps = sectorIndices.map((item) => {
                  const sorted = [...item.data].sort((a, b) => a.date.localeCompare(b.date))
                  const map = new Map<string, number>()
                  for (let i = 1; i < sorted.length; i++) {
                    const prev = sorted[i - 1]
                    const curr = sorted[i]
                    if (prev.close != null && prev.close > 0 && curr.close != null && curr.close > 0) {
                      map.set(curr.date, (curr.close / prev.close - 1) * 100)
                    }
                  }
                  return map
                })

                // Collect all dates within range that have returns for at least 2 indices
                const allDates = Array.from(
                  new Set(sectorIndices.flatMap((item) => item.data.map((p) => p.date))),
                ).sort().filter((d) => d >= cutoff)

                const crossVolPoints = allDates.map((date) => {
                  const rets = returnMaps.map((m) => m.get(date)).filter((v): v is number => v != null)
                  if (rets.length < 2) return { date, vol: null }
                  const mean = rets.reduce((s, v) => s + v, 0) / rets.length
                  const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length - 1)
                  return { date, vol: +Math.sqrt(variance).toFixed(4) }
                }).filter((p) => p.vol != null)

                const dates = crossVolPoints.map((p) => p.date)
                const vols = crossVolPoints.map((p) => p.vol as number)
                const maxVol = vols.length ? Math.ceil(Math.max(...vols) * 1.1 * 10) / 10 : 5

                // Simple 10-day moving average for trend reference
                const maData = vols.map((_, i) => {
                  if (i < 9) return null
                  const slice = vols.slice(i - 9, i + 1)
                  return +(slice.reduce((s, v) => s + v, 0) / slice.length).toFixed(4)
                })

                const option = {
                  grid: { top: 40, right: 24, bottom: 40, left: 64 },
                  legend: {
                    top: 8,
                    left: 8,
                    itemWidth: 14,
                    itemHeight: 8,
                    textStyle: { color: "#64748b", fontSize: 11 },
                  },
                  tooltip: {
                    trigger: "axis",
                    backgroundColor: "rgba(15,23,42,0.85)",
                    borderColor: "transparent",
                    textStyle: { color: "#f8fafc", fontSize: 12 },
                    formatter: (params: any) => {
                      if (!params?.length) return ""
                      const lines = params
                        .filter((item: any) => typeof item.value === "number")
                        .map((item: any) => `${item.marker} ${item.seriesName}: <b>${item.value.toFixed(2)}%</b>`)
                      return [`<span style="color:#94a3b8">${params[0].axisValue}</span>`, ...lines].join("<br/>")
                    },
                    axisPointer: { lineStyle: { color: "#475569", type: "dashed" as const } },
                  },
                  xAxis: {
                    type: "category" as const,
                    data: dates,
                    axisLine: { lineStyle: { color: "#334155" } },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 11,
                      interval: Math.max(1, Math.floor(dates.length / 7)),
                      formatter: (v: string) => v.slice(5),
                    },
                    splitLine: { show: false },
                  },
                  yAxis: {
                    type: "value" as const,
                    min: 0,
                    max: maxVol,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 11,
                      formatter: (v: number) => `${v.toFixed(1)}%`,
                    },
                    splitLine: { lineStyle: { color: "#1e293b", type: "dashed" as const } },
                  },
                  series: [
                    {
                      type: "bar",
                      name: "截面波动率",
                      data: vols,
                      barMaxWidth: 6,
                      itemStyle: { color: "#38bdf8", opacity: 0.55 },
                      emphasis: { itemStyle: { opacity: 0.9 } },
                    },
                    {
                      type: "line",
                      name: "10日均线",
                      data: maData,
                      smooth: 0.3,
                      symbol: "none",
                      connectNulls: false,
                      lineStyle: { width: 2, color: "#f97316" },
                    },
                  ],
                }
                return <ReactECharts option={option} style={{ height: 320 }} notMerge lazyUpdate />
              })()
            )}
          </CardContent>
        </Card>
      </div>
      </div>

      <div className="flex gap-4 items-start">
      <div className="flex-1 min-w-0">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>南华板块指数 — 滚动相关性矩阵</CardTitle>
                <CardDescription>基于所选区间内日收益率的 Pearson 相关系数</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loadingSectorIndices ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorSectorIndices ? (
              <div className="text-sm text-destructive">{errorSectorIndices}</div>
            ) : (
              (() => {
                const cutoff = getIndexCutoff(indexRange)

                // Build daily return series per index within the range
                const retSeriesList = sectorIndices.map((item) => {
                  const sorted = [...item.data]
                    .filter((p) => p.date >= cutoff)
                    .sort((a, b) => a.date.localeCompare(b.date))
                  const rets: number[] = []
                  for (let i = 1; i < sorted.length; i++) {
                    const prev = sorted[i - 1]
                    const curr = sorted[i]
                    if (prev.close != null && prev.close > 0 && curr.close != null && curr.close > 0) {
                      rets.push(curr.close / prev.close - 1)
                    } else {
                      rets.push(NaN)
                    }
                  }
                  return { name: item.name, rets }
                })

                const n = retSeriesList.length
                // Pearson correlation between two arrays (ignoring NaN pairs)
                const pearson = (a: number[], b: number[]): number => {
                  const pairs = a
                    .map((v, i) => [v, b[i]])
                    .filter(([x, y]) => isFinite(x) && isFinite(y))
                  if (pairs.length < 2) return NaN
                  const meanA = pairs.reduce((s, [x]) => s + x, 0) / pairs.length
                  const meanB = pairs.reduce((s, [, y]) => s + y, 0) / pairs.length
                  const num = pairs.reduce((s, [x, y]) => s + (x - meanA) * (y - meanB), 0)
                  const denA = Math.sqrt(pairs.reduce((s, [x]) => s + (x - meanA) ** 2, 0))
                  const denB = Math.sqrt(pairs.reduce((s, [, y]) => s + (y - meanB) ** 2, 0))
                  return denA === 0 || denB === 0 ? NaN : num / (denA * denB)
                }

                // Build correlation matrix as heatmap data [{x, y, value}]
                // ECharts heatmap expects data as [xIdx, yIdx, value]
                const names = retSeriesList.map((s) => s.name)
                const heatData: [number, number, number][] = []
                for (let i = 0; i < n; i++) {
                  for (let j = 0; j < n; j++) {
                    const r = i === j ? 1 : pearson(retSeriesList[i].rets, retSeriesList[j].rets)
                    heatData.push([j, n - 1 - i, isFinite(r) ? +r.toFixed(3) : 0])
                  }
                }

                const option = {
                  grid: { top: 20, right: 120, bottom: 80, left: 120 },
                  tooltip: {
                    position: "top" as const,
                    backgroundColor: "rgba(15,23,42,0.9)",
                    borderColor: "transparent",
                    textStyle: { color: "#f8fafc", fontSize: 12 },
                    formatter: (params: any) => {
                      const xi = params.data[0] as number
                      const yi = (n - 1 - params.data[1]) as number
                      const val = params.data[2] as number
                      return `${names[yi]} × ${names[xi]}<br/><b>r = ${val.toFixed(3)}</b>`
                    },
                  },
                  xAxis: {
                    type: "category" as const,
                    data: names,
                    position: "bottom" as const,
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 10,
                      interval: 0,
                      rotate: 30,
                    },
                    axisLine: { show: false },
                    axisTick: { show: false },
                    splitArea: { show: true, areaStyle: { color: ["rgba(30,41,59,0.3)", "rgba(15,23,42,0.3)"] } },
                  },
                  yAxis: {
                    type: "category" as const,
                    data: [...names].reverse(),
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 10,
                      interval: 0,
                    },
                    axisLine: { show: false },
                    axisTick: { show: false },
                    splitArea: { show: true, areaStyle: { color: ["rgba(30,41,59,0.3)", "rgba(15,23,42,0.3)"] } },
                  },
                  visualMap: {
                    min: -1,
                    max: 1,
                    calculable: true,
                    orient: "vertical" as const,
                    right: 8,
                    top: "center" as const,
                    inRange: {
                      color: ["#3b82f6", "#1e293b", "#ef4444"],
                    },
                    textStyle: { color: "#64748b", fontSize: 10 },
                  },
                  series: [
                    {
                      type: "heatmap",
                      data: heatData,
                      label: {
                        show: true,
                        fontSize: 10,
                        color: "#f8fafc",
                        formatter: (params: any) => (params.data[2] as number).toFixed(2),
                      },
                      emphasis: {
                        itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,0.5)" },
                      },
                    },
                  ],
                }
                const cellSize = Math.min(72, Math.floor((typeof window !== "undefined" ? window.innerWidth * 0.4 : 480) / n))
                const chartH = cellSize * n + 120
                return <ReactECharts option={option} style={{ height: Math.max(360, chartH) }} notMerge lazyUpdate />
              })()
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex-1 min-w-0">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>南华板块指数 — 滚动相关性走势</CardTitle>
                <CardDescription>20日滚动 Pearson 相关系数（每对指数一条线）</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loadingSectorIndices ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorSectorIndices ? (
              <div className="text-sm text-destructive">{errorSectorIndices}</div>
            ) : (
              (() => {
                const ROLL = 20
                const cutoff = getIndexCutoff(indexRange)

                // Build per-index daily return arrays aligned to a union date axis
                // Include ROLL extra days before cutoff for burn-in
                const allSorted = Array.from(
                  new Set(sectorIndices.flatMap((item) => item.data.map((p) => p.date))),
                ).sort()
                const burnStart = allSorted[Math.max(0, allSorted.findIndex((d) => d >= cutoff) - ROLL - 1)] ?? allSorted[0]

                const retMaps = sectorIndices.map((item) => {
                  const sorted = item.data
                    .filter((p) => p.date >= burnStart)
                    .sort((a, b) => a.date.localeCompare(b.date))
                  const map = new Map<string, number>()
                  for (let i = 1; i < sorted.length; i++) {
                    const prev = sorted[i - 1]; const curr = sorted[i]
                    if (prev.close != null && prev.close > 0 && curr.close != null && curr.close > 0)
                      map.set(curr.date, curr.close / prev.close - 1)
                  }
                  return { name: item.name, map }
                })

                // Working date axis (those with at least one return value, from burnStart)
                const workDates = allSorted.filter((d) => d >= burnStart && retMaps.some((r) => r.map.has(d)))

                // Generate pair names + rolling correlation series
                const pairs: Array<{ label: string; data: Array<number | null> }> = []
                for (let i = 0; i < retMaps.length; i++) {
                  for (let j = i + 1; j < retMaps.length; j++) {
                    const a = retMaps[i]; const b = retMaps[j]
                    // short label: first char of each index name word
                    const shortA = a.name.replace("南华", "").replace("指数", "")
                    const shortB = b.name.replace("南华", "").replace("指数", "")
                    const label = `${shortA}×${shortB}`
                    const series: Array<number | null> = workDates.map((_, idx) => {
                      if (idx < ROLL) return null
                      const window = workDates.slice(idx - ROLL, idx + 1)
                      const ra = window.map((d) => a.map.get(d)).filter((v): v is number => v != null)
                      const rb = window.map((d) => b.map.get(d)).filter((v): v is number => v != null)
                      // align by date
                      const paired: [number, number][] = []
                      workDates.slice(idx - ROLL, idx + 1).forEach((d) => {
                        const va = a.map.get(d); const vb = b.map.get(d)
                        if (va != null && vb != null) paired.push([va, vb])
                      })
                      if (paired.length < 5) return null
                      const meanA = paired.reduce((s, [x]) => s + x, 0) / paired.length
                      const meanB = paired.reduce((s, [, y]) => s + y, 0) / paired.length
                      const num = paired.reduce((s, [x, y]) => s + (x - meanA) * (y - meanB), 0)
                      const denA = Math.sqrt(paired.reduce((s, [x]) => s + (x - meanA) ** 2, 0))
                      const denB = Math.sqrt(paired.reduce((s, [, y]) => s + (y - meanB) ** 2, 0))
                      const r = denA === 0 || denB === 0 ? null : num / (denA * denB)
                      return r != null ? +r.toFixed(4) : null
                    })
                    pairs.push({ label, data: series })
                  }
                }

                // Trim to visible range
                const visibleDates = workDates.filter((d) => d >= cutoff)
                const trimStart = workDates.indexOf(visibleDates[0])
                const trimmedPairs = pairs.map((p) => ({ ...p, data: p.data.slice(trimStart) }))

                const pairColors = [
                  "#f97316","#22c55e","#64748b","#f59e0b","#06b6d4","#a855f7",
                  "#ec4899","#84cc16","#0ea5e9","#d946ef","#14b8a6","#fb923c",
                  "#4ade80","#60a5fa","#c084fc",
                ]

                const option = {
                  color: pairColors,
                  grid: { top: 48, right: 24, bottom: 40, left: 56 },
                  legend: {
                    top: 8,
                    left: 8,
                    itemWidth: 12,
                    itemHeight: 8,
                    textStyle: { color: "#64748b", fontSize: 10 },
                  },
                  tooltip: {
                    trigger: "axis",
                    backgroundColor: "rgba(15,23,42,0.88)",
                    borderColor: "transparent",
                    textStyle: { color: "#f8fafc", fontSize: 11 },
                    formatter: (params: any) => {
                      if (!params?.length) return ""
                      const lines = params
                        .filter((item: any) => typeof item.value === "number")
                        .sort((a: any, b: any) => b.value - a.value)
                        .map((item: any) => `${item.marker} ${item.seriesName}: <b>${item.value.toFixed(2)}</b>`)
                      return [`<span style="color:#94a3b8">${params[0].axisValue}</span>`, ...lines].join("<br/>")
                    },
                    axisPointer: { lineStyle: { color: "#475569", type: "dashed" as const } },
                  },
                  xAxis: {
                    type: "category" as const,
                    data: visibleDates,
                    axisLine: { lineStyle: { color: "#334155" } },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b", fontSize: 11,
                      interval: Math.max(1, Math.floor(visibleDates.length / 7)),
                      formatter: (v: string) => v.slice(5),
                    },
                    splitLine: { show: false },
                  },
                  yAxis: {
                    type: "value" as const,
                    min: -1, max: 1,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b", fontSize: 11,
                      formatter: (v: number) => v.toFixed(1),
                    },
                    splitLine: { lineStyle: { color: "#1e293b", type: "dashed" as const } },
                  },
                  series: trimmedPairs.map((p, idx) => ({
                    type: "line",
                    name: p.label,
                    data: p.data,
                    smooth: 0.25,
                    symbol: "none",
                    connectNulls: false,
                    lineStyle: { width: 1.5, color: pairColors[idx % pairColors.length] },
                    emphasis: { focus: "series" as const, lineStyle: { width: 3 } },
                  })),
                }
                const n = sectorIndices.length
                const cellSize = Math.min(72, Math.floor((typeof window !== "undefined" ? window.innerWidth * 0.4 : 480) / n))
                const chartH = Math.max(360, cellSize * n + 120)
                return <ReactECharts option={option} style={{ height: chartH }} notMerge lazyUpdate />
              })()
            )}
          </CardContent>
        </Card>
      </div>
      </div>

      <div className="w-1/2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>商品期货波动率 vs 南华商品指数相关性</CardTitle>
                <CardDescription>
                  X 轴：各品种收益率与南华商品指数相关系数（{corrWindowOpt}），Y 轴：各品种收益波动率（{volWindowOpt}）
                  {futuresVolCorrScatter?.as_of ? ` | 截至 ${futuresVolCorrScatter.as_of}` : ""}
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 pt-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">波动率窗口</span>
                <select
                  value={volWindowOpt}
                  onChange={(e) => setVolWindowOpt(e.target.value as typeof volWindowOpt)}
                  className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {(["5d","10d","20d","1m","6m","1y","5y","10y"] as const).map((w) => (
                    <option key={w} value={w}>
                      {w === "1m" ? "1月" : w === "6m" ? "6月" : w === "1y" ? "1年" : w === "5y" ? "5年" : w === "10y" ? "10年" : w}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">相关性窗口</span>
                <select
                  value={corrWindowOpt}
                  onChange={(e) => setCorrWindowOpt(e.target.value as typeof corrWindowOpt)}
                  className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {(["5d","10d","20d","1m","6m","1y","5y","10y"] as const).map((w) => (
                    <option key={w} value={w}>
                      {w === "1m" ? "1月" : w === "6m" ? "6月" : w === "1y" ? "1年" : w === "5y" ? "5年" : w === "10y" ? "10年" : w}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loadingFuturesVolCorrScatter ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorFuturesVolCorrScatter ? (
              <div className="text-sm text-destructive">{errorFuturesVolCorrScatter}</div>
            ) : futuresVolCorrScatter ? (
              (() => {
                const PRODUCT_CN: Record<string, string> = {
                  A:"黄大豆1号", AD:"铝合金",   AG:"白银",      AL:"沪铝",     AO:"氧化铝",   AP:"苹果",
                  AU:"黄金",     B:"黄大豆2号", BB:"胶合板",    BC:"国际铜",   BR:"丁二烯橡胶",BU:"沥青",
                  BZ:"纯苯",     C:"玉米",      CF:"棉花",      CJ:"红枣",     CS:"玉米淀粉", CU:"沪铜",
                  CY:"棉纱",     EB:"苯乙烯",   EC:"航运",      EG:"乙二醇",   FB:"纤维板",   FG:"玻璃",
                  FU:"燃料油",   HC:"热卷",     I:"铁矿石",     IC:"中证500",  IF:"沪深300",
                  IH:"上证50",   IM:"中证1000", J:"焦炭",       JD:"鸡蛋",     JM:"焦煤",
                  JR:"粳稻",     L:"塑料",      LC:"碳酸锂",    LG:"原木",     LH:"生猪",     LR:"晚籼稻",
                  LU:"低硫燃油", M:"豆粕",      MA:"甲醇",      NI:"沪镍",     NR:"20号胶",   OI:"菜籽油",
                  OP:"双胶纸",   P:"棕榈油",    PB:"沪铅",      PD:"钯",       PF:"短纤",     PG:"液化气",
                  PK:"花生",     PL:"丙烯",     PM:"普麦",      PP:"聚丙烯",   PR:"瓶片",     PS:"多晶硅",
                  PT:"铂",       PX:"对二甲苯", RB:"螺纹钢",    RI:"早籼稻",   RM:"菜籽粕",   RR:"粳米",
                  RS:"油菜籽",   RU:"天然橡胶", SA:"纯碱",      SC:"原油",     SF:"硅铁",     SH:"烧碱",
                  SI:"工业硅",   SM:"锰硅",     SN:"沪锡",      SP:"纸浆",     SR:"白糖",     SS:"不锈钢",
                  T:"10年期国债",TA:"PTA",      TF:"5年期国债", TL:"30年期国债",TS:"2年期国债",
                  UR:"尿素",     V:"PVC",       WH:"强麦",      WR:"线材",     Y:"豆油",      ZC:"动力煤",
                  ZN:"沪锌",
                }
                const values = futuresVolCorrScatter.points.map((point) => point.volatility)
                const maxVol = values.length ? Math.max(...values) : 1
                const scatterData = futuresVolCorrScatter.points.map((point) => ({
                  name: point.label,
                  value: [point.correlation, point.volatility, point.label, point.observations, point.latest_date],
                }))

                const option = {
                  animation: false,
                  grid: { top: 28, right: 28, bottom: 100, left: 64 },
                  tooltip: {
                    trigger: "item" as const,
                    backgroundColor: "rgba(15,23,42,0.9)",
                    borderColor: "transparent",
                    textStyle: { color: "#f8fafc", fontSize: 12 },
                    formatter: (params: any) => {
                      const [corr, vol, code, obs, date] = params.data.value
                      const cnName = PRODUCT_CN[code]
                      const title = cnName ? `<b>${cnName}（${code}）</b>` : `<b>${code}</b>`
                      return [
                        title,
                        `<span style="color:#94a3b8">日期: ${date}</span>`,
                        `相关性（${futuresVolCorrScatter.corrWindow}）: <b>${(+corr).toFixed(3)}</b>`,
                        `波动率（${futuresVolCorrScatter.volWindow}）: <b>${(+vol).toFixed(2)}%</b>`,
                        `样本点: <b>${obs}</b>`,
                      ].join("<br/>")
                    },
                  },
                  xAxis: {
                    type: "value" as const,
                    min: -1,
                    max: 1,
                    name: `相关性 ${futuresVolCorrScatter.corrWindow}（对${futuresVolCorrScatter.benchmark}）`,
                    nameLocation: "middle" as const,
                    nameGap: 20,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 11,
                      formatter: (value: number) => value.toFixed(1),
                    },
                    splitLine: { lineStyle: { color: "#1e293b", type: "dashed" as const } },
                  },
                  yAxis: {
                    type: "value" as const,
                    min: 0,
                    max: +(maxVol * 1.1).toFixed(2),
                    name: `波动率 ${futuresVolCorrScatter.volWindow}`,
                    nameLocation: "middle" as const,
                    nameGap: 48,
                    axisLine: { show: false },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 11,
                      formatter: (value: number) => `${value.toFixed(1)}%`,
                    },
                    splitLine: { lineStyle: { color: "#1e293b", type: "dashed" as const } },
                  },
                  visualMap: {
                    min: -1,
                    max: 1,
                    dimension: 0,
                    orient: "horizontal" as const,
                    left: "center" as const,
                    bottom: 8,
                    inRange: { color: ["#2563eb", "#94a3b8", "#dc2626"] },
                    textStyle: { color: "#64748b", fontSize: 10 },
                  },
                  series: [
                    {
                      type: "scatter" as const,
                      data: scatterData,
                      symbolSize: 12,
                      itemStyle: { opacity: 0.82 },
                      label: {
                        show: true,
                        position: "top" as const,
                        color: "#94a3b8",
                        fontSize: 9,
                        formatter: (params: any) => params.data.value[2],
                      },
                      labelLayout: { hideOverlap: true },
                      emphasis: {
                        focus: "self" as const,
                        label: { color: "#f8fafc", fontWeight: 600 },
                        itemStyle: { borderColor: "#f8fafc", borderWidth: 1.5, opacity: 1 },
                      },
                      markLine: {
                        silent: true,
                        symbol: "none",
                        lineStyle: { color: "#475569", type: "dashed" as const },
                        data: [{ xAxis: 0 }],
                      },
                    },
                  ],
                }

                return <ReactECharts option={option} style={{ height: 420 }} notMerge lazyUpdate />
              })()
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="w-full">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>商品期货 日成交额排行</CardTitle>
                <CardDescription>按板块分组，颜色按板块{choiceHeatmap?.trade_date ? ` | ${choiceHeatmap.trade_date}` : ""}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingChoiceHeatmap ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorChoiceHeatmap ? (
              <div className="text-sm text-destructive">{errorChoiceHeatmap}</div>
            ) : choiceHeatmap && choiceHeatmap.data ? (
              (() => {
                const sectorBaseColors: Record<string, string> = {
                  "农产": "#10b981",
                  "贵金属": "#f59e0b",
                  "有色": "#3b82f6",
                  "新能源": "#22c55e",
                  "黑色": "#6b7280",
                  "能源化工": "#ef4444",
                  "航运": "#8b5cf6",
                  "股指": "#0ea5e9",
                  "国债": "#14b8a6",
                  "其他": "#9ca3af",
                }
                const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
                const hexToRgb = (hex: string) => {
                  const h = hex.replace('#', '')
                  const bigint = parseInt(h, 16)
                  const r = (bigint >> 16) & 255
                  const g = (bigint >> 8) & 255
                  const b = bigint & 255
                  return { r, g, b }
                }
                const rgbToHex = (r: number, g: number, b: number) => {
                  const toHex = (x: number) => x.toString(16).padStart(2, '0')
                  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
                }
                const adjustBrightness = (hex: string, factor: number) => {
                  const { r, g, b } = hexToRgb(hex)
                  const rf = clamp(Math.round(r + (255 - r) * factor), 0, 255)
                  const gf = clamp(Math.round(g + (255 - g) * factor), 0, 255)
                  const bf = clamp(Math.round(b + (255 - b) * factor), 0, 255)
                  return rgbToHex(rf, gf, bf)
                }
                const colored = (choiceHeatmap.data as any).map((grp: any) => {
                  const base = sectorBaseColors[grp.name] || "#9ca3af"
                  const n = grp.children.length || 1
                  const factors = Array.from({ length: n }, (_, i) => {
                    const t = n === 1 ? 0.15 : (i / (n - 1))
                    return (t * 0.7) - 0.35
                  })
                  return {
                    ...grp,
                    itemStyle: { color: base },
                    children: grp.children.map((nItem: any, idx: number) => ({
                      ...nItem,
                      itemStyle: { color: adjustBrightness(base, factors[idx]) },
                    })),
                  }
                })
                const option = {
                  tooltip: {
                    formatter: (info: any) => {
                      const v = info?.value || 0
                      const ret = info?.data?.ret
                      const name = info?.name || ""
                      const total = choiceHeatmap.total_amount || 0
                      const share = total ? (v / total) * 100 : 0
                      const retStr = typeof ret === "number" ? `${ret.toFixed(2)}%` : "-"
                      const amtYi = v ? v / 100_000_000 : 0
                      const amtStr = v ? `${amtYi.toFixed(2)}亿` : "-"
                      const isSector = Array.isArray(info?.data?.children)
                      if (isSector) {
                        return `${name}<br/>日成交额: ${amtStr} (${share.toFixed(2)}%)`
                      }
                      return `${name}<br/>日成交额: ${amtStr} (${share.toFixed(2)}%)<br/>涨跌: ${retStr}`
                    },
                  },
                  series: [
                    {
                      type: "treemap",
                      colorBy: "data",
                      colorMappingBy: "index",
                      data: colored,
                      nodeClick: "zoomToNode",
                      leafDepth: 1,
                      label: { show: true },
                      upperLabel: { show: true },
                      roam: false,
                      breadcrumb: {
                        show: true,
                        left: "5%",
                        top: 10,
                        height: 28,
                      },
                    },
                  ],
                }
                return <ReactECharts option={option} style={{ height: 540 }} notMerge lazyUpdate />
              })()
            ) : (
              <div className="text-sm text-muted-foreground">暂无数据</div>
            )}
          </CardContent>
        </Card>
      </div>

        </TabsContent>

        <TabsContent value="equity" className="space-y-6 mt-0">

      <div className="w-full">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>四大连续合约基差时序</CardTitle>
                <CardDescription>当月/次月/当季/下季 结算 - 现货收盘</CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm">
                  <label className="mr-2 text-muted-foreground">品种</label>
                  <select
                    className="border rounded px-2 py-1 text-sm"
                    value={selectedCode}
                    onChange={(e) => setSelectedCode(e.target.value as any)}
                  >
                    <option value="IH">IH</option>
                    <option value="IF">IF</option>
                    <option value="IC">IC</option>
                    <option value="IM">IM</option>
                  </select>
                </div>

              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingBasisContDiffTs ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorBasisContDiffTs ? (
              <div className="text-sm text-destructive">{errorBasisContDiffTs}</div>
            ) : basisContDiffTs && basisContDiffTs.data ? (
              (() => {
                const legs = [
                  { key: "L", name: "当月" },
                  { key: "L1", name: "次月" },
                  { key: "L2", name: "当季" },
                  { key: "L3", name: "下季" },
                ] as const
                const colorMap: Record<string, string> = {
                  L: "#2563eb",
                  L1: "#16a34a",
                  L2: "#f59e0b",
                  L3: "#dc2626",
                }
                const series = legs.map((leg) => {
                  const arr = (basisContDiffTs.data?.[selectedCode]?.[leg.key] || [])
                    .filter((d: any) => typeof d?.basis_diff === "number")
                    .map((d: any) => [d.date, d.basis_diff as number])
                  return {
                    name: leg.name,
                    type: "line" as const,
                    data: arr,
                    smooth: true,
                    showSymbol: false,
                    lineStyle: { width: 2, color: colorMap[leg.key] },
                  }
                })
                const option = {
                  tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(2)}` },
                  xAxis: { type: "time", axisLabel: { hideOverlap: true, margin: 10 } },
                  yAxis: { type: "value" },
                  legend: { data: legs.map((l) => l.name), top: 8, left: "center" },
                  grid: { left: "10%", right: "4%", top: 70, bottom: 90, containLabel: true },
                  dataZoom: [
                    { type: "slider", xAxisIndex: 0, height: 32, bottom: 12 },
                    { type: "inside", xAxisIndex: 0 },
                  ],
                  series,
                }
                return (
                  <div className="pb-6">
                    <ReactECharts option={option} style={{ height: 520 }} notMerge lazyUpdate />
                  </div>
                )
              })()
            ) : (
              <div className="text-sm text-muted-foreground">暂无数据</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Far / Near global toggle */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">合约月份</span>
        <div className="inline-flex rounded-md border border-input overflow-hidden text-sm font-medium">
          <button
            className={`px-4 py-1.5 transition-colors ${
              showFar ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
            }`}
            onClick={() => setShowFar(true)}
          >远月</button>
          <button
            className={`px-4 py-1.5 transition-colors ${
              !showFar ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
            }`}
            onClick={() => setShowFar(false)}
          >近月</button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{showFar ? "远月期指" : "近月期指"}</CardTitle>
                <CardDescription>{showFar ? "最新交易日主力合约收盘与结算涨跌幅" : "最新交易日当月连续收盘与结算涨跌幅"}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingFut ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorFut ? (
              <div className="text-sm text-destructive">{errorFut}</div>
            ) : (
              (() => {
                const codes = ["IH", "IF", "IC", "IM"]
                const fmtDate = (s?: string) => {
                  if (!s) return ""
                  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
                  return s
                }
                const fmtPct = (v?: number | null) => {
                  if (typeof v !== "number") return ""
                  const sign = v > 0 ? "+" : ""
                  return `${sign}${v.toFixed(2)}% 结算涨跌幅`
                }
                return (
                  <div className="grid gap-6 sm:grid-cols-2">
                    {codes.map((code) => {
                      const d = futLatest?.[code]
                      const dateStr = fmtDate(d?.trade_date)
                      const priceVal = showFar
                        ? (typeof d?.settle === "number" ? d!.settle : (typeof d?.close === "number" ? d!.close : null))
                        : (typeof d?.near_settle === "number" ? d!.near_settle : (typeof d?.near_close === "number" ? d!.near_close : null))
                      const pctVal = showFar ? d?.settle_return : d?.near_settle_return
                      const pctStr = fmtPct(pctVal)
                      return (
                        <Card key={code} className="border">
                          <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-sm font-semibold tracking-wide">{code}</CardTitle>
                              <MoreVertical className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <CardDescription className="text-xs">{dateStr}</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="text-4xl font-semibold">
                              {priceVal !== null ? priceVal.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "-"}
                            </div>
                            <div className={`mt-2 text-sm ${typeof pctVal === "number" && pctVal < 0 ? "text-green-600" : "text-red-600"}`}>
                              {pctStr || ""}
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                )
              })()
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{showFar ? "远月年化基差率" : "近月年化基差率"}</CardTitle>
                <CardDescription>
                  {showFar
                    ? `基于最新交易日远月合约与现货${Object.values(basisFar)[0]?.trade_date ? ` | ${Object.values(basisFar)[0]!.trade_date}` : ""}`
                    : `基于最新交易日当月连续与现货${Object.values(basisNear)[0]?.trade_date ? ` | ${Object.values(basisNear)[0]!.trade_date}` : ""}`
                  }
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(showFar ? loadingBasis : loadingBasisNear) ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : (showFar ? errorBasis : errorBasisNear) ? (
              <div className="text-sm text-destructive">{showFar ? errorBasis : errorBasisNear}</div>
            ) : (
              (() => {
                const codes = ["IH", "IF", "IC", "IM"]
                const basisData = showFar ? basisFar : basisNear
                const barsAll = codes.map((c) => ({
                  name: c,
                  value: typeof basisData?.[c]?.annualized_basis_pct === "number" ? basisData[c]!.annualized_basis_pct! : null,
                }))
                const bars = barsAll.filter((b) => typeof b.value === "number")
                if (!bars.length) return <div className="text-sm text-muted-foreground">暂无数据</div>
                const colorMap: Record<string, string> = { IH: "#2563eb", IF: "#16a34a", IC: "#f59e0b", IM: "#dc2626" }
                const option = {
                  tooltip: {
                    trigger: "item",
                    formatter: (p: any) => {
                      const v = p?.value
                      return `${p?.name || ""}: ${typeof v === "number" ? v.toFixed(2) + "%" : "-"}`
                    },
                  },
                  xAxis: { type: "category", data: bars.map((s) => s.name) },
                  yAxis: { type: "value", axisLabel: { formatter: (v: number) => `${v}%` } },
                  series: [{
                    type: "bar",
                    data: bars.map((s) => s.value as number),
                    itemStyle: { color: (params: any) => (params?.name && colorMap[params.name]) || "#888888" },
                  }],
                }
                return <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate />
              })()
            )}
          </CardContent>
        </Card>
      </div>

      <div className="w-full">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{showFar ? "远月基差时序" : "近月基差时序"}</CardTitle>
                <CardDescription>{showFar ? "自2023-01-01至今，主连结算 - 现货收盘" : "自2023-01-01至今，当月连续结算 - 现货收盘"}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(showFar ? loadingBasisDiffTs : loadingBasisNearDiffTs) ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : (showFar ? errorBasisDiffTs : errorBasisNearDiffTs) ? (
              <div className="text-sm text-destructive">{showFar ? errorBasisDiffTs : errorBasisNearDiffTs}</div>
            ) : (showFar ? basisDiffTs : basisNearDiffTs)?.data ? (
              (() => {
                const tsData = showFar ? basisDiffTs : basisNearDiffTs
                const codes = ["IH", "IF", "IC", "IM"]
                const colorMap: Record<string, string> = { IH: "#2563eb", IF: "#16a34a", IC: "#f59e0b", IM: "#dc2626" }
                const series = codes.map((c) => {
                  const arr = (tsData!.data?.[c] || [])
                    .filter((d) => typeof d?.basis_diff === "number")
                    .map((d) => [d.date, d.basis_diff as number])
                  return { name: c, type: "line" as const, data: arr, smooth: true, showSymbol: false, lineStyle: { width: 2, color: colorMap[c] } }
                })
                const option = {
                  tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(2)}` },
                  xAxis: { type: "time", axisLabel: { hideOverlap: true, margin: 10 } },
                  yAxis: { type: "value" },
                  legend: { data: codes, top: 8, left: "center" },
                  grid: { left: "10%", right: "4%", top: 70, bottom: 90, containLabel: true },
                  dataZoom: [{ type: "slider", xAxisIndex: 0, height: 32, bottom: 12 }, { type: "inside", xAxisIndex: 0 }],
                  series,
                }
                return <div className="pb-6"><ReactECharts option={option} style={{ height: 520 }} notMerge lazyUpdate /></div>
              })()
            ) : (
              <div className="text-sm text-muted-foreground">暂无数据</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="w-full">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{showFar ? "远月年化基差率时序" : "近月年化基差率时序"}</CardTitle>
                <CardDescription>{showFar ? "自2023-01-01至今，主连结算与现货" : "自2023-01-01至今，当月连续结算与现货"}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(showFar ? loadingBasisTs : loadingBasisNearTs) ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : (showFar ? errorBasisTs : errorBasisNearTs) ? (
              <div className="text-sm text-destructive">{showFar ? errorBasisTs : errorBasisNearTs}</div>
            ) : (showFar ? basisTs : basisNearTs)?.data ? (
              (() => {
                const tsData = showFar ? basisTs : basisNearTs
                const codes = ["IH", "IF", "IC", "IM"]
                const colorMap: Record<string, string> = { IH: "#2563eb", IF: "#16a34a", IC: "#f59e0b", IM: "#dc2626" }
                const series = codes.map((c) => {
                  const arr = (tsData!.data?.[c] || [])
                    .filter((d) => typeof d?.annualized_basis_pct === "number")
                    .map((d) => [d.date, d.annualized_basis_pct as number])
                  return { name: c, type: "line" as const, data: arr, smooth: true, showSymbol: false, lineStyle: { width: 2, color: colorMap[c] } }
                })
                const option = {
                  tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(2)}%` },
                  xAxis: { type: "time", axisLabel: { hideOverlap: true, margin: 10 } },
                  yAxis: { type: "value", axisLabel: { formatter: (v: number) => `${v}%` } },
                  legend: { data: codes, top: 8, left: "center" },
                  grid: { left: "10%", right: "4%", top: 70, bottom: 90, containLabel: true },
                  dataZoom: [{ type: "slider", xAxisIndex: 0, height: 32, bottom: 12 }, { type: "inside", xAxisIndex: 0 }],
                  series,
                }
                return <div className="pb-6"><ReactECharts option={option} style={{ height: 520 }} notMerge lazyUpdate /></div>
              })()
            ) : (
              <div className="text-sm text-muted-foreground">暂无数据</div>
            )}
          </CardContent>
        </Card>
      </div>

        </TabsContent>




        <TabsContent value="bond" className="mt-0">
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            国债期货分析功能即将上线
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
