/**
 * Batch NAV resolution for nightly list-cache ETL.
 * Preloads email + legacy NAV once, then resolves in memory (no per-row DB round-trips).
 */

import { query } from "@/lib/db"
import { computeFundNavMetrics, isPlausibleRiskRatio } from "@/lib/fund-nav-metrics"
import {
  collectFundNameAliases,
  dedupeLegacyNavRowsByDate,
  emailNavSourceTier,
  emailRowMatchesFund,
  inferEmailUnitNav,
  isPostInvestmentVirtualNavEmail,
  preferEmailNavRow,
  isPlausibleEmailUnitNav,
  type LegacyNavRow,
  type LegacyNavRowWithPri,
} from "@/lib/server/email-nav-query"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"
import { loadManagedProductNavSeed } from "@/lib/server/managed-product-nav-seed"
import {
  shareClassProductCodesMatch,
  sqlEmailNavShareClassGuard,
  sqlFundNameMatch,
} from "@/lib/server/fund-name-match"
import { fofUnderlyingNavLookupKeys } from "@/lib/server/fund-holding-code"

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

function dedupeLegacyBatchRows(rows: LegacyNavRowWithPri[]): NavPoint[] {
  const deduped = dedupeLegacyNavRowsByDate(rows)
  const points: NavPoint[] = []
  for (const row of deduped) {
    const p = legacyRowToNavPoint(row)
    if (p) points.push(p)
  }
  points.sort((a, b) => b.nav_date.localeCompare(a.nav_date))
  return points
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

function resolveEmailNavAt(points: NavPoint[] | undefined, beforeDate: string): NavPoint | null {
  if (!points?.length) return null
  const primary = points.filter(isPrimaryEmailNavPoint)
  const fromPrimary = navAtOrBefore(primary, beforeDate)
  if (fromPrimary) return fromPrimary
  return navAtOrBefore(points, beforeDate)
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
    if (p.nav_date <= beforeDate) return p
  }
  return null
}


function parseNav(v: string): number | null {
  const nav = parseFloat(v)
  return Number.isFinite(nav) && nav > 0 ? nav : null
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

  const rows = await query<{ code: string }>(
    `SELECT DISTINCT BTRIM(e.product_code) AS code
     FROM unnest($1::text[]) AS n(name)
     JOIN ops_email_nav_records e ON (
       NULLIF(BTRIM(e.product_code), '') IS NOT NULL
       AND ${sqlFundNameMatch("e.fund_name", "n.name")}
       AND ${sqlEmailNavShareClassGuard("e.fund_name", "n.name", "e.product_code")}
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

async function loadEmailNavBatch(beians: string[], sinceDate: string): Promise<Map<string, NavPoint[]>> {
  const out = new Map<string, NavPoint[]>()
  if (beians.length === 0) return out

  const rows = await query<EmailNavBatchRow>(
    `SELECT BTRIM(product_code) AS code, nav_date::text AS nav_date, nav::text AS nav,
            cumulative_nav::text, source,
            COALESCE(subject, '') AS subject, product_code, fund_name, attachment_filename
     FROM ops_email_nav_records
     WHERE BTRIM(product_code) = ANY($1::text[])
       AND nav IS NOT NULL
       AND nav_date >= $2::date
     ORDER BY nav_date DESC, id DESC`,
    [beians, sinceDate],
  )

  const virtualRatioByCode = latestVirtualUnitRatioByCode(rows)

  const bestByCodeDate = new Map<string, EmailNavBatchRow>()
  for (const row of rows) {
    const dedupe = `${row.code}\0${row.nav_date.slice(0, 10)}`
    const prev = bestByCodeDate.get(dedupe)
    if (!prev || preferEmailNavRow(prev, row, row.code) === row) {
      bestByCodeDate.set(dedupe, row)
    }
  }

  for (const row of bestByCodeDate.values()) {
    const rawNav = parseNav(row.nav)
    if (rawNav == null) continue
    const ratio = virtualRatioByCode.get(row.code) ?? null
    const cum = row.cumulative_nav != null ? parseFloat(row.cumulative_nav) : null
    const nav = inferEmailUnitNav(rawNav, cum, row.subject, ratio)
    const aliases = collectFundNameAliases(row.fund_name ?? "", null)
    if (!filterEmailBatchRow(row, row.code, aliases)) continue
    pushNavPoint(out, row.code, {
      nav,
      nav_date: row.nav_date.slice(0, 10),
      source: row.source,
      subject: row.subject,
    })
  }
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
): Promise<Map<string, NavPoint[]>> {
  const out = new Map<string, NavPoint[]>()
  const validNames = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  if (validNames.length === 0) return out

  const rows = await query<EmailNavBatchRow & { matched_name: string }>(
    `SELECT n.name AS matched_name, e.nav_date::text AS nav_date, e.nav::text AS nav,
            e.cumulative_nav::text, e.source,
            COALESCE(e.subject, '') AS subject, e.product_code, e.fund_name, e.attachment_filename,
            COALESCE(BTRIM(e.product_code), '') AS code
     FROM unnest($1::text[]) AS n(name)
     JOIN ops_email_nav_records e ON (
       e.nav IS NOT NULL
       AND e.nav_date >= $2::date
       AND (
         ${sqlFundNameMatch("e.fund_name", "n.name")}
         OR (
           BTRIM(COALESCE(e.product_code, '')) <> ''
           AND (
             COALESCE(e.subject, '') ILIKE '%' || BTRIM(e.product_code) || '%'
             OR COALESCE(e.attachment_filename, '') ILIKE '%' || BTRIM(e.product_code) || '%'
           )
           AND ${sqlFundNameMatch("e.subject", "n.name")}
         )
       )
       AND ${sqlEmailNavShareClassGuard("e.fund_name", "n.name", "e.product_code")}
     )
     ORDER BY e.nav_date DESC, e.id DESC`,
    [validNames, sinceDate],
  )

  const virtualRatioByName = latestVirtualUnitRatioByCode(
    rows.map((row) => ({ ...row, code: row.matched_name })),
  )

  const bestByNameDate = new Map<string, EmailNavBatchRow & { matched_name: string }>()
  for (const row of rows) {
    const dedupe = `${row.matched_name}\0${row.nav_date.slice(0, 10)}`
    const prev = bestByNameDate.get(dedupe)
    const override = lookupManagedProductOverride(row.matched_name)
    const beianForPick = (row.code ?? "").trim() || override?.beian_hao || ""
    if (!prev || preferEmailNavRow(prev, row, beianForPick) === row) {
      bestByNameDate.set(dedupe, row)
    }
  }

  for (const row of bestByNameDate.values()) {
    const rawNav = parseNav(row.nav)
    if (rawNav == null) continue
    const override = lookupManagedProductOverride(row.matched_name)
    const matchBeian = (row.code ?? "").trim() || override?.beian_hao || ""
    const aliases = collectFundNameAliases(row.matched_name, row.fund_name)
    if (matchBeian && !filterEmailBatchRow(row, matchBeian, aliases)) continue
    if (!matchBeian && !isPostInvestmentVirtualNavEmail(row.subject) && /虚拟/u.test(`${row.subject ?? ""}${row.fund_name ?? ""}`)) continue
    const ratio = virtualRatioByName.get(row.matched_name) ?? null
    const cum = row.cumulative_nav != null ? parseFloat(row.cumulative_nav) : null
    const nav = inferEmailUnitNav(rawNav, cum, row.subject, ratio)
    pushNavPoint(out, row.matched_name, {
      nav,
      nav_date: row.nav_date.slice(0, 10),
      source: row.source,
      subject: row.subject,
    })
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

  const rows = await query<LegacyBatchRow>(
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
    byBeian.set(beian, dedupeLegacyBatchRows(groupRows))
  }
  for (const [product, groupRows] of productGroups) {
    byProduct.set(product, dedupeLegacyBatchRows(groupRows))
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

  const rows = await query<Type6BatchRow>(
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
    const emailRows = await query<{ code: string; latest_date: string }>(
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
    const emailCodes = await loadEmailProductCodesForNames(names)
    const beians = expandBeiansWithParentCodes([
      ...products.map((p) => (p.beian_hao ?? "").trim()).filter(Boolean),
      ...emailCodes,
    ])

    const hints = await loadLatestNavDateHints(beians, names)
    const defaultSince = addDays(asOfDate, NAV_HISTORY_LOOKBACK_DAYS)
    const { staleBeians, staleNames, staleSince } = collectStaleNavKeys(products, hints, defaultSince)

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
      loadEmailNavByNameBatch(names, defaultSince),
      loadType6NavBatch(beians, names, defaultSince),
      loadLegacyNavBatch(beians, names, defaultSince),
    ])

    if (staleSince && (staleBeians.length > 0 || staleNames.length > 0)) {
      const [staleEmail, staleEmailName, staleType6, staleLegacy] = await Promise.all([
        loadEmailNavBatch(staleBeians, staleSince),
        loadEmailNavByNameBatch(staleNames, staleSince),
        loadType6NavBatch(staleBeians, staleNames, staleSince),
        loadLegacyNavBatch(staleBeians, staleNames, staleSince),
      ])
      mergeNavPointMaps(emailByBeian, staleEmail)
      mergeNavPointMaps(emailByName, staleEmailName)
      mergeNavPointMaps(type6.byBeian, staleType6.byBeian)
      mergeNavPointMaps(type6.byProduct, staleType6.byProduct)
      mergeNavPointMaps(legacy.byBeian, staleLegacy.byBeian)
      mergeNavPointMaps(legacy.byProduct, staleLegacy.byProduct)
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
    let emailPoint = emailName ?? emailBeian
    if (
      emailName
      && emailBeian
      && !isPlausibleEmailUnitNav(emailName.nav)
      && isPlausibleEmailUnitNav(emailBeian.nav)
    ) {
      emailPoint = emailBeian
    }

    if (seedPoint && seedLatest && beforeDate <= seedLatest) {
      return seedPoint
    }
    if (emailPoint) return this.withLegacyReturnNav(identity, emailPoint)

    const type6 =
      (beian ? navAtOrBefore(this.type6ByBeian.get(beian), beforeDate) : null) ??
      navAtOrBefore(this.type6ByProduct.get(identity.product_name), beforeDate) ??
      (short ? navAtOrBefore(this.type6ByProduct.get(short), beforeDate) : null)
    if (type6) return this.withLegacyReturnNav(identity, type6)

    const legacy =
      (beian ? navAtOrBefore(this.legacyByBeian.get(beian), beforeDate) : null) ??
      navAtOrBefore(this.legacyByProduct.get(identity.product_name), beforeDate) ??
      (short ? navAtOrBefore(this.legacyByProduct.get(short), beforeDate) : null)
    if (legacy) return legacy

    const valuation = this.valuationAt(identity, beforeDate)
    if (valuation) return valuation

    if (fallbackNav != null && fallbackDate && fallbackDate <= beforeDate) {
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
    const prev = this.resolvePreviousNav(identity, navDate)
    if (prev) return calcReturn(unitNav, prev.nav)
    return fallbackReturnPct ?? null
  }

  calcPeriodReturns(
    identity: ProductNavIdentity,
    unitNav: number,
    navDate: string,
  ): Record<(typeof RETURN_OFFSETS)[number]["key"], number | null> {
    const latestPoint = this.resolveAt(identity, navDate)
    const latestReturnNav = navForReturn(latestPoint, unitNav)
    const out = {} as Record<(typeof RETURN_OFFSETS)[number]["key"], number | null>
    for (const { key, days } of RETURN_OFFSETS) {
      const base = this.resolveAt(identity, addDays(navDate, days))
      out[key] = calcReturn(latestReturnNav, navForReturn(base))
    }
    return out
  }

  mergedHistory(identity: ProductNavIdentity, sinceDate: string): NavPoint[] {
    return this.buildMergedHistory(identity, sinceDate, "display")
  }

  /** Risk metrics: type6/legacy override email on same dates so drawdowns are preserved. */
  mergedHistoryForRiskMetrics(identity: ProductNavIdentity, sinceDate: string): NavPoint[] {
    return this.buildMergedHistory(identity, sinceDate, "risk")
  }

  private buildMergedHistory(
    identity: ProductNavIdentity,
    sinceDate: string,
    mode: "display" | "risk",
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
        if (!isPlausibleEmailUnitNav(p.nav)) continue
        if (opts?.email && seedLatest && p.nav_date <= seedLatest) continue
        byDate.set(p.nav_date, p)
      }
    }

    const legacyLayers = () => {
      apply(this.legacyByBeian.get(beian))
      apply(this.legacyByProduct.get(identity.product_name))
      if (short) apply(this.legacyByProduct.get(short))
      apply(this.collectValuationPoints(identity))
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
      legacyLayers()
      type6Layers()
      emailLayers()
      seedLayer()
    } else {
      emailLayers()
      legacyLayers()
      type6Layers()
      seedLayer()
    }

    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, p]) => p)
  }
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

/** Fill NAV / return metrics for list rows whose cache entry is empty (stale platform NAV). */
export async function enrichTrackFundMetricsRows<T extends TrackFundMetricsFields>(
  rows: T[],
  asOfDate: string,
): Promise<T[]> {
  const needs = rows.filter((row) => !row.latest_nav)
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
