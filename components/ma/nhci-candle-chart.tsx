"use client"

import { useCallback, useEffect, useState } from "react"
import ReactECharts from "echarts-for-react"
import { RefreshCw, TableIcon, BarChart2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// ── Product labels (for stats table) ─────────────────────────────────────────
const PRODUCT_LABEL: Record<string, string> = {
  A:"黄大豆1", AD:"铝合金", AG:"白银", AL:"沪铝", AO:"氧化铝", AP:"苹果",
  AU:"黄金", B:"黄大豆2", BB:"胶合板", BC:"国际铜", BR:"丁二烯", BU:"沥青",
  BZ:"纯苯", C:"玉米", CF:"棉花", CJ:"红枣", CS:"玉米淀粉", CU:"沪铜",
  CY:"棉纱", EB:"苯乙烯", EC:"航运", EG:"乙二醇", FB:"纤维板", FG:"玻璃",
  FU:"燃料油", HC:"热卷", I:"铁矿石", IC:"中证500", IF:"沪深300", IH:"上证50",
  IM:"中证1000", J:"焦炭", JD:"鸡蛋", JM:"焦煤", JR:"粳稻", L:"塑料",
  LC:"碳酸锂", LG:"原木", LH:"生猪", LR:"晚籼稻", LU:"低硫油", M:"豆粕",
  MA:"甲醇", NI:"沪镍", NR:"20号胶", OI:"菜籽油", OP:"双胶纸", P:"棕榈油",
  PB:"沪铅", PD:"钯", PF:"短纤", PG:"液化气", PK:"花生", PL:"丙烯",
  PM:"普麦", PP:"聚丙烯", PR:"瓶片", PS:"多晶硅", PT:"铂", PX:"对二甲苯",
  RB:"螺纹钢", RI:"早籼稻", RM:"菜籽粕", RR:"粳米", RS:"油菜籽", RU:"天胶",
  SA:"纯碱", SC:"原油", SF:"硅铁", SH:"烧碱", SI:"工业硅", SM:"锰硅",
  SN:"沪锡", SP:"纸浆", SR:"白糖", SS:"不锈钢", T:"10年债", TA:"PTA",
  TF:"5年债", TL:"30年债", TS:"2年债", UR:"尿素", V:"PVC", WH:"强麦",
  WR:"线材", Y:"豆油", ZC:"动力煤", ZN:"沪锌",
}
function prodLabel(code: string) {
  return PRODUCT_LABEL[code] ? `${PRODUCT_LABEL[code]}(${code})` : code
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CandleRow = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type ApiResponse = {
  ok: boolean
  data: CandleRow[]
  error?: string
}

type ProductStat = {
  product: string
  totalPnl: number
  tradingDays: number
  closeTrades: number
  winRate: number
  sharpe: number | null
  maxDdPct: number
  profitFactor: number | null
  firstDate: string
  lastDate: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period - 1) return null
    const sum = closes.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0)
    return parseFloat((sum / period).toFixed(4))
  })
}

function isoToday() {
  return new Date().toISOString().slice(0, 10)
}
function isoMonthOffset(months: number) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

const QUICK_RANGES = [
  { label: "近一月", from: () => isoMonthOffset(-1),  to: () => isoToday() },
  { label: "近三月", from: () => isoMonthOffset(-3),  to: () => isoToday() },
  { label: "近六月", from: () => isoMonthOffset(-6),  to: () => isoToday() },
  { label: "近一年", from: () => isoMonthOffset(-12), to: () => isoToday() },
  { label: "全部",   from: () => "2025-01-01",         to: () => isoToday() },
]

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  code?:         string
  title?:        string
  height?:       number
  from?:         string   // controlled: parent can drive the date range
  to?:           string
  fallbackCode?: string   // akshare code to use when NH index has no data
  account?:      string   // when provided, enables the per-product stats table toggle
  onProductSelect?: (product: string) => void
}

export default function NhciCandleChart({
  code  = "NHCI.NH",
  title = "南华商品指数（NHCI.NH）日K线",
  height = 300,
  from: propFrom,
  to:   propTo,
  fallbackCode,
  account,
  onProductSelect,
}: Props) {
  const [fromDate, setFromDate] = useState(() => propFrom ?? isoMonthOffset(-6))
  const [toDate,   setToDate]   = useState(() => propTo   ?? isoToday())
  const [data,     setData]     = useState<CandleRow[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  // ── Stats table state ──────────────────────────────────────────────────────
  const [showTable,    setShowTable]    = useState(false)
  const [tableData,    setTableData]    = useState<ProductStat[] | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [tableError,   setTableError]   = useState<string | null>(null)

  // When account prop changes, auto-refresh table if visible; else clear stale cache
  useEffect(() => {
    if (!account) return
    setTableData(null)
    setTableError(null)
    if (showTable) {
      const acct = account
      setTableLoading(true)
      fetch(`/ma/api/mom-analysis/account-product-summary?account=${encodeURIComponent(acct)}`)
        .then(r => r.json())
        .then(d => {
          if (!d.ok) throw new Error(d.error || "加载失败")
          setTableData(d.rows)
        })
        .catch(e => setTableError(e instanceof Error ? e.message : "加载失败"))
        .finally(() => setTableLoading(false))
    }
  }, [account]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadTable = useCallback(async (acct: string) => {
    if (tableData) { setShowTable(true); return }   // already loaded
    setTableLoading(true)
    setTableError(null)
    try {
      const res = await fetch(`/ma/api/mom-analysis/account-product-summary?account=${encodeURIComponent(acct)}`)
      const d = await res.json()
      if (!d.ok) throw new Error(d.error || "加载失败")
      setTableData(d.rows)
    } catch (e) {
      setTableError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setTableLoading(false)
      setShowTable(true)
    }
  }, [tableData])

  const load = useCallback(async (from: string, to: string, loadCode: string) => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams()
      if (from) p.set("from", from)
      if (to)   p.set("to",   to)
      p.set("code", loadCode)
      if (fallbackCode) p.set("fallbackCode", fallbackCode)
      const res = await fetch(`/ma/api/mom-analysis/nhci-candle?${p}`)
      const d: ApiResponse = await res.json()
      if (!d.ok) throw new Error(d.error || "加载失败")
      setData(d.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(fromDate, toDate, code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload when code (sector index) changes
  useEffect(() => {
    load(fromDate, toDate, code)
  }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync when parent-controlled from/to props change
  useEffect(() => {
    if (propFrom && propTo) {
      setFromDate(propFrom)
      setToDate(propTo)
      load(propFrom, propTo, code)
    }
  }, [propFrom, propTo]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Chart data ─────────────────────────────────────────────────────────────

  const dates  = data.map(r => r.date)
  const ohlcv  = data.map(r => [r.open, r.close, r.low, r.high])
  const closes = data.map(r => r.close)
  const ma5    = calcMA(closes, 5)
  const ma20   = calcMA(closes, 20)

  const volumes = data.map(r => ({
    value: r.volume ?? 0,
    itemStyle: { color: r.close >= r.open ? "#ef4444" : "#22c55e" },
  }))
  const hasVolume = volumes.some(v => (v.value ?? 0) > 0)

  // ── ECharts option ─────────────────────────────────────────────────────────

  const option = {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const candle = params.find((p: any) => p.seriesName === "NHCI")
        if (!candle) return ""
        const [o, c, l, h] = candle.data as number[]
        const arrow = c >= o
          ? `<span style="color:#ef4444">▲</span>`
          : `<span style="color:#22c55e">▼</span>`
        const lines = [
          `<b>${candle.axisValue}</b> ${arrow}`,
          `开&nbsp;${o?.toFixed(2)}&nbsp;&nbsp;收&nbsp;<b>${c?.toFixed(2)}</b>`,
          `高&nbsp;${h?.toFixed(2)}&nbsp;&nbsp;低&nbsp;${l?.toFixed(2)}`,
        ]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ma5p  = params.find((p: any) => p.seriesName === "MA5")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ma20p = params.find((p: any) => p.seriesName === "MA20")
        if (ma5p?.data  != null) lines.push(`MA5&nbsp;&nbsp;${Number(ma5p.data).toFixed(2)}`)
        if (ma20p?.data != null) lines.push(`MA20&nbsp;${Number(ma20p.data).toFixed(2)}`)
        return lines.join("<br/>")
      },
    },
    legend: {
      top: 4,
      data: ["NHCI", "MA5", "MA20"],
      textStyle: { fontSize: 11 },
    },
    grid: [
      { left: 64, right: 16, top: 36, bottom: hasVolume ? 130 : 56 },
      ...(hasVolume ? [{ left: 64, right: 16, top: "73%", bottom: 56 }] : []),
    ],
    xAxis: [
      {
        type: "category",
        data: dates,
        gridIndex: 0,
        axisLabel: { show: false },
        axisPointer: { label: { show: false } },
        boundaryGap: true,
      },
      ...(hasVolume
        ? [{
            type: "category",
            data: dates,
            gridIndex: 1,
            axisLabel: { fontSize: 10, rotate: 30 },
            boundaryGap: true,
          }]
        : []),
    ],
    yAxis: [
      {
        scale: true,
        gridIndex: 0,
        axisLabel: { fontSize: 10 },
        splitLine: { lineStyle: { opacity: 0.2 } },
      },
      ...(hasVolume
        ? [{
            gridIndex: 1,
            axisLabel: { show: false },
            splitLine: { show: false },
          }]
        : []),
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: hasVolume ? [0, 1] : [0],
        start: 0,
        end: 100,
      },
      {
        type: "slider",
        xAxisIndex: hasVolume ? [0, 1] : [0],
        bottom: 12,
        height: 28,
      },
    ],
    series: [
      {
        name: "NHCI",
        type: "candlestick",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ohlcv,
        itemStyle: {
          color:        "#ef4444",
          color0:       "#22c55e",
          borderColor:  "#ef4444",
          borderColor0: "#22c55e",
        },
      },
      {
        name: "MA5",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ma5,
        smooth: false,
        lineStyle: { width: 1.5, color: "#f59e0b" },
        symbol: "none",
        connectNulls: true,
      },
      {
        name: "MA20",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: ma20,
        smooth: false,
        lineStyle: { width: 1.5, color: "#8b5cf6" },
        symbol: "none",
        connectNulls: true,
      },
      ...(hasVolume
        ? [{
            name: "成交量",
            type: "bar",
            xAxisIndex: 1,
            yAxisIndex: 1,
            data: volumes,
            barMaxWidth: 8,
          }]
        : []),
    ],
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">
            {showTable && account ? `${account.toUpperCase()} 全品种全周期统计表` : title}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {/* quick-range buttons */}
            <div className="flex items-center gap-1">
              {QUICK_RANGES.map(r => {
                const active = fromDate === r.from() && toDate === r.to()
                return (
                  <button
                    key={r.label}
                    onClick={() => {
                      const f = r.from()
                      const t = r.to()
                      setFromDate(f)
                      setToDate(t)
                      load(f, t, code)
                    }}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    }`}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
            {/* manual date pickers */}
            <div className="flex items-center gap-1 text-xs">
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="rounded border border-input bg-background px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-muted-foreground">—</span>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="rounded border border-input bg-background px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => load(fromDate, toDate, code)}
              disabled={loading}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
            {account && (
              <Button
                size="sm"
                variant={showTable ? "default" : "outline"}
                onClick={() => {
                  if (showTable) { setShowTable(false) }
                  else { loadTable(account) }
                }}
                className="h-7 px-2 text-xs gap-1"
              >
                {showTable
                  ? <><BarChart2 className="h-3 w-3" />回到K线</>
                  : <><TableIcon className="h-3 w-3" />全品种统计</>}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-2 pb-4">
        {/* ── Stats table view ─────────────────────────────────────────── */}
        {showTable && (
          <div style={{ height, overflowY: "auto", position: "relative" }}>
            {tableLoading && (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">加载中…</div>
            )}
            {tableError && (
              <div className="flex items-center justify-center h-full text-sm text-destructive">{tableError}</div>
            )}
            {!tableLoading && !tableError && tableData && (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="px-2 py-1.5 text-center font-medium sticky top-0 z-10 bg-card">序号</th>
                    <th className="px-2 py-1.5 text-left font-medium sticky top-0 z-10 bg-card">品种</th>
                    <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-card">总盈亏(元)</th>
                    <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-card">交易天数</th>
                    <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-card">日胜率</th>
                    <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-card">盈亏比</th>
                    <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-card">夏普比率</th>
                    <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-card">最大回撤</th>
                    <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-card">平仓笔数</th>
                    <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-card">首次交易</th>
                    <th className="px-2 py-1.5 text-right font-medium sticky top-0 z-10 bg-card">最近交易</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((r, i) => {
                    const pnlColor = r.totalPnl > 0 ? "text-red-500" : r.totalPnl < 0 ? "text-green-600" : ""
                    return (
                      <tr key={r.product} className={`border-b border-border/50 hover:bg-muted/40 ${i % 2 === 0 ? "" : "bg-muted/20"} ${onProductSelect ? "cursor-pointer" : ""}`} onClick={() => onProductSelect?.(r.product)}>
                        <td className="px-2 py-1.5 text-center text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1.5 font-medium whitespace-nowrap">{prodLabel(r.product)}</td>
                        <td className={`px-2 py-1.5 text-right font-medium ${pnlColor}`}>
                          {r.totalPnl >= 0 ? "+" : ""}{r.totalPnl.toLocaleString()}
                        </td>
                        <td className="px-2 py-1.5 text-right">{r.tradingDays}</td>
                        <td className="px-2 py-1.5 text-right">{(r.winRate * 100).toFixed(1)}%</td>
                        <td className="px-2 py-1.5 text-right">
                          {r.profitFactor != null ? r.profitFactor.toFixed(2) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {r.sharpe != null ? r.sharpe.toFixed(2) : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          -{(r.maxDdPct * 100).toFixed(1)}%
                        </td>
                        <td className="px-2 py-1.5 text-right">{r.closeTrades}</td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground">{r.firstDate}</td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground">{r.lastDate}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
        {/* ── Candle chart view ────────────────────────────────────────── */}
        {!showTable && error && (
          <div className="flex items-center justify-center text-sm text-destructive" style={{ height }}>
            {error}
          </div>
        )}
        {!showTable && !error && loading && (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            加载中…
          </div>
        )}
        {!showTable && !error && !loading && data.length === 0 && (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            暂无数据
          </div>
        )}
        {!showTable && !error && !loading && data.length > 0 && (
          <ReactECharts
            option={option}
            style={{ height: `${height}px` }}
            notMerge={true}
          />
        )}
      </CardContent>
    </Card>
  )
}
