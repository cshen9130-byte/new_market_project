"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  BarChart2,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  CloudUpload,
  ExternalLink,
  Inbox,
  Info,
  LayoutTemplate,
  LineChart,
  ListPlus,
  MousePointerClick,
  Pencil,
  Search,
  Settings2,
  Trash2,
  TrendingUp,
} from "lucide-react"
import { authService } from "@/lib/auth"
import { CustomFundCreateDialog } from "./CustomFundCreateDialog"
import { customFundDetailHref } from "@/components/ma/custom-fund-detail-view"
import { customFundNavManageHref } from "@/components/ma/custom-fund-nav-manage-view"

type ScopeTab = "team" | "mine"

type CustomFundSortKey =
  | "serial_no"
  | "product_name"
  | "product_code"
  | "strategy_l1"
  | "strategy_l2"
  | "latest_nav"
  | "latest_nav_date"
  | "cumulative_nav"
  | "latest_price_change"
  | "ret_1w"
  | "ret_1y"
  | "ret_ann_since_inception"
  | "ret_ytd"
  | "ret_1m"
  | "ret_3m"
  | "ret_6m"
  | "sharpe_1y"
  | "calmar_1y"
  | "benchmark_index"
  | "metric_calc_time"
  | "nav_completeness"
  | "inception_date"
  | "fund_type"
  | "nav_frequency"
  | "team_member"
  | "remark"
  | "created_by"
  | "created_at"

interface TrackStrategyNode {
  l1: string
  l2s: { l2: string; l3s: string[] }[]
}

interface CustomFundRow {
  id: string
  serial_no: string | null
  product_name: string
  product_code: string | null
  personal_tags: string[] | null
  strategy_l1: string | null
  strategy_l2: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  cumulative_nav: string | null
  latest_price_change: string | null
  ret_1w: string | null
  ret_1y: string | null
  ret_ann_since_inception: string | null
  ret_ytd: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  benchmark_index: string | null
  metric_calc_time: string | null
  nav_completeness: string | null
  inception_date: string | null
  fund_type: string | null
  nav_frequency: string | null
  team_member: string | null
  remark: string | null
  created_by: string | null
  created_at: string | null
}

function currentUserName(): string {
  if (typeof window === "undefined") return ""
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    return u?.name || u?.email || ""
  } catch {
    return ""
  }
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

function fmtNav(v: string | null | undefined): string {
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

interface TrendPoint { d: string; v: number }
interface TrendData { fund: TrendPoint[]; bench: TrendPoint[]; name: string }

function TrendHoverChart({ productCode }: { productCode: string }) {
  const [data, setData] = useState<TrendData | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    fetch(`/ma/api/custom-funds/chart-preview?code=${encodeURIComponent(productCode)}&days=90`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [productCode])

  const W = 340, H = 160, PAD = { t: 12, r: 12, b: 28, l: 40 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b

  if (!data) {
    return <div className="w-[340px] h-[160px] flex items-center justify-center text-xs text-muted-foreground">加载中…</div>
  }
  const { fund } = data
  if (fund.length < 2) {
    return <div className="w-[340px] h-[160px] flex items-center justify-center text-xs text-muted-foreground">暂无净值数据</div>
  }

  const allVals = fund.map((p) => p.v)
  const minV = Math.min(...allVals)
  const maxV = Math.max(...allVals)
  const pad = (maxV - minV) * 0.12 || 1
  const lo = minV - pad
  const hi = maxV + pad
  const allDates = fund.map((p) => p.d).sort()
  const xScale = (d: string) => PAD.l + (allDates.indexOf(d) / Math.max(allDates.length - 1, 1)) * cW
  const yScale = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * cH
  const toPath = (pts: TrendPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.d).toFixed(1)},${yScale(p.v).toFixed(1)}`).join(" ")

  return (
    <div className="w-[340px] p-2">
      <svg width={W} height={H}>
        <path d={toPath(fund)} fill="none" stroke="#ef4444" strokeWidth={1.5} />
      </svg>
    </div>
  )
}

const thBase = "px-3 py-0 h-9 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap box-border leading-tight align-middle"
const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`
const tdBase = "px-3 py-0 h-9 border-b whitespace-nowrap box-border align-middle leading-tight"
const thScroll = `${thSort} min-w-[6.75rem]`
const thScrollWide = `${thSort} min-w-[8.5rem]`
const tdScroll = `${tdBase} min-w-[6.75rem]`
const tdScrollWide = `${tdBase} min-w-[8.5rem]`
const stickyHeadBg = "bg-muted/40 dark:bg-muted/20"

const TEAM_MIDDLE_COLS = [
  ["strategy_l1", "一级策略", thScroll],
  ["strategy_l2", "二级策略", thScroll],
  ["latest_nav", "单位净值", thScroll],
  ["latest_nav_date", "净值日期", thScroll],
  ["cumulative_nav", "累计净值", thScroll],
  ["latest_price_change", "涨跌幅", thScroll],
  ["ret_1m", "近一月收益", thScroll],
  ["ret_3m", "近三月收益", thScroll],
  ["ret_6m", "近六月收益", thScroll],
  ["ret_1y", "近一年收益", thScroll],
  ["ret_ann_since_inception", "成立以来年化", thScrollWide],
  ["ret_ytd", "今年以来收益", thScrollWide],
  ["sharpe_1y", "近一年夏普比率", thScrollWide],
  ["calmar_1y", "近一年卡玛比率", thScrollWide],
  ["metric_calc_time", "指标计算时间", thScrollWide],
  ["nav_completeness", "净值完整度", thScrollWide],
  ["inception_date", "成立日期", thScroll],
  ["fund_type", "基金类型", thScroll],
  ["nav_frequency", "净值频率", thScroll],
  ["team_member", "团队成员", thScroll],
  ["remark", "备注", thScrollWide],
  ["created_by", "创建人", thScroll],
  ["created_at", "创建时间", thScrollWide],
] as const

const MINE_MIDDLE_COLS = [
  ["latest_nav", "单位净值", thScroll],
  ["latest_nav_date", "净值日期", thScroll],
  ["cumulative_nav", "累计净值", thScroll],
  ["ret_1w", "近一周收益", thScroll],
  ["ret_1m", "近一月收益", thScroll],
  ["ret_3m", "近三月收益", thScroll],
  ["ret_6m", "近六月收益", thScroll],
  ["ret_1y", "近一年收益", thScroll],
  ["sharpe_1y", "近一年夏普比率", thScrollWide],
  ["calmar_1y", "近一年卡玛比率", thScrollWide],
  ["benchmark_index", "基准指数", thScroll],
  ["fund_type", "运作", thScroll],
] as const

function CustomFundRowMenu({
  rowKey,
  openRowMenu,
  onOpenChange,
  onNavManage,
  onScaleManage,
  onEdit,
  onDelete,
}: {
  rowKey: string
  openRowMenu: string | null
  onOpenChange: (key: string | null) => void
  onNavManage: () => void
  onScaleManage: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const open = openRowMenu === rowKey

  useEffect(() => {
    if (!open || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    if (spaceBelow < 160) {
      setPos({ bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right })
    } else {
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
  }, [open])

  function close() {
    onOpenChange(null)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(open ? null : rowKey)
        }}
        className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors text-base leading-none tracking-widest"
      >
        ···
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={close} />
          <div
            className="fixed z-[101] bg-background border rounded-lg shadow-lg py-1 min-w-[148px]"
            style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => { onNavManage(); close() }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"
            >
              <LineChart className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              净值管理
            </button>
            <button
              type="button"
              onClick={() => { onScaleManage(); close() }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"
            >
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              规模管理
            </button>
            <button
              type="button"
              onClick={() => { onEdit(); close() }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              编辑
            </button>
            <button
              type="button"
              onClick={() => { onDelete(); close() }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              删除
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  )
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
                <input type="radio" name="custom-fund-metric-period" checked={selPeriod === p} onChange={() => setSelPeriod(p)} />
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

function downloadNavUploadTemplate() {
  const csv = "\uFEFF日期,单位净值,累计净值\n2024-01-01,1.0000,1.0000\n"
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = "批量上传净值模板.csv"
  a.click()
  URL.revokeObjectURL(a.href)
}

const toolbarLink = "inline-flex items-center gap-1.5 px-3 py-2 text-zinc-600 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-zinc-600"
const toolbarDivider = "h-4 w-px bg-border shrink-0"

export function CustomFundsView() {
  const [scopeTab, setScopeTab] = useState<ScopeTab>("team")
  const [strategySource, setStrategySource] = useState<"company" | "platform">("platform")
  const [strategyHierarchy, setStrategyHierarchy] = useState<TrackStrategyNode[]>([])
  const [strategyL1, setStrategyL1] = useState("")
  const [strategyL2, setStrategyL2] = useState("")
  const [teamMember, setTeamMember] = useState("")
  const [teamMemberOptions, setTeamMemberOptions] = useState<string[]>([])
  const [personalTags, setPersonalTags] = useState<string[]>([])
  const [personalTagOptions, setPersonalTagOptions] = useState<string[]>([])
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [cutoffDate, setCutoffDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [sortKey, setSortKey] = useState<CustomFundSortKey>("product_name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState<CustomFundRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showTemplateMenu, setShowTemplateMenu] = useState(false)
  const [showBatchMenu, setShowBatchMenu] = useState(false)
  const [showAddMetric, setShowAddMetric] = useState(false)
  const [showNavUpload, setShowNavUpload] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [listRefreshKey, setListRefreshKey] = useState(0)
  const [addedCols, setAddedCols] = useState<AddedCol[]>([])
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null)
  const [metricTemplates, setMetricTemplates] = useState(() => loadMetricTemplates())
  const navUploadRef = useRef<HTMLInputElement>(null)
  const [hoverChartRow, setHoverChartRow] = useState<string | null>(null)
  const [hoverChartPos, setHoverChartPos] = useState<{ x: number; y: number } | null>(null)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null)
  const middleScrollRef = useRef<HTMLDivElement>(null)
  const middleHeaderScrollRef = useRef<HTMLDivElement>(null)

  function syncMiddleScroll(source: "header" | "body") {
    const body = middleScrollRef.current
    const header = middleHeaderScrollRef.current
    if (!body || !header) return
    if (source === "body") header.scrollLeft = body.scrollLeft
    else body.scrollLeft = header.scrollLeft
  }

  const isTeam = scopeTab === "team"
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const l2Options = strategyL1
    ? (strategyHierarchy.find((n) => n.l1 === strategyL1)?.l2s ?? [])
    : []

  useEffect(() => {
    const params = new URLSearchParams({ strategy_source: strategySource, pool: "all" })
    fetch(`/ma/api/tracking-funds/strategies?${params}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setStrategyHierarchy(d) : null)
      .catch(() => {})
  }, [strategySource])

  useEffect(() => {
    if (!isTeam) return
    fetch("/ma/api/custom-funds/team-members")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.data)) setTeamMemberOptions(d.data) })
      .catch(() => {})
  }, [isTeam])

  useEffect(() => {
    if (isTeam) return
    const owner = encodeURIComponent(currentUserName())
    fetch(`/ma/api/ops/team-tags?category=fund_personal&owner=${owner}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setPersonalTagOptions(d.map((t: { name: string }) => t.name))
      })
      .catch(() => {})
  }, [isTeam])

  useEffect(() => {
    setPage(1)
  }, [scopeTab, strategySource, strategyL1, strategyL2, teamMember, personalTags, keyword, pageSize])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      scope: scopeTab,
      strategy_source: strategySource,
      keyword,
      sort: sortKey,
      dir: sortDir,
      cutoff: cutoffDate,
    })
    if (strategyL1) params.set("strategy_l1", strategyL1)
    if (strategyL2) params.set("strategy_l2", strategyL2)
    if (isTeam && teamMember) params.set("team_member", teamMember)
    if (!isTeam) personalTags.forEach((tag) => params.append("personal_tag", tag))

    fetch(`/ma/api/custom-funds/list?${params}`, {
      headers: isTeam ? {} : userFetchHeaders(),
    })
      .then((r) => r.json())
      .then((json) => {
        setData(json.data ?? [])
        setTotal(json.total ?? 0)
        setSelected(new Set())
      })
      .catch(() => {
        setData([])
        setTotal(0)
        setSelected(new Set())
      })
      .finally(() => setLoading(false))
  }, [page, pageSize, scopeTab, strategySource, strategyL1, strategyL2, teamMember, personalTags, keyword, sortKey, sortDir, cutoffDate, isTeam, listRefreshKey])

  function handleSort(col: CustomFundSortKey) {
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

  function togglePersonalTag(tag: string) {
    setPersonalTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
    setPage(1)
  }

  function handleExport() {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const rows = selected.size > 0 ? data.filter((r) => selected.has(r.id)) : data
    const headers = isTeam
      ? [
          "编号", "产品名称", "产品编码", "一级策略", "二级策略", "单位净值", "净值日期", "累计净值", "涨跌幅",
          "近一年收益", "成立以来年化", "今年以来收益", "近一月收益", "近三月收益", "近一年夏普", "近一年卡玛",
          "指标计算时间", "净值完整度", "成立日期", "基金类型", "净值频率", "团队成员", "备注", "创建人", "创建时间",
        ]
      : [
          "序号", "基金ID", "产品名称", "个人标签", "单位净值", "净值日期", "累计净值",
          "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普", "近一年卡玛",
          "基准指数", "运作",
        ]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => isTeam
        ? [
            escape(r.serial_no), escape(r.product_name), escape(r.product_code),
            escape(r.strategy_l1), escape(r.strategy_l2), escape(r.latest_nav), escape(r.latest_nav_date),
            escape(r.cumulative_nav), escape(r.latest_price_change), escape(r.ret_1y), escape(r.ret_ann_since_inception),
            escape(r.ret_ytd), escape(r.ret_1m), escape(r.ret_3m), escape(r.sharpe_1y), escape(r.calmar_1y),
            escape(r.metric_calc_time), escape(r.nav_completeness), escape(r.inception_date), escape(r.fund_type),
            escape(r.nav_frequency), escape(r.team_member), escape(r.remark), escape(r.created_by), escape(r.created_at),
          ].join(",")
        : [
            escape(r.serial_no), escape(r.product_code), escape(r.product_name),
            escape(r.personal_tags?.join(";") ?? ""), escape(r.latest_nav), escape(r.latest_nav_date),
            escape(r.cumulative_nav), escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m),
            escape(r.ret_1y), escape(r.sharpe_1y), escape(r.calmar_1y), escape(r.benchmark_index), escape(r.fund_type),
          ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${isTeam ? "团队自建" : "我的自建"}_${new Date().toISOString().slice(0, 10)}.csv`
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

  const currentUser = authService.getCurrentUser()

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-0 border-b mb-3 flex-shrink-0">
        {(["team", "mine"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setScopeTab(t)
              setTeamMember("")
              setPersonalTags([])
            }}
            className={[
              "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              scopeTab === t
                ? "border-red-500 text-red-600 dark:text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t === "team" ? "团队自建" : "我的自建"}
          </button>
        ))}
      </div>

      <div className="flex items-start gap-2 px-4 py-2.5 mb-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs flex-shrink-0">
        <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
        <span>
          {isTeam
            ? "团队自建，适用于创建实盘或者策略回测的产品并上传净值，数据限本团队可见。"
            : "我的自建，适用于创建个人实盘或者策略回测的产品并上传净值，数据仅本人可见。"}
        </span>
      </div>

      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
        <div className="flex items-start px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">一级策略：</span>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <div className="relative">
              <select
                value={strategySource}
                onChange={(e) => {
                  setStrategySource(e.target.value as "company" | "platform")
                  setStrategyL1("")
                  setStrategyL2("")
                  setPage(1)
                }}
                className="h-7 min-w-[6.25rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="platform">平台策略</option>
                <option value="company">团队策略</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            </div>
            <span
              onClick={() => { setStrategyL1(""); setStrategyL2(""); setPage(1) }}
              className={["inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors", !strategyL1 ? pillUnlimitedActive : pillUnlimitedIdle].join(" ")}
            >
              不限
            </span>
            {strategyHierarchy.map((node) => (
              <span
                key={node.l1}
                onClick={() => {
                  const next = strategyL1 === node.l1 ? "" : node.l1
                  setStrategyL1(next)
                  setStrategyL2("")
                  setPage(1)
                }}
                className={["inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors", strategyL1 === node.l1 ? pillActive : pillIdle].join(" ")}
              >
                {node.l1}
              </span>
            ))}
          </div>
        </div>
        {strategyL1 && l2Options.length > 0 && (
          <div className="flex items-start px-4 py-2 bg-muted/20">
            <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">二级策略：</span>
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <span
                onClick={() => { setStrategyL2(""); setPage(1) }}
                className={["inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors", !strategyL2 ? pillUnlimitedActive : pillUnlimitedIdle].join(" ")}
              >
                不限
              </span>
              {l2Options.map((node) => (
                <span
                  key={node.l2}
                  onClick={() => { setStrategyL2(strategyL2 === node.l2 ? "" : node.l2); setPage(1) }}
                  className={["inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors", strategyL2 === node.l2 ? pillActive : pillIdle].join(" ")}
                >
                  {node.l2}
                </span>
              ))}
            </div>
          </div>
        )}
        {isTeam ? (
          <div className="flex items-center px-4 py-2">
            <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">团队成员：</span>
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <span
                onClick={() => { setTeamMember(""); setPage(1) }}
                className={["inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors", !teamMember ? pillUnlimitedActive : pillUnlimitedIdle].join(" ")}
              >
                不限
              </span>
              {teamMemberOptions.map((member) => (
                <span
                  key={member}
                  onClick={() => { setTeamMember(teamMember === member ? "" : member); setPage(1) }}
                  className={["inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors", teamMember === member ? pillActive : pillIdle].join(" ")}
                >
                  {member}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center px-4 py-2">
            <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">个人标签：</span>
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <span
                onClick={() => { setPersonalTags([]); setPage(1) }}
                className={["inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors", personalTags.length === 0 ? pillUnlimitedActive : pillUnlimitedIdle].join(" ")}
              >
                不限
              </span>
              {personalTagOptions.map((tag) => (
                <span
                  key={tag}
                  onClick={() => togglePersonalTag(tag)}
                  className={["inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors", personalTags.includes(tag) ? pillActive : pillIdle].join(" ")}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">关 键 字：</span>
          <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-80">
            <input
              className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
              placeholder={isTeam ? "请输入产品名称/产品编码，按回车搜索" : "请输入产品名称，按回车搜索"}
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput)}
            />
            <button onClick={() => setKeyword(kwInput)} className="text-muted-foreground hover:text-foreground transition-colors">
              <Search className="h-3 w-3" />
            </button>
          </div>
        </div>
        {!isTeam && (
          <div className="flex items-center px-4 py-2.5 text-xs text-zinc-600">
            <span>指标计算截止日期：</span>
            <div className="relative ml-1">
              <button
                type="button"
                onClick={() => setShowDatePicker((v) => !v)}
                className="inline-flex items-center gap-1 tabular-nums hover:text-foreground transition-colors"
              >
                {cutoffDate}
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
          </div>
        )}
      </div>

      {showAddMetric && (
        <AddMetricModal
          initial={addedCols}
          onConfirm={(cols) => { setAddedCols(cols); setActiveTemplate(null); setShowAddMetric(false) }}
          onClose={() => setShowAddMetric(false)}
        />
      )}

      {showNavUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNavUpload(false)}>
          <div className="bg-background border rounded-lg shadow-xl w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-sm">批量上传净值</span>
              <button onClick={() => setShowNavUpload(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <input ref={navUploadRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" />
            <button
              type="button"
              onClick={() => navUploadRef.current?.click()}
              className="w-full border border-dashed rounded-lg py-8 text-sm text-muted-foreground hover:bg-muted/40 transition-colors"
            >
              点击选择 Excel 或 CSV 文件
            </button>
            <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
              只能上传 Excel 文件或 CSV 文件，且大小不超过 3M。
              <button type="button" onClick={downloadNavUploadTemplate} className="text-blue-600 hover:underline ml-1">
                点击下载批量上传净值模板
              </button>
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowNavUpload(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted">取消</button>
              <button onClick={() => setShowNavUpload(false)} className="px-4 py-1.5 rounded bg-red-500 text-white text-sm hover:bg-red-600">上传</button>
            </div>
          </div>
        </div>
      )}

      <CustomFundCreateDialog
        open={showCreateDialog}
        scope={scopeTab}
        onClose={() => setShowCreateDialog(false)}
        onSaved={() => {
          setPage(1)
          setListRefreshKey((k) => k + 1)
        }}
      />

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
            <div className="relative">
              <button
                disabled={selected.size === 0}
                onClick={() => setShowBatchMenu((v) => !v)}
                className={toolbarLink}
              >
                <MousePointerClick className="h-3.5 w-3.5" />
                批量操作
                {selected.size > 0 && <span className="text-red-500">({selected.size})</span>}
              </button>
              {showBatchMenu && selected.size > 0 && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowBatchMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[130px]">
                    <button onClick={() => setShowBatchMenu(false)} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量添加策略</button>
                    <button onClick={() => setShowBatchMenu(false)} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量添加标签</button>
                    <div className="border-t my-1" />
                    <button onClick={() => setShowBatchMenu(false)} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-red-500">批量删除</button>
                  </div>
                </>
              )}
            </div>
            <div className={toolbarDivider} />
            <button
              disabled={selected.size === 0}
              onClick={() => setShowNavUpload(true)}
              className={toolbarLink}
            >
              <CloudUpload className="h-3.5 w-3.5" />
              批量上传净值
            </button>
            <div className={toolbarDivider} />
            <button onClick={handleExport} className={toolbarLink}>
              <ExternalLink className="h-3.5 w-3.5" />
              {selected.size > 0 ? `导出(${selected.size})` : "导出"}
            </button>
            <div className={toolbarDivider} />
            <button
              onClick={() => setShowCreateDialog(true)}
              className="inline-flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white rounded px-3 py-1.5 font-medium transition-colors shrink-0"
            >
              {isTeam ? "新增团队自建" : "新增我的自建"}
            </button>
          </div>
        </div>

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className={`flex shrink-0 items-center border-b ${stickyHeadBg}`}>
            <table className="text-sm border-collapse shrink-0 w-[22.5rem] table-fixed border-r border-zinc-200 dark:border-zinc-700">
              <thead>
                <tr>
                  <th className={`${thBase} w-10 px-2 text-center`}>
                    <input type="checkbox" checked={data.length > 0 && selected.size === data.length} onChange={toggleAll} className="rounded accent-zinc-700" />
                  </th>
                  <th className={`${thBase} w-12 text-center`}>序号</th>
                  <th className={`${thSort} w-24`} onClick={() => handleSort("product_code")}>
                    基金ID
                    <SortIcon active={sortKey === "product_code"} dir={sortDir} />
                  </th>
                  <th className={`${thSort} w-[11rem]`} onClick={() => handleSort("product_name")}>
                    产品名称
                    <SortIcon active={sortKey === "product_name"} dir={sortDir} />
                  </th>
                </tr>
              </thead>
            </table>
            <div
              ref={middleHeaderScrollRef}
              className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden self-center [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              onScroll={() => syncMiddleScroll("header")}
            >
              <table className="text-sm border-collapse w-max">
                <thead>
                  <tr>
                    {isTeam ? (
                      TEAM_MIDDLE_COLS.map(([key, label, cls]) => (
                        <th key={key} className={cls} onClick={() => handleSort(key as CustomFundSortKey)}>
                          {label}
                          <SortIcon active={sortKey === key} dir={sortDir} />
                        </th>
                      ))
                    ) : (
                      <>
                        <th className={thScrollWide}>个人标签</th>
                        {MINE_MIDDLE_COLS.map(([key, label, cls]) => (
                          <th key={key} className={cls} onClick={() => handleSort(key as CustomFundSortKey)}>
                            {label}
                            <SortIcon active={sortKey === key} dir={sortDir} />
                          </th>
                        ))}
                      </>
                    )}
                    {addedCols.map((col) => (
                      <th key={col.id} className={thScrollWide}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
              </table>
            </div>
            <table className="text-sm border-collapse shrink-0 w-[8.25rem] table-fixed border-l border-zinc-200 dark:border-zinc-700 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)]">
              <thead>
                <tr>
                  <th className={`${thBase} w-14 text-center`}>走势</th>
                  <th className={`${thBase} w-[4.75rem] text-center`}>操作</th>
                </tr>
              </thead>
            </table>
          </div>

          <div className="flex flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <div className="flex flex-1 items-center justify-center py-16 text-muted-foreground text-sm">加载中…</div>
            ) : data.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                <span>暂无数据</span>
              </div>
            ) : (
              <div className="flex w-full items-start">
                <table className="text-sm border-collapse shrink-0 w-[22.5rem] table-fixed border-r border-zinc-200 dark:border-zinc-700">
                  <tbody>
                    {data.map((row, i) => {
                      const isSelected = selected.has(row.id)
                      const rowBg = isSelected ? "bg-blue-50 dark:bg-blue-950/30" : "bg-background"
                      const hoverBg = isSelected ? "group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30" : "group-hover:bg-muted/20"
                      const cell = `${tdBase} ${rowBg} ${hoverBg} transition-colors`
                      return (
                        <tr key={row.id} className="group">
                          <td className={`${cell} w-10 px-2 text-center`}>
                            <input
                              type="checkbox"
                              checked={isSelected}
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
                          <td className={`${cell} w-12 text-center tabular-nums text-muted-foreground`}>
                            {(page - 1) * pageSize + i + 1}
                          </td>
                          <td className={`${cell} w-24 tabular-nums`}>{row.product_code ?? "—"}</td>
                          <td className={`${cell} w-[11rem]`}>
                            <a
                              href={row.product_code ? customFundDetailHref(row.product_code) : "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline block truncate"
                              title={row.product_name}
                            >
                              {row.product_name}
                            </a>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                <div
                  ref={middleScrollRef}
                  className="flex-1 min-w-0 overflow-x-auto self-start"
                  onScroll={() => syncMiddleScroll("body")}
                >
                  <table className="text-sm border-collapse w-max">
                    <tbody>
                      {data.map((row) => {
                        const isSelected = selected.has(row.id)
                        const rowBg = isSelected ? "bg-blue-50 dark:bg-blue-950/30" : "bg-background"
                        const hoverBg = isSelected ? "group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30" : "group-hover:bg-muted/20"
                        const scrollCell = `${tdScroll} ${rowBg} ${hoverBg} transition-colors`
                        const scrollCellWide = `${tdScrollWide} ${rowBg} ${hoverBg} transition-colors`
                        return (
                          <tr key={row.id} className="group">
                            {isTeam ? (
                              <>
                                <td className={scrollCell}>{row.strategy_l1 ?? "—"}</td>
                                <td className={scrollCell}>{row.strategy_l2 ?? "—"}</td>
                                <td className={`${scrollCell} tabular-nums`}>{fmtNav(row.latest_nav)}</td>
                                <td className={`${scrollCell} tabular-nums`}>{row.latest_nav_date ?? "—"}</td>
                                <td className={`${scrollCell} tabular-nums`}>{fmtNav(row.cumulative_nav)}</td>
                                <td className={`${scrollCell} tabular-nums`}><PctCell value={row.latest_price_change} /></td>
                                <td className={`${scrollCell} tabular-nums`}><PctCell value={row.ret_1m} /></td>
                                <td className={`${scrollCell} tabular-nums`}><PctCell value={row.ret_3m} /></td>
                                <td className={`${scrollCell} tabular-nums`}><PctCell value={row.ret_6m} /></td>
                                <td className={`${scrollCell} tabular-nums`}><PctCell value={row.ret_1y} /></td>
                                <td className={`${scrollCellWide} tabular-nums`}><PctCell value={row.ret_ann_since_inception} /></td>
                                <td className={`${scrollCellWide} tabular-nums`}><PctCell value={row.ret_ytd} /></td>
                                <td className={`${scrollCellWide} tabular-nums`}><RatioCell value={row.sharpe_1y} /></td>
                                <td className={`${scrollCellWide} tabular-nums`}><RatioCell value={row.calmar_1y} /></td>
                                <td className={`${scrollCellWide} tabular-nums text-muted-foreground`}>{row.metric_calc_time ?? "—"}</td>
                                <td className={`${scrollCellWide} tabular-nums`}>{row.nav_completeness ?? "—"}</td>
                                <td className={`${scrollCell} tabular-nums`}>{row.inception_date ?? "—"}</td>
                                <td className={scrollCell}>{row.fund_type ?? "—"}</td>
                                <td className={scrollCell}>{row.nav_frequency ?? "—"}</td>
                                <td className={scrollCell}>{row.team_member ?? "—"}</td>
                                <td className={`${scrollCellWide} truncate`} title={row.remark ?? undefined}>{row.remark ?? "—"}</td>
                                <td className={scrollCell}>{row.created_by ?? currentUser?.username ?? "—"}</td>
                                <td className={`${scrollCellWide} tabular-nums text-muted-foreground`}>{row.created_at ?? "—"}</td>
                              </>
                            ) : (
                              <>
                                <td className={scrollCellWide}>
                                  <div className="flex flex-wrap gap-1">
                                    {row.personal_tags && row.personal_tags.length > 0
                                      ? row.personal_tags.map((t) => (
                                        <span key={t} className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-500 border border-red-200 dark:bg-red-950/20 dark:border-red-800">{t}</span>
                                      ))
                                      : <span className="text-muted-foreground">—</span>}
                                  </div>
                                </td>
                                <td className={`${scrollCell} tabular-nums`}>{fmtNav(row.latest_nav)}</td>
                                <td className={`${scrollCell} tabular-nums`}>{row.latest_nav_date ?? "—"}</td>
                                <td className={`${scrollCell} tabular-nums`}>{fmtNav(row.cumulative_nav)}</td>
                                <td className={`${scrollCell} tabular-nums`}><PctCell value={row.ret_1w} /></td>
                                <td className={`${scrollCell} tabular-nums`}><PctCell value={row.ret_1m} /></td>
                                <td className={`${scrollCell} tabular-nums`}><PctCell value={row.ret_3m} /></td>
                                <td className={`${scrollCell} tabular-nums`}><PctCell value={row.ret_6m} /></td>
                                <td className={`${scrollCell} tabular-nums`}><PctCell value={row.ret_1y} /></td>
                                <td className={`${scrollCellWide} tabular-nums`}><RatioCell value={row.sharpe_1y} /></td>
                                <td className={`${scrollCellWide} tabular-nums`}><RatioCell value={row.calmar_1y} /></td>
                                <td className={scrollCell}>{row.benchmark_index ?? "—"}</td>
                                <td className={scrollCell}>{row.fund_type ?? "—"}</td>
                              </>
                            )}
                            {addedCols.map((col) => (
                              <td key={col.id} className={`${scrollCellWide} tabular-nums text-muted-foreground`}>—</td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <table className="text-sm border-collapse shrink-0 w-[8.25rem] table-fixed border-l border-zinc-200 dark:border-zinc-700 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)]">
                  <tbody>
                    {data.map((row) => {
                      const isSelected = selected.has(row.id)
                      const rowBg = isSelected ? "bg-blue-50 dark:bg-blue-950/30" : "bg-background"
                      const hoverBg = isSelected ? "group-hover:bg-blue-100 dark:group-hover:bg-blue-900/30" : "group-hover:bg-muted/20"
                      const cell = `${tdBase} ${rowBg} ${hoverBg} transition-colors`
                      return (
                        <tr key={row.id} className="group">
                          <td className={`${cell} w-14 text-center`}>
                            {row.product_code ? (
                              <button
                                type="button"
                                className="inline-flex p-1 rounded text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                                onMouseEnter={(e) => {
                                  if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
                                  const rect = e.currentTarget.getBoundingClientRect()
                                  setHoverChartPos({ x: rect.left, y: rect.bottom + 4 })
                                  setHoverChartRow(row.product_code!)
                                }}
                                onMouseLeave={() => {
                                  hoverTimeout.current = setTimeout(() => {
                                    setHoverChartRow(null)
                                    setHoverChartPos(null)
                                  }, 200)
                                }}
                              >
                                <LineChart className="h-4 w-4" />
                              </button>
                            ) : "—"}
                          </td>
                          <td className={`${cell} w-[4.75rem]`}>
                            <div className="flex items-center justify-center gap-0.5">
                              <button
                                type="button"
                                title="净值管理"
                                onClick={() => {
                                  if (row.product_code) {
                                    window.open(customFundNavManageHref(row.product_code), "_blank", "noopener,noreferrer")
                                  }
                                }}
                                className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <BarChart2 className="h-3.5 w-3.5" />
                              </button>
                              <CustomFundRowMenu
                                rowKey={row.id}
                                openRowMenu={openRowMenu}
                                onOpenChange={setOpenRowMenu}
                                onNavManage={() => {
                                  if (row.product_code) {
                                    window.open(customFundNavManageHref(row.product_code), "_blank", "noopener,noreferrer")
                                  }
                                }}
                                onScaleManage={() => {}}
                                onEdit={() => {}}
                                onDelete={() => {}}
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
              {pageButtons().map((b, i) =>
                b === "…" ? (
                  <span key={`e-${i}`} className="px-1">…</span>
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

      {hoverChartRow && hoverChartPos && createPortal(
        <div
          className="fixed z-[200] bg-background border rounded-lg shadow-xl"
          style={{ left: hoverChartPos.x, top: hoverChartPos.y }}
          onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current) }}
          onMouseLeave={() => { setHoverChartRow(null); setHoverChartPos(null) }}
        >
          <TrendHoverChart productCode={hoverChartRow} />
        </div>,
        document.body,
      )}
    </div>
  )
}
