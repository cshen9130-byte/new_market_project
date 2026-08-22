"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderOpen,
  Globe,
  Mail,
  Play,
  Plus,
  RefreshCw,
  Save,
  Terminal,
  Trash2,
  UploadCloud,
} from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type DownloadedFile = { name: string; size: number; mtime: string; rel?: string; bookId?: string | null; bookName?: string | null }

type ImportBookSource = "upload" | "email" | "cfmmc"

type ImportBook = {
  id: string
  name: string
  createdAt: string
  files: string[]
  source?: ImportBookSource
  cfmmcUserId?: string
}

function bookSource(b: ImportBook): ImportBookSource {
  if (b.source === "cfmmc" || !!b.cfmmcUserId || /^监控中心\s/.test(b.name)) return "cfmmc"
  if (b.source === "email" || /^邮箱/.test(b.name)) return "email"
  return "upload"
}

const NEW_BOOK = "__new__"
const UPLOAD_BOOK_KEY = "account-risk-upload-book"

function fileLabel(f: DownloadedFile) {
  const rel = f.rel || f.name
  return rel.includes("/") ? rel.split("/").pop()! : rel
}

type EmailConfig = {
  email: string
  pass: string
  imapHost: string
  imapPort: number
  enabled: boolean
  scheduleTime: string
  sender: string
  lastFetchDate: string | null
  lastFetchAt: string | null
}

type CfmmcAccount = {
  id: string
  label: string
  userId: string
  password: string
  enabled: boolean
  lastFetchDate: string | null
  lastFetchAt: string | null
  lastError: string | null
  lastFile: string | null
}

type CfmmcConfig = {
  enabled: boolean
  scheduleTime: string
  lastRunAt: string | null
  accounts: CfmmcAccount[]
}

type FetchResult = {
  downloaded: string[]
  skipped: string[]
  errors: string[]
  log: string[]
}

const EMAIL_PRESETS: Record<string, { imapHost: string; imapPort: number }> = {
  "163": { imapHost: "imap.163.com", imapPort: 993 },
  "126": { imapHost: "imap.126.com", imapPort: 993 },
  qq: { imapHost: "imap.qq.com", imapPort: 993 },
  exmail_qq: { imapHost: "imap.exmail.qq.com", imapPort: 993 },
  ali: { imapHost: "imap.mxhichina.com", imapPort: 993 },
  gmail: { imapHost: "imap.gmail.com", imapPort: 993 },
  outlook: { imapHost: "outlook.office365.com", imapPort: 993 },
}

const API = "/ma/api/mom-analysis/account-risk-import"

type JobLogLine = { t: string; src: "fetch" | "etl" | "job"; msg: string }

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    return String((payload as { error: unknown }).error)
  }
  return fallback
}

export default function AccountRiskDataImport() {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [isDragOver, setIsDragOver] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const [files, setFiles] = useState<DownloadedFile[]>([])
  const [books, setBooks] = useState<ImportBook[]>([])
  const [folder, setFolder] = useState("")
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [isClearingFiles, setIsClearingFiles] = useState(false)
  const [uploadBookId, setUploadBookId] = useState(NEW_BOOK)
  const [newBookName, setNewBookName] = useState("")
  const [assignName, setAssignName] = useState("")
  const [isAssigning, setIsAssigning] = useState(false)
  const [listFilter, setListFilter] = useState("all")

  const [emailCfg, setEmailCfg] = useState<EmailConfig>({
    email: "",
    pass: "",
    imapHost: "imap.163.com",
    imapPort: 993,
    enabled: false,
    scheduleTime: "17:00",
    sender: "",
    lastFetchDate: null,
    lastFetchAt: null,
  })
  const [isSavingEmail, setIsSavingEmail] = useState(false)
  const [isFetchingEmail, setIsFetchingEmail] = useState(false)
  const [emailResult, setEmailResult] = useState<FetchResult | null>(null)

  const [cfmmc, setCfmmc] = useState<CfmmcConfig>({
    enabled: false,
    scheduleTime: "17:00",
    lastRunAt: null,
    accounts: [],
  })
  const [newLabel, setNewLabel] = useState("")
  const [newUserId, setNewUserId] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [isSavingCfmmc, setIsSavingCfmmc] = useState(false)
  const [isAddingAccount, setIsAddingAccount] = useState(false)
  const [fetchingAccountId, setFetchingAccountId] = useState<string | null>(null)
  const [isFetchingAllCfmmc, setIsFetchingAllCfmmc] = useState(false)

  type Section = "upload" | "email" | "cfmmc"
  const [activeSection, setActiveSection] = useState<Section>("upload")

  const [jobLines, setJobLines] = useState<JobLogLine[]>([])
  const jobLogRef = useRef<HTMLDivElement | null>(null)
  const [runningEtlKey, setRunningEtlKey] = useState<string | null>(null)
  const [etlResult, setEtlResult] = useState<{
    processed: number; inserted: number; updated: number; skipped: number
    syncedDaily?: number; syncedPositions?: number; errors: string[]
    label?: string
  } | null>(null)

  const loadFiles = useCallback(async () => {
    setIsLoadingFiles(true)
    try {
      const res = await fetch(`${API}/files`, { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "加载失败"))
      const nextBooks = (data.books ?? []) as ImportBook[]
      setFiles(data.files ?? [])
      setBooks(nextBooks)
      setFolder(data.folder ?? "")
      setUploadBookId((prev) => {
        const isUpload = (id: string) => nextBooks.some((b) => b.id === id && bookSource(b) === "upload")
        if (prev !== NEW_BOOK && isUpload(prev)) return prev
        try {
          const saved = sessionStorage.getItem(UPLOAD_BOOK_KEY)
          if (saved && saved !== NEW_BOOK && isUpload(saved)) return saved
        } catch { /* ignore */ }
        return NEW_BOOK
      })
    } catch (e) {
      toast({ title: "加载文件失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setIsLoadingFiles(false)
    }
  }, [toast])

  const loadEmailConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API}/email-config`, { cache: "no-store" })
      const data = await res.json()
      if (res.ok) setEmailCfg((c) => ({ ...c, ...data }))
    } catch {
      // ignore
    }
  }, [])

  const loadCfmmc = useCallback(async () => {
    try {
      const res = await fetch(`${API}/cfmmc-config`, { cache: "no-store" })
      const data = await res.json()
      if (res.ok) setCfmmc(data)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void loadFiles()
    void loadEmailConfig()
    void loadCfmmc()
  }, [loadFiles, loadEmailConfig, loadCfmmc])

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const res = await fetch(`${API}/job-log`, { cache: "no-store" })
        const data = await res.json() as { lines?: JobLogLine[] }
        if (!stop && Array.isArray(data.lines)) setJobLines(data.lines.slice(-400))
      } catch { /* ignore */ }
    }
    void tick()
    const id = window.setInterval(() => { void tick() }, 800)
    return () => { stop = true; window.clearInterval(id) }
  }, [])

  useEffect(() => {
    const el = jobLogRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [jobLines])

  function addDroppedFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((f) => /\.(xlsx|xls|xlsm)$/i.test(f.name))
    if (incoming.length === 0) {
      toast({ title: "格式不支持", description: "请拖入 .xls / .xlsx 文件", variant: "destructive" })
      return
    }
    setPendingFiles((prev) => [...prev, ...incoming])
  }

  function resolveUploadBook(): { bookId?: string; bookName?: string; label: string } | null {
    if (uploadBookId !== NEW_BOOK) {
      const existing = books.find((b) => b.id === uploadBookId)
      if (!existing) return null
      return { bookId: existing.id, label: existing.name }
    }
    const name = newBookName.trim()
    if (!name) return null
    return { bookName: name, label: name }
  }

  async function uploadPending() {
    if (pendingFiles.length === 0) {
      toast({ title: "请先选择文件", variant: "destructive" })
      return
    }
    const target = resolveUploadBook()
    if (!target) {
      toast({ title: "请填写账户名称", description: "这批文件会保存到该账户，之后可在报表页切换查看。", variant: "destructive" })
      return
    }
    setIsUploading(true)
    try {
      const fd = new FormData()
      for (const f of pendingFiles) fd.append("files", f)
      if (target.bookId) fd.append("bookId", target.bookId)
      if (target.bookName) fd.append("bookName", target.bookName)
      const res = await fetch(`${API}/upload`, { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "上传失败"))
      const savedBook = data.book as ImportBook | undefined
      if (savedBook?.id) {
        setUploadBookId(savedBook.id)
        setNewBookName("")
        try { sessionStorage.setItem(UPLOAD_BOOK_KEY, savedBook.id) } catch { /* ignore */ }
      }
      toast({ title: data.message ?? `已保存到「${target.label}」` })
      setPendingFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ""
      await loadFiles()
    } catch (e) {
      toast({ title: "上传失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setIsUploading(false)
    }
  }

  async function assignExistingFiles(rels: string[], nameHint?: string) {
    const name = ((nameHint ?? assignName) || newBookName).trim()
    if (!name) {
      toast({ title: "请填写账户名称", description: "给这批已导入文件起一个名字，之后可在报表页切换查看。", variant: "destructive" })
      return
    }
    setIsAssigning(true)
    try {
      const res = await fetch(`${API}/assign-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, files: rels }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "命名失败"))
      const savedBook = data.book as ImportBook | undefined
      if (savedBook?.id) {
        setUploadBookId(savedBook.id)
        setAssignName("")
        try { sessionStorage.setItem(UPLOAD_BOOK_KEY, savedBook.id) } catch { /* ignore */ }
      }
      toast({ title: data.message ?? `已归到「${name}」` })
      await loadFiles()
    } catch (e) {
      toast({ title: "命名失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setIsAssigning(false)
    }
  }

  async function runEtlFor(mode: "incremental" | "full", bookId?: string, label?: string) {
    const key = `${bookId ?? "all"}:${mode}`
    setRunningEtlKey(key)
    setEtlResult(null)
    try {
      const res = await fetch("/ma/api/account-risk/run-etl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookId ? { mode, bookId } : { mode, source: activeSection }),
      })
      const data = await res.json() as { ok: boolean; result?: typeof etlResult; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? "运行失败")
      const next = { ...(data.result ?? { processed: 0, inserted: 0, updated: 0, skipped: 0, errors: [] }), label: label ?? "全部账户" }
      setEtlResult(next)
      toast({
        title: mode === "full" ? `「${next.label}」全量计算完成` : `「${next.label}」计算完成`,
        description: next.errors[0] ? next.errors[0] : `处理 ${next.processed} 个文件。`,
        variant: next.errors.length > 0 ? "destructive" : undefined,
      })
    } catch (e) {
      toast({ title: "计算失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setRunningEtlKey(null)
    }
  }

  async function deleteOneFile(rel: string) {
    try {
      const res = await fetch(`${API}/delete?file=${encodeURIComponent(rel)}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "删除失败"))
      await loadFiles()
    } catch (e) {
      toast({ title: "删除失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    }
  }

  async function clearAllFiles() {
    if (sectionFiles.length === 0) return
    if (!confirm(`确认删除本页 ${sectionFiles.length} 个文件？只清空当前导入方式，不影响其他页。`)) return
    setIsClearingFiles(true)
    try {
      const res = await fetch(`${API}/delete?all=1&source=${encodeURIComponent(activeSection)}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "清空失败"))
      const n = Array.isArray(data.deleted) ? data.deleted.length : sectionFiles.length
      toast({ title: `已删除 ${n} 个文件`, description: "只删除了当前页的文件。" })
      await loadFiles()
    } catch (e) {
      toast({ title: "清空失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setIsClearingFiles(false)
    }
  }
  async function saveEmail() {
    setIsSavingEmail(true)
    try {
      const res = await fetch(`${API}/email-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailCfg),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "保存失败"))
      toast({ title: "邮箱配置已保存" })
    } catch (e) {
      toast({ title: "保存失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setIsSavingEmail(false)
    }
  }

  async function fetchEmailNow() {
    setIsFetchingEmail(true)
    setEmailResult(null)
    try {
      const res = await fetch(`${API}/email-fetch`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "获取失败"))
      setEmailResult(data)
      await loadEmailConfig()
      await loadFiles()
    } catch (e) {
      toast({ title: "邮箱获取失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setIsFetchingEmail(false)
    }
  }

  async function saveCfmmcSettings() {
    setIsSavingCfmmc(true)
    try {
      const res = await fetch(`${API}/cfmmc-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: cfmmc.enabled, scheduleTime: cfmmc.scheduleTime }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "保存失败"))
      if (data.config) setCfmmc(data.config)
      toast({ title: "监控中心日程已保存" })
    } catch (e) {
      toast({ title: "保存失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setIsSavingCfmmc(false)
    }
  }

  async function addAccount() {
    if (!newUserId.trim() || !newPassword.trim()) {
      toast({ title: "请填写用户名和密码", variant: "destructive" })
      return
    }
    setIsAddingAccount(true)
    try {
      const res = await fetch(`${API}/cfmmc-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newLabel.trim() || newUserId.trim(),
          userId: newUserId.trim(),
          password: newPassword,
          enabled: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "添加失败"))
      if (data.config) setCfmmc(data.config)
      setNewLabel("")
      setNewUserId("")
      setNewPassword("")
      toast({ title: "账户已添加" })
    } catch (e) {
      toast({ title: "添加失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setIsAddingAccount(false)
    }
  }

  async function toggleAccount(account: CfmmcAccount) {
    try {
      const res = await fetch(`${API}/cfmmc-accounts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: account.id, enabled: !account.enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "更新失败"))
      if (data.config) setCfmmc(data.config)
    } catch (e) {
      toast({ title: "更新失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    }
  }

  async function removeAccount(account: CfmmcAccount) {
    if (!confirm(`确认删除账户 ${account.label || account.userId}？`)) return
    try {
      const res = await fetch(`${API}/cfmmc-accounts?id=${encodeURIComponent(account.id)}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "删除失败"))
      if (data.config) setCfmmc(data.config)
    } catch (e) {
      toast({ title: "删除失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    }
  }

  async function fetchCfmmc(accountId?: string) {
    if (accountId) setFetchingAccountId(accountId)
    else setIsFetchingAllCfmmc(true)
    try {
      const res = await fetch(`${API}/cfmmc-fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountId ? { accountId } : {}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "获取失败"))
      const results = (data.results ?? []) as {
        ok: boolean; label: string; userId: string; filename?: string
        downloaded?: number; skipped?: number; discarded?: number; etlProcessed?: number; etlError?: string; error?: string
      }[]
      const okCount = results.filter((r) => r.ok).length
      const fail = results.filter((r) => !r.ok)
      const okDesc = results
        .filter((r) => r.ok)
        .map((r) => {
          const bits = [`新下载 ${r.downloaded ?? 0} 个`]
          if (r.skipped) bits.push(`跳过已有 ${r.skipped}`)
          if (r.discarded) bits.push(`无结算 ${r.discarded}`)
          if (r.etlProcessed != null) bits.push(`已计算 ${r.etlProcessed} 个文件`)
          if (r.etlError) bits.push(`计算失败: ${r.etlError}`)
          return `${r.label || r.userId}: ${bits.join("，")}`
        })
        .join("；")
      toast({
        title: `监控中心获取完成（成功 ${okCount}/${results.length}）`,
        description: [okDesc, fail.length > 0 ? fail.map((r) => `${r.label || r.userId}: ${r.error}`).join("；") : ""]
          .filter(Boolean)
          .join("；") || undefined,
        variant: fail.length > 0 && okCount === 0 ? "destructive" : "default",
      })
      await loadCfmmc()
      await loadFiles()
    } catch (e) {
      toast({ title: "监控中心获取失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setFetchingAccountId(null)
      setIsFetchingAllCfmmc(false)
    }
  }

  const uploadBooks = books.filter((b) => b.id !== "ungrouped" && bookSource(b) === "upload")
  const sectionBooks = books.filter((b) => b.files.length > 0 && bookSource(b) === activeSection)
  const sectionFiles = files.filter((f) => {
    const book = books.find((b) => b.id === (f.bookId ?? "ungrouped"))
    if (!book) return activeSection === "upload"
    return bookSource(book) === activeSection
  })
  const emptyHint =
    activeSection === "email"
      ? "暂无邮箱获取的文件"
      : activeSection === "cfmmc"
        ? "暂无监控中心获取的文件"
        : "暂无拖入文件"
  const visibleFiles = listFilter === "all" ? sectionFiles : sectionFiles.filter((f) => (f.bookId ?? "ungrouped") === listFilter)
  const fileGroups: { id: string; name: string; files: DownloadedFile[] }[] = []
  {
    const seen = new Map<string, DownloadedFile[]>()
    for (const f of visibleFiles) {
      const id = f.bookId ?? "ungrouped"
      const name = f.bookName ?? "未分组"
      const list = seen.get(id)
      if (list) list.push(f)
      else {
        seen.set(id, [f])
        fileGroups.push({ id, name, files: seen.get(id)! })
      }
    }
  }

  const tabs: { key: Section; label: string; icon: React.ReactNode; badge?: string }[] = [
    { key: "upload", label: "拖入文件", icon: <UploadCloud className="h-3.5 w-3.5" /> },
    {
      key: "email",
      label: "邮箱获取",
      icon: <Mail className="h-3.5 w-3.5" />,
      badge: emailCfg.enabled ? "已启用" : undefined,
    },
    {
      key: "cfmmc",
      label: "监控中心",
      icon: <Globe className="h-3.5 w-3.5" />,
      badge: cfmmc.enabled ? "已启用" : undefined,
    },
  ]

  return (
    <div className="space-y-4 pb-8">

      {/* ── Tab switcher ── */}
      <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveSection(tab.key)
              setListFilter("all")
            }}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeSection === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.badge && (
              <span className="ml-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white leading-none">
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Upload section ── */}
      {activeSection === "upload" && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <UploadCloud className="h-4 w-4 text-sky-500" />
              拖入文件
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              先给这批文件起一个账户名称，再拖入 .xls / .xlsx（如监控中心「客户交易结算日报」）。
              之后可在报表页的账户下拉框切换查看。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">保存到账户</label>
                <Select
                  value={uploadBookId}
                  onValueChange={(v) => {
                    setUploadBookId(v)
                    try { sessionStorage.setItem(UPLOAD_BOOK_KEY, v) } catch { /* ignore */ }
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="选择或新建账户" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_BOOK} className="text-xs">＋ 新建账户</SelectItem>
                    {uploadBooks.map((b) => (
                      <SelectItem key={b.id} value={b.id} className="text-xs">
                        {b.name}（{b.files.length} 个文件）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {uploadBookId === NEW_BOOK && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">账户名称</label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="例如 荣熙恒盈2号"
                    value={newBookName}
                    onChange={(e) => setNewBookName(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div
              className={`relative rounded-lg border-2 border-dashed transition-colors ${
                isDragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-border"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false) }}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragOver(false)
                addDroppedFiles(e.dataTransfer.files)
              }}
            >
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <FileSpreadsheet className={`h-9 w-9 ${isDragOver ? "text-primary" : "text-muted-foreground"}`} />
                <p className="text-sm font-medium">拖放 .xls / .xlsx 到此处</p>
                <Button variant="outline" size="sm" className="mt-1" onClick={() => fileInputRef.current?.click()}>
                  选择文件
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx,.xlsm"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addDroppedFiles(e.target.files)
                }}
              />
            </div>
            {pendingFiles.length > 0 && (
              <div className="space-y-2">
                <div className="divide-y divide-border/40 rounded-md border border-border/60 text-xs">
                  {pendingFiles.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="flex-1 font-mono truncate">{f.name}</span>
                      <span className="text-muted-foreground tabular-nums">{(f.size / 1024).toFixed(1)} KB</span>
                      <button
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  disabled={isUploading || !resolveUploadBook()}
                  onClick={() => void uploadPending()}
                >
                  {isUploading
                    ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />上传中…</>
                    : <>上传 {pendingFiles.length} 个文件到「{resolveUploadBook()?.label ?? "…"}」</>}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Email section ── */}
      {activeSection === "email" && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-4 w-4 text-amber-500" />
              邮箱获取
              <span className={`ml-auto text-[11px] font-normal px-2 py-0.5 rounded ${
                emailCfg.enabled ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
              }`}>
                {emailCfg.enabled ? "已启用" : "已停用"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              每天到达设定时间后自动连接收件箱，下载最近 3 天内的 .xls / .xlsx 附件。
              填写发件人后按发件人过滤；留空则保存该时间范围内全部表格附件。
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs text-muted-foreground">发件人地址过滤（可选）</label>
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="settlement@example.com"
                  value={emailCfg.sender}
                  onChange={(e) => setEmailCfg((c) => ({ ...c, sender: e.target.value }))}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label className="text-xs text-muted-foreground">邮件服务商</label>
                <Select
                  value=""
                  onValueChange={(v) => {
                    const p = EMAIL_PRESETS[v]
                    if (p) setEmailCfg((c) => ({ ...c, ...p }))
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
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">邮箱地址</label>
                <Input
                  className="h-8 text-xs"
                  value={emailCfg.email}
                  onChange={(e) => setEmailCfg((c) => ({ ...c, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">授权码 / 密码</label>
                <Input
                  className="h-8 text-xs"
                  type="password"
                  value={emailCfg.pass}
                  onChange={(e) => setEmailCfg((c) => ({ ...c, pass: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">IMAP 服务器</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={emailCfg.imapHost}
                  onChange={(e) => setEmailCfg((c) => ({ ...c, imapHost: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">端口（SSL 993）</label>
                <Input
                  className="h-8 text-xs font-mono"
                  type="number"
                  value={emailCfg.imapPort}
                  onChange={(e) => setEmailCfg((c) => ({ ...c, imapPort: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">每日触发时间（24h）</label>
                <Input
                  className="h-8 text-xs font-mono"
                  type="time"
                  value={emailCfg.scheduleTime}
                  onChange={(e) => setEmailCfg((c) => ({ ...c, scheduleTime: e.target.value }))}
                />
              </div>
              <div className="space-y-1 flex items-end">
                <button
                  type="button"
                  onClick={() => setEmailCfg((c) => ({ ...c, enabled: !c.enabled }))}
                  className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
                    emailCfg.enabled
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                      : "border-border bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {emailCfg.enabled ? "✓ 自动下载已开启" : "自动下载已关闭"}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" disabled={isSavingEmail} onClick={() => void saveEmail()}>
                {isSavingEmail
                  ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />保存中…</>
                  : <><Save className="mr-2 h-3.5 w-3.5" />保存配置</>}
              </Button>
              <Button size="sm" variant="outline" disabled={isFetchingEmail} onClick={() => void fetchEmailNow()}>
                {isFetchingEmail
                  ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />获取中…</>
                  : <><Download className="mr-2 h-3.5 w-3.5" />立即获取</>}
              </Button>
              {emailCfg.lastFetchAt && (
                <span className="text-xs text-muted-foreground">
                  上次：{new Date(emailCfg.lastFetchAt).toLocaleString("zh-CN")}
                </span>
              )}
            </div>
            {emailResult && (
              <div className="rounded-lg border border-border/60 divide-y divide-border/40 text-xs">
                {emailResult.downloaded.length > 0 && (
                  <div className="px-4 py-2 space-y-0.5">
                    <p className="font-medium text-emerald-600 mb-1">已下载 {emailResult.downloaded.length} 个文件</p>
                    {emailResult.downloaded.map((f) => (
                      <div key={f} className="flex items-center gap-2 font-mono text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {f}
                      </div>
                    ))}
                  </div>
                )}
                {emailResult.skipped.length > 0 && (
                  <div className="px-4 py-2 font-mono text-muted-foreground">
                    {emailResult.skipped.map((f) => <div key={f}>↷ {f}</div>)}
                  </div>
                )}
                {emailResult.errors.length > 0 && (
                  <div className="px-4 py-2">
                    {emailResult.errors.map((f) => (
                      <div key={f} className="flex items-center gap-2 font-mono text-destructive">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {f}
                      </div>
                    ))}
                  </div>
                )}
                {emailResult.log.length > 0 && (
                  <div className="px-4 py-2 space-y-0.5">
                    {emailResult.log.map((line, i) => (
                      <div key={i} className="font-mono text-muted-foreground">{line}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── CFMMC section ── */}
      {activeSection === "cfmmc" && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Globe className="h-4 w-4 text-violet-500" />
              监控中心自动获取
              <span className={`ml-auto text-[11px] font-normal px-2 py-0.5 rounded ${
                cfmmc.enabled ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
              }`}>
                {cfmmc.enabled ? "已启用" : "已停用"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              登录
              <a
                href="https://investorservice.cfmmc.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="mx-1 font-medium text-foreground underline underline-offset-2"
              >
                中国期货市场监控中心投资者查询服务系统
              </a>
              ，自动识别验证码并下载「客户交易结算日报」xls。
              点击「立即获取」会按日切换监控中心结算日期再下载。只保留文件内「交易日期」与文件名一致的日报；没有结算单的日期不会保存。已有正确文件会跳过。每天定时任务只拉最新一天。
              需安装 <span className="font-mono">playwright</span>、<span className="font-mono">ddddocr</span>、<span className="font-mono">requests</span>
              （<span className="font-mono">pip install -r scripts/ma/requirements-cfmmc.txt</span> 后执行
              <span className="font-mono"> python -m playwright install chromium</span>）。
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">每日触发时间</label>
                <Input
                  className="h-8 w-36 text-xs font-mono"
                  type="time"
                  value={cfmmc.scheduleTime}
                  onChange={(e) => setCfmmc((c) => ({ ...c, scheduleTime: e.target.value }))}
                />
              </div>
              <button
                type="button"
                onClick={() => setCfmmc((c) => ({ ...c, enabled: !c.enabled }))}
                className={`h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
                  cfmmc.enabled
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                    : "border-border bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {cfmmc.enabled ? "✓ 每日自动获取已开启" : "每日自动获取已关闭"}
              </button>
              <Button size="sm" disabled={isSavingCfmmc} onClick={() => void saveCfmmcSettings()}>
                {isSavingCfmmc
                  ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />保存中…</>
                  : <><Save className="mr-2 h-3.5 w-3.5" />保存日程</>}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isFetchingAllCfmmc || fetchingAccountId !== null || cfmmc.accounts.filter((a) => a.enabled).length === 0}
                onClick={() => void fetchCfmmc()}
              >
                {isFetchingAllCfmmc
                  ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />获取中…</>
                  : <><Download className="mr-2 h-3.5 w-3.5" />立即获取全部</>}
              </Button>
              {cfmmc.lastRunAt && (
                <span className="text-xs text-muted-foreground">
                  上次：{new Date(cfmmc.lastRunAt).toLocaleString("zh-CN")}
                </span>
              )}
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">添加账户</p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <Input
                  className="h-8 text-xs"
                  placeholder="备注（如 账户A）"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="监控中心用户名"
                  value={newUserId}
                  onChange={(e) => setNewUserId(e.target.value)}
                />
                <Input
                  className="h-8 text-xs"
                  type="password"
                  placeholder="密码"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <Button size="sm" className="h-8" disabled={isAddingAccount} onClick={() => void addAccount()}>
                  {isAddingAccount
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <><Plus className="mr-1 h-3.5 w-3.5" />添加</>}
                </Button>
              </div>
            </div>

            {cfmmc.accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                还没有账户。添加后即可按日程自动拉取结算日报。
              </p>
            ) : (
              <div className="divide-y divide-border/40 rounded-lg border border-border/60">
                {cfmmc.accounts.map((account) => (
                  <div key={account.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{account.label || account.userId}</p>
                      <p className="text-xs font-mono text-muted-foreground truncate">{account.userId}</p>
                      {account.lastError && (
                        <p className="text-xs text-destructive truncate" title={account.lastError}>{account.lastError}</p>
                      )}
                      {account.lastFetchAt && (
                        <p className="text-xs text-muted-foreground">
                          上次：{new Date(account.lastFetchAt).toLocaleString("zh-CN")}
                          {account.lastFile ? ` · ${account.lastFile}` : ""}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => void toggleAccount(account)}
                      className={`h-7 px-2 rounded text-[11px] font-medium border ${
                        account.enabled
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {account.enabled ? "启用" : "停用"}
                    </button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={isFetchingAllCfmmc || fetchingAccountId !== null}
                      onClick={() => void fetchCfmmc(account.id)}
                    >
                      {fetchingAccountId === account.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : "立即获取"}
                    </Button>
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      title="删除"
                      onClick={() => void removeAccount(account)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Run ETL ── */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Play className="h-4 w-4 text-blue-500" />
            运行数据计算
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            只计算当前页的文件。拖入、邮箱、监控中心互不影响。
          </p>
          <div className="divide-y divide-border/40 rounded-lg border border-border/60">
            {sectionBooks.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">{emptyHint}</p>
            ) : sectionBooks.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{b.files.length} 个文件</p>
                </div>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={runningEtlKey !== null}
                  onClick={() => void runEtlFor("incremental", b.id, b.name)}
                >
                  {runningEtlKey === `${b.id}:incremental`
                    ? <><RefreshCw className="mr-1 h-3 w-3 animate-spin" />计算中…</>
                    : <><Play className="mr-1 h-3 w-3" />增量计算</>}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={runningEtlKey !== null}
                  onClick={() => {
                    if (!confirm(`全量重算「${b.name}」？只刷新该账户的图表数据。`)) return
                    void runEtlFor("full", b.id, b.name)
                  }}
                >
                  {runningEtlKey === `${b.id}:full`
                    ? <><RefreshCw className="mr-1 h-3 w-3 animate-spin" />重算中…</>
                    : "全量重算"}
                </Button>
              </div>
            ))}
            {sectionBooks.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm bg-muted/20">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">全部账户</p>
                  <p className="text-xs text-muted-foreground">一次处理本页全部文件</p>
                </div>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  disabled={runningEtlKey !== null}
                  onClick={() => void runEtlFor("incremental", undefined, "本页全部")}
                >
                  {runningEtlKey === "all:incremental"
                    ? <><RefreshCw className="mr-1 h-3 w-3 animate-spin" />计算中…</>
                    : <><Play className="mr-1 h-3 w-3" />增量计算</>}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={runningEtlKey !== null}
                  onClick={() => {
                    if (!confirm("全量重算本页全部文件？不影响其他导入方式。")) return
                    void runEtlFor("full", undefined, "本页全部")
                  }}
                >
                  {runningEtlKey === "all:full"
                    ? <><RefreshCw className="mr-1 h-3 w-3 animate-spin" />重算中…</>
                    : "全量重算"}
                </Button>
              </div>
            )}
          </div>
          {etlResult && (
            <div className="rounded-md border border-border/60 bg-muted/40 p-3 space-y-1 text-xs">
              <div className="flex flex-wrap gap-4 text-muted-foreground">
                {etlResult.label && <span>账户 <strong className="text-foreground">{etlResult.label}</strong></span>}
                <span>处理 <strong className="text-foreground">{etlResult.processed}</strong> 文件</span>
                <span>新增 <strong className="text-foreground">{etlResult.inserted}</strong></span>
                <span>更新 <strong className="text-foreground">{etlResult.updated}</strong></span>
                <span>跳过 <strong className="text-foreground">{etlResult.skipped}</strong></span>
                {etlResult.syncedDaily !== undefined && (
                  <span>同步日报 <strong className="text-foreground">{etlResult.syncedDaily}</strong> 条</span>
                )}
                {etlResult.syncedPositions !== undefined && (
                  <span>同步持仓 <strong className="text-foreground">{etlResult.syncedPositions}</strong> 条</span>
                )}
              </div>
              {etlResult.errors.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {etlResult.errors.map((err, i) => (
                    <p key={i} className="text-destructive">{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Imported files (always visible) ── */}
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            已导入文件
            {folder && (
              <span className="ml-1 font-mono text-xs font-normal text-muted-foreground truncate max-w-xs">
                {folder}
              </span>
            )}
            <button
              className="ml-auto text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={isLoadingFiles || isClearingFiles}
              onClick={() => void loadFiles()}
              title="刷新"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoadingFiles ? "animate-spin" : ""}`} />
            </button>
            {sectionBooks.length > 0 && (
              <Select
                value={sectionBooks.some((b) => b.id === listFilter) ? listFilter : "all"}
                onValueChange={setListFilter}
              >
                <SelectTrigger className="h-7 w-40 text-xs">
                  <SelectValue placeholder="全部账户" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">全部账户</SelectItem>
                  {sectionBooks.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {sectionFiles.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs text-destructive hover:text-destructive"
                disabled={isLoadingFiles || isClearingFiles}
                onClick={() => void clearAllFiles()}
              >
                {isClearingFiles
                  ? <><RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" />清空中…</>
                  : <><Trash2 className="mr-1 h-3.5 w-3.5" />清空全部</>}
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingFiles ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : visibleFiles.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{emptyHint}</div>
          ) : (
            <div className="divide-y divide-border/40">
              {fileGroups.map((g) => (
                <div key={g.id}>
                  <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 bg-muted/40 text-xs font-medium text-muted-foreground">
                    <FolderOpen className="h-3.5 w-3.5" />
                    {g.name}
                    <span className="font-normal">· {g.files.length} 个文件</span>
                    {g.id === "ungrouped" && activeSection === "upload" && (
                      <div className="ml-auto flex items-center gap-2 font-normal">
                        <Input
                          className="h-7 w-40 text-xs"
                          placeholder="账户名称"
                          value={assignName}
                          onChange={(e) => setAssignName(e.target.value)}
                        />
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={isAssigning || (!assignName.trim() && !newBookName.trim())}
                          onClick={() => void assignExistingFiles(g.files.map((f) => f.rel || f.name))}
                        >
                          {isAssigning
                            ? <><RefreshCw className="mr-1 h-3 w-3 animate-spin" />保存中…</>
                            : "设为账户"}
                        </Button>
                      </div>
                    )}
                  </div>
                  {g.files.map((f) => {
                    const rel = f.rel || f.name
                    return (
                      <div key={rel} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
                        <span className="flex-1 font-mono text-xs truncate" title={rel}>{fileLabel(f)}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{(f.size / 1024).toFixed(1)} KB</span>
                        <span className="text-xs text-muted-foreground">{f.mtime ? new Date(f.mtime).toLocaleString("zh-CN") : ""}</span>
                        <button
                          className="text-muted-foreground hover:text-destructive"
                          title="删除"
                          onClick={() => {
                            if (!confirm(`确认删除 ${fileLabel(f)}？`)) return
                            void deleteOneFile(rel)
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Terminal className="h-4 w-4 text-amber-500" />
            运行日志
            {(isFetchingAllCfmmc || fetchingAccountId || runningEtlKey) && (
              <span className="text-[11px] font-normal text-amber-600">运行中…</span>
            )}
            <button
              type="button"
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                setJobLines([])
                void fetch(`${API}/job-log`, { method: "DELETE" })
              }}
            >
              清空
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            ref={jobLogRef}
            className="h-56 overflow-auto rounded-md bg-zinc-950 px-3 py-2 font-mono text-[11px] leading-5 text-zinc-200"
          >
            {jobLines.length === 0 ? (
              <p className="text-zinc-500">点击「立即获取」或「计算」后，这里会实时显示命令状态。</p>
            ) : jobLines.map((line, i) => (
              <div key={`${line.t}-${i}`} className="whitespace-pre-wrap break-all">
                <span className="text-zinc-500">{new Date(line.t).toLocaleTimeString("zh-CN")} </span>
                <span className={line.src === "etl" ? "text-sky-400" : "text-emerald-400"}>[{line.src}]</span>
                {" "}{line.msg}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
