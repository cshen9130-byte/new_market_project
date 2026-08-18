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
  updateInstructionRecord,
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

function shortFundDisplayName(productName: string): string {
  const trimmed = productName.trim()
  const short = trimmed
    .replace(/私募证券投资基金/g, "")
    .replace(/证券投资基金/g, "")
    .replace(/私募基金/g, "")
    .trim()
  return short || trimmed
}

function parseUnderlyingHoldingOptions(json: unknown): UnderlyingOption[] {
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
    nav_date?: string | null
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
      is_holding: true,
      market_value: row.market_value ?? null,
      investment_shares: row.investment_shares ?? null,
      unit_nav: row.unit_nav ?? null,
      nav_date: row.nav_date ?? null,
    })
  }
  return out
}

/** All private funds from the platform catalog (not limited to current FOF holdings). */
function parsePrivateFundOptions(json: unknown): UnderlyingOption[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: UnderlyingOption[] = []
  const seen = new Set<string>()
  for (const row of data as {
    product_name?: string
    short_name?: string | null
    beian_hao?: string | null
    latest_nav?: string | null
    latest_nav_date?: string | null
  }[]) {
    if (!row.product_name || !row.beian_hao) continue
    const key = `${row.beian_hao}::${row.product_name}`
    if (seen.has(key)) continue
    seen.add(key)
    const short = (row.short_name || "").trim() || shortFundDisplayName(row.product_name)
    out.push({
      product_name: row.product_name,
      short_name: short,
      beian_hao: row.beian_hao,
      is_holding: false,
      market_value: null,
      investment_shares: null,
      unit_nav: row.latest_nav ?? null,
      nav_date: row.latest_nav_date ?? null,
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
      // Prefer holding rows so 持仓 badge / shares / market value stay accurate.
      if (opt.is_holding && !prev.is_holding) map.set(key, opt)
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.is_holding !== b.is_holding) return a.is_holding ? -1 : 1
    return (a.short_name || a.product_name).localeCompare(
      b.short_name || b.product_name,
      "zh-CN",
    )
  })
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
    ? n.toLocaleString("zh-CN", {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      })
    : value
  if (date) return `${navText} (${date})`
  return navText
}

/** Convert RMB amount to Chinese uppercase, e.g. 10000000 -> 壹仟万元整 */
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

function parseNumberInput(value: string): number | null {
  const n = Number(String(value).replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : null
}

function formatValuationDate(value: string | null | undefined): string {
  if (!value) return "--"
  return value
}

/** Map fund-elements temporary-open text to 是/否 for the instruction form. */
function formatTemporaryOpen(value: string | null | undefined): string {
  if (!value) return "—"
  if (value === "0" || value === "否") return "否"
  if (value === "1" || value === "是") return "是"
  if (value.includes("不可")) return "否"
  if (value.includes("可")) return "是"
  return value
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
        "text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-[7.5rem] text-right leading-snug",
        className,
      ].join(" ")}
    >
      {required && <span className="text-red-500 mr-0.5">*</span>}
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
    <div className="flex items-start gap-2 text-sm min-w-0">
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

export type UnderlyingTradeType = "认购" | "申购" | "赎回"

const TRADE_TYPE_TITLE: Record<UnderlyingTradeType, string> = {
  认购: "底层认购",
  申购: "底层申购",
  赎回: "底层赎回",
}

function initialFofFromRecord(record: InstructionRecord | undefined): FundOption | null {
  if (!record?.fofFundName) return null
  return {
    beian_hao: record.fofBeianHao || record.fofFundName,
    product_name: record.fofFundName,
    custody_balance: null,
    valuation_date: null,
  }
}

function initialUnderlyingFromRecord(
  record: InstructionRecord | undefined,
): UnderlyingOption | null {
  if (!record?.underlyingFundName) return null
  return {
    beian_hao: record.underlyingBeianHao || record.underlyingFundName,
    product_name: record.underlyingFundName,
    short_name: record.underlyingFundName,
    is_holding: true,
    market_value: null,
    investment_shares: null,
    unit_nav: null,
    nav_date: null,
  }
}

function stripAmountCommas(value: string): string {
  return String(value).replace(/,/g, "").trim()
}

export function UnderlyingSubscribeForm({
  onBack,
  onSubmitted,
  instructionType = "认购",
  initialRecord,
}: {
  onBack: () => void
  onSubmitted?: (record: InstructionRecord) => void
  instructionType?: UnderlyingTradeType
  /** When set, form opens in edit mode and submit updates this record. */
  initialRecord?: InstructionRecord
}) {
  const { toast } = useToast()
  const pageTitle = TRADE_TYPE_TITLE[instructionType]
  const editingId = initialRecord?.id ?? null

  const allRecords = useSyncExternalStore(
    subscribeInstructionRecords,
    getInstructionRecordsSnapshot,
    getInstructionRecordsServerSnapshot,
  )

  const [submittedRecord, setSubmittedRecord] = useState<InstructionRecord | null>(null)
  const [fofFundInput, setFofFundInput] = useState("")
  const [fofFundSelected, setFofFundSelected] = useState<FundOption | null>(() =>
    initialFofFromRecord(initialRecord),
  )
  const [fofFundOptions, setFofFundOptions] = useState<FundOption[]>([])
  const [fofFundShowDropdown, setFofFundShowDropdown] = useState(false)
  const [fofFundLoading, setFofFundLoading] = useState(false)

  const [fundType, setFundType] = useState("private")
  const [underlyingInput, setUnderlyingInput] = useState("")
  const [underlyingSelected, setUnderlyingSelected] = useState<UnderlyingOption | null>(() =>
    initialUnderlyingFromRecord(initialRecord),
  )
  const [underlyingOptions, setUnderlyingOptions] = useState<UnderlyingOption[]>([])
  const [underlyingShowDropdown, setUnderlyingShowDropdown] = useState(false)
  const [underlyingLoading, setUnderlyingLoading] = useState(false)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [temporaryOpen, setTemporaryOpen] = useState<string | null>(null)
  const [elementsLoading, setElementsLoading] = useState(false)

  const isRedeem = instructionType === "赎回"
  const isPurchase = instructionType === "申购"
  // Prefer amount/shares over is_holding flag (list API marks all rows as holdings).
  const hasHolding = (() => {
    if (!underlyingSelected) return false
    const mv = Number(String(underlyingSelected.market_value ?? "").replace(/,/g, "").trim())
    if (Number.isFinite(mv) && mv > 0) return true
    const sh = Number(String(underlyingSelected.investment_shares ?? "").replace(/,/g, "").trim())
    return Number.isFinite(sh) && sh > 0
  })()
  /** 申购 is refined to 初次申购 / 追加申购 from current position. */
  const displayInstructionType = isPurchase
    ? hasHolding
      ? "追加申购"
      : "初次申购"
    : instructionType

  const [applyDate, setApplyDate] = useState(() => initialRecord?.applyDate ?? "")
  const [amount, setAmount] = useState(() =>
    initialRecord ? stripAmountCommas(initialRecord.amount) : "",
  )
  const [shares, setShares] = useState(() => initialRecord?.shares ?? "")
  const [summary, setSummary] = useState(() => initialRecord?.summary ?? "")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const skipFofClearRef = useRef(true)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const fofWrapRef = useRef<HTMLDivElement>(null)
  const underlyingWrapRef = useRef<HTMLDivElement>(null)
  const fofSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const underlyingSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const placeholderHint = "请选择底层基金"
  const holdingAmountDisplay = underlyingSelected
    ? formatBalance(underlyingSelected.market_value)
    : placeholderHint
  const holdingSharesDisplay = underlyingSelected
    ? formatBalance(underlyingSelected.investment_shares, "份", 4)
    : placeholderHint
  const latestNavDisplay = underlyingSelected
    ? formatNav(underlyingSelected.unit_nav, underlyingSelected.nav_date)
    : placeholderHint
  const amountChinese = amountToChineseUppercase(amount)
  const holdingSharesNum = parseNumberInput(underlyingSelected?.investment_shares ?? "")
  const applySharesNum = parseNumberInput(shares)
  const sharesOverHolding =
    isRedeem
    && holdingSharesNum != null
    && applySharesNum != null
    && applySharesNum > holdingSharesNum + 1e-8
  const openDayDisplay = !underlyingSelected
    ? placeholderHint
    : elementsLoading
      ? "加载中…"
      : openDay?.trim() || "—"
  const temporaryOpenDisplay = !underlyingSelected
    ? placeholderHint
    : elementsLoading
      ? "加载中…"
      : formatTemporaryOpen(temporaryOpen)

  const recentRows = useMemo(() => {
    if (!underlyingSelected) return [] as InstructionRecord[]
    const undName = (underlyingSelected.short_name || underlyingSelected.product_name).trim()
    const undBeian = underlyingSelected.beian_hao.trim()
    return allRecords
      .filter((r) => {
        if (editingId && r.id === editingId) return false
        if (r.category !== "underlying") return false
        const nameMatch =
          r.underlyingFundName === undName
          || r.underlyingFundName === underlyingSelected.product_name
          || (undBeian && r.underlyingBeianHao === undBeian)
        if (!nameMatch) return false
        if (fofFundSelected) {
          return (
            r.fofFundName === fofFundSelected.product_name
            || r.fofBeianHao === fofFundSelected.beian_hao
          )
        }
        return true
      })
      .slice(0, 20)
  }, [allRecords, underlyingSelected, fofFundSelected, editingId])

  useEffect(() => {
    if (!fofFundShowDropdown) return
    if (fofSearchRef.current) clearTimeout(fofSearchRef.current)
    fofSearchRef.current = setTimeout(() => {
      const q = fofFundInput.trim()
      setFofFundLoading(true)
      fetch(
        `/ma/api/ops/managed-products/list?pageSize=50${q ? `&keyword=${encodeURIComponent(q)}` : ""}`,
      )
        .then((r) => r.json())
        .then((d) => setFofFundOptions(parseManagedFundOptions(d)))
        .catch(() => setFofFundOptions([]))
        .finally(() => setFofFundLoading(false))
    }, 150)
    return () => {
      if (fofSearchRef.current) clearTimeout(fofSearchRef.current)
    }
  }, [fofFundInput, fofFundShowDropdown])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!fofWrapRef.current?.contains(e.target as Node)) {
        setFofFundShowDropdown(false)
      }
      if (!underlyingWrapRef.current?.contains(e.target as Node)) {
        setUnderlyingShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  useEffect(() => {
    if (!underlyingShowDropdown) return
    if (!fofFundSelected) {
      setUnderlyingOptions([])
      return
    }
    if (underlyingSearchRef.current) clearTimeout(underlyingSearchRef.current)
    underlyingSearchRef.current = setTimeout(() => {
      const q = underlyingInput.trim()
      setUnderlyingLoading(true)

      const holdingParams = new URLSearchParams({
        page: "1",
        pageSize: "50",
        fof_fund_name: fofFundSelected.product_name,
      })
      if (q) holdingParams.set("keyword", q)

      const holdingsPromise = fetch(
        `/ma/api/investment/fof-underlying-detail/list?${holdingParams}`,
      )
        .then((r) => r.json())
        .then((d) => parseUnderlyingHoldingOptions(d))
        .catch(() => [] as UnderlyingOption[])

      // Redeem: only funds currently held. Subscribe/purchase: any platform fund.
      if (isRedeem) {
        holdingsPromise
          .then((opts) => setUnderlyingOptions(opts))
          .finally(() => setUnderlyingLoading(false))
        return
      }

      const allParams = new URLSearchParams({ page: "1", pageSize: "50" })
      if (q) allParams.set("keyword", q)
      const allPromise = fetch(`/ma/api/private-funds/list?${allParams}`)
        .then((r) => r.json())
        .then((d) => parsePrivateFundOptions(d))
        .catch(() => [] as UnderlyingOption[])

      Promise.all([holdingsPromise, allPromise])
        .then(([holding, all]) =>
          setUnderlyingOptions(mergeUnderlyingOptions(holding, all)),
        )
        .finally(() => setUnderlyingLoading(false))
    }, 150)
    return () => {
      if (underlyingSearchRef.current) clearTimeout(underlyingSearchRef.current)
    }
  }, [underlyingInput, underlyingShowDropdown, fofFundSelected, isRedeem])

  // Clear underlying selection when FOF changes (skip initial mount / edit prefill)
  useEffect(() => {
    if (skipFofClearRef.current) {
      skipFofClearRef.current = false
      return
    }
    setUnderlyingSelected(null)
    setUnderlyingInput("")
    setUnderlyingOptions([])
    setUnderlyingShowDropdown(false)
    setOpenDay(null)
    setTemporaryOpen(null)
  }, [fofFundSelected?.beian_hao, fofFundSelected?.product_name])

  // Enrich FOF custody balance when editing a saved instruction
  useEffect(() => {
    if (!initialRecord?.fofFundName) return
    const ac = new AbortController()
    const q = encodeURIComponent(initialRecord.fofFundName)
    fetch(`/ma/api/ops/managed-products/list?pageSize=50&keyword=${q}`, {
      signal: ac.signal,
    })
      .then((r) => r.json())
      .then((d) => {
        if (ac.signal.aborted) return
        const opts = parseManagedFundOptions(d)
        const match =
          opts.find((o) => o.beian_hao === initialRecord.fofBeianHao)
          || opts.find((o) => o.product_name === initialRecord.fofFundName)
        if (!match) return
        setFofFundSelected((prev) => {
          if (!prev) return match
          // Keep identity keys stable so FOF-change clear effect does not wipe underlying.
          if (
            prev.product_name === match.product_name
            || prev.beian_hao === match.beian_hao
          ) {
            return {
              ...prev,
              custody_balance: match.custody_balance,
              valuation_date: match.valuation_date,
            }
          }
          return prev
        })
      })
      .catch(() => {})
    return () => ac.abort()
  }, [initialRecord?.id, initialRecord?.fofFundName, initialRecord?.fofBeianHao])

  // Enrich underlying holding metrics when editing
  useEffect(() => {
    if (!initialRecord?.fofFundName || !initialRecord.underlyingFundName) return
    const ac = new AbortController()
    const params = new URLSearchParams({
      page: "1",
      pageSize: "50",
      fof_fund_name: initialRecord.fofFundName,
      keyword: initialRecord.underlyingFundName,
    })
    fetch(`/ma/api/investment/fof-underlying-detail/list?${params}`, {
      signal: ac.signal,
    })
      .then((r) => r.json())
      .then((d) => {
        if (ac.signal.aborted) return
        const opts = parseUnderlyingHoldingOptions(d)
        const match =
          opts.find((o) => o.beian_hao === initialRecord.underlyingBeianHao)
          || opts.find(
            (o) =>
              o.product_name === initialRecord.underlyingFundName
              || o.short_name === initialRecord.underlyingFundName,
          )
        if (!match) return
        setUnderlyingSelected((prev) => {
          if (!prev) return match
          if (
            prev.product_name === match.product_name
            || prev.beian_hao === match.beian_hao
            || prev.short_name === match.short_name
          ) {
            return match
          }
          return prev
        })
      })
      .catch(() => {})
    return () => ac.abort()
  }, [
    initialRecord?.id,
    initialRecord?.fofFundName,
    initialRecord?.underlyingFundName,
    initialRecord?.underlyingBeianHao,
  ])

  useEffect(() => {
    if (!underlyingSelected) {
      setOpenDay(null)
      setTemporaryOpen(null)
      setElementsLoading(false)
      return
    }
    const ac = new AbortController()
    setElementsLoading(true)
    setOpenDay(null)
    setTemporaryOpen(null)
    const params = new URLSearchParams({
      beian_hao: underlyingSelected.beian_hao,
      product_name: underlyingSelected.product_name,
    })
    fetch(`/ma/api/ops/fund-elements?${params}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("elements not found")
        return r.json()
      })
      .then((d: { open_day?: string | null; is_temporary_open?: string | null }) => {
        if (ac.signal.aborted) return
        setOpenDay(d.open_day ?? null)
        setTemporaryOpen(d.is_temporary_open ?? null)
      })
      .catch(() => {
        if (ac.signal.aborted) return
        setOpenDay(null)
        setTemporaryOpen(null)
      })
      .finally(() => {
        if (!ac.signal.aborted) setElementsLoading(false)
      })
    return () => ac.abort()
  }, [underlyingSelected?.beian_hao, underlyingSelected?.product_name])

  function resetForm() {
    setFofFundInput("")
    setFofFundSelected(null)
    setFofFundOptions([])
    setFofFundShowDropdown(false)
    setFofFundLoading(false)
    setFundType("private")
    setUnderlyingInput("")
    setUnderlyingSelected(null)
    setUnderlyingOptions([])
    setUnderlyingShowDropdown(false)
    setOpenDay(null)
    setTemporaryOpen(null)
    setElementsLoading(false)
    setApplyDate("")
    setAmount("")
    setShares("")
    setSummary("")
    setAttachment(null)
    setDragOver(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleFile(file: File | null) {
    if (!file) return
    setAttachment(file)
  }

  async function handleSubmit() {
    if (!fofFundSelected) {
      toast({ title: "请选择FOF基金", variant: "destructive" })
      return
    }
    if (!underlyingSelected) {
      toast({ title: "请选择底层基金", variant: "destructive" })
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
      const payload = {
        category: "underlying" as const,
        type: displayInstructionType,
        fofFundName: fofFundSelected.product_name,
        fofBeianHao: fofFundSelected.beian_hao,
        underlyingFundName:
          underlyingSelected.short_name || underlyingSelected.product_name,
        underlyingBeianHao: underlyingSelected.beian_hao,
        applyDate,
        amount: amount.trim() || "0",
        shares: shares.trim() || null,
        summary: summary.trim(),
        ...(editingId && initialRecord?.progress
          ? { progress: initialRecord.progress }
          : {}),
      }
      const record = editingId
        ? await updateInstructionRecord(editingId, payload)
        : await addInstructionRecord(payload)
      if (!record) {
        toast({ title: "提交失败", description: "指令不存在或已作废", variant: "destructive" })
        return
      }
      setSubmittedRecord(record)
      onSubmitted?.(record)
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
      <div className="relative flex items-center justify-center border-b border-zinc-200 dark:border-zinc-800 pb-3">
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

      <div className="flex flex-wrap items-center gap-3">
        <FormLabel required className="pt-0 w-auto">
          选择FOF基金:
        </FormLabel>
        <div ref={fofWrapRef} className="relative w-full max-w-md min-w-[240px]">
          {fofFundSelected && !fofFundShowDropdown ? (
            <button
              type="button"
              onClick={() => {
                setFofFundInput("")
                setFofFundShowDropdown(true)
              }}
              className="flex h-9 w-full items-center justify-between rounded border border-border bg-background px-3 text-left"
            >
              <span className="truncate text-sm">{fofFundSelected.product_name}</span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-zinc-400" />
            </button>
          ) : (
            <>
              <div className="relative">
                <input
                  type="text"
                  value={fofFundInput}
                  onChange={(e) => {
                    setFofFundInput(e.target.value)
                    setFofFundShowDropdown(true)
                  }}
                  onFocus={() => setFofFundShowDropdown(true)}
                  onClick={() => setFofFundShowDropdown(true)}
                  placeholder="请输入并选择FOF基金"
                  className="h-9 w-full rounded border border-border bg-background px-3 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-red-400/60 focus:border-red-400 placeholder:text-muted-foreground/50"
                  autoFocus={Boolean(fofFundSelected && fofFundShowDropdown)}
                />
                <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              </div>
            </>
          )}
          {fofFundShowDropdown && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border bg-background shadow-lg">
              {fofFundLoading && fofFundOptions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-zinc-400">加载中…</div>
              ) : fofFundOptions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-zinc-400">暂无在管产品</div>
              ) : (
                fofFundOptions.map((opt) => (
                  <button
                    key={`${opt.beian_hao}-${opt.product_name}`}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setFofFundSelected(opt)
                      setFofFundInput("")
                      setFofFundShowDropdown(false)
                    }}
                    className={[
                      "w-full truncate px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                      fofFundSelected?.beian_hao === opt.beian_hao &&
                      fofFundSelected.product_name === opt.product_name
                        ? "bg-muted"
                        : "",
                    ].join(" ")}
                  >
                    {opt.product_name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <section className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-background px-5 py-4">
        <SectionTitle>FOF基金</SectionTitle>
        {fofFundSelected ? (
          <div className="space-y-2.5 text-sm">
            <div className="font-medium text-zinc-800 dark:text-zinc-100">
              {fofFundSelected.product_name}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-1">
              <span className="text-zinc-500 dark:text-zinc-400">托管户现金余额:</span>
              <span className="font-medium text-red-500">
                {formatBalance(fofFundSelected.custody_balance)}
              </span>
              <span className="text-zinc-400">
                (最新估值表日期: {formatValuationDate(fofFundSelected.valuation_date)})
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-1">
              <span className="text-zinc-500 dark:text-zinc-400">托管户预估余额:</span>
              <span className="font-medium text-red-500">
                {formatBalance(fofFundSelected.custody_balance)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-zinc-500 dark:text-zinc-400">指令类型:</span>
              <span className="font-medium text-red-500">{displayInstructionType}</span>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5 text-sm text-zinc-400">
            <div>请选择FOF基金</div>
            <div>托管户现金余额: —</div>
            <div>托管户预估余额: —</div>
            <div className="flex items-center gap-1">
              <span>指令类型:</span>
              <span className="font-medium text-red-500">{displayInstructionType}</span>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-background px-5 py-4">
        <SectionTitle>底层基金</SectionTitle>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-start gap-3 min-w-0">
              <FormLabel required className="pt-2">
                选择基金:
              </FormLabel>
              <div ref={underlyingWrapRef} className="relative flex-1 min-w-0 max-w-md">
                <div
                  className={[
                    "flex items-center overflow-visible rounded border",
                    underlyingShowDropdown
                      ? "border-red-400 ring-1 ring-red-400/60"
                      : "border-border",
                  ].join(" ")}
                >
                  <div className="relative shrink-0">
                    <select
                      value={fundType}
                      onChange={(e) => setFundType(e.target.value)}
                      className="h-9 appearance-none border-r border-border bg-muted/40 pl-3 pr-7 text-sm text-zinc-700 dark:text-zinc-300 focus:outline-none cursor-pointer"
                    >
                      <option value="private">私募基金</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  </div>
                  <div className="relative flex min-w-0 flex-1 items-center gap-2 px-3">
                    {underlyingSelected && !underlyingShowDropdown ? (
                      <button
                        type="button"
                        onClick={() => {
                          setUnderlyingInput("")
                          setUnderlyingShowDropdown(true)
                        }}
                        className="flex h-9 min-w-0 flex-1 items-center justify-between text-left"
                      >
                        <span className="truncate text-sm">
                          {underlyingSelected.short_name || underlyingSelected.product_name}
                        </span>
                        <Search className="ml-2 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      </button>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={underlyingInput}
                          onChange={(e) => {
                            setUnderlyingInput(e.target.value)
                            setUnderlyingShowDropdown(true)
                          }}
                          onFocus={() => setUnderlyingShowDropdown(true)}
                          onClick={() => setUnderlyingShowDropdown(true)}
                          placeholder="请输入关键字搜索底层基金"
                          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                          autoFocus={Boolean(underlyingSelected && underlyingShowDropdown)}
                        />
                        {underlyingLoading ? (
                          <svg
                            className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <circle
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="3"
                              strokeDasharray="32"
                              strokeLinecap="round"
                            />
                          </svg>
                        ) : (
                          <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                        )}
                      </>
                    )}
                  </div>
                </div>
                {underlyingShowDropdown && (
                  <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-md border bg-background shadow-lg">
                    {!fofFundSelected ? (
                      <div className="px-3 py-2 text-sm text-zinc-400">请先选择FOF基金</div>
                    ) : underlyingLoading && underlyingOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-zinc-400">加载中…</div>
                    ) : underlyingOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-zinc-400">
                        {isRedeem ? "暂无持仓底层基金" : "暂无匹配基金"}
                      </div>
                    ) : (
                      underlyingOptions.map((opt) => (
                        <button
                          key={`${opt.beian_hao}-${opt.product_name}`}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setUnderlyingSelected(opt)
                            setUnderlyingInput("")
                            setUnderlyingShowDropdown(false)
                          }}
                          className={[
                            "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                            underlyingSelected?.beian_hao === opt.beian_hao &&
                            underlyingSelected.product_name === opt.product_name
                              ? "bg-muted"
                              : "",
                          ].join(" ")}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {opt.short_name || opt.product_name}
                          </span>
                          {opt.is_holding && (
                            <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[11px] leading-none text-red-500 dark:bg-red-950/40 dark:text-red-400">
                              持仓
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
            <InfoRow
              label="开放日"
              value={openDayDisplay}
              placeholder={!underlyingSelected || (elementsLoading && !openDay)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <div className="flex items-center gap-3 min-w-0">
              <FormLabel required>交易申请日期:</FormLabel>
              <div className="flex-1 max-w-md min-w-0">
                <DateInput
                  value={applyDate}
                  onChange={setApplyDate}
                  placeholder="请选择日期"
                />
              </div>
            </div>
            <InfoRow
              label="是否临开"
              value={temporaryOpenDisplay}
              placeholder={!underlyingSelected || elementsLoading}
            />
          </div>

          {isRedeem ? (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
                <div className="flex items-start gap-3 min-w-0">
                  <FormLabel required className="pt-2">申请金额:</FormLabel>
                  <div className="min-w-0 max-w-md flex-1">
                    <div className="flex items-center gap-2">
                      <div className="relative min-w-0 flex-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={amount}
                          onChange={(e) => {
                            const next = e.target.value
                            setAmount(next)
                            const amt = parseNumberInput(next)
                            const nav = parseNumberInput(underlyingSelected?.unit_nav ?? "")
                            if (amt != null && nav != null && nav > 0) {
                              setShares((amt / nav).toFixed(2))
                            }
                          }}
                          placeholder="请输入申请金额"
                          className="h-9 w-full rounded border border-border bg-background px-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                          元
                        </span>
                      </div>
                      <button
                        type="button"
                        title="清空金额"
                        onClick={() => {
                          setAmount("")
                          setShares("")
                        }}
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border text-sm text-zinc-500 hover:bg-muted"
                      >
                        结
                      </button>
                    </div>
                    {amountChinese ? (
                      <div className="mt-1 text-xs text-zinc-400">{amountChinese}</div>
                    ) : null}
                  </div>
                </div>
                <div className="pt-2">
                  <InfoRow
                    label="持仓份额"
                    value={holdingSharesDisplay}
                    accent={Boolean(underlyingSelected)}
                    placeholder={!underlyingSelected}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
                <div className="flex items-start gap-3 min-w-0">
                  <FormLabel required className="pt-2">申请份额:</FormLabel>
                  <div className="min-w-0 max-w-md flex-1">
                    <div className="flex items-center gap-2">
                      <div className="relative min-w-0 flex-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={shares}
                          onChange={(e) => {
                            const next = e.target.value
                            setShares(next)
                            const shareNum = parseNumberInput(next)
                            const nav = parseNumberInput(underlyingSelected?.unit_nav ?? "")
                            if (shareNum != null && nav != null && nav > 0) {
                              setAmount((shareNum * nav).toFixed(2))
                            }
                          }}
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
                          if (!underlyingSelected?.investment_shares) {
                            toast({ title: "请先选择底层基金", variant: "destructive" })
                            return
                          }
                          const holding = String(underlyingSelected.investment_shares)
                          setShares(holding)
                          const shareNum = parseNumberInput(holding)
                          const nav = parseNumberInput(underlyingSelected.unit_nav ?? "")
                          if (shareNum != null && nav != null && nav > 0) {
                            setAmount((shareNum * nav).toFixed(2))
                          }
                        }}
                        className="shrink-0 text-sm text-blue-500 hover:text-blue-600 hover:underline"
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
                    value={latestNavDisplay}
                    accent={Boolean(underlyingSelected)}
                    placeholder={!underlyingSelected}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start">
              <div className="flex items-start gap-3 min-w-0">
                <FormLabel required className="pt-2">申请金额:</FormLabel>
                <div className="min-w-0 max-w-md flex-1">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="请输入申请金额"
                    className="h-9 w-full rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                  />
                  {amountChinese ? (
                    <div className="mt-1 text-xs text-zinc-400">{amountChinese}</div>
                  ) : null}
                </div>
              </div>
              <div className="pt-2">
                <InfoRow
                  label="持仓金额"
                  value={holdingAmountDisplay}
                  accent={Boolean(underlyingSelected)}
                  placeholder={!underlyingSelected}
                />
              </div>
            </div>
          )}

          <div className="flex items-start gap-3">
            <FormLabel className="pt-2">指令摘要:</FormLabel>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="请输入指令摘要"
              rows={3}
              className="w-full max-w-2xl resize-y rounded border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
            />
          </div>

          <div className="flex items-start gap-3">
            <FormLabel className="pt-2">附件:</FormLabel>
            <div className="w-full max-w-md">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
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
                  handleFile(e.dataTransfer.files?.[0] ?? null)
                }}
                className={[
                  "flex h-24 w-full flex-col items-center justify-center gap-2 rounded border border-dashed text-sm transition-colors",
                  dragOver
                    ? "border-red-400 bg-red-50/60 dark:bg-red-950/20"
                    : "border-zinc-300 bg-zinc-50/80 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/70",
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

      <section className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-background px-5 py-4">
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
              {!underlyingSelected || recentRows.length === 0 ? (
                <tr>
                  <td colSpan={RECENT_COLUMNS.length} className="py-14">
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />
                      <span className="text-sm">
                        {!underlyingSelected ? "请选择底层基金查看最近指令" : "暂无数据"}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                recentRows.map((row, i) => (
                  <tr
                    key={row.id}
                    className="border-t border-zinc-100 hover:bg-muted/30 dark:border-zinc-800"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 text-center text-zinc-700 dark:text-zinc-200">
                      {i + 1}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      {row.id}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      {row.applyDate}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="inline-flex rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
                        {row.type}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      {row.underlyingFundName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      {row.amount}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      {row.shares ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      {row.nav ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {row.progress}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-center">
                      <button
                        type="button"
                        className="inline-flex rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                        title="查看"
                      >
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
          className="h-9 min-w-[88px] rounded border border-zinc-300 bg-background px-5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
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
