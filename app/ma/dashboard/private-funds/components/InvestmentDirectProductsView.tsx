"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CopyableProductName } from "@/components/ma/copyable-inline-text"
import {
  CalendarDays,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Download,
  FileSearch,
  Filter,
  HelpCircle,
  Inbox,
  Layers,
  LayoutTemplate,
  LineChart,
  PlusCircle,
  Search,
  Settings2,
  StickyNote,
  Tag,
  Wand2,
} from "lucide-react"

type DirectFundClass = "private" | "public" | "team"
type DirectHoldingStatus = "holding" | "cleared"

type InvDirectSortKey =
  | "product_name" | "latest_nav_date" | "latest_nav" | "cumulative_nav"
  | "holding_mv" | "ret_1w" | "ret_1m" | "ret_3m" | "ret_6m" | "ret_1y"
  | "sharpe_1y" | "calmar_1y"
  | "fund_company" | "adjusted_nav" | "latest_price_change"
  | "metric_calc_time"

interface TrackStrategyNode {
  l1: string
  l2s: { l2: string; l3s: string[] }[]
}

interface InvDirectFundRow {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  fund_company: string | null
  team_tags: string[] | null
  latest_nav: string | null
  latest_nav_date: string | null
  cumulative_nav: string | null
  adjusted_nav: string | null
  latest_price_change: string | null
  holding_mv: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  metric_calc_time: string | null
}

interface AddedCol {
  id: string
  period: string
  metric: string
  label: string
  dbKey: string | null
  isPct: boolean
}

const ADD_METRIC_PERIODS = [
  "本周", "本月", "近一周", "近一月", "近三月",
  "近六月", "近一年", "近两年", "近三年", "近五年",
  "今年以来", "成立以来", "2018", "2019", "2020",
  "2021", "2022", "2023", "2024", "2025", "2026",
]
const ADD_METRIC_GROUPS = [
  ["收益", "年化收益", "超额收益", "超额年化收益", "年化波动率", "超额年化波动率", "夏普比率", "超额夏普比率", "卡玛比率"],
  ["超额卡玛比率", "索提诺比率", "下行标准差", "下行风险", "最大回撤", "超额最大回撤", "最大回撤回补期（天）", "Alpha", "Beta"],
  ["跟踪误差", "信息比率", "偏度", "峰度", "VaR（95%置信）", "周胜率", "最长连续不创新高天数（天）"],
]
const ADD_METRIC_PCT_METRICS = new Set(["收益", "年化收益", "超额收益", "超额年化收益", "年化波动率", "超额年化波动率", "最大回撤", "超额最大回撤"])

function getDbKey(metric: string, period: string): string | null {
  const retMap: Record<string, string> = {
    本周: "ret_1w", 近一周: "ret_1w", 本月: "ret_1m", 近一月: "ret_1m",
    近三月: "ret_3m", 近六月: "ret_6m", 近一年: "ret_1y", 近两年: "ret_1y",
    近三年: "ret_1y", 近五年: "ret_1y", 今年以来: "ret_1y", 成立以来: "ret_1y",
    "2018": "ret_1y", "2019": "ret_1y", "2020": "ret_1y", "2021": "ret_1y",
    "2022": "ret_1y", "2023": "ret_1y", "2024": "ret_1y", "2025": "ret_1y", "2026": "ret_1y",
  }
  if (metric === "收益") return retMap[period] ?? null
  if (metric === "夏普比率" && period === "近一年") return "sharpe_1y"
  if (metric === "卡玛比率" && period === "近一年") return "calmar_1y"
  return null
}

function buildAddedColsFromItems(items: { period: string; metric: string }[]): AddedCol[] {
  return items.map(({ period, metric }) => ({
    id: `${period}__${metric}`,
    period,
    metric,
    label: `${period}${metric}`,
    dbKey: getDbKey(metric, period),
    isPct: ADD_METRIC_PCT_METRICS.has(metric),
  }))
}

function loadTrackingMetricTemplates(): { name: string; items: { period: string; metric: string }[] }[] {
  if (typeof window === "undefined") return []
  try { return JSON.parse(localStorage.getItem("tracking_metric_templates") ?? "[]") } catch { return [] }
}

function calcInterval(cutoff: string, days: number): string {
  const end = new Date(cutoff)
  const start = new Date(cutoff)
  start.setDate(start.getDate() - days)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return `${fmt(start)} ~ ${fmt(end)}`
}

function TrackPctCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const n = parseFloat(value)
  if (isNaN(n)) return <span className="text-muted-foreground">—</span>
  const cls = n > 0 ? "text-red-500" : n < 0 ? "text-green-600" : "text-foreground"
  return <span className={cls}>{n > 0 ? "+" : ""}{(n * 100).toFixed(2)}%</span>
}

function TrackRatioCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const n = parseFloat(value)
  if (isNaN(n)) return <span className="text-muted-foreground">—</span>
  const cls = n > 0 ? "text-red-500" : n < 0 ? "text-green-600" : "text-foreground"
  return <span className={cls}>{n.toFixed(2)}</span>
}

function fmtNav(v: string | null | undefined): string {
  if (!v) return "—"
  const n = parseFloat(v)
  return isNaN(n) ? "—" : n.toFixed(4)
}

function fmtMoney(v: string | null | undefined): string {
  if (!v) return "—"
  const n = parseFloat(v)
  if (isNaN(n)) return "—"
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface TrendPoint { d: string; v: number }
interface TrendData { fund: TrendPoint[]; bench: TrendPoint[]; name: string }

function TrendHoverChart({ beian_hao }: { beian_hao: string }) {
  const [data, setData] = useState<TrendData | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    fetch(`/ma/api/tracking-funds/chart-preview?beian_hao=${encodeURIComponent(beian_hao)}&days=90`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [beian_hao])

  const W = 340, H = 160, PAD = { t: 12, r: 12, b: 28, l: 40 }
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b

  if (!data) {
    return <div className="w-[340px] h-[160px] flex items-center justify-center text-xs text-muted-foreground">加载中…</div>
  }
  const { fund, bench } = data
  if (fund.length < 2) {
    return <div className="w-[340px] h-[160px] flex items-center justify-center text-xs text-muted-foreground">暂无净值数据</div>
  }

  const allVals = [...fund.map((p) => p.v), ...bench.map((p) => p.v)]
  const minV = Math.min(...allVals)
  const maxV = Math.max(...allVals)
  const pad = (maxV - minV) * 0.12 || 1
  const lo = minV - pad
  const hi = maxV + pad
  const allDates = Array.from(new Set([...fund.map((p) => p.d), ...bench.map((p) => p.d)])).sort()
  const xScale = (d: string) => PAD.l + (allDates.indexOf(d) / Math.max(allDates.length - 1, 1)) * cW
  const yScale = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * cH
  const toPath = (pts: TrendPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.d).toFixed(1)},${yScale(p.v).toFixed(1)}`).join(" ")

  return (
    <div className="w-[340px] p-2">
      <svg width={W} height={H}>
        <path d={toPath(fund)} fill="none" stroke="#ef4444" strokeWidth={1.5} />
        {bench.length > 1 && <path d={toPath(bench)} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 3" />}
      </svg>
    </div>
  )
}

function DirectRowMenu({
  beian_hao,
  onQueryElements,
  onEditTags,
  onEditStrategy,
  onNoteManage,
}: {
  beian_hao: string
  onQueryElements: () => void
  onEditTags: () => void
  onEditStrategy: () => void
  onNoteManage: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  function handleToggle(e: React.MouseEvent<HTMLButtonElement>) {
    if (open) { setOpen(false); setPos(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleToggle}
        className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors text-base leading-none tracking-widest"
      >
        ···
      </button>
      {mounted && open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => { setOpen(false); setPos(null) }} />
          <div
            className="fixed z-[101] bg-background border rounded-lg shadow-lg py-1 min-w-[148px]"
            style={{ top: pos.top, right: pos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            <a
              href={`/ma/dashboard/private-funds/${encodeURIComponent(beian_hao)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"
              onClick={() => { setOpen(false); setPos(null) }}
            >
              详情
            </a>
            <button onClick={() => { onQueryElements(); setOpen(false); setPos(null) }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground">
              <FileSearch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />查询要素
            </button>
            <button onClick={() => { onEditTags(); setOpen(false); setPos(null) }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground">
              <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />编辑标签
            </button>
            <button onClick={() => { onEditStrategy(); setOpen(false); setPos(null) }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground">
              <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />编辑策略
            </button>
            <button onClick={() => { onNoteManage(); setOpen(false); setPos(null) }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground">
              <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />备注管理
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  )
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
      setSelected((s) => [...s, {
        id: `${selPeriod}__${m}`,
        period: selPeriod,
        metric: m,
        label: `${selPeriod}${m}`,
        dbKey: getDbKey(m, selPeriod),
        isPct: ADD_METRIC_PCT_METRICS.has(m),
      }])
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background border rounded-lg shadow-xl w-[900px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <span className="font-semibold text-sm">选择指标</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 p-5 overflow-auto border-r">
            <div className="grid grid-cols-5 gap-y-2.5 gap-x-2 mb-5 pb-4 border-b">
              {ADD_METRIC_PERIODS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input type="radio" name="direct-metric-period" checked={selPeriod === p} onChange={() => setSelPeriod(p)} />
                  {p}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-x-6">
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
          <div className="w-56 p-4">
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

const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"
const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`

function StrategyCascadeFilters({
  l1Label,
  l2Label,
  l3Label,
  platformOptionLabel,
  companyOptionLabel,
  strategySource,
  onStrategySourceChange,
  strategyHierarchy,
  strategyL1,
  strategyL2,
  strategyL3,
  onStrategyL1Change,
  onStrategyL2Change,
  onStrategyL3Change,
}: {
  l1Label: string
  l2Label: string
  l3Label: string
  platformOptionLabel: string
  companyOptionLabel: string
  strategySource: "company" | "platform"
  onStrategySourceChange: (next: "company" | "platform") => void
  strategyHierarchy: TrackStrategyNode[]
  strategyL1: string
  strategyL2: string
  strategyL3: string
  onStrategyL1Change: (next: string) => void
  onStrategyL2Change: (next: string) => void
  onStrategyL3Change: (next: string) => void
}) {
  const l2Options = strategyL1
    ? (strategyHierarchy.find((n) => n.l1 === strategyL1)?.l2s ?? [])
    : []
  const l3Options = strategyL2
    ? (l2Options.find((n) => n.l2 === strategyL2)?.l3s ?? [])
    : []

  const pillActive = "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
  const pillIdle = "border-border text-zinc-500 hover:bg-muted/60"
  const pillUnlimitedActive = "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
  const pillUnlimitedIdle = "border-border text-zinc-500 hover:border-red-300 hover:text-red-500"

  return (
    <>
      <div className="flex items-start px-4 py-2">
        <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">{l1Label}：</span>
        <div className="flex items-center gap-2 flex-wrap flex-1">
          <div className="relative">
            <select
              value={strategySource}
              onChange={(e) => onStrategySourceChange(e.target.value as "company" | "platform")}
              className="h-7 min-w-[6.25rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="platform">{platformOptionLabel}</option>
              <option value="company">{companyOptionLabel}</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
          <span
            onClick={() => onStrategyL1Change("")}
            className={[
              "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
              !strategyL1 ? pillUnlimitedActive : pillUnlimitedIdle,
            ].join(" ")}
          >
            不限
          </span>
          {strategyHierarchy.map((node) => (
            <span
              key={node.l1}
              onClick={() => onStrategyL1Change(strategyL1 === node.l1 ? "" : node.l1)}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                strategyL1 === node.l1 ? pillActive : pillIdle,
              ].join(" ")}
            >
              {node.l1}
            </span>
          ))}
        </div>
      </div>
      {strategyL1 && l2Options.length > 0 && (
        <div className="flex items-start px-4 py-2 bg-muted/20">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">{l2Label}：</span>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <span
              onClick={() => onStrategyL2Change("")}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                !strategyL2 ? pillUnlimitedActive : pillUnlimitedIdle,
              ].join(" ")}
            >
              不限
            </span>
            {l2Options.map((node) => (
              <span
                key={node.l2}
                onClick={() => onStrategyL2Change(strategyL2 === node.l2 ? "" : node.l2)}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                  strategyL2 === node.l2 ? pillActive : pillIdle,
                ].join(" ")}
              >
                {node.l2}
              </span>
            ))}
          </div>
        </div>
      )}
      {strategyL2 && l3Options.length > 0 && (
        <div className="flex items-start px-4 py-2 bg-muted/30">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">{l3Label}：</span>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <span
              onClick={() => onStrategyL3Change("")}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                !strategyL3 ? pillUnlimitedActive : pillUnlimitedIdle,
              ].join(" ")}
            >
              不限
            </span>
            {l3Options.map((v) => (
              <span
                key={v}
                onClick={() => onStrategyL3Change(strategyL3 === v ? "" : v)}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                  strategyL3 === v ? pillActive : pillIdle,
                ].join(" ")}
              >
                {v}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function MetricTemplateDropdown({
  open,
  onClose,
  alignRight = true,
  activeTemplate,
  templates,
  onSelectDefault,
  onSelectTemplate,
}: {
  open: boolean
  onClose: () => void
  alignRight?: boolean
  activeTemplate: string | null
  templates: { name: string; items: { period: string; metric: string }[] }[]
  onSelectDefault: () => void
  onSelectTemplate: (t: { name: string; items: { period: string; metric: string }[] }) => void
}) {
  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className={[
          "absolute top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[160px]",
          alignRight ? "right-0" : "left-0",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onSelectDefault}
          className={[
            "w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2",
            activeTemplate === null ? "bg-red-50 dark:bg-red-950/30" : "hover:bg-muted",
          ].join(" ")}
        >
          <LayoutTemplate className="h-3.5 w-3.5 text-zinc-400" />
          默认模板
        </button>
        {templates.map((t, i) => (
          <button
            key={i}
            onClick={() => onSelectTemplate(t)}
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
          onClick={() => { onClose(); window.open("/ma/dashboard/settings?tab=metric-templates", "_blank") }}
          className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-red-500"
        >
          <Settings2 className="h-3.5 w-3.5" />
          管理模板
        </button>
      </div>
    </>
  )
}

export function InvestmentDirectProductsView() {
  const [fundClass, setFundClass] = useState<DirectFundClass>("private")
  const [strategySource, setStrategySource] = useState<"company" | "platform">("platform")
  const [strategyHierarchy, setStrategyHierarchy] = useState<TrackStrategyNode[]>([])
  const [strategyL1, setStrategyL1] = useState("")
  const [strategyL2, setStrategyL2] = useState("")
  const [strategyL3, setStrategyL3] = useState("")
  const [teamTagOptions, setTeamTagOptions] = useState<string[]>([])
  const [teamTags, setTeamTags] = useState<string[]>([])
  const [holdingStatus, setHoldingStatus] = useState<DirectHoldingStatus>("holding")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [cutoffDate, setCutoffDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showInterval, setShowInterval] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showAddMetric, setShowAddMetric] = useState(false)
  const [addedCols, setAddedCols] = useState<AddedCol[]>([])
  const [showTemplateMenu, setShowTemplateMenu] = useState(false)
  const [freezeHeader, setFreezeHeader] = useState(true)
  const [metricTemplates, setMetricTemplates] = useState(() => loadTrackingMetricTemplates())
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<InvDirectSortKey>("product_name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState<InvDirectFundRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hoverChartRow, setHoverChartRow] = useState<string | null>(null)
  const [hoverChartPos, setHoverChartPos] = useState<{ x: number; y: number } | null>(null)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isPublic = fundClass === "public"
  const isTeam = fundClass === "team"
  const isPrivate = fundClass === "private"
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const privateColSpan = 17 + addedCols.length
  const publicColSpan = 16 + addedCols.length
  const teamColSpan = 19 + addedCols.length
  const colSpan = isPublic ? publicColSpan : isTeam ? teamColSpan : privateColSpan

  function resetStrategyFilters() {
    setStrategyL1("")
    setStrategyL2("")
    setStrategyL3("")
  }

  function handleStrategySourceChange(next: "company" | "platform") {
    if (strategySource === next) return
    setStrategySource(next)
    resetStrategyFilters()
    setPage(1)
  }

  function handleStrategyL1Change(next: string) {
    setStrategyL1(next)
    setStrategyL2("")
    setStrategyL3("")
    setPage(1)
  }

  function handleStrategyL2Change(next: string) {
    setStrategyL2(next)
    setStrategyL3("")
    setPage(1)
  }

  function handleStrategyL3Change(next: string) {
    setStrategyL3(next)
    setPage(1)
  }

  const strategyCascadeProps = {
    strategySource,
    onStrategySourceChange: handleStrategySourceChange,
    strategyHierarchy,
    strategyL1,
    strategyL2,
    strategyL3,
    onStrategyL1Change: handleStrategyL1Change,
    onStrategyL2Change: handleStrategyL2Change,
    onStrategyL3Change: handleStrategyL3Change,
  }

  useEffect(() => {
    fetch("/ma/api/ops/team-tags?category=fund")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setTeamTagOptions(d.map((t: { name: string }) => t.name)) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const params = new URLSearchParams({ strategy_source: strategySource, pool: "all" })
    fetch(`/ma/api/tracking-funds/strategies?${params}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setStrategyHierarchy(d) : null)
      .catch(() => {})
  }, [strategySource])

  useEffect(() => {
    setPage(1)
  }, [fundClass, strategySource, strategyL1, strategyL2, strategyL3, teamTags.join("\u0001"), holdingStatus, keyword, pageSize, cutoffDate])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      fund_class: fundClass,
      strategy_source: strategySource,
      holding_status: holdingStatus,
      keyword,
      sort: sortKey,
      dir: sortDir,
      cutoff: cutoffDate,
    })
    if (strategyL1) params.set("strategy_l1", strategyL1)
    if (strategyL2) params.set("strategy_l2", strategyL2)
    if (strategyL3) params.set("strategy_l3", strategyL3)
    if (teamTags.length > 0) params.set("team_tags", teamTags.join(","))
    fetch(`/ma/api/ops/direct-funds/list?${params}`)
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
  }, [page, pageSize, fundClass, strategySource, strategyL1, strategyL2, strategyL3, teamTags, holdingStatus, keyword, sortKey, sortDir, cutoffDate])

  function toggleTeamTag(tag: string) {
    setTeamTags((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])
  }

  function handleFundClassChange(fc: DirectFundClass) {
    if (fundClass === fc) return
    setFundClass(fc)
    resetStrategyFilters()
    setTeamTags([])
    if (fc === "public") {
      setStrategySource("platform")
      setSortKey("product_name")
    } else if (fc === "team") {
      setStrategySource("platform")
      setFreezeHeader(true)
      setSortKey("product_name")
    } else {
      setSortKey("product_name")
    }
    setPage(1)
  }

  function handleSort(col: InvDirectSortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("desc") }
    setPage(1)
  }

  function SortIcon({ col }: { col: InvDirectSortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function toggleAll() {
    if (selected.size === data.length && data.length > 0) setSelected(new Set())
    else setSelected(new Set(data.map((r) => r.beian_hao)))
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

  function toggleTemplateMenu() {
    setMetricTemplates(loadTrackingMetricTemplates())
    setShowTemplateMenu((v) => !v)
  }

  function selectDefaultTemplate() {
    setAddedCols([])
    setActiveTemplate(null)
    setShowTemplateMenu(false)
  }

  function selectNamedTemplate(t: { name: string; items: { period: string; metric: string }[] }) {
    setAddedCols(buildAddedColsFromItems(t.items))
    setActiveTemplate(t.name)
    setShowTemplateMenu(false)
  }

  const templateDropdown = (
    <MetricTemplateDropdown
      open={showTemplateMenu}
      onClose={() => setShowTemplateMenu(false)}
      activeTemplate={activeTemplate}
      templates={metricTemplates}
      onSelectDefault={selectDefaultTemplate}
      onSelectTemplate={selectNamedTemplate}
    />
  )

  function handleExport() {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const rows = selected.size > 0 ? data.filter((r) => selected.has(r.beian_hao)) : data
    const headers = isPublic
      ? ["产品名称", "基金公司", "团队标签", "单位净值", "净值日期", "累计净值", "复权净值", "涨跌幅", "持有市值(元)", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益"]
      : isTeam
        ? ["产品名称", "团队标签", "持仓市值(元)", "单位净值", "累计净值", "涨跌幅", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普比率", "近一年卡玛比率", "指标计算时间"]
        : ["产品名称", "备案编码", "最新净值日期", "最新单位净值", "最新累计净值", "持仓市值(元)", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普比率", "近一年卡玛比率"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => isPublic
        ? [
            escape(r.short_name || r.product_name), escape(r.fund_company), escape(r.team_tags?.join("|") ?? ""),
            escape(r.latest_nav), escape(r.latest_nav_date), escape(r.cumulative_nav), escape(r.adjusted_nav),
            escape(r.latest_price_change), escape(r.holding_mv),
            escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m), escape(r.ret_1y),
          ].join(",")
        : isTeam
          ? [
              escape(r.short_name || r.product_name), escape(r.team_tags?.join("|") ?? ""),
              escape(r.holding_mv), escape(r.latest_nav), escape(r.cumulative_nav), escape(r.latest_price_change),
              escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m), escape(r.ret_1y),
              escape(r.sharpe_1y), escape(r.calmar_1y), escape(r.metric_calc_time),
            ].join(",")
          : [
              escape(r.short_name || r.product_name), escape(r.beian_hao), escape(r.latest_nav_date),
              escape(r.latest_nav), escape(r.cumulative_nav), escape(r.holding_mv),
              escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m), escape(r.ret_1y),
              escape(r.sharpe_1y), escape(r.calmar_1y),
            ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `直投产品_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">基金分类：</span>
          <div className="flex items-center gap-1">
            {([
              ["private", "私募"],
              ["public", "公募"],
              ["team", "团队自建"],
            ] as const).map(([fc, label]) => (
              <span
                key={fc}
                onClick={() => handleFundClassChange(fc)}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                  fundClass === fc
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                    : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                ].join(" ")}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        {isPublic ? (
          <>
            <StrategyCascadeFilters
              {...strategyCascadeProps}
              l1Label="一级分类"
              l2Label="二级分类"
              l3Label="三级分类"
              platformOptionLabel="平台分类"
              companyOptionLabel="团队分类"
            />
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">团队标签：</span>
              <div className="flex items-center gap-2 flex-wrap flex-1">
                <span
                  onClick={() => { setTeamTags([]); setPage(1) }}
                  className={[
                    "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                    teamTags.length === 0
                      ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                      : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                  ].join(" ")}
                >
                  不限
                </span>
                {teamTagOptions.map((tag) => (
                  <span
                    key={tag}
                    onClick={() => toggleTeamTag(tag)}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                      teamTags.includes(tag)
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                        : "border-border text-zinc-500 hover:bg-muted/60",
                    ].join(" ")}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : isTeam ? (
          <>
            <StrategyCascadeFilters
              {...strategyCascadeProps}
              l1Label="一级策略"
              l2Label="二级策略"
              l3Label="三级策略"
              platformOptionLabel="平台策略"
              companyOptionLabel="团队策略"
            />
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">团队标签：</span>
              <div className="flex items-center gap-2 flex-wrap flex-1">
                <span
                  onClick={() => { setTeamTags([]); setPage(1) }}
                  className={[
                    "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                    teamTags.length === 0
                      ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                      : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                  ].join(" ")}
                >
                  不限
                </span>
                {teamTagOptions.map((tag) => (
                  <span
                    key={tag}
                    onClick={() => toggleTeamTag(tag)}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                      teamTags.includes(tag)
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                        : "border-border text-zinc-500 hover:bg-muted/60",
                    ].join(" ")}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : (
          <StrategyCascadeFilters
            {...strategyCascadeProps}
            l1Label="一级策略"
            l2Label="二级策略"
            l3Label="三级策略"
            platformOptionLabel="平台策略"
            companyOptionLabel="团队策略"
          />
        )}
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">持仓状态：</span>
          <div className="flex items-center gap-1">
            {([
              ["holding", "持仓中"],
              ["cleared", "已清仓"],
            ] as const).map(([st, label]) => (
              <span
                key={st}
                onClick={() => { setHoldingStatus(st); setPage(1) }}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                  holdingStatus === st
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                    : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
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
              placeholder={
                isPublic
                  ? "请输入产品/产品备案号，按回车搜索"
                  : isTeam
                    ? "请输入产品、投顾等搜索"
                    : "请输入产品/产品备案号/或拼音简写"
              }
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput)}
            />
            <button onClick={() => setKeyword(kwInput)} className="text-muted-foreground hover:text-foreground transition-colors">
              <Search className="h-3 w-3" />
            </button>
          </div>
        </div>
        {isTeam && (
          <div className="flex items-center px-4 py-2 text-zinc-600">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">指标计算截止日期：</span>
            <div className="relative ml-1">
              <button
                onClick={() => setShowDatePicker((v) => !v)}
                className="inline-flex items-center gap-1 border rounded px-1.5 py-0.5 hover:bg-muted cursor-pointer transition-colors tabular-nums"
              >
                {cutoffDate}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showDatePicker && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-lg p-3" onClick={(e) => e.stopPropagation()}>
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
              {showDatePicker && <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />}
            </div>
          </div>
        )}
      </div>

      <div className="relative z-50 flex items-center justify-between gap-1.5 mb-3 flex-shrink-0 text-xs">
        {!isTeam && (
        <div className="flex items-center gap-1.5 text-zinc-600">
          <span className="font-medium text-zinc-800 dark:text-zinc-200 inline-flex items-center gap-0.5">
            指标计算截止日期
            {isPublic && (
              <span title="指标按所选截止日期计算">
                <HelpCircle className="h-3 w-3 opacity-40" />
              </span>
            )}
          </span>
          <div className="relative">
            <button
              onClick={() => setShowDatePicker((v) => !v)}
              className="inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-zinc-600 hover:bg-muted cursor-pointer transition-colors"
            >
              <CalendarDays className="h-3 w-3" />
              <span className="tabular-nums">{cutoffDate}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {showDatePicker && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-lg p-3" onClick={(e) => e.stopPropagation()}>
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
            {showDatePicker && <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />}
          </div>
        </div>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          {isTeam ? (
            <>
              <button
                onClick={() => setShowAddMetric(true)}
                className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground transition-colors"
              >
                <PlusCircle className="h-3 w-3" />
                选择指标
                {addedCols.length > 0 && <span className="text-red-500">({addedCols.length})</span>}
              </button>
              <div className="relative">
                <button
                  onClick={toggleTemplateMenu}
                  className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors"
                >
                  <LayoutTemplate className="h-3 w-3" />
                  {activeTemplate ?? "默认模板"}
                  <ChevronDown className="h-3 w-3" />
                </button>
                {templateDropdown}
              </div>
              <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
                <input
                  type="checkbox"
                  checked={freezeHeader}
                  onChange={(e) => setFreezeHeader(e.target.checked)}
                  className="rounded h-3 w-3 accent-zinc-700"
                />
                冰冻表头
              </label>
            </>
          ) : (
            <>
          {isPublic ? (
            <button
              disabled
              className="inline-flex items-center gap-1 text-zinc-400 border border-border/50 rounded px-2 py-1 cursor-not-allowed opacity-60"
            >
              计算指标
            </button>
          ) : (
            <>
              <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
                <input type="checkbox" defaultChecked className="rounded h-3 w-3 accent-zinc-700" />
                计算指标
              </label>
              <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
                <input type="checkbox" checked={showInterval} onChange={(e) => setShowInterval(e.target.checked)} className="rounded h-3 w-3 accent-zinc-700" />
                显示区间
              </label>
            </>
          )}
          <div className="relative">
            <button
              onClick={toggleTemplateMenu}
              className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors"
            >
              <LayoutTemplate className="h-3 w-3" />
              {activeTemplate ?? "默认模板"}
              <ChevronDown className="h-3 w-3" />
            </button>
            {templateDropdown}
          </div>
          <button
            onClick={() => setShowAddMetric(true)}
            className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors"
          >
            <PlusCircle className="h-3 w-3" />
            {addedCols.length > 0 ? `添加指标(${addedCols.length})` : "添加指标"}
          </button>
          <button
            disabled={selected.size === 0}
            className="inline-flex items-center gap-1 border border-border/50 rounded px-2 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-zinc-600 hover:text-foreground hover:bg-muted/60"
          >
            {isPublic && <Wand2 className="h-3 w-3" />}
            批量操作
            {selected.size > 0 && <span className="text-xs text-red-500">({selected.size})</span>}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMoreMenu((v) => !v)}
              className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors"
            >
              ⊕ 更多
            </button>
            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-lg py-1 min-w-[120px]">
                  <button onClick={() => { setShowMoreMenu(false); handleExport() }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                    <Download className="h-3.5 w-3.5 text-zinc-400" /> 导出
                  </button>
                  <button onClick={() => setShowMoreMenu(false)} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                    <Settings2 className="h-3.5 w-3.5 text-zinc-400" /> 字段配置
                  </button>
                </div>
              </>
            )}
          </div>
            </>
          )}
        </div>
      </div>

      <div className="overflow-auto rounded-lg border flex-1 min-h-0">
        <table className="text-sm border-collapse w-full" style={{ minWidth: isPublic ? 2000 : isTeam ? 2100 : 1800 }}>
          <thead className={freezeHeader || isTeam ? "sticky top-0 z-20" : ""}>
            <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
              <th className={`${thBase} w-8 px-2`}>
                <input type="checkbox" className="rounded h-3 w-3" checked={selected.size === data.length && data.length > 0} onChange={toggleAll} />
              </th>
              <th className={`${thBase} w-10`}>序号</th>
              <th className={`${thSort} min-w-[180px]`} onClick={() => handleSort("product_name")}>产品名称<SortIcon col="product_name" /></th>
              {isPublic ? (
                <>
                  <th className={`${thSort} min-w-[120px]`} onClick={() => handleSort("fund_company")}>
                    <span className="inline-flex items-center gap-0.5">基金公司<Filter className="h-3 w-3 opacity-40" /></span>
                    <SortIcon col="fund_company" />
                  </th>
                  <th className={`${thBase} min-w-[100px]`}>团队标签</th>
                  <th className={`${thSort} min-w-[90px]`} onClick={() => handleSort("latest_nav")}>单位净值<SortIcon col="latest_nav" /></th>
                  <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("latest_nav_date")}>净值日期<SortIcon col="latest_nav_date" /></th>
                  <th className={`${thSort} min-w-[90px]`} onClick={() => handleSort("cumulative_nav")}>累计净值<SortIcon col="cumulative_nav" /></th>
                  <th className={`${thSort} min-w-[90px]`} onClick={() => handleSort("adjusted_nav")}>复权净值<SortIcon col="adjusted_nav" /></th>
                  <th className={`${thSort} text-right min-w-[80px]`} onClick={() => handleSort("latest_price_change")}>涨跌幅<SortIcon col="latest_price_change" /></th>
                  <th className={`${thSort} text-right min-w-[110px]`} onClick={() => handleSort("holding_mv")}>
                    <span className="inline-flex items-center gap-0.5">
                      持有市值(元)
                      <span title="当净值缺失时，市值显示为-">
                        <HelpCircle className="h-3 w-3 opacity-40" />
                      </span>
                    </span>
                    <SortIcon col="holding_mv" />
                  </th>
                </>
              ) : isTeam ? (
                <>
                  <th className={`${thBase} min-w-[100px]`}>团队标签</th>
                  <th className={`${thSort} text-right min-w-[110px]`} onClick={() => handleSort("holding_mv")}>
                    <span className="inline-flex items-center gap-0.5">
                      持仓市值(元)
                      <span title="当净值缺失时，市值显示为-">
                        <HelpCircle className="h-3 w-3 opacity-40" />
                      </span>
                    </span>
                    <SortIcon col="holding_mv" />
                  </th>
                  <th className={`${thSort} min-w-[90px]`} onClick={() => handleSort("latest_nav")}>单位净值<SortIcon col="latest_nav" /></th>
                  <th className={`${thSort} min-w-[90px]`} onClick={() => handleSort("cumulative_nav")}>累计净值<SortIcon col="cumulative_nav" /></th>
                  <th className={`${thSort} text-right min-w-[80px]`} onClick={() => handleSort("latest_price_change")}>涨跌幅<SortIcon col="latest_price_change" /></th>
                </>
              ) : (
                <>
                  <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("latest_nav_date")}>最新净值日期<SortIcon col="latest_nav_date" /></th>
                  <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("latest_nav")}>最新单位净值<SortIcon col="latest_nav" /></th>
                  <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("cumulative_nav")}>最新累计净值<SortIcon col="cumulative_nav" /></th>
                  <th className={`${thSort} text-right min-w-[110px]`} onClick={() => handleSort("holding_mv")}>
                    <span className="inline-flex items-center gap-0.5">
                      持仓市值(元)
                      <span title="当净值缺失时，市值显示为0">
                        <HelpCircle className="h-3 w-3 opacity-40" />
                      </span>
                    </span>
                    <SortIcon col="holding_mv" />
                  </th>
                </>
              )}
              <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1w")}>
                <div>近一周收益<SortIcon col="ret_1w" /></div>
                {isPrivate && showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 7)}</div>}
              </th>
              <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1m")}>
                <div>近一月收益<SortIcon col="ret_1m" /></div>
                {isPrivate && showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 30)}</div>}
              </th>
              <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_3m")}>
                <div>近三月收益<SortIcon col="ret_3m" /></div>
                {isPrivate && showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 91)}</div>}
              </th>
              <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_6m")}>
                <div>{isTeam ? "近六个月收益" : "近六月收益"}<SortIcon col="ret_6m" /></div>
                {isPrivate && showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 182)}</div>}
              </th>
              <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1y")}>
                <div>近一年收益<SortIcon col="ret_1y" /></div>
                {isPrivate && showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 365)}</div>}
              </th>
              {(isPrivate || isTeam) && (
                <>
                  <th className={`${thSort} text-right min-w-[98px]`} onClick={() => handleSort("sharpe_1y")}>近一年夏普比率<SortIcon col="sharpe_1y" /></th>
                  <th className={`${thSort} text-right min-w-[98px]`} onClick={() => handleSort("calmar_1y")}>近一年卡玛比率<SortIcon col="calmar_1y" /></th>
                </>
              )}
              {isTeam && (
                <th className={`${thSort} min-w-[110px]`} onClick={() => handleSort("metric_calc_time")}>指标计算时间<SortIcon col="metric_calc_time" /></th>
              )}
              {addedCols.map((col) => (
                <th key={col.id} className={`${thBase} text-right min-w-[96px]`}>{col.label}</th>
              ))}
              <th className={`${thBase} text-center w-16`}>走势</th>
              <th className={`${thBase} text-center w-16`}>资料</th>
              <th className={`${thBase} text-center w-16`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colSpan} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : data.map((row, i) => {
              const isSelected = selected.has(row.beian_hao)
              const cell = `border-b px-3 py-2 ${isSelected ? "bg-blue-50 dark:bg-blue-950/40" : ""} group-hover:bg-muted transition-colors`
              const retCell = (val: string | null, days?: number) => (
                <td className={`${cell} text-right tabular-nums`}>
                  <TrackPctCell value={val} />
                  {isPrivate && showInterval && days != null && (
                    <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(cutoffDate, days)}</div>
                  )}
                </td>
              )
              return (
                <tr key={row.beian_hao} className="group">
                  <td className={`${cell} px-2 text-center`}>
                    <input type="checkbox" className="rounded h-3 w-3" checked={isSelected}
                      onChange={() => {
                        const s = new Set(selected)
                        isSelected ? s.delete(row.beian_hao) : s.add(row.beian_hao)
                        setSelected(s)
                      }} />
                  </td>
                  <td className={`${cell} text-center tabular-nums text-muted-foreground`}>{(page - 1) * pageSize + i + 1}</td>
                  <td className={cell}>
                    <CopyableProductName
                      beian_hao={row.beian_hao}
                      product_name={row.product_name}
                      short_name={row.short_name}
                      className="font-medium text-blue-600 dark:text-blue-400 hover:underline block truncate max-w-[220px]"
                    />
                    {!isPublic && !isTeam && row.strategy_l1 && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] border border-amber-300/80 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700/50">
                        {row.strategy_l1}{row.strategy_l2 ? ` · ${row.strategy_l2}` : ""}
                      </span>
                    )}
                  </td>
                  {isPublic ? (
                    <>
                      <td className={`${cell} truncate max-w-[140px]`} title={row.fund_company ?? undefined}>{row.fund_company ?? "—"}</td>
                      <td className={cell}>
                        {row.team_tags && row.team_tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.team_tags.map((tag) => (
                              <span key={tag} className="inline-block px-1.5 py-0.5 rounded text-[10px] border border-border text-muted-foreground">{tag}</span>
                            ))}
                          </div>
                        ) : "—"}
                      </td>
                      <td className={`${cell} tabular-nums font-medium`}>{fmtNav(row.latest_nav)}</td>
                      <td className={`${cell} tabular-nums`}>{row.latest_nav_date ?? "—"}</td>
                      <td className={`${cell} tabular-nums font-medium`}>{fmtNav(row.cumulative_nav)}</td>
                      <td className={`${cell} tabular-nums font-medium`}>{fmtNav(row.adjusted_nav)}</td>
                      <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.latest_price_change} /></td>
                      <td className={`${cell} text-right tabular-nums`}>{row.holding_mv ? fmtMoney(row.holding_mv) : "—"}</td>
                    </>
                  ) : isTeam ? (
                    <>
                      <td className={cell}>
                        {row.team_tags && row.team_tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {row.team_tags.map((tag) => (
                              <span key={tag} className="inline-block px-1.5 py-0.5 rounded text-[10px] border border-border text-muted-foreground">{tag}</span>
                            ))}
                          </div>
                        ) : "—"}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>{row.holding_mv ? fmtMoney(row.holding_mv) : "—"}</td>
                      <td className={`${cell} tabular-nums font-medium`}>{fmtNav(row.latest_nav)}</td>
                      <td className={`${cell} tabular-nums font-medium`}>{fmtNav(row.cumulative_nav)}</td>
                      <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.latest_price_change} /></td>
                    </>
                  ) : (
                    <>
                      <td className={`${cell} tabular-nums`}>{row.latest_nav_date ?? "—"}</td>
                      <td className={`${cell} tabular-nums font-medium`}>{fmtNav(row.latest_nav)}</td>
                      <td className={`${cell} tabular-nums font-medium`}>{fmtNav(row.cumulative_nav)}</td>
                      <td className={`${cell} text-right tabular-nums`}>{fmtMoney(row.holding_mv)}</td>
                    </>
                  )}
                  {retCell(row.ret_1w, 7)}
                  {retCell(row.ret_1m, 30)}
                  {retCell(row.ret_3m, 91)}
                  {retCell(row.ret_6m, 182)}
                  {retCell(row.ret_1y, 365)}
                  {(isPrivate || isTeam) && (
                    <>
                      <td className={`${cell} text-right tabular-nums`}><TrackRatioCell value={row.sharpe_1y} /></td>
                      <td className={`${cell} text-right tabular-nums`}><TrackRatioCell value={row.calmar_1y} /></td>
                    </>
                  )}
                  {isTeam && (
                    <td className={`${cell} tabular-nums text-muted-foreground`}>{row.metric_calc_time ?? cutoffDate}</td>
                  )}
                  {addedCols.map((col) => {
                    const val = col.dbKey ? (row as unknown as Record<string, string | null | undefined>)[col.dbKey] ?? null : null
                    return (
                      <td key={col.id} className={`${cell} text-right tabular-nums`}>
                        {!col.dbKey || val == null
                          ? "—"
                          : col.isPct
                            ? <TrackPctCell value={val} />
                            : <TrackRatioCell value={val} />}
                      </td>
                    )
                  })}
                  <td className={`${cell} text-center`}>
                    <div className="flex items-center justify-center"
                      onMouseEnter={(e) => {
                        if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        hoverTimeout.current = setTimeout(() => {
                          setHoverChartPos({ x: rect.right + 8, y: rect.top })
                          setHoverChartRow(row.beian_hao)
                        }, 200)
                      }}
                      onMouseLeave={() => {
                        if (hoverTimeout.current) clearTimeout(hoverTimeout.current)
                        hoverTimeout.current = setTimeout(() => setHoverChartRow(null), 150)
                      }}
                    >
                      <button type="button" className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                        <LineChart className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className={`${cell} text-center text-muted-foreground`}>—</td>
                  <td className={`${cell} text-center`}>
                    <DirectRowMenu
                      beian_hao={row.beian_hao}
                      onQueryElements={() => {}}
                      onEditTags={() => {}}
                      onEditStrategy={() => {}}
                      onNoteManage={() => {}}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {hoverChartRow && hoverChartPos && (() => {
        const popupW = 356
        const popupH = 210
        const vw = typeof window !== "undefined" ? window.innerWidth : 1920
        const vh = typeof window !== "undefined" ? window.innerHeight : 1080
        const left = hoverChartPos.x + popupW > vw ? hoverChartPos.x - popupW - 16 : hoverChartPos.x
        const top = Math.min(hoverChartPos.y, vh - popupH - 8)
        return (
          <div
            className="fixed z-50 bg-background border rounded-lg shadow-xl pointer-events-none"
            style={{ left, top }}
            onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current) }}
            onMouseLeave={() => setHoverChartRow(null)}
          >
            <TrendHoverChart beian_hao={hoverChartRow} />
          </div>
        )
      })()}

      <div className="flex items-center justify-between pt-3 flex-shrink-0">
        <span className="text-xs text-zinc-400">
          {isPublic
            ? "说明：当净值缺失，市值显示为-，请在【出入金】中更新团队净值。"
            : isTeam
              ? "说明：当净值缺失，市值显示为-，请在【进场】中更新团队净值。"
              : "说明：当净值缺失，市值显示为0，请在【详情】中完善历史净值。"}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-500">
            共 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{total.toLocaleString()}</span> 条
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="w-7 h-7 flex items-center justify-center rounded border text-sm hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">‹</button>
            {pageButtons().map((btn, idx) =>
              btn === "…" ? (
                <span key={`e${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
              ) : (
                <button key={btn} onClick={() => setPage(btn as number)}
                  className={["w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors",
                    btn === page ? "bg-red-500 text-white border-red-500 font-medium" : "text-foreground hover:bg-muted border-border"].join(" ")}>
                  {btn}
                </button>
              )
            )}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages <= 1}
              className="w-7 h-7 flex items-center justify-center rounded border text-sm hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">›</button>
            <div className="relative ml-1">
              <select
                value={pageSize}
                onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
                className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-7 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {[50, 100, 200].map((n) => (
                  <option key={n} value={n}>{n} 条/页</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            </div>
          </div>
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
