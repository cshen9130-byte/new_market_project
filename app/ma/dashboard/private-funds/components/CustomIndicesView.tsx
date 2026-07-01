"use client"

import { useEffect, useState } from "react"
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  ExternalLink,
  Inbox,
  LayoutTemplate,
  ListPlus,
  Pencil,
  Search,
  Settings2,
  Trash2,
} from "lucide-react"
import { ProductSelectionPanelBound } from "@/components/ma/product-selection-panel"

type ScopeTab = "team" | "mine"

type BuildType =
  | "market_combo"
  | "manual_components"
  | "custom_weight"
  | "equal_weight"

type IndexSortKey =
  | "index_name"
  | "build_type"
  | "index_code"
  | "update_date"
  | "index_level"
  | "ret_1w"
  | "ret_1m"
  | "ret_3m"
  | "ret_6m"
  | "ret_1y"
  | "sharpe_1y"
  | "calmar_1y"
  | "calc_status"
  | "updated_at"
  | "modified_date"

interface CustomIndexRow {
  id: string
  index_name: string
  build_type: BuildType | string | null
  index_code: string | null
  update_date: string | null
  index_level: string | null
  description: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  calc_status: string | null
  updated_at: string | null
  modified_date: string | null
}

const BUILD_TYPE_OPTIONS: { key: BuildType | ""; label: string }[] = [
  { key: "", label: "不限" },
  { key: "market_combo", label: "市场指数组合" },
  { key: "manual_components", label: "手动上传成份" },
  { key: "custom_weight", label: "自定义加权组合" },
  { key: "equal_weight", label: "等权重等权组合" },
]

const BUILD_TYPE_LABEL: Record<string, string> = {
  market_combo: "市场指数组合",
  manual_components: "手动上传成份",
  custom_weight: "自定义加权组合",
  equal_weight: "等权重等权组合",
}

function userFetchHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    const id = u?.id ?? ""
    return id ? { "x-market-user-id": id } : {}
  } catch {
    return {}
  }
}

function fmtDots(iso: string): string {
  return iso.replace(/-/g, ".")
}

function fmtLevel(v: string | null | undefined): string {
  if (!v) return "—"
  const n = parseFloat(v)
  return Number.isNaN(n) ? "—" : n.toFixed(4)
}

function PctCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const n = parseFloat(value)
  if (Number.isNaN(n)) return <span className="text-muted-foreground">—</span>
  const pct = Math.abs(n) <= 1 && !value.includes("%") ? n * 100 : n
  const cls = pct > 0 ? "text-red-500" : pct < 0 ? "text-green-600" : "text-foreground"
  return <span className={cls}>{pct > 0 ? "+" : ""}{pct.toFixed(2)}%</span>
}

function RatioCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const n = parseFloat(value)
  if (Number.isNaN(n)) return <span className="text-muted-foreground">—</span>
  const cls = n > 0 ? "text-red-500" : n < 0 ? "text-green-600" : "text-foreground"
  return <span className={cls}>{n.toFixed(2)}</span>
}

function SortIcon({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
  return dir === "asc"
    ? <ChevronUp className="inline h-3 w-3 ml-0.5" />
    : <ChevronDown className="inline h-3 w-3 ml-0.5" />
}

const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"
const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`

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
  ["收益", "年化收益", "夏普比率", "卡玛比率", "最大回撤"],
  ["年化波动率", "索提诺比率", "Alpha", "Beta", "信息比率"],
]

function loadMetricTemplates(): { name: string; items: { period: string; metric: string }[] }[] {
  if (typeof window === "undefined") return []
  try { return JSON.parse(localStorage.getItem("tracking_metric_templates") ?? "[]") } catch { return [] }
}

function AddMetricModal({ initial, onConfirm, onClose }: {
  initial: AddedCol[]
  onConfirm: (cols: AddedCol[]) => void
  onClose: () => void
}) {
  const [selPeriod, setSelPeriod] = useState("近一月")
  const [selected, setSelected] = useState<AddedCol[]>(initial)

  function isChecked(m: string) {
    return selected.some((c) => c.period === selPeriod && c.metric === m)
  }

  function toggle(m: string) {
    if (isChecked(m)) {
      setSelected((s) => s.filter((c) => !(c.period === selPeriod && c.metric === m)))
    } else {
      setSelected((s) => [...s, { id: `${selPeriod}__${m}`, period: selPeriod, metric: m, label: `${selPeriod}${m}` }])
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background border rounded-lg shadow-xl w-[720px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <span className="font-semibold text-sm">选择指标</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="p-5 overflow-auto">
          <div className="grid grid-cols-4 gap-y-2 gap-x-2 mb-5 pb-4 border-b">
            {ADD_METRIC_PERIODS.map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" name="custom-index-metric-period" checked={selPeriod === p} onChange={() => setSelPeriod(p)} />
                {p}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {ADD_METRIC_GROUPS.flat().map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={isChecked(m)} onChange={() => toggle(m)} />
                {m}
              </label>
            ))}
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

const toolbarLink = "inline-flex items-center gap-1.5 px-3 py-2 text-zinc-600 hover:text-foreground transition-colors"
const toolbarDivider = "h-4 w-px bg-border shrink-0"

export function CustomIndicesView() {
  const [scopeTab, setScopeTab] = useState<ScopeTab>("team")
  const [buildType, setBuildType] = useState<BuildType | "">("")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [cutoffDate, setCutoffDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [indexDataDate, setIndexDataDate] = useState<string | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [sortKey, setSortKey] = useState<IndexSortKey>("index_name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState<CustomIndexRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showTemplateMenu, setShowTemplateMenu] = useState(false)
  const [showAddMetric, setShowAddMetric] = useState(false)
  const [addedCols, setAddedCols] = useState<AddedCol[]>([])
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null)
  const [metricTemplates, setMetricTemplates] = useState(() => loadMetricTemplates())

  const isTeam = scopeTab === "team"
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const tableColSpan = 19 + addedCols.length

  useEffect(() => {
    setPage(1)
  }, [scopeTab, buildType, keyword, pageSize])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      scope: scopeTab,
      keyword,
      sort: sortKey,
      dir: sortDir,
      cutoff: cutoffDate,
    })
    if (buildType) params.set("build_type", buildType)

    fetch(`/ma/api/custom-indices/list?${params}`, {
      headers: isTeam ? {} : userFetchHeaders(),
    })
      .then((r) => r.json())
      .then((json) => {
        setData(json.data ?? [])
        setTotal(json.total ?? 0)
        setIndexDataDate(json.index_data_date ?? null)
        setSelected(new Set())
      })
      .catch(() => {
        setData([])
        setTotal(0)
        setIndexDataDate(null)
        setSelected(new Set())
      })
      .finally(() => setLoading(false))
  }, [page, pageSize, scopeTab, buildType, keyword, sortKey, sortDir, cutoffDate, isTeam])

  function handleSort(col: IndexSortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(col)
      setSortDir("desc")
    }
    setPage(1)
  }

  function toggleAll() {
    if (selected.size === data.length) setSelected(new Set())
    else setSelected(new Set(data.map((r) => r.id)))
  }

  function handleExport() {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const rows = selected.size > 0 ? data.filter((r) => selected.has(r.id)) : data
    const headers = [
      "指数名称", "自建类型", "指数代码", "更新日期", "指数点位", "自建说明",
      "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益",
      "近一年夏普比率", "近一年卡玛比率", "计算状态", "最近修改", "修改日期",
    ]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.index_name),
        escape(r.build_type ? BUILD_TYPE_LABEL[r.build_type] ?? r.build_type : ""),
        escape(r.index_code), escape(r.update_date), escape(r.index_level), escape(r.description),
        escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m), escape(r.ret_1y),
        escape(r.sharpe_1y), escape(r.calmar_1y), escape(r.calc_status),
        escape(r.updated_at), escape(r.modified_date),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${isTeam ? "团队指数" : "我的指数"}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
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

  const pillActive = "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
  const pillIdle = "border-border text-zinc-500 hover:bg-muted/60"
  const pillUnlimitedActive = "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
  const pillUnlimitedIdle = "border-border text-zinc-500 hover:border-red-300 hover:text-red-500"

  const displayIndexDataDate = indexDataDate ?? (() => {
    const d = new Date(cutoffDate)
    d.setDate(d.getDate() - 6)
    return d.toISOString().slice(0, 10)
  })()

  const sortCols: [IndexSortKey, string][] = [
    ["index_name", "指数名称"],
    ["build_type", "自建类型"],
    ["index_code", "指数代码"],
    ["update_date", "更新日期"],
    ["index_level", "指数点位"],
    ["ret_1w", "近一周收益"],
    ["ret_1m", "近一月收益"],
    ["ret_3m", "近三月收益"],
    ["ret_6m", "近六月收益"],
    ["ret_1y", "近一年收益"],
    ["sharpe_1y", "近一年夏普比率"],
    ["calmar_1y", "近一年卡玛比率"],
    ["calc_status", "计算状态"],
    ["updated_at", "最近修改"],
    ["modified_date", "修改日期"],
  ]

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-0 border-b mb-3 flex-shrink-0">
        {(["team", "mine"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setScopeTab(t); setBuildType("") }}
            className={[
              "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              scopeTab === t
                ? "border-red-500 text-red-600 dark:text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t === "team" ? "团队指数" : "我的指数"}
          </button>
        ))}
      </div>

      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
        <div className="flex items-start px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">自建类型：</span>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            {BUILD_TYPE_OPTIONS.map(({ key, label }) => (
              <span
                key={key || "all"}
                onClick={() => { setBuildType(key); setPage(1) }}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                  buildType === key
                    ? (key === "" ? pillUnlimitedActive : pillActive)
                    : (key === "" ? pillUnlimitedIdle : pillIdle),
                ].join(" ")}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">关 键 字：</span>
          <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-80">
            <input
              className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
              placeholder="请输入自建指数名称"
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput)}
            />
            <button onClick={() => setKeyword(kwInput)} className="text-muted-foreground hover:text-foreground transition-colors">
              <Search className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-3 text-xs text-zinc-500 flex-shrink-0">
        <span>指标计算截止日期</span>
        <span className="text-zinc-400 cursor-help" title="指标基于该截止日期的净值序列计算">(?)</span>
        <span>：</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowDatePicker((v) => !v)}
            className="inline-flex items-center gap-1 tabular-nums hover:text-foreground transition-colors"
          >
            {fmtDots(cutoffDate)}
            <ChevronDown className="h-3 w-3" />
          </button>
          {showDatePicker && (
            <div className="absolute left-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg p-3" onClick={(e) => e.stopPropagation()}>
              <input
                type="date"
                value={cutoffDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => { if (e.target.value) { setCutoffDate(e.target.value); setShowDatePicker(false); setPage(1) } }}
                className="border rounded px-2 py-1 text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>
          )}
          {showDatePicker && <div className="fixed inset-0 z-30" onClick={() => setShowDatePicker(false)} />}
        </div>
        <span>，其中指数的数据：</span>
        <span className="tabular-nums text-zinc-600">{fmtDots(displayIndexDataDate)}</span>
      </div>

      {showAddMetric && (
        <AddMetricModal
          initial={addedCols}
          onConfirm={(cols) => { setAddedCols(cols); setActiveTemplate(null); setShowAddMetric(false) }}
          onClose={() => setShowAddMetric(false)}
        />
      )}

      <div className="flex flex-col flex-1 min-h-0 rounded-lg border bg-background overflow-hidden">
        <div className="relative z-50 flex items-center justify-end px-3 py-2 flex-shrink-0 text-xs border-b border-border/60">
          <div className="flex items-center">
            <div className="relative">
              <button
                onClick={() => {
                  setMetricTemplates(loadMetricTemplates())
                  setShowTemplateMenu((v) => !v)
                }}
                className={toolbarLink}
              >
                <LayoutTemplate className="h-3.5 w-3.5" />
                {activeTemplate ?? "默认模板"}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showTemplateMenu && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowTemplateMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[160px]">
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
            <div className={toolbarDivider} />
            <button onClick={() => setShowAddMetric(true)} className={toolbarLink}>
              <ListPlus className="h-3.5 w-3.5" />
              {addedCols.length > 0 ? `添加指标(${addedCols.length})` : "添加指标"}
            </button>
            <div className={toolbarDivider} />
            <button onClick={handleExport} className={toolbarLink}>
              <ExternalLink className="h-3.5 w-3.5" />
              {selected.size > 0 ? `导出(${selected.size})` : "导出"}
            </button>
            <div className={toolbarDivider} />
            <button
              type="button"
              className="inline-flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white rounded px-3 py-1.5 font-medium transition-colors shrink-0"
            >
              {isTeam ? "新建指数" : "新建我的指数"}
            </button>
          </div>
        </div>

        <div className="overflow-auto flex-1 min-h-0">
          <table className="text-sm border-collapse w-full" style={{ minWidth: 2200 }}>
            <thead className="bg-muted/30 sticky top-0 z-10">
              <tr>
                <th className={`${thBase} w-10`}>
                  <input type="checkbox" checked={data.length > 0 && selected.size === data.length} onChange={toggleAll} className="rounded accent-zinc-700" />
                </th>
                <th className={thBase}>序号</th>
                {sortCols.slice(0, 5).map(([key, label]) => (
                  <th key={key} className={thSort} onClick={() => handleSort(key)}>
                    {label}
                    <SortIcon active={sortKey === key} dir={sortDir} />
                  </th>
                ))}
                <th className={thBase}>自建说明</th>
                {sortCols.slice(5).map(([key, label]) => (
                  <th key={key} className={thSort} onClick={() => handleSort(key)}>
                    {label}
                    <SortIcon active={sortKey === key} dir={sortDir} />
                  </th>
                ))}
                {addedCols.map((col) => (
                  <th key={col.id} className={thBase}>{col.label}</th>
                ))}
                <th className={`${thBase} sticky right-0 bg-muted/30`}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={tableColSpan} className="text-center py-16 text-muted-foreground text-sm">加载中…</td></tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="text-center py-16 text-muted-foreground text-sm">
                    <div className="flex flex-col items-center gap-2">
                      <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                      <span>暂无数据</span>
                    </div>
                  </td>
                </tr>
              ) : data.map((row, i) => (
                <tr key={row.id} className="border-t hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => {
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(row.id)) next.delete(row.id)
                          else next.add(row.id)
                          return next
                        })
                      }}
                      className="rounded accent-zinc-700"
                    />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-center text-muted-foreground">{(page - 1) * pageSize + i + 1}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-blue-600 hover:underline cursor-pointer">{row.index_name}</span>
                  </td>
                  <td className="px-3 py-2.5">{row.build_type ? (BUILD_TYPE_LABEL[row.build_type] ?? row.build_type) : "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.index_code ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.update_date ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">{fmtLevel(row.index_level)}</td>
                  <td className="px-3 py-2.5 max-w-[140px] truncate" title={row.description ?? undefined}>{row.description ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums"><PctCell value={row.ret_1w} /></td>
                  <td className="px-3 py-2.5 tabular-nums"><PctCell value={row.ret_1m} /></td>
                  <td className="px-3 py-2.5 tabular-nums"><PctCell value={row.ret_3m} /></td>
                  <td className="px-3 py-2.5 tabular-nums"><PctCell value={row.ret_6m} /></td>
                  <td className="px-3 py-2.5 tabular-nums"><PctCell value={row.ret_1y} /></td>
                  <td className="px-3 py-2.5 tabular-nums"><RatioCell value={row.sharpe_1y} /></td>
                  <td className="px-3 py-2.5 tabular-nums"><RatioCell value={row.calmar_1y} /></td>
                  <td className="px-3 py-2.5">{row.calc_status ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{row.updated_at ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{row.modified_date ?? "—"}</td>
                  {addedCols.map((col) => (
                    <td key={col.id} className="px-3 py-2.5 tabular-nums text-muted-foreground">—</td>
                  ))}
                  <td className="px-3 py-2.5 sticky right-0 bg-background">
                    <div className="flex items-center gap-1.5">
                      <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors" title="编辑">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-red-500 transition-colors" title="删除">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-3 py-2 flex-shrink-0 text-xs text-muted-foreground border-t bg-background">
          <span>共 {total} 条</span>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="border rounded px-2 py-1 bg-background text-xs"
            >
              {[20, 50, 100].map((n) => <option key={n} value={n}>{n} 条/页</option>)}
            </select>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-muted/60 transition-colors"
              >
                ‹
              </button>
              {pageButtons().map((b, idx) =>
                b === "…" ? (
                  <span key={`e-${idx}`} className="px-1">…</span>
                ) : (
                  <button
                    key={b}
                    onClick={() => setPage(b)}
                    className={[
                      "min-w-[28px] px-2 py-1 border rounded transition-colors",
                      page === b ? "bg-red-500 text-white border-red-500" : "hover:bg-muted/60",
                    ].join(" ")}
                  >
                    {b}
                  </button>
                ),
              )}
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-muted/60 transition-colors"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </div>
      <ProductSelectionPanelBound
        data={data}
        selected={selected}
        setSelected={setSelected}
        getId={(r) => r.id}
        getName={(r) => r.index_name}
        showActions={false}
      />
    </div>
  )
}
