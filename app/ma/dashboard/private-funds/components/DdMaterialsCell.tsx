"use client"

import { useMemo, useState, type CSSProperties, type MouseEvent } from "react"
import { ExternalLink, FileText, GripVertical, Loader2, X } from "lucide-react"
import type { CellFormat } from "@/lib/ma/due-diligence-table"
import type { DdMaterialsDocument } from "@/lib/ma/due-diligence-materials"
import {
  buildDdMaterialsFileUrl,
  buildDdMaterialsKbUrl,
  buildDdMaterialsPreviewUrl,
} from "@/lib/ma/due-diligence-materials"
import { MA_CHAT_DOCUMENT_MIME } from "@/lib/ma/chat-documents"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace("T", " ")
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatToStyle(format: CellFormat): CSSProperties {
  const style: CSSProperties = {}
  if (format.bold) style.fontWeight = 700
  if (format.italic) style.fontStyle = "italic"
  if (format.underline || format.strikethrough) {
    style.textDecoration = [format.underline ? "underline" : "", format.strikethrough ? "line-through" : ""]
      .filter(Boolean)
      .join(" ")
  }
  if (format.color) style.color = format.color
  if (format.bgColor) style.backgroundColor = format.bgColor
  if (format.align) style.textAlign = format.align
  if (format.fontSize) style.fontSize = format.fontSize
  return style
}

function previewSrc(document: DdMaterialsDocument): string {
  if (document.canPreview) return buildDdMaterialsPreviewUrl(document.relativePath)
  return buildDdMaterialsFileUrl(document.relativePath)
}

export function DdMaterialsCell({
  cellId,
  value,
  width,
  format,
  isActive,
  isSelected,
  folderPath,
  folderName,
  documents,
  materialsLoading,
  onActivate,
  onChange,
}: {
  cellId: string
  value: string
  width: number
  format: CellFormat
  isActive: boolean
  isSelected: boolean
  folderPath: string | null
  folderName: string | null
  documents: DdMaterialsDocument[]
  materialsLoading: boolean
  onActivate: () => void
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<DdMaterialsDocument | null>(null)

  const style: CSSProperties = {
    width: width - 4,
    ...formatToStyle(format),
  }

  const baseClass = [
    "block rounded border bg-transparent px-1 text-xs text-zinc-800 outline-none transition-colors",
    "hover:border-zinc-200 hover:bg-white/80",
    isActive
      ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-300"
      : isSelected
        ? "border-blue-300/60"
        : "border-transparent",
  ].join(" ")

  const hasMaterials = value.trim() === "已上传" || documents.length > 0
  const displayLabel = useMemo(() => {
    if (materialsLoading) return "…"
    if (documents.length > 0) return `已上传 (${documents.length})`
    if (value.trim() === "已上传") return "已上传"
    return value
  }, [documents.length, materialsLoading, value])

  function openModal(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (!hasMaterials && !folderPath) return
    setPreviewDoc(documents[0] ?? null)
    setOpen(true)
  }

  function handleOpenMouseDown(event: MouseEvent) {
    // Table cell mousedown calls preventDefault(), which suppresses click.
    event.preventDefault()
    event.stopPropagation()
    openModal(event)
  }

  function openKnowledgeBase(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (!folderPath) return
    window.open(buildDdMaterialsKbUrl(folderPath), "_blank", "noopener,noreferrer")
  }

  function onDocumentDragStart(event: React.DragEvent, doc: DdMaterialsDocument) {
    event.stopPropagation()
    const payload = {
      type: "kb-document" as const,
      name: doc.name,
      relativePath: doc.relativePath,
      canPreview: doc.canPreview,
      extension: doc.extension,
    }
    event.dataTransfer.setData(MA_CHAT_DOCUMENT_MIME, JSON.stringify(payload))
    event.dataTransfer.setData("text/plain", doc.name)
    event.dataTransfer.effectAllowed = "copy"
  }

  if (isActive) {
    return (
      <input
        type="text"
        data-cell={cellId}
        value={value}
        style={style}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onActivate}
        className={baseClass}
      />
    )
  }

  if (hasMaterials || folderPath) {
    return (
      <>
        <button
          type="button"
          data-cell={cellId}
          style={style}
          onMouseDown={handleOpenMouseDown}
          onDoubleClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onActivate()
          }}
          className={`${baseClass} w-full text-left text-blue-600 hover:text-blue-700 hover:underline cursor-pointer`}
          title={folderName ? `查看 ${folderName} 的资料` : "查看尽调资料"}
        >
          {displayLabel}
        </button>

        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (!next) setPreviewDoc(null)
          }}
        >
          <DialogContent className="max-w-6xl w-[96vw] h-[88vh] flex flex-col p-0 gap-0">
            <DialogHeader className="px-5 py-4 border-b shrink-0">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div className="min-w-0">
                  <DialogTitle className="text-sm font-semibold">尽调资料</DialogTitle>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {folderName || folderPath || "未匹配到知识库文件夹"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {folderPath && (
                    <button
                      type="button"
                      onClick={openKnowledgeBase}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs hover:bg-muted transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      在知识库中打开
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground"
                    aria-label="关闭"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </DialogHeader>

            <div className="flex min-h-0 flex-1">
              <div className="w-[34%] min-w-[240px] border-r overflow-y-auto">
                {documents.length === 0 ? (
                  <div className="p-5 text-sm text-muted-foreground">
                    {folderPath
                      ? "该文件夹暂无文件，或您暂无访问权限。"
                      : "未能根据尽调日期和基金公司匹配到知识库文件夹。请确认资料已上传至「内部尽调资料」。"}
                  </div>
                ) : (
                  <div className="divide-y">
                    {documents.map((doc) => {
                      const active = previewDoc?.relativePath === doc.relativePath
                      return (
                        <button
                          key={doc.relativePath}
                          type="button"
                          draggable
                          onDragStart={(event) => onDocumentDragStart(event, doc)}
                          onClick={() => setPreviewDoc(doc)}
                          className={[
                            "w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors cursor-grab active:cursor-grabbing",
                            active ? "bg-blue-50/70" : "",
                          ].join(" ")}
                          title="点击预览，拖入 AI 助手资料区"
                        >
                          <div className="flex items-start gap-2 min-w-0">
                            <GripVertical className="h-4 w-4 text-zinc-300 shrink-0 mt-0.5" />
                            <FileText className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate" title={doc.name}>
                                {doc.name}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {formatFileSize(doc.size)}
                                {doc.updatedAt ? ` · ${formatDate(doc.updatedAt)}` : ""}
                              </div>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 flex flex-col bg-zinc-50">
                {previewDoc ? (
                  <>
                    <div className="px-4 py-2 border-b bg-white text-xs text-muted-foreground truncate shrink-0">
                      {previewDoc.name}
                    </div>
                    <iframe
                      key={previewDoc.relativePath}
                      src={previewSrc(previewDoc)}
                      title={previewDoc.name}
                      className="flex-1 w-full border-0 bg-white"
                    />
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                    {documents.length > 0 ? "点击左侧文件进行预览" : "暂无可预览的资料"}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  if (materialsLoading) {
    return (
      <div
        data-cell={cellId}
        style={style}
        className={`${baseClass} flex items-center gap-1 text-zinc-400`}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    )
  }

  return (
    <input
      type="text"
      data-cell={cellId}
      value={value}
      style={style}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onActivate}
      className={baseClass}
    />
  )
}
