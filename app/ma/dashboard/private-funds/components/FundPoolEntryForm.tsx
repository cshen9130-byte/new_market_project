"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ChevronDown, CloudUpload, Inbox, Search, Trash2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { InstructionSubmitSuccess } from "./InstructionSubmitSuccess"
import {
  addInstructionRecord,
  type InstructionRecord,
} from "./instructions-store"

type FundOption = {
  beian_hao: string
  product_name: string
  display_name: string
  manager: string
  inception_date: string | null
}

const FUND_TYPE_OPTIONS = ["私募基金"] as const

const SELECTED_COLUMNS = ["序号", "基金名称", "管理人/基金公司", "成立日期", "操作"] as const

function shortFundDisplayName(productName: string): string {
  const trimmed = productName.trim()
  const short = trimmed
    .replace(/私募证券投资基金/g, "")
    .replace(/证券投资基金/g, "")
    .replace(/私募基金/g, "")
    .trim()
  return short || trimmed
}

function parseFundOptions(json: unknown): FundOption[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: FundOption[] = []
  for (const row of data as {
    beian_hao?: string
    product_name?: string
    short_name?: string | null
    manager?: string | null
    inception_date?: string | null
  }[]) {
    if (!row.product_name || !row.beian_hao) continue
    const display = (row.short_name || "").trim() || shortFundDisplayName(row.product_name)
    out.push({
      beian_hao: row.beian_hao,
      product_name: row.product_name,
      display_name: display,
      manager: (row.manager || "").trim() || "—",
      inception_date: row.inception_date ? String(row.inception_date).slice(0, 10) : null,
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

type PoolInstructionType = "基金入池" | "基金出池"

export function FundPoolEntryForm({
  onBack,
  instructionType = "基金入池",
}: {
  onBack: () => void
  instructionType?: PoolInstructionType
}) {
  const { toast } = useToast()
  const pageTitle = instructionType

  const [submittedRecord, setSubmittedRecord] = useState<InstructionRecord | null>(null)
  const [summary, setSummary] = useState("")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [fundType, setFundType] = useState<(typeof FUND_TYPE_OPTIONS)[number]>("私募基金")
  const [fundInput, setFundInput] = useState("")
  const [fundOptions, setFundOptions] = useState<FundOption[]>([])
  const [fundShow, setFundShow] = useState(false)
  const [fundLoading, setFundLoading] = useState(false)
  const [selectedFunds, setSelectedFunds] = useState<FundOption[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const fundWrapRef = useRef<HTMLDivElement>(null)
  const fundSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!fundShow) return
    if (fundSearchRef.current) clearTimeout(fundSearchRef.current)
    fundSearchRef.current = setTimeout(() => {
      const q = fundInput.trim()
      setFundLoading(true)
      const params = new URLSearchParams({ page: "1" })
      if (q) params.set("keyword", q)
      fetch(`/ma/api/private-funds/list?${params}`)
        .then((r) => r.json())
        .then((d) => setFundOptions(parseFundOptions(d)))
        .catch(() => setFundOptions([]))
        .finally(() => setFundLoading(false))
    }, 150)
    return () => {
      if (fundSearchRef.current) clearTimeout(fundSearchRef.current)
    }
  }, [fundInput, fundShow])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!fundWrapRef.current?.contains(e.target as Node)) setFundShow(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  function addFund(opt: FundOption) {
    setSelectedFunds((prev) => {
      if (prev.some((f) => f.beian_hao === opt.beian_hao)) return prev
      return [...prev, opt]
    })
    setFundInput("")
    setFundShow(false)
  }

  function removeFund(beianHao: string) {
    setSelectedFunds((prev) => prev.filter((f) => f.beian_hao !== beianHao))
  }

  function resetForm() {
    setSummary("")
    setAttachment(null)
    setDragOver(false)
    setFundType("私募基金")
    setFundInput("")
    setFundOptions([])
    setFundShow(false)
    setSelectedFunds([])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleSubmit() {
    if (selectedFunds.length === 0) {
      toast({ title: "请选择基金", variant: "destructive" })
      return
    }

    setSubmitting(true)
    try {
      const names = selectedFunds.map((f) => f.display_name || f.product_name).join("、")
      const codes = selectedFunds.map((f) => f.beian_hao).join(",")
      const record = await addInstructionRecord({
        category: "pool",
        type: instructionType,
        fofFundName: selectedFunds[0]?.manager ?? "",
        fofBeianHao: "",
        underlyingFundName: names,
        underlyingBeianHao: codes,
        applyDate: new Date().toISOString().slice(0, 10),
        amount: "—",
        summary: summary.trim(),
      })
      setSubmittedRecord(record)
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
      <div className="relative flex items-center justify-center border-b border-zinc-200 pb-3 dark:border-zinc-800">
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
            <span className="text-sm font-medium text-red-500">{instructionType}</span>
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
          <div className="flex items-center gap-2">
            <span className="h-4 w-1 rounded-sm bg-red-500" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-foreground">已选基金</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              <span className="mr-0.5 text-red-500">*</span>选择基金:
            </span>
            <div className="relative">
              <select
                value={fundType}
                onChange={(e) => setFundType(e.target.value as (typeof FUND_TYPE_OPTIONS)[number])}
                className="h-9 appearance-none rounded border border-border bg-background pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {FUND_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            </div>
            <div ref={fundWrapRef} className="relative w-[260px] min-w-0">
              <div className="relative">
                <input
                  type="text"
                  value={fundInput}
                  onChange={(e) => {
                    setFundInput(e.target.value)
                    setFundShow(true)
                  }}
                  onFocus={() => setFundShow(true)}
                  onClick={() => setFundShow(true)}
                  placeholder="输入名称/备案号/代码选择"
                  className={[
                    "h-9 w-full rounded border bg-background px-3 pr-9 text-sm outline-none placeholder:text-muted-foreground/50",
                    fundShow
                      ? "border-red-400 ring-1 ring-red-400/60"
                      : "border-border focus:border-red-400 focus:ring-1 focus:ring-red-400/60",
                  ].join(" ")}
                />
                <Search className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              </div>
              {fundShow && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded border border-zinc-200 bg-background shadow-lg dark:border-zinc-700">
                  {fundLoading && fundOptions.length === 0 ? (
                    <div className="px-3 py-2.5 text-sm text-zinc-400">加载中…</div>
                  ) : fundOptions.length === 0 ? (
                    <div className="px-3 py-2.5 text-sm text-zinc-400">暂无基金</div>
                  ) : (
                    fundOptions.map((opt) => {
                      const already = selectedFunds.some((f) => f.beian_hao === opt.beian_hao)
                      return (
                        <button
                          key={opt.beian_hao}
                          type="button"
                          disabled={already}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => addFund(opt)}
                          className={[
                            "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors",
                            already
                              ? "cursor-not-allowed bg-zinc-50 text-zinc-400 dark:bg-zinc-900/40"
                              : "hover:bg-muted text-zinc-700 dark:text-zinc-200",
                          ].join(" ")}
                        >
                          <span className="truncate">{opt.display_name}</span>
                          <span className="truncate text-xs text-zinc-400">
                            {opt.beian_hao}
                            {opt.manager && opt.manager !== "—" ? ` · ${opt.manager}` : ""}
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
                  description: "请通过搜索逐一添加基金，批量选择即将支持。",
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
              {selectedFunds.length === 0 ? (
                <tr>
                  <td colSpan={SELECTED_COLUMNS.length} className="py-14">
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />
                      <span className="text-sm">暂无数据</span>
                    </div>
                  </td>
                </tr>
              ) : (
                selectedFunds.map((fund, i) => (
                  <tr
                    key={fund.beian_hao}
                    className="border-t border-zinc-100 hover:bg-muted/30 dark:border-zinc-800"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 text-center text-zinc-700 dark:text-zinc-200">
                      {i + 1}
                    </td>
                    <td className="px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      <div className="max-w-[280px] truncate" title={fund.product_name}>
                        {fund.display_name || fund.product_name}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      {fund.manager}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700 dark:text-zinc-200">
                      {fund.inception_date || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => removeFund(fund.beian_hao)}
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
