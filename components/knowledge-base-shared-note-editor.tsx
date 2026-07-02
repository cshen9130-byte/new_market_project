"use client"

import { type ClipboardEvent, type ChangeEvent, useRef } from "react"
import { ImageIcon, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

function insertTextAtCursor(textarea: HTMLTextAreaElement, content: string, insertText: string) {
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const prefix = content.slice(0, start)
  const suffix = content.slice(end)
  const needsLeadingBreak = prefix.length > 0 && !prefix.endsWith("\n")
  const needsTrailingBreak = suffix.length > 0 && !suffix.startsWith("\n")
  const snippet = `${needsLeadingBreak ? "\n\n" : ""}${insertText}${needsTrailingBreak ? "\n\n" : ""}`
  const nextContent = prefix + snippet + suffix
  const cursor = start + snippet.length
  return { nextContent, cursor }
}

type KnowledgeBaseSharedNoteEditorProps = {
  content: string
  onContentChange: (value: string) => void
  onUploadImage: (file: File) => Promise<string>
  disabled?: boolean
  loading?: boolean
  uploadingImage?: boolean
  className?: string
  textareaClassName?: string
  placeholder?: string
}

export function KnowledgeBaseSharedNoteEditor({
  content,
  onContentChange,
  onUploadImage,
  disabled = false,
  loading = false,
  uploadingImage = false,
  className,
  textareaClassName,
  placeholder = "笔记内容，支持 Markdown 格式…",
}: KnowledgeBaseSharedNoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const applyMarkdownInsert = async (file: File) => {
    const textarea = textareaRef.current
    if (!textarea || disabled || loading) return

    const markdown = await onUploadImage(file)
    const { nextContent, cursor } = insertTextAtCursor(textarea, content, markdown)
    onContentChange(nextContent)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.selectionStart = cursor
      textarea.selectionEnd = cursor
    })
  }

  const handlePickImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    try {
      await applyMarkdownInsert(file)
    } catch {
      // Parent handles error state.
    }
  }

  const handlePaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items
    if (!items || disabled || loading || uploadingImage) return

    for (const item of items) {
      if (!item.type.startsWith("image/")) continue
      const file = item.getAsFile()
      if (!file) continue
      event.preventDefault()
      try {
        await applyMarkdownInsert(file)
      } catch {
        // Parent handles error state.
      }
      return
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(event) => void handlePickImage(event)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || loading || uploadingImage}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadingImage ? (
            <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
          )}
          插入图片
        </Button>
        <span className="text-xs text-muted-foreground">在光标处插入，或直接粘贴截图</span>
      </div>
      <Textarea
        ref={textareaRef}
        value={content}
        onChange={(event) => onContentChange(event.target.value)}
        onPaste={(event) => void handlePaste(event)}
        placeholder={placeholder}
        disabled={disabled || loading}
        className={cn("min-h-0 flex-1 resize-none text-sm leading-6", textareaClassName)}
      />
    </div>
  )
}
