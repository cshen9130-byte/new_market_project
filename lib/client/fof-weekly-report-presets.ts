export type FofWeeklyNavFrequency = "daily" | "weekly" | "monthly"

export type FofWeeklyReportPreset = {
  name: string
  product_name: string
  beian_hao: string | null
  product_source: "managed" | "private" | "custom_fund"
  report_title: string
  week_begin: string
  week_end: string
  benchmark_key: string
  nav_frequency: FofWeeklyNavFrequency
  savedAt: string
}

function storageKey(): string {
  if (typeof window === "undefined") return "fof_weekly_report_presets_default"
  try {
    const u = JSON.parse(localStorage.getItem("currentUser") || "null")
    const id = u?.id ?? "default"
    return `fof_weekly_report_presets_${id}`
  } catch {
    return "fof_weekly_report_presets_default"
  }
}

export function loadFofWeeklyReportPresets(): FofWeeklyReportPreset[] {
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

export function persistFofWeeklyReportPresets(presets: FofWeeklyReportPreset[]): void {
  if (typeof window === "undefined") return
  localStorage.setItem(storageKey(), JSON.stringify(presets))
}

export function upsertFofWeeklyReportPreset(preset: FofWeeklyReportPreset): FofWeeklyReportPreset[] {
  const presets = loadFofWeeklyReportPresets()
  const next = presets.filter((item) => item.name !== preset.name)
  next.unshift(preset)
  persistFofWeeklyReportPresets(next)
  return next
}

export function deleteFofWeeklyReportPreset(name: string): FofWeeklyReportPreset[] {
  const next = loadFofWeeklyReportPresets().filter((item) => item.name !== name)
  persistFofWeeklyReportPresets(next)
  return next
}
