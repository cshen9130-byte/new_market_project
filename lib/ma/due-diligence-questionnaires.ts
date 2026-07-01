export type DueDiligenceQuestionnaireTemplateId = "simple" | "general"

export type DueDiligenceQuestionnaireDraft = {
  title: string
  company: string
  ddDate: string
  templateId: DueDiligenceQuestionnaireTemplateId
}

export type DueDiligenceQuestionnaireStatus = "待提交" | "已提交"

export type DueDiligenceQuestionnaire = DueDiligenceQuestionnaireDraft & {
  id: string
  templateLabel: string
  status: DueDiligenceQuestionnaireStatus
  submitter: string
  createdDate: string
}

const STORAGE_KEY = "dd_diligence_questionnaires"

export const QUESTIONNAIRE_TEMPLATE_OPTIONS: {
  id: DueDiligenceQuestionnaireTemplateId
  label: string
}[] = [
  { id: "simple", label: "尽调报告简易模版" },
  { id: "general", label: "尽调报告通用模版" },
]

function templateLabel(templateId: DueDiligenceQuestionnaireTemplateId): string {
  return QUESTIONNAIRE_TEMPLATE_OPTIONS.find((t) => t.id === templateId)?.label ?? "尽调报告简易模版"
}

export function loadDueDiligenceQuestionnaires(): DueDiligenceQuestionnaire[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveDueDiligenceQuestionnaires(items: DueDiligenceQuestionnaire[]): void {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function listDueDiligenceQuestionnaires(): DueDiligenceQuestionnaire[] {
  return loadDueDiligenceQuestionnaires()
}

export function getDueDiligenceQuestionnaire(id: string): DueDiligenceQuestionnaire | null {
  return loadDueDiligenceQuestionnaires().find((q) => q.id === id) ?? null
}

export function createDueDiligenceQuestionnaire(
  draft: DueDiligenceQuestionnaireDraft,
): DueDiligenceQuestionnaire {
  const now = new Date()
  const item: DueDiligenceQuestionnaire = {
    ...draft,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    templateLabel: templateLabel(draft.templateId),
    status: "待提交",
    submitter: "—",
    createdDate: now.toISOString().slice(0, 10),
  }
  saveDueDiligenceQuestionnaires([item, ...loadDueDiligenceQuestionnaires()])
  return item
}

export function updateDueDiligenceQuestionnaire(
  id: string,
  patch: Partial<DueDiligenceQuestionnaireDraft>,
): DueDiligenceQuestionnaire | null {
  let updated: DueDiligenceQuestionnaire | null = null
  const next = loadDueDiligenceQuestionnaires().map((item) => {
    if (item.id !== id) return item
    const templateId = patch.templateId ?? item.templateId
    updated = {
      ...item,
      ...patch,
      templateId,
      templateLabel: templateLabel(templateId),
    }
    return updated
  })
  if (!updated) return null
  saveDueDiligenceQuestionnaires(next)
  return updated
}

export function deleteDueDiligenceQuestionnaire(id: string): void {
  saveDueDiligenceQuestionnaires(loadDueDiligenceQuestionnaires().filter((q) => q.id !== id))
}

export function dueDiligenceQuestionnaireFillUrl(id: string): string {
  if (typeof window === "undefined") {
    return `/ma/dashboard/private-funds/due-diligence-questionnaire/fill?id=${id}`
  }
  const origin = window.location.origin
  return `${origin}/ma/dashboard/private-funds/due-diligence-questionnaire/fill?id=${id}`
}
