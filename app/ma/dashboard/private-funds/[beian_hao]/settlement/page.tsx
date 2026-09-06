"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Download, Globe, Link2, RefreshCw, Trash2, UploadCloud } from "lucide-react"

import { FundDatabaseShell } from "@/components/ma/fund-database-shell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { resolveFundDisplayLabel } from "@/lib/fund-display-name"
import type { SettlementWorkbookAnalysis } from "@/lib/server/settlement-account-etl"

import { SettlementAnalysisResult } from "./SettlementAnalysisResult"

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".xlsb"]
const TAB_DEFAULT_SIDE: Record<string, string> = {
  funds: "private-funds",
  investment: "inv-tracking",
}

type SettlementFile = {
  name: string
  size: number
  mtime: string
  source: "upload" | "cfmmc"
}

type SettlementLink = {
  userId: string
  password: string
  enabled: boolean
  scheduleTime: string
  lastFetchDate: string | null
  lastFetchAt: string | null
  lastError: string | null
  lastFile: string | null
  linked: boolean
}

type SettlementPayload = {
  beianHao?: string
  productName?: string
  files?: SettlementFile[]
  link?: SettlementLink
  analysis?: SettlementWorkbookAnalysis | null
  error?: string
}

function isAcceptedFile(file: File) {
  const dotIndex = file.name.lastIndexOf(".")
  const extension = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : ""
  return ACCEPTED_EXTENSIONS.includes(extension) || /交易结算单|结算单|结算日报/i.test(file.name)
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }
  return fallback
}

export default function ProductSettlementAnalysisPage() {
  const params = useParams()
  const router = useRouter()
  const { toast } = useToast()
  const beian_hao = typeof params.beian_hao === "string" ? params.beian_hao : ""
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [productName, setProductName] = useState(beian_hao)
  const [files, setFiles] = useState<SettlementFile[]>([])
  const [link, setLink] = useState<SettlementLink | null>(null)
  const [analysis, setAnalysis] = useState<SettlementWorkbookAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSavingLink, setIsSavingLink] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [userId, setUserId] = useState("")
  const [password, setPassword] = useState("")
  const [scheduleTime, setScheduleTime] = useState("17:00")
  const [autoEnabled, setAutoEnabled] = useState(false)

  const applyPayload = useCallback((payload: SettlementPayload) => {
    if (payload.productName) setProductName(payload.productName)
    if (payload.files) setFiles(payload.files)
    if (payload.link) {
      setLink(payload.link)
      setUserId(payload.link.userId)
      setPassword(payload.link.password)
      setScheduleTime(payload.link.scheduleTime || "17:00")
      setAutoEnabled(payload.link.enabled)
    }
    if ("analysis" in payload) setAnalysis(payload.analysis ?? null)
  }, [])

  const loadState = useCallback(async () => {
    if (!beian_hao) return
    setLoading(true)
    try {
      const res = await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/settlement`, { cache: "no-store" })
      const payload = (await res.json()) as SettlementPayload
      if (!res.ok) throw new Error(readErrorMessage(payload, "加载失败"))
      applyPayload(payload)
    } catch (error) {
      toast({
        title: "加载失败",
        description: error instanceof Error ? error.message : "无法加载结算单分析。",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [applyPayload, beian_hao, toast])

  useEffect(() => {
    void loadState()
  }, [loadState])

  const uploadFile = useCallback(async (file: File) => {
    if (!isAcceptedFile(file)) {
      toast({
        title: "文件格式不支持",
        description: `仅支持 ${ACCEPTED_EXTENSIONS.join(" / ")} 结算单文件。`,
        variant: "destructive",
      })
      return
    }
    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/settlement`, {
        method: "POST",
        body: formData,
      })
      const payload = (await res.json()) as SettlementPayload
      if (!res.ok) throw new Error(readErrorMessage(payload, "结算单分析失败。"))
      applyPayload(payload)
      toast({ title: "分析完成", description: `已解析「${file.name}」。` })
    } catch (error) {
      toast({
        title: "分析失败",
        description: error instanceof Error ? error.message : "结算单分析失败。",
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
    }
  }, [applyPayload, beian_hao, toast])

  async function handleAnalyzeFile(name: string) {
    try {
      const res = await fetch(
        `/ma/api/private-funds/${encodeURIComponent(beian_hao)}/settlement?file=${encodeURIComponent(name)}`,
        { cache: "no-store" },
      )
      const payload = (await res.json()) as SettlementPayload
      if (!res.ok) throw new Error(readErrorMessage(payload, "分析失败"))
      applyPayload(payload)
    } catch (error) {
      toast({
        title: "分析失败",
        description: error instanceof Error ? error.message : "无法分析该结算单。",
        variant: "destructive",
      })
    }
  }

  async function handleSaveLink(next?: { enabled?: boolean }) {
    setIsSavingLink(true)
    try {
      const res = await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/settlement/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          password,
          scheduleTime,
          enabled: next?.enabled ?? autoEnabled,
        }),
      })
      const payload = (await res.json()) as { link?: SettlementLink; error?: string }
      if (!res.ok) throw new Error(payload.error || "保存失败")
      if (payload.link) {
        setLink(payload.link)
        setUserId(payload.link.userId)
        setPassword(payload.link.password)
        setScheduleTime(payload.link.scheduleTime)
        setAutoEnabled(payload.link.enabled)
      }
      toast({ title: "已关联监控中心", description: "可用「立即获取」拉取该产品结算日报。" })
    } catch (error) {
      toast({
        title: "关联失败",
        description: error instanceof Error ? error.message : "保存监控中心账户失败。",
        variant: "destructive",
      })
    } finally {
      setIsSavingLink(false)
    }
  }

  async function handleUnlink() {
    setIsSavingLink(true)
    try {
      const res = await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/settlement/link`, {
        method: "DELETE",
      })
      const payload = (await res.json()) as { link?: SettlementLink; error?: string }
      if (!res.ok) throw new Error(payload.error || "取消关联失败")
      setLink(payload.link ?? null)
      setUserId("")
      setPassword("")
      setAutoEnabled(false)
      toast({ title: "已取消关联" })
    } catch (error) {
      toast({
        title: "取消关联失败",
        description: error instanceof Error ? error.message : "无法取消关联。",
        variant: "destructive",
      })
    } finally {
      setIsSavingLink(false)
    }
  }

  async function handleFetch(mode: "history" | "incremental") {
    setIsFetching(true)
    try {
      const res = await fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/settlement/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      })
      const payload = (await res.json()) as SettlementPayload & {
        downloaded?: number
        skipped?: number
      }
      if (!res.ok) throw new Error(readErrorMessage(payload, "监控中心获取失败。"))
      applyPayload(payload)
      toast({
        title: "获取完成",
        description: `新下载 ${payload.downloaded ?? 0} 个文件，已有 ${payload.skipped ?? 0} 个跳过。`,
      })
    } catch (error) {
      toast({
        title: "获取失败",
        description: error instanceof Error ? error.message : "监控中心获取失败。",
        variant: "destructive",
      })
    } finally {
      setIsFetching(false)
    }
  }

  const displayName = resolveFundDisplayLabel(null, productName || beian_hao)
  const navigateFunds = useCallback((tab: string, side?: string) => {
    const sideItem = side ?? TAB_DEFAULT_SIDE[tab] ?? "private-funds"
    router.push(`/ma/dashboard/private-funds?tab=${tab}&side=${sideItem}`)
  }, [router])

  return (
    <FundDatabaseShell onNavigate={navigateFunds}>
      <div className="min-h-0 space-y-4">
        <Link
          href={`/ma/dashboard/private-funds/${encodeURIComponent(beian_hao)}`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回基金详情
        </Link>

        <div className="bg-white rounded-lg border border-zinc-100 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-900">{displayName}</h1>
            <span className="px-2 py-0.5 rounded text-xs border border-teal-500 text-teal-600 font-medium bg-teal-50/50">
              结算单分析
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            拖入该产品结算单（国信盯市或监控中心/期货公司日报），或关联
            <a
              href="https://investorservice.cfmmc.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="mx-1 font-medium text-foreground underline underline-offset-2"
            >
              中国期货市场监控中心投资者查询服务系统
            </a>
            自动获取后分析持仓敞口与策略结构。
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UploadCloud className="h-4 w-4" />
                拖入结算单
              </CardTitle>
              <CardDescription>支持 xls / xlsx。文件按产品保存，可随时重新分析。</CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
                  isDragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/60 hover:bg-muted/30"
                } ${isUploading ? "pointer-events-none opacity-60" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setIsDragOver(true)
                }}
                onDragEnter={(event) => {
                  event.preventDefault()
                  setIsDragOver(true)
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault()
                  setIsDragOver(false)
                  const file = event.dataTransfer.files?.[0]
                  if (file) void uploadFile(file)
                }}
                onClick={() => !isUploading && fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsm,.xlsb"
                  className="sr-only"
                  disabled={isUploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void uploadFile(file)
                    event.target.value = ""
                  }}
                />
                <UploadCloud className={`h-10 w-10 ${isDragOver ? "text-primary" : "text-muted-foreground"}`} />
                <div>
                  <p className="text-sm font-medium">
                    {isUploading ? "正在分析…" : isDragOver ? "松开鼠标以上传" : "拖拽结算单到此处，或点击选择文件"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    示例：交易结算单(盯市)_20260525.xlsx 或 0218…_2026-08-20.xls
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-violet-500" />
                关联监控中心自动获取
              </CardTitle>
              <CardDescription>
                登录投资者查询服务系统，下载该账户「客户交易结算日报」后自动分析。与单账户每日风控数据隔离。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="监控中心用户名"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                />
                <Input
                  className="h-8 text-xs"
                  type="password"
                  placeholder="密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 w-32 text-xs font-mono"
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant={autoEnabled ? "default" : "outline"}
                  disabled={isSavingLink}
                  onClick={() => {
                    void handleSaveLink({ enabled: !autoEnabled })
                  }}
                >
                  {autoEnabled ? "每日自动获取已开启" : "开启每日自动获取"}
                </Button>
                <Button size="sm" disabled={isSavingLink} onClick={() => void handleSaveLink()}>
                  {isSavingLink ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  保存关联
                </Button>
                {link?.linked ? (
                  <Button size="sm" variant="ghost" disabled={isSavingLink} onClick={() => void handleUnlink()}>
                    <Trash2 className="h-3.5 w-3.5" />
                    取消关联
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isFetching || !link?.linked}
                  onClick={() => void handleFetch("history")}
                >
                  {isFetching
                    ? <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />
                    : <Download className="mr-2 h-3.5 w-3.5" />}
                  {isFetching ? "获取中…" : "立即获取并分析"}
                </Button>
                {link?.lastFetchAt ? (
                  <span className="text-xs text-muted-foreground">
                    上次：{new Date(link.lastFetchAt).toLocaleString("zh-CN")}
                  </span>
                ) : null}
              </div>
              {link?.lastError ? (
                <Alert variant="destructive">
                  <AlertTitle>最近一次获取失败</AlertTitle>
                  <AlertDescription>{link.lastError}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {files.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>已入库结算单</CardTitle>
              <CardDescription>点击文件可重新分析该日结算单。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {files.map((file) => (
                <button
                  key={file.name}
                  type="button"
                  onClick={() => void handleAnalyzeFile(file.name)}
                  className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                    analysis?.sourceFileName === file.name
                      ? "border-teal-500 bg-teal-50 text-teal-700"
                      : "hover:bg-muted"
                  }`}
                >
                  {file.source === "cfmmc" ? "监控中心 · " : "上传 · "}
                  {file.name}
                </button>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {loading ? (
          <div className="rounded-lg border bg-white py-16 text-center text-sm text-muted-foreground">
            正在加载结算单分析…
          </div>
        ) : analysis ? (
          <SettlementAnalysisResult analysis={analysis} />
        ) : (
          <div className="rounded-lg border bg-white py-16 text-center text-sm text-muted-foreground">
            还没有可分析的结算单。请先拖入文件，或关联监控中心后点击「立即获取并分析」。
          </div>
        )}
      </div>
    </FundDatabaseShell>
  )
}
