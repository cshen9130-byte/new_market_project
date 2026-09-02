"use client"

import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type RefObject } from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Archive,
  Bold,
  ChevronDown,
  FileText,
  FolderOpen,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Paperclip,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Trash2,
  Type,
  Underline,
  Undo2,
  Upload,
  Video,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useToast } from "@/hooks/use-toast"
import { compactRichNoteHtml, type InvestmentNoteAttachment } from "@/lib/ma/investment-notes"

function isWordFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    name.endsWith(".docx") ||
    name.endsWith(".doc") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.type === "application/msword"
  )
}

function isDocxFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    name.endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function plainTextToEditorHtml(text: string): string {
  if (!text) return ""
  if (/<[a-z][\s\S]*>/i.test(text)) return text
  return text
    .split("\n")
    .map((line) => `<div>${line ? escapeHtml(line) : "<br>"}</div>`)
    .join("")
}

export function RichTextToolbar({
  editorRef,
  onUploadAttachment,
}: {
  editorRef: RefObject<HTMLDivElement | null>
  onUploadAttachment?: () => void
}) {
  const [, setRefreshToken] = useState(0)

  function exec(command: string, value?: string) {
    editorRef.current?.focus()
    document.execCommand(command, false, value)
    setRefreshToken((n) => n + 1)
  }

  function isActive(command: string): boolean {
    try {
      return document.queryCommandState(command)
    } catch {
      return false
    }
  }

  const btnClass = (active?: boolean) =>
    [
      "rounded p-1.5 transition-colors",
      active ? "bg-white text-red-500 shadow-sm" : "text-zinc-500 hover:bg-white hover:text-zinc-700",
    ].join(" ")

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5">
      <select
        className="mr-1 h-7 rounded border border-zinc-200 bg-white px-2 text-xs text-zinc-600"
        defaultValue="p"
        onChange={(e) => exec("formatBlock", e.target.value)}
      >
        <option value="p">正文</option>
        <option value="blockquote">引用</option>
        <option value="h2">标题</option>
      </select>
      <button type="button" className={btnClass()} onClick={() => exec("formatBlock", "p")} aria-label="正文">
        <Type className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass()} onClick={() => exec("formatBlock", "blockquote")} aria-label="引用">
        <Quote className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass(isActive("bold"))} onClick={() => exec("bold")} aria-label="加粗">
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass(isActive("underline"))} onClick={() => exec("underline")} aria-label="下划线">
        <Underline className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass(isActive("italic"))} onClick={() => exec("italic")} aria-label="斜体">
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass(isActive("strikeThrough"))} onClick={() => exec("strikeThrough")} aria-label="删除线">
        <Strikethrough className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass()} onClick={() => exec("foreColor", "#dc2626")} aria-label="文字颜色">
        <Type className="h-3.5 w-3.5 text-red-500" />
      </button>
      <button type="button" className={btnClass()} onClick={() => exec("fontSize", "4")} aria-label="字号">
        <span className="inline-flex items-center text-xs font-medium">
          T
          <ChevronDown className="h-3 w-3" />
        </span>
      </button>
      <button type="button" className={btnClass(isActive("insertUnorderedList"))} onClick={() => exec("insertUnorderedList")} aria-label="无序列表">
        <List className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass(isActive("insertOrderedList"))} onClick={() => exec("insertOrderedList")} aria-label="有序列表">
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass(isActive("justifyLeft"))} onClick={() => exec("justifyLeft")} aria-label="左对齐">
        <AlignLeft className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass(isActive("justifyCenter"))} onClick={() => exec("justifyCenter")} aria-label="居中">
        <AlignCenter className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass(isActive("justifyRight"))} onClick={() => exec("justifyRight")} aria-label="右对齐">
        <AlignRight className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={btnClass()}
        onClick={() => {
          const url = window.prompt("请输入链接地址")
          if (url) exec("createLink", url)
        }}
        aria-label="链接"
      >
        <Link2 className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass()} onClick={onUploadAttachment} aria-label="上传附件">
        <FolderOpen className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass()} onClick={() => exec("insertHorizontalRule")} aria-label="视频">
        <Video className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={btnClass()}
        onClick={() => {
          editorRef.current?.focus()
          document.execCommand(
            "insertHTML",
            false,
            "<table><tbody><tr><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table><p><br></p>",
          )
          setRefreshToken((n) => n + 1)
        }}
        aria-label="表格"
      >
        <Table2 className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass()} onClick={() => exec("undo")} aria-label="撤销">
        <Undo2 className="h-3.5 w-3.5" />
      </button>
      <button type="button" className={btnClass()} onClick={() => exec("redo")} aria-label="重做">
        <Redo2 className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={btnClass()}
        onClick={() => editorRef.current?.requestFullscreen?.()}
        aria-label="全屏"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function NoteRichTextEditor({
  value,
  onChange,
  onUploadAttachment,
}: {
  value: string
  onChange: (value: string) => void
  onUploadAttachment: () => void
}) {
  const { toast } = useToast()
  const editorRef = useRef<HTMLDivElement>(null)
  const wordInputRef = useRef<HTMLInputElement>(null)
  const lastExternalValue = useRef(value)
  const [importingWord, setImportingWord] = useState(false)
  const [wordDragOver, setWordDragOver] = useState(false)

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (lastExternalValue.current === value) return
    el.innerHTML = plainTextToEditorHtml(value)
    lastExternalValue.current = value
  }, [value])

  useEffect(() => {
    const el = editorRef.current
    if (!el || el.innerHTML) return
    el.innerHTML = plainTextToEditorHtml(value)
    lastExternalValue.current = value
  }, [])

  function syncContent() {
    const html = editorRef.current?.innerHTML ?? ""
    lastExternalValue.current = html
    onChange(html)
  }

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    const html = e.clipboardData.getData("text/html")
    if (!html) return

    e.preventDefault()
    const cleaned = compactRichNoteHtml(html)
    document.execCommand("insertHTML", false, cleaned)
    syncContent()
  }

  async function importWordFile(file: File) {
    if (!isWordFile(file)) {
      toast({
        title: "导入失败",
        description: "请拖入或选择 Word 文件（.docx）",
        variant: "destructive",
      })
      return
    }
    if (!isDocxFile(file)) {
      toast({
        title: "导入失败",
        description: "暂不支持旧版 .doc，请先另存为 .docx 后再导入",
        variant: "destructive",
      })
      return
    }

    setImportingWord(true)
    try {
      const form = new FormData()
      form.append("file", file)

      let userId = ""
      try {
        const raw = localStorage.getItem("currentUser")
        if (raw) userId = String((JSON.parse(raw) as { id?: string }).id || "").trim()
      } catch {
        userId = ""
      }

      const res = await fetch("/ma/api/investment-notes/import-word", {
        method: "POST",
        headers: userId ? { "x-market-user-id": userId } : {},
        body: form,
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        html?: string
        fileName?: string
        error?: string
      }
      if (!res.ok || !data.ok || !data.html) {
        throw new Error(data.error || res.statusText || "导入失败")
      }

      const cleaned = compactRichNoteHtml(data.html)
      const el = editorRef.current
      if (!el) return
      el.innerHTML = cleaned
      lastExternalValue.current = cleaned
      onChange(cleaned)
      toast({ title: "Word 导入成功", description: data.fileName || file.name })
    } catch (e: unknown) {
      toast({
        title: "导入失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setImportingWord(false)
      setWordDragOver(false)
    }
  }

  function handleWordDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault()
    e.stopPropagation()
    setWordDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void importWordFile(file)
  }

  function handleWordDragOver(e: DragEvent<HTMLElement>) {
    if (![...e.dataTransfer.types].includes("Files")) return
    e.preventDefault()
    e.stopPropagation()
    if (!wordDragOver) setWordDragOver(true)
  }

  function handleWordDragLeave(e: DragEvent<HTMLElement>) {
    e.preventDefault()
    e.stopPropagation()
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    setWordDragOver(false)
  }

  return (
    <div className="flex h-full flex-col">
      <input
        ref={wordInputRef}
        type="file"
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importWordFile(file)
          e.target.value = ""
        }}
      />
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2">
        <button
          type="button"
          disabled={importingWord}
          onClick={() => wordInputRef.current?.click()}
          onDragEnter={handleWordDragOver}
          onDragOver={handleWordDragOver}
          onDragLeave={handleWordDragLeave}
          onDrop={handleWordDrop}
          className={[
            "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            wordDragOver
              ? "border-red-400 bg-red-50 text-red-600"
              : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-red-300 hover:bg-red-50 hover:text-red-600",
          ].join(" ")}
        >
          <FileText className="h-3.5 w-3.5" />
          {importingWord ? "导入中..." : wordDragOver ? "松开以导入 Word" : "导入 Word"}
        </button>
        <span className="text-xs text-zinc-400">点击选择，或将 .docx 拖到此按钮</span>
      </div>
      <RichTextToolbar editorRef={editorRef} onUploadAttachment={onUploadAttachment} />
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onDragEnter={handleWordDragOver}
        onDragOver={handleWordDragOver}
        onDragLeave={handleWordDragLeave}
        onDrop={handleWordDrop}
      >
        {wordDragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-red-400 bg-red-50/80">
            <div className="rounded bg-white px-4 py-2 text-sm text-red-600 shadow-sm">
              松开以导入 Word 文件
            </div>
          </div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={syncContent}
          onPaste={handlePaste}
          data-placeholder="请输入内容..."
          className="investment-note-rich min-h-[420px] flex-1 w-full overflow-auto border-0 px-6 py-4 text-sm leading-7 text-zinc-700 focus:outline-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)]"
        />
      </div>
    </div>
  )
}

export type NoteAttachmentListItem = InvestmentNoteAttachment & {
  /** Real file from「上传资料」or linked 尽调材料 that can be opened */
  openable?: boolean
  /** When false, the row has no delete control. Defaults to removable. */
  removable?: boolean
  sourceLabel?: string
}

export function NoteAttachmentPopover({
  attachments,
  onTriggerUpload,
  onRemove,
  onOpen,
  onDropFiles,
  onDownloadZip,
  uploading,
  zipping,
}: {
  attachments: NoteAttachmentListItem[]
  onTriggerUpload: () => void
  onRemove: (id: string) => void
  onOpen?: (id: string) => void
  onDropFiles?: (files: FileList) => void
  onDownloadZip?: () => void
  uploading?: boolean
  zipping?: boolean
}) {
  const [dragOver, setDragOver] = useState(false)
  const dragDepthRef = useRef(0)

  function hasDraggedFiles(e: DragEvent<HTMLElement>): boolean {
    return [...e.dataTransfer.types].includes("Files")
  }

  function handleDragEnter(e: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    if (!dragOver) setDragOver(true)
  }

  function handleDragOver(e: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = "copy"
  }

  function handleDragLeave(e: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragOver(false)
  }

  function handleDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setDragOver(false)
    if (uploading) return
    const files = e.dataTransfer.files
    if (files && files.length > 0) onDropFiles?.(files)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-sm text-sky-600 hover:bg-sky-100 transition-colors"
        >
          <Paperclip className="h-3.5 w-3.5" />
          {attachments.length}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-96 overflow-hidden p-0"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <span className="shrink-0 text-sm font-medium text-sky-600">附件列表</span>
          <div className="flex min-w-0 items-center gap-3">
            {onDownloadZip && attachments.some((file) => file.openable) ? (
              <button
                type="button"
                onClick={onDownloadZip}
                disabled={zipping || uploading}
                className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Archive className="h-3.5 w-3.5" />
                {zipping ? "打包中..." : "打包下载"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onTriggerUpload}
              disabled={uploading || zipping}
              className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? "上传中..." : dragOver ? "松开以上传" : "上传附件"}
            </button>
          </div>
        </div>
        <div
          className={[
            "relative min-h-[140px] transition-colors",
            dragOver ? "bg-sky-50" : "",
          ].join(" ")}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-sky-400 bg-sky-50/90">
              <span className="text-sm text-sky-600">松开以上传附件</span>
            </div>
          )}
          {attachments.length === 0 ? (
            <button
              type="button"
              onClick={onTriggerUpload}
              disabled={uploading}
              className="m-3 flex w-[calc(100%-1.5rem)] flex-col items-center justify-center rounded-md border border-dashed border-zinc-200 px-4 py-10 text-zinc-400 hover:border-sky-300 hover:bg-sky-50/50 disabled:cursor-not-allowed"
            >
              <FolderOpen className="mb-2 h-10 w-10 text-zinc-300" strokeWidth={1} />
              <span className="text-sm">{uploading ? "上传中..." : "暂无附件"}</span>
              <span className="mt-1 text-xs text-zinc-300">拖拽文件到此处，或点击上传</span>
            </button>
          ) : (
            <div className="max-h-56 overflow-y-auto overflow-x-hidden px-2 py-2">
              {attachments.map((file) => {
                const removable = file.removable !== false
                return (
                  <div
                    key={file.id}
                    className="flex items-center gap-1 rounded px-2 py-2 hover:bg-zinc-50"
                  >
                    <div className="min-w-0 flex-1 overflow-hidden">
                      {file.openable && onOpen ? (
                        <button
                          type="button"
                          onClick={() => onOpen(file.id)}
                          className="block w-full truncate text-left text-sm text-sky-600 hover:underline"
                          title={file.name}
                        >
                          {file.name}
                        </button>
                      ) : (
                        <div className="truncate text-sm text-zinc-700" title={file.name}>
                          {file.name}
                        </div>
                      )}
                      <div className="truncate text-xs text-zinc-400">
                        {file.sourceLabel ? `${file.sourceLabel} · ` : ""}
                        {formatFileSize(file.size)}
                      </div>
                    </div>
                    {removable ? (
                      <button
                        type="button"
                        onClick={() => onRemove(file.id)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-500"
                        aria-label={`删除 ${file.name}`}
                        title="删除附件"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function filesToAttachments(files: FileList): InvestmentNoteAttachment[] {
  return Array.from(files).map((file) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    size: file.size,
  }))
}

export function isRichHtmlContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content)
}
