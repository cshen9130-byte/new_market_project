"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// ── Types ─────────────────────────────────────────────────────────────────────

interface AccountSeries {
  account: string
  data: { date: string; pct: number }[]
}

interface ApiData {
  ok: boolean
  accounts: string[]
  series: AccountSeries[]
  benchmark: { date: string; pct: number }[]
  error?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCOUNT_COLORS = [
  "#f87171", "#60a5fa", "#4ade80", "#facc15", "#c084fc",
  "#fb923c", "#34d399", "#38bdf8", "#a78bfa", "#f472b6",
  "#e879f9", "#2dd4bf", "#fbbf24", "#818cf8", "#fb7185",
]

const PRODUCT_LABEL: Record<string, string> = {
  A:"黄大豆1号", AD:"铝合金", AG:"白银", AL:"沪铝", AO:"氧化铝", AP:"苹果",
  AU:"黄金", B:"黄大豆2号", BB:"胶合板", BC:"国际铜", BR:"丁二烯橡胶", BU:"沥青",
  BZ:"纯苯", C:"玉米", CF:"棉花", CJ:"红枣", CS:"玉米淀粉", CU:"沪铜",
  CY:"棉纱", EB:"苯乙烯", EC:"航运", EG:"乙二醇", FB:"纤维板", FG:"玻璃",
  FU:"燃料油", HC:"热卷", I:"铁矿石", IC:"中证500股指", IF:"沪深300股指",
  IH:"上证50股指", IM:"中证1000股指", J:"焦炭", JD:"鸡蛋", JM:"焦煤",
  JR:"粳稻", L:"塑料", LC:"碳酸锂", LG:"原木",  LH:"生猪", LR:"晚籼稻",
  LU:"低硫燃料油", M:"豆粕", MA:"甲醇", NI:"沪镍", NR:"20号胶", OI:"菜籽油",
  OP:"双胶纸", P:"棕榈油", PB:"沪铅", PD:"钯", PF:"短纤", PG:"液化石油气",
  PK:"花生", PL:"丙烯", PM:"普麦", PP:"聚丙烯", PR:"瓶片", PS:"多晶硅",
  PT:"铂", PX:"对二甲苯", RB:"螺纹钢", RI:"早籼稻", RM:"菜籽粕", RR:"粳米",
  RS:"油菜籽", RU:"天然橡胶", SA:"纯碱", SC:"原油", SF:"硅铁", SH:"烧碱",
  SI:"工业硅", SM:"锰硅", SN:"沪锡", SP:"纸浆", SR:"白糖", SS:"不锈钢",
  T:"10年期国债", TA:"PTA", TF:"5年期国债", TL:"30年期国债", TS:"2年期国债",
  UR:"尿素", V:"PVC", WH:"强麦", WR:"线材", Y:"豆油", ZC:"动力煤", ZN:"沪锌",
}

function prodLabel(code: string) {
  return PRODUCT_LABEL[code] ? `${PRODUCT_LABEL[code]}(${code})` : code
}

// ── Quick ranges ─────────────────────────────────────────────────────────────

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

const SECTOR_RULES: Record<string, Set<string>> = {
  "农产":    new Set(["C","CS","WH","PM","RR","RI","JR","LR","A","B","M","Y","RM","OI","RS","PK","P","SR","CF","CY","AP","CJ","LH","JD","LG","SP","OP"]),
  "贵金属":  new Set(["AU","AG","PT","PD"]),
  "有色":    new Set(["CU","BC","AL","AO","AD","ZN","PB","NI","SN"]),
  "新能源":  new Set(["LC","PS","SI"]),
  "黑色":    new Set(["I","SF","SM","RB","HC","SS","WR","JM","J","ZC","FG","BB","FB"]),
  "能源化工":new Set(["SC","FU","LU","PG","BU","TA","EG","PF","PR","PL","PP","L","BZ","PX","EB","RU","BR","NR","SA","SH","V","UR","MA"]),
  "航运":    new Set(["EC"]),
  "股指":    new Set(["IH","IF","IC","IM"]),
  "国债":    new Set(["TS","TF","T","TL"]),
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  defaultProduct?: string
  from?: string
  to?: string
  height?: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CrossAccountChart({
  defaultProduct = "AU",
  from: propFrom,
  to: propTo,
  height = 360,
}: Props) {
  const [product,  setProduct]  = useState(defaultProduct)
  const [inputVal, setInputVal] = useState(defaultProduct)
  const [from,     setFrom]     = useState(propFrom ?? isoMonthOffset(-6))
  const [to,       setTo]       = useState(propTo   ?? isoToday())
  const [activeRange, setActiveRange] = useState("近六月")
  const [sector,   setSector]   = useState("全部")
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const [data,     setData]     = useState<ApiData | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  // Fetch available products from meta endpoint
  useEffect(() => {
    fetch("/ma/api/mom-analysis/au-trading/meta")
      .then(r => r.json())
      .then((m: { ok: boolean; products?: string[] }) => {
        if (m.ok && m.products?.length) setAvailableProducts(m.products)
      })
      .catch(() => {})
  }, [])

  const load = useCallback(async (f: string, t: string, prod: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ product: prod, from: f, to: t })
      const res  = await fetch(`/ma/api/mom-analysis/cross-account-comparison?${params}`)
      const json: ApiData = await res.json()
      if (!json.ok) throw new Error(json.error || "请求失败")
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { load(from, to, product) }, []) // eslint-disable-line

  // React to parent date range changes
  useEffect(() => {
    if (propFrom && propTo && (propFrom !== from || propTo !== to)) {
      setFrom(propFrom)
      setTo(propTo)
      load(propFrom, propTo, product)
    }
  }, [propFrom, propTo]) // eslint-disable-line

  // React to parent product changes
  useEffect(() => {
    if (defaultProduct && defaultProduct !== product) {
      setProduct(defaultProduct)
      setInputVal(defaultProduct)
      load(from, to, defaultProduct)
    }
  }, [defaultProduct]) // eslint-disable-line

  // ── ECharts option ──────────────────────────────────────────────────────────

  const option = useMemo<object>(() => {
    if (!data) return {}
    const noData = data.series.length === 0 && data.benchmark.length === 0
    if (noData) return {}

    // Build unified sorted date axis
    const dateSet = new Set<string>()
    for (const s of data.series) for (const d of s.data) dateSet.add(d.date)
    for (const b of data.benchmark) dateSet.add(b.date)
    const allDates = [...dateSet].sort()

    // Lookup maps for O(1) access
    const seriesLookups = data.series.map((s) => new Map(s.data.map((d) => [d.date, d.pct])))
    const bmLookup      = new Map(data.benchmark.map((b) => [b.date, b.pct]))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chartSeries: any[] = [
      ...data.series.map((s, i) => ({
        name: s.account.toUpperCase(),
        type: "line",
        smooth: false,
        symbol: "none",
        lineStyle: { width: 1.5, color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] },
        itemStyle: { color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] },
        data: allDates.map((d) => seriesLookups[i].has(d) ? seriesLookups[i].get(d)! : null),
        connectNulls: true,
      })),
      ...(data.benchmark.length > 0 ? [{
        name: `${PRODUCT_LABEL[product] ?? product}主连`,
        type: "line",
        smooth: false,
        symbol: "none",
        lineStyle: { width: 1.5, color: "#94a3b8", type: "dashed" },
        itemStyle: { color: "#94a3b8" },
        data: allDates.map((d) => bmLookup.has(d) ? bmLookup.get(d)! : null),
        connectNulls: true,
      }] : []),
    ]

    return {
      backgroundColor: "transparent",
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", crossStyle: { color: "#94a3b8" } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) => {
          const date = params[0]?.axisValue as string
          let html = `<div style="font-size:11px;margin-bottom:4px;font-weight:600">${date}</div>`
          const accountCount = data.series.length
          for (const p of params) {
            if (p.value == null) continue
            const v = p.value as number
            const sign = v >= 0 ? "+" : ""
            const isAccount = p.seriesIndex < accountCount
            // initial capital = 100万, so 1% ≡ 1万元
            const wan = isAccount ? `, <span style="color:#94a3b8">${sign}${v.toFixed(2)}万元</span>` : ""
            html += `<div style="font-size:11px">${p.marker}${p.seriesName}: <b>${sign}${v.toFixed(2)}%</b>${wan}</div>`
          }
          return html
        },
      },
      legend: {
        type: "scroll",
        bottom: 2,
        textStyle: { fontSize: 11 },
        itemWidth: 16,
        itemHeight: 8,
        pageIconSize: 10,
      },
      grid: { left: 58, right: 16, top: 12, bottom: 72 },
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        { type: "slider",  bottom: 28, height: 18, borderColor: "transparent", fillerColor: "rgba(148,163,184,0.15)", handleStyle: { color: "#94a3b8" }, dataBackground: { lineStyle: { color: "#94a3b8" }, areaStyle: { color: "rgba(148,163,184,0.1)" } } },
      ],
      xAxis: {
        type: "category",
        data: allDates,
        boundaryGap: false,
        axisLabel: {
          fontSize: 10,
          formatter: (v: string) => v.slice(5), // MM-DD
        },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          fontSize: 10,
          formatter: (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%",
        },
        splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,0.2)" } },
      },
      series: chartSeries,
    }
  }, [data, product])

  const handleConfirm = () => {
    const p = inputVal.trim().toUpperCase()
    if (/^[A-Z]{1,4}$/.test(p)) {
      setProduct(p)
      load(from, to, p)
    }
  }

  const hasData = data && data.series.length > 0
  const isEmpty = data && data.series.length === 0

  return (
    <Card>
      <CardHeader className="pb-2">
        {/* Row 1: title + quick-ranges + date pickers + refresh */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">
            {prodLabel(product)} — 各账户权益累计涨跌% vs 主连基准
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_RANGES.map(r => (
              <button
                key={r.label}
                onClick={() => {
                  const f = r.from(); const t = r.to()
                  setFrom(f); setTo(t); setActiveRange(r.label)
                  load(f, t, product)
                }}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  activeRange === r.label
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
            <span className="text-muted-foreground/40 text-xs">|</span>
            <input
              type="date" value={from}
              onChange={(e) => { setFrom(e.target.value); setActiveRange("") }}
              className="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span className="text-muted-foreground text-xs">—</span>
            <input
              type="date" value={to}
              onChange={(e) => { setTo(e.target.value); setActiveRange("") }}
              className="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { setActiveRange(""); load(from, to, product) }}>查询</Button>
            <Button size="sm" variant="outline" onClick={() => load(from, to, product)} disabled={loading} className="h-7 w-7 p-0">
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        {/* Row 2: sector filter + product select + text input + confirm */}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <span className="text-xs text-muted-foreground">板块:</span>
          <select
            value={sector}
            onChange={e => {
              const s = e.target.value
              setSector(s)
              if (s !== "全部" && SECTOR_RULES[s] && !SECTOR_RULES[s].has(product)) {
                const base = availableProducts.length ? availableProducts : [product]
                const first = base.find(p => SECTOR_RULES[s]?.has(p))
                if (first) { setProduct(first); setInputVal(first); load(from, to, first) }
              }
            }}
            className="h-7 rounded border border-input bg-background px-2 text-xs"
          >
            <option value="全部">全部</option>
            {Object.keys(SECTOR_RULES).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={product}
            onChange={e => { const p = e.target.value; setProduct(p); setInputVal(p); load(from, to, p) }}
            className="h-7 rounded border border-input bg-background px-2 text-xs w-32 truncate"
          >
            {(() => {
              const base = availableProducts.length ? availableProducts : [product]
              const filtered = sector === "全部" ? base : base.filter(p => SECTOR_RULES[sector]?.has(p))
              const list = filtered.length ? filtered : base
              return list.map(p => <option key={p} value={p}>{prodLabel(p)}</option>)
            })()}
          </select>
          <span className="text-muted-foreground/40 text-xs">|</span>
          <input
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") handleConfirm() }}
            placeholder="品种代码"
            className="h-7 w-20 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={handleConfirm}>确认</Button>
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-3">
        {loading && (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            加载中…
          </div>
        )}
        {!loading && error && (
          <div className="flex items-center justify-center text-sm text-destructive" style={{ height }}>
            {error}
          </div>
        )}
        {!loading && !error && isEmpty && (
          <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
            该品种暂无交易数据
          </div>
        )}
        {!loading && !error && hasData && (
          <ReactECharts option={option} style={{ height: `${height}px` }} notMerge={true} />
        )}
      </CardContent>
    </Card>
  )
}
