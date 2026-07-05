"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileText, Loader2, Plus, RotateCcw, Trash2, Upload, ZoomIn, ZoomOut } from "lucide-react"
import {
  buildKbDocumentPreviewUrl,
  canPreviewChatDocument,
  CHAT_DOC_LIST_WIDTH,
  CHAT_DOC_READER_MAX_WIDTH,
  CHAT_DOC_READER_MIN_WIDTH,
  getFileExtension,
  type MaChatDocumentItem,
} from "@/lib/ma/chat-documents"
import { cn } from "@/lib/utils"

const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10

export function ChatBotDocPanel({
  documents,
  activeDocId,
  readerWidth,
  onReaderWidthChange,
  onActiveDocChange,
  onAddLocalFiles,
  onDataTransfer,
  onRemoveDocument,
}: {
  documents: MaChatDocumentItem[]
  activeDocId: string | null
  readerWidth: number
  onReaderWidthChange: (width: number) => void
  onActiveDocChange: (id: string | null) => void
  onAddLocalFiles: (files: FileList | File[]) => void
  onDataTransfer: (dataTransfer: DataTransfer) => boolean
  onRemoveDocument: (id: string) => void
}) {
  const [previewZoom, setPreviewZoom] = useState(100)
  const activeDoc = documents.find((d) => d.id === activeDocId) ?? null

  useEffect(() => {
    setPreviewZoom(100)
  }, [activeDocId])

  function previewSrc(doc: MaChatDocumentItem): string | null {
    if (doc.source === "kb" && doc.relativePath) {
      return buildKbDocumentPreviewUrl(doc.relativePath, doc.canPreview)
    }
    if (doc.source === "local" && doc.objectUrl) return doc.objectUrl
    return null
  }

  function shouldUseIframePreview(doc: MaChatDocumentItem): boolean {
    const src = previewSrc(doc)
    if (!src || !canPreviewChatDocument(doc.name, doc.canPreview)) return false
    if (doc.source === "kb") {
      const ext = doc.extension.toLowerCase() || getFileExtension(doc.name)
      if ([".pdf", ".html", ".htm"].includes(ext)) return true
    }
    if (doc.source === "local") {
      const ext = doc.extension.toLowerCase()
      if ([".doc", ".docx", ".xls", ".xlsx", ".txt", ".md", ".markdown", ".csv", ".json", ".log"].includes(ext)) {
        return false
      }
    }
    return true
  }

  const canIframePreview = activeDoc && shouldUseIframePreview(activeDoc)
  const hasPreviewContent = Boolean(canIframePreview || activeDoc?.textContent)

  const clampReaderWidth = useCallback(
    (width: number) => Math.max(CHAT_DOC_READER_MIN_WIDTH, Math.min(CHAT_DOC_READER_MAX_WIDTH, width)),
    [],
  )

  const onReaderResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      const startX = e.clientX
      const startW = readerWidth

      const onMove = (ev: PointerEvent) => {
        onReaderWidthChange(clampReaderWidth(startW + (ev.clientX - startX)))
      }
      const onUp = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [clampReaderWidth, onReaderWidthChange, readerWidth],
  )

  function zoomIn() {
    setPreviewZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))
  }

  function zoomOut() {
    setPreviewZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))
  }

  return (
    <div
      className="relative flex min-h-0 shrink-0 border-r bg-muted/10"
      style={{ width: CHAT_DOC_LIST_WIDTH + readerWidth }}
    >
      {/* File list column */}
      <div
        className="flex shrink-0 flex-col border-r bg-muted/20"
        style={{ width: CHAT_DOC_LIST_WIDTH }}
      >
        <DropZone
          compact
          onDataTransfer={onDataTransfer}
          onAddLocalFiles={onAddLocalFiles}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {documents.length === 0 ? (
            <p className="px-1 py-4 text-center text-[10px] leading-snug text-muted-foreground">
              拖入文件或从尽调资料弹窗拖入
            </p>
          ) : (
            <div className="space-y-0.5">
              {documents.map((doc) => {
                const active = doc.id === activeDocId
                return (
                  <div
                    key={doc.id}
                    className={cn(
                      "group flex items-start gap-0.5 rounded-md border px-1.5 py-1.5 transition-colors",
                      active ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted/50",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onActiveDocChange(doc.id)}
                      title={doc.name}
                    >
                      <div className="flex items-start gap-1">
                        <FileText className="mt-0.5 h-3 w-3 shrink-0 text-red-500" />
                        <div className="min-w-0">
                          <div className="line-clamp-2 text-[10px] font-medium leading-snug">{doc.name}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-0.5 text-[9px] text-muted-foreground">
                            {doc.source === "kb" ? "库" : "本地"}
                            {doc.textLoading && <Loader2 className="h-2 w-2 animate-spin" />}
                            {!doc.textLoading && doc.textContent && (
                              <span className="text-emerald-600">可问</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      onClick={() => onRemoveDocument(doc.id)}
                      title="移除"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Full-height reader column */}
      <div
        className="relative flex min-w-0 flex-col bg-background"
        style={{ width: readerWidth }}
      >
        {activeDoc ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={activeDoc.name}>
                {activeDoc.name}
              </span>
              {hasPreviewContent && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    onClick={zoomOut}
                    disabled={previewZoom <= ZOOM_MIN}
                    title="缩小"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <span className="w-9 text-center text-[10px] tabular-nums text-muted-foreground">
                    {previewZoom}%
                  </span>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    onClick={zoomIn}
                    disabled={previewZoom >= ZOOM_MAX}
                    title="放大"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    onClick={() => setPreviewZoom(100)}
                    disabled={previewZoom === 100}
                    title="重置缩放"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div className="relative min-h-0 flex-1">
              {canIframePreview ? (
                <div className="absolute inset-0 overflow-auto bg-zinc-100">
                  <div
                    className="min-h-full min-w-full origin-top-left bg-white"
                    style={{ zoom: previewZoom / 100 }}
                  >
                    <iframe
                      key={activeDoc.id}
                      src={previewSrc(activeDoc)!}
                      title={activeDoc.name}
                      className="block h-full min-h-[100%] w-full min-w-full border-0 bg-white"
                    />
                  </div>
                </div>
              ) : activeDoc.textLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在读取文档…
                </div>
              ) : activeDoc.textContent ? (
                <div className="absolute inset-0 overflow-auto bg-background p-4">
                  <pre
                    className="whitespace-pre-wrap text-left leading-relaxed text-foreground origin-top-left"
                    style={{ fontSize: `${12 * (previewZoom / 100)}px` }}
                  >
                    {activeDoc.textContent}
                  </pre>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  {activeDoc.textError || "该文件暂不支持内嵌预览"}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
            <FileText className="h-8 w-8 opacity-30" />
            <p>点击左侧文件开始阅读</p>
            <p className="text-[10px]">阅读时可同时在右侧向 AI 提问</p>
          </div>
        )}

        {/* Drag handle — right edge of reader column */}
        <div
          className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-primary/20 active:bg-primary/30"
          onPointerDown={onReaderResizePointerDown}
          title="拖拽调整阅读区宽度"
        />
      </div>
    </div>
  )
}

function DropZone({
  compact,
  onDataTransfer,
  onAddLocalFiles,
}: {
  compact?: boolean
  onDataTransfer: (dataTransfer: DataTransfer) => boolean
  onAddLocalFiles: (files: FileList | File[]) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (compact) {
    return (
      <div
        className={cn(
          "mx-1.5 mt-1.5 flex items-center justify-center gap-1 rounded-md border border-dashed px-2 py-2 text-center transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25",
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          onDataTransfer(e.dataTransfer)
        }}
      >
        <Upload className="h-3 w-3 shrink-0 text-muted-foreground" />
        <button
          type="button"
          className="flex items-center gap-0.5 text-[10px] text-primary hover:underline"
          onClick={() => fileInputRef.current?.click()}
        >
          <Plus className="h-3 w-3" />
          添加
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files
            if (files?.length) onAddLocalFiles(files)
            e.target.value = ""
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "mx-2 mt-2 flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-3 py-4 text-center transition-colors",
        dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/40",
      )}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        onDataTransfer(e.dataTransfer)
      }}
    >
      <Upload className="mb-1.5 h-4 w-4 text-muted-foreground" />
      <p className="text-[11px] leading-snug text-muted-foreground">
        拖入本地文件或尽调资料
      </p>
      <button
        type="button"
        className="mt-2 text-[11px] text-primary hover:underline"
        onClick={() => fileInputRef.current?.click()}
      >
        选择文件
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files
          if (files?.length) onAddLocalFiles(files)
          e.target.value = ""
        }}
      />
    </div>
  )
}
