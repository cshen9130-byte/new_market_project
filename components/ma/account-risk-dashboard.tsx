"use client"

import dynamic from "next/dynamic"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  BarChart2,
  Database,
  FileSpreadsheet,
  RefreshCw,
  TrendingUp,
  Upload,
} from "lucide-react"

import AccountRiskDataImport from "@/components/ma/account-risk-data-import"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

// ── Lazy-load Recharts to keep the initial bundle light ──────────────────────
const ResponsiveContainer = dynamic(
  () => import("recharts").then((m) => m.ResponsiveContainer),
  { ssr: false },
)
const AreaChart   = dynamic(() => import("recharts").then((m) => m.AreaChart),   { ssr: false })
const BarChart    = dynamic(() => import("recharts").then((m) => m.BarChart),    { ssr: false })
const PieChart    = dynamic(() => import("recharts").then((m) => m.PieChart),    { ssr: false })
const Area        = dynamic(() => import("recharts").then((m) => m.Area),        { ssr: false })
const Bar         = dynamic(() => import("recharts").then((m) => m.Bar),         { ssr: false })
const Pie         = dynamic(() => import("recharts").then((m) => m.Pie),         { ssr: false })
const Cell        = dynamic(() => import("recharts").then((m) => m.Cell),        { ssr: false })
const XAxis       = dynamic(() => import("recharts").then((m) => m.XAxis),       { ssr: false })
const YAxis       = dynamic(() => import("recharts").then((m) => m.YAxis),       { ssr: false })
const CartesianGrid = dynamic(() => import("recharts").then((m) => m.CartesianGrid), { ssr: false })
const Tooltip     = dynamic(() => import("recharts").then((m) => m.Tooltip),     { ssr: false })
const Legend      = dynamic(() => import("recharts").then((m) => m.Legend),      { ssr: false })
const ReferenceLine = dynamic(() => import("recharts").then((m) => m.ReferenceLine), { ssr: false })

// ── Types ─────────────────────────────────────────────────────────────────────

type DayData = {
  date:           string
  clientEquity:   number | null
  dailyPnl:       number
  cumPnl:         number
  marginOccupied: number | null
  riskRatio:      number | null
  realizedPl:     number | null
  commission:     number | null
}
type AccountSeries = { accountNo: string; data: DayData[] }
type ProductRow  = { trade_date: string; account_no: string; product_code: string; volume: number | null; commission: number | null; realized_pl: number | null }
type PositionRow = { trade_date: string; account_no: string; instrument: string; bs: string | null; lots: number | null; latest_price: number | null; settl_price: number | null; floating_pl: number | null; sh: string | null }

type ETLResult = { processed: number; inserted: number; updated: number; skipped: number; errors: string[] }

// ── Nav tabs ──────────────────────────────────────────────────────────────────

const NAV_TABS = [
  { key: "overview", label: "账户概览", icon: BarChart2 },
  { key: "import",   label: "数据导入", icon: Upload },
] as const
type TabKey = (typeof NAV_TABS)[number]["key"]

// ── Colour helpers ────────────────────────────────────────────────────────────

const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316"]
function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null || !isFinite(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return sign + n.toLocaleString("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}
function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—"
  return (n * 100).toFixed(2) + "%"
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onGoImport }: { onGoImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center text-muted-foreground">
      <Database className="h-12 w-12 opacity-30" />
      <div>
        <p className="text-sm font-medium text-foreground">暂无数据</p>
        <p className="text-xs mt-1">请先在「数据导入」中上传监控中心结算日报，然后点击「运行导入」。</p>
      </div>
      <Button size="sm" variant="outline" onClick={onGoImport}>
        <Upload className="mr-2 h-3.5 w-3.5" /> 前往数据导入
      </Button>
    </div>
  )
}

// ── KPI strip ─────────────────────────────────────────────────────────────────

function KpiStrip({ data }: { data: DayData[] }) {
  if (data.length === 0) return null
  const last     = data[data.length - 1]
  const totalPnl = last.cumPnl
  const latestEq = last.clientEquity
  const latestMar = last.marginOccupied
  const totalComm = data.reduce((s, d) => s + (d.commission ?? 0), 0)
  const winDays   = data.filter(d => d.dailyPnl > 0).length
  const winRate   = data.length > 0 ? winDays / data.length : null

  const kpis = [
    { label: "累计盈亏", value: fmt(totalPnl), color: totalPnl >= 0 ? "text-emerald-600" : "text-red-500" },
    { label: "最新权益", value: latestEq ? fmt(latestEq) : "—", color: "" },
    { label: "保证金占用", value: latestMar ? fmt(latestMar) : "—", color: "" },
    { label: "风险度", value: last.riskRatio != null ? fmtPct(last.riskRatio) : (latestMar && latestEq && latestEq > 0 ? fmtPct(latestMar / latestEq) : "—"), color: "" },
    { label: "累计手续费", value: fmt(-Math.abs(totalComm)), color: "text-amber-600" },
    { label: "胜率", value: winRate != null ? fmtPct(winRate) : "—", color: "" },
  ]

  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {kpis.map(k => (
        <div key={k.label} className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-center">
          <p className="text-[11px] text-muted-foreground">{k.label}</p>
          <p className={`text-sm font-semibold tabular-nums ${k.color}`}>{k.value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Charts ────────────────────────────────────────────────────────────────────

function EquityChart({ data }: { data: DayData[] }) {
  const ticks = data.map(d => d.date)
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-indigo-500" />客户权益走势
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis dataKey="date" ticks={ticks} tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => (v / 1e4).toFixed(0) + "万"} width={52} />
              <Tooltip formatter={(v: number) => [fmt(v), "客户权益"]} labelFormatter={l => String(l)} />
              <Area type="monotone" dataKey="clientEquity" stroke="#6366f1" fill="url(#eqGrad)" dot={false} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

function PnlChart({ data }: { data: DayData[] }) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-emerald-500" />每日盈亏 & 累计盈亏
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => (v / 1e4).toFixed(1) + "万"} width={52} />
              <Tooltip
                formatter={(v: number, name: string) => [fmt(v), name === "dailyPnl" ? "当日盈亏" : "累计盈亏"]}
                labelFormatter={l => String(l)}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="dailyPnl" name="dailyPnl" radius={[3, 3, 0, 0]}>
                {data.map((d, i) => (
                  <Cell key={i} fill={d.dailyPnl >= 0 ? "#10b981" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

function MarginChart({ data }: { data: DayData[] }) {
  const chartData = data.map(d => ({
    date: d.date,
    riskRatio: d.riskRatio != null
      ? d.riskRatio * 100
      : (d.marginOccupied != null && d.clientEquity && d.clientEquity > 0
          ? d.marginOccupied / d.clientEquity * 100
          : null),
    margin: d.marginOccupied,
  }))

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-500" />保证金风险度
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="marGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => v.toFixed(1) + "%"} width={52} />
              <Tooltip
                formatter={(v: number) => [v.toFixed(2) + "%", "风险度"]}
                labelFormatter={l => String(l)}
              />
              <ReferenceLine y={75} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "75%", fontSize: 10, fill: "#ef4444" }} />
              <Area type="monotone" dataKey="riskRatio" stroke="#f59e0b" fill="url(#marGrad)" dot strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

function ProductPnlChart({ products }: { products: ProductRow[] }) {
  // Aggregate by product across all dates
  const map = new Map<string, { commission: number; realized_pl: number; volume: number }>()
  for (const r of products) {
    const prev = map.get(r.product_code) ?? { commission: 0, realized_pl: 0, volume: 0 }
    map.set(r.product_code, {
      commission: prev.commission + (r.commission ?? 0),
      realized_pl: prev.realized_pl + (r.realized_pl ?? 0),
      volume: prev.volume + (r.volume ?? 0),
    })
  }
  const data = Array.from(map.entries())
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => Math.abs(b.realized_pl) - Math.abs(a.realized_pl))

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-violet-500" />品种盈亏汇总
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">暂无品种数据</p>
        ) : (
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 36, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => (v / 1e4).toFixed(1) + "万"} />
                <YAxis type="category" dataKey="code" tick={{ fontSize: 11 }} width={36} />
                <Tooltip formatter={(v: number, name: string) => [fmt(v), name === "realized_pl" ? "平仓盈亏" : "手续费"]} />
                <ReferenceLine x={0} stroke="hsl(var(--border))" />
                <Bar dataKey="realized_pl" name="realized_pl" radius={[0, 3, 3, 0]}>
                  {data.map((d, i) => <Cell key={i} fill={d.realized_pl >= 0 ? "#10b981" : "#ef4444"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PositionsTable({ positions }: { positions: PositionRow[] }) {
  if (positions.length === 0) return null
  const totalPl = positions.reduce((s, p) => s + (p.floating_pl ?? 0), 0)
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-sky-500" />
          当前持仓
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            浮动盈亏合计：<span className={totalPl >= 0 ? "text-emerald-600" : "text-red-500"}>{fmt(totalPl)}</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                {["合约", "方向", "持仓量", "最新价", "结算价", "浮动盈亏", "类型"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {positions.map((p, i) => (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-mono font-medium">{p.instrument}</td>
                  <td className={`px-3 py-1.5 font-medium ${p.bs === "买" ? "text-red-500" : p.bs === "卖" ? "text-green-600" : ""}`}>
                    {p.bs ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">{p.lots ?? "—"}</td>
                  <td className="px-3 py-1.5 tabular-nums">{p.latest_price ?? "—"}</td>
                  <td className="px-3 py-1.5 tabular-nums">{p.settl_price ?? "—"}</td>
                  <td className={`px-3 py-1.5 tabular-nums font-medium ${(p.floating_pl ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {fmt(p.floating_pl)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{p.sh ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function DailyPnlTable({ data }: { data: DayData[] }) {
  if (data.length === 0) return null
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium">每日明细</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                {["日期", "客户权益", "当日盈亏", "平仓盈亏", "手续费", "保证金占用", "风险度", "累计盈亏"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {[...data].reverse().map((d, i) => (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-mono">{d.date}</td>
                  <td className="px-3 py-1.5 tabular-nums">{fmt(d.clientEquity)}</td>
                  <td className={`px-3 py-1.5 tabular-nums font-medium ${d.dailyPnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {fmt(d.dailyPnl)}
                  </td>
                  <td className={`px-3 py-1.5 tabular-nums ${(d.realizedPl ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {fmt(d.realizedPl)}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-amber-600">{fmt(-(d.commission ?? 0))}</td>
                  <td className="px-3 py-1.5 tabular-nums">{fmt(d.marginOccupied)}</td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {d.riskRatio != null
                      ? fmtPct(d.riskRatio)
                      : (d.marginOccupied && d.clientEquity && d.clientEquity > 0
                          ? fmtPct(d.marginOccupied / d.clientEquity)
                          : "—")}
                  </td>
                  <td className={`px-3 py-1.5 tabular-nums font-medium ${d.cumPnl >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {fmt(d.cumPnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

// ── ETL panel inside Import tab ───────────────────────────────────────────────

function EtlPanel({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false)
  const [result, setResult]   = useState<ETLResult | null>(null)
  const [error,  setError]    = useState<string | null>(null)

  const run = useCallback(async (mode: "incremental" | "full") => {
    setRunning(true); setResult(null); setError(null)
    try {
      const res  = await fetch("/ma/api/account-risk/run-etl", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setResult(json.result)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }, [onDone])

  return (
    <Card className="border-border/60 mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Database className="h-4 w-4 text-indigo-500" />运行导入计算
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          将已上传的结算日报解析写入数据库（独立表，不影响 MOM 数据）。
          「增量」只处理新文件；「全量重算」重新处理所有文件。
        </p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" disabled={running} onClick={() => void run("incremental")}>
            {running ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />运行中…</> : "增量导入"}
          </Button>
          <Button size="sm" variant="outline" disabled={running} onClick={() => void run("full")}>
            全量重算
          </Button>
        </div>

        {result && (
          <div className="rounded-md border border-border/60 p-3 text-xs space-y-1">
            <p className="font-medium text-emerald-600">
              完成：处理 {result.processed} 个文件，新增 {result.inserted}，更新 {result.updated}，跳过 {result.skipped}
            </p>
            {result.errors.map((e, i) => (
              <p key={i} className="text-destructive font-mono">{e}</p>
            ))}
          </div>
        )}
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export function AccountRiskDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview")
  const [accounts,  setAccounts]  = useState<AccountSeries[]>([])
  const [products,  setProducts]  = useState<ProductRow[]>([])
  const [positions, setPositions] = useState<PositionRow[]>([])
  const [loading,   setLoading]   = useState(false)
  const [hasData,   setHasData]   = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [sumRes, prodRes, posRes] = await Promise.all([
        fetch("/ma/api/account-risk/summary").then(r => r.json()),
        fetch("/ma/api/account-risk/product-pnl").then(r => r.json()),
        fetch("/ma/api/account-risk/positions").then(r => r.json()),
      ])
      const accts: AccountSeries[] = sumRes.ok ? sumRes.accounts : []
      setAccounts(accts)
      setProducts(prodRes.ok ? prodRes.rows : [])
      setPositions(posRes.ok ? posRes.rows : [])
      setHasData(accts.some(a => a.data.length > 0))
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  // Aggregate all accounts into a single series (single-account mode)
  const mergedData = useMemo<DayData[]>(() => {
    if (accounts.length === 0) return []
    if (accounts.length === 1) return accounts[0].data
    // Multiple accounts: sum by date
    const map = new Map<string, DayData>()
    for (const acct of accounts) {
      for (const d of acct.data) {
        const prev = map.get(d.date)
        if (!prev) {
          map.set(d.date, { ...d })
        } else {
          map.set(d.date, {
            ...prev,
            clientEquity:   (prev.clientEquity ?? 0) + (d.clientEquity ?? 0),
            dailyPnl:       prev.dailyPnl + d.dailyPnl,
            cumPnl:         prev.cumPnl + d.cumPnl,
            marginOccupied: (prev.marginOccupied ?? 0) + (d.marginOccupied ?? 0),
            realizedPl:     (prev.realizedPl ?? 0) + (d.realizedPl ?? 0),
            commission:     (prev.commission ?? 0) + (d.commission ?? 0),
            riskRatio:      null, // recalculate below
          })
        }
      }
    }
    const sorted = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
    // recalculate cumPnl and riskRatio
    let cum = 0
    return sorted.map(d => {
      cum += d.dailyPnl
      return {
        ...d,
        cumPnl: cum,
        riskRatio: d.clientEquity && d.clientEquity > 0 && d.marginOccupied != null
          ? d.marginOccupied / d.clientEquity
          : null,
      }
    })
  }, [accounts])

  const overviewContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />加载中…
        </div>
      )
    }
    if (!hasData) {
      return <EmptyState onGoImport={() => setActiveTab("import")} />
    }
    return (
      <div className="space-y-4 pb-8">
        <KpiStrip data={mergedData} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <EquityChart data={mergedData} />
          <PnlChart    data={mergedData} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <MarginChart      data={mergedData} />
          <ProductPnlChart  products={products} />
        </div>
        <PositionsTable positions={positions} />
        <DailyPnlTable  data={mergedData} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Page header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold">单账户每日风控</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {accounts.length > 0
              ? `账户：${accounts.map(a => a.accountNo).join("、")} · 共 ${mergedData.length} 个交易日`
              : "上传监控中心结算日报，运行导入后查看各项指标"}
          </p>
        </div>
        {activeTab === "overview" && (
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void loadData()}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />刷新
          </Button>
        )}
      </div>

      {/* Sub-nav */}
      <div className="flex items-center gap-1 border-b border-border/60 mb-4 flex-shrink-0">
        {NAV_TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === "overview" && overviewContent()}
        {activeTab === "import" && (
          <div className="pb-8">
            <AccountRiskDataImport />
            <EtlPanel onDone={() => { void loadData(); setActiveTab("overview") }} />
          </div>
        )}
      </div>
    </div>
  )
}
