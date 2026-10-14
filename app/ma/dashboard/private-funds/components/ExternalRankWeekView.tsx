"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Download, ExternalLink, Loader2 } from "lucide-react"
import { DateInput } from "@/components/ui/date-input"
import { EXTERNAL_RANK_FOLDER, type ExternalRankWeekFile, type ExternalRankWeekPreview, type ExternalRankWeekRow } from "@/lib/ma/external-rank-week"

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

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  d.setDate(d.getDate() + days)
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

function formatSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "—"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(iso: string): string {
  if (!iso) return "—"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function pctText(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${(value * 100).toFixed(2)}%`
}

function ReturnCell({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-zinc-400">—</span>
  const cls = value > 0 ? "text-red-500" : value < 0 ? "text-emerald-600" : ""
  return <span className={`tabular-nums ${cls}`}>{pctText(value)}</span>
}

function downloadOriginal(path: string, name: string) {
  const params = new URLSearchParams({ path, download: "1" })
  const a = document.createElement("a")
  a.href = `/api/knowledge-base/file?${params.toString()}`
  a.download = name
  a.click()
}

type SortKey = "rank" | "ytd" | "ret_1w" | "ytd_drawdown"

function compareRows(a: ExternalRankWeekRow, b: ExternalRankWeekRow, key: SortKey, dir: "asc" | "desc"): number {
  const sign = dir === "asc" ? 1 : -1
  if (key === "rank") return (a.rank - b.rank) * sign
  const av = a[key]
  const bv = b[key]
  if (av == null && bv == null) return a.rank - b.rank
  if (av == null) return 1
  if (bv == null) return -1
  return (av - bv) * sign || a.rank - b.rank
}

export function ExternalRankWeekView() {
  const [weekEnd, setWeekEnd] = useState(defaultWeekEnd)
  const [preview, setPreview] = useState<ExternalRankWeekPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [previewError, setPreviewError] = useState("")
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState("")
  const [selectedPath, setSelectedPath] = useState("")
  const [strategy, setStrategy] = useState("全部")
  const [keyword, setKeyword] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("rank")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const autoJumped = useRef(false)

  const loadPreview = useCallback(async (date: string, cancelled: () => boolean) => {
    setPreviewLoading(true)
    setPreviewError("")
    try {
      const res = await fetch(`/ma/api/tracking-funds/external-rank/preview?week_end=${encodeURIComponent(date)}`, {
        cache: "no-store",
      })
      const json = await res.json().catch(() => ({}))
      if (cancelled()) return
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "预览加载失败")
      const next = json as ExternalRankWeekPreview
      setPreview(next)
      setSelectedPath((current) => {
        if (current && next.files.some((file) => file.path === current)) return current
        return next.files.find((file) => file.parsed)?.path || next.files[0]?.path || ""
      })
    } catch (err) {
      if (cancelled()) return
      setPreview(null)
      setPreviewError(err instanceof Error ? err.message : "预览加载失败")
    } finally {
      if (!cancelled()) setPreviewLoading(false)
    }
  }, [])

  useEffect(() => {
    let stale = false
    void loadPreview(weekEnd, () => stale)
    return () => {
      stale = true
    }
  }, [weekEnd, loadPreview])

  useEffect(() => {
    if (!preview || autoJumped.current) return
    const latest = preview.weeks[0]
    if (preview.files.length === 0 && latest && latest.week_end !== weekEnd) {
      autoJumped.current = true
      setWeekEnd(latest.week_end)
    }
  }, [preview, weekEnd])

  useEffect(() => {
    setStrategy("全部")
    setKeyword("")
    setSortKey("rank")
    setSortDir("asc")
  }, [selectedPath])

  const selected = preview?.files.find((file) => file.path === selectedPath) ?? null
  const strategies = useMemo(() => {
    const keys = new Set<string>()
    for (const row of selected?.rows ?? []) keys.add(row.class_key || row.strategy || "未分类")
    return ["全部", ...keys]
  }, [selected])

  const visibleRows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    const rows = (selected?.rows ?? []).filter((row) => {
      if (strategy !== "全部" && (row.class_key || row.strategy || "未分类") !== strategy) return false
      if (!q) return true
      return `${row.manager} ${row.product || ""} ${row.strategy}`.toLowerCase().includes(q)
    })
    return [...rows].sort((a, b) => compareRows(a, b, sortKey, sortDir))
  }, [selected, strategy, keyword, sortKey, sortDir])

  const parsedCount = preview?.files.filter((file) => file.parsed).length ?? 0
  const rangeLabel = preview ? `${slashDate(preview.week_start)} ~ ${slashDate(preview.week_end)}` : "—"
  const folderHref = `/ma/dashboard/ai-knowledge?folder=${encodeURIComponent(EXTERNAL_RANK_FOLDER)}`

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    setSortDir(key === "rank" ? "asc" : "desc")
  }

  async function handleGenerate() {
    setGenerating(true)
    setGenerateError("")
    try {
      const res = await fetch(`/ma/api/tracking-funds/external-rank/generate?week_end=${encodeURIComponent(weekEnd)}`, {
        cache: "no-store",
      })
      const type = res.headers.get("content-type") || ""
      if (!res.ok || type.includes("application/json")) {
        const json = await res.json().catch(() => ({}))
        throw new Error(typeof json.error === "string" ? json.error : "生成失败")
      }
      const blob = await res.blob()
      const match = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get("content-disposition") || "")
      const fileName = match ? decodeURIComponent(match[1]) : `外部私募业绩排行 - ${weekEnd}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "生成失败")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col min-w-0 gap-4">
      <div className="rounded-xl border bg-background shadow-sm p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">外部私募业绩排行</h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed max-w-3xl">
              从知识库「{EXTERNAL_RANK_FOLDER}」里找出与所选周对应的榜单：文件名里的日期或区间，或表格中的净值截止日期，落在该周周一到截止日。可以预览排名、下载原文件，或把本周已识别的榜单合并成一份 Excel。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={folderHref}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-sm text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <ExternalLink className="h-4 w-4" />
              资料目录
            </a>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || previewLoading || parsedCount === 0}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-red-500 px-4 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {generating ? "正在生成…" : "生成本周 Excel"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">报告周截止日</span>
            <button
              type="button"
              aria-label="上一周"
              onClick={() => setWeekEnd((current) => shiftDays(current, -7))}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-background text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <DateInput
              value={weekEnd}
              onChange={setWeekEnd}
              placeholder="请选择日期"
              className="w-[11.5rem]"
            />
            <button
              type="button"
              aria-label="下一周"
              onClick={() => setWeekEnd((current) => shiftDays(current, 7))}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-background text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {preview && preview.weeks.length > 0 && (
            <label className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 shrink-0">已有周次</span>
              <select
                value={preview.weeks.some((week) => week.week_end === preview.week_end) ? preview.week_end : ""}
                onChange={(event) => {
                  if (event.target.value) setWeekEnd(event.target.value)
                }}
                className="h-9 min-w-[16rem] rounded-md border border-zinc-200 bg-background px-2 text-sm dark:border-zinc-700"
              >
                {!preview.weeks.some((week) => week.week_end === preview.week_end) && (
                  <option value="">{rangeLabel}（本周暂无文件）</option>
                )}
                {preview.weeks.map((week) => (
                  <option key={week.week_end} value={week.week_end}>
                    {slashDate(week.week_start)} ~ {slashDate(week.week_end)}（{week.file_count} 个文件）
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="text-xs text-muted-foreground">
            统计区间：<span className="text-foreground font-medium">{rangeLabel}</span>
            {preview ? ` · 扫描 ${preview.scanned} 个表格 · 本周 ${preview.files.length} 个文件` : null}
            {preview && parsedCount !== preview.files.length ? ` · ${parsedCount} 个可汇总` : null}
          </div>
        </div>

        {generateError && <p className="mt-3 text-sm text-red-600">{generateError}</p>}
        {previewError && <p className="mt-3 text-sm text-red-600">{previewError}</p>}
      </div>

      <div className="rounded-xl border bg-background shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b text-sm font-medium">策略分布</div>
        {previewLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取{EXTERNAL_RANK_FOLDER}…
          </div>
        ) : !preview || preview.groups.length === 0 ? (
          <div className="py-12 px-5 text-center text-sm text-muted-foreground">
            {preview && preview.files.length > 0
              ? "本周文件没能识别成业绩榜，下面仍可下载原文件。"
              : "这一周没有匹配到榜单。可以改截止日，或从「已有周次」里选一周。"}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50/80 text-xs text-zinc-500 dark:bg-zinc-900/40">
                <th className="px-5 py-2 text-left font-medium">策略</th>
                <th className="px-5 py-2 text-right font-medium">文件数</th>
                <th className="px-5 py-2 text-right font-medium">条目数</th>
              </tr>
            </thead>
            <tbody>
              {preview.groups.map((group) => (
                <tr key={group.strategy} className="border-b last:border-0">
                  <td className="px-5 py-2">{group.strategy}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{group.file_count}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{group.row_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border bg-background shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b text-sm font-medium">本周文件</div>
        {previewLoading ? (
          <div className="py-10" />
        ) : !preview || preview.files.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">没有文件</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50/80 text-xs text-zinc-500 dark:bg-zinc-900/40">
                  <th className="px-5 py-2 text-left font-medium">名称</th>
                  <th className="px-5 py-2 text-left font-medium">截止日期</th>
                  <th className="px-5 py-2 text-left font-medium">策略</th>
                  <th className="px-5 py-2 text-right font-medium">行数</th>
                  <th className="px-5 py-2 text-left font-medium">修改</th>
                  <th className="px-5 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {preview.files.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    active={file.path === selectedPath}
                    onOpen={() => setSelectedPath(file.path)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-background shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b flex flex-wrap items-center gap-3">
          <div className="text-sm font-medium min-w-0 truncate">
            {selected ? selected.name : "榜单预览"}
          </div>
          {selected?.parsed && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <div className="inline-flex flex-wrap items-center gap-1">
                {strategies.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setStrategy(item)}
                    className={`inline-flex h-7 items-center rounded-md border px-2.5 text-xs ${
                      strategy === item
                        ? "border-red-500 bg-red-50 font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400"
                        : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索管理人 / 产品"
                className="h-7 w-44 rounded-md border border-zinc-200 bg-background px-2 text-xs dark:border-zinc-700"
              />
            </div>
          )}
        </div>
        {!selected ? (
          <div className="py-16 text-center text-sm text-muted-foreground">选择一个文件后在这里看排名</div>
        ) : !selected.parsed ? (
          <div className="px-5 py-12 text-sm text-muted-foreground">
            <p>这份文件没有识别成业绩榜。</p>
            {selected.error && <p className="mt-2 text-xs">{selected.error}</p>}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50/95 dark:bg-zinc-900/95">
                <tr className="border-b text-xs text-zinc-500">
                  <SortHeader label="序号" active={sortKey === "rank"} dir={sortDir} onClick={() => toggleSort("rank")} align="left" />
                  <th className="px-4 py-2 text-left font-medium">策略</th>
                  <th className="px-4 py-2 text-left font-medium">管理人</th>
                  <th className="px-4 py-2 text-left font-medium">产品</th>
                  <th className="px-4 py-2 text-left font-medium">规模</th>
                  <th className="px-4 py-2 text-left font-medium">净值日期</th>
                  <SortHeader label={selected.window_label || "收益"} active={sortKey === "ytd"} dir={sortDir} onClick={() => toggleSort("ytd")} />
                  <SortHeader label="最大回撤" active={sortKey === "ytd_drawdown"} dir={sortDir} onClick={() => toggleSort("ytd_drawdown")} />
                  <SortHeader label="近一周" active={sortKey === "ret_1w"} dir={sortDir} onClick={() => toggleSort("ret_1w")} />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={`${row.sheet}-${row.rank}-${row.manager}-${index}`} className="border-b last:border-0">
                    <td className="px-4 py-2 tabular-nums text-zinc-500">{row.rank}</td>
                    <td className="px-4 py-2">{row.strategy || row.class_key}</td>
                    <td className="px-4 py-2">{row.manager || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{row.product || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{row.aum || "—"}</td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">{row.nav_date || "—"}</td>
                    <td className="px-4 py-2 text-right"><ReturnCell value={row.ytd} /></td>
                    <td className="px-4 py-2 text-right tabular-nums">{pctText(row.ytd_drawdown)}</td>
                    <td className="px-4 py-2 text-right"><ReturnCell value={row.ret_1w} /></td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">没有符合条件的条目</td>
                  </tr>
                )}
              </tbody>
            </table>
            {selected.truncated && (
              <p className="px-5 py-3 text-xs text-muted-foreground border-t">预览只显示前 {selected.rows.length} 行，完整数据在生成本周 Excel 里。</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function FileRow({
  file,
  active,
  onOpen,
}: {
  file: ExternalRankWeekFile
  active: boolean
  onOpen: () => void
}) {
  return (
    <tr className={`border-b last:border-0 ${active ? "bg-red-50/60 dark:bg-red-950/20" : ""}`}>
      <td className="px-5 py-2 max-w-[22rem]">
        <button type="button" onClick={onOpen} className="text-left hover:text-red-600">
          <span className="block truncate">{file.name}</span>
          {!file.parsed && <span className="block text-xs text-amber-700 dark:text-amber-400">未能识别成业绩榜</span>}
        </button>
      </td>
      <td className="px-5 py-2 tabular-nums whitespace-nowrap">{file.as_of ? slashDate(file.as_of) : "—"}</td>
      <td className="px-5 py-2 text-muted-foreground">{file.classes.length ? file.classes.join("、") : "—"}</td>
      <td className="px-5 py-2 text-right tabular-nums">{file.parsed ? file.row_count : "—"}</td>
      <td className="px-5 py-2 text-muted-foreground whitespace-nowrap">
        {formatWhen(file.updated_at)}
        <span className="ml-2 text-xs">{formatSize(file.size)}</span>
      </td>
      <td className="px-5 py-2 text-right whitespace-nowrap">
        <button type="button" onClick={onOpen} className="text-xs text-zinc-600 hover:text-red-600 dark:text-zinc-300">
          查看
        </button>
        <button
          type="button"
          onClick={() => downloadOriginal(file.path, file.name)}
          className="ml-3 text-xs text-zinc-600 hover:text-red-600 dark:text-zinc-300"
        >
          下载原文件
        </button>
      </td>
    </tr>
  )
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = "right",
}: {
  label: string
  active: boolean
  dir: "asc" | "desc"
  onClick: () => void
  align?: "left" | "right"
}) {
  return (
    <th className={`px-4 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button type="button" onClick={onClick} className={active ? "text-foreground" : "hover:text-foreground"}>
        {label}
        {active ? (dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  )
}
