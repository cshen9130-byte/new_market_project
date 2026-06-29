"use client"

import { useEffect, useState } from "react"

export const LEDGER_LOCKED_FIELD_KEYS = [
  "fof_fund_name",
  "transaction_type",
  "underlying_fund_name",
  "apply_date",
  "confirm_date",
  "confirmed_amount",
  "confirmed_shares",
  "confirmed_unit_nav",
  "transaction_fee",
  "performance_fee",
  "source",
  "remark",
] as const

export const LEDGER_FIELD_CONFIG_DEFAULT = [...LEDGER_LOCKED_FIELD_KEYS]

export const LEDGER_FIELD_OPTIONS: { key: string; label: string; locked?: boolean }[] = [
  { key: "fof_fund_name", label: "FOF基金", locked: true },
  { key: "apply_date", label: "申请日期", locked: true },
  { key: "performance_fee", label: "业绩报酬", locked: true },
  { key: "fof_register_number", label: "FOF基金备案号" },
  { key: "confirm_date", label: "确认日期", locked: true },
  { key: "share_balance", label: "份额余额" },
  { key: "transaction_type", label: "交易类型", locked: true },
  { key: "confirmed_amount", label: "确认净额", locked: true },
  { key: "dividend_per_unit", label: "每单位分红" },
  { key: "underlying_type", label: "底层类型" },
  { key: "confirmed_shares", label: "确认份额", locked: true },
  { key: "source", label: "来源", locked: true },
  { key: "underlying_fund_name", label: "底层基金", locked: true },
  { key: "confirmed_unit_nav", label: "确认单位净值", locked: true },
  { key: "remark", label: "备注", locked: true },
  { key: "underlying_beian_hao", label: "底层备案号" },
  { key: "transaction_fee", label: "交易费用", locked: true },
]

const LABEL_BY_KEY = Object.fromEntries(LEDGER_FIELD_OPTIONS.map((f) => [f.key, f.label]))
const LOCKED_SET = new Set(LEDGER_LOCKED_FIELD_KEYS)

function ensureLocked(fields: string[]) {
  const optional = fields.filter((k) => !LOCKED_SET.has(k as typeof LEDGER_LOCKED_FIELD_KEYS[number]))
  return [...LEDGER_LOCKED_FIELD_KEYS, ...optional.filter((k) => fields.includes(k))]
}

function sortByOptionOrder(fields: string[]) {
  const order = new Map(LEDGER_FIELD_OPTIONS.map((f, i) => [f.key, i]))
  return [...fields].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
}

export function OperationsLedgerFieldConfigDialog({
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
  const [draft, setDraft] = useState<string[]>(selected)

  useEffect(() => {
    if (open) setDraft(ensureLocked(selected))
  }, [open, selected])

  if (!open) return null

  function toggleDraft(key: string) {
    if (LOCKED_SET.has(key as typeof LEDGER_LOCKED_FIELD_KEYS[number])) return
    setDraft((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
      return ensureLocked(next)
    })
  }

  function clearDraft() {
    setDraft([...LEDGER_LOCKED_FIELD_KEYS])
  }

  const draftOrdered = sortByOptionOrder(draft)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[760px] flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">字段配置</span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-[320px]">
          <div className="flex-1 px-6 py-4 overflow-y-auto">
            <div className="grid grid-cols-3 gap-x-6 gap-y-3">
              {LEDGER_FIELD_OPTIONS.map((field) => {
                const locked = field.locked === true
                return (
                  <label
                    key={field.key}
                    className={[
                      "flex items-center gap-2 text-sm",
                      locked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={draft.includes(field.key)}
                      disabled={locked}
                      onChange={() => toggleDraft(field.key)}
                      className="rounded h-3.5 w-3.5 accent-red-500 disabled:opacity-70"
                    />
                    {field.label}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="w-48 border-l flex flex-col px-4 py-4 flex-shrink-0 min-h-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-zinc-600">已选({draft.length})</span>
              <button type="button" onClick={clearDraft} className="text-xs text-blue-500 hover:text-blue-600 transition-colors">
                清空
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
              {draftOrdered.map((key) => {
                const locked = LOCKED_SET.has(key as typeof LEDGER_LOCKED_FIELD_KEYS[number])
                return (
                  <div key={key} className="flex items-center justify-between text-sm py-0.5">
                    <span className="text-zinc-700 dark:text-zinc-300 truncate">{LABEL_BY_KEY[key] ?? key}</span>
                    {locked ? (
                      <span className="text-zinc-300 ml-1 flex-shrink-0 cursor-not-allowed">×</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleDraft(key)}
                        className="text-zinc-400 hover:text-zinc-600 transition-colors ml-1 flex-shrink-0"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-zinc-400 mt-3 leading-snug">已选列表可拖拉上下排序</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t flex-shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors">
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(sortByOptionOrder(ensureLocked(draft)))}
            className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
