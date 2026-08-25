"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Download, Loader2, Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DateInput } from "@/components/ui/date-input"

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

const BENCH1_OPTIONS = [
  { key: "000001.SH", label: "上证指数" },
  { key: "IH", label: "上证50" },
] as const

const BENCH2_OPTIONS = [
  { key: "IF", label: "沪深300" },
  { key: "000300.SH", label: "沪深300指数" },
  { key: "510300.SH", label: "沪深300ETF" },
  { key: "IC", label: "中证500" },
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
  periodStart: string
  periodEnd: string
  previewUrl: string
  download: { png: string; pdf: string }
}

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0))
  return d.toISOString().slice(0, 10)
}

function lastCompleteQuarter(asOf: string): { start: string; end: string } {
  const [y, m] = asOf.split("-").map(Number)
  const thisQ = Math.floor((m - 1) / 3)
  const qEnd = lastDayOfMonth(y, thisQ * 3 + 3)
  const q = asOf >= qEnd ? thisQ : thisQ - 1
  const year = q < 0 ? y - 1 : y
  const qIndex = q < 0 ? 3 : q
  const startMonth = qIndex * 3 + 1
  return {
    start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    end: lastDayOfMonth(year, startMonth + 2),
  }
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

export function ProductQuarterlyReportDialog({
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
  const [periodBegin, setPeriodBegin] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")
  const [bench1Key, setBench1Key] = useState("000001.SH")
  const [bench2Key, setBench2Key] = useState("IF")
  const [reportTitle, setReportTitle] = useState("")
  const [commentary, setCommentary] = useState("")
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
    setPeriodBegin("")
    setPeriodEnd("")
    setBench1Key("000001.SH")
    setBench2Key("IF")
    setReportTitle("")
    setCommentary("")
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
      fetch(`/ma/api/reports/product-quarterly/nav-range?${params}`)
        .then((r) => r.json())
        .then((json) => {
          if (json?.error) return
          setNavRange({
            start: json.nav_start_date ?? null,
            end: json.latest_nav_date ?? null,
          })
          if (json.latest_nav_date && !periodEnd) {
            const q = lastCompleteQuarter(json.latest_nav_date)
            const start = json.nav_start_date && q.start < json.nav_start_date ? json.nav_start_date : q.start
            const end = json.latest_nav_date && q.end > json.latest_nav_date ? json.latest_nav_date : q.end
            setPeriodBegin(start)
            setPeriodEnd(end)
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
    if (!periodBegin || !periodEnd) {
      setError("请选择持有期起止日期")
      return
    }
    if (periodBegin > periodEnd) {
      setError("开始日期不能晚于结束日期")
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const resp = await fetch("/ma/api/reports/product-quarterly/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: productName.trim(),
          beian_hao: beianHao ?? undefined,
          period_begin: periodBegin,
          period_end: periodEnd,
          report_title: reportTitle.trim() || productName.trim(),
          bench1_key: bench1Key,
          bench2_key: bench2Key,
          commentary: commentary.trim() || undefined,
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
            <DialogTitle className="text-base font-semibold">机构投资者持有期季报</DialogTitle>
            <p className="mt-0.5 text-xs text-zinc-400">
              一页正式季报 · 持有期收益 / 年化 / 回撤 · 上证指数与沪深300对比
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
                <span className="text-red-500">*</span> 持有期（约三个月）
              </label>
              <button
                type="button"
                onClick={() => {
                  if (!navRange.end) return
                  const q = lastCompleteQuarter(navRange.end)
                  setPeriodBegin(navRange.start && q.start < navRange.start ? navRange.start : q.start)
                  setPeriodEnd(q.end > navRange.end ? navRange.end : q.end)
                  setResult(null)
                }}
                disabled={!navRange.end}
                className="text-xs text-sky-600 hover:text-sky-700 disabled:cursor-not-allowed disabled:text-zinc-300 dark:text-sky-400 dark:disabled:text-zinc-600"
              >
                填充最近完整季度
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">开始日期</label>
                <DateInput
                  value={periodBegin}
                  min={navRange.start ?? undefined}
                  max={periodEnd || navRange.end || undefined}
                  placeholder="请选择日期"
                  inputClassName="h-10"
                  onChange={(value) => {
                    setPeriodBegin(value)
                    setResult(null)
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">结束日期</label>
                <DateInput
                  value={periodEnd}
                  min={periodBegin || navRange.start || undefined}
                  max={navRange.end ?? undefined}
                  placeholder="请选择日期"
                  inputClassName="h-10"
                  onChange={(value) => {
                    setPeriodEnd(value)
                    setResult(null)
                  }}
                />
              </div>
            </div>
            <p className="mt-1.5 text-xs text-zinc-400">
              适用于持有满三个月后向上市公司 / 机构投资者出具的季度投资报告
              {navRange.start && navRange.end ? `（净值区间 ${navRange.start} ~ ${navRange.end}）` : ""}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">基准一</label>
            <select
              value={bench1Key}
              onChange={(e) => {
                setBench1Key(e.target.value)
                setResult(null)
              }}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {BENCH1_OPTIONS.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">基准二</label>
            <select
              value={bench2Key}
              onChange={(e) => {
                setBench2Key(e.target.value)
                setResult(null)
              }}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {BENCH2_OPTIONS.map((item) => (
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

          <div>
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
            <label className="mb-1.5 block text-sm font-medium">简要说明</label>
            <textarea
              value={commentary}
              onChange={(e) => setCommentary(e.target.value)}
              rows={3}
              placeholder="可选。不填则按持有期收益、年化、回撤及相对两个基准的超额自动生成一段正式说明"
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
              <h3 className="text-sm font-semibold">{result.reportTitle} 投资季报</h3>
              <p className="text-xs text-zinc-400">
                持有期 {result.periodStart} ~ {result.periodEnd}
              </p>
            </div>
            <div className="overflow-auto rounded-lg border bg-white dark:bg-zinc-950">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${result.previewUrl}&t=${Date.now()}`}
                alt={`${result.reportTitle} 投资季报预览`}
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
