"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  StickyNote,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  investmentNoteDeepLink,
  listInvestmentNotesLinkedToProduct,
  type ProductLinkedInvestmentNote,
} from "@/lib/ma/investment-notes"

function isRichHtmlContent(value: string) {
  return /<[a-z][\s\S]*>/i.test(value || "")
}

type MaterialRow = {
  id: number
  beian_hao: string
  original_filename: string
  file_size: number
  mime_type: string
  uploaded_by: string
  uploaded_at: string
  chart_date: string | null
  title: string
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: string) {
  return value.slice(0, 19).replace("T", " ")
}

function getExtension(fileName: string) {
  const dot = fileName.lastIndexOf(".")
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : ""
}

function needsHtmlPreview(filename: string) {
  const ext = getExtension(filename)
  return ext === ".doc" || ext === ".docx" || ext === ".xls" || ext === ".xlsx"
}

function previewUrl(id: number, filename: string) {
  const base = `/ma/api/ops/fund-contracts/${id}/file`
  return needsHtmlPreview(filename) ? `${base}?preview=1` : base
}

function displayTitle(row: MaterialRow) {
  return row.title?.trim() || row.original_filename
}

function UploadMaterialsButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-60"
    >
      <Upload className="h-3.5 w-3.5" />
      上传资料
    </button>
  )
}

function displayNoteTitle(title: string) {
  return title.trim() || "无标题"
}

export function FundMaterialsPanel({
  beian_hao,
  product_name,
}: {
  beian_hao: string
  product_name?: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const materialIdParam = searchParams.get("materialId")

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<MaterialRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewRow, setPreviewRow] = useState<MaterialRow | null>(null)
  const [linkedNotes, setLinkedNotes] = useState<ProductLinkedInvestmentNote[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  const [previewNote, setPreviewNote] = useState<ProductLinkedInvestmentNote | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadTitle, setUploadTitle] = useState("")
  const [uploadChartDate, setUploadChartDate] = useState("")
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [editRow, setEditRow] = useState<MaterialRow | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editChartDate, setEditChartDate] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const loadRows = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`/ma/api/ops/fund-contracts?beian_hao=${encodeURIComponent(beian_hao)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error)
        setRows(Array.isArray(json.data) ? json.data : [])
      })
      .catch((err) => {
        setRows([])
        setError(err instanceof Error ? err.message : "加载失败")
      })
      .finally(() => setLoading(false))
  }, [beian_hao])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  useEffect(() => {
    let cancelled = false
    setNotesLoading(true)
    void listInvestmentNotesLinkedToProduct(beian_hao, product_name)
      .then((notes) => {
        if (!cancelled) setLinkedNotes(notes)
      })
      .catch(() => {
        if (!cancelled) setLinkedNotes([])
      })
      .finally(() => {
        if (!cancelled) setNotesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [beian_hao, product_name])

  useEffect(() => {
    if (!materialIdParam || loading || rows.length === 0) return
    const id = parseInt(materialIdParam, 10)
    if (!Number.isFinite(id)) return
    const match = rows.find((row) => row.id === id)
    if (match) setPreviewRow(match)
  }, [materialIdParam, loading, rows])

  const sortedRows = useMemo(() => rows, [rows])
  const hasMaterials = sortedRows.length > 0
  const hasLinkedNotes = linkedNotes.length > 0
  const panelLoading = loading || notesLoading

  function resetUploadForm() {
    setUploadFile(null)
    setUploadTitle("")
    setUploadChartDate("")
    setUploadError(null)
  }

  function openEdit(row: MaterialRow) {
    setEditRow(row)
    setEditTitle(row.title || "")
    setEditChartDate(row.chart_date || "")
    setEditError(null)
  }

  async function handleUpload() {
    if (!uploadFile) {
      setUploadError("请选择文件")
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const form = new FormData()
      form.set("beian_hao", beian_hao)
      form.set("file", uploadFile)
      if (uploadTitle.trim()) form.set("title", uploadTitle.trim())
      if (uploadChartDate.trim()) form.set("chart_date", uploadChartDate.trim())
      const res = await fetch("/ma/api/ops/fund-contracts", { method: "POST", body: form })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || "上传失败")
      setRows((prev) => [json.data as MaterialRow, ...prev])
      setUploadOpen(false)
      resetUploadForm()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "上传失败")
    } finally {
      setUploading(false)
    }
  }

  async function handleSaveEdit() {
    if (!editRow) return
    setSavingEdit(true)
    setEditError(null)
    try {
      const res = await fetch(`/ma/api/ops/fund-contracts/${editRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle.trim(),
          chart_date: editChartDate.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || "保存失败")
      const updated = json.data as MaterialRow
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      if (previewRow?.id === updated.id) setPreviewRow(updated)
      setEditRow(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDelete(row: MaterialRow) {
    if (!window.confirm(`确定删除「${displayTitle(row)}」吗？此操作不可撤销。`)) return
    setDeletingId(row.id)
    try {
      const res = await fetch(`/ma/api/ops/fund-contracts/${row.id}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || "删除失败")
      if (previewRow?.id === row.id) setPreviewRow(null)
      if (editRow?.id === row.id) setEditRow(null)
      setRows((prev) => prev.filter((item) => item.id !== row.id))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeletingId(null)
    }
  }

  if (panelLoading) {
    return (
      <div className="flex items-center justify-center min-h-[240px] text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载相关资料…
      </div>
    )
  }

  if (error && !hasLinkedNotes) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <UploadMaterialsButton onClick={() => setUploadOpen(true)} />
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            上传资料可关联净值日期，并在业绩指标净值图上标注。关联产品的投资笔记也会显示在此。
          </div>
          <UploadMaterialsButton onClick={() => { resetUploadForm(); setUploadOpen(true) }} />
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!hasMaterials && !hasLinkedNotes ? (
          <div className="rounded-lg border border-dashed min-h-[240px] flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground px-6 text-center">
            <div>暂无相关资料。可在此上传，或在「运维 → 数据维护 → 要素提取」中保存基金合同；也可在投资笔记中关联本产品。</div>
            <UploadMaterialsButton onClick={() => { resetUploadForm(); setUploadOpen(true) }} />
          </div>
        ) : (
          <>
            {hasLinkedNotes && (
              <div className="rounded-lg border overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/20 text-sm font-medium">关联投资笔记</div>
                <div className="divide-y">
                  {linkedNotes.map((note) => (
                    <div key={note.id} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <StickyNote className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setPreviewNote(note)}
                            className="text-sm font-medium text-blue-600 hover:underline truncate block text-left"
                            title={displayNoteTitle(note.title)}
                          >
                            {displayNoteTitle(note.title)}
                          </button>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="inline-flex items-center rounded bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5">
                              投资笔记
                            </span>
                            <span>{note.scope === "team" ? "团队笔记" : "我的笔记"}</span>
                            {note.creator ? <span>{note.creator}</span> : null}
                            {note.modifiedDate ? <span>{note.modifiedDate}</span> : null}
                            {note.preview?.trim() ? (
                              <span className="truncate max-w-[280px]" title={note.preview}>
                                {note.preview}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setPreviewNote(note)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs hover:bg-muted transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          查看
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              investmentNoteDeepLink({
                                id: note.id,
                                title: note.title,
                                scope: note.scope,
                              }),
                            )
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs hover:bg-muted transition-colors"
                        >
                          打开笔记
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasMaterials && (
              <div className="rounded-lg border overflow-hidden">
                <div className="px-4 py-3 border-b bg-muted/20 text-sm font-medium">相关资料</div>
                <div className="divide-y">
                  {sortedRows.map((row) => {
                    const downloadUrl = `/ma/api/ops/fund-contracts/${row.id}/file?download=1`
                    return (
                      <div key={row.id} className="flex items-center justify-between gap-4 px-4 py-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <FileText className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => setPreviewRow(row)}
                              className="text-sm font-medium text-blue-600 hover:underline truncate block text-left"
                              title={displayTitle(row)}
                            >
                              {displayTitle(row)}
                            </button>
                            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                              {row.title?.trim() && row.title.trim() !== row.original_filename && (
                                <span className="truncate" title={row.original_filename}>
                                  {row.original_filename}
                                </span>
                              )}
                              <span>{formatFileSize(Number(row.file_size) || 0)}</span>
                              {row.uploaded_at ? <span>{formatDate(row.uploaded_at)}</span> : null}
                              {row.uploaded_by ? <span>{row.uploaded_by}</span> : null}
                              {row.chart_date ? (
                                <span className="inline-flex items-center rounded bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5">
                                  净值日期 {row.chart_date}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setPreviewRow(row)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs hover:bg-muted transition-colors"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            查看
                          </button>
                          <a
                            href={downloadUrl}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs hover:bg-muted transition-colors"
                          >
                            下载
                          </a>
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs hover:bg-muted transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
                            disabled={deletingId === row.id}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-red-200 text-red-600 text-xs hover:bg-red-50 transition-colors disabled:opacity-60"
                          >
                            {deletingId === row.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            删除
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open)
          if (!open) resetUploadForm()
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>上传相关资料</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="material-file">文件</Label>
              <Input
                id="material-file"
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.bmp"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                支持 PDF / Word / Excel / 图片，最大 20MB
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="material-title">标题（可选）</Label>
              <Input
                id="material-title"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="例如：回撤说明"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="material-chart-date">关联净值日期（可选）</Label>
              <Input
                id="material-chart-date"
                type="date"
                value={uploadChartDate}
                onChange={(e) => setUploadChartDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                设置后将在业绩指标净值图上标注该日期
              </p>
            </div>
            {uploadError && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {uploadError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setUploadOpen(false)}
                className="px-3 py-1.5 rounded border text-xs hover:bg-muted"
                disabled={uploading}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading || !uploadFile}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-900 text-white text-xs hover:bg-zinc-800 disabled:opacity-60"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                上传
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editRow}
        onOpenChange={(open) => {
          if (!open) setEditRow(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑资料信息</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="text-xs text-muted-foreground truncate" title={editRow?.original_filename}>
              文件：{editRow?.original_filename}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-material-title">标题</Label>
              <Input
                id="edit-material-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="例如：回撤说明"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-material-chart-date">关联净值日期</Label>
              <Input
                id="edit-material-chart-date"
                type="date"
                value={editChartDate}
                onChange={(e) => setEditChartDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">清空日期即可取消图表标注</p>
            </div>
            {editError && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {editError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditRow(null)}
                className="px-3 py-1.5 rounded border text-xs hover:bg-muted"
                disabled={savingEdit}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={savingEdit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-zinc-900 text-white text-xs hover:bg-zinc-800 disabled:opacity-60"
              >
                {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                保存
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewRow} onOpenChange={(open) => { if (!open) setPreviewRow(null) }}>
        <DialogContent className="max-w-5xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b shrink-0">
            <div className="flex items-start justify-between gap-4">
              <DialogTitle className="text-sm font-semibold pr-8 line-clamp-2">
                {previewRow ? displayTitle(previewRow) : ""}
              </DialogTitle>
              <button
                type="button"
                onClick={() => setPreviewRow(null)}
                className="absolute right-4 top-4 p-1 rounded text-muted-foreground hover:text-foreground"
                aria-label="关闭预览"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </DialogHeader>
          {previewRow && (
            <iframe
              key={previewRow.id}
              src={previewUrl(previewRow.id, previewRow.original_filename)}
              title={displayTitle(previewRow)}
              className="flex-1 w-full border-0 bg-white"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewNote} onOpenChange={(open) => { if (!open) setPreviewNote(null) }}>
        <DialogContent className="max-w-5xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b shrink-0">
            <div className="flex items-start justify-between gap-4 pr-8">
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold line-clamp-2">
                  {previewNote ? displayNoteTitle(previewNote.title) : ""}
                </DialogTitle>
                {previewNote && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {previewNote.scope === "team" ? "团队笔记" : "我的笔记"}
                    {previewNote.creator ? ` · ${previewNote.creator}` : ""}
                    {previewNote.modifiedDate ? ` · ${previewNote.modifiedDate}` : ""}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {previewNote && (
                  <button
                    type="button"
                    onClick={() => {
                      const note = previewNote
                      setPreviewNote(null)
                      router.push(
                        investmentNoteDeepLink({
                          id: note.id,
                          title: note.title,
                          scope: note.scope,
                        }),
                      )
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs hover:bg-muted transition-colors"
                  >
                    打开笔记
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewNote(null)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground"
                  aria-label="关闭预览"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </DialogHeader>
          {previewNote && (
            <div className="flex-1 overflow-auto bg-white px-8 py-6">
              {isRichHtmlContent(previewNote.content) ? (
                <div
                  className="investment-note-rich text-sm leading-7 text-zinc-700"
                  dangerouslySetInnerHTML={{ __html: previewNote.content }}
                />
              ) : (
                <div className="whitespace-pre-wrap text-sm leading-7 text-zinc-700">
                  {previewNote.content || "（空笔记）"}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
