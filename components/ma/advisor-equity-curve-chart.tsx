"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Maximize2, Minimize2, RefreshCw } from "lucide-react"
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
  advisorSectors:     string[]
  advisorBackgrounds: string[]
  advisorStyles:      string[]
  advisorCycles:      string[]
  advisorArbitrages:  string[]
  advisorStrengths:   string[]
  advisorRegions:     string[]
  error?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCOUNT_COLORS = [
  "#f87171", "#60a5fa", "#4ade80", "#facc15", "#c084fc",
  "#fb923c", "#34d399", "#38bdf8", "#a78bfa", "#f472b6",
  "#e879f9", "#2dd4bf", "#fbbf24", "#818cf8", "#fb7185",
]

// ── Classification constants (mirrors risk-report page) ─────────────────────

const EXPOSURE_CATS    = ["全部", "商品", "股指", "国债"] as const
const EXPOSURE_SECTORS = ["全部", "农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运", "股指", "国债"] as const
const EXPOSURE_SUB_SECTORS = ["全部","谷物","油脂油料","软商品","林业","生鲜","贵金属","有色","新能源","原材","成材","煤炭","建材","油品","聚酯","烯烃","芳烃","橡胶","盐化工","煤化工","航运","股指","国债"] as const

type ExposureCat       = (typeof EXPOSURE_CATS)[number]
type ExposureSector    = (typeof EXPOSURE_SECTORS)[number]
type ExposureSubSector = (typeof EXPOSURE_SUB_SECTORS)[number]

const CAT_TO_SECTORS: Record<string, readonly string[]> = {
  商品: ["农产", "生鲜", "贵金属", "有色", "新能源", "黑色", "能源化工", "航运"],
  股指: ["股指"],
  国债: ["国债"],
}

const SECTOR_TO_SUB_SECTORS: Record<string, readonly string[]> = {
  农产:    ["谷物", "油脂油料", "软商品", "林业"],
  生鲜:    ["生鲜"],
  贵金属:  ["贵金属"],
  有色:    ["有色"],
  新能源:  ["新能源"],
  黑色:    ["原材", "成材", "煤炭", "建材"],
  能源化工:["油品", "聚酯", "烯烃", "芳烃", "橡胶", "盐化工", "煤化工"],
  航运:    ["航运"],
  股指:    ["股指"],
  国债:    ["国债"],
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
  BZ:"能源化工",PX:"能源化工",EB:"能源化工",RU:"能源化工",BR:"能源化工",NR:"能源化工",
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

function prodLabel(code: string) {
  return PROD_NAMES[code] ? `${code} ${PROD_NAMES[code]}` : code
}

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

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  height?: number
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdvisorEquityCurveChart({ height = 400 }: Props) {
  const [product,       setProduct]       = useState("全部")
  const [catFilter,     setCatFilter]     = useState<ExposureCat>("全部")
  const [sectorFilter,  setSectorFilter]  = useState<ExposureSector>("全部")
  const [subSectorFilter, setSubSectorFilter] = useState<ExposureSubSector>("全部")
  const [advisorSector, setAdvisorSector] = useState("全部")
  const [from,          setFrom]          = useState(isoMonthOffset(-6))
  const [to,            setTo]            = useState(isoToday())
  const [activeRange,   setActiveRange]   = useState("近六月")
  const [availableProducts, setAvailableProducts] = useState<string[]>([])
  const [advisorSectors,     setAdvisorSectors]     = useState<string[]>([])
  const [advisorBackgrounds, setAdvisorBackgrounds] = useState<string[]>([])
  const [advisorStyles,      setAdvisorStyles]      = useState<string[]>([])
  const [advisorCycles,      setAdvisorCycles]      = useState<string[]>([])
  const [advisorArbitrages,  setAdvisorArbitrages]  = useState<string[]>([])
  const [advisorStrengths,   setAdvisorStrengths]   = useState<string[]>([])
  const [advisorRegions,     setAdvisorRegions]     = useState<string[]>([])

  const [fSector,      setFSector]      = useState("全部")
  const [fBackground,  setFBackground]  = useState("全部")
  const [fStyle,       setFStyle]       = useState("全部")
  const [fCycle,       setFCycle]       = useState("全部")
  const [fArbitrage,   setFArbitrage]   = useState("全部")
  const [fStrength,    setFStrength]    = useState("全部")
  const [fRegion,      setFRegion]      = useState("全部")
  const [data,    setData]    = useState<ApiData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [allVisible,   setAllVisible]   = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [viewMode,     setViewMode]     = useState<"pct" | "pnl">("pct")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Fetch available products from meta endpoint
  useEffect(() => {
    fetch("/ma/api/mom-analysis/au-trading/meta")
      .then((r) => r.json())
      .then((m: { ok: boolean; products?: string[] }) => {
        if (m.ok && m.products?.length) setAvailableProducts(m.products)
      })
      .catch(() => {})
  }, [])

  const load = useCallback(async (
    f: string, t: string, prod: string,
    sector: string, background: string, style: string,
    cycle: string, isArbitrage: string, mainStrength: string, region: string,
  ) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        product: prod, from: f, to: t,
        advisorSector: sector, background, style, cycle,
        isArbitrage, mainStrength, region,
      })
      const res  = await fetch(`/ma/api/mom-analysis/advisor-equity-curve?${params}`)
      const json: ApiData = await res.json()
      if (!json.ok) throw new Error(json.error || "请求失败")
      setData(json)
      if (json.advisorSectors?.length)     setAdvisorSectors(json.advisorSectors)
      if (json.advisorBackgrounds?.length) setAdvisorBackgrounds(json.advisorBackgrounds)
      if (json.advisorStyles?.length)      setAdvisorStyles(json.advisorStyles)
      if (json.advisorCycles?.length)      setAdvisorCycles(json.advisorCycles)
      if (json.advisorArbitrages?.length)  setAdvisorArbitrages(json.advisorArbitrages)
      if (json.advisorStrengths?.length)   setAdvisorStrengths(json.advisorStrengths)
      if (json.advisorRegions?.length)     setAdvisorRegions(json.advisorRegions)
      setAllVisible(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(from, to, product, fSector, fBackground, fStyle, fCycle, fArbitrage, fStrength, fRegion) }, []) // eslint-disable-line

  // Derived: 板块 options based on catFilter
  const sectorOptions = useMemo(() => {
    if (catFilter !== "全部") return CAT_TO_SECTORS[catFilter] ?? []
    return EXPOSURE_SECTORS.slice(1) as unknown as string[]
  }, [catFilter])

  // Derived: 细分 options based on sectorFilter (then catFilter)
  const subSectorOptions = useMemo(() => {
    if (sectorFilter !== "全部") return SECTOR_TO_SUB_SECTORS[sectorFilter] ?? []
    if (catFilter   !== "全部") return (CAT_TO_SECTORS[catFilter] ?? []).flatMap((s) => SECTOR_TO_SUB_SECTORS[s] ?? [])
    return EXPOSURE_SUB_SECTORS.slice(1) as unknown as string[]
  }, [catFilter, sectorFilter])

  // Derived: products filtered by all 3 levels
  const filteredProducts = useMemo(() => {
    const base = availableProducts.length ? availableProducts : Object.keys(PROD_NAMES)
    if (subSectorFilter !== "全部") return base.filter((p) => PROD_SUB_SECTOR[p] === subSectorFilter)
    if (sectorFilter    !== "全部") return base.filter((p) => PROD_SECTOR[p]     === sectorFilter)
    if (catFilter       !== "全部") {
      const sectors = CAT_TO_SECTORS[catFilter] ?? []
      return base.filter((p) => sectors.includes(PROD_SECTOR[p] ?? ""))
    }
    return base
  }, [availableProducts, catFilter, sectorFilter, subSectorFilter])

  // ── ECharts option ──────────────────────────────────────────────────────────

  const option = useMemo<object>(() => {
    if (!data || data.series.length === 0) return {}

    // pct = cumPnl / 1_000_000 * 100  → cumPnl_wan = pct (since initial cap is 100万)
    // So in pnl mode we display the same number but labelled as 万元
    const isPnl = viewMode === "pnl"

    const dateSet = new Set<string>()
    for (const s of data.series) for (const d of s.data) dateSet.add(d.date)
    for (const b of data.benchmark) dateSet.add(b.date)
    const allDates = [...dateSet].sort()

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
        data: allDates.map((d) => (seriesLookups[i].has(d) ? seriesLookups[i].get(d)! : null)),
        connectNulls: true,
      })),
      ...(data.benchmark.length > 0
        ? [{
            name: `${PROD_NAMES[product] ?? product}主连`,
            type: "line",
            smooth: false,
            symbol: "none",
            lineStyle: { width: 1.5, color: "#94a3b8", type: "dashed" },
            itemStyle: { color: "#94a3b8" },
            data: allDates.map((d) => (bmLookup.has(d) ? bmLookup.get(d)! : null)),
            connectNulls: true,
          }]
        : []),
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
            const extra = isAccount
              ? isPnl
                ? `, <span style="color:#94a3b8">${sign}${v.toFixed(2)}%</span>`
                : `, <span style="color:#94a3b8">${sign}${v.toFixed(2)}万元</span>`
              : ""
            const mainVal = isPnl
              ? `<b>${sign}${v.toFixed(2)}万元</b>`
              : `<b>${sign}${v.toFixed(2)}%</b>`
            html += `<div style="font-size:11px">${p.marker}${p.seriesName}: ${mainVal}${extra}</div>`
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
        {
          type: "slider", bottom: 28, height: 18, borderColor: "transparent",
          fillerColor: "rgba(148,163,184,0.15)",
          handleStyle: { color: "#94a3b8" },
          dataBackground: { lineStyle: { color: "#94a3b8" }, areaStyle: { color: "rgba(148,163,184,0.1)" } },
        },
      ],
      xAxis: {
        type: "category",
        data: allDates,
        boundaryGap: false,
        axisLabel: { fontSize: 10, formatter: (v: string) => v.slice(5) },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          fontSize: 10,
          formatter: isPnl
            ? (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1) + "万"
            : (v: number) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%",
        },
        splitLine: { lineStyle: { type: "dashed", color: "rgba(148,163,184,0.2)" } },
      },
      series: chartSeries,
    }
  }, [data, product, viewMode])

  const toggleAllAccounts = () => {
    if (!data || !chartRef.current) return
    const instance = chartRef.current.getEchartsInstance()
    const next = !allVisible
    for (const s of data.series) {
      instance.dispatchAction({ type: next ? "legendSelect" : "legendUnSelect", name: s.account.toUpperCase() })
    }
    setAllVisible(next)
  }

  const hasData = data && data.series.length > 0
  const isEmpty = data && data.series.length === 0

  const titleText =
    product === "全部"
      ? `分类投顾收益曲线 — 各账户权益累计${viewMode === "pnl" ? "盈亏(万元)" : "涨跌%"}`
      : `${product} ${PROD_NAMES[product] ?? ""} — 各账户权益累计${viewMode === "pnl" ? "盈亏(万元)" : "涨跌% vs 主连基准"}`

  return (
    <div className={isFullscreen ? "fixed inset-0 z-50 bg-background overflow-auto p-4 flex flex-col" : "contents"}>
      <Card className={isFullscreen ? "flex flex-col flex-1" : ""}>
        <CardHeader className="pb-2">
          {/* Row 1: title + quick-ranges + date pickers + refresh + fullscreen */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-medium">{titleText}</CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              {QUICK_RANGES.map((r) => (
                <button
                  key={r.label}
                  onClick={() => {
                    const f = r.from(); const t = r.to()
                    setFrom(f); setTo(t); setActiveRange(r.label)
                    load(f, t, product, fSector, fBackground, fStyle, fCycle, fArbitrage, fStrength, fRegion)
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
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs"
                onClick={() => { setActiveRange(""); load(from, to, product, fSector, fBackground, fStyle, fCycle, fArbitrage, fStrength, fRegion) }}>
                查询
              </Button>
              <Button size="sm" variant="outline" disabled={loading} className="h-7 w-7 p-0"
                onClick={() => load(from, to, product, fSector, fBackground, fStyle, fCycle, fArbitrage, fStrength, fRegion)}>
                <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0"
                title={isFullscreen ? "退出全屏 (Esc)" : "全屏"}
                onClick={() => setIsFullscreen((v) => !v)}>
                {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              </Button>
              <button
                onClick={() => setViewMode((m) => m === "pct" ? "pnl" : "pct")}
                className={`h-7 rounded px-2.5 text-xs font-medium border transition-colors ${
                  viewMode === "pnl"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-input hover:text-foreground"
                }`}
                title="切换收益率%/盈亏万元"
              >
                {viewMode === "pnl" ? "盈亏万元" : "收益率%"}
              </button>
            </div>
          </div>

          {/* Row 2: product cascade filters */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <select
              className="h-7 rounded border border-input bg-background px-2 text-xs"
              value={catFilter}
              onChange={(e) => {
                const v = e.target.value as ExposureCat
                setCatFilter(v); setSectorFilter("全部"); setSubSectorFilter("全部")
                if (product !== "全部") {
                  const ok = v === "全部" || (CAT_TO_SECTORS[v] ?? []).includes(PROD_SECTOR[product] ?? "")
                  if (!ok) { setProduct("全部"); load(from, to, "全部", fSector, fBackground, fStyle, fCycle, fArbitrage, fStrength, fRegion) }
                }
              }}
            >
              {EXPOSURE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>

            <select
              className="h-7 rounded border border-input bg-background px-2 text-xs"
              value={sectorFilter}
              onChange={(e) => {
                const v = e.target.value as ExposureSector
                setSectorFilter(v); setSubSectorFilter("全部")
                if (product !== "全部" && v !== "全部" && PROD_SECTOR[product] !== v) {
                  setProduct("全部"); load(from, to, "全部", fSector, fBackground, fStyle, fCycle, fArbitrage, fStrength, fRegion)
                }
              }}
            >
              <option value="全部">全部板块</option>
              {sectorOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <select
              className="h-7 rounded border border-input bg-background px-2 text-xs"
              value={subSectorFilter}
              onChange={(e) => {
                const v = e.target.value as ExposureSubSector
                setSubSectorFilter(v)
                if (product !== "全部" && v !== "全部" && PROD_SUB_SECTOR[product] !== v) {
                  setProduct("全部"); load(from, to, "全部", fSector, fBackground, fStyle, fCycle, fArbitrage, fStrength, fRegion)
                }
              }}
            >
              <option value="全部">全部细分</option>
              {subSectorOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <select
              value={product}
              onChange={(e) => { const p = e.target.value; setProduct(p); load(from, to, p, fSector, fBackground, fStyle, fCycle, fArbitrage, fStrength, fRegion) }}
              className="h-7 rounded border border-input bg-background px-2 text-xs"
            >
              <option value="全部">全部品种</option>
              {filteredProducts.sort().map((p) => <option key={p} value={p}>{prodLabel(p)}</option>)}
            </select>
          </div>

          {/* Row 3: advisor attribute filters */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span className="text-xs text-muted-foreground">分组:</span>
            <select value={fSector} onChange={(e) => { const v = e.target.value; setFSector(v); load(from, to, product, v, fBackground, fStyle, fCycle, fArbitrage, fStrength, fRegion) }}
              className="h-7 rounded border border-input bg-background px-2 text-xs">
              <option value="全部">全部分组</option>
              {advisorSectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <span className="text-xs text-muted-foreground">背景:</span>
            <select value={fBackground} onChange={(e) => { const v = e.target.value; setFBackground(v); load(from, to, product, fSector, v, fStyle, fCycle, fArbitrage, fStrength, fRegion) }}
              className="h-7 rounded border border-input bg-background px-2 text-xs">
              <option value="全部">全部</option>
              {advisorBackgrounds.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <span className="text-xs text-muted-foreground">风格:</span>
            <select value={fStyle} onChange={(e) => { const v = e.target.value; setFStyle(v); load(from, to, product, fSector, fBackground, v, fCycle, fArbitrage, fStrength, fRegion) }}
              className="h-7 rounded border border-input bg-background px-2 text-xs">
              <option value="全部">全部</option>
              {advisorStyles.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <span className="text-xs text-muted-foreground">周期:</span>
            <select value={fCycle} onChange={(e) => { const v = e.target.value; setFCycle(v); load(from, to, product, fSector, fBackground, fStyle, v, fArbitrage, fStrength, fRegion) }}
              className="h-7 rounded border border-input bg-background px-2 text-xs">
              <option value="全部">全部</option>
              {advisorCycles.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <span className="text-xs text-muted-foreground">套利:</span>
            <select value={fArbitrage} onChange={(e) => { const v = e.target.value; setFArbitrage(v); load(from, to, product, fSector, fBackground, fStyle, fCycle, v, fStrength, fRegion) }}
              className="h-7 rounded border border-input bg-background px-2 text-xs">
              <option value="全部">全部</option>
              {advisorArbitrages.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <span className="text-xs text-muted-foreground">主力:</span>
            <select value={fStrength} onChange={(e) => { const v = e.target.value; setFStrength(v); load(from, to, product, fSector, fBackground, fStyle, fCycle, fArbitrage, v, fRegion) }}
              className="h-7 rounded border border-input bg-background px-2 text-xs">
              <option value="全部">全部</option>
              {advisorStrengths.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <span className="text-xs text-muted-foreground">地区:</span>
            <select value={fRegion} onChange={(e) => { const v = e.target.value; setFRegion(v); load(from, to, product, fSector, fBackground, fStyle, fCycle, fArbitrage, fStrength, v) }}
              className="h-7 rounded border border-input bg-background px-2 text-xs">
              <option value="全部">全部</option>
              {advisorRegions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <button
              onClick={toggleAllAccounts}
              className="h-7 rounded px-2 text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors ml-auto"
            >
              {allVisible ? "全隐藏" : "全显示"}
            </button>
          </div>
        </CardHeader>

        <CardContent className="px-2 pb-3">
          {loading && (
            <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
              加载中…
            </div>
          )}
          {!loading && error && (
            <div className="flex items-center justify-center text-sm text-destructive px-4 text-center" style={{ height }}>
              {error}
            </div>
          )}
          {!loading && !error && isEmpty && (
            <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
              暂无交易数据
            </div>
          )}
          {!loading && !error && hasData && (
            <ReactECharts
              ref={chartRef}
              key={`advisor-equity-${product}-${from}-${to}-${fSector}-${fBackground}-${fStyle}-${fCycle}-${fArbitrage}-${fStrength}-${fRegion}`}
              option={option}
              style={{ height: isFullscreen ? "calc(100vh - 220px)" : height }}
              notMerge
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
