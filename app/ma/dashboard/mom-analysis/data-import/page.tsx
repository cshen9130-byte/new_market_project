"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  UploadCloud,
  X,
} from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

type FolderEntry = { name: string; fileCount: number }

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload)
    return String((payload as Record<string, unknown>).error)
  return fallback
}

export default function DataImportPage() {
  const { toast } = useToast()
  const zipInputRef = useRef<HTMLInputElement | null>(null)

  const [folders, setFolders] = useState<FolderEntry[]>([])
  const [totalFolders, setTotalFolders] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null)
  const [folderFiles, setFolderFiles] = useState<Record<string, string[]>>({})
  const [loadingFolder, setLoadingFolder] = useState<string | null>(null)

  const [dateStatus, setDateStatus] = useState<{
    scanFrom: string
    totalExpected: number
    totalExisting: number
    missingDates: string[]
    missingCount: number
  } | null>(null)
  const [isCheckingDates, setIsCheckingDates] = useState(false)
  const [showMissingDates, setShowMissingDates] = useState(false)

  const [etlStatus, setEtlStatus] = useState<{
    notYetRun: boolean
    lastRun: string | null
    totalFiles: number
    okFiles: number
    errorFiles: number
    totalRows: number
    recentErrors: { file: string; message: string | null; at: string | null }[]
  } | null>(null)
  const [isLoadingEtl, setIsLoadingEtl] = useState(false)
  const [showEtlErrors, setShowEtlErrors] = useState(false)

  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadQueue, setUploadQueue] = useState<{ name: string; status: "pending" | "done" | "error"; msg?: string }[]>([])
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameProgress, setRenameProgress] = useState<{ current: number; total: number } | null>(null)
  const [pendingRenameFolders, setPendingRenameFolders] = useState<string[]>([])
  const [renameResult, setRenameResult] = useState<{
    renamedFiles: string[]
    renamedFolders: string[]
    errors: string[]
    duplicates: string[]
    nothingToDo: boolean
  } | null>(null)

  const checkDates = useCallback(async () => {
    setIsCheckingDates(true)
    try {
      const res = await fetch("/ma/api/mom-analysis/data-import/check-dates")
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "日期检查失败"))
      setDateStatus(data)
    } catch {
      // non-critical, don't toast
    } finally {
      setIsCheckingDates(false)
    }
  }, [])

  const checkEtlStatus = useCallback(async () => {
    setIsLoadingEtl(true)
    try {
      const res = await fetch("/ma/api/mom-analysis/data-import/etl-status")
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "ETL状态查询失败"))
      setEtlStatus(data)
    } catch {
      // non-critical, don't toast
    } finally {
      setIsLoadingEtl(false)
    }
  }, [])

  const loadFolders = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/ma/api/mom-analysis/data-import/list")
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "加载目录失败"))
      setFolders(data.folders)
      setTotalFolders(data.total)
    } catch (e) {
      toast({ title: "加载失败", description: e instanceof Error ? e.message : "加载目录失败", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  useEffect(() => { loadFolders(); checkDates(); checkEtlStatus() }, [loadFolders, checkDates, checkEtlStatus])

  async function toggleFolder(name: string) {
    if (expandedFolder === name) {
      setExpandedFolder(null)
      return
    }
    setExpandedFolder(name)
    if (folderFiles[name]) return
    setLoadingFolder(name)
    try {
      const res = await fetch(`/ma/api/mom-analysis/data-import/list?folder=${encodeURIComponent(name)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "加载文件列表失败"))
      setFolderFiles((prev) => ({ ...prev, [name]: data.files }))
    } catch (e) {
      toast({ title: "加载失败", description: e instanceof Error ? e.message : "加载文件列表失败", variant: "destructive" })
    } finally {
      setLoadingFolder(null)
    }
  }

  async function handleFiles(files: File[]) {
    const zips = files.filter((f) => f.name.toLowerCase().endsWith(".zip"))
    const invalid = files.filter((f) => !f.name.toLowerCase().endsWith(".zip"))
    if (invalid.length > 0) {
      toast({ title: "格式错误", description: `以下文件不是 .zip：${invalid.map(f => f.name).join(", ")}`, variant: "destructive" })
    }
    if (zips.length === 0) return

    setIsUploading(true)
    setUploadQueue(zips.map((f) => ({ name: f.name, status: "pending" as const })))

    const allExtracted: string[] = []
    for (let i = 0; i < zips.length; i++) {
      const file = zips[i]
      try {
        const fd = new FormData()
        fd.append("file", file)
        const res = await fetch("/ma/api/mom-analysis/data-import/upload", { method: "POST", body: fd })
        const data = await res.json()
        if (!res.ok) throw new Error(readError(data, "解压失败"))
        setUploadQueue((q) => q.map((item, idx) => idx === i ? { ...item, status: "done", msg: data.message } : item))
        if (Array.isArray(data.extractedFolders)) allExtracted.push(...data.extractedFolders)
      } catch (e) {
        const msg = e instanceof Error ? e.message : "解压失败"
        setUploadQueue((q) => q.map((item, idx) => idx === i ? { ...item, status: "error", msg } : item))
      }
    }

    if (allExtracted.length > 0) setPendingRenameFolders((prev) => [...new Set([...prev, ...allExtracted])])
    setFolderFiles({})
    setExpandedFolder(null)
    await loadFolders()
    await checkDates()
    setIsUploading(false)
    if (zipInputRef.current) zipInputRef.current.value = ""
  }

  async function handleUpload(file: File) {
    await handleFiles([file])
  }

  async function handleRename() {
    if (pendingRenameFolders.length === 0) return
    setIsRenaming(true)
    setRenameResult(null)
    setRenameProgress({ current: 0, total: pendingRenameFolders.length })

    const accumulated: typeof renameResult = {
      renamedFiles: [],
      renamedFolders: [],
      errors: [],
      duplicates: [],
      nothingToDo: true,
    }

    for (let i = 0; i < pendingRenameFolders.length; i++) {
      setRenameProgress({ current: i + 1, total: pendingRenameFolders.length })
      try {
        const res = await fetch("/ma/api/mom-analysis/data-import/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folders: [pendingRenameFolders[i]] }),
        })
        const data = await res.json()
        if (!res.ok) {
          accumulated.errors.push(`[${pendingRenameFolders[i]}] ${readError(data, "重命名失败")}`)
        } else {
          accumulated.renamedFiles.push(...(data.renamedFiles ?? []))
          accumulated.renamedFolders.push(...(data.renamedFolders ?? []))
          accumulated.errors.push(...(data.errors ?? []))
          accumulated.duplicates.push(...(data.duplicates ?? []))
          if (!data.nothingToDo) accumulated.nothingToDo = false
        }
      } catch (e) {
        accumulated.errors.push(`[${pendingRenameFolders[i]}] ${e instanceof Error ? e.message : "重命名失败"}`)
      }
    }

    setRenameResult(accumulated)
    setPendingRenameFolders([])
    setRenameProgress(null)
    if (!accumulated.nothingToDo) {
      setFolderFiles({})
      setExpandedFolder(null)
      await loadFolders()
      await checkDates()
    }
    setIsRenaming(false)
  }

  return (
    <div className="space-y-6 pt-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/ma/dashboard/mom-analysis">
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回 MOM分析
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">数据导入</h1>
        <p className="mt-2 text-muted-foreground">
          管理 <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">mom_data/03.投顾逐日</code> 目录中的逐日核算数据。
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isRenaming || pendingRenameFolders.length === 0}
          onClick={handleRename}
        >
          <RotateCcw className={`mr-2 h-4 w-4 ${isRenaming ? "animate-spin" : ""}`} />
          标准化命名
          {pendingRenameFolders.length > 0 && !isRenaming && (
            <Badge variant="secondary" className="ml-2">{pendingRenameFolders.length}</Badge>
          )}
        </Button>

        {isRenaming && renameProgress && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="relative h-2 w-32 overflow-hidden rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-300"
                style={{ width: `${(renameProgress.current / renameProgress.total) * 100}%` }}
              />
            </div>
            <span className="tabular-nums">{renameProgress.current} / {renameProgress.total}</span>
          </div>
        )}

        <Button variant="ghost" size="sm" disabled={isLoading} onClick={() => { setFolderFiles({}); setExpandedFolder(null); loadFolders(); checkDates() }}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          刷新
        </Button>

        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <FolderOpen className="h-4 w-4" />
          共 {totalFolders} 个日期文件夹
        </div>
      </div>

      {/* Drop zone */}
      <div
        className={`relative rounded-lg border-2 border-dashed transition-colors ${
          isDragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-border"
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
        onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false) }}
        onDrop={(e) => {
          e.preventDefault(); setIsDragOver(false)
          const files = Array.from(e.dataTransfer.files)
          if (files.length > 0) handleFiles(files)
        }}
      >
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <UploadCloud className={`h-8 w-8 ${isDragOver ? "text-primary" : "text-muted-foreground"}`} />
          <p className="text-sm font-medium">拖放 ZIP 文件到此处</p>
          <p className="text-xs text-muted-foreground">支持一次拖入多个 .zip 文件</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-1"
            disabled={isUploading}
            onClick={() => zipInputRef.current?.click()}
          >
            {isUploading ? "解压中…" : "选择文件"}
          </Button>
        </div>
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) handleFiles(files)
          }}
        />
      </div>

      {/* Upload progress */}
      {uploadQueue.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-card divide-y divide-border/40">
          <div className="flex items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>上传进度</span>
            {!isUploading && (
              <button onClick={() => setUploadQueue([])} className="hover:text-foreground transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {uploadQueue.map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
              {item.status === "pending" && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
              {item.status === "done" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
              {item.status === "error" && <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />}
              <span className="flex-1 truncate font-mono text-xs">{item.name}</span>
              {item.msg && <span className={`text-xs ${item.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{item.msg}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Date coverage status */}
      <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm">
            {isCheckingDates ? (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : dateStatus ? (
              dateStatus.missingCount === 0
                ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                : <AlertCircle className="h-4 w-4 text-amber-500" />
            ) : null}
            <span className="font-medium">交易日覆盖</span>
            {dateStatus && (
              <span className="text-muted-foreground">
                （{dateStatus.scanFrom.slice(0,4)}-{dateStatus.scanFrom.slice(4,6)}-{dateStatus.scanFrom.slice(6,8)} 至今）
              </span>
            )}
          </div>
          {dateStatus && (
            <div className="flex items-center gap-3 text-sm">
              <span className={dateStatus.missingCount === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                {dateStatus.missingCount === 0
                  ? `全覆盖 ${dateStatus.totalExpected} 个交易日`
                  : `缺少 ${dateStatus.missingCount} / ${dateStatus.totalExpected} 个交易日`}
              </span>
              {dateStatus.missingCount > 0 && (
                <button
                  onClick={() => setShowMissingDates((v) => !v)}
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  {showMissingDates ? "收起" : "查看"}
                </button>
              )}
            </div>
          )}
        </div>

        {showMissingDates && dateStatus && dateStatus.missingDates.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {dateStatus.missingDates.map((d) => (
              <span
                key={d}
                className="inline-block rounded bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-mono text-amber-800 dark:text-amber-300"
              >
                {d.slice(0,4)}-{d.slice(4,6)}-{d.slice(6,8)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ETL pipeline status */}
      <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm">
            {isLoadingEtl ? (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : etlStatus ? (
              etlStatus.notYetRun
                ? <Activity className="h-4 w-4 text-muted-foreground" />
                : etlStatus.errorFiles > 0
                  ? <AlertCircle className="h-4 w-4 text-amber-500" />
                  : <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : null}
            <span className="font-medium">ETL 入库状态</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {etlStatus && !etlStatus.notYetRun ? (
              <>
                <span className="text-muted-foreground tabular-nums">
                  {etlStatus.totalFiles} 个文件 · {etlStatus.totalRows.toLocaleString()} 行
                </span>
                {etlStatus.errorFiles > 0 ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    {etlStatus.okFiles} 成功 / {etlStatus.errorFiles} 失败
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">全部成功</span>
                )}
                <span className="text-xs text-muted-foreground">
                  最后运行：{etlStatus.lastRun ? new Date(etlStatus.lastRun).toLocaleString("zh-CN") : "—"}
                </span>
                {etlStatus.errorFiles > 0 && (
                  <button
                    onClick={() => setShowEtlErrors((v) => !v)}
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                  >
                    {showEtlErrors ? "收起" : "查看错误"}
                  </button>
                )}
              </>
            ) : etlStatus?.notYetRun ? (
              <span className="text-muted-foreground">从未运行</span>
            ) : null}
            <button
              onClick={checkEtlStatus}
              disabled={isLoadingEtl}
              className="ml-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="刷新ETL状态"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingEtl ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {showEtlErrors && etlStatus && etlStatus.recentErrors.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {etlStatus.recentErrors.map((e, i) => (
              <div key={i} className="rounded bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 text-xs">
                <span className="font-mono text-amber-800 dark:text-amber-300">{e.file}</span>
                {e.message && <span className="ml-2 text-muted-foreground">{e.message}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rename result */}
      {renameResult && (
        <Alert variant={renameResult.errors.length > 0 ? "destructive" : "default"}>
          <AlertTitle>
            {renameResult.nothingToDo
              ? "无需重命名"
              : `已重命名 ${renameResult.renamedFiles.length} 个文件、${renameResult.renamedFolders.length} 个文件夹`}
          </AlertTitle>
          <AlertDescription>
            <div className="mt-2 space-y-1 text-xs font-mono max-h-40 overflow-y-auto">
              {renameResult.renamedFolders.map((r, i) => <div key={i} className="text-blue-600 dark:text-blue-400">📁 {r}</div>)}
              {renameResult.renamedFiles.map((r, i) => <div key={i} className="text-emerald-600 dark:text-emerald-400">📄 {r}</div>)}
              {renameResult.duplicates.map((r, i) => <div key={i} className="text-orange-600 dark:text-orange-400">⚠ 重复: {r}</div>)}
              {renameResult.errors.map((r, i) => <div key={i} className="text-destructive">⚠ {r}</div>)}
              {renameResult.nothingToDo && <div className="text-muted-foreground">所有文件名和文件夹名均符合标准格式。</div>}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* File Explorer */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-amber-500" />
            03.投顾逐日
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[60vh]">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                加载中…
              </div>
            ) : folders.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">目录为空</div>
            ) : (
              <div className="divide-y divide-border/50">
                {folders.map((folder) => {
                  const isExpanded = expandedFolder === folder.name
                  const files = folderFiles[folder.name] ?? []
                  const isLoadingFiles = loadingFolder === folder.name

                  return (
                    <div key={folder.name}>
                      <button
                        onClick={() => toggleFolder(folder.name)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors text-left"
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                        <span className="flex-1 font-medium">{folder.name}</span>
                        <Badge variant="secondary" className="text-xs">{folder.fileCount}</Badge>
                      </button>

                      {isExpanded && (
                        <div className="bg-muted/20">
                          {isLoadingFiles ? (
                            <div className="py-3 pl-12 text-xs text-muted-foreground flex items-center gap-2">
                              <RefreshCw className="h-3 w-3 animate-spin" /> 加载中…
                            </div>
                          ) : files.length === 0 ? (
                            <div className="py-3 pl-12 text-xs text-muted-foreground">（空文件夹）</div>
                          ) : (
                            files.map((f) => (
                              <div key={f} className="flex items-center gap-3 px-4 py-1.5 pl-12 text-xs text-muted-foreground">
                                <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                {f}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
