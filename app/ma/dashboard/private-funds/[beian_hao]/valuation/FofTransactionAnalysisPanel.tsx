"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { CalendarDays, ChevronDown, ChevronRight, Inbox } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { openInstructionAttachment } from "../../components/instruction-attachment-files"
import { isEmailConfirmAttachmentId } from "../../components/instructions-store"
import {
  backfillLedgerFromConfirmedInstructions,
  getLedgerRecordsServerSnapshot,
  getLedgerRecordsSnapshot,
  listLedgerRecords,
  subscribeLedgerRecords,
  type OpsLedgerAttachment,
  type OpsLedgerRow,
} from "../../components/ops-ledger-store"

function formatCell(value: string | null | undefined): string {
  if (value == null || value === "") return "—"
  return value
}

function TxTypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-600 dark:bg-sky-950/40 dark:text-sky-300">
      {type}
    </span>
  )
}

function AttachmentLink({
  attachment,
  onOpen,
}: {
  attachment: OpsLedgerAttachment | null | undefined
  onOpen: (attachment: OpsLedgerAttachment) => void
}) {
  if (!attachment?.id) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(attachment)}
      className="max-w-[160px] truncate text-left text-sky-600 hover:underline dark:text-sky-400"
      title={attachment.name}
    >
      {attachment.name}
    </button>
  )
}

export function FofTransactionAnalysisPanel({
  beianHao,
  productName,
}: {
  beianHao: string
  productName?: string | null
}) {
  const { toast } = useToast()
  const [fofNameInput, setFofNameInput] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [appliedName, setAppliedName] = useState("")
  const [appliedFrom, setAppliedFrom] = useState("")
  const [appliedTo, setAppliedTo] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const allRows = useSyncExternalStore(
    subscribeLedgerRecords,
    getLedgerRecordsSnapshot,
    getLedgerRecordsServerSnapshot,
  )

  useEffect(() => {
    backfillLedgerFromConfirmedInstructions()
  }, [beianHao])

  useEffect(() => {
    setPage(1)
  }, [appliedName, appliedFrom, appliedTo, pageSize, beianHao])

  const listResult = useMemo(
    () =>
      listLedgerRecords({
        page,
        pageSize,
        fof_register_number: beianHao,
        fof_fund_name: productName || undefined,
        underlying_name_q: appliedName || undefined,
        apply_date_from: appliedFrom || undefined,
        apply_date_to: appliedTo || undefined,
        sort: "apply_date",
        dir: "desc",
      }),
    [allRows, page, pageSize, beianHao, productName, appliedName, appliedFrom, appliedTo],
  )

  const data = listResult.data
  const total = listResult.total
  const totalPages = listResult.totalPages

  function applyFilters() {
    setAppliedName(fofNameInput.trim())
    setAppliedFrom(dateFrom)
    setAppliedTo(dateTo)
    setPage(1)
  }

  async function handleOpenAttachment(attachment: OpsLedgerAttachment) {
    try {
      if (
        attachment.source === "email"
        || attachment.confirmRecordId != null
        || isEmailConfirmAttachmentId(attachment.id)
      ) {
        const recordId =
          attachment.confirmRecordId
          ?? (isEmailConfirmAttachmentId(attachment.id)
            ? Number(attachment.id.replace("email-confirm:", ""))
            : null)
        if (recordId != null && Number.isFinite(recordId)) {
          window.open(
            `/ma/api/ops/email-confirm-records/${recordId}/file`,
            "_blank",
            "noopener,noreferrer",
          )
          return
        }
      }
      await openInstructionAttachment(attachment.id)
    } catch (err) {
      toast({
        title: "无法打开附件",
        description: err instanceof Error ? err.message : "附件不存在",
        variant: "destructive",
      })
    }
  }

  function pageButtons(): (number | "…")[] {
    const btns: (number | "…")[] = []
    const lo = Math.max(1, page - 2)
    const hi = Math.min(totalPages, page + 2)
    if (lo > 1) {
      btns.push(1)
      if (lo > 2) btns.push("…")
    }
    for (let i = lo; i <= hi; i++) btns.push(i)
    if (hi < totalPages) {
      if (hi < totalPages - 1) btns.push("…")
      btns.push(totalPages)
    }
    return btns
  }

  const th = "px-3 py-3 text-left text-xs font-semibold text-zinc-500 whitespace-nowrap border-b"

  return (
    <div className="bg-white rounded-lg border border-zinc-100 shadow-sm p-4">
      <div className="flex items-center gap-1.5 text-sm text-zinc-600 mb-4">
        <span>基金</span>
        <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
        <span className="font-medium text-zinc-800">FOF台账</span>
        {productName ? (
          <span className="ml-2 text-xs text-zinc-400 truncate">（{productName}）</span>
        ) : null}
      </div>

      <div className="flex items-center gap-6 flex-wrap mb-4 text-xs">
        <div className="flex items-center">
          <span className="text-zinc-400 shrink-0 pr-3">FOF名称：</span>
          <input
            className="h-7 w-48 border rounded px-2 bg-background outline-none placeholder:text-muted-foreground/50"
            placeholder="底层基金名称"
            value={fofNameInput}
            onChange={(e) => setFofNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyFilters()
            }}
          />
        </div>
        <div className="flex items-center">
          <span className="text-zinc-400 shrink-0 pr-3">申赎日期：</span>
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <CalendarDays className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-7 w-32 border rounded pl-7 pr-2 bg-background outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <span className="text-muted-foreground">-</span>
            <div className="relative">
              <CalendarDays className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-7 w-32 border rounded pl-7 pr-2 bg-background outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={applyFilters}
          className="h-7 px-4 rounded bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
        >
          查询
        </button>
      </div>

      <div className="overflow-auto rounded-lg border">
        <table className="text-sm border-collapse w-full" style={{ minWidth: 1400 }}>
          <thead>
            <tr className="bg-muted/40">
              <th className={`${th} w-12 text-center`}>序号</th>
              <th className={th}>FOF名称</th>
              <th className={th}>交易类型</th>
              <th className={th}>申赎日期</th>
              <th className={th}>确认日期</th>
              <th className={`${th} text-right`}>确认净额</th>
              <th className={`${th} text-right`}>确认份额</th>
              <th className={`${th} text-right`}>确认单位净值</th>
              <th className={`${th} text-right`}>交易费用</th>
              <th className={`${th} text-right`}>业绩报酬</th>
              <th className={th}>合同</th>
              <th className={th}>确认单</th>
              <th className={th}>来源</th>
              <th className={th}>备注</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-20 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                    <span>暂无台账数据</span>
                    <span className="text-xs text-zinc-400">
                      指令进度为「已确认」后，将以来源「指令」同步到此列表
                    </span>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((row: OpsLedgerRow, i) => (
                <tr key={row.id} className="group hover:bg-muted/40">
                  <td className="border-b px-3 py-2 text-center tabular-nums text-muted-foreground">
                    {(page - 1) * pageSize + i + 1}
                  </td>
                  <td className="border-b px-3 py-2 truncate max-w-[180px]" title={row.underlying_fund_name}>
                    {row.underlying_fund_name}
                  </td>
                  <td className="border-b px-3 py-2">
                    <TxTypeBadge type={row.transaction_type} />
                  </td>
                  <td className="border-b px-3 py-2 tabular-nums">{formatCell(row.apply_date)}</td>
                  <td className="border-b px-3 py-2 tabular-nums">{formatCell(row.confirm_date)}</td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">
                    {formatCell(row.confirmed_amount)}
                  </td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">
                    {formatCell(row.confirmed_shares)}
                  </td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">
                    {formatCell(row.confirmed_unit_nav)}
                  </td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">
                    {formatCell(row.transaction_fee)}
                  </td>
                  <td className="border-b px-3 py-2 text-right tabular-nums">
                    {formatCell(row.performance_fee)}
                  </td>
                  <td className="border-b px-3 py-2">
                    <AttachmentLink
                      attachment={row.contract_attachment}
                      onOpen={handleOpenAttachment}
                    />
                  </td>
                  <td className="border-b px-3 py-2">
                    <AttachmentLink
                      attachment={row.confirm_attachment}
                      onOpen={handleOpenAttachment}
                    />
                  </td>
                  <td className="border-b px-3 py-2">{formatCell(row.source)}</td>
                  <td className="border-b px-3 py-2 text-muted-foreground truncate max-w-[120px]">
                    {formatCell(row.remark)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-3">
        <span className="text-sm text-zinc-500">
          共 <span className="font-semibold text-zinc-800">{total.toLocaleString()}</span> 条
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ‹
          </button>
          {pageButtons().map((btn, idx) =>
            btn === "…" ? (
              <span key={`e${idx}`} className="w-7 h-7 flex items-center justify-center text-xs text-muted-foreground">
                …
              </span>
            ) : (
              <button
                key={btn}
                type="button"
                onClick={() => setPage(btn as number)}
                className={[
                  "w-7 h-7 flex items-center justify-center rounded border text-xs transition-colors",
                  btn === page
                    ? "bg-red-500 text-white border-red-500 font-medium"
                    : "text-foreground hover:bg-muted border-border",
                ].join(" ")}
              >
                {btn}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || totalPages <= 1}
            className="w-7 h-7 flex items-center justify-center rounded border text-sm hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ›
          </button>
          <div className="relative ml-3">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
              className="h-7 appearance-none rounded border border-border bg-background pl-2 pr-7 text-xs text-zinc-600 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {[50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n} 条/页
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" />
          </div>
        </div>
      </div>
    </div>
  )
}
