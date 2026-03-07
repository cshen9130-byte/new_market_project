"use client"

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BrainCircuit,
  Download,
  Eye,
  FileText,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Send,
  Upload,
} from "lucide-react"
import { authService } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type DocumentNode = {
  name: string
  relativePath: string
  extension: string
  size: number
  updatedAt: string
  canPreview: boolean
  canChat: boolean
}

type FolderNode = {
  name: string
  relativePath: string
  folders: FolderNode[]
  documents: DocumentNode[]
}

type ChatMessage = {
  role: "user" | "assistant"
  content: string
  sources?: string[]
}

type KnowledgeBasePageProps = {
  backHref: string
  backLabel: string
  variant?: "cyber" | "traditional"
}

const TEXT_PREVIEW_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".csv", ".log"])

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
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

function countDocuments(node: FolderNode | null): number {
  if (!node) return 0
  return node.documents.length + node.folders.reduce((total, folder) => total + countDocuments(folder), 0)
}

export function KnowledgeBasePage({ backHref, backLabel, variant = "cyber" }: KnowledgeBasePageProps) {
  const router = useRouter()
  const traditionalChatScrollRef = useRef<HTMLDivElement | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tree, setTree] = useState<FolderNode | null>(null)
  const [storageRoot, setStorageRoot] = useState("")
  const [selectedFolder, setSelectedFolder] = useState("")
  const [selectedDocument, setSelectedDocument] = useState<DocumentNode | null>(null)
  const [previewMode, setPreviewMode] = useState<"empty" | "text" | "frame">("empty")
  const [previewContent, setPreviewContent] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [question, setQuestion] = useState("")
  const [chatLoading, setChatLoading] = useState(false)
  const [traditionalPanel, setTraditionalPanel] = useState<"library" | "preview" | "upload" | "folder">("library")
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "选择左侧文件夹后即可上传资料、预览文档，并针对当前文件夹或全部资料提问。",
    },
  ])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    authService.init()
    const currentUser = authService.getCurrentUser()
    if (!currentUser) {
      router.replace("/login")
      return
    }

    setAuthorized(true)
    void refreshTree(true)
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

  async function refreshTree(initial = false) {
    try {
      setError(null)
      if (initial) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      const res = await fetch("/api/knowledge-base/tree", { cache: "no-store" })
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

  async function handleCreateFolder() {
    const trimmed = newFolderName.trim()
    if (!trimmed) return

    const fullPath = selectedFolder ? `${selectedFolder}/${trimmed}` : trimmed
    try {
      setError(null)
      const res = await fetch("/api/knowledge-base/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

    try {
      setUploading(true)
      setError(null)
      const form = new FormData()
      form.append("file", pendingFile)
      form.append("folderPath", selectedFolder)

      const res = await fetch("/api/knowledge-base/upload", {
        method: "POST",
        body: form,
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || res.statusText)
      }

      setPendingFile(null)
      await refreshTree()
    } catch (requestError: any) {
      setError(requestError?.message || String(requestError))
    } finally {
      setUploading(false)
    }
  }

  async function handlePreview(document: DocumentNode) {
    setSelectedDocument(document)
    setPreviewLoading(true)
    setPreviewContent("")

    try {
      if (TEXT_PREVIEW_EXTENSIONS.has(document.extension)) {
        const res = await fetch(buildFileUrl(document.relativePath), { cache: "no-store" })
        const text = await res.text()
        if (!res.ok) {
          throw new Error(text || res.statusText)
        }
        setPreviewMode("text")
        setPreviewContent(text)
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

  async function handleAsk() {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) return

    const nextMessages = [...chatMessages, { role: "user" as const, content: trimmedQuestion }]
    setChatMessages(nextMessages)
    setQuestion("")
    setChatLoading(true)

    try {
      setError(null)
      const res = await fetch("/api/knowledge-base/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmedQuestion, folderPath: selectedFolder }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || res.statusText)
      }

      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.answer,
          sources: data.sources,
        },
      ])
    } catch (requestError: any) {
      const message = requestError?.message || String(requestError)
      setError(message)
      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `请求失败：${message}`,
        },
      ])
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

  function renderFolder(folder: FolderNode, depth = 0): React.ReactNode {
    return (
      <div key={folder.relativePath || "__root__"} className="space-y-2">
        <button
          type="button"
          onClick={() => setSelectedFolder(folder.relativePath)}
          className={cn(
            "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
            selectedFolder === folder.relativePath
              ? "border-cyan-400 bg-cyan-500/10 text-cyan-100"
              : "border-cyan-500/20 bg-black/20 text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/5",
          )}
          style={{ marginLeft: depth * 12 }}
        >
          <span className="truncate">{folder.name}</span>
          <span className="text-xs text-cyan-500/70">{folder.documents.length}</span>
        </button>

        {folder.documents.length > 0 && (
          <div className="space-y-2">
            {folder.documents.map((document) => (
              <div
                key={document.relativePath}
                className="flex items-center gap-2 rounded-lg border border-cyan-500/15 bg-black/30 px-3 py-2"
                style={{ marginLeft: depth * 12 + 12 }}
              >
                <FileText className="h-4 w-4 text-cyan-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-cyan-100">{document.name}</div>
                  <div className="text-xs text-cyan-500/70">
                    {formatFileSize(document.size)} · {new Date(document.updatedAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-cyan-500/40 text-cyan-200"
                  onClick={() => void handlePreview(document)}
                >
                  <Eye className="h-4 w-4" />
                  查看
                </Button>
                <Button size="sm" variant="outline" className="border-cyan-500/40 text-cyan-200" asChild>
                  <a href={buildFileUrl(document.relativePath, true)}>
                    <Download className="h-4 w-4" />
                    下载
                  </a>
                </Button>
              </div>
            ))}
          </div>
        )}

        {folder.folders.length > 0 && <div className="space-y-2">{folder.folders.map((child) => renderFolder(child, depth + 1))}</div>}
      </div>
    )
  }

  function renderTraditionalFolder(folder: FolderNode, depth = 0): React.ReactNode {
    return (
      <div key={folder.relativePath || "__root__"} className="space-y-2">
        <button
          type="button"
          onClick={() => setSelectedFolder(folder.relativePath)}
          className={cn(
            "flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors shadow-sm",
            selectedFolder === folder.relativePath
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border bg-card text-foreground hover:bg-muted/60",
          )}
          style={{ marginLeft: depth * 12 }}
        >
          <span className="truncate font-medium">{folder.name}</span>
          <span className="text-xs text-muted-foreground">{folder.documents.length}</span>
        </button>

        {folder.documents.length > 0 && (
          <div className="space-y-2">
            {folder.documents.map((document) => (
              <div
                key={document.relativePath}
                className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 shadow-sm"
                style={{ marginLeft: depth * 12 + 12 }}
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{document.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatFileSize(document.size)} · {new Date(document.updatedAt).toLocaleString()}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTraditionalPanel("preview")
                    void handlePreview(document)
                  }}
                >
                  <Eye className="h-4 w-4" />
                  预览
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={buildFileUrl(document.relativePath, true)}>
                    <Download className="h-4 w-4" />
                    下载
                  </a>
                </Button>
              </div>
            ))}
          </div>
        )}

        {folder.folders.length > 0 && <div className="space-y-2">{folder.folders.map((child) => renderTraditionalFolder(child, depth + 1))}</div>}
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
    ]

    return (
      <div className="min-h-[calc(100vh-8rem)]">
        {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}

        <div className="grid min-h-[calc(100vh-8rem)] items-start gap-0 lg:grid-cols-[430px_1px_minmax(0,1fr)]">
          <section className="space-y-6 pr-8">
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

            {traditionalPanel === "library" && (
              <div className="space-y-4">
                <ScrollArea className="h-[calc(100vh-18rem)] pr-3">
                  <div className="space-y-3">{tree ? renderTraditionalFolder(tree) : <div className="text-sm text-muted-foreground">暂无资料</div>}</div>
                </ScrollArea>
              </div>
            )}

            {traditionalPanel === "preview" && (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  {selectedDocument
                    ? `${selectedDocument.relativePath} · ${formatFileSize(selectedDocument.size)}`
                    : "先在资料目录中选择一个文档进行预览。"}
                </div>
                <div className="min-h-[calc(100vh-18rem)]">
                  {previewLoading && (
                    <div className="flex h-[calc(100vh-18rem)] items-center justify-center text-muted-foreground">
                      <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                      正在加载文档...
                    </div>
                  )}
                  {!previewLoading && previewMode === "text" && (
                    <ScrollArea className="h-[calc(100vh-18rem)] pr-3">
                      <pre className="whitespace-pre-wrap break-words text-sm leading-6">{previewContent}</pre>
                    </ScrollArea>
                  )}
                  {!previewLoading && previewMode === "frame" && selectedDocument && (
                    <iframe
                      key={selectedDocument.relativePath}
                      src={buildFileUrl(selectedDocument.relativePath)}
                      className="h-[calc(100vh-18rem)] w-full bg-white"
                      title={selectedDocument.name}
                    />
                  )}
                  {!previewLoading && previewMode === "empty" && (
                    <div className="flex h-[calc(100vh-18rem)] items-center justify-center text-sm text-muted-foreground">
                      暂无预览内容。txt、md、json、csv 支持文本预览，html、pdf 使用内嵌查看。
                    </div>
                  )}
                </div>
              </div>
            )}

            {traditionalPanel === "upload" && (
              <div className="space-y-4">
                <Input type="file" onChange={(event) => setPendingFile(event.target.files?.[0] || null)} />
                <div className="text-sm text-muted-foreground">目标目录：{selectedFolder || "根目录 / 全部资料"}</div>
                <Button disabled={!pendingFile || uploading} onClick={() => void handleUpload()}>
                  <Upload className="h-4 w-4" />
                  {uploading ? "上传中..." : "上传文档"}
                </Button>
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
          </section>

          <div className="hidden lg:block w-px self-stretch bg-border" />

          <section className="sticky top-0 flex h-[calc(100vh-8rem)] flex-col overflow-hidden pl-8">
            <div className="space-y-2 pb-4">
              <h2 className="text-xl font-semibold">知识库问答</h2>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4" />
                  <span>当前检索范围：{selectedFolder || "全部资料"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  <span>{folderOptions.length - 1} 个文件夹</span>
                </div>
              </div>
            </div>

            <div ref={traditionalChatScrollRef} className="min-h-0 flex-1 overflow-y-auto pr-3">
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
                {chatLoading && (
                  <div className="rounded-lg bg-muted/30 px-4 py-3 text-sm text-muted-foreground shadow-sm">
                    <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />
                    正在生成回答...
                  </div>
                )}
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
                <div className="flex items-center justify-end">
                  <Button disabled={chatLoading || !question.trim()} onClick={() => void handleAsk()}>
                    <Send className="h-4 w-4" />
                    发送问题
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
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
                    type="file"
                    onChange={(event) => setPendingFile(event.target.files?.[0] || null)}
                    className="border-cyan-500/25 bg-black/30 text-cyan-100"
                  />
                  <Button disabled={!pendingFile || uploading} className="bg-cyan-600 hover:bg-cyan-500" onClick={() => void handleUpload()}>
                    <Upload className="h-4 w-4" />
                    {uploading ? "上传中..." : "上传文档"}
                  </Button>
                </div>

                <div className="rounded-xl border border-cyan-500/15 bg-black/25 px-3 py-2 text-xs text-cyan-300/80">
                  当前问答范围：{selectedFolder || "全部资料"}
                </div>

                <ScrollArea className="h-[460px] rounded-xl border border-cyan-500/15 bg-black/20 p-3">
                  <div className="space-y-3 pr-3">{tree ? renderFolder(tree) : <div className="text-sm text-cyan-400/70">暂无资料</div>}</div>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="border-cyan-500/20 bg-black/45 shadow-none">
              <CardHeader>
                <CardTitle>文档预览</CardTitle>
                <CardDescription>
                  {selectedDocument
                    ? `${selectedDocument.relativePath} · ${formatFileSize(selectedDocument.size)}`
                    : "选择左侧文档后可查看内容"}
                </CardDescription>
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
                      暂无预览内容。txt、md、json、csv 支持文本预览，html、pdf 使用内嵌查看。
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="border-cyan-500/20 bg-black/45 shadow-none">
            <CardHeader>
              <CardTitle>知识库问答</CardTitle>
              <CardDescription>
                基于 LangChain 检索结构 + DashScope Qwen 聊天模型与 Embeddings。请先在服务器配置 DASHSCOPE_API_KEY。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex h-[calc(100vh-15rem)] min-h-[720px] flex-col gap-4">
              <div className="flex items-center justify-between rounded-xl border border-cyan-500/15 bg-black/25 px-4 py-3 text-sm text-cyan-300/80">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  <span>提问范围：{selectedFolder || "全部资料"}</span>
                </div>
                <div>{folderOptions.length - 1} 个文件夹可选</div>
              </div>

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
                  {chatLoading && (
                    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-50">
                      <LoaderCircle className="mr-2 inline h-4 w-4 animate-spin" />
                      正在检索文档并生成回答...
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="space-y-3">
                <Textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={handleQuestionKeyDown}
                  placeholder="例如：根据当前文件夹资料，总结近一周市场的主要变化，并给出对应文件来源。"
                  className="min-h-32 border-cyan-500/25 bg-black/30 text-cyan-100"
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-cyan-400/70">支持针对所选文件夹问答；未选择文件夹时默认检索全部资料。</div>
                  <Button disabled={chatLoading || !question.trim()} className="bg-cyan-600 hover:bg-cyan-500" onClick={() => void handleAsk()}>
                    <Send className="h-4 w-4" />
                    发送问题
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}