"use client"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useToast } from "@/hooks/use-toast"
import {
  downloadInstructionAttachment,
  openInstructionAttachment,
} from "./instruction-attachment-files"
import { parseEmailConfirmRecordId } from "./instructions-store"
import type { OpsLedgerAttachment, OpsLedgerRow } from "./ops-ledger-store"

function coerceConfirmRecordId(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function resolveLedgerAttachmentId(attachment: OpsLedgerAttachment): string {
  const recordId =
    coerceConfirmRecordId(attachment.confirmRecordId)
    ?? parseEmailConfirmRecordId(attachment.id)
  if (recordId != null) return `email-confirm:${recordId}`
  return attachment.id
}

export function resolveLedgerAttachmentPreviewUrl(
  attachment: OpsLedgerAttachment,
): string | null {
  const recordId =
    coerceConfirmRecordId(attachment.confirmRecordId)
    ?? parseEmailConfirmRecordId(attachment.id)
  if (recordId == null) return null
  return `/ma/api/ops/email-confirm-records/${recordId}/file`
}

/** Recover a 确认单 from the attachment, or from a generated-row remark. */
export function ledgerConfirmAttachment(
  row: Pick<OpsLedgerRow, "confirm_attachment" | "remark">,
): OpsLedgerAttachment | null {
  if (row.confirm_attachment?.id) return row.confirm_attachment
  const match = (row.remark || "").match(/确认单#(\d+)/)
  if (!match) return null
  const id = Number(match[1])
  if (!Number.isFinite(id)) return null
  return {
    id: `email-confirm:${id}`,
    name: `确认单#${id}`,
    source: "email",
    confirmRecordId: id,
  }
}

export function LedgerSourceCell({
  row,
  className,
}: {
  row: OpsLedgerRow
  className?: string
}) {
  const { toast } = useToast()
  const attachment = ledgerConfirmAttachment(row)
  const source = row.source?.trim() || "—"

  async function handleOpen() {
    if (!attachment) return
    try {
      await openInstructionAttachment(resolveLedgerAttachmentId(attachment))
    } catch (err) {
      toast({
        title: "无法打开确认单",
        description: err instanceof Error ? err.message : "附件不存在",
        variant: "destructive",
      })
    }
  }

  async function handleDownload() {
    if (!attachment) return
    try {
      await downloadInstructionAttachment(resolveLedgerAttachmentId(attachment), attachment.name)
    } catch (err) {
      toast({
        title: "无法下载确认单",
        description: err instanceof Error ? err.message : "附件不存在",
        variant: "destructive",
      })
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span
          className={className}
          title={attachment ? `${source}（右键查看确认单）` : source}
        >
          {source}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        {attachment ? (
          <>
            <ContextMenuItem onClick={() => void handleOpen()}>
              预览确认单
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void handleDownload()}>
              下载确认单
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem disabled>暂无确认单</ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function LedgerAttachmentLink({
  attachment,
  empty = "—",
}: {
  attachment: OpsLedgerAttachment | null | undefined
  empty?: string
}) {
  const { toast } = useToast()

  async function handleOpen(file: OpsLedgerAttachment) {
    try {
      await openInstructionAttachment(resolveLedgerAttachmentId(file))
    } catch (err) {
      toast({
        title: "无法打开附件",
        description: err instanceof Error ? err.message : "附件不存在",
        variant: "destructive",
      })
    }
  }

  async function handleDownload(file: OpsLedgerAttachment) {
    try {
      await downloadInstructionAttachment(resolveLedgerAttachmentId(file), file.name)
    } catch (err) {
      toast({
        title: "无法下载附件",
        description: err instanceof Error ? err.message : "附件不存在",
        variant: "destructive",
      })
    }
  }

  if (!attachment?.id) {
    return <span className="text-muted-foreground">{empty}</span>
  }

  const className =
    "max-w-[180px] truncate text-left text-sky-600 hover:underline dark:text-sky-400"

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={() => void handleOpen(attachment)}
          className={className}
          title={attachment.name}
        >
          {attachment.name}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem onClick={() => void handleOpen(attachment)}>
          预览
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void handleDownload(attachment)}>
          下载文件
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
