"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import {
  INSTRUCTION_FIELD_DEFAULT,
  InstructionsFieldConfigDialog,
  readInstructionFieldConfig,
  writeInstructionFieldConfig,
} from "./InstructionsFieldConfigDialog"

export type InstructionsListVariant = "handled" | "mine" | "all"

type CategoryTab = "underlying" | "direct" | "customer" | "pool"
type ProcessStatus = "pending" | "done"
type KeywordField = "fof" | "underlying" | "id" | "fundName"

type ColumnDef = {
  key: string
  label: string
  width: string
  sort?: boolean
  filter?: boolean
}

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

const POOL_KEYWORD_FIELD_OPTIONS: { key: KeywordField; label: string }[] = [
  { key: "fundName", label: "基金名称" },
]

const POOL_COLUMNS: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "fundManager", label: "基金/管理人名称", width: "min-w-[160px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "initiator", label: "发起人", width: "min-w-[90px]" },
  { key: "createdAt", label: "发起时间", width: "min-w-[140px]", sort: true },
  { key: "progress", label: "指令进度", width: "min-w-[100px]", filter: true },
  { key: "actions", label: "操作", width: "w-20 text-center" },
]

const FIXED_LEFT_COLUMNS_UNDERLYING: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "fof", label: "FOF基金", width: "min-w-[140px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "underlying", label: "底层基金", width: "min-w-[140px]" },
]

const FIXED_LEFT_COLUMNS_DIRECT: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "investor", label: "投资者名称", width: "min-w-[140px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "directProduct", label: "直投产品", width: "min-w-[140px]" },
]

const FIXED_LEFT_COLUMNS_CUSTOMER: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "customer", label: "客户名称", width: "min-w-[140px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "fundName", label: "基金名称", width: "min-w-[140px]" },
]

const FIXED_RIGHT_COLUMNS: ColumnDef[] = [
  { key: "progress", label: "指令进度", width: "min-w-[100px]", filter: true },
  { key: "actions", label: "操作", width: "w-20 text-center" },
]

const FIXED_RIGHT_COLUMNS_CUSTOMER: ColumnDef[] = [
  { key: "status", label: "指令状态", width: "min-w-[100px]", filter: true },
  { key: "actions", label: "操作", width: "w-20 text-center" },
]

const CONFIG_COLUMN_META: Record<string, Omit<ColumnDef, "label">> = {
  交易申请日期: { key: "applyDate", width: "min-w-[120px]", sort: true },
  申请金额: { key: "amount", width: "min-w-[100px]" },
  申请份额: { key: "shares", width: "min-w-[100px]" },
  确认净值: { key: "nav", width: "min-w-[90px]" },
  发起人: { key: "initiator", width: "min-w-[90px]" },
  实际申请日期: { key: "actualApplyDate", width: "min-w-[120px]", sort: true },
  交易确认日期: { key: "confirmDate", width: "min-w-[120px]", sort: true },
  确认金额: { key: "confirmAmount", width: "min-w-[100px]" },
  确认份额: { key: "confirmShares", width: "min-w-[100px]" },
  交易费用: { key: "tradeFee", width: "min-w-[90px]" },
  业绩报酬: { key: "perfFee", width: "min-w-[90px]" },
  转入申请金额: { key: "transferInAmount", width: "min-w-[110px]" },
  转入确认日期: { key: "transferInConfirmDate", width: "min-w-[120px]" },
  转入确认净值: { key: "transferInNav", width: "min-w-[110px]" },
  转入确认金额: { key: "transferInConfirmAmount", width: "min-w-[110px]" },
  转入确认份额: { key: "transferInConfirmShares", width: "min-w-[110px]" },
  转入交易费用: { key: "transferInFee", width: "min-w-[110px]" },
}

function leftColumnsForTab(categoryTab: CategoryTab): ColumnDef[] {
  if (categoryTab === "direct") return FIXED_LEFT_COLUMNS_DIRECT
  if (categoryTab === "customer") return FIXED_LEFT_COLUMNS_CUSTOMER
  return FIXED_LEFT_COLUMNS_UNDERLYING
}

function rightColumnsForTab(categoryTab: CategoryTab): ColumnDef[] {
  if (categoryTab === "customer") return FIXED_RIGHT_COLUMNS_CUSTOMER
  return FIXED_RIGHT_COLUMNS
}

function buildColumns(categoryTab: CategoryTab, selectedFields: string[]): ColumnDef[] {
  if (categoryTab === "pool") return POOL_COLUMNS
  const configurable = selectedFields.map((label) => {
    const meta = CONFIG_COLUMN_META[label] ?? {
      key: label,
      width: "min-w-[100px]",
    }
    return { ...meta, label }
  })
  return [
    ...leftColumnsForTab(categoryTab),
    ...configurable,
    ...rightColumnsForTab(categoryTab),
  ]
}

const thBase =
  "px-3 py-0 h-9 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap box-border leading-tight align-middle"

/** Native date inputs show OS-locale placeholders (e.g. yyyy/mm/日 on zh-CN Windows). Overlay our own text. */
function FilterDateInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="relative w-[168px]">
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => inputRef.current?.showPicker?.()}
        className={[
          "h-8 w-full rounded-md border border-border bg-background pl-2 pr-8 text-xs",
          "text-transparent caret-transparent",
          "[&::-webkit-datetime-edit]:text-transparent",
          "[&::-webkit-datetime-edit-fields-wrapper]:text-transparent",
          "[&::-webkit-datetime-edit-text]:text-transparent",
          "[&::-webkit-datetime-edit-year-field]:text-transparent",
          "[&::-webkit-datetime-edit-month-field]:text-transparent",
          "[&::-webkit-datetime-edit-day-field]:text-transparent",
          "[&::-webkit-calendar-picker-indicator]:absolute",
          "[&::-webkit-calendar-picker-indicator]:inset-0",
          "[&::-webkit-calendar-picker-indicator]:h-full",
          "[&::-webkit-calendar-picker-indicator]:w-full",
          "[&::-webkit-calendar-picker-indicator]:cursor-pointer",
          "[&::-webkit-calendar-picker-indicator]:opacity-0",
          "focus:outline-none focus:ring-1 focus:ring-ring",
        ].join(" ")}
      />
      <span
        className={[
          "pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs truncate max-w-[calc(100%-2rem)]",
          value ? "text-foreground" : "text-zinc-400",
        ].join(" ")}
      >
        {value || placeholder}
      </span>
      <CalendarDays className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
    </div>
  )
}

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
  const [showFieldConfig, setShowFieldConfig] = useState(false)
  const [selectedFields, setSelectedFields] = useState<string[]>(() => [...INSTRUCTION_FIELD_DEFAULT])

  useEffect(() => {
    setSelectedFields(readInstructionFieldConfig())
  }, [])

  const columns = useMemo(
    () => buildColumns(categoryTab, selectedFields),
    [categoryTab, selectedFields],
  )

  const showProcessStatus = variant === "handled"
  const total = 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rows = useMemo(() => [] as never[], [])

  function resetFilters() {
    setFofInput("")
    setUnderlyingInput("")
    setKeyword("")
    setKeywordField(categoryTab === "pool" ? "fundName" : "fof")
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

  const isPoolTab = categoryTab === "pool"
  const showUnderlyingFundFilters = !isAll && categoryTab === "underlying"
  const showFundKeyword =
    !isAll && (categoryTab === "direct" || categoryTab === "customer")
  const showPoolKeyword = !isAll && isPoolTab
  const showDateFilter = !isPoolTab
  const showFieldConfigButton = !isPoolTab
  const showQueryActions = !isPoolTab

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setCategoryTab(tab.key)
              if (tab.key === "pool") setKeywordField("fundName")
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

        {showUnderlyingFundFilters && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 shrink-0">FOF基金</span>
              <input
                value={fofInput}
                onChange={(e) => setFofInput(e.target.value)}
                placeholder="请输入并选择FOF基金"
                className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 shrink-0">底层基金</span>
              <input
                value={underlyingInput}
                onChange={(e) => setUnderlyingInput(e.target.value)}
                placeholder="请输入并选择底层基金"
                className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </>
        )}

        {showFundKeyword && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">基金</span>
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

        {showPoolKeyword && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">关键字</span>
            <div className="relative">
              <select
                value={keywordField}
                onChange={(e) => setKeywordField(e.target.value as KeywordField)}
                className="h-8 appearance-none rounded-md border border-border bg-background pl-2.5 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {POOL_KEYWORD_FIELD_OPTIONS.map((opt) => (
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

        {showDateFilter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">交易申请日期</span>
            <div className="flex items-center gap-1.5">
              <FilterDateInput
                value={dateFrom}
                onChange={setDateFrom}
                placeholder="请选择开始日期"
              />
              <span className="text-zinc-400">-</span>
              <FilterDateInput
                value={dateTo}
                onChange={setDateTo}
                placeholder="请选择结束日期"
              />
            </div>
          </div>
        )}

        {showQueryActions && (
          <>
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
          </>
        )}

        {(showFieldConfigButton || isAll) && (
          <div className="ml-auto flex items-center gap-3">
            {showFieldConfigButton && (
              <button
                type="button"
                onClick={() => setShowFieldConfig(true)}
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground transition-colors"
              >
                <Settings2 className="h-3.5 w-3.5" />
                字段配置
              </button>
            )}
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
        )}
      </div>

      <div className="flex-1 min-h-0 bg-background border rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm border-collapse min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-muted/40 dark:bg-muted/20">
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className={[thBase, col.width].join(" ")}>
                    <ColumnHeader
                      label={col.label}
                      sort={Boolean(col.sort)}
                      filter={Boolean(col.filter)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? null : (
                <tr>
                  <td colSpan={columns.length} className="h-56">
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

      <InstructionsFieldConfigDialog
        open={showFieldConfig}
        selected={selectedFields}
        onClose={() => setShowFieldConfig(false)}
        onConfirm={(fields) => {
          setSelectedFields(fields)
          writeInstructionFieldConfig(fields)
          setShowFieldConfig(false)
        }}
      />
    </div>
  )
}
