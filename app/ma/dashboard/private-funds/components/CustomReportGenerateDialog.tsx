"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Download, LayoutTemplate, Loader2, Save } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  INPUT_TYPE_META,
  normalizeTemplate,
  type ReportCustomTemplate,
  type TemplateInputField,
} from "@/lib/ma/report-template-types"
import { createReportId, upsertCustomReport, type SavedCustomReport } from "@/lib/ma/custom-report-storage"
import { styleToCss } from "@/lib/ma/report-template-style-presets"
import { ReportTemplateElementPreview } from "./ReportTemplateElementPreview"

type WizardStep = "fill" | "preview"

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

async function searchProducts(query: string): Promise<string[]> {
  const q = query.trim()
  if (q.length < 1) return []
  const [managedRes, privateRes, customRes] = await Promise.all([
    fetch(`/ma/api/ops/managed-products/list?keyword=${encodeURIComponent(q)}&pageSize=15`).then((r) => r.json()).catch(() => null),
    fetch(`/ma/api/private-funds/products/search?q=${encodeURIComponent(q)}`).then((r) => r.json()).catch(() => null),
    fetch(`/ma/api/custom-funds/list?scope=team&keyword=${encodeURIComponent(q)}&pageSize=15`, { headers: userFetchHeaders() }).then((r) => r.json()).catch(() => null),
  ])
  const names = new Set<string>()
  if (managedRes?.data) {
    for (const row of managedRes.data as { product_name?: string }[]) {
      if (row.product_name) names.add(row.product_name)
    }
  }
  if (Array.isArray(privateRes)) {
    for (const name of privateRes as string[]) if (name) names.add(name)
  }
  if (customRes?.data) {
    for (const row of customRes.data as { product_name?: string }[]) {
      if (row.product_name) names.add(row.product_name)
    }
  }
  return [...names].slice(0, 20)
}

function ProductInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setQuery(value) }, [value])

  function handleSearch(q: string) {
    setQuery(q)
    onChange(q)
    if (timer.current) clearTimeout(timer.current)
    if (q.trim().length < 1) { setOptions([]); return }
    timer.current = setTimeout(async () => {
      setLoading(true)
      try { setOptions(await searchProducts(q)) } finally { setLoading(false) }
    }, 250)
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? "搜索产品名称"}
        className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {loading && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-zinc-400" />}
      {open && options.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-background shadow-lg max-h-40 overflow-y-auto">
          {options.map((name) => (
            <button
              key={name}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-muted truncate"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(name); setQuery(name); setOpen(false) }}
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function InputFieldControl({
  field,
  value,
  onChange,
}: {
  field: TemplateInputField
  value: string
  onChange: (v: string) => void
}) {
  if (field.type === "product" || field.type === "products" || field.type === "benchmark") {
    return <ProductInput value={value} onChange={onChange} placeholder={field.placeholder} />
  }
  if (field.type === "date") {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    )
  }
  if (field.type === "date_range") {
    const [start = "", end = ""] = value.split("|")
    return (
      <div className="flex items-center gap-2">
        <input type="date" value={start} onChange={(e) => onChange(`${e.target.value}|${end}`)} className="flex-1 h-9 px-2 rounded-md border border-border bg-background text-sm" />
        <span className="text-zinc-400 text-xs">至</span>
        <input type="date" value={end} onChange={(e) => onChange(`${start}|${e.target.value}`)} className="flex-1 h-9 px-2 rounded-md border border-border bg-background text-sm" />
      </div>
    )
  }
  if (field.type === "select") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm">
        <option value="">请选择</option>
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    )
  }
  if (field.type === "number") {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
    )
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
    />
  )
}
export function CustomReportGenerateDialog({
  template: rawTemplate,
  embedded,
  open,
  onClose,
  onBack,
  onSaved,
}: {
  template: ReportCustomTemplate
  embedded?: boolean
  open: boolean
  onClose: () => void
  onBack?: () => void
  onSaved?: (report: SavedCustomReport) => void
}) {
  const template = useMemo(() => normalizeTemplate(rawTemplate), [rawTemplate])
  const [step, setStep] = useState<WizardStep>("fill")
  const [values, setValues] = useState<Record<string, string>>({})
  const [reportTitle, setReportTitle] = useState(template.name)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setStep("fill")
      setReportTitle(template.name)
      const init: Record<string, string> = {}
      for (const inp of template.inputs) init[inp.id] = ""
      setValues(init)
    }
  }, [open, template])

  function setValue(id: string, v: string) {
    setValues((prev) => ({ ...prev, [id]: v }))
  }

  function validate(): string | null {
    for (const inp of template.inputs) {
      if (inp.required && !values[inp.id]?.trim()) {
        return `请填写「${inp.label}」`
      }
    }
    if (!reportTitle.trim()) return "请填写报告标题"
    return null
  }

  function handleGeneratePreview() {
    const err = validate()
    if (err) { alert(err); return }
    setStep("preview")
  }

  function handleSave() {
    const err = validate()
    if (err) { alert(err); return }
    setSaving(true)
    try {
      let creator = ""
      try {
        const u = JSON.parse(localStorage.getItem("currentUser") || "null")
        creator = u?.name ?? u?.email ?? ""
      } catch { /* ignore */ }
      const now = new Date().toISOString()
      const report: SavedCustomReport = {
        id: createReportId(),
        title: reportTitle.trim(),
        templateId: template.id,
        templateName: template.name,
        inputValues: { ...values },
        createdAt: now,
        updatedAt: now,
        creator,
      }
      upsertCustomReport(report)
      onSaved?.(report)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function handleExportPng() {
    if (!canvasRef.current) return
    try {
      const html2canvas = (await import("html2canvas")).default
      const canvas = await html2canvas(canvasRef.current, { scale: 2, useCORS: true, backgroundColor: template.canvas.backgroundColor ?? "#ffffff" })
      const link = document.createElement("a")
      link.download = `${reportTitle.trim() || "report"}.png`
      link.href = canvas.toDataURL("image/png")
      link.click()
    } catch {
      alert("导出失败，请稍后重试")
    }
  }

  const canvas = template.canvas
  const pageBg = styleToCss({ backgroundColor: canvas.backgroundColor ?? "#ffffff", backgroundOpacity: canvas.backgroundOpacity ?? 100 })
  const scale = Math.min(1, 680 / canvas.widthPx)

  const content = (
    <>
      {step === "fill" && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">报告标题</label>
              <input
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="rounded-lg border border-dashed border-red-200 bg-red-50/30 dark:bg-red-950/10 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
              以下输入项由模板「{template.name}」在 <strong>模板管理 → 用户输入</strong> 中配置
            </div>
            {template.inputs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">此模板未配置用户输入项，可直接生成预览</p>
            ) : (
              template.inputs.map((field) => (
                <div key={field.id}>
                  <label className="text-xs text-zinc-600 dark:text-zinc-300 mb-1 flex items-center gap-1">
                    {field.label}
                    {field.required && <span className="text-red-500">*</span>}
                    <span className="text-zinc-400 font-normal">（{INPUT_TYPE_META[field.type].label}）</span>
                  </label>
                  <InputFieldControl field={field} value={values[field.id] ?? ""} onChange={(v) => setValue(field.id, v)} />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-950 p-4 min-h-0">
          <div ref={canvasRef} className="mx-auto relative shadow-lg border border-zinc-200" style={{ width: canvas.widthPx * scale, height: canvas.heightPx * scale, ...pageBg, padding: (canvas.padding ?? 24) * scale }}>
            {template.elements.map((el) => (
              <div
                key={el.id}
                className="absolute"
                style={{ left: `${el.x}%`, top: `${el.y}%`, width: `${el.width}%`, height: `${el.height}%` }}
              >
                <ReportTemplateElementPreview el={el} inputs={template.inputs} selected={false} onSelect={() => {}} inputValues={values} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t px-6 py-3 shrink-0">
        <div>
          {step === "preview" && (
            <button type="button" onClick={() => setStep("fill")} className="text-sm text-zinc-500 hover:text-foreground">
              ← 修改输入
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {step === "fill" ? (
            <button type="button" onClick={handleGeneratePreview} className="h-9 px-4 rounded-md bg-red-500 hover:bg-red-600 text-white text-sm font-medium">
              生成预览
            </button>
          ) : (
            <>
              <button type="button" onClick={handleExportPng} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm hover:bg-muted">
                <Download className="h-4 w-4" /> 导出 PNG
              </button>
              <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-red-500 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存报告
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )

  if (embedded) {
    return (
      <DialogContent className="flex max-h-[85vh] w-[960px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]" showCloseButton>
        <DialogHeader className="border-b px-6 py-4 text-left flex flex-row items-center gap-3 space-y-0">
          {onBack && (
            <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-foreground">
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <DialogTitle className="text-base font-semibold">自定义报告 · {template.name}</DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="flex max-h-[85vh] w-[960px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>自定义报告 · {template.name}</DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  )
}

export function CustomTemplateCard({
  template,
  onUse,
}: {
  template: ReportCustomTemplate
  onUse: () => void
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="border-b bg-red-50/50 dark:bg-red-950/20 px-4 py-5 flex items-center justify-center">
        <div className="flex h-14 w-11 flex-col items-center justify-end rounded-sm border border-red-200 bg-white shadow-sm dark:border-red-900 dark:bg-zinc-900">
          <div className="mb-1 flex h-7 w-full items-center justify-center bg-red-50 dark:bg-red-950/40">
            <LayoutTemplate className="h-4 w-4 text-red-400" strokeWidth={1.5} />
          </div>
          <span className="mb-1 rounded-sm bg-red-500 px-1.5 py-0.5 text-[9px] font-medium leading-none text-white">自定义</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground leading-snug">{template.name}</h3>
        <p className="mt-1.5 flex-1 text-xs leading-relaxed text-zinc-400">
          {template.elements.length} 个组件 · {template.inputs.length} 项用户输入
          {template.inputs.length > 0 && `（${template.inputs.map((i) => i.label).join("、")}）`}
        </p>
        <div className="mt-3 flex items-center justify-center border-t pt-3 text-xs">
          <button type="button" onClick={onUse} className="text-red-600 hover:text-red-700 dark:text-red-400 font-medium">
            使用模板
          </button>
        </div>
      </div>
    </div>
  )
}
