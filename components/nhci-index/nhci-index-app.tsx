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
import { AlertCircle, ArrowLeft, Loader2, RefreshCw, Target } from "lucide-react"
import { useAllWeatherCtpWatch } from "@/hooks/use-all-weather-ctp-watch"
import { useCtpIndexFuturesFeed } from "@/hooks/use-ctp-index-futures-feed"
import { authService } from "@/lib/auth"
import type { CtpTick } from "@/lib/client/ctp-market"
import { allWeatherFrozenMarks, allWeatherLiveBreakdown, allWeatherLiveMark } from "@/lib/client/all-weather-nav"
import { isLiveSessionFor, shanghaiYmd, validMark } from "@/lib/client/market-hours"
import { CONTRACT_TENORS, type ContractTenor } from "@/lib/all-weather/setup"
import { displayListedName, SLEEVE_COLORS, SLEEVE_KEYS, SLEEVE_LABELS, type SleeveKey } from "@/lib/all-weather/universe"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  strategy: {
    name: string
    method: string
    universe: string
    benchmark: string
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
      expostTe?: number
      expostCorr?: number
      expostBeta?: number
      expostR2?: number
      realisticCagr?: number
      realisticVol?: number
      realisticSharpe?: number
      realisticMaxDd?: number
      realisticFinalNav?: number
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
  sleeves: SleeveView[]
  totals: { lots: number; notional: number; margin: number; marginUtil: number }
}

function headers(): Record<string, string> {
  const user = authService.getCurrentUser()
  return user ? { "x-market-user-id": user.id, "Content-Type": "application/json" } : { "Content-Type": "application/json" }
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败")
    } finally {
      setLoading(false)
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
    const running: Record<SleeveKey, number> = { Equity: 0, Bonds: 0, Gold: 0, Commodity: 0 }
    const rows: Array<{ date: string } & Record<SleeveKey, number>> = overview.book.daily.map((r) => {
      for (const key of SLEEVE_KEYS) running[key] += r.sleevePnl[key] ?? 0
      return {
        date: r.date.slice(5),
        Equity: running.Equity,
        Bonds: running.Bonds,
        Gold: running.Gold,
        Commodity: running.Commodity,
      }
    })
    const today = shanghaiYmd().slice(5)
    const livePoint = {
      date: today || "实时",
      Equity: live?.sleeveCum.Equity ?? running.Equity,
      Bonds: live?.sleeveCum.Bonds ?? running.Bonds,
      Gold: live?.sleeveCum.Gold ?? running.Gold,
      Commodity: live?.sleeveCum.Commodity ?? running.Commodity,
    }
    if (rows.length === 0) {
      rows.push({
        date: overview.book.startedAt.slice(5) || overview.book.asOf.slice(5),
        Equity: 0,
        Bonds: 0,
        Gold: 0,
        Commodity: 0,
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
                25 品种扁平篮子复制南华商品指数 · 最小跟踪误差 · 模拟实盘 1000 万 · 波动目标 5%
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
                本页跟踪《{overview.strategy.name}》回测报告，作为可对照的模拟实盘。
                交易池为 25 个期货（含 IF/IC、TL、AU 与其余商品），全部放在同一个扁平篮子里，不设袖套、也不做袖套风险预算。
                月末用过去一年日收益，在多头、满仓、单品种 25% 上限下最小化对南华商品指数（NHCI）的跟踪误差，再缩放到事前年化波动 {volLabel(overview.strategy.volTarget)}（研究约束 {volLabel(overview.strategy.volMandate)}）。
                当前手数按 {overview.strategy.lastRebalance} 目标权重缩放至 1000 万元，再四舍五入到整数手。
                股指、国债、黄金只有在降低对 NHCI 跟踪误差时才有权重；高乘数品种（原油、铜、锡、股指、国债）在 1000 万账户上可能不足一手。
                回测区间 {overview.strategy.backtestStart} 至 {overview.strategy.backtestEnd}，
                CAGR {pct(overview.strategy.summary.cagr)}，对 NHCI 样本外相关 {overview.strategy.summary.expostCorr?.toFixed(2) ?? "—"}，跟踪误差 {overview.strategy.summary.expostTe != null ? pct(overview.strategy.summary.expostTe) : "—"}。
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                {sleeves.map((s) => (
                  <div key={s.sleeve} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">{s.label} 风险贡献</div>
                    <div className="text-lg font-semibold" style={{ color: SLEEVE_COLORS[s.sleeve] }}>{pct(overview.strategy.lastBudget[s.sleeve] ?? 0)}</div>
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
                <div className="text-sm font-medium">分类累计盈亏</div>
                <div className="text-[11px] text-slate-400">展示用分组，不是袖套风险预算</div>
              </div>
              <SleevePnlChart data={sleeveChartData} />
            </Card>

            <Tabs defaultValue="live">
              <TabsList className="bg-white">
                <TabsTrigger value="live">当前持仓</TabsTrigger>
                <TabsTrigger value="pnl">盈亏轨迹</TabsTrigger>
                <TabsTrigger value="backtest">回测摘要</TabsTrigger>
              </TabsList>

              <TabsContent value="live" className="space-y-4">
                {overview.isRebalanceDay && (overview.rebalanceTrades?.length ?? 0) > 0 && (
                  <Card className="border-amber-200 bg-amber-50/70 p-5 shadow-sm">
                    <div className="mb-1 text-sm font-semibold text-amber-900">
                      调仓日持仓变动 · {overview.book.lastRebalanceDate ?? overview.book.asOf}
                    </div>
                    <p className="mb-3 text-xs text-amber-800/80">
                      {overview.book.startedAt === overview.book.asOf
                        ? "今日建仓：按目标权重 × 1000 万 开出整数手。"
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
                  <div className="mb-3 text-sm font-medium">分类构成</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>分类</TableHead>
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
                        {[...s.products].sort((a, b) => b.margin - a.margin || b.targetWeight - a.targetWeight).map((p) => (
                          <TableRow key={p.asset} className={p.lots === 0 ? "text-slate-400" : undefined}>
                            <TableCell className="font-medium">{displayListedName(p.label, p.contract)}</TableCell>
                            <TableCell className="text-right font-medium">{p.lots}</TableCell>
                            <TableCell className="text-right">{p.price.toLocaleString("zh-CN")}</TableCell>
                            <TableCell className="text-right">{p.multiplier}</TableCell>
                            <TableCell className="text-right">{yuan(p.margin)}</TableCell>
                            <TableCell className="text-right">{pct(p.targetWeight)}</TableCell>
                            <TableCell className="text-right">
                              {pct(p.riskShare)}
                              {p.lots === 0 && (p.targetRiskShare ?? 0) !== 0 && (
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
                  <div className="mb-3 text-sm font-medium">
                    回测绩效（{overview.strategy.backtestStart} 至 {overview.strategy.backtestEnd}）
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <MiniStat label="累计收益" value={pct(overview.strategy.summary.cumulativeReturn)} className={pnlClass(overview.strategy.summary.cumulativeReturn)} />
                    <MiniStat label="CAGR" value={pct(overview.strategy.summary.cagr)} className={pnlClass(overview.strategy.summary.cagr)} />
                    <MiniStat label="年化波动" value={pct(overview.strategy.summary.annVol)} />
                    <MiniStat label="Sharpe" value={overview.strategy.summary.sharpe.toFixed(2)} />
                    <MiniStat label="最大回撤" value={pct(overview.strategy.summary.maxDrawdown)} />
                    <MiniStat label="再平衡次数" value={String(overview.strategy.summary.nRebalances)} />
                  </div>
                  <div className="mt-5 text-sm font-medium text-slate-800">对南华商品指数</div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <MiniStat label="样本外相关" value={overview.strategy.summary.expostCorr?.toFixed(3) ?? "—"} />
                    <MiniStat label="跟踪误差" value={overview.strategy.summary.expostTe != null ? pct(overview.strategy.summary.expostTe) : "—"} />
                    <MiniStat label="Beta" value={overview.strategy.summary.expostBeta?.toFixed(3) ?? "—"} />
                    <MiniStat label="R²" value={overview.strategy.summary.expostR2?.toFixed(3) ?? "—"} />
                  </div>
                  <div className="mt-5 text-sm font-medium text-slate-800">1000 万整手仿真</div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <MiniStat label="期末净值" value={overview.strategy.summary.realisticFinalNav != null ? yuan(overview.strategy.summary.realisticFinalNav) : "—"} />
                    <MiniStat label="CAGR" value={overview.strategy.summary.realisticCagr != null ? pct(overview.strategy.summary.realisticCagr) : "—"} className={pnlClass(overview.strategy.summary.realisticCagr ?? 0)} />
                    <MiniStat label="年化波动" value={overview.strategy.summary.realisticVol != null ? pct(overview.strategy.summary.realisticVol) : "—"} />
                    <MiniStat label="Sharpe" value={overview.strategy.summary.realisticSharpe?.toFixed(2) ?? "—"} />
                    <MiniStat label="最大回撤" value={overview.strategy.summary.realisticMaxDd != null ? pct(overview.strategy.summary.realisticMaxDd) : "—"} />
                  </div>
                  <Table className="mt-5">
                    <TableHeader>
                      <TableRow>
                        <TableHead>篮子</TableHead>
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

function SleevePnlChart({ data }: { data: Array<{ date: string } & Record<SleeveKey, number>> }) {
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
          <Tooltip formatter={(value, name) => [yuan(Number(value)), String(name)]} />
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
