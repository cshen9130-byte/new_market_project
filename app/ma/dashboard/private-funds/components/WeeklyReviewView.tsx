"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, FileText, Loader2 } from "lucide-react"
import { DateInput } from "@/components/ui/date-input"

type GroupPreview = {
  bucket: string
  mode: "excess" | "absolute"
  count: number
}

type Preview = {
  week_start: string
  week_end: string
  as_of: string
  fund_count: number
  groups: GroupPreview[]
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function defaultWeekEnd(today = shanghaiToday()): string {
  const d = new Date(`${today}T12:00:00`)
  const day = d.getDay()
  const back = day >= 5 ? day - 5 : day + 2
  d.setDate(d.getDate() - back)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

function slashDate(iso: string): string {
  if (!iso) return "—"
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${y}/${Number(m)}/${Number(d)}`
}

export function WeeklyReviewView() {
  const [weekEnd, setWeekEnd] = useState(defaultWeekEnd)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewError, setPreviewError] = useState("")
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState("")
  const [attributing, setAttributing] = useState(false)
  const [attributeError, setAttributeError] = useState("")
  const [attributePhase, setAttributePhase] = useState("")

  const loadPreview = useCallback(async (date: string) => {
    setPreviewLoading(true)
    setPreviewError("")
    try {
      const res = await fetch(`/ma/api/tracking-funds/weekly-review/preview?week_end=${encodeURIComponent(date)}`, {
        cache: "no-store",
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "预览加载失败")
      setPreview(json as Preview)
    } catch (err) {
      setPreview(null)
      setPreviewError(err instanceof Error ? err.message : "预览加载失败")
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPreview(weekEnd)
  }, [weekEnd, loadPreview])

  async function pollJobAndDownload(opts: {
    startUrl: string
    statusUrl: (jobId: string) => string
    fallbackName: string
    timeoutMs: number
    onPhase?: (phase: string) => void
  }) {
    const start = await fetch(opts.startUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week_end: weekEnd }),
    })
    const startJson = await start.json().catch(() => ({}))
    if (!start.ok) throw new Error(typeof startJson.error === "string" ? startJson.error : "生成失败")
    const jobId = typeof startJson.jobId === "string" ? startJson.jobId : ""
    if (!jobId) throw new Error("未返回任务 ID")

    const deadline = Date.now() + opts.timeoutMs
    let downloadUrl = ""
    let fileName = ""
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      const st = await fetch(opts.statusUrl(jobId), { cache: "no-store" })
      const json = await st.json().catch(() => ({}))
      if (!st.ok) throw new Error(typeof json.error === "string" ? json.error : "查询生成状态失败")
      if (typeof json.phase === "string" && json.phase) opts.onPhase?.(json.phase)
      if (json.status === "error") throw new Error(typeof json.error === "string" ? json.error : "生成失败")
      if (json.status === "done" && typeof json.downloadUrl === "string") {
        downloadUrl = json.downloadUrl
        fileName = typeof json.fileName === "string" ? json.fileName : ""
        break
      }
    }
    if (!downloadUrl) throw new Error("生成超时，请稍后重试")

    const fileRes = await fetch(downloadUrl, { cache: "no-store" })
    if (!fileRes.ok) throw new Error("下载生成文件失败")
    const blob = await fileRes.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fileName || opts.fallbackName
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleGenerate() {
    setGenerating(true)
    setGenerateError("")
    try {
      await pollJobAndDownload({
        startUrl: "/ma/api/tracking-funds/weekly-review/generate",
        statusUrl: (jobId) => `/ma/api/tracking-funds/weekly-review/generate?id=${encodeURIComponent(jobId)}`,
        fallbackName: `JY跟踪池周度回顾（股票） - ${weekEnd}.xlsx`,
        timeoutMs: 5 * 60 * 1000,
      })
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "生成失败")
    } finally {
      setGenerating(false)
    }
  }

  async function handleAttribution() {
    setAttributing(true)
    setAttributeError("")
    setAttributePhase("正在启动…")
    try {
      await pollJobAndDownload({
        startUrl: "/ma/api/tracking-funds/weekly-review/attribution/generate",
        statusUrl: (jobId) => `/ma/api/tracking-funds/weekly-review/attribution/generate?id=${encodeURIComponent(jobId)}`,
        fallbackName: `JY跟踪池周度归因分析 - ${weekEnd}.docx`,
        timeoutMs: 10 * 60 * 1000,
        onPhase: setAttributePhase,
      })
    } catch (err) {
      setAttributeError(err instanceof Error ? err.message : "生成失败")
    } finally {
      setAttributing(false)
      setAttributePhase("")
    }
  }

  const rangeLabel = preview
    ? `${slashDate(preview.week_start)} ~ ${slashDate(preview.week_end)}`
    : "—"

  return (
    <div className="flex flex-col min-w-0 gap-4">
      <div className="rounded-xl border bg-background shadow-sm p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">JY跟踪池 · 周度回顾</h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed max-w-2xl">
              按 JY 跟踪池中的股票策略产品生成周报 Excel：股票市场回顾 + 按团队策略分组的收益 / 超额收益表，格式对齐博孚利周度回顾。
              「周度归因分析」会在同一批赢家上拆分市场贝塔与基金阿尔法，并结合投资笔记 / 路演 / 知识库生成 Word 买入建议。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || attributing || previewLoading || (preview?.fund_count ?? 0) === 0}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-red-500 px-4 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {generating ? "正在生成…" : "生成本周 Excel"}
            </button>
            <button
              type="button"
              onClick={() => void handleAttribution()}
              disabled={generating || attributing || previewLoading || (preview?.fund_count ?? 0) === 0}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-background px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-red-900/60 dark:hover:bg-red-950/40"
            >
              {attributing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {attributing ? "正在分析…" : "周度归因分析"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">报告周截止日</span>
            <DateInput
              value={weekEnd}
              onChange={setWeekEnd}
              placeholder="请选择日期"
              className="w-[11.5rem]"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            统计区间：<span className="text-foreground font-medium">{rangeLabel}</span>
            {preview ? ` · ${preview.fund_count} 只产品 · ${preview.groups.length} 个策略分组` : null}
          </div>
        </div>

        {attributing && attributePhase && (
          <p className="mt-3 text-sm text-muted-foreground">{attributePhase}</p>
        )}
        {generateError && (
          <p className="mt-3 text-sm text-red-600">{generateError}</p>
        )}
        {attributeError && (
          <p className="mt-3 text-sm text-red-600">{attributeError}</p>
        )}
        {previewError && (
          <p className="mt-3 text-sm text-red-600">{previewError}</p>
        )}
      </div>

      <div className="rounded-xl border bg-background shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b text-sm font-medium">策略分组预览</div>
        {previewLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在统计 JY 跟踪池产品…
          </div>
        ) : !preview || preview.groups.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            JY跟踪池中暂无股票策略产品
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50/80 text-xs text-zinc-500 dark:bg-zinc-900/40">
                <th className="px-5 py-2 text-left font-medium">策略分组</th>
                <th className="px-5 py-2 text-left font-medium">指标口径</th>
                <th className="px-5 py-2 text-right font-medium">产品数</th>
              </tr>
            </thead>
            <tbody>
              {preview.groups.map((g) => (
                <tr key={g.bucket} className="border-b last:border-0">
                  <td className="px-5 py-2">{g.bucket}</td>
                  <td className="px-5 py-2 text-muted-foreground">
                    {g.mode === "excess" ? "超额收益 / 超额最大回撤" : "收益 / 夏普 / 卡玛"}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums">{g.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
