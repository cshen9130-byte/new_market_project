"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"

// ─── localStorage keys ───────────────────────────────────────────────────────
const METRIC_TEMPLATES_KEY = "tracking_metric_templates"
const CALC_SETTINGS_KEY    = "tracking_calc_settings"

interface MetricItem { period: string; metric: string }
interface MetricTemplate { name: string; items: MetricItem[] }

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

interface CalcSettings {
  navType:      string
  riskFreeRate: string
  periodCalc:   string
  excessCalc:   string
  annualCalc:   string
  weeklyNav:    string
  watermark:    boolean
}

const DEFAULT_CALC: CalcSettings = {
  navType:      "复权净值",
  riskFreeRate: "2.00",
  periodCalc:   "连乘",
  excessCalc:   "除法",
  annualCalc:   "复利",
  weeklyNav:    "周频时展示月末最后交易日净值",
  watermark:    true,
}

const LEFT_NAV = [
  { group: "个人中心", items: ["用户中心", "个人积分", "个人标签", "个人配置", "常用注册", "登录设置"] },
  { group: "团队管理", items: ["评分设置", "指令设置", "报告设置"] },
]

const SECTION_FROM_PARAM: Record<string, string> = {
  "personal-tags": "个人标签",
}

const PERSONAL_TAG_CATEGORIES = [
  { key: "fund_personal", param: "fund", label: "基金" },
  { key: "portfolio_personal", param: "portfolio", label: "组合" },
  { key: "compare_personal", param: "compare", label: "对比" },
  { key: "note_personal", param: "note", label: "笔记" },
] as const

const TABS = ["计算设置", "指标模板", "对比分析模板", "常用基准"] as const
type Tab = typeof TABS[number]

interface PersonalTagRow {
  id: number
  category: string
  name: string
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

function fmtTagDateTime(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function currentUserName(): string {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    return u?.name || u?.email || ""
  } catch {
    return ""
  }
}

function PersonalTagsPanel({ initialCategory = "fund" }: { initialCategory?: string }) {
  const initialKey = PERSONAL_TAG_CATEGORIES.find((c) => c.param === initialCategory)?.key ?? "fund_personal"
  const [tagCategory, setTagCategory] = useState(initialKey)
  const [tags, setTags] = useState<PersonalTagRow[]>([])
  const [loading, setLoading] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [newTagName, setNewTagName] = useState("")
  const [newTagSaving, setNewTagSaving] = useState(false)
  const [editingTag, setEditingTag] = useState<PersonalTagRow | null>(null)
  const [editTagName, setEditTagName] = useState("")
  const [editTagSaving, setEditTagSaving] = useState(false)

  function loadTags(cat: string) {
    const owner = currentUserName()
    setLoading(true)
    fetch(`/ma/api/ops/team-tags?category=${encodeURIComponent(cat)}&owner=${encodeURIComponent(owner)}`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) ? setTags(d) : setTags([]))
      .catch(() => setTags([]))
      .finally(() => setLoading(false))
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
        setShowNewModal(false)
        setNewTagName("")
        loadTags(tagCategory)
      }
    } finally {
      setNewTagSaving(false)
    }
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
    } finally {
      setEditTagSaving(false)
    }
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
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500 font-medium">分类：</span>
          {PERSONAL_TAG_CATEGORIES.map((c) => (
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
          onClick={() => { setNewTagName(""); setShowNewModal(true) }}
          className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded transition-colors"
        >
          新增标签
        </button>
      </div>

      <div className="overflow-auto rounded border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/40 border-b">
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-16">序号</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">标签名称</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">最后修改</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-500 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : tags.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : tags.map((tag, i) => (
              <tr key={tag.id} className="border-b hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-4 py-3 font-medium">{tag.name}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{fmtTagDateTime(tag.updated_at)}</td>
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

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewModal(false)}>
          <div className="bg-background border rounded-lg shadow-xl w-[360px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <span className="font-semibold text-base">新建标签</span>
              <button onClick={() => setShowNewModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
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
              <button onClick={() => setShowNewModal(false)} className="px-5 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
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
              <button onClick={() => setEditingTag(null)} className="px-4 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
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
    </div>
  )
}

// ─── Utility ─────────────────────────────────────────────────────────────────
function readLS<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback } catch { return fallback }
}

function normalizeCalcSettings(raw: Partial<CalcSettings> | null | undefined): CalcSettings {
  return { ...DEFAULT_CALC, ...(raw ?? {}) }
}

// ─── CalcSettingsPanel ───────────────────────────────────────────────────────
function CalcSettingsPanel() {
  const [settings, setSettings] = useState<CalcSettings>(() =>
    normalizeCalcSettings(readLS<Partial<CalcSettings> | null>(CALC_SETTINGS_KEY, null))
  )
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CalcSettings>(settings)

  function save() {
    setSettings(draft)
    localStorage.setItem(CALC_SETTINGS_KEY, JSON.stringify(draft))
    setEditing(false)
  }

  const row = (label: string, value: string) => (
    <div className="flex items-center gap-1 text-sm text-zinc-700 dark:text-zinc-300 py-1.5">
      <span className="text-zinc-500 dark:text-zinc-400 w-28 shrink-0">{label}：</span>
      <span>{value}</span>
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
          计算设置
        </div>
        {!editing && (
          <button onClick={() => { setDraft(settings); setEditing(true) }} className="px-3 py-1 border border-border rounded text-sm hover:bg-muted transition-colors text-zinc-600 dark:text-zinc-300">
            编辑
          </button>
        )}
      </div>

      {!editing ? (
        <div className="space-y-0.5 pl-1">
          {row("默认净值类型", settings.navType)}
          {row("无风险利率", settings.riskFreeRate + "%")}
          {row("期间计算", settings.periodCalc ?? "连乘")}
          {row("超额计算", settings.excessCalc)}
          {row("年化计算", settings.annualCalc)}
          {row("周频净值", settings.weeklyNav)}
          <div className="flex items-center gap-1 text-sm text-zinc-700 dark:text-zinc-300 py-1.5">
            <span className="text-zinc-500 dark:text-zinc-400 w-28 shrink-0">报表水印：</span>
            <button
              onClick={() => {
                const next = { ...settings, watermark: !settings.watermark }
                setSettings(next)
                localStorage.setItem(CALC_SETTINGS_KEY, JSON.stringify(next))
              }}
              className={[
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                settings.watermark ? "bg-red-400" : "bg-zinc-300 dark:bg-zinc-600",
              ].join(" ")}
            >
              <span className={["inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform", settings.watermark ? "translate-x-[18px]" : "translate-x-1"].join(" ")} />
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 pl-1">
          <Field label="默认净值类型">
            <RadioGroup value={draft.navType} onChange={(v) => setDraft({ ...draft, navType: v })}
              options={["复权净值", "单位净值"]} />
          </Field>
          <Field label="无风险利率 (%)">
            <input type="number" step="0.01" min="0" value={draft.riskFreeRate}
              onChange={(e) => setDraft({ ...draft, riskFreeRate: e.target.value })}
              className="w-32 rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
          </Field>
          <Field label="期间计算">
            <RadioGroup value={draft.periodCalc ?? "连乘"} onChange={(v) => setDraft({ ...draft, periodCalc: v })}
              options={["连乘", "累加"]} />
          </Field>
          <Field label="超额计算">
            <RadioGroup value={draft.excessCalc} onChange={(v) => setDraft({ ...draft, excessCalc: v })}
              options={["除法", "减法"]} />
          </Field>
          <Field label="年化计算">
            <RadioGroup value={draft.annualCalc} onChange={(v) => setDraft({ ...draft, annualCalc: v })}
              options={["复利", "单利"]} />
          </Field>
          <Field label="周频净值">
            <RadioGroup value={draft.weeklyNav} onChange={(v) => setDraft({ ...draft, weeklyNav: v })}
              options={["周频时展示月末最后交易日净值", "展示最新净值"]} />
          </Field>
          <Field label="报表水印">
            <button
              onClick={() => setDraft({ ...draft, watermark: !draft.watermark })}
              className={["relative inline-flex h-5 w-9 items-center rounded-full transition-colors", draft.watermark ? "bg-red-400" : "bg-zinc-300"].join(" ")}
            >
              <span className={["inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform", draft.watermark ? "translate-x-[18px]" : "translate-x-1"].join(" ")} />
            </button>
          </Field>
          <div className="flex gap-2 pt-2">
            <button onClick={save} className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">保 存</button>
            <button onClick={() => setEditing(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-sm text-zinc-500 dark:text-zinc-400 w-28 shrink-0 pt-1.5">{label}：</span>
      <div>{children}</div>
    </div>
  )
}

function RadioGroup({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {options.map((o) => (
        <label key={o} className="inline-flex items-center gap-1.5 cursor-pointer text-sm text-zinc-600 dark:text-zinc-300">
          <input type="radio" checked={value === o} onChange={() => onChange(o)} className="accent-red-500 h-3.5 w-3.5" />
          {o}
        </label>
      ))}
    </div>
  )
}

// ─── MetricTemplatesPanel ────────────────────────────────────────────────────
function MetricTemplatesPanel() {
  const [templates, setTemplates] = useState<MetricTemplate[]>(() => readLS<MetricTemplate[]>(METRIC_TEMPLATES_KEY, []))
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  // New template: step 1 = name dialog, step 2 = picker dialog, null = closed
  const [newStep, setNewStep] = useState<1 | 2 | null>(null)
  const [newName, setNewName] = useState("")
  const [newNameTouched, setNewNameTouched] = useState(false)
  const [newPeriod, setNewPeriod] = useState("近一月")
  const [newItems, setNewItems] = useState<MetricItem[]>([])
  const [newDragIdx, setNewDragIdx] = useState<number | null>(null)

  // Edit dialog state
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editPeriod, setEditPeriod] = useState("近一月")
  const [editItems, setEditItems] = useState<MetricItem[]>([])
  const [editDragIdx, setEditDragIdx] = useState<number | null>(null)

  function persist(updated: MetricTemplate[]) {
    setTemplates(updated)
    localStorage.setItem(METRIC_TEMPLATES_KEY, JSON.stringify(updated))
  }

  function openNew() {
    setNewName(""); setNewNameTouched(false); setNewPeriod("近一月"); setNewItems([]); setNewStep(1)
  }

  function advanceNew() {
    setNewNameTouched(true)
    if (!newName.trim()) return
    setNewStep(2)
  }

  function saveNew() {
    if (!newName.trim()) return
    persist([...templates, { name: newName.trim(), items: newItems }])
    setNewStep(null)
  }

  function openEdit(i: number) {
    const t = templates[i]
    setEditIdx(i); setEditName(t.name); setEditPeriod("近一月"); setEditItems([...t.items])
  }

  function saveEdit() {
    if (editIdx === null || !editName.trim()) return
    const updated = templates.map((t, i) => i === editIdx ? { name: editName.trim(), items: editItems } : t)
    persist(updated)
    setEditIdx(null)
  }

  function deleteTemplate(i: number) {
    persist(templates.filter((_, idx) => idx !== i))
    const newTotal = templates.length - 1
    const maxPage = Math.max(1, Math.ceil(newTotal / PAGE_SIZE))
    if (page > maxPage) setPage(maxPage)
  }

  const totalPages = Math.max(1, Math.ceil(templates.length / PAGE_SIZE))
  const pageRows = templates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-end mb-4">
        <button
          onClick={openNew}
          className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">
          新建模板
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 border border-border rounded overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/60 border-b border-border">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-16">序号</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">模板名称</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-zinc-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3H10l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
                    <span className="text-sm">暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : pageRows.map((t, i) => {
              const globalIdx = (page - 1) * PAGE_SIZE + i
              return (
                <tr key={globalIdx} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-zinc-500 text-xs">{globalIdx + 1}</td>
                  <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{t.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 text-zinc-400">
                      {/* Share / export icon */}
                      <button title="导出" className="hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                      </button>
                      {/* Edit icon */}
                      <button title="编辑" onClick={() => openEdit(globalIdx)} className="hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      {/* Delete icon */}
                      <button title="删除" onClick={() => deleteTemplate(globalIdx)} className="hover:text-red-500 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
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
      <div className="flex items-center justify-end gap-2 mt-3 text-xs text-zinc-500">
        <span>共 {templates.length} 条</span>
        <button
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="w-6 h-6 rounded border border-border flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          ‹
        </button>
        <span className="w-6 h-6 rounded border border-red-300 bg-red-50 text-red-500 flex items-center justify-center font-medium">{page}</span>
        <button
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
          className="w-6 h-6 rounded border border-border flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
          ›
        </button>
      </div>

      {/* Step 1: name input dialog */}
      {newStep === 1 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setNewStep(null)}>
          <div className="bg-background rounded-lg shadow-xl w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <span className="font-semibold text-base">新建模板</span>
              <button onClick={() => setNewStep(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none transition-colors">×</button>
            </div>
            <div className="px-6 py-6">
              <div className="flex items-start gap-3">
                <span className="text-sm text-zinc-500 shrink-0 pt-1.5">
                  <span className="text-red-500 mr-0.5">*</span>模板名称：
                </span>
                <div className="flex-1">
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => { setNewName(e.target.value); setNewNameTouched(true) }}
                    onKeyDown={(e) => { if (e.key === "Enter") advanceNew() }}
                    placeholder="如：指数增强策略模板"
                    className={[
                      "w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1",
                      newNameTouched && !newName.trim()
                        ? "border-red-400 focus:ring-red-400"
                        : "border-border focus:ring-ring",
                    ].join(" ")}
                  />
                  {newNameTouched && !newName.trim() && (
                    <p className="mt-1 text-xs text-red-500">请输入模板名称</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t">
              <button onClick={() => setNewStep(null)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button
                onClick={advanceNew}
                className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">
                下一步
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: metric picker dialog */}
      {newStep === 2 && (
        <MetricPickerDialog
          templateName={newName}
          period={newPeriod}
          onPeriodChange={setNewPeriod}
          items={newItems}
          onItemsChange={setNewItems}
          dragIdx={newDragIdx}
          onDragIdxChange={setNewDragIdx}
          onClose={() => setNewStep(null)}
          onConfirm={saveNew}
        />
      )}

      {/* Edit template dialog */}
      {editIdx !== null && (
        <MetricPickerDialog
          templateName={editName}
          period={editPeriod}
          onPeriodChange={setEditPeriod}
          items={editItems}
          onItemsChange={setEditItems}
          dragIdx={editDragIdx}
          onDragIdxChange={setEditDragIdx}
          onClose={() => setEditIdx(null)}
          onConfirm={saveEdit}
        />
      )}
    </div>
  )
}

// ─── Metric picker dialog (step 2 / edit) ─────────────────────────────────────
interface MetricPickerDialogProps {
  templateName: string
  period: string
  onPeriodChange: (v: string) => void
  items: MetricItem[]
  onItemsChange: (items: MetricItem[]) => void
  dragIdx: number | null
  onDragIdxChange: (i: number | null) => void
  onClose: () => void
  onConfirm: () => void
}

function MetricPickerDialog({
  templateName, period, onPeriodChange,
  items, onItemsChange, dragIdx, onDragIdxChange,
  onClose, onConfirm,
}: MetricPickerDialogProps) {
  function toggleMetric(metric: string) {
    const exists = items.some((x) => x.period === period && x.metric === metric)
    if (exists) {
      onItemsChange(items.filter((x) => !(x.period === period && x.metric === metric)))
    } else {
      onItemsChange([...items, { period, metric }])
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl flex flex-col" style={{ width: 920, maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">选择指标</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none transition-colors">×</button>
        </div>
        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left */}
          <div className="flex-1 overflow-y-auto px-6 py-5 border-r">
            {/* Template name heading */}
            <p className="font-semibold text-base text-zinc-800 dark:text-zinc-100 mb-4">{templateName}</p>
            {/* Period radios */}
            <div className="grid gap-x-2 gap-y-2.5 mb-5" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
              {ADD_METRIC_PERIODS.map((p) => (
                <label key={p} className="inline-flex items-center gap-1.5 cursor-pointer text-sm text-zinc-600 dark:text-zinc-300">
                  <input type="radio" name="metricPeriod" value={p} checked={period === p}
                    onChange={() => onPeriodChange(p)} className="accent-red-500 h-3.5 w-3.5 flex-shrink-0" />
                  {p}
                </label>
              ))}
            </div>
            {/* Metric checkboxes in 3 columns */}
            <div className="grid gap-x-6 gap-y-3" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              {ADD_METRIC_GROUPS.map((col, ci) =>
                col.map((metric) => {
                  const checked = items.some((x) => x.period === period && x.metric === metric)
                  return (
                    <label key={`${ci}-${metric}`} className="inline-flex items-center gap-2 cursor-pointer text-sm text-zinc-600 dark:text-zinc-300 hover:text-foreground">
                      <input type="checkbox" checked={checked} onChange={() => toggleMetric(metric)}
                        className="accent-red-500 h-3.5 w-3.5 flex-shrink-0 rounded" />
                      {metric}
                    </label>
                  )
                })
              )}
            </div>
          </div>
          {/* Right */}
          <div className="w-56 flex-shrink-0 flex flex-col px-4 py-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-zinc-500">已选指标({items.length})</span>
              <button onClick={() => onItemsChange([])} className="text-xs text-blue-500 hover:text-blue-600 transition-colors">清空</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {items.map((item, idx) => (
                <div
                  key={`${item.period}-${item.metric}-${idx}`}
                  draggable
                  onDragStart={() => onDragIdxChange(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx === null || dragIdx === idx) return
                    const arr = [...items]
                    const [moved] = arr.splice(dragIdx, 1)
                    arr.splice(idx, 0, moved)
                    onItemsChange(arr)
                    onDragIdxChange(null)
                  }}
                  onDragEnd={() => onDragIdxChange(null)}
                  className={[
                    "flex items-center justify-between gap-1 px-2 py-1.5 rounded text-xs border cursor-grab select-none transition-colors",
                    dragIdx === idx ? "opacity-40 bg-muted border-border" : "bg-background border-border hover:bg-muted/60",
                  ].join(" ")}
                >
                  <span className="truncate text-zinc-700 dark:text-zinc-200">
                    {item.period}{item.metric}
                  </span>
                  <button onClick={() => onItemsChange(items.filter((_, i) => i !== idx))}
                    className="flex-shrink-0 text-zinc-400 hover:text-red-500 transition-colors leading-none ml-1">×</button>
                </div>
              ))}
            </div>
            {items.length === 0 && <p className="mt-auto text-[10px] text-muted-foreground text-center pt-4">已选列表可拖拉上下排序</p>}
            {items.length > 0 && <p className="mt-2 text-[10px] text-muted-foreground text-center">已选列表可拖拉上下排序</p>}
          </div>
        </div>
        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t flex-shrink-0">
          <button
            onClick={onConfirm}
            className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">
            确 定
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Placeholder panels ───────────────────────────────────────────────────────
function PlaceholderPanel({ title }: { title: string }) {
  return (
    <div className="text-sm text-muted-foreground py-12 text-center border border-dashed rounded-lg">
      {title} 功能暂未开放
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get("tab") === "metric-templates" ? "指标模板" : "计算设置") as Tab
  const sectionParam = searchParams.get("section") || ""
  const categoryParam = searchParams.get("category") || "fund"
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [activeLeft, setActiveLeft] = useState(
    SECTION_FROM_PARAM[sectionParam] ?? "个人配置"
  )

  useEffect(() => {
    if (searchParams.get("tab") === "metric-templates") setActiveTab("指标模板")
    const section = searchParams.get("section") || ""
    if (SECTION_FROM_PARAM[section]) setActiveLeft(SECTION_FROM_PARAM[section])
  }, [searchParams])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left sidebar */}
      <aside className="w-44 flex-shrink-0 border-r border-border pt-6 pb-4 flex flex-col gap-0 bg-background">
        <div className="px-5 pb-4 flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-500">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>
          </div>
          <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">用户设置</span>
        </div>
        {LEFT_NAV.map((section) => (
          <div key={section.group} className="mt-3">
            <p className="px-5 pb-1 text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wide">{section.group}</p>
            {section.items.map((item) => (
              <button
                key={item}
                onClick={() => setActiveLeft(item)}
                className={[
                  "w-full text-left px-5 py-2 text-sm transition-colors",
                  activeLeft === item
                    ? "text-red-500 font-medium border-r-2 border-red-500 bg-red-50/60 dark:bg-red-950/20"
                    : "text-zinc-600 dark:text-zinc-400 hover:bg-muted/60",
                ].join(" ")}
              >
                {item}
              </button>
            ))}
          </div>
        ))}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {/* Only 个人配置 shows the tabbed content; others show placeholder */}
        {activeLeft === "个人标签" ? (
          <div className="p-8">
            <PersonalTagsPanel initialCategory={categoryParam} />
          </div>
        ) : activeLeft !== "个人配置" ? (
          <div className="p-8">
            <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200 mb-6">{activeLeft}</h2>
            <PlaceholderPanel title={activeLeft} />
          </div>
        ) : (
          <>
            {/* Tab bar */}
            <div className="border-b border-border px-8 pt-5">
              <div className="flex gap-0">
                {TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={[
                      "px-4 pb-3 text-sm font-medium border-b-2 transition-colors",
                      activeTab === tab
                        ? "border-red-500 text-red-500"
                        : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200",
                    ].join(" ")}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Notice banner */}
            <div className="mx-8 mt-5 px-4 py-2.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
              设置的超额、年化的计算方式和无风险收益、周频净值过滤规则等个性化选项，仅用于所有基金分析、基金对比、组合分析等详情页，不适用基金列表指标。平台默认无风险收益2%，超额计算默认除法，年化默认为复利，默认展示月末未交易日净值。
            </div>

            {/* Tab content */}
            <div className="px-8 py-6">
              {activeTab === "计算设置" && <CalcSettingsPanel />}
              {activeTab === "指标模板" && <MetricTemplatesPanel />}
              {activeTab === "对比分析模板" && <PlaceholderPanel title="对比分析模板" />}
              {activeTab === "常用基准" && <PlaceholderPanel title="常用基准" />}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
