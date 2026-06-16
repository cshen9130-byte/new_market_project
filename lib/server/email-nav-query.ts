/**
 * Query helpers for ops_email_nav_records with priority over legacy NAV tables.
 */

import { query } from "@/lib/db"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"

export type EmailNavPoint = {
  price_date: string
  nav: string | null
  cumulative_nav: string | null
}

type EmailNavRawRow = {
  nav_date: string
  nav: string
  cumulative_nav: string | null
  fund_name: string | null
  attachment_filename: string | null
  subject: string | null
  source: string | null
}

function isValuationSource(source: string | null | undefined): boolean {
  return (source ?? "").trim() === "attachment_valuation_table"
}

function preferEmailNavRow(current: EmailNavRawRow, candidate: EmailNavRawRow, beian: string): EmailNavRawRow {
  const currentValuation = isValuationSource(current.source)
  const candidateValuation = isValuationSource(candidate.source)
  if (currentValuation !== candidateValuation) {
    return candidateValuation ? current : candidate
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
      OR (BTRIM(COALESCE(${e}.fund_name, '')) <> '' AND BTRIM(${e}.fund_name) = BTRIM(${productNameExpr}))
      OR (${shortNameExpr} IS NOT NULL AND BTRIM(${shortNameExpr}) <> '' AND BTRIM(COALESCE(${e}.fund_name, '')) <> '' AND BTRIM(${e}.fund_name) = BTRIM(${shortNameExpr}))
      OR (
        BTRIM(COALESCE(${e}.fund_name, '')) <> ''
        AND BTRIM(${productNameExpr}) <> ''
        AND BTRIM(${e}.fund_name) LIKE BTRIM(${productNameExpr}) || '%'
      )
      OR (
        ${shortNameExpr} IS NOT NULL
        AND BTRIM(${shortNameExpr}) <> ''
        AND BTRIM(COALESCE(${e}.fund_name, '')) <> ''
        AND BTRIM(${e}.fund_name) LIKE BTRIM(${shortNameExpr}) || '%'
      )
    )
  )`
}

/** Prefer 净值表 sources over 估值表 fallback rows. */
export const EMAIL_NAV_SOURCE_PRIORITY = `CASE WHEN COALESCE(e.source, '') = 'attachment_valuation_table' THEN 1 ELSE 0 END`

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

function parseOptionalNav(value: string | null | undefined): number | null {
  if (value == null || value === "") return null
  const n = parseFloat(value)
  return Number.isFinite(n) ? n : null
}

/** Unit NAV drop with cum still well above unit — likely ex-dividend, don't chain cum down. */
function isLikelyDividendExDate(prevNav: number, nav: number, prevCum: number): boolean {
  if (prevNav <= 0 || nav <= 0 || prevCum <= 0) return false
  const unitDrop = (prevNav - nav) / prevNav
  if (unitDrop < 0.015) return false
  if (prevCum <= nav * 1.02) return false
  const chainedCum = prevCum * (nav / prevNav)
  return chainedCum < prevCum * 0.985
}

function chainCumulative(prevCum: number, prevNav: number, nav: number): number {
  if (isLikelyDividendExDate(prevNav, nav, prevCum)) return prevCum
  return prevCum * (nav / prevNav)
}

function fillEmptyCumulativeFields(row: LegacyNavRow, prev: LegacyNavRow | null): void {
  const nav = parseOptionalNav(row.nav)
  if (nav == null) return
  const prevNav = prev ? parseOptionalNav(prev.nav) : null

  if (!row.cumulative_nav?.trim()) {
    const prevCum = prev ? parseOptionalNav(prev.cumulative_nav) : null
    if (prevCum != null && prevNav != null && prevNav > 0) {
      row.cumulative_nav = String(chainCumulative(prevCum, prevNav, nav))
    } else {
      row.cumulative_nav = row.nav
    }
  }

  if (!row.cum_nav_withdrawal?.trim()) {
    const prevWithdraw = prev ? parseOptionalNav(prev.cum_nav_withdrawal) : null
    if (prevWithdraw != null && prevNav != null && prevNav > 0) {
      row.cum_nav_withdrawal = String(chainCumulative(prevWithdraw, prevNav, nav))
    } else {
      row.cum_nav_withdrawal = row.cumulative_nav || row.nav
    }
  }
}

/** Email NAV wins on overlapping dates; chain cumulative NAV to stay consistent with legacy series. */
export function mergeNavSeriesWithEmail(legacyRows: LegacyNavRow[], emailRows: EmailNavPoint[]): LegacyNavRow[] {
  if (emailRows.length === 0) return legacyRows

  const byDate = new Map<string, LegacyNavRow>()
  for (const row of legacyRows) {
    byDate.set(row.price_date, { ...row })
  }

  for (const row of emailRows) {
    const nav = row.nav ?? row.cumulative_nav
    if (!nav) continue
    const unitNav = parseFloat(String(nav))
    if (!Number.isFinite(unitNav)) continue

    const emailCum = parseOptionalNav(row.cumulative_nav)
    const hasEmailCum = hasDistinctCumulative(unitNav, emailCum)
    const existing = byDate.get(row.price_date)

    if (existing) {
      const updated: LegacyNavRow = { ...existing, nav: String(unitNav) }
      if (hasEmailCum && emailCum != null) {
        // Email 净值表 often carries 累计净值; keep legacy 复权净值 when already present.
        updated.cum_nav_withdrawal = String(emailCum)
        const legacyAdj = parseOptionalNav(existing.cumulative_nav)
        if (
          legacyAdj == null
          || !hasDistinctCumulative(parseOptionalNav(existing.nav) ?? unitNav, legacyAdj)
        ) {
          updated.cumulative_nav = String(emailCum)
        }
      }
      byDate.set(row.price_date, updated)
    } else {
      byDate.set(row.price_date, {
        price_date: row.price_date,
        nav: String(unitNav),
        cumulative_nav: hasEmailCum && emailCum != null ? String(emailCum) : "",
        cum_nav_withdrawal: hasEmailCum && emailCum != null ? String(emailCum) : "",
        price_change: "",
      })
    }
  }

  const merged = Array.from(byDate.values()).sort((a, b) => a.price_date.localeCompare(b.price_date))
  let prev: LegacyNavRow | null = null
  for (const row of merged) {
    fillEmptyCumulativeFields(row, prev)
    prev = row
  }

  return recomputeNavPriceChanges(merged)
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
