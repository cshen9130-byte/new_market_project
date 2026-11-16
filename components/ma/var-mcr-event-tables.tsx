"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { EventTableBlock, EventTableRow, EventTablesPayload, RegimeStatusRow, RegimeTrigger } from "@/lib/ma/var-mcr-event-table"

const API_URL = "/ma/api/mom-analysis/var-mcr-events?volDays=20&corrDays=252"
const POLL_MS = 60_000
const STALE_RETRY_MS = 8_000

type Payload = EventTablesPayload & { ok: boolean; cacheStatus?: string; error?: string }

type FeedSnap = { data: Payload | null; loading: boolean; error: string | null }

let feed: FeedSnap = { data: null, loading: true, error: null }
const feedListeners = new Set<() => void>()
let feedUsers = 0
let feedPoll: ReturnType<typeof setInterval> | null = null
let feedStale: ReturnType<typeof setTimeout> | null = null
let feedVis: (() => void) | null = null

function setFeed(next: FeedSnap) {
  feed = next
  for (const listener of feedListeners) listener()
}

async function loadEvents() {
  try {
    const resp = await fetch(API_URL, { cache: "no-cache" })
    const json = (await resp.json()) as Payload
    if (!json?.ok) {
      setFeed({ data: feed.data, loading: false, error: json?.error || "加载失败" })
      return
    }
    setFeed({ data: json, loading: false, error: null })
    const stale = resp.headers.get("X-Mom-Cache") === "stale" || json.cacheStatus === "stale"
    const oldShape = Boolean(json.latestDate && json.regimeTable == null)
    if (oldShape) {
      const again = await fetch(`${API_URL}&nocache=1`, { cache: "no-cache" })
      const fresh = (await again.json()) as Payload
      if (fresh?.ok) setFeed({ data: fresh, loading: false, error: null })
      return
    }
    if (stale) {
      if (feedStale) clearTimeout(feedStale)
      feedStale = setTimeout(() => { void loadEvents() }, STALE_RETRY_MS)
    }
  } catch {
    setFeed({ data: feed.data, loading: false, error: feed.data ? null : "加载失败" })
  }
}

function startFeed() {
  if (feedPoll) return
  void loadEvents()
  feedVis = () => {
    if (document.visibilityState === "visible") void loadEvents()
  }
  document.addEventListener("visibilitychange", feedVis)
  feedPoll = setInterval(() => { void loadEvents() }, POLL_MS)
}

function stopFeed() {
  if (feedVis) document.removeEventListener("visibilitychange", feedVis)
  feedVis = null
  if (feedPoll) clearInterval(feedPoll)
  feedPoll = null
  if (feedStale) clearTimeout(feedStale)
  feedStale = null
}

function useEventsFeed(): FeedSnap {
  const [snap, setSnap] = useState(feed)
  useEffect(() => {
    feedUsers += 1
    if (feedUsers === 1) startFeed()
    const listener = () => setSnap(feed)
    feedListeners.add(listener)
    setSnap(feed)
    return () => {
      feedListeners.delete(listener)
      feedUsers -= 1
      if (feedUsers === 0) stopFeed()
    }
  }, [])
  return snap
}

function triggerTextClass(trigger: RegimeTrigger): string {
  if (trigger === "yes") return "text-amber-800 font-medium"
  if (trigger === "near") return "text-amber-700"
  return "text-slate-600"
}

function triggerRowClass(trigger: RegimeTrigger): string {
  if (trigger === "yes") return "bg-amber-50"
  if (trigger === "near") return "bg-amber-50/60"
  return ""
}

function ruleText(row: RegimeStatusRow): string {
  if (row.rule.startsWith("持仓品种")) return row.rule
  if (row.key === "corr_surge") return `持仓品种 ${row.rule}`
  if (row.key === "corr_collapse") return `持仓品种${row.rule}`
  return row.rule
}

function triggerChipClass(trigger: RegimeTrigger): string {
  if (trigger === "yes") return "border-amber-400 bg-amber-100 text-amber-900"
  if (trigger === "near") return "border-amber-300 bg-amber-50 text-amber-800"
  return "border-slate-200 bg-white text-slate-500"
}

function actionClass(action: string): string {
  if (action.startsWith("硬性减仓")) return "bg-red-100 text-red-800 border-red-200"
  if (action.startsWith("硬阈值冻结")) return "bg-violet-100 text-violet-800 border-violet-200"
  if (action.startsWith("预警")) return "bg-amber-100 text-amber-800 border-amber-200"
  if (action === "观察") return "bg-slate-100 text-slate-700 border-slate-200"
  return "bg-white text-slate-500 border-slate-200"
}

function rowClass(action: string): string {
  if (action.startsWith("硬性减仓")) return "bg-red-50/80"
  if (action.startsWith("硬阈值冻结")) return "bg-violet-50/80"
  if (action.includes("应冻结")) return "bg-amber-50/90"
  if (action.startsWith("预警")) return "bg-amber-50/40"
  return ""
}

function EventTable({ block }: { block: EventTableBlock }) {
  const title = block.kind === "product"
    ? `第一品种拥挤片段 · ${block.label}`
    : `第一板块拥挤片段 · ${block.label}`
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          {title}
          <span className="text-xs font-normal text-muted-foreground">
            {block.windowFrom} 至 {block.windowTo}
            {block.asOfSharePct != null ? ` · 最新贡献 ${block.asOfSharePct.toFixed(1)}%` : ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="px-2.5 py-1.5 text-left font-medium">日期</th>
                <th className="px-2.5 py-1.5 text-right font-medium">{block.shareHeader}</th>
                <th className="px-2.5 py-1.5 text-right font-medium">{block.secondHeader}</th>
                <th className="px-2.5 py-1.5 text-left font-medium">驱动</th>
                <th className="px-2.5 py-1.5 text-right font-medium">ΔVaR</th>
                <th className="px-2.5 py-1.5 text-right font-medium">VaR/资本</th>
                <th className="px-2.5 py-1.5 text-right font-medium">信号数</th>
                <th className="px-2.5 py-1.5 text-left font-medium">正式动作</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row: EventTableRow) => (
                <tr key={row.date} className={`border-b last:border-0 ${rowClass(row.actionDisplay)}`} title={row.signsCn.join("、") || "无信号"}>
                  <td className="px-2.5 py-1.5 font-mono whitespace-nowrap">{row.dateShort}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono whitespace-nowrap">{row.shareText}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono whitespace-nowrap">{row.secondText}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{row.driverLabel}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono whitespace-nowrap">{row.dVarText}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono whitespace-nowrap">{row.varPctText}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono" title={row.signsCn.join("、")}>{row.nSigns}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                    <Badge variant="outline" className={actionClass(row.actionDisplay)}>{row.actionDisplay}</Badge>
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

export function VarMcrRegimeTable() {
  const { data, loading, error } = useEventsFeed()
  const table = data?.regimeTable

  if (loading && !table) {
    return (
      <section id="section-intraday-regime" className="mt-4">
        <p className="text-sm text-muted-foreground">极端市场状态加载中...</p>
      </section>
    )
  }

  if (!table) {
    return (
      <section id="section-intraday-regime" className="mt-4">
        <p className="text-sm text-muted-foreground">{error || "暂无极端市场状态"}</p>
      </section>
    )
  }

  return (
    <section id="section-intraday-regime" className="mt-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex flex-wrap items-center gap-2">
            极端市场状态
            <span className="text-xs font-normal text-muted-foreground">
              最新交易日 {table.date}
              {table.matureDays > 0 ? ` · 成熟样本 ${table.matureDays} 日` : ""}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex flex-wrap gap-1.5">
            {table.rows.map((row) => (
              <span key={row.key} className={`rounded border px-2 py-0.5 text-[11px] ${triggerChipClass(row.trigger)}`}>
                {row.status}
                <span className="ml-1">{row.trigger === "yes" ? "是" : row.trigger === "near" ? "接近" : "否"}</span>
              </span>
            ))}
          </div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">状态</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">检测规则（成熟样本）</th>
                  <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">{table.dateLabel} 是否触发</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">对 MOM 干预的含义</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row: RegimeStatusRow) => (
                  <tr key={row.key} className={`border-b last:border-0 ${triggerRowClass(row.trigger)}`}>
                    <td className="px-2.5 py-1.5 whitespace-nowrap font-medium">{row.status}</td>
                    <td className="px-2.5 py-1.5 text-slate-700">{ruleText(row)}</td>
                    <td className={`px-2.5 py-1.5 whitespace-nowrap ${triggerTextClass(row.trigger)}`}>{row.triggerText}</td>
                    <td className="px-2.5 py-1.5 text-slate-600">{row.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] leading-5 text-muted-foreground">
            阈值按品种数不少于 20 的成熟样本校准，并随每个交易日的持仓与行情重算。触发只标记当天的市场状态，不因此自动减仓。
          </p>
        </CardContent>
      </Card>
    </section>
  )
}

export default function VarMcrEventTables() {
  const { data, loading, error } = useEventsFeed()

  if (loading && !data) {
    return (
      <section id="section-intraday-mcr-events" className="mt-4">
        <p className="text-sm text-muted-foreground">拥挤事件表加载中...</p>
      </section>
    )
  }

  if (error && !data) {
    return (
      <section id="section-intraday-mcr-events" className="mt-4">
        <p className="text-sm text-muted-foreground">{error}</p>
      </section>
    )
  }

  if (!data?.productTable && !data?.sectorTable) {
    return (
      <section id="section-intraday-mcr-events" className="mt-4">
        <p className="text-sm text-muted-foreground">暂无拥挤事件表</p>
      </section>
    )
  }

  return (
    <section id="section-intraday-mcr-events" className="mt-4 space-y-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">拥挤事件表</h3>
        <span className="text-xs text-muted-foreground">
          {data.selectedDate}
          {data.selectedDate !== data.latestDate ? `（最新日 ${data.latestDate}）` : ""}
        </span>
      </div>
      {data.productTable && <EventTable block={data.productTable} />}
      {data.sectorTable && <EventTable block={data.sectorTable} />}
      {data.footnote && (
        <p className="text-[11px] leading-5 text-muted-foreground">{data.footnote}</p>
      )}
    </section>
  )
}
