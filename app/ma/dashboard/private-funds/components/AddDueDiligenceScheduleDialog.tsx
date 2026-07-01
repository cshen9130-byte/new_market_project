"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Image,
  Info,
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
import { Checkbox } from "@/components/ma/ui/checkbox"
import { RadioGroup, RadioGroupItem } from "@/components/ma/ui/radio-group"
import {
  defaultScheduleForm,
  type DueDiligenceScheduleForm,
} from "@/lib/ma/due-diligence-schedules"

const REMINDER_OPTIONS = [
  "不提醒",
  "开始时",
  "开始前5分钟",
  "开始前15分钟",
  "开始前30分钟",
  "开始前1小时",
  "开始前1天",
]

const PERSONNEL_OPTIONS = ["张三", "李四", "王五"]

type ManagerOption = {
  manager_name: string
  registration_no: string | null
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
  className = "",
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  className?: string
}) {
  return (
    <div className={["relative", className].join(" ")}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={[
          "h-9 w-full appearance-none rounded border border-zinc-200 bg-white pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring",
          value ? "text-zinc-700" : "text-zinc-400",
        ].join(" ")}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
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
        placeholder="搜索并选择机构"
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

function RichTextDescriptionField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
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
        placeholder="请输入内容..."
        rows={6}
        className="w-full resize-y border-0 bg-white px-3 py-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none"
      />
    </div>
  )
}

export function AddDueDiligenceScheduleDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  mode = "create",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit?: (data: DueDiligenceScheduleForm) => void
  initialData?: DueDiligenceScheduleForm | null
  mode?: "create" | "edit"
}) {
  const [form, setForm] = useState<DueDiligenceScheduleForm>(defaultScheduleForm)
  const [error, setError] = useState("")

  useEffect(() => {
    if (open) {
      setForm(initialData ?? defaultScheduleForm())
      setError("")
    }
  }, [open, initialData])

  function patch<K extends keyof DueDiligenceScheduleForm>(
    key: K,
    value: DueDiligenceScheduleForm[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit() {
    if (!form.title.trim()) {
      setError("请输入尽调标题")
      return
    }
    if (!form.institution.trim()) {
      setError("请选择尽调机构")
      return
    }
    if (!form.personnel) {
      setError("请选择尽调人员")
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
          <DialogTitle className="text-base font-semibold">
            {mode === "edit" ? "编辑日程" : "添加日程"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-5">
            <FormRow label="尽调标题" required>
              <input
                value={form.title}
                onChange={(e) => patch("title", e.target.value)}
                placeholder="请输入尽调标题"
                className="h-9 w-full rounded border border-zinc-200 bg-white px-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </FormRow>

            <FormRow label="尽调时间" required>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => patch("startDate", e.target.value)}
                  className="h-9 rounded border border-zinc-200 bg-white px-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <input
                  type="time"
                  value={form.startTime}
                  disabled={form.allDay}
                  onChange={(e) => patch("startTime", e.target.value)}
                  className="h-9 rounded border border-zinc-200 bg-white px-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring disabled:bg-zinc-50"
                />
                <span className="text-sm text-zinc-500">至</span>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => patch("endDate", e.target.value)}
                  className="h-9 rounded border border-zinc-200 bg-white px-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <input
                  type="time"
                  value={form.endTime}
                  disabled={form.allDay}
                  onChange={(e) => patch("endTime", e.target.value)}
                  className="h-9 rounded border border-zinc-200 bg-white px-2 text-sm text-zinc-700 focus:outline-none focus:ring-1 focus:ring-ring disabled:bg-zinc-50"
                />
                <label className="ml-1 inline-flex items-center gap-2 text-sm text-zinc-600 cursor-pointer select-none">
                  <Checkbox
                    checked={form.allDay}
                    onCheckedChange={(v) => patch("allDay", v === true)}
                  />
                  全天
                </label>
              </div>
            </FormRow>

            <FormRow label="尽调机构" required>
              <InstitutionSearchField
                value={form.institution}
                onChange={(v) => patch("institution", v)}
              />
            </FormRow>

            <FormRow label="尽调方式" required>
              <InlineRadio
                value={form.method}
                onChange={(v) => patch("method", v as "online" | "onsite")}
                options={[
                  { value: "online", label: "线上尽调" },
                  { value: "onsite", label: "实地尽调" },
                ]}
              />
            </FormRow>

            <FormRow label="尽调类型" required>
              <InlineRadio
                value={form.ddType}
                onChange={(v) => patch("ddType", v as "first" | "followup")}
                options={[
                  { value: "first", label: "首次尽调" },
                  { value: "followup", label: "后续尽调" },
                ]}
              />
            </FormRow>

            <FormRow label="尽调人员" required>
              <NativeSelect
                value={form.personnel}
                onChange={(v) => patch("personnel", v)}
                placeholder="请选择尽调人"
                options={PERSONNEL_OPTIONS}
              />
            </FormRow>

            <FormRow label="提示方式" required>
              <div className="flex flex-wrap items-center gap-3">
                <NativeSelect
                  value={form.reminder}
                  onChange={(v) => patch("reminder", v)}
                  options={REMINDER_OPTIONS}
                  className="w-40"
                />
                <InlineRadio
                  value={form.notifyMethod}
                  onChange={(v) => patch("notifyMethod", v as "browser" | "wechat")}
                  options={[
                    { value: "browser", label: "浏览器弹窗提示" },
                    { value: "wechat", label: "微信推送" },
                  ]}
                />
                <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                  <Info className="h-3.5 w-3.5" />
                  若未绑定微信，请点击
                  <button type="button" className="text-red-500 hover:underline">去绑定</button>
                </span>
              </div>
            </FormRow>

            <FormRow label="尽调对象">
              <input
                value={form.target}
                onChange={(e) => patch("target", e.target.value)}
                placeholder="请输入尽调对象"
                className="h-9 w-full rounded border border-zinc-200 bg-white px-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </FormRow>

            <FormRow label="推荐机构">
              <input
                value={form.recommender}
                onChange={(e) => patch("recommender", e.target.value)}
                placeholder="请输入推荐机构"
                className="h-9 w-full rounded border border-zinc-200 bg-white px-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </FormRow>

            <FormRow label="日程描述">
              <RichTextDescriptionField
                value={form.description}
                onChange={(v) => patch("description", v)}
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
