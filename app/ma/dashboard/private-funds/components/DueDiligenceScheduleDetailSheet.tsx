"use client"

import { Pencil, Trash2, X } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import type { DueDiligenceSchedule } from "@/lib/ma/due-diligence-schedules"
import {
  ddTypeLabel,
  formatScheduleDateHeader,
  formatScheduleTimeRange,
  methodLabel,
  notifyMethodLabel,
} from "@/lib/ma/due-diligence-schedules"

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 py-3 border-b border-zinc-100 last:border-b-0">
      <div className="w-20 shrink-0 text-sm text-zinc-400">{label}</div>
      <div className="min-w-0 flex-1 text-sm text-zinc-700 break-words">{value || "—"}</div>
    </div>
  )
}

export function DueDiligenceScheduleDetailSheet({
  schedule,
  open,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  schedule: DueDiligenceSchedule | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (schedule: DueDiligenceSchedule) => void
  onDelete: (schedule: DueDiligenceSchedule) => void
}) {
  if (!schedule) return null

  const headerDate = formatScheduleDateHeader(schedule.startDate)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[420px] max-w-[calc(100vw-2rem)] gap-0 p-0 sm:max-w-[420px] [&>button.absolute]:hidden"
      >
        <SheetTitle className="sr-only">{schedule.title}</SheetTitle>

        <div className="flex items-center justify-between bg-red-500 px-5 py-4 text-white">
          <div className="text-sm font-medium">{headerDate}</div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded p-1 text-white/90 hover:bg-white/10 transition-colors"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <h2 className="text-lg font-semibold text-zinc-900 break-words">{schedule.title}</h2>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onEdit(schedule)}
                className="rounded p-2 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                aria-label="编辑"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(schedule)}
                className="rounded p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                aria-label="删除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-5">
            <span className="inline-flex items-center rounded border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs text-orange-600">
              {methodLabel(schedule.method)}
            </span>
            <span className="inline-flex items-center rounded border border-zinc-200 bg-zinc-50 px-2.5 py-0.5 text-xs text-zinc-600">
              {ddTypeLabel(schedule.ddType)}
            </span>
          </div>

          <div>
            <DetailRow label="尽调时间" value={formatScheduleTimeRange(schedule)} />
            <DetailRow label="尽调机构" value={schedule.institution} />
            <DetailRow label="尽调人员" value={schedule.personnel} />
            <DetailRow label="尽调对象" value={schedule.target} />
            <DetailRow label="推荐机构" value={schedule.recommender} />
            <DetailRow
              label="提示方式"
              value={`${schedule.reminder} · ${notifyMethodLabel(schedule.notifyMethod)}`}
            />
            <DetailRow label="日程描述" value={schedule.description} />
            <DetailRow label="日程附件" value="" />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
