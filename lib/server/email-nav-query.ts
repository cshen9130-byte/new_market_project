/**
 * Query helpers for ops_email_nav_records with priority over legacy NAV tables.
 */

import { query } from "@/lib/db"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import { sqlFundNameMatch } from "@/lib/server/fund-name-match"

export type EmailNavPoint = {
  price_date: string
  nav: string | null
  cumulative_nav: string | null
  adjusted_nav?: string | null
}

type EmailNavRawRow = {
  nav_date: string
  nav: string
  cumulative_nav: string | null
  adjusted_nav: string | null
  fund_name: string | null
  attachment_filename: string | null
  subject: string | null
  source: string | null
}


function sourceTier(source: string | null | undefined): number {
  const s = (source ?? "").trim()
  if (s === "attachment_nav_table") return 0
  if (s === "attachment_valuation_table") return 1
  return 2
}

function preferEmailNavRow(current: EmailNavRawRow, candidate: EmailNavRawRow, beian: string): EmailNavRawRow {
  const currentTier = sourceTier(current.source)
  const candidateTier = sourceTier(candidate.source)
  if (currentTier !== candidateTier) {
    return candidateTier < currentTier ? candidate : current
  }

  const rowHasBeian = beian && `${candidate.attachment_filename ?? ""}${candidate.subject ?? ""}`.toUpperCase().includes(beian)
  const prevHasBeian = beian && `${current.attachment_filename ?? ""}${current.subject ?? ""}`.toUpperCase().includes(beian)
  if (rowHasBeian && !prevHasBeian) return candidate
  return current
}

/** Collect every name variant we know for a fund (for email matching). */
export function collectFundNameAliases(
  productName: string,
  shortName: string | null,
  extraNames: Array<string | null | undefined> = [],
): string[] {
  const out = new Set<string>()
  for (const raw of [productName, shortName, ...extraNames]) {
    const name = (raw ?? "").trim()
    if (name) out.add(name)
  }
  return Array.from(out)
}

function isAClassFund(beianHao: string, aliases: string[]): boolean {
  if (/A$/i.test(beianHao)) return true
  return aliases.some((name) => /A类/u.test(name))
}

/** Extract product codes embedded in email metadata, e.g. 资产净值公告_SAVF39_… */
function extractEmbeddedProductCodes(...parts: Array<string | null | undefined>): string[] {
  const codes = new Set<string>()
  for (const part of parts) {
    const text = (part ?? "").trim()
    if (!text) continue
    for (const m of text.matchAll(/资产净值公告_([A-Z0-9]+)_/gi)) {
      if (m[1]) codes.add(m[1].toUpperCase())
    }
    for (const m of text.matchAll(/_([A-Z]{1,6}\d+[A-Z]?)_/g)) {
      if (m[1]) codes.add(m[1].toUpperCase())
    }
  }
  return Array.from(codes)
}

function nameMatchesAlias(fundName: string | null, aliases: string[]): boolean {
  const name = (fundName ?? "").trim()
  if (!name) return false
  return aliases.some((alias) => name === alias || name.startsWith(alias))
}

/** Reject email rows that belong to a different share class / product code. */
function emailRowMatchesFund(row: EmailNavRawRow, beianHao: string, aliases: string[]): boolean {
  const beian = beianHao.trim().toUpperCase()
  const embedded = extractEmbeddedProductCodes(row.fund_name, row.attachment_filename, row.subject)
  const meta = `${row.attachment_filename ?? ""} ${row.subject ?? ""} ${row.fund_name ?? ""}`

  if (beian && embedded.length > 0 && !embedded.includes(beian)) return false

  if (beian && meta.toUpperCase().includes(beian)) return true

  if (nameMatchesAlias(row.fund_name, aliases)) {
    return embedded.length === 0 || embedded.includes(beian)
  }

  return false
}

/** SQL guard: keep rows whose embedded product code matches the fund beian_hao. */
export function buildEmailNavCodeGuard(
  recordAlias: string,
  beianHaoExpr: string,
): string {
  const e = recordAlias
  return `(
    ${beianHaoExpr} IS NULL OR BTRIM(${beianHaoExpr}) = ''
    OR COALESCE(${e}.fund_name, '') !~ '资产净值公告_[A-Z0-9]+_'
    OR COALESCE(${e}.fund_name, '') ILIKE '%资产净值公告\_' || BTRIM(${beianHaoExpr}) || '\_%'
  )`
}

/** Pick a single email source stream (one fund_name) instead of mixing per date. */
function selectEmailSourceStream(
  rows: EmailNavRawRow[],
  beianHao: string,
  aliases: string[],
): EmailNavRawRow[] {
  const filtered = rows.filter((row) => emailRowMatchesFund(row, beianHao, aliases))
  if (filtered.length === 0) return []

  const aClass = isAClassFund(beianHao, aliases)
  const classFiltered = filtered.filter((row) => {
    const meta = `${row.fund_name ?? ""} ${row.attachment_filename ?? ""}`
    return aClass ? /A类/u.test(meta) : !/A类/u.test(meta)
  })
  const pool = classFiltered.length > 0 ? classFiltered : filtered

  const byFundName = new Map<string, EmailNavRawRow[]>()
  for (const row of pool) {
    const key = (row.fund_name ?? "").trim() || "(unknown)"
    const list = byFundName.get(key) ?? []
    list.push(row)
    byFundName.set(key, list)
  }

  const beian = beianHao.trim().toUpperCase()
  let bestKey = ""
  let bestScore = -Infinity

  for (const [fundName, group] of byFundName) {
    let score = group.length
    if (!fundName.startsWith("资产净值公告_")) score += 100
    if (beian && fundName.toUpperCase().includes(beian)) score += 50
    if (aliases.some((alias) => fundName === alias)) score += 40
    if (fundName.startsWith("资产净值公告_")) score -= 10
    if (score > bestScore) {
      bestScore = score
      bestKey = fundName
    }
  }

  const stream = byFundName.get(bestKey) ?? []
  const byDate = new Map<string, EmailNavRawRow>()
  for (const row of stream) {
    const prev = byDate.get(row.nav_date)
    if (!prev) {
      byDate.set(row.nav_date, row)
      continue
    }
    byDate.set(row.nav_date, preferEmailNavRow(prev, row, beian))
  }

  return Array.from(byDate.values()).sort((a, b) => a.nav_date.localeCompare(b.nav_date))
}

function rowsToEmailPoints(rows: EmailNavRawRow[]): EmailNavPoint[] {
  return rows.map((row) => ({
    price_date: row.nav_date,
    nav: row.nav,
    cumulative_nav: row.cumulative_nav,
    adjusted_nav: row.adjusted_nav,
  }))
}

/** SQL predicate matching an ops_email_nav_records row to a fund. */
export function buildEmailNavMatchCondition(
  recordAlias: string,
  beianHaoExpr: string,
  productNameExpr: string,
  shortNameExpr: string,
): string {
  const e = recordAlias
  const codeGuard = buildEmailNavCodeGuard(e, beianHaoExpr)
  return `(
    ${codeGuard}
    AND (
      (${beianHaoExpr} IS NOT NULL AND BTRIM(${beianHaoExpr}) <> '' AND (
        ${e}.product_code = BTRIM(${beianHaoExpr})
        OR COALESCE(${e}.attachment_filename, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
        OR COALESCE(${e}.subject, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
      ))
      OR ${sqlFundNameMatch(`${e}.fund_name`, productNameExpr)}
      OR (${shortNameExpr} IS NOT NULL AND BTRIM(${shortNameExpr}) <> '' AND ${sqlFundNameMatch(`${e}.fund_name`, shortNameExpr)})
      OR (
        BTRIM(COALESCE(${e}.product_code, '')) <> ''
        AND (
          COALESCE(${e}.subject, '') ILIKE '%' || BTRIM(${e}.product_code) || '%'
          OR COALESCE(${e}.attachment_filename, '') ILIKE '%' || BTRIM(${e}.product_code) || '%'
        )
        AND ${sqlFundNameMatch(`${e}.subject`, productNameExpr)}
      )
    )
  )`
}

/** Prefer 净值表 attachment, then 估值表 attachment, then body/subject fallbacks. */
export const EMAIL_NAV_SOURCE_PRIORITY = `CASE COALESCE(e.source, '')
  WHEN 'attachment_nav_table' THEN 0
  WHEN 'attachment_valuation_table' THEN 1
  ELSE 2
END`

/** Latest email NAV on or before cutoff, plus the prior point for return pct. */
export function buildEmailNavLatestJoins(
  beianHaoExpr: string,
  productNameExpr: string,
  shortNameExpr: string,
  cutoffExpr: string,
): string {
  const match = buildEmailNavMatchCondition("e", beianHaoExpr, productNameExpr, shortNameExpr)
  const aClassGuard = `(
    CASE
      WHEN ${shortNameExpr} IS NOT NULL AND (${shortNameExpr} ILIKE '%A类%' OR ${productNameExpr} ILIKE '%A类%')
        OR ${beianHaoExpr} ~ 'A$'
        THEN COALESCE(e.fund_name, '') ILIKE '%A类%' OR COALESCE(e.attachment_filename, '') ILIKE '%A类%'
      ELSE COALESCE(e.fund_name, '') NOT ILIKE '%A类%' AND COALESCE(e.attachment_filename, '') NOT ILIKE '%A类%'
    END
  )`
  return `
    LEFT JOIN LATERAL (
      SELECT e.nav::numeric AS nav, e.nav_date
      FROM ops_email_nav_records e
      WHERE ${match}
        AND ${aClassGuard}
        AND e.nav_date <= ${cutoffExpr}
        AND e.nav IS NOT NULL
      ORDER BY
        ${EMAIL_NAV_SOURCE_PRIORITY},
        CASE WHEN COALESCE(e.fund_name, '') NOT LIKE '资产净值公告_%' THEN 0 ELSE 1 END,
        CASE WHEN ${beianHaoExpr} IS NOT NULL AND BTRIM(${beianHaoExpr}) <> ''
          AND (
            COALESCE(e.attachment_filename, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
            OR COALESCE(e.subject, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
            OR COALESCE(e.fund_name, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
          )
          THEN 0 ELSE 1 END,
        e.nav_date DESC,
        e.id DESC
      LIMIT 1
    ) en ON true
    LEFT JOIN LATERAL (
      SELECT e.nav::numeric AS nav
      FROM ops_email_nav_records e
      WHERE ${match}
        AND ${aClassGuard}
        AND en.nav_date IS NOT NULL
        AND e.nav_date < en.nav_date
        AND e.nav IS NOT NULL
      ORDER BY
        ${EMAIL_NAV_SOURCE_PRIORITY},
        CASE WHEN COALESCE(e.fund_name, '') NOT LIKE '资产净值公告_%' THEN 0 ELSE 1 END,
        CASE WHEN ${beianHaoExpr} IS NOT NULL AND BTRIM(${beianHaoExpr}) <> ''
          AND (
            COALESCE(e.attachment_filename, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
            OR COALESCE(e.subject, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
            OR COALESCE(e.fund_name, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
          )
          THEN 0 ELSE 1 END,
        e.nav_date DESC,
        e.id DESC
      LIMIT 1
    ) en_prev ON true
  `
}

export function buildEmailNavLatestExprs(fallbackNavExpr: string, fallbackDateExpr: string, fallbackPctExpr: string) {
  return {
    navExpr: `COALESCE(en.nav, ${fallbackNavExpr})`,
    dateExpr: `COALESCE(en.nav_date, ${fallbackDateExpr})`,
    pctExpr: `CASE
      WHEN en.nav IS NOT NULL AND en_prev.nav IS NOT NULL AND en_prev.nav <> 0
        THEN (en.nav / en_prev.nav - 1)
      ELSE ${fallbackPctExpr}
    END`,
  }
}

export type EmailNavManageRow = {
  id: string
  nav_date: string
  nav: string
  cumulative_nav: string | null
  source: string | null
}

function isVirtualNavRow(row: EmailNavRawRow): boolean {
  const meta = `${row.subject ?? ""}${row.fund_name ?? ""}${row.attachment_filename ?? ""}`
  return /虚拟/u.test(meta)
}

type EmailNavRawRowWithId = EmailNavRawRow & { id: string }

export async function loadEmailNavManageRows(
  beianHao: string,
  productName: string,
  shortName: string | null,
  navType: "pre_fee" | "virtual",
  extraNames: Array<string | null | undefined> = [],
): Promise<EmailNavManageRow[]> {
  await ensureEmailNavTable()
  const aliases = collectFundNameAliases(productName, shortName, extraNames)
  const beian = (beianHao ?? "").trim()

  const rows = await query<EmailNavRawRowWithId>(
    `SELECT e.id::text AS id, e.nav_date::text AS nav_date, e.nav::text, e.cumulative_nav::text,
            e.adjusted_nav::text,
            e.fund_name, e.attachment_filename, e.subject, e.source
     FROM ops_email_nav_records e
     WHERE e.nav_date IS NOT NULL
       AND e.nav IS NOT NULL
       AND (
         ($1 <> '' AND (
           e.product_code = $1
           OR COALESCE(e.attachment_filename, '') ILIKE '%' || $1 || '%'
           OR COALESCE(e.subject, '') ILIKE '%' || $1 || '%'
         ))
         OR EXISTS (
           SELECT 1 FROM unnest($2::text[]) AS alias(name)
           WHERE name <> ''
             AND (
               BTRIM(e.fund_name) = alias.name
               OR BTRIM(e.fund_name) LIKE alias.name || '%'
             )
         )
       )
     ORDER BY e.nav_date ASC, e.id ASC`,
    [beian, aliases],
  )

  const typeFiltered = rows.filter((row) =>
    navType === "virtual" ? isVirtualNavRow(row) : !isVirtualNavRow(row),
  )
  const stream = selectEmailSourceStream(typeFiltered, beian, aliases)
  return stream.map((row) => {
    const match = typeFiltered.find((r) => r.nav_date === row.nav_date && r.fund_name === row.fund_name)
      ?? typeFiltered.find((r) => r.nav_date === row.nav_date)
    return {
      id: match?.id ?? row.nav_date,
      nav_date: row.nav_date,
      nav: row.nav,
      cumulative_nav: row.cumulative_nav,
      source: row.source,
    }
  })
}

export async function loadEmailNavSeries(
  beianHao: string,
  productName: string,
  shortName: string | null,
  extraNames: Array<string | null | undefined> = [],
): Promise<EmailNavPoint[]> {
  await ensureEmailNavTable()
  const aliases = collectFundNameAliases(productName, shortName, extraNames)
  const beian = (beianHao ?? "").trim()

  const rows = await query<EmailNavRawRow>(
    `SELECT e.nav_date::text AS nav_date, e.nav::text, e.cumulative_nav::text,
            e.adjusted_nav::text,
            e.fund_name, e.attachment_filename, e.subject, e.source
     FROM ops_email_nav_records e
     WHERE e.nav_date IS NOT NULL
       AND e.nav IS NOT NULL
       AND (
         ($1 <> '' AND (
           e.product_code = $1
           OR COALESCE(e.attachment_filename, '') ILIKE '%' || $1 || '%'
           OR COALESCE(e.subject, '') ILIKE '%' || $1 || '%'
         ))
         OR EXISTS (
           SELECT 1 FROM unnest($2::text[]) AS alias(name)
           WHERE name <> ''
             AND (
               BTRIM(e.fund_name) = alias.name
               OR BTRIM(e.fund_name) LIKE alias.name || '%'
             )
         )
       )
     ORDER BY e.nav_date ASC, e.id ASC`,
    [beian, aliases],
  )

  const stream = selectEmailSourceStream(rows, beian, aliases)
  return rowsToEmailPoints(stream)
}

export type LegacyNavRow = {
  price_date: string
  nav: string
  cumulative_nav: string
  cum_nav_withdrawal: string
  price_change: string
}

function hasDistinctCumulative(nav: number, cumulative: number | null): boolean {
  if (cumulative === null || !Number.isFinite(cumulative)) return false
  if (!Number.isFinite(nav) || nav <= 0) return false
  return Math.abs(cumulative - nav) / nav > 0.001
}

/** Cumulative NAV materially above unit NAV — post-dividend structure (e.g. cum = unit + 0.21). */
function hasDividendOffset(unit: number, cum: number): boolean {
  return cum - unit > 0.05
}

function findFirstDividendRowIndex(rows: LegacyNavRow[]): number {
  for (let i = 0; i < rows.length; i += 1) {
    const unit = parseOptionalNav(rows[i].nav)
    const cum = parseOptionalNav(rows[i].cum_nav_withdrawal) ?? parseOptionalNav(rows[i].cumulative_nav)
    if (unit != null && cum != null && hasDividendOffset(unit, cum)) return i
  }
  return rows.length
}

/** Before the first dividend date, 单位/累计/复权 should all equal unit NAV. */
function alignPreDividendNavRows(rows: LegacyNavRow[]): LegacyNavRow[] {
  const sorted = rows.map((row) => ({ ...row }))
  const firstDiv = findFirstDividendRowIndex(sorted)
  for (let i = 0; i < firstDiv; i += 1) {
    const unit = parseOptionalNav(sorted[i].nav)
    if (unit == null || !isReasonableNav(unit)) continue
    const v = String(+unit.toFixed(6))
    sorted[i].cum_nav_withdrawal = v
    sorted[i].cumulative_nav = v
  }
  return sorted
}

function parseOptionalNav(value: string | null | undefined): number | null {
  if (value == null || value === "") return null
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : null
}

/** Unit NAV drop while cumulative NAV stays near/above its prior level — likely ex-dividend. */
function isLikelyDividendExDate(
  prevUnit: number,
  unit: number,
  prevCum: number,
  currCum?: number | null,
): boolean {
  if (prevUnit <= 0 || unit <= 0 || prevCum <= 0) return false
  const unitDrop = (prevUnit - unit) / prevUnit
  if (unitDrop < 0.015) return false
  const cumRef = currCum ?? unit
  // Ex-div: unit drops sharply while cumulative NAV stays near its prior level (not down with unit).
  return (
    unit < prevUnit * 0.985 &&
    cumRef >= prevCum * 0.995 &&
    cumRef <= prevCum * 1.05
  )
}

function chainCumulative(
  prevCum: number,
  prevUnit: number,
  unit: number,
  currCum?: number | null,
): number {
  if (isLikelyDividendExDate(prevUnit, unit, prevCum, currCum)) {
    return currCum ?? prevCum
  }
  return prevCum * (unit / prevUnit)
}

function isReasonableNav(n: number): boolean {
  return Number.isFinite(n) && n >= 0.1 && n <= 100
}

/** Rechain 累计 / 复权 from the prior row when email refreshed unit NAV only. */
function rechainDerivedFromPrev(prev: LegacyNavRow, unit: number): { cum: string; adj: string } | null {
  const prevUnit = parseOptionalNav(prev.nav)
  const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
  const prevAdj = parseOptionalNav(prev.cumulative_nav) ?? parseOptionalNav(prev.cum_nav_withdrawal)
  if (prevUnit == null || prevUnit <= 0 || prevCum == null || prevAdj == null) return null
  if (!isReasonableNav(unit) || !isReasonableNav(prevUnit) || !isReasonableNav(prevCum) || !isReasonableNav(prevAdj)) {
    return null
  }

  const unitRatio = unit / prevUnit
  if (unitRatio <= 0.5 || unitRatio >= 1.5) return null

  const prevCumW = parseOptionalNav(prev.cum_nav_withdrawal) ?? prevCum
  const prevPostDiv = hasDividendOffset(prevUnit, prevCumW)
  if (!prevPostDiv) {
    const v = String(+unit.toFixed(6))
    return { cum: v, adj: v }
  }

  const adj = prevAdj * unitRatio
  const cumUnitGap = prevCum - prevUnit
  const cum = cumUnitGap > 0.01 ? unit + cumUnitGap : prevCum * unitRatio
  if (!isReasonableNav(adj) || !isReasonableNav(cum)) return null

  return { cum: String(+cum.toFixed(6)), adj: String(+adj.toFixed(6)) }
}

/** Refresh derived NAV only on dates where email supplied unit NAV without cumulative. */
function refreshDerivedForUnitOnlyEmailRows(
  rows: LegacyNavRow[],
  unitOnlyEmailDates: Set<string>,
): LegacyNavRow[] {
  if (unitOnlyEmailDates.size === 0) return rows

  const sorted = rows.map((row) => ({ ...row }))
  for (let i = 0; i < sorted.length; i += 1) {
    if (!unitOnlyEmailDates.has(sorted[i].price_date) || i === 0) continue
    const unit = parseOptionalNav(sorted[i].nav)
    if (unit == null) continue
    const rechained = rechainDerivedFromPrev(sorted[i - 1], unit)
    if (rechained) {
      sorted[i].cum_nav_withdrawal = rechained.cum
      sorted[i].cumulative_nav = rechained.adj
    }
  }
  return sorted
}

/** After ex-div unit fix, align 复权 with cumulative return on that date. */
function syncExDivAdjustedNav(rows: LegacyNavRow[]): LegacyNavRow[] {
  const sorted = rows.map((row) => ({ ...row }))
  for (let i = 1; i < sorted.length; i += 1) {
    const curr = sorted[i]
    const prev = sorted[i - 1]
    const unit = parseOptionalNav(curr.nav)
    const cum = parseOptionalNav(curr.cum_nav_withdrawal) ?? parseOptionalNav(curr.cumulative_nav)
    const prevUnit = parseOptionalNav(prev.nav)
    const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
    const prevAdj = parseOptionalNav(prev.cumulative_nav) ?? parseOptionalNav(prev.cum_nav_withdrawal)
    if (
      unit == null || cum == null || prevUnit == null || prevCum == null || prevAdj == null
      || !isLikelyDividendExDate(prevUnit, unit, prevCum, cum)
    ) {
      continue
    }
    curr.cumulative_nav = String(+(prevAdj * (cum / prevCum)).toFixed(6))
  }
  return sorted
}

/** Guard against corrupt legacy values blowing up charts/metrics. */
function inferUnitNavFromTrustedFields(sorted: LegacyNavRow[], i: number): number | null {
  const row = sorted[i]
  const prev = i > 0 ? sorted[i - 1] : null
  const cum = parseOptionalNav(row.cum_nav_withdrawal)
  const adj = parseOptionalNav(row.cumulative_nav)

  if (cum != null && isReasonableNav(cum) && adj != null && isReasonableNav(adj)) {
    const gap = cum - adj
    if (Math.abs(gap) < 0.005) return cum
    if (gap > 0.005 && gap < 0.5) return cum - gap
  }

  const trusted = cum != null && isReasonableNav(cum)
    ? cum
    : adj != null && isReasonableNav(adj)
      ? adj
      : null
  if (trusted == null) return null

  if (prev) {
    const prevUnit = parseOptionalNav(prev.nav)
    const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
    if (prevUnit != null && isReasonableNav(prevUnit) && prevCum != null && isReasonableNav(prevCum) && prevCum > 0) {
      return prevUnit * (trusted / prevCum)
    }
  }

  return trusted
}

/** Replace corrupt unit NAV (e.g. legacy DB spikes) when 累计/复权 on the row are sane. */
function repairCorruptUnitNavRows(rows: LegacyNavRow[]): LegacyNavRow[] {
  const sorted = rows.map((row) => ({ ...row }))

  for (let i = 0; i < sorted.length; i += 1) {
    const unit = parseOptionalNav(sorted[i].nav)
    if (unit == null || isReasonableNav(unit)) continue

    const repaired = inferUnitNavFromTrustedFields(sorted, i)
    if (repaired != null && isReasonableNav(repaired)) {
      sorted[i].nav = String(+repaired.toFixed(6))
    }
  }

  return sorted
}

function clampSanityNavRows(rows: LegacyNavRow[]): LegacyNavRow[] {
  const sorted = rows.map((row) => ({ ...row }))

  for (let i = 0; i < sorted.length; i += 1) {
    let unit = parseOptionalNav(sorted[i].nav)
    if (unit != null && !isReasonableNav(unit)) {
      const repaired = inferUnitNavFromTrustedFields(sorted, i)
      if (repaired != null && isReasonableNav(repaired)) {
        sorted[i].nav = String(+repaired.toFixed(6))
        unit = repaired
      }
    }
    if (unit != null && !isReasonableNav(unit)) continue

    for (const field of ["cum_nav_withdrawal", "cumulative_nav"] as const) {
      const value = parseOptionalNav(sorted[i][field])
      if (value != null && isReasonableNav(value)) continue
      if (i === 0 || unit == null) {
        sorted[i][field] = unit != null ? String(unit) : sorted[i][field]
        continue
      }
      const rechained = rechainDerivedFromPrev(sorted[i - 1], unit)
      if (rechained) {
        sorted[i][field] = field === "cum_nav_withdrawal" ? rechained.cum : rechained.adj
      } else if (unit != null) {
        sorted[i][field] = String(unit)
      }
    }
  }

  return sorted
}

/**
 * Email parsers sometimes store 累计净值 in the unit NAV field (common on ex-dividend dates).
 * Detect when email "unit" tracks cumulative continuation instead of unit NAV.
 */
function emailNavLooksLikeCumulativeNotUnit(
  prev: LegacyNavRow | null,
  emailNav: number,
  emailCum: number | null,
): boolean {
  if (!prev) return false
  if (emailCum != null && hasDistinctCumulative(emailNav, emailCum)) return false

  const prevUnit = parseOptionalNav(prev.nav)
  const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
  if (prevUnit == null || prevUnit <= 0 || prevCum == null || prevCum <= 0) return false

  const navToPrevUnit = emailNav / prevUnit
  const navToPrevCum = emailNav / prevCum

  // Email value continued from cumulative level (+/- a few %) while unit NAV should have dropped.
  return navToPrevCum > 0.99 && navToPrevCum < 1.05 && navToPrevUnit > 0.995
}

/**
 * Fix rows where unit NAV was stored as cumulative NAV on an ex-dividend date
 * (unit == cum on the row, but the next row already has unit < cum).
 */
export function sanitizeMisassignedUnitNavRows(rows: LegacyNavRow[]): LegacyNavRow[] {
  if (rows.length < 2) return rows

  const sorted = rows.map((row) => ({ ...row }))
  for (let i = 0; i < sorted.length; i += 1) {
    const curr = sorted[i]
    const currUnit = parseOptionalNav(curr.nav)
    const currCum = parseOptionalNav(curr.cum_nav_withdrawal) ?? parseOptionalNav(curr.cumulative_nav)
    if (currUnit == null || currCum == null || currCum <= 0) continue
    if (Math.abs(currUnit - currCum) / currCum > 0.001) continue

    const prev = i > 0 ? sorted[i - 1] : null
    const next = i < sorted.length - 1 ? sorted[i + 1] : null
    if (!prev || !next) continue

    const prevUnit = parseOptionalNav(prev.nav)
    const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
    const nextUnit = parseOptionalNav(next.nav)
    const nextCum = parseOptionalNav(next.cum_nav_withdrawal) ?? parseOptionalNav(next.cumulative_nav)
    const nextAdj = parseOptionalNav(next.cumulative_nav)
    if (prevUnit == null || prevUnit <= 0 || nextUnit == null || nextUnit <= 0 || nextCum == null) continue

    const nextRatio = nextAdj != null && nextAdj > nextUnit * 1.001
      ? nextAdj / nextUnit
      : nextCum / nextUnit
    if (nextRatio < 1.02) continue
    if (Math.abs(nextUnit - nextCum) / nextCum <= 0.001) continue

    const currVsPrev = currUnit / prevUnit
    const tracksPrevCum = prevCum != null && currUnit >= prevCum * 0.99 && currUnit <= prevCum * 1.05
    // Only the ex-div row itself stores cum as unit (sharp jump to cum level), not the prior equal unit==cum day.
    if (!tracksPrevCum && (currVsPrev <= 0.995 || currVsPrev >= 1.05)) continue
    if (tracksPrevCum && currVsPrev < 1.01) continue

    const fixedUnit = currCum / nextRatio
    if (!Number.isFinite(fixedUnit) || fixedUnit <= 0 || fixedUnit >= currCum) continue
    curr.nav = String(+fixedUnit.toFixed(6))
  }

  return sorted
}

/** Fix stale/spike 累计/复权 when unit moved but derived fields did not. */
function refreshStaleDerivedFields(rows: LegacyNavRow[]): LegacyNavRow[] {
  const sorted = rows.map((row) => ({ ...row }))

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    const unit = parseOptionalNav(curr.nav)
    const prevUnit = parseOptionalNav(prev.nav)
    const adj = parseOptionalNav(curr.cumulative_nav)
    const prevAdj = parseOptionalNav(prev.cumulative_nav)
    const cum = parseOptionalNav(curr.cum_nav_withdrawal)
    const prevCum = parseOptionalNav(prev.cum_nav_withdrawal)
    if (unit == null || prevUnit == null || prevUnit <= 0) continue

    const unitRet = Math.abs(unit / prevUnit - 1)
    const adjRet = adj != null && prevAdj != null ? Math.abs(adj / prevAdj - 1) : 0
    const cumRet = cum != null && prevCum != null ? Math.abs(cum / prevCum - 1) : 0

    const staleAdj = adj != null && prevAdj != null && unitRet > 0.001 && adjRet < 0.0001
    const staleCum = cum != null && prevCum != null && unitRet > 0.001 && cumRet < 0.0001
    const spikeAdj = adj != null && prevAdj != null && (adj / prevAdj > 1.3 || adj / prevAdj < 0.7)
    const spikeCum = cum != null && prevCum != null && (cum / prevCum > 1.3 || cum / prevCum < 0.7)
    const unreasonableAdj = adj != null && !isReasonableNav(adj)
    const unreasonableCum = cum != null && !isReasonableNav(cum)

    if (!staleAdj && !staleCum && !spikeAdj && !spikeCum && !unreasonableAdj && !unreasonableCum) {
      continue
    }

    const rechained = rechainDerivedFromPrev(prev, unit)
    if (rechained) {
      curr.cum_nav_withdrawal = rechained.cum
      curr.cumulative_nav = rechained.adj
    }
  }

  return sorted
}

function finalizeNavSeries(rows: LegacyNavRow[], unitOnlyEmailDates: Set<string> = new Set()): LegacyNavRow[] {
  let out = sanitizeMisassignedUnitNavRows(rows)
  out = repairCorruptUnitNavRows(out)
  out = syncExDivAdjustedNav(out)
  out = refreshStaleDerivedFields(out)
  out = refreshDerivedForUnitOnlyEmailRows(out, unitOnlyEmailDates)
  out = clampSanityNavRows(out)
  out = alignPreDividendNavRows(out)
  return recomputeNavPriceChanges(out)
}

/** Email NAV wins on overlapping dates; chain cumulative NAV to stay consistent with legacy series. */
export function mergeNavSeriesWithEmail(legacyRows: LegacyNavRow[], emailRows: EmailNavPoint[]): LegacyNavRow[] {
  if (emailRows.length === 0) return finalizeNavSeries(legacyRows)

  const byDate = new Map<string, LegacyNavRow>()
  for (const row of legacyRows) {
    byDate.set(row.price_date, { ...row })
  }

  const sortedLegacyDates = legacyRows.map((row) => row.price_date).sort()
  const unitOnlyEmailDates = new Set<string>()

  for (const row of emailRows) {
    const nav = row.nav ?? row.cumulative_nav
    if (!nav) continue
    const unitNav = parseFloat(String(nav))
    if (!Number.isFinite(unitNav)) continue

    const emailCum = parseOptionalNav(row.cumulative_nav)
    const emailAdj = parseOptionalNav(row.adjusted_nav)
    const hasEmailCum = hasDistinctCumulative(unitNav, emailCum)
    const existing = byDate.get(row.price_date)
    const prevDate = sortedLegacyDates.filter((d) => d < row.price_date).at(-1)
      ?? Array.from(byDate.keys()).filter((d) => d < row.price_date).sort().at(-1)
    const prevRow = prevDate ? byDate.get(prevDate) ?? null : null
    const cumOnlyEmail = emailNavLooksLikeCumulativeNotUnit(prevRow, unitNav, emailCum)
    const resolvedUnitNav = cumOnlyEmail && existing ? parseOptionalNav(existing.nav) ?? unitNav : unitNav
    const resolvedCum = hasEmailCum && emailCum != null
      ? emailCum
      : cumOnlyEmail
        ? unitNav
        : null

    if (existing) {
      const updated: LegacyNavRow = {
        ...existing,
        nav: String(resolvedUnitNav),
      }
      if (resolvedCum != null) {
        updated.cum_nav_withdrawal = String(resolvedCum)
      }
      if (emailAdj != null) {
        updated.cumulative_nav = String(emailAdj)
      } else if (resolvedCum == null) {
        unitOnlyEmailDates.add(row.price_date)
      }
      byDate.set(row.price_date, updated)
    } else {
      if (resolvedCum == null && emailAdj == null) unitOnlyEmailDates.add(row.price_date)
      byDate.set(row.price_date, {
        price_date: row.price_date,
        nav: String(resolvedUnitNav),
        cumulative_nav: emailAdj != null ? String(emailAdj) : "",
        cum_nav_withdrawal: resolvedCum != null ? String(resolvedCum) : "",
        price_change: "",
      })
    }
  }

  const merged = Array.from(byDate.values()).sort((a, b) => a.price_date.localeCompare(b.price_date))
  return finalizeNavSeries(merged, unitOnlyEmailDates)
}

/** Recompute 涨跌幅 as percentage points from consecutive unit NAV (matches legacy DB + UI). */
export function recomputeNavPriceChanges(rows: LegacyNavRow[]): LegacyNavRow[] {
  if (rows.length === 0) return rows
  const sorted = [...rows].sort((a, b) => a.price_date.localeCompare(b.price_date))
  return sorted.map((row, i) => {
    if (i === 0) return { ...row, price_change: "" }
    const prev = parseFloat(sorted[i - 1].nav)
    const nav = parseFloat(row.nav)
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(nav)) return row
    return { ...row, price_change: String(((nav / prev - 1) * 100)) }
  })
}
