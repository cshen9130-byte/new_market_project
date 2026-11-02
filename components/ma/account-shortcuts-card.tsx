"use client"

import { useEffect, useState } from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { User } from "@/lib/auth"
import {
  REALTIME_QUOTES_HREF,
  SHORTCUT_CAPTURE_ATTR,
  createAccountShortcutId,
  formatShortcutCombo,
  isReservedShortcutCombo,
  shortcutComboFromEvent,
  type AccountShortcut,
} from "@/lib/ma/account-shortcuts"
import { listAccessibleChatPages, type ChatSitePage } from "@/lib/ma/chat-site-map"
import { cn } from "@/lib/utils"

const FIELD_CLASS =
  "border-input h-9 min-w-0 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"

function pagesFor(user: User | null): ChatSitePage[] {
  const seen = new Set<string>()
  const pages: ChatSitePage[] = []
  for (const page of listAccessibleChatPages(user)) {
    if (seen.has(page.href)) continue
    seen.add(page.href)
    pages.push(page)
  }
  return pages
}

function groupsFor(pages: ChatSitePage[]): Array<{ group: string; pages: ChatSitePage[] }> {
  const groups: Array<{ group: string; pages: ChatSitePage[] }> = []
  for (const page of pages) {
    const group = page.trail.split(" → ")[0] || "页面"
    const found = groups.find((item) => item.group === group)
    if (found) found.pages.push(page)
    else groups.push({ group, pages: [page] })
  }
  return groups
}

export function AccountShortcutsCard({
  user,
  shortcuts,
  onChange,
}: {
  user: User | null
  shortcuts: AccountShortcut[]
  onChange: (next: AccountShortcut[]) => void
}) {
  const [capturingId, setCapturingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const pages = pagesFor(user)
  const groups = groupsFor(pages)
  const realtime = pages.find((page) => page.href === REALTIME_QUOTES_HREF) ?? pages[0]

  useEffect(() => {
    if (!capturingId) return
    document.documentElement.setAttribute(SHORTCUT_CAPTURE_ATTR, "1")
    function onKey(event: KeyboardEvent) {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === "Escape") {
        setCapturingId(null)
        setMessage(null)
        return
      }
      const combo = shortcutComboFromEvent(event)
      if (!combo) {
        if (event.key !== "Control" && event.key !== "Alt" && event.key !== "Shift" && event.key !== "Meta") {
          const attempt = [event.ctrlKey || event.metaKey ? "ctrl" : "", event.altKey ? "alt" : "", event.shiftKey ? "shift" : "", event.key]
            .filter(Boolean)
            .join("+")
            .toLowerCase()
          setMessage(isReservedShortcutCombo(attempt) ? "这个组合留给浏览器，请换一个。" : "请使用 Ctrl 或 Alt 加上一个字母、数字或功能键。")
        }
        return
      }
      if (shortcuts.some((item) => item.id !== capturingId && item.combo === combo)) {
        setMessage(`${formatShortcutCombo(combo)} 已经用于别的页面。`)
        return
      }
      if (capturingId === "__new__") {
        const page = realtime
        if (!page) return
        onChange([
          ...shortcuts,
          {
            id: createAccountShortcutId(),
            combo,
            href: page.href,
            label: page.title,
            newTab: true,
          },
        ])
      } else {
        onChange(shortcuts.map((item) => (item.id === capturingId ? { ...item, combo } : item)))
      }
      setCapturingId(null)
      setMessage(`${formatShortcutCombo(combo)} 已设置。`)
    }
    window.addEventListener("keydown", onKey, true)
    return () => {
      document.documentElement.removeAttribute(SHORTCUT_CAPTURE_ATTR)
      window.removeEventListener("keydown", onKey, true)
    }
  }, [capturingId, onChange, realtime, shortcuts])

  function setHref(id: string, href: string) {
    const page = pages.find((item) => item.href === href)
    onChange(
      shortcuts.map((item) =>
        item.id === id ? { ...item, href, label: page?.title || item.label } : item,
      ),
    )
  }

  return (
    <section className="space-y-4 rounded-lg border p-5">
      <div>
        <h2 className="text-sm font-semibold">快捷键</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          在任意页面按下快捷键，打开对应页面。默认 Ctrl + Alt + T 在新标签打开专业交易模式。快捷键保存在这个账号上，换一台电脑登录后仍然有效。
        </p>
      </div>

      {shortcuts.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有快捷键。</p>
      ) : (
        <ul className="space-y-2">
          {shortcuts.map((shortcut) => {
            const known = pages.some((page) => page.href === shortcut.href)
            return (
              <li key={shortcut.id} className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={cn(
                    "h-9 min-w-28 rounded-md border px-3 text-left font-mono text-sm",
                    capturingId === shortcut.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                  onClick={() => {
                    setMessage(null)
                    setCapturingId(shortcut.id)
                  }}
                >
                  {capturingId === shortcut.id ? "请按键…" : formatShortcutCombo(shortcut.combo)}
                </button>
                <select
                  aria-label={`${shortcut.label} 打开的页面`}
                  className={cn(FIELD_CLASS, "w-full flex-1 sm:w-auto")}
                  value={shortcut.href}
                  onChange={(event) => setHref(shortcut.id, event.target.value)}
                >
                  {!known && <option value={shortcut.href}>{shortcut.label}</option>}
                  {groups.map((group) => (
                    <optgroup key={group.group} label={group.group}>
                      {group.pages.map((page) => (
                        <option key={page.id} value={page.href}>
                          {page.title}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={shortcut.newTab}
                    onCheckedChange={(checked) =>
                      onChange(shortcuts.map((item) => (item.id === shortcut.id ? { ...item, newTab: checked } : item)))
                    }
                    aria-label={`${shortcut.label} 在新标签打开`}
                  />
                  新标签页
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="删除"
                  onClick={() => onChange(shortcuts.filter((item) => item.id !== shortcut.id))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant={capturingId === "__new__" ? "default" : "outline"}
          onClick={() => {
            setMessage(null)
            setCapturingId("__new__")
          }}
          disabled={!realtime || shortcuts.length >= 20}
        >
          <Plus className="h-4 w-4" />
          {capturingId === "__new__" ? "请按键…" : "添加快捷键"}
        </Button>
        {capturingId && <span className="text-xs text-muted-foreground">按下组合键，Esc 取消。</span>}
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
    </section>
  )
}
