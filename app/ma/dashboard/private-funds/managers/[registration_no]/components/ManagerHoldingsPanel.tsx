"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import ReactECharts from "echarts-for-react"
import { Inbox } from "lucide-react"

interface HoldingRow {
  cutoff_date: string
  stock_name: string
  stock_code: string
  shares_10k: number
  market_value_10k: number
  pct_float: number
  pct_total: number
  fund_count: number
  sample_fund_beian_hao: string | null
  sample_fund_name: string | null
}

interface TrendPoint {
  period: string
  market_value_10k: number
}

interface HoldingsData {
  latest_dynamics: HoldingRow[]
  quarterly_holdings: HoldingRow[]
  trend: TrendPoint[]
  quarter_options: string[]
  start_quarter: string
  end_quarter: string
}

function quarterOptionLabel(value: string): string {
  const m = value.match(/^(\d{4})-Q([1-4])$/)
  if (!m) return value
  return `${m[1]}年${m[2]}季度`
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-4">
      <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
      {children}
    </div>
  )
}

function HintText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-red-500 leading-relaxed">{children}</p>
}

function EmptyTable({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-16 text-center">
        <div className="flex flex-col items-center gap-2 text-zinc-400">
          <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
          <span className="text-sm">暂无数据</span>
        </div>
      </td>
    </tr>
  )
}

function buildTrendChartOption(trend: TrendPoint[]): Record<string, unknown> | null {
  if (trend.length === 0) return null
  return {
    backgroundColor: "transparent",
    animation: false,
    tooltip: {
      trigger: "axis",
      valueFormatter: (v: number) => `${v.toFixed(2)} 万元`,
    },
    legend: {
      top: 0,
      left: 0,
      textStyle: { fontSize: 11, color: "#52525b" },
      data: ["合计持仓"],
    },
    grid: { left: 56, right: 24, top: 48, bottom: 36, containLabel: true },
    xAxis: {
      type: "category",
      data: trend.map((t) => t.period),
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      axisLine: { lineStyle: { color: "#e4e4e7" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      name: "市值(万元)",
      nameTextStyle: { fontSize: 11, color: "#a1a1aa" },
      axisLabel: { fontSize: 11, color: "#a1a1aa" },
      splitLine: { lineStyle: { color: "#f4f4f5", type: "dashed" } },
    },
    series: [
      {
        name: "合计持仓",
        type: "bar",
        barMaxWidth: 48,
        itemStyle: { color: "#ef4444" },
        data: trend.map((t) => +t.market_value_10k.toFixed(2)),
      },
    ],
  }
}

const DYNAMICS_HEADERS = [
  "截止日期",
  "股票名称",
  "股票代码",
  "持股数量(万股)",
  "持股市值(万元)",
  "占流通股比率",
  "占总股本比率",
  "持有基金数量",
  "操作",
] as const

const QUARTERLY_HEADERS = [
  "截止日期",
  "股票名称",
  "股票代码",
  "持股数量(万股)",
  "持股市值(万元)",
  "占流通股比率",
  "占总股本比率",
  "持有基金数量",
  "操作",
] as const

function HoldingsTable({
  rows,
  headers,
}: {
  rows: HoldingRow[]
  headers: readonly string[]
}) {
  const thBase = "px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap bg-zinc-50/80"
  const tdBase = "px-3 py-2.5 text-sm text-zinc-700 whitespace-nowrap"

  return (
    <div className="overflow-x-auto w-full">
      <table className="text-sm border-collapse w-full min-w-[1100px]">
        <thead>
          <tr className="border-b border-zinc-100">
            {headers.map((h) => (
              <th key={h} className={thBase}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyTable colSpan={headers.length} />
          ) : (
            rows.map((row, idx) => (
              <tr key={`${row.cutoff_date}-${row.stock_code}-${idx}`} className="border-b border-zinc-50 hover:bg-zinc-50/40">
                <td className={`${tdBase} tabular-nums`}>{row.cutoff_date}</td>
                <td className={tdBase}>{row.stock_name}</td>
                <td className={`${tdBase} tabular-nums`}>{row.stock_code}</td>
                <td className={`${tdBase} tabular-nums text-right`}>{row.shares_10k.toFixed(2)}</td>
                <td className={`${tdBase} tabular-nums text-right`}>{row.market_value_10k.toFixed(2)}</td>
                <td className={`${tdBase} tabular-nums text-right`}>{row.pct_float.toFixed(2)}%</td>
                <td className={`${tdBase} tabular-nums text-right`}>{row.pct_total.toFixed(2)}%</td>
                <td className={`${tdBase} tabular-nums text-center`}>{row.fund_count}</td>
                <td className={tdBase}>
                  {row.sample_fund_beian_hao ? (
                    <Link
                      href={`/ma/dashboard/private-funds/${encodeURIComponent(row.sample_fund_beian_hao)}`}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      查看基金
                    </Link>
                  ) : (
                    <span className="text-blue-600 text-xs cursor-default">查看基金</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function ManagerHoldingsPanel({ registrationNo }: { registrationNo: string }) {
  const [data, setData] = useState<HoldingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startQuarter, setStartQuarter] = useState("")
  const [endQuarter, setEndQuarter] = useState("")
  const [page, setPage] = useState(1)
  const pageSize = 50
  const chartRef = useRef<ReactECharts>(null)

  const load = useCallback(
    (start?: string, end?: string) => {
      setLoading(true)
      setError(null)
      const params = new URLSearchParams()
      if (start) params.set("start", start)
      if (end) params.set("end", end)
      const qs = params.toString()
      return fetch(
        `/ma/api/private-fund-managers/${encodeURIComponent(registrationNo)}/holdings${qs ? `?${qs}` : ""}`,
      )
        .then(async (res) => {
          if (!res.ok) throw new Error("加载失败")
          return res.json() as Promise<HoldingsData>
        })
        .then((json) => {
          setData(json)
          if (!start && !end) {
            setStartQuarter(json.start_quarter)
            setEndQuarter(json.end_quarter)
          }
          setPage(1)
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false))
    },
    [registrationNo],
  )

  useEffect(() => {
    load()
  }, [load])

  const chartOption = useMemo(
    () => (data?.trend?.length ? buildTrendChartOption(data.trend) : null),
    [data?.trend],
  )

  useEffect(() => {
    if (!chartOption) return
    const resize = () => chartRef.current?.getEchartsInstance()?.resize()
    resize()
    window.addEventListener("resize", resize)
    return () => window.removeEventListener("resize", resize)
  }, [chartOption])

  const rows = data?.quarterly_holdings ?? []
  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pagedRows = rows.slice((page - 1) * pageSize, page * pageSize)

  if (loading && !data) {
    return (
      <div className="space-y-4 w-full animate-pulse">
        <div className="h-48 rounded-lg bg-zinc-100" />
        <div className="h-72 rounded-lg bg-zinc-100" />
        <div className="h-64 rounded-lg bg-zinc-100" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-40 text-red-500 text-sm rounded-lg border border-zinc-100 bg-white w-full">
        加载失败：{error}
      </div>
    )
  }

  const quarterOptions = data?.quarter_options ?? []

  return (
    <div className="space-y-4 w-full">
      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle>最新持股动态</SectionTitle>
        <HintText>
          提示：根据上市公司各季度内临时公告披露的股东持股情况进行统计
        </HintText>
        <div className="mt-4">
          <HoldingsTable rows={data?.latest_dynamics ?? []} headers={DYNAMICS_HEADERS} />
        </div>
      </div>

      <div className="rounded-lg border border-zinc-100 bg-white px-5 py-4 w-full">
        <SectionTitle>旗下基金持股</SectionTitle>

        <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
          <span className="text-zinc-500 shrink-0">本期区间</span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-zinc-500">开始时间</span>
            <select
              value={startQuarter}
              onChange={(e) => setStartQuarter(e.target.value)}
              className="h-8 rounded border border-zinc-200 bg-white px-2 text-zinc-700 outline-none focus:ring-1 focus:ring-red-200"
            >
              {quarterOptions.map((q) => (
                <option key={`s-${q}`} value={q}>{quarterOptionLabel(q)}</option>
              ))}
            </select>
            <span className="text-zinc-500">结束时间</span>
            <select
              value={endQuarter}
              onChange={(e) => setEndQuarter(e.target.value)}
              className="h-8 rounded border border-zinc-200 bg-white px-2 text-zinc-700 outline-none focus:ring-1 focus:ring-red-200"
            >
              {quarterOptions.map((q) => (
                <option key={`e-${q}`} value={q}>{quarterOptionLabel(q)}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => load(startQuarter, endQuarter)}
            className="ml-auto h-8 px-4 rounded bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
          >
            查询
          </button>
        </div>

        <div className="mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 mb-3">
            <span className="inline-block w-1 h-4 rounded-sm bg-red-500 shrink-0" />
            股票持仓走势
          </div>
          {chartOption ? (
            <div className="w-full min-w-0">
              <ReactECharts
                ref={chartRef}
                option={chartOption}
                style={{ height: 320, width: "100%" }}
                className="!w-full"
                notMerge
                lazyUpdate
              />
            </div>
          ) : (
            <div className="h-[320px] flex items-center justify-center text-sm text-zinc-400 border border-zinc-100 rounded-lg">
              暂无走势数据
            </div>
          )}
        </div>

        <HoldingsTable rows={pagedRows} headers={QUARTERLY_HEADERS} />

        <div className="mt-3">
          <HintText>
            提示：根据上市公司每个季度披露的前十大股东和前十大流通股东的持股情况进行统计
          </HintText>
        </div>

        <div className="flex items-center justify-end gap-2 mt-4 text-xs text-zinc-600">
          <span>总共{total}个项目</span>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="w-7 h-7 flex items-center justify-center rounded border hover:bg-zinc-50 disabled:opacity-30"
          >
            ‹
          </button>
          <span className="min-w-[28px] h-7 flex items-center justify-center rounded border bg-red-500 text-white border-red-500 font-medium">
            {page}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="w-7 h-7 flex items-center justify-center rounded border hover:bg-zinc-50 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  )
}
