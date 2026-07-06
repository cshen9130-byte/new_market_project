"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2, GripVertical } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  INPUT_TYPE_META,
  createInputId,
  type TemplateInputField,
  type TemplateInputType,
} from "@/lib/ma/report-template-types"

export function ReportTemplateUserInputsDialog({
  open,
  onOpenChange,
  inputs,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  inputs: TemplateInputField[]
  onSave: (inputs: TemplateInputField[]) => void
}) {
  const [draft, setDraft] = useState<TemplateInputField[]>(inputs)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  useEffect(() => {
    if (open) setDraft(inputs.map((i) => ({ ...i })))
  }, [open, inputs])

  function addField() {
    setDraft((prev) => [
      ...prev,
      {
        id: createInputId(),
        label: `字段 ${prev.length + 1}`,
        type: "text",
        required: true,
      },
    ])
  }

  function updateField(id: string, patch: Partial<TemplateInputField>) {
    setDraft((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  function removeField(id: string) {
    setDraft((prev) => prev.filter((f) => f.id !== id))
  }

  function moveField(from: number, to: number) {
    if (from === to) return
    setDraft((prev) => {
      const arr = [...prev]
      const [item] = arr.splice(from, 1)
      arr.splice(to, 0, item)
      return arr
    })
  }

  function handleSave() {
    onSave(draft.filter((f) => f.label.trim()))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>配置用户输入项</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            定义使用此模板生成报告时，用户需要填写或选择的内容。画布中的元素可绑定到这些字段。
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-3 py-2">
          {draft.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
              暂无输入项，点击下方按钮添加
            </div>
          )}
          {draft.map((field, idx) => (
            <div
              key={field.id}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIdx !== null) moveField(dragIdx, idx)
                setDragIdx(null)
              }}
              onDragEnd={() => setDragIdx(null)}
              className={[
                "flex gap-2 items-start p-3 rounded-lg border bg-background",
                dragIdx === idx ? "opacity-50" : "",
              ].join(" ")}
            >
              <GripVertical className="h-4 w-4 text-zinc-400 mt-2.5 shrink-0 cursor-grab" />
              <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
                <div>
                  <label className="text-[11px] text-zinc-500 mb-1 block">字段名称</label>
                  <input
                    value={field.label}
                    onChange={(e) => updateField(field.id, { label: e.target.value })}
                    className="w-full h-8 px-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="如：目标产品"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-zinc-500 mb-1 block">字段类型</label>
                  <select
                    value={field.type}
                    onChange={(e) => {
                      const type = e.target.value as TemplateInputType
                      const patch: Partial<TemplateInputField> = { type }
                      if (type === "select" && !field.options?.length) {
                        patch.options = ["选项1", "选项2"]
                      }
                      updateField(field.id, patch)
                    }}
                    className="w-full h-8 px-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {(Object.entries(INPUT_TYPE_META) as [TemplateInputType, { label: string }][]).map(
                      ([key, meta]) => (
                        <option key={key} value={key}>
                          {meta.label}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-zinc-500 mb-1 block">占位提示</label>
                  <input
                    value={field.placeholder ?? ""}
                    onChange={(e) => updateField(field.id, { placeholder: e.target.value })}
                    className="w-full h-8 px-2 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="可选"
                  />
                </div>
                <div className="flex items-end gap-3 pb-0.5">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.required ?? false}
                      onChange={(e) => updateField(field.id, { required: e.target.checked })}
                      className="rounded border-border"
                    />
                    必填
                  </label>
                </div>
                {field.type === "select" && (
                  <div className="col-span-2">
                    <label className="text-[11px] text-zinc-500 mb-1 block">
                      选项（每行一个）
                    </label>
                    <textarea
                      value={(field.options ?? []).join("\n")}
                      onChange={(e) =>
                        updateField(field.id, {
                          options: e.target.value.split("\n").filter(Boolean),
                        })
                      }
                      rows={3}
                      className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                    />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeField(field.id)}
                className="p-1.5 rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors shrink-0 mt-1"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addField}
          className="inline-flex items-center gap-1.5 text-sm text-red-500 hover:text-red-600 transition-colors"
        >
          <Plus className="h-4 w-4" />
          添加输入项
        </button>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 rounded-md border border-border text-sm hover:bg-muted transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="h-9 px-4 rounded-md bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
          >
            确定
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
