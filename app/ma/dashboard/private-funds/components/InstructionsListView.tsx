"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  BadgeCheck,
  CheckSquare,
  ChevronDown,
  ChevronsUpDown,
  ClipboardX,
  CloudUpload,
  Copy,
  Download,
  Eye,
  FilePenLine,
  FileText,
  Filter,
  Inbox,
  PlayCircle,
  Settings2,
  X,
} from "lucide-react"
import { DateInput } from "@/components/ui/date-input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"
import {
  INSTRUCTION_FIELD_DEFAULT,
  INSTRUCTION_FIELD_LOCKED,
  InstructionsFieldConfigDialog,
  readInstructionFieldConfig,
  writeInstructionFieldConfig,
} from "./InstructionsFieldConfigDialog"
import {
  openInstructionAttachment,
  saveInstructionAttachmentBlob,
} from "./instruction-attachment-files"
import {
  attachmentMetaFromFile,
  canApproveInstruction,
  canConfirmInstruction,
  canExecuteInstruction,
  currentInstructionInitiator,
  currentInstructionUserId,
  emailConfirmAttachmentId,
  getInstructionRecordsServerSnapshot,
  getInstructionRecordsSnapshot,
  instructionTimelineActiveIndex,
  instructionTimelineSteps,
  isInstructionAwaitingExecute,
  isInstructionDoneForCurrentUser,
  isInstructionExecuted,
  isInstructionPendingApproval,
  isInstructionPendingForCurrentUser,
  isInstructionRejected,
  isInstructionWorkflowFinished,
  listInstructionRecords,
  progressAfterApproval,
  progressAfterExecute,
  removeInstructionRecord,
  requiresContractAtExecute,
  resolveInstructionInitiatorDisplay,
  subscribeInstructionRecords,
  updateInstructionRecord,
  type InstructionAttachmentMeta,
  type InstructionRecord,
} from "./instructions-store"
import {
  backfillLedgerFromConfirmedInstructions,
  isInstructionConfirmed,
  removeLedgerByInstructionId,
  upsertLedgerFromConfirmedInstruction,
} from "./ops-ledger-store"
import {
  UnderlyingSubscribeForm,
  type UnderlyingTradeType,
} from "./UnderlyingSubscribeForm"

type EmailConfirmCandidate = {
  id: number
  subject: string
  fund_name: string | null
  fund_code: string | null
  investor_name: string | null
  apply_date: string | null
  confirm_date: string | null
  business_type: string | null
  confirmed_amount: string | null
  confirmed_shares: string | null
  unit_nav: string | null
  trade_fee: string | null
  broker: string | null
  attachment_filename: string
  file_size: number
  sent_at: string | null
  score: number
  reasons: string[]
}

/** Drop bilingual PDF label leftovers like "FundName" so the list can fall back to filename. */
function usableConfirmField(value: string | null | undefined): string | null {
  const v = (value || "").trim()
  if (!v) return null
  const compact = v.replace(/\s+/g, "")
  if (
    /^(FundName|InvestorName|FundCode|BusinessType|ApplicationDate|ConfirmedDate|ConfirmationDate|ConfirmedAmount)$/i.test(
      compact,
    )
  ) {
    return null
  }
  if (/^(基金名称|投资人名称|基金代码|业务类型|申请日期|确认日期|确认金额)$/.test(compact)) {
    return null
  }
  return v
}

function confirmCandidateTitle(c: EmailConfirmCandidate): string {
  const fund = usableConfirmField(c.fund_name)
  if (fund) return c.broker ? `${fund} · ${c.broker}` : fund
  const file = usableConfirmField(c.attachment_filename)
  if (file) return file
  const subject = usableConfirmField(c.subject)
  if (subject) return subject
  return `确认单 #${c.id}`
}

function confirmCandidateMeta(c: EmailConfirmCandidate): string {
  const investor = usableConfirmField(c.investor_name)
  return [
    c.confirm_date || c.apply_date || (c.sent_at ? `邮件 ${c.sent_at.slice(0, 10)}` : null),
    c.business_type || null,
    c.confirmed_amount ? `${c.confirmed_amount} 元` : null,
    c.unit_nav ? `净值 ${c.unit_nav}` : null,
    investor ? `投资人 ${investor}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

async function persistAttachmentFromFile(file: File): Promise<InstructionAttachmentMeta> {
  const meta = attachmentMetaFromFile(file)
  await saveInstructionAttachmentBlob(meta.id, file)
  return meta
}

/**
 * Portal modals to document.body so focus/scroll-into-view inside inputs does not
 * scroll the page's overflow container (which makes the dialog appear to flash away).
 * Also ignore the ghost click that lands on the backdrop when a native date picker closes.
 */
function InstructionModalFrame({
  onClose,
  className,
  children,
}: {
  onClose: () => void
  className: string
  children: ReactNode
}) {
  const ignoreBackdropCloseUntilRef = useRef(0)

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return
        if (Date.now() < ignoreBackdropCloseUntilRef.current) return
        onClose()
      }}
    >
      <div
        className={className}
        onClick={(e) => e.stopPropagation()}
        onBlurCapture={(e) => {
          const t = e.target
          if (t instanceof HTMLInputElement && t.type === "date") {
            ignoreBackdropCloseUntilRef.current = Date.now() + 400
          }
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

export type InstructionsListVariant = "handled" | "mine" | "all"

type CategoryTab = "underlying" | "direct" | "customer" | "pool"
type ProcessStatus = "pending" | "done"
type KeywordField = "fof" | "underlying" | "id" | "fundName"

type ColumnDef = {
  key: string
  label: string
  width: string
  sort?: boolean
  filter?: boolean
}

const STANDARD_TABS: { key: CategoryTab; label: string }[] = [
  { key: "underlying", label: "底层申赎" },
  { key: "direct", label: "直投申赎" },
  { key: "customer", label: "客户申赎" },
  { key: "pool", label: "入/出池审批" },
]

const ALL_TABS: { key: CategoryTab; label: string }[] = [
  { key: "underlying", label: "底层申赎" },
  { key: "direct", label: "直投申赎" },
  { key: "customer", label: "客户申赎" },
  { key: "pool", label: "入/出池审批" },
]

const KEYWORD_FIELD_OPTIONS: { key: KeywordField; label: string }[] = [
  { key: "fof", label: "FOF基金" },
  { key: "underlying", label: "底层基金" },
  { key: "id", label: "指令ID" },
]

const POOL_KEYWORD_FIELD_OPTIONS: { key: KeywordField; label: string }[] = [
  { key: "fundName", label: "基金名称" },
]

const CUSTOMER_KEYWORD_FIELD_OPTIONS: { key: KeywordField; label: string }[] = [
  { key: "fundName", label: "基金名称" },
]

/** 我发起的/我处理的 → 入/出池审批 (no 发起人) */
const POOL_COLUMNS: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "fundManager", label: "基金/管理人名称", width: "min-w-[160px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "createdAt", label: "发起时间", width: "min-w-[140px]", sort: true },
  { key: "progress", label: "指令进度", width: "min-w-[100px]", filter: true },
  { key: "actions", label: "操作", width: "min-w-[120px] text-center" },
]

/** 所有指令 → 入/出池审批 (includes 发起人) */
const POOL_COLUMNS_ALL: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "fundManager", label: "基金/管理人名称", width: "min-w-[160px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "createdAt", label: "发起时间", width: "min-w-[140px]", sort: true },
  { key: "initiator", label: "发起人", width: "min-w-[90px]" },
  { key: "progress", label: "指令进度", width: "min-w-[100px]", filter: true },
  { key: "actions", label: "操作", width: "min-w-[120px] text-center" },
]

const FIXED_LEFT_COLUMNS_UNDERLYING: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "fof", label: "FOF基金", width: "min-w-[140px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "underlying", label: "底层基金", width: "min-w-[140px]" },
]

const FIXED_LEFT_COLUMNS_DIRECT: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "investor", label: "投资者名称", width: "min-w-[140px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "directProduct", label: "直投产品", width: "min-w-[140px]" },
]

/** 所有指令 → 直投申赎 uses 直投基金 instead of 直投产品 */
const FIXED_LEFT_COLUMNS_DIRECT_ALL: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "investor", label: "投资者名称", width: "min-w-[140px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "directFund", label: "直投基金", width: "min-w-[140px]" },
]

const FIXED_LEFT_COLUMNS_CUSTOMER: ColumnDef[] = [
  { key: "index", label: "序号", width: "w-14 text-center" },
  { key: "id", label: "指令ID", width: "min-w-[120px]" },
  { key: "customer", label: "客户名称", width: "min-w-[140px]" },
  { key: "type", label: "指令类型", width: "min-w-[100px]", filter: true },
  { key: "fundName", label: "基金名称", width: "min-w-[140px]" },
]

const FIXED_RIGHT_COLUMNS_PROGRESS: ColumnDef[] = [
  { key: "progress", label: "指令进度", width: "min-w-[120px]", filter: true },
  { key: "actions", label: "操作", width: "min-w-[140px] text-center" },
]

const FIXED_RIGHT_COLUMNS_STATUS: ColumnDef[] = [
  { key: "status", label: "指令状态", width: "min-w-[100px]", filter: true },
  { key: "actions", label: "操作", width: "min-w-[140px] text-center" },
]

const CONFIG_COLUMN_META: Record<string, Omit<ColumnDef, "label">> = {
  交易申请日期: { key: "applyDate", width: "min-w-[120px]", sort: true },
  申请金额: { key: "amount", width: "min-w-[100px]" },
  申请份额: { key: "shares", width: "min-w-[100px]" },
  确认净值: { key: "nav", width: "min-w-[90px]" },
  发起人: { key: "initiator", width: "min-w-[90px]" },
  实际申请日期: { key: "actualApplyDate", width: "min-w-[120px]", sort: true },
  交易确认日期: { key: "confirmDate", width: "min-w-[120px]", sort: true },
  确认金额: { key: "confirmAmount", width: "min-w-[100px]" },
  确认份额: { key: "confirmShares", width: "min-w-[100px]" },
  交易费用: { key: "tradeFee", width: "min-w-[90px]" },
  业绩报酬: { key: "perfFee", width: "min-w-[90px]" },
  转入申请金额: { key: "transferInAmount", width: "min-w-[110px]" },
  转入确认日期: { key: "transferInConfirmDate", width: "min-w-[120px]" },
  转入确认净值: { key: "transferInNav", width: "min-w-[110px]" },
  转入确认金额: { key: "transferInConfirmAmount", width: "min-w-[110px]" },
  转入确认份额: { key: "transferInConfirmShares", width: "min-w-[110px]" },
  转入交易费用: { key: "transferInFee", width: "min-w-[110px]" },
}

function leftColumnsForTab(categoryTab: CategoryTab, isAll: boolean): ColumnDef[] {
  if (categoryTab === "direct") {
    return isAll ? FIXED_LEFT_COLUMNS_DIRECT_ALL : FIXED_LEFT_COLUMNS_DIRECT
  }
  if (categoryTab === "customer") return FIXED_LEFT_COLUMNS_CUSTOMER
  return FIXED_LEFT_COLUMNS_UNDERLYING
}

function rightColumnsForTab(_categoryTab: CategoryTab): ColumnDef[] {
  return FIXED_RIGHT_COLUMNS_PROGRESS
}

function fieldsForTab(
  categoryTab: CategoryTab,
  selectedFields: string[],
  isAll: boolean,
): string[] {
  // 客户申赎 always hides 发起人; 直投 hides it except on 所有指令
  if (categoryTab === "customer") {
    return selectedFields.filter((f) => f !== "发起人")
  }
  if (!isAll && categoryTab === "direct") {
    return selectedFields.filter((f) => f !== "发起人")
  }
  return selectedFields
}

function buildColumns(
  categoryTab: CategoryTab,
  selectedFields: string[],
  isAll: boolean,
): ColumnDef[] {
  if (categoryTab === "pool") return isAll ? POOL_COLUMNS_ALL : POOL_COLUMNS
  const configurable = fieldsForTab(categoryTab, selectedFields, isAll).map((label) => {
    const meta = CONFIG_COLUMN_META[label] ?? {
      key: label,
      width: "min-w-[100px]",
    }
    return { ...meta, label }
  })
  return [
    ...leftColumnsForTab(categoryTab, isAll),
    ...configurable,
    ...rightColumnsForTab(categoryTab),
  ]
}

const thBase =
  "px-3 py-0 h-9 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap box-border leading-tight align-middle"

/** See docs/date-input-locale-placeholder.md — use shared DateInput. */
function FilterDateInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <DateInput
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="w-[168px]"
      inputClassName="h-8 rounded-md pl-2 pr-8 text-xs"
      displayClassName="left-2 text-xs"
    />
  )
}

function ColumnHeader({
  label,
  sort,
  filter,
}: {
  label: string
  sort?: boolean
  filter?: boolean
}) {
  if (sort) {
    return (
      <span className="inline-flex items-center gap-0.5">
        {label}
        <ChevronsUpDown className="h-3 w-3 opacity-40" />
      </span>
    )
  }
  if (filter) {
    return (
      <span className="inline-flex items-center gap-0.5">
        {label}
        <Filter className="h-3 w-3 opacity-40" />
      </span>
    )
  }
  return <>{label}</>
}

function cellDash(value: string | null | undefined) {
  if (value == null || value === "") return "-"
  return value
}

function VoidInstructionDialog({
  open,
  instructionId,
  onClose,
  onConfirm,
}: {
  open: boolean
  instructionId: string
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState("")
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!open) return
    setReason("")
    setTouched(false)
  }, [open, instructionId])

  if (!open) return null

  const trimmed = reason.trim()
  const showError = touched && !trimmed

  function handleConfirm() {
    setTouched(true)
    if (!trimmed) return
    onConfirm(trimmed)
  }

  return (
    <InstructionModalFrame
      onClose={onClose}
      className="w-full max-w-[560px] rounded-lg bg-background shadow-xl"
    >
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <span className="text-[15px] font-medium text-zinc-800 dark:text-zinc-100">作废指令</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3 px-5 py-5">
        <label className="block text-sm text-zinc-700 dark:text-zinc-200">
          <span className="text-red-500">*</span> 作废理由 (指令ID: {instructionId}):
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="请输入内容"
          rows={5}
          className={[
            "w-full resize-none rounded-md border bg-background px-3 py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-1 dark:text-zinc-100",
            showError
              ? "border-red-400 focus:ring-red-400"
              : "border-border focus:ring-ring",
          ].join(" ")}
        />
        {showError ? (
          <p className="text-xs text-red-500">请输入作废理由</p>
        ) : null}
        <p className="text-sm text-red-500">
          说明：1. 【已确认】的指令作废后，会删除对应的台账。
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded border px-4 py-1.5 text-sm transition-colors hover:bg-muted"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="rounded bg-red-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-600"
        >
          确定
        </button>
      </div>
    </InstructionModalFrame>
  )
}

function InstructionFileUpload({
  label,
  required = false,
  file,
  existing,
  onChange,
}: {
  label: string
  required?: boolean
  file: File | null
  existing?: InstructionAttachmentMeta | null
  onChange: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const displayName = file?.name || existing?.name || null
  const previewableExisting = !file && existing?.id ? existing : null

  return (
    <div className="block">
      <span className="mb-1 block text-zinc-700 dark:text-zinc-200">
        {required ? <span className="text-red-500">*</span> : null} {label}
      </span>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          onChange(e.dataTransfer.files?.[0] ?? null)
        }}
        className={[
          "flex h-24 w-full flex-col items-center justify-center gap-2 rounded border border-dashed text-sm transition-colors",
          dragOver
            ? "border-red-400 bg-red-50/60 dark:bg-red-950/20"
            : "border-zinc-300 bg-zinc-50/80 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/70",
        ].join(" ")}
      >
        <CloudUpload className="h-5 w-5 text-zinc-400" />
        {displayName ? (
          <span className="max-w-[90%] truncate px-3 text-zinc-700 dark:text-zinc-200">
            {displayName}
          </span>
        ) : (
          <span className="text-zinc-400">点击或拖拽上传</span>
        )}
      </button>
      {file || existing ? (
        <div className="mt-1 flex items-center gap-3">
          {previewableExisting ? (
            <button
              type="button"
              onClick={() => {
                void openInstructionAttachment(previewableExisting.id).catch(() => {
                  window.alert("无法打开确认单，请检查浏览器弹窗拦截")
                })
              }}
              className="inline-flex items-center gap-1 text-xs text-sky-600 hover:underline dark:text-sky-400"
            >
              <Eye className="h-3.5 w-3.5" />
              预览
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-zinc-400 hover:text-zinc-600"
          >
            清除
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ExecuteTradeDialog({
  open,
  record,
  onClose,
  onExecute,
}: {
  open: boolean
  record: InstructionRecord | null
  onClose: () => void
  onExecute: (payload: {
    actualApplyDate: string
    execRemark: string
    contractAttachment: InstructionAttachmentMeta | null
  }) => void
}) {
  const [actualApplyDate, setActualApplyDate] = useState("")
  const [execRemark, setExecRemark] = useState("")
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const needsContract = Boolean(record && requiresContractAtExecute(record.type))

  useEffect(() => {
    if (!open || !record) return
    setActualApplyDate(record.actualApplyDate || record.applyDate || "")
    setExecRemark(record.execRemark || "")
    setContractFile(null)
    setError(null)
    setSubmitting(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when dialog opens / record changes
  }, [open, record?.id])

  if (!open || !record) return null

  async function handleSubmit() {
    if (!actualApplyDate.trim()) {
      setError("请选择实际申请日期")
      return
    }
    if (needsContract && !contractFile && !record.contractAttachment) {
      setError("请上传合同")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const contractAttachment = contractFile
        ? await persistAttachmentFromFile(contractFile)
        : (record.contractAttachment ?? null)
      onExecute({
        actualApplyDate: actualApplyDate.trim(),
        execRemark: execRemark.trim(),
        contractAttachment,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存合同失败")
      setSubmitting(false)
    }
  }

  return (
    <InstructionModalFrame
      onClose={onClose}
      className="w-full max-w-[520px] rounded-lg bg-background shadow-xl"
    >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <span className="text-[15px] font-medium text-zinc-800 dark:text-zinc-100">产品运维执行</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-5 text-sm">
          <p className="text-zinc-500">
            指令ID：{record.id} · {record.fofFundName} / {record.underlyingFundName}
          </p>
          <p className="text-zinc-500">
            指令类型：<span className="font-medium text-red-500">{record.type}</span>
          </p>
          <label className="block">
            <span className="mb-1 block text-zinc-700 dark:text-zinc-200">
              <span className="text-red-500">*</span> 实际申请日期
            </span>
            <DateInput
              value={actualApplyDate}
              onChange={setActualApplyDate}
              className="h-9 w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-zinc-700 dark:text-zinc-200">执行备注</span>
            <textarea
              value={execRemark}
              onChange={(e) => setExecRemark(e.target.value)}
              rows={2}
              placeholder="请输入内容"
              className="w-full resize-y rounded border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
            />
          </label>
          {needsContract ? (
            <InstructionFileUpload
              label="合同"
              required
              file={contractFile}
              existing={record.contractAttachment}
              onChange={setContractFile}
            />
          ) : (
            <p className="text-xs text-zinc-400">追加类指令无需上传合同。</p>
          )}
          <p className="text-xs text-zinc-400">
            执行后指令进度将变为「待确认」，由产品运维完成确认。
          </p>
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-4 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="rounded bg-red-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-60"
          >
            {submitting ? "保存中…" : "确认执行"}
          </button>
        </div>
    </InstructionModalFrame>
  )
}

function formatConfirmNav(value: number): string {
  return value.toFixed(6)
}

function calcConfirmShares(amountText: string, navText: string): string | null {
  const amt = Number(String(amountText).replace(/,/g, "").trim())
  const n = Number(String(navText).replace(/,/g, "").trim())
  if (!Number.isFinite(amt) || !Number.isFinite(n) || n <= 0) return null
  return (amt / n).toFixed(2)
}

function ConfirmTradeDialog({
  open,
  record,
  onClose,
  onConfirm,
}: {
  open: boolean
  record: InstructionRecord | null
  onClose: () => void
  onConfirm: (payload: {
    confirmDate: string
    amount: string
    shares: string
    nav: string
    tradeFee: string
    modifyReason: string
    confirmAttachment: InstructionAttachmentMeta
  }) => void
}) {
  const [confirmDate, setConfirmDate] = useState("")
  const [amount, setAmount] = useState("")
  const [shares, setShares] = useState("")
  const [nav, setNav] = useState("")
  const [tradeFee, setTradeFee] = useState("0.00")
  const [modifyReason, setModifyReason] = useState("")
  const [confirmFile, setConfirmFile] = useState<File | null>(null)
  const [emailAttachment, setEmailAttachment] = useState<InstructionAttachmentMeta | null>(null)
  const [candidates, setCandidates] = useState<EmailConfirmCandidate[]>([])
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null)
  const [fetchingEmail, setFetchingEmail] = useState(false)
  const [fetchHint, setFetchHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fetchingNav, setFetchingNav] = useState(false)
  const [navHint, setNavHint] = useState<string | null>(null)
  const [sharesHint, setSharesHint] = useState<string | null>(null)
  const navManualRef = useRef(false)
  const sharesManualRef = useRef(false)

  function applyCandidate(c: EmailConfirmCandidate) {
    setSelectedCandidateId(c.id)
    if (c.confirm_date) setConfirmDate(c.confirm_date)
    if (c.confirmed_amount) setAmount(String(c.confirmed_amount).replace(/,/g, ""))
    if (c.confirmed_shares) {
      setShares(String(c.confirmed_shares).replace(/,/g, ""))
      sharesManualRef.current = true
      setSharesHint(`已使用确认单份额 ${String(c.confirmed_shares).replace(/,/g, "")}（可修改）`)
    }
    if (c.unit_nav) {
      const nextNav = String(c.unit_nav).replace(/,/g, "")
      setNav(nextNav)
      navManualRef.current = true
      setNavHint(`已使用确认单净值 ${nextNav}（可修改）`)
    }
    if (c.trade_fee != null && c.trade_fee !== "") {
      setTradeFee(String(c.trade_fee).replace(/,/g, ""))
    }
    setConfirmFile(null)
    setEmailAttachment({
      id: emailConfirmAttachmentId(c.id),
      name: c.attachment_filename || `确认单-${c.id}.pdf`,
      size: c.file_size || 0,
      uploadedAt: new Date().toISOString(),
      source: "email",
      confirmRecordId: c.id,
    })
  }

  async function fetchConfirmFromEmail(refresh: boolean) {
    if (!record) return
    setFetchingEmail(true)
    setFetchHint(null)
    setError(null)
    try {
      const res = await fetch("/ma/api/ops/email-confirm-records/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fundName: record.underlyingFundName,
          fundCode: record.underlyingBeianHao || undefined,
          investorName: record.fofFundName,
          amount: String(record.amount || "").replace(/,/g, ""),
          applyDate: record.applyDate || undefined,
          refresh,
          limit: 10,
        }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        data?: EmailConfirmCandidate[]
        refreshStarted?: boolean
        error?: string
      }
      if (!res.ok || json.error) throw new Error(json.error || "匹配确认单失败")
      const list = Array.isArray(json.data) ? json.data : []
      setCandidates(list)
      if (list.length === 1 && list[0].score >= 40) {
        applyCandidate(list[0])
        setFetchHint(
          json.refreshStarted
            ? "已启动邮箱补抓；已自动匹配到 1 份确认单，可点击预览（可稍后再次获取以纳入最新邮件）"
            : "已自动匹配到 1 份确认单，可点击预览",
        )
      } else if (list.length > 1) {
        setFetchHint(
          `找到 ${list.length} 份候选，请按日期/金额/附件名区分，或点「预览」核对后选择`,
        )
      } else {
        setFetchHint(
          json.refreshStarted
            ? "已启动邮箱补抓，暂无匹配结果；请稍后再点「从邮箱获取」"
            : "未匹配到确认单，可手动上传或稍后重试",
        )
      }
    } catch (err) {
      setFetchHint(err instanceof Error ? err.message : "从邮箱获取失败")
    } finally {
      setFetchingEmail(false)
    }
  }

  useEffect(() => {
    if (!open || !record) return
    setConfirmDate(record.confirmDate || record.applyDate || "")
    setAmount(String(record.amount || "").replace(/,/g, ""))
    setShares(record.shares ? String(record.shares).replace(/,/g, "") : "")
    setNav(record.nav ? String(record.nav).replace(/,/g, "") : "")
    setTradeFee(record.tradeFee ? String(record.tradeFee).replace(/,/g, "") : "0.00")
    setModifyReason(record.modifyReason || "")
    setConfirmFile(null)
    setEmailAttachment(
      record.confirmAttachment?.source === "email" ? record.confirmAttachment : null,
    )
    setCandidates([])
    setSelectedCandidateId(record.confirmAttachment?.confirmRecordId ?? null)
    setError(null)
    setFetchHint(null)
    setSubmitting(false)
    navManualRef.current = false
    sharesManualRef.current = Boolean(record.shares)
    setNavHint(null)
    setSharesHint(
      record.shares
        ? `当前确认份额 ${String(record.shares).replace(/,/g, "")}（可修改）`
        : null,
    )
    setFetchingNav(false)
    void fetchConfirmFromEmail(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when dialog opens / record changes
  }, [open, record?.id])

  useEffect(() => {
    if (!open || !record) return
    const date = confirmDate.trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    if (navManualRef.current) return
    const beian = (record.underlyingBeianHao || "").trim()
    const productName = (record.underlyingFundName || "").trim()
    if (!beian && !productName) {
      setNavHint("缺少产品标识，无法自动读取净值")
      return
    }

    const ac = new AbortController()
    setFetchingNav(true)
    setNavHint("正在读取交易日净值…")
    const params = new URLSearchParams({ date })
    if (beian) params.set("beian_hao", beian)
    if (productName) params.set("product_name", productName)

    fetch(`/ma/api/tracking-funds/nav-on-date?${params}`, { signal: ac.signal })
      .then(async (res) => {
        const json = (await res.json()) as {
          unit_nav?: number | null
          nav_date?: string | null
          exact?: boolean
          error?: string
        }
        if (!res.ok || json.error) throw new Error(json.error || "读取净值失败")
        return json
      })
      .then((json) => {
        if (ac.signal.aborted || navManualRef.current) return
        const unitNav = json.unit_nav
        if (unitNav == null || !Number.isFinite(unitNav) || unitNav <= 0) {
          setNavHint(`未找到 ${date} 及以前的产品净值，请手动填写`)
          return
        }
        const formatted = formatConfirmNav(unitNav)
        setNav(formatted)
        const navDate = json.nav_date || date
        setNavHint(
          json.exact
            ? `已使用 ${navDate} 单位净值 ${formatted}（可修改）`
            : `确认日无净值，已使用最近交易日 ${navDate} 单位净值 ${formatted}（可修改）`,
        )
      })
      .catch((err) => {
        if (ac.signal.aborted) return
        setNavHint(err instanceof Error ? err.message : "读取净值失败，请手动填写")
      })
      .finally(() => {
        if (!ac.signal.aborted) setFetchingNav(false)
      })

    return () => ac.abort()
  }, [open, record?.id, record?.underlyingBeianHao, record?.underlyingFundName, confirmDate])

  useEffect(() => {
    if (!open) return
    if (sharesManualRef.current) return
    const next = calcConfirmShares(amount, nav)
    if (!next) {
      setSharesHint(null)
      return
    }
    setShares(next)
    const amtText = String(amount).replace(/,/g, "").trim()
    const navText = String(nav).replace(/,/g, "").trim()
    setSharesHint(`已按 确认金额 / 确认单位净值 计算：${amtText} ÷ ${navText} = ${next}（可修改）`)
  }, [open, amount, nav])

  if (!open || !record) return null

  const effectiveAttachment =
    emailAttachment
    || (confirmFile ? null : record.confirmAttachment)
    || null

  async function handleSubmit() {
    if (!confirmDate.trim()) {
      setError("请选择交易确认日期")
      return
    }
    if (!amount.trim()) {
      setError("请输入确认金额")
      return
    }
    if (!nav.trim()) {
      setError("请输入确认单位净值")
      return
    }
    if (!confirmFile && !effectiveAttachment) {
      setError("请上传确认函/确认单，或从邮箱获取")
      return
    }
    let nextShares = shares.trim()
    if (!nextShares) {
      nextShares = calcConfirmShares(amount, nav) || ""
    }
    setSubmitting(true)
    setError(null)
    try {
      const confirmAttachment = confirmFile
        ? await persistAttachmentFromFile(confirmFile)
        : effectiveAttachment!
      onConfirm({
        confirmDate: confirmDate.trim(),
        amount: amount.trim(),
        shares: nextShares,
        nav: nav.trim(),
        tradeFee: tradeFee.trim() || "0.00",
        modifyReason: modifyReason.trim(),
        confirmAttachment,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存确认函失败")
      setSubmitting(false)
    }
  }

  return (
    <InstructionModalFrame
      onClose={onClose}
      className="w-full max-w-[560px] max-h-[min(860px,calc(100vh-2rem))] overflow-y-auto rounded-lg bg-background shadow-xl"
    >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <span className="text-[15px] font-medium text-zinc-800 dark:text-zinc-100">产品运维确认</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-5 text-sm">
          <p className="text-zinc-500">
            指令ID：{record.id} · {record.fofFundName} / {record.underlyingFundName}
          </p>

          <div className="rounded border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/40">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-medium text-zinc-700 dark:text-zinc-200">确认单（邮箱）</span>
              <button
                type="button"
                disabled={fetchingEmail}
                onClick={() => void fetchConfirmFromEmail(true)}
                className="rounded border border-red-200 bg-white px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:bg-zinc-950 dark:hover:bg-red-950/30"
              >
                {fetchingEmail ? "获取中…" : "从邮箱获取"}
              </button>
            </div>
            {fetchHint ? <p className="mb-2 text-xs text-zinc-500">{fetchHint}</p> : null}
            {candidates.length > 0 ? (
              <ul className="max-h-56 space-y-1.5 overflow-y-auto">
                {candidates.map((c, index) => {
                  const active = selectedCandidateId === c.id
                  const title = confirmCandidateTitle(c)
                  const meta = confirmCandidateMeta(c)
                  const fileName = usableConfirmField(c.attachment_filename)
                  const subject = usableConfirmField(c.subject)
                  return (
                    <li key={c.id}>
                      <div
                        className={[
                          "rounded border px-2.5 py-2 text-xs transition-colors",
                          active
                            ? "border-red-400 bg-red-50/80 dark:border-red-700 dark:bg-red-950/30"
                            : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950",
                        ].join(" ")}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => applyCandidate(c)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
                                #{index + 1}
                              </span>
                              <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                                {title}
                              </span>
                            </div>
                            {meta ? (
                              <div className="mt-0.5 text-zinc-600 dark:text-zinc-300">{meta}</div>
                            ) : null}
                            {fileName && fileName !== title ? (
                              <div className="mt-0.5 truncate text-zinc-500" title={fileName}>
                                附件：{fileName}
                              </div>
                            ) : null}
                            {subject && subject !== title && subject !== fileName ? (
                              <div className="mt-0.5 truncate text-zinc-400" title={subject}>
                                主题：{subject}
                              </div>
                            ) : null}
                            {c.reasons?.length ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {c.reasons.slice(0, 3).map((reason) => (
                                  <span
                                    key={reason}
                                    className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800"
                                  >
                                    {reason}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            title="预览确认单"
                            onClick={(e) => {
                              e.stopPropagation()
                              void openInstructionAttachment(emailConfirmAttachmentId(c.id)).catch(
                                (err) => {
                                  setFetchHint(
                                    err instanceof Error ? err.message : "预览确认单失败",
                                  )
                                },
                              )
                            }}
                            className="shrink-0 rounded border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-xs text-zinc-400">暂无候选；可点击「从邮箱获取」或下方手动上传。</p>
            )}
          </div>

          <label className="block">
            <span className="mb-1 block text-zinc-700 dark:text-zinc-200">
              <span className="text-red-500">*</span> 交易确认日期
            </span>
            <DateInput
              value={confirmDate}
              onChange={(next) => {
                setConfirmDate(next)
                // Changing the trade date re-enables auto NAV lookup.
                navManualRef.current = false
              }}
              className="h-9 w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-zinc-700 dark:text-zinc-200">交易费用</span>
            <input
              type="text"
              inputMode="decimal"
              value={tradeFee}
              onChange={(e) => setTradeFee(e.target.value)}
              className="h-9 w-full rounded border border-border bg-background px-3 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-2 text-zinc-700 dark:text-zinc-200">
              <span>
                <span className="text-red-500">*</span> 确认单位净值
              </span>
              {fetchingNav ? (
                <span className="text-xs font-normal text-zinc-400">读取中…</span>
              ) : null}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={nav}
              onChange={(e) => {
                setNav(e.target.value)
                navManualRef.current = true
                setNavHint("已手动修改净值（可继续编辑）")
              }}
              className="h-9 w-full rounded border border-border bg-background px-3 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {navHint ? <p className="mt-1 text-xs text-zinc-500">{navHint}</p> : null}
          </label>
          <label className="block">
            <span className="mb-1 block text-zinc-700 dark:text-zinc-200">
              <span className="text-red-500">*</span> 确认金额
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                // Amount change should refresh auto-calculated shares.
                if (!sharesManualRef.current) setSharesHint(null)
              }}
              className="h-9 w-full rounded border border-border bg-background px-3 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-zinc-700 dark:text-zinc-200">确认份额</span>
            <input
              type="text"
              inputMode="decimal"
              value={shares}
              onChange={(e) => {
                setShares(e.target.value)
                sharesManualRef.current = true
                setSharesHint(
                  e.target.value.trim()
                    ? `已手动修改份额 ${e.target.value.trim()}（可继续编辑）`
                    : "已清空自动计算，可手动填写",
                )
              }}
              placeholder="按金额/净值自动计算，也可手动修改"
              className="h-9 w-full rounded border border-border bg-background px-3 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
            />
            {sharesHint ? <p className="mt-1 text-xs text-zinc-500">{sharesHint}</p> : null}
          </label>
          <label className="block">
            <span className="mb-1 block text-zinc-700 dark:text-zinc-200">修改理由</span>
            <textarea
              value={modifyReason}
              onChange={(e) => setModifyReason(e.target.value)}
              rows={2}
              placeholder="请输入内容"
              className="w-full resize-y rounded border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
            />
          </label>
          <InstructionFileUpload
            label="确认函/确认单（手动上传）"
            required={!effectiveAttachment}
            file={confirmFile}
            existing={effectiveAttachment}
            onChange={(file) => {
              setConfirmFile(file)
              if (file) {
                setEmailAttachment(null)
                setSelectedCandidateId(null)
              }
            }}
          />
          <p className="text-xs text-zinc-400">
            优先从邮箱自动匹配确认单；确认后指令进度将变为「已确认」，并写入 FOF 台账。
          </p>
          {error ? <p className="text-xs text-red-500">{error}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border px-4 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="rounded bg-red-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-60"
          >
            {submitting ? "保存中…" : "确认"}
          </button>
        </div>
    </InstructionModalFrame>
  )
}

function isUnderlyingTradeType(type: string): type is UnderlyingTradeType {
  return type === "认购" || type === "申购" || type === "赎回"
}

function underlyingFormType(type: string): UnderlyingTradeType | null {
  if (isUnderlyingTradeType(type)) return type
  if (type === "初次申购" || type === "追加申购") return "申购"
  return null
}

function formatInstructionDateTime(value: string | null | undefined): string {
  if (!value) return "-"
  return value.replace("T", " ").slice(0, 19)
}

function formatTemporaryOpenLabel(value: string | null | undefined): string {
  if (!value) return "-"
  if (value.includes("不可")) return "否"
  if (value.includes("可")) return "是"
  return value
}

function approvalStatusFromProgress(progress: string): string {
  if (!progress) return "待审批"
  if (isInstructionRejected(progress)) return "已驳回"
  if (isInstructionPendingApproval(progress)) return "待审批"
  if (
    progress.includes("待执行")
    || progress.includes("待确认")
    || progress.includes("已确认")
    || progress.includes("已完成")
    || progress.includes("结束")
    || progress.includes("已通过")
  ) {
    return "已通过"
  }
  return progress
}

function executionStatusFromProgress(progress: string): string {
  if (isInstructionExecuted(progress)) return "已执行"
  if (isInstructionAwaitingExecute(progress)) return "待执行"
  if (isInstructionPendingApproval(progress) || isInstructionRejected(progress)) return "待执行"
  return "待执行"
}

function hasPositiveHolding(
  marketValue: string | null | undefined,
  investmentShares: string | null | undefined,
): boolean {
  const mv = Number(String(marketValue ?? "").replace(/,/g, "").trim())
  if (Number.isFinite(mv) && mv > 0) return true
  const sh = Number(String(investmentShares ?? "").replace(/,/g, "").trim())
  return Number.isFinite(sh) && sh > 0
}

function DetailField({
  label,
  value,
  accent = false,
  fullWidth = false,
}: {
  label: string
  value: ReactNode
  accent?: boolean
  fullWidth?: boolean
}) {
  return (
    <div className={["flex items-start gap-1 text-sm min-w-0", fullWidth ? "sm:col-span-2" : ""].join(" ")}>
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{label}:</span>
      <span
        className={[
          "min-w-0 break-words",
          accent ? "font-medium text-red-500" : "text-zinc-800 dark:text-zinc-100",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  )
}

function AttachmentDetailValue({
  attachment,
}: {
  attachment: InstructionAttachmentMeta | null | undefined
}) {
  if (!attachment?.id || !attachment.name) return <>{cellDash(null)}</>
  return (
    <button
      type="button"
      onClick={() => {
        void openInstructionAttachment(attachment.id).catch(() => {
          window.alert("无法打开附件，文件可能已被清除")
        })
      }}
      className="text-left text-sky-600 hover:underline dark:text-sky-400"
      title={attachment.name}
    >
      {attachment.name}
    </button>
  )
}

function InstructionDetailDialog({
  open,
  record,
  onClose,
  onRequestExecute,
  onRequestConfirm,
}: {
  open: boolean
  record: InstructionRecord | null
  onClose: () => void
  onRequestExecute?: (record: InstructionRecord) => void
  onRequestConfirm?: (record: InstructionRecord) => void
}) {
  const { toast } = useToast()
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [temporaryOpen, setTemporaryOpen] = useState<string | null>(null)
  const [approvalRemark, setApprovalRemark] = useState("")
  const [approving, setApproving] = useState(false)
  const tradeSectionRef = useRef<HTMLElement>(null)
  const approvalSectionRef = useRef<HTMLElement>(null)
  const executeSectionRef = useRef<HTMLElement>(null)
  const confirmSectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open || !record) {
      setOpenDay(null)
      setTemporaryOpen(null)
      return
    }

    if (!record.underlyingBeianHao && !record.underlyingFundName) {
      setOpenDay(null)
      setTemporaryOpen(null)
      return
    }
    const ac = new AbortController()
    const params = new URLSearchParams({
      beian_hao: record.underlyingBeianHao || record.underlyingFundName,
      product_name: record.underlyingFundName,
    })
    fetch(`/ma/api/ops/fund-elements?${params}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("elements not found")
        return r.json()
      })
      .then((d: { open_day?: string | null; is_temporary_open?: string | null }) => {
        if (ac.signal.aborted) return
        setOpenDay(d.open_day ?? null)
        setTemporaryOpen(d.is_temporary_open ?? null)
      })
      .catch(() => {
        if (ac.signal.aborted) return
        setOpenDay(null)
        setTemporaryOpen(null)
      })
    return () => ac.abort()
  }, [open, record?.id, record?.underlyingBeianHao, record?.underlyingFundName])

  // Legacy rows may still store "申购"; refine once and persist so list/detail stay in sync.
  useEffect(() => {
    if (!open || !record) return
    if (record.type !== "申购") return
    if (!record.fofFundName || !record.underlyingFundName) {
      updateInstructionRecord(record.id, { type: "初次申购" })
      return
    }
    const ac = new AbortController()
    const params = new URLSearchParams({
      page: "1",
      pageSize: "50",
      fof_fund_name: record.fofFundName,
      keyword: record.underlyingFundName,
    })
    fetch(`/ma/api/investment/fof-underlying-detail/list?${params}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((d: { data?: unknown }) => {
        if (ac.signal.aborted) return
        const rows = Array.isArray(d.data) ? d.data : []
        const match = rows.find((row) => {
          const r = row as {
            beian_hao?: string | null
            product_name?: string | null
            short_name?: string | null
          }
          return (
            (record.underlyingBeianHao && r.beian_hao === record.underlyingBeianHao)
            || r.product_name === record.underlyingFundName
            || r.short_name === record.underlyingFundName
          )
        }) as
          | {
              market_value?: string | null
              investment_shares?: string | null
            }
          | undefined
        const holding = Boolean(
          match
          && hasPositiveHolding(match.market_value, match.investment_shares),
        )
        updateInstructionRecord(record.id, { type: holding ? "追加申购" : "初次申购" })
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          updateInstructionRecord(record.id, { type: "初次申购" })
        }
      })
    return () => ac.abort()
  }, [
    open,
    record?.id,
    record?.type,
    record?.fofFundName,
    record?.underlyingFundName,
    record?.underlyingBeianHao,
  ])

  useEffect(() => {
    if (!open || !record) {
      setApprovalRemark("")
      setApproving(false)
      return
    }
    setApprovalRemark(record.approvalRemark || "")
    setApproving(false)
  }, [open, record?.id, record?.approvalRemark])

  const timelineSteps = record ? instructionTimelineSteps(record) : []
  const activeStepIndex = record ? instructionTimelineActiveIndex(record) : 0
  const workflowFinished = record ? isInstructionWorkflowFinished(record) : false
  const activeStepLabel = timelineSteps[activeStepIndex] || ""

  useEffect(() => {
    if (!open || !record) return
    const target =
      activeStepLabel === "总经理审批"
        ? approvalSectionRef.current
        : activeStepLabel === "产品运维执行"
          ? executeSectionRef.current
          : activeStepLabel === "产品运维确认"
            ? confirmSectionRef.current
            : activeStepLabel === "基金经理发起"
              ? tradeSectionRef.current
              : null
    if (!target) return
    const id = window.setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 60)
    return () => window.clearTimeout(id)
  }, [open, record?.id, record?.progress, activeStepLabel])

  if (!open || !record) return null

  const operator = resolveInstructionInitiatorDisplay(
    record.initiator,
    record.initiatorUserId,
  )
  const operatedAt = formatInstructionDateTime(record.createdAt)
  const approverName = (record.approver || "").trim() || "-"
  const approvedAt = formatInstructionDateTime(record.approvedAt)
  const amountText =
    record.amount && record.amount !== "-"
      ? `${record.amount}${String(record.amount).includes("元") ? "" : " 元"}`
      : "-"
  const fofLabel =
    record.category === "direct"
      ? "投资者名称"
      : record.category === "customer"
        ? "客户名称"
        : record.category === "pool"
          ? "基金/管理人名称"
          : "FOF基金"
  const underlyingLabel =
    record.category === "direct"
      ? "直投产品"
      : record.category === "customer" || record.category === "pool"
        ? "基金名称"
        : "底层基金"
  const approvalStatus = approvalStatusFromProgress(record.progress)
  const displayType = record.type
  const canApprove = canApproveInstruction(record)
  const canExecute = canExecuteInstruction(record)
  const canConfirm = canConfirmInstruction(record)
  const showTradeOps = record.category === "underlying" || record.category === "direct"

  function timelineMeta(label: string, index: number): { name: string; at: string } | null {
    if (index === 0) return { name: operator, at: operatedAt }
    if (label === "总经理审批" && record.approver && record.approvedAt) {
      return { name: approverName, at: approvedAt }
    }
    return null
  }

  function handleApproval(decision: "approve" | "reject") {
    if (!canApprove || approving) return
    setApproving(true)
    const now = new Date().toISOString()
    const updated = updateInstructionRecord(record.id, {
      progress: decision === "approve" ? progressAfterApproval(record) : "已驳回",
      approvalRemark: approvalRemark.trim() || null,
      approver: currentInstructionInitiator(),
      approverUserId: currentInstructionUserId() || undefined,
      approvedAt: now,
    })
    setApproving(false)
    if (!updated) {
      toast({ title: "审批失败", description: "指令可能已被删除" })
      return
    }
    toast({
      title: decision === "approve" ? "审批已通过" : "审批已驳回",
      description:
        decision === "approve"
          ? progressAfterApproval(record).includes("待执行")
            ? "已进入产品运维执行"
            : "指令流程已结束"
          : "指令已驳回",
    })
  }

  return (
    <InstructionModalFrame
      onClose={onClose}
      className="flex w-full max-w-[920px] max-h-[min(860px,calc(100vh-2rem))] flex-col overflow-hidden rounded-lg bg-background shadow-xl"
    >
        <div className="flex items-center justify-between border-b px-5 py-3.5 flex-shrink-0">
          <span className="text-[15px] font-medium text-zinc-800 dark:text-zinc-100">指令详情</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="w-[200px] shrink-0 border-r border-zinc-100 bg-zinc-50/70 px-4 py-5 dark:border-zinc-800 dark:bg-zinc-900/40 overflow-y-auto">
            <ol className="relative space-y-0">
              {timelineSteps.map((label, index) => {
                const rejected = isInstructionRejected(record.progress)
                const done = rejected
                  ? index < activeStepIndex
                  : workflowFinished
                    ? index <= activeStepIndex
                    : index < activeStepIndex
                const current = !workflowFinished && !rejected && index === activeStepIndex
                const rejectedCurrent = rejected && index === activeStepIndex
                const isLast = index === timelineSteps.length - 1
                const meta = done || (rejectedCurrent && Boolean(record.approver))
                  ? timelineMeta(label, index)
                  : null
                return (
                  <li key={label} className="relative flex gap-3 pb-6 last:pb-0">
                    {!isLast ? (
                      <span
                        className={[
                          "absolute left-[7px] top-4 bottom-0 w-px",
                          done ? "bg-red-300 dark:bg-red-900" : "bg-zinc-200 dark:bg-zinc-700",
                        ].join(" ")}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span
                      className={[
                        "relative z-[1] mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 bg-background",
                        done
                          ? "border-red-500 bg-red-500"
                          : current || rejectedCurrent
                            ? "border-red-500"
                            : "border-zinc-300 dark:border-zinc-600",
                      ].join(" ")}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 pt-0.5">
                      <div
                        className={[
                          "text-sm leading-snug",
                          done || current || rejectedCurrent
                            ? "font-medium text-zinc-800 dark:text-zinc-100"
                            : "text-zinc-500 dark:text-zinc-400",
                        ].join(" ")}
                      >
                        {label}
                      </div>
                      {meta ? (
                        <div className="mt-1 space-y-0.5 text-xs text-zinc-400">
                          <div>{meta.name}</div>
                          <div>{meta.at}</div>
                        </div>
                      ) : current ? (
                        <div className="mt-1 text-xs text-red-500">进行中</div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          </aside>

          <div className="min-w-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex items-center justify-end text-xs text-zinc-400">
              操作: {operator} ({operatedAt})
            </div>

            <section
              ref={tradeSectionRef}
              className={[
                "mb-5 rounded-md transition-colors",
                activeStepLabel === "基金经理发起" ? "bg-red-50/50 ring-1 ring-red-100 dark:bg-red-950/20 dark:ring-red-900/40" : "",
              ].join(" ")}
            >
              <div className="mb-3 flex items-center gap-2 px-1 pt-1">
                <span className="h-3.5 w-1 rounded-sm bg-red-500" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">交易信息</h3>
              </div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 px-1 pb-1 sm:grid-cols-2">
                <DetailField label="指令ID" value={record.id} />
                <DetailField label="指令类型" value={displayType} accent />
                <DetailField label={fofLabel} value={cellDash(record.fofFundName)} />
                <DetailField
                  label="开放日"
                  value={openDay?.trim() || "-"}
                />
                <DetailField label={underlyingLabel} value={cellDash(record.underlyingFundName)} />
                <DetailField
                  label="是否临开"
                  value={formatTemporaryOpenLabel(temporaryOpen)}
                />
                <DetailField label="交易申请日期" value={cellDash(record.applyDate)} />
                <DetailField label="申请金额" value={amountText} accent />
                {record.shares ? (
                  <DetailField label="申请份额" value={`${record.shares} 份`} />
                ) : null}
                <DetailField
                  label="指令摘要"
                  value={cellDash(record.summary)}
                  fullWidth
                />
              </div>
            </section>

            <section
              ref={approvalSectionRef}
              className={[
                "mb-5 rounded-md transition-colors",
                activeStepLabel === "总经理审批" ? "bg-red-50/50 ring-1 ring-red-100 dark:bg-red-950/20 dark:ring-red-900/40" : "",
              ].join(" ")}
            >
              <div className="mb-3 flex items-center gap-2 px-1 pt-1">
                <span className="h-3.5 w-1 rounded-sm bg-red-500" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">审批信息</h3>
              </div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-3 px-1 pb-1 sm:grid-cols-2">
                <DetailField label="审批" value={approvalStatus} accent />
                {canApprove ? (
                  <label className="sm:col-span-2 block text-sm">
                    <span className="mb-1 block text-zinc-500 dark:text-zinc-400">审批备注</span>
                    <textarea
                      value={approvalRemark}
                      onChange={(e) => setApprovalRemark(e.target.value)}
                      rows={3}
                      placeholder="请输入审批意见（可选）"
                      className="w-full resize-y rounded border border-border bg-background px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                    />
                  </label>
                ) : (
                  <DetailField
                    label="审批备注"
                    value={cellDash(record.approvalRemark)}
                    fullWidth
                  />
                )}
                {record.approver ? (
                  <>
                    <DetailField label="审批人" value={approverName} />
                    <DetailField label="审批时间" value={approvedAt} />
                  </>
                ) : null}
              </div>
            </section>

            {showTradeOps ? (
              <>
                <section
                  ref={executeSectionRef}
                  className={[
                    "mb-5 rounded-md transition-colors",
                    activeStepLabel === "产品运维执行" ? "bg-red-50/50 ring-1 ring-red-100 dark:bg-red-950/20 dark:ring-red-900/40" : "",
                  ].join(" ")}
                >
                  <div className="mb-3 flex items-center justify-between gap-2 px-1 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="h-3.5 w-1 rounded-sm bg-red-500" aria-hidden="true" />
                      <h3 className="text-sm font-semibold text-foreground">执行信息</h3>
                    </div>
                    {canExecute && onRequestExecute ? (
                      <button
                        type="button"
                        onClick={() => onRequestExecute(record)}
                        className="rounded bg-amber-500 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600"
                      >
                        去执行
                      </button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 gap-x-8 gap-y-3 px-1 pb-1 sm:grid-cols-2">
                    <DetailField
                      label="执行"
                      value={executionStatusFromProgress(record.progress)}
                      accent
                    />
                    <DetailField
                      label="实际申请日期"
                      value={cellDash(record.actualApplyDate)}
                    />
                    <DetailField
                      label="执行备注"
                      value={cellDash(record.execRemark)}
                      fullWidth
                    />
                    {requiresContractAtExecute(record.type) ? (
                      <DetailField
                        label="合同"
                        value={<AttachmentDetailValue attachment={record.contractAttachment} />}
                        fullWidth
                      />
                    ) : null}
                  </div>
                </section>

                <section
                  ref={confirmSectionRef}
                  className={[
                    "rounded-md transition-colors",
                    activeStepLabel === "产品运维确认" ? "bg-red-50/50 ring-1 ring-red-100 dark:bg-red-950/20 dark:ring-red-900/40" : "",
                  ].join(" ")}
                >
                  <div className="mb-3 flex items-center justify-between gap-2 px-1 pt-1">
                    <div className="flex items-center gap-2">
                      <span className="h-3.5 w-1 rounded-sm bg-red-500" aria-hidden="true" />
                      <h3 className="text-sm font-semibold text-foreground">确认信息</h3>
                    </div>
                    {canConfirm && onRequestConfirm ? (
                      <button
                        type="button"
                        onClick={() => onRequestConfirm(record)}
                        className="rounded bg-emerald-500 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600"
                      >
                        去确认
                      </button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 gap-x-8 gap-y-3 px-1 pb-1 sm:grid-cols-2">
                    <DetailField label="交易确认日期" value={cellDash(record.confirmDate)} />
                    <DetailField label="交易费用" value={cellDash(record.tradeFee)} />
                    <DetailField label="确认单位净值" value={cellDash(record.nav)} />
                    <DetailField label="确认金额" value={cellDash(record.amount)} />
                    <DetailField label="确认份额" value={cellDash(record.shares)} />
                    <DetailField
                      label="修改理由"
                      value={cellDash(record.modifyReason)}
                      fullWidth
                    />
                    <DetailField
                      label="确认函/确认单"
                      value={<AttachmentDetailValue attachment={record.confirmAttachment} />}
                      fullWidth
                    />
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3 flex-shrink-0">
          {canApprove ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded border px-4 py-1.5 text-sm transition-colors hover:bg-muted"
              >
                关闭
              </button>
              <button
                type="button"
                disabled={approving}
                onClick={() => handleApproval("reject")}
                className="rounded border border-zinc-300 px-4 py-1.5 text-sm transition-colors hover:bg-muted disabled:opacity-60 dark:border-zinc-600"
              >
                驳回
              </button>
              <button
                type="button"
                disabled={approving}
                onClick={() => handleApproval("approve")}
                className="rounded bg-red-500 px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-60"
              >
                {approving ? "提交中…" : "通过"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-red-500 px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-600"
            >
              关闭
            </button>
          )}
        </div>
    </InstructionModalFrame>
  )
}

function canExecuteTrade(row: InstructionRecord): boolean {
  return canExecuteInstruction(row)
}

function canConfirmTrade(row: InstructionRecord): boolean {
  return canConfirmInstruction(row)
}

function renderInstructionCell(
  colKey: string,
  row: InstructionRecord,
  index: number,
  onVoid: (row: InstructionRecord) => void,
  onEdit: (row: InstructionRecord) => void,
  onDetail: (row: InstructionRecord) => void,
  onExecuteTrade: (row: InstructionRecord) => void,
  onConfirmTrade: (row: InstructionRecord) => void,
) {
  switch (colKey) {
    case "index":
      return index
    case "id":
      return row.id
    case "fof":
    case "investor":
    case "customer":
      return row.fofFundName
    case "type":
      return (
        <span className="inline-flex rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
          {row.type}
        </span>
      )
    case "underlying":
    case "fundName":
    case "fundManager":
    case "directProduct":
      return row.underlyingFundName
    case "createdAt":
      return row.createdAt ? row.createdAt.replace("T", " ").slice(0, 19) : "-"
    case "applyDate":
      return row.applyDate
    case "amount":
      return row.amount
    case "shares":
      return cellDash(row.shares)
    case "nav":
      return cellDash(row.nav)
    case "progress":
    case "status":
      return (
        <span className="inline-flex rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {row.progress}
        </span>
      )
    case "initiator":
      return resolveInstructionInitiatorDisplay(row.initiator, row.initiatorUserId)
    case "actions":
      return (
        <div className="inline-flex items-center justify-center gap-1.5 text-zinc-400">
          {canExecuteTrade(row) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onExecuteTrade(row)}
                  className="rounded p-0.5 hover:text-amber-600 dark:hover:text-amber-400"
                  aria-label="产品运维执行"
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>产品运维执行</TooltipContent>
            </Tooltip>
          ) : null}
          {canConfirmTrade(row) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onConfirmTrade(row)}
                  className="rounded p-0.5 hover:text-emerald-600 dark:hover:text-emerald-400"
                  aria-label="产品运维确认"
                >
                  <BadgeCheck className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>产品运维确认</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onVoid(row)}
                className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200"
                aria-label="作废"
              >
                <ClipboardX className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>作废</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onEdit(row)}
                className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200"
                aria-label="编辑"
              >
                <FilePenLine className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>编辑</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200"
                aria-label="复制"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>复制</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onDetail(row)}
                className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200"
                aria-label="详情"
              >
                <FileText className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>详情</TooltipContent>
          </Tooltip>
        </div>
      )
    default:
      return "-"
  }
}

export function InstructionsListView({ variant }: { variant: InstructionsListVariant }) {
  const { toast } = useToast()
  const isAll = variant === "all"
  const tabs = isAll ? ALL_TABS : STANDARD_TABS

  const [categoryTab, setCategoryTab] = useState<CategoryTab>("underlying")
  const [processStatus, setProcessStatus] = useState<ProcessStatus>("pending")
  const [fofInput, setFofInput] = useState("")
  const [underlyingInput, setUnderlyingInput] = useState("")
  const [customerInput, setCustomerInput] = useState("")
  const [keywordField, setKeywordField] = useState<KeywordField>("fof")
  const [keyword, setKeyword] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [appliedFof, setAppliedFof] = useState("")
  const [appliedUnderlying, setAppliedUnderlying] = useState("")
  const [appliedDateFrom, setAppliedDateFrom] = useState("")
  const [appliedDateTo, setAppliedDateTo] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [pageInput, setPageInput] = useState("1")
  const [showFieldConfig, setShowFieldConfig] = useState(false)
  const [voidTarget, setVoidTarget] = useState<InstructionRecord | null>(null)
  const [executeTarget, setExecuteTarget] = useState<InstructionRecord | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<InstructionRecord | null>(null)
  const [detailTarget, setDetailTarget] = useState<InstructionRecord | null>(null)
  const [editTarget, setEditTarget] = useState<InstructionRecord | null>(null)
  const [selectedFields, setSelectedFields] = useState<string[]>(() => [...INSTRUCTION_FIELD_DEFAULT])

  const allRecords = useSyncExternalStore(
    subscribeInstructionRecords,
    getInstructionRecordsSnapshot,
    getInstructionRecordsServerSnapshot,
  )

  useEffect(() => {
    setSelectedFields(readInstructionFieldConfig())
  }, [])

  useEffect(() => {
    backfillLedgerFromConfirmedInstructions()
  }, [])

  const columns = useMemo(
    () => buildColumns(categoryTab, selectedFields, isAll),
    [categoryTab, selectedFields, isAll],
  )

  const showProcessStatus = variant === "handled"

  const viewerUserId = currentInstructionUserId()

  const filteredRows = useMemo(() => {
    let next = listInstructionRecords({ category: categoryTab, variant })
    if (variant === "handled") {
      next = next.filter((r) =>
        processStatus === "pending"
          ? isInstructionPendingForCurrentUser(r)
          : isInstructionDoneForCurrentUser(r),
      )
    }
    if (categoryTab === "underlying") {
      const fofQ = appliedFof.trim()
      const undQ = appliedUnderlying.trim()
      if (fofQ) next = next.filter((r) => r.fofFundName.includes(fofQ))
      if (undQ) next = next.filter((r) => r.underlyingFundName.includes(undQ))
      if (appliedDateFrom) next = next.filter((r) => r.applyDate >= appliedDateFrom)
      if (appliedDateTo) next = next.filter((r) => r.applyDate <= appliedDateTo)
    }
    return next
  }, [
    allRecords,
    categoryTab,
    variant,
    processStatus,
    viewerUserId,
    appliedFof,
    appliedUnderlying,
    appliedDateFrom,
    appliedDateTo,
  ])

  const total = filteredRows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rows = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredRows.slice(start, start + pageSize)
  }, [filteredRows, page, pageSize])

  function resetFilters() {
    setFofInput("")
    setUnderlyingInput("")
    setCustomerInput("")
    setKeyword("")
    setKeywordField(
      categoryTab === "pool" || categoryTab === "customer" ? "fundName" : "fof",
    )
    setDateFrom("")
    setDateTo("")
    setAppliedFof("")
    setAppliedUnderlying("")
    setAppliedDateFrom("")
    setAppliedDateTo("")
    setPage(1)
    setPageInput("1")
  }

  function handleSearch() {
    setAppliedFof(fofInput)
    setAppliedUnderlying(underlyingInput)
    setAppliedDateFrom(dateFrom)
    setAppliedDateTo(dateTo)
    setPage(1)
    setPageInput("1")
  }

  function handleEdit(row: InstructionRecord) {
    if (row.category === "underlying" && underlyingFormType(row.type)) {
      setEditTarget(row)
      return
    }
    toast({
      title: "暂不支持编辑",
      description: `${row.type}指令的编辑表单正在建设中。`,
    })
  }

  const editFormType = editTarget ? underlyingFormType(editTarget.type) : null
  if (editTarget && editFormType) {
    return (
      <UnderlyingSubscribeForm
        instructionType={editFormType}
        initialRecord={editTarget}
        onBack={() => setEditTarget(null)}
      />
    )
  }

  function goToPage(next: number) {
    const clamped = Math.min(totalPages, Math.max(1, next))
    setPage(clamped)
    setPageInput(String(clamped))
  }

  const isPoolTab = categoryTab === "pool"
  const showUnderlyingFundFilters = !isAll && categoryTab === "underlying"
  const showFundKeyword = !isAll && categoryTab === "direct"
  const showCustomerFilter = !isAll && categoryTab === "customer"
  const showPoolKeyword = isPoolTab
  /** 所有指令 → 底层: keyword field dropdown (FOF/底层/ID) */
  const showAllUnderlyingKeyword = isAll && categoryTab === "underlying"
  /** 所有指令 → 直投: simple keyword (no field dropdown) */
  const showAllDirectKeyword = isAll && categoryTab === "direct"
  /** 所有指令 → 客户: keyword dropdown (基金名称) */
  const showAllCustomerKeyword = isAll && categoryTab === "customer"
  const showDateFilter = !isPoolTab
  /** 所有指令 → 入/出池: no 字段配置 / 分级修正, only 导出 */
  const showFieldConfigButton = !(isAll && isPoolTab)
  const showGradeCorrection = isAll && !isPoolTab
  const showQueryActions = !isPoolTab
  const hideInitiatorInFieldConfig =
    categoryTab === "customer" || (!isAll && categoryTab === "direct")

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center gap-0 border-b mb-4 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setCategoryTab(tab.key)
              if (tab.key === "pool" || tab.key === "customer") {
                setKeywordField("fundName")
              } else if (tab.key === "underlying") {
                setKeywordField("fof")
              }
              setPage(1)
              setPageInput("1")
            }}
            className={[
              "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              categoryTab === tab.key
                ? "border-red-500 text-red-600 dark:text-red-400"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 flex-shrink-0">
        {showProcessStatus && (
          <div className="inline-flex items-center rounded-md overflow-hidden border border-border/80">
            {([
              ["pending", "待处理"],
              ["done", "已处理"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setProcessStatus(key)
                  setPage(1)
                  setPageInput("1")
                }}
                className={[
                  "h-8 px-3.5 text-sm transition-colors",
                  processStatus === key
                    ? "bg-red-500 text-white"
                    : "bg-background text-zinc-600 hover:bg-muted/50",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {showAllUnderlyingKeyword && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">关键字</span>
            <div className="relative">
              <select
                value={keywordField}
                onChange={(e) => setKeywordField(e.target.value as KeywordField)}
                className="h-8 appearance-none rounded-md border border-border bg-background pl-2.5 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {KEYWORD_FIELD_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            </div>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
              placeholder="请输入关键字，回车搜索"
              className="h-8 w-56 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {showAllDirectKeyword && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">关键字</span>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
              placeholder="输入基金名称/指令ID，回车以搜索"
              className="h-8 w-64 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {showAllCustomerKeyword && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">关键字</span>
            <div className="relative">
              <select
                value={keywordField}
                onChange={(e) => setKeywordField(e.target.value as KeywordField)}
                className="h-8 appearance-none rounded-md border border-border bg-background pl-2.5 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {CUSTOMER_KEYWORD_FIELD_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            </div>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
              placeholder="请输入关键字，回车搜索"
              className="h-8 w-56 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {showUnderlyingFundFilters && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 shrink-0">FOF基金</span>
              <input
                value={fofInput}
                onChange={(e) => setFofInput(e.target.value)}
                placeholder="请输入并选择FOF基金"
                className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 shrink-0">底层基金</span>
              <input
                value={underlyingInput}
                onChange={(e) => setUnderlyingInput(e.target.value)}
                placeholder="请输入并选择底层基金"
                className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </>
        )}

        {showFundKeyword && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">基金</span>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
              placeholder="请输入关键字，回车搜索"
              className="h-8 w-56 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {showCustomerFilter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">客户</span>
            <input
              value={customerInput}
              onChange={(e) => setCustomerInput(e.target.value)}
              placeholder="请输入并选择客户"
              className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {showPoolKeyword && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">关键字</span>
            <div className="relative">
              <select
                value={keywordField}
                onChange={(e) => setKeywordField(e.target.value as KeywordField)}
                className="h-8 appearance-none rounded-md border border-border bg-background pl-2.5 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {POOL_KEYWORD_FIELD_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            </div>
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch()
              }}
              placeholder="请输入关键字，回车搜索"
              className="h-8 w-56 rounded-md border border-border bg-background px-2.5 text-xs placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {showDateFilter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 shrink-0">交易申请日期</span>
            <div className="flex items-center gap-1.5">
              <FilterDateInput
                value={dateFrom}
                onChange={setDateFrom}
                placeholder="请选择开始日期"
              />
              <span className="text-zinc-400">-</span>
              <FilterDateInput
                value={dateTo}
                onChange={setDateTo}
                placeholder="请选择结束日期"
              />
            </div>
          </div>
        )}

        {showQueryActions && (
          <>
            <button
              type="button"
              onClick={handleSearch}
              className="h-8 px-4 rounded-md bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
            >
              查询
            </button>
            {!isAll && (
              <button
                type="button"
                onClick={resetFilters}
                className="h-8 px-4 rounded-md border border-border bg-background text-sm text-zinc-600 hover:bg-muted/50 transition-colors"
              >
                重置
              </button>
            )}
          </>
        )}

        {(showFieldConfigButton || isAll) && (
          <div className="ml-auto flex items-center gap-3">
            {showFieldConfigButton && (
              <button
                type="button"
                onClick={() => setShowFieldConfig(true)}
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground transition-colors"
              >
                <Settings2 className="h-3.5 w-3.5" />
                字段配置
              </button>
            )}
            {isAll && (
              <>
                <button
                  type="button"
                  disabled={total === 0}
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出
                </button>
                {showGradeCorrection && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-foreground transition-colors"
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                    分级修正
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 bg-background border rounded-xl shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm border-collapse min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-muted/40 dark:bg-muted/20">
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className={[thBase, col.width].join(" ")}>
                    <ColumnHeader
                      label={col.label}
                      sort={Boolean(col.sort)}
                      filter={Boolean(col.filter)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className="border-t border-zinc-100 hover:bg-muted/30 dark:border-zinc-800"
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={[
                          "px-3 py-2.5 text-sm text-zinc-700 dark:text-zinc-200 whitespace-nowrap",
                          col.key === "index" || col.key === "actions" ? "text-center" : "",
                          col.width,
                        ].join(" ")}
                      >
                        {renderInstructionCell(
                          col.key,
                          row,
                          (page - 1) * pageSize + i + 1,
                          setVoidTarget,
                          handleEdit,
                          setDetailTarget,
                          setExecuteTarget,
                          setConfirmTarget,
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="h-56">
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                      <Inbox className="h-10 w-10 text-zinc-300 dark:text-zinc-600" strokeWidth={1} />
                      <span className="text-sm">暂无数据</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3 border-t flex-shrink-0 text-sm text-zinc-500">
          <span>共 {total} 条</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="p-1 rounded hover:bg-muted/60 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              ‹
            </button>
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ""))}
              onBlur={() => goToPage(Number(pageInput) || 1)}
              onKeyDown={(e) => {
                if (e.key === "Enter") goToPage(Number(pageInput) || 1)
              }}
              className="w-10 h-7 text-center rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              className="p-1 rounded hover:bg-muted/60 disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              ›
            </button>
          </div>
          <div className="relative">
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
                setPageInput("1")
              }}
              className="h-8 appearance-none rounded border border-border bg-background pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {[20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} 条/页
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>

      <InstructionsFieldConfigDialog
        open={showFieldConfig}
        selected={selectedFields}
        hiddenFields={hideInitiatorInFieldConfig ? ["发起人"] : undefined}
        lockedFields={
          hideInitiatorInFieldConfig
            ? INSTRUCTION_FIELD_LOCKED.filter((f) => f !== "发起人")
            : undefined
        }
        onClose={() => setShowFieldConfig(false)}
        onConfirm={(fields) => {
          // Persist 发起人 for 底层申赎 even when configuring 直投/客户 tabs
          const stored =
            hideInitiatorInFieldConfig && !fields.includes("发起人")
              ? [...fields, "发起人"]
              : fields
          setSelectedFields(stored)
          writeInstructionFieldConfig(stored)
          setShowFieldConfig(false)
        }}
      />

      <VoidInstructionDialog
        open={Boolean(voidTarget)}
        instructionId={voidTarget?.id ?? ""}
        onClose={() => setVoidTarget(null)}
        onConfirm={() => {
          if (!voidTarget) return
          if (isInstructionConfirmed(voidTarget.progress)) {
            removeLedgerByInstructionId(voidTarget.id)
          }
          removeInstructionRecord(voidTarget.id)
          setVoidTarget(null)
          toast({ title: "指令已作废" })
        }}
      />

      <ExecuteTradeDialog
        open={Boolean(executeTarget)}
        record={executeTarget}
        onClose={() => setExecuteTarget(null)}
        onExecute={(payload) => {
          if (!executeTarget) return
          const now = new Date().toISOString()
          const updated = updateInstructionRecord(executeTarget.id, {
            progress: progressAfterExecute(executeTarget),
            actualApplyDate: payload.actualApplyDate,
            execRemark: payload.execRemark || null,
            contractAttachment: payload.contractAttachment,
            executorUserId: currentInstructionUserId() || undefined,
            executedAt: now,
          })
          if (updated) {
            toast({
              title: "执行完成",
              description: requiresContractAtExecute(updated.type)
                ? "合同已记录，请继续产品运维确认"
                : "请继续产品运维确认",
            })
          }
          setExecuteTarget(null)
        }}
      />

      <ConfirmTradeDialog
        open={Boolean(confirmTarget)}
        record={confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirm={(payload) => {
          if (!confirmTarget) return
          const now = new Date().toISOString()
          const updated = updateInstructionRecord(confirmTarget.id, {
            progress: "已确认",
            confirmDate: payload.confirmDate,
            amount: payload.amount,
            shares: payload.shares || null,
            nav: payload.nav,
            tradeFee: payload.tradeFee,
            modifyReason: payload.modifyReason || null,
            confirmAttachment: payload.confirmAttachment,
            confirmerUserId: currentInstructionUserId() || undefined,
            confirmedAt: now,
          })
          if (updated) {
            upsertLedgerFromConfirmedInstruction(updated)
            toast({ title: "交易已确认", description: "已同步写入 FOF 台账（来源：指令）" })
          }
          setConfirmTarget(null)
        }}
      />

      <InstructionDetailDialog
        open={Boolean(detailTarget)}
        record={
          detailTarget
            ? (allRecords.find((r) => r.id === detailTarget.id) ?? detailTarget)
            : null
        }
        onClose={() => setDetailTarget(null)}
        onRequestExecute={(row) => {
          setDetailTarget(null)
          setExecuteTarget(row)
        }}
        onRequestConfirm={(row) => {
          setDetailTarget(null)
          setConfirmTarget(row)
        }}
      />
    </div>
  )
}
