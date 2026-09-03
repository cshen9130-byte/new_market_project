"use client"

import { useMemo, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { ChevronDown, Clock, Download, Info, Search, SquarePen } from "lucide-react"
import { ProductSelectionPanel } from "@/components/ma/product-selection-panel"
import { normalizeFofDisplayName } from "@/lib/fof-portfolio-var"
import {
  applyValuationHoldingDisplayName,
  isValuationCashHoldingName,
} from "@/lib/valuation-holding-display-name"
import type { StrategyPieSelection } from "./FofStrategyPiesPanel"

const FofStrategyPiesPanel = dynamic(
  () => import("./FofStrategyPiesPanel").then((m) => m.FofStrategyPiesPanel),
  { ssr: false },
)

export type FundHoldingRow = {
  index: number
  fundName: string
  valuationCode: string | null
  fundStrategy: string | null
  strategyL1?: string | null
  strategyL2?: string | null
  strategyL3?: string | null
  navDate: string | null
  virtualUnitNav: number | null
  unitNav: number | null
  cumulativeNav: number | null
  priceChangePct: number | null
  price: number | null
  marketValue: number
  marketPct: number
  shares: number | null
  cost: number | null
  unrealizedPnl: number | null
  settlementStatus: string
  suspensionInfo: string
  beianHao: string | null
  rowKind: string
}

/** Returns true if the holding row should be treated as a stock/equity rather than a fund. */
function isStockRow(row: FundHoldingRow): boolean {
  if (/ETF/u.test(row.fundName)) return false
  if (row.rowKind === "stock") return true
  if (row.rowKind === "fund_or_stock") {
    // If valuationCode is a 6-digit numeric A-share ticker → stock
    const code = (row.valuationCode ?? "").replace(/\.(SZ|SH|BJ)$/i, "").trim()
    if (/^\d{6}$/.test(code)) return true
    // If there is no code AND no resolved fund registration number,
    // it is almost certainly a direct equity holding, not a fund.
    if (!row.valuationCode && !row.beianHao) return true
  }
  return false
}

function isCashOrNonFundRow(row: FundHoldingRow): boolean {
  if (["bank_deposit", "settlement_reserve", "margin_deposit", "payable", "clearing"].includes(row.rowKind)) {
    return true
  }
  return isValuationCashHoldingName(row.fundName)
}

function displayFundName(row: FundHoldingRow): string {
  const stripped = applyValuationHoldingDisplayName(row.fundName, row.valuationCode ?? row.beianHao)
    || row.fundName
  return normalizeFofDisplayName(stripped)
}

type Props = {
  rows: FundHoldingRow[]
  valuationDate: string | null
  displayName: string
}

type SortKey = "marketValue" | "marketPct" | "shares" | "cumulativeNav"

function fmtMoney(n: number): string {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n: number): string {
  return `${n.toFixed(4)}%`
}

function fmtNav(n: number | null): string {
  if (n == null) return "—"
  return n.toFixed(4)
}

function fmtShares(n: number | null): string {
  if (n == null) return "—"
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPrice(n: number | null): string {
  if (n == null) return "—"
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function fmtQty(n: number | null): string {
  if (n == null) return "—"
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 0 })
}

function PctCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-zinc-400">—</span>
  const cls = value > 0 ? "text-red-500" : value < 0 ? "text-emerald-600" : "text-zinc-600"
  return <span className={cls}>{value > 0 ? "+" : ""}{value.toFixed(2)}%</span>
}

function fundDetailHref(row: FundHoldingRow): string {
  const id = row.beianHao || row.valuationCode || row.fundName
  return `/ma/dashboard/private-funds/${encodeURIComponent(id)}`
}

function FundNameLink({ row }: { row: FundHoldingRow }) {
  const name = displayFundName(row)
  return (
    <a
      href={fundDetailHref(row)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:underline block truncate"
      title={name}
    >
      {name}
    </a>
  )
}

function SortTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string
  sortKey: SortKey
  activeKey: SortKey | null
  dir: "asc" | "desc"
  onSort: (key: SortKey) => void
}) {
  const active = activeKey === sortKey
  return (
    <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-0.5 hover:text-zinc-700">
        {label}
        <span className="text-[10px] text-zinc-300">{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  )
}

function StockHoldingsTable({
  rows,
  valuationDate,
  displayName,
  onExport,
}: {
  rows: FundHoldingRow[]
  valuationDate: string | null
  displayName: string
  onExport: (exportRows: FundHoldingRow[]) => void
}) {
  const [keyword, setKeyword] = useState("")
  const [sortKey, setSortKey] = useState<StockSortKey | null>("marketValue")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const dateLabel = valuationDate?.slice(0, 10) ?? "—"
  const VISIBLE_ROWS = 10
  const ROW_HEIGHT_PX = 42
  const TOP_N = 50

  const filtered = useMemo(() => {
    let list = [...rows]
      .sort((a, b) => Math.abs(b.marketValue) - Math.abs(a.marketValue))
      .slice(0, TOP_N)
    const q = keyword.trim().toLowerCase()
    if (q) {
      list = list.filter((r) =>
        r.fundName.toLowerCase().includes(q)
        || (r.valuationCode ?? "").toLowerCase().includes(q),
      )
    }
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = a[sortKey] ?? 0
        const bv = b[sortKey] ?? 0
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av)
      })
    }
    return list.map((row, i) => ({ ...row, index: i + 1 }))
  }, [rows, keyword, sortKey, sortDir])

  function handleSort(key: StockSortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  return (
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-zinc-100">
        <div>
          <div className="text-amber-600 font-semibold text-sm leading-tight">Top50 股票持仓</div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-0.5">
            <span className="text-zinc-600">FOF底层</span>
            <Clock className="h-3 w-3" />
            <span>{dateLabel}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onExport(filtered)}
          disabled={!filtered.length}
          className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          导出
        </button>
      </div>

      <div className="flex justify-end px-4 py-2">
        <div className="relative">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            placeholder="请输入关键字，按回车搜索"
            className="border border-zinc-200 rounded pl-3 pr-8 py-1.5 text-xs w-56 bg-white focus:outline-none focus:border-amber-300"
          />
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
        </div>
      </div>

      <div className="overflow-x-auto border-t border-zinc-100">
        <div
          className="overflow-y-auto"
          style={{ maxHeight: filtered.length > VISIBLE_ROWS ? ROW_HEIGHT_PX * VISIBLE_ROWS + 40 : undefined }}
        >
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-zinc-50 shadow-[0_1px_0_0_rgb(244_244_245)]">
              <tr className="border-b border-zinc-100 text-xs">
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-12">序号</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[140px]">资产名称</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 min-w-[100px]">估值表代码</th>
                <StockSortTh label="数量" sortKey="shares" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <StockSortTh label="市价" sortKey="price" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <StockSortTh label="市值" sortKey="marketValue" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <StockSortTh label="市值占比" sortKey="marketPct" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <StockSortTh label="成本" sortKey="cost" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <StockSortTh
                  label="估值增值"
                  sortKey="unrealizedPnl"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                  extra={<Info className="h-3 w-3 text-zinc-300" />}
                />
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 whitespace-nowrap min-w-[100px]">结算状态</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-zinc-400">
                    无匹配结果
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr
                    key={`${row.valuationCode ?? row.fundName}-${row.index}`}
                    className="border-b border-zinc-50 hover:bg-zinc-50/50"
                    style={{ height: ROW_HEIGHT_PX }}
                  >
                    <td className="px-3 py-2.5 text-zinc-500 tabular-nums">{row.index}</td>
                    <td className="px-3 py-2.5 text-zinc-800">{row.fundName}</td>
                    <td className="px-3 py-2.5 text-zinc-600 font-mono text-xs whitespace-nowrap">{row.valuationCode ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtQty(row.shares)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtPrice(row.price)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">{fmtMoney(row.marketValue)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{fmtPct(row.marketPct)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-zinc-800">
                      {row.cost != null ? fmtMoney(row.cost) : "—"}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${
                      (row.unrealizedPnl ?? 0) >= 0 ? "text-red-500" : "text-emerald-600"
                    }`}>
                      {row.unrealizedPnl != null ? fmtMoney(row.unrealizedPnl) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-600 whitespace-nowrap">{row.settlementStatus || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

type StockSortKey = "shares" | "price" | "marketValue" | "marketPct" | "cost" | "unrealizedPnl"

function StockSortTh({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  extra,
}: {
  label: string
  sortKey: StockSortKey
  activeKey: StockSortKey | null
  dir: "asc" | "desc"
  onSort: (key: StockSortKey) => void
  extra?: ReactNode
}) {
  const active = activeKey === sortKey
  return (
    <th className="px-3 py-2.5 text-right font-semibold text-zinc-500 whitespace-nowrap">
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-0.5 hover:text-zinc-700">
        {label}
        {extra}
        <span className="text-[10px] text-zinc-300">{active ? (dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  )
}

function holdingMatchesPie(row: FundHoldingRow, selection: StrategyPieSelection): boolean {
  if (!selection.l1) return true
  const fromPath = (row.fundStrategy ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
  const l1 = row.strategyL1?.trim() || fromPath[0] || "未配置"
  const l2 = row.strategyL2?.trim() || fromPath[1] || "未配置"
  const l3s = (row.strategyL3 ?? "")
    .split(/[，,、]/)
    .map((part) => part.trim())
    .filter(Boolean)
  const l3Labels = l3s.length > 0 ? l3s : ["未配置"]
  if (l1 !== selection.l1) return false
  if (selection.l2 && l2 !== selection.l2) return false
  if (selection.l3) {
    if (l3Labels.includes(selection.l3)) return true
    if (l3Labels.length === 1 && l3Labels[0] === "未配置" && row.fundName === selection.l3) return true
    return false
  }
  return true
}

export function FofFundsPanel({ rows, valuationDate, displayName }: Props) {
  const [strategyTab, setStrategyTab] = useState<string>("全部")
  const [pieSelection, setPieSelection] = useState<StrategyPieSelection>({ l1: null, l2: null, l3: null })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey | null>("marketValue")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const fundOnlyRows = useMemo(
    () => rows
      .filter((r) => !isStockRow(r) && !isCashOrNonFundRow(r))
      .map((r) => ({ ...r, fundName: displayFundName(r) })),
    [rows],
  )
  const stockOnlyRows = useMemo(() => rows.filter((r) => isStockRow(r)), [rows])

  const strategyTabs = useMemo(() => {
    const configured = [...new Set(fundOnlyRows.map((r) => r.fundStrategy).filter(Boolean))] as string[]
    return ["全部", ...configured, "未配置"]
  }, [fundOnlyRows])

  const filtered = useMemo(() => {
    let list = fundOnlyRows
    if (strategyTab === "未配置") {
      list = list.filter((r) => !r.fundStrategy)
    } else if (strategyTab !== "全部") {
      list = list.filter((r) => r.fundStrategy === strategyTab)
    }
    if (pieSelection.l1) {
      list = list.filter((r) => holdingMatchesPie(r, pieSelection))
    }
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = a[sortKey] ?? 0
        const bv = b[sortKey] ?? 0
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av)
      })
    }
    return list.map((row, i) => ({ ...row, index: i + 1 }))
  }, [fundOnlyRows, strategyTab, pieSelection, sortKey, sortDir])

  const totalMarketValue = filtered.reduce((s, r) => s + r.marketValue, 0)
  const totalMarketPct = filtered.reduce((s, r) => s + r.marketPct, 0)
  const dateLabel = valuationDate?.slice(0, 10) ?? "—"
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.index))
  const selectedPanelItems = useMemo(
    () =>
      filtered
        .filter((r) => selected.has(r.index))
        .map((r) => ({ id: String(r.index), product_name: r.fundName })),
    [filtered, selected],
  )

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(filtered.map((r) => r.index)))
  }

  function toggleRow(index: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function handleExport() {
    const exportRows = selected.size > 0
      ? filtered.filter((r) => selected.has(r.index))
      : filtered
    if (!exportRows.length) return
    const lines = [
      [
        "序号", "基金名称", "估值表代码", "基金策略", "净值日期",
        "虚拟单位净值", "涨跌幅", "单位净值", "累计净值", "市值占比", "市值", "份额", "停牌信息",
      ].join(","),
      ...exportRows.map((r) =>
        [
          r.index,
          r.fundName,
          r.valuationCode ?? "",
          r.fundStrategy ?? "",
          r.navDate ?? "",
          r.virtualUnitNav?.toFixed(4) ?? "",
          r.priceChangePct?.toFixed(2) ?? "",
          r.unitNav?.toFixed(4) ?? "",
          r.cumulativeNav?.toFixed(4) ?? "",
          r.marketPct.toFixed(4),
          r.marketValue.toFixed(2),
          r.shares?.toFixed(2) ?? "",
          r.suspensionInfo,
        ].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_基金_${dateLabel}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function handleExportStocks(exportRows: FundHoldingRow[]) {
    if (!exportRows.length) return
    const lines = [
      [
        "序号", "资产名称", "估值表代码", "数量", "市价", "市值", "市值占比", "成本", "估值增值", "结算状态",
      ].join(","),
      ...exportRows.map((r) =>
        [
          r.index,
          r.fundName,
          r.valuationCode ?? "",
          r.shares ?? "",
          r.price ?? "",
          r.marketValue.toFixed(2),
          r.marketPct.toFixed(4),
          r.cost?.toFixed(2) ?? "",
          r.unrealizedPnl?.toFixed(2) ?? "",
          r.settlementStatus,
        ].join(","),
      ),
    ]
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${displayName}_Top50股票持仓_${dateLabel}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
  <>
    <FofStrategyPiesPanel
      rows={fundOnlyRows}
      selection={pieSelection}
      onSelectionChange={(next) => {
        setPieSelection(next)
        if (next.l1) setStrategyTab("全部")
      }}
    />
    <div className="mt-4 bg-white rounded-lg border border-zinc-100 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div>
          <div className="text-red-500 font-semibold text-sm leading-tight">基金</div>
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-0.5">
            <span className="text-zinc-600">FOF底层</span>
            <Clock className="h-3 w-3" />
            <span>{dateLabel}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!filtered.length}
          className="inline-flex items-center px-3 py-1 text-xs font-medium bg-red-500 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-40"
        >
          导出
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 border-b border-zinc-100">
        <div className="relative">
          <select
            defaultValue="company"
            className="h-7 min-w-[5.5rem] appearance-none rounded border border-zinc-200 bg-white pl-2 pr-6 text-xs text-zinc-600 focus:outline-none focus:border-red-300"
          >
            <option value="company">团队策略</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
        </div>
        {strategyTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => {
              setStrategyTab(tab)
              setPieSelection({ l1: null, l2: null, l3: null })
            }}
            className={[
              "px-2.5 py-1 rounded text-xs border transition-colors whitespace-nowrap",
              strategyTab === tab
                ? "bg-red-500 text-white border-red-500"
                : "border-red-400 text-red-500 hover:bg-red-50",
            ].join(" ")}
          >
            {tab}
          </button>
        ))}
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-100 bg-zinc-50">
            <th className="px-2 py-2 w-8">
              <input
                type="checkbox"
                className="rounded h-3 w-3"
                checked={allSelected}
                onChange={toggleAll}
              />
            </th>
            <th className="px-2 py-2 text-left font-semibold text-zinc-500 w-10">序号</th>
            <th className="px-2 py-2 text-left font-semibold text-zinc-500 min-w-[140px]">基金名称</th>
            <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">估值表代码</th>
            <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">基金策略</th>
            <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap">净值日期</th>
            <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">
              虚拟单位净值 <span className="text-zinc-300 font-normal">①</span>
            </th>
            <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">
              涨跌幅 <span className="text-zinc-300 font-normal">②</span>
            </th>
            <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">
              单位净值 <span className="text-zinc-300 font-normal">③</span>
            </th>
            <th className="px-2 py-2 text-right font-semibold text-zinc-500 whitespace-nowrap">
              <button
                type="button"
                onClick={() => handleSort("cumulativeNav")}
                className="inline-flex items-center gap-0.5 hover:text-zinc-700"
              >
                累计净值
                <span className="text-[10px] text-zinc-300">
                  {sortKey === "cumulativeNav" ? (sortDir === "asc" ? "↑" : "↓") : "∨"}
                </span>
              </button>
            </th>
            <SortTh label="市值占比" sortKey="marketPct" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortTh label="市值" sortKey="marketValue" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <SortTh label="份额" sortKey="shares" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
            <th className="px-2 py-2 text-left font-semibold text-zinc-500 whitespace-nowrap min-w-[100px]">停牌信息</th>
            <th className="px-2 py-2 text-center font-semibold text-zinc-500 w-12">操作</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={15} className="px-4 py-8 text-center text-sm text-zinc-400">
                {fundOnlyRows.length === 0 ? "暂无基金持仓" : "无匹配结果"}
              </td>
            </tr>
          ) : (
            <>
              {filtered.map((row) => (
                <tr key={`${row.fundName}-${row.index}`} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      className="rounded h-3 w-3"
                      checked={selected.has(row.index)}
                      onChange={() => toggleRow(row.index)}
                    />
                  </td>
                  <td className="px-2 py-2 text-zinc-500 tabular-nums">{row.index}</td>
                  <td className="px-2 py-2 min-w-0">
                    <FundNameLink row={row} />
                  </td>
                  <td className="px-2 py-2 text-zinc-600 tabular-nums whitespace-nowrap">{row.valuationCode ?? "—"}</td>
                  <td className="px-2 py-2 text-zinc-600 whitespace-nowrap">{row.fundStrategy ?? "—"}</td>
                  <td className="px-2 py-2 text-zinc-600 tabular-nums whitespace-nowrap">{row.navDate ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-800 whitespace-nowrap">{fmtNav(row.virtualUnitNav)}</td>
                  <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap"><PctCell value={row.priceChangePct} /></td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-800 whitespace-nowrap">{fmtNav(row.unitNav)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-800 whitespace-nowrap">{fmtNav(row.cumulativeNav)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-600 whitespace-nowrap">{fmtPct(row.marketPct)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-800 whitespace-nowrap">{fmtMoney(row.marketValue)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-zinc-800 whitespace-nowrap">{fmtShares(row.shares)}</td>
                  <td className="px-2 py-2 text-zinc-500 whitespace-nowrap truncate max-w-[120px]" title={row.suspensionInfo}>
                    {row.suspensionInfo}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <a
                      href={fundDetailHref(row)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center text-zinc-400 hover:text-zinc-600"
                      title="查看详情"
                    >
                      <SquarePen className="h-3.5 w-3.5" />
                    </a>
                  </td>
                </tr>
              ))}
              <tr className="bg-zinc-50 font-medium border-t border-zinc-100">
                <td className="px-2 py-2" colSpan={2} />
                <td className="px-2 py-2 text-zinc-600">合计</td>
                <td className="px-2 py-2" colSpan={7} />
                <td className="px-2 py-2 text-right tabular-nums text-zinc-600 whitespace-nowrap">{fmtPct(totalMarketPct)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-zinc-800 whitespace-nowrap">{fmtMoney(totalMarketValue)}</td>
                <td className="px-2 py-2" colSpan={3} />
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>

    {stockOnlyRows.length > 0 && (
      <StockHoldingsTable
        rows={stockOnlyRows}
        valuationDate={valuationDate}
        displayName={displayName}
        onExport={handleExportStocks}
      />
    )}

    <ProductSelectionPanel
      items={selectedPanelItems}
      onRemove={(id) => toggleRow(Number(id))}
      onClear={() => setSelected(new Set())}
    />
  </>
  )
}
