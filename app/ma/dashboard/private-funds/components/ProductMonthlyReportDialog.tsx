"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ArrowLeft, CalendarDays, Download, Loader2, Plus, Search, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { VOLATILITY_SECTIONS, type VolatilitySection } from "@/lib/client/product-monthly-report"

type ProductSource = "managed" | "private" | "custom_fund"

type ProductOption = {
  product_name: string
  beian_hao: string | null
  source: ProductSource
}

type FundSlot = {
  id: string
  product_name: string
  beian_hao: string | null
}

const SOURCE_LABELS: Record<ProductSource, string> = {
  managed: "在管产品",
  private: "私募基金",
  custom_fund: "自建基金",
}

function userFetchHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    const id = u?.id ?? ""
    return id ? { "x-market-user-id": id } : {}
  } catch {
    return {}
  }
}

async function searchProducts(query: string): Promise<ProductOption[]> {
  const q = query.trim()
  if (q.length < 1) return []

  const [managedRes, privateRes, customRes] = await Promise.all([
    fetch(`/ma/api/ops/managed-products/list?keyword=${encodeURIComponent(q)}&pageSize=20`).then((r) => r.json()),
    fetch(`/ma/api/private-funds/products/search?q=${encodeURIComponent(q)}`).then((r) => r.json()),
    fetch(`/ma/api/custom-funds/list?scope=team&keyword=${encodeURIComponent(q)}&pageSize=20`, {
      headers: userFetchHeaders(),
    }).then((r) => r.json()),
  ])

  const byKey = new Map<string, ProductOption>()

  if (managedRes?.data && Array.isArray(managedRes.data)) {
    for (const row of managedRes.data as { product_name?: string; beian_hao?: string | null }[]) {
      if (!row.product_name) continue
      byKey.set(`managed:${row.product_name}`, {
        product_name: row.product_name,
        beian_hao: row.beian_hao ?? null,
        source: "managed",
      })
    }
  }

  if (Array.isArray(privateRes)) {
    for (const name of privateRes as string[]) {
      if (!name) continue
      byKey.set(`private:${name}`, {
        product_name: name,
        beian_hao: null,
        source: "private",
      })
    }
  }

  if (customRes?.data && Array.isArray(customRes.data)) {
    for (const row of customRes.data as { product_name?: string; product_code?: string | null }[]) {
      if (!row.product_name || !row.product_code) continue
      byKey.set(`custom:${row.product_code}`, {
        product_name: row.product_name,
        beian_hao: row.product_code,
        source: "custom_fund",
      })
    }
  }

  return [...byKey.values()].slice(0, 20)
}

type GenerateResult = {
  reportId: string
  endDate: string
  productCount: number
  previewUrl: string | null
  download: { pptx: string; pdf: string | null }
}

const dateInputClass =
  "h-10 w-full rounded-md border border-border bg-background pl-3 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-ring [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-2 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-8 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"

function DatePickerInput({
  value,
  onChange,
  min,
  max,
  placeholder = "YYYY-MM-DD",
}: {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => inputRef.current?.showPicker?.()}
        className={[dateInputClass, value ? "text-foreground" : "text-transparent"].join(" ")}
      />
      {!value && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
          {placeholder}
        </span>
      )}
      <CalendarDays className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
    </div>
  )
}

function ProductSearchField({
  value,
  onSelect,
}: {
  value: string
  onSelect: (option: ProductOption) => void
}) {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<ProductOption[]>([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setOptions([])
      return
    }
    const timer = window.setTimeout(() => {
      searchProducts(query)
        .then(setOptions)
        .catch(() => setOptions([]))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, open])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  return (
    <div ref={wrapRef} className="relative flex-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="搜索产品"
          className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {open && options.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-md border bg-background shadow-lg">
          {options.map((option) => (
            <button
              key={`${option.source}:${option.beian_hao ?? option.product_name}`}
              type="button"
              onClick={() => {
                setQuery(option.product_name)
                onSelect(option)
                setOpen(false)
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{option.product_name}</span>
                <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                  {SOURCE_LABELS[option.source]}
                </span>
              </div>
              {option.beian_hao && (
                <div className="truncate text-xs text-zinc-400">{option.beian_hao}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function emptySectionFunds(): Record<VolatilitySection, FundSlot[]> {
  return { 低波: [], 中低波: [], 中波: [] }
}

export function ProductMonthlyReportDialog({
  open,
  onClose,
  onBack,
  embedded = false,
}: {
  open: boolean
  onClose: () => void
  onBack: () => void
  embedded?: boolean
}) {
  const baseId = useId()
  const [sectionFunds, setSectionFunds] = useState<Record<VolatilitySection, FundSlot[]>>(emptySectionFunds())
  const [endDate, setEndDate] = useState("")
  const [navRange, setNavRange] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)

  useEffect(() => {
    if (!open) {
      setSectionFunds(emptySectionFunds())
      setEndDate("")
      setNavRange({ start: null, end: null })
      setLoading(false)
      setError(null)
      setResult(null)
    }
  }, [open])

  const selectedFundsKey = VOLATILITY_SECTIONS.flatMap((section) =>
    sectionFunds[section]
      .filter((slot) => slot.product_name.trim())
      .map((slot) => `${section}:${slot.product_name}:${slot.beian_hao ?? ""}`),
  ).join("|")

  useEffect(() => {
    if (!selectedFundsKey) {
      setNavRange({ start: null, end: null })
      return
    }

    const funds = VOLATILITY_SECTIONS.flatMap((section) => sectionFunds[section]).filter(
      (slot) => slot.product_name.trim(),
    )

    let cancelled = false
    Promise.all(
      funds.map(async (slot) => {
        const params = new URLSearchParams({ product_name: slot.product_name.trim() })
        if (slot.beian_hao) params.set("beian_hao", slot.beian_hao)
        const resp = await fetch(`/ma/api/reports/product-monthly/nav-range?${params}`)
        const json = await resp.json()
        if (!resp.ok || json.error) return null
        return json as { nav_start_date: string | null; latest_nav_date: string | null }
      }),
    )
      .then((ranges) => {
        if (cancelled) return
        const valid = ranges.filter(Boolean) as Array<{ nav_start_date: string | null; latest_nav_date: string | null }>
        if (valid.length === 0) {
          setNavRange({ start: null, end: null })
          return
        }
        const starts = valid.map((r) => r.nav_start_date).filter(Boolean) as string[]
        const ends = valid.map((r) => r.latest_nav_date).filter(Boolean) as string[]
        // Intersection of all product ranges: latest common start, earliest common end
        setNavRange({
          start: starts.length ? starts.sort().at(-1)! : null,
          end: ends.length ? ends.sort()[0] : null,
        })
      })
      .catch(() => {
        if (!cancelled) setNavRange({ start: null, end: null })
      })

    return () => {
      cancelled = true
    }
  }, [selectedFundsKey, sectionFunds])

  useEffect(() => {
    if (navRange.end && endDate && endDate > navRange.end) {
      setEndDate(navRange.end)
    }
  }, [navRange.end, endDate])

  function addFundSlot(section: VolatilitySection) {
    setSectionFunds((prev) => ({
      ...prev,
      [section]: [...prev[section], { id: `${baseId}-${section}-${Date.now()}`, product_name: "", beian_hao: null }],
    }))
    setResult(null)
    setError(null)
  }

  function removeFundSlot(section: VolatilitySection, slotId: string) {
    setSectionFunds((prev) => ({
      ...prev,
      [section]: prev[section].filter((slot) => slot.id !== slotId),
    }))
    setResult(null)
    setError(null)
  }

  function updateFundSlot(section: VolatilitySection, slotId: string, option: ProductOption) {
    setSectionFunds((prev) => ({
      ...prev,
      [section]: prev[section].map((slot) =>
        slot.id === slotId
          ? { ...slot, product_name: option.product_name, beian_hao: option.beian_hao }
          : slot,
      ),
    }))
    setResult(null)
    setError(null)
  }

  function handleFillLatestEndDate() {
    if (!navRange.end) {
      setError("请先选择有净值数据的产品")
      return
    }
    setEndDate(navRange.end)
    setResult(null)
    setError(null)
  }

  async function handleGenerate() {
    const fundsPayload: Partial<Record<VolatilitySection, Array<{ product_name: string; beian_hao?: string }>>> = {}
    let total = 0

    for (const section of VOLATILITY_SECTIONS) {
      const items = sectionFunds[section]
        .filter((slot) => slot.product_name.trim())
        .map((slot) => ({
          product_name: slot.product_name.trim(),
          beian_hao: slot.beian_hao ?? undefined,
        }))
      if (items.length > 0) {
        fundsPayload[section] = items
        total += items.length
      }
    }

    if (total === 0) {
      setError("请至少为一个波动类型选择产品")
      return
    }
    if (!endDate) {
      setError("请填写报告截止日期")
      return
    }
    if (navRange.start && endDate < navRange.start) {
      setError(`截止日期不能早于 ${navRange.start}`)
      return
    }
    if (navRange.end && endDate > navRange.end) {
      setError(`截止日期不能晚于 ${navRange.end}`)
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const resp = await fetch("/ma/api/reports/product-monthly/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ end_date: endDate, funds: fundsPayload }),
      })
      const json = await resp.json()
      if (!resp.ok) {
        throw new Error(json.error || "报告生成失败")
      }
      setResult(json as GenerateResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : "报告生成失败")
    } finally {
      setLoading(false)
    }
  }

  const dialogBody = (
    <DialogContent className="flex max-h-[90vh] w-[920px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[920px]" showCloseButton>
        <DialogHeader className="border-b px-6 py-4 text-left">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <DialogTitle className="text-base font-semibold">私募基金月报-官方</DialogTitle>
              <p className="mt-0.5 text-xs text-zinc-400">按低波 / 中低波 / 中波分组，生成私募产品历史业绩月报</p>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            {VOLATILITY_SECTIONS.map((section) => (
              <div key={section} className="rounded-lg border bg-zinc-50/80 p-4 dark:bg-zinc-900/40">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{section}</h3>
                    <p className="text-xs text-zinc-400">选择归入「{section}」的产品</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addFundSlot(section)}
                    className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs hover:bg-muted"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    添加产品
                  </button>
                </div>

                {sectionFunds[section].length === 0 ? (
                  <p className="text-xs text-zinc-400">暂未添加产品，点击「添加产品」开始选择</p>
                ) : (
                  <div className="space-y-2">
                    {sectionFunds[section].map((slot) => (
                      <div key={slot.id} className="flex items-center gap-2">
                        <ProductSearchField
                          value={slot.product_name}
                          onSelect={(option) => updateFundSlot(section, slot.id, option)}
                        />
                        <button
                          type="button"
                          onClick={() => removeFundSlot(section, slot.id)}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-zinc-500 hover:bg-muted hover:text-foreground"
                          aria-label="移除产品"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-medium">
                  <span className="text-red-500">*</span> 报告截止日期
                </label>
                <button
                  type="button"
                  onClick={handleFillLatestEndDate}
                  disabled={!navRange.end}
                  className="text-xs text-sky-600 hover:text-sky-700 disabled:cursor-not-allowed disabled:text-zinc-300 dark:text-sky-400 dark:disabled:text-zinc-600"
                >
                  填充最新净值日
                </button>
              </div>
              <DatePickerInput
                value={endDate}
                min={navRange.start ?? undefined}
                max={navRange.end ?? undefined}
                onChange={(value) => {
                  setEndDate(value)
                  setResult(null)
                }}
              />
              <p className="mt-1.5 text-xs text-zinc-400">
                业绩统计截至该日期
                {navRange.start && navRange.end ? `（已选产品共同可用区间 ${navRange.start} ~ ${navRange.end}）` : ""}
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="inline-flex h-9 items-center justify-center rounded-md bg-red-500 px-4 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  生成中…
                </>
              ) : (
                "生成报告"
              )}
            </button>

            {result && (
              <>
                <a
                  href={result.download.pptx}
                  download
                  className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
                >
                  <Download className="mr-2 h-4 w-4" />
                  下载 PPT
                </a>
                {result.download.pdf && (
                  <a
                    href={result.download.pdf}
                    download
                    className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    下载 PDF
                  </a>
                )}
              </>
            )}
          </div>

          {result?.previewUrl && (
            <div className="mt-6 rounded-xl border bg-zinc-50/80 p-4 dark:bg-zinc-900/40">
              <div className="mb-3">
                <h3 className="text-sm font-semibold">私募产品历史业绩月报</h3>
                <p className="text-xs text-zinc-400">
                  数据截至 {result.endDate} · 共 {result.productCount} 个产品
                </p>
              </div>
              <div className="overflow-hidden rounded-lg border bg-white dark:bg-zinc-950">
                <iframe
                  src={`${result.previewUrl}&t=${Date.now()}#toolbar=0&navpanes=0`}
                  title="月报预览"
                  className="h-[640px] w-full"
                />
              </div>
            </div>
          )}

          {result && !result.previewUrl && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400">
              PPT 已生成。PDF 预览需要服务器安装 LibreOffice（Linux）或 Microsoft PowerPoint（Windows），您可先下载 PPT 文件。
            </div>
          )}
        </div>
      </DialogContent>
  )

  if (embedded) return dialogBody

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      {dialogBody}
    </Dialog>
  )
}
