"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CheckCircle2,
  FileSearch,
  FileText,
  Loader2,
  PlusCircle,
  RefreshCw,
  Upload,
  X,
} from "lucide-react"

type ExtractedFundElements = {
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

type FundMatchCandidate = {
  beian_hao: string
  product_name: string
  short_name: string | null
}

type ElementKey = keyof ExtractedFundElements

type ExtractJobStatus = "queued" | "extracting" | "applied" | "needs_review" | "failed"

type ExtractJob = {
  id: number
  original_filename: string
  file_size: number
  uploaded_by: string
  uploaded_at: string
  status: ExtractJobStatus
  beian_hao: string | null
  product_name: string | null
  extracted_json: ExtractedFundElements | null
  matched_funds: FundMatchCandidate[] | null
  text_preview: string | null
  applied_fields: string[] | null
  error_message: string | null
  processed_at: string | null
  contract_material_id: number | null
}

type CoverageFilter = "all" | "missing_contract" | "has_contract" | "missing_beian" | "missing_elements"

type CoverageRow = {
  id?: string
  product_name: string
  beian_hao: string | null
  short_name: string | null
  has_contract: boolean
  has_elements: boolean
  missing_beian: boolean
}

type CoverageCounts = {
  total: number
  has_contract: number
  missing_contract: number
  missing_beian: number
  missing_elements: number
}

const BASIC_KEYS: ElementKey[] = [
  "fund_name",
  "register_number",
  "advisor",
  "fund_manager",
  "inception_date",
  "puton_date",
  "custodian",
]

const SUBSCRIPTION_KEYS: ElementKey[] = [
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

const FIELD_LABELS: Record<ElementKey, string> = {
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

const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
]
const SUPPORTED_FORMATS_TEXT =
  "PDF、Word (.doc/.docx)、Excel (.xls/.xlsx)、图片 (.png/.jpg/.jpeg/.gif/.webp/.bmp)"
const MAX_FILES = 100

const STATUS_LABEL: Record<ExtractJobStatus, string> = {
  queued: "排队中",
  extracting: "提取中",
  applied: "已写入",
  needs_review: "待确认",
  failed: "失败",
}

const JOB_STATUS_FILTERS: Array<ExtractJobStatus | "all"> = [
  "all",
  "queued",
  "extracting",
  "needs_review",
  "applied",
  "failed",
]

function isAcceptedContractFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}

function fileKey(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`
}

function displayValue(value: string | null | undefined) {
  const s = (value ?? "").trim()
  return s || "—"
}

function buildDefaultSelection(extracted: ExtractedFundElements | null): Record<ElementKey, boolean> {
  const out = {} as Record<ElementKey, boolean>
  for (const key of BASIC_KEYS) out[key] = false
  for (const key of SUBSCRIPTION_KEYS) out[key] = Boolean(extracted?.[key]?.trim())
  return out
}

function jobFileUrl(id: number, download = false) {
  const base = `/ma/api/ops/fund-elements/jobs/${id}/file`
  return download ? `${base}?download=1` : base
}

function productProfileUrl(beianHao: string) {
  return `/ma/dashboard/private-funds/${encodeURIComponent(beianHao)}?tab=profile`
}

function statusClass(status: ExtractJobStatus) {
  if (status === "applied") return "bg-emerald-50 text-emerald-800 border-emerald-200"
  if (status === "needs_review") return "bg-amber-50 text-amber-800 border-amber-200"
  if (status === "failed") return "bg-red-50 text-red-700 border-red-200"
  if (status === "extracting") return "bg-blue-50 text-blue-800 border-blue-200"
  return "bg-muted/40 text-muted-foreground border-border"
}

function isAbortError(err: unknown) {
  return err instanceof Error && err.name === "AbortError"
}

function rowMatchesQuery(row: CoverageRow, q: string) {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    row.product_name.toLowerCase().includes(needle) ||
    (row.beian_hao || "").toLowerCase().includes(needle) ||
    (row.short_name || "").toLowerCase().includes(needle)
  )
}

function rowMatchesFilter(row: CoverageRow, filter: CoverageFilter) {
  if (filter === "missing_contract") return !row.missing_beian && !row.has_contract
  if (filter === "has_contract") return row.has_contract
  if (filter === "missing_beian") return row.missing_beian
  if (filter === "missing_elements") return !row.has_elements
  return true
}

function userHeaders(): HeadersInit {
  try {
    const raw = localStorage.getItem("currentUser")
    if (!raw) return {}
    const user = JSON.parse(raw) as { id?: string; name?: string }
    const headers: Record<string, string> = {}
    if (user.id) headers["x-market-user-id"] = String(user.id)
    if (user.name) headers["x-market-user-name"] = encodeURIComponent(String(user.name))
    return headers
  } catch {
    return {}
  }
}

export function OperationsElementExtractBatchPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [files, setFiles] = useState<File[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [jobs, setJobs] = useState<ExtractJob[]>([])
  const [jobsTotal, setJobsTotal] = useState(0)
  const [jobStatus, setJobStatus] = useState<ExtractJobStatus | "all">("all")
  const [jobQuery, setJobQuery] = useState("")
  const [jobsLoading, setJobsLoading] = useState(false)
  const [activeJobId, setActiveJobId] = useState<number | null>(null)

  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>("missing_contract")
  const [coverageQuery, setCoverageQuery] = useState("")
  const [coverageHolding, setCoverageHolding] = useState(true)
  const [coverage, setCoverage] = useState<{ counts: CoverageCounts; rows: CoverageRow[]; total: number } | null>(null)
  const [coverageLoading, setCoverageLoading] = useState(false)

  const [fundInput, setFundInput] = useState("")
  const [selectedFund, setSelectedFund] = useState<FundMatchCandidate | null>(null)
  const [fundOptions, setFundOptions] = useState<FundMatchCandidate[]>([])
  const [fundShowDropdown, setFundShowDropdown] = useState(false)
  const [currentElements, setCurrentElements] = useState<ExtractedFundElements | null>(null)
  const [loadingCurrent, setLoadingCurrent] = useState(false)
  const [selectedFields, setSelectedFields] = useState<Record<ElementKey, boolean>>(buildDefaultSelection(null))
  const [applying, setApplying] = useState(false)
  const [applyMessage, setApplyMessage] = useState<string | null>(null)
  const [reextracting, setReextracting] = useState(false)
  const [reextractMessage, setReextractMessage] = useState<string | null>(null)

  const activeJob = useMemo(
    () => jobs.find((job) => job.id === activeJobId) ?? null,
    [jobs, activeJobId],
  )

  const busyJobs = jobs.some((job) => job.status === "queued" || job.status === "extracting")

  const loadJobs = useCallback(async () => {
    setJobsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("status", jobStatus)
      params.set("limit", "200")
      if (jobQuery.trim()) params.set("q", jobQuery.trim())
      const res = await fetch(`/ma/api/ops/fund-elements/jobs?${params}`)
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || "加载任务失败")
      setJobs(Array.isArray(json.rows) ? json.rows : [])
      setJobsTotal(Number(json.total) || 0)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "加载任务失败")
    } finally {
      setJobsLoading(false)
    }
  }, [jobStatus, jobQuery])

  const loadCoverage = useCallback(async (signal?: AbortSignal) => {
    setCoverageLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("filter", "all")
      params.set("holding", coverageHolding ? "1" : "0")
      params.set("limit", "500")
      const res = await fetch(`/ma/api/ops/fund-elements/fof-coverage?${params}`, { signal })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || "加载覆盖失败")
      setCoverage({
        counts: json.counts,
        rows: Array.isArray(json.rows) ? json.rows : [],
        total: Number(json.total) || 0,
      })
    } catch (err) {
      if (isAbortError(err) || signal?.aborted) return
      console.error(err)
    } finally {
      if (!signal?.aborted) setCoverageLoading(false)
    }
  }, [coverageHolding])

  const searchedRows = useMemo(() => {
    const q = coverageQuery.trim()
    const rows = coverage?.rows ?? []
    if (!q) return rows
    return rows.filter((row) => rowMatchesQuery(row, q))
  }, [coverage?.rows, coverageQuery])

  const counts = useMemo(() => {
    if (!coverage) return undefined
    return {
      total: searchedRows.length,
      has_contract: searchedRows.filter((row) => row.has_contract).length,
      missing_contract: searchedRows.filter((row) => !row.missing_beian && !row.has_contract).length,
      missing_beian: searchedRows.filter((row) => row.missing_beian).length,
      missing_elements: searchedRows.filter((row) => !row.has_elements).length,
    }
  }, [coverage, searchedRows])

  const visibleRows = useMemo(
    () => searchedRows.filter((row) => rowMatchesFilter(row, coverageFilter)),
    [searchedRows, coverageFilter],
  )

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  useEffect(() => {
    const ac = new AbortController()
    void loadCoverage(ac.signal)
    return () => ac.abort()
  }, [loadCoverage])

  useEffect(() => {
    if (!busyJobs) return
    const timer = setInterval(() => {
      void loadJobs()
    }, 3000)
    return () => clearInterval(timer)
  }, [busyJobs, loadJobs])

  useEffect(() => {
    if (!activeJob) {
      setSelectedFund(null)
      setFundInput("")
      setCurrentElements(null)
      setSelectedFields(buildDefaultSelection(null))
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
    setSelectedFields(buildDefaultSelection(activeJob.extracted_json))
    setApplyMessage(activeJob.error_message)
  }, [activeJob?.id, activeJob?.status])

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current)
    const q = fundInput.trim()
    if (!q) {
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
  }, [fundInput])

  useEffect(() => {
    const beian = selectedFund?.beian_hao
    if (!beian) {
      setCurrentElements(null)
      return
    }
    setLoadingCurrent(true)
    fetch(`/ma/api/ops/fund-elements?beian_hao=${encodeURIComponent(beian)}`)
      .then((r) => r.json())
      .then((data) => {
        setCurrentElements(data?.error ? null : (data as ExtractedFundElements))
      })
      .catch(() => setCurrentElements(null))
      .finally(() => setLoadingCurrent(false))
  }, [selectedFund?.beian_hao])

  function addFiles(incoming: File[]) {
    const accepted = incoming.filter(isAcceptedContractFile)
    const rejected = incoming.length - accepted.length
    if (rejected > 0) {
      setUploadError(`${rejected} 个文件格式不支持，仅支持 ${SUPPORTED_FORMATS_TEXT}`)
    } else {
      setUploadError(null)
    }
    if (!accepted.length) return
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey))
      const next = [...prev]
      for (const file of accepted) {
        const key = fileKey(file)
        if (seen.has(key)) continue
        if (next.length >= MAX_FILES) break
        seen.add(key)
        next.push(file)
      }
      return next
    })
  }

  async function handleUpload() {
    if (!files.length) {
      setUploadError("请先拖入或选择基金合同")
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      for (const file of files) form.append("files", file)
      const res = await fetch("/ma/api/ops/fund-elements/jobs", {
        method: "POST",
        body: form,
        headers: userHeaders(),
      })
      const json = await res.json()
      if (!res.ok && res.status !== 202) throw new Error(json.error || "上传失败")
      const failed = Array.isArray(json.errors) ? json.errors : []
      if (failed.length) {
        setUploadError(failed.map((row: { fileName: string; error: string }) => `${row.fileName}：${row.error}`).join("；"))
      }
      setFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ""
      await loadJobs()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上传失败")
    } finally {
      setUploading(false)
    }
  }

  async function handleRetry(id: number) {
    await fetch(`/ma/api/ops/fund-elements/jobs/${id}/retry`, { method: "POST" })
    await loadJobs()
  }

  async function handleReextractAll() {
    setReextracting(true)
    setReextractMessage(null)
    try {
      const res = await fetch("/ma/api/ops/fund-elements/jobs/reextract", { method: "POST" })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || "重新提取排队失败")
      setReextractMessage(json.message || "已开始重新提取")
      await Promise.all([loadJobs(), loadCoverage()])
    } catch (err) {
      setReextractMessage(err instanceof Error ? err.message : "重新提取排队失败")
    } finally {
      setReextracting(false)
    }
  }

  async function handleApply() {
    if (!activeJob || !selectedFund) return
    const payload: Record<string, string | null> = {}
    const extracted = activeJob.extracted_json
    if (!extracted) return
    for (const key of [...BASIC_KEYS, ...SUBSCRIPTION_KEYS]) {
      if (!selectedFields[key]) continue
      const value = extracted[key]
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
      setApplyMessage(`已写入并保存合同到「${selectedFund.product_name}」`)
      await Promise.all([loadJobs(), loadCoverage()])
    } catch (err) {
      setApplyMessage(err instanceof Error ? err.message : "写入失败")
    } finally {
      setApplying(false)
    }
  }

  const selectedCount = [...BASIC_KEYS, ...SUBSCRIPTION_KEYS].filter(
    (key) => selectedFields[key] && activeJob?.extracted_json?.[key]?.trim(),
  ).length

  function renderFieldTable(keys: ElementKey[], title: string) {
    const extracted = activeJob?.extracted_json
    const selectableKeys = keys.filter((key) => extracted?.[key]?.trim())
    const allSelected = selectableKeys.length > 0 && selectableKeys.every((key) => selectedFields[key])
    return (
      <div className="rounded-lg border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
          <span className="text-sm font-medium">{title}</span>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => {
                const next = { ...selectedFields }
                for (const key of keys) {
                  if (extracted?.[key]?.trim()) next[key] = e.target.checked
                }
                setSelectedFields(next)
              }}
              className="accent-red-500"
            />
            全选本组
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="border-b bg-muted/10 text-xs text-zinc-500">
                <th className="px-3 py-2 text-left w-10">写入</th>
                <th className="px-3 py-2 text-left w-28">字段</th>
                <th className="px-3 py-2 text-left">提取值</th>
                <th className="px-3 py-2 text-left">当前值</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {keys.map((key) => {
                const value = extracted?.[key] ?? null
                const disabled = !value?.trim()
                return (
                  <tr key={key}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={Boolean(selectedFields[key] && !disabled)}
                        onChange={(e) => setSelectedFields((prev) => ({ ...prev, [key]: e.target.checked }))}
                        className="accent-red-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-sm">{FIELD_LABELS[key]}</td>
                    <td className="px-3 py-2 text-sm">{displayValue(value)}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{displayValue(currentElements?.[key])}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium">FOF底层合同覆盖</div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={coverageHolding}
              onChange={(e) => setCoverageHolding(e.target.checked)}
              className="accent-red-500"
            />
            仅持仓中
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", "全部", counts?.total],
              ["missing_contract", "无合同", counts?.missing_contract],
              ["has_contract", "有合同", counts?.has_contract],
              ["missing_beian", "无备案号", counts?.missing_beian],
              ["missing_elements", "无要素", counts?.missing_elements],
            ] as Array<[CoverageFilter, string, number | undefined]>
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setCoverageFilter(key)}
              className={[
                "rounded-full border px-3 py-1 text-xs transition-colors",
                coverageFilter === key ? "border-red-400 text-red-600 bg-red-50" : "hover:border-red-300",
              ].join(" ")}
            >
              {label}{typeof count === "number" ? ` ${count}` : ""}
            </button>
          ))}
        </div>
        <input
          value={coverageQuery}
          onChange={(e) => setCoverageQuery(e.target.value)}
          placeholder="搜索产品名称 / 备案号"
          className="w-full max-w-md border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className={`rounded-lg border max-h-64 overflow-y-auto ${coverageLoading && coverage ? "opacity-60" : ""}`}>
          {coverageLoading && !coverage ? (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">加载覆盖情况…</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left">产品名称</th>
                  <th className="px-3 py-2 text-left">备案号</th>
                  <th className="px-3 py-2 text-left">合同</th>
                  <th className="px-3 py-2 text-left">要素</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visibleRows.map((row, index) => (
                  <tr key={row.id || `${row.beian_hao || row.product_name}-${index}`}>
                    <td className="px-3 py-2">{row.short_name || row.product_name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.beian_hao || "—"}</td>
                    <td className="px-3 py-2">
                      {row.missing_beian ? (
                        <span className="text-xs text-muted-foreground">无备案号</span>
                      ) : row.has_contract ? (
                        <span className="text-xs text-emerald-700">已关联</span>
                      ) : (
                        <span className="text-xs text-amber-700">待上传</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.has_elements ? (
                        <span className="text-xs text-emerald-700">有</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">无</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!coverageLoading && visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                      当前筛选下没有产品
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {coverage && coverage.total > coverage.rows.length && (
          <p className="text-xs text-muted-foreground">显示前 {coverage.rows.length} 条，共 {coverage.total} 条</p>
        )}
      </div>

      <div className="rounded-lg border p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Upload className="h-4 w-4 text-red-500" />
          批量入库
        </div>
        <div className="flex flex-col lg:flex-row gap-4">
          <div
            className={[
              "flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-lg py-10 cursor-pointer transition-colors",
              isDragOver ? "border-red-400 bg-red-50/50 dark:bg-red-950/20" : "border-border hover:bg-muted/30",
            ].join(" ")}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true) }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragOver(false)
              addFiles(Array.from(e.dataTransfer.files))
              if (fileInputRef.current) fileInputRef.current.value = ""
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <PlusCircle className="h-10 w-10 text-muted-foreground/40 mb-2" strokeWidth={1} />
            <span className="text-sm text-foreground mb-1">将文件拖到此处，或点击上传（可多选）</span>
            <span className="text-xs text-muted-foreground">
              支持 {SUPPORTED_FORMATS_TEXT}，单文件不超过 20MB，最多 {MAX_FILES} 份。上传后后台提取并写入空缺要素。
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.bmp"
              multiple
              className="sr-only"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []))
                if (fileInputRef.current) fileInputRef.current.value = ""
              }}
            />
          </div>
          <div className="lg:w-72 flex flex-col gap-3">
            <button
              type="button"
              onClick={handleUpload}
              disabled={!files.length || uploading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
              {uploading ? "入库中…" : files.length > 1 ? `上传 ${files.length} 份并后台提取` : "上传并后台提取"}
            </button>
            {files.length > 0 && (
              <button
                type="button"
                onClick={() => setFiles([])}
                disabled={uploading}
                className="px-4 py-2 rounded border text-sm hover:bg-muted transition-colors disabled:opacity-60"
              >
                清除待上传文件
              </button>
            )}
            {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
          </div>
        </div>
        {files.length > 0 && (
          <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
            {files.map((file, index) => (
              <div key={fileKey(file)} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate" title={file.name}>{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                  disabled={uploading}
                  className="text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium">提取任务 ({jobsTotal})</div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { void handleReextractAll() }}
              disabled={reextracting || busyJobs}
              className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              {reextracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}
              重新提取缺失要素
            </button>
            <button
              type="button"
              onClick={() => { void loadJobs(); void loadCoverage() }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${jobsLoading || busyJobs ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        </div>
        {reextractMessage && (
          <p className="text-xs text-muted-foreground">{reextractMessage}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {JOB_STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setJobStatus(status)}
              className={[
                "rounded-full border px-3 py-1 text-xs transition-colors",
                jobStatus === status ? "border-red-400 text-red-600 bg-red-50" : "hover:border-red-300",
              ].join(" ")}
            >
              {status === "all" ? "全部" : STATUS_LABEL[status]}
            </button>
          ))}
        </div>
        <input
          value={jobQuery}
          onChange={(e) => setJobQuery(e.target.value)}
          placeholder="搜索文件名 / 产品 / 备案号"
          className="w-full max-w-md border rounded px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b bg-muted/10 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left">文件</th>
                <th className="px-3 py-2 text-left">匹配产品</th>
                <th className="px-3 py-2 text-left">状态</th>
                <th className="px-3 py-2 text-left">时间</th>
                <th className="px-3 py-2 text-left">说明</th>
                <th className="px-3 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className={activeJobId === job.id ? "bg-red-50/40" : "cursor-pointer hover:bg-muted/20"}
                  onClick={() => setActiveJobId(job.id)}
                >
                  <td className="px-3 py-2 truncate max-w-[240px]">
                    <a
                      href={jobFileUrl(job.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:underline"
                      title={`查看 ${job.original_filename}`}
                    >
                      {job.original_filename}
                    </a>
                  </td>
                  <td className="px-3 py-2">
                    {job.product_name || "—"}
                    {job.beian_hao ? <div className="text-xs text-muted-foreground">{job.beian_hao}</div> : null}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${statusClass(job.status)}`}>
                      {STATUS_LABEL[job.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {(job.processed_at || job.uploaded_at || "").replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[240px]" title={job.error_message || ""}>
                    {job.status === "applied"
                      ? `已写入 ${job.applied_fields?.length ?? 0} 个空缺字段`
                      : job.error_message || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {job.beian_hao ? (
                        <a
                          href={productProfileUrl(job.beian_hao)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          查看
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground" title="尚未匹配产品">查看</span>
                      )}
                      <a
                        href={jobFileUrl(job.id, true)}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        下载
                      </a>
                      {(job.status === "failed" || job.status === "needs_review" || job.status === "applied") && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleRetry(job.id)
                          }}
                          className="text-xs text-red-600 hover:underline"
                        >
                          {job.status === "applied" ? "重新提取" : "重试"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!jobsLoading && jobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">暂无提取任务</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {activeJob?.extracted_json && (activeJob.status === "needs_review" || activeJob.status === "applied" || activeJob.status === "failed") && (
        <div className="space-y-4">
          <div className="rounded-lg border p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              {activeJob.status === "needs_review" ? "确认目标基金后写入" : "提取结果"}
              <a
                href={jobFileUrl(activeJob.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline font-normal truncate"
              >
                {activeJob.original_filename}
              </a>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="relative">
                <label className="text-xs text-muted-foreground">搜索基金</label>
                <input
                  value={fundInput}
                  onChange={(e) => {
                    setFundInput(e.target.value)
                    setSelectedFund(null)
                  }}
                  onFocus={() => setFundShowDropdown(true)}
                  placeholder="输入产品名称或备案号"
                  className="mt-1 w-full border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  disabled={activeJob.status === "applied"}
                />
                {fundShowDropdown && fundOptions.length > 0 && activeJob.status !== "applied" && (
                  <div className="absolute z-20 mt-1 w-full rounded border bg-background shadow-lg max-h-56 overflow-y-auto">
                    {fundOptions.map((opt) => (
                      <button
                        key={opt.beian_hao}
                        type="button"
                        onClick={() => {
                          setSelectedFund(opt)
                          setFundInput(opt.product_name)
                          setFundShowDropdown(false)
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50"
                      >
                        <div>{opt.product_name}</div>
                        <div className="text-xs text-muted-foreground">{opt.beian_hao}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground">系统推荐匹配</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(activeJob.matched_funds ?? []).length === 0 ? (
                    <span className="text-sm text-muted-foreground">未找到自动匹配，请手动搜索</span>
                  ) : (
                    (activeJob.matched_funds ?? []).map((fund) => (
                      <button
                        key={fund.beian_hao}
                        type="button"
                        onClick={() => {
                          setSelectedFund(fund)
                          setFundInput(fund.product_name)
                        }}
                        disabled={activeJob.status === "applied"}
                        className={[
                          "rounded-full border px-3 py-1 text-xs transition-colors",
                          selectedFund?.beian_hao === fund.beian_hao
                            ? "border-red-400 text-red-600 bg-red-50"
                            : "hover:border-red-300 hover:text-red-500",
                        ].join(" ")}
                      >
                        {fund.product_name}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
            {selectedFund && (
              <div className="rounded px-3 py-2 text-sm bg-muted/30">
                当前目标：<span className="font-medium">{selectedFund.product_name}</span>
                <span className="text-muted-foreground ml-2">{selectedFund.beian_hao}</span>
                <a
                  href={jobFileUrl(activeJob.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-3 text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                >
                  <FileText className="h-3 w-3" />
                  查看原件
                </a>
                {activeJob.contract_material_id && activeJob.beian_hao ? (
                  <a
                    href={`/ma/dashboard/private-funds/${encodeURIComponent(activeJob.beian_hao)}?tab=materials`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-3 text-xs text-blue-600 hover:underline"
                  >
                    产品资料
                  </a>
                ) : null}
              </div>
            )}
            {activeJob.text_preview && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">查看合同文本预览</summary>
                <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/20 p-3 max-h-40 overflow-y-auto">{activeJob.text_preview}</pre>
              </details>
            )}
          </div>

          {activeJob.status !== "applied" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium">提取结果预览</h2>
                  <p className="text-xs text-muted-foreground mt-1">勾选需要写入的字段。后台自动入库只会填空缺字段，不会覆盖已有要素。</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleApply()}
                  disabled={!selectedFund || applying || loadingCurrent}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
                >
                  {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {applying ? "写入中…" : selectedCount > 0 ? `写入 ${selectedCount} 个字段并保存合同` : "仅保存合同到产品"}
                </button>
              </div>
              {applyMessage && (
                <div className="rounded px-3 py-2 text-sm border bg-muted/20">{applyMessage}</div>
              )}
              {loadingCurrent ? (
                <div className="text-sm text-muted-foreground py-8 text-center">加载当前要素…</div>
              ) : (
                <>
                  {renderFieldTable(BASIC_KEYS, "基本信息")}
                  {renderFieldTable(SUBSCRIPTION_KEYS, "申赎信息")}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
