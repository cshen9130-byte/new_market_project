"use client"

import { useCallback, useEffect, useState } from "react"
import { Download, FileText, Loader2 } from "lucide-react"
import { DateInput } from "@/components/ui/date-input"
import {
  DEFAULT_WEEKLY_REVIEW_POOLS,
  toggleWeeklyReviewPool,
  weeklyReviewPoolFileLabel,
  weeklyReviewPoolScopePhrase,
  type WeeklyReviewPoolKey,
} from "@/lib/ma/weekly-review-pools"
import { WeeklyReviewDataStatus } from "./WeeklyReviewDataStatus"

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

type WeeklyReviewVariant = "equity" | "futures"

const POOL_CHOICES: Array<{ key: "all" | WeeklyReviewPoolKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "jy", label: "JY跟踪池" },
  { key: "selected", label: "JY精选池" },
]

const VARIANT_COPY: Record<WeeklyReviewVariant, {
  title: (label: string) => string
  description: (scope: string) => string
  excelName: (weekEnd: string, label: string) => string
  previewUrl: (date: string, pools: WeeklyReviewPoolKey[]) => string
  generateUrl: string
  statusUrl: (jobId: string) => string
}> = {
  equity: {
    title: (label) => `${label} · 周度回顾(股票)`,
    description: (scope) => `按${scope}中的股票策略产品生成周报 Excel：股票市场回顾 + 按团队策略分组的收益 / 超额收益表。同一产品的 A/B/C 份额在同一策略里合并为一行。「周度归因分析」会在同一批赢家上拆分市场贝塔与基金阿尔法，并结合投资笔记 / 路演 / 知识库生成 Word 买入建议。`,
    excelName: (weekEnd, label) => `${label}周度回顾（股票） - ${weekEnd}.xlsx`,
    previewUrl: (date, pools) => `/ma/api/tracking-funds/weekly-review/preview?week_end=${encodeURIComponent(date)}&pools=${encodeURIComponent(pools.join(","))}`,
    generateUrl: "/ma/api/tracking-funds/weekly-review/generate",
    statusUrl: (jobId) => `/ma/api/tracking-funds/weekly-review/generate?id=${encodeURIComponent(jobId)}`,
  },
  futures: {
    title: (label) => `${label} · 周度回顾(期货)`,
    description: (scope) => `按${scope}中的期货策略生成周报 Excel。量化期货 8 张：时序（时序占比超过50%）、截面（截面占比超过50%）、混合、中高频（按交易频率）、大厂（按规模）、股指（按品种）、基本面（按因子类型）、机器学习（按方法论）；量价、商品不进入。主观期货 6 张：黑色、有色、能化、农产、多板块（包含 MOM）、MOM。MOM 同时计入多板块。同一产品的 A/B/C 份额在同一张表里合并为一行。`,
    excelName: (weekEnd, label) => `${label}周度回顾（期货） - ${weekEnd}.xlsx`,
    previewUrl: (date, pools) => `/ma/api/tracking-funds/weekly-review/futures/preview?week_end=${encodeURIComponent(date)}&pools=${encodeURIComponent(pools.join(","))}`,
    generateUrl: "/ma/api/tracking-funds/weekly-review/futures/generate",
    statusUrl: (jobId) => `/ma/api/tracking-funds/weekly-review/futures/generate?id=${encodeURIComponent(jobId)}`,
  },
}

export function WeeklyReviewView({ variant = "equity" }: { variant?: WeeklyReviewVariant }) {
  const copy = VARIANT_COPY[variant]
  const [weekEnd, setWeekEnd] = useState(defaultWeekEnd)
  const [pools, setPools] = useState<WeeklyReviewPoolKey[]>([...DEFAULT_WEEKLY_REVIEW_POOLS])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewError, setPreviewError] = useState("")
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState("")
  const [attributing, setAttributing] = useState(false)
  const [attributeError, setAttributeError] = useState("")
  const [attributePhase, setAttributePhase] = useState("")

  const loadPreview = useCallback(async (date: string, poolKeys: WeeklyReviewPoolKey[]) => {
    setPreviewLoading(true)
    setPreviewError("")
    try {
      const res = await fetch(copy.previewUrl(date, poolKeys), {
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
  }, [copy])

  useEffect(() => {
    void loadPreview(weekEnd, pools)
  }, [weekEnd, pools, loadPreview])

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
      body: JSON.stringify({ week_end: weekEnd, pools }),
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
        startUrl: copy.generateUrl,
        statusUrl: copy.statusUrl,
        fallbackName: copy.excelName(weekEnd, weeklyReviewPoolFileLabel(pools)),
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
        fallbackName: `${weeklyReviewPoolFileLabel(pools)}周度归因分析 - ${weekEnd}.docx`,
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
  const poolLabel = weeklyReviewPoolFileLabel(pools)
  const poolScope = weeklyReviewPoolScopePhrase(pools)
  const allOn = pools.includes("jy") && pools.includes("selected")

  function pickPool(key: "all" | WeeklyReviewPoolKey) {
    setPools((prev) => {
      const next = toggleWeeklyReviewPool(prev, key)
      return next.join(",") === prev.join(",") ? prev : next
    })
  }

  return (
    <div className="flex flex-col min-w-0 gap-4">
      <div className="rounded-xl border bg-background shadow-sm p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{copy.title(poolLabel)}</h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed max-w-2xl">
              {copy.description(poolScope)}
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
            {variant === "equity" && (
            <button
              type="button"
              onClick={() => void handleAttribution()}
              disabled={generating || attributing || previewLoading || (preview?.fund_count ?? 0) === 0}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-background px-4 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed dark:border-red-900/60 dark:hover:bg-red-950/40"
            >
              {attributing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {attributing ? "正在分析…" : "周度归因分析"}
            </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">产品池</span>
            <div className="inline-flex flex-wrap items-center gap-1" role="group" aria-label="产品池">
              {POOL_CHOICES.map((choice) => {
                const active = choice.key === "all" ? allOn : pools.includes(choice.key)
                return (
                  <button
                    key={choice.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => pickPool(choice.key)}
                    className={`inline-flex h-9 items-center rounded-md border px-3 text-sm ${
                      active
                        ? "border-red-500 bg-red-50 font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400"
                        : "border-zinc-200 bg-background text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    }`}
                  >
                    {choice.label}
                  </button>
                )
              })}
            </div>
          </div>
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
            。近一周只计入该区间内有净值的产品，没有则留空。
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

      <WeeklyReviewDataStatus
        embedded
        variant={variant}
        pools={pools}
        weekEnd={weekEnd}
      />
    </div>
  )
}
