"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import {
  CheckSquare,
  ChevronDown,
  ChevronsUpDown,
  Copy,
  Download,
  Eye,
  Filter,
  History,
  Inbox,
  Pencil,
  Settings2,
  Trash2,
} from "lucide-react"
import { DateInput } from "@/components/ui/date-input"
import {
  INSTRUCTION_FIELD_DEFAULT,
  INSTRUCTION_FIELD_LOCKED,
  InstructionsFieldConfigDialog,
  readInstructionFieldConfig,
  writeInstructionFieldConfig,
} from "./InstructionsFieldConfigDialog"
import {
  getInstructionRecordsServerSnapshot,
  getInstructionRecordsSnapshot,
  listInstructionRecords,
  subscribeInstructionRecords,
  type InstructionRecord,
} from "./instructions-store"

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
  { key: "underlying", label: "底层申赎" },
  { key: "direct", label: "直投申赎" },
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

const CUSTOMER_KEYWORD_FIELD_OPTIONS: { key: KeywordField; label: string }[] = [
  { key: "fundName", label: "基金名称" },
]

/** 我发起的/我处理的 → 入/出池审批 (no 发起人) */
const POOL_COLUMNS: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "fundManager", label: "基金/管理人名称", width: "min-w-[160px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "createdAt", label: "发起时间", width: "min-w-[140px]", sort: true },
  { key: "progress", label: "指令进度", width: "min-w-[100px]", filter: true },
  { key: "actions", label: "操作", width: "w-20 text-center" },
]

/** 所有指令 → 入/出池审批 (includes 发起人) */
const POOL_COLUMNS_ALL: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "fundManager", label: "基金/管理人名称", width: "min-w-[160px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "createdAt", label: "发起时间", width: "min-w-[140px]", sort: true },
  { key: "initiator", label: "发起人", width: "min-w-[90px]" },
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

/** 所有指令 → 直投申赎 uses 直投基金 instead of 直投产品 */
const FIXED_LEFT_COLUMNS_DIRECT_ALL: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "investor", label: "投资者名称", width: "min-w-[140px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "directFund", label: "直投基金", width: "min-w-[140px]" },
]

const FIXED_LEFT_COLUMNS_CUSTOMER: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "customer", label: "客户名称", width: "min-w-[140px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "fundName", label: "基金名称", width: "min-w-[140px]" },
]

const FIXED_RIGHT_COLUMNS_PROGRESS: ColumnDef[] = [
  { key: "progress", label: "指令进度", width: "min-w-[120px]", filter: true },
  { key: "actions", label: "操作", width: "min-w-[140px] text-center" },
]

const FIXED_RIGHT_COLUMNS_STATUS: ColumnDef[] = [
  { key: "status", label: "指令状态", width: "min-w-[100px]", filter: true },
  { key: "actions", label: "操作", width: "min-w-[140px] text-center" },
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

function leftColumnsForTab(categoryTab: CategoryTab, isAll: boolean): ColumnDef[] {
  if (categoryTab === "direct") {
    return isAll ? FIXED_LEFT_COLUMNS_DIRECT_ALL : FIXED_LEFT_COLUMNS_DIRECT
  }
  if (categoryTab === "customer") return FIXED_LEFT_COLUMNS_CUSTOMER
  return FIXED_LEFT_COLUMNS_UNDERLYING
}

function rightColumnsForTab(_categoryTab: CategoryTab): ColumnDef[] {
  return FIXED_RIGHT_COLUMNS_PROGRESS
}

function fieldsForTab(
  categoryTab: CategoryTab,
  selectedFields: string[],
  isAll: boolean,
): string[] {
  // 客户申赎 always hides 发起人; 直投 hides it except on 所有指令
  if (categoryTab === "customer") {
    return selectedFields.filter((f) => f !== "发起人")
  }
  if (!isAll && categoryTab === "direct") {
    return selectedFields.filter((f) => f !== "发起人")
  }
  return selectedFields
}

function buildColumns(
  categoryTab: CategoryTab,
  selectedFields: string[],
  isAll: boolean,
): ColumnDef[] {
  if (categoryTab === "pool") return isAll ? POOL_COLUMNS_ALL : POOL_COLUMNS
  const configurable = fieldsForTab(categoryTab, selectedFields, isAll).map((label) => {
    const meta = CONFIG_COLUMN_META[label] ?? {
      key: label,
      width: "min-w-[100px]",
    }
    return { ...meta, label }
  })
  return [
    ...leftColumnsForTab(categoryTab, isAll),
    ...configurable,
    ...rightColumnsForTab(categoryTab),
  ]
}

const thBase =
  "px-3 py-0 h-9 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap box-border leading-tight align-middle"

/** See docs/date-input-locale-placeholder.md — use shared DateInput. */
function FilterDateInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <DateInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-[168px]"
      inputClassName="h-8 rounded-md pl-2 pr-8 text-xs"
      displayClassName="left-2 text-xs"
    />
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

function cellDash(value: string | null | undefined) {
  if (value == null || value === "") return "-"
  return value
}

function renderInstructionCell(colKey: string, row: InstructionRecord, index: number) {
  switch (colKey) {
    case "index":
      return index
    case "id":
      return row.id
    case "fof":
    case "investor":
    case "customer":
      return row.fofFundName
    case "type":
      return (
        <span className="inline-flex rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
          {row.type}
        </span>
      )
    case "underlying":
    case "fundName":
      return row.underlyingFundName
    case "applyDate":
      return row.applyDate
    case "amount":
      return row.amount
    case "shares":
      return cellDash(row.shares)
    case "nav":
      return cellDash(row.nav)
    case "progress":
    case "status":
      return (
        <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {row.progress}
        </span>
      )
    case "initiator":
      return row.initiator
    case "actions":
      return (
        <div className="inline-flex items-center justify-center gap-1.5 text-zinc-400">
          <button type="button" className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200" title="查看">
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200" title="流转">
            <History className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200" title="复制">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200" title="编辑">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200" title="删除">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )
    default:
      return "-"
  }
}

export function InstructionsListView({ variant }: { variant: InstructionsListVariant }) {
  const isAll = variant === "all"
  const tabs = isAll ? ALL_TABS : STANDARD_TABS

  const [categoryTab, setCategoryTab] = useState<CategoryTab>("underlying")
  const [processStatus, setProcessStatus] = useState<ProcessStatus>("pending")
  const [fofInput, setFofInput] = useState("")
  const [underlyingInput, setUnderlyingInput] = useState("")
  const [customerInput, setCustomerInput] = useState("")
  const [keywordField, setKeywordField] = useState<KeywordField>("fof")
  const [keyword, setKeyword] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [appliedFof, setAppliedFof] = useState("")
  const [appliedUnderlying, setAppliedUnderlying] = useState("")
  const [appliedDateFrom, setAppliedDateFrom] = useState("")
  const [appliedDateTo, setAppliedDateTo] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [pageInput, setPageInput] = useState("1")
  const [showFieldConfig, setShowFieldConfig] = useState(false)
  const [selectedFields, setSelectedFields] = useState<string[]>(() => [...INSTRUCTION_FIELD_DEFAULT])

  const allRecords = useSyncExternalStore(
    subscribeInstructionRecords,
    getInstructionRecordsSnapshot,
    getInstructionRecordsServerSnapshot,
  )

  useEffect(() => {
    setSelectedFields(readInstructionFieldConfig())
  }, [])

  const columns = useMemo(
    () => buildColumns(categoryTab, selectedFields, isAll),
    [categoryTab, selectedFields, isAll],
  )

  const showProcessStatus = variant === "handled"

  const filteredRows = useMemo(() => {
    let next = listInstructionRecords({ category: categoryTab, variant })
    if (categoryTab === "underlying") {
      const fofQ = appliedFof.trim()
      const undQ = appliedUnderlying.trim()
      if (fofQ) next = next.filter((r) => r.fofFundName.includes(fofQ))
      if (undQ) next = next.filter((r) => r.underlyingFundName.includes(undQ))
      if (appliedDateFrom) next = next.filter((r) => r.applyDate >= appliedDateFrom)
      if (appliedDateTo) next = next.filter((r) => r.applyDate <= appliedDateTo)
    }
    return next
  }, [
    allRecords,
    categoryTab,
    variant,
    appliedFof,
    appliedUnderlying,
    appliedDateFrom,
    appliedDateTo,
  ])

  const total = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rows = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredRows.slice(start, start + pageSize)
  }, [filteredRows, page, pageSize])

  function resetFilters() {
    setFofInput("")
    setUnderlyingInput("")
    setCustomerInput("")
    setKeyword("")
    setKeywordField(
      categoryTab === "pool" || categoryTab === "customer" ? "fundName" : "fof",
    )
    setDateFrom("")
    setDateTo("")
    setAppliedFof("")
    setAppliedUnderlying("")
    setAppliedDateFrom("")
    setAppliedDateTo("")
    setPage(1)
    setPageInput("1")
  }

  function handleSearch() {
    setAppliedFof(fofInput)
    setAppliedUnderlying(underlyingInput)
    setAppliedDateFrom(dateFrom)
    setAppliedDateTo(dateTo)
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
  const showFundKeyword = !isAll && categoryTab === "direct"
  const showCustomerFilter = !isAll && categoryTab === "customer"
  const showPoolKeyword = isPoolTab
  /** 所有指令 → 底层: keyword field dropdown (FOF/底层/ID) */
  const showAllUnderlyingKeyword = isAll && categoryTab === "underlying"
  /** 所有指令 → 直投: simple keyword (no field dropdown) */
  const showAllDirectKeyword = isAll && categoryTab === "direct"
  /** 所有指令 → 客户: keyword dropdown (基金名称) */
  const showAllCustomerKeyword = isAll && categoryTab === "customer"
  const showDateFilter = !isPoolTab
  /** 所有指令 → 入/出池: no 字段配置 / 分级修正, only 导出 */
  const showFieldConfigButton = !(isAll && isPoolTab)
  const showGradeCorrection = isAll && !isPoolTab
  const showQueryActions = !isPoolTab
  const hideInitiatorInFieldConfig =
    categoryTab === "customer" || (!isAll && categoryTab === "direct")

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setCategoryTab(tab.key)
              if (tab.key === "pool" || tab.key === "customer") {
                setKeywordField("fundName")
              } else if (tab.key === "underlying") {
                setKeywordField("fof")
              }
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

        {showAllUnderlyingKeyword && (
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

        {showAllDirectKeyword && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">关键字</span>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
              placeholder="输入基金名称/指令ID，回车以搜索"
              className="h-8 w-64 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {showAllCustomerKeyword && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">关键字</span>
            <div className="relative">
              <select
                value={keywordField}
                onChange={(e) => setKeywordField(e.target.value as KeywordField)}
                className="h-8 appearance-none rounded-md border border-border bg-background pl-2.5 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {CUSTOMER_KEYWORD_FIELD_OPTIONS.map((opt) => (
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

        {showCustomerFilter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">客户</span>
            <input
              value={customerInput}
              onChange={(e) => setCustomerInput(e.target.value)}
              placeholder="请输入并选择客户"
              className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
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
                  disabled={total === 0}
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出
                </button>
                {showGradeCorrection && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground transition-colors"
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                    分级修正
                  </button>
                )}
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
              {rows.length > 0 ? (
                rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className="border-t border-zinc-100 hover:bg-muted/30 dark:border-zinc-800"
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={[
                          "px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 whitespace-nowrap",
                          col.key === "index" || col.key === "actions" ? "text-center" : "",
                          col.width,
                        ].join(" ")}
                      >
                        {renderInstructionCell(col.key, row, (page - 1) * pageSize + i + 1)}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
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
        hiddenFields={hideInitiatorInFieldConfig ? ["发起人"] : undefined}
        lockedFields={
          hideInitiatorInFieldConfig
            ? INSTRUCTION_FIELD_LOCKED.filter((f) => f !== "发起人")
            : undefined
        }
        onClose={() => setShowFieldConfig(false)}
        onConfirm={(fields) => {
          // Persist 发起人 for 底层申赎 even when configuring 直投/客户 tabs
          const stored =
            hideInitiatorInFieldConfig && !fields.includes("发起人")
              ? [...fields, "发起人"]
              : fields
          setSelectedFields(stored)
          writeInstructionFieldConfig(stored)
          setShowFieldConfig(false)
        }}
      />
    </div>
  )
}
