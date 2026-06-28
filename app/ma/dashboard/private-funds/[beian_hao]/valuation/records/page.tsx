"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, CloudDownload, FileSearch } from "lucide-react"
import { FundDatabaseShell } from "@/components/ma/fund-database-shell"
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ma/ui/tooltip"
import {
  ValuationParseDialog,
  downloadValuationAttachment,
} from "./ValuationParseDialog"

type CalendarEntry = {
  date: string
  id: number
  attachmentFilename: string | null
}

type CalendarSummary = {
  total: number
  dateFrom: string | null
  dateTo: string | null
  dates: string[]
  entries: CalendarEntry[]
  inceptionDate?: string | null
  needsEmailBackfill?: boolean
}

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

const TAB_DEFAULT_SIDE: Record<string, string> = {
  funds: "private-funds",
  portfolio: "port-simulated",
  investment: "inv-tracking",
  operations: "ops-strategy-tags",
}

type CalendarCell = {
  date: string | null
  day: number | null
  inMonth: boolean
}

function buildCalendarGrid(year: number, month: number): CalendarCell[] {
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startOffset = (firstDay.getDay() + 6) % 7

  const cells: CalendarCell[] = []
  for (let i = 0; i < startOffset; i++) {
    cells.push({ date: null, day: null, inMonth: false })
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    cells.push({ date, day, inMonth: true })
  }
  while (cells.length % 7 !== 0) {
    cells.push({ date: null, day: null, inMonth: false })
  }
  while (cells.length < 42) {
    cells.push({ date: null, day: null, inMonth: false })
  }
  return cells
}

function parseYearMonth(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function ActionTip({
  label,
  children,
}: {
  label: string
  children: React.ReactElement
}) {
  return (
    <UiTooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        className="bg-zinc-800 text-white border-0 px-2.5 py-1 text-xs shadow-md [&>svg]:fill-zinc-800 [&>svg]:bg-zinc-800"
      >
        {label}
      </TooltipContent>
    </UiTooltip>
  )
}

function CalendarDayCell({
  day,
  entry,
  onViewParse,
}: {
  day: number
  entry: CalendarEntry
  onViewParse: (recordId: number) => void
}) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  async function handleExport(e: React.MouseEvent) {
    e.stopPropagation()
    if (exporting) return
    setExporting(true)
    setExportError(null)
    try {
      await downloadValuationAttachment(entry.id, entry.attachmentFilename)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "下载失败")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="group relative min-h-[72px] bg-white border-b border-r border-zinc-100 last:border-r-0">
      <div className="absolute top-2 right-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#4a90d9] text-sm font-medium text-white tabular-nums">
          {day}
        </span>
      </div>

      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <ActionTip label="导出估值表">
          <button
            type="button"
            onClick={(e) => { void handleExport(e) }}
            disabled={exporting}
            className="p-0.5 text-[#4a90d9] hover:text-[#3a7bc8] disabled:opacity-50 transition-colors"
            title={exportError ?? undefined}
          >
            <CloudDownload className="h-4 w-4" />
          </button>
        </ActionTip>
        <ActionTip label="查看解析">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onViewParse(entry.id)
            }}
            className="p-0.5 text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            <FileSearch className="h-4 w-4" />
          </button>
        </ActionTip>
      </div>
    </div>
  )
}

export default function ValuationRecordsCalendarPage() {
  const params = useParams()
  const router = useRouter()
  const beian_hao = typeof params.beian_hao === "string" ? params.beian_hao : ""

  const [displayName, setDisplayName] = useState(beian_hao)
  const [summary, setSummary] = useState<CalendarSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth() + 1)
  const [parseRecordId, setParseRecordId] = useState<number | null>(null)
  const [syncingHistory, setSyncingHistory] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const backfillAttemptedRef = useRef(false)

  const loadCalendar = useCallback(async () => {
    const res = await fetch(
      `/ma/api/private-funds/${encodeURIComponent(beian_hao)}/valuation/records?view=calendar`,
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { error?: string }))
      throw new Error(body.error ?? `HTTP ${res.status}`)
    }
    return res.json() as Promise<CalendarSummary>
  }, [beian_hao])

  const navigateFunds = useCallback((tab: string, side?: string) => {
    const sideItem = side ?? TAB_DEFAULT_SIDE[tab] ?? "private-funds"
    router.push(`/ma/dashboard/private-funds?tab=${tab}&side=${sideItem}`)
  }, [router])

  useEffect(() => {
    if (!beian_hao) return
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`/ma/api/private-funds/${encodeURIComponent(beian_hao)}/valuation?mode=major`)
        .then(async (r) => (r.ok ? r.json() as Promise<{ product_name?: string | null; fund_name?: string | null }> : null))
        .catch(() => null),
      loadCalendar(),
    ])
      .then(([fund, calendar]) => {
        if (fund) {
          setDisplayName(fund.product_name ?? fund.fund_name ?? beian_hao)
        }
        setSummary(calendar)
        if (calendar.dateTo) {
          const [y, m] = calendar.dateTo.split("-").map(Number)
          if (y && m) {
            setViewYear(y)
            setViewMonth(m)
          }
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false))
  }, [beian_hao, loadCalendar])

  useEffect(() => {
    if (!beian_hao || !summary?.needsEmailBackfill || backfillAttemptedRef.current) return
    backfillAttemptedRef.current = true
    setSyncingHistory(true)
    setSyncMessage("正在从邮箱同步历史估值表…")

    void (async () => {
      try {
        const res = await fetch(
          `/ma/api/private-funds/${encodeURIComponent(beian_hao)}/valuation/fetch-emails`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        )
        const body = await res.json().catch(() => ({} as { error?: string; valuationSaved?: number; zipBatchSaved?: number; days?: number }))
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

        const calendar = await loadCalendar()
        setSummary(calendar)
        if (calendar.dateFrom) {
          const [y, m] = calendar.dateFrom.split("-").map(Number)
          if (y && m) {
            setViewYear(y)
            setViewMonth(m)
          }
        }
        const zipPart = body.zipBatchSaved ? `（含历史压缩包 ${body.zipBatchSaved} 条）` : ""
        setSyncMessage(`已同步 ${body.valuationSaved ?? 0} 条估值表${zipPart}（扫描 ${body.days ?? ""} 天邮件）`)
      } catch (e) {
        setSyncMessage(e instanceof Error ? e.message : "同步历史估值表失败")
      } finally {
        setSyncingHistory(false)
        window.setTimeout(() => setSyncMessage(null), 8000)
      }
    })()
  }, [beian_hao, summary?.needsEmailBackfill, loadCalendar])

  const entryByDate = useMemo(() => {
    const map = new Map<string, CalendarEntry>()
    for (const entry of summary?.entries ?? []) {
      map.set(entry.date, entry)
    }
    return map
  }, [summary?.entries])

  const cells = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth])
  const monthValue = `${viewYear}-${String(viewMonth).padStart(2, "0")}`

  function handleMonthInput(value: string) {
    const parsed = parseYearMonth(value)
    if (!parsed) return
    setViewYear(parsed.year)
    setViewMonth(parsed.month)
  }

  function handlePrevMonth() {
    const next = shiftMonth(viewYear, viewMonth, -1)
    setViewYear(next.year)
    setViewMonth(next.month)
  }

  function handleNextMonth() {
    const next = shiftMonth(viewYear, viewMonth, 1)
    setViewYear(next.year)
    setViewMonth(next.month)
  }

  const rangeLabel = summary?.dateFrom && summary?.dateTo
    ? `${summary.dateFrom}~${summary.dateTo}`
    : "—"

  return (
    <FundDatabaseShell onNavigate={navigateFunds}>
      <div className="min-h-0">
        <Link
          href={`/ma/dashboard/private-funds/${encodeURIComponent(beian_hao)}/valuation`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-700 mb-4 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          返回估值表分析
        </Link>

        <div className="bg-white rounded-lg border border-zinc-100 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h1 className="text-xl font-bold text-zinc-900">{displayName}</h1>
                <span className="px-2 py-0.5 rounded text-xs border border-red-400 text-red-500 font-medium bg-red-50/50">
                  估值表列表
                </span>
              </div>
              <p className="text-sm text-zinc-500">
                共{summary?.total ?? 0}个估值表，截止时间为 {rangeLabel}
              </p>
              {(syncingHistory || syncMessage) && (
                <p className={`text-xs mt-1 ${syncingHistory ? "text-zinc-400" : "text-emerald-600"}`}>
                  {syncMessage ?? "正在从邮箱同步历史估值表…"}
                </p>
              )}
            </div>

            <div className="flex items-center gap-1 border border-zinc-200 rounded bg-white">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-2 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50 transition-colors"
                aria-label="上一月"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <label className="relative flex items-center gap-1.5 px-2 py-1.5 text-sm text-zinc-700 tabular-nums cursor-pointer">
                <input
                  type="month"
                  value={monthValue}
                  onChange={(e) => handleMonthInput(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <span>{monthValue}</span>
                <CalendarDays className="h-4 w-4 text-zinc-400" />
              </label>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-2 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50 transition-colors"
                aria-label="下一月"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {loading && (
            <div className="py-16 text-center text-sm text-zinc-400">加载中…</div>
          )}

          {error && (
            <div className="py-10 text-center text-sm text-red-600">{error}</div>
          )}

          {!loading && !error && (
            <>
              <div className="grid grid-cols-7 border border-zinc-100 rounded-lg overflow-hidden">
                {WEEKDAY_LABELS.map((label) => (
                  <div
                    key={label}
                    className="py-2.5 text-center text-xs font-medium text-zinc-500 bg-zinc-50 border-b border-zinc-100"
                  >
                    {label}
                  </div>
                ))}

                {cells.map((cell, index) => {
                  const entry = cell.date ? entryByDate.get(cell.date) : undefined
                  const isEmpty = !cell.inMonth

                  if (cell.inMonth && cell.day != null && entry) {
                    return (
                      <CalendarDayCell
                        key={`${cell.date}-${index}`}
                        day={cell.day}
                        entry={entry}
                        onViewParse={setParseRecordId}
                      />
                    )
                  }

                  return (
                    <div
                      key={`${cell.date ?? "empty"}-${index}`}
                      className={[
                        "relative min-h-[72px] border-b border-r border-zinc-100 last:border-r-0",
                        isEmpty
                          ? "bg-[repeating-linear-gradient(135deg,#f4f4f5_0,#f4f4f5_4px,#fafafa_4px,#fafafa_8px)]"
                          : "bg-white",
                      ].join(" ")}
                    >
                      {cell.inMonth && cell.day != null && (
                        <div className="absolute top-2 right-2 text-sm text-zinc-400 tabular-nums">
                          {cell.day}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <p className="mt-5 text-xs text-zinc-400 leading-relaxed">
                备注：请注意估值表解析有无异常，估值表是否完整，如有疑问，请联系我们。
              </p>
            </>
          )}
        </div>
      </div>

      <ValuationParseDialog
        open={parseRecordId != null}
        onClose={() => setParseRecordId(null)}
        recordId={parseRecordId}
        displayName={displayName}
      />
    </FundDatabaseShell>
  )
}
