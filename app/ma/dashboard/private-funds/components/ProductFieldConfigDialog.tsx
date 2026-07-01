"use client"

import { useEffect, useState } from "react"
import {
  PRODUCT_FIELD_OPTIONS,
  PRODUCT_FIELD_TABS,
} from "@/lib/ma/product-field-config"

export function ProductFieldConfigDialog({
  open,
  selected,
  onClose,
  onConfirm,
}: {
  open: boolean
  selected: string[]
  onClose: () => void
  onConfirm: (fields: string[]) => void
}) {
  const [tab, setTab] = useState<string>("基本信息")
  const [draft, setDraft] = useState<string[]>(selected)

  useEffect(() => {
    if (open) {
      setDraft([...selected])
      setTab("基本信息")
    }
  }, [open, selected])

  if (!open) return null

  const opts = PRODUCT_FIELD_OPTIONS[tab] ?? []

  function toggleDraft(field: string) {
    setDraft((prev) => prev.includes(field) ? prev.filter((x) => x !== field) : [...prev, field])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-[760px] flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">字段配置</span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>
        <div className="flex flex-1 overflow-hidden min-h-[320px]">
          <div className="flex-1 flex flex-col min-w-0 px-6 py-4 overflow-y-auto">
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              {PRODUCT_FIELD_TABS.map((t) => (
                <label key={t} className="flex items-center gap-1.5 cursor-pointer text-sm whitespace-nowrap">
                  <input
                    type="radio"
                    name="productFieldConfigTab"
                    checked={tab === t}
                    onChange={() => setTab(t)}
                    className="accent-red-500 h-3.5 w-3.5"
                  />
                  {t}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-x-6 gap-y-3">
              {opts.map((f) => (
                <label key={f} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={draft.includes(f)}
                    onChange={() => toggleDraft(f)}
                    className="rounded h-3.5 w-3.5 accent-red-500"
                  />
                  {f}
                </label>
              ))}
            </div>
          </div>
          <div className="w-48 border-l flex flex-col px-4 py-4 flex-shrink-0 min-h-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-zinc-600">已选({draft.length})</span>
              <button type="button" onClick={() => setDraft([])} className="text-xs text-red-500 hover:text-red-600 transition-colors">清空</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5">
              {draft.map((f) => (
                <div key={f} className="flex items-center justify-between text-sm py-0.5">
                  <span className="text-zinc-700 dark:text-zinc-300 truncate">{f}</span>
                  <button type="button" onClick={() => toggleDraft(f)} className="text-zinc-400 hover:text-zinc-600 transition-colors ml-1 flex-shrink-0">×</button>
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-400 mt-3 leading-snug">已选列表可拖拉上下排序</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">取消</button>
          <button
            type="button"
            onClick={() => onConfirm([...draft])}
            className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
