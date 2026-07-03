"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, LayoutGrid, List, Plus } from "lucide-react"
import { Checkbox } from "@/components/ma/ui/checkbox"
import { AddDueDiligenceScheduleDialog } from "./AddDueDiligenceScheduleDialog"
import { DueDiligenceScheduleDetailSheet } from "./DueDiligenceScheduleDetailSheet"
import type { DueDiligenceSchedule, DueDiligenceScheduleForm } from "@/lib/ma/due-diligence-schedules"
import {
  createDueDiligenceSchedule,
  DD_SCHEDULES_UPDATED_EVENT,
  loadDueDiligenceSchedules,
  loadDueDiligenceSchedulesFromServer,
  saveDueDiligenceSchedules,
  saveDueDiligenceSchedulesToServer,
  scheduleDisplayTime,
  scheduleDotClass,
  scheduleMatchesDate,
  schedulePassesFilter,
} from "@/lib/ma/due-diligence-schedules"

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

type CalendarCell = {
  date: string
  day: number
  inMonth: boolean
}

function buildCalendarGrid(year: number, month: number): CalendarCell[] {
  const firstDay = new Date(year, month - 1, 1)
  const startOffset = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month, 0).getDate()

  const prevMonth = month === 1 ? 12 : month - 1
  const prevYear = month === 1 ? year - 1 : year
  const daysInPrevMonth = new Date(prevYear, prevMonth, 0).getDate()

  const cells: CalendarCell[] = []

  for (let i = startOffset - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i
    const date = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    cells.push({ date, day, inMonth: false })
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    cells.push({ date, day, inMonth: true })
  }

  let nextDay = 1
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  while (cells.length % 7 !== 0 || cells.length < 42) {
    const date = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`
    cells.push({ date, day: nextDay, inMonth: false })
    nextDay++
    if (cells.length >= 42) break
  }

  return cells
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function ScheduleEventChip({
  schedule,
  onClick,
}: {
  schedule: DueDiligenceSchedule
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="mb-1 flex w-full items-center gap-1.5 rounded bg-zinc-100/90 px-2 py-1 text-left text-xs text-amber-900/90 hover:bg-zinc-200/90 transition-colors"
    >
      <span className={["h-2 w-2 shrink-0 rounded-full", scheduleDotClass(schedule.method)].join(" ")} />
      <span className="truncate">
        {scheduleDisplayTime(schedule)} {schedule.title}
      </span>
    </button>
  )
}

export function DueDiligenceCalendarView() {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)
  const [showOnsite, setShowOnsite] = useState(true)
  const [showOnline, setShowOnline] = useState(true)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [schedules, setSchedules] = useState<DueDiligenceSchedule[]>([])
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create")
  const [editingSchedule, setEditingSchedule] = useState<DueDiligenceSchedule | null>(null)
  const [selectedSchedule, setSelectedSchedule] = useState<DueDiligenceSchedule | null>(null)
  const [showDetailSheet, setShowDetailSheet] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  const reloadSchedules = async () => {
    try {
      const next = await loadDueDiligenceSchedulesFromServer()
      setSchedules(next)
    } catch {
      setSchedules(loadDueDiligenceSchedules())
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await loadDueDiligenceSchedulesFromServer()
        if (!cancelled) setSchedules(next)
      } catch {
        if (!cancelled) setSchedules(loadDueDiligenceSchedules())
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function onUpdated() { void reloadSchedules() }
    window.addEventListener(DD_SCHEDULES_UPDATED_EVENT, onUpdated)
    return () => window.removeEventListener(DD_SCHEDULES_UPDATED_EVENT, onUpdated)
  }, [])

  const today = todayIso()
  const cells = useMemo(() => buildCalendarGrid(viewYear, viewMonth), [viewYear, viewMonth])
  const monthCells = useMemo(() => cells.filter((c) => c.inMonth), [cells])

  const visibleSchedules = useMemo(
    () => schedules.filter((s) => schedulePassesFilter(s, showOnline, showOnsite)),
    [schedules, showOnline, showOnsite],
  )

  const schedulesByDate = useMemo(() => {
    const map = new Map<string, DueDiligenceSchedule[]>()
    for (const schedule of visibleSchedules) {
      for (const cell of cells) {
        if (!scheduleMatchesDate(schedule, cell.date)) continue
        const list = map.get(cell.date) ?? []
        list.push(schedule)
        map.set(cell.date, list)
      }
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        if (a.allDay && !b.allDay) return -1
        if (!a.allDay && b.allDay) return 1
        return a.startTime.localeCompare(b.startTime)
      })
    }
    return map
  }, [visibleSchedules, cells])

  function persist(next: DueDiligenceSchedule[]) {
    setSchedules(next)
    saveDueDiligenceSchedules(next)
    void saveDueDiligenceSchedulesToServer(next).catch(() => {})
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

  function handleToday() {
    const d = new Date()
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth() + 1)
  }

  function openCreateDialog() {
    setDialogMode("create")
    setEditingSchedule(null)
    setShowAddDialog(true)
  }

  function openEditDialog(schedule: DueDiligenceSchedule) {
    setDialogMode("edit")
    setEditingSchedule(schedule)
    setShowDetailSheet(false)
    setShowAddDialog(true)
  }

  function openDetail(schedule: DueDiligenceSchedule) {
    setSelectedSchedule(schedule)
    setShowDetailSheet(true)
  }

  function handleSubmit(form: DueDiligenceScheduleForm) {
    if (dialogMode === "edit" && editingSchedule) {
      const next = schedules.map((item) =>
        item.id === editingSchedule.id
          ? { ...item, ...form, updatedAt: new Date().toISOString() }
          : item,
      )
      persist(next)
      const updated = next.find((item) => item.id === editingSchedule.id) ?? null
      setSelectedSchedule(updated)
      setEditingSchedule(null)
      return
    }

    const created = createDueDiligenceSchedule(form)
    persist([...schedules, created])
  }

  function handleDelete(schedule: DueDiligenceSchedule) {
    persist(schedules.filter((item) => item.id !== schedule.id))
    setShowDetailSheet(false)
    setSelectedSchedule(null)
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b bg-background">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-lg font-semibold text-foreground">尽调日历</h1>
          <button
            type="button"
            onClick={openCreateDialog}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors"
          >
            <Plus className="h-4 w-4" />
            添加日程
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center border border-zinc-200 rounded-md bg-white">
              <button
                type="button"
                onClick={handlePrevMonth}
                className="p-2 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50 transition-colors"
                aria-label="上一月"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleNextMonth}
                className="p-2 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50 transition-colors border-l border-zinc-200"
                aria-label="下一月"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={handleToday}
              className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              今天
            </button>
            <span className="text-sm font-medium text-foreground tabular-nums">
              {viewYear}年{viewMonth}月
            </span>
          </div>

          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-zinc-600 cursor-pointer select-none">
              <Checkbox checked={showOnsite} onCheckedChange={(v) => setShowOnsite(v === true)} />
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-blue-500" />
                实地尽调
              </span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-600 cursor-pointer select-none">
              <Checkbox checked={showOnline} onCheckedChange={(v) => setShowOnline(v === true)} />
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-orange-400" />
                线上尽调
              </span>
            </label>
            <div className="flex items-center border border-zinc-200 rounded-md bg-white overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className={[
                  "p-2 transition-colors",
                  viewMode === "grid"
                    ? "bg-red-50 text-red-600"
                    : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50",
                ].join(" ")}
                aria-label="网格视图"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={[
                  "p-2 border-l border-zinc-200 transition-colors",
                  viewMode === "list"
                    ? "bg-red-50 text-red-600"
                    : "text-zinc-500 hover:text-zinc-700 hover:bg-zinc-50",
                ].join(" ")}
                aria-label="列表视图"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-6 py-5">
        {viewMode === "grid" ? (
          <div className="grid grid-cols-7 border border-zinc-100 rounded-lg overflow-hidden bg-white">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="py-2.5 text-center text-xs font-medium text-zinc-500 bg-zinc-50 border-b border-zinc-100"
              >
                {label}
              </div>
            ))}

            {cells.map((cell, index) => {
              const isToday = cell.date === today
              const isOutside = !cell.inMonth
              const daySchedules = schedulesByDate.get(cell.date) ?? []

              return (
                <div
                  key={`${cell.date}-${index}`}
                  className={[
                    "relative min-h-[100px] border-b border-r border-zinc-100 last:border-r-0 p-2 pt-8",
                    isOutside
                      ? "bg-[repeating-linear-gradient(135deg,#f4f4f5_0,#f4f4f5_4px,#fafafa_4px,#fafafa_8px)]"
                      : isToday
                        ? "bg-amber-50/80"
                        : "bg-white",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "absolute top-2 right-2 text-sm tabular-nums",
                      isOutside ? "text-zinc-300" : isToday ? "text-red-600 font-medium" : "text-zinc-500",
                    ].join(" ")}
                  >
                    {cell.day}日
                  </div>

                  <div className="space-y-1">
                    {daySchedules.map((schedule) => (
                      <ScheduleEventChip
                        key={`${schedule.id}-${cell.date}`}
                        schedule={schedule}
                        onClick={() => openDetail(schedule)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-100 bg-white overflow-hidden">
            {monthCells.map((cell) => {
              const isToday = cell.date === today
              const weekday = WEEKDAY_LABELS[(new Date(`${cell.date}T12:00:00`).getDay() + 6) % 7]
              const daySchedules = schedulesByDate.get(cell.date) ?? []

              return (
                <div
                  key={cell.date}
                  className={[
                    "flex items-start gap-4 px-4 py-3 border-b border-zinc-100 last:border-b-0",
                    isToday ? "bg-amber-50/80" : "",
                  ].join(" ")}
                >
                  <div className={["w-16 text-sm tabular-nums pt-0.5", isToday ? "text-red-600 font-medium" : "text-zinc-700"].join(" ")}>
                    {cell.day}日
                  </div>
                  <div className="w-12 text-sm text-zinc-400 pt-0.5">{weekday}</div>
                  <div className="flex-1 space-y-1">
                    {daySchedules.length > 0 ? (
                      daySchedules.map((schedule) => (
                        <ScheduleEventChip
                          key={schedule.id}
                          schedule={schedule}
                          onClick={() => openDetail(schedule)}
                        />
                      ))
                    ) : (
                      <div className="text-sm text-zinc-400 pt-0.5">暂无行程</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <AddDueDiligenceScheduleDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        mode={dialogMode}
        initialData={editingSchedule}
        onSubmit={handleSubmit}
      />

      <DueDiligenceScheduleDetailSheet
        schedule={selectedSchedule}
        open={showDetailSheet}
        onOpenChange={setShowDetailSheet}
        onEdit={openEditDialog}
        onDelete={handleDelete}
      />
    </div>
  )
}
