"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  ArrowLeft,
  ArrowLeftRight,
  ChevronDown,
  CloudUpload,
  Eye,
  Inbox,
  Search,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { DateInput } from "@/components/ui/date-input"
import { InstructionSubmitSuccess } from "./InstructionSubmitSuccess"
import {
  addInstructionRecord,
  getInstructionRecordsServerSnapshot,
  getInstructionRecordsSnapshot,
  subscribeInstructionRecords,
  type InstructionRecord,
} from "./instructions-store"

interface FundOption {
  beian_hao: string
  product_name: string
  custody_balance: string | null
  valuation_date: string | null
}

interface UnderlyingOption {
  beian_hao: string
  product_name: string
  short_name: string | null
  is_holding: boolean
  market_value: string | null
  investment_shares: string | null
  unit_nav: string | null
  nav_date: string | null
}

function parseManagedFundOptions(json: unknown): FundOption[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: FundOption[] = []
  for (const row of data as {
    product_name?: string
    beian_hao?: string | null
    custody_balance?: string | null
    valuation_date?: string | null
  }[]) {
    if (!row.product_name) continue
    out.push({
      product_name: row.product_name,
      beian_hao: row.beian_hao ?? row.product_name,
      custody_balance: row.custody_balance ?? null,
      valuation_date: row.valuation_date ?? null,
    })
  }
  return out
}

function parseUnderlyingHoldingOptions(json: unknown, isHolding: boolean): UnderlyingOption[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: UnderlyingOption[] = []
  const seen = new Set<string>()
  for (const row of data as {
    product_name?: string
    short_name?: string | null
    beian_hao?: string | null
    market_value?: string | null
    investment_shares?: string | null
    unit_nav?: string | null
    latest_nav?: string | null
    nav_date?: string | null
    latest_nav_date?: string | null
    id?: string
  }[]) {
    if (!row.product_name) continue
    const key = `${row.beian_hao ?? ""}::${row.product_name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      product_name: row.product_name,
      short_name: row.short_name ?? row.product_name,
      beian_hao: row.beian_hao ?? row.id ?? row.product_name,
      is_holding: isHolding,
      market_value: row.market_value ?? null,
      investment_shares: row.investment_shares ?? null,
      unit_nav: row.unit_nav ?? row.latest_nav ?? null,
      nav_date: row.nav_date ?? row.latest_nav_date ?? null,
    })
  }
  return out
}

function mergeUnderlyingOptions(...lists: UnderlyingOption[][]): UnderlyingOption[] {
  const map = new Map<string, UnderlyingOption>()
  for (const list of lists) {
    for (const opt of list) {
      const key = `${opt.beian_hao}::${opt.product_name}`
      const prev = map.get(key)
      if (!prev) {
        map.set(key, opt)
        continue
      }
      // Prefer holding rows over cleared duplicates.
      if (opt.is_holding && !prev.is_holding) map.set(key, opt)
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.is_holding !== b.is_holding) return a.is_holding ? -1 : 1
    return (a.short_name || a.product_name).localeCompare(b.short_name || b.product_name, "zh-CN")
  })
}

function HoldingBadge({ holding }: { holding: boolean }) {
  if (holding) {
    return (
      <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] leading-none text-red-500 dark:bg-red-950/40 dark:text-red-400">
        持仓
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] leading-none text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
      清仓
    </span>
  )
}

function EstimateMark() {
  return (
    <span
      className="pointer-events-none absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-red-400 text-[10px] font-medium leading-none text-red-500"
      title="估算"
      aria-hidden="true"
    >
      估
    </span>
  )
}

function formatBalance(
  value: string | null | undefined,
  unit = "元",
  fractionDigits = 2,
): string {
  if (value == null || value === "") return "—"
  const n = Number(value)
  if (!Number.isFinite(n)) return `${value} ${unit}`
  return `${n.toLocaleString("zh-CN", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} ${unit}`
}

function formatNav(value: string | null | undefined, date?: string | null): string {
  if (value == null || value === "") return "—"
  const n = Number(value)
  const navText = Number.isFinite(n)
    ? n.toLocaleString("zh-CN", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    : value
  return date ? `${navText} (${date})` : navText
}

function formatTemporaryOpen(value: string | null | undefined): string {
  if (!value) return "—"
  if (value.includes("不可")) return "否"
  if (value.includes("可")) return "是"
  return value
}

function parseNumberInput(value: string): number | null {
  const n = Number(String(value).replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : null
}

const RECENT_COLUMNS = [
  "序号",
  "指令ID",
  "交易申请日期",
  "指令类型",
  "基金名称",
  "申请金额",
  "申请份额",
  "确认净值",
  "指令进度",
  "操作",
] as const

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="h-4 w-1 rounded-sm bg-red-500" aria-hidden="true" />
      <h3 className="text-sm font-semibold text-foreground">{children}</h3>
    </div>
  )
}

function FormLabel({
  children,
  required = false,
  className = "",
}: {
  children: React.ReactNode
  required?: boolean
  className?: string
}) {
  return (
    <label
      className={[
        "w-[7.5rem] shrink-0 text-right text-sm leading-snug text-zinc-700 dark:text-zinc-300",
        className,
      ].join(" ")}
    >
      {required && <span className="mr-0.5 text-red-500">*</span>}
      {children}
    </label>
  )
}

function InfoRow({
  label,
  value,
  accent = false,
  placeholder = false,
}: {
  label: string
  value: string
  accent?: boolean
  placeholder?: boolean
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm">
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{label}:</span>
      <span
        className={[
          "min-w-0 break-words",
          placeholder
            ? "text-zinc-400"
            : accent
              ? "font-medium text-red-500"
              : "text-zinc-700 dark:text-zinc-200",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  )
}

function Watermark({ text }: { text: string }) {
  return (
    <div
      className="pointer-events-none absolute right-6 top-1/2 hidden -translate-y-1/2 select-none sm:block"
      aria-hidden="true"
    >
      <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-zinc-200/80 text-2xl font-semibold text-zinc-200/90 dark:border-zinc-700/60 dark:text-zinc-700/50">
        {text}
      </div>
    </div>
  )
}

function FundSearchPicker({
  selected,
  input,
  options,
  loading,
  showDropdown,
  placeholder,
  error,
  emptyText = "暂无底层基金",
  onInputChange,
  onOpen,
  onSelect,
}: {
  selected: UnderlyingOption | null
  input: string
  options: UnderlyingOption[]
  loading: boolean
  showDropdown: boolean
  placeholder: string
  error?: string | null
  emptyText?: string
  onInputChange: (v: string) => void
  onOpen: () => void
  onSelect: (opt: UnderlyingOption) => void
}) {
  return (
    <div className="relative min-w-0 flex-1 max-w-md">
      <div
        className={[
          "flex items-center overflow-visible rounded border",
          showDropdown || error
            ? "border-red-400 ring-1 ring-red-400/60"
            : "border-border",
        ].join(" ")}
      >
        <div className="relative shrink-0">
          <select
            defaultValue="private"
            className="h-9 cursor-pointer appearance-none border-r border-border bg-muted/40 pl-3 pr-7 text-sm text-zinc-700 focus:outline-none dark:text-zinc-300"
          >
            <option value="private">私募基金</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        </div>
        <div className="relative flex min-w-0 flex-1 items-center gap-2 px-3">
          {selected && !showDropdown ? (
            <button
              type="button"
              onClick={onOpen}
              className="flex h-9 min-w-0 flex-1 items-center justify-between text-left"
            >
              <span className="truncate text-sm">{selected.short_name || selected.product_name}</span>
              <Search className="ml-2 h-3.5 w-3.5 shrink-0 text-zinc-400" />
            </button>
          ) : (
            <>
              <input
                type="text"
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                onFocus={onOpen}
                onClick={onOpen}
                placeholder={placeholder}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
              />
              {loading ? (
                <svg className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
                </svg>
              ) : (
                <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              )}
            </>
          )}
        </div>
      </div>
      {error ? <div className="mt-1 text-xs text-red-500">{error}</div> : null}
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-md border bg-background shadow-lg">
          {loading && options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-zinc-400">加载中…</div>
          ) : options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-zinc-400">{emptyText}</div>
          ) : (
            options.map((opt) => (
              <button
                key={`${opt.beian_hao}-${opt.product_name}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(opt)}
                className={[
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                  selected?.beian_hao === opt.beian_hao
                  && selected.product_name === opt.product_name
                    ? "bg-muted"
                    : "",
                ].join(" ")}
              >
                <span className="min-w-0 flex-1 truncate">{opt.short_name || opt.product_name}</span>
                <HoldingBadge holding={opt.is_holding} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function UnderlyingConvertForm({ onBack }: { onBack: () => void }) {
  const { toast } = useToast()
  const allRecords = useSyncExternalStore(
    subscribeInstructionRecords,
    getInstructionRecordsSnapshot,
    getInstructionRecordsServerSnapshot,
  )

  const [submittedRecord, setSubmittedRecord] = useState<InstructionRecord | null>(null)
  const [fofInput, setFofInput] = useState("")
  const [fofSelected, setFofSelected] = useState<FundOption | null>(null)
  const [fofOptions, setFofOptions] = useState<FundOption[]>([])
  const [fofShow, setFofShow] = useState(false)
  const [fofLoading, setFofLoading] = useState(false)

  const [summary, setSummary] = useState("")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [applyDate, setApplyDate] = useState("")
  const [outAmount, setOutAmount] = useState("")
  const [outShares, setOutShares] = useState("")
  const [inAmount, setInAmount] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const [outInput, setOutInput] = useState("")
  const [outSelected, setOutSelected] = useState<UnderlyingOption | null>(null)
  const [outOptions, setOutOptions] = useState<UnderlyingOption[]>([])
  const [outShow, setOutShow] = useState(false)
  const [outLoading, setOutLoading] = useState(false)
  const [outOpenDay, setOutOpenDay] = useState<string | null>(null)
  const [outTempOpen, setOutTempOpen] = useState<string | null>(null)

  const [inInput, setInInput] = useState("")
  const [inSelected, setInSelected] = useState<UnderlyingOption | null>(null)
  const [inOptions, setInOptions] = useState<UnderlyingOption[]>([])
  const [inShow, setInShow] = useState(false)
  const [inLoading, setInLoading] = useState(false)
  const [inOpenDay, setInOpenDay] = useState<string | null>(null)
  const [inTempOpen, setInTempOpen] = useState<string | null>(null)
  const [inTouched, setInTouched] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const fofWrapRef = useRef<HTMLDivElement>(null)
  const outWrapRef = useRef<HTMLDivElement>(null)
  const inWrapRef = useRef<HTMLDivElement>(null)
  const fofSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hint = "请选择底层基金"
  const estimatedBalanceNum = parseNumberInput(fofSelected?.custody_balance ?? "")
  const outAmountNum = parseNumberInput(outAmount)
  const outSharesNum = parseNumberInput(outShares)
  const holdingSharesNum = parseNumberInput(outSelected?.investment_shares ?? "")
  const amountOverEstimated =
    outAmountNum != null
    && estimatedBalanceNum != null
    && outAmountNum > estimatedBalanceNum + 1e-8
  const sharesOverHolding =
    holdingSharesNum != null
    && outSharesNum != null
    && outSharesNum > holdingSharesNum + 1e-8
  const inSelectError = inTouched && !inSelected ? "请输入并选择产品" : null

  const recentRows = useMemo(() => {
    if (!outSelected || !fofSelected) return [] as InstructionRecord[]
    const undName = (outSelected.short_name || outSelected.product_name).trim()
    return allRecords
      .filter((r) => {
        if (r.category !== "underlying") return false
        if (r.fofFundName !== fofSelected.product_name && r.fofBeianHao !== fofSelected.beian_hao) {
          return false
        }
        return (
          r.underlyingFundName.includes(undName)
          || r.underlyingBeianHao === outSelected.beian_hao
        )
      })
      .slice(0, 20)
  }, [allRecords, outSelected, fofSelected])

  useEffect(() => {
    if (!fofShow) return
    if (fofSearchRef.current) clearTimeout(fofSearchRef.current)
    fofSearchRef.current = setTimeout(() => {
      const q = fofInput.trim()
      setFofLoading(true)
      fetch(`/ma/api/ops/managed-products/list?pageSize=50${q ? `&keyword=${encodeURIComponent(q)}` : ""}`)
        .then((r) => r.json())
        .then((d) => setFofOptions(parseManagedFundOptions(d)))
        .catch(() => setFofOptions([]))
        .finally(() => setFofLoading(false))
    }, 150)
    return () => {
      if (fofSearchRef.current) clearTimeout(fofSearchRef.current)
    }
  }, [fofInput, fofShow])

  function fetchHoldings(
    keyword: string,
    setOptions: (rows: UnderlyingOption[]) => void,
    setLoading: (v: boolean) => void,
  ) {
    if (!fofSelected) {
      setOptions([])
      return
    }
    setLoading(true)
    const holdingParams = new URLSearchParams({
      page: "1",
      pageSize: "50",
      fof_fund_name: fofSelected.product_name,
    })
    if (keyword.trim()) holdingParams.set("keyword", keyword.trim())

    const clearedParams = new URLSearchParams({
      page: "1",
      pageSize: "30",
      holding_status: "cleared",
    })
    if (keyword.trim()) clearedParams.set("keyword", keyword.trim())

    Promise.all([
      fetch(`/ma/api/investment/fof-underlying-detail/list?${holdingParams}`)
        .then((r) => r.json())
        .then((d) => parseUnderlyingHoldingOptions(d, true))
        .catch(() => [] as UnderlyingOption[]),
      fetch(`/ma/api/ops/fof-underlying/list?${clearedParams}`)
        .then((r) => r.json())
        .then((d) => parseUnderlyingHoldingOptions(d, false))
        .catch(() => [] as UnderlyingOption[]),
    ])
      .then(([holding, cleared]) => setOptions(mergeUnderlyingOptions(holding, cleared)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!outShow) return
    if (outSearchRef.current) clearTimeout(outSearchRef.current)
    outSearchRef.current = setTimeout(() => fetchHoldings(outInput, setOutOptions, setOutLoading), 150)
    return () => {
      if (outSearchRef.current) clearTimeout(outSearchRef.current)
    }
  }, [outShow, outInput, fofSelected?.product_name])

  useEffect(() => {
    if (!inShow) return
    if (inSearchRef.current) clearTimeout(inSearchRef.current)
    inSearchRef.current = setTimeout(() => fetchHoldings(inInput, setInOptions, setInLoading), 150)
    return () => {
      if (inSearchRef.current) clearTimeout(inSearchRef.current)
    }
  }, [inShow, inInput, fofSelected?.product_name])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!fofWrapRef.current?.contains(e.target as Node)) setFofShow(false)
      if (!outWrapRef.current?.contains(e.target as Node)) setOutShow(false)
      if (!inWrapRef.current?.contains(e.target as Node)) setInShow(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  useEffect(() => {
    setOutSelected(null)
    setInSelected(null)
    setOutOptions([])
    setInOptions([])
    setOutShow(false)
    setInShow(false)
  }, [fofSelected?.beian_hao, fofSelected?.product_name])

  function loadElements(
    fund: UnderlyingOption | null,
    setOpen: (v: string | null) => void,
    setTemp: (v: string | null) => void,
  ) {
    if (!fund) {
      setOpen(null)
      setTemp(null)
      return () => {}
    }
    const ac = new AbortController()
    const params = new URLSearchParams({
      beian_hao: fund.beian_hao,
      product_name: fund.product_name,
    })
    fetch(`/ma/api/ops/fund-elements?${params}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("not found")
        return r.json()
      })
      .then((d: { open_day?: string | null; is_temporary_open?: string | null }) => {
        if (ac.signal.aborted) return
        setOpen(d.open_day ?? null)
        setTemp(d.is_temporary_open ?? null)
      })
      .catch(() => {
        if (ac.signal.aborted) return
        setOpen(null)
        setTemp(null)
      })
    return () => ac.abort()
  }

  useEffect(() => loadElements(outSelected, setOutOpenDay, setOutTempOpen), [outSelected?.beian_hao, outSelected?.product_name])
  useEffect(() => loadElements(inSelected, setInOpenDay, setInTempOpen), [inSelected?.beian_hao, inSelected?.product_name])

  function resetForm() {
    setFofInput("")
    setFofSelected(null)
    setFofOptions([])
    setFofShow(false)
    setSummary("")
    setAttachment(null)
    setDragOver(false)
    setApplyDate("")
    setOutAmount("")
    setOutShares("")
    setInAmount("")
    setOutInput("")
    setOutSelected(null)
    setOutOptions([])
    setOutShow(false)
    setOutOpenDay(null)
    setOutTempOpen(null)
    setInInput("")
    setInSelected(null)
    setInOptions([])
    setInShow(false)
    setInOpenDay(null)
    setInTempOpen(null)
    setInTouched(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleSubmit() {
    if (!fofSelected) {
      toast({ title: "请选择FOF基金", variant: "destructive" })
      return
    }
    if (!outSelected) {
      toast({ title: "请选择转出底层基金", variant: "destructive" })
      return
    }
    if (!inSelected) {
      setInTouched(true)
      toast({ title: "请选择转入底层基金", variant: "destructive" })
      return
    }
    if (outSelected.beian_hao === inSelected.beian_hao && outSelected.product_name === inSelected.product_name) {
      toast({ title: "转入与转出基金不能相同", variant: "destructive" })
      return
    }
    if (!applyDate) {
      toast({ title: "请选择转换申请日期", variant: "destructive" })
      return
    }
    if (!outAmount.trim() && !outShares.trim()) {
      toast({ title: "请输入转出申请金额或份额", variant: "destructive" })
      return
    }

    setSubmitting(true)
    try {
      const outName = outSelected.short_name || outSelected.product_name
      const inName = inSelected.short_name || inSelected.product_name
      const record = addInstructionRecord({
        category: "underlying",
        type: "转换",
        fofFundName: fofSelected.product_name,
        fofBeianHao: fofSelected.beian_hao,
        underlyingFundName: `${outName} → ${inName}`,
        underlyingBeianHao: outSelected.beian_hao,
        applyDate,
        amount: outAmount.trim() || "0",
        shares: outShares.trim() || null,
        summary: summary.trim() || `转入：${inName}${inAmount.trim() ? `，转入金额 ${inAmount.trim()}` : ""}`,
        progress: "待审批(2/4)",
      })
      setSubmittedRecord(record)
      resetForm()
    } catch {
      toast({ title: "提交失败", description: "请稍后重试", variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (submittedRecord) {
    return (
      <InstructionSubmitSuccess
        record={submittedRecord}
        onContinue={() => {
          setSubmittedRecord(null)
          onBack()
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <div className="relative flex items-center justify-center border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={onBack}
          className="absolute left-0 inline-flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="返回"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-base font-semibold text-foreground">底层转换</h2>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FormLabel required className="w-auto pt-0">选择FOF基金:</FormLabel>
        <div ref={fofWrapRef} className="relative w-full min-w-[240px] max-w-md">
          {fofSelected && !fofShow ? (
            <button
              type="button"
              onClick={() => {
                setFofInput("")
                setFofShow(true)
              }}
              className="flex h-9 w-full items-center justify-between rounded border border-border bg-background px-3 text-left"
            >
              <span className="truncate text-sm">{fofSelected.product_name}</span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-zinc-400" />
            </button>
          ) : (
            <div className="relative">
              <input
                type="text"
                value={fofInput}
                onChange={(e) => {
                  setFofInput(e.target.value)
                  setFofShow(true)
                }}
                onFocus={() => setFofShow(true)}
                onClick={() => setFofShow(true)}
                placeholder="请输入并选择FOF基金"
                className="h-9 w-full rounded border border-border bg-background px-3 pr-9 text-sm focus:border-red-400 focus:outline-none focus:ring-1 focus:ring-red-400/60 placeholder:text-muted-foreground/50"
              />
              <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            </div>
          )}
          {fofShow && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border bg-background shadow-lg">
              {fofLoading && fofOptions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-zinc-400">加载中…</div>
              ) : fofOptions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-zinc-400">暂无在管产品</div>
              ) : (
                fofOptions.map((opt) => (
                  <button
                    key={`${opt.beian_hao}-${opt.product_name}`}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setFofSelected(opt)
                      setFofInput("")
                      setFofShow(false)
                    }}
                    className="w-full truncate px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                  >
                    {opt.product_name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-start gap-3">
        <FormLabel className="pt-2">指令摘要:</FormLabel>
        <input
          type="text"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="请输入指令摘要"
          className="h-9 w-full max-w-2xl rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="flex items-start gap-3">
        <FormLabel className="pt-2">附件:</FormLabel>
        <div className="w-full max-w-md">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) setAttachment(file)
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              const file = e.dataTransfer.files?.[0]
              if (file) setAttachment(file)
            }}
            className={[
              "flex h-24 w-full flex-col items-center justify-center gap-2 rounded border border-dashed text-sm transition-colors",
              dragOver
                ? "border-red-400 bg-red-50/60 dark:bg-red-950/20"
                : "border-zinc-300 bg-zinc-50/80 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/40",
            ].join(" ")}
          >
            <CloudUpload className="h-5 w-5 text-zinc-400" />
            {attachment ? (
              <span className="max-w-[90%] truncate px-3 text-zinc-700 dark:text-zinc-200">{attachment.name}</span>
            ) : (
              <span className="text-zinc-400">点击或拖拽上传</span>
            )}
          </button>
        </div>
      </div>

      <section className="rounded-md border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
        <SectionTitle>FOF基金</SectionTitle>
        {fofSelected ? (
          <div className="space-y-2.5 text-sm">
            <div className="font-medium text-zinc-800 dark:text-zinc-100">{fofSelected.product_name}</div>
            <div className="flex flex-wrap items-baseline gap-x-1">
              <span className="text-zinc-500">托管户现金余额:</span>
              <span className="font-medium text-red-500">{formatBalance(fofSelected.custody_balance)}</span>
              <span className="text-zinc-400">(最新估值表日期: {fofSelected.valuation_date || "--"})</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-1">
              <span className="text-zinc-500">托管户预估余额:</span>
              <span className="font-medium text-red-500">{formatBalance(fofSelected.custody_balance)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-zinc-500">指令类型:</span>
              <span className="font-medium text-red-500">转换</span>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 text-sm text-zinc-400">
            <div>--</div>
            <div>托管户现金余额: —</div>
            <div>托管户预估余额: —</div>
            <div className="flex items-center gap-1">
              <span>指令类型:</span>
              <span className="font-medium text-red-500">转换</span>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-md border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
        <SectionTitle>底层基金</SectionTitle>

        <div className="relative space-y-4 border-b border-zinc-100 pb-6 dark:border-zinc-800">
          <Watermark text="转出" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-start gap-3 min-w-0">
              <FormLabel required className="pt-2">选择基金:</FormLabel>
              <div ref={outWrapRef} className="min-w-0 flex-1">
                <FundSearchPicker
                  selected={outSelected}
                  input={outInput}
                  options={outOptions}
                  loading={outLoading}
                  showDropdown={outShow}
                  placeholder="请输入关键字搜索底层基金"
                  onInputChange={(v) => {
                    setOutInput(v)
                    setOutShow(true)
                  }}
                  onOpen={() => {
                    if (!fofSelected) {
                      toast({ title: "请先选择FOF基金", variant: "destructive" })
                      return
                    }
                    setOutShow(true)
                  }}
                  onSelect={(opt) => {
                    setOutSelected(opt)
                    setOutInput("")
                    setOutShow(false)
                    setOutAmount("")
                    setOutShares("")
                  }}
                />
              </div>
            </div>
            <InfoRow
              label="开放日"
              value={outSelected ? (outOpenDay?.trim() || "—") : hint}
              placeholder={!outSelected}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-center gap-3 min-w-0">
              <FormLabel required>转换申请日期:</FormLabel>
              <div className="min-w-0 max-w-md flex-1">
                <DateInput value={applyDate} onChange={setApplyDate} placeholder="请选择日期" />
              </div>
            </div>
            <InfoRow
              label="是否临开"
              value={outSelected ? formatTemporaryOpen(outTempOpen) : hint}
              placeholder={!outSelected}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
            <div className="flex items-start gap-3 min-w-0">
              <FormLabel required className="pt-2">转出申请金额:</FormLabel>
              <div className="min-w-0 max-w-md flex-1">
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={outAmount}
                    onChange={(e) => {
                      const next = e.target.value
                      setOutAmount(next)
                      const amt = parseNumberInput(next)
                      const nav = parseNumberInput(outSelected?.unit_nav ?? "")
                      if (amt != null && nav != null && nav > 0) setOutShares((amt / nav).toFixed(2))
                      if (amt != null) setInAmount(amt.toFixed(2))
                    }}
                    placeholder="请输入转出申请金额"
                    className={[
                      "h-9 w-full rounded border bg-background px-3 pr-9 text-sm focus:outline-none focus:ring-1 placeholder:text-muted-foreground/50",
                      amountOverEstimated
                        ? "border-red-400 focus:ring-red-400/60"
                        : "border-border focus:ring-ring",
                    ].join(" ")}
                  />
                  <EstimateMark />
                </div>
                {amountOverEstimated ? (
                  <div className="mt-1 text-xs text-red-500">请注意转出金额小于托管户预估余额</div>
                ) : null}
              </div>
            </div>
            <div className="pt-2">
              <InfoRow
                label="持仓份额"
                value={outSelected ? formatBalance(outSelected.investment_shares, "份", 2) : hint}
                accent={Boolean(outSelected)}
                placeholder={!outSelected}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
            <div className="flex items-start gap-3 min-w-0">
              <FormLabel className="pt-2">转出申请份额:</FormLabel>
              <div className="min-w-0 max-w-md flex-1">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={outShares}
                    onChange={(e) => {
                      const next = e.target.value
                      setOutShares(next)
                      const shareNum = parseNumberInput(next)
                      const nav = parseNumberInput(outSelected?.unit_nav ?? "")
                      if (shareNum != null && nav != null && nav > 0) {
                        const amt = (shareNum * nav).toFixed(2)
                        setOutAmount(amt)
                        setInAmount(amt)
                      }
                    }}
                    placeholder="请输入转出申请份额"
                    className={[
                      "h-9 min-w-0 flex-1 rounded border bg-background px-3 text-sm focus:outline-none focus:ring-1 placeholder:text-muted-foreground/50",
                      sharesOverHolding
                        ? "border-red-400 focus:ring-red-400/60"
                        : "border-border focus:ring-ring",
                    ].join(" ")}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!outSelected?.investment_shares) {
                        toast({ title: "请先选择转出底层基金", variant: "destructive" })
                        return
                      }
                      const holding = String(outSelected.investment_shares)
                      setOutShares(holding)
                      const shareNum = parseNumberInput(holding)
                      const nav = parseNumberInput(outSelected.unit_nav ?? "")
                      if (shareNum != null && nav != null && nav > 0) {
                        const amt = (shareNum * nav).toFixed(2)
                        setOutAmount(amt)
                        setInAmount(amt)
                      }
                    }}
                    className="shrink-0 text-sm text-blue-500 hover:underline"
                  >
                    全部赎回
                  </button>
                </div>
                {sharesOverHolding ? (
                  <div className="mt-1 text-xs text-red-500">请注意赎回份额大于持仓份额</div>
                ) : null}
              </div>
            </div>
            <div className="pt-2">
              <InfoRow
                label="最新净值"
                value={outSelected ? formatNav(outSelected.unit_nav, outSelected.nav_date) : hint}
                accent={Boolean(outSelected)}
                placeholder={!outSelected}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center py-4">
          <div className="flex flex-col items-center gap-1 text-red-500">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white shadow-sm">
              <ArrowLeftRight className="h-5 w-5" />
            </div>
            <span className="text-xs font-medium">转换</span>
          </div>
        </div>

        <div className="relative space-y-4 pt-1">
          <Watermark text="转入" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-start gap-3 min-w-0">
              <FormLabel required className="pt-2">选择转入基金:</FormLabel>
              <div ref={inWrapRef} className="min-w-0 flex-1">
                <FundSearchPicker
                  selected={inSelected}
                  input={inInput}
                  options={inOptions}
                  loading={inLoading}
                  showDropdown={inShow}
                  placeholder="请输入关键字搜索底层基金"
                  error={inSelectError}
                  emptyText="暂无底层基金"
                  onInputChange={(v) => {
                    setInInput(v)
                    setInTouched(true)
                    setInShow(true)
                  }}
                  onOpen={() => {
                    if (!fofSelected) {
                      toast({ title: "请先选择FOF基金", variant: "destructive" })
                      return
                    }
                    setInTouched(true)
                    setInShow(true)
                  }}
                  onSelect={(opt) => {
                    setInSelected(opt)
                    setInInput("")
                    setInShow(false)
                    setInTouched(false)
                  }}
                />
              </div>
            </div>
            <InfoRow
              label="开放日"
              value={inSelected ? (inOpenDay?.trim() || "—") : hint}
              placeholder={!inSelected}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-center gap-3 min-w-0">
              <FormLabel>转换申请日期:</FormLabel>
              <div className="text-sm text-zinc-600 dark:text-zinc-300">
                {applyDate || <span className="text-zinc-400">请先选择转出申请日期</span>}
              </div>
            </div>
            <InfoRow
              label="是否临开"
              value={inSelected ? formatTemporaryOpen(inTempOpen) : hint}
              placeholder={!inSelected}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-center gap-3 min-w-0">
              <FormLabel>转入申请金额:</FormLabel>
              <div className="relative min-w-0 max-w-md flex-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={inAmount}
                  onChange={(e) => setInAmount(e.target.value)}
                  placeholder="请输入转入申请金额"
                  className="h-9 w-full rounded border border-border bg-background px-3 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                />
                <EstimateMark />
              </div>
            </div>
            <InfoRow
              label="持仓金额"
              value={inSelected ? formatBalance(inSelected.market_value) : hint}
              accent={Boolean(inSelected)}
              placeholder={!inSelected}
            />
          </div>
        </div>
      </section>

      <section className="rounded-md border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
        <SectionTitle>最近的指令</SectionTitle>
        <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/60">
                {RECENT_COLUMNS.map((col) => (
                  <th
                    key={col}
                    className="whitespace-nowrap border-b border-zinc-200 px-3 py-2.5 text-left font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!outSelected || recentRows.length === 0 ? (
                <tr>
                  <td colSpan={RECENT_COLUMNS.length} className="py-14">
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />
                      <span className="text-sm">
                        {!outSelected ? "请选择转出底层基金查看最近指令" : "暂无数据"}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                recentRows.map((row, i) => (
                  <tr key={row.id} className="border-t border-zinc-100 hover:bg-muted/30 dark:border-zinc-800">
                    <td className="px-3 py-2.5 text-center">{i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{row.id}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{row.applyDate}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="inline-flex rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
                        {row.type}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">{row.underlyingFundName}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{row.amount}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{row.shares ?? "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{row.nav ?? "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {row.progress}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button type="button" className="rounded p-0.5 text-zinc-400 hover:text-zinc-700" title="查看">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex items-center justify-center gap-3 pt-1">
        <button
          type="button"
          onClick={resetForm}
          className="h-9 min-w-[88px] rounded border border-zinc-300 bg-background px-5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200"
        >
          重置
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="h-9 min-w-[88px] rounded bg-red-500 px-5 text-sm text-white hover:bg-red-600 disabled:opacity-60"
        >
          {submitting ? "提交中…" : "提交"}
        </button>
      </div>
    </div>
  )
}
