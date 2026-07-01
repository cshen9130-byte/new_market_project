"use client"

import { useEffect, useState } from "react"
import { ChevronDown, HelpCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { DueDiligenceReport } from "@/lib/ma/due-diligence-reports"
import { setDueDiligenceReportReviewer } from "@/lib/ma/due-diligence-reports"

const REVIEWER_OPTIONS = ["张三", "李四", "王五", "沈默"]

export function DueDiligenceReportAuditDialog({
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
  const [reviewer, setReviewer] = useState("")

  useEffect(() => {
    if (open && report) {
      setReviewer(report.reviewer === "—" ? "" : report.reviewer)
    }
  }, [open, report])

  function handleConfirm() {
    if (!report) return
    setDueDiligenceReportReviewer(report.id, reviewer)
    onSaved?.()
    onOpenChange(false)
  }

  if (!report) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0" showCloseButton>
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="text-base font-semibold">审核设置</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-6">
          <div className="flex items-start gap-3">
            <label className="inline-flex items-center gap-1 shrink-0 pt-2 text-sm text-zinc-600">
              <span className="text-red-500">*</span>
              审核人
              <HelpCircle className="h-3.5 w-3.5 text-zinc-400" />
            </label>
            <div className="relative flex-1">
              <select
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                className="h-9 w-full appearance-none rounded border border-zinc-200 bg-white pl-3 pr-8 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">请输入并选择审核人</option>
                {REVIEWER_OPTIONS.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            </div>
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
