"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CheckCircle2, FileSearch, FileText, Loader2, PlusCircle, Upload, X } from "lucide-react"

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
}

type FundMatchCandidate = {
  beian_hao: string
  product_name: string
  short_name: string | null
}

type ElementKey = keyof ExtractedFundElements

type ContractJob = {
  id: string
  fileName: string
  file: File | null
  extractStatus: "done" | "error"
  extractError?: string
  extracted: ExtractedFundElements | null
  matchedFunds: FundMatchCandidate[]
  textPreview: string
  fundInput: string
  selectedFund: FundMatchCandidate | null
  currentElements: ExtractedFundElements | null
  loadingCurrent: boolean
  currentLoadVersion: number
  selectedFields: Record<ElementKey, boolean>
  applyStatus: "idle" | "applying" | "done" | "error"
  applyMessage?: string
  contractSaveStatus: "idle" | "saving" | "done" | "error"
  contractSaveMessage?: string
  savedContractId?: number
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
const MAX_FILES = 20
const EXTRACT_CONCURRENCY = 2

function shareClassFromName(name: string): "A" | "B" | "C" | null {
  const m = name.match(/([ABC])类/u)
  return m ? (m[1] as "A" | "B" | "C") : null
}

function shareClassesAgree(productName: string, extractedName: string): boolean {
  const wanted = shareClassFromName(extractedName)
  const found = shareClassFromName(productName)
  if (wanted) return found === wanted
  return !found
}

function pickAutoSelectedFund(
  extracted: ExtractedFundElements,
  matchedFunds: FundMatchCandidate[],
): FundMatchCandidate | null {
  if (!matchedFunds.length) return null
  const extractedName = extracted.fund_name?.trim() ?? ""
  if (extractedName) {
    const exact = matchedFunds.find((fund) => fund.product_name.trim() === extractedName)
    if (exact) return exact
    const classMatch = matchedFunds.find((fund) => shareClassesAgree(fund.product_name, extractedName))
    if (classMatch) return classMatch
  }
  const register = extracted.register_number?.trim().toUpperCase()
  if (register) {
    const byRegister = matchedFunds.find((fund) => fund.beian_hao.toUpperCase() === register)
    if (byRegister) return byRegister
  }
  return matchedFunds[0] ?? null
}

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

function countSelectedFields(job: ContractJob): number {
  if (!job.extracted) return 0
  return Object.entries(job.selectedFields).filter(
    ([key, checked]) => checked && job.extracted?.[key as ElementKey]?.trim(),
  ).length
}

function buildApplyPayload(job: ContractJob): Record<string, string | null> | null {
  if (!job.selectedFund?.beian_hao || !job.extracted) return null
  const payload: Record<string, string | null> = { beian_hao: job.selectedFund.beian_hao }
  for (const key of [...BASIC_KEYS, ...SUBSCRIPTION_KEYS]) {
    if (!job.selectedFields[key]) continue
    const value = job.extracted[key]
    if (!value?.trim()) continue
    if (key === "custodian") payload.custodian = value
    else payload[key] = value
  }
  return Object.keys(payload).length > 1 ? payload : null
}

function FieldCompareRow({
  fieldKey,
  extracted,
  current,
  selected,
  onToggle,
}: {
  fieldKey: ElementKey
  extracted: string | null
  current: string | null
  selected: boolean
  onToggle: (checked: boolean) => void
}) {
  const extractedText = extracted?.trim() || ""
  const currentText = current?.trim() || ""
  const changed = extractedText && extractedText !== currentText
  const disabled = !extractedText

  return (
    <tr className={disabled ? "opacity-50" : undefined}>
      <td className="px-3 py-2 align-top">
        <input
          type="checkbox"
          checked={selected && !disabled}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="accent-red-500"
        />
      </td>
      <td className="px-3 py-2 text-sm text-zinc-600 whitespace-nowrap">{FIELD_LABELS[fieldKey]}</td>
      <td className="px-3 py-2 text-sm">{displayValue(extracted)}</td>
      <td className="px-3 py-2 text-sm text-muted-foreground">{displayValue(current)}</td>
      <td className="px-3 py-2 text-xs">
        {disabled ? (
          <span className="text-muted-foreground">未提取</span>
        ) : changed ? (
          <span className="text-amber-700">将更新</span>
        ) : currentText ? (
          <span className="text-emerald-700">一致</span>
        ) : (
          <span className="text-blue-700">新增</span>
        )}
      </td>
    </tr>
  )
}

export function OperationsElementExtractView() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentLoadRef = useRef(0)

  const [files, setFiles] = useState<File[]>([])
  const [jobs, setJobs] = useState<ContractJob[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractProgress, setExtractProgress] = useState({ done: 0, total: 0 })
  const [extractError, setExtractError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [fundOptions, setFundOptions] = useState<FundMatchCandidate[]>([])
  const [fundShowDropdown, setFundShowDropdown] = useState(false)
  const [fundSearchError, setFundSearchError] = useState<string | null>(null)
  const [batchApplying, setBatchApplying] = useState(false)

  const activeJob = useMemo(
    () => jobs.find((job) => job.id === activeJobId) ?? null,
    [jobs, activeJobId],
  )

  const selectedCount = activeJob ? countSelectedFields(activeJob) : 0
  const readyApplyJobs = useMemo(
    () => jobs.filter((job) => job.extractStatus === "done" && buildApplyPayload(job)),
    [jobs],
  )

  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current)
    const q = activeJob?.fundInput.trim()
    if (!q) {
      setFundOptions([])
      setFundSearchError(null)
      return
    }
    searchRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/ma/api/tracking-funds/search?q=${encodeURIComponent(q)}`)
        const json = await res.json()
        if (!res.ok || json?.error) {
          setFundOptions([])
          setFundSearchError("基金搜索失败，请稍后重试")
          return
        }
        const rows = Array.isArray(json) ? json : []
        setFundOptions(rows)
        setFundSearchError(rows.length === 0 ? "未找到匹配基金，可尝试输入备案号或「-」后的产品名" : null)
        setFundShowDropdown(true)
      } catch {
        setFundOptions([])
        setFundSearchError("基金搜索失败，请检查网络后重试")
      }
    }, 250)
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current)
    }
  }, [activeJob?.fundInput])

  useEffect(() => {
    const jobId = activeJob?.id
    const beian = activeJob?.selectedFund?.beian_hao
    if (!jobId || !beian) return

    const requestId = ++currentLoadRef.current
    updateJob(jobId, { loadingCurrent: true, currentElements: null })
    fetch(`/ma/api/ops/fund-elements?beian_hao=${encodeURIComponent(beian)}`)
      .then((r) => r.json())
      .then((data) => {
        if (requestId !== currentLoadRef.current) return
        updateJob(jobId, {
          currentElements: data?.error ? null : (data as ExtractedFundElements),
          loadingCurrent: false,
        })
      })
      .catch(() => {
        if (requestId !== currentLoadRef.current) return
        updateJob(jobId, { currentElements: null, loadingCurrent: false })
      })
  }, [activeJob?.id, activeJob?.selectedFund?.beian_hao, activeJob?.currentLoadVersion])

  function selectTargetFund(jobId: string, fund: FundMatchCandidate) {
    setJobs((prev) =>
      prev.map((job) =>
        job.id === jobId
          ? {
              ...job,
              selectedFund: fund,
              fundInput: fund.product_name,
              currentElements: null,
              loadingCurrent: true,
              currentLoadVersion: job.currentLoadVersion + 1,
            }
          : job,
      ),
    )
  }

  function updateJob(id: string, patch: Partial<ContractJob>) {
    setJobs((prev) => prev.map((job) => (job.id === id ? { ...job, ...patch } : job)))
  }

  function addFiles(incoming: File[]) {
    const accepted = incoming.filter(isAcceptedContractFile)
    const rejected = incoming.length - accepted.length
    if (rejected > 0) {
      setExtractError(`${rejected} 个文件格式不支持，仅支持 ${SUPPORTED_FORMATS_TEXT}`)
    } else {
      setExtractError(null)
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

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  function clearFiles() {
    setFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function clearAll() {
    clearFiles()
    setJobs([])
    setActiveJobId(null)
    setExtractError(null)
    setExtractProgress({ done: 0, total: 0 })
    setFundOptions([])
    setFundShowDropdown(false)
    setFundSearchError(null)
  }

  const hasWork = files.length > 0 || jobs.length > 0

  async function extractSingleFile(file: File): Promise<Omit<ContractJob, "id">> {
    const form = new FormData()
    form.append("file", file)
    const res = await fetch("/ma/api/ops/fund-elements/extract", { method: "POST", body: form })
    const json = await res.json()
    if (!res.ok || json.error) {
      return {
        fileName: file.name,
        file,
        extractStatus: "error",
        extractError: json.error || "要素提取失败",
        extracted: null,
        matchedFunds: [],
        textPreview: "",
        fundInput: "",
        selectedFund: null,
        currentElements: null,
        loadingCurrent: false,
        currentLoadVersion: 0,
        selectedFields: buildDefaultSelection(null),
        applyStatus: "idle",
        contractSaveStatus: "idle",
      }
    }

    const extracted = json.extracted as ExtractedFundElements
    const matchedFunds = Array.isArray(json.matched_funds) ? json.matched_funds as FundMatchCandidate[] : []
    const selectedFund = pickAutoSelectedFund(extracted, matchedFunds)

    return {
      fileName: file.name,
      file,
      extractStatus: "done",
      extracted,
      matchedFunds,
      textPreview: String(json.text_preview || ""),
      fundInput: extracted.fund_name?.trim() || selectedFund?.product_name || "",
      selectedFund,
      currentElements: null,
      loadingCurrent: Boolean(selectedFund),
      currentLoadVersion: selectedFund ? 1 : 0,
      selectedFields: buildDefaultSelection(extracted),
      applyStatus: "idle",
      contractSaveStatus: "idle",
    }
  }

  async function handleExtractAll() {
    if (!files.length) {
      setExtractError("请先上传基金合同")
      return
    }
    setExtracting(true)
    setExtractError(null)
    setExtractProgress({ done: 0, total: files.length })

    const queue = [...files]
    const nextJobs: ContractJob[] = []
    let done = 0

    async function worker() {
      while (queue.length) {
        const file = queue.shift()
        if (!file) break
        try {
          const result = await extractSingleFile(file)
          nextJobs.push({ ...result, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
        } catch (err) {
          nextJobs.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fileName: file.name,
            file,
            extractStatus: "error",
            extractError: err instanceof Error ? err.message : "要素提取失败",
            extracted: null,
            matchedFunds: [],
            textPreview: "",
            fundInput: "",
            selectedFund: null,
            currentElements: null,
            loadingCurrent: false,
            currentLoadVersion: 0,
            selectedFields: buildDefaultSelection(null),
            applyStatus: "idle",
            contractSaveStatus: "idle",
          })
        } finally {
          done += 1
          setExtractProgress({ done, total: files.length })
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(EXTRACT_CONCURRENCY, queue.length || 1) }, () => worker()))

    setJobs((prev) => [...prev, ...nextJobs])
    setActiveJobId((prev) => prev ?? nextJobs.find((job) => job.extractStatus === "done")?.id ?? nextJobs[0]?.id ?? null)
    clearFiles()
    setExtracting(false)
  }

  function toggleField(key: ElementKey, checked: boolean) {
    if (!activeJob) return
    updateJob(activeJob.id, {
      selectedFields: { ...activeJob.selectedFields, [key]: checked },
    })
  }

  function toggleGroup(keys: ElementKey[], checked: boolean) {
    if (!activeJob?.extracted) return
    const next = { ...activeJob.selectedFields }
    for (const key of keys) {
      if (activeJob.extracted[key]?.trim()) next[key] = checked
    }
    updateJob(activeJob.id, { selectedFields: next })
  }

  async function applyJob(job: ContractJob) {
    const payload = buildApplyPayload(job)
    if (!payload || !job.selectedFund) return false

    updateJob(job.id, { applyStatus: "applying", applyMessage: undefined })
    try {
      const res = await fetch("/ma/api/ops/fund-elements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || "写入失败")

      const count = countSelectedFields(job)
      const refresh = await fetch(`/ma/api/ops/fund-elements?beian_hao=${encodeURIComponent(job.selectedFund.beian_hao)}`)
      const refreshed = await refresh.json()
      updateJob(job.id, {
        applyStatus: "done",
        applyMessage: `已成功写入 ${count} 个字段`,
        currentElements: refreshed?.error ? job.currentElements : (refreshed as ExtractedFundElements),
        loadingCurrent: false,
      })
      return true
    } catch (err) {
      updateJob(job.id, {
        applyStatus: "error",
        applyMessage: err instanceof Error ? err.message : "写入失败",
      })
      return false
    }
  }

  async function handleApplyActive() {
    if (!activeJob) return
    await applyJob(activeJob)
  }

  async function saveContract(job: ContractJob) {
    if (!job.file || !job.selectedFund?.beian_hao) return false
    updateJob(job.id, { contractSaveStatus: "saving", contractSaveMessage: undefined })
    try {
      const form = new FormData()
      form.append("beian_hao", job.selectedFund.beian_hao)
      form.append("file", job.file)
      const res = await fetch("/ma/api/ops/fund-contracts", { method: "POST", body: form })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || "保存合同失败")
      updateJob(job.id, {
        contractSaveStatus: "done",
        contractSaveMessage: `已关联到「${job.selectedFund.product_name}」`,
        savedContractId: json.data?.id,
      })
      return true
    } catch (err) {
      updateJob(job.id, {
        contractSaveStatus: "error",
        contractSaveMessage: err instanceof Error ? err.message : "保存合同失败",
      })
      return false
    }
  }

  async function handleSaveContractActive() {
    if (!activeJob) return
    await saveContract(activeJob)
  }

  async function handleApplyAll() {
    if (!readyApplyJobs.length) return
    setBatchApplying(true)
    for (const job of readyApplyJobs) {
      if (job.applyStatus === "done") continue
      await applyJob(job)
    }
    setBatchApplying(false)
  }

  function renderFieldTable(job: ContractJob, keys: ElementKey[], title: string) {
    const selectableKeys = keys.filter((key) => job.extracted?.[key]?.trim())
    const allSelected = selectableKeys.length > 0 && selectableKeys.every((key) => job.selectedFields[key])

    return (
      <div className="rounded-lg border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
          <span className="text-sm font-medium">{title}</span>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => toggleGroup(keys, e.target.checked)}
              className="accent-red-500"
            />
            全选本组
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b bg-muted/10 text-xs text-zinc-500">
                <th className="px-3 py-2 text-left w-10">写入</th>
                <th className="px-3 py-2 text-left w-28">字段</th>
                <th className="px-3 py-2 text-left">提取值</th>
                <th className="px-3 py-2 text-left">当前值</th>
                <th className="px-3 py-2 text-left w-20">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {keys.map((key) => (
                <FieldCompareRow
                  key={key}
                  fieldKey={key}
                  extracted={job.extracted?.[key] ?? null}
                  current={job.currentElements?.[key] ?? null}
                  selected={job.selectedFields[key]}
                  onToggle={(checked) => toggleField(key, checked)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">要素提取</h1>
        <p className="text-sm text-muted-foreground mt-1">
          支持批量上传基金合同，同时提取基本信息与申赎信息，并写入对应产品的要素字段。
        </p>
      </div>

      <div className="rounded-lg border p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Upload className="h-4 w-4 text-red-500" />
          上传基金合同
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
            <span className="text-sm text-foreground mb-1">
              将文件拖到此处，或点击上传（可多选）
            </span>
            <span className="text-xs text-muted-foreground">
              支持 {SUPPORTED_FORMATS_TEXT}，单文件不超过 5MB，最多 {MAX_FILES} 份
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
              onClick={handleExtractAll}
              disabled={!files.length || extracting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
            >
              {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}
              {extracting
                ? `提取中 ${extractProgress.done}/${extractProgress.total}`
                : files.length > 1
                  ? `批量提取 ${files.length} 份`
                  : "开始提取"}
            </button>
            {files.length > 0 && (
              <button
                type="button"
                onClick={clearFiles}
                disabled={extracting}
                className="px-4 py-2 rounded border text-sm hover:bg-muted transition-colors disabled:opacity-60"
              >
                清除待提取文件
              </button>
            )}
            {readyApplyJobs.length > 1 && (
              <button
                type="button"
                onClick={handleApplyAll}
                disabled={batchApplying || extracting}
                className="px-4 py-2 rounded border border-red-400 text-red-600 text-sm hover:bg-red-50 transition-colors disabled:opacity-60"
              >
                {batchApplying ? "批量写入中…" : `全部写入 (${readyApplyJobs.length})`}
              </button>
            )}
            {hasWork && (
              <button
                type="button"
                onClick={clearAll}
                disabled={extracting || batchApplying}
                className="px-4 py-2 rounded border text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-60"
              >
                全部清空
              </button>
            )}
            {extractError && <p className="text-sm text-red-600">{extractError}</p>}
          </div>
        </div>

        {files.length > 0 && (
          <div className="rounded-lg border divide-y max-h-48 overflow-y-auto">
            {files.map((file, index) => (
              <div key={fileKey(file)} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate" title={file.name}>{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  disabled={extracting}
                  className="text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-40"
                  aria-label={`移除 ${file.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {jobs.length > 0 && (
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">提取任务 ({jobs.length})</div>
            <button
              type="button"
              onClick={clearAll}
              disabled={extracting || batchApplying}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            >
              全部清空
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => setActiveJobId(job.id)}
                className={[
                  "max-w-xs rounded-full border px-3 py-1 text-xs transition-colors truncate",
                  activeJobId === job.id
                    ? "border-red-400 text-red-600 bg-red-50"
                    : "hover:border-red-300 hover:text-red-500",
                  job.extractStatus === "error" ? "border-amber-300 text-amber-700" : "",
                  job.applyStatus === "done" ? "border-emerald-300 text-emerald-700" : "",
                ].join(" ")}
                title={job.fileName}
              >
                {job.fileName}
                {job.extractStatus === "error"
                  ? " · 失败"
                  : job.contractSaveStatus === "done"
                    ? " · 已存合同"
                    : job.applyStatus === "done"
                      ? " · 已写入"
                      : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeJob?.extractStatus === "error" && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {activeJob.fileName}：{activeJob.extractError || "要素提取失败"}
        </div>
      )}

      {activeJob?.extractStatus === "done" && activeJob.extracted && (
        <>
          <div className="rounded-lg border p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              匹配目标基金
              <span className="text-xs text-muted-foreground font-normal truncate">({activeJob.fileName})</span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="relative">
                <label className="text-xs text-muted-foreground">搜索基金</label>
                <input
                  value={activeJob.fundInput}
                  onChange={(e) => {
                    updateJob(activeJob.id, {
                      fundInput: e.target.value,
                      selectedFund: null,
                      currentElements: null,
                      loadingCurrent: false,
                      currentLoadVersion: 0,
                    })
                  }}
                  onFocus={() => setFundShowDropdown(true)}
                  placeholder="输入产品名称或备案号"
                  className="mt-1 w-full border rounded px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {fundShowDropdown && fundOptions.length > 0 && activeJobId === activeJob.id && (
                  <div className="absolute z-20 mt-1 w-full rounded border bg-background shadow-lg max-h-56 overflow-y-auto">
                    {fundOptions.map((opt) => (
                      <button
                        key={opt.beian_hao}
                        type="button"
                        onClick={() => {
                          selectTargetFund(activeJob.id, opt)
                          setFundShowDropdown(false)
                          setFundSearchError(null)
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50"
                      >
                        <div>{opt.product_name}</div>
                        <div className="text-xs text-muted-foreground">{opt.beian_hao}</div>
                      </button>
                    ))}
                  </div>
                )}
                {fundSearchError && activeJobId === activeJob.id && (
                  <p className="mt-1 text-xs text-amber-700">{fundSearchError}</p>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground">系统推荐匹配</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {activeJob.matchedFunds.length === 0 ? (
                    <span className="text-sm text-muted-foreground">未找到自动匹配，请手动搜索</span>
                  ) : (
                    activeJob.matchedFunds.map((fund) => (
                      <button
                        key={fund.beian_hao}
                        type="button"
                        onClick={() => selectTargetFund(activeJob.id, fund)}
                        className={[
                          "rounded-full border px-3 py-1 text-xs transition-colors",
                          activeJob.selectedFund?.beian_hao === fund.beian_hao
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
            {activeJob.selectedFund && (
              <div className="space-y-3">
                <div className="rounded px-3 py-2 text-sm bg-muted/30">
                  当前目标：<span className="font-medium">{activeJob.selectedFund.product_name}</span>
                  <span className="text-muted-foreground ml-2">{activeJob.selectedFund.beian_hao}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSaveContractActive}
                    disabled={!activeJob.file || activeJob.contractSaveStatus === "saving" || activeJob.contractSaveStatus === "done"}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded border border-red-400 text-red-600 text-sm hover:bg-red-50 transition-colors disabled:opacity-60"
                  >
                    {activeJob.contractSaveStatus === "saving" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                    {activeJob.contractSaveStatus === "done" ? "合同已保存" : "保存合同到产品"}
                  </button>
                  {activeJob.contractSaveStatus === "done" && activeJob.savedContractId && (
                    <a
                      href={`/ma/dashboard/private-funds/${encodeURIComponent(activeJob.selectedFund.beian_hao)}?tab=materials`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      在产品页「相关资料」查看
                    </a>
                  )}
                </div>
                {activeJob.contractSaveMessage && (
                  <div className={[
                    "rounded px-3 py-2 text-sm border",
                    activeJob.contractSaveStatus === "error"
                      ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-emerald-50 text-emerald-800 border-emerald-200",
                  ].join(" ")}>
                    {activeJob.contractSaveMessage}
                  </div>
                )}
              </div>
            )}
            {activeJob.textPreview && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">查看合同文本预览</summary>
                <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/20 p-3 max-h-40 overflow-y-auto">{activeJob.textPreview}</pre>
              </details>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium">提取结果预览</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  勾选需要写入的字段，将更新到目标基金的「基本信息 / 申赎信息」。
                </p>
              </div>
              <button
                type="button"
                onClick={handleApplyActive}
                disabled={!activeJob.selectedFund || activeJob.applyStatus === "applying" || activeJob.loadingCurrent || selectedCount === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
              >
                {activeJob.applyStatus === "applying" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {activeJob.applyStatus === "applying" ? "写入中…" : `写入 ${selectedCount} 个字段`}
              </button>
            </div>
            {activeJob.applyMessage && (
              <div className={[
                "rounded px-3 py-2 text-sm border",
                activeJob.applyStatus === "error"
                  ? "bg-red-50 text-red-700 border-red-200"
                  : "bg-emerald-50 text-emerald-800 border-emerald-200",
              ].join(" ")}>
                {activeJob.applyMessage}
              </div>
            )}
            {activeJob.loadingCurrent ? (
              <div className="text-sm text-muted-foreground py-8 text-center">加载当前要素…</div>
            ) : (
              <>
                {renderFieldTable(activeJob, BASIC_KEYS, "基本信息")}
                {renderFieldTable(activeJob, SUBSCRIPTION_KEYS, "申赎信息")}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
