export type DueDiligenceReportTemplateId = "simple" | "general"

export type DueDiligenceReportDraft = {
  title: string
  company: string
  ddPerson: string
  ddDate: string
  target: string
  position: string
  method: string
  recommender: string
  detailContent: string
  templateId: DueDiligenceReportTemplateId
}

export type DueDiligenceReport = DueDiligenceReportDraft & {
  id: string
  reviewer: string
  reviewStatus: "未审核" | "已审核"
  teamShared: boolean
  creator: string
  createdDate: string
  modifiedDate: string
  published: boolean
}

const STORAGE_KEY = "dd_diligence_reports"
const LIST_URL = "/ma/dashboard/private-funds?tab=investment&side=inv-dd-report"

export function dueDiligenceReportListUrl(): string {
  return LIST_URL
}

export function dueDiligenceReportEditorUrl(
  template: DueDiligenceReportTemplateId,
  reportId?: string,
): string {
  const params = new URLSearchParams({ template })
  if (reportId) params.set("id", reportId)
  return `/ma/dashboard/private-funds/due-diligence-report/new?${params.toString()}`
}

export function getDueDiligenceReport(id: string): DueDiligenceReport | null {
  return loadDueDiligenceReports().find((r) => r.id === id) ?? null
}

function readCurrentUserName(): string {
  if (typeof window === "undefined") return "—"
  try {
    const raw = localStorage.getItem("currentUser")
    if (!raw) return "—"
    const user = JSON.parse(raw) as { name?: string }
    return user.name?.trim() || "—"
  } catch {
    return "—"
  }
}

export function loadDueDiligenceReports(): DueDiligenceReport[] {
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

export function saveDueDiligenceReports(reports: DueDiligenceReport[]): void {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports))
}

export function publishDueDiligenceReport(draft: DueDiligenceReportDraft): DueDiligenceReport {
  const now = new Date()
  const isoDate = now.toISOString().slice(0, 10)
  const report: DueDiligenceReport = {
    ...draft,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    reviewer: "—",
    reviewStatus: "未审核",
    teamShared: false,
    creator: readCurrentUserName(),
    createdDate: isoDate,
    modifiedDate: isoDate,
    published: true,
  }
  const next = [report, ...loadDueDiligenceReports()]
  saveDueDiligenceReports(next)
  return report
}

export function updateDueDiligenceReport(
  id: string,
  patch: Partial<DueDiligenceReportDraft & Pick<DueDiligenceReport, "reviewer" | "reviewStatus" | "teamShared" | "published">>,
): DueDiligenceReport | null {
  let updated: DueDiligenceReport | null = null
  const next = loadDueDiligenceReports().map((report) => {
    if (report.id !== id) return report
    updated = {
      ...report,
      ...patch,
      modifiedDate: new Date().toISOString().slice(0, 10),
    }
    return updated
  })
  if (!updated) return null
  saveDueDiligenceReports(next)
  return updated
}

export function saveDueDiligenceReportDraft(id: string, draft: DueDiligenceReportDraft): DueDiligenceReport | null {
  return updateDueDiligenceReport(id, draft)
}

export function setDueDiligenceReportTeamShared(id: string, teamShared: boolean): DueDiligenceReport | null {
  return updateDueDiligenceReport(id, { teamShared })
}

export function setDueDiligenceReportReviewer(id: string, reviewer: string): DueDiligenceReport | null {
  return updateDueDiligenceReport(id, {
    reviewer: reviewer.trim() || "—",
    reviewStatus: "未审核",
  })
}

export function deleteDueDiligenceReport(id: string): void {
  saveDueDiligenceReports(loadDueDiligenceReports().filter((r) => r.id !== id))
}

export function duplicateDueDiligenceReport(id: string): DueDiligenceReport | null {
  const source = loadDueDiligenceReports().find((r) => r.id === id)
  if (!source) return null
  const copy = publishDueDiligenceReport({
    title: `${source.title}（副本）`,
    company: source.company,
    ddPerson: source.ddPerson,
    ddDate: source.ddDate,
    target: source.target,
    position: source.position,
    method: source.method,
    recommender: source.recommender,
    detailContent: source.detailContent,
    templateId: source.templateId,
  })
  return copy
}

export function listPublishedDueDiligenceReports(): DueDiligenceReport[] {
  return loadDueDiligenceReports().filter((r) => r.published)
}
