"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { Bot, CheckCircle2, ExternalLink, FileText, FolderInput, GripVertical, Link2, Loader2, Pencil, X, XCircle } from "lucide-react"
import type { CellFormat } from "@/lib/ma/due-diligence-table"
import type { DdMaterialsLinkStatus } from "@/lib/ma/due-diligence-table"
import type { DdMaterialsDocument } from "@/lib/ma/due-diligence-materials"
import {
  buildDdMaterialsFileUrl,
  buildDdMaterialsKbUrl,
  buildDdMaterialsPreviewUrl,
  ddMaterialsFileLinkStatusLabel,
  ddMaterialsLinkStatusLabel,
  isDdMaterialsLinkLocked,
  isDdMaterialsAutoLinkDisabled,
  isDdMaterialsEditable,
} from "@/lib/ma/due-diligence-materials"
import { dispatchMaChatOpenDocuments, MA_CHAT_DOCUMENT_MIME, type MaChatKbDocumentPayload } from "@/lib/ma/chat-documents"
import { DdMaterialsFileEditor } from "./DdMaterialsFileEditor"
import { DdMaterialsLinkPickerDialog } from "./DdMaterialsLinkPickerDialog"

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

function previewSrc(document: DdMaterialsDocument, revision = 0): string {
  const ext = document.extension.toLowerCase()
  const cacheBust = revision > 0 ? `&_=${revision}` : ""
  if (FRAME_PREVIEW_EXTENSIONS.has(ext) || IMAGE_PREVIEW_EXTENSIONS.has(ext)) {
    return `${buildDdMaterialsFileUrl(document.relativePath)}${cacheBust}`
  }
  if (document.canPreview) return `${buildDdMaterialsPreviewUrl(document.relativePath)}${cacheBust}`
  return `${buildDdMaterialsFileUrl(document.relativePath)}${cacheBust}`
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
  linkStatus,
  fileLinks,
  onActivate,
  onChange,
  onApproveLink,
  onRejectLink,
  onManualLink,
  onApproveFiles,
  onRejectFiles,
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
  linkStatus?: DdMaterialsLinkStatus
  fileLinks?: Partial<Record<string, "approved" | "rejected">>
  onActivate: () => void
  onChange: (next: string) => void
  onApproveLink?: () => void
  onRejectLink?: () => void
  onManualLink?: (kbPath: string) => void
  onApproveFiles?: (paths: string[]) => void
  onRejectFiles?: (paths: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [linkMode, setLinkMode] = useState(false)
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(new Set())
  const [mounted, setMounted] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<DdMaterialsDocument | null>(null)
  const [editingDoc, setEditingDoc] = useState<DdMaterialsDocument | null>(null)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [dialogSize, setDialogSize] = useState(defaultDialogSize)
  const [dialogPos, setDialogPos] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const resizeRef = useRef<{ px: number; py: number; w: number; h: number; dir: "se" | "e" | "s" } | null>(null)
  /** Block click-through reopening the cell right after closing the panel. */
  const suppressOpenUntilRef = useRef(0)

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

  const hasMaterials = documents.length > 0 || Boolean(folderPath)
  const canManageLink = Boolean(onManualLink)
  const linkLocked = isDdMaterialsLinkLocked({ ddMaterialsLinkStatus: linkStatus })
  const linkRejected = isDdMaterialsAutoLinkDisabled({ ddMaterialsLinkStatus: linkStatus })
  const statusLabel = ddMaterialsLinkStatusLabel(linkStatus)
  const selectedCount = selectedFilePaths.size
  const allFilesSelected = documents.length > 0 && selectedCount === documents.length

  useEffect(() => {
    if (!open) {
      setSelectedFilePaths(new Set())
      setLinkMode(false)
    }
  }, [open])

  useEffect(() => {
    setSelectedFilePaths((prev) => {
      const next = new Set([...prev].filter((path) => documents.some((doc) => doc.relativePath === path)))
      return next.size === prev.size ? prev : next
    })
  }, [documents])
  const displayLabel = useMemo(() => {
    if (materialsLoading) return "…"
    if (documents.length > 0) return `已上传 (${documents.length})`
    if (folderPath && value.trim() === "已上传") return "已上传"
    return value
  }, [documents.length, folderPath, materialsLoading, value])

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

  function closePanel() {
    suppressOpenUntilRef.current = Date.now() + 400
    setPreviewDoc(null)
    setEditingDoc(null)
    setLinkMode(false)
    setSelectedFilePaths(new Set())
    setOpen(false)
  }

  function toggleLinkMode() {
    setLinkMode((current) => {
      if (current) setSelectedFilePaths(new Set())
      return !current
    })
  }

  function selectPreviewDoc(doc: DdMaterialsDocument) {
    setPreviewDoc(doc)
    setEditingDoc(null)
  }

  function startEditing() {
    if (!previewDoc || !isDdMaterialsEditable(previewDoc)) return
    setEditingDoc(previewDoc)
  }

  function openPanel(event?: MouseEvent) {
    if (event) {
      if (Date.now() < suppressOpenUntilRef.current) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      event.preventDefault()
      event.stopPropagation()
    }
    const size = defaultDialogSize()
    setDialogSize(size)
    setDialogPos(defaultDialogPosition(size))
    setPreviewDoc(documents[0] ?? null)
    setOpen(true)
  }

  function openModal(event: MouseEvent) {
    if (!hasMaterials && !folderPath) return
    openPanel(event)
  }

  function handleOpenMouseDown(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    openModal(event)
  }

  function openInPageAi() {
    if (documents.length === 0) return
    suppressOpenUntilRef.current = Date.now() + 400
    dispatchMaChatOpenDocuments(documents.map(toChatPayload))
    setPreviewDoc(null)
    setOpen(false)
  }

  function toggleFileSelection(path: string, checked: boolean) {
    setSelectedFilePaths((prev) => {
      const next = new Set(prev)
      if (checked) next.add(path)
      else next.delete(path)
      return next
    })
  }

  function toggleSelectAllFiles(checked: boolean) {
    setSelectedFilePaths(checked ? new Set(documents.map((doc) => doc.relativePath)) : new Set())
  }

  function openManualPicker(event?: { preventDefault: () => void; stopPropagation: () => void }) {
    event?.preventDefault()
    event?.stopPropagation()
    setPickerOpen(true)
  }

  function fileStatusBadge(relativePath: string) {
    const status = ddMaterialsFileLinkStatusLabel(relativePath, fileLinks, linkStatus)
    return (
      <span
        className={[
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none",
          status.tone === "approved" ? "bg-emerald-100 text-emerald-800" : "",
          status.tone === "rejected" ? "bg-red-100 text-red-700" : "",
          status.tone === "auto" ? "bg-zinc-100 text-zinc-600" : "",
        ].join(" ")}
      >
        {status.label}
      </span>
    )
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
              onPointerDown={(event) => {
                event.preventDefault()
                closePanel()
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
              <div className="flex shrink-0 items-start justify-between gap-4 border-b bg-muted/20 px-5 py-4">
                <div
                  className="min-w-0 flex-1 cursor-grab select-none active:cursor-grabbing"
                  onPointerDown={onHeaderPointerDown}
                >
                  <h2 id="dd-materials-title" className="text-sm font-semibold">
                    尽调资料
                  </h2>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {folderName || folderPath || "未匹配到知识库文件夹"}
                  </p>
                  {canManageLink && linkMode && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      关联状态：{statusLabel}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canManageLink && (
                    <button
                      type="button"
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        toggleLinkMode()
                      }}
                      className={[
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs transition-colors",
                        linkMode
                          ? "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100"
                          : "bg-background hover:bg-muted",
                      ].join(" ")}
                      title={linkMode ? "退出关联模式" : "管理资料关联"}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      关联
                    </button>
                  )}
                  {previewDoc && isDdMaterialsEditable(previewDoc) && !editingDoc && (
                    <button
                      type="button"
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        startEditing()
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-background text-xs hover:bg-muted transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      编辑
                    </button>
                  )}
                  {documents.length > 0 && (
                    <button
                      type="button"
                      onPointerDown={(event) => {
                        event.preventDefault()
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
                      onPointerDown={(event) => event.stopPropagation()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border bg-background text-xs hover:bg-muted transition-colors"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      在知识库中打开
                    </a>
                  )}
                  <button
                    type="button"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      closePanel()
                    }}
                    className="p-1 rounded text-muted-foreground hover:text-foreground"
                    aria-label="关闭"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {canManageLink && linkMode && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/10 px-4 py-2">
                  <button
                    type="button"
                    onClick={(event) => openManualPicker(event)}
                    className="inline-flex items-center gap-1.5 rounded border bg-background px-2.5 py-1 text-xs hover:bg-muted transition-colors"
                  >
                    <FolderInput className="h-3.5 w-3.5" />
                    手动关联
                  </button>
                  {selectedCount > 0 && onApproveFiles && (
                    <button
                      type="button"
                      onClick={() => {
                        onApproveFiles([...selectedFilePaths])
                        setSelectedFilePaths(new Set())
                      }}
                      className="inline-flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800 hover:bg-emerald-100 transition-colors"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      确认选中正确 ({selectedCount})
                    </button>
                  )}
                  {selectedCount > 0 && onRejectFiles && (
                    <button
                      type="button"
                      onClick={() => {
                        onRejectFiles([...selectedFilePaths])
                        setSelectedFilePaths(new Set())
                      }}
                      className="inline-flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700 hover:bg-red-100 transition-colors"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      标记选中错误 ({selectedCount})
                    </button>
                  )}
                  {selectedCount === 0 && folderPath && !linkLocked && !linkRejected && onApproveLink && (
                    <button
                      type="button"
                      onClick={() => onApproveLink()}
                      className="inline-flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800 hover:bg-emerald-100 transition-colors"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      确认文件夹正确
                    </button>
                  )}
                  {selectedCount === 0 && folderPath && !linkRejected && onRejectLink && (
                    <button
                      type="button"
                      onClick={() => onRejectLink()}
                      className="inline-flex items-center gap-1.5 rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700 hover:bg-red-100 transition-colors"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      标记文件夹错误
                    </button>
                  )}
                </div>
              )}

              <div className="flex min-h-0 flex-1">
                <div
                  className={[
                    "border-r overflow-y-auto flex flex-col shrink-0",
                    linkMode
                      ? "w-[38%] min-w-[280px] max-w-[420px]"
                      : "w-[28%] min-w-[200px] max-w-[300px]",
                  ].join(" ")}
                >
                  {documents.length > 0 && canManageLink && linkMode && (
                    <label className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground shrink-0">
                      <input
                        type="checkbox"
                        checked={allFilesSelected}
                        onChange={(event) => toggleSelectAllFiles(event.target.checked)}
                        className="h-3.5 w-3.5 rounded border-zinc-300"
                      />
                      全选文件
                    </label>
                  )}
                  {documents.length === 0 ? (
                    <div className="p-5 text-sm text-muted-foreground">
                      {folderPath
                        ? "该文件夹暂无文件，或您暂无访问权限。"
                        : "未能根据尽调日期和基金公司匹配到知识库文件夹。请确认资料已上传至「内部尽调资料」。"}
                    </div>
                  ) : (
                    <div className={linkMode ? "divide-y flex-1 overflow-y-auto" : "divide-y"}>
                      {documents.map((doc) => {
                        const active = previewDoc?.relativePath === doc.relativePath
                        const checked = selectedFilePaths.has(doc.relativePath)

                        if (!linkMode) {
                          return (
                            <button
                              key={doc.relativePath}
                              type="button"
                              draggable
                              onDragStart={(event) => onDocumentDragStart(event, doc)}
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={() => selectPreviewDoc(doc)}
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
                        }

                        return (
                          <div
                            key={doc.relativePath}
                            className={[
                              "flex items-start gap-2 px-3 py-3 hover:bg-muted/40 transition-colors",
                              active ? "bg-blue-50/70" : "",
                            ].join(" ")}
                          >
                            {canManageLink && linkMode && (
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => toggleFileSelection(doc.relativePath, event.target.checked)}
                                onClick={(event) => event.stopPropagation()}
                                className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-zinc-300"
                              />
                            )}
                            <button
                              type="button"
                              draggable
                              onDragStart={(event) => onDocumentDragStart(event, doc)}
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={() => selectPreviewDoc(doc)}
                              className="flex min-w-0 flex-1 items-start gap-2 text-left cursor-grab active:cursor-grabbing"
                              title="点击预览，拖入 AI 助手资料区"
                            >
                              <GripVertical className="h-4 w-4 text-zinc-300 shrink-0 mt-0.5" />
                              <FileText className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <div className="text-sm font-medium truncate" title={doc.name}>
                                    {doc.name}
                                  </div>
                                  {linkMode && fileStatusBadge(doc.relativePath)}
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                  {formatFileSize(doc.size)}
                                  {doc.updatedAt ? ` · ${formatDate(doc.updatedAt)}` : ""}
                                </div>
                              </div>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col bg-zinc-50">
                  {editingDoc ? (
                    <DdMaterialsFileEditor
                      document={editingDoc}
                      onClose={() => setEditingDoc(null)}
                      onSaved={() => {
                        setPreviewRevision((current) => current + 1)
                        setEditingDoc(null)
                      }}
                    />
                  ) : previewDoc ? (
                    <>
                      <div className="px-4 py-2 border-b bg-white text-xs text-muted-foreground truncate shrink-0">
                        {previewDoc.name}
                      </div>
                      {shouldUseIframePreview(previewDoc) ? (
                        <iframe
                          key={`${previewDoc.relativePath}-${previewRevision}`}
                          src={previewSrc(previewDoc, previewRevision)}
                          title={previewDoc.name}
                          className="flex-1 w-full min-h-0 border-0 bg-white"
                        />
                      ) : IMAGE_PREVIEW_EXTENSIONS.has(previewDoc.extension.toLowerCase()) ? (
                        <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center bg-zinc-100 p-4">
                          <img
                            src={previewSrc(previewDoc, previewRevision)}
                            alt={previewDoc.name}
                            className="max-h-full max-w-full object-contain"
                          />
                        </div>
                      ) : (
                        <iframe
                          key={`${previewDoc.relativePath}-${previewRevision}`}
                          src={previewSrc(previewDoc, previewRevision)}
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

  const picker =
    canManageLink && onManualLink
      ? (
          <DdMaterialsLinkPickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            initialPath={folderPath}
            currentFolderPath={folderPath}
            rowLinkStatus={linkStatus}
            fileLinks={fileLinks}
            onConfirm={(kbPath) => {
              onManualLink(kbPath)
              if (!open) openPanel()
            }}
          />
        )
      : null

  if (isActive) {
    return (
      <>
        <div className="flex items-center gap-0.5" style={{ width: width - 4 }}>
          <input
            type="text"
            data-cell={cellId}
            value={value}
            style={{ ...style, width: canManageLink ? width - 22 : width - 4 }}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onActivate}
            className={baseClass}
          />
          {canManageLink && (
            <button
              type="button"
              title="管理尽调资料关联"
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                openPanel()
              }}
              className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-blue-600"
            >
              <FolderInput className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {panel}
        {picker}
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
        {picker}
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
      <div className="flex items-center gap-0.5" style={{ width: width - 4 }}>
        <input
          type="text"
          data-cell={cellId}
          value={value}
          style={{ ...style, width: canManageLink ? width - 22 : width - 4 }}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onActivate}
          className={baseClass}
        />
        {canManageLink && (
          <button
            type="button"
            title="手动关联尽调资料"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openManualPicker(event)
            }}
            className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-blue-600"
          >
            <FolderInput className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {panel}
      {picker}
    </>
  )
}
