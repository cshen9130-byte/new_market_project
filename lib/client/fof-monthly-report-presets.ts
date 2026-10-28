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

/** Soft cap: presets are tiny, but unbounded growth + a full origin quota still breaks setItem. */
const MAX_STORED_PRESETS = 40

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

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { name?: string; code?: number | string }
  return (
    e.name === "QuotaExceededError"
    || e.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || e.code === 22
    || e.code === 1014
  )
}

/** Keep only schema fields so accidental/extra payload never bloats the key. */
function slimPreset(preset: FofMonthlyReportPreset): FofMonthlyReportPreset {
  const freq = preset.nav_frequency
  const nav_frequency: FofMonthlyNavFrequency =
    freq === "daily" || freq === "weekly" || freq === "monthly" ? freq : "weekly"
  const source = preset.product_source
  const product_source =
    source === "managed" || source === "private" || source === "custom_fund" ? source : "managed"
  return {
    name: String(preset.name ?? "").slice(0, 120),
    product_name: String(preset.product_name ?? "").slice(0, 200),
    beian_hao: preset.beian_hao == null || preset.beian_hao === "" ? null : String(preset.beian_hao).slice(0, 80),
    product_source,
    report_title: String(preset.report_title ?? "").slice(0, 200),
    month_begin: String(preset.month_begin ?? "").slice(0, 32),
    month_end: String(preset.month_end ?? "").slice(0, 32),
    benchmark_key: String(preset.benchmark_key ?? "").slice(0, 80),
    nav_frequency,
    savedAt: String(preset.savedAt ?? new Date().toISOString()).slice(0, 40),
  }
}

/**
 * Free disposable MA client caches so a small preset write can succeed when the
 * origin localStorage quota is already full (tracking list caches + report download blobs).
 * Does not delete other users' presets or login.
 */
function freeDisposableLocalStorage(): void {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("tracking_list_cache")) localStorage.removeItem(k)
    }
  } catch {
    /* ignore */
  }

  // Slim custom_generated_reports_v1 in place (avoid importing custom-report-storage: it imports us).
  const reportsKey = "custom_generated_reports_v1"
  try {
    const raw = localStorage.getItem(reportsKey)
    if (!raw || raw.length < 20_000) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return
    const slimmed = parsed.slice(0, 80).map((row: Record<string, unknown>) => {
      const { download: _download, ...rest } = row
      return rest
    })
    localStorage.setItem(reportsKey, JSON.stringify(slimmed))
  } catch {
    try {
      localStorage.removeItem(reportsKey)
    } catch {
      /* ignore */
    }
  }
}

function writePresetsPayload(presets: FofMonthlyReportPreset[]): void {
  localStorage.setItem(storageKey(), JSON.stringify(presets))
}

export function loadFofMonthlyReportPresets(): FofMonthlyReportPreset[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(storageKey())
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => slimPreset(item as FofMonthlyReportPreset))
  } catch {
    return []
  }
}

/**
 * Persist presets without throwing on quota when recoverable.
 * Caps length, strips unknown fields, frees disposable caches, then prunes oldest.
 */
export function persistFofMonthlyReportPresets(presets: FofMonthlyReportPreset[]): void {
  if (typeof window === "undefined") return
  let next = presets.map(slimPreset).slice(0, MAX_STORED_PRESETS)

  try {
    writePresetsPayload(next)
    return
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err
  }

  freeDisposableLocalStorage()
  try {
    writePresetsPayload(next)
    return
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err
  }

  next = next.slice(0, Math.max(5, Math.floor(next.length / 2)))
  try {
    writePresetsPayload(next)
    return
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err
  }

  next = next.slice(0, 5)
  try {
    writePresetsPayload(next)
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err
    throw new Error("浏览器本地存储空间不足，无法保存配置。请删除部分旧配置或清理「我的报告」后再试。")
  }
}

export function upsertFofMonthlyReportPreset(preset: FofMonthlyReportPreset): FofMonthlyReportPreset[] {
  const presets = loadFofMonthlyReportPresets()
  const slimmed = slimPreset(preset)
  const next = presets.filter((item) => item.name !== slimmed.name)
  next.unshift(slimmed)
  persistFofMonthlyReportPresets(next)
  return loadFofMonthlyReportPresets()
}

export function deleteFofMonthlyReportPreset(name: string): FofMonthlyReportPreset[] {
  const next = loadFofMonthlyReportPresets().filter((item) => item.name !== name)
  persistFofMonthlyReportPresets(next)
  return loadFofMonthlyReportPresets()
}