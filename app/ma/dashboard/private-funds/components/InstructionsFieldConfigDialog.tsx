"use client"

import { useEffect, useState, type DragEvent } from "react"

export const INSTRUCTION_FIELD_OPTIONS = [
  "交易申请日期",
  "申请金额",
  "申请份额",
  "发起人",
  "实际申请日期",
  "交易确认日期",
  "确认净值",
  "确认金额",
  "确认份额",
  "交易费用",
  "业绩报酬",
  "转入申请金额",
  "转入确认日期",
  "转入确认净值",
  "转入确认金额",
  "转入确认份额",
  "转入交易费用",
] as const

export type InstructionFieldLabel = (typeof INSTRUCTION_FIELD_OPTIONS)[number]

/** Always-on fields: checked & disabled in the picker. */
export const INSTRUCTION_FIELD_LOCKED: readonly InstructionFieldLabel[] = [
  "交易申请日期",
  "申请金额",
  "申请份额",
  "发起人",
  "确认净值",
]

export const INSTRUCTION_FIELD_DEFAULT: readonly InstructionFieldLabel[] = [
  "交易申请日期",
  "申请金额",
  "申请份额",
  "确认净值",
  "发起人",
]

const ALL_SET = new Set<string>(INSTRUCTION_FIELD_OPTIONS)

const STORAGE_KEY = "instructions_field_config_selected"

export function readInstructionFieldConfig(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...INSTRUCTION_FIELD_DEFAULT]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...INSTRUCTION_FIELD_DEFAULT]
    const valid = parsed.filter((f): f is string => typeof f === "string" && ALL_SET.has(f))
    return ensureLocked(valid.length > 0 ? valid : [...INSTRUCTION_FIELD_DEFAULT])
  } catch {
    return [...INSTRUCTION_FIELD_DEFAULT]
  }
}

export function writeInstructionFieldConfig(fields: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ensureLocked(fields)))
  } catch {
    /* ignore quota */
  }
}

function ensureLocked(
  fields: string[],
  lockedFields: readonly string[] = INSTRUCTION_FIELD_LOCKED,
): string[] {
  const next = fields.filter((f) => ALL_SET.has(f))
  for (const locked of lockedFields) {
    if (ALL_SET.has(locked) && !next.includes(locked)) next.push(locked)
  }
  return next
}

export function InstructionsFieldConfigDialog({
  open,
  selected,
  onClose,
  onConfirm,
  /** Fields that cannot be unchecked (defaults to INSTRUCTION_FIELD_LOCKED). */
  lockedFields,
  /** Hide these options entirely (e.g. 发起人 on 直投申赎). */
  hiddenFields,
}: {
  open: boolean
  selected: string[]
  onClose: () => void
  onConfirm: (fields: string[]) => void
  lockedFields?: readonly string[]
  hiddenFields?: readonly string[]
}) {
  const locked = lockedFields ?? INSTRUCTION_FIELD_LOCKED
  const lockedSet = new Set(locked)
  const hiddenSet = new Set(hiddenFields ?? [])
  const visibleOptions = INSTRUCTION_FIELD_OPTIONS.filter((f) => !hiddenSet.has(f))

  const [draft, setDraft] = useState<string[]>(selected)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    const next = ensureLocked(
      selected.filter((f) => !hiddenSet.has(f)),
      locked,
    )
    setDraft(next)
  }, [open, selected, lockedFields, hiddenFields])

  if (!open) return null

  function toggleDraft(field: string) {
    if (lockedSet.has(field)) return
    setDraft((prev) => {
      const next = prev.includes(field) ? prev.filter((x) => x !== field) : [...prev, field]
      return ensureLocked(next.filter((f) => !hiddenSet.has(f)), locked)
    })
  }

  function clearDraft() {
    setDraft([...locked])
  }

  function handleDragOver(e: DragEvent, idx: number) {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    setDraft((prev) => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(idx, 0, moved)
      return next
    })
    setDragIdx(idx)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl w-full max-w-[760px] flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <span className="font-semibold text-base">字段配置</span>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-[280px]">
          <div className="flex-1 min-w-0 px-6 py-4 overflow-y-auto">
            <div className="grid grid-cols-3 gap-x-6 gap-y-3">
              {visibleOptions.map((f) => {
                const isLocked = lockedSet.has(f)
                return (
                  <label
                    key={f}
                    className={[
                      "flex items-center gap-2 text-sm",
                      isLocked ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={draft.includes(f)}
                      disabled={isLocked}
                      onChange={() => toggleDraft(f)}
                      className="rounded h-3.5 w-3.5 accent-red-500 disabled:opacity-70"
                    />
                    {f}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="w-48 border-l flex flex-col px-4 py-4 flex-shrink-0 min-h-0">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-zinc-600">已选({draft.length})</span>
              <button
                type="button"
                onClick={clearDraft}
                className="text-xs text-red-500 hover:text-red-600 transition-colors"
              >
                清空
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1">
              {draft.map((f, idx) => {
                const isLocked = lockedSet.has(f)
                return (
                  <div
                    key={f}
                    draggable
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={() => setDragIdx(null)}
                    className="flex items-center justify-between text-sm py-0.5 cursor-grab select-none"
                  >
                    <span className="text-zinc-700 dark:text-zinc-300 truncate">{f}</span>
                    {isLocked ? (
                      <span className="text-zinc-300 ml-1 flex-shrink-0 cursor-not-allowed">×</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleDraft(f)}
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

        <div className="flex items-center justify-between gap-4 px-6 py-3 border-t flex-shrink-0">
          <p className="text-[11px] text-zinc-400 leading-snug min-w-0">
            转换指令中，申请金额、申请份额；确认日期、净值、金额、份额；交易费用皆为转出信息
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded border text-sm hover:bg-muted transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() =>
                onConfirm(ensureLocked(draft.filter((f) => !hiddenSet.has(f)), locked))
              }
              className="px-4 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
