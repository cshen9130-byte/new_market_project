"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, FileSearch, Loader2, X } from "lucide-react"
import { fundElementSourceKindLabel } from "@/lib/ma/fund-element-source-file"
import { cn } from "@/lib/utils"

export type ExtractedFundElements = {
  fund_name: string | null
  register_number: string | null
  advisor: string | null
  fund_manager: string | null
  inception_date: string | null
  puton_date: string | null
  custodian: string | null
  open_day: string | null
  is_temporary_open: string | null
  fee_purchase: string | null
  add_amount: string | null
  fee_redeem: string | null
  precautious_line: string | null
  closed_period: string | null
  stop_line: string | null
  fee_manage_rate: string | null
  fee_trust: string | null
  fee_manage: string | null
  fee_admin_service: string | null
  fee_pay: string | null
  risk_level: string | null
  lock_period_desc: string | null
  fee_pay_formula: string | null
}

export type FundMatchCandidate = {
  beian_hao: string
  product_name: string
  short_name: string | null
}

export type ExtractJobStatus = "queued" | "extracting" | "applied" | "needs_review" | "failed"

export type InvestmentNoteExtractJob = {
  id: number
  original_filename: string
  status: ExtractJobStatus
  beian_hao: string | null
  product_name: string | null
  extracted_json: ExtractedFundElements | null
  matched_funds: FundMatchCandidate[] | null
  applied_fields: string[] | null
  error_message: string | null
}

const SUBSCRIPTION_KEYS: Array<keyof ExtractedFundElements> = [
  "open_day",
  "is_temporary_open",
  "fee_purchase",
  "add_amount",
  "fee_redeem",
  "precautious_line",
  "closed_period",
  "stop_line",
  "fee_manage_rate",
  "fee_trust",
  "fee_manage",
  "fee_admin_service",
  "fee_pay",
  "risk_level",
  "lock_period_desc",
  "fee_pay_formula",
]

const FIELD_LABELS: Record<keyof ExtractedFundElements, string> = {
  fund_name: "产品全称",
  register_number: "备案编号",
  advisor: "投资顾问",
  fund_manager: "基金管理人",
  inception_date: "成立日期",
  puton_date: "备案日期",
  custodian: "托管券商",
  open_day: "开放日",
  is_temporary_open: "临开信息",
  fee_purchase: "申购费",
  add_amount: "追加限制",
  fee_redeem: "赎回费",
  precautious_line: "预警线",
  closed_period: "封闭期",
  stop_line: "平仓线",
  fee_manage_rate: "管理费率",
  fee_trust: "托管费",
  fee_manage: "管理费说明",
  fee_admin_service: "外包费",
  fee_pay: "业绩报酬说明",
  risk_level: "风险等级",
  lock_period_desc: "锁定期说明",
  fee_pay_formula: "业绩报酬公式",
}

const STATUS_LABEL: Record<ExtractJobStatus, string> = {
  queued: "排队中",
  extracting: "提取中",
  applied: "已写入",
  needs_review: "待确认",
  failed: "失败",
}

function statusClass(status: ExtractJobStatus) {
  if (status === "applied") return "bg-emerald-50 text-emerald-800 border-emerald-200"
  if (status === "needs_review") return "bg-amber-50 text-amber-800 border-amber-200"
  if (status === "failed") return "bg-red-50 text-red-700 border-red-200"
  if (status === "extracting") return "bg-blue-50 text-blue-800 border-blue-200"
  return "bg-zinc-50 text-zinc-500 border-zinc-200"
}

export function parseExtractJob(raw: unknown): InvestmentNoteExtractJob | null {
  if (!raw || typeof raw !== "object") return null
  const row = raw as Partial<InvestmentNoteExtractJob>
  const id = Number(row.id)
  if (!Number.isFinite(id) || id <= 0) return null
  const status = row.status
  if (
    status !== "queued" &&
    status !== "extracting" &&
    status !== "applied" &&
    status !== "needs_review" &&
    status !== "failed"
  ) {
    return null
  }
  return {
    id,
    original_filename: String(row.original_filename || "未命名文件"),
    status,
    beian_hao: row.beian_hao ?? null,
    product_name: row.product_name ?? null,
    extracted_json: row.extracted_json ?? null,
    matched_funds: Array.isArray(row.matched_funds) ? row.matched_funds : null,
    applied_fields: Array.isArray(row.applied_fields) ? row.applied_fields : null,
    error_message: row.error_message ?? null,
  }
}

function writableFields(extracted: ExtractedFundElements | null): Array<keyof ExtractedFundElements> {
  if (!extracted) return []
  return SUBSCRIPTION_KEYS.filter((key) => extracted[key]?.trim())
}

function productProfileUrl(beianHao: string) {
  return `/ma/dashboard/private-funds/${encodeURIComponent(beianHao)}?tab=profile`
}

export function InvestmentNoteElementExtractPanel({
  jobs,
  onJobsChange,
}: {
  jobs: InvestmentNoteExtractJob[]
  onJobsChange: (next: InvestmentNoteExtractJob[]) => void
}) {
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [fundInput, setFundInput] = useState("")
  const [selectedFund, setSelectedFund] = useState<FundMatchCandidate | null>(null)
  const [fundOptions, setFundOptions] = useState<FundMatchCandidate[]>([])
  const [fundShowDropdown, setFundShowDropdown] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyMessage, setApplyMessage] = useState<string | null>(null)

  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  const onJobsChangeRef = useRef(onJobsChange)
  onJobsChangeRef.current = onJobsChange
  const idsKey = jobs.map((job) => job.id).join(",")
  const busy = jobs.some((job) => job.status === "queued" || job.status === "extracting")
  const activeJob = useMemo(
    () => jobs.find((job) => job.id === activeId) ?? null,
    [jobs, activeId],
  )

  useEffect(() => {
    if (!idsKey) return
    let cancelled = false

    async function refresh() {
      try {
        const res = await fetch(`/ma/api/ops/fund-elements/jobs?ids=${encodeURIComponent(idsKey)}&limit=200`)
        const json = await res.json()
        if (!res.ok || json.error || cancelled) return
        const rows = Array.isArray(json.rows)
          ? json.rows.map(parseExtractJob).filter((row): row is InvestmentNoteExtractJob => Boolean(row))
          : []
        if (!rows.length) return
        const byId = new Map(rows.map((row) => [row.id, row]))
        onJobsChangeRef.current(jobsRef.current.map((job) => byId.get(job.id) ?? job))
      } catch {
        // keep last known status
      }
    }

    void refresh()
    const timer = setInterval(() => {
      if (jobsRef.current.some((job) => job.status === "queued" || job.status === "extracting")) {
        void refresh()
      }
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [idsKey])

  useEffect(() => {
    if (!activeJob) {
      setSelectedFund(null)
      setFundInput("")
      setApplyMessage(null)
      return
    }
    const matched = activeJob.matched_funds ?? []
    const existing =
      (activeJob.beian_hao
        ? matched.find((fund) => fund.beian_hao === activeJob.beian_hao)
        : null) ?? matched[0] ?? null
    setSelectedFund(existing)
    setFundInput(existing?.product_name || activeJob.product_name || activeJob.extracted_json?.fund_name || "")
    setApplyMessage(activeJob.error_message)
  }, [activeJob?.id, activeJob?.status])

  useEffect(() => {
    if (activeId) return
    const review = jobs.find((job) => job.status === "needs_review")
    if (review) setActiveId(review.id)
  }, [jobs, activeId])

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current)
    const q = fundInput.trim()
    if (!q || activeJob?.status === "applied") {
      setFundOptions([])
      return
    }
    searchRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/ma/api/tracking-funds/search?q=${encodeURIComponent(q)}`)
        const json = await res.json()
        setFundOptions(Array.isArray(json) ? json : [])
        setFundShowDropdown(true)
      } catch {
        setFundOptions([])
      }
    }, 250)
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current)
    }
  }, [fundInput, activeJob?.status])

  const fields = writableFields(activeJob?.extracted_json ?? null)

  async function handleApply() {
    if (!activeJob || !selectedFund) return
    const extracted = activeJob.extracted_json
    const payload: Record<string, string | null> = {}
    for (const key of fields) {
      const value = extracted?.[key]
      if (!value?.trim()) continue
      payload[key] = value
    }
    setApplying(true)
    setApplyMessage(null)
    try {
      const res = await fetch(`/ma/api/ops/fund-elements/jobs/${activeJob.id}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beian_hao: selectedFund.beian_hao,
          product_name: selectedFund.product_name,
          fields: payload,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || "写入失败")
      const updated = parseExtractJob(json.data)
      onJobsChange(jobs.map((job) => (job.id === activeJob.id ? updated ?? { ...job, status: "applied" } : job)))
      setApplyMessage(`已写入 ${Object.keys(payload).length} 个字段`)
    } catch (err) {
      setApplyMessage(err instanceof Error ? err.message : "写入失败")
    } finally {
      setApplying(false)
    }
  }

  if (!jobs.length) return null

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-800">
          <FileSearch className="h-4 w-4 text-red-500" />
          产品要素提取
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-red-500" /> : null}
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/ma/dashboard/private-funds?tab=operations&side=ops-element-extract"
            className="text-xs text-sky-600 hover:underline"
          >
            打开运维要素提取
          </a>
          <button
            type="button"
            onClick={() => onJobsChange([])}
            className="text-zinc-400 hover:text-zinc-700"
            aria-label="关闭提取面板"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-1">
        {jobs.map((job) => {
          const kind = fundElementSourceKindLabel(job.original_filename)
          return (
            <button
              key={job.id}
              type="button"
              onClick={() => setActiveId(job.id === activeId ? null : job.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md border bg-white px-3 py-2 text-left text-xs transition-colors",
                activeId === job.id ? "border-red-300" : "border-zinc-200 hover:border-zinc-300",
              )}
            >
              <span className={cn("shrink-0 rounded-full border px-2 py-0.5", statusClass(job.status))}>
                {STATUS_LABEL[job.status]}
              </span>
              {kind ? <span className="shrink-0 text-zinc-400">{kind}</span> : null}
              <span className="min-w-0 flex-1 truncate text-zinc-700" title={job.original_filename}>
                {job.original_filename}
              </span>
              <span className="shrink-0 text-zinc-400">
                {job.status === "applied"
                  ? job.product_name
                    ? `已写入 ${job.product_name}`
                    : `已写入 ${job.applied_fields?.length ?? 0} 项`
                  : job.status === "needs_review"
                    ? job.error_message || "请确认产品后写入"
                    : job.error_message || ""}
              </span>
            </button>
          )
        })}
      </div>

      {activeJob?.extracted_json && activeJob.status !== "queued" && activeJob.status !== "extracting" ? (
        <div className="rounded-md border bg-white p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            {activeJob.status === "needs_review" ? "确认目标产品后写入" : "提取结果"}
          </div>
          {activeJob.extracted_json.fund_name || activeJob.extracted_json.register_number ? (
            <div className="text-xs text-zinc-500">
              {activeJob.extracted_json.fund_name || "未识别产品名"}
              {activeJob.extracted_json.register_number
                ? ` · ${activeJob.extracted_json.register_number}`
                : ""}
            </div>
          ) : null}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="relative">
              <label className="text-xs text-zinc-500">搜索基金</label>
              <input
                value={fundInput}
                onChange={(e) => {
                  setFundInput(e.target.value)
                  setSelectedFund(null)
                }}
                onFocus={() => setFundShowDropdown(true)}
                placeholder="输入产品名称或备案号"
                disabled={activeJob.status === "applied"}
                className="mt-1 w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
              />
              {fundShowDropdown && fundOptions.length > 0 && activeJob.status !== "applied" ? (
                <div className="absolute z-20 mt-1 w-full rounded border bg-white shadow-lg max-h-56 overflow-y-auto">
                  {fundOptions.map((opt) => (
                    <button
                      key={opt.beian_hao}
                      type="button"
                      onClick={() => {
                        setSelectedFund(opt)
                        setFundInput(opt.product_name)
                        setFundShowDropdown(false)
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-50"
                    >
                      <div>{opt.product_name}</div>
                      <div className="text-xs text-zinc-400">{opt.beian_hao}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div>
              <label className="text-xs text-zinc-500">系统推荐匹配</label>
              <div className="mt-1 flex flex-wrap gap-2">
                {(activeJob.matched_funds ?? []).length === 0 ? (
                  <span className="text-sm text-zinc-400">未找到自动匹配，请手动搜索</span>
                ) : (
                  (activeJob.matched_funds ?? []).map((fund) => (
                    <button
                      key={fund.beian_hao}
                      type="button"
                      disabled={activeJob.status === "applied"}
                      onClick={() => {
                        setSelectedFund(fund)
                        setFundInput(fund.product_name)
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        selectedFund?.beian_hao === fund.beian_hao
                          ? "border-red-400 text-red-600 bg-red-50"
                          : "hover:border-red-300 hover:text-red-500",
                      )}
                    >
                      {fund.product_name}
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {selectedFund ? (
            <div className="rounded bg-zinc-50 px-3 py-2 text-sm">
              当前目标：<span className="font-medium">{selectedFund.product_name}</span>
              <span className="ml-2 text-zinc-400">{selectedFund.beian_hao}</span>
              <a
                href={productProfileUrl(selectedFund.beian_hao)}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-3 text-xs text-sky-600 hover:underline"
              >
                查看产品
              </a>
            </div>
          ) : null}

          {fields.length > 0 ? (
            <div className="text-xs text-zinc-500">
              将写入：{fields.map((key) => FIELD_LABELS[key]).join("、")}
            </div>
          ) : (
            <div className="text-xs text-amber-700">未能抽出申赎字段，仍可保存文件到产品资料。</div>
          )}

          {applyMessage ? <div className="text-xs text-zinc-600">{applyMessage}</div> : null}

          {activeJob.status !== "applied" ? (
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={!selectedFund || applying}
              className="inline-flex items-center gap-2 rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
            >
              {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {applying ? "写入中…" : fields.length > 0 ? `写入 ${fields.length} 个字段` : "仅保存到产品"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
