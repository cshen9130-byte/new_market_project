"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AlertCircle,
  ArrowLeft,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Send,
  ServerCog,
  Target,
  X,
} from "lucide-react"
import { useAllWeatherCtpWatch } from "@/hooks/use-all-weather-ctp-watch"
import { useCtpIndexFuturesFeed } from "@/hooks/use-ctp-index-futures-feed"
import { authService } from "@/lib/auth"
import type { CtpTick } from "@/lib/client/ctp-market"
import { allWeatherFrozenMarks, allWeatherLiveBreakdown, allWeatherLiveMark } from "@/lib/client/all-weather-nav"
import { isLiveSessionFor, shanghaiYmd, validMark } from "@/lib/client/market-hours"
import { CONTRACT_TENORS, type ContractTenor } from "@/lib/all-weather/setup"
import { displayListedName, type SleeveKey } from "@/lib/all-weather/universe"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Position = {
  asset: string
  label: string
  contract?: string
  sleeve: SleeveKey
  lots: number
  price: number
  prevPrice?: number
  multiplier: number
  marginRate: number
  targetWeight: number
  weightShare?: number
  riskContrib?: number
  targetRiskShare?: number
  riskShare: number
  notional: number
  margin: number
  dailyPnl: number
  cumPnl: number
}

type Overview = {
  strategy: {
    name: string
    method: string
    universe: string
    benchmark: string
    backtestStart: string
    backtestEnd: string
    lastRebalance: string
    rebalanceFreq?: string
    nAssetsUniverse?: number
    droppedNonNhci?: string[]
    volTarget: number
    volMandate: number
    summary: {
      cagr: number
      annVol: number
      sharpe: number
      maxDrawdown: number
      winRate: number
      nDays: number
      nRebalances: number
      cumulativeReturn: number
      expostTe?: number
      expostCorr?: number
      expostBeta?: number
      expostR2?: number
      signalExpostTe?: number
      signalExpostCorr?: number
      signalExpostBeta?: number
      realisticCagr?: number
      realisticVol?: number
      realisticSharpe?: number
      realisticMaxDd?: number
      realisticFinalNav?: number
      avgNOpened?: number
      lastSkipped?: string
      lastNSkipped?: number
    }
    sleeveBacktest: Array<{ sleeve: string; label: string; cagr: string; vol: string; sharpe: string; maxDd: string }>
    lastBudget: Record<SleeveKey, number>
  }
  settings?: { contractTenor?: ContractTenor }
  book: {
    startedAt: string
    asOf: string
    initialCapital: number
    equity: number
    dailyPnl: number
    cumPnl: number
    priceSource: "sina" | "snapshot"
    pricesFetchedAt: string | null
    missingPrices: string[]
    lastRebalanceDate?: string | null
    positions: Position[]
    daily: Array<{ date: string; equity: number; dailyPnl: number; sleevePnl: Record<SleeveKey, number> }>
  }
  isRebalanceDay?: boolean
  rebalanceTrades?: Array<{
    date: string
    asset: string
    label: string
    sleeve: SleeveKey
    prevContract: string
    contract: string
    prevLots: number
    newLots: number
    delta: number
    side: string
    price: number
    tradeNotional: number
  }>
  totals: { lots: number; notional: number; margin: number; marginUtil: number }
}

type EmailConfig = {
  sender: { name: string; host: string; port: number; user: string; secure: boolean } | null
  receivers: string[]
  scheduleTime: string
  enabled: boolean
  lastSentDate: string | null
  lastSentAt: string | null
  lastScheduledDate?: string | null
  lastError?: string | null
  lastErrorAt?: string | null
  hasPassword?: boolean
}

const SMTP_PRESETS = [
  { label: "腾讯企业邮箱", host: "smtp.exmail.qq.com", port: "465", secure: true },
  { label: "QQ 邮箱", host: "smtp.qq.com", port: "465", secure: true },
  { label: "网易 163", host: "smtp.163.com", port: "465", secure: true },
  { label: "自定义", host: "", port: "465", secure: true },
]

const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))
const minutes = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]
const MAX_ONE_TIME_FILES = 8
const MAX_ONE_TIME_BYTES = 20 * 1024 * 1024

function headers(): Record<string, string> {
  const user = authService.getCurrentUser()
  return user ? { "x-market-user-id": user.id, "Content-Type": "application/json" } : { "Content-Type": "application/json" }
}

function authHeaders(): Record<string, string> {
  const user = authService.getCurrentUser()
  return user ? { "x-market-user-id": user.id } : {}
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function yuan(n: number, digits = 0): string {
  const sign = n < 0 ? "-" : ""
  return `${sign}${Math.abs(n).toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`
}

function pct(n: number, digits = 2): string {
  return `${(n * 100).toFixed(digits)}%`
}

function volLabel(n: number) {
  const x = n * 100
  return Number.isInteger(x) ? `${x}%` : `${x.toFixed(1)}%`
}

function pnlClass(n: number): string {
  if (n > 0) return "text-red-600"
  if (n < 0) return "text-emerald-600"
  return "text-slate-600"
}

function liveMark(contract: string | undefined, quotes: Record<string, CtpTick>, fallback: number) {
  return allWeatherLiveMark(contract, quotes, fallback)
}

export function NhciIndexApp() {
  const router = useRouter()
  const pathname = usePathname()
  const homeHref = pathname.startsWith("/ma/") ? "/ma/dashboard" : "/dashboard"
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [navChartMode, setNavChartMode] = useState<"current" | "return">("current")

  const [email, setEmail] = useState<EmailConfig | null>(null)
  const [senderName, setSenderName] = useState("")
  const [senderHost, setSenderHost] = useState("")
  const [senderPort, setSenderPort] = useState("465")
  const [senderUser, setSenderUser] = useState("")
  const [senderPass, setSenderPass] = useState("")
  const [senderSecure, setSenderSecure] = useState(true)
  const [receiversText, setReceiversText] = useState("")
  const [scheduleHour, setScheduleHour] = useState("09")
  const [scheduleMinute, setScheduleMinute] = useState("00")
  const [enabled, setEnabled] = useState(false)
  const [emailMsg, setEmailMsg] = useState<string | null>(null)
  const [emailBusy, setEmailBusy] = useState(false)
  const [extraFiles, setExtraFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const extraFileInputRef = useRef<HTMLInputElement>(null)
  const extraBytes = extraFiles.reduce((sum, f) => sum + f.size, 0)

  useAllWeatherCtpWatch(authorized === true)
  const ctp = useCtpIndexFuturesFeed()
  const frozenMarksRef = useRef<Record<string, number>>({})
  const bookFingerprintRef = useRef("")

  useEffect(() => {
    const user = authService.getCurrentUser()
    if (!user || user.name !== "cshen") {
      setAuthorized(false)
      return
    }
    setAuthorized(true)
    void loadAll(false)
  }, [])

  async function loadAll(refresh = false) {
    setLoading(true)
    setError(null)
    try {
      const ovRes = await fetch(`/api/nhci-index${refresh ? "?refresh=1" : ""}`, {
        headers: headers(),
        cache: "no-store",
      })
      const ov = await ovRes.json()
      if (!ovRes.ok || !ov?.ok) throw new Error(ov?.error || "策略数据加载失败")
      setOverview(ov)
      const emRes = await fetch("/api/nhci-index/email", { headers: headers(), cache: "no-store" })
      const em = await emRes.json()
      if (emRes.ok && em?.ok) applyEmail(em.config)
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }

  function applyEmail(cfg: EmailConfig) {
    setEmail(cfg)
    setSenderName(cfg.sender?.name ?? "")
    setSenderHost(cfg.sender?.host ?? "")
    setSenderPort(String(cfg.sender?.port ?? 465))
    setSenderUser(cfg.sender?.user ?? "")
    setSenderSecure(cfg.sender?.secure ?? true)
    setReceiversText((cfg.receivers ?? []).join(", "))
    const [h, m] = (cfg.scheduleTime || "09:00").split(":")
    setScheduleHour(h || "09")
    setScheduleMinute(m || "00")
    setEnabled(Boolean(cfg.enabled))
  }

  async function saveEmail(silent = false, patch?: { enabled?: boolean }): Promise<boolean> {
    setEmailBusy(true)
    setEmailMsg(null)
    const nextEnabled = patch?.enabled ?? enabled
    try {
      const res = await fetch("/api/nhci-index/email", {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({
          sender: { name: senderName, host: senderHost, port: Number(senderPort), user: senderUser, pass: senderPass, secure: senderSecure },
          receiversText,
          scheduleTime: `${scheduleHour}:${scheduleMinute}`,
          enabled: nextEnabled,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || "保存失败")
      applyEmail(data.config)
      setSenderPass("")
      if (!silent) {
        if (data.catchUpSent) setEmailMsg("配置已保存，今日定时邮件已补发")
        else if (data.sendError) setEmailMsg(`配置已保存，但补发失败：${data.sendError}`)
        else setEmailMsg("邮件配置已保存")
      }
      return true
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : "保存失败")
      return false
    } finally {
      setEmailBusy(false)
    }
  }

  function addExtraFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((f) => f.size > 0)
    if (!incoming.length) return
    setEmailMsg(null)
    setExtraFiles((prev) => {
      const next = [...prev]
      for (const file of incoming) {
        if (next.length >= MAX_ONE_TIME_FILES) {
          setEmailMsg(`一次性附件最多 ${MAX_ONE_TIME_FILES} 个。`)
          break
        }
        if (next.some((x) => x.name === file.name && x.size === file.size && x.lastModified === file.lastModified)) continue
        next.push(file)
      }
      const total = next.reduce((sum, f) => sum + f.size, 0)
      if (total > MAX_ONE_TIME_BYTES) {
        setEmailMsg("一次性附件合计不能超过 20MB。")
        return prev
      }
      return next
    })
  }

  function removeExtraFile(index: number) {
    setExtraFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function sendNow() {
    setEmailBusy(true)
    setEmailMsg(null)
    try {
      const form = new FormData()
      form.append("action", "send")
      for (const file of extraFiles) form.append("files", file)
      const res = await fetch("/api/nhci-index/email", {
        method: "POST",
        headers: authHeaders(),
        body: form,
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || "发送失败")
      if (data.config) applyEmail(data.config)
      const n = extraFiles.length
      setExtraFiles([])
      if (extraFileInputRef.current) extraFileInputRef.current.value = ""
      setEmailMsg(n ? `已发送（含 ${n} 个一次性附件）` : "已发送")
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : "发送失败")
    } finally {
      setEmailBusy(false)
    }
  }

  async function testSender() {
    setEmailBusy(true)
    setEmailMsg(null)
    try {
      const saved = await saveEmail(true)
      if (!saved) return
      const res = await fetch("/api/nhci-index/email", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "test" }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || "连接失败")
      setEmailMsg("发件邮箱连接成功")
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : "连接失败")
    } finally {
      setEmailBusy(false)
    }
  }

  async function setupTenor(tenor: ContractTenor) {
    if (overview?.settings?.contractTenor === tenor) return
    if (!window.confirm("切换合约月份会按新合约重建模拟盘，净值重置为 1000 万。")) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/nhci-index", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "setup", contractTenor: tenor }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || "切换失败")
      setOverview(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换失败")
    } finally {
      setLoading(false)
    }
  }

  const live = useMemo(() => {
    if (!overview) return null
    const quotes = ctp.quotes
    const rows = overview.book.positions.map((p) => ({
      symbol: p.contract,
      lots: p.lots,
      multiplier: p.multiplier,
      prevPrice: p.prevPrice ?? 0,
      price: p.price,
      dailyPnl: p.dailyPnl,
      sleeve: p.sleeve,
      asset: p.asset,
      bookDaily: p.dailyPnl,
      bookCum: p.cumPnl,
    }))
    const bookFp = rows.map((p) => `${p.symbol}:${p.price}`).join("|")
    if (bookFp !== bookFingerprintRef.current) {
      bookFingerprintRef.current = bookFp
      frozenMarksRef.current = {}
    }
    frozenMarksRef.current = allWeatherFrozenMarks(frozenMarksRef.current, rows, quotes)
    const marks = frozenMarksRef.current
    const markOf = (symbol: string | undefined, fallback: number) => {
      if (!symbol) return fallback
      return validMark(marks[symbol.toUpperCase()]) ?? liveMark(symbol, quotes, fallback)
    }
    const breakdown = allWeatherLiveBreakdown({
      asOf: overview.book.asOf,
      equity: overview.book.equity,
      dailyPnl: overview.book.dailyPnl,
      initialCapital: overview.book.initialCapital,
      rows,
      markOf,
    })
    const marksByAsset: Record<string, number> = {}
    let liveCount = 0
    for (const p of overview.book.positions) {
      const mark = markOf(p.contract, p.price)
      if (p.asset) marksByAsset[p.asset] = mark
      if (
        p.contract &&
        isLiveSessionFor(p.contract) &&
        (quotes[p.contract.toUpperCase()]?.last || quotes[p.contract]?.last)
      ) {
        liveCount += 1
      }
    }
    return { ...breakdown, liveCount, marksByAsset }
  }, [overview, ctp.quotes])

  const positions = useMemo(() => {
    if (!overview) return []
    return overview.book.positions.map((p) => ({
      ...p,
      price: live?.marksByAsset[p.asset] ?? p.price,
      dailyPnl: live ? (live.productPnl[p.asset] ?? 0) : p.dailyPnl,
      cumPnl: live ? (live.productCum[p.asset] ?? 0) : p.cumPnl,
    }))
  }, [overview, live])

  const sortedPositions = useMemo(
    () => [...positions].sort((a, b) => b.riskShare - a.riskShare || b.targetWeight - a.targetWeight),
    [positions],
  )

  const weightTotals = useMemo(
    () => ({
      targetWeight: positions.reduce((n, p) => n + p.targetWeight, 0),
      weightShare: positions.reduce((n, p) => n + (p.weightShare ?? 0), 0),
      riskContrib: positions.reduce((n, p) => n + (p.riskContrib ?? 0), 0),
      riskShare: positions.reduce((n, p) => n + p.riskShare, 0),
    }),
    [positions],
  )

  const portfolio = useMemo(() => {
    if (!overview) return { daily: 0, cum: 0, equity: 0 }
    const cum = live?.cum ?? overview.book.cumPnl
    const daily = live?.daily ?? overview.book.dailyPnl
    return {
      daily,
      cum,
      equity: overview.book.initialCapital + cum,
    }
  }, [overview, live])

  const chartData = useMemo(() => {
    if (!overview) return []
    const capital = overview.book.initialCapital
    const toRet = (equity: number) => (capital > 0 ? equity / capital - 1 : 0)
    const rows = overview.book.daily.map((r) => ({
      date: r.date.slice(5),
      equity: r.equity,
      pnl: r.dailyPnl,
      ret: toRet(r.equity),
      dailyRet: 0,
    }))
    if (rows.length === 0) {
      rows.push({
        date: overview.book.startedAt.slice(5) || overview.book.asOf.slice(5),
        equity: capital,
        pnl: 0,
        ret: 0,
        dailyRet: 0,
      })
    }
    const liveEquity = portfolio.equity
    const livePnl = portfolio.daily
    const today = shanghaiYmd().slice(5)
    const last = rows[rows.length - 1]
    const livePoint = { date: today || "实时", equity: liveEquity, pnl: livePnl, ret: toRet(liveEquity), dailyRet: 0 }
    if (last && last.date === livePoint.date) rows[rows.length - 1] = livePoint
    else rows.push(livePoint)
    return rows.map((r, i, all) => {
      const prevEquity = i > 0 ? all[i - 1].equity : capital
      return { ...r, dailyRet: prevEquity > 0 ? r.pnl / prevEquity : 0 }
    })
  }, [overview, portfolio])

  if (authorized === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        验证身份中…
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Card className="w-80 border-slate-200 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-4 h-10 w-10 text-rose-500" />
          <p className="mb-2 text-lg font-semibold text-slate-900">无权限</p>
          <p className="mb-4 text-sm text-slate-500">此页面仅限 cshen 访问。</p>
          <Button variant="outline" onClick={() => router.push(homeHref)}>返回</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Target className="h-6 w-6 text-sky-700" />
            <div>
              <div className="text-lg font-semibold">NHCI 指数跟踪</div>
              <div className="text-xs text-slate-500">
                {overview?.strategy.nAssetsUniverse ?? 22} 个南华成分品种 · 日度再平衡 · 最小跟踪误差 · 模拟实盘 1000 万 · 波动目标 5%
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="mr-1 flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
              {CONTRACT_TENORS.map((item) => {
                const active = (overview?.settings?.contractTenor ?? "current") === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={loading}
                    title={item.hint}
                    onClick={() => void setupTenor(item.id)}
                    className={`rounded px-2.5 py-1 text-xs ${
                      active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadAll(true)} disabled={loading}>
              {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
              刷新行情
            </Button>
            <Button variant="ghost" size="sm" onClick={() => router.push(homeHref)}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              返回
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        )}

        {!overview ? (
          <div className="py-16 text-center text-slate-500">{loading ? "正在加载策略与行情…" : "暂无数据"}</div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Kpi
                title="模拟净值"
                value={yuan(portfolio.equity)}
                hint={`起始 ${yuan(overview.book.initialCapital)} · ${overview.book.asOf}${live?.liveCount ? " · 实时" : ""}`}
              />
              <Kpi
                title="当日盈亏"
                value={yuan(portfolio.daily)}
                hint={live?.liveCount ? `实时盯市 · ${live.liveCount} 个合约有行情` : "按持仓手数盯市"}
                className={pnlClass(portfolio.daily)}
              />
              <Kpi
                title="累计盈亏"
                value={`${yuan(portfolio.cum)}  (${pct(portfolio.cum / overview.book.initialCapital)})`}
                hint={`自 ${overview.book.startedAt} 起跟踪`}
                className={pnlClass(portfolio.cum)}
              />
              <Kpi
                title="保证金占用"
                value={`${yuan(overview.totals.margin)}  ·  ${pct(overview.totals.marginUtil)}`}
                hint={`开仓 ${overview.totals.lots} 手 · ${(overview.settings?.contractTenor ?? "current") === "following" ? "下季/次主力" : "当月/主力"}`}
              />
              <Kpi
                title="对 NHCI 跟踪"
                value={overview.strategy.summary.expostCorr?.toFixed(2) ?? "—"}
                hint={`样本外相关 · 跟踪误差 ${overview.strategy.summary.expostTe != null ? pct(overview.strategy.summary.expostTe) : "—"}`}
              />
            </section>

            <Card className="border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 text-sm font-medium text-slate-800">策略说明</div>
              <p className="text-sm leading-6 text-slate-600">
                本页跟踪《{overview.strategy.name}》作为可对照的模拟实盘。
                交易池为原 25 品种与南华商品指数的交集：{overview.strategy.nAssetsUniverse ?? 22} 个可交易商品（含黄金 AU），已剔除不在南华商品指数中的金融期货
                {overview.strategy.droppedNonNhci?.length
                  ? `（${overview.strategy.droppedNonNhci.join("/")}）`
                  : "（IF/IC/TL）"}
                。扁平篮子，不设袖套、也不做袖套风险预算。
                每个交易日用过去一年日收益，在多头、满仓、单品种 25% 上限下最小化对南华商品指数（NHCI）的跟踪误差，再缩放到事前年化波动 {volLabel(overview.strategy.volTarget)}（研究约束 {volLabel(overview.strategy.volMandate)}）。
                官方绩效按 1000 万元账户整手执行：目标名义不足一手则不开仓，权重、风险贡献与损益记为 0，不把剩余风险再分配到已开仓品种。
                {overview.strategy.summary.lastNSkipped
                  ? `最近一次信号日有 ${overview.strategy.summary.lastNSkipped} 个品种不足一手${
                      overview.strategy.summary.lastSkipped ? `（${overview.strategy.summary.lastSkipped}）` : ""
                    }。`
                  : ""}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MiniStat label="回测 CAGR" value={pct(overview.strategy.summary.cagr)} className={pnlClass(overview.strategy.summary.cagr)} />
                <MiniStat label="年化波动" value={pct(overview.strategy.summary.annVol)} />
                <MiniStat label="Sharpe" value={overview.strategy.summary.sharpe.toFixed(2)} />
                <MiniStat label="最大回撤" value={pct(overview.strategy.summary.maxDrawdown)} />
              </div>
            </Card>

            <Card className="border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium">{navChartMode === "return" ? "累计收益" : "模拟净值"}</div>
                <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
                  {([
                    { id: "current" as const, label: "净值" },
                    { id: "return" as const, label: "收益" },
                  ]).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setNavChartMode(item.id)}
                      className={`rounded px-2.5 py-1 text-xs ${
                        navChartMode === item.id
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <NavEquityChart data={chartData} mode={navChartMode} />
            </Card>

            <Tabs defaultValue="live">
              <TabsList className="bg-white">
                <TabsTrigger value="live">当前持仓</TabsTrigger>
                <TabsTrigger value="pnl">盈亏轨迹</TabsTrigger>
                <TabsTrigger value="backtest">回测摘要</TabsTrigger>
                <TabsTrigger value="email">邮件推送</TabsTrigger>
              </TabsList>

              <TabsContent value="live" className="space-y-4">
                {overview.isRebalanceDay && (overview.rebalanceTrades?.length ?? 0) > 0 && (
                  <Card className="border-amber-200 bg-amber-50/70 p-5 shadow-sm">
                    <div className="mb-1 text-sm font-semibold text-amber-900">
                      调仓日持仓变动 · {overview.book.lastRebalanceDate ?? overview.book.asOf}
                    </div>
                    <p className="mb-3 text-xs text-amber-800/80">
                      {overview.book.startedAt === overview.book.asOf
                        ? "今日建仓：按报告整手手数开仓（目标名义不足一手则跳过）。"
                        : "每个交易日再平衡：按目标权重 × 当前净值重算手数，下表为调仓前后对比。"}
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>品种 / 合约</TableHead>
                          <TableHead>方向</TableHead>
                          <TableHead className="text-right">调前手数</TableHead>
                          <TableHead className="text-right">调后手数</TableHead>
                          <TableHead className="text-right">变动</TableHead>
                          <TableHead className="text-right">价格</TableHead>
                          <TableHead className="text-right">成交名义</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overview.rebalanceTrades!.map((t) => (
                          <TableRow key={`${t.asset}-${t.contract}`}>
                            <TableCell>
                              <div className="font-medium">{displayListedName(t.label, t.contract)}</div>
                              {t.prevContract && t.prevContract !== t.contract && (
                                <div className="text-[11px] text-slate-500">从 {t.prevContract} 移仓</div>
                              )}
                            </TableCell>
                            <TableCell>{t.side}</TableCell>
                            <TableCell className="text-right">{t.prevLots}</TableCell>
                            <TableCell className="text-right font-medium">{t.newLots}</TableCell>
                            <TableCell className={`text-right ${pnlClass(t.delta)}`}>
                              {t.delta > 0 ? `+${t.delta}` : t.delta}
                            </TableCell>
                            <TableCell className="text-right">{t.price.toLocaleString("zh-CN")}</TableCell>
                            <TableCell className="text-right">{yuan(t.tradeNotional)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                )}

                <Card className="border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{overview.strategy.nAssetsUniverse ?? 22} 品种持仓明细</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        风险贡献取自报告整手持仓（不足一手记 0，不重分配）；手数为当前模拟盘。
                      </div>
                    </div>
                    <div className={`text-sm font-medium ${pnlClass(portfolio.daily)}`}>
                      当日 {yuan(portfolio.daily)} · 累计 {yuan(portfolio.cum)}
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>品种</TableHead>
                        <TableHead className="text-right">手数</TableHead>
                        <TableHead className="text-right">价格</TableHead>
                        <TableHead className="text-right">乘数</TableHead>
                        <TableHead className="text-right">保证金</TableHead>
                        <TableHead className="text-right">名义权重</TableHead>
                        <TableHead className="text-right">权重占比</TableHead>
                        <TableHead className="text-right">风险贡献</TableHead>
                        <TableHead className="text-right">风险贡献占比</TableHead>
                        <TableHead className="text-right">当日盈亏</TableHead>
                        <TableHead className="text-right">累计盈亏</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedPositions.map((p) => (
                        <TableRow key={p.asset} className={p.lots === 0 ? "text-slate-400" : undefined}>
                          <TableCell className="font-medium">{displayListedName(p.label, p.contract)}</TableCell>
                          <TableCell className="text-right font-medium">
                            {p.lots}
                            {p.lots === 0 && (
                              <div className="text-[10px] font-normal text-slate-400">不足一手</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{p.price.toLocaleString("zh-CN")}</TableCell>
                          <TableCell className="text-right">{p.multiplier}</TableCell>
                          <TableCell className="text-right">{yuan(p.margin)}</TableCell>
                          <TableCell className="text-right">{pct(p.targetWeight)}</TableCell>
                          <TableCell className="text-right">{pct(p.weightShare ?? 0)}</TableCell>
                          <TableCell className="text-right">{pct(p.riskContrib ?? 0)}</TableCell>
                          <TableCell className="text-right">{pct(p.riskShare)}</TableCell>
                          <TableCell className={`text-right ${pnlClass(p.dailyPnl)}`}>{yuan(p.dailyPnl)}</TableCell>
                          <TableCell className={`text-right ${pnlClass(p.cumPnl)}`}>{yuan(p.cumPnl)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-medium">
                        <TableCell>合计</TableCell>
                        <TableCell className="text-right">{overview.totals.lots}</TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell className="text-right">{yuan(overview.totals.margin)}</TableCell>
                        <TableCell className="text-right">{pct(weightTotals.targetWeight)}</TableCell>
                        <TableCell className="text-right">{pct(weightTotals.weightShare)}</TableCell>
                        <TableCell className="text-right">{pct(weightTotals.riskContrib)}</TableCell>
                        <TableCell className="text-right">{pct(weightTotals.riskShare)}</TableCell>
                        <TableCell className={`text-right ${pnlClass(portfolio.daily)}`}>{yuan(portfolio.daily)}</TableCell>
                        <TableCell className={`text-right ${pnlClass(portfolio.cum)}`}>{yuan(portfolio.cum)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>

              <TabsContent value="pnl" className="space-y-4">
                <Card className="border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 text-sm font-medium">每日盈亏</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>日期</TableHead>
                        <TableHead className="text-right">净值</TableHead>
                        <TableHead className="text-right">当日盈亏</TableHead>
                        <TableHead className="text-right">累计盈亏</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...overview.book.daily].reverse().slice(0, 30).map((r) => (
                        <TableRow key={r.date}>
                          <TableCell>{r.date}</TableCell>
                          <TableCell className="text-right">{yuan(r.equity)}</TableCell>
                          <TableCell className={`text-right ${pnlClass(r.dailyPnl)}`}>{yuan(r.dailyPnl)}</TableCell>
                          <TableCell className={`text-right ${pnlClass(r.equity - overview.book.initialCapital)}`}>
                            {yuan(r.equity - overview.book.initialCapital)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>

              <TabsContent value="backtest">
                <Card className="border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 text-sm font-medium">
                    官方回测（1000 万整手 · {overview.strategy.backtestStart} 至 {overview.strategy.backtestEnd}）
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <MiniStat label="累计收益" value={pct(overview.strategy.summary.cumulativeReturn)} className={pnlClass(overview.strategy.summary.cumulativeReturn)} />
                    <MiniStat label="CAGR" value={pct(overview.strategy.summary.cagr)} className={pnlClass(overview.strategy.summary.cagr)} />
                    <MiniStat label="年化波动" value={pct(overview.strategy.summary.annVol)} />
                    <MiniStat label="Sharpe" value={overview.strategy.summary.sharpe.toFixed(2)} />
                    <MiniStat label="最大回撤" value={pct(overview.strategy.summary.maxDrawdown)} />
                    <MiniStat label="再平衡次数" value={String(overview.strategy.summary.nRebalances)} />
                  </div>
                  <div className="mt-5 text-sm font-medium text-slate-800">对南华商品指数（整手账户）</div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <MiniStat label="样本外相关" value={overview.strategy.summary.expostCorr?.toFixed(3) ?? "—"} />
                    <MiniStat label="跟踪误差" value={overview.strategy.summary.expostTe != null ? pct(overview.strategy.summary.expostTe) : "—"} />
                    <MiniStat label="Beta" value={overview.strategy.summary.expostBeta?.toFixed(3) ?? "—"} />
                    <MiniStat label="R²" value={overview.strategy.summary.expostR2?.toFixed(3) ?? "—"} />
                  </div>
                  <div className="mt-5 text-sm font-medium text-slate-800">连续权重信号（未整手圆整）</div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <MiniStat label="样本外相关" value={overview.strategy.summary.signalExpostCorr?.toFixed(3) ?? "—"} />
                    <MiniStat label="跟踪误差" value={overview.strategy.summary.signalExpostTe != null ? pct(overview.strategy.summary.signalExpostTe) : "—"} />
                    <MiniStat label="Beta" value={overview.strategy.summary.signalExpostBeta?.toFixed(3) ?? "—"} />
                  </div>
                </Card>
              </TabsContent>

              <TabsContent value="email">
                <Card className="border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                    <Mail className="h-4 w-4" />
                    自动邮件
                  </div>
                  <p className="mb-5 text-sm text-slate-500">
                    发件邮箱、收件人和发送时间与全天候策略共用；「启用自动发送」本页单独开关。每个交易日按北京时间定时发送南华成分品种指数跟踪的组合净值、持仓明细与盈亏，并附带 CSV。周末和中国法定节假日不发送。每个交易日再平衡若手数变化，会额外展示调仓前后手数并附上调仓变动 CSV。到达或超过设定时间后会自动补发；「立即发送」不占用当日定时额度，周末和节假日也可手动发送。
                  </p>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="space-y-3">
                      <div className="text-sm font-medium text-slate-800">发件邮箱</div>
                      <div className="space-y-2">
                        <Label>服务商预设</Label>
                        <Select
                          onValueChange={(val) => {
                            const preset = SMTP_PRESETS.find((p) => p.label === val)
                            if (preset) {
                              setSenderHost(preset.host)
                              setSenderPort(preset.port)
                              setSenderSecure(preset.secure)
                            }
                          }}
                        >
                          <SelectTrigger><SelectValue placeholder="选择邮箱类型…" /></SelectTrigger>
                          <SelectContent>
                            {SMTP_PRESETS.map((p) => (
                              <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>账号名称</Label>
                        <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="NHCI指数跟踪" />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2 space-y-2">
                          <Label>SMTP</Label>
                          <Input value={senderHost} onChange={(e) => setSenderHost(e.target.value)} placeholder="smtp.example.com" />
                        </div>
                        <div className="space-y-2">
                          <Label>端口</Label>
                          <Input
                            value={senderPort}
                            onChange={(e) => {
                              const port = e.target.value
                              setSenderPort(port)
                              if (port === "465") setSenderSecure(true)
                            }}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>登录邮箱</Label>
                        <Input value={senderUser} onChange={(e) => setSenderUser(e.target.value)} placeholder="you@example.com" />
                      </div>
                      <div className="space-y-2">
                        <Label>密码 / 授权码 {email?.hasPassword ? <span className="text-xs text-slate-400">（已保存，留空不改）</span> : null}</Label>
                        <Input type="password" value={senderPass} onChange={(e) => setSenderPass(e.target.value)} placeholder="••••••••" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={senderSecure} onCheckedChange={setSenderSecure} />
                        <Label>SSL/TLS</Label>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="text-sm font-medium text-slate-800">收件与定时</div>
                      <div className="space-y-2">
                        <Label>收件邮箱（多个用逗号分隔）</Label>
                        <Input value={receiversText} onChange={(e) => setReceiversText(e.target.value)} placeholder="a@x.com, b@y.com" />
                      </div>
                      <div className="space-y-2">
                        <Label>交易日发送时间</Label>
                        <div className="flex items-center gap-2">
                          <Select value={scheduleHour} onValueChange={setScheduleHour}>
                            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                            <SelectContent className="max-h-48">
                              {hours.map((h) => <SelectItem key={h} value={h}>{h} 时</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <span>:</span>
                          <Select value={scheduleMinute} onValueChange={setScheduleMinute}>
                            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {minutes.map((m) => <SelectItem key={m} value={m}>{m} 分</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="text-xs text-slate-500">仅交易日发送；周末和中国法定节假日自动跳过。发送时间与全天候共用。</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) => {
                            setEnabled(v)
                            void saveEmail(false, { enabled: v })
                          }}
                        />
                        <Label>启用自动发送</Label>
                      </div>
                      <p className="text-xs text-slate-500">仅对本页 NHCI 指数跟踪生效，不影响全天候邮件。</p>
                      {email?.lastSentAt && (
                        <p className="text-xs text-slate-500">上次发送：{new Date(email.lastSentAt).toLocaleString("zh-CN")}</p>
                      )}
                      {email?.lastError && (
                        <p className="text-xs text-red-600">
                          上次失败{email.lastErrorAt ? `（${new Date(email.lastErrorAt).toLocaleString("zh-CN")}）` : ""}：{email.lastError}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 space-y-2">
                    <Label>一次性附件（仅本次「立即发送」）</Label>
                    <input
                      ref={extraFileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) addExtraFiles(e.target.files)
                        e.target.value = ""
                      }}
                    />
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => extraFileInputRef.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          extraFileInputRef.current?.click()
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragOver(true)
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault()
                        setDragOver(false)
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        setDragOver(false)
                        if (e.dataTransfer.files?.length) addExtraFiles(e.dataTransfer.files)
                      }}
                      className={`flex min-h-[108px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
                        dragOver
                          ? "border-sky-400 bg-sky-50"
                          : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100"
                      }`}
                    >
                      <Paperclip className="mb-2 h-5 w-5 text-slate-500" />
                      <p className="text-sm text-slate-700">拖入文件，或点击选择</p>
                      <p className="mt-1 text-xs text-slate-500">
                        不会保存，也不会随每日自动邮件发出。最多 {MAX_ONE_TIME_FILES} 个，合计 20MB。
                      </p>
                    </div>
                    {extraFiles.length > 0 && (
                      <ul className="space-y-1.5">
                        {extraFiles.map((file, index) => (
                          <li
                            key={`${file.name}-${file.size}-${file.lastModified}`}
                            className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                          >
                            <span className="min-w-0 truncate text-slate-700">{file.name}</span>
                            <span className="shrink-0 text-xs text-slate-400">{formatBytes(file.size)}</span>
                            <button
                              type="button"
                              onClick={() => removeExtraFile(index)}
                              className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              aria-label={`移除 ${file.name}`}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </li>
                        ))}
                        <li className="text-xs text-slate-500">
                          已选 {extraFiles.length} 个 · {formatBytes(extraBytes)}
                        </li>
                      </ul>
                    )}
                  </div>

                  <div className="mt-6 flex flex-wrap items-center gap-2">
                    <Button onClick={() => void saveEmail()} disabled={emailBusy}>
                      {emailBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ServerCog className="mr-1 h-4 w-4" />}
                      保存配置
                    </Button>
                    <Button variant="outline" onClick={() => void testSender()} disabled={emailBusy}>测试发件连接</Button>
                    <Button variant="secondary" onClick={() => void sendNow()} disabled={emailBusy}>
                      <Send className="mr-1 h-4 w-4" />
                      立即发送一封
                    </Button>
                    {emailMsg && <span className="text-sm text-slate-600">{emailMsg}</span>}
                  </div>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  )
}

function Kpi({
  title,
  value,
  hint,
  className,
}: {
  title: string
  value: string
  hint: string
  className?: string
}) {
  return (
    <Card className="border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{title}</div>
      <div className={`mt-1 text-xl font-semibold ${className ?? "text-slate-900"}`}>{value}</div>
      <div className="mt-1 text-[11px] text-slate-400">{hint}</div>
    </Card>
  )
}

function equityAxisDomain(values: number[]): [number, number] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const mid = (min + max) / 2 || 1
  const span = Math.max(max - min, Math.abs(mid) * 0.004, 10_000)
  const pad = span * 0.2
  return [min - pad, max + pad]
}

function returnAxisDomain(values: number[]): [number, number] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 0.002)
  const pad = span * 0.2
  return [min - pad, max + pad]
}

function formatWan(v: number): string {
  const wan = v / 10_000
  if (Math.abs(wan) >= 100) return `${wan.toFixed(0)}万`
  return `${wan.toFixed(1)}万`
}

function formatPctTick(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

type NavChartPoint = {
  date: string
  equity: number
  pnl: number
  ret: number
  dailyRet: number
}

function NavChartTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean
  payload?: Array<{ payload: NavChartPoint }>
  mode: "current" | "return"
}) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const isReturn = mode === "return"
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium text-slate-700">{row.date}</div>
      <div>{isReturn ? "累计收益" : "净值"} : {isReturn ? pct(row.ret) : yuan(row.equity)}</div>
      <div className={pnlClass(row.pnl)}>当日盈亏 : {yuan(row.pnl)}</div>
      <div className={pnlClass(row.dailyRet)}>当日收益 : {pct(row.dailyRet)}</div>
    </div>
  )
}

function NavEquityChart({
  data,
  mode,
}: {
  data: NavChartPoint[]
  mode: "current" | "return"
}) {
  if (data.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400">
        跟踪刚开始，次日刷新后会画出净值曲线。
      </div>
    )
  }
  const isReturn = mode === "return"
  const yDomain = isReturn
    ? returnAxisDomain(data.map((d) => d.ret))
    : equityAxisDomain(data.map((d) => d.equity))
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            width={isReturn ? 56 : 52}
            domain={yDomain}
            tickFormatter={isReturn ? formatPctTick : formatWan}
            allowDataOverflow
          />
          <Tooltip content={<NavChartTooltip mode={mode} />} />
          <Area
            type="linear"
            dataKey={isReturn ? "ret" : "equity"}
            stroke="#0369a1"
            fill="#bae6fd"
            baseValue="dataMin"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function MiniStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-base font-semibold ${className ?? ""}`}>{value}</div>
    </div>
  )
}
