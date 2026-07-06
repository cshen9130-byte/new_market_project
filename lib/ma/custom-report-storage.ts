export type SavedCustomReport = {
  id: string
  title: string
  templateId: string
  templateName: string
  inputValues: Record<string, string>
  createdAt: string
  updatedAt: string
  creator?: string
}

export const CUSTOM_REPORTS_STORAGE_KEY = "custom_generated_reports_v1"

export function loadCustomReports(): SavedCustomReport[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(CUSTOM_REPORTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedCustomReport[]) : []
  } catch {
    return []
  }
}

export function saveCustomReports(reports: SavedCustomReport[]): void {
  if (typeof window === "undefined") return
  localStorage.setItem(CUSTOM_REPORTS_STORAGE_KEY, JSON.stringify(reports))
}

export function upsertCustomReport(report: SavedCustomReport): SavedCustomReport[] {
  const all = loadCustomReports()
  const idx = all.findIndex((r) => r.id === report.id)
  const next = idx >= 0 ? all.map((r, i) => (i === idx ? report : r)) : [report, ...all]
  saveCustomReports(next)
  return next
}

export function createReportId(): string {
  return `rpt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}
