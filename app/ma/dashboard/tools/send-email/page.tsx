"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Send,
  ServerCog,
  Trash2,
  X,
} from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// ─── SMTP Presets ────────────────────────────────────────────────────────────

const SMTP_PRESETS = [
  { label: "腾讯企业邮箱",  host: "smtp.exmail.qq.com", port: "465", secure: true,  authNote: "使用邮箱登录密码。如需 SMTP 需在企业邮后台开启：管理员后台 → 邮箱设置 → 开启 SMTP 服务。" },
  { label: "QQ 邮箱",      host: "smtp.qq.com",        port: "465", secure: true,  authNote: "需要授权码，不能用登录密码。获取方式：QQ邮箱 → 设置 → 账户 → 开启 POP3/SMTP 服务 → 生成授权码。" },
  { label: "网易 163 邮箱", host: "smtp.163.com",       port: "465", secure: true,  authNote: "需要授权码。获取方式：163邮箱 → 设置 → POP3/SMTP/IMAP → 开启 SMTP 服务 → 新建授权码。" },
  { label: "网易 126 邮箱", host: "smtp.126.com",       port: "465", secure: true,  authNote: "需要授权码。获取方式：126邮箱 → 设置 → POP3/SMTP/IMAP → 开启 SMTP 服务 → 新建授权码。" },
  { label: "阿里企业邮箱", host: "smtp.mxhichina.com", port: "465", secure: true,  authNote: "使用邮箱登录密码。需在阿里企业邮管理后台开启 SMTP。" },
  { label: "Gmail",        host: "smtp.gmail.com",     port: "465", secure: true,  authNote: "需要应用专用密码（App Password），不能用 Google 账号密码。获取方式：Google 账号 → 安全性 → 两步验证（开启后）→ 应用专用密码。" },
  { label: "Outlook / Hotmail", host: "smtp.office365.com", port: "587", secure: false, authNote: "使用 Microsoft 账号密码（需开启两步验证时可生成应用密码）。" },
  { label: "自定义",       host: "", port: "465", secure: true, authNote: "" },
] as const

type SmtpPresetLabel = (typeof SMTP_PRESETS)[number]["label"]

// ─── Types ────────────────────────────────────────────────────────────────────

type SenderAccount = {
  id: string
  name: string
  host: string
  port: number
  user: string
  secure: boolean
  createdAt: string
  // pass is never returned by list endpoint
}

type DispatchSetup = {
  id: string
  name: string
  senderId: string | null
  traderCode: string
  to: string[]
  subject: string
  content: string
  scheduleTime: string
  enabled: boolean
  lastSentDate: string | null
  lastSentAt: string | null
  createdAt: string
}

type TraderOption = {
  traderCode: string
  fileName: string
  dateStr: string
}

// ─── Dispatch form state ──────────────────────────────────────────────────────

type DispatchForm = {
  name: string
  senderId: string
  traderCode: string
  toInput: string
  subject: string
  content: string
  scheduleHour: string
  scheduleMinute: string
  enabled: boolean
}

const DEFAULT_DISPATCH_FORM: DispatchForm = {
  name: "",
  senderId: "",
  traderCode: "",
  toInput: "",
  subject: "[投顾代码] 核算单 [日期]",
  content: "您好，\n\n请查收附件中 [日期] 的逐日核算单，文件名：[文件名]。\n\n此邮件由系统自动发送，请勿回复。",
  scheduleHour: "17",
  scheduleMinute: "30",
  enabled: true,
}

// ─── Sender form state ────────────────────────────────────────────────────────

type SenderForm = {
  name: string
  host: string
  port: string
  user: string
  pass: string
  secure: boolean
}

const DEFAULT_SENDER_FORM: SenderForm = {
  name: "",
  host: "",
  port: "465",
  user: "",
  pass: "",
  secure: true,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function readError(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as Record<string, unknown>).error === "string"
  ) {
    return (payload as { error: string }).error
  }
  return fallback
}

function formatLastSent(setup: DispatchSetup): string {
  if (!setup.lastSentAt) return "尚未发送"
  const d = new Date(setup.lastSentAt)
  return d.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })
}

const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))
const minutes = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]

// ═══════════════════════════════════════════════════════════════════════════════
// Main page component
// ═══════════════════════════════════════════════════════════════════════════════

export default function SendEmailToolPage() {
  const { toast } = useToast()

  // ── Shared data ─────────────────────────────────────────────────────────────
  const [senders, setSenders] = useState<SenderAccount[]>([])
  const [setups, setSetups] = useState<DispatchSetup[]>([])
  const [traders, setTraders] = useState<TraderOption[]>([])
  const [loadingSetups, setLoadingSetups] = useState(true)
  const [loadingSenders, setLoadingSenders] = useState(true)

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("setups")

  // ── Dispatch state ──────────────────────────────────────────────────────────
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [setupDeleteTarget, setSetupDeleteTarget] = useState<DispatchSetup | null>(null)
  const [dispatchDialogOpen, setDispatchDialogOpen] = useState(false)
  const [editingSetupId, setEditingSetupId] = useState<string | null>(null)
  const [dispatchForm, setDispatchForm] = useState<DispatchForm>(DEFAULT_DISPATCH_FORM)
  const [savingSetup, setSavingSetup] = useState(false)

  // ── Sender state ────────────────────────────────────────────────────────────
  const [senderDeleteTarget, setSenderDeleteTarget] = useState<SenderAccount | null>(null)
  const [senderDialogOpen, setSenderDialogOpen] = useState(false)
  const [editingSenderId, setEditingSenderId] = useState<string | null>(null)
  const [senderForm, setSenderForm] = useState<SenderForm>(DEFAULT_SENDER_FORM)
  const [savingSender, setSavingSender] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadSenders = useCallback(async () => {
    setLoadingSenders(true)
    try {
      const res = await fetch("/ma/api/tools/email-dispatch/senders")
      const data = await res.json()
      if (res.ok) setSenders(data as SenderAccount[])
    } catch {
      /* non-critical */
    } finally {
      setLoadingSenders(false)
    }
  }, [])

  const loadSetups = useCallback(async () => {
    setLoadingSetups(true)
    try {
      const res = await fetch("/ma/api/tools/email-dispatch/setups")
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "加载失败"))
      setSetups(data as DispatchSetup[])
    } catch (e) {
      toast({ title: "加载失败", description: e instanceof Error ? e.message : "未知错误", variant: "destructive" })
    } finally {
      setLoadingSetups(false)
    }
  }, [toast])

  const loadTraders = useCallback(async () => {
    try {
      const res = await fetch("/ma/api/tools/email-dispatch/browse-traders")
      const data = await res.json()
      if (res.ok) setTraders(data as TraderOption[])
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => {
    loadSenders()
    loadSetups()
    loadTraders()
  }, [loadSenders, loadSetups, loadTraders])

  // ═══════════════════════════════════════════════════════════════════════════
  // Sender account CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  function openCreateSender() {
    setEditingSenderId(null)
    setSenderForm(DEFAULT_SENDER_FORM)
    setSenderDialogOpen(true)
  }

  async function openEditSender(sender: SenderAccount) {
    setEditingSenderId(sender.id)
    // Fetch full record (includes pass)
    try {
      const res = await fetch(`/ma/api/tools/email-dispatch/senders/${sender.id}`)
      const data = await res.json()
      if (res.ok) {
        setSenderForm({
          name: data.name,
          host: data.host,
          port: String(data.port),
          user: data.user,
          pass: data.pass ?? "",
          secure: data.secure,
        })
      } else {
        setSenderForm({ name: sender.name, host: sender.host, port: String(sender.port), user: sender.user, pass: "", secure: sender.secure })
      }
    } catch {
      setSenderForm({ name: sender.name, host: sender.host, port: String(sender.port), user: sender.user, pass: "", secure: sender.secure })
    }
    setSenderDialogOpen(true)
  }

  async function handleSaveSender() {
    if (!senderForm.name.trim()) { toast({ title: "请填写账号名称", variant: "destructive" }); return }
    if (!senderForm.host.trim()) { toast({ title: "请填写 SMTP 服务器", variant: "destructive" }); return }
    if (!senderForm.user.trim()) { toast({ title: "请填写用户名", variant: "destructive" }); return }
    if (!editingSenderId && !senderForm.pass.trim()) { toast({ title: "请填写密码", variant: "destructive" }); return }

    setSavingSender(true)
    try {
      const url = editingSenderId
        ? `/ma/api/tools/email-dispatch/senders/${editingSenderId}`
        : "/ma/api/tools/email-dispatch/senders"
      const method = editingSenderId ? "PUT" : "POST"
      const body: Record<string, unknown> = {
        name: senderForm.name.trim(),
        host: senderForm.host.trim(),
        port: Number(senderForm.port || 465),
        user: senderForm.user.trim(),
        secure: senderForm.secure,
      }
      if (senderForm.pass.trim()) body.pass = senderForm.pass.trim()

      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "保存失败"))
      toast({ title: editingSenderId ? "已更新发件账号" : "已添加发件账号" })
      setSenderDialogOpen(false)
      loadSenders()
    } catch (e) {
      toast({ title: "保存失败", description: e instanceof Error ? e.message : "未知", variant: "destructive" })
    } finally {
      setSavingSender(false)
    }
  }

  async function handleDeleteSender(sender: SenderAccount) {
    try {
      const res = await fetch(`/ma/api/tools/email-dispatch/senders/${sender.id}`, { method: "DELETE" })
      if (!res.ok) { const d = await res.json(); throw new Error(readError(d, "删除失败")) }
      toast({ title: "已删除发件账号", description: sender.name })
      loadSenders()
    } catch (e) {
      toast({ title: "删除失败", description: e instanceof Error ? e.message : "未知", variant: "destructive" })
    } finally {
      setSenderDeleteTarget(null)
    }
  }

  async function handleTestSender(sender: SenderAccount) {
    setTestingId(sender.id)
    try {
      const res = await fetch(`/ma/api/tools/email-dispatch/senders/${sender.id}/test`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "连接失败"))
      toast({ title: "连接成功", description: `${sender.user} SMTP 连接正常。` })
    } catch (e) {
      toast({ title: "连接失败", description: e instanceof Error ? e.message : "未知", variant: "destructive" })
    } finally {
      setTestingId(null)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Dispatch setup CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  function openCreateSetup() {
    setEditingSetupId(null)
    setDispatchForm(DEFAULT_DISPATCH_FORM)
    setDispatchDialogOpen(true)
  }

  function openEditSetup(setup: DispatchSetup) {
    const [h, m] = setup.scheduleTime.split(":")
    setEditingSetupId(setup.id)
    setDispatchForm({
      name: setup.name,
      senderId: setup.senderId ?? "",
      traderCode: setup.traderCode,
      toInput: setup.to.join("; "),
      subject: setup.subject,
      content: setup.content,
      scheduleHour: h,
      scheduleMinute: m,
      enabled: setup.enabled,
    })
    setDispatchDialogOpen(true)
  }



  async function handleSaveSetup() {
    if (!dispatchForm.name.trim()) { toast({ title: "请填写配置名称", variant: "destructive" }); return }
    if (!dispatchForm.traderCode.trim()) { toast({ title: "请选择或填写投顾代码", variant: "destructive" }); return }
    const toList = dispatchForm.toInput.split(/[;；]/).map((s) => s.trim()).filter(Boolean)
    const invalidTo = toList.filter((p) => !EMAIL_RE.test(p))
    if (toList.length === 0) { toast({ title: "至少填写一个收件人", variant: "destructive" }); return }
    if (invalidTo.length) { toast({ title: "收件人格式有误", description: `地址格式不正确：${invalidTo.join(", ")}`, variant: "destructive" }); return }
    if (!dispatchForm.subject.trim()) { toast({ title: "请填写邮件主题", variant: "destructive" }); return }

    const scheduleTime = `${dispatchForm.scheduleHour.padStart(2, "0")}:${dispatchForm.scheduleMinute.padStart(2, "0")}`
    const body = {
      name: dispatchForm.name.trim(),
      senderId: dispatchForm.senderId || null,
      traderCode: dispatchForm.traderCode.trim(),
      to: toList,
      subject: dispatchForm.subject.trim(),
      content: dispatchForm.content.trim(),
      scheduleTime,
      enabled: dispatchForm.enabled,
    }

    setSavingSetup(true)
    try {
      const url = editingSetupId
        ? `/ma/api/tools/email-dispatch/setups/${editingSetupId}`
        : "/ma/api/tools/email-dispatch/setups"
      const method = editingSetupId ? "PUT" : "POST"
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "保存失败"))
      toast({ title: editingSetupId ? "已更新配置" : "已创建配置" })
      setDispatchDialogOpen(false)
      loadSetups()
    } catch (e) {
      toast({ title: "保存失败", description: e instanceof Error ? e.message : "未知", variant: "destructive" })
    } finally {
      setSavingSetup(false)
    }
  }

  async function handleDeleteSetup(setup: DispatchSetup) {
    try {
      const res = await fetch(`/ma/api/tools/email-dispatch/setups/${setup.id}`, { method: "DELETE" })
      if (!res.ok) { const d = await res.json(); throw new Error(readError(d, "删除失败")) }
      toast({ title: "已删除配置", description: setup.name })
      loadSetups()
    } catch (e) {
      toast({ title: "删除失败", description: e instanceof Error ? e.message : "未知", variant: "destructive" })
    } finally {
      setSetupDeleteTarget(null)
    }
  }

  async function handleToggleEnabled(setup: DispatchSetup) {
    try {
      const res = await fetch(`/ma/api/tools/email-dispatch/setups/${setup.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !setup.enabled }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(readError(d, "更新失败")) }
      loadSetups()
    } catch (e) {
      toast({ title: "更新失败", description: e instanceof Error ? e.message : "未知", variant: "destructive" })
    }
  }

  async function handleSendNow(setup: DispatchSetup) {
    setSendingId(setup.id)
    try {
      const res = await fetch(`/ma/api/tools/email-dispatch/setups/${setup.id}/send-now`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(readError(data, "发送失败"))
      toast({ title: "发送成功", description: `已发送 ${data.fileName}（${data.dateStr}）` })
      loadSetups()
    } catch (e) {
      toast({ title: "发送失败", description: e instanceof Error ? e.message : "未知", variant: "destructive" })
    } finally {
      setSendingId(null)
    }
  }

  // ── Helper: resolve sender display name ──────────────────────────────────────

  function senderLabel(senderId: string | null): string {
    if (!senderId) return "环境变量 (SMTP_*)"
    const s = senders.find((a) => a.id === senderId)
    return s ? `${s.name} (${s.user})` : "未知账号"
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6 pt-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link href="/ma/dashboard/tools" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            返回小工具
          </Link>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">自动发邮件</h1>
            <p className="mt-2 text-muted-foreground">
              管理发件账号和定时发送配置，每天自动将最新逐日核算单发送至指定投顾邮箱。
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between gap-4">
        <TabsList>
          <TabsTrigger value="setups" className="gap-2">
            <Send className="h-4 w-4" />
            发送配置
            {setups.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">{setups.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="senders" className="gap-2">
            <ServerCog className="h-4 w-4" />
            发件账号
            {senders.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">{senders.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>
        {activeTab === "setups" && (
          <Button onClick={openCreateSetup} className="gap-2">
            <Plus className="h-4 w-4" />
            添加配置
          </Button>
        )}
        {activeTab === "senders" && (
          <Button onClick={openCreateSender} className="gap-2">
            <Plus className="h-4 w-4" />
            添加账号
          </Button>
        )}
        </div>

        {/* ── Tab: 发送配置 ───────────────────────────────────────────────────── */}
        <TabsContent value="setups" className="mt-6 space-y-6">
          <Alert>
            <Mail className="h-4 w-4" />
            <AlertTitle>自动替换标签</AlertTitle>
            <AlertDescription className="space-y-1">
              <span>在主题或正文中插入以下标签，发送时会自动替换为实际内容：</span>
              <ul className="mt-1 space-y-0.5 text-xs">
                <li><code className="rounded bg-muted px-1">[日期]</code> → 当天交易日，例如 2026-04-02</li>
                <li><code className="rounded bg-muted px-1">[投顾代码]</code> → 投顾账户编号，例如 rx051</li>
                <li><code className="rounded bg-muted px-1">[文件名]</code> → 附件文件名，例如 核算信息_rx051_20260402_逐日盯市.xlsx</li>
              </ul>
            </AlertDescription>
          </Alert>

          {loadingSetups ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : setups.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Mail className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-muted-foreground">暂无发送配置，点击「添加配置」开始设置。</p>
                <Button variant="secondary" onClick={openCreateSetup} className="gap-2">
                  <Plus className="h-4 w-4" />
                  添加配置
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {setups.map((setup) => (
                <Card key={setup.id} className="flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{setup.name}</CardTitle>
                        <CardDescription className="mt-1">
                          <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">{setup.traderCode}</code>
                        </CardDescription>
                      </div>
                      <Switch
                        checked={setup.enabled}
                        onCheckedChange={() => handleToggleEnabled(setup)}
                        aria-label="启用/禁用"
                        className="mt-0.5 shrink-0"
                      />
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-start gap-2">
                        <ServerCog className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-muted-foreground">{senderLabel(setup.senderId)}</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="break-all text-muted-foreground">{setup.to.join(", ")}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          每日 <span className="font-medium text-foreground">{setup.scheduleTime}</span> 发送
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {setup.lastSentAt ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                        ) : (
                          <span className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span className="text-muted-foreground">上次：{formatLastSent(setup)}</span>
                      </div>
                    </div>

                    <Badge variant={setup.enabled ? "default" : "secondary"} className="w-fit">
                      {setup.enabled ? "已启用" : "已禁用"}
                    </Badge>

                    <div className="mt-auto flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1.5"
                        onClick={() => handleSendNow(setup)}
                        disabled={sendingId === setup.id}
                      >
                        {sendingId === setup.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        {sendingId === setup.id ? "发送中…" : "立即发送"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEditSetup(setup)} aria-label="编辑">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => setSetupDeleteTarget(setup)}
                        aria-label="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Tab: 发件账号 ───────────────────────────────────────────────────── */}
        <TabsContent value="senders" className="mt-6 space-y-6">
          <p className="text-sm text-muted-foreground">
            配置 SMTP 发件账号，在发送配置中选择使用。若不选择，系统将使用服务器环境变量（SMTP_HOST / SMTP_USER / SMTP_PASS）。
          </p>

          {loadingSenders ? (
            <p className="text-sm text-muted-foreground">加载中…</p>
          ) : senders.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <ServerCog className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-muted-foreground">暂无发件账号，点击「添加账号」配置 SMTP。</p>
                <Button variant="secondary" onClick={openCreateSender} className="gap-2">
                  <Plus className="h-4 w-4" />
                  添加账号
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {senders.map((sender) => (
                <Card key={sender.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{sender.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">{sender.user}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <div>
                        服务器：<span className="text-foreground">{sender.host}:{sender.port}</span>
                      </div>
                      <div>
                        加密：<span className="text-foreground">{sender.secure ? "SSL/TLS" : "STARTTLS / 无"}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1.5"
                        onClick={() => handleTestSender(sender)}
                        disabled={testingId === sender.id}
                      >
                        {testingId === sender.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        {testingId === sender.id ? "测试中…" : "测试连接"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEditSender(sender)} aria-label="编辑">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => setSenderDeleteTarget(sender)}
                        aria-label="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ══ Dispatch setup dialog ═══════════════════════════════════════════════ */}
      <Dialog open={dispatchDialogOpen} onOpenChange={setDispatchDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingSetupId ? "编辑发送配置" : "添加发送配置"}</DialogTitle>
            <DialogDescription>
              填写配置后保存，系统将在指定时间自动发送最新核算单附件。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="cfg-name">配置名称 <span className="text-destructive">*</span></Label>
              <Input
                id="cfg-name"
                placeholder="例：张三 核算单"
                value={dispatchForm.name}
                onChange={(e) => setDispatchForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            {/* Sender */}
            <div className="space-y-2">
              <Label htmlFor="cfg-sender">发件账号</Label>
              <Select
                value={dispatchForm.senderId || "__env__"}
                onValueChange={(v) => setDispatchForm((f) => ({ ...f, senderId: v === "__env__" ? "" : v }))}
              >
                <SelectTrigger id="cfg-sender">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__env__">环境变量 (SMTP_*)</SelectItem>
                  {senders.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} — {s.user}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {senders.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  未配置发件账号，将使用服务器环境变量。可前往「发件账号」标签页添加。
                </p>
              )}
            </div>

            {/* Trader code */}
            <div className="space-y-2">
              <Label htmlFor="cfg-trader">投顾代码 <span className="text-destructive">*</span></Label>
              {traders.length > 0 ? (
                <Select
                  value={dispatchForm.traderCode}
                  onValueChange={(v) => setDispatchForm((f) => ({ ...f, traderCode: v }))}
                >
                  <SelectTrigger id="cfg-trader">
                    <SelectValue placeholder="选择投顾代码…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {traders.map((t) => (
                      <SelectItem key={t.traderCode} value={t.traderCode}>
                        {t.traderCode}
                        <span className="ml-2 text-xs text-muted-foreground">({t.dateStr})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="cfg-trader"
                  placeholder="例：rx051"
                  value={dispatchForm.traderCode}
                  onChange={(e) => setDispatchForm((f) => ({ ...f, traderCode: e.target.value }))}
                />
              )}
            </div>

            {/* Recipients */}
            <div className="space-y-2">
              <Label>收件人 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="example@domain.com; another@domain.com"
                value={dispatchForm.toInput}
                onChange={(e) => setDispatchForm((f) => ({ ...f, toInput: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">多个收件人用 ; 分隔</p>
            </div>

            {/* Subject */}
            <div className="space-y-2">
              <Label htmlFor="cfg-subject">邮件主题 <span className="text-destructive">*</span></Label>
              <Input
                id="cfg-subject"
                value={dispatchForm.subject}
                onChange={(e) => setDispatchForm((f) => ({ ...f, subject: e.target.value }))}
              />
            </div>

            {/* Content */}
            <div className="space-y-2">
              <Label htmlFor="cfg-content">邮件正文</Label>
              <Textarea
                id="cfg-content"
                rows={5}
                value={dispatchForm.content}
                onChange={(e) => setDispatchForm((f) => ({ ...f, content: e.target.value }))}
                className="resize-y font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                在文字中插入标签，发送时自动替换：<br />
                <code className="rounded bg-muted px-1">[日期]</code> 当天交易日 &nbsp;
                <code className="rounded bg-muted px-1">[投顾代码]</code> 投顾账户编号 &nbsp;
                <code className="rounded bg-muted px-1">[文件名]</code> 附件文件名
              </p>
            </div>

            {/* Schedule time */}
            <div className="space-y-2">
              <Label>定时发送时间（每天）</Label>
              <div className="flex items-center gap-2">
                <Select value={dispatchForm.scheduleHour} onValueChange={(v) => setDispatchForm((f) => ({ ...f, scheduleHour: v }))}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    {hours.map((h) => <SelectItem key={h} value={h}>{h} 时</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select value={dispatchForm.scheduleMinute} onValueChange={(v) => setDispatchForm((f) => ({ ...f, scheduleMinute: v }))}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {minutes.map((m) => <SelectItem key={m} value={m}>{m} 分</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Enabled */}
            <div className="flex items-center gap-3">
              <Switch
                id="cfg-enabled"
                checked={dispatchForm.enabled}
                onCheckedChange={(v) => setDispatchForm((f) => ({ ...f, enabled: v }))}
              />
              <Label htmlFor="cfg-enabled">立即启用此配置</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchDialogOpen(false)}>取消</Button>
            <Button onClick={handleSaveSetup} disabled={savingSetup}>{savingSetup ? "保存中…" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ Sender account dialog ════════════════════════════════════════════════ */}
      <Dialog open={senderDialogOpen} onOpenChange={setSenderDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingSenderId ? "编辑发件账号" : "添加发件账号"}</DialogTitle>
            <DialogDescription>
              密码 / 授权码仅存储在服务器本地，不会上传。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Quick preset */}
            <div className="space-y-2">
              <Label>邮件服务商 <span className="text-xs text-muted-foreground">（选择后自动填入服务器地址）</span></Label>
              <Select
                onValueChange={(val) => {
                  const preset = SMTP_PRESETS.find((p) => p.label === (val as SmtpPresetLabel))
                  if (preset) setSenderForm((f) => ({ ...f, host: preset.host, port: preset.port, secure: preset.secure }))
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择常用邮箱类型…" />
                </SelectTrigger>
                <SelectContent>
                  {SMTP_PRESETS.map((p) => (
                    <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="s-name">账号名称 <span className="text-destructive">*</span></Label>
              <Input id="s-name" placeholder="例：市场监控邮箱" value={senderForm.name} onChange={(e) => setSenderForm((f) => ({ ...f, name: e.target.value }))} />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="s-host">SMTP 服务器 <span className="text-destructive">*</span></Label>
                <Input id="s-host" placeholder="smtp.example.com" value={senderForm.host} onChange={(e) => setSenderForm((f) => ({ ...f, host: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="s-port">端口</Label>
                <Input id="s-port" type="number" placeholder="465" value={senderForm.port} onChange={(e) => setSenderForm((f) => ({ ...f, port: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="s-user">登录邮箱 <span className="text-destructive">*</span></Label>
              <Input id="s-user" placeholder="user@example.com" value={senderForm.user} onChange={(e) => setSenderForm((f) => ({ ...f, user: e.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="s-pass">
                密码 / 授权码{" "}
                {editingSenderId && <span className="text-xs text-muted-foreground">（留空则不更新）</span>}
                {!editingSenderId && <span className="text-destructive">*</span>}
              </Label>
              <Input id="s-pass" type="password" placeholder="••••••••" value={senderForm.pass} onChange={(e) => setSenderForm((f) => ({ ...f, pass: e.target.value }))} />
              {/* Per-provider auth code hint */}
              {(() => {
                const preset = SMTP_PRESETS.find((p) => p.host === senderForm.host && p.host !== "")
                return preset?.authNote ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    <span className="font-semibold">如何获取密码？</span>&nbsp;{preset.authNote}
                  </p>
                ) : null
              })()}
            </div>

            <div className="flex items-center gap-3">
              <Switch id="s-secure" checked={senderForm.secure} onCheckedChange={(v) => setSenderForm((f) => ({ ...f, secure: v }))} />
              <Label htmlFor="s-secure">使用 SSL/TLS（推荐，端口 465）</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSenderDialogOpen(false)}>取消</Button>
            <Button onClick={handleSaveSender} disabled={savingSender}>{savingSender ? "保存中…" : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ Delete confirms ══════════════════════════════════════════════════════ */}
      <AlertDialog open={!!setupDeleteTarget} onOpenChange={(open) => { if (!open) setSetupDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>将永久删除配置「{setupDeleteTarget?.name}」，此操作无法撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => setupDeleteTarget && handleDeleteSetup(setupDeleteTarget)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!senderDeleteTarget} onOpenChange={(open) => { if (!open) setSenderDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              将永久删除发件账号「{senderDeleteTarget?.name}」。已使用此账号的发送配置将回退到环境变量，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => senderDeleteTarget && handleDeleteSender(senderDeleteTarget)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
