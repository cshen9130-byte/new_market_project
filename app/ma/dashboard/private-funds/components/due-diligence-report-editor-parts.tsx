"use client"

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CalendarDays,
  ChevronDown,
  FolderOpen,
  Italic,
  Link2,
  List,
  ListOrdered,
  Maximize2,
  Palette,
  Quote,
  Redo2,
  Table2,
  Type,
  Underline,
  Undo2,
  Video,
  X,
} from "lucide-react"
import type { ReactNode } from "react"

export const inputClass =
  "h-9 w-full rounded border border-zinc-200 px-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"

export function FieldLabel({ required, children }: { required?: boolean; children: ReactNode }) {
  return (
    <label className="w-24 shrink-0 text-sm text-zinc-600 text-right">
      {required && <span className="text-red-500 mr-0.5">*</span>}
      {children}
    </label>
  )
}

export function FormField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <FieldLabel required={required}>{label}</FieldLabel>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="h-4 w-1 rounded-full bg-red-500" />
      <h3 className="text-sm font-semibold text-zinc-800">{title}</h3>
    </div>
  )
}

export function RichTextEditor({
  value,
  onChange,
  label,
  rows = 6,
}: {
  value: string
  onChange: (v: string) => void
  label?: string
  rows?: number
}) {
  const toolbarItems = [
    Type, Quote, Bold, Underline, Italic, Palette, Type, List, ListOrdered,
    AlignLeft, AlignCenter, AlignRight, Link2, FolderOpen, Video, Table2, Undo2, Redo2, Maximize2,
  ]

  return (
    <div>
      {label && <div className="mb-2 text-sm text-zinc-600">{label}</div>}
      <div className="rounded border border-zinc-200 overflow-hidden bg-white">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50 px-2 py-1.5">
          <select className="mr-1 h-7 rounded border border-zinc-200 bg-white px-2 text-xs text-zinc-600">
            <option>Paragraph</option>
            <option>标题 1</option>
            <option>标题 2</option>
          </select>
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
          rows={rows}
          placeholder="请输入内容..."
          className="w-full resize-y border-0 bg-white px-3 py-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none"
        />
      </div>
    </div>
  )
}

export function UploadDropzone() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 px-6 py-10 text-center">
      <FolderOpen className="mx-auto h-10 w-10 text-red-500 mb-3" strokeWidth={1.5} />
      <p className="text-sm text-zinc-600">单击或拖动文件到此区域进行上传</p>
      <p className="mt-1 text-xs text-zinc-400">支持单个或批量上传</p>
    </div>
  )
}

export function EditorFooter({
  publishError,
  onPublish,
}: {
  publishError?: string
  onPublish: () => void
}) {
  return (
    <div className="flex-shrink-0 border-t bg-white px-6 py-4">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-2">
        {publishError && <p className="text-sm text-red-500">{publishError}</p>}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.close()}
            className="rounded border border-zinc-200 bg-white px-8 py-2 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            className="rounded border border-zinc-200 bg-white px-8 py-2 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            保存
          </button>
          <button
            type="button"
            onClick={onPublish}
            className="rounded bg-red-500 px-8 py-2 text-sm text-white hover:bg-red-600 transition-colors"
          >
            发布
          </button>
        </div>
      </div>
    </div>
  )
}

export function DateField({
  value,
  onChange,
  placeholder = "请选择日期",
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputClass} pr-9`}
      />
      <CalendarDays className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
    </div>
  )
}

export function SelectField({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} appearance-none pr-8`}
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

export function PersonTagField({
  value,
  onChange,
  placeholder = "请选择尽调人",
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 rounded border border-zinc-200 px-2 py-1.5">
      {value ? (
        <span className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-0.5 text-sm text-zinc-700">
          {value}
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-zinc-400 hover:text-zinc-600"
            aria-label="移除"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 min-w-[120px] border-0 bg-transparent text-sm focus:outline-none placeholder:text-zinc-400"
        />
      )}
    </div>
  )
}
