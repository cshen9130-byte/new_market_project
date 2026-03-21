"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, RefreshCw, TrendingDown, TrendingUp, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

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

      {/* date range + refresh */}
      <div className="flex flex-wrap items-center gap-3">
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
        <div className="rounded-lg border border-border/60 bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="whitespace-nowrap">账户</TableHead>
                <TableHead className="whitespace-nowrap text-right">交易天数</TableHead>
                <TableHead className="whitespace-nowrap text-right">起止日期</TableHead>
                <TableHead className="whitespace-nowrap text-right">期间盈亏</TableHead>
                <TableHead className="whitespace-nowrap text-right">期间手续费</TableHead>
                <TableHead className="whitespace-nowrap text-right">净盈亏</TableHead>
                <TableHead className="whitespace-nowrap text-right">累计平仓盈亏</TableHead>
                <TableHead className="whitespace-nowrap text-right">持仓盈亏</TableHead>
                <TableHead className="whitespace-nowrap text-right">最新客户权益</TableHead>
                <TableHead className="whitespace-nowrap text-right">最新结存</TableHead>
                <TableHead className="whitespace-nowrap text-right">风险度</TableHead>
                <TableHead className="whitespace-nowrap text-right">保证金占用</TableHead>
                <TableHead className="whitespace-nowrap text-right">可用资金</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traders.map((t) => (
                <TableRow key={t.account}>
                  <TableCell className="font-medium whitespace-nowrap">{t.account}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.tradingDays}</TableCell>
                  <TableCell className="text-right tabular-nums whitespace-nowrap text-xs text-muted-foreground">
                    {t.firstDate ?? "—"} ~ {t.lastDate ?? "—"}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${pnlClass(t.periodPnl)}`}>
                    {fmt(t.periodPnl)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {fmt(t.periodFee)}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${pnlClass(t.netPnl)}`}>
                    {fmt(t.netPnl)}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${pnlClass(t.closePnl)}`}>
                    {fmt(t.closePnl)}
                  </TableCell>
                  <TableCell className={`text-right tabular-nums ${pnlClass(t.positionPnl)}`}>
                    {fmt(t.positionPnl)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(t.latestEquity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(t.latestBalance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(t.latestRiskRatio)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(t.latestMargin)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(t.latestAvailable)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!isLoading && !error && !notYetRun && traders.length === 0 && (
        <div className="rounded-md bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
          所选日期范围内无数据。
        </div>
      )}
    </div>
  )
}
