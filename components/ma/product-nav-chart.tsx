"use client"

import { useCallback, useEffect, useState } from "react"
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

function fmtPct(v: number): string {
  return (v >= 0 ? "+" : "") + (v * 100).toFixed(3) + "%"
}
function fmtNav(v: number): string {
  return v.toFixed(4)
}
function fmtMoney(v: number): string {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rangeFrom, setRangeFrom] = useState("2020-01-01")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (productCode) params.set("product_code", productCode)
      const res = await fetch(`/ma/api/mom-analysis/product-nav?${params}`)
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || "请求失败")
      setAllData(json.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [productCode])

  useEffect(() => { load() }, [load])

  // Filter by rangeFrom
  const displayData = allData.filter((p) => p.date >= rangeFrom)

  // Fix NAV to start at 1.0 for the selected range
  const startNav = displayData.length > 0 ? displayData[0].nav : 1
  const normalizedData = displayData.map((p) => ({
    ...p,
    navNorm: p.nav / startNav,
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

  const option = {
    animation: false,
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      formatter: (params: unknown[]) => {
        const p = (params as { value: [string, number] }[])[0]
        if (!p) return ""
        const date = p.value[0]
        const retPct = p.value[1]
        const pt = normalizedData.find((d) => d.date === date)
        const dailyRet = pt ? fmtPct(pt.dailyReturn) : "—"
        const capital = pt ? fmtMoney(pt.cumCapital) : "—"
        const pnl = pt ? fmtMoney(pt.pnl) : "—"
        const flow = pt && pt.netFlow !== 0 ? `<br/>资金流入 ${fmtMoney(pt.netFlow)}` : ""
        return `<b>${date}</b><br/>收益率 ${retPct >= 0 ? "+" : ""}${retPct.toFixed(2)}%<br/>当日收益 ${dailyRet}<br/>当日盈亏 ${pnl}<br/>累计规模 ${capital}${flow}`
      },
    },
    grid: { left: 60, right: 20, top: 30, bottom: 50 },
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
        lineStyle: { color: "#ef4444", width: 2 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(239,68,68,0.25)" },
              { offset: 1, color: "rgba(239,68,68,0.02)" },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: "none",
          data: [{ yAxis: 0, lineStyle: { color: "#888", type: "dashed", width: 1 }, label: { show: false } }],
        },
      },
    ],
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">净值曲线</CardTitle>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-muted transition-colors"
            title="刷新"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Quick range buttons */}
        <div className="flex gap-1 flex-wrap mt-1">
          {QUICK_RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRangeFrom(r.from())}
              className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                rangeFrom === r.from()
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Stats row */}
        {normalizedData.length > 0 && (
          <div className="flex gap-6 text-xs mt-2">
            <span>
              <span className="text-muted-foreground">累计收益 </span>
              <span className={totalReturn >= 0 ? "text-green-500" : "text-red-500"}>
                {fmtPct(totalReturn)}
              </span>
            </span>
            {annReturn !== null && (
              <span>
                <span className="text-muted-foreground">年化收益 </span>
                <span className={annReturn >= 0 ? "text-green-500" : "text-red-500"}>
                  {fmtPct(annReturn)}
                </span>
              </span>
            )}
            <span>
              <span className="text-muted-foreground">最大回撤 </span>
              <span className="text-red-500">-{(maxDrawdown * 100).toFixed(2)}%</span>
            </span>
            <span>
              <span className="text-muted-foreground">最新净值 </span>
              <span>{fmtNav(lastPoint?.navNorm ?? 1)}</span>
            </span>
          </div>
        )}
      </CardHeader>

      <CardContent className="pt-0">
        {error && (
          <div className="text-sm text-red-500 py-4 text-center">{error}</div>
        )}
        {!error && allData.length === 0 && !loading && (
          <div className="text-sm text-muted-foreground py-4 text-center">
            暂无数据 — 请先导入基金交易记录及日报数据
          </div>
        )}
        {(allData.length > 0 || loading) && (
          <ReactECharts
            option={option}
            style={{ height }}
            notMerge
            lazyUpdate
          />
        )}
      </CardContent>
    </Card>
  )
}
