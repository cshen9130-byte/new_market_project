/**
 * Query helpers for ops_email_nav_records with priority over legacy NAV tables.
 */

import { query } from "@/lib/db"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import {
  shareClassProductCodesMatch,
  sqlFundNameMatch,
  sqlShareClassParentCodeMatch,
} from "@/lib/server/fund-name-match"

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
  product_code: string | null
  fund_name: string | null
  attachment_filename: string | null
  subject: string | null
  source: string | null
}


/** Post-investment TA / custody virtual NAV — highest-quality unit + cumulative after we hold the fund. */
export function isPostInvestmentVirtualNavEmail(
  subject: string | null | undefined,
): boolean {
  const subj = (subject ?? "").trim()
  if (!subj) return false
  if (/TA虚拟净值/u.test(subj)) return true
  if (/【基金虚拟净值表现估算】/u.test(subj)) return true
  if (/^虚拟业绩报酬_/u.test(subj)) return true
  if (/虚拟净值/u.test(subj) && !/虚拟净值表现/u.test(subj)) return true
  return false
}

/** SQL guard matching {@link isPostInvestmentVirtualNavEmail}. */
export function sqlPostInvestmentVirtualNavFilter(recordAlias: string): string {
  const e = recordAlias
  return `(
    COALESCE(${e}.subject, '') ILIKE '%TA虚拟净值%'
    OR COALESCE(${e}.subject, '') ILIKE '%【基金虚拟净值表现估算】%'
    OR COALESCE(${e}.subject, '') ILIKE '虚拟业绩报酬\_%'
    OR (
      COALESCE(${e}.subject, '') ILIKE '%虚拟净值%'
      AND COALESCE(${e}.subject, '') NOT ILIKE '%虚拟净值表现%'
    )
  )`
}

/**
 * When a fund has post-investment virtual NAV history, 资产净值公告 attachments often store
 * 累计净值 in the unit NAV column (nav == cumulative_nav). Infer unit from the virtual ratio.
 */
export function inferEmailUnitNav(
  nav: number,
  cumulativeNav: number | null | undefined,
  subject: string | null | undefined,
  virtualUnitRatio: number | null | undefined,
): number {
  if (!Number.isFinite(nav) || nav <= 0) return nav
  if (isPostInvestmentVirtualNavEmail(subject)) return nav
  if (virtualUnitRatio == null || !Number.isFinite(virtualUnitRatio) || virtualUnitRatio <= 0 || virtualUnitRatio >= 1) {
    return nav
  }
  const cum = cumulativeNav ?? nav
  if (Math.abs(nav - cum) >= 0.001) return nav
  const inferred = +(nav * virtualUnitRatio).toFixed(6)
  if (inferred >= 0.1 && inferred < nav) return inferred
  return nav
}

export function emailNavSourceTier(
  source: string | null | undefined,
  subject?: string | null,
): number {
  if (isPostInvestmentVirtualNavEmail(subject)) return -1
  const s = (source ?? "").trim()
  if (s === "attachment_nav_table") return 0
  if (s === "attachment_valuation_table") return 1
  return 2
}

/** Prefer dedicated NAV streams; exclude 估值表 only (post-investment virtual NAV is allowed). */
export const EMAIL_NAV_PRIMARY_SOURCE_FILTER = `(
  COALESCE(e.source, '') <> 'attachment_valuation_table'
  AND COALESCE(e.subject, '') NOT ILIKE '%估值表%'
  AND COALESCE(e.attachment_filename, '') NOT ILIKE '%估值表%'
)`

/** 估值表 fallback — used only when no primary NAV exists on or before cutoff. */
export const EMAIL_NAV_VALUATION_SOURCE_FILTER = `(
  COALESCE(e.source, '') = 'attachment_valuation_table'
  OR COALESCE(e.subject, '') ILIKE '%估值表%'
  OR COALESCE(e.attachment_filename, '') ILIKE '%估值表%'
)`

/** @deprecated use EMAIL_NAV_PRIMARY_SOURCE_FILTER */
export const EMAIL_NAV_UNIT_NAV_SOURCE_FILTER = EMAIL_NAV_PRIMARY_SOURCE_FILTER

function sourceTier(source: string | null | undefined, subject?: string | null): number {
  return emailNavSourceTier(source, subject)
}

const MAX_PLAUSIBLE_EMAIL_UNIT_NAV = 50

/** Reject share-count / cost columns mis-parsed as unit NAV (e.g. 虚拟计提净值表 holdings). */
export function isPlausibleEmailUnitNav(
  nav: number | null | undefined,
  cumulativeNav?: number | null,
): boolean {
  if (nav == null || !Number.isFinite(nav) || nav < 0.1 || nav > MAX_PLAUSIBLE_EMAIL_UNIT_NAV) {
    return false
  }
  const cum = cumulativeNav ?? null
  if (cum != null && Number.isFinite(cum) && cum > 0 && nav > cum * 10) return false
  return true
}

/** Parse unit NAV embedded in email subject (e.g. 单位净值为1.1386). */
export function extractSubjectUnitNavHint(subject: string | null | undefined): number | null {
  if (!subject) return null
  const m =
    subject.match(/单位净(?:值|价)\s*(?:为|[：:])\s*(\d+\.\d{3,8})/u)
    ?? subject.match(/单位净值\s*[：:]\s*(\d+\.\d{3,8})/u)
  if (!m) return null
  const n = parseFloat(m[1])
  return isPlausibleEmailUnitNav(n) ? n : null
}

function isVirtualAccrualNavTableRow(row: EmailNavRawRow): boolean {
  const meta = `${row.subject ?? ""}${row.attachment_filename ?? ""}`
  return /虚拟计提净值表/u.test(meta)
}

function productCodeMatchesBeian(row: EmailNavRawRow, beian: string): boolean {
  if (!beian) return false
  const productCode = (row.product_code ?? "").trim().toUpperCase()
  return productCode === beian.trim().toUpperCase() || shareClassProductCodesMatch(productCode, beian)
}

function embeddedCodeMatchesBeian(code: string, beian: string): boolean {
  return code === beian || shareClassProductCodesMatch(code, beian)
}

function emailRowHasAttachmentDividendOffset(row: EmailNavRawRow): boolean {
  const nav = parseOptionalNav(row.nav)
  const cum = parseOptionalNav(row.cumulative_nav)
  return (
    nav != null
    && cum != null
    && isPlausibleEmailUnitNav(nav, cum)
    && hasDividendOffset(nav, cum)
  )
}

export function preferEmailNavRow(current: EmailNavRawRow, candidate: EmailNavRawRow, beian: string): EmailNavRawRow {
  const currentTier = sourceTier(current.source, current.subject)
  const candidateTier = sourceTier(candidate.source, candidate.subject)
  if (currentTier !== candidateTier) {
    // When a virtual email (tier -1, e.g. "虚拟业绩报酬" from a FOF manager) would
    // override an attachment_nav_table row (tier 0) that already carries the correct
    // post-dividend structure (cum distinctly above unit), trust the attachment instead.
    // This prevents FOF-manager performance-fee emails — whose cumulative field tracks
    // a different accrual baseline, not the fund's actual 累计净值 — from overwriting
    // verified attachment NAV tables that already reflect the dividend offset.
    // (SNF018-style funds where attachment stores cum-as-unit are unaffected:
    //  their attachment has nav ≈ cum → no distinct cumulative → virtual still wins.)
    if (candidateTier < currentTier && candidateTier === -1 && currentTier === 0) {
      if (emailRowHasAttachmentDividendOffset(current)) return current
    }
    // Symmetric: virtual already stored as current, attachment arrives as candidate.
    if (currentTier < candidateTier && currentTier === -1 && candidateTier === 0) {
      if (emailRowHasAttachmentDividendOffset(candidate)) return candidate
    }
    return candidateTier < currentTier ? candidate : current
  }

  const currentPlausible = isPlausibleEmailUnitNav(
    parseOptionalNav(current.nav),
    parseOptionalNav(current.cumulative_nav),
  )
  const candidatePlausible = isPlausibleEmailUnitNav(
    parseOptionalNav(candidate.nav),
    parseOptionalNav(candidate.cumulative_nav),
  )
  if (currentPlausible !== candidatePlausible) {
    return candidatePlausible ? candidate : current
  }

  // Within the same source tier, prefer the row that carries a distinct cumulative
  // (unit ≠ cum, signalling a post-dividend or correction row) over one that does not.
  // This causes correction emails ("返账更正重发：净值更新") that supply the correct
  // ex-dividend unit + cum to win over earlier same-tier rows where nav == cum
  // (the original, pre-correction attachment data).
  const currNav = parseOptionalNav(current.nav)
  const currCumField = parseOptionalNav(current.cumulative_nav)
  const candNav = parseOptionalNav(candidate.nav)
  const candCumField = parseOptionalNav(candidate.cumulative_nav)
  const currentDistinct = currNav != null && currCumField != null
    && isPlausibleEmailUnitNav(currNav, currCumField)
    && hasDividendOffset(currNav, currCumField)
  const candidateDistinct = candNav != null && candCumField != null
    && isPlausibleEmailUnitNav(candNav, candCumField)
    && hasDividendOffset(candNav, candCumField)
  if (candidateDistinct && !currentDistinct) return candidate
  if (currentDistinct && !candidateDistinct) return current

  if (beian) {
    const candCode = productCodeMatchesBeian(candidate, beian)
    const currCode = productCodeMatchesBeian(current, beian)
    if (candCode && !currCode) return candidate
    if (currCode && !candCode) return current
  }

  const candAccrual = isVirtualAccrualNavTableRow(candidate)
  const currAccrual = isVirtualAccrualNavTableRow(current)
  if (candAccrual !== currAccrual) {
    return currAccrual ? candidate : current
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
  return aliases.some((alias) => {
    const a = alias.trim()
    return name === a || name.startsWith(a) || a.startsWith(name)
  })
}

/** FOF multi-level 估值表 names the queried fund as an underlying holding, not the portfolio. */
export function isFofUnderlyingValuationEmailRow(row: EmailNavRawRow, beianHao: string): boolean {
  const beian = (beianHao ?? "").trim().toUpperCase()
  if (!beian) return false
  const meta = `${row.subject ?? ""}\0${row.attachment_filename ?? ""}`
  if (!/[_\s][1-9]级/u.test(meta)) return false
  const primary =
    meta.match(/【基金估值表】([A-Z0-9]+)_/u)?.[1]?.toUpperCase()
    ?? meta.match(/(?:^|[^A-Z0-9])([A-Z0-9]{4,8})_/u)?.[1]?.toUpperCase()
  return !!primary && primary !== beian
}

function isCustodyValuationEmailRow(row: EmailNavRawRow, beian: string): boolean {
  if (!beian) return false
  const meta = `${row.subject ?? ""} ${row.attachment_filename ?? ""}`.toUpperCase()
  return (
    row.source === "attachment_valuation_table"
    && meta.includes(beian)
    && /估值表/u.test(meta)
  )
}

/** Reject FOF multi-level 估值表 rows that name the queried fund as an underlying holding. */
export function buildEmailNavFofUnderlyingRejectFilter(
  recordAlias: string,
  beianHaoExpr: string,
): string {
  const e = recordAlias
  const meta = `COALESCE(${e}.subject, '') || E'\\n' || COALESCE(${e}.attachment_filename, '')`
  return `NOT (
    ${meta} ~ '[_[:space:]][1-9]级'
    AND ${beianHaoExpr} IS NOT NULL AND BTRIM(${beianHaoExpr}) <> ''
    AND COALESCE(
      (SELECT UPPER(m[1]) FROM regexp_matches(${meta}, '【基金估值表】([A-Z0-9]+)_', 'g') AS m LIMIT 1),
      (SELECT UPPER(m[1]) FROM regexp_matches(${meta}, '(?:^|[^A-Z0-9])([A-Z0-9]{4,8})_', 'g') AS m LIMIT 1)
    ) IS NOT NULL
    AND COALESCE(
      (SELECT UPPER(m[1]) FROM regexp_matches(${meta}, '【基金估值表】([A-Z0-9]+)_', 'g') AS m LIMIT 1),
      (SELECT UPPER(m[1]) FROM regexp_matches(${meta}, '(?:^|[^A-Z0-9])([A-Z0-9]{4,8})_', 'g') AS m LIMIT 1)
    ) <> UPPER(BTRIM(${beianHaoExpr}))
  )`
}

/** Reject email rows that belong to a different share class / product code. */
export function emailRowMatchesFund(
  row: EmailNavRawRow,
  beianHao: string,
  aliases: string[],
): boolean {
  const beian = beianHao.trim().toUpperCase()
  if (isFofUnderlyingValuationEmailRow(row, beianHao)) return false

  const productCode = (row.product_code ?? "").trim().toUpperCase()
  if (beian && productCode && !embeddedCodeMatchesBeian(productCode, beian)) return false

  const embedded = extractEmbeddedProductCodes(row.fund_name, row.attachment_filename, row.subject)
  const meta = `${row.attachment_filename ?? ""} ${row.subject ?? ""} ${row.fund_name ?? ""}`

  if (beian && embedded.length > 0 && !embedded.some((code) => embeddedCodeMatchesBeian(code, beian))) {
    return false
  }

  if (beian && meta.toUpperCase().includes(beian)) return true

  if (nameMatchesAlias(row.fund_name, aliases)) {
    return embedded.length === 0 || embedded.some((code) => embeddedCodeMatchesBeian(code, beian))
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
    const virtualCount = group.filter((row) => isPostInvestmentVirtualNavEmail(row.subject)).length
    if (virtualCount > 0) score += 1000 + virtualCount * 2
    const custodyValuation = beian
      ? group.filter((row) => isCustodyValuationEmailRow(row, beian)).length
      : 0
    if (custodyValuation > 0) score += 500 + custodyValuation * 2
    if (beian && group.some((row) => (row.product_code ?? "").trim().toUpperCase() === beian)) {
      score += 300
    }
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

function isParentCodeEmailRow(row: EmailNavRawRow, beian: string): boolean {
  const code = (row.product_code ?? "").trim().toUpperCase()
  if (!code || !beian) return false
  if (code === beian) return false
  return shareClassProductCodesMatch(code, beian)
}

/** When parent-code attachments publish multiple share-class NAVs on one date, keep the series-continuous point. */
function pickEmailNavRowWithContinuity(
  dayRows: EmailNavRawRow[],
  tierBest: EmailNavRawRow,
  beian: string,
  prevNav: number | null,
): EmailNavRawRow {
  const parentRows = dayRows.filter((row) => isParentCodeEmailRow(row, beian))
  if (parentRows.length <= 1) return tierBest

  const plausible = parentRows.filter((row) => {
    const nav = parseOptionalNav(row.nav)
    return nav != null && isPlausibleEmailUnitNav(nav, parseOptionalNav(row.cumulative_nav))
  })
  if (plausible.length <= 1) return tierBest

  if (prevNav == null || prevNav <= 0) {
    const shareLetter = beian.slice(-1)
    if (!/[ABC]/.test(shareLetter)) return tierBest
    const navs = plausible
      .map((row) => parseOptionalNav(row.nav))
      .filter((nav): nav is number => nav != null)
      .sort((a, b) => a - b)
    const targetNav = shareLetter === "A" ? navs[0] : navs[navs.length - 1]
    return plausible.find((row) => Math.abs(parseOptionalNav(row.nav)! - targetNav) < 0.000001) ?? tierBest
  }

  const continuityPick = plausible.reduce((best, row) => {
    const nav = parseOptionalNav(row.nav)!
    const bestNav = parseOptionalNav(best.nav)!
    return Math.abs(nav / prevNav - 1) < Math.abs(bestNav / prevNav - 1) ? row : best
  })

  const tierNav = parseOptionalNav(tierBest.nav)
  const contNav = parseOptionalNav(continuityPick.nav)
  if (tierNav == null || contNav == null) return tierBest

  const tierMove = Math.abs(tierNav / prevNav - 1)
  const contMove = Math.abs(contNav / prevNav - 1)
  if (contMove <= 0.15 && tierMove > 0.15) return continuityPick
  return tierBest
}

/** Per-date best email row (virtual TA > attachment), with unit NAV correction for cum-as-unit rows. */
export function selectEmailNavSeriesRows(
  rows: EmailNavRawRow[],
  beianHao: string,
  aliases: string[],
): EmailNavRawRow[] {
  const filtered = rows.filter(
    (row) => !isFofUnderlyingValuationEmailRow(row, beianHao) && emailRowMatchesFund(row, beianHao, aliases),
  )
  if (filtered.length === 0) return []

  const aClass = isAClassFund(beianHao, aliases)
  const pool = filtered.filter((row) => {
    const meta = `${row.fund_name ?? ""} ${row.attachment_filename ?? ""}`
    return aClass ? /A类/u.test(meta) : !/A类/u.test(meta)
  })
  const candidates = pool.length > 0 ? pool : filtered

  const beian = beianHao.trim().toUpperCase()
  const byDateGroups = new Map<string, EmailNavRawRow[]>()
  for (const row of candidates) {
    const list = byDateGroups.get(row.nav_date) ?? []
    list.push(row)
    byDateGroups.set(row.nav_date, list)
  }

  const sortedDates = [...byDateGroups.keys()].sort()
  const selected: EmailNavRawRow[] = []
  let prevNav: number | null = null

  for (const date of sortedDates) {
    const dayRows = byDateGroups.get(date)!
    let best = dayRows[0]
    for (let i = 1; i < dayRows.length; i++) {
      best = preferEmailNavRow(best, dayRows[i], beian)
    }
    best = pickEmailNavRowWithContinuity(dayRows, best, beian, prevNav)
    selected.push(best)
    prevNav = parseOptionalNav(best.nav)
  }

  return applyEmailUnitNavCorrection(selected)
}

function applyEmailUnitNavCorrection(rows: EmailNavRawRow[]): EmailNavRawRow[] {
  let latestRatio: number | null = null
  return rows.map((row) => {
    const unit = parseOptionalNav(row.nav)
    const cum = parseOptionalNav(row.cumulative_nav)
    if (unit != null && !isPlausibleEmailUnitNav(unit, cum)) {
      const hinted = extractSubjectUnitNavHint(row.subject)
      if (hinted != null) {
        if (cum != null && cum - hinted > 0.05) latestRatio = hinted / cum
        return { ...row, nav: String(+hinted.toFixed(6)) }
      }
    }
    if (unit != null && cum != null && cum - unit > 0.05) {
      latestRatio = unit / cum
    }
    if (isPostInvestmentVirtualNavEmail(row.subject)) {
      return row
    }
    if (unit == null || latestRatio == null) return row
    const corrected = inferEmailUnitNav(unit, cum, row.subject, latestRatio)
    if (Math.abs(corrected - unit) < 0.000001) return row
    return { ...row, nav: String(+corrected.toFixed(6)) }
  })
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
        OR ${sqlShareClassParentCodeMatch(`${e}.product_code`, beianHaoExpr)}
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
  const fofReject = buildEmailNavFofUnderlyingRejectFilter("e", beianHaoExpr)
  const aClassGuard = `(
    CASE
      WHEN ${shortNameExpr} IS NOT NULL AND (${shortNameExpr} ILIKE '%A类%' OR ${productNameExpr} ILIKE '%A类%')
        OR ${beianHaoExpr} ~ 'A$'
        THEN COALESCE(e.fund_name, '') ILIKE '%A类%'
          OR COALESCE(e.attachment_filename, '') ILIKE '%A类%'
          OR (
            COALESCE(e.fund_name, '') NOT ILIKE '%B类%'
            AND COALESCE(e.fund_name, '') NOT ILIKE '%C类%'
            AND NOT (COALESCE(e.product_code, '') ~ '[BC]$')
          )
      ELSE COALESCE(e.fund_name, '') NOT ILIKE '%A类%' AND COALESCE(e.attachment_filename, '') NOT ILIKE '%A类%'
    END
  )`
  const virtualFilter = sqlPostInvestmentVirtualNavFilter("e")
  const virtualRatioSubquery = `
    SELECT (ev.nav / NULLIF(ev.cumulative_nav, 0))::numeric AS ratio
    FROM ops_email_nav_records ev
    WHERE ${buildEmailNavMatchCondition("ev", beianHaoExpr, productNameExpr, shortNameExpr)}
      AND ${buildEmailNavFofUnderlyingRejectFilter("ev", beianHaoExpr)}
      AND ${sqlPostInvestmentVirtualNavFilter("ev")}
      AND ev.nav_date <= ${cutoffExpr}
      AND ev.nav IS NOT NULL
      AND ev.cumulative_nav IS NOT NULL
      AND ev.cumulative_nav - ev.nav > 0.05
    ORDER BY ev.nav_date DESC, ev.id DESC
    LIMIT 1`
  const correctedNavExpr = `CASE
    WHEN ${virtualFilter} THEN e.nav::numeric
    WHEN e.cumulative_nav IS NOT NULL
      AND ABS(e.nav - e.cumulative_nav) < 0.001
      AND vr.ratio IS NOT NULL
      AND (e.nav * vr.ratio) >= 0.1
      AND (e.nav * vr.ratio) < e.nav
      THEN (e.nav * vr.ratio)::numeric
    ELSE e.nav::numeric
  END`
  const emailNavOrder = `
        e.nav_date DESC,
        CASE WHEN ${virtualFilter} THEN 0 ELSE 1 END,
        ${EMAIL_NAV_SOURCE_PRIORITY},
        CASE
          WHEN e.nav::numeric >= 0.1
            AND e.nav::numeric <= ${MAX_PLAUSIBLE_EMAIL_UNIT_NAV}
            AND (
              e.cumulative_nav IS NULL
              OR e.nav::numeric <= e.cumulative_nav::numeric * 10
            )
          THEN 0 ELSE 1 END,
        CASE WHEN ${beianHaoExpr} IS NOT NULL AND BTRIM(${beianHaoExpr}) <> ''
          AND BTRIM(COALESCE(e.product_code, '')) = BTRIM(${beianHaoExpr})
          THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(e.subject, '') ILIKE '%虚拟计提净值表%'
          OR COALESCE(e.attachment_filename, '') ILIKE '%虚拟计提净值表%'
          THEN 1 ELSE 0 END,
        CASE WHEN COALESCE(e.fund_name, '') NOT LIKE '资产净值公告_%' THEN 0 ELSE 1 END,
        CASE WHEN ${beianHaoExpr} IS NOT NULL AND BTRIM(${beianHaoExpr}) <> ''
          AND (
            COALESCE(e.attachment_filename, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
            OR COALESCE(e.subject, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
            OR COALESCE(e.fund_name, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
          )
          THEN 0 ELSE 1 END,
        e.id DESC`

  return `
    LEFT JOIN LATERAL (
      SELECT ${correctedNavExpr} AS nav, e.nav_date
      FROM ops_email_nav_records e
      LEFT JOIN LATERAL (${virtualRatioSubquery}) vr ON true
      WHERE ${match}
        AND ${fofReject}
        AND ${aClassGuard}
        AND ${EMAIL_NAV_PRIMARY_SOURCE_FILTER}
        AND e.nav_date <= ${cutoffExpr}
        AND e.nav IS NOT NULL
      ORDER BY ${emailNavOrder}
      LIMIT 1
    ) en ON true
    LEFT JOIN LATERAL (
      SELECT e.nav::numeric AS nav, e.nav_date
      FROM ops_email_nav_records e
      WHERE ${match}
        AND ${fofReject}
        AND ${aClassGuard}
        AND en.nav IS NULL
        AND ${EMAIL_NAV_VALUATION_SOURCE_FILTER}
        AND e.nav_date <= ${cutoffExpr}
        AND e.nav IS NOT NULL
      ORDER BY
        e.nav_date DESC,
        CASE WHEN ${beianHaoExpr} IS NOT NULL AND BTRIM(${beianHaoExpr}) <> ''
          AND (
            COALESCE(e.attachment_filename, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
            OR COALESCE(e.subject, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
          )
          THEN 0 ELSE 1 END,
        e.id DESC
      LIMIT 1
    ) en_val ON true
    LEFT JOIN LATERAL (
      SELECT e.nav::numeric AS nav
      FROM ops_email_nav_records e
      WHERE ${match}
        AND ${fofReject}
        AND ${aClassGuard}
        AND COALESCE(en.nav_date, en_val.nav_date) IS NOT NULL
        AND e.nav_date < COALESCE(en.nav_date, en_val.nav_date)
        AND e.nav IS NOT NULL
        AND (
          (${EMAIL_NAV_PRIMARY_SOURCE_FILTER})
          OR (en.nav IS NULL AND ${EMAIL_NAV_VALUATION_SOURCE_FILTER})
        )
      ORDER BY ${emailNavOrder}
      LIMIT 1
    ) en_prev ON true
  `
}

export function buildEmailNavLatestExprs(
  fallbackNavExpr: string,
  fallbackDateExpr: string,
  fallbackPctExpr: string,
  legacyNavExpr?: string,
  legacyDateExpr?: string,
) {
  const legacyNav = legacyNavExpr ?? "NULL::numeric"
  const legacyDate = legacyDateExpr ?? "NULL::date"
  const currentNav = "COALESCE(en.nav, en_val.nav)"
  const currentDate = "COALESCE(en.nav_date, en_val.nav_date)"
  return {
    navExpr: `COALESCE(${currentNav}, ${legacyNav}, ${fallbackNavExpr})`,
    dateExpr: `COALESCE(${currentDate}, ${legacyDate}, CASE WHEN (${fallbackNavExpr}) IS NOT NULL THEN ${fallbackDateExpr} END)`,
    pctExpr: `CASE
      WHEN ${currentNav} IS NOT NULL AND en_prev.nav IS NOT NULL AND en_prev.nav <> 0
        THEN (${currentNav} / en_prev.nav - 1)
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

async function queryEmailNavManageRawRows(
  beianHao: string,
  productName: string,
  shortName: string | null,
  extraNames: Array<string | null | undefined> = [],
): Promise<EmailNavRawRowWithId[]> {
  await ensureEmailNavTable()
  const aliases = collectFundNameAliases(productName, shortName, extraNames)
  const beian = (beianHao ?? "").trim()

  return query<EmailNavRawRowWithId>(
    `SELECT e.id::text AS id, e.nav_date::text AS nav_date, e.nav::text, e.cumulative_nav::text,
            e.adjusted_nav::text, e.product_code,
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
}

function filterEmailNavManageStream(
  rows: EmailNavRawRowWithId[],
  beianHao: string,
  productName: string,
  shortName: string | null,
  navType: "pre_fee" | "virtual",
  extraNames: Array<string | null | undefined> = [],
): EmailNavRawRowWithId[] {
  const aliases = collectFundNameAliases(productName, shortName, extraNames)
  const beian = (beianHao ?? "").trim()
  const typeFiltered = rows.filter((row) =>
    navType === "virtual" ? isVirtualNavRow(row) : !isVirtualNavRow(row),
  )
  return selectEmailNavSeriesRows(typeFiltered, beian, aliases).map((row) => {
    const match = typeFiltered.find((r) => r.nav_date === row.nav_date && r.fund_name === row.fund_name)
      ?? typeFiltered.find((r) => r.nav_date === row.nav_date)
    return match ?? ({ ...row, id: row.nav_date } as EmailNavRawRowWithId)
  })
}

export async function loadEmailNavManagePoints(
  beianHao: string,
  productName: string,
  shortName: string | null,
  navType: "pre_fee" | "virtual",
  extraNames: Array<string | null | undefined> = [],
): Promise<EmailNavPoint[]> {
  const rows = await queryEmailNavManageRawRows(beianHao, productName, shortName, extraNames)
  const stream = filterEmailNavManageStream(rows, beianHao, productName, shortName, navType, extraNames)
  return stream.map((row) => ({
    price_date: row.nav_date,
    nav: row.nav,
    cumulative_nav: row.cumulative_nav,
    adjusted_nav: row.adjusted_nav,
  }))
}

export async function loadEmailNavManageRows(
  beianHao: string,
  productName: string,
  shortName: string | null,
  navType: "pre_fee" | "virtual",
  extraNames: Array<string | null | undefined> = [],
): Promise<EmailNavManageRow[]> {
  const rows = await queryEmailNavManageRawRows(beianHao, productName, shortName, extraNames)
  const stream = filterEmailNavManageStream(rows, beianHao, productName, shortName, navType, extraNames)
  return stream.map((row) => ({
    id: row.id ?? row.nav_date,
    nav_date: row.nav_date,
    nav: row.nav,
    cumulative_nav: row.cumulative_nav,
    source: row.source,
  }))
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
            e.adjusted_nav::text, e.product_code,
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

  const stream = selectEmailNavSeriesRows(rows, beian, aliases)
  return rowsToEmailPoints(stream)
}

const TYPE6_LEGACY_NAV_UNIONS = `
         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 0 AS pri
         FROM private_fund_nav_group_type6
         WHERE beian_hao = $1

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 1 AS pri
         FROM private_fund_nav_group_type6
         WHERE $2 <> '' AND product_name = $2

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 2 AS pri
         FROM private_fund_nav_group_type6
         WHERE $3 <> '' AND product_name = $3

         UNION ALL
`

export type LegacyNavRowWithPri = LegacyNavRow & { pri: number }

/**
 * When group + per-fund tables disagree on the same date, prefer the row whose
 * 累计净值 stayed near the prior level through an ex-dividend unit drop (SLA063 pattern).
 */
export function preferLegacyNavRow(
  current: LegacyNavRow,
  candidate: LegacyNavRow,
  prev: LegacyNavRow | null,
  currentPri: number,
  candidatePri: number,
): LegacyNavRow {
  const currUnit = parseOptionalNav(current.nav)
  const candUnit = parseOptionalNav(candidate.nav)
  const currCum = parseOptionalNav(current.cum_nav_withdrawal) ?? parseOptionalNav(current.cumulative_nav)
  const candCum = parseOptionalNav(candidate.cum_nav_withdrawal) ?? parseOptionalNav(candidate.cumulative_nav)

  if (prev) {
    const prevUnit = parseOptionalNav(prev.nav)
    const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
    if (
      prevUnit != null && prevUnit > 0 && prevCum != null && prevCum > 0 &&
      currUnit != null && candUnit != null
    ) {
      const unitDrop = Math.max(
        currUnit < prevUnit ? (prevUnit - currUnit) / prevUnit : 0,
        candUnit < prevUnit ? (prevUnit - candUnit) / prevUnit : 0,
      )
      if (unitDrop > 0.015 && currCum != null && candCum != null) {
        const currGap = Math.abs(currCum - prevCum) / prevCum
        const candGap = Math.abs(candCum - prevCum) / prevCum
        if (candGap + 0.005 < currGap) return candidate
        if (currGap + 0.005 < candGap) return current
      }

      if (unitDrop > 0.015 && currCum != null && candCum != null && currUnit != null && candUnit != null) {
        const prevOffset = prevCum - prevUnit
        const currOffset = currCum - currUnit
        const candOffset = candCum - candUnit
        if (Math.abs(candOffset - prevOffset) + 0.02 < Math.abs(currOffset - prevOffset)) return candidate
        if (Math.abs(currOffset - prevOffset) + 0.02 < Math.abs(candOffset - prevOffset)) return current
      }
    }

    if (
      currUnit != null && candUnit != null && currCum != null && candCum != null &&
      prevUnit != null && prevCum != null && hasDividendOffset(prevUnit, prevCum)
    ) {
      const currDistinct = hasDistinctCumulative(currUnit, currCum)
      const candDistinct = hasDistinctCumulative(candUnit, candCum)
      if (candDistinct && !currDistinct) return candidate
      if (currDistinct && !candDistinct) return current
    }
  }

  return candidatePri < currentPri ? candidate : current
}

export function dedupeLegacyNavRowsByDate(rows: LegacyNavRowWithPri[]): LegacyNavRow[] {
  if (rows.length === 0) return []
  const sorted = [...rows].sort((a, b) => {
    const byDate = a.price_date.localeCompare(b.price_date)
    return byDate !== 0 ? byDate : a.pri - b.pri
  })
  const out: LegacyNavRow[] = []
  let i = 0
  while (i < sorted.length) {
    const date = sorted[i].price_date
    const group: LegacyNavRowWithPri[] = []
    while (i < sorted.length && sorted[i].price_date === date) {
      group.push(sorted[i])
      i += 1
    }
    let bestIdx = 0
    const prev = out[out.length - 1] ?? null
    for (let j = 1; j < group.length; j += 1) {
      const picked = preferLegacyNavRow(
        group[bestIdx],
        group[j],
        prev,
        group[bestIdx].pri,
        group[j].pri,
      )
      if (picked === group[j]) bestIdx = j
    }
    const { pri: _pri, ...row } = group[bestIdx]
    out.push(row)
  }
  return out
}

/** Legacy NAV tables (group / hy / per-fund). Optionally skip type6 — sparse for some 在管产品. */
export async function loadPrivateFundLegacyNavRows(
  beianHao: string,
  productName: string,
  shortName: string,
  options?: { excludeType6?: boolean },
): Promise<LegacyNavRow[]> {
  const excludeType6 = options?.excludeType6 ?? false
  const type6Block = excludeType6 ? "" : TYPE6_LEGACY_NAV_UNIONS
  try {
    const raw = await query<LegacyNavRowWithPri>(
      `SELECT
          price_date::text AS price_date,
          nav::text,
          cumulative_nav::text,
          cum_nav_withdrawal::text,
          price_change::text,
          pri
       FROM (
         ${type6Block}
         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 3 AS pri
         FROM private_fund_nav_group
         WHERE beian_hao = $1

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 4 AS pri
         FROM private_fund_nav_group
         WHERE $2 <> '' AND product_name = $2

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 5 AS pri
         FROM private_fund_nav_group
         WHERE $3 <> '' AND product_name = $3

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 6 AS pri
         FROM private_fund_nav_group_hy
         WHERE beian_hao = $1

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 7 AS pri
         FROM private_fund_nav_group_hy
         WHERE $2 <> '' AND product_name = $2

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 8 AS pri
         FROM private_fund_nav_group_hy
         WHERE $3 <> '' AND product_name = $3

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 9 AS pri
         FROM private_fund_nav
         WHERE beian_hao = $1

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 10 AS pri
         FROM private_fund_nav
         WHERE $2 <> '' AND product_name = $2

         UNION ALL

         SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change, 11 AS pri
         FROM private_fund_nav
         WHERE $3 <> '' AND product_name = $3
       ) nav_union
       ORDER BY price_date ASC, pri ASC`,
      [beianHao, productName, shortName],
    )
    return dedupeLegacyNavRowsByDate(raw)
  } catch (err) {
    console.error("[loadPrivateFundLegacyNavRows]", err)
    return []
  }
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

/** Reject FOF virtual performance-fee rows whose cum sits below unit (not fund 累计净值). */
function isUsableEmailCumulativeNav(unit: number, cum: number | null): boolean {
  if (cum == null || !isReasonableNav(cum)) return false
  if (!hasDistinctCumulative(unit, cum)) return false
  return cum >= unit - 0.001
}

/** Cumulative NAV materially above unit NAV — post-dividend structure (e.g. cum = unit + 0.21). */
function hasDividendOffset(unit: number, cum: number): boolean {
  return cum - unit > 0.05
}

/** Email 复权 is meaningful only when strictly above 累计 (attachments often copy cum into adj). */
function isPlausibleEmailAdjustedNav(cum: number | null, adj: number | null): boolean {
  if (adj == null || cum == null || !isReasonableNav(adj) || !isReasonableNav(cum)) return false
  return adj > cum + 0.001
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

/**
 * Rechain 累计 / 复权 from the prior row when email refreshed unit NAV only.
 *
 * @param currCum - Current row's cum_nav_withdrawal if already set (e.g. email provided it).
 *   When supplied and the dividend check passes, this value is used directly as the output cum
 *   instead of estimating from the unit-ratio. This prevents refreshDerivedForUnitOnlyEmailRows
 *   from discarding a correctly set cumulative NAV on ex-dividend dates.
 */
function rechainDerivedFromPrev(
  prev: LegacyNavRow,
  unit: number,
  currCum?: number | null,
): { cum: string; adj: string } | null {
  const prevUnit = parseOptionalNav(prev.nav)
  const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
  let prevAdj = parseOptionalNav(prev.cumulative_nav) ?? parseOptionalNav(prev.cum_nav_withdrawal)
  if (prevAdj != null && !isReasonableNav(prevAdj)) {
    prevAdj = parseOptionalNav(prev.cum_nav_withdrawal) ?? prevCum
  }
  if (prevUnit == null || prevUnit <= 0 || prevCum == null || prevAdj == null) return null
  if (!isReasonableNav(unit) || !isReasonableNav(prevUnit) || !isReasonableNav(prevCum) || !isReasonableNav(prevAdj)) {
    return null
  }

  const unitRatio = unit / prevUnit
  if (unitRatio <= 0.5 || unitRatio >= 1.5) return null

  const prevCumW = parseOptionalNav(prev.cum_nav_withdrawal) ?? prevCum

  // Ex-dividend day: unit dropped while cumulative NAV stays near its prior level.
  // When currCum is available (set by email), pass it to the dividend check so the
  // new cumulative level (not the dropped unit) is used for comparison.
  if (isLikelyDividendExDate(prevUnit, unit, prevCumW, currCum ?? undefined)) {
    const cumUnitGap = prevCumW - prevUnit
    // Prefer the already-known currCum; fall back to estimation only when absent.
    const cum = currCum ?? (cumUnitGap > 0.01 ? unit + cumUnitGap : prevCumW * unitRatio)
    // Grow adj at the cumulative rate so the adj/cum ratio is preserved (≥ 1).
    const adj = prevCumW > 0 ? prevAdj * cum / prevCumW : prevAdj * unitRatio
    if (!isReasonableNav(adj) || !isReasonableNav(cum)) return null
    return { cum: String(+cum.toFixed(6)), adj: String(+adj.toFixed(6)) }
  }

  const prevPostDiv = hasDividendOffset(prevUnit, prevCumW)
  if (!prevPostDiv) {
    const v = String(+unit.toFixed(6))
    return { cum: v, adj: v }
  }

  const cumUnitGap = prevCum - prevUnit
  const cum = cumUnitGap > 0.01 ? unit + cumUnitGap : prevCum * unitRatio
  // Grow adj at the cumulative rate to maintain adj/cum ratio constant (≥ 1 after ex-div).
  const adj = prevCum > 0 ? prevAdj * cum / prevCum : prevAdj * unitRatio
  if (!isReasonableNav(adj) || !isReasonableNav(cum)) return null

  return { cum: String(+cum.toFixed(6)), adj: String(+adj.toFixed(6)) }
}

/**
 * Refresh derived NAV only on dates where email supplied unit NAV without cumulative.
 *
 * When the row already has a cum_nav_withdrawal (set by mergeNavSeriesWithEmail from the email),
 * pass it to rechainDerivedFromPrev so ex-dividend dates are correctly detected even when the
 * previous row had unit == cum (no prior dividend history).  Without this, a fund receiving its
 * first dividend would have its correctly-sourced cumulative NAV overwritten with unit NAV.
 */
function refreshDerivedForEmailRows(
  rows: LegacyNavRow[],
  unitOnlyEmailDates: Set<string>,
  adjOnlyEmailDates: Set<string>,
): LegacyNavRow[] {
  if (unitOnlyEmailDates.size === 0 && adjOnlyEmailDates.size === 0) return rows

  const sorted = rows.map((row) => ({ ...row }))
  for (let i = 0; i < sorted.length; i += 1) {
    const date = sorted[i].price_date
    const adjOnly = adjOnlyEmailDates.has(date)
    const unitOnly = unitOnlyEmailDates.has(date)
    if ((!adjOnly && !unitOnly) || i === 0) continue
    const unit = parseOptionalNav(sorted[i].nav)
    if (unit == null) continue
    const currCum = parseOptionalNav(sorted[i].cum_nav_withdrawal)
    const rechained = rechainDerivedFromPrev(sorted[i - 1], unit, currCum)
    if (rechained) {
      if (!adjOnly) {
        sorted[i].cum_nav_withdrawal = rechained.cum
      }
      sorted[i].cumulative_nav = rechained.adj
    }
  }
  return sorted
}

/** After ex-div unit fix, align 复权 with the reinvestment factor on that date.
 *
 * Uses the dividend-reinvestment formula: prevAdj × (unit + D_new) / prevUnit,
 * where D_new = new dividend paid = (cum - unit) - (prevCum - prevUnit).
 * This ensures adj > cum on the ex-div date so that subsequent rechaining
 * (which maintains the adj/cum ratio) always keeps adj ≥ cum.
 */
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
    // Skip if adj is already valid (correctly above cum) — trust seed/email values.
    const existingAdj = parseOptionalNav(curr.cumulative_nav)
    if (existingAdj != null && existingAdj >= cum) continue
    // D_new = newly distributed dividend per unit = increase in (cum - unit) gap
    const D_new = (cum - unit) - (prevCum - prevUnit)
    const newAdj = +(prevAdj * (unit + D_new) / prevUnit).toFixed(6)
    if (isReasonableNav(newAdj) && newAdj >= cum) {
      curr.cumulative_nav = String(newAdj)
    }
  }
  return sorted
}

/** Forward-chain 复权净值 from the previous row for dates where it is missing (null/empty).
 *
 * This fills in the adj series for managed-product rows that come from ops_team_nav_manual
 * (which stores unit + cumulative only), after syncExDivAdjustedNav has anchored the ex-div
 * date's adj value.
 *
 * Also fills in cum_nav_withdrawal when absent, so that subsequent rechaining steps can
 * correctly distinguish cum from adj and preserve the adj/cum ratio (> 1) across chains
 * of unit-only email rows.
 */
function propagateMissingAdjRows(rows: LegacyNavRow[]): LegacyNavRow[] {
  const sorted = rows.map((row) => ({ ...row }))
  for (let i = 1; i < sorted.length; i += 1) {
    if (parseOptionalNav(sorted[i].cumulative_nav) != null) continue
    const unit = parseOptionalNav(sorted[i].nav)
    if (unit == null) continue
    const rechained = rechainDerivedFromPrev(sorted[i - 1], unit)
    if (rechained) {
      sorted[i].cumulative_nav = rechained.adj
      // If cum_nav_withdrawal is absent, set it from the rechained value so the next
      // iteration can use it as prevCum (not prevAdj as fallback), preserving adj > cum.
      if (!parseOptionalNav(sorted[i].cum_nav_withdrawal)) {
        sorted[i].cum_nav_withdrawal = rechained.cum
      }
    }
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

/**
 * Remove single-day V-shaped NAV outliers (bad legacy row dips/spikes while neighbors agree).
 * Catches ~7–15% one-day moves that immediately revert — below the 30% spike threshold in
 * refreshStaleDerivedFields but enough to distort max-drawdown and period returns.
 */
function sanitizeVShapeNavOutliers(rows: LegacyNavRow[]): LegacyNavRow[] {
  if (rows.length < 3) return rows

  const sorted = rows.map((row) => ({ ...row }))
  const OUTLIER_THRESHOLD = 0.07
  const NEIGHBOR_TOLERANCE = 0.06

  for (let i = 1; i < sorted.length - 1; i += 1) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    const next = sorted[i + 1]

    const prevUnit = parseOptionalNav(prev.nav)
    const currUnit = parseOptionalNav(curr.nav)
    const nextUnit = parseOptionalNav(next.nav)
    if (
      prevUnit == null || currUnit == null || nextUnit == null ||
      !isReasonableNav(prevUnit) || !isReasonableNav(currUnit) || !isReasonableNav(nextUnit)
    ) {
      continue
    }

    const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
    const currCum = parseOptionalNav(curr.cum_nav_withdrawal) ?? parseOptionalNav(curr.cumulative_nav)
    if (
      prevCum != null && currCum != null &&
      isLikelyDividendExDate(prevUnit, currUnit, prevCum, currCum)
    ) {
      continue
    }

    const unitBridge = Math.abs(nextUnit / prevUnit - 1)
    const unitDevPrev = Math.abs(currUnit / prevUnit - 1)
    const unitDevNext = Math.abs(currUnit / nextUnit - 1)
    const isUnitVShape =
      unitDevPrev >= OUTLIER_THRESHOLD &&
      unitDevNext >= OUTLIER_THRESHOLD &&
      unitBridge <= NEIGHBOR_TOLERANCE

    const prevAdj = parseOptionalNav(prev.cumulative_nav) ?? prevCum
    const currAdj = parseOptionalNav(curr.cumulative_nav)
    const nextAdj = parseOptionalNav(next.cumulative_nav)
      ?? parseOptionalNav(next.cum_nav_withdrawal)
    const isAdjVShape =
      prevAdj != null && currAdj != null && nextAdj != null &&
      isReasonableNav(prevAdj) && isReasonableNav(currAdj) && isReasonableNav(nextAdj) &&
      unitBridge <= 0.02 &&
      Math.abs(currAdj / prevAdj - 1) >= OUTLIER_THRESHOLD &&
      Math.abs(currAdj / nextAdj - 1) >= OUTLIER_THRESHOLD &&
      Math.abs(nextAdj / prevAdj - 1) <= NEIGHBOR_TOLERANCE

    if (!isUnitVShape && !isAdjVShape) continue

    if (isUnitVShape) {
      const fixedUnit = unitBridge <= 0.02
        ? prevUnit
        : +((prevUnit + nextUnit) / 2).toFixed(6)
      curr.nav = String(fixedUnit)
      const rechained = rechainDerivedFromPrev(prev, fixedUnit, prevCum ?? undefined)
      if (rechained) {
        curr.cum_nav_withdrawal = rechained.cum
        curr.cumulative_nav = rechained.adj
      }
      continue
    }

    const unit = currUnit
    const rechained = rechainDerivedFromPrev(prev, unit, currCum ?? undefined)
    if (rechained) {
      curr.cum_nav_withdrawal = rechained.cum
      curr.cumulative_nav = rechained.adj
    }
  }

  return sorted
}

const ISOLATED_SPIKE_RATIO = 2

function navFieldsAllEqual(row: LegacyNavRow): boolean {
  const unit = parseOptionalNav(row.nav)
  if (unit == null || unit <= 0) return false
  const cum = parseOptionalNav(row.cum_nav_withdrawal) ?? parseOptionalNav(row.cumulative_nav)
  const adj = parseOptionalNav(row.cumulative_nav)
  if (cum != null && Math.abs(unit - cum) / unit > 0.001) return false
  if (adj != null && Math.abs(unit - adj) / unit > 0.001) return false
  return true
}

/**
 * Drop terminal (or gap) rows where unit/cum/adj collapsed to one value that jumped
 * >100% from the prior row — e.g. legacy platform storing cumulative-return index as NAV.
 * V-shaped middle outliers are left for sanitizeVShapeNavOutliers.
 */
function sanitizeIsolatedNavSpikes(rows: LegacyNavRow[]): LegacyNavRow[] {
  if (rows.length < 2) return rows

  return rows.filter((row, i, sorted) => {
    if (i === 0) return true
    const prev = sorted[i - 1]
    const next = i < sorted.length - 1 ? sorted[i + 1] : null

    const currUnit = parseOptionalNav(row.nav)
    const prevUnit = parseOptionalNav(prev.nav)
    if (currUnit == null || prevUnit == null || prevUnit <= 0) return true

    const ratio = currUnit / prevUnit
    if (ratio < ISOLATED_SPIKE_RATIO && ratio > 1 / ISOLATED_SPIKE_RATIO) return true

    const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
    const currCum = parseOptionalNav(row.cum_nav_withdrawal) ?? parseOptionalNav(row.cumulative_nav)
    if (
      prevCum != null && currCum != null &&
      isLikelyDividendExDate(prevUnit, currUnit, prevCum, currCum)
    ) {
      return true
    }

    if (!navFieldsAllEqual(row)) return true

    if (next) {
      const nextUnit = parseOptionalNav(next.nav)
      if (nextUnit != null && Math.abs(nextUnit / prevUnit - 1) <= 0.06) {
        return true
      }
    }

    return false
  })
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

    // Pass cum_nav_withdrawal as currCum so that on ex-dividend dates (unit dropped while
    // cumulative correctly stayed flat) isLikelyDividendExDate detects the event and preserves
    // the cumulative NAV instead of overwriting it with the dropped unit NAV.
    const rechained = rechainDerivedFromPrev(prev, unit, cum ?? undefined)
    if (rechained) {
      curr.cum_nav_withdrawal = rechained.cum
      curr.cumulative_nav = rechained.adj
    }
  }

  return sorted
}

/**
 * Legacy/platform rows sometimes store 单位净值 in the 复权 column while 累计 stays correct
 * (cum >> unit). Metrics then treat adj ≈ unit as the series start → absurd annualized returns.
 */
function repairAdjCollapsedToUnitRows(rows: LegacyNavRow[]): LegacyNavRow[] {
  const flatEps = 0.001
  const sorted = rows.map((row) => ({ ...row }))

  for (let i = 0; i < sorted.length; i += 1) {
    const unit = parseOptionalNav(sorted[i].nav)
    const cum = parseOptionalNav(sorted[i].cum_nav_withdrawal) ?? parseOptionalNav(sorted[i].cumulative_nav)
    const adj = parseOptionalNav(sorted[i].cumulative_nav)
    if (unit == null || cum == null || adj == null) continue
    if (!hasDividendOffset(unit, cum)) continue
    if (Math.abs(adj - cum) <= flatEps) continue
    if (Math.abs(adj - unit) > flatEps) continue

    if (i > 0) {
      const prev = sorted[i - 1]
      const prevAdj = parseOptionalNav(prev.cumulative_nav) ?? parseOptionalNav(prev.cum_nav_withdrawal)
      const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
      if (
        prevAdj != null && prevCum != null && prevCum > 0 &&
        isReasonableNav(prevAdj) && prevAdj >= prevCum - flatEps
      ) {
        const rechained = +(prevAdj * cum / prevCum).toFixed(6)
        if (isReasonableNav(rechained) && rechained >= cum - flatEps) {
          sorted[i].cumulative_nav = String(rechained)
          continue
        }
      }
    }

    if (isReasonableNav(cum)) {
      sorted[i].cumulative_nav = String(+cum.toFixed(6))
    }
  }

  return sorted
}

/** When 复权 drifted below 累计 (stale legacy adj), rechain from neighbors. */
function repairAdjBelowCumRows(rows: LegacyNavRow[]): LegacyNavRow[] {
  const sorted = rows.map((row) => ({ ...row }))

  for (let i = 1; i < sorted.length; i += 1) {
    const cum = parseOptionalNav(sorted[i].cum_nav_withdrawal) ?? parseOptionalNav(sorted[i].cumulative_nav)
    const adj = parseOptionalNav(sorted[i].cumulative_nav)
    if (cum == null || adj == null || adj >= cum) continue

    const prev = sorted[i - 1]
    const prevAdj = parseOptionalNav(prev.cumulative_nav) ?? parseOptionalNav(prev.cum_nav_withdrawal)
    const prevCum = parseOptionalNav(prev.cum_nav_withdrawal) ?? parseOptionalNav(prev.cumulative_nav)
    if (prevAdj == null || prevCum == null || prevCum <= 0 || prevAdj < prevCum - 0.001) continue

    const rechained = +(prevAdj * cum / prevCum).toFixed(6)
    if (isReasonableNav(rechained) && rechained >= cum) {
      sorted[i].cumulative_nav = String(rechained)
    }
  }

  const flatAdjEps = 0.001
  const minAdjCumRatio = 1.001
  let lastGoodRatio: number | null = null
  for (let i = 0; i < sorted.length; i += 1) {
    const cum = parseOptionalNav(sorted[i].cum_nav_withdrawal) ?? parseOptionalNav(sorted[i].cumulative_nav)
    const adj = parseOptionalNav(sorted[i].cumulative_nav)
    if (cum == null || cum <= 0 || adj == null) continue
    if (adj > cum + flatAdjEps) {
      lastGoodRatio = adj / cum
      continue
    }
    if (lastGoodRatio != null && lastGoodRatio >= minAdjCumRatio && adj <= cum + flatAdjEps) {
      const filled = +(cum * lastGoodRatio).toFixed(6)
      if (isReasonableNav(filled) && filled >= cum + flatAdjEps) {
        sorted[i].cumulative_nav = String(filled)
        lastGoodRatio = filled / cum
      }
    }
  }

  let trailingRatio: number | null = null
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const cum = parseOptionalNav(sorted[i].cum_nav_withdrawal) ?? parseOptionalNav(sorted[i].cumulative_nav)
    const adj = parseOptionalNav(sorted[i].cumulative_nav)
    if (cum == null || cum <= 0) continue
    if (adj != null && adj > cum + flatAdjEps) {
      trailingRatio = adj / cum
      continue
    }
    if (trailingRatio == null || trailingRatio < minAdjCumRatio) continue
    const filled = +(cum * trailingRatio).toFixed(6)
    if (isReasonableNav(filled) && filled >= cum + flatAdjEps) {
      sorted[i].cumulative_nav = String(filled)
    }
  }

  return sorted
}

/**
 * Legacy platform rows sometimes store 累计净值 and 复权净值 in swapped DB columns
 * (cum_nav_withdrawal > cumulative_nav while both sit above unit). Restores adj >= cum >= unit.
 */
function repairSwappedCumAdjRows(rows: LegacyNavRow[]): LegacyNavRow[] {
  return rows.map((row) => {
    const unit = parseOptionalNav(row.nav)
    const cum = parseOptionalNav(row.cum_nav_withdrawal)
    const adj = parseOptionalNav(row.cumulative_nav)
    if (unit == null || cum == null || adj == null) return row
    if (!isReasonableNav(unit) || !isReasonableNav(cum) || !isReasonableNav(adj)) return row
    if (cum <= adj) return row
    if (!hasDistinctCumulative(unit, cum) || !hasDistinctCumulative(unit, adj)) return row

    // Small cum > adj gaps are stale-ratio drift — repairAdjBelowCumRows handles those.
    // Large gaps mean the two column values were stored in swapped fields (SQX078 pattern).
    if ((cum - adj) / unit < 0.15) return row

    const swappedCum = adj
    const swappedAdj = cum
    if (swappedAdj >= swappedCum && swappedCum >= unit) {
      return {
        ...row,
        cum_nav_withdrawal: String(+swappedCum.toFixed(6)),
        cumulative_nav: String(+swappedAdj.toFixed(6)),
      }
    }
    return row
  })
}

function finalizeNavSeries(
  rows: LegacyNavRow[],
  unitOnlyEmailDates: Set<string> = new Set(),
  adjOnlyEmailDates: Set<string> = new Set(),
): LegacyNavRow[] {
  let out = sanitizeMisassignedUnitNavRows(rows)
  out = repairSwappedCumAdjRows(out)
  out = sanitizeVShapeNavOutliers(out)
  out = sanitizeIsolatedNavSpikes(out)
  out = repairCorruptUnitNavRows(out)
  out = syncExDivAdjustedNav(out)
  out = propagateMissingAdjRows(out)
  out = refreshStaleDerivedFields(out)
  out = refreshDerivedForEmailRows(out, unitOnlyEmailDates, adjOnlyEmailDates)
  out = clampSanityNavRows(out)
  out = repairAdjCollapsedToUnitRows(out)
  out = repairAdjBelowCumRows(out)
  out = alignPreDividendNavRows(out)
  return recomputeNavPriceChanges(out)
}

function emailUnitOnlyNeedsRechain(
  existing: LegacyNavRow,
  resolvedUnitNav: number,
  prevRow: LegacyNavRow | null,
): boolean {
  const existingUnit = parseOptionalNav(existing.nav)
  const unitChanged =
    existingUnit == null ||
    Math.abs(existingUnit - resolvedUnitNav) / Math.max(existingUnit, resolvedUnitNav, 1) > 0.0001
  if (unitChanged) return true
  if (!prevRow) return false

  const existingCum = parseOptionalNav(existing.cum_nav_withdrawal)
  const existingAdj = parseOptionalNav(existing.cumulative_nav)
  const expected = rechainDerivedFromPrev(prevRow, resolvedUnitNav)
  if (!expected) return false

  const expectedCum = parseFloat(expected.cum)
  const expectedAdj = parseFloat(expected.adj)
  const cumOk = existingCum != null && Math.abs(existingCum - expectedCum) < 0.001
  const adjOk = existingAdj != null && Math.abs(existingAdj - expectedAdj) < 0.001
  if (cumOk && adjOk) return false

  const legacyPostDiv =
    existingCum != null &&
    isReasonableNav(existingCum) &&
    hasDistinctCumulative(resolvedUnitNav, existingCum)

  // Email reaffirmed unit NAV on a post-div legacy row — keep it unless derived fields drifted.
  if (legacyPostDiv && hasDistinctCumulative(resolvedUnitNav, expectedCum)) {
    return true
  }
  if (legacyPostDiv) return false

  return !cumOk || !adjOk
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
  const adjOnlyEmailDates = new Set<string>()

  for (const row of emailRows) {
    const nav = row.nav ?? row.cumulative_nav
    if (!nav) continue
    const unitNav = parseFloat(String(nav))
    if (!Number.isFinite(unitNav)) continue

    const emailCum = parseOptionalNav(row.cumulative_nav)
    const emailAdjRaw = parseOptionalNav(row.adjusted_nav)
    const hasEmailCum = isUsableEmailCumulativeNav(unitNav, emailCum)
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
    const emailAdj =
      isPlausibleEmailAdjustedNav(resolvedCum, emailAdjRaw) ? emailAdjRaw : null

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
      } else if (resolvedCum != null) {
        const existingAdj = parseOptionalNav(existing.cumulative_nav)
        const keepLegacyAdj =
          existingAdj != null && isPlausibleEmailAdjustedNav(resolvedCum, existingAdj)
        if (keepLegacyAdj) {
          // Email confirms unit+cum only; legacy 复权 is still valid — do not wipe and rechain.
          updated.cumulative_nav = existing.cumulative_nav
        } else {
          // Email refreshed unit + cum — drop stale legacy 复权 so finalizeNavSeries rechains adj.
          updated.cumulative_nav = ""
          adjOnlyEmailDates.add(row.price_date)
        }
      } else if (emailUnitOnlyNeedsRechain(existing, resolvedUnitNav, prevRow)) {
        unitOnlyEmailDates.add(row.price_date)
      }
      byDate.set(row.price_date, updated)
    } else {
      if (emailAdj == null) {
        if (resolvedCum != null) adjOnlyEmailDates.add(row.price_date)
        else unitOnlyEmailDates.add(row.price_date)
      }
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
  return finalizeNavSeries(merged, unitOnlyEmailDates, adjOnlyEmailDates)
}

/**
 * Team / managed NAV wins on every date it has; legacy only supplies dates absent from team.
 * Use for 在管产品 so sparse type6 legacy cannot override the team email stream.
 */
export function mergeLegacyWithTeamNav(
  legacyRows: LegacyNavRow[],
  teamRows: LegacyNavRow[],
): LegacyNavRow[] {
  if (teamRows.length === 0) return finalizeNavSeries(legacyRows)
  const teamDates = new Set(teamRows.map((row) => row.price_date))
  const legacyFill = legacyRows.filter((row) => !teamDates.has(row.price_date))
  const merged = [
    ...legacyFill,
    ...teamRows.map((row) => ({ ...row })),
  ].sort((a, b) => a.price_date.localeCompare(b.price_date))
  return finalizeNavSeries(merged)
}

/** Return rows where adj >= cum >= unit is violated (empty = OK). */
export function findNavInvariantViolations(rows: LegacyNavRow[]): Array<{
  price_date: string
  nav: number
  cum_nav_withdrawal: number
  cumulative_nav: number
}> {
  const out: Array<{
    price_date: string
    nav: number
    cum_nav_withdrawal: number
    cumulative_nav: number
  }> = []
  for (const row of rows) {
    const unit = parseOptionalNav(row.nav)
    const cum = parseOptionalNav(row.cum_nav_withdrawal) ?? parseOptionalNav(row.cumulative_nav)
    const adj = parseOptionalNav(row.cumulative_nav)
    if (unit == null || cum == null || adj == null) continue
    if (adj + 0.0005 >= cum && cum + 0.0005 >= unit) continue
    out.push({
      price_date: row.price_date,
      nav: unit,
      cum_nav_withdrawal: cum,
      cumulative_nav: adj,
    })
  }
  return out
}

/** Recompute 涨跌幅 as percentage points from consecutive unit NAV (matches legacy DB + UI). */
export function recomputeNavPriceChanges(rows: LegacyNavRow[]): LegacyNavRow[] {
  if (rows.length === 0) return rows
  const sorted = [...rows].sort((a, b) => a.price_date.localeCompare(b.price_date))
  return sorted.map((row, i) => {
    if (i === 0) return { ...row, price_change: "" }
    const prevRow = sorted[i - 1]
    const prevUnit = parseFloat(prevRow.nav)
    const unit = parseFloat(row.nav)
    if (!Number.isFinite(prevUnit) || prevUnit <= 0 || !Number.isFinite(unit)) return row

    // On dividend ex-dates, unit drops sharply while cumulative NAV stays flat.
    // Use the cumulative NAV ratio for the economic return (matches what investors see).
    const prevCum = parseOptionalNav(prevRow.cum_nav_withdrawal) ?? parseOptionalNav(prevRow.cumulative_nav) ?? prevUnit
    const currCum = parseOptionalNav(row.cum_nav_withdrawal) ?? parseOptionalNav(row.cumulative_nav) ?? unit
    if (isLikelyDividendExDate(prevUnit, unit, prevCum, currCum)) {
      if (prevCum > 0 && Number.isFinite(currCum)) {
        return { ...row, price_change: String(((currCum / prevCum - 1) * 100)) }
      }
    }

    return { ...row, price_change: String(((unit / prevUnit - 1) * 100)) }
  })
}
