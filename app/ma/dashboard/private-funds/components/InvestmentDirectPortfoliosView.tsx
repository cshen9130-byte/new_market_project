"use client"

import { useEffect, useState } from "react"
import {
  CalendarDays,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Download,
  Inbox,
  LayoutTemplate,
  Pencil,
  Search,
  Settings2,
} from "lucide-react"
import { loadLocalPortfolioRows, sortPortfolioRows } from "@/lib/ma-portfolio-storage"

type SortKey =
  | "name"
  | "unit_nav"
  | "cumulative_return"
  | "ret_1w"
  | "ret_1m"
  | "ret_3m"
  | "ret_6m"
  | "ret_1y"
  | "vol_1y"
  | "calmar_1y"
  | "created_at"

interface PortfolioRow {
  id: string
  name: string
  unit_nav: string | null
  cumulative_return: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  vol_1y: string | null
  calmar_1y: string | null
  created_at: string | null
  isLocal?: boolean
}

interface AddedCol {
  id: string
  period: string
  metric: string
  label: string
}

const ADD_METRIC_PERIODS = [
  "本周", "本月", "近一周", "近一月", "近三月",
  "近六月", "近一年", "近两年", "近三年", "近五年",
  "今年以来", "成立以来",
]
const ADD_METRIC_GROUPS = [
  ["收益", "年化收益", "超额收益", "年化波动率", "夏普比率", "卡玛比率"],
  ["最大回撤", "索提诺比率", "下行标准差", "Alpha", "Beta", "信息比率"],
]

function loadMetricTemplates(): { name: string; items: { period: string; metric: string }[] }[] {
  if (typeof window === "undefined") return []
  try { return JSON.parse(localStorage.getItem("tracking_metric_templates") ?? "[]") } catch { return [] }
}

function fmtNum(v: string | null | undefined, decimals = 4): string {
  if (!v) return "—"
  const n = parseFloat(String(v).replace(/[+%,]/g, ""))
  return Number.isFinite(n) ? n.toFixed(decimals) : "—"
}

function fmtMoney(v: string | null | undefined): string {
  if (!v) return "—"
  const n = parseFloat(String(v).replace(/,/g, ""))
  if (!Number.isFinite(n)) return "—"
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function PctCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const raw = String(value).replace("%", "")
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return <span className="text-muted-foreground">—</span>
  const cls = n > 0 ? "text-red-500" : n < 0 ? "text-green-600" : "text-foreground"
  const prefix = value.includes("%") || Math.abs(n) <= 1 ? "" : ""
  const display = value.includes("%") ? value : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`
  return <span className={cls}>{prefix}{display}</span>
}

function RatioCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const n = parseFloat(value)
  if (!Number.isFinite(n)) return <span className="text-muted-foreground">—</span>
  return <span>{n.toFixed(4)}</span>
}

function localRowToDirectRow(row: ReturnType<typeof loadLocalPortfolioRows>[number]): PortfolioRow {
  return {
    id: row.id,
    name: row.name,
    unit_nav: row.unit_nav,
    cumulative_return: row.size,
    ret_1w: row.ret_1w,
    ret_1m: row.ret_1m,
    ret_3m: row.ret_3m,
    ret_6m: row.ret_6m,
    ret_1y: row.ret_1y,
    vol_1y: null,
    calmar_1y: row.calmar_1y,
    created_at: row.updated_at,
    isLocal: true,
  }
}

function AddMetricModal({
  initial,
  onConfirm,
  onClose,
}: {
  initial: AddedCol[]
  onConfirm: (cols: AddedCol[]) => void
  onClose: () => void
}) {
  const [selPeriod, setSelPeriod] = useState("近一月")
  const [selected, setSelected] = useState<AddedCol[]>(initial)

  function isChecked(metric: string) {
    return selected.some((c) => c.period === selPeriod && c.metric === metric)
  }

  function toggle(metric: string) {
    if (isChecked(metric)) {
      setSelected((s) => s.filter((c) => !(c.period === selPeriod && c.metric === metric)))
    } else {
      setSelected((s) => [...s, { id: `${selPeriod}__${metric}`, period: selPeriod, metric, label: `${selPeriod}${metric}` }])
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background border rounded-lg shadow-xl w-[720px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <span className="font-semibold text-sm">自定义指标</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 p-5 overflow-auto border-r">
            <div className="grid grid-cols-4 gap-y-2 gap-x-2 mb-5 pb-4 border-b">
              {ADD_METRIC_PERIODS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="radio" name="direct-portfolio-period" checked={selPeriod === p} onChange={() => setSelPeriod(p)} />
                  {p}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-6">
              {ADD_METRIC_GROUPS.map((grp, gi) => (
                <div key={gi} className="flex flex-col gap-y-3">
                  {grp.map((m) => (
                    <label key={m} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="checkbox" checked={isChecked(m)} onChange={() => toggle(m)} />
                      {m}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="w-48 p-4">
            <div className="text-xs text-muted-foreground mb-3">已选指标({selected.length})</div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {selected.map((c) => (
                <div key={c.id} className="text-xs truncate">{c.label}</div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-3 border-t">
          <button onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted">取消</button>
          <button onClick={() => onConfirm(selected)} className="px-4 py-1.5 rounded bg-red-500 text-white text-sm hover:bg-red-600">确定</button>
        </div>
      </div>
    </div>
  )
}

const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap select-none"
const thSort = `${thBase} cursor-pointer hover:text-foreground transition-colors`

export function InvestmentDirectPortfoliosView() {
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [cutoffDate, setCutoffDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PortfolioRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [addedCols, setAddedCols] = useState<AddedCol[]>([])
  const [showAddMetric, setShowAddMetric] = useState(false)
  const [showTemplateMenu, setShowTemplateMenu] = useState(false)
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null)
  const [metricTemplates, setMetricTemplates] = useState(() => loadMetricTemplates())
  const [localRefresh, setLocalRefresh] = useState(0)

  const pageSize = 50
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    const onUpdated = () => setLocalRefresh((n) => n + 1)
    window.addEventListener("ma-portfolios-updated", onUpdated)
    return () => window.removeEventListener("ma-portfolios-updated", onUpdated)
  }, [])

  useEffect(() => {
    setPage(1)
  }, [keyword, cutoffDate])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortKey,
      dir: sortDir,
      keyword,
      cutoff: cutoffDate,
    })
    fetch(`/ma/api/investment/direct-portfolios/list?${params}`)
      .then((r) => r.json())
      .then((json) => {
        const apiRows: PortfolioRow[] = json.data ?? []
        const localRows = loadLocalPortfolioRows(keyword).map(localRowToDirectRow)
        const apiIds = new Set(apiRows.map((r) => r.id))
        const merged = [...localRows.filter((r) => !apiIds.has(r.id)), ...apiRows]
        const sorted = sortPortfolioRows(
          merged.map((r) => ({
            ...r,
            size: r.cumulative_return,
            team_tags: [] as string[],
            build_type: null,
            unit_nav_date: null,
            sharpe_1y: null,
            share_status: null,
            updated_at: r.created_at,
            created_by: null,
          })),
          sortKey === "cumulative_return" ? "size" : sortKey === "created_at" ? "updated_at" : sortKey,
          sortDir,
        ).map((r) => ({
          id: r.id,
          name: r.name,
          unit_nav: r.unit_nav,
          cumulative_return: r.size,
          ret_1w: r.ret_1w,
          ret_1m: r.ret_1m,
          ret_3m: r.ret_3m,
          ret_6m: r.ret_6m,
          ret_1y: r.ret_1y,
          vol_1y: merged.find((m) => m.id === r.id)?.vol_1y ?? null,
          calmar_1y: r.calmar_1y,
          created_at: r.updated_at,
          isLocal: merged.find((m) => m.id === r.id)?.isLocal,
        }))
        setData(sorted)
        setTotal(sorted.length)
      })
      .catch(() => {
        const rows = sortPortfolioRows(
          loadLocalPortfolioRows(keyword).map((r) => ({
            ...localRowToDirectRow(r),
            size: localRowToDirectRow(r).cumulative_return,
            team_tags: [] as string[],
            build_type: null,
            unit_nav_date: null,
            sharpe_1y: null,
            share_status: null,
            updated_at: localRowToDirectRow(r).created_at,
            created_by: null,
          })),
          sortKey === "cumulative_return" ? "size" : sortKey === "created_at" ? "updated_at" : sortKey,
          sortDir,
        ).map((r) => ({
          id: r.id,
          name: r.name,
          unit_nav: r.unit_nav,
          cumulative_return: r.size,
          ret_1w: r.ret_1w,
          ret_1m: r.ret_1m,
          ret_3m: r.ret_3m,
          ret_6m: r.ret_6m,
          ret_1y: r.ret_1y,
          vol_1y: null,
          calmar_1y: r.calmar_1y,
          created_at: r.updated_at,
          isLocal: true,
        }))
        setData(rows)
        setTotal(rows.length)
      })
      .finally(() => setLoading(false))
  }, [page, sortKey, sortDir, keyword, cutoffDate, localRefresh])

  function handleSort(col: SortKey) {
    if (col === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("desc") }
    setPage(1)
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (col !== sortKey) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function pageButtons(): (number | "…")[] {
    const btns: (number | "…")[] = []
    const lo = Math.max(1, page - 2)
    const hi = Math.min(totalPages, page + 2)
    if (lo > 1) { btns.push(1); if (lo > 2) btns.push("…") }
    for (let i = lo; i <= hi; i++) btns.push(i)
    if (hi < totalPages) { if (hi < totalPages - 1) btns.push("…"); btns.push(totalPages) }
    return btns
  }

  function handleExport() {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const headers = [
      "组合名称", "单位净值", "累计收益(元)", "近一周收益", "近一月收益", "近三月收益",
      "近六月收益", "近一年收益", "近一年波动率", "近一年卡玛比率", "创建时间",
    ]
    const csvRows = [
      headers.join(","),
      ...data.map((r) => [
        escape(r.name), escape(r.unit_nav), escape(r.cumulative_return),
        escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m),
        escape(r.ret_1y), escape(r.vol_1y), escape(r.calmar_1y), escape(r.created_at),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `直投组合_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const pagedData = data.slice((page - 1) * pageSize, page * pageSize)
  const colCount = 13 + addedCols.length

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="relative mb-3 flex-shrink-0">
        <input
          type="text"
          value={kwInput}
          onChange={(e) => setKwInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setKeyword(kwInput.trim()); setPage(1) } }}
          placeholder="请输入组合名称或代码进行查询"
          className="h-9 w-full pl-3 pr-10 border rounded-lg text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
        />
        <Search
          className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground cursor-pointer"
          onClick={() => { setKeyword(kwInput.trim()); setPage(1) }}
        />
      </div>

      <div className="flex items-center justify-between gap-4 mb-3 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">指标计算截止日期：</span>
          <div className="relative">
            <button
              onClick={() => setShowDatePicker((v) => !v)}
              className="inline-flex items-center gap-1 border rounded px-1.5 py-0.5 hover:bg-muted cursor-pointer transition-colors tabular-nums"
            >
              <CalendarDays className="h-3 w-3" />
              {cutoffDate}
              <ChevronDown className="h-3 w-3" />
            </button>
            {showDatePicker && (
              <div className="absolute left-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg p-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="date"
                  value={cutoffDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => { if (e.target.value) { setCutoffDate(e.target.value); setShowDatePicker(false) } }}
                  className="border rounded px-2 py-1 text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
              </div>
            )}
            {showDatePicker && <div className="fixed inset-0 z-30" onClick={() => setShowDatePicker(false)} />}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative">
            <button
              onClick={() => { setMetricTemplates(loadMetricTemplates()); setShowTemplateMenu((v) => !v) }}
              className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-foreground border border-border/50 rounded-lg px-2.5 py-1 text-xs hover:bg-muted/60 transition-colors"
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
              {activeTemplate ?? "默认模板"}
              <ChevronDown className="h-3 w-3" />
            </button>
            {showTemplateMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowTemplateMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg min-w-[160px] py-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => { setAddedCols([]); setActiveTemplate(null); setShowTemplateMenu(false) }}
                    className={[
                      "w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2",
                      activeTemplate === null ? "bg-red-50 dark:bg-red-950/30" : "hover:bg-muted",
                    ].join(" ")}
                  >
                    <LayoutTemplate className="h-3.5 w-3.5 text-zinc-400" />
                    默认模板
                  </button>
                  {metricTemplates.map((t, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setAddedCols(t.items.map(({ period, metric }) => ({
                          id: `${period}__${metric}`,
                          period,
                          metric,
                          label: `${period}${metric}`,
                        })))
                        setActiveTemplate(t.name)
                        setShowTemplateMenu(false)
                      }}
                      className={[
                        "w-full text-left px-4 py-2 text-sm transition-colors truncate",
                        activeTemplate === t.name ? "bg-red-50 dark:bg-red-950/30" : "hover:bg-muted",
                      ].join(" ")}
                    >
                      {t.name}
                    </button>
                  ))}
                  <div className="border-t my-1" />
                  <button
                    onClick={() => { setShowTemplateMenu(false); window.open("/ma/dashboard/settings?tab=metric-templates", "_blank") }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-red-500"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    管理模板
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => setShowAddMetric(true)}
            className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-foreground border border-border/50 rounded-lg px-2.5 py-1 text-xs hover:bg-muted/60 transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5" />
            自定义指标
            {addedCols.length > 0 && <span className="text-red-500">({addedCols.length})</span>}
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-foreground border border-border/50 rounded-lg px-2.5 py-1 text-xs hover:bg-muted/60 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border flex-1">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1400 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
              <th className={`${thBase} w-10 border-b`}>序号</th>
              <th className={`${thSort} border-b min-w-[200px]`} onClick={() => handleSort("name")}>
                组合名称/报告名称<SortIcon col="name" />
              </th>
              <th className={`${thSort} border-b min-w-[88px]`} onClick={() => handleSort("unit_nav")}>
                单位净值<SortIcon col="unit_nav" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[110px]`} onClick={() => handleSort("cumulative_return")}>
                累计收益(元)<SortIcon col="cumulative_return" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[88px]`} onClick={() => handleSort("ret_1w")}>
                近一周收益<SortIcon col="ret_1w" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[88px]`} onClick={() => handleSort("ret_1m")}>
                近一月收益<SortIcon col="ret_1m" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[88px]`} onClick={() => handleSort("ret_3m")}>
                近三月收益<SortIcon col="ret_3m" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[88px]`} onClick={() => handleSort("ret_6m")}>
                近六月收益<SortIcon col="ret_6m" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[88px]`} onClick={() => handleSort("ret_1y")}>
                近一年收益<SortIcon col="ret_1y" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[110px]`} onClick={() => handleSort("vol_1y")}>
                近一年波动率<SortIcon col="vol_1y" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[110px]`} onClick={() => handleSort("calmar_1y")}>
                近一年卡玛比率<SortIcon col="calmar_1y" />
              </th>
              <th className={`${thSort} border-b min-w-[100px]`} onClick={() => handleSort("created_at")}>
                创建时间<SortIcon col="created_at" />
              </th>
              <th className={`${thBase} border-b text-center w-16`}>操作</th>
              {addedCols.map((col) => (
                <th key={col.id} className={`${thBase} border-b text-right min-w-[96px]`}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} className="py-20 text-center text-foreground">加载中…</td></tr>
            ) : pagedData.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : pagedData.map((row, i) => (
              <tr key={row.id} className="group hover:bg-muted/30 transition-colors">
                <td className="border-b px-3 py-2 text-center tabular-nums text-muted-foreground">
                  {(page - 1) * pageSize + i + 1}
                </td>
                <td className="border-b px-3 py-2 font-medium">
                  {row.isLocal ? (
                    <a
                      href={`/ma/dashboard/private-funds/portfolio/${row.id}`}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {row.name}
                    </a>
                  ) : (
                    <span className="text-blue-600 dark:text-blue-400">{row.name}</span>
                  )}
                </td>
                <td className="border-b px-3 py-2 tabular-nums">{fmtNum(row.unit_nav)}</td>
                <td className="border-b px-3 py-2 text-right tabular-nums">{fmtMoney(row.cumulative_return)}</td>
                <td className="border-b px-3 py-2 text-right"><PctCell value={row.ret_1w} /></td>
                <td className="border-b px-3 py-2 text-right"><PctCell value={row.ret_1m} /></td>
                <td className="border-b px-3 py-2 text-right"><PctCell value={row.ret_3m} /></td>
                <td className="border-b px-3 py-2 text-right"><PctCell value={row.ret_6m} /></td>
                <td className="border-b px-3 py-2 text-right"><PctCell value={row.ret_1y} /></td>
                <td className="border-b px-3 py-2 text-right"><RatioCell value={row.vol_1y} /></td>
                <td className="border-b px-3 py-2 text-right"><RatioCell value={row.calmar_1y} /></td>
                <td className="border-b px-3 py-2 tabular-nums whitespace-nowrap text-xs text-muted-foreground">
                  {row.created_at ?? "—"}
                </td>
                <td className="border-b px-3 py-2 text-center">
                  <button type="button" className="text-muted-foreground hover:text-foreground" title="编辑">
                    <Pencil className="h-3.5 w-3.5 inline" />
                  </button>
                </td>
                {addedCols.map((col) => (
                  <td key={col.id} className="border-b px-3 py-2 text-right text-muted-foreground">—</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-3 pb-0.5 flex-shrink-0">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          共 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{total.toLocaleString()}</span> 条
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ‹
          </button>
          {pageButtons().map((btn, idx) =>
            btn === "…" ? (
              <span key={`e${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
            ) : (
              <button
                key={btn}
                onClick={() => setPage(btn as number)}
                className={[
                  "w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors",
                  btn === page
                    ? "bg-red-500 text-white border-red-500 font-medium shadow-sm"
                    : "text-foreground hover:bg-muted border-border",
                ].join(" ")}
              >
                {btn}
              </button>
            ),
          )}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || totalPages <= 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ›
          </button>
        </div>
      </div>

      {showAddMetric && (
        <AddMetricModal
          initial={addedCols}
          onConfirm={(cols) => { setAddedCols(cols); setShowAddMetric(false) }}
          onClose={() => setShowAddMetric(false)}
        />
      )}
    </div>
  )
}
