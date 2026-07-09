"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CalendarDays,
  ChevronDown,
  Image,
  Italic,
  Link2,
  List,
  ListOrdered,
  Palette,
  Redo2,
  Table2,
  Type,
  Underline,
  Undo2,
  Video,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ma/ui/radio-group"
import {
  defaultDueDiligenceTableRowData,
  type DueDiligenceTableRowData,
} from "@/lib/ma/due-diligence-table"
import { formatTableDate } from "@/lib/ma/due-diligence-table-to-calendar"
import {
  teamStrategyL1Options,
  teamStrategyL2Options,
  teamStrategyL3Options,
  type TeamStrategyNode,
} from "@/lib/ma/team-strategy-tree"

export type DueDiligenceTableRecordForm = DueDiligenceTableRowData & {
  /** ISO date YYYY-MM-DD for the date picker */
  ddDateIso: string
  representativeProductBeianHao?: string
}

type FundSearchResult = {
  beian_hao: string
  product_name: string
  short_name: string | null
}

type ManagerOption = {
  manager_name: string
  registration_no: string | null
}

const DD_METHOD_OPTIONS = [
  { value: "线上尽调", label: "线上尽调" },
  { value: "线下尽调", label: "线下尽调" },
]

export function defaultDueDiligenceTableRecordForm(): DueDiligenceTableRecordForm {
  return {
    ...defaultDueDiligenceTableRowData(),
    ddMethod: "线上尽调",
    ddDateIso: "",
    representativeProductBeianHao: undefined,
  }
}

function FieldLabel({
  required,
  children,
  className = "w-[5.5rem]",
}: {
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <label className={["shrink-0 text-sm text-zinc-600 text-right pt-2 leading-snug", className].join(" ")}>
      {required && <span className="text-red-500 mr-0.5">*</span>}
      {children}
    </label>
  )
}

function FormRow({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <FieldLabel required={required}>{label}</FieldLabel>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function NativeSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  className = "",
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={["relative", className].join(" ")}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "h-9 w-full appearance-none rounded border border-zinc-200 bg-white pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:bg-zinc-50 disabled:text-zinc-400",
          value ? "text-zinc-700" : "text-zinc-400",
        ].join(" ")}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt || "__empty__"} value={opt}>{opt || placeholder}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
    </div>
  )
}

function InlineRadio({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <RadioGroup value={value} onValueChange={onChange} className="flex flex-wrap items-center gap-5">
      {options.map((opt) => (
        <label key={opt.value} className="inline-flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
          <RadioGroupItem value={opt.value} />
          {opt.label}
        </label>
      ))}
    </RadioGroup>
  )
}

function PersonnelComboField({
  value,
  onChange,
  options,
  placeholder = "请输入或选择尽调人员",
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
}) {
  const [query, setQuery] = useState(value)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(value)
  }, [value])

  const filteredOptions = options.filter((opt) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return opt.toLowerCase().includes(q)
  })

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="h-9 w-full rounded border border-zinc-200 bg-white px-3 pr-8 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600"
        aria-label="选择尽调人员"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && filteredOptions.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-zinc-200 bg-white shadow-lg">
          {filteredOptions.map((opt) => (
            <button
              key={opt}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
              onClick={() => {
                setQuery(opt)
                onChange(opt)
                setOpen(false)
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="h-9 w-full rounded border border-zinc-200 bg-white px-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

function FormDateField({
  value,
  onChange,
}: {
  value: string
  onChange: (isoDate: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const displayValue = value ? formatTableDate(value) : ""

  return (
    <div className="relative w-[9.5rem]">
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => inputRef.current?.showPicker?.()}
        className={[
          "h-9 w-full rounded border border-zinc-200 bg-white pl-2 pr-8 text-sm text-transparent caret-transparent",
          "[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0",
          "[&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full",
          "[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
          "focus:outline-none focus:ring-1 focus:ring-ring",
        ].join(" ")}
      />
      {displayValue ? (
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-zinc-700">
          {displayValue}
        </span>
      ) : (
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
          选择日期
        </span>
      )}
      <CalendarDays className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
    </div>
  )
}

function InstitutionSearchField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<ManagerOption[]>([])
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
      fetch(`/ma/api/tracking-managers/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((d) => setOptions(Array.isArray(d) ? d : []))
        .catch(() => setOptions([]))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [open, query])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="搜索并选择基金公司"
        className="h-9 w-full rounded border border-zinc-200 bg-white px-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-zinc-200 bg-white shadow-lg">
          {options.map((opt) => {
            const label = opt.registration_no
              ? `${opt.manager_name}（${opt.registration_no}）`
              : opt.manager_name
            return (
              <button
                key={`${opt.manager_name}-${opt.registration_no ?? ""}`}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                onClick={() => {
                  setQuery(opt.manager_name)
                  onChange(opt.manager_name)
                  setOpen(false)
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ProductSearchField({
  value,
  linkedBeianHao,
  onChange,
}: {
  value: string
  linkedBeianHao?: string
  onChange: (value: string, link?: { beianHao: string } | null) => void
}) {
  const [query, setQuery] = useState(value)
  const [options, setOptions] = useState<FundSearchResult[]>([])
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
      fetch(`/ma/api/private-funds/products/search?q=${encodeURIComponent(query.trim())}&format=picker`)
        .then((r) => r.json())
        .then((d) => setOptions(Array.isArray(d) ? d : []))
        .catch(() => setOptions([]))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [open, query])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  return (
    <div ref={wrapRef} className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange(e.target.value, null)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="搜索并选择代表产品"
        className="h-9 w-full rounded border border-zinc-200 bg-white px-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {linkedBeianHao && (
        <p className="mt-1 text-xs text-emerald-600">已关联备案号：{linkedBeianHao}</p>
      )}
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-zinc-200 bg-white shadow-lg">
          {options.map((opt) => {
            const label = opt.short_name?.trim()
              ? `${opt.product_name}（${opt.short_name}）`
              : opt.product_name
            return (
              <button
                key={opt.beian_hao}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                onClick={() => {
                  setQuery(opt.product_name)
                  onChange(opt.product_name, { beianHao: opt.beian_hao })
                  setOpen(false)
                }}
              >
                <span className="block">{label}</span>
                <span className="block text-xs text-zinc-400">{opt.beian_hao}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RichTextArea({
  value,
  onChange,
  placeholder,
  rows = 6,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  const toolbarItems = [
    Bold, Underline, Italic, Palette, Type, AlignLeft, AlignCenter, AlignRight,
    List, ListOrdered, Link2, Image, Video, Table2, Undo2, Redo2,
  ]

  return (
    <div className="rounded border border-zinc-200 overflow-hidden bg-white">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5">
        {toolbarItems.map((Icon, index) => (
          <button
            key={index}
            type="button"
            className="rounded p-1.5 text-zinc-500 hover:bg-white hover:text-zinc-700 transition-colors"
            aria-label="格式"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y border-0 bg-white px-3 py-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none"
      />
    </div>
  )
}

export function AddDueDiligenceRecordDialog({
  open,
  onOpenChange,
  onSubmit,
  teamStrategyTree,
  personnelOptions = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit?: (data: DueDiligenceTableRecordForm) => void
  teamStrategyTree: TeamStrategyNode[]
  personnelOptions?: string[]
}) {
  const [form, setForm] = useState<DueDiligenceTableRecordForm>(defaultDueDiligenceTableRecordForm)
  const [error, setError] = useState("")

  const l1Options = teamStrategyL1Options(teamStrategyTree)
  const l2Options = teamStrategyL2Options(teamStrategyTree, form.strategyLevel1)
  const l3Options = teamStrategyL3Options(
    teamStrategyTree,
    form.strategyLevel1,
    form.strategyLevel2,
  )

  useEffect(() => {
    if (open) {
      setForm(defaultDueDiligenceTableRecordForm())
      setError("")
    }
  }, [open])

  function patch<K extends keyof DueDiligenceTableRecordForm>(
    key: K,
    value: DueDiligenceTableRecordForm[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit() {
    if (!form.fundCompany.trim() && !form.representativeProduct.trim()) {
      setError("请至少填写基金公司或代表产品")
      return
    }
    onSubmit?.(form)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] w-[760px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]"
        showCloseButton
      >
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="text-base font-semibold">添加记录</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-5">
            <FormRow label="尽调人员">
              <PersonnelComboField
                value={form.ddPersonnel}
                onChange={(v) => patch("ddPersonnel", v)}
                options={personnelOptions}
                placeholder="请输入或选择尽调人员"
              />
            </FormRow>

            <FormRow label="尽调日期">
              <div className="flex flex-wrap items-center gap-2">
                <FormDateField
                  value={form.ddDateIso}
                  onChange={(v) => patch("ddDateIso", v)}
                />
                <input
                  type="time"
                  value={form.ddTime}
                  onChange={(e) => patch("ddTime", e.target.value)}
                  className="h-9 rounded border border-zinc-200 bg-white px-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </FormRow>

            <FormRow label="尽调形式">
              <InlineRadio
                value={form.ddMethod || "线上尽调"}
                onChange={(v) => patch("ddMethod", v)}
                options={DD_METHOD_OPTIONS}
              />
            </FormRow>

            <FormRow label="尽调对象">
              <TextInput
                value={form.ddTarget}
                onChange={(v) => patch("ddTarget", v)}
                placeholder="请输入尽调对象"
              />
            </FormRow>

            <FormRow label="推荐人">
              <TextInput
                value={form.recommender}
                onChange={(v) => patch("recommender", v)}
                placeholder="请输入推荐人"
              />
            </FormRow>

            <FormRow label="策略初筛">
              <TextInput
                value={form.strategyPreliminary}
                onChange={(v) => patch("strategyPreliminary", v)}
                placeholder="请输入策略初筛"
              />
            </FormRow>

            <FormRow label="基金公司">
              <InstitutionSearchField
                value={form.fundCompany}
                onChange={(v) => patch("fundCompany", v)}
              />
            </FormRow>

            <FormRow label="投资经理">
              <TextInput
                value={form.investmentManager}
                onChange={(v) => patch("investmentManager", v)}
                placeholder="请输入投资经理"
              />
            </FormRow>

            <FormRow label="代表产品">
              <ProductSearchField
                value={form.representativeProduct}
                linkedBeianHao={form.representativeProductBeianHao}
                onChange={(value, link) => {
                  patch("representativeProduct", value)
                  if (link === null) {
                    patch("representativeProductBeianHao", undefined)
                  } else if (link) {
                    patch("representativeProductBeianHao", link.beianHao)
                  }
                }}
              />
            </FormRow>

            <FormRow label="一级策略">
              <NativeSelect
                value={form.strategyLevel1}
                onChange={(v) => {
                  setForm((prev) => ({
                    ...prev,
                    strategyLevel1: v,
                    strategyLevel2: "",
                    strategyLevel3: "",
                  }))
                }}
                placeholder="请选择一级策略"
                options={l1Options}
                disabled={l1Options.length === 0}
              />
            </FormRow>

            <FormRow label="二级策略">
              <NativeSelect
                value={form.strategyLevel2}
                onChange={(v) => {
                  setForm((prev) => ({
                    ...prev,
                    strategyLevel2: v,
                    strategyLevel3: "",
                  }))
                }}
                placeholder={form.strategyLevel1 ? "请选择二级策略" : "先选一级策略"}
                options={l2Options}
                disabled={!form.strategyLevel1}
              />
            </FormRow>

            <FormRow label="三级策略">
              <NativeSelect
                value={form.strategyLevel3}
                onChange={(v) => patch("strategyLevel3", v)}
                placeholder={
                  !form.strategyLevel1
                    ? "先选一级策略"
                    : !form.strategyLevel2
                      ? "先选二级策略"
                      : "请选择三级策略"
                }
                options={l3Options}
                disabled={!form.strategyLevel1 || !form.strategyLevel2}
              />
            </FormRow>

            <FormRow label="其他补充信息">
              <RichTextArea
                value={form.otherInfo}
                onChange={(v) => patch("otherInfo", v)}
                placeholder="请输入其他补充信息…"
                rows={4}
              />
            </FormRow>

            <FormRow label="尽调结论">
              <RichTextArea
                value={form.ddConclusion}
                onChange={(v) => patch("ddConclusion", v)}
                placeholder="请输入尽调结论…"
                rows={6}
              />
            </FormRow>

            {error && (
              <p className="text-sm text-red-500 pl-[calc(5.5rem+0.75rem)]">{error}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded border border-zinc-200 bg-white px-5 py-2 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded bg-red-500 px-5 py-2 text-sm text-white hover:bg-red-600 transition-colors"
          >
            确定
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function recordFormToRowData(form: DueDiligenceTableRecordForm): {
  data: DueDiligenceTableRowData
  representativeProductBeianHao?: string
} {
  const { ddDateIso, representativeProductBeianHao, ...rest } = form
  return {
    data: {
      ...rest,
      ddDate: ddDateIso ? formatTableDate(ddDateIso) : "",
    },
    representativeProductBeianHao,
  }
}
