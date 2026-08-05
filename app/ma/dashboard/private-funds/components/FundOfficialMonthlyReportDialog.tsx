"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, CalendarDays, Download, Loader2, Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type ProductSource = "managed" | "private" | "custom_fund"

type ProductOption = {
  product_name: string
  beian_hao: string | null
  source: ProductSource
}

const SOURCE_LABELS: Record<ProductSource, string> = {
  managed: "在管产品",
  private: "私募基金",
  custom_fund: "自建基金",
}

const BENCHMARK_OPTIONS = [
  { key: "IF", label: "沪深300" },
  { key: "510300.SH", label: "沪深300ETF" },
  { key: "IC", label: "中证500" },
  { key: "IM", label: "中证1000" },
  { key: "IH", label: "上证50" },
  { key: "NHCI.NH", label: "南华商品指数" },
] as const

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

  const headers = userFetchHeaders()
  const [managedRes, privateRes, customRes] = await Promise.all([
    fetch(`/ma/api/ops/managed-products/list?keyword=${encodeURIComponent(q)}&pageSize=20`).then((r) => r.json()).catch(() => null),
    fetch(`/ma/api/private-funds/products/search?q=${encodeURIComponent(q)}&format=picker`).then((r) => r.json()).catch(() => null),
    fetch(`/ma/api/custom-funds/list?scope=team&keyword=${encodeURIComponent(q)}&pageSize=20`, { headers }).then((r) => r.json()).catch(() => null),
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
    for (const row of privateRes as Array<string | { product_name?: string; beian_hao?: string | null }>) {
      if (typeof row === "string") {
        if (!row) continue
        byKey.set(`private:${row}`, { product_name: row, beian_hao: null, source: "private" })
        continue
      }
      if (!row?.product_name) continue
      byKey.set(`private:${row.product_name}`, {
        product_name: row.product_name,
        beian_hao: row.beian_hao ?? null,
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
  reportTitle: string
  monthStart: string
  monthEnd: string
  previewUrl: string
  download: { png: string; pdf: string }
}

function monthBegin(dateStr: string): string {
  const [year, month] = dateStr.split("-")
  return `${year}-${month}-01`
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
    <div ref={wrapRef} className="relative">
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
          className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
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

export function FundOfficialMonthlyReportDialog({
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
  const [productName, setProductName] = useState("")
  const [beianHao, setBeianHao] = useState<string | null>(null)
  const [monthBeginDate, setMonthBeginDate] = useState("")
  const [monthEndDate, setMonthEndDate] = useState("")
  const [benchmarkKey, setBenchmarkKey] = useState<string>("IF")
  const [reportTitle, setReportTitle] = useState("")
  const [managerBio, setManagerBio] = useState("")
  const [brandName, setBrandName] = useState("")
  const [navRange, setNavRange] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)

  useEffect(() => {
    if (!open) return
    setProductName("")
    setBeianHao(null)
    setMonthBeginDate("")
    setMonthEndDate("")
    setBenchmarkKey("IF")
    setReportTitle("")
    setManagerBio("")
    setBrandName("")
    setNavRange({ start: null, end: null })
    setLoading(false)
    setError(null)
    setResult(null)
  }, [open])

  useEffect(() => {
    if (!productName.trim()) {
      setNavRange({ start: null, end: null })
      return
    }
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ product_name: productName.trim() })
      if (beianHao) params.set("beian_hao", beianHao)
      fetch(`/ma/api/reports/fund-official-monthly/nav-range?${params}`)
        .then((r) => r.json())
        .then((json) => {
          if (json?.error) return
          setNavRange({
            start: json.nav_start_date ?? null,
            end: json.latest_nav_date ?? null,
          })
          if (json.latest_nav_date && !monthEndDate) {
            setMonthEndDate(json.latest_nav_date)
            setMonthBeginDate(monthBegin(json.latest_nav_date))
          }
        })
        .catch(() => {})
    }, 250)
    return () => window.clearTimeout(timer)
  }, [productName, beianHao]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGenerate() {
    if (!productName.trim()) {
      setError("请选择产品")
      return
    }
    if (!monthEndDate) {
      setError("请选择报告月结束日期")
      return
    }
    if (monthBeginDate && monthBeginDate > monthEndDate) {
      setError("开始日期不能晚于结束日期")
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const resp = await fetch("/ma/api/reports/fund-official-monthly/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: productName.trim(),
          beian_hao: beianHao ?? undefined,
          month_begin: monthBeginDate || undefined,
          month_end: monthEndDate,
          report_title: reportTitle.trim() || productName.trim(),
          benchmark_key: benchmarkKey,
          manager_bio: managerBio.trim() || undefined,
          brand_name: brandName.trim() || undefined,
        }),
      })
      const json = await resp.json()
      if (!resp.ok) throw new Error(json.error || "报告生成失败")
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
            <DialogTitle className="text-base font-semibold">单产品投资月报</DialogTitle>
            <p className="mt-0.5 text-xs text-zinc-400">
              产品概览 · 经理简介 · 净值走势 · 业绩表现 · 持仓结构
            </p>
          </div>
        </div>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium">
              <span className="text-red-500">*</span> 产品名称
            </label>
            <ProductSearchField
              value={productName}
              onSelect={(option) => {
                setProductName(option.product_name)
                setBeianHao(option.beian_hao)
                setReportTitle((prev) => prev || option.product_name)
                setResult(null)
              }}
            />
          </div>

          <div className="sm:col-span-2">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium">
                <span className="text-red-500">*</span> 报告月
              </label>
              <button
                type="button"
                onClick={() => {
                  if (!navRange.end) return
                  setMonthEndDate(navRange.end)
                  setMonthBeginDate(monthBegin(navRange.end))
                  setResult(null)
                }}
                disabled={!navRange.end}
                className="text-xs text-sky-600 hover:text-sky-700 disabled:cursor-not-allowed disabled:text-zinc-300 dark:text-sky-400 dark:disabled:text-zinc-600"
              >
                填充最近一月
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">开始日期</label>
                <DatePickerInput
                  value={monthBeginDate}
                  min={navRange.start ?? undefined}
                  max={monthEndDate || navRange.end || undefined}
                  onChange={(value) => {
                    setMonthBeginDate(value)
                    setResult(null)
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">结束日期</label>
                <DatePickerInput
                  value={monthEndDate}
                  min={monthBeginDate || navRange.start || undefined}
                  max={navRange.end ?? undefined}
                  onChange={(value) => {
                    setMonthEndDate(value)
                    setResult(null)
                  }}
                />
              </div>
            </div>
            <p className="mt-1.5 text-xs text-zinc-400">
              业绩统计与月度收益表按所选区间截止日计算
              {navRange.start && navRange.end ? `（净值区间 ${navRange.start} ~ ${navRange.end}）` : ""}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              <span className="text-red-500">*</span> 基准指数
            </label>
            <select
              value={benchmarkKey}
              onChange={(e) => {
                setBenchmarkKey(e.target.value)
                setResult(null)
              }}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {BENCHMARK_OPTIONS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">品牌 / 水印</label>
            <input
              type="text"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              placeholder="默认取管理人简称"
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium">报告标题</label>
            <input
              type="text"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="默认使用产品名称"
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-sm font-medium">投资经理简介</label>
            <textarea
              value={managerBio}
              onChange={(e) => setManagerBio(e.target.value)}
              rows={3}
              placeholder="可选。填写后显示在「主要投资经理简介」区块"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
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
                href={result.download.png}
                download
                className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
              >
                <Download className="mr-2 h-4 w-4" />
                下载 PNG
              </a>
              <a
                href={result.download.pdf}
                download
                className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted"
              >
                <Download className="mr-2 h-4 w-4" />
                下载 PDF
              </a>
            </>
          )}
        </div>

        {result && (
          <div className="mt-6 rounded-xl border bg-zinc-50/80 p-4 dark:bg-zinc-900/40">
            <div className="mb-3">
              <h3 className="text-sm font-semibold">{result.reportTitle} 投资月报</h3>
              <p className="text-xs text-zinc-400">
                报告月 {result.monthStart} ~ {result.monthEnd}
              </p>
            </div>
            <div className="overflow-auto rounded-lg border bg-white dark:bg-zinc-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${result.previewUrl}&t=${Date.now()}`}
                alt={`${result.reportTitle} 投资月报预览`}
                className="mx-auto block max-w-full"
              />
            </div>
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
