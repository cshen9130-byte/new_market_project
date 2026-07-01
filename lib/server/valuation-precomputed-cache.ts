/**
 * Pre-computed cache for 估值表分析 page sections.
 *
 * Written nightly by scripts/ma/precompute_valuation_cache.ts.
 * Read by fund-valuation-allocation.ts to serve fast responses.
 *
 * Cache keys:
 *   "snapshot" — getFundValuationAllocation (no curves)
 *   "trend"    — getFundValuationTrendAnalysis, range stored in from_date/to_date columns
 *   "curves"   — return_curves array, range stored in from_date/to_date columns
 *
 * Cache is valid for 25 hours (refreshed once per nightly ETL run).
 */

import { query } from "@/lib/db"

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_valuation_precomputed_cache (
    beian_hao   TEXT        NOT NULL,
    cache_key   TEXT        NOT NULL,
    from_date   DATE,
    to_date     DATE,
    data        JSONB       NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (beian_hao, cache_key)
  );
  CREATE INDEX IF NOT EXISTS idx_ops_valuation_cache_computed_at
    ON ops_valuation_precomputed_cache (computed_at DESC);
`

let _tableReady = false

export async function ensureValuationCacheTable(): Promise<void> {
  if (_tableReady) return
  await query(CREATE_SQL)
  _tableReady = true
}

/** Read a cache entry. Returns null on miss or if the entry is older than maxAgeHours. */
export async function readValuationCache<T>(
  beianHao: string,
  cacheKey: string,
  options?: { fromDate?: string; toDate?: string; maxAgeHours?: number },
): Promise<T | null> {
  const maxAge = options?.maxAgeHours ?? 25
  try {
    await ensureValuationCacheTable()
    const rows = await query<{
      data: T
      from_date: string | null
      to_date: string | null
    }>(
      `SELECT data, from_date::text AS from_date, to_date::text AS to_date
       FROM ops_valuation_precomputed_cache
       WHERE beian_hao = $1
         AND cache_key = $2
         AND computed_at >= NOW() - ($3 || ' hours')::interval`,
      [beianHao, cacheKey, String(maxAge)],
    )
    const row = rows[0]
    if (!row) return null

    // For date-ranged cache keys (trend, curves), ensure the stored range matches
    if (options?.fromDate !== undefined || options?.toDate !== undefined) {
      if (row.from_date?.slice(0, 10) !== options?.fromDate?.slice(0, 10)) return null
      if (row.to_date?.slice(0, 10) !== options?.toDate?.slice(0, 10)) return null
    }

    return row.data
  } catch {
    return null
  }
}

/** Write (upsert) a cache entry. */
export async function writeValuationCache(
  beianHao: string,
  cacheKey: string,
  data: unknown,
  options?: { fromDate?: string; toDate?: string },
): Promise<void> {
  await ensureValuationCacheTable()
  const fromDate = options?.fromDate?.slice(0, 10) ?? null
  const toDate = options?.toDate?.slice(0, 10) ?? null
  await query(
    `INSERT INTO ops_valuation_precomputed_cache
       (beian_hao, cache_key, from_date, to_date, data)
     VALUES ($1, $2, $3::date, $4::date, $5::jsonb)
     ON CONFLICT (beian_hao, cache_key) DO UPDATE
       SET from_date   = EXCLUDED.from_date,
           to_date     = EXCLUDED.to_date,
           data        = EXCLUDED.data,
           computed_at = NOW()`,
    [beianHao, cacheKey, fromDate, toDate, JSON.stringify(data)],
  )
}

/** List all beian_hao that have at least one cache entry (for monitoring). */
export async function listCachedFunds(): Promise<
  Array<{ beian_hao: string; cache_key: string; computed_at: string }>
> {
  await ensureValuationCacheTable()
  return query(
    `SELECT beian_hao, cache_key, computed_at::text AS computed_at
     FROM ops_valuation_precomputed_cache
     ORDER BY beian_hao, cache_key`,
  )
}
