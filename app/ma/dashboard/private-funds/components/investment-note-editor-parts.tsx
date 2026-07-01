"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
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
import type { InvestmentNoteAttachment } from "@/lib/ma/investment-notes"

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
        onClick={() => exec("insertTable", "2x2")}
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
  const editorRef = useRef<HTMLDivElement>(null)
  const lastExternalValue = useRef(value)

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

  return (
    <div className="flex h-full flex-col">
      <RichTextToolbar editorRef={editorRef} onUploadAttachment={onUploadAttachment} />
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={syncContent}
        data-placeholder="请输入内容..."
        className="min-h-[420px] flex-1 w-full overflow-auto border-0 px-6 py-4 text-sm leading-7 text-zinc-700 focus:outline-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  )
}

export function NoteAttachmentPopover({
  attachments,
  onTriggerUpload,
  onRemove,
}: {
  attachments: InvestmentNoteAttachment[]
  onTriggerUpload: () => void
  onRemove: (id: string) => void
}) {
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
      <PopoverContent align="end" className="w-72 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-medium text-sky-600">附件列表</span>
          <button
            type="button"
            onClick={onTriggerUpload}
            className="inline-flex items-center gap-1 text-sm text-sky-600 hover:text-sky-700"
          >
            <Upload className="h-3.5 w-3.5" />
            上传附件
          </button>
        </div>
          {attachments.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-zinc-400">
              <FolderOpen className="h-10 w-10 text-zinc-300 mb-2" strokeWidth={1} />
              <span className="text-sm">暂无附件</span>
            </div>
          ) : (
            <div className="max-h-56 overflow-auto px-2 py-2">
              {attachments.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between gap-2 rounded px-2 py-2 hover:bg-zinc-50"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-zinc-700">{file.name}</div>
                    <div className="text-xs text-zinc-400">{formatFileSize(file.size)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(file.id)}
                    className="shrink-0 rounded p-1 text-zinc-400 hover:text-red-500"
                    aria-label="删除附件"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
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
