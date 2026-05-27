"use client"

import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ChevronsUpDown,
  BrainCircuit,
  ChevronRight,
  Clock,
  Download,
  FileArchive,
  FileCode,
  File,
  Folder,
  FileImage,
  FileJson,
  FileSpreadsheet,
  Eye,
  FileText,
  FolderOpen,
  FolderPlus,
  History,
  LayoutGrid,
  LayoutList,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  MoreHorizontal,
  Maximize2,
  Minimize2,
  MoveRight,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  Square,
  Trash2,
  Upload,
  Hand,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { authService, type User } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import ReactECharts from "echarts-for-react"

function GraphToolbar({
  onZoomOut, onReset, onZoomIn, panMode, onPanToggle,
}: {
  onZoomOut: () => void
  onReset: () => void
  onZoomIn: () => void
  panMode: boolean
  onPanToggle: () => void
}) {
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center rounded-md border overflow-hidden">
        <button
          className="px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors border-r"
          title="缩小"
          onClick={onZoomOut}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <button
          className="px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors border-r"
          title="重置缩放"
          onClick={onReset}
        >
          <RotateCcw className="h-3 w-3" />
        </button>
        <button
          className="px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title="放大"
          onClick={onZoomIn}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        className={cn(
          "flex items-center justify-center rounded-md border px-2 py-1 transition-colors",
          panMode
            ? "border-primary bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        title={panMode ? "退出拖拽模式" : "拖拽平移模式"}
        onClick={onPanToggle}
      >
        <Hand className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

type DocumentNode = {
  name: string
  relativePath: string
  extension: string
  size: number
  updatedAt: string
  ownerId: string | null
  ownerName: string
  uploadedAt: string | null
  canPreview: boolean
  canChat: boolean
  canDelete: boolean
}

type FolderNode = {
  name: string
  relativePath: string
  size: number
  ownerId: string | null
  ownerName: string
  uploadedAt: string | null
  canDelete: boolean
  folders: FolderNode[]
  documents: DocumentNode[]
}

type ChatMessage = {
  role: "user" | "assistant"
  content: string
  sources?: string[]
}

type ExplorerEntry =
  | {
      kind: "folder"
      key: string
      name: string
      relativePath: string
      updatedAt: string | null
      typeLabel: string
      ownerName: string
      folder: FolderNode
    }
  | {
      kind: "file"
      key: string
      name: string
      relativePath: string
      updatedAt: string
      typeLabel: string
      ownerName: string
      document: DocumentNode
    }

type KnowledgeBasePageProps = {
  backHref: string
  backLabel: string
  variant?: "cyber" | "traditional"
}

const TEXT_PREVIEW_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".log", ".tsv", ".xml", ".doc", ".docx", ".xls", ".xlsx"])
const IMAGE_PREVIEW_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"])
const FRAME_PREVIEW_EXTENSIONS = new Set([".html", ".htm", ".pdf"])
const CHAT_SUPPORTED_EXTENSIONS = new Set([...TEXT_PREVIEW_EXTENSIONS, ".html", ".htm", ".pdf"])

type KnowledgeBaseUploadResponse = {
  ok: boolean
  error?: string
  file?: DocumentNode
  files?: DocumentNode[]
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatDateTime(value: string | null) {
  if (!value) return "-"

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return date.toLocaleString()
}

function formatDocumentType(extension: string) {
  if (!extension) return "文件"
  return `${extension.replace(/^\./, "").toUpperCase()} 文件`
}

function truncateMiddle(value: string, maxLength = 44) {
  if (value.length <= maxLength) {
    return value
  }

  const visible = maxLength - 3
  const start = Math.ceil(visible * 0.55)
  const end = Math.floor(visible * 0.45)
  return `${value.slice(0, start)}...${value.slice(-end)}`
}

function getExplorerFileIcon(extension: string) {
  const normalized = extension.toLowerCase()

  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"].includes(normalized)) {
    return { icon: FileImage, className: "bg-emerald-500/15 text-emerald-400" }
  }

  if ([".xls", ".xlsx", ".csv", ".tsv"].includes(normalized)) {
    return { icon: FileSpreadsheet, className: "bg-green-500/15 text-green-400" }
  }

  if ([".json"].includes(normalized)) {
    return { icon: FileJson, className: "bg-amber-500/15 text-amber-400" }
  }

  if ([".ts", ".tsx", ".js", ".jsx", ".html", ".htm", ".xml", ".md", ".markdown"].includes(normalized)) {
    return { icon: FileCode, className: "bg-sky-500/15 text-sky-400" }
  }

  if ([".zip", ".rar", ".7z"].includes(normalized)) {
    return { icon: FileArchive, className: "bg-violet-500/15 text-violet-400" }
  }

  if ([".pdf", ".doc", ".docx", ".txt", ".log"].includes(normalized)) {
    return { icon: FileText, className: "bg-rose-500/15 text-rose-400" }
  }

  return { icon: File, className: "bg-slate-500/15 text-slate-300" }
}

function collectDocumentsInFolder(folder: FolderNode | null): DocumentNode[] {
  if (!folder) return []
  return [...folder.documents, ...folder.folders.flatMap((f) => collectDocumentsInFolder(f))]
}

// Sanitize a single path segment for the File System Access API.
// Handles Windows-forbidden chars, control characters (incl. DEL + C1 range),
// zero-width / invisible Unicode, reserved device names, and leading/trailing
// dots or spaces that Windows rejects.
function sanitizeFSName(name: string): string {
  let s = name
    // Windows-forbidden ASCII chars, plus all C0 control chars (0x00-0x1F)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    // DEL (0x7F) and C1 control range (0x80-0x9F)
    .replace(/[\x7f-\x9f]/g, "_")
    // Zero-width and invisible Unicode (BOM, ZWNJ, ZWJ, zero-width-space, etc.)
    .replace(/[\u200b-\u200d\u2028\u2029\u202a-\u202e\ufeff\u2060]/g, "")
    // Trailing dots or spaces (Windows rejects these)
    .replace(/[. ]+$/, "")
    // Leading dots or spaces (Windows may reject; also avoids hidden-file confusion)
    .replace(/^[. ]+/, "")
    .trim()
  // Explicit dot-only names
  if (s === "." || s === "..") s = "_"
  // Windows reserved device names
  const RESERVED = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\..*)?$/i
  if (!s || RESERVED.test(s)) s = `_${s}`
  return s
}

function flattenFolders(node: FolderNode): Array<{ label: string; value: string }> {
  const items = [{ label: "全部资料", value: "" }]

  function walk(folder: FolderNode) {
    for (const child of folder.folders) {
      items.push({ label: child.relativePath, value: child.relativePath })
      walk(child)
    }
  }

  walk(node)
  return items
}

function buildFileUrl(relativePath: string, download = false) {
  const params = new URLSearchParams({ path: relativePath })
  if (download) {
    params.set("download", "1")
  }
  return `/api/knowledge-base/file?${params.toString()}`
}

function buildPreviewUrl(relativePath: string) {
  const params = new URLSearchParams({ path: relativePath, preview: "1" })
  return `/api/knowledge-base/file?${params.toString()}`
}

function countDocuments(node: FolderNode | null): number {
  if (!node) return 0
  return node.documents.length + node.folders.reduce((total, folder) => total + countDocuments(folder), 0)
}

function getFolderTotalSize(folder: FolderNode): number {
  const directFileSize = folder.documents.reduce((total, document) => total + (Number.isFinite(document.size) ? document.size : 0), 0)
  return directFileSize + folder.folders.reduce((total, child) => total + getFolderTotalSize(child), 0)
}

function getFolderOwnerInfo(folder: FolderNode): { ownerName: string; uploadedAt: string | null } {
  if (folder.ownerName && folder.ownerName !== "-" && folder.ownerName !== "未知") {
    return { ownerName: folder.ownerName, uploadedAt: folder.uploadedAt }
  }

  let fallbackOwnerName = "-"
  let fallbackUploadedAt: string | null = null

  const considerCandidate = (ownerName: string, uploadedAt: string | null) => {
    if (!uploadedAt || !ownerName || ownerName === "-" || ownerName === "未知") {
      return
    }

    if (!fallbackUploadedAt) {
      fallbackOwnerName = ownerName
      fallbackUploadedAt = uploadedAt
      return
    }

    const currentTime = new Date(fallbackUploadedAt).getTime()
    const nextTime = new Date(uploadedAt).getTime()
    if (!Number.isNaN(nextTime) && (Number.isNaN(currentTime) || nextTime < currentTime)) {
      fallbackOwnerName = ownerName
      fallbackUploadedAt = uploadedAt
    }
  }

  for (const document of folder.documents) {
    considerCandidate(document.ownerName, document.uploadedAt)
  }

  for (const child of folder.folders) {
    const childOwner = getFolderOwnerInfo(child)
    considerCandidate(childOwner.ownerName, childOwner.uploadedAt)
  }

  return { ownerName: fallbackOwnerName, uploadedAt: fallbackUploadedAt }
}

function findFolderByPath(node: FolderNode | null, relativePath: string): FolderNode | null {
  if (!node) return null
  if (!relativePath) return node
  if (node.relativePath === relativePath) return node

  for (const child of node.folders) {
    const found = findFolderByPath(child, relativePath)
    if (found) return found
  }

  return null
}

function getFolderModifiedAt(folder: FolderNode): string | null {
  let latestTime = 0

  for (const document of folder.documents) {
    const timestamp = new Date(document.updatedAt).getTime()
    if (!Number.isNaN(timestamp)) {
      latestTime = Math.max(latestTime, timestamp)
    }
  }

  for (const child of folder.folders) {
    const childUpdatedAt = getFolderModifiedAt(child)
    if (!childUpdatedAt) continue
    const timestamp = new Date(childUpdatedAt).getTime()
    if (!Number.isNaN(timestamp)) {
      latestTime = Math.max(latestTime, timestamp)
    }
  }

  return latestTime ? new Date(latestTime).toISOString() : null
}

function getResponseErrorText(text: string, fallback: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return fallback
  }

  if (trimmed.startsWith("<")) {
    const htmlMessage = trimmed
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()

    return htmlMessage || fallback
  }

  return trimmed
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!text.trim()) {
    return {} as T
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(getResponseErrorText(text, response.statusText || "服务器返回了非 JSON 响应"))
  }
}

// ── Server folder browser tree (used inside the Dialog popup) ───────────────
function ServerFolderBrowserTree({
  node,
  depth,
  selectedPath,
  onSelect,
  expanded,
  onToggle,
}: {
  node: FolderNode
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  expanded: Set<string>
  onToggle: (path: string) => void
}) {
  const isExpanded = expanded.has(node.relativePath)
  const isSelected = selectedPath === node.relativePath
  const displayName = node.relativePath === "" ? "全部资料" : node.name
  return (
    <div>
      <div
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm select-none hover:bg-accent",
          isSelected && "bg-accent font-medium",
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(node.relativePath)}
      >
        <button
          className="flex h-4 w-4 shrink-0 items-center justify-center"
          onClick={(e) => {
            e.stopPropagation()
            if (node.folders.length > 0) onToggle(node.relativePath)
          }}
        >
          {node.folders.length > 0
            ? (isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)
            : null}
        </button>
        {isExpanded
          ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
          : <Folder className="h-4 w-4 shrink-0 text-amber-500" />}
        <span className="truncate">{displayName}</span>
      </div>
      {isExpanded && node.folders.map((child) => (
        <ServerFolderBrowserTree
          key={child.relativePath}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

export function KnowledgeBasePage({ backHref, backLabel, variant = "cyber" }: KnowledgeBasePageProps) {
  const router = useRouter()
  const traditionalChatScrollRef = useRef<HTMLDivElement | null>(null)
  const traditionalOperationsScrollRef = useRef<HTMLDivElement | null>(null)
  const traditionalPreviewRef = useRef<HTMLDivElement | null>(null)
  const traditionalPreviewHeaderRef = useRef<HTMLDivElement | null>(null)
  const cyberPreviewHeaderRef = useRef<HTMLDivElement | null>(null)
  const shouldScrollToPreviewRef = useRef(false)
  const singleUploadInputRef = useRef<HTMLInputElement | null>(null)
  const batchUploadInputRef = useRef<HTMLInputElement | null>(null)
  const syncFolderInputRef = useRef<HTMLInputElement | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tree, setTree] = useState<FolderNode | null>(null)
  const [storageRoot, setStorageRoot] = useState("")
  const [selectedFolder, setSelectedFolder] = useState("")
  const [selectedDocument, setSelectedDocument] = useState<DocumentNode | null>(null)
  const [previewMode, setPreviewMode] = useState<"empty" | "text" | "html" | "image" | "frame">("empty")
  const [previewContent, setPreviewContent] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploadTargetFolder, setUploadTargetFolder] = useState<string | null>(null)
  const [uploadFolderBrowsePath, setUploadFolderBrowsePath] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)
  const [batchUploading, setBatchUploading] = useState(false)
  const [batchUploadProgress, setBatchUploadProgress] = useState(0)
  const [batchUploadSummary, setBatchUploadSummary] = useState("")
  const [deletingPath, setDeletingPath] = useState<string | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  type ExplorerSortKey = "name" | "updatedAt" | "typeLabel" | "size" | "ownerName"
  const [explorerSort, setExplorerSort] = useState<{ key: ExplorerSortKey; dir: "asc" | "desc" }>({ key: "updatedAt", dir: "desc" })
  const [uploading, setUploading] = useState(false)
  const [question, setQuestion] = useState("")
  const [chatLoading, setChatLoading] = useState(false)
  const [chatElapsed, setChatElapsed] = useState(0)
  const [chatPhase, setChatPhase] = useState<"searching" | "generating" | null>(null)
  const chatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const userScrolledRef = useRef(false)
  const [previewScrollToken, setPreviewScrollToken] = useState(0)
  const [selectedExplorerEntry, setSelectedExplorerEntry] = useState<{ kind: "folder" | "file"; relativePath: string } | null>(null)
  const [traditionalPanel, setTraditionalPanel] = useState<"library" | "preview" | "upload" | "folder" | "sync" | "graph">("library")
  const [graphVizData, setGraphVizData] = useState<{ nodes: Array<{ id: string; name: string; category: "document" | "term"; value: number }>; links: Array<{ source: string; target: string; value: number }> } | null>(null)
  const [graphVizLoading, setGraphVizLoading] = useState(false)
  const [graphVizError, setGraphVizError] = useState<string | null>(null)
  const [graphVizFullscreen, setGraphVizFullscreen] = useState(false)
  const [graphVizLLMData, setGraphVizLLMData] = useState<{
    nodes: Array<{ id: string; name: string; category: "document" | "company" | "product" | "strategy" | "person"; value: number; detail?: string }>
    links: Array<{ source: string; target: string; relation: string }>
  } | null>(null)
  const [graphVizLLMLoading, setGraphVizLLMLoading] = useState(false)
  const [graphVizLLMError, setGraphVizLLMError] = useState<string | null>(null)
  const [graphMode, setGraphMode] = useState<"regex" | "llm">("regex")
  const [graphPanMode, setGraphPanMode] = useState(false)
  const graphRegexChartRef = useRef<ReactECharts>(null)
  const graphLLMChartRef = useRef<ReactECharts>(null)
  const graphRegexFsChartRef = useRef<ReactECharts>(null)
  const graphLLMFsChartRef = useRef<ReactECharts>(null)
  const [syncServerFolder, setSyncServerFolder] = useState<string | null>(null)
  const [syncLocalDirHandle, setSyncLocalDirHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [syncLocalDirName, setSyncLocalDirName] = useState<string>("")
  // Flat file list collected from <input webkitdirectory> fallback (when showDirectoryPicker unavailable over HTTP)
  const [syncWebkitFiles, setSyncWebkitFiles] = useState<Array<{ relPath: string; file: File }> | null>(null)
  const [showServerBrowser, setShowServerBrowser] = useState(false)
  const [syncBrowserSelectedFolder, setSyncBrowserSelectedFolder] = useState<string | null>(null)
  const [serverBrowserExpanded, setServerBrowserExpanded] = useState<Set<string>>(() => new Set([""]))
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
  const [syncSummary, setSyncSummary] = useState("")
  const [syncPreviewItems, setSyncPreviewItems] = useState<Array<{ relPath: string; status: "new" | "changed" | "same"; localSize: number; serverSize: number | null }> | null>(null)
  const [syncPendingFiles, setSyncPendingFiles] = useState<Array<{ file: File; strippedPath: string }> | null>(null)
  const [syncLocalDirUpdatedAt, setSyncLocalDirUpdatedAt] = useState<Date | null>(null)
  const [syncComparing, setSyncComparing] = useState(false)
  const syncCompareSeqRef = useRef(0)
  const [explorerView, setExplorerView] = useState<"list" | "icon">("list")

  // ── Embed job tracking ──────────────────────────────────────────────────────
  type EmbedJobStatus = {
    scope: string; status: "queued" | "running" | "done" | "error"
    totalFiles: number; processedFiles: number; currentFile: string; message: string
    startedAt: number; finishedAt?: number
  }
  const [embedJob, setEmbedJob] = useState<EmbedJobStatus | null>(null)
  const embedPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function startEmbedTracking(scope: string) {
    if (embedPollRef.current) clearInterval(embedPollRef.current)
    setEmbedJob({ scope, status: "queued", totalFiles: 0, processedFiles: 0, currentFile: "", message: "准备向量化...", startedAt: Date.now() })
    embedPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/knowledge-base/embed-status?scope=${encodeURIComponent(scope)}`, { headers: getKnowledgeBaseAuthHeaders() })
        if (!res.ok) return
        const data: EmbedJobStatus | null = await res.json()
        if (!data) {
          // Job no longer tracked — it completed and was cleaned up
          clearInterval(embedPollRef.current!)
          setEmbedJob(null)
          return
        }
        setEmbedJob(data)
        if (data.status === "done" || data.status === "error") {
          clearInterval(embedPollRef.current!)
          setTimeout(() => setEmbedJob(null), 5_000)
        }
      } catch {
        // network hiccup — keep polling
      }
    }, 1200)
  }
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "选择左侧文件夹后即可上传资料、预览文档，并针对当前文件夹或全部资料提问。",
    },
  ])
  const [error, setError] = useState<string | null>(null)

  // ── Conversation history state ──────────────────────────────────────────────
  type ConversationSummary = { id: string; title: string; scope: string; scopeType: "folder" | "file"; updatedAt: string }
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [showConvSidebar, setShowConvSidebar] = useState(false)
  const [showSettingsSidebar, setShowSettingsSidebar] = useState(false)
  const [useBm25, setUseBm25] = useState(false)
  const [useGraphRag, setUseGraphRag] = useState(false)
  const [queryMode, setQueryMode] = useState<"superfast" | "accurate" | "deep" | "thinking">("superfast")
  const abortControllerRef = useRef<AbortController | null>(null)
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  useEffect(() => {
    authService.init()
    const currentUser = authService.getCurrentUser()
    if (!currentUser) {
      router.replace("/login")
      return
    }

    setCurrentUser(currentUser)
    setAuthorized(true)
    void refreshTree(true, currentUser)
  }, [router])

  useEffect(() => {
    if (variant !== "traditional" || userScrolledRef.current) {
      return
    }

    const frame = requestAnimationFrame(() => {
      const chatContainer = traditionalChatScrollRef.current
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight
      }
    })

    return () => cancelAnimationFrame(frame)
  }, [chatLoading, chatMessages, variant])

  useEffect(() => {
    if (variant !== "traditional" || traditionalPanel !== "preview" || !shouldScrollToPreviewRef.current || previewScrollToken === 0) {
      return
    }

    // Header/stats/menu are hidden in preview mode, so just reset scroll to top
    const timer = window.setTimeout(() => {
      const scrollContainer = traditionalOperationsScrollRef.current
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: 0 })
      }
      shouldScrollToPreviewRef.current = false
    }, 50)

    return () => window.clearTimeout(timer)
  }, [previewScrollToken, traditionalPanel, variant])

  useEffect(() => {
    if (variant !== "cyber" || !shouldScrollToPreviewRef.current || previewScrollToken === 0) {
      return
    }

    const timer = window.setTimeout(() => {
      const previewHeader = cyberPreviewHeaderRef.current
      if (previewHeader) {
        const rect = previewHeader.getBoundingClientRect()
        const scrollTarget = window.scrollY + rect.top - 8
        window.scrollTo({ top: Math.max(0, scrollTarget), behavior: "smooth" })
      }

      shouldScrollToPreviewRef.current = false
    }, 80)

    return () => window.clearTimeout(timer)
  }, [previewScrollToken, variant])

  function getKnowledgeBaseAuthHeaders(user: User | null = currentUser) {
    const resolvedUser = user ?? authService.getCurrentUser()
    if (!resolvedUser?.id) {
      return undefined
    }

    return {
      "x-market-user-id": resolvedUser.id,
    }
  }

  function uploadKnowledgeBaseFormDataWithProgress(
    form: FormData,
    onProgress?: (loaded: number) => void,
  ): Promise<KnowledgeBaseUploadResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open("POST", "/api/knowledge-base/upload")
      xhr.responseType = "text"
      xhr.setRequestHeader("Accept", "application/json")

      const authHeaders = getKnowledgeBaseAuthHeaders()
      if (authHeaders) {
        for (const [key, value] of Object.entries(authHeaders)) {
          xhr.setRequestHeader(key, value)
        }
      }

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress?.(event.loaded)
        }
      }

      xhr.onerror = () => reject(new Error("上传请求失败，请检查网络连接或稍后重试"))

      xhr.onload = () => {
        const responseText = typeof xhr.responseText === "string" ? xhr.responseText : ""
        let parsed: KnowledgeBaseUploadResponse | null = null

        if (responseText.trim()) {
          try {
            parsed = JSON.parse(responseText) as KnowledgeBaseUploadResponse
          } catch {
            reject(new Error(getResponseErrorText(responseText, xhr.statusText || "上传失败")))
            return
          }
        }

        if (xhr.status >= 200 && xhr.status < 300 && parsed?.ok) {
          resolve(parsed)
          return
        }

        reject(new Error(parsed?.error || xhr.statusText || "上传失败"))
      }

      xhr.send(form)
    })
  }

  async function refreshTree(initial = false, user: User | null = currentUser) {
    try {
      setError(null)
      if (initial) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      const res = await fetch("/api/knowledge-base/tree", {
        cache: "no-store",
        headers: getKnowledgeBaseAuthHeaders(user),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || res.statusText)
      }

      setTree(data.tree)
      setStorageRoot(data.rootPath || "")
    } catch (requestError: any) {
      setError(requestError?.message || String(requestError))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const folderOptions = useMemo(() => (tree ? flattenFolders(tree) : [{ label: "全部资料", value: "" }]), [tree])
  const totalDocuments = useMemo(() => countDocuments(tree), [tree])
  const currentFolderNode = useMemo(() => findFolderByPath(tree, selectedFolder), [selectedFolder, tree])
  const syncServerFiles = useMemo(() => {
    if (syncServerFolder === null) return []
    return collectDocumentsInFolder(findFolderByPath(tree, syncServerFolder)).map((sf) => ({
      relPath: sf.relativePath.startsWith(syncServerFolder + "/")
        ? sf.relativePath.slice(syncServerFolder.length + 1)
        : sf.relativePath,
      size: sf.size,
      relativePath: sf.relativePath,
    }))
  }, [syncServerFolder, tree])
  const currentFolderStats = useMemo(() => {
    if (!currentFolderNode) {
      return { folders: 0, files: 0 }
    }

    return {
      folders: currentFolderNode.folders.length,
      files: currentFolderNode.documents.length,
    }
  }, [currentFolderNode])
  const currentFolderSummary = useMemo(() => {
    const parts: string[] = []
    if (currentFolderStats.folders > 0) {
      parts.push(`${currentFolderStats.folders} 个文件夹`)
    }
    if (currentFolderStats.files > 0) {
      parts.push(`${currentFolderStats.files} 个文件`)
    }
    return parts.length > 0 ? parts.join("，") : "当前文件夹为空"
  }, [currentFolderStats])
  const explorerEntries = useMemo<ExplorerEntry[]>(() => {
    if (!currentFolderNode) {
      return []
    }

    const folderEntries: ExplorerEntry[] = [...currentFolderNode.folders]
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
      .map((folder) => {
        const folderOwner = getFolderOwnerInfo(folder)
        return {
          kind: "folder" as const,
          key: `folder:${folder.relativePath}`,
          name: folder.name,
          relativePath: folder.relativePath,
          updatedAt: getFolderModifiedAt(folder),
          typeLabel: "文件夹",
          ownerName: folderOwner.ownerName,
          folder,
        }
      })

    const documentEntries: ExplorerEntry[] = [...currentFolderNode.documents]
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
      .map((document) => ({
        kind: "file",
        key: `file:${document.relativePath}`,
        name: document.name,
        relativePath: document.relativePath,
        updatedAt: document.updatedAt,
        typeLabel: formatDocumentType(document.extension),
        ownerName: document.ownerName || "未知",
        document,
      }))

    return [...folderEntries, ...documentEntries]
  }, [currentFolderNode])
  const sortedExplorerEntries = useMemo(() => {
    const getVal = (entry: ExplorerEntry): string | number => {
      switch (explorerSort.key) {
        case "name": return entry.name.toLowerCase()
        case "updatedAt": return entry.updatedAt ?? ""
        case "typeLabel": return entry.typeLabel
        case "size": return entry.kind === "file" ? entry.document.size : getFolderTotalSize(entry.folder)
        case "ownerName": return entry.ownerName.toLowerCase()
      }
    }
    return [...explorerEntries].sort((a, b) => {
      const av = getVal(a)
      const bv = getVal(b)
      let cmp: number
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv
      } else {
        cmp = String(av).localeCompare(String(bv), "zh-CN")
      }
      return explorerSort.dir === "asc" ? cmp : -cmp
    })
  }, [explorerEntries, explorerSort])
  const activeExplorerEntry = useMemo(
    () =>
      selectedExplorerEntry
        ? explorerEntries.find(
            (entry) => entry.kind === selectedExplorerEntry.kind && entry.relativePath === selectedExplorerEntry.relativePath,
          ) || null
        : null,
    [explorerEntries, selectedExplorerEntry],
  )
  const parentFolderPath = useMemo(() => {
    if (!selectedFolder) return null
    const segments = selectedFolder.split("/")
    segments.pop()
    return segments.join("/")
  }, [selectedFolder])
  const folderBreadcrumbs = useMemo(() => {
    const segments = selectedFolder ? selectedFolder.split("/") : []
    return [{ label: "全部资料", value: "" }, ...segments.map((_, index) => ({ label: segments[index], value: segments.slice(0, index + 1).join("/") }))]
  }, [selectedFolder])

  useEffect(() => {
    if (!activeExplorerEntry && selectedExplorerEntry) {
      setSelectedExplorerEntry(null)
    }
  }, [activeExplorerEntry, selectedExplorerEntry])

  useEffect(() => {
    if (currentUser) void loadConversations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser])

  async function handleCreateFolder() {
    const trimmed = newFolderName.trim()
    if (!trimmed) return

    const fullPath = selectedFolder ? `${selectedFolder}/${trimmed}` : trimmed
    try {
      setError(null)
      const res = await fetch("/api/knowledge-base/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getKnowledgeBaseAuthHeaders(),
        },
        body: JSON.stringify({ path: fullPath }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || res.statusText)
      }

      setNewFolderName("")
      await refreshTree()
      setSelectedFolder(fullPath)
    } catch (requestError: any) {
      setError(requestError?.message || String(requestError))
    }
  }

  async function handleCreateFolderInline(parentPath: string) {
    const name = window.prompt(`在「${parentPath || "根目录"}」下新建文件夹：`, "新建文件夹")
    if (!name || !name.trim()) return
    const trimmed = name.trim()
    const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed
    try {
      setError(null)
      const res = await fetch("/api/knowledge-base/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getKnowledgeBaseAuthHeaders() },
        body: JSON.stringify({ path: fullPath }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) throw new Error(data?.error || res.statusText)
      await refreshTree()
    } catch (err: any) {
      setError(err?.message || String(err))
    }
  }

  async function handleUpload() {
    if (!pendingFile) return
    if (uploadTargetFolder === null) {
      setError("请先选择目标目录")
      return
    }

    try {
      setUploading(true)
      setError(null)
      const form = new FormData()
      form.append("file", pendingFile)
      form.append("folderPath", uploadTargetFolder)

      const res = await fetch("/api/knowledge-base/upload", {
        method: "POST",
        headers: getKnowledgeBaseAuthHeaders(),
        body: form,
      })
      const data = await readJsonResponse<KnowledgeBaseUploadResponse>(res)
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || res.statusText)
      }

      const uploadedScope = uploadTargetFolder ?? ""
      setPendingFile(null)
      if (singleUploadInputRef.current) {
        singleUploadInputRef.current.value = ""
      }
      setUploadTargetFolder(null)
      setUploadFolderBrowsePath("")
      await refreshTree()
      // Start tracked background embedding
      startEmbedTracking(uploadedScope)
    } catch (requestError: any) {
      setError(requestError?.message || String(requestError))
    } finally {
      setUploading(false)
    }
  }

  async function handleBatchUpload(files: FileList | File[], targetFolder?: string) {
    const resolvedTarget = targetFolder ?? (uploadTargetFolder ?? null)
    if (resolvedTarget === null) {
      setError("请先选择目标目录")
      return
    }
    const entries = Array.from(files)
      .map((file) => {
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
        return { file, relativePath }
      })
      .filter((entry) => entry.file.size > 0 || entry.relativePath)

    if (!entries.length) {
      return
    }

    try {
      setBatchUploading(true)
      setBatchUploadProgress(0)
      setBatchUploadSummary(`准备上传 ${entries.length} 个文件`)
      setError(null)

      const totalBytes = entries.reduce((sum, entry) => sum + Math.max(entry.file.size, 1), 0)
      let uploadedBytes = 0

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index]
        const form = new FormData()
        form.append("folderPath", resolvedTarget)
        form.append("files", entry.file)
        form.append("relativePaths", entry.relativePath)

        setBatchUploadSummary(`正在上传 ${index + 1}/${entries.length}: ${entry.relativePath}`)

        await uploadKnowledgeBaseFormDataWithProgress(form, (loaded) => {
          const currentLoaded = uploadedBytes + Math.min(loaded, Math.max(entry.file.size, 1))
          setBatchUploadProgress(Math.min(100, Math.round((currentLoaded / totalBytes) * 100)))
        })

        uploadedBytes += Math.max(entry.file.size, 1)
        setBatchUploadProgress(Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)))
      }

      setBatchUploadSummary(`已完成上传 ${entries.length} 个文件`)
      await refreshTree()
      // Start tracked background embedding
      startEmbedTracking(resolvedTarget)
    } catch (requestError: any) {
      setError(requestError?.message || String(requestError))
    } finally {
      setBatchUploading(false)
      setTimeout(() => {
        setBatchUploadProgress(0)
        setBatchUploadSummary("")
      }, 1200)
      if (batchUploadInputRef.current) {
        batchUploadInputRef.current.value = ""
      }
    }
  }

  function handleBatchUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files
    if (!files?.length) {
      return
    }

    void handleBatchUpload(files)
  }

  async function handlePickLocalFolder() {
    const fsApi = (window as unknown as { showDirectoryPicker?: (opts?: Record<string, unknown>) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
    if (fsApi) {
      // Preferred path: File System Access API (requires HTTPS or localhost)
      try {
        const handle = await fsApi({ mode: "readwrite" })
        setSyncLocalDirHandle(handle)
        setSyncWebkitFiles(null)
        setSyncLocalDirName(handle.name)
        setSyncPreviewItems(null)
        setSyncPendingFiles(null)
        setSyncLocalDirUpdatedAt(new Date())
        // Auto-compare (fire-and-forget so state updates render immediately)
        if (syncServerFolder !== null) {
          void handleCompare(handle, null)
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") setError(err?.message || String(err))
      }
    } else {
      // Fallback: <input webkitdirectory> — works over plain HTTP in all modern browsers
      syncFolderInputRef.current?.click()
    }
  }

  function handleSyncFolderInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    const collected: Array<{ relPath: string; file: File }> = []
    let folderName = ""
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const webkitPath: string = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      // webkitRelativePath = "FolderName/sub/file.txt" — strip the root folder segment
      const parts = webkitPath.split("/")
      if (!folderName && parts.length > 1) folderName = parts[0]
      const relPath = parts.length > 1 ? parts.slice(1).join("/") : parts[0]
      if (relPath && !relPath.startsWith("~") && file.size > 0) {
        collected.push({ relPath, file })
      }
    }
    // Even if 0 files (empty folder), register the selection so ②③ appear
    setSyncWebkitFiles(collected)
    setSyncLocalDirHandle(null)
    setSyncLocalDirName(folderName || "本地文件夹")
    setSyncPreviewItems(null)
    setSyncPendingFiles(null)
    setSyncLocalDirUpdatedAt(new Date())
    // Reset input so same folder can be re-selected
    if (syncFolderInputRef.current) syncFolderInputRef.current.value = ""
    // Auto-compare if server folder already selected
    if (syncServerFolder !== null) {
      void handleCompare(null, collected)
    }
  }

  async function collectLocalFiles(
    dirHandle: FileSystemDirectoryHandle,
    prefix = ""
  ): Promise<Array<{ relPath: string; file: File }>> {
    const results: Array<{ relPath: string; file: File }> = []
    const dir = dirHandle as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
    for await (const [name, handle] of dir.entries()) {
      if ((name as string).startsWith("~")) continue
      if (handle.kind === "file") {
        const file = await (handle as FileSystemFileHandle).getFile()
        if (file.size > 0) results.push({ relPath: prefix ? `${prefix}/${name}` : name, file })
      } else if (handle.kind === "directory") {
        const sub = await collectLocalFiles(handle as FileSystemDirectoryHandle, prefix ? `${prefix}/${name}` : name)
        results.push(...sub)
      }
    }
    return results
  }

  async function handleCompare(
    overrideDirHandle?: FileSystemDirectoryHandle | null,
    overrideWebkitFiles?: Array<{ relPath: string; file: File }> | null,
  ) {
    const activeDirHandle = overrideDirHandle !== undefined ? overrideDirHandle : syncLocalDirHandle
    const activeWebkitFiles = overrideWebkitFiles !== undefined ? overrideWebkitFiles : syncWebkitFiles
    const hasLocal = activeDirHandle !== null || activeWebkitFiles !== null
    if (!hasLocal || syncServerFolder === null) return
    const seq = ++syncCompareSeqRef.current
    try {
      setError(null)
      setSyncComparing(true)
      setSyncPreviewItems(null)
      setSyncPendingFiles(null)
      const localFiles = activeWebkitFiles ?? await collectLocalFiles(activeDirHandle!)
      if (seq !== syncCompareSeqRef.current) return // stale compare — a newer one superseded us
      const serverFileMap = new Map<string, number>(syncServerFiles.map((sf) => [sf.relPath, sf.size]))
      const preview: Array<{ relPath: string; status: "new" | "changed" | "same"; localSize: number; serverSize: number | null }> = []
      const pending: Array<{ file: File; strippedPath: string }> = []
      for (const { relPath, file } of localFiles) {
        const serverSize = serverFileMap.has(relPath) ? serverFileMap.get(relPath)! : null
        const status = serverSize === null ? "new" : serverSize !== file.size ? "changed" : "same"
        preview.push({ relPath, status, localSize: file.size, serverSize })
        if (status !== "same") pending.push({ file, strippedPath: relPath })
      }
      if (seq !== syncCompareSeqRef.current) return
      setSyncPreviewItems(preview)
      setSyncPendingFiles(pending)
    } catch (err: any) {
      if (seq === syncCompareSeqRef.current) setError(err?.message || String(err))
    } finally {
      if (seq === syncCompareSeqRef.current) setSyncComparing(false)
    }
  }

  async function handleConfirmSyncToServer() {
    if (!syncPendingFiles?.length || syncServerFolder === null) return
    try {
      setSyncing(true)
      setSyncProgress(0)
      setSyncSummary(`准备上传 ${syncPendingFiles.length} 个文件（新增或已变更）`)
      setError(null)

      const totalBytes = syncPendingFiles.reduce((sum, e) => sum + Math.max(e.file.size, 1), 0)
      let uploadedBytes = 0

      for (let i = 0; i < syncPendingFiles.length; i++) {
        const { file, strippedPath } = syncPendingFiles[i]
        const form = new FormData()
        form.append("folderPath", syncServerFolder)
        form.append("files", file)
        form.append("relativePaths", strippedPath)
        setSyncSummary(`正在上传 ${i + 1}/${syncPendingFiles.length}: ${strippedPath}`)
        await uploadKnowledgeBaseFormDataWithProgress(form, (loaded) => {
          const current = uploadedBytes + Math.min(loaded, Math.max(file.size, 1))
          setSyncProgress(Math.min(100, Math.round((current / totalBytes) * 100)))
        })
        uploadedBytes += Math.max(file.size, 1)
        setSyncProgress(Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)))
      }

      setSyncSummary(`已上传 ${syncPendingFiles.length} 个文件`)
      setSyncPreviewItems(null)
      setSyncPendingFiles(null)
      await refreshTree()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setSyncing(false)
      setTimeout(() => { setSyncProgress(0); setSyncSummary("") }, 2000)
    }
  }

  async function handleSyncToLocal() {
    if (syncServerFolder === null) {
      setError("请先选择服务器目录")
      return
    }

    const serverFiles = syncServerFiles
    if (!serverFiles.length) {
      setError("该目录下没有文件")
      return
    }

    // Filter out Office temp/lock files
    const downloadableFiles = serverFiles.filter((sf) => {
      const basename = sf.relPath.split("/").pop() ?? ""
      return !basename.startsWith("~$") && !basename.startsWith("~")
    })

    if (!downloadableFiles.length) {
      setError("没有可下载的文件")
      return
    }

    // ── Try File System Access API (available when showDirectoryPicker exists) ──
    let writableHandle = syncLocalDirHandle
    const fsApi = (window as unknown as { showDirectoryPicker?: (opts?: Record<string, unknown>) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker

    if (!writableHandle && fsApi) {
      try {
        writableHandle = await fsApi({ mode: "readwrite" })
        setSyncLocalDirHandle(writableHandle)
        setSyncWebkitFiles(null)
        setSyncLocalDirName(writableHandle.name)
        setSyncPreviewItems(null)
        setSyncPendingFiles(null)
      } catch (err: any) {
        if (err?.name !== "AbortError") setError(err?.message || String(err))
        return
      }
    }

    if (writableHandle) {
      // ── Preferred path: write directly into local folder ──
      const dirHandle = writableHandle as FileSystemDirectoryHandle
      const handleWithPerm = dirHandle as unknown as {
        queryPermission?: (opts: { mode: string }) => Promise<PermissionState>
        requestPermission?: (opts: { mode: string }) => Promise<PermissionState>
      }
      if (handleWithPerm.queryPermission) {
        const perm = await handleWithPerm.queryPermission({ mode: "readwrite" })
        if (perm !== "granted") {
          const granted = await handleWithPerm.requestPermission?.({ mode: "readwrite" })
          if (granted !== "granted") {
            setError("需要文件写入权限。请在浏览器弹出的对话框中点击「允许」，或点击①重新选择本地文件夹。")
            return
          }
        }
      }

      try {
        setSyncing(true)
        setSyncProgress(0)
        setError(null)
        setSyncSummary(`准备下载 ${downloadableFiles.length} 个文件`)

        for (let i = 0; i < downloadableFiles.length; i++) {
          const sf = downloadableFiles[i]
          setSyncSummary(`正在下载 ${i + 1}/${downloadableFiles.length}: ${sf.relPath}`)

          const response = await fetch(buildFileUrl(sf.relativePath))
          if (!response.ok) throw new Error(`下载失败: ${sf.relPath}`)
          const blob = await response.blob()

          const rawParts = sf.relPath.split("/").filter(Boolean)
          const parts = rawParts.map(sanitizeFSName).filter(Boolean)
          if (!parts.length) continue
          let currentDir: FileSystemDirectoryHandle = dirHandle
          for (let p = 0; p < parts.length - 1; p++) {
            try {
              currentDir = await currentDir.getDirectoryHandle(parts[p], { create: true })
            } catch (dirErr: any) {
              throw new Error(`无效的目录名 "${rawParts[p]}" → "${parts[p]}": ${dirErr?.message ?? dirErr}`)
            }
          }
          const fileName = parts[parts.length - 1]
          let fh: FileSystemFileHandle
          try {
            fh = await currentDir.getFileHandle(fileName, { create: true })
          } catch (fileErr: any) {
            throw new Error(`无效的文件名 "${rawParts[rawParts.length - 1]}" → "${fileName}": ${fileErr?.message ?? fileErr}`)
          }
          const writable = await fh.createWritable()
          await writable.write(blob)
          await writable.close()

          setSyncProgress(Math.round(((i + 1) / downloadableFiles.length) * 100))
        }

        setSyncSummary(`已下载 ${downloadableFiles.length} 个文件到本地文件夹`)
      } catch (err: any) {
        setError(err?.message || String(err))
      } finally {
        setSyncing(false)
        setTimeout(() => { setSyncProgress(0); setSyncSummary("") }, 2000)
      }
    } else {
      // ── Fallback: trigger individual browser downloads (works on any context) ──
      try {
        setSyncing(true)
        setSyncProgress(0)
        setError(null)
        setSyncSummary(`准备下载 ${downloadableFiles.length} 个文件到浏览器下载目录`)

        for (let i = 0; i < downloadableFiles.length; i++) {
          const sf = downloadableFiles[i]
          setSyncSummary(`正在下载 ${i + 1}/${downloadableFiles.length}: ${sf.relPath}`)

          const response = await fetch(buildFileUrl(sf.relativePath, true))
          if (!response.ok) throw new Error(`下载失败: ${sf.relPath}`)
          const blob = await response.blob()

          const fileName = sf.relPath.split("/").pop() ?? sf.relPath
          const url = URL.createObjectURL(blob)
          const a = document.createElement("a")
          a.href = url
          a.download = fileName
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(url)

          setSyncProgress(Math.round(((i + 1) / downloadableFiles.length) * 100))
          // Small delay between downloads to avoid browser blocking
          if (i < downloadableFiles.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300))
          }
        }

        setSyncSummary(`已下载 ${downloadableFiles.length} 个文件到浏览器下载目录`)
      } catch (err: any) {
        setError(err?.message || String(err))
      } finally {
        setSyncing(false)
        setTimeout(() => { setSyncProgress(0); setSyncSummary("") }, 2000)
      }
    }
  }

  async function handlePreview(document: DocumentNode) {
    shouldScrollToPreviewRef.current = true
    setPreviewScrollToken((current) => current + 1)
    setSelectedDocument(document)
    setPreviewLoading(true)
    setPreviewContent("")

    try {
      if (TEXT_PREVIEW_EXTENSIONS.has(document.extension)) {
        const res = await fetch(buildPreviewUrl(document.relativePath), { cache: "no-store" })
        const text = await res.text()
        if (!res.ok) {
          throw new Error(text || res.statusText)
        }
        const contentType = res.headers.get("content-type") || ""
        setPreviewMode(contentType.includes("text/html") ? "html" : "text")
        setPreviewContent(text)
      } else if (IMAGE_PREVIEW_EXTENSIONS.has(document.extension)) {
        setPreviewMode("image")
      } else {
        setPreviewMode("frame")
      }
    } catch (requestError: any) {
      setPreviewMode("empty")
      setError(requestError?.message || String(requestError))
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleDelete(document: DocumentNode) {
    if (!document.canDelete) {
      setError("只有上传者可以删除该文件")
      return
    }

    const confirmed = window.confirm(`确定删除文件“${document.name}”吗？`)
    if (!confirmed) {
      return
    }

    try {
      setDeletingPath(document.relativePath)
      setError(null)

      const res = await fetch(buildFileUrl(document.relativePath), {
        method: "DELETE",
        headers: getKnowledgeBaseAuthHeaders(),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || res.statusText)
      }

      if (selectedDocument?.relativePath === document.relativePath) {
        setSelectedDocument(null)
        setPreviewMode("empty")
        setPreviewContent("")
      }

      await refreshTree()
    } catch (requestError: any) {
      setError(requestError?.message || String(requestError))
    } finally {
      setDeletingPath(null)
    }
  }

  async function handleDeleteFolder(folder: FolderNode) {
    if (!folder.canDelete) {
      setError("只有创建者或管理员可以删除该文件夹")
      return
    }

    const confirmed = window.confirm(`确定删除文件夹“${folder.name}”及其全部内容吗？此操作不可撤销。`)
    if (!confirmed) return

    try {
      setDeletingPath(folder.relativePath)
      setError(null)

      const res = await fetch("/api/knowledge-base/folders", {
        method: "DELETE",
        headers: { ...getKnowledgeBaseAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ path: folder.relativePath }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || res.statusText)
      }

      // Navigate up if we were inside the deleted folder
      if (selectedFolder === folder.relativePath || selectedFolder.startsWith(folder.relativePath + "/")) {
        setSelectedFolder(folder.relativePath.includes("/") ? folder.relativePath.split("/").slice(0, -1).join("/") : "")
      }
      setSelectedExplorerEntry(null)
      await refreshTree()
    } catch (requestError: any) {
      setError(requestError?.message || String(requestError))
    } finally {
      setDeletingPath(null)
    }
  }

  async function handleRenameEntry(entry: ExplorerEntry) {
    const canRename = entry.kind === "folder" ? entry.folder.canDelete : entry.document.canDelete
    if (!canRename) {
      setError(entry.kind === "folder" ? "只有创建者或管理员可以重命名该文件夹" : "只有上传者可以重命名该文件")
      return
    }

    const nextName = window.prompt(`重命名${entry.kind === "folder" ? "文件夹" : "文件"}`, entry.name)
    if (nextName === null) return

    const trimmed = nextName.trim()
    if (!trimmed || trimmed === entry.name) return

    try {
      setError(null)
      setRenamingPath(entry.relativePath)

      const endpoint = entry.kind === "folder" ? "/api/knowledge-base/folders" : "/api/knowledge-base/file"
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(getKnowledgeBaseAuthHeaders() ?? {}) },
        body: JSON.stringify({ path: entry.relativePath, newName: trimmed }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || res.statusText)
      }

      if (entry.kind === "folder") {
        const newPath = String(data?.folder?.relativePath || "")
        if (newPath && newPath !== entry.relativePath) {
          if (selectedFolder === entry.relativePath || selectedFolder.startsWith(`${entry.relativePath}/`)) {
            setSelectedFolder((current) => replacePathPrefix(current, entry.relativePath, newPath))
          }

          setSelectedExplorerEntry((current) => {
            if (!current) return current
            if (current.relativePath === entry.relativePath || current.relativePath.startsWith(`${entry.relativePath}/`)) {
              return {
                ...current,
                relativePath: replacePathPrefix(current.relativePath, entry.relativePath, newPath),
              }
            }
            return current
          })

          setSelectedDocument((current) => {
            if (!current) return current
            if (current.relativePath === entry.relativePath || current.relativePath.startsWith(`${entry.relativePath}/`)) {
              return {
                ...current,
                relativePath: replacePathPrefix(current.relativePath, entry.relativePath, newPath),
              }
            }
            return current
          })
        }
      } else {
        const renamedPath = String(data?.file?.relativePath || "")
        const renamedName = String(data?.file?.name || trimmed)

        if (renamedPath && selectedExplorerEntry?.kind === "file" && selectedExplorerEntry.relativePath === entry.relativePath) {
          setSelectedExplorerEntry({ kind: "file", relativePath: renamedPath })
        }

        if (renamedPath && selectedDocument?.relativePath === entry.relativePath) {
          const extension = getNameExtension(renamedName)
          setSelectedDocument((current) => {
            if (!current) return current
            return {
              ...current,
              name: renamedName,
              relativePath: renamedPath,
              extension,
              canPreview:
                TEXT_PREVIEW_EXTENSIONS.has(extension) ||
                IMAGE_PREVIEW_EXTENSIONS.has(extension) ||
                FRAME_PREVIEW_EXTENSIONS.has(extension),
              canChat: CHAT_SUPPORTED_EXTENSIONS.has(extension),
            }
          })
        }
      }

      await refreshTree()
    } catch (requestError: any) {
      setError(requestError?.message || String(requestError))
    } finally {
      setRenamingPath(null)
    }
  }

  // ── Conversation helpers ────────────────────────────────────────────────────

  async function loadConversations() {
    if (!getKnowledgeBaseAuthHeaders()) return
    try {
      const res = await fetch("/api/knowledge-base/conversations", {
        headers: getKnowledgeBaseAuthHeaders() ?? {},
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || res.statusText || "加载历史记录失败")
      }
      setConversations(data.conversations)
    } catch (requestError: any) {
      setError(requestError?.message || String(requestError))
    }
  }

  async function ensureConversation(): Promise<string | null> {
    if (activeConversationId) return activeConversationId
    if (!getKnowledgeBaseAuthHeaders()) return null
    const scope = selectedDocument?.relativePath ?? selectedFolder
    const scopeType: "folder" | "file" = selectedDocument ? "file" : "folder"
    // Use a placeholder; the server will rename to the first question after the response
    const title = "新对话"
    try {
      const res = await fetch("/api/knowledge-base/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getKnowledgeBaseAuthHeaders() ?? {}) },
        body: JSON.stringify({ title, scope, scopeType }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || res.statusText || "创建对话失败")
      }

      const conv = data.conversation as ConversationSummary
      setConversations((prev) => [conv, ...prev.filter((item) => item.id !== conv.id)])
      setActiveConversationId(conv.id)
      return conv.id
    } catch (requestError: any) {
      setError(requestError?.message || String(requestError))
    }
    return null
  }

  async function handleLoadConversation(id: string) {
    if (!currentUser) return
    try {
      const res = await fetch(`/api/knowledge-base/conversations/${id}`, {
        headers: getKnowledgeBaseAuthHeaders() ?? {},
      })
      const data = await res.json()
      if (!data?.ok) return
      setActiveConversationId(id)
      setChatMessages((data.messages as Array<{ role: "user" | "assistant"; content: string; sources?: string[] }>).map((m) => ({
        role: m.role,
        content: m.content,
        sources: m.sources,
      })))
    } catch {}
  }

  async function handleNewConversation() {
    // Before clearing current chat, refresh list so last conversation remains visible in history.
    await loadConversations()
    setActiveConversationId(null)
    setChatMessages([{ role: "assistant", content: "选择左侧文件夹后即可上传资料、预览文档，并针对当前文件夹或全部资料提问。" }])
  }

  async function handleToggleConvSidebar() {
    const opening = !showConvSidebar
    setShowConvSidebar(opening)
    if (!opening) return

    // On open: always refresh the list from server
    await loadConversations()

    // If there are actual chat exchanges but no conversation record yet, save it now
    const hasUserMessages = chatMessages.some((m) => m.role === "user")
    if (hasUserMessages && !activeConversationId) {
      await ensureConversation()
      await loadConversations()
    }
  }

  function handleToggleSettingsSidebar() {
    setShowSettingsSidebar((v) => !v)
  }

  async function handleRenameConversation(id: string, title: string) {
    const trimmed = title.trim()
    setRenamingConvId(null)
    if (!trimmed || !currentUser) return
    try {
      await fetch(`/api/knowledge-base/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(getKnowledgeBaseAuthHeaders() ?? {}) },
        body: JSON.stringify({ title: trimmed }),
      })
      setConversations((prev) => prev.map((c) => c.id === id ? { ...c, title: trimmed } : c))
    } catch {}
  }

  async function handleDeleteConversation(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!currentUser) return
    try {
      await fetch(`/api/knowledge-base/conversations/${id}`, {
        method: "DELETE",
        headers: getKnowledgeBaseAuthHeaders() ?? {},
      })
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (activeConversationId === id) await handleNewConversation()
    } catch {}
  }

  const [reindexing, setReindexing] = useState(false)

  async function handleReindex() {
    if (reindexing) return
    if (!window.confirm(`确认重新索引「${selectedFolder || "全部资料"}」？\n这将清除缓存并在下次提问时重新调用 AI 嵌入接口。`)) return
    setReindexing(true)
    try {
      const res = await fetch("/api/knowledge-base/reindex", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getKnowledgeBaseAuthHeaders() ?? {}) },
        body: JSON.stringify({ folderPath: selectedFolder || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || res.statusText)
      setChatMessages([{ role: "assistant", content: `索引缓存已清除（${data.clearedFolder}）。下次提问时将自动重建索引。` }])
    } catch (e: any) {
      setChatMessages((c) => [...c, { role: "assistant", content: `重新索引失败：${e?.message || e}` }])
    } finally {
      setReindexing(false)
    }
  }

  // ── Index coverage check ───────────────────────────────────────────────────
  type IndexInfoResult = {
    scope: string
    diskIndex: { exists: boolean; indexedDocuments: number; indexedChunks: number; updatedAt: string | null; model: string | null }
    coverage: { totalOnDisk: number; indexed: number; notIndexed: number; stale: number; percentIndexed: number }
    notIndexedFiles: string[]
    staleFiles: string[]
  }
  const [indexInfo, setIndexInfo] = useState<IndexInfoResult | null>(null)
  const [indexInfoLoading, setIndexInfoLoading] = useState(false)

  async function handleCheckIndexCoverage() {
    if (indexInfoLoading) return
    setIndexInfoLoading(true)
    try {
      const scope = selectedFolder || ""
      const res = await fetch(`/api/knowledge-base/index-info?scope=${encodeURIComponent(scope)}`, { headers: getKnowledgeBaseAuthHeaders() })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
      setIndexInfo(await res.json())
    } catch (e: any) {
      setIndexInfo(null)
      alert(`检查失败：${e?.message || e}`)
    } finally {
      setIndexInfoLoading(false)
    }
  }

  async function handleStartEmbed() {
    const scope = selectedFolder || ""
    try {
      const res = await fetch("/api/knowledge-base/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getKnowledgeBaseAuthHeaders() ?? {}) },
        body: JSON.stringify({ folderPath: scope || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || res.statusText)
      // Start polling embed status progress bar
      startEmbedTracking(scope)
    } catch (e: any) {
      alert(`向量化启动失败：${e?.message || e}`)
    }
  }

  const [deduping, setDeduping] = useState(false)

  async function handleDedup() {
    if (deduping) return
    const scope = selectedFolder || ""
    const label = scope || "全部资料"
    if (!window.confirm(`确认对「${label}」去重？\n将扫描所有文件，删除内容完全相同的重复文件，只保留最新版本。`)) return
    setDeduping(true)
    try {
      const res = await fetch("/api/knowledge-base/dedup", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getKnowledgeBaseAuthHeaders() ?? {}) },
        body: JSON.stringify({ folderPath: scope || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || res.statusText)
      const msg = data.deleted > 0
        ? `去重完成：扫描 ${data.scanned} 个文件，删除 ${data.deleted} 个重复文件，保留 ${data.kept} 个。`
        : `去重完成：扫描 ${data.scanned} 个文件，未发现重复。`
      setChatMessages((c) => [...c, { role: "assistant", content: msg }])
      if (data.deleted > 0) void refreshTree()
      // Refresh index info if panel is open
      void handleCheckIndexCoverage()
    } catch (e: any) {
      alert(`去重失败：${e?.message || e}`)
    } finally {
      setDeduping(false)
    }
  }

  // ── Move folder ─────────────────────────────────────────────────────────────
  const [moveFolderSource, setMoveFolderSource] = useState<FolderNode | null>(null)
  const [moveFolderTarget, setMoveFolderTarget] = useState<string | null>(null)
  const [moveFolderExpanded, setMoveFolderExpanded] = useState<Set<string>>(new Set())
  const [moveFolderLoading, setMoveFolderLoading] = useState(false)

  function openMoveFolderDialog(folder: FolderNode) {
    setMoveFolderSource(folder)
    setMoveFolderTarget(null)
    setMoveFolderExpanded(new Set())
  }

  async function confirmMoveFolder() {
    if (!moveFolderSource || moveFolderLoading) return
    const dest = moveFolderTarget ?? ""
    if (dest === moveFolderSource.relativePath || dest.startsWith(`${moveFolderSource.relativePath}/`)) {
      alert("不能将文件夹移动到自身或其子目录中")
      return
    }
    const parentOfSource = moveFolderSource.relativePath.includes("/")
      ? moveFolderSource.relativePath.slice(0, moveFolderSource.relativePath.lastIndexOf("/"))
      : ""
    if (dest === parentOfSource) {
      alert("已在该目录中，无需移动")
      return
    }
    setMoveFolderLoading(true)
    try {
      const res = await fetch("/api/knowledge-base/folders", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(getKnowledgeBaseAuthHeaders() ?? {}) },
        body: JSON.stringify({ path: moveFolderSource.relativePath, destinationParent: dest }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || res.statusText)

      const newPath = String(data?.folder?.relativePath || "")
      if (newPath && newPath !== moveFolderSource.relativePath) {
        if (selectedFolder === moveFolderSource.relativePath || selectedFolder.startsWith(`${moveFolderSource.relativePath}/`)) {
          setSelectedFolder((current) => replacePathPrefix(current, moveFolderSource!.relativePath, newPath))
        }
        setSelectedExplorerEntry((current) => {
          if (!current) return current
          if (current.relativePath === moveFolderSource!.relativePath || current.relativePath.startsWith(`${moveFolderSource!.relativePath}/`)) {
            return { ...current, relativePath: replacePathPrefix(current.relativePath, moveFolderSource!.relativePath, newPath) }
          }
          return current
        })
      }
      setMoveFolderSource(null)
      await refreshTree()
    } catch (e: any) {
      alert(`移动失败：${e?.message || e}`)
    } finally {
      setMoveFolderLoading(false)
    }
  }

  function handleMoveTargetToggle(folderPath: string) {
    setMoveFolderExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(folderPath)) next.delete(folderPath)
      else next.add(folderPath)
      return next
    })
  }

  function handleDownloadFolderZip(folder: FolderNode) {
    const url = `/api/knowledge-base/download-zip?path=${encodeURIComponent(folder.relativePath)}`
    const headers = getKnowledgeBaseAuthHeaders()
    if (headers && headers["x-market-user-id"]) {
      fetch(url, { headers }).then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          alert(`下载失败：${data?.error || res.statusText}`)
          return
        }
        const blob = await res.blob()
        const objectUrl = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = objectUrl
        link.download = `${folder.name}.zip`
        link.click()
        URL.revokeObjectURL(objectUrl)
      }).catch((e: any) => alert(`下载失败：${e?.message || e}`))
    } else {
      window.open(url, "_blank")
    }
  }

  function handleDownloadConversation() {
    const userMessages = chatMessages.filter((m) => m.role === "user")
    if (userMessages.length === 0) return

    const scope = selectedDocument ? selectedDocument.name : (selectedFolder || "全部资料")
    const activeConv = conversations.find((c) => c.id === activeConversationId)
    const title = activeConv?.title || "知识库对话"
    const dateStr = new Date().toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })

    const lines: string[] = [
      `📚 ${title}`,
      `检索范围：${scope}`,
      `导出时间：${dateStr}`,
      "─".repeat(40),
      "",
    ]

    for (const msg of chatMessages) {
      if (msg.role === "user") {
        lines.push(`🙋 我：`)
        lines.push(msg.content)
      } else {
        lines.push(`🤖 AI：`)
        lines.push(msg.content)
        if (msg.sources && msg.sources.length > 0) {
          lines.push(`来源：${msg.sources.join("、")}`)
        }
      }
      lines.push("")
    }

    const text = lines.join("\n")
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${title.replace(/[/\\:*?"<>|]/g, "_")}_${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleStop() {
    abortControllerRef.current?.abort()
  }

  async function handleAsk() {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) return

    const nextMessages = [...chatMessages, { role: "user" as const, content: trimmedQuestion }]
    setChatMessages(nextMessages)
    setQuestion("")
    userScrolledRef.current = false
    setChatElapsed(0)
    setChatPhase(null)
    setChatLoading(true)
    chatTimerRef.current = setInterval(() => setChatElapsed(s => s + 1), 1000)

    const controller = new AbortController()
    abortControllerRef.current = controller

    // Prefer creating on client first for immediate sidebar feedback.
    const convId = await ensureConversation()

    try {
      setError(null)
      const res = await fetch("/api/knowledge-base/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getKnowledgeBaseAuthHeaders() ?? {}) },
        signal: controller.signal,
        body: JSON.stringify({
          question: trimmedQuestion,
          folderPath: selectedFolder,
          filePath: selectedDocument?.relativePath ?? null,
          useBm25,
          useGraphRag,
          stream: true,
          modelMode: queryMode === "superfast" ? "turbo" : queryMode === "thinking" ? "max" : "plus",
          deepSearch: queryMode === "deep" || queryMode === "thinking",
          thinkingSearch: queryMode === "thinking",
          conversationId: convId,
          title: selectedDocument ? selectedDocument.name : (selectedFolder || "全部资料"),
          fileName: selectedDocument?.name,
          folderName: selectedFolder || "全部资料",
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        let errMsg: string
        try { errMsg = (JSON.parse(text) as { error?: string }).error || `服务器错误 HTTP ${res.status}` } catch { errMsg = `服务器错误 HTTP ${res.status}` }
        throw new Error(errMsg)
      }

      // Add empty assistant message as streaming placeholder
      setChatMessages((prev) => [...prev, { role: "assistant" as const, content: "" }])

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let sseBuffer = ""
      let fullContent = ""
      let capturedModel: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        sseBuffer += decoder.decode(value, { stream: true })
        const parts = sseBuffer.split("\n\n")
        sseBuffer = parts.pop() ?? ""
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue
          const jsonStr = part.slice(6).trim()
          if (jsonStr === "[DONE]") continue
          let event: { type: string; delta?: string; modelId?: string; model?: string; sources?: string[]; conversationId?: string; message?: string } | null = null
          try { event = JSON.parse(jsonStr) } catch { continue }
          if (!event) continue
          if (event.type === "phase") {
            setChatPhase((event as any).phase)
          } else if (event.type === "text" && event.delta) {
            if (event.modelId && !capturedModel) {
              capturedModel = event.modelId
            }
            fullContent += event.delta
            setChatMessages((prev) => {
              const msgs = [...prev]
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: fullContent }
              return msgs
            })
          } else if (event.type === "done") {
            if (event.model) {
              capturedModel = event.model
            }
            const doneEvent = event
            setChatMessages((prev) => {
              const msgs = [...prev]
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], sources: doneEvent.sources ?? [] }
              return msgs
            })
            if (event.conversationId && !activeConversationId) {
              setActiveConversationId(String(event.conversationId))
            }
            void loadConversations()
          } else if (event.type === "error") {
            throw new Error(event.message ?? "未知错误")
          }
        }
      }
    } catch (requestError: any) {
      // Silently discard user-initiated stops
      if (requestError?.name === "AbortError") return
      const message = requestError?.message || String(requestError)
      setError(message)
      setChatMessages((current) => {
        const msgs = [...current]
        const last = msgs[msgs.length - 1]
        if (last?.role === "assistant" && !last.content) {
          msgs[msgs.length - 1] = { role: "assistant", content: `请求失败：${message}` }
        } else {
          msgs.push({ role: "assistant", content: `请求失败：${message}` })
        }
        return msgs
      })
    } finally {
      if (chatTimerRef.current) { clearInterval(chatTimerRef.current); chatTimerRef.current = null }
      setChatLoading(false)
      setChatPhase(null)
      abortControllerRef.current = null
    }
  }

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return
    }

    event.preventDefault()
    if (!chatLoading && question.trim()) {
      void handleAsk()
    }
  }

  function openTraditionalPreview(document: DocumentNode) {
    shouldScrollToPreviewRef.current = true
    setTraditionalPanel("preview")
    void handlePreview(document)
  }

  function handleExplorerEntryOpen(entry: ExplorerEntry) {
    if (entry.kind === "folder") {
      setSelectedFolder(entry.relativePath)
      setSelectedExplorerEntry(null)
      setSelectedDocument(null)
      setPreviewMode("empty")
      setPreviewContent("")
      return
    }

    setSelectedDocument(entry.document)
    if (variant === "traditional") {
      openTraditionalPreview(entry.document)
      return
    }

    void handlePreview(entry.document)
  }

  function renderExplorer(appearance: "cyber" | "traditional") {
    const isCyber = appearance === "cyber"

    return (
      <div className="space-y-4">
        <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2", isCyber ? "border-cyan-500/20 bg-black/25" : "border-border bg-muted/30") }>
          <div className="min-w-0 space-y-1">
            <div className={cn("flex flex-wrap items-center gap-1 text-sm", isCyber ? "text-cyan-100" : "text-foreground")}>
              {folderBreadcrumbs.map((item, index) => (
                <button
                  key={`${item.value || '__root__'}-${index}`}
                  type="button"
                  onClick={() => {
                    setSelectedFolder(item.value)
                    setSelectedExplorerEntry(null)
                    setSelectedDocument(null)
                  }}
                  className={cn("flex items-center gap-1 rounded px-1 py-0.5 transition-colors", isCyber ? "hover:bg-cyan-500/10" : "hover:bg-background")}
                >
                  <span className="max-w-[180px] truncate">{item.label}</span>
                  {index < folderBreadcrumbs.length - 1 && <ChevronRight className="h-3 w-3 opacity-60" />}
                </button>
              ))}
            </div>
            <div className={cn("text-xs", isCyber ? "text-cyan-300/70" : "text-muted-foreground")}>
              当前目录共 {explorerEntries.length} 项
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => {
              setSelectedFolder("")
              setSelectedExplorerEntry(null)
              setSelectedDocument(null)
            }} disabled={!selectedFolder} className={cn(isCyber && "border-cyan-500/40 text-cyan-200")}>
              根目录
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              if (parentFolderPath === null) return
              setSelectedFolder(parentFolderPath)
              setSelectedExplorerEntry(null)
              setSelectedDocument(null)
            }} disabled={parentFolderPath === null} className={cn(isCyber && "border-cyan-500/40 text-cyan-200")}>
              返回上一级
            </Button>
            <div className={cn("flex items-center rounded-md border", isCyber ? "border-cyan-500/30" : "border-border")}>
              <button
                type="button"
                title="列表视图"
                onClick={() => setExplorerView("list")}
                className={cn("flex h-7 w-7 items-center justify-center rounded-l-md transition-colors",
                  explorerView === "list"
                    ? isCyber ? "bg-cyan-500/20 text-cyan-100" : "bg-muted text-foreground"
                    : isCyber ? "text-cyan-300/60 hover:bg-cyan-500/10 hover:text-cyan-200" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <LayoutList className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="图标视图"
                onClick={() => setExplorerView("icon")}
                className={cn("flex h-7 w-7 items-center justify-center rounded-r-md transition-colors",
                  explorerView === "icon"
                    ? isCyber ? "bg-cyan-500/20 text-cyan-100" : "bg-muted text-foreground"
                    : isCyber ? "text-cyan-300/60 hover:bg-cyan-500/10 hover:text-cyan-200" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className={cn("flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2", isCyber ? "border-cyan-500/15 bg-black/20" : "border-border bg-card") }>
          <div className={cn("min-w-0 flex-1 truncate text-sm", isCyber ? "text-cyan-100" : "text-foreground")}>
            {activeExplorerEntry ? `${activeExplorerEntry.name} · ${activeExplorerEntry.typeLabel}` : "选择一个文件夹或文件"}
          </div>
          {activeExplorerEntry?.kind === "folder" && (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => handleExplorerEntryOpen(activeExplorerEntry)} className={cn(isCyber && "border-cyan-500/40 text-cyan-200")}>
                <FolderOpen className="h-4 w-4" />
                打开
              </Button>
              {activeExplorerEntry.folder.canDelete && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={deletingPath === activeExplorerEntry.folder.relativePath || renamingPath === activeExplorerEntry.folder.relativePath}
                  onClick={() => void handleDeleteFolder(activeExplorerEntry.folder)}
                  className={cn(isCyber ? "border-red-500/40 text-red-200" : "")}
                >
                  <Trash2 className="h-4 w-4" />
                  {deletingPath === activeExplorerEntry.folder.relativePath ? "删除中..." : "删除"}
                </Button>
              )}
            </>
          )}
          {activeExplorerEntry?.kind === "file" && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleExplorerEntryOpen(activeExplorerEntry)}
                disabled={!activeExplorerEntry.document.canPreview}
                className={cn(isCyber && "border-cyan-500/40 text-cyan-200")}
              >
                <Eye className="h-4 w-4" />
                预览
              </Button>
              <Button type="button" size="sm" variant="outline" asChild className={cn(isCyber && "border-cyan-500/40 text-cyan-200")}>
                <a href={buildFileUrl(activeExplorerEntry.document.relativePath, true)}>
                  <Download className="h-4 w-4" />
                  下载
                </a>
              </Button>
              {activeExplorerEntry.document.canDelete && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={deletingPath === activeExplorerEntry.document.relativePath || renamingPath === activeExplorerEntry.document.relativePath}
                  onClick={() => void handleDelete(activeExplorerEntry.document)}
                  className={cn(isCyber ? "border-red-500/40 text-red-200" : "")}
                >
                  <Trash2 className="h-4 w-4" />
                  {deletingPath === activeExplorerEntry.document.relativePath ? "删除中..." : "删除"}
                </Button>
              )}
            </>
          )}
        </div>

        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className={cn("overflow-hidden rounded-lg border", isCyber ? "border-cyan-500/15 bg-black/20" : "border-border bg-card") }>
              {explorerView === "list" && (
                <div className={cn("grid grid-cols-[minmax(0,2fr)_minmax(140px,1.1fr)_minmax(100px,0.9fr)_minmax(100px,0.8fr)_minmax(90px,0.9fr)] gap-3 border-b px-3 py-2 text-xs font-medium", isCyber ? "border-cyan-500/15 bg-black/25 text-cyan-300/80" : "border-border bg-muted/40 text-muted-foreground")}>
                  {(["name", "updatedAt", "typeLabel", "size", "ownerName"] as const).map((col) => {
                    const labels: Record<string, string> = { name: "名称", updatedAt: "修改日期", typeLabel: "类型", size: "大小", ownerName: "上传者" }
                    const active = explorerSort.key === col
                    const Icon = active ? (explorerSort.dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown
                    return (
                      <button
                        key={col}
                        type="button"
                        onClick={() => setExplorerSort((prev) => prev.key === col ? { key: col, dir: prev.dir === "asc" ? "desc" : "asc" } : { key: col, dir: col === "updatedAt" ? "desc" : "asc" })}
                        className={cn("flex items-center gap-1 select-none transition-colors", isCyber ? "hover:text-cyan-100" : "hover:text-foreground", active && (isCyber ? "text-cyan-100" : "text-foreground"))}
                      >
                        {labels[col]}
                        <Icon className="h-3 w-3 shrink-0" />
                      </button>
                    )
                  })}
                </div>
              )}
              {explorerView === "list" ? (
                <div>
                  {sortedExplorerEntries.length > 0 ? (
                    sortedExplorerEntries.map((entry) => {
                      const selected = activeExplorerEntry?.kind === entry.kind && activeExplorerEntry.relativePath === entry.relativePath
                      const busy = deletingPath === entry.relativePath || renamingPath === entry.relativePath
                      return (
                        <ContextMenu key={entry.key}>
                          <ContextMenuTrigger asChild>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedExplorerEntry({ kind: entry.kind, relativePath: entry.relativePath })
                                if (entry.kind === "file") setSelectedDocument(entry.document)
                              }}
                              onDoubleClick={() => handleExplorerEntryOpen(entry)}
                              className={cn(
                                "grid w-full grid-cols-[minmax(0,2fr)_minmax(140px,1.1fr)_minmax(100px,0.9fr)_minmax(100px,0.8fr)_minmax(90px,0.9fr)] gap-3 border-b px-3 py-2 text-left text-sm transition-colors last:border-b-0",
                                isCyber
                                  ? selected ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-50" : "border-cyan-500/10 text-cyan-100 hover:bg-cyan-500/5"
                                  : selected ? "border-border bg-primary/5 text-foreground" : "border-border text-foreground hover:bg-muted/50",
                              )}
                              title={entry.relativePath}
                              disabled={busy}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                {entry.kind === "folder" ? (
                                  <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-sm", isCyber ? "bg-cyan-500/15 text-cyan-300" : "bg-amber-500/15 text-amber-600")}>
                                    <FolderOpen className="h-4 w-4" />
                                  </span>
                                ) : (() => {
                                  const fi = getExplorerFileIcon(entry.document.extension)
                                  return <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-sm", fi.className)}><fi.icon className="h-4 w-4" /></span>
                                })()}
                                <span className="truncate">{entry.name}</span>
                              </div>
                              <div className="truncate">{formatDateTime(entry.updatedAt)}</div>
                              <div className="truncate">{entry.typeLabel}</div>
                              <div className="truncate">{entry.kind === "file" ? formatFileSize(entry.document.size) : formatFileSize(getFolderTotalSize(entry.folder))}</div>
                              <div className="truncate">{entry.ownerName}</div>
                            </button>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-48">
                            {entry.kind === "folder" ? (
                              <>
                                <ContextMenuItem onClick={() => handleExplorerEntryOpen(entry)}>
                                  <FolderOpen className="h-4 w-4" />打开
                                </ContextMenuItem>
                                <ContextMenuItem onClick={() => void handleCreateFolderInline(entry.folder.relativePath)}>
                                  <FolderPlus className="h-4 w-4" />新建文件夹
                                </ContextMenuItem>
                                <ContextMenuItem disabled={!entry.folder.canDelete || busy} onClick={() => void handleRenameEntry(entry)}>
                                  <Pencil className="h-4 w-4" />重命名
                                </ContextMenuItem>
                                <ContextMenuItem disabled={!entry.folder.canDelete || busy} onClick={() => openMoveFolderDialog(entry.folder)}>
                                  <MoveRight className="h-4 w-4" />移动到...
                                </ContextMenuItem>
                                <ContextMenuItem onClick={() => handleDownloadFolderZip(entry.folder)}>
                                  <FileArchive className="h-4 w-4" />下载为 ZIP
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem variant="destructive" disabled={!entry.folder.canDelete || busy} onClick={() => void handleDeleteFolder(entry.folder)}>
                                  <Trash2 className="h-4 w-4" />删除
                                </ContextMenuItem>
                              </>
                            ) : (
                              <>
                                <ContextMenuItem disabled={!entry.document.canPreview} onClick={() => handleExplorerEntryOpen(entry)}>
                                  <Eye className="h-4 w-4" />预览
                                </ContextMenuItem>
                                <ContextMenuItem onClick={() => window.open(buildFileUrl(entry.document.relativePath, true), "_blank")}>
                                  <Download className="h-4 w-4" />下载
                                </ContextMenuItem>
                                <ContextMenuItem disabled={!entry.document.canDelete || busy} onClick={() => void handleRenameEntry(entry)}>
                                  <Pencil className="h-4 w-4" />重命名
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem variant="destructive" disabled={!entry.document.canDelete || busy} onClick={() => void handleDelete(entry.document)}>
                                  <Trash2 className="h-4 w-4" />删除
                                </ContextMenuItem>
                              </>
                            )}
                          </ContextMenuContent>
                        </ContextMenu>
                      )
                    })
                  ) : (
                    <div className={cn("px-3 py-6 text-sm", isCyber ? "text-cyan-300/70" : "text-muted-foreground")}>当前目录暂无文件夹或文件。</div>
                  )}
                </div>
              ) : (
                /* Icon grid view */
                <div className="p-3">
                  {sortedExplorerEntries.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
                      {sortedExplorerEntries.map((entry) => {
                        const selected = activeExplorerEntry?.kind === entry.kind && activeExplorerEntry.relativePath === entry.relativePath
                        const busy = deletingPath === entry.relativePath || renamingPath === entry.relativePath
                        return (
                          <ContextMenu key={entry.key}>
                            <ContextMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedExplorerEntry({ kind: entry.kind, relativePath: entry.relativePath })
                                  if (entry.kind === "file") setSelectedDocument(entry.document)
                                }}
                                onDoubleClick={() => handleExplorerEntryOpen(entry)}
                                disabled={busy}
                                title={entry.relativePath}
                                className={cn(
                                  "flex flex-col items-center gap-1.5 rounded-lg p-2 text-center transition-colors",
                                  isCyber
                                    ? selected ? "bg-cyan-500/15 text-cyan-50 ring-1 ring-cyan-400/40" : "text-cyan-100 hover:bg-cyan-500/8"
                                    : selected ? "bg-primary/8 text-foreground ring-1 ring-primary/30" : "text-foreground hover:bg-muted/60",
                                )}
                              >
                                {entry.kind === "folder" ? (
                                  <span className={cn("flex h-12 w-12 items-center justify-center rounded-lg", isCyber ? "bg-cyan-500/15 text-cyan-300" : "bg-amber-500/15 text-amber-600")}>
                                    <FolderOpen className="h-7 w-7" />
                                  </span>
                                ) : (() => {
                                  const fi = getExplorerFileIcon(entry.document.extension)
                                  return <span className={cn("flex h-12 w-12 items-center justify-center rounded-lg", fi.className)}><fi.icon className="h-7 w-7" /></span>
                                })()}
                                <span className="line-clamp-2 w-full break-all text-xs leading-tight">{entry.name}</span>
                              </button>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-48">
                              {entry.kind === "folder" ? (
                                <>
                                  <ContextMenuItem onClick={() => handleExplorerEntryOpen(entry)}>
                                    <FolderOpen className="h-4 w-4" />打开
                                  </ContextMenuItem>
                                  <ContextMenuItem onClick={() => void handleCreateFolderInline(entry.folder.relativePath)}>
                                    <FolderPlus className="h-4 w-4" />新建文件夹
                                  </ContextMenuItem>
                                  <ContextMenuItem disabled={!entry.folder.canDelete || busy} onClick={() => void handleRenameEntry(entry)}>
                                    <Pencil className="h-4 w-4" />重命名
                                  </ContextMenuItem>
                                  <ContextMenuItem disabled={!entry.folder.canDelete || busy} onClick={() => openMoveFolderDialog(entry.folder)}>
                                    <MoveRight className="h-4 w-4" />移动到...
                                  </ContextMenuItem>
                                  <ContextMenuItem onClick={() => handleDownloadFolderZip(entry.folder)}>
                                    <FileArchive className="h-4 w-4" />下载为 ZIP
                                  </ContextMenuItem>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem variant="destructive" disabled={!entry.folder.canDelete || busy} onClick={() => void handleDeleteFolder(entry.folder)}>
                                    <Trash2 className="h-4 w-4" />删除
                                  </ContextMenuItem>
                                </>
                              ) : (
                                <>
                                  <ContextMenuItem disabled={!entry.document.canPreview} onClick={() => handleExplorerEntryOpen(entry)}>
                                    <Eye className="h-4 w-4" />预览
                                  </ContextMenuItem>
                                  <ContextMenuItem onClick={() => window.open(buildFileUrl(entry.document.relativePath, true), "_blank")}>
                                    <Download className="h-4 w-4" />下载
                                  </ContextMenuItem>
                                  <ContextMenuItem disabled={!entry.document.canDelete || busy} onClick={() => void handleRenameEntry(entry)}>
                                    <Pencil className="h-4 w-4" />重命名
                                  </ContextMenuItem>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem variant="destructive" disabled={!entry.document.canDelete || busy} onClick={() => void handleDelete(entry.document)}>
                                    <Trash2 className="h-4 w-4" />删除
                                  </ContextMenuItem>
                                </>
                              )}
                            </ContextMenuContent>
                          </ContextMenu>
                        )
                      })}
                    </div>
                  ) : (
                    <div className={cn("py-6 text-center text-sm", isCyber ? "text-cyan-300/70" : "text-muted-foreground")}>当前目录暂无文件夹或文件。</div>
                  )}
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-48">
            <ContextMenuItem onClick={() => void handleCreateFolderInline(selectedFolder)}>
              <FolderPlus className="h-4 w-4" />
              在此新建文件夹
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    )
  }

  if (!authorized && loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-cyan-300">
        <LoaderCircle className="mr-3 h-6 w-6 animate-spin" />
        正在加载 AI 知识库...
      </div>
    )
  }

  if (variant === "traditional") {
    const traditionalMenu = [
      {
        key: "library" as const,
        title: "资料目录",
        description: "查看文件夹与文档，并切换问答范围。",
        icon: FileText,
      },
      {
        key: "preview" as const,
        title: "文档预览",
        description: "专门查看当前选中文档的内容。",
        icon: Eye,
      },
      {
        key: "upload" as const,
        title: "上传资料",
        description: "向当前目录添加新的知识库文件。",
        icon: Upload,
      },
      {
        key: "sync" as const,
        title: "同步",
        description: "与本地目录对比并同步文件。",
        icon: RefreshCw,
      },
      {
        key: "graph" as const,
        title: "知识图谱",
        description: "可视化文档与实体的关联网络。",
        icon: Network,
      },
    ]

    return (
      <div className="min-h-[calc(100vh-8rem)]">
        {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}

        <ResizablePanelGroup direction="horizontal" className="min-h-[calc(100vh-8rem)] items-start gap-0">
          <ResizablePanel defaultSize={42} minSize={28} className="min-w-[360px]">
            <section className="flex h-[calc(100vh-8rem)] min-h-0 flex-col overflow-hidden pr-4 lg:pr-6">
            <div ref={traditionalOperationsScrollRef} className="min-h-0 flex-1 overflow-y-auto pr-3">
              <div className="space-y-6 pb-4">
                {traditionalPanel !== "preview" && (
                <>
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-xl font-semibold">资料操作区</h2>
                  <div className="text-right text-sm">
                    <div className="text-muted-foreground">资料总数</div>
                    <div className="font-semibold">{totalDocuments}</div>
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">当前范围：</span>
                    <span className="font-medium">{selectedFolder || "全部资料"}</span>
                  </div>
                  <div className="truncate">
                    <span className="text-muted-foreground">存储位置：</span>
                    <span className="font-medium">{storageRoot || "加载中"}</span>
                  </div>
                </div>

                {/* Embed job progress bar */}
                {embedJob && (
                  <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm space-y-1.5">
                    <div className="flex items-center gap-2">
                      {embedJob.status === "done" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                      ) : embedJob.status === "error" ? (
                        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                      ) : (
                        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-primary" />
                      )}
                      <span className={cn(
                        "flex-1 truncate",
                        embedJob.status === "error" ? "text-destructive" : "text-foreground"
                      )}>
                        {embedJob.message}
                      </span>
                      {embedJob.totalFiles > 0 && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {embedJob.processedFiles}/{embedJob.totalFiles}
                        </span>
                      )}
                    </div>
                    {embedJob.status !== "error" && (
                      <Progress
                        value={embedJob.totalFiles > 0
                          ? (embedJob.processedFiles / embedJob.totalFiles) * 100
                          : (embedJob.status === "running" ? 10 : 5)}
                        className="h-1.5"
                      />
                    )}
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  {traditionalMenu.map((item) => {
                    const Icon = item.icon
                    const active = traditionalPanel === item.key

                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setTraditionalPanel(item.key)}
                        className={cn(
                          "border-b px-0 py-3 text-left transition-colors",
                          active ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Icon className="h-4 w-4" />
                          {item.title}
                        </div>
                      </button>
                    )
                  })}
                </div>
                </>
                )}

                {traditionalPanel === "library" && (
                  <div className="space-y-4">
                    <ScrollArea className="h-[calc(100vh-18rem)] pr-3">
                      <div className="space-y-3">{tree ? renderExplorer("traditional") : <div className="text-sm text-muted-foreground">暂无资料</div>}</div>
                    </ScrollArea>
                  </div>
                )}

                {traditionalPanel === "preview" && (
                  <div ref={traditionalPreviewRef} className="space-y-4">
                    <div ref={traditionalPreviewHeaderRef} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                      <div className="min-w-0 text-sm text-muted-foreground" title={selectedDocument?.relativePath || ""}>
                        {selectedDocument
                          ? `${truncateMiddle(selectedDocument.relativePath)} · ${formatFileSize(selectedDocument.size)}`
                          : "先在资料目录中选择一个文档进行预览。"}
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => setTraditionalPanel("library")}>
                        <ChevronLeft className="h-4 w-4" />
                        返回
                      </Button>
                    </div>
                    <div className="min-h-[calc(100vh-18rem)] rounded-lg border bg-card/40 p-3">
                      {previewLoading && (
                        <div className="flex h-[calc(100vh-19.5rem)] items-center justify-center text-muted-foreground">
                          <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                          正在加载文档...
                        </div>
                      )}
                      {!previewLoading && previewMode === "text" && (
                        <ScrollArea className="h-[calc(100vh-19.5rem)] pr-3">
                          <pre className="whitespace-pre-wrap break-words text-sm leading-6">{previewContent}</pre>
                        </ScrollArea>
                      )}
                      {!previewLoading && previewMode === "html" && (
                        <iframe
                          srcDoc={previewContent}
                          className="h-[calc(100vh-19.5rem)] w-full rounded-md bg-white"
                          title={selectedDocument?.name || "文档预览"}
                          sandbox=""
                        />
                      )}
                      {!previewLoading && previewMode === "image" && selectedDocument && (
                        <div className="flex h-[calc(100vh-19.5rem)] items-center justify-center overflow-hidden rounded-md bg-black/5">
                          <img src={buildFileUrl(selectedDocument.relativePath)} alt={selectedDocument.name} className="max-h-full max-w-full object-contain" />
                        </div>
                      )}
                      {!previewLoading && previewMode === "frame" && selectedDocument && (
                        <iframe
                          key={selectedDocument.relativePath}
                          src={buildFileUrl(selectedDocument.relativePath)}
                          className="h-[calc(100vh-19.5rem)] w-full rounded-md bg-white"
                          title={selectedDocument.name}
                        />
                      )}
                      {!previewLoading && previewMode === "empty" && (
                        <div className="flex h-[calc(100vh-19.5rem)] items-center justify-center text-sm text-muted-foreground">
                          暂无预览内容。txt、csv、json、Word、Excel 支持文本预览；图片支持直接查看；html、pdf 支持内嵌查看。
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {traditionalPanel === "upload" && (
                  <div className="space-y-4">
                    {/* Target folder selector — drill-down picker */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">目标目录</label>
                      {/* Breadcrumb navigation */}
                      <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-input bg-muted/30 px-2 py-1.5 text-xs">
                        <button
                          type="button"
                          className={cn("rounded px-1 py-0.5 hover:bg-accent hover:text-foreground", !uploadFolderBrowsePath ? "font-semibold text-foreground" : "text-muted-foreground")}
                          onClick={() => { setUploadFolderBrowsePath(""); setUploadTargetFolder("") }}
                        >
                          全部资料
                        </button>
                        {uploadFolderBrowsePath.split("/").filter(Boolean).map((seg, i, arr) => {
                          const segPath = arr.slice(0, i + 1).join("/")
                          return (
                            <span key={segPath} className="flex items-center gap-0.5">
                              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                              <button
                                type="button"
                                className={cn("rounded px-1 py-0.5 hover:bg-accent hover:text-foreground", segPath === uploadFolderBrowsePath ? "font-semibold text-foreground" : "text-muted-foreground")}
                                onClick={() => { setUploadFolderBrowsePath(segPath); setUploadTargetFolder(segPath) }}
                              >
                                {seg}
                              </button>
                            </span>
                          )
                        })}
                      </div>
                      {/* Child folder list for current level */}
                      <div className="max-h-36 overflow-y-auto rounded-md border border-input bg-background">
                        {(() => {
                          const currentNode = tree ? findFolderByPath(tree, uploadFolderBrowsePath) : null
                          if (!currentNode) return <div className="px-3 py-2 text-xs text-muted-foreground">正在加载...</div>
                          if (currentNode.folders.length === 0) {
                            return <div className="px-3 py-2 text-xs text-muted-foreground">当前目录无子文件夹</div>
                          }
                          return currentNode.folders.map((child) => (
                            <button
                              key={child.relativePath}
                              type="button"
                              className={cn(
                                "flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-muted/60",
                                uploadTargetFolder === child.relativePath && "bg-primary/8 font-medium",
                              )}
                              onClick={() => { setUploadFolderBrowsePath(child.relativePath); setUploadTargetFolder(child.relativePath) }}
                            >
                              <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                              <span className="flex-1 truncate text-left">{child.name}</span>
                              {child.folders.length > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                            </button>
                          ))
                        })()}
                      </div>
                      {/* Selected folder indicator */}
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-muted-foreground">已选目录：</span>
                        <span className={cn("font-medium", uploadTargetFolder === null ? "text-destructive" : "text-foreground")}>
                          {uploadTargetFolder === null ? "（请点击上方选择目录）" : uploadTargetFolder === "" ? "全部资料（根目录）" : uploadTargetFolder}
                        </span>
                      </div>
                    </div>

                    {/* Drag-and-drop zone */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault()
                        setIsDragOver(false)
                        if (uploadTargetFolder === null) {
                          setError("请先选择目标目录")
                          return
                        }
                        const droppedFiles = Array.from(e.dataTransfer.files).filter((f) => f.size > 0)
                        if (!droppedFiles.length) return
                        if (droppedFiles.length === 1) {
                          setPendingFile(droppedFiles[0])
                          if (singleUploadInputRef.current) singleUploadInputRef.current.value = ""
                        } else {
                          void handleBatchUpload(droppedFiles, uploadTargetFolder)
                        }
                      }}
                      onClick={() => singleUploadInputRef.current?.click()}
                      className={cn(
                        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm transition-colors",
                        isDragOver
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                      )}
                    >
                      <Upload className="h-6 w-6" />
                      {pendingFile
                        ? <span className="font-medium text-foreground">{pendingFile.name}</span>
                        : <span>拖拽文件到此处，或点击选择文件</span>
                      }
                      <span className="text-xs">支持图片、Word、Excel、CSV、PDF、TXT 等文件</span>
                    </div>

                    <input
                      ref={singleUploadInputRef}
                      type="file"
                      className="hidden"
                      onChange={(event) => setPendingFile(event.target.files?.[0] || null)}
                    />
                    <input
                      ref={batchUploadInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleBatchUploadChange}
                      {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                    />
                    {/* Hidden folder picker for sync — moved to sync panel */}

                    <div className="flex flex-wrap gap-3">
                      <Button disabled={!pendingFile || uploading || uploadTargetFolder === null} onClick={() => void handleUpload()}>
                        <Upload className="h-4 w-4" />
                        {uploading ? "上传中..." : "上传文档"}
                      </Button>
                      <Button type="button" variant="outline" disabled={batchUploading || uploadTargetFolder === null} onClick={() => batchUploadInputRef.current?.click()}>
                        <FolderOpen className="h-4 w-4" />
                        {batchUploading ? "批量上传中..." : "批量上传文件夹"}
                      </Button>
                    </div>

                    {batchUploading && (
                      <div className="space-y-2">
                        <Progress value={batchUploadProgress} className="h-2" />
                        <div className="text-xs text-muted-foreground">{batchUploadSummary} · {batchUploadProgress}%</div>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">批量上传会保留所选文件夹的层级结构，统一导入到目标目录下。</div>
                  </div>
                )}

                {traditionalPanel === "sync" && (
                  <div className="space-y-5">
                    {/* Hidden folder picker fallback for HTTP (showDirectoryPicker requires HTTPS) */}
                    <input
                      ref={syncFolderInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={handleSyncFolderInputChange}
                      {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                    />

                    {/* ① Setup */}
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">① 选择目录</div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSyncBrowserSelectedFolder(syncServerFolder)
                            setServerBrowserExpanded(new Set([""]))
                            setShowServerBrowser(true)
                          }}
                        >
                          <FolderOpen className="h-4 w-4" />
                          浏览服务器目录
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void handlePickLocalFolder()}>
                          <Folder className="h-4 w-4" />
                          选择本地文件夹
                        </Button>
                      </div>
                    </div>

                    {/* ② Summary & Compare */}
                    {(syncServerFolder !== null || syncLocalDirHandle !== null || syncWebkitFiles !== null) && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">② 目录对比</div>

                        {syncServerFolder !== null && (
                          <div className="flex items-center gap-2 rounded-md border bg-muted/10 px-3 py-2 text-xs">
                            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                            <span className="text-muted-foreground">服务器：</span>
                            <span className="flex-1 truncate font-medium">{syncServerFolder || "全部资料"}</span>
                            <span className="shrink-0 text-muted-foreground">{syncServerFiles.length} 个文件</span>
                          </div>
                        )}

                        {(syncLocalDirHandle !== null || syncWebkitFiles !== null) && (
                          <div className="flex items-center gap-2 rounded-md border bg-muted/10 px-3 py-2 text-xs">
                            <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                            <span className="text-muted-foreground">本地：</span>
                            <span className="flex-1 truncate font-medium">{syncLocalDirName}</span>
                            {syncLocalDirUpdatedAt && (
                              <span className="shrink-0 text-muted-foreground">
                                {syncLocalDirUpdatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} 选择
                              </span>
                            )}
                            {syncWebkitFiles !== null && <span className="shrink-0 text-muted-foreground">{syncWebkitFiles.length} 个文件</span>}
                          </div>
                        )}

                        {syncServerFolder !== null && (syncLocalDirHandle !== null || syncWebkitFiles !== null) && (
                          <Button size="sm" variant="outline" disabled={syncing || syncComparing} onClick={() => void handleCompare()}>
                            <RefreshCw className={cn("h-4 w-4", syncComparing && "animate-spin")} />
                            {syncComparing ? "正在对比..." : "对比"}
                          </Button>
                        )}

                        {syncPreviewItems && (
                          <div className="rounded-md border bg-muted/10 px-3 py-2 text-xs">
                            <span className="font-medium">对比结果：</span>
                            <span className="ml-2">
                              <span className="text-emerald-600">{syncPreviewItems.filter(i => i.status === "new").length} 新增</span>
                              {" · "}
                              <span className="text-amber-600">{syncPreviewItems.filter(i => i.status === "changed").length} 变更</span>
                              {" · "}
                              <span className="text-muted-foreground">{syncPreviewItems.filter(i => i.status === "same").length} 相同</span>
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ③ Sync */}
                    {syncServerFolder !== null && (
                      <div className="space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">③ 同步</div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={syncing || !syncPendingFiles?.length}
                            onClick={() => void handleConfirmSyncToServer()}
                          >
                            <Upload className="h-4 w-4" />
                            {syncPendingFiles?.length ? `同步到服务器 (${syncPendingFiles.length} 个)` : "同步到服务器"}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={syncing}
                            onClick={() => void handleSyncToLocal()}
                          >
                            <Download className="h-4 w-4" />
                            同步到本地
                          </Button>
                        </div>

                        {syncing && (
                          <div className="space-y-2">
                            <Progress value={syncProgress} className="h-2" />
                            <div className="text-xs text-muted-foreground">{syncSummary} · {syncProgress}%</div>
                          </div>
                        )}
                        {!syncing && syncSummary && (
                          <div className="text-xs text-muted-foreground">{syncSummary}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {traditionalPanel === "graph" && (
                  <div className="space-y-3">
                    {/* Toolbar: mode tabs + action buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex rounded-md border text-xs overflow-hidden">
                        <button
                          className={cn("px-2.5 py-1 transition-colors", graphMode === "regex" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                          onClick={() => setGraphMode("regex")}
                        >
                          快速图谱
                        </button>
                        <button
                          className={cn("px-2.5 py-1 border-l transition-colors", graphMode === "llm" ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                          onClick={() => setGraphMode("llm")}
                        >
                          AI精准图谱
                        </button>
                      </div>

                      {graphMode === "regex" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={graphVizLoading}
                          onClick={async () => {
                            setGraphVizLoading(true)
                            setGraphVizError(null)
                            try {
                              const params = new URLSearchParams()
                              if (selectedFolder) params.set("folderPath", selectedFolder)
                              const res = await fetch(`/api/knowledge-base/graph?${params}`, { headers: getKnowledgeBaseAuthHeaders() ?? {} })
                              const data = await res.json()
                              if (!res.ok || !data.ok) throw new Error(data.error || "加载失败")
                              setGraphVizData({ nodes: data.nodes, links: data.links })
                            } catch (e: any) {
                              setGraphVizError(e?.message || "加载失败")
                            } finally {
                              setGraphVizLoading(false)
                            }
                          }}
                        >
                          <Network className={cn("mr-1.5 h-3.5 w-3.5", graphVizLoading && "animate-spin")} />
                          {graphVizLoading ? "生成中..." : "生成图谱"}
                        </Button>
                      )}

                      {graphMode === "llm" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={graphVizLLMLoading}
                          onClick={async () => {
                            setGraphVizLLMLoading(true)
                            setGraphVizLLMError(null)
                            try {
                              const res = await fetch("/api/knowledge-base/graph-llm", {
                                method: "POST",
                                headers: { "Content-Type": "application/json", ...(getKnowledgeBaseAuthHeaders() ?? {}) },
                                body: JSON.stringify({ folderPath: selectedFolder ?? null }),
                              })
                              const data = await res.json()
                              if (!res.ok || !data.ok) throw new Error(data.error || "加载失败")
                              setGraphVizLLMData({ nodes: data.nodes, links: data.links })
                            } catch (e: any) {
                              setGraphVizLLMError(e?.message || "加载失败")
                            } finally {
                              setGraphVizLLMLoading(false)
                            }
                          }}
                        >
                          {graphVizLLMLoading ? (
                            <><Network className="mr-1.5 h-3.5 w-3.5 animate-spin" />AI提取中…</>
                          ) : (
                            <><span className="mr-1.5">🤖</span>AI精准提取</>
                          )}
                        </Button>
                      )}

                      {graphMode === "regex" && graphVizData && (
                        <span className="text-xs text-muted-foreground">
                          {graphVizData.nodes.length} 节点 · {graphVizData.links.length} 关系
                        </span>
                      )}
                      {graphMode === "llm" && graphVizLLMData && (
                        <span className="text-xs text-muted-foreground">
                          {graphVizLLMData.nodes.length} 节点 · {graphVizLLMData.links.length} 关系
                        </span>
                      )}

                      {((graphMode === "regex" && graphVizData && graphVizData.nodes.length > 0) ||
                        (graphMode === "llm" && graphVizLLMData && graphVizLLMData.nodes.length > 0)) && (
                        <>
                          <GraphToolbar
                            onZoomOut={() => { const c = (graphMode === "regex" ? graphRegexChartRef : graphLLMChartRef).current?.getEchartsInstance(); if (!c) return; const z = (c.getOption().series as any[])?.[0]?.zoom ?? 1; c.setOption({ series: [{ zoom: z * 0.75 }] }, false) }}
                            onReset={() => { const c = (graphMode === "regex" ? graphRegexChartRef : graphLLMChartRef).current?.getEchartsInstance(); if (!c) return; c.setOption({ series: [{ zoom: 1 }] }, false) }}
                            onZoomIn={() => { const c = (graphMode === "regex" ? graphRegexChartRef : graphLLMChartRef).current?.getEchartsInstance(); if (!c) return; const z = (c.getOption().series as any[])?.[0]?.zoom ?? 1; c.setOption({ series: [{ zoom: z * 1.33 }] }, false) }}
                            panMode={graphPanMode}
                            onPanToggle={() => setGraphPanMode((p) => !p)}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setGraphVizFullscreen(true)}
                            title="全屏显示"
                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                            全屏
                          </Button>
                        </>
                      )}
                    </div>

                    {graphMode === "regex" && (
                      <p className="text-[11px] text-muted-foreground">
                        快速模式：用文本模式匹配提取实体，速度快；适合快速预览关联关系。
                      </p>
                    )}
                    {graphMode === "llm" && (
                      <p className="text-[11px] text-muted-foreground">
                        AI精准模式：用大模型逐文档提取私募基金公司/产品/策略/管理团队，准确率高。首次较慢；结果已缓存，再次点击只处理新增/修改文档。
                      </p>
                    )}

                    {graphMode === "regex" && graphVizError && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{graphVizError}</div>
                    )}
                    {graphMode === "llm" && graphVizLLMError && (
                      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{graphVizLLMError}</div>
                    )}

                    {graphMode === "regex" && !graphVizData && !graphVizLoading && !graphVizError && (
                      <div className="flex h-48 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                        点击「生成图谱」后可视化文档与实体关联
                      </div>
                    )}
                    {graphMode === "llm" && !graphVizLLMData && !graphVizLLMLoading && !graphVizLLMError && (
                      <div className="flex h-48 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                        点击「AI精准提取」，大模型分析每份文档，提取基金公司/产品/策略/团队成员
                      </div>
                    )}

                    {/* Regex graph */}
                    {graphMode === "regex" && graphVizData && graphVizData.nodes.length > 0 && (
                      <div className={cn("relative", graphPanMode && "cursor-grab active:cursor-grabbing")}>
                      <ReactECharts
                        ref={graphRegexChartRef}
                        style={{ height: "560px", width: "100%" }}
                        notMerge
                        option={{
                          backgroundColor: "transparent",
                          tooltip: {
                            trigger: "item",
                            formatter: (params: any) => {
                              if (params.dataType === "node") {
                                const labels: Record<string, string> = { document: "文档", company: "公司/机构", fund: "基金产品", person: "人员", other: "其他" }
                                return `<b>${params.data.name}</b><br/>类型：${labels[params.data.rawCategory] ?? "实体"}`
                              }
                              return ""
                            },
                          },
                          legend: [{ data: ["文档", "公司/机构", "基金产品", "人员", "其他"], top: 0, textStyle: { fontSize: 11 } }],
                          series: [{
                            type: "graph",
                            layout: "force",
                            animation: true,
                            roam: true,
                            draggable: true,
                            label: {
                              show: true,
                              position: "right",
                              fontSize: 10,
                              formatter: (p: any) => p.data.name.length > 16 ? p.data.name.slice(0, 15) + "…" : p.data.name,
                            },
                            edgeSymbol: ["none", "none"],
                            edgeLabel: { fontSize: 10 },
                            force: { repulsion: 200, gravity: 0.06, edgeLength: [70, 180], layoutAnimation: true },
                            categories: [
                              { name: "文档", itemStyle: { color: "#3b82f6" } },
                              { name: "公司/机构", itemStyle: { color: "#10b981" } },
                              { name: "基金产品", itemStyle: { color: "#f97316" } },
                              { name: "人员", itemStyle: { color: "#a855f7" } },
                              { name: "其他", itemStyle: { color: "#94a3b8" } },
                            ],
                            data: graphVizData.nodes.map((n) => {
                              const catIndex = { document: 0, company: 1, fund: 2, person: 3, other: 4 }[n.category] ?? 4
                              return {
                                id: n.id,
                                name: n.name,
                                rawCategory: n.category,
                                category: catIndex,
                                symbolSize: n.category === "document" ? 18 : n.category === "company" ? Math.max(10, Math.min(n.value * 2.5, 24)) : n.category === "fund" ? Math.max(10, Math.min(n.value * 2.5, 22)) : n.category === "person" ? 14 : Math.max(8, Math.min(n.value * 2, 14)),
                                value: n.value,
                              }
                            }),
                            links: graphVizData.links.map((l) => ({ source: l.source, target: l.target, lineStyle: { color: "#94a3b8", opacity: 0.4, width: 1 } })),
                            lineStyle: { color: "source", curveness: 0.1 },
                            emphasis: { focus: "adjacency", lineStyle: { width: 2 } },
                          }],
                        }}
                      />
                      </div>
                    )}
                    {graphMode === "regex" && graphVizData && graphVizData.nodes.length === 0 && (
                      <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                        当前范围没有可显示的图谱数据（请先上传并嵌入文档）
                      </div>
                    )}

                    {/* LLM-enhanced graph */}
                    {graphMode === "llm" && graphVizLLMData && graphVizLLMData.nodes.length > 0 && (
                      <div className={cn("relative", graphPanMode && "cursor-grab active:cursor-grabbing")}>
                      <ReactECharts
                        ref={graphLLMChartRef}
                        style={{ height: "560px", width: "100%" }}
                        notMerge
                        option={{
                          backgroundColor: "transparent",
                          tooltip: {
                            trigger: "item",
                            formatter: (params: any) => {
                              if (params.dataType === "node") {
                                const labels: Record<string, string> = { document: "文档", company: "基金公司", product: "基金产品", strategy: "投资策略", person: "团队成员" }
                                let tip = `<b>${params.data.name}</b><br/>类型：${labels[params.data.rawCategory] ?? "实体"}`
                                if (params.data.detail) tip += `<br/>职位：${params.data.detail}`
                                return tip
                              }
                              if (params.dataType === "edge") return `<span style="opacity:.7">${params.data.relation || ""}</span>`
                              return ""
                            },
                          },
                          legend: [{ data: ["文档", "基金公司", "基金产品", "投资策略", "团队成员"], top: 0, textStyle: { fontSize: 11 } }],
                          series: [{
                            type: "graph",
                            layout: "force",
                            animation: true,
                            roam: true,
                            draggable: true,
                            label: {
                              show: true,
                              position: "right",
                              fontSize: 10,
                              formatter: (p: any) => p.data.name.length > 16 ? p.data.name.slice(0, 15) + "…" : p.data.name,
                            },
                            edgeSymbol: ["none", "arrow"],
                            edgeSymbolSize: [4, 6],
                            edgeLabel: {
                              show: true,
                              fontSize: 9,
                              color: "#94a3b8",
                              formatter: (p: any) => p.data.relation || "",
                            },
                            force: { repulsion: 250, gravity: 0.05, edgeLength: [80, 200], layoutAnimation: true },
                            categories: [
                              { name: "文档", itemStyle: { color: "#3b82f6" } },
                              { name: "基金公司", itemStyle: { color: "#10b981" } },
                              { name: "基金产品", itemStyle: { color: "#f97316" } },
                              { name: "投资策略", itemStyle: { color: "#06b6d4" } },
                              { name: "团队成员", itemStyle: { color: "#a855f7" } },
                            ],
                            data: graphVizLLMData.nodes.map((n) => {
                              const catIndex = { document: 0, company: 1, product: 2, strategy: 3, person: 4 }[n.category] ?? 0
                              const sz = n.category === "document" ? 18
                                : n.category === "company" ? Math.max(12, Math.min(n.value * 3, 32))
                                : n.category === "product" ? Math.max(10, Math.min(n.value * 2.5, 26))
                                : n.category === "strategy" ? Math.max(10, Math.min(n.value * 2.5, 24))
                                : Math.max(10, Math.min(n.value * 2, 20))
                              return {
                                id: n.id,
                                name: n.name,
                                rawCategory: n.category,
                                detail: (n as any).detail,
                                category: catIndex,
                                symbolSize: sz,
                                symbol: n.category === "strategy" ? "diamond" : "circle",
                                value: n.value,
                              }
                            }),
                            links: graphVizLLMData.links.map((l) => ({
                              source: l.source,
                              target: l.target,
                              relation: l.relation,
                              lineStyle: { opacity: 0.45, width: 1 },
                            })),
                            lineStyle: { color: "source", curveness: 0.1 },
                            emphasis: { focus: "adjacency", lineStyle: { width: 2 } },
                          }],
                        }}
                      />
                      </div>
                    )}
                    {graphMode === "llm" && graphVizLLMData && graphVizLLMData.nodes.length === 0 && (
                      <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                        文档中未识别到有效的基金实体（请确认文档为私募基金路演/介绍材料）
                      </div>
                    )}

                    {/* Fullscreen overlay */}
                    {graphVizFullscreen && (
                      <div className="fixed inset-0 z-50 flex flex-col bg-background">
                        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
                          <span className="text-sm font-medium mr-auto">知识图谱{graphMode === "llm" ? "（AI精准）" : ""}</span>
                          <GraphToolbar
                            onZoomOut={() => { const c = (graphMode === "regex" ? graphRegexFsChartRef : graphLLMFsChartRef).current?.getEchartsInstance(); if (!c) return; const z = (c.getOption().series as any[])?.[0]?.zoom ?? 1; c.setOption({ series: [{ zoom: z * 0.75 }] }, false) }}
                            onReset={() => { const c = (graphMode === "regex" ? graphRegexFsChartRef : graphLLMFsChartRef).current?.getEchartsInstance(); if (!c) return; c.setOption({ series: [{ zoom: 1 }] }, false) }}
                            onZoomIn={() => { const c = (graphMode === "regex" ? graphRegexFsChartRef : graphLLMFsChartRef).current?.getEchartsInstance(); if (!c) return; const z = (c.getOption().series as any[])?.[0]?.zoom ?? 1; c.setOption({ series: [{ zoom: z * 1.33 }] }, false) }}
                            panMode={graphPanMode}
                            onPanToggle={() => setGraphPanMode((p) => !p)}
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => setGraphVizFullscreen(false)}
                          >
                            <Minimize2 className="h-3.5 w-3.5" />
                            退出全屏
                          </Button>
                        </div>
                        <div className={cn("min-h-0 flex-1", graphPanMode && "cursor-grab active:cursor-grabbing")}>
                          {graphMode === "regex" && graphVizData && graphVizData.nodes.length > 0 && (
                            <ReactECharts
                              ref={graphRegexFsChartRef}
                              style={{ height: "100%", width: "100%" }}
                              notMerge
                              option={{
                                backgroundColor: "transparent",
                                tooltip: {
                                  trigger: "item",
                                  formatter: (params: any) => {
                                    if (params.dataType === "node") {
                                      const labels: Record<string, string> = { document: "文档", company: "公司/机构", fund: "基金产品", person: "人员", other: "其他" }
                                      return `<b>${params.data.name}</b><br/>类型：${labels[params.data.rawCategory] ?? "实体"}`
                                    }
                                    return ""
                                  },
                                },
                                legend: [{ data: ["文档", "公司/机构", "基金产品", "人员", "其他"], top: 0, textStyle: { fontSize: 12 } }],
                                series: [{
                                  type: "graph",
                                  layout: "force",
                                  animation: true,
                                  roam: true,
                                  draggable: true,
                                  label: {
                                    show: true,
                                    position: "right",
                                    fontSize: 11,
                                    formatter: (p: any) => p.data.name.length > 18 ? p.data.name.slice(0, 17) + "…" : p.data.name,
                                  },
                                  edgeSymbol: ["none", "none"],
                                  force: { repulsion: 260, gravity: 0.05, edgeLength: [90, 220], layoutAnimation: true },
                                  categories: [
                                    { name: "文档", itemStyle: { color: "#3b82f6" } },
                                    { name: "公司/机构", itemStyle: { color: "#10b981" } },
                                    { name: "基金产品", itemStyle: { color: "#f97316" } },
                                    { name: "人员", itemStyle: { color: "#a855f7" } },
                                    { name: "其他", itemStyle: { color: "#94a3b8" } },
                                  ],
                                  data: graphVizData.nodes.map((n) => {
                                    const catIndex = { document: 0, company: 1, fund: 2, person: 3, other: 4 }[n.category] ?? 4
                                    return {
                                      id: n.id,
                                      name: n.name,
                                      rawCategory: n.category,
                                      category: catIndex,
                                      symbolSize: n.category === "document" ? 22 : n.category === "company" ? Math.max(12, Math.min(n.value * 3, 30)) : n.category === "fund" ? Math.max(12, Math.min(n.value * 3, 28)) : n.category === "person" ? 18 : Math.max(10, Math.min(n.value * 2.5, 18)),
                                      value: n.value,
                                    }
                                  }),
                                  links: graphVizData.links.map((l) => ({ source: l.source, target: l.target, lineStyle: { color: "#94a3b8", opacity: 0.4, width: 1 } })),
                                  lineStyle: { color: "source", curveness: 0.1 },
                                  emphasis: { focus: "adjacency", lineStyle: { width: 2 } },
                                }],
                              }}
                            />
                          )}
                          {graphMode === "llm" && graphVizLLMData && graphVizLLMData.nodes.length > 0 && (
                            <ReactECharts
                              ref={graphLLMFsChartRef}
                              style={{ height: "100%", width: "100%" }}
                              notMerge
                              option={{
                                backgroundColor: "transparent",
                                tooltip: {
                                  trigger: "item",
                                  formatter: (params: any) => {
                                    if (params.dataType === "node") {
                                      const labels: Record<string, string> = { document: "文档", company: "基金公司", product: "基金产品", strategy: "投资策略", person: "团队成员" }
                                      let tip = `<b>${params.data.name}</b><br/>类型：${labels[params.data.rawCategory] ?? "实体"}`
                                      if (params.data.detail) tip += `<br/>职位：${params.data.detail}`
                                      return tip
                                    }
                                    if (params.dataType === "edge") return `<span style="opacity:.7">${params.data.relation || ""}</span>`
                                    return ""
                                  },
                                },
                                legend: [{ data: ["文档", "基金公司", "基金产品", "投资策略", "团队成员"], top: 0, textStyle: { fontSize: 12 } }],
                                series: [{
                                  type: "graph",
                                  layout: "force",
                                  animation: true,
                                  roam: true,
                                  draggable: true,
                                  label: {
                                    show: true,
                                    position: "right",
                                    fontSize: 11,
                                    formatter: (p: any) => p.data.name.length > 18 ? p.data.name.slice(0, 17) + "…" : p.data.name,
                                  },
                                  edgeSymbol: ["none", "arrow"],
                                  edgeSymbolSize: [4, 7],
                                  edgeLabel: {
                                    show: true,
                                    fontSize: 10,
                                    color: "#94a3b8",
                                    formatter: (p: any) => p.data.relation || "",
                                  },
                                  force: { repulsion: 300, gravity: 0.04, edgeLength: [100, 250], layoutAnimation: true },
                                  categories: [
                                    { name: "文档", itemStyle: { color: "#3b82f6" } },
                                    { name: "基金公司", itemStyle: { color: "#10b981" } },
                                    { name: "基金产品", itemStyle: { color: "#f97316" } },
                                    { name: "投资策略", itemStyle: { color: "#06b6d4" } },
                                    { name: "团队成员", itemStyle: { color: "#a855f7" } },
                                  ],
                                  data: graphVizLLMData.nodes.map((n) => {
                                    const catIndex = { document: 0, company: 1, product: 2, strategy: 3, person: 4 }[n.category] ?? 0
                                    const sz = n.category === "document" ? 22
                                      : n.category === "company" ? Math.max(14, Math.min(n.value * 3.5, 36))
                                      : n.category === "product" ? Math.max(12, Math.min(n.value * 3, 30))
                                      : n.category === "strategy" ? Math.max(12, Math.min(n.value * 3, 28))
                                      : Math.max(12, Math.min(n.value * 2.5, 24))
                                    return {
                                      id: n.id,
                                      name: n.name,
                                      rawCategory: n.category,
                                      detail: (n as any).detail,
                                      category: catIndex,
                                      symbolSize: sz,
                                      symbol: n.category === "strategy" ? "diamond" : "circle",
                                      value: n.value,
                                    }
                                  }),
                                  links: graphVizLLMData.links.map((l) => ({
                                    source: l.source,
                                    target: l.target,
                                    relation: l.relation,
                                    lineStyle: { opacity: 0.45, width: 1 },
                                  })),
                                  lineStyle: { color: "source", curveness: 0.1 },
                                  emphasis: { focus: "adjacency", lineStyle: { width: 2 } },
                                }],
                              }}
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Server Folder Browser Dialog */}
            <Dialog open={showServerBrowser} onOpenChange={setShowServerBrowser}>
              <DialogContent className="flex max-h-[80vh] max-w-sm flex-col gap-0 p-0">
                <DialogHeader className="px-4 pb-2 pt-4">
                  <DialogTitle>选择服务器目录</DialogTitle>
                </DialogHeader>
                <ScrollArea className="flex-1 overflow-auto border-y px-2 py-2" style={{ maxHeight: "50vh" }}>
                  {tree && (
                    <ServerFolderBrowserTree
                      node={tree}
                      depth={0}
                      selectedPath={syncBrowserSelectedFolder}
                      onSelect={(path) => setSyncBrowserSelectedFolder(path)}
                      expanded={serverBrowserExpanded}
                      onToggle={(path) => {
                        setServerBrowserExpanded((prev) => {
                          const next = new Set(prev)
                          if (next.has(path)) next.delete(path)
                          else next.add(path)
                          return next
                        })
                      }}
                    />
                  )}
                </ScrollArea>
                <DialogFooter className="px-4 py-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowServerBrowser(false)}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    disabled={syncBrowserSelectedFolder === undefined}
                    onClick={() => {
                      setSyncServerFolder(syncBrowserSelectedFolder ?? null)
                      setSyncPreviewItems(null)
                      setSyncPendingFiles(null)
                      setShowServerBrowser(false)
                    }}
                  >
                    确定
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Move Folder Dialog */}
            <Dialog open={!!moveFolderSource} onOpenChange={(open) => { if (!open) setMoveFolderSource(null) }}>
              <DialogContent className="flex max-h-[80vh] max-w-sm flex-col gap-0 p-0">
                <DialogHeader className="px-4 pb-2 pt-4">
                  <DialogTitle>移动文件夹「{moveFolderSource?.name}」到...</DialogTitle>
                </DialogHeader>
                <ScrollArea className="flex-1 overflow-auto border-y px-2 py-2" style={{ maxHeight: "50vh" }}>
                  {tree && (
                    <ServerFolderBrowserTree
                      node={tree}
                      depth={0}
                      selectedPath={moveFolderTarget}
                      onSelect={(path) => setMoveFolderTarget(path)}
                      expanded={moveFolderExpanded}
                      onToggle={handleMoveTargetToggle}
                    />
                  )}
                </ScrollArea>
                <DialogFooter className="px-4 py-3">
                  <Button size="sm" variant="outline" onClick={() => setMoveFolderSource(null)} disabled={moveFolderLoading}>
                    取消
                  </Button>
                  <Button size="sm" disabled={moveFolderLoading || moveFolderTarget === null} onClick={() => void confirmMoveFolder()}>
                    {moveFolderLoading ? <><LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />移动中...</> : "确认移动"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            </section>
          </ResizablePanel>

          <ResizableHandle withHandle className="mx-1" />

          <ResizablePanel defaultSize={58} minSize={30}>
            <section className="sticky top-0 flex h-[calc(100vh-8rem)] flex-col overflow-hidden pl-4 lg:pl-6">
            {/* Chat panel header */}
            <div className="space-y-2 pb-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">知识库问答</h2>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => void handleReindex()}
                  disabled={reindexing}
                  title="清除索引缓存，下次提问时重新嵌入"
                >
                  <RefreshCw className={cn("h-4 w-4", reindexing && "animate-spin")} />
                  {reindexing ? "索引中..." : "重新索引"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleDownloadConversation}
                  disabled={!chatMessages.some((m) => m.role === "user")}
                  title="下载当前对话"
                >
                  <Download className="h-4 w-4" />
                  分享
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={handleToggleSettingsSidebar}
                  title="检索设置"
                >
                  <Settings2 className="h-4 w-4" />
                  设置
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => void handleToggleConvSidebar()}
                  title="对话历史"
                >
                  <History className="h-4 w-4" />
                  历史记录
                </Button>
              </div>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4" />
                  <span>当前检索范围：{selectedDocument ? selectedDocument.name : (selectedFolder || "全部资料")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  <span>{selectedDocument ? "1 个文件" : currentFolderSummary}</span>
                </div>
              </div>
            </div>

            {/* Main chat + history sidebar layout */}
            <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
              {/* Conversation history sidebar */}
              {showConvSidebar && (
                <div className="flex w-52 shrink-0 flex-col gap-2 overflow-hidden border-r pr-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2 text-xs"
                    onClick={() => void handleNewConversation()}
                  >
                    <Plus className="h-3 w-3" />
                    新对话
                  </Button>
                  <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-track]:transparent [&:hover::-webkit-scrollbar-thumb]:bg-border/60">
                    <div className="space-y-1">
                      {conversations.length === 0 && (
                        <p className="px-1 py-3 text-center text-xs text-muted-foreground">暂无对话记录</p>
                      )}
                      {conversations.map((conv) => (
                        <div
                          key={conv.id}
                          className={cn(
                            "group flex cursor-pointer items-start gap-1 rounded-md px-2 py-2 text-xs transition-colors hover:bg-muted/50",
                            activeConversationId === conv.id && "bg-muted",
                          )}
                          onClick={() => renamingConvId !== conv.id && void handleLoadConversation(conv.id)}
                        >
                          <div className="min-w-0 flex-1">
                            {renamingConvId === conv.id ? (
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleRenameConversation(conv.id, renameValue)
                                  if (e.key === "Escape") setRenamingConvId(null)
                                  e.stopPropagation()
                                }}
                                onBlur={() => void handleRenameConversation(conv.id, renameValue)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full rounded bg-background px-1 py-0.5 text-xs outline-none ring-1 ring-primary"
                              />
                            ) : (
                              <div className="truncate font-medium leading-tight">{conv.title}</div>
                            )}
                            <div className="mt-0.5 flex items-center gap-1 text-muted-foreground">
                              <Clock className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{new Date(conv.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                                onClick={(e) => e.stopPropagation()}
                                title="更多操作"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-28">
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setRenamingConvId(conv.id); setRenameValue(conv.title) }}>
                                <Pencil className="mr-2 h-3.5 w-3.5" />
                                重命名
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => void handleDeleteConversation(conv.id, e)}>
                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                                删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {showSettingsSidebar && (
                <div className="flex w-52 shrink-0 flex-col gap-2 overflow-hidden border-r pr-3">
                  <div className="rounded-md border p-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">检索设置</div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs">启用 BM25</span>
                      <Switch checked={useBm25} onCheckedChange={setUseBm25} />
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">开启后使用 向量 + BM25 混合检索；关闭后仅向量检索。</p>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-xs">Graph RAG</span>
                      <Switch checked={useGraphRag} onCheckedChange={setUseGraphRag} />
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">开启后通过知识图谱实体关联扩展检索上下文，适合跨文档关联查询。</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">问答模式</div>
                    <div className="grid grid-cols-2 gap-1">
                      <button type="button" onClick={() => { setQueryMode("superfast"); setUseBm25(false); setUseGraphRag(false); }} className={cn("rounded px-2 py-1 text-xs transition-colors", queryMode === "superfast" ? "bg-primary text-primary-foreground" : "border hover:bg-muted")}>⚡ 超速（默认）</button>
                      <button type="button" onClick={() => { setQueryMode("accurate"); setUseBm25(true); }} className={cn("rounded px-2 py-1 text-xs transition-colors", queryMode === "accurate" ? "bg-primary text-primary-foreground" : "border hover:bg-muted")}>🎯 精准 (~10s)</button>
                      <button type="button" onClick={() => { setQueryMode("deep"); setUseBm25(true); }} className={cn("rounded px-2 py-1 text-xs transition-colors", queryMode === "deep" ? "bg-primary text-primary-foreground" : "border hover:bg-muted")}>🔬 全面扫描</button>
                      <button type="button" onClick={() => { setQueryMode("thinking"); setUseBm25(true); }} className={cn("rounded px-2 py-1 text-xs transition-colors", queryMode === "thinking" ? "bg-primary text-primary-foreground" : "border hover:bg-muted")}>🧠 深度思考</button>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">超速：turbo+纯向量，3-5秒；精准：plus+BM25，约10秒；全面扫描：top-20 检索，适合列举全部；深度思考：qwen-max + top-40 检索，适合复杂分析。</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">索引覆盖检查</div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleCheckIndexCoverage()}
                        disabled={indexInfoLoading}
                        className="flex-1 rounded border px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-50"
                      >
                        {indexInfoLoading ? <><LoaderCircle className="mr-1 inline h-3 w-3 animate-spin" />检查中...</> : "检查状态"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleStartEmbed()}
                        title={`向量化「${selectedFolder || "全部资料"}」`}
                        className="flex-1 rounded border border-primary/40 bg-primary/5 px-2 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10"
                      >
                        向量化
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDedup()}
                      disabled={deduping}
                      title={`扫描「${selectedFolder || "全部资料"}」并删除内容相同的重复文件`}
                      className="mt-1.5 w-full rounded border px-2 py-1.5 text-xs transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {deduping ? <><LoaderCircle className="mr-1 inline h-3 w-3 animate-spin" />去重中...</> : "去重（删除重复文件）"}
                    </button>
                    {indexInfo && (
                      <div className="mt-2 space-y-1.5 text-[11px]">
                        {indexInfo.diskIndex.exists ? (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">覆盖率</span>
                              <span className={cn("font-semibold", indexInfo.coverage.percentIndexed === 100 ? "text-green-600" : "text-amber-600")}>
                                {indexInfo.coverage.percentIndexed}%
                              </span>
                            </div>
                            <Progress value={indexInfo.coverage.percentIndexed} className="h-1.5" />
                            <div className="flex justify-between text-muted-foreground">
                              <span>已嵌入 {indexInfo.coverage.indexed} / {indexInfo.coverage.totalOnDisk} 文件</span>
                              {indexInfo.coverage.notIndexed > 0 && <span className="text-amber-600">{indexInfo.coverage.notIndexed} 未索引</span>}
                            </div>
                            <div className="text-muted-foreground">
                              向量块 {indexInfo.diskIndex.indexedChunks}
                            </div>
                            {indexInfo.diskIndex.updatedAt && (
                              <div className="text-muted-foreground truncate" title={indexInfo.diskIndex.updatedAt}>
                                更新于 {new Date(indexInfo.diskIndex.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </div>
                            )}
                            {indexInfo.coverage.notIndexed > 0 && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-amber-600">未嵌入文件 ({indexInfo.coverage.notIndexed})</summary>
                                <ul className="mt-1 max-h-32 overflow-y-auto space-y-0.5 text-muted-foreground">
                                  {indexInfo.notIndexedFiles.map((f) => (
                                    <li key={f} className="truncate" title={f}>· {f.split("/").pop()}</li>
                                  ))}
                                  {indexInfo.coverage.notIndexed > indexInfo.notIndexedFiles.length && (
                                    <li className="text-muted-foreground">...还有 {indexInfo.coverage.notIndexed - indexInfo.notIndexedFiles.length} 个</li>
                                  )}
                                </ul>
                              </details>
                            )}
                          </>
                        ) : (
                          <p className="text-amber-600">尚无索引缓存，请先发送一条问题或点击"嵌入"以触发向量化。</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Chat messages */}
              <div
                ref={traditionalChatScrollRef}
                className="min-h-0 flex-1 overflow-y-auto pr-1"
                onScroll={(e) => {
                  const el = e.currentTarget
                  const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
                  userScrolledRef.current = fromBottom > 80
                }}
              >
                <div className="space-y-4">
                  {chatMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={cn(
                        "rounded-lg px-4 py-3 text-sm shadow-sm",
                        message.role === "assistant" ? "bg-muted/30" : "bg-card",
                      )}
                    >
                      <div className="mb-2 text-xs font-medium tracking-wide text-muted-foreground">
                        {message.role === "assistant" ? "AI 助手" : "你"}
                      </div>
                      <div className="whitespace-pre-wrap leading-6">{message.content}</div>
                      {message.sources && message.sources.length > 0 && (
                        <div className="mt-3 text-xs text-muted-foreground">引用文件：{message.sources.join("，")}</div>
                      )}
                    </div>
                  ))}
                  {chatLoading && !(chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === "assistant") && (
                    <div className="rounded-lg bg-muted/30 px-4 py-3 text-sm text-muted-foreground shadow-sm">
                      <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />
                      {chatPhase === "searching" ? "正在检索本地知识库..." : chatPhase === "generating" ? "正在生成回答..." : "正在检索文档并生成回答..."}
                      <span className="ml-2 tabular-nums">{chatElapsed}s</span>
                      {chatPhase && (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {chatPhase === "searching" ? "🔍 本地检索" : "☁️ 云端生成"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t bg-background pt-4">
              <div className="space-y-3">
                <Textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={handleQuestionKeyDown}
                  placeholder="例如：总结当前资料中的核心观点；如果库里没有文件，就直接给我一个市场判断。"
                  className="min-h-32"
                />
                <div className="flex items-center justify-end gap-2">
                  {chatLoading ? (
                    <Button variant="outline" onClick={handleStop} className="border-red-400/60 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20">
                      <Square className="h-4 w-4 fill-current" />
                      停止生成
                    </Button>
                  ) : (
                    <Button disabled={!question.trim()} onClick={() => void handleAsk()}>
                      <Send className="h-4 w-4" />
                      发送问题
                    </Button>
                  )}
                </div>
              </div>
            </div>
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Move Folder Dialog */}
        <Dialog open={!!moveFolderSource} onOpenChange={(open) => { if (!open) setMoveFolderSource(null) }}>
          <DialogContent className="flex max-h-[80vh] max-w-sm flex-col gap-0 p-0">
            <DialogHeader className="px-4 pb-2 pt-4">
              <DialogTitle>移动文件夹「{moveFolderSource?.name}」到...</DialogTitle>
            </DialogHeader>
            <ScrollArea className="flex-1 overflow-auto border-y px-2 py-2" style={{ maxHeight: "50vh" }}>
              {tree && (
                <ServerFolderBrowserTree
                  node={tree}
                  depth={0}
                  selectedPath={moveFolderTarget}
                  onSelect={(path) => setMoveFolderTarget(path)}
                  expanded={moveFolderExpanded}
                  onToggle={handleMoveTargetToggle}
                />
              )}
            </ScrollArea>
            <DialogFooter className="px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => setMoveFolderSource(null)} disabled={moveFolderLoading}>
                取消
              </Button>
              <Button size="sm" disabled={moveFolderLoading || moveFolderTarget === null} onClick={() => void confirmMoveFolder()}>
                {moveFolderLoading ? <><LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />移动中...</> : "确认移动"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#11314f,transparent_35%),linear-gradient(180deg,#020617_0%,#020b17_45%,#000000_100%)] text-cyan-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-col gap-4 rounded-3xl border border-cyan-500/20 bg-black/40 p-6 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-3 text-cyan-300">
              <BrainCircuit className="h-5 w-5" />
              <span className="text-sm uppercase tracking-[0.25em]">AI Knowledge Base</span>
            </div>
            <h1 className="text-3xl font-semibold text-white">AI知识库</h1>
            <p className="mt-2 max-w-3xl text-sm text-cyan-200/70">
              文档目录保存在服务器外部路径，部署更新时不会被项目覆盖。左侧负责文件夹和资料管理，右侧负责基于 DashScope Qwen 的检索问答。
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="border-cyan-500/50 bg-transparent text-cyan-200" onClick={() => void refreshTree()}>
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              刷新资料库
            </Button>
            <Button className="bg-cyan-600 text-white hover:bg-cyan-500" onClick={() => router.push(backHref)}>
              {backLabel}
            </Button>
          </div>
        </div>

        {error && <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <Card className="border-cyan-500/20 bg-black/45 shadow-none">
              <CardHeader>
                <CardTitle>资料目录</CardTitle>
                <CardDescription>服务器目录：{storageRoot || "加载中..."}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                  <Input
                    ref={singleUploadInputRef}
                    type="file"
                    onChange={(event) => setPendingFile(event.target.files?.[0] || null)}
                    className="border-cyan-500/25 bg-black/30 text-cyan-100"
                  />
                  <Button disabled={!pendingFile || uploading} className="bg-cyan-600 hover:bg-cyan-500" onClick={() => void handleUpload()}>
                    <Upload className="h-4 w-4" />
                    {uploading ? "上传中..." : "上传文档"}
                  </Button>
                </div>

                <div className="flex flex-wrap gap-3">
                  <input
                    ref={batchUploadInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleBatchUploadChange}
                    {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                  />
                  <Button type="button" variant="outline" className="border-cyan-500/40 text-cyan-200" disabled={batchUploading} onClick={() => batchUploadInputRef.current?.click()}>
                    <FolderOpen className="h-4 w-4" />
                    {batchUploading ? "批量上传中..." : "批量上传"}
                  </Button>
                  <div className="self-center text-xs text-cyan-300/75">可直接选择整个文件夹，保留内部目录结构。</div>
                </div>

                {batchUploading && (
                  <div className="space-y-2">
                    <Progress value={batchUploadProgress} className="h-2 bg-cyan-500/15" />
                    <div className="text-xs text-cyan-300/75">{batchUploadSummary} · {batchUploadProgress}%</div>
                  </div>
                )}

                {/* Embed job progress bar */}
                {embedJob && (
                  <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 px-3 py-2 text-sm space-y-1.5">
                    <div className="flex items-center gap-2">
                      {embedJob.status === "done" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-400" />
                      ) : embedJob.status === "error" ? (
                        <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                      ) : (
                        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-cyan-400" />
                      )}
                      <span className={cn(
                        "flex-1 truncate text-xs",
                        embedJob.status === "error" ? "text-red-400" : "text-cyan-300"
                      )}>
                        {embedJob.message}
                      </span>
                      {embedJob.totalFiles > 0 && (
                        <span className="shrink-0 text-xs text-cyan-300/60">
                          {embedJob.processedFiles}/{embedJob.totalFiles}
                        </span>
                      )}
                    </div>
                    {embedJob.status !== "error" && (
                      <Progress
                        value={embedJob.totalFiles > 0
                          ? (embedJob.processedFiles / embedJob.totalFiles) * 100
                          : (embedJob.status === "running" ? 10 : 5)}
                        className="h-1.5 bg-cyan-500/15 [&>div]:bg-cyan-400"
                      />
                    )}
                  </div>
                )}

                <div className="text-xs text-cyan-300/75">支持图片、Word、Excel、CSV、PDF、TXT 等常见资料文件。</div>

                <div className="rounded-xl border border-cyan-500/15 bg-black/25 px-3 py-2 text-xs text-cyan-300/80">
                  当前问答范围：{selectedFolder || "全部资料"}
                </div>

                <ScrollArea className="h-[460px] rounded-xl border border-cyan-500/15 bg-black/20 p-3">
                  <div className="space-y-3 pr-3">{tree ? renderExplorer("cyber") : <div className="text-sm text-cyan-400/70">暂无资料</div>}</div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="border-cyan-500/20 bg-black/45 shadow-none">
              <CardHeader>
                <div ref={cyberPreviewHeaderRef} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle>文档预览</CardTitle>
                    <CardDescription title={selectedDocument?.relativePath || ""}>
                      {selectedDocument
                        ? `${truncateMiddle(selectedDocument.relativePath)} · ${formatFileSize(selectedDocument.size)}`
                        : "选择左侧文档后可查看内容"}
                    </CardDescription>
                  </div>
                  <Button type="button" variant="outline" className="border-cyan-500/40 text-cyan-200" onClick={() => {
                    setSelectedDocument(null)
                    setPreviewMode("empty")
                    setPreviewContent("")
                  }}>
                    <ChevronLeft className="h-4 w-4" />
                    返回
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="min-h-[360px] rounded-2xl border border-cyan-500/15 bg-black/30 p-4">
                  {previewLoading && (
                    <div className="flex h-[320px] items-center justify-center text-cyan-300">
                      <LoaderCircle className="mr-3 h-5 w-5 animate-spin" />
                      正在加载文档...
                    </div>
                  )}

                  {!previewLoading && previewMode === "text" && (
                    <ScrollArea className="h-[320px] rounded-lg bg-black/30 p-3">
                      <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-cyan-100">{previewContent}</pre>
                    </ScrollArea>
                  )}

                      {!previewLoading && previewMode === "html" && (
                        <iframe
                          srcDoc={previewContent}
                          className="h-[320px] w-full rounded-lg border border-cyan-500/15 bg-white"
                          title={selectedDocument?.name || "文档预览"}
                          sandbox=""
                        />
                      )}

                  {!previewLoading && previewMode === "image" && selectedDocument && (
                    <div className="flex h-[320px] items-center justify-center overflow-hidden rounded-lg bg-black/30 p-3">
                      <img src={buildFileUrl(selectedDocument.relativePath)} alt={selectedDocument.name} className="max-h-full max-w-full object-contain" />
                    </div>
                  )}

                  {!previewLoading && previewMode === "frame" && selectedDocument && (
                    <iframe
                      key={selectedDocument.relativePath}
                      src={buildFileUrl(selectedDocument.relativePath)}
                      className="h-[320px] w-full rounded-lg border border-cyan-500/15 bg-white"
                      title={selectedDocument.name}
                    />
                  )}

                  {!previewLoading && previewMode === "empty" && (
                    <div className="flex h-[320px] items-center justify-center text-sm text-cyan-400/70">
                      暂无预览内容。txt、csv、json、Word、Excel 支持文本预览；图片支持直接查看；html、pdf 使用内嵌查看。
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-cyan-500/20 bg-black/45 shadow-none">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>知识库问答</CardTitle>
                  <CardDescription>
                    基于 LangChain 检索结构 + DashScope Qwen 聊天模型与 Embeddings。请先在服务器配置 DASHSCOPE_API_KEY。
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs text-cyan-400/70 hover:text-cyan-300"
                  onClick={handleToggleSettingsSidebar}
                  title="检索设置"
                >
                  <Settings2 className="h-4 w-4" />
                  设置
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs text-cyan-400/70 hover:text-cyan-300"
                  onClick={() => void handleToggleConvSidebar()}
                  title="对话历史"
                >
                  <History className="h-4 w-4" />
                  历史记录
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs text-cyan-400/70 hover:text-cyan-300"
                  onClick={handleDownloadConversation}
                  disabled={!chatMessages.some((m) => m.role === "user")}
                  title="下载当前对话为文本文件"
                >
                  <Download className="h-4 w-4" />
                  分享
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex h-[calc(100vh-15rem)] min-h-[720px] flex-col gap-4">
              {/* Embed in-progress warning in chat area */}
              {embedJob && (embedJob.status === "queued" || embedJob.status === "running") && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-950/20 px-4 py-2.5 text-xs text-amber-300">
                  <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span className="flex-1">正在将新文件向量化（{embedJob.processedFiles}/{embedJob.totalFiles || "?"} 文档），完成后提问速度将恢复正常。</span>
                </div>
              )}

              <div className="flex items-center justify-between rounded-xl border border-cyan-500/15 bg-black/25 px-4 py-3 text-sm text-cyan-300/80">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span>提问范围：{selectedDocument ? selectedDocument.name : (selectedFolder || "全部资料")}</span>
                </div>
                <div>{selectedDocument ? "1 个文件" : currentFolderSummary}</div>
              </div>

              {/* Conversation history sidebar + messages */}
              <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
                {showConvSidebar && (
                  <div className="flex w-52 shrink-0 flex-col gap-2 overflow-hidden rounded-xl border border-cyan-500/15 bg-black/25 p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2 text-xs text-cyan-300 hover:bg-cyan-500/10"
                      onClick={() => void handleNewConversation()}
                    >
                      <Plus className="h-3 w-3" />
                      新对话
                    </Button>
                    <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent [&::-webkit-scrollbar-track]:transparent [&:hover::-webkit-scrollbar-thumb]:bg-cyan-400/30">
                      <div className="space-y-0.5">
                        {conversations.length === 0 && (
                          <p className="px-1 py-3 text-center text-xs text-cyan-300/50">暂无对话记录</p>
                        )}
                        {conversations.map((conv) => (
                          <div
                            key={conv.id}
                            className={cn(
                              "group flex cursor-pointer items-start gap-1 rounded-lg px-2 py-2 text-xs transition-colors hover:bg-cyan-500/10",
                              activeConversationId === conv.id && "bg-cyan-500/15",
                            )}
                            onClick={() => renamingConvId !== conv.id && void handleLoadConversation(conv.id)}
                          >
                            <div className="min-w-0 flex-1">
                              {renamingConvId === conv.id ? (
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void handleRenameConversation(conv.id, renameValue)
                                    if (e.key === "Escape") setRenamingConvId(null)
                                    e.stopPropagation()
                                  }}
                                  onBlur={() => void handleRenameConversation(conv.id, renameValue)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full rounded border border-cyan-400/40 bg-black/40 px-1 py-0.5 text-xs text-cyan-100 outline-none ring-1 ring-cyan-400/60"
                                />
                              ) : (
                                <div className="truncate font-medium leading-tight text-cyan-100">{conv.title}</div>
                              )}
                              <div className="mt-0.5 flex items-center gap-1 text-cyan-300/50">
                                <Clock className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">{new Date(conv.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                              </div>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="mt-0.5 shrink-0 rounded p-0.5 text-cyan-300/30 opacity-0 transition-opacity hover:text-cyan-200 group-hover:opacity-100"
                                  onClick={(e) => e.stopPropagation()}
                                  title="更多操作"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-28">
                                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setRenamingConvId(conv.id); setRenameValue(conv.title) }}>
                                  <Pencil className="mr-2 h-3.5 w-3.5" />
                                  重命名
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={(e) => void handleDeleteConversation(conv.id, e)}>
                                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                                  删除
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {showSettingsSidebar && (
                  <div className="flex w-52 shrink-0 flex-col gap-2 overflow-hidden rounded-xl border border-cyan-500/15 bg-black/25 p-3">
                    <div className="text-xs font-medium text-cyan-300/80">检索设置</div>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan-500/20 bg-black/20 px-2 py-2 text-xs">
                      <span>启用 BM25</span>
                      <Switch checked={useBm25} onCheckedChange={setUseBm25} />
                    </div>
                    <p className="text-[11px] text-cyan-300/60">开启后使用 向量 + BM25 混合检索；关闭后仅向量检索。</p>
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-cyan-500/20 bg-black/20 px-2 py-2 text-xs">
                      <span>Graph RAG</span>
                      <Switch checked={useGraphRag} onCheckedChange={setUseGraphRag} />
                    </div>
                    <p className="text-[11px] text-cyan-300/60">开启后通过知识图谱实体关联扩展检索上下文，适合跨文档关联查询。</p>
                    <div className="mt-1 text-xs font-medium text-cyan-300/80">问答模式</div>
                    <div className="grid grid-cols-2 gap-1">
                      <button type="button" onClick={() => { setQueryMode("superfast"); setUseBm25(false); setUseGraphRag(false); }} className={cn("rounded-lg border px-2 py-1 text-xs transition-colors", queryMode === "superfast" ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100" : "border-cyan-500/20 bg-black/20 text-cyan-300/60 hover:bg-cyan-500/10")}>⚡ 超速（默认）</button>
                      <button type="button" onClick={() => { setQueryMode("accurate"); setUseBm25(true); }} className={cn("rounded-lg border px-2 py-1 text-xs transition-colors", queryMode === "accurate" ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100" : "border-cyan-500/20 bg-black/20 text-cyan-300/60 hover:bg-cyan-500/10")}>🎯 精准 (~10s)</button>
                      <button type="button" onClick={() => { setQueryMode("deep"); setUseBm25(true); }} className={cn("rounded-lg border px-2 py-1 text-xs transition-colors", queryMode === "deep" ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100" : "border-cyan-500/20 bg-black/20 text-cyan-300/60 hover:bg-cyan-500/10")}>🔬 全面扫描</button>
                      <button type="button" onClick={() => { setQueryMode("thinking"); setUseBm25(true); }} className={cn("rounded-lg border px-2 py-1 text-xs transition-colors", queryMode === "thinking" ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100" : "border-cyan-500/20 bg-black/20 text-cyan-300/60 hover:bg-cyan-500/10")}>🧠 深度思考</button>
                    </div>
                    <p className="text-[11px] text-cyan-300/60">超速：turbo+纯向量，3-5秒；精准：plus+BM25，约10秒；全面扫描：top-20 检索，适合列举全部；深度思考：qwen-max + top-40 检索，适合复杂分析。</p>
                    <div className="mt-1 text-xs font-medium text-cyan-300/80">索引覆盖检查</div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleCheckIndexCoverage()}
                        disabled={indexInfoLoading}
                        className="flex-1 rounded-lg border border-cyan-500/20 bg-black/20 px-2 py-1.5 text-xs text-cyan-300/80 transition-colors hover:bg-cyan-500/10 disabled:opacity-50"
                      >
                        {indexInfoLoading ? <><LoaderCircle className="mr-1 inline h-3 w-3 animate-spin" />检查中...</> : "检查状态"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleStartEmbed()}
                        title={`向量化「${selectedFolder || "全部资料"}」`}
                        className="flex-1 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-2 py-1.5 text-xs text-cyan-300 transition-colors hover:bg-cyan-500/20"
                      >
                        向量化
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDedup()}
                      disabled={deduping}
                      title={`扫描「${selectedFolder || "全部资料"}」并删除内容相同的重复文件`}
                      className="mt-1 w-full rounded-lg border border-cyan-500/20 bg-black/20 px-2 py-1.5 text-xs text-cyan-300/70 transition-colors hover:bg-cyan-500/10 disabled:opacity-50"
                    >
                      {deduping ? <><LoaderCircle className="mr-1 inline h-3 w-3 animate-spin" />去重中...</> : "去重（删除重复文件）"}
                    </button>
                    {indexInfo && (
                      <div className="space-y-1 text-[11px]">
                        {indexInfo.diskIndex.exists ? (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-cyan-300/60">覆盖率</span>
                              <span className={cn("font-semibold", indexInfo.coverage.percentIndexed === 100 ? "text-green-400" : "text-amber-400")}>
                                {indexInfo.coverage.percentIndexed}%
                              </span>
                            </div>
                            <Progress value={indexInfo.coverage.percentIndexed} className="h-1.5" />
                            <div className="flex justify-between text-cyan-300/60">
                              <span>{indexInfo.coverage.indexed}/{indexInfo.coverage.totalOnDisk} 文件</span>
                              {indexInfo.coverage.notIndexed > 0 && <span className="text-amber-400">{indexInfo.coverage.notIndexed} 未索引</span>}
                            </div>
                            <div className="text-cyan-300/60">向量块 {indexInfo.diskIndex.indexedChunks}</div>
                            {indexInfo.diskIndex.updatedAt && (
                              <div className="truncate text-cyan-300/50" title={indexInfo.diskIndex.updatedAt}>
                                {new Date(indexInfo.diskIndex.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                              </div>
                            )}
                            {indexInfo.coverage.notIndexed > 0 && (
                              <details className="mt-0.5">
                                <summary className="cursor-pointer text-amber-400">未嵌入 ({indexInfo.coverage.notIndexed})</summary>
                                <ul className="mt-1 max-h-28 overflow-y-auto space-y-0.5 text-cyan-300/50">
                                  {indexInfo.notIndexedFiles.map((f) => (
                                    <li key={f} className="truncate" title={f}>· {f.split("/").pop()}</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </>
                        ) : (
                          <p className="text-amber-400">尚无索引缓存，发送问题后触发向量化。</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <ScrollArea className="flex-1 rounded-2xl border border-cyan-500/15 bg-black/30 p-4">
                  <div className="space-y-4 pr-3">
                    {chatMessages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={cn(
                          "rounded-2xl border px-4 py-3 text-sm leading-6",
                          message.role === "assistant"
                            ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-50"
                            : "border-white/10 bg-white/5 text-white",
                        )}
                      >
                        <div className="mb-2 text-xs uppercase tracking-[0.2em] text-cyan-300/70">
                          {message.role === "assistant" ? "AI 助手" : "你"}
                        </div>
                        <div className="whitespace-pre-wrap">{message.content}</div>
                        {message.sources && message.sources.length > 0 && (
                          <div className="mt-3 rounded-lg border border-cyan-500/20 bg-black/20 px-3 py-2 text-xs text-cyan-200/80">
                            引用文件：{message.sources.join("，")}
                          </div>
                        )}
                      </div>
                    ))}
                    {chatLoading && !(chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === "assistant") && (
                      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-50">
                        <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />
                        {chatPhase === "searching" ? "正在检索本地知识库..." : chatPhase === "generating" ? "正在生成回答..." : "正在检索文档并生成回答..."}
                        <span className="ml-2 tabular-nums opacity-70">{chatElapsed}s</span>
                        {chatPhase && (
                          <span className="ml-2 rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs font-medium text-cyan-300">
                            {chatPhase === "searching" ? "🔍 本地检索" : "☁️ 云端生成"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>

              <div className="space-y-3">
                <Textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={handleQuestionKeyDown}
                  placeholder="例如：根据当前文件夹资料，总结近一周市场的主要变化，并给出对应文件来源。"
                  className="min-h-32 border-cyan-500/25 bg-black/30 text-cyan-100"
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-cyan-400/70">支持针对所选文件夹问答；未选择文件夹时默认检索全部资料。</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {chatLoading ? (
                      <Button onClick={handleStop} className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20">
                        <Square className="h-4 w-4 fill-current" />
                        停止生成
                      </Button>
                    ) : (
                      <Button disabled={!question.trim()} className="bg-cyan-600 hover:bg-cyan-500" onClick={() => void handleAsk()}>
                        <Send className="h-4 w-4" />
                        发送问题
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function getNameExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".")
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ""
}

function replacePathPrefix(pathValue: string, oldPrefix: string, newPrefix: string) {
  if (pathValue === oldPrefix) {
    return newPrefix
  }
  if (!pathValue.startsWith(`${oldPrefix}/`)) {
    return pathValue
  }
  const suffix = pathValue.slice(oldPrefix.length)
  if (!newPrefix) {
    return suffix.replace(/^\//, "")
  }
  return `${newPrefix}${suffix}`
}