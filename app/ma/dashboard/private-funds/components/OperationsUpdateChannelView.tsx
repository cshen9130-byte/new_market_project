"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import ReactECharts from "echarts-for-react"
import { formatCnMonthDay, type Fof99ListCoverage, type UniverseMoves, type UpdateChannel, type UpdateChannelResponse, type UpdateCoverageBlock, type UpdateWeekStat } from "@/lib/ops-update-channel"

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

function ListCoverageSection({ coverage }: { coverage: Fof99ListCoverage }) {
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
          {formatCnMonthDay(coverage.measured_on)}读取火富牛名单，平台策略、私募证券、正常运作。近一月指名单净值日在 {formatCnMonthDay(coverage.cutoff)} 及以后。这 {formatCount(coverage.recent)} 只里，跟踪里有 {formatCount(inUniverse)} 只，其中每周拉取和邮件优先合计 {formatCount(active)} 只。全部运作状态的私募证券 {formatCount(coverage.private_securities_all_states)} 只，全部产品类型 {formatCount(coverage.all_products)} 只。刷新这一页不会再调用接口。
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
        1–2 个月是 8月16日至 9月15日，2–3 个月是 7月16日至 8月15日，3–6 个月是 4月16日至 7月15日，6 个月以上是 4月16日之前。
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
          {coverage.recent_rows.map((row) => (
            <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="px-4 py-1.5 text-zinc-700 dark:text-zinc-200">{row.label}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatCount(row.count)}</td>
              <td className="px-4 py-1.5 text-right tabular-nums text-zinc-500">{formatShare(countShare(row.count, coverage.recent))}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

  const load = useCallback((refresh: boolean) => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError("")
    const params = new URLSearchParams({ channel })
    if (refresh) params.set("refresh", "1")
    fetch(`/ma/api/ops/data-overview/update?${params}`)
      .then(async (res) => {
        const json = await res.json()
        if (seq !== requestSeq.current) return
        if (!res.ok || !json || !Array.isArray(json.coverage)) {
          throw new Error(typeof json?.message === "string" ? json.message : "更新渠道加载失败")
        }
        setBody(json as UpdateChannelResponse)
      })
      .catch((err: unknown) => {
        if (seq !== requestSeq.current) return
        setError(err instanceof Error ? err.message : "更新渠道加载失败")
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
      })
  }, [channel])

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

  const visible = body?.channel === channel ? body : null
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
