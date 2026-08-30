"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AlertCircle,
  ArrowLeft,
  CloudSun,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Send,
  ServerCog,
  X,
} from "lucide-react"
import { useAllWeatherCtpWatch } from "@/hooks/use-all-weather-ctp-watch"
import { useCtpIndexFuturesFeed } from "@/hooks/use-ctp-index-futures-feed"
import { authService } from "@/lib/auth"
import type { CtpTick } from "@/lib/client/ctp-market"
import { allWeatherFrozenMarks, allWeatherLiveBreakdown, allWeatherLiveMark } from "@/lib/client/all-weather-nav"
import { isLiveSessionFor, shanghaiYmd, validMark } from "@/lib/client/market-hours"
import { CONTRACT_TENORS, type ContractTenor } from "@/lib/all-weather/setup"
import { displayListedName, SLEEVE_COLORS, SLEEVE_KEYS, SLEEVE_LABELS, type SleeveKey } from "@/lib/all-weather/universe"
import {
  ALL_WEATHER_VARIANTS,
  DEFAULT_ALL_WEATHER_VARIANT_ID,
  formatCapitalWan,
  getAllWeatherVariant,
  parseAllWeatherVariantId,
  type AllWeatherVariantId,
} from "@/lib/all-weather/variants"
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
  targetRiskShare?: number
  riskShare: number
  notional: number
  margin: number
  dailyPnl: number
  cumPnl: number
}

type SleeveView = {
  sleeve: SleeveKey
  label: string
  lots: number
  notional: number
  margin: number
  riskShare: number
  dailyPnl: number
  cumPnl: number
  products: Position[]
}

type Overview = {
  variant?: {
    id: AllWeatherVariantId
    label: string
    hint: string
    initialCapital: number
    volTarget: number
  }
  strategy: {
    name: string
    method: string
    universe: string
    backtestStart: string
    backtestEnd: string
    lastRebalance: string
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
    }
    sleeveBacktest: Array<{ sleeve: string; label: string; cagr: string; vol: string; sharpe: string; maxDd: string }>
    lastBudget: Record<SleeveKey, number>
  }
  settings?: { contractTenor?: ContractTenor; variantId?: AllWeatherVariantId }
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
  sleeves: SleeveView[]
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

function headers(): Record<string, string> {
  const user = authService.getCurrentUser()
  return user ? { "x-market-user-id": user.id, "Content-Type": "application/json" } : { "Content-Type": "application/json" }
}

function authHeaders(): Record<string, string> {
  const user = authService.getCurrentUser()
  return user ? { "x-market-user-id": user.id } : {}
}

const MAX_ONE_TIME_FILES = 8
const MAX_ONE_TIME_BYTES = 20 * 1024 * 1024

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

const VARIANT_STORAGE_KEY = "all-weather.active-variant"

function readStoredVariant(): AllWeatherVariantId {
  if (typeof window === "undefined") return DEFAULT_ALL_WEATHER_VARIANT_ID
  return parseAllWeatherVariantId(window.localStorage.getItem(VARIANT_STORAGE_KEY))
}

function pnlClass(n: number): string {
  if (n > 0) return "text-red-600"
  if (n < 0) return "text-emerald-600"
  return "text-slate-600"
}

function liveMark(contract: string | undefined, quotes: Record<string, CtpTick>, fallback: number) {
  return allWeatherLiveMark(contract, quotes, fallback)
}

const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))
const minutes = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]

export function AllWeatherApp() {
  const router = useRouter()
  const pathname = usePathname()
  const homeHref = pathname.startsWith("/ma/") ? "/ma/dashboard" : "/dashboard"
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [variantId, setVariantId] = useState<AllWeatherVariantId>(DEFAULT_ALL_WEATHER_VARIANT_ID)
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
  useAllWeatherCtpWatch(authorized === true)
  const ctp = useCtpIndexFuturesFeed()
  const frozenMarksRef = useRef<Record<string, number>>({})
  const bookFingerprintRef = useRef("")

  const extraBytes = extraFiles.reduce((sum, f) => sum + f.size, 0)

  useEffect(() => {
    const user = authService.getCurrentUser()
    if (!user) {
      setAuthorized(false)
      return
    }
    setCanManage(user.name === "cshen")
    setAuthorized(true)
    const stored = readStoredVariant()
    setVariantId(stored)
    void loadAll(false, stored)
  }, [])

  function variantQuery(id: AllWeatherVariantId, refresh = false) {
    const params = new URLSearchParams()
    params.set("variant", id)
    if (refresh) params.set("refresh", "1")
    return `?${params.toString()}`
  }

  async function loadAll(refresh = false, id = variantId) {
    setLoading(true)
    setError(null)
    try {
      const ovRes = await fetch(`/api/all-weather${variantQuery(id, refresh)}`, {
        headers: headers(),
        cache: "no-store",
      })
      const ov = await ovRes.json()
      if (!ovRes.ok || !ov?.ok) throw new Error(ov?.error || "策略数据加载失败")
      setOverview(ov)
      if (authService.getCurrentUser()?.name === "cshen") {
        const emRes = await fetch("/api/all-weather/email", { headers: headers(), cache: "no-store" })
        const em = await emRes.json()
        if (emRes.ok && em?.ok) applyEmail(em.config)
      }
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
      const res = await fetch("/api/all-weather/email", {
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
      const res = await fetch("/api/all-weather/email", {
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
      const res = await fetch("/api/all-weather/email", {
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

  async function switchVariant(id: AllWeatherVariantId) {
    if (id === variantId && overview) return
    setVariantId(id)
    window.localStorage.setItem(VARIANT_STORAGE_KEY, id)
    frozenMarksRef.current = {}
    bookFingerprintRef.current = ""
    setOverview(null)
    await loadAll(false, id)
  }

  async function setupTenor(tenor: ContractTenor) {
    if (overview?.settings?.contractTenor === tenor) return
    const capitalLabel = formatCapitalWan(overview?.book.initialCapital ?? getAllWeatherVariant(variantId).initialCapital)
    if (!window.confirm(`切换合约月份会按新合约重建当前策略的模拟盘，净值重置为 ${capitalLabel}。另一条策略不受影响。`)) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/all-weather", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "setup", contractTenor: tenor, variant: variantId }),
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

  const sleeves = useMemo(() => {
    if (!overview) return []
    return overview.sleeves.map((s) => {
      const daily = live ? (live.sleevePnl[s.sleeve] ?? 0) : s.dailyPnl
      const cum = live ? (live.sleeveCum[s.sleeve] ?? 0) : s.cumPnl
      return {
        ...s,
        dailyPnl: daily,
        cumPnl: cum,
        products: s.products.map((p) => ({
          ...p,
          price: live?.marksByAsset[p.asset] ?? p.price,
          dailyPnl: live ? (live.productPnl[p.asset] ?? 0) : p.dailyPnl,
          cumPnl: live ? (live.productCum[p.asset] ?? 0) : p.cumPnl,
        })),
      }
    })
  }, [overview, live])

  const sleeveTotals = useMemo(
    () => ({
      daily: sleeves.reduce((n, s) => n + s.dailyPnl, 0),
      cum: sleeves.reduce((n, s) => n + s.cumPnl, 0),
    }),
    [sleeves],
  )

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
    const liveEquity = capital + (live?.cum ?? overview.book.equity - capital)
    const livePnl = live?.daily ?? overview.book.dailyPnl
    const today = shanghaiYmd().slice(5)
    const last = rows[rows.length - 1]
    const livePoint = { date: today || "实时", equity: liveEquity, pnl: livePnl, ret: toRet(liveEquity), dailyRet: 0 }
    if (last && last.date === livePoint.date) rows[rows.length - 1] = livePoint
    else rows.push(livePoint)
    return rows.map((r, i, all) => {
      const prevEquity = i > 0 ? all[i - 1].equity : capital
      return { ...r, dailyRet: prevEquity > 0 ? r.pnl / prevEquity : 0 }
    })
  }, [overview, live])

  const sleeveChartData = useMemo(() => {
    if (!overview) return []
    const sleeveCapital = overview.book.initialCapital / SLEEVE_KEYS.length
    const running: Record<SleeveKey, number> = { Equity: 0, Bonds: 0, Gold: 0, Commodity: 0 }
    const rows: Array<{ date: string } & Record<SleeveKey, number>> = overview.book.daily.map((r) => {
      for (const key of SLEEVE_KEYS) running[key] += r.sleevePnl[key] ?? 0
      return {
        date: r.date.slice(5),
        Equity: sleeveCapital + running.Equity,
        Bonds: sleeveCapital + running.Bonds,
        Gold: sleeveCapital + running.Gold,
        Commodity: sleeveCapital + running.Commodity,
      }
    })
    const today = shanghaiYmd().slice(5)
    const livePoint = {
      date: today || "实时",
      Equity: sleeveCapital + (live?.sleeveCum.Equity ?? running.Equity),
      Bonds: sleeveCapital + (live?.sleeveCum.Bonds ?? running.Bonds),
      Gold: sleeveCapital + (live?.sleeveCum.Gold ?? running.Gold),
      Commodity: sleeveCapital + (live?.sleeveCum.Commodity ?? running.Commodity),
    }
    if (rows.length === 0) {
      rows.push({
        date: overview.book.startedAt.slice(5) || overview.book.asOf.slice(5),
        Equity: sleeveCapital,
        Bonds: sleeveCapital,
        Gold: sleeveCapital,
        Commodity: sleeveCapital,
      })
    }
    const last = rows[rows.length - 1]
    if (last && last.date === livePoint.date) rows[rows.length - 1] = livePoint
    else rows.push(livePoint)
    return rows
  }, [overview, live])

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
          <p className="mb-2 text-lg font-semibold text-slate-900">请先登录</p>
          <p className="mb-4 text-sm text-slate-500">登录后即可查看全天候策略。</p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => router.push(homeHref)}>返回仪表盘</Button>
            <Button onClick={() => router.push("/login")}>前往登录</Button>
          </div>
        </Card>
      </div>
    )
  }

  const selectedVariant = getAllWeatherVariant(variantId)
  const headerCapital = overview?.book.initialCapital ?? selectedVariant.initialCapital
  const headerVol = overview?.strategy.volTarget ?? selectedVariant.volTarget

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <CloudSun className="h-6 w-6 text-amber-600" />
            <div>
              <div className="text-lg font-semibold">全天候策略跟踪</div>
              <div className="text-xs text-slate-500">
                四袖套等权 25 · 风险预算浮动 10%–40% · 模拟实盘 {formatCapitalWan(headerCapital)} · 波动目标 {volLabel(headerVol)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="mr-1 flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
              {ALL_WEATHER_VARIANTS.map((item) => {
                const active = variantId === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={loading}
                    title={item.hint}
                    onClick={() => void switchVariant(item.id)}
                    className={`rounded px-2.5 py-1 text-xs ${
                      active ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
            <div className="mr-1 flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
              {CONTRACT_TENORS.map((item) => {
                const active = (overview?.settings?.contractTenor ?? "current") === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={loading || !canManage}
                    title={canManage ? item.hint : "合约月份由管理员设置"}
                    onClick={() => {
                      if (!canManage) return
                      void setupTenor(item.id)
                    }}
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
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                title="模拟净值"
                value={yuan(overview.book.initialCapital + sleeveTotals.cum)}
                hint={`起始 ${yuan(overview.book.initialCapital)} · ${overview.book.asOf}${live?.liveCount ? " · 实时" : ""}`}
              />
              <Kpi title="当日盈亏" value={yuan(sleeveTotals.daily)} hint={live?.liveCount ? `实时盯市 · ${live.liveCount} 个合约有行情` : "按持仓手数盯市"} className={pnlClass(sleeveTotals.daily)} />
              <Kpi
                title="累计盈亏"
                value={`${yuan(sleeveTotals.cum)}  (${pct(sleeveTotals.cum / overview.book.initialCapital)})`}
                hint={`自 ${overview.book.startedAt} 起跟踪`}
                className={pnlClass(sleeveTotals.cum)}
              />
              <Kpi title="保证金占用" value={`${yuan(overview.totals.margin)}  ·  ${pct(overview.totals.marginUtil)}`} hint={`开仓 ${overview.totals.lots} 手 · ${(overview.settings?.contractTenor ?? "current") === "following" ? "下季/次主力" : "当月/主力"} · 行情 ${overview.book.priceSource === "sina" ? "新浪" : "回测快照"}`} />
            </section>

            <Card className="border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 text-sm font-medium text-slate-800">策略说明</div>
              <p className="text-sm leading-6 text-slate-600">
                本页跟踪《{overview.strategy.name}》回测报告中的配置，作为可对照的模拟实盘基准。
                袖套为权益 / 债券 / 黄金 / 商品，战略风险预算各 25%，再平衡时按袖套自身波动在 10%–40% 内浮动；
                袖套之间 ERC，袖套内 CAIV，月末再平衡，事前波动目标 {volLabel(overview.strategy.volTarget)}、约束 {volLabel(overview.strategy.volMandate)}。原油 SC 计入商品袖套。
                实盘品种：债券仅用 10 年国债 T；权益为沪深300 IF、中证500 IC、中证1000 IM。
                合约可选手动切换：当前合约（股指当月 / 国债当季 / 商品主力）或下季合约（股指下季 / 国债下季 / 商品次主力）。
                当前手数按 {overview.strategy.lastRebalance} 目标权重缩放至 {formatCapitalWan(overview.book.initialCapital)}元，再四舍五入到整数手。
                {variantId !== DEFAULT_ALL_WEATHER_VARIANT_ID
                  ? " 本账户按 5% 目标等比例缩放杠杆，与 2000 万账户独立记账。单手名义过大时，该袖套权重并入最接近一手的合约并至少开 1 手，保证四袖套均有持仓、风险预算不低于 10%、不超过 40%。"
                  : " 单手名义过大的品种（如原油 SC、锡 SN）可能不足一手，开仓为 0，实际风险贡献也为 0。"}
                回测区间 {overview.strategy.backtestStart} 至 {overview.strategy.backtestEnd}，
                CAGR {pct(overview.strategy.summary.cagr)}，Sharpe {overview.strategy.summary.sharpe.toFixed(2)}，最大回撤 {pct(overview.strategy.summary.maxDrawdown)}。
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                {sleeves.map((s) => (
                  <div key={s.sleeve} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">{s.label} 风险预算</div>
                    <div className="text-lg font-semibold" style={{ color: SLEEVE_COLORS[s.sleeve] }}>{pct(overview.strategy.lastBudget[s.sleeve])}</div>
                    <div className={`text-[11px] font-medium ${pnlClass(s.dailyPnl)}`}>
                      当日 {yuan(s.dailyPnl)}
                    </div>
                    <div className={`text-[11px] font-medium ${pnlClass(s.cumPnl)}`}>
                      累计 {yuan(s.cumPnl)}
                    </div>
                  </div>
                ))}
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

            <Card className="border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium">袖套净值</div>
                <div className="text-[11px] text-slate-400">
                  各袖套等权起始 {yuan(overview.book.initialCapital / SLEEVE_KEYS.length)}
                </div>
              </div>
              <SleeveNavChart data={sleeveChartData} />
            </Card>

            <Tabs defaultValue="live">
              <TabsList className="bg-white">
                <TabsTrigger value="live">当前持仓</TabsTrigger>
                <TabsTrigger value="pnl">盈亏轨迹</TabsTrigger>
                <TabsTrigger value="backtest">回测摘要</TabsTrigger>
                {canManage ? <TabsTrigger value="email">邮件推送</TabsTrigger> : null}
              </TabsList>

              <TabsContent value="live" className="space-y-4">
                {overview.isRebalanceDay && (overview.rebalanceTrades?.length ?? 0) > 0 && (
                  <Card className="border-amber-200 bg-amber-50/70 p-5 shadow-sm">
                    <div className="mb-1 text-sm font-semibold text-amber-900">
                      调仓日持仓变动 · {overview.book.lastRebalanceDate ?? overview.book.asOf}
                    </div>
                    <p className="mb-3 text-xs text-amber-800/80">
                      {overview.book.startedAt === overview.book.asOf
                        ? `今日建仓：按目标权重 × ${formatCapitalWan(overview.book.initialCapital)} 开出整数手。`
                        : "月末再平衡：按目标权重 × 当前净值重算手数，下表为调仓前后对比。"}
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
                  <div className="mb-3 text-sm font-medium">袖套构成</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>袖套</TableHead>
                        <TableHead className="text-right">开仓手数</TableHead>
                        <TableHead className="text-right">名义价值</TableHead>
                        <TableHead className="text-right">保证金</TableHead>
                        <TableHead className="text-right">风险贡献</TableHead>
                        <TableHead className="text-right">当日盈亏</TableHead>
                        <TableHead className="text-right">累计盈亏</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sleeves.map((s) => (
                        <TableRow key={s.sleeve}>
                          <TableCell className="font-medium" style={{ color: SLEEVE_COLORS[s.sleeve] }}>{s.label}</TableCell>
                          <TableCell className="text-right">{s.lots}</TableCell>
                          <TableCell className="text-right">{yuan(s.notional)}</TableCell>
                          <TableCell className="text-right">{yuan(s.margin)}</TableCell>
                          <TableCell className="text-right">{pct(s.riskShare)}</TableCell>
                          <TableCell className={`text-right ${pnlClass(s.dailyPnl)}`}>{yuan(s.dailyPnl)}</TableCell>
                          <TableCell className={`text-right ${pnlClass(s.cumPnl)}`}>{yuan(s.cumPnl)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-medium">
                        <TableCell>合计</TableCell>
                        <TableCell className="text-right">{sleeves.reduce((n, s) => n + s.lots, 0)}</TableCell>
                        <TableCell className="text-right">{yuan(sleeves.reduce((n, s) => n + s.notional, 0))}</TableCell>
                        <TableCell className="text-right">{yuan(sleeves.reduce((n, s) => n + s.margin, 0))}</TableCell>
                        <TableCell className="text-right">{pct(sleeves.reduce((n, s) => n + s.riskShare, 0))}</TableCell>
                        <TableCell className={`text-right ${pnlClass(sleeveTotals.daily)}`}>
                          {yuan(sleeveTotals.daily)}
                        </TableCell>
                        <TableCell className={`text-right ${pnlClass(sleeveTotals.cum)}`}>
                          {yuan(sleeveTotals.cum)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Card>

                {sleeves.map((s) => (
                  <Card key={s.sleeve} className="border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-medium">{s.label} · 品种明细</div>
                      <div className={`text-sm font-medium ${pnlClass(s.dailyPnl)}`}>
                        当日 {yuan(s.dailyPnl)} · 累计 {yuan(s.cumPnl)}
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
                          <TableHead className="text-right">目标权重</TableHead>
                          <TableHead className="text-right">风险贡献</TableHead>
                          <TableHead className="text-right">当日盈亏</TableHead>
                          <TableHead className="text-right">累计盈亏</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...s.products].sort((a, b) => b.margin - a.margin).map((p) => (
                          <TableRow key={p.asset} className={p.lots === 0 ? "text-slate-400" : undefined}>
                            <TableCell className="font-medium">{displayListedName(p.label, p.contract)}</TableCell>
                            <TableCell className="text-right font-medium">{p.lots}</TableCell>
                            <TableCell className="text-right">{p.price.toLocaleString("zh-CN")}</TableCell>
                            <TableCell className="text-right">{p.multiplier}</TableCell>
                            <TableCell className="text-right">{yuan(p.margin)}</TableCell>
                            <TableCell className="text-right">{pct(p.targetWeight)}</TableCell>
                            <TableCell className="text-right">
                              {pct(p.riskShare)}
                              {p.lots === 0 && (p.targetRiskShare ?? 0) > 0 && (
                                <div className="text-[10px] font-normal text-slate-400">目标 {pct(p.targetRiskShare ?? 0)} · 不足一手</div>
                              )}
                            </TableCell>
                            <TableCell className={`text-right ${pnlClass(p.dailyPnl)}`}>{yuan(p.dailyPnl)}</TableCell>
                            <TableCell className={`text-right ${pnlClass(p.cumPnl)}`}>
                              {yuan(p.cumPnl)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                ))}
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
                        {(Object.keys(SLEEVE_LABELS) as SleeveKey[]).map((k) => (
                          <TableHead key={k} className="text-right">{SLEEVE_LABELS[k]}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...overview.book.daily].reverse().slice(0, 30).map((r) => (
                        <TableRow key={r.date}>
                          <TableCell>{r.date}</TableCell>
                          <TableCell className="text-right">{yuan(r.equity)}</TableCell>
                          <TableCell className={`text-right ${pnlClass(r.dailyPnl)}`}>{yuan(r.dailyPnl)}</TableCell>
                          {(Object.keys(SLEEVE_LABELS) as SleeveKey[]).map((k) => (
                            <TableCell key={k} className={`text-right ${pnlClass(r.sleevePnl[k] ?? 0)}`}>
                              {yuan(r.sleevePnl[k] ?? 0)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>

              <TabsContent value="backtest">
                <Card className="border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 text-sm font-medium">回测绩效（2019-04-30 至 2026-08-07）</div>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <MiniStat label="累计收益" value={pct(overview.strategy.summary.cumulativeReturn)} className={pnlClass(overview.strategy.summary.cumulativeReturn)} />
                    <MiniStat label="CAGR" value={pct(overview.strategy.summary.cagr)} className={pnlClass(overview.strategy.summary.cagr)} />
                    <MiniStat label="年化波动" value={pct(overview.strategy.summary.annVol)} />
                    <MiniStat label="Sharpe" value={overview.strategy.summary.sharpe.toFixed(2)} />
                    <MiniStat label="最大回撤" value={pct(overview.strategy.summary.maxDrawdown)} />
                    <MiniStat label="再平衡次数" value={String(overview.strategy.summary.nRebalances)} />
                  </div>
                  <Table className="mt-5">
                    <TableHeader>
                      <TableRow>
                        <TableHead>袖套</TableHead>
                        <TableHead className="text-right">年化收益</TableHead>
                        <TableHead className="text-right">年化波动</TableHead>
                        <TableHead className="text-right">Sharpe</TableHead>
                        <TableHead className="text-right">最大回撤</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.strategy.sleeveBacktest.map((s) => (
                        <TableRow key={s.sleeve}>
                          <TableCell>{s.label}</TableCell>
                          <TableCell className={`text-right ${pnlClass(Number.parseFloat(s.cagr))}`}>{s.cagr}</TableCell>
                          <TableCell className="text-right">{s.vol}</TableCell>
                          <TableCell className="text-right">{s.sharpe}</TableCell>
                          <TableCell className="text-right">{s.maxDd}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>

              {canManage ? (
              <TabsContent value="email">
                <Card className="border-slate-200 bg-white p-5 shadow-sm">
                  <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                    <Mail className="h-4 w-4" />
                    自动邮件
                  </div>
                  <p className="mb-5 text-sm text-slate-500">
                    每个交易日按北京时间定时发送当前各袖套 / 品种的开仓手数、保证金、风险贡献，以及组合、袖套、品种盈亏；并附带持仓/交易明细、袖套汇总、每日盈亏 CSV。周末和中国法定节假日不发送。月末再平衡日会额外展示调仓前后手数，并附上调仓变动 CSV。到达或超过设定时间后会自动补发；「立即发送」不占用当日定时额度，周末和节假日也可手动发送。默认建议 09:00。
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
                        <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="全天候跟踪" />
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
                        <p className="text-xs text-slate-500">仅交易日发送；周末和中国法定节假日自动跳过。</p>
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
              ) : null}
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
            stroke="#b91c1c"
            fill="#fecaca"
            baseValue="dataMin"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function SleeveNavChart({ data }: { data: Array<{ date: string } & Record<SleeveKey, number>> }) {
  if (data.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400">
        跟踪刚开始，次日刷新后会画出净值曲线。
      </div>
    )
  }
  const yDomain = equityAxisDomain(data.flatMap((d) => SLEEVE_KEYS.map((key) => d[key])))
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 24, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            width={52}
            domain={yDomain}
            tickFormatter={formatWan}
            allowDataOverflow
          />
          <Tooltip
            formatter={(value, name) => [yuan(Number(value)), String(name)]}
          />
          <Legend verticalAlign="top" iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          {SLEEVE_KEYS.map((key) => (
            <Line
              key={key}
              type="linear"
              dataKey={key}
              name={SLEEVE_LABELS[key]}
              stroke={SLEEVE_COLORS[key]}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
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
