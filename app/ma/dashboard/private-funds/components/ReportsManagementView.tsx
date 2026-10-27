"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  Download,
  Image as ImageIcon,
  Inbox,
  LayoutList,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import JSZip from "jszip"
import { NewReportDialog } from "./NewReportDialog"
import { authService, type User } from "@/lib/auth"
import { canAccessPfInvestmentPool } from "@/lib/permissions"

type ScopeTab = "team" | "mine"
type ViewMode = "table" | "images"
type TitleNameMode = "short" | "full"

const TITLE_NAME_MODE_STORAGE_KEY = "pf-reports-title-name-mode"

type WeeklyReportRow = {
  id: string
  reportId: string
  title: string
  templateName: string
  createdAt: string
  creator: string
  typeLabel: string
  weekStart?: string
  weekEnd?: string
  latestNavDate?: string | null
  navDaysBehindNextWeek?: number | null
  product_name?: string
  beian_hao?: string | null
  /** Metadata short name when available; null if only one form exists. */
  short_name?: string | null
  /** Metadata full / legal name when available; null if only one form exists. */
  full_name?: string | null
  isCustomFund?: boolean
  source?: "managed" | "extra" | "mine"
  download?: { png: string; pdf: string }
  kind: ScopeTab
}

type MineProduct = {
  product_name: string
  beian_hao: string | null
  addedAt: string
}

type ProductOption = {
  product_name: string
  beian_hao: string | null
  source: "managed" | "private" | "custom_fund"
  sourceLabel: string
}

const thBase =
  "px-3 py-0 h-9 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap box-border leading-tight align-middle"

function currentUserName(): string {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    return u?.name ?? u?.email ?? ""
  } catch {
    return ""
  }
}

function userFetchHeaders(): Record<string, string> {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    const id = u?.id ?? ""
    return id ? { "x-market-user-id": id } : {}
  } catch {
    return {}
  }
}

function formatReportWeek(weekStart?: string, weekEnd?: string): string {
  const a = (weekStart || "").trim()
  const b = (weekEnd || "").trim()
  if (a && b) return `${a} ~ ${b}`
  return a || b || "—"
}

function formatNavDaysBehind(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return "—"
  if (n <= 0) return "已最新"
  return `缺${n}日`
}


function readStoredTitleNameMode(): TitleNameMode {
  try {
    const raw = localStorage.getItem(TITLE_NAME_MODE_STORAGE_KEY)
    if (raw === "full" || raw === "short") return raw
  } catch {
    /* ignore */
  }
  return "short"
}

/**
 * Resolve title for the current name mode.
 * Prefer metadata short/full fields; if only one form exists, both modes show that form.
 * Fall back to stored title / product_name (never invent a name).
 */
function resolveReportTitle(
  row: Pick<WeeklyReportRow, "title" | "product_name" | "short_name" | "full_name">,
  mode: TitleNameMode,
): string {
  const stored = (row.title || row.product_name || "").trim()
  const shortName = (row.short_name || "").trim()
  const fullName = (row.full_name || "").trim()
  if (mode === "short") {
    return shortName || fullName || stored
  }
  return fullName || shortName || stored
}

function withInlinePng(url: string | undefined): string | undefined {
  if (!url) return url
  if (url.includes("inline=")) return url
  return url.includes("?") ? `${url}&inline=1` : `${url}?inline=1`
}

function sanitizeFileToken(value: string): string {
  return (value || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
}

function formatWeekRangeToken(weekStart?: string, weekEnd?: string): string {
  const a = (weekStart || "").trim()
  const b = (weekEnd || "").trim()
  if (a && b) return `${a}~${b}`
  return a || b || ""
}

function buildWeeklyZipName(scope: ScopeTab, rows: WeeklyReportRow[]): string {
  const starts = rows.map((r) => (r.weekStart || "").trim()).filter(Boolean).sort()
  const ends = rows.map((r) => (r.weekEnd || "").trim()).filter(Boolean).sort()
  const weekStart = starts[0] || ""
  const weekEnd = ends[ends.length - 1] || ""
  const range = formatWeekRangeToken(weekStart, weekEnd)
  const prefix = scope === "team" ? "系统周报" : "我的周报"
  if (range) return `${prefix}_${range}.zip`
  return `${prefix}_${new Date().toISOString().slice(0, 10)}.zip`
}

function buildReportZipEntryName(
  row: Pick<WeeklyReportRow, "product_name" | "title" | "weekStart" | "weekEnd" | "reportId">,
  ext: "pdf" | "png",
): string {
  const product = sanitizeFileToken(row.product_name || row.title || row.reportId || "报告").slice(0, 60)
  const range = formatWeekRangeToken(row.weekStart, row.weekEnd)
  const stem = range ? `${product}_周报_${range}` : `${product}_周报`
  return `${stem}.${ext}`
}


function ReportPreviewThumb({
  pngUrl,
  title,
}: {
  pngUrl?: string
  title: string
}) {
  const src = withInlinePng(pngUrl)
  const anchorRef = useRef<HTMLAnchorElement | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 440,
  })

  const placePopup = useCallback(() => {
    const el = anchorRef.current
    if (!el || typeof window === "undefined") return
    const r = el.getBoundingClientRect()
    const width = Math.min(480, Math.max(320, window.innerWidth - 24))
    const maxH = Math.min(window.innerHeight * 0.78, 720)
    let left = r.right + 10
    if (left + width > window.innerWidth - 8) left = r.left - width - 10
    if (left < 8) left = 8
    let top = r.top
    if (top + maxH > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - maxH - 8)
    }
    if (top < 8) top = 8
    setPos({ top, left, width })
  }, [])

  const show = useCallback(() => {
    placePopup()
    setOpen(true)
  }, [placePopup])

  const hide = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onMove = () => placePopup()
    window.addEventListener("scroll", onMove, true)
    window.addEventListener("resize", onMove)
    return () => {
      window.removeEventListener("scroll", onMove, true)
      window.removeEventListener("resize", onMove)
    }
  }, [open, placePopup])

  if (!src) return <span className="text-xs text-zinc-400">—</span>

  const popup =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            role="dialog"
            aria-label={`报告预览 ${title}`}
            className="fixed z-[300] pointer-events-none rounded-lg border border-border bg-white dark:bg-zinc-950 shadow-2xl overflow-hidden"
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              maxHeight: "78vh",
            }}
          >
            <div className="px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 border-b border-border bg-muted/40 truncate">
              {title}
            </div>
            <div className="overflow-auto max-h-[calc(78vh-2rem)] bg-zinc-100 dark:bg-zinc-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={title}
                className="block w-full h-auto object-contain bg-white"
              />
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <a
        ref={anchorRef}
        href={src}
        target="_blank"
        rel="noreferrer"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="group relative inline-flex h-10 w-16 items-center justify-center overflow-hidden rounded border border-border bg-muted/30"
        title={`悬停预览 · 点击打开 ${title}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={title}
          className="h-full w-full object-cover object-top transition-transform group-hover:scale-105"
        />
      </a>
      {popup}
    </>
  )
}

async function fetchJsonSafe(url: string, init?: RequestInit): Promise<unknown> {
  try {
    const resp = await fetch(url, init)
    if (!resp.ok) return null
    return await resp.json().catch(() => null)
  } catch {
    return null
  }
}

function parsePickerOptions(json: unknown, source: ProductOption["source"], sourceLabel: string): ProductOption[] {
  const rows = Array.isArray((json as { data?: unknown })?.data)
    ? ((json as { data: unknown[] }).data)
    : Array.isArray(json)
      ? (json as unknown[])
      : []
  const out: ProductOption[] = []
  for (const raw of rows) {
    const r = raw as Record<string, unknown>
    const product_name = String(r.product_name || r.name || r.fund_name || "").trim()
    if (!product_name) continue
    const beian =
      (r.beian_hao as string | null | undefined) ||
      (r.register_code as string | null | undefined) ||
      (r.product_code as string | null | undefined) ||
      null
    out.push({
      product_name,
      beian_hao: beian ? String(beian).trim() || null : null,
      source,
      sourceLabel,
    })
  }
  return out
}

function MineAddProductDialog({
  open,
  products,
  busy,
  onClose,
  onAdd,
  onRemove,
  onRefreshGenerate,
}: {
  open: boolean
  products: MineProduct[]
  busy: boolean
  onClose: () => void
  onAdd: (opt: ProductOption) => Promise<void>
  onRemove: (p: MineProduct) => Promise<void>
  onRefreshGenerate: () => Promise<void>
}) {
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<ProductOption[]>([])
  const [searching, setSearching] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setOptions([])
      return
    }
  }, [open])

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setOptions([])
      setSearching(false)
      return
    }
    const ac = new AbortController()
    let cancelled = false
    setSearching(true)
    const timer = window.setTimeout(async () => {
      const q = query.trim()
      const headers = userFetchHeaders()
      const [customTeam, customMine, privateJson, managedJson] = await Promise.all([
        fetchJsonSafe(`/ma/api/custom-funds/list?scope=team&keyword=${encodeURIComponent(q)}&pageSize=20`, {
          headers,
          signal: ac.signal,
        }),
        fetchJsonSafe(`/ma/api/custom-funds/list?scope=mine&keyword=${encodeURIComponent(q)}&pageSize=20`, {
          headers,
          signal: ac.signal,
        }),
        fetchJsonSafe(`/ma/api/private-funds/products/search?q=${encodeURIComponent(q)}&format=picker`, {
          signal: ac.signal,
        }),
        fetchJsonSafe(`/ma/api/ops/managed-products/list?keyword=${encodeURIComponent(q)}&pageSize=20`, {
          headers,
          signal: ac.signal,
        }),
      ])
      if (cancelled) return
      const merged = [
        ...parsePickerOptions(customTeam, "custom_fund", "自建基金"),
        ...parsePickerOptions(customMine, "custom_fund", "自建基金"),
        ...parsePickerOptions(privateJson, "private", "私募基金"),
        ...parsePickerOptions(managedJson, "managed", "在管产品"),
      ]
      const seen = new Set<string>()
      const deduped: ProductOption[] = []
      for (const opt of merged) {
        const key = `${(opt.beian_hao || "").toUpperCase()}::${opt.product_name}`
        if (seen.has(key)) continue
        seen.add(key)
        deduped.push(opt)
      }
      setOptions(deduped.slice(0, 30))
      setSearching(false)
    }, 220)
    return () => {
      cancelled = true
      ac.abort()
      window.clearTimeout(timer)
    }
  }, [open, query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={wrapRef}
        className="w-full max-w-xl rounded-xl border border-border bg-background shadow-xl flex flex-col max-h-[85vh]"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <div className="text-sm font-semibold">添加跟踪产品</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              加入后按与团队报告相同的周报逻辑自动生成，仅你可见
            </div>
          </div>
          <button type="button" className="p-1 rounded hover:bg-muted" onClick={onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索产品名称 / 备案号…"
              className="w-full h-9 pl-8 pr-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {searching && <div className="text-xs text-zinc-400">搜索中…</div>}
          {!searching && query.trim() && options.length === 0 && (
            <div className="text-xs text-zinc-400">无匹配产品</div>
          )}
          {options.length > 0 && (
            <div className="max-h-40 overflow-auto rounded-md border border-border divide-y">
              {options.map((opt) => (
                <button
                  key={`${opt.source}-${opt.beian_hao || ""}-${opt.product_name}`}
                  type="button"
                  disabled={busy}
                  onClick={() => void onAdd(opt)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 disabled:opacity-50 flex items-center justify-between gap-2"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{opt.product_name}</span>
                    {opt.beian_hao ? (
                      <span className="ml-2 text-xs text-zinc-400">{opt.beian_hao}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[10px] text-zinc-400">{opt.sourceLabel}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 flex-1 min-h-0 overflow-auto">
          <div className="text-xs font-medium text-zinc-500 mb-2">
            已添加（{products.length}）
          </div>
          {products.length === 0 ? (
            <div className="text-xs text-zinc-400 py-6 text-center">尚未添加产品</div>
          ) : (
            <ul className="space-y-1">
              {products.map((p) => (
                <li
                  key={`${p.beian_hao || ""}-${p.product_name}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.product_name}</div>
                    <div className="text-[11px] text-zinc-400">
                      {p.beian_hao || "无备案号"} · 添加于{" "}
                      {new Date(p.addedAt).toLocaleString("zh-CN", { hour12: false })}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onRemove(p)}
                    className="shrink-0 inline-flex items-center gap-1 text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 py-3 border-t flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={busy || products.length === 0}
            onClick={() => void onRefreshGenerate()}
            className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50"
          >
            {busy ? "处理中…" : "重新生成周报"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded-md bg-red-600 text-white text-sm hover:bg-red-700"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}

export function ReportsManagementView() {
  const [scopeTab, setScopeTab] = useState<ScopeTab>("team")
  const [keyword, setKeyword] = useState("")
  const [onlyCustomFunds, setOnlyCustomFunds] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("table")
  const [titleNameMode, setTitleNameMode] = useState<TitleNameMode>("short")
  const [newReportOpen, setNewReportOpen] = useState(false)
  const [addProductOpen, setAddProductOpen] = useState(false)

  const [teamReports, setTeamReports] = useState<WeeklyReportRow[]>([])
  const [mineReports, setMineReports] = useState<WeeklyReportRow[]>([])
  const [mineProducts, setMineProducts] = useState<MineProduct[]>([])
  const [canSeeSystem, setCanSeeSystem] = useState(false)
  const [teamLoading, setTeamLoading] = useState(false)
  const [mineLoading, setMineLoading] = useState(false)
  const [teamError, setTeamError] = useState<string | null>(null)
  const [mineError, setMineError] = useState<string | null>(null)
  const [mineBusy, setMineBusy] = useState(false)
  const [mineMessage, setMineMessage] = useState<string | null>(null)
  const [zipBusy, setZipBusy] = useState(false)
  const [zipMessage, setZipMessage] = useState<string | null>(null)

  useEffect(() => {
    setTitleNameMode(readStoredTitleNameMode())
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(TITLE_NAME_MODE_STORAGE_KEY, titleNameMode)
    } catch {
      /* ignore */
    }
  }, [titleNameMode])

    const mapApiRow = useCallback((r: Record<string, unknown>, kind: ScopeTab): WeeklyReportRow => {
    const download = r.download as { png?: string; pdf?: string } | undefined
    return {
      id: String(r.id || r.reportId || ""),
      reportId: String(r.reportId || r.id || ""),
      title: String(r.title || r.product_name || ""),
      templateName: String(r.templateName || ""),
      createdAt: String(r.createdAt || new Date().toISOString()),
      creator: String(r.creator || (kind === "team" ? "系统" : currentUserName() || "我")),
      typeLabel: String(r.typeLabel || (kind === "team" ? "系统周报" : "我的周报")),
      weekStart: (r.weekStart as string | undefined) || undefined,
      weekEnd: (r.weekEnd as string | undefined) || undefined,
      latestNavDate: (r.latestNavDate as string | null | undefined) ?? null,
      navDaysBehindNextWeek: (r.navDaysBehindNextWeek as number | null | undefined) ?? null,
      product_name: (r.product_name as string | undefined) || undefined,
      beian_hao: (r.beian_hao as string | null | undefined) ?? null,
      short_name: (r.short_name as string | null | undefined) ?? null,
      full_name: (r.full_name as string | null | undefined) ?? null,
      isCustomFund: r.isCustomFund === true || r.source === "extra",
      source: (r.source as WeeklyReportRow["source"] | undefined) ?? undefined,
      download: download?.png || download?.pdf ? { png: download.png || "", pdf: download.pdf || "" } : undefined,
      kind,
    }
  }, [])

  const refreshTeamReports = useCallback(async (allowed: boolean) => {
    if (!allowed) {
      setTeamReports([])
      setTeamError(null)
      return
    }
    setTeamLoading(true)
    setTeamError(null)
    try {
      const resp = await fetch("/ma/api/reports/auto-weekly/list", {
        headers: userFetchHeaders(),
        cache: "no-store",
      })
      const json = (await resp.json().catch(() => ({}))) as {
        data?: Record<string, unknown>[]
        error?: string
      }
      if (!resp.ok) {
        if (resp.status === 403) {
          setCanSeeSystem(false)
          setTeamReports([])
          return
        }
        throw new Error(json.error || `加载失败 HTTP ${resp.status}`)
      }
      setTeamReports((json.data || []).map((r) => mapApiRow(r, "team")))
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : "加载团队周报失败")
      setTeamReports([])
    } finally {
      setTeamLoading(false)
    }
  }, [mapApiRow])

  const refreshMineReports = useCallback(async () => {
    setMineLoading(true)
    setMineError(null)
    try {
      const resp = await fetch("/ma/api/reports/auto-weekly/mine/list", {
        headers: userFetchHeaders(),
        cache: "no-store",
      })
      const json = (await resp.json().catch(() => ({}))) as {
        data?: Record<string, unknown>[]
        error?: string
      }
      if (!resp.ok) {
        throw new Error(json.error || `加载失败 HTTP ${resp.status}`)
      }
      setMineReports((json.data || []).map((r) => mapApiRow(r, "mine")))
    } catch (err) {
      setMineError(err instanceof Error ? err.message : "加载我的周报失败")
      setMineReports([])
    } finally {
      setMineLoading(false)
    }
  }, [mapApiRow])

  const refreshMineProducts = useCallback(async () => {
    try {
      const resp = await fetch("/ma/api/reports/auto-weekly/mine/products", {
        headers: userFetchHeaders(),
        cache: "no-store",
      })
      const json = (await resp.json().catch(() => ({}))) as {
        data?: MineProduct[]
        error?: string
      }
      if (!resp.ok) throw new Error(json.error || "加载产品列表失败")
      setMineProducts(json.data || [])
    } catch {
      setMineProducts([])
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // getCurrentUser is sync (localStorage); refresh pulls latest permissions from server.
      let user = authService.getCurrentUser() as User | null
      try {
        const refreshed = await authService.refreshCurrentUser()
        if (refreshed) user = refreshed
      } catch {
        // keep localStorage snapshot
      }
      const allowed = canAccessPfInvestmentPool(user)
      if (cancelled) return
      setCanSeeSystem(allowed)
      await refreshTeamReports(allowed)
    })()
    return () => {
      cancelled = true
    }
  }, [refreshTeamReports])

  useEffect(() => {
    if (scopeTab !== "mine") return
    void refreshMineReports()
    void refreshMineProducts()
  }, [scopeTab, refreshMineReports, refreshMineProducts])

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    let rows = scopeTab === "team" ? (canSeeSystem ? teamReports : []) : mineReports
    if (onlyCustomFunds) {
      rows = rows.filter((r) => r.isCustomFund === true || r.source === "extra")
    }
    if (!q) return rows
    return rows.filter((r) => {
      const hay = [r.title, r.product_name, r.short_name, r.full_name, r.templateName, r.creator, r.typeLabel, r.weekStart, r.weekEnd, r.latestNavDate]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return hay.includes(q)
    })
  }, [scopeTab, keyword, onlyCustomFunds, canSeeSystem, teamReports, mineReports])

  async function handleDownloadAllZip() {
    const withFiles = filtered.filter((r) => r.download?.pdf || r.download?.png)
    if (withFiles.length === 0) {
      setZipMessage("当前列表没有可下载的报告文件")
      return
    }
    setZipBusy(true)
    setZipMessage(null)
    try {
      const zip = new JSZip()
      let added = 0
      for (const row of withFiles) {
        for (const format of ["pdf", "png"] as const) {
          const url = row.download?.[format]
          if (!url) continue
          const resp = await fetch(url, { headers: userFetchHeaders() })
          if (!resp.ok) continue
          const buf = await resp.arrayBuffer()
          zip.file(buildReportZipEntryName(row, format), buf)
          added += 1
        }
      }
      if (added === 0) throw new Error("未能读取任何报告文件")
      const blob = await zip.generateAsync({ type: "blob" })
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = buildWeeklyZipName(scopeTab, withFiles)
      a.click()
      URL.revokeObjectURL(a.href)
      setZipMessage(`已打包 ${withFiles.length} 条报告`)
    } catch (err) {
      setZipMessage(err instanceof Error ? err.message : "打包下载失败")
    } finally {
      setZipBusy(false)
    }
  }

  async function handleAddMineProduct(opt: ProductOption) {
    setMineBusy(true)
    setMineMessage(null)
    try {
      const resp = await fetch("/ma/api/reports/auto-weekly/mine/products", {
        method: "POST",
        headers: { ...userFetchHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: opt.product_name,
          beian_hao: opt.beian_hao,
          generate: true,
        }),
      })
      const json = (await resp.json().catch(() => ({}))) as {
        error?: string
        etl?: { status?: string; error?: string; weekEnd?: string }
        products?: MineProduct[]
      }
      if (!resp.ok) throw new Error(json.error || "添加失败")
      setMineProducts(json.products || [])
      await refreshMineReports()
      const etl = json.etl
      if (etl?.status === "failed" || etl?.status === "skipped") {
        setMineMessage(
          `已添加 ${opt.product_name}，生成：${etl.status}${etl.error ? `（${etl.error}）` : ""}`,
        )
      } else {
        setMineMessage(
          `已添加 ${opt.product_name}${etl?.weekEnd ? `，周报至 ${etl.weekEnd}` : ""}`,
        )
      }
    } catch (err) {
      setMineMessage(err instanceof Error ? err.message : "添加失败")
    } finally {
      setMineBusy(false)
    }
  }

  async function handleRemoveMineProduct(p: MineProduct) {
    setMineBusy(true)
    setMineMessage(null)
    try {
      const resp = await fetch("/ma/api/reports/auto-weekly/mine/products", {
        method: "DELETE",
        headers: { ...userFetchHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ product_name: p.product_name, beian_hao: p.beian_hao }),
      })
      const json = (await resp.json().catch(() => ({}))) as {
        error?: string
        products?: MineProduct[]
      }
      if (!resp.ok) throw new Error(json.error || "移除失败")
      setMineProducts(json.products || [])
      setMineMessage(`已移除 ${p.product_name}（已生成报告仍保留在列表）`)
    } catch (err) {
      setMineMessage(err instanceof Error ? err.message : "移除失败")
    } finally {
      setMineBusy(false)
    }
  }

  async function handleMineRegenerate() {
    setMineBusy(true)
    setMineMessage(null)
    try {
      const resp = await fetch("/ma/api/reports/auto-weekly/mine/run", {
        method: "POST",
        headers: { ...userFetchHeaders(), "Content-Type": "application/json" },
        body: "{}",
      })
      const json = (await resp.json().catch(() => ({}))) as {
        error?: string
        result?: { created?: number; existed?: number; skipped?: number; failed?: number }
      }
      if (!resp.ok) throw new Error(json.error || "生成失败")
      await refreshMineReports()
      const r = json.result
      setMineMessage(
        r
          ? `生成完成：新建 ${r.created || 0} / 已有 ${r.existed || 0} / 跳过 ${r.skipped || 0} / 失败 ${r.failed || 0}`
          : "生成完成",
      )
    } catch (err) {
      setMineMessage(err instanceof Error ? err.message : "生成失败")
    } finally {
      setMineBusy(false)
    }
  }

  const emptyHint =
    scopeTab === "team"
      ? canSeeSystem
        ? "系统周报由夜间任务自动生成，只显示在「团队报告」"
        : "暂无团队报告"
      : "点「添加产品」把跟踪基金加入自动周报；仅当前账号可见"

  const showLoading = scopeTab === "team" ? teamLoading : mineLoading
  const showTools = scopeTab === "team" ? canSeeSystem : true
  const activeError = scopeTab === "team" ? teamError : mineError

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0">
        {(["team", "mine"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setScopeTab(t)}
            className={[
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              scopeTab === t
                ? "border-red-600 text-red-600"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
            ].join(" ")}
          >
            {t === "team" ? "团队报告" : "我的报告"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3 flex-shrink-0">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题 / 产品 / 日期…"
            className="w-full h-9 pl-8 pr-3 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
                <div className="inline-flex h-9 rounded-md border border-border overflow-hidden shrink-0" title="标题显示简称或全称">
          <button
            type="button"
            onClick={() => setTitleNameMode("short")}
            className={[
              "px-3 text-sm",
              titleNameMode === "short"
                ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                : "bg-background hover:bg-muted text-zinc-600",
            ].join(" ")}
          >
            简称
          </button>
          <button
            type="button"
            onClick={() => setTitleNameMode("full")}
            className={[
              "px-3 text-sm border-l border-border",
              titleNameMode === "full"
                ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                : "bg-background hover:bg-muted text-zinc-600",
            ].join(" ")}
          >
            全称
          </button>
        </div>
        <button
          type="button"
          onClick={() => setOnlyCustomFunds((v) => !v)}
          className={[
            "h-9 px-3 rounded-md border text-sm font-medium transition-colors shrink-0",
            onlyCustomFunds
              ? "border-red-600 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
              : "border-border bg-background hover:bg-muted text-zinc-600",
          ].join(" ")}
          title="只看自建基金报告"
        >
          自建基金
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {showTools && (
            <>
              <div className="inline-flex h-9 rounded-md border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  className={[
                    "px-3 text-sm inline-flex items-center gap-1.5",
                    viewMode === "table"
                      ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                      : "bg-background hover:bg-muted text-zinc-600",
                  ].join(" ")}
                >
                  <LayoutList className="h-3.5 w-3.5" />
                  表格
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("images")}
                  className={[
                    "px-3 text-sm inline-flex items-center gap-1.5 border-l border-border",
                    viewMode === "images"
                      ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400"
                      : "bg-background hover:bg-muted text-zinc-600",
                  ].join(" ")}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  图片
                </button>
              </div>
              <button
                type="button"
                disabled={zipBusy || filtered.length === 0}
                onClick={() => void handleDownloadAllZip()}
                className="inline-flex items-center justify-center h-9 px-3 rounded-md border border-border bg-background hover:bg-muted text-sm font-medium transition-colors disabled:opacity-50"
                title="下载列表全部报告 ZIP"
              >
                <Download className="mr-1.5 h-4 w-4" />
                {zipBusy ? "打包中…" : "全部下载 ZIP"}
              </button>
            </>
          )}
          {scopeTab === "mine" && (
            <button
              type="button"
              onClick={() => {
                setAddProductOpen(true)
                void refreshMineProducts()
              }}
              className="inline-flex items-center justify-center h-9 px-3 rounded-md border border-border bg-background hover:bg-muted text-sm font-medium transition-colors"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              添加产品
            </button>
          )}
          <button
            type="button"
            onClick={() => setNewReportOpen(true)}
            className="inline-flex items-center justify-center h-9 px-3 rounded-md border border-border bg-background hover:bg-muted text-sm font-medium transition-colors"
          >
            新建报告
          </button>
        </div>
      </div>

      <NewReportDialog
        open={newReportOpen}
        onClose={() => setNewReportOpen(false)}
        onCustomReportSaved={() => {
          if (scopeTab === "mine") void refreshMineReports()
        }}
      />

      <MineAddProductDialog
        open={addProductOpen}
        products={mineProducts}
        busy={mineBusy}
        onClose={() => setAddProductOpen(false)}
        onAdd={handleAddMineProduct}
        onRemove={handleRemoveMineProduct}
        onRefreshGenerate={handleMineRegenerate}
      />

      {activeError && (
        <div className="mb-3 text-xs text-red-600 dark:text-red-400">{activeError}</div>
      )}
      {scopeTab === "mine" && mineMessage && (
        <div className="mb-3 text-xs text-sky-600 dark:text-sky-400">{mineMessage}</div>
      )}
      {showTools && zipMessage && (
        <div className="mb-3 text-xs text-sky-600 dark:text-sky-400">{zipMessage}</div>
      )}

      {showTools && viewMode === "images" ? (
        <div className="flex-1 min-h-0 overflow-auto">
          {showLoading ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
              <span className="text-sm">加载中…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
              <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
              <span className="text-sm">暂无报告</span>
              <span className="text-xs text-zinc-400 max-w-md text-center px-4">{emptyHint}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((r) => {
                const png = withInlinePng(r.download?.png)
                const pngHref = r.download?.png || ""
                const pngName = `${sanitizeFileToken(r.product_name || r.title || "report")}_${formatWeekRangeToken(r.weekStart, r.weekEnd) || r.reportId || "nav"}.png`
                return (
                  <div
                    key={`${r.kind}-${r.id}`}
                    className="rounded-lg border border-border bg-muted/10 overflow-hidden"
                  >
                    <div className="px-3 py-2 border-b flex items-center gap-2 min-w-0">
                      <div className="text-sm font-medium truncate flex-1 min-w-0">{resolveReportTitle(r, titleNameMode)}</div>
                      {pngHref ? (
                        <a
                          href={pngHref}
                          download={pngName}
                          className="shrink-0 inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-border bg-background hover:bg-muted text-xs font-medium text-zinc-700 dark:text-zinc-200"
                          title="下载 PNG"
                        >
                          <Download className="h-3.5 w-3.5" />
                          下载 PNG
                        </a>
                      ) : null}
                    </div>
                    <div className="px-3 py-1.5 text-[11px] text-zinc-500 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>{formatReportWeek(r.weekStart, r.weekEnd)}</span>
                      <span>净值 {r.latestNavDate || "—"}</span>
                      <span>{formatNavDaysBehind(r.navDaysBehindNextWeek)}</span>
                    </div>
                    <div className="bg-white">
                      {png ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={png} alt={resolveReportTitle(r, titleNameMode)} className="w-full bg-white" />
                      ) : (
                        <div className="h-40 flex items-center justify-center text-xs text-zinc-400">无预览</div>
                      )}
                    </div>
                    <div className="px-3 py-2 border-t flex items-center gap-3 text-xs">
                      {r.download?.pdf && (
                        <a href={r.download.pdf} className="text-sky-600 hover:underline" download>
                          PDF
                        </a>
                      )}
                      {pngHref ? (
                        <a
                          href={pngHref}
                          download={pngName}
                          className="inline-flex items-center gap-1 text-sky-600 hover:underline"
                        >
                          <Download className="h-3 w-3" />
                          下载 PNG
                        </a>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 bg-background border rounded-xl shadow-sm overflow-hidden flex flex-col">
          <div className="overflow-auto flex-1 min-h-0">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-20 bg-card shadow-sm [&_th]:bg-card">
                <tr>
                  <th className={`${thBase} w-16 text-center`}>序号</th>
                  <th className={thBase}>标题</th>
                  <th className={thBase}>报告周</th>
                  <th className={thBase}>最新净值日期</th>
                  <th className={thBase}>距下期缺日</th>
                  <th className={thBase}>模板</th>
                  <th className={thBase}>创建时间</th>
                  <th className={thBase}>创建人</th>
                  <th className={`${thBase} w-24 text-center`}>类型</th>
                  <th className={`${thBase} w-20 text-center`}>报告预览</th>
                  <th className={`${thBase} w-28 text-center`}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="h-48">
                      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                        <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" />
                        <span className="text-sm">{showLoading ? "加载中…" : "暂无报告"}</span>
                        <span className="text-xs text-zinc-400 max-w-md text-center px-4">{emptyHint}</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => (
                    <tr
                      key={`${r.kind}-${r.id}`}
                      className="border-b border-border last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-3 py-3 text-center text-zinc-500 text-xs">{i + 1}</td>
                      <td className="px-3 py-3 font-medium text-zinc-700 dark:text-zinc-200">{resolveReportTitle(r, titleNameMode)}</td>
                      <td className="px-3 py-3 text-zinc-500 text-xs whitespace-nowrap">
                        {formatReportWeek(r.weekStart, r.weekEnd)}
                      </td>
                      <td className="px-3 py-3 text-zinc-500 text-xs whitespace-nowrap">
                        {r.latestNavDate || "—"}
                      </td>
                      <td className="px-3 py-3 text-zinc-500 text-xs whitespace-nowrap">
                        {formatNavDaysBehind(r.navDaysBehindNextWeek)}
                      </td>
                      <td className="px-3 py-3 text-zinc-500 text-xs">{r.templateName}</td>
                      <td className="px-3 py-3 text-zinc-500 text-xs">
                        {new Date(r.createdAt).toLocaleString("zh-CN", { hour12: false })}
                      </td>
                      <td className="px-3 py-3 text-zinc-500 text-xs">{r.creator || "—"}</td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={[
                            "inline-flex px-2 py-0.5 rounded text-[10px] font-medium",
                            r.kind === "team"
                              ? "bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400"
                              : "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-400",
                          ].join(" ")}
                        >
                          {r.typeLabel}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <ReportPreviewThumb pngUrl={r.download?.png} title={resolveReportTitle(r, titleNameMode)} />
                      </td>
                      <td className="px-3 py-3 text-center text-xs space-x-2">
                        {r.download?.pdf ? (
                          <a href={r.download.pdf} className="text-sky-600 hover:underline" download>
                            PDF
                          </a>
                        ) : null}
                        {r.download?.png ? (
                          <a href={r.download.png} className="text-sky-600 hover:underline" download>
                            PNG
                          </a>
                        ) : null}
                        {!r.download?.pdf && !r.download?.png ? (
                          <span className="text-zinc-400">—</span>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
