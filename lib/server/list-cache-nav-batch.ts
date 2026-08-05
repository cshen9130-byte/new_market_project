/**
 * Batch NAV resolution for nightly list-cache ETL.
 * Preloads email + legacy NAV once, then resolves in memory (no per-row DB round-trips).
 */

import { query, queryUnbounded } from "@/lib/db"
import { computeFundNavMetrics, isPlausibleRiskRatio } from "@/lib/fund-nav-metrics"
import { isChinaTradingDay } from "@/lib/server/china-trading-calendar"
import {
  collectFundNameAliases,
  dedupeLegacyNavRowsByDate,
  emailNavSourceTier,
  emailRowMatchesFund,
  inferEmailUnitNav,
  isPostInvestmentVirtualNavEmail,
  isPlausibleEmailUnitNav,
  mergeNavSeriesWithEmail,
  recoverPlausibleEmailUnitNav,
  sanitizeReturnIndexNavSeries,
  selectEmailNavSeriesRows,
  type EmailNavPoint,
  type LegacyNavRow,
  type LegacyNavRowWithPri,
} from "@/lib/server/email-nav-query"
import { lookupManagedProductOverride, alternateBeianCodesFor, remapManagedProductBeianCode } from "@/lib/server/managed-product-beian"
import { loadManagedProductNavSeed } from "@/lib/server/managed-product-nav-seed"
import {
  shareClassProductCodesMatch,
  sqlEmailNavShareClassGuard,
  sqlFundNameBase,
  stripShareClassFromProductCode,
} from "@/lib/server/fund-name-match"
import { fofUnderlyingNavLookupKeys } from "@/lib/server/fund-holding-code"
import {
  lookupFundNavCorrectionRule,
  type FundNavSeriesContext,
} from "@/lib/server/fund-nav-correction-rules"

export type NavPoint = {
  nav: number
  nav_date: string
  /** 复权净值 for period-return / risk metrics; defaults to unit nav when absent. */
  return_nav?: number
  source?: string | null
  subject?: string | null
}

function navForReturn(p: NavPoint | null | undefined, fallback?: number): number | null {
  if (!p) return fallback ?? null
  const v = p.return_nav ?? p.nav
  return Number.isFinite(v) && v > 0 ? v : (fallback ?? null)
}

/**
 * Reject "daily" 最新涨跌幅 computed across sparse history gaps (e.g. weekly NAVs are
 * fine at ~7d; VN917B Jul-30 tip vs Jun-12 email is 48d → bogus −8.10%).
 */
export const MAX_DAILY_RETURN_LOOKBACK_DAYS = 21

/**
 * Daily 复权 return for list 最新涨跌幅 — must be the day of `navDate`, matching detail
 * 平台数据. Never reuse an older tip's day return when history lags the listed NAV date.
 */
export function calcDailyReturnPctFromHistory(
  historyAsc: NavPoint[],
  unitNav: number,
  navDate: string,
  fallbackReturnPct: number | null = null,
): number | null {
  const sorted = enrichReturnNavSeries(historyAsc)
  let curr = sorted.find((p) => p.nav_date === navDate) ?? null
  if (!curr && Number.isFinite(unitNav) && unitNav > 0) {
    const tip = sorted.filter((p) => p.nav_date < navDate).at(-1) ?? null
    const tipReturn = navForReturn(tip)
    const tipUnit = tip && tip.nav > 0 ? tip.nav : null
    const returnNav =
      tipReturn != null && tipUnit != null
        ? tipReturn * (unitNav / tipUnit)
        : unitNav
    curr = { nav: unitNav, nav_date: navDate, return_nav: returnNav }
  }
  if (!curr) return fallbackReturnPct ?? null

  let prev: NavPoint | null = null
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].nav_date < navDate) {
      prev = sorted[i]
      break
    }
  }
  if (prev) {
    if (calendarDaysBetween(navDate, prev.nav_date) > MAX_DAILY_RETURN_LOOKBACK_DAYS) {
      return fallbackReturnPct ?? null
    }
    const currReturn = navForReturn(curr, unitNav)
    const prevReturn = navForReturn(prev)
    if (currReturn != null && prevReturn != null) return calcReturn(currReturn, prevReturn)
  }
  return fallbackReturnPct ?? null
}

const MIN_RETURN_NAV_RATIO = 0.85
const MAX_RETURN_NAV_RATIO = 2.5

/**
 * Forward-fill 复权 from legacy rows onto email-only points that carry unit NAV only.
 * Keeps ret_1w/1m/3m on the same scale as max-drawdown / Sharpe (SLA063 / ASX73A pattern).
 */
export function enrichReturnNavSeries(points: NavPoint[]): NavPoint[] {
  const sorted = [...points].sort((a, b) => a.nav_date.localeCompare(b.nav_date))
  let lastRatio: number | null = null
  return sorted.map((row) => {
    const unit = row.nav
    const existing = row.return_nav
    if (existing != null && Number.isFinite(existing) && unit > 0) {
      const ratio = existing / unit
      if (
        ratio >= MIN_RETURN_NAV_RATIO
        && ratio <= MAX_RETURN_NAV_RATIO
        && Math.abs(ratio - 1) > 0.02
      ) {
        lastRatio = ratio
        return { ...row, return_nav: existing }
      }
    }
    if (lastRatio != null && unit > 0) {
      return { ...row, return_nav: +(unit * lastRatio).toFixed(6) }
    }
    return row
  })
}

function maxDrawdownFraction(values: number[]): number {
  if (values.length < 2) return 0
  let peak = values[0]
  let maxDd = 0
  for (const v of values) {
    if (v > peak) peak = v
    if (peak > 0) maxDd = Math.max(maxDd, (peak - v) / peak)
  }
  return maxDd
}

/** Period loss cannot exceed lifetime or window max drawdown on the same return series. */
export function capPeriodReturnByDrawdown(
  ret: number | null,
  historyAsc: NavPoint[],
  navDate: string,
  periodDays: number,
): number | null {
  if (ret == null || ret >= -0.001) return ret
  const toValues = (pts: NavPoint[]) =>
    pts.map((p) => navForReturn(p)).filter((v): v is number => v != null && v > 0)
  const windowStart = addDays(navDate, periodDays + 5)
  const windowValues = toValues(
    historyAsc.filter((p) => p.nav_date >= windowStart && p.nav_date <= navDate),
  )
  const lifetimeValues = toValues(historyAsc.filter((p) => p.nav_date <= navDate))
  const cap = Math.max(
    maxDrawdownFraction(windowValues),
    maxDrawdownFraction(lifetimeValues),
  ) + 0.005
  if (Math.abs(ret) > cap + 0.01) return null
  return ret
}

function resolvePeriodBaseFromHistory(
  historyAsc: NavPoint[],
  navDate: string,
  periodDays: number,
  latestReturnNav: number,
): NavPoint | null {
  const targetDate = addDays(navDate, periodDays)
  const targetMs = new Date(`${targetDate}T00:00:00Z`).getTime()
  let best: NavPoint | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const p of historyAsc) {
    if (p.nav_date >= navDate) break
    const baseNav = navForReturn(p)
    if (baseNav == null || !isSameShareClassNavLevel(latestReturnNav, baseNav, periodDays)) continue
    const gap = calendarDaysBetween(navDate, p.nav_date)
    if (gap > periodDays * 2) continue
    if (isStalePeriodBase(navDate, p.nav_date, periodDays)) continue
    const dist = Math.abs(new Date(`${p.nav_date}T00:00:00Z`).getTime() - targetMs)
    const score = dist + Math.max(0, periodDays - gap) * 86_400_000 * 0.001
    if (score < bestScore) {
      bestScore = score
      best = p
    }
  }
  return best
}

function legacyRowToNavPoint(row: LegacyNavRow): NavPoint | null {
  const nav = parseNav(row.nav)
  if (nav == null) return null
  const adj = parseNav(row.cumulative_nav)
  return {
    nav_date: row.price_date.slice(0, 10),
    nav,
    return_nav: adj ?? nav,
  }
}

function navPointToLegacyRow(point: NavPoint): LegacyNavRow {
  const nav = String(point.nav)
  const ret = point.return_nav != null ? String(point.return_nav) : nav
  return {
    price_date: point.nav_date,
    nav,
    cumulative_nav: ret,
    cum_nav_withdrawal: ret,
    price_change: "",
  }
}

/** Remove return-index spikes/tails unless fund has a preserve_high_nav_scale rule. */
export function sanitizeNavPointSeries(
  points: NavPoint[],
  context?: FundNavSeriesContext | null,
): NavPoint[] {
  if (points.length < 2) return applyNavPointSeriesStartTrim(points, context)
  if (lookupFundNavCorrectionRule(context?.beian_hao, context?.product_name, context?.short_name)?.preserve_high_nav_scale) {
    return applyNavPointSeriesStartTrim(points, context)
  }
  const asc = [...points].sort((a, b) => a.nav_date.localeCompare(b.nav_date))
  const legacy = asc.map(navPointToLegacyRow)
  const cleaned = sanitizeReturnIndexNavSeries(legacy, context)
  const byDate = new Map(cleaned.map((row) => [row.price_date.slice(0, 10), row]))
  const out: NavPoint[] = []
  for (const point of asc) {
    const row = byDate.get(point.nav_date)
    if (!row) continue
    const p = legacyRowToNavPoint(row)
    if (p) {
      out.push({
        ...p,
        source: point.source,
        subject: point.subject,
      })
    }
  }
  out.sort((a, b) => b.nav_date.localeCompare(a.nav_date))
  return applyNavPointSeriesStartTrim(out, context)
}

function applyNavPointSeriesStartTrim(
  points: NavPoint[],
  context?: FundNavSeriesContext | null,
): NavPoint[] {
  const rule = lookupFundNavCorrectionRule(
    context?.beian_hao,
    context?.product_name,
    context?.short_name,
  )
  if (!rule?.series_start_date) return points
  const start = rule.series_start_date
  return points.filter((p) => p.nav_date >= start)
}

function dedupeLegacyBatchRows(
  rows: LegacyNavRowWithPri[],
  context?: FundNavSeriesContext | null,
): NavPoint[] {
  const deduped = dedupeLegacyNavRowsByDate(rows)
  const points: NavPoint[] = []
  for (const row of deduped) {
    const p = legacyRowToNavPoint(row)
    if (p) points.push(p)
  }
  return sanitizeNavPointSeries(points, context)
}

function isPrimaryEmailNavPoint(p: NavPoint): boolean {
  if (p.source === "attachment_valuation_table") return false
  const meta = `${p.subject ?? ""}`
  if (/估值表/u.test(meta)) return false
  return true
}

function latestVirtualUnitRatioByCode(
  rows: Array<{ code: string; nav_date: string; nav: string; cumulative_nav: string | null; subject: string | null }>,
): Map<string, number> {
  const bestDate = new Map<string, string>()
  const out = new Map<string, number>()
  for (const row of rows) {
    if (!isPostInvestmentVirtualNavEmail(row.subject)) continue
    const code = (row.code ?? "").trim()
    if (!code) continue
    const unit = parseNav(row.nav)
    const cum = parseNav(row.cumulative_nav ?? "")
    if (unit == null || cum == null || cum - unit <= 0.05) continue
    const date = row.nav_date.slice(0, 10)
    const prevDate = bestDate.get(code)
    if (prevDate != null && prevDate > date) continue
    bestDate.set(code, date)
    out.set(code, unit / cum)
  }
  return out
}

/** Custody 估值表 must keep raw unit NAV — same rule as applyEmailUnitNavCorrection. */
function isCustodyValuationBatchRow(row: {
  source?: string | null
  subject?: string | null
  attachment_filename?: string | null
}): boolean {
  if (row.source === "attachment_valuation_table") return true
  const meta = `${row.subject ?? ""} ${row.attachment_filename ?? ""}`
  return /估值表/u.test(meta)
}

function resolveEmailNavAt(points: NavPoint[] | undefined, beforeDate: string): NavPoint | null {
  if (!points?.length) return null
  const primary = points.filter(isPrimaryEmailNavPoint)
  const fromPrimary = navAtOrBefore(primary, beforeDate)
  const fromAll = navAtOrBefore(points, beforeDate)
  if (!fromPrimary) return fromAll
  if (!fromAll) return fromPrimary
  // Custody 估值表 often continues after the last 净值公告 (SAVM35-style). Prefer the
  // fresher point across all email sources; same-date ties still favor primary streams.
  if (fromAll.nav_date > fromPrimary.nav_date) return fromAll
  return fromPrimary
}

export type ProductNavIdentity = {
  beian_hao: string | null
  product_name: string
  short_name: string | null
}

export const RETURN_OFFSETS = [
  { key: "ret_1w" as const, days: 7 },
  { key: "ret_1m" as const, days: 30 },
  { key: "ret_3m" as const, days: 90 },
  { key: "ret_6m" as const, days: 180 },
  { key: "ret_1y" as const, days: 365 },
]

/** History window for batch preload — must cover 1y returns from each fund's latest NAV. */
export const NAV_HISTORY_LOOKBACK_DAYS = 400

export function fmtDate(d: string | Date | null): string | null {
  if (!d) return null
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return String(d).slice(0, 10)
}

export function calendarDaysBetween(laterDate: string, earlierDate: string): number {
  const later = new Date(`${laterDate.slice(0, 10)}T00:00:00Z`).getTime()
  const earlier = new Date(`${earlierDate.slice(0, 10)}T00:00:00Z`).getTime()
  return Math.round((later - earlier) / 86_400_000)
}

/** Reject period bases that are far older than the requested window (data gaps / share-class switches). */
export function isStalePeriodBase(navDate: string, baseDate: string | null | undefined, periodDays: number): boolean {
  if (!baseDate) return true
  const gap = calendarDaysBetween(navDate, baseDate)
  const slack = Math.max(5, Math.floor(periodDays * 0.15))
  return gap > periodDays + slack
}

/**
 * Same share-class / NAV-scale tier.
 * Default ±15% rejects A/B jumps (~1.09 vs ~1.45) and unit-vs-复权 mixes.
 * Short windows use a tighter band so a single contaminated base (~1.10 vs 0.97)
 * cannot produce absurd 近一周收益 (e.g. 金舆基石一号 / SAVW72 −11.89%).
 */
export function isSameShareClassNavLevel(
  latestNav: number,
  baseNav: number,
  periodDays?: number,
): boolean {
  if (!Number.isFinite(latestNav) || !Number.isFinite(baseNav) || latestNav <= 0 || baseNav <= 0) {
    return false
  }
  const maxRatio =
    periodDays != null && periodDays <= 7 ? 1.06
    : periodDays != null && periodDays <= 31 ? 1.10
    : 1.15
  const minRatio = 1 / maxRatio
  const ratio = baseNav / latestNav
  return ratio >= minRatio && ratio <= maxRatio
}

export function addDays(isoDate: string, days: number): string {
  // Positive days = lookback (subtract). Callers pass NAV_HISTORY_LOOKBACK_DAYS (400), not -400.
  const dt = new Date(`${isoDate}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

/** Fit a JS number into PostgreSQL NUMERIC(precision, scale); null if non-finite or out of range. */
export function clampPgNumeric(
  value: number | null | undefined,
  precision: number,
  scale: number,
): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const max = 10 ** (precision - scale) - 10 ** -scale
  if (Math.abs(value) >= max) return null
  return Math.round(value * 10 ** scale) / 10 ** scale
}

export function calcReturn(current: number, base: number | null | undefined): number | null {
  if (base == null || !Number.isFinite(base) || base === 0 || !Number.isFinite(current)) return null
  return current / base - 1
}

function navAtOrBefore(points: NavPoint[] | undefined, beforeDate: string): NavPoint | null {
  if (!points?.length) return null
  for (const p of points) {
    if (p.nav_date <= beforeDate && isChinaTradingDay(p.nav_date)) return p
  }
  return null
}


function parseNav(v: string): number | null {
  const nav = parseFloat(v)
  return Number.isFinite(nav) && nav > 0 ? nav : null
}

/**
 * Rechain selected email rows so list `return_nav` matches detail 复权净值
 * (mergeNavSeriesWithEmail + finalize). Daily 最新涨跌幅 then uses 复权, not 单位净值.
 */
function navPointsFromEmailSeries(
  selected: Array<{
    nav_date: string
    nav: string
    cumulative_nav: string | null
    adjusted_nav?: string | null
    source: string | null
    subject: string | null
  }>,
  context: FundNavSeriesContext,
): NavPoint[] {
  if (selected.length === 0) return []
  const emailPts: EmailNavPoint[] = selected.map((row) => ({
    price_date: row.nav_date.slice(0, 10),
    nav: row.nav,
    cumulative_nav: row.cumulative_nav,
    adjusted_nav: row.adjusted_nav ?? null,
  }))
  const merged = mergeNavSeriesWithEmail([], emailPts, context)
  const metaByDate = new Map(selected.map((r) => [r.nav_date.slice(0, 10), r]))
  const out: NavPoint[] = []
  for (const row of merged) {
    const point = legacyRowToNavPoint(row)
    if (!point) continue
    const meta = metaByDate.get(point.nav_date)
    out.push({
      ...point,
      source: meta?.source ?? null,
      subject: meta?.subject ?? null,
    })
  }
  return out
}

function pushNavPoint(map: Map<string, NavPoint[]>, key: string, point: NavPoint): void {
  if (!key) return
  const list = map.get(key)
  if (list) list.push(point)
  else map.set(key, [point])
}

function sortNavMapsDesc(maps: Map<string, NavPoint[]>[]): void {
  for (const map of maps) {
    for (const [key, list] of map) {
      list.sort((a, b) => b.nav_date.localeCompare(a.nav_date))
      map.set(key, list)
    }
  }
}

async function loadEmailProductCodesForNames(names: string[]): Promise<string[]> {
  const validNames = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (validNames.length === 0) return []

  // Prefer indexed equality (btrim / name-base) over the full fuzzy ILIKE join.
  // The reverse-prefix ILIKE path cannot use btree indexes and was hanging nightly
  // investment_pool_metrics when tracking (~6k names) hit ops_email_nav_records.
  const rows = await query<{ code: string }>(
    `WITH names AS (
       SELECT BTRIM(name) AS name
       FROM unnest($1::text[]) AS t(name)
       WHERE BTRIM(name) <> ''
     ),
     name_bases AS (
       SELECT DISTINCT ${sqlFundNameBase("name")} AS base
       FROM names
       WHERE ${sqlFundNameBase("name")} IS NOT NULL
     )
     SELECT DISTINCT BTRIM(e.product_code) AS code
     FROM ops_email_nav_records e
     WHERE NULLIF(BTRIM(e.product_code), '') IS NOT NULL
       AND (
         BTRIM(e.fund_name) IN (SELECT name FROM names)
         OR ${sqlFundNameBase("e.fund_name")} IN (SELECT base FROM name_bases)
       )`,
    [validNames],
  )
  return rows.map((r) => r.code.trim()).filter(Boolean)
}

type EmailNavBatchRow = {
  code: string
  nav_date: string
  nav: string
  cumulative_nav: string | null
  source: string | null
  subject: string | null
  product_code: string | null
  fund_name: string | null
  attachment_filename: string | null
  id?: string | number | null
}

function filterEmailBatchRow(
  row: EmailNavBatchRow,
  beian: string,
  aliases: string[],
): boolean {
  return emailRowMatchesFund(
    {
      nav_date: row.nav_date,
      nav: row.nav,
      cumulative_nav: null,
      adjusted_nav: null,
      product_code: row.product_code,
      fund_name: row.fund_name,
      attachment_filename: row.attachment_filename,
      subject: row.subject,
      source: row.source,
    },
    beian,
    aliases,
  )
}

function expandBeiansWithParentCodes(codes: string[]): string[] {
  const out = new Set<string>()
  for (const raw of codes) {
    const code = raw.trim().toUpperCase()
    if (!code) continue
    out.add(code)
    const parent = code.replace(/[ABC]$/u, "")
    if (parent !== code) out.add(parent)
  }
  return [...out]
}

/**
 * Expand to the S-prefixed / bare / A·B·C share-class family so list batch can load
 * BHK26A rows when resolving parent SBHK26 (detail already does via name + share-class fallback).
 * Also includes known custody/legacy code aliases (e.g. SBT723 ↔ SET723).
 */
export function expandBeiansWithShareClassFamily(codes: string[]): string[] {
  const out = new Set<string>()
  for (const raw of codes) {
    const code = raw.trim().toUpperCase()
    if (!code) continue
    out.add(code)
    const remapped = remapManagedProductBeianCode(code)
    if (remapped) out.add(remapped)
    for (const alt of alternateBeianCodesFor(code)) out.add(alt)
    if (remapped) {
      for (const alt of alternateBeianCodesFor(remapped)) out.add(alt)
    }
    const stripped = stripShareClassFromProductCode(code)
    if (!stripped) continue
    const baseNoS = stripped.startsWith("S") ? stripped.slice(1) : stripped
    const baseWithS = stripped.startsWith("S") ? stripped : `S${stripped}`
    for (const base of [baseNoS, baseWithS]) {
      if (!base) continue
      out.add(base)
      for (const letter of ["A", "B", "C"] as const) {
        out.add(`${base}${letter}`)
      }
    }
  }
  return [...out]
}

/**
 * Detail `selectEmailNavSeriesRows` uses A/B/C email on dates the parent has no row.
 * List batch keys by exact product_code — copy sibling dates onto the parent series
 * (continuity-gated) so SBHK26 advances past the last custody 估值表 with BHK26A virtual NAV.
 */
export function backfillParentEmailFromShareClassSiblings(
  emailByBeian: Map<string, NavPoint[]>,
  parentBeians: string[],
): void {
  for (const raw of parentBeians) {
    const parent = raw.trim().toUpperCase()
    if (!parent || /[ABC]$/u.test(parent)) continue

    const parentPoints = [...(emailByBeian.get(parent) ?? [])]
    const byDate = new Map(parentPoints.map((p) => [p.nav_date, p]))

    const siblingByDate = new Map<string, NavPoint>()
    for (const [code, points] of emailByBeian) {
      const sibling = code.trim().toUpperCase()
      if (!sibling || sibling === parent) continue
      if (!/[ABC]$/u.test(sibling)) continue
      if (!shareClassProductCodesMatch(sibling, parent)) continue
      for (const point of points) {
        if (byDate.has(point.nav_date)) continue
        const prev = siblingByDate.get(point.nav_date)
        if (!prev) {
          siblingByDate.set(point.nav_date, point)
          continue
        }
        // Prefer post-investment virtual / body_table over custody 估值表 for fallback dates.
        if (isPrimaryEmailNavPoint(point) && !isPrimaryEmailNavPoint(prev)) {
          siblingByDate.set(point.nav_date, point)
        }
      }
    }
    if (siblingByDate.size === 0) continue

    const sortedSiblingDates = [...siblingByDate.keys()].sort((a, b) => a.localeCompare(b))
    for (const date of sortedSiblingDates) {
      if (byDate.has(date)) continue
      const point = siblingByDate.get(date)!
      const prior = navAtOrBefore(
        [...byDate.values()].sort((a, b) => b.nav_date.localeCompare(a.nav_date)),
        date,
      )
      if (
        prior
        && prior.nav > 0
        && Math.abs(point.nav / prior.nav - 1) > 0.15
      ) {
        // Same continuity gate as selectEmailNavSeriesRows share-class gaps.
        continue
      }
      byDate.set(date, point)
    }

    emailByBeian.set(
      parent,
      [...byDate.values()].sort((a, b) => b.nav_date.localeCompare(a.nav_date)),
    )
  }
}

async function loadEmailNavBatch(beians: string[], sinceDate: string): Promise<Map<string, NavPoint[]>> {
  const out = new Map<string, NavPoint[]>()
  if (beians.length === 0) return out

  const queryCodes = expandBeiansWithShareClassFamily(beians)
  const rows = await queryUnbounded<EmailNavBatchRow>(
    `SELECT BTRIM(product_code) AS code, nav_date::text AS nav_date, nav::text AS nav,
            cumulative_nav::text, source,
            COALESCE(subject, '') AS subject, product_code, fund_name, attachment_filename,
            id
     FROM ops_email_nav_records
     WHERE BTRIM(product_code) = ANY($1::text[])
       AND nav IS NOT NULL
       AND nav_date >= $2::date
     ORDER BY nav_date ASC, id ASC`,
    [queryCodes, sinceDate],
  )

  const virtualRatioByCode = latestVirtualUnitRatioByCode(rows)

  // Same continuity-aware per-date pick as detail / loadEmailNavByNameBatch.
  // 【基金虚拟净值表现估算】 emails arrive once per FOF investor with different
  // 虚拟净值 under the same product_code; picking max(id) alone mixed investors
  // across days (BHK26A list +3.40% = 金舆 1.0965 / 抱朴 1.0604).
  const rowsByCode = new Map<string, EmailNavBatchRow[]>()
  for (const row of rows) {
    const code = (row.code ?? "").trim()
    if (!code) continue
    const list = rowsByCode.get(code) ?? []
    list.push(row)
    rowsByCode.set(code, list)
  }

  for (const [code, codeRows] of rowsByCode) {
    const aliases = collectFundNameAliases(
      codeRows[0]?.fund_name ?? "",
      null,
      codeRows.map((r) => r.fund_name),
    )
    const selected = selectEmailNavSeriesRows(
      codeRows.map((row) => ({
        nav_date: row.nav_date.slice(0, 10),
        nav: row.nav,
        cumulative_nav: row.cumulative_nav,
        adjusted_nav: null,
        product_code: row.product_code,
        fund_name: row.fund_name,
        attachment_filename: row.attachment_filename,
        subject: row.subject,
        source: row.source,
        id: row.id,
      })),
      code,
      aliases,
    )

    const corrected: Array<{
      nav_date: string
      nav: string
      cumulative_nav: string | null
      source: string | null
      subject: string | null
    }> = []
    for (const row of selected) {
      const rawNav = parseNav(row.nav)
      if (rawNav == null) continue
      // Do not apply A-class virtual unit/cum ratios onto custody 估值表 (SBHK26 → 0.9726 bug).
      const ratio = isCustodyValuationBatchRow(row) ? null : (virtualRatioByCode.get(code) ?? null)
      const cum = row.cumulative_nav != null ? parseFloat(row.cumulative_nav) : null
      let nav = inferEmailUnitNav(rawNav, cum, row.subject, ratio)
      const recovered = recoverPlausibleEmailUnitNav(nav, cum, row.subject)
      if (recovered == null) continue
      nav = recovered
      const batchRow =
        codeRows.find(
          (r) =>
            r.nav_date.slice(0, 10) === row.nav_date
            && String(r.nav) === String(row.nav)
            && (r.subject ?? "") === (row.subject ?? ""),
        ) ?? codeRows.find((r) => r.nav_date.slice(0, 10) === row.nav_date)
      if (batchRow && !filterEmailBatchRow(batchRow, code, aliases)) continue
      corrected.push({
        nav_date: row.nav_date.slice(0, 10),
        nav: String(+nav.toFixed(6)),
        cumulative_nav: row.cumulative_nav,
        source: row.source,
        subject: row.subject,
      })
    }
    for (const point of navPointsFromEmailSeries(corrected, { beian_hao: code })) {
      const canonical = remapManagedProductBeianCode(code) ?? code
      pushNavPoint(out, canonical, point)
      if (canonical !== code) pushNavPoint(out, code, point)
    }
  }
  for (const [code, points] of out) {
    out.set(code, sanitizeNavPointSeries(points, { beian_hao: remapManagedProductBeianCode(code) ?? code }))
  }
  // Parent funds (SBHK26) often stop receiving custody 估值表 while A-class virtual
  // emails (BHK26A) continue — mirror detail share-class date fallback onto parent keys.
  backfillParentEmailFromShareClassSiblings(out, beians)
  sortNavMapsDesc([out])
  return out
}

/**
 * Load email NAV for products whose email records have no product_code (e.g. jinyuasset-style
 * attachments where only the filename carries the fund name, not a beian_hao code).
 * Returns a map keyed by the matched product name (as supplied in `names`).
 */
async function loadEmailNavByNameBatch(
  names: string[],
  sinceDate: string,
  beianByName: Map<string, string> = new Map(),
): Promise<Map<string, NavPoint[]>> {
  const out = new Map<string, NavPoint[]>()
  const validNames = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (validNames.length === 0) return out

  // Indexed equality / name-base match only. The prior reverse-prefix ILIKE join
  // against ops_email_nav_records cannot use btree indexes and hung tracking rebuilds.
  const rows = await queryUnbounded<EmailNavBatchRow & { matched_name: string }>(
    `WITH names AS (
       SELECT BTRIM(name) AS name, ${sqlFundNameBase("name")} AS base
       FROM unnest($1::text[]) AS t(name)
       WHERE BTRIM(name) <> ''
     )
     SELECT n.name AS matched_name, e.nav_date::text AS nav_date, e.nav::text AS nav,
            e.cumulative_nav::text, e.source,
            COALESCE(e.subject, '') AS subject, e.product_code, e.fund_name, e.attachment_filename,
            COALESCE(BTRIM(e.product_code), '') AS code, e.id
     FROM names n
     JOIN ops_email_nav_records e ON (
       e.nav IS NOT NULL
       AND e.nav_date >= $2::date
       AND (
         BTRIM(e.fund_name) = n.name
         OR (
           n.base IS NOT NULL
           AND ${sqlFundNameBase("e.fund_name")} IS NOT NULL
           AND ${sqlFundNameBase("e.fund_name")} = n.base
         )
       )
       AND ${sqlEmailNavShareClassGuard("e.fund_name", "n.name", "e.product_code")}
     )
     ORDER BY e.nav_date ASC, e.id ASC`,
    [validNames, sinceDate],
  )

  const virtualRatioByName = latestVirtualUnitRatioByCode(
    rows.map((row) => ({ ...row, code: row.matched_name })),
  )

  const rowsByName = new Map<string, (EmailNavBatchRow & { matched_name: string })[]>()
  for (const row of rows) {
    const list = rowsByName.get(row.matched_name) ?? []
    list.push(row)
    rowsByName.set(row.matched_name, list)
  }

  for (const [matchedName, nameRows] of rowsByName) {
    const override = lookupManagedProductOverride(matchedName)
    const beianForPick =
      beianByName.get(matchedName)?.trim()
      ?? override?.beian_hao
      ?? ""
    const aliases = collectFundNameAliases(matchedName, nameRows[0]?.fund_name)
    const selected = selectEmailNavSeriesRows(
      nameRows.map((row) => ({
        nav_date: row.nav_date.slice(0, 10),
        nav: row.nav,
        cumulative_nav: row.cumulative_nav,
        adjusted_nav: null,
        product_code: row.product_code,
        fund_name: row.fund_name,
        attachment_filename: row.attachment_filename,
        subject: row.subject,
        source: row.source,
        id: row.id,
      })),
      beianForPick,
      aliases,
    )

    const corrected: Array<{
      nav_date: string
      nav: string
      cumulative_nav: string | null
      source: string | null
      subject: string | null
    }> = []
    for (const row of selected) {
      const rawNav = parseNav(row.nav)
      if (rawNav == null) continue
      const matchBeian = beianForPick
      const batchRow = nameRows.find((r) => r.nav_date.slice(0, 10) === row.nav_date)
      if (matchBeian && batchRow && !filterEmailBatchRow(batchRow, matchBeian, aliases)) continue
      if (
        !matchBeian
        && batchRow
        && !isPostInvestmentVirtualNavEmail(row.subject)
        && /虚拟/u.test(`${row.subject ?? ""}${row.fund_name ?? ""}`)
      ) continue
      // selectEmailNavSeriesRows already corrected units; never re-apply virtual ratios
      // onto custody 估值表 (same SBHK26 0.9726 failure mode as code batch).
      const ratio = isCustodyValuationBatchRow(row) ? null : (virtualRatioByName.get(matchedName) ?? null)
      const cum = row.cumulative_nav != null ? parseFloat(row.cumulative_nav) : null
      let nav = inferEmailUnitNav(rawNav, cum, row.subject, ratio)
      const recovered = recoverPlausibleEmailUnitNav(nav, cum, row.subject)
      if (recovered == null) continue
      nav = recovered
      corrected.push({
        nav_date: row.nav_date.slice(0, 10),
        nav: String(+nav.toFixed(6)),
        cumulative_nav: row.cumulative_nav,
        source: row.source,
        subject: row.subject,
      })
    }
    for (const point of navPointsFromEmailSeries(corrected, {
      beian_hao: beianForPick || null,
      product_name: matchedName,
    })) {
      pushNavPoint(out, matchedName, point)
    }
  }
  for (const [name, points] of out) {
    out.set(name, sanitizeNavPointSeries(points, { product_name: name }))
  }
  sortNavMapsDesc([out])
  return out
}

type LegacyBatchRow = {
  beian_hao: string | null
  product_name: string | null
  price_date: string
  nav: string
  cumulative_nav: string | null
  cum_nav_withdrawal: string | null
  pri: number
}

function pushLegacyBatchRow(
  map: Map<string, LegacyNavRowWithPri[]>,
  key: string,
  row: LegacyBatchRow,
): void {
  if (!key) return
  const list = map.get(key)
  const entry: LegacyNavRowWithPri = {
    price_date: row.price_date.slice(0, 10),
    nav: row.nav,
    cumulative_nav: row.cumulative_nav ?? "",
    cum_nav_withdrawal: row.cum_nav_withdrawal ?? "",
    price_change: "",
    pri: row.pri,
  }
  if (list) list.push(entry)
  else map.set(key, [entry])
}

async function loadLegacyNavBatch(
  beians: string[],
  names: string[],
  sinceDate: string,
): Promise<{ byBeian: Map<string, NavPoint[]>; byProduct: Map<string, NavPoint[]> }> {
  const byBeian = new Map<string, NavPoint[]>()
  const byProduct = new Map<string, NavPoint[]>()
  if (beians.length === 0 && names.length === 0) return { byBeian, byProduct }

  const rows = await queryUnbounded<LegacyBatchRow>(
    `SELECT beian_hao, product_name, price_date::text AS price_date, nav::text AS nav,
            cumulative_nav::text, cum_nav_withdrawal::text, pri
     FROM (
       SELECT beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, 0 AS pri
       FROM private_fund_nav_group
       WHERE price_date >= $3::date
       UNION ALL
       SELECT beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, 1 AS pri
       FROM private_fund_nav_group_hy
       WHERE price_date >= $3::date
       UNION ALL
       SELECT beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, 2 AS pri
       FROM private_fund_nav
       WHERE price_date >= $3::date
     ) nav_union
     WHERE nav IS NOT NULL AND nav > 0
       AND (
         (beian_hao IS NOT NULL AND NULLIF(BTRIM(beian_hao), '') = ANY($1::text[]))
         OR product_name = ANY($2::text[])
       )
     ORDER BY price_date ASC, pri ASC`,
    [beians, names, sinceDate],
  )

  const beianGroups = new Map<string, LegacyNavRowWithPri[]>()
  const productGroups = new Map<string, LegacyNavRowWithPri[]>()

  for (const row of rows) {
    if (parseNav(row.nav) == null) continue
    pushLegacyBatchRow(beianGroups, (row.beian_hao ?? "").trim(), row)
    pushLegacyBatchRow(productGroups, (row.product_name ?? "").trim(), row)
  }

  for (const [beian, groupRows] of beianGroups) {
    byBeian.set(beian, dedupeLegacyBatchRows(groupRows, { beian_hao: beian }))
  }
  for (const [product, groupRows] of productGroups) {
    byProduct.set(product, dedupeLegacyBatchRows(groupRows, { product_name: product }))
  }

  return { byBeian, byProduct }
}

type Type6BatchRow = {
  beian_hao: string | null
  product_name: string | null
  price_date: string
  nav: string
}

async function loadType6NavBatch(
  beians: string[],
  names: string[],
  sinceDate: string,
): Promise<{ byBeian: Map<string, NavPoint[]>; byProduct: Map<string, NavPoint[]> }> {
  const byBeian = new Map<string, NavPoint[]>()
  const byProduct = new Map<string, NavPoint[]>()
  if (beians.length === 0 && names.length === 0) return { byBeian, byProduct }

  const rows = await queryUnbounded<Type6BatchRow>(
    `SELECT beian_hao, product_name, price_date::text AS price_date, nav::text AS nav, 0 AS pri
     FROM private_fund_nav_group_type6
     WHERE price_date >= $3::date
       AND nav IS NOT NULL AND nav > 0
       AND (
         (beian_hao IS NOT NULL AND NULLIF(BTRIM(beian_hao), '') = ANY($1::text[]))
         OR product_name = ANY($2::text[])
       )
     ORDER BY price_date DESC`,
    [beians, names, sinceDate],
  )

  const beianBest = new Map<string, Map<string, number>>()
  const productBest = new Map<string, Map<string, number>>()

  for (const row of rows) {
    const nav = parseNav(row.nav)
    if (nav == null) continue
    const date = row.price_date.slice(0, 10)

    const beian = (row.beian_hao ?? "").trim()
    if (beian) {
      let dates = beianBest.get(beian)
      if (!dates) {
        dates = new Map()
        beianBest.set(beian, dates)
      }
      if (!dates.has(date)) dates.set(date, nav)
    }

    const product = (row.product_name ?? "").trim()
    if (product) {
      let dates = productBest.get(product)
      if (!dates) {
        dates = new Map()
        productBest.set(product, dates)
      }
      if (!dates.has(date)) dates.set(date, nav)
    }
  }

  for (const [beian, dates] of beianBest) {
    byBeian.set(
      beian,
      [...dates.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([nav_date, nav]) => ({ nav_date, nav })),
    )
  }
  for (const [product, dates] of productBest) {
    byProduct.set(
      product,
      [...dates.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([nav_date, nav]) => ({ nav_date, nav })),
    )
  }

  return { byBeian, byProduct }
}

type LatestNavDateHints = {
  byBeian: Map<string, string>
  byProduct: Map<string, string>
}

/** Cheap MAX(price_date) probes — used to detect funds whose latest NAV is outside the default window. */
async function loadLatestNavDateHints(
  beians: string[],
  names: string[],
): Promise<LatestNavDateHints> {
  const byBeian = new Map<string, string>()
  const byProduct = new Map<string, string>()
  if (beians.length === 0 && names.length === 0) return { byBeian, byProduct }

  const mergeLatest = (map: Map<string, string>, key: string, date: string) => {
    const prev = map.get(key)
    if (!prev || date > prev) map.set(key, date)
  }

  const [beianRows, productRows] = await Promise.all([
    beians.length > 0
      ? query<{ beian_hao: string; latest_date: string }>(
          `SELECT beian_hao, MAX(price_date)::text AS latest_date
           FROM (
             SELECT NULLIF(BTRIM(beian_hao), '') AS beian_hao, price_date
             FROM private_fund_nav_group WHERE beian_hao = ANY($1)
             UNION ALL
             SELECT NULLIF(BTRIM(beian_hao), ''), price_date
             FROM private_fund_nav_group_hy WHERE beian_hao = ANY($1)
             UNION ALL
             SELECT NULLIF(BTRIM(beian_hao), ''), price_date
             FROM private_fund_nav WHERE beian_hao = ANY($1)
             UNION ALL
             SELECT NULLIF(BTRIM(beian_hao), ''), price_date
             FROM private_fund_nav_group_type6 WHERE beian_hao = ANY($1)
           ) u
           WHERE beian_hao IS NOT NULL
           GROUP BY beian_hao`,
          [beians],
        )
      : Promise.resolve([]),
    names.length > 0
      ? query<{ product_name: string; latest_date: string }>(
          `SELECT product_name, MAX(price_date)::text AS latest_date
           FROM (
             SELECT product_name, price_date FROM private_fund_nav_group WHERE product_name = ANY($1)
             UNION ALL
             SELECT product_name, price_date FROM private_fund_nav_group_hy WHERE product_name = ANY($1)
             UNION ALL
             SELECT product_name, price_date FROM private_fund_nav WHERE product_name = ANY($1)
             UNION ALL
             SELECT product_name, price_date FROM private_fund_nav_group_type6 WHERE product_name = ANY($1)
           ) u
           WHERE product_name IS NOT NULL
           GROUP BY product_name`,
          [names],
        )
      : Promise.resolve([]),
  ])

  for (const row of beianRows) {
    mergeLatest(byBeian, row.beian_hao, row.latest_date.slice(0, 10))
  }
  for (const row of productRows) {
    mergeLatest(byProduct, row.product_name, row.latest_date.slice(0, 10))
  }

  if (beians.length > 0) {
    const emailRows = await queryUnbounded<{ code: string; latest_date: string }>(
      `SELECT BTRIM(product_code) AS code, MAX(nav_date)::text AS latest_date
       FROM ops_email_nav_records
       WHERE BTRIM(product_code) = ANY($1) AND nav IS NOT NULL
       GROUP BY BTRIM(product_code)`,
      [beians],
    )
    for (const row of emailRows) {
      mergeLatest(byBeian, row.code, row.latest_date.slice(0, 10))
    }
  }

  return { byBeian, byProduct }
}

function latestNavDateForIdentity(
  identity: ProductNavIdentity,
  hints: LatestNavDateHints,
): string | null {
  const beian = (identity.beian_hao ?? "").trim()
  const short = (identity.short_name ?? "").trim()
  return (
    (beian ? hints.byBeian.get(beian) : undefined) ??
    hints.byProduct.get(identity.product_name) ??
    (short ? hints.byProduct.get(short) : undefined) ??
    null
  )
}

function collectStaleNavKeys(
  products: ProductNavIdentity[],
  hints: LatestNavDateHints,
  defaultSince: string,
): { staleBeians: string[]; staleNames: string[]; staleSince: string | null } {
  const staleBeianSet = new Set<string>()
  const staleNameSet = new Set<string>()
  let staleSince: string | null = null

  for (const product of products) {
    const latest = latestNavDateForIdentity(product, hints)
    if (!latest || latest >= defaultSince) continue

    const needSince = addDays(latest, NAV_HISTORY_LOOKBACK_DAYS)
    if (staleSince == null || needSince < staleSince) staleSince = needSince

    const beian = (product.beian_hao ?? "").trim()
    const short = (product.short_name ?? "").trim()
    if (beian) staleBeianSet.add(beian)
    staleNameSet.add(product.product_name)
    if (short) staleNameSet.add(short)
  }

  return {
    staleBeians: [...staleBeianSet],
    staleNames: [...staleNameSet],
    staleSince,
  }
}

function mergeNavPointMaps(target: Map<string, NavPoint[]>, source: Map<string, NavPoint[]>): void {
  for (const [key, points] of source) {
    const existing = target.get(key)
    if (!existing) {
      target.set(key, points)
      continue
    }
    const byDate = new Map(existing.map((p) => [p.nav_date, p]))
    for (const p of points) byDate.set(p.nav_date, p)
    target.set(
      key,
      [...byDate.entries()]
        .sort(([a], [b]) => b.localeCompare(a))
        .map(([, p]) => p),
    )
  }
}

export function computeOneYearRiskMetrics(
  navDate: string | null,
  history: NavPoint[],
): { sharpe_1y: number | null; calmar_1y: number | null } {
  if (history.length < 2) return { sharpe_1y: null, calmar_1y: null }

  const refDate = navDate ? new Date(navDate) : new Date(history[history.length - 1].nav_date)
  const cutoffTs = refDate.getTime() - 365 * 86400000

  const dates: string[] = []
  const values: number[] = []
  for (const row of history) {
    const ts = new Date(row.nav_date).getTime()
    const v = navForReturn(row)
    if (ts >= cutoffTs && ts <= refDate.getTime() && v != null) {
      dates.push(row.nav_date)
      values.push(v)
    }
  }

  if (dates.length < 20) return { sharpe_1y: null, calmar_1y: null }

  const metrics = computeFundNavMetrics({ dates, values })
  if (!metrics) return { sharpe_1y: null, calmar_1y: null }

  const sharpe = Number.isFinite(metrics.sharpe) ? Math.round(metrics.sharpe * 10000) / 10000 : null
  const calmar = Number.isFinite(metrics.calmar) ? Math.round(metrics.calmar * 10000) / 10000 : null
  return {
    sharpe_1y: isPlausibleRiskRatio(sharpe) ? sharpe : null,
    calmar_1y: isPlausibleRiskRatio(calmar) ? calmar : null,
  }
}

export class BatchNavResolver {
  private emailByBeian: Map<string, NavPoint[]>
  private emailByName: Map<string, NavPoint[]>
  private type6ByBeian: Map<string, NavPoint[]>
  private type6ByProduct: Map<string, NavPoint[]>
  private legacyByBeian: Map<string, NavPoint[]>
  private legacyByProduct: Map<string, NavPoint[]>
  private seedByBeian: Map<string, NavPoint[]>
  private seedLatestByBeian: Map<string, string>
  /** Historical NAV points from ops_managed_fof_underlying (FOF holdings). */
  private valuationNavByCode: Map<string, NavPoint[]>
  private valuationNavByName: Map<string, NavPoint[]>

  private constructor(
    emailByBeian: Map<string, NavPoint[]>,
    emailByName: Map<string, NavPoint[]>,
    type6ByBeian: Map<string, NavPoint[]>,
    type6ByProduct: Map<string, NavPoint[]>,
    legacyByBeian: Map<string, NavPoint[]>,
    legacyByProduct: Map<string, NavPoint[]>,
    seedByBeian: Map<string, NavPoint[]>,
    seedLatestByBeian: Map<string, string>,
    valuationNavByCode: Map<string, NavPoint[]> = new Map(),
    valuationNavByName: Map<string, NavPoint[]> = new Map(),
  ) {
    this.emailByBeian = emailByBeian
    this.emailByName = emailByName
    this.type6ByBeian = type6ByBeian
    this.type6ByProduct = type6ByProduct
    this.legacyByBeian = legacyByBeian
    this.legacyByProduct = legacyByProduct
    this.seedByBeian = seedByBeian
    this.seedLatestByBeian = seedLatestByBeian
    this.valuationNavByCode = valuationNavByCode
    this.valuationNavByName = valuationNavByName
  }

  static async create(products: ProductNavIdentity[], asOfDate: string): Promise<BatchNavResolver> {
    const names = [
      ...new Set(
        products.flatMap((p) => [p.product_name, (p.short_name ?? "").trim()].filter(Boolean)),
      ),
    ]
    // Only reverse-lookup email product_codes for identities that lack a 备案号.
    // Tracking/FOF nightly rebuilds already carry beian for nearly every row; skipping
    // the name→code join there is what keeps investment_pool_metrics under the timeout.
    const namesNeedingCodeLookup = [
      ...new Set(
        products
          .filter((p) => !(p.beian_hao ?? "").trim())
          .flatMap((p) => [p.product_name, (p.short_name ?? "").trim()].filter(Boolean)),
      ),
    ]
    const emailCodes = await loadEmailProductCodesForNames(namesNeedingCodeLookup)
    const beians = expandBeiansWithParentCodes([
      ...products.map((p) => (p.beian_hao ?? "").trim()).filter(Boolean),
      ...emailCodes,
    ])

    const hints = await loadLatestNavDateHints(beians, names)
    const defaultSince = addDays(asOfDate, NAV_HISTORY_LOOKBACK_DAYS)
    const { staleBeians, staleNames, staleSince } = collectStaleNavKeys(products, hints, defaultSince)

    const beianByName = new Map<string, string>()
    for (const product of products) {
      const beian = (product.beian_hao ?? "").trim()
      if (!beian) continue
      beianByName.set(product.product_name, beian)
      const short = (product.short_name ?? "").trim()
      if (short) beianByName.set(short, beian)
    }

    const seedByBeian = new Map<string, NavPoint[]>()
    const seedLatestByBeian = new Map<string, string>()
    for (const product of products) {
      const override = lookupManagedProductOverride(product.product_name)
        ?? (product.beian_hao ? lookupManagedProductOverride(product.beian_hao) : null)
      if (!override) continue
      if (seedByBeian.has(override.beian_hao)) continue
      const seedRows = loadManagedProductNavSeed(override.beian_hao)
      if (seedRows.length === 0) continue
      const points = seedRows
        .map((row) => {
          const nav = parseNav(row.nav)
          if (nav == null) return null
          return { nav, nav_date: row.price_date.slice(0, 10) }
        })
        .filter((p): p is NavPoint => p != null)
        .sort((a, b) => b.nav_date.localeCompare(a.nav_date))
      seedByBeian.set(override.beian_hao, points)
      seedLatestByBeian.set(override.beian_hao, seedRows[seedRows.length - 1].price_date.slice(0, 10))
    }

    const [emailByBeian, emailByName, type6, legacy] = await Promise.all([
      loadEmailNavBatch(beians, defaultSince),
      loadEmailNavByNameBatch(names, defaultSince, beianByName),
      loadType6NavBatch(beians, names, defaultSince),
      loadLegacyNavBatch(beians, names, defaultSince),
    ])

    if (staleSince && (staleBeians.length > 0 || staleNames.length > 0)) {
      const [staleEmail, staleEmailName, staleType6, staleLegacy] = await Promise.all([
        loadEmailNavBatch(staleBeians, staleSince),
        loadEmailNavByNameBatch(staleNames, staleSince, beianByName),
        loadType6NavBatch(staleBeians, staleNames, staleSince),
        loadLegacyNavBatch(staleBeians, staleNames, staleSince),
      ])
      mergeNavPointMaps(emailByBeian, staleEmail)
      mergeNavPointMaps(emailByName, staleEmailName)
      mergeNavPointMaps(type6.byBeian, staleType6.byBeian)
      mergeNavPointMaps(type6.byProduct, staleType6.byProduct)
      mergeNavPointMaps(legacy.byBeian, staleLegacy.byBeian)
      mergeNavPointMaps(legacy.byProduct, staleLegacy.byProduct)
      // Re-apply after merge so sibling dates from either window fill the parent.
      backfillParentEmailFromShareClassSiblings(emailByBeian, beians)
    }

    return new BatchNavResolver(
      emailByBeian,
      emailByName,
      type6.byBeian,
      type6.byProduct,
      legacy.byBeian,
      legacy.byProduct,
      seedByBeian,
      seedLatestByBeian,
    )
  }

  /** Inject historical FOF holding NAV points (from ops_managed_fof_underlying). */
  setValuationNavHistory(
    byCode: Map<string, NavPoint[]>,
    byName: Map<string, NavPoint[]>,
  ): void {
    this.valuationNavByCode = byCode
    this.valuationNavByName = byName
  }

  /** Merge 估值表 history points across all plausible code / name keys for an underlying. */
  private collectValuationPoints(identity: ProductNavIdentity): NavPoint[] {
    const keys = fofUnderlyingNavLookupKeys(
      identity.product_name,
      identity.beian_hao,
      identity.short_name,
    )
    const byDate = new Map<string, NavPoint>()
    for (const key of keys) {
      const codeKey = key.toUpperCase()
      for (const p of this.valuationNavByCode.get(codeKey) ?? []) {
        if (isPlausibleEmailUnitNav(p.nav)) byDate.set(p.nav_date, p)
      }
      for (const p of this.valuationNavByName.get(key) ?? []) {
        if (isPlausibleEmailUnitNav(p.nav)) byDate.set(p.nav_date, p)
      }
    }
    return [...byDate.values()].sort((a, b) => b.nav_date.localeCompare(a.nav_date))
  }

  private valuationAt(identity: ProductNavIdentity, beforeDate: string): NavPoint | null {
    return navAtOrBefore(this.collectValuationPoints(identity), beforeDate)
  }

  private legacyPointOnDate(identity: ProductNavIdentity, navDate: string): NavPoint | null {
    const beian = (identity.beian_hao ?? "").trim()
    const short = (identity.short_name ?? "").trim()
    const layers = [
      beian ? this.legacyByBeian.get(beian) : undefined,
      this.legacyByProduct.get(identity.product_name),
      short ? this.legacyByProduct.get(short) : undefined,
    ]
    for (const points of layers) {
      const hit = points?.find((p) => p.nav_date === navDate)
      if (hit?.return_nav != null && hit.return_nav !== hit.nav) return hit
    }
    return null
  }

  private withLegacyReturnNav(identity: ProductNavIdentity, point: NavPoint): NavPoint {
    if (point.return_nav != null && point.return_nav !== point.nav) return point
    const legacy = this.legacyPointOnDate(identity, point.nav_date)
    if (legacy?.return_nav != null) return { ...point, return_nav: legacy.return_nav }
    return point
  }

  private seedPointFor(identity: ProductNavIdentity, beforeDate: string): NavPoint | null {
    const beian = (identity.beian_hao ?? "").trim()
    const override =
      lookupManagedProductOverride(identity.product_name)
      ?? (beian ? lookupManagedProductOverride(beian) : null)
    if (!override) return null
    const seedLatest = this.seedLatestByBeian.get(override.beian_hao)
    const seedPoint = navAtOrBefore(this.seedByBeian.get(override.beian_hao), beforeDate)
    if (!seedPoint || !seedLatest || seedPoint.nav_date > seedLatest) return null
    return seedPoint
  }

  resolveAt(
    identity: ProductNavIdentity,
    beforeDate: string,
    fallbackNav: number | null = null,
    fallbackDate: string | null = null,
  ): NavPoint | null {
    const beian = (identity.beian_hao ?? "").trim()
    const short = (identity.short_name ?? "").trim()

    const seedPoint = this.seedPointFor(identity, beforeDate)
    const seedLatest = (() => {
      const override =
        lookupManagedProductOverride(identity.product_name)
        ?? (beian ? lookupManagedProductOverride(beian) : null)
      return override ? this.seedLatestByBeian.get(override.beian_hao) : undefined
    })()

    const emailName =
      resolveEmailNavAt(this.emailByName.get(identity.product_name), beforeDate) ??
      (short ? resolveEmailNavAt(this.emailByName.get(short), beforeDate) : null)
    const emailBeianDirect = beian ? resolveEmailNavAt(this.emailByBeian.get(beian), beforeDate) : null
    const parentBeian = beian.replace(/[ABC]$/u, "")
    const emailBeianParent =
      beian && parentBeian !== beian
        ? resolveEmailNavAt(this.emailByBeian.get(parentBeian), beforeDate)
        : null
    const emailBeian = emailBeianDirect ?? emailBeianParent
    const shareClassBeian = /[ABC]$/i.test(beian)
    let emailPoint = shareClassBeian ? (emailBeianDirect ?? emailName ?? emailBeianParent) : (emailName ?? emailBeian)
    if (
      emailName
      && emailBeian
      && !isPlausibleEmailUnitNav(emailName.nav)
      && isPlausibleEmailUnitNav(emailBeian.nav)
    ) {
      emailPoint = emailBeian
    } else if (
      emailName
      && emailBeian
      && !isPlausibleEmailUnitNav(emailBeian.nav)
      && isPlausibleEmailUnitNav(emailName.nav)
    ) {
      emailPoint = emailName
    } else if (
      !shareClassBeian
      && emailName
      && emailBeian
      && isPlausibleEmailUnitNav(emailName.nav)
      && isPlausibleEmailUnitNav(emailBeian.nav)
      && emailBeian.nav_date > emailName.nav_date
    ) {
      // Parent name stream can lag while share-class backfill advances beian (SBHK26).
      emailPoint = emailBeian
    }
    if (emailPoint && !isPlausibleEmailUnitNav(emailPoint.nav)) {
      emailPoint = null
    }

    if (seedPoint && seedLatest && beforeDate <= seedLatest) {
      return seedPoint
    }

    const type6 =
      (beian ? navAtOrBefore(this.type6ByBeian.get(beian), beforeDate) : null) ??
      navAtOrBefore(this.type6ByProduct.get(identity.product_name), beforeDate) ??
      (short ? navAtOrBefore(this.type6ByProduct.get(short), beforeDate) : null)

    const legacy =
      (beian ? navAtOrBefore(this.legacyByBeian.get(beian), beforeDate) : null) ??
      navAtOrBefore(this.legacyByProduct.get(identity.product_name), beforeDate) ??
      (short ? navAtOrBefore(this.legacyByProduct.get(short), beforeDate) : null)

    const valuation = this.valuationAt(identity, beforeDate)

    // Newest plausible date wins across email / type6 / legacy / 估值表.
    // Same-date tie-break: email > type6 > legacy > valuation (email has better unit/cum).
    // Fresher FOF 估值表 holdings (e.g. 百奕小天鹅 7/23) therefore beat older email (7/22).
    const ranked: Array<{ point: NavPoint; rank: number }> = []
    if (emailPoint) {
      ranked.push({ point: this.withLegacyReturnNav(identity, emailPoint), rank: 4 })
    }
    if (type6) {
      ranked.push({ point: this.withLegacyReturnNav(identity, type6), rank: 3 })
    }
    if (legacy) ranked.push({ point: legacy, rank: 2 })
    if (valuation) ranked.push({ point: valuation, rank: 1 })

    const candidates = ranked.filter((c) => isPlausibleEmailUnitNav(c.point.nav))
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const byDate = b.point.nav_date.localeCompare(a.point.nav_date)
        return byDate !== 0 ? byDate : b.rank - a.rank
      })
      return candidates[0].point
    }

    if (fallbackNav != null && fallbackDate && fallbackDate <= beforeDate && isChinaTradingDay(fallbackDate)) {
      return { nav: fallbackNav, nav_date: fallbackDate }
    }
    return null
  }

  /** Return vs the immediately previous NAV point (same semantics as email-nav en_prev). */
  resolvePreviousNav(identity: ProductNavIdentity, navDate: string): NavPoint | null {
    const history = this.mergedHistory(identity, addDays(navDate, NAV_HISTORY_LOOKBACK_DAYS))
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].nav_date < navDate) return history[i]
    }
    return null
  }

  calcDailyReturnPct(
    identity: ProductNavIdentity,
    unitNav: number,
    navDate: string,
    fallbackReturnPct: number | null,
  ): number | null {
    const since = addDays(navDate, NAV_HISTORY_LOOKBACK_DAYS)
    // Prefer email/type6/legacy (no 估值表 gap fills) when the tip itself is on that
    // series — BSJ74B: skip Jul-23/24 市价 between email dates (+4.61% vs +1.27%).
    const detailHist = this.mergedHistoryForDetailDailyReturn(identity, since)
    const tipOnDetailSeries = detailHist.some((p) => p.nav_date === navDate)
    if (!tipOnDetailSeries) {
      // Valuation-led tip ahead of email/legacy (VN917B: list NAV 2026-07-30 / 1.6350
      // while parent 【净值表】 email still tips 2026-06-12 / 1.7792). Using detail-daily
      // history alone treats that multi-week gap as one day → −8.10%. Fall back to
      // display history (includes FOF 估值表 holdings) so prev is the prior trading day.
      return calcDailyReturnPctFromHistory(
        this.mergedHistory(identity, since),
        unitNav,
        navDate,
        fallbackReturnPct,
      )
    }
    return calcDailyReturnPctFromHistory(
      detailHist,
      unitNav,
      navDate,
      fallbackReturnPct,
    )
  }

  calcPeriodReturns(
    identity: ProductNavIdentity,
    unitNav: number,
    navDate: string,
  ): Record<(typeof RETURN_OFFSETS)[number]["key"], number | null> {
    const historyAsc = enrichReturnNavSeries(
      this.mergedHistoryForRiskMetrics(identity, addDays(navDate, NAV_HISTORY_LOOKBACK_DAYS)),
    )
    const latestPoint =
      historyAsc.filter((p) => p.nav_date <= navDate).at(-1)
      ?? this.resolveAt(identity, navDate)
    return calcPeriodReturnsFromHistory(historyAsc, unitNav, navDate, latestPoint)
  }

  /**
   * Period base at the lookback date, or the nearest prior same-share-class point when the
   * exact window is empty (e.g. SBDW42 B-class email starts 2026-07-06, gap before May legacy).
   */
  resolvePeriodBase(
    identity: ProductNavIdentity,
    navDate: string,
    periodDays: number,
    latestReturnNav: number,
  ): NavPoint | null {
    const targetDate = addDays(navDate, periodDays)
    const primary = this.resolveAt(identity, targetDate)
    if (primary && !isStalePeriodBase(navDate, primary.nav_date, periodDays)) {
      const baseNav = navForReturn(primary)
      if (baseNav != null && isSameShareClassNavLevel(latestReturnNav, baseNav, periodDays)) {
        return primary
      }
    }

    const sinceDate = addDays(navDate, periodDays * 2)
    const history = this.mergedHistory(identity, sinceDate)
      .filter((p) => p.nav_date < navDate)
      .sort((a, b) => b.nav_date.localeCompare(a.nav_date))

    const sameClass = history.filter((p) => {
      const baseNav = navForReturn(p)
      return baseNav != null && isSameShareClassNavLevel(latestReturnNav, baseNav, periodDays)
    })
    if (sameClass.length === 0) return null

    const targetMs = new Date(`${targetDate}T00:00:00Z`).getTime()
    let best: NavPoint | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const p of sameClass) {
      const gap = calendarDaysBetween(navDate, p.nav_date)
      if (gap > periodDays * 2) continue
      if (isStalePeriodBase(navDate, p.nav_date, periodDays)) continue
      const dist = Math.abs(new Date(`${p.nav_date}T00:00:00Z`).getTime() - targetMs)
      const score = dist + Math.max(0, periodDays - gap) * 86_400_000 * 0.001
      if (score < bestScore) {
        bestScore = score
        best = p
      }
    }
    return best
  }

  mergedHistory(identity: ProductNavIdentity, sinceDate: string): NavPoint[] {
    return this.buildMergedHistory(identity, sinceDate, "display")
  }

  /**
   * Same sources as detail 平台数据 (email/type6/legacy/seed) — no 估值表 gap fills.
   * Used for 最新涨跌幅 so list matches detail (BSJ74B: skip Jul-23/24 市价 between email dates).
   */
  mergedHistoryForDetailDailyReturn(identity: ProductNavIdentity, sinceDate: string): NavPoint[] {
    return this.buildMergedHistory(identity, sinceDate, "detail-daily")
  }

  /** Risk metrics: type6/legacy override email on same dates so drawdowns are preserved. */
  mergedHistoryForRiskMetrics(identity: ProductNavIdentity, sinceDate: string): NavPoint[] {
    return this.buildMergedHistory(identity, sinceDate, "risk")
  }

  private buildMergedHistory(
    identity: ProductNavIdentity,
    sinceDate: string,
    mode: "display" | "risk" | "detail-daily",
  ): NavPoint[] {
    const beian = (identity.beian_hao ?? "").trim()
    const short = (identity.short_name ?? "").trim()
    const byDate = new Map<string, NavPoint>()

    const override =
      lookupManagedProductOverride(identity.product_name)
      ?? (beian ? lookupManagedProductOverride(beian) : null)
    const seedLatest = override ? this.seedLatestByBeian.get(override.beian_hao) : undefined

    const apply = (points: NavPoint[] | undefined, opts?: { email?: boolean }) => {
      for (const p of points ?? []) {
        if (p.nav_date < sinceDate) continue
        if (!isChinaTradingDay(p.nav_date)) continue
        if (!isPlausibleEmailUnitNav(p.nav)) continue
        if (opts?.email && seedLatest && p.nav_date <= seedLatest) continue
        const prev = byDate.get(p.nav_date)
        // Risk-mode legacy/估值表 may replace email unit on the same date; keep email
        // 复权 (return_nav) so period / daily returns stay on the detail scale.
        if (
          prev
          && prev.return_nav != null
          && prev.return_nav !== prev.nav
          && (p.return_nav == null || p.return_nav === p.nav)
        ) {
          byDate.set(p.nav_date, { ...p, return_nav: prev.return_nav })
        } else {
          byDate.set(p.nav_date, p)
        }
      }
    }

    const legacyLayers = (includeValuation: boolean) => {
      apply(this.legacyByBeian.get(beian))
      apply(this.legacyByProduct.get(identity.product_name))
      if (short) apply(this.legacyByProduct.get(short))
      if (includeValuation) apply(this.collectValuationPoints(identity))
    }
    const type6Layers = () => {
      apply(this.type6ByBeian.get(beian))
      apply(this.type6ByProduct.get(identity.product_name))
      if (short) apply(this.type6ByProduct.get(short))
    }
    const emailLayers = () => {
      apply(this.emailByBeian.get(beian), { email: true })
      if (beian) {
        const parentBeian = beian.replace(/[ABC]$/u, "")
        if (parentBeian !== beian) apply(this.emailByBeian.get(parentBeian), { email: true })
      }
      apply(this.emailByName.get(identity.product_name), { email: true })
      if (short) apply(this.emailByName.get(short), { email: true })
    }
    const seedLayer = () => {
      if (override) apply(this.seedByBeian.get(override.beian_hao))
    }

    if (mode === "display") {
      legacyLayers(true)
      type6Layers()
      emailLayers()
      seedLayer()
    } else if (mode === "detail-daily") {
      // Match detail 平台数据: no 估值表-only dates between email NAVs.
      legacyLayers(false)
      type6Layers()
      emailLayers()
      seedLayer()
    } else {
      emailLayers()
      legacyLayers(true)
      type6Layers()
      seedLayer()
    }

    const merged = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p)
    return applyNavPointSeriesStartTrim(merged, {
      beian_hao: beian || null,
      product_name: identity.product_name,
      short_name: short || null,
    })
  }
}

/** Period returns from a pre-built ascending NAV history (team/seed series for 在管产品). */
export function calcPeriodReturnsFromHistory(
  historyAsc: NavPoint[],
  unitNav: number,
  navDate: string,
  latestPoint?: NavPoint | null,
): Record<(typeof RETURN_OFFSETS)[number]["key"], number | null> {
  const latest =
    latestPoint
    ?? historyAsc.filter((p) => p.nav_date <= navDate).at(-1)
    ?? null
  const latestReturnNav = navForReturn(latest, unitNav)
  const out = {} as Record<(typeof RETURN_OFFSETS)[number]["key"], number | null>
  if (latestReturnNav == null) {
    for (const { key } of RETURN_OFFSETS) out[key] = null
    return out
  }
  for (const { key, days } of RETURN_OFFSETS) {
    const base = resolvePeriodBaseFromHistory(
      historyAsc,
      navDate,
      days,
      latestReturnNav,
    )
    let ret = calcReturn(latestReturnNav, navForReturn(base))
    ret = capPeriodReturnByDrawdown(ret, historyAsc, navDate, days)
    out[key] = ret
  }
  return out
}

export type OpsStrategyRow = {
  register_number: string
  company_strategy_l1: string | null
  platform_strategy_l1: string | null
  team_tags: unknown
}

export async function loadOpsStrategyAndTags(
  beianHaos: string[],
): Promise<Map<string, OpsStrategyRow>> {
  const codes = beianHaos.map((b) => b.trim()).filter(Boolean)
  const out = new Map<string, OpsStrategyRow>()
  if (codes.length === 0) return out

  const rows = await query<OpsStrategyRow>(
    `SELECT DISTINCT ON (register_number)
       register_number,
       NULLIF(BTRIM(company_strategy_one), '')  AS company_strategy_l1,
       NULLIF(BTRIM(platform_strategy_one), '') AS platform_strategy_l1,
       CASE WHEN jsonb_typeof(tag->'company') = 'array'
            THEN tag->'company' ELSE '[]'::jsonb END AS team_tags
     FROM type6_ops_team_full
     WHERE register_number = ANY($1::text[])
     ORDER BY register_number, updated_at DESC NULLS LAST, id DESC`,
    [codes],
  )
  for (const r of rows) out.set(r.register_number, r)
  return out
}

export async function loadBflStrategies(beianHaos: string[]): Promise<Map<string, string>> {
  const codes = beianHaos.map((b) => b.trim()).filter(Boolean)
  const out = new Map<string, string>()
  if (codes.length === 0) return out

  const rows = await query<{ beian_hao: string; strategy: string | null }>(
    `SELECT beian_hao,
       NULLIF(BTRIM(split_part(COALESCE(strategy_company, ''), ',', 1)), '') AS strategy
     FROM private_fund_info_bfl
     WHERE beian_hao = ANY($1::text[])`,
    [codes],
  )
  for (const r of rows) {
    if (r.strategy) out.set(r.beian_hao, r.strategy)
  }
  return out
}

export async function loadPrivateFundRiskMetrics(
  beianHaos: string[],
): Promise<Map<string, { sharpe_1y: number | null; calmar_1y: number | null }>> {
  const out = new Map<string, { sharpe_1y: number | null; calmar_1y: number | null }>()
  const codes = beianHaos.map((b) => b.trim()).filter(Boolean)
  if (codes.length === 0) return out

  const rows = await query<{ beian_hao: string; sharpe_1y: string | null; calmar_1y: string | null }>(
    `SELECT beian_hao, sharpe_1y::text, calmar_1y::text
     FROM private_fund_info
     WHERE beian_hao = ANY($1::text[])`,
    [codes],
  )
  for (const row of rows) {
    const sharpe = row.sharpe_1y != null ? parseFloat(row.sharpe_1y) : null
    const calmar = row.calmar_1y != null ? parseFloat(row.calmar_1y) : null
    out.set(row.beian_hao, {
      sharpe_1y: isPlausibleRiskRatio(sharpe) ? sharpe : null,
      calmar_1y: isPlausibleRiskRatio(calmar) ? calmar : null,
    })
  }
  return out
}

export type TrackFundMetricsFields = {
  beian_hao: string
  product_name: string
  short_name: string | null
  latest_nav: string | null
  latest_nav_date: string | null
  latest_price_change: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
}

/** List cache more than this many calendar days behind as-of → recompute on read. */
const STALE_LIST_NAV_DAYS = 10

export type EnrichNavMode = "full" | "corrupt-only"

function needsNavMetricsRecompute(
  row: TrackFundMetricsFields,
  asOfDate: string,
  mode: EnrichNavMode = "full",
): boolean {
  if (!row.latest_nav) return true
  const rule = lookupFundNavCorrectionRule(row.beian_hao, row.product_name, row.short_name)
  if (rule?.preserve_high_nav_scale) return false
  const nav = parseFloat(row.latest_nav)
  if (!Number.isFinite(nav)) return true
  const change = parseFloat(row.latest_price_change ?? "")
  if (Number.isFinite(change) && Math.abs(change) > 100) return true

  // next-server list path: trust nightly cache. Recomputing "stale" / high-NAV /
  // volatile-week rows here pegs CPU (thousands of private funds report monthly).
  if (mode === "corrupt-only") return false

  if (nav > 2.5) return true
  // Contaminated period base (e.g. SAVW72 近一周 −11.89% with daily ~0.1%).
  const ret1w = parseFloat(row.ret_1w ?? "")
  if (Number.isFinite(ret1w) && Math.abs(ret1w) > 0.08) return true
  if (
    Number.isFinite(ret1w)
    && Math.abs(ret1w) > 0.06
    && Number.isFinite(change)
    && Math.abs(change) < 0.02
  ) {
    return true
  }
  // Stale list NAV while detail/platform already moved on (SBHK26 stuck at 2026-06-30).
  const navDate = row.latest_nav_date?.slice(0, 10)
  if (navDate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    if (calendarDaysBetween(asOfDate, navDate) > STALE_LIST_NAV_DAYS) return true
  }
  return false
}

/** Fill NAV / return metrics for list rows whose cache entry is empty or corrupt. */
export async function enrichTrackFundMetricsRows<T extends TrackFundMetricsFields>(
  rows: T[],
  asOfDate: string,
  mode: EnrichNavMode = process.env.RUN_BACKGROUND_JOBS === "0" ? "corrupt-only" : "full",
): Promise<T[]> {
  const needs = rows.filter((row) => needsNavMetricsRecompute(row, asOfDate, mode))
  if (needs.length === 0) return rows

  const identities = needs.map((row) => ({
    beian_hao: row.beian_hao,
    product_name: row.product_name,
    short_name: row.short_name,
  }))
  const resolver = await BatchNavResolver.create(identities, asOfDate)
  const patches = new Map<string, Partial<T>>()

  for (const row of needs) {
    const identity = {
      beian_hao: row.beian_hao,
      product_name: row.product_name,
      short_name: row.short_name,
    }
    const latest = resolver.resolveAt(identity, asOfDate)
    if (!latest) continue

    const returnPct = resolver.calcDailyReturnPct(identity, latest.nav, latest.nav_date, null)
    const returns = resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date)
    const risk = computeOneYearRiskMetrics(
      latest.nav_date,
      resolver.mergedHistoryForRiskMetrics(
        identity,
        addDays(latest.nav_date, NAV_HISTORY_LOOKBACK_DAYS),
      ),
    )

    patches.set(row.beian_hao, {
      latest_nav: String(latest.nav),
      latest_nav_date: latest.nav_date,
      latest_price_change: returnPct != null ? String(returnPct) : null,
      ret_1w: returns.ret_1w != null ? String(returns.ret_1w) : null,
      ret_1m: returns.ret_1m != null ? String(returns.ret_1m) : null,
      ret_3m: returns.ret_3m != null ? String(returns.ret_3m) : null,
      ret_6m: returns.ret_6m != null ? String(returns.ret_6m) : null,
      ret_1y: returns.ret_1y != null ? String(returns.ret_1y) : null,
      sharpe_1y: risk.sharpe_1y != null ? String(risk.sharpe_1y) : null,
      calmar_1y: risk.calmar_1y != null ? String(risk.calmar_1y) : null,
    } as Partial<T>)
  }

  return rows.map((row) => {
    const patch = patches.get(row.beian_hao)
    return patch ? { ...row, ...patch } : row
  })
}

/**
 * Always overwrite 最新涨跌幅 from the detail-aligned series (no 估值表 gap fills).
 * Used by FOF list APIs so a stale cache worker cannot keep serving BSJ74B +4.61%.
 */
export async function patchLatestDailyReturnFromDetailSeries<T extends TrackFundMetricsFields>(
  rows: T[],
  asOfDate: string,
): Promise<T[]> {
  if (rows.length === 0) return rows
  const identities = rows.map((row) => ({
    beian_hao: row.beian_hao,
    product_name: row.product_name,
    short_name: row.short_name,
  }))
  const resolver = await BatchNavResolver.create(identities, asOfDate)
  return rows.map((row) => {
    const identity = {
      beian_hao: row.beian_hao,
      product_name: row.product_name,
      short_name: row.short_name,
    }
    const latest = resolver.resolveAt(identity, asOfDate)
    if (!latest) return row
    const returnPct = resolver.calcDailyReturnPct(identity, latest.nav, latest.nav_date, null)
    return {
      ...row,
      latest_nav: String(latest.nav),
      latest_nav_date: latest.nav_date,
      latest_price_change: returnPct != null ? String(returnPct) : row.latest_price_change,
    }
  })
}

/** Prefer team/email+manual NAV for tracking lists (最新净值日期 / 单位净值). */
export async function overlayTeamNavOnTrackRows<T extends TrackFundMetricsFields>(
  rows: T[],
  asOfDate: string,
): Promise<T[]> {
  if (rows.length === 0) return rows

  try {
    const { loadManagedProductTeamNavBatch } = await import("@/lib/server/team-nav-manage-pg")
    const { resolveTeamSeriesListNavAt } = await import("@/lib/server/managed-product-nav-seed")

    const teamBatch = await loadManagedProductTeamNavBatch(
      rows.map((row) => ({
        beian_hao: row.beian_hao,
        product_name: row.product_name,
        short_name: row.short_name,
      })),
    )
    // Case-insensitive lookup — upload keys may differ in casing from list rows.
    const byBeian = new Map<string, Array<{ nav_date: string; unit_nav: string }>>()
    for (const [code, series] of teamBatch) {
      byBeian.set(code.trim().toUpperCase(), series)
    }

    return rows.map((row) => {
      const series = byBeian.get((row.beian_hao ?? "").trim().toUpperCase())
      if (!series?.length) return row
      const point = resolveTeamSeriesListNavAt(series, asOfDate)
      if (!point) return row

      // Only advance (or fill) — never regress a newer platform/cache tip.
      const existingDate = row.latest_nav_date?.slice(0, 10) ?? ""
      if (existingDate && existingDate > point.nav_date) return row

      const unitNav = parseFloat(point.nav)
      let returnPct: number | null = null
      if (point.prev_nav != null) {
        const prev = parseFloat(point.prev_nav)
        if (Number.isFinite(unitNav) && Number.isFinite(prev) && prev !== 0) {
          returnPct = unitNav / prev - 1
        }
      }

      return {
        ...row,
        latest_nav: point.nav,
        latest_nav_date: point.nav_date,
        latest_price_change:
          returnPct != null ? String(returnPct) : row.latest_price_change,
      }
    })
  } catch (err) {
    console.warn("[overlayTeamNavOnTrackRows] skipped:", err)
    return rows
  }
}

/** Chunked INSERT to stay within Postgres parameter limits. */
export async function chunkedInsert(
  sqlPrefix: string,
  sqlSuffix: string,
  rowPlaceholders: string[],
  values: unknown[],
  colsPerRow: number,
  chunkSize = 80,
): Promise<void> {
  function renumberPlaceholder(rowTpl: string, offset: number): string {
    let i = 0
    return rowTpl.replace(/\$\d+/g, () => `$${offset + i++}`)
  }

  for (let i = 0; i < rowPlaceholders.length; i += chunkSize) {
    const chunkPh = rowPlaceholders
      .slice(i, i + chunkSize)
      .map((ph, j) => renumberPlaceholder(ph, j * colsPerRow + 1))
    const chunkVals = values.slice(i * colsPerRow, (i + chunkPh.length) * colsPerRow)
    await query(`${sqlPrefix} ${chunkPh.join(", ")} ${sqlSuffix}`, chunkVals)
  }
}
