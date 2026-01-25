"use client"


import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  const [choiceHeatmap, setChoiceHeatmap] = useState<{ trade_date: string; total_amount: number; data: Array<{ name: string; children: Array<{ name: string; value: number; ret: number | null }> }> } | null>(null)
  const [loadingChoiceHeatmap, setLoadingChoiceHeatmap] = useState(true)
  const [errorChoiceHeatmap, setErrorChoiceHeatmap] = useState<string | null>(null)

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/ma/api/nanhua")
        const json = await res.json()
        if (json?.error) {
          setErrorNhci("数据不可用")
        } else if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
          setNhci(json.data)
        } else {
          setErrorNhci("数据不可用")
        }
      } catch (e) {
        setErrorNhci("数据不可用")
      } finally {
        setLoadingNhci(false)
      }
    }
    run()
  }, [])

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/ma/api/basis/far")
        const json = await res.json()
        if (json?.error) {
          setErrorBasis("数据不可用")
        } else if (json?.data && typeof json.data === "object") {
          setBasisFar(json.data)
        } else {
          setErrorBasis("数据不可用")
        }
      } catch (e) {
        setErrorBasis("数据不可用")
      } finally {
        setLoadingBasis(false)
      }
    }
    run()
  }, [])

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/ma/api/basis/near")
        const json = await res.json()
        if (json?.error) {
          setErrorBasisNear("数据不可用")
        } else if (json?.data && typeof json.data === "object") {
          setBasisNear(json.data)
        } else {
          setErrorBasisNear("数据不可用")
        }
      } catch (e) {
        setErrorBasisNear("数据不可用")
      } finally {
        setLoadingBasisNear(false)
      }
    }
    run()
  }, [])

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/ma/api/basis/timeseries")
        const json = await res.json()
        if (json?.error) {
          setErrorBasisTs("数据不可用")
        } else if (json?.data && typeof json.data === "object") {
          setBasisTs({ start_date: json.start_date, end_date: json.end_date, data: json.data })
        } else {
          setErrorBasisTs("数据不可用")
        }
      } catch (e) {
        setErrorBasisTs("数据不可用")
      } finally {
        setLoadingBasisTs(false)
      }
    }
    run()
  }, [])

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/ma/api/basis/diff-timeseries")
        const json = await res.json()
        if (json?.error) {
          setErrorBasisDiffTs("数据不可用")
        } else if (json?.data && typeof json.data === "object") {
          setBasisDiffTs({ start_date: json.start_date, end_date: json.end_date, data: json.data })
        } else {
          setErrorBasisDiffTs("数据不可用")
        }
      } catch (e) {
        setErrorBasisDiffTs("数据不可用")
      } finally {
        setLoadingBasisDiffTs(false)
      }
    }
    run()
  }, [])

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/ma/api/basis/near-timeseries")
        const json = await res.json()
        if (json?.error) {
          setErrorBasisNearTs("数据不可用")
        } else if (json?.data && typeof json.data === "object") {
          setBasisNearTs({ start_date: json.start_date, end_date: json.end_date, data: json.data })
        } else {
          setErrorBasisNearTs("数据不可用")
        }
      } catch (e) {
        setErrorBasisNearTs("数据不可用")
      } finally {
        setLoadingBasisNearTs(false)
      }
    }
    run()
  }, [])

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/ma/api/basis/near-diff-timeseries")
        const json = await res.json()
        if (json?.error) {
          setErrorBasisNearDiffTs("数据不可用")
        } else if (json?.data && typeof json.data === "object") {
          setBasisNearDiffTs({ start_date: json.start_date, end_date: json.end_date, data: json.data })
        } else {
          setErrorBasisNearDiffTs("数据不可用")
        }
      } catch (e) {
        setErrorBasisNearDiffTs("数据不可用")
      } finally {
        setLoadingBasisNearDiffTs(false)
      }
    }
    run()
  }, [])

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/ma/api/basis/cont-diff-timeseries")
        const json = await res.json()
        if (json?.error) {
          setErrorBasisContDiffTs("数据不可用")
        } else if (json?.data && typeof json.data === "object") {
          setBasisContDiffTs({ start_date: json.start_date, end_date: json.end_date, data: json.data })
        } else {
          setErrorBasisContDiffTs("数据不可用")
        }
      } catch (e) {
        setErrorBasisContDiffTs("数据不可用")
      } finally {
        setLoadingBasisContDiffTs(false)
      }
    }
    run()
  }, [])

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/ma/api/choice/amount-heatmap")
        const json = await res.json()
        if (json?.error) {
          setErrorChoiceHeatmap("数据不可用")
        } else if (json?.data && Array.isArray(json.data)) {
          setChoiceHeatmap(json)
        } else {
          setErrorChoiceHeatmap("数据不可用")
        }
      } catch (e) {
        setErrorChoiceHeatmap("数据不可用")
      } finally {
        setLoadingChoiceHeatmap(false)
      }
    }
    run()
  }, [])

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/ma/api/futures/latest")
        const json = await res.json()
        if (json?.error) {
          setErrorFut("数据不可用")
        } else if (json?.data && typeof json.data === "object") {
          setFutLatest(json.data)
        } else {
          setErrorFut("数据不可用")
        }
      } catch (e) {
        setErrorFut("数据不可用")
      } finally {
        setLoadingFut(false)
      }
    }
    run()
  }, [])
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">期货市场分析</h1>
        <p className="text-muted-foreground mt-2">大宗商品期货与合约分析</p>
      </div>


      <div className="max-w-[760px] w-full">
        <Card>
          <CardHeader>
            <CardTitle>南华商品指数</CardTitle>
            <CardDescription>去年至今每日收盘价</CardDescription>
          </CardHeader>
          <CardContent>
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
                const pad = Math.max(5, range * 0.06)
                const yMin = Math.max(0, Math.floor(minVal - pad))
                const yMax = Math.ceil(maxVal + pad)

                const option = {
                  tooltip: { trigger: "axis" },
                  xAxis: { type: "category", data: nhci.map((d) => d.date) },
                  yAxis: { type: "value", min: yMin, max: yMax, scale: true },
                  series: [
                    {
                      type: "line",
                      name: "南华商品指数",
                      data: nhci.map((d) => d.close),
                      smooth: true,
                      lineStyle: { width: 2 },
                      symbolSize: 4,
                    },
                  ],
                }
                return <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate />
              })()
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>远月期指</CardTitle>
            <CardDescription>最新交易日主力合约收盘与结算涨跌幅</CardDescription>
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
                      const priceVal = typeof d?.settle === "number" ? d!.settle : (typeof d?.close === "number" ? d!.close : null)
                      const pctStr = fmtPct(d?.settle_return)
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
                            <div className={`mt-2 text-sm ${typeof d?.far_settle_return === "number" && d!.far_settle_return < 0 ? "text-green-600" : "text-red-600"}`}>
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
            <CardTitle>远月年化基差率</CardTitle>
            <CardDescription>基于最新交易日远月合约与现货</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingBasis ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorBasis ? (
              <div className="text-sm text-destructive">{errorBasis}</div>
            ) : (
              (() => {
                const codes = ["IH", "IF", "IC", "IM"]
                const barsAll = codes.map((c) => ({
                  name: c,
                  value: typeof basisFar?.[c]?.annualized_basis_pct === "number" ? basisFar[c]!.annualized_basis_pct! : null,
                }))
                const bars = barsAll.filter((b) => typeof b.value === "number")
                const hasData = bars.length > 0
                if (!hasData) {
                  return <div className="text-sm text-muted-foreground">暂无数据</div>
                }
                const colorMap: Record<string, string> = {
                  IH: "#2563eb",
                  IF: "#16a34a",
                  IC: "#f59e0b",
                  IM: "#dc2626",
                }
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
                  series: [
                    {
                      type: "bar",
                      data: bars.map((s) => s.value as number),
                      itemStyle: {
                        color: (params: any) => {
                          const name = params?.name as string | undefined
                          return (name && colorMap[name]) || "#888888"
                        },
                      },
                    },
                  ],
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
            <CardTitle>远月年化基差率时序</CardTitle>
            <CardDescription>自2023-01-01至今，主连结算与现货</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingBasisTs ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorBasisTs ? (
              <div className="text-sm text-destructive">{errorBasisTs}</div>
            ) : basisTs && basisTs.data ? (
              (() => {
                const codes = ["IH", "IF", "IC", "IM"]
                const colorMap: Record<string, string> = {
                  IH: "#2563eb",
                  IF: "#16a34a",
                  IC: "#f59e0b",
                  IM: "#dc2626",
                }
                const series = codes.map((c) => {
                  const arr = (basisTs.data?.[c] || [])
                    .filter((d) => typeof d?.annualized_basis_pct === "number")
                    .map((d) => [d.date, d.annualized_basis_pct as number])
                  return {
                    name: c,
                    type: "line" as const,
                    data: arr,
                    smooth: true,
                    showSymbol: false,
                    lineStyle: { width: 2, color: colorMap[c] },
                  }
                })
                const option = {
                  tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(2)}%` },
                  xAxis: { type: "time", axisLabel: { hideOverlap: true, margin: 10 } },
                  yAxis: { type: "value", axisLabel: { formatter: (v: number) => `${v}%` } },
                  legend: { data: codes, top: 8, left: "center" },
                  // Reserve top space for legend; keep bottom for slider
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

      <div className="w-full">
        <Card>
          <CardHeader>
            <CardTitle>远月基差时序</CardTitle>
            <CardDescription>自2023-01-01至今，主连结算 - 现货收盘</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingBasisDiffTs ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorBasisDiffTs ? (
              <div className="text-sm text-destructive">{errorBasisDiffTs}</div>
            ) : basisDiffTs && basisDiffTs.data ? (
              (() => {
                const codes = ["IH", "IF", "IC", "IM"]
                const colorMap: Record<string, string> = {
                  IH: "#2563eb",
                  IF: "#16a34a",
                  IC: "#f59e0b",
                  IM: "#dc2626",
                }
                const series = codes.map((c) => {
                  const arr = (basisDiffTs.data?.[c] || [])
                    .filter((d) => typeof d?.basis_diff === "number")
                    .map((d) => [d.date, d.basis_diff as number])
                  return {
                    name: c,
                    type: "line" as const,
                    data: arr,
                    smooth: true,
                    showSymbol: false,
                    lineStyle: { width: 2, color: colorMap[c] },
                  }
                })
                const option = {
                  tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(2)}` },
                  xAxis: { type: "time", axisLabel: { hideOverlap: true, margin: 10 } },
                  yAxis: { type: "value" },
                  legend: { data: codes, top: 8, left: "center" },
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

      {/* 近月期指（当月连续） — placed under 远月基差时序 */}
      <div className="w-full">
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>近月期指</CardTitle>
              <CardDescription>最新交易日当月连续收盘与结算涨跌幅</CardDescription>
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
                        const priceVal = typeof d?.near_settle === "number" ? d!.near_settle : (typeof d?.near_close === "number" ? d!.near_close : null)
                        const pctStr = fmtPct(d?.near_settle_return)
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
                              <div className={`mt-2 text-sm ${typeof d?.near_settle_return === "number" && d!.near_settle_return < 0 ? "text-green-600" : "text-red-600"}`}>
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
                <CardTitle>近月年化基差率</CardTitle>
                <CardDescription>基于最新交易日当月连续与现货</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingBasisNear ? (
                  <div className="text-sm text-muted-foreground">正在加载…</div>
                ) : errorBasisNear ? (
                  <div className="text-sm text-destructive">{errorBasisNear}</div>
                ) : (
                  (() => {
                    const codes = ["IH", "IF", "IC", "IM"]
                    const barsAll = codes.map((c) => ({
                      name: c,
                      value: typeof basisNear?.[c]?.annualized_basis_pct === "number" ? basisNear[c]!.annualized_basis_pct! : null,
                    }))
                    const bars = barsAll.filter((b) => typeof b.value === "number")
                    const hasData = bars.length > 0
                    if (!hasData) {
                      return <div className="text-sm text-muted-foreground">暂无数据</div>
                    }
                    const colorMap: Record<string, string> = {
                      IH: "#2563eb",
                      IF: "#16a34a",
                      IC: "#f59e0b",
                      IM: "#dc2626",
                    }
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
                      series: [
                        {
                          type: "bar",
                          data: bars.map((s) => s.value as number),
                          itemStyle: {
                            color: (params: any) => {
                              const name = params?.name as string | undefined
                              return (name && colorMap[name]) || "#888888"
                            },
                          },
                        },
                      ],
                    }
                    return <ReactECharts option={option} style={{ height: 300 }} notMerge lazyUpdate />
                  })()
                )}
              </CardContent>
            </Card>
        </div>
      </div>

      <div className="w-full">
        <Card>
          <CardHeader>
            <CardTitle>近月年化基差率时序</CardTitle>
            <CardDescription>自2023-01-01至今，当月连续结算与现货</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingBasisNearTs ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorBasisNearTs ? (
              <div className="text-sm text-destructive">{errorBasisNearTs}</div>
            ) : basisNearTs && basisNearTs.data ? (
              (() => {
                const codes = ["IH", "IF", "IC", "IM"]
                const colorMap: Record<string, string> = {
                  IH: "#2563eb",
                  IF: "#16a34a",
                  IC: "#f59e0b",
                  IM: "#dc2626",
                }
                const series = codes.map((c) => {
                  const arr = (basisNearTs.data?.[c] || [])
                    .filter((d) => typeof d?.annualized_basis_pct === "number")
                    .map((d) => [d.date, d.annualized_basis_pct as number])
                  return {
                    name: c,
                    type: "line" as const,
                    data: arr,
                    smooth: true,
                    showSymbol: false,
                    lineStyle: { width: 2, color: colorMap[c] },
                  }
                })
                const option = {
                  tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(2)}%` },
                  xAxis: { type: "time", axisLabel: { hideOverlap: true, margin: 10 } },
                  yAxis: { type: "value", axisLabel: { formatter: (v: number) => `${v}%` } },
                  legend: { data: codes, top: 8, left: "center" },
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

      <div className="w-full">
        <Card>
          <CardHeader>
            <CardTitle>近月基差时序</CardTitle>
            <CardDescription>自2023-01-01至今，当月连续结算 - 现货收盘</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingBasisNearDiffTs ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorBasisNearDiffTs ? (
              <div className="text-sm text-destructive">{errorBasisNearDiffTs}</div>
            ) : basisNearDiffTs && basisNearDiffTs.data ? (
              (() => {
                const codes = ["IH", "IF", "IC", "IM"]
                const colorMap: Record<string, string> = {
                  IH: "#2563eb",
                  IF: "#16a34a",
                  IC: "#f59e0b",
                  IM: "#dc2626",
                }
                const series = codes.map((c) => {
                  const arr = (basisNearDiffTs.data?.[c] || [])
                    .filter((d) => typeof d?.basis_diff === "number")
                    .map((d) => [d.date, d.basis_diff as number])
                  return {
                    name: c,
                    type: "line" as const,
                    data: arr,
                    smooth: true,
                    showSymbol: false,
                    lineStyle: { width: 2, color: colorMap[c] },
                  }
                })
                const option = {
                  tooltip: { trigger: "axis", valueFormatter: (v: number) => `${v.toFixed(2)}` },
                  xAxis: { type: "time", axisLabel: { hideOverlap: true, margin: 10 } },
                  yAxis: { type: "value" },
                  legend: { data: codes, top: 8, left: "center" },
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

      <div className="w-full">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>四大连续合约基差时序</CardTitle>
                <CardDescription>当月/次月/当季/下季 结算 - 现货收盘</CardDescription>
              </div>
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

      <div className="w-full">
        <Card>
          <CardHeader>
            <CardTitle>商品期货 日成交额排行</CardTitle>
            <CardDescription>按板块分组，颜色按板块</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingChoiceHeatmap ? (
              <div className="text-sm text-muted-foreground">正在加载…</div>
            ) : errorChoiceHeatmap ? (
              <div className="text-sm text-destructive">{errorChoiceHeatmap}</div>
            ) : choiceHeatmap && choiceHeatmap.data ? (
              (() => {
                const sectorBaseColors: Record<string, string> = {
                  "农产": "#10b981",      // emerald
                  "贵金属": "#f59e0b",    // amber
                  "有色": "#3b82f6",      // blue
                  "新能源": "#22c55e",    // green
                  "黑色": "#6b7280",      // gray
                  "能源化工": "#ef4444",  // red
                  "航运": "#8b5cf6",      // purple
                  "股指": "#0ea5e9",      // sky
                  "国债": "#14b8a6",      // teal
                  "其他": "#9ca3af",      // neutral
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
                // Adjust brightness by factor (-0.35..+0.35) to create distinct shades per product
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
                  // Create a spread of factors so each child has a distinct color within the sector palette
                  const factors = Array.from({ length: n }, (_, i) => {
                    const t = n === 1 ? 0.15 : (i / (n - 1)) // 0..1
                    return (t * 0.7) - 0.35 // range ~ -0.35 .. +0.35
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

      {/* Removed 大宗商品价格 chart */}

      {/* Removed 期货曲线 and 合约统计 charts */}
    </div>
  )
}
