"use client"

import { useEffect, useRef, useState } from "react"
import {
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Download,
  HelpCircle,
  Inbox,
  Pencil,
  Settings2,
  Trash2,
} from "lucide-react"

type RunStatus = "running" | "liquidated"
type LedgerSortKey = "apply_date" | "confirm_date"

interface LedgerRow {
  id: string
  fof_fund_name: string
  transaction_type: string
  underlying_fund_name: string
  apply_date: string
  confirm_date: string
  confirmed_shares: string | null
  confirmed_amount: string | null
  confirmed_unit_nav: string | null
  transaction_fee: string | null
  performance_fee: string | null
  source: string | null
  remark: string | null
}

interface FundOption {
  register_number: string
  product_name: string
}

interface UnderlyingOption {
  beian_hao: string
  product_name: string
  short_name: string | null
}

const LEDGER_FIELD_CONFIG_DEFAULT = [
  "fof_fund_name",
  "transaction_type",
  "underlying_fund_name",
  "apply_date",
  "confirm_date",
  "confirmed_shares",
  "confirmed_amount",
  "confirmed_unit_nav",
  "transaction_fee",
  "performance_fee",
  "source",
  "remark",
]

export function OperationsLedgerView() {
  const [runStatus, setRunStatus] = useState<RunStatus>("running")

  const [fofFundInput, setFofFundInput] = useState("")
  const [fofFundSelected, setFofFundSelected] = useState<FundOption | null>(null)
  const [fofFundOptions, setFofFundOptions] = useState<FundOption[]>([])
  const [fofFundShowDropdown, setFofFundShowDropdown] = useState(false)

  const [underlyingInput, setUnderlyingInput] = useState("")
  const [underlyingSelected, setUnderlyingSelected] = useState<UnderlyingOption | null>(null)
  const [underlyingOptions, setUnderlyingOptions] = useState<UnderlyingOption[]>([])
  const [underlyingShowDropdown, setUnderlyingShowDropdown] = useState(false)

  const [applyDateFrom, setApplyDateFrom] = useState("")
  const [applyDateTo, setApplyDateTo] = useState("")

  const [appliedRunStatus, setAppliedRunStatus] = useState<RunStatus>("running")
  const [appliedFofRegister, setAppliedFofRegister] = useState<string | null>(null)
  const [appliedUnderlyingBeian, setAppliedUnderlyingBeian] = useState<string | null>(null)
  const [appliedApplyDateFrom, setAppliedApplyDateFrom] = useState("")
  const [appliedApplyDateTo, setAppliedApplyDateTo] = useState("")

  const [sortKey, setSortKey] = useState<LedgerSortKey | "">("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState<LedgerRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchSelectMode, setBatchSelectMode] = useState(false)
  const [showAddLedgerMenu, setShowAddLedgerMenu] = useState(false)
  const [showFieldConfig, setShowFieldConfig] = useState(false)
  const [fieldConfigSelected, setFieldConfigSelected] = useState<string[]>([...LEDGER_FIELD_CONFIG_DEFAULT])

  const fofFundSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const underlyingSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    setPage(1)
  }, [appliedRunStatus, appliedFofRegister, appliedUnderlyingBeian, appliedApplyDateFrom, appliedApplyDateTo, pageSize, sortKey, sortDir])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      run_status: appliedRunStatus,
      dir: sortDir,
    })
    if (sortKey) params.set("sort", sortKey)
    if (appliedFofRegister) params.set("fof_register_number", appliedFofRegister)
    if (appliedUnderlyingBeian) params.set("underlying_beian_hao", appliedUnderlyingBeian)
    if (appliedApplyDateFrom) params.set("apply_date_from", appliedApplyDateFrom)
    if (appliedApplyDateTo) params.set("apply_date_to", appliedApplyDateTo)

    fetch(`/ma/api/ops/ledger/list?${params}`)
      .then((r) => r.json())
      .then((json) => {
        setData(Array.isArray(json.data) ? json.data : [])
        setTotal(json.total ?? 0)
        setSelected(new Set())
      })
      .catch(() => {
        setData([])
        setTotal(0)
        setSelected(new Set())
      })
      .finally(() => setLoading(false))
  }, [
    page,
    pageSize,
    appliedRunStatus,
    appliedFofRegister,
    appliedUnderlyingBeian,
    appliedApplyDateFrom,
    appliedApplyDateTo,
    sortKey,
    sortDir,
  ])

  useEffect(() => {
    if (fofFundSearchRef.current) clearTimeout(fofFundSearchRef.current)
    fofFundSearchRef.current = setTimeout(() => {
      const q = fofFundInput.trim()
      fetch(`/ma/api/ops/fof-underlying/fof-funds${q ? `?q=${encodeURIComponent(q)}` : ""}`)
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d)) setFofFundOptions(d) })
        .catch(() => setFofFundOptions([]))
    }, 200)
    return () => { if (fofFundSearchRef.current) clearTimeout(fofFundSearchRef.current) }
  }, [fofFundInput])

  useEffect(() => {
    if (!underlyingInput.trim()) {
      setUnderlyingOptions([])
      setUnderlyingShowDropdown(false)
      return
    }
    if (underlyingSearchRef.current) clearTimeout(underlyingSearchRef.current)
    underlyingSearchRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/ma/api/tracking-funds/search?q=${encodeURIComponent(underlyingInput.trim())}`)
        const json = await res.json()
        setUnderlyingOptions(Array.isArray(json) ? json : [])
        setUnderlyingShowDropdown(true)
      } catch {
        setUnderlyingOptions([])
      }
    }, 250)
    return () => { if (underlyingSearchRef.current) clearTimeout(underlyingSearchRef.current) }
  }, [underlyingInput])

  function applyFilters() {
    setAppliedRunStatus(runStatus)
    setAppliedFofRegister(fofFundSelected?.register_number ?? null)
    setAppliedUnderlyingBeian(underlyingSelected?.beian_hao ?? null)
    setAppliedApplyDateFrom(applyDateFrom)
    setAppliedApplyDateTo(applyDateTo)
    setPage(1)
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

  function toggleAll() {
    if (selected.size === data.length && data.length > 0) setSelected(new Set())
    else setSelected(new Set(data.map((r) => r.id)))
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
  const visibleCols = new Set(fieldConfigSelected)

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
                  <span className="text-xs truncate">{fofFundSelected.product_name}</span>
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
                    placeholder="请输入并选择FOF基金"
                    value={fofFundInput}
                    onChange={(e) => { setFofFundInput(e.target.value); setFofFundShowDropdown(true) }}
                    onFocus={() => setFofFundShowDropdown(true)}
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
                            {opt.product_name}
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
                  <span className="text-xs truncate">{underlyingSelected.short_name || underlyingSelected.product_name}</span>
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
                    placeholder="请输入并选择底层基金"
                    value={underlyingInput}
                    onChange={(e) => setUnderlyingInput(e.target.value)}
                    onFocus={() => underlyingOptions.length > 0 && setUnderlyingShowDropdown(true)}
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
                            {opt.short_name || opt.product_name}
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
              <div className="relative">
                <CalendarDays className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="date"
                  value={applyDateFrom}
                  onChange={(e) => setApplyDateFrom(e.target.value)}
                  className="h-7 w-32 border rounded pl-7 pr-2 text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <span className="text-muted-foreground">-</span>
              <div className="relative">
                <CalendarDays className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="date"
                  value={applyDateTo}
                  onChange={(e) => setApplyDateTo(e.target.value)}
                  className="h-7 w-32 border rounded pl-7 pr-2 text-xs bg-background outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={applyFilters}
            className="h-7 px-4 border rounded text-xs font-medium hover:bg-muted transition-colors"
          >
            查询
          </button>
        </div>

        <p className="mt-3 text-[11px] text-zinc-400 leading-relaxed">
          说明：该列表展示所有公司产品/在管产品的台账记录。台账仅用于交易分析，不会改变产品的持仓份额。
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
          onClick={() => setBatchSelectMode((v) => !v)}
          className={[
            "inline-flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:text-foreground",
            batchSelectMode ? "text-red-500" : "",
          ].join(" ")}
        >
          <CheckSquare className="h-3.5 w-3.5" /> 批量选中
        </button>
        <button
          type="button"
          disabled={selected.size === 0}
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
                  onClick={() => setShowAddLedgerMenu(false)}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  手动添加
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddLedgerMenu(false)}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-muted transition-colors"
                >
                  批量导入
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
                  checked={selected.size === data.length && data.length > 0}
                  onChange={toggleAll}
                  disabled={!batchSelectMode || data.length === 0}
                />
              </th>
              <th className={`${thBase} w-10 text-center`}>序号</th>
              {visibleCols.has("fof_fund_name") && (
                <th className={`${thBase} min-w-[140px]`}>FOF基金</th>
              )}
              {visibleCols.has("transaction_type") && (
                <th className={`${thBase} min-w-[90px]`}>
                  <span className="inline-flex items-center gap-0.5">
                    交易类型
                    <ChevronDown className="h-3 w-3 opacity-40" />
                  </span>
                </th>
              )}
              {visibleCols.has("underlying_fund_name") && (
                <th className={`${thBase} min-w-[140px]`}>底层基金</th>
              )}
              {visibleCols.has("apply_date") && (
                <th className={thSort} onClick={() => handleSort("apply_date")}>
                  申请日期<SortIcon col="apply_date" />
                </th>
              )}
              {visibleCols.has("confirm_date") && (
                <th className={thSort} onClick={() => handleSort("confirm_date")}>
                  确认日期<SortIcon col="confirm_date" />
                </th>
              )}
              {visibleCols.has("confirmed_shares") && (
                <th className={`${thBase} min-w-[90px]`}>
                  <span className="inline-flex items-center gap-0.5">
                    确认份额
                    <HelpCircle className="h-3 w-3 opacity-40" />
                  </span>
                </th>
              )}
              {visibleCols.has("confirmed_amount") && (
                <th className={`${thBase} min-w-[90px]`}>确认金额</th>
              )}
              {visibleCols.has("confirmed_unit_nav") && (
                <th className={`${thBase} min-w-[100px]`}>确认单位净值</th>
              )}
              {visibleCols.has("transaction_fee") && (
                <th className={`${thBase} min-w-[80px]`}>交易费用</th>
              )}
              {visibleCols.has("performance_fee") && (
                <th className={`${thBase} min-w-[80px]`}>业绩报酬</th>
              )}
              {visibleCols.has("source") && (
                <th className={`${thBase} min-w-[70px]`}>
                  <span className="inline-flex items-center gap-0.5">
                    来源
                    <ChevronDown className="h-3 w-3 opacity-40" />
                  </span>
                </th>
              )}
              {visibleCols.has("remark") && (
                <th className={`${thBase} min-w-[80px]`}>备注</th>
              )}
              <th className={`${thBase} text-center w-20 sticky right-0 z-30 bg-muted/40 dark:bg-muted/20 border-l`}>操作</th>
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
                      disabled={!batchSelectMode}
                      onChange={() => {
                        const s = new Set(selected)
                        isSelected ? s.delete(row.id) : s.add(row.id)
                        setSelected(s)
                      }}
                    />
                  </td>
                  <td className={`${cell} text-center tabular-nums text-muted-foreground`}>{(page - 1) * pageSize + i + 1}</td>
                  {visibleCols.has("fof_fund_name") && (
                    <td className={`${cell} truncate max-w-[180px]`} title={row.fof_fund_name}>{row.fof_fund_name}</td>
                  )}
                  {visibleCols.has("transaction_type") && (
                    <td className={cell}>{row.transaction_type}</td>
                  )}
                  {visibleCols.has("underlying_fund_name") && (
                    <td className={`${cell} truncate max-w-[180px]`} title={row.underlying_fund_name}>{row.underlying_fund_name}</td>
                  )}
                  {visibleCols.has("apply_date") && (
                    <td className={`${cell} tabular-nums`}>{row.apply_date}</td>
                  )}
                  {visibleCols.has("confirm_date") && (
                    <td className={`${cell} tabular-nums`}>{row.confirm_date}</td>
                  )}
                  {visibleCols.has("confirmed_shares") && (
                    <td className={`${cell} text-right tabular-nums`}>{row.confirmed_shares ?? "—"}</td>
                  )}
                  {visibleCols.has("confirmed_amount") && (
                    <td className={`${cell} text-right tabular-nums`}>{row.confirmed_amount ?? "—"}</td>
                  )}
                  {visibleCols.has("confirmed_unit_nav") && (
                    <td className={`${cell} text-right tabular-nums`}>{row.confirmed_unit_nav ?? "—"}</td>
                  )}
                  {visibleCols.has("transaction_fee") && (
                    <td className={`${cell} text-right tabular-nums`}>{row.transaction_fee ?? "—"}</td>
                  )}
                  {visibleCols.has("performance_fee") && (
                    <td className={`${cell} text-right tabular-nums`}>{row.performance_fee ?? "—"}</td>
                  )}
                  {visibleCols.has("source") && (
                    <td className={cell}>{row.source ?? "—"}</td>
                  )}
                  {visibleCols.has("remark") && (
                    <td className={`${cell} text-muted-foreground truncate max-w-[120px]`} title={row.remark ?? undefined}>{row.remark || "—"}</td>
                  )}
                  <td className={`${cell} text-center sticky right-0 bg-background group-hover:bg-muted border-l`}>
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <button type="button" className="hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" className="hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
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

      {showFieldConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowFieldConfig(false)}>
          <div className="bg-background rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <span className="font-semibold text-sm">字段配置</span>
              <button type="button" onClick={() => setShowFieldConfig(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-4 space-y-2 max-h-80 overflow-y-auto">
              {[
                ["fof_fund_name", "FOF基金"],
                ["transaction_type", "交易类型"],
                ["underlying_fund_name", "底层基金"],
                ["apply_date", "申请日期"],
                ["confirm_date", "确认日期"],
                ["confirmed_shares", "确认份额"],
                ["confirmed_amount", "确认金额"],
                ["confirmed_unit_nav", "确认单位净值"],
                ["transaction_fee", "交易费用"],
                ["performance_fee", "业绩报酬"],
                ["source", "来源"],
                ["remark", "备注"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded h-3.5 w-3.5"
                    checked={fieldConfigSelected.includes(key)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setFieldConfigSelected((prev) => [...prev, key])
                      } else {
                        setFieldConfigSelected((prev) => prev.filter((k) => k !== key))
                      }
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFieldConfigSelected([...LEDGER_FIELD_CONFIG_DEFAULT])}
                className="px-3 py-1.5 text-xs border rounded hover:bg-muted transition-colors"
              >
                恢复默认
              </button>
              <button
                type="button"
                onClick={() => setShowFieldConfig(false)}
                className="px-3 py-1.5 text-xs bg-red-500 hover:bg-red-600 text-white rounded transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
