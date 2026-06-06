"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { LineChart, Heart, Send, ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight, Search, CalendarDays, LayoutTemplate, PlusCircle, Download, RefreshCw, Settings2, ClipboardList, FileSearch, Tag, Layers, StickyNote, BarChart2, Star, MinusCircle } from "lucide-react"

const menuItems = [
  { key: "funds", label: "基金" },
  { key: "portfolio", label: "组合" },
  { key: "investment", label: "投资" },
  { key: "operations", label: "运维" },
]

const fundsSidebarItems = [
  { key: "private-funds", label: "私募基金" },
  { key: "fund-managers-org", label: "私募管理人" },
  { key: "fund-managers", label: "基金经理" },
]

interface SidebarGroup {
  label: string
  items: { key: string; label: string }[]
}

const investmentSidebarGroups: SidebarGroup[] = [
  {
    label: "尽调池",
    items: [
      { key: "inv-dd-calendar", label: "尽调日历" },
      { key: "inv-dd-report", label: "尽调报告" },
      { key: "inv-notes", label: "投资笔记" },
      { key: "inv-score", label: "评分管理" },
    ],
  },
  {
    label: "跟踪池",
    items: [
      { key: "inv-tracking", label: "跟踪产品" },
      { key: "inv-tracking-mgr", label: "跟踪管理人" },
      { key: "inv-compare", label: "基金对比" },
      { key: "inv-approve", label: "审批入池" },
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

const sidebarMap: Record<string, { key: string; label: string }[]> = {
  funds: fundsSidebarItems,
}

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

const TAB_DEFAULT_SIDE: Record<string, string> = {
  funds: "private-funds",
  investment: "inv-tracking",
  operations: "ops-strategy-tags",
}

const TRACK_STRATEGIES = ["不限", "期货策略", "股票对冲", "股票多头", "套利策略", "期权策略", "多资产策略", "债券策略", "组合策略", "其他"]
const ORG_SIZE_OPTS = ["不限", "100亿以上", "50-100亿", "20-50亿", "10-20亿", "5-10亿", "0-5亿"]
const DEFAULT_POOLS = [
  { key: "all", label: "全部" },
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

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-3 py-1 rounded-md text-xs font-medium transition-all cursor-pointer whitespace-nowrap",
        active
          ? "bg-zinc-600 text-white shadow-sm dark:bg-zinc-300 dark:text-zinc-900"
          : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100",
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
          <div className="flex items-center gap-1 flex-wrap">
            {STRATEGIES.map((s) => (
              <FilterPill
                key={s}
                label={s}
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
            <div className="flex items-center gap-1 flex-wrap">
              <FilterPill
                label="不限"
                active={filters.strategyFilters.every((f) => f.l2s.length === 0)}
                onClick={clearAllL2}
              />
              {l2Options.map(({ l1, l2 }) => (
                <FilterPill
                  key={`${l1}:${l2}`}
                  label={l2}
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
          <div className="flex items-center gap-1 overflow-x-auto flex-1 scrollbar-none">
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
                    className="rounded h-3 w-3"
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
                    className="rounded h-3 w-3"
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
            <div className="flex items-center gap-1 flex-wrap">
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
          <div className="flex items-center gap-1 overflow-x-auto flex-1 scrollbar-none">
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
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1">
            {getPeriodsForMetric(filters.metricTab).map((p) => (
              <FilterPill key={p} label={p} active={filters.period === p} onClick={() => onChange({ period: p })} />
            ))}
          </div>
        </div>
        <div className="flex items-center pl-16 pr-4 py-1.5 border-t border-dashed bg-muted/20">
          <span className={lbl}>{filters.metricTab.includes("排名") ? "指标排名：" : "指标范围："}</span>
          <div className="flex items-center gap-1 flex-wrap">
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
              <span className="flex items-center gap-1 bg-zinc-100 text-zinc-800 border border-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700 rounded px-2 py-0.5 text-xs">
                {c.label}
                <button onClick={c.clear} className="hover:opacity-60 leading-none ml-0.5 text-zinc-500">×</button>
              </span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <button onClick={clearAll} className="text-xs text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">清空</button>
          <span className="text-zinc-200 dark:text-zinc-700">|</span>
          <button onClick={() => setShowSaveModal(true)} className="text-xs font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100 transition-colors">保存</button>
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
            className="px-4 py-1.5 bg-zinc-900 text-white rounded text-sm hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 transition-colors disabled:opacity-40">保存</button>
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

  const sfKey = JSON.stringify(strategyFilters)

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
      <div className="overflow-x-auto rounded-lg border">
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
                    ? "bg-zinc-900 text-white border-zinc-900 font-medium shadow-sm dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
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

function InvestmentTrackingView() {
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
  const [myPersonalTagMode, setMyPersonalTagMode] = useState<"and" | "or">("and")
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
  const sourcePool = isSupportedPool ? activePool : "bfl"

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

  async function handleTrackExport(filename: string) {
    const escape = (v: string | null | undefined) => {
      if (!v) return ""
      const s = String(v)
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, "\"\"")}"` : s
    }
    const params = new URLSearchParams({
      export: "1", sort: sortCol, dir: sortDir, keyword,
      pool: sourcePool,
      strategy_l1: strategyL1,
      strategy_l2: strategyL2,
      strategy_l3: strategyL3,
      strategy_source: strategySource,
      org_size: orgSizeFilter,
      team_tag_mode: teamTagMode,
      cutoff: teamCutoffDate,
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
    if (!isSupportedPool) {
      setData([])
      setTotal(0)
      return
    }
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page), sort: sortCol, dir: sortDir, keyword,
      pool: sourcePool,
      strategy_l1: strategyL1,
      strategy_l2: strategyL2,
      strategy_l3: strategyL3,
      strategy_source: strategySource,
      org_size: orgSizeFilter,
      team_tag_mode: teamTagMode,
      cutoff: teamCutoffDate,
    })
    teamTags.forEach((tag) => params.append("team_tag", tag))
    fetch(`/ma/api/tracking-funds/list?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d.data ?? []); setTotal(d.total ?? 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [activePool, page, sortCol, sortDir, keyword, strategyL1, strategyL2, strategyL3, trackingFilterKey])

  // Batch-load notes for current page rows
  useEffect(() => {
    if (data.length === 0) return
    const ids = data.map((r) => r.beian_hao).join(",")
    fetch(`/ma/api/tracking-funds/fund-note?beian_haos=${encodeURIComponent(ids)}`)
      .then((r) => r.json())
      .then((d) => { if (d && typeof d === "object" && !d.error) setFundNotes((prev) => ({ ...prev, ...d })) })
      .catch(() => {})
  }, [data])

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
      {/* Team / Mine tabs */}
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

      {trackTab === "team" && (
      <div className="flex gap-0 flex-1 min-h-0">
        {/* Left pool sidebar */}
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

        {/* Main content */}
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
                        ? "border-zinc-400 text-zinc-700 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-200"
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
                          ? "border-zinc-400 text-zinc-700 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-200"
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
                          ? "border-zinc-400 text-zinc-700 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-200"
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
                        ? "border-zinc-400 text-zinc-700 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-200"
                        : "border-border text-zinc-500 hover:bg-muted/60",
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
                    onClick={() => { setOrgSizeFilter(s); setPage(1) }}
                    className={[
                      "inline-flex items-center px-2.5 py-1 rounded border text-xs cursor-pointer transition-colors",
                      orgSizeFilter === s
                        ? s === "不限"
                          ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                          : "border-zinc-400 text-zinc-700 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-200"
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
          </div>

          {/* Toolbar */}
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

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border flex-1">
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
                  const bg = isSelected ? "bg-blue-50/40 dark:bg-blue-950/20" : "bg-background"
                  const cell = `border-b px-3 py-0 ${bg} group-hover:bg-muted/30 transition-colors`
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
                        <div className="relative flex items-center justify-center">
                          <button
                            onClick={() => setOpenRowMenu(openRowMenu === row.beian_hao ? null : row.beian_hao)}
                            className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors text-base leading-none tracking-widest">
                            ···
                          </button>
                          {openRowMenu === row.beian_hao && (
                            <>
                              <div className="fixed inset-0 z-30" onClick={() => setOpenRowMenu(null)} />
                              <div className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[140px]" onClick={(e) => e.stopPropagation()}>
                                <button onClick={() => { setElementsBeianHao(row.beian_hao); setElementsName(row.product_name); setShowElementsDialog(true); setOpenRowMenu(null) }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"><FileSearch className="h-3.5 w-3.5 text-muted-foreground" />查询要素</button>
                                <button onClick={() => { openEditTagDialog(row.beian_hao, row.product_name); setOpenRowMenu(null) }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"><Tag className="h-3.5 w-3.5 text-muted-foreground" />编辑标签</button>
                                <button onClick={() => { openEditStrategyDialog(row.beian_hao, row.product_name); setOpenRowMenu(null) }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"><Layers className="h-3.5 w-3.5 text-muted-foreground" />编辑策略</button>
                                <button onClick={() => { openNoteDialog(row.beian_hao, row.product_name); setOpenRowMenu(null) }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"><StickyNote className="h-3.5 w-3.5 text-muted-foreground" />备注管理</button>
                                <button onClick={() => setOpenRowMenu(null)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"><BarChart2 className="h-3.5 w-3.5 text-muted-foreground" />估值表分析</button>
                                <button onClick={() => setOpenRowMenu(null)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"><Star className="h-3.5 w-3.5 text-muted-foreground" />收藏</button>
                                <div className="border-t my-1" />
                                <button
                                  onClick={() => {
                                    setBatchContextPool(sourcePool)
                                    setBatchConfirmTitle("取消跟踪")
                                    setBatchConfirmMessage(`确定要将「${row.product_name}」从当前产品池中移除吗？`)
                                    setBatchConfirmAction("remove")
                                    setSelected(new Set([row.beian_hao]))
                                    setOpenRowMenu(null)
                                    setShowBatchConfirmDialog(true)
                                  }}
                                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2 text-red-500">
                                  <MinusCircle className="h-3.5 w-3.5" />取消跟踪
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

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
                        btn === page ? "bg-zinc-900 text-white border-zinc-900 font-medium dark:bg-zinc-100 dark:text-zinc-900" : "text-foreground hover:bg-muted border-border"].join(" ")}>
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

      {trackTab === "mine" && (
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
                onClick={() => setMyActivePool(p.key)}
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
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select
                    value={myPersonalTagMode}
                    onChange={(e) => setMyPersonalTagMode(e.target.value as "and" | "or")}
                    className="h-7 min-w-[5.75rem] appearance-none rounded border border-border bg-background pl-2 pr-6 text-xs text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="and">交集（且）</option>
                    <option value="or">并集（或）</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
                </div>
                <span className="inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20">不限</span>
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
                        ? s === "不限"
                          ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                          : "border-zinc-400 text-zinc-700 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-200"
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
                />
                <button className="text-muted-foreground hover:text-foreground transition-colors">
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
                      <button onClick={() => { setShowMineMoreMenu(false); handleTrackExport(`我的跟踪_${new Date().toISOString().slice(0, 10)}.csv`) }} className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2">
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
                <tr>
                  <td colSpan={13} className="py-20 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                      <span>暂无数据</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
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
                <span className="font-semibold text-sm">团队备注</span>
                <button
                  onClick={() => { setOpenNotePopup(null); openNoteDialog(openNotePopup, noteRow?.product_name ?? "") }}
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
                    await fetch(`/ma/api/tracking-funds/fund-note?beian_hao=${encodeURIComponent(openNotePopup)}`, { method: "DELETE" })
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

interface OpsStrategyL1 {
  l1: string
  l2s: string[]
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
    await fetch(`/ma/api/ops/team-tags/${id}`, { method: "DELETE" })
    setTags((prev) => prev.filter((t) => t.id !== id))
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

function OperationsStrategyTagsView({ initialOpsTab = "strategies" }: { initialOpsTab?: "strategies" | "tags" | "fields" }) {
  const [opsTab, setOpsTab] = useState<"strategies" | "tags" | "fields">(initialOpsTab)
  const [strategies, setStrategies] = useState<OpsStrategyL1[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showNewL1Modal, setShowNewL1Modal] = useState(false)
  const [newL1Name, setNewL1Name] = useState("")
  const [editingKey, setEditingKey] = useState<{ l1: string; l2?: string } | null>(null)
  const [editName, setEditName] = useState("")

  useEffect(() => {
    setLoading(true)
    fetch("/ma/api/private-funds/strategies")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setStrategies(d) : null)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function toggleExpand(l1: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(l1) ? next.delete(l1) : next.add(l1)
      return next
    })
  }

  interface FlatRow { type: "l1" | "l2"; l1: string; l2?: string; index?: number }
  const rows: FlatRow[] = []
  let idx = 1
  for (const s of strategies) {
    rows.push({ type: "l1", l1: s.l1, index: idx++ })
    if (expanded.has(s.l1)) {
      for (const l2 of s.l2s) rows.push({ type: "l2", l1: s.l1, l2 })
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
                  <tr key={`${row.l1}_${row.l2 ?? "l1"}_${i}`} className="border-b hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">
                      {row.type === "l1" ? row.index : ""}
                    </td>
                    <td className="px-4 py-3">
                      {row.type === "l1" ? (
                        <button
                          onClick={() => toggleExpand(row.l1)}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-red-500 transition-colors"
                        >
                          <span className="text-red-500 font-bold text-base leading-none select-none">+</span>
                          {row.l1}
                        </button>
                      ) : (
                        <span className="text-muted-foreground pl-5">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.type === "l2" ? (
                        <span className="text-sm">{row.l2}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-muted-foreground">-</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          title="编辑"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => {
                            setEditingKey({ l1: row.l1, l2: row.l2 })
                            setEditName(row.type === "l1" ? row.l1 : (row.l2 ?? ""))
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M11 9H8a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"/><path d="M15.5 5.5a2 2 0 0 1 3 3L12 15l-4 1 1-4 6.5-6.5z"/></svg>
                        </button>
                        <button
                          title="管理子级"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => toggleExpand(row.l1)}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
                        </button>
                        <button
                          title="删除"
                          className="text-muted-foreground hover:text-red-500 transition-colors"
                          onClick={() => {
                            if (row.type === "l1") {
                              setStrategies((prev) => prev.filter((s) => s.l1 !== row.l1))
                              setExpanded((prev) => { const next = new Set(prev); next.delete(row.l1); return next })
                            } else {
                              setStrategies((prev) => prev.map((s) =>
                                s.l1 !== row.l1 ? s : { ...s, l2s: s.l2s.filter((x) => x !== row.l2) }
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
        <div className="flex-1 flex items-center justify-center text-muted-foreground mt-8">
          团队字段管理（待开发）
        </div>
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
                  if (e.key === "Enter" && newL1Name.trim()) {
                    setStrategies((prev) => [...prev, { l1: newL1Name.trim(), l2s: [] }])
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
                    setStrategies((prev) => [...prev, { l1: newL1Name.trim(), l2s: [] }])
                    setShowNewL1Modal(false)
                  }
                }}
                disabled={!newL1Name.trim()}
                className="px-4 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                确 定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editingKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditingKey(null)}>
          <div className="bg-background border rounded-lg shadow-xl w-[400px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="font-semibold text-base">编辑策略名称</span>
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
                  if (e.key === "Enter" && editName.trim()) {
                    if (!editingKey.l2) {
                      setStrategies((prev) => prev.map((s) => s.l1 === editingKey.l1 ? { ...s, l1: editName.trim() } : s))
                    } else {
                      setStrategies((prev) => prev.map((s) => s.l1 !== editingKey.l1 ? s : { ...s, l2s: s.l2s.map((x) => x === editingKey.l2 ? editName.trim() : x) }))
                    }
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
                    if (!editingKey.l2) {
                      setStrategies((prev) => prev.map((s) => s.l1 === editingKey.l1 ? { ...s, l1: editName.trim() } : s))
                    } else {
                      setStrategies((prev) => prev.map((s) => s.l1 !== editingKey.l1 ? s : { ...s, l2s: s.l2s.map((x) => x === editingKey.l2 ? editName.trim() : x) }))
                    }
                    setEditingKey(null)
                  }
                }}
                disabled={!editName.trim()}
                className="px-4 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                确 定
              </button>
            </div>
          </div>
        </div>
      )}
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

export default function PrivateFundsPage() {
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState(() => searchParams.get("tab") || "funds")
  const [activeSideItem, setActiveSideItem] = useState(() => {
    const side = searchParams.get("side")
    if (side) return side
    const tab = searchParams.get("tab") || "funds"
    return TAB_DEFAULT_SIDE[tab] ?? "private-funds"
  })

  const sidebarItems = sidebarMap[activeTab] ?? []

  function handleTabChange(tab: string) {
    setActiveTab(tab)
    if (TAB_DEFAULT_SIDE[tab]) setActiveSideItem(TAB_DEFAULT_SIDE[tab])
  }

  return (
    <div className="flex flex-col">
      {/* Top menu bar */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <nav className="flex items-center gap-1 px-6 h-12">
          {menuItems.map((item) => (
            <button
              key={item.key}
              onClick={() => handleTabChange(item.key)}
              className={[
                "relative px-4 h-full text-sm font-medium transition-colors focus:outline-none",
                activeTab === item.key
                  ? "text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-zinc-900 after:rounded-full dark:after:bg-zinc-100"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex">
        {sidebarItems.length > 0 && (
          <aside className="w-44 border-r bg-background flex-shrink-0">
            <nav className="flex flex-col gap-0.5 p-3 pt-4">
              {sidebarItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setActiveSideItem(item.key)}
                  className={[
                    "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none",
                    activeSideItem === item.key
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-semibold"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  ].join(" ")}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>
        )}
        {activeTab === "investment" && (
          <aside className="w-44 border-r bg-background flex-shrink-0">
            <nav className="flex flex-col pt-3 pb-4">
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
                            ? "text-red-600 dark:text-red-400 font-medium before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-red-500 before:rounded-full"
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
            <nav className="flex flex-col pt-3 pb-4">
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
                            ? "text-red-600 dark:text-red-400 font-medium before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:bg-red-500 before:rounded-full"
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
        <div className="flex-1 min-w-0 overflow-x-hidden p-5">
          {activeTab === "funds" && activeSideItem === "private-funds" && <PrivateFundView />}
          {activeTab === "investment" && activeSideItem === "inv-tracking" && <InvestmentTrackingView />}
          {activeTab === "operations" && activeSideItem === "ops-strategy-tags" && <OperationsStrategyTagsView initialOpsTab={(searchParams.get("ops") as "strategies" | "tags" | "fields") || "strategies"} />}
          {activeTab === "operations" && activeSideItem !== "ops-strategy-tags" && (
            <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
              该功能正在建设中，敬请期待
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
