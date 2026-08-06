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
  ScanSearch,
  ArrowLeftRight,
  Folder,
  FolderOpen,
  File as FileIcon,
  Building2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
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

interface SkillColors {
  bg: string        // CSS background (gradient)
  border: string    // CSS border-color
  icon: string      // text color for icon
}

interface Skill {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  badge?: string
  locked?: boolean
  colors: SkillColors
  steps: string[]
  /** When true, fund picker limits to exactly 1 selection */
  singleFund?: boolean
  /** When true, skip fund picker — use KB path as primary input */
  noFundRequired?: boolean
  /** When true, require a free-text employer/background keyword (no fund picker) */
  keywordRequired?: boolean
  /** API route path (relative to /ma/api/ai-researcher/) */
  apiPath?: string
}

const TEAM_BACKGROUND_CHIPS = [
  { label: "UBS/瑞银", keyword: "UBS/瑞银" },
  { label: "高盛", keyword: "高盛" },
  { label: "摩根", keyword: "摩根" },
  { label: "中金", keyword: "中金" },
  { label: "Two Sigma", keyword: "Two Sigma" },
  { label: "Jump", keyword: "Jump" },
] as const

// ── Skills catalog ─────────────────────────────────────────────────────────────

const SKILLS: Skill[] = [
  {
    id: "compare-analysis",
    name: "同策略对比分析",
    description: "输入多只私募基金或管理人名称，自动获取净值、绩效指标、管理人背景，结合知识库信息，生成深度对比研究报告。",
    icon: <GitCompareArrows className="h-5 w-5" />,
    badge: "可用",
    colors: {
      bg: "linear-gradient(to bottom right, rgb(59 130 246 / 0.18), rgb(99 102 241 / 0.18))",
      border: "rgb(59 130 246 / 0.35)",
      icon: "#3b82f6",
    },
    steps: ["搜索匹配基金/管理人", "获取净值历史数据", "获取管理人背景", "查询知识库文档", "生成对比分析报告"],
    apiPath: "compare-analysis",
  },
  {
    id: "similar-fund",
    name: "相似基金匹配",
    description: "输入一只基金，AI自动从数据库中计算净值相关性与绩效指标相似度，找出策略最接近的同类产品，并深度分析相似原因与差异点。",
    icon: <ScanSearch className="h-5 w-5" />,
    badge: "可用",
    colors: {
      bg: "linear-gradient(to bottom right, rgb(20 184 166 / 0.18), rgb(6 182 212 / 0.18))",
      border: "rgb(20 184 166 / 0.35)",
      icon: "#14b8a6",
    },
    steps: ["获取目标基金信息", "构建同类候选池", "计算净值相关性与指标相似度", "查询知识库补充信息", "生成相似度分析报告"],
    singleFund: true,
    apiPath: "similar-fund",
  },
  {
    id: "opposite-fund",
    name: "相反基金匹配",
    description: "输入一只基金，AI跨全库计算净值负相关性，找出走势最相反的产品（目标基金涨时它跌），分析对冲逻辑并给出组合配比建议。",
    icon: <ArrowLeftRight className="h-5 w-5" />,
    badge: "可用",
    colors: {
      bg: "linear-gradient(to bottom right, rgb(239 68 68 / 0.15), rgb(249 115 22 / 0.15))",
      border: "rgb(239 68 68 / 0.30)",
      icon: "#ef4444",
    },
    steps: ["获取目标基金信息", "构建全库候选池", "计算净值负相关性", "查询知识库补充信息", "生成对冲匹配分析报告"],
    singleFund: true,
    apiPath: "opposite-fund",
  },
  {
    id: "roadshow-analysis",
    name: "路演漏洞扫描",
    description: "选择知识库中的路演PPT、月报等材料，AI自动扫描策略矛盾、历史叙事不一致、容量陷阱、幸存者偏差、隐藏杠杆等22类逻辑漏洞，生成尽调风险报告。",
    icon: <ScanSearch className="h-5 w-5" />,
    badge: "可用",
    colors: {
      bg: "linear-gradient(to bottom right, rgb(239 68 68 / 0.12), rgb(168 85 247 / 0.12))",
      border: "rgb(239 68 68 / 0.28)",
      icon: "#ef4444",
    },
    steps: ["读取路演文档", "查询数据库基金指标", "分析策略与净值一致性", "检测历史叙事矛盾", "生成尽调风险报告"],
    noFundRequired: true,
    apiPath: "roadshow-analysis",
  },
  {
    id: "team-background",
    name: "团队背景筛选",
    description: "输入前任机构名称（如 UBS、高盛、中金），自动检索 AMAC 高管履历与知识库尽调材料，找出团队含该背景的私募管理人并生成报告。",
    icon: <Building2 className="h-5 w-5" />,
    badge: "可用",
    colors: {
      bg: "linear-gradient(to bottom right, rgb(99 102 241 / 0.16), rgb(14 165 233 / 0.16))",
      border: "rgb(99 102 241 / 0.32)",
      icon: "#6366f1",
    },
    steps: [
      "扩展关键词并检索 AMAC 高管履历",
      "检索知识库尽调/路演材料",
      "汇总管理人并甄别名称命中",
      "整理雇主分布与证据包",
      "生成团队背景筛选报告",
    ],
    keywordRequired: true,
    apiPath: "team-background",
  },
  {
    id: "trend-research",
    name: "市场趋势研究",
    description: "基于宏观数据、行业数据和知识库，自动生成市场趋势研究报告。",
    icon: <TrendingUp className="h-5 w-5" />,
    locked: true,
    colors: {
      bg: "linear-gradient(to bottom right, rgb(16 185 129 / 0.08), rgb(20 184 166 / 0.08))",
      border: "rgb(16 185 129 / 0.18)",
      icon: "#10b981",
    },
    steps: [],
  },
  {
    id: "manager-profile",
    name: "管理人深度画像",
    description: "对指定私募管理人进行全方位尽职调查，生成管理人画像报告。",
    icon: <Users className="h-5 w-5" />,
    locked: true,
    colors: {
      bg: "linear-gradient(to bottom right, rgb(139 92 246 / 0.08), rgb(168 85 247 / 0.08))",
      border: "rgb(139 92 246 / 0.18)",
      icon: "#8b5cf6",
    },
    steps: [],
  },
  {
    id: "portfolio-analysis",
    name: "组合归因分析",
    description: "对现有投资组合进行收益归因、风险归因和优化建议。",
    icon: <BarChart3 className="h-5 w-5" />,
    locked: true,
    colors: {
      bg: "linear-gradient(to bottom right, rgb(249 115 22 / 0.08), rgb(245 158 11 / 0.08))",
      border: "rgb(249 115 22 / 0.18)",
      icon: "#f97316",
    },
    steps: [],
  },
]

// ── Fund picker component ───────────────────────────────────────────────────────

function FundPicker({
  selected,
  onChange,
  maxSelect = 10,
  placeholder,
}: {
  selected: FundSearchResult[]
  onChange: (funds: FundSearchResult[]) => void
  maxSelect?: number
  placeholder?: string
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
    if (selected.length >= maxSelect) return
    const already = selected.some((s) => s.product_name === q || s.beian_hao === q)
    if (!already) {
      const next = maxSelect === 1
        ? [{ beian_hao: q, product_name: q, manager: "", strategy_l1: null, strategy_l2: null, inception_date: null, latest_nav: null, ret_1y: null }]
        : [...selected, { beian_hao: q, product_name: q, manager: "", strategy_l1: null, strategy_l2: null, inception_date: null, latest_nav: null, ret_1y: null }]
      onChange(next)
    }
    setQuery("")
    setResults([])
    setOpen(false)
  }

  function addFund(fund: FundSearchResult) {
    if (selected.length >= maxSelect) return
    const already = selected.some((s) => s.beian_hao === fund.beian_hao)
    if (!already) {
      const next = maxSelect === 1 ? [fund] : [...selected, fund]
      onChange(next)
    }
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
              placeholder={placeholder ?? "输入基金名称、备案号或管理人名称搜索..."}
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

// ── KB browser types & tree component ────────────────────────────────────────

type KbDoc = { name: string; relativePath: string; extension: string }
type KbFolder = { name: string; relativePath: string; folders: KbFolder[]; documents: KbDoc[] }

function KbBrowserNode({
  node, depth, expanded, onToggle, onSelect, selectedPath,
}: {
  node: KbFolder
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  selectedPath: string
}) {
  const isExpanded = expanded.has(node.relativePath)
  const isSelected = selectedPath === node.relativePath
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onToggle(node.relativePath)}
        onKeyDown={(e) => e.key === "Enter" && onToggle(node.relativePath)}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        className={cn(
          "w-full flex items-center gap-2 rounded py-1.5 pr-2 text-left text-sm transition-colors cursor-pointer select-none",
          isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted",
        )}
      >
        <span className="shrink-0 w-3.5 flex items-center justify-center">
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        {isExpanded
          ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
        <span className="truncate flex-1">{node.name}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(node.relativePath) }}
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
            isSelected
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
          )}
        >
          选此文件夹
        </button>
      </div>
      {isExpanded && (
        <div>
          {node.folders.map((child) => (
            <KbBrowserNode
              key={child.relativePath}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedPath={selectedPath}
            />
          ))}
          {node.documents.map((doc) => (
            <button
              key={doc.relativePath}
              onClick={() => onSelect(doc.relativePath)}
              style={{ paddingLeft: `${(depth + 1) * 16 + 8 + 14}px` }}
              className={cn(
                "w-full flex items-center gap-2 rounded py-1.5 pr-2 text-left text-sm transition-colors",
                selectedPath === doc.relativePath ? "bg-primary/10 text-primary" : "hover:bg-muted",
              )}
            >
              <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{doc.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page component ────────────────────────────────────────────────────────

export function AIResearcherPage() {
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [selectedFunds, setSelectedFunds] = useState<FundSearchResult[]>([])
  const [kbPath, setKbPath] = useState("")
  const [roadshowBeianHao, setRoadshowBeianHao] = useState("")
  const [backgroundKeyword, setBackgroundKeyword] = useState("")
  // ── KB folder browser ────────────────────────────────────────────────────
  const [kbBrowserOpen, setKbBrowserOpen] = useState(false)
  const [kbTree, setKbTree] = useState<KbFolder | null>(null)
  const [kbTreeLoading, setKbTreeLoading] = useState(false)
  const [kbBrowserExpanded, setKbBrowserExpanded] = useState<Set<string>>(new Set())

  async function openKbBrowser() {
    setKbBrowserOpen(true)
    if (kbTree) return
    setKbTreeLoading(true)
    try {
      const res = await fetch("/api/knowledge-base/tree")
      const data = await res.json()
      if (data.ok && data.tree) {
        setKbTree(data.tree)
        // Expand root folders by default
        const rootPaths = new Set((data.tree.folders ?? []).map((f: KbFolder) => f.relativePath))
        setKbBrowserExpanded(rootPaths as Set<string>)
      }
    } catch { /* ignore */ } finally {
      setKbTreeLoading(false)
    }
  }

  function toggleKbFolder(path: string) {
    setKbBrowserExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function selectKbPath(path: string) {
    setKbPath(path)
    setKbBrowserOpen(false)
  }
  const [tasks, setTasks] = useState<ResearchTask[]>([])
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [pdfDownloading, setPdfDownloading] = useState(false)
  const [planExpanded, setPlanExpanded] = useState(true)
  const abortRef = useRef<AbortController | null>(null)
  const reportEndRef = useRef<HTMLDivElement>(null)
  const reportContainerRef = useRef<HTMLDivElement>(null)

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
    setRoadshowBeianHao("")
    setBackgroundKeyword("")
  }

  function handleCancelForm() {
    setShowTaskForm(false)
    setSelectedSkillId(null)
  }

  async function handleRunTask() {
    if (!selectedSkillId) return
    const skill = SKILLS.find((s) => s.id === selectedSkillId)!
    if (skill.keywordRequired) {
      if (!backgroundKeyword.trim()) return
    } else if (skill.noFundRequired) {
      if (!kbPath.trim()) return
    } else if (selectedFunds.length === 0) {
      return
    }

    const taskId = `task-${Date.now()}`
    const subjects = skill.keywordRequired
      ? [backgroundKeyword.trim()]
      : skill.noFundRequired
        ? [kbPath.trim() || "全部知识库"]
        : selectedFunds.map((f) => f.product_name)

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

    const apiPath = skill.apiPath ?? "compare-analysis"
    const payload = skill.keywordRequired
      ? { keyword: backgroundKeyword.trim(), kbPath: kbPath.trim() }
      : skill.noFundRequired
        ? { kbPath: kbPath.trim(), beianHao: roadshowBeianHao.trim() }
        : skill.singleFund
          ? { subject: subjects[0], kbPath }
          : { subjects, kbPath }

    try {
      const res = await fetch(`/ma/api/ai-researcher/${apiPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  function baseFilename() {
    const prefix =
      activeTask?.skillId === "similar-fund" ? "相似基金分析" :
      activeTask?.skillId === "opposite-fund" ? "相反基金分析" :
      activeTask?.skillId === "team-background" ? "团队背景筛选" :
      activeTask?.skillId === "roadshow-analysis" ? "路演漏洞扫描" :
      "对比分析报告"
    const subjectPart = (activeTask?.subjects.slice(0, 2).join("_") ?? "报告")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .slice(0, 40)
    return `${prefix}_${subjectPart}_${new Date().toISOString().slice(0, 10)}`
  }

  function handleDownloadReport() {
    if (!activeTask?.reportText) return
    triggerDownload(new Blob([activeTask.reportText], { type: "text/markdown;charset=utf-8" }), baseFilename() + ".md")
  }

  function handleDownloadWord() {
    if (!activeTask?.reportText) return
    const title =
      activeTask.skillId === "team-background"
        ? `团队有「${activeTask.subjects[0] ?? ""}」背景的私募筛选报告`
        : activeTask.subjects.join("、") + (activeTask.skillName || "研究报告")
    const dateStr = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" })
    const subjectLine = activeTask.subjects.join(" · ")
    const bodyHtml = mdToWordHtml(activeTask.reportText)

    const css = `
      @page { size: A4; margin: 2.5cm 2.8cm 2.5cm 2.8cm; }
      body {
        font-family: "微软雅黑", "Microsoft YaHei", "宋体", SimSun, sans-serif;
        font-size: 11pt; color: #1a1a2e; margin: 0; line-height: 1.75;
      }
      .cover-title {
        text-align: center; font-size: 22pt; font-weight: bold;
        color: #1F3864; margin: 30pt 0 6pt; letter-spacing: 1pt;
      }
      .cover-sub {
        text-align: center; font-size: 12pt; color: #2E74B5;
        margin-bottom: 4pt; font-weight: normal;
      }
      .cover-meta {
        text-align: center; font-size: 10pt; color: #888;
        margin-bottom: 30pt; border-bottom: 2pt solid #2E74B5; padding-bottom: 12pt;
      }
      h1 {
        font-size: 16pt; font-weight: bold; color: #1F3864;
        margin: 20pt 0 6pt; text-align: center;
        border-bottom: 2pt solid #2E74B5; padding-bottom: 6pt; display: none;
      }
      h2 {
        font-size: 13pt; font-weight: bold; color: #ffffff;
        background-color: #2E74B5; padding: 5pt 10pt;
        margin: 18pt 0 8pt; border-left: 5pt solid #1F3864;
      }
      h3 {
        font-size: 11.5pt; font-weight: bold; color: #2E74B5;
        margin: 12pt 0 5pt; border-left: 3pt solid #BDD7EE; padding-left: 7pt;
      }
      h4 { font-size: 11pt; font-weight: bold; color: #1F3864; margin: 8pt 0 4pt; }
      p { margin: 5pt 0; text-align: justify; }
      table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 10pt; }
      thead tr { background-color: #2E74B5; color: #ffffff; }
      th {
        padding: 6pt 8pt; font-weight: bold; text-align: left; color: #ffffff;
        border: 1pt solid #1F3864; font-size: 10pt;
      }
      td { padding: 5pt 8pt; border: 1pt solid #BDD7EE; vertical-align: top; }
      tr.even-row td { background-color: #EBF3FB; }
      blockquote {
        border-left: 4pt solid #2E74B5; background: #F4F9FD;
        padding: 8pt 12pt; margin: 8pt 0; color: #333;
        font-size: 10.5pt; font-style: normal;
      }
      hr { border: none; border-top: 1pt solid #BDD7EE; margin: 14pt 0; }
      ul { margin: 4pt 0 6pt 0; padding-left: 18pt; }
      ol { margin: 4pt 0 6pt 0; padding-left: 18pt; }
      li { margin-bottom: 4pt; }
      strong { font-weight: bold; color: #1F3864; }
      code {
        font-family: Consolas, monospace; background: #f0f0f0;
        padding: 1pt 4pt; font-size: 9.5pt; border-radius: 2pt;
      }
      .footer {
        margin-top: 30pt; border-top: 1pt solid #BDD7EE;
        padding-top: 8pt; text-align: center; color: #999; font-size: 9pt;
      }
      .disclaimer {
        background: #FFF8E1; border-left: 4pt solid #FFC107;
        padding: 8pt 12pt; margin: 12pt 0; font-size: 10pt; color: #555;
      }
    `

    const doc = `<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>${escapeXml(title)}</title>
        <!--[if gte mso 9]><xml>
          <w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument>
        </xml><![endif]-->
        <style>${css}</style>
      </head>
      <body>
        <p class="cover-title">${escapeXml(title)}</p>
        <p class="cover-sub">${escapeXml(subjectLine)}</p>
        <p class="cover-meta">编制日期：${escapeXml(dateStr)} &nbsp;|&nbsp; AI 研究员自动生成 &nbsp;|&nbsp; 仅供内部参考</p>
        ${bodyHtml}
        <div class="disclaimer">
          <strong>免责声明：</strong>本报告由 AI 研究员系统依据结构化数据库与知识库文档自动生成，未经人工审核。所有存疑数据均已标注，投资决策请以经审计的净值报告、托管行确认函及管理人正式披露文件为最终依据，本报告不构成投资建议。
        </div>
        <div class="footer">编制机构：私募基金策略研究部 &nbsp;·&nbsp; AI 研究员系统 &nbsp;·&nbsp; ${escapeXml(dateStr)}</div>
      </body>
    </html>`

    triggerDownload(new Blob(["\uFEFF" + doc], { type: "application/msword;charset=utf-8" }), baseFilename() + ".doc")
  }

  async function handleDownloadPDF() {
    if (!reportContainerRef.current || !activeTask?.reportText || pdfDownloading) return
    setPdfDownloading(true)
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ])
      const canvas = await html2canvas(reportContainerRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      })
      const imgData = canvas.toDataURL("image/png")
      // Single tall page — avoids content being cut at page boundaries
      const a4W = 210 // mm
      const imgH = (canvas.height * a4W) / canvas.width
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: [a4W, imgH] })
      pdf.addImage(imgData, "PNG", 0, 0, a4W, imgH, undefined, "FAST")
      pdf.save(baseFilename() + ".pdf")
    } catch (err) {
      console.error("[handleDownloadPDF]", err)
    } finally {
      setPdfDownloading(false)
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function escapeXml(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  }

  function mdToWordHtml(md: string): string {
    const lines = md.replace(/\r\n/g, "\n").split("\n")
    const out: string[] = []
    let i = 0
    let rowIndex = 0

    while (i < lines.length) {
      const trimmed = lines[i].trim()
      if (!trimmed) { i++; continue }

      // Horizontal rule ---
      if (/^[-*_]{3,}$/.test(trimmed)) {
        out.push("<hr>")
        i++; continue
      }

      // Headings
      const hm = trimmed.match(/^(#{1,6})\s+(.+)$/)
      if (hm) {
        const lv = hm[1].length
        out.push(`<h${lv}>${inlineMd(hm[2])}</h${lv}>`)
        i++; continue
      }

      // Blockquote (> text) — render as styled callout box
      if (/^>\s?/.test(trimmed)) {
        const bqLines: string[] = []
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          bqLines.push(lines[i].trim().replace(/^>\s?/, ""))
          i++
        }
        // Filter out empty separator lines within the blockquote
        const filtered = bqLines.filter(l => l.trim() !== "-" && l.trim() !== "")
        if (filtered.length > 0) {
          out.push(`<blockquote>${filtered.map(l => inlineMd(l)).join("<br>")}</blockquote>`)
        }
        continue
      }

      // Pipe tables
      if (/^\|.+\|$/.test(trimmed)) {
        const rows: string[] = []
        while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
          rows.push(lines[i].trim()); i++
        }
        const headerCells = splitTableRow(rows[0])
        const bodyRows = rows.slice(1).filter(r => !/^\|[\s|:-]+\|$/.test(r))
        out.push(`<table><thead><tr>${headerCells.map(c => `<th>${inlineMd(c)}</th>`).join("")}</tr></thead><tbody>`)
        rowIndex = 0
        for (const row of bodyRows) {
          const cls = rowIndex % 2 === 1 ? ' class="even-row"' : ""
          const cells = splitTableRow(row)
          out.push(`<tr${cls}>${cells.map(c => `<td>${inlineMd(c)}</td>`).join("")}</tr>`)
          rowIndex++
        }
        out.push("</tbody></table>")
        continue
      }

      // Unordered list – collect contiguous items into one <ul>
      if (/^[-*+]\s+/.test(trimmed)) {
        out.push("<ul>")
        while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
          const text = lines[i].trim().replace(/^[-*+]\s+/, "")
          out.push(`<li>${inlineMd(text)}</li>`)
          i++
        }
        out.push("</ul>")
        continue
      }

      // Ordered list – consecutive numbered items stay inside one <ol>
      if (/^\d+\.\s+/.test(trimmed)) {
        out.push("<ol>")
        while (i < lines.length) {
          const cur = lines[i].trim()
          if (/^\d+\.\s+/.test(cur)) {
            out.push(`<li>${inlineMd(cur.replace(/^\d+\.\s+/, ""))}</li>`)
            i++
          } else if (/^[-*+]\s+/.test(cur)) {
            // Indented bullets following a numbered item stay inside the list
            out.push(`<li style="list-style-type:disc;margin-left:14pt">${inlineMd(cur.replace(/^[-*+]\s+/, ""))}</li>`)
            i++
          } else {
            break
          }
        }
        out.push("</ol>")
        continue
      }

      // Regular paragraph
      const pLines: string[] = []
      while (i < lines.length) {
        const cur = lines[i].trim()
        if (!cur) break
        if (/^(#{1,6}\s|[-*_]{3,}$|>\s?|\|.+\||[-*+]\s|\d+\.\s)/.test(cur)) break
        pLines.push(cur); i++
      }
      if (pLines.length > 0) {
        out.push(`<p>${inlineMd(pLines.join(" "))}</p>`)
      }
    }
    return out.join("\n")
  }

  function splitTableRow(row: string): string[] {
    return row.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim())
  }

  // Escapes HTML but preserves <br> / &lt;br&gt; the LLM may emit inside table cells.
  function inlineMd(text: string): string {
    const BR = "\x00BR\x00"
    return text
      .replace(/<br\s*\/?>/gi, BR)
      .replace(/&lt;br\s*\/?&gt;/gi, BR)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(new RegExp(BR, "g"), "<br>")
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

        {/* Skills — takes remaining space after header, scrolls internally, never pushes history out */}
        <div className="flex flex-1 flex-col min-h-0 px-3 pt-4 pb-2">
          <div className="flex items-center justify-between mb-2.5 px-1 shrink-0">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">研究技能</span>
            <Badge variant="secondary" className="text-xs">
              {SKILLS.filter((s) => !s.locked).length}/{SKILLS.length}
            </Badge>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 min-h-0">
            {SKILLS.map((skill) => (
              <button
                key={skill.id}
                onClick={() => handleSelectSkill(skill)}
                disabled={skill.locked}
                style={{ background: skill.colors.bg, borderColor: skill.colors.border }}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-all",
                  skill.locked
                    ? "opacity-50 cursor-not-allowed"
                    : selectedSkillId === skill.id
                    ? "ring-2 ring-primary ring-offset-1"
                    : "hover:shadow-sm hover:scale-[1.01]",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className="mt-0.5 shrink-0"
                    style={{ color: skill.locked ? undefined : skill.colors.icon }}
                  >
                    {skill.locked ? <Lock className="h-4 w-4 text-muted-foreground" /> : skill.icon}
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

        {/* Task History — fixed proportion of sidebar height, guaranteed visible regardless of skills count */}
        <div className="shrink-0 overflow-hidden flex flex-col border-t" style={{ height: "38%", minHeight: "200px" }}>
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
                {selectedSkill.keywordRequired ? (
                  <>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">
                        背景机构
                        <span className="text-destructive ml-1">*</span>
                        <span className="text-xs text-muted-foreground ml-2 font-normal">
                          输入前任机构中英文名称，系统会自动扩展常见别名
                        </span>
                      </label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          value={backgroundKeyword}
                          onChange={(e) => setBackgroundKeyword(e.target.value)}
                          placeholder="例：UBS、瑞银、高盛、中金、Two Sigma"
                          className="pl-9"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && backgroundKeyword.trim()) handleRunTask()
                          }}
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {TEAM_BACKGROUND_CHIPS.map((chip) => (
                          <button
                            key={chip.keyword}
                            type="button"
                            onClick={() => setBackgroundKeyword(chip.keyword)}
                            className={cn(
                              "rounded-md border px-2 py-0.5 text-xs transition-colors",
                              backgroundKeyword === chip.keyword
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">
                        知识库路径
                        <span className="text-xs text-muted-foreground ml-2 font-normal">
                          留空则全库检索尽调材料；填写可缩小范围
                        </span>
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          <Input
                            value={kbPath}
                            onChange={(e) => setKbPath(e.target.value)}
                            placeholder="留空全库，或如：内部尽调资料"
                            className="pl-9"
                          />
                        </div>
                        <Button type="button" variant="outline" onClick={openKbBrowser} className="shrink-0">
                          <FolderOpen className="mr-1.5 h-4 w-4" />
                          浏览
                        </Button>
                      </div>
                    </div>
                  </>
                ) : selectedSkill.noFundRequired ? (
                  <>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">
                        路演材料
                        <span className="text-destructive ml-1">*</span>
                        <span className="text-xs text-muted-foreground ml-2 font-normal">
                          从知识库中选择存放路演PPT、月报、产品说明书等文件的文件夹
                        </span>
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Folder className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          <Input
                            value={kbPath}
                            onChange={(e) => setKbPath(e.target.value)}
                            placeholder="点击「浏览」从知识库选择文件夹或文件"
                            className="pl-9 pr-2"
                          />
                        </div>
                        <Button type="button" variant="outline" onClick={openKbBrowser} className="shrink-0">
                          <FolderOpen className="mr-1.5 h-4 w-4" />
                          浏览
                        </Button>
                      </div>
                      {kbPath && (
                        <p className="text-xs text-muted-foreground mt-1">
                          将读取「{kbPath}」下所有可读文档（PDF、Word 等）
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">
                        基金备案号
                        <span className="text-xs text-muted-foreground ml-2 font-normal">
                          可选 — 填写后 AI 将从数据库调取净值、回撤、相关性数据进行交叉验证
                        </span>
                      </label>
                      <Input
                        value={roadshowBeianHao}
                        onChange={(e) => setRoadshowBeianHao(e.target.value)}
                        placeholder="例：SXS123456（选填）"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">
                        {selectedSkill.singleFund ? "目标基金" : "分析对象"}
                        <span className="text-destructive ml-1">*</span>
                        <span className="text-xs text-muted-foreground ml-2 font-normal">
                          {selectedSkill.singleFund
                            ? "输入一只基金名称或备案号，AI将自动搜索相似基金"
                            : "输入基金名称或备案号，可添加多个进行对比"}
                        </span>
                      </label>
                      <FundPicker
                        selected={selectedFunds}
                        onChange={setSelectedFunds}
                        maxSelect={selectedSkill.singleFund ? 1 : 10}
                        placeholder={selectedSkill.singleFund ? "输入目标基金名称或备案号..." : undefined}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">
                        知识库路径
                        <span className="text-xs text-muted-foreground ml-2 font-normal">
                          留空则自动全库检索；填写路径可缩小范围提高准确性
                        </span>
                      </label>
                      <div className="relative">
                        <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          value={kbPath}
                          onChange={(e) => setKbPath(e.target.value)}
                          placeholder="留空自动全库检索，或填写路径如：私募基金/尽调资料"
                          className="pl-9"
                        />
                      </div>
                    </div>
                  </>
                )}

                <div className="pt-1 flex items-center gap-3">
                  <Button
                    onClick={handleRunTask}
                    disabled={
                      selectedSkill.keywordRequired
                        ? !backgroundKeyword.trim()
                        : selectedSkill.noFundRequired
                          ? !kbPath.trim()
                          : selectedFunds.length === 0
                    }
                    className="gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    开始分析
                    {selectedSkill.keywordRequired && backgroundKeyword.trim() && (
                      <Badge variant="secondary" className="ml-1 text-xs">
                        {backgroundKeyword.trim()}
                      </Badge>
                    )}
                    {!selectedSkill.keywordRequired && !selectedSkill.noFundRequired && selectedFunds.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-xs">
                        {selectedSkill.singleFund ? selectedFunds[0].product_name : `${selectedFunds.length}个对象`}
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
                      MD
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDownloadWord} className="gap-1.5 h-7 text-xs">
                      <Download className="h-3.5 w-3.5" />
                      Word
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleDownloadPDF} disabled={pdfDownloading} className="gap-1.5 h-7 text-xs">
                      {pdfDownloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                      {pdfDownloading ? "生成中…" : "PDF"}
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
                  <div ref={reportContainerRef} className="max-w-3xl mx-auto px-8 py-6 bg-white" style={{ color: "#111" }}>
                    <MarkdownNotePreview
                      content={activeTask.reportText}
                      className="text-sm leading-relaxed"
                    />
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

      {/* ── KB Folder Browser Dialog ── */}
      <Dialog open={kbBrowserOpen} onOpenChange={setKbBrowserOpen}>
        <DialogContent className="flex max-h-[70vh] max-w-md flex-col gap-0 p-0">
          <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0">
            <DialogTitle className="text-sm">选择路演材料文件夹或文件</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">点击文件夹或文件即可选中作为分析范围</p>
          </DialogHeader>
          <ScrollArea className="flex-1 overflow-auto px-2 py-2">
            {kbTreeLoading ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载知识库目录...
              </div>
            ) : kbTree ? (
              <div className="space-y-0.5">
                {(kbTree.folders ?? []).length === 0 && (kbTree.documents ?? []).length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">知识库暂无文件</div>
                ) : (
                  <>
                    {(kbTree.folders ?? []).map((folder) => (
                      <KbBrowserNode
                        key={folder.relativePath}
                        node={folder}
                        depth={0}
                        expanded={kbBrowserExpanded}
                        onToggle={toggleKbFolder}
                        onSelect={selectKbPath}
                        selectedPath={kbPath}
                      />
                    ))}
                    {(kbTree.documents ?? []).map((doc) => (
                      <button
                        key={doc.relativePath}
                        onClick={() => selectKbPath(doc.relativePath)}
                        className={cn(
                          "w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                          kbPath === doc.relativePath ? "bg-primary/10 text-primary" : "hover:bg-muted",
                        )}
                      >
                        <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{doc.name}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">无法加载知识库目录</div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}
