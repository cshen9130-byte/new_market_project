"use client"

import Link from "next/link"
import dynamic from "next/dynamic"
import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, ChevronDown, ChevronUp, ChevronsUpDown, Download, Maximize2, Minimize2, RefreshCw, TrendingDown, TrendingUp, Users } from "lucide-react"

const NhciCandleChart   = dynamic(() => import("@/components/ma/nhci-candle-chart"),  { ssr: false })
const AuTradingChart    = dynamic(() => import("@/components/ma/au-trading-chart"),    { ssr: false })

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"


// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null, decimals = 2): string {
  if (n === null || isNaN(n)) return "—"
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)
}

function fmtPct(raw: string | null): string {
  if (!raw) return "—"
  const s = String(raw).trim()
  return s.endsWith("%") ? s : `${s}%`
}

function downloadCsv(rows: Trader[], from: string, to: string) {
  const headers = [
    "账户", "交易天数", "起始日期", "截止日期",
    "期间盈亏", "期间手续费", "净盈亏",
    "累计平仓盈亏", "累计持仓盈亏",
    "最新客户权益", "最新结存", "风险度",
    "保证金占用", "可用资金",
  ]
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v)
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  const lines = [
    headers.join(","),
    ...rows.map((t) =>
      [
        t.account, t.tradingDays, t.firstDate ?? "", t.lastDate ?? "",
        t.periodPnl ?? "", t.periodFee ?? "", t.netPnl ?? "",
        t.closePnl ?? "", t.positionPnl ?? "",
        t.latestEquity ?? "", t.latestBalance ?? "", t.latestRiskRatio ?? "",
        t.latestMargin ?? "", t.latestAvailable ?? "",
      ].map(escape).join(",")
    ),
  ]
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `盘手分析_${from}_${to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function pnlClass(n: number | null): string {
  if (n === null) return "text-muted-foreground"
  if (n > 0) return "text-red-600 dark:text-red-400"
  if (n < 0) return "text-emerald-600 dark:text-emerald-400"
  return ""
}

function defaultRange() {
  const to = new Date()
  const from = new Date(to)
  from.setMonth(from.getMonth() - 3)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(from), to: fmt(to) }
}

const isoToday = () => new Date().toISOString().slice(0, 10)
function isoOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
function isoMonthOffset(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

const QUICK_RANGES = [
  { label: "今日",     from: () => isoToday(),          to: () => isoToday()          },
  { label: "近一周",   from: () => isoOffset(-7),        to: () => isoToday()          },
  { label: "近一月",   from: () => isoMonthOffset(-1),   to: () => isoToday()          },
  { label: "近一季度", from: () => isoMonthOffset(-3),   to: () => isoToday()          },
  { label: "近一年",   from: () => isoMonthOffset(-12),  to: () => isoToday()          },
]

// ── sorting ──────────────────────────────────────────────────────────────────

type SortKey = keyof Trader | null
type SortDir = "asc" | "desc"

function sortValue(t: Trader, key: SortKey): number | string {
  if (!key) return 0
  const v = t[key]
  if (v === null || v === undefined) return -Infinity
  if (typeof v === "number") return v
  // parse percentage strings like "12.5%" for latestRiskRatio
  const cleaned = String(v).replace(/[%,\s]/g, "")
  const n = parseFloat(cleaned)
  return isNaN(n) ? String(v) : n
}

function SortableHead({
  label,
  colKey,
  sortKey,
  sortDir,
  onSort,
  className = "",
}: {
  label: string
  colKey: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
  className?: string
}) {
  const active = sortKey === colKey
  const Icon = active ? (sortDir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown
  const isCenter = className.includes("text-center")
  return (
    <th
      className={`sticky top-0 z-10 bg-card whitespace-nowrap px-4 py-3 text-xs font-medium text-muted-foreground select-none cursor-pointer hover:text-foreground transition-colors ${isCenter ? "text-center" : "text-right"} ${className}`}
      onClick={() => onSort(colKey)}
    >
      <span className={`inline-flex items-center gap-1 ${isCenter ? "justify-center" : "justify-end"}`}>
        {label}
        <Icon className={`h-3 w-3 shrink-0 ${active ? "text-foreground" : "text-muted-foreground/50"}`} />
      </span>
    </th>
  )
}

// ── types ─────────────────────────────────────────────────────────────────────

interface Trader {
  account: string
  firstDate: string | null
  lastDate: string | null
  tradingDays: number
  periodPnl: number | null
  periodFee: number | null
  netPnl: number | null
  closePnl: number | null
  positionPnl: number | null
  latestEquity: number | null
  latestBalance: number | null
  latestRiskRatio: string | null
  latestMargin: number | null
  latestAvailable: number | null
}

interface ApiResponse {
  ok: boolean
  traders: Trader[]
  notYetRun?: boolean
  error?: string
}

// ── component ────────────────────────────────────────────────────────────────

export default function TraderAnalysisPage() {
  const range = defaultRange()
  const [fromDate, setFromDate] = useState(range.from)
  const [toDate, setToDate] = useState(range.to)
  const [traders, setTraders] = useState<Trader[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [notYetRun, setNotYetRun] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("periodPnl")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [activeTab, setActiveTab] = useState<"pnl-rank" | "variety-review">("pnl-rank")
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Shared date range for 品种交易回顾 tab
  const VIEW_RANGES = [
    { label: "近一月",  from: () => isoMonthOffset(-1),  to: () => isoToday() },
    { label: "近三月",  from: () => isoMonthOffset(-3),  to: () => isoToday() },
    { label: "近六月",  from: () => isoMonthOffset(-6),  to: () => isoToday() },
    { label: "近一年",  from: () => isoMonthOffset(-12), to: () => isoToday() },
    { label: "全部",    from: () => "2025-01-01",         to: () => isoToday() },
  ]
  const [viewFrom, setViewFrom] = useState(() => isoMonthOffset(-6))
  const [viewTo,   setViewTo]   = useState(() => isoToday())
  const [viewRange, setViewRange] = useState("近六月")

  // Two-step sector lookup: product → sector name → NH index code
  // NH codes sourced from raw_nanhua_indices_daily (17 sub-indices fetched by nightly_etl)
  const SECTOR_RULES: Record<string, string[]> = {
    "农产":    ["C","CS","WH","PM","RR","RI","JR","LR","A","B","M","Y","RM","OI","RS","PK","P","SR","CF","CY","AP","CJ","LH","JD","LG","SP","OP"],
    "贵金属":  ["AU","AG","PT","PD"],
    "有色":    ["CU","BC","AL","AO","AD","ZN","PB","NI","SN"],
    "新能源":  ["LC","PS","SI"],
    "黑色":    ["I","SF","SM","RB","HC","SS","WR","JM","J","ZC","FG","BB","FB"],
    "能源化工":["SC","FU","LU","PG","BU","TA","EG","PF","PR","PL","PP","L","BZ","PX","EB","RU","BR","NR","SA","SH","V","UR","MA"],
    "航运":    ["EC"],
    "股指":    ["IH","IF","IC","IM","MO"],
    "国债":    ["TS","TF","T","TL"],
  }
  const SECTOR_TO_NH: Record<string, { code: string; title: string }> = {
    "农产":    { code: "NHAI.NH",  title: "南华农产品指数（NHAI.NH）日K线" },
    "贵金属":  { code: "NHPMI.NH", title: "南华贵金属指数（NHPMI.NH）日K线" },
    "有色":    { code: "NHNFI.NH", title: "南华有色金属指数（NHNFI.NH）日K线" },
    "新能源":  { code: "NHNEI.NH", title: "南华新能源指数（NHNEI.NH）日K线" },
    "黑色":    { code: "NHFI.NH",  title: "南华黑色指数（NHFI.NH）日K线" },
    "能源化工":{ code: "NHECI.NH", title: "南华能化指数（NHECI.NH）日K线" },
  }
  const DEFAULT_SECTOR = { code: "NHCI.NH", title: "南华商品指数（NHCI.NH）日K线" }

  // Maps product code → continuous contract code in raw_akshare_futures_daily (fallback)
  const PRODUCT_TO_AKSHARE: Record<string, string> = {
    A:"A0.DCE",   AD:"AD0.SHF",  AG:"AG0.SHF",  AL:"AL0.SHF",  AO:"AO0.SHF",  AP:"AP0.CZC",
    AU:"AU0.SHF", B:"B0.DCE",    BB:"BB0.DCE",  BC:"BCM.INE",  BR:"BR0.SHF",  BU:"BU0.SHF",
    BZ:"BZ0.DCE", C:"C0.DCE",    CF:"CF0.CZC",  CJ:"CJ0.CZC",  CS:"CS0.DCE",  CU:"CU0.SHF",
    CY:"CY0.CZC", EB:"EB0.DCE",  EC:"ECM.INE",  EG:"EG0.DCE",  FB:"FB0.DCE",  FG:"FG0.CZC",
    FU:"FU0.SHF", HC:"HC0.SHF",  I:"I0.DCE",    IC:"IC0.CFE",  IF:"IF0.CFE",  IH:"IH0.CFE",
    IM:"IM0.CFE", J:"J0.DCE",    JD:"JD0.DCE",  JM:"JM0.DCE",  JR:"JR0.CZC",  L:"L0.DCE",
    LC:"LCM.GFE", LF:"LF0.DCE",  LG:"LG0.DCE",  LH:"LH0.DCE",  LR:"LR0.CZC",  LU:"LUM.INE",
    M:"M0.DCE",   MA:"MA0.CZC",  NI:"NI0.SHF",  NR:"NRM.INE",  OI:"OI0.CZC",  OP:"OP0.SHF",
    P:"P0.DCE",   PB:"PB0.SHF",  PD:"PDM.GFE",  PF:"PF0.CZC",  PG:"PG0.DCE",  PK:"PK0.CZC",
    PL:"PL0.CZC", PM:"PM0.CZC",  PP:"PP0.DCE",  PR:"PR0.CZC",  PS:"PSM.GFE",  PT:"PTM.GFE",
    PX:"PX0.CZC", RB:"RB0.SHF",  RI:"RI0.CZC",  RM:"RM0.CZC",  RR:"RR0.DCE",  RS:"RS0.CZC",
    RU:"RU0.SHF", SA:"SA0.CZC",  SC:"SCM.INE",  SF:"SF0.CZC",  SH:"SH0.CZC",  SI:"SIM.GFE",
    SM:"SM0.CZC", SN:"SN0.SHF",  SP:"SP0.SHF",  SR:"SR0.CZC",  SS:"SS0.SHF",  TA:"TA0.CZC",
    T:"T0.CFE",   TF:"TF0.CFE",  TL:"TL0.CFE",  TS:"TS0.CFE",  UR:"UR0.CZC",  V:"V0.DCE",
    VF:"VF0.DCE", WH:"WH0.CZC",  WR:"WR0.SHF",  Y:"Y0.DCE",   ZC:"ZC0.CZC",  ZN:"ZN0.SHF",
  }

  const [tradingProduct, setTradingProduct] = useState("AU")
  const [selectedAccount, setSelectedAccount] = useState("rx000")
  const sectorInfo = (() => {
    const sector = Object.entries(SECTOR_RULES).find(([, prods]) => prods.includes(tradingProduct))?.[0] ?? null
    return (sector ? SECTOR_TO_NH[sector] : null) ?? DEFAULT_SECTOR
  })()
  const akshareCode = PRODUCT_TO_AKSHARE[tradingProduct]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsFullscreen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const load = useCallback(async (from: string, to: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      const res = await fetch(`/ma/api/mom-analysis/trader-analysis?${params}`)
      const data: ApiResponse = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || "请求失败")
      setNotYetRun(!!data.notYetRun)
      setTraders(data.traders)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    load(fromDate, toDate)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── derived stats ──────────────────────────────────────────────────────────

  const sorted = sortKey
    ? [...traders].sort((a, b) => {
        const av = sortValue(a, sortKey)
        const bv = sortValue(b, sortKey)
        if (av === -Infinity && bv !== -Infinity) return 1
        if (bv === -Infinity && av !== -Infinity) return -1
        const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number)
        return sortDir === "asc" ? cmp : -cmp
      })
    : traders

  const totalPnl = traders.reduce((s, t) => s + (t.periodPnl ?? 0), 0)
  const totalFee = traders.reduce((s, t) => s + (t.periodFee ?? 0), 0)
  const bestTrader = traders.length > 0 ? traders[0] : null  // sorted desc by pnl
  const worstTrader =
    traders.length > 0 ? [...traders].sort((a, b) => (a.periodPnl ?? 0) - (b.periodPnl ?? 0))[0] : null

  return (
    <div className="space-y-6 pt-6">
      {/* header */}
      <div className="flex items-center gap-3">
        <Link href="/ma/dashboard/mom-analysis">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">盘手分析</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            基于客户交易核算日报，按账户汇总期间绩效指标。
          </p>
        </div>
      </div>

      {/* tab bar */}
      <div className="flex gap-1 border-b border-border">
        {([
          { key: "pnl-rank",       label: "盈亏排名" },
          { key: "variety-review", label: "品种交易回顾" },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 品种交易回顾 */}
      {activeTab === "variety-review" && (
        <>
          {/* shared quick-range bar */}
          <div className="flex items-center gap-1.5">
            {VIEW_RANGES.map(r => {
              const isActive = viewRange === r.label
              return (
                <button
                  key={r.label}
                  onClick={() => {
                    const f = r.from(); const t = r.to()
                    setViewFrom(f); setViewTo(t); setViewRange(r.label)
                  }}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {r.label}
                </button>
              )
            })}
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-7 w-7"
              title={isFullscreen ? "退出全屏 (Esc)" : "全屏"}
              onClick={() => setIsFullscreen(v => !v)}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>

          {/* chart grid — fullscreen overlay when isFullscreen */}
          <div className={isFullscreen
            ? "fixed inset-0 z-50 bg-background overflow-auto p-4 flex flex-col gap-4"
            : "grid grid-cols-2 gap-4"
          }>
            {isFullscreen && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {VIEW_RANGES.map(r => {
                  const isActive = viewRange === r.label
                  return (
                    <button
                      key={r.label}
                      onClick={() => {
                        const f = r.from(); const t = r.to()
                        setViewFrom(f); setViewTo(t); setViewRange(r.label)
                      }}
                      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        isActive
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {r.label}
                    </button>
                  )
                })}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-7 w-7"
                  title="退出全屏 (Esc)"
                  onClick={() => setIsFullscreen(false)}
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
              </div>
            )}

            <div className={isFullscreen ? "grid grid-cols-2 gap-4 flex-1 min-h-0" : "contents"}>
              {/* left column: two equal-height charts stacked */}
              <div className="flex flex-col gap-4">
                <NhciCandleChart
                  code="NHCI.NH"
                  title="南华商品指数（NHCI.NH）日K线"
                  height={isFullscreen ? Math.floor((window.innerHeight - 160) / 2) : 280}
                  from={viewFrom}
                  to={viewTo}
                />
                <NhciCandleChart
                  code={sectorInfo.code}
                  title={sectorInfo.title}
                  height={isFullscreen ? Math.floor((window.innerHeight - 160) / 2) : 280}
                  from={viewFrom}
                  to={viewTo}
                  fallbackCode={akshareCode}
                  account={selectedAccount}
                />
              </div>
              {/* right column: AU trading review chart */}
              <div className="flex flex-col">
                <AuTradingChart
                  account="rx000"
                  chartHeight={isFullscreen ? window.innerHeight - 120 : 540}
                  from={viewFrom}
                  to={viewTo}
                  onProductChange={setTradingProduct}
                  onAccountChange={setSelectedAccount}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* 盈亏排名 */}
      {activeTab === "pnl-rank" && (
        <>
      <div className="flex flex-wrap items-center gap-3">
        {/* quick-select buttons */}
        <div className="flex items-center gap-1.5">
          {QUICK_RANGES.map((r) => {
            const active = fromDate === r.from() && toDate === r.to()
            return (
              <button
                key={r.label}
                onClick={() => {
                  const f = r.from()
                  const t = r.to()
                  setFromDate(f)
                  setToDate(t)
                  load(f, t)
                }}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">起始日期</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">截止日期</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <Button size="sm" onClick={() => load(fromDate, toDate)} disabled={isLoading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          查询
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const r = defaultRange()
            setFromDate(r.from)
            setToDate(r.to)
            setSortKey("periodPnl")
            setSortDir("desc")
            load(r.from, r.to)
          }}
          disabled={isLoading}
        >
          重置
        </Button>
        {sorted.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadCsv(sorted, fromDate, toDate)}
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            下载 CSV
          </Button>
        )}
        {sorted.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsFullscreen(true)}
          >
            <Maximize2 className="h-3.5 w-3.5 mr-1.5" />
            全屏
          </Button>
        )}
      </div>

      {/* error / not-yet-run */}
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {notYetRun && !error && (
        <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
          数据库中尚无 <code>mom_daily_reports</code> 数据，请先运行 ETL 导入数据。
        </div>
      )}

      {/* summary cards */}
      {traders.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">盘手数量</CardTitle>
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-2xl font-semibold">{traders.length}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">期间总盈亏</CardTitle>
              {totalPnl >= 0 ? (
                <TrendingUp className="h-3.5 w-3.5 text-red-500" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
              )}
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className={`text-2xl font-semibold ${pnlClass(totalPnl)}`}>{fmt(totalPnl)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">最佳盘手</CardTitle>
              <TrendingUp className="h-3.5 w-3.5 text-red-500" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-lg font-semibold leading-tight">{bestTrader?.account ?? "—"}</p>
              <p className={`text-sm mt-0.5 ${pnlClass(bestTrader?.periodPnl ?? null)}`}>
                {fmt(bestTrader?.periodPnl ?? null)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">最差盘手</CardTitle>
              <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <p className="text-lg font-semibold leading-tight">{worstTrader?.account ?? "—"}</p>
              <p className={`text-sm mt-0.5 ${pnlClass(worstTrader?.periodPnl ?? null)}`}>
                {fmt(worstTrader?.periodPnl ?? null)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* table */}
      {traders.length > 0 && (
        <div className={isFullscreen ? "fixed inset-0 z-50 bg-background p-4 flex flex-col gap-3" : ""}>
          {isFullscreen && (
            <div className="flex items-center justify-between shrink-0">
              <span className="font-semibold text-sm">盈亏排名</span>
              <Button size="sm" variant="ghost" onClick={() => setIsFullscreen(false)}>
                <Minimize2 className="h-3.5 w-3.5 mr-1.5" />
                退出全屏
              </Button>
            </div>
          )}
        <div className={`rounded-lg border border-border/60 bg-card overflow-auto ${isFullscreen ? "flex-1" : "max-h-[70vh]"}`}>
          <table className="w-full caption-bottom text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky top-0 z-10 bg-card w-10 whitespace-nowrap px-4 py-3 text-center text-xs font-medium text-muted-foreground">序号</th>
                <SortableHead label="账户"      colKey="account"        sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-center" />
                <SortableHead label="交易天数"  colKey="tradingDays"    sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="w-16 text-center" />
                <th className="sticky top-0 z-10 bg-card whitespace-nowrap px-4 py-3 text-right text-xs font-medium text-muted-foreground">起止日期</th>
                <SortableHead label="期间盈亏"  colKey="periodPnl"     sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="期间手续费" colKey="periodFee"    sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="净盈亏"    colKey="netPnl"        sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="累计平仓盈亏" colKey="closePnl"   sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="累计持仓盈亏" colKey="positionPnl" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="最新客户权益" colKey="latestEquity" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="最新结存"  colKey="latestBalance"  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="风险度"    colKey="latestRiskRatio" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="保证金占用" colKey="latestMargin"  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                <SortableHead label="可用资金"  colKey="latestAvailable" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => (
                <tr key={t.account} className="hover:bg-muted/50 border-b transition-colors">
                  <td className="px-4 py-3 text-center tabular-nums text-sm text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-3 text-center font-medium whitespace-nowrap text-sm">{t.account}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-sm">{t.tradingDays}</td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-xs text-muted-foreground">
                    {t.firstDate ?? "—"} ~ {t.lastDate ?? "—"}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums text-sm font-medium ${pnlClass(t.periodPnl)}`}>
                    {fmt(t.periodPnl)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm text-muted-foreground">
                    {fmt(t.periodFee)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums text-sm font-medium ${pnlClass(t.netPnl)}`}>
                    {fmt(t.netPnl)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums text-sm ${pnlClass(t.closePnl)}`}>
                    {fmt(t.closePnl)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums text-sm ${pnlClass(t.positionPnl)}`}>
                    {fmt(t.positionPnl)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm">{fmt(t.latestEquity)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm">{fmt(t.latestBalance)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm">{fmtPct(t.latestRiskRatio)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm">{fmt(t.latestMargin)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-sm">{fmt(t.latestAvailable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {!isLoading && !error && !notYetRun && traders.length === 0 && (
        <div className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          所选日期范围内无数据。
        </div>
      )}
        </>
      )}
    </div>
  )
}
