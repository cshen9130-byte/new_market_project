"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  Heart,
  LayoutTemplate,
  LineChart,
  PlusCircle,
  Search,
} from "lucide-react"

interface ProductRow {
  beian_hao: string
  product_name: string
  strategy_l1: string | null
  strategy_l2: string | null
  inception_date: string | null
  benchmark: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  latest_nav: string | null
  latest_nav_date: string | null
}

type SortKey =
  | "product_name"
  | "latest_nav"
  | "ret_1w"
  | "ret_1m"
  | "ret_3m"
  | "ret_6m"
  | "ret_1y"
  | "sharpe_1y"
  | "calmar_1y"
  | "inception_date"

type SortDir = "asc" | "desc"

const MGMT_TYPES = ["全部", "受托管理类", "顾问管理类"] as const
const DEFAULT_STRATEGIES = ["全部", "股票策略", "股票多头", "套利策略", "多资产策略", "组合策略", "期货策略"] as const

function fmtNum(v: string | null, decimals = 4) {
  if (!v) return "—"
  const n = parseFloat(v)
  return Number.isNaN(n) ? "—" : n.toFixed(decimals)
}

function fmtPct(v: string | null) {
  if (!v) return "—"
  const n = parseFloat(v)
  if (Number.isNaN(n)) return "—"
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"
}

function PctCell({ value }: { value: string | null }) {
  const text = fmtPct(value)
  if (text === "—") return <span className="text-zinc-400">—</span>
  const n = parseFloat(value!)
  return <span className={n > 0 ? "text-red-500" : n < 0 ? "text-emerald-600" : ""}>{text}</span>
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-40 inline-block" />
  return sortDir === "asc"
    ? <ChevronUp className="h-3 w-3 ml-1 inline-block" />
    : <ChevronDown className="h-3 w-3 ml-1 inline-block" />
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-2.5 py-0.5 rounded text-xs whitespace-nowrap transition-colors border",
        active
          ? "bg-red-50 text-red-600 border-red-200 font-medium"
          : "bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300 hover:text-zinc-800",
      ].join(" ")}
    >
      {label}
    </button>
  )
}

export const FundCompanyProductList = memo(function FundCompanyProductList({
  beian_hao,
}: {
  beian_hao: string
}) {
  const [data, setData] = useState<ProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [strategies, setStrategies] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [sortKey, setSortKey] = useState<SortKey>("product_name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [keyword, setKeyword] = useState("")
  const [keywordInput, setKeywordInput] = useState("")
  const [mgmtType, setMgmtType] = useState<string>("全部")
  const [strategy, setStrategy] = useState("全部")
  const [operatingOnly, setOperatingOnly] = useState(true)
  const [cutoffDate, setCutoffDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [jumpVal, setJumpVal] = useState("")
  const [favorites, setFavorites] = useState<Set<string>>(new Set())

  const strategyOptions = useMemo(() => {
    const merged = new Set<string>(["全部"])
    for (const s of DEFAULT_STRATEGIES) merged.add(s)
    for (const s of strategies) if (s) merged.add(s)
    return Array.from(merged)
  }, [strategies])

  const loadData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortKey,
      dir: sortDir,
      cutoff: cutoffDate,
    })
    if (keyword) params.set("keyword", keyword)
    if (strategy !== "全部") params.set("strategy", strategy)

    fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/company/products?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("加载失败")
        return res.json()
      })
      .then((json) => {
        setData(json.data ?? [])
        setTotal(json.total ?? 0)
        setTotalPages(json.totalPages ?? 1)
        if (Array.isArray(json.strategies)) setStrategies(json.strategies)
        setSelected(new Set())
      })
      .catch(() => {
        setData([])
        setTotal(0)
        setTotalPages(1)
      })
      .finally(() => setLoading(false))
  }, [beian_hao, page, pageSize, sortKey, sortDir, keyword, strategy, cutoffDate])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { setPage(1) }, [keyword, strategy, mgmtType, operatingOnly, cutoffDate, pageSize])

  function handleSort(col: SortKey) {
    if (col === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(col)
      setSortDir("desc")
    }
    setPage(1)
  }

  function toggleAll() {
    if (selected.size === data.length) setSelected(new Set())
    else setSelected(new Set(data.map((r) => r.beian_hao)))
  }

  function toggleFavorite(id: string) {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function jumpTo() {
    const n = parseInt(jumpVal, 10)
    if (!Number.isNaN(n) && n >= 1 && n <= totalPages) {
      setPage(n)
      setJumpVal("")
    }
  }

  function handleExport() {
    const escape = (v: string | null) => {
      if (!v) return ""
      return v.includes(",") || v.includes("\"") ? `"${v.replace(/"/g, "\"\"")}"` : v
    }
    const rows = selected.size > 0 ? data.filter((r) => selected.has(r.beian_hao)) : data
    const headers = [
      "产品名称", "备案编码", "成立日期", "单位净值", "净值日期",
      "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益",
      "近一年夏普比率", "近一年卡玛比率", "基准指数",
    ]
    const csv = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.product_name), escape(r.beian_hao), escape(r.inception_date),
        escape(r.latest_nav), escape(r.latest_nav_date),
        escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m), escape(r.ret_1y),
        escape(r.sharpe_1y), escape(r.calmar_1y), escape(r.benchmark),
      ].join(",")),
    ].join("\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `产品列表_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const pageButtons = (): (number | "…")[] => {
    const btns: (number | "…")[] = []
    const lo = Math.max(1, page - 2)
    const hi = Math.min(totalPages, page + 2)
    if (lo > 1) { btns.push(1); if (lo > 2) btns.push("…") }
    for (let i = lo; i <= hi; i++) btns.push(i)
    if (hi < totalPages) { if (hi < totalPages - 1) btns.push("…"); btns.push(totalPages) }
    return btns
  }

  const thBase = "px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap select-none"
  const thSort = thBase + " cursor-pointer hover:text-zinc-800 transition-colors"

  return (
    <div className="mt-4 rounded-xl border border-zinc-100 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-100">
        <h3 className="text-sm font-semibold text-zinc-800">产品列表</h3>
      </div>

      <div className="px-5 py-3 border-b border-zinc-100 space-y-2.5 text-xs">
        <div className="flex items-start gap-3 flex-wrap">
          <span className="text-zinc-500 shrink-0 pt-0.5 w-16">管理类型：</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {MGMT_TYPES.map((t) => (
              <FilterPill key={t} label={t} active={mgmtType === t} onClick={() => setMgmtType(t)} />
            ))}
          </div>
        </div>

        <div className="flex items-start gap-3 flex-wrap">
          <span className="text-zinc-500 shrink-0 pt-0.5 w-16">一级策略：</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            {strategyOptions.map((s) => (
              <FilterPill key={s} label={s} active={strategy === s} onClick={() => setStrategy(s)} />
            ))}
          </div>
          <label className="inline-flex items-center gap-1.5 ml-auto text-zinc-600 cursor-pointer">
            <input
              type="checkbox"
              checked={operatingOnly}
              onChange={(e) => setOperatingOnly(e.target.checked)}
              className="rounded h-3.5 w-3.5"
            />
            运作中
          </label>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") setKeyword(keywordInput.trim()) }}
              placeholder="输入产品名称或备案号搜索"
              className="w-full pl-8 pr-3 py-1.5 border border-zinc-200 rounded bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-red-300"
            />
          </div>

          <div className="flex items-center gap-1.5 text-zinc-600 ml-auto">
            <span>数据计算截止日期：</span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowDatePicker((v) => !v)}
                className="inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-zinc-600 hover:text-zinc-900 transition-colors"
              >
                <CalendarDays className="h-3 w-3" />
                <span className="tabular-nums">{cutoffDate}</span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {showDatePicker && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowDatePicker(false)} />
                  <div className="absolute right-0 top-full mt-1 z-40 bg-white border rounded-lg shadow-lg p-3">
                    <input
                      type="date"
                      value={cutoffDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => {
                        if (e.target.value) {
                          setCutoffDate(e.target.value)
                          setShowDatePicker(false)
                        }
                      }}
                      className="border rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-red-300"
                      autoFocus
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 px-5 py-2 border-b border-zinc-100 bg-zinc-50/30">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 transition-colors bg-white border border-zinc-200 rounded-lg px-2.5 py-1 text-xs"
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          默认视图
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 transition-colors bg-white border border-zinc-200 rounded-lg px-2.5 py-1 text-xs opacity-60 cursor-not-allowed"
          disabled
        >
          <PlusCircle className="h-3.5 w-3.5" />
          添加指标
        </button>
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 transition-colors bg-white border border-zinc-200 rounded-lg px-2.5 py-1 text-xs"
        >
          <Download className="h-3.5 w-3.5" />
          {selected.size > 0 ? `导出(${selected.size})` : "导出"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1380 }}>
          <thead>
            <tr className="bg-zinc-50/80 border-b border-zinc-100">
              <th className={`${thBase} w-9 px-2`}>
                <input type="checkbox" className="rounded h-3 w-3" checked={selected.size === data.length && data.length > 0} onChange={toggleAll} />
              </th>
              <th className={`${thBase} w-10 text-center`}>序号</th>
              <th className={`${thSort} min-w-[180px]`} onClick={() => handleSort("product_name")}>
                产品名称<SortIcon col="product_name" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className={`${thSort} min-w-[96px]`} onClick={() => handleSort("inception_date")}>
                成立日期<SortIcon col="inception_date" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className={`${thSort} min-w-[88px]`} onClick={() => handleSort("latest_nav")}>
                单位净值<SortIcon col="latest_nav" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1w")}>近一周收益<SortIcon col="ret_1w" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1m")}>近一月收益<SortIcon col="ret_1m" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_3m")}>近三月收益<SortIcon col="ret_3m" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_6m")}>近六月收益<SortIcon col="ret_6m" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1y")}>近一年收益<SortIcon col="ret_1y" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={`${thSort} text-right min-w-[98px]`} onClick={() => handleSort("sharpe_1y")}>近一年夏普比率<SortIcon col="sharpe_1y" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={`${thSort} text-right min-w-[98px]`} onClick={() => handleSort("calmar_1y")}>近一年卡玛比率<SortIcon col="calmar_1y" sortKey={sortKey} sortDir={sortDir} /></th>
              <th className={`${thBase} min-w-[100px]`}>基准指数</th>
              <th className={`${thBase} text-center w-14`}>走势</th>
              <th className={`${thBase} text-center w-14`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={15} className="py-16 text-center text-zinc-400">加载中…</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={15} className="py-16 text-center text-zinc-400">暂无数据</td></tr>
            ) : data.map((row, i) => (
              <tr key={row.beian_hao} className="border-b border-zinc-50 hover:bg-zinc-50/40 transition-colors">
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    className="rounded h-3 w-3"
                    checked={selected.has(row.beian_hao)}
                    onChange={() => {
                      const next = new Set(selected)
                      if (next.has(row.beian_hao)) next.delete(row.beian_hao)
                      else next.add(row.beian_hao)
                      setSelected(next)
                    }}
                  />
                </td>
                <td className="px-2 py-2 text-center text-zinc-500 tabular-nums">{(page - 1) * pageSize + i + 1}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beian_hao)}`}
                    className="font-medium text-blue-600 hover:underline leading-5 block truncate max-w-[220px]"
                    title={row.product_name}
                  >
                    {row.product_name}
                  </Link>
                  {(row.strategy_l1 || row.strategy_l2) && (
                    <div className="text-[10px] text-zinc-400 mt-0.5 truncate">
                      {row.strategy_l1 ?? row.strategy_l2}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-zinc-700 whitespace-nowrap">{row.inception_date ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">
                  <div className="font-medium text-zinc-800">{fmtNum(row.latest_nav, 4)}</div>
                  {row.latest_nav_date && <div className="text-[10px] text-zinc-400">{row.latest_nav_date}</div>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums"><PctCell value={row.ret_1w} /></td>
                <td className="px-3 py-2 text-right tabular-nums"><PctCell value={row.ret_1m} /></td>
                <td className="px-3 py-2 text-right tabular-nums"><PctCell value={row.ret_3m} /></td>
                <td className="px-3 py-2 text-right tabular-nums"><PctCell value={row.ret_6m} /></td>
                <td className="px-3 py-2 text-right tabular-nums"><PctCell value={row.ret_1y} /></td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{fmtNum(row.sharpe_1y, 2)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{fmtNum(row.calmar_1y, 2)}</td>
                <td className="px-3 py-2 text-zinc-700 truncate max-w-[120px]" title={row.benchmark ?? ""}>{row.benchmark ?? "—"}</td>
                <td className="px-2 py-2 text-center">
                  <Link
                    href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beian_hao)}`}
                    className="inline-flex p-1 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 transition-colors"
                  >
                    <LineChart className="h-3.5 w-3.5" />
                  </Link>
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(row.beian_hao)}
                    className="inline-flex p-1 rounded hover:bg-zinc-100 text-zinc-400 hover:text-red-500 transition-colors"
                  >
                    <Heart className={`h-3.5 w-3.5 ${favorites.has(row.beian_hao) ? "fill-red-500 text-red-500" : ""}`} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-100 text-xs text-zinc-600">
        <span>共 {total} 条</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded border hover:bg-zinc-50 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ‹
          </button>
          {pageButtons().map((btn, idx) =>
            btn === "…" ? (
              <span key={`e${idx}`} className="w-7 h-7 flex items-center justify-center text-zinc-400">…</span>
            ) : (
              <button
                key={btn}
                type="button"
                onClick={() => setPage(btn as number)}
                className={[
                  "w-7 h-7 flex items-center justify-center rounded border transition-colors",
                  btn === page ? "bg-red-500 text-white border-red-500 font-medium" : "hover:bg-zinc-50 border-zinc-200",
                ].join(" ")}
              >
                {btn}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || totalPages <= 1}
            className="w-7 h-7 flex items-center justify-center rounded border hover:bg-zinc-50 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ›
          </button>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
            className="ml-2 border rounded px-1.5 py-1 text-xs bg-white outline-none"
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>{n} 条/页</option>
            ))}
          </select>
          <div className="flex items-center gap-1 ml-1">
            <span>跳至</span>
            <input
              className="w-10 h-7 border rounded text-center outline-none focus:ring-1 focus:ring-red-300"
              value={jumpVal}
              onChange={(e) => setJumpVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") jumpTo() }}
            />
            <span>页</span>
          </div>
        </div>
      </div>
    </div>
  )
})
