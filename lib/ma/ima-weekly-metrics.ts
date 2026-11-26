/**
 * Match an ima点睛 manager to one product, and fill only the same 口径.
 * 指增 sheets use excess. Other sheets use absolute returns.
 * 今年以来 is not 近一年, so it is never copied.
 */

import { emptyXiaohePeriods, type XiaoheComparable, type XiaohePeriods } from "@/lib/ma/xiaohe-weekly-rows"

const CITIES = /^(?:上海|北京|深圳|广州|杭州|南京|成都|重庆|天津|苏州|宁波|武汉|厦门|青岛|大连|香港)/u

const LEGAL_SUFFIXES = [
  "私募基金管理合伙企业（有限合伙）",
  "私募基金管理合伙企业",
  "私募基金管理有限公司",
  "基金管理有限公司",
  "资产管理有限公司",
  "投资管理有限公司",
  "投资管理合伙企业",
  "管理有限公司",
  "有限责任公司",
  "有限公司",
]

const TAIL_SUFFIXES = ["私募基金", "资管", "私募", "投资", "资产", "资本", "基金"]

export type ImaProductCandidate = {
  beian: string
  name: string
  navDate: string | null
  inPool: boolean
}

export type ImaWeekPoint = {
  weekEnd: string
  value: number | null
}

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value)
}

function pick(primary: number | null | undefined, fallback: number | null | undefined): number | null {
  if (finite(primary)) return primary
  if (finite(fallback)) return fallback
  return null
}

/** 锋滔资产 and 上海锋滔资管 share one key. */
export function imaManagerKey(name: string): string {
  let s = name.replace(/\s+/g, "").replace(/[（(][^）)]*[）)]/gu, "")
  s = s.replace(CITIES, "")
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of LEGAL_SUFFIXES) {
      if (s.endsWith(suffix) && s.length - suffix.length >= 2) {
        s = s.slice(0, -suffix.length)
        changed = true
      }
    }
  }
  for (const suffix of TAIL_SUFFIXES) {
    if (s.endsWith(suffix) && s.length - suffix.length >= 2) {
      s = s.slice(0, -suffix.length)
      break
    }
  }
  return s
}

function addDays(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

function daysBetween(earlier: string, later: string): number {
  const ms = Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

function classRank(beian: string): number {
  const code = beian.trim().toUpperCase()
  if (/A$/.test(code)) return 0
  if (/B$/.test(code)) return 1
  if (/C$/.test(code)) return 2
  return 3
}

function isFirstShare(name: string): boolean {
  return /(?:^|[^0-9])1号|一号/u.test(name)
}

/**
 * One product for this manager on this strategy sheet.
 * A tracking-pool product wins, so the sheet keeps that row and only adds the source.
 */
export function pickImaProduct(
  rows: ImaProductCandidate[],
  pm: string,
  weekStart: string,
): ImaProductCandidate | null {
  if (rows.length === 0) return null
  const pmText = pm.trim()
  const ranked = [...rows].sort((a, b) => {
    if (a.inPool !== b.inPool) return a.inPool ? -1 : 1
    if (pmText) {
      const pa = a.name.includes(pmText)
      const pb = b.name.includes(pmText)
      if (pa !== pb) return pa ? -1 : 1
    }
    const fa = a.navDate != null && a.navDate >= weekStart
    const fb = b.navDate != null && b.navDate >= weekStart
    if (fa !== fb) return fa ? -1 : 1
    const nav = (b.navDate ?? "").localeCompare(a.navDate ?? "")
    if (nav !== 0) return nav
    const first = Number(isFirstShare(b.name)) - Number(isFirstShare(a.name))
    if (first !== 0) return first
    const cls = classRank(a.beian) - classRank(b.beian)
    if (cls !== 0) return cls
    return a.name.localeCompare(b.name, "zh")
  })
  return ranked[0] ?? null
}

function windowPoints(points: ImaWeekPoint[], asOf: string, days: number): ImaWeekPoint[] {
  const start = addDays(asOf, days)
  return points
    .filter((point) => point.value != null && point.weekEnd > start && point.weekEnd <= asOf)
    .sort((a, b) => a.weekEnd.localeCompare(b.weekEnd))
}

/** Enough stored weeks to stand in for this window. Two isolated weeks do not. */
export function imaWindowCovered(points: ImaWeekPoint[], asOf: string, days: number): boolean {
  const used = windowPoints(points, asOf, days)
  if (used.length === 0) return false
  const start = addDays(asOf, days)
  const last = used[used.length - 1]!.weekEnd
  if (daysBetween(last, asOf) > 10) return false
  const firstCover = addDays(used[0]!.weekEnd, 6)
  if (daysBetween(start, firstCover) > Math.max(10, Math.floor(days * 0.25))) return false
  if (daysBetween(used[0]!.weekEnd, last) < Math.floor(days * 0.65)) return false
  return true
}

function compound(points: ImaWeekPoint[]): number | null {
  if (points.length === 0) return null
  let acc = 1
  for (const point of points) acc *= 1 + point.value!
  return acc - 1
}

function maxDrawdown(points: ImaWeekPoint[]): number | null {
  if (points.length < 2) return null
  let equity = 1
  let peak = 1
  let maxDd = 0
  for (const point of points) {
    equity *= 1 + point.value!
    if (equity > peak) peak = equity
    if (peak > 0) maxDd = Math.max(maxDd, (peak - equity) / peak)
  }
  return maxDd
}

export function compoundImaSeries(
  points: ImaWeekPoint[],
  asOf: string,
): { periods: XiaohePeriods; dd6m: number | null; dd1y: number | null } {
  const periods = emptyXiaohePeriods()
  const windows: Array<[keyof XiaohePeriods, number]> = [
    ["ret_1m", 30],
    ["ret_3m", 90],
    ["ret_6m", 180],
    ["ret_1y", 365],
  ]
  for (const [key, days] of windows) {
    if (!imaWindowCovered(points, asOf, days)) continue
    periods[key] = compound(windowPoints(points, asOf, days))
  }
  const dd6 = imaWindowCovered(points, asOf, 180) ? maxDrawdown(windowPoints(points, asOf, 180)) : null
  const dd1 = imaWindowCovered(points, asOf, 365) ? maxDrawdown(windowPoints(points, asOf, 365)) : null
  return { periods, dd6m: dd6, dd1y: dd1 }
}

function blankComparable(): XiaoheComparable {
  return {
    ret: emptyXiaohePeriods(),
    excess: emptyXiaohePeriods(),
    excess_dd_6m: null,
    excess_dd_1y: null,
    sharpe_1y: null,
    calmar_1y: null,
  }
}

/**
 * NAV values win. A null NAV column can take the stored 点睛 number of the same
 * window and the same 口径. Absolute returns never fill an excess column.
 */
export function mergeImaComparable(
  mode: "absolute" | "excess",
  database: XiaoheComparable | null,
  published: XiaoheComparable,
): XiaoheComparable | null {
  const out = blankComparable()
  if (mode === "excess") {
    out.excess = {
      ret_1w: pick(database?.excess.ret_1w, published.excess.ret_1w),
      ret_1m: pick(database?.excess.ret_1m, published.excess.ret_1m),
      ret_3m: pick(database?.excess.ret_3m, published.excess.ret_3m),
      ret_6m: pick(database?.excess.ret_6m, published.excess.ret_6m),
      ret_1y: pick(database?.excess.ret_1y, published.excess.ret_1y),
    }
    out.excess_dd_6m = pick(database?.excess_dd_6m, published.excess_dd_6m)
    out.excess_dd_1y = pick(database?.excess_dd_1y, published.excess_dd_1y)
  } else {
    out.ret = {
      ret_1w: pick(database?.ret.ret_1w, published.ret.ret_1w),
      ret_1m: pick(database?.ret.ret_1m, published.ret.ret_1m),
      ret_3m: pick(database?.ret.ret_3m, published.ret.ret_3m),
      ret_6m: pick(database?.ret.ret_6m, published.ret.ret_6m),
      ret_1y: pick(database?.ret.ret_1y, published.ret.ret_1y),
    }
    out.sharpe_1y = pick(database?.sharpe_1y, published.sharpe_1y)
    out.calmar_1y = pick(database?.calmar_1y, published.calmar_1y)
  }
  const values = mode === "excess"
    ? [...Object.values(out.excess), out.excess_dd_6m, out.excess_dd_1y]
    : [...Object.values(out.ret), out.sharpe_1y, out.calmar_1y]
  return values.some(finite) ? out : null
}
