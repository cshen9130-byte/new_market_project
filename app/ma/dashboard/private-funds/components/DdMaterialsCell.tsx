"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { Bot, ExternalLink, FileText, GripVertical, Loader2, X } from "lucide-react"
import type { CellFormat } from "@/lib/ma/due-diligence-table"
import type { DdMaterialsDocument } from "@/lib/ma/due-diligence-materials"
import {
  buildDdMaterialsFileUrl,
  buildDdMaterialsKbUrl,
  buildDdMaterialsPreviewUrl,
} from "@/lib/ma/due-diligence-materials"
import { dispatchMaChatOpenDocuments, MA_CHAT_DOCUMENT_MIME, type MaChatKbDocumentPayload } from "@/lib/ma/chat-documents"

const FRAME_PREVIEW_EXTENSIONS = new Set([".pdf", ".html", ".htm"])
const IMAGE_PREVIEW_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"])
const DIALOG_MIN_W = 640
const DIALOG_MIN_H = 420
const PANEL_Z = 10050

function defaultDialogSize() {
  if (typeof window === "undefined") return { w: 1100, h: 680 }
  return {
    w: Math.min(1100, Math.round(window.innerWidth * 0.88)),
    h: Math.min(Math.round(window.innerHeight * 0.82), 760),
  }
}

function clampDialogPosition(size: { w: number; h: number }, pos: { x: number; y: number }) {
  const margin = 8
  const maxX = Math.max(margin, window.innerWidth - size.w - margin)
  const maxY = Math.max(margin, window.innerHeight - size.h - margin)
  return {
    x: Math.min(Math.max(margin, pos.x), maxX),
    y: Math.min(Math.max(margin, pos.y), maxY),
  }
}

function defaultDialogPosition(size: { w: number; h: number }) {
  return clampDialogPosition(size, {
    x: Math.round((window.innerWidth - size.w) / 2),
    y: Math.round((window.innerHeight - size.h) / 2),
  })
}

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
  const ext = document.extension.toLowerCase()
  if (FRAME_PREVIEW_EXTENSIONS.has(ext) || IMAGE_PREVIEW_EXTENSIONS.has(ext)) {
    return buildDdMaterialsFileUrl(document.relativePath)
  }
  if (document.canPreview) return buildDdMaterialsPreviewUrl(document.relativePath)
  return buildDdMaterialsFileUrl(document.relativePath)
}

function shouldUseIframePreview(document: DdMaterialsDocument): boolean {
  const ext = document.extension.toLowerCase()
  return FRAME_PREVIEW_EXTENSIONS.has(ext) || (document.canPreview && !IMAGE_PREVIEW_EXTENSIONS.has(ext))
}

function toChatPayload(doc: DdMaterialsDocument): MaChatKbDocumentPayload {
  return {
    type: "kb-document",
    name: doc.name,
    relativePath: doc.relativePath,
    canPreview: doc.canPreview,
    extension: doc.extension,
  }
}

function stopPointerBubble(event: React.PointerEvent) {
  event.stopPropagation()
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
  const [mounted, setMounted] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<DdMaterialsDocument | null>(null)
  const [dialogSize, setDialogSize] = useState(defaultDialogSize)
  const [dialogPos, setDialogPos] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const resizeRef = useRef<{ px: number; py: number; w: number; h: number; dir: "se" | "e" | "s" } | null>(null)

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

  const kbUrl = folderPath ? buildDdMaterialsKbUrl(folderPath) : null

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const size = defaultDialogSize()
    setDialogSize(size)
    setDialogPos(defaultDialogPosition(size))
  }, [open])

  useEffect(() => {
    if (!open) return
    function onResize() {
      setDialogSize((size) => {
        const next = {
          w: Math.min(size.w, Math.round(window.innerWidth * 0.98)),
          h: Math.min(size.h, Math.round(window.innerHeight * 0.94)),
        }
        setDialogPos((pos) => clampDialogPosition(next, pos))
        return next
      })
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [open])

  const onHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      stopPointerBubble(event)
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = { px: event.clientX, py: event.clientY, ox: dialogPos.x, oy: dialogPos.y }

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return
        const dx = ev.clientX - dragRef.current.px
        const dy = ev.clientY - dragRef.current.py
        setDialogPos(
          clampDialogPosition(dialogSize, {
            x: dragRef.current.ox + dx,
            y: dragRef.current.oy + dy,
          }),
        )
      }
      const onUp = () => {
        dragRef.current = null
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [dialogPos.x, dialogPos.y, dialogSize],
  )

  const onResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, dir: "se" | "e" | "s") => {
      stopPointerBubble(event)
      event.currentTarget.setPointerCapture(event.pointerId)
      resizeRef.current = { px: event.clientX, py: event.clientY, w: dialogSize.w, h: dialogSize.h, dir }

      const onMove = (ev: PointerEvent) => {
        if (!resizeRef.current) return
        const dx = ev.clientX - resizeRef.current.px
        const dy = ev.clientY - resizeRef.current.py
        const maxW = Math.round(window.innerWidth * 0.98)
        const maxH = Math.round(window.innerHeight * 0.94)
        const nextSize = {
          w:
            resizeRef.current.dir === "s"
              ? resizeRef.current.w
              : Math.max(DIALOG_MIN_W, Math.min(maxW, resizeRef.current.w + dx)),
          h:
            resizeRef.current.dir === "e"
              ? resizeRef.current.h
              : Math.max(DIALOG_MIN_H, Math.min(maxH, resizeRef.current.h + dy)),
        }
        setDialogSize(nextSize)
        setDialogPos((pos) => clampDialogPosition(nextSize, pos))
      }
      const onUp = () => {
        resizeRef.current = null
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [dialogSize.h, dialogSize.w],
  )

  function openModal(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (!hasMaterials && !folderPath) return
    const size = defaultDialogSize()
    setDialogSize(size)
    setDialogPos(defaultDialogPosition(size))
    setPreviewDoc(documents[0] ?? null)
    setOpen(true)
  }

  function handleOpenMouseDown(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    openModal(event)
  }

  function openInPageAi() {
    if (documents.length === 0) return
    dispatchMaChatOpenDocuments(documents.map(toChatPayload))
    setOpen(false)
  }

  function onDocumentDragStart(event: React.DragEvent, doc: DdMaterialsDocument) {
    event.stopPropagation()
    const payload = toChatPayload(doc)
    event.dataTransfer.setData(MA_CHAT_DOCUMENT_MIME, JSON.stringify(payload))
    event.dataTransfer.setData("text/plain", doc.name)
    event.dataTransfer.effectAllowed = "copy"
  }

  const panel =
    open && mounted
      ? createPortal(
          <>
            <div
              className="fixed inset-0 bg-black/50"
              style={{ zIndex: PANEL_Z }}
              onClick={(event) => {
                if (event.target === event.currentTarget) setOpen(false)
              }}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="dd-materials-title"
              className="fixed flex flex-col overflow-hidden rounded-lg border bg-background shadow-2xl"
              style={{
                zIndex: PANEL_Z + 1,
                left: dialogPos.x,
                top: dialogPos.y,
                width: dialogSize.w,
                height: dialogSize.h,
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div
                className="flex shrink-0 cursor-grab items-start justify-between gap-4 border-b bg-muted/20 px-5 py-4 active:cursor-grabbing select-none"
                onPointerDown={onHeaderPointerDown}
              >
                <div className="min-w-0 pointer-events-none">
                  <h2 id="dd-materials-title" className="text-sm font-semibold">
                    尽调资料
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {folderName || folderPath || "未匹配到知识库文件夹"}
                  </p>
                </div>
                <div
                  className="flex items-center gap-2 shrink-0"
                  onPointerDown={stopPointerBubble}
                >
                  {documents.length > 0 && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        openInPageAi()
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-background text-xs hover:bg-muted transition-colors"
                    >
                      <Bot className="h-3.5 w-3.5" />
                      在页面AI打开
                    </button>
                  )}
                  {kbUrl && (
                    <a
                      href={kbUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-background text-xs hover:bg-muted transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      在知识库中打开
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      setOpen(false)
                    }}
                    className="p-1 rounded text-muted-foreground hover:text-foreground"
                    aria-label="关闭"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex min-h-0 flex-1">
                <div className="w-[34%] min-w-[220px] max-w-[360px] border-r overflow-y-auto">
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
                            onMouseDown={(event) => event.stopPropagation()}
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
                      {shouldUseIframePreview(previewDoc) ? (
                        <iframe
                          key={previewDoc.relativePath}
                          src={previewSrc(previewDoc)}
                          title={previewDoc.name}
                          className="flex-1 w-full min-h-0 border-0 bg-white"
                        />
                      ) : IMAGE_PREVIEW_EXTENSIONS.has(previewDoc.extension.toLowerCase()) ? (
                        <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center bg-zinc-100 p-4">
                          <img
                            src={previewSrc(previewDoc)}
                            alt={previewDoc.name}
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                      ) : (
                        <iframe
                          key={previewDoc.relativePath}
                          src={previewSrc(previewDoc)}
                          title={previewDoc.name}
                          className="flex-1 w-full min-h-0 border-0 bg-white"
                        />
                      )}
                    </>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                      {documents.length > 0 ? "点击左侧文件进行预览" : "暂无可预览的资料"}
                    </div>
                  )}
                </div>
              </div>

              <div
                className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-se-resize"
                onPointerDown={(event) => onResizePointerDown(event, "se")}
                title="拖拽调整大小"
              />
              <div
                className="absolute right-0 top-14 bottom-4 z-10 w-1.5 cursor-e-resize"
                onPointerDown={(event) => onResizePointerDown(event, "e")}
              />
              <div
                className="absolute bottom-0 left-4 right-4 z-10 h-1.5 cursor-s-resize"
                onPointerDown={(event) => onResizePointerDown(event, "s")}
              />
            </div>
          </>,
          document.body,
        )
      : null

  if (isActive) {
    return (
      <>
        <input
          type="text"
          data-cell={cellId}
          value={value}
          style={style}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onActivate}
          className={baseClass}
        />
        {panel}
      </>
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
        {panel}
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
    <>
      <input
        type="text"
        data-cell={cellId}
        value={value}
        style={style}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onActivate}
        className={baseClass}
      />
      {panel}
    </>
  )
}
