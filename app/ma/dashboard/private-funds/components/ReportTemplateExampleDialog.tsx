"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function ReportTemplateExampleDialog({
  open,
  title,
  exampleUrl,
  exampleKind = "image",
  onClose,
}: {
  open: boolean
  title: string
  exampleUrl: string
  exampleKind?: "image" | "pdf"
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="flex max-h-[92vh] w-[820px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[820px]" showCloseButton>
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="text-base font-semibold">{title} — 报告范例</DialogTitle>
          <p className="text-xs text-zinc-400">
            {exampleKind === "pdf" ? "私募产品历史业绩 · 2026-06-18" : "低波稳健FOF 1号 · 2026-06-26"}
          </p>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 p-4 dark:bg-zinc-900/40">
          <div className="overflow-hidden rounded-lg border bg-white shadow-sm dark:bg-zinc-950">
            {exampleKind === "pdf" ? (
              <iframe
                src={`${exampleUrl}#toolbar=0&navpanes=0`}
                title={`${title} 报告范例`}
                className="h-[720px] w-full"
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={exampleUrl}
                alt={`${title} 报告范例`}
                className="mx-auto block w-full"
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
