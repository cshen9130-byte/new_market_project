"use client"

import { useEffect, useState } from "react"
import { ExternalLink, FileText, Loader2 } from "lucide-react"

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

export function FundMaterialsPanel({ beian_hao }: { beian_hao: string }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<MaterialRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
    <div className="rounded-lg border overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/20 text-sm font-medium">基金合同</div>
      <div className="divide-y">
        {rows.map((row) => {
          const viewUrl = `/ma/api/ops/fund-contracts/${row.id}/file`
          const downloadUrl = `${viewUrl}?download=1`
          return (
            <div key={row.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-start gap-3 min-w-0">
                <FileText className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <a
                    href={viewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-blue-600 hover:underline truncate block"
                    title={row.original_filename}
                  >
                    {row.original_filename}
                  </a>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatFileSize(Number(row.file_size) || 0)}
                    {row.uploaded_at ? ` · ${formatDate(row.uploaded_at)}` : ""}
                    {row.uploaded_by ? ` · ${row.uploaded_by}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={viewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs hover:bg-muted transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  查看
                </a>
                <a
                  href={downloadUrl}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs hover:bg-muted transition-colors"
                >
                  下载
                </a>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
