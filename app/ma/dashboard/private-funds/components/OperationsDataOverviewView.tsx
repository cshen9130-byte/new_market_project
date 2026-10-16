"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"
import {
  DATA_OVERVIEW_SCOPES,
  type DataOverviewResponse,
  type DataOverviewScope,
} from "@/lib/ops-data-overview"
import { UPDATE_CHANNELS, type UpdateChannel } from "@/lib/ops-update-channel"
import { OperationsUpdateChannelView } from "./OperationsUpdateChannelView"
import { NavAgeTree, ProductTotalTree } from "./ProductTotalTree"

function formatCount(count: number): string {
  return count.toLocaleString("zh-CN")
}

function formatShare(share: number): string {
  const pct = share * 100
  if (!Number.isFinite(pct) || pct === 0) return "0%"
  if (pct >= 99.95) return "100%"
  return `${pct.toFixed(1)}%`
}

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function sectionCount(body: DataOverviewResponse, sectionKey: string, rowKey: string): number {
  const section = body.sections.find((item) => item.key === sectionKey)
  return section?.rows.find((row) => row.key === rowKey)?.count ?? 0
}

export function OperationsDataOverviewView() {
  const [scope, setScope] = useState<DataOverviewScope>("all")
  const [channel, setChannel] = useState<UpdateChannel | "all">("all")
  const [refreshTick, setRefreshTick] = useState(0)
  const [channelLoading, setChannelLoading] = useState(false)
  const [body, setBody] = useState<DataOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const requestSeq = useRef(0)

  const load = useCallback((next: DataOverviewScope, refresh: boolean) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError("")
    const params = new URLSearchParams({ scope: next })
    if (refresh) params.set("refresh", "1")
    fetch(`/ma/api/ops/data-overview?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (seq !== requestSeq.current) return
        if (!res.ok || !json || !Array.isArray(json.sections)) {
          throw new Error(typeof json?.message === "string" ? json.message : "数据概览加载失败")
        }
        setBody(json as DataOverviewResponse)
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return
        setError(err instanceof Error ? err.message : "数据概览加载失败")
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (channel !== "all") return
    load(scope, false)
  }, [scope, channel, load])

  const visible = body?.scope === scope ? body : null
  const busy = channel === "all" ? loading : channelLoading
  const intro = channel === "fof99"
    ? "看火富牛名单里有多少产品、近一月有净值的有多少、我们跟上了多少，以及每周维护新纳入和改成更新偏慢的只数。下面再看有净值的产品和跟踪池里各跟踪方式的分布，以及上周和各周接口抓得怎么样。这个视图不跟范围走。"
    : channel === "email"
      ? "看有净值的产品和跟踪池里，有多少已经收到带备案号的邮箱净值，以及上周和各周邮件写了多少。这个视图不跟范围走。"
      : (visible?.description ?? "按全库、有净值、跟踪池、团队数据或平台数据查看产品状态，不展开到单只产品。")
  const cards = visible
    ? [
        { label: "产品总数", value: visible.total },
        { label: "在跟踪池", value: sectionCount(visible, "tracking", "in") },
        { label: "邮箱抓取", value: sectionCount(visible, "update_method", "email") },
        { label: "手动更新", value: sectionCount(visible, "update_method", "manual") },
        { label: "fof99", value: sectionCount(visible, "update_method", "fof99") },
      ]
    : []

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="bg-background border rounded-xl shadow-sm px-4 py-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-foreground">数据概览</h2>
            <p className="mt-1 text-xs text-zinc-500 leading-5 max-w-3xl">
              {intro}
              {channel === "all" ? " 红色数字打开对应列表，并带上这个状态。" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (channel === "all") load(scope, true)
              else setRefreshTick((tick) => tick + 1)
            }}
            disabled={busy}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>
        <div className="mt-3 flex items-center flex-wrap gap-1">
          <span className="text-zinc-400 text-xs w-12 shrink-0">范围</span>
          {DATA_OVERVIEW_SCOPES.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={channel !== "all"}
              onClick={() => setScope(item.key)}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium transition-colors",
                channel !== "all" ? "border-border text-zinc-300 cursor-default" : "",
                channel === "all" && scope === item.key
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : channel === "all"
                    ? "border-border text-zinc-500 hover:border-red-300 hover:text-red-500"
                    : "",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
          {channel === "all" && visible?.generated_at && (
            <span className="ml-auto text-[11px] text-zinc-400">
              统计时间 {formatGeneratedAt(visible.generated_at)}
              {loading ? " · 更新中" : ""}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center flex-wrap gap-1">
          <span className="text-zinc-400 text-xs w-12 shrink-0">更新</span>
          {UPDATE_CHANNELS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setChannel(item.key)}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium transition-colors",
                channel === item.key
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {channel !== "all" && (
        <OperationsUpdateChannelView
          channel={channel}
          refreshTick={refreshTick}
          onLoading={setChannelLoading}
        />
      )}

      {channel === "all" && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
          {error}
        </div>
      )}

      {channel === "all" && loading && !visible && (
        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
          正在统计产品状态…
        </div>
      )}

      {channel === "all" && visible && (
        <>
          <div className={`grid grid-cols-2 md:grid-cols-5 gap-2 ${loading ? "opacity-60" : ""}`}>
            {cards.map((card) => (
              <div key={card.label} className="rounded-xl border bg-background px-3 py-2.5 shadow-sm">
                <div className="text-[11px] text-zinc-400">{card.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatCount(card.value)}</div>
              </div>
            ))}
          </div>

          <section className={`rounded-xl border bg-background shadow-sm overflow-hidden ${loading ? "opacity-60" : ""}`}>
            <div className="px-4 py-2.5 border-b">
              <h3 className="text-xs font-semibold text-foreground">{visible.scope === "nav" ? "有净值" : "产品总数"}</h3>
              <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">
                {visible.scope === "nav"
                  ? "有净值的产品按产品页上较新的净值日期划分：1个月以内、1-3个月、3-6个月、6个月以上。没有日期的计入无净值日期。每一档再按备案号是否在 JY跟踪池划分。"
                  : "私募基金是产品总数减去股权、信托和资管。名称里有股权、信托、资管、有限合伙、创业投资或资产管理的也不计入私募基金，再按净值有无划分。有净值和无净值再按备案号是否在 JY跟踪池划分。"}
              </p>
            </div>
            {visible.scope === "nav" ? (
              <NavAgeTree ages={visible.nav_age} />
            ) : (
              <ProductTotalTree total={visible.total} navClass={visible.nav_class} />
            )}
          </section>

          <div className={`grid grid-cols-1 xl:grid-cols-2 gap-3 ${loading ? "opacity-60" : ""}`}>
            {visible.sections.map((section) => (
              <section key={section.key} className="rounded-xl border bg-background shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b">
                  <h3 className="text-xs font-semibold text-foreground">{section.title}</h3>
                  <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">{section.hint}</p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-400">
                      <th className="px-4 py-1.5 text-left font-medium">状态</th>
                      <th className="px-3 py-1.5 text-right font-medium w-24">产品数</th>
                      <th className="px-4 py-1.5 text-right font-medium w-16">占比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row) => {
                      const width = Math.max(0, Math.min(100, row.share * 100))
                      const count = (
                        <span className="relative z-[1] tabular-nums">{formatCount(row.count)}</span>
                      )
                      return (
                        <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200">{row.label}</td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="relative ml-auto inline-flex min-w-[4.5rem] justify-end">
                              <span
                                className="absolute inset-y-0 right-0 rounded-sm bg-red-100/80 dark:bg-red-950/40"
                                style={{ width: `${width}%` }}
                              />
                              {row.href ? (
                                <Link href={row.href} className="relative z-[1] tabular-nums text-red-600 hover:underline">
                                  {formatCount(row.count)}
                                </Link>
                              ) : count}
                            </div>
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums text-zinc-500">{formatShare(row.share)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
