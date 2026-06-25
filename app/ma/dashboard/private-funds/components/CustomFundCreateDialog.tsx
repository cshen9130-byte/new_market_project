"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ChevronDown, RefreshCw, Settings2 } from "lucide-react"

type ScopeTab = "team" | "mine"
type FormTab = "basic" | "platform" | "team"

interface TrackStrategyNode {
  l1: string
  l2s: { l2: string; l3s: string[] }[]
}

const BENCHMARK_OPTIONS = [
  "沪深300",
  "中证500",
  "上证指数",
  "创业板指",
  "中证1000",
  "南华商品指数",
  "上证50",
  "中证2000",
]

const FORM_TABS: { key: FormTab; label: string }[] = [
  { key: "basic", label: "基本信息" },
  { key: "platform", label: "平台策略" },
  { key: "team", label: "团队策略" },
]

function FieldLabel({ required, children }: { required?: boolean; children: ReactNode }) {
  return (
    <label className="text-sm text-zinc-600 dark:text-zinc-400 shrink-0 w-[5.5rem] text-right pt-2 leading-snug">
      {required && <span className="text-red-500 mr-0.5">*</span>}
      {children}
    </label>
  )
}

function StrategySelect({
  value,
  onChange,
  placeholder,
  options,
  disabled = false,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: string[]
  disabled?: boolean
}) {
  return (
    <div className="relative flex-1">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "w-full h-[38px] appearance-none rounded border border-border bg-background pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring",
          value ? "text-zinc-700 dark:text-zinc-300" : "text-muted-foreground/50",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
    </div>
  )
}

function StrategyTabBody({
  variant,
  tree,
  l1,
  l2,
  l3,
  onL1,
  onL2,
  onL3,
}: {
  variant: "platform" | "team"
  tree: TrackStrategyNode[]
  l1: string
  l2: string
  l3: string
  onL1: (v: string) => void
  onL2: (v: string) => void
  onL3: (v: string) => void
}) {
  const l1Options = tree.map((n) => n.l1)
  const l2Options = l1 ? (tree.find((n) => n.l1 === l1)?.l2s.map((n) => n.l2) ?? []) : []
  const l3Options = l2
    ? (tree.find((n) => n.l1 === l1)?.l2s.find((n) => n.l2 === l2)?.l3s ?? [])
    : []

  const l2Placeholder = !l1
    ? (variant === "team" ? "请先选择一级策略" : "请选择二级策略")
    : l2Options.length === 0
      ? "暂无二级策略"
      : "请选择二级策略"

  const l3Placeholder = !l1
    ? (variant === "team" ? "请先选择一级策略" : "请选择三级策略")
    : !l2
      ? (variant === "team" ? "请先选择一级策略" : "请先选择二级策略")
      : l3Options.length === 0
        ? "暂无三级策略"
        : "请选择三级策略"

  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex items-center gap-3">
        <FieldLabel>一级策略：</FieldLabel>
        <StrategySelect
          value={l1}
          onChange={onL1}
          placeholder="请选择一级策略"
          options={l1Options}
        />
      </div>
      <div className="flex items-center gap-3">
        <FieldLabel>二级策略：</FieldLabel>
        <StrategySelect
          value={l2}
          onChange={onL2}
          placeholder={l2Placeholder}
          options={l2Options}
          disabled={!l1 || l2Options.length === 0}
        />
      </div>
      <div className="flex items-center gap-3">
        <FieldLabel>三级策略：</FieldLabel>
        <StrategySelect
          value={l3}
          onChange={onL3}
          placeholder={l3Placeholder}
          options={l3Options}
          disabled={!l1 || !l2 || l3Options.length === 0}
        />
      </div>
      {variant === "team" && (
        <p className="text-xs text-muted-foreground pt-1">
          团队策略的新增、编辑在【运维-数据维护-团队策略】中。
        </p>
      )}
    </div>
  )
}

export function CustomFundCreateDialog({
  open,
  scope,
  onClose,
}: {
  open: boolean
  scope: ScopeTab
  onClose: () => void
}) {
  const isTeam = scope === "team"
  const [formTab, setFormTab] = useState<FormTab>("basic")
  const [fundName, setFundName] = useState("")
  const [benchmark, setBenchmark] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [teamTagOptions, setTeamTagOptions] = useState<string[]>([])
  const [platformTree, setPlatformTree] = useState<TrackStrategyNode[]>([])
  const [teamTree, setTeamTree] = useState<TrackStrategyNode[]>([])
  const [platformL1, setPlatformL1] = useState("")
  const [platformL2, setPlatformL2] = useState("")
  const [platformL3, setPlatformL3] = useState("")
  const [teamL1, setTeamL1] = useState("")
  const [teamL2, setTeamL2] = useState("")
  const [teamL3, setTeamL3] = useState("")
  const [submitting, setSubmitting] = useState(false)

  function resetForm() {
    setFormTab("basic")
    setFundName("")
    setBenchmark("")
    setSelectedTags([])
    setPlatformL1("")
    setPlatformL2("")
    setPlatformL3("")
    setTeamL1("")
    setTeamL2("")
    setTeamL3("")
  }

  function loadTeamTags() {
    fetch("/ma/api/ops/team-tags?category=fund")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setTeamTagOptions(d.map((t: { name: string }) => t.name)) })
      .catch(() => setTeamTagOptions([]))
  }

  useEffect(() => {
    if (!open) return
    resetForm()
    loadTeamTags()
    fetch("/ma/api/tracking-funds/strategies?strategy_source=platform&pool=all")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setPlatformTree(d) })
      .catch(() => setPlatformTree([]))
    fetch("/ma/api/tracking-funds/strategies?strategy_source=company&pool=all")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setTeamTree(d) })
      .catch(() => setTeamTree([]))
  }, [open])

  function handlePlatformL1(next: string) {
    setPlatformL1(next)
    setPlatformL2("")
    setPlatformL3("")
  }

  function handlePlatformL2(next: string) {
    setPlatformL2(next)
    setPlatformL3("")
  }

  function handleTeamL1(next: string) {
    setTeamL1(next)
    setTeamL2("")
    setTeamL3("")
  }

  function handleTeamL2(next: string) {
    setTeamL2(next)
    setTeamL3("")
  }

  async function handleConfirm() {
    if (!fundName.trim() || !benchmark) return
    setSubmitting(true)
    try {
      // API will be wired when custom-funds storage is ready
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-[640px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">{isTeam ? "新增团队自建" : "新增我的自建"}</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="px-6 pt-4 flex-shrink-0">
          <div className="rounded px-3 py-2.5 text-xs leading-relaxed bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800/50">
            {isTeam
              ? "团队自建，适用于创建实盘或者策略回测的产品并上传净值，数据限本团队可见。"
              : "我的自建，适用于创建个人实盘或者策略回测的产品并上传净值，数据仅本人可见。"}
          </div>
        </div>

        <div className="px-6 pt-4 flex-shrink-0">
          <div className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50/40 p-0.5">
            {FORM_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setFormTab(t.key)}
                className={[
                  "px-4 py-1.5 text-sm rounded-full transition-colors",
                  formTab === t.key
                    ? "bg-background text-red-600 font-medium shadow-sm border border-red-200"
                    : "text-zinc-500 hover:text-foreground",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-5 overflow-y-auto flex-1 min-h-0">
          {formTab === "basic" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <FieldLabel required>基金名称：</FieldLabel>
                <input
                  value={fundName}
                  onChange={(e) => setFundName(e.target.value)}
                  placeholder="请输入基金名称"
                  className="flex-1 border rounded px-3 py-2 text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex items-start gap-3">
                <FieldLabel required>基准指数：</FieldLabel>
                <div className="relative flex-1">
                  <select
                    value={benchmark}
                    onChange={(e) => setBenchmark(e.target.value)}
                    className="w-full h-[38px] appearance-none rounded border border-border bg-background pl-3 pr-8 text-sm text-zinc-600 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">请选择基准对比指数</option>
                    {BENCHMARK_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                </div>
              </div>
              <div className="flex items-start gap-3">
                <FieldLabel>标签：</FieldLabel>
                <div className="flex-1">
                  <div className="flex items-center border rounded px-3 py-1.5 gap-2 flex-wrap min-h-[38px] bg-background">
                    {selectedTags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 bg-red-50 border border-red-300 text-red-500 rounded px-2 py-0.5 text-xs">
                        {t}
                        <button type="button" onClick={() => setSelectedTags((p) => p.filter((x) => x !== t))} className="leading-none hover:text-red-700">×</button>
                      </span>
                    ))}
                    {selectedTags.length === 0 && <span className="text-sm text-muted-foreground/50">请选择标签</span>}
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedTags([])} className="text-sm text-blue-500 hover:text-blue-600 transition-colors shrink-0 pt-2">清空</button>
              </div>
              <div className="flex items-start gap-3">
                <FieldLabel>{isTeam ? "团队标签：" : "个人标签："}</FieldLabel>
                <div className="flex flex-1 flex-wrap items-center gap-1.5 bg-muted/30 rounded px-3 py-2 min-h-[38px]">
                  {teamTagOptions.length === 0 && (
                    <span className="text-sm text-muted-foreground flex-shrink-0">暂无标签，可点击「设置」添加后刷新</span>
                  )}
                  {teamTagOptions.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setSelectedTags((p) => p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag])}
                      className={[
                        "inline-flex items-center px-2.5 py-0.5 rounded border text-xs transition-all",
                        selectedTags.includes(tag)
                          ? "bg-red-50 text-red-500 border-red-300"
                          : "bg-background border-border text-zinc-600 hover:border-red-300 hover:text-red-500",
                      ].join(" ")}
                    >
                      {tag}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => window.open("/ma/dashboard/private-funds?tab=operations&side=ops-strategy-tags&ops=tags", "_blank")}
                    className="inline-flex items-center gap-1 border border-dashed border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors ml-1"
                  >
                    <Settings2 className="h-3 w-3" />
                    设置
                  </button>
                  <button
                    type="button"
                    onClick={loadTeamTags}
                    className="inline-flex items-center gap-1 border border-dashed border-red-400 text-red-500 rounded px-2 py-0.5 text-xs hover:bg-red-50 transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" />
                    刷新
                  </button>
                </div>
              </div>
            </div>
          )}

          {formTab === "platform" && (
            <StrategyTabBody
              variant="platform"
              tree={platformTree}
              l1={platformL1}
              l2={platformL2}
              l3={platformL3}
              onL1={handlePlatformL1}
              onL2={handlePlatformL2}
              onL3={setPlatformL3}
            />
          )}

          {formTab === "team" && (
            <StrategyTabBody
              variant="team"
              tree={teamTree}
              l1={teamL1}
              l2={teamL2}
              l3={teamL3}
              onL1={handleTeamL1}
              onL2={handleTeamL2}
              onL3={setTeamL3}
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取消</button>
          <button
            type="button"
            disabled={submitting || !fundName.trim() || !benchmark}
            onClick={handleConfirm}
            className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "提交中…" : "确定"}
          </button>
        </div>
      </div>
    </div>
  )
}
