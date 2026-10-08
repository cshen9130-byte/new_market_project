"use client"

import { useEffect, useState } from "react"
import { X } from "lucide-react"
import { DateInput } from "@/components/ui/date-input"

type Props = {
  open: boolean
  onClose: () => void
  beianHao: string
  productName: string
  initialDate: string | null
  onSaved?: (operationDate: string | null) => void
}

export function SetOperationDateDialog({
  open,
  onClose,
  beianHao,
  productName,
  initialDate,
  onSaved,
}: Props) {
  const [date, setDate] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDate((initialDate ?? "").slice(0, 10))
    setError(null)
  }, [open, initialDate])

  if (!open) return null

  async function save(next: string | null) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/ma/api/ops/fund-elements", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beian_hao: beianHao, operation_date: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "保存失败")
      onSaved?.(next)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-base font-semibold">设置运作日期</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {productName} · {beianHao}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4 text-sm">
          <p className="text-xs leading-relaxed text-muted-foreground">
            只记录该产品的运作日期，用于「运作以来」。不会删除该日期之前的净值。
          </p>
          <label className="block space-y-1">
            <span className="font-medium">运作日期</span>
            <DateInput value={date} onChange={setDate} placeholder="请选择日期" />
          </label>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
            disabled={saving || !initialDate}
            onClick={() => void save(null)}
          >
            清除
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border px-4 py-2 text-sm hover:bg-muted"
              onClick={onClose}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              disabled={saving || !date}
              onClick={() => void save(date)}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
