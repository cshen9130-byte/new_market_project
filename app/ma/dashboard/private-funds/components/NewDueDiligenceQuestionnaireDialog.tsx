"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { CalendarDays, ChevronDown } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { DueDiligenceQuestionnaire } from "@/lib/ma/due-diligence-questionnaires"
import {
  QUESTIONNAIRE_TEMPLATE_OPTIONS,
  createDueDiligenceQuestionnaire,
  updateDueDiligenceQuestionnaire,
  type DueDiligenceQuestionnaireTemplateId,
} from "@/lib/ma/due-diligence-questionnaires"

function FieldLabel({ required, children }: { required?: boolean; children: ReactNode }) {
  return (
    <label className="shrink-0 w-[5.5rem] text-sm text-zinc-600 text-right pt-2 leading-snug">
      {required && <span className="text-red-500 mr-0.5">*</span>}
      {children}
    </label>
  )
}

function FormRow({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <FieldLabel required={required}>{label}</FieldLabel>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

const inputClass =
  "h-9 w-full rounded border border-zinc-200 bg-white px-3 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-ring"

export function NewDueDiligenceQuestionnaireDialog({
  open,
  onOpenChange,
  questionnaire,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  questionnaire?: DueDiligenceQuestionnaire | null
  onSaved?: () => void
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [title, setTitle] = useState("")
  const [company, setCompany] = useState("")
  const [ddDate, setDdDate] = useState("")
  const [templateId, setTemplateId] = useState<DueDiligenceQuestionnaireTemplateId>("simple")

  useEffect(() => {
    if (!open) return
    if (questionnaire) {
      setTitle(questionnaire.title)
      setCompany(questionnaire.company)
      setDdDate(questionnaire.ddDate)
      setTemplateId(questionnaire.templateId)
    } else {
      setTitle("")
      setCompany("")
      setDdDate(today)
      setTemplateId("simple")
    }
  }, [open, questionnaire, today])

  function handleConfirm() {
    if (!title.trim() || !company.trim() || !ddDate) return
    const draft = {
      title: title.trim(),
      company: company.trim(),
      ddDate,
      templateId,
    }
    if (questionnaire) {
      updateDueDiligenceQuestionnaire(questionnaire.id, draft)
    } else {
      createDueDiligenceQuestionnaire(draft)
    }
    onSaved?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0" showCloseButton>
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle className="text-base font-semibold">新建尽调问卷</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            确定后，在列表复制地址，发送给尽调对象。
          </div>

          <div className="space-y-4">
            <FormRow label="报告名称" required>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClass}
              />
            </FormRow>
            <FormRow label="尽调公司" required>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="请输入关键字并选择管理人"
                className={inputClass}
              />
            </FormRow>
            <FormRow label="尽调日期" required>
              <div className="relative">
                <input
                  type="date"
                  value={ddDate}
                  onChange={(e) => setDdDate(e.target.value)}
                  placeholder="请选择日期"
                  className={`${inputClass} pr-9`}
                />
                <CalendarDays className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              </div>
            </FormRow>
            <FormRow label="报告模板" required>
              <div className="relative">
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value as DueDiligenceQuestionnaireTemplateId)}
                  className={`${inputClass} appearance-none pr-8`}
                >
                  {QUESTIONNAIRE_TEMPLATE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              </div>
            </FormRow>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded border border-zinc-200 bg-white px-5 py-2 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!title.trim() || !company.trim() || !ddDate}
            className="rounded bg-red-500 px-5 py-2 text-sm text-white hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            确定
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
