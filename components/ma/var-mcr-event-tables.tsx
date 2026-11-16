"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { EventTableBlock, EventTableRow, EventTablesPayload } from "@/lib/ma/var-mcr-event-table"

const API_URL = "/ma/api/mom-analysis/var-mcr-events?volDays=20&corrDays=252"
const POLL_MS = 60_000
const STALE_RETRY_MS = 8_000

type Payload = EventTablesPayload & { ok: boolean; cacheStatus?: string; error?: string }

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

export default function VarMcrEventTables() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const resp = await fetch(API_URL, { cache: "no-cache" })
      const json = (await resp.json()) as Payload
      if (!json?.ok) {
        setError(json?.error || "加载失败")
        return
      }
      setError(null)
      setData(json)
      const stale = resp.headers.get("X-Mom-Cache") === "stale" || json.cacheStatus === "stale"
      if (stale) {
        if (staleTimer.current) clearTimeout(staleTimer.current)
        staleTimer.current = setTimeout(() => { void load() }, STALE_RETRY_MS)
      }
    } catch {
      setError("加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const onVis = () => {
      if (document.visibilityState === "visible") void load()
    }
    document.addEventListener("visibilitychange", onVis)
    const poll = setInterval(() => { void load() }, POLL_MS)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      clearInterval(poll)
      if (staleTimer.current) clearTimeout(staleTimer.current)
    }
  }, [load])

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
