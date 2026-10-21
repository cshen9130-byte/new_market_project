"use client"

import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { WeeklyReviewPoolKey } from "@/lib/ma/weekly-review-pools"
import {
  WEEKLY_REVIEW_SOURCE_LABEL,
  WEEKLY_REVIEW_SOURCE_ORDER,
  weeklyReviewMetricLabel,
  type WeeklyReviewCategoryStatus,
  type WeeklyReviewDataStatus,
  type WeeklyReviewSource,
  type WeeklyReviewStatusVariant,
} from "@/lib/weekly-review-data-status"
import { isWeeklyBody, loadOpsCache, peekOpsCache, weeklyCacheKey } from "./ops-overview-cache"

function formatCount(count: number): string {
  return count.toLocaleString("zh-CN")
}

function slashDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  const [y, m, d] = iso.slice(0, 10).split("-")
  if (!y || !m || !d) return "—"
  return `${y}/${Number(m)}/${Number(d)}`
}

function shortRange(start: string, end: string): string {
  const left = slashDate(start).slice(5)
  const right = slashDate(end).slice(5)
  return `${left}–${right}`
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

function sourceSummary(counts: Record<WeeklyReviewSource, number>): string {
  const parts = WEEKLY_REVIEW_SOURCE_ORDER
    .filter((key) => counts[key] > 0)
    .map((key) => `${WEEKLY_REVIEW_SOURCE_LABEL[key]} ${formatCount(counts[key])}`)
  return parts.join(" · ")
}

const VARIANTS: Array<{ key: WeeklyReviewStatusVariant; label: string }> = [
  { key: "equity", label: "股票" },
  { key: "futures", label: "期货" },
]

export function WeeklyReviewDataStatus({
  refreshTick = 0,
  variant: lockedVariant,
  pools,
  weekEnd,
  embedded = false,
}: {
  refreshTick?: number
  /** Set on the weekly-review page, which already chose 股票 or 期货. */
  variant?: WeeklyReviewStatusVariant
  pools?: WeeklyReviewPoolKey[]
  weekEnd?: string
  embedded?: boolean
}) {
  const [variant, setVariant] = useState<WeeklyReviewStatusVariant>(lockedVariant ?? "equity")
  const poolKey = (pools ?? []).join(",")
  const [body, setBody] = useState<WeeklyReviewDataStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [openBucket, setOpenBucket] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<WeeklyReviewSource | "all">("all")
  const requestSeq = useRef(0)

  const load = useCallback((next: WeeklyReviewStatusVariant, refresh: boolean, poolKeys: string, anchor: string) => {
    const seq = ++requestSeq.current
    const key = weeklyCacheKey(next, poolKeys, anchor)
    const cached = refresh ? null : peekOpsCache<WeeklyReviewDataStatus>(key)
    if (cached?.variant === next) {
      setBody(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError("")
    const params = new URLSearchParams({ variant: next })
    if (refresh) params.set("refresh", "1")
    if (poolKeys) params.set("pools", poolKeys)
    if (anchor) params.set("week_end", anchor)
    loadOpsCache(key, `/ma/api/ops/data-overview/weekly-review?${params}`, refresh, isWeeklyBody, "周度回顾数据状态加载失败")
      .then((json) => {
        if (seq !== requestSeq.current) return
        setBody(json)
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return
        setError(err instanceof Error ? err.message : "周度回顾数据状态加载失败")
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (lockedVariant) setVariant(lockedVariant)
  }, [lockedVariant])

  useEffect(() => {
    setOpenBucket(null)
    setSourceFilter("all")
    load(lockedVariant ?? variant, refreshTick > 0, poolKey, weekEnd ?? "")
  }, [lockedVariant, variant, refreshTick, poolKey, weekEnd, load])

  const cachedWeekly = peekOpsCache<WeeklyReviewDataStatus>(weeklyCacheKey(variant, poolKey, weekEnd ?? ""))
  const visible = body?.variant === variant ? body : cachedWeekly?.variant === variant ? cachedWeekly : null

  return (
    <section className={`rounded-xl border bg-background shadow-sm overflow-hidden ${loading && visible ? "opacity-60" : ""}`}>
      <div className="px-4 py-2.5 border-b">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-xs font-semibold text-foreground">{embedded ? "近三周数据状态" : "JY跟踪池 · 周度回顾"}</h3>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-400 max-w-3xl">
              {variant === "futures"
                ? "量化期货和主观期货与周度回顾（期货）同一批产品、同一份额合并。量化 6 类里，混合、量价、商品不进入；主观 6 类为黑色、有色、能化、农产、多板块（包含 MOM）和 MOM。一只产品可以出现在多类里，合计产品数按备案号去重。"
                : "股票策略与周度回顾（股票）同一批产品、同一份额合并。"}
              {" "}某一周算有数据，是指周一到周五里有一条周报会用来写近一周的净值。缺失按更新方式拆开：同一天优先手动更新，其次邮箱抓取，再次 fof99。份额家族里较新的一条算这个产品的来源。没有这些记录的算无团队更新。来源日期落在缺失的那一周里，表示通道已经有数，周报序列没有采用。
            </p>
          </div>
          {visible?.generated_at && (
            <span className="text-[11px] text-zinc-400 shrink-0">
              统计时间 {formatGeneratedAt(visible.generated_at)}
              {loading ? " · 更新中" : ""}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center flex-wrap gap-1">
          {!embedded && <span className="text-zinc-400 text-xs w-12 shrink-0">周报</span>}
          {!embedded && VARIANTS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setVariant(item.key)
                setOpenBucket(null)
                setSourceFilter("all")
              }}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium transition-colors",
                variant === item.key
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
          {visible && (
            <span className="ml-auto text-[11px] text-zinc-400">
              {formatCount(visible.fund_count)} 只
              {visible.weeks.length > 0 ? ` · ${visible.weeks.map((week) => shortRange(week.week_start, week.week_end)).join(" · ")}` : ""}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 text-xs text-red-600">{error}</div>
      )}

      {loading && !visible && !error && (
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
          正在统计近三周净值…
        </div>
      )}

      {visible && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[920px]">
            <thead>
              <tr className="text-zinc-400">
                <th rowSpan={2} className="px-4 py-1.5 text-left font-medium align-bottom">策略</th>
                <th rowSpan={2} className="px-3 py-1.5 text-left font-medium align-bottom whitespace-nowrap">指标口径</th>
                <th rowSpan={2} className="px-3 py-1.5 text-right font-medium w-16 align-bottom">产品数</th>
                {visible.weeks.map((week) => (
                  <th key={week.week_end} className="px-3 pt-1.5 text-left font-medium" colSpan={2}>
                    {shortRange(week.week_start, week.week_end)}
                  </th>
                ))}
              </tr>
              <tr className="text-zinc-400">
                {visible.weeks.map((week) => (
                  <Fragment key={`${week.week_end}-sub`}>
                    <th className="px-3 pb-1.5 text-right font-medium w-14">缺失</th>
                    <th className="px-3 pb-1.5 text-left font-medium">数据来源</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.categories.map((category) => (
                <CategoryRows
                  key={category.bucket}
                  category={category}
                  open={openBucket === category.bucket}
                  sourceFilter={sourceFilter}
                  onToggle={() => {
                    setOpenBucket((current) => current === category.bucket ? null : category.bucket)
                    setSourceFilter("all")
                  }}
                  onFilter={setSourceFilter}
                />
              ))}
              <tr className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-900/40 font-medium">
                <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200">合计</td>
                <td className="px-3 py-1.5" />
                <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(visible.fund_count)}</td>
                {visible.weeks.map((week) => {
                  const { missing, bySource } = uniqueWeekMissing(visible.categories, week.week_end)
                  return (
                    <WeekCells key={week.week_end} missing={missing} summary={missing === 0 ? "" : sourceSummary(bySource)} />
                  )
                })}
              </tr>
            </tbody>
          </table>
          {visible.categories.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-zinc-400">这个周报里暂无产品</div>
          )}
        </div>
      )}
    </section>
  )
}

function uniqueWeekMissing(
  categories: WeeklyReviewCategoryStatus[],
  weekEnd: string,
): { missing: number; bySource: Record<WeeklyReviewSource, number> } {
  const byCode = new Map<string, WeeklyReviewSource>()
  for (const category of categories) {
    for (const fund of category.missing_funds) {
      if (fund.weeks[weekEnd] !== false) continue
      if (!byCode.has(fund.beian_hao)) byCode.set(fund.beian_hao, fund.source)
    }
  }
  const bySource: Record<WeeklyReviewSource, number> = { email: 0, manual: 0, fof99: 0, none: 0 }
  for (const source of byCode.values()) bySource[source] += 1
  return { missing: byCode.size, bySource }
}

function WeekCells({ missing, summary, blank = false }: { missing: number; summary: string; blank?: boolean }) {
  if (blank) {
    return (
      <>
        <td className="px-3 py-1.5 text-right text-zinc-400">—</td>
        <td className="px-3 py-1.5 text-zinc-400">—</td>
      </>
    )
  }
  return (
    <>
      <td className={`px-3 py-1.5 text-right tabular-nums ${missing > 0 ? "text-red-600" : "text-zinc-400"}`}>
        {missing > 0 ? formatCount(missing) : "齐"}
      </td>
      <td className="px-3 py-1.5 text-zinc-500">{summary || "—"}</td>
    </>
  )
}

function CategoryRows({
  category,
  open,
  sourceFilter,
  onToggle,
  onFilter,
}: {
  category: WeeklyReviewCategoryStatus
  open: boolean
  sourceFilter: WeeklyReviewSource | "all"
  onToggle: () => void
  onFilter: (source: WeeklyReviewSource | "all") => void
}) {
  const funds = sourceFilter === "all"
    ? category.missing_funds
    : category.missing_funds.filter((fund) => fund.source === sourceFilter)
  const weekCount = category.weeks.length
  return (
    <>
      <tr className="border-t border-zinc-100 dark:border-zinc-800">
        <td className="px-4 py-1.5">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-start gap-1 text-left whitespace-normal text-zinc-700 dark:text-zinc-200 hover:text-red-600"
          >
            {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            {category.bucket}
          </button>
        </td>
        <td className="px-3 py-1.5 text-zinc-500 whitespace-nowrap">{weeklyReviewMetricLabel(category.mode)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700 dark:text-zinc-200">{formatCount(category.total)}</td>
        {category.weeks.map((week) => (
          <WeekCells
            key={week.week_end}
            blank={category.total === 0}
            missing={week.missing}
            summary={week.missing === 0 ? "" : sourceSummary(week.by_source)}
          />
        ))}
      </tr>
      {open && (
        <tr className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/30">
          <td colSpan={3 + weekCount * 2} className="px-4 py-2">
            {category.total === 0 ? (
              <p className="text-[11px] text-zinc-400">这一类没有产品。</p>
            ) : category.missing_funds.length === 0 ? (
              <p className="text-[11px] text-zinc-400">近三周都有净值。</p>
            ) : (
              <div>
                <div className="mb-2 flex items-center flex-wrap gap-1">
                  <span className="text-[11px] text-zinc-400 mr-1">只看缺失</span>
                  <FilterChip active={sourceFilter === "all"} onClick={() => onFilter("all")} label={`全部 ${formatCount(category.missing_funds.length)}`} />
                  {WEEKLY_REVIEW_SOURCE_ORDER.map((source) => {
                    const count = category.missing_funds.filter((fund) => fund.source === source).length
                    if (count === 0) return null
                    return (
                      <FilterChip
                        key={source}
                        active={sourceFilter === source}
                        onClick={() => onFilter(source)}
                        label={`${WEEKLY_REVIEW_SOURCE_LABEL[source]} ${formatCount(count)}`}
                      />
                    )
                  })}
                </div>
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-[11px] min-w-[640px]">
                    <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 text-zinc-400">
                      <tr>
                        <th className="py-1 pr-3 text-left font-medium">产品</th>
                        <th className="py-1 pr-3 text-left font-medium">备案号</th>
                        <th className="py-1 pr-3 text-left font-medium">数据来源</th>
                        <th className="py-1 pr-3 text-left font-medium">来源日期</th>
                        <th className="py-1 pr-3 text-left font-medium">周报净值</th>
                        {category.weeks.map((week) => (
                          <th key={week.week_end} className="py-1 px-2 text-center font-medium">{slashDate(week.week_end).slice(5)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {funds.map((fund) => (
                        <tr key={fund.beian_hao} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="py-1 pr-3 text-zinc-700 dark:text-zinc-200">{fund.name}</td>
                          <td className="py-1 pr-3 tabular-nums text-zinc-500">{fund.beian_hao}</td>
                          <td className="py-1 pr-3 text-zinc-600 dark:text-zinc-300">{WEEKLY_REVIEW_SOURCE_LABEL[fund.source]}</td>
                          <td className="py-1 pr-3 tabular-nums text-zinc-500">{slashDate(fund.source_date)}</td>
                          <td className="py-1 pr-3 tabular-nums text-zinc-500">{slashDate(fund.nav_date)}</td>
                          {category.weeks.map((week) => {
                            const present = fund.weeks[week.week_end]
                            const unused = fund.unused_weeks.includes(week.week_end)
                            return (
                              <td key={week.week_end} className={`py-1 px-2 text-center ${present ? "text-zinc-400" : "text-red-600"}`}>
                                {present ? "有" : unused ? "缺·未采用" : "缺"}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                      {funds.length === 0 && (
                        <tr>
                          <td colSpan={5 + weekCount} className="py-2 text-zinc-400">这个来源下没有缺失产品。</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center px-2 py-0.5 rounded border text-[11px] transition-colors",
        active
          ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
          : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
      ].join(" ")}
    >
      {label}
    </button>
  )
}
