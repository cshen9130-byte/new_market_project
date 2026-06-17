"use client"

import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { useSearchParams } from "next/navigation"
import { LineChart, Heart, Send, ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight, Search, CalendarDays, LayoutTemplate, PlusCircle, Download, RefreshCw, Settings2, ClipboardList, FileSearch, Tag, Layers, StickyNote, BarChart2, Star, MinusCircle, Briefcase, Inbox, Database, Key, TrendingUp, Filter, Pencil, Trash2, Eye, EyeOff, FileText, CircleCheck, CircleX } from "lucide-react"
import { deletePortfolio, loadLocalPortfolioRows, sortPortfolioRows } from "@/lib/ma-portfolio-storage"

const menuItems = [
  { key: "funds", label: "基金" },
  { key: "portfolio", label: "组合" },
  { key: "investment", label: "投资" },
  { key: "operations", label: "运维" },
]

interface SidebarGroup {
  label: string
  items: { key: string; label: string }[]
}

const fundsSidebarGroups: SidebarGroup[] = [
  {
    label: "私募数据库",
    items: [
      { key: "private-funds", label: "私募基金" },
      { key: "fund-managers-org", label: "私募管理人" },
      { key: "fund-managers", label: "基金经理" },
    ],
  },
]

const investmentSidebarGroups: SidebarGroup[] = [
  {
    label: "跟踪池",
    items: [
      { key: "inv-tracking", label: "跟踪产品" },
      { key: "inv-tracking-mgr", label: "跟踪管理人" },
      { key: "inv-compare", label: "基金对比" },
    ],
  },
  {
    label: "投资池",
    items: [
      { key: "inv-overview", label: "投资概览" },
      { key: "inv-active", label: "在管产品" },
      { key: "inv-fof", label: "FOF底层" },
      { key: "inv-docs", label: "资料列表" },
    ],
  },
  {
    label: "直投池",
    items: [
      { key: "inv-direct", label: "直投产品" },
      { key: "inv-direct-portfolio", label: "直投组合" },
    ],
  },
]

const operationsSidebarGroups: SidebarGroup[] = [
  {
    label: "产品维护",
    items: [
      { key: "ops-active-funds", label: "在管产品" },
      { key: "ops-fof", label: "FOF底层" },
      { key: "ops-direct", label: "直投产品" },
      { key: "ops-tracking", label: "跟踪产品" },
    ],
  },
  {
    label: "数据维护",
    items: [
      { key: "ops-email-sync", label: "邮箱同步" },
      { key: "ops-ledger", label: "台账管理" },
      { key: "ops-team-data", label: "团队数据" },
      { key: "ops-strategy-tags", label: "策略标签" },
    ],
  },
]

const portfolioSidebarGroups: SidebarGroup[] = [
  {
    label: "模拟组合",
    items: [
      { key: "port-new", label: "新建组合" },
      { key: "port-simulated", label: "模拟组合" },
    ],
  },
  {
    label: "实盘组合",
    items: [
      { key: "port-live", label: "实盘组合" },
    ],
  },
]

const TAB_DEFAULT_SIDE: Record<string, string> = {
  funds: "private-funds",
  portfolio: "port-new",
  investment: "inv-tracking",
  operations: "ops-strategy-tags",
}

const TRACK_STRATEGIES = ["不限", "期货策略", "股票对冲", "股票多头", "套利策略", "期权策略", "多资产策略", "债券策略", "组合策略", "其他"]
const ORG_SIZE_OPTS = ["不限", "100亿以上", "50-100亿", "20-50亿", "10-20亿", "5-10亿", "0-5亿"]
const DEFAULT_POOLS = [
  { key: "all", label: "全部" },
  { key: "bfl_ops", label: "bfl 运维池" },
  { key: "bfl", label: "bfl跟踪池" },
  { key: "tracking", label: "跟踪池" },
  { key: "selected", label: "精选池" },
  { key: "core", label: "核心池" },
  { key: "hy", label: "hy跟踪池" },
  { key: "fof", label: "FOF&MOM跟踪" },
]

const STRATEGIES = ["不限", "期货策略", "股票对冲", "股票多头", "套利策略", "期权策略", "多资产策略", "债券策略", "组合策略", "其他"] as const
const MORE_INFO_TABS = ["基金类型", "基金成立日期", "净值日期", "净值频率", "净值完整度", "是否代表产品", "基金规模提示", "基金信披情况", "基金策略确认", "投资区域", "运作状态", "机构管理规模", "机构办公地址"] as const
const FUND_TYPES = ["不限", "私募证券基金", "券商资管", "期货资管", "信托产品", "公募专户", "保险资管", "私募资产配置基金"] as const
const ORG_SIZES = ["不限", "100亿以上", "50-100亿", "20-50亿", "10-20亿", "5-10亿", "0-5亿"] as const
const MORE_INFO_OPTIONS: Record<string, string[]> = {
  "基金成立日期": ["不限", "6个月以内", "6个月-1年", "1-3年", "3-5年", "5年以上", "自定义"],
  "净值日期":     ["不限", "1个月以内", "1-3个月", "3-6个月", "6个月以上", "自定义"],
  "净值频率":     ["不限", "日频", "周频", "月频"],
  "净值完整度":   ["不限", ">80%", ">90%"],
  "是否代表产品": ["不限", "是", "否"],
  "基金规模提示": ["不限", "无小于1000万规模提示", "有小于1000万规模提示"],
  "基金信披情况": ["不限", "不需要披露月报", "需要披露月报"],
  "基金策略确认": ["不限", "未确认", "已确认"],
  "投资区域":     ["不限", "国内市场", "海外市场"],
  "运作状态":     ["不限", "正常运作", "正常清算", "提前清算", "延期清算", "投顾协议已终止", "非正常清算"],
  "机构办公地址": ["不限", "北京", "上海", "广州", "深圳", "自定义"],
}
const METRIC_TABS = ["收益", "收益排名", "年化收益", "年化收益排名", "年化波动率", "年化波动率排名", "夏普比率", "夏普比率排名", "卡玛比率", "卡玛比率排名", "最大回撤", "最大回撤排名"] as const

const PERIODS_RETURN = ["本周", "本月", "近一周", "近一月", "近三月", "近六月", "近一年", "近两年", "近三年", "近五年", "今年以来", "成立以来", "2018", "2019", "2020", "2021", "2022", "2023", "2024"]
const PERIODS_OTHER  = ["近一月", "近三月", "近六月", "近一年", "近两年", "近三年", "近五年", "今年以来", "成立以来", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]

const RANGES_RETURN     = ["不限", "0%~5%", "5%~10%", "10%~20%", "20%~30%", ">30%", "自定义"]
const RANGES_RANK       = ["不限", "前5%", "前10%", "前25%", "前50%", "前75%", "自定义"]
const RANGES_VOLATILITY = ["不限", "0%~5%", "5%~10%", "10%~15%", "15%~20%", ">20%", "自定义"]
const RANGES_RATIO      = ["不限", "0~1", "1~2", "2~3", "3~5", ">5", "自定义"]

function getPeriodsForMetric(m: string): string[] {
  return (m === "收益" || m === "收益排名") ? PERIODS_RETURN : PERIODS_OTHER
}
function getRangesForMetric(m: string): string[] {
  if (m.includes("排名")) return RANGES_RANK
  if (m === "年化波动率" || m === "最大回撤") return RANGES_VOLATILITY
  if (m === "夏普比率" || m === "卡玛比率") return RANGES_RATIO
  return RANGES_RETURN
}

const ADD_METRIC_PERIODS = [
  "本周","本月","近一周","近一月","近三月",
  "近六月","近一年","近两年","近三年","近五年",
  "今年以来","成立以来","2018","2019","2020",
  "2021","2022","2023","2024","2025","2026",
]
const ADD_METRIC_GROUPS = [
  ["收益","年化收益","超额收益","超额年化收益","年化波动率","超额年化波动率","夏普比率","超额夏普比率","卡玛比率"],
  ["超额卡玛比率","索提诺比率","下行标准差","下行风险","最大回撤","超额最大回撤","最大回撤回补期（天）","Alpha","Beta"],
  ["跟踪误差","信息比率","偏度","峰度","VaR（95%置信）","周胜率","最长连续不创新高天数（天）"],
]

interface StrategyFilter {
  l1: string
  l2s: string[]
}

interface FilterState {
  strategyFilters: StrategyFilter[]
  keyword: string
  manager: string
  metricTab: string
  period: string
  range: string
  inceptionPeriod: string
  navDatePeriod: string
  navFrequency: string
}

function FilterPill({ label, active, onClick, variant = "primary" }: {
  label: string
  active: boolean
  onClick: () => void
  variant?: "primary" | "muted"
}) {
  const base = "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors whitespace-nowrap"
  const activePrimary = "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
  const inactivePrimary = "border-border text-zinc-500 hover:border-red-300 hover:text-red-500"
  const activeMuted = "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
  const inactiveMuted = "border-border text-zinc-500 hover:bg-muted/60"

  return (
    <button
      onClick={onClick}
      className={[
        base,
        active
          ? (variant === "muted" ? activeMuted : activePrimary)
          : (variant === "muted" ? inactiveMuted : inactivePrimary),
      ].join(" ")}
    >
      {label}
    </button>
  )
}

function FundFilterPanel({
  filters,
  onChange,
  onSave,
}: {
  filters: FilterState
  onChange: (f: Partial<FilterState>) => void
  onSave: (name: string) => void
}) {
  const [moreInfoTab, setMoreInfoTab] = useState("基金类型")
  const [fundTypes, setFundTypes] = useState<string[]>([])
  const [orgSizes, setOrgSizes] = useState<string[]>([])
  const [moreInfoValues, setMoreInfoValues] = useState<Record<string, string>>({})
  const [kwInput, setKwInput] = useState("")
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [strategyHierarchy, setStrategyHierarchy] = useState<{ l1: string; l2s: string[] }[]>([])

  useEffect(() => {
    fetch("/ma/api/private-funds/strategies")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setStrategyHierarchy(d) : null)
      .catch(() => {})
  }, [])

  const selectedL1s = filters.strategyFilters.map((f) => f.l1)
  const l2Options: { l1: string; l2: string }[] = strategyHierarchy
    .filter((h) => selectedL1s.includes(h.l1) && h.l2s.length > 0)
    .flatMap((h) => h.l2s.map((l2) => ({ l1: h.l1, l2 })))

  function isL2Active(l1: string, l2: string) {
    return filters.strategyFilters.find((f) => f.l1 === l1)?.l2s.includes(l2) ?? false
  }
  function toggleL1(l1: string) {
    const exists = filters.strategyFilters.some((f) => f.l1 === l1)
    onChange({
      strategyFilters: exists
        ? filters.strategyFilters.filter((f) => f.l1 !== l1)
        : [...filters.strategyFilters, { l1, l2s: [] }],
    })
  }
  function toggleL2(l1: string, l2: string) {
    onChange({
      strategyFilters: filters.strategyFilters.map((f) =>
        f.l1 !== l1 ? f : { ...f, l2s: f.l2s.includes(l2) ? f.l2s.filter((x) => x !== l2) : [...f.l2s, l2] }
      ),
    })
  }
  function clearAllL2() {
    onChange({ strategyFilters: filters.strategyFilters.map((f) => ({ ...f, l2s: [] })) })
  }

  const activeConditions: { label: string; clear: () => void; or?: boolean }[] = []
  let isFirstCond = true
  for (const sf of filters.strategyFilters) {
    if (sf.l2s.length === 0) {
      activeConditions.push({
        label: `基金策略：${sf.l1}`,
        or: !isFirstCond,
        clear: () => onChange({ strategyFilters: filters.strategyFilters.filter((f) => f.l1 !== sf.l1) }),
      })
      isFirstCond = false
    } else {
      for (const l2 of sf.l2s) {
        activeConditions.push({
          label: `基金策略：${sf.l1}${l2}`,
          or: !isFirstCond,
          clear: () =>
            onChange({
              strategyFilters: filters.strategyFilters.map((f) =>
                f.l1 !== sf.l1 ? f : { ...f, l2s: f.l2s.filter((x) => x !== l2) }
              ),
            }),
        })
        isFirstCond = false
      }
    }
  }
  if (filters.keyword)
    activeConditions.push({
      label: `关键字: ${filters.keyword}`,
      clear: () => { onChange({ keyword: "" }); setKwInput("") },
    })

  const lbl = "text-xs font-medium text-zinc-400 dark:text-zinc-500 shrink-0 w-[4.5rem] text-right pr-3 select-none"

  function clearAll() {
    onChange({ strategyFilters: [], keyword: "", manager: "", metricTab: "收益", period: "本周", range: "不限", inceptionPeriod: "", navDatePeriod: "", navFrequency: "" })
    setKwInput("")
    setFundTypes([])
    setMoreInfoValues({})
  }

  return (
    <>
    <div className="bg-background rounded-xl border border-border/60 shadow-sm divide-y text-xs flex-shrink-0 mb-2 overflow-hidden">
      {/* 一级策略 */}
      <div>
        <div className="flex items-center px-4 py-2.5">
          <span className={lbl}>一级策略：</span>
          <div className="flex items-center gap-2 flex-wrap">
            {STRATEGIES.map((s) => (
              <FilterPill
                key={s}
                label={s}
                variant={s === "不限" ? "primary" : "muted"}
                active={s === "不限" ? filters.strategyFilters.length === 0 : filters.strategyFilters.some((f) => f.l1 === s)}
                onClick={() => s === "不限" ? onChange({ strategyFilters: [] }) : toggleL1(s)}
              />
            ))}
          </div>
        </div>
        {/* 二级策略 — shown when any l1 selected and has sub-strategies */}
        {filters.strategyFilters.length > 0 && l2Options.length > 0 && (
          <div className="flex items-center pl-16 pr-4 py-2 border-t border-dashed bg-muted/20">
            <span className="text-zinc-400 dark:text-zinc-500 shrink-0 text-xs w-[4.5rem] text-right pr-2">二级策略：</span>
            <div className="flex items-center gap-2 flex-wrap">
              <FilterPill
                label="不限"
                active={filters.strategyFilters.every((f) => f.l2s.length === 0)}
                onClick={clearAllL2}
              />
              {l2Options.map(({ l1, l2 }) => (
                <FilterPill
                  key={`${l1}:${l2}`}
                  label={l2}
                  variant="muted"
                  active={isL2Active(l1, l2)}
                  onClick={() => toggleL2(l1, l2)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 更多信息 */}
      <div>
        <div className="flex items-center px-4 py-2.5">
          <span className={lbl}>更多信息：</span>
          <div className="flex items-center gap-2 overflow-x-auto flex-1 scrollbar-none">
            {MORE_INFO_TABS.map((tab) => (
              <FilterPill
                key={tab}
                label={tab}
                active={moreInfoTab === tab}
                onClick={() => setMoreInfoTab((t) => (t === tab ? "" : tab))}
              />
            ))}
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-1 shrink-0" />
        </div>
        {moreInfoTab === "基金类型" && (
          <div className="flex items-center gap-4 px-4 py-2 bg-muted/30 border-t">
            <span className="w-[4.5rem]" />
            {FUND_TYPES.map((ft) => {
              const checked = ft === "不限" ? fundTypes.length === 0 : fundTypes.includes(ft)
              return (
                <label key={ft} className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    className="rounded h-3 w-3 accent-red-500"
                    checked={checked}
                    onChange={() => {
                      if (ft === "不限") setFundTypes([])
                      else setFundTypes((prev) =>
                        prev.includes(ft) ? prev.filter((x) => x !== ft) : [...prev, ft]
                      )
                    }}
                  />
                  <span>{ft}</span>
                </label>
              )
            })}
          </div>
        )}
        {moreInfoTab === "机构管理规模" && (
          <div className="flex items-center gap-4 px-4 py-2 bg-muted/30 border-t">
            <span className="w-[4.5rem]" />
            {ORG_SIZES.map((s) => {
              const checked = s === "不限" ? orgSizes.length === 0 : orgSizes.includes(s)
              return (
                <label key={s} className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    className="rounded h-3 w-3 accent-red-500"
                    checked={checked}
                    onChange={() => {
                      if (s === "不限") setOrgSizes([])
                      else setOrgSizes((prev) =>
                        prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                      )
                    }}
                  />
                  <span>{s}</span>
                </label>
              )
            })}
          </div>
        )}
        {moreInfoTab !== "基金类型" && moreInfoTab !== "机构管理规模" && MORE_INFO_OPTIONS[moreInfoTab] && (
          <div className="flex items-center pl-16 pr-4 py-1.5 bg-muted/30 border-t">
            <div className="flex items-center gap-2 flex-wrap">
              {MORE_INFO_OPTIONS[moreInfoTab].map((opt) => (
                <FilterPill
                  key={opt}
                  label={opt}
                  active={(moreInfoTab === "基金成立日期" ? (filters.inceptionPeriod || "不限") : moreInfoTab === "净值日期" ? (filters.navDatePeriod || "不限") : moreInfoTab === "净值频率" ? (filters.navFrequency || "不限") : (moreInfoValues[moreInfoTab] ?? "不限")) === opt}
                  onClick={() => {
                    if (moreInfoTab === "基金成立日期") {
                      onChange({ inceptionPeriod: opt === "不限" ? "" : opt })
                    } else if (moreInfoTab === "净值日期") {
                      onChange({ navDatePeriod: opt === "不限" ? "" : opt })
                    } else if (moreInfoTab === "净值频率") {
                      onChange({ navFrequency: opt === "不限" ? "" : opt })
                    } else {
                      setMoreInfoValues((prev) => ({ ...prev, [moreInfoTab]: opt }))
                    }
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 基金指标 */}
      <div>
        <div className="flex items-center px-4 py-2.5">
          <span className={lbl}>基金指标：</span>
          <div className="flex items-center gap-2 overflow-x-auto flex-1 scrollbar-none">
            {METRIC_TABS.map((tab) => (
              <FilterPill
                key={tab}
                label={tab}
                active={filters.metricTab === tab}
                onClick={() => {
                  const newPeriods = getPeriodsForMetric(tab)
                  const newRanges  = getRangesForMetric(tab)
                  onChange({
                    metricTab: tab,
                    period: newPeriods.includes(filters.period) ? filters.period : newPeriods[0],
                    range:  newRanges.includes(filters.range)   ? filters.range  : "不限",
                  })
                }}
              />
            ))}
          </div>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-1 shrink-0" />
        </div>
        <div className="flex items-center pl-16 pr-4 py-1.5 border-t border-dashed bg-muted/20">
          <span className={lbl}>计算区间：</span>
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-1">
            {getPeriodsForMetric(filters.metricTab).map((p) => (
              <FilterPill key={p} label={p} active={filters.period === p} onClick={() => onChange({ period: p })} />
            ))}
          </div>
        </div>
        <div className="flex items-center pl-16 pr-4 py-1.5 border-t border-dashed bg-muted/20">
          <span className={lbl}>{filters.metricTab.includes("排名") ? "指标排名：" : "指标范围："}</span>
          <div className="flex items-center gap-2 flex-wrap">
            {getRangesForMetric(filters.metricTab).map((r) => (
              <FilterPill key={r} label={r} active={filters.range === r} onClick={() => onChange({ range: r })} />
            ))}
          </div>
        </div>
      </div>

      {/* 关键字 */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className={lbl}>关 键 字：</span>
        <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-60">
          <input
            className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
            placeholder="输入产品/产品备案号，回车搜索"
            value={kwInput}
            onChange={(e) => setKwInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onChange({ keyword: kwInput })}
          />
          <button
            onClick={() => onChange({ keyword: kwInput })}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Search className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center border rounded px-2 h-7 bg-background w-48">
          <input
            className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
            placeholder="请输入关键字并选择管理人"
            value={filters.manager}
            onChange={(e) => onChange({ manager: e.target.value })}
          />
        </div>
      </div>

      {/* 已选条件 */}
      <div className="flex items-center gap-2 px-4 py-2.5 min-h-[38px]">
        <span className={lbl}>已选条件：</span>
        <div className="flex-1 flex items-center gap-1.5 flex-wrap">
          {activeConditions.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {c.or && <span className="text-zinc-400 text-[10px]">或</span>}
              <span className="flex items-center gap-1 bg-red-50 text-red-600 border border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-800 rounded px-2 py-0.5 text-xs">
                {c.label}
                <button onClick={c.clear} className="hover:opacity-60 leading-none ml-0.5 text-red-400">×</button>
              </span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <button onClick={clearAll} className="text-xs text-blue-500 hover:text-blue-600 transition-colors">清空</button>
          <span className="text-zinc-200 dark:text-zinc-700">|</span>
          <button onClick={() => setShowSaveModal(true)} className="text-xs font-medium text-blue-500 hover:text-blue-600 transition-colors">保存</button>
        </div>
      </div>
    </div>

    {showSaveModal && (
      <SaveFilterModal
        onSave={(name) => { onSave(name); setShowSaveModal(false) }}
        onClose={() => setShowSaveModal(false)}
      />
    )}
    </>
  )
}

interface SavedTemplate {
  name: string
  filters: FilterState
  savedAt: string
}

const TEMPLATES_KEY = "pf_filter_templates"

function loadTemplates(): SavedTemplate[] {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]") } catch { return [] }
}
function saveTemplates(ts: SavedTemplate[]) {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(ts))
}

function SaveFilterModal({ onSave, onClose }: {
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState("")
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background border rounded-lg shadow-xl w-[400px] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <span className="font-semibold text-base">保存筛选</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>
        <div className="flex items-center gap-3 mb-6">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 shrink-0">筛选条件名称：</label>
          <input
            autoFocus
            className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
            placeholder="请输入筛选条件名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && onSave(name.trim())}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose}
            className="px-4 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
          <button
            onClick={() => name.trim() && onSave(name.trim())}
            disabled={!name.trim()}
            className="px-4 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">保存</button>
        </div>
      </div>
    </div>
  )
}

interface AddedCol {
  id: string
  period: string
  metric: string
  label: string
  dbKey: string | null
  isPct: boolean
}

function getDbKey(metric: string, period: string): string | null {
  const retMap: Record<string, string> = {
    "本周":"ret_1w","近一周":"ret_1w","本月":"ret_1m","近一月":"ret_1m",
    "近三月":"ret_3m","近六月":"ret_6m","近一年":"ret_1y","近两年":"ret_1y",
    "近三年":"ret_1y","近五年":"ret_1y","今年以来":"ret_1y","成立以来":"ret_1y",
    "2018":"ret_1y","2019":"ret_1y","2020":"ret_1y","2021":"ret_1y",
    "2022":"ret_1y","2023":"ret_1y","2024":"ret_1y","2025":"ret_1y","2026":"ret_1y",
  }
  if (metric === "收益") return retMap[period] ?? null
  if (metric === "夏普比率" && period === "近一年") return "sharpe_1y"
  if (metric === "卡玛比率" && period === "近一年") return "calmar_1y"
  return null
}

const ADD_METRIC_PCT_METRICS = new Set(["收益","年化收益","超额收益","超额年化收益","年化波动率","超额年化波动率","最大回撤","超额最大回撤"])

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

function AddMetricModal({ initial, onConfirm, onClose }: {
  initial: AddedCol[]
  onConfirm: (cols: AddedCol[]) => void
  onClose: () => void
}) {
  const [selPeriod, setSelPeriod] = useState("近一月")
  const [selected, setSelected] = useState<AddedCol[]>(initial)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const PCT_METRICS = new Set(["收益","年化收益","超额收益","超额年化收益","年化波动率","超额年化波动率","最大回撤","超额最大回撤"])

  function isChecked(m: string) {
    return selected.some((c) => c.period === selPeriod && c.metric === m)
  }

  function toggle(m: string) {
    if (isChecked(m)) {
      setSelected((s) => s.filter((c) => !(c.period === selPeriod && c.metric === m)))
    } else {
      const col: AddedCol = {
        id: `${selPeriod}__${m}`,
        period: selPeriod, metric: m,
        label: `${selPeriod}${m}`,
        dbKey: getDbKey(m, selPeriod),
        isPct: PCT_METRICS.has(m),
      }
      setSelected((s) => [...s, col])
    }
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    const arr = [...selected]
    const [item] = arr.splice(dragIdx, 1)
    arr.splice(idx, 0, item)
    setSelected(arr)
    setDragIdx(idx)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background border rounded-lg shadow-xl w-[900px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-sm">选择指标</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
        </div>
        <div className="flex flex-1 min-h-0">
          {/* Left */}
          <div className="flex-1 p-5 overflow-auto border-r min-w-0">
            <div className="text-xs text-muted-foreground mb-3">可选指标</div>
            <div className="grid grid-cols-5 gap-y-2.5 gap-x-2 mb-5 pb-4 border-b">
              {ADD_METRIC_PERIODS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                  <input type="radio" name="add-metric-period" value={p}
                    checked={selPeriod === p} onChange={() => setSelPeriod(p)}
                    className="accent-zinc-900 cursor-pointer" />
                  {p}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-x-6">
              {ADD_METRIC_GROUPS.map((grp, gi) => (
                <div key={gi} className="flex flex-col gap-y-3">
                  {grp.map((m) => (
                    <label key={m} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                      <input type="checkbox" checked={isChecked(m)} onChange={() => toggle(m)}
                        className="accent-zinc-900 cursor-pointer" />
                      {m}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {/* Right */}
          <div className="w-56 flex-shrink-0 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-muted-foreground">已选指标({selected.length})</span>
              <button onClick={() => setSelected([])} className="text-xs text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">清空</button>
            </div>
            <div className="flex-1 overflow-auto">
              {selected.map((col, idx) => (
                <div key={col.id} draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={() => setDragIdx(null)}
                  className="flex items-center gap-1.5 px-2 py-1.5 mb-1 text-xs rounded border bg-muted/30 cursor-grab select-none hover:bg-muted/60 transition-colors">
                  <span className="text-muted-foreground/60">⠇</span>
                  <span className="flex-1 truncate">{col.label}</span>
                  <button className="text-muted-foreground hover:text-foreground flex-shrink-0"
                    onClick={() => setSelected((s) => s.filter((_, i) => i !== idx))}>×</button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">已选列表可拖拉上下排序</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取消</button>
          <button onClick={() => onConfirm(selected)}
            className="px-4 py-1.5 bg-zinc-900 text-white rounded text-sm hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 transition-colors disabled:opacity-40">确定</button>
        </div>
      </div>
    </div>
  )
}

interface FundRow {
  beian_hao:       string
  product_name:    string
  strategy_l1:     string | null
  manager:         string
  inception_date:  string | null
  benchmark:       string | null
  ret_1w:          string | null
  ret_1m:          string | null
  ret_3m:          string | null
  ret_6m:          string | null
  ret_1y:          string | null
  sharpe_1y:       string | null
  calmar_1y:       string | null
  latest_nav:      string | null
  latest_nav_date: string | null
}

type SortKey = "product_name" | "latest_nav" | "ret_1w" | "ret_1m" | "ret_3m" | "ret_6m" | "ret_1y" | "sharpe_1y" | "calmar_1y"
type SortDir = "asc" | "desc"

function fmtNum(v: string | null, decimals = 4) {
  if (!v) return "—"
  const n = parseFloat(v)
  return isNaN(n) ? "—" : n.toFixed(decimals)
}

function fmtPct(v: string | null) {
  if (!v) return "—"
  const n = parseFloat(v)
  if (isNaN(n)) return "—"
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%"
}

function PctCell({ value }: { value: string | null }) {
  const text = fmtPct(value)
  if (text === "—") return <span className="text-muted-foreground">—</span>
  const n = parseFloat(value!)
  return <span className={n > 0 ? "text-red-500" : n < 0 ? "text-emerald-600" : ""}>{text}</span>
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-40 inline-block" />
  return sortDir === "asc"
    ? <ChevronUp className="h-3 w-3 ml-1 inline-block" />
    : <ChevronDown className="h-3 w-3 ml-1 inline-block" />
}

function PrivateFundTable({
  strategyFilters, keyword, metricTab, period, range, inceptionPeriod, navDatePeriod, navFrequency,
  templates, onLoadTemplate,
}: {
  strategyFilters: StrategyFilter[]; keyword: string
  metricTab: string; period: string; range: string; inceptionPeriod: string; navDatePeriod: string; navFrequency: string
  templates: SavedTemplate[]; onLoadTemplate: (t: SavedTemplate) => void
}) {
  const [page, setPage]         = useState(1)
  const [data, setData]         = useState<FundRow[]>([])
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal]       = useState(0)
  const [loading, setLoading]   = useState(false)
  const [sortKey, setSortKey]   = useState<SortKey>("product_name")
  const [sortDir, setSortDir]   = useState<SortDir>("asc")
  const [jumpVal, setJumpVal]   = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cutoffDate, setCutoffDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [addedCols, setAddedCols] = useState<AddedCol[]>([])
  const [showAddMetric, setShowAddMetric] = useState(false)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const fakeScrollbarRef = useRef<HTMLDivElement>(null)
  const [tableScrollWidth, setTableScrollWidth] = useState(0)

  const sfKey = JSON.stringify(strategyFilters)

  // Sync fake horizontal scrollbar with table container
  useEffect(() => {
    const container = tableContainerRef.current
    const fakeScrollbar = fakeScrollbarRef.current
    if (!container || !fakeScrollbar) return
    const onTableScroll = () => { fakeScrollbar.scrollLeft = container.scrollLeft }
    const onFakeScroll = () => { container.scrollLeft = fakeScrollbar.scrollLeft }
    container.addEventListener("scroll", onTableScroll)
    fakeScrollbar.addEventListener("scroll", onFakeScroll)
    return () => {
      container.removeEventListener("scroll", onTableScroll)
      fakeScrollbar.removeEventListener("scroll", onFakeScroll)
    }
  }, [])

  // Measure table scroll width to size the fake scrollbar phantom
  useEffect(() => {
    const update = () => {
      if (tableContainerRef.current) setTableScrollWidth(tableContainerRef.current.scrollWidth)
    }
    update()
    const t = setTimeout(update, 100)
    return () => clearTimeout(t)
  }, [data, addedCols])

  useEffect(() => {
    setPage(1)
  }, [sfKey, keyword, metricTab, period, range, inceptionPeriod, navDatePeriod, navFrequency, cutoffDate])

  useEffect(() => {
    const sfParams = strategyFilters
      .map((f) => `&sf=${encodeURIComponent(f.l2s.length ? `${f.l1}:${f.l2s.join(",")}` : f.l1)}`)
      .join("")
    setLoading(true)
    fetch(`/ma/api/private-funds/list?page=${page}&sort=${sortKey}&dir=${sortDir}${sfParams}&keyword=${encodeURIComponent(keyword)}&metric=${encodeURIComponent(metricTab)}&period=${encodeURIComponent(period)}&range=${encodeURIComponent(range)}&inception=${encodeURIComponent(inceptionPeriod)}&navdate=${encodeURIComponent(navDatePeriod)}&navfreq=${encodeURIComponent(navFrequency)}&cutoff=${encodeURIComponent(cutoffDate)}`)
      .then((r) => r.json())
      .then((json) => {
        setData(json.data ?? [])
        setTotalPages(json.totalPages ?? 1)
        setTotal(json.total ?? 0)
        setSelected(new Set())
      })
      .finally(() => setLoading(false))
  }, [page, sortKey, sortDir, sfKey, keyword, metricTab, period, range, inceptionPeriod, navDatePeriod, navFrequency, cutoffDate])

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
    if (selected.size === data.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(data.map((r) => r.beian_hao)))
    }
  }

  function jumpTo() {
    const n = parseInt(jumpVal)
    if (!isNaN(n) && n >= 1 && n <= totalPages) {
      setPage(n)
      setJumpVal("")
    }
  }

  async function handleExport() {
    const escape = (v: string | null) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    let rows: FundRow[]
    if (selected.size > 0) {
      rows = data.filter((r) => selected.has(r.beian_hao))
    } else {
      const sfParams = strategyFilters
        .map((f) => `&sf=${encodeURIComponent(f.l2s.length ? `${f.l1}:${f.l2s.join(",")}` : f.l1)}`)
        .join("")
      const url = `/ma/api/private-funds/list?export=1&sort=${sortKey}&dir=${sortDir}${sfParams}&keyword=${encodeURIComponent(keyword)}&metric=${encodeURIComponent(metricTab)}&period=${encodeURIComponent(period)}&range=${encodeURIComponent(range)}&inception=${encodeURIComponent(inceptionPeriod)}&navdate=${encodeURIComponent(navDatePeriod)}&navfreq=${encodeURIComponent(navFrequency)}&cutoff=${encodeURIComponent(cutoffDate)}`
      const json = await fetch(url).then((r) => r.json())
      rows = json.data ?? []
    }
    const headers = ["备案号","基金名称","策略","管理人","成立日期","近1周","近1月","近3月","近6月","近1年","夏普(1Y)","卡玛(1Y)","最新净值","净值日期"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.beian_hao), escape(r.product_name), escape(r.strategy_l1), escape(r.manager),
        escape(r.inception_date), escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m),
        escape(r.ret_6m), escape(r.ret_1y), escape(r.sharpe_1y), escape(r.calmar_1y),
        escape(r.latest_nav), escape(r.latest_nav_date),
      ].join(",")),
    ]
    const bom = "\uFEFF"
    const blob = new Blob([bom + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const dlUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = dlUrl
    a.download = `私募基金_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(dlUrl)
  }

  // Compact page buttons
  const pageButtons = (): (number | "…")[] => {
    const btns: (number | "…")[] = []
    const lo = Math.max(1, page - 2)
    const hi = Math.min(totalPages, page + 2)
    if (lo > 1) { btns.push(1); if (lo > 2) btns.push("…") }
    for (let i = lo; i <= hi; i++) btns.push(i)
    if (hi < totalPages) { if (hi < totalPages - 1) btns.push("…"); btns.push(totalPages) }
    return btns
  }

  const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 whitespace-nowrap select-none"
  const thSort = thBase + " cursor-pointer hover:text-foreground transition-colors"

  // Sticky offsets (px): checkbox=36, index=44, name=220
  const stickyLeft = { checkbox: 0, index: 36, name: 80 }
  // Sticky right: ops=0, trend=68
  const stickyRight = { ops: 0, trend: 68 }

  const [showTemplates, setShowTemplates] = useState(false)

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1 py-1.5 mb-1 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">指标计算截止日期</span>
          <div className="relative">
            <button
              onClick={() => setShowDatePicker((v) => !v)}
              className="inline-flex items-center gap-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors border rounded px-1.5 py-0.5 text-xs">
              <CalendarDays className="h-3 w-3" />
              <span className="tabular-nums">{cutoffDate}</span>
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
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setShowTemplates((v) => !v)}
              className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors bg-muted/40 hover:bg-muted border border-border/50 rounded-lg px-2.5 py-1 text-xs">
              <LayoutTemplate className="h-3.5 w-3.5" />
              <span>{templates.length === 0 ? "默认模板" : `模板 (${templates.length})`}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {showTemplates && (
              <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg min-w-[180px] py-1" onClick={(e) => e.stopPropagation()}>
                {templates.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-muted-foreground">暂无保存的模板</div>
                ) : templates.map((t, i) => (
                  <button key={i}
                    onClick={() => { onLoadTemplate(t); setShowTemplates(false) }}
                    className="w-full text-left px-4 py-2 text-xs hover:bg-muted transition-colors">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-muted-foreground/60 text-[10px]">{t.savedAt}</div>
                  </button>
                ))}
              </div>
            )}
            {showTemplates && <div className="fixed inset-0 z-30" onClick={() => setShowTemplates(false)} />}
          </div>
          <button onClick={() => setShowAddMetric(true)} className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors bg-muted/40 hover:bg-muted border border-border/50 rounded-lg px-2.5 py-1 text-xs">
            <PlusCircle className="h-3.5 w-3.5" />
            <span>{addedCols.length > 0 ? `添加指标(${addedCols.length})` : "添加指标"}</span>
          </button>
          <button onClick={handleExport} className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors bg-muted/40 hover:bg-muted border border-border/50 rounded-lg px-2.5 py-1 text-xs">
            <Download className="h-3.5 w-3.5" />
            <span>{selected.size > 0 ? `导出(${selected.size})` : "导出"}</span>
          </button>
        </div>
      </div>
      <div
        ref={tableContainerRef}
        className="overflow-x-scroll [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-t-lg border-x border-t"
      >
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1480 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
              {/* Checkbox */}
              <th style={{ left: stickyLeft.checkbox, width: 36, minWidth: 36 }}
                className="sticky z-30 bg-muted/80 border-b border-r px-2 py-2.5">
                <input type="checkbox" className="rounded"
                  checked={selected.size === data.length && data.length > 0}
                  onChange={toggleAll} />
              </th>
              {/* 序号 */}
              <th style={{ left: stickyLeft.index, width: 44, minWidth: 44 }}
                className={`sticky z-30 bg-muted/80 border-b border-r ${thBase}`}>序号</th>
              {/* 产品名称 */}
              <th style={{ left: stickyLeft.name, width: 220, minWidth: 220 }}
                className={`sticky z-30 bg-muted/80 border-b border-r ${thSort}`}
                onClick={() => handleSort("product_name")}>
                产品名称<SortIcon col="product_name" sortKey={sortKey} sortDir={sortDir} />
              </th>
              {/* Scrollable cols */}
              <th className={`${thBase} border-b`} style={{ minWidth: 88 }}>备案号</th>
              <th className={`${thBase} border-b`} style={{ minWidth: 120 }}>管理人</th>
              <th className={`${thBase} border-b`} style={{ minWidth: 96 }}>成立日期</th>
              <th className={`${thSort} border-b`} style={{ minWidth: 88 }} onClick={() => handleSort("latest_nav")}>
                单位净值<SortIcon col="latest_nav" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className={`${thSort} border-b text-right`} style={{ minWidth: 88 }} onClick={() => handleSort("ret_1w")}>
                近一周收益<SortIcon col="ret_1w" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className={`${thSort} border-b text-right`} style={{ minWidth: 88 }} onClick={() => handleSort("ret_1m")}>
                近一月收益<SortIcon col="ret_1m" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className={`${thSort} border-b text-right`} style={{ minWidth: 88 }} onClick={() => handleSort("ret_3m")}>
                近三月收益<SortIcon col="ret_3m" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className={`${thSort} border-b text-right`} style={{ minWidth: 88 }} onClick={() => handleSort("ret_6m")}>
                近六月收益<SortIcon col="ret_6m" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className={`${thSort} border-b text-right`} style={{ minWidth: 88 }} onClick={() => handleSort("ret_1y")}>
                近一年收益<SortIcon col="ret_1y" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className={`${thSort} border-b text-right`} style={{ minWidth: 88 }} onClick={() => handleSort("sharpe_1y")}>
                夏普(1Y)<SortIcon col="sharpe_1y" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th className={`${thSort} border-b text-right`} style={{ minWidth: 88 }} onClick={() => handleSort("calmar_1y")}>
                卡玛(1Y)<SortIcon col="calmar_1y" sortKey={sortKey} sortDir={sortDir} />
              </th>
              {addedCols.map((col) => (
                <th key={col.id} className={`${thBase} border-b text-right`} style={{ minWidth: 96 }}>
                  {col.label}
                </th>
              ))}
              {/* Fixed right */}
              <th style={{ right: stickyRight.trend, width: 68, minWidth: 68 }}
                className={`sticky z-30 bg-muted/80 border-b border-l ${thBase} text-center`}>走势</th>
              <th style={{ right: stickyRight.ops, width: 68, minWidth: 68 }}
                className={`sticky z-30 bg-muted/80 border-b border-l ${thBase} text-center`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={16 + addedCols.length} className="py-20 text-center text-foreground">加载中…</td>
              </tr>
            ) : data.map((row, i) => {
              const isSelected = selected.has(row.beian_hao)
              const rowBg = isSelected ? "bg-blue-50/40 dark:bg-blue-950/20" : "bg-background"
              const hoverBg = "group-hover:bg-muted/30"
              const cellBase = `border-b px-3 py-0 ${rowBg} ${hoverBg} transition-colors`
              const stickyCell = `sticky z-10 ${rowBg} ${hoverBg} transition-colors border-b`

              return (
                <tr key={row.beian_hao} className="group" style={{ height: 52 }}>
                  {/* Checkbox */}
                  <td style={{ left: stickyLeft.checkbox, width: 36 }}
                    className={`${stickyCell} border-r px-2 text-center`}>
                    <input type="checkbox" className="rounded"
                      checked={isSelected}
                      onChange={() => {
                        const s = new Set(selected)
                        isSelected ? s.delete(row.beian_hao) : s.add(row.beian_hao)
                        setSelected(s)
                      }} />
                  </td>
                  {/* 序号 */}
                  <td style={{ left: stickyLeft.index, width: 44 }}
                    className={`${stickyCell} border-r text-center text-foreground tabular-nums`}>
                    {(page - 1) * 50 + i + 1}
                  </td>
                  {/* 产品名称 */}
                  <td style={{ left: stickyLeft.name, width: 220 }}
                    className={`${stickyCell} border-r px-3`}>
                    <a
                      href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beian_hao)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate font-medium text-blue-600 dark:text-blue-400 hover:underline leading-5 block"
                      title={row.product_name}
                    >
                      {row.product_name}
                    </a>
                    {row.strategy_l1 && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50 flex-shrink-0" />
                        <span className="text-[10px] text-muted-foreground truncate">{row.strategy_l1}</span>
                      </div>
                    )}
                  </td>
                  {/* Scrollable cells */}
                  <td className={`${cellBase} text-foreground tabular-nums`}>{row.beian_hao}</td>
                  <td className={`${cellBase}`}>
                    <span className="text-blue-600 dark:text-blue-400 cursor-pointer hover:underline truncate block max-w-[112px]"
                      title={row.manager}>{row.manager}</span>
                  </td>
                  <td className={`${cellBase} text-foreground tabular-nums whitespace-nowrap`}>
                    {row.inception_date ?? "—"}
                  </td>
                  {/* 单位净值 with date */}
                  <td className={`${cellBase} tabular-nums`}>
                    <div className="font-medium leading-5">{fmtNum(row.latest_nav, 4)}</div>
                    {row.latest_nav_date && (
                      <div className="text-[10px] text-muted-foreground">{row.latest_nav_date}</div>
                    )}
                  </td>
                  <td className={`${cellBase} text-right tabular-nums`}><PctCell value={row.ret_1w} /></td>
                  <td className={`${cellBase} text-right tabular-nums`}><PctCell value={row.ret_1m} /></td>
                  <td className={`${cellBase} text-right tabular-nums`}><PctCell value={row.ret_3m} /></td>
                  <td className={`${cellBase} text-right tabular-nums`}><PctCell value={row.ret_6m} /></td>
                  <td className={`${cellBase} text-right tabular-nums`}><PctCell value={row.ret_1y} /></td>
                  <td className={`${cellBase} text-right tabular-nums text-foreground`}>{fmtNum(row.sharpe_1y, 2)}</td>
                  <td className={`${cellBase} text-right tabular-nums text-foreground`}>{fmtNum(row.calmar_1y, 2)}</td>
                  {addedCols.map((col) => {
                    const val = col.dbKey ? (row as Record<string, string | null>)[col.dbKey] : null
                    return (
                      <td key={col.id} className={`${cellBase} text-right tabular-nums`}>
                        {!col.dbKey || val == null
                          ? <span className="text-muted-foreground">—</span>
                          : col.isPct ? <PctCell value={val} />
                          : <span className="text-muted-foreground">{fmtNum(val, 2)}</span>}
                      </td>
                    )
                  })}
                  {/* Fixed right */}
                  <td style={{ right: stickyRight.trend, width: 68 }}
                    className={`${stickyCell} border-l text-center`}>
                    <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                      <LineChart className="h-3.5 w-3.5" />
                    </button>
                  </td>
                  <td style={{ right: stickyRight.ops, width: 68 }}
                    className={`${stickyCell} border-l text-center`}>
                    <div className="flex items-center justify-center gap-1">
                      <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-rose-500 transition-colors">
                        <Heart className="h-3.5 w-3.5" />
                      </button>
                      <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                        <Send className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Fake horizontal scrollbar — sticky at bottom of viewport as you scroll */}
      <div
        ref={fakeScrollbarRef}
        className="overflow-x-auto border-x border-b rounded-b-lg sticky bottom-0 z-10 bg-background"
        style={{ height: 14 }}
      >
        <div style={{ width: tableScrollWidth, height: 1 }} />
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between pt-3 pb-0.5 flex-shrink-0">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          共 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{total.toLocaleString()}</span> 只基金
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            ‹
          </button>
          {pageButtons().map((btn, idx) =>
            btn === "…" ? (
              <span key={`e${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
            ) : (
              <button key={btn} onClick={() => setPage(btn as number)}
                className={[
                  "w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors",
                  btn === page
                    ? "bg-red-500 text-white border-red-500 font-medium shadow-sm"
                    : "text-foreground hover:bg-muted border-border",
                ].join(" ")}>
                {btn}
              </button>
            )
          )}
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            ›
          </button>
          <div className="flex items-center gap-1 ml-3 text-sm text-foreground">
            跳至
            <input
              type="number" min={1} max={totalPages} value={jumpVal}
              onChange={(e) => setJumpVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && jumpTo()}
              className="w-12 h-7 border rounded px-2 text-center text-foreground bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
            页
            <button onClick={jumpTo}
              className="h-7 px-2 border rounded text-xs hover:bg-muted transition-colors">
              GO
            </button>
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

// ─── InvestmentTrackingView ────────────────────────────────────────────────

interface TrackFundRow {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  strategy_l2: string | null
  manager: string | null
  inception_date: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
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

function calcInterval(cutoff: string, days: number): string {
  const end = new Date(cutoff)
  const start = new Date(cutoff)
  start.setDate(start.getDate() - days)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return `${fmt(start)} ~ ${fmt(end)}`
}

const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"
const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`

// ── TrendHoverChart ─────────────────────────────────────────────────────────
interface TrendPoint { d: string; v: number }
interface TrendData { fund: TrendPoint[]; bench: TrendPoint[]; name: string }

function TrendHoverChart({ beian_hao, productName }: { beian_hao: string; productName: string }) {
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

  if (!data) return (
    <div className="w-[340px] h-[160px] flex items-center justify-center text-xs text-muted-foreground">加载中…</div>
  )
  const { fund, bench, name } = data
  if (fund.length < 2) return (
    <div className="w-[340px] h-[160px] flex items-center justify-center text-xs text-muted-foreground">暂无净值数据</div>
  )

  // Combine for axis range
  const allVals = [...fund.map(p => p.v), ...bench.map(p => p.v)]
  const minV = Math.min(...allVals), maxV = Math.max(...allVals)
  const pad = (maxV - minV) * 0.12 || 1
  const lo = minV - pad, hi = maxV + pad

  // All dates union (sorted)
  const allDates = Array.from(new Set([...fund.map(p => p.d), ...bench.map(p => p.d)])).sort()
  const xScale = (d: string) => PAD.l + (allDates.indexOf(d) / Math.max(allDates.length - 1, 1)) * cW
  const yScale = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * cH

  const toPath = (pts: TrendPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.d).toFixed(1)},${yScale(p.v).toFixed(1)}`).join(" ")

  // Y axis ticks
  const tickCount = 5
  const yTicks = Array.from({ length: tickCount }, (_, i) => lo + (hi - lo) * (i / (tickCount - 1)))

  // X axis: show ~4 date labels
  const xTickIndices = [0, Math.floor(allDates.length * 0.33), Math.floor(allDates.length * 0.66), allDates.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
  const fmtDate = (d: string) => {
    const [, m, day] = d.split("-")
    return `${parseInt(m)}月${parseInt(day)}`
  }

  const fundColor = "#ef4444"
  const benchColor = "#3b82f6"

  return (
    <div className="w-[340px]">
      {/* Legend */}
      <div className="flex items-center gap-3 px-3 pt-2 pb-1 text-xs">
        <span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5 bg-red-500 rounded" />{name}</span>
        <span className="flex items-center gap-1"><span className="inline-block w-5 h-0.5 bg-blue-500 rounded" />沪深300</span>
      </div>
      <svg width={W} height={H} className="overflow-visible">
        {/* Y axis gridlines + labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} y1={yScale(v)} x2={PAD.l + cW} y2={yScale(v)} stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
            <text x={PAD.l - 4} y={yScale(v)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="currentColor" opacity={0.5}>
              {v > 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`}
            </text>
          </g>
        ))}
        {/* Zero line */}
        <line x1={PAD.l} y1={yScale(0)} x2={PAD.l + cW} y2={yScale(0)} stroke="currentColor" strokeOpacity={0.2} strokeWidth={1} strokeDasharray="3,3" />
        {/* Bench line */}
        {bench.length >= 2 && <path d={toPath(bench)} fill="none" stroke={benchColor} strokeWidth={1.5} strokeLinejoin="round" />}
        {/* Fund line */}
        <path d={toPath(fund)} fill="none" stroke={fundColor} strokeWidth={2} strokeLinejoin="round" />
        {/* X axis labels */}
        {xTickIndices.map((i) => (
          <text key={i} x={xScale(allDates[i])} y={H - 6} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.5}>
            {fmtDate(allDates[i])}
          </text>
        ))}
      </svg>
    </div>
  )
}

interface TrackStrategyNode {
  l1: string
  l2s: { l2: string; l3s: string[] }[]
}

type TrackStrategySource = "company" | "platform"
type TrackTeamTagMode = "and" | "or"

function InvestmentTrackingView({ variant = "investment" }: { variant?: "investment" | "operations" } = {}) {
  const isOps = variant === "operations"
  const [trackTab, setTrackTab] = useState<"team" | "mine">("team")
  const [activePool, setActivePool] = useState("bfl")
  const [fundClass, setFundClass] = useState<"private" | "public">("private")
  const [strategySource, setStrategySource] = useState<TrackStrategySource>("company")
  const [strategyHierarchy, setStrategyHierarchy] = useState<TrackStrategyNode[]>([])
  const [strategyL1, setStrategyL1] = useState("")
  const [strategyL2, setStrategyL2] = useState("")
  const [strategyL3, setStrategyL3] = useState("")
  const [teamTagMode, setTeamTagMode] = useState<TrackTeamTagMode>("and")
  const [teamTagOptions, setTeamTagOptions] = useState<string[]>([])
  const [teamTags, setTeamTags] = useState<string[]>([])
  const [orgSizeFilter, setOrgSizeFilter] = useState("不限")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [sortCol, setSortCol] = useState("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [jumpVal, setJumpVal] = useState("")
  const [data, setData] = useState<TrackFundRow[]>([])
  const [total, setTotal] = useState(0)
  const [pools, setPools] = useState<{ key: string; label: string }[]>(DEFAULT_POOLS)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showNewPoolDialog, setShowNewPoolDialog] = useState(false)
  const [newPoolName, setNewPoolName] = useState("")
  const [showManageDialog, setShowManageDialog] = useState(false)
  const [editingPoolKey, setEditingPoolKey] = useState<string | null>(null)
  const [editingPoolLabel, setEditingPoolLabel] = useState("")
  const [myActivePool, setMyActivePool] = useState("mine_default")
  const [myPools, setMyPools] = useState<{ key: string; label: string }[]>([
    { key: "mine_all", label: "全部" },
    { key: "mine_default", label: "默认我的跟踪" },
  ])
  const [showMineNewPoolDialog, setShowMineNewPoolDialog] = useState(false)
  const [mineNewPoolName, setMineNewPoolName] = useState("")
  const [showMineManageDialog, setShowMineManageDialog] = useState(false)
  const [mineEditingPoolKey, setMineEditingPoolKey] = useState<string | null>(null)
  const [mineEditingPoolLabel, setMineEditingPoolLabel] = useState("")
  const [showMineAddMenu, setShowMineAddMenu] = useState(false)
  const [showTeamAddMenu, setShowTeamAddMenu] = useState(false)
  const [showTeamMoreMenu, setShowTeamMoreMenu] = useState(false)
  const [showMineMoreMenu, setShowMineMoreMenu] = useState(false)
  const [showTeamBatchMenu, setShowTeamBatchMenu] = useState(false)
  const [showMineBatchMenu, setShowMineBatchMenu] = useState(false)
  const [showFieldConfigDialog, setShowFieldConfigDialog] = useState(false)
  const [fieldConfigTab, setFieldConfigTab] = useState<string>("基本信息")
  const [fieldConfigSelected, setFieldConfigSelected] = useState<string[]>(["最新净值日期", "最新单位净值", "最新涨跌幅"])
  const [fieldConfigDraft, setFieldConfigDraft] = useState<string[]>(["最新净值日期", "最新单位净值", "最新涨跌幅"])
  const [showAuditLogDialog, setShowAuditLogDialog] = useState(false)
  const [showBatchTagDialog, setShowBatchTagDialog] = useState(false)
  const [batchTagSelected, setBatchTagSelected] = useState<string[]>([])
  const [batchTagTeamTags, setBatchTagTeamTags] = useState<string[]>([])
  // Single-fund tag edit dialog
  const [showEditTagDialog, setShowEditTagDialog] = useState(false)
  const [editTagBeianHao, setEditTagBeianHao] = useState<string | null>(null)
  const [editTagName, setEditTagName] = useState("")
  const [editTagSelected, setEditTagSelected] = useState<string[]>([])
  const [editTagTeamTags, setEditTagTeamTags] = useState<string[]>([])
  const [editTagSaving, setEditTagSaving] = useState(false)
  const [showPersonalEditTagDialog, setShowPersonalEditTagDialog] = useState(false)
  const [editPersonalTagBeianHao, setEditPersonalTagBeianHao] = useState<string | null>(null)
  const [editPersonalTagName, setEditPersonalTagName] = useState("")
  const [editPersonalTagSelected, setEditPersonalTagSelected] = useState<string[]>([])
  const [editPersonalTagOptions, setEditPersonalTagOptions] = useState<string[]>([])
  const [editPersonalTagSaving, setEditPersonalTagSaving] = useState(false)
  const [showBatchStrategyDialog, setShowBatchStrategyDialog] = useState(false)
  const [batchStrategyL1, setBatchStrategyL1] = useState("")
  const [batchStrategyL2, setBatchStrategyL2] = useState("")
  const [batchStrategyL3, setBatchStrategyL3] = useState("")
  // Single-fund strategy edit dialog
  const [showEditStrategyDialog, setShowEditStrategyDialog] = useState(false)
  const [editStrategyBeianHao, setEditStrategyBeianHao] = useState<string | null>(null)
  const [editStrategyName, setEditStrategyName] = useState("")
  const [editStrategyL1, setEditStrategyL1] = useState("")
  const [editStrategyL2, setEditStrategyL2] = useState("")
  const [editStrategyL3, setEditStrategyL3] = useState("")
  const [editStrategySaving, setEditStrategySaving] = useState(false)
  // Note dialog
  const [showNoteDialog, setShowNoteDialog] = useState(false)
  const [noteBeianHao, setNoteBeianHao] = useState<string | null>(null)
  const [noteName, setNoteName] = useState("")
  const [noteText, setNoteText] = useState("")
  const [noteSaving, setNoteSaving] = useState(false)
  const [showPersonalNoteDialog, setShowPersonalNoteDialog] = useState(false)
  const [personalNoteBeianHao, setPersonalNoteBeianHao] = useState<string | null>(null)
  const [personalNoteName, setPersonalNoteName] = useState("")
  const [personalNoteText, setPersonalNoteText] = useState("")
  const [personalNoteSaving, setPersonalNoteSaving] = useState(false)
  // Notes map: beian_hao -> note record (null means no note)
  const [fundNotes, setFundNotes] = useState<Record<string, { note: string; updated_by: string; updated_at: string } | undefined>>({})
  const [openNotePopup, setOpenNotePopup] = useState<string | null>(null)
  const [notePopupPos, setNotePopupPos] = useState<{ x: number; y: number } | null>(null)
  const [showBatchMoveDialog, setShowBatchMoveDialog] = useState(false)
  const [batchMoveTargetPool, setBatchMoveTargetPool] = useState("")
  const [batchMoveMode, setBatchMoveMode] = useState<"move" | "copy">("move")
  const [showBatchConfirmDialog, setShowBatchConfirmDialog] = useState(false)
  const [batchConfirmTitle, setBatchConfirmTitle] = useState("")
  const [batchConfirmMessage, setBatchConfirmMessage] = useState("")
  const [batchConfirmAction, setBatchConfirmAction] = useState<"remove_strategy" | "remove_tags" | "remove" | "">("")
  const [batchContextPool, setBatchContextPool] = useState("")
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [showAddMetricDialog, setShowAddMetricDialog] = useState(false)
  const [showInterval, setShowInterval] = useState(false)
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null)
  const [hoverChartRow, setHoverChartRow] = useState<string | null>(null)
  const [hoverChartPos, setHoverChartPos] = useState<{ x: number; y: number } | null>(null)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [addMetricPeriod, setAddMetricPeriod] = useState("近一月")
  const [addMetricDraftItems, setAddMetricDraftItems] = useState<{period: string; metric: string}[]>([])
  const [addMetricApplied, setAddMetricApplied] = useState<{period: string; metric: string}[]>([])
  const [addMetricDragIdx, setAddMetricDragIdx] = useState<number | null>(null)
  const [showTeamTemplateMenu, setShowTeamTemplateMenu] = useState(false)
  const [showMineTemplateMenu, setShowMineTemplateMenu] = useState(false)
  const [trackingTemplates, setTrackingTemplates] = useState<{name: string; items: {period: string; metric: string}[]}[]>(() => {
    if (typeof window === "undefined") return []
    try { return JSON.parse(localStorage.getItem("tracking_metric_templates") ?? "[]") } catch { return [] }
  })
  const [showSingleAddDialog, setShowSingleAddDialog] = useState(false)
  const [addFundClass, setAddFundClass] = useState<"private" | "public">("private")
  const [addFundSearch, setAddFundSearch] = useState("")
  const [addFundSelectedTags, setAddFundSelectedTags] = useState<string[]>([])
  const [addFundTeamTags, setAddFundTeamTags] = useState<string[]>([])
  const [addFundResults, setAddFundResults] = useState<{beian_hao:string;product_name:string;short_name:string|null;strategy_one:string|null}[]>([])
  const [addFundLoading, setAddFundLoading] = useState(false)
  const [addFundSelected, setAddFundSelected] = useState<{beian_hao:string;product_name:string}|null>(null)
  const [addFundShowDropdown, setAddFundShowDropdown] = useState(false)
  const addFundSearchRef = useRef<ReturnType<typeof setTimeout>|null>(null)
  const [myFundClass, setMyFundClass] = useState<"private" | "public">("private")
  const [myOrgSize, setMyOrgSize] = useState("不限")
  const [myKwInput, setMyKwInput] = useState("")
  const [myKeyword, setMyKeyword] = useState("")
  const [myPersonalTagMode, setMyPersonalTagMode] = useState<"and" | "or">("and")
  const [myPersonalTagOptions, setMyPersonalTagOptions] = useState<string[]>([])
  const [myPersonalTags, setMyPersonalTags] = useState<string[]>([])
  const [teamCutoffDate, setTeamCutoffDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [showTeamDatePicker, setShowTeamDatePicker] = useState(false)
  const [mineCutoffDate, setMineCutoffDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [showMineDatePicker, setShowMineDatePicker] = useState(false)
  const [addFundTargetPool, setAddFundTargetPool] = useState("")
  const [addFundSaving, setAddFundSaving] = useState(false)
  const [addFundError, setAddFundError] = useState<string | null>(null)
  const [dataReloadKey, setDataReloadKey] = useState(0)
  // Batch add dialog
  const [showBatchAddDialog, setShowBatchAddDialog] = useState(false)
  const [batchAddTargetPool, setBatchAddTargetPool] = useState("")
  const [batchAddText, setBatchAddText] = useState("")
  const [batchAddSearching, setBatchAddSearching] = useState(false)
  const [batchAddResults, setBatchAddResults] = useState<{beian_hao:string;product_name:string;short_name:string|null;strategy_one:string|null}[]>([])
  const [batchAddChecked, setBatchAddChecked] = useState<Set<string>>(new Set())
  const [batchAddSelectedTags, setBatchAddSelectedTags] = useState<string[]>([])
  const [batchAddTeamTags, setBatchAddTeamTags] = useState<string[]>([])
  const [batchAddSaving, setBatchAddSaving] = useState(false)
  const [batchAddError, setBatchAddError] = useState<string|null>(null)
  // Fund elements dialog
  const [showElementsDialog, setShowElementsDialog] = useState(false)
  const [elementsBeianHao, setElementsBeianHao] = useState<string | null>(null)
  const [elementsName, setElementsName] = useState("")
  const [elementsData, setElementsData] = useState<Record<string, string | null> | null>(null)
  const [elementsLoading, setElementsLoading] = useState(false)

  useEffect(() => {
    if (!showElementsDialog || !elementsBeianHao) return
    setElementsData(null)
    setElementsLoading(true)
    fetch(`/ma/api/tracking-funds/fund-elements?beian_hao=${encodeURIComponent(elementsBeianHao)}`)
      .then((r) => r.json())
      .then((d) => { setElementsData(d); setElementsLoading(false) })
      .catch(() => setElementsLoading(false))
  }, [showElementsDialog, elementsBeianHao])

  const isSupportedPool = pools.some((p) => p.key === activePool)
  const sourcePool = activePool === "bfl_ops" || isSupportedPool ? activePool : "bfl"
  const isMineTab = !isOps && trackTab === "mine"
  const isMyPoolSupported = myActivePool === "mine_all" || myActivePool === "mine_default" || myActivePool.startsWith("mine_custom_")
  const listPool = isMineTab ? myActivePool : sourcePool
  const listPoolSupported = isMineTab ? isMyPoolSupported : (activePool === "bfl_ops" || isSupportedPool)

  function currentUserId(): string {
    try {
      const u = JSON.parse(localStorage.getItem("currentUser") || "null")
      return u?.id ?? ""
    } catch {
      return ""
    }
  }

  function userFetchHeaders(): Record<string, string> {
    const id = currentUserId()
    return id ? { "x-market-user-id": id } : {}
  }

  function currentUserName(): string {
    try {
      const u = JSON.parse(localStorage.getItem("currentUser") || "null")
      return u?.name || u?.email || ""
    } catch {
      return ""
    }
  }

  function personalTagsSettingsUrl() {
    return "/ma/dashboard/settings?section=personal-tags&category=fund"
  }

  function loadPersonalTagOptions() {
    const owner = encodeURIComponent(currentUserName())
    return fetch(`/ma/api/ops/team-tags?category=fund_personal&owner=${owner}`)
      .then((r) => r.json())
      .then((d) => {
        if (!Array.isArray(d)) return
        const names = d.map((t: { name: string }) => t.name)
        setEditPersonalTagOptions(names)
        setMyPersonalTagOptions(names)
      })
      .catch(() => {})
  }

  function toggleMyPersonalTag(tag: string) {
    setMyPersonalTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])
    setPage(1)
  }

  // Derived hierarchy slices
  const l2Options = strategyL1
    ? (strategyHierarchy.find((n) => n.l1 === strategyL1)?.l2s ?? [])
    : []
  const l3Options = strategyL2
    ? (l2Options.find((n) => n.l2 === strategyL2)?.l3s ?? [])
    : []

  // Fetch strategy hierarchy by source
  useEffect(() => {
    const params = new URLSearchParams({ strategy_source: strategySource, pool: sourcePool })
    fetch(`/ma/api/tracking-funds/strategies?${params}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setStrategyHierarchy(d) : null)
      .catch(() => {})
  }, [strategySource, sourcePool])

  useEffect(() => {
    const params = new URLSearchParams({ pool: sourcePool })
    fetch(`/ma/api/tracking-funds/team-tags?${params}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setTeamTagOptions(d) : null)
      .catch(() => {})
  }, [sourcePool])

  const totalPages = Math.max(1, Math.ceil(total / 50))
  const trackingFilterKey = `${sourcePool}\u0000${strategySource}\u0000${orgSizeFilter}\u0000${teamTagMode}\u0000${teamTags.join("\u0001")}\u0000${teamCutoffDate}\u0000${dataReloadKey}`
  const mineFilterKey = `${myActivePool}\u0000${myOrgSize}\u0000${myKeyword}\u0000${mineCutoffDate}\u0000${myPersonalTagMode}\u0000${myPersonalTags.join("\u0001")}\u0000${dataReloadKey}`

  function handleSort(col: string) {
    if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    else { setSortCol(col); setSortDir("desc") }
    setPage(1)
  }

  function SortIco({ col }: { col: string }) {
    if (sortCol !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function toggleAll() {
    if (selected.size === data.length && data.length > 0) setSelected(new Set())
    else setSelected(new Set(data.map((r) => r.beian_hao)))
  }

  function jumpTo() {
    const n = parseInt(jumpVal)
    if (!isNaN(n)) { setPage(Math.min(totalPages, Math.max(1, n))); setJumpVal("") }
  }

  async function openNoteDialog(beian_hao: string, product_name: string) {
    setNoteBeianHao(beian_hao)
    setNoteName(product_name)
    setNoteText("")
    setShowNoteDialog(true)
    try {
      const res = await fetch(`/ma/api/tracking-funds/fund-note?beian_hao=${encodeURIComponent(beian_hao)}`)
      const d = await res.json()
      setNoteText(d.note ?? "")
    } catch { /* ignore */ }
  }

  async function openPersonalNoteDialog(beian_hao: string, product_name: string) {
    setPersonalNoteBeianHao(beian_hao)
    setPersonalNoteName(product_name)
    setPersonalNoteText("")
    setShowPersonalNoteDialog(true)
    try {
      const res = await fetch(`/ma/api/tracking-funds/personal-fund-note?beian_hao=${encodeURIComponent(beian_hao)}`, {
        headers: userFetchHeaders(),
      })
      const d = await res.json()
      setPersonalNoteText(d.note ?? "")
    } catch { /* ignore */ }
  }

  async function openEditStrategyDialog(beian_hao: string, product_name: string) {
    // pre-load current strategy from type6_ops_team_full via the strategies endpoint
    setEditStrategyBeianHao(beian_hao)
    setEditStrategyName(product_name)
    setEditStrategyL1("")
    setEditStrategyL2("")
    setEditStrategyL3("")
    setShowEditStrategyDialog(true)
    try {
      const res = await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}`)
      const d = await res.json()
      if (d?.strategy_l1) setEditStrategyL1(d.strategy_l1)
      if (d?.strategy_l2) setEditStrategyL2(d.strategy_l2)
      if (d?.strategy_l3) setEditStrategyL3(d.strategy_l3)
    } catch { /* ignore */ }
  }

  async function openEditTagDialog(beian_hao: string, product_name: string) {
    setEditTagBeianHao(beian_hao)
    setEditTagName(product_name)
    setEditTagSelected([])
    setEditTagTeamTags([])
    setShowEditTagDialog(true)
    const [tagsRes, teamTagsRes] = await Promise.all([
      fetch(`/ma/api/tracking-funds/fund-tags?beian_hao=${encodeURIComponent(beian_hao)}`).then((r) => r.json()).catch(() => []),
      fetch("/ma/api/ops/team-tags?category=fund").then((r) => r.json()).catch(() => []),
    ])
    if (Array.isArray(tagsRes)) setEditTagSelected(tagsRes)
    if (Array.isArray(teamTagsRes)) setEditTagTeamTags(teamTagsRes.map((t: { name: string }) => t.name))
  }

  async function openPersonalEditTagDialog(beian_hao: string, product_name: string) {
    setEditPersonalTagBeianHao(beian_hao)
    setEditPersonalTagName(product_name)
    setEditPersonalTagSelected([])
    setEditPersonalTagOptions([])
    setShowPersonalEditTagDialog(true)
    const [tagsRes, personalTagsRes] = await Promise.all([
      fetch(`/ma/api/tracking-funds/personal-fund-tags?beian_hao=${encodeURIComponent(beian_hao)}`, { headers: userFetchHeaders() }).then((r) => r.json()).catch(() => []),
      fetch(`/ma/api/ops/team-tags?category=fund_personal&owner=${encodeURIComponent(currentUserName())}`).then((r) => r.json()).catch(() => []),
    ])
    if (Array.isArray(tagsRes)) setEditPersonalTagSelected(tagsRes)
    if (Array.isArray(personalTagsRes)) setEditPersonalTagOptions(personalTagsRes.map((t: { name: string }) => t.name))
  }

  async function handleTrackExport(
    filename: string,
    opts?: { pool?: string; keyword?: string; orgSize?: string; cutoff?: string }
  ) {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const exportPool = opts?.pool ?? sourcePool
    const exportKeyword = opts?.keyword ?? keyword
    const exportOrgSize = opts?.orgSize ?? orgSizeFilter
    const exportCutoff = opts?.cutoff ?? teamCutoffDate
    const params = new URLSearchParams({
      export: "1", sort: sortCol, dir: sortDir, keyword: exportKeyword,
      pool: exportPool,
      strategy_l1: strategyL1,
      strategy_l2: strategyL2,
      strategy_l3: strategyL3,
      strategy_source: strategySource,
      org_size: exportOrgSize,
      team_tag_mode: teamTagMode,
      cutoff: exportCutoff,
    })
    teamTags.forEach((tag) => params.append("team_tag", tag))
    const json = await fetch(`/ma/api/tracking-funds/list?${params}`).then((r) => r.json())
    const rows: TrackFundRow[] = json.data ?? []
    const headers = ["备案号", "基金名称", "简称", "一级策略", "二级策略", "管理人", "成立日期", "最新净值", "净值日期", "最新涨跌幅", "近1周", "近1月", "近3月", "近6月", "近1年", "夏普(1Y)", "卡玛(1Y)"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.beian_hao), escape(r.product_name), escape(r.short_name),
        escape(r.strategy_l1), escape(r.strategy_l2), escape(r.manager), escape(r.inception_date),
        escape(r.latest_nav), escape(r.latest_nav_date), escape(r.latest_price_change),
        escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m), escape(r.ret_1y),
        escape(r.sharpe_1y), escape(r.calmar_1y),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleBatchOp(
    action: string,
    extra: Record<string, unknown> = {}
  ) {
    const beian_haos = Array.from(selected)
    if (beian_haos.length === 0) return
    setBatchSubmitting(true)
    try {
      const res = await fetch("/ma/api/tracking-funds/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, beian_haos, pool: batchContextPool, ...extra }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error("[batch op]", err)
      }
    } catch (err) {
      console.error("[batch op]", err)
    } finally {
      setBatchSubmitting(false)
      setSelected(new Set())
      setDataReloadKey((k) => k + 1)
    }
  }

  function pageButtons(): (number | string)[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const btns: (number | string)[] = [1]
    if (page > 3) btns.push("…")
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) btns.push(i)
    if (page < totalPages - 2) btns.push("…")
    btns.push(totalPages)
    return btns
  }

  useEffect(() => {
    if (!listPoolSupported) {
      setData([])
      setTotal(0)
      return
    }
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page), sort: sortCol, dir: sortDir,
      pool: listPool,
      strategy_source: strategySource,
      cutoff: isMineTab ? mineCutoffDate : teamCutoffDate,
      org_size: isMineTab ? myOrgSize : orgSizeFilter,
      keyword: isMineTab ? myKeyword : keyword,
      team_tag_mode: teamTagMode,
    })
    if (!isMineTab) {
      params.set("strategy_l1", strategyL1)
      params.set("strategy_l2", strategyL2)
      params.set("strategy_l3", strategyL3)
      teamTags.forEach((tag) => params.append("team_tag", tag))
    } else {
      params.set("personal_tag_mode", myPersonalTagMode)
      myPersonalTags.forEach((tag) => params.append("personal_tag", tag))
    }
    fetch(`/ma/api/tracking-funds/list?${params}`, {
      headers: isMineTab ? userFetchHeaders() : {},
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          setData([])
          setTotal(0)
          return
        }
        setData(d.data ?? [])
        setTotal(d.total ?? 0)
      })
      .catch(() => { setData([]); setTotal(0) })
      .finally(() => setLoading(false))
  }, [listPool, listPoolSupported, isMineTab, page, sortCol, sortDir, keyword, strategyL1, strategyL2, strategyL3, trackingFilterKey, mineFilterKey])

  useEffect(() => {
    setPage(1)
    setSelected(new Set())
  }, [trackTab, myActivePool, myOrgSize, myKeyword, myPersonalTags.join("\u0001")])

  useEffect(() => {
    if (!isMineTab) return
    loadPersonalTagOptions()
  }, [isMineTab, dataReloadKey])

  useEffect(() => {
    setFundNotes({})
  }, [trackTab])

  // Batch-load notes for current page rows
  useEffect(() => {
    if (data.length === 0) return
    const ids = data.map((r) => r.beian_hao).join(",")
    const noteUrl = isMineTab
      ? `/ma/api/tracking-funds/personal-fund-note?beian_haos=${encodeURIComponent(ids)}`
      : `/ma/api/tracking-funds/fund-note?beian_haos=${encodeURIComponent(ids)}`
    fetch(noteUrl, { headers: isMineTab ? userFetchHeaders() : {} })
      .then((r) => r.json())
      .then((d) => { if (d && typeof d === "object" && !d.error) setFundNotes((prev) => ({ ...prev, ...d })) })
      .catch(() => {})
  }, [data, isMineTab])

  // Debounced search for 添加跟踪产品 dialog
  useEffect(() => {
    if (!showSingleAddDialog) return
    fetch("/ma/api/ops/team-tags?category=fund")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setAddFundTeamTags(d.map((t: { name: string }) => t.name)) : null)
      .catch(() => {})
  }, [showSingleAddDialog])

  useEffect(() => {
    if (!showBatchAddDialog) return
    fetch("/ma/api/ops/team-tags?category=fund")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setBatchAddTeamTags(d.map((t: { name: string }) => t.name)) : null)
      .catch(() => {})
  }, [showBatchAddDialog])

  useEffect(() => {
    if (!showSingleAddDialog) return
    if (!addFundSearch.trim()) {
      setAddFundResults([])
      setAddFundShowDropdown(false)
      return
    }
    if (addFundSearchRef.current) clearTimeout(addFundSearchRef.current)
    addFundSearchRef.current = setTimeout(async () => {
      setAddFundLoading(true)
      try {
        const res = await fetch(`/ma/api/tracking-funds/search?q=${encodeURIComponent(addFundSearch.trim())}`)
        const data = await res.json()
        setAddFundResults(Array.isArray(data) ? data : [])
        setAddFundShowDropdown(true)
      } catch {
        setAddFundResults([])
      } finally {
        setAddFundLoading(false)
      }
    }, 250)
    return () => {
      if (addFundSearchRef.current) clearTimeout(addFundSearchRef.current)
    }
  }, [addFundSearch, showSingleAddDialog])

  function toggleTeamTag(tag: string) {
    setTeamTags((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])
    setPage(1)
  }

  return (
    <div className="flex flex-col h-full min-w-0 overflow-x-hidden">
      {isOps ? (
        <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0 overflow-x-auto">
          {pools.map((p) => (
            <button
              key={p.key}
              onClick={() => { setActivePool(p.key); setPage(1); setSelected(new Set()) }}
              className={[
                "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap flex-shrink-0",
                activePool === p.key
                  ? "border-red-500 text-red-600 dark:text-red-400"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0">
          {(["team", "mine"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTrackTab(t)}
              className={[
                "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                trackTab === t
                  ? "border-red-500 text-red-600 dark:text-red-400"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {t === "team" ? "团队跟踪" : "我的跟踪"}
            </button>
          ))}
        </div>
      )}

      {(isOps || trackTab === "team") && (
      <div className="flex gap-0 flex-1 min-h-0">
        {!isOps && (
        <aside className="w-32 flex-shrink-0 border-r">
          <div className="flex items-center gap-1 px-2 py-2 border-b">
            <button
              onClick={() => { setNewPoolName(""); setShowNewPoolDialog(true) }}
              className="flex-1 inline-flex items-center justify-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-muted/60 rounded px-2 py-1 transition-colors"
            >
              <span className="text-base leading-none">⊕</span>
              <span>新增</span>
            </button>
            <button
              onClick={() => { setEditingPoolKey(null); setShowManageDialog(true) }}
              className="flex-1 inline-flex items-center justify-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-muted/60 rounded px-2 py-1 transition-colors"
            >
              <span className="text-sm leading-none">⚙</span>
              <span>管理</span>
            </button>
          </div>
          <nav className="flex flex-col gap-0.5 p-1.5">
            {pools.map((p) => (
              <button
                key={p.key}
                onClick={() => { setActivePool(p.key); setPage(1); setSelected(new Set()) }}
                className={[
                  "w-full text-left px-3 py-2 rounded text-sm transition-colors",
                  activePool === p.key
                    ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400 font-medium"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                ].join(" ")}
              >
                {p.label}
              </button>
            ))}
          </nav>
        </aside>
        )}

        {/* Main content */}
        <div className={`flex-1 flex flex-col min-w-0 ${isOps ? "" : "pl-4"}`}>
          {/* Filter bar */}
          <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
            {/* 基金分类 */}
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">基金分类：</span>
              <div className="flex items-center gap-1">
                {(["private", "public"] as const).map((fc) => (
                  <span
                    key={fc}
                    onClick={() => setFundClass(fc)}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                      fundClass === fc
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                        : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                    ].join(" ")}
                  >
                    {fc === "private" ? "私募" : "公募"}
                  </span>
                ))}
              </div>
            </div>
            {/* 一级策略 */}
            <div className="flex items-start px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">一级策略：</span>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <select
                    value={strategySource}
                    onChange={(e) => {
                      const next = e.target.value as TrackStrategySource
                      if (strategySource === next) return
                      setStrategySource(next)
                      setStrategyL1("")
                      setStrategyL2("")
                      setStrategyL3("")
                      setPage(1)
                    }}
                    className="h-7 min-w-[6.25rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="company">团队策略</option>
                    <option value="platform">平台策略</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                </div>
                <span
                  onClick={() => { setStrategyL1(""); setStrategyL2(""); setStrategyL3(""); setPage(1) }}
                  className={[
                    "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                    !strategyL1
                      ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                      : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                  ].join(" ")}
                >
                  不限
                </span>
                {strategyHierarchy.map((node) => (
                  <span
                    key={node.l1}
                    onClick={() => {
                      const next = strategyL1 === node.l1 ? "" : node.l1
                      setStrategyL1(next); setStrategyL2(""); setStrategyL3(""); setPage(1)
                    }}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                      strategyL1 === node.l1
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                        : "border-border text-zinc-500 hover:bg-muted/60",
                    ].join(" ")}
                  >
                    {node.l1}
                  </span>
                ))}
              </div>
            </div>
            {/* 二级策略 — only when l1 is selected and has l2 options */}
            {strategyL1 && l2Options.length > 0 && (
              <div className="flex items-start px-4 py-2 bg-muted/20">
                <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">二级策略：</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    onClick={() => { setStrategyL2(""); setStrategyL3(""); setPage(1) }}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                      !strategyL2
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                        : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                    ].join(" ")}
                  >
                    不限
                  </span>
                  {l2Options.map((node) => (
                    <span
                      key={node.l2}
                      onClick={() => {
                        const next = strategyL2 === node.l2 ? "" : node.l2
                        setStrategyL2(next); setStrategyL3(""); setPage(1)
                      }}
                      className={[
                        "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                        strategyL2 === node.l2
                          ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                          : "border-border text-zinc-500 hover:bg-muted/60",
                      ].join(" ")}
                    >
                      {node.l2}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* 三级策略 — only when l2 is selected and has l3 options */}
            {strategyL2 && l3Options.length > 0 && (
              <div className="flex items-start px-4 py-2 bg-muted/30">
                <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">三级策略：</span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    onClick={() => { setStrategyL3(""); setPage(1) }}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                      !strategyL3
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                        : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                    ].join(" ")}
                  >
                    不限
                  </span>
                  {l3Options.map((v) => (
                    <span
                      key={v}
                      onClick={() => { setStrategyL3(strategyL3 === v ? "" : v); setPage(1) }}
                      className={[
                        "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                        strategyL3 === v
                          ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                          : "border-border text-zinc-500 hover:bg-muted/60",
                      ].join(" ")}
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* 团队标签 */}
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">团队标签：</span>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <select
                    value={teamTagMode}
                    onChange={(e) => { setTeamTagMode(e.target.value as TrackTeamTagMode); setPage(1) }}
                    className="h-7 min-w-[5.75rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="and">交集（且）</option>
                    <option value="or">并集（或）</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                </div>
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
            {!isOps && (
            <>
            {/* 管理人规模 */}
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-20 whitespace-nowrap text-right pr-3">管理人规模：</span>
              <div className="flex items-center gap-1 flex-wrap">
                {ORG_SIZE_OPTS.map((s) => (
                  <span
                    key={s}
                    onClick={() => { setOrgSizeFilter(s); setPage(1) }}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                      orgSizeFilter === s
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                        : s === "不限"
                          ? "border-border text-zinc-500 hover:border-red-300 hover:text-red-500"
                          : "border-border text-zinc-500 hover:bg-muted/60",
                    ].join(" ")}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
            {/* 关键字 */}
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">关 键 字：</span>
              <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-60">
                <input
                  className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
                  placeholder="输入产品/产品备案号，回车搜索"
                  value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput)}
                />
                <button onClick={() => setKeyword(kwInput)} className="text-muted-foreground hover:text-foreground transition-colors">
                  <Search className="h-3 w-3" />
                </button>
              </div>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none ml-3">
                <input type="checkbox" className="rounded h-3 w-3" />
                收藏
              </label>
            </div>
            </>
            )}
          </div>

          {/* Toolbar */}
          {isOps ? (
          <div className="flex items-center justify-between mb-3 flex-shrink-0 gap-3">
            <div className="flex items-center border rounded-lg px-3 h-8 gap-2 bg-background flex-1 max-w-md">
              <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <input
                className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
                placeholder="请输入产品/产品备案号，按回车搜索"
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput)}
              />
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-600 flex-shrink-0">
              <button
                onClick={() => setShowAuditLogDialog(true)}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                <ClipboardList className="h-3.5 w-3.5" /> 操作日志
              </button>
              <button
                onClick={() => { setFieldConfigDraft([...fieldConfigSelected]); setFieldConfigTab("基本信息"); setShowFieldConfigDialog(true) }}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                <Settings2 className="h-3.5 w-3.5" /> 字段配置
              </button>
              <button
                onClick={() => handleTrackExport(`跟踪产品_${new Date().toISOString().slice(0, 10)}.csv`)}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                <Download className="h-3.5 w-3.5" /> 导出
              </button>
              <div className="relative">
                <button
                  disabled={selected.size === 0}
                  onClick={() => { setBatchContextPool(sourcePool); setShowTeamBatchMenu((v) => !v) }}
                  className="inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground">
                  批量操作
                  {selected.size > 0 && <span className="text-red-500">({selected.size})</span>}
                </button>
                {showTeamBatchMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowTeamBatchMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[130px]" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchTagSelected([]); fetch("/ma/api/ops/team-tags?category=fund").then((r) => r.json()).then((d) => Array.isArray(d) ? setBatchTagTeamTags(d.map((t: { name: string }) => t.name)) : null).catch(() => {}); setShowBatchTagDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量添加标签</button>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchStrategyL1(""); setBatchStrategyL2(""); setBatchStrategyL3(""); setShowBatchStrategyDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量添加策略</button>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchMoveTargetPool(""); setBatchMoveMode("move"); setShowBatchMoveDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量移动到</button>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchMoveTargetPool(""); setBatchMoveMode("copy"); setShowBatchMoveDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量复制到</button>
                      <div className="border-t my-1" />
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchConfirmTitle("批量取消策略"); setBatchConfirmMessage(`确定要为已选 ${selected.size} 只产品批量取消策略吗？`); setBatchConfirmAction("remove_strategy"); setShowBatchConfirmDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-zinc-500">批量取消策略</button>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchConfirmTitle("批量取消标签"); setBatchConfirmMessage(`确定要为已选 ${selected.size} 只产品批量清除所有标签吗？`); setBatchConfirmAction("remove_tags"); setShowBatchConfirmDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-zinc-500">批量取消标签</button>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchConfirmTitle("批量取消跟踪"); setBatchConfirmMessage(`确定要将已选 ${selected.size} 只产品从当前产品池中移除吗？`); setBatchConfirmAction("remove"); setShowBatchConfirmDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-red-500">批量取消跟踪</button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => { setBatchAddText(""); setBatchAddResults([]); setBatchAddChecked(new Set()); setBatchAddSelectedTags([]); setBatchAddError(null); setBatchAddTargetPool(sourcePool); setShowBatchAddDialog(true) }}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                批量上传
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowTeamAddMenu((v) => !v)}
                  className="inline-flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white rounded px-3 py-1.5 font-medium transition-colors">
                  添加跟踪
                </button>
                {showTeamAddMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowTeamAddMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[100px]" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => { setShowTeamAddMenu(false); setAddFundSearch(""); setAddFundSelectedTags([]); setAddFundSelected(null); setAddFundResults([]); setAddFundShowDropdown(false); setAddFundError(null); setAddFundTargetPool(sourcePool); setShowSingleAddDialog(true) }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">
                        单只添加
                      </button>
                      <button
                        onClick={() => { setShowTeamAddMenu(false); setBatchAddText(""); setBatchAddResults([]); setBatchAddChecked(new Set()); setBatchAddSelectedTags([]); setBatchAddError(null); setBatchAddTargetPool(sourcePool); setShowBatchAddDialog(true) }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">
                        批量添加
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          ) : (
          <div className="flex items-center justify-between mb-2 flex-shrink-0 text-xs">
            <div className="flex items-center gap-1.5 text-zinc-500">
              <span>指标计算截止日期</span>
              <span className="text-zinc-400">①</span>
              <div className="relative">
                <button
                  onClick={() => setShowTeamDatePicker((v) => !v)}
                  className="inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-zinc-600 hover:bg-muted cursor-pointer transition-colors">
                  <CalendarDays className="h-3 w-3" />
                  <span className="tabular-nums">{teamCutoffDate}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
                {showTeamDatePicker && (
                  <div className="absolute left-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg p-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="date"
                      value={teamCutoffDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => { if (e.target.value) { setTeamCutoffDate(e.target.value); setShowTeamDatePicker(false) } }}
                      className="border rounded px-2 py-1 text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
                      autoFocus
                    />
                  </div>
                )}
                {showTeamDatePicker && <div className="fixed inset-0 z-30" onClick={() => setShowTeamDatePicker(false)} />}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
                <input type="checkbox" defaultChecked className="rounded h-3 w-3 accent-zinc-700" />
                计算指标
              </label>
              <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
                <input type="checkbox" checked={showInterval} onChange={(e) => setShowInterval(e.target.checked)} className="rounded h-3 w-3 accent-zinc-700" />
                显示区间
              </label>
              <div className="relative">
                <button
                  onClick={() => setShowTeamTemplateMenu((v) => !v)}
                  className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
                  <LayoutTemplate className="h-3 w-3" />
                  {trackingTemplates.length > 0 ? `模板(${trackingTemplates.length})` : "默认模板"}
                  <ChevronDown className="h-3 w-3" />
                </button>
                {showTeamTemplateMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowTeamTemplateMenu(false)} />
                    <div className="absolute left-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setAddMetricApplied([]); setShowTeamTemplateMenu(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                        <LayoutTemplate className="h-3.5 w-3.5 text-zinc-400" /> 默认模板
                      </button>
                      {trackingTemplates.length > 0 && <div className="border-t my-1" />}
                      {trackingTemplates.map((t, i) => (
                        <button key={i} onClick={() => { setAddMetricApplied([...t.items]); setShowTeamTemplateMenu(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors truncate">{t.name}</button>
                      ))}
                      <div className="border-t my-1" />
                      <button onClick={() => { setShowTeamTemplateMenu(false); window.open("/ma/dashboard/settings?tab=metric-templates", "_blank") }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-zinc-500">管理模板</button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => { setAddMetricDraftItems([...addMetricApplied]); setShowAddMetricDialog(true) }}
                className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
                <PlusCircle className="h-3 w-3" />
                {addMetricApplied.length > 0 ? `添加指标(${addMetricApplied.length})` : "添加指标"}
              </button>
              <div className="relative">
                <button
                  disabled={selected.size === 0}
                  onClick={() => { setBatchContextPool(sourcePool); setShowTeamBatchMenu((v) => !v) }}
                  className="inline-flex items-center gap-1 border border-border/50 rounded px-2 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-zinc-600 hover:text-foreground hover:bg-muted/60 disabled:hover:bg-transparent disabled:hover:text-zinc-600">
                  批量操作
                  {selected.size > 0 && <span className="text-xs text-red-500">({selected.size})</span>}
                </button>
                {showTeamBatchMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowTeamBatchMenu(false)} />
                    <div className="absolute left-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[130px]" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchTagSelected([]); fetch("/ma/api/ops/team-tags?category=fund").then((r) => r.json()).then((d) => Array.isArray(d) ? setBatchTagTeamTags(d.map((t: { name: string }) => t.name)) : null).catch(() => {}); setShowBatchTagDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量添加标签</button>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchStrategyL1(""); setBatchStrategyL2(""); setBatchStrategyL3(""); setShowBatchStrategyDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量添加策略</button>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchMoveTargetPool(""); setBatchMoveMode("move"); setShowBatchMoveDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量移动到</button>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchMoveTargetPool(""); setBatchMoveMode("copy"); setShowBatchMoveDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量复制到</button>
                      <div className="border-t my-1" />
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchConfirmTitle("批量取消策略"); setBatchConfirmMessage(`确定要为已选 ${selected.size} 只产品批量取消策略吗？`); setBatchConfirmAction("remove_strategy"); setShowBatchConfirmDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-zinc-500">批量取消策略</button>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchConfirmTitle("批量取消标签"); setBatchConfirmMessage(`确定要为已选 ${selected.size} 只产品批量清除所有标签吗？`); setBatchConfirmAction("remove_tags"); setShowBatchConfirmDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-zinc-500">批量取消标签</button>
                      <button onClick={() => { setShowTeamBatchMenu(false); setBatchConfirmTitle("批量取消跟踪"); setBatchConfirmMessage(`确定要将已选 ${selected.size} 只产品从当前产品池中移除吗？`); setBatchConfirmAction("remove"); setShowBatchConfirmDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-red-500">批量取消跟踪</button>
                    </div>
                  </>
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowTeamMoreMenu((v) => !v)}
                  className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
                  ⊕ 更多
                </button>
                {showTeamMoreMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowTeamMoreMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[120px]" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setShowTeamMoreMenu(false)} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 text-zinc-400" /> 刷新指标
                      </button>
                      <button onClick={() => { setShowTeamMoreMenu(false); setFieldConfigDraft([...fieldConfigSelected]); setFieldConfigTab("基本信息"); setShowFieldConfigDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                        <Settings2 className="h-3.5 w-3.5 text-zinc-400" /> 字段配置
                      </button>
                      <button onClick={() => { setShowTeamMoreMenu(false); setShowAuditLogDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                        <ClipboardList className="h-3.5 w-3.5 text-zinc-400" /> 操作日志
                      </button>
                      <button onClick={() => { setShowTeamMoreMenu(false); handleTrackExport(`团队跟踪_${new Date().toISOString().slice(0, 10)}.csv`) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                        <Download className="h-3.5 w-3.5 text-zinc-400" /> 导出
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowTeamAddMenu((v) => !v)}
                  className="inline-flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white rounded px-3 py-1.5 font-medium transition-colors">
                  添加跟踪
                </button>
                {showTeamAddMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowTeamAddMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[100px]" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => { setShowTeamAddMenu(false); setAddFundSearch(""); setAddFundSelectedTags([]); setAddFundSelected(null); setAddFundResults([]); setAddFundShowDropdown(false); setAddFundError(null); setAddFundTargetPool(sourcePool); setShowSingleAddDialog(true) }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">
                        单只添加
                      </button>
                      <button
                        onClick={() => { setShowTeamAddMenu(false); setBatchAddText(""); setBatchAddResults([]); setBatchAddChecked(new Set()); setBatchAddSelectedTags([]); setBatchAddError(null); setBatchAddTargetPool(sourcePool); setShowBatchAddDialog(true) }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">
                        批量添加
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Table */}
          {isOps ? (
          <div className="overflow-auto rounded-lg border flex-1 min-h-0">
            <table className="text-sm border-collapse w-full">
              <thead className="sticky top-0 z-20">
                <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
                  <th className={`${thBase} w-8 px-2`}>
                    <input type="checkbox" className="rounded h-3 w-3"
                      checked={selected.size === data.length && data.length > 0}
                      onChange={toggleAll} />
                  </th>
                  <th className={`${thBase} w-10`}>序号</th>
                  <th className={`${thSort} min-w-[200px]`} onClick={() => handleSort("product_name")}>产品名称<SortIco col="product_name" /></th>
                  <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("beian_hao")}>备案编码<SortIco col="beian_hao" /></th>
                  <th className={`${thSort} min-w-[110px]`} onClick={() => handleSort("latest_nav")}>团队单位净值<SortIco col="latest_nav" /></th>
                  <th className={`${thSort} min-w-[110px]`} onClick={() => handleSort("latest_nav_date")}>团队净值日期<SortIco col="latest_nav_date" /></th>
                  <th className={`${thSort} text-right min-w-[100px]`} onClick={() => handleSort("latest_price_change")}>团队涨跌幅<SortIco col="latest_price_change" /></th>
                  <th className={`${thBase} text-center w-20`}>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
                ) : !isSupportedPool ? (
                  <tr><td colSpan={8} className="py-20 text-center text-muted-foreground">请选择一个跟踪池查看数据</td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={8} className="py-20 text-center text-muted-foreground">暂无数据</td></tr>
                ) : data.map((row, i) => {
                  const isSelected = selected.has(row.beian_hao)
                  const bg = isSelected ? "bg-blue-50 dark:bg-blue-950/40" : "bg-background"
                  const hoverBg = isSelected ? "group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40" : "group-hover:bg-muted"
                  const cell = `border-b px-3 py-2 ${bg} ${hoverBg} transition-colors`
                  return (
                    <tr key={row.beian_hao} className="group">
                      <td className={`${cell} px-2 text-center`}>
                        <input type="checkbox" className="rounded h-3 w-3"
                          checked={isSelected}
                          onChange={() => {
                            const s = new Set(selected)
                            isSelected ? s.delete(row.beian_hao) : s.add(row.beian_hao)
                            setSelected(s)
                          }} />
                      </td>
                      <td className={`${cell} text-center tabular-nums`}>{(page - 1) * 50 + i + 1}</td>
                      <td className={cell}>
                        <a
                          href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beian_hao)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-600 dark:text-blue-400 hover:underline block truncate max-w-[240px]"
                          title={row.product_name}
                        >{row.short_name || row.product_name}</a>
                        {row.strategy_l1 && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] border border-amber-300/80 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700/50">
                            {row.strategy_l1}
                          </span>
                        )}
                      </td>
                      <td className={`${cell} tabular-nums text-muted-foreground`}>{row.beian_hao}</td>
                      <td className={`${cell} tabular-nums font-medium`}>{row.latest_nav ? parseFloat(row.latest_nav).toFixed(4) : "—"}</td>
                      <td className={`${cell} tabular-nums`}>{row.latest_nav_date ?? "—"}</td>
                      <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.latest_price_change} /></td>
                      <td className={`${cell} text-center`}>
                        <div className="flex items-center justify-center gap-1">
                          <div
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
                            }}>
                            <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><LineChart className="h-3.5 w-3.5" /></button>
                          </div>
                          <TrackingRowMenu
                            beian_hao={row.beian_hao}
                            product_name={row.product_name}
                            onQueryElements={() => { setElementsBeianHao(row.beian_hao); setElementsName(row.product_name); setShowElementsDialog(true) }}
                            onEditTags={() => openEditTagDialog(row.beian_hao, row.product_name)}
                            onEditStrategy={() => openEditStrategyDialog(row.beian_hao, row.product_name)}
                            onNoteManage={() => openNoteDialog(row.beian_hao, row.product_name)}
                            onRemove={() => { setBatchContextPool(sourcePool); setBatchConfirmTitle("取消跟踪"); setBatchConfirmMessage(`确定要将「${row.product_name}」从当前产品池中移除吗？`); setBatchConfirmAction("remove"); setSelected(new Set([row.beian_hao])); setShowBatchConfirmDialog(true) }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          ) : (
          <div className="overflow-auto rounded-lg border flex-1 min-h-0">
            <table className="text-sm border-collapse w-full" style={{ minWidth: 1400 }}>
              <thead className="sticky top-0 z-20">
                <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
                  <th className={`${thBase} w-8 px-2 sticky left-0 z-30 bg-muted/40 dark:bg-muted/20`}>
                    <input type="checkbox" className="rounded h-3 w-3"
                      checked={selected.size === data.length && data.length > 0}
                      onChange={toggleAll} />
                  </th>
                  <th className={`${thBase} w-10 sticky left-8 z-30 bg-muted/40 dark:bg-muted/20`}>序号</th>
                  <th className={`${thSort} min-w-[200px] sticky left-[72px] z-30 bg-muted/40 dark:bg-muted/20 border-r border-zinc-200 dark:border-zinc-700`} onClick={() => handleSort("product_name")}>产品名称<SortIco col="product_name" /></th>
                  <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("latest_nav_date")}>最新净值日期<SortIco col="latest_nav_date" /></th>
                  <th className={`${thSort} min-w-[90px]`} onClick={() => handleSort("latest_nav")}>最新单位净值<SortIco col="latest_nav" /></th>
                  <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("latest_price_change")}>最新涨跌幅<SortIco col="latest_price_change" /></th>
                  <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1w")}>
                    <div>近一周收益<SortIco col="ret_1w" /></div>
                    {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(teamCutoffDate, 7)}</div>}
                  </th>
                  <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1m")}>
                    <div>近一月收益<SortIco col="ret_1m" /></div>
                    {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(teamCutoffDate, 30)}</div>}
                  </th>
                  <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_3m")}>
                    <div>近三月收益<SortIco col="ret_3m" /></div>
                    {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(teamCutoffDate, 91)}</div>}
                  </th>
                  <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_6m")}>
                    <div>近六月收益<SortIco col="ret_6m" /></div>
                    {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(teamCutoffDate, 182)}</div>}
                  </th>
                  <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1y")}>
                    <div>近一年收益<SortIco col="ret_1y" /></div>
                    {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(teamCutoffDate, 365)}</div>}
                  </th>
                  <th className={`${thSort} text-right min-w-[98px]`} onClick={() => handleSort("sharpe_1y")}>近一年夏普比率<SortIco col="sharpe_1y" /></th>
                  <th className={`${thSort} text-right min-w-[98px]`} onClick={() => handleSort("calmar_1y")}>近一年卡玛比率<SortIco col="calmar_1y" /></th>
                  <th className={`${thBase} text-center w-16 sticky right-32 z-30 bg-muted/40 dark:bg-muted/20 border-l border-zinc-200 dark:border-zinc-700`}>走势</th>
                  <th className={`${thBase} text-center w-16 sticky right-16 z-30 bg-muted/40 dark:bg-muted/20`}>资料</th>
                  <th className={`${thBase} text-center w-16 sticky right-0 z-30 bg-muted/40 dark:bg-muted/20`}>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={16} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
                ) : !isSupportedPool ? (
                  <tr><td colSpan={16} className="py-20 text-center text-muted-foreground">请选择一个跟踪池查看数据</td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={16} className="py-20 text-center text-muted-foreground">暂无数据</td></tr>
                ) : data.map((row, i) => {
                  const isSelected = selected.has(row.beian_hao)
                  const bg = isSelected ? "bg-blue-50 dark:bg-blue-950/40" : "bg-background"
                  const hoverBg = isSelected ? "group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40" : "group-hover:bg-muted"
                  const cell = `border-b px-3 py-0 ${bg} ${hoverBg} transition-colors`
                  const stickyCell = `${cell} z-10`
                  return (
                    <tr key={row.beian_hao} className="group" style={{ height: 52 }}>
                      <td className={`${stickyCell} px-2 text-center sticky left-0`}>
                        <input type="checkbox" className="rounded h-3 w-3"
                          checked={isSelected}
                          onChange={() => {
                            const s = new Set(selected)
                            isSelected ? s.delete(row.beian_hao) : s.add(row.beian_hao)
                            setSelected(s)
                          }} />
                      </td>
                      <td className={`${stickyCell} text-center tabular-nums sticky left-8`}>{(page - 1) * 50 + i + 1}</td>
                      <td className={`${stickyCell} sticky left-[72px] border-r border-zinc-200 dark:border-zinc-700`}>
                        <a
                          href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beian_hao)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-600 dark:text-blue-400 leading-5 truncate max-w-[220px] hover:underline block"
                          title={row.product_name}
                        >{row.short_name || row.product_name}</a>
                        {row.strategy_l1 && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50 flex-shrink-0" />
                            <span className="text-[10px] text-muted-foreground">{row.strategy_l1}{row.strategy_l2 ? ` · ${row.strategy_l2}` : ""}</span>
                          </div>
                        )}
                      </td>
                      <td className={`${cell} tabular-nums`}>{row.latest_nav_date ?? "—"}</td>
                      <td className={`${cell} tabular-nums`}>
                        <div className="font-medium leading-5">{row.latest_nav ? parseFloat(row.latest_nav).toFixed(4) : "—"}</div>
                      </td>
                      <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.latest_price_change} /></td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_1w} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(teamCutoffDate, 7)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_1m} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(teamCutoffDate, 30)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_3m} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(teamCutoffDate, 91)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_6m} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(teamCutoffDate, 182)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_1y} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(teamCutoffDate, 365)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}><TrackRatioCell value={row.sharpe_1y} /></td>
                      <td className={`${cell} text-right tabular-nums`}><TrackRatioCell value={row.calmar_1y} /></td>
                      <td className={`${stickyCell} text-center sticky right-32 border-l border-zinc-200 dark:border-zinc-700`}>
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
                          }}>
                          <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><LineChart className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                      <td className={`${stickyCell} text-center sticky right-16`}>
                        {fundNotes[row.beian_hao] ? (
                          <div className="relative flex items-center justify-center">
                            <button
                              onClick={(e) => {
                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                setNotePopupPos({ x: rect.left, y: rect.bottom + 4 })
                                setOpenNotePopup(openNotePopup === row.beian_hao ? null : row.beian_hao)
                              }}
                              className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                            </button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={`${stickyCell} text-center sticky right-0`}>
                        <div className="flex items-center justify-center">
                          <TrackingRowMenu
                            beian_hao={row.beian_hao}
                            product_name={row.product_name}
                            onQueryElements={() => { setElementsBeianHao(row.beian_hao); setElementsName(row.product_name); setShowElementsDialog(true) }}
                            onEditTags={() => openEditTagDialog(row.beian_hao, row.product_name)}
                            onEditStrategy={() => openEditStrategyDialog(row.beian_hao, row.product_name)}
                            onNoteManage={() => openNoteDialog(row.beian_hao, row.product_name)}
                            onRemove={() => { setBatchContextPool(sourcePool); setBatchConfirmTitle("取消跟踪"); setBatchConfirmMessage(`确定要将「${row.product_name}」从当前产品池中移除吗？`); setBatchConfirmAction("remove"); setSelected(new Set([row.beian_hao])); setShowBatchConfirmDialog(true) }}
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

          {/* Pagination */}
          {isSupportedPool && (
            <div className="flex items-center justify-between pt-3 flex-shrink-0">
              <span className="text-sm text-zinc-500">共 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{total.toLocaleString()}</span> 只基金</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">‹</button>
                {pageButtons().map((btn, idx) =>
                  btn === "…" ? (
                    <span key={`e${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
                  ) : (
                    <button key={btn} onClick={() => setPage(btn as number)}
                      className={["w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors",
                        btn === page
                          ? isOps
                            ? "bg-red-500 text-white border-red-500 font-medium"
                            : "bg-zinc-900 text-white border-zinc-900 font-medium dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-foreground hover:bg-muted border-border"].join(" ")}>
                      {btn}
                    </button>
                  )
                )}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">›</button>
                <div className="flex items-center gap-1 ml-3 text-sm text-foreground">
                  跳至
                  <input type="number" min={1} max={totalPages} value={jumpVal}
                    onChange={(e) => setJumpVal(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && jumpTo()}
                    className="w-12 h-7 border rounded px-2 text-center bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                  页
                  <button onClick={jumpTo} className="h-7 px-2 border rounded text-xs hover:bg-muted transition-colors">GO</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {!isOps && trackTab === "mine" && (
      <div className="flex gap-0 flex-1 min-h-0">
        {/* Mine sidebar */}
        <aside className="w-32 flex-shrink-0 border-r">
          <div className="flex items-center gap-1 px-2 py-2 border-b">
            <button
              onClick={() => { setMineNewPoolName(""); setShowMineNewPoolDialog(true) }}
              className="flex-1 inline-flex items-center justify-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-muted/60 rounded px-2 py-1 transition-colors">
              <span className="text-base leading-none">⊕</span>
              <span>新增</span>
            </button>
            <button
              onClick={() => { setMineEditingPoolKey(null); setShowMineManageDialog(true) }}
              className="flex-1 inline-flex items-center justify-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-muted/60 rounded px-2 py-1 transition-colors">
              <span className="text-sm leading-none">⚙</span>
              <span>管理</span>
            </button>
          </div>
          <nav className="flex flex-col gap-0.5 p-1.5">
            {myPools.map((p) => (
              <button
                key={p.key}
                onClick={() => { setMyActivePool(p.key); setPage(1); setSelected(new Set()) }}
                className={[
                  "w-full text-left px-3 py-2 rounded text-sm transition-colors",
                  myActivePool === p.key
                    ? "bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400 font-medium"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                ].join(" ")}
              >
                {p.label}
              </button>
            ))}
          </nav>
        </aside>
        {/* Mine main */}
        <div className="flex-1 flex flex-col min-w-0 pl-4">
          {/* Filter bar */}
          <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
            {/* 基金分类 */}
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">基金分类：</span>
              <div className="flex items-center gap-1">
                {(["private", "public"] as const).map((fc) => (
                  <span
                    key={fc}
                    onClick={() => setMyFundClass(fc)}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                      myFundClass === fc
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                        : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                    ].join(" ")}
                  >
                    {fc === "private" ? "私募" : "公募"}
                  </span>
                ))}
              </div>
            </div>
            {/* 一级策略 */}
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">一级策略：</span>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select className="h-7 min-w-[5.75rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring">
                    <option>平台策略</option>
                    <option>团队策略</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                </div>
                <span className="inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20">不限</span>
              </div>
            </div>
            {/* 个人标签 */}
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">个人标签：</span>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <select
                    value={myPersonalTagMode}
                    onChange={(e) => { setMyPersonalTagMode(e.target.value as "and" | "or"); setPage(1) }}
                    className="h-7 min-w-[5.75rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="and">交集（且）</option>
                    <option value="or">并集（或）</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                </div>
                <span
                  onClick={() => { setMyPersonalTags([]); setPage(1) }}
                  className={[
                    "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                    myPersonalTags.length === 0
                      ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                      : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                  ].join(" ")}
                >
                  不限
                </span>
                {myPersonalTagOptions.map((tag) => (
                  <span
                    key={tag}
                    onClick={() => toggleMyPersonalTag(tag)}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                      myPersonalTags.includes(tag)
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                        : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                    ].join(" ")}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            {/* 管理人规模 */}
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-20 whitespace-nowrap text-right pr-3">管理人规模：</span>
              <div className="flex items-center gap-1 flex-wrap">
                {ORG_SIZE_OPTS.map((s) => (
                  <span
                    key={s}
                    onClick={() => setMyOrgSize(s)}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                      myOrgSize === s
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                        : s === "不限"
                          ? "border-border text-zinc-500 hover:border-red-300 hover:text-red-500"
                          : "border-border text-zinc-500 hover:bg-muted/60",
                    ].join(" ")}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
            {/* 关键字 */}
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">关 键 字：</span>
              <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-60">
                <input
                  className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
                  placeholder="输入产品/产品备案号，回车搜索"
                  value={myKwInput}
                  onChange={(e) => setMyKwInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setMyKeyword(myKwInput)}
                />
                <button
                  onClick={() => setMyKeyword(myKwInput)}
                  className="text-muted-foreground hover:text-foreground transition-colors">
                  <Search className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
          {/* Toolbar */}
          <div className="flex items-center justify-between mb-2 flex-shrink-0 text-xs">
            <div className="flex items-center gap-1.5 text-zinc-500">
              <span>指标计算截止日期</span>
              <span className="text-zinc-400">②</span>
              <div className="relative">
                <button
                  onClick={() => setShowMineDatePicker((v) => !v)}
                  className="inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-zinc-600 hover:bg-muted cursor-pointer transition-colors">
                  <CalendarDays className="h-3 w-3" />
                  <span className="tabular-nums">{mineCutoffDate}</span>
                  <ChevronDown className="h-3 w-3" />
                </button>
                {showMineDatePicker && (
                  <div className="absolute left-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg p-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="date"
                      value={mineCutoffDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => { if (e.target.value) { setMineCutoffDate(e.target.value); setShowMineDatePicker(false) } }}
                      className="border rounded px-2 py-1 text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
                      autoFocus
                    />
                  </div>
                )}
                {showMineDatePicker && <div className="fixed inset-0 z-30" onClick={() => setShowMineDatePicker(false)} />}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
                <input type="checkbox" defaultChecked className="rounded h-3 w-3 accent-zinc-700" />
                计算指标
              </label>
              <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
                <input type="checkbox" checked={showInterval} onChange={(e) => setShowInterval(e.target.checked)} className="rounded h-3 w-3 accent-zinc-700" />
                显示区间
              </label>
              <div className="relative">
                <button
                  onClick={() => setShowMineTemplateMenu((v) => !v)}
                  className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
                  <LayoutTemplate className="h-3 w-3" />
                  {trackingTemplates.length > 0 ? `模板(${trackingTemplates.length})` : "默认模板"}
                  <ChevronDown className="h-3 w-3" />
                </button>
                {showMineTemplateMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowMineTemplateMenu(false)} />
                    <div className="absolute left-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setAddMetricApplied([]); setShowMineTemplateMenu(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                        <LayoutTemplate className="h-3.5 w-3.5 text-zinc-400" /> 默认模板
                      </button>
                      {trackingTemplates.length > 0 && <div className="border-t my-1" />}
                      {trackingTemplates.map((t, i) => (
                        <button key={i} onClick={() => { setAddMetricApplied([...t.items]); setShowMineTemplateMenu(false) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors truncate">{t.name}</button>
                      ))}
                      <div className="border-t my-1" />
                      <button onClick={() => { setShowMineTemplateMenu(false); window.open("/ma/dashboard/settings?tab=metric-templates", "_blank") }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-zinc-500">管理模板</button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => { setAddMetricDraftItems([...addMetricApplied]); setShowAddMetricDialog(true) }}
                className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
                <PlusCircle className="h-3 w-3" />
                {addMetricApplied.length > 0 ? `添加指标(${addMetricApplied.length})` : "添加指标"}
              </button>
              <div className="relative">
                <button
                  disabled={selected.size === 0}
                  onClick={() => { setBatchContextPool(myActivePool); setShowMineBatchMenu((v) => !v) }}
                  className="inline-flex items-center gap-1 border border-border/50 rounded px-2 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-zinc-600 hover:text-foreground hover:bg-muted/60 disabled:hover:bg-transparent disabled:hover:text-zinc-600">
                  批量操作
                  {selected.size > 0 && <span className="text-xs text-red-500">({selected.size})</span>}
                </button>
                {showMineBatchMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowMineBatchMenu(false)} />
                    <div className="absolute left-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[130px]" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setShowMineBatchMenu(false); setBatchTagSelected([]); fetch("/ma/api/ops/team-tags?category=fund").then((r) => r.json()).then((d) => Array.isArray(d) ? setBatchTagTeamTags(d.map((t: { name: string }) => t.name)) : null).catch(() => {}); setShowBatchTagDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量添加标签</button>
                      <button onClick={() => { setShowMineBatchMenu(false); setBatchStrategyL1(""); setBatchStrategyL2(""); setBatchStrategyL3(""); setShowBatchStrategyDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量添加策略</button>
                      <button onClick={() => { setShowMineBatchMenu(false); setBatchMoveTargetPool(""); setBatchMoveMode("move"); setShowBatchMoveDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量移动到</button>
                      <button onClick={() => { setShowMineBatchMenu(false); setBatchMoveTargetPool(""); setBatchMoveMode("copy"); setShowBatchMoveDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">批量复制到</button>
                      <div className="border-t my-1" />
                      <button onClick={() => { setShowMineBatchMenu(false); setBatchConfirmTitle("批量取消策略"); setBatchConfirmMessage(`确定要为已选 ${selected.size} 只产品批量取消策略吗？`); setBatchConfirmAction("remove_strategy"); setShowBatchConfirmDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-zinc-500">批量取消策略</button>
                      <button onClick={() => { setShowMineBatchMenu(false); setBatchConfirmTitle("批量取消标签"); setBatchConfirmMessage(`确定要为已选 ${selected.size} 只产品批量清除所有标签吗？`); setBatchConfirmAction("remove_tags"); setShowBatchConfirmDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-zinc-500">批量取消标签</button>
                      <button onClick={() => { setShowMineBatchMenu(false); setBatchConfirmTitle("批量取消跟踪"); setBatchConfirmMessage(`确定要将已选 ${selected.size} 只产品从当前产品池中移除吗？`); setBatchConfirmAction("remove"); setShowBatchConfirmDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors text-red-500">批量取消跟踪</button>
                    </div>
                  </>
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowMineMoreMenu((v) => !v)}
                  className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
                  ⊕ 更多
                </button>
                {showMineMoreMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowMineMoreMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[120px]" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setShowMineMoreMenu(false)} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                        <RefreshCw className="h-3.5 w-3.5 text-zinc-400" /> 刷新指标
                      </button>
                      <button onClick={() => { setShowMineMoreMenu(false); setFieldConfigDraft([...fieldConfigSelected]); setFieldConfigTab("基本信息"); setShowFieldConfigDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                        <Settings2 className="h-3.5 w-3.5 text-zinc-400" /> 字段配置
                      </button>
                      <button onClick={() => { setShowMineMoreMenu(false); setShowAuditLogDialog(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                        <ClipboardList className="h-3.5 w-3.5 text-zinc-400" /> 操作日志
                      </button>
                      <button onClick={() => { setShowMineMoreMenu(false); handleTrackExport(`我的跟踪_${new Date().toISOString().slice(0, 10)}.csv`, { pool: myActivePool, keyword: myKeyword, orgSize: myOrgSize, cutoff: mineCutoffDate }) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                        <Download className="h-3.5 w-3.5 text-zinc-400" /> 导出
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowMineAddMenu((v) => !v)}
                  className="inline-flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white rounded px-3 py-1.5 font-medium transition-colors">
                  添加跟踪
                </button>
                {showMineAddMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowMineAddMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[100px]" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => { setShowMineAddMenu(false); setAddFundSearch(""); setAddFundSelectedTags([]); setAddFundSelected(null); setAddFundResults([]); setAddFundShowDropdown(false); setAddFundError(null); setAddFundTargetPool(myActivePool); setShowSingleAddDialog(true) }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">
                        单只添加
                      </button>
                      <button
                        onClick={() => { setShowMineAddMenu(false); setBatchAddText(""); setBatchAddResults([]); setBatchAddChecked(new Set()); setBatchAddSelectedTags([]); setBatchAddError(null); setBatchAddTargetPool(myActivePool); setShowBatchAddDialog(true) }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">
                        批量添加
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
          {/* Table */}
          <div className="overflow-x-auto rounded-lg border flex-1">
            <table className="text-sm border-collapse w-full" style={{ minWidth: 1100 }}>
              <thead className="sticky top-0 z-20">
                <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
                  <th className={`${thBase} w-8 px-2`}><input type="checkbox" className="rounded h-3 w-3" /></th>
                  <th className={`${thBase} w-10`}>序号</th>
                  <th className={`${thBase} min-w-[200px]`}>产品名称</th>
                  <th className={`${thBase} min-w-[100px]`}>最新净値日期</th>
                  <th className={`${thBase} min-w-[90px]`}>最新单位净値</th>
                  <th className={`${thBase} text-right min-w-[88px]`}>最新涨跌幅</th>
                  <th className={`${thBase} text-right min-w-[88px]`}>
                    <div>近一周收益</div>
                    {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(mineCutoffDate, 7)}</div>}
                  </th>
                  <th className={`${thBase} text-right min-w-[88px]`}>
                    <div>近一月收益</div>
                    {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(mineCutoffDate, 30)}</div>}
                  </th>
                  <th className={`${thBase} text-right min-w-[88px]`}>
                    <div>近三月收益</div>
                    {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(mineCutoffDate, 91)}</div>}
                  </th>
                  <th className={`${thBase} text-right min-w-[88px]`}>
                    <div>近六月收益</div>
                    {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(mineCutoffDate, 182)}</div>}
                  </th>
                  <th className={`${thBase} text-center w-16`}>走势</th>
                  <th className={`${thBase} text-center min-w-[80px]`}>个人备注</th>
                  <th className={`${thBase} text-center w-16`}>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={13} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
                ) : !isMyPoolSupported ? (
                  <tr><td colSpan={13} className="py-20 text-center text-muted-foreground">请选择一个跟踪池查看数据</td></tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-20 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                        <span>暂无数据</span>
                      </div>
                    </td>
                  </tr>
                ) : data.map((row, i) => {
                  const isSelected = selected.has(row.beian_hao)
                  const bg = isSelected ? "bg-blue-50 dark:bg-blue-950/40" : "bg-background"
                  const hoverBg = isSelected ? "group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40" : "group-hover:bg-muted"
                  const cell = `border-b px-3 py-2 ${bg} ${hoverBg} transition-colors`
                  return (
                    <tr key={row.beian_hao} className="group">
                      <td className={`${cell} px-2 text-center`}>
                        <input type="checkbox" className="rounded h-3 w-3"
                          checked={isSelected}
                          onChange={() => {
                            const s = new Set(selected)
                            isSelected ? s.delete(row.beian_hao) : s.add(row.beian_hao)
                            setSelected(s)
                          }} />
                      </td>
                      <td className={`${cell} text-center tabular-nums`}>{(page - 1) * 50 + i + 1}</td>
                      <td className={cell}>
                        <a
                          href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beian_hao)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-600 dark:text-blue-400 hover:underline block truncate max-w-[240px]"
                          title={row.product_name}
                        >{row.short_name || row.product_name}</a>
                        {row.strategy_l1 && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] border border-amber-300/80 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700/50">
                            {row.strategy_l1}
                          </span>
                        )}
                      </td>
                      <td className={`${cell} tabular-nums`}>{row.latest_nav_date ?? "—"}</td>
                      <td className={`${cell} tabular-nums font-medium`}>{row.latest_nav ? parseFloat(row.latest_nav).toFixed(4) : "—"}</td>
                      <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.latest_price_change} /></td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_1w} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(mineCutoffDate, 7)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_1m} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(mineCutoffDate, 30)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_3m} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(mineCutoffDate, 91)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_6m} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(mineCutoffDate, 182)}</div>}
                      </td>
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
                          }}>
                          <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><LineChart className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                      <td className={`${cell} text-center`}>
                        {fundNotes[row.beian_hao] ? (
                          <button
                            onClick={(e) => {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              setNotePopupPos({ x: rect.left, y: rect.bottom + 4 })
                              setOpenNotePopup(openNotePopup === row.beian_hao ? null : row.beian_hao)
                            }}
                            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className={`${cell} text-center`}>
                        <PersonalTrackingRowMenu
                          onUntrack={() => { setBatchContextPool(myActivePool); setBatchConfirmTitle("取消跟踪"); setBatchConfirmMessage(`确定要将「${row.product_name}」从当前产品池中移除吗？`); setBatchConfirmAction("remove"); setSelected(new Set([row.beian_hao])); setShowBatchConfirmDialog(true) }}
                          onEditTags={() => openPersonalEditTagDialog(row.beian_hao, row.product_name)}
                          onNoteManage={() => openPersonalNoteDialog(row.beian_hao, row.product_name)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {isMyPoolSupported && (
            <div className="flex items-center justify-between pt-3 flex-shrink-0">
              <span className="text-sm text-zinc-500">共 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{total.toLocaleString()}</span> 只基金</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                  className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">‹</button>
                {pageButtons().map((btn, idx) =>
                  btn === "…" ? (
                    <span key={`me${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
                  ) : (
                    <button key={btn} onClick={() => setPage(btn as number)}
                      className={["w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors",
                        btn === page
                          ? "bg-zinc-900 text-white border-zinc-900 font-medium dark:bg-zinc-100 dark:text-zinc-900"
                          : "text-foreground hover:bg-muted border-border"].join(" ")}>
                      {btn}
                    </button>
                  )
                )}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">›</button>
                <div className="flex items-center gap-1 ml-3 text-sm text-foreground">
                  跳至
                  <input type="number" min={1} max={totalPages} value={jumpVal}
                    onChange={(e) => setJumpVal(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && jumpTo()}
                    className="w-12 h-7 border rounded px-2 text-center bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                  页
                  <button onClick={jumpTo} className="h-7 px-2 border rounded text-xs hover:bg-muted transition-colors">GO</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Add metric dialog */}
      {showAddMetricDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddMetricDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl flex flex-col" style={{ width: 900, maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">选择指标</span>
              <button onClick={() => setShowAddMetricDialog(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none transition-colors">×</button>
            </div>
            {/* Body */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left panel */}
              <div className="flex-1 overflow-y-auto px-6 py-5 border-r">
                <p className="text-xs font-semibold text-zinc-500 mb-3">可选指标</p>
                {/* Period radio grid */}
                <div className="grid gap-x-2 gap-y-2 mb-5" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                  {ADD_METRIC_PERIODS.map((p) => (
                    <label key={p} className="inline-flex items-center gap-1.5 cursor-pointer text-sm text-zinc-600 dark:text-zinc-300 hover:text-foreground">
                      <input
                        type="radio"
                        name="addMetricPeriod"
                        value={p}
                        checked={addMetricPeriod === p}
                        onChange={() => setAddMetricPeriod(p)}
                        className="accent-red-500 h-3.5 w-3.5 flex-shrink-0"
                      />
                      {p}
                    </label>
                  ))}
                </div>
                {/* Metric checkboxes in 3 columns */}
                <div className="grid gap-x-4 gap-y-2.5" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                  {ADD_METRIC_GROUPS.map((col, ci) =>
                    col.map((metric) => {
                      const isChecked = addMetricDraftItems.some((x) => x.period === addMetricPeriod && x.metric === metric)
                      return (
                        <label key={`${ci}-${metric}`} className="inline-flex items-center gap-2 cursor-pointer text-sm text-zinc-600 dark:text-zinc-300 hover:text-foreground">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                setAddMetricDraftItems((prev) => prev.filter((x) => !(x.period === addMetricPeriod && x.metric === metric)))
                              } else {
                                setAddMetricDraftItems((prev) => [...prev, { period: addMetricPeriod, metric }])
                              }
                            }}
                            className="accent-red-500 h-3.5 w-3.5 flex-shrink-0 rounded"
                          />
                          {metric}
                        </label>
                      )
                    })
                  )}
                </div>
              </div>
              {/* Right panel */}
              <div className="w-52 flex-shrink-0 flex flex-col px-4 py-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-zinc-500">已选指标({addMetricDraftItems.length})</span>
                  <button onClick={() => setAddMetricDraftItems([])} className="text-xs text-blue-500 hover:text-blue-600 transition-colors">清空</button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-1">
                  {addMetricDraftItems.map((item, idx) => (
                    <div
                      key={`${item.period}-${item.metric}-${idx}`}
                      draggable
                      onDragStart={() => setAddMetricDragIdx(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (addMetricDragIdx === null || addMetricDragIdx === idx) return
                        const arr = [...addMetricDraftItems]
                        const [moved] = arr.splice(addMetricDragIdx, 1)
                        arr.splice(idx, 0, moved)
                        setAddMetricDraftItems(arr)
                        setAddMetricDragIdx(null)
                      }}
                      onDragEnd={() => setAddMetricDragIdx(null)}
                      className={[
                        "flex items-center justify-between gap-1 px-2 py-1.5 rounded text-xs border cursor-grab select-none transition-colors",
                        addMetricDragIdx === idx
                          ? "opacity-40 bg-muted border-border"
                          : "bg-background border-border hover:bg-muted/60",
                      ].join(" ")}
                    >
                      <span className="truncate text-zinc-600 dark:text-zinc-300">
                        <span className="text-zinc-400 mr-1">{item.period}·</span>{item.metric}
                      </span>
                      <button
                        onClick={() => setAddMetricDraftItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="flex-shrink-0 text-zinc-400 hover:text-red-500 transition-colors leading-none"
                      >×</button>
                    </div>
                  ))}
                </div>
                {addMetricDraftItems.length > 0 && (
                  <p className="mt-2 text-[10px] text-muted-foreground text-center">已选列表可拖拉上下排序</p>
                )}
                {addMetricDraftItems.length === 0 && (
                  <p className="mt-auto text-[10px] text-muted-foreground text-center pt-4">已选列表可拖拉上下排序</p>
                )}
              </div>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
              <button
                onClick={() => {
                  setAddMetricApplied([...addMetricDraftItems])
                  setShowAddMetricDialog(false)
                }}
                className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">
                确 定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch confirm dialog */}
      {showBatchConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBatchConfirmDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[360px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-5">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <div>
                <p className="font-semibold text-sm mb-1">{batchConfirmTitle}</p>
                <p className="text-sm text-zinc-500">{batchConfirmMessage}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowBatchConfirmDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                disabled={batchSubmitting}
                onClick={async () => {
                  if (batchConfirmAction) await handleBatchOp(batchConfirmAction)
                  setShowBatchConfirmDialog(false)
                }}
                className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {batchSubmitting ? "处理中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch move dialog */}
      {showBatchMoveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBatchMoveDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[420px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">{batchMoveMode === "copy" ? "复制到产品池" : "移动到产品池"}</span>
              <button onClick={() => setShowBatchMoveDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5">
              <div className="flex items-center gap-3">
                <span className="text-sm shrink-0 w-16 text-right">
                  <span className="text-red-500 mr-0.5">*</span>目标池：
                </span>
                <div className="relative flex-1">
                  <select
                    value={batchMoveTargetPool}
                    onChange={(e) => setBatchMoveTargetPool(e.target.value)}
                    className={[
                      "w-full appearance-none rounded border pl-3 pr-8 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring",
                      batchMoveTargetPool ? "text-zinc-700 dark:text-zinc-200 border-border" : "text-muted-foreground border-red-300",
                    ].join(" ")}>
                    <option value="">请选择目标池</option>
                    {pools.filter((p) => p.key !== "all" && p.key !== sourcePool).map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
              <button onClick={() => setShowBatchMoveDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                disabled={!batchMoveTargetPool || batchSubmitting}
                onClick={async () => {
                  await handleBatchOp(batchMoveMode, { target_pool: batchMoveTargetPool })
                  setShowBatchMoveDialog(false)
                }}
                className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {batchSubmitting ? "处理中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 编辑团队策略 Dialog (single fund) ── */}
      {showEditStrategyDialog && (() => {
        const editL2Opts = editStrategyL1 ? (strategyHierarchy.find((n) => n.l1 === editStrategyL1)?.l2s ?? []) : []
        const editL3Opts = editStrategyL2 ? (editL2Opts.find((n) => n.l2 === editStrategyL2)?.l3s ?? []) : []
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowEditStrategyDialog(false)}>
            <div className="bg-background rounded-lg shadow-xl w-[480px] flex flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
                <span className="font-semibold text-base">编辑团队策略</span>
                <button onClick={() => setShowEditStrategyDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
              </div>
              {/* Body */}
              <div className="px-6 py-5 flex flex-col gap-4">
                {/* Fund name */}
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="font-semibold text-sm">{editStrategyName}</span>
                </div>
                {/* Warning */}
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  团队策略仅内部可见。团队策略的新增、编辑在【运维-数据维护-团队策略】中。
                </div>
                {/* 一级策略 */}
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-16 text-right">一级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={editStrategyL1}
                      onChange={(e) => { setEditStrategyL1(e.target.value); setEditStrategyL2(""); setEditStrategyL3("") }}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-zinc-600 dark:text-zinc-300">
                      <option value="">请选择一级策略</option>
                      {strategyHierarchy.map((n) => <option key={n.l1} value={n.l1}>{n.l1}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
                {/* 二级策略 */}
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-16 text-right">二级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={editStrategyL2}
                      onChange={(e) => { setEditStrategyL2(e.target.value); setEditStrategyL3("") }}
                      disabled={editL2Opts.length === 0}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-zinc-600 dark:text-zinc-300 disabled:opacity-50">
                      <option value="">{editStrategyL1 ? "请选择二级策略" : "请先选择一级策略"}</option>
                      {editL2Opts.map((n) => <option key={n.l2} value={n.l2}>{n.l2}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
                {/* 三级策略 */}
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-16 text-right">三级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={editStrategyL3}
                      onChange={(e) => setEditStrategyL3(e.target.value)}
                      disabled={editL3Opts.length === 0}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-zinc-600 dark:text-zinc-300 disabled:opacity-50">
                      <option value="">{editStrategyL2 ? "请选择三级策略" : "请先选择一级策略"}</option>
                      {editL3Opts.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
              </div>
              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
                <button onClick={() => setShowEditStrategyDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
                <button
                  disabled={!editStrategyL1 || editStrategySaving}
                  onClick={async () => {
                    if (!editStrategyBeianHao || !editStrategyL1) return
                    setEditStrategySaving(true)
                    try {
                      await fetch(`/ma/api/private-funds/${encodeURIComponent(editStrategyBeianHao)}/strategy`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          strategy_l1: editStrategyL1 || null,
                          strategy_l2: editStrategyL2 || null,
                          strategy_l3: editStrategyL3 || null,
                        }),
                      })
                      setShowEditStrategyDialog(false)
                      setDataReloadKey((k) => k + 1)
                    } finally {
                      setEditStrategySaving(false)
                    }
                  }}
                  className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {editStrategySaving ? "保存中…" : "确 定"}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Batch add strategy dialog */}
      {showBatchStrategyDialog && (() => {
        const batchL2Opts = batchStrategyL1 ? (strategyHierarchy.find((n) => n.l1 === batchStrategyL1)?.l2s ?? []) : []
        const batchL3Opts = batchStrategyL2 ? (batchL2Opts.find((n) => n.l2 === batchStrategyL2)?.l3s ?? []) : []
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBatchStrategyDialog(false)}>
            <div className="bg-background rounded-lg shadow-xl w-[480px] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
                <span className="font-semibold text-base">批量添加策略</span>
                <button onClick={() => setShowBatchStrategyDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
              </div>
              <div className="px-6 py-5 flex flex-col gap-4">
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  对已选产品批量添加团队策略，策略团队内部可见。团队策略的新增、编辑在【运维-数据维护-团队策略】中。
                </div>
                {/* 一级策略 */}
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-16 text-right">
                    <span className="text-red-500 mr-0.5">*</span>一级策略：
                  </span>
                  <div className="relative flex-1">
                    <select
                      value={batchStrategyL1}
                      onChange={(e) => { setBatchStrategyL1(e.target.value); setBatchStrategyL2(""); setBatchStrategyL3("") }}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-zinc-600 dark:text-zinc-300">
                      <option value="">请选择一级策略</option>
                      {strategyHierarchy.map((n) => <option key={n.l1} value={n.l1}>{n.l1}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
                {/* 二级策略 */}
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-16 text-right">二级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={batchStrategyL2}
                      onChange={(e) => { setBatchStrategyL2(e.target.value); setBatchStrategyL3("") }}
                      disabled={batchL2Opts.length === 0}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-zinc-600 dark:text-zinc-300 disabled:opacity-50">
                      <option value="">请选择二级策略</option>
                      {batchL2Opts.map((n) => <option key={n.l2} value={n.l2}>{n.l2}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
                {/* 三级策略 */}
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-16 text-right">三级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={batchStrategyL3}
                      onChange={(e) => setBatchStrategyL3(e.target.value)}
                      disabled={batchL3Opts.length === 0}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-zinc-600 dark:text-zinc-300 disabled:opacity-50">
                      <option value="">请选择三级策略</option>
                      {batchL3Opts.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
                <button onClick={() => setShowBatchStrategyDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
                <button
                  disabled={!batchStrategyL1 || batchSubmitting}
                  onClick={async () => {
                    await handleBatchOp("set_strategy", {
                      strategy_l1: batchStrategyL1 || null,
                      strategy_l2: batchStrategyL2 || null,
                      strategy_l3: batchStrategyL3 || null,
                    })
                    setShowBatchStrategyDialog(false)
                  }}
                  className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {batchSubmitting ? "处理中…" : "确 定"}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 个人编辑产品标签 Dialog ── */}
      {showPersonalEditTagDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPersonalEditTagDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[560px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">编辑产品标签</span>
              <button onClick={() => setShowPersonalEditTagDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="font-semibold text-sm">{editPersonalTagName}</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-16 text-right pt-2">标签：</span>
                <div className="flex-1">
                  <div className="flex items-center border rounded px-3 py-1.5 gap-2 flex-wrap min-h-[36px] bg-background">
                    {editPersonalTagSelected.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 bg-red-50 border border-red-300 text-red-500 rounded px-2 py-0.5 text-xs">
                        {t}
                        <button onClick={() => setEditPersonalTagSelected((p) => p.filter((x) => x !== t))} className="leading-none hover:text-red-700">×</button>
                      </span>
                    ))}
                    {editPersonalTagSelected.length === 0 && <span className="text-sm text-muted-foreground/40">请选择标签</span>}
                  </div>
                </div>
                <button onClick={() => setEditPersonalTagSelected([])} className="text-sm text-blue-500 hover:text-blue-600 transition-colors shrink-0 pt-2">清空</button>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-16 text-right pt-1.5">个人标签：</span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-muted/30 rounded px-3 py-2">
                  {editPersonalTagOptions.length === 0 && (
                    <span className="text-sm text-muted-foreground flex-shrink-0">暂无标签，可点击「设置」添加后刷新</span>
                  )}
                  {editPersonalTagOptions.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setEditPersonalTagSelected((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                      className={[
                        "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                        editPersonalTagSelected.includes(tag)
                          ? "bg-red-50 text-red-500 border-red-300"
                          : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                      ].join(" ")}
                    >{tag}</button>
                  ))}
                  <button
                    onClick={() => window.open(personalTagsSettingsUrl(), "_blank")}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors ml-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                    设置
                  </button>
                  <button
                    onClick={() => loadPersonalTagOptions()}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                    刷新
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
              <button onClick={() => setShowPersonalEditTagDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                disabled={editPersonalTagSaving}
                onClick={async () => {
                  if (!editPersonalTagBeianHao) return
                  setEditPersonalTagSaving(true)
                  try {
                    await fetch("/ma/api/tracking-funds/personal-fund-tags", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json", ...userFetchHeaders() },
                      body: JSON.stringify({ beian_hao: editPersonalTagBeianHao, tags: editPersonalTagSelected }),
                    })
                    setShowPersonalEditTagDialog(false)
                    loadPersonalTagOptions()
                    setDataReloadKey((k) => k + 1)
                  } finally {
                    setEditPersonalTagSaving(false)
                  }
                }}
                className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {editPersonalTagSaving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch add tag dialog */}
      {/* ── 编辑标签 Dialog ── */}
      {showEditTagDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowEditTagDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[560px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">跟踪产品编辑</span>
              <button onClick={() => setShowEditTagDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            {/* Body */}
            <div className="px-6 py-5 flex flex-col gap-4">
              {/* Fund name */}
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="font-semibold text-sm">{editTagName}</span>
              </div>
              {/* Tag selector */}
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-12 text-right pt-2">标签：</span>
                <div className="flex-1">
                  <div className="flex items-center border rounded px-3 py-1.5 gap-2 flex-wrap min-h-[36px] bg-background cursor-pointer"
                    onClick={() => {/* click to focus / show team tags below */}}>
                    {editTagSelected.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 bg-red-50 border border-red-300 text-red-500 rounded px-2 py-0.5 text-xs">
                        {t}
                        <button onClick={(e) => { e.stopPropagation(); setEditTagSelected((p) => p.filter((x) => x !== t)) }} className="leading-none hover:text-red-700">×</button>
                      </span>
                    ))}
                    {editTagSelected.length === 0 && <span className="text-xs text-muted-foreground">请选择标签</span>}
                  </div>
                </div>
                <button onClick={() => setEditTagSelected([])} className="text-sm text-blue-500 hover:text-blue-600 transition-colors shrink-0 pt-2">清空</button>
              </div>
              {/* Team tags */}
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-12 text-right pt-1.5">团队标签：</span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-muted/30 rounded px-3 py-2">
                  {editTagTeamTags.length === 0 && (
                    <span className="text-sm text-muted-foreground flex-shrink-0">暂无标签，可点击「设置」添加后刷新</span>
                  )}
                  {editTagTeamTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setEditTagSelected((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                      className={[
                        "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                        editTagSelected.includes(tag)
                          ? "bg-red-50 text-red-500 border-red-300"
                          : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                      ].join(" ")}
                    >{tag}</button>
                  ))}
                  <button
                    onClick={() => window.open("/ma/dashboard/private-funds?tab=operations&side=ops-strategy-tags&ops=tags", "_blank")}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors ml-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                    设置
                  </button>
                  <button
                    onClick={() => fetch("/ma/api/ops/team-tags?category=fund").then((r) => r.json()).then((d) => Array.isArray(d) ? setEditTagTeamTags(d.map((t: { name: string }) => t.name)) : null).catch(() => {})}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                    刷新
                  </button>
                </div>
              </div>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
              <button onClick={() => setShowEditTagDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                disabled={editTagSaving}
                onClick={async () => {
                  if (!editTagBeianHao) return
                  setEditTagSaving(true)
                  try {
                    await fetch("/ma/api/tracking-funds/fund-tags", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ beian_hao: editTagBeianHao, tags: editTagSelected }),
                    })
                    setShowEditTagDialog(false)
                  } finally {
                    setEditTagSaving(false)
                  }
                }}
                className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {editTagSaving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBatchTagDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBatchTagDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[560px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">批量添加标签</span>
              <button onClick={() => setShowBatchTagDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            {/* Body */}
            <div className="px-6 py-5 flex flex-col gap-4">
              {/* Info banner */}
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                对已选产品批量添加标签，标签团队内部可见。团队标签的新增、编辑在【运维-数据维护-团队标签】中。
              </div>
              {/* Tag selector */}
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-10 text-right pt-2">标签：</span>
                <div className="flex-1">
                  <div className="flex items-center border rounded px-3 py-1.5 gap-2 flex-wrap min-h-[36px] bg-background">
                    {batchTagSelected.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 bg-red-50 border border-red-300 text-red-500 rounded px-2 py-0.5 text-xs">
                        {t}
                        <button onClick={() => setBatchTagSelected((p) => p.filter((x) => x !== t))} className="leading-none hover:text-red-700">×</button>
                      </span>
                    ))}
                    {batchTagSelected.length === 0 && <span className="text-xs text-muted-foreground">请选择标签</span>}
                  </div>
                </div>
                <button onClick={() => setBatchTagSelected([])} className="text-sm text-blue-500 hover:text-blue-600 transition-colors shrink-0 pt-2">清空</button>
              </div>
              {/* Team tags */}
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-10 text-right pt-1.5">团队标签：</span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-muted/30 rounded px-3 py-2">
                  {batchTagTeamTags.length === 0 && (
                    <span className="text-sm text-muted-foreground flex-shrink-0">暂无标签，可点击「设置」添加后刷新</span>
                  )}
                  {batchTagTeamTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setBatchTagSelected((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                      className={[
                        "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                        batchTagSelected.includes(tag)
                          ? "bg-red-50 text-red-500 border-red-300"
                          : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                      ].join(" ")}
                    >{tag}</button>
                  ))}
                  <button
                    onClick={() => window.open("/ma/dashboard/private-funds?tab=operations&side=ops-strategy-tags&ops=tags", "_blank")}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors ml-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                    设置
                  </button>
                  <button
                    onClick={() => fetch("/ma/api/ops/team-tags?category=fund").then((r) => r.json()).then((d) => Array.isArray(d) ? setBatchTagTeamTags(d.map((t: { name: string }) => t.name)) : null).catch(() => {})}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                    刷新
                  </button>
                </div>
              </div>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
              <button onClick={() => setShowBatchTagDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                disabled={batchTagSelected.length === 0 || batchSubmitting}
                onClick={async () => {
                  await handleBatchOp("add_tags", { tags: batchTagSelected })
                  setShowBatchTagDialog(false)
                }}
                className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {batchSubmitting ? "处理中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit log dialog */}
      {showAuditLogDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAuditLogDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[700px] flex flex-col" style={{ maxHeight: "70vh" }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">操作日志</span>
              <button onClick={() => setShowAuditLogDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            {/* Table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/40 border-b">
                    <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-16">序号</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-32">操作人</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-48">操作时间</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">操作事项</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={4} className="py-16 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                        <span>暂无数据</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Footer pagination */}
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0 text-sm text-zinc-500">
              <span>共0条</span>
              <button className="px-2 py-1 rounded border hover:bg-muted transition-colors disabled:opacity-40" disabled>‹</button>
              <span className="px-2.5 py-1 rounded border bg-muted text-foreground font-medium">1</span>
              <button className="px-2 py-1 rounded border hover:bg-muted transition-colors disabled:opacity-40" disabled>›</button>
            </div>
          </div>
        </div>
      )}

      {/* Field config dialog */}
      {showFieldConfigDialog && (() => {
        const FIELD_TABS = ["基本信息", "申赎信息", "团队策略/标签/池", "净值信息", "团队字段", "其他"]
        const FIELD_OPTIONS: Record<string, string[]> = {
          "基本信息": ["备案编码", "成立日期", "基金全称", "备案日期", "基准指数", "基金管理人", "管理人规模", "投资顾问", "托管券商", "平台一级策略", "平台二级策略", "平台三级策略"],
          "申赎信息": ["申购状态", "赎回状态", "申购费率", "赎回费率", "最低申购金额", "封闭期"],
          "团队策略/标签/池": ["团队一级策略", "团队二级策略", "团队三级策略", "团队标签", "所在跟踪池"],
          "净值信息": ["成立以来收益", "近两年收益", "近三年收益", "最大回撤", "年化收益", "年化波动率", "信息比率", "卡玛比率"],
          "团队字段": ["团队评级", "团队备注", "关注度"],
          "其他": ["产品规模", "基金托管人", "外部评级"],
        }
        const opts = FIELD_OPTIONS[fieldConfigTab] ?? []
        const toggleDraft = (f: string) => {
          setFieldConfigDraft((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f])
        }
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowFieldConfigDialog(false)}>
            <div className="bg-background rounded-lg shadow-xl w-[760px] flex flex-col" style={{ maxHeight: "80vh" }} onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
                <span className="font-semibold text-base">字段配置</span>
                <button onClick={() => setShowFieldConfigDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
              </div>
              {/* Body */}
              <div className="flex flex-1 overflow-hidden">
                {/* Left: tabs + fields */}
                <div className="flex-1 flex flex-col min-w-0 px-6 py-4">
                  {/* Tab row */}
                  <div className="flex items-center gap-4 mb-4 flex-wrap">
                    {FIELD_TABS.map((tab) => (
                      <label key={tab} className="flex items-center gap-1.5 cursor-pointer text-sm whitespace-nowrap">
                        <input
                          type="radio"
                          name="fieldConfigTab"
                          checked={fieldConfigTab === tab}
                          onChange={() => setFieldConfigTab(tab)}
                          className="accent-red-500 h-3.5 w-3.5"
                        />
                        {tab}
                      </label>
                    ))}
                  </div>
                  {/* Checkboxes grid */}
                  <div className="grid grid-cols-3 gap-x-6 gap-y-3">
                    {opts.map((f) => (
                      <label key={f} className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={fieldConfigDraft.includes(f)}
                          onChange={() => toggleDraft(f)}
                          className="rounded h-3.5 w-3.5 accent-red-500"
                        />
                        {f}
                      </label>
                    ))}
                  </div>
                </div>
                {/* Right: selected list */}
                <div className="w-48 border-l flex flex-col px-4 py-4 flex-shrink-0">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm text-zinc-600">已选({fieldConfigDraft.length})</span>
                    <button onClick={() => setFieldConfigDraft([])} className="text-xs text-red-500 hover:text-red-600 transition-colors">清空</button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1.5">
                    {fieldConfigDraft.map((f) => (
                      <div key={f} className="flex items-center justify-between text-sm py-0.5">
                        <span className="text-zinc-700 dark:text-zinc-300 truncate">{f}</span>
                        <button onClick={() => toggleDraft(f)} className="text-zinc-400 hover:text-zinc-600 transition-colors ml-1 flex-shrink-0">×</button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-400 mt-3 leading-snug">已选列表可拖拉上下排序</p>
                </div>
              </div>
              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
                <button onClick={() => setShowFieldConfigDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
                <button
                  onClick={() => { setFieldConfigSelected([...fieldConfigDraft]); setShowFieldConfigDialog(false) }}
                  className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">
                  确 定
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Single add dialog */}
      {showSingleAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSingleAddDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[640px] p-6" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <span className="font-semibold text-base">添加跟踪产品</span>
              <button onClick={() => setShowSingleAddDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
            </div>
            {/* 选择基金 */}
            <div className="flex items-start gap-3 mb-5">
              <span className="text-sm shrink-0 w-16 text-right mt-2"><span className="text-red-500 mr-0.5">*</span>选择基金：</span>
              <div className="flex flex-1 flex-col gap-0">
                {/* Input row */}
                <div className="flex flex-1 items-center gap-0 border rounded overflow-visible">
                  <div className="relative shrink-0">
                    <select
                      value={addFundClass}
                      onChange={(e) => setAddFundClass(e.target.value as "private" | "public")}
                      className="h-9 appearance-none pl-3 pr-7 text-sm bg-muted/50 border-r text-zinc-700 dark:text-zinc-300 focus:outline-none cursor-pointer"
                    >
                      <option value="private">私募基金</option>
                      <option value="public">公募基金</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  </div>
                  <div className="flex flex-1 items-center px-3 gap-2 relative">
                    {addFundSelected ? (
                      <div className="flex flex-1 items-center justify-between h-9">
                        <div className="flex flex-col leading-tight">
                          <span className="text-sm font-medium">{addFundSelected.product_name}</span>
                          <span className="text-xs text-muted-foreground">{addFundSelected.beian_hao}</span>
                        </div>
                        <button
                          onClick={() => { setAddFundSelected(null); setAddFundSearch(""); setAddFundShowDropdown(false) }}
                          className="text-muted-foreground hover:text-foreground text-base leading-none ml-2 shrink-0">×</button>
                      </div>
                    ) : (
                      <>
                        <input
                          autoFocus
                          type="text"
                          value={addFundSearch}
                          onChange={(e) => { setAddFundSearch(e.target.value); setAddFundSelected(null) }}
                          onFocus={() => { if (addFundResults.length > 0) setAddFundShowDropdown(true) }}
                          placeholder="搜索并选择基金，支持备案号/代码"
                          className="flex-1 h-9 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50"
                        />
                        {addFundLoading
                          ? <svg className="h-3.5 w-3.5 animate-spin text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round"/></svg>
                          : <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                        }
                      </>
                    )}
                  </div>
                </div>
                {/* Search results dropdown */}
                {addFundShowDropdown && addFundResults.length > 0 && !addFundSelected && (
                  <div className="relative z-50">
                    <div className="absolute left-0 right-0 top-0 bg-background border rounded-lg shadow-xl max-h-56 overflow-y-auto">
                      {addFundResults.map((r) => (
                        <button
                          key={r.beian_hao}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setAddFundSelected({ beian_hao: r.beian_hao, product_name: r.product_name }); setAddFundSearch(""); setAddFundShowDropdown(false) }}
                          className="w-full text-left px-3 py-2 hover:bg-muted transition-colors flex items-center justify-between gap-3 group"
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm truncate">{r.product_name}</span>
                            <span className="text-xs text-muted-foreground truncate">{r.beian_hao}{r.short_name ? ` · ${r.short_name}` : ""}</span>
                          </div>
                          {r.strategy_one && (
                            <span className="text-xs text-zinc-400 shrink-0 border rounded px-1 py-0.5">{r.strategy_one}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {addFundShowDropdown && addFundResults.length === 0 && !addFundLoading && addFundSearch.trim() && !addFundSelected && (
                  <div className="relative z-50">
                    <div className="absolute left-0 right-0 top-0 bg-background border rounded-lg shadow-xl px-4 py-3 text-sm text-muted-foreground">
                      未找到匹配的基金
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* 标签 */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm shrink-0 w-16 text-right">标签：</span>
              <div className="flex flex-1 items-center flex-wrap border rounded px-3 min-h-[36px] gap-1.5 py-1">
                {addFundSelectedTags.map((tag) => (
                  <span key={tag} className="inline-flex items-center gap-1 bg-muted text-zinc-700 dark:text-zinc-200 rounded px-2 py-0.5 text-xs">
                    {tag}
                    <button onClick={() => setAddFundSelectedTags((p) => p.filter((t) => t !== tag))} className="hover:text-red-500 leading-none ml-0.5">×</button>
                  </span>
                ))}
                {addFundSelectedTags.length === 0 && (
                  <span className="text-sm text-muted-foreground/40">请选择标签</span>
                )}
              </div>
              <button
                onClick={() => setAddFundSelectedTags([])}
                className="text-sm text-blue-500 hover:text-blue-600 transition-colors shrink-0">
                清空
              </button>
            </div>
            {/* 团队标签 */}
            <div className="flex items-start gap-3 mb-6">
              <span className="text-sm shrink-0 w-16 text-right pt-1.5">团队标签：</span>
              <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-muted/30 rounded px-3 py-2">
                {addFundTeamTags.length === 0 && (
                  <span className="text-sm text-muted-foreground flex-shrink-0">暂无标签，可点击「设置」添加后刷新</span>
                )}
                {addFundTeamTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setAddFundSelectedTags((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                    className={[
                      "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                      addFundSelectedTags.includes(tag)
                        ? "bg-red-50 text-red-500 border-red-300"
                        : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                    ].join(" ")}
                  >{tag}</button>
                ))}
                <button onClick={() => window.open("/ma/dashboard/private-funds?tab=operations&side=ops-strategy-tags&ops=tags", "_blank")} className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors ml-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                  设置
                </button>
                <button
                  onClick={() => fetch("/ma/api/ops/team-tags?category=fund").then((r) => r.json()).then((d) => Array.isArray(d) ? setAddFundTeamTags(d.map((t: { name: string }) => t.name)) : null).catch(() => {})}
                  className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                  刷新
                </button>
              </div>
            </div>
            {/* Footer */}
            <div className="flex flex-col gap-2">
              {addFundError && (
                <p className="text-xs text-red-500 text-right">
                  {addFundError === "already_exists" ? "该基金已在当前产品池中" : `添加失败：${addFundError}`}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowSingleAddDialog(false)}
                  disabled={addFundSaving}
                  className="px-4 py-2 text-sm border rounded hover:bg-muted transition-colors disabled:opacity-50">
                  取 消
                </button>
                <button
                  disabled={!addFundSelected || addFundSaving}
                  onClick={async () => {
                    if (!addFundSelected) return
                    setAddFundSaving(true)
                    setAddFundError(null)
                    try {
                      const res = await fetch("/ma/api/tracking-funds/add", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ pool: addFundTargetPool, beian_hao: addFundSelected.beian_hao, product_name: addFundSelected.product_name }),
                      })
                      const json = await res.json()
                      if (json.error) {
                        setAddFundError(json.error)
                      } else {
                        setShowSingleAddDialog(false)
                        setDataReloadKey((k) => k + 1)
                      }
                    } catch {
                      setAddFundError("network_error")
                    } finally {
                      setAddFundSaving(false)
                    }
                  }}
                  className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {addFundSaving ? "保存中…" : "确 定"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch add dialog */}
      {showBatchAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowBatchAddDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[780px] max-h-[90vh] flex flex-col p-6" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between mb-5 shrink-0">
              <span className="font-semibold text-base">添加跟踪产品</span>
              <button onClick={() => setShowBatchAddDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
            </div>

            {/* 添加基金 */}
            <div className="mb-5 shrink-0">
              <div className="flex items-center gap-1 mb-3">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
                <span className="font-medium text-sm">添加基金</span>
              </div>
              <div className="flex gap-3" style={{ height: 220 }}>
                {/* Left: clipboard textarea */}
                <div className="flex flex-col flex-1">
                  <div className="text-xs text-muted-foreground mb-1">剪贴板</div>
                  <textarea
                    className="flex-1 w-full border rounded p-2 text-sm bg-transparent resize-none outline-none placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-ring"
                    placeholder={"将基金名称/备案号/代码粘贴至此，内容要\n分行，如：\n     xxxxx1号\n     xxxxx2号\n     xxxxx3号"}
                    value={batchAddText}
                    onChange={(e) => setBatchAddText(e.target.value)}
                  />
                </div>
                {/* Middle: search button */}
                <div className="flex items-center shrink-0">
                  <button
                    disabled={batchAddSearching || !batchAddText.trim()}
                    onClick={async () => {
                      const keywords = batchAddText.split("\n").map((l) => l.trim()).filter(Boolean)
                      if (keywords.length === 0) return
                      setBatchAddSearching(true)
                      setBatchAddResults([])
                      setBatchAddChecked(new Set())
                      try {
                        const res = await fetch("/ma/api/tracking-funds/batch-search", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ keywords }),
                        })
                        const json = await res.json()
                        const found = json.results ?? []
                        setBatchAddResults(found)
                        setBatchAddChecked(new Set(found.map((r: { beian_hao: string }) => r.beian_hao)))
                      } catch {
                        // ignore
                      } finally {
                        setBatchAddSearching(false)
                      }
                    }}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap">
                    {batchAddSearching
                      ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round"/></svg>
                      : "搜索 >"}
                  </button>
                </div>
                {/* Right: results table */}
                <div className="flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">搜索成功</span>
                    {batchAddResults.length > 0 && (
                      <button
                        onClick={() => { setBatchAddResults([]); setBatchAddChecked(new Set()) }}
                        className="text-xs text-blue-500 hover:text-blue-600 transition-colors">
                        删除
                      </button>
                    )}
                  </div>
                  <div className="flex-1 border rounded overflow-auto">
                    {batchAddResults.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
                          <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>
                        </svg>
                        <span className="text-xs">暂无数据</span>
                      </div>
                    ) : (
                      <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 bg-muted/60">
                          <tr>
                            <th className="w-8 px-2 py-1.5 text-left">
                              <input type="checkbox"
                                className="rounded h-3 w-3"
                                checked={batchAddChecked.size === batchAddResults.length}
                                onChange={(e) => setBatchAddChecked(e.target.checked ? new Set(batchAddResults.map((r) => r.beian_hao)) : new Set())}
                              />
                            </th>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">基金名称</th>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">备案号/代码</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batchAddResults.map((r) => (
                            <tr key={r.beian_hao} className="border-t hover:bg-muted/30 transition-colors">
                              <td className="px-2 py-1.5">
                                <input type="checkbox"
                                  className="rounded h-3 w-3"
                                  checked={batchAddChecked.has(r.beian_hao)}
                                  onChange={(e) => {
                                    const next = new Set(batchAddChecked)
                                    e.target.checked ? next.add(r.beian_hao) : next.delete(r.beian_hao)
                                    setBatchAddChecked(next)
                                  }}
                                />
                              </td>
                              <td className="px-2 py-1.5 max-w-[160px] truncate" title={r.product_name}>{r.product_name}</td>
                              <td className="px-2 py-1.5 text-muted-foreground">{r.beian_hao}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 添加标签 */}
            <div className="mb-5 shrink-0">
              <div className="flex items-center gap-1 mb-3">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
                <span className="font-medium text-sm">添加标签</span>
                <span className="text-xs text-muted-foreground ml-1">可对本次搜索成功的基金添加共同标签</span>
              </div>
              <div className="flex items-center gap-3 mb-2.5">
                <span className="text-sm shrink-0 w-14 text-right">标签：</span>
                <div className="flex flex-1 items-center flex-wrap border rounded px-3 min-h-[36px] gap-1.5 py-1">
                  {batchAddSelectedTags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 bg-muted text-zinc-700 dark:text-zinc-200 rounded px-2 py-0.5 text-xs">
                      {tag}
                      <button onClick={() => setBatchAddSelectedTags((p) => p.filter((t) => t !== tag))} className="hover:text-red-500 leading-none ml-0.5">×</button>
                    </span>
                  ))}
                  {batchAddSelectedTags.length === 0 && (
                    <span className="text-sm text-muted-foreground/40">请选择标签</span>
                  )}
                </div>
                <button onClick={() => setBatchAddSelectedTags([])} className="text-sm text-blue-500 hover:text-blue-600 transition-colors shrink-0">清空</button>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-14 text-right pt-1.5">团队标签：</span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-muted/30 rounded px-3 py-2">
                  {batchAddTeamTags.length === 0 && (
                    <span className="text-sm text-muted-foreground flex-shrink-0">暂无标签，可点击「设置」添加后刷新</span>
                  )}
                  {batchAddTeamTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setBatchAddSelectedTags((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                      className={[
                        "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                        batchAddSelectedTags.includes(tag)
                          ? "bg-red-50 text-red-500 border-red-300"
                          : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                      ].join(" ")}
                    >{tag}</button>
                  ))}
                  <button onClick={() => window.open("/ma/dashboard/private-funds?tab=operations&side=ops-strategy-tags&ops=tags", "_blank")} className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors ml-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
                    设置
                  </button>
                  <button
                    onClick={() => fetch("/ma/api/ops/team-tags?category=fund").then((r) => r.json()).then((d) => Array.isArray(d) ? setBatchAddTeamTags(d.map((t: { name: string }) => t.name)) : null).catch(() => {})}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                    刷新
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-col gap-2 shrink-0">
              {batchAddError && (
                <p className="text-xs text-red-500 text-right">{batchAddError}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowBatchAddDialog(false)}
                  disabled={batchAddSaving}
                  className="px-4 py-2 text-sm border rounded hover:bg-muted transition-colors disabled:opacity-50">
                  取 消
                </button>
                <button
                  disabled={batchAddChecked.size === 0 || batchAddSaving}
                  onClick={async () => {
                    const toAdd = batchAddResults.filter((r) => batchAddChecked.has(r.beian_hao))
                    if (toAdd.length === 0) return
                    setBatchAddSaving(true)
                    setBatchAddError(null)
                    try {
                      const results = await Promise.all(
                        toAdd.map((r) =>
                          fetch("/ma/api/tracking-funds/add", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ pool: batchAddTargetPool, beian_hao: r.beian_hao, product_name: r.product_name }),
                          }).then((res) => res.json())
                        )
                      )
                      const failed = results.filter((r) => r.error && r.error !== "already_exists")
                      if (failed.length > 0) {
                        setBatchAddError(`${failed.length} 个添加失败`)
                      } else {
                        setShowBatchAddDialog(false)
                        setDataReloadKey((k) => k + 1)
                      }
                    } catch {
                      setBatchAddError("网络错误，请重试")
                    } finally {
                      setBatchAddSaving(false)
                    }
                  }}
                  className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {batchAddSaving ? "保存中…" : "确 定"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mine manage dialog */}
      {showMineManageDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setMineEditingPoolKey(null); setShowMineManageDialog(false) }}>
          <div className="bg-background rounded-lg shadow-xl w-[600px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="font-semibold text-base">我的跟踪产品池管理</span>
              <button onClick={() => { setMineEditingPoolKey(null); setShowMineManageDialog(false) }} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium w-12">序号</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">产品池名称</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium w-32">指标模版</th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {myPools.filter((p) => p.key !== "mine_all").map((p, idx) => (
                  <tr key={p.key} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 px-3 text-muted-foreground">{idx + 1}</td>
                    <td className="py-2 px-3">
                      {mineEditingPoolKey === p.key ? (
                        <input
                          autoFocus
                          value={mineEditingPoolLabel}
                          onChange={(e) => setMineEditingPoolLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && mineEditingPoolLabel.trim()) {
                              setMyPools((prev) => prev.map((x) => x.key === p.key ? { ...x, label: mineEditingPoolLabel.trim() } : x))
                              setMineEditingPoolKey(null)
                            } else if (e.key === "Escape") setMineEditingPoolKey(null)
                          }}
                          onBlur={() => {
                            if (mineEditingPoolLabel.trim()) setMyPools((prev) => prev.map((x) => x.key === p.key ? { ...x, label: mineEditingPoolLabel.trim() } : x))
                            setMineEditingPoolKey(null)
                          }}
                          className="border rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring w-full"
                        />
                      ) : p.label}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">默认模版</td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setMineEditingPoolKey(p.key); setMineEditingPoolLabel(p.label) }}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="重命名"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        {p.key !== "mine_default" && (
                          <button
                            onClick={() => {
                              setMyPools((prev) => prev.filter((x) => x.key !== p.key))
                              if (myActivePool === p.key) setMyActivePool("mine_default")
                            }}
                            className="text-muted-foreground hover:text-red-500 transition-colors"
                            title="删除"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">列表可拖动排序</p>
          </div>
        </div>
      )}

      {/* Mine new pool dialog */}
      {showMineNewPoolDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowMineNewPoolDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="font-semibold text-base">新建我的跟踪产品池</span>
              <button onClick={() => setShowMineNewPoolDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
            </div>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-sm shrink-0"><span className="text-red-500 mr-0.5">*</span>池名称：</span>
              <input
                autoFocus
                type="text"
                value={mineNewPoolName}
                onChange={(e) => setMineNewPoolName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && mineNewPoolName.trim()) {
                    const key = `mine_custom_${Date.now()}`
                    setMyPools((prev) => [...prev, { key, label: mineNewPoolName.trim() }])
                    setMyActivePool(key)
                    setShowMineNewPoolDialog(false)
                  }
                }}
                placeholder="请输入我的跟踪产品池名称"
                className="flex-1 border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowMineNewPoolDialog(false)}
                className="px-4 py-2 text-sm border rounded hover:bg-muted transition-colors"
              >
                取 消
              </button>
              <button
                disabled={!mineNewPoolName.trim()}
                onClick={() => {
                  if (!mineNewPoolName.trim()) return
                  const key = `mine_custom_${Date.now()}`
                  setMyPools((prev) => [...prev, { key, label: mineNewPoolName.trim() }])
                  setMyActivePool(key)
                  setShowMineNewPoolDialog(false)
                }}
                className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                确 定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New pool dialog */}
      {showNewPoolDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewPoolDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="font-semibold text-base">新建团队跟踪产品池</span>
              <button onClick={() => setShowNewPoolDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
            </div>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-sm shrink-0"><span className="text-red-500 mr-0.5">*</span>池名称：</span>
              <input
                autoFocus
                type="text"
                value={newPoolName}
                onChange={(e) => setNewPoolName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newPoolName.trim()) {
                    const key = `custom_${Date.now()}`
                    setPools((prev) => [...prev, { key, label: newPoolName.trim() }])
                    setActivePool(key)
                    setPage(1)
                    setShowNewPoolDialog(false)
                  }
                }}
                placeholder="请输入团队跟踪产品池名称"
                className="flex-1 border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewPoolDialog(false)}
                className="px-4 py-2 text-sm border rounded hover:bg-muted transition-colors"
              >
                取 消
              </button>
              <button
                disabled={!newPoolName.trim()}
                onClick={() => {
                  if (!newPoolName.trim()) return
                  const key = `custom_${Date.now()}`
                  setPools((prev) => [...prev, { key, label: newPoolName.trim() }])
                  setActivePool(key)
                  setPage(1)
                  setShowNewPoolDialog(false)
                }}
                className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                确 定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage pools dialog */}
      {showManageDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setShowManageDialog(false); setEditingPoolKey(null) }}>
          <div className="bg-background rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">团队跟踪产品池管理</span>
              <button onClick={() => { setShowManageDialog(false); setEditingPoolKey(null) }} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
            </div>
            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground w-16">序号</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">产品池名称</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">指标模版</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground w-24">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pools.filter((p) => p.key !== "all").map((p, idx) => (
                    <tr key={p.key} className="hover:bg-muted/30 transition-colors">
                      <td className="px-6 py-3 text-muted-foreground">{idx + 1}</td>
                      <td className="px-4 py-3">
                        {editingPoolKey === p.key ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingPoolLabel}
                            onChange={(e) => setEditingPoolLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && editingPoolLabel.trim()) {
                                setPools((prev) => prev.map((x) => x.key === p.key ? { ...x, label: editingPoolLabel.trim() } : x))
                                setEditingPoolKey(null)
                              } else if (e.key === "Escape") {
                                setEditingPoolKey(null)
                              }
                            }}
                            onBlur={() => {
                              if (editingPoolLabel.trim()) {
                                setPools((prev) => prev.map((x) => x.key === p.key ? { ...x, label: editingPoolLabel.trim() } : x))
                              }
                              setEditingPoolKey(null)
                            }}
                            className="border rounded px-2 py-1 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring w-full max-w-[200px]"
                          />
                        ) : (
                          p.label
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">默认模版</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            title="重命名"
                            onClick={() => { setEditingPoolKey(p.key); setEditingPoolLabel(p.label) }}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button
                            title="删除"
                            onClick={() => {
                              setPools((prev) => prev.filter((x) => x.key !== p.key))
                              if (activePool === p.key) { setActivePool("bfl"); setPage(1) }
                            }}
                            className="text-muted-foreground hover:text-red-500 transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Footer */}
            <div className="px-6 py-3 border-t flex-shrink-0">
              <span className="text-xs text-muted-foreground">列表可拖动排序</span>
            </div>
          </div>
        </div>
      )}

      {/* ── 走势 hover chart (fixed, escapes scroll container) ── */}
      {hoverChartRow && hoverChartPos && (() => {
        const popupW = 356
        const popupH = 210
        const vw = typeof window !== "undefined" ? window.innerWidth : 1920
        const vh = typeof window !== "undefined" ? window.innerHeight : 1080
        const left = hoverChartPos.x + popupW > vw ? hoverChartPos.x - popupW - 16 : hoverChartPos.x
        const top = Math.min(hoverChartPos.y, vh - popupH - 8)
        const hoverRow = data.find((r) => r.beian_hao === hoverChartRow)
        return (
          <div
            className="fixed z-[9999] bg-background border rounded-xl shadow-2xl"
            style={{ left, top, width: popupW }}
            onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current) }}
            onMouseLeave={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current); hoverTimeout.current = setTimeout(() => setHoverChartRow(null), 150) }}>
            <div className="px-3 pt-3 pb-1 font-semibold text-sm border-b">收益走势</div>
            <TrendHoverChart beian_hao={hoverChartRow} productName={hoverRow?.product_name ?? ""} />
          </div>
        )
      })()}

      {/* ── 资料 note popup (fixed) ── */}
      {openNotePopup && notePopupPos && (() => {
        const noteRec = fundNotes[openNotePopup]
        const noteRow = data.find((r) => r.beian_hao === openNotePopup)
        if (!noteRec) return null
        const vw = typeof window !== "undefined" ? window.innerWidth : 1920
        const popW = 260
        const left = Math.min(notePopupPos.x, vw - popW - 8)
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpenNotePopup(null)} />
            <div className="fixed z-50 bg-background border rounded-xl shadow-2xl py-3" style={{ left, top: notePopupPos.y, width: popW }}>
              <div className="flex items-center justify-between px-4 pb-2 border-b mb-2">
                <span className="font-semibold text-sm">{isMineTab ? "个人备注" : "团队备注"}</span>
                <button
                  onClick={() => {
                    setOpenNotePopup(null)
                    if (isMineTab) openPersonalNoteDialog(openNotePopup, noteRow?.product_name ?? "")
                    else openNoteDialog(openNotePopup, noteRow?.product_name ?? "")
                  }}
                  className="text-xs text-red-500 hover:text-red-600 transition-colors">添加</button>
              </div>
              <div className="px-4 pb-2">
                <div className="flex items-start gap-1.5 text-sm">
                  <span className="text-red-500 mt-0.5">•</span>
                  <span className="text-foreground break-words flex-1">{noteRec.note}</span>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 pt-1">
                <span className="text-xs text-muted-foreground">
                  {noteRec.updated_at?.slice(0, 10)} {noteRec.updated_by}
                </span>
                <button
                  onClick={async () => {
                    if (isMineTab) {
                      await fetch(`/ma/api/tracking-funds/personal-fund-note?beian_hao=${encodeURIComponent(openNotePopup)}`, {
                        method: "DELETE",
                        headers: userFetchHeaders(),
                      })
                    } else {
                      await fetch(`/ma/api/tracking-funds/fund-note?beian_hao=${encodeURIComponent(openNotePopup)}`, { method: "DELETE" })
                    }
                    setFundNotes((prev) => { const n = { ...prev }; delete n[openNotePopup]; return n })
                    setOpenNotePopup(null)
                  }}
                  className="text-muted-foreground hover:text-red-500 transition-colors p-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {/* ── 个人备注管理 Dialog ── */}
      {showPersonalNoteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPersonalNoteDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[580px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">个人备注管理</span>
              <button onClick={() => setShowPersonalNoteDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full border-2 border-red-500 flex-shrink-0" />
                <span className="font-semibold text-sm">{personalNoteName}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-foreground">
                  <span className="text-red-500 mr-0.5">*</span>个人备注
                </label>
                <textarea
                  value={personalNoteText}
                  onChange={(e) => setPersonalNoteText(e.target.value.slice(0, 250))}
                  placeholder="请输入不大于250字的备注"
                  rows={5}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                />
              </div>
            </div>
            <div className="flex items-center justify-end px-6 py-3 border-t flex-shrink-0">
              <button
                disabled={personalNoteSaving}
                onClick={async () => {
                  if (!personalNoteBeianHao) return
                  setPersonalNoteSaving(true)
                  try {
                    const res = await fetch("/ma/api/tracking-funds/personal-fund-note", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json", ...userFetchHeaders() },
                      body: JSON.stringify({ beian_hao: personalNoteBeianHao, note: personalNoteText }),
                    })
                    const d = await res.json()
                    if (personalNoteText.trim()) {
                      setFundNotes((prev) => ({
                        ...prev,
                        [personalNoteBeianHao]: d.record ?? { note: personalNoteText, updated_by: "", updated_at: new Date().toISOString() },
                      }))
                    } else {
                      setFundNotes((prev) => { const n = { ...prev }; delete n[personalNoteBeianHao]; return n })
                    }
                    setShowPersonalNoteDialog(false)
                  } finally {
                    setPersonalNoteSaving(false)
                  }
                }}
                className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {personalNoteSaving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 备注管理 Dialog ── */}
      {showNoteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNoteDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[580px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">团队备注管理</span>
              <button onClick={() => setShowNoteDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            {/* Body */}
            <div className="px-6 py-5 flex flex-col gap-4">
              {/* Fund name */}
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="font-semibold text-sm">{noteName}</span>
              </div>
              {/* Note label */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-foreground">
                  <span className="text-red-500 mr-0.5">*</span>团队备注
                </label>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value.slice(0, 250))}
                  placeholder="请输入不大于250字的备注"
                  rows={5}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                />
                <div className="text-right text-xs text-muted-foreground">{noteText.length}/250</div>
              </div>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-end px-6 py-3 border-t flex-shrink-0">
              <button
                disabled={noteSaving}
                onClick={async () => {
                  if (!noteBeianHao) return
                  setNoteSaving(true)
                  try {
                    const res = await fetch("/ma/api/tracking-funds/fund-note", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ beian_hao: noteBeianHao, note: noteText }),
                    })
                    const d = await res.json()
                    if (noteText.trim()) {
                      setFundNotes((prev) => ({ ...prev, [noteBeianHao]: d.record ?? { note: noteText, updated_by: "", updated_at: new Date().toISOString() } }))
                    } else {
                      setFundNotes((prev) => { const n = { ...prev }; delete n[noteBeianHao]; return n })
                    }
                    setShowNoteDialog(false)
                  } finally {
                    setNoteSaving(false)
                  }
                }}
                className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {noteSaving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 产品要素 Dialog ── */}
      {showElementsDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowElementsDialog(false)}>
          <div className="bg-background rounded-lg shadow-2xl w-[780px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">产品要素</span>
              <button onClick={() => setShowElementsDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            {/* Body */}
            <div className="overflow-y-auto flex-1 px-6 py-5">
              {/* Fund name */}
              <h2 className="text-lg font-bold mb-5 pl-3 border-l-4 border-red-500">{elementsName}</h2>

              {elementsLoading && (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">加载中…</div>
              )}
              {!elementsLoading && elementsData && elementsData.error && (
                <div className="text-sm text-muted-foreground py-8 text-center">暂无产品要素数据</div>
              )}
              {!elementsLoading && elementsData && !elementsData.error && (() => {
                const d = elementsData
                const val = (v: string | null | undefined) => v || "—"
                const Row2 = ({ l1, v1, l2, v2 }: { l1: string; v1?: string | null; l2?: string; v2?: string | null }) => (
                  <tr className="border-b border-border/50 last:border-0">
                    <td className="py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap">{l1}</td>
                    <td className="py-2 px-4 text-sm text-foreground">{val(v1)}</td>
                    {l2 !== undefined && <>
                      <td className="py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap">{l2}</td>
                      <td className="py-2 px-4 text-sm text-foreground">{val(v2)}</td>
                    </>}
                  </tr>
                )
                return (
                  <>
                    {/* 基本信息 */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                      <span className="text-sm font-semibold">基本信息</span>
                    </div>
                    <table className="w-full border border-border rounded-lg overflow-hidden mb-5 text-sm">
                      <tbody>
                        <Row2 l1="产品全称" v1={d.fund_name as string} l2="备案编号" v2={d.register_number as string} />
                        <Row2 l1="投资顾问" v1={d.advisor as string} l2="基金管理人" v2={d.fund_manager as string} />
                        <Row2 l1="成立日期" v1={d.inception_date as string} l2="备案日期" v2={d.puton_date as string} />
                        <tr className="border-b border-border/50 last:border-0">
                          <td className="py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap">托管券商</td>
                          <td className="py-2 px-4 text-sm text-foreground" colSpan={3}>{val(d.custodian as string)}</td>
                        </tr>
                      </tbody>
                    </table>

                    {/* 申赎信息 */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                        <span className="text-sm font-semibold">申赎信息</span>
                      </div>
                      {d.updated_at && (
                        <span className="text-xs text-muted-foreground">最近更新: {d.updated_at as string}</span>
                      )}
                    </div>
                    <table className="w-full border border-border rounded-lg overflow-hidden text-sm">
                      <tbody>
                        <Row2 l1="开放日" v1={d.open_day as string} l2="是否可临开" v2={d.is_temporary_open as string} />
                        <Row2 l1="申购费" v1={d.fee_purchase as string} l2="追加限制" v2={d.add_amount as string} />
                        <Row2 l1="赎回费" v1={d.fee_redeem as string} l2="风险等级" v2={null} />
                        <Row2 l1="预警线" v1={d.precautious_line as string} l2="封闭期" v2={d.closed_period as string} />
                        <Row2 l1="平仓线" v1={d.stop_line as string} l2="锁定期说明" v2={null} />
                        <Row2 l1="管理费率" v1={d.fee_manage_rate as string} l2="托管费" v2={d.fee_trust as string} />
                        <Row2 l1="管理费说明" v1={d.fee_manage as string} l2="外包费" v2={d.fee_admin_service as string} />
                        <tr className="border-b border-border/50 last:border-0">
                          <td className="py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap align-top">业绩报酬说明</td>
                          <td className="py-2 px-4 text-sm text-foreground whitespace-pre-wrap leading-relaxed" colSpan={3}>{val(d.fee_pay as string)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ─── OperationsStrategyTagsView ───────────────────────────────────────────

interface OpsStrategyL2 {
  l2: string
  l3s: string[]
}

interface OpsStrategyL1 {
  l1: string
  l2s: OpsStrategyL2[]
}

function opsL2Key(l1: string, l2: string) {
  return `${l1}\u0000${l2}`
}

const TAG_CATEGORIES = [
  { key: "fund",      label: "基金" },
  { key: "portfolio", label: "组合" },
  { key: "compare",   label: "对比" },
  { key: "manager",   label: "管理人" },
  { key: "note",      label: "笔记" },
  { key: "material",  label: "资料" },
] as const

interface OpsTagRow {
  id: number
  category: string
  name: string
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function OperationsTeamTagsTab() {
  const [tagCategory, setTagCategory] = useState<string>("fund")
  const [tags, setTags] = useState<OpsTagRow[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [showNewTagModal, setShowNewTagModal] = useState(false)
  const [newTagName, setNewTagName] = useState("")
  const [newTagSaving, setNewTagSaving] = useState(false)
  const [editingTag, setEditingTag] = useState<OpsTagRow | null>(null)
  const [editTagName, setEditTagName] = useState("")
  const [editTagSaving, setEditTagSaving] = useState(false)

  function currentUserName(): string {
    try {
      const u = JSON.parse(localStorage.getItem("currentUser") || "null")
      return u?.name || u?.email || ""
    } catch { return "" }
  }

  function loadTags(cat: string) {
    setTagsLoading(true)
    fetch(`/ma/api/ops/team-tags?category=${encodeURIComponent(cat)}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setTags(d) : null)
      .catch(() => {})
      .finally(() => setTagsLoading(false))
  }

  useEffect(() => { loadTags(tagCategory) }, [tagCategory])

  async function createTag() {
    if (!newTagName.trim()) return
    setNewTagSaving(true)
    try {
      const res = await fetch("/ma/api/ops/team-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: tagCategory, name: newTagName.trim(), user_name: currentUserName() }),
      })
      if (res.ok) {
        setShowNewTagModal(false)
        setNewTagName("")
        loadTags(tagCategory)
      }
    } finally { setNewTagSaving(false) }
  }

  async function saveEditTag() {
    if (!editingTag || !editTagName.trim()) return
    setEditTagSaving(true)
    try {
      const res = await fetch(`/ma/api/ops/team-tags/${editingTag.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editTagName.trim(), user_name: currentUserName() }),
      })
      if (res.ok) {
        setEditingTag(null)
        loadTags(tagCategory)
      }
    } finally { setEditTagSaving(false) }
  }

  async function deleteTag(id: number) {
    const res = await fetch(`/ma/api/ops/team-tags/${id}`, { method: "DELETE" })
    if (res.ok) {
      setTags((prev) => prev.filter((t) => t.id !== id))
    } else {
      loadTags(tagCategory)
    }
  }

  return (
    <>
      {/* Category filter + action */}
      <div className="flex items-center justify-between mt-4 mb-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500 font-medium">分类：</span>
          {TAG_CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setTagCategory(c.key)}
              className={[
                "px-3 py-1 rounded text-sm font-medium transition-all border",
                tagCategory === c.key
                  ? "bg-red-50 text-red-500 border-red-300 dark:bg-red-950/20 dark:border-red-700"
                  : "border-transparent text-zinc-600 dark:text-zinc-400 hover:text-foreground",
              ].join(" ")}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setNewTagName(""); setShowNewTagModal(true) }}
          className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded transition-colors"
        >
          新建标签
        </button>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/40 border-b">
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-16">序号</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">标签名称</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">最近修改</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">修改人</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">创建人</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {tagsLoading ? (
              <tr><td colSpan={6} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : tags.length === 0 ? (
              <tr><td colSpan={6} className="py-20 text-center text-muted-foreground">暂无标签</td></tr>
            ) : tags.map((tag, i) => (
              <tr key={tag.id} className="border-b hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-4 py-3 font-medium">{tag.name}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{fmtDateTime(tag.updated_at)}</td>
                <td className="px-4 py-3">{tag.updated_by || "—"}</td>
                <td className="px-4 py-3">{tag.created_by || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      title="编辑"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => { setEditingTag(tag); setEditTagName(tag.name) }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M11 9H8a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"/><path d="M15.5 5.5a2 2 0 0 1 3 3L12 15l-4 1 1-4 6.5-6.5z"/></svg>
                    </button>
                    <button
                      title="删除"
                      className="text-muted-foreground hover:text-red-500 transition-colors"
                      onClick={() => deleteTag(tag.id)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New tag modal */}
      {showNewTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewTagModal(false)}>
          <div className="bg-background border rounded-lg shadow-xl w-[360px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <span className="font-semibold text-base">新建标签</span>
              <button onClick={() => setShowNewTagModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="flex items-center gap-3 mb-8">
              <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0">标签名称：</label>
              <input
                autoFocus
                className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !newTagSaving && createTag()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewTagModal(false)}
                className="px-5 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                onClick={createTag}
                disabled={!newTagName.trim() || newTagSaving}
                className="px-5 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                {newTagSaving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit tag modal */}
      {editingTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditingTag(null)}>
          <div className="bg-background border rounded-lg shadow-xl w-[400px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="font-semibold text-base">编辑标签</span>
              <button onClick={() => setEditingTag(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="flex items-center gap-3 mb-6">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 shrink-0">标签名称：</label>
              <input
                autoFocus
                className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                placeholder="请输入标签名称"
                value={editTagName}
                onChange={(e) => setEditTagName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !editTagSaving && saveEditTag()}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingTag(null)}
                className="px-4 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                onClick={saveEditTag}
                disabled={!editTagName.trim() || editTagSaving}
                className="px-4 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                {editTagSaving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const FIELD_CATEGORIES = ["文本", "数字", "百分数", "日期", "单选", "多选", "附件", "人员"] as const

function FieldFormLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-[5.5rem] text-right">
      <span className="text-red-500">*</span> {children}
    </label>
  )
}

interface OpsFieldRow {
  id: number
  name: string
  category: string
  sort_order: number
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

function OperationsTeamFieldsTab({
  externalNewOpen,
  onExternalNewClose,
}: {
  externalNewOpen?: boolean
  onExternalNewClose?: () => void
}) {
  const [fields, setFields] = useState<OpsFieldRow[]>([])
  const [loading, setLoading] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [newFieldName, setNewFieldName] = useState("")
  const [newFieldCategory, setNewFieldCategory] = useState<string>("文本")
  const [newFieldSaving, setNewFieldSaving] = useState(false)
  const [editingField, setEditingField] = useState<OpsFieldRow | null>(null)
  const [editFieldName, setEditFieldName] = useState("")
  const [editFieldCategory, setEditFieldCategory] = useState<string>("文本")
  const [editFieldSaving, setEditFieldSaving] = useState(false)

  function currentUserName(): string {
    try {
      const u = JSON.parse(localStorage.getItem("currentUser") || "null")
      return u?.name || u?.email || ""
    } catch { return "" }
  }

  function loadFields() {
    setLoading(true)
    fetch("/ma/api/ops/team-fields")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setFields(d) : null)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadFields() }, [])

  useEffect(() => {
    if (externalNewOpen) {
      setNewFieldName("")
      setNewFieldCategory("文本")
      setShowNewModal(true)
      onExternalNewClose?.()
    }
  }, [externalNewOpen, onExternalNewClose])

  async function createField() {
    if (!newFieldName.trim()) return
    setNewFieldSaving(true)
    try {
      const res = await fetch("/ma/api/ops/team-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFieldName.trim(), category: newFieldCategory, user_name: currentUserName() }),
      })
      if (res.ok) {
        setShowNewModal(false)
        setNewFieldName("")
        loadFields()
      }
    } finally { setNewFieldSaving(false) }
  }

  async function saveEditField() {
    if (!editingField || !editFieldName.trim()) return
    setEditFieldSaving(true)
    try {
      const res = await fetch(`/ma/api/ops/team-fields/${editingField.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editFieldName.trim(), category: editFieldCategory, user_name: currentUserName() }),
      })
      if (res.ok) {
        setEditingField(null)
        loadFields()
      }
    } finally { setEditFieldSaving(false) }
  }

  async function deleteField(id: number) {
    await fetch(`/ma/api/ops/team-fields/${id}`, { method: "DELETE" })
    setFields((prev) => prev.filter((f) => f.id !== id))
  }

  return (
    <>
      <div className="overflow-auto rounded border mt-4">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/40 border-b">
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-16">序号</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">字段名称</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">字段类别</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">最近修改</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : fields.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : fields.map((field, i) => (
              <tr key={field.id} className="border-b hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-4 py-3 font-medium">{field.name}</td>
                <td className="px-4 py-3">{field.category}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{fmtDateTime(field.updated_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <button
                      title="编辑"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        setEditingField(field)
                        setEditFieldName(field.name)
                        setEditFieldCategory(field.category)
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M11 9H8a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"/><path d="M15.5 5.5a2 2 0 0 1 3 3L12 15l-4 1 1-4 6.5-6.5z"/></svg>
                    </button>
                    <button
                      title="删除"
                      className="text-muted-foreground hover:text-red-500 transition-colors"
                      onClick={() => deleteField(field.id)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 pt-3 border-t">
        <p className="text-xs text-muted-foreground">
          说明：自定义团队字段，满足个性化字段需求，新建后可在投资/运维各基金列表编辑和查看。字段可拖拽排序。
        </p>
      </div>

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewModal(false)}>
          <div className="bg-background border rounded-lg shadow-xl w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <span className="font-semibold text-base">新建字段</span>
              <button onClick={() => setShowNewModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="space-y-5 mb-8">
              <div className="flex items-center gap-3">
                <FieldFormLabel>字段类别：</FieldFormLabel>
                <select
                  value={newFieldCategory}
                  onChange={(e) => setNewFieldCategory(e.target.value)}
                  className="flex-1 border rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-red-300 bg-background"
                >
                  {FIELD_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <FieldFormLabel>字段名称：</FieldFormLabel>
                <input
                  className="flex-1 border rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-red-300 bg-background"
                  placeholder=""
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !newFieldSaving && createField()}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                onClick={createField}
                disabled={!newFieldName.trim() || newFieldSaving}
                className="px-6 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                {newFieldSaving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingField && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditingField(null)}>
          <div className="bg-background border rounded-lg shadow-xl w-[400px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="font-semibold text-base">编辑字段</span>
              <button onClick={() => setEditingField(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="space-y-5 mb-8">
              <div className="flex items-center gap-3">
                <FieldFormLabel>字段类别：</FieldFormLabel>
                <select
                  value={editFieldCategory}
                  onChange={(e) => setEditFieldCategory(e.target.value)}
                  className="flex-1 border rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-red-300 bg-background"
                >
                  {FIELD_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <FieldFormLabel>字段名称：</FieldFormLabel>
                <input
                  autoFocus
                  className="flex-1 border rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-red-300 bg-background"
                  value={editFieldName}
                  onChange={(e) => setEditFieldName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !editFieldSaving && saveEditField()}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingField(null)}
                className="px-5 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                onClick={saveEditField}
                disabled={!editFieldName.trim() || editFieldSaving}
                className="px-5 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                {editFieldSaving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const CRAWL_EMAIL_PRESETS = [
  { label: "163邮箱", imapHost: "imap.163.com", imapPort: 993 },
  { label: "QQ邮箱", imapHost: "imap.qq.com", imapPort: 993 },
  { label: "126邮箱", imapHost: "imap.126.com", imapPort: 993 },
  { label: "企业邮箱", imapHost: "imap.exmail.qq.com", imapPort: 993 },
  { label: "其他", imapHost: "", imapPort: 993 },
] as const

type CrawlEmailRow = {
  id: string
  emailType: string
  account: string
  passMasked: string
  imapHost: string
  imapPort: number
  imapFolders: string[]
  crawlStatus: "成功" | "失败" | "未测试"
  remark: string
}

type ImportableEmailOption = {
  account: string
  remark: string
  emailType: string
  source: string
}

type TaAccountRow = {
  id: string
  customerName: string
  taAccount: string
  linkType: "fof" | "investor" | null
  fofRegisterNumber: string | null
  fofProductName: string | null
  investorName: string | null
  source: "邮箱抓取" | "手动添加"
}

type EmailParseRecordRow = {
  id: string
  crawlEmailAccount: string
  uid?: string
  senderEmail?: string
  sentAt: string
  subject: string
  tableNavStatus: "成功" | "失败"
  postTableNavStatus: "成功" | "失败"
  valuationStatus: "成功" | "失败"
  ledgerStatus: "成功" | "失败"
}

type ParseStatusFilter = "all" | "成功" | "失败"

type FofFundOption = { register_number: string; product_name: string }

function OperationsTaAccountsPanel() {
  const [rows, setRows] = useState<TaAccountRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [portalMounted, setPortalMounted] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingRow, setEditingRow] = useState<TaAccountRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [addForm, setAddForm] = useState({ customerName: "", taAccount: "" })
  const [editLinkType, setEditLinkType] = useState<"fof" | "investor">("fof")
  const [editFofInput, setEditFofInput] = useState("")
  const [editFofSelected, setEditFofSelected] = useState<FofFundOption | null>(null)
  const [editFofOptions, setEditFofOptions] = useState<FofFundOption[]>([])
  const [editFofDropdown, setEditFofDropdown] = useState(false)
  const [editInvestorName, setEditInvestorName] = useState("")
  const fetchedOnce = useRef(false)

  function loadRows(q = keyword) {
    setLoading(true)
    const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""
    fetch(`/ma/api/ops/ta-accounts${params}`)
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  async function runFetch() {
    setFetching(true)
    setFetchMsg(null)
    try {
      const res = await fetch("/ma/api/ops/ta-accounts/fetch", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "抓取失败")
      setFetchMsg(
        `扫描 ${data.emailsScanned ?? 0} 封邮件，解析 ${data.recordsFound ?? 0} 条，新增 ${data.inserted ?? 0}，更新 ${data.updated ?? 0}，关联 FOF ${data.linked ?? 0} 条`,
      )
      loadRows()
    } catch (e) {
      setFetchMsg(e instanceof Error ? e.message : "抓取失败")
    } finally {
      setFetching(false)
    }
  }

  useEffect(() => { setPortalMounted(true) }, [])

  useEffect(() => {
    if (!fetchedOnce.current) {
      fetchedOnce.current = true
      void runFetch()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    loadRows(keyword)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword])

  useEffect(() => {
    if (!editFofDropdown) return
    const q = editFofInput.trim()
    const timer = setTimeout(() => {
      fetch(`/ma/api/ops/fof-underlying/fof-funds${q ? `?q=${encodeURIComponent(q)}` : ""}`)
        .then((r) => r.json())
        .then((data) => setEditFofOptions(Array.isArray(data) ? data : []))
        .catch(() => setEditFofOptions([]))
    }, 200)
    return () => clearTimeout(timer)
  }, [editFofInput, editFofDropdown])

  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  function openEdit(row: TaAccountRow) {
    setEditingRow(row)
    setEditLinkType(row.linkType === "investor" ? "investor" : "fof")
    setEditFofSelected(
      row.fofRegisterNumber && row.fofProductName
        ? { register_number: row.fofRegisterNumber, product_name: row.fofProductName }
        : null,
    )
    setEditFofInput("")
    setEditInvestorName(row.investorName ?? "")
    setShowEditModal(true)
  }

  async function saveEdit() {
    if (!editingRow) return
    if (editLinkType === "fof" && !editFofSelected) return
    setSaving(true)
    try {
      const payload =
        editLinkType === "fof"
          ? {
              linkType: "fof" as const,
              fofRegisterNumber: editFofSelected!.register_number,
              fofProductName: editFofSelected!.product_name,
              investorName: null,
            }
          : {
              linkType: "investor" as const,
              fofRegisterNumber: null,
              fofProductName: null,
              investorName: editInvestorName.trim() || editingRow.customerName,
            }
      const res = await fetch(`/ma/api/ops/ta-accounts/${editingRow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return
      setShowEditModal(false)
      loadRows()
    } finally {
      setSaving(false)
    }
  }

  async function saveAdd() {
    if (!addForm.customerName.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/ma/api/ops/ta-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      })
      if (!res.ok) return
      setShowAddModal(false)
      setAddForm({ customerName: "", taAccount: "" })
      loadRows()
    } finally {
      setSaving(false)
    }
  }

  async function deleteRow(id: string) {
    if (!confirm("确定删除该 TA 账号？")) return
    const res = await fetch(`/ma/api/ops/ta-accounts/${id}`, { method: "DELETE" })
    if (res.ok) loadRows()
  }

  return (
    <>
      <div className="flex items-center justify-between mt-4 mb-3 gap-4">
        <div className="flex items-center border rounded px-2 h-8 gap-1.5 bg-background w-72">
          <input
            className="flex-1 text-sm outline-none bg-transparent placeholder:text-muted-foreground/50"
            placeholder="客户名称/TA账号搜索"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setKeyword(searchInput)}
          />
          <button onClick={() => setKeyword(searchInput)} className="text-muted-foreground hover:text-foreground transition-colors">
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void runFetch()}
            disabled={fetching}
            className="px-4 py-1.5 border border-red-500 text-red-500 text-sm font-medium rounded hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-40"
          >
            {fetching ? "抓取中…" : "邮箱抓取"}
          </button>
          <button
            onClick={() => { setAddForm({ customerName: "", taAccount: "" }); setShowAddModal(true) }}
            className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded transition-colors"
          >
            添加TA账号
          </button>
        </div>
      </div>
      {fetchMsg && (
        <p className={`text-xs mb-3 ${fetchMsg.includes("失败") || fetchMsg.includes("配置") ? "text-amber-700 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
          {fetchMsg}
        </p>
      )}

      <div className="overflow-auto rounded border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/40 border-b">
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-16">序号</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">客户名称</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-36">TA账号</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-44">关联FOF产品</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-28">来源</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={6} className="py-20 text-center text-muted-foreground">暂无 TA 账号数据</td></tr>
            ) : pageRows.map((row, i) => (
              <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 text-muted-foreground tabular-nums">{(page - 1) * pageSize + i + 1}</td>
                <td className="px-4 py-3">{row.customerName}</td>
                <td className="px-4 py-3 font-mono text-xs">{row.taAccount || "—"}</td>
                <td className="px-4 py-3">
                  {row.fofProductName ? (
                    <button type="button" className="text-blue-600 hover:underline text-left">{row.fofProductName}</button>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.source}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3">
                    <button title="编辑" className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => openEdit(row)}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    {row.source === "手动添加" && (
                      <button title="删除" className="text-muted-foreground hover:text-red-500 transition-colors" onClick={() => void deleteRow(row.id)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-4 mt-4 pt-3 text-sm text-zinc-500">
        <span>共 {total} 条</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="w-7 h-7 flex items-center justify-center rounded border hover:bg-muted transition-colors disabled:opacity-30">‹</button>
          <span className="w-7 h-7 flex items-center justify-center rounded border bg-red-500 text-white text-xs font-medium">{page}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || total === 0} className="w-7 h-7 flex items-center justify-center rounded border hover:bg-muted transition-colors disabled:opacity-30">›</button>
        </div>
      </div>

      {portalMounted && showAddModal && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setShowAddModal(false)}>
          <div className="bg-background border rounded-lg shadow-xl w-[520px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-base">添加TA账号</span>
              <button onClick={() => setShowAddModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="space-y-4 mb-5">
              <div className="flex items-center gap-3">
                <label className="text-sm shrink-0 w-24 text-right"><span className="text-red-500 mr-0.5">*</span>客户名称：</label>
                <input className="flex-1 border rounded px-3 py-2 text-sm bg-background" value={addForm.customerName} onChange={(e) => setAddForm((f) => ({ ...f, customerName: e.target.value }))} />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm shrink-0 w-24 text-right">TA账号：</label>
                <input className="flex-1 border rounded px-3 py-2 text-sm bg-background" value={addForm.taAccount} onChange={(e) => setAddForm((f) => ({ ...f, taAccount: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowAddModal(false)} className="px-6 py-1.5 border rounded text-sm hover:bg-muted">取消</button>
              <button type="button" onClick={() => void saveAdd()} disabled={saving || !addForm.customerName.trim()} className="px-6 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 disabled:opacity-40">确定</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {portalMounted && showEditModal && editingRow && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setShowEditModal(false)}>
          <div className="bg-background border rounded-lg shadow-xl w-[520px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-base">编辑TA账号</span>
              <button onClick={() => setShowEditModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="space-y-4 mb-4">
              <div className="flex items-center gap-3">
                <label className="text-sm shrink-0 w-24 text-right"><span className="text-red-500 mr-0.5">*</span>客户名称：</label>
                <input readOnly className="flex-1 border rounded px-3 py-2 text-sm bg-muted/40 text-muted-foreground" value={editingRow.customerName} />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm shrink-0 w-24 text-right">TA账号：</label>
                <input readOnly className="flex-1 border rounded px-3 py-2 text-sm bg-muted/40 text-muted-foreground font-mono" value={editingRow.taAccount} />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm shrink-0 w-24 text-right">关联：</label>
                <div className="flex items-center gap-5 text-sm">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={editLinkType === "fof"} onChange={() => setEditLinkType("fof")} className="text-red-500" />
                    FOF产品
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={editLinkType === "investor"} onChange={() => setEditLinkType("investor")} className="text-red-500" />
                    投资者
                  </label>
                </div>
              </div>
              {editLinkType === "fof" ? (
                <div className="flex items-center gap-3">
                  <label className="text-sm shrink-0 w-24 text-right"><span className="text-red-500 mr-0.5">*</span>FOF产品：</label>
                  <div className="relative flex-1">
                    {editFofSelected ? (
                      <div className="flex items-center justify-between border rounded px-3 py-2 text-sm bg-background">
                        <span className="truncate">{editFofSelected.product_name}</span>
                        <button type="button" onClick={() => setEditFofSelected(null)} className="text-muted-foreground hover:text-foreground ml-2">×</button>
                      </div>
                    ) : (
                      <>
                        <input
                          className="w-full border rounded px-3 py-2 text-sm bg-background"
                          placeholder="请输入并选择FOF产品"
                          value={editFofInput}
                          onChange={(e) => { setEditFofInput(e.target.value); setEditFofDropdown(true) }}
                          onFocus={() => setEditFofDropdown(true)}
                        />
                        {editFofDropdown && editFofOptions.length > 0 && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setEditFofDropdown(false)} />
                            <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-background border rounded shadow-lg max-h-40 overflow-y-auto">
                              {editFofOptions.map((opt) => (
                                <button
                                  key={opt.register_number}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => { setEditFofSelected(opt); setEditFofInput(""); setEditFofDropdown(false) }}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted truncate"
                                >
                                  {opt.product_name}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <label className="text-sm shrink-0 w-24 text-right">投资者：</label>
                  <input className="flex-1 border rounded px-3 py-2 text-sm bg-background" value={editInvestorName} onChange={(e) => setEditInvestorName(e.target.value)} placeholder={editingRow.customerName} />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              若客户为基金产品，需填写关联FOF产品。搜索无结果，请联系客服。
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowEditModal(false)} className="px-6 py-1.5 border rounded text-sm hover:bg-muted">取消</button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={saving || (editLinkType === "fof" && !editFofSelected)}
                className="px-6 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 disabled:opacity-40"
              >
                确定
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

async function readJsonResponse(res: Response): Promise<{ data: Record<string, unknown>; raw: string }> {
  const raw = await res.text()
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    return { data, raw }
  } catch {
    const trimmed = raw.trimStart()
    if (trimmed.startsWith("<")) {
      if (res.status === 504 || /504|Gateway Time-out|gateway timeout/i.test(raw)) {
        throw new Error("请求超时（网关 504）。邮件扫描耗时较长，请减少扫描天数后重试，或请管理员将 Nginx 超时延长至 15 分钟。")
      }
      throw new Error(`服务器返回了 HTML 错误页（HTTP ${res.status}），不是 JSON。请稍后重试或联系管理员查看服务日志。`)
    }
    throw new Error(raw.slice(0, 200) || "响应不是有效 JSON")
  }
}

function formatParseDateInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function formatParseDateTime(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const h = String(d.getHours()).padStart(2, "0")
  const min = String(d.getMinutes()).padStart(2, "0")
  return `${y}-${m}-${day} ${h}:${min}`
}

function parseStatusClass(status: "成功" | "失败"): string {
  return status === "成功"
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-amber-600 dark:text-amber-400"
}

function ParseStatusRadios({
  label,
  value,
  onChange,
}: {
  label: string
  value: ParseStatusFilter
  onChange: (v: ParseStatusFilter) => void
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground shrink-0">{label}</span>
      {(["all", "成功", "失败"] as const).map((opt) => (
        <label key={opt} className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
          <input
            type="radio"
            className="text-red-500"
            checked={value === opt}
            onChange={() => onChange(opt)}
          />
          <span>{opt === "all" ? "不限" : opt}</span>
        </label>
      ))}
    </div>
  )
}

function OperationsParseLogsPanel() {
  const today = new Date()
  const defaultFrom = new Date(today)
  defaultFrom.setDate(defaultFrom.getDate() - 31)

  const [rows, setRows] = useState<EmailParseRecordRow[]>([])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(false)
  const [fetchMsg, setFetchMsg] = useState<string | null>(null)
  const [fetchMsgIsError, setFetchMsgIsError] = useState(false)
  const [fetchDays, setFetchDays] = useState(31)
  const fetchPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState({ total: 0, success: 0, failure: 0, lastUpdatedAt: null as string | null })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const pageSize = 20

  const [tableNavFilter, setTableNavFilter] = useState<ParseStatusFilter>("all")
  const [postTableNavFilter, setPostTableNavFilter] = useState<ParseStatusFilter>("all")
  const [valuationFilter, setValuationFilter] = useState<ParseStatusFilter>("all")
  const [ledgerFilter, setLedgerFilter] = useState<ParseStatusFilter>("all")
  const [sentFrom, setSentFrom] = useState(formatParseDateInput(defaultFrom))
  const [sentTo, setSentTo] = useState(formatParseDateInput(today))
  const [subjectInput, setSubjectInput] = useState("")
  const [subjectKeyword, setSubjectKeyword] = useState("")

  const [appliedFilters, setAppliedFilters] = useState({
    tableNavFilter: "all" as ParseStatusFilter,
    postTableNavFilter: "all" as ParseStatusFilter,
    valuationFilter: "all" as ParseStatusFilter,
    ledgerFilter: "all" as ParseStatusFilter,
    sentFrom: formatParseDateInput(defaultFrom),
    sentTo: formatParseDateInput(today),
    subjectKeyword: "",
  })

  const fetchedOnce = useRef(false)
  const backfilledKeys = useRef(new Set<string>())

  function buildQuery(p = page) {
    const params = new URLSearchParams()
    if (appliedFilters.tableNavFilter !== "all") params.set("tableNavStatus", appliedFilters.tableNavFilter)
    if (appliedFilters.postTableNavFilter !== "all") params.set("postTableNavStatus", appliedFilters.postTableNavFilter)
    if (appliedFilters.valuationFilter !== "all") params.set("valuationStatus", appliedFilters.valuationFilter)
    if (appliedFilters.ledgerFilter !== "all") params.set("ledgerStatus", appliedFilters.ledgerFilter)
    if (appliedFilters.sentFrom) params.set("sentFrom", appliedFilters.sentFrom)
    if (appliedFilters.sentTo) params.set("sentTo", appliedFilters.sentTo)
    if (appliedFilters.subjectKeyword.trim()) params.set("subject", appliedFilters.subjectKeyword.trim())
    params.set("page", String(p))
    params.set("pageSize", String(pageSize))
    return params.toString()
  }

  function loadRows(p = page) {
    setLoading(true)
    fetch(`/ma/api/ops/email-parse-records?${buildQuery(p)}`)
      .then((r) => r.json())
      .then((data) => {
        setRows(Array.isArray(data.rows) ? data.rows : [])
        setTotal(typeof data.total === "number" ? data.total : 0)
        if (data.stats) {
          setStats({
            total: data.stats.total ?? 0,
            success: data.stats.success ?? 0,
            failure: data.stats.failure ?? 0,
            lastUpdatedAt: data.stats.lastUpdatedAt ?? null,
          })
        }
      })
      .catch(() => {
        setRows([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }

  function stopFetchPolling() {
    if (fetchPollRef.current) {
      clearInterval(fetchPollRef.current)
      fetchPollRef.current = null
    }
  }

  function formatFetchResult(data: {
    emailsScanned?: number
    recordsFound?: number
    navSaved?: number
    errors?: string[]
  } | undefined): string {
    if (!data) return "解析完成"
    const errNote =
      Array.isArray(data.errors) && data.errors.length > 0
        ? `（部分步骤失败：${data.errors.slice(0, 2).join("；")}）`
        : ""
    return `扫描 ${data.emailsScanned ?? 0} 封基金相关邮件，解析记录 ${data.recordsFound ?? 0} 条，净值入库 ${data.navSaved ?? 0} 条${errNote}`
  }

  function startFetchPolling() {
    stopFetchPolling()
    setFetching(true)
    fetchPollRef.current = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch("/ma/api/ops/email-parse-records/fetch-status")
          const status = (await res.json()) as {
            status?: string
            message?: string
            result?: { emailsScanned?: number; recordsFound?: number; navSaved?: number; errors?: string[] }
          } | null
          if (!status) {
            stopFetchPolling()
            setFetching(false)
            return
          }
          if (status.status === "queued" || status.status === "running") {
            setFetchMsg(status.message ?? "正在扫描并解析邮件…")
            setFetchMsgIsError(false)
            return
          }
          stopFetchPolling()
          setFetching(false)
          if (status.status === "done") {
            setFetchMsg(formatFetchResult(status.result))
            setFetchMsgIsError(false)
            setPage(1)
            loadRows(1)
          } else {
            setFetchMsg(status.message ?? "抓取失败")
            setFetchMsgIsError(true)
          }
        } catch {
          // network hiccup — keep polling
        }
      })()
    }, 2000)
  }

  async function runFetch() {
    setFetching(true)
    setFetchMsg(null)
    setFetchMsgIsError(false)
    try {
      const res = await fetch("/ma/api/ops/email-parse-records/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: fetchDays }),
      })
      if (res.status === 202 || res.status === 409) {
        setFetchMsg("正在扫描并解析邮件，请稍候…")
        startFetchPolling()
        return
      }
      const { data } = await readJsonResponse(res)
      if (!res.ok) throw new Error(String(data.error ?? "抓取失败"))
      setFetchMsg(formatFetchResult(data as { emailsScanned?: number; recordsFound?: number; navSaved?: number; errors?: string[] }))
      setFetchMsgIsError(false)
      setPage(1)
      loadRows(1)
    } catch (e) {
      setFetchMsg(e instanceof Error ? e.message : "抓取失败")
      setFetchMsgIsError(true)
    } finally {
      if (!fetchPollRef.current) setFetching(false)
    }
  }

  function applyQuery() {
    setSubjectKeyword(subjectInput)
    setAppliedFilters({
      tableNavFilter,
      postTableNavFilter,
      valuationFilter,
      ledgerFilter,
      sentFrom,
      sentTo,
      subjectKeyword: subjectInput,
    })
    setPage(1)
  }

  function handleExport() {
    const headers = ["发送时间", "邮件标题", "收件邮箱", "发件邮箱", "费前净值解析状态", "费后净值解析状态", "估值表抓取状态", "台账抓取状态"]
    const exportRows = rows.map((row) => [
      new Date(row.sentAt).toLocaleString("zh-CN"),
      row.subject,
      row.crawlEmailAccount,
      row.senderEmail || "—",
      row.tableNavStatus,
      row.postTableNavStatus,
      row.valuationStatus,
      row.ledgerStatus,
    ])
    const csv = [headers, ...exportRows]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `解析记录_${formatParseDateInput(new Date())}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    loadRows(page)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, appliedFilters])

  useEffect(() => {
    if (loading || rows.length === 0) return
    const pending = rows.filter((row) => {
      if (row.senderEmail?.trim() || !row.uid) return false
      const key = `${row.crawlEmailAccount}|${row.uid}`
      if (backfilledKeys.current.has(key)) return false
      backfilledKeys.current.add(key)
      return true
    })
    if (pending.length > 0) void backfillSendersForRows(pending)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, loading])

  async function backfillSendersForRows(targetRows: EmailParseRecordRow[]) {
    const items = targetRows
      .filter((row) => !row.senderEmail?.trim() && row.uid)
      .map((row) => ({ crawlEmailAccount: row.crawlEmailAccount, uid: row.uid! }))
    if (items.length === 0) return
    try {
      const res = await fetch("/ma/api/ops/email-parse-records/backfill-senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      })
      const data = await res.json()
      if (res.ok && (data.updated ?? 0) > 0) loadRows(page)
    } catch {
      // ignore; user can retry via 重新解析
    }
  }

  useEffect(() => {
    return () => stopFetchPolling()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!fetchedOnce.current) {
      fetchedOnce.current = true
      void (async () => {
        try {
          const statusRes = await fetch("/ma/api/ops/email-parse-records/fetch-status")
          const jobStatus = (await statusRes.json()) as { status?: string; message?: string } | null
          if (jobStatus && (jobStatus.status === "queued" || jobStatus.status === "running")) {
            setFetchMsg(jobStatus.message ?? "正在扫描并解析邮件…")
            startFetchPolling()
            loadRows(1)
            return
          }
        } catch {
          // ignore
        }
        const res = await fetch("/ma/api/ops/email-parse-records?page=1&pageSize=1")
        const data = await res.json()
        if ((data.total ?? 0) === 0) void runFetch()
        else loadRows(1)
      })()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <p className="text-xs text-muted-foreground mt-4 mb-3 shrink-0">
        * 仅抓取与基金相关的净值、估值表、台账等邮件，并记录各步骤解析结果。
      </p>

      <div className="flex items-stretch border rounded mb-4 bg-muted/20 overflow-hidden shrink-0">
        <div className="flex-1 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-950/50 text-blue-500">
              <FileText className="h-4 w-4" />
            </span>
            <div className="flex items-baseline gap-1.5 text-sm text-foreground">
              <span>解析总数：</span>
              <span className="text-2xl font-semibold tabular-nums text-blue-500 leading-none">{stats.total}</span>
              <span className="text-muted-foreground">封</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2 pl-12">
            最后更新时间：{formatParseDateTime(stats.lastUpdatedAt)}
          </p>
        </div>
        <div className="w-px bg-border self-stretch" />
        <div className="flex-1 px-6 py-4 flex items-center gap-3">
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-500">
            <CircleCheck className="h-4 w-4" />
          </span>
          <div className="flex items-baseline gap-1.5 text-sm text-foreground">
            <span>费前解析成功：</span>
            <span className="text-2xl font-semibold tabular-nums text-emerald-500 leading-none">{stats.success}</span>
            <span className="text-muted-foreground">封</span>
          </div>
        </div>
        <div className="w-px bg-border self-stretch" />
        <div className="flex-1 px-6 py-4 flex items-center gap-3">
          <span className="flex items-center justify-center w-9 h-9 rounded-full bg-red-100 dark:bg-red-950/50 text-red-500">
            <CircleX className="h-4 w-4" />
          </span>
          <div className="flex items-baseline gap-1.5 text-sm text-foreground">
            <span>费前解析失败：</span>
            <span className="text-2xl font-semibold tabular-nums text-red-500 leading-none">{stats.failure}</span>
            <span className="text-muted-foreground">封</span>
          </div>
        </div>
      </div>

      <div className="border rounded p-4 mb-4 space-y-3 bg-muted/10 shrink-0">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <ParseStatusRadios label="费前净值解析状态" value={tableNavFilter} onChange={setTableNavFilter} />
          <ParseStatusRadios label="费后净值解析状态" value={postTableNavFilter} onChange={setPostTableNavFilter} />
          <ParseStatusRadios label="估值表抓取状态" value={valuationFilter} onChange={setValuationFilter} />
          <ParseStatusRadios label="台账抓取状态" value={ledgerFilter} onChange={setLedgerFilter} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground shrink-0">发送时间</span>
          <input
            type="date"
            value={sentFrom}
            onChange={(e) => setSentFrom(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-background"
          />
          <span className="text-muted-foreground text-xs">—</span>
          <input
            type="date"
            value={sentTo}
            onChange={(e) => setSentTo(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-background"
          />
          <button
            type="button"
            onClick={applyQuery}
            className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded transition-colors"
          >
            查询
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 gap-4 shrink-0">
        <div className="flex items-center border rounded px-2 h-8 gap-1.5 bg-background w-80">
          <span className="text-xs text-muted-foreground shrink-0">邮件标题</span>
          <input
            className="flex-1 text-sm outline-none bg-transparent placeholder:text-muted-foreground/50"
            placeholder="搜索邮件标题"
            value={subjectInput}
            onChange={(e) => setSubjectInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setSubjectKeyword(subjectInput)
                setAppliedFilters((f) => ({ ...f, subjectKeyword: subjectInput }))
                setPage(1)
              }
            }}
          />
          <button
            onClick={() => {
              setSubjectKeyword(subjectInput)
              setAppliedFilters((f) => ({ ...f, subjectKeyword: subjectInput }))
              setPage(1)
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExport}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded text-sm hover:bg-muted transition-colors disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> 导出
          </button>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={365}
              value={fetchDays}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                if (Number.isFinite(v) && v > 0) setFetchDays(v)
              }}
              disabled={fetching}
              className="w-16 px-2 py-1.5 border rounded text-sm text-center disabled:opacity-40"
              title="扫描天数"
            />
            <span className="text-xs text-muted-foreground">天</span>
          </div>
          <button
            type="button"
            onClick={() => void runFetch()}
            disabled={fetching}
            className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded transition-colors disabled:opacity-40"
          >
            {fetching ? "解析中…" : "重新解析"}
          </button>
        </div>
      </div>

      {fetchMsg && (
        <p className={`text-xs mb-3 shrink-0 ${fetchMsgIsError ? "text-amber-700 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
          {fetchMsg}
        </p>
      )}

      <div className="overflow-auto rounded border flex-1 min-h-0">
        <table className="w-full text-sm border-collapse" style={{ minWidth: 1320 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/40 border-b">
              <th className="px-3 py-3 w-10 sticky left-0 z-30 bg-muted/40 dark:bg-muted/20">
                <input
                  type="checkbox"
                  className="rounded h-3 w-3"
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={() => {
                    if (selected.size === rows.length) setSelected(new Set())
                    else setSelected(new Set(rows.map((r) => r.id)))
                  }}
                />
              </th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-12 sticky left-10 z-30 bg-muted/40 dark:bg-muted/20 border-r border-zinc-200 dark:border-zinc-700 whitespace-nowrap">序号</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-36 whitespace-nowrap">发送时间</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 min-w-[320px]">邮件标题</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-40 whitespace-nowrap">收件邮箱</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-44 whitespace-nowrap border-r border-zinc-200 dark:border-zinc-700">发件邮箱</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-28 sticky right-[22.5rem] z-30 bg-muted/40 dark:bg-muted/20 border-l border-zinc-200 dark:border-zinc-700 whitespace-nowrap">费前净值<br />解析状态</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-28 sticky right-[15.5rem] z-30 bg-muted/40 dark:bg-muted/20 whitespace-nowrap">费后净值<br />解析状态</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-24 sticky right-[9.5rem] z-30 bg-muted/40 dark:bg-muted/20 whitespace-nowrap">估值表<br />抓取状态</th>
              <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-24 sticky right-14 z-30 bg-muted/40 dark:bg-muted/20 whitespace-nowrap">台账<br />抓取状态</th>
              <th className="px-3 py-3 text-center text-xs font-semibold text-zinc-500 w-14 sticky right-0 z-30 bg-muted/40 dark:bg-muted/20 whitespace-nowrap">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-3">
                    <span>暂无解析记录</span>
                    <button
                      type="button"
                      onClick={() => void runFetch()}
                      disabled={fetching}
                      className="px-4 py-1.5 bg-red-500 text-white text-sm rounded hover:bg-red-600 disabled:opacity-40"
                    >
                      {fetching ? "解析中…" : "开始解析"}
                    </button>
                  </div>
                </td>
              </tr>
            ) : rows.map((row, i) => {
              const isSelected = selected.has(row.id)
              const stickyLeftTd = isSelected
                ? "px-3 py-3 sticky z-10 border-b bg-blue-50/50 dark:bg-blue-950/20"
                : "px-3 py-3 sticky z-10 border-b bg-background group-hover:bg-muted/20"
              const stickyRightTd = stickyLeftTd
              return (
                <tr key={row.id || `${row.crawlEmailAccount}-${row.sentAt}`} className={`group border-b hover:bg-muted/20 ${isSelected ? "bg-blue-50/50 dark:bg-blue-950/20" : ""}`}>
                  <td className={`${stickyLeftTd} text-center sticky left-0`}>
                    <input
                      type="checkbox"
                      className="rounded h-3 w-3"
                      checked={isSelected}
                      onChange={() => {
                        const next = new Set(selected)
                        if (isSelected) next.delete(row.id)
                        else next.add(row.id)
                        setSelected(next)
                      }}
                    />
                  </td>
                  <td className={`${stickyLeftTd} text-muted-foreground tabular-nums sticky left-10 border-r border-zinc-200 dark:border-zinc-700`}>{(page - 1) * pageSize + i + 1}</td>
                  <td className="px-3 py-3 text-muted-foreground text-xs whitespace-nowrap border-b">
                    {new Date(row.sentAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-3 py-3 min-w-[320px] border-b" title={row.subject}>
                    <span className="block truncate max-w-[480px]">{row.subject}</span>
                  </td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap border-b">{row.crawlEmailAccount}</td>
                  <td className="px-3 py-3 text-xs whitespace-nowrap border-b border-r border-zinc-200 dark:border-zinc-700">{row.senderEmail || "—"}</td>
                  <td className={`${stickyRightTd} font-medium sticky right-[22.5rem] border-l border-zinc-200 dark:border-zinc-700 ${parseStatusClass(row.tableNavStatus)}`}>{row.tableNavStatus}</td>
                  <td className={`${stickyRightTd} font-medium sticky right-[15.5rem] ${parseStatusClass(row.postTableNavStatus)}`}>{row.postTableNavStatus}</td>
                  <td className={`${stickyRightTd} font-medium sticky right-[9.5rem] ${parseStatusClass(row.valuationStatus)}`}>{row.valuationStatus}</td>
                  <td className={`${stickyRightTd} font-medium sticky right-14 ${parseStatusClass(row.ledgerStatus)}`}>{row.ledgerStatus}</td>
                  <td className={`${stickyRightTd} text-center sticky right-0`}>
                    <button
                      type="button"
                      title="查看"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => alert(row.subject)}
                    >
                      <Eye className="h-4 w-4 inline" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-4 mt-4 pt-3 text-sm text-zinc-500 shrink-0">
        <span>共 {total} 条</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded border hover:bg-muted transition-colors disabled:opacity-30"
          >‹</button>
          <span className="w-7 h-7 flex items-center justify-center rounded border bg-red-500 text-white text-xs font-medium">{page}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || total === 0}
            className="w-7 h-7 flex items-center justify-center rounded border hover:bg-muted transition-colors disabled:opacity-30"
          >›</button>
        </div>
      </div>
    </div>
  )
}

function OperationsEmailSyncView() {
  const [emailTab, setEmailTab] = useState<"crawl" | "ta" | "parse">("crawl")
  const [rows, setRows] = useState<CrawlEmailRow[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [checkedPop, setCheckedPop] = useState(false)
  const [checkedAgreement, setCheckedAgreement] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [listingFolders, setListingFolders] = useState(false)
  const [availableFolders, setAvailableFolders] = useState<string[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importOptions, setImportOptions] = useState<ImportableEmailOption[]>([])
  const [importOptionsLoading, setImportOptionsLoading] = useState(false)
  const [selectedImportAccounts, setSelectedImportAccounts] = useState<Set<string>>(new Set())
  const [portalMounted, setPortalMounted] = useState(false)
  const [form, setForm] = useState({
    emailType: "",
    account: "",
    pass: "",
    imapHost: "",
    imapPort: 993,
    imapFolders: ["INBOX"],
    remark: "",
  })

  const emailTabs = [
    { key: "crawl" as const, label: "抓取邮箱设置" },
    { key: "ta" as const, label: "TA账号" },
    { key: "parse" as const, label: "解析记录" },
  ]

  function loadRows() {
    setLoading(true)
    fetch("/ma/api/ops/crawl-emails")
      .then((r) => r.json())
      .then((data) => {
        setRows(Array.isArray(data) ? data : [])
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }

  async function openImportModal() {
    setShowImportModal(true)
    setImportOptionsLoading(true)
    setSelectedImportAccounts(new Set())
    setImportMsg(null)
    try {
      const res = await fetch("/ma/api/ops/crawl-emails/importable")
      const data = await res.json()
      setImportOptions(Array.isArray(data) ? data : [])
    } catch {
      setImportOptions([])
    } finally {
      setImportOptionsLoading(false)
    }
  }

  function toggleImportAccount(account: string) {
    setSelectedImportAccounts((prev) => {
      const next = new Set(prev)
      if (next.has(account)) next.delete(account)
      else next.add(account)
      return next
    })
  }

  async function confirmImportSelected() {
    if (selectedImportAccounts.size === 0) return
    setImporting(true)
    setImportMsg(null)
    try {
      const res = await fetch("/ma/api/ops/crawl-emails/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts: [...selectedImportAccounts] }),
      })
      const data = await res.json()
      setImportMsg(data.message || data.error || (res.ok ? "导入完成" : "导入失败"))
      if (res.ok) {
        setShowImportModal(false)
        setSelectedImportAccounts(new Set())
        loadRows()
      }
    } catch {
      setImportMsg("导入失败，请稍后重试")
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => { loadRows() }, [])
  useEffect(() => { setPortalMounted(true) }, [])

  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  function resolveImapConfig() {
    const preset = CRAWL_EMAIL_PRESETS.find((p) => p.label === form.emailType)
    return {
      imapHost: form.emailType === "其他" ? form.imapHost : (preset?.imapHost ?? form.imapHost),
      imapPort: preset?.imapPort ?? form.imapPort,
    }
  }

  function openAddModal() {
    setEditingId(null)
    setShowPass(false)
    setCheckedPop(false)
    setCheckedAgreement(false)
    setTestResult(null)
    setAvailableFolders(null)
    setForm({
      emailType: "",
      account: "",
      pass: "",
      imapHost: "",
      imapPort: 993,
      imapFolders: ["INBOX"],
      remark: "",
    })
    setShowModal(true)
  }

  function openEditModal(row: CrawlEmailRow) {
    setEditingId(row.id)
    setShowPass(false)
    setCheckedPop(true)
    setCheckedAgreement(true)
    setTestResult(null)
    setAvailableFolders(null)
    setForm({
      emailType: row.emailType,
      account: row.account,
      pass: "",
      imapHost: row.imapHost,
      imapPort: row.imapPort,
      imapFolders: row.imapFolders?.length ? row.imapFolders : ["INBOX"],
      remark: row.remark,
    })
    setShowModal(true)
  }

  async function listFolders() {
    if (!editingId) return
    setListingFolders(true)
    setAvailableFolders(null)
    try {
      const res = await fetch(`/ma/api/ops/crawl-emails/${editingId}/list-folders`)
      const data = await res.json()
      setAvailableFolders(Array.isArray(data.folders) ? data.folders : [])
    } catch {
      setAvailableFolders([])
    } finally {
      setListingFolders(false)
    }
  }

  const canSave =
    form.emailType.trim() &&
    form.account.trim() &&
    (editingId || form.pass.trim()) &&
    (editingId || (checkedPop && checkedAgreement))

  const canTest =
    form.emailType.trim() &&
    form.account.trim() &&
    resolveImapConfig().imapHost.trim() &&
    (form.pass.trim() || !!editingId)

  async function testConnection() {
    if (!canTest) return
    const { imapHost, imapPort } = resolveImapConfig()
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch("/ma/api/ops/crawl-emails/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: form.account,
          pass: form.pass.trim() || undefined,
          imapHost,
          imapPort,
          id: editingId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTestResult({ ok: false, message: data.error || "连接失败" })
        return
      }
      setTestResult({ ok: true, message: data.message || "连接成功" })
    } catch {
      setTestResult({ ok: false, message: "连接失败" })
    } finally {
      setTesting(false)
    }
  }

  async function saveRow() {
    if (!canSave) return
    setSaving(true)
    try {
      const { imapHost, imapPort } = resolveImapConfig()
      const payload: Record<string, string | number | string[]> = {
        emailType: form.emailType,
        account: form.account,
        imapHost,
        imapPort,
        imapFolders: form.imapFolders.length ? form.imapFolders : ["INBOX"],
        remark: form.remark,
      }
      if (form.pass.trim()) payload.pass = form.pass
      const res = await fetch(
        editingId ? `/ma/api/ops/crawl-emails/${editingId}` : "/ma/api/ops/crawl-emails",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) return
      setShowModal(false)
      loadRows()
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  async function deleteRow(id: string) {
    if (!confirm("确定删除该抓取邮箱？")) return
    try {
      const res = await fetch(`/ma/api/ops/crawl-emails/${id}`, { method: "DELETE" })
      if (res.ok) loadRows()
    } catch {
      // ignore
    }
  }

  function statusClass(status: CrawlEmailRow["crawlStatus"]) {
    if (status === "成功") return "text-emerald-600 dark:text-emerald-400"
    if (status === "失败") return "text-red-500"
    return "text-muted-foreground"
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center border-b shrink-0">
        {emailTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setEmailTab(t.key)}
            className={[
              "px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
              emailTab === t.key
                ? "border-red-500 text-red-600 dark:text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {emailTab === "crawl" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-auto">
          <div className="flex items-center justify-between mt-4 mb-3 gap-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              说明：设置抓取邮箱以抓取估值表、净值信息。数据信息仅供团队内部使用。如有疑问，请联系客服。
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void openImportModal()}
                disabled={importing}
                className="px-4 py-1.5 border border-red-500 text-red-500 text-sm font-medium rounded hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-40"
              >
                导入已配置邮箱
              </button>
              <button
                onClick={openAddModal}
                className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded transition-colors"
              >
                添加抓取邮箱
              </button>
            </div>
          </div>
          {importMsg && (
            <p className={`text-xs mb-3 ${importMsg.includes("成功") ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
              {importMsg}
            </p>
          )}

          <div className="overflow-auto rounded border">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-16">序号</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-28">邮箱类型</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">账户</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-36">邮箱密码/授权码</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-24">抓取状态</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-32">邮箱备注</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 w-24">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
                ) : pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-20 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-3">
                        <span>暂无数据</span>
                        <span className="text-xs max-w-md">可点击「导入已配置邮箱」从「小工具 → 自动发邮件」选择要添加的账号</span>
                        <button
                          type="button"
                          onClick={() => void openImportModal()}
                          disabled={importing}
                          className="px-4 py-1.5 border border-red-500 text-red-500 text-sm rounded hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-40"
                        >
                          导入已配置邮箱
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : pageRows.map((row, i) => (
                  <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{(page - 1) * pageSize + i + 1}</td>
                    <td className="px-4 py-3">{row.emailType}</td>
                    <td className="px-4 py-3">{row.account}</td>
                    <td className="px-4 py-3 text-muted-foreground tracking-widest">{row.passMasked || "—"}</td>
                    <td className={`px-4 py-3 font-medium ${statusClass(row.crawlStatus)}`}>{row.crawlStatus}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.remark || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          title="编辑"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => openEditModal(row)}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          title="删除"
                          className="text-muted-foreground hover:text-red-500 transition-colors"
                          onClick={() => void deleteRow(row.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-4 mt-4 pt-3 text-sm text-zinc-500">
            <span>共 {total} 条</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 flex items-center justify-center rounded border hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >‹</button>
              <span className="w-7 h-7 flex items-center justify-center rounded border bg-red-500 text-white text-xs font-medium">{page}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || total === 0}
                className="w-7 h-7 flex items-center justify-center rounded border hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >›</button>
            </div>
          </div>
        </div>
      )}

      {emailTab === "ta" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-auto">
          <OperationsTaAccountsPanel />
        </div>
      )}

      {emailTab === "parse" && <OperationsParseLogsPanel />}

      {portalMounted && showImportModal && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setShowImportModal(false)}>
          <div className="bg-background border rounded-lg shadow-xl w-[520px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-base">导入已配置邮箱</span>
              <button type="button" onClick={() => setShowImportModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              从「小工具 → 自动发邮件」已配置的发件账号中选择要添加到抓取列表的邮箱。
            </p>
            <div className="border rounded max-h-[320px] overflow-y-auto mb-5">
              {importOptionsLoading ? (
                <div className="py-12 text-center text-sm text-muted-foreground">加载中…</div>
              ) : importOptions.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground px-4">
                  暂无可导入的邮箱。请先在「自动发邮件 → 发件账号」中配置，或列表中已包含全部已配置账号。
                </div>
              ) : (
                <div className="divide-y">
                  {importOptions.map((opt) => (
                    <label
                      key={opt.account}
                      className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedImportAccounts.has(opt.account)}
                        onChange={() => toggleImportAccount(opt.account)}
                        className="mt-1 rounded border-zinc-300 text-red-500 focus:ring-red-400"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{opt.remark || opt.account}</div>
                        <div className="text-sm text-muted-foreground">{opt.account}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {opt.emailType} · 来源：{opt.source}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-6 py-1.5 border rounded text-sm hover:bg-muted transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmImportSelected()}
                disabled={importing || selectedImportAccounts.size === 0}
                className="px-6 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40"
              >
                {importing ? "导入中…" : "确定"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {portalMounted && showModal && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
          <div className="bg-background border rounded-lg shadow-xl w-[520px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-base">{editingId ? "编辑抓取邮箱" : "添加抓取邮箱"}</span>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>

            {!editingId && (
              <div className="mb-5 px-3 py-2.5 rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                根据
                <button type="button" className="text-blue-600 hover:underline mx-0.5">《抓取邮箱设置》</button>
                教程填写，如有疑问请联系客服。
              </div>
            )}

            <form className="space-y-4 mb-5" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              <div className="flex items-center gap-3">
                <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-24 text-right">
                  <span className="text-red-500 mr-0.5">*</span>邮箱类型：
                </label>
                <select
                  className="flex-1 border rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring bg-background text-foreground"
                  value={form.emailType}
                  onChange={(e) => {
                    const preset = CRAWL_EMAIL_PRESETS.find((p) => p.label === e.target.value)
                    setForm((f) => ({
                      ...f,
                      emailType: e.target.value,
                      imapHost: preset?.imapHost ?? "",
                      imapPort: preset?.imapPort ?? 993,
                    }))
                  }}
                >
                  <option value="" disabled>请选择邮箱类型</option>
                  {CRAWL_EMAIL_PRESETS.map((p) => (
                    <option key={p.label} value={p.label}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-24 text-right">
                  <span className="text-red-500 mr-0.5">*</span>邮箱账户：
                </label>
                <input
                  autoFocus
                  name="crawl-mailbox-account"
                  autoComplete="off"
                  className="flex-1 border rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                  placeholder="请输入邮箱的登录账户"
                  value={form.account}
                  onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
                />
              </div>
              <div className="flex items-start gap-3">
                <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-24 text-right pt-2">
                  <span className="text-red-500 mr-0.5">*</span>授权码：
                </label>
                <div className="flex-1">
                  <div className="relative">
                    <input
                      type={showPass ? "text" : "password"}
                      name="crawl-mailbox-auth-code"
                      autoComplete="new-password"
                      className="w-full border rounded px-3 py-2 pr-9 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                      placeholder={editingId ? "留空则不修改" : "请输入授权码"}
                      value={form.pass}
                      onChange={(e) => setForm((f) => ({ ...f, pass: e.target.value }))}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {!editingId && (
                    <p className="mt-1.5 text-xs text-muted-foreground">联系客服，教您获取授权码</p>
                  )}
                </div>
              </div>
              {form.emailType === "其他" && (
                <div className="flex items-center gap-3">
                  <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-24 text-right">IMAP 服务器：</label>
                  <input
                    className="flex-1 border rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                    placeholder="imap.example.com"
                    value={form.imapHost}
                    onChange={(e) => setForm((f) => ({ ...f, imapHost: e.target.value }))}
                  />
                </div>
              )}
              <div className="flex items-start gap-3">
                <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-24 text-right pt-2">搜索文件夹：</label>
                <div className="flex-1 space-y-1.5">
                  {form.imapFolders.map((folder, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <input
                        className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background font-mono"
                        value={folder}
                        onChange={(e) => setForm((f) => {
                          const next = [...f.imapFolders]
                          next[idx] = e.target.value
                          return { ...f, imapFolders: next }
                        })}
                      />
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({
                          ...f,
                          imapFolders: f.imapFolders.filter((_, i) => i !== idx).length ? f.imapFolders.filter((_, i) => i !== idx) : ["INBOX"],
                        }))}
                        className="text-zinc-400 hover:text-red-500 px-1 text-lg leading-none"
                        title="删除"
                      >×</button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, imapFolders: [...f.imapFolders, ""] }))}
                      className="text-xs text-blue-600 hover:underline"
                    >＋ 添加文件夹</button>
                    {editingId && (
                      <button
                        type="button"
                        onClick={() => void listFolders()}
                        disabled={listingFolders}
                        className="text-xs text-blue-600 hover:underline disabled:opacity-40"
                      >{listingFolders ? "获取中…" : "查看可用文件夹"}</button>
                    )}
                  </div>
                  {availableFolders && (
                    <div className="mt-1 p-2 border rounded bg-muted/40 text-xs font-mono max-h-32 overflow-y-auto space-y-0.5">
                      {availableFolders.length === 0
                        ? <span className="text-muted-foreground">（无可用文件夹）</span>
                        : availableFolders.map((f) => (
                          <div
                            key={f}
                            className="cursor-pointer hover:text-blue-600 truncate"
                            title={`点击添加 ${f}`}
                            onClick={() => {
                              if (!form.imapFolders.includes(f)) {
                                setForm((prev) => ({ ...prev, imapFolders: [...prev.imapFolders, f] }))
                              }
                            }}
                          >{f}</div>
                        ))
                      }
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">默认仅搜索 INBOX。若邮件被自动归类到其他文件夹（如 163 的"系统邮件"），在此添加对应文件夹路径。</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-24 text-right">备注：</label>
                <input
                  className="flex-1 border rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                  placeholder="请输入备注"
                  value={form.remark}
                  onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
                />
              </div>
            </form>

            {!editingId && (
              <div className="space-y-2.5 mb-6">
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkedPop}
                    onChange={(e) => setCheckedPop(e.target.checked)}
                    className="rounded border-zinc-300 text-red-500 focus:ring-red-400"
                  />
                  检查并开启POP/IMAP服务/Exchange
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkedAgreement}
                    onChange={(e) => setCheckedAgreement(e.target.checked)}
                    className="rounded border-zinc-300 text-red-500 focus:ring-red-400"
                  />
                  <span>
                    查看并同意
                    <button type="button" className="text-blue-600 hover:underline mx-0.5">《数据保密协议》</button>
                  </span>
                </label>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => void testConnection()}
                  disabled={!canTest || testing || saving}
                  className="px-4 py-1.5 border border-red-500 text-red-500 rounded text-sm hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-40 shrink-0"
                >
                  {testing ? "测试中…" : "测试连接"}
                </button>
                {testResult && (
                  <span className={`text-xs truncate ${testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                    {testResult.message}
                  </span>
                )}
              </div>
              <div className="flex gap-3 shrink-0">
                <button onClick={() => setShowModal(false)}
                  className="px-6 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取消</button>
                <button
                  onClick={() => void saveRow()}
                  disabled={!canSave || saving || testing}
                  className="px-6 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40"
                >
                  {saving ? "保存中…" : "确定"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

function OperationsStrategyTagsView({ initialOpsTab = "strategies" }: { initialOpsTab?: "strategies" | "tags" | "fields" }) {
  const [opsTab, setOpsTab] = useState<"strategies" | "tags" | "fields">(initialOpsTab)
  const [strategies, setStrategies] = useState<OpsStrategyL1[]>([])
  const [loading, setLoading] = useState(false)
  const [strategySaving, setStrategySaving] = useState(false)
  const [expandedL1, setExpandedL1] = useState<Set<string>>(new Set())
  const [expandedL2, setExpandedL2] = useState<Set<string>>(new Set())
  const [showNewL1Modal, setShowNewL1Modal] = useState(false)
  const [newL1Name, setNewL1Name] = useState("")
  const [openNewFieldModal, setOpenNewFieldModal] = useState(false)
  const [addChildModal, setAddChildModal] = useState<{ level: 2 | 3; l1: string; l2?: string } | null>(null)
  const [addChildNames, setAddChildNames] = useState<string[]>([""])
  const [editL3Modal, setEditL3Modal] = useState<{ l1: string; l2: string } | null>(null)
  const [editL3Names, setEditL3Names] = useState<string[]>([])
  const [editingKey, setEditingKey] = useState<{ l1: string } | null>(null)
  const [editName, setEditName] = useState("")

  function currentUserName(): string {
    try {
      const u = JSON.parse(localStorage.getItem("currentUser") || "null")
      return u?.name || u?.email || ""
    } catch { return "" }
  }

  function loadStrategies() {
    setLoading(true)
    Promise.all([
      fetch("/ma/api/ops/team-strategies").then((r) => r.json()),
      fetch("/ma/api/tracking-funds/strategies?strategy_source=company&pool=all").then((r) => r.json()),
    ])
      .then(([customData, fundData]) => {
        const customTree = Array.isArray(customData?.tree) ? customData.tree as OpsStrategyL1[] : []
        const fundTree = Array.isArray(fundData) ? fundData as OpsStrategyL1[] : []
        setStrategies(customTree.length > 0 ? customTree : fundTree)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  async function persistStrategies(next: OpsStrategyL1[]) {
    setStrategies(next)
    setStrategySaving(true)
    try {
      const res = await fetch("/ma/api/ops/team-strategies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tree: next, user_name: currentUserName() }),
      })
      if (!res.ok) loadStrategies()
    } catch {
      loadStrategies()
    } finally {
      setStrategySaving(false)
    }
  }

  function openEditL3Modal(l1: string, l2: string) {
    const l2Node = strategies.find((s) => s.l1 === l1)?.l2s.find((n) => n.l2 === l2)
    setEditL3Modal({ l1, l2 })
    setEditL3Names(l2Node?.l3s.length ? [...l2Node.l3s] : [""])
  }

  function confirmEditL3() {
    if (!editL3Modal) return
    const seen = new Set<string>()
    const names: string[] = []
    for (const raw of editL3Names) {
      const name = raw.trim()
      if (!name || seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
    const next = strategies.map((s) => {
      if (s.l1 !== editL3Modal.l1) return s
      return {
        ...s,
        l2s: s.l2s.map((n) => n.l2 !== editL3Modal.l2 ? n : { ...n, l3s: names }),
      }
    })
    void persistStrategies(next)
    if (names.length > 0) {
      setExpandedL1((prev) => new Set(prev).add(editL3Modal.l1))
      setExpandedL2((prev) => new Set(prev).add(opsL2Key(editL3Modal.l1, editL3Modal.l2)))
    }
    setEditL3Modal(null)
    setEditL3Names([])
  }

  function TrashIcon() {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    )
  }

  function openAddChildModal(level: 2 | 3, l1: string, l2?: string) {
    setAddChildModal({ level, l1, l2 })
    setAddChildNames([""])
  }

  function confirmAddChild() {
    if (!addChildModal) return
    const names = addChildNames.map((n) => n.trim()).filter(Boolean)
    if (names.length === 0) return

    if (addChildModal.level === 2) {
      const next = strategies.map((s) => {
        if (s.l1 !== addChildModal.l1) return s
        const existing = new Set(s.l2s.map((n) => n.l2))
        const newL2s = names.filter((n) => !existing.has(n)).map((n) => ({ l2: n, l3s: [] }))
        return { ...s, l2s: [...s.l2s, ...newL2s] }
      })
      void persistStrategies(next)
      setExpandedL1((prev) => new Set(prev).add(addChildModal.l1))
    } else if (addChildModal.l2) {
      const { l1, l2 } = addChildModal
      const next = strategies.map((s) => {
        if (s.l1 !== l1) return s
        return {
          ...s,
          l2s: s.l2s.map((n) => {
            if (n.l2 !== l2) return n
            const existing = new Set(n.l3s)
            const newL3s = names.filter((name) => !existing.has(name))
            return { ...n, l3s: [...n.l3s, ...newL3s] }
          }),
        }
      })
      void persistStrategies(next)
      setExpandedL1((prev) => new Set(prev).add(l1))
      setExpandedL2((prev) => new Set(prev).add(opsL2Key(l1, l2)))
    }
    setAddChildModal(null)
    setAddChildNames([""])
  }

  function AddChildIcon() {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="2" />
        <circle cx="5" cy="19" r="2" />
        <circle cx="19" cy="19" r="2" />
        <path d="M12 7v5" />
        <path d="M8 14h8" />
        <path d="M5 17v-2" />
        <path d="M19 17v-2" />
      </svg>
    )
  }

  useEffect(() => { loadStrategies() }, [])

  function toggleExpandL1(l1: string) {
    setExpandedL1((prev) => {
      const next = new Set(prev)
      next.has(l1) ? next.delete(l1) : next.add(l1)
      return next
    })
  }

  function toggleExpandL2(l1: string, l2: string) {
    const key = opsL2Key(l1, l2)
    setExpandedL2((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  type FlatRow =
    | { type: "l1"; l1: string; index: number; hasChildren: boolean }
    | { type: "l2"; l1: string; l2: string; hasChildren: boolean }
    | { type: "l3"; l1: string; l2: string; l3: string }

  const rows: FlatRow[] = []
  let idx = 1
  for (const s of strategies) {
    const hasL2 = s.l2s.length > 0
    rows.push({ type: "l1", l1: s.l1, index: idx++, hasChildren: hasL2 })
    if (expandedL1.has(s.l1)) {
      for (const l2Node of s.l2s) {
        const hasL3 = l2Node.l3s.length > 0
        rows.push({ type: "l2", l1: s.l1, l2: l2Node.l2, hasChildren: hasL3 })
        if (expandedL2.has(opsL2Key(s.l1, l2Node.l2))) {
          for (const l3 of l2Node.l3s) {
            rows.push({ type: "l3", l1: s.l1, l2: l2Node.l2, l3 })
          }
        }
      }
    }
  }

  const opsTabs = [
    { key: "strategies" as const, label: "团队策略" },
    { key: "tags" as const, label: "团队标签" },
    { key: "fields" as const, label: "团队字段" },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Tabs + action button */}
      <div className="flex items-center justify-between border-b">
        <div className="flex items-center">
          {opsTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setOpsTab(t.key)}
              className={[
                "px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                opsTab === t.key
                  ? "border-red-500 text-red-600 dark:text-red-400"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>
        {opsTab === "strategies" && (
          <button
            onClick={() => { setNewL1Name(""); setShowNewL1Modal(true) }}
            className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded transition-colors"
          >
            新建一级
          </button>
        )}
        {opsTab === "fields" && (
          <button
            onClick={() => setOpenNewFieldModal(true)}
            className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded transition-colors"
          >
            新建字段
          </button>
        )}
      </div>

      {/* Strategies table */}
      {opsTab === "strategies" && (
        <>
          <div className="overflow-auto rounded border mt-4">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-16">序号</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">一级策略</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">二级策略</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">三级策略</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 w-28">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="py-20 text-center text-muted-foreground">暂无策略</td></tr>
                ) : rows.map((row, i) => (
                  <tr key={`${row.type}_${row.type === "l3" ? row.l3 : row.type === "l2" ? row.l2 : row.l1}_${i}`} className="border-b hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {row.type === "l1" ? row.index : ""}
                    </td>
                    <td className="px-4 py-3">
                      {row.type === "l1" ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                          {row.hasChildren ? (
                            <button
                              onClick={() => toggleExpandL1(row.l1)}
                              className="text-red-500 font-bold text-base leading-none select-none w-4 hover:opacity-70 transition-opacity"
                              title={expandedL1.has(row.l1) ? "收起" : "展开"}
                            >
                              {expandedL1.has(row.l1) ? "−" : "+"}
                            </button>
                          ) : (
                            <span className="w-4 inline-block text-muted-foreground text-center">−</span>
                          )}
                          {row.l1}
                        </span>
                      ) : (
                        <span className="text-muted-foreground pl-5">−</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.type === "l2" ? (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          {row.hasChildren ? (
                            <button
                              onClick={() => toggleExpandL2(row.l1, row.l2)}
                              className="text-red-500 font-bold text-base leading-none select-none w-4 hover:opacity-70 transition-opacity"
                              title={expandedL2.has(opsL2Key(row.l1, row.l2)) ? "收起" : "展开"}
                            >
                              {expandedL2.has(opsL2Key(row.l1, row.l2)) ? "−" : "+"}
                            </button>
                          ) : (
                            <span className="w-4 inline-block text-muted-foreground text-center">−</span>
                          )}
                          {row.l2}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{row.type === "l3" ? "−" : "−"}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.type === "l3" ? (
                        <span className="text-sm">{row.l3}</span>
                      ) : (
                        <span className="text-muted-foreground">−</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {row.type === "l1" && (
                          <button
                            title="编辑"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => {
                              setEditingKey({ l1: row.l1 })
                              setEditName(row.l1)
                            }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M11 9H8a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"/><path d="M15.5 5.5a2 2 0 0 1 3 3L12 15l-4 1 1-4 6.5-6.5z"/></svg>
                          </button>
                        )}
                        {row.type === "l2" && (
                          <button
                            title="编辑三级"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => openEditL3Modal(row.l1, row.l2)}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M11 9H8a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"/><path d="M15.5 5.5a2 2 0 0 1 3 3L12 15l-4 1 1-4 6.5-6.5z"/></svg>
                          </button>
                        )}
                        {row.type === "l1" && (
                          <button
                            title="新增二级"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => openAddChildModal(2, row.l1)}
                          >
                            <AddChildIcon />
                          </button>
                        )}
                        {row.type === "l2" && (
                          <button
                            title="新增三级"
                            className="text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => openAddChildModal(3, row.l1, row.l2)}
                          >
                            <AddChildIcon />
                          </button>
                        )}
                        <button
                          title="删除"
                          className="text-muted-foreground hover:text-red-500 transition-colors"
                          onClick={() => {
                            if (row.type === "l1") {
                              void persistStrategies(strategies.filter((s) => s.l1 !== row.l1))
                              setExpandedL1((prev) => { const next = new Set(prev); next.delete(row.l1); return next })
                            } else if (row.type === "l2") {
                              void persistStrategies(strategies.map((s) =>
                                s.l1 !== row.l1 ? s : { ...s, l2s: s.l2s.filter((x) => x.l2 !== row.l2) }
                              ))
                              setExpandedL2((prev) => { const next = new Set(prev); next.delete(opsL2Key(row.l1, row.l2)); return next })
                            } else {
                              void persistStrategies(strategies.map((s) =>
                                s.l1 !== row.l1 ? s : {
                                  ...s,
                                  l2s: s.l2s.map((n) =>
                                    n.l2 !== row.l2 ? n : { ...n, l3s: n.l3s.filter((x) => x !== row.l3) }
                                  ),
                                }
                              ))
                            }
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 pt-3 border-t">
            <p className="text-xs text-muted-foreground">
              说明：机构用户可根据需求个性化设置团队策略，并在运维模块各产品列表操作区域的要素管理对私募、公募基金进行团队策略设置。团队策略仅内部可见。
            </p>
          </div>
        </>
      )}

      {opsTab === "tags" && <OperationsTeamTagsTab />}

      {opsTab === "fields" && (
        <OperationsTeamFieldsTab
          externalNewOpen={openNewFieldModal}
          onExternalNewClose={() => setOpenNewFieldModal(false)}
        />
      )}

      {/* New L1 modal */}
      {showNewL1Modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewL1Modal(false)}>
          <div className="bg-background border rounded-lg shadow-xl w-[400px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="font-semibold text-base">新建一级策略</span>
              <button onClick={() => setShowNewL1Modal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="flex items-center gap-3 mb-6">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 shrink-0">策略名称：</label>
              <input
                autoFocus
                className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                placeholder="请输入策略名称"
                value={newL1Name}
                onChange={(e) => setNewL1Name(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newL1Name.trim() && !strategySaving) {
                    void persistStrategies([...strategies, { l1: newL1Name.trim(), l2s: [] }])
                    setShowNewL1Modal(false)
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewL1Modal(false)}
                className="px-4 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                onClick={() => {
                  if (newL1Name.trim()) {
                    void persistStrategies([...strategies, { l1: newL1Name.trim(), l2s: [] }])
                    setShowNewL1Modal(false)
                  }
                }}
                disabled={!newL1Name.trim() || strategySaving}
                className="px-4 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                {strategySaving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add L2 / L3 modal */}
      {addChildModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setAddChildModal(null)}>
          <div className="bg-background border rounded-lg shadow-xl w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <span className="font-semibold text-base">
                {addChildModal.level === 2 ? "新增二级" : "新增三级"}
              </span>
              <button onClick={() => setAddChildModal(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="space-y-3 mb-8">
              {addChildNames.map((name, i) => (
                <div key={i} className="flex items-center gap-3">
                  <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-20 text-right">
                    {addChildModal.level === 2 ? "二级策略：" : "三级策略："}
                  </label>
                  <input
                    autoFocus={i === 0}
                    className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                    placeholder="请输入策略名称"
                    value={name}
                    onChange={(e) => setAddChildNames((prev) => prev.map((v, j) => j === i ? e.target.value : v))}
                    onKeyDown={(e) => e.key === "Enter" && confirmAddChild()}
                  />
                  {i === addChildNames.length - 1 && (
                    <button
                      type="button"
                      onClick={() => setAddChildNames((prev) => [...prev, ""])}
                      className="h-7 w-7 flex items-center justify-center rounded-full border border-zinc-300 text-zinc-500 hover:border-red-400 hover:text-red-500 transition-colors shrink-0"
                      title="添加一行"
                    >
                      <PlusCircle className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setAddChildModal(null)}
                className="px-5 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                onClick={confirmAddChild}
                disabled={!addChildNames.some((n) => n.trim())}
                className="px-5 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                确 定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit L3 modal */}
      {editL3Modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditL3Modal(null)}>
          <div className="bg-background border rounded-lg shadow-xl w-[520px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <span className="font-semibold text-base">编辑三级</span>
              <button onClick={() => setEditL3Modal(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="space-y-3 mb-8 max-h-[360px] overflow-y-auto">
              {editL3Names.map((name, i) => (
                <div key={i} className="flex items-center gap-2">
                  <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-20 text-right">三级策略：</label>
                  <input
                    autoFocus={i === 0}
                    className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                    value={name}
                    onChange={(e) => setEditL3Names((prev) => prev.map((v, j) => j === i ? e.target.value : v))}
                  />
                  <div className="flex items-center gap-1.5 shrink-0 w-14 justify-end">
                    {i === 0 && (
                      <button
                        type="button"
                        onClick={() => setEditL3Names((prev) => [...prev, ""])}
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                        title="添加一行"
                      >
                        <PlusCircle className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditL3Names((prev) => prev.length <= 1 ? [""] : prev.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-red-500 transition-colors"
                      title="删除"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditL3Modal(null)}
                className="px-5 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                onClick={confirmEditL3}
                className="px-5 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors">
                确 定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit L1 modal */}
      {editingKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditingKey(null)}>
          <div className="bg-background border rounded-lg shadow-xl w-[400px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="font-semibold text-base">编辑一级策略</span>
              <button onClick={() => setEditingKey(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="flex items-center gap-3 mb-6">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 shrink-0">策略名称：</label>
              <input
                autoFocus
                className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                placeholder="请输入策略名称"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && editName.trim() && !strategySaving) {
                    void persistStrategies(strategies.map((s) => s.l1 === editingKey.l1 ? { ...s, l1: editName.trim() } : s))
                    setEditingKey(null)
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingKey(null)}
                className="px-4 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                onClick={() => {
                  if (editName.trim()) {
                    void persistStrategies(strategies.map((s) => s.l1 === editingKey.l1 ? { ...s, l1: editName.trim() } : s))
                    setEditingKey(null)
                  }
                }}
                disabled={!editName.trim() || strategySaving}
                className="px-4 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                {strategySaving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── OperationsDirectView ──────────────────────────────────────────────────

type DirectFundClass = "private" | "public" | "team"
type DirectHoldingStatus = "holding" | "cleared"
type DirectSortKey =
  | "product_name" | "latest_nav" | "latest_nav_date" | "latest_price_change"
  | "holding_mv" | "holding_shares"

interface DirectFundRow {
  beian_hao: string
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  holding_mv: string | null
  holding_shares: string | null
  valuation_date: string | null
}

function DirectFormLabel({ children, required = true }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-[7.5rem] text-right pt-2 leading-snug">
      {required && <span className="text-red-500 mr-0.5">*</span>}
      {children}
    </label>
  )
}

function DirectFormHint() {
  return (
    <span
      title="说明"
      className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-zinc-300 text-[9px] leading-none text-zinc-400 ml-0.5 align-middle cursor-help"
    >
      ?
    </span>
  )
}

const DIRECT_FIELD_CONFIG_TABS = ["基本信息", "申赎信息", "团队策略/标签", "净值信息", "团队字段"] as const
const DIRECT_FIELD_CONFIG_LOCKED = "备案编码"
const DIRECT_FIELD_CONFIG_DEFAULT = ["备案编码", "单位净值", "净值日期", "涨跌幅"]
const DIRECT_FIELD_CONFIG_OPTIONS: Record<string, string[]> = {
  "基本信息": ["备案编码", "备案日期", "成立日期", "基金全称", "管理人规模", "基准指数", "基金管理人", "投资顾问", "托管券商", "平台一级策略", "平台二级策略", "平台三级策略"],
  "申赎信息": ["申购状态", "赎回状态", "申购费率", "赎回费率", "最低申购金额", "封闭期", "开放日"],
  "团队策略/标签": ["团队一级策略", "团队二级策略", "团队三级策略", "团队标签", "所在跟踪池"],
  "净值信息": ["单位净值", "净值日期", "涨跌幅", "成立以来收益", "近一年收益", "最大回撤", "年化收益", "年化波动率", "夏普比率", "卡玛比率"],
  "团队字段": ["团队评级", "团队备注", "关注度"],
}

const OPS_AUDIT_LOG_TYPES = ["不限", "跟踪产品", "跟踪管理人", "要素", "在管产品", "团队数据"] as const

function OpsAuditLogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logType, setLogType] = useState<string>("不限")
  const [page, setPage] = useState(1)
  const [logs, setLogs] = useState<{ operator: string; operated_at: string; action: string }[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    if (!open) return
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (logType !== "不限") params.set("type", logType)
    fetch(`/ma/api/ops/audit-logs?${params}`)
      .then((r) => r.json())
      .then((json) => {
        setLogs(json.data ?? [])
        setTotal(json.total ?? 0)
      })
      .catch(() => {
        setLogs([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }, [open, logType, page])

  useEffect(() => {
    if (open) {
      setPage(1)
      setLogType("不限")
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-full max-w-[760px] flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">操作日志</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="px-6 pt-4 pb-3 border-b flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-zinc-400 shrink-0">类型：</span>
            {OPS_AUDIT_LOG_TYPES.map((t) => (
              <span
                key={t}
                onClick={() => { setLogType(t); setPage(1) }}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border cursor-pointer transition-colors",
                  logType === t
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                    : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                ].join(" ")}
              >
                {t}
              </span>
            ))}
          </div>
          <p className="text-xs text-zinc-400 mt-2">* 仅展示近6月操作日志。</p>
        </div>

        <div className="flex-1 overflow-auto min-h-[280px]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/40 border-b">
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-16">序号</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-28">操作人</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-44">操作时间</th>
                <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">操作事项</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="py-16 text-center text-muted-foreground">加载中…</td></tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-16 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                      <span>暂无数据</span>
                    </div>
                  </td>
                </tr>
              ) : logs.map((row, i) => (
                <tr key={`${row.operated_at}-${i}`} className="border-b hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{(page - 1) * pageSize + i + 1}</td>
                  <td className="px-4 py-2.5">{row.operator}</td>
                  <td className="px-4 py-2.5 tabular-nums whitespace-nowrap text-muted-foreground">{row.operated_at}</td>
                  <td className="px-4 py-2.5">{row.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-6 py-3 border-t flex-shrink-0 text-sm text-zinc-500">
          <span>共{total}条</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed">‹</button>
            <span className="w-7 h-7 flex items-center justify-center rounded border bg-red-500 text-white text-xs font-medium">{page}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || total === 0}
              className="w-7 h-7 flex items-center justify-center rounded border hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed">›</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DirectFieldConfigDialog({
  open,
  selected,
  onClose,
  onConfirm,
}: {
  open: boolean
  selected: string[]
  onClose: () => void
  onConfirm: (fields: string[]) => void
}) {
  const [tab, setTab] = useState<string>("基本信息")
  const [draft, setDraft] = useState<string[]>(selected)

  useEffect(() => {
    if (open) setDraft(selected.includes(DIRECT_FIELD_CONFIG_LOCKED) ? selected : [DIRECT_FIELD_CONFIG_LOCKED, ...selected])
  }, [open, selected])

  if (!open) return null

  const opts = DIRECT_FIELD_CONFIG_OPTIONS[tab] ?? []

  function ensureLocked(fields: string[]) {
    return fields.includes(DIRECT_FIELD_CONFIG_LOCKED)
      ? fields
      : [DIRECT_FIELD_CONFIG_LOCKED, ...fields]
  }

  function toggleDraft(field: string) {
    if (field === DIRECT_FIELD_CONFIG_LOCKED) return
    setDraft((prev) => {
      const next = prev.includes(field) ? prev.filter((x) => x !== field) : [...prev, field]
      return ensureLocked(next)
    })
  }

  function clearDraft() {
    setDraft([DIRECT_FIELD_CONFIG_LOCKED])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-full max-w-[760px] flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">字段配置</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>
        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="flex-1 flex flex-col min-w-0 px-6 py-4 overflow-y-auto">
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              {DIRECT_FIELD_CONFIG_TABS.map((t) => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer text-sm whitespace-nowrap">
                  <input
                    type="radio"
                    name="directFieldConfigTab"
                    checked={tab === t}
                    onChange={() => setTab(t)}
                    className="accent-red-500 h-3.5 w-3.5"
                  />
                  {t}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-x-6 gap-y-3">
              {opts.map((f) => {
                const locked = f === DIRECT_FIELD_CONFIG_LOCKED
                return (
                  <label
                    key={f}
                    className={["flex items-center gap-2 text-sm", locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={draft.includes(f)}
                      disabled={locked}
                      onChange={() => toggleDraft(f)}
                      className="rounded h-3.5 w-3.5 accent-red-500 disabled:opacity-70"
                    />
                    {f}
                  </label>
                )
              })}
            </div>
          </div>
          <div className="w-48 border-l flex flex-col px-4 py-4 flex-shrink-0 min-h-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-zinc-600">已选({draft.length})</span>
              <button onClick={clearDraft} className="text-xs text-blue-500 hover:text-blue-600 transition-colors">清空</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {draft.map((f) => {
                const locked = f === DIRECT_FIELD_CONFIG_LOCKED
                return (
                  <div key={f} className="flex items-center justify-between text-sm py-0.5">
                    <span className="text-zinc-700 dark:text-zinc-300 truncate">{f}</span>
                    {locked ? (
                      <span className="text-zinc-300 ml-1 flex-shrink-0 cursor-not-allowed">×</span>
                    ) : (
                      <button onClick={() => toggleDraft(f)} className="text-zinc-400 hover:text-zinc-600 transition-colors ml-1 flex-shrink-0">×</button>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-zinc-400 mt-3 leading-snug">已选列表可拖拉上下排序</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取消</button>
          <button
            onClick={() => onConfirm(ensureLocked(draft))}
            className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

type OpsElementsTab = "platform" | "subscription" | "attachment" | "team"

interface OpsFundElementsData {
  platform_l1: string | null
  platform_l2: string | null
  platform_l3: string | null
  company_l1: string | null
  company_l2: string | null
  company_l3: string | null
  benchmark: string | null
  open_day: string | null
  is_temporary_open: string | null
  fee_purchase: string | null
  add_amount: string | null
  fee_redeem: string | null
  precautious_line: string | null
  closed_period: string | null
  stop_line: string | null
  fee_manage_rate: string | null
  fee_trust: string | null
  fee_manage: string | null
  fee_admin_service: string | null
  fee_pay: string | null
}

const OPS_ELEMENTS_TABS: { key: OpsElementsTab; label: string }[] = [
  { key: "platform", label: "平台策略" },
  { key: "subscription", label: "申赎信息" },
  { key: "attachment", label: "要素附件" },
  { key: "team", label: "团队策略" },
]

const OPS_BENCHMARK_OPTIONS = ["沪深300", "中证500", "上证指数", "创业板指", "中证1000", "南华商品指数"]

type PerfFeeMode = "none" | "fixed" | "annual_gradient" | "excess_gradient" | "benchmark"

interface PerfFeeGradient {
  fromPct: string
  toPct: string
  ratePct: string
}

function OpsElementsFieldLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <label className={["text-sm text-zinc-600 dark:text-zinc-400 shrink-0 w-[5.5rem] text-right leading-snug", className].join(" ")}>
      {children}
    </label>
  )
}

function OpsElementsNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded px-3 py-2.5 text-xs leading-relaxed bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800/50">
      {children}
    </div>
  )
}

function OpsEditElementsDialog({
  open,
  beian_hao,
  product_name,
  onClose,
}: {
  open: boolean
  beian_hao: string | null
  product_name: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<OpsElementsTab>("platform")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [platformTree, setPlatformTree] = useState<TrackStrategyNode[]>([])
  const [teamTree, setTeamTree] = useState<TrackStrategyNode[]>([])

  const [platformL1, setPlatformL1] = useState("")
  const [platformL2, setPlatformL2] = useState("")
  const [platformL3s, setPlatformL3s] = useState<string[]>([])
  const [benchmark, setBenchmark] = useState("")

  const [teamL1, setTeamL1] = useState("")
  const [teamL2, setTeamL2] = useState("")
  const [teamL3s, setTeamL3s] = useState<string[]>([])

  const [openDay, setOpenDay] = useState("")
  const [feePurchase, setFeePurchase] = useState("")
  const [feeRedeem, setFeeRedeem] = useState("")
  const [closedPeriod, setClosedPeriod] = useState("")
  const [lockPeriodDesc, setLockPeriodDesc] = useState("")
  const [feeManageRate, setFeeManageRate] = useState("")
  const [feeManageDesc, setFeeManageDesc] = useState("")
  const [feePayDesc, setFeePayDesc] = useState("")
  const [tempOpenMode, setTempOpenMode] = useState<"yes" | "no">("no")
  const [tempOpenPurchase, setTempOpenPurchase] = useState(false)
  const [tempOpenRedeem, setTempOpenRedeem] = useState(false)
  const [addAmount, setAddAmount] = useState("")
  const [riskLevel, setRiskLevel] = useState("")
  const [warningLineMode, setWarningLineMode] = useState<"none" | "set">("none")
  const [warningLine, setWarningLine] = useState("")
  const [stopLineMode, setStopLineMode] = useState<"none" | "set">("none")
  const [stopLine, setStopLine] = useState("")
  const [feeAdminService, setFeeAdminService] = useState("")
  const [feeTrust, setFeeTrust] = useState("")
  const [perfFeeMode, setPerfFeeMode] = useState<PerfFeeMode>("annual_gradient")
  const [perfGradients, setPerfGradients] = useState<PerfFeeGradient[]>([
    { fromPct: "0", toPct: "6", ratePct: "0" },
    { fromPct: "6", toPct: "", ratePct: "40" },
  ])

  useEffect(() => {
    if (!open || !beian_hao) return
    setTab("platform")
    setLoading(true)
    Promise.all([
      fetch(`/ma/api/ops/fund-elements?beian_hao=${encodeURIComponent(beian_hao)}`).then((r) => r.json()),
      fetch("/ma/api/tracking-funds/strategies?strategy_source=platform&pool=all").then((r) => r.json()),
      fetch("/ma/api/tracking-funds/strategies?strategy_source=company&pool=all").then((r) => r.json()),
    ])
      .then(([data, pTree, tTree]) => {
        if (Array.isArray(pTree)) setPlatformTree(pTree)
        if (Array.isArray(tTree)) setTeamTree(tTree)
        if (data?.error) return
        const d = data as OpsFundElementsData
        setPlatformL1(d.platform_l1 ?? "")
        setPlatformL2(d.platform_l2 ?? "")
        setPlatformL3s(d.platform_l3 ? d.platform_l3.split(/[，,]/).map((s) => s.trim()).filter(Boolean) : [])
        setBenchmark(d.benchmark ?? "")
        setTeamL1(d.company_l1 ?? "")
        setTeamL2(d.company_l2 ?? "")
        setTeamL3s(d.company_l3 ? d.company_l3.split(/[，,]/).map((s) => s.trim()).filter(Boolean) : [])
        setOpenDay(d.open_day ?? "")
        setFeePurchase(d.fee_purchase ?? "")
        setFeeRedeem(d.fee_redeem ?? "")
        setClosedPeriod(d.closed_period ?? "")
        setLockPeriodDesc("")
        setFeeManageRate(d.fee_manage_rate ?? "")
        setFeeManageDesc(d.fee_manage ?? "")
        setFeePayDesc(d.fee_pay ?? "")
        setAddAmount(d.add_amount ?? "")
        setFeeAdminService(d.fee_admin_service ?? "")
        setFeeTrust(d.fee_trust ?? "")
        const tempText = d.is_temporary_open ?? ""
        if (tempText.includes("不可")) {
          setTempOpenMode("no")
          setTempOpenPurchase(false)
          setTempOpenRedeem(false)
        } else if (tempText.includes("可")) {
          setTempOpenMode("yes")
          setTempOpenPurchase(!tempText.includes("回"))
          setTempOpenRedeem(tempText.includes("回") || tempText === "可")
        } else {
          setTempOpenMode("no")
          setTempOpenPurchase(false)
          setTempOpenRedeem(false)
        }
        const prec = d.precautious_line ?? ""
        if (prec && !prec.includes("不设置")) {
          setWarningLineMode("set")
          setWarningLine(prec)
        } else {
          setWarningLineMode("none")
          setWarningLine("")
        }
        const stop = d.stop_line ?? ""
        if (stop && !stop.includes("不设置")) {
          setStopLineMode("set")
          setStopLine(stop)
        } else {
          setStopLineMode("none")
          setStopLine("")
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, beian_hao])

  async function handleConfirm() {
    if (!beian_hao) return
    setSaving(true)
    try {
      await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/strategy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_l1: teamL1 || null,
          strategy_l2: teamL2 || null,
          strategy_l3: teamL3s.length ? teamL3s.join(",") : null,
        }),
      })
      onClose()
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  function renderStrategySelectors(
    tree: TrackStrategyNode[],
    l1: string, setL1: (v: string) => void,
    l2: string, setL2: (v: string) => void,
    l3s: string[], setL3s: (v: string[]) => void,
    disabled = false,
  ) {
    const disabledSelectClass = "flex-1 border rounded px-3 py-1.5 text-sm bg-muted/40 text-muted-foreground cursor-not-allowed"
    const selectClass = disabled
      ? disabledSelectClass
      : "flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <OpsElementsFieldLabel>一级策略：</OpsElementsFieldLabel>
          <select
            value={l1}
            onChange={(e) => { setL1(e.target.value); setL2(""); setL3s([]) }}
            disabled={disabled}
            className={selectClass}
          >
            <option value="">— 请选择 —</option>
            {tree.map((n) => <option key={n.l1} value={n.l1}>{n.l1}</option>)}
            {l1 && !tree.some((n) => n.l1 === l1) && <option value={l1}>{l1}</option>}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <OpsElementsFieldLabel>二级策略：</OpsElementsFieldLabel>
          <select
            value={l2}
            onChange={(e) => { setL2(e.target.value); setL3s([]) }}
            disabled={disabled || !l1}
            className={selectClass}
          >
            <option value="">— 请选择 —</option>
            {(tree.find((n) => n.l1 === l1)?.l2s ?? []).map((n) => <option key={n.l2} value={n.l2}>{n.l2}</option>)}
            {l2 && !(tree.find((n) => n.l1 === l1)?.l2s ?? []).some((n) => n.l2 === l2) && <option value={l2}>{l2}</option>}
          </select>
        </div>
        <div className="flex items-start gap-3">
          <OpsElementsFieldLabel className={disabled ? "" : "pt-1.5"}>三级策略：</OpsElementsFieldLabel>
          <div className="flex-1 min-w-0">
            {disabled ? (
              <select value={l3s[0] ?? ""} disabled className={disabledSelectClass}>
                <option value="">—</option>
                {l3s.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <>
                {l3s.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {l3s.map((v) => (
                      <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
                        {v}
                        <button type="button" onClick={() => setL3s(l3s.filter((x) => x !== v))} className="text-blue-400 hover:text-blue-700">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <select
                  value=""
                  onChange={(e) => { const v = e.target.value; if (v && !l3s.includes(v)) setL3s([...l3s, v]) }}
                  disabled={!l2}
                  className="w-full border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                >
                  <option value="">— 添加三级策略 —</option>
                  {(tree.find((n) => n.l1 === l1)?.l2s.find((n) => n.l2 === l2)?.l3s ?? [])
                    .filter((v) => !l3s.includes(v))
                    .map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[920px] flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">编辑要素</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="px-6 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
          <div className="w-1 self-stretch rounded-full bg-red-500 shrink-0" />
          <span className="font-semibold text-base">{product_name}</span>
        </div>

        <div className="px-6 pb-3 flex items-center gap-2 flex-wrap flex-shrink-0">
          {OPS_ELEMENTS_TABS.map((t) => (
            <span
              key={t.key}
              onClick={() => setTab(t.key)}
              className={[
                "inline-flex items-center px-3 py-1 rounded-full border text-sm cursor-pointer transition-colors",
                tab === t.key
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              {t.label}
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4 min-h-[320px]">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">加载中…</div>
          ) : tab === "platform" ? (
            <div className="space-y-4">
              <OpsElementsNotice>
                当前策略已确认，无法修改。如有疑问，请联系客服。
              </OpsElementsNotice>
              {renderStrategySelectors(platformTree, platformL1, setPlatformL1, platformL2, setPlatformL2, platformL3s, setPlatformL3s, true)}
              <div className="flex items-center gap-3">
                <OpsElementsFieldLabel>基准指数：</OpsElementsFieldLabel>
                <select
                  value={benchmark}
                  disabled
                  className="flex-1 border rounded px-3 py-1.5 text-sm bg-muted/40 text-muted-foreground cursor-not-allowed"
                >
                  <option value="">— 请选择 —</option>
                  {OPS_BENCHMARK_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
                  {benchmark && !OPS_BENCHMARK_OPTIONS.includes(benchmark) && <option value={benchmark}>{benchmark}</option>}
                </select>
              </div>
            </div>
          ) : tab === "subscription" ? (
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <OpsElementsFieldLabel>开放日：</OpsElementsFieldLabel>
                  <input value={openDay} onChange={(e) => setOpenDay(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="flex items-center gap-3">
                  <OpsElementsFieldLabel>申购费：</OpsElementsFieldLabel>
                  <input value={feePurchase} onChange={(e) => setFeePurchase(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="flex items-center gap-3">
                  <OpsElementsFieldLabel>赎回费：</OpsElementsFieldLabel>
                  <input value={feeRedeem} onChange={(e) => setFeeRedeem(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="flex items-center gap-3">
                  <OpsElementsFieldLabel>封闭期：</OpsElementsFieldLabel>
                  <input value={closedPeriod} onChange={(e) => setClosedPeriod(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="flex items-center gap-3">
                  <OpsElementsFieldLabel>锁定期说明：</OpsElementsFieldLabel>
                  <input value={lockPeriodDesc} onChange={(e) => setLockPeriodDesc(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="flex items-center gap-3">
                  <OpsElementsFieldLabel>管理费率：</OpsElementsFieldLabel>
                  <input value={feeManageRate} onChange={(e) => setFeeManageRate(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="flex items-center gap-3">
                  <OpsElementsFieldLabel>管理费说明：</OpsElementsFieldLabel>
                  <input value={feeManageDesc} onChange={(e) => setFeeManageDesc(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="flex items-start gap-3">
                  <OpsElementsFieldLabel className="pt-1.5">业绩报酬说明：</OpsElementsFieldLabel>
                  <textarea value={feePayDesc} onChange={(e) => setFeePayDesc(e.target.value)} rows={3} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none" />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <OpsElementsFieldLabel className="pt-0.5">临开信息：</OpsElementsFieldLabel>
                  <div className="flex-1 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="tempOpen" checked={tempOpenMode === "yes"} onChange={() => setTempOpenMode("yes")} className="accent-red-500" />
                      <span>可临开</span>
                      <label className="flex items-center gap-1 ml-2 cursor-pointer text-muted-foreground">
                        <input type="checkbox" checked={tempOpenPurchase} onChange={(e) => setTempOpenPurchase(e.target.checked)} disabled={tempOpenMode !== "yes"} className="accent-red-500" />
                        可临开申购
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer text-muted-foreground">
                        <input type="checkbox" checked={tempOpenRedeem} onChange={(e) => setTempOpenRedeem(e.target.checked)} disabled={tempOpenMode !== "yes"} className="accent-red-500" />
                        可临开赎回
                      </label>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="tempOpen" checked={tempOpenMode === "no"} onChange={() => { setTempOpenMode("no"); setTempOpenPurchase(false); setTempOpenRedeem(false) }} className="accent-red-500" />
                      <span>不可临开</span>
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <OpsElementsFieldLabel>追加限制：</OpsElementsFieldLabel>
                  <input value={addAmount} onChange={(e) => setAddAmount(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="flex items-center gap-3">
                  <OpsElementsFieldLabel>风险等级：</OpsElementsFieldLabel>
                  <input value={riskLevel} onChange={(e) => setRiskLevel(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="flex items-start gap-3">
                  <OpsElementsFieldLabel className="pt-0.5">预警线：</OpsElementsFieldLabel>
                  <div className="flex-1 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="warningLine" checked={warningLineMode === "none"} onChange={() => setWarningLineMode("none")} className="accent-red-500" />
                      <span>不设置预警线</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="warningLine" checked={warningLineMode === "set"} onChange={() => setWarningLineMode("set")} className="accent-red-500" />
                      <span>设置预警线</span>
                      {warningLineMode === "set" && (
                        <input value={warningLine} onChange={(e) => setWarningLine(e.target.value)} className="flex-1 border rounded px-2 py-1 text-sm bg-background ml-2" placeholder="预警线" />
                      )}
                    </label>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <OpsElementsFieldLabel className="pt-0.5">平仓线：</OpsElementsFieldLabel>
                  <div className="flex-1 space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="stopLine" checked={stopLineMode === "none"} onChange={() => setStopLineMode("none")} className="accent-red-500" />
                      <span>不设置平仓线</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="stopLine" checked={stopLineMode === "set"} onChange={() => setStopLineMode("set")} className="accent-red-500" />
                      <span>设置平仓线</span>
                      {stopLineMode === "set" && (
                        <input value={stopLine} onChange={(e) => setStopLine(e.target.value)} className="flex-1 border rounded px-2 py-1 text-sm bg-background ml-2" placeholder="平仓线" />
                      )}
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <OpsElementsFieldLabel>外包费：</OpsElementsFieldLabel>
                  <input value={feeAdminService} onChange={(e) => setFeeAdminService(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
                <div className="flex items-center gap-3">
                  <OpsElementsFieldLabel>托管费：</OpsElementsFieldLabel>
                  <input value={feeTrust} onChange={(e) => setFeeTrust(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
                </div>
              </div>
              <div className="col-span-2 pt-2 border-t mt-1">
                <p className="text-sm text-zinc-600 mb-3">业绩报酬公式</p>
                <div className="space-y-2 text-sm">
                  {([
                    ["none", "无"],
                    ["fixed", "按固定比例计提"],
                    ["annual_gradient", "按年化收益梯度计提"],
                    ["excess_gradient", "按超额年化收益梯度计提"],
                    ["benchmark", "按计提基准计提"],
                  ] as const).map(([mode, label]) => (
                    <label key={mode} className="flex items-start gap-2 cursor-pointer">
                      <input type="radio" name="perfFee" checked={perfFeeMode === mode} onChange={() => setPerfFeeMode(mode)} className="accent-red-500 mt-0.5" />
                      <div className="flex-1">
                        <span>{label}</span>
                        {mode === "annual_gradient" && perfFeeMode === "annual_gradient" && (
                          <div className="mt-2 space-y-2 pl-1">
                            {perfGradients.map((g, i) => (
                              <div key={i} className="flex items-center gap-2 flex-wrap text-xs text-zinc-600">
                                <input value={g.fromPct} onChange={(e) => setPerfGradients(perfGradients.map((row, j) => j === i ? { ...row, fromPct: e.target.value } : row))} className="w-10 border rounded px-1 py-0.5 text-center bg-background" />
                                <span>% ≤ 年化收益</span>
                                {g.toPct ? (
                                  <>
                                    <span>&lt;</span>
                                    <input value={g.toPct} onChange={(e) => setPerfGradients(perfGradients.map((row, j) => j === i ? { ...row, toPct: e.target.value } : row))} className="w-10 border rounded px-1 py-0.5 text-center bg-background" />
                                    <span>%</span>
                                  </>
                                ) : (
                                  <span className="mx-1" />
                                )}
                                <span className="text-red-500">*</span>
                                <span>计提比例:</span>
                                <input value={g.ratePct} onChange={(e) => setPerfGradients(perfGradients.map((row, j) => j === i ? { ...row, ratePct: e.target.value } : row))} className="w-10 border rounded px-1 py-0.5 text-center bg-background" />
                                <span>%</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : tab === "attachment" ? (
            <div className="space-y-4">
              <OpsElementsNotice>上传的要素附件仅限团队内部可见。</OpsElementsNotice>
              <div className="flex items-start gap-3">
                <label className="text-sm text-zinc-600 shrink-0 w-[5.5rem] text-right pt-8">
                  <span className="text-red-500 mr-0.5">*</span>上传要素：
                </label>
                <label className="flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-lg py-10 cursor-pointer hover:bg-muted/30 transition-colors">
                  <PlusCircle className="h-10 w-10 text-muted-foreground/40 mb-2" strokeWidth={1} />
                  <span className="text-xs text-muted-foreground">支持Word、PDF、Excel格式的文件，大小不超过5M。</span>
                  <input type="file" accept=".doc,.docx,.pdf,.xls,.xlsx" className="hidden" onChange={() => { /* stub */ }} />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <OpsElementsNotice>团队策略的新增、编辑在【运维-数据维护-团队策略】中。</OpsElementsNotice>
              {renderStrategySelectors(teamTree, teamL1, setTeamL1, teamL2, setTeamL2, teamL3s, setTeamL3s)}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取消</button>
          <button
            onClick={handleConfirm}
            disabled={saving || loading}
            className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
          >
            {saving ? "保存中…" : "确定"}
          </button>
        </div>
      </div>
    </div>
  )
}

interface OpsNavShareRow {
  id: number
  name: string
  share_frequency: string | null
  updated_at: string | null
}

function OpsPermissionDialog({
  open,
  beian_hao,
  product_name,
  onClose,
}: {
  open: boolean
  beian_hao: string | null
  product_name: string
  onClose: () => void
}) {
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [rows, setRows] = useState<OpsNavShareRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setKwInput("")
    setKeyword("")
  }, [open])

  useEffect(() => {
    if (!open || !beian_hao) return
    setLoading(true)
    const params = new URLSearchParams({ beian_hao })
    if (keyword) params.set("keyword", keyword)
    fetch(`/ma/api/ops/fund-permissions?${params}`)
      .then((r) => r.json())
      .then((json) => setRows(Array.isArray(json.data) ? json.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [open, beian_hao, keyword])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[760px] flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">权限管理</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="px-6 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-red-500 shrink-0" />
          <span className="font-semibold text-base">{product_name}</span>
        </div>

        <div className="px-6 pb-3 flex-shrink-0">
          <span className="inline-flex items-center px-3 py-1 rounded-full border border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 text-sm font-medium">
            净值分享
          </span>
        </div>

        <div className="px-6 pb-4 flex-shrink-0">
          <OpsElementsNotice>
            将本产品的团队净值同步给以下人员及机构。设置后，每天同步一次净值数据。
          </OpsElementsNotice>
        </div>

        <div className="px-6 pb-3 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center border rounded px-3 h-8 gap-2 bg-background flex-1 max-w-sm">
            <input
              className="flex-1 text-sm outline-none bg-transparent placeholder:text-muted-foreground/50"
              placeholder="请输入名称，回车搜索"
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput.trim())}
            />
          </div>
          <button type="button" className="text-sm text-blue-600 hover:text-blue-700 shrink-0 transition-colors">
            添加人员
          </button>
        </div>

        <div className="flex-1 overflow-auto min-h-[240px] px-6 pb-6">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted/40 border-b">
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-14">序号</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">人员/机构名称</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-28">
                  <span className="inline-flex items-center gap-1">
                    分享频率
                    <Filter className="h-3 w-3 text-muted-foreground/60" strokeWidth={1.5} />
                  </span>
                </th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-36">最后修改</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 w-16">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-16 text-center text-muted-foreground">加载中…</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                      <span>暂无数据</span>
                    </div>
                  </td>
                </tr>
              ) : rows.map((row, i) => (
                <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                  <td className="px-3 py-2.5">{row.name}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{row.share_frequency ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">
                    {row.updated_at ? row.updated_at.slice(0, 16).replace("T", " ") : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <button type="button" className="text-sm text-blue-600 hover:text-blue-700 transition-colors">编辑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

interface OpsNoteEntry {
  id: number
  note: string
  updated_by: string
  updated_at: string
}

function fmtNoteTime(iso: string | null | undefined) {
  if (!iso) return ""
  return iso.slice(0, 10)
}

function OpsTeamNoteDialog({
  open,
  beian_hao,
  product_name,
  onClose,
  onSaved,
}: {
  open: boolean
  beian_hao: string | null
  product_name: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [notes, setNotes] = useState<OpsNoteEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [noteText, setNoteText] = useState("")
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setNoteText("")
    setEditingId(null)
  }, [open, beian_hao])

  useEffect(() => {
    if (!open || !beian_hao) return
    setLoading(true)
    fetch(`/ma/api/ops/fund-notes?beian_hao=${encodeURIComponent(beian_hao)}`)
      .then((r) => r.json())
      .then((json) => setNotes(Array.isArray(json.data) ? json.data : []))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false))
  }, [open, beian_hao])

  async function handleSave() {
    if (!beian_hao || !noteText.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/ma/api/ops/fund-notes", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, note: noteText.trim() } : { beian_hao, note: noteText.trim() }),
      })
      const json = await res.json()
      if (json.record) {
        setNotes((prev) => {
          if (editingId) return prev.map((n) => (n.id === editingId ? json.record : n))
          return [json.record, ...prev]
        })
        setNoteText("")
        setEditingId(null)
        onSaved?.()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    await fetch(`/ma/api/ops/fund-notes?id=${id}`, { method: "DELETE" })
    setNotes((prev) => prev.filter((n) => n.id !== id))
    if (editingId === id) {
      setEditingId(null)
      setNoteText("")
    }
    onSaved?.()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-full max-w-[580px] flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">团队备注管理</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-red-500 shrink-0" />
            <span className="font-semibold text-sm">{product_name}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-foreground">
              <span className="text-red-500 mr-0.5">*</span>团队备注
            </label>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value.slice(0, 250))}
              placeholder="请输入不大于250字的备注"
              rows={5}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{noteText.length}/250</span>
              <button
                type="button"
                disabled={saving || !noteText.trim()}
                onClick={handleSave}
                className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-muted/40 border border-border/60 divide-y divide-border/60 min-h-[80px]">
            {loading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
            ) : notes.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无备注</div>
            ) : notes.map((entry) => (
              <div key={entry.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground break-words">{entry.note}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {fmtNoteTime(entry.updated_at)}{entry.updated_by ? ` ${entry.updated_by}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  <button
                    type="button"
                    onClick={() => { setEditingId(entry.id); setNoteText(entry.note) }}
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    title="编辑"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry.id)}
                    className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function OpsSyncNavDialog({
  open,
  beian_hao,
  product_name,
  onClose,
  onSynced,
}: {
  open: boolean
  beian_hao: string | null
  product_name: string
  onClose: () => void
  onSynced?: () => void
}) {
  const [mode, setMode] = useState<"all" | "from_date">("all")
  const [startDate, setStartDate] = useState("")
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    if (!open) return
    setMode("all")
    setStartDate("")
    setSyncing(false)
  }, [open, beian_hao])

  async function handleSync() {
    if (!beian_hao || syncing) return
    if (mode === "from_date" && !startDate) return
    setSyncing(true)
    try {
      onSynced?.()
      onClose()
    } finally {
      setSyncing(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[480px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">同步净值</span>
        </div>

        <div className="px-6 pt-4 pb-2 flex items-center gap-2 flex-shrink-0">
          <span className="w-1 h-4 bg-red-500 shrink-0" />
          <span className="font-semibold text-base">{product_name}</span>
        </div>

        <div className="px-6 pb-4 flex-shrink-0">
          <OpsElementsNotice>点击确定后，会将平台净值同步到团队净值。</OpsElementsNotice>
        </div>

        <div className="px-6 pb-5 flex flex-col gap-3 flex-shrink-0">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="syncNavMode"
              checked={mode === "all"}
              onChange={() => setMode("all")}
              className="accent-red-500"
            />
            全部
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="syncNavMode"
              checked={mode === "from_date"}
              onChange={() => setMode("from_date")}
              className="accent-red-500"
            />
            选定开始日期
          </label>
          {mode === "from_date" && (
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="ml-6 h-8 w-44 rounded border border-border bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors"
          >
            取消
          </button>
          <button
            disabled={syncing || (mode === "from_date" && !startDate)}
            onClick={() => void handleSync()}
            className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? "同步中…" : "同步"}
          </button>
        </div>
      </div>
    </div>
  )
}

interface OpsScaleRow {
  id: string
  date: string
  amount: string
  source: string
}

interface OpsScaleBatchPreviewRow {
  seq: number
  date: string
  amount: string
}

const SCALE_UPLOAD_MAX_BYTES = 3 * 1024 * 1024
const SCALE_UPLOAD_ACCEPT = ".xlsx,.xls,.csv"

function parseScaleCsvPreview(text: string): OpsScaleBatchPreviewRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const rows: OpsScaleBatchPreviewRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
    if (cols.length >= 2 && cols[0] && cols[1]) {
      rows.push({ seq: rows.length + 1, date: cols[0], amount: cols[1] })
    }
  }
  return rows
}

function downloadScaleUploadTemplate() {
  const csv = "\uFEFF日期,管理规模\n2024-01-01,1000000\n"
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = "规模批量上传模板.csv"
  a.click()
  URL.revokeObjectURL(a.href)
}

function OpsAddScaleDialog({
  open,
  onClose,
  onConfirmSingle,
  onConfirmBatch,
}: {
  open: boolean
  onClose: () => void
  onConfirmSingle: (date: string, amount: string) => void
  onConfirmBatch: (rows: OpsScaleBatchPreviewRow[]) => void
}) {
  const [tab, setTab] = useState<"single" | "batch">("single")
  const [date, setDate] = useState("")
  const [amount, setAmount] = useState("")
  const [saving, setSaving] = useState(false)
  const [batchFile, setBatchFile] = useState<File | null>(null)
  const [batchPreview, setBatchPreview] = useState<OpsScaleBatchPreviewRow[]>([])
  const [batchError, setBatchError] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTab("single")
    setDate("")
    setAmount("")
    setSaving(false)
    setBatchFile(null)
    setBatchPreview([])
    setBatchError("")
    setIsDragOver(false)
  }, [open])

  async function handleBatchFile(file: File) {
    setBatchError("")
    if (file.size > SCALE_UPLOAD_MAX_BYTES) {
      setBatchFile(null)
      setBatchPreview([])
      setBatchError("文件大小不能超过3M")
      return
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      setBatchFile(null)
      setBatchPreview([])
      setBatchError("只能上传 Excel 文件或 CSV 文件")
      return
    }
    setBatchFile(file)
    if (ext === "csv") {
      const text = await file.text()
      setBatchPreview(parseScaleCsvPreview(text))
    } else {
      setBatchPreview([])
    }
  }

  async function handleConfirm() {
    if (saving) return
    if (tab === "single") {
      if (!date || !amount.trim()) return
      setSaving(true)
      try {
        onConfirmSingle(date, amount.trim())
        onClose()
      } finally {
        setSaving(false)
      }
      return
    }
    if (!batchFile) return
    setSaving(true)
    try {
      onConfirmBatch(batchPreview)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[560px] flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">添加规模</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="px-6 pt-4 pb-3 flex items-center gap-2 flex-shrink-0">
          {([["single", "单条上传"], ["batch", "批量上传"]] as const).map(([key, label]) => (
            <span
              key={key}
              onClick={() => setTab(key)}
              className={[
                "inline-flex items-center px-3 py-1 rounded-full border text-sm cursor-pointer transition-colors",
                tab === key
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4 min-h-[240px]">
          {tab === "single" ? (
            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-4">
                <DirectFormLabel>日期：</DirectFormLabel>
                <div className="flex-1 relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full h-9 rounded border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="flex items-start gap-4">
                <DirectFormLabel>管理规模：</DirectFormLabel>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder=""
                    className="flex-1 h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-sm text-zinc-500 shrink-0">元</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className={[
                  "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
                  isDragOver ? "border-red-400 bg-red-50/50 dark:bg-red-950/20" : "border-border hover:border-red-300 hover:bg-muted/30",
                ].join(" ")}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragOver(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file) void handleBatchFile(file)
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={SCALE_UPLOAD_ACCEPT}
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleBatchFile(file)
                    e.target.value = ""
                  }}
                />
                <Inbox className="h-10 w-10 text-red-500" strokeWidth={1.25} />
                <p className="text-sm">
                  将文件拖到此处，或
                  <span className="text-blue-600 dark:text-blue-400">点击上传</span>
                </p>
                {batchFile && <p className="text-xs text-muted-foreground">{batchFile.name}</p>}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                只能上传 Excel 文件或 CSV 文件，且大小不超过 3M。
                <button type="button" onClick={downloadScaleUploadTemplate} className="text-blue-600 dark:text-blue-400 hover:underline ml-1">
                  点击下载批量上传模板
                </button>
              </p>
              {batchError && <p className="text-xs text-red-500">{batchError}</p>}
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/40 border-b">
                      <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-16">序号</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">日期</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">管理规模</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchPreview.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-12 text-center text-muted-foreground">
                          <div className="flex flex-col items-center gap-2">
                            <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                            <span className="text-sm">暂无数据</span>
                          </div>
                        </td>
                      </tr>
                    ) : batchPreview.map((row) => (
                      <tr key={row.seq} className="border-b last:border-b-0">
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.seq}</td>
                        <td className="px-4 py-2.5 tabular-nums">{row.date}</td>
                        <td className="px-4 py-2.5 tabular-nums">{row.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t flex-shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取消</button>
          <button
            disabled={saving || (tab === "single" ? !date || !amount.trim() : !batchFile)}
            onClick={() => void handleConfirm()}
            className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "处理中…" : tab === "batch" ? "上传" : "确定"}
          </button>
        </div>
      </div>
    </div>
  )
}

function OpsScaleManageDialog({
  open,
  product_name,
  onClose,
}: {
  open: boolean
  beian_hao: string | null
  product_name: string
  onClose: () => void
}) {
  const [rows, setRows] = useState<OpsScaleRow[]>([])
  const [showAddDialog, setShowAddDialog] = useState(false)

  useEffect(() => {
    if (!open) return
    setRows([])
    setShowAddDialog(false)
  }, [open, product_name])

  function fmtScaleAmount(v: string): string {
    const n = parseFloat(v.replace(/,/g, ""))
    if (isNaN(n)) return v
    return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  function handleExport() {
    if (rows.length === 0) return
    const escape = (v: string) => {
      const s = String(v)
      return s.includes(",") || s.includes("\"") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const csv = [
      "日期,管理规模,来源",
      ...rows.map((r) => [escape(r.date), escape(r.amount), escape(r.source)].join(",")),
    ].join("\n")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${product_name}_规模数据.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function addSingleRow(date: string, amount: string) {
    setRows((prev) => [{
      id: `${date}-${amount}-${Date.now()}`,
      date,
      amount,
      source: "手动录入",
    }, ...prev])
  }

  function addBatchRows(batchRows: OpsScaleBatchPreviewRow[]) {
    if (batchRows.length === 0) return
    setRows((prev) => [
      ...batchRows.map((r) => ({
        id: `${r.date}-${r.amount}-${r.seq}-${Date.now()}`,
        date: r.date,
        amount: r.amount,
        source: "批量上传",
      })),
      ...prev,
    ])
  }

  function handleDelete(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div
          className="bg-background rounded-lg shadow-xl w-full max-w-[760px] flex flex-col max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
            <span className="font-semibold text-base">规模管理</span>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
          </div>

          <div className="px-6 pt-4 pb-3 flex items-center justify-between gap-4 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-1 h-4 bg-red-500 shrink-0" />
              <span className="font-semibold text-base truncate">{product_name}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="px-3 py-1.5 rounded border text-sm hover:bg-muted transition-colors"
              >
                估值表导入
              </button>
              <button
                type="button"
                onClick={() => setShowAddDialog(true)}
                className="px-3 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
              >
                添加规模数据
              </button>
              <button
                type="button"
                disabled={rows.length === 0}
                onClick={handleExport}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted"
              >
                <Download className="h-3.5 w-3.5" />
                导出
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto min-h-[280px] px-6 pb-6">
            <table className="w-full text-sm border-collapse border rounded-lg overflow-hidden">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted/40 border-b">
                  <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-16">序号</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-32">日期</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">管理规模</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-28">来源</th>
                  <th className="px-4 py-2.5 text-center font-semibold text-zinc-500 w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-16 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                        <span className="text-sm">暂无数据</span>
                      </div>
                    </td>
                  </tr>
                ) : rows.map((row, i) => (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.date}</td>
                    <td className="px-4 py-2.5 tabular-nums">{fmtScaleAmount(row.amount)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.source}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <OpsAddScaleDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onConfirmSingle={addSingleRow}
        onConfirmBatch={addBatchRows}
      />
    </>
  )
}

function PersonalTrackingRowMenu({
  onUntrack,
  onEditTags,
  onNoteManage,
}: {
  onUntrack: () => void
  onEditTags: () => void
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
  function close() { setOpen(false); setPos(null) }

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
          <div className="fixed inset-0 z-[100]" onClick={close} />
          <div
            className="fixed z-[101] bg-background border rounded-lg shadow-lg py-1 min-w-[132px]"
            style={{ top: pos.top, right: pos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => { onUntrack(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground">
              <Heart className="h-3.5 w-3.5 fill-red-500 text-red-500 shrink-0" />已跟踪
            </button>
            <button onClick={() => { onEditTags(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground">
              <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />编辑标签
            </button>
            <button onClick={() => { onNoteManage(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground">
              <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />备注管理
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function InvestmentManagedProductRowMenu({
  onQueryElements,
  onEditTags,
  onEditStrategy,
  onNoteManage,
  onValuationAnalysis,
  onFavorite,
}: {
  onQueryElements: () => void
  onEditTags: () => void
  onEditStrategy: () => void
  onNoteManage: () => void
  onValuationAnalysis?: () => void
  onFavorite?: () => void
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
  function close() { setOpen(false); setPos(null) }

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
          <div className="fixed inset-0 z-[100]" onClick={close} />
          <div
            className="fixed z-[101] bg-background border rounded-lg shadow-lg py-1 min-w-[148px]"
            style={{ top: pos.top, right: pos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => { onQueryElements(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><FileSearch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />查询要素</button>
            <button onClick={() => { onEditTags(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />编辑标签</button>
            <button onClick={() => { onEditStrategy(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />编辑策略</button>
            <button onClick={() => { onNoteManage(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />备注管理</button>
            {onValuationAnalysis && (
              <button onClick={() => { onValuationAnalysis(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><BarChart2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />估值表分析</button>
            )}
            {onFavorite && (
              <button onClick={() => { onFavorite(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><Star className="h-3.5 w-3.5 text-muted-foreground shrink-0" />收藏</button>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function TrackingRowMenu({
  beian_hao,
  product_name,
  onQueryElements,
  onEditTags,
  onEditStrategy,
  onNoteManage,
  onRemove,
}: {
  beian_hao: string
  product_name: string
  onQueryElements: () => void
  onEditTags: () => void
  onEditStrategy: () => void
  onNoteManage: () => void
  onRemove: () => void
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
  function close() { setOpen(false); setPos(null) }

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
          <div className="fixed inset-0 z-[100]" onClick={close} />
          <div
            className="fixed z-[101] bg-background border rounded-lg shadow-lg py-1 min-w-[148px]"
            style={{ top: pos.top, right: pos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => { onQueryElements(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><FileSearch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />查询要素</button>
            <button onClick={() => { onEditTags(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />编辑标签</button>
            <button onClick={() => { onEditStrategy(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />编辑策略</button>
            <button onClick={() => { onNoteManage(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />备注管理</button>
            <button onClick={close} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><BarChart2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />估值表分析</button>
            <button onClick={close} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"><Star className="h-3.5 w-3.5 text-muted-foreground shrink-0" />收藏</button>
            <div className="border-t my-1" />
            <button onClick={() => { onRemove(); close() }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-red-500"><MinusCircle className="h-3.5 w-3.5 shrink-0" />取消跟踪</button>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

interface OpsProductRowMenuItem {
  label: string
  icon: typeof FileSearch
  onClick?: () => void
  destructive?: boolean
}

function OpsProductRowMenu({
  beian_hao,
  onElementsManage,
  onPermissionManage,
  onNoteManage,
  onScaleManage,
  extraItems = [],
  footerItems = [],
}: {
  rowKey?: string
  openRowMenu?: string | null
  onOpenChange?: (key: string | null) => void
  beian_hao: string | null
  onElementsManage: () => void
  onPermissionManage: () => void
  onNoteManage: () => void
  onScaleManage?: () => void
  extraItems?: OpsProductRowMenuItem[]
  footerItems?: OpsProductRowMenuItem[]
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
  function close() { setOpen(false); setPos(null) }

  const standardStubs: OpsProductRowMenuItem[] = [
    { label: "台账管理", icon: ClipboardList },
    { label: "估值表管理", icon: BarChart2 },
  ]

  function renderItem(item: OpsProductRowMenuItem, i: number) {
    const Icon = item.icon
    return (
      <button
        key={`${item.label}-${i}`}
        onClick={() => { item.onClick?.(); close() }}
        className={[
          "w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground",
          item.destructive ? "!text-red-500" : "",
        ].join(" ")}
      >
        <Icon className={["h-3.5 w-3.5 shrink-0", item.destructive ? "" : "text-muted-foreground"].join(" ")} />
        {item.label}
      </button>
    )
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
          <div className="fixed inset-0 z-[100]" onClick={close} />
          <div
            className="fixed z-[101] bg-background border rounded-lg shadow-lg py-1 min-w-[148px]"
            style={{ top: pos.top, right: pos.right }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { if (beian_hao) onElementsManage(); close() }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"
            >
              <FileSearch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />要素管理
            </button>
            <button
              onClick={() => { if (beian_hao) onPermissionManage(); close() }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"
            >
              <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />权限管理
            </button>
            <button
              onClick={() => { if (beian_hao) onNoteManage(); close() }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"
            >
              <StickyNote className="h-3.5 w-3.5 text-muted-foreground shrink-0" />备注管理
            </button>
            {standardStubs.map(renderItem)}
            {extraItems.map(renderItem)}
            <button
              onClick={() => { if (beian_hao) onScaleManage?.(); close() }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-foreground"
            >
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />规模管理
            </button>
            {footerItems.length > 0 && <div className="border-t my-1" />}
            {footerItems.map(renderItem)}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function OperationsDirectView() {
  const [fundClass, setFundClass] = useState<DirectFundClass>("private")
  const [strategySource, setStrategySource] = useState<"company" | "platform">("platform")
  const [strategyHierarchy, setStrategyHierarchy] = useState<TrackStrategyNode[]>([])
  const [strategyL1, setStrategyL1] = useState("")
  const [holdingStatus, setHoldingStatus] = useState<DirectHoldingStatus>("holding")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [sortKey, setSortKey] = useState<DirectSortKey>("product_name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState<DirectFundRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null)
  const [showAddDirectDialog, setShowAddDirectDialog] = useState(false)
  const [addDirectInvestor, setAddDirectInvestor] = useState("")
  const [addDirectFundClass, setAddDirectFundClass] = useState<"private" | "public">("private")
  const [addDirectFundSearch, setAddDirectFundSearch] = useState("")
  const [addDirectFundResults, setAddDirectFundResults] = useState<{ beian_hao: string; product_name: string; short_name: string | null; strategy_one: string | null }[]>([])
  const [addDirectFundSelected, setAddDirectFundSelected] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [addDirectFundLoading, setAddDirectFundLoading] = useState(false)
  const [addDirectFundShowDropdown, setAddDirectFundShowDropdown] = useState(false)
  const [addDirectNavSource, setAddDirectNavSource] = useState("team")
  const [addDirectTxType, setAddDirectTxType] = useState("申购")
  const [addDirectApplyDate, setAddDirectApplyDate] = useState("")
  const [addDirectConfirmDate, setAddDirectConfirmDate] = useState("")
  const [addDirectNetAmount, setAddDirectNetAmount] = useState("")
  const [addDirectShares, setAddDirectShares] = useState("")
  const [addDirectUnitNav, setAddDirectUnitNav] = useState("")
  const [addDirectFee, setAddDirectFee] = useState("")
  const [addDirectSaving, setAddDirectSaving] = useState(false)
  const [addDirectError, setAddDirectError] = useState<string | null>(null)
  const [dataReloadKey, setDataReloadKey] = useState(0)
  const addDirectSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showDirectFieldConfig, setShowDirectFieldConfig] = useState(false)
  const [directFieldConfigSelected, setDirectFieldConfigSelected] = useState<string[]>([...DIRECT_FIELD_CONFIG_DEFAULT])
  const [showDirectAuditLog, setShowDirectAuditLog] = useState(false)
  const [directElementsDialog, setDirectElementsDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [directPermissionDialog, setDirectPermissionDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [directNoteDialog, setDirectNoteDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [directScaleDialog, setDirectScaleDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    const params = new URLSearchParams({ strategy_source: strategySource, pool: "all" })
    fetch(`/ma/api/tracking-funds/strategies?${params}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setStrategyHierarchy(d) : null)
      .catch(() => {})
  }, [strategySource])

  useEffect(() => {
    setPage(1)
  }, [fundClass, strategySource, strategyL1, holdingStatus, keyword, pageSize])

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
    })
    if (strategyL1) params.set("strategy_l1", strategyL1)
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
  }, [page, pageSize, fundClass, strategySource, strategyL1, holdingStatus, keyword, sortKey, sortDir, dataReloadKey])

  useEffect(() => {
    if (!showAddDirectDialog) return
    if (!addDirectFundSearch.trim()) {
      setAddDirectFundResults([])
      setAddDirectFundShowDropdown(false)
      return
    }
    if (addDirectSearchRef.current) clearTimeout(addDirectSearchRef.current)
    addDirectSearchRef.current = setTimeout(async () => {
      setAddDirectFundLoading(true)
      try {
        const res = await fetch(`/ma/api/tracking-funds/search?q=${encodeURIComponent(addDirectFundSearch.trim())}`)
        const json = await res.json()
        setAddDirectFundResults(Array.isArray(json) ? json : [])
        setAddDirectFundShowDropdown(true)
      } catch {
        setAddDirectFundResults([])
      } finally {
        setAddDirectFundLoading(false)
      }
    }, 250)
    return () => {
      if (addDirectSearchRef.current) clearTimeout(addDirectSearchRef.current)
    }
  }, [addDirectFundSearch, showAddDirectDialog])

  function openAddDirectDialog() {
    setAddDirectInvestor("")
    setAddDirectFundClass("private")
    setAddDirectFundSearch("")
    setAddDirectFundResults([])
    setAddDirectFundSelected(null)
    setAddDirectFundShowDropdown(false)
    setAddDirectNavSource("team")
    setAddDirectTxType("申购")
    setAddDirectApplyDate("")
    setAddDirectConfirmDate("")
    setAddDirectNetAmount("")
    setAddDirectShares("")
    setAddDirectUnitNav("")
    setAddDirectFee("")
    setAddDirectError(null)
    setShowAddDirectDialog(true)
  }

  async function submitAddDirect() {
    if (!addDirectInvestor.trim()) { setAddDirectError("请选择投资者名称"); return }
    if (!addDirectFundSelected) { setAddDirectError("请选择基金"); return }
    if (!addDirectApplyDate) { setAddDirectError("请输入交易申请日期"); return }
    if (!addDirectConfirmDate) { setAddDirectError("请输入交易确认日期"); return }
    if (!addDirectNetAmount.trim()) { setAddDirectError("请输入确认净额"); return }
    if (!addDirectShares.trim()) { setAddDirectError("请输入确认份额"); return }
    if (!addDirectUnitNav.trim()) { setAddDirectError("请输入单位净值"); return }
    setAddDirectSaving(true)
    setAddDirectError(null)
    try {
      const res = await fetch("/ma/api/ops/direct-funds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          investor_name: addDirectInvestor.trim(),
          fund_class: addDirectFundClass,
          beian_hao: addDirectFundSelected.beian_hao,
          product_name: addDirectFundSelected.product_name,
          nav_source: addDirectNavSource,
          transaction_type: addDirectTxType,
          apply_date: addDirectApplyDate,
          confirm_date: addDirectConfirmDate,
          net_amount: addDirectNetAmount.trim(),
          shares: addDirectShares.trim(),
          unit_nav: addDirectUnitNav.trim(),
          fee: addDirectFee.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setAddDirectError(d.error || "提交失败")
        return
      }
      setShowAddDirectDialog(false)
      setDataReloadKey((k) => k + 1)
    } catch {
      setAddDirectError("提交失败，请稍后重试")
    } finally {
      setAddDirectSaving(false)
    }
  }

  function handleSort(col: DirectSortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("desc") }
    setPage(1)
  }

  function DirectSortIcon({ col }: { col: DirectSortKey }) {
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

  function handleExport() {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const rows = selected.size > 0 ? data.filter((r) => selected.has(r.beian_hao)) : data
    const headers = ["产品名称", "备案编码", "单位净值", "净值日期", "涨跌幅", "持仓市值(元)", "持仓份额", "估值表日期"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.short_name || r.product_name), escape(r.beian_hao), escape(r.latest_nav),
        escape(r.latest_nav_date), escape(r.latest_price_change), escape(r.holding_mv),
        escape(r.holding_shares), escape(r.valuation_date),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `直投产品_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"
  const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Filters */}
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
                onClick={() => setFundClass(fc)}
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
        <div className="flex items-start px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">一级策略：</span>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <select
                value={strategySource}
                onChange={(e) => {
                  const next = e.target.value as "company" | "platform"
                  if (strategySource === next) return
                  setStrategySource(next)
                  setStrategyL1("")
                  setPage(1)
                }}
                className="h-7 min-w-[6.25rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="company">团队策略</option>
                <option value="platform">平台策略</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            </div>
            <span
              onClick={() => { setStrategyL1(""); setPage(1) }}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                !strategyL1
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              不限
            </span>
            {strategyHierarchy.map((node) => (
              <span
                key={node.l1}
                onClick={() => {
                  const next = strategyL1 === node.l1 ? "" : node.l1
                  setStrategyL1(next)
                  setPage(1)
                }}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                  strategyL1 === node.l1
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                    : "border-border text-zinc-500 hover:bg-muted/60",
                ].join(" ")}
              >
                {node.l1}
              </span>
            ))}
          </div>
        </div>
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
          <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-72">
            <input
              className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
              placeholder="请输入产品/产品备案号，按回车搜索"
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

      {/* Toolbar */}
      <div className="flex items-center justify-end gap-3 mb-3 flex-shrink-0 text-xs text-zinc-600">
        <button
          onClick={() => setShowDirectAuditLog(true)}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
          <ClipboardList className="h-3.5 w-3.5" /> 操作日志
        </button>
        <button
          disabled={selected.size === 0}
          className="inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground">
          批量上传要素
        </button>
        <button
          onClick={() => setShowDirectFieldConfig(true)}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
          <Settings2 className="h-3.5 w-3.5" /> 字段配置
        </button>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
          <Download className="h-3.5 w-3.5" /> 导出
        </button>
        <button
          disabled={selected.size === 0}
          className="inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground">
          批量操作
          {selected.size > 0 && <span className="text-red-500">({selected.size})</span>}
        </button>
        <button
          onClick={openAddDirectDialog}
          className="inline-flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white rounded px-3 py-1.5 font-medium transition-colors">
          添加直投
        </button>
      </div>

      {/* Table */}
      <div className="overflow-auto rounded-lg border flex-1 min-h-0">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1100 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
              <th className={`${thBase} w-8 px-2`}>
                <input type="checkbox" className="rounded h-3 w-3"
                  checked={selected.size === data.length && data.length > 0}
                  onChange={toggleAll} />
              </th>
              <th className={`${thBase} w-10`}>序号</th>
              <th className={`${thSort} min-w-[180px]`} onClick={() => handleSort("product_name")}>产品名称<DirectSortIcon col="product_name" /></th>
              <th className={`${thBase} min-w-[90px]`}>备案编码</th>
              <th className={`${thSort} min-w-[90px]`} onClick={() => handleSort("latest_nav")}>单位净值<DirectSortIcon col="latest_nav" /></th>
              <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("latest_nav_date")}>净值日期<DirectSortIcon col="latest_nav_date" /></th>
              <th className={`${thSort} text-right min-w-[80px]`} onClick={() => handleSort("latest_price_change")}>涨跌幅<DirectSortIcon col="latest_price_change" /></th>
              <th className={`${thSort} text-right min-w-[110px]`} onClick={() => handleSort("holding_mv")}>持仓市值(元)<DirectSortIcon col="holding_mv" /></th>
              <th className={`${thSort} text-right min-w-[90px]`} onClick={() => handleSort("holding_shares")}>持仓份额<DirectSortIcon col="holding_shares" /></th>
              <th className={`${thBase} min-w-[100px]`}>估值表日期</th>
              <th className={`${thBase} text-center w-16`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : data.map((row, i) => {
              const isSelected = selected.has(row.beian_hao)
              const cell = `border-b px-3 py-2 ${isSelected ? "bg-blue-50 dark:bg-blue-950/40" : ""} group-hover:bg-muted transition-colors`
              return (
                <tr key={row.beian_hao} className="group">
                  <td className={`${cell} px-2 text-center`}>
                    <input type="checkbox" className="rounded h-3 w-3"
                      checked={isSelected}
                      onChange={() => {
                        const s = new Set(selected)
                        isSelected ? s.delete(row.beian_hao) : s.add(row.beian_hao)
                        setSelected(s)
                      }} />
                  </td>
                  <td className={`${cell} text-center tabular-nums text-muted-foreground`}>{(page - 1) * pageSize + i + 1}</td>
                  <td className={cell}>
                    <a
                      href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beian_hao)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-blue-600 dark:text-blue-400 hover:underline block truncate max-w-[220px]"
                      title={row.product_name}
                    >{row.short_name || row.product_name}</a>
                    {row.strategy_l1 && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] border border-amber-300/80 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700/50">
                        {row.strategy_l1}
                      </span>
                    )}
                  </td>
                  <td className={`${cell} tabular-nums text-muted-foreground`}>{row.beian_hao}</td>
                  <td className={`${cell} tabular-nums font-medium`}>{row.latest_nav ? parseFloat(row.latest_nav).toFixed(4) : "—"}</td>
                  <td className={`${cell} tabular-nums`}>{row.latest_nav_date ?? "—"}</td>
                  <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.latest_price_change} /></td>
                  <td className={`${cell} text-right tabular-nums`}>{row.holding_mv ?? "—"}</td>
                  <td className={`${cell} text-right tabular-nums`}>{row.holding_shares ?? "—"}</td>
                  <td className={`${cell} tabular-nums`}>{row.valuation_date ?? "—"}</td>
                  <td className={`${cell} text-center`}>
                    <div className="relative flex items-center justify-center">
                      <OpsProductRowMenu
                        rowKey={row.beian_hao}
                        openRowMenu={openRowMenu}
                        onOpenChange={setOpenRowMenu}
                        beian_hao={row.beian_hao}
                        onElementsManage={() => setDirectElementsDialog({ beian_hao: row.beian_hao, product_name: row.product_name })}
                        onPermissionManage={() => setDirectPermissionDialog({ beian_hao: row.beian_hao, product_name: row.product_name })}
                        onNoteManage={() => setDirectNoteDialog({ beian_hao: row.beian_hao, product_name: row.product_name })}
                        onScaleManage={() => setDirectScaleDialog({ beian_hao: row.beian_hao, product_name: row.product_name })}
                        footerItems={[{ label: "移除", icon: MinusCircle, destructive: true }]}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between pt-3 flex-shrink-0">
        <span className="text-sm text-zinc-500">
          共 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{total.toLocaleString()}</span> 条
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">‹</button>
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
            className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">›</button>
          <div className="relative ml-3">
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

      {showAddDirectDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAddDirectDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b">
              <span className="font-semibold text-base">添加基金</span>
              <button onClick={() => setShowAddDirectDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5">
              <div className="flex items-start gap-4 mb-4">
                <DirectFormLabel>投资者名称：</DirectFormLabel>
                <div className="flex-1 relative">
                  <select
                    value={addDirectInvestor}
                    onChange={(e) => setAddDirectInvestor(e.target.value)}
                    className="w-full h-9 appearance-none rounded border border-border bg-background pl-3 pr-8 text-sm text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">请选择投资者名称</option>
                    <option value="团队主账户">团队主账户</option>
                    <option value="FOF账户">FOF账户</option>
                    <option value="直投账户">直投账户</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                </div>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <DirectFormLabel>基金名称：</DirectFormLabel>
                <div className="flex-1 flex flex-col gap-0 min-w-0">
                  <div className="flex items-center border rounded overflow-visible">
                    <div className="relative shrink-0">
                      <select
                        value={addDirectFundClass}
                        onChange={(e) => setAddDirectFundClass(e.target.value as "private" | "public")}
                        className="h-9 appearance-none pl-3 pr-7 text-sm bg-muted/40 border-r text-zinc-700 dark:text-zinc-300 focus:outline-none cursor-pointer"
                      >
                        <option value="private">私募基金</option>
                        <option value="public">公募基金</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                    </div>
                    <div className="flex flex-1 items-center px-3 gap-2 min-w-0 relative">
                      {addDirectFundSelected ? (
                        <div className="flex flex-1 items-center justify-between h-9 min-w-0">
                          <div className="flex flex-col leading-tight min-w-0">
                            <span className="text-sm font-medium truncate">{addDirectFundSelected.product_name}</span>
                            <span className="text-xs text-muted-foreground truncate">{addDirectFundSelected.beian_hao}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setAddDirectFundSelected(null); setAddDirectFundSearch(""); setAddDirectFundShowDropdown(false) }}
                            className="text-muted-foreground hover:text-foreground text-base leading-none ml-2 shrink-0">×</button>
                        </div>
                      ) : (
                        <>
                          <input
                            autoFocus
                            type="text"
                            value={addDirectFundSearch}
                            onChange={(e) => { setAddDirectFundSearch(e.target.value); setAddDirectFundSelected(null) }}
                            onFocus={() => { if (addDirectFundResults.length > 0) setAddDirectFundShowDropdown(true) }}
                            placeholder="输入基金名称/备案号搜索"
                            className="flex-1 h-9 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50 min-w-0"
                          />
                          {addDirectFundLoading
                            ? <svg className="h-3.5 w-3.5 animate-spin text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" /></svg>
                            : <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />}
                        </>
                      )}
                    </div>
                  </div>
                  {addDirectFundShowDropdown && addDirectFundResults.length > 0 && !addDirectFundSelected && (
                    <div className="relative z-50">
                      <div className="absolute left-0 right-0 top-0 bg-background border rounded-lg shadow-xl max-h-48 overflow-y-auto">
                        {addDirectFundResults.map((r) => (
                          <button
                            key={r.beian_hao}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setAddDirectFundSelected({ beian_hao: r.beian_hao, product_name: r.product_name })
                              setAddDirectFundSearch("")
                              setAddDirectFundShowDropdown(false)
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                          >
                            <div className="text-sm truncate">{r.product_name}</div>
                            <div className="text-xs text-muted-foreground truncate">{r.beian_hao}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {addDirectFundShowDropdown && addDirectFundResults.length === 0 && !addDirectFundLoading && addDirectFundSearch.trim() && !addDirectFundSelected && (
                    <div className="relative z-50">
                      <div className="absolute left-0 right-0 top-0 bg-background border rounded-lg shadow-xl px-4 py-3 text-sm text-muted-foreground">
                        未找到匹配的基金
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <DirectFormLabel>
                  <span className="inline-flex items-center justify-end gap-0.5">
                    净值来源<DirectFormHint />：
                  </span>
                </DirectFormLabel>
                <div className="flex-1 relative">
                  <select
                    value={addDirectNavSource}
                    onChange={(e) => setAddDirectNavSource(e.target.value)}
                    className="w-full h-9 appearance-none rounded border border-border bg-background pl-3 pr-8 text-sm text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="team">团队净值</option>
                    <option value="platform">平台净值</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                </div>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <DirectFormLabel>交易类型：</DirectFormLabel>
                <div className="flex-1 relative">
                  <select
                    value={addDirectTxType}
                    onChange={(e) => setAddDirectTxType(e.target.value)}
                    className="w-full h-9 appearance-none rounded border border-border bg-background pl-3 pr-8 text-sm text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="申购">申购</option>
                    <option value="认购">认购</option>
                    <option value="赎回">赎回</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                </div>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <DirectFormLabel>申请日期：</DirectFormLabel>
                <div className="flex-1 relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="date"
                    value={addDirectApplyDate}
                    onChange={(e) => setAddDirectApplyDate(e.target.value)}
                    placeholder="请输入交易申请日期"
                    className="w-full h-9 rounded border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <DirectFormLabel>确认日期：</DirectFormLabel>
                <div className="flex-1 relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="date"
                    value={addDirectConfirmDate}
                    onChange={(e) => setAddDirectConfirmDate(e.target.value)}
                    placeholder="请输入交易确认日期"
                    className="w-full h-9 rounded border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <DirectFormLabel>
                  <span className="inline-flex items-center justify-end gap-0.5">
                    确认净额<DirectFormHint />：
                  </span>
                </DirectFormLabel>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={addDirectNetAmount}
                    onChange={(e) => setAddDirectNetAmount(e.target.value)}
                    placeholder="输入确认净额"
                    className="flex-1 h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-sm text-zinc-500 shrink-0">(元)</span>
                </div>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <DirectFormLabel>确认份额：</DirectFormLabel>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={addDirectShares}
                    onChange={(e) => setAddDirectShares(e.target.value)}
                    placeholder="输入确认份额"
                    className="flex-1 h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-sm text-zinc-500 shrink-0">(份)</span>
                </div>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <DirectFormLabel>确认单位净值：</DirectFormLabel>
                <div className="flex-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={addDirectUnitNav}
                    onChange={(e) => setAddDirectUnitNav(e.target.value)}
                    placeholder="请输入单位净值"
                    className="w-full h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="flex items-start gap-4 mb-2">
                <DirectFormLabel required={false}>交易费用：</DirectFormLabel>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={addDirectFee}
                    onChange={(e) => setAddDirectFee(e.target.value)}
                    placeholder="选填"
                    className="flex-1 h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-sm text-zinc-500 shrink-0">(元)</span>
                </div>
              </div>

              {addDirectError && (
                <p className="text-sm text-red-500 mt-3 text-center">{addDirectError}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t bg-muted/20">
              <button
                type="button"
                onClick={() => setShowAddDirectDialog(false)}
                className="px-5 py-1.5 border rounded text-sm hover:bg-muted transition-colors">
                取消
              </button>
              <button
                type="button"
                onClick={submitAddDirect}
                disabled={addDirectSaving}
                className="px-5 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-50">
                {addDirectSaving ? "提交中…" : "确定"}
              </button>
            </div>
          </div>
        </div>
      )}

      <DirectFieldConfigDialog
        open={showDirectFieldConfig}
        selected={directFieldConfigSelected}
        onClose={() => setShowDirectFieldConfig(false)}
        onConfirm={(fields) => {
          setDirectFieldConfigSelected(fields)
          setShowDirectFieldConfig(false)
        }}
      />

      <OpsAuditLogDialog
        open={showDirectAuditLog}
        onClose={() => setShowDirectAuditLog(false)}
      />
      <OpsEditElementsDialog
        open={!!directElementsDialog}
        beian_hao={directElementsDialog?.beian_hao ?? null}
        product_name={directElementsDialog?.product_name ?? ""}
        onClose={() => setDirectElementsDialog(null)}
      />
      <OpsPermissionDialog
        open={!!directPermissionDialog}
        beian_hao={directPermissionDialog?.beian_hao ?? null}
        product_name={directPermissionDialog?.product_name ?? ""}
        onClose={() => setDirectPermissionDialog(null)}
      />
      <OpsTeamNoteDialog
        open={!!directNoteDialog}
        beian_hao={directNoteDialog?.beian_hao ?? null}
        product_name={directNoteDialog?.product_name ?? ""}
        onClose={() => setDirectNoteDialog(null)}
      />
      <OpsScaleManageDialog
        open={!!directScaleDialog}
        beian_hao={directScaleDialog?.beian_hao ?? null}
        product_name={directScaleDialog?.product_name ?? ""}
        onClose={() => setDirectScaleDialog(null)}
      />
    </div>
  )
}

// ─── OperationsFofUnderlyingView ───────────────────────────────────────────

type FofSortKey = "product_name" | "latest_nav" | "latest_nav_date" | "latest_price_change"

interface FofUnderlyingRow {
  id: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  nav_estimated: boolean
  valuation_date: string | null
}

function OperationsFofUnderlyingView() {
  const [fundClass, setFundClass] = useState<"private" | "public">("private")
  const [strategySource, setStrategySource] = useState<"company" | "platform">("company")
  const [strategyHierarchy, setStrategyHierarchy] = useState<TrackStrategyNode[]>([])
  const [strategyL1, setStrategyL1] = useState("")
  const [holdingStatus, setHoldingStatus] = useState<"holding" | "cleared">("holding")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [fofFundInput, setFofFundInput] = useState("")
  const [fofFundSelected, setFofFundSelected] = useState<{ register_number: string; product_name: string } | null>(null)
  const [fofFundOptions, setFofFundOptions] = useState<{ register_number: string; product_name: string }[]>([])
  const [fofFundShowDropdown, setFofFundShowDropdown] = useState(false)
  const [sortKey, setSortKey] = useState<FofSortKey | "">("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState<FofUnderlyingRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null)
  const [showFofFieldConfig, setShowFofFieldConfig] = useState(false)
  const [fofFieldConfigSelected, setFofFieldConfigSelected] = useState<string[]>([...DIRECT_FIELD_CONFIG_DEFAULT])
  const [showFofAuditLog, setShowFofAuditLog] = useState(false)
  const [fofElementsDialog, setFofElementsDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [fofPermissionDialog, setFofPermissionDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [fofNoteDialog, setFofNoteDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [fofSyncNavDialog, setFofSyncNavDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [fofScaleDialog, setFofScaleDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [hoverChartRow, setHoverChartRow] = useState<string | null>(null)
  const [hoverChartPos, setHoverChartPos] = useState<{ x: number; y: number } | null>(null)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fofFundSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    const params = new URLSearchParams({ strategy_source: strategySource, pool: "all" })
    fetch(`/ma/api/tracking-funds/strategies?${params}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setStrategyHierarchy(d) : null)
      .catch(() => {})
  }, [strategySource])

  useEffect(() => {
    setPage(1)
  }, [fundClass, strategySource, strategyL1, holdingStatus, keyword, pageSize, fofFundSelected?.register_number])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      strategy_source: strategySource,
      holding_status: holdingStatus,
      keyword,
      dir: sortDir,
    })
    if (sortKey) params.set("sort", sortKey)
    if (strategyL1 === "__unconfigured__") params.set("strategy_l1", "__unconfigured__")
    else if (strategyL1) params.set("strategy_l1", strategyL1)
    if (fofFundSelected?.register_number) params.set("fof_register_number", fofFundSelected.register_number)
    fetch(`/ma/api/ops/fof-underlying/list?${params}`)
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
  }, [page, pageSize, strategySource, strategyL1, holdingStatus, keyword, sortKey, sortDir, fofFundSelected?.register_number])

  useEffect(() => {
    fetch("/ma/api/ops/fof-underlying/fof-funds")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setFofFundOptions(d) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (fofFundSearchRef.current) clearTimeout(fofFundSearchRef.current)
    fofFundSearchRef.current = setTimeout(() => {
      const q = fofFundInput.trim()
      fetch(`/ma/api/ops/fof-underlying/fof-funds${q ? `?q=${encodeURIComponent(q)}` : ""}`)
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d)) setFofFundOptions(d) })
        .catch(() => setFofFundOptions([]))
    }, 200)
    return () => { if (fofFundSearchRef.current) clearTimeout(fofFundSearchRef.current) }
  }, [fofFundInput])

  function handleSort(col: FofSortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("desc") }
    setPage(1)
  }

  function FofSortIcon({ col }: { col: FofSortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function toggleAll() {
    if (selected.size === data.length && data.length > 0) setSelected(new Set())
    else setSelected(new Set(data.map((r) => r.id)))
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
    const rows = selected.size > 0 ? data.filter((r) => selected.has(r.id)) : data
    const headers = ["产品名称", "备案编码", "单位净值", "净值日期", "涨跌幅", "估值表日期"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.short_name || r.product_name), escape(r.beian_hao), escape(r.latest_nav),
        escape(r.latest_nav_date), escape(r.latest_price_change), escape(r.valuation_date),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `FOF底层_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"
  const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">基金分类：</span>
          <div className="flex items-center gap-1">
            {([["private", "私募"], ["public", "公募"]] as const).map(([fc, label]) => (
              <span
                key={fc}
                onClick={() => setFundClass(fc)}
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
        <div className="flex items-start px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">一级策略：</span>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <select
                value={strategySource}
                onChange={(e) => {
                  const next = e.target.value as "company" | "platform"
                  if (strategySource === next) return
                  setStrategySource(next)
                  setStrategyL1("")
                  setPage(1)
                }}
                className="h-7 min-w-[6.25rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="company">团队策略</option>
                <option value="platform">平台策略</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            </div>
            <span
              onClick={() => { setStrategyL1(""); setPage(1) }}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                !strategyL1
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              不限
            </span>
            {strategyHierarchy.map((node) => (
              <span
                key={node.l1}
                onClick={() => { setStrategyL1(strategyL1 === node.l1 ? "" : node.l1); setPage(1) }}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                  strategyL1 === node.l1
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                    : "border-border text-zinc-500 hover:bg-muted/60",
                ].join(" ")}
              >
                {node.l1}
              </span>
            ))}
            <span
              onClick={() => { setStrategyL1(strategyL1 === "__unconfigured__" ? "" : "__unconfigured__"); setPage(1) }}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                strategyL1 === "__unconfigured__"
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                  : "border-border text-zinc-500 hover:bg-muted/60",
              ].join(" ")}
            >
              策略未配置
            </span>
          </div>
        </div>
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">持仓状态：</span>
          <div className="flex items-center gap-1">
            {([["holding", "持仓中"], ["cleared", "已清仓"]] as const).map(([st, label]) => (
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
        <div className="flex items-center px-4 py-2 gap-6 flex-wrap">
          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">关 键 字：</span>
            <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-72">
              <input
                className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
                placeholder="请输入产品/产品备案号，按回车搜索"
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput)}
              />
              <button onClick={() => setKeyword(kwInput)} className="text-muted-foreground hover:text-foreground transition-colors">
                <Search className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 pr-3">FOF基金：</span>
            <div className="relative w-64">
              {fofFundSelected ? (
                <div className="flex items-center justify-between border rounded h-7 px-2 bg-background">
                  <span className="text-xs truncate">{fofFundSelected.product_name}</span>
                  <button
                    type="button"
                    onClick={() => { setFofFundSelected(null); setFofFundInput("") }}
                    className="text-muted-foreground hover:text-foreground ml-1 shrink-0">×</button>
                </div>
              ) : (
                <>
                  <input
                    className="w-full h-7 border rounded px-2 text-xs bg-background outline-none placeholder:text-muted-foreground/50"
                    placeholder="请输入并选择FOF基金"
                    value={fofFundInput}
                    onChange={(e) => { setFofFundInput(e.target.value); setFofFundShowDropdown(true) }}
                    onFocus={() => setFofFundShowDropdown(true)}
                  />
                  {fofFundShowDropdown && fofFundOptions.length > 0 && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setFofFundShowDropdown(false)} />
                      <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-background border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {fofFundOptions.map((opt) => (
                          <button
                            key={opt.register_number}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setFofFundSelected(opt)
                              setFofFundInput("")
                              setFofFundShowDropdown(false)
                            }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors truncate"
                          >
                            {opt.product_name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mb-3 flex-shrink-0 text-xs text-zinc-600">
        <button onClick={() => setShowFofAuditLog(true)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
          <ClipboardList className="h-3.5 w-3.5" /> 操作日志
        </button>
        <button disabled={selected.size === 0} className="inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground">
          批量上传要素
        </button>
        <button onClick={() => setShowFofFieldConfig(true)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
          <Settings2 className="h-3.5 w-3.5" /> 字段配置
        </button>
        <button onClick={handleExport} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
          <Download className="h-3.5 w-3.5" /> 导出
        </button>
        <button disabled={selected.size === 0} className="inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground">
          批量操作
          {selected.size > 0 && <span className="text-red-500">({selected.size})</span>}
        </button>
      </div>

      <div className="overflow-auto rounded-lg border flex-1 min-h-0">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1100 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
              <th className={`${thBase} w-8 px-2`}>
                <input type="checkbox" className="rounded h-3 w-3" checked={selected.size === data.length && data.length > 0} onChange={toggleAll} />
              </th>
              <th className={`${thBase} w-10 text-center`}>序号</th>
              <th className={`${thSort} min-w-[200px]`} onClick={() => handleSort("product_name")}>产品名称<FofSortIcon col="product_name" /></th>
              <th className={`${thBase} min-w-[90px]`}>备案编码</th>
              <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("latest_nav")}>单位净值<FofSortIcon col="latest_nav" /></th>
              <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("latest_nav_date")}>净值日期<FofSortIcon col="latest_nav_date" /></th>
              <th className={`${thSort} min-w-[80px]`} onClick={() => handleSort("latest_price_change")}>涨跌幅<FofSortIcon col="latest_price_change" /></th>
              <th className={`${thBase} min-w-[100px]`}>估值表日期</th>
              <th className={`${thBase} text-right pr-4 w-24`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : data.map((row, i) => {
              const isSelected = selected.has(row.id)
              const cell = `border-b px-3 py-2 ${isSelected ? "bg-blue-50 dark:bg-blue-950/40" : ""} group-hover:bg-muted transition-colors`
              return (
                <tr key={row.id} className="group">
                  <td className={`${cell} px-2 text-center`}>
                    <input type="checkbox" className="rounded h-3 w-3" checked={isSelected}
                      onChange={() => {
                        const s = new Set(selected)
                        isSelected ? s.delete(row.id) : s.add(row.id)
                        setSelected(s)
                      }} />
                  </td>
                  <td className={`${cell} text-center tabular-nums text-muted-foreground`}>{(page - 1) * pageSize + i + 1}</td>
                  <td className={cell}>
                    <FundProductNameLink
                      beian_hao={row.beian_hao}
                      product_name={row.product_name}
                      short_name={row.short_name}
                    />
                    {row.strategy_l1 && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] border border-zinc-300/80 text-zinc-600 bg-zinc-50 dark:bg-zinc-800/50 dark:text-zinc-400">
                        {row.strategy_l1}
                      </span>
                    )}
                  </td>
                  <td className={`${cell} tabular-nums text-muted-foreground whitespace-nowrap`}>{row.beian_hao ?? "—"}</td>
                  <td className={`${cell} tabular-nums whitespace-nowrap`}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{row.latest_nav ? parseFloat(row.latest_nav).toFixed(4) : "—"}</span>
                      {row.nav_estimated && row.latest_nav && (
                        <span className="inline-block px-1 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800 shrink-0">团队</span>
                      )}
                    </div>
                  </td>
                  <td className={`${cell} tabular-nums whitespace-nowrap`}>{row.latest_nav_date ?? "—"}</td>
                  <td className={`${cell} tabular-nums whitespace-nowrap`}><TrackPctCell value={row.latest_price_change} /></td>
                  <td className={`${cell} tabular-nums whitespace-nowrap text-muted-foreground`}>{row.valuation_date ?? "—"}</td>
                  <td className={`${cell} text-right pr-4`}>
                    <div className="flex items-center justify-end gap-4">
                      {row.beian_hao && (
                        <div
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
                          }}>
                          <button type="button" className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                            <LineChart className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                      <OpsProductRowMenu
                        rowKey={row.id}
                        openRowMenu={openRowMenu}
                        onOpenChange={setOpenRowMenu}
                        beian_hao={row.beian_hao}
                        onElementsManage={() => setFofElementsDialog({ beian_hao: row.beian_hao!, product_name: row.product_name })}
                        onPermissionManage={() => setFofPermissionDialog({ beian_hao: row.beian_hao!, product_name: row.product_name })}
                        onNoteManage={() => setFofNoteDialog({ beian_hao: row.beian_hao!, product_name: row.product_name })}
                        onScaleManage={() => setFofScaleDialog({ beian_hao: row.beian_hao!, product_name: row.product_name })}
                        extraItems={[{
                          label: "同步净值",
                          icon: RefreshCw,
                          onClick: () => setFofSyncNavDialog({ beian_hao: row.beian_hao!, product_name: row.product_name }),
                        }]}
                      />
                    </div>
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
          <div className="fixed z-50 bg-background border rounded-lg shadow-xl pointer-events-none"
            style={{ left, top }}
            onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current) }}
            onMouseLeave={() => setHoverChartRow(null)}>
            <TrendHoverChart beian_hao={hoverChartRow} productName={data.find((r) => r.beian_hao === hoverChartRow)?.product_name ?? ""} />
          </div>
        )
      })()}

      <div className="flex items-center justify-between pt-3 flex-shrink-0">
        <span className="text-sm text-zinc-500">
          共 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{total.toLocaleString()}</span> 条
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">‹</button>
          {pageButtons().map((btn, idx) =>
            btn === "…" ? (
              <span key={`fof-e${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
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
          <div className="relative ml-3">
            <select value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-7 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring">
              {[50, 100, 200].map((n) => <option key={n} value={n}>{n} 条/页</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>

      <DirectFieldConfigDialog
        open={showFofFieldConfig}
        selected={fofFieldConfigSelected}
        onClose={() => setShowFofFieldConfig(false)}
        onConfirm={(fields) => { setFofFieldConfigSelected(fields); setShowFofFieldConfig(false) }}
      />
      <OpsAuditLogDialog open={showFofAuditLog} onClose={() => setShowFofAuditLog(false)} />
      <OpsEditElementsDialog
        open={!!fofElementsDialog}
        beian_hao={fofElementsDialog?.beian_hao ?? null}
        product_name={fofElementsDialog?.product_name ?? ""}
        onClose={() => setFofElementsDialog(null)}
      />
      <OpsPermissionDialog
        open={!!fofPermissionDialog}
        beian_hao={fofPermissionDialog?.beian_hao ?? null}
        product_name={fofPermissionDialog?.product_name ?? ""}
        onClose={() => setFofPermissionDialog(null)}
      />
      <OpsTeamNoteDialog
        open={!!fofNoteDialog}
        beian_hao={fofNoteDialog?.beian_hao ?? null}
        product_name={fofNoteDialog?.product_name ?? ""}
        onClose={() => setFofNoteDialog(null)}
      />
      <OpsSyncNavDialog
        open={!!fofSyncNavDialog}
        beian_hao={fofSyncNavDialog?.beian_hao ?? null}
        product_name={fofSyncNavDialog?.product_name ?? ""}
        onClose={() => setFofSyncNavDialog(null)}
      />
      <OpsScaleManageDialog
        open={!!fofScaleDialog}
        beian_hao={fofScaleDialog?.beian_hao ?? null}
        product_name={fofScaleDialog?.product_name ?? ""}
        onClose={() => setFofScaleDialog(null)}
      />
    </div>
  )
}

// ─── OperationsManagedProductsView ───────────────────────────────────────────

type ManagedSortKey =
  | "product_name" | "latest_nav" | "latest_nav_date" | "latest_price_change"
  | "custody_balance" | "net_asset_value"

interface ManagedProductRow {
  id: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  custody_balance: string | null
  net_asset_value: string | null
  valuation_date: string | null
  ret_1w?: string | null
  ret_1m?: string | null
  ret_3m?: string | null
  ret_6m?: string | null
  ret_1y?: string | null
  sharpe_1y?: string | null
  calmar_1y?: string | null
}

interface ManagedProductsListParams {
  page: number
  pageSize: number
  strategySource: "company" | "platform"
  runStatus: "running" | "liquidated"
  teamTagMode: "and" | "or"
  keyword: string
  sortKey: string
  sortDir: "asc" | "desc"
  strategyL1: string
  teamTags: string[]
  cutoff?: string
}

function buildManagedProductsListParams(p: ManagedProductsListParams): URLSearchParams {
  const params = new URLSearchParams({
    page: String(p.page),
    pageSize: String(p.pageSize),
    strategy_source: p.strategySource,
    run_status: p.runStatus,
    team_tag_mode: p.teamTagMode,
    keyword: p.keyword,
    dir: p.sortDir,
  })
  if (p.sortKey) params.set("sort", p.sortKey)
  if (p.cutoff) params.set("cutoff", p.cutoff)
  if (p.strategyL1 === "__unconfigured__") params.set("strategy_l1", "__unconfigured__")
  else if (p.strategyL1) params.set("strategy_l1", p.strategyL1)
  p.teamTags.forEach((t) => params.append("team_tag", t))
  return params
}

async function fetchManagedProductsList(params: URLSearchParams) {
  const json = await fetch(`/ma/api/ops/managed-products/list?${params}`).then((r) => r.json())
  return {
    data: (json.data ?? []) as ManagedProductRow[],
    total: json.total ?? 0,
    totalNetAssetValue: json.totalNetAssetValue ?? "0",
  }
}

function fmtMoney(v: string | null | undefined): string {
  if (!v) return "—"
  const n = parseFloat(v)
  if (isNaN(n)) return "—"
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function FundProductNameLink({
  beian_hao,
  product_name,
  short_name,
  className,
}: {
  beian_hao: string | null
  product_name: string
  short_name?: string | null
  className?: string
}) {
  const label = short_name || product_name
  const href = `/ma/dashboard/private-funds/${encodeURIComponent(beian_hao || product_name)}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? "block max-w-[200px]"}
      title={product_name}
    >
      <span className="font-medium text-blue-600 dark:text-blue-400 hover:underline truncate block leading-5">
        {label}
      </span>
      {beian_hao && (
        <span className="text-[10px] text-muted-foreground tabular-nums leading-4 block truncate">
          {beian_hao}
        </span>
      )}
    </a>
  )
}

function OperationsManagedProductsView() {
  const [strategySource, setStrategySource] = useState<"company" | "platform">("company")
  const [strategyHierarchy, setStrategyHierarchy] = useState<TrackStrategyNode[]>([])
  const [strategyL1, setStrategyL1] = useState("")
  const [teamTagMode, setTeamTagMode] = useState<"and" | "or">("and")
  const [teamTagOptions, setTeamTagOptions] = useState<string[]>([])
  const [teamTags, setTeamTags] = useState<string[]>([])
  const [runStatus, setRunStatus] = useState<"running" | "liquidated">("running")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [sortKey, setSortKey] = useState<ManagedSortKey | "">("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState<ManagedProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openRowMenu, setOpenRowMenu] = useState<string | null>(null)
  const [showManagedFieldConfig, setShowManagedFieldConfig] = useState(false)
  const [managedFieldConfigSelected, setManagedFieldConfigSelected] = useState<string[]>([...DIRECT_FIELD_CONFIG_DEFAULT])
  const [showManagedAuditLog, setShowManagedAuditLog] = useState(false)
  const [showManagedAddMenu, setShowManagedAddMenu] = useState(false)
  const [showManagedSingleAddDialog, setShowManagedSingleAddDialog] = useState(false)
  const [addManagedFundSearch, setAddManagedFundSearch] = useState("")
  const [addManagedFundSelected, setAddManagedFundSelected] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [addManagedFundResults, setAddManagedFundResults] = useState<{ beian_hao: string; product_name: string; short_name: string | null; strategy_one: string | null }[]>([])
  const [addManagedFundShowDropdown, setAddManagedFundShowDropdown] = useState(false)
  const [addManagedFundLoading, setAddManagedFundLoading] = useState(false)
  const [addManagedFundSaving, setAddManagedFundSaving] = useState(false)
  const [addManagedFundError, setAddManagedFundError] = useState<string | null>(null)
  const [managedDataReloadKey, setManagedDataReloadKey] = useState(0)
  const [managedRemoveDialog, setManagedRemoveDialog] = useState<{ id: string; product_name: string } | null>(null)
  const [managedRemoveSaving, setManagedRemoveSaving] = useState(false)
  const [managedRemoveError, setManagedRemoveError] = useState<string | null>(null)
  const addManagedFundSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [managedElementsDialog, setManagedElementsDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [managedPermissionDialog, setManagedPermissionDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [managedNoteDialog, setManagedNoteDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [managedSyncNavDialog, setManagedSyncNavDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [managedScaleDialog, setManagedScaleDialog] = useState<{ beian_hao: string; product_name: string } | null>(null)
  const [hoverChartRow, setHoverChartRow] = useState<string | null>(null)
  const [hoverChartPos, setHoverChartPos] = useState<{ x: number; y: number } | null>(null)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

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
  }, [strategySource, strategyL1, teamTagMode, teamTags.join("\u0001"), runStatus, keyword, pageSize])

  useEffect(() => {
    setLoading(true)
    const params = buildManagedProductsListParams({
      page, pageSize, strategySource, runStatus, teamTagMode, keyword,
      sortKey, sortDir, strategyL1, teamTags,
    })
    fetchManagedProductsList(params)
      .then(({ data: rows, total: n }) => {
        setData(rows)
        setTotal(n)
        setSelected(new Set())
      })
      .catch(() => {
        setData([])
        setTotal(0)
        setSelected(new Set())
      })
      .finally(() => setLoading(false))
  }, [page, pageSize, strategySource, strategyL1, teamTagMode, teamTags, runStatus, keyword, sortKey, sortDir, managedDataReloadKey])

  useEffect(() => {
    if (!showManagedSingleAddDialog) return
    if (!addManagedFundSearch.trim()) {
      setAddManagedFundResults([])
      setAddManagedFundShowDropdown(false)
      return
    }
    if (addManagedFundSearchRef.current) clearTimeout(addManagedFundSearchRef.current)
    addManagedFundSearchRef.current = setTimeout(async () => {
      setAddManagedFundLoading(true)
      try {
        const res = await fetch(`/ma/api/tracking-funds/search?q=${encodeURIComponent(addManagedFundSearch.trim())}`)
        const json = await res.json()
        setAddManagedFundResults(Array.isArray(json) ? json : [])
        setAddManagedFundShowDropdown(true)
      } catch {
        setAddManagedFundResults([])
      } finally {
        setAddManagedFundLoading(false)
      }
    }, 250)
    return () => {
      if (addManagedFundSearchRef.current) clearTimeout(addManagedFundSearchRef.current)
    }
  }, [addManagedFundSearch, showManagedSingleAddDialog])

  function openManagedSingleAddDialog() {
    setShowManagedAddMenu(false)
    setAddManagedFundSearch("")
    setAddManagedFundSelected(null)
    setAddManagedFundResults([])
    setAddManagedFundShowDropdown(false)
    setAddManagedFundError(null)
    setShowManagedSingleAddDialog(true)
  }

  function toggleTeamTag(tag: string) {
    setTeamTags((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])
  }

  function handleSort(col: ManagedSortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("desc") }
    setPage(1)
  }

  function ManagedSortIcon({ col }: { col: ManagedSortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function toggleAll() {
    if (selected.size === data.length && data.length > 0) setSelected(new Set())
    else setSelected(new Set(data.map((r) => r.id)))
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
    const rows = selected.size > 0 ? data.filter((r) => selected.has(r.id)) : data
    const headers = ["产品名称", "备案编码", "单位净值", "净值日期", "涨跌幅", "托管户余额", "资产净值", "估值表日期"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.short_name || r.product_name), escape(r.beian_hao), escape(r.latest_nav),
        escape(r.latest_nav_date), escape(r.latest_price_change), escape(r.custody_balance),
        escape(r.net_asset_value), escape(r.valuation_date),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `在管产品_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"
  const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
        <div className="flex items-start px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">一级策略：</span>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <select
                value={strategySource}
                onChange={(e) => {
                  const next = e.target.value as "company" | "platform"
                  if (strategySource === next) return
                  setStrategySource(next)
                  setStrategyL1("")
                  setPage(1)
                }}
                className="h-7 min-w-[6.25rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="company">团队策略</option>
                <option value="platform">平台策略</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            </div>
            <span
              onClick={() => { setStrategyL1(""); setPage(1) }}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                !strategyL1
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              不限
            </span>
            {strategyHierarchy.map((node) => (
              <span
                key={node.l1}
                onClick={() => { setStrategyL1(strategyL1 === node.l1 ? "" : node.l1); setPage(1) }}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                  strategyL1 === node.l1
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                    : "border-border text-zinc-500 hover:bg-muted/60",
                ].join(" ")}
              >
                {node.l1}
              </span>
            ))}
            <span
              onClick={() => { setStrategyL1(strategyL1 === "__unconfigured__" ? "" : "__unconfigured__"); setPage(1) }}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                strategyL1 === "__unconfigured__"
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                  : "border-border text-zinc-500 hover:bg-muted/60",
              ].join(" ")}
            >
              策略未配置
            </span>
          </div>
        </div>
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">团队标签：</span>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <select
                value={teamTagMode}
                onChange={(e) => { setTeamTagMode(e.target.value as "and" | "or"); setPage(1) }}
                className="h-7 min-w-[5.75rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="and">交集（且）</option>
                <option value="or">并集（或）</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            </div>
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
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">运行状态：</span>
          <div className="flex items-center gap-1">
            {([["running", "运行中"], ["liquidated", "已清盘"]] as const).map(([st, label]) => (
              <span
                key={st}
                onClick={() => { setRunStatus(st); setPage(1) }}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                  runStatus === st
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
              placeholder="请输入产品/产品备案号，按回车搜索"
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

      <div className="flex items-center justify-end gap-3 mb-3 flex-shrink-0 text-xs text-zinc-600">
        <button onClick={() => setShowManagedAuditLog(true)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
          <ClipboardList className="h-3.5 w-3.5" /> 操作日志
        </button>
        <button disabled={selected.size === 0} className="inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground">
          批量上传要素
        </button>
        <button onClick={() => setShowManagedFieldConfig(true)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
          <Settings2 className="h-3.5 w-3.5" /> 字段配置
        </button>
        <button onClick={handleExport} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
          <Download className="h-3.5 w-3.5" /> 导出
        </button>
        <button disabled={selected.size === 0} className="inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground">
          批量操作
          {selected.size > 0 && <span className="text-red-500">({selected.size})</span>}
        </button>
        <div className="relative">
          <button
            onClick={() => setShowManagedAddMenu((v) => !v)}
            className="inline-flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white rounded px-3 py-1.5 font-medium transition-colors"
          >
            添加产品
          </button>
          {showManagedAddMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowManagedAddMenu(false)} />
              <div
                className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[100px]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={openManagedSingleAddDialog}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  单只添加
                </button>
                <button
                  type="button"
                  onClick={() => setShowManagedAddMenu(false)}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  批量添加
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="overflow-auto rounded-lg border flex-1 min-h-0">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1100 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
              <th className={`${thBase} w-8 px-2`}>
                <input type="checkbox" className="rounded h-3 w-3" checked={selected.size === data.length && data.length > 0} onChange={toggleAll} />
              </th>
              <th className={`${thBase} w-10`}>序号</th>
              <th className={`${thSort} min-w-[160px]`} onClick={() => handleSort("product_name")}>产品名称<ManagedSortIcon col="product_name" /></th>
              <th className={`${thBase} min-w-[90px]`}>备案编码</th>
              <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("latest_nav")}>单位净值<ManagedSortIcon col="latest_nav" /></th>
              <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("latest_nav_date")}>净值日期<ManagedSortIcon col="latest_nav_date" /></th>
              <th className={`${thSort} text-right min-w-[80px]`} onClick={() => handleSort("latest_price_change")}>涨跌幅<ManagedSortIcon col="latest_price_change" /></th>
              <th className={`${thSort} text-right min-w-[100px]`} onClick={() => handleSort("custody_balance")}>托管户余额<ManagedSortIcon col="custody_balance" /></th>
              <th className={`${thSort} text-right min-w-[120px]`} onClick={() => handleSort("net_asset_value")}>资产净值<ManagedSortIcon col="net_asset_value" /></th>
              <th className={`${thBase} min-w-[100px]`}>估值表日期</th>
              <th className={`${thBase} text-center w-20`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : data.map((row, i) => {
              const isSelected = selected.has(row.id)
              const cell = `border-b px-3 py-2 ${isSelected ? "bg-blue-50 dark:bg-blue-950/40" : ""} group-hover:bg-muted transition-colors`
              return (
                <tr key={row.id} className="group">
                  <td className={`${cell} px-2 text-center`}>
                    <input type="checkbox" className="rounded h-3 w-3" checked={isSelected}
                      onChange={() => {
                        const s = new Set(selected)
                        isSelected ? s.delete(row.id) : s.add(row.id)
                        setSelected(s)
                      }} />
                  </td>
                  <td className={`${cell} text-center tabular-nums text-muted-foreground`}>{(page - 1) * pageSize + i + 1}</td>
                  <td className={cell}>
                    <FundProductNameLink
                      beian_hao={row.beian_hao}
                      product_name={row.product_name}
                      short_name={row.short_name}
                    />
                    {row.strategy_l1 && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] border border-zinc-300/80 text-zinc-600 bg-zinc-50 dark:bg-zinc-800/50 dark:text-zinc-400">
                        {row.strategy_l1}
                      </span>
                    )}
                  </td>
                  <td className={`${cell} tabular-nums text-muted-foreground`}>{row.beian_hao ?? "—"}</td>
                  <td className={`${cell} tabular-nums`}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium">{row.latest_nav ? parseFloat(row.latest_nav).toFixed(4) : "—"}</span>
                      {row.latest_nav && (
                        <span className="inline-block px-1 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800">团队</span>
                      )}
                    </div>
                  </td>
                  <td className={`${cell} tabular-nums`}>{row.latest_nav_date ?? "—"}</td>
                  <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.latest_price_change} /></td>
                  <td className={`${cell} text-right tabular-nums`}>{fmtMoney(row.custody_balance)}</td>
                  <td className={`${cell} text-right tabular-nums font-medium`}>{fmtMoney(row.net_asset_value)}</td>
                  <td className={`${cell} tabular-nums`}>{row.valuation_date ?? "—"}</td>
                  <td className={`${cell} text-center`}>
                    <div className="flex items-center justify-center gap-4">
                      {row.beian_hao && (
                        <div
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
                          }}>
                          <button type="button" className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                            <LineChart className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                      <OpsProductRowMenu
                        rowKey={row.id}
                        openRowMenu={openRowMenu}
                        onOpenChange={setOpenRowMenu}
                        beian_hao={row.beian_hao}
                        onElementsManage={() => setManagedElementsDialog({ beian_hao: row.beian_hao!, product_name: row.product_name })}
                        onPermissionManage={() => setManagedPermissionDialog({ beian_hao: row.beian_hao!, product_name: row.product_name })}
                        onNoteManage={() => setManagedNoteDialog({ beian_hao: row.beian_hao!, product_name: row.product_name })}
                        onScaleManage={() => setManagedScaleDialog({ beian_hao: row.beian_hao!, product_name: row.product_name })}
                        extraItems={[{
                          label: "同步净值",
                          icon: RefreshCw,
                          onClick: () => setManagedSyncNavDialog({ beian_hao: row.beian_hao!, product_name: row.product_name }),
                        }]}
                        footerItems={[{
                          label: "移出列表",
                          icon: MinusCircle,
                          destructive: true,
                          onClick: () => {
                            setManagedRemoveError(null)
                            setManagedRemoveDialog({ id: row.id, product_name: row.product_name })
                          },
                        }]}
                      />
                    </div>
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
          <div className="fixed z-50 bg-background border rounded-lg shadow-xl pointer-events-none"
            style={{ left, top }}
            onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current) }}
            onMouseLeave={() => setHoverChartRow(null)}>
            <TrendHoverChart beian_hao={hoverChartRow} productName={data.find((r) => r.beian_hao === hoverChartRow)?.product_name ?? ""} />
          </div>
        )
      })()}

      <div className="flex items-center justify-between pt-3 flex-shrink-0">
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
          <div className="relative ml-3">
            <select value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-7 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring">
              {[50, 100, 200].map((n) => <option key={n} value={n}>{n} 条/页</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>

      <DirectFieldConfigDialog
        open={showManagedFieldConfig}
        selected={managedFieldConfigSelected}
        onClose={() => setShowManagedFieldConfig(false)}
        onConfirm={(fields) => { setManagedFieldConfigSelected(fields); setShowManagedFieldConfig(false) }}
      />
      <OpsAuditLogDialog open={showManagedAuditLog} onClose={() => setShowManagedAuditLog(false)} />
      <OpsEditElementsDialog
        open={!!managedElementsDialog}
        beian_hao={managedElementsDialog?.beian_hao ?? null}
        product_name={managedElementsDialog?.product_name ?? ""}
        onClose={() => setManagedElementsDialog(null)}
      />
      <OpsPermissionDialog
        open={!!managedPermissionDialog}
        beian_hao={managedPermissionDialog?.beian_hao ?? null}
        product_name={managedPermissionDialog?.product_name ?? ""}
        onClose={() => setManagedPermissionDialog(null)}
      />
      <OpsTeamNoteDialog
        open={!!managedNoteDialog}
        beian_hao={managedNoteDialog?.beian_hao ?? null}
        product_name={managedNoteDialog?.product_name ?? ""}
        onClose={() => setManagedNoteDialog(null)}
      />
      <OpsSyncNavDialog
        open={!!managedSyncNavDialog}
        beian_hao={managedSyncNavDialog?.beian_hao ?? null}
        product_name={managedSyncNavDialog?.product_name ?? ""}
        onClose={() => setManagedSyncNavDialog(null)}
      />
      <OpsScaleManageDialog
        open={!!managedScaleDialog}
        beian_hao={managedScaleDialog?.beian_hao ?? null}
        product_name={managedScaleDialog?.product_name ?? ""}
        onClose={() => setManagedScaleDialog(null)}
      />

      {showManagedSingleAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowManagedSingleAddDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[560px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">添加在管产品</span>
              <button type="button" onClick={() => setShowManagedSingleAddDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5">
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-[4.5rem] text-right pt-2"><span className="text-red-500 mr-0.5">*</span>选择基金：</span>
                <div className="flex flex-1 flex-col gap-0 relative">
                  {addManagedFundSelected ? (
                    <div className="flex items-center justify-between border rounded px-3 h-9">
                      <div className="flex flex-col leading-tight min-w-0">
                        <span className="text-sm font-medium truncate">{addManagedFundSelected.product_name}</span>
                        <span className="text-xs text-muted-foreground truncate">{addManagedFundSelected.beian_hao}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setAddManagedFundSelected(null); setAddManagedFundSearch(""); setAddManagedFundShowDropdown(false) }}
                        className="text-muted-foreground hover:text-foreground text-base leading-none ml-2 shrink-0"
                      >×</button>
                    </div>
                  ) : (
                    <div className="flex items-center border rounded px-3 h-9 gap-2">
                      <input
                        autoFocus
                        type="text"
                        value={addManagedFundSearch}
                        onChange={(e) => { setAddManagedFundSearch(e.target.value); setAddManagedFundSelected(null) }}
                        onFocus={() => { if (addManagedFundResults.length > 0) setAddManagedFundShowDropdown(true) }}
                        placeholder="搜索并选择基金，支持基金名称/备案编号"
                        className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50"
                      />
                      {addManagedFundLoading
                        ? <svg className="h-3.5 w-3.5 animate-spin text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round"/></svg>
                        : <ChevronDown className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                      }
                    </div>
                  )}
                  {addManagedFundShowDropdown && addManagedFundResults.length > 0 && !addManagedFundSelected && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-xl max-h-56 overflow-y-auto">
                      {addManagedFundResults.map((r) => (
                        <button
                          key={r.beian_hao}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setAddManagedFundSelected({ beian_hao: r.beian_hao, product_name: r.product_name })
                            setAddManagedFundSearch("")
                            setAddManagedFundShowDropdown(false)
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-muted transition-colors flex items-center justify-between gap-3"
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="text-sm truncate">{r.product_name}</span>
                            <span className="text-xs text-muted-foreground truncate">{r.beian_hao}{r.short_name ? ` · ${r.short_name}` : ""}</span>
                          </div>
                          {r.strategy_one && (
                            <span className="text-xs text-zinc-400 shrink-0 border rounded px-1 py-0.5">{r.strategy_one}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {addManagedFundShowDropdown && addManagedFundResults.length === 0 && !addManagedFundLoading && addManagedFundSearch.trim() && !addManagedFundSelected && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-xl px-4 py-3 text-sm text-muted-foreground">
                      未找到匹配的基金
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 px-6 py-4 border-t flex-shrink-0">
              {addManagedFundError && (
                <p className="text-xs text-red-500 text-right">
                  {addManagedFundError === "already_exists"
                    ? "该基金已在在管产品列表中"
                    : addManagedFundError === "permission_denied"
                      ? "添加失败：数据库账号无写入权限，请联系管理员执行 scripts/db/008_grant_managed_products_write.sql"
                      : `添加失败：${addManagedFundError}`}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowManagedSingleAddDialog(false)}
                  disabled={addManagedFundSaving}
                  className="px-4 py-2 text-sm border rounded hover:bg-muted transition-colors disabled:opacity-50"
                >
                  取 消
                </button>
                <button
                  type="button"
                  disabled={!addManagedFundSelected || addManagedFundSaving}
                  onClick={async () => {
                    if (!addManagedFundSelected) return
                    setAddManagedFundSaving(true)
                    setAddManagedFundError(null)
                    try {
                      const res = await fetch("/ma/api/ops/managed-products/add", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          beian_hao: addManagedFundSelected.beian_hao,
                          product_name: addManagedFundSelected.product_name,
                        }),
                      })
                      const json = await res.json()
                      if (!res.ok) {
                        setAddManagedFundError(json.error || "unknown")
                        return
                      }
                      setShowManagedSingleAddDialog(false)
                      setManagedDataReloadKey((k) => k + 1)
                    } catch {
                      setAddManagedFundError("network_error")
                    } finally {
                      setAddManagedFundSaving(false)
                    }
                  }}
                  className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addManagedFundSaving ? "保存中…" : "确 定"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {managedRemoveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !managedRemoveSaving && setManagedRemoveDialog(null)}>
          <div className="bg-background rounded-lg shadow-xl w-[360px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-5">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <div>
                <p className="font-semibold text-sm mb-1">移出在管产品</p>
                <p className="text-sm text-zinc-500">确定要将「{managedRemoveDialog.product_name}」从在管产品列表中移出吗？</p>
              </div>
            </div>
            {managedRemoveError && (
              <p className="text-xs text-red-500 mb-3 text-right">
                {managedRemoveError === "permission_denied"
                  ? "移出失败：数据库账号无写入权限"
                  : managedRemoveError === "not_found"
                    ? "该产品不存在或已被移出"
                    : `移出失败：${managedRemoveError}`}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setManagedRemoveDialog(null)}
                disabled={managedRemoveSaving}
                className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors disabled:opacity-50"
              >
                取 消
              </button>
              <button
                type="button"
                disabled={managedRemoveSaving}
                onClick={async () => {
                  setManagedRemoveSaving(true)
                  setManagedRemoveError(null)
                  try {
                    const res = await fetch("/ma/api/ops/managed-products/remove", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: managedRemoveDialog.id }),
                    })
                    const json = await res.json()
                    if (!res.ok) {
                      setManagedRemoveError(json.error || "unknown")
                      return
                    }
                    setManagedRemoveDialog(null)
                    setManagedDataReloadKey((k) => k + 1)
                  } catch {
                    setManagedRemoveError("network_error")
                  } finally {
                    setManagedRemoveSaving(false)
                  }
                }}
                className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {managedRemoveSaving ? "处理中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── InvestmentManagedProductsView ───────────────────────────────────────────

type InvManagedSortKey =
  | ManagedSortKey
  | "ret_1w" | "ret_1m" | "ret_3m" | "ret_6m" | "ret_1y" | "sharpe_1y" | "calmar_1y"

function InvestmentManagedProductsView() {
  const [strategySource, setStrategySource] = useState<"company" | "platform">("company")
  const [strategyHierarchy, setStrategyHierarchy] = useState<TrackStrategyNode[]>([])
  const [strategyL1, setStrategyL1] = useState("")
  const [teamTagMode, setTeamTagMode] = useState<"and" | "or">("and")
  const [teamTagOptions, setTeamTagOptions] = useState<string[]>([])
  const [teamTags, setTeamTags] = useState<string[]>([])
  const [runStatus, setRunStatus] = useState<"running" | "liquidated">("running")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [cutoffDate, setCutoffDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showInterval, setShowInterval] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showInvFieldConfig, setShowInvFieldConfig] = useState(false)
  const [invFieldConfigSelected, setInvFieldConfigSelected] = useState<string[]>([...DIRECT_FIELD_CONFIG_DEFAULT])
  const [showInvAddMetric, setShowInvAddMetric] = useState(false)
  const [invAddedCols, setInvAddedCols] = useState<AddedCol[]>([])
  const [showInvTemplateMenu, setShowInvTemplateMenu] = useState(false)
  const [invMetricTemplates, setInvMetricTemplates] = useState<{ name: string; items: { period: string; metric: string }[] }[]>(() => loadTrackingMetricTemplates())
  const [invActiveTemplate, setInvActiveTemplate] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<InvManagedSortKey | "">("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState<ManagedProductRow[]>([])
  const [total, setTotal] = useState(0)
  const [totalNetAssetValue, setTotalNetAssetValue] = useState("0")
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hoverChartRow, setHoverChartRow] = useState<string | null>(null)
  const [hoverChartPos, setHoverChartPos] = useState<{ x: number; y: number } | null>(null)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showInvElementsDialog, setShowInvElementsDialog] = useState(false)
  const [invElementsBeianHao, setInvElementsBeianHao] = useState<string | null>(null)
  const [invElementsName, setInvElementsName] = useState("")
  const [invElementsData, setInvElementsData] = useState<Record<string, string | null> | null>(null)
  const [invElementsLoading, setInvElementsLoading] = useState(false)
  const [showInvTagDialog, setShowInvTagDialog] = useState(false)
  const [invTagBeianHao, setInvTagBeianHao] = useState<string | null>(null)
  const [invTagName, setInvTagName] = useState("")
  const [invTagSelected, setInvTagSelected] = useState<string[]>([])
  const [invTagTeamTags, setInvTagTeamTags] = useState<string[]>([])
  const [invTagSaving, setInvTagSaving] = useState(false)
  const [showInvStrategyDialog, setShowInvStrategyDialog] = useState(false)
  const [invStrategyBeianHao, setInvStrategyBeianHao] = useState<string | null>(null)
  const [invStrategyName, setInvStrategyName] = useState("")
  const [invStrategyL1, setInvStrategyL1] = useState("")
  const [invStrategyL2, setInvStrategyL2] = useState("")
  const [invStrategyL3, setInvStrategyL3] = useState("")
  const [invStrategySaving, setInvStrategySaving] = useState(false)
  const [showInvNoteDialog, setShowInvNoteDialog] = useState(false)
  const [invNoteBeianHao, setInvNoteBeianHao] = useState<string | null>(null)
  const [invNoteName, setInvNoteName] = useState("")
  const [invNoteText, setInvNoteText] = useState("")
  const [invNoteSaving, setInvNoteSaving] = useState(false)
  const [showInvBatchMenu, setShowInvBatchMenu] = useState(false)
  const [showInvBatchTagDialog, setShowInvBatchTagDialog] = useState(false)
  const [invBatchTagSelected, setInvBatchTagSelected] = useState<string[]>([])
  const [invBatchTagTeamTags, setInvBatchTagTeamTags] = useState<string[]>([])
  const [showInvBatchStrategyDialog, setShowInvBatchStrategyDialog] = useState(false)
  const [invBatchStrategyL1, setInvBatchStrategyL1] = useState("")
  const [invBatchStrategyL2, setInvBatchStrategyL2] = useState("")
  const [invBatchStrategyL3, setInvBatchStrategyL3] = useState("")
  const [showInvBatchConfirmDialog, setShowInvBatchConfirmDialog] = useState(false)
  const [invBatchConfirmTitle, setInvBatchConfirmTitle] = useState("")
  const [invBatchConfirmMessage, setInvBatchConfirmMessage] = useState("")
  const [invBatchConfirmAction, setInvBatchConfirmAction] = useState<"remove_strategy" | "remove_tags" | "">("")
  const [invBatchSubmitting, setInvBatchSubmitting] = useState(false)
  const [invDataReloadKey, setInvDataReloadKey] = useState(0)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const invSelectedBeianCount = data.filter((r) => selected.has(r.id) && r.beian_hao).length

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
  }, [strategySource, strategyL1, teamTagMode, teamTags.join("\u0001"), runStatus, keyword, pageSize, cutoffDate])

  useEffect(() => {
    setLoading(true)
    const params = buildManagedProductsListParams({
      page, pageSize, strategySource, runStatus, teamTagMode, keyword,
      sortKey, sortDir, strategyL1, teamTags, cutoff: cutoffDate,
    })
    fetchManagedProductsList(params)
      .then(({ data: rows, total: n, totalNetAssetValue: navTotal }) => {
        setData(rows)
        setTotal(n)
        setTotalNetAssetValue(navTotal)
        setSelected(new Set())
      })
      .catch(() => {
        setData([])
        setTotal(0)
        setTotalNetAssetValue("0")
        setSelected(new Set())
      })
      .finally(() => setLoading(false))
  }, [page, pageSize, strategySource, strategyL1, teamTagMode, teamTags, runStatus, keyword, sortKey, sortDir, cutoffDate, invDataReloadKey])

  async function handleInvBatchOp(action: string, extra: Record<string, unknown> = {}) {
    const beian_haos = data.filter((r) => selected.has(r.id) && r.beian_hao).map((r) => r.beian_hao!)
    if (beian_haos.length === 0) return
    setInvBatchSubmitting(true)
    try {
      const res = await fetch("/ma/api/tracking-funds/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, beian_haos, ...extra }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error("[inv batch op]", err)
      }
    } catch (err) {
      console.error("[inv batch op]", err)
    } finally {
      setInvBatchSubmitting(false)
      setSelected(new Set())
      setInvDataReloadKey((k) => k + 1)
    }
  }

  useEffect(() => {
    if (!showInvElementsDialog || !invElementsBeianHao) return
    setInvElementsData(null)
    setInvElementsLoading(true)
    fetch(`/ma/api/tracking-funds/fund-elements?beian_hao=${encodeURIComponent(invElementsBeianHao)}`)
      .then((r) => r.json())
      .then((d) => { setInvElementsData(d); setInvElementsLoading(false) })
      .catch(() => setInvElementsLoading(false))
  }, [showInvElementsDialog, invElementsBeianHao])

  async function openInvElementsDialog(beian_hao: string | null, product_name: string) {
    setInvElementsBeianHao(beian_hao)
    setInvElementsName(product_name)
    setShowInvElementsDialog(true)
  }

  async function openInvTagDialog(beian_hao: string | null, product_name: string) {
    if (!beian_hao) return
    setInvTagBeianHao(beian_hao)
    setInvTagName(product_name)
    setInvTagSelected([])
    setInvTagTeamTags([])
    setShowInvTagDialog(true)
    const [tagsRes, teamTagsRes] = await Promise.all([
      fetch(`/ma/api/tracking-funds/fund-tags?beian_hao=${encodeURIComponent(beian_hao)}`).then((r) => r.json()).catch(() => []),
      fetch("/ma/api/ops/team-tags?category=fund").then((r) => r.json()).catch(() => []),
    ])
    if (Array.isArray(tagsRes)) setInvTagSelected(tagsRes)
    if (Array.isArray(teamTagsRes)) setInvTagTeamTags(teamTagsRes.map((t: { name: string }) => t.name))
  }

  async function openInvStrategyDialog(beian_hao: string | null, product_name: string) {
    if (!beian_hao) return
    setInvStrategyBeianHao(beian_hao)
    setInvStrategyName(product_name)
    setInvStrategyL1("")
    setInvStrategyL2("")
    setInvStrategyL3("")
    setShowInvStrategyDialog(true)
    try {
      const res = await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}`)
      const d = await res.json()
      if (d?.strategy_l1) setInvStrategyL1(d.strategy_l1)
      if (d?.strategy_l2) setInvStrategyL2(d.strategy_l2)
      if (d?.strategy_l3) setInvStrategyL3(d.strategy_l3)
    } catch { /* ignore */ }
  }

  async function openInvNoteDialog(beian_hao: string | null, product_name: string) {
    if (!beian_hao) return
    setInvNoteBeianHao(beian_hao)
    setInvNoteName(product_name)
    setInvNoteText("")
    setShowInvNoteDialog(true)
    try {
      const res = await fetch(`/ma/api/tracking-funds/fund-note?beian_hao=${encodeURIComponent(beian_hao)}`)
      const d = await res.json()
      setInvNoteText(d.note ?? "")
    } catch { /* ignore */ }
  }

  function toggleTeamTag(tag: string) {
    setTeamTags((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])
  }

  function handleSort(col: InvManagedSortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("desc") }
    setPage(1)
  }

  function InvSortIcon({ col }: { col: InvManagedSortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function toggleAll() {
    if (selected.size === data.length && data.length > 0) setSelected(new Set())
    else setSelected(new Set(data.map((r) => r.id)))
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
    const rows = selected.size > 0 ? data.filter((r) => selected.has(r.id)) : data
    const headers = ["产品名称", "备案编码", "最新净值日期", "最新单位净值", "最新周涨幅", "托管账户余额", "资产净值", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普比率", "近一年卡玛比率"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.short_name || r.product_name), escape(r.beian_hao), escape(r.latest_nav_date),
        escape(r.latest_nav), escape(r.latest_price_change), escape(r.custody_balance),
        escape(r.net_asset_value), escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m),
        escape(r.ret_6m), escape(r.ret_1y), escape(r.sharpe_1y), escape(r.calmar_1y),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `在管产品_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const colSpan = 18 + invAddedCols.length
  const invStickyHeadBg = "bg-muted dark:bg-zinc-900"
  const invStickyCellBg = "bg-background dark:bg-background"
  const invStickyHeadZ = "z-40"
  const invStickyBodyZ = "z-20"
  const invStickyLeftShadow = "shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)] dark:shadow-[4px_0_8px_-4px_rgba(0,0,0,0.35)]"
  const invStickyRightShadow = "shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)] dark:shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.35)]"
  const invStickyRightColW = 64
  const invStickyRight = { ops: 0, docs: invStickyRightColW, trend: invStickyRightColW * 2 }
  const invStickyRightColStyle = (right: number): CSSProperties => ({
    right,
    width: invStickyRightColW,
    minWidth: invStickyRightColW,
    maxWidth: invStickyRightColW,
  })
  const invStickyRightTh = `sticky top-0 ${invStickyHeadZ} ${invStickyHeadBg} text-center text-xs font-semibold text-zinc-500 dark:text-zinc-400 whitespace-nowrap select-none px-2 py-3 overflow-hidden`
  const invStickyRightTd = `sticky ${invStickyBodyZ} text-center px-2 overflow-hidden box-border`

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
        <div className="flex items-start px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">一级策略：</span>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <div className="relative">
              <select
                value={strategySource}
                onChange={(e) => {
                  const next = e.target.value as "company" | "platform"
                  if (strategySource === next) return
                  setStrategySource(next)
                  setStrategyL1("")
                  setPage(1)
                }}
                className="h-7 min-w-[6.25rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="company">团队策略</option>
                <option value="platform">平台策略</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            </div>
            <span
              onClick={() => { setStrategyL1(""); setPage(1) }}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                !strategyL1
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              不限
            </span>
            {strategyHierarchy.map((node) => (
              <span
                key={node.l1}
                onClick={() => { setStrategyL1(strategyL1 === node.l1 ? "" : node.l1); setPage(1) }}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                  strategyL1 === node.l1
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                    : "border-border text-zinc-500 hover:bg-muted/60",
                ].join(" ")}
              >
                {node.l1}
              </span>
            ))}
            <span
              onClick={() => { setStrategyL1(strategyL1 === "__unconfigured__" ? "" : "__unconfigured__"); setPage(1) }}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                strategyL1 === "__unconfigured__"
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                  : "border-border text-zinc-500 hover:bg-muted/60",
              ].join(" ")}
            >
              策略未配置
            </span>
          </div>
        </div>
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">团队标签：</span>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <div className="relative">
              <select
                value={teamTagMode}
                onChange={(e) => { setTeamTagMode(e.target.value as "and" | "or"); setPage(1) }}
                className="h-7 min-w-[5.75rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="and">交集（且）</option>
                <option value="or">并集（或）</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            </div>
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
        <div className="flex items-center px-4 py-2 gap-4">
          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">运行状态：</span>
            <div className="flex items-center gap-1">
              {([["running", "运行中"], ["liquidated", "已清盘"]] as const).map(([st, label]) => (
                <span
                  key={st}
                  onClick={() => { setRunStatus(st); setPage(1) }}
                  className={[
                    "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                    runStatus === st
                      ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                      : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                  ].join(" ")}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">关 键 字：</span>
          <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-80">
            <input
              className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
              placeholder="请输入产品/产品备案号，按回车搜索"
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

      <div className="relative z-50 flex items-center justify-between gap-1.5 mb-3 flex-shrink-0 text-xs">
        <div className="flex items-center gap-1.5 text-zinc-600">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">指标计算截止日期</span>
          <div className="relative">
            <button
              onClick={() => setShowDatePicker((v) => !v)}
              className="inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-zinc-600 hover:bg-muted cursor-pointer transition-colors">
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
        <div className="flex items-center gap-1.5">
        <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
          <input type="checkbox" defaultChecked className="rounded h-3 w-3 accent-zinc-700" />
          计算指标
        </label>
        <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
          <input type="checkbox" checked={showInterval} onChange={(e) => setShowInterval(e.target.checked)} className="rounded h-3 w-3 accent-zinc-700" />
          显示区间
        </label>
        <div className="relative">
          <button
            onClick={() => {
              setInvMetricTemplates(loadTrackingMetricTemplates())
              setShowInvTemplateMenu((v) => !v)
            }}
            className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
            <LayoutTemplate className="h-3 w-3" />
            {invActiveTemplate ?? "默认模板"}
            <ChevronDown className="h-3 w-3" />
          </button>
          {showInvTemplateMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowInvTemplateMenu(false)} />
              <div className="absolute left-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => { setInvAddedCols([]); setInvActiveTemplate(null); setShowInvTemplateMenu(false) }}
                  className={[
                    "w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2",
                    invActiveTemplate === null ? "bg-red-50 dark:bg-red-950/30" : "hover:bg-muted",
                  ].join(" ")}>
                  <LayoutTemplate className="h-3.5 w-3.5 text-zinc-400" /> 默认模板
                </button>
                {invMetricTemplates.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInvAddedCols(buildAddedColsFromItems(t.items))
                      setInvActiveTemplate(t.name)
                      setShowInvTemplateMenu(false)
                    }}
                    className={[
                      "w-full text-left px-4 py-2 text-sm transition-colors truncate",
                      invActiveTemplate === t.name ? "bg-red-50 dark:bg-red-950/30" : "hover:bg-muted",
                    ].join(" ")}>
                    {t.name}
                  </button>
                ))}
                <div className="border-t my-1" />
                <button
                  onClick={() => { setShowInvTemplateMenu(false); window.open("/ma/dashboard/settings?tab=metric-templates", "_blank") }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-red-500">
                  <Settings2 className="h-3.5 w-3.5" /> 管理模板
                </button>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setShowInvAddMetric(true)}
          className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
          <PlusCircle className="h-3 w-3" />
          {invAddedCols.length > 0 ? `添加指标(${invAddedCols.length})` : "添加指标"}
        </button>
        <div className="relative">
          <button
            disabled={selected.size === 0}
            onClick={() => setShowInvBatchMenu((v) => !v)}
            className="inline-flex items-center gap-1 border border-border/50 rounded px-2 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-zinc-600 hover:text-foreground hover:bg-muted/60 disabled:hover:bg-transparent disabled:hover:text-zinc-600">
            批量操作
            {selected.size > 0 && <span className="text-xs text-red-500">({selected.size})</span>}
          </button>
          {showInvBatchMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowInvBatchMenu(false)} />
              <div className="absolute left-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[130px]" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => {
                    setShowInvBatchMenu(false)
                    setInvBatchTagSelected([])
                    fetch("/ma/api/ops/team-tags?category=fund")
                      .then((r) => r.json())
                      .then((d) => Array.isArray(d) ? setInvBatchTagTeamTags(d.map((t: { name: string }) => t.name)) : setInvBatchTagTeamTags(teamTagOptions))
                      .catch(() => setInvBatchTagTeamTags(teamTagOptions))
                    setShowInvBatchTagDialog(true)
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">
                  批量添加标签
                </button>
                <button
                  onClick={() => {
                    setShowInvBatchMenu(false)
                    setInvBatchStrategyL1("")
                    setInvBatchStrategyL2("")
                    setInvBatchStrategyL3("")
                    setShowInvBatchStrategyDialog(true)
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">
                  批量添加策略
                </button>
                <button
                  onClick={() => {
                    setShowInvBatchMenu(false)
                    setInvBatchConfirmTitle("批量取消标签")
                    setInvBatchConfirmMessage(`确定要为已选 ${invSelectedBeianCount} 只产品批量清除所有标签吗？`)
                    setInvBatchConfirmAction("remove_tags")
                    setShowInvBatchConfirmDialog(true)
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">
                  批量取消标签
                </button>
                <button
                  onClick={() => {
                    setShowInvBatchMenu(false)
                    setInvBatchConfirmTitle("批量取消策略")
                    setInvBatchConfirmMessage(`确定要为已选 ${invSelectedBeianCount} 只产品批量取消策略吗？`)
                    setInvBatchConfirmAction("remove_strategy")
                    setShowInvBatchConfirmDialog(true)
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors">
                  批量取消策略
                </button>
              </div>
            </>
          )}
        </div>
        <div className="relative">
          <button
            onClick={() => setShowMoreMenu((v) => !v)}
            className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
            ⊕ 更多
          </button>
          {showMoreMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-lg py-1 min-w-[120px]" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { setShowMoreMenu(false); setShowInvFieldConfig(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                  <Settings2 className="h-3.5 w-3.5 text-zinc-400" /> 字段配置
                </button>
                <button onClick={() => { setShowMoreMenu(false); handleExport() }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                  <Download className="h-3.5 w-3.5 text-zinc-400" /> 导出
                </button>
              </div>
            </>
          )}
        </div>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border flex-1 min-h-0">
        <table className="text-sm border-separate border-spacing-0 w-full" style={{ minWidth: 1900 }}>
          <thead className="sticky top-0 z-30">
            <tr className="border-b">
              <th className={`${thBase} px-2 sticky top-0 left-0 ${invStickyHeadZ} ${invStickyHeadBg} w-8 box-border`}>
                <input type="checkbox" className="rounded h-3 w-3" checked={selected.size === data.length && data.length > 0} onChange={toggleAll} />
              </th>
              <th className={`${thBase} sticky top-0 left-8 ${invStickyHeadZ} ${invStickyHeadBg} w-10 box-border`}>序号</th>
              <th className={`${thSort} min-w-[200px] max-w-[200px] sticky top-0 left-[72px] ${invStickyHeadZ} ${invStickyHeadBg} box-border border-r border-zinc-200 dark:border-zinc-700 ${invStickyLeftShadow}`} onClick={() => handleSort("product_name")}>产品名称<InvSortIcon col="product_name" /></th>
              <th className={`${thSort} min-w-[100px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("latest_nav_date")}>最新净值日期<InvSortIcon col="latest_nav_date" /></th>
              <th className={`${thSort} min-w-[100px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("latest_nav")}>最新单位净值<InvSortIcon col="latest_nav" /></th>
              <th className={`${thSort} text-right min-w-[88px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("latest_price_change")}>最新周涨幅<InvSortIcon col="latest_price_change" /></th>
              <th className={`${thSort} text-right min-w-[110px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("custody_balance")}>托管账户余额<InvSortIcon col="custody_balance" /></th>
              <th className={`${thSort} text-right min-w-[120px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("net_asset_value")}>资产净值<InvSortIcon col="net_asset_value" /></th>
              <th className={`${thSort} text-right min-w-[88px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("ret_1w")}>
                <div>近一周收益<InvSortIcon col="ret_1w" /></div>
                {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 7)}</div>}
              </th>
              <th className={`${thSort} text-right min-w-[88px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("ret_1m")}>
                <div>近一月收益<InvSortIcon col="ret_1m" /></div>
                {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 30)}</div>}
              </th>
              <th className={`${thSort} text-right min-w-[88px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("ret_3m")}>
                <div>近三月收益<InvSortIcon col="ret_3m" /></div>
                {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 91)}</div>}
              </th>
              <th className={`${thSort} text-right min-w-[88px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("ret_6m")}>
                <div>近六月收益<InvSortIcon col="ret_6m" /></div>
                {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 182)}</div>}
              </th>
              <th className={`${thSort} text-right min-w-[88px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("ret_1y")}>
                <div>近一年收益<InvSortIcon col="ret_1y" /></div>
                {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 365)}</div>}
              </th>
              <th className={`${thSort} text-right min-w-[98px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("sharpe_1y")}>近一年夏普比率<InvSortIcon col="sharpe_1y" /></th>
              <th className={`${thSort} text-right min-w-[98px] relative z-0 ${invStickyHeadBg}`} onClick={() => handleSort("calmar_1y")}>近一年卡玛比率<InvSortIcon col="calmar_1y" /></th>
              {invAddedCols.map((col) => (
                <th key={col.id} className={`${thBase} text-right min-w-[96px] relative z-0 ${invStickyHeadBg}`}>{col.label}</th>
              ))}
              <th style={invStickyRightColStyle(invStickyRight.trend)} className={`${invStickyRightTh} border-l border-zinc-200 dark:border-zinc-700 ${invStickyRightShadow}`}>走势</th>
              <th style={invStickyRightColStyle(invStickyRight.docs)} className={invStickyRightTh}>资料</th>
              <th style={invStickyRightColStyle(invStickyRight.ops)} className={invStickyRightTh}>操作</th>
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
            ) : (
              <>
                {data.map((row, i) => {
                  const isSelected = selected.has(row.id)
                  const rowBg = isSelected ? "bg-blue-50 dark:bg-blue-950/40" : invStickyCellBg
                  const hoverBg = isSelected ? "group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40" : "group-hover:bg-muted"
                  const cell = `border-b px-3 py-2 ${rowBg} ${hoverBg} transition-colors`
                  const stickyCell = `${cell} ${invStickyBodyZ}`
                  const stickyLeftProduct = `${stickyCell} sticky left-[72px] border-r border-zinc-200 dark:border-zinc-700 ${invStickyLeftShadow}`
                  const stickyRightTrend = `${invStickyRightTd} ${rowBg} ${hoverBg} transition-colors border-b border-l border-zinc-200 dark:border-zinc-700 ${invStickyRightShadow}`
                  const stickyRightDocs = `${invStickyRightTd} ${rowBg} ${hoverBg} transition-colors border-b text-muted-foreground`
                  const stickyRightOps = `${invStickyRightTd} ${rowBg} ${hoverBg} transition-colors border-b`
                  return (
                    <tr key={row.id} className="group" style={{ height: 52 }}>
                      <td className={`${stickyCell} px-2 text-center sticky left-0 w-8 box-border`}>
                        <input type="checkbox" className="rounded h-3 w-3" checked={isSelected}
                          onChange={() => {
                            const s = new Set(selected)
                            isSelected ? s.delete(row.id) : s.add(row.id)
                            setSelected(s)
                          }} />
                      </td>
                      <td className={`${stickyCell} text-center tabular-nums text-muted-foreground sticky left-8 w-10 box-border`}>{(page - 1) * pageSize + i + 1}</td>
                      <td className={stickyLeftProduct}>
                        <FundProductNameLink
                          beian_hao={row.beian_hao}
                          product_name={row.product_name}
                          short_name={row.short_name}
                          className="block max-w-[220px]"
                        />
                        {row.strategy_l1 && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50 flex-shrink-0" />
                            <span className="text-[10px] text-muted-foreground">{row.strategy_l1}</span>
                          </div>
                        )}
                      </td>
                      <td className={`${cell} tabular-nums`}>{row.latest_nav_date ?? "—"}</td>
                      <td className={`${cell} tabular-nums font-medium`}>{row.latest_nav ? parseFloat(row.latest_nav).toFixed(4) : "—"}</td>
                      <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.latest_price_change} /></td>
                      <td className={`${cell} text-right tabular-nums`}>{fmtMoney(row.custody_balance)}</td>
                      <td className={`${cell} text-right tabular-nums font-medium`}>{fmtMoney(row.net_asset_value)}</td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_1w ?? null} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 7)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_1m ?? null} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 30)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_3m ?? null} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 91)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_6m ?? null} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 182)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_1y ?? null} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 365)}</div>}
                      </td>
                      <td className={`${cell} text-right tabular-nums`}><TrackRatioCell value={row.sharpe_1y ?? null} /></td>
                      <td className={`${cell} text-right tabular-nums`}><TrackRatioCell value={row.calmar_1y ?? null} /></td>
                      {invAddedCols.map((col) => {
                        const val = col.dbKey ? (row as Record<string, string | null | undefined>)[col.dbKey] ?? null : null
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
                      <td style={invStickyRightColStyle(invStickyRight.trend)} className={stickyRightTrend}>
                        <div className="flex items-center justify-center"
                          onMouseEnter={(e) => {
                            if (!row.beian_hao) return
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
                          }}>
                          <button type="button" className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                            <LineChart className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td style={invStickyRightColStyle(invStickyRight.docs)} className={stickyRightDocs}>—</td>
                      <td style={invStickyRightColStyle(invStickyRight.ops)} className={stickyRightOps}>
                        <div className="flex items-center justify-center">
                          <InvestmentManagedProductRowMenu
                            onQueryElements={() => openInvElementsDialog(row.beian_hao, row.product_name)}
                            onEditTags={() => openInvTagDialog(row.beian_hao, row.product_name)}
                            onEditStrategy={() => openInvStrategyDialog(row.beian_hao, row.product_name)}
                            onNoteManage={() => openInvNoteDialog(row.beian_hao, row.product_name)}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr className="bg-muted font-medium">
                  <td className={`border-b px-2 py-2 sticky left-0 ${invStickyBodyZ} bg-muted w-8 box-border`} />
                  <td className={`border-b px-2 py-2 sticky left-8 ${invStickyBodyZ} bg-muted w-10 box-border`} />
                  <td className={`border-b px-3 py-2 text-zinc-600 sticky left-[72px] ${invStickyBodyZ} bg-muted border-r border-zinc-200 dark:border-zinc-700 ${invStickyLeftShadow}`}>合计</td>
                  <td className="border-b px-3 py-2 bg-muted" colSpan={4} />
                  <td className="border-b px-3 py-2 text-right tabular-nums bg-muted">{fmtMoney(totalNetAssetValue)}</td>
                  <td className="border-b px-3 py-2 bg-muted" colSpan={7} />
                  {invAddedCols.map((col) => (
                    <td key={col.id} className="border-b px-3 py-2 bg-muted" />
                  ))}
                  <td style={invStickyRightColStyle(invStickyRight.trend)} className={`border-b py-2 ${invStickyBodyZ} bg-muted border-l border-zinc-200 dark:border-zinc-700 ${invStickyRightShadow}`} />
                  <td style={invStickyRightColStyle(invStickyRight.docs)} className={`border-b py-2 ${invStickyBodyZ} bg-muted`} />
                  <td style={invStickyRightColStyle(invStickyRight.ops)} className={`border-b py-2 ${invStickyBodyZ} bg-muted`} />
                </tr>
              </>
            )}
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
          <div className="fixed z-50 bg-background border rounded-lg shadow-xl pointer-events-none"
            style={{ left, top }}
            onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current) }}
            onMouseLeave={() => setHoverChartRow(null)}>
            <TrendHoverChart beian_hao={hoverChartRow} productName={data.find((r) => r.beian_hao === hoverChartRow)?.product_name ?? ""} />
          </div>
        )
      })()}

      <div className="flex items-center justify-between pt-3 flex-shrink-0">
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
          <div className="relative ml-3">
            <select value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-7 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring">
              {[50, 100, 200].map((n) => <option key={n} value={n}>{n} 条/页</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>

      {showInvElementsDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowInvElementsDialog(false)}>
          <div className="bg-background rounded-lg shadow-2xl w-[780px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">产品要素</span>
              <button onClick={() => setShowInvElementsDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5">
              <h2 className="text-lg font-bold mb-5 pl-3 border-l-4 border-red-500">{invElementsName}</h2>
              {invElementsLoading && (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">加载中…</div>
              )}
              {!invElementsLoading && invElementsData && invElementsData.error && (
                <div className="text-sm text-muted-foreground py-8 text-center">暂无产品要素数据</div>
              )}
              {!invElementsLoading && invElementsData && !invElementsData.error && (() => {
                const d = invElementsData
                const val = (v: string | null | undefined) => v || "—"
                const Row2 = ({ l1, v1, l2, v2 }: { l1: string; v1?: string | null; l2?: string; v2?: string | null }) => (
                  <tr className="border-b border-border/50 last:border-0">
                    <td className="py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap">{l1}</td>
                    <td className="py-2 px-4 text-sm text-foreground">{val(v1)}</td>
                    {l2 !== undefined && <>
                      <td className="py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap">{l2}</td>
                      <td className="py-2 px-4 text-sm text-foreground">{val(v2)}</td>
                    </>}
                  </tr>
                )
                return (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                      <span className="text-sm font-semibold">基本信息</span>
                    </div>
                    <table className="w-full border border-border rounded-lg overflow-hidden mb-5 text-sm">
                      <tbody>
                        <Row2 l1="产品全称" v1={d.fund_name as string} l2="备案编号" v2={d.register_number as string} />
                        <Row2 l1="投资顾问" v1={d.advisor as string} l2="基金管理人" v2={d.fund_manager as string} />
                        <Row2 l1="成立日期" v1={d.inception_date as string} l2="备案日期" v2={d.puton_date as string} />
                        <tr className="border-b border-border/50 last:border-0">
                          <td className="py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap">托管券商</td>
                          <td className="py-2 px-4 text-sm text-foreground" colSpan={3}>{val(d.custodian as string)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                      <span className="text-sm font-semibold">申赎信息</span>
                    </div>
                    <table className="w-full border border-border rounded-lg overflow-hidden text-sm">
                      <tbody>
                        <Row2 l1="开放日" v1={d.open_day as string} l2="是否可临开" v2={d.is_temporary_open as string} />
                        <Row2 l1="申购费" v1={d.fee_purchase as string} l2="追加限制" v2={d.add_amount as string} />
                        <Row2 l1="赎回费" v1={d.fee_redeem as string} l2="风险等级" v2={null} />
                        <Row2 l1="预警线" v1={d.precautious_line as string} l2="封闭期" v2={d.closed_period as string} />
                        <Row2 l1="平仓线" v1={d.stop_line as string} l2="锁定期说明" v2={null} />
                        <Row2 l1="管理费率" v1={d.fee_manage_rate as string} l2="托管费" v2={d.fee_trust as string} />
                      </tbody>
                    </table>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {showInvTagDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvTagDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[560px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">跟踪产品编辑</span>
              <button onClick={() => setShowInvTagDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="font-semibold text-sm">{invTagName}</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-16 text-right pt-2 whitespace-nowrap">标签：</span>
                <div className="flex-1 flex flex-wrap gap-1 min-h-[36px] border rounded px-3 py-1.5">
                  {invTagSelected.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 bg-red-50 border border-red-300 text-red-500 rounded px-2 py-0.5 text-xs">
                      {t}
                      <button onClick={() => setInvTagSelected((p) => p.filter((x) => x !== t))} className="leading-none hover:text-red-700">×</button>
                    </span>
                  ))}
                  {invTagSelected.length === 0 && <span className="text-xs text-muted-foreground">请选择标签</span>}
                </div>
                <button onClick={() => setInvTagSelected([])} className="text-sm text-blue-500 hover:text-blue-600 shrink-0 pt-2">清空</button>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-16 text-right pt-1.5 whitespace-nowrap">团队标签：</span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-muted/30 rounded px-3 py-2">
                  {invTagTeamTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setInvTagSelected((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                      className={[
                        "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                        invTagSelected.includes(tag)
                          ? "bg-red-50 text-red-500 border-red-300"
                          : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                      ].join(" ")}
                    >{tag}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
              <button onClick={() => setShowInvTagDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                disabled={invTagSaving}
                onClick={async () => {
                  if (!invTagBeianHao) return
                  setInvTagSaving(true)
                  try {
                    await fetch("/ma/api/tracking-funds/fund-tags", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ beian_hao: invTagBeianHao, tags: invTagSelected }),
                    })
                    setShowInvTagDialog(false)
                  } finally {
                    setInvTagSaving(false)
                  }
                }}
                className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {invTagSaving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvStrategyDialog && (() => {
        const invL2Opts = invStrategyL1 ? (strategyHierarchy.find((n) => n.l1 === invStrategyL1)?.l2s ?? []) : []
        const invL3Opts = invStrategyL2 ? (invL2Opts.find((n) => n.l2 === invStrategyL2)?.l3s ?? []) : []
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvStrategyDialog(false)}>
            <div className="bg-background rounded-lg shadow-xl w-[480px] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
                <span className="font-semibold text-base">编辑团队策略</span>
                <button onClick={() => setShowInvStrategyDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
              </div>
              <div className="px-6 py-5 flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="font-semibold text-sm">{invStrategyName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-20 text-right whitespace-nowrap">一级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={invStrategyL1}
                      onChange={(e) => { setInvStrategyL1(e.target.value); setInvStrategyL2(""); setInvStrategyL3("") }}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                      <option value="">请选择一级策略</option>
                      {strategyHierarchy.map((n) => <option key={n.l1} value={n.l1}>{n.l1}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-20 text-right whitespace-nowrap">二级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={invStrategyL2}
                      onChange={(e) => { setInvStrategyL2(e.target.value); setInvStrategyL3("") }}
                      disabled={invL2Opts.length === 0}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50">
                      <option value="">{invStrategyL1 ? "请选择二级策略" : "请先选择一级策略"}</option>
                      {invL2Opts.map((n) => <option key={n.l2} value={n.l2}>{n.l2}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-20 text-right whitespace-nowrap">三级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={invStrategyL3}
                      onChange={(e) => setInvStrategyL3(e.target.value)}
                      disabled={invL3Opts.length === 0}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50">
                      <option value="">{invStrategyL2 ? "请选择三级策略" : "请先选择一级策略"}</option>
                      {invL3Opts.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
                <button onClick={() => setShowInvStrategyDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
                <button
                  disabled={!invStrategyL1 || invStrategySaving}
                  onClick={async () => {
                    if (!invStrategyBeianHao || !invStrategyL1) return
                    setInvStrategySaving(true)
                    try {
                      await fetch(`/ma/api/private-funds/${encodeURIComponent(invStrategyBeianHao)}/strategy`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          strategy_l1: invStrategyL1 || null,
                          strategy_l2: invStrategyL2 || null,
                          strategy_l3: invStrategyL3 || null,
                        }),
                      })
                      setShowInvStrategyDialog(false)
                    } finally {
                      setInvStrategySaving(false)
                    }
                  }}
                  className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
                  {invStrategySaving ? "保存中…" : "确 定"}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {showInvNoteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvNoteDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[580px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">团队备注管理</span>
              <button onClick={() => setShowInvNoteDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="font-semibold text-sm">{invNoteName}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-foreground"><span className="text-red-500 mr-0.5">*</span>团队备注</label>
                <textarea
                  value={invNoteText}
                  onChange={(e) => setInvNoteText(e.target.value.slice(0, 250))}
                  placeholder="请输入不大于250字的备注"
                  rows={5}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                />
                <div className="text-right text-xs text-muted-foreground">{invNoteText.length}/250</div>
              </div>
            </div>
            <div className="flex items-center justify-end px-6 py-3 border-t flex-shrink-0">
              <button
                disabled={invNoteSaving}
                onClick={async () => {
                  if (!invNoteBeianHao) return
                  setInvNoteSaving(true)
                  try {
                    await fetch("/ma/api/tracking-funds/fund-note", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ beian_hao: invNoteBeianHao, note: invNoteText }),
                    })
                    setShowInvNoteDialog(false)
                  } finally {
                    setInvNoteSaving(false)
                  }
                }}
                className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {invNoteSaving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvBatchTagDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvBatchTagDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[560px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">批量添加标签</span>
              <button onClick={() => setShowInvBatchTagDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                对已选产品批量添加标签，标签团队内部可见。团队标签的新增、编辑在【运维-数据维护-团队标签】中。
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-16 text-right pt-2 whitespace-nowrap">标签：</span>
                <div className="flex-1">
                  <div className="flex items-center border rounded px-3 py-1.5 gap-2 flex-wrap min-h-[36px] bg-background">
                    {invBatchTagSelected.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 bg-red-50 border border-red-300 text-red-500 rounded px-2 py-0.5 text-xs">
                        {t}
                        <button onClick={() => setInvBatchTagSelected((p) => p.filter((x) => x !== t))} className="leading-none hover:text-red-700">×</button>
                      </span>
                    ))}
                    {invBatchTagSelected.length === 0 && <span className="text-xs text-muted-foreground">请选择标签</span>}
                  </div>
                </div>
                <button onClick={() => setInvBatchTagSelected([])} className="text-sm text-blue-500 hover:text-blue-600 transition-colors shrink-0 pt-2">清空</button>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-16 text-right pt-1.5 whitespace-nowrap">团队标签：</span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-muted/30 rounded px-3 py-2">
                  {invBatchTagTeamTags.length === 0 && (
                    <span className="text-sm text-muted-foreground flex-shrink-0">暂无标签，可点击「设置」添加后刷新</span>
                  )}
                  {invBatchTagTeamTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setInvBatchTagSelected((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                      className={[
                        "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                        invBatchTagSelected.includes(tag)
                          ? "bg-red-50 text-red-500 border-red-300"
                          : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                      ].join(" ")}
                    >{tag}</button>
                  ))}
                  <button
                    onClick={() => window.open("/ma/dashboard/private-funds?tab=operations&side=ops-strategy-tags&ops=tags", "_blank")}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors ml-1">
                    <Settings2 className="h-3 w-3" /> 设置
                  </button>
                  <button
                    onClick={() => fetch("/ma/api/ops/team-tags?category=fund").then((r) => r.json()).then((d) => Array.isArray(d) ? setInvBatchTagTeamTags(d.map((t: { name: string }) => t.name)) : null).catch(() => {})}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors">
                    <RefreshCw className="h-3 w-3" /> 刷新
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
              <button onClick={() => setShowInvBatchTagDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                disabled={invBatchTagSelected.length === 0 || invBatchSubmitting}
                onClick={async () => {
                  await handleInvBatchOp("add_tags", { tags: invBatchTagSelected })
                  setShowInvBatchTagDialog(false)
                }}
                className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {invBatchSubmitting ? "处理中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInvBatchStrategyDialog && (() => {
        const invBatchL2Opts = invBatchStrategyL1 ? (strategyHierarchy.find((n) => n.l1 === invBatchStrategyL1)?.l2s ?? []) : []
        const invBatchL3Opts = invBatchStrategyL2 ? (invBatchL2Opts.find((n) => n.l2 === invBatchStrategyL2)?.l3s ?? []) : []
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvBatchStrategyDialog(false)}>
            <div className="bg-background rounded-lg shadow-xl w-[480px] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
                <span className="font-semibold text-base">批量添加策略</span>
                <button onClick={() => setShowInvBatchStrategyDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
              </div>
              <div className="px-6 py-5 flex flex-col gap-4">
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  对已选产品批量添加团队策略，策略团队内部可见。团队策略的新增、编辑在【运维-数据维护-团队策略】中。
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-20 text-right whitespace-nowrap">
                    <span className="text-red-500 mr-0.5">*</span>一级策略：
                  </span>
                  <div className="relative flex-1">
                    <select
                      value={invBatchStrategyL1}
                      onChange={(e) => { setInvBatchStrategyL1(e.target.value); setInvBatchStrategyL2(""); setInvBatchStrategyL3("") }}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-zinc-600 dark:text-zinc-300">
                      <option value="">请选择一级策略</option>
                      {strategyHierarchy.map((n) => <option key={n.l1} value={n.l1}>{n.l1}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-20 text-right whitespace-nowrap">二级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={invBatchStrategyL2}
                      onChange={(e) => { setInvBatchStrategyL2(e.target.value); setInvBatchStrategyL3("") }}
                      disabled={invBatchL2Opts.length === 0}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-zinc-600 dark:text-zinc-300 disabled:opacity-50">
                      <option value="">请选择二级策略</option>
                      {invBatchL2Opts.map((n) => <option key={n.l2} value={n.l2}>{n.l2}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-20 text-right whitespace-nowrap">三级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={invBatchStrategyL3}
                      onChange={(e) => setInvBatchStrategyL3(e.target.value)}
                      disabled={invBatchL3Opts.length === 0}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring text-zinc-600 dark:text-zinc-300 disabled:opacity-50">
                      <option value="">请选择三级策略</option>
                      {invBatchL3Opts.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
                <button onClick={() => setShowInvBatchStrategyDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
                <button
                  disabled={!invBatchStrategyL1 || invBatchSubmitting}
                  onClick={async () => {
                    await handleInvBatchOp("set_strategy", {
                      strategy_l1: invBatchStrategyL1 || null,
                      strategy_l2: invBatchStrategyL2 || null,
                      strategy_l3: invBatchStrategyL3 || null,
                    })
                    setShowInvBatchStrategyDialog(false)
                  }}
                  className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  {invBatchSubmitting ? "处理中…" : "确 定"}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {showInvBatchConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowInvBatchConfirmDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[360px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-5">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <div>
                <p className="font-semibold text-sm mb-1">{invBatchConfirmTitle}</p>
                <p className="text-sm text-zinc-500">{invBatchConfirmMessage}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowInvBatchConfirmDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                disabled={invBatchSubmitting}
                onClick={async () => {
                  if (invBatchConfirmAction) await handleInvBatchOp(invBatchConfirmAction)
                  setShowInvBatchConfirmDialog(false)
                }}
                className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {invBatchSubmitting ? "处理中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      <DirectFieldConfigDialog
        open={showInvFieldConfig}
        selected={invFieldConfigSelected}
        onClose={() => setShowInvFieldConfig(false)}
        onConfirm={(fields) => { setInvFieldConfigSelected(fields); setShowInvFieldConfig(false) }}
      />

      {showInvAddMetric && (
        <AddMetricModal
          initial={invAddedCols}
          onClose={() => setShowInvAddMetric(false)}
          onConfirm={(cols) => { setInvAddedCols(cols); setInvActiveTemplate(null); setShowInvAddMetric(false) }}
        />
      )}
    </div>
  )
}

// ─── InvestmentFofOverviewView ───────────────────────────────────────────────

type FofOverviewSortKey =
  | "product_name" | "latest_nav" | "latest_nav_date" | "latest_price_change"
  | "market_value" | "ret_1w" | "ret_1m" | "ret_3m" | "ret_6m" | "ret_1y"
  | "sharpe_1y" | "calmar_1y"

interface FofOverviewRow {
  id: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  strategy_l1: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  market_value: string | null
  ret_1w?: string | null
  ret_1m?: string | null
  ret_3m?: string | null
  ret_6m?: string | null
  ret_1y?: string | null
  sharpe_1y?: string | null
  calmar_1y?: string | null
}

type FofDetailSortKey =
  | "fof_fund_name" | "product_name" | "beian_hao" | "unit_nav" | "nav_date" | "price_change"
  | "investment_shares" | "market_value" | "market_value_pct"
  | "ret_1w" | "ret_1m" | "ret_3m" | "ret_6m" | "ret_1y" | "sharpe_1y" | "calmar_1y"

interface FofDetailRow {
  id: string
  seq_no: number | null
  fof_fund_name: string
  product_name: string
  short_name: string | null
  beian_hao: string | null
  unit_nav: string | null
  nav_date: string | null
  price_change: string | null
  investment_shares: string | null
  market_value: string | null
  market_value_pct: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
}

function fmtPct4(v: string | null) {
  if (!v) return "—"
  const n = parseFloat(v)
  if (isNaN(n)) return "—"
  return (n >= 0 ? "+" : "") + n.toFixed(4) + "%"
}

function FofDetailPctCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const n = parseFloat(value)
  if (isNaN(n)) return <span className="text-muted-foreground">—</span>
  const cls = n > 0 ? "text-red-500" : n < 0 ? "text-green-600" : "text-foreground"
  return <span className={cls}>{n > 0 ? "+" : ""}{n.toFixed(2)}%</span>
}

function InvestmentFofOverviewView() {
  const [viewTab, setViewTab] = useState<"summary" | "detail">("summary")
  const [fundClass, setFundClass] = useState<"private" | "public">("private")
  const [strategySource, setStrategySource] = useState<"company" | "platform">("company")
  const [strategyHierarchy, setStrategyHierarchy] = useState<TrackStrategyNode[]>([])
  const [strategyL1, setStrategyL1] = useState("")
  const [teamTagMode, setTeamTagMode] = useState<"and" | "or">("and")
  const [teamTagOptions, setTeamTagOptions] = useState<string[]>([])
  const [teamTags, setTeamTags] = useState<string[]>([])
  const [holdingStatus, setHoldingStatus] = useState<"holding" | "cleared">("holding")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [fofFundInput, setFofFundInput] = useState("")
  const [fofFundSelected, setFofFundSelected] = useState<{ register_number: string; product_name: string } | null>(null)
  const [fofFundOptions, setFofFundOptions] = useState<{ register_number: string; product_name: string }[]>([])
  const [fofFundShowDropdown, setFofFundShowDropdown] = useState(false)
  const [cutoffDate, setCutoffDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [detailValuationDate, setDetailValuationDate] = useState("")
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [showInterval, setShowInterval] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showFofFieldConfig, setShowFofFieldConfig] = useState(false)
  const [fofFieldConfigSelected, setFofFieldConfigSelected] = useState<string[]>([...DIRECT_FIELD_CONFIG_DEFAULT])
  const [showFofAddMetric, setShowFofAddMetric] = useState(false)
  const [fofAddedCols, setFofAddedCols] = useState<AddedCol[]>([])
  const [showFofTemplateMenu, setShowFofTemplateMenu] = useState(false)
  const [fofMetricTemplates, setFofMetricTemplates] = useState<{ name: string; items: { period: string; metric: string }[] }[]>(() => loadTrackingMetricTemplates())
  const [fofActiveTemplate, setFofActiveTemplate] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<FofOverviewSortKey | "">("")
  const [detailSortKey, setDetailSortKey] = useState<FofDetailSortKey | "">("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState<FofOverviewRow[]>([])
  const [fofDetailData, setFofDetailData] = useState<FofDetailRow[]>([])
  const [total, setTotal] = useState(0)
  const [totalMarketValue, setTotalMarketValue] = useState("0")
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hoverChartRow, setHoverChartRow] = useState<string | null>(null)
  const [hoverChartPos, setHoverChartPos] = useState<{ x: number; y: number } | null>(null)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fofFundSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showFofElementsDialog, setShowFofElementsDialog] = useState(false)
  const [fofElementsBeianHao, setFofElementsBeianHao] = useState<string | null>(null)
  const [fofElementsName, setFofElementsName] = useState("")
  const [fofElementsData, setFofElementsData] = useState<Record<string, string | null> | null>(null)
  const [fofElementsLoading, setFofElementsLoading] = useState(false)
  const [showFofTagDialog, setShowFofTagDialog] = useState(false)
  const [fofTagBeianHao, setFofTagBeianHao] = useState<string | null>(null)
  const [fofTagName, setFofTagName] = useState("")
  const [fofTagSelected, setFofTagSelected] = useState<string[]>([])
  const [fofTagTeamTags, setFofTagTeamTags] = useState<string[]>([])
  const [fofTagSaving, setFofTagSaving] = useState(false)
  const [showFofStrategyDialog, setShowFofStrategyDialog] = useState(false)
  const [fofStrategyBeianHao, setFofStrategyBeianHao] = useState<string | null>(null)
  const [fofStrategyName, setFofStrategyName] = useState("")
  const [fofStrategyL1, setFofStrategyL1] = useState("")
  const [fofStrategyL2, setFofStrategyL2] = useState("")
  const [fofStrategyL3, setFofStrategyL3] = useState("")
  const [fofStrategySaving, setFofStrategySaving] = useState(false)
  const [showFofNoteDialog, setShowFofNoteDialog] = useState(false)
  const [fofNoteBeianHao, setFofNoteBeianHao] = useState<string | null>(null)
  const [fofNoteName, setFofNoteName] = useState("")
  const [fofNoteText, setFofNoteText] = useState("")
  const [fofNoteSaving, setFofNoteSaving] = useState(false)
  const [fofFavorites, setFofFavorites] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("fof_underlying_favorites")
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch { return new Set() }
  })

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`

  useEffect(() => {
    if (!showFofElementsDialog || !fofElementsBeianHao) return
    setFofElementsData(null)
    setFofElementsLoading(true)
    fetch(`/ma/api/tracking-funds/fund-elements?beian_hao=${encodeURIComponent(fofElementsBeianHao)}`)
      .then((r) => r.json())
      .then((d) => { setFofElementsData(d); setFofElementsLoading(false) })
      .catch(() => setFofElementsLoading(false))
  }, [showFofElementsDialog, fofElementsBeianHao])

  function openFofElementsDialog(beian_hao: string | null, product_name: string) {
    if (!beian_hao) return
    setFofElementsBeianHao(beian_hao)
    setFofElementsName(product_name)
    setShowFofElementsDialog(true)
  }

  async function openFofTagDialog(beian_hao: string | null, product_name: string) {
    if (!beian_hao) return
    setFofTagBeianHao(beian_hao)
    setFofTagName(product_name)
    setFofTagSelected([])
    setFofTagTeamTags([])
    setShowFofTagDialog(true)
    const [tagsRes, teamTagsRes] = await Promise.all([
      fetch(`/ma/api/tracking-funds/fund-tags?beian_hao=${encodeURIComponent(beian_hao)}`).then((r) => r.json()).catch(() => []),
      fetch("/ma/api/ops/team-tags?category=fund").then((r) => r.json()).catch(() => []),
    ])
    if (Array.isArray(tagsRes)) setFofTagSelected(tagsRes)
    if (Array.isArray(teamTagsRes)) setFofTagTeamTags(teamTagsRes.map((t: { name: string }) => t.name))
  }

  async function openFofStrategyDialog(beian_hao: string | null, product_name: string) {
    if (!beian_hao) return
    setFofStrategyBeianHao(beian_hao)
    setFofStrategyName(product_name)
    setFofStrategyL1("")
    setFofStrategyL2("")
    setFofStrategyL3("")
    setShowFofStrategyDialog(true)
    try {
      const res = await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}`)
      const d = await res.json()
      if (d?.strategy_l1) setFofStrategyL1(d.strategy_l1)
      if (d?.strategy_l2) setFofStrategyL2(d.strategy_l2)
      if (d?.strategy_l3) setFofStrategyL3(d.strategy_l3)
    } catch { /* ignore */ }
  }

  async function openFofNoteDialog(beian_hao: string | null, product_name: string) {
    if (!beian_hao) return
    setFofNoteBeianHao(beian_hao)
    setFofNoteName(product_name)
    setFofNoteText("")
    setShowFofNoteDialog(true)
    try {
      const res = await fetch(`/ma/api/tracking-funds/fund-note?beian_hao=${encodeURIComponent(beian_hao)}`)
      const d = await res.json()
      setFofNoteText(d.note ?? "")
    } catch { /* ignore */ }
  }

  function toggleFofFavorite(id: string) {
    setFofFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem("fof_underlying_favorites", JSON.stringify([...next]))
      return next
    })
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
  }, [viewTab, fundClass, strategySource, strategyL1, teamTagMode, teamTags.join("\u0001"), holdingStatus, keyword, pageSize, cutoffDate, fofFundSelected?.register_number, favoritesOnly])

  useEffect(() => {
    if (viewTab === "detail") return
    setLoading(true)
    const params = new URLSearchParams({
      page: favoritesOnly ? "1" : String(page),
      pageSize: favoritesOnly ? "100000" : String(pageSize),
      strategy_source: strategySource,
      holding_status: holdingStatus,
      team_tag_mode: teamTagMode,
      keyword,
      cutoff: cutoffDate,
      dir: sortDir,
    })
    if (sortKey) params.set("sort", sortKey)
    if (strategyL1 === "__unconfigured__") params.set("strategy_l1", "__unconfigured__")
    else if (strategyL1) params.set("strategy_l1", strategyL1)
    if (fofFundSelected?.register_number) params.set("fof_register_number", fofFundSelected.register_number)
    teamTags.forEach((t) => params.append("team_tag", t))
    fetch(`/ma/api/investment/fof-overview/list?${params}`)
      .then((r) => r.json())
      .then((json) => {
        let rows: FofOverviewRow[] = json.data ?? []
        if (favoritesOnly) {
          rows = rows.filter((r) => fofFavorites.has(r.id))
          const totalMv = rows.reduce((sum, r) => sum + (parseFloat(r.market_value ?? "0") || 0), 0)
          setTotal(rows.length)
          setTotalMarketValue(String(totalMv))
          const start = (page - 1) * pageSize
          setData(rows.slice(start, start + pageSize))
        } else {
          setData(rows)
          setTotal(json.total ?? 0)
          setTotalMarketValue(json.totalMarketValue ?? "0")
        }
        setSelected(new Set())
      })
      .catch(() => {
        setData([])
        setTotal(0)
        setTotalMarketValue("0")
        setSelected(new Set())
      })
      .finally(() => setLoading(false))
  }, [viewTab, page, pageSize, fundClass, strategySource, strategyL1, teamTagMode, teamTags, holdingStatus, keyword, sortKey, sortDir, cutoffDate, fofFundSelected?.register_number, favoritesOnly, fofFavorites])

  useEffect(() => {
    if (viewTab !== "detail") return
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      keyword,
      dir: sortDir,
    })
    if (detailSortKey) params.set("sort", detailSortKey)
    if (fofFundSelected?.product_name) params.set("fof_fund_name", fofFundSelected.product_name)
    if (detailValuationDate) params.set("valuation_date", detailValuationDate)
    fetch(`/ma/api/investment/fof-underlying-detail/list?${params}`)
      .then((r) => r.json())
      .then((json) => {
        setFofDetailData(json.data ?? [])
        setTotal(json.total ?? 0)
        setTotalMarketValue(json.totalMarketValue ?? "0")
        setSelected(new Set())
      })
      .catch(() => {
        setFofDetailData([])
        setTotal(0)
        setTotalMarketValue("0")
        setSelected(new Set())
      })
      .finally(() => setLoading(false))
  }, [viewTab, page, pageSize, keyword, detailSortKey, sortDir, fofFundSelected?.product_name, detailValuationDate])

  useEffect(() => {
    fetch("/ma/api/ops/fof-underlying/fof-funds")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setFofFundOptions(d) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (fofFundSearchRef.current) clearTimeout(fofFundSearchRef.current)
    fofFundSearchRef.current = setTimeout(() => {
      const q = fofFundInput.trim()
      fetch(`/ma/api/ops/fof-underlying/fof-funds${q ? `?q=${encodeURIComponent(q)}` : ""}`)
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d)) setFofFundOptions(d) })
        .catch(() => setFofFundOptions([]))
    }, 200)
    return () => { if (fofFundSearchRef.current) clearTimeout(fofFundSearchRef.current) }
  }, [fofFundInput])

  function toggleTeamTag(tag: string) {
    setTeamTags((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])
  }

  function handleSort(col: FofOverviewSortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("desc") }
    setPage(1)
  }

  function handleDetailSort(col: FofDetailSortKey) {
    if (detailSortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setDetailSortKey(col); setSortDir("desc") }
    setPage(1)
  }

  function FofOverviewSortIcon({ col }: { col: FofOverviewSortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function FofDetailSortIcon({ col }: { col: FofDetailSortKey }) {
    if (detailSortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function toggleAll() {
    const rows = viewTab === "detail" ? fofDetailData : data
    if (selected.size === rows.length && rows.length > 0) setSelected(new Set())
    else setSelected(new Set(rows.map((r) => r.id)))
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
    if (viewTab === "detail") {
      const rows = selected.size > 0 ? fofDetailData.filter((r) => selected.has(r.id)) : fofDetailData
      const headers = ["FOF基金", "底层基金", "备案编码", "单位净值", "净值日期", "涨跌幅", "投资份额", "市值", "市值占比", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普比率", "近一年卡玛比率"]
      const csvRows = [
        headers.join(","),
        ...rows.map((r) => [
          escape(r.fof_fund_name), escape(r.product_name), escape(r.beian_hao),
          escape(r.unit_nav), escape(r.nav_date), escape(r.price_change),
          escape(r.investment_shares), escape(r.market_value), escape(r.market_value_pct),
          escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m),
          escape(r.ret_1y), escape(r.sharpe_1y), escape(r.calmar_1y),
        ].join(",")),
      ]
      const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `FOF底层明细_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(a.href)
      return
    }
    const rows = selected.size > 0 ? data.filter((r) => selected.has(r.id)) : data
    const headers = ["产品名称", "备案编码", "最新净值日期", "最新单位净值", "最新涨跌幅", "市值", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普比率", "近一年卡玛比率"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.short_name || r.product_name), escape(r.beian_hao), escape(r.latest_nav_date),
        escape(r.latest_nav), escape(r.latest_price_change), escape(r.market_value),
        escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m),
        escape(r.ret_1y), escape(r.sharpe_1y), escape(r.calmar_1y),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `FOF底层汇总_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const colSpan = 17 + fofAddedCols.length
  const detailColSpan = 18 + fofAddedCols.length
  const fofStickyHeadBg = "bg-muted dark:bg-zinc-900"
  const fofStickyCellBg = "bg-background dark:bg-background"
  const fofStickyHeadZ = "z-40"
  const fofStickyBodyZ = "z-20"
  const fofStickyLeftShadow = "shadow-[4px_0_8px_-4px_rgba(0,0,0,0.08)] dark:shadow-[4px_0_8px_-4px_rgba(0,0,0,0.35)]"
  const fofStickyRightShadow = "shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)] dark:shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.35)]"
  const fofStickyChkW = 32
  const fofStickySeqW = 40
  const fofStickyNameW = 200
  const fofStickyLeftSeq = fofStickyChkW
  const fofStickyLeftName = fofStickyChkW + fofStickySeqW
  const fofStickyRightColW = 64
  const fofStickyOpsColW = 80
  const fofStickyRight = { ops: 0, docs: fofStickyOpsColW, trend: fofStickyOpsColW + fofStickyRightColW }
  const fofStickyRightColStyle = (right: number, width = fofStickyRightColW): CSSProperties => ({
    right,
    width,
    minWidth: width,
    maxWidth: width,
  })
  const fofScrollMinW = 2500 + fofAddedCols.length * 96
  const fofDetailStickyChkW = 32
  const fofDetailStickySeqW = 40
  const fofDetailStickyFofW = 160
  const fofDetailStickyProductW = 160
  const fofDetailStickyLeftSeq = fofDetailStickyChkW
  const fofDetailStickyLeftFof = fofDetailStickyChkW + fofDetailStickySeqW
  const fofDetailStickyLeftProduct = fofDetailStickyLeftFof + fofDetailStickyFofW
  const fofDetailScrollMinW = 2800 + fofAddedCols.length * 96
  const fofScrollCell = `border-b px-3 py-2 bg-background group-hover:bg-muted transition-colors`
  const fofScrollHead = `${thBase} sticky top-0 z-10 bg-muted dark:bg-zinc-900`
  const fofScrollHeadSort = `${thSort} sticky top-0 z-10 bg-muted dark:bg-zinc-900`
  const fofStickyRightTh = `sticky top-0 ${fofStickyHeadZ} ${fofStickyHeadBg} text-center text-xs font-semibold text-zinc-500 dark:text-zinc-400 whitespace-nowrap select-none px-2 py-3 overflow-hidden`
  const fofStickyRightTd = `sticky ${fofStickyBodyZ} text-center px-2 overflow-hidden box-border`

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-0 mb-3 border-b flex-shrink-0">
        {([["summary", "底层汇总"], ["detail", "底层明细"]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setViewTab(key); setPage(1); setSelected(new Set()) }}
            className={[
              "px-4 py-2 text-sm font-medium transition-colors relative",
              viewTab === key
                ? "text-red-500 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-red-500"
                : "text-zinc-500 hover:text-foreground",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {viewTab === "summary" ? (
      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">基金分类：</span>
          <div className="flex items-center gap-1">
            {([["private", "私募"], ["public", "公募"]] as const).map(([fc, label]) => (
              <span
                key={fc}
                onClick={() => setFundClass(fc)}
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
        <div className="flex items-start px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">一级策略：</span>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <div className="relative">
              <select
                value={strategySource}
                onChange={(e) => {
                  const next = e.target.value as "company" | "platform"
                  if (strategySource === next) return
                  setStrategySource(next)
                  setStrategyL1("")
                  setPage(1)
                }}
                className="h-7 min-w-[6.25rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="company">团队策略</option>
                <option value="platform">平台策略</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            </div>
            <span
              onClick={() => { setStrategyL1(""); setPage(1) }}
              className={[
                "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                !strategyL1
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              不限
            </span>
            {strategyHierarchy.map((node) => (
              <span
                key={node.l1}
                onClick={() => { setStrategyL1(strategyL1 === node.l1 ? "" : node.l1); setPage(1) }}
                className={[
                  "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                  strategyL1 === node.l1
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                    : "border-border text-zinc-500 hover:bg-muted/60",
                ].join(" ")}
              >
                {node.l1}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">团队标签：</span>
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <div className="relative">
              <select
                value={teamTagMode}
                onChange={(e) => { setTeamTagMode(e.target.value as "and" | "or"); setPage(1) }}
                className="h-7 min-w-[5.75rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="and">交集（且）</option>
                <option value="or">并集（或）</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
            </div>
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
        <div className="flex items-center px-4 py-2 gap-4">
          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">持仓状态：</span>
            <div className="flex items-center gap-1">
              {([["holding", "持仓中"], ["cleared", "已清仓"]] as const).map(([st, label]) => (
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
        </div>
        <div className="flex items-center px-4 py-2 gap-6 flex-wrap">
          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">关 键 字：</span>
            <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-80">
              <input
                className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
                placeholder="请输入产品/产品备案号，按回车搜索"
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput)}
              />
              <button onClick={() => setKeyword(kwInput)} className="text-muted-foreground hover:text-foreground transition-colors">
                <Search className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 pr-3">FOF基金：</span>
            <div className="relative w-64">
              {fofFundSelected ? (
                <div className="flex items-center justify-between border rounded h-7 px-2 bg-background">
                  <span className="text-xs truncate">{fofFundSelected.product_name}</span>
                  <button
                    type="button"
                    onClick={() => { setFofFundSelected(null); setFofFundInput("") }}
                    className="text-muted-foreground hover:text-foreground ml-1 shrink-0">×</button>
                </div>
              ) : (
                <>
                  <input
                    className="w-full h-7 border rounded px-2 text-xs bg-background outline-none placeholder:text-muted-foreground/50"
                    placeholder="请输入并选择FOF基金"
                    value={fofFundInput}
                    onChange={(e) => { setFofFundInput(e.target.value); setFofFundShowDropdown(true) }}
                    onFocus={() => setFofFundShowDropdown(true)}
                  />
                  {fofFundShowDropdown && fofFundOptions.length > 0 && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setFofFundShowDropdown(false)} />
                      <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-background border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {fofFundOptions.map((opt) => (
                          <button
                            key={opt.register_number}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setFofFundSelected(opt)
                              setFofFundInput("")
                              setFofFundShowDropdown(false)
                            }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors truncate"
                          >
                            {opt.product_name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      ) : (
      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden flex-shrink-0">
        <div className="flex items-center px-4 py-2 gap-6 flex-wrap">
          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">关 键 字：</span>
            <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-80">
              <input
                className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
                placeholder="请输入产品/产品备案号，按回车搜索"
                value={kwInput}
                onChange={(e) => setKwInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput)}
              />
              <button onClick={() => setKeyword(kwInput)} className="text-muted-foreground hover:text-foreground transition-colors">
                <Search className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 pr-3">FOF基金：</span>
            <div className="relative w-64">
              {fofFundSelected ? (
                <div className="flex items-center justify-between border rounded h-7 px-2 bg-background">
                  <span className="text-xs truncate">{fofFundSelected.product_name}</span>
                  <button
                    type="button"
                    onClick={() => { setFofFundSelected(null); setFofFundInput("") }}
                    className="text-muted-foreground hover:text-foreground ml-1 shrink-0">×</button>
                </div>
              ) : (
                <>
                  <input
                    className="w-full h-7 border rounded px-2 text-xs bg-background outline-none placeholder:text-muted-foreground/50"
                    placeholder="请输入并选择FOF基金"
                    value={fofFundInput}
                    onChange={(e) => { setFofFundInput(e.target.value); setFofFundShowDropdown(true) }}
                    onFocus={() => setFofFundShowDropdown(true)}
                  />
                  {fofFundShowDropdown && fofFundOptions.length > 0 && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setFofFundShowDropdown(false)} />
                      <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-background border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {fofFundOptions.map((opt) => (
                          <button
                            key={opt.register_number}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setFofFundSelected(opt)
                              setFofFundInput("")
                              setFofFundShowDropdown(false)
                            }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors truncate"
                          >
                            {opt.product_name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      )}

      <div className="relative z-50 flex items-center justify-between gap-1.5 mb-3 flex-shrink-0 text-xs">
        <div className="flex items-center gap-1.5 text-zinc-600">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">{viewTab === "detail" ? "估值日期" : "指标计算截止日期"}</span>
          <div className="relative">
            <button
              onClick={() => setShowDatePicker((v) => !v)}
              className="inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-zinc-600 hover:bg-muted cursor-pointer transition-colors">
              <CalendarDays className="h-3 w-3" />
              <span className="tabular-nums">{viewTab === "detail" ? (detailValuationDate || "不限") : cutoffDate}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {showDatePicker && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-lg p-3" onClick={(e) => e.stopPropagation()}>
                {viewTab === "detail" && (
                  <button
                    type="button"
                    onClick={() => { setDetailValuationDate(""); setShowDatePicker(false); setPage(1) }}
                    className="mb-2 block text-xs text-blue-600 hover:underline"
                  >
                    清除筛选
                  </button>
                )}
                <input
                  type="date"
                  value={viewTab === "detail" ? detailValuationDate : cutoffDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => {
                    if (!e.target.value) return
                    if (viewTab === "detail") { setDetailValuationDate(e.target.value); setPage(1) }
                    else setCutoffDate(e.target.value)
                    setShowDatePicker(false)
                  }}
                  className="border rounded px-2 py-1 text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
              </div>
            )}
            {showDatePicker && <div className="fixed inset-0 z-40" onClick={() => setShowDatePicker(false)} />}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
        {viewTab === "summary" && (
        <>
        <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
          <input type="checkbox" defaultChecked className="rounded h-3 w-3 accent-zinc-700" />
          计算指标
        </label>
        <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
          <input type="checkbox" checked={showInterval} onChange={(e) => setShowInterval(e.target.checked)} className="rounded h-3 w-3 accent-zinc-700" />
          显示区间
        </label>
        <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => { setFavoritesOnly(e.target.checked); setPage(1) }}
            className="rounded h-3 w-3 accent-zinc-700"
          />
          <Heart className="h-3 w-3" /> 收藏
        </label>
        </>
        )}
        <div className="relative">
          <button
            onClick={() => {
              setFofMetricTemplates(loadTrackingMetricTemplates())
              setShowFofTemplateMenu((v) => !v)
            }}
            className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
            <LayoutTemplate className="h-3 w-3" />
            {fofActiveTemplate ?? "默认模板"}
            <ChevronDown className="h-3 w-3" />
          </button>
          {showFofTemplateMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowFofTemplateMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-lg py-1 min-w-[160px]" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => { setFofAddedCols([]); setFofActiveTemplate(null); setShowFofTemplateMenu(false) }}
                  className={[
                    "w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2",
                    fofActiveTemplate === null ? "bg-red-50 dark:bg-red-950/30" : "hover:bg-muted",
                  ].join(" ")}>
                  <LayoutTemplate className="h-3.5 w-3.5 text-zinc-400" /> 默认模板
                </button>
                {fofMetricTemplates.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setFofAddedCols(buildAddedColsFromItems(t.items))
                      setFofActiveTemplate(t.name)
                      setShowFofTemplateMenu(false)
                    }}
                    className={[
                      "w-full text-left px-4 py-2 text-sm transition-colors truncate",
                      fofActiveTemplate === t.name ? "bg-red-50 dark:bg-red-950/30" : "hover:bg-muted",
                    ].join(" ")}>
                    {t.name}
                  </button>
                ))}
                <div className="border-t my-1" />
                <button
                  onClick={() => { setShowFofTemplateMenu(false); window.open("/ma/dashboard/settings?tab=metric-templates", "_blank") }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-red-500">
                  <Settings2 className="h-3.5 w-3.5" /> 管理模板
                </button>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setShowFofAddMetric(true)}
          className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
          <PlusCircle className="h-3 w-3" />
          {fofAddedCols.length > 0 ? `添加指标(${fofAddedCols.length})` : "添加指标"}
        </button>
        {viewTab === "summary" ? (
        <>
        <button disabled={selected.size === 0} className="inline-flex items-center gap-1 border border-border/50 rounded px-2 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-zinc-600 hover:text-foreground hover:bg-muted/60">
          批量操作
          {selected.size > 0 && <span className="text-xs text-red-500">({selected.size})</span>}
        </button>
        <div className="relative">
          <button
            onClick={() => setShowMoreMenu((v) => !v)}
            className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
            ⊕ 更多
          </button>
          {showMoreMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-lg py-1 min-w-[120px]" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { setShowMoreMenu(false); setShowFofFieldConfig(true) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                  <Settings2 className="h-3.5 w-3.5 text-zinc-400" /> 字段配置
                </button>
                <button onClick={() => { setShowMoreMenu(false); handleExport() }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
                  <Download className="h-3.5 w-3.5 text-zinc-400" /> 导出
                </button>
              </div>
            </>
          )}
        </div>
        </>
        ) : (
        <>
        <button
          onClick={() => setShowFofFieldConfig(true)}
          className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
          <Settings2 className="h-3 w-3" />
          字段配置
        </button>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
          <Download className="h-3 w-3" />
          导出
        </button>
        </>
        )}
        </div>
      </div>

      {viewTab === "summary" ? (
      <div className="overflow-auto rounded-lg border flex-1 min-h-0">
        <table className="text-sm border-separate border-spacing-0" style={{ minWidth: fofScrollMinW }}>
          <thead>
            <tr className="border-b">
              <th
                style={{ left: 0, width: fofStickyChkW, minWidth: fofStickyChkW, maxWidth: fofStickyChkW }}
                className={`${thBase} sticky top-0 ${fofStickyHeadZ} ${fofStickyHeadBg} px-2 text-center box-border`}
              >
                <input type="checkbox" className="rounded h-3 w-3" checked={selected.size === data.length && data.length > 0} onChange={toggleAll} />
              </th>
              <th
                style={{ left: fofStickyLeftSeq, width: fofStickySeqW, minWidth: fofStickySeqW, maxWidth: fofStickySeqW }}
                className={`${thBase} sticky top-0 ${fofStickyHeadZ} ${fofStickyHeadBg} text-center box-border`}
              >
                序号
              </th>
              <th
                style={{ left: fofStickyLeftName, width: fofStickyNameW, minWidth: fofStickyNameW, maxWidth: fofStickyNameW }}
                className={`${thSort} sticky top-0 ${fofStickyHeadZ} ${fofStickyHeadBg} box-border border-r border-zinc-200 dark:border-zinc-700 ${fofStickyLeftShadow}`}
                onClick={() => handleSort("product_name")}
              >
                产品名称<FofOverviewSortIcon col="product_name" />
              </th>
              <th className={`${fofScrollHeadSort} min-w-[100px]`} onClick={() => handleSort("latest_nav_date")}>最新净值日期<FofOverviewSortIcon col="latest_nav_date" /></th>
              <th className={`${fofScrollHeadSort} min-w-[100px]`} onClick={() => handleSort("latest_nav")}>最新单位净值<FofOverviewSortIcon col="latest_nav" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[88px]`} onClick={() => handleSort("latest_price_change")}>最新涨跌幅<FofOverviewSortIcon col="latest_price_change" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[120px]`} onClick={() => handleSort("market_value")}>市值<FofOverviewSortIcon col="market_value" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1w")}>
                <div>近一周收益<FofOverviewSortIcon col="ret_1w" /></div>
                {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 7)}</div>}
              </th>
              <th className={`${fofScrollHeadSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1m")}>
                <div>近一月收益<FofOverviewSortIcon col="ret_1m" /></div>
                {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 30)}</div>}
              </th>
              <th className={`${fofScrollHeadSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_3m")}>
                <div>近三月收益<FofOverviewSortIcon col="ret_3m" /></div>
                {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 91)}</div>}
              </th>
              <th className={`${fofScrollHeadSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_6m")}>
                <div>近六月收益<FofOverviewSortIcon col="ret_6m" /></div>
                {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 182)}</div>}
              </th>
              <th className={`${fofScrollHeadSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1y")}>
                <div>近一年收益<FofOverviewSortIcon col="ret_1y" /></div>
                {showInterval && <div className="text-[10px] font-normal text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 365)}</div>}
              </th>
              <th className={`${fofScrollHeadSort} text-right min-w-[98px]`} onClick={() => handleSort("sharpe_1y")}>近一年夏普比率<FofOverviewSortIcon col="sharpe_1y" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[98px]`} onClick={() => handleSort("calmar_1y")}>近一年卡玛比率<FofOverviewSortIcon col="calmar_1y" /></th>
              {fofAddedCols.map((col) => (
                <th key={col.id} className={`${fofScrollHead} text-right min-w-[96px]`}>{col.label}</th>
              ))}
              <th style={fofStickyRightColStyle(fofStickyRight.trend)} className={`${fofStickyRightTh} border-l border-zinc-200 dark:border-zinc-700 ${fofStickyRightShadow}`}>走势</th>
              <th style={fofStickyRightColStyle(fofStickyRight.docs)} className={fofStickyRightTh}>资料</th>
              <th style={fofStickyRightColStyle(fofStickyRight.ops, fofStickyOpsColW)} className={fofStickyRightTh}>操作</th>
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
            ) : (
              <>
                {data.map((row, i) => {
                  const isSelected = selected.has(row.id)
                  const rowBg = isSelected ? "bg-blue-50 dark:bg-blue-950/40" : fofStickyCellBg
                  const hoverBg = isSelected ? "group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40" : "group-hover:bg-muted"
                  const scrollCell = `${fofScrollCell} ${isSelected ? "!bg-blue-50 dark:!bg-blue-950/40 group-hover:!bg-blue-100 dark:group-hover:!bg-blue-900/40" : ""}`
                  const stickyCell = `border-b px-3 py-2 ${rowBg} ${hoverBg} transition-colors ${fofStickyBodyZ}`
                  const stickyLeftChk = `${stickyCell} sticky text-center box-border`
                  const stickyLeftSeq = `${stickyCell} sticky text-center tabular-nums text-muted-foreground box-border`
                  const stickyLeftProduct = `${stickyCell} sticky border-r border-zinc-200 dark:border-zinc-700 ${fofStickyLeftShadow} box-border`
                  const stickyRightTrend = `${fofStickyRightTd} ${rowBg} ${hoverBg} transition-colors border-b border-l border-zinc-200 dark:border-zinc-700 ${fofStickyRightShadow}`
                  const stickyRightDocs = `${fofStickyRightTd} ${rowBg} ${hoverBg} transition-colors border-b text-muted-foreground`
                  const stickyRightOps = `${fofStickyRightTd} ${rowBg} ${hoverBg} transition-colors border-b`
                  return (
                    <tr key={row.id} className="group" style={{ height: 52 }}>
                      <td
                        style={{ left: 0, width: fofStickyChkW, minWidth: fofStickyChkW, maxWidth: fofStickyChkW }}
                        className={`${stickyLeftChk} px-2`}
                      >
                        <input type="checkbox" className="rounded h-3 w-3" checked={isSelected}
                          onChange={() => {
                            const s = new Set(selected)
                            isSelected ? s.delete(row.id) : s.add(row.id)
                            setSelected(s)
                          }} />
                      </td>
                      <td
                        style={{ left: fofStickyLeftSeq, width: fofStickySeqW, minWidth: fofStickySeqW, maxWidth: fofStickySeqW }}
                        className={stickyLeftSeq}
                      >
                        {(page - 1) * pageSize + i + 1}
                      </td>
                      <td
                        style={{ left: fofStickyLeftName, width: fofStickyNameW, minWidth: fofStickyNameW, maxWidth: fofStickyNameW }}
                        className={stickyLeftProduct}
                      >
                        <FundProductNameLink
                          beian_hao={row.beian_hao}
                          product_name={row.product_name}
                          short_name={row.short_name}
                        />
                        {row.strategy_l1 && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/50 flex-shrink-0" />
                            <span className="text-[10px] text-muted-foreground truncate">{row.strategy_l1}</span>
                          </div>
                        )}
                      </td>
                      <td className={`${scrollCell} tabular-nums`}>{row.latest_nav_date ?? "—"}</td>
                      <td className={`${scrollCell} tabular-nums font-medium`}>{row.latest_nav ? parseFloat(row.latest_nav).toFixed(4) : "—"}</td>
                      <td className={`${scrollCell} text-right tabular-nums`}><TrackPctCell value={row.latest_price_change} /></td>
                      <td className={`${scrollCell} text-right tabular-nums font-medium`}>{fmtMoney(row.market_value)}</td>
                      <td className={`${scrollCell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_1w ?? null} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 7)}</div>}
                      </td>
                      <td className={`${scrollCell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_1m ?? null} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 30)}</div>}
                      </td>
                      <td className={`${scrollCell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_3m ?? null} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 91)}</div>}
                      </td>
                      <td className={`${scrollCell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_6m ?? null} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 182)}</div>}
                      </td>
                      <td className={`${scrollCell} text-right tabular-nums`}>
                        <TrackPctCell value={row.ret_1y ?? null} />
                        {showInterval && <div className="text-[10px] text-zinc-400 mt-0.5">{calcInterval(cutoffDate, 365)}</div>}
                      </td>
                      <td className={`${scrollCell} text-right tabular-nums`}><TrackRatioCell value={row.sharpe_1y ?? null} /></td>
                      <td className={`${scrollCell} text-right tabular-nums`}><TrackRatioCell value={row.calmar_1y ?? null} /></td>
                      {fofAddedCols.map((col) => (
                        <td key={col.id} className={`${scrollCell} text-right tabular-nums`}>—</td>
                      ))}
                      <td style={fofStickyRightColStyle(fofStickyRight.trend)} className={stickyRightTrend}>
                        <div className="flex items-center justify-center"
                          onMouseEnter={(e) => {
                            if (!row.beian_hao) return
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
                          }}>
                          <button type="button" className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                            <LineChart className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      <td style={fofStickyRightColStyle(fofStickyRight.docs)} className={stickyRightDocs}>—</td>
                      <td style={fofStickyRightColStyle(fofStickyRight.ops, fofStickyOpsColW)} className={stickyRightOps}>
                        <div className="flex items-center justify-center gap-0.5">
                          <button
                            type="button"
                            disabled={!row.beian_hao}
                            onClick={() => openFofElementsDialog(row.beian_hao, row.product_name)}
                            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <FileSearch className="h-3.5 w-3.5" />
                          </button>
                          <InvestmentManagedProductRowMenu
                            onQueryElements={() => openFofElementsDialog(row.beian_hao, row.product_name)}
                            onEditTags={() => openFofTagDialog(row.beian_hao, row.product_name)}
                            onEditStrategy={() => openFofStrategyDialog(row.beian_hao, row.product_name)}
                            onNoteManage={() => openFofNoteDialog(row.beian_hao, row.product_name)}
                            onValuationAnalysis={() => window.open("/ma/dashboard/tools/valuation", "_blank")}
                            onFavorite={() => toggleFofFavorite(row.id)}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr className="bg-muted font-medium">
                  <td
                    style={{ left: 0, width: fofStickyChkW, minWidth: fofStickyChkW, maxWidth: fofStickyChkW }}
                    className={`border-b px-2 py-2 sticky ${fofStickyBodyZ} bg-muted box-border`}
                  />
                  <td
                    style={{ left: fofStickyLeftSeq, width: fofStickySeqW, minWidth: fofStickySeqW, maxWidth: fofStickySeqW }}
                    className={`border-b px-2 py-2 sticky ${fofStickyBodyZ} bg-muted box-border`}
                  />
                  <td
                    style={{ left: fofStickyLeftName, width: fofStickyNameW, minWidth: fofStickyNameW, maxWidth: fofStickyNameW }}
                    className={`border-b px-3 py-2 text-zinc-600 sticky ${fofStickyBodyZ} bg-muted border-r border-zinc-200 dark:border-zinc-700 ${fofStickyLeftShadow} box-border`}
                  >
                    合计
                  </td>
                  <td className="border-b px-3 py-2 bg-muted" colSpan={3} />
                  <td className="border-b px-3 py-2 text-right tabular-nums bg-muted">{fmtMoney(totalMarketValue)}</td>
                  <td className="border-b px-3 py-2 bg-muted" colSpan={7 + fofAddedCols.length} />
                  <td style={fofStickyRightColStyle(fofStickyRight.trend)} className={`border-b py-2 sticky ${fofStickyBodyZ} bg-muted border-l border-zinc-200 dark:border-zinc-700 ${fofStickyRightShadow}`} />
                  <td style={fofStickyRightColStyle(fofStickyRight.docs)} className={`border-b py-2 sticky ${fofStickyBodyZ} bg-muted`} />
                  <td style={fofStickyRightColStyle(fofStickyRight.ops, fofStickyOpsColW)} className={`border-b py-2 sticky ${fofStickyBodyZ} bg-muted`} />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      ) : (
      <div className="overflow-auto rounded-lg border flex-1 min-h-0">
        <table className="text-sm border-separate border-spacing-0" style={{ minWidth: fofDetailScrollMinW }}>
          <thead>
            <tr className="border-b">
              <th style={{ left: 0, width: fofDetailStickyChkW, minWidth: fofDetailStickyChkW, maxWidth: fofDetailStickyChkW }} className={`${thBase} sticky top-0 ${fofStickyHeadZ} ${fofStickyHeadBg} px-2 text-center box-border`}>
                <input type="checkbox" className="rounded h-3 w-3" checked={selected.size === fofDetailData.length && fofDetailData.length > 0} onChange={toggleAll} />
              </th>
              <th style={{ left: fofDetailStickyLeftSeq, width: fofDetailStickySeqW, minWidth: fofDetailStickySeqW, maxWidth: fofDetailStickySeqW }} className={`${thBase} sticky top-0 ${fofStickyHeadZ} ${fofStickyHeadBg} text-center box-border`}>序号</th>
              <th style={{ left: fofDetailStickyLeftFof, width: fofDetailStickyFofW, minWidth: fofDetailStickyFofW, maxWidth: fofDetailStickyFofW }} className={`${thSort} sticky top-0 ${fofStickyHeadZ} ${fofStickyHeadBg} box-border`} onClick={() => handleDetailSort("fof_fund_name")}>FOF基金<FofDetailSortIcon col="fof_fund_name" /></th>
              <th style={{ left: fofDetailStickyLeftProduct, width: fofDetailStickyProductW, minWidth: fofDetailStickyProductW, maxWidth: fofDetailStickyProductW }} className={`${thSort} sticky top-0 ${fofStickyHeadZ} ${fofStickyHeadBg} box-border border-r border-zinc-200 dark:border-zinc-700 ${fofStickyLeftShadow}`} onClick={() => handleDetailSort("product_name")}>底层基金<FofDetailSortIcon col="product_name" /></th>
              <th className={`${fofScrollHeadSort} min-w-[100px]`} onClick={() => handleDetailSort("beian_hao")}>备案编码<FofDetailSortIcon col="beian_hao" /></th>
              <th className={`${fofScrollHeadSort} min-w-[90px]`} onClick={() => handleDetailSort("unit_nav")}>单位净值<FofDetailSortIcon col="unit_nav" /></th>
              <th className={`${fofScrollHeadSort} min-w-[100px]`} onClick={() => handleDetailSort("nav_date")}>净值日期<FofDetailSortIcon col="nav_date" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[80px]`} onClick={() => handleDetailSort("price_change")}>涨跌幅<FofDetailSortIcon col="price_change" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[120px]`} onClick={() => handleDetailSort("investment_shares")}>投资份额<FofDetailSortIcon col="investment_shares" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[120px]`} onClick={() => handleDetailSort("market_value")}>市值<FofDetailSortIcon col="market_value" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[100px]`} onClick={() => handleDetailSort("market_value_pct")}>市值占比<FofDetailSortIcon col="market_value_pct" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[88px]`} onClick={() => handleDetailSort("ret_1w")}>近一周收益<FofDetailSortIcon col="ret_1w" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[88px]`} onClick={() => handleDetailSort("ret_1m")}>近一月收益<FofDetailSortIcon col="ret_1m" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[88px]`} onClick={() => handleDetailSort("ret_3m")}>近三月收益<FofDetailSortIcon col="ret_3m" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[88px]`} onClick={() => handleDetailSort("ret_6m")}>近六月收益<FofDetailSortIcon col="ret_6m" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[88px]`} onClick={() => handleDetailSort("ret_1y")}>近一年收益<FofDetailSortIcon col="ret_1y" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[98px]`} onClick={() => handleDetailSort("sharpe_1y")}>近一年夏普比率<FofDetailSortIcon col="sharpe_1y" /></th>
              <th className={`${fofScrollHeadSort} text-right min-w-[98px]`} onClick={() => handleDetailSort("calmar_1y")}>近一年卡玛比率<FofDetailSortIcon col="calmar_1y" /></th>
              {fofAddedCols.map((col) => (
                <th key={col.id} className={`${fofScrollHead} text-right min-w-[96px]`}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={detailColSpan} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : fofDetailData.length === 0 ? (
              <tr>
                <td colSpan={detailColSpan} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : (
              <>
                {fofDetailData.map((row, i) => {
                  const isSelected = selected.has(row.id)
                  const rowBg = isSelected ? "bg-blue-50 dark:bg-blue-950/40" : fofStickyCellBg
                  const hoverBg = isSelected ? "group-hover:bg-blue-100 dark:group-hover:bg-blue-900/40" : "group-hover:bg-muted"
                  const scrollCell = `${fofScrollCell} ${isSelected ? "!bg-blue-50 dark:!bg-blue-950/40 group-hover:!bg-blue-100 dark:group-hover:!bg-blue-900/40" : ""}`
                  const stickyCell = `border-b px-3 py-2 ${rowBg} ${hoverBg} transition-colors ${fofStickyBodyZ}`
                  const stickyLeftChk = `${stickyCell} sticky text-center box-border`
                  const stickyLeftSeq = `${stickyCell} sticky text-center tabular-nums text-muted-foreground box-border`
                  const stickyLeftFof = `${stickyCell} sticky box-border`
                  const stickyLeftProduct = `${stickyCell} sticky border-r border-zinc-200 dark:border-zinc-700 ${fofStickyLeftShadow} box-border`
                  return (
                    <tr key={row.id} className="group" style={{ height: 52 }}>
                      <td style={{ left: 0, width: fofDetailStickyChkW, minWidth: fofDetailStickyChkW, maxWidth: fofDetailStickyChkW }} className={`${stickyLeftChk} px-2`}>
                        <input type="checkbox" className="rounded h-3 w-3" checked={isSelected}
                          onChange={() => {
                            const s = new Set(selected)
                            isSelected ? s.delete(row.id) : s.add(row.id)
                            setSelected(s)
                          }} />
                      </td>
                      <td style={{ left: fofDetailStickyLeftSeq, width: fofDetailStickySeqW, minWidth: fofDetailStickySeqW, maxWidth: fofDetailStickySeqW }} className={stickyLeftSeq}>
                        {row.seq_no ?? (page - 1) * pageSize + i + 1}
                      </td>
                      <td style={{ left: fofDetailStickyLeftFof, width: fofDetailStickyFofW, minWidth: fofDetailStickyFofW, maxWidth: fofDetailStickyFofW }} className={stickyLeftFof}>
                        <span className="font-medium text-blue-600 dark:text-blue-400 block truncate leading-5" title={row.fof_fund_name}>{row.fof_fund_name}</span>
                      </td>
                      <td style={{ left: fofDetailStickyLeftProduct, width: fofDetailStickyProductW, minWidth: fofDetailStickyProductW, maxWidth: fofDetailStickyProductW }} className={stickyLeftProduct}>
                        <FundProductNameLink
                          beian_hao={row.beian_hao}
                          product_name={row.product_name}
                          short_name={row.short_name}
                        />
                      </td>
                      <td className={`${scrollCell} tabular-nums text-muted-foreground`}>{row.beian_hao ?? "—"}</td>
                      <td className={`${scrollCell} tabular-nums font-medium`}>{row.unit_nav ? parseFloat(row.unit_nav).toFixed(4) : "—"}</td>
                      <td className={`${scrollCell} tabular-nums`}>{row.nav_date ?? "—"}</td>
                      <td className={`${scrollCell} text-right tabular-nums`}><FofDetailPctCell value={row.price_change} /></td>
                      <td className={`${scrollCell} text-right tabular-nums`}>{row.investment_shares ? parseFloat(row.investment_shares).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</td>
                      <td className={`${scrollCell} text-right tabular-nums font-medium`}>{fmtMoney(row.market_value)}</td>
                      <td className={`${scrollCell} text-right tabular-nums`}>
                        {row.market_value_pct ? (
                          <span className={parseFloat(row.market_value_pct) > 0 ? "text-red-500" : parseFloat(row.market_value_pct) < 0 ? "text-green-600" : ""}>
                            {fmtPct4(row.market_value_pct)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className={`${scrollCell} text-right tabular-nums`}><FofDetailPctCell value={row.ret_1w} /></td>
                      <td className={`${scrollCell} text-right tabular-nums`}><FofDetailPctCell value={row.ret_1m} /></td>
                      <td className={`${scrollCell} text-right tabular-nums`}><FofDetailPctCell value={row.ret_3m} /></td>
                      <td className={`${scrollCell} text-right tabular-nums`}><FofDetailPctCell value={row.ret_6m} /></td>
                      <td className={`${scrollCell} text-right tabular-nums`}><FofDetailPctCell value={row.ret_1y} /></td>
                      <td className={`${scrollCell} text-right tabular-nums`}><TrackRatioCell value={row.sharpe_1y} /></td>
                      <td className={`${scrollCell} text-right tabular-nums`}><TrackRatioCell value={row.calmar_1y} /></td>
                      {fofAddedCols.map((col) => (
                        <td key={col.id} className={`${scrollCell} text-right tabular-nums`}>—</td>
                      ))}
                    </tr>
                  )
                })}
                <tr className="bg-muted font-medium">
                  <td style={{ left: 0, width: fofDetailStickyChkW, minWidth: fofDetailStickyChkW, maxWidth: fofDetailStickyChkW }} className={`border-b px-2 py-2 sticky ${fofStickyBodyZ} bg-muted box-border`} />
                  <td style={{ left: fofDetailStickyLeftSeq, width: fofDetailStickySeqW, minWidth: fofDetailStickySeqW, maxWidth: fofDetailStickySeqW }} className={`border-b px-2 py-2 sticky ${fofStickyBodyZ} bg-muted box-border`} />
                  <td style={{ left: fofDetailStickyLeftFof, width: fofDetailStickyFofW, minWidth: fofDetailStickyFofW, maxWidth: fofDetailStickyFofW }} className={`border-b px-3 py-2 text-zinc-600 sticky ${fofStickyBodyZ} bg-muted box-border`} colSpan={2}>合计</td>
                  <td className="border-b px-3 py-2 bg-muted" colSpan={5} />
                  <td className="border-b px-3 py-2 text-right tabular-nums bg-muted">{fmtMoney(totalMarketValue)}</td>
                  <td className="border-b px-3 py-2 bg-muted" colSpan={8 + fofAddedCols.length} />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      )}

      {viewTab === "summary" && hoverChartRow && hoverChartPos && (() => {
        const popupW = 356
        const popupH = 210
        const vw = typeof window !== "undefined" ? window.innerWidth : 1920
        const vh = typeof window !== "undefined" ? window.innerHeight : 1080
        const left = hoverChartPos.x + popupW > vw ? hoverChartPos.x - popupW - 16 : hoverChartPos.x
        const top = Math.min(hoverChartPos.y, vh - popupH - 8)
        return (
          <div className="fixed z-50 bg-background border rounded-lg shadow-xl pointer-events-none"
            style={{ left, top }}
            onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current) }}
            onMouseLeave={() => setHoverChartRow(null)}>
            <TrendHoverChart beian_hao={hoverChartRow} productName={data.find((r) => r.beian_hao === hoverChartRow)?.product_name ?? ""} />
          </div>
        )
      })()}

      <div className="flex items-center justify-between pt-3 flex-shrink-0">
        <span className="text-sm text-zinc-500">
          共 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{total.toLocaleString()}</span> 条
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">‹</button>
          {pageButtons().map((btn, idx) =>
            btn === "…" ? (
              <span key={`fof-ov-e${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
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
          <div className="relative ml-3">
            <select value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-7 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring">
              {[50, 100, 200].map((n) => <option key={n} value={n}>{n} 条/页</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>

      {showFofElementsDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowFofElementsDialog(false)}>
          <div className="bg-background rounded-lg shadow-2xl w-[780px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">产品要素</span>
              <button onClick={() => setShowFofElementsDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5">
              <h2 className="text-lg font-bold mb-5 pl-3 border-l-4 border-red-500">{fofElementsName}</h2>
              {fofElementsLoading && (
                <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">加载中…</div>
              )}
              {!fofElementsLoading && fofElementsData && fofElementsData.error && (
                <div className="text-sm text-muted-foreground py-8 text-center">暂无产品要素数据</div>
              )}
              {!fofElementsLoading && fofElementsData && !fofElementsData.error && (() => {
                const d = fofElementsData
                const val = (v: string | null | undefined) => v || "—"
                const Row2 = ({ l1, v1, l2, v2 }: { l1: string; v1?: string | null; l2?: string; v2?: string | null }) => (
                  <tr className="border-b border-border/50 last:border-0">
                    <td className="py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap">{l1}</td>
                    <td className="py-2 px-4 text-sm text-foreground">{val(v1)}</td>
                    {l2 !== undefined && <>
                      <td className="py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap">{l2}</td>
                      <td className="py-2 px-4 text-sm text-foreground">{val(v2)}</td>
                    </>}
                  </tr>
                )
                return (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                      <span className="text-sm font-semibold">基本信息</span>
                    </div>
                    <table className="w-full border border-border rounded-lg overflow-hidden mb-5 text-sm">
                      <tbody>
                        <Row2 l1="产品全称" v1={d.fund_name as string} l2="备案编号" v2={d.register_number as string} />
                        <Row2 l1="投资顾问" v1={d.advisor as string} l2="基金管理人" v2={d.fund_manager as string} />
                        <Row2 l1="成立日期" v1={d.inception_date as string} l2="备案日期" v2={d.puton_date as string} />
                        <tr className="border-b border-border/50 last:border-0">
                          <td className="py-2 px-3 text-sm text-muted-foreground bg-muted/30 w-[100px] whitespace-nowrap">托管券商</td>
                          <td className="py-2 px-4 text-sm text-foreground" colSpan={3}>{val(d.custodian as string)}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                      <span className="text-sm font-semibold">申赎信息</span>
                    </div>
                    <table className="w-full border border-border rounded-lg overflow-hidden text-sm">
                      <tbody>
                        <Row2 l1="开放日" v1={d.open_day as string} l2="是否可临开" v2={d.is_temporary_open as string} />
                        <Row2 l1="申购费" v1={d.fee_purchase as string} l2="追加限制" v2={d.add_amount as string} />
                        <Row2 l1="赎回费" v1={d.fee_redeem as string} l2="风险等级" v2={null} />
                        <Row2 l1="预警线" v1={d.precautious_line as string} l2="封闭期" v2={d.closed_period as string} />
                        <Row2 l1="平仓线" v1={d.stop_line as string} l2="锁定期说明" v2={null} />
                        <Row2 l1="管理费率" v1={d.fee_manage_rate as string} l2="托管费" v2={d.fee_trust as string} />
                      </tbody>
                    </table>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {showFofTagDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowFofTagDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[560px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">跟踪产品编辑</span>
              <button onClick={() => setShowFofTagDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="font-semibold text-sm">{fofTagName}</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-16 text-right pt-2 whitespace-nowrap">标签：</span>
                <div className="flex-1 flex flex-wrap gap-1 min-h-[36px] border rounded px-3 py-1.5">
                  {fofTagSelected.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 bg-red-50 border border-red-300 text-red-500 rounded px-2 py-0.5 text-xs">
                      {t}
                      <button onClick={() => setFofTagSelected((p) => p.filter((x) => x !== t))} className="leading-none hover:text-red-700">×</button>
                    </span>
                  ))}
                  {fofTagSelected.length === 0 && <span className="text-xs text-muted-foreground">请选择标签</span>}
                </div>
                <button onClick={() => setFofTagSelected([])} className="text-sm text-blue-500 hover:text-blue-600 shrink-0 pt-2">清空</button>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-16 text-right pt-1.5 whitespace-nowrap">团队标签：</span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-muted/30 rounded px-3 py-2">
                  {fofTagTeamTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setFofTagSelected((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                      className={[
                        "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                        fofTagSelected.includes(tag)
                          ? "bg-red-50 text-red-500 border-red-300"
                          : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                      ].join(" ")}
                    >{tag}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
              <button onClick={() => setShowFofTagDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                disabled={fofTagSaving}
                onClick={async () => {
                  if (!fofTagBeianHao) return
                  setFofTagSaving(true)
                  try {
                    await fetch("/ma/api/tracking-funds/fund-tags", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ beian_hao: fofTagBeianHao, tags: fofTagSelected }),
                    })
                    setShowFofTagDialog(false)
                  } finally {
                    setFofTagSaving(false)
                  }
                }}
                className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {fofTagSaving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFofStrategyDialog && (() => {
        const fofL2Opts = fofStrategyL1 ? (strategyHierarchy.find((n) => n.l1 === fofStrategyL1)?.l2s ?? []) : []
        const fofL3Opts = fofStrategyL2 ? (fofL2Opts.find((n) => n.l2 === fofStrategyL2)?.l3s ?? []) : []
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowFofStrategyDialog(false)}>
            <div className="bg-background rounded-lg shadow-xl w-[480px] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
                <span className="font-semibold text-base">编辑团队策略</span>
                <button onClick={() => setShowFofStrategyDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
              </div>
              <div className="px-6 py-5 flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                  <span className="font-semibold text-sm">{fofStrategyName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-20 text-right whitespace-nowrap">一级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={fofStrategyL1}
                      onChange={(e) => { setFofStrategyL1(e.target.value); setFofStrategyL2(""); setFofStrategyL3("") }}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                      <option value="">请选择一级策略</option>
                      {strategyHierarchy.map((n) => <option key={n.l1} value={n.l1}>{n.l1}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-20 text-right whitespace-nowrap">二级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={fofStrategyL2}
                      onChange={(e) => { setFofStrategyL2(e.target.value); setFofStrategyL3("") }}
                      disabled={fofL2Opts.length === 0}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50">
                      <option value="">{fofStrategyL1 ? "请选择二级策略" : "请先选择一级策略"}</option>
                      {fofL2Opts.map((n) => <option key={n.l2} value={n.l2}>{n.l2}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm shrink-0 w-20 text-right whitespace-nowrap">三级策略：</span>
                  <div className="relative flex-1">
                    <select
                      value={fofStrategyL3}
                      onChange={(e) => setFofStrategyL3(e.target.value)}
                      disabled={fofL3Opts.length === 0}
                      className="w-full appearance-none rounded border border-border bg-background pl-3 pr-8 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50">
                      <option value="">{fofStrategyL2 ? "请选择三级策略" : "请先选择一级策略"}</option>
                      {fofL3Opts.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
                <button onClick={() => setShowFofStrategyDialog(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
                <button
                  disabled={!fofStrategyL1 || fofStrategySaving}
                  onClick={async () => {
                    if (!fofStrategyBeianHao || !fofStrategyL1) return
                    setFofStrategySaving(true)
                    try {
                      await fetch(`/ma/api/private-funds/${encodeURIComponent(fofStrategyBeianHao)}/strategy`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          strategy_l1: fofStrategyL1 || null,
                          strategy_l2: fofStrategyL2 || null,
                          strategy_l3: fofStrategyL3 || null,
                        }),
                      })
                      setShowFofStrategyDialog(false)
                    } finally {
                      setFofStrategySaving(false)
                    }
                  }}
                  className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
                  {fofStrategySaving ? "保存中…" : "确 定"}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {showFofNoteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowFofNoteDialog(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[580px] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">团队备注管理</span>
              <button onClick={() => setShowFofNoteDialog(false)} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 flex-shrink-0" />
                <span className="font-semibold text-sm">{fofNoteName}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm text-foreground"><span className="text-red-500 mr-0.5">*</span>团队备注</label>
                <textarea
                  value={fofNoteText}
                  onChange={(e) => setFofNoteText(e.target.value.slice(0, 250))}
                  placeholder="请输入不大于250字的备注"
                  rows={5}
                  className="w-full rounded border border-border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                />
                <div className="text-right text-xs text-muted-foreground">{fofNoteText.length}/250</div>
              </div>
            </div>
            <div className="flex items-center justify-end px-6 py-3 border-t flex-shrink-0">
              <button
                disabled={fofNoteSaving}
                onClick={async () => {
                  if (!fofNoteBeianHao) return
                  setFofNoteSaving(true)
                  try {
                    await fetch("/ma/api/tracking-funds/fund-note", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ beian_hao: fofNoteBeianHao, note: fofNoteText }),
                    })
                    setShowFofNoteDialog(false)
                  } finally {
                    setFofNoteSaving(false)
                  }
                }}
                className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
                {fofNoteSaving ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      <DirectFieldConfigDialog
        open={showFofFieldConfig}
        selected={fofFieldConfigSelected}
        onClose={() => setShowFofFieldConfig(false)}
        onConfirm={(fields) => { setFofFieldConfigSelected(fields); setShowFofFieldConfig(false) }}
      />

      {showFofAddMetric && (
        <AddMetricModal
          initial={fofAddedCols}
          onClose={() => setShowFofAddMetric(false)}
          onConfirm={(cols) => { setFofAddedCols(cols); setFofActiveTemplate(null); setShowFofAddMetric(false) }}
        />
      )}
    </div>
  )
}

const TRACKING_MGR_TABS = ["基础信息", "跟踪产品", "FOF底层", "尽调报告", "尽调问卷", "投资笔记", "评分表", "管理人资料"] as const

type TrackingMgrSortKey = "manager_name" | "mgmt_scale" | "active_product_count" | "inception_date" | "tracking_date"

interface TrackingManagerRow {
  id: number
  seq_no: number | null
  manager_name: string
  core_strategy: string | null
  mgmt_scale: string | null
  active_product_count: number | null
  inception_date: string | null
  member_type: string | null
  registration_no: string
  contact_person: string | null
  tracking_date: string | null
}

type TrackingProductSortKey =
  | "seq_no" | "manager_name" | "product_name" | "beian_hao" | "unit_nav" | "nav_date" | "price_change"
  | "ret_1w" | "ret_1m" | "ret_3m" | "ret_6m" | "ret_1y"

interface TrackingProductRow {
  id: number
  seq_no: number | null
  manager_name: string
  product_name: string
  beian_hao: string
  unit_nav: string | null
  nav_date: string | null
  price_change: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
}

type TrackingFofSortKey = TrackingProductSortKey | "sharpe_1y" | "calmar_1y"

interface TrackingFofUnderlyingRow extends TrackingProductRow {
  sharpe_1y: string | null
  calmar_1y: string | null
}

function fmtMgrCell(v: string | number | null | undefined): string {
  if (v == null || v === "" || v === "-") return "—"
  return String(v)
}

function InvestmentTrackingManagersView() {
  const [trackTab, setTrackTab] = useState<"team" | "mine">("team")
  const [activeTab, setActiveTab] = useState<string>("基础信息")
  const [coreStrategy, setCoreStrategy] = useState("")
  const [teamTagOptions, setTeamTagOptions] = useState<string[]>([])
  const [teamTags, setTeamTags] = useState<string[]>([])
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [sortKey, setSortKey] = useState<TrackingMgrSortKey>("tracking_date")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [productSortKey, setProductSortKey] = useState<TrackingProductSortKey>("seq_no")
  const [productSortDir, setProductSortDir] = useState<"asc" | "desc">("asc")
  const [fofSortKey, setFofSortKey] = useState<TrackingFofSortKey>("seq_no")
  const [fofSortDir, setFofSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [jumpVal, setJumpVal] = useState("")
  const [data, setData] = useState<TrackingManagerRow[]>([])
  const [productData, setProductData] = useState<TrackingProductRow[]>([])
  const [fofData, setFofData] = useState<TrackingFofUnderlyingRow[]>([])
  const [total, setTotal] = useState(0)
  const [productTotal, setProductTotal] = useState(0)
  const [fofTotal, setFofTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [productLoading, setProductLoading] = useState(false)
  const [fofLoading, setFofLoading] = useState(false)
  const [productSelected, setProductSelected] = useState<Set<number>>(new Set())
  const [fofSelected, setFofSelected] = useState<Set<number>>(new Set())
  const [hoverChartRow, setHoverChartRow] = useState<string | null>(null)
  const [hoverChartPos, setHoverChartPos] = useState<{ x: number; y: number } | null>(null)
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showAuditLog, setShowAuditLog] = useState(false)
  const [showAddMgrMenu, setShowAddMgrMenu] = useState(false)
  const [showSingleAddMgrDialog, setShowSingleAddMgrDialog] = useState(false)
  const [addMgrSearch, setAddMgrSearch] = useState("")
  const [addMgrSelected, setAddMgrSelected] = useState<{ manager_name: string; registration_no: string | null } | null>(null)
  const [addMgrResults, setAddMgrResults] = useState<{ manager_name: string; registration_no: string | null }[]>([])
  const [addMgrShowDropdown, setAddMgrShowDropdown] = useState(false)
  const [addMgrLoading, setAddMgrLoading] = useState(false)
  const [addMgrContact, setAddMgrContact] = useState("")
  const [addMgrSelectedTags, setAddMgrSelectedTags] = useState<string[]>([])
  const [addMgrSaving, setAddMgrSaving] = useState(false)
  const [addMgrError, setAddMgrError] = useState<string | null>(null)
  const [showBatchAddMgrDialog, setShowBatchAddMgrDialog] = useState(false)
  const [batchMgrText, setBatchMgrText] = useState("")
  const [batchMgrSearching, setBatchMgrSearching] = useState(false)
  const [batchMgrResults, setBatchMgrResults] = useState<{ manager_name: string; registration_no: string | null }[]>([])
  const [batchMgrChecked, setBatchMgrChecked] = useState<Set<string>>(new Set())
  const [batchMgrContact, setBatchMgrContact] = useState("")
  const [batchMgrSelectedTags, setBatchMgrSelectedTags] = useState<string[]>([])
  const [batchMgrSaving, setBatchMgrSaving] = useState(false)
  const [batchMgrError, setBatchMgrError] = useState<string | null>(null)
  const [mgrListRefresh, setMgrListRefresh] = useState(0)
  const addMgrSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addMgrDialogOpenedAt = useRef(0)
  const batchMgrDialogOpenedAt = useRef(0)
  const [mgrMounted, setMgrMounted] = useState(false)
  const [favorites, setFavorites] = useState<Set<number>>(() => {
    if (typeof window === "undefined") return new Set()
    try {
      const raw = localStorage.getItem("tracking_mgr_favorites")
      return raw ? new Set(JSON.parse(raw) as number[]) : new Set()
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    fetch("/ma/api/ops/team-tags?category=fund")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setTeamTagOptions(d.map((t: { name: string }) => t.name)) })
      .catch(() => {})
  }, [])

  useEffect(() => { setMgrMounted(true) }, [])

  useEffect(() => {
    setPage(1)
  }, [coreStrategy, keyword, pageSize, trackTab, activeTab])

  useEffect(() => {
    if (trackTab !== "team" || activeTab !== "基础信息") return
    setLoading(true)
    const params = new URLSearchParams({
      page: favoritesOnly ? "1" : String(page),
      pageSize: favoritesOnly ? "100000" : String(pageSize),
      sort: sortKey,
      dir: sortDir,
      keyword,
    })
    if (coreStrategy) params.set("core_strategy", coreStrategy)
    fetch(`/ma/api/tracking-managers/list?${params}`)
      .then((r) => r.json())
      .then((json) => {
        let rows: TrackingManagerRow[] = json.data ?? []
        if (favoritesOnly) {
          rows = rows.filter((r) => favorites.has(r.id))
          setTotal(rows.length)
          const start = (page - 1) * pageSize
          setData(rows.slice(start, start + pageSize))
        } else {
          setData(rows)
          setTotal(json.total ?? 0)
        }
      })
      .catch(() => {
        setData([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }, [trackTab, activeTab, page, pageSize, sortKey, sortDir, keyword, coreStrategy, favoritesOnly, favorites, mgrListRefresh])

  useEffect(() => {
    if (!showSingleAddMgrDialog) return
    if (!addMgrSearch.trim()) {
      setAddMgrResults([])
      setAddMgrShowDropdown(false)
      return
    }
    if (addMgrSearchRef.current) clearTimeout(addMgrSearchRef.current)
    addMgrSearchRef.current = setTimeout(async () => {
      setAddMgrLoading(true)
      try {
        const res = await fetch(`/ma/api/tracking-managers/search?q=${encodeURIComponent(addMgrSearch.trim())}`)
        const json = await res.json()
        setAddMgrResults(Array.isArray(json) ? json : [])
        setAddMgrShowDropdown(true)
      } catch {
        setAddMgrResults([])
      } finally {
        setAddMgrLoading(false)
      }
    }, 300)
    return () => { if (addMgrSearchRef.current) clearTimeout(addMgrSearchRef.current) }
  }, [addMgrSearch, showSingleAddMgrDialog])

  useEffect(() => {
    if (trackTab !== "team" || activeTab !== "跟踪产品") return
    setProductLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: productSortKey,
      dir: productSortDir,
      keyword,
    })
    fetch(`/ma/api/tracking-products/list?${params}`)
      .then((r) => r.json())
      .then((json) => {
        setProductData(json.data ?? [])
        setProductTotal(json.total ?? 0)
      })
      .catch(() => {
        setProductData([])
        setProductTotal(0)
      })
      .finally(() => setProductLoading(false))
  }, [trackTab, activeTab, page, pageSize, productSortKey, productSortDir, keyword])

  useEffect(() => {
    if (trackTab !== "team" || activeTab !== "FOF底层") return
    setFofLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: fofSortKey,
      dir: fofSortDir,
      keyword,
    })
    fetch(`/ma/api/tracking-fof-underlying/list?${params}`)
      .then((r) => r.json())
      .then((json) => {
        setFofData(json.data ?? [])
        setFofTotal(json.total ?? 0)
      })
      .catch(() => {
        setFofData([])
        setFofTotal(0)
      })
      .finally(() => setFofLoading(false))
  }, [trackTab, activeTab, page, pageSize, fofSortKey, fofSortDir, keyword])

  function toggleFavorite(id: number) {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem("tracking_mgr_favorites", JSON.stringify([...next]))
      return next
    })
  }

  function toggleTeamTag(tag: string) {
    setTeamTags((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])
    setPage(1)
  }

  function openSingleAddMgrDialog() {
    addMgrDialogOpenedAt.current = Date.now()
    setShowAddMgrMenu(false)
    setAddMgrSearch("")
    setAddMgrSelected(null)
    setAddMgrResults([])
    setAddMgrShowDropdown(false)
    setAddMgrContact("")
    setAddMgrSelectedTags([])
    setAddMgrError(null)
    setShowSingleAddMgrDialog(true)
  }

  function closeSingleAddMgrDialog() {
    setShowSingleAddMgrDialog(false)
  }

  function mgrResultKey(r: { manager_name: string; registration_no: string | null }) {
    return r.registration_no || r.manager_name
  }

  function openBatchAddMgrDialog() {
    batchMgrDialogOpenedAt.current = Date.now()
    setShowAddMgrMenu(false)
    setBatchMgrText("")
    setBatchMgrResults([])
    setBatchMgrChecked(new Set())
    setBatchMgrContact("")
    setBatchMgrSelectedTags([])
    setBatchMgrError(null)
    setShowBatchAddMgrDialog(true)
  }

  function closeBatchAddMgrDialog() {
    setShowBatchAddMgrDialog(false)
  }

  function refreshTeamTagOptions() {
    fetch("/ma/api/ops/team-tags?category=fund")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setTeamTagOptions(d.map((t: { name: string }) => t.name)) })
      .catch(() => {})
  }

  const addMgrContactOptions = [...new Set(data.map((r) => r.contact_person).filter(Boolean))] as string[]

  function handleSort(col: TrackingMgrSortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("desc") }
    setPage(1)
  }

  function handleProductSort(col: TrackingProductSortKey) {
    if (productSortKey === col) setProductSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setProductSortKey(col); setProductSortDir("desc") }
    setPage(1)
  }

  function handleFofSort(col: TrackingFofSortKey) {
    if (fofSortKey === col) setFofSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setFofSortKey(col); setFofSortDir("desc") }
    setPage(1)
  }

  function toggleProductSelected(id: number) {
    setProductSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllProducts(checked: boolean) {
    if (checked) setProductSelected(new Set(productData.map((r) => r.id)))
    else setProductSelected(new Set())
  }

  function toggleFofSelected(id: number) {
    setFofSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllFof(checked: boolean) {
    if (checked) setFofSelected(new Set(fofData.map((r) => r.id)))
    else setFofSelected(new Set())
  }

  function MgrSortIcon({ col }: { col: TrackingMgrSortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function ProductSortIcon({ col }: { col: TrackingProductSortKey }) {
    if (productSortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return productSortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function FofSortIcon({ col }: { col: TrackingFofSortKey }) {
    if (fofSortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return fofSortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function jumpTo() {
    const n = parseInt(jumpVal)
    if (!isNaN(n)) { setPage(Math.min(totalPages, Math.max(1, n))); setJumpVal("") }
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

  async function handleExport() {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const params = new URLSearchParams({ export: "1", sort: sortKey, dir: sortDir, keyword })
    if (coreStrategy) params.set("core_strategy", coreStrategy)
    const json = await fetch(`/ma/api/tracking-managers/list?${params}`).then((r) => r.json())
    const rows: TrackingManagerRow[] = json.data ?? []
    const headers = ["序号", "管理人名称", "核心策略", "管理规模", "运作中产品数", "成立日期", "会员类型", "登记编号", "对接人", "跟踪日期"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.seq_no != null ? String(r.seq_no) : ""),
        escape(r.manager_name), escape(r.core_strategy), escape(r.mgmt_scale),
        escape(r.active_product_count != null ? String(r.active_product_count) : ""),
        escape(r.inception_date), escape(r.member_type), escape(r.registration_no),
        escape(r.contact_person), escape(r.tracking_date),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `跟踪管理人_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function handleProductExport() {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const params = new URLSearchParams({ export: "1", sort: productSortKey, dir: productSortDir, keyword })
    const json = await fetch(`/ma/api/tracking-products/list?${params}`).then((r) => r.json())
    const rows: TrackingProductRow[] = json.data ?? []
    const headers = ["序号", "管理人名称", "产品名称", "备案编码", "单位净值", "净值日期", "涨跌幅", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.seq_no != null ? String(r.seq_no) : ""),
        escape(r.manager_name), escape(r.product_name), escape(r.beian_hao),
        escape(r.unit_nav), escape(r.nav_date), escape(r.price_change),
        escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m), escape(r.ret_1y),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `跟踪产品_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function handleFofExport() {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const params = new URLSearchParams({ export: "1", sort: fofSortKey, dir: fofSortDir, keyword })
    const json = await fetch(`/ma/api/tracking-fof-underlying/list?${params}`).then((r) => r.json())
    const rows: TrackingFofUnderlyingRow[] = json.data ?? []
    const headers = ["序号", "管理人名称", "产品名称", "备案编码", "单位净值", "净值日期", "涨跌幅", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普比率", "近一年卡玛比率"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.seq_no != null ? String(r.seq_no) : ""),
        escape(r.manager_name), escape(r.product_name), escape(r.beian_hao),
        escape(r.unit_nav), escape(r.nav_date), escape(r.price_change),
        escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m), escape(r.ret_1y),
        escape(r.sharpe_1y), escape(r.calmar_1y),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `FOF底层_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const activeTotal = activeTab === "跟踪产品" ? productTotal : activeTab === "FOF底层" ? fofTotal : total
  const activeLoading = activeTab === "跟踪产品" ? productLoading : activeTab === "FOF底层" ? fofLoading : loading
  const totalPages = Math.max(1, Math.ceil(activeTotal / pageSize))
  const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"
  const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`
  const tdBase = "px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 whitespace-nowrap"

  return (
    <div className="flex flex-col h-full min-w-0 overflow-x-hidden">
      <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0">
        {(["team", "mine"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTrackTab(t)}
            className={[
              "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              trackTab === t
                ? "border-red-500 text-red-600 dark:text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t === "team" ? "团队跟踪" : "我的跟踪"}
          </button>
        ))}
      </div>

      {trackTab === "mine" ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          我的跟踪功能正在建设中，敬请期待
        </div>
      ) : (
        <>
          <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
            <div className="flex items-start px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">核心策略：</span>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  onClick={() => { setCoreStrategy(""); setPage(1) }}
                  className={[
                    "inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors",
                    !coreStrategy
                      ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                      : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                  ].join(" ")}
                >
                  不限
                </span>
                {TRACK_STRATEGIES.filter((s) => s !== "不限").map((s) => (
                  <span
                    key={s}
                    onClick={() => { setCoreStrategy(coreStrategy === s ? "" : s); setPage(1) }}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                      coreStrategy === s
                        ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                        : "border-border text-zinc-500 hover:bg-muted/60",
                    ].join(" ")}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">团队标签：</span>
              <div className="flex items-center gap-2 flex-wrap">
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
            <div className="flex items-center px-4 py-2 gap-4">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">对接人：</span>
              <span className="text-zinc-400 text-xs">—</span>
            </div>
            <div className="flex items-center px-4 py-2 gap-4">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">关 键 字：</span>
              <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-80">
                <input
                  className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
                  placeholder={activeTab === "跟踪产品" || activeTab === "FOF底层" ? "请输入管理人名称，回车搜索" : "请输入跟踪管理人名称，回车搜索"}
                  value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput)}
                />
                <button onClick={() => setKeyword(kwInput)} className="text-muted-foreground hover:text-foreground transition-colors">
                  <Search className="h-3 w-3" />
                </button>
              </div>
              <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded h-3 w-3"
                  checked={favoritesOnly}
                  onChange={(e) => { setFavoritesOnly(e.target.checked); setPage(1) }}
                />
                收藏
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <div className="flex items-center gap-0 border-b overflow-x-auto">
              {TRACKING_MGR_TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={[
                    "px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px whitespace-nowrap",
                    activeTab === tab
                      ? "border-red-500 text-red-600 dark:text-red-400"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-600 flex-shrink-0 ml-4">
              <button onClick={() => setShowAuditLog(true)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                <ClipboardList className="h-3.5 w-3.5" /> 操作日志
              </button>
              <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors opacity-50 cursor-not-allowed" disabled>
                <LayoutTemplate className="h-3.5 w-3.5" />
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowAddMgrMenu((v) => !v)}
                  className="inline-flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white rounded px-3 py-1.5 font-medium transition-colors"
                >
                  <PlusCircle className="h-3.5 w-3.5" /> 添加管理人
                </button>
                {showAddMgrMenu && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowAddMgrMenu(false)} />
                    <div
                      className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[100px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          openSingleAddMgrDialog()
                        }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                      >
                        单只添加
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          openBatchAddMgrDialog()
                        }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                      >
                        批量添加
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {activeTab !== "基础信息" && activeTab !== "跟踪产品" && activeTab !== "FOF底层" ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm border rounded-lg">
              {activeTab}功能正在建设中，敬请期待
            </div>
          ) : (
            <>
              <div className="flex items-center justify-end gap-3 mb-3 flex-shrink-0 text-xs text-zinc-600">
                <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors opacity-50 cursor-not-allowed" disabled>
                  <Settings2 className="h-3.5 w-3.5" /> 字段配置
                </button>
                <button
                  onClick={activeTab === "跟踪产品" ? handleProductExport : activeTab === "FOF底层" ? handleFofExport : handleExport}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <Download className="h-3.5 w-3.5" /> 导出
                </button>
              </div>

              <div className="overflow-auto rounded-lg border flex-1 min-h-0">
                {activeTab === "跟踪产品" ? (
                  <table className="text-sm border-collapse w-full" style={{ minWidth: 1500 }}>
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
                        <th className={`${thBase} w-10`}>
                          <input
                            type="checkbox"
                            className="rounded h-3 w-3"
                            checked={productData.length > 0 && productSelected.size === productData.length}
                            onChange={(e) => toggleAllProducts(e.target.checked)}
                          />
                        </th>
                        <th className={`${thBase} w-12`}>序号</th>
                        <th className={`${thSort} min-w-[140px]`} onClick={() => handleProductSort("manager_name")}>
                          管理人名称<ProductSortIcon col="manager_name" />
                        </th>
                        <th className={`${thSort} min-w-[200px]`} onClick={() => handleProductSort("product_name")}>
                          产品名称<ProductSortIcon col="product_name" />
                        </th>
                        <th className={`${thSort} min-w-[100px]`} onClick={() => handleProductSort("beian_hao")}>
                          备案编码<ProductSortIcon col="beian_hao" />
                        </th>
                        <th className={`${thSort} min-w-[90px] text-right`} onClick={() => handleProductSort("unit_nav")}>
                          单位净值<ProductSortIcon col="unit_nav" />
                        </th>
                        <th className={`${thSort} min-w-[100px]`} onClick={() => handleProductSort("nav_date")}>
                          净值日期<ProductSortIcon col="nav_date" />
                        </th>
                        <th className={`${thSort} min-w-[80px] text-right`} onClick={() => handleProductSort("price_change")}>
                          涨跌幅<ProductSortIcon col="price_change" />
                        </th>
                        <th className={`${thSort} min-w-[88px] text-right`} onClick={() => handleProductSort("ret_1w")}>
                          近一周收益<ProductSortIcon col="ret_1w" />
                        </th>
                        <th className={`${thSort} min-w-[88px] text-right`} onClick={() => handleProductSort("ret_1m")}>
                          近一月收益<ProductSortIcon col="ret_1m" />
                        </th>
                        <th className={`${thSort} min-w-[88px] text-right`} onClick={() => handleProductSort("ret_3m")}>
                          近三月收益<ProductSortIcon col="ret_3m" />
                        </th>
                        <th className={`${thSort} min-w-[88px] text-right`} onClick={() => handleProductSort("ret_6m")}>
                          近六月收益<ProductSortIcon col="ret_6m" />
                        </th>
                        <th className={`${thSort} min-w-[88px] text-right`} onClick={() => handleProductSort("ret_1y")}>
                          近一年收益<ProductSortIcon col="ret_1y" />
                        </th>
                        <th className={`${thBase} text-center w-16`}>走势</th>
                        <th className={`${thBase} text-center w-16`}>资料</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeLoading ? (
                        <tr><td colSpan={15} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
                      ) : productData.length === 0 ? (
                        <tr>
                          <td colSpan={15} className="py-20 text-center text-muted-foreground">
                            <div className="flex flex-col items-center gap-2">
                              <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                              <span>暂无数据</span>
                            </div>
                          </td>
                        </tr>
                      ) : productData.map((row, idx) => (
                        <tr key={row.id} className="border-b hover:bg-muted/30 transition-colors">
                          <td className={tdBase}>
                            <input
                              type="checkbox"
                              className="rounded h-3 w-3"
                              checked={productSelected.has(row.id)}
                              onChange={() => toggleProductSelected(row.id)}
                            />
                          </td>
                          <td className={tdBase}>{row.seq_no ?? (page - 1) * pageSize + idx + 1}</td>
                          <td className={tdBase}>
                            <span className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                              {row.manager_name}
                            </span>
                          </td>
                          <td className={`${tdBase} max-w-[240px] truncate`} title={row.product_name}>{row.product_name}</td>
                          <td className={tdBase}>{row.beian_hao}</td>
                          <td className={`${tdBase} text-right tabular-nums`}>
                            {row.unit_nav ? parseFloat(row.unit_nav).toFixed(4) : "—"}
                          </td>
                          <td className={`${tdBase} tabular-nums`}>{fmtMgrCell(row.nav_date)}</td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.price_change} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.ret_1w} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.ret_1m} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.ret_3m} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.ret_6m} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.ret_1y} /></td>
                          <td className={`${tdBase} text-center`}>
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
                              }}>
                              <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                                <LineChart className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className={`${tdBase} text-center text-muted-foreground`}>—</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : activeTab === "FOF底层" ? (
                  <table className="text-sm border-collapse w-full" style={{ minWidth: 1700 }}>
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
                        <th className={`${thBase} w-10`}>
                          <input
                            type="checkbox"
                            className="rounded h-3 w-3"
                            checked={fofData.length > 0 && fofSelected.size === fofData.length}
                            onChange={(e) => toggleAllFof(e.target.checked)}
                          />
                        </th>
                        <th className={`${thBase} w-12`}>序号</th>
                        <th className={`${thSort} min-w-[140px]`} onClick={() => handleFofSort("manager_name")}>
                          管理人名称<FofSortIcon col="manager_name" />
                        </th>
                        <th className={`${thSort} min-w-[200px]`} onClick={() => handleFofSort("product_name")}>
                          产品名称<FofSortIcon col="product_name" />
                        </th>
                        <th className={`${thSort} min-w-[100px]`} onClick={() => handleFofSort("beian_hao")}>
                          备案编码<FofSortIcon col="beian_hao" />
                        </th>
                        <th className={`${thSort} min-w-[90px] text-right`} onClick={() => handleFofSort("unit_nav")}>
                          单位净值<FofSortIcon col="unit_nav" />
                        </th>
                        <th className={`${thSort} min-w-[100px]`} onClick={() => handleFofSort("nav_date")}>
                          净值日期<FofSortIcon col="nav_date" />
                        </th>
                        <th className={`${thSort} min-w-[80px] text-right`} onClick={() => handleFofSort("price_change")}>
                          涨跌幅<FofSortIcon col="price_change" />
                        </th>
                        <th className={`${thSort} min-w-[88px] text-right`} onClick={() => handleFofSort("ret_1w")}>
                          近一周收益<FofSortIcon col="ret_1w" />
                        </th>
                        <th className={`${thSort} min-w-[88px] text-right`} onClick={() => handleFofSort("ret_1m")}>
                          近一月收益<FofSortIcon col="ret_1m" />
                        </th>
                        <th className={`${thSort} min-w-[88px] text-right`} onClick={() => handleFofSort("ret_3m")}>
                          近三月收益<FofSortIcon col="ret_3m" />
                        </th>
                        <th className={`${thSort} min-w-[88px] text-right`} onClick={() => handleFofSort("ret_6m")}>
                          近六月收益<FofSortIcon col="ret_6m" />
                        </th>
                        <th className={`${thSort} min-w-[88px] text-right`} onClick={() => handleFofSort("ret_1y")}>
                          近一年收益<FofSortIcon col="ret_1y" />
                        </th>
                        <th className={`${thSort} min-w-[100px] text-right`} onClick={() => handleFofSort("sharpe_1y")}>
                          近一年夏普比率<FofSortIcon col="sharpe_1y" />
                        </th>
                        <th className={`${thSort} min-w-[100px] text-right`} onClick={() => handleFofSort("calmar_1y")}>
                          近一年卡玛比率<FofSortIcon col="calmar_1y" />
                        </th>
                        <th className={`${thBase} text-center w-16`}>走势</th>
                        <th className={`${thBase} text-center w-16`}>资料</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeLoading ? (
                        <tr><td colSpan={17} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
                      ) : fofData.length === 0 ? (
                        <tr>
                          <td colSpan={17} className="py-20 text-center text-muted-foreground">
                            <div className="flex flex-col items-center gap-2">
                              <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                              <span>暂无数据</span>
                            </div>
                          </td>
                        </tr>
                      ) : fofData.map((row, idx) => (
                        <tr key={row.id} className="border-b hover:bg-muted/30 transition-colors">
                          <td className={tdBase}>
                            <input
                              type="checkbox"
                              className="rounded h-3 w-3"
                              checked={fofSelected.has(row.id)}
                              onChange={() => toggleFofSelected(row.id)}
                            />
                          </td>
                          <td className={tdBase}>{row.seq_no ?? (page - 1) * pageSize + idx + 1}</td>
                          <td className={tdBase}>
                            <span className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                              {row.manager_name}
                            </span>
                          </td>
                          <td className={`${tdBase} max-w-[240px] truncate`} title={row.product_name}>{row.product_name}</td>
                          <td className={tdBase}>{row.beian_hao}</td>
                          <td className={`${tdBase} text-right tabular-nums`}>
                            {row.unit_nav ? parseFloat(row.unit_nav).toFixed(4) : "—"}
                          </td>
                          <td className={`${tdBase} tabular-nums`}>{fmtMgrCell(row.nav_date)}</td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.price_change} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.ret_1w} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.ret_1m} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.ret_3m} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.ret_6m} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><PctCell value={row.ret_1y} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><TrackRatioCell value={row.sharpe_1y} /></td>
                          <td className={`${tdBase} text-right tabular-nums`}><TrackRatioCell value={row.calmar_1y} /></td>
                          <td className={`${tdBase} text-center`}>
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
                              }}>
                              <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                                <LineChart className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className={`${tdBase} text-center text-muted-foreground`}>—</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                <table className="text-sm border-collapse w-full" style={{ minWidth: 1200 }}>
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
                      <th className={`${thBase} w-12`}>序号</th>
                      <th className={`${thSort} min-w-[160px]`} onClick={() => handleSort("manager_name")}>
                        管理人名称<MgrSortIcon col="manager_name" />
                      </th>
                      <th className={`${thBase} min-w-[90px]`}>核心策略</th>
                      <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("mgmt_scale")}>
                        管理规模<MgrSortIcon col="mgmt_scale" />
                      </th>
                      <th className={`${thSort} min-w-[110px]`} onClick={() => handleSort("active_product_count")}>
                        运作中产品数<MgrSortIcon col="active_product_count" />
                      </th>
                      <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("inception_date")}>
                        成立日期<MgrSortIcon col="inception_date" />
                      </th>
                      <th className={`${thBase} min-w-[90px]`}>会员类型</th>
                      <th className={`${thBase} min-w-[100px]`}>登记编号</th>
                      <th className={`${thBase} min-w-[80px]`}>对接人</th>
                      <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("tracking_date")}>
                        跟踪日期<MgrSortIcon col="tracking_date" />
                      </th>
                      <th className={`${thBase} text-center w-24`}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeLoading ? (
                      <tr><td colSpan={11} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
                    ) : data.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-20 text-center text-muted-foreground">
                          <div className="flex flex-col items-center gap-2">
                            <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                            <span>暂无数据</span>
                          </div>
                        </td>
                      </tr>
                    ) : data.map((row, idx) => (
                      <tr key={row.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className={tdBase}>{row.seq_no ?? (page - 1) * pageSize + idx + 1}</td>
                        <td className={tdBase}>
                          <span className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                            {row.manager_name}
                          </span>
                        </td>
                        <td className={tdBase}>{fmtMgrCell(row.core_strategy)}</td>
                        <td className={tdBase}>{fmtMgrCell(row.mgmt_scale)}</td>
                        <td className={tdBase}>{fmtMgrCell(row.active_product_count)}</td>
                        <td className={tdBase}>{fmtMgrCell(row.inception_date)}</td>
                        <td className={tdBase}>{fmtMgrCell(row.member_type)}</td>
                        <td className={tdBase}>{row.registration_no}</td>
                        <td className={tdBase}>{fmtMgrCell(row.contact_person)}</td>
                        <td className={tdBase}>{fmtMgrCell(row.tracking_date)}</td>
                        <td className={`${tdBase} text-center`}>
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => toggleFavorite(row.id)}
                              className="text-muted-foreground hover:text-amber-500 transition-colors"
                              title="收藏"
                            >
                              <Star className={`h-3.5 w-3.5 ${favorites.has(row.id) ? "fill-amber-400 text-amber-400" : ""}`} />
                            </button>
                            <button className="text-muted-foreground hover:text-foreground transition-colors" title="编辑">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button className="text-muted-foreground hover:text-foreground transition-colors" title="查看">
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>

              <div className="flex items-center justify-between mt-3 flex-shrink-0 text-xs text-zinc-600">
                <span>共 {activeTotal} 条</span>
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
                  <div className="flex items-center gap-1 ml-2">
                    <span>跳至</span>
                    <input
                      className="w-10 h-7 border rounded text-center text-xs outline-none focus:ring-1 focus:ring-ring"
                      value={jumpVal}
                      onChange={(e) => setJumpVal(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && jumpTo()}
                    />
                    <span>页</span>
                  </div>
                  <div className="relative ml-3">
                    <select value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
                      className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-7 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring">
                      {[50, 100, 200].map((n) => <option key={n} value={n}>{n} 条/页</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {hoverChartRow && hoverChartPos && (activeTab === "跟踪产品" || activeTab === "FOF底层") && (() => {
        const popupW = 356
        const popupH = 210
        const vw = typeof window !== "undefined" ? window.innerWidth : 1920
        const vh = typeof window !== "undefined" ? window.innerHeight : 1080
        const left = hoverChartPos.x + popupW > vw ? hoverChartPos.x - popupW - 16 : hoverChartPos.x
        const top = Math.min(hoverChartPos.y, vh - popupH - 8)
        const chartRows = activeTab === "FOF底层" ? fofData : productData
        const hoverRow = chartRows.find((r) => r.beian_hao === hoverChartRow)
        return (
          <div
            className="fixed z-[9999] bg-background border rounded-xl shadow-2xl"
            style={{ left, top, width: popupW }}
            onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current) }}
            onMouseLeave={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current); hoverTimeout.current = setTimeout(() => setHoverChartRow(null), 150) }}>
            <div className="px-3 pt-3 pb-1 font-semibold text-sm border-b">收益走势</div>
            <TrendHoverChart beian_hao={hoverChartRow} productName={hoverRow?.product_name ?? ""} />
          </div>
        )
      })()}

      {mgrMounted && showSingleAddMgrDialog && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
          onMouseDown={(e) => {
            if (e.target !== e.currentTarget) return
            if (Date.now() - addMgrDialogOpenedAt.current < 200) return
            closeSingleAddMgrDialog()
          }}
        >
          <div className="bg-background rounded-lg shadow-xl w-[560px] flex flex-col" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <span className="font-semibold text-base">添加管理人</span>
              <button type="button" onClick={closeSingleAddMgrDialog} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-16 text-right pt-2"><span className="text-red-500 mr-0.5">*</span>管理人：</span>
                <div className="flex flex-1 flex-col gap-0 relative">
                  {addMgrSelected ? (
                    <div className="flex items-center justify-between border rounded px-3 h-9">
                      <div className="flex flex-col leading-tight min-w-0">
                        <span className="text-sm font-medium truncate">{addMgrSelected.manager_name}</span>
                        {addMgrSelected.registration_no && (
                          <span className="text-xs text-muted-foreground truncate">{addMgrSelected.registration_no}</span>
                        )}
                      </div>
                      <button
                        onClick={() => { setAddMgrSelected(null); setAddMgrSearch(""); setAddMgrShowDropdown(false) }}
                        className="text-muted-foreground hover:text-foreground text-base leading-none ml-2 shrink-0"
                      >×</button>
                    </div>
                  ) : (
                    <div className="flex items-center border rounded px-3 h-9 gap-2">
                      <input
                        autoFocus
                        type="text"
                        value={addMgrSearch}
                        onChange={(e) => { setAddMgrSearch(e.target.value); setAddMgrSelected(null) }}
                        onFocus={() => { if (addMgrResults.length > 0) setAddMgrShowDropdown(true) }}
                        placeholder="输入关键字搜索"
                        className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50"
                      />
                      {addMgrLoading
                        ? <svg className="h-3.5 w-3.5 animate-spin text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round"/></svg>
                        : <Search className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
                      }
                    </div>
                  )}
                  {addMgrShowDropdown && addMgrResults.length > 0 && !addMgrSelected && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-xl max-h-56 overflow-y-auto">
                      {addMgrResults.map((r, idx) => (
                        <button
                          key={`${r.manager_name}-${r.registration_no ?? idx}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setAddMgrSelected(r)
                            setAddMgrSearch("")
                            setAddMgrShowDropdown(false)
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                        >
                          <div className="text-sm truncate">{r.manager_name}</div>
                          {r.registration_no && <div className="text-xs text-muted-foreground truncate">{r.registration_no}</div>}
                        </button>
                      ))}
                    </div>
                  )}
                  {addMgrShowDropdown && addMgrResults.length === 0 && !addMgrLoading && addMgrSearch.trim() && !addMgrSelected && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-xl px-4 py-3 text-sm text-muted-foreground">
                      未找到匹配的管理人
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm shrink-0 w-16 text-right">对接人：</span>
                <div className="relative flex-1">
                  <select
                    value={addMgrContact}
                    onChange={(e) => setAddMgrContact(e.target.value)}
                    className="w-full h-9 appearance-none border rounded px-3 pr-8 text-sm bg-background text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">请选择对接人</option>
                    {addMgrContactOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm shrink-0 w-16 text-right">标签：</span>
                <div className="flex flex-1 items-center flex-wrap border rounded px-3 min-h-[36px] gap-1.5 py-1">
                  {addMgrSelectedTags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 bg-muted text-zinc-700 dark:text-zinc-200 rounded px-2 py-0.5 text-xs">
                      {tag}
                      <button onClick={() => setAddMgrSelectedTags((p) => p.filter((t) => t !== tag))} className="hover:text-red-500 leading-none ml-0.5">×</button>
                    </span>
                  ))}
                  {addMgrSelectedTags.length === 0 && (
                    <span className="text-sm text-muted-foreground/40">请选择标签</span>
                  )}
                </div>
                <button
                  onClick={() => setAddMgrSelectedTags([])}
                  className="text-sm text-blue-500 hover:text-blue-600 transition-colors shrink-0"
                >
                  清空
                </button>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-16 text-right pt-1.5">团队标签：</span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-muted/30 rounded px-3 py-2">
                  {teamTagOptions.length === 0 && (
                    <span className="text-sm text-muted-foreground flex-shrink-0">暂无标签，可点击「设置」添加后刷新</span>
                  )}
                  {teamTagOptions.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setAddMgrSelectedTags((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                      className={[
                        "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                        addMgrSelectedTags.includes(tag)
                          ? "bg-red-50 text-red-500 border-red-300"
                          : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                      ].join(" ")}
                    >{tag}</button>
                  ))}
                  <button
                    onClick={() => window.open("/ma/dashboard/private-funds?tab=operations&side=ops-strategy-tags&ops=tags", "_blank")}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors ml-1"
                  >
                    <Settings2 className="h-3 w-3" /> 设置
                  </button>
                  <button
                    onClick={refreshTeamTagOptions}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" /> 刷新
                  </button>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 px-6 py-4 border-t flex-shrink-0">
              {addMgrError && (
                <p className="text-xs text-red-500 text-right">
                  {addMgrError === "already_exists" ? "该管理人已在跟踪列表中" : `添加失败：${addMgrError}`}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowSingleAddMgrDialog(false)}
                  disabled={addMgrSaving}
                  className="px-4 py-2 text-sm border rounded hover:bg-muted transition-colors disabled:opacity-50"
                >
                  取 消
                </button>
                <button
                  disabled={!addMgrSelected || addMgrSaving}
                  onClick={async () => {
                    if (!addMgrSelected) return
                    setAddMgrSaving(true)
                    setAddMgrError(null)
                    try {
                      const res = await fetch("/ma/api/tracking-managers", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          manager_name: addMgrSelected.manager_name,
                          registration_no: addMgrSelected.registration_no || addMgrSelected.manager_name,
                          contact_person: addMgrContact || null,
                        }),
                      })
                      const json = await res.json()
                      if (!res.ok) {
                        setAddMgrError(json.error || "unknown")
                        return
                      }
                      setShowSingleAddMgrDialog(false)
                      setActiveTab("基础信息")
                      setMgrListRefresh((n) => n + 1)
                    } catch {
                      setAddMgrError("network_error")
                    } finally {
                      setAddMgrSaving(false)
                    }
                  }}
                  className="px-4 py-2 text-sm rounded bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addMgrSaving ? "提交中…" : "确 定"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {mgrMounted && showBatchAddMgrDialog && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
          onMouseDown={(e) => {
            if (e.target !== e.currentTarget) return
            if (Date.now() - batchMgrDialogOpenedAt.current < 200) return
            closeBatchAddMgrDialog()
          }}
        >
          <div className="bg-background rounded-lg shadow-xl w-[780px] max-h-[90vh] flex flex-col p-6" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5 shrink-0">
              <span className="font-semibold text-base">添加跟踪管理人</span>
              <button type="button" onClick={closeBatchAddMgrDialog} className="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none">×</button>
            </div>

            <div className="mb-5 shrink-0">
              <div className="flex items-center gap-1 mb-3">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                <span className="font-medium text-sm">添加管理人</span>
              </div>
              <div className="flex gap-3" style={{ height: 220 }}>
                <div className="flex flex-col flex-1">
                  <div className="text-xs text-muted-foreground mb-1">剪贴板</div>
                  <textarea
                    className="flex-1 w-full border rounded p-2 text-sm bg-transparent resize-none outline-none placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-ring"
                    placeholder={"将管理人全称/简称/登记编号粘贴至此，内容要\n分行，如：\n     xxxxx1\n     xxxxx2\n     xxxxx3"}
                    value={batchMgrText}
                    onChange={(e) => setBatchMgrText(e.target.value)}
                  />
                </div>
                <div className="flex items-center shrink-0">
                  <button
                    type="button"
                    disabled={batchMgrSearching || !batchMgrText.trim()}
                    onClick={async () => {
                      const keywords = batchMgrText.split("\n").map((l) => l.trim()).filter(Boolean)
                      if (keywords.length === 0) return
                      setBatchMgrSearching(true)
                      setBatchMgrResults([])
                      setBatchMgrChecked(new Set())
                      try {
                        const res = await fetch("/ma/api/tracking-managers/batch-search", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ keywords }),
                        })
                        const json = await res.json()
                        const found: { manager_name: string; registration_no: string | null }[] = json.results ?? []
                        setBatchMgrResults(found)
                        setBatchMgrChecked(new Set(found.map(mgrResultKey)))
                      } catch {
                        // ignore
                      } finally {
                        setBatchMgrSearching(false)
                      }
                    }}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    {batchMgrSearching
                      ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round"/></svg>
                      : "搜索 >"}
                  </button>
                </div>
                <div className="flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">搜索成功</span>
                    {batchMgrResults.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setBatchMgrResults([]); setBatchMgrChecked(new Set()) }}
                        className="text-xs text-blue-500 hover:text-blue-600 transition-colors"
                      >
                        删除
                      </button>
                    )}
                  </div>
                  <div className="flex-1 border rounded overflow-auto">
                    {batchMgrResults.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-2">
                        <Inbox className="h-9 w-9 opacity-30" strokeWidth={1} />
                        <span className="text-xs">暂无数据</span>
                      </div>
                    ) : (
                      <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 bg-muted/60">
                          <tr>
                            <th className="w-8 px-2 py-1.5 text-left">
                              <input
                                type="checkbox"
                                className="rounded h-3 w-3"
                                checked={batchMgrChecked.size === batchMgrResults.length}
                                onChange={(e) => setBatchMgrChecked(e.target.checked ? new Set(batchMgrResults.map(mgrResultKey)) : new Set())}
                              />
                            </th>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">管理人简称</th>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">登记编号</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batchMgrResults.map((r) => {
                            const key = mgrResultKey(r)
                            return (
                              <tr key={key} className="border-t hover:bg-muted/30 transition-colors">
                                <td className="px-2 py-1.5">
                                  <input
                                    type="checkbox"
                                    className="rounded h-3 w-3"
                                    checked={batchMgrChecked.has(key)}
                                    onChange={(e) => {
                                      const next = new Set(batchMgrChecked)
                                      if (e.target.checked) next.add(key)
                                      else next.delete(key)
                                      setBatchMgrChecked(next)
                                    }}
                                  />
                                </td>
                                <td className="px-2 py-1.5 max-w-[160px] truncate" title={r.manager_name}>{r.manager_name}</td>
                                <td className="px-2 py-1.5 text-muted-foreground">{r.registration_no || "—"}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mb-5 shrink-0">
              <div className="flex items-center gap-1 mb-3">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                <span className="font-medium text-sm">设置项</span>
              </div>
              <div className="flex items-center gap-3 mb-2.5">
                <span className="text-sm shrink-0 w-[5.5rem] text-right">统一对接人：</span>
                <div className="relative flex-1">
                  <select
                    value={batchMgrContact}
                    onChange={(e) => setBatchMgrContact(e.target.value)}
                    className="w-full h-9 appearance-none border rounded px-3 pr-8 text-sm bg-background text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">请选择对接人</option>
                    {addMgrContactOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                </div>
              </div>
              <div className="flex items-center gap-3 mb-2.5">
                <span className="text-sm shrink-0 w-[5.5rem] text-right">标签：</span>
                <div className="flex flex-1 items-center flex-wrap border rounded px-3 min-h-[36px] gap-1.5 py-1">
                  {batchMgrSelectedTags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 bg-muted text-zinc-700 dark:text-zinc-200 rounded px-2 py-0.5 text-xs">
                      {tag}
                      <button type="button" onClick={() => setBatchMgrSelectedTags((p) => p.filter((t) => t !== tag))} className="hover:text-red-500 leading-none ml-0.5">×</button>
                    </span>
                  ))}
                  {batchMgrSelectedTags.length === 0 && (
                    <span className="text-sm text-muted-foreground/40">请选择标签</span>
                  )}
                </div>
                <button type="button" onClick={() => setBatchMgrSelectedTags([])} className="text-sm text-blue-500 hover:text-blue-600 transition-colors shrink-0">清空</button>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-sm shrink-0 w-[5.5rem] text-right pt-1.5">团队标签：</span>
                <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-muted/30 rounded px-3 py-2">
                  {teamTagOptions.length === 0 && (
                    <span className="text-sm text-muted-foreground flex-shrink-0">暂无标签，可点击「设置」添加后刷新</span>
                  )}
                  {teamTagOptions.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setBatchMgrSelectedTags((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                      className={[
                        "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                        batchMgrSelectedTags.includes(tag)
                          ? "bg-red-50 text-red-500 border-red-300"
                          : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                      ].join(" ")}
                    >{tag}</button>
                  ))}
                  <button
                    type="button"
                    onClick={() => window.open("/ma/dashboard/private-funds?tab=operations&side=ops-strategy-tags&ops=tags", "_blank")}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors ml-1"
                  >
                    <Settings2 className="h-3 w-3" /> 设置
                  </button>
                  <button
                    type="button"
                    onClick={refreshTeamTagOptions}
                    className="inline-flex items-center gap-1 border border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" /> 刷新
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 shrink-0">
              {batchMgrError && (
                <p className="text-xs text-red-500 text-right">{batchMgrError}</p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeBatchAddMgrDialog}
                  disabled={batchMgrSaving}
                  className="px-4 py-2 text-sm border rounded hover:bg-muted transition-colors disabled:opacity-50"
                >
                  取 消
                </button>
                <button
                  type="button"
                  disabled={batchMgrChecked.size === 0 || batchMgrSaving}
                  onClick={async () => {
                    const toAdd = batchMgrResults.filter((r) => batchMgrChecked.has(mgrResultKey(r)))
                    if (toAdd.length === 0) return
                    setBatchMgrSaving(true)
                    setBatchMgrError(null)
                    try {
                      const results = await Promise.all(
                        toAdd.map((r) =>
                          fetch("/ma/api/tracking-managers", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              manager_name: r.manager_name,
                              registration_no: r.registration_no || r.manager_name,
                              contact_person: batchMgrContact || null,
                            }),
                          }).then((res) => res.json()),
                        ),
                      )
                      const failed = results.filter((r) => r.error && r.error !== "already_exists")
                      if (failed.length > 0) {
                        setBatchMgrError(`${failed.length} 个添加失败`)
                      } else {
                        closeBatchAddMgrDialog()
                        setActiveTab("基础信息")
                        setMgrListRefresh((n) => n + 1)
                      }
                    } catch {
                      setBatchMgrError("网络错误，请重试")
                    } finally {
                      setBatchMgrSaving(false)
                    }
                  }}
                  className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {batchMgrSaving ? "保存中…" : "确 定"}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <OpsAuditLogDialog open={showAuditLog} onClose={() => setShowAuditLog(false)} />
    </div>
  )
}

// ─── PortfolioNewView ──────────────────────────────────────────────────────

function PortfolioBuildIcon({ variant }: { variant: "free" | "model" }) {
  const gradId = `portfolio-cube-fill-${variant}`
  return (
    <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-red-100 via-rose-100 to-pink-200 dark:from-red-950/40 dark:via-rose-950/30 dark:to-pink-950/20 flex items-center justify-center flex-shrink-0 shadow-sm">
      <svg viewBox="0 0 48 48" className="h-9 w-9" fill="none" aria-hidden>
        <path
          d="M24 8L38 16V32L24 40L10 32V16L24 8Z"
          fill={`url(#${gradId})`}
          stroke="#f87171"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M24 8V24M24 24L10 16M24 24L38 16M24 24V40" stroke="#fb7185" strokeWidth="1.2" strokeLinejoin="round" />
        {variant === "free" ? (
          <path d="M24 14V22M20 18H28" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        ) : (
          <path
            d="M32 12C35 14 36.5 17 36 20.5C35.2 25.8 30.8 29 25.5 28.2C22.8 27.8 20.5 26.2 19 24"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}
        <defs>
          <linearGradient id={gradId} x1="10" y1="8" x2="38" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fda4af" />
            <stop offset="1" stopColor="#fb7185" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

const PORTFOLIO_CREATE_OPTIONS = [
  {
    key: "free" as const,
    title: "自由构建",
    subtitle: "灵活配置，掌控每一步投资",
    features: [
      { label: "自由选基", desc: "多种产品类型自由搭配，轻松构建专属投资组合" },
      { label: "灵活调仓", desc: "支持按照金额或份额进行中频调仓，操作更贴合交易习惯" },
      { label: "全程掌控", desc: "从配置到交易，每一步由您决定，灵活配置不受限" },
    ],
  },
  {
    key: "model" as const,
    title: "模型构建",
    subtitle: "科学调仓，自动执行",
    features: [
      { label: "智能模型", desc: "融合均值方差、风险平价等经典模型，一键生成最优权重方案" },
      { label: "自动化执行", desc: "系统根据模型输出自动完成调仓，组合调仓无需手动操作" },
      { label: "省心省力", desc: "模型驱动，精准调仓，告别复杂计算" },
    ],
  },
]

function EfficientFrontierDiagram() {
  return (
    <div className="relative w-full max-w-[320px] mx-auto">
      <svg viewBox="0 0 320 260" className="w-full h-auto" aria-label="有效边界示意图">
        {/* axes */}
        <line x1="48" y1="220" x2="300" y2="220" stroke="#d4d4d8" strokeWidth="1.5" />
        <line x1="48" y1="220" x2="48" y2="24" stroke="#d4d4d8" strokeWidth="1.5" />
        <polygon points="300,220 294,216 294,224" fill="#a1a1aa" />
        <polygon points="48,24 44,32 52,32" fill="#a1a1aa" />
        <text x="302" y="224" className="fill-zinc-500 text-[11px]">σ<tspan baselineShift="sub" fontSize="9">p</tspan></text>
        <text x="18" y="28" className="fill-zinc-500 text-[11px]">E(r<tspan baselineShift="sub" fontSize="9">p</tspan>)</text>

        {/* inefficient frontier (lower, dashed) */}
        <path
          d="M 92 118 C 130 168, 210 198, 278 208"
          fill="none"
          stroke="#fca5a5"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        {/* efficient frontier (upper, solid) */}
        <path
          d="M 92 118 C 118 72, 188 42, 278 58"
          fill="none"
          stroke="#ef4444"
          strokeWidth="2"
        />

        {/* individual assets */}
        {[
          [118, 148], [142, 132], [168, 118], [196, 108], [214, 142], [176, 156], [148, 168],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="4" fill="#fff" stroke="#f87171" strokeWidth="1.5" />
        ))}

        {/* minimum variance portfolio */}
        <circle cx="92" cy="118" r="5" fill="#ef4444" stroke="#fff" strokeWidth="1.5" />

        {/* labels */}
        <text x="58" y="108" className="fill-zinc-700 text-[10px]">最小方差</text>
        <text x="58" y="120" className="fill-zinc-700 text-[10px]">资产组合</text>
        <text x="188" y="36" className="fill-red-500 text-[11px] font-medium">有效边界</text>
        <text x="196" y="196" className="fill-zinc-400 text-[11px]">无效边界</text>
        <text x="228" y="128" className="fill-zinc-500 text-[10px]">单个资产</text>
      </svg>
    </div>
  )
}

function RiskParityDiagram() {
  return (
    <div className="relative w-full max-w-[320px] mx-auto">
      <svg viewBox="0 0 320 260" className="w-full h-auto" aria-label="风险平价示意图">
        <line x1="48" y1="220" x2="300" y2="220" stroke="#d4d4d8" strokeWidth="1.5" />
        <line x1="48" y1="220" x2="48" y2="24" stroke="#d4d4d8" strokeWidth="1.5" />
        {[0, 1, 2, 3].map((i) => {
          const x = 88 + i * 52
          const h = 72 + (i % 2) * 18
          return (
            <g key={i}>
              <rect x={x} y={220 - h} width="36" height={h} rx="4" fill="#fecaca" stroke="#f87171" strokeWidth="1.2" />
              <text x={x + 18} y={232} textAnchor="middle" className="fill-zinc-500 text-[10px]">资产{i + 1}</text>
              <text x={x + 18} y={220 - h - 8} textAnchor="middle" className="fill-red-500 text-[10px] font-medium">RC≈25%</text>
            </g>
          )
        })}
        <text x="148" y="28" textAnchor="middle" className="fill-zinc-700 text-[11px] font-medium">各资产风险贡献均衡</text>
      </svg>
    </div>
  )
}

function BlackLittermanDiagram() {
  return (
    <div className="relative w-full max-w-[320px] mx-auto">
      <svg viewBox="0 0 320 260" className="w-full h-auto" aria-label="Black-Litterman 示意图">
        <rect x="36" y="48" width="96" height="56" rx="8" fill="#fff7ed" stroke="#fdba74" strokeWidth="1.5" />
        <text x="84" y="72" textAnchor="middle" className="fill-zinc-700 text-[11px] font-medium">市场均衡</text>
        <text x="84" y="90" textAnchor="middle" className="fill-zinc-500 text-[10px]">隐含收益 π</text>

        <rect x="188" y="48" width="96" height="56" rx="8" fill="#fef2f2" stroke="#fca5a5" strokeWidth="1.5" />
        <text x="236" y="72" textAnchor="middle" className="fill-zinc-700 text-[11px] font-medium">投资者观点</text>
        <text x="236" y="90" textAnchor="middle" className="fill-zinc-500 text-[10px]">主观预期 Q</text>

        <path d="M 132 76 L 152 76" stroke="#a1a1aa" strokeWidth="1.5" markerEnd="url(#bl-arrow)" />
        <path d="M 188 76 L 168 76" stroke="#a1a1aa" strokeWidth="1.5" />

        <rect x="108" y="148" width="104" height="56" rx="8" fill="#fff" stroke="#ef4444" strokeWidth="1.5" />
        <text x="160" y="172" textAnchor="middle" className="fill-red-600 text-[11px] font-medium">后验预期收益</text>
        <text x="160" y="190" textAnchor="middle" className="fill-zinc-500 text-[10px]">E[R]</text>

        <path d="M 84 104 L 132 148" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d="M 236 104 L 188 148" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 3" />

        <defs>
          <marker id="bl-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#a1a1aa" />
          </marker>
        </defs>
      </svg>
    </div>
  )
}

const PORTFOLIO_MODEL_TABS = [
  { key: "mean-variance", label: "均值方差" },
  { key: "risk-parity", label: "风险平价" },
  { key: "black-litterman", label: "Black-Litterman" },
] as const

type PortfolioModelTab = (typeof PORTFOLIO_MODEL_TABS)[number]["key"]

function PortfolioModelIntroPanel({ activeTab }: { activeTab: PortfolioModelTab }) {
  if (activeTab === "mean-variance") {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <EfficientFrontierDiagram />
        <div className="space-y-4 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          <p>
            1952 年，H.M.Markowitz 提出了经典的<strong className="text-foreground font-medium">均值方差模型</strong>。
            该模型基于以下假设：投资者依据资产收益率的概率分布做出决策，用方差（或标准差）衡量风险，
            在给定风险水平下追求收益最大化，或在给定收益水平下追求风险最小化。
          </p>
          <p>
            投资组合的风险可表示为：
            <span className="block my-2 pl-1 font-mono text-[13px] text-foreground">
              σ<sub>p</sub> = √<span className="inline-block align-middle">(</span>Σ<sub>i,j</sub><sup>n</sup> w<sub>i</sub> w<sub>j</sub> cov(r<sub>i</sub>, r<sub>j</sub>)<span className="inline-block align-middle">)</span>
            </span>
          </p>
          <ul className="space-y-1.5 list-none">
            <li><span className="text-foreground">w<sub>i</sub></span>：投资于资产 i 的资金比例，且 Σw<sub>i</sub> = 1；</li>
            <li><span className="text-foreground">E(r<sub>i</sub>)</span>：资产 i 的预期收益率；</li>
            <li><span className="text-foreground">cov(r<sub>i</sub>, r<sub>j</sub>)</span>：资产 i 与资产 j 收益率之间的协方差。</li>
          </ul>
          <p>
            在目标预期收益 μ 的约束下：
            <span className="block my-2 pl-1 font-mono text-[13px] text-foreground">Σ w<sub>i</sub> E(r<sub>i</sub>) ≥ μ</span>
            通过调整权重 w<sub>i</sub>，可以在满足目标收益 μ 的条件下，最小化组合风险 σ<sub>p</sub>。
          </p>
        </div>
      </div>
    )
  }

  if (activeTab === "risk-parity") {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <RiskParityDiagram />
        <div className="space-y-4 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          <p>
            <strong className="text-foreground font-medium">风险平价模型</strong>
            的核心思想是让组合中各资产对总风险的贡献趋于均衡，而非简单按市值或预期收益分配权重。
            在低相关资产间分散配置时，通常能获得更稳健的风险收益特征。
          </p>
          <p>
            资产 i 的风险贡献 RC<sub>i</sub> 可表示为：
            <span className="block my-2 pl-1 font-mono text-[13px] text-foreground">
              RC<sub>i</sub> = w<sub>i</sub> · (∂σ<sub>p</sub> / ∂w<sub>i</sub>)
            </span>
          </p>
          <p>
            风险平价目标是在约束 Σw<sub>i</sub> = 1 下，使各资产风险贡献相等：
            <span className="block my-2 pl-1 font-mono text-[13px] text-foreground">RC<sub>1</sub> = RC<sub>2</sub> = ··· = RC<sub>n</sub></span>
            该模型常用于多策略、多资产组合的权重初始化与再平衡。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
      <BlackLittermanDiagram />
      <div className="space-y-4 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
        <p>
          <strong className="text-foreground font-medium">Black-Litterman 模型</strong>
          将 CAPM 市场均衡隐含收益与投资者主观观点进行贝叶斯融合，
          在保留市场基准的同时纳入主动判断，避免均值方差优化对输入参数过于敏感的问题。
        </p>
        <p>
          后验预期收益可概括为：
          <span className="block my-2 pl-1 font-mono text-[13px] text-foreground">
            E[R] = [(τΣ)<sup>-1</sup> + P<sup>T</sup>Ω<sup>-1</sup>P]<sup>-1</sup> · [(τΣ)<sup>-1</sup>π + P<sup>T</sup>Ω<sup>-1</sup>Q]
          </span>
        </p>
        <ul className="space-y-1.5 list-none">
          <li><span className="text-foreground">π</span>：市场均衡隐含收益；</li>
          <li><span className="text-foreground">P, Q</span>：投资者观点矩阵与观点收益；</li>
          <li><span className="text-foreground">Ω</span>：观点置信度，τ 为缩放因子。</li>
        </ul>
        <p>融合后的预期收益可进一步代入均值方差框架，生成更稳健的最优权重方案。</p>
      </div>
    </div>
  )
}

function PortfolioNewView() {
  const [modelTab, setModelTab] = useState<PortfolioModelTab>("mean-variance")

  function handleCreate(buildType: "free" | "model") {
    if (buildType === "free") {
      window.open("/ma/dashboard/private-funds/portfolio/create?build=free", "_blank", "noopener,noreferrer")
      return
    }
    window.alert("模型构建创建功能即将上线，敬请期待")
  }

  return (
    <div className="flex flex-col items-center py-6 px-2 max-w-5xl mx-auto w-full">
      <div className="text-center mb-10">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">模型赋能，助力组合构建</h1>
        <p className="text-sm text-muted-foreground mt-2">请选择组合创建方式</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full">
        {PORTFOLIO_CREATE_OPTIONS.map((option) => (
          <div
            key={option.key}
            className="bg-background border border-border/80 rounded-2xl shadow-sm p-6 flex flex-col min-h-[360px] hover:shadow-md transition-shadow"
          >
            <div className="flex items-start gap-4 mb-6">
              <PortfolioBuildIcon variant={option.key} />
              <div className="pt-1 min-w-0">
                <h2 className="text-lg font-semibold text-foreground">{option.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">{option.subtitle}</p>
              </div>
            </div>

            <ul className="space-y-4 flex-1 mb-8">
              {option.features.map((feature) => (
                <li key={feature.label} className="text-sm leading-relaxed">
                  <span className="font-semibold text-foreground">{feature.label}：</span>
                  <span className="text-muted-foreground">{feature.desc}</span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => handleCreate(option.key)}
              className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 active:bg-red-800 transition-colors"
            >
              立即创建
            </button>
          </div>
        ))}
      </div>

      <div className="w-full mt-10">
        <div className="flex items-center gap-6 border-b mb-6">
          {PORTFOLIO_MODEL_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setModelTab(tab.key)}
              className={[
                "pb-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                modelTab === tab.key
                  ? "border-red-500 text-red-600 dark:text-red-400"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bg-background border border-border/80 rounded-2xl shadow-sm p-6 md:p-8">
          <PortfolioModelIntroPanel activeTab={modelTab} />
        </div>
      </div>
    </div>
  )
}

// ─── PortfolioView ─────────────────────────────────────────────────────────

type PortfolioSortKey =
  | "name" | "unit_nav" | "size" | "ret_1w" | "ret_1m" | "ret_3m" | "ret_6m"
  | "ret_1y" | "sharpe_1y" | "calmar_1y" | "updated_at"

interface PortfolioRow {
  id: string
  name: string
  team_tags: string[]
  build_type: string | null
  unit_nav: string | null
  unit_nav_date?: string | null
  size: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
  share_status: string | null
  updated_at: string | null
  created_by: string | null
  isLocal?: boolean
}

function PortfolioView({ sideItem }: { sideItem: string }) {
  const portfolioType = sideItem === "port-live" ? "live" : "simulated"
  const [scopeTab, setScopeTab] = useState<"team" | "mine">("team")
  const [teamTagOptions, setTeamTagOptions] = useState<string[]>([])
  const [personalTagOptions, setPersonalTagOptions] = useState<string[]>([])
  const [teamTags, setTeamTags] = useState<string[]>([])
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [cutoffDate, setCutoffDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [page, setPage] = useState(1)
  const [jumpVal, setJumpVal] = useState("")
  const [data, setData] = useState<PortfolioRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState<PortfolioSortKey>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [addedCols, setAddedCols] = useState<AddedCol[]>([])
  const [showAddMetric, setShowAddMetric] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [metricTemplates, setMetricTemplates] = useState<{ name: string; items: AddedCol[] }[]>(() => {
    if (typeof window === "undefined") return []
    try { return JSON.parse(localStorage.getItem("portfolio_metric_templates") ?? "[]") } catch { return [] }
  })
  const [localRefresh, setLocalRefresh] = useState(0)

  const totalPages = Math.max(1, Math.ceil(total / 50))

  useEffect(() => {
    const onUpdated = () => setLocalRefresh((n) => n + 1)
    window.addEventListener("ma-portfolios-updated", onUpdated)
    return () => window.removeEventListener("ma-portfolios-updated", onUpdated)
  }, [])

  useEffect(() => {
    fetch("/ma/api/ops/team-tags?category=portfolio")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setTeamTagOptions(d.map((t: { name: string }) => t.name))
      })
      .catch(() => {})
    fetch("/ma/api/ops/team-tags?category=portfolio_personal")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setPersonalTagOptions(d.map((t: { name: string }) => t.name))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setPage(1)
  }, [scopeTab, portfolioType, keyword, teamTags.join("\u0001"), cutoffDate])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      scope: scopeTab,
      type: portfolioType,
      page: String(page),
      sort: sortKey,
      dir: sortDir,
      keyword,
      cutoff: cutoffDate,
    })
    teamTags.forEach((t) => params.append("tag", t))
    fetch(`/ma/api/portfolios/list?${params}`)
      .then((r) => r.json())
      .then((json) => {
        let rows: PortfolioRow[] = json.data ?? []
        if (scopeTab === "mine" && portfolioType === "simulated") {
          const localRows = loadLocalPortfolioRows(keyword)
          const apiIds = new Set(rows.map((r) => r.id))
          rows = [...localRows.filter((r) => !apiIds.has(r.id)), ...rows]
        }
        rows = sortPortfolioRows(rows, sortKey, sortDir)
        setData(rows)
        setTotal(rows.length)
        setSelected(new Set())
      })
      .catch(() => {
        if (scopeTab === "mine" && portfolioType === "simulated") {
          const rows = sortPortfolioRows(loadLocalPortfolioRows(keyword), sortKey, sortDir)
          setData(rows)
          setTotal(rows.length)
        } else {
          setData([])
          setTotal(0)
        }
        setSelected(new Set())
      })
      .finally(() => setLoading(false))
  }, [scopeTab, portfolioType, page, sortKey, sortDir, keyword, teamTags, cutoffDate, localRefresh])

  function handleSort(col: PortfolioSortKey) {
    if (col === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("desc") }
    setPage(1)
  }

  function PortSortIcon({ col }: { col: PortfolioSortKey }) {
    if (col !== sortKey) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function toggleAll() {
    if (selected.size === data.length && data.length > 0) setSelected(new Set())
    else setSelected(new Set(data.map((r) => r.id)))
  }

  function toggleTeamTag(tag: string) {
    setTeamTags((prev) => prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag])
  }

  function jumpTo() {
    const n = parseInt(jumpVal)
    if (!isNaN(n)) { setPage(Math.min(totalPages, Math.max(1, n))); setJumpVal("") }
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

  async function handleExport() {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const rows = selected.size > 0 ? data.filter((r) => selected.has(r.id)) : data
    const headers = ["组合名称", "团队标签", "构建类型", "单位净值", "组合规模(元)", "近一周收益", "近一月收益", "近三月收益", "近六月收益", "近一年收益", "近一年夏普比率", "近一年卡玛比率", "共享状态", "最近修改", "创建人"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.name), escape(r.team_tags.join(";")), escape(r.build_type), escape(r.unit_nav),
        escape(r.size), escape(r.ret_1w), escape(r.ret_1m), escape(r.ret_3m), escape(r.ret_6m),
        escape(r.ret_1y), escape(r.sharpe_1y), escape(r.calmar_1y), escape(r.share_status),
        escape(r.updated_at), escape(r.created_by),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `组合列表_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 whitespace-nowrap select-none"
  const thSort = thBase + " cursor-pointer hover:text-foreground transition-colors"
  const colCount = 17 + addedCols.length

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* 团队组合 / 我的组合 */}
      <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0">
        {(["team", "mine"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setScopeTab(t); setTeamTags([]) }}
            className={[
              "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              scopeTab === t
                ? "border-red-500 text-red-600 dark:text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t === "team" ? "团队组合" : "我的组合"}
          </button>
        ))}
      </div>

      {/* Filter + toolbar row */}
      <div className="flex items-center justify-between gap-4 mb-3 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-zinc-500 shrink-0">{scopeTab === "team" ? "团队标签：" : "个人标签："}</span>
            <button
              onClick={() => setTeamTags([])}
              className={[
                "inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium border transition-colors",
                teamTags.length === 0
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              不限
            </button>
            {(scopeTab === "team" ? teamTagOptions : personalTagOptions).map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTeamTag(tag)}
                className={[
                  "inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium border transition-colors",
                  teamTags.includes(tag)
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                    : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                ].join(" ")}
              >
                {tag}
              </button>
            ))}
          </div>
          <div className="relative">
            <input
              type="text"
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setKeyword(kwInput.trim()); setPage(1) } }}
              placeholder="请输入组合名称并按回车搜索"
              className="h-8 w-64 pl-3 pr-8 border rounded-lg text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
            />
            <Search
              className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground cursor-pointer"
              onClick={() => { setKeyword(kwInput.trim()); setPage(1) }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 mr-2">
            <span className="text-xs whitespace-nowrap">指标计算截止日期(?)</span>
            <span className="text-zinc-400">:</span>
            <div className="relative">
              <button
                onClick={() => setShowDatePicker((v) => !v)}
                className="inline-flex items-center gap-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors border rounded px-1.5 py-0.5 text-xs tabular-nums"
              >
                <CalendarDays className="h-3 w-3" />
                {cutoffDate}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showDatePicker && (
                <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg p-3" onClick={(e) => e.stopPropagation()}>
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
          <div className="relative">
            <button
              onClick={() => setShowTemplates((v) => !v)}
              className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors bg-muted/40 hover:bg-muted border border-border/50 rounded-lg px-2.5 py-1 text-xs"
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
              <span>{metricTemplates.length === 0 ? "默认模板" : `模板 (${metricTemplates.length})`}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            {showTemplates && (
              <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg min-w-[180px] py-1" onClick={(e) => e.stopPropagation()}>
                {metricTemplates.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-muted-foreground">暂无保存的模板</div>
                ) : metricTemplates.map((t, i) => (
                  <button
                    key={i}
                    onClick={() => { setAddedCols(t.items); setShowTemplates(false) }}
                    className="w-full text-left px-4 py-2 text-xs hover:bg-muted transition-colors"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
            {showTemplates && <div className="fixed inset-0 z-30" onClick={() => setShowTemplates(false)} />}
          </div>
          <button
            onClick={() => setShowAddMetric(true)}
            className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors bg-muted/40 hover:bg-muted border border-border/50 rounded-lg px-2.5 py-1 text-xs"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            <span>{addedCols.length > 0 ? `添加指标(${addedCols.length})` : "添加指标"}</span>
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors bg-muted/40 hover:bg-muted border border-border/50 rounded-lg px-2.5 py-1 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{selected.size > 0 ? `导出(${selected.size})` : "导出"}</span>
          </button>
          <button
            onClick={() => window.open("/ma/dashboard/private-funds/portfolio/create?build=free", "_blank", "noopener,noreferrer")}
            className="inline-flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg px-3 py-1 text-xs font-medium transition-colors"
          >
            新建组合
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border flex-1">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1800 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
              <th className={`${thBase} w-8 px-2 border-b`}>
                <input type="checkbox" className="rounded h-3.5 w-3.5" checked={selected.size === data.length && data.length > 0} onChange={toggleAll} />
              </th>
              <th className={`${thBase} w-10 border-b`}>序号</th>
              <th className={`${thSort} border-b min-w-[180px]`} onClick={() => handleSort("name")}>
                组合名称<PortSortIcon col="name" />
              </th>
              <th className={`${thBase} border-b min-w-[100px]`}>{scopeTab === "team" ? "团队标签" : "个人标签"}</th>
              <th className={`${thBase} border-b min-w-[88px]`}>构建类型</th>
              <th className={`${thSort} border-b min-w-[88px]`} onClick={() => handleSort("unit_nav")}>
                单位净值<PortSortIcon col="unit_nav" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[110px]`} onClick={() => handleSort("size")}>
                组合规模(元)<PortSortIcon col="size" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[88px]`} onClick={() => handleSort("ret_1w")}>
                近一周收益<PortSortIcon col="ret_1w" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[88px]`} onClick={() => handleSort("ret_1m")}>
                近一月收益<PortSortIcon col="ret_1m" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[88px]`} onClick={() => handleSort("ret_3m")}>
                近三月收益<PortSortIcon col="ret_3m" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[88px]`} onClick={() => handleSort("ret_6m")}>
                近六月收益<PortSortIcon col="ret_6m" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[88px]`} onClick={() => handleSort("ret_1y")}>
                近一年收益<PortSortIcon col="ret_1y" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[110px]`} onClick={() => handleSort("sharpe_1y")}>
                近一年夏普比率<PortSortIcon col="sharpe_1y" />
              </th>
              <th className={`${thSort} border-b text-right min-w-[110px]`} onClick={() => handleSort("calmar_1y")}>
                近一年卡玛比率<PortSortIcon col="calmar_1y" />
              </th>
              <th className={`${thBase} border-b min-w-[80px]`}>共享状态</th>
              <th className={`${thSort} border-b min-w-[100px]`} onClick={() => handleSort("updated_at")}>
                最近修改<PortSortIcon col="updated_at" />
              </th>
              <th className={`${thBase} border-b min-w-[80px]`}>创建人</th>
              <th className={`${thBase} border-b text-center w-16`}>操作</th>
              {addedCols.map((col) => (
                <th key={col.id} className={`${thBase} border-b text-right min-w-[96px]`}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} className="py-20 text-center text-foreground">加载中…</td></tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : data.map((row, i) => {
              const isSelected = selected.has(row.id)
              const cellBase = `border-b px-3 py-2 ${isSelected ? "bg-blue-50/40 dark:bg-blue-950/20" : ""}`
              return (
                <tr key={row.id} className="group hover:bg-muted/30 transition-colors">
                  <td className={`${cellBase} px-2 text-center`}>
                    <input
                      type="checkbox"
                      className="rounded h-3.5 w-3.5"
                      checked={isSelected}
                      onChange={() => {
                        const s = new Set(selected)
                        isSelected ? s.delete(row.id) : s.add(row.id)
                        setSelected(s)
                      }}
                    />
                  </td>
                  <td className={`${cellBase} text-center tabular-nums text-muted-foreground`}>{(page - 1) * 50 + i + 1}</td>
                  <td className={`${cellBase} font-medium`}>
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
                  <td className={cellBase}>
                    <div className="flex flex-wrap gap-1">
                      {row.team_tags.length > 0 ? row.team_tags.map((t) => (
                        <span key={t} className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-500 border border-red-200 dark:bg-red-950/20 dark:border-red-800">{t}</span>
                      )) : <span className="text-muted-foreground">—</span>}
                    </div>
                  </td>
                  <td className={cellBase}>{row.build_type ?? "—"}</td>
                  <td className={`${cellBase} tabular-nums`}>
                    <div>{fmtNum(row.unit_nav)}</div>
                    {row.unit_nav_date && (
                      <div className="text-[11px] text-muted-foreground">{row.unit_nav_date}</div>
                    )}
                  </td>
                  <td className={`${cellBase} text-right tabular-nums`}>{row.size ?? "—"}</td>
                  <td className={`${cellBase} text-right`}><TrackPctCell value={row.ret_1w} /></td>
                  <td className={`${cellBase} text-right`}><TrackPctCell value={row.ret_1m} /></td>
                  <td className={`${cellBase} text-right`}><TrackPctCell value={row.ret_3m} /></td>
                  <td className={`${cellBase} text-right`}><TrackPctCell value={row.ret_6m} /></td>
                  <td className={`${cellBase} text-right`}><TrackPctCell value={row.ret_1y} /></td>
                  <td className={`${cellBase} text-right`}><TrackRatioCell value={row.sharpe_1y} /></td>
                  <td className={`${cellBase} text-right`}><TrackRatioCell value={row.calmar_1y} /></td>
                  <td className={cellBase}>{row.share_status ?? "—"}</td>
                  <td className={`${cellBase} tabular-nums whitespace-nowrap text-xs text-muted-foreground`}>{row.updated_at ?? "—"}</td>
                  <td className={cellBase}>{row.created_by ?? "—"}</td>
                  <td className={`${cellBase} text-center`}>
                    <div className="inline-flex items-center gap-2 text-muted-foreground">
                      <button type="button" className="hover:text-foreground" title="编辑">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {row.isLocal && (
                        <button
                          type="button"
                          className="hover:text-red-500"
                          title="删除"
                          onClick={() => {
                            if (window.confirm(`确定删除组合「${row.name}」吗？`)) {
                              deletePortfolio(row.id)
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  {addedCols.map((col) => (
                    <td key={col.id} className={`${cellBase} text-right text-muted-foreground`}>—</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between pt-3 pb-0.5 flex-shrink-0">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          共 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{total.toLocaleString()}</span> 条
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            ‹
          </button>
          {pageButtons().map((btn, idx) =>
            btn === "…" ? (
              <span key={`e${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
            ) : (
              <button key={btn} onClick={() => setPage(btn as number)}
                className={[
                  "w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors",
                  btn === page
                    ? "bg-red-500 text-white border-red-500 font-medium shadow-sm"
                    : "text-foreground hover:bg-muted border-border",
                ].join(" ")}>
                {btn}
              </button>
            )
          )}
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages <= 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            ›
          </button>
          <div className="flex items-center gap-1 ml-3 text-sm text-foreground">
            跳至
            <input
              type="number" min={1} max={totalPages} value={jumpVal}
              onChange={(e) => setJumpVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && jumpTo()}
              className="w-12 h-7 border rounded px-2 text-center text-foreground bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
            页
            <button onClick={jumpTo} className="h-7 px-2 border rounded text-xs hover:bg-muted transition-colors">GO</button>
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

// ─── PrivateFundManagersView ────────────────────────────────────────────────

const MGR_MEMBER_TYPES = ["普通会员", "观察会员"] as const
const MGR_INCEPTION_OPTS = ["不限", "6个月以内", "6个月-1年", "1-3年", "3-5年", "5年以上"] as const
const MGR_PRODUCT_COUNT_OPTS = ["不限", "0-10", "10-50", "50-100", "100-500", "500以上"] as const

type MgrListSortKey = "manager_name" | "mgmt_scale" | "active_product_count" | "inception_date" | "registration_no" | "seq_no"

interface PrivateFundManagerRow {
  id: number
  seq_no: number | null
  manager_name: string
  core_strategy: string | null
  mgmt_scale: string | null
  active_product_count: number | null
  inception_date: string | null
  member_type: string | null
  registration_no: string
}

function StrategyTags({ value }: { value: string | null }) {
  if (!value || value === "-") return <span>—</span>
  const parts = value.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return <span>—</span>
  return (
    <div className="flex flex-wrap gap-1 max-w-[220px]">
      {parts.map((tag) => (
        <span key={tag} className="inline-flex px-1.5 py-0.5 rounded text-[11px] border border-border text-zinc-600 dark:text-zinc-400 bg-muted/30">
          {tag}
        </span>
      ))}
    </div>
  )
}

function PrivateFundManagersView() {
  const [coreStrategy, setCoreStrategy] = useState("")
  const [mgmtScale, setMgmtScale] = useState("")
  const [memberType, setMemberType] = useState("")
  const [inceptionPeriod, setInceptionPeriod] = useState("")
  const [productCount, setProductCount] = useState("")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [sortKey, setSortKey] = useState<MgrListSortKey>("seq_no")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [jumpVal, setJumpVal] = useState("")
  const [data, setData] = useState<PrivateFundManagerRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [favorites, setFavorites] = useState<Set<number>>(() => {
    if (typeof window === "undefined") return new Set()
    try {
      const raw = localStorage.getItem("private_fund_mgr_favorites")
      return raw ? new Set(JSON.parse(raw) as number[]) : new Set()
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    setPage(1)
  }, [coreStrategy, mgmtScale, memberType, inceptionPeriod, productCount, keyword, pageSize])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: favoritesOnly ? "1" : String(page),
      pageSize: favoritesOnly ? "100000" : String(pageSize),
      sort: sortKey,
      dir: sortDir,
      keyword,
    })
    if (coreStrategy) params.set("core_strategy", coreStrategy)
    if (mgmtScale) params.set("mgmt_scale", mgmtScale)
    if (memberType) params.set("member_type", memberType)
    if (inceptionPeriod && inceptionPeriod !== "不限") params.set("inception", inceptionPeriod)
    if (productCount && productCount !== "不限") params.set("product_count", productCount)
    fetch(`/ma/api/private-fund-managers/list?${params}`)
      .then((r) => r.json())
      .then((json) => {
        let rows: PrivateFundManagerRow[] = json.data ?? []
        if (favoritesOnly) {
          rows = rows.filter((r) => favorites.has(r.id))
          setTotal(rows.length)
          const start = (page - 1) * pageSize
          setData(rows.slice(start, start + pageSize))
        } else {
          setData(rows)
          setTotal(json.total ?? 0)
        }
      })
      .catch(() => {
        setData([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }, [page, pageSize, sortKey, sortDir, keyword, coreStrategy, mgmtScale, memberType, inceptionPeriod, productCount, favoritesOnly, favorites])

  function toggleFavorite(id: number) {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      localStorage.setItem("private_fund_mgr_favorites", JSON.stringify([...next]))
      return next
    })
  }

  function handleSort(col: MgrListSortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("asc") }
    setPage(1)
  }

  function MgrSortIcon({ col }: { col: MgrListSortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function jumpTo() {
    const n = parseInt(jumpVal)
    if (!isNaN(n)) { setPage(Math.min(totalPages, Math.max(1, n))); setJumpVal("") }
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

  async function handleExport() {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const params = new URLSearchParams({ export: "1", sort: sortKey, dir: sortDir, keyword })
    if (coreStrategy) params.set("core_strategy", coreStrategy)
    if (mgmtScale) params.set("mgmt_scale", mgmtScale)
    if (memberType) params.set("member_type", memberType)
    if (inceptionPeriod && inceptionPeriod !== "不限") params.set("inception", inceptionPeriod)
    if (productCount && productCount !== "不限") params.set("product_count", productCount)
    const json = await fetch(`/ma/api/private-fund-managers/list?${params}`).then((r) => r.json())
    const rows: PrivateFundManagerRow[] = json.data ?? []
    const headers = ["序号", "管理人名称", "核心策略", "管理规模", "成立日期", "运作中产品数", "会员类型", "登记编号"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.seq_no != null ? String(r.seq_no) : ""),
        escape(r.manager_name), escape(r.core_strategy), escape(r.mgmt_scale),
        escape(r.inception_date),
        escape(r.active_product_count != null ? String(r.active_product_count) : ""),
        escape(r.member_type), escape(r.registration_no),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `私募管理人_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"
  const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`
  const tdBase = "px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 whitespace-nowrap"

  const chipCls = (active: boolean) => [
    "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
    active
      ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
      : "border-border text-zinc-500 hover:bg-muted/60",
  ].join(" ")

  return (
    <div className="flex flex-col h-full min-w-0 overflow-x-hidden">
      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">

        <div className="flex items-start px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">核心策略：</span>
          <div className="flex items-center gap-2 flex-wrap">
            <span onClick={() => { setCoreStrategy(""); setPage(1) }} className={chipCls(!coreStrategy)}>不限</span>
            {TRACK_STRATEGIES.filter((s) => s !== "不限").map((s) => (
              <span key={s} onClick={() => { setCoreStrategy(coreStrategy === s ? "" : s); setPage(1) }} className={chipCls(coreStrategy === s)}>
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-start px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">管理规模：</span>
          <div className="flex items-center gap-2 flex-wrap">
            <span onClick={() => { setMgmtScale(""); setPage(1) }} className={chipCls(!mgmtScale)}>不限</span>
            {ORG_SIZE_OPTS.filter((s) => s !== "不限").map((s) => (
              <span key={s} onClick={() => { setMgmtScale(mgmtScale === s ? "" : s); setPage(1) }} className={chipCls(mgmtScale === s)}>
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center px-4 py-2 gap-6 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-zinc-400 shrink-0">成立时间：</span>
            <select
              value={inceptionPeriod || "不限"}
              onChange={(e) => { setInceptionPeriod(e.target.value === "不限" ? "" : e.target.value); setPage(1) }}
              className="h-7 rounded border border-border bg-background px-2 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {MGR_INCEPTION_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-400 shrink-0">产品数量：</span>
            <select
              value={productCount || "不限"}
              onChange={(e) => { setProductCount(e.target.value === "不限" ? "" : e.target.value); setPage(1) }}
              className="h-7 rounded border border-border bg-background px-2 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {MGR_PRODUCT_COUNT_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-start px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">会员类型：</span>
          <div className="flex items-center gap-2 flex-wrap">
            <span onClick={() => { setMemberType(""); setPage(1) }} className={chipCls(!memberType)}>不限</span>
            {MGR_MEMBER_TYPES.map((s) => (
              <span key={s} onClick={() => { setMemberType(memberType === s ? "" : s); setPage(1) }} className={chipCls(memberType === s)}>
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center px-4 py-2 gap-4">
          <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">关 键 字：</span>
          <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-80">
            <input
              className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
              placeholder="请输入管理人名称/编号，按回车搜索"
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setKeyword(kwInput)}
            />
            <button onClick={() => setKeyword(kwInput)} className="text-muted-foreground hover:text-foreground transition-colors">
              <Search className="h-3 w-3" />
            </button>
          </div>
          <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded h-3 w-3"
              checked={favoritesOnly}
              onChange={(e) => { setFavoritesOnly(e.target.checked); setPage(1) }}
            />
            收藏
          </label>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mb-3 flex-shrink-0 text-xs text-zinc-600">
        <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors opacity-50 cursor-not-allowed" disabled>
          <Settings2 className="h-3.5 w-3.5" /> 字段配置
        </button>
        <button onClick={handleExport} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
          <Download className="h-3.5 w-3.5" /> 导出
        </button>
      </div>

      <div className="overflow-auto rounded-lg border flex-1 min-h-0">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1100 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
              <th className={`${thSort} w-12`} onClick={() => handleSort("seq_no")}>
                序号<MgrSortIcon col="seq_no" />
              </th>
              <th className={`${thSort} min-w-[160px]`} onClick={() => handleSort("manager_name")}>
                管理人名称<MgrSortIcon col="manager_name" />
              </th>
              <th className={`${thBase} min-w-[180px]`}>核心策略</th>
              <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("mgmt_scale")}>
                管理规模<MgrSortIcon col="mgmt_scale" />
              </th>
              <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("inception_date")}>
                成立日期<MgrSortIcon col="inception_date" />
              </th>
              <th className={`${thSort} min-w-[110px]`} onClick={() => handleSort("active_product_count")}>
                运作中产品数<MgrSortIcon col="active_product_count" />
              </th>
              <th className={`${thBase} min-w-[90px]`}>会员类型</th>
              <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("registration_no")}>
                登记编号<MgrSortIcon col="registration_no" />
              </th>
              <th className={`${thBase} text-center w-16`}>报告</th>
              <th className={`${thBase} text-center w-24`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : data.map((row, idx) => (
              <tr key={row.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className={tdBase}>{row.seq_no ?? (page - 1) * pageSize + idx + 1}</td>
                <td className={tdBase}>
                  <span className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                    {row.manager_name}
                  </span>
                </td>
                <td className={tdBase}><StrategyTags value={row.core_strategy} /></td>
                <td className={tdBase}>{fmtMgrCell(row.mgmt_scale)}</td>
                <td className={tdBase}>{fmtMgrCell(row.inception_date)}</td>
                <td className={tdBase}>{fmtMgrCell(row.active_product_count)}</td>
                <td className={tdBase}>{fmtMgrCell(row.member_type)}</td>
                <td className={tdBase}>{row.registration_no}</td>
                <td className={`${tdBase} text-center`}>
                  <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors opacity-50 cursor-not-allowed" disabled title="报告">
                    <FileSearch className="h-3.5 w-3.5" />
                  </button>
                </td>
                <td className={`${tdBase} text-center`}>
                  <div className="inline-flex items-center gap-2">
                    <button
                      onClick={() => toggleFavorite(row.id)}
                      className="text-muted-foreground hover:text-amber-500 transition-colors"
                      title="收藏"
                    >
                      <Heart className={`h-3.5 w-3.5 ${favorites.has(row.id) ? "fill-red-500 text-red-500" : ""}`} />
                    </button>
                    <button className="text-muted-foreground hover:text-foreground transition-colors opacity-50 cursor-not-allowed" title="查看" disabled>
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 flex-shrink-0 text-xs text-zinc-600">
        <span>共 {total} 条</span>
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
          <div className="flex items-center gap-1 ml-2">
            <span>跳至</span>
            <input
              className="w-10 h-7 border rounded text-center text-xs outline-none focus:ring-1 focus:ring-ring"
              value={jumpVal}
              onChange={(e) => setJumpVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && jumpTo()}
            />
            <span>页</span>
          </div>
          <div className="relative ml-3">
            <select value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-7 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring">
              {[50, 100, 200].map((n) => <option key={n} value={n}>{n} 条/页</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>
    </div>
  )
}

function PrivateFundView() {
  const [filters, setFilters] = useState<FilterState>({ strategyFilters: [], keyword: "", manager: "", metricTab: "收益", period: "本周", range: "不限", inceptionPeriod: "", navDatePeriod: "", navFrequency: "" })
  const [templates, setTemplates] = useState<SavedTemplate[]>(() => loadTemplates())

  function handleSaveTemplate(name: string) {
    const t: SavedTemplate = { name, filters, savedAt: new Date().toLocaleString("zh-CN", { hour12: false }) }
    const updated = [...templates.filter((x) => x.name !== name), t]
    setTemplates(updated)
    saveTemplates(updated)
  }

  function handleLoadTemplate(t: SavedTemplate) {
    setFilters(t.filters)
  }

  return (
    <div className="flex flex-col">
      <FundFilterPanel filters={filters} onChange={(f) => setFilters((p) => ({ ...p, ...f }))} onSave={handleSaveTemplate} />
      <PrivateFundTable
        strategyFilters={filters.strategyFilters}
        keyword={filters.keyword}
        metricTab={filters.metricTab}
        period={filters.period}
        range={filters.range}
        inceptionPeriod={filters.inceptionPeriod}
        navDatePeriod={filters.navDatePeriod}
        navFrequency={filters.navFrequency}
        templates={templates}
        onLoadTemplate={handleLoadTemplate}
      />
    </div>
  )
}

// ─── PrivateFundManagersPersonalView ────────────────────────────────────────

const MGR_PERSONAL_EXP_OPTS = ["不限", "20年以上", "15-20年", "10-15年", "5-10年", "0-5年"] as const

type MgrPersonalSortKey = "seq_no" | "manager_name" | "private_fund_manager_company" | "years_of_experience" | "funds_under_management" | "representative_fund" | "tenure_return_pct"

interface PrivateFundManagerPersonalRow {
  id: number
  seq_no: number
  manager_name: string
  private_fund_manager_company: string
  years_of_experience: number | null
  funds_under_management: number | null
  representative_fund: string | null
  tenure_return_pct: number | null
}

function PrivateFundManagersPersonalView() {
  const [yearsExp, setYearsExp] = useState("")
  const [companyKeyword, setCompanyKeyword] = useState("")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [sortKey, setSortKey] = useState<MgrPersonalSortKey>("seq_no")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [jumpVal, setJumpVal] = useState("")
  const [data, setData] = useState<PrivateFundManagerPersonalRow[]>()
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setPage(1)
  }, [yearsExp, companyKeyword, keyword, pageSize])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort: sortKey,
      dir: sortDir,
      keyword,
      company_keyword: companyKeyword,
    })
    if (yearsExp && yearsExp !== "不限") params.set("years_of_experience", yearsExp)

    fetch(`/ma/api/private-fund-managers/list-details?${params}`)
      .then((r) => r.json())
      .then((json) => {
        setData(json.data ?? [])
        setTotal(json.total ?? 0)
      })
      .catch(() => {
        setData([])
        setTotal(0)
      })
      .finally(() => setLoading(false))
  }, [page, pageSize, sortKey, sortDir, keyword, companyKeyword, yearsExp])

  function handleSort(col: MgrPersonalSortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("asc") }
    setPage(1)
  }

  function SortIcon({ col }: { col: MgrPersonalSortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"
  const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`
  const tdBase = "px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-300 whitespace-nowrap"

  function jumpTo() {
    const n = parseInt(jumpVal)
    if (!isNaN(n)) { setPage(Math.min(totalPages, Math.max(1, n))); setJumpVal("") }
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

  async function handleExport() {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const params = new URLSearchParams({ export: "1", sort: sortKey, dir: sortDir, keyword, company_keyword: companyKeyword })
    if (yearsExp && yearsExp !== "不限") params.set("years_of_experience", yearsExp)

    const json = await fetch(`/ma/api/private-fund-managers/list-details?${params}`).then((r) => r.json())
    const rows: PrivateFundManagerPersonalRow[] = json.data ?? []
    const headers = ["序号", "基金经理", "私募管理人", "从业年限", "在管基金数", "代表基金", "任职区间收益"]
    const csvRows = [
      headers.join(","),
      ...rows.map((r) => [
        escape(r.seq_no != null ? String(r.seq_no) : ""),
        escape(r.manager_name),
        escape(r.private_fund_manager_company),
        escape(r.years_of_experience != null ? String(r.years_of_experience) : ""),
        escape(r.funds_under_management != null ? String(r.funds_under_management) : ""),
        escape(r.representative_fund),
        escape(r.tenure_return_pct != null ? `${r.tenure_return_pct}%` : ""),
      ].join(",")),
    ]
    const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `基金经理_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const chipCls = (active: boolean) => [
    "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
    active
      ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
      : "border-border text-zinc-500 hover:bg-muted/60",
  ].join(" ")

  return (
    <div className="flex flex-col h-full min-w-0 overflow-x-hidden">
      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 overflow-hidden divide-y flex-shrink-0">
        <div className="flex items-start px-4 py-2">
          <span className="text-zinc-400 shrink-0 w-[5rem] text-right pr-3 pt-1">从业年限：</span>
          <div className="flex items-center gap-2 flex-wrap">
            <span onClick={() => { setYearsExp(""); setPage(1) }} className={chipCls(!yearsExp)}>不限</span>
            {MGR_PERSONAL_EXP_OPTS.filter((s) => s !== "不限").map((s) => (
              <span key={s} onClick={() => { setYearsExp(yearsExp === s ? "" : s); setPage(1) }} className={chipCls(yearsExp === s)}>
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center px-4 py-2 gap-4">
          <span className="text-zinc-400 shrink-0 w-[5rem] text-right pr-3">私募管理人：</span>
          <div className="flex items-center border rounded px-2 h-7 bg-background w-80">
            <input
              className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
              placeholder="请输入私募管理人名称"
              value={companyKeyword}
              onChange={(e) => setCompanyKeyword(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center px-4 py-2 gap-4">
          <span className="text-zinc-400 shrink-0 w-[5rem] text-right pr-3">关 键 字：</span>
          <div className="flex items-center border rounded px-2 h-7 gap-1.5 bg-background w-80">
            <input
              className="flex-1 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
              placeholder="请输入基金经理名字"
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

      <div className="flex items-center justify-end gap-3 mb-3 flex-shrink-0 text-xs text-zinc-600">
        <button onClick={handleExport} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
          <Download className="h-3.5 w-3.5" /> 导出
        </button>
      </div>

      <div className="overflow-auto rounded-lg border flex-1 min-h-0">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1100 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
              <th className={`${thSort} w-12`} onClick={() => handleSort("seq_no")}>
                序号<SortIcon col="seq_no" />
              </th>
              <th className={`${thSort} min-w-[140px]`} onClick={() => handleSort("manager_name")}>
                基金经理<SortIcon col="manager_name" />
              </th>
              <th className={`${thSort} min-w-[200px]`} onClick={() => handleSort("private_fund_manager_company")}>
                私募管理人<SortIcon col="private_fund_manager_company" />
              </th>
              <th className={`${thSort} min-w-[120px]`} onClick={() => handleSort("years_of_experience")}>
                从业年限<SortIcon col="years_of_experience" />
              </th>
              <th className={`${thSort} min-w-[120px]`} onClick={() => handleSort("funds_under_management")}>
                在管基金数<SortIcon col="funds_under_management" />
              </th>
              <th className={`${thSort} min-w-[240px]`} onClick={() => handleSort("representative_fund")}>
                代表基金<SortIcon col="representative_fund" />
              </th>
              <th className={`${thSort} min-w-[140px]`} onClick={() => handleSort("tenure_return_pct")}>
                任职区间收益<SortIcon col="tenure_return_pct" />
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : !data || data.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : data.map((row) => (
              <tr key={row.id} className="border-b hover:bg-muted/30 transition-colors">
                <td className={tdBase}>{row.seq_no}</td>
                <td className={tdBase}>
                  <span className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                    {row.manager_name}
                  </span>
                </td>
                <td className={tdBase}>
                  <span className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                    {row.private_fund_manager_company}
                  </span>
                </td>
                <td className={tdBase}>{row.years_of_experience != null ? row.years_of_experience.toFixed(1) : "—"}</td>
                <td className={tdBase}>{row.funds_under_management != null ? row.funds_under_management : "—"}</td>
                <td className={tdBase}>
                  <div className="truncate max-w-[320px] text-zinc-800 dark:text-zinc-200" title={row.representative_fund || ""}>
                    {row.representative_fund || "—"}
                  </div>
                </td>
                <td className={`${tdBase} font-medium ${row.tenure_return_pct != null && row.tenure_return_pct > 0 ? "text-red-500" : row.tenure_return_pct != null && row.tenure_return_pct < 0 ? "text-green-500" : ""}`}>
                  {row.tenure_return_pct != null ? `${row.tenure_return_pct.toFixed(2)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 flex-shrink-0 text-xs text-zinc-600">
        <span>共 {total} 条</span>
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
          <div className="flex items-center gap-1 ml-2">
            <span>跳至</span>
            <input
              className="w-10 h-7 border rounded text-center text-xs outline-none focus:ring-1 focus:ring-ring"
              value={jumpVal}
              onChange={(e) => setJumpVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && jumpTo()}
            />
            <span>页</span>
          </div>
          <div className="relative ml-3">
            <select value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-7 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring">
              {[50, 100, 200].map((n) => <option key={n} value={n}>{n} 条/页</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>
    </div>
  )
}


export default function PrivateFundsPage() {
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState(() => searchParams.get("tab") || "funds")
  const [activeSideItem, setActiveSideItem] = useState(() => {
    const side = searchParams.get("side")
    if (side) return side
    const tab = searchParams.get("tab") || "funds"
    return TAB_DEFAULT_SIDE[tab] ?? "private-funds"
  })

  function handleTabChange(tab: string) {
    setActiveTab(tab)
    if (TAB_DEFAULT_SIDE[tab]) setActiveSideItem(TAB_DEFAULT_SIDE[tab])
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top menu bar */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex-shrink-0">
        <nav className="flex items-center gap-1 px-6 h-12">
          {menuItems.map((item) => (
            <button
              key={item.key}
              onClick={() => handleTabChange(item.key)}
              className={[
                "relative px-4 h-full text-sm font-medium transition-colors focus:outline-none",
                activeTab === item.key
                  ? "text-red-600 dark:text-red-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-red-500 after:rounded-full"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {activeTab === "funds" && (
          <aside className="w-44 border-r bg-background flex-shrink-0">
            <div className="flex items-center gap-2 px-4 py-4 border-b">
              <div className="h-7 w-7 rounded-md bg-red-500 flex items-center justify-center flex-shrink-0">
                <Database className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-foreground">基金数据库</span>
            </div>
            <nav className="flex flex-col pt-2 pb-4 overflow-y-auto">
              {fundsSidebarGroups.map((group) => {
                const hasActive = group.items.some((i) => i.key === activeSideItem)
                return (
                  <div key={group.label}>
                    <div className={[
                      "px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide select-none",
                      hasActive ? "text-red-500" : "text-zinc-400 dark:text-zinc-500",
                    ].join(" ")}>{group.label}</div>
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => setActiveSideItem(item.key)}
                        className={[
                          "w-full text-left pl-5 pr-3 py-1.5 text-sm transition-colors focus:outline-none relative",
                          activeSideItem === item.key
                            ? "text-red-600 dark:text-red-400 font-medium bg-red-50/60 dark:bg-red-950/20 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-red-500"
                            : "text-zinc-600 dark:text-zinc-400 hover:text-foreground hover:bg-muted/40",
                        ].join(" ")}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )
              })}
            </nav>
          </aside>
        )}
        {activeTab === "investment" && (
          <aside className="w-44 border-r bg-background flex-shrink-0">
            <div className="flex items-center gap-2 px-4 py-4 border-b">
              <div className="h-7 w-7 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                <LineChart className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-foreground">投资分析</span>
            </div>
            <nav className="flex flex-col pt-2 pb-4">
              {investmentSidebarGroups.map((group) => {
                const hasActive = group.items.some((i) => i.key === activeSideItem)
                return (
                  <div key={group.label}>
                    <div className={[
                      "px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide select-none",
                      hasActive ? "text-red-500" : "text-zinc-400 dark:text-zinc-500",
                    ].join(" ")}>{group.label}</div>
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => setActiveSideItem(item.key)}
                        className={[
                          "w-full text-left pl-5 pr-3 py-1.5 text-sm transition-colors focus:outline-none relative",
                          activeSideItem === item.key
                            ? "text-red-600 dark:text-red-400 font-medium bg-red-50/60 dark:bg-red-950/20 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-red-500"
                            : "text-zinc-600 dark:text-zinc-400 hover:text-foreground hover:bg-muted/40",
                        ].join(" ")}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )
              })}
            </nav>
          </aside>
        )}

        {activeTab === "operations" && (
          <aside className="w-44 border-r bg-background flex-shrink-0">
            <div className="flex items-center gap-2 px-4 py-4 border-b">
              <div className="h-7 w-7 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="white" aria-hidden="true">
                  <circle cx="8" cy="3.5" r="1.8" />
                  <circle cx="4" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-foreground">产品运维</span>
            </div>
            <nav className="flex flex-col pt-2 pb-4">
              {operationsSidebarGroups.map((group) => {
                const hasActive = group.items.some((i) => i.key === activeSideItem)
                return (
                  <div key={group.label}>
                    <div className={[
                      "px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide select-none",
                      hasActive ? "text-red-500" : "text-zinc-400 dark:text-zinc-500",
                    ].join(" ")}>{group.label}</div>
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => setActiveSideItem(item.key)}
                        className={[
                          "w-full text-left pl-5 pr-3 py-1.5 text-sm transition-colors focus:outline-none relative",
                          activeSideItem === item.key
                            ? "text-red-600 dark:text-red-400 font-medium bg-red-50/60 dark:bg-red-950/20 before:absolute before:right-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-red-500"
                            : "text-zinc-600 dark:text-zinc-400 hover:text-foreground hover:bg-muted/40",
                        ].join(" ")}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )
              })}
            </nav>
          </aside>
        )}

        {activeTab === "portfolio" && (
          <aside className="w-44 border-r bg-background flex-shrink-0">
            <div className="flex items-center gap-2 px-4 py-4 border-b">
              <div className="h-7 w-7 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0">
                <Briefcase className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-semibold text-foreground">组合管理</span>
            </div>
            <nav className="flex flex-col pt-3 pb-4">
              {portfolioSidebarGroups.map((group) => {
                const hasActive = group.items.some((i) => i.key === activeSideItem)
                return (
                  <div key={group.label}>
                    <div className={[
                      "px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide select-none",
                      hasActive ? "text-red-500" : "text-zinc-400 dark:text-zinc-500",
                    ].join(" ")}>{group.label}</div>
                    {group.items.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => setActiveSideItem(item.key)}
                        className={[
                          "w-full text-left pl-5 pr-3 py-1.5 text-sm transition-colors focus:outline-none relative",
                          activeSideItem === item.key
                            ? "text-red-600 dark:text-red-400 font-medium bg-red-50/60 dark:bg-red-950/20 before:absolute before:right-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-red-500"
                            : "text-zinc-600 dark:text-zinc-400 hover:text-foreground hover:bg-muted/40",
                        ].join(" ")}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )
              })}
            </nav>
          </aside>
        )}

        {/* Page content area */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-y-auto p-5">
          {activeTab === "funds" && activeSideItem === "private-funds" && <PrivateFundView />}
          {activeTab === "funds" && activeSideItem === "fund-managers-org" && <PrivateFundManagersView />}
          {activeTab === "funds" && activeSideItem === "fund-managers" && <PrivateFundManagersPersonalView />}
          {activeTab === "funds" && activeSideItem !== "private-funds" && activeSideItem !== "fund-managers-org" && activeSideItem !== "fund-managers" && (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              该功能正在建设中，敬请期待
            </div>
          )}
          {activeTab === "portfolio" && activeSideItem === "port-new" && <PortfolioNewView />}
          {activeTab === "portfolio" && (activeSideItem === "port-simulated" || activeSideItem === "port-live") && (
            <PortfolioView sideItem={activeSideItem} />
          )}
          {activeTab === "investment" && activeSideItem === "inv-tracking" && <InvestmentTrackingView />}
          {activeTab === "investment" && activeSideItem === "inv-tracking-mgr" && <InvestmentTrackingManagersView />}
          {activeTab === "investment" && activeSideItem === "inv-active" && <InvestmentManagedProductsView />}
          {activeTab === "investment" && activeSideItem === "inv-fof" && <InvestmentFofOverviewView />}
          {activeTab === "investment" && activeSideItem !== "inv-tracking" && activeSideItem !== "inv-tracking-mgr" && activeSideItem !== "inv-active" && activeSideItem !== "inv-fof" && (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              该功能正在建设中，敬请期待
            </div>
          )}
          {activeTab === "operations" && activeSideItem === "ops-strategy-tags" && <OperationsStrategyTagsView initialOpsTab={(searchParams.get("ops") as "strategies" | "tags" | "fields") || "strategies"} />}
          {activeTab === "operations" && activeSideItem === "ops-tracking" && <InvestmentTrackingView variant="operations" />}
          {activeTab === "operations" && activeSideItem === "ops-direct" && <OperationsDirectView />}
          {activeTab === "operations" && activeSideItem === "ops-fof" && <OperationsFofUnderlyingView />}
          {activeTab === "operations" && activeSideItem === "ops-active-funds" && <OperationsManagedProductsView />}
          {activeTab === "operations" && activeSideItem === "ops-email-sync" && <OperationsEmailSyncView />}
          {activeTab === "operations" && activeSideItem !== "ops-strategy-tags" && activeSideItem !== "ops-tracking" && activeSideItem !== "ops-direct" && activeSideItem !== "ops-fof" && activeSideItem !== "ops-active-funds" && activeSideItem !== "ops-email-sync" && (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              该功能正在建设中，敬请期待
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
