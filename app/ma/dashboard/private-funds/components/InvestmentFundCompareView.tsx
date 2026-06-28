"use client"

import { useEffect, useState } from "react"
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Filter,
  Inbox,
  MoreHorizontal,
  Search,
  Trash2,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  PortfolioFundPickerDialog,
  type PortfolioFundPickerItem,
} from "@/components/ma/portfolio-fund-picker-dialog"
import {
  createFundCompareFromPicker,
  deleteFundCompare,
  loadLocalFundCompareRows,
  saveFundCompare,
} from "@/lib/ma-fund-compare-storage"

type CompareScope = "team" | "mine"
type CompareSortKey = "name" | "fund_count" | "updated_by" | "updated_date" | "created_by"
type SortDir = "asc" | "desc"

interface FundCompareRow {
  id: string
  name: string
  team_tags: string[]
  fund_count: number
  share_status: string | null
  updated_by: string | null
  updated_date: string | null
  created_by: string | null
}

function currentUserId(): string {
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    return u?.id ?? ""
  } catch {
    return ""
  }
}

function userFetchHeaders(): Record<string, string> {
  const id = currentUserId()
  return id ? { "x-market-user-id": id } : {}
}

export function InvestmentFundCompareView() {
  const [scopeTab, setScopeTab] = useState<CompareScope>("team")
  const [teamTagOptions, setTeamTagOptions] = useState<string[]>([])
  const [personalTagOptions, setPersonalTagOptions] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [kwInput, setKwInput] = useState("")
  const [keyword, setKeyword] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState<FundCompareRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState<CompareSortKey>("name")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [creatorFilter, setCreatorFilter] = useState("")
  const [showCreatorFilter, setShowCreatorFilter] = useState(false)
  const [showFundPicker, setShowFundPicker] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const tagOptions = scopeTab === "team" ? teamTagOptions : personalTagOptions

  useEffect(() => {
    fetch("/ma/api/ops/team-tags?category=compare")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setTeamTagOptions(d.map((t: { name: string }) => t.name))
      })
      .catch(() => {})
    fetch(`/ma/api/ops/team-tags?category=compare_personal&owner=${encodeURIComponent(currentUserId())}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setPersonalTagOptions(d.map((t: { name: string }) => t.name))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setPage(1)
  }, [scopeTab, keyword, selectedTags.join("\u0001"), pageSize, creatorFilter])

  function loadCompareList() {
    setLoading(true)
    const params = new URLSearchParams({
      scope: scopeTab,
      page: String(page),
      pageSize: String(pageSize),
      sort: sortKey,
      dir: sortDir,
      keyword,
    })
    selectedTags.forEach((t) => params.append("tag", t))
    if (creatorFilter.trim()) params.set("creator", creatorFilter.trim())

    fetch(`/ma/api/fund-compare/list?${params}`, { headers: userFetchHeaders() })
      .then((r) => r.json())
      .then((json) => {
        const remote = Array.isArray(json.data) ? json.data as FundCompareRow[] : []
        const local = loadLocalFundCompareRows(scopeTab, keyword)
        const merged = [...local, ...remote.filter((r) => !local.some((l) => l.id === r.id))]
        const filtered = creatorFilter.trim()
          ? merged.filter((r) => (r.created_by ?? "").includes(creatorFilter.trim()))
          : merged
        const dir = sortDir === "asc" ? 1 : -1
        filtered.sort((a, b) => {
          const av = a[sortKey as keyof FundCompareRow]
          const bv = b[sortKey as keyof FundCompareRow]
          if (sortKey === "fund_count") return ((Number(av) || 0) - (Number(bv) || 0)) * dir
          return String(av ?? "").localeCompare(String(bv ?? ""), "zh-CN") * dir
        })
        const start = (page - 1) * pageSize
        setData(filtered.slice(start, start + pageSize))
        setTotal(filtered.length)
      })
      .catch(() => {
        const local = loadLocalFundCompareRows(scopeTab, keyword)
        const start = (page - 1) * pageSize
        setData(local.slice(start, start + pageSize))
        setTotal(local.length)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadCompareList()
  }, [scopeTab, page, pageSize, sortKey, sortDir, keyword, selectedTags, creatorFilter])

  useEffect(() => {
    function onUpdated() {
      loadCompareList()
    }
    window.addEventListener("ma-fund-compares-updated", onUpdated)
    return () => window.removeEventListener("ma-fund-compares-updated", onUpdated)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeTab, page, pageSize, sortKey, sortDir, keyword, selectedTags, creatorFilter])

  function handleSort(col: CompareSortKey) {
    if (col === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(col)
      setSortDir("desc")
    }
    setPage(1)
  }

  function SortIcon({ col }: { col: CompareSortKey }) {
    if (col !== sortKey) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
  }

  function handleDelete(row: FundCompareRow) {
    if (!window.confirm(`确定删除对比组「${row.name}」吗？`)) return
    deleteFundCompare(row.id)
    loadCompareList()
  }

  function pageButtons(): (number | "…")[] {
    const btns: (number | "…")[] = []
    const lo = Math.max(1, page - 2)
    const hi = Math.min(totalPages, page + 2)
    if (lo > 1) {
      btns.push(1)
      if (lo > 2) btns.push("…")
    }
    for (let i = lo; i <= hi; i++) btns.push(i)
    if (hi < totalPages) {
      if (hi < totalPages - 1) btns.push("…")
      btns.push(totalPages)
    }
    return btns
  }

  const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400 whitespace-nowrap select-none"
  const thSort = thBase + " cursor-pointer hover:text-foreground transition-colors"
  const colCount = 9

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0">
        {(["team", "mine"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setScopeTab(t); setSelectedTags([]) }}
            className={[
              "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              scopeTab === t
                ? "border-red-500 text-red-600 dark:text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t === "team" ? "团队对比" : "我的对比"}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4 mb-3 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-4 flex-wrap flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-zinc-500 shrink-0">
              {scopeTab === "team" ? "团队标签：" : "个人标签："}
            </span>
            <button
              onClick={() => setSelectedTags([])}
              className={[
                "inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium border transition-colors",
                selectedTags.length === 0
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              不限
            </button>
            {tagOptions.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={[
                  "inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium border transition-colors",
                  selectedTags.includes(tag)
                    ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20"
                    : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
                ].join(" ")}
              >
                {tag}
              </button>
            ))}
          </div>
          <div className="relative">
            <input
              type="text"
              value={kwInput}
              onChange={(e) => setKwInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setKeyword(kwInput.trim()); setPage(1) } }}
              placeholder="请输入对比组合名称，按回车搜索"
              className="h-8 w-72 pl-3 pr-8 border rounded-lg text-sm bg-background outline-none focus:ring-1 focus:ring-ring"
            />
            <Search
              className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground cursor-pointer"
              onClick={() => { setKeyword(kwInput.trim()); setPage(1) }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowFundPicker(true)}
          className="inline-flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex-shrink-0"
        >
          新建对比
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border flex-1">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1100 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
              <th className={`${thBase} w-10 border-b`}>序号</th>
              <th className={`${thSort} border-b min-w-[180px]`} onClick={() => handleSort("name")}>
                基金对比组名称<SortIcon col="name" />
              </th>
              <th className={`${thBase} border-b min-w-[100px]`}>
                {scopeTab === "team" ? "团队标签" : "个人标签"}
              </th>
              <th className={`${thSort} border-b min-w-[88px]`} onClick={() => handleSort("fund_count")}>
                包含基金数<SortIcon col="fund_count" />
              </th>
              <th className={`${thBase} border-b min-w-[80px]`}>共享状态</th>
              <th className={`${thSort} border-b min-w-[88px]`} onClick={() => handleSort("updated_by")}>
                最近修改<SortIcon col="updated_by" />
              </th>
              <th className={`${thSort} border-b min-w-[100px]`} onClick={() => handleSort("updated_date")}>
                修改日期<SortIcon col="updated_date" />
              </th>
              <th className={`${thSort} border-b min-w-[80px] relative`} onClick={() => handleSort("created_by")}>
                <span className="inline-flex items-center gap-1">
                  创建人
                  <SortIcon col="created_by" />
                  <button
                    type="button"
                    className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                    onClick={(e) => { e.stopPropagation(); setShowCreatorFilter((v) => !v) }}
                    title="筛选创建人"
                  >
                    <Filter className="h-3 w-3" />
                  </button>
                </span>
                {showCreatorFilter && (
                  <>
                    <div
                      className="absolute left-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg p-2 min-w-[140px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="text"
                        value={creatorFilter}
                        onChange={(e) => setCreatorFilter(e.target.value)}
                        placeholder="输入创建人"
                        className="w-full h-7 border rounded px-2 text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
                        autoFocus
                      />
                    </div>
                    <div className="fixed inset-0 z-30" onClick={() => setShowCreatorFilter(false)} />
                  </>
                )}
              </th>
              <th className={`${thBase} border-b text-center w-16`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} className="py-20 text-center text-foreground">加载中…</td></tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : data.map((row, i) => (
              <tr key={row.id} className="group hover:bg-muted/30 transition-colors">
                <td className="border-b px-3 py-2 text-center tabular-nums text-muted-foreground">
                  {(page - 1) * pageSize + i + 1}
                </td>
                <td className="border-b px-3 py-2 font-medium">
                  <a
                    href={`/ma/dashboard/private-funds/fund-compare/${encodeURIComponent(row.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {row.name}
                  </a>
                </td>
                <td className="border-b px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {row.team_tags.length > 0 ? row.team_tags.map((t) => (
                      <span
                        key={t}
                        className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-red-50 text-red-500 border border-red-200 dark:bg-red-950/20 dark:border-red-800"
                      >
                        {t}
                      </span>
                    )) : <span className="text-muted-foreground">—</span>}
                  </div>
                </td>
                <td className="border-b px-3 py-2 tabular-nums">{row.fund_count}</td>
                <td className="border-b px-3 py-2">{row.share_status ?? "—"}</td>
                <td className="border-b px-3 py-2">{row.updated_by ?? "—"}</td>
                <td className="border-b px-3 py-2 tabular-nums whitespace-nowrap text-xs text-muted-foreground">
                  {row.updated_date ?? "—"}
                </td>
                <td className="border-b px-3 py-2">{row.created_by ?? "—"}</td>
                <td className="border-b px-3 py-2 text-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                        title="更多操作"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-28">
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => handleDelete(row)}
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-3 pb-0.5 flex-shrink-0">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          共 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{total.toLocaleString()}</span> 条
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ‹
          </button>
          {pageButtons().map((btn, idx) =>
            btn === "…" ? (
              <span key={`e${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">…</span>
            ) : (
              <button
                key={btn}
                onClick={() => setPage(btn as number)}
                className={[
                  "w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors",
                  btn === page
                    ? "bg-red-500 text-white border-red-500 font-medium shadow-sm"
                    : "text-foreground hover:bg-muted border-border",
                ].join(" ")}
              >
                {btn}
              </button>
            )
          )}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || totalPages <= 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ›
          </button>
          <div className="relative ml-3">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-7 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {[50, 100, 200].map((n) => <option key={n} value={n}>{n} 条/页</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>

      <PortfolioFundPickerDialog
        open={showFundPicker}
        title="选择"
        onClose={() => setShowFundPicker(false)}
        onConfirm={(items: PortfolioFundPickerItem[]) => {
          if (items.length === 0) return
          const compare = createFundCompareFromPicker(items, scopeTab)
          saveFundCompare(compare)
          setShowFundPicker(false)
          window.open(
            `/ma/dashboard/private-funds/fund-compare/${encodeURIComponent(compare.id)}`,
            "_blank",
            "noopener,noreferrer",
          )
        }}
      />
    </div>
  )
}
