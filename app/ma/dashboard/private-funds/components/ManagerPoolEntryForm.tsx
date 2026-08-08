"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, CloudUpload, Inbox, Search, Trash2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { InstructionSubmitSuccess } from "./InstructionSubmitSuccess"
import {
  addInstructionRecord,
  type InstructionRecord,
} from "./instructions-store"

type ManagerOption = {
  registration_no: string
  manager_name: string
  inception_date: string | null
  mgmt_scale: string | null
}

const SELECTED_COLUMNS = ["序号", "管理人名称", "登记编号", "成立日期", "操作"] as const

function parseManagerOptions(json: unknown): ManagerOption[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: ManagerOption[] = []
  for (const row of data as {
    registration_no?: string
    manager_name?: string
    inception_date?: string | null
    mgmt_scale?: string | null
  }[]) {
    if (!row.registration_no || !row.manager_name) continue
    out.push({
      registration_no: row.registration_no,
      manager_name: row.manager_name.trim(),
      inception_date: row.inception_date ? String(row.inception_date).slice(0, 10) : null,
      mgmt_scale: (row.mgmt_scale || "").trim() || null,
    })
  }
  return out
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="h-4 w-1 rounded-sm bg-red-500" aria-hidden="true" />
      <h3 className="text-sm font-semibold text-foreground">{children}</h3>
    </div>
  )
}

export function ManagerPoolEntryForm({ onBack }: { onBack: () => void }) {
  const { toast } = useToast()

  const [submittedRecord, setSubmittedRecord] = useState<InstructionRecord | null>(null)
  const [summary, setSummary] = useState("")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [managerInput, setManagerInput] = useState("")
  const [managerOptions, setManagerOptions] = useState<ManagerOption[]>([])
  const [managerShow, setManagerShow] = useState(false)
  const [managerLoading, setManagerLoading] = useState(false)
  const [selectedManagers, setSelectedManagers] = useState<ManagerOption[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const managerWrapRef = useRef<HTMLDivElement>(null)
  const managerSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!managerShow) return
    if (managerSearchRef.current) clearTimeout(managerSearchRef.current)
    managerSearchRef.current = setTimeout(() => {
      const q = managerInput.trim()
      setManagerLoading(true)
      const params = new URLSearchParams({ page: "1", pageSize: "20" })
      if (q) params.set("keyword", q)
      fetch(`/ma/api/private-fund-managers/list?${params}`)
        .then((r) => r.json())
        .then((d) => setManagerOptions(parseManagerOptions(d)))
        .catch(() => setManagerOptions([]))
        .finally(() => setManagerLoading(false))
    }, 150)
    return () => {
      if (managerSearchRef.current) clearTimeout(managerSearchRef.current)
    }
  }, [managerInput, managerShow])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!managerWrapRef.current?.contains(e.target as Node)) setManagerShow(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  function addManager(opt: ManagerOption) {
    setSelectedManagers((prev) => {
      if (prev.some((m) => m.registration_no === opt.registration_no)) return prev
      return [...prev, opt]
    })
    setManagerInput("")
    setManagerShow(false)
  }

  function removeManager(registrationNo: string) {
    setSelectedManagers((prev) => prev.filter((m) => m.registration_no !== registrationNo))
  }

  function resetForm() {
    setSummary("")
    setAttachment(null)
    setDragOver(false)
    setManagerInput("")
    setManagerOptions([])
    setManagerShow(false)
    setSelectedManagers([])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleSubmit() {
    if (selectedManagers.length === 0) {
      toast({ title: "请选择管理人", variant: "destructive" })
      return
    }

    setSubmitting(true)
    try {
      const names = selectedManagers.map((m) => m.manager_name).join("、")
      const codes = selectedManagers.map((m) => m.registration_no).join(",")
      const record = addInstructionRecord({
        category: "pool",
        type: "管理人入池",
        fofFundName: "",
        fofBeianHao: "",
        underlyingFundName: names,
        underlyingBeianHao: codes,
        applyDate: new Date().toISOString().slice(0, 10),
        amount: "—",
        summary: summary.trim(),
        progress: "待审批(2/3)",
      })
      setSubmittedRecord(record)
      resetForm()
    } catch {
      toast({ title: "提交失败", description: "请稍后重试", variant: "destructive" })
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
        <h2 className="text-base font-semibold text-foreground">管理人入池</h2>
      </div>

      <section className="rounded-md border border-zinc-200 bg-background px-5 py-5 dark:border-zinc-800">
        <div className="space-y-4">
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

          <div className="flex items-center gap-3">
            <FormLabel className="pt-0">指令类型:</FormLabel>
            <span className="text-sm font-medium text-red-500">管理人入池</span>
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
                  "flex h-28 w-full max-w-md flex-col items-center justify-center gap-2 rounded border border-dashed text-sm transition-colors",
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>已选管理人</SectionTitle>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              <span className="mr-0.5 text-red-500">*</span>选择管理人:
            </span>
            <div ref={managerWrapRef} className="relative w-[280px] min-w-0">
              <div className="relative">
                <input
                  type="text"
                  value={managerInput}
                  onChange={(e) => {
                    setManagerInput(e.target.value)
                    setManagerShow(true)
                  }}
                  onFocus={() => setManagerShow(true)}
                  onClick={() => setManagerShow(true)}
                  placeholder="输入名称/登记编号选择"
                  className={[
                    "h-9 w-full rounded border bg-background px-3 pr-9 text-sm outline-none placeholder:text-muted-foreground/50",
                    managerShow
                      ? "border-red-400 ring-1 ring-red-400/60"
                      : "border-border focus:border-red-400 focus:ring-1 focus:ring-red-400/60",
                  ].join(" ")}
                />
                <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              </div>
              {managerShow && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded border border-zinc-200 bg-background shadow-lg dark:border-zinc-700">
                  {managerLoading && managerOptions.length === 0 ? (
                    <div className="px-3 py-2.5 text-sm text-zinc-400">加载中…</div>
                  ) : managerOptions.length === 0 ? (
                    <div className="px-3 py-2.5 text-sm text-zinc-400">暂无管理人</div>
                  ) : (
                    managerOptions.map((opt) => {
                      const already = selectedManagers.some(
                        (m) => m.registration_no === opt.registration_no,
                      )
                      return (
                        <button
                          key={opt.registration_no}
                          type="button"
                          disabled={already}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => addManager(opt)}
                          className={[
                            "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors",
                            already
                              ? "cursor-not-allowed bg-zinc-50 text-zinc-400 dark:bg-zinc-900/40"
                              : "hover:bg-muted text-zinc-700 dark:text-zinc-200",
                          ].join(" ")}
                        >
                          <span className="truncate">{opt.manager_name}</span>
                          <span className="truncate text-xs text-zinc-400">
                            {opt.registration_no}
                            {opt.mgmt_scale ? ` · ${opt.mgmt_scale}` : ""}
                          </span>
                        </button>
                      )
                    })
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                toast({
                  title: "批量选择",
                  description: "请通过搜索逐一添加管理人，批量选择即将支持。",
                })
              }
              className="text-sm text-blue-500 hover:text-blue-600 hover:underline"
            >
              批量选择
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900/60">
                {SELECTED_COLUMNS.map((col) => (
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
              {selectedManagers.length === 0 ? (
                <tr>
                  <td colSpan={SELECTED_COLUMNS.length} className="py-14">
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />
                      <span className="text-sm">暂无数据</span>
                    </div>
                  </td>
                </tr>
              ) : (
                selectedManagers.map((manager, i) => (
                  <tr
                    key={manager.registration_no}
                    className="border-t border-zinc-100 hover:bg-muted/30 dark:border-zinc-800"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 text-center text-zinc-700 dark:text-zinc-200">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      <div className="max-w-[280px] truncate" title={manager.manager_name}>
                        {manager.manager_name}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      {manager.registration_no}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      {manager.inception_date || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeManager(manager.registration_no)}
                        className="inline-flex rounded p-0.5 text-zinc-400 hover:text-red-500"
                        title="移除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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
