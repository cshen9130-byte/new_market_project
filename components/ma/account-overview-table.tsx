"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, ChevronsUpDown, ListFilter } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type OverviewRow = {
  fundName: string
  companyName: string
  accountNo: string
  selectKey?: string
  tradeDate: string
  equity: number | null
  margin: number | null
  totalPl: number | null
  holdingPl: number | null
  closedPl: number | null
  riskPct: number | null
  unilateralRiskPct: number | null
  commission: number | null
  nav?: number[]
}

function NavSparkline({ values }: { values: number[] }) {
  const series = values.filter((v) => Number.isFinite(v))
  if (series.length < 2) return <span className="text-muted-foreground">—</span>

  const w = 96
  const h = 22
  const pad = 2
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min
  const yAt = (v: number) => (
    span < 1e-9 ? h / 2 : pad + (1 - (v - min) / span) * (h - pad * 2)
  )
  const pts = series.map((v, i) => {
    const x = pad + (i / (series.length - 1)) * (w - pad * 2)
    return [x, yAt(v)] as const
  })
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")
  const last = series[series.length - 1]
  const first = series[0]
  const ret = first > 0 ? (last / first - 1) * 100 : 0
  const up = ret > 0.005
  const down = ret < -0.005
  const color = up ? "#ef4444" : down ? "#22c55e" : "#94a3b8"
  const end = pts[pts.length - 1]
  const area = `${line} L${end[0].toFixed(1)} ${h - pad} L${pts[0][0].toFixed(1)} ${h - pad} Z`
  const label = `单位净值 ${last.toFixed(4)}（${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%）`

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="inline-block align-middle"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <path d={area} fill={color} fillOpacity={0.14} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={end[0]} cy={end[1]} r={1.6} fill={color} />
    </svg>
  )
}

function fmtMoney(v: number | null, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return v.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—"
  return `${v.toFixed(2)}%`
}

function pnlClass(v: number | null): string {
  if (v == null || !Number.isFinite(v) || v === 0) return ""
  return v > 0 ? "text-red-500" : "text-green-500"
}

type SortKey =
  | "fundName"
  | "companyName"
  | "accountNo"
  | "nav"
  | "equity"
  | "margin"
  | "totalPl"
  | "holdingPl"
  | "closedPl"
  | "riskPct"
  | "unilateralRiskPct"
  | "commission"

type GroupBy = "none" | "fund" | "company"

type TableRow = {
  key: string
  fundName: string
  companyName: string
  accountLabel: string
  selectKey: string
  nav: number[]
  equity: number | null
  margin: number | null
  totalPl: number | null
  holdingPl: number | null
  closedPl: number | null
  riskPct: number | null
  unilateralRiskPct: number | null
  commission: number | null
  sortAccount: string | number
  sortNav: number | null
}

const TEXT_SORT_KEYS = new Set<SortKey>(["fundName", "companyName", "accountNo"])

function navReturn(nav: number[] | undefined): number | null {
  if (!nav || nav.length < 2) return null
  const first = nav[0]
  const last = nav[nav.length - 1]
  if (!Number.isFinite(first) || first === 0 || !Number.isFinite(last)) return null
  return last / first - 1
}

function sumOf(
  rows: OverviewRow[],
  key: "equity" | "margin" | "totalPl" | "holdingPl" | "closedPl" | "commission",
): number | null {
  let total = 0
  let any = false
  for (const row of rows) {
    const value = row[key]
    if (value == null || !Number.isFinite(value)) continue
    total += value
    any = true
  }
  return any ? total : null
}

function equityWeightedPct(rows: OverviewRow[], key: "unilateralRiskPct"): number | null {
  let weight = 0
  let weighted = 0
  for (const row of rows) {
    const equity = row.equity
    const pct = row[key]
    if (equity == null || equity <= 0 || pct == null || !Number.isFinite(pct)) continue
    weight += equity
    weighted += pct * equity
  }
  return weight > 0 ? weighted / weight : null
}

function riskFromSums(margin: number | null, equity: number | null): number | null {
  if (margin == null || equity == null || equity <= 0) return null
  return (margin / equity) * 100
}

function labelMany(names: string[], unit: string): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
  if (unique.length === 0) return "—"
  if (unique.length === 1) return unique[0]
  return `${unique[0]}等${unique.length}${unit}`
}

function toTableRow(members: OverviewRow[], groupBy: GroupBy, key: string): TableRow {
  const equity = sumOf(members, "equity")
  const margin = sumOf(members, "margin")
  const single = groupBy === "none" && members.length === 1 ? members[0] : null
  return {
    key,
    fundName: groupBy === "company" ? labelMany(members.map((row) => row.fundName), "个") : (single ? single.fundName : key),
    companyName: groupBy === "fund" ? labelMany(members.map((row) => row.companyName), "家") : (single ? single.companyName : key),
    accountLabel: single ? (single.accountNo || "—") : `${members.length}个账号`,
    selectKey: single ? (single.selectKey || single.accountNo) : "",
    nav: single?.nav ?? [],
    equity,
    margin,
    totalPl: sumOf(members, "totalPl"),
    holdingPl: sumOf(members, "holdingPl"),
    closedPl: sumOf(members, "closedPl"),
    riskPct: single ? single.riskPct : riskFromSums(margin, equity),
    unilateralRiskPct: single ? single.unilateralRiskPct : equityWeightedPct(members, "unilateralRiskPct"),
    commission: sumOf(members, "commission"),
    sortAccount: single ? single.accountNo : members.length,
    sortNav: navReturn(single?.nav),
  }
}

function groupRows(rows: OverviewRow[], groupBy: GroupBy): TableRow[] {
  if (groupBy === "none") {
    return rows.map((row, index) => toTableRow([row], "none", row.accountNo || `${row.fundName}-${index}`))
  }
  const groups = new Map<string, OverviewRow[]>()
  for (const row of rows) {
    const key = ((groupBy === "fund" ? row.fundName : row.companyName) || "—").trim() || "—"
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }
  return [...groups.entries()].map(([key, members]) => toTableRow(members, groupBy, key))
}

function sortValue(row: TableRow, key: SortKey): string | number | null {
  if (key === "accountNo") return row.sortAccount
  if (key === "nav") return row.sortNav
  return row[key]
}

function AccountCells({ row, onSelectAccount }: { row: TableRow; onSelectAccount?: (selectKey: string) => void }) {
  const openAccount = onSelectAccount && row.selectKey && row.accountLabel !== "—" ? onSelectAccount : null
  return (
    <>
      <td className="whitespace-nowrap px-2 py-1.5">{row.fundName || "—"}</td>
      <td className="whitespace-nowrap px-2 py-1.5">{row.companyName || "—"}</td>
      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
        {openAccount ? (
          <button
            type="button"
            onClick={() => openAccount(row.selectKey)}
            title="查看该账户"
            className="text-primary underline-offset-2 hover:underline"
          >
            {row.accountLabel}
          </button>
        ) : (
          row.accountLabel || "—"
        )}
      </td>
      <td className="px-2 py-1 text-center">
        {row.nav.length >= 2 ? <NavSparkline values={row.nav} /> : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(row.equity)}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(row.margin)}</td>
      <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${pnlClass(row.totalPl)}`}>{fmtMoney(row.totalPl, 0)}</td>
      <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${pnlClass(row.holdingPl)}`}>{fmtMoney(row.holdingPl, 0)}</td>
      <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${pnlClass(row.closedPl)}`}>{fmtMoney(row.closedPl, 0)}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtPct(row.riskPct)}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtPct(row.unilateralRiskPct)}</td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{fmtMoney(row.commission)}</td>
    </>
  )
}

function compareValues(a: string | number | null, b: string | number | null, dir: "asc" | "desc"): number {
  const emptyA = a == null || a === "" || (typeof a === "number" && !Number.isFinite(a))
  const emptyB = b == null || b === "" || (typeof b === "number" && !Number.isFinite(b))
  if (emptyA && emptyB) return 0
  if (emptyA) return 1
  if (emptyB) return -1
  const sign = dir === "asc" ? 1 : -1
  if (typeof a === "number" && typeof b === "number") return (a - b) * sign
  return String(a).localeCompare(String(b), "zh-CN") * sign
}

function displayName(value: string): string {
  const name = value.trim()
  return name || "—"
}

function uniqueNames(rows: OverviewRow[], key: "fundName" | "companyName"): string[] {
  const names = new Set<string>()
  for (const row of rows) names.add(displayName(row[key] || ""))
  return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"))
}

function ColumnValueFilter({
  options,
  selected,
  onChange,
}: {
  options: string[]
  selected: string[] | null
  onChange: (next: string[] | null) => void
}) {
  const filtering = selected != null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={filtering ? `已选 ${selected.length} 项` : "筛选"}
          aria-label="筛选"
          className={`inline-flex rounded p-0.5 ${filtering ? "text-primary" : "text-muted-foreground opacity-60 hover:opacity-100 hover:text-foreground"}`}
        >
          <ListFilter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <label className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
          <input
            type="checkbox"
            className="shrink-0"
            checked={!filtering}
            onChange={() => onChange(null)}
          />
          <span>全部</span>
        </label>
        <div className="mt-1 max-h-64 space-y-0.5 overflow-auto border-t pt-1">
          {options.map((name) => {
            const checked = selected?.includes(name) ?? false
            return (
              <label key={name} className="flex items-start gap-2 rounded px-1 py-1 text-xs hover:bg-muted">
                <input
                  type="checkbox"
                  className="mt-0.5 shrink-0"
                  checked={checked}
                  onChange={() => {
                    const current = selected ?? []
                    const next = checked ? current.filter((item) => item !== name) : [...current, name]
                    onChange(next.length === 0 || next.length === options.length ? null : next)
                  }}
                />
                <span className="leading-4">{name}</span>
              </label>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const COLUMNS: { key: SortKey; label: string; align: "left" | "right" | "center"; title?: string; filter?: "fundName" | "companyName" }[] = [
  { key: "fundName", label: "私募基金", align: "left", filter: "fundName" },
  { key: "companyName", label: "期货公司", align: "left", filter: "companyName" },
  { key: "accountNo", label: "账号", align: "left" },
  { key: "nav", label: "净值曲线", align: "center", title: "按累计收益率排序。分组与合计不画曲线。" },
  { key: "equity", label: "动态权益", align: "right" },
  { key: "margin", label: "保证金", align: "right" },
  { key: "totalPl", label: "当日盈亏", align: "right", title: "客户权益差减去出入金，与净值曲线当日盈亏一致。浮动盈亏+平仓盈亏" },
  { key: "holdingPl", label: "浮动盈亏", align: "right", title: "当日浮动变动 = 当日盈亏 − 平仓盈亏（含手续费等，不是结算单持仓浮动水平）" },
  { key: "closedPl", label: "平仓盈亏", align: "right", title: "结算单当日平仓盈亏" },
  { key: "riskPct", label: "风险度", align: "right", title: "合计与分组按保证金合计 / 动态权益合计" },
  { key: "unilateralRiskPct", label: "单边风险度", align: "right", title: "合计与分组按动态权益加权" },
  { key: "commission", label: "手续费", align: "right" },
]

export function AccountOverviewTable({ onSelectAccount }: { onSelectAccount?: (selectKey: string) => void }) {
  const [rows, setRows] = useState<OverviewRow[]>([])
  const [loading, setLoading] = useState(true)
  const [groupBy, setGroupBy] = useState<GroupBy>("none")
  const [sortKey, setSortKey] = useState<SortKey>("fundName")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [fundFilter, setFundFilter] = useState<string[] | null>(null)
  const [companyFilter, setCompanyFilter] = useState<string[] | null>(null)

  useEffect(() => {
    let stop = false
    setLoading(true)
    fetch("/ma/api/account-risk/account-overview")
      .then((r) => r.json())
      .then((j: { ok?: boolean; rows?: OverviewRow[] }) => {
        if (stop) return
        setRows(j.rows ?? [])
      })
      .catch(() => {
        if (stop) return
        setRows([])
      })
      .finally(() => {
        if (!stop) setLoading(false)
      })
    return () => { stop = true }
  }, [])

  const fundOptions = useMemo(() => uniqueNames(rows, "fundName"), [rows])
  const companyOptions = useMemo(() => uniqueNames(rows, "companyName"), [rows])
  const filteredRows = useMemo(() => rows.filter((row) => {
    const fund = displayName(row.fundName || "")
    const company = displayName(row.companyName || "")
    if (fundFilter && !fundFilter.includes(fund)) return false
    if (companyFilter && !companyFilter.includes(company)) return false
    return true
  }), [rows, fundFilter, companyFilter])
  const asOf = filteredRows.reduce((max, row) => (row.tradeDate > max ? row.tradeDate : max), "")
  const tableRows = useMemo(() => {
    const grouped = groupRows(filteredRows, groupBy)
    return [...grouped].sort((a, b) => {
      const cmp = compareValues(sortValue(a, sortKey), sortValue(b, sortKey), sortDir)
      if (cmp !== 0) return cmp
      return String(a.fundName).localeCompare(String(b.fundName), "zh-CN")
        || String(a.sortAccount).localeCompare(String(b.sortAccount), "zh-CN")
    })
  }, [filteredRows, groupBy, sortKey, sortDir])
  const totalRow = useMemo(
    () => (filteredRows.length > 0 ? toTableRow(filteredRows, "fund", "合计") : null),
    [filteredRows],
  )

  function onSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    setSortDir(TEXT_SORT_KEYS.has(key) ? "asc" : "desc")
  }

  return (
    <>
      <div id="section-product" className="flex items-center gap-2 mb-3" style={{ scrollMarginTop: "3rem" }}>
        <h2 className="text-sm font-semibold whitespace-nowrap">账户明细</h2>
        <div className="h-px flex-1 bg-border" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
          分类汇总
          <select
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as GroupBy)}
            className="rounded border border-input bg-background px-2 py-0.5 text-xs text-foreground"
          >
            <option value="none">不汇总</option>
            <option value="fund">私募基金</option>
            <option value="company">期货公司</option>
          </select>
        </label>
        {asOf && <span className="text-xs text-muted-foreground tabular-nums">截至 {asOf}</span>}
      </div>
      <Card>
        <CardContent className="px-3 py-3">
          {loading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">加载中…</div>
          ) : rows.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">暂无账户数据</div>
          ) : (
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card shadow-sm">
                  <tr className="border-b text-left">
                    {COLUMNS.map((col) => {
                      const active = sortKey === col.key
                      return (
                        <th
                          key={col.key}
                          title={col.title}
                          aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                          className={`px-2 py-1.5 font-medium ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}
                        >
                          <span className={`inline-flex items-center gap-0.5 ${col.align === "right" ? "flex-row-reverse" : ""}`}>
                            <button
                              type="button"
                              onClick={() => onSort(col.key)}
                              className={`inline-flex items-center gap-0.5 hover:text-foreground ${col.align === "right" ? "flex-row-reverse" : ""}`}
                            >
                              {col.label}
                              {active
                                ? (sortDir === "asc"
                                  ? <ChevronUp className="h-3 w-3 shrink-0" />
                                  : <ChevronDown className="h-3 w-3 shrink-0" />)
                                : <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />}
                            </button>
                            {col.filter === "fundName" && (
                              <ColumnValueFilter options={fundOptions} selected={fundFilter} onChange={setFundFilter} />
                            )}
                            {col.filter === "companyName" && (
                              <ColumnValueFilter options={companyOptions} selected={companyFilter} onChange={setCompanyFilter} />
                            )}
                          </span>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length} className="px-2 py-6 text-center text-muted-foreground">无匹配账户</td>
                    </tr>
                  ) : tableRows.map((row) => (
                    <tr key={row.key} className="border-b">
                      <AccountCells row={row} onSelectAccount={onSelectAccount} />
                    </tr>
                  ))}
                </tbody>
                {totalRow && (
                  <tfoot>
                    <tr className="border-t bg-muted/40 font-medium">
                      <AccountCells row={{ ...totalRow, fundName: "合计", companyName: "—", selectKey: "" }} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
