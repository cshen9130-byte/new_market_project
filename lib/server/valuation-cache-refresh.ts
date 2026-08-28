/**
 * Keep 估值表分析 precomputed cache aligned with latest parsed 估值表 data.
 *
 * Light ETL updates the 在管产品 list cache but previously skipped valuation
 * metrics/holdings latest + ops_valuation_precomputed_cache, causing list dates
 * to run ahead of the 估值表 page until nightly precompute.
 */

import { query } from "@/lib/db"
import { readValuationCache, writeValuationCache } from "@/lib/server/valuation-precomputed-cache"

export type TouchedValuationFund = {
  productCode: string
  fundName: string
}

const MEM_TTL_MS = 20_000
const MEM_CACHE_MAX = 80
const valuationMemCache = new Map<string, { at: number; data: unknown }>()

function memCacheKey(
  beianHao: string,
  cacheKey: string,
  options?: { fromDate?: string; toDate?: string },
): string {
  return [
    beianHao.trim().toUpperCase(),
    cacheKey,
    options?.fromDate?.slice(0, 10) ?? "",
    options?.toDate?.slice(0, 10) ?? "",
  ].join("|")
}

function readValuationMemoryCache<T>(key: string): T | null {
  const hit = valuationMemCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at >= MEM_TTL_MS) {
    valuationMemCache.delete(key)
    return null
  }
  return hit.data as T
}

function rememberValuationMemoryCache(key: string, data: unknown): void {
  valuationMemCache.set(key, { at: Date.now(), data })
  if (valuationMemCache.size <= MEM_CACHE_MAX) return
  const oldest = valuationMemCache.keys().next().value
  if (oldest != null) valuationMemCache.delete(oldest)
}

function dropValuationMemoryCache(beianHaos: string[]): void {
  const codes = new Set(beianHaos.map((c) => c.trim().toUpperCase()).filter(Boolean))
  if (codes.size === 0) {
    valuationMemCache.clear()
    return
  }
  for (const key of [...valuationMemCache.keys()]) {
    const code = key.split("|")[0]
    if (code && codes.has(code)) valuationMemCache.delete(key)
  }
}

/** Latest 估值表 date for a fund — raw records win when metrics_latest lags. */
export async function lookupLatestValuationDateForBeian(beianHao: string): Promise<string | null> {
  const code = beianHao.trim().toUpperCase()
  if (!code) return null
  const rows = await query<{ latest_date: string | null }>(
    `SELECT GREATEST(
       (SELECT MAX(valuation_date) FROM ops_email_valuation_records WHERE product_code = $1),
       (SELECT MAX(valuation_date) FROM ops_email_valuation_fund_metrics_latest WHERE product_code = $1)
     )::text AS latest_date`,
    [code],
  )
  return rows[0]?.latest_date?.slice(0, 10) ?? null
}

function cacheValuationDate(data: unknown): string | null {
  if (data == null || typeof data !== "object") return null
  const date = (data as { valuation_date?: unknown }).valuation_date
  return typeof date === "string" ? date.slice(0, 10) : null
}

/** Return cached payload only when its valuation_date matches the latest ingested 估值表. */
export async function readValuationCacheIfFresh<T>(
  beianHao: string,
  cacheKey: string,
  options?: { fromDate?: string; toDate?: string; maxAgeHours?: number },
): Promise<T | null> {
  const key = memCacheKey(beianHao, cacheKey, options)
  const memHit = readValuationMemoryCache<T>(key)
  if (memHit) return memHit

  const [cached, latestDate] = await Promise.all([
    readValuationCache<T>(beianHao, cacheKey, options),
    lookupLatestValuationDateForBeian(beianHao),
  ])
  if (!cached) return null

  if (latestDate) {
    if (cacheKey === "snapshot") {
      const cacheDate = cacheValuationDate(cached)
      if (cacheDate && cacheDate < latestDate) return null
    } else if ((cacheKey === "trend" || cacheKey === "curves") && options?.toDate) {
      if (options.toDate.slice(0, 10) < latestDate) return null
    }
  }

  rememberValuationMemoryCache(key, cached)
  return cached
}

export async function invalidateValuationCache(beianHaos: string[]): Promise<void> {
  const codes = [...new Set(beianHaos.map((c) => c.trim().toUpperCase()).filter(Boolean))]
  dropValuationMemoryCache(codes)
  if (codes.length === 0) return
  await query(
    `DELETE FROM ops_valuation_precomputed_cache WHERE beian_hao = ANY($1::text[])`,
    [codes],
  )
}

/** Upsert ops_email_valuation_fund_metrics_latest for specific product codes (fast vs full rebuild). */
export async function upsertMetricsLatestForProductCodes(productCodes: string[]): Promise<number> {
  const codes = [...new Set(productCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))]
  if (codes.length === 0) return 0

  const rows = await query<{ n: string }>(
    `WITH latest AS (
       SELECT DISTINCT ON (r.product_code)
         r.product_code, r.fund_name, r.valuation_date, r.id,
         r.unit_nav, r.cumulative_nav, r.custody_balance, r.net_asset_value, r.paid_in_capital,
         r.total_asset, r.total_liability, r.custodian
       FROM ops_email_valuation_records r
       WHERE r.product_code = ANY($1::text[])
         AND NULLIF(BTRIM(r.fund_name), '') IS NOT NULL
       ORDER BY r.product_code, r.valuation_date DESC, r.id DESC
     ),
     inserted AS (
       INSERT INTO ops_email_valuation_fund_metrics_latest (
         product_code, fund_name, valuation_date, valuation_record_id,
         unit_nav, cumulative_nav, custody_balance, net_asset_value, paid_in_capital,
         total_asset, total_liability, custodian, refreshed_at
       )
       SELECT
         product_code, fund_name, valuation_date, id,
         unit_nav, cumulative_nav, custody_balance, net_asset_value, paid_in_capital,
         total_asset, total_liability, custodian, NOW()
       FROM latest
       ON CONFLICT (fund_name) DO UPDATE SET
         product_code = EXCLUDED.product_code,
         valuation_date = EXCLUDED.valuation_date,
         valuation_record_id = EXCLUDED.valuation_record_id,
         unit_nav = EXCLUDED.unit_nav,
         cumulative_nav = EXCLUDED.cumulative_nav,
         custody_balance = EXCLUDED.custody_balance,
         net_asset_value = EXCLUDED.net_asset_value,
         paid_in_capital = EXCLUDED.paid_in_capital,
         total_asset = EXCLUDED.total_asset,
         total_liability = EXCLUDED.total_liability,
         custodian = EXCLUDED.custodian,
         refreshed_at = NOW()
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
    [codes],
  )
  return parseInt(rows[0]?.n ?? "0", 10)
}

/**
 * After light/incremental email parse: refresh valuation latest tables for touched
 * funds and drop stale 估值表 page cache so the next request serves current data.
 */
export async function refreshValuationPipelineForTouchedFunds(
  touched: TouchedValuationFund[],
): Promise<{ metricsUpserted: number; cacheInvalidated: number }> {
  const codes = touched
    .map((f) => f.productCode.trim().toUpperCase())
    .filter(Boolean)
  if (codes.length === 0) {
    return { metricsUpserted: 0, cacheInvalidated: 0 }
  }

  const { refreshFundLatestValuationHoldings } = await import(
    "@/lib/server/email-valuation-holdings-pg"
  )
  await refreshFundLatestValuationHoldings()

  const metricsUpserted = await upsertMetricsLatestForProductCodes(codes)
  await invalidateValuationCache(codes)

  return { metricsUpserted, cacheInvalidated: codes.length }
}

/** Persist a freshly computed snapshot so later requests stay fast. */
export async function cacheFreshValuationSnapshot(
  beianHao: string,
  snapshot: unknown,
): Promise<void> {
  rememberValuationMemoryCache(memCacheKey(beianHao, "snapshot"), snapshot)
  try {
    await writeValuationCache(beianHao, "snapshot", snapshot)
  } catch (err) {
    console.warn("[valuation-cache-refresh] snapshot write failed:", beianHao, err)
  }
}

export async function cacheFreshValuationCurves(
  beianHao: string,
  curves: unknown,
  range: { fromDate: string; toDate: string },
): Promise<void> {
  rememberValuationMemoryCache(memCacheKey(beianHao, "curves", range), curves)
  try {
    await writeValuationCache(beianHao, "curves", curves, range)
  } catch (err) {
    console.warn("[valuation-cache-refresh] curves write failed:", beianHao, err)
  }
}
