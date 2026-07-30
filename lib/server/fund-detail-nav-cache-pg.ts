/**
 * Persistent cache of private-fund detail NAV series.
 *
 * Every series is produced only by loadDetailNavSeriesFast (same merge as the
 * live product page / FOF tip sync). The detail API serves from this table for
 * instant opens; workers refresh it alongside list caches.
 */

import { query } from "@/lib/db"
import type { LegacyNavRow } from "@/lib/server/email-nav-query"
import type { ListCacheFundHeader } from "@/lib/server/fund-detail-fast-path"

const TABLE = "ops_private_fund_detail_nav_cache"

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${TABLE} (
    cache_key       TEXT           PRIMARY KEY,
    beian_hao       TEXT,
    product_name    TEXT           NOT NULL,
    short_name      TEXT,
    nav_series      JSONB          NOT NULL,
    nav_data_source TEXT,
    tip_nav_date    DATE,
    tip_unit_nav    NUMERIC(16,6),
    refreshed_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_detail_nav_cache_beian
    ON ${TABLE} (beian_hao);
  CREATE INDEX IF NOT EXISTS idx_detail_nav_cache_name
    ON ${TABLE} (product_name);
`

let tableEnsured = false

export type DetailNavCacheRow = {
  cache_key: string
  beian_hao: string | null
  product_name: string
  short_name: string | null
  nav_series: LegacyNavRow[]
  nav_data_source: "team" | "platform" | null
  tip_nav_date: string | null
  tip_unit_nav: string | null
  refreshed_at: string
}

export type DetailNavCacheIdentity = {
  beian_hao?: string | null
  product_name: string
  short_name?: string | null
  rawId?: string | null
  emailNameAliases?: Array<string | null | undefined>
  listHeader?: ListCacheFundHeader | null
  nav_data_source?: "team" | "platform" | null
}

export function detailNavCacheKey(
  beian_hao: string | null | undefined,
  product_name?: string | null,
): string {
  const beian = (beian_hao ?? "").trim().toUpperCase()
  if (beian) return beian
  return (product_name ?? "").trim()
}

export async function ensureDetailNavCacheTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  tableEnsured = true
}

function parseSeries(raw: unknown): LegacyNavRow[] {
  if (!Array.isArray(raw)) return []
  const out: LegacyNavRow[] = []
  for (const row of raw) {
    if (row == null || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    const price_date = String(r.price_date ?? "").slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(price_date)) continue
    out.push({
      price_date,
      nav: String(r.nav ?? ""),
      cumulative_nav: String(r.cumulative_nav ?? ""),
      cum_nav_withdrawal: String(r.cum_nav_withdrawal ?? ""),
      price_change: String(r.price_change ?? ""),
    })
  }
  return out
}

function tipFromSeries(series: LegacyNavRow[]): {
  tip_nav_date: string | null
  tip_unit_nav: number | null
} {
  const latest = series[series.length - 1]
  if (!latest) return { tip_nav_date: null, tip_unit_nav: null }
  const tip_nav_date = latest.price_date?.slice(0, 10) || null
  const unit = parseFloat(String(latest.nav ?? ""))
  return {
    tip_nav_date,
    tip_unit_nav: Number.isFinite(unit) && unit > 0 ? unit : null,
  }
}

/**
 * Cache is fresh when its tip date is not behind the list-cache tip.
 * Unit-NAV equality is not required — managed list tips can diverge from detail
 * on the same date (BatchNavResolver vs detail merge).
 */
export function isDetailNavCacheFresh(
  cached: Pick<DetailNavCacheRow, "tip_nav_date" | "nav_series">,
  listHeader: ListCacheFundHeader | null | undefined,
): boolean {
  if (!cached.nav_series.length) return false
  const listDate = listHeader?.nav_date?.slice(0, 10) ?? ""
  if (!listDate) return true
  const cacheDate =
    cached.tip_nav_date?.slice(0, 10)
    || cached.nav_series[cached.nav_series.length - 1]?.price_date?.slice(0, 10)
    || ""
  if (!cacheDate) return false
  return cacheDate >= listDate
}

export async function getDetailNavCache(
  beian_hao: string | null | undefined,
  product_name?: string | null,
): Promise<DetailNavCacheRow | null> {
  await ensureDetailNavCacheTable()
  const key = detailNavCacheKey(beian_hao, product_name)
  if (!key) return null

  const byKey = await query<{
    cache_key: string
    beian_hao: string | null
    product_name: string
    short_name: string | null
    nav_series: unknown
    nav_data_source: string | null
    tip_nav_date: string | null
    tip_unit_nav: string | null
    refreshed_at: string
  }>(
    `SELECT cache_key, beian_hao, product_name, short_name, nav_series,
            nav_data_source, tip_nav_date::text AS tip_nav_date,
            tip_unit_nav::text AS tip_unit_nav, refreshed_at::text AS refreshed_at
     FROM ${TABLE}
     WHERE cache_key = $1
     LIMIT 1`,
    [key],
  )
  let row = byKey[0]

  if (!row && product_name?.trim()) {
    const byName = await query<typeof byKey[0]>(
      `SELECT cache_key, beian_hao, product_name, short_name, nav_series,
              nav_data_source, tip_nav_date::text AS tip_nav_date,
              tip_unit_nav::text AS tip_unit_nav, refreshed_at::text AS refreshed_at
       FROM ${TABLE}
       WHERE product_name = $1
       ORDER BY refreshed_at DESC
       LIMIT 1`,
      [product_name.trim()],
    )
    row = byName[0]
  }

  if (!row) return null
  const nav_series = parseSeries(row.nav_series)
  if (nav_series.length === 0) return null

  const src = row.nav_data_source
  return {
    cache_key: row.cache_key,
    beian_hao: row.beian_hao,
    product_name: row.product_name,
    short_name: row.short_name,
    nav_series,
    nav_data_source: src === "team" || src === "platform" ? src : null,
    tip_nav_date: row.tip_nav_date?.slice(0, 10) ?? null,
    tip_unit_nav: row.tip_unit_nav,
    refreshed_at: row.refreshed_at,
  }
}

export async function upsertDetailNavCache(opts: {
  beian_hao?: string | null
  product_name: string
  short_name?: string | null
  nav_series: LegacyNavRow[]
  nav_data_source?: "team" | "platform" | null
}): Promise<void> {
  const series = opts.nav_series
  if (!series.length) return
  await ensureDetailNavCacheTable()

  const cache_key = detailNavCacheKey(opts.beian_hao, opts.product_name)
  if (!cache_key) return

  const { tip_nav_date, tip_unit_nav } = tipFromSeries(series)
  await query(
    `INSERT INTO ${TABLE} (
       cache_key, beian_hao, product_name, short_name,
       nav_series, nav_data_source, tip_nav_date, tip_unit_nav, refreshed_at
     ) VALUES (
       $1, $2, $3, $4, $5::jsonb, $6, $7::date, $8, NOW()
     )
     ON CONFLICT (cache_key) DO UPDATE SET
       beian_hao = EXCLUDED.beian_hao,
       product_name = EXCLUDED.product_name,
       short_name = EXCLUDED.short_name,
       nav_series = EXCLUDED.nav_series,
       nav_data_source = EXCLUDED.nav_data_source,
       tip_nav_date = EXCLUDED.tip_nav_date,
       tip_unit_nav = EXCLUDED.tip_unit_nav,
       refreshed_at = NOW()`,
    [
      cache_key,
      (opts.beian_hao ?? "").trim() || null,
      opts.product_name,
      opts.short_name ?? null,
      JSON.stringify(series),
      opts.nav_data_source ?? null,
      tip_nav_date,
      tip_unit_nav,
    ],
  )
}

/** Persist a series already computed by loadDetailNavSeriesFast (no re-merge). */
export async function persistDetailNavSeries(opts: {
  beian_hao?: string | null
  product_name: string
  short_name?: string | null
  nav_series: LegacyNavRow[]
  nav_data_source?: "team" | "platform" | null
  /** When true, skip FOF list tip write-through (caller updates FOF cache itself). */
  skipFofListTip?: boolean
}): Promise<void> {
  try {
    await upsertDetailNavCache(opts)
    if (!opts.skipFofListTip) {
      await syncFofListTipFromDetailSeries(opts)
    }
  } catch (err) {
    console.error(
      `[detail-nav-cache] persist failed for ${opts.beian_hao || opts.product_name}:`,
      err,
    )
  }
}

async function syncFofListTipFromDetailSeries(opts: {
  beian_hao?: string | null
  product_name: string
  nav_series: LegacyNavRow[]
}): Promise<void> {
  try {
    const { patchFofOverviewListCacheTipFromSeries } = await import(
      "@/lib/server/fof-overview-list-cache-pg"
    )
    await patchFofOverviewListCacheTipFromSeries({
      product_name: opts.product_name,
      beian_hao: opts.beian_hao,
      series: opts.nav_series,
    })
  } catch (err) {
    console.warn(
      `[detail-nav-cache] FOF tip sync failed for ${opts.beian_hao || opts.product_name}:`,
      err,
    )
  }
}

export async function invalidateDetailNavCache(
  beianHaos: Array<string | null | undefined>,
): Promise<number> {
  await ensureDetailNavCacheTable()
  const keys = [
    ...new Set(
      beianHaos.map((b) => (b ?? "").trim().toUpperCase()).filter(Boolean),
    ),
  ]
  if (keys.length === 0) return 0
  try {
    const { invalidateDetailResponseMemoryCache } = await import(
      "@/lib/server/fund-detail-response-memory-cache"
    )
    invalidateDetailResponseMemoryCache(keys)
  } catch {
    // memory cache module may be unavailable in some script contexts
  }
  const rows = await query<{ n: string }>(
    `WITH deleted AS (
       DELETE FROM ${TABLE} WHERE cache_key = ANY($1::text[]) RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM deleted`,
    [keys],
  )
  return parseInt(rows[0]?.n ?? "0", 10)
}

export async function refreshDetailNavCacheForFund(
  identity: DetailNavCacheIdentity,
): Promise<boolean> {
  const beian = (identity.beian_hao ?? "").trim()
  const product_name = identity.product_name.trim()
  if (!beian && !product_name) return false

  const { loadDetailNavSeriesFast } = await import(
    "@/lib/server/fund-detail-fast-path"
  )
  const series = await loadDetailNavSeriesFast({
    beian_hao: beian,
    product_name,
    short_name: identity.short_name ?? "",
    rawId: identity.rawId ?? undefined,
    emailNameAliases: identity.emailNameAliases,
    listHeader: identity.listHeader,
  })
  if (series.length === 0) return false

  await upsertDetailNavCache({
    beian_hao: beian || null,
    product_name,
    short_name: identity.short_name ?? null,
    nav_series: series,
    nav_data_source: identity.nav_data_source ?? null,
  })
  await syncFofListTipFromDetailSeries({
    beian_hao: beian || null,
    product_name,
    nav_series: series,
  })
  return true
}

export async function refreshDetailNavCacheForFunds(
  identities: DetailNavCacheIdentity[],
  options?: { concurrency?: number; label?: string },
): Promise<{ updated: number; failed: number }> {
  const concurrency = options?.concurrency ?? 8
  const label = options?.label ?? "detail-nav-cache"
  let updated = 0
  let failed = 0

  for (let i = 0; i < identities.length; i += concurrency) {
    const chunk = identities.slice(i, i + concurrency)
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          return await refreshDetailNavCacheForFund(id)
        } catch (err) {
          console.error(
            `[${label}] refresh failed for ${id.beian_hao || id.product_name}:`,
            err,
          )
          return null
        }
      }),
    )
    for (const ok of results) {
      if (ok === true) updated++
      else if (ok === false) failed++
      else failed++
    }
  }

  return { updated, failed }
}

/** Identities from the three list-cache tables (product-page click universe). */
export async function listDetailNavCacheUniverse(): Promise<DetailNavCacheIdentity[]> {
  await ensureDetailNavCacheTable()
  const rows = await query<{
    beian_hao: string | null
    product_name: string
    short_name: string | null
  }>(
    `SELECT DISTINCT ON (upper(coalesce(nullif(btrim(beian_hao), ''), product_name)))
       nullif(btrim(beian_hao), '') AS beian_hao,
       product_name,
       short_name
     FROM (
       SELECT beian_hao, product_name, short_name FROM ops_fof_overview_list_cache
       UNION ALL
       SELECT beian_hao, product_name, short_name FROM ops_managed_products_list_cache
       UNION ALL
       SELECT beian_hao, product_name, short_name FROM ops_tracking_funds_list_cache
     ) u
     WHERE coalesce(nullif(btrim(beian_hao), ''), product_name) IS NOT NULL
     ORDER BY upper(coalesce(nullif(btrim(beian_hao), ''), product_name)), product_name`,
  ).catch(() => [] as {
    beian_hao: string | null
    product_name: string
    short_name: string | null
  }[])

  return rows.map((r) => ({
    beian_hao: r.beian_hao,
    product_name: r.product_name,
    short_name: r.short_name,
  }))
}
