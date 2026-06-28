"use client"

import { useEffect, useRef, useState } from "react"
import { CalendarDays, Inbox } from "lucide-react"

export type CustomFundNavUploadRow = {
  seq: number
  date: string
  unit_nav: string
  cumulative_nav: string
}

const UPLOAD_MAX_BYTES = 3 * 1024 * 1024
const UPLOAD_ACCEPT = ".xlsx,.xls,.csv"

function parseCsvPreview(text: string): CustomFundNavUploadRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  const rows: CustomFundNavUploadRow[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
    if (cols.length >= 2 && cols[0] && cols[1]) {
      rows.push({
        seq: rows.length + 1,
        date: cols[0],
        unit_nav: cols[1],
        cumulative_nav: cols[2] ?? cols[1],
      })
    }
  }
  return rows
}

function formatUploadDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const text = String(value ?? "").trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  return text
}

function parseSheetPreview(rows: unknown[][]): CustomFundNavUploadRow[] {
  if (rows.length < 2) return []
  const header = rows[0].map((cell) => String(cell ?? "").trim())
  const dateIdx = header.findIndex((h) => /日期|净值日期/.test(h))
  const unitIdx = header.findIndex((h) => /单位净值/.test(h))
  const cumIdx = header.findIndex((h) => /累计净值/.test(h))
  const parsed: CustomFundNavUploadRow[] = []
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (!Array.isArray(row)) continue
    const date = formatUploadDate(row[dateIdx >= 0 ? dateIdx : 0])
    const unitNav = String(row[unitIdx >= 0 ? unitIdx : 1] ?? "").trim()
    const cumulativeNav = String(row[cumIdx >= 0 ? cumIdx : 2] ?? unitNav).trim()
    if (!date || !unitNav) continue
    parsed.push({
      seq: parsed.length + 1,
      date,
      unit_nav: unitNav,
      cumulative_nav: cumulativeNav || unitNav,
    })
  }
  return parsed
}

async function parseXlsxPreview(file: File): Promise<CustomFundNavUploadRow[]> {
  const XLSX = await import("xlsx")
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" })
  return parseSheetPreview(rows)
}

function parsePastePreview(text: string): CustomFundNavUploadRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  const rows: CustomFundNavUploadRow[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/净值日期|单位净值|累计净值/.test(trimmed) && !/\d{4}-\d{2}-\d{2}/.test(trimmed)) continue
    const cols = trimmed.split(/[\s\t,，]+/).map((c) => c.trim()).filter(Boolean)
    if (cols.length >= 2) {
      rows.push({
        seq: rows.length + 1,
        date: cols[0],
        unit_nav: cols[1],
        cumulative_nav: cols[2] ?? cols[1],
      })
    }
  }
  return rows
}

export function downloadCustomFundNavUploadTemplate() {
  const csv = "\uFEFF日期,单位净值,累计净值\n2024-01-01,1.0000,1.0000\n"
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = "批量上传净值模板.csv"
  a.click()
  URL.revokeObjectURL(a.href)
}

function PreviewTable({ rows }: { rows: CustomFundNavUploadRow[] }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted/40 border-b">
            <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">日期</th>
            <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">单位净值</th>
            <th className="px-4 py-2.5 text-left font-semibold text-zinc-500">累计净值</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-12 text-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                  <span className="text-sm">暂无数据</span>
                </div>
              </td>
            </tr>
          ) : rows.map((row) => (
            <tr key={`${row.seq}-${row.date}`} className="border-b last:border-b-0">
              <td className="px-4 py-2.5 tabular-nums">{row.date}</td>
              <td className="px-4 py-2.5 tabular-nums">{row.unit_nav}</td>
              <td className="px-4 py-2.5 tabular-nums">{row.cumulative_nav}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CustomFundNavUploadDialog({
  open,
  scope,
  onClose,
  onUpload,
}: {
  open: boolean
  scope: "team" | "mine"
  onClose: () => void
  onUpload: (rows: Array<{ nav_date: string; unit_nav: string; cumulative_nav: string }>) => Promise<void>
}) {
  const [tab, setTab] = useState<"single" | "batch" | "paste">("batch")
  const [date, setDate] = useState("")
  const [unitNav, setUnitNav] = useState("")
  const [cumulativeNav, setCumulativeNav] = useState("")
  const [pasteText, setPasteText] = useState("")
  const [pasteResult, setPasteResult] = useState<CustomFundNavUploadRow[]>([])
  const [saving, setSaving] = useState(false)
  const [batchFile, setBatchFile] = useState<File | null>(null)
  const [batchPreview, setBatchPreview] = useState<CustomFundNavUploadRow[]>([])
  const [batchError, setBatchError] = useState("")
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTab("batch")
    setDate("")
    setUnitNav("")
    setCumulativeNav("")
    setPasteText("")
    setPasteResult([])
    setSaving(false)
    setBatchFile(null)
    setBatchPreview([])
    setBatchError("")
    setIsDragOver(false)
  }, [open])

  async function handleBatchFile(file: File) {
    setBatchError("")
    if (file.size > UPLOAD_MAX_BYTES) {
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
    try {
      if (ext === "csv") {
        const text = await file.text()
        setBatchPreview(parseCsvPreview(text))
      } else {
        const rows = await parseXlsxPreview(file)
        setBatchPreview(rows)
        if (rows.length === 0) {
          setBatchError("未能识别有效数据，请检查文件格式（需包含日期、单位净值列）")
        }
      }
    } catch {
      setBatchPreview([])
      setBatchError("文件解析失败，请检查格式后重试")
    }
  }

  function handlePasteIdentify() {
    setBatchError("")
    const rows = parsePastePreview(pasteText)
    if (rows.length === 0 && pasteText.trim()) {
      setBatchError("未能识别有效数据，请检查格式")
    }
    setPasteResult(rows)
  }

  function handlePasteReset() {
    setPasteText("")
    setPasteResult([])
    setBatchError("")
  }

  async function handleConfirm() {
    if (saving) return
    let rows: CustomFundNavUploadRow[] = []
    if (tab === "single") {
      if (!date || !unitNav.trim()) return
      rows = [{
        seq: 1,
        date,
        unit_nav: unitNav.trim(),
        cumulative_nav: cumulativeNav.trim() || unitNav.trim(),
      }]
    } else if (tab === "paste") {
      if (pasteResult.length === 0) return
      rows = pasteResult
    } else {
      if (!batchFile || batchPreview.length === 0) return
      rows = batchPreview
    }

    setSaving(true)
    setBatchError("")
    try {
      await onUpload(rows.map((row) => ({
        nav_date: row.date,
        unit_nav: row.unit_nav,
        cumulative_nav: row.cumulative_nav,
      })))
      onClose()
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "上传失败，请稍后重试")
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const scopeNote = scope === "mine"
    ? "我的自建仅本人可访问查看"
    : "团队自建仅本团队可访问查看"

  const uploadDisabled = saving || (
    tab === "single"
      ? !date || !unitNav.trim()
      : tab === "paste"
        ? pasteResult.length === 0
        : !batchFile || batchPreview.length === 0
  )

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={[
          "bg-background rounded-lg shadow-xl w-full flex flex-col max-h-[90vh]",
          tab === "paste" ? "max-w-[920px]" : "max-w-[560px]",
        ].join(" ")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">上传净值</span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 min-h-0">
          <div className="flex items-center gap-2">
            <span className="w-1 h-4 bg-red-500 rounded-full shrink-0" />
            <span className="font-medium text-sm">自建基金</span>
          </div>

          <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {scopeNote}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {([["single", "单条上传"], ["batch", "批量上传"], ["paste", "粘贴上传"]] as const).map(([key, label]) => (
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

          {tab === "single" ? (
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <span className="text-sm shrink-0 w-20 text-right pt-2 text-zinc-600">日期：</span>
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
                <span className="text-sm shrink-0 w-20 text-right pt-2 text-zinc-600">单位净值：</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={unitNav}
                  onChange={(e) => setUnitNav(e.target.value)}
                  className="flex-1 h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex items-start gap-4">
                <span className="text-sm shrink-0 w-20 text-right pt-2 text-zinc-600">累计净值：</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={cumulativeNav}
                  onChange={(e) => setCumulativeNav(e.target.value)}
                  placeholder="默认同单位净值"
                  className="flex-1 h-9 rounded border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          ) : tab === "paste" ? (
            <div className="space-y-3">
              <div className="flex gap-4 items-stretch min-h-[280px]">
                <div className="flex-[1.1] flex flex-col min-w-0">
                  <div className="text-sm font-medium mb-2">粘贴内容</div>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={"请粘贴净值数据，每行三条（无需表头）\n列顺序：净值日期、单位净值、累计净值\n\n示例：\n2023-03-03 1.2222 1.3333\n2023-03-04 1.2345 1.3456"}
                    className="flex-1 min-h-[260px] rounded border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/60 leading-relaxed"
                  />
                </div>
                <div className="flex flex-col justify-center gap-3 shrink-0 px-1">
                  <button
                    type="button"
                    onClick={handlePasteIdentify}
                    className="px-5 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    识别
                  </button>
                  <button
                    type="button"
                    onClick={handlePasteReset}
                    className="px-5 py-1.5 rounded border text-sm hover:bg-muted transition-colors whitespace-nowrap"
                  >
                    重置
                  </button>
                </div>
                <div className="flex-1 flex flex-col min-w-0">
                  <div className="text-sm font-medium mb-2">识别结果</div>
                  <div className="flex-1 rounded-lg border overflow-hidden min-h-[260px]">
                    <table className="w-full text-sm border-collapse h-full">
                      <thead>
                        <tr className="bg-muted/40 border-b">
                          <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">净值日期</th>
                          <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">单位净值</th>
                          <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">累计净值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pasteResult.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-16 text-center text-muted-foreground">
                              <div className="flex flex-col items-center gap-2">
                                <Inbox className="h-10 w-10 opacity-30" strokeWidth={1} />
                                <span className="text-sm">暂无数据</span>
                              </div>
                            </td>
                          </tr>
                        ) : pasteResult.map((row) => (
                          <tr key={`${row.seq}-${row.date}`} className="border-b last:border-b-0">
                            <td className="px-3 py-2.5 tabular-nums">{row.date}</td>
                            <td className="px-3 py-2.5 tabular-nums">{row.unit_nav}</td>
                            <td className="px-3 py-2.5 tabular-nums">{row.cumulative_nav}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
                  accept={UPLOAD_ACCEPT}
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
                <button type="button" onClick={downloadCustomFundNavUploadTemplate} className="text-blue-600 dark:text-blue-400 hover:underline ml-1">
                  点击下载批量上传净值模板
                </button>
              </p>
            </div>
          )}

          {batchError && <p className="text-xs text-red-500">{batchError}</p>}

          {tab === "batch" && <PreviewTable rows={batchPreview} />}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取消</button>
          <button
            type="button"
            disabled={uploadDisabled}
            onClick={() => void handleConfirm()}
            className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "处理中…" : "上传"}
          </button>
        </div>
      </div>
    </div>
  )
}
