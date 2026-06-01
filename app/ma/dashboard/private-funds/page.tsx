"use client"

import { useEffect, useState } from "react"
import { LineChart, Heart, Send, ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight, Search, CalendarDays, LayoutTemplate, PlusCircle, Download } from "lucide-react"

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

const TAB_DEFAULT_SIDE: Record<string, string> = {
  funds: "private-funds",
  investment: "inv-tracking",
}

const TRACK_STRATEGIES = ["不限", "期货策略", "股票对冲", "股票多头", "套利策略", "期权策略", "多资产策略", "债券策略", "组合策略", "其他"]
const ORG_SIZE_OPTS = ["不限", "100亿以上", "50-100亿", "20-50亿", "10-20亿", "5-10亿", "0-5亿"]
const pools = [
  { key: "all", label: "全部" },
  { key: "bfl", label: "bfl跟踪池" },
  { key: "tracking", label: "跟踪池" },
  { key: "selected", label: "精选池" },
  { key: "core", label: "核心池" },
  { key: "hy", label: "hy跟踪池" },
  { key: "fof", label: "FOF&MO..." },
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
}

function TrackPctCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const n = parseFloat(value)
  if (isNaN(n)) return <span className="text-muted-foreground">—</span>
  const cls = n > 0 ? "text-red-500" : n < 0 ? "text-green-600" : "text-foreground"
  return <span className={cls}>{n > 0 ? "+" : ""}{(n * 100).toFixed(2)}%</span>
}

const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"
const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`

interface TrackStrategyNode {
  l1: string
  l2s: { l2: string; l3s: string[] }[]
}

function InvestmentTrackingView() {
  const [trackTab, setTrackTab] = useState<"team" | "mine">("team")
  const [activePool, setActivePool] = useState("bfl")
  const [fundClass, setFundClass] = useState<"private" | "public">("private")
  const [strategyHierarchy, setStrategyHierarchy] = useState<TrackStrategyNode[]>([])
  const [strategyL1, setStrategyL1] = useState("")
  const [strategyL2, setStrategyL2] = useState("")
  const [strategyL3, setStrategyL3] = useState("")
  const [orgSizeFilter, setOrgSizeFilter] = useState("不限")
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [sortCol, setSortCol] = useState("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [jumpVal, setJumpVal] = useState("")
  const [data, setData] = useState<TrackFundRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Derived hierarchy slices
  const l2Options = strategyL1
    ? (strategyHierarchy.find((n) => n.l1 === strategyL1)?.l2s ?? [])
    : []
  const l3Options = strategyL2
    ? (l2Options.find((n) => n.l2 === strategyL2)?.l3s ?? [])
    : []

  // Fetch strategy hierarchy once
  useEffect(() => {
    fetch("/ma/api/tracking-funds/strategies")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setStrategyHierarchy(d) : null)
      .catch(() => {})
  }, [])

  const isBfl = activePool === "bfl"
  const totalPages = Math.max(1, Math.ceil(total / 50))

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
    if (!isBfl) return
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page), sort: sortCol, dir: sortDir, keyword,
      strategy_l1: strategyL1,
      strategy_l2: strategyL2,
      strategy_l3: strategyL3,
    })
    fetch(`/ma/api/tracking-funds/list?${params}`)
      .then((r) => r.json())
      .then((d) => { setData(d.data ?? []); setTotal(d.total ?? 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isBfl, page, sortCol, sortDir, keyword, strategyL1, strategyL2, strategyL3])

  return (
    <div className="flex flex-col h-full">
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

      <div className="flex gap-0 flex-1 min-h-0">
        {/* Left pool sidebar */}
        <aside className="w-32 flex-shrink-0 border-r">
          <div className="flex items-center gap-1 px-2 py-2 border-b">
            <button className="flex-1 inline-flex items-center justify-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-muted/60 rounded px-2 py-1 transition-colors">
              <span className="text-base leading-none">⊕</span>
              <span>新增</span>
            </button>
            <button className="flex-1 inline-flex items-center justify-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-muted/60 rounded px-2 py-1 transition-colors">
              <span className="text-sm leading-none">⚙</span>
              <span>管理</span>
            </button>
          </div>
          <nav className="flex flex-col gap-0.5 p-1.5">
            {pools.map((p) => (
              <button
                key={p.key}
                onClick={() => setActivePool(p.key)}
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
                  <button
                    key={fc}
                    onClick={() => setFundClass(fc)}
                    className={[
                      "px-3 py-1 rounded text-xs font-medium transition-all border",
                      fundClass === fc
                        ? "bg-red-500 text-white border-red-500"
                        : "text-zinc-500 border-border hover:text-foreground hover:bg-muted/60",
                    ].join(" ")}
                  >
                    {fc === "private" ? "私募" : "公募"}
                  </button>
                ))}
              </div>
            </div>
            {/* 一级策略 */}
            <div className="flex items-start px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3 pt-1">一级策略：</span>
              <div className="flex items-center gap-2 flex-wrap">
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
              <div className="flex items-center gap-2">
                <button className="inline-flex items-center gap-1 border rounded px-2.5 py-1 text-xs text-zinc-600 hover:bg-muted/60 transition-colors">
                  交集 (且)
                  <ChevronDown className="h-3 w-3" />
                </button>
                <span className="inline-flex items-center px-2.5 py-1 rounded border border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 text-xs font-medium cursor-pointer">
                  不限
                </span>
              </div>
            </div>
            {/* 管理人规模 */}
            <div className="flex items-center px-4 py-2">
              <span className="text-zinc-400 shrink-0 w-[4.5rem] text-right pr-3">管理人规模：</span>
              <div className="flex items-center gap-1 flex-wrap">
                {ORG_SIZE_OPTS.map((s) => (
                  <FilterPill key={s} label={s} active={orgSizeFilter === s} onClick={() => setOrgSizeFilter(s)} />
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
              <button className="inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-zinc-600 hover:bg-muted cursor-pointer transition-colors">
                <CalendarDays className="h-3 w-3" />
                <span className="tabular-nums">{new Date().toISOString().slice(0, 10)}</span>
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
                <input type="checkbox" defaultChecked className="rounded h-3 w-3 accent-zinc-700" />
                计算指标
              </label>
              <label className="inline-flex items-center gap-1 text-zinc-600 cursor-pointer hover:text-foreground">
                <input type="checkbox" className="rounded h-3 w-3 accent-zinc-700" />
                显示区间
              </label>
              <button className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
                <LayoutTemplate className="h-3 w-3" />
                默认模板
                <ChevronDown className="h-3 w-3" />
              </button>
              <button className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
                <PlusCircle className="h-3 w-3" />
                添加指标
              </button>
              <button className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
                批量操作
              </button>
              <button className="inline-flex items-center gap-1 text-zinc-600 hover:text-foreground border border-border/50 rounded px-2 py-1 hover:bg-muted/60 transition-colors">
                ⊕ 更多
              </button>
              <button className="inline-flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white rounded px-3 py-1.5 font-medium transition-colors">
                添加跟踪
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border flex-1">
            <table className="text-sm border-collapse w-full" style={{ minWidth: 1200 }}>
              <thead className="sticky top-0 z-20">
                <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
                  <th className={`${thBase} w-8 px-2`}>
                    <input type="checkbox" className="rounded h-3 w-3"
                      checked={selected.size === data.length && data.length > 0}
                      onChange={toggleAll} />
                  </th>
                  <th className={`${thBase} w-10`}>序号</th>
                  <th className={`${thSort} min-w-[200px]`} onClick={() => handleSort("product_name")}>产品名称<SortIco col="product_name" /></th>
                  <th className={`${thSort} min-w-[100px]`} onClick={() => handleSort("latest_nav_date")}>最新净值日期<SortIco col="latest_nav_date" /></th>
                  <th className={`${thSort} min-w-[90px]`} onClick={() => handleSort("latest_nav")}>最新单位净值<SortIco col="latest_nav" /></th>
                  <th className={`${thBase} text-right min-w-[88px]`}>最新涨跌幅</th>
                  <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1w")}>近一周收益<SortIco col="ret_1w" /></th>
                  <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1m")}>近一月收益<SortIco col="ret_1m" /></th>
                  <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_3m")}>近三月收益<SortIco col="ret_3m" /></th>
                  <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_6m")}>近六月收益<SortIco col="ret_6m" /></th>
                  <th className={`${thSort} text-right min-w-[88px]`} onClick={() => handleSort("ret_1y")}>近一年收益<SortIco col="ret_1y" /></th>
                  <th className={`${thBase} text-center w-16`}>走势</th>
                  <th className={`${thBase} text-center w-16`}>资料</th>
                  <th className={`${thBase} text-center w-16`}>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={14} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
                ) : !isBfl ? (
                  <tr><td colSpan={14} className="py-20 text-center text-muted-foreground">请选择 bfl跟踪池 查看数据</td></tr>
                ) : data.length === 0 ? (
                  <tr><td colSpan={14} className="py-20 text-center text-muted-foreground">暂无数据</td></tr>
                ) : data.map((row, i) => {
                  const isSelected = selected.has(row.beian_hao)
                  const bg = isSelected ? "bg-blue-50/40 dark:bg-blue-950/20" : "bg-background"
                  const cell = `border-b px-3 py-0 ${bg} group-hover:bg-muted/30 transition-colors`
                  return (
                    <tr key={row.beian_hao} className="group" style={{ height: 52 }}>
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
                      <td className={`${cell}`}>
                        <a
                          href={`/ma/dashboard/private-funds/${encodeURIComponent(row.beian_hao)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-blue-600 dark:text-blue-400 leading-5 truncate max-w-[220px] hover:underline block"
                          title={row.product_name}
                        >{row.product_name}</a>
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
                      <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.ret_1w} /></td>
                      <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.ret_1m} /></td>
                      <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.ret_3m} /></td>
                      <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.ret_6m} /></td>
                      <td className={`${cell} text-right tabular-nums`}><TrackPctCell value={row.ret_1y} /></td>
                      <td className={`${cell} text-center`}>
                        <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><LineChart className="h-3.5 w-3.5" /></button>
                      </td>
                      <td className={`${cell} text-center`}><span className="text-muted-foreground">—</span></td>
                      <td className={`${cell} text-center`}>
                        <div className="flex items-center justify-center gap-1">
                          <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-rose-500 transition-colors"><Heart className="h-3.5 w-3.5" /></button>
                          <button className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"><Send className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {isBfl && (
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
  const [activeTab, setActiveTab] = useState("funds")
  const [activeSideItem, setActiveSideItem] = useState("private-funds")

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

        {/* Page content area */}
        <div className="flex-1 p-5">
          {activeTab === "funds" && activeSideItem === "private-funds" && <PrivateFundView />}
          {activeTab === "investment" && activeSideItem === "inv-tracking" && <InvestmentTrackingView />}
        </div>
      </div>
    </div>
  )
}
