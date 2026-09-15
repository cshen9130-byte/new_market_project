"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowUpDown, ChevronDown, Download } from "lucide-react"
import { DateInput } from "@/components/ui/date-input"
import { normalizeFofDisplayName } from "@/lib/fof-portfolio-var"
import { ChartCalcHelpButton } from "./ChartCalcHelpButton"

const PERIOD_OPTIONS = ["一周", "一月", "三月", "六月", "一年", "成立以来", "自定义"] as const
type PeriodOption = (typeof PERIOD_OPTIONS)[number]

type FofAttributionRow = {
  fundName: string
  beianHao: string | null
  valuationCode: string | null
  strategy: string | null
  fromDate: string
  toDate: string
  pnl: number
  returnContribution: number
  navContribution: number
}

type FofAttributionResult = {
  snapshotFrom: string | null
  snapshotTo: string | null
  earliestValuationDate: string | null
  rows: FofAttributionRow[]
  totalPnl: number
  totalReturnContribution: number
  totalNavContribution: number
  error?: string
}

type Props = {
  beianHao: string
  displayName: string
  fromDate?: string
  toDate?: string
}

type SortKey = "pnl" | "returnContribution" | "navContribution"
type ViewMode = "fund" | "strategy"

type TableRow = {
  key: string
  fundName: string
  beianHao: string | null
  strategy: string
  fromDate: string
  toDate: string
  pnl: number
  returnContribution: number
  navContribution: number
}

function subtractFromDate(dateStr: string, amount: number, unit: "day" | "month" | "year"): string {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`)
  if (unit === "year") d.setFullYear(d.getFullYear() - amount)
  else if (unit === "month") d.setMonth(d.getMonth() - amount)
  else d.setDate(d.getDate() - amount)
  return d.toISOString().slice(0, 10)
}

function resolveAttributionRange(
  period: PeriodOption,
  endDate: string,
  earliest?: string | null,
): { from: string; to: string } {
  const to = endDate.slice(0, 10)
  let from = to
  switch (period) {
    case "一周":
      from = subtractFromDate(to, 7, "day")
      break
    case "一月":
      from = subtractFromDate(to, 1, "month")
      break
    case "三月":
      from = subtractFromDate(to, 3, "month")
      break
    case "六月":
      from = subtractFromDate(to, 6, "month")
      break
    case "一年":
      from = subtractFromDate(to, 1, "year")
      break
    case "成立以来":
      from = earliest?.slice(0, 10) || to
      break
    default:
      from = to
  }
  if (earliest && from < earliest) from = earliest.slice(0, 10)
  return { from, to }
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  const pct = n * 100
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%`
}

function fmtNavContrib(n: number): string {
  if (Math.abs(n) < 5e-5) return "0.0000"
  return n.toFixed(4)
}

function SignedPct({ value }: { value: number }) {
  const cls = value > 0 ? "text-red-500" : value < 0 ? "text-emerald-600" : "text-zinc-600"
  return <span className={`tabular-nums ${cls}`}>{fmtPct(value)}</span>
}

function SignedMoney({ value }: { value: number }) {
  const cls = value > 0 ? "text-red-500" : value < 0 ? "text-emerald-600" : "text-zinc-800"
  return <span className={`tabular-nums ${cls}`}>{fmtMoney(value)}</span>
}

function toTableRows(rows: FofAttributionRow[]): TableRow[] {
  return rows.map((row, i) => ({
    key: row.beianHao || row.valuationCode || `${row.fundName}-${i}`,
    fundName: normalizeFofDisplayName(row.fundName),
    beianHao: row.beianHao,
    strategy: row.strategy?.trim() || "未配置",
    fromDate: row.fromDate,
    toDate: row.toDate,
    pnl: row.pnl,
    returnContribution: row.returnContribution,
    navContribution: row.navContribution,
  }))
}

function aggregateByStrategy(rows: TableRow[]): TableRow[] {
  const map = new Map<string, TableRow>()
  for (const row of rows) {
    const cur = map.get(row.strategy)
    if (!cur) {
      map.set(row.strategy, {
        ...row,
        key: `strategy:${row.strategy}`,
        fundName: row.strategy,
        beianHao: null,
      })
      continue
    }
    cur.pnl += row.pnl
    cur.returnContribution += row.returnContribution
    cur.navContribution += row.navContribution
    if (row.fromDate < cur.fromDate) cur.fromDate = row.fromDate
    if (row.toDate > cur.toDate) cur.toDate = row.toDate
  }
  return [...map.values()]
}

const HELP_BLOCKS = [
  {
    title: "覆盖范围",
    paragraphs: [
      "只对估值表中的基金持仓做归因，不含股票、期货、期权、银行存款等其他资产。",
    ],
  },
  {
    title: "区间投资收益（元）",
    paragraphs: [
      "相邻两个估值日，用上一估值日的持仓份额乘以当日单位净值变动后加总。若净值缺失，则用市值变动减去成本变动近似申赎现金流。",
    ],
    formula: "P&L ≈ Σ 份额_{t-1} × (净值_t − 净值_{t-1})",
  },
  {
    title: "组合收益贡献度",
    paragraphs: ["该基金区间投资收益占期初组合资产净值的比例。"],
    formula: "收益贡献度 = 区间投资收益 / 期初资产净值",
  },
  {
    title: "组合净值贡献度",
    paragraphs: ["该基金区间投资收益占期初实收资本（份额）的比例，对应单位净值贡献。无实收资本时改用期初资产净值。"],
    formula: "净值贡献度 = 区间投资收益 / 期初实收资本",
  },
]

export function FofAttributionPanel({
  beianHao,
  displayName,
  fromDate,
  toDate,
}: Props) {
  const [data, setData] = useState<FofAttributionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>("pnl")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [viewMode, setViewMode] = useState<ViewMode>("fund")
  const [period, setPeriod] = useState<PeriodOption>("自定义")
  const [rangeFrom, setRangeFrom] = useState(fromDate ?? "")
  const [rangeTo, setRangeTo] = useState(toDate ?? "")

  useEffect(() => {
    if (!rangeFrom && fromDate) setRangeFrom(fromDate)
    if (!rangeTo && toDate) setRangeTo(toDate)
  }, [fromDate, toDate, rangeFrom, rangeTo])

  useEffect(() => {
    if (!beianHao || !rangeFrom || !rangeTo || rangeFrom > rangeTo) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void fetch(
      `/ma/api/private-funds/${encodeURIComponent(beianHao)}/valuation/fof-attribution?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        const json = await res.json() as FofAttributionResult & { error?: string }
        if (!res.ok) throw new Error(json.error || "加载失败")
        if (!controller.signal.aborted) setData(json)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setData(null)
        setError(err instanceof Error ? err.message : "加载失败")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [beianHao, rangeFrom, rangeTo])

  function applyPeriod(next: PeriodOption) {
    setPeriod(next)
    if (next === "自定义") return
    const end = rangeTo || toDate
    if (!end) return
    const nextRange = resolveAttributionRange(next, end, data?.earliestValuationDate)
    setRangeFrom(nextRange.from)
    setRangeTo(nextRange.to)
  }

  useEffect(() => {
    if (period !== "成立以来" || !data?.earliestValuationDate) return
    if (rangeFrom !== data.earliestValuationDate) setRangeFrom(data.earliestValuationDate)
  }, [period, data?.earliestValuationDate, rangeFrom])

  function handleFromChange(value: string) {
    setPeriod("自定义")
    setRangeFrom(value)
  }

  function handleToChange(value: string) {
    setPeriod("自定义")
    setRangeTo(value)
  }

  const tableRows = useMemo(() => {
    const base = toTableRows(data?.rows ?? [])
    const viewed = viewMode === "strategy" ? aggregateByStrategy(base) : base
    const dir = sortDir === "asc" ? 1 : -1
    return [...viewed].sort((a, b) => (a[sortKey] - b[sortKey]) * dir)
  }, [data, viewMode, sortKey, sortDir])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    setSortDir(key === "pnl" ? "asc" : "desc")
  }

  function handleExport() {
    if (!tableRows.length) return
    const headers = ["序号", "基金名称", "投资策略", "统计区间", "区间投资收益(元)", "组合收益贡献度", "组合净值贡献度"]
    const lines = [
      headers.join(","),
      ...tableRows.map((row, i) => [
        i + 1,
        `"${row.fundName.replace(/"/g, '""')}"`,
        row.strategy,
        `${row.fromDate}~${row.toDate}`,
        row.pnl.toFixed(2),
        (row.returnContribution * 100).toFixed(4),
        row.navContribution.toFixed(6),
      ].join(",")),
      [
        "",
        "合计",
        "",
        "",
        (data?.totalPnl ?? 0).toFixed(2),
        ((data?.totalReturnContribution ?? 0) * 100).toFixed(4),
        (data?.totalNavContribution ?? 0).toFixed(6),
      ].join(","),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_FOF归因_${rangeFrom || fromDate || "export"}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const earliest = data?.earliestValuationDate

  return (
    <div className="bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden mt-4">
      <div className="px-4 pt-4 pb-2">
        <div className="text-red-500 font-semibold text-sm">FOF归因</div>
        <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
          {earliest
            ? <>自最早估值日 {earliest} 之后，可对之后任意区间进行基金收益归因，不含股票、期货等其他资产的收益归因。点击查看</>
            : <>所选区间内仅对基金持仓做收益归因，不含股票、期货等其他资产。点击查看</>}
          <ChartCalcHelpButton
            heading="基金收益归因 · 计算逻辑"
            label="基金收益归因计算逻辑"
            className="mx-0.5 text-xs"
            blocks={HELP_BLOCKS}
          />
          。
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-zinc-700">
          <span className="font-medium">• 收益明细</span>
          <span className="text-zinc-500 whitespace-nowrap">统计区间：</span>
          <div className="relative">
            <select
              value={period}
              onChange={(e) => applyPeriod(e.target.value as PeriodOption)}
              className="h-7 min-w-[5.5rem] appearance-none rounded border border-zinc-200 bg-white pl-2 pr-6 text-xs text-zinc-600 focus:outline-none focus:border-red-300"
            >
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
          <DateInput
            value={rangeFrom}
            onChange={handleFromChange}
            placeholder="开始日期"
            min={earliest ?? undefined}
            max={rangeTo || toDate || undefined}
            className="w-[8.5rem]"
            inputClassName="h-7 rounded pl-2 pr-8 text-xs"
            displayClassName="left-2 text-xs"
          />
          <span className="text-zinc-400">～</span>
          <DateInput
            value={rangeTo}
            onChange={handleToChange}
            placeholder="结束日期"
            min={rangeFrom || earliest || undefined}
            max={toDate || undefined}
            className="w-[8.5rem]"
            inputClassName="h-7 rounded pl-2 pr-8 text-xs"
            displayClassName="left-2 text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className="h-7 min-w-[5.5rem] appearance-none rounded border border-zinc-200 bg-white pl-2 pr-6 text-xs text-zinc-600 focus:outline-none focus:border-red-300"
            >
              <option value="fund">团队策略</option>
              <option value="strategy">按策略汇总</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={!tableRows.length}
            className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-red-500 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-40"
          >
            <Download className="h-3 w-3" />
            导出
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border-t border-zinc-100">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50">
              <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap w-10">序号</th>
              <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap min-w-[140px]">
                {viewMode === "strategy" ? "投资策略" : "基金名称"}
              </th>
              {viewMode === "fund" && (
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">投资策略</th>
              )}
              <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap">统计区间</th>
              <SortTh label="区间投资收益（元）" active={sortKey === "pnl"} dir={sortDir} onClick={() => handleSort("pnl")} />
              <SortTh label="组合收益贡献度" active={sortKey === "returnContribution"} dir={sortDir} onClick={() => handleSort("returnContribution")} />
              <SortTh label="组合净值贡献度" active={sortKey === "navContribution"} dir={sortDir} onClick={() => handleSort("navContribution")} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-400">
                  加载 FOF 归因…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-red-500">
                  {error}
                </td>
              </tr>
            ) : tableRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-zinc-400">
                  所选区间估值表不足，无法计算基金收益归因
                </td>
              </tr>
            ) : (
              tableRows.map((row, i) => (
                <tr key={row.key} className="border-b border-zinc-50 hover:bg-red-50/40">
                  <td className="px-3 py-2 text-zinc-500 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2 text-zinc-800 whitespace-nowrap">
                    {row.beianHao ? (
                      <a
                        href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beianHao)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {row.fundName}
                      </a>
                    ) : (
                      row.fundName
                    )}
                  </td>
                  {viewMode === "fund" && (
                    <td className="px-3 py-2 text-zinc-600 whitespace-nowrap">{row.strategy}</td>
                  )}
                  <td className="px-3 py-2 text-zinc-600 tabular-nums whitespace-nowrap">
                    {row.fromDate}~{row.toDate}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <SignedMoney value={row.pnl} />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <SignedPct value={row.returnContribution} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700 whitespace-nowrap">
                    {fmtNavContrib(row.navContribution)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {!loading && !error && tableRows.length > 0 && (
            <tfoot>
              <tr className="bg-zinc-50 border-t border-zinc-200 font-semibold">
                <td className="px-3 py-2.5 text-zinc-700" colSpan={viewMode === "fund" ? 4 : 3}>
                  合计
                </td>
                <td className="px-3 py-2.5 text-right">
                  <SignedMoney value={data?.totalPnl ?? 0} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <SignedPct value={data?.totalReturnContribution ?? 0} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
                  {fmtNavContrib(data?.totalNavContribution ?? 0)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function SortTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string
  active: boolean
  dir: "asc" | "desc"
  onClick: () => void
}) {
  return (
    <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 whitespace-nowrap">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center justify-end gap-0.5 hover:text-zinc-700"
      >
        {label}
        {active ? (
          <span className="text-[10px] text-zinc-400">{dir === "asc" ? "↑" : "↓"}</span>
        ) : (
          <ArrowUpDown className="h-3 w-3 text-zinc-300" />
        )}
      </button>
    </th>
  )
}
