"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { channelCacheKey, isChannelBody, loadOpsCache, peekOpsCache } from "./ops-overview-cache"
import { EMAIL_COHORTS, EMAIL_STALE_LIST_LABEL, FOF99_COHORTS, emailFreshnessBucket, emailFreshnessListKey, formatCnMonthDay, parseFof99RecentListPolicy, type EmailCohortKey, type EmailCohortStatus, type EmailCountBridge, type EmailProductStatus, type EmailStaleListKey, type EmailStaleListResponse, type EmailStaleProduct, type Fof99CohortKey, type Fof99CohortStatus, type Fof99ListCoverage, type Fof99ProductStatus, type Fof99RecentListPolicy, type Fof99RecentListResponse, type UniverseMoves, type UpdateChannel, type UpdateChannelResponse, type UpdateCoverageBlock, type UpdateCoverageRow, type UpdateWeekStat } from "@/lib/ops-update-channel"

const POLICY_COLOR: Record<string, string> = {
  weekly: "#D93025",
  weekly_plus: "#1A73E8",
  update_slow: "#FBBC04",
  skip: "#a1a1aa",
  none: "#d4d4d8",
  email: "#1A73E8",
}

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

function rate(ok: number, total: number): string {
  if (total <= 0) return "—"
  return formatShare(ok / total)
}

function dateSpan(week: UpdateWeekStat): string {
  if (!week.min_date && !week.max_date) return "—"
  if (week.min_date === week.max_date) return week.min_date ?? "—"
  return `${week.min_date} – ${week.max_date}`
}

function verdictClass(tone: UpdateChannelResponse["verdict_tone"]): string {
  if (tone === "bad") return "border-red-300 bg-red-50 text-red-600"
  if (tone === "warn") return "border-amber-300 bg-amber-50 text-amber-700"
  return "border-emerald-300 bg-emerald-50 text-emerald-700"
}

function policyOption(block: UpdateCoverageBlock): Record<string, unknown> {
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (items: Array<{ dataIndex: number }>) => {
        const row = block.rows[items[0]?.dataIndex ?? 0]
        if (!row) return ""
        return `${row.label}<br/>${formatCount(row.count)} 只 · ${formatShare(row.share)}`
      },
    },
    grid: { left: 148, right: 28, top: 8, bottom: 28 },
    xAxis: {
      type: "value",
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: block.rows.map((row) => row.label),
      axisLabel: { fontSize: 11, color: "#52525b" },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 16,
        data: block.rows.map((row) => ({
          value: row.count,
          itemStyle: { color: POLICY_COLOR[row.key] ?? "#D93025" },
        })),
      },
    ],
  }
}

function fofHistoryOption(history: UpdateWeekStat[]): Record<string, unknown> {
  const weeks = history
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { top: 0, left: 0, textStyle: { fontSize: 11, color: "#52525b" }, itemWidth: 10, itemHeight: 10 },
    grid: { left: 48, right: 16, top: 36, bottom: 28 },
    xAxis: {
      type: "category",
      data: weeks.map((row) => row.label),
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
    },
    yAxis: {
      type: "value",
      name: "产品数",
      nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
    },
    series: [
      { name: "拿到净值", type: "bar", stack: "friday", data: weeks.map((row) => row.ok_products), itemStyle: { color: "#16a34a" }, barMaxWidth: 22 },
      { name: "仅空返回", type: "bar", stack: "friday", data: weeks.map((row) => row.empty_products), itemStyle: { color: "#f59e0b" }, barMaxWidth: 22 },
      { name: "失败", type: "bar", stack: "friday", data: weeks.map((row) => row.error_products), itemStyle: { color: "#dc2626" }, barMaxWidth: 22 },
    ],
  }
}

function emailHistoryOption(history: UpdateWeekStat[]): Record<string, unknown> {
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: { trigger: "axis" },
    legend: { top: 0, left: 0, textStyle: { fontSize: 11, color: "#52525b" }, itemWidth: 10, itemHeight: 10 },
    grid: { left: 48, right: 56, top: 36, bottom: 28 },
    xAxis: {
      type: "category",
      data: history.map((row) => row.label),
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
    },
    yAxis: [
      {
        type: "value",
        name: "产品",
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: { fontSize: 11, color: "#a1a1aa" },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
      },
      {
        type: "value",
        name: "邮件",
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: { fontSize: 11, color: "#a1a1aa" },
        splitLine: { show: false },
      },
    ],
    series: [
      { name: "写入产品", type: "bar", data: history.map((row) => row.products), itemStyle: { color: "#D93025" }, barMaxWidth: 16 },
      { name: "跟踪池更新", type: "bar", data: history.map((row) => row.pool_products), itemStyle: { color: "#1A73E8" }, barMaxWidth: 16 },
      {
        name: "邮件数",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        symbol: "none",
        data: history.map((row) => row.emails),
        lineStyle: { width: 2, color: "#FBBC04" },
        itemStyle: { color: "#FBBC04" },
      },
    ],
  }
}

function countShare(count: number, total: number): number {
  if (total <= 0) return 0
  return count / total
}

const RECENT_LIST_PAGE_SIZE = 100

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, "\"\"")}"`
  return value
}

function downloadRecentList(body: Fof99RecentListResponse, rows: Fof99RecentListResponse["products"]) {
  const headers = ["产品", "备案号", "名单净值日", "名单净值", "跟踪池"]
  const lines = rows.map((row) => [
    row.name,
    row.code,
    row.price_date,
    row.price_nav ?? "",
    row.in_pool ? "在" : "不在",
  ].map(csvCell).join(","))
  const blob = new Blob(
    ["\uFEFF" + [headers.join(","), ...lines].join("\n")],
    { type: "text/csv;charset=utf-8;" },
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `近一月名单_${body.label}_${body.measured_on}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function RecentListProductsDialog({
  policy,
  onClose,
}: {
  policy: Fof99RecentListPolicy
  onClose: () => void
}) {
  const [body, setBody] = useState<Fof99RecentListResponse | null>(null)
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
    const params = new URLSearchParams({ policy })
    fetch(`/ma/api/ops/data-overview/update/recent-list-products?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (seq !== requestSeq.current) return
        if (!res.ok || !json || !Array.isArray(json.products)) {
          throw new Error(typeof json?.message === "string" ? json.message : "产品列表加载失败")
        }
        setBody(json as Fof99RecentListResponse)
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return
        setError(err instanceof Error ? err.message : "产品列表加载失败")
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
      })
  }, [policy])

  const filtered = useMemo(() => {
    const rows = body?.products ?? []
    const q = keyword.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => row.name.toLowerCase().includes(q) || row.code.toLowerCase().includes(q))
  }, [body, keyword])

  const pageCount = Math.max(1, Math.ceil(filtered.length / RECENT_LIST_PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visibleRows = filtered.slice(safePage * RECENT_LIST_PAGE_SIZE, (safePage + 1) * RECENT_LIST_PAGE_SIZE)
  const title = body ? `近一月名单 · ${body.label}` : "近一月名单"

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {body
              ? `${formatCnMonthDay(body.measured_on)}火富牛名单里，净值日在 ${formatCnMonthDay(body.cutoff)} 及以后、跟踪方式为${body.label}的产品。`
              : "正在列出这一档的产品。"}
            点备案号打开产品页。
            {body ? ` 共 ${formatCount(body.total)} 只。` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <input
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value)
              setPage(0)
            }}
            placeholder="搜索产品或备案号"
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus:border-red-300"
          />
          <button
            type="button"
            disabled={!body || loading || filtered.length === 0}
            onClick={() => { if (body) downloadRecentList(body, filtered) }}
            className="h-8 shrink-0 rounded-md border px-2.5 text-xs text-zinc-600 hover:border-red-300 hover:text-red-600 disabled:opacity-40"
          >
            下载
          </button>
        </div>
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
                    <th className="px-2 py-1.5 text-left font-medium">名单净值日</th>
                    <th className="px-2 py-1.5 text-right font-medium">名单净值</th>
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
                  ) : visibleRows.map((row) => (
                    <tr key={row.code} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-200 max-w-[280px] truncate" title={row.name}>
                        {row.name || "—"}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        <a
                          href={`/ma/dashboard/private-funds/${encodeURIComponent(row.code)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-red-600 hover:underline tabular-nums"
                        >
                          {row.code}
                        </a>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-300">{row.price_date}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-300">{row.price_nav || "—"}</td>
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
                  : `${formatCount(safePage * RECENT_LIST_PAGE_SIZE + 1)}–${formatCount(Math.min(filtered.length, (safePage + 1) * RECENT_LIST_PAGE_SIZE))} / ${formatCount(filtered.length)} 只`}
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

function ListCoverageSection({ coverage }: { coverage: Fof99ListCoverage }) {
  const [policy, setPolicy] = useState<Fof99RecentListPolicy | null>(null)
  const active = coverage.recent_rows
    .filter((row) => row.key === "weekly" || row.key === "weekly_plus")
    .reduce((sum, row) => sum + row.count, 0)
  const inUniverse = coverage.recent_rows
    .filter((row) => row.key !== "none")
    .reduce((sum, row) => sum + row.count, 0)
  const cards = [
    { label: "正常运作私募证券", value: coverage.operating_total, share: 1 },
    { label: "名单有净值日期", value: coverage.with_nav, share: countShare(coverage.with_nav, coverage.operating_total) },
    { label: "近一月有净值", value: coverage.recent, share: countShare(coverage.recent, coverage.operating_total) },
    { label: "净值更早", value: coverage.older_nav, share: countShare(coverage.older_nav, coverage.operating_total) },
    { label: "名单无净值", value: coverage.no_nav, share: countShare(coverage.no_nav, coverage.operating_total) },
  ]
  const openPolicy = (key: string, count: number) => {
    const parsed = parseFof99RecentListPolicy(key)
    if (parsed && count > 0) setPolicy(parsed)
  }
  return (
    <section className="mt-3 rounded-xl border bg-background shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b">
        <h3 className="text-xs font-semibold text-foreground">
          火富牛名单覆盖
          <span className="ml-2 font-normal text-zinc-400">
            近一月在跟 {formatCount(active)} / {formatCount(coverage.recent)}
          </span>
        </h3>
        <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">
          {formatCnMonthDay(coverage.measured_on)}读取火富牛名单，平台策略、私募证券、正常运作。近一月指名单净值日在 {formatCnMonthDay(coverage.cutoff)} 及以后，这一档和跟踪方式是 {formatCnMonthDay(coverage.recent_measured_on)}按同一条件读的。这 {formatCount(coverage.recent)} 只里，跟踪里有 {formatCount(inUniverse)} 只，其中每周拉取和邮件优先合计 {formatCount(active)} 只。点跟踪方式查看产品。全部运作状态的私募证券 {formatCount(coverage.private_securities_all_states)} 只，全部产品类型 {formatCount(coverage.all_products)} 只。刷新这一页不会再调用接口。
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 px-4 py-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border px-3 py-2">
            <div className="text-[11px] text-zinc-400">{card.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatCount(card.value)}</div>
            <div className="text-[11px] tabular-nums text-zinc-400">{formatShare(card.share)}</div>
          </div>
        ))}
      </div>
      <table className="w-full text-xs border-t border-zinc-100 dark:border-zinc-800">
        <thead>
          <tr className="text-zinc-400">
            <th className="px-4 py-1.5 text-left font-medium">净值更早</th>
            <th className="px-3 py-1.5 text-right font-medium w-24">产品数</th>
            <th className="px-4 py-1.5 text-right font-medium w-20">占净值更早</th>
          </tr>
        </thead>
        <tbody>
          {coverage.older_rows.map((row) => (
            <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200">{row.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.count)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-zinc-500">{formatShare(countShare(row.count, coverage.older_nav))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-1.5 text-[11px] leading-4 text-zinc-400">
        1–2 个月是 8月16日至 9月15日，2–3 个月是 7月16日至 8月15日，3–6 个月是 4月16日至 7月15日，6 个月以上是 4月16日之前。1–2 个月比 10月16日少 14 只，近一月在 10月19日多了这 14 只。
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-zinc-400">
            <th className="px-4 py-1.5 text-left font-medium">近一月名单里的跟踪方式</th>
            <th className="px-3 py-1.5 text-right font-medium w-24">产品数</th>
            <th className="px-4 py-1.5 text-right font-medium w-16">占近一月</th>
          </tr>
        </thead>
        <tbody>
          {coverage.recent_rows.map((row) => {
            const canOpen = parseFof99RecentListPolicy(row.key) != null && row.count > 0
            return (
              <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200">
                  {canOpen ? (
                    <button
                      type="button"
                      onClick={() => openPolicy(row.key, row.count)}
                      className="hover:text-red-600 hover:underline"
                    >
                      {row.label}
                    </button>
                  ) : row.label}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {canOpen ? (
                    <button
                      type="button"
                      onClick={() => openPolicy(row.key, row.count)}
                      className="tabular-nums text-red-600 hover:underline"
                    >
                      {formatCount(row.count)}
                    </button>
                  ) : (
                    <span className="tabular-nums">{formatCount(row.count)}</span>
                  )}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums text-zinc-500">{formatShare(countShare(row.count, coverage.recent))}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {policy && (
        <RecentListProductsDialog policy={policy} onClose={() => setPolicy(null)} />
      )}
    </section>
  )
}

function UniverseMovesSection({ moves }: { moves: UniverseMoves }) {
  return (
    <section className="mt-3 rounded-xl border bg-background shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b">
        <h3 className="text-xs font-semibold text-foreground">
          每周跟踪进出
          <span className="ml-2 font-normal text-zinc-400">
            新增 {formatCount(moves.added)} · 改为更新偏慢 {formatCount(moves.moved_slow)}
          </span>
        </h3>
        <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">
          周五任务结束后，成立两个月以内、火富牛已有净值、还不在跟踪里的产品会加为每周拉取。连续三个交易周五都是空返回的，从每周拉取改为更新偏慢，产品仍留在跟踪里。新增的 {formatCount(moves.added)} 只里，目前仍是每周拉取的有 {formatCount(moves.added_still_weekly)} 只。改为更新偏慢的 {formatCount(moves.moved_slow)} 只里，目前仍是更新偏慢的有 {formatCount(moves.moved_still_slow)} 只。
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[520px]">
          <thead>
            <tr className="text-zinc-400">
              <th className="px-4 py-1.5 text-left font-medium">运行日</th>
              <th className="px-3 py-1.5 text-right font-medium">新增</th>
              <th className="px-3 py-1.5 text-right font-medium">改为更新偏慢</th>
              <th className="px-4 py-1.5 text-left font-medium">连续空的周五</th>
            </tr>
          </thead>
          <tbody>
            {moves.runs.length === 0 ? (
              <tr className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-3 text-zinc-400" colSpan={4}>还没有每周维护的纳入或改偏慢记录。</td>
              </tr>
            ) : moves.runs.map((row) => (
              <tr key={row.ran_on} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200 whitespace-nowrap">{formatCnMonthDay(row.ran_on)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.added)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.moved_slow)}</td>
                <td className="px-4 py-1.5 text-zinc-500">{row.empty_fridays || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const SOURCE_COLOR: Record<string, string> = {
  src_email_only: "#1A73E8",
  src_email_fof99: "#D93025",
  src_email_manual: "#FBBC04",
  src_fof99_only: "#D93025",
  src_fof99_email: "#1A73E8",
  src_fof99_manual: "#FBBC04",
  src_all_three: "#16a34a",
  src_other: "#a1a1aa",
  src_none: "#d4d4d8",
}

const FRESH_COLOR: Record<string, string> = {
  fresh_w1: "#16a34a",
  fresh_w1_2: "#65a30d",
  fresh_w2_3: "#ca8a04",
  fresh_w3_4: "#d97706",
  fresh_m1_2: "#ea580c",
  fresh_m2_3: "#dc2626",
  fresh_m3_6: "#b91c1c",
  fresh_over_m6: "#7f1d1d",
  fresh_none: "#a1a1aa",
}

function countOption(rows: UpdateCoverageRow[], colors: Record<string, string>): Record<string, unknown> {
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (items: Array<{ dataIndex: number }>) => {
        const row = rows[items[0]?.dataIndex ?? 0]
        if (!row) return ""
        return `${row.label}<br/>${formatCount(row.count)} 只 · ${formatShare(row.share)}`
      },
    },
    grid: { left: 148, right: 28, top: 8, bottom: 28 },
    xAxis: {
      type: "value",
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((row) => row.label),
      axisLabel: { fontSize: 11, color: "#52525b" },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 16,
        data: rows.map((row) => ({
          value: row.count,
          itemStyle: { color: colors[row.key] ?? "#D93025" },
        })),
      },
    ],
  }
}

const STALE_CHANNEL_LABEL: Record<EmailStaleProduct["channel"], string> = {
  email: "邮箱",
  manual: "手动",
  fof99: "fof99",
  none: "无",
}

const STALE_POLICY_LABEL: Record<string, string> = {
  weekly: "每周拉取",
  weekly_plus: "邮件优先",
  update_slow: "更新偏慢",
  skip: "确认无序列",
  none: "未纳入",
}

function staleSources(row: EmailStaleProduct): string {
  const parts = [
    row.has_email ? "邮箱" : "",
    row.has_fof99 ? "fof99" : "",
    row.has_manual ? "手动" : "",
  ].filter(Boolean)
  return parts.join(" + ") || "—"
}

function staleBucketLabel(latest: string | null, asOf: string): string {
  const key = emailFreshnessBucket(latest, asOf)
  if (key in EMAIL_STALE_LIST_LABEL) return EMAIL_STALE_LIST_LABEL[key as EmailStaleListKey]
  return "—"
}

function StaleProductsDialog({
  url,
  title,
  lead,
  onClose,
}: {
  url: string
  title: string
  lead: string
  onClose: () => void
}) {
  const [body, setBody] = useState<EmailStaleListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const requestSeq = useRef(0)

  useEffect(() => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError("")
    setBody(null)
    fetch(url)
      .then(async (res) => {
        const json = await res.json()
        if (seq !== requestSeq.current) return
        if (!res.ok || !json || !Array.isArray(json.products)) {
          throw new Error(typeof json?.message === "string" ? json.message : "产品列表加载失败")
        }
        setBody(json as EmailStaleListResponse)
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return
        setError(err instanceof Error ? err.message : "产品列表加载失败")
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
      })
  }, [url])

  const truncated = body != null && body.products.length < body.total
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {lead}
            点备案号打开产品页。
            {body ? ` 共 ${formatCount(body.total)} 只，统计日 ${body.as_of}。` : ""}
            {truncated && body ? ` 这里列出最旧的 ${formatCount(body.products.length)} 只。` : ""}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
        )}
        {loading && (
          <div className="py-8 text-center text-sm text-muted-foreground">正在列出产品…</div>
        )}
        {body && !loading && (
          <div className="overflow-auto min-h-0">
            <table className="w-full text-xs min-w-[760px]">
              <thead className="sticky top-0 bg-background">
                <tr className="text-zinc-400">
                  <th className="px-2 py-1.5 text-left font-medium">产品</th>
                  <th className="px-2 py-1.5 text-left font-medium">备案号</th>
                  <th className="px-2 py-1.5 text-left font-medium">最新净值日</th>
                  <th className="px-2 py-1.5 text-right font-medium">落后</th>
                  <th className="px-2 py-1.5 text-left font-medium">来源</th>
                  <th className="px-2 py-1.5 text-left font-medium">当前渠道</th>
                  <th className="px-2 py-1.5 text-left font-medium">火富牛</th>
                  <th className="px-2 py-1.5 text-left font-medium">跟踪池</th>
                </tr>
              </thead>
              <tbody>
                {body.products.length === 0 ? (
                  <tr className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-2 py-3 text-zinc-400" colSpan={8}>这一档没有产品。</td>
                  </tr>
                ) : body.products.map((row) => (
                  <tr key={row.code} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-2 py-1.5 text-zinc-700 dark:text-zinc-200 max-w-[220px] truncate" title={row.name || row.code}>
                      {row.name || "—"}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <a
                        href={`/ma/dashboard/private-funds/${encodeURIComponent(row.code)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-red-600 hover:underline tabular-nums"
                      >
                        {row.code}
                      </a>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-300">{row.latest || "—"}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-300">
                      {row.lag_days == null ? "—" : `${formatCount(row.lag_days)}天`}
                      <span className="ml-1 text-zinc-400">{staleBucketLabel(row.latest, body.as_of)}</span>
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{staleSources(row)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{STALE_CHANNEL_LABEL[row.channel]}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{STALE_POLICY_LABEL[row.policy] ?? row.policy}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap text-zinc-600 dark:text-zinc-300">{row.in_pool ? "在" : "不在"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CountTable({
  rows,
  statusLabel,
  onCount,
}: {
  rows: UpdateCoverageRow[]
  statusLabel: string
  onCount?: (row: UpdateCoverageRow) => void
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-zinc-400">
          <th className="px-4 py-1.5 text-left font-medium">{statusLabel}</th>
          <th className="px-3 py-1.5 text-right font-medium w-24">产品数</th>
          <th className="px-4 py-1.5 text-right font-medium w-16">占比</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const width = Math.max(0, Math.min(100, row.share * 100))
          return (
            <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800" title={row.hint}>
              <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200">{row.label}</td>
              <td className="px-3 py-1.5 text-right">
                <div className="relative ml-auto inline-flex min-w-[4.5rem] justify-end">
                  <span
                    className="absolute inset-y-0 right-0 rounded-sm bg-red-100/80 dark:bg-red-950/40"
                    style={{ width: `${width}%` }}
                  />
                  {onCount && row.count > 0 && emailFreshnessListKey(row.key) ? (
                    <button
                      type="button"
                      onClick={() => onCount(row)}
                      className="relative z-[1] tabular-nums text-red-600 hover:underline"
                    >
                      {formatCount(row.count)}
                    </button>
                  ) : (
                    <span className="relative z-[1] tabular-nums">{formatCount(row.count)}</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums text-zinc-500">{formatShare(row.share)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function BridgeMark({ on }: { on: boolean }) {
  if (!on) return <span className="text-zinc-300">—</span>
  return <span className="text-red-600">计入</span>
}

function EmailCountBridgeSection({ bridge }: { bridge: EmailCountBridge }) {
  const cards = [
    { label: "曾经写入", value: bridge.ever, note: "邮件净值里出现过的备案号" },
    { label: "上周写入", value: bridge.lastWeek, note: "其中上周有新行的" },
    { label: "全库·邮箱抓取", value: bridge.libraryEmail, note: "基金库里最新渠道是邮箱" },
    { label: "团队数据·邮箱抓取", value: bridge.teamEmail, note: "团队列表的更新方式" },
  ]
  return (
    <section className="mt-3 rounded-xl border bg-background shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b">
        <h3 className="text-xs font-semibold text-foreground">这几个邮箱数字为什么不一样</h3>
        <p className="mt-1 text-[11px] leading-4 text-zinc-500">
          曾经写入是邮件净值表里出现过的备案号。上周写入是其中上周有新行的，所以更少。全库只统计私募基金库里、最新一条来自邮箱的产品。团队数据按列表的更新方式计，没有更新的手动或 fof99 时也会标成邮箱抓取。下面每一行不重复，四列加总分别等于这四个数。
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border px-3 py-2">
            <div className="text-[11px] text-zinc-400">{card.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatCount(card.value)}</div>
            <div className="mt-0.5 text-[11px] text-zinc-400">{card.note}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-400">
              <th className="px-4 py-1.5 text-left font-medium">这批产品</th>
              <th className="px-3 py-1.5 text-right font-medium w-16">只数</th>
              <th className="px-3 py-1.5 text-center font-medium w-20">曾经写入</th>
              <th className="px-3 py-1.5 text-center font-medium w-20">上周写入</th>
              <th className="px-3 py-1.5 text-center font-medium w-24">全库邮箱</th>
              <th className="px-3 py-1.5 text-center font-medium w-24">团队邮箱</th>
            </tr>
          </thead>
          <tbody>
            {bridge.rows.map((row) => (
              <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800" title={row.hint}>
                <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200">{row.label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.count)}</td>
                <td className="px-3 py-1.5 text-center"><BridgeMark on={row.ever} /></td>
                <td className="px-3 py-1.5 text-center"><BridgeMark on={row.lastWeek} /></td>
                <td className="px-3 py-1.5 text-center"><BridgeMark on={row.libraryEmail} /></td>
                <td className="px-3 py-1.5 text-center"><BridgeMark on={row.teamEmail} /></td>
              </tr>
            ))}
            <tr className="border-t border-zinc-200 dark:border-zinc-700 font-medium">
              <td className="px-4 py-1.5 text-foreground">合计</td>
              <td className="px-3 py-1.5" />
              <td className="px-3 py-1.5 text-center tabular-nums">{formatCount(bridge.ever)}</td>
              <td className="px-3 py-1.5 text-center tabular-nums">{formatCount(bridge.lastWeek)}</td>
              <td className="px-3 py-1.5 text-center tabular-nums">{formatCount(bridge.libraryEmail)}</td>
              <td className="px-3 py-1.5 text-center tabular-nums">{formatCount(bridge.teamEmail)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function EmailProductStatusSection({ status }: { status: EmailProductStatus }) {
  const [cohort, setCohort] = useState<EmailCohortKey>("ever")
  const [staleList, setStaleList] = useState<EmailStaleListKey | null>(null)
  const body: EmailCohortStatus = status[cohort]
  const withinWeek = body.freshness.find((row) => row.key === "fresh_w1")?.count ?? 0
  const behindTwoWeeks = body.freshness.reduce((sum, row) => (
    emailFreshnessListKey(row.key) ? sum + row.count : sum
  ), 0)
  const cards = [
    { label: "产品数", value: body.total },
    { label: "在跟踪池", value: body.in_pool },
    { label: "也有 fof99", value: body.with_fof99 },
    { label: "也有手动", value: body.with_manual },
    { label: "多个来源", value: body.multi_source },
  ]
  return (
    <section className="mt-3 rounded-xl border bg-background shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h3 className="text-xs font-semibold text-foreground">邮箱产品现在怎么更新</h3>
          <div className="flex items-center gap-1">
            {EMAIL_COHORTS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setCohort(item.key)}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium transition-colors",
                  cohort === item.key
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                    : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                ].join(" ")}
              >
                {item.label}
                <span className="ml-1 tabular-nums">{formatCount(status[item.key].total)}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-zinc-500">
          曾经写入是历史上邮件里出现过备案号的产品。上周写入就是上面那 {formatCount(status.last_week.total)} 只。看它们现在还有没有火富牛或手动净值，以及最新净值日落在哪一档。最新净值日取邮箱、手动、火富牛成功抓取和产品页日期里最晚的一天。主基金、A/B/C 份额，以及名称相同的其他备案号，算同一只产品，用其中最晚的一天判断是否滞后；任一备案号已更新，整只产品就不进滞后档。当前渠道只比较这一行备案号自己的前三个来源，同一天优先手动，其次邮箱。
          这 {formatCount(body.total)} 只里，同时还有其他来源的 {formatCount(body.multi_source)} 只，最新净值在 1 周以内的 {formatCount(withinWeek)} 只。
          {behindTwoWeeks > 0 && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => setStaleList("behind_2w")}
                className="text-red-600 hover:underline"
              >
                滞后超过2周 {formatCount(behindTwoWeeks)} 只
              </button>
              ，点开可看是哪些产品。2–3周及更早的数字同样可以点开。
            </>
          )}
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 px-4 py-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border px-3 py-2">
            <div className="text-[11px] text-zinc-400">{card.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatCount(card.value)}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 px-4 pb-4">
        <div className="rounded-lg border overflow-hidden">
          <div className="px-4 py-2 border-b">
            <h4 className="text-xs font-semibold text-foreground">数据来源</h4>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">一只产品可以同时有邮箱、火富牛接口和手动净值。这里按组合分开，加总等于产品数。</p>
          </div>
          <ReactECharts key={`${cohort}-sources`} option={countOption(body.sources, SOURCE_COLOR)} style={{ height: Math.max(180, body.sources.length * 32 + 36) }} notMerge lazyUpdate />
          <CountTable rows={body.sources} statusLabel="来源" />
        </div>
        <div className="rounded-lg border overflow-hidden">
          <div className="px-4 py-2 border-b">
            <h4 className="text-xs font-semibold text-foreground">最新净值日期</h4>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">1周以内是 7 天内，其后每 7 天一档，满 4 周后按 1–2 个月、2–3 个月、3–6 个月、6 个月以上。红色数字是滞后超过2周的产品，点开查看名单。</p>
          </div>
          <ReactECharts
            key={`${cohort}-fresh`}
            option={countOption(body.freshness, FRESH_COLOR)}
            style={{ height: Math.max(220, body.freshness.length * 28 + 36) }}
            notMerge
            lazyUpdate
            onEvents={{
              click: (params: { dataIndex?: number }) => {
                const row = body.freshness[params.dataIndex ?? -1]
                const key = row ? emailFreshnessListKey(row.key) : null
                if (key && row.count > 0) setStaleList(key)
              },
            }}
          />
          <CountTable
            rows={body.freshness}
            statusLabel="距今"
            onCount={(row) => {
              const key = emailFreshnessListKey(row.key)
              if (key) setStaleList(key)
            }}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 px-4 pb-4">
        <div className="rounded-lg border overflow-hidden">
          <div className="px-4 py-2 border-b">
            <h4 className="text-xs font-semibold text-foreground">当前最新渠道</h4>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">三个来源里谁的净值日最晚。产品页更晚的日期不改变这一列。</p>
          </div>
          <CountTable rows={body.channel} statusLabel="渠道" />
        </div>
        <div className="rounded-lg border overflow-hidden">
          <div className="px-4 py-2 border-b">
            <h4 className="text-xs font-semibold text-foreground">火富牛跟踪方式</h4>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">这些产品现在在火富牛跟踪里的方式。未纳入表示还没有放进火富牛。</p>
          </div>
          <CountTable rows={body.policy} statusLabel="跟踪方式" />
        </div>
      </div>
      {staleList && (
        <StaleProductsDialog
          url={`/ma/api/ops/data-overview/update/email-products?${new URLSearchParams({ cohort, freshness: staleList })}`}
          title={`${EMAIL_COHORTS.find((item) => item.key === cohort)?.label ?? ""} · ${EMAIL_STALE_LIST_LABEL[staleList]}`}
          lead={staleList === "behind_2w"
            ? "最新净值日距今超过 14 天的邮箱产品。"
            : `最新净值日落在${EMAIL_STALE_LIST_LABEL[staleList]}的邮箱产品。`}
          onClose={() => setStaleList(null)}
        />
      )}
    </section>
  )
}

function Fof99ProductStatusSection({ status }: { status: Fof99ProductStatus }) {
  const [cohort, setCohort] = useState<Fof99CohortKey>("fetching")
  const [staleList, setStaleList] = useState<EmailStaleListKey | null>(null)
  const body: Fof99CohortStatus = status[cohort]
  const withinWeek = body.freshness.find((row) => row.key === "fresh_w1")?.count ?? 0
  const behindTwoWeeks = body.freshness.reduce((sum, row) => (
    emailFreshnessListKey(row.key) ? sum + row.count : sum
  ), 0)
  const cards = [
    { label: "产品数", value: body.total },
    { label: "在跟踪池", value: body.in_pool },
    { label: "也有邮箱", value: body.with_email },
    { label: "也有手动", value: body.with_manual },
    { label: "多个来源", value: body.multi_source },
  ]
  return (
    <section className="mt-3 rounded-xl border bg-background shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <h3 className="text-xs font-semibold text-foreground">火富牛跟踪产品现在怎么更新</h3>
          <div className="flex items-center gap-1">
            {FOF99_COHORTS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setCohort(item.key)}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium transition-colors",
                  cohort === item.key
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                    : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                ].join(" ")}
              >
                {item.label}
                <span className="ml-1 tabular-nums">{formatCount(status[item.key].total)}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-zinc-500">
          接口在拉是每周拉取和邮件优先，周五会调火富牛接口；邮件优先只在列表落后时才拉。全部跟踪再算上更新偏慢和确认无序列。上周拿到是其中上周有成功抓取的。看它们现在还有没有邮箱或手动净值，以及最新净值日落在哪一档。最新净值日取火富牛成功抓取、邮箱、手动和产品页日期里最晚的一天。主基金、A/B/C 份额，以及名称相同的其他备案号，算同一只产品，用其中最晚的一天判断是否滞后；任一备案号已更新，整只产品就不进滞后档。当前渠道只比较这一行备案号自己的前三个来源，同一天优先手动，其次邮箱。
          这 {formatCount(body.total)} 只里，同时还有其他来源的 {formatCount(body.multi_source)} 只，最新净值在 1 周以内的 {formatCount(withinWeek)} 只。
          {behindTwoWeeks > 0 && (
            <>
              {" "}
              <button
                type="button"
                onClick={() => setStaleList("behind_2w")}
                className="text-red-600 hover:underline"
              >
                滞后超过2周 {formatCount(behindTwoWeeks)} 只
              </button>
              ，点开可看是哪些产品。2–3周及更早的数字同样可以点开。
            </>
          )}
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 px-4 py-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border px-3 py-2">
            <div className="text-[11px] text-zinc-400">{card.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatCount(card.value)}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 px-4 pb-4">
        <div className="rounded-lg border overflow-hidden">
          <div className="px-4 py-2 border-b">
            <h4 className="text-xs font-semibold text-foreground">数据来源</h4>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">一只产品可以同时有火富牛接口、邮箱和手动净值。这里按组合分开，加总等于产品数。</p>
          </div>
          <ReactECharts key={`${cohort}-sources`} option={countOption(body.sources, SOURCE_COLOR)} style={{ height: Math.max(180, body.sources.length * 32 + 36) }} notMerge lazyUpdate />
          <CountTable rows={body.sources} statusLabel="来源" />
        </div>
        <div className="rounded-lg border overflow-hidden">
          <div className="px-4 py-2 border-b">
            <h4 className="text-xs font-semibold text-foreground">最新净值日期</h4>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">1周以内是 7 天内，其后每 7 天一档，满 4 周后按 1–2 个月、2–3 个月、3–6 个月、6 个月以上。红色数字是滞后超过2周的产品，点开查看名单。</p>
          </div>
          <ReactECharts
            key={`${cohort}-fresh`}
            option={countOption(body.freshness, FRESH_COLOR)}
            style={{ height: Math.max(220, body.freshness.length * 28 + 36) }}
            notMerge
            lazyUpdate
            onEvents={{
              click: (params: { dataIndex?: number }) => {
                const row = body.freshness[params.dataIndex ?? -1]
                const key = row ? emailFreshnessListKey(row.key) : null
                if (key && row.count > 0) setStaleList(key)
              },
            }}
          />
          <CountTable
            rows={body.freshness}
            statusLabel="距今"
            onCount={(row) => {
              const key = emailFreshnessListKey(row.key)
              if (key) setStaleList(key)
            }}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 px-4 pb-4">
        <div className="rounded-lg border overflow-hidden">
          <div className="px-4 py-2 border-b">
            <h4 className="text-xs font-semibold text-foreground">当前最新渠道</h4>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">三个来源里谁的净值日最晚。产品页更晚的日期不改变这一列。</p>
          </div>
          <CountTable rows={body.channel} statusLabel="渠道" />
        </div>
        <div className="rounded-lg border overflow-hidden">
          <div className="px-4 py-2 border-b">
            <h4 className="text-xs font-semibold text-foreground">跟踪方式</h4>
            <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">这些产品在火富牛跟踪里的方式。接口在拉只含每周拉取和邮件优先。</p>
          </div>
          <CountTable rows={body.policy} statusLabel="跟踪方式" />
        </div>
      </div>
      {staleList && (
        <StaleProductsDialog
          url={`/ma/api/ops/data-overview/update/fof99-products?${new URLSearchParams({ cohort, freshness: staleList })}`}
          title={`${FOF99_COHORTS.find((item) => item.key === cohort)?.label ?? ""} · ${EMAIL_STALE_LIST_LABEL[staleList]}`}
          lead={staleList === "behind_2w"
            ? "最新净值日距今超过 14 天的火富牛跟踪产品。"
            : `最新净值日落在${EMAIL_STALE_LIST_LABEL[staleList]}的火富牛跟踪产品。`}
          onClose={() => setStaleList(null)}
        />
      )}
    </section>
  )
}

function CoverageTable({ block, statusLabel }: { block: UpdateCoverageBlock; statusLabel: string }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-zinc-400">
          <th className="px-4 py-1.5 text-left font-medium">{statusLabel}</th>
          <th className="px-3 py-1.5 text-right font-medium w-24">产品数</th>
          <th className="px-4 py-1.5 text-right font-medium w-16">占比</th>
        </tr>
      </thead>
      <tbody>
        {block.rows.map((row) => {
          const width = Math.max(0, Math.min(100, row.share * 100))
          return (
            <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800" title={row.hint}>
              <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200">{row.label}</td>
              <td className="px-3 py-1.5 text-right">
                <div className="relative ml-auto inline-flex min-w-[4.5rem] justify-end">
                  <span
                    className="absolute inset-y-0 right-0 rounded-sm bg-red-100/80 dark:bg-red-950/40"
                    style={{ width: `${width}%` }}
                  />
                  <span className="relative z-[1] tabular-nums">{formatCount(row.count)}</span>
                </div>
              </td>
              <td className="px-4 py-1.5 text-right tabular-nums text-zinc-500">{formatShare(row.share)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function OperationsUpdateChannelView({
  channel,
  refreshTick,
  onLoading,
}: {
  channel: UpdateChannel
  refreshTick: number
  onLoading?: (loading: boolean) => void
}) {
  const [body, setBody] = useState<UpdateChannelResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const requestSeq = useRef(0)

  const cacheKey = channelCacheKey(channel)
  const load = useCallback((refresh: boolean) => {
    const seq = ++requestSeq.current
    const cached = refresh ? null : peekOpsCache<UpdateChannelResponse>(cacheKey)
    if (cached?.channel === channel) {
      setBody(cached)
      setLoading(false)
    } else {
      setLoading(true)
    }
    setError("")
    const params = new URLSearchParams({ channel })
    if (refresh) params.set("refresh", "1")
    loadOpsCache(
      cacheKey,
      `/ma/api/ops/data-overview/update?${params}`,
      refresh,
      isChannelBody,
      "更新渠道加载失败",
    )
      .then((json) => {
        if (seq !== requestSeq.current) return
        setBody(json)
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return
        setError(err instanceof Error ? err.message : "更新渠道加载失败")
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
      })
  }, [cacheKey, channel])

  useEffect(() => {
    load(false)
  }, [load])

  useEffect(() => {
    if (refreshTick === 0) return
    load(true)
  }, [refreshTick, load])

  useEffect(() => {
    onLoading?.(loading)
  }, [loading, onLoading])

  const cachedChannel = peekOpsCache<UpdateChannelResponse>(cacheKey)
  const visible = body?.channel === channel ? body : cachedChannel?.channel === channel ? cachedChannel : null
  const isFof = channel === "fof99"
  const last = visible?.last_week
  const historyDesc = visible ? [...visible.history].reverse() : []

  const cards = last
    ? isFof
      ? [
          { label: "周五覆盖", value: formatCount(last.products) },
          { label: "拿到净值", value: formatCount(last.ok_products) },
          { label: "仅空返回", value: formatCount(last.empty_products) },
          { label: "失败", value: formatCount(last.error_products) },
          { label: "调用批次", value: formatCount(last.batches) },
          { label: "补历史", value: formatCount(last.backfill_products) },
        ]
      : [
          { label: "写入条数", value: formatCount(last.records) },
          { label: "产品数", value: formatCount(last.products) },
          { label: "邮件数", value: formatCount(last.emails) },
          { label: "跟踪池更新", value: formatCount(last.pool_products) },
          { label: "无净值行", value: formatCount(last.null_nav) },
        ]
    : []

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
          {error}
        </div>
      )}

      {loading && !visible && (
        <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
          正在统计更新渠道…
        </div>
      )}

      {visible && last && (
        <div className={loading ? "opacity-60" : ""}>
          <section className="rounded-xl border bg-background shadow-sm px-4 py-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-semibold text-foreground">上周接口情况</h3>
                  <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${verdictClass(visible.verdict_tone)}`}>
                    {visible.verdict}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-zinc-600 dark:text-zinc-300 max-w-4xl">{visible.headline}</p>
              </div>
              <span className="text-[11px] text-zinc-400 shrink-0">
                统计时间 {formatGeneratedAt(visible.generated_at)}
              </span>
            </div>
            <div className={`mt-3 grid gap-2 ${isFof ? "grid-cols-2 md:grid-cols-6" : "grid-cols-2 md:grid-cols-5"}`}>
              {cards.map((card) => (
                <div key={card.label} className="rounded-lg border px-3 py-2">
                  <div className="text-[11px] text-zinc-400">{card.label}</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{card.value}</div>
                </div>
              ))}
            </div>
          </section>

          {!isFof && visible.email_count_bridge && <EmailCountBridgeSection bridge={visible.email_count_bridge} />}
          {!isFof && visible.email_products && <EmailProductStatusSection status={visible.email_products} />}
          {isFof && visible.fof99_products && <Fof99ProductStatusSection status={visible.fof99_products} />}
          {isFof && visible.list_coverage && <ListCoverageSection coverage={visible.list_coverage} />}
          {isFof && visible.universe_moves && <UniverseMovesSection moves={visible.universe_moves} />}

          <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
            {visible.coverage.map((block) => (
              <section key={block.key} className="rounded-xl border bg-background shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b">
                  <h3 className="text-xs font-semibold text-foreground">
                    {block.title}
                    <span className="ml-2 font-normal text-zinc-400">
                      {formatCount(block.subscribed)} / {formatCount(block.total)} 已{isFof ? "纳入" : "覆盖"}
                    </span>
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-4 text-zinc-500">{block.summary}</p>
                </div>
                <ReactECharts option={policyOption(block)} style={{ height: 220 }} notMerge lazyUpdate />
                <CoverageTable block={block} statusLabel={isFof ? "跟踪方式" : "覆盖"} />
              </section>
            ))}
          </div>

          <section className="mt-3 rounded-xl border bg-background shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b">
              <h3 className="text-xs font-semibold text-foreground">{isFof ? "各周火富牛抓取" : "各周邮箱写入"}</h3>
              <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">
                {isFof
                  ? "柱子是周五任务里的产品：拿到净值、只有空返回、或接口失败。某一周是空的，表示那周没跑周五任务，净值可能记在下一周。补历史的产品数在表里单独一列。"
                  : "按写入时间分周。产品按备案号去重，跟踪池更新是这周新邮件净值落在跟踪池里的只数。"}
              </p>
            </div>
            <ReactECharts
              option={isFof ? fofHistoryOption(visible.history) : emailHistoryOption(visible.history)}
              style={{ height: 280 }}
              notMerge
              lazyUpdate
            />
            <div className="overflow-x-auto">
              {isFof ? (
                <table className="w-full text-xs min-w-[920px]">
                  <thead>
                    <tr className="text-zinc-400">
                      <th className="px-4 py-1.5 text-left font-medium">周</th>
                      <th className="px-3 py-1.5 text-left font-medium">净值日</th>
                      <th className="px-3 py-1.5 text-right font-medium">覆盖</th>
                      <th className="px-3 py-1.5 text-right font-medium">拿到净值</th>
                      <th className="px-3 py-1.5 text-right font-medium">仅空返回</th>
                      <th className="px-3 py-1.5 text-right font-medium">失败</th>
                      <th className="px-3 py-1.5 text-right font-medium">成功率</th>
                      <th className="px-3 py-1.5 text-right font-medium">成功条数</th>
                      <th className="px-3 py-1.5 text-right font-medium">空返回条数</th>
                      <th className="px-3 py-1.5 text-right font-medium">调用批次</th>
                      <th className="px-4 py-1.5 text-right font-medium">补历史</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyDesc.map((row) => (
                      <tr key={row.week_start} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200 whitespace-nowrap">
                          {row.label}{row.in_progress ? " 进行中" : ""}
                        </td>
                        <td className="px-3 py-1.5 text-zinc-500 whitespace-nowrap">{dateSpan(row)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.products)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.ok_products)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.empty_products)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.error_products)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500">{rate(row.ok_products, row.products)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.ok_rows)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.empty_rows)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.batches)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{formatCount(row.backfill_products)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-zinc-400">
                      <th className="px-4 py-1.5 text-left font-medium">周</th>
                      <th className="px-3 py-1.5 text-right font-medium">写入条数</th>
                      <th className="px-3 py-1.5 text-right font-medium">产品数</th>
                      <th className="px-3 py-1.5 text-right font-medium">邮件数</th>
                      <th className="px-3 py-1.5 text-right font-medium">跟踪池更新</th>
                      <th className="px-4 py-1.5 text-right font-medium">无净值行</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyDesc.map((row) => (
                      <tr key={row.week_start} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200">
                          {row.label}{row.in_progress ? " 进行中" : ""}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.records)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.products)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.emails)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.pool_products)}</td>
                        <td className="px-4 py-1.5 text-right tabular-nums">{formatCount(row.null_nav)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
