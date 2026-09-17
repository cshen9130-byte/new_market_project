"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ArrowUpDown, ChevronDown, Download } from "lucide-react"
import { DateInput } from "@/components/ui/date-input"
import { normalizeFofDisplayName } from "@/lib/fof-portfolio-var"
import { ChartCalcHelpButton, type ChartCalcHelpBlock } from "./ChartCalcHelpButton"

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
  mtmPnl: number
  realizedPnl: number
  returnContribution: number
  navContribution: number
  cashFlow: number
  cashFlowSource: "ledger" | "qty" | "none"
}

type FofAttributionResult = {
  snapshotFrom: string | null
  snapshotTo: string | null
  earliestValuationDate: string | null
  startNav: number | null
  startPaidIn: number | null
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

type SortKey = "pnl" | "mtmPnl" | "realizedPnl" | "returnContribution" | "navContribution"
type ViewMode = "fund" | "strategy"

type TableRow = {
  key: string
  fundName: string
  beianHao: string | null
  strategy: string
  fromDate: string
  toDate: string
  pnl: number
  mtmPnl: number
  realizedPnl: number
  returnContribution: number
  navContribution: number
  cashFlow: number
  cashFlowSource: "ledger" | "qty" | "none"
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

function cashFlowSourceLabel(source: "ledger" | "qty" | "none"): string {
  if (source === "ledger") return "运维申赎台账确认份额/净额/净值"
  if (source === "qty") return "估值表份额变动，按期末净值估算申赎市值"
  return "无申赎，按持仓盯市"
}

function mergeCashFlowSource(
  a: "ledger" | "qty" | "none",
  b: "ledger" | "qty" | "none",
): "ledger" | "qty" | "none" {
  if (a === "ledger" || b === "ledger") return "ledger"
  if (a === "qty" || b === "qty") return "qty"
  return "none"
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
    mtmPnl: row.mtmPnl ?? 0,
    realizedPnl: row.realizedPnl ?? 0,
    returnContribution: row.returnContribution,
    navContribution: row.navContribution,
    cashFlow: row.cashFlow ?? 0,
    cashFlowSource: row.cashFlowSource ?? "none",
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
    cur.mtmPnl += row.mtmPnl
    cur.realizedPnl += row.realizedPnl
    cur.returnContribution += row.returnContribution
    cur.navContribution += row.navContribution
    cur.cashFlow += row.cashFlow
    cur.cashFlowSource = mergeCashFlowSource(cur.cashFlowSource, row.cashFlowSource)
    if (row.fromDate < cur.fromDate) cur.fromDate = row.fromDate
    if (row.toDate > cur.toDate) cur.toDate = row.toDate
  }
  return [...map.values()]
}

const HELP_BLOCKS: ChartCalcHelpBlock[] = [
  {
    title: "覆盖范围",
    paragraphs: [
      "只对估值表中的基金持仓做归因，不含股票、期货、期权、银行存款等其他资产。",
    ],
  },
  {
    title: "区间投资收益（元）",
    paragraphs: [
      "相邻两个估值日之间，先把持仓盯市到每笔申赎的确认净值，再分别计算：赎回份额在持有期间累计的盈亏记为申赎已实现盈亏；申购不产生已实现盈亏。仍持有的份额再盯市到本估值日，记为市值变动。全部赎回后市值变动为 0。没有申赎时，就是上一估值日份额 × 单位净值变动。",
    ],
    formula: "区间投资收益 = 剩余持仓市值变动 + Σ申赎已实现盈亏",
  },
  {
    title: "剩余持仓市值变动",
    paragraphs: [
      "区间内仍持有的份额盯市到期末净值的盈亏。不含已赎回份额上已经实现的部分。",
    ],
    formula: "剩余持仓市值变动 = 区间投资收益 − 申赎已实现盈亏",
  },
  {
    title: "申赎已实现盈亏",
    paragraphs: [
      "赎回份额在持有期间的累计盈亏（含赎回前已计入市值变动的部分）。全部赎回后整段盈亏都在本列，剩余持仓市值变动为 0。申购确认时为 0。确认日在 (上一估值日, 本估值日] 内的台账优先。",
    ],
    formula: "申赎已实现 = 赎回份额在持有期的累计盈亏",
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

function pnlColumnHelp(from?: string | null, to?: string | null): ChartCalcHelpBlock[] {
  return [
    {
      title: "口径",
      paragraphs: ["只对估值表中的基金持仓计算，不含股票、期货、期权、银行存款。申赎与运维「申赎台账」对齐。"],
    },
    {
      title: "公式",
      paragraphs: [
        "申赎金额不是盈亏。赎回份额在持有期间的累计盈亏记入已实现；仍持有的份额记入市值变动。全部赎回后市值变动为 0。",
      ],
      formula: "区间投资收益 = Σ (剩余持仓市值变动 + 申赎已实现盈亏)",
    },
    {
      title: "申赎",
      paragraphs: [
        "优先用台账确认份额、确认净额、确认净值。台账无记录时用估值表份额变动 × 期末净值估算赎回市值，不用Δ成本。没有申赎时改用份额 × Δ净值。",
      ],
      formula: "申赎已实现 = 赎回份额在持有期的累计盈亏",
    },
    ...(from && to
      ? [{ title: "当前区间", paragraphs: [`估值表实际起止：${from} ～ ${to}`] }]
      : []),
  ]
}

function returnColumnHelp(startNav: number | null): ChartCalcHelpBlock[] {
  return [
    {
      title: "含义",
      paragraphs: ["该基金区间投资收益占组合期初资产净值的比例，表示对组合收益率的贡献。"],
    },
    {
      title: "公式",
      formula: "组合收益贡献度 = 区间投资收益 / 期初资产净值",
    },
    {
      title: "显示",
      paragraphs: ["页面按百分比、保留两位小数，例如 −0.0016 显示为 −0.16%。"],
    },
    ...(startNav != null && startNav > 0
      ? [{ title: "本期期初资产净值", formula: `${fmtMoney(startNav)} 元` }]
      : []),
  ]
}

function navColumnHelp(startPaidIn: number | null, startNav: number | null): ChartCalcHelpBlock[] {
  const usedPaidIn = startPaidIn != null && startPaidIn > 0
  return [
    {
      title: "含义",
      paragraphs: ["该基金区间投资收益占期初实收资本（份额）的比例，对应对单位净值的贡献。无实收资本时改用期初资产净值。"],
    },
    {
      title: "公式",
      formula: usedPaidIn
        ? "组合净值贡献度 = 区间投资收益 / 期初实收资本"
        : "组合净值贡献度 = 区间投资收益 / 期初资产净值",
    },
    {
      title: "显示",
      paragraphs: ["页面按小数、保留四位，例如 −0.0016。"],
    },
    ...(usedPaidIn
      ? [{ title: "本期期初实收资本", formula: `${fmtMoney(startPaidIn!)} 元` }]
      : startNav != null && startNav > 0
        ? [{ title: "本期分母（期初资产净值）", formula: `${fmtMoney(startNav)} 元` }]
        : []),
  ]
}

function mtmColumnHelp(): ChartCalcHelpBlock[] {
  return [
    {
      title: "含义",
      paragraphs: ["区间内仍持有的份额，盯市到期末净值的盈亏。不含已赎回份额上已经实现的部分。"],
    },
    {
      title: "公式",
      formula: "剩余持仓市值变动 = 区间投资收益 − 申赎已实现盈亏",
    },
  ]
}

function realizedColumnHelp(): ChartCalcHelpBlock[] {
  return [
    {
      title: "含义",
      paragraphs: [
        "赎回份额在持有期间的累计盈亏。全部赎回后本列等于区间投资收益，剩余持仓市值变动为 0。申购确认时为 0。",
      ],
    },
    {
      title: "公式",
      formula: "申赎已实现 = 赎回份额在持有期的累计盈亏",
    },
  ]
}

function rowMtmHelp(row: TableRow): ChartCalcHelpBlock[] {
  return [
    {
      title: "本行",
      paragraphs: [`${row.fundName} · ${row.fromDate} ～ ${row.toDate}`],
      formula: `剩余持仓市值变动 = ${fmtMoney(row.mtmPnl)} 元`,
    },
  ]
}

function rowRealizedHelp(row: TableRow): ChartCalcHelpBlock[] {
  return [
    {
      title: "本行",
      paragraphs: [
        `${row.fundName} · ${row.fromDate} ～ ${row.toDate}`,
        `申赎来源：${cashFlowSourceLabel(row.cashFlowSource)}`,
      ],
      formula: `申赎已实现盈亏 = ${fmtMoney(row.realizedPnl)} 元`,
    },
  ]
}

function rowPnlHelp(row: TableRow): ChartCalcHelpBlock[] {
  return [
    {
      title: "本行",
      paragraphs: [
        `${row.fundName} · ${row.fromDate} ～ ${row.toDate}`,
        `申赎来源：${cashFlowSourceLabel(row.cashFlowSource)}`,
      ],
      formula: `剩余持仓市值变动 ${fmtMoney(row.mtmPnl)}\n+ 申赎已实现盈亏 ${fmtMoney(row.realizedPnl)}\n= ${fmtMoney(row.pnl)} 元`,
    },
  ]
}

function rowReturnHelp(row: TableRow, startNav: number | null): ChartCalcHelpBlock[] {
  const nav = startNav != null && startNav > 0 ? startNav : null
  return [
    {
      title: "本行",
      paragraphs: [`${row.fundName}`],
      formula: nav != null
        ? `${fmtMoney(row.pnl)} / ${fmtMoney(nav)}\n= ${fmtPct(row.returnContribution)}`
        : `组合收益贡献度 = ${fmtPct(row.returnContribution)}`,
    },
  ]
}

function rowNavHelp(row: TableRow, startPaidIn: number | null, startNav: number | null): ChartCalcHelpBlock[] {
  const base = startPaidIn != null && startPaidIn > 0
    ? startPaidIn
    : startNav != null && startNav > 0
      ? startNav
      : null
  const baseLabel = startPaidIn != null && startPaidIn > 0 ? "期初实收资本" : "期初资产净值"
  return [
    {
      title: "本行",
      paragraphs: [`${row.fundName}`, `分母：${baseLabel}`],
      formula: base != null
        ? `${fmtMoney(row.pnl)} / ${fmtMoney(base)}\n= ${fmtNavContrib(row.navContribution)}`
        : `组合净值贡献度 = ${fmtNavContrib(row.navContribution)}`,
    },
  ]
}

function totalHelp(filtered: boolean): ChartCalcHelpBlock[] {
  return [
    {
      title: "合计",
      paragraphs: [
        filtered
          ? "为当前投资策略筛选下各行加总。"
          : "为表中全部基金持仓加总。",
        "贡献度仍相对整组合期初净值 / 实收资本，不会在筛选后重新归一化。",
      ],
      formula: "合计 = Σ 当前表中各行",
    },
  ]
}

function CellHelp({
  heading,
  blocks,
}: {
  heading: string
  blocks: ChartCalcHelpBlock[]
}) {
  return (
    <ChartCalcHelpButton
      heading={heading}
      blocks={blocks}
      align="end"
      className="text-zinc-300 hover:text-zinc-600"
    />
  )
}

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
  const [strategyFilter, setStrategyFilter] = useState("全部")
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

  const allRows = useMemo(() => toTableRows(data?.rows ?? []), [data])

  const strategyOptions = useMemo(() => {
    const names = [...new Set(allRows.map((row) => row.strategy).filter(Boolean))]
    names.sort((a, b) => a.localeCompare(b, "zh-CN"))
    return ["全部", ...names]
  }, [allRows])

  useEffect(() => {
    if (strategyFilter !== "全部" && !strategyOptions.includes(strategyFilter)) {
      setStrategyFilter("全部")
    }
  }, [strategyOptions, strategyFilter])

  const tableRows = useMemo(() => {
    const filtered = strategyFilter === "全部"
      ? allRows
      : allRows.filter((row) => row.strategy === strategyFilter)
    const viewed = viewMode === "strategy" ? aggregateByStrategy(filtered) : filtered
    const dir = sortDir === "asc" ? 1 : -1
    return [...viewed].sort((a, b) => (a[sortKey] - b[sortKey]) * dir)
  }, [allRows, strategyFilter, viewMode, sortKey, sortDir])

  const filteredTotals = useMemo(() => ({
    pnl: tableRows.reduce((s, r) => s + r.pnl, 0),
    mtmPnl: tableRows.reduce((s, r) => s + r.mtmPnl, 0),
    realizedPnl: tableRows.reduce((s, r) => s + r.realizedPnl, 0),
    returnContribution: tableRows.reduce((s, r) => s + r.returnContribution, 0),
    navContribution: tableRows.reduce((s, r) => s + r.navContribution, 0),
  }), [tableRows])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    setSortDir(key === "returnContribution" || key === "navContribution" ? "desc" : "asc")
  }

  function handleExport() {
    if (!tableRows.length) return
    const headers = [
      "序号",
      "基金名称",
      "投资策略",
      "统计区间",
      "区间投资收益(元)",
      "剩余持仓市值变动(元)",
      "申赎已实现盈亏(元)",
      "组合收益贡献度",
      "组合净值贡献度",
    ]
    const lines = [
      headers.join(","),
      ...tableRows.map((row, i) => [
        i + 1,
        `"${row.fundName.replace(/"/g, '""')}"`,
        row.strategy,
        `${row.fromDate}~${row.toDate}`,
        row.pnl.toFixed(2),
        row.mtmPnl.toFixed(2),
        row.realizedPnl.toFixed(2),
        (row.returnContribution * 100).toFixed(4),
        row.navContribution.toFixed(6),
      ].join(",")),
      [
        "",
        "合计",
        "",
        "",
        filteredTotals.pnl.toFixed(2),
        filteredTotals.mtmPnl.toFixed(2),
        filteredTotals.realizedPnl.toFixed(2),
        (filteredTotals.returnContribution * 100).toFixed(4),
        filteredTotals.navContribution.toFixed(6),
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
  const colCount = viewMode === "fund" ? 9 : 8

  return (
    <div className="bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden mt-4">
      <div className="px-4 pt-4 pb-2">
        <div className="text-red-500 font-semibold text-sm">FOF归因</div>
        <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
          {earliest
            ? <>自最早估值日 {earliest} 之后，可对之后任意区间进行基金收益归因。逐笔计入申赎已实现盈亏，再加剩余持仓市值变动；申赎与运维申赎台账对齐，不含股票、期货等其他资产。点击查看</>
            : <>所选区间内仅对基金持仓做收益归因。逐笔计入申赎已实现盈亏，再加剩余持仓市值变动；申赎与运维申赎台账对齐，不含股票、期货等其他资产。点击查看</>}
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
          <span className="text-xs text-zinc-500 whitespace-nowrap">投资策略：</span>
          <div className="relative">
            <select
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="h-7 min-w-[6.5rem] appearance-none rounded border border-zinc-200 bg-white pl-2 pr-6 text-xs text-zinc-600 focus:outline-none focus:border-red-300"
            >
              {strategyOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
          <div className="relative">
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className="h-7 min-w-[5.5rem] appearance-none rounded border border-zinc-200 bg-white pl-2 pr-6 text-xs text-zinc-600 focus:outline-none focus:border-red-300"
            >
              <option value="fund">基金明细</option>
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

      {strategyOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          {strategyOptions.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStrategyFilter(tab)}
              className={[
                "px-2.5 py-1 rounded text-xs border transition-colors whitespace-nowrap",
                strategyFilter === tab
                  ? "bg-red-500 text-white border-red-500"
                  : "border-red-400 text-red-500 hover:bg-red-50",
              ].join(" ")}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

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
              <SortTh
                label="区间投资收益（元）"
                active={sortKey === "pnl"}
                dir={sortDir}
                onClick={() => handleSort("pnl")}
                help={(
                  <ChartCalcHelpButton
                    heading="区间投资收益 · 计算说明"
                    align="end"
                    blocks={pnlColumnHelp(data?.snapshotFrom, data?.snapshotTo)}
                  />
                )}
              />
              <SortTh
                label="剩余持仓市值变动"
                active={sortKey === "mtmPnl"}
                dir={sortDir}
                onClick={() => handleSort("mtmPnl")}
                help={(
                  <ChartCalcHelpButton
                    heading="剩余持仓市值变动 · 计算说明"
                    align="end"
                    blocks={mtmColumnHelp()}
                  />
                )}
              />
              <SortTh
                label="申赎已实现盈亏"
                active={sortKey === "realizedPnl"}
                dir={sortDir}
                onClick={() => handleSort("realizedPnl")}
                help={(
                  <ChartCalcHelpButton
                    heading="申赎已实现盈亏 · 计算说明"
                    align="end"
                    blocks={realizedColumnHelp()}
                  />
                )}
              />
              <SortTh
                label="组合收益贡献度"
                active={sortKey === "returnContribution"}
                dir={sortDir}
                onClick={() => handleSort("returnContribution")}
                help={(
                  <ChartCalcHelpButton
                    heading="组合收益贡献度 · 计算说明"
                    align="end"
                    blocks={returnColumnHelp(data?.startNav ?? null)}
                  />
                )}
              />
              <SortTh
                label="组合净值贡献度"
                active={sortKey === "navContribution"}
                dir={sortDir}
                onClick={() => handleSort("navContribution")}
                help={(
                  <ChartCalcHelpButton
                    heading="组合净值贡献度 · 计算说明"
                    align="end"
                    blocks={navColumnHelp(data?.startPaidIn ?? null, data?.startNav ?? null)}
                  />
                )}
              />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-12 text-center text-sm text-zinc-400">
                  加载 FOF 归因…
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-12 text-center text-sm text-red-500">
                  {error}
                </td>
              </tr>
            ) : tableRows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-4 py-12 text-center text-sm text-zinc-400">
                  {allRows.length === 0
                    ? "所选区间估值表不足，无法计算基金收益归因"
                    : "当前投资策略筛选下没有基金"}
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
                    <span className="inline-flex items-center justify-end gap-0.5">
                      <SignedMoney value={row.pnl} />
                      <CellHelp
                        heading={`${row.fundName} · 区间投资收益`}
                        blocks={rowPnlHelp(row)}
                      />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-0.5">
                      <SignedMoney value={row.mtmPnl} />
                      <CellHelp
                        heading={`${row.fundName} · 剩余持仓市值变动`}
                        blocks={rowMtmHelp(row)}
                      />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-0.5">
                      <SignedMoney value={row.realizedPnl} />
                      <CellHelp
                        heading={`${row.fundName} · 申赎已实现盈亏`}
                        blocks={rowRealizedHelp(row)}
                      />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-0.5">
                      <SignedPct value={row.returnContribution} />
                      <CellHelp
                        heading={`${row.fundName} · 组合收益贡献度`}
                        blocks={rowReturnHelp(row, data?.startNav ?? null)}
                      />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700 whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-0.5">
                      {fmtNavContrib(row.navContribution)}
                      <CellHelp
                        heading={`${row.fundName} · 组合净值贡献度`}
                        blocks={rowNavHelp(row, data?.startPaidIn ?? null, data?.startNav ?? null)}
                      />
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {!loading && !error && tableRows.length > 0 && (
            <tfoot>
              <tr className="bg-zinc-50 border-t border-zinc-200 font-semibold">
                <td className="px-3 py-2.5 text-zinc-700" colSpan={viewMode === "fund" ? 4 : 3}>
                  <span className="inline-flex items-center gap-1">
                    合计
                    <ChartCalcHelpButton
                      heading="合计 · 计算说明"
                      blocks={totalHelp(strategyFilter !== "全部")}
                    />
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    <SignedMoney value={filteredTotals.pnl} />
                    <CellHelp
                      heading="合计 · 区间投资收益"
                      blocks={[{
                        title: "本行",
                        paragraphs: ["当前表中各行区间投资收益之和。口径为剩余持仓市值变动 + 申赎已实现盈亏。"],
                        formula: `Σ = ${fmtMoney(filteredTotals.pnl)} 元`,
                      }]}
                    />
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    <SignedMoney value={filteredTotals.mtmPnl} />
                    <CellHelp
                      heading="合计 · 剩余持仓市值变动"
                      blocks={[{
                        title: "本行",
                        paragraphs: ["当前表中各行剩余持仓市值变动之和。"],
                        formula: `Σ = ${fmtMoney(filteredTotals.mtmPnl)} 元`,
                      }]}
                    />
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    <SignedMoney value={filteredTotals.realizedPnl} />
                    <CellHelp
                      heading="合计 · 申赎已实现盈亏"
                      blocks={[{
                        title: "本行",
                        paragraphs: ["当前表中各行申赎已实现盈亏之和。"],
                        formula: `Σ = ${fmtMoney(filteredTotals.realizedPnl)} 元`,
                      }]}
                    />
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    <SignedPct value={filteredTotals.returnContribution} />
                    <CellHelp
                      heading="合计 · 组合收益贡献度"
                      blocks={[{
                        title: "本行",
                        paragraphs: ["当前表中各行收益贡献度之和，分母仍是整组合期初资产净值。"],
                        formula: data?.startNav
                          ? `${fmtMoney(filteredTotals.pnl)} / ${fmtMoney(data.startNav)}\n= ${fmtPct(filteredTotals.returnContribution)}`
                          : `Σ = ${fmtPct(filteredTotals.returnContribution)}`,
                      }]}
                    />
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    {fmtNavContrib(filteredTotals.navContribution)}
                    <CellHelp
                      heading="合计 · 组合净值贡献度"
                      blocks={[{
                        title: "本行",
                        paragraphs: ["当前表中各行净值贡献度之和。"],
                        formula: (data?.startPaidIn || data?.startNav)
                          ? `${fmtMoney(filteredTotals.pnl)} / ${fmtMoney((data.startPaidIn && data.startPaidIn > 0 ? data.startPaidIn : data.startNav) ?? 0)}\n= ${fmtNavContrib(filteredTotals.navContribution)}`
                          : `Σ = ${fmtNavContrib(filteredTotals.navContribution)}`,
                      }]}
                    />
                  </span>
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
  help,
}: {
  label: string
  active: boolean
  dir: "asc" | "desc"
  onClick: () => void
  help?: ReactNode
}) {
  return (
    <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 whitespace-nowrap">
      <span className="inline-flex items-center justify-end gap-0.5">
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
        {help}
      </span>
    </th>
  )
}
