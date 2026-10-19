"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DATA_OVERVIEW_SCOPES,
  type DataOverviewResponse,
  type DataOverviewScope,
  type FreshnessListBucket,
  type FreshnessProductList,
} from "@/lib/ops-data-overview"
import { UPDATE_CHANNELS, type UpdateChannel } from "@/lib/ops-update-channel"
import { OperationsUpdateChannelView } from "./OperationsUpdateChannelView"
import { NavAgeTree, ProductTotalTree } from "./ProductTotalTree"
import { NavRulesCatalogButton } from "./NavRulesCatalogButton"
import { WeeklyReviewDataStatus } from "./WeeklyReviewDataStatus"
import {
  channelCacheKey,
  isChannelBody,
  isOverviewBody,
  isWeeklyBody,
  loadOpsCache,
  overviewCacheKey,
  peekOpsCache,
  prefetchOpsCache,
  weeklyCacheKey,
} from "./ops-overview-cache"

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

const FRESHNESS_PAGE_SIZE = 100

function freshnessListBucket(sectionKey: string, rowKey: string, count: number): FreshnessListBucket | null {
  if (sectionKey !== "nav_freshness" || count <= 0) return null
  if (rowKey === "w2" || rowKey === "w3") return rowKey
  return null
}

function FreshnessProductsDialog({
  scope,
  bucket,
  onClose,
}: {
  scope: DataOverviewScope
  bucket: FreshnessListBucket
  onClose: () => void
}) {
  const [body, setBody] = useState<FreshnessProductList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [keyword, setKeyword] = useState("")
  const [page, setPage] = useState(0)
  const requestSeq = useRef(0)

  useEffect(() => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError("")
    setBody(null)
    setKeyword("")
    setPage(0)
    const params = new URLSearchParams({ scope, bucket })
    fetch(`/ma/api/ops/data-overview/freshness-products?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (seq !== requestSeq.current) return
        if (!res.ok || !json || !Array.isArray(json.products)) {
          throw new Error(typeof json?.message === "string" ? json.message : "产品列表加载失败")
        }
        setBody(json as FreshnessProductList)
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return
        setError(err instanceof Error ? err.message : "产品列表加载失败")
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
      })
  }, [scope, bucket])

  const filtered = useMemo(() => {
    const rows = body?.products ?? []
    const q = keyword.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => row.name.toLowerCase().includes(q) || row.code.toLowerCase().includes(q))
  }, [body, keyword])

  const pageCount = Math.max(1, Math.ceil(filtered.length / FRESHNESS_PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visibleRows = filtered.slice(safePage * FRESHNESS_PAGE_SIZE, (safePage + 1) * FRESHNESS_PAGE_SIZE)
  const title = body ? `${body.scope_label} · ${body.label}` : "净值月内新鲜度"

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {body?.hint ?? "正在列出这一档的产品。"}
            点备案号打开产品页。
            {body ? ` 共 ${formatCount(body.total)} 只，统计日 ${body.as_of}。` : ""}
          </DialogDescription>
        </DialogHeader>
        <input
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value)
            setPage(0)
          }}
          placeholder="搜索产品或备案号"
          className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus:border-red-300"
        />
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
        )}
        {loading && (
          <div className="py-8 text-center text-sm text-muted-foreground">正在列出产品…</div>
        )}
        {body && !loading && (
          <>
            <div className="overflow-auto min-h-0">
              <table className="w-full text-xs min-w-[640px]">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-zinc-400">
                    <th className="px-2 py-1.5 text-left font-medium">产品</th>
                    <th className="px-2 py-1.5 text-left font-medium">备案号</th>
                    <th className="px-2 py-1.5 text-left font-medium">净值日期</th>
                    <th className="px-2 py-1.5 text-right font-medium">落后</th>
                    <th className="px-2 py-1.5 text-left font-medium">跟踪池</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="px-2 py-3 text-zinc-400" colSpan={5}>
                        {keyword.trim() ? "没有匹配的产品。" : "这一档没有产品。"}
                      </td>
                    </tr>
                  ) : visibleRows.map((row, index) => (
                    <tr key={`${row.code}-${row.nav_date}-${row.name}-${index}`} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-200 max-w-[280px] truncate" title={row.name}>
                        {row.name || "—"}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {row.code ? (
                          <a
                            href={`/ma/dashboard/private-funds/${encodeURIComponent(row.code)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-red-600 hover:underline tabular-nums"
                          >
                            {row.code}
                          </a>
                        ) : "—"}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-300">{row.nav_date}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-300">
                        {formatCount(row.lag_days)}天
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{row.in_pool ? "在" : "不在"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
              <span>
                {filtered.length === 0
                  ? "0 只"
                  : `${formatCount(safePage * FRESHNESS_PAGE_SIZE + 1)}–${formatCount(Math.min(filtered.length, (safePage + 1) * FRESHNESS_PAGE_SIZE))} / ${formatCount(filtered.length)} 只`}
              </span>
              {pageCount > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                    className="px-2 py-1 rounded border border-border disabled:opacity-40 hover:border-red-300 hover:text-red-500"
                  >
                    上一页
                  </button>
                  <span className="tabular-nums px-1">{safePage + 1} / {pageCount}</span>
                  <button
                    type="button"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage(safePage + 1)}
                    className="px-2 py-1 rounded border border-border disabled:opacity-40 hover:border-red-300 hover:text-red-500"
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function OperationsDataOverviewView() {
  const [scope, setScope] = useState<DataOverviewScope>("all")
  const [channel, setChannel] = useState<UpdateChannel | "all">("all")
  const [refreshTick, setRefreshTick] = useState(0)
  const [statusRefresh, setStatusRefresh] = useState(0)
  const [channelLoading, setChannelLoading] = useState(false)
  const [body, setBody] = useState<DataOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [freshList, setFreshList] = useState<FreshnessListBucket | null>(null)
  const requestSeq = useRef(0)

  const load = useCallback((next: DataOverviewScope, refresh: boolean) => {
    const seq = ++requestSeq.current
    const cached = refresh ? null : peekOpsCache<DataOverviewResponse>(overviewCacheKey(next))
    if (cached?.scope === next) {
      setBody(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError("")
    const params = new URLSearchParams({ scope: next })
    if (refresh) params.set("refresh", "1")
    loadOpsCache(
      overviewCacheKey(next),
      `/ma/api/ops/data-overview?${params}`,
      refresh,
      isOverviewBody,
      "数据概览加载失败",
    )
      .then((json) => {
        if (seq !== requestSeq.current) return
        setBody(json)
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
    for (const item of DATA_OVERVIEW_SCOPES) {
      const params = new URLSearchParams({ scope: item.key })
      prefetchOpsCache(overviewCacheKey(item.key), `/ma/api/ops/data-overview?${params}`, isOverviewBody, "数据概览加载失败")
    }
    for (const item of ["fof99", "email"] as const) {
      prefetchOpsCache(channelCacheKey(item), `/ma/api/ops/data-overview/update?channel=${item}`, isChannelBody, "更新渠道加载失败")
    }
    for (const item of ["equity", "futures"] as const) {
      prefetchOpsCache(
        weeklyCacheKey(item, "", ""),
        `/ma/api/ops/data-overview/weekly-review?variant=${item}`,
        isWeeklyBody,
        "周度回顾数据状态加载失败",
      )
    }
  }, [])

  useEffect(() => {
    if (channel !== "all") return
    load(scope, false)
  }, [scope, channel, load])

  const cachedOverview = peekOpsCache<DataOverviewResponse>(overviewCacheKey(scope))
  const visible = body?.scope === scope ? body : cachedOverview?.scope === scope ? cachedOverview : null
  const busy = channel === "all" ? loading : channelLoading
  const intro = channel === "fof99"
    ? "看火富牛接口正在跟踪的产品现在靠哪些来源更新、净值日期有多新。下面再看名单里有多少产品、近一月有净值的有多少、我们跟上了多少，以及每周维护新纳入和改成更新偏慢的只数，还有有净值产品和跟踪池里各跟踪方式的分布，以及上周和各周接口抓得怎么样。这个视图不跟范围走。"
    : channel === "email"
      ? "看有净值的产品和跟踪池里，有多少已经收到带备案号的邮箱净值，以及上周和各周邮件写了多少。下面再看这些邮箱产品现在靠哪些来源更新，净值日期有多新。这个视图不跟范围走。"
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
          <div className="flex items-center gap-2">
            <NavRulesCatalogButton />
            <button
              type="button"
              onClick={() => {
                if (channel === "all") {
                  load(scope, true)
                  setStatusRefresh((tick) => tick + 1)
                } else setRefreshTick((tick) => tick + 1)
              }}
              disabled={busy}
              className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
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
        </>
      )}

      {channel === "all" && scope === "tracking" && (
        <WeeklyReviewDataStatus refreshTick={statusRefresh} />
      )}

      {channel === "all" && visible && (
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
                      const openFreshness = freshnessListBucket(section.key, row.key, row.count)
                      const count = (
                        <span className="relative z-[1] tabular-nums">{formatCount(row.count)}</span>
                      )
                      return (
                        <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200">
                            {openFreshness ? (
                              <button
                                type="button"
                                onClick={() => setFreshList(openFreshness)}
                                className="hover:text-red-600 hover:underline"
                              >
                                {row.label}
                              </button>
                            ) : row.label}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="relative ml-auto inline-flex min-w-[4.5rem] justify-end">
                              <span
                                className="absolute inset-y-0 right-0 rounded-sm bg-red-100/80 dark:bg-red-950/40"
                                style={{ width: `${width}%` }}
                              />
                              {openFreshness ? (
                                <button
                                  type="button"
                                  onClick={() => setFreshList(openFreshness)}
                                  className="relative z-[1] tabular-nums text-red-600 hover:underline"
                                >
                                  {formatCount(row.count)}
                                </button>
                              ) : row.href ? (
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
      )}
      {channel === "all" && freshList && (
        <FreshnessProductsDialog
          scope={scope}
          bucket={freshList}
          onClose={() => setFreshList(null)}
        />
      )}
    </div>
  )
}
