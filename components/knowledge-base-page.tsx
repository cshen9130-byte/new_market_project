"use client"

import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  ChevronLeft,
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
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  Upload,
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
  const [isDragOver, setIsDragOver] = useState(false)
  const [batchUploading, setBatchUploading] = useState(false)
  const [batchUploadProgress, setBatchUploadProgress] = useState(0)
  const [batchUploadSummary, setBatchUploadSummary] = useState("")
  const [deletingPath, setDeletingPath] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [question, setQuestion] = useState("")
  const [chatLoading, setChatLoading] = useState(false)
  const [previewScrollToken, setPreviewScrollToken] = useState(0)
  const [selectedExplorerEntry, setSelectedExplorerEntry] = useState<{ kind: "folder" | "file"; relativePath: string } | null>(null)
  const [traditionalPanel, setTraditionalPanel] = useState<"library" | "preview" | "upload" | "folder" | "sync">("library")
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
  const [useBm25, setUseBm25] = useState(true)
  const [modelMode, setModelMode] = useState<"auto" | "plus" | "turbo" | "reasoning">("auto")

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
    if (variant !== "traditional") {
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

      setPendingFile(null)
      if (singleUploadInputRef.current) {
        singleUploadInputRef.current.value = ""
      }
      setUploadTargetFolder(null)
      await refreshTree()
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
    if (!files || files.length === 0) return
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
    setSyncWebkitFiles(collected)
    setSyncLocalDirHandle(null)
    setSyncLocalDirName(folderName || "本地文件夹")
    setSyncPreviewItems(null)
    setSyncPendingFiles(null)
    // Reset input so same folder can be re-selected
    if (syncFolderInputRef.current) syncFolderInputRef.current.value = ""
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

  async function handleCompare() {
    const hasLocal = syncLocalDirHandle !== null || syncWebkitFiles !== null
    if (!hasLocal || syncServerFolder === null) return
    try {
      setError(null)
      setSyncPreviewItems(null)
      setSyncPendingFiles(null)
      const localFiles = syncWebkitFiles ?? await collectLocalFiles(syncLocalDirHandle!)
      const serverFileMap = new Map<string, number>(syncServerFiles.map((sf) => [sf.relPath, sf.size]))
      const preview: Array<{ relPath: string; status: "new" | "changed" | "same"; localSize: number; serverSize: number | null }> = []
      const pending: Array<{ file: File; strippedPath: string }> = []
      for (const { relPath, file } of localFiles) {
        const serverSize = serverFileMap.has(relPath) ? serverFileMap.get(relPath)! : null
        const status = serverSize === null ? "new" : serverSize !== file.size ? "changed" : "same"
        preview.push({ relPath, status, localSize: file.size, serverSize })
        if (status !== "same") pending.push({ file, strippedPath: relPath })
      }
      setSyncPreviewItems(preview)
      setSyncPendingFiles(pending)
    } catch (err: any) {
      setError(err?.message || String(err))
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
    if (!syncLocalDirHandle) {
      if (syncWebkitFiles !== null) {
        setError("同步到本地需要 HTTPS 连接，当前 HTTP 模式不支持写入本地文件系统。请使用 HTTPS 访问本站，或手动下载所需文件。")
      } else {
        setError("请先在第①步选择本地文件夹")
      }
      return
    }

    const serverFiles = syncServerFiles
    if (!serverFiles.length) {
      setError("该目录下没有文件")
      return
    }

    const dirHandle = syncLocalDirHandle

    try {
      setSyncing(true)
      setSyncProgress(0)
      setError(null)

      // Filter out Office temp/lock files before counting
      const downloadableFiles = serverFiles.filter((sf) => {
        const basename = sf.relPath.split("/").pop() ?? ""
        return !basename.startsWith("~$") && !basename.startsWith("~")
      })

      setSyncSummary(`准备下载 ${downloadableFiles.length} 个文件`)

      for (let i = 0; i < downloadableFiles.length; i++) {
        const sf = downloadableFiles[i]
        setSyncSummary(`正在下载 ${i + 1}/${downloadableFiles.length}: ${sf.relPath}`)

        const response = await fetch(buildFileUrl(sf.relativePath))
        if (!response.ok) throw new Error(`下载失败: ${sf.relPath}`)
        const blob = await response.blob()

        // Walk path segments, sanitizing each name for the local file system
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

      setSyncSummary(`已下载 ${downloadableFiles.length} 个文件`)
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setSyncing(false)
      setTimeout(() => { setSyncProgress(0); setSyncSummary("") }, 2000)
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

  async function handleAsk() {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) return

    const nextMessages = [...chatMessages, { role: "user" as const, content: trimmedQuestion }]
    setChatMessages(nextMessages)
    setQuestion("")
    setChatLoading(true)

    // Prefer creating on client first for immediate sidebar feedback.
    const convId = await ensureConversation()

    try {
      setError(null)
      const res = await fetch("/api/knowledge-base/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getKnowledgeBaseAuthHeaders() ?? {}) },
        body: JSON.stringify({
          question: trimmedQuestion,
          folderPath: selectedFolder,
          filePath: selectedDocument?.relativePath ?? null,
          useBm25,
          stream: true,
          modelMode,
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
          let event: { type: string; delta?: string; sources?: string[]; conversationId?: string; message?: string } | null = null
          try { event = JSON.parse(jsonStr) } catch { continue }
          if (!event) continue
          if (event.type === "text" && event.delta) {
            fullContent += event.delta
            setChatMessages((prev) => {
              const msgs = [...prev]
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: fullContent }
              return msgs
            })
          } else if (event.type === "done") {
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
      setChatLoading(false)
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
            }} disabled={!selectedFolder} className={cn(isCyber && "border-cyan-500/40 text-cyan-200")}>
              根目录
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => {
              if (parentFolderPath === null) return
              setSelectedFolder(parentFolderPath)
              setSelectedExplorerEntry(null)
            }} disabled={parentFolderPath === null} className={cn(isCyber && "border-cyan-500/40 text-cyan-200")}>
              返回上一级
            </Button>
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
                  disabled={deletingPath === activeExplorerEntry.folder.relativePath}
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
                  disabled={deletingPath === activeExplorerEntry.document.relativePath}
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

        <div className={cn("overflow-hidden rounded-lg border", isCyber ? "border-cyan-500/15 bg-black/20" : "border-border bg-card") }>
          <div className={cn("grid grid-cols-[minmax(0,2fr)_minmax(140px,1.1fr)_minmax(100px,0.9fr)_minmax(100px,0.8fr)_minmax(90px,0.9fr)] gap-3 border-b px-3 py-2 text-xs font-medium", isCyber ? "border-cyan-500/15 bg-black/25 text-cyan-300/80" : "border-border bg-muted/40 text-muted-foreground")}>
            <div>名称</div>
            <div>修改日期</div>
            <div>类型</div>
            <div>大小</div>
            <div>上传者</div>
          </div>
          <div>
            {explorerEntries.length > 0 ? (
              explorerEntries.map((entry) => {
                const selected = activeExplorerEntry?.kind === entry.kind && activeExplorerEntry.relativePath === entry.relativePath
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => {
                      setSelectedExplorerEntry({ kind: entry.kind, relativePath: entry.relativePath })
                      if (entry.kind === "file") {
                        setSelectedDocument(entry.document)
                      }
                    }}
                    onDoubleClick={() => handleExplorerEntryOpen(entry)}
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,2fr)_minmax(140px,1.1fr)_minmax(100px,0.9fr)_minmax(100px,0.8fr)_minmax(90px,0.9fr)] gap-3 border-b px-3 py-2 text-left text-sm transition-colors last:border-b-0",
                      isCyber
                        ? selected
                          ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-50"
                          : "border-cyan-500/10 text-cyan-100 hover:bg-cyan-500/5"
                        : selected
                          ? "border-border bg-primary/5 text-foreground"
                          : "border-border text-foreground hover:bg-muted/50",
                    )}
                    title={entry.relativePath}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {entry.kind === "folder" ? (
                        <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-sm", isCyber ? "bg-cyan-500/15 text-cyan-300" : "bg-amber-500/15 text-amber-600")}>
                          <FolderOpen className="h-4 w-4" />
                        </span>
                      ) : (
                        (() => {
                          const fileIcon = getExplorerFileIcon(entry.document.extension)
                          const Icon = fileIcon.icon
                          return (
                            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-sm", fileIcon.className)}>
                              <Icon className="h-4 w-4" />
                            </span>
                          )
                        })()
                      )}
                      <span className="truncate">{entry.name}</span>
                    </div>
                    <div className="truncate">{formatDateTime(entry.updatedAt)}</div>
                    <div className="truncate">{entry.typeLabel}</div>
                      <div className="truncate">{entry.kind === "file" ? formatFileSize(entry.document.size) : formatFileSize(getFolderTotalSize(entry.folder))}</div>
                    <div className="truncate">{entry.ownerName}</div>
                  </button>
                )
              })
            ) : (
              <div className={cn("px-3 py-6 text-sm", isCyber ? "text-cyan-300/70" : "text-muted-foreground")}>
                当前目录暂无文件夹或文件。
              </div>
            )}
          </div>
        </div>
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
        key: "folder" as const,
        title: "新建文件夹",
        description: "管理资料结构，扩展新的主题目录。",
        icon: FolderPlus,
      },
      {
        key: "sync" as const,
        title: "同步",
        description: "与本地目录对比并同步文件。",
        icon: RefreshCw,
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
                    {/* Target folder selector */}
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">目标目录</label>
                      <select
                        value={uploadTargetFolder ?? "__unset__"}
                        onChange={(e) => setUploadTargetFolder(e.target.value === "__unset__" ? null : e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="__unset__" disabled>— 请选择目标目录 —</option>
                        {folderOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
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

                {traditionalPanel === "folder" && (
                  <div className="space-y-4">
                    <Input
                      value={newFolderName}
                      onChange={(event) => setNewFolderName(event.target.value)}
                      placeholder={selectedFolder ? `在 ${selectedFolder} 下创建文件夹` : "新建一级文件夹"}
                    />
                    <div className="text-sm text-muted-foreground">新目录位置：{selectedFolder || "根目录 / 全部资料"}</div>
                    <Button onClick={() => void handleCreateFolder()}>
                      <FolderPlus className="h-4 w-4" />
                      新建文件夹
                    </Button>
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
                            {syncWebkitFiles !== null && <span className="shrink-0 text-muted-foreground">{syncWebkitFiles.length} 个文件</span>}
                          </div>
                        )}

                        {syncServerFolder !== null && (syncLocalDirHandle !== null || syncWebkitFiles !== null) && (
                          <Button size="sm" variant="outline" disabled={syncing} onClick={() => void handleCompare()}>
                            <RefreshCw className="h-4 w-4" />
                            对比
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
                    {syncServerFolder !== null && (syncLocalDirHandle !== null || syncWebkitFiles !== null) && (
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
                  <ScrollArea className="flex-1">
                    <div className="space-y-1">
                      {conversations.length === 0 && (
                        <p className="px-1 py-3 text-center text-xs text-muted-foreground">暂无对话记录</p>
                      )}
                      {conversations.map((conv) => (
                        <div
                          key={conv.id}
                          className={cn(
                            "group flex cursor-pointer items-start justify-between gap-1 rounded-md px-2 py-2 text-xs transition-colors hover:bg-muted/50",
                            activeConversationId === conv.id && "bg-muted",
                          )}
                          onClick={() => void handleLoadConversation(conv.id)}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium leading-tight">{conv.title}</div>
                            <div className="mt-0.5 flex items-center gap-1 text-muted-foreground">
                              <Clock className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">{new Date(conv.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                          </div>
                          <button
                            className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                            onClick={(e) => void handleDeleteConversation(conv.id, e)}
                            title="删除"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
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
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">模型选择</div>
                    <div className="grid grid-cols-2 gap-1">
                      <button type="button" onClick={() => setModelMode("auto")} className={cn("col-span-2 rounded px-2 py-1 text-xs transition-colors", modelMode === "auto" ? "bg-primary text-primary-foreground" : "border hover:bg-muted")}>🤖 自动（推荐）</button>
                      <button type="button" onClick={() => setModelMode("plus")} className={cn("rounded px-2 py-1 text-xs transition-colors", modelMode === "plus" ? "bg-primary text-primary-foreground" : "border hover:bg-muted")}>标准</button>
                      <button type="button" onClick={() => setModelMode("turbo")} className={cn("rounded px-2 py-1 text-xs transition-colors", modelMode === "turbo" ? "bg-primary text-primary-foreground" : "border hover:bg-muted")}>快速 ⚡</button>
                      <button type="button" onClick={() => setModelMode("reasoning")} className={cn("col-span-2 rounded px-2 py-1 text-xs transition-colors", modelMode === "reasoning" ? "bg-primary text-primary-foreground" : "border hover:bg-muted")}>🧠 深度推理</button>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">自动：根据问题类型自动切换；标准：qwen-plus；快速：qwen-turbo；深度推理：qwq-plus（适合筛选/计算/对比类问题）。</p>
                  </div>
                </div>
              )}

              {/* Chat messages */}
              <div ref={traditionalChatScrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
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
                      正在检索文档并生成回答...
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
                  <button
                    type="button"
                    onClick={() => setModelMode((m) => m === "reasoning" ? "auto" : "reasoning")}
                    className={cn(
                      "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
                      modelMode === "reasoning" ? "border-purple-400/60 bg-purple-500/15 text-purple-200" : "border-border text-muted-foreground hover:bg-muted",
                    )}
                    title="切换深度推理模式（qwq-plus）"
                  >
                    🧠 {modelMode === "reasoning" ? "推理中" : "深度推理"}
                  </button>
                  <Button disabled={chatLoading || !question.trim()} onClick={() => void handleAsk()}>
                    <Send className="h-4 w-4" />
                    发送问题
                  </Button>
                </div>
              </div>
            </div>
            </section>
          </ResizablePanel>
        </ResizablePanelGroup>
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
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    placeholder={selectedFolder ? `在 ${selectedFolder} 下创建文件夹` : "新建一级文件夹"}
                    className="border-cyan-500/25 bg-black/30 text-cyan-100"
                  />
                  <Button className="bg-cyan-600 hover:bg-cyan-500" onClick={() => void handleCreateFolder()}>
                    <FolderPlus className="h-4 w-4" />
                    新建文件夹
                  </Button>
                </div>

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
              </div>
            </CardHeader>
            <CardContent className="flex h-[calc(100vh-15rem)] min-h-[720px] flex-col gap-4">
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
                    <ScrollArea className="flex-1">
                      <div className="space-y-0.5">
                        {conversations.length === 0 && (
                          <p className="px-1 py-3 text-center text-xs text-cyan-300/50">暂无对话记录</p>
                        )}
                        {conversations.map((conv) => (
                          <div
                            key={conv.id}
                            className={cn(
                              "group flex cursor-pointer items-start justify-between gap-1 rounded-lg px-2 py-2 text-xs transition-colors hover:bg-cyan-500/10",
                              activeConversationId === conv.id && "bg-cyan-500/15",
                            )}
                            onClick={() => void handleLoadConversation(conv.id)}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium leading-tight text-cyan-100">{conv.title}</div>
                              <div className="mt-0.5 flex items-center gap-1 text-cyan-300/50">
                                <Clock className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">{new Date(conv.updatedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                              </div>
                            </div>
                            <button
                              className="mt-0.5 shrink-0 text-cyan-300/30 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                              onClick={(e) => void handleDeleteConversation(conv.id, e)}
                              title="删除"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
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
                    <div className="mt-1 text-xs font-medium text-cyan-300/80">模型选择</div>
                    <div className="grid grid-cols-2 gap-1">
                      <button type="button" onClick={() => setModelMode("auto")} className={cn("col-span-2 rounded-lg border px-2 py-1 text-xs transition-colors", modelMode === "auto" ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100" : "border-cyan-500/20 bg-black/20 text-cyan-300/60 hover:bg-cyan-500/10")}>🤖 自动（推荐）</button>
                      <button type="button" onClick={() => setModelMode("plus")} className={cn("rounded-lg border px-2 py-1 text-xs transition-colors", modelMode === "plus" ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100" : "border-cyan-500/20 bg-black/20 text-cyan-300/60 hover:bg-cyan-500/10")}>标准</button>
                      <button type="button" onClick={() => setModelMode("turbo")} className={cn("rounded-lg border px-2 py-1 text-xs transition-colors", modelMode === "turbo" ? "border-cyan-400/60 bg-cyan-500/20 text-cyan-100" : "border-cyan-500/20 bg-black/20 text-cyan-300/60 hover:bg-cyan-500/10")}>快速 ⚡</button>
                      <button type="button" onClick={() => setModelMode("reasoning")} className={cn("col-span-2 rounded-lg border px-2 py-1 text-xs transition-colors", modelMode === "reasoning" ? "border-purple-400/60 bg-purple-500/20 text-purple-100" : "border-cyan-500/20 bg-black/20 text-cyan-300/60 hover:bg-cyan-500/10")}>🧠 深度推理</button>
                    </div>
                    <p className="text-[11px] text-cyan-300/60">自动：根据问题类型自动切换；标准：qwen-plus；快速：qwen-turbo；深度推理：qwq-plus。</p>
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
                        正在检索文档并生成回答...
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
                    <button
                      type="button"
                      onClick={() => setModelMode((m) => m === "reasoning" ? "auto" : "reasoning")}
                      className={cn(
                        "flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs transition-colors",
                        modelMode === "reasoning"
                          ? "border-purple-400/60 bg-purple-500/20 text-purple-200"
                          : "border-cyan-500/25 bg-black/20 text-cyan-300/60 hover:bg-cyan-500/10",
                      )}
                      title="切换深度推理模式（qwq-plus）"
                    >
                      🧠 {modelMode === "reasoning" ? "推理中" : "深度推理"}
                    </button>
                    <Button disabled={chatLoading || !question.trim()} className="bg-cyan-600 hover:bg-cyan-500" onClick={() => void handleAsk()}>
                      <Send className="h-4 w-4" />
                      发送问题
                    </Button>
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