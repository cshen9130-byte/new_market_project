"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { authService, type PagePermissions, type User } from "@/lib/auth"
import { buildPermissionsSnapshot } from "@/lib/page-permissions"
import {
  getOfficialProcessNodes,
  readInstructionProcessConfig,
  updateInstructionProcessTypeConfig,
  type InstructionProcessConfig,
} from "@/lib/ma/instruction-process-config"
import {
  INSTRUCTION_ROLES,
  INSTRUCTION_TYPE_OPTIONS,
  type InstructionRoleKey,
  type InstructionTypeOption,
} from "@/lib/ma/instruction-roles"

// ─── localStorage keys ───────────────────────────────────────────────────────
const METRIC_TEMPLATES_KEY = "tracking_metric_templates"
const CALC_SETTINGS_KEY    = "tracking_calc_settings"
const COMPARE_TEMPLATES_KEY = "tracking_compare_templates"
const COMMON_BENCHMARKS_KEY = "tracking_common_benchmarks"

interface MetricItem { period: string; metric: string }
interface MetricTemplate { name: string; items: MetricItem[] }
interface CompareTemplate { name: string; indicators: string[] }
interface CommonBenchmark { type: string; name: string }

const BENCHMARK_TYPE_OPTIONS = ["指数", "私募指数", "自定义"]
const BENCHMARK_NAME_OPTIONS = ["沪深300", "中证500", "上证指数", "创业板指", "中证1000", "南华商品指数"]

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
  weeklyNav:    "周频计算只用月末最后交易日净值",
  watermark:    false,
}

const LEFT_NAV = [
  { group: "个人中心", items: ["用户中心", "个人积分", "个人标签", "个人配置", "邀请注册", "登录设置"] },
  { group: "团队管理", items: ["评分设置", "指令设置", "报告设置"] },
]

const SECTION_FROM_PARAM: Record<string, string> = {
  "personal-tags": "个人标签",
  "user-center": "用户中心",
  "instruction-settings": "指令设置",
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

  useEffect(() => {
    const next = PERSONAL_TAG_CATEGORIES.find((c) => c.param === initialCategory)?.key
    if (next) setTagCategory(next)
  }, [initialCategory])

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
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-zinc-500">分类：</span>
          {PERSONAL_TAG_CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setTagCategory(c.key)}
              className={[
                "px-1 py-0.5 text-sm transition-colors",
                tagCategory === c.key
                  ? "text-red-500 font-medium"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-foreground",
              ].join(" ")}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => { setNewTagName(""); setShowNewModal(true) }}
          className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded transition-colors"
        >
          新建标签
        </button>
      </div>

      <div className="overflow-auto rounded border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/40 border-b">
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-16">序号</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">标签名称</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">最近修改</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-24">操作</th>
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
                <td className="px-4 py-3">{tag.name}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{fmtTagDateTime(tag.updated_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      title="编辑"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => { setEditingTag(tag); setEditTagName(tag.name) }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M11 9H8a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"/><path d="M15.5 5.5a2 2 0 0 1 3 3L12 15l-4 1 1-4 6.5-6.5z"/></svg>
                    </button>
                    <button
                      type="button"
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
          {row("超额计算", settings.excessCalc)}
          {row("年化计算", settings.annualCalc)}
          {row("周频净值", settings.weeklyNav)}
          <div className="flex items-center gap-1 text-sm text-zinc-700 dark:text-zinc-300 py-1.5">
            <span className="text-zinc-500 dark:text-zinc-400 w-28 shrink-0">图表水印：</span>
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
              options={["周频计算只用月末最后交易日净值", "展示最新净值"]} />
          </Field>
          <Field label="图表水印">
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

function EmptyTableState({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-16 text-center">
        <div className="flex flex-col items-center gap-2 text-zinc-400">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3H10l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
          <span className="text-sm">暂无数据</span>
        </div>
      </td>
    </tr>
  )
}

function TemplatePagination({ total, page, pageSize, onPageChange }: { total: number; page: number; pageSize: number; onPageChange: (p: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex items-center justify-end gap-2 mt-3 text-xs text-zinc-500">
      <span>共 {total} 条</span>
      <button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="w-6 h-6 rounded border border-border flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        ‹
      </button>
      <span className="w-6 h-6 rounded border border-red-300 bg-red-50 text-red-500 flex items-center justify-center font-medium">{page}</span>
      <button
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="w-6 h-6 rounded border border-border flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        ›
      </button>
    </div>
  )
}

function TableActionIcons({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 text-zinc-400">
      <button title="编辑" onClick={onEdit} className="hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button title="删除" onClick={onDelete} className="hover:text-red-500 transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>
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

  const pageRows = templates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-end mb-4">
        <button
          onClick={openNew}
          className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">
          新增模板
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
              <EmptyTableState colSpan={3} />
            ) : pageRows.map((t, i) => {
              const globalIdx = (page - 1) * PAGE_SIZE + i
              return (
                <tr key={globalIdx} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-zinc-500 text-xs">{globalIdx + 1}</td>
                  <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{t.name}</td>
                  <td className="px-4 py-3">
                    <TableActionIcons onEdit={() => openEdit(globalIdx)} onDelete={() => deleteTemplate(globalIdx)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <TemplatePagination total={templates.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />

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

// ─── CompareAnalysisTemplatesPanel ────────────────────────────────────────────
function CompareAnalysisTemplatesPanel() {
  const [templates, setTemplates] = useState<CompareTemplate[]>(() => readLS<CompareTemplate[]>(COMPARE_TEMPLATES_KEY, []))
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10
  const [showNewModal, setShowNewModal] = useState(false)
  const [newName, setNewName] = useState("")
  const [newNameTouched, setNewNameTouched] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [editName, setEditName] = useState("")
  const [editIndicators, setEditIndicators] = useState<string[]>([])

  const allIndicators = ADD_METRIC_GROUPS.flat()

  function persist(updated: CompareTemplate[]) {
    setTemplates(updated)
    localStorage.setItem(COMPARE_TEMPLATES_KEY, JSON.stringify(updated))
  }

  function saveNew() {
    setNewNameTouched(true)
    if (!newName.trim()) return
    persist([...templates, { name: newName.trim(), indicators: [] }])
    setShowNewModal(false)
    setNewName("")
    setNewNameTouched(false)
  }

  function openEdit(i: number) {
    const t = templates[i]
    setEditIdx(i)
    setEditName(t.name)
    setEditIndicators([...t.indicators])
  }

  function saveEdit() {
    if (editIdx === null || !editName.trim()) return
    persist(templates.map((t, i) => i === editIdx ? { name: editName.trim(), indicators: editIndicators } : t))
    setEditIdx(null)
  }

  function deleteTemplate(i: number) {
    persist(templates.filter((_, idx) => idx !== i))
    const newTotal = templates.length - 1
    const maxPage = Math.max(1, Math.ceil(newTotal / PAGE_SIZE))
    if (page > maxPage) setPage(maxPage)
  }

  const pageRows = templates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-end mb-4">
        <button
          onClick={() => { setNewName(""); setNewNameTouched(false); setShowNewModal(true) }}
          className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">
          + 新增模板
        </button>
      </div>

      <div className="flex-1 border border-border rounded overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/60 border-b border-border">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-16">序号</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-48">模板名称</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">分析指标</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyTableState colSpan={4} />
            ) : pageRows.map((t, i) => {
              const globalIdx = (page - 1) * PAGE_SIZE + i
              return (
                <tr key={globalIdx} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-zinc-500 text-xs">{globalIdx + 1}</td>
                  <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{t.name}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{t.indicators.length ? t.indicators.join("、") : "—"}</td>
                  <td className="px-4 py-3">
                    <TableActionIcons onEdit={() => openEdit(globalIdx)} onDelete={() => deleteTemplate(globalIdx)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <TemplatePagination total={templates.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewModal(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <span className="font-semibold text-base">新增模板</span>
              <button onClick={() => setShowNewModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none transition-colors">×</button>
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
                    onKeyDown={(e) => { if (e.key === "Enter") saveNew() }}
                    placeholder="如：对比分析模板"
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
              <button onClick={() => setShowNewModal(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button onClick={saveNew} className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">确 定</button>
            </div>
          </div>
        </div>
      )}

      {editIdx !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditIdx(null)}>
          <div className="bg-background rounded-lg shadow-xl flex flex-col" style={{ width: 720, maxHeight: "80vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <span className="font-semibold text-base">编辑模板</span>
              <button onClick={() => setEditIdx(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none transition-colors">×</button>
            </div>
            <div className="px-6 py-5 overflow-y-auto">
              <div className="flex items-center gap-3 mb-5">
                <span className="text-sm text-zinc-500 shrink-0">模板名称：</span>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 rounded border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring bg-background"
                />
              </div>
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-3">分析指标</p>
              <div className="grid gap-x-6 gap-y-2.5" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                {allIndicators.map((metric) => {
                  const checked = editIndicators.includes(metric)
                  return (
                    <label key={metric} className="inline-flex items-center gap-2 cursor-pointer text-sm text-zinc-600 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setEditIndicators(checked
                            ? editIndicators.filter((m) => m !== metric)
                            : [...editIndicators, metric])
                        }}
                        className="accent-red-500 h-3.5 w-3.5 flex-shrink-0 rounded"
                      />
                      {metric}
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t">
              <button onClick={() => setEditIdx(null)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button onClick={saveEdit} className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">确 定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CommonBenchmarksPanel ────────────────────────────────────────────────────
function CommonBenchmarksPanel() {
  const [benchmarks, setBenchmarks] = useState<CommonBenchmark[]>(() => readLS<CommonBenchmark[]>(COMMON_BENCHMARKS_KEY, []))
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [draftType, setDraftType] = useState(BENCHMARK_TYPE_OPTIONS[0])
  const [draftName, setDraftName] = useState(BENCHMARK_NAME_OPTIONS[0])

  function persist(updated: CommonBenchmark[]) {
    setBenchmarks(updated)
    localStorage.setItem(COMMON_BENCHMARKS_KEY, JSON.stringify(updated))
  }

  function openAdd() {
    setEditIdx(null)
    setDraftType(BENCHMARK_TYPE_OPTIONS[0])
    setDraftName(BENCHMARK_NAME_OPTIONS[0])
    setShowAddModal(true)
  }

  function openEdit(i: number) {
    const b = benchmarks[i]
    setEditIdx(i)
    setDraftType(b.type)
    setDraftName(b.name)
    setShowAddModal(true)
  }

  function saveBenchmark() {
    if (!draftName.trim()) return
    const entry = { type: draftType, name: draftName.trim() }
    if (editIdx === null) {
      persist([...benchmarks, entry])
    } else {
      persist(benchmarks.map((b, i) => i === editIdx ? entry : b))
    }
    setShowAddModal(false)
    setEditIdx(null)
  }

  function deleteBenchmark(i: number) {
    persist(benchmarks.filter((_, idx) => idx !== i))
  }

  function moveRow(from: number, to: number) {
    if (from === to) return
    const arr = [...benchmarks]
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    persist(arr)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">说明：可拖动排序。</span>
        <button
          onClick={openAdd}
          className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">
          添加基准
        </button>
      </div>

      <div className="flex-1 border border-border rounded overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800/60 border-b border-border">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-16">序号</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-32">类型</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">名称</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400 w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.length === 0 ? (
              <EmptyTableState colSpan={4} />
            ) : benchmarks.map((b, i) => (
              <tr
                key={`${b.type}-${b.name}-${i}`}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragIdx !== null) moveRow(dragIdx, i); setDragIdx(null) }}
                onDragEnd={() => setDragIdx(null)}
                className={[
                  "border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-grab",
                  dragIdx === i ? "opacity-50" : "",
                ].join(" ")}
              >
                <td className="px-4 py-3 text-zinc-500 text-xs">{i + 1}</td>
                <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{b.type}</td>
                <td className="px-4 py-3 font-medium text-zinc-700 dark:text-zinc-200">{b.name}</td>
                <td className="px-4 py-3">
                  <TableActionIcons onEdit={() => openEdit(i)} onDelete={() => deleteBenchmark(i)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddModal(false)}>
          <div className="bg-background rounded-lg shadow-xl w-[420px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <span className="font-semibold text-base">{editIdx === null ? "添加基准" : "编辑基准"}</span>
              <button onClick={() => setShowAddModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none transition-colors">×</button>
            </div>
            <div className="px-6 py-6 space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-500 shrink-0 w-12">类型：</span>
                <select
                  value={draftType}
                  onChange={(e) => setDraftType(e.target.value)}
                  className="flex-1 rounded border border-border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {BENCHMARK_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-zinc-500 shrink-0 w-12">名称：</span>
                {draftType === "指数" ? (
                  <select
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="flex-1 rounded border border-border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {BENCHMARK_NAME_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                ) : (
                  <input
                    autoFocus
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="flex-1 rounded border border-border px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-3 border-t">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取 消</button>
              <button onClick={saveBenchmark} className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">确 定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── UserCenterPanel ──────────────────────────────────────────────────────────
function outlineBtn(label: string, onClick?: () => void) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 px-3 py-1 border border-red-500 text-red-500 rounded text-sm hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
    >
      {label}
    </button>
  )
}

function UserCenterPanel() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<"name" | "password" | "phone" | "wechat" | "email" | null>(null)
  const [draftName, setDraftName] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [draftEmail, setDraftEmail] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const current = await authService.refreshCurrentUser()
      if (!cancelled) {
        setUser(current)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  function closeModal() {
    setModal(null)
    setError(null)
    setDraftName("")
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
    setDraftEmail("")
  }

  async function saveName() {
    if (!draftName.trim()) {
      setError("请输入用户名")
      return
    }
    setSaving(true)
    setError(null)
    const res = await authService.updateProfile({ name: draftName.trim() })
    setSaving(false)
    if (!res.success) {
      setError(res.error || "保存失败")
      return
    }
    setUser(res.user ?? user)
    closeModal()
  }

  async function savePassword() {
    if (!currentPassword) {
      setError("请输入当前密码")
      return
    }
    if (!newPassword || newPassword.length < 6) {
      setError("新密码至少 6 位")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致")
      return
    }
    setSaving(true)
    setError(null)
    const res = await authService.updateProfile({ password: newPassword, currentPassword })
    setSaving(false)
    if (!res.success) {
      setError(res.error || "保存失败")
      return
    }
    setUser(res.user ?? user)
    closeModal()
  }

  async function saveEmail() {
    if (!draftEmail.trim()) {
      setError("请输入邮箱")
      return
    }
    setError("邮箱绑定功能暂未开放")
  }

  const infoRow = (label: string, value: React.ReactNode, action?: React.ReactNode) => (
    <div className="flex items-center py-3 border-b border-border/60 last:border-b-0">
      <span className="text-sm text-zinc-500 dark:text-zinc-400 w-24 shrink-0">{label}</span>
      <span className="flex-1 text-sm text-zinc-800 dark:text-zinc-200">{value}</span>
      {action && <div className="ml-4">{action}</div>}
    </div>
  )

  const sectionTitle = (icon: React.ReactNode, title: string) => (
    <div className="flex items-center gap-2 pb-3 mb-1 border-b border-border">
      {icon}
      <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{title}</span>
    </div>
  )

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">加载中…</div>
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200 mb-6">用户中心</h2>

      <div className="space-y-8">
        <section>
          {sectionTitle(
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>,
            "用户信息",
          )}
          <div className="pl-1">
            {infoRow("用户名", user?.name || "—", outlineBtn("修改用户名", () => { setDraftName(user?.name || ""); setModal("name") }))}
            {infoRow("公司信息", "—")}
            {infoRow("到期时间", "—")}
            {infoRow("密码", "已设置", outlineBtn("修改密码", () => setModal("password")))}
            {infoRow("手机绑定", "未绑定", outlineBtn("修改手机号", () => setModal("phone")))}
          </div>
        </section>

        <section>
          {sectionTitle(
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-500"><path d="M9 12a4 4 0 1 0 4-4"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2Z"/><path d="M16 8h.01"/></svg>,
            "微信绑定",
          )}
          <div className="flex items-center py-3">
            <span className="text-sm text-zinc-500 dark:text-zinc-400 w-24 shrink-0">绑定状态</span>
            <span className="flex-1 text-sm text-zinc-600 dark:text-zinc-300">
              未绑定，绑定后可使用微信登录，接收推送信息
            </span>
            {outlineBtn("绑定", () => setModal("wechat"))}
          </div>
        </section>

        <section>
          {sectionTitle(
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>,
            "邮箱绑定",
          )}
          <div className="flex items-center py-3">
            <span className="text-sm text-zinc-500 dark:text-zinc-400 w-24 shrink-0">绑定状态</span>
            <span className="flex-1 text-sm text-zinc-600 dark:text-zinc-300">
              未绑定，绑定后可用于接收报警信息
            </span>
            {outlineBtn("绑定邮箱", () => { setDraftEmail(user?.email || ""); setModal("email") })}
          </div>
        </section>
      </div>

      {modal === "name" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeModal}>
          <div className="bg-background border rounded-lg shadow-xl w-[400px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="font-semibold text-base">修改用户名</span>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <label className="text-sm shrink-0">用户名：</label>
              <input
                autoFocus
                className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !saving && saveName()}
              />
            </div>
            {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={closeModal} className="px-4 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
              <button onClick={saveName} disabled={saving} className="px-4 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                {saving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === "password" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeModal}>
          <div className="bg-background border rounded-lg shadow-xl w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="font-semibold text-base">修改密码</span>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-3">
                <label className="text-sm shrink-0 w-20">当前密码</label>
                <input type="password" className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm shrink-0 w-20">新密码</label>
                <input type="password" className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm shrink-0 w-20">确认密码</label>
                <input type="password" className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
            </div>
            {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={closeModal} className="px-4 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
              <button onClick={savePassword} disabled={saving} className="px-4 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                {saving ? "保存中…" : "确 定"}
              </button>
            </div>
          </div>
        </div>
      )}

      {(modal === "phone" || modal === "wechat" || modal === "email") && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeModal}>
          <div className="bg-background border rounded-lg shadow-xl w-[400px] p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <span className="font-semibold text-base">
                {modal === "phone" ? "修改手机号" : modal === "wechat" ? "微信绑定" : "绑定邮箱"}
              </span>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            {modal === "email" ? (
              <div className="flex items-center gap-3 mb-4">
                <label className="text-sm shrink-0">邮箱：</label>
                <input
                  autoFocus
                  type="email"
                  className="flex-1 border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring bg-background"
                  value={draftEmail}
                  onChange={(e) => setDraftEmail(e.target.value)}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mb-4">该功能暂未开放，敬请期待。</p>
            )}
            {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={closeModal} className="px-4 py-1.5 border rounded text-sm hover:bg-muted transition-colors">取 消</button>
              {modal === "email" && (
                <button onClick={saveEmail} disabled={saving} className="px-4 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors disabled:opacity-40">
                  {saving ? "保存中…" : "确 定"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── PersonalPointsPanel ──────────────────────────────────────────────────────
interface PointRecord {
  id: number
  date: string
  item: string
  points: number
}

function PersonalPointsPanel() {
  const [records] = useState<PointRecord[]>([])
  const totalPoints = records.reduce((sum, r) => sum + r.points, 0)

  return (
    <div>
      <div className="flex items-center gap-4 mb-8 px-4 py-5 rounded-lg border border-border/60 bg-muted/20">
        <div className="shrink-0 w-16 h-16 flex items-center justify-center text-red-400/80">
          <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 64 64" fill="none">
            <rect x="8" y="12" width="48" height="32" rx="3" stroke="currentColor" strokeWidth="1.5"/>
            <rect x="12" y="16" width="40" height="22" rx="1" fill="currentColor" opacity="0.08"/>
            <rect x="14" y="19" width="14" height="3" rx="1" fill="currentColor" opacity="0.25"/>
            <rect x="14" y="25" width="20" height="2" rx="1" fill="currentColor" opacity="0.15"/>
            <rect x="14" y="30" width="16" height="2" rx="1" fill="currentColor" opacity="0.15"/>
            <path d="M22 44h20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M32 44v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M24 50h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
        <p className="text-sm text-zinc-700 dark:text-zinc-200">
          当前个人账户积分：
          <span className="text-red-500 font-semibold tabular-nums">{totalPoints}</span>
        </p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-sm bg-blue-500 shrink-0" />
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">积分明细</span>
      </div>

      <div className="overflow-auto rounded border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/40 border-b">
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-16">序号</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-36">日期</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">变动事项</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-24">积分</th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : records.map((row, i) => (
              <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 text-muted-foreground tabular-nums">{i + 1}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{row.date}</td>
                <td className="px-4 py-3">{row.item}</td>
                <td className="px-4 py-3 tabular-nums">{row.points > 0 ? `+${row.points}` : row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── InviteRegistrationPanel ──────────────────────────────────────────────────
function InviteRegistrationPanel() {
  const [tab, setTab] = useState<"link" | "users">("link")
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const posterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const current = await authService.refreshCurrentUser()
      if (!cancelled) {
        setUser(current)
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const inviteUrl = user && typeof window !== "undefined"
    ? `${window.location.origin}/login?uid=${encodeURIComponent(user.id)}`
    : ""

  const qrSrc = inviteUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(inviteUrl)}`
    : ""

  async function copyLink() {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt("复制链接", inviteUrl)
    }
  }

  async function downloadPoster() {
    if (!posterRef.current) return
    setDownloading(true)
    try {
      const { default: html2canvas } = await import("html2canvas")
      const canvas = await html2canvas(posterRef.current, { scale: 2, backgroundColor: null })
      const link = document.createElement("a")
      link.download = "推广海报.png"
      link.href = canvas.toDataURL("image/png")
      link.click()
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">加载中…</div>
  }

  return (
    <div>
      <div className="border-b border-border mb-6">
        <div className="flex gap-6">
          {([
            ["link", "邀请链接"],
            ["users", "已邀用户"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={[
                "pb-3 text-sm font-medium border-b-2 transition-colors",
                tab === key
                  ? "border-red-500 text-red-500"
                  : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "link" ? (
        <div className="flex flex-col items-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-6">发送链接给好友，邀请注册。</p>

          <div className="w-full max-w-2xl flex items-center border border-border rounded overflow-hidden bg-background mb-10">
            <div className="px-3 text-red-500 shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </div>
            <input
              readOnly
              value={inviteUrl}
              className="flex-1 px-2 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 bg-transparent outline-none"
            />
            <button
              type="button"
              onClick={copyLink}
              className="shrink-0 px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
            >
              {copied ? "已复制" : "复制链接"}
            </button>
          </div>

          <div
            ref={posterRef}
            className="w-[280px] rounded-2xl overflow-hidden shadow-lg mb-6"
            style={{ background: "linear-gradient(180deg, #ffb347 0%, #ffcc33 45%, #fff4dc 100%)" }}
          >
            <div className="px-6 pt-6 pb-5 text-center">
              <div className="flex items-center justify-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold">AI</div>
                <span className="text-lg font-bold text-red-600">母基金AI投研</span>
              </div>
              <p className="text-2xl font-bold text-zinc-800 leading-tight mb-4">
                邀请好友<br />立即注册
              </p>
              <div className="mx-auto mb-4 w-40 h-28 relative">
                <svg viewBox="0 0 160 112" className="w-full h-full" aria-hidden="true">
                  <rect x="20" y="18" width="72" height="52" rx="4" fill="#fff" opacity="0.9"/>
                  <rect x="26" y="24" width="60" height="34" rx="2" fill="#fde68a"/>
                  <path d="M30 48h52" stroke="#f97316" strokeWidth="2"/>
                  <path d="M30 54h36" stroke="#fdba74" strokeWidth="2"/>
                  <rect x="98" y="34" width="28" height="48" rx="6" fill="#fff" opacity="0.95"/>
                  <rect x="102" y="40" width="20" height="32" rx="2" fill="#fef3c7"/>
                  <circle cx="48" cy="82" r="14" fill="#ef4444"/>
                  <circle cx="48" cy="78" r="6" fill="#fff"/>
                </svg>
              </div>
              <div className="inline-block px-5 py-1.5 rounded-full bg-sky-100 text-sky-700 text-sm font-medium mb-2">
                {user?.name || "用户"}
              </div>
              <p className="text-xs text-zinc-600 mb-4">邀请你注册母基金AI投研系统</p>
              {qrSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrSrc} alt="邀请二维码" width={120} height={120} className="mx-auto rounded bg-white p-1" />
              ) : (
                <div className="mx-auto w-[120px] h-[120px] bg-white rounded" />
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={downloadPoster}
            disabled={downloading}
            className="px-6 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {downloading ? "生成中…" : "下载推广海报"}
          </button>
        </div>
      ) : (
        <div className="overflow-auto rounded border">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/40 border-b">
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-16">序号</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500">用户名</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-44">注册时间</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-500 w-24">状态</th>
              </tr>
            </thead>
            <tbody>
              <EmptyTableState colSpan={4} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── InstructionSettingsPanel ─────────────────────────────────────────────────
const INSTRUCTION_USER_ORDER = [
  "benc",
  "chy",
  "chenpeifeng",
  "sunjie",
  "liuyamin",
  "g.wave",
  "sunzhou",
  "luoshuang",
  "hcx",
  "yuki",
  "zzh",
  "cshen",
] as const

function instructionUserSortKey(u: User): string {
  return (u.name || "").trim().toLowerCase()
}

function isCshenAccount(u: User): boolean {
  const key = instructionUserSortKey(u)
  const email = (u.email || "").trim().toLowerCase()
  return key === "cshen" || email.startsWith("cshen@")
}

function instructionUserOrderIndex(u: User): number {
  const key = instructionUserSortKey(u)
  const idx = INSTRUCTION_USER_ORDER.indexOf(key as (typeof INSTRUCTION_USER_ORDER)[number])
  if (idx >= 0) return idx
  // Match email local-part for accounts whose display name differs slightly.
  const local = (u.email || "").trim().toLowerCase().split("@")[0] || ""
  const emailIdx = INSTRUCTION_USER_ORDER.indexOf(local as (typeof INSTRUCTION_USER_ORDER)[number])
  // Unknown accounts sit after the named list, still above cshen.
  return emailIdx >= 0 ? emailIdx : INSTRUCTION_USER_ORDER.length
}

function sortInstructionUsers(list: User[], currentUserId: string | undefined): User[] {
  return [...list].sort((a, b) => {
    const aCshen = isCshenAccount(a)
    const bCshen = isCshenAccount(b)
    // cshen always last
    if (aCshen !== bCshen) return aCshen ? 1 : -1

    const aCurrent = !aCshen && !!currentUserId && a.id === currentUserId
    const bCurrent = !bCshen && !!currentUserId && b.id === currentUserId
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1

    const orderDiff = instructionUserOrderIndex(a) - instructionUserOrderIndex(b)
    if (orderDiff !== 0) return orderDiff
    return instructionUserSortKey(a).localeCompare(instructionUserSortKey(b))
  })
}

function InstructionSettingsPanel() {
  const [instructionType, setInstructionType] = useState<InstructionTypeOption>(INSTRUCTION_TYPE_OPTIONS[0])
  const [processType, setProcessType] = useState<"official" | "custom">("official")
  const [processConfig, setProcessConfig] = useState<InstructionProcessConfig>(() =>
    readInstructionProcessConfig(),
  )
  const [processSaveMsg, setProcessSaveMsg] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [roleDraft, setRoleDraft] = useState<Record<string, InstructionRoleKey | "">>({})
  const [nameDraft, setNameDraft] = useState<Record<string, string>>({})
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    setProcessConfig(readInstructionProcessConfig())
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const current = await authService.refreshCurrentUser()
      if (cancelled) return
      const admin = current?.role === "admin"
      setIsAdmin(!!admin)
      if (!admin) return
      setLoadingUsers(true)
      setLoadError(null)
      try {
        const list = await authService.listUsers()
        if (cancelled) return
        const sorted = sortInstructionUsers(list, current?.id)
        setUsers(sorted)
        const nextRoleDraft: Record<string, InstructionRoleKey | ""> = {}
        const nextNameDraft: Record<string, string> = {}
        for (const u of sorted) {
          const role = u.permissions?.instructionRole
          nextRoleDraft[u.id] =
            role === "fund_manager" || role === "general_manager" || role === "ops" ? role : ""
          nextNameDraft[u.id] = u.permissions?.instructionRoleName || ""
        }
        setRoleDraft(nextRoleDraft)
        setNameDraft(nextNameDraft)
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || "加载用户失败")
      } finally {
        if (!cancelled) setLoadingUsers(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  async function saveRole(userId: string) {
    const target = users.find((u) => u.id === userId)
    if (!target) return
    setSavingId(userId)
    setSaveMsg((m) => ({ ...m, [userId]: "" }))
    const nextRole = roleDraft[userId] || ""
    const nextName = (nameDraft[userId] || "").trim()
    const permissions: PagePermissions = {
      ...buildPermissionsSnapshot(target.permissions),
      instructionRole: nextRole,
      instructionRoleName: nextName,
    }
    const res = await authService.updatePermissions(userId, permissions)
    setSavingId(null)
    if (res.success) {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, permissions } : u)),
      )
      setNameDraft((prev) => ({ ...prev, [userId]: nextName }))
      setSaveMsg((m) => ({ ...m, [userId]: "已保存" }))
    } else {
      setSaveMsg((m) => ({ ...m, [userId]: res.error || "保存失败" }))
    }
  }

  function setRequireGmApproval(checked: boolean) {
    const next = updateInstructionProcessTypeConfig(instructionType, {
      requireGmApproval: checked,
    })
    setProcessConfig(next)
    setProcessSaveMsg("已保存")
    window.setTimeout(() => setProcessSaveMsg(null), 2000)
  }

  const requireGmApproval = processConfig[instructionType]?.requireGmApproval !== false
  const processNodes = getOfficialProcessNodes(instructionType, processConfig)

  return (
    <div>
      <h2 className="text-base font-semibold text-zinc-700 dark:text-zinc-200 mb-6">审批节点配置</h2>

      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex items-center gap-2 shrink-0 pt-2">
            <span className="inline-block w-1 h-4 rounded-sm bg-red-500" />
            <span className="text-sm text-zinc-700 dark:text-zinc-200">指令类型:</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {INSTRUCTION_TYPE_OPTIONS.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setInstructionType(type)}
                className={[
                  "min-w-[120px] px-5 py-2 text-sm border rounded transition-colors",
                  instructionType === type
                    ? "border-red-500 text-red-500 bg-red-50/40 dark:bg-red-950/20"
                    : "border-border text-zinc-700 dark:text-zinc-300 hover:border-zinc-400",
                ].join(" ")}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-6">
          <span className="text-sm text-zinc-700 dark:text-zinc-200 shrink-0">流程类型</span>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="radio"
              name="instruction-process-type"
              checked={processType === "official"}
              onChange={() => setProcessType("official")}
              className="accent-red-500"
            />
            官方
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="radio"
              name="instruction-process-type"
              checked={processType === "custom"}
              onChange={() => setProcessType("custom")}
              className="accent-red-500"
            />
            自定义
          </label>
        </div>

        {processType === "official" ? (
          <div className="rounded-lg border border-border/70 bg-muted/10 px-5 py-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">官方审批节点</p>
              <div className="flex items-center gap-3">
                <label
                  className={[
                    "inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 select-none",
                    isAdmin ? "cursor-pointer" : "cursor-default opacity-80",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    checked={requireGmApproval}
                    disabled={!isAdmin}
                    onChange={(e) => setRequireGmApproval(e.target.checked)}
                    className="accent-red-500 disabled:opacity-60"
                  />
                  需要总经理审批
                </label>
                {processSaveMsg && (
                  <span className="text-xs text-emerald-600">{processSaveMsg}</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {processNodes.map((node, idx) => (
                <div key={`${node}-${idx}`} className="flex items-center gap-2">
                  <span
                    className={[
                      "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm",
                      node === "总经理审批"
                        ? "border-amber-300 bg-amber-50/60 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
                        : "border-border bg-background text-zinc-700 dark:text-zinc-200",
                    ].join(" ")}
                  >
                    <span className="text-xs text-zinc-400 tabular-nums">{String(idx + 1).padStart(2, "0")}</span>
                    {node}
                  </span>
                  {idx < processNodes.length - 1 && (
                    <span className="text-zinc-300 dark:text-zinc-600">→</span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-400">
              关闭「需要总经理审批」后，新发起的该类指令将跳过总经理审批节点
              {instructionType === "入/出池审批" ? "并直接结束" : "，进入产品运维执行"}。
              已发起的指令仍按发起时的流程执行。
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border px-5 py-8 text-center text-sm text-muted-foreground">
            自定义审批流程配置暂未开放
          </div>
        )}

        {isAdmin && (
          <div className="pt-2">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-block w-2 h-2 rounded-sm bg-red-500 shrink-0" />
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">指令角色分配</span>
              <span className="text-xs text-zinc-400">（仅管理员可编辑）</span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
              为每个账户指定指令模块角色与角色姓名；角色姓名将显示在指令流程节点中。
            </p>
            {loadError ? (
              <div className="text-sm text-red-500 py-6">{loadError}</div>
            ) : loadingUsers ? (
              <div className="text-sm text-muted-foreground py-10 text-center">加载中…</div>
            ) : (
              <div className="overflow-auto rounded border w-fit max-w-full">
                <table className="text-sm border-collapse table-fixed w-[640px]">
                  <thead>
                    <tr className="bg-muted/40 border-b">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-14">序号</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-32">用户名</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-36">指令角色</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-40">角色姓名</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-zinc-500 w-28">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <EmptyTableState colSpan={5} />
                    ) : (
                      users.map((u, i) => {
                        const currentRole = u.permissions?.instructionRole || ""
                        const draftRole = roleDraft[u.id] ?? ""
                        const currentName = u.permissions?.instructionRoleName || ""
                        const draftName = nameDraft[u.id] ?? ""
                        const dirty = draftRole !== currentRole || draftName.trim() !== currentName.trim()
                        return (
                          <tr key={u.id} className="border-b hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
                            <td className="px-3 py-2.5 font-medium text-zinc-700 dark:text-zinc-200 truncate" title={u.name}>
                              {u.name}
                            </td>
                            <td className="px-3 py-2.5">
                              <select
                                value={draftRole}
                                onChange={(e) =>
                                  setRoleDraft((prev) => ({
                                    ...prev,
                                    [u.id]: e.target.value as InstructionRoleKey | "",
                                  }))
                                }
                                className="w-full border rounded px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-red-400"
                              >
                                <option value="">未分配</option>
                                {INSTRUCTION_ROLES.map((r) => (
                                  <option key={r.key} value={r.key}>{r.label}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2.5">
                              <input
                                type="text"
                                value={draftName}
                                onChange={(e) =>
                                  setNameDraft((prev) => ({
                                    ...prev,
                                    [u.id]: e.target.value,
                                  }))
                                }
                                placeholder="指令流程显示名"
                                className="w-full border rounded px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-red-400"
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={!dirty || savingId === u.id}
                                  onClick={() => saveRole(u.id)}
                                  className="px-3 py-1 text-xs border border-red-500 text-red-500 rounded hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                  {savingId === u.id ? "保存中…" : "保存"}
                                </button>
                                {saveMsg[u.id] && (
                                  <span className={[
                                    "text-xs",
                                    saveMsg[u.id] === "已保存" ? "text-emerald-600" : "text-red-500",
                                  ].join(" ")}>
                                    {saveMsg[u.id]}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
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
        ) : activeLeft === "用户中心" ? (
          <div className="p-8">
            <UserCenterPanel />
          </div>
        ) : activeLeft === "个人积分" ? (
          <div className="p-8">
            <PersonalPointsPanel />
          </div>
        ) : activeLeft === "邀请注册" ? (
          <div className="p-8">
            <InviteRegistrationPanel />
          </div>
        ) : activeLeft === "指令设置" ? (
          <div className="p-8">
            <InstructionSettingsPanel />
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

            {/* Notice banner — only on 计算设置 */}
            {activeTab === "计算设置" && (
              <div className="mx-8 mt-5 px-4 py-2.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                设置的超额、年化的计算方式和无风险收益、周频净值过滤规则等个性化选项，仅用于所有基金分析、基金对比、组合分析等详情页，不适用基金列表指标。平台默认无风险收益2%，超额计算默认除法，年化默认为复利，默认展示月末未交易日净值。
              </div>
            )}

            {/* Tab content */}
            <div className="px-8 py-6">
              {activeTab === "计算设置" && <CalcSettingsPanel />}
              {activeTab === "指标模板" && <MetricTemplatesPanel />}
              {activeTab === "对比分析模板" && <CompareAnalysisTemplatesPanel />}
              {activeTab === "常用基准" && <CommonBenchmarksPanel />}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
