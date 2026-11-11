/** Preferred 净值类型 for private-fund product pages (区间统计 + charts). */
export const DEFAULT_NAV_TYPE = "复权净值" as const

export const NAV_TYPE_OPTIONS = ["复权净值", "单位净值", "累计净值"] as const

export type FundNavType = (typeof NAV_TYPE_OPTIONS)[number]

/** Page-level last choice. Not wiped by clearMaClientCaches. */
export const FUND_NAV_TYPE_PREF_KEY = "ma_private_fund_nav_type"

/** Settings "计算设置" → 默认净值类型. Used only when the page-level key is absent. */
export const CALC_SETTINGS_KEY = "tracking_calc_settings"

export function isFundNavType(value: unknown): value is FundNavType {
  return typeof value === "string" && (NAV_TYPE_OPTIONS as readonly string[]).includes(value)
}

/**
 * First visit / no saved pref → 复权净值.
 * A previously saved 单位净值 or 累计净值 (page key or 计算设置) is kept.
 */
export function readPreferredNavType(): FundNavType {
  if (typeof window === "undefined") return DEFAULT_NAV_TYPE
  try {
    const page = window.localStorage.getItem(FUND_NAV_TYPE_PREF_KEY)
    if (isFundNavType(page)) return page
    const raw = window.localStorage.getItem(CALC_SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { navType?: unknown }
      if (isFundNavType(parsed?.navType)) return parsed.navType
    }
  } catch {
    // ignore quota / private mode / bad JSON
  }
  return DEFAULT_NAV_TYPE
}

export function writePreferredNavType(value: string): void {
  if (typeof window === "undefined" || !isFundNavType(value)) return
  try {
    window.localStorage.setItem(FUND_NAV_TYPE_PREF_KEY, value)
    if (value === "累计净值") return
    const raw = window.localStorage.getItem(CALC_SETTINGS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== "object" || parsed.navType === value) return
    window.localStorage.setItem(CALC_SETTINGS_KEY, JSON.stringify({ ...parsed, navType: value }))
  } catch {
    // ignore quota / private mode / bad JSON
  }
}
