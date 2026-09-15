"use client"

import { useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from "react"
import {
  Check,
  CheckSquare,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Download,
  HelpCircle,
  Inbox,
  Pencil,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react"
import { DateInput } from "@/components/ui/date-input"
import { formatConfirmedUnitNav } from "@/lib/format-confirmed-unit-nav"
import { normalizeFundDisplayName } from "@/lib/fund-display-name"
import { useToast } from "@/hooks/use-toast"
import { ProductSelectionPanelBound } from "@/components/ma/product-selection-panel"
import { LedgerSourceCell } from "./LedgerAttachmentLink"
import { AddSingleLedgerDialog, BatchUploadLedgerDialog, GenerateFromValuationDialog } from "./OperationsLedgerDialogs"
import {
  LEDGER_FIELD_CONFIG_DEFAULT,
  OperationsLedgerFieldConfigDialog,
} from "./OperationsLedgerFieldConfigDialog"
import {
  backfillLedgerFromConfirmedInstructions,
  confirmLedgerRecords,
  ensureLedgerRecordsHydrated,
  getLedgerHydrateStatus,
  getLedgerRecordsHydrateError,
  getLedgerRecordsServerSnapshot,
  getLedgerRecordsSnapshot,
  ledgerReviewStatus,
  ledgerReviewTitle,
  listLedgerRecords,
  refreshLedgerRecordsFromServer,
  removeLedgerRecord,
  subscribeLedgerRecords,
  type OpsLedgerRow,
} from "./ops-ledger-store"

type RunStatus = "running" | "liquidated"
type LedgerSortKey = "apply_date" | "confirm_date"
type ReviewFilter = "all" | "pending" | "confirmed"

type LedgerRow = OpsLedgerRow

interface FundOption {
  register_number: string
  product_name: string
}

interface UnderlyingOption {
  beian_hao: string
  product_name: string
  short_name: string | null
}

const LEDGER_FIELD_LABELS: Record<string, string> = {
  fof_fund_name: "FOF基金",
  fof_register_number: "FOF基金备案号",
  transaction_type: "交易类型",
  underlying_type: "底层类型",
  underlying_fund_name: "底层基金",
  underlying_beian_hao: "底层备案号",
  apply_date: "申请日期",
  confirm_date: "确认日期",
  confirmed_amount: "确认净额",
  confirmed_shares: "确认份额",
  confirmed_unit_nav: "确认单位净值",
  transaction_fee: "交易费用",
  performance_fee: "业绩报酬",
  share_balance: "份额余额",
  dividend_per_unit: "每单位分红",
  review_status: "核对状态",
  source: "来源",
  remark: "备注",
}

function ReviewStatusBadge({ row }: { row: OpsLedgerRow }) {
  const confirmed = ledgerReviewStatus(row) === "confirmed"
  return (
    <span
      title={ledgerReviewTitle(row)}
      className={[
        "inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        confirmed
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
      ].join(" ")}
    >
      {confirmed ? "已确认" : "待确认"}
    </span>
  )
}

const NUMERIC_LEDGER_FIELDS = new Set([
  "confirmed_amount",
  "confirmed_shares",
  "confirmed_unit_nav",
  "transaction_fee",
  "performance_fee",
  "share_balance",
  "dividend_per_unit",
])

const EXPORT_FIELD_KEYS = Object.keys(LEDGER_FIELD_LABELS)

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function ledgerFundLabel(name: string | null | undefined): string {
  const raw = (name ?? "").trim()
  if (!raw) return "—"
  return normalizeFundDisplayName(raw) || raw
}

function ledgerExportCell(row: OpsLedgerRow, key: string): string {
  if (key === "review_status") {
    return ledgerReviewStatus(row) === "confirmed" ? "已确认" : "待确认"
  }
  if (key === "fof_fund_name" || key === "underlying_fund_name") {
    const raw = String(row[key] ?? "").trim()
    if (!raw) return ""
    return normalizeFundDisplayName(raw) || raw
  }
  if (key === "confirmed_unit_nav") {
    return formatConfirmedUnitNav(row.confirmed_unit_nav) ?? ""
  }
  const value = row[key as keyof OpsLedgerRow]
  if (value == null || value === "") return ""
  if (typeof value === "object") return ""
  return String(value)
}

export function OperationsLedgerView() {
  const { toast } = useToast()
  const [runStatus, setRunStatus] = useState<RunStatus>("running")

  const [fofFundInput, setFofFundInput] = useState("")
  const [fofFundSelected, setFofFundSelected] = useState<FundOption | null>(null)
  const [fofFundShowDropdown, setFofFundShowDropdown] = useState(false)

  const [underlyingInput, setUnderlyingInput] = useState("")
  const [underlyingSelected, setUnderlyingSelected] = useState<UnderlyingOption | null>(null)
  const [underlyingShowDropdown, setUnderlyingShowDropdown] = useState(false)

  const [applyDateFrom, setApplyDateFrom] = useState("")
  const [applyDateTo, setApplyDateTo] = useState("")

  const [appliedRunStatus, setAppliedRunStatus] = useState<RunStatus>("running")
  const [appliedFofRegister, setAppliedFofRegister] = useState<string | null>(null)
  const [appliedFofName, setAppliedFofName] = useState("")
  const [appliedUnderlyingBeian, setAppliedUnderlyingBeian] = useState<string | null>(null)
  const [appliedUnderlyingName, setAppliedUnderlyingName] = useState("")
  const [appliedApplyDateFrom, setAppliedApplyDateFrom] = useState("")
  const [appliedApplyDateTo, setAppliedApplyDateTo] = useState("")
  const [reviewStatus, setReviewStatus] = useState<ReviewFilter>("all")

  const [sortKey, setSortKey] = useState<LedgerSortKey | "">("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [showAddLedgerMenu, setShowAddLedgerMenu] = useState(false)
  const [showSingleLedgerDialog, setShowSingleLedgerDialog] = useState(false)
  const [editingLedger, setEditingLedger] = useState<OpsLedgerRow | null>(null)
  const [showBatchLedgerDialog, setShowBatchLedgerDialog] = useState(false)
  const [showGenerateDialog, setShowGenerateDialog] = useState(false)
  const [showFieldConfig, setShowFieldConfig] = useState(false)
  const [fieldConfigSelected, setFieldConfigSelected] = useState<string[]>([...LEDGER_FIELD_CONFIG_DEFAULT])

  const allLedgerRows = useSyncExternalStore(
    subscribeLedgerRecords,
    getLedgerRecordsSnapshot,
    getLedgerRecordsServerSnapshot,
  )
  const hydrateStatus = getLedgerHydrateStatus()
  const hydrateError = getLedgerRecordsHydrateError()

  useEffect(() => {
    void (async () => {
      await ensureLedgerRecordsHydrated()
      await backfillLedgerFromConfirmedInstructions()
    })()
    const onFocus = () => {
      void refreshLedgerRecordsFromServer()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [])

  useEffect(() => {
    setPage(1)
  }, [appliedRunStatus, appliedFofRegister, appliedFofName, appliedUnderlyingBeian, appliedUnderlyingName, appliedApplyDateFrom, appliedApplyDateTo, pageSize, sortKey, sortDir, reviewStatus])

  // run_status filter is UI-only for now (no product status on local rows)
  void appliedRunStatus

  const listResult = useMemo(
    () =>
      listLedgerRecords({
        page,
        pageSize,
        fof_register_number: appliedFofRegister,
        fof_fund_name: appliedFofName || undefined,
        underlying_beian_hao: appliedUnderlyingBeian,
        underlying_fund_name: appliedUnderlyingName || undefined,
        apply_date_from: appliedApplyDateFrom,
        apply_date_to: appliedApplyDateTo,
        sort: sortKey || "apply_date",
        dir: sortDir,
        review_status: reviewStatus,
      }),
    [
      allLedgerRows,
      page,
      pageSize,
      appliedFofRegister,
      appliedFofName,
      appliedUnderlyingBeian,
      appliedUnderlyingName,
      appliedApplyDateFrom,
      appliedApplyDateTo,
      sortKey,
      sortDir,
      reviewStatus,
    ],
  )

  const data = listResult.data
  const total = listResult.total
  const totalPages = listResult.totalPages
  const loading = hydrateStatus === "loading" && allLedgerRows.length === 0

  useEffect(() => {
    const known = new Set(allLedgerRows.map((row) => row.id))
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => known.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [allLedgerRows])

  const fofFundOptions = useMemo(() => {
    const q = fofFundInput.trim().toLowerCase()
    const map = new Map<string, FundOption>()
    for (const row of allLedgerRows) {
      const name = row.fof_fund_name.trim()
      if (!name) continue
      const reg = (row.fof_register_number || name).trim()
      const display = ledgerFundLabel(name)
      if (
        q
        && !name.toLowerCase().includes(q)
        && !display.toLowerCase().includes(q)
        && !reg.toLowerCase().includes(q)
      ) continue
      if (!map.has(reg)) map.set(reg, { register_number: reg, product_name: name })
    }
    return [...map.values()].sort((a, b) => a.product_name.localeCompare(b.product_name, "zh"))
  }, [allLedgerRows, fofFundInput])

  const underlyingOptions = useMemo(() => {
    const q = underlyingInput.trim().toLowerCase()
    const map = new Map<string, UnderlyingOption>()
    for (const row of allLedgerRows) {
      const name = row.underlying_fund_name.trim()
      if (!name) continue
      const beian = (row.underlying_beian_hao || name).trim()
      const display = ledgerFundLabel(name)
      if (
        q
        && !name.toLowerCase().includes(q)
        && !display.toLowerCase().includes(q)
        && !beian.toLowerCase().includes(q)
      ) continue
      if (!map.has(beian)) {
        map.set(beian, { beian_hao: beian, product_name: name, short_name: name })
      }
    }
    return [...map.values()].sort((a, b) => a.product_name.localeCompare(b.product_name, "zh"))
  }, [allLedgerRows, underlyingInput])

  const selectedPendingIds = useMemo(
    () =>
      [...selected].filter((id) => {
        const row = allLedgerRows.find((r) => r.id === id)
        return row ? ledgerReviewStatus(row) === "pending" : false
      }),
    [selected, allLedgerRows],
  )

  function applyFilters() {
    const fofTyped = fofFundInput.trim()
    const undTyped = underlyingInput.trim()
    setAppliedRunStatus(runStatus)
    setAppliedFofRegister(fofFundSelected?.register_number ?? null)
    setAppliedFofName(fofFundSelected?.product_name || fofTyped)
    setAppliedUnderlyingBeian(underlyingSelected?.beian_hao ?? null)
    setAppliedUnderlyingName(
      underlyingSelected?.short_name || underlyingSelected?.product_name || undTyped,
    )
    setAppliedApplyDateFrom(applyDateFrom)
    setAppliedApplyDateTo(applyDateTo)
    setFofFundShowDropdown(false)
    setUnderlyingShowDropdown(false)
    setPage(1)
  }

  function handleFilterKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      setFofFundShowDropdown(false)
      setUnderlyingShowDropdown(false)
      applyFilters()
    }
  }

  function handleRunStatusChange(st: RunStatus) {
    setRunStatus(st)
    setAppliedRunStatus(st)
    setPage(1)
  }

  function handleSort(col: LedgerSortKey) {
    if (sortKey === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortKey(col); setSortDir("desc") }
    setPage(1)
  }

  function SortIcon({ col }: { col: LedgerSortKey }) {
    if (sortKey !== col) return <ChevronsUpDown className="inline h-3 w-3 ml-0.5 opacity-40" />
    return sortDir === "asc"
      ? <ChevronUp className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5 text-zinc-700 dark:text-zinc-300" />
  }

  function pageAllSelected() {
    return data.length > 0 && data.every((row) => selected.has(row.id))
  }

  function toggleAll() {
    const next = new Set(selected)
    if (pageAllSelected()) {
      for (const row of data) next.delete(row.id)
    } else {
      for (const row of data) next.add(row.id)
    }
    setSelected(next)
  }

  async function handleConfirm(ids: string[]) {
    const pendingIds = ids.filter((id) => {
      const row = allLedgerRows.find((r) => r.id === id)
      return row ? ledgerReviewStatus(row) === "pending" : false
    })
    if (pendingIds.length === 0) {
      toast({ title: "所选记录均已确认" })
      return
    }
    setConfirming(true)
    try {
      const count = await confirmLedgerRecords(pendingIds)
      setSelected(new Set())
      toast({ title: `已确认 ${count} 条台账` })
    } catch (err) {
      toast({
        title: "确认失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setConfirming(false)
    }
  }

  async function handleRefresh() {
    try {
      await refreshLedgerRecordsFromServer()
      const err = getLedgerRecordsHydrateError()
      if (err) {
        toast({ title: "同步失败", description: err, variant: "destructive" })
      }
    } catch (err) {
      toast({
        title: "同步失败",
        description: err instanceof Error ? err.message : "请稍后重试",
        variant: "destructive",
      })
    }
  }

  function handleExport() {
    const { data: rows } = listLedgerRecords({
      fof_register_number: appliedFofRegister,
      fof_fund_name: appliedFofName || undefined,
      underlying_beian_hao: appliedUnderlyingBeian,
      underlying_fund_name: appliedUnderlyingName || undefined,
      apply_date_from: appliedApplyDateFrom,
      apply_date_to: appliedApplyDateTo,
      sort: sortKey || "apply_date",
      dir: sortDir,
      review_status: reviewStatus,
      all: true,
    })
    if (rows.length === 0) {
      toast({ title: "暂无数据可导出" })
      return
    }
    const headers = ["序号", ...EXPORT_FIELD_KEYS.map((key) => LEDGER_FIELD_LABELS[key])]
    const lines = rows.map((row, i) =>
      [String(i + 1), ...EXPORT_FIELD_KEYS.map((key) => csvEscape(ledgerExportCell(row, key)))].join(","),
    )
    const blob = new Blob(["\uFEFF" + [headers.join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    const stamp = new Date().toISOString().slice(0, 10)
    a.download = `申赎台账_${stamp}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function pageButtons(): (number | "…")[] {
    const btns: (number | "…")[] = []
    const lo = Math.max(1, page - 2)
    const hi = Math.min(totalPages, page + 2)
    if (lo > 1) { btns.push(1); if (lo > 2) btns.push("…") }
    for (let i = lo; i <= hi; i++) btns.push(i)
    if (hi < totalPages) { if (hi < totalPages - 1) btns.push("…"); btns.push(totalPages) }
    return btns
  }

  const thBase = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap"
  const thSort = `${thBase} cursor-pointer select-none hover:text-zinc-800 dark:hover:text-zinc-200`
  const visibleFieldKeys = fieldConfigSelected.filter((key) => LEDGER_FIELD_LABELS[key])

  function renderHeader(key: string) {
    const label = LEDGER_FIELD_LABELS[key]
    if (key === "apply_date" || key === "confirm_date") {
      return (
        <th key={key} className={`${thSort} min-w-[7.25rem]`} onClick={() => handleSort(key)}>
          {label}<SortIcon col={key} />
        </th>
      )
    }
    if (key === "transaction_type" || key === "source") {
      return (
        <th key={key} className={`${thBase} min-w-[90px]`}>
          <span className="inline-flex items-center gap-0.5">
            {label}
            <ChevronDown className="h-3 w-3 opacity-40" />
          </span>
        </th>
      )
    }
    if (key === "confirmed_shares") {
      return (
        <th key={key} className={`${thBase} min-w-[90px]`}>
          <span className="inline-flex items-center gap-0.5">
            {label}
            <HelpCircle className="h-3 w-3 opacity-40" />
          </span>
        </th>
      )
    }
    return (
      <th key={key} className={`${thBase} min-w-[90px]`}>
        {label}
      </th>
    )
  }

  function renderCell(key: string, row: LedgerRow, cell: string) {
    const value = row[key as keyof LedgerRow]
    const display = value == null || value === "" ? "—" : String(value)
    if (key === "fof_fund_name" || key === "underlying_fund_name") {
      const label = display === "—" ? "—" : ledgerFundLabel(display)
      return (
        <td key={key} className={`${cell} truncate max-w-[180px]`} title={display === "—" ? undefined : display}>
          {label}
        </td>
      )
    }
    if (key === "remark") {
      return (
        <td key={key} className={`${cell} text-muted-foreground truncate max-w-[120px]`} title={display === "—" ? undefined : display}>
          {display}
        </td>
      )
    }
    if (key === "confirmed_unit_nav") {
      const nav = formatConfirmedUnitNav(value)
      return <td key={key} className={`${cell} text-right tabular-nums`}>{nav ?? "—"}</td>
    }
    if (NUMERIC_LEDGER_FIELDS.has(key)) {
      return <td key={key} className={`${cell} text-right tabular-nums`}>{display}</td>
    }
    if (key === "apply_date" || key === "confirm_date") {
      return <td key={key} className={`${cell} tabular-nums whitespace-nowrap`}>{display}</td>
    }
    if (key === "review_status") {
      return (
        <td key={key} className={cell}>
          <ReviewStatusBadge row={row} />
        </td>
      )
    }
    if (key === "source") {
      return (
        <td key={key} className={cell}>
          <LedgerSourceCell row={row} className="block truncate max-w-[140px]" />
        </td>
      )
    }
    return <td key={key} className={cell}>{display}</td>
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-4 px-1 mb-3 flex-shrink-0 text-sm">
        <span className="text-zinc-500 shrink-0">FOF基金</span>
        <div className="flex items-center gap-5 border-b border-transparent">
          {([["running", "运行中"], ["liquidated", "已清盘"]] as const).map(([st, label]) => (
            <button
              key={st}
              type="button"
              onClick={() => handleRunStatusChange(st)}
              className={[
                "pb-2 -mb-px border-b-2 text-sm transition-colors",
                runStatus === st
                  ? "border-red-500 text-red-500 font-medium"
                  : "border-transparent text-zinc-600 hover:text-zinc-900 dark:hover:text-zinc-200",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-background border rounded-xl shadow-sm text-xs mb-3 flex-shrink-0 px-4 py-3">
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 pr-3">FOF基金：</span>
            <div className="relative w-56">
              {fofFundSelected ? (
                <div className="flex items-center justify-between border rounded h-7 px-2 bg-background">
                  <span className="text-xs truncate">{ledgerFundLabel(fofFundSelected.product_name)}</span>
                  <button
                    type="button"
                    onClick={() => { setFofFundSelected(null); setFofFundInput("") }}
                    className="text-muted-foreground hover:text-foreground ml-1 shrink-0"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className="w-full h-7 border rounded px-2 text-xs bg-background outline-none placeholder:text-muted-foreground/50"
                    placeholder="请输入FOF基金名称"
                    value={fofFundInput}
                    onChange={(e) => { setFofFundInput(e.target.value); setFofFundShowDropdown(true) }}
                    onFocus={() => setFofFundShowDropdown(true)}
                    onKeyDown={handleFilterKeyDown}
                  />
                  {fofFundShowDropdown && fofFundOptions.length > 0 && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setFofFundShowDropdown(false)} />
                      <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-background border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {fofFundOptions.map((opt) => (
                          <button
                            key={opt.register_number}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setFofFundSelected(opt)
                              setFofFundInput("")
                              setFofFundShowDropdown(false)
                            }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors truncate"
                          >
                            {ledgerFundLabel(opt.product_name)}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 pr-3">底层基金：</span>
            <div className="relative w-56">
              {underlyingSelected ? (
                <div className="flex items-center justify-between border rounded h-7 px-2 bg-background">
                  <span className="text-xs truncate">
                    {ledgerFundLabel(underlyingSelected.short_name || underlyingSelected.product_name)}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setUnderlyingSelected(null); setUnderlyingInput("") }}
                    className="text-muted-foreground hover:text-foreground ml-1 shrink-0"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className="w-full h-7 border rounded px-2 text-xs bg-background outline-none placeholder:text-muted-foreground/50"
                    placeholder="请输入底层基金名称"
                    value={underlyingInput}
                    onChange={(e) => { setUnderlyingInput(e.target.value); setUnderlyingShowDropdown(true) }}
                    onFocus={() => setUnderlyingShowDropdown(true)}
                    onKeyDown={handleFilterKeyDown}
                  />
                  {underlyingShowDropdown && underlyingOptions.length > 0 && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setUnderlyingShowDropdown(false)} />
                      <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-background border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                        {underlyingOptions.map((opt) => (
                          <button
                            key={opt.beian_hao}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setUnderlyingSelected(opt)
                              setUnderlyingInput("")
                              setUnderlyingShowDropdown(false)
                            }}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors truncate"
                          >
                            {ledgerFundLabel(opt.short_name || opt.product_name)}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center">
            <span className="text-zinc-400 shrink-0 pr-3">申请日期：</span>
            <div className="flex items-center gap-1.5">
              <DateInput
                value={applyDateFrom}
                onChange={setApplyDateFrom}
                placeholder="开始日期"
                className="w-36"
                inputClassName="h-7 rounded pl-2 pr-8 text-xs"
                displayClassName="left-2 text-xs"
              />
              <span className="text-muted-foreground">-</span>
              <DateInput
                value={applyDateTo}
                onChange={setApplyDateTo}
                placeholder="结束日期"
                className="w-36"
                inputClassName="h-7 rounded pl-2 pr-8 text-xs"
                displayClassName="left-2 text-xs"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={applyFilters}
            className="h-7 px-4 border rounded text-xs font-medium hover:bg-muted transition-colors"
          >
            查询
          </button>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            className="h-7 px-3 border rounded text-xs font-medium hover:bg-muted transition-colors inline-flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> 刷新
          </button>
          <div className="flex items-center gap-1 ml-auto">
            {([["all", "全部"], ["pending", "待确认"], ["confirmed", "已确认"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setReviewStatus(value)}
                className={[
                  "h-7 px-3 rounded text-xs font-medium transition-colors",
                  reviewStatus === value
                    ? value === "pending"
                      ? "bg-amber-500 text-white"
                      : value === "confirmed"
                        ? "bg-emerald-600 text-white"
                        : "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                    : "border text-zinc-600 hover:bg-muted",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {hydrateError ? (
          <p className="mt-3 text-[11px] text-red-500 leading-relaxed">
            未能从服务器同步台账（{hydrateError}）。当前可能是本机缓存，刷新后再试。
          </p>
        ) : null}
        <p className="mt-3 text-[11px] text-zinc-400 leading-relaxed">
          说明：台账保存在服务器，任意电脑登录后均可查看和修改。估值表生成或手工录入的记录默认为「待确认」，核对无误后可单条或批量确认。台账仅用于交易分析，不会改变产品的持仓份额。
        </p>
      </div>

      <div className="flex items-center justify-end gap-3 mb-3 flex-shrink-0 text-xs text-zinc-600">
        <button
          type="button"
          onClick={() => setShowFieldConfig(true)}
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <Settings2 className="h-3.5 w-3.5" /> 字段配置
        </button>
        <button
          type="button"
          disabled={data.length === 0}
          onClick={toggleAll}
          className={[
            "inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground",
            selected.size > 0 && pageAllSelected() ? "text-red-500" : "",
          ].join(" ")}
        >
          <CheckSquare className="h-3.5 w-3.5" /> {pageAllSelected() ? "取消全选" : "本页全选"}
        </button>
        <button
          type="button"
          disabled={selectedPendingIds.length === 0 || confirming}
          onClick={() => void handleConfirm(selectedPendingIds)}
          className="inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-emerald-700 text-emerald-600"
        >
          <Check className="h-3.5 w-3.5" /> {confirming ? "确认中…" : `批量确认${selectedPendingIds.length > 0 ? ` (${selectedPendingIds.length})` : ""}`}
        </button>
        <button
          type="button"
          disabled={total === 0}
          onClick={handleExport}
          className="inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" /> 导出
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowAddLedgerMenu((v) => !v)}
            className="inline-flex items-center gap-1 bg-red-500 hover:bg-red-600 text-white rounded px-3 py-1.5 font-medium transition-colors"
          >
            添加台账
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {showAddLedgerMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowAddLedgerMenu(false)} />
              <div
                className="absolute right-0 top-full mt-1 z-40 bg-background border rounded-lg shadow-lg py-1 min-w-[120px]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowAddLedgerMenu(false)
                    setShowGenerateDialog(true)
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  从估值表生成
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddLedgerMenu(false)
                    setEditingLedger(null)
                    setShowSingleLedgerDialog(true)
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  单条台账
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddLedgerMenu(false)
                    setShowBatchLedgerDialog(true)
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  批量上传
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="overflow-auto rounded-lg border flex-1 min-h-0">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1600 }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted/40 dark:bg-muted/20 backdrop-blur-sm border-b">
              <th className={`${thBase} w-8 px-2`}>
                <input
                  type="checkbox"
                  className="rounded h-3 w-3"
                  checked={pageAllSelected()}
                  onChange={toggleAll}
                  disabled={data.length === 0}
                />
              </th>
              <th className={`${thBase} w-10 text-center`}>序号</th>
              {visibleFieldKeys.map(renderHeader)}
              <th className={`${thBase} text-center w-28 sticky right-0 z-30 bg-muted/40 dark:bg-muted/20 border-l`}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={20} className="py-20 text-center text-muted-foreground">加载中…</td></tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={20} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无数据</span>
                  </div>
                </td>
              </tr>
            ) : data.map((row, i) => {
              const isSelected = selected.has(row.id)
              const cell = `border-b px-3 py-2 ${isSelected ? "bg-blue-50 dark:bg-blue-950/40" : ""} group-hover:bg-muted transition-colors`
              return (
                <tr key={row.id} className="group">
                  <td className={`${cell} px-2 text-center`}>
                    <input
                      type="checkbox"
                      className="rounded h-3 w-3"
                      checked={isSelected}
                      onChange={() => {
                        const s = new Set(selected)
                        isSelected ? s.delete(row.id) : s.add(row.id)
                        setSelected(s)
                      }}
                    />
                  </td>
                  <td className={`${cell} text-center tabular-nums text-muted-foreground`}>{(page - 1) * pageSize + i + 1}</td>
                  {visibleFieldKeys.map((key) => renderCell(key, row, cell))}
                  <td className={`${cell} text-center sticky right-0 bg-background group-hover:bg-muted border-l`}>
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      {ledgerReviewStatus(row) === "pending" ? (
                        <button
                          type="button"
                          className="hover:text-emerald-600 disabled:opacity-40"
                          disabled={confirming}
                          onClick={() => void handleConfirm([row.id])}
                          aria-label="确认台账"
                          title="确认"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="hover:text-foreground"
                        onClick={() => {
                          setEditingLedger(row)
                          setShowSingleLedgerDialog(true)
                        }}
                        aria-label="编辑台账"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="hover:text-red-500"
                        onClick={() => {
                          void removeLedgerRecord(row.id)
                        }}
                        aria-label="删除台账"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-3 flex-shrink-0">
        <span className="text-sm text-zinc-500">
          共 <span className="font-semibold text-zinc-800 dark:text-zinc-200">{total.toLocaleString()}</span> 条
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
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
                type="button"
                onClick={() => setPage(btn as number)}
                className={[
                  "w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors",
                  btn === page ? "bg-red-500 text-white border-red-500 font-medium" : "text-foreground hover:bg-muted border-border",
                ].join(" ")}
              >
                {btn}
              </button>
            ),
          )}
          <button
            type="button"
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
              {[50, 100, 200].map((n) => (
                <option key={n} value={n}>{n} 条/页</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>

      <AddSingleLedgerDialog
        open={showSingleLedgerDialog}
        initial={editingLedger}
        onClose={() => {
          setShowSingleLedgerDialog(false)
          setEditingLedger(null)
        }}
      />
      <BatchUploadLedgerDialog
        open={showBatchLedgerDialog}
        onClose={() => setShowBatchLedgerDialog(false)}
      />
      <GenerateFromValuationDialog
        open={showGenerateDialog}
        onClose={() => setShowGenerateDialog(false)}
        onGenerated={(summary) => {
          toast({ title: "申赎台账已生成", description: summary })
        }}
      />

      <OperationsLedgerFieldConfigDialog
        open={showFieldConfig}
        selected={fieldConfigSelected}
        onClose={() => setShowFieldConfig(false)}
        onConfirm={(fields) => {
          setFieldConfigSelected(fields)
          setShowFieldConfig(false)
        }}
      />

      <ProductSelectionPanelBound
        data={data}
        selected={selected}
        setSelected={setSelected}
        getId={(r) => r.id}
        getName={(r) => `${ledgerFundLabel(r.fof_fund_name)} · ${ledgerFundLabel(r.underlying_fund_name)}`}
        getBeianHao={(r) => r.underlying_beian_hao}
        showActions={false}
      />
    </div>
  )
}
