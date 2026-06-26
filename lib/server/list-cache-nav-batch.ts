/**
 * Batch NAV resolution for nightly list-cache ETL.
 * Preloads email + legacy NAV once, then resolves in memory (no per-row DB round-trips).
 */

import { query } from "@/lib/db"
import { computeFundNavMetrics } from "@/lib/fund-nav-metrics"
import {
  collectFundNameAliases,
  emailNavSourceTier,
  emailRowMatchesFund,
  inferEmailUnitNav,
  isPostInvestmentVirtualNavEmail,
} from "@/lib/server/email-nav-query"
import { lookupManagedProductOverride } from "@/lib/server/managed-product-beian"
import { loadManagedProductNavSeed } from "@/lib/server/managed-product-nav-seed"
import {
  sqlEmailNavShareClassGuard,
  sqlFundNameMatch,
} from "@/lib/server/fund-name-match"

export type NavPoint = {
  nav: number
  nav_date: string
  source?: string | null
  subject?: string | null
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

export function fmtDate(d: string | Date | null): string | null {
  if (!d) return null
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return String(d).slice(0, 10)
}

export function addDays(isoDate: string, days: number): string {
  const dt = new Date(isoDate)
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
    if (!prev || emailNavSourceTier(row.source, row.subject) < emailNavSourceTier(prev.source, prev.subject)) {
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
    if (!prev || emailNavSourceTier(row.source, row.subject) < emailNavSourceTier(prev.source, prev.subject)) {
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

type LegacyRow = {
  beian_hao: string | null
  product_name: string | null
  price_date: string
  nav: string
  pri: number
}

async function loadLegacyNavBatch(
  beians: string[],
  names: string[],
  sinceDate: string,
): Promise<{ byBeian: Map<string, NavPoint[]>; byProduct: Map<string, NavPoint[]> }> {
  const byBeian = new Map<string, NavPoint[]>()
  const byProduct = new Map<string, NavPoint[]>()
  if (beians.length === 0 && names.length === 0) return { byBeian, byProduct }

  const rows = await query<LegacyRow>(
    `SELECT beian_hao, product_name, price_date::text AS price_date, nav::text AS nav, pri
     FROM (
       SELECT beian_hao, product_name, price_date, nav, 0 AS pri FROM private_fund_nav_group
       WHERE price_date >= $3::date
       UNION ALL
       SELECT beian_hao, product_name, price_date, nav, 1 AS pri FROM private_fund_nav_group_hy
       WHERE price_date >= $3::date
       UNION ALL
       SELECT beian_hao, product_name, price_date, nav, 2 AS pri FROM private_fund_nav
       WHERE price_date >= $3::date
     ) nav_union
     WHERE nav IS NOT NULL AND nav > 0
       AND (
         (beian_hao IS NOT NULL AND NULLIF(BTRIM(beian_hao), '') = ANY($1::text[]))
         OR product_name = ANY($2::text[])
       )
     ORDER BY price_date DESC, pri ASC`,
    [beians, names, sinceDate],
  )

  const beianBest = new Map<string, Map<string, { nav: number; pri: number }>>()
  const productBest = new Map<string, Map<string, { nav: number; pri: number }>>()

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
      const prev = dates.get(date)
      if (!prev || row.pri < prev.pri) dates.set(date, { nav, pri: row.pri })
    }

    const product = (row.product_name ?? "").trim()
    if (product) {
      let dates = productBest.get(product)
      if (!dates) {
        dates = new Map()
        productBest.set(product, dates)
      }
      const prev = dates.get(date)
      if (!prev || row.pri < prev.pri) dates.set(date, { nav, pri: row.pri })
    }
  }

  for (const [beian, dates] of beianBest) {
    const points = [...dates.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([nav_date, v]) => ({ nav_date, nav: v.nav }))
    byBeian.set(beian, points)
  }
  for (const [product, dates] of productBest) {
    const points = [...dates.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([nav_date, v]) => ({ nav_date, nav: v.nav }))
    byProduct.set(product, points)
  }

  return { byBeian, byProduct }
}

async function loadType6NavBatch(
  beians: string[],
  names: string[],
  sinceDate: string,
): Promise<{ byBeian: Map<string, NavPoint[]>; byProduct: Map<string, NavPoint[]> }> {
  const byBeian = new Map<string, NavPoint[]>()
  const byProduct = new Map<string, NavPoint[]>()
  if (beians.length === 0 && names.length === 0) return { byBeian, byProduct }

  const rows = await query<LegacyRow>(
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
    if (ts >= cutoffTs && ts <= refDate.getTime() && Number.isFinite(row.nav) && row.nav > 0) {
      dates.push(row.nav_date)
      values.push(row.nav)
    }
  }

  if (dates.length < 20) return { sharpe_1y: null, calmar_1y: null }

  const metrics = computeFundNavMetrics({ dates, values })
  if (!metrics) return { sharpe_1y: null, calmar_1y: null }

  return {
    sharpe_1y: Number.isFinite(metrics.sharpe) ? Math.round(metrics.sharpe * 10000) / 10000 : null,
    calmar_1y: Number.isFinite(metrics.calmar) ? Math.round(metrics.calmar * 10000) / 10000 : null,
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

  private constructor(
    emailByBeian: Map<string, NavPoint[]>,
    emailByName: Map<string, NavPoint[]>,
    type6ByBeian: Map<string, NavPoint[]>,
    type6ByProduct: Map<string, NavPoint[]>,
    legacyByBeian: Map<string, NavPoint[]>,
    legacyByProduct: Map<string, NavPoint[]>,
    seedByBeian: Map<string, NavPoint[]>,
    seedLatestByBeian: Map<string, string>,
  ) {
    this.emailByBeian = emailByBeian
    this.emailByName = emailByName
    this.type6ByBeian = type6ByBeian
    this.type6ByProduct = type6ByProduct
    this.legacyByBeian = legacyByBeian
    this.legacyByProduct = legacyByProduct
    this.seedByBeian = seedByBeian
    this.seedLatestByBeian = seedLatestByBeian
  }

  static async create(products: ProductNavIdentity[], asOfDate: string): Promise<BatchNavResolver> {
    const sinceDate = addDays(asOfDate, 400)
    const names = [
      ...new Set(
        products.flatMap((p) => [p.product_name, (p.short_name ?? "").trim()].filter(Boolean)),
      ),
    ]
    const emailCodes = await loadEmailProductCodesForNames(names)
    const beians = [
      ...new Set(
        [
          ...products.map((p) => (p.beian_hao ?? "").trim()).filter(Boolean),
          ...emailCodes,
        ],
      ),
    ]

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
      loadEmailNavBatch(beians, sinceDate),
      loadEmailNavByNameBatch(names, sinceDate),
      loadType6NavBatch(beians, names, sinceDate),
      loadLegacyNavBatch(beians, names, sinceDate),
    ])

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
    const emailBeian = beian ? resolveEmailNavAt(this.emailByBeian.get(beian), beforeDate) : null
    const emailPoint = emailName ?? emailBeian

    if (seedPoint && seedLatest && beforeDate <= seedLatest) {
      return seedPoint
    }
    if (emailPoint) return emailPoint

    const type6 =
      (beian ? navAtOrBefore(this.type6ByBeian.get(beian), beforeDate) : null) ??
      navAtOrBefore(this.type6ByProduct.get(identity.product_name), beforeDate) ??
      (short ? navAtOrBefore(this.type6ByProduct.get(short), beforeDate) : null)
    if (type6) return type6

    const legacy =
      (beian ? navAtOrBefore(this.legacyByBeian.get(beian), beforeDate) : null) ??
      navAtOrBefore(this.legacyByProduct.get(identity.product_name), beforeDate) ??
      (short ? navAtOrBefore(this.legacyByProduct.get(short), beforeDate) : null)
    if (legacy) return legacy

    if (fallbackNav != null && fallbackDate && fallbackDate <= beforeDate) {
      return { nav: fallbackNav, nav_date: fallbackDate }
    }
    return null
  }

  /** Return vs the immediately previous NAV point (same semantics as email-nav en_prev). */
  resolvePreviousNav(identity: ProductNavIdentity, navDate: string): NavPoint | null {
    const history = this.mergedHistory(identity, addDays(navDate, 400))
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].nav_date < navDate) return history[i]
    }
    return null
  }

  calcDailyReturnPct(
    identity: ProductNavIdentity,
    unitNav: number,
    navDate: string,
    _fallbackReturnPct: number | null,
  ): number | null {
    const prev = this.resolvePreviousNav(identity, navDate)
    return prev ? calcReturn(unitNav, prev.nav) : null
  }

  calcPeriodReturns(
    identity: ProductNavIdentity,
    unitNav: number,
    navDate: string,
  ): Record<(typeof RETURN_OFFSETS)[number]["key"], number | null> {
    const out = {} as Record<(typeof RETURN_OFFSETS)[number]["key"], number | null>
    for (const { key, days } of RETURN_OFFSETS) {
      const base = this.resolveAt(identity, addDays(navDate, days))
      out[key] = calcReturn(unitNav, base?.nav)
    }
    return out
  }

  mergedHistory(identity: ProductNavIdentity, sinceDate: string): NavPoint[] {
    const beian = (identity.beian_hao ?? "").trim()
    const short = (identity.short_name ?? "").trim()
    const byDate = new Map<string, NavPoint>()

    const override =
      lookupManagedProductOverride(identity.product_name)
      ?? (beian ? lookupManagedProductOverride(beian) : null)
    const seedLatest = override ? this.seedLatestByBeian.get(override.beian_hao) : undefined

    for (const p of this.legacyByBeian.get(beian) ?? []) {
      if (p.nav_date >= sinceDate) byDate.set(p.nav_date, p)
    }
    for (const p of this.legacyByProduct.get(identity.product_name) ?? []) {
      if (p.nav_date >= sinceDate) byDate.set(p.nav_date, p)
    }
    if (short) {
      for (const p of this.legacyByProduct.get(short) ?? []) {
        if (p.nav_date >= sinceDate) byDate.set(p.nav_date, p)
      }
    }
    for (const p of this.type6ByBeian.get(beian) ?? []) {
      if (p.nav_date >= sinceDate) byDate.set(p.nav_date, p)
    }
    for (const p of this.type6ByProduct.get(identity.product_name) ?? []) {
      if (p.nav_date >= sinceDate) byDate.set(p.nav_date, p)
    }
    if (short) {
      for (const p of this.type6ByProduct.get(short) ?? []) {
        if (p.nav_date >= sinceDate) byDate.set(p.nav_date, p)
      }
    }
    for (const p of this.emailByBeian.get(beian) ?? []) {
      if (p.nav_date >= sinceDate) {
        if (!seedLatest || p.nav_date > seedLatest) byDate.set(p.nav_date, p)
      }
    }
    for (const p of this.emailByName.get(identity.product_name) ?? []) {
      if (p.nav_date >= sinceDate) {
        if (!seedLatest || p.nav_date > seedLatest) byDate.set(p.nav_date, p)
      }
    }
    if (short) {
      for (const p of this.emailByName.get(short) ?? []) {
        if (p.nav_date >= sinceDate) {
          if (!seedLatest || p.nav_date > seedLatest) byDate.set(p.nav_date, p)
        }
      }
    }
    if (override) {
      for (const p of this.seedByBeian.get(override.beian_hao) ?? []) {
        if (p.nav_date >= sinceDate) byDate.set(p.nav_date, p)
      }
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
    out.set(row.beian_hao, {
      sharpe_1y: row.sharpe_1y != null ? parseFloat(row.sharpe_1y) : null,
      calmar_1y: row.calmar_1y != null ? parseFloat(row.calmar_1y) : null,
    })
  }
  return out
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
