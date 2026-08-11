"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  ArrowLeft,
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

type DirectInstructionType = "认购" | "申购" | "赎回"

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
  if (!value) return "—"
  if (value.includes("不可")) return "否"
  if (value.includes("可")) return "是"
  return value
}

function formatNav(value: string | null | undefined, date?: string | null): string {
  if (value == null || value === "") return "—"
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

/** Convert RMB amount to Chinese uppercase, e.g. 1000000 -> 壹佰万元整 */
function amountToChineseUppercase(value: string): string {
  const raw = value.replace(/,/g, "").trim()
  if (!raw) return ""
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return ""

  const digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"]
  const units = ["", "拾", "佰", "仟"]
  const bigUnits = ["", "万", "亿"]

  const [intPartRaw, decPartRaw = ""] = n.toFixed(2).split(".")
  const intPart = intPartRaw.replace(/^0+/, "") || "0"

  function sectionToChinese(section: string): string {
    let result = ""
    let zero = false
    for (let i = 0; i < section.length; i++) {
      const d = Number(section[i])
      const pos = section.length - i - 1
      if (d === 0) {
        zero = result.length > 0
      } else {
        if (zero) result += "零"
        result += digits[d] + units[pos]
        zero = false
      }
    }
    return result
  }

  let chinese = ""
  if (intPart === "0") {
    chinese = "零"
  } else {
    const groups: string[] = []
    let rest = intPart
    while (rest.length > 0) {
      groups.unshift(rest.slice(-4))
      rest = rest.slice(0, -4)
    }
    groups.forEach((group, idx) => {
      const big = bigUnits[groups.length - idx - 1] ?? ""
      const piece = sectionToChinese(group)
      if (piece) chinese += piece + big
      else if (chinese && !chinese.endsWith("零") && big === "万") chinese += "零"
    })
  }

  const jiao = Number(decPartRaw[0] || "0")
  const fen = Number(decPartRaw[1] || "0")
  if (jiao === 0 && fen === 0) return `${chinese}元整`
  let dec = "元"
  if (jiao > 0) dec += `${digits[jiao]}角`
  else if (fen > 0) dec += "零"
  if (fen > 0) dec += `${digits[fen]}分`
  return `${chinese}${dec}`
}

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

export function DirectSubscribeForm({
  instructionType = "认购",
  onBack,
}: {
  instructionType?: DirectInstructionType
  onBack: () => void
}) {
  const { toast } = useToast()
  const allRecords = useSyncExternalStore(
    subscribeInstructionRecords,
    getInstructionRecordsSnapshot,
    getInstructionRecordsServerSnapshot,
  )

  const pageTitle =
    instructionType === "申购"
      ? "直投产品申购"
      : instructionType === "赎回"
        ? "直投产品赎回"
        : "直投产品认购"

  const [submittedRecord, setSubmittedRecord] = useState<InstructionRecord | null>(null)
  const [investorInput, setInvestorInput] = useState("")
  const [investorSelected, setInvestorSelected] = useState<InvestorOption | null>(null)
  const [investorOptions, setInvestorOptions] = useState<InvestorOption[]>([])
  const [investorShow, setInvestorShow] = useState(false)
  const [investorLoading, setInvestorLoading] = useState(false)

  const [fundInput, setFundInput] = useState("")
  const [fundSelected, setFundSelected] = useState<FundOption | null>(null)
  const [fundOptions, setFundOptions] = useState<FundOption[]>([])
  const [fundShow, setFundShow] = useState(false)
  const [fundLoading, setFundLoading] = useState(false)

  const isRedeem = instructionType === "赎回"

  const [applyDate, setApplyDate] = useState("")
  const [amount, setAmount] = useState("")
  const [shares, setShares] = useState("")
  const [holdingShares, setHoldingShares] = useState<string | null>(null)
  const [summary, setSummary] = useState("")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [tempOpen, setTempOpen] = useState<string | null>(null)

  const amountChinese = amountToChineseUppercase(amount)
  const holdingSharesNum = parseNumberInput(holdingShares ?? "")
  const applySharesNum = parseNumberInput(shares)
  const sharesOverHolding =
    isRedeem
    && holdingSharesNum != null
    && applySharesNum != null
    && applySharesNum > holdingSharesNum + 1e-8

  const fileInputRef = useRef<HTMLInputElement>(null)
  const investorWrapRef = useRef<HTMLDivElement>(null)
  const fundWrapRef = useRef<HTMLDivElement>(null)
  const investorSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fundSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const recentRows = useMemo(() => {
    if (!fundSelected && !investorSelected) return [] as InstructionRecord[]
    return allRecords
      .filter((r) => {
        if (r.category !== "direct") return false
        if (investorSelected && r.fofFundName !== investorSelected.name) return false
        if (fundSelected) {
          const matchName =
            r.underlyingFundName === fundSelected.product_name
            || r.underlyingBeianHao === fundSelected.beian_hao
          if (!matchName) return false
        }
        return true
      })
      .slice(0, 20)
  }, [allRecords, fundSelected, investorSelected])

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

  useEffect(() => {
    if (!fundShow) return
    if (fundSearchRef.current) clearTimeout(fundSearchRef.current)
    fundSearchRef.current = setTimeout(() => {
      const q = fundInput.trim()
      setFundLoading(true)
      const params = new URLSearchParams({ page: "1" })
      if (q) params.set("keyword", q)
      fetch(`/ma/api/private-funds/list?${params}`)
        .then((r) => r.json())
        .then((d) => setFundOptions(parseFundOptions(d)))
        .catch(() => setFundOptions([]))
        .finally(() => setFundLoading(false))
    }, 150)
    return () => {
      if (fundSearchRef.current) clearTimeout(fundSearchRef.current)
    }
  }, [fundInput, fundShow])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!investorWrapRef.current?.contains(e.target as Node)) setInvestorShow(false)
      if (!fundWrapRef.current?.contains(e.target as Node)) setFundShow(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  useEffect(() => {
    if (!fundSelected) {
      setOpenDay(null)
      setTempOpen(null)
      setHoldingShares(null)
      return
    }
    setHoldingShares(null)
    const ac = new AbortController()
    const params = new URLSearchParams({
      beian_hao: fundSelected.beian_hao,
      product_name: fundSelected.product_name,
    })
    fetch(`/ma/api/ops/fund-elements?${params}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("not found")
        return r.json()
      })
      .then((d: { open_day?: string | null; is_temporary_open?: string | null }) => {
        if (ac.signal.aborted) return
        setOpenDay(d.open_day ?? null)
        setTempOpen(d.is_temporary_open ?? null)
      })
      .catch(() => {
        if (ac.signal.aborted) return
        setOpenDay(null)
        setTempOpen(null)
      })
    return () => ac.abort()
  }, [fundSelected?.beian_hao, fundSelected?.product_name])

  function resetForm() {
    setInvestorInput("")
    setInvestorSelected(null)
    setInvestorOptions([])
    setInvestorShow(false)
    setFundInput("")
    setFundSelected(null)
    setFundOptions([])
    setFundShow(false)
    setApplyDate("")
    setAmount("")
    setShares("")
    setHoldingShares(null)
    setSummary("")
    setAttachment(null)
    setDragOver(false)
    setOpenDay(null)
    setTempOpen(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function syncSharesFromAmount(nextAmount: string) {
    setAmount(nextAmount)
    if (!isRedeem) return
    const amt = parseNumberInput(nextAmount)
    const nav = parseNumberInput(fundSelected?.unit_nav ?? "")
    if (amt != null && nav != null && nav > 0) {
      setShares((amt / nav).toFixed(2))
    }
  }

  function syncAmountFromShares(nextShares: string) {
    setShares(nextShares)
    if (!isRedeem) return
    const shareNum = parseNumberInput(nextShares)
    const nav = parseNumberInput(fundSelected?.unit_nav ?? "")
    if (shareNum != null && nav != null && nav > 0) {
      setAmount((shareNum * nav).toFixed(2))
    }
  }

  async function handleSubmit() {
    if (!investorSelected) {
      toast({ title: "请选择投资者名称", variant: "destructive" })
      return
    }
    if (!fundSelected) {
      toast({ title: "请选择基金", variant: "destructive" })
      return
    }
    if (!applyDate) {
      toast({ title: "请选择交易申请日期", variant: "destructive" })
      return
    }
    if (isRedeem) {
      if (!shares.trim() && !amount.trim()) {
        toast({ title: "请输入申请份额或申请金额", variant: "destructive" })
        return
      }
    } else if (!amount.trim()) {
      toast({ title: "请输入申请金额", variant: "destructive" })
      return
    }

    setSubmitting(true)
    try {
      const record = await addInstructionRecord({
        category: "direct",
        type: instructionType,
        fofFundName: investorSelected.name,
        fofBeianHao: investorSelected.id,
        underlyingFundName: fundSelected.product_name,
        underlyingBeianHao: fundSelected.beian_hao,
        applyDate,
        amount: amount.trim(),
        shares: isRedeem ? (shares.trim() || null) : null,
        summary: summary.trim(),
        nav: fundSelected.unit_nav,
      })
      setSubmittedRecord(record)
      resetForm()
    } catch (e) {
      toast({
        title: "提交失败",
        description: e instanceof Error ? e.message : "请稍后重试",
        variant: "destructive",
      })
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
        <h2 className="text-base font-semibold text-foreground">{pageTitle}</h2>
      </div>

      <section className="rounded-md border border-zinc-200 bg-background px-5 py-5 dark:border-zinc-800">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-start">
            <div className="flex items-start gap-3">
              <FormLabel required className="pt-2">投资者名称:</FormLabel>
              <div ref={investorWrapRef} className="relative min-w-0 flex-1">
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
                      autoFocus={investorShow}
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
            <div className="flex items-center gap-3 pt-2 lg:pt-2">
              <FormLabel className="pt-0">指令类型:</FormLabel>
              <span className="text-sm font-medium text-red-500">{instructionType}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-start">
            <div className="flex items-start gap-3">
              <FormLabel required className="pt-2">选择基金:</FormLabel>
              <div ref={fundWrapRef} className="relative min-w-0 flex-1">
                <div
                  className={[
                    "flex items-center overflow-visible rounded border bg-background",
                    fundShow ? "border-red-400 ring-1 ring-red-400/60" : "border-border",
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
                    {fundSelected && !fundShow ? (
                      <button
                        type="button"
                        onClick={() => {
                          setFundInput("")
                          setFundShow(true)
                        }}
                        className="flex h-9 min-w-0 flex-1 items-center justify-between text-left"
                      >
                        <span className="truncate text-sm">{fundSelected.display_name}</span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-zinc-400" />
                      </button>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={fundInput}
                          onChange={(e) => {
                            setFundInput(e.target.value)
                            setFundShow(true)
                          }}
                          onFocus={() => setFundShow(true)}
                          placeholder="输入名称/备案号/代码选择"
                          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                        />
                        {fundLoading ? (
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
                {fundShow && (
                  <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-md border bg-background shadow-lg">
                    {fundLoading && fundOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-zinc-400">加载中…</div>
                    ) : fundOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-zinc-400">暂无基金</div>
                    ) : (
                      fundOptions.map((opt) => (
                        <button
                          key={opt.beian_hao}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setFundSelected(opt)
                            setFundInput("")
                            setFundShow(false)
                            setApplyDate((prev) => prev || todayDateString())
                          }}
                          className={[
                            "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted",
                            fundSelected?.beian_hao === opt.beian_hao ? "bg-muted" : "",
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
            </div>
            <div className="flex items-center gap-3 pt-2">
              <FormLabel className="pt-0">开放日:</FormLabel>
              <span className="text-sm text-zinc-500">
                {fundSelected ? (openDay?.trim() || "-") : "-"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-start">
            <div className="flex items-center gap-3">
              <FormLabel required>交易申请日期:</FormLabel>
              <div className="min-w-0 flex-1">
                <DateInput value={applyDate} onChange={setApplyDate} placeholder="请选择日期" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <FormLabel className="pt-0">是否临开:</FormLabel>
              <span className="text-sm text-zinc-500">
                {fundSelected
                  ? (formatTemporaryOpen(tempOpen) === "—" ? "-" : formatTemporaryOpen(tempOpen))
                  : "-"}
              </span>
            </div>
          </div>

          {isRedeem ? (
            <>
              <div className="grid grid-cols-1 gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-start">
                <div className="flex items-start gap-3">
                  <FormLabel required className="pt-2">申请金额:</FormLabel>
                  <div className="min-w-0 flex-1">
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => syncSharesFromAmount(e.target.value)}
                        onBlur={() => {
                          const n = Number(String(amount).replace(/,/g, "").trim())
                          if (Number.isFinite(n) && n >= 0 && amount.trim()) {
                            syncSharesFromAmount(n.toFixed(2))
                          }
                        }}
                        placeholder="请输入申请金额"
                        className="h-9 w-full rounded border border-border bg-background px-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                        元
                      </span>
                    </div>
                    {amountChinese ? (
                      <div className="mt-1 text-xs text-orange-500">{amountChinese}</div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <FormLabel className="pt-0">持有份额:</FormLabel>
                  <span className="text-sm text-zinc-500">
                    {holdingShares != null && holdingShares !== ""
                      ? `${Number(holdingShares).toLocaleString("zh-CN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 4,
                        })} 份`
                      : "-"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-start">
                <div className="flex items-start gap-3">
                  <FormLabel className="pt-2">申请份额:</FormLabel>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="relative min-w-0 flex-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={shares}
                          onChange={(e) => syncAmountFromShares(e.target.value)}
                          placeholder="请输入申请份额"
                          className={[
                            "h-9 w-full rounded border bg-background px-3 pr-8 text-sm focus:outline-none focus:ring-1 placeholder:text-muted-foreground/50",
                            sharesOverHolding
                              ? "border-red-400 focus:ring-red-400/60"
                              : "border-border focus:ring-ring",
                          ].join(" ")}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                          份
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!holdingShares) {
                            toast({ title: "暂无持有份额数据", variant: "destructive" })
                            return
                          }
                          syncAmountFromShares(String(holdingShares))
                        }}
                        className="shrink-0 text-sm text-blue-500 hover:text-blue-600 hover:underline"
                      >
                        全部赎回
                      </button>
                    </div>
                    {sharesOverHolding ? (
                      <div className="mt-1 text-xs text-red-500">请注意赎回份额大于持有份额</div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <FormLabel className="pt-0">单位净值:</FormLabel>
                  <span className="text-sm text-zinc-500">
                    {fundSelected && fundSelected.unit_nav
                      ? formatNav(fundSelected.unit_nav, fundSelected.nav_date)
                      : "-"}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-start">
                <div className="flex items-start gap-3">
                  <FormLabel required className="pt-2">申请金额:</FormLabel>
                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      onBlur={() => {
                        const n = Number(String(amount).replace(/,/g, "").trim())
                        if (Number.isFinite(n) && n >= 0 && amount.trim()) {
                          setAmount(n.toFixed(2))
                        }
                      }}
                      placeholder="请输入申请金额"
                      className="h-9 w-full rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    />
                    {amountChinese ? (
                      <div className="mt-1 text-xs text-orange-500">{amountChinese}</div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <FormLabel className="pt-0">持仓金额:</FormLabel>
                  <span className="text-sm text-zinc-500">-</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
                <div className="flex items-center gap-3">
                  <FormLabel>单位净值:</FormLabel>
                  <span className="text-sm text-zinc-500">
                    {fundSelected && fundSelected.unit_nav
                      ? formatNav(fundSelected.unit_nav, fundSelected.nav_date)
                      : "-"}
                  </span>
                </div>
              </div>
            </>
          )}

          <div className="flex items-start gap-3">
            <FormLabel className="pt-2">指令摘要:</FormLabel>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="请输入指令摘要"
              className="h-9 min-w-0 flex-1 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
            />
          </div>

          <div className="flex items-start gap-3">
            <FormLabel className="pt-2">附件:</FormLabel>
            <div className="min-w-0 flex-1">
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
                  "flex h-28 w-full flex-col items-center justify-center gap-2 rounded border border-dashed text-sm transition-colors",
                  dragOver
                    ? "border-red-400 bg-red-50/60 dark:bg-red-950/20"
                    : "border-zinc-300 bg-zinc-50/60 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/30 dark:hover:bg-zinc-900/40",
                ].join(" ")}
              >
                <CloudUpload className="h-5 w-5 text-zinc-400" />
                {attachment ? (
                  <span className="max-w-[90%] truncate px-3 text-zinc-700 dark:text-zinc-200">
                    {attachment.name}
                  </span>
                ) : (
                  <span className="text-zinc-400">点击或拖拽上传</span>
                )}
              </button>
            </div>
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
