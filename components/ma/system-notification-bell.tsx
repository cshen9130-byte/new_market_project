"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, Settings2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const NOTIFICATION_SETTINGS_HREF = "/ma/dashboard/account?tab=account&section=notifications"

type NotificationItem = {
  id: string
  title: string
  body: string
  href: string | null
  created_at: string
  read_at: string | null
}

function userHeaders(userId: string): HeadersInit {
  return { "x-market-user-id": userId }
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function SystemNotificationBell({ userId }: { userId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [inboxError, setInboxError] = useState("")

  const loadInbox = useCallback(async () => {
    const res = await fetch("/ma/api/notifications", {
      cache: "no-store",
      headers: userHeaders(userId),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "系统消息加载失败")
    setUnread(typeof json.unread === "number" ? json.unread : 0)
    setItems(Array.isArray(json.items) ? json.items : [])
    setInboxError("")
  }, [userId])

  useEffect(() => {
    let cancelled = false
    loadInbox().catch((error: unknown) => {
      if (!cancelled) setInboxError(error instanceof Error ? error.message : "系统消息加载失败")
    })
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      loadInbox().catch(() => {})
    }, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [loadInbox])

  async function markRead(id?: string) {
    const res = await fetch("/ma/api/notifications", {
      method: "POST",
      headers: { ...userHeaders(userId), "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : { all: true }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return
    const nextUnread = typeof json.unread === "number" ? json.unread : 0
    setUnread(nextUnread)
    const now = new Date().toISOString()
    setItems((prev) => prev.map((item) => {
      if (item.read_at) return item
      if (!id || item.id === id) return { ...item, read_at: now }
      return item
    }))
  }

  async function openItem(item: NotificationItem) {
    if (!item.read_at) await markRead(item.id)
    setOpen(false)
    if (item.href) router.push(item.href)
  }

  const badge = unread > 99 ? "99+" : String(unread)

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next)
      if (next) {
        loadInbox().catch((error: unknown) => {
          setInboxError(error instanceof Error ? error.message : "系统消息加载失败")
        })
      }
    }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          title={unread > 0 ? `${unread} 条未读系统消息` : "系统消息"}
          aria-label={unread > 0 ? `${unread} 条未读系统消息` : "系统消息"}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white">
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <div className="text-sm font-medium">系统消息</div>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <button
                type="button"
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { void markRead() }}
              >
                全部已读
              </button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="提醒设置"
              onClick={() => {
                setOpen(false)
                router.push(NOTIFICATION_SETTINGS_HREF)
              }}
            >
              <Settings2 className="h-3.5 w-3.5" />
              <span className="sr-only">提醒设置</span>
            </Button>
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto">
            {inboxError && <div className="px-3 py-3 text-xs text-red-600">{inboxError}</div>}
            {!inboxError && items.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">暂无系统消息</div>
            )}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full gap-2 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/60"
                onClick={() => { void openItem(item) }}
              >
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.read_at ? "bg-transparent" : "bg-red-500"}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{item.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.body}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">{formatWhen(item.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
      </PopoverContent>
    </Popover>
  )
}
