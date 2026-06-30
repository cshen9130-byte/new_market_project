"use client"

import { useEffect, useRef, useState } from "react"
import { CalendarDays, Inbox, Trash2 } from "lucide-react"

interface ScaleRow {
  id: string
  date: string
  amount: string
  source: string
}

interface ScaleBatchPreviewRow {
  seq: number
  date: string
  amount: string
}

const SCALE_UPLOAD_MAX_BYTES = 3 * 1024 * 1024
const SCALE_UPLOAD_ACCEPT = ".xlsx,.xls,.csv"

function parseScaleCsvPreview(text: string): ScaleBatchPreviewRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const rows: ScaleBatchPreviewRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
    if (cols.length >= 2 && cols[0] && cols[1]) {
      rows.push({ seq: rows.length + 1, date: cols[0], amount: cols[1] })
    }
  }
  return rows
}

function downloadScaleUploadTemplate() {
  const csv = "\uFEFF日期,管理规模\n2024-01-01,1000000\n"
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = "规模批量上传模板.csv"
  a.click()
  URL.revokeObjectURL(a.href)
}

function FormLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-sm text-zinc-700 dark:text-zinc-300 shrink-0 w-[7.5rem] text-right pt-2 leading-snug">
      <span className="text-red-500 mr-0.5">*</span>
      {children}
    </label>
  )
}

function AddScaleDialog({
  open,
  onClose,
  onConfirmSingle,
  onConfirmBatch,
}: {
  open: boolean
  onClose: () => void
  onConfirmSingle: (date: string, amount: string) => void
  onConfirmBatch: (rows: ScaleBatchPreviewRow[]) => void
}) {
  const [tab, setTab] = useState<"single" | "batch">("single")
  const [date, setDate] = useState("")
  const [amount, setAmount] = useState("")
  const [saving, setSaving] = useState(false)
  const [batchFile, setBatchFile] = useState<File | null>(null)
  const [batchPreview, setBatchPreview] = useState<ScaleBatchPreviewRow[]>([])
  const [batchError, setBatchError] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTab("single")
    setDate("")
    setAmount("")
    setSaving(false)
    setBatchFile(null)
    setBatchPreview([])
    setBatchError("")
    setIsDragOver(false)
  }, [open])

  async function handleBatchFile(file: File) {
    setBatchError("")
    if (file.size > SCALE_UPLOAD_MAX_BYTES) {
      setBatchFile(null)
      setBatchPreview([])
      setBatchError("文件大小不能超过3M")
      return
    }
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      setBatchFile(null)
      setBatchPreview([])
      setBatchError("只能上传 Excel 文件或 CSV 文件")
      return
    }
    setBatchFile(file)
    if (ext === "csv") {
      const text = await file.text()
      setBatchPreview(parseScaleCsvPreview(text))
    } else {
      setBatchPreview([])
    }
  }

  async function handleConfirm() {
    if (saving) return
    if (tab === "single") {
      if (!date || !amount.trim()) return
      setSaving(true)
      try {
        onConfirmSingle(date, amount.trim())
        onClose()
      } finally {
        setSaving(false)
      }
      return
    }
    if (!batchFile) return
    setSaving(true)
    try {
      onConfirmBatch(batchPreview)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[560px] flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">添加规模</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="px-6 pt-4 pb-3 flex items-center gap-2 flex-shrink-0">
          {([["single", "单条上传"], ["batch", "批量上传"]] as const).map(([key, label]) => (
            <span
              key={key}
              onClick={() => setTab(key)}
              className={[
                "inline-flex items-center px-3 py-1 rounded-full border text-sm cursor-pointer transition-colors",
                tab === key
                  ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950/20 font-medium"
                  : "border-border text-zinc-500 hover:border-red-300 hover:text-red-500",
              ].join(" ")}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4 min-h-[240px]">
          {tab === "single" ? (
            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-4">
                <FormLabel>日期：</FormLabel>
                <div className="flex-1 relative">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full h-9 rounded border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="flex items-start gap-4">
                <FormLabel>管理规模：</FormLabel>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="flex-1 h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <span className="text-sm text-zinc-500 shrink-0">元</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div
                className={[
                  "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
                  isDragOver ? "border-red-400 bg-red-50/50 dark:bg-red-950/20" : "border-border hover:border-red-300 hover:bg-muted/30",
                ].join(" ")}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragOver(false)
                  const file = e.dataTransfer.files?.[0]
                  if (file) void handleBatchFile(file)
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={SCALE_UPLOAD_ACCEPT}
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleBatchFile(file)
                    e.target.value = ""
                  }}
                />
                <Inbox className="h-10 w-10 text-red-500" strokeWidth={1.25} />
                <p className="text-sm">
                  将文件拖到此处，或
                  <span className="text-blue-600 dark:text-blue-400">点击上传</span>
                </p>
                {batchFile && <p className="text-xs text-muted-foreground">{batchFile.name}</p>}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                只能上传 Excel 文件或 CSV 文件，且大小不超过 3M。
                <button type="button" onClick={downloadScaleUploadTemplate} className="text-blue-600 dark:text-blue-400 hover:underline ml-1">
                  点击下载批量上传模板
                </button>
              </p>
              {batchError && <p className="text-xs text-red-500">{batchError}</p>}
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted/40 border-b">
                      <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-16">序号</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">日期</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">管理规模</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchPreview.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-12 text-center text-muted-foreground">
                          <div className="flex flex-col items-center gap-2">
                            <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                            <span className="text-sm">暂无数据</span>
                          </div>
                        </td>
                      </tr>
                    ) : batchPreview.map((row) => (
                      <tr key={row.seq} className="border-b last:border-b-0">
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.seq}</td>
                        <td className="px-4 py-2.5 tabular-nums">{row.date}</td>
                        <td className="px-4 py-2.5 tabular-nums">{row.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t flex-shrink-0">
          <button onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取消</button>
          <button
            disabled={saving || (tab === "single" ? !date || !amount.trim() : !batchFile)}
            onClick={() => void handleConfirm()}
            className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "处理中…" : tab === "batch" ? "上传" : "确定"}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CustomFundScaleManageDialog({
  open,
  productCode,
  productName,
  onClose,
}: {
  open: boolean
  productCode: string | null
  productName: string
  onClose: () => void
}) {
  const [rows, setRows] = useState<ScaleRow[]>([])
  const [showAddDialog, setShowAddDialog] = useState(false)

  useEffect(() => {
    if (!open) return
    setRows([])
    setShowAddDialog(false)
  }, [open, productCode, productName])

  function fmtScaleAmount(v: string): string {
    const n = parseFloat(v.replace(/,/g, ""))
    if (isNaN(n)) return v
    return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  function addSingleRow(date: string, amount: string) {
    setRows((prev) => [{
      id: `${date}-${amount}-${Date.now()}`,
      date,
      amount,
      source: "手动录入",
    }, ...prev])
  }

  function addBatchRows(batchRows: ScaleBatchPreviewRow[]) {
    if (batchRows.length === 0) return
    setRows((prev) => [
      ...batchRows.map((r) => ({
        id: `${r.date}-${r.amount}-${r.seq}-${Date.now()}`,
        date: r.date,
        amount: r.amount,
        source: "批量上传",
      })),
      ...prev,
    ])
  }

  function handleDelete(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div
          className="bg-background rounded-lg shadow-xl w-full max-w-[760px] flex flex-col max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
            <span className="font-semibold text-base">规模管理</span>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
          </div>

          <div className="px-6 pt-4 pb-3 flex items-center justify-between gap-4 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-1 h-4 bg-red-500 shrink-0" />
              <span className="font-semibold text-base truncate">{productName}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowAddDialog(true)}
              className="px-3 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors shrink-0"
            >
              添加规模数据
            </button>
          </div>

          <div className="flex-1 overflow-auto min-h-[280px] px-6 pb-6">
            <table className="w-full text-sm border-collapse border rounded-lg overflow-hidden">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted/40 border-b">
                  <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-16">序号</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-32">日期</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">管理规模</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-zinc-500 w-28">来源</th>
                  <th className="px-4 py-2.5 text-center font-semibold text-zinc-500 w-20">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-16 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                        <span className="text-sm">暂无数据</span>
                      </div>
                    </td>
                  </tr>
                ) : rows.map((row, i) => (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-2.5 tabular-nums">{row.date}</td>
                    <td className="px-4 py-2.5 tabular-nums">{fmtScaleAmount(row.amount)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.source}</td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        type="button"
                        onClick={() => handleDelete(row.id)}
                        className="p-1 text-muted-foreground hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AddScaleDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onConfirmSingle={addSingleRow}
        onConfirmBatch={addBatchRows}
      />
    </>
  )
}
