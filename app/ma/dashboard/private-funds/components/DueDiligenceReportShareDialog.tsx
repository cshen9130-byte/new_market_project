"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ma/ui/switch"
import type { DueDiligenceReport } from "@/lib/ma/due-diligence-reports"
import { setDueDiligenceReportTeamShared } from "@/lib/ma/due-diligence-reports"

export function DueDiligenceReportShareDialog({
  report,
  open,
  onOpenChange,
  onSaved,
}: {
  report: DueDiligenceReport | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}) {
  const [teamShared, setTeamShared] = useState(false)

  useEffect(() => {
    if (open && report) {
      setTeamShared(report.teamShared ?? false)
    }
  }, [open, report])

  function handleConfirm() {
    if (!report) return
    setDueDiligenceReportTeamShared(report.id, teamShared)
    onSaved?.()
    onOpenChange(false)
  }

  if (!report) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0" showCloseButton>
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="text-base font-semibold">团队共享</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          <div className="flex items-center gap-2">
            <span className="h-4 w-1 rounded-full bg-red-500" />
            <span className="text-sm font-medium text-zinc-800">{report.title}</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-600">团队共享：</span>
            <Switch checked={teamShared} onCheckedChange={setTeamShared} />
            <span className="text-sm text-zinc-500">{teamShared ? "共享" : "不共享"}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded border border-zinc-200 bg-white px-5 py-2 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded bg-red-500 px-5 py-2 text-sm text-white hover:bg-red-600 transition-colors"
          >
            确定
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
