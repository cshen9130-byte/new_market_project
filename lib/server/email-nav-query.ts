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

/** SQL predicate matching an ops_email_nav_records row to a fund. */
export function buildEmailNavMatchCondition(
  recordAlias: string,
  beianHaoExpr: string,
  productNameExpr: string,
  shortNameExpr: string,
): string {
  const e = recordAlias
  return `(
    (${beianHaoExpr} IS NOT NULL AND BTRIM(${beianHaoExpr}) <> '' AND ${e}.product_code = BTRIM(${beianHaoExpr}))
    OR (BTRIM(COALESCE(${e}.fund_name, '')) <> '' AND BTRIM(${e}.fund_name) = BTRIM(${productNameExpr}))
    OR (${shortNameExpr} IS NOT NULL AND BTRIM(${shortNameExpr}) <> '' AND BTRIM(COALESCE(${e}.fund_name, '')) <> '' AND BTRIM(${e}.fund_name) = BTRIM(${shortNameExpr}))
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
  return `
    LEFT JOIN LATERAL (
      SELECT e.nav::numeric AS nav, e.nav_date
      FROM ops_email_nav_records e
      WHERE ${match}
        AND e.nav_date <= ${cutoffExpr}
        AND e.nav IS NOT NULL
      ORDER BY e.nav_date DESC, e.id DESC
      LIMIT 1
    ) en ON true
    LEFT JOIN LATERAL (
      SELECT e.nav::numeric AS nav
      FROM ops_email_nav_records e
      WHERE ${match}
        AND en.nav_date IS NOT NULL
        AND e.nav_date < en.nav_date
        AND e.nav IS NOT NULL
      ORDER BY e.nav_date DESC, e.id DESC
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
): Promise<EmailNavPoint[]> {
  await ensureEmailNavTable()
  const rows = await query<{ nav_date: string; nav: string; cumulative_nav: string | null }>(
    `SELECT nav_date::text AS nav_date, nav::text, cumulative_nav::text
     FROM ops_email_nav_records e
     WHERE (
       ($1 <> '' AND e.product_code = $1)
       OR (BTRIM(COALESCE(e.fund_name, '')) <> '' AND BTRIM(e.fund_name) = BTRIM($2))
       OR ($3 <> '' AND BTRIM(COALESCE(e.fund_name, '')) <> '' AND BTRIM(e.fund_name) = BTRIM($3))
     )
       AND e.nav_date IS NOT NULL
       AND e.nav IS NOT NULL
     ORDER BY e.nav_date ASC, e.id ASC`,
    [beianHao ?? "", productName ?? "", shortName ?? ""],
  )

  const byDate = new Map<string, EmailNavPoint>()
  for (const row of rows) {
    byDate.set(row.nav_date, {
      price_date: row.nav_date,
      nav: row.nav,
      cumulative_nav: row.cumulative_nav ?? row.nav,
    })
  }
  return Array.from(byDate.values()).sort((a, b) => a.price_date.localeCompare(b.price_date))
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
