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
  attachment_filename: string | null
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

/** Pick one email row per date when attachments contain multiple share classes. */
function dedupeEmailRowsByDate(rows: EmailNavRawRow[], beianHao: string, aliases: string[]): EmailNavPoint[] {
  const aClass = isAClassFund(beianHao, aliases)
  const byDate = new Map<string, EmailNavRawRow[]>()

  for (const row of rows) {
    const list = byDate.get(row.nav_date) ?? []
    list.push(row)
    byDate.set(row.nav_date, list)
  }

  const points: EmailNavPoint[] = []
  for (const [navDate, group] of byDate) {
    let candidates = group
    if (!aClass) {
      const main = group.filter((r) => !/A类/u.test(r.attachment_filename ?? ""))
      if (main.length > 0) candidates = main
    } else {
      const aRows = group.filter((r) => /A类/u.test(r.attachment_filename ?? ""))
      if (aRows.length > 0) candidates = aRows
    }

    const beianHaoTrim = beianHao.trim()
    const withBeian = beianHaoTrim
      ? candidates.filter((r) => (r.attachment_filename ?? "").includes(beianHaoTrim))
      : []
    const picked = (withBeian.length > 0 ? withBeian : candidates)[0]
    if (!picked) continue

    points.push({
      price_date: navDate,
      nav: picked.nav,
      cumulative_nav: picked.cumulative_nav ?? picked.nav,
    })
  }

  return points.sort((a, b) => a.price_date.localeCompare(b.price_date))
}

/** SQL predicate matching an ops_email_nav_records row to a fund. */
export function buildEmailNavMatchCondition(
  recordAlias: string,
  beianHaoExpr: string,
  productNameExpr: string,
  shortNameExpr: string,
): string {
  const e = recordAlias
  return `(
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
  )`
}

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
        THEN COALESCE(e.attachment_filename, '') ILIKE '%A类%'
      ELSE COALESCE(e.attachment_filename, '') NOT ILIKE '%A类%'
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
        CASE WHEN ${beianHaoExpr} IS NOT NULL AND BTRIM(${beianHaoExpr}) <> ''
          AND COALESCE(e.attachment_filename, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
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
        CASE WHEN ${beianHaoExpr} IS NOT NULL AND BTRIM(${beianHaoExpr}) <> ''
          AND COALESCE(e.attachment_filename, '') ILIKE '%' || BTRIM(${beianHaoExpr}) || '%'
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
    `SELECT e.nav_date::text AS nav_date, e.nav::text, e.cumulative_nav::text, e.attachment_filename
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

  return dedupeEmailRowsByDate(rows, beian, aliases)
}

export type LegacyNavRow = {
  price_date: string
  nav: string
  cumulative_nav: string
  cum_nav_withdrawal: string
  price_change: string
}

/** Email NAV wins on overlapping dates; legacy rows fill gaps. */
export function mergeNavSeriesWithEmail(legacyRows: LegacyNavRow[], emailRows: EmailNavPoint[]): LegacyNavRow[] {
  if (emailRows.length === 0) return legacyRows

  const byDate = new Map<string, LegacyNavRow>()
  for (const row of legacyRows) {
    byDate.set(row.price_date, row)
  }

  for (const row of emailRows) {
    const nav = row.nav ?? row.cumulative_nav
    if (!nav) continue
    const cum = row.cumulative_nav ?? nav
    byDate.set(row.price_date, {
      price_date: row.price_date,
      nav,
      cumulative_nav: cum,
      cum_nav_withdrawal: cum,
      price_change: "",
    })
  }

  const merged = Array.from(byDate.values()).sort((a, b) => a.price_date.localeCompare(b.price_date))
  for (let i = 0; i < merged.length; i++) {
    if (i === 0) {
      merged[i] = { ...merged[i], price_change: merged[i].price_change || "" }
      continue
    }
    const prev = parseFloat(merged[i - 1].nav)
    const curr = parseFloat(merged[i].nav)
    if (Number.isFinite(prev) && prev > 0 && Number.isFinite(curr)) {
      merged[i] = { ...merged[i], price_change: String(curr / prev - 1) }
    }
  }
  return merged
}
