"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { BarChart2, Download, RefreshCw, TableIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// ── Types ─────────────────────────────────────────────────────────────────────

interface CandleRow {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface ApiData {
  ok: boolean
  data: CandleRow[]
  product: string
  error?: string
}

interface AccountStat {
  account: string
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

// ── CSV download ──────────────────────────────────────────────────────────────

function downloadTableCsv(rows: AccountStat[], product: string) {
  const headers = ["序号","账户","总盈亏(元)","交易天数","日胜率(%)","盈亏比","夏普比率","最大回撤(%)","平仓笔数","首次交易","最近交易"]
  const lines = [
    headers.join(","),
    ...rows.map((r, i) => [
      i + 1,
      r.account,
      r.totalPnl,
      r.tradingDays,
      (r.winRate * 100).toFixed(1),
      r.profitFactor != null ? r.profitFactor.toFixed(2) : "",
      r.sharpe != null ? r.sharpe.toFixed(2) : "",
      (r.maxDdPct * 100).toFixed(1),
      r.closeTrades,
      r.firstDate,
      r.lastDate,
    ].join(","))
  ]
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${prodLabel(product)}_全账户统计.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Label map (shared with cross-account-chart) ───────────────────────────────

const PRODUCT_LABEL: Record<string, string> = {
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

function prodLabel(code: string) {
  return PRODUCT_LABEL[code] ? `${PRODUCT_LABEL[code]}(${code})` : code
}
// ── Quick ranges ────────────────────────────────────────────────────────────

function isoToday() { return new Date().toISOString().slice(0, 10) }
function isoMonthOffset(m: number) {
  const d = new Date(); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10)
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
  product?: string
  from?: string
  to?: string
  height?: number
}

export default function ProductCandleChart({
  product: propProduct = "AU",
  from: propFrom,
  to: propTo,
  height = 360,
}: Props) {
  const [fromDate, setFromDate] = useState(() => propFrom ?? isoMonthOffset(-6))
  const [toDate,   setToDate]   = useState(() => propTo   ?? isoToday())

  const [data,         setData]         = useState<ApiData | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  // ── table mode ────────────────────────────────────────────────────────────
  const [showTable,    setShowTable]    = useState(false)
  const [tableData,    setTableData]    = useState<AccountStat[] | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [tableError,   setTableError]   = useState<string | null>(null)

  const load = useCallback(async (prod: string, from: string, to: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ product: prod, from, to })
      const res  = await fetch(`/ma/api/mom-analysis/product-candle?${params}`)
      const json: ApiData = await res.json()
      if (!json.ok) throw new Error(json.error || "请求失败")
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTable = useCallback(async (prod: string) => {
    if (tableData) { setShowTable(true); return }
    setTableLoading(true)
    setTableError(null)
    try {
      const res  = await fetch(`/ma/api/mom-analysis/product-account-summary?product=${encodeURIComponent(prod)}`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || "加载失败")
      setTableData(json.rows as AccountStat[])
    } catch (e) {
      setTableError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setTableLoading(false)
      setShowTable(true)
    }
  }, [tableData])

  // Sync parent-driven date props into local state
  useEffect(() => {
    if (propFrom && propTo) {
      setFromDate(propFrom)
      setToDate(propTo)
      load(propProduct, propFrom, propTo)
    }
  }, [propFrom, propTo]) // eslint-disable-line

  // Reload (and clear table) when selected product changes
  useEffect(() => {
    load(propProduct, fromDate, toDate)
    setTableData(null)
    setTableError(null)
  }, [propProduct]) // eslint-disable-line

  // ── ECharts option ──────────────────────────────────────────────────────────

  const option = useMemo<object>(() => {
    if (!data || data.data.length === 0) return {}
    const rows = data.data

    const dates   = rows.map(r => r.date.slice(5)) // MM-DD
    const candles = rows.map(r => [r.open, r.close, r.low, r.high])
    const volumes = rows.map(r => r.volume)
    const maxVol  = Math.max(...volumes, 1)

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) => {
          const idx  = params[0]?.dataIndex as number
          const row  = rows[idx]
          if (!row) return ""
          const up   = row.close >= row.open
          const col  = up ? "#ef4444" : "#22c55e"
          const sq   = up ? `<span style="color:#ef4444">▪</span>` : `<span style="color:#22c55e">▪</span>`
          let html   = `<div style="font-size:11px;margin-bottom:2px;font-weight:600">${row.date}</div>`
          html += `<div style="font-size:11px">${sq} 开: <b style="color:${col}">${row.open}</b>&nbsp; 收: <b style="color:${col}">${row.close}</b></div>`
          html += `<div style="font-size:11px">高: ${row.high}&nbsp; 低: ${row.low}</div>`
          if (row.volume > 0) {
            const v = row.volume >= 10000 ? `${(row.volume / 10000).toFixed(1)}万手` : `${row.volume}手`
            html += `<div style="font-size:11px">成交量: ${v}</div>`
          }
          return html
        },
      },
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: [
        { left: 58, right: 16, top: 12,  bottom: 80, height: "62%" },
        { left: 58, right: 16, top: "76%", bottom: 34 },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1], start: 0, end: 100 },
        { type: "slider", xAxisIndex: [0, 1], bottom: 2, height: 18,
          borderColor: "transparent",
          fillerColor: "rgba(148,163,184,0.15)",
          handleStyle: { color: "#94a3b8" },
          dataBackground: { lineStyle: { color: "#94a3b8" }, areaStyle: { color: "rgba(148,163,184,0.1)" } },
        },
      ],
      xAxis: [
        {
          type: "category", gridIndex: 0, data: dates, boundaryGap: false,
          axisLabel: { show: false },
          axisLine: { lineStyle: { color: "rgba(148,163,184,0.3)" } },
          splitLine: { show: false },
        },
        {
          type: "category", gridIndex: 1, data: dates, boundaryGap: false,
          axisLabel: { fontSize: 10, formatter: (v: string) => v },
          axisLine: { lineStyle: { color: "rgba(148,163,184,0.3)" } },
          splitLine: { show: false },
        },
      ],
      yAxis: [
        {
          type: "value", gridIndex: 0, scale: true,
          axisLabel: { fontSize: 10 },
          splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,0.2)" } },
        },
        {
          type: "value", gridIndex: 1, scale: true,
          axisLabel: { fontSize: 9, formatter: (v: number) => v >= 10000 ? `${(v/10000).toFixed(0)}w` : `${v}` },
          splitLine: { show: false },
          max: maxVol * 3, // keep bars from filling the grid
        },
      ],
      series: [
        {
          name: "K线",
          type: "candlestick",
          xAxisIndex: 0, yAxisIndex: 0,
          data: candles,
          itemStyle: {
            color: "#ef4444",   color0: "#22c55e",
            borderColor: "#ef4444", borderColor0: "#22c55e",
          },
        },
        {
          name: "成交量",
          type: "bar",
          xAxisIndex: 1, yAxisIndex: 1,
          data: volumes,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          itemStyle: { color: (p: any) => rows[p.dataIndex]?.close >= rows[p.dataIndex]?.open ? "#ef4444" : "#22c55e" },
          barMaxWidth: 8,
        },
      ],
    }
  }, [data])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">
            {showTable
              ? `${prodLabel(propProduct)} 全账户全周期统计表`
              : `${prodLabel(propProduct)} — 主连K线`}
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
                      const f = r.from(); const t = r.to()
                      setFromDate(f); setToDate(t)
                      load(propProduct, f, t)
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
                type="date" value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="rounded border border-input bg-background px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-muted-foreground">—</span>
              <input
                type="date" value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="rounded border border-input bg-background px-2 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <Button
              size="sm" variant="outline"
              onClick={() => load(propProduct, fromDate, toDate)}
              disabled={loading}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
            {showTable && tableData && (
              <Button size="sm" variant="outline" onClick={() => downloadTableCsv(tableData, propProduct)} className="h-7 px-2 text-xs gap-1">
                <Download className="h-3 w-3" />下载
              </Button>
            )}
            <Button
              size="sm"
              variant={showTable ? "default" : "outline"}
              onClick={() => {
                if (showTable) { setShowTable(false) }
                else { loadTable(propProduct) }
              }}
              className="h-7 px-2 text-xs gap-1"
            >
              {showTable
                ? <><BarChart2 className="h-3 w-3" />回到K线</>
                : <><TableIcon className="h-3 w-3" />全账户统计</>}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-3">
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
                    <th className="px-2 py-1 text-center font-medium sticky top-0 z-10 bg-card">序号</th>
                    <th className="px-2 py-1 text-left font-medium sticky top-0 z-10 bg-card">账户</th>
                    <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-card">总盈亏(元)</th>
                    <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-card">交易天数</th>
                    <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-card">日胜率</th>
                    <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-card">盈亏比</th>
                    <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-card">夏普比率</th>
                    <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-card">最大回撤</th>
                    <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-card">平仓笔数</th>
                    <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-card">首次交易</th>
                    <th className="px-2 py-1 text-right font-medium sticky top-0 z-10 bg-card">最近交易</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((r, i) => {
                    const pnlColor = r.totalPnl > 0 ? "text-red-500" : r.totalPnl < 0 ? "text-green-600" : ""
                    return (
                      <tr key={r.account} className={`border-b border-border/50 hover:bg-muted/40 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                        <td className="px-2 py-1 text-center text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1 font-medium whitespace-nowrap">{r.account}</td>
                        <td className={`px-2 py-1 text-right font-medium ${pnlColor}`}>
                          {r.totalPnl >= 0 ? "+" : ""}{r.totalPnl.toLocaleString()}
                        </td>
                        <td className="px-2 py-1 text-right">{r.tradingDays}</td>
                        <td className="px-2 py-1 text-right">{(r.winRate * 100).toFixed(1)}%</td>
                        <td className="px-2 py-1 text-right">
                          {r.profitFactor != null ? r.profitFactor.toFixed(2) : "—"}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {r.sharpe != null ? r.sharpe.toFixed(2) : "—"}
                        </td>
                        <td className="px-2 py-1 text-right">-{(r.maxDdPct * 100).toFixed(1)}%</td>
                        <td className="px-2 py-1 text-right">{r.closeTrades}</td>
                        <td className="px-2 py-1 text-right text-muted-foreground">{r.firstDate}</td>
                        <td className="px-2 py-1 text-right text-muted-foreground">{r.lastDate}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
        {/* ── Candle chart view ────────────────────────────────────────── */}
        {!showTable && loading && (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            加载中…
          </div>
        )}
        {!showTable && !loading && error && (
          <div className="flex items-center justify-center text-sm text-destructive" style={{ height }}>
            {error}
          </div>
        )}
        {!showTable && !loading && !error && data && data.data.length === 0 && (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            暂无行情数据
          </div>
        )}
        {!showTable && !loading && !error && data && data.data.length > 0 && (
          <ReactECharts option={option} style={{ height: `${height}px` }} notMerge={true} />
        )}
      </CardContent>
    </Card>
  )
}
