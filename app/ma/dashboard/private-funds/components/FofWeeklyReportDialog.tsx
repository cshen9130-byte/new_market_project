"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, CalendarDays, Download, Loader2, Save, Search, Trash2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  deleteFofWeeklyReportPreset,
  loadFofWeeklyReportPresets,
  upsertFofWeeklyReportPreset,
  type FofWeeklyReportPreset,
} from "@/lib/client/fof-weekly-report-presets"

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
  { key: "511010.SH", label: "国债ETF" },
  { key: "518880.SH", label: "黄金ETF" },
  { key: "NHCI.NH", label: "南华商品指数" },
] as const

const NAV_FREQUENCY_OPTIONS = [
  { value: "weekly", label: "周频" },
  { value: "daily", label: "日频" },
  { value: "monthly", label: "月频" },
] as const

type NavFrequency = (typeof NAV_FREQUENCY_OPTIONS)[number]["value"]

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

function productOptionKey(option: ProductOption): string {
  if (option.source === "custom_fund") return `custom:${option.beian_hao ?? option.product_name}`
  return `${option.source}:${option.product_name}`
}

function mergeProductOptions(...batches: ProductOption[][]): ProductOption[] {
  const byKey = new Map<string, ProductOption>()
  for (const batch of batches) {
    for (const option of batch) {
      const key = productOptionKey(option)
      if (!byKey.has(key)) byKey.set(key, option)
    }
  }
  const sourceRank: Record<ProductSource, number> = {
    custom_fund: 0,
    managed: 1,
    private: 2,
  }
  return [...byKey.values()]
    .sort((a, b) => {
      const rank = sourceRank[a.source] - sourceRank[b.source]
      if (rank !== 0) return rank
      return a.product_name.localeCompare(b.product_name, "zh")
    })
    .slice(0, 20)
}

async function fetchJsonSafe(url: string, init?: RequestInit): Promise<unknown | null> {
  try {
    const resp = await fetch(url, init)
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

function parseCustomFundOptions(json: unknown): ProductOption[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: ProductOption[] = []
  for (const row of data as { product_name?: string; product_code?: string | null }[]) {
    if (!row.product_name || !row.product_code) continue
    out.push({
      product_name: row.product_name,
      beian_hao: row.product_code,
      source: "custom_fund",
    })
  }
  return out
}

function parsePrivateFundOptions(json: unknown): ProductOption[] {
  if (!Array.isArray(json)) return []
  const out: ProductOption[] = []
  for (const row of json as Array<string | { product_name?: string; beian_hao?: string | null }>) {
    if (typeof row === "string") {
      if (!row) continue
      out.push({ product_name: row, beian_hao: null, source: "private" })
      continue
    }
    if (!row?.product_name) continue
    out.push({
      product_name: row.product_name,
      beian_hao: row.beian_hao ?? null,
      source: "private",
    })
  }
  return out
}

function parseManagedOptions(json: unknown): ProductOption[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: ProductOption[] = []
  for (const row of data as { product_name?: string; beian_hao?: string | null }[]) {
    if (!row.product_name) continue
    out.push({
      product_name: row.product_name,
      beian_hao: row.beian_hao ?? null,
      source: "managed",
    })
  }
  return out
}

type GenerateResult = {
  reportId: string
  reportTitle: string
  weekStart: string
  weekEnd: string
  previewUrl: string
  download: { png: string; pdf: string }
}

function isoWeekBegin(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`)
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d.toISOString().slice(0, 10)
}

function latestWeekRange(latestNavDate: string): { begin: string; end: string } {
  return {
    begin: isoWeekBegin(latestNavDate),
    end: latestNavDate,
  }
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

function SavePresetDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState("")

  useEffect(() => {
    if (open) setName("")
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 p-0" showCloseButton>
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="text-base font-semibold">保存配置</DialogTitle>
        </DialogHeader>
        <div className="px-6 py-5">
          <div className="mb-6 flex items-center gap-3">
            <label className="shrink-0 text-sm font-medium text-zinc-700 dark:text-zinc-300">配置名称</label>
            <input
              autoFocus
              className="flex-1 rounded border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              placeholder="例如：金舆基石一号 · 周报"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) {
                  onSave(name.trim())
                  onOpenChange(false)
                }
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded border px-4 py-1.5 text-sm transition-colors hover:bg-muted"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                if (!name.trim()) return
                onSave(name.trim())
                onOpenChange(false)
              }}
              disabled={!name.trim()}
              className="rounded bg-red-500 px-4 py-1.5 text-sm text-white transition-colors hover:bg-red-600 disabled:opacity-40"
            >
              保存
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProductSearchField({
  value,
  onSelect,
}: {
  value: string
  beianHao: string | null
  productSource: ProductSource
  onSelect: (option: ProductOption) => void
}) {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<ProductOption[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const customOptsRef = useRef<ProductOption[]>([])
  const privateOptsRef = useRef<ProductOption[]>([])
  const managedOptsRef = useRef<ProductOption[]>([])

  useEffect(() => {
    setQuery(value)
  }, [value])

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setOptions([])
      setSearching(false)
      customOptsRef.current = []
      privateOptsRef.current = []
      managedOptsRef.current = []
      return
    }

    const ac = new AbortController()
    let cancelled = false
    setSearching(true)

    const timer = window.setTimeout(() => {
      const q = query.trim()
      const headers = userFetchHeaders()
      const publish = () => {
        if (cancelled) return
        setOptions(mergeProductOptions(
          customOptsRef.current,
          privateOptsRef.current,
          managedOptsRef.current,
        ))
      }

      // Custom funds are local/file-backed — show them immediately without waiting on DB list APIs.
      const customPromise = Promise.all([
        fetchJsonSafe(
          `/ma/api/custom-funds/list?scope=team&keyword=${encodeURIComponent(q)}&pageSize=20`,
          { headers, signal: ac.signal },
        ),
        fetchJsonSafe(
          `/ma/api/custom-funds/list?scope=mine&keyword=${encodeURIComponent(q)}&pageSize=20`,
          { headers, signal: ac.signal },
        ),
      ]).then(([teamJson, mineJson]) => {
        if (cancelled) return
        customOptsRef.current = [
          ...parseCustomFundOptions(teamJson),
          ...parseCustomFundOptions(mineJson),
        ]
        publish()
      })

      const privatePromise = fetchJsonSafe(
        `/ma/api/private-funds/products/search?q=${encodeURIComponent(q)}&format=picker`,
        { signal: ac.signal },
      ).then((json) => {
        if (cancelled) return
        privateOptsRef.current = parsePrivateFundOptions(json)
        publish()
      })

      // Managed list endpoint is heavy; merge when ready so it never blocks custom-fund hits.
      const managedPromise = fetchJsonSafe(
        `/ma/api/ops/managed-products/list?keyword=${encodeURIComponent(q)}&pageSize=20`,
        { signal: ac.signal },
      ).then((json) => {
        if (cancelled) return
        managedOptsRef.current = parseManagedOptions(json)
        publish()
      })

      void Promise.allSettled([customPromise, privatePromise, managedPromise]).then(() => {
        if (cancelled) return
        setSearching(false)
      })
    }, 120)

    return () => {
      cancelled = true
      ac.abort()
      window.clearTimeout(timer)
    }
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
            // Keep typing local — do not commit partial names (avoids slow nav-range regeneration).
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="搜索在管产品、私募基金、自建基金"
          className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {open && query.trim().length > 0 && (searching || options.length > 0) && (
        <div className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-md border bg-background shadow-lg">
          {options.length === 0 && searching ? (
            <div className="px-3 py-2 text-sm text-zinc-400">搜索中…</div>
          ) : (
            options.map((option) => (
              <button
                key={productOptionKey(option)}
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
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function FofWeeklyReportDialog({
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
  const [reportTitle, setReportTitle] = useState("")
  const [weekBegin, setWeekBegin] = useState("")
  const [weekEnd, setWeekEnd] = useState("")
  const [benchmarkKey, setBenchmarkKey] = useState("IF")
  const [navFrequency, setNavFrequency] = useState<NavFrequency>("weekly")
  const [productSource, setProductSource] = useState<ProductSource>("managed")
  const [presets, setPresets] = useState<FofWeeklyReportPreset[]>([])
  const [selectedPresetName, setSelectedPresetName] = useState("")
  const [showSavePresetModal, setShowSavePresetModal] = useState(false)
  const [presetMessage, setPresetMessage] = useState<string | null>(null)
  const [navRange, setNavRange] = useState<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)

  useEffect(() => {
    if (!open) {
      setProductName("")
      setBeianHao(null)
      setReportTitle("")
      setWeekBegin("")
      setWeekEnd("")
      setBenchmarkKey("IF")
      setNavFrequency("weekly")
      setProductSource("managed")
      setSelectedPresetName("")
      setShowSavePresetModal(false)
      setPresetMessage(null)
      setNavRange({ start: null, end: null })
      setLoading(false)
      setError(null)
      setResult(null)
    }
  }, [open])

  useEffect(() => {
    if (open) setPresets(loadFofWeeklyReportPresets())
  }, [open])

  function applyPreset(preset: FofWeeklyReportPreset) {
    setProductName(preset.product_name)
    setBeianHao(preset.beian_hao)
    setProductSource(preset.product_source)
    setReportTitle(preset.report_title)
    setWeekBegin(preset.week_begin)
    setWeekEnd(preset.week_end)
    setBenchmarkKey(preset.benchmark_key)
    setNavFrequency(preset.nav_frequency ?? "weekly")
    setSelectedPresetName(preset.name)
    setResult(null)
    setError(null)
    setPresetMessage(`已加载配置「${preset.name}」`)
  }

  function handleLoadPreset() {
    const preset = presets.find((item) => item.name === selectedPresetName)
    if (!preset) {
      setError("请选择要加载的配置")
      return
    }
    applyPreset(preset)
  }

  function handleSavePreset(name: string) {
    if (!productName.trim()) {
      setError("请先填写产品名称后再保存配置")
      return
    }

    const preset: FofWeeklyReportPreset = {
      name,
      product_name: productName.trim(),
      beian_hao: beianHao,
      product_source: productSource,
      report_title: reportTitle.trim() || productName.trim(),
      week_begin: weekBegin,
      week_end: weekEnd,
      benchmark_key: benchmarkKey,
      nav_frequency: navFrequency,
      savedAt: new Date().toISOString(),
    }
    const next = upsertFofWeeklyReportPreset(preset)
    setPresets(next)
    setSelectedPresetName(name)
    setPresetMessage(`已保存配置「${name}」`)
    setError(null)
  }

  function handleDeletePreset() {
    if (!selectedPresetName) {
      setError("请选择要删除的配置")
      return
    }
    const name = selectedPresetName
    const next = deleteFofWeeklyReportPreset(name)
    setPresets(next)
    setSelectedPresetName("")
    setPresetMessage(`已删除配置「${name}」`)
    setError(null)
  }

  useEffect(() => {
    if (!productName.trim()) {
      setNavRange({ start: null, end: null })
      return
    }
    const params = new URLSearchParams({ product_name: productName.trim() })
    if (beianHao) params.set("beian_hao", beianHao)
    fetch(`/ma/api/reports/fof-weekly/nav-range?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) return
        if (json.beian_hao && json.beian_hao !== beianHao) {
          setBeianHao(json.beian_hao)
        }
        const start = json.nav_start_date ?? null
        const end = json.latest_nav_date ?? null
        setNavRange({ start, end })
      })
      .catch(() => setNavRange({ start: null, end: null }))
  }, [beianHao, productName])

  function handleFillLatestWeek() {
    if (!navRange.end) {
      setError("请先选择有净值数据的产品")
      return
    }
    const range = latestWeekRange(navRange.end)
    setWeekBegin(range.begin)
    setWeekEnd(range.end)
    setResult(null)
    setError(null)
  }

  function handleProductSelect(option: ProductOption) {
    setProductName(option.product_name)
    setBeianHao(option.beian_hao)
    setProductSource(option.source)
    setReportTitle(option.product_name)
    setWeekBegin("")
    setWeekEnd("")
    setResult(null)
    setError(null)
  }

  async function readJsonSafe(resp: Response): Promise<Record<string, unknown>> {
    const text = await resp.text()
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      if (text.trimStart().startsWith("<")) {
        throw new Error(
          resp.status === 504 || resp.status === 502
            ? "服务器超时，请稍后重试"
            : `服务器返回了错误页面（HTTP ${resp.status}），请稍后重试`,
        )
      }
      throw new Error(text.trim().slice(0, 200) || `请求失败（HTTP ${resp.status}）`)
    }
  }

  async function pollGenerateResult(reportId: string): Promise<GenerateResult> {
    const started = Date.now()
    const timeoutMs = 240_000
    while (Date.now() - started < timeoutMs) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200))
      const statusResp = await fetch(`/ma/api/reports/fof-weekly/status?id=${encodeURIComponent(reportId)}`)
      const statusJson = await readJsonSafe(statusResp)
      if (!statusResp.ok) {
        throw new Error(typeof statusJson.error === "string" ? statusJson.error : "查询报告状态失败")
      }
      if (statusJson.status === "done" && statusJson.result && typeof statusJson.result === "object") {
        return statusJson.result as GenerateResult
      }
      if (statusJson.status === "error") {
        throw new Error(typeof statusJson.error === "string" ? statusJson.error : "报告生成失败")
      }
    }
    throw new Error("报告生成超时，请稍后重试")
  }

  async function handleGenerate() {
    if (!productName.trim()) {
      setError("请先选择产品")
      return
    }
    if (!weekBegin || !weekEnd) {
      setError("请填写报告周的开始和结束日期")
      return
    }
    if (weekBegin > weekEnd) {
      setError("开始日期不能晚于结束日期")
      return
    }
    if (navRange.start && weekBegin < navRange.start) {
      setError(`开始日期不能早于 ${navRange.start}`)
      return
    }
    if (navRange.end && weekEnd > navRange.end) {
      setError(`结束日期不能晚于 ${navRange.end}`)
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const resp = await fetch("/ma/api/reports/fof-weekly/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: productName.trim(),
          beian_hao: beianHao ?? undefined,
          week_begin: weekBegin,
          week_end: weekEnd,
          report_title: reportTitle.trim() || productName.trim(),
          benchmark_key: benchmarkKey,
          nav_frequency: navFrequency,
        }),
      })
      const json = await readJsonSafe(resp)
      if (!resp.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "报告生成失败")
      }

      // Async job: poll status until Python render finishes.
      if (json.async && typeof json.reportId === "string") {
        const result = await pollGenerateResult(json.reportId)
        setResult(result)
        return
      }

      setResult(json as unknown as GenerateResult)
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
              <DialogTitle className="text-base font-semibold">跟踪产品（通用曲线版）</DialogTitle>
              <p className="mt-0.5 text-xs text-zinc-400">选择产品与报告周，生成 FOF 产品周报</p>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-4 rounded-lg border bg-zinc-50/80 p-4 dark:bg-zinc-900/40">
            <div className="mb-2 text-sm font-medium">已保存配置</div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedPresetName}
                onChange={(e) => setSelectedPresetName(e.target.value)}
                className="h-9 min-w-[180px] flex-1 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">选择已保存配置…</option>
                {presets.map((preset) => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleLoadPreset}
                disabled={!selectedPresetName}
                className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm hover:bg-muted disabled:opacity-40"
              >
                加载
              </button>
              <button
                type="button"
                onClick={() => setShowSavePresetModal(true)}
                className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm hover:bg-muted"
              >
                <Save className="mr-1.5 h-4 w-4" />
                保存配置
              </button>
              <button
                type="button"
                onClick={handleDeletePreset}
                disabled={!selectedPresetName}
                className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-background px-3 text-sm text-zinc-600 hover:bg-muted disabled:opacity-40"
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                删除
              </button>
            </div>
            {presetMessage && (
              <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{presetMessage}</p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-sm font-medium">
                <span className="text-red-500">*</span> 产品名称
              </label>
              <ProductSearchField
                value={productName}
                beianHao={beianHao}
                productSource={productSource}
                onSelect={handleProductSelect}
              />
            </div>

            <div className="sm:col-span-2">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-medium">
                  <span className="text-red-500">*</span> 报告周
                </label>
                <button
                  type="button"
                  onClick={handleFillLatestWeek}
                  disabled={!navRange.end}
                  className="text-xs text-sky-600 hover:text-sky-700 disabled:cursor-not-allowed disabled:text-zinc-300 dark:text-sky-400 dark:disabled:text-zinc-600"
                >
                  填充最近一周
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">开始日期</label>
                  <DatePickerInput
                    value={weekBegin}
                    min={navRange.start ?? undefined}
                    max={navRange.end ?? undefined}
                    onChange={(value) => {
                      setWeekBegin(value)
                      // Don't lock the range to a stale end date from a saved preset.
                      if (weekEnd && value > weekEnd) setWeekEnd(value)
                      setResult(null)
                    }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-zinc-500">结束日期</label>
                  <DatePickerInput
                    value={weekEnd}
                    min={navRange.start ?? undefined}
                    max={navRange.end ?? undefined}
                    onChange={(value) => {
                      setWeekEnd(value)
                      if (weekBegin && value < weekBegin) setWeekBegin(value)
                      setResult(null)
                    }}
                  />
                </div>
              </div>
              <p className="mt-1.5 text-xs text-zinc-400">
                填写报告覆盖的起止日期，业绩统计与图表高亮均按所选区间计算
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
              <label className="mb-1.5 block text-sm font-medium">
                <span className="text-red-500">*</span> 净值频率
              </label>
              <select
                value={navFrequency}
                onChange={(e) => {
                  setNavFrequency(e.target.value as NavFrequency)
                  setResult(null)
                }}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {NAV_FREQUENCY_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-zinc-400">
                若原始净值为日频，选择周频/月频时将自动聚合后再计算业绩指标
              </p>
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
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{result.reportTitle} 周报</h3>
                  <p className="text-xs text-zinc-400">
                    报告周 {result.weekStart} ~ {result.weekEnd}
                  </p>
                </div>
              </div>
              <div className="overflow-auto rounded-lg border bg-white dark:bg-zinc-950">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${result.previewUrl}&t=${Date.now()}`}
                  alt={`${result.reportTitle} 周报预览`}
                  className="mx-auto block max-w-full"
                />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
  )

  return (
    <>
      {embedded ? (
        dialogBody
      ) : (
        <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
          {dialogBody}
        </Dialog>
      )}
      <SavePresetDialog
        open={showSavePresetModal}
        onOpenChange={setShowSavePresetModal}
        onSave={handleSavePreset}
      />
    </>
  )
}
