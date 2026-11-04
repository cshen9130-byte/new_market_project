"use client"

import { useState } from "react"
import { FileDown } from "lucide-react"

export function AccountRiskProfileButton({
  selection,
}: {
  selection: string
}) {
  const [profiling, setProfiling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const disabled = profiling || !selection || selection === "all"

  const download = async () => {
    if (!selection || selection === "all") {
      setError("请先选择一个单账户")
      return
    }
    setProfiling(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (selection.startsWith("book:")) params.set("book", selection.slice(5))
      else params.set("account", selection)
      const res = await fetch(`/ma/api/account-risk/trader-profile?${params}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({} as { error?: string }))
        throw new Error(json.error || `生成失败（${res.status}）`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      const fromHeader = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get("Content-Disposition") || "")
      a.href = url
      a.download = fromHeader ? decodeURIComponent(fromHeader[1]) : "单账户_盘手侧写.docx"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : "侧写报告生成失败")
    } finally {
      setProfiling(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <button
        type="button"
        onClick={download}
        disabled={disabled}
        title={selection === "all" || !selection ? "请先选择一个单账户" : "下载当前单账户的盘手侧写 Word 报告"}
        className="inline-flex items-center gap-1 rounded border border-input bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 disabled:pointer-events-none"
      >
        <FileDown className={`h-3.5 w-3.5 ${profiling ? "animate-pulse" : ""}`} />
        {profiling ? "生成中…" : "盘手侧写"}
      </button>
      {error && <span className="max-w-56 text-right text-[10px] leading-snug text-destructive">{error}</span>}
    </div>
  )
}
