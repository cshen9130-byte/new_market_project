"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Replace, X } from "lucide-react"
import type { DdMaterialsDocument } from "@/lib/ma/due-diligence-materials"
import { buildDdMaterialsEditableTextUrl } from "@/lib/ma/due-diligence-materials"
import { authService } from "@/lib/auth"

function getAuthHeaders(): Record<string, string> | undefined {
  const user = authService.getCurrentUser()
  if (!user?.id) return undefined
  return { "x-market-user-id": user.id }
}

export function DdMaterialsFileEditor({
  document,
  onClose,
  onSaved,
}: {
  document: DdMaterialsDocument
  onClose: () => void
  onSaved: () => void
}) {
  const [content, setContent] = useState("")
  const [initialContent, setInitialContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [findText, setFindText] = useState("")
  const [replaceText, setReplaceText] = useState("")
  const [matchCase, setMatchCase] = useState(false)
  const [replaceMessage, setReplaceMessage] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)

  const dirty = content !== initialContent

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent("")
    setInitialContent("")

    void (async () => {
      try {
        const res = await fetch(buildDdMaterialsEditableTextUrl(document.relativePath), { cache: "no-store" })
        const text = await res.text()
        if (!res.ok) throw new Error(text || res.statusText)
        if (cancelled) return
        setContent(text)
        setInitialContent(text)
      } catch (loadError: unknown) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [document.relativePath])

  useEffect(() => {
    if (replaceOpen) {
      const timer = window.setTimeout(() => findInputRef.current?.focus(), 0)
      return () => window.clearTimeout(timer)
    }
  }, [replaceOpen])

  const replaceInContent = useCallback(
    (replaceAll: boolean) => {
      if (!findText) {
        setReplaceMessage("请输入要查找的内容")
        return
      }

      const source = matchCase ? content : content.toLowerCase()
      const needle = matchCase ? findText : findText.toLowerCase()
      if (!needle) {
        setReplaceMessage("请输入要查找的内容")
        return
      }

      if (!replaceAll) {
        const index = source.indexOf(needle)
        if (index < 0) {
          setReplaceMessage("未找到匹配内容")
          return
        }
        const next = content.slice(0, index) + replaceText + content.slice(index + findText.length)
        setContent(next)
        setReplaceMessage("已替换 1 处")
        window.setTimeout(() => {
          textareaRef.current?.focus()
          textareaRef.current?.setSelectionRange(index, index + replaceText.length)
        }, 0)
        return
      }

      let count = 0
      let cursor = 0
      let next = content
      while (cursor <= next.length) {
        const slice = matchCase ? next.slice(cursor) : next.slice(cursor).toLowerCase()
        const hit = slice.indexOf(needle)
        if (hit < 0) break
        const start = cursor + hit
        next = next.slice(0, start) + replaceText + next.slice(start + findText.length)
        cursor = start + replaceText.length
        count += 1
      }

      if (count === 0) {
        setReplaceMessage("未找到匹配内容")
        return
      }

      setContent(next)
      setReplaceMessage(`已替换 ${count} 处`)
    },
    [content, findText, matchCase, replaceText],
  )

  const handleSave = useCallback(async () => {
    if (saving || loading) return
    setSaving(true)
    setError(null)
    try {
      const headers = getAuthHeaders()
      if (!headers) throw new Error("请先登录后再保存")

      const res = await fetch("/api/knowledge-base/file", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          path: document.relativePath,
          content,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || res.statusText)

      setInitialContent(content)
      onSaved()
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }, [content, document.relativePath, loading, onSaved, saving])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "h" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        setReplaceOpen(true)
        setReplaceMessage(null)
      }
      if (event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        void handleSave()
      }
      if (event.key === "Escape" && replaceOpen) {
        event.preventDefault()
        setReplaceOpen(false)
        setReplaceMessage(null)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleSave, replaceOpen])

  function handleClose() {
    if (dirty && !window.confirm("有未保存的修改，确定退出编辑吗？")) return
    onClose()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{document.name}</div>
          <div className="text-[11px] text-muted-foreground">
            编辑模式 · Ctrl+H 查找替换 · Ctrl+S 保存
            {document.extension.toLowerCase() === ".docx" ? " · Word 文档将按纯文本保存" : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setReplaceOpen(true)
              setReplaceMessage(null)
            }}
            className="inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs hover:bg-muted transition-colors"
          >
            <Replace className="h-3.5 w-3.5" />
            查找替换
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading || !dirty}
            className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            保存
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs hover:bg-muted transition-colors"
          >
            退出编辑
          </button>
        </div>
      </div>

      {replaceOpen && (
        <div className="shrink-0 border-b bg-zinc-50 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-foreground">查找和替换</div>
            <button
              type="button"
              onClick={() => {
                setReplaceOpen(false)
                setReplaceMessage(null)
              }}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="关闭查找替换"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">查找</span>
              <input
                ref={findInputRef}
                value={findText}
                onChange={(event) => setFindText(event.target.value)}
                className="rounded border bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400"
                placeholder="输入要查找的文字"
              />
            </label>
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">替换为</span>
              <input
                value={replaceText}
                onChange={(event) => setReplaceText(event.target.value)}
                className="rounded border bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400"
                placeholder="输入替换后的文字"
              />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(event) => setMatchCase(event.target.checked)}
              />
              区分大小写
            </label>
            <button
              type="button"
              onClick={() => replaceInContent(false)}
              className="rounded border bg-white px-2.5 py-1 text-xs hover:bg-muted transition-colors"
            >
              替换
            </button>
            <button
              type="button"
              onClick={() => replaceInContent(true)}
              className="rounded border bg-white px-2.5 py-1 text-xs hover:bg-muted transition-colors"
            >
              全部替换
            </button>
            {replaceMessage ? <span className="text-xs text-muted-foreground">{replaceMessage}</span> : null}
          </div>
        </div>
      )}

      {error ? <div className="shrink-0 border-b bg-red-50 px-4 py-2 text-xs text-red-600">{error}</div> : null}

      <div className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载文件内容…
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="absolute inset-0 h-full w-full resize-none border-0 bg-white px-4 py-3 font-mono text-sm leading-6 text-foreground outline-none"
            spellCheck={false}
          />
        )}
      </div>
    </div>
  )
}
