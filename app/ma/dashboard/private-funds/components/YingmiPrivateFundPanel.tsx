"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp, ChevronsUpDown, Loader2 } from "lucide-react"
import {
  compareYingmiRows,
  defaultYingmiSortDir,
  formatDrawdown,
  formatNav,
  formatReturn,
  shortManager,
  type YingmiProduct,
  type YingmiSortKey,
} from "@/lib/ma/yingmi-private-fund"

type CatalogProduct = YingmiProduct & { strategyLabel: string }

type Catalog = {
  connected: boolean
  status: string
  lastError: string | null
  updatedAt: string | null
  callsToday: number
  callsDay: string | null
  finishedOn: string | null
  treeTotal: number
  seedAsOf: string
  count: number
  strategies: { full: string; label: string; count: number }[]
  products: CatalogProduct[]
}

function currentUserId(): string {
  try {
    const raw = localStorage.getItem("currentUser")
    return raw ? (JSON.parse(raw)?.id ?? "") : ""
  } catch {
    return ""
  }
}

function userHeaders(): HeadersInit {
  const id = currentUserId()
  return id ? { "x-market-user-id": id } : {}
}

function returnClass(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value === 0) return "text-zinc-500"
  return value > 0 ? "text-red-500" : "text-emerald-600"
}

export function YingmiPrivateFundPanel({ notice }: { notice?: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [actionError, setActionError] = useState("")
  const [strategy, setStrategy] = useState("全部")
  const [keyword, setKeyword] = useState("")
  const [busy, setBusy] = useState("")
  const [sortKey, setSortKey] = useState<YingmiSortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/ma/api/yingmi-private-funds", { cache: "no-store" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "加载失败")
      setCatalog(json as Catalog)
    } catch (err) {
      setCatalog(null)
      setError(err instanceof Error ? err.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    const filtered = (catalog?.products ?? []).filter((row) => {
      if (strategy !== "全部" && row.strategyLevel1 !== strategy) return false
      if (!q) return true
      return `${row.fundName} ${row.companyName} ${row.strategyLabel}`.toLowerCase().includes(q)
    })
    if (!sortKey) return filtered
    return [...filtered].sort((a, b) => compareYingmiRows(a, b, sortKey, sortDir, (row) => (row as CatalogProduct).strategyLabel))
  }, [catalog, strategy, keyword, sortKey, sortDir])

  function toggleSort(key: YingmiSortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))
      return
    }
    setSortKey(key)
    setSortDir(defaultYingmiSortDir(key))
  }

  async function connect() {
    setBusy("connect")
    setActionError("")
    try {
      const res = await fetch("/ma/api/yingmi-private-funds/connect", { method: "POST", headers: userHeaders() })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || typeof json.url !== "string") throw new Error(typeof json.error === "string" ? json.error : "连接失败")
      window.location.href = json.url
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "连接失败")
      setBusy("")
    }
  }

  async function syncNow() {
    setBusy("sync")
    setActionError("")
    try {
      const res = await fetch("/ma/api/yingmi-private-funds/sync", { method: "POST", headers: userHeaders() })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : typeof json.reason === "string" ? json.reason : "拉取失败")
      window.setTimeout(() => void load(), 1500)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "拉取失败")
    } finally {
      setBusy("")
    }
  }

  const statusText = catalog ? describeStatus(catalog) : ""

  return (
    <div className="flex flex-col min-w-0 gap-4">
      <div className="rounded-xl border bg-background shadow-sm p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-3xl">
            <p className="text-xs text-muted-foreground leading-relaxed">
              盈米代销私募。服务器每周日、周一 08:10（北京时间）自动拉取。额度按自然日重置，周日没拉完的进度会在周一接着做。授权保存在服务器数据库里，定时任务不再打开浏览器。
            </p>
            {statusText && <p className="mt-2 text-sm">{statusText}</p>}
            {catalog?.lastError && catalog.status !== "complete" && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{catalog.lastError}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void connect()}
              disabled={busy === "connect"}
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              {catalog?.connected ? "重新连接盈米" : "连接盈米账号"}
            </button>
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={busy === "sync" || !catalog?.connected}
              className="inline-flex h-9 items-center rounded-md bg-red-500 px-4 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40"
            >
              {busy === "sync" ? "已开始拉取" : "现在拉取"}
            </button>
          </div>
        </div>
        {notice && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}
        {actionError && <p className="mt-3 text-sm text-red-600">{actionError}</p>}
      </div>

      <div className="rounded-xl border bg-background shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium">产品明细</div>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <FilterButton active={strategy === "全部"} onClick={() => setStrategy("全部")}>
              全部 {catalog?.count ?? 0}
            </FilterButton>
            {(catalog?.strategies ?? []).map((item) => (
              <FilterButton key={item.full} active={strategy === item.full} onClick={() => setStrategy(item.full)}>
                {item.label} {item.count}
              </FilterButton>
            ))}
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索产品或管理人"
              className="ml-1 h-7 w-40 rounded-md border border-zinc-200 bg-background px-2 text-xs dark:border-zinc-700"
            />
          </div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取盈米代销私募…
          </div>
        ) : error ? (
          <div className="px-5 py-12 text-sm text-red-600">{error}</div>
        ) : (
          <div className="overflow-x-auto max-h-[36rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50/95 dark:bg-zinc-900/95">
                <tr className="border-b text-xs text-zinc-500">
                  <SortHeader label="一级策略" active={sortKey === "strategy"} dir={sortDir} onClick={() => toggleSort("strategy")} align="left" />
                  <SortHeader label="产品名称" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name")} align="left" />
                  <SortHeader label="管理人" active={sortKey === "manager"} dir={sortDir} onClick={() => toggleSort("manager")} align="left" />
                  <SortHeader label="成立日" active={sortKey === "setup"} dir={sortDir} onClick={() => toggleSort("setup")} align="left" />
                  <SortHeader label="净值日" active={sortKey === "navDate"} dir={sortDir} onClick={() => toggleSort("navDate")} align="left" />
                  <SortHeader label="单位净值" active={sortKey === "nav"} dir={sortDir} onClick={() => toggleSort("nav")} />
                  <SortHeader label="近1年收益" active={sortKey === "return1y"} dir={sortDir} onClick={() => toggleSort("return1y")} />
                  <SortHeader label="近1年最大回撤" active={sortKey === "drawdown"} dir={sortDir} onClick={() => toggleSort("drawdown")} />
                  <SortHeader label="备注" active={sortKey === "note"} dir={sortDir} onClick={() => toggleSort("note")} align="left" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.fundCode} className="border-b last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">{row.strategyLabel}</td>
                    <td className="px-4 py-2">{row.fundName}</td>
                    <td className="px-4 py-2 text-muted-foreground">{shortManager(row.companyName) || "—"}</td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground whitespace-nowrap">{row.setupDate || "—"}</td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground whitespace-nowrap">{row.navDate || "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNav(row.navUnit)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${returnClass(row.return1y)}`}>{formatReturn(row.return1y)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-600">{formatDrawdown(row.maxDrawdown1y)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{row.note || ""}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">没有符合条件的产品</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function describeStatus(catalog: Catalog): string {
  const gap = Math.max(0, catalog.treeTotal - catalog.count)
  const head = `${catalog.count} 只已列入`
  const total = catalog.treeTotal > catalog.count ? `，策略树合计 ${catalog.treeTotal} 只，还差 ${gap} 只` : ""
  if (!catalog.connected) return `${head}${total}。服务器上还没有盈米授权，管理员点一次「连接盈米账号」后，周日和周一早上会自动拉。当前名单是 ${catalog.seedAsOf} 的快照。`
  if (catalog.status === "running") return `${head}${total}。正在拉取。`
  if (catalog.status === "paused_quota") return `${head}${total}。今天的额度已停，次日 0 点后周一或下周日会从断点继续。`
  if (catalog.status === "complete") return `${head}。本周已拉完${catalog.finishedOn ? `（${catalog.finishedOn}）` : ""}。`
  if (catalog.status === "error") return `${head}${total}。上次拉取没有完成。`
  return `${head}${total}。已连接，等待周日或周一 08:10 自动拉取。`
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = "right",
}: {
  label: string
  active: boolean
  dir: "asc" | "desc"
  onClick: () => void
  align?: "left" | "right"
}) {
  const icon = !active ? (
    <ChevronsUpDown className="h-3 w-3 opacity-40" />
  ) : dir === "asc" ? (
    <ChevronUp className="h-3 w-3" />
  ) : (
    <ChevronDown className="h-3 w-3" />
  )
  return (
    <th className={`px-4 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-0.5 cursor-pointer select-none ${align === "right" ? "float-right" : ""} ${active ? "text-foreground" : "hover:text-foreground"}`}
      >
        {label}
        {icon}
      </button>
    </th>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-7 items-center rounded-md border px-2.5 text-xs ${
        active
          ? "border-red-500 bg-red-50 font-medium text-red-600 dark:bg-red-950/40 dark:text-red-400"
          : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      }`}
    >
      {children}
    </button>
  )
}
