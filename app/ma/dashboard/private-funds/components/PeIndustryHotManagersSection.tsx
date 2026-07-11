"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import ReactECharts from "echarts-for-react"
import { ArrowDown, ArrowUp, ChevronDown, Download } from "lucide-react"
import type {
  PeIndustryHotManagerRow,
  PeIndustryHotManagersData,
  PeIndustryStaffMetric,
} from "@/lib/pe-industry-data"

const TREND_COLORS = ["#D93025", "#1A73E8", "#FBBC04", "#9333ea", "#14b8a6", "#78716C", "#f97316", "#06b6d4", "#84cc16", "#6366f1"]
const PAGE_SIZE = 10

const METRIC_OPTIONS: { key: PeIndustryStaffMetric; label: string }[] = [
  { key: "full_time", label: "全职员工" },
  { key: "practitioner", label: "基金从业人员" },
]

function buildIndustryTrendOption(
  data: PeIndustryHotManagersData,
): Record<string, unknown> {
  const months = data.industryTrend.map((p) => p.month)
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      top: 0,
      left: 0,
      textStyle: { fontSize: 11, color: "#52525b" },
      itemWidth: 10,
      itemHeight: 10,
    },
    grid: { left: 56, right: 56, top: 40, bottom: 32 },
    xAxis: {
      type: "category",
      data: months,
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: "value",
        name: "总人数",
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: { fontSize: 11, color: "#a1a1aa" },
        splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
      },
      {
        type: "value",
        name: "人均",
        nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
        axisLabel: { fontSize: 11, color: "#a1a1aa" },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "员工总数",
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: "#D93025" },
        itemStyle: { color: "#D93025" },
        data: data.industryTrend.map((p) => p.totalStaff),
      },
      {
        name: "人均员工数",
        type: "line",
        smooth: true,
        symbol: "none",
        yAxisIndex: 1,
        lineStyle: { width: 2, color: "#1A73E8" },
        itemStyle: { color: "#1A73E8" },
        data: data.industryTrend.map((p) => p.avgStaff),
      },
    ],
  }
}

function buildHotManagersTrendOption(
  data: PeIndustryHotManagersData,
): Record<string, unknown> {
  const monthSet = new Set<string>()
  for (const series of data.managerSeries) {
    for (const point of series.points) monthSet.add(point.month)
  }
  const months = [...monthSet].sort()

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      type: "scroll",
      top: 0,
      left: 0,
      right: 16,
      textStyle: { fontSize: 11, color: "#52525b" },
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 12,
    },
    grid: { left: 48, right: 16, top: 48, bottom: 32 },
    xAxis: {
      type: "category",
      data: months,
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      name: "人数",
      nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
    },
    series: data.managerSeries.map((series, index) => {
      const byMonth = new Map(series.points.map((p) => [p.month, p.staff]))
      return {
        name: series.managerName,
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2 },
        itemStyle: { color: TREND_COLORS[index % TREND_COLORS.length] },
        data: months.map((month) => byMonth.get(month) ?? null),
      }
    }),
  }
}

function buildGrowthBarOption(rows: PeIndustryHotManagerRow[]): Record<string, unknown> {
  const top = rows
    .filter((row) => row.staffDelta != null && row.staffDelta > 0)
    .slice(0, 15)
    .reverse()

  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: Array<{ name: string; value: number }>) => {
        const item = params[0]
        return `${item.name}<br/>净增：${item.value} 人`
      },
    },
    grid: { left: 120, right: 24, top: 16, bottom: 24 },
    xAxis: {
      type: "value",
      name: "净增人数",
      nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
    },
    yAxis: {
      type: "category",
      data: top.map((row) => row.managerName),
      axisLabel: {
        fontSize: 11,
        color: "#52525b",
        width: 100,
        overflow: "truncate",
      },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        data: top.map((row) => row.staffDelta ?? 0),
        itemStyle: { color: "#D93025", borderRadius: [0, 3, 3, 0] },
        barMaxWidth: 18,
      },
    ],
  }
}

function pageButtons(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: Array<number | "…"> = [1]
  if (current > 3) pages.push("…")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p += 1) pages.push(p)
  if (current < total - 2) pages.push("…")
  pages.push(total)
  return pages
}

function exportHotManagersCsv(rows: PeIndustryHotManagerRow[], metricLabel: string) {
  const headers = ["序号", "管理人名称", "登记编号", "管理规模", "在管产品数", `当前${metricLabel}`, `上期${metricLabel}`, "净增", "增幅(%)"]
  const body = rows.map((row, index) => [
    String(index + 1),
    row.managerName,
    row.registrationNo,
    row.mgmtScale,
    row.activeFundCount != null ? String(row.activeFundCount) : "",
    String(row.staffCurrent),
    row.staffPrevious != null ? String(row.staffPrevious) : "",
    row.staffDelta != null ? String(row.staffDelta) : "",
    row.staffGrowthPct != null ? String(row.staffGrowthPct) : "",
  ])
  const escape = (v: string) => (v.includes(",") ? `"${v}"` : v)
  const blob = new Blob(
    ["\uFEFF" + [headers, ...body].map((r) => r.map(escape).join(",")).join("\n")],
    { type: "text/csv;charset=utf-8;" },
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "热门管理人.csv"
  a.click()
  URL.revokeObjectURL(url)
}

export function PeIndustryHotManagersSection() {
  const [page, setPage] = useState(1)
  const [metric, setMetric] = useState<PeIndustryStaffMetric>("full_time")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PeIndustryHotManagersData | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/ma/api/pe-industry/hot-managers?metric=${metric}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok || !body.ok) {
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        if (cancelled) return
        setData({
          updatedAt: body.updatedAt,
          metric: body.metric,
          industryTrend: body.industryTrend ?? [],
          hotManagers: body.hotManagers ?? [],
          managerSeries: body.managerSeries ?? [],
        })
        setPage(1)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败")
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [metric])

  const metricLabel = METRIC_OPTIONS.find((o) => o.key === metric)?.label ?? "员工"

  const industryTrendOption = useMemo(
    () => (data ? buildIndustryTrendOption(data) : null),
    [data],
  )
  const hotTrendOption = useMemo(
    () => (data ? buildHotManagersTrendOption(data) : null),
    [data],
  )
  const growthBarOption = useMemo(
    () => (data ? buildGrowthBarOption(data.hotManagers) : null),
    [data],
  )

  const rows = data?.hotManagers ?? []
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pagedRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-8 text-center text-sm text-zinc-400">
        正在加载热门管理人数据…
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-8 text-center text-sm text-zinc-400">
        {error ?? "暂无热门管理人数据（需 nightly ETL 积累 amac_manager_metrics_history）"}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
          热门管理人
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {data.updatedAt && <span>更新日期：{data.updatedAt}</span>}
          <div className="relative">
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as PeIndustryStaffMetric)}
              className="appearance-none h-7 pl-2.5 pr-7 rounded border border-zinc-200 bg-white text-xs text-zinc-600 cursor-pointer hover:bg-zinc-50"
            >
              {METRIC_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
          <div className="text-sm font-medium text-zinc-700 mb-3">私募证券类管理人{metricLabel}总数走势</div>
          {industryTrendOption && data.industryTrend.length > 0 ? (
            <ReactECharts option={industryTrendOption} style={{ height: 300, width: "100%" }} notMerge lazyUpdate />
          ) : (
            <div className="flex items-center justify-center h-[300px] text-sm text-zinc-400">暂无走势数据</div>
          )}
        </div>

        <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
          <div className="text-sm font-medium text-zinc-700 mb-3">员工净增 TOP 管理人</div>
          {growthBarOption && rows.some((r) => (r.staffDelta ?? 0) > 0) ? (
            <ReactECharts option={growthBarOption} style={{ height: 300, width: "100%" }} notMerge lazyUpdate />
          ) : (
            <div className="flex items-center justify-center h-[300px] text-sm text-zinc-400">暂无净增数据（需至少两个快照日期）</div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-4 py-4">
        <div className="text-sm font-medium text-zinc-700 mb-3">热门管理人{metricLabel}走势（TOP 10）</div>
        {hotTrendOption && data.managerSeries.length > 0 ? (
          <ReactECharts option={hotTrendOption} style={{ height: 340, width: "100%" }} notMerge lazyUpdate />
        ) : (
          <div className="flex items-center justify-center h-[340px] text-sm text-zinc-400">暂无管理人走势数据</div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100">
          <div className="text-sm font-medium text-zinc-700">热门管理人排行</div>
          <button
            type="button"
            onClick={() => exportHotManagersCsv(rows, metricLabel)}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-400">暂无管理人数据</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-50 text-zinc-500">
                    <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 w-12">序号</th>
                    <th className="px-3 py-2 text-left font-medium border-b border-zinc-100 min-w-[8rem]">管理人名称</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[6.5rem]">登记编号</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[7rem]">管理规模</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[5rem]">在管产品</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[5rem]">当前{metricLabel}</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[5rem]">上期{metricLabel}</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[5rem]">净增</th>
                    <th className="px-3 py-2 text-center font-medium border-b border-zinc-100 min-w-[5rem]">增幅</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row, index) => (
                    <tr key={row.registrationNo} className={index % 2 === 1 ? "bg-zinc-50/60" : "bg-white"}>
                      <td className="px-3 py-2 text-center tabular-nums text-zinc-500 border-b border-zinc-50">
                        {(page - 1) * PAGE_SIZE + index + 1}
                      </td>
                      <td className="px-3 py-2 text-left border-b border-zinc-50">
                        <Link
                          href={`/ma/dashboard/private-funds/managers/${encodeURIComponent(row.registrationNo)}`}
                          className="text-blue-600 hover:underline"
                        >
                          {row.managerName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-zinc-700 border-b border-zinc-50">{row.registrationNo}</td>
                      <td className="px-3 py-2 text-center text-zinc-700 border-b border-zinc-50">{row.mgmtScale}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-zinc-700 border-b border-zinc-50">
                        {row.activeFundCount ?? "-"}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-zinc-700 border-b border-zinc-50">{row.staffCurrent}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-zinc-700 border-b border-zinc-50">
                        {row.staffPrevious ?? "-"}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums border-b border-zinc-50">
                        {row.staffDelta != null ? (
                          <span className={[
                            "inline-flex items-center gap-0.5",
                            row.staffDelta > 0 ? "text-red-500" : row.staffDelta < 0 ? "text-green-600" : "text-zinc-500",
                          ].join(" ")}>
                            {row.staffDelta > 0 ? <ArrowUp className="h-3 w-3" /> : row.staffDelta < 0 ? <ArrowDown className="h-3 w-3" /> : null}
                            {row.staffDelta > 0 ? `+${row.staffDelta}` : row.staffDelta}
                          </span>
                        ) : "-"}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums text-zinc-700 border-b border-zinc-50">
                        {row.staffGrowthPct != null ? `${row.staffGrowthPct}%` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-end gap-1 px-4 py-3 border-t border-zinc-100 text-xs">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="min-w-[28px] h-7 px-2 border border-zinc-200 rounded disabled:opacity-40 hover:bg-zinc-50 transition-colors"
              >
                ‹
              </button>
              {pageButtons(page, totalPages).map((btn, index) =>
                btn === "…" ? (
                  <span key={`ellipsis-${index}`} className="px-1 text-zinc-400">…</span>
                ) : (
                  <button
                    key={btn}
                    type="button"
                    onClick={() => setPage(btn)}
                    className={[
                      "min-w-[28px] h-7 px-2 border rounded transition-colors",
                      page === btn ? "bg-red-500 text-white border-red-500" : "border-zinc-200 hover:bg-zinc-50",
                    ].join(" ")}
                  >
                    {btn}
                  </button>
                ),
              )}
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="min-w-[28px] h-7 px-2 border border-zinc-200 rounded disabled:opacity-40 hover:bg-zinc-50 transition-colors"
              >
                ›
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
