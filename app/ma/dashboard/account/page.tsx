"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { ChevronDown, ChevronRight, ChevronUp, Folder, FolderOpen, GripVertical, Plus, Search, X } from "lucide-react"

import { AccountAvatarCard } from "@/components/ma/account-avatar-card"
import { AccountChartSlot } from "@/components/ma/account-chart-slot"
import { UserAvatar } from "@/components/ma/user-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { authService, type User } from "@/lib/auth"
import {
  ACCOUNT_PROFILE_EVENT,
  accountCanUseMom,
  accountChartById,
  accountChartGroups,
  chartSpan,
  createChartHolder,
  defaultChartBox,
  withHolders,
  type AccountBoardColumns,
  type AccountChartBox,
  type AccountChartHeight,
  type AccountChartDef,
  type AccountChartHolder,
  type AccountChartWidth,
  type AccountDashboardPrefs,
  type AccountDensity,
  type AccountLanding,
  type AccountTheme,
} from "@/lib/ma/account-dashboard"
import { cn } from "@/lib/utils"

type SaveState = "idle" | "saving" | "saved" | "error"

const THEME_OPTIONS: Array<{ id: AccountTheme; label: string }> = [
  { id: "system", label: "跟随系统" },
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
]

const DENSITY_OPTIONS: Array<{ id: AccountDensity; label: string }> = [
  { id: "comfortable", label: "舒适" },
  { id: "compact", label: "紧凑" },
]

const LANDING_OPTIONS: Array<{ id: AccountLanding; label: string }> = [
  { id: "overview", label: "系统总览" },
  { id: "account", label: "我的看板" },
]

const COLUMN_OPTIONS: AccountBoardColumns[] = [1, 2, 3, 4]

const WIDTH_OPTIONS: Array<{ id: AccountChartWidth; label: string }> = [
  { id: "narrow", label: "窄" },
  { id: "half", label: "半宽" },
  { id: "wide", label: "宽" },
  { id: "full", label: "整行" },
]

function widthChoices(columns: AccountBoardColumns): Array<{ id: AccountChartWidth; label: string }> {
  const seen = new Set<number>()
  const choices: Array<{ id: AccountChartWidth; label: string }> = []
  for (const option of WIDTH_OPTIONS) {
    const span = chartSpan(option.id, columns)
    if (seen.has(span)) continue
    seen.add(span)
    choices.push({
      id: option.id,
      label: span === columns ? "整行" : span === 1 ? "窄" : `${span} 列`,
    })
  }
  return choices
}

const HEIGHT_OPTIONS: Array<{ id: AccountChartHeight; label: string }> = [
  { id: "s", label: "矮" },
  { id: "m", label: "中" },
  { id: "l", label: "高" },
  { id: "auto", label: "原高" },
]

const GRID_CLASS: Record<AccountBoardColumns, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-3",
  4: "grid-cols-1 md:grid-cols-4",
}

const SPAN_CLASS: Record<number, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
  4: "md:col-span-4",
}

const HEIGHT_CLASS: Record<AccountChartHeight, string> = {
  s: "max-h-72 overflow-auto",
  m: "max-h-[28rem] overflow-auto",
  l: "max-h-[40rem] overflow-auto",
  auto: "",
}

function chartMatches(chart: AccountChartDef, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const haystack = `${chart.title} ${chart.description} ${chart.group}`.toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

function saveLabel(state: SaveState): string {
  if (state === "saving") return "正在保存…"
  if (state === "saved") return "已保存到当前账号"
  if (state === "error") return "保存失败，请再试一次"
  return ""
}

export default function AccountDashboardPage() {
  const { setTheme } = useTheme()
  const [user, setUser] = useState<User | null>(null)
  const [prefs, setPrefs] = useState<AccountDashboardPrefs | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [tab, setTab] = useState("board")
  const [editingLayout, setEditingLayout] = useState(false)
  const [chartQuery, setChartQuery] = useState("")
  const chartSearchRef = useRef<HTMLInputElement>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [holderMenu, setHolderMenu] = useState<{ holderId: string; x: number; y: number } | null>(null)
  const [picker, setPicker] = useState<{ holderId: string; mode: "search" | "explorer" } | null>(null)
  const [pickerQuery, setPickerQuery] = useState("")
  const [previewChartId, setPreviewChartId] = useState<string | null>(null)
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({})
  const dragId = useRef<string | null>(null)
  const pickerSearchRef = useRef<HTMLInputElement>(null)
  const savedJson = useRef("")

  const [name, setName] = useState("")
  const [nameMsg, setNameMsg] = useState<string | null>(null)
  const [nameSaving, setNameSaving] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [nextPassword, setNextPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null)
  const [passwordSaving, setPasswordSaving] = useState(false)

  useEffect(() => {
    const current = authService.getCurrentUser()
    setUser(current)
    const initialName = current?.name || ""
    setName(initialName)
    if (!current?.id) {
      setLoadError("请先登录")
      return
    }
    let cancelled = false
    void authService.refreshCurrentUser().then((fresh) => {
      if (cancelled || !fresh) return
      setUser(fresh)
      setName((prev) => (prev === initialName ? fresh.name : prev))
    })
    fetch("/ma/api/account-dashboard", {
      headers: { "x-market-user-id": current.id },
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok || !data?.ok) throw new Error(data?.error || "加载失败")
        return data.prefs as AccountDashboardPrefs
      })
      .then((next) => {
        if (cancelled) return
        savedJson.current = JSON.stringify(next)
        setPrefs(next)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : "加载失败")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const theme = prefs?.theme
  useEffect(() => {
    if (!theme) return
    setTheme(theme)
  }, [theme, setTheme])

  useEffect(() => {
    if (!holderMenu) return
    function close() {
      setHolderMenu(null)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setHolderMenu(null)
    }
    window.addEventListener("click", close)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("click", close)
      window.removeEventListener("keydown", onKey)
    }
  }, [holderMenu])

  useEffect(() => {
    if (!picker) return
    const handle = window.setTimeout(() => pickerSearchRef.current?.focus(), 0)
    return () => window.clearTimeout(handle)
  }, [picker])

  useEffect(() => {
    if (!picker || !previewChartId) return
    document.querySelector(`[data-chart-id="${previewChartId}"]`)?.scrollIntoView({ block: "nearest" })
  }, [picker, previewChartId, pickerQuery])

  useEffect(() => {
    if (!picker) return
    const listed = accountChartGroups(accountCanUseMom(user))
      .flatMap((group) => group.charts)
      .filter((chart) => chartMatches(chart, pickerQuery))
    if (listed.some((chart) => chart.id === previewChartId)) return
    setPreviewChartId(listed[0]?.id ?? null)
  }, [picker, pickerQuery, previewChartId, user])

  useEffect(() => {
    if (!prefs || !user?.id) return
    const json = JSON.stringify(prefs)
    if (json === savedJson.current) return
    const handle = window.setTimeout(() => {
      void persist(user.id, prefs)
    }, 400)
    return () => window.clearTimeout(handle)
  }, [prefs, user?.id])

  async function persist(userId: string, next: AccountDashboardPrefs) {
    const sent = JSON.stringify(next)
    setSaveState("saving")
    try {
      const res = await fetch("/ma/api/account-dashboard", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-market-user-id": userId,
        },
        body: JSON.stringify({ prefs: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) throw new Error(data?.error || "保存失败")
      const confirmed = data.prefs as AccountDashboardPrefs
      savedJson.current = JSON.stringify(confirmed)
      setSaveState("saved")
      setPrefs((current) => {
        if (!current || JSON.stringify(current) !== sent) return current
        return JSON.stringify(confirmed) === sent ? current : confirmed
      })
    } catch {
      setSaveState("error")
    }
  }

  function patch(partial: Partial<AccountDashboardPrefs>) {
    setPrefs((current) => (current ? { ...current, ...partial } : current))
  }

  function updateHolders(change: (holders: AccountChartHolder[]) => AccountChartHolder[]) {
    setPrefs((current) => (current ? withHolders(current, change(current.holders)) : current))
  }

  function toggleChart(id: string, on: boolean) {
    updateHolders((holders) => {
      if (!on) return holders.filter((holder) => holder.chartId !== id)
      if (holders.some((holder) => holder.chartId === id)) return holders
      const box = defaultChartBox(id)
      return [...holders, { ...createChartHolder(), chartId: id, width: box.width, height: box.height }]
    })
  }

  function placeHolder(fromId: string, toId: string) {
    updateHolders((holders) => {
      if (fromId === toId) return holders
      const moving = holders.find((holder) => holder.id === fromId)
      const next = holders.filter((holder) => holder.id !== fromId)
      const index = next.findIndex((holder) => holder.id === toId)
      if (!moving || index < 0) return holders
      next.splice(index, 0, moving)
      return next
    })
  }

  function moveHolder(id: string, direction: -1 | 1) {
    updateHolders((holders) => {
      const index = holders.findIndex((holder) => holder.id === id)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= holders.length) return holders
      const next = [...holders]
      const [item] = next.splice(index, 1)
      next.splice(nextIndex, 0, item)
      return next
    })
  }

  function moveChart(id: string, direction: -1 | 1) {
    setPrefs((current) => {
      if (!current) return current
      const index = current.holders.findIndex((holder) => holder.chartId === id)
      if (index < 0) return current
      const holder = current.holders[index]
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.holders.length) return current
      const holders = [...current.holders]
      const [item] = holders.splice(index, 1)
      holders.splice(nextIndex, 0, item ?? holder)
      return withHolders(current, holders)
    })
  }

  function setChartBox(id: string, box: Partial<AccountChartBox>) {
    updateHolders((holders) => holders.map((holder) => (holder.id === id ? { ...holder, ...box } : holder)))
  }

  function openPicker(holderId: string, mode: "search" | "explorer") {
    setPickerQuery("")
    setPreviewChartId(null)
    setPicker({ holderId, mode })
    setHolderMenu(null)
  }

  function assignChart(holderId: string, chartId: string) {
    updateHolders((holders) => holders.map((holder) => {
      if (holder.id === holderId) return { ...holder, chartId }
      if (holder.chartId === chartId) return { ...holder, chartId: null }
      return holder
    }))
    setPicker(null)
    setHolderMenu(null)
  }

  async function saveName() {
    const trimmed = name.trim()
    setNameMsg(null)
    if (!trimmed) {
      setNameMsg("请填写用户名")
      return
    }
    setNameSaving(true)
    const result = await authService.updateProfile({ name: trimmed })
    setNameSaving(false)
    if (!result.success || !result.user) {
      setNameMsg(result.error || "保存失败")
      return
    }
    setUser(result.user)
    setName(result.user.name)
    setNameMsg("用户名已更新")
    window.dispatchEvent(new Event(ACCOUNT_PROFILE_EVENT))
  }

  async function savePassword() {
    setPasswordMsg(null)
    if (!currentPassword || !nextPassword) {
      setPasswordMsg("请填写当前密码和新密码")
      return
    }
    if (nextPassword.length < 6) {
      setPasswordMsg("新密码至少 6 位")
      return
    }
    if (nextPassword !== confirmPassword) {
      setPasswordMsg("两次输入的新密码不一致")
      return
    }
    setPasswordSaving(true)
    const result = await authService.updateProfile({
      password: nextPassword,
      currentPassword,
    })
    setPasswordSaving(false)
    if (!result.success) {
      setPasswordMsg(result.error || "修改失败")
      return
    }
    setCurrentPassword("")
    setNextPassword("")
    setConfirmPassword("")
    setPasswordMsg("密码已更新")
  }

  const allowMom = accountCanUseMom(user)
  const groups = accountChartGroups(allowMom)
  const pickerListed = picker
    ? groups.flatMap((group) => group.charts.filter((chart) => chartMatches(chart, pickerQuery)))
    : []
  const previewChart = previewChartId ? accountChartById(previewChartId) : undefined
  const previewUsed = previewChart
    ? (prefs?.holders ?? []).some((holder) => holder.chartId === previewChart.id)
    : false
  const subscribed = (prefs?.charts ?? [])
    .map((id) => accountChartById(id))
    .filter((chart): chart is NonNullable<typeof chart> => !!chart && (allowMom || chart.access !== "mom"))
  const heading = prefs?.title?.trim() || "我的看板"

  return (
    <div className="space-y-6 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-start gap-4">
          {user?.avatar_url ? (
            <button type="button" className="mt-1 shrink-0 rounded-full" title="设置头像" onClick={() => setTab("account")}>
              <UserAvatar avatarUrl={user.avatar_url} className="size-14" />
            </button>
          ) : null}
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{heading}</h1>
            <p className="mt-2 text-muted-foreground">
              {user?.name || "当前账号"}
              {user?.email ? ` · ${user.email}` : ""}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              图表、布局和账户设置保存在这个账号上。同一账号在其他电脑打开，看到的是同一套看板。
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{saveLabel(saveState)}</p>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{loadError}</div>
      ) : !prefs ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">正在读取这个账号的看板…</div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="board">看板</TabsTrigger>
            <TabsTrigger value="charts">图表订阅</TabsTrigger>
            <TabsTrigger value="prefs">个人偏好</TabsTrigger>
            <TabsTrigger value="account">账户设置</TabsTrigger>
          </TabsList>

          <TabsContent value="board" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={editingLayout ? "default" : "outline"}
                onClick={() => {
                  setEditingLayout((value) => !value)
                  setHolderMenu(null)
                  setPicker(null)
                }}
              >
                {editingLayout ? "完成编辑" : "编辑布局"}
              </Button>
              {editingLayout && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => updateHolders((holders) => [...holders, createChartHolder()])}
                  >
                    <Plus className="h-4 w-4" />
                    添加图位
                  </Button>
                  <span className="text-xs text-muted-foreground">列数</span>
                  {COLUMN_OPTIONS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => patch({ columns: count })}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-sm",
                        prefs.columns === count ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                      )}
                    >
                      {count} 列
                    </button>
                  ))}
                  <span className="text-xs text-muted-foreground">拖动图位改位置。右键图位可搜索或从目录选择图表。</span>
                </>
              )}
            </div>
            {prefs.holders.filter((holder) => editingLayout || holder.chartId).length === 0 ? (
              <div className="rounded-lg border border-dashed p-8">
                <p className="text-sm font-medium">看板是空的</p>
                <p className="mt-1 text-sm text-muted-foreground">点「编辑布局」，添加图位后右键选择图表。</p>
              </div>
            ) : (
              <div className={cn("grid", GRID_CLASS[prefs.columns], prefs.density === "comfortable" ? "gap-4" : "gap-2")}>
                {prefs.holders.filter((holder) => editingLayout || holder.chartId).map((holder, index, visible) => {
                  const chart = holder.chartId ? accountChartById(holder.chartId) : undefined
                  const span = chartSpan(holder.width, prefs.columns)
                  return (
                    <div
                      key={holder.id}
                      className={cn(
                        "min-w-0",
                        SPAN_CLASS[span],
                        editingLayout && "rounded-lg ring-1 ring-border",
                        editingLayout && dragOverId === holder.id && "ring-2 ring-primary",
                      )}
                      onContextMenu={(event) => {
                        if (!editingLayout) return
                        event.preventDefault()
                        setHolderMenu({
                          holderId: holder.id,
                          x: Math.min(event.clientX, window.innerWidth - 196),
                          y: Math.min(event.clientY, window.innerHeight - 180),
                        })
                      }}
                      onDragOver={(event) => {
                        if (!editingLayout) return
                        event.preventDefault()
                        setDragOverId(holder.id)
                      }}
                      onDragLeave={() => {
                        setDragOverId((current) => (current === holder.id ? null : current))
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        const fromId = dragId.current
                        setDragOverId(null)
                        dragId.current = null
                        if (fromId) placeHolder(fromId, holder.id)
                      }}
                    >
                      {editingLayout && (
                        <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-t-lg border-b bg-muted/40 px-2 py-1.5">
                          <button
                            type="button"
                            draggable
                            title="拖动调整位置"
                            className="cursor-grab rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
                            onDragStart={() => {
                              dragId.current = holder.id
                            }}
                            onDragEnd={() => {
                              dragId.current = null
                              setDragOverId(null)
                            }}
                          >
                            <GripVertical className="h-4 w-4" />
                          </button>
                          <span className="mr-1 max-w-40 truncate text-xs font-medium">{chart?.title || "空图位"}</span>
                          <span className="text-[10px] text-muted-foreground">宽度</span>
                          {widthChoices(prefs.columns).map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setChartBox(holder.id, { width: option.id })}
                              className={cn(
                                "rounded border px-1.5 py-0.5 text-[11px]",
                                chartSpan(option.id, prefs.columns) === span ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                              )}
                            >
                              {option.label}
                            </button>
                          ))}
                          <span className="ml-1 text-[10px] text-muted-foreground">高度</span>
                          {HEIGHT_OPTIONS.map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => setChartBox(holder.id, { height: option.id })}
                              className={cn(
                                "rounded border px-1.5 py-0.5 text-[11px]",
                                holder.height === option.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                              )}
                            >
                              {option.label}
                            </button>
                          ))}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="ml-auto h-7 w-7"
                            disabled={index === 0}
                            title="前移"
                            onClick={() => moveHolder(holder.id, -1)}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={index === visible.length - 1}
                            title="后移"
                            onClick={() => moveHolder(holder.id, 1)}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                      {chart ? (
                        <div className={HEIGHT_CLASS[holder.height]}>
                          <AccountChartSlot id={chart.id} />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="flex min-h-48 w-full flex-col items-center justify-center rounded-lg border border-dashed px-4 text-sm text-muted-foreground hover:bg-muted/40"
                          onClick={(event) => {
                            setHolderMenu({
                              holderId: holder.id,
                              x: Math.min(event.clientX, window.innerWidth - 196),
                              y: Math.min(event.clientY, window.innerHeight - 180),
                            })
                          }}
                        >
                          空图位
                          <span className="mt-1 text-xs">右键搜索图表，或从目录选择</span>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {holderMenu && (
              <div
                className="fixed z-50 min-w-44 rounded-md border bg-popover p-1 text-sm shadow-md"
                style={{ left: holderMenu.x, top: holderMenu.y }}
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => openPicker(holderMenu.holderId, "search")}
                >
                  <Search className="h-3.5 w-3.5" />
                  搜索图表
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => openPicker(holderMenu.holderId, "explorer")}
                >
                  <Folder className="h-3.5 w-3.5" />
                  从目录选择
                </button>
                <button
                  type="button"
                  className="flex w-full rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-40"
                  disabled={!prefs.holders.some((holder) => holder.id === holderMenu.holderId && holder.chartId)}
                  onClick={() => {
                    updateHolders((holders) => holders.map((holder) => (
                      holder.id === holderMenu.holderId ? { ...holder, chartId: null } : holder
                    )))
                    setHolderMenu(null)
                  }}
                >
                  清空图表
                </button>
                <button
                  type="button"
                  className="flex w-full rounded px-2 py-1.5 text-left text-red-600 hover:bg-muted"
                  onClick={() => {
                    updateHolders((holders) => holders.filter((holder) => holder.id !== holderMenu.holderId))
                    setHolderMenu(null)
                  }}
                >
                  删除图位
                </button>
              </div>
            )}
            {picker && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPicker(null)}>
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label={picker.mode === "search" ? "搜索图表" : "从目录选择图表"}
                  className="flex h-[min(760px,86vh)] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-lg border bg-background shadow-xl"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setPicker(null)
                      return
                    }
                    if (event.key === "Enter" && previewChart) {
                      const target = event.target as HTMLElement
                      if (target.dataset.role === "folder" || target.dataset.role === "confirm" || target.dataset.role === "cancel") return
                      event.preventDefault()
                      assignChart(picker.holderId, previewChart.id)
                      return
                    }
                    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && pickerListed.length > 0) {
                      event.preventDefault()
                      const index = Math.max(0, pickerListed.findIndex((chart) => chart.id === previewChartId))
                      const delta = event.key === "ArrowDown" ? 1 : -1
                      const next = pickerListed[(index + delta + pickerListed.length) % pickerListed.length]
                      setPreviewChartId(next.id)
                    }
                  }}
                >
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <div>
                      <h2 className="text-sm font-semibold">{picker.mode === "search" ? "搜索图表" : "从目录选择"}</h2>
                      <p className="text-xs text-muted-foreground">单击预览，双击或回车放入图位</p>
                    </div>
                    <button type="button" data-role="cancel" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => setPicker(null)} title="关闭">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex min-h-0 flex-1">
                    <div className="flex w-[320px] shrink-0 flex-col border-r">
                      <div className="relative border-b px-3 py-3">
                        <Search className="pointer-events-none absolute top-1/2 left-6 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          ref={pickerSearchRef}
                          value={pickerQuery}
                          placeholder={picker.mode === "search" ? "搜索要放进这个图位的图表" : "在目录里筛选"}
                          className="pl-9"
                          onChange={(event) => setPickerQuery(event.target.value)}
                        />
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto p-2">
                        {pickerListed.length === 0 ? (
                          <p className="px-2 py-6 text-sm text-muted-foreground">没有找到「{pickerQuery.trim()}」。</p>
                        ) : picker.mode === "search" ? (
                          groups.map((group) => {
                            const visible = group.charts.filter((chart) => chartMatches(chart, pickerQuery))
                            if (visible.length === 0) return null
                            return (
                              <div key={group.group} className="mb-2">
                                <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{group.group}</p>
                                {visible.map((chart) => {
                                  const selected = previewChartId === chart.id
                                  const used = (prefs?.holders ?? []).some((holder) => holder.chartId === chart.id)
                                  return (
                                    <button
                                      key={chart.id}
                                      type="button"
                                      className={cn(
                                        "flex w-full flex-col rounded px-2 py-1.5 text-left",
                                        selected ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
                                      )}
                                      data-chart-id={chart.id}
                                      onClick={() => setPreviewChartId(chart.id)}
                                      onDoubleClick={() => assignChart(picker.holderId, chart.id)}
                                    >
                                      <span className="flex items-center justify-between gap-2">
                                        <span className="text-sm">{chart.title}</span>
                                        {used && <span className="shrink-0 text-[10px] text-muted-foreground">已在看板上</span>}
                                      </span>
                                      <span className="text-xs text-muted-foreground">{chart.description}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            )
                          })
                        ) : (
                          groups.map((group) => {
                            const visible = group.charts.filter((chart) => chartMatches(chart, pickerQuery))
                            if (visible.length === 0) return null
                            const open = pickerQuery.trim() !== "" || openFolders[group.group] !== false
                            return (
                              <div key={group.group} className="mb-1">
                                <button
                                  type="button"
                                  data-role="folder"
                                  className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                                  onClick={() => setOpenFolders((current) => ({ ...current, [group.group]: !open }))}
                                >
                                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                  {open ? <FolderOpen className="h-4 w-4 text-muted-foreground" /> : <Folder className="h-4 w-4 text-muted-foreground" />}
                                  <span className="flex-1">{group.group}</span>
                                  <span className="text-[11px] text-muted-foreground">{visible.length}</span>
                                </button>
                                {open && visible.map((chart) => {
                                  const selected = previewChartId === chart.id
                                  const used = (prefs?.holders ?? []).some((holder) => holder.chartId === chart.id)
                                  return (
                                    <button
                                      key={chart.id}
                                      type="button"
                                      className={cn(
                                        "flex w-full items-center gap-2 rounded py-1.5 pr-2 pl-9 text-left text-sm",
                                        selected ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted",
                                      )}
                                      data-chart-id={chart.id}
                                      onClick={() => setPreviewChartId(chart.id)}
                                      onDoubleClick={() => assignChart(picker.holderId, chart.id)}
                                    >
                                      <span className="h-3.5 w-3.5 shrink-0 rounded-sm border border-muted-foreground/40" />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate">{chart.title}</span>
                                        <span className="block truncate text-xs text-muted-foreground">{chart.description}</span>
                                      </span>
                                      {used && <span className="shrink-0 text-[10px] text-muted-foreground">已用</span>}
                                    </button>
                                  )
                                })}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      {previewChart ? (
                        <>
                          <div className="border-b px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="truncate text-sm font-semibold">{previewChart.title}</h3>
                              <span className="shrink-0 text-xs text-muted-foreground">{previewChart.group}</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{previewChart.description}</p>
                            {previewUsed && <p className="mt-1 text-xs text-amber-600">这张图已经在看板上，放入后会从原来的图位移走。</p>}
                            <p className="mt-1 text-xs text-muted-foreground">预览停在当前数据上，不会跟着行情跳动。放入图位后才实时更新。</p>
                          </div>
                          <div className="min-h-0 flex-1 overflow-auto p-3">
                            <div className="min-h-[420px]">
                              <AccountChartSlot key={previewChart.id} id={previewChart.id} still />
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
                          选择左侧图表后在这里预览
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
                    <p className="text-xs text-muted-foreground">方向键切换预览，Esc 关闭</p>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" data-role="cancel" onClick={() => setPicker(null)}>取消</Button>
                      <Button
                        type="button"
                        data-role="confirm"
                        disabled={!previewChart}
                        onClick={() => previewChart && assignChart(picker.holderId, previewChart.id)}
                      >
                        放入这个图位
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="charts" className="mt-4 space-y-6">
            <div className="max-w-md">
              <label className="text-sm font-medium" htmlFor="chart-search">搜索图表</label>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="chart-search"
                  ref={chartSearchRef}
                  value={chartQuery}
                  placeholder="搜索要添加的图表，例如 波动率、拥挤度"
                  className="pl-9 pr-9"
                  onChange={(event) => setChartQuery(event.target.value)}
                />
                {chartQuery && (
                  <button
                    type="button"
                    title="清除搜索"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => {
                      setChartQuery("")
                      chartSearchRef.current?.focus()
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <section className="rounded-lg border p-4">
              <h2 className="text-sm font-semibold">看板上的顺序</h2>
              <p className="mt-1 text-xs text-muted-foreground">也可以在看板上点「编辑布局」，添加图位后拖动、改大小，并右键选择图表。</p>
              {subscribed.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">当前没有订阅。</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {subscribed.map((chart, index) => (
                    <li key={chart.id} className="flex items-center gap-3 py-2">
                      <span className="w-6 text-xs text-muted-foreground">{index + 1}</span>
                      <span className="min-w-0 flex-1 text-sm">{chart.title}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={index === 0}
                        onClick={() => moveChart(chart.id, -1)}
                        title="上移"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={index === subscribed.length - 1}
                        onClick={() => moveChart(chart.id, 1)}
                        title="下移"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {groups.every((group) => group.charts.every((chart) => !chartMatches(chart, chartQuery))) ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                没有找到「{chartQuery.trim()}」。
              </div>
            ) : groups.map((group) => {
              const visible = group.charts.filter((chart) => chartMatches(chart, chartQuery))
              if (visible.length === 0) return null
              return (
              <section key={group.group} className="space-y-2">
                <h2 className="text-sm font-semibold">{group.group}</h2>
                <div className="divide-y rounded-lg border">
                  {visible.map((chart) => {
                    const on = prefs.charts.includes(chart.id)
                    return (
                      <div key={chart.id} className="flex items-center gap-4 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{chart.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{chart.description}</p>
                          <Link href={chart.href} className="mt-1 inline-block text-xs text-muted-foreground underline-offset-2 hover:underline">
                            在原页面打开
                          </Link>
                        </div>
                        <Switch checked={on} onCheckedChange={(checked) => toggleChart(chart.id, checked)} aria-label={chart.title} />
                      </div>
                    )
                  })}
                </div>
              </section>
              )
            })}
          </TabsContent>

          <TabsContent value="prefs" className="mt-4 space-y-6">
            <section className="max-w-xl space-y-2">
              <label className="text-sm font-medium" htmlFor="board-title">看板名称</label>
              <Input
                id="board-title"
                value={prefs.title}
                maxLength={40}
                placeholder="我的看板"
                onChange={(event) => patch({ title: event.target.value.slice(0, 40) })}
              />
              <p className="text-xs text-muted-foreground">留空时显示「我的看板」。</p>
            </section>

            <ChoiceGroup
              label="主题"
              value={prefs.theme}
              options={THEME_OPTIONS}
              onChange={(theme) => patch({ theme })}
            />
            <ChoiceGroup
              label="图表密度"
              value={prefs.density}
              options={DENSITY_OPTIONS}
              onChange={(density) => patch({ density })}
            />
            <ChoiceGroup
              label="传统风格登录后进入"
              value={prefs.landing}
              options={LANDING_OPTIONS}
              onChange={(landing) => patch({ landing })}
            />
          </TabsContent>

          <TabsContent value="account" className="mt-4 space-y-6">
            <AccountAvatarCard
              avatarUrl={user?.avatar_url ?? null}
              onUser={(next) => {
                setUser(next)
                window.dispatchEvent(new Event(ACCOUNT_PROFILE_EVENT))
              }}
            />
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-4 rounded-lg border p-5">
              <h2 className="text-sm font-semibold">用户名</h2>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground" htmlFor="account-name">显示名称</label>
                <Input id="account-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground" htmlFor="account-email">邮箱</label>
                <Input id="account-email" value={user?.email || ""} readOnly />
              </div>
              <div className="flex items-center gap-3">
                <Button type="button" onClick={() => void saveName()} disabled={nameSaving}>
                  {nameSaving ? "保存中…" : "保存用户名"}
                </Button>
                {nameMsg && <span className="text-xs text-muted-foreground">{nameMsg}</span>}
              </div>
            </section>

            <section className="space-y-4 rounded-lg border p-5">
              <h2 className="text-sm font-semibold">密码</h2>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground" htmlFor="current-password">当前密码</label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  autoComplete="current-password"
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground" htmlFor="next-password">新密码</label>
                <Input
                  id="next-password"
                  type="password"
                  value={nextPassword}
                  autoComplete="new-password"
                  onChange={(event) => setNextPassword(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground" htmlFor="confirm-password">再次输入新密码</label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
              <div className="flex items-center gap-3">
                <Button type="button" onClick={() => void savePassword()} disabled={passwordSaving}>
                  {passwordSaving ? "保存中…" : "更新密码"}
                </Button>
                {passwordMsg && <span className="text-xs text-muted-foreground">{passwordMsg}</span>}
              </div>
            </section>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ id: T; label: string }>
  onChange: (id: T) => void
}) {
  return (
    <section className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.id === value
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}
