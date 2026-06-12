"use client"

import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import {
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Filter,
  Search,
  X,
} from "lucide-react"

export interface PortfolioFundPickerItem {
  beian_hao: string
  product_name: string
  manager: string | null
  latest_nav_date: string | null
  ret_ytd: string | null
  ret_ann_since_inception: string | null
  inception_date: string | null
  show_team_nav_tag?: boolean
}

interface ApiFundRow {
  beian_hao: string
  product_name: string
  manager: string | null
  latest_nav_date: string | null
  ret_1y: string | null
  inception_date: string | null
}

interface ApiTrackRow {
  beian_hao: string
  product_name: string
  short_name: string | null
  manager: string | null
  latest_nav_date: string | null
  ret_1y: string | null
  inception_date: string | null
  sharpe_1y: string | null
}

const PRIMARY_TABS = [
  { key: "fund", label: "基金" },
  { key: "portfolio", label: "组合" },
  { key: "index", label: "指数" },
  { key: "style", label: "风格因子" },
  { key: "team", label: "团队跟踪" },
  { key: "mine", label: "我的跟踪" },
] as const

const FUND_CATEGORY_TABS = [
  { key: "private", label: "私募" },
  { key: "public", label: "公募" },
  { key: "team", label: "团队自建" },
  { key: "mine", label: "我的自建" },
] as const

const TEAM_POOL_OPTIONS = [
  { key: "bfl_ops", label: "bfl 运维池" },
  { key: "bfl", label: "bfl跟踪池" },
  { key: "tracking", label: "跟踪池" },
  { key: "selected", label: "精选池" },
  { key: "core", label: "核心池" },
  { key: "hy", label: "hy跟踪池" },
  { key: "fof", label: "FOF&MOM跟踪" },
] as const

const TEAM_CATEGORY_TABS = [
  { key: "private", label: "私募" },
  { key: "public", label: "公募" },
] as const

type PrimaryTab = (typeof PRIMARY_TABS)[number]["key"]
type FundCategoryTab = (typeof FUND_CATEGORY_TABS)[number]["key"]
type TeamPoolKey = (typeof TEAM_POOL_OPTIONS)[number]["key"]
type TeamCategoryTab = (typeof TEAM_CATEGORY_TABS)[number]["key"]
type SortKey = "product_name" | "latest_nav_date" | "ret_ytd" | "ret_ann" | "inception_date"
type SortDir = "asc" | "desc"

function fmtTrackPct(v: string | null | undefined) {
  if (v == null || v === "") return "—"
  const n = parseFloat(v)
  if (Number.isNaN(n)) return "—"
  const pct = Math.abs(n) <= 1 && !v.includes("%") ? n * 100 : n
  const cls = pct > 0 ? "text-red-500" : pct < 0 ? "text-green-600" : "text-foreground"
  return (
    <span className={cls}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
  return dir === "asc"
    ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
    : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
}

function mapSortToApi(sortKey: SortKey): string {
  if (sortKey === "latest_nav_date") return "latest_nav_date"
  if (sortKey === "ret_ytd" || sortKey === "ret_ann") return "ret_1y"
  if (sortKey === "inception_date") return "product_name"
  return "product_name"
}

export function PortfolioFundPickerDialog({
  open,
  onClose,
  onConfirm,
  existingIds = [],
}: {
  open: boolean
  onClose: () => void
  onConfirm: (items: PortfolioFundPickerItem[]) => void
  existingIds?: string[]
}) {
  const [fundClass, setFundClass] = useState<"private" | "public">("private")
  const [searchInput, setSearchInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("fund")
  const [fundCategory, setFundCategory] = useState<FundCategoryTab>("private")
  const [teamPool, setTeamPool] = useState<TeamPoolKey>("bfl")
  const [teamCategory, setTeamCategory] = useState<TeamCategoryTab>("private")
  const [cutoffDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [results, setResults] = useState<PortfolioFundPickerItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Map<string, PortfolioFundPickerItem>>(new Map())
  const [sortKey, setSortKey] = useState<SortKey>("product_name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)

  const resetState = useCallback(() => {
    setSearchInput("")
    setKeyword("")
    setPrimaryTab("fund")
    setFundCategory("private")
    setTeamPool("bfl")
    setTeamCategory("private")
    setFundClass("private")
    setResults([])
    setSelected(new Map())
    setSortKey("product_name")
    setSortDir("asc")
    setPage(1)
    setTotal(0)
    setTotalPages(0)
  }, [])

  useEffect(() => {
    if (!open) return
    resetState()
  }, [open, resetState])

  useEffect(() => {
    setPage(1)
  }, [primaryTab, keyword, teamPool, teamCategory, fundCategory, fundClass])

  useEffect(() => {
    if (!open) return

    if (primaryTab === "fund") {
      if (!keyword.trim()) {
        setResults([])
        setTotal(0)
        setTotalPages(0)
        return
      }

      setLoading(true)
      const params = new URLSearchParams({
        page: "1",
        keyword: keyword.trim(),
        cutoff: cutoffDate,
        sort: mapSortToApi(sortKey),
        dir: sortDir,
      })

      fetch(`/ma/api/private-funds/list?${params}`)
        .then((r) => r.json())
        .then((json) => {
          const rows: PortfolioFundPickerItem[] = (json.data ?? []).map((row: ApiFundRow) => ({
            beian_hao: row.beian_hao,
            product_name: row.product_name,
            manager: row.manager,
            latest_nav_date: row.latest_nav_date,
            ret_ytd: row.ret_1y,
            ret_ann_since_inception: row.ret_1y,
            inception_date: row.inception_date,
          }))
          setResults(rows)
          setTotal(json.total ?? rows.length)
          setTotalPages(json.totalPages ?? 1)
        })
        .catch(() => {
          setResults([])
          setTotal(0)
          setTotalPages(0)
        })
        .finally(() => setLoading(false))
      return
    }

    if (primaryTab === "team") {
      setLoading(true)
      const params = new URLSearchParams({
        page: String(page),
        pool: teamPool,
        cutoff: cutoffDate,
        sort: mapSortToApi(sortKey),
        dir: sortDir,
        keyword: keyword.trim(),
        strategy_source: "platform",
      })

      fetch(`/ma/api/tracking-funds/list?${params}`)
        .then((r) => r.json())
        .then((json) => {
          const rows: PortfolioFundPickerItem[] = (json.data ?? []).map((row: ApiTrackRow) => ({
            beian_hao: row.beian_hao,
            product_name: row.short_name || row.product_name,
            manager: row.manager,
            latest_nav_date: row.latest_nav_date,
            ret_ytd: row.ret_1y,
            ret_ann_since_inception: row.ret_1y,
            inception_date: row.inception_date,
            show_team_nav_tag: true,
          }))
          setResults(rows)
          setTotal(json.total ?? 0)
          setTotalPages(json.totalPages ?? 0)
        })
        .catch(() => {
          setResults([])
          setTotal(0)
          setTotalPages(0)
        })
        .finally(() => setLoading(false))
      return
    }

    setResults([])
    setTotal(0)
    setTotalPages(0)
  }, [open, primaryTab, keyword, cutoffDate, sortKey, sortDir, teamPool, teamCategory, page])

  function handleSort(col: SortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(col)
      setSortDir("desc")
    }
  }

  function toggleRow(item: PortfolioFundPickerItem) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(item.beian_hao)) next.delete(item.beian_hao)
      else next.set(item.beian_hao, item)
      return next
    })
  }

  function toggleAllVisible() {
    const visible = results.filter((r) => !existingIds.includes(r.beian_hao))
    const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.beian_hao))
    setSelected((prev) => {
      const next = new Map(prev)
      if (allSelected) visible.forEach((r) => next.delete(r.beian_hao))
      else visible.forEach((r) => next.set(r.beian_hao, r))
      return next
    })
  }

  function handleConfirm() {
    onConfirm(Array.from(selected.values()))
    onClose()
  }

  function pageButtons(): (number | "…")[] {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const btns: (number | "…")[] = [1]
    if (page > 3) btns.push("…")
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) btns.push(i)
    if (page < totalPages - 2) btns.push("…")
    if (totalPages > 1) btns.push(totalPages)
    return btns
  }

  if (!open || typeof document === "undefined") return null

  const selectedList = Array.from(selected.values())
  const thBase = "px-3 py-2.5 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap select-none"
  const thSort = thBase + " cursor-pointer hover:text-foreground transition-colors"
  const visibleSelectable = results.filter((r) => !existingIds.includes(r.beian_hao))
  const allVisibleSelected =
    visibleSelectable.length > 0 && visibleSelectable.every((r) => selected.has(r.beian_hao))
  const showEmptySearchHint = primaryTab === "fund" && !keyword.trim()
  const showPlaceholderTab = primaryTab !== "fund" && primaryTab !== "team"

  const resultsTable = showEmptySearchHint || showPlaceholderTab ? (
    <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-muted-foreground gap-3">
      <Search className="h-12 w-12 opacity-20" strokeWidth={1.25} />
      <span className="text-sm">请输入关键词搜索</span>
    </div>
  ) : (
    <>
      <table className="w-full text-sm border-collapse min-w-[860px]">
        <thead className="sticky top-0 bg-background z-10">
          <tr className="bg-muted/40 border-b">
            <th className="px-3 py-2.5 w-10">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                className="h-4 w-4 accent-red-600"
              />
            </th>
            <th className={thSort} onClick={() => handleSort("product_name")}>
              名称<SortIcon active={sortKey === "product_name"} dir={sortDir} />
            </th>
            <th className={thBase}>备案号</th>
            <th className={thBase}>管理人</th>
            <th className={thSort} onClick={() => handleSort("latest_nav_date")}>
              最新净值日期<SortIcon active={sortKey === "latest_nav_date"} dir={sortDir} />
            </th>
            <th className={thSort} onClick={() => handleSort("ret_ytd")}>
              今年以来收益<SortIcon active={sortKey === "ret_ytd"} dir={sortDir} />
            </th>
            <th className={thSort} onClick={() => handleSort("ret_ann")}>
              成立以来年化收益<SortIcon active={sortKey === "ret_ann"} dir={sortDir} />
            </th>
            <th className={thSort} onClick={() => handleSort("inception_date")}>
              成立日期<SortIcon active={sortKey === "inception_date"} dir={sortDir} />
            </th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={8} className="py-16 text-center text-muted-foreground text-sm">加载中…</td>
            </tr>
          ) : results.length === 0 ? (
            <tr>
              <td colSpan={8} className="py-16 text-center text-muted-foreground text-sm">未找到匹配基金</td>
            </tr>
          ) : (
            results.map((row) => {
              const disabled = existingIds.includes(row.beian_hao)
              const checked = selected.has(row.beian_hao)
              return (
                <tr
                  key={row.beian_hao}
                  className={[
                    "border-b last:border-b-0 transition-colors",
                    disabled ? "opacity-50" : "hover:bg-muted/30 cursor-pointer",
                    checked ? "bg-red-50/40 dark:bg-red-950/10" : "",
                  ].join(" ")}
                  onClick={() => !disabled && toggleRow(row)}
                >
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleRow(row)}
                      className="h-4 w-4 accent-red-600"
                    />
                  </td>
                  <td className="px-3 py-2.5 max-w-[180px] truncate" title={row.product_name}>{row.product_name}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{row.beian_hao}</td>
                  <td className="px-3 py-2.5 max-w-[120px] truncate">{row.manager ?? "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <div className="flex items-center gap-1.5">
                      <span>{row.latest_nav_date ?? "—"}</span>
                      {row.show_team_nav_tag && row.latest_nav_date && (
                        <span className="inline-flex px-1 py-0.5 rounded text-[10px] border border-amber-300/80 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700/50">
                          团队
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{fmtTrackPct(row.ret_ytd)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{fmtTrackPct(row.ret_ann_since_inception)}</td>
                  <td className="px-3 py-2.5 tabular-nums">{row.inception_date ?? "—"}</td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      {primaryTab === "team" && totalPages > 0 && (
        <div className="flex items-center justify-between gap-3 pt-4 mt-2 border-t text-sm">
          <span className="text-muted-foreground shrink-0">{total} 条</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-7 w-7 inline-flex items-center justify-center rounded border disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {pageButtons().map((btn, idx) =>
              btn === "…" ? (
                <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground">…</span>
              ) : (
                <button
                  key={btn}
                  type="button"
                  onClick={() => setPage(btn)}
                  className={[
                    "min-w-7 h-7 px-2 rounded border text-xs",
                    page === btn
                      ? "border-red-500 text-red-600 bg-red-50 dark:bg-red-950/20"
                      : "hover:bg-muted/50",
                  ].join(" ")}
                >
                  {btn}
                </button>
              ),
            )}
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-7 w-7 inline-flex items-center justify-center rounded border disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[1180px] h-[min(760px,calc(100vh-2rem))] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">选择基金</span>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 flex flex-col border-r">
            <div className="px-5 pt-4 pb-3 space-y-3 flex-shrink-0">
              <div className="flex items-center border rounded-lg overflow-hidden">
                <div className="relative shrink-0">
                  <select
                    value={fundClass}
                    onChange={(e) => setFundClass(e.target.value as "private" | "public")}
                    className="h-10 appearance-none pl-3 pr-8 text-sm bg-muted/40 border-r text-zinc-700 dark:text-zinc-300 focus:outline-none cursor-pointer"
                  >
                    <option value="private">私募基金</option>
                    <option value="public">公募基金</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                </div>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setKeyword(searchInput.trim())
                  }}
                  placeholder="请输入关键字，回车搜索"
                  className="flex-1 h-10 px-3 text-sm bg-background outline-none"
                />
                <button
                  type="button"
                  onClick={() => setKeyword(searchInput.trim())}
                  className="px-3 h-10 border-l hover:bg-muted/50 transition-colors"
                >
                  <Search className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 border-b">
                <div className="flex items-center gap-5 overflow-x-auto">
                  {PRIMARY_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setPrimaryTab(tab.key)}
                      className={[
                        "pb-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors",
                        primaryTab === tab.key
                          ? "border-red-500 text-red-600 dark:text-red-400 font-medium"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      ].join(" ")}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 pb-2.5 text-sm text-muted-foreground hover:text-foreground shrink-0"
                >
                  <Filter className="h-3.5 w-3.5" />
                  筛选
                </button>
              </div>

              {primaryTab === "team" ? (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-muted-foreground shrink-0">产品池：</span>
                    {TEAM_POOL_OPTIONS.map((pool) => (
                      <button
                        key={pool.key}
                        type="button"
                        onClick={() => setTeamPool(pool.key)}
                        className={[
                          "px-3 py-1 rounded text-xs font-medium border transition-colors",
                          teamPool === pool.key
                            ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                            : "border-border text-zinc-500 hover:border-red-200 hover:text-red-500",
                        ].join(" ")}
                      >
                        {pool.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-muted-foreground">分类：</span>
                    {TEAM_CATEGORY_TABS.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setTeamCategory(tab.key)}
                        className={[
                          "px-3 py-1 rounded text-xs font-medium border transition-colors",
                          teamCategory === tab.key
                            ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                            : "border-border text-zinc-500 hover:border-red-200 hover:text-red-500",
                        ].join(" ")}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">分类：</span>
                  {FUND_CATEGORY_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setFundCategory(tab.key)}
                      className={[
                        "px-3 py-1 rounded text-xs font-medium border transition-colors",
                        fundCategory === tab.key
                          ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                          : "border-border text-zinc-500 hover:border-red-200 hover:text-red-500",
                      ].join(" ")}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                指标计算截止日期(?)：<span className="text-foreground">{cutoffDate}</span>
              </p>
            </div>

            <div className="flex-1 min-h-0 overflow-auto px-5 pb-4">
              {resultsTable}
            </div>
          </div>

          <aside className="w-56 flex-shrink-0 flex flex-col bg-muted/10">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-sm font-medium">已选 ({selectedList.length})</span>
              <button
                type="button"
                onClick={() => setSelected(new Map())}
                disabled={selectedList.length === 0}
                className="text-xs text-red-500 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                清空
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {selectedList.length === 0 ? (
                <div className="h-full min-h-[120px]" />
              ) : (
                selectedList.map((item) => (
                  <div
                    key={item.beian_hao}
                    className="rounded border bg-background px-2.5 py-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate" title={item.product_name}>{item.product_name}</p>
                        <p className="text-muted-foreground mt-0.5 truncate">{item.beian_hao}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleRow(item)}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded border border-border text-sm hover:bg-muted transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={selectedList.length === 0}
            className="px-6 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            确定
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
