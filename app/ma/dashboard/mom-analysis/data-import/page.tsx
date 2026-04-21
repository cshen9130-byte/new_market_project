"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Mail,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Terminal,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"

type FolderEntry = { name: string; fileCount: number }

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload)
    return String((payload as Record<string, unknown>).error)
  return fallback
}

export default function DataImportPage() {
  const { toast } = useToast()
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const xlsxInputRef = useRef<HTMLInputElement | null>(null)

  // ── xlsx direct-upload state ───────────────────────────────────────────────
  const [xlsxFolder, setXlsxFolder] = useState<string>("")
  const [xlsxIsNewFolder, setXlsxIsNewFolder] = useState(false)
  const [xlsxCustomFolder, setXlsxCustomFolder] = useState<string>("")
  const [xlsxFiles, setXlsxFiles] = useState<File[]>([])
  const [xlsxIsDragOver, setXlsxIsDragOver] = useState(false)
  const [isUploadingXlsx, setIsUploadingXlsx] = useState(false)

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
  const [isRunningEtl, setIsRunningEtl] = useState(false)
  const [etlLog, setEtlLog] = useState<string[]>([])
  const [showEtlLog, setShowEtlLog] = useState(false)
  const [autoFollowLog, setAutoFollowLog] = useState(true)
  const [showXlsxUpload, setShowXlsxUpload] = useState(false)

  // ── Capital-flow import state ──────────────────────────────────────────────
  const capitalFlowInputRef = useRef<HTMLInputElement | null>(null)
  const [capitalFlowFile, setCapitalFlowFile] = useState<File | null>(null)
  const [capitalFlowIsDragOver, setCapitalFlowIsDragOver] = useState(false)
  const [isImportingCapitalFlow, setIsImportingCapitalFlow] = useState(false)
  const [capitalFlowResult, setCapitalFlowResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  // ── Advisor info import state ──────────────────────────────────────────────
  const advisorInfoInputRef = useRef<HTMLInputElement | null>(null)
  const [advisorInfoFile, setAdvisorInfoFile] = useState<File | null>(null)
  const [advisorInfoIsDragOver, setAdvisorInfoIsDragOver] = useState(false)
  const [isImportingAdvisorInfo, setIsImportingAdvisorInfo] = useState(false)
  const [advisorInfoResult, setAdvisorInfoResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  // ── Settlement email config state ──────────────────────────────────────────
  const [showSettlementSetup, setShowSettlementSetup] = useState(false)
  const [settlementCfg, setSettlementCfg] = useState({
    email: "",
    pass: "",
    imapHost: "imap.163.com",
    imapPort: 993,
    enabled: false,
    scheduleTime: "19:00",
    sender: "",
  })
  const [isSavingSettlementCfg, setIsSavingSettlementCfg] = useState(false)
  const [isFetchingSettlement, setIsFetchingSettlement] = useState(false)
  const [settlementFetchResult, setSettlementFetchResult] = useState<{
    downloaded: string[]
    skipped: string[]
    errors: string[]
    log: string[]
  } | null>(null)
  const [settlementFiles, setSettlementFiles] = useState<{
    name: string
    size: number
    mtime: string
  }[]>([])
  const [settlementFolder, setSettlementFolder] = useState("")
  const [settlementLastFetch, setSettlementLastFetch] = useState<string | null>(null)
  const [isLoadingSettlementFiles, setIsLoadingSettlementFiles] = useState(false)
  const [isNormalizingFiles, setIsNormalizingFiles] = useState(false)
  const [normalizeResult, setNormalizeResult] = useState<{
    renamed: { from: string; to: string }[]
    deleted: string[]
    skipped: string[]
    errors: string[]
  } | null>(null)

  const autoFollowLogRef = useRef(true)
  const logScrollRef = useRef<HTMLDivElement | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)

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

  const runEtl = useCallback(async (opts?: { skipDedup?: boolean; skipMarketData?: boolean }) => {
    setIsRunningEtl(true)
    setEtlLog([])
    setShowEtlLog(true)
    setAutoFollowLog(true)
    try {
      const res = await fetch("/ma/api/mom-analysis/data-import/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skipDedup: opts?.skipDedup ?? false, skipMarketData: opts?.skipMarketData ?? false }),
      })
      if (!res.body) throw new Error("无响应流")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      let exitCode: string | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split("\n\n")
        buf = parts.pop() ?? ""
        for (const part of parts) {
          for (const line of part.split("\n")) {
            if (!line.startsWith("data: ")) continue
            const payload = line.slice(6)
            let msg: string
            try { msg = JSON.parse(payload) } catch { msg = payload }
            if (msg.startsWith("__EXIT__:")) {
              exitCode = msg.slice(9)
            } else {
              setEtlLog((prev) => [...prev, msg])
              if (autoFollowLogRef.current) {
                setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: "auto" }), 0)
              }
            }
          }
        }
      }

      if (exitCode === "0") {
        toast({ title: "ETL 完成", description: "数据已成功写入数据库。" })
      } else if (exitCode === "timeout") {
        toast({ title: "ETL 超时", description: "运行超过 600 秒被终止。", variant: "destructive" })
      } else {
        toast({ title: "ETL 失败", description: `退出码 ${exitCode ?? "unknown"}`, variant: "destructive" })
      }
    } catch (e) {
      toast({ title: "ETL 失败", description: e instanceof Error ? e.message : "运行失败", variant: "destructive" })
    } finally {
      setIsRunningEtl(false)
      await checkEtlStatus()
    }
  }, [toast, checkEtlStatus])

  useEffect(() => {
    autoFollowLogRef.current = autoFollowLog
  }, [autoFollowLog])

  const classifyLogLine = useCallback((line: string) => {
    const s = line.toLowerCase()
    if (
      s.includes("traceback") ||
      s.includes("exception") ||
      s.includes("runtimeerror") ||
      s.includes("filenotfound") ||
      s.includes("failed") ||
      s.includes("etl 失败")
    ) {
      return "text-red-400"
    }
    if (s.includes("[warn") || s.includes(" warning") || s.startsWith("warning")) {
      return "text-amber-400"
    }
    if (s.includes("upserted") || s.includes("完成") || s.includes("成功")) {
      return "text-emerald-400"
    }
    return "text-zinc-300"
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

  const loadSettlementConfig = useCallback(async () => {
    try {
      const res = await fetch("/ma/api/mom-analysis/settlement-email/config")
      const data = await res.json()
      if (!res.ok) return
      setSettlementCfg({
        email: data.email ?? "",
        pass: data.pass ?? "",
        imapHost: data.imapHost ?? "imap.163.com",
        imapPort: data.imapPort ?? 993,
        enabled: data.enabled ?? false,
        scheduleTime: data.scheduleTime ?? "19:00",
        sender: data.sender ?? "",
      })
    } catch { /* non-critical */ }
  }, [])

  const loadSettlementFiles = useCallback(async () => {
    setIsLoadingSettlementFiles(true)
    try {
      const res = await fetch("/ma/api/mom-analysis/settlement-email/files", { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) return
      setSettlementFiles(data.files ?? [])
      setSettlementFolder(data.folder ?? "")
      setSettlementLastFetch(data.lastFetchAt ?? null)
    } catch { /* non-critical */ }
    finally { setIsLoadingSettlementFiles(false) }
  }, [])

  const normalizeSettlementFiles = useCallback(async () => {
    setIsNormalizingFiles(true)
    setNormalizeResult(null)
    try {
      const res = await fetch("/ma/api/mom-analysis/settlement-email/normalize", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "规范化失败")
      setNormalizeResult(data)
      await loadSettlementFiles()
      const changed = (data.renamed?.length ?? 0) + (data.deleted?.length ?? 0)
      toast({ title: changed > 0 ? `已整理 ${changed} 个文件` : "文件名已是最新格式，无需整理" })
    } catch (e) {
      toast({ title: "规范化失败", description: e instanceof Error ? e.message : "失败", variant: "destructive" })
    } finally {
      setIsNormalizingFiles(false)
    }
  }, [loadSettlementFiles, toast])

  const saveSettlementConfig = useCallback(async () => {
    setIsSavingSettlementCfg(true)
    try {
      const res = await fetch("/ma/api/mom-analysis/settlement-email/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settlementCfg),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "保存失败")
      toast({ title: "配置已保存" })
    } catch (e) {
      toast({ title: "保存失败", description: e instanceof Error ? e.message : "失败", variant: "destructive" })
    } finally {
      setIsSavingSettlementCfg(false)
    }
  }, [settlementCfg, toast])

  const fetchSettlementNow = useCallback(async () => {
    setIsFetchingSettlement(true)
    setSettlementFetchResult(null)
    try {
      const res = await fetch("/ma/api/mom-analysis/settlement-email/fetch-now", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "获取失败")
      setSettlementFetchResult(data)
      await loadSettlementFiles()
      if (data.downloaded?.length > 0) {
        toast({ title: `已下载 ${data.downloaded.length} 个文件` })
      } else {
        toast({ title: "未找到新的交易结算单(盯市)文件", description: "邮件中没有匹配的附件，或今日邮件尚未到达" })
      }
    } catch (e) {
      toast({ title: "获取失败", description: e instanceof Error ? e.message : "失败", variant: "destructive" })
    } finally {
      setIsFetchingSettlement(false)
    }
  }, [loadSettlementFiles, toast])

  useEffect(() => { loadFolders(); checkDates(); checkEtlStatus(); loadSettlementConfig(); loadSettlementFiles() }, [loadFolders, checkDates, checkEtlStatus, loadSettlementConfig, loadSettlementFiles])

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

  async function handleCapitalFlowImport(file: File) {
    setIsImportingCapitalFlow(true)
    setCapitalFlowResult(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/ma/api/mom-analysis/capital-flow/import", {
        method: "POST",
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "导入失败")
      setCapitalFlowResult({ success: true, message: data.message })
      toast({ title: "导入成功", description: data.message })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "导入失败"
      setCapitalFlowResult({ success: false, message: msg })
      toast({ title: "导入失败", description: msg, variant: "destructive" })
    } finally {
      setIsImportingCapitalFlow(false)
    }
  }

  async function handleAdvisorInfoImport(file: File) {
    setIsImportingAdvisorInfo(true)
    setAdvisorInfoResult(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/ma/api/mom-analysis/advisor-info/import", {
        method: "POST",
        body: fd,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "导入失败")
      setAdvisorInfoResult({ success: true, message: data.message })
      toast({ title: "导入成功", description: data.message })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "导入失败"
      setAdvisorInfoResult({ success: false, message: msg })
      toast({ title: "导入失败", description: msg, variant: "destructive" })
    } finally {
      setIsImportingAdvisorInfo(false)
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
    // Auto-trigger ETL whenever at least one file was successfully extracted
    if (allExtracted.length > 0) void runEtl()
  }

  async function handleUpload(file: File) {
    await handleFiles([file])
  }

  async function handleXlsxUpload() {
    const folderName = xlsxIsNewFolder ? xlsxCustomFolder.trim() : xlsxFolder
    if (!folderName) {
      toast({ title: "请选择或输入目标文件夹", variant: "destructive" }); return
    }
    if (xlsxFiles.length === 0) {
      toast({ title: "请选择至少一个 .xlsx 文件", variant: "destructive" }); return
    }

    setIsUploadingXlsx(true)
    try {
      // 1. Upload xlsx files to the target folder
      const fd = new FormData()
      fd.append("folder", folderName)
      for (const f of xlsxFiles) fd.append("files", f)
      const uploadRes = await fetch("/ma/api/mom-analysis/data-import/upload-xlsx", { method: "POST", body: fd })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploadData.error ?? "上传失败")
      if (xlsxInputRef.current) xlsxInputRef.current.value = ""
      setXlsxFiles([])
      await loadFolders()
      toast({ title: "文件已上传", description: uploadData.message })

      // 2. Rename files in the target folder
      setIsRenaming(true)
      setRenameResult(null)
      try {
        const renameRes = await fetch("/ma/api/mom-analysis/data-import/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folders: [folderName] }),
        })
        const renameData = await renameRes.json()
        setRenameResult(renameData)
        if (!renameData.nothingToDo) {
          setFolderFiles({}); setExpandedFolder(null)
          await loadFolders(); await checkDates()
        }
      } finally {
        setIsRenaming(false)
      }

      // 3. Run ETL (skip dedup + market data for single-file fast path)
      await runEtl({ skipDedup: true, skipMarketData: true })
    } catch (e) {
      toast({ title: "上传失败", description: e instanceof Error ? e.message : "失败", variant: "destructive" })
    } finally {
      setIsUploadingXlsx(false)
    }
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

        <Button
          variant="outline"
          size="sm"
          disabled={isRunningEtl || isUploading}
          onClick={() => void runEtl()}
        >
          {isRunningEtl
            ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            : <Play className="mr-2 h-4 w-4" />}
          {isRunningEtl ? "运行中…" : "运行ETL"}
        </Button>

        <Button variant="ghost" size="sm" disabled={isLoading} onClick={() => { setFolderFiles({}); setExpandedFolder(null); loadFolders(); checkDates() }}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          刷新
        </Button>

        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <FolderOpen className="h-4 w-4" />
          共 {totalFolders} 个日期文件夹
        </div>
      </div>

      {/* Drop zone (ZIP) */}
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

      {/* ── XLSX direct upload ───────────────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="pb-3 cursor-pointer select-none" onClick={() => setShowXlsxUpload((v) => !v)}>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            单日 XLSX 文件上传
            <ChevronDown className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${showXlsxUpload ? "rotate-180" : ""}`} />
          </CardTitle>
        </CardHeader>
        {showXlsxUpload && <CardContent className="space-y-3">
          {/* Folder selector */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">目标文件夹</span>
            {!xlsxIsNewFolder ? (
              <Select
                value={xlsxFolder}
                onValueChange={(v) => { if (v === "__new__") { setXlsxIsNewFolder(true); setXlsxFolder("") } else setXlsxFolder(v) }}
              >
                <SelectTrigger className="h-8 w-72 text-xs">
                  <SelectValue placeholder="选择已有文件夹…" />
                </SelectTrigger>
                <SelectContent>
                  {folders.map((f) => (
                    <SelectItem key={f.name} value={f.name} className="text-xs font-mono">{f.name}</SelectItem>
                  ))}
                  <SelectItem value="__new__" className="text-xs text-blue-600 dark:text-blue-400">＋ 新建文件夹…</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 w-72 text-xs font-mono"
                  placeholder="输入新文件夹名称，例如 恒2 20260331核算单"
                  value={xlsxCustomFolder}
                  onChange={(e) => setXlsxCustomFolder(e.target.value)}
                  autoFocus
                />
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setXlsxIsNewFolder(false); setXlsxCustomFolder("") }}>取消</Button>
              </div>
            )}
          </div>

          {/* Drop zone for xlsx */}
          <div
            className={`relative rounded-lg border-2 border-dashed transition-colors ${
              xlsxIsDragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-border"
            }`}
            onDragOver={(e) => { e.preventDefault(); setXlsxIsDragOver(true) }}
            onDragEnter={(e) => { e.preventDefault(); setXlsxIsDragOver(true) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setXlsxIsDragOver(false) }}
            onDrop={(e) => {
              e.preventDefault(); setXlsxIsDragOver(false)
              const dropped = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith(".xlsx"))
              if (dropped.length > 0) setXlsxFiles((prev) => [...prev, ...dropped])
            }}
          >
            <div className="flex flex-col items-center justify-center gap-2 py-5 text-center">
              <FileSpreadsheet className={`h-7 w-7 ${xlsxIsDragOver ? "text-primary" : "text-muted-foreground"}`} />
              <p className="text-sm font-medium">拖放 .xlsx 文件到此处</p>
              <Button
                variant="outline" size="sm" className="mt-1"
                disabled={isUploadingXlsx}
                onClick={() => xlsxInputRef.current?.click()}
              >
                选择文件
              </Button>
            </div>
            <input
              ref={xlsxInputRef}
              type="file"
              accept=".xlsx"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []).filter((f) => f.name.toLowerCase().endsWith(".xlsx"))
                if (picked.length > 0) setXlsxFiles((prev) => [...prev, ...picked])
              }}
            />
          </div>

          {/* Selected files list */}
          {xlsxFiles.length > 0 && (
            <div className="rounded-lg border border-border/60 divide-y divide-border/40 bg-card">
              <div className="flex items-center justify-between px-4 py-2 text-xs font-medium text-muted-foreground">
                <span>已选 {xlsxFiles.length} 个文件</span>
                <button onClick={() => setXlsxFiles([])} className="hover:text-foreground transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {xlsxFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-1.5 text-xs">
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  <span className="flex-1 truncate font-mono">{f.name}</span>
                  <button onClick={() => setXlsxFiles((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Button
            size="sm"
            disabled={isUploadingXlsx || xlsxFiles.length === 0 || (!xlsxIsNewFolder && !xlsxFolder) || (xlsxIsNewFolder && !xlsxCustomFolder.trim())}
            onClick={() => void handleXlsxUpload()}
          >
            {isUploadingXlsx
              ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />处理中…</>
              : <><UploadCloud className="mr-2 h-3.5 w-3.5" />上传并入库</>}
          </Button>
        </CardContent>}
      </Card>

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
            {isRunningEtl ? (
              <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
            ) : isLoadingEtl ? (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : etlStatus ? (
              etlStatus.notYetRun
                ? <Activity className="h-4 w-4 text-muted-foreground" />
                : etlStatus.errorFiles > 0
                  ? <AlertCircle className="h-4 w-4 text-amber-500" />
                  : <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : null}
            <span className="font-medium">ETL 入库状态</span>
            {isRunningEtl && <span className="text-xs text-blue-500">运行中…</span>}
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

      {/* ETL live log */}
      {(showEtlLog && etlLog.length > 0) && (
        <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/40">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Terminal className="h-3.5 w-3.5" />
              ETL 日志
              {isRunningEtl && <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAutoFollowLog((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {autoFollowLog ? "暂停跟随" : "恢复跟随"}
              </button>
              <button
                onClick={() => setShowEtlLog(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div
            ref={logScrollRef}
            className="h-56 overflow-y-auto bg-zinc-950 p-3 font-mono text-xs leading-relaxed"
            onScroll={(e) => {
              const el = e.currentTarget
              const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
              setAutoFollowLog(nearBottom)
            }}
          >
            {etlLog.map((line, i) => (
              <div key={i} className={classifyLogLine(line)}>
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

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
                                <span className="flex-1">{f}</span>
                                <a
                                  href={`/ma/api/mom-analysis/data-import/download?folder=${encodeURIComponent(folder.name)}&file=${encodeURIComponent(f)}`}
                                  download={f}
                                  className="hover:text-foreground transition-colors"
                                  title="下载"
                                >
                                  <ArrowDownToLine className="h-3 w-3" />
                                </a>
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

      {/* ── Capital Flow Import ────────────────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4 text-blue-500" />
            资金进出导入
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              历史交易确认明细（含当日已确认）
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            拖入从 TA 系统导出的 <span className="font-mono">历史交易确认明细*.xlsx</span>
            文件，将申购/认购/赎回记录全量写入数据库（每次导入会替换全部历史数据）。
          </p>

          {/* Drop zone */}
          <div
            className={`relative rounded-lg border-2 border-dashed transition-colors ${
              capitalFlowIsDragOver ? "border-blue-500 bg-blue-500/5" : "border-border/60 hover:border-border"
            }`}
            onDragOver={(e) => { e.preventDefault(); setCapitalFlowIsDragOver(true) }}
            onDragEnter={(e) => { e.preventDefault(); setCapitalFlowIsDragOver(true) }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setCapitalFlowIsDragOver(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setCapitalFlowIsDragOver(false)
              const dropped = Array.from(e.dataTransfer.files).find((f) =>
                f.name.toLowerCase().endsWith(".xlsx"),
              )
              if (dropped) setCapitalFlowFile(dropped)
            }}
          >
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
              <Database className={`h-7 w-7 ${capitalFlowIsDragOver ? "text-blue-500" : "text-muted-foreground"}`} />
              {capitalFlowFile ? (
                <>
                  <p className="text-sm font-medium text-foreground">{capitalFlowFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(capitalFlowFile.size / 1024).toFixed(1)} KB
                  </p>
                  <button
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                    onClick={() => setCapitalFlowFile(null)}
                  >
                    重新选择
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">拖放 .xlsx 文件到此处</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1"
                    disabled={isImportingCapitalFlow}
                    onClick={() => capitalFlowInputRef.current?.click()}
                  >
                    选择文件
                  </Button>
                </>
              )}
            </div>
            <input
              ref={capitalFlowInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) setCapitalFlowFile(f)
                if (capitalFlowInputRef.current) capitalFlowInputRef.current.value = ""
              }}
            />
          </div>

          {/* Import button & result */}
          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={!capitalFlowFile || isImportingCapitalFlow}
              onClick={() => capitalFlowFile && void handleCapitalFlowImport(capitalFlowFile)}
            >
              {isImportingCapitalFlow ? (
                <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />导入中…</>
              ) : (
                <><UploadCloud className="mr-2 h-3.5 w-3.5" />导入数据库</>
              )}
            </Button>

            {capitalFlowResult && (
              <div className={`flex items-center gap-1.5 text-sm ${capitalFlowResult.success ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                {capitalFlowResult.success
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                  : <AlertCircle className="h-4 w-4 shrink-0" />}
                {capitalFlowResult.message}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4 text-violet-500" />
            投顾信息导入
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              投顾信息.xlsx
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            拖入 <span className="font-mono">投顾信息.xlsx</span> 或同结构文件，将工作表中的投顾名录全量写入数据库。
            板块列若为空会自动沿用上一行板块，每次导入会替换整张表。
          </p>

          <div
            className={`relative rounded-lg border-2 border-dashed transition-colors ${
              advisorInfoIsDragOver ? "border-violet-500 bg-violet-500/5" : "border-border/60 hover:border-border"
            }`}
            onDragOver={(e) => { e.preventDefault(); setAdvisorInfoIsDragOver(true) }}
            onDragEnter={(e) => { e.preventDefault(); setAdvisorInfoIsDragOver(true) }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setAdvisorInfoIsDragOver(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              setAdvisorInfoIsDragOver(false)
              const dropped = Array.from(e.dataTransfer.files).find((f) =>
                f.name.toLowerCase().endsWith(".xlsx"),
              )
              if (dropped) setAdvisorInfoFile(dropped)
            }}
          >
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
              <Database className={`h-7 w-7 ${advisorInfoIsDragOver ? "text-violet-500" : "text-muted-foreground"}`} />
              {advisorInfoFile ? (
                <>
                  <p className="text-sm font-medium text-foreground">{advisorInfoFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(advisorInfoFile.size / 1024).toFixed(1)} KB
                  </p>
                  <button
                    className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                    onClick={() => setAdvisorInfoFile(null)}
                  >
                    重新选择
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">拖放 .xlsx 文件到此处</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1"
                    disabled={isImportingAdvisorInfo}
                    onClick={() => advisorInfoInputRef.current?.click()}
                  >
                    选择文件
                  </Button>
                </>
              )}
            </div>
            <input
              ref={advisorInfoInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) setAdvisorInfoFile(f)
                if (advisorInfoInputRef.current) advisorInfoInputRef.current.value = ""
              }}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              disabled={!advisorInfoFile || isImportingAdvisorInfo}
              onClick={() => advisorInfoFile && void handleAdvisorInfoImport(advisorInfoFile)}
            >
              {isImportingAdvisorInfo ? (
                <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />导入中…</>
              ) : (
                <><UploadCloud className="mr-2 h-3.5 w-3.5" />导入数据库</>
              )}
            </Button>

            {advisorInfoResult && (
              <div className={`flex items-center gap-1.5 text-sm ${advisorInfoResult.success ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                {advisorInfoResult.success
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                  : <AlertCircle className="h-4 w-4 shrink-0" />}
                {advisorInfoResult.message}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Settlement Email Auto-Download ─────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader
          className="pb-3 cursor-pointer select-none"
          onClick={() => setShowSettlementSetup((v) => !v)}
        >
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Mail className="h-4 w-4 text-sky-500" />
            国信交易结算单 自动下载
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              每日自动从邮箱获取盯市结算单 .xlsx
            </span>
            <div className="ml-auto flex items-center gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  settlementCfg.enabled
                    ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {settlementCfg.enabled ? "已启用" : "已停用"}
              </span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showSettlementSetup ? "rotate-180" : ""}`} />
            </div>
          </CardTitle>
        </CardHeader>

        {showSettlementSetup && (
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              配置 IMAP 邮箱，系统每天到达设定时间后自动连接收件箱。
              填写<span className="font-mono mx-1">发件人地址</span>后按发件人筛选邮件；
              留空则退回到按主题匹配（主题须含 <span className="font-mono">YYYYMMDD_××××_交易结算单</span>）。
              下载所有 .xlsx 附件后读取 A3 单元格，仅保存值为
              <span className="font-mono mx-1">交易结算单(盯市)</span>的文件到服务器指定目录。
              运行 ETL 时也会自动触发一次结算单获取。
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Sender filter */}
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs text-muted-foreground">发件人地址过滤（推荐，留空则按主题匹配）</label>
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="hulingyu1@guosen.com.cn"
                  value={settlementCfg.sender}
                  onChange={(e) => setSettlementCfg((c) => ({ ...c, sender: e.target.value }))}
                />
              </div>

              {/* Email provider preset */}
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs text-muted-foreground">邮件服务商（选择后自动填入服务器地址）</label>
                <Select
                  value=""
                  onValueChange={(v) => {
                    const presets: Record<string, { imapHost: string; imapPort: number }> = {
                      "163":       { imapHost: "imap.163.com",         imapPort: 993 },
                      "126":       { imapHost: "imap.126.com",         imapPort: 993 },
                      "qq":        { imapHost: "imap.qq.com",          imapPort: 993 },
                      "exmail_qq": { imapHost: "imap.exmail.qq.com",   imapPort: 993 },
                      "ali":       { imapHost: "imap.mxhichina.com",   imapPort: 993 },
                      "gmail":     { imapHost: "imap.gmail.com",       imapPort: 993 },
                      "outlook":   { imapHost: "outlook.office365.com",imapPort: 993 },
                      "sina":      { imapHost: "imap.sina.com",        imapPort: 993 },
                    }
                    const p = presets[v]
                    if (p) setSettlementCfg((c) => ({ ...c, ...p }))
                  }}
                >
                  <SelectTrigger className="h-8 w-56 text-xs">
                    <SelectValue placeholder="选择常用邮箱类型…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="163" className="text-xs">163 邮箱</SelectItem>
                    <SelectItem value="126" className="text-xs">126 邮箱</SelectItem>
                    <SelectItem value="qq" className="text-xs">QQ 邮箱</SelectItem>
                    <SelectItem value="exmail_qq" className="text-xs">腾讯企业邮箱</SelectItem>
                    <SelectItem value="ali" className="text-xs">阿里企业邮箱</SelectItem>
                    <SelectItem value="gmail" className="text-xs">Gmail</SelectItem>
                    <SelectItem value="outlook" className="text-xs">Outlook / Office 365</SelectItem>
                    <SelectItem value="sina" className="text-xs">新浪邮箱</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Email */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">邮箱地址</label>
                <Input
                  className="h-8 text-xs"
                  placeholder="ch_c7h8@163.com"
                  value={settlementCfg.email}
                  onChange={(e) => setSettlementCfg((c) => ({ ...c, email: e.target.value }))}
                />
              </div>

              {/* Password / IMAP token */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">授权码 / 密码</label>
                <Input
                  className="h-8 text-xs"
                  type="password"
                  placeholder="163 IMAP 授权码"
                  value={settlementCfg.pass}
                  onChange={(e) => setSettlementCfg((c) => ({ ...c, pass: e.target.value }))}
                />
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1.5 leading-relaxed">
                  <span className="font-medium">如何获取密码？</span> 需要授权码。获取方式：163邮箱 → 设置 → POP3/SMTP/IMAP → 开启 IMAP 服务 → 新建授权码。
                </p>
              </div>

              {/* IMAP host */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">IMAP 服务器</label>
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="imap.163.com"
                  value={settlementCfg.imapHost}
                  onChange={(e) => setSettlementCfg((c) => ({ ...c, imapHost: e.target.value }))}
                />
              </div>

              {/* IMAP port */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">端口（SSL 993）</label>
                <Input
                  className="h-8 text-xs font-mono"
                  type="number"
                  placeholder="993"
                  value={settlementCfg.imapPort}
                  onChange={(e) => setSettlementCfg((c) => ({ ...c, imapPort: Number(e.target.value) }))}
                />
              </div>

              {/* Schedule time */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">每日触发时间（24h）</label>
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="19:00"
                  value={settlementCfg.scheduleTime}
                  onChange={(e) => setSettlementCfg((c) => ({ ...c, scheduleTime: e.target.value }))}
                />
              </div>

              {/* Enable toggle */}
              <div className="space-y-1 flex items-end">
                <button
                  type="button"
                  onClick={() => setSettlementCfg((c) => ({ ...c, enabled: !c.enabled }))}
                  className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
                    settlementCfg.enabled
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                      : "border-border bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {settlementCfg.enabled ? "✓ 自动下载已开启" : "自动下载已关闭"}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                disabled={isSavingSettlementCfg}
                onClick={() => void saveSettlementConfig()}
              >
                {isSavingSettlementCfg
                  ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />保存中…</>
                  : <><Save className="mr-2 h-3.5 w-3.5" />保存配置</>}
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={isFetchingSettlement}
                onClick={() => void fetchSettlementNow()}
              >
                {isFetchingSettlement
                  ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />获取中…</>
                  : <><Download className="mr-2 h-3.5 w-3.5" />立即获取</>}
              </Button>

              {settlementLastFetch && (
                <span className="text-xs text-muted-foreground">
                  上次获取：{new Date(settlementLastFetch).toLocaleString("zh-CN")}
                </span>
              )}
            </div>

            {/* Fetch result */}
            {settlementFetchResult && (
              <div className="rounded-lg border border-border/60 divide-y divide-border/40 bg-card text-xs">
                {settlementFetchResult.downloaded.length > 0 && (
                  <div className="px-4 py-2 space-y-0.5">
                    <p className="font-medium text-emerald-600 dark:text-emerald-400 mb-1">
                      已下载 {settlementFetchResult.downloaded.length} 个文件
                    </p>
                    {settlementFetchResult.downloaded.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 font-mono text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {f}
                      </div>
                    ))}
                  </div>
                )}
                {settlementFetchResult.skipped.length > 0 && (
                  <div className="px-4 py-2 space-y-0.5">
                    <p className="font-medium text-muted-foreground mb-1">
                      已跳过 {settlementFetchResult.skipped.length} 个（A3 不符）
                    </p>
                    {settlementFetchResult.skipped.map((f, i) => (
                      <div key={i} className="font-mono text-muted-foreground">↷ {f}</div>
                    ))}
                  </div>
                )}
                {settlementFetchResult.errors.length > 0 && (
                  <div className="px-4 py-2 space-y-0.5">
                    {settlementFetchResult.errors.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 font-mono text-destructive">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {f}
                      </div>
                    ))}
                  </div>
                )}
                {settlementFetchResult.downloaded.length === 0 &&
                  settlementFetchResult.skipped.length === 0 &&
                  settlementFetchResult.errors.length === 0 && (
                  <div className="px-4 py-2 text-muted-foreground">未找到匹配邮件</div>
                )}
                {settlementFetchResult.log && settlementFetchResult.log.length > 0 && (
                  <div className="px-4 py-2 space-y-0.5 border-t border-border/40">
                    <p className="font-medium text-xs text-muted-foreground mb-1">诊断日志</p>
                    {settlementFetchResult.log.map((line, i) => (
                      <div key={i} className="font-mono text-xs text-muted-foreground">{line}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ── Downloaded settlement files ─────────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-sky-500" />
            国信已下载结算单
            {settlementFolder && (
              <span className="ml-1 font-mono text-xs font-normal text-muted-foreground truncate max-w-xs">
                {settlementFolder}
              </span>
            )}
            <button
              className="ml-auto text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              disabled={isNormalizingFiles}
              onClick={() => void normalizeSettlementFiles()}
              title="规范化文件名（重命名旧格式、删除重复）"
            >
              <Wand2 className={`h-3.5 w-3.5 ${isNormalizingFiles ? "animate-spin" : ""}`} />
            </button>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              disabled={isLoadingSettlementFiles}
              onClick={() => void loadSettlementFiles()}
              title="刷新"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingSettlementFiles ? "animate-spin" : ""}`} />
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingSettlementFiles ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : settlementFiles.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              暂无文件，点击「立即获取」或等待每日自动下载
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {settlementFiles.map((f) => (
                <div key={f.name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="flex-1 font-mono text-xs truncate">{f.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {(f.size / 1024).toFixed(1)} KB
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(f.mtime).toLocaleDateString("zh-CN")}
                  </span>
                  <a
                    href={`/ma/api/mom-analysis/settlement-email/download?file=${encodeURIComponent(f.name)}`}
                    download={f.name}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="下载"
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </CardContent>
        {normalizeResult && (
          <div className="border-t border-border/40 px-4 py-3 text-xs space-y-1">
            <p className="font-medium text-muted-foreground mb-1">规范化结果</p>
            {normalizeResult.renamed.map((r, i) => (
              <div key={i} className="font-mono text-emerald-600 dark:text-emerald-400">
                ✓ {r.from} → {r.to}
              </div>
            ))}
            {normalizeResult.deleted.map((d, i) => (
              <div key={i} className="font-mono text-amber-600 dark:text-amber-400">
                ✕ {d}
              </div>
            ))}
            {normalizeResult.errors.map((e, i) => (
              <div key={i} className="font-mono text-destructive">{e}</div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
