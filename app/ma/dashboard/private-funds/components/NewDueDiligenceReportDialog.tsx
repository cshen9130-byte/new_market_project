"use client"

import { Eye, FilePlus, FileText } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { dueDiligenceReportEditorUrl } from "@/lib/ma/due-diligence-reports"

export type DueDiligenceReportTemplateId = "simple" | "general"

const TEMPLATES: {
  id: DueDiligenceReportTemplateId
  title: string
  official?: boolean
}[] = [
  { id: "simple", title: "尽调报告简易模版", official: true },
  { id: "general", title: "尽调报告通用模版" },
]

function editorUrl(template: DueDiligenceReportTemplateId): string {
  return dueDiligenceReportEditorUrl(template)
}

function TemplateCard({
  title,
  official,
  onPreview,
  onUse,
}: {
  title: string
  official?: boolean
  onPreview: () => void
  onUse: () => void
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-700">{title}</span>
          {official && (
            <span className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-500">
              官方
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 bg-white min-h-[120px]">
        <div className="mb-3 flex h-16 w-12 items-center justify-center rounded border border-zinc-200 bg-zinc-50">
          <FileText className="h-7 w-7 text-zinc-300" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-zinc-700">{title}</p>
      </div>
      <div className="flex items-center justify-center gap-4 border-t border-zinc-100 px-4 py-3 text-sm">
        <button
          type="button"
          onClick={onPreview}
          className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-red-600 transition-colors"
        >
          <Eye className="h-4 w-4" />
          预览
        </button>
        <span className="h-4 w-px bg-zinc-200" />
        <button
          type="button"
          onClick={onUse}
          className="inline-flex items-center gap-1.5 text-zinc-600 hover:text-red-600 transition-colors"
        >
          <FilePlus className="h-4 w-4" />
          使用模板
        </button>
      </div>
    </div>
  )
}

export function NewDueDiligenceReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  function handleUseTemplate(templateId: DueDiligenceReportTemplateId) {
    window.open(editorUrl(templateId), "_blank", "noopener,noreferrer")
    onOpenChange(false)
  }

  function handlePreview(templateId: DueDiligenceReportTemplateId) {
    window.open(`${editorUrl(templateId)}&preview=1`, "_blank", "noopener,noreferrer")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[720px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]" showCloseButton>
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="text-base font-semibold">新建报告</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5">
          <p className="mb-5 text-sm text-zinc-500">联系客服，提交自定义模板。</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TEMPLATES.map((template) => (
              <TemplateCard
                key={template.id}
                title={template.title}
                official={template.official}
                onPreview={() => handlePreview(template.id)}
                onUse={() => handleUseTemplate(template.id)}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
