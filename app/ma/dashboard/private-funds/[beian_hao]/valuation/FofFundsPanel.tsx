"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Clock, SquarePen } from "lucide-react"

export type FundHoldingRow = {
  index: number
  fundName: string
  valuationCode: string | null
  fundStrategy: string | null
  navDate: string | null
  virtualUnitNav: number | null
  unitNav: number | null
  cumulativeNav: number | null
  priceChangePct: number | null
  marketValue: number
  marketPct: number
  shares: number | null
  suspensionInfo: string
  beianHao: string | null
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

function PctCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-zinc-400">—</span>
  const cls = value > 0 ? "text-red-500" : value < 0 ? "text-emerald-600" : "text-zinc-600"
  return <span className={cls}>{value > 0 ? "+" : ""}{value.toFixed(2)}%</span>
}

function fundDetailHref(row: FundHoldingRow): string {
  const id = row.beianHao || row.fundName
  return `/ma/dashboard/private-funds/${encodeURIComponent(id)}`
}

function FundNameLink({ row }: { row: FundHoldingRow }) {
  return (
    <a
      href={fundDetailHref(row)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:underline block truncate"
      title={row.fundName}
    >
      {row.fundName}
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

export function FofFundsPanel({ rows, valuationDate, displayName }: Props) {
  const [strategyTab, setStrategyTab] = useState<string>("全部")
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey | null>("marketValue")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const strategyTabs = useMemo(() => {
    const configured = [...new Set(rows.map((r) => r.fundStrategy).filter(Boolean))] as string[]
    return ["全部", ...configured, "未配置"]
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (strategyTab === "未配置") {
      list = list.filter((r) => !r.fundStrategy)
    } else if (strategyTab !== "全部") {
      list = list.filter((r) => r.fundStrategy === strategyTab)
    }
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = a[sortKey] ?? 0
        const bv = b[sortKey] ?? 0
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av)
      })
    }
    return list.map((row, i) => ({ ...row, index: i + 1 }))
  }, [rows, strategyTab, sortKey, sortDir])

  const totalMarketValue = filtered.reduce((s, r) => s + r.marketValue, 0)
  const totalMarketPct = filtered.reduce((s, r) => s + r.marketPct, 0)
  const dateLabel = valuationDate?.slice(0, 10) ?? "—"
  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.index))

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

  return (
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
            onClick={() => setStrategyTab(tab)}
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
                {rows.length === 0 ? "暂无基金持仓" : "无匹配结果"}
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
  )
}
