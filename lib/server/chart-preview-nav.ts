/**
 * Lightweight NAV series for hover / chart-preview (by 备案号 only).
 * Avoids the full detail merge (email fuzzy joins, share-class fill, valuation extend).
 */

import { query } from "@/lib/db"
import type { LegacyNavRow } from "@/lib/server/email-nav-query"
import { getDetailNavCache } from "@/lib/server/fund-detail-nav-cache-pg"

export type ChartPreviewPoint = { d: string; v: number }

const PREVIEW_MEM_TTL_MS = 60_000
const PREVIEW_MEM_MAX = 300
const previewMem = new Map<string, { at: number; body: unknown }>()

export function getChartPreviewMemoryCache(key: string): unknown | null {
  const hit = previewMem.get(key)
  if (!hit) return null
  if (Date.now() - hit.at >= PREVIEW_MEM_TTL_MS) {
    previewMem.delete(key)
    return null
  }
  return hit.body
}

export function rememberChartPreviewMemoryCache(key: string, body: unknown): void {
  previewMem.set(key, { at: Date.now(), body })
  if (previewMem.size <= PREVIEW_MEM_MAX) return
  const oldest = previewMem.keys().next().value
  if (oldest != null) previewMem.delete(oldest)
}

function pickLevel(row: {
  nav?: string | number | null
  cumulative_nav?: string | number | null
  cum_nav_withdrawal?: string | number | null
}): number | null {
  for (const field of [row.cum_nav_withdrawal, row.cumulative_nav, row.nav]) {
    const value = parseFloat(String(field ?? ""))
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}

function filterByOpts(
  rows: Array<{ price_date: string; level: number }>,
  opts: { from: string; to: string } | { days: number },
): Array<{ price_date: string; level: number }> {
  if ("from" in opts) {
    return rows.filter((r) => r.price_date >= opts.from && r.price_date <= opts.to)
  }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - opts.days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return rows.filter((r) => r.price_date >= cutoffStr)
}

/** Prefer detail-page cache tip series when present (same merge as product page). */
export async function loadChartPreviewFromDetailCache(
  beian_hao: string,
  opts: { from: string; to: string } | { days: number },
): Promise<{ rows: Array<{ price_date: string; level: number }>; name: string | null } | null> {
  const cached = await getDetailNavCache(beian_hao)
  if (!cached?.nav_series?.length) return null
  const mapped = cached.nav_series.flatMap((row: LegacyNavRow) => {
    const level = pickLevel(row)
    if (level == null) return []
    return [{ price_date: String(row.price_date).slice(0, 10), level }]
  })
  const rows = filterByOpts(mapped, opts)
  if (rows.length < 2) return null
  return { rows, name: cached.product_name || null }
}

/**
 * Fast by-code union: type6 + private_fund_nav (+ group tables), deduped by date.
 * ~tens of ms vs multi-second full detail merge.
 */
export async function loadChartPreviewLiteNav(
  beian_hao: string,
  opts: { from: string; to: string } | { days: number },
): Promise<Array<{ price_date: string; level: number }>> {
  const code = beian_hao.trim()
  if (!code) return []

  const dateFilter =
    "from" in opts
      ? "price_date >= $2::date AND price_date <= $3::date"
      : "price_date >= CURRENT_DATE - ($2::int)"
  const params =
    "from" in opts ? [code, opts.from, opts.to] : [code, opts.days]

  type Raw = {
    price_date: string
    nav: string | null
    cumulative_nav: string | null
    cum_nav_withdrawal: string | null
    pri: number
  }

  const raw = await query<Raw>(
    `SELECT price_date::text AS price_date,
            nav::text,
            cumulative_nav::text,
            cum_nav_withdrawal::text,
            pri
     FROM (
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, 0 AS pri
       FROM private_fund_nav_group_type6
       WHERE beian_hao = $1 AND ${dateFilter}
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, 1 AS pri
       FROM private_fund_nav_group
       WHERE beian_hao = $1 AND ${dateFilter}
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, 2 AS pri
       FROM private_fund_nav_group_hy
       WHERE beian_hao = $1 AND ${dateFilter}
       UNION ALL
       SELECT price_date, nav, cumulative_nav, cum_nav_withdrawal, 3 AS pri
       FROM private_fund_nav
       WHERE beian_hao = $1 AND ${dateFilter}
     ) u
     ORDER BY price_date ASC, pri ASC`,
    params,
  ).catch(() => [] as Raw[])

  const byDate = new Map<string, number>()
  for (const row of raw) {
    const d = String(row.price_date).slice(0, 10)
    if (byDate.has(d)) continue
    const level = pickLevel(row)
    if (level == null) continue
    byDate.set(d, level)
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([price_date, level]) => ({ price_date, level }))
}

export async function resolveChartPreviewNameLite(beian_hao: string): Promise<string> {
  const code = beian_hao.trim()
  if (!code) return code
  const rows = await query<{ name: string }>(
    `SELECT name FROM (
       SELECT product_name AS name, 0 AS pri
       FROM ops_tracking_funds_list_cache WHERE beian_hao = $1
       UNION ALL
       SELECT product_name, 1 FROM ops_fof_overview_list_cache WHERE beian_hao = $1
       UNION ALL
       SELECT product_name, 2 FROM ops_managed_products_list_cache WHERE beian_hao = $1
       UNION ALL
       SELECT COALESCE(NULLIF(BTRIM(fund_short_name), ''), NULLIF(BTRIM(fund_name), '')) AS name, 3 AS pri
       FROM type6_ops_team_full WHERE register_number = $1
     ) t
     WHERE NULLIF(BTRIM(name), '') IS NOT NULL
     ORDER BY pri ASC
     LIMIT 1`,
    [code],
  ).catch(() => [] as { name: string }[])
  return rows[0]?.name?.trim() || code
}

/** Keep hover payloads small; full compare still uses unsliced series. */
export function downsampleChartPoints(
  points: ChartPreviewPoint[],
  maxPoints = 96,
): ChartPreviewPoint[] {
  if (points.length <= maxPoints) return points
  const out: ChartPreviewPoint[] = []
  const last = points.length - 1
  for (let i = 0; i < maxPoints; i++) {
    const idx = i === maxPoints - 1 ? last : Math.round((i * last) / (maxPoints - 1))
    const p = points[idx]
    if (out.length === 0 || out[out.length - 1].d !== p.d) out.push(p)
  }
  return out
}

export function rowsToModeSeries(
  rows: Array<{ price_date: string; level: number }>,
  mode: string,
): ChartPreviewPoint[] {
  const fund: ChartPreviewPoint[] = []
  if (rows.length === 0) return fund
  if (mode === "nav") {
    for (const row of rows) {
      if (!Number.isFinite(row.level)) continue
      fund.push({ d: row.price_date.slice(0, 10), v: parseFloat(row.level.toFixed(4)) })
    }
    return fund
  }
  const firstVal = rows[0].level
  if (!Number.isFinite(firstVal) || firstVal <= 0) return fund
  for (const row of rows) {
    if (!Number.isFinite(row.level)) continue
    fund.push({
      d: row.price_date.slice(0, 10),
      v: parseFloat(((row.level / firstVal - 1) * 100).toFixed(4)),
    })
  }
  return fund
}
