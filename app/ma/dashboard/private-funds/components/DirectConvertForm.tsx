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

interface InvestorOption {
  id: string
  name: string
}

interface FundOption {
  beian_hao: string
  product_name: string
  display_name: string
  unit_nav: string | null
  nav_date: string | null
}

function shortFundDisplayName(productName: string): string {
  const trimmed = productName.trim()
  const short = trimmed
    .replace(/私募证券投资基金/g, "")
    .replace(/证券投资基金/g, "")
    .replace(/私募基金/g, "")
    .trim()
  return short || trimmed
}

function todayDateString(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function pushInvestor(
  out: InvestorOption[],
  seen: Set<string>,
  name: string | null | undefined,
  id?: string | null,
) {
  const trimmed = (name || "").trim()
  if (!trimmed || seen.has(trimmed)) return
  seen.add(trimmed)
  out.push({ id: (id || trimmed).trim(), name: trimmed })
}

function parseInvestorOptions(json: unknown): InvestorOption[] {
  const out: InvestorOption[] = []
  const seen = new Set<string>()
  const data = Array.isArray(json) ? json : (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return out
  for (const row of data as { id?: string; name?: string }[]) {
    pushInvestor(out, seen, row.name, row.id)
  }
  return out
}

function parseFundOptions(json: unknown): FundOption[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: FundOption[] = []
  for (const row of data as {
    beian_hao?: string
    product_name?: string
    short_name?: string | null
    latest_nav?: string | null
    latest_nav_date?: string | null
  }[]) {
    if (!row.product_name || !row.beian_hao) continue
    const display = (row.short_name || "").trim() || shortFundDisplayName(row.product_name)
    out.push({
      beian_hao: row.beian_hao,
      product_name: row.product_name,
      display_name: display,
      unit_nav: row.latest_nav ?? null,
      nav_date: row.latest_nav_date ?? null,
    })
  }
  return out
}

function formatTemporaryOpen(value: string | null | undefined): string {
  if (!value) return "-"
  if (value.includes("不可")) return "否"
  if (value.includes("可")) return "是"
  return value
}

function formatNav(value: string | null | undefined, date?: string | null): string {
  if (value == null || value === "") return "-"
  const n = Number(value)
  const navText = Number.isFinite(n)
    ? n.toLocaleString("zh-CN", { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    : value
  return date ? `${navText} (${date})` : navText
}

function parseNumberInput(value: string): number | null {
  const n = Number(String(value).replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : null
}

const RECENT_COLUMNS = [
  "序号",
  "指令ID",
  "投资者名称",
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm">
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{label}:</span>
      <span className="min-w-0 break-words text-zinc-500 dark:text-zinc-400">{value}</span>
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

function EstimateMark() {
  return (
    <span
      className="pointer-events-none absolute right-8 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-red-400 text-[10px] font-medium leading-none text-red-500"
      title="估算"
      aria-hidden="true"
    >
      估
    </span>
  )
}

function FundSearchPicker({
  selected,
  input,
  options,
  loading,
  showDropdown,
  placeholder,
  onInputChange,
  onOpen,
  onSelect,
}: {
  selected: FundOption | null
  input: string
  options: FundOption[]
  loading: boolean
  showDropdown: boolean
  placeholder: string
  onInputChange: (v: string) => void
  onOpen: () => void
  onSelect: (opt: FundOption) => void
}) {
  return (
    <div className="relative min-w-0 flex-1 max-w-md">
      <div
        className={[
          "flex items-center overflow-visible rounded border bg-background",
          showDropdown ? "border-red-400 ring-1 ring-red-400/60" : "border-border",
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
              <span className="truncate text-sm">{selected.display_name}</span>
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
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-md border bg-background shadow-lg">
          {loading && options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-zinc-400">加载中…</div>
          ) : options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-zinc-400">暂无基金</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.beian_hao}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(opt)}
                className={[
                  "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted",
                  selected?.beian_hao === opt.beian_hao ? "bg-muted" : "",
                ].join(" ")}
              >
                <span className="truncate">{opt.display_name}</span>
                <span className="truncate text-xs text-zinc-400">
                  {opt.beian_hao}
                  {opt.display_name !== opt.product_name ? ` · ${opt.product_name}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function DirectConvertForm({ onBack }: { onBack: () => void }) {
  const { toast } = useToast()
  const allRecords = useSyncExternalStore(
    subscribeInstructionRecords,
    getInstructionRecordsSnapshot,
    getInstructionRecordsServerSnapshot,
  )

  const [submittedRecord, setSubmittedRecord] = useState<InstructionRecord | null>(null)
  const [summary, setSummary] = useState("")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [applyDate, setApplyDate] = useState("")
  const [outAmount, setOutAmount] = useState("")
  const [outShares, setOutShares] = useState("")
  const [inAmount, setInAmount] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const [investorInput, setInvestorInput] = useState("")
  const [investorSelected, setInvestorSelected] = useState<InvestorOption | null>(null)
  const [investorOptions, setInvestorOptions] = useState<InvestorOption[]>([])
  const [investorShow, setInvestorShow] = useState(false)
  const [investorLoading, setInvestorLoading] = useState(false)

  const [outInput, setOutInput] = useState("")
  const [outSelected, setOutSelected] = useState<FundOption | null>(null)
  const [outOptions, setOutOptions] = useState<FundOption[]>([])
  const [outShow, setOutShow] = useState(false)
  const [outLoading, setOutLoading] = useState(false)
  const [outOpenDay, setOutOpenDay] = useState<string | null>(null)
  const [outTempOpen, setOutTempOpen] = useState<string | null>(null)

  const [inInput, setInInput] = useState("")
  const [inSelected, setInSelected] = useState<FundOption | null>(null)
  const [inOptions, setInOptions] = useState<FundOption[]>([])
  const [inShow, setInShow] = useState(false)
  const [inLoading, setInLoading] = useState(false)
  const [inOpenDay, setInOpenDay] = useState<string | null>(null)
  const [inTempOpen, setInTempOpen] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const investorWrapRef = useRef<HTMLDivElement>(null)
  const outWrapRef = useRef<HTMLDivElement>(null)
  const inWrapRef = useRef<HTMLDivElement>(null)
  const investorSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const recentRows = useMemo(() => {
    if (!outSelected && !investorSelected) return [] as InstructionRecord[]
    return allRecords
      .filter((r) => {
        if (r.category !== "direct") return false
        if (investorSelected && r.fofFundName !== investorSelected.name) return false
        if (outSelected) {
          const matchName =
            r.underlyingFundName.includes(outSelected.display_name)
            || r.underlyingFundName.includes(outSelected.product_name)
            || r.underlyingBeianHao === outSelected.beian_hao
          if (!matchName) return false
        }
        return true
      })
      .slice(0, 20)
  }, [allRecords, outSelected, investorSelected])

  useEffect(() => {
    if (!investorShow) return
    if (investorSearchRef.current) clearTimeout(investorSearchRef.current)
    investorSearchRef.current = setTimeout(() => {
      const q = investorInput.trim()
      setInvestorLoading(true)
      const params = new URLSearchParams()
      if (q) params.set("keyword", q)
      fetch(`/ma/api/ops/instruction-investors?${params}`)
        .then((r) => r.json())
        .then((d) => setInvestorOptions(parseInvestorOptions(d)))
        .catch(() => setInvestorOptions([]))
        .finally(() => setInvestorLoading(false))
    }, 80)
    return () => {
      if (investorSearchRef.current) clearTimeout(investorSearchRef.current)
    }
  }, [investorInput, investorShow])

  function fetchFunds(
    keyword: string,
    setOptions: (rows: FundOption[]) => void,
    setLoading: (v: boolean) => void,
  ) {
    setLoading(true)
    const params = new URLSearchParams({ page: "1" })
    if (keyword.trim()) params.set("keyword", keyword.trim())
    fetch(`/ma/api/private-funds/list?${params}`)
      .then((r) => r.json())
      .then((d) => setOptions(parseFundOptions(d)))
      .catch(() => setOptions([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!outShow) return
    if (outSearchRef.current) clearTimeout(outSearchRef.current)
    outSearchRef.current = setTimeout(() => fetchFunds(outInput, setOutOptions, setOutLoading), 150)
    return () => {
      if (outSearchRef.current) clearTimeout(outSearchRef.current)
    }
  }, [outShow, outInput])

  useEffect(() => {
    if (!inShow) return
    if (inSearchRef.current) clearTimeout(inSearchRef.current)
    inSearchRef.current = setTimeout(() => fetchFunds(inInput, setInOptions, setInLoading), 150)
    return () => {
      if (inSearchRef.current) clearTimeout(inSearchRef.current)
    }
  }, [inShow, inInput])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!investorWrapRef.current?.contains(e.target as Node)) setInvestorShow(false)
      if (!outWrapRef.current?.contains(e.target as Node)) setOutShow(false)
      if (!inWrapRef.current?.contains(e.target as Node)) setInShow(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  function loadElements(
    fund: FundOption | null,
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

  useEffect(
    () => loadElements(outSelected, setOutOpenDay, setOutTempOpen),
    [outSelected?.beian_hao, outSelected?.product_name],
  )
  useEffect(
    () => loadElements(inSelected, setInOpenDay, setInTempOpen),
    [inSelected?.beian_hao, inSelected?.product_name],
  )

  function resetForm() {
    setSummary("")
    setAttachment(null)
    setDragOver(false)
    setApplyDate("")
    setOutAmount("")
    setOutShares("")
    setInAmount("")
    setInvestorInput("")
    setInvestorSelected(null)
    setInvestorOptions([])
    setInvestorShow(false)
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
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleSubmit() {
    if (!investorSelected) {
      toast({ title: "请选择投资者名称", variant: "destructive" })
      return
    }
    if (!outSelected) {
      toast({ title: "请选择转出基金", variant: "destructive" })
      return
    }
    if (!inSelected) {
      toast({ title: "请选择转入基金", variant: "destructive" })
      return
    }
    if (outSelected.beian_hao === inSelected.beian_hao) {
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
      const outName = outSelected.display_name
      const inName = inSelected.display_name
      const record = addInstructionRecord({
        category: "direct",
        type: "转换",
        fofFundName: investorSelected.name,
        fofBeianHao: investorSelected.id,
        underlyingFundName: `${outName} → ${inName}`,
        underlyingBeianHao: outSelected.beian_hao,
        applyDate,
        amount: outAmount.trim() || "0",
        shares: outShares.trim() || null,
        summary: summary.trim() || `转入：${inName}${inAmount.trim() ? `，转入金额 ${inAmount.trim()}` : ""}`,
        nav: outSelected.unit_nav,
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
        <h2 className="text-base font-semibold text-foreground">基金转换</h2>
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

      <div className="flex items-center gap-3">
        <FormLabel className="pt-0">指令类型:</FormLabel>
        <span className="text-sm font-medium text-red-500">转换</span>
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

      <section className="rounded-md border border-zinc-200 bg-zinc-50/50 px-5 py-5 dark:border-zinc-800 dark:bg-zinc-900/20">
        <div className="relative space-y-4">
          <Watermark text="转出" />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-start gap-3 min-w-0">
              <FormLabel required className="pt-2">投资者名称:</FormLabel>
              <div ref={investorWrapRef} className="relative min-w-0 max-w-md flex-1">
                {investorSelected && !investorShow ? (
                  <button
                    type="button"
                    onClick={() => {
                      setInvestorInput("")
                      setInvestorShow(true)
                    }}
                    className="flex h-9 w-full items-center justify-between rounded border border-border bg-background px-3 text-left hover:border-zinc-300"
                  >
                    <span className="truncate text-sm">{investorSelected.name}</span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-zinc-400" />
                  </button>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={investorInput}
                      onChange={(e) => {
                        setInvestorInput(e.target.value)
                        setInvestorShow(true)
                      }}
                      onFocus={() => setInvestorShow(true)}
                      onClick={() => setInvestorShow(true)}
                      placeholder="请输入并选择投资者名称"
                      className={[
                        "h-9 w-full rounded border bg-background px-3 pr-9 text-sm outline-none placeholder:text-muted-foreground/50",
                        investorShow
                          ? "border-red-400 ring-1 ring-red-400/60"
                          : "border-border focus:border-red-400 focus:ring-1 focus:ring-red-400/60",
                      ].join(" ")}
                    />
                    <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  </div>
                )}
                {investorShow && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded border border-zinc-200 bg-background shadow-lg dark:border-zinc-700">
                    {investorLoading && investorOptions.length === 0 ? (
                      <div className="px-3 py-2.5 text-sm text-zinc-400">加载中…</div>
                    ) : investorOptions.length === 0 ? (
                      <div className="px-3 py-2.5 text-sm text-zinc-400">暂无投资者</div>
                    ) : (
                      investorOptions.map((opt) => (
                        <button
                          key={`${opt.id}-${opt.name}`}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setInvestorSelected(opt)
                            setInvestorInput("")
                            setInvestorShow(false)
                          }}
                          className={[
                            "w-full truncate px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
                            investorSelected?.name === opt.name ? "bg-zinc-100 dark:bg-zinc-800" : "",
                          ].join(" ")}
                        >
                          {opt.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
            <InfoRow label="开放日" value={outSelected ? (outOpenDay?.trim() || "-") : "-"} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-start gap-3 min-w-0">
              <FormLabel required className="pt-2">选择转出基金:</FormLabel>
              <div ref={outWrapRef} className="min-w-0 flex-1">
                <FundSearchPicker
                  selected={outSelected}
                  input={outInput}
                  options={outOptions}
                  loading={outLoading}
                  showDropdown={outShow}
                  placeholder="输入名称/备案号/代码选择"
                  onInputChange={(v) => {
                    setOutInput(v)
                    setOutShow(true)
                  }}
                  onOpen={() => setOutShow(true)}
                  onSelect={(opt) => {
                    setOutSelected(opt)
                    setOutInput("")
                    setOutShow(false)
                    setOutAmount("")
                    setOutShares("")
                    setApplyDate((prev) => prev || todayDateString())
                  }}
                />
              </div>
            </div>
            <InfoRow
              label="是否临开"
              value={outSelected ? formatTemporaryOpen(outTempOpen) : "-"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-center gap-3 min-w-0">
              <FormLabel required>转换申请日期:</FormLabel>
              <div className="min-w-0 max-w-md flex-1">
                <DateInput value={applyDate} onChange={setApplyDate} placeholder="请选择日期" />
              </div>
            </div>
            <InfoRow label="持仓份额" value="-" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-center gap-3 min-w-0">
              <FormLabel required>转出申请金额:</FormLabel>
              <div className="relative min-w-0 max-w-md flex-1">
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
                  className="h-9 w-full rounded border border-border bg-background px-3 pr-14 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                />
                <EstimateMark />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-red-500">
                  元
                </span>
              </div>
            </div>
            <InfoRow
              label="单位净值"
              value={outSelected ? formatNav(outSelected.unit_nav, outSelected.nav_date) : "-"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-center gap-3 min-w-0">
              <FormLabel>转出申请份额:</FormLabel>
              <div className="flex min-w-0 max-w-md flex-1 items-center gap-2">
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
                  className="h-9 min-w-0 flex-1 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                />
                <button
                  type="button"
                  onClick={() => {
                    toast({
                      title: "暂无持仓份额数据",
                      description: "请手动输入转出申请份额",
                    })
                  }}
                  className="shrink-0 text-sm text-blue-500 hover:underline"
                >
                  全部赎回
                </button>
              </div>
            </div>
            <div />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-center py-1">
        <div className="flex flex-col items-center gap-1 text-red-500">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 text-white shadow-sm">
            <ArrowLeftRight className="h-5 w-5" />
          </div>
          <span className="text-xs font-medium">转换</span>
        </div>
      </div>

      <section className="rounded-md border border-zinc-200 bg-zinc-50/50 px-5 py-5 dark:border-zinc-800 dark:bg-zinc-900/20">
        <div className="relative space-y-4">
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
                  placeholder="输入名称/备案号/代码选择"
                  onInputChange={(v) => {
                    setInInput(v)
                    setInShow(true)
                  }}
                  onOpen={() => setInShow(true)}
                  onSelect={(opt) => {
                    setInSelected(opt)
                    setInInput("")
                    setInShow(false)
                  }}
                />
              </div>
            </div>
            <InfoRow label="开放日" value={inSelected ? (inOpenDay?.trim() || "-") : "-"} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-center gap-3 min-w-0">
              <FormLabel>转换申请日期:</FormLabel>
              <div className="text-sm text-zinc-500">{applyDate || "-"}</div>
            </div>
            <InfoRow
              label="是否临开"
              value={inSelected ? formatTemporaryOpen(inTempOpen) : "-"}
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
                  className="h-9 w-full rounded border border-border bg-background px-3 pr-14 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                />
                <EstimateMark />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-red-500">
                  元
                </span>
              </div>
            </div>
            <InfoRow label="持仓金额" value="-" />
          </div>
        </div>
      </section>

      <section className="rounded-md border border-zinc-200 bg-background px-5 py-4 dark:border-zinc-800">
        <SectionTitle>最近的指令</SectionTitle>
        <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
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
              {recentRows.length === 0 ? (
                <tr>
                  <td colSpan={RECENT_COLUMNS.length} className="py-14">
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />
                      <span className="text-sm">暂无数据</span>
                    </div>
                  </td>
                </tr>
              ) : (
                recentRows.map((row, i) => (
                  <tr key={row.id} className="border-t border-zinc-100 hover:bg-muted/30 dark:border-zinc-800">
                    <td className="px-3 py-2.5 text-center">{i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{row.id}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">{row.fofFundName}</td>
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

      <div className="flex items-center justify-end gap-3 pt-1">
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
