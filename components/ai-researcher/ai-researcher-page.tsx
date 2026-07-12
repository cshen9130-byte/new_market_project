"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import {
  FlaskConical,
  GitCompareArrows,
  Lock,
  Play,
  Plus,
  X,
  Search,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Download,
  Copy,
  RefreshCw,
  Clock,
  Trash2,
  BookOpen,
  TrendingUp,
  Users,
  BarChart3,
  Cpu,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { MarkdownNotePreview } from "@/components/markdown-note-preview"

// ── Types ──────────────────────────────────────────────────────────────────────

interface FundSearchResult {
  beian_hao: string
  product_name: string
  manager: string
  strategy_l1: string | null
  strategy_l2: string | null
  inception_date: string | null
  latest_nav: string | null
  ret_1y: string | null
}

interface TaskStep {
  step: number
  title: string
  status: "waiting" | "running" | "done" | "error"
  summary?: string
}

interface ResearchTask {
  id: string
  skillId: string
  skillName: string
  subjects: string[]
  kbPath: string
  status: "running" | "done" | "error"
  startedAt: number
  durationMs?: number
  planText: string
  steps: TaskStep[]
  reportText: string
  errorMessage?: string
}

interface Skill {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  badge?: string
  locked?: boolean
  color: string
  steps: string[]
}

// ── Skills catalog ─────────────────────────────────────────────────────────────

const SKILLS: Skill[] = [
  {
    id: "compare-analysis",
    name: "同策略对比分析",
    description: "输入多只私募基金或管理人名称，自动获取净值、绩效指标、管理人背景，结合知识库信息，生成深度对比研究报告。",
    icon: <GitCompareArrows className="h-5 w-5" />,
    badge: "可用",
    color: "from-blue-500/20 to-indigo-500/20 border-blue-500/30",
    steps: ["搜索匹配基金/管理人", "获取净值历史数据", "获取管理人背景", "查询知识库文档", "生成对比分析报告"],
  },
  {
    id: "trend-research",
    name: "市场趋势研究",
    description: "基于宏观数据、行业数据和知识库，自动生成市场趋势研究报告。",
    icon: <TrendingUp className="h-5 w-5" />,
    locked: true,
    color: "from-emerald-500/10 to-teal-500/10 border-emerald-500/20",
    steps: [],
  },
  {
    id: "manager-profile",
    name: "管理人深度画像",
    description: "对指定私募管理人进行全方位尽职调查，生成管理人画像报告。",
    icon: <Users className="h-5 w-5" />,
    locked: true,
    color: "from-violet-500/10 to-purple-500/10 border-violet-500/20",
    steps: [],
  },
  {
    id: "portfolio-analysis",
    name: "组合归因分析",
    description: "对现有投资组合进行收益归因、风险归因和优化建议。",
    icon: <BarChart3 className="h-5 w-5" />,
    locked: true,
    color: "from-orange-500/10 to-amber-500/10 border-orange-500/20",
    steps: [],
  },
]

// ── Fund picker component ───────────────────────────────────────────────────────

function FundPicker({
  selected,
  onChange,
}: {
  selected: FundSearchResult[]
  onChange: (funds: FundSearchResult[]) => void
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<FundSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setOpen(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/ma/api/ai-researcher/fund-search?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = await res.json()
        setResults(data)
        setOpen(true)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(val), 300)
  }

  function handleAddManual() {
    const q = query.trim()
    if (!q) return
    const already = selected.some((s) => s.product_name === q || s.beian_hao === q)
    if (!already) {
      onChange([...selected, { beian_hao: q, product_name: q, manager: "", strategy_l1: null, strategy_l2: null, inception_date: null, latest_nav: null, ret_1y: null }])
    }
    setQuery("")
    setResults([])
    setOpen(false)
  }

  function addFund(fund: FundSearchResult) {
    const already = selected.some((s) => s.beian_hao === fund.beian_hao)
    if (!already) onChange([...selected, fund])
    setQuery("")
    setResults([])
    setOpen(false)
    inputRef.current?.focus()
  }

  function removeFund(beian_hao: string) {
    onChange(selected.filter((s) => s.beian_hao !== beian_hao))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {selected.map((fund) => (
          <div
            key={fund.beian_hao}
            className="flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-sm"
          >
            <span className="font-medium text-foreground">{fund.product_name}</span>
            {fund.strategy_l1 && (
              <span className="text-xs text-muted-foreground">· {fund.strategy_l1}</span>
            )}
            <button
              onClick={() => removeFund(fund.beian_hao)}
              className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={handleInput}
              onFocus={() => results.length > 0 && setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddManual()
                if (e.key === "Escape") setOpen(false)
              }}
              placeholder="输入基金名称、备案号或管理人名称搜索..."
              className="pl-9"
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <Button variant="outline" size="sm" onClick={handleAddManual} disabled={!query.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            手动添加
          </Button>
        </div>

        {open && results.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 right-0 mt-1 z-50 rounded-lg border bg-popover shadow-lg overflow-hidden"
          >
            <div className="max-h-64 overflow-y-auto">
              {results.map((fund) => {
                const isSelected = selected.some((s) => s.beian_hao === fund.beian_hao)
                return (
                  <button
                    key={fund.beian_hao}
                    onClick={() => addFund(fund)}
                    disabled={isSelected}
                    className={cn(
                      "w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted transition-colors border-b last:border-b-0",
                      isSelected && "opacity-40 cursor-not-allowed",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{fund.product_name}</span>
                        {fund.strategy_l1 && (
                          <Badge variant="secondary" className="text-xs shrink-0">{fund.strategy_l1}</Badge>
                        )}
                        {isSelected && <Badge variant="outline" className="text-xs shrink-0">已添加</Badge>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        <span>{fund.manager}</span>
                        {fund.ret_1y && <span>近1年: {(parseFloat(fund.ret_1y) * 100).toFixed(1)}%</span>}
                        {fund.latest_nav && <span>净值: {parseFloat(fund.latest_nav).toFixed(4)}</span>}
                      </div>
                    </div>
                    <Plus className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: TaskStep }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0">
        {step.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        {step.status === "running" && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
        {step.status === "waiting" && <Circle className="h-4 w-4 text-muted-foreground/40" />}
        {step.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className={cn("text-sm font-medium", step.status === "waiting" && "text-muted-foreground/60")}>
          {step.step}. {step.title}
        </div>
        {step.summary && (
          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.summary}</div>
        )}
      </div>
    </div>
  )
}

// ── Task history item ──────────────────────────────────────────────────────────

function TaskHistoryItem({
  task,
  isActive,
  onClick,
  onDelete,
}: {
  task: ResearchTask
  isActive: boolean
  onClick: () => void
  onDelete: () => void
}) {
  const age = Date.now() - task.startedAt
  const timeLabel = age < 60_000 ? "刚刚" : age < 3_600_000 ? `${Math.floor(age / 60_000)}分钟前` : `${Math.floor(age / 3_600_000)}小时前`

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className={cn(
        "group w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors cursor-pointer",
        isActive ? "bg-muted" : "hover:bg-muted/50",
      )}
    >
      <div className="mt-0.5 shrink-0">
        {task.status === "running" && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
        {task.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        {task.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{task.skillName}</div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {task.subjects.slice(0, 2).join("、")}{task.subjects.length > 2 ? `等${task.subjects.length}个` : ""}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <Clock className="h-3 w-3 text-muted-foreground/60" />
          <span className="text-xs text-muted-foreground/60">{timeLabel}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive shrink-0"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ── Main page component ────────────────────────────────────────────────────────

export function AIResearcherPage() {
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [selectedFunds, setSelectedFunds] = useState<FundSearchResult[]>([])
  const [kbPath, setKbPath] = useState("")
  const [tasks, setTasks] = useState<ResearchTask[]>([])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [planExpanded, setPlanExpanded] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const reportEndRef = useRef<HTMLDivElement>(null)

  // Load task history from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ai-researcher-tasks")
      if (saved) {
        const parsed: ResearchTask[] = JSON.parse(saved)
        // Only restore completed tasks; discard any that were "running"
        const restored = parsed.map((t) =>
          t.status === "running" ? { ...t, status: "error" as const, errorMessage: "任务因页面刷新而中断" } : t,
        )
        setTasks(restored)
      }
    } catch {
      // ignore
    }
  }, [])

  // Persist tasks to localStorage
  useEffect(() => {
    try {
      const toSave = tasks.map((t) => ({ ...t }))
      localStorage.setItem("ai-researcher-tasks", JSON.stringify(toSave.slice(0, 20)))
    } catch {
      // ignore
    }
  }, [tasks])

  // Auto-scroll report
  useEffect(() => {
    reportEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [tasks])

  const activeTask = tasks.find((t) => t.id === activeTaskId) ?? null
  const selectedSkill = SKILLS.find((s) => s.id === selectedSkillId) ?? null

  function handleSelectSkill(skill: Skill) {
    if (skill.locked) return
    setSelectedSkillId(skill.id)
    setShowTaskForm(true)
    setSelectedFunds([])
    setKbPath("")
  }

  function handleCancelForm() {
    setShowTaskForm(false)
    setSelectedSkillId(null)
  }

  async function handleRunTask() {
    if (!selectedSkillId || selectedFunds.length === 0) return

    const taskId = `task-${Date.now()}`
    const skill = SKILLS.find((s) => s.id === selectedSkillId)!
    const subjects = selectedFunds.map((f) => f.product_name)

    const initialSteps: TaskStep[] = skill.steps.map((title, i) => ({
      step: i + 1,
      title,
      status: "waiting",
    }))

    const newTask: ResearchTask = {
      id: taskId,
      skillId: selectedSkillId,
      skillName: skill.name,
      subjects,
      kbPath,
      status: "running",
      startedAt: Date.now(),
      planText: "",
      steps: initialSteps,
      reportText: "",
    }

    setTasks((prev) => [newTask, ...prev])
    setActiveTaskId(taskId)
    setShowTaskForm(false)
    setPlanExpanded(true)

    const updateTask = (updater: (t: ResearchTask) => ResearchTask) => {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updater(t) : t)))
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await fetch("/ma/api/ai-researcher/compare-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjects, kbPath }),
        signal: ctrl.signal,
      })

      if (!res.ok || !res.body) throw new Error("请求失败")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          try {
            const event = JSON.parse(line.slice(6))
            handleStreamEvent(event, taskId, updateTask)
          } catch {
            // ignore parse errors
          }
        }
      }

      updateTask((t) => ({ ...t, status: "done", durationMs: Date.now() - t.startedAt }))
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        updateTask((t) => ({ ...t, status: "error", errorMessage: "任务已手动停止" }))
      } else {
        updateTask((t) => ({ ...t, status: "error", errorMessage: (err as Error).message }))
      }
    }
  }

  function handleStreamEvent(
    event: Record<string, unknown>,
    taskId: string,
    updateTask: (updater: (t: ResearchTask) => ResearchTask) => void,
  ) {
    switch (event.type) {
      case "plan_text":
        updateTask((t) => ({ ...t, planText: t.planText + String(event.content ?? "") }))
        break
      case "step_start":
        updateTask((t) => ({
          ...t,
          steps: t.steps.map((s) =>
            s.step === (event.step as number) ? { ...s, status: "running" } : s,
          ),
        }))
        break
      case "step_done":
        updateTask((t) => ({
          ...t,
          steps: t.steps.map((s) =>
            s.step === (event.step as number) ? { ...s, status: "done", summary: String(event.summary ?? "") } : s,
          ),
        }))
        break
      case "report_text":
        updateTask((t) => ({ ...t, reportText: t.reportText + String(event.delta ?? "") }))
        break
      case "error":
        updateTask((t) => ({ ...t, status: "error", errorMessage: String(event.message ?? "未知错误") }))
        break
    }
  }

  function handleDeleteTask(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    if (activeTaskId === taskId) setActiveTaskId(null)
  }

  function handleStopTask() {
    abortRef.current?.abort()
  }

  function handleCopyReport() {
    if (activeTask?.reportText) {
      navigator.clipboard.writeText(activeTask.reportText)
    }
  }

  function handleDownloadReport() {
    if (!activeTask?.reportText) return
    const filename = `对比分析报告_${activeTask.subjects.slice(0, 2).join("_")}_${new Date().toISOString().slice(0, 10)}.md`
    const blob = new Blob([activeTask.reportText], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left panel: Skills & History ── */}
      <div className="w-72 shrink-0 border-r flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-6 pb-4 border-b bg-gradient-to-b from-muted/30 to-transparent">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FlaskConical className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">AI 研究员</h1>
              <p className="text-xs text-muted-foreground leading-tight">智能分析 · 自动报告</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-muted-foreground">系统就绪</span>
          </div>
        </div>

        {/* Skills */}
        <div className="px-3 pt-4 pb-2">
          <div className="flex items-center justify-between mb-2.5 px-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">研究技能</span>
            <Badge variant="secondary" className="text-xs">
              {SKILLS.filter((s) => !s.locked).length}/{SKILLS.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {SKILLS.map((skill) => (
              <button
                key={skill.id}
                onClick={() => handleSelectSkill(skill)}
                disabled={skill.locked}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-all",
                  "bg-gradient-to-br",
                  skill.color,
                  skill.locked
                    ? "opacity-50 cursor-not-allowed"
                    : selectedSkillId === skill.id
                    ? "ring-2 ring-primary ring-offset-1"
                    : "hover:shadow-sm hover:scale-[1.01]",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div className={cn("mt-0.5 shrink-0", skill.locked ? "text-muted-foreground" : "text-primary")}>
                    {skill.locked ? <Lock className="h-4 w-4" /> : skill.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium leading-snug">{skill.name}</span>
                      {skill.badge && !skill.locked && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0 h-4">{skill.badge}</Badge>
                      )}
                      {skill.locked && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-dashed">即将推出</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">{skill.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Task History */}
        <div className="flex-1 overflow-hidden flex flex-col border-t mt-2">
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">任务历史</span>
            {tasks.length > 0 && (
              <span className="text-xs text-muted-foreground">{tasks.length}条</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-1 pb-4">
            {tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
                <Clock className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-xs text-center">暂无任务记录</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {tasks.map((task) => (
                  <TaskHistoryItem
                    key={task.id}
                    task={task}
                    isActive={task.id === activeTaskId}
                    onClick={() => setActiveTaskId(task.id)}
                    onDelete={() => handleDeleteTask(task.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main workspace ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Task form */}
        {showTaskForm && selectedSkill && (
          <div className="border-b bg-card/50 backdrop-blur-sm">
            <div className="max-w-3xl mx-auto px-6 py-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                    {selectedSkill.icon}
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">{selectedSkill.name}</h2>
                    <p className="text-xs text-muted-foreground">配置分析任务参数</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCancelForm}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    分析对象
                    <span className="text-destructive ml-1">*</span>
                    <span className="text-xs text-muted-foreground ml-2 font-normal">输入基金名称或备案号，可添加多个进行对比</span>
                  </label>
                  <FundPicker selected={selectedFunds} onChange={setSelectedFunds} />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    知识库路径
                    <span className="text-xs text-muted-foreground ml-2 font-normal">可选：指定知识库文件夹路径以补充分析信息</span>
                  </label>
                  <div className="relative">
                    <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={kbPath}
                      onChange={(e) => setKbPath(e.target.value)}
                      placeholder="例如：私募基金/尽调资料"
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="pt-1 flex items-center gap-3">
                  <Button
                    onClick={handleRunTask}
                    disabled={selectedFunds.length === 0}
                    className="gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    开始分析
                    {selectedFunds.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-xs">
                        {selectedFunds.length}个对象
                      </Badge>
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleCancelForm}>
                    取消
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty / welcome state */}
        {!showTaskForm && !activeTask && (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="max-w-md text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/10">
                <Cpu className="h-8 w-8 text-primary/70" />
              </div>
              <h2 className="text-xl font-semibold mb-2">AI 研究员工作台</h2>
              <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                选择左侧的研究技能，配置分析对象，AI 研究员将自动规划任务、获取数据并生成专业研究报告。
              </p>
              <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                  { icon: <Search className="h-4 w-4" />, label: "智能数据获取" },
                  { icon: <Cpu className="h-4 w-4" />, label: "自主规划执行" },
                  { icon: <BarChart3 className="h-4 w-4" />, label: "深度报告生成" },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col items-center gap-2 rounded-lg border p-3 bg-muted/20">
                    <div className="text-primary/70">{item.icon}</div>
                    <span className="text-xs text-muted-foreground font-medium">{item.label}</span>
                  </div>
                ))}
              </div>
              <Button onClick={() => { setSelectedSkillId("compare-analysis"); setShowTaskForm(true) }} className="gap-2">
                <GitCompareArrows className="h-4 w-4" />
                开始对比分析
              </Button>
            </div>
          </div>
        )}

        {/* Active task view */}
        {activeTask && !showTaskForm && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Task header */}
            <div className="shrink-0 px-6 py-3 border-b flex items-center justify-between bg-card/30">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-1.5 shrink-0">
                  {activeTask.status === "running" && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
                  {activeTask.status === "done" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {activeTask.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
                  <span className="text-sm font-medium">{activeTask.skillName}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {activeTask.subjects.join("、")}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {activeTask.status === "running" && (
                  <Button variant="outline" size="sm" onClick={handleStopTask} className="gap-1.5 h-7 text-xs">
                    <X className="h-3.5 w-3.5" />
                    停止
                  </Button>
                )}
                {activeTask.status === "done" && (
                  <>
                    <Button variant="outline" size="sm" onClick={handleCopyReport} className="gap-1.5 h-7 text-xs">
                      <Copy className="h-3.5 w-3.5" />
                      复制
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDownloadReport} className="gap-1.5 h-7 text-xs">
                      <Download className="h-3.5 w-3.5" />
                      下载 MD
                    </Button>
                  </>
                )}
                {(activeTask.status === "done" || activeTask.status === "error") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 h-7 text-xs"
                    onClick={() => { setSelectedSkillId(activeTask.skillId); setShowTaskForm(true) }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重新运行
                  </Button>
                )}
              </div>
            </div>

            {/* Task body */}
            <div className="flex-1 overflow-hidden flex">
              {/* Steps sidebar */}
              <div className="w-64 shrink-0 border-r overflow-y-auto p-4 space-y-1 bg-muted/10">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">执行进度</p>

                {/* Plan section */}
                {(activeTask.planText || activeTask.status !== "done") && (
                  <div className="mb-4">
                    <button
                      onClick={() => setPlanExpanded((v) => !v)}
                      className="flex items-center gap-2 w-full text-left mb-2 group"
                    >
                      <div className="flex items-center gap-1.5 flex-1">
                        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-xs font-semibold text-foreground">分析规划</span>
                      </div>
                      {planExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                    </button>
                    {planExpanded && activeTask.planText && (
                      <div className="text-xs text-muted-foreground leading-relaxed rounded-md bg-muted/30 px-2.5 py-2 border">
                        {activeTask.planText}
                      </div>
                    )}
                    {planExpanded && !activeTask.planText && activeTask.status === "running" && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        规划中...
                      </div>
                    )}
                  </div>
                )}

                {/* Steps */}
                <div className="space-y-3">
                  {activeTask.steps.map((step) => (
                    <StepIndicator key={step.step} step={step} />
                  ))}
                </div>

                {/* Duration */}
                {activeTask.durationMs && (
                  <div className="mt-4 pt-3 border-t text-xs text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    耗时 {(activeTask.durationMs / 1000).toFixed(1)}s
                  </div>
                )}

                {/* Error */}
                {activeTask.status === "error" && activeTask.errorMessage && (
                  <div className="mt-3 rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs text-destructive">
                    {activeTask.errorMessage}
                  </div>
                )}
              </div>

              {/* Report area */}
              <div className="flex-1 overflow-y-auto">
                {activeTask.reportText ? (
                  <div className="max-w-3xl mx-auto px-8 py-6">
                    <div className="prose prose-sm max-w-none">
                      <MarkdownNotePreview
                        content={activeTask.reportText}
                        className="text-sm leading-relaxed [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:leading-7 [&_li]:leading-6 [&_strong]:font-semibold"
                      />
                    </div>
                    {activeTask.status === "running" && (
                      <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在生成中...
                      </div>
                    )}
                    <div ref={reportEndRef} />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground/50 gap-3">
                    {activeTask.status === "running" ? (
                      <>
                        <Loader2 className="h-8 w-8 animate-spin" />
                        <p className="text-sm">正在执行分析任务...</p>
                      </>
                    ) : activeTask.status === "error" ? (
                      <>
                        <AlertCircle className="h-8 w-8 text-destructive/50" />
                        <p className="text-sm text-destructive/70">{activeTask.errorMessage || "任务执行失败"}</p>
                      </>
                    ) : (
                      <>
                        <BarChart3 className="h-8 w-8" />
                        <p className="text-sm">暂无报告内容</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
