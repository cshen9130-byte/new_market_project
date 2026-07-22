export type FofMonthlyNavFrequency = "daily" | "weekly" | "monthly"

export type FofMonthlyReportPreset = {
  name: string
  product_name: string
  beian_hao: string | null
  product_source: "managed" | "private" | "custom_fund"
  report_title: string
  month_begin: string
  month_end: string
  benchmark_key: string
  nav_frequency: FofMonthlyNavFrequency
  savedAt: string
}

function storageKey(): string {
  if (typeof window === "undefined") return "fof_monthly_report_presets_default"
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    const id = u?.id ?? "default"
    return `fof_monthly_report_presets_${id}`
  } catch {
    return "fof_monthly_report_presets_default"
  }
}

export function loadFofMonthlyReportPresets(): FofMonthlyReportPreset[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function persistFofMonthlyReportPresets(presets: FofMonthlyReportPreset[]): void {
  if (typeof window === "undefined") return
  localStorage.setItem(storageKey(), JSON.stringify(presets))
}

export function upsertFofMonthlyReportPreset(preset: FofMonthlyReportPreset): FofMonthlyReportPreset[] {
  const presets = loadFofMonthlyReportPresets()
  const next = presets.filter((item) => item.name !== preset.name)
  next.unshift(preset)
  persistFofMonthlyReportPresets(next)
  return next
}

export function deleteFofMonthlyReportPreset(name: string): FofMonthlyReportPreset[] {
  const next = loadFofMonthlyReportPresets().filter((item) => item.name !== name)
  persistFofMonthlyReportPresets(next)
  return next
}
