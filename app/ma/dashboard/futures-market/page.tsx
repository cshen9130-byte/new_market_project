"use client"


import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useEffect, useState } from "react"
import ReactECharts from "echarts-for-react"
import { MoreVertical } from "lucide-react"

// Removed placeholder commodity and futures charts

export default function FuturesMarketPage() {
  const [nhci, setNhci] = useState<Array<{ date: string; close: number }>>([])
  const [loadingNhci, setLoadingNhci] = useState(true)
  const [errorNhci, setErrorNhci] = useState<string | null>(null)

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
    <div className="space-y-6">
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


      <div className="w-full">
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
                const values = nhci
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
                    data: nhci.map((d) => d.date),
                    axisLine: { lineStyle: { color: "#334155" } },
                    axisTick: { show: false },
                    axisLabel: {
                      color: "#64748b",
                      fontSize: 11,
                      interval: Math.max(1, Math.floor(nhci.length / 7)),
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
                      data: nhci.map((d) => d.close),
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
