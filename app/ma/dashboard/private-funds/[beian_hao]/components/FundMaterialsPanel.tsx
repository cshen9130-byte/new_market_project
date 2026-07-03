"use client"

import { useCallback, useEffect, useState } from "react"
import { ExternalLink, FileText, Loader2, Trash2, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type MaterialRow = {
  id: number
  beian_hao: string
  original_filename: string
  file_size: number
  mime_type: string
  uploaded_by: string
  uploaded_at: string
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

export function FundMaterialsPanel({ beian_hao }: { beian_hao: string }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<MaterialRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [previewRow, setPreviewRow] = useState<MaterialRow | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

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

  async function handleDelete(row: MaterialRow) {
    if (!window.confirm(`确定删除「${row.original_filename}」吗？此操作不可撤销。`)) return
    setDeletingId(row.id)
    try {
      const res = await fetch(`/ma/api/ops/fund-contracts/${row.id}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || "删除失败")
      if (previewRow?.id === row.id) setPreviewRow(null)
      setRows((prev) => prev.filter((item) => item.id !== row.id))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "删除失败")
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[240px] text-sm text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载相关资料…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed min-h-[240px] flex items-center justify-center text-sm text-muted-foreground">
        暂无相关资料。可在「运维 → 数据维护 → 要素提取」中保存基金合同。
      </div>
    )
  }

  return (
    <>
      <div className="rounded-lg border overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/20 text-sm font-medium">基金合同</div>
        <div className="divide-y">
          {rows.map((row) => {
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
                      title={row.original_filename}
                    >
                      {row.original_filename}
                    </button>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatFileSize(Number(row.file_size) || 0)}
                      {row.uploaded_at ? ` · ${formatDate(row.uploaded_at)}` : ""}
                      {row.uploaded_by ? ` · ${row.uploaded_by}` : ""}
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

      <Dialog open={!!previewRow} onOpenChange={(open) => { if (!open) setPreviewRow(null) }}>
        <DialogContent className="max-w-5xl w-[95vw] h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 py-4 border-b shrink-0">
            <div className="flex items-start justify-between gap-4">
              <DialogTitle className="text-sm font-semibold pr-8 line-clamp-2">
                {previewRow?.original_filename}
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
              title={previewRow.original_filename}
              className="flex-1 w-full border-0 bg-white"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
