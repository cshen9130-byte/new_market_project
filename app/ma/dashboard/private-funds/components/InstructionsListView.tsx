"use client"

import { useMemo, useState } from "react"
import {
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronsUpDown,
  Download,
  Filter,
  Inbox,
  Settings2,
} from "lucide-react"

export type InstructionsListVariant = "handled" | "mine" | "all"

type CategoryTab = "underlying" | "direct" | "customer" | "pool"
type ProcessStatus = "pending" | "done"
type KeywordField = "fof" | "underlying" | "id"

const STANDARD_TABS: { key: CategoryTab; label: string }[] = [
  { key: "underlying", label: "底层申赎" },
  { key: "direct", label: "直投申赎" },
  { key: "customer", label: "客户申赎" },
  { key: "pool", label: "入/出池审批" },
]

const ALL_TABS: { key: CategoryTab; label: string }[] = [
  { key: "underlying", label: "申赎中继" },
  { key: "direct", label: "直投中继" },
  { key: "customer", label: "客户申赎" },
  { key: "pool", label: "入/出池审批" },
]

const KEYWORD_FIELD_OPTIONS: { key: KeywordField; label: string }[] = [
  { key: "fof", label: "FOF基金" },
  { key: "underlying", label: "底层基金" },
  { key: "id", label: "指令ID" },
]

const COLUMNS = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "fof", label: "FOF基金", width: "min-w-[140px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "underlying", label: "底层基金", width: "min-w-[140px]" },
  { key: "applyDate", label: "交易申请日期", width: "min-w-[120px]", sort: true },
  { key: "amount", label: "申请金额", width: "min-w-[100px]" },
  { key: "shares", label: "申请份额", width: "min-w-[100px]" },
  { key: "nav", label: "确认净值", width: "min-w-[90px]" },
  { key: "progress", label: "指令进度", width: "min-w-[100px]", filter: true },
  { key: "actions", label: "操作", width: "w-20 text-center" },
] as const

const thBase =
  "px-3 py-0 h-9 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap box-border leading-tight align-middle"

function ColumnHeader({
  label,
  sort,
  filter,
}: {
  label: string
  sort?: boolean
  filter?: boolean
}) {
  if (sort) {
    return (
      <span className="inline-flex items-center gap-0.5">
        {label}
        <ChevronsUpDown className="h-3 w-3 opacity-40" />
      </span>
    )
  }
  if (filter) {
    return (
      <span className="inline-flex items-center gap-0.5">
        {label}
        <Filter className="h-3 w-3 opacity-40" />
      </span>
    )
  }
  return <>{label}</>
}

export function InstructionsListView({ variant }: { variant: InstructionsListVariant }) {
  const isAll = variant === "all"
  const tabs = isAll ? ALL_TABS : STANDARD_TABS

  const [categoryTab, setCategoryTab] = useState<CategoryTab>("underlying")
  const [processStatus, setProcessStatus] = useState<ProcessStatus>("pending")
  const [fofInput, setFofInput] = useState("")
  const [underlyingInput, setUnderlyingInput] = useState("")
  const [keywordField, setKeywordField] = useState<KeywordField>("fof")
  const [keyword, setKeyword] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [pageInput, setPageInput] = useState("1")

  const showProcessStatus = variant === "handled"
  const total = 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rows = useMemo(() => [] as never[], [])

  function resetFilters() {
    setFofInput("")
    setUnderlyingInput("")
    setKeyword("")
    setKeywordField("fof")
    setDateFrom("")
    setDateTo("")
    setPage(1)
    setPageInput("1")
  }

  function handleSearch() {
    setPage(1)
    setPageInput("1")
  }

  function goToPage(next: number) {
    const clamped = Math.min(totalPages, Math.max(1, next))
    setPage(clamped)
    setPageInput(String(clamped))
  }

  const showFundFilters = !isAll && (categoryTab === "underlying" || categoryTab === "direct")
  const firstFundLabel = categoryTab === "direct" ? "基金产品" : "FOF基金"
  const secondFundLabel = categoryTab === "direct" ? "关联产品" : "底层基金"
  const firstFundPlaceholder =
    categoryTab === "direct" ? "请输入并选择基金产品" : "请输入并选择FOF基金"
  const secondFundPlaceholder =
    categoryTab === "direct" ? "请输入并选择关联产品" : "请输入并选择底层基金"

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setCategoryTab(tab.key)
              setPage(1)
              setPageInput("1")
            }}
            className={[
              "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              categoryTab === tab.key
                ? "border-red-500 text-red-600 dark:text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 flex-shrink-0">
        {showProcessStatus && (
          <div className="inline-flex items-center rounded-md overflow-hidden border border-border/80">
            {([
              ["pending", "待处理"],
              ["done", "已处理"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setProcessStatus(key)
                  setPage(1)
                  setPageInput("1")
                }}
                className={[
                  "h-8 px-3.5 text-sm transition-colors",
                  processStatus === key
                    ? "bg-red-500 text-white"
                    : "bg-background text-zinc-600 hover:bg-muted/50",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {isAll && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">关键字</span>
            <div className="relative">
              <select
                value={keywordField}
                onChange={(e) => setKeywordField(e.target.value as KeywordField)}
                className="h-8 appearance-none rounded-md border border-border bg-background pl-2.5 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {KEYWORD_FIELD_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            </div>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
              placeholder="请输入关键字，回车搜索"
              className="h-8 w-56 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {showFundFilters && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 shrink-0">{firstFundLabel}</span>
              <input
                value={fofInput}
                onChange={(e) => setFofInput(e.target.value)}
                placeholder={firstFundPlaceholder}
                className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 shrink-0">{secondFundLabel}</span>
              <input
                value={underlyingInput}
                onChange={(e) => setUnderlyingInput(e.target.value)}
                placeholder={secondFundPlaceholder}
                className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </>
        )}

        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 shrink-0">交易申请日期</span>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 w-[148px] rounded-md border border-border bg-background pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <span className="text-zinc-400">~</span>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 w-[148px] rounded-md border border-border bg-background pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSearch}
          className="h-8 px-4 rounded-md bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
        >
          查询
        </button>
        {!isAll && (
          <button
            type="button"
            onClick={resetFilters}
            className="h-8 px-4 rounded-md border border-border bg-background text-sm text-zinc-600 hover:bg-muted/50 transition-colors"
          >
            重置
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5" />
            字段配置
          </button>
          {isAll && (
            <>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                导出
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground transition-colors"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                分级修正
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-background border rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm border-collapse min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-muted/40 dark:bg-muted/20">
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} className={[thBase, col.width].join(" ")}>
                    <ColumnHeader
                      label={col.label}
                      sort={"sort" in col && col.sort}
                      filter={"filter" in col && col.filter}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? null : (
                <tr>
                  <td colSpan={COLUMNS.length} className="h-56">
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                      <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />
                      <span className="text-sm">暂无数据</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3 border-t flex-shrink-0 text-sm text-zinc-500">
          <span>共 {total} 条</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="p-1 rounded hover:bg-muted/60 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              ‹
            </button>
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={() => goToPage(Number(pageInput) || 1)}
              onKeyDown={(e) => {
                if (e.key === "Enter") goToPage(Number(pageInput) || 1)
              }}
              className="w-10 h-7 text-center rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              className="p-1 rounded hover:bg-muted/60 disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              ›
            </button>
          </div>
          <div className="relative">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
                setPageInput("1")
              }}
              className="h-8 appearance-none rounded border border-border bg-background pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {[20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} 条/页
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>
    </div>
  )
}
