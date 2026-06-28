/**
 * Precomputed 投资概览 metrics — refreshed nightly after email NAV / valuation ETL
 * so the dashboard loads from indexed tables instead of per-request valuation scans.
 */

import { query } from "@/lib/db"
import {
  buildFofUnderlyingBeianJoins,
  buildManagedProductsFrom,
  fofUnderlyingShortExpr,
} from "@/lib/server/fof-underlying-query"
import { ensureEmailValuationTable } from "@/lib/server/email-valuation-pg"
import { ensureManagedProductsListCachePopulated } from "@/lib/server/managed-products-list-cache-pg"
import { ensureManagedFofUnderlyingTable } from "@/lib/server/managed-fof-underlying-pg"
import { chunkedInsert } from "@/lib/server/list-cache-nav-batch"

const PRODUCT_EXPR = "m.product_name"
const SHORT_EXPR = fofUnderlyingShortExpr(PRODUCT_EXPR)
const UNDERLYING_PRODUCT_EXPR = "agg.product_name"

const OPS_BY_BEIAN_JOIN = `
     LEFT JOIN LATERAL (
       SELECT company_strategy_one, company_strategy_two, company_strategy_three,
              platform_strategy_one, platform_strategy_two, platform_strategy_three
       FROM type6_ops_team_full t6
       WHERE cache.beian_hao IS NOT NULL AND BTRIM(cache.beian_hao) <> ''
         AND t6.register_number = cache.beian_hao
       ORDER BY t6.updated_at DESC NULLS LAST, t6.id DESC
       LIMIT 1
     ) ops ON true`

const UNDERLYING_OPS_BY_BEIAN_JOIN = `
     LEFT JOIN LATERAL (
       SELECT company_strategy_one, company_strategy_two, company_strategy_three,
              platform_strategy_one, platform_strategy_two, platform_strategy_three
       FROM type6_ops_team_full t6
       WHERE agg.beian_hao IS NOT NULL AND BTRIM(agg.beian_hao) <> ''
         AND t6.register_number = agg.beian_hao
       ORDER BY t6.updated_at DESC NULLS LAST, t6.id DESC
       LIMIT 1
     ) ops ON true`

function strategyColumns(strategySource: "company" | "platform", prefix: "cache" | "agg"): {
  l1: string
  l2: string
  l3: string
} {
  const o = "o"
  if (strategySource === "platform") {
    return {
      l1: `NULLIF(BTRIM(COALESCE(${o}.platform_strategy_one, ops.platform_strategy_one)), '')`,
      l2: `NULLIF(BTRIM(COALESCE(${o}.platform_strategy_two, ops.platform_strategy_two)), '')`,
      l3: `NULLIF(BTRIM(COALESCE(${o}.platform_strategy_three, ops.platform_strategy_three)), '')`,
    }
  }
  if (prefix === "cache") {
    return {
      l1: `COALESCE(NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), cache.company_strategy_l1)`,
      l2: `COALESCE(NULLIF(BTRIM(o.company_strategy_two), ''), NULLIF(BTRIM(ops.company_strategy_two), ''), NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), cache.company_strategy_l1)`,
      l3: `COALESCE(NULLIF(BTRIM(o.company_strategy_three), ''), NULLIF(BTRIM(ops.company_strategy_three), ''), NULLIF(BTRIM(o.company_strategy_two), ''), NULLIF(BTRIM(ops.company_strategy_two), ''), NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), cache.company_strategy_l1)`,
    }
  }
  return {
    l1: `COALESCE(NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`,
    l2: `COALESCE(NULLIF(BTRIM(o.company_strategy_two), ''), NULLIF(BTRIM(ops.company_strategy_two), ''), NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`,
    l3: `COALESCE(NULLIF(BTRIM(o.company_strategy_three), ''), NULLIF(BTRIM(ops.company_strategy_three), ''), NULLIF(BTRIM(o.company_strategy_two), ''), NULLIF(BTRIM(ops.company_strategy_two), ''), NULLIF(BTRIM(o.company_strategy_one), ''), NULLIF(BTRIM(ops.company_strategy_one), ''), NULLIF(BTRIM(split_part(COALESCE(b.strategy_company, ''), ',', 1)), ''))`,
  }
}

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS ops_investment_overview_product_cache (
    managed_product_id    BIGINT      PRIMARY KEY,
    product_name          TEXT        NOT NULL,
    short_name            TEXT,
    beian_hao             TEXT,
    company_strategy_l1   TEXT,
    company_strategy_l2   TEXT,
    company_strategy_l3   TEXT,
    platform_strategy_l1  TEXT,
    platform_strategy_l2  TEXT,
    platform_strategy_l3  TEXT,
    team_tags             JSONB,
    net_asset_value       NUMERIC(20,2),
    nav_date              DATE,
    refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ops_investment_overview_nav_daily (
    managed_product_id    BIGINT      NOT NULL,
    valuation_date        DATE        NOT NULL,
    net_asset_value       NUMERIC(20,2) NOT NULL,
    PRIMARY KEY (managed_product_id, valuation_date)
  );

  CREATE INDEX IF NOT EXISTS idx_inv_overview_nav_daily_date
    ON ops_investment_overview_nav_daily (valuation_date);

  CREATE TABLE IF NOT EXISTS ops_investment_overview_underlying_cache (
    managed_product_id    BIGINT      NOT NULL,
    product_key           TEXT        NOT NULL,
    product_name          TEXT        NOT NULL,
    beian_hao             TEXT,
    market_value          NUMERIC(20,2),
    valuation_date        DATE,
    manager_name          TEXT,
    company_strategy_l1   TEXT,
    company_strategy_l2   TEXT,
    company_strategy_l3   TEXT,
    platform_strategy_l1  TEXT,
    platform_strategy_l2  TEXT,
    platform_strategy_l3  TEXT,
    refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (managed_product_id, product_key)
  );

  CREATE INDEX IF NOT EXISTS idx_inv_overview_underlying_product_key
    ON ops_investment_overview_underlying_cache (product_key);

  CREATE TABLE IF NOT EXISTS ops_investment_overview_cache_meta (
    id                    SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    product_count         INT         NOT NULL DEFAULT 0,
    nav_row_count         INT         NOT NULL DEFAULT 0,
    underlying_row_count  INT         NOT NULL DEFAULT 0,
    nav_min_date          DATE,
    nav_max_date          DATE,
    refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`

let tablesEnsured = false
let cacheMeta: {
  productCount: number
  navMinDate: string | null
  navMaxDate: string | null
  refreshedAt: number
} | null = null
const CACHE_META_TTL_MS = 60_000

async function refreshCacheMetaFromDb(): Promise<void> {
  await ensureInvestmentOverviewCacheTables()
  const rows = await query<{
    product_count: string
    nav_row_count: string
    nav_min_date: string | null
    nav_max_date: string | null
  }>(
    `SELECT product_count::text,
            nav_row_count::text,
            nav_min_date::text,
            nav_max_date::text
     FROM ops_investment_overview_cache_meta
     WHERE id = 1`,
  )
  const row = rows[0]
  if (row) {
    cacheMeta = {
      productCount: parseInt(row.product_count ?? "0", 10),
      navMinDate: row.nav_min_date ?? null,
      navMaxDate: row.nav_max_date ?? null,
      refreshedAt: Date.now(),
    }
    return
  }

  const fallback = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_investment_overview_product_cache`,
  )
  cacheMeta = {
    productCount: parseInt(fallback[0]?.n ?? "0", 10),
    navMinDate: null,
    navMaxDate: null,
    refreshedAt: Date.now(),
  }
}

export async function investmentOverviewCacheReady(): Promise<boolean> {
  if (cacheMeta && Date.now() - cacheMeta.refreshedAt < CACHE_META_TTL_MS) {
    return cacheMeta.productCount > 0
  }
  await refreshCacheMetaFromDb()
  return (cacheMeta?.productCount ?? 0) > 0
}

export async function ensureInvestmentOverviewCacheTables(): Promise<void> {
  if (tablesEnsured) return
  await query(CREATE_TABLES_SQL)
  tablesEnsured = true
}

function logProgress(msg: string): void {
  console.error(`[investment-overview-cache] ${new Date().toISOString()} ${msg}`)
}

export type CachedOverviewProductRow = {
  id: string
  product_name: string
  short_name: string | null
  beian_hao: string | null
  company_strategy_l1: string | null
  company_strategy_l2: string | null
  company_strategy_l3: string | null
  platform_strategy_l1: string | null
  platform_strategy_l2: string | null
  platform_strategy_l3: string | null
  team_tags: string | null
  cache_nav_date: string | null
  net_asset_value: string | null
}

export type CachedOverviewNavRow = {
  product_id: string
  valuation_date: string
  net_asset_value: string | null
}

export type CachedOverviewUnderlyingRow = {
  managed_product_id: string
  product_key: string
  product_name: string
  beian_hao: string | null
  market_value: string | null
  valuation_date: string | null
  manager_name: string | null
  company_strategy_l1: string | null
  company_strategy_l2: string | null
  company_strategy_l3: string | null
  platform_strategy_l1: string | null
  platform_strategy_l2: string | null
  platform_strategy_l3: string | null
}

export async function getInvestmentOverviewCacheDateRange(): Promise<{ min: string; max: string } | null> {
  if (!cacheMeta || Date.now() - cacheMeta.refreshedAt >= CACHE_META_TTL_MS) {
    await refreshCacheMetaFromDb()
  }
  if (!cacheMeta?.navMinDate || !cacheMeta.navMaxDate) return null
  return { min: cacheMeta.navMinDate, max: cacheMeta.navMaxDate }
}

export async function loadInvestmentOverviewProductsFromCache(): Promise<CachedOverviewProductRow[]> {
  await ensureInvestmentOverviewCacheTables()
  return query<CachedOverviewProductRow>(
    `SELECT managed_product_id::text AS id,
            product_name,
            short_name,
            beian_hao,
            company_strategy_l1,
            company_strategy_l2,
            company_strategy_l3,
            platform_strategy_l1,
            platform_strategy_l2,
            platform_strategy_l3,
            team_tags::text AS team_tags,
            nav_date::text AS cache_nav_date,
            net_asset_value::text AS net_asset_value
     FROM ops_investment_overview_product_cache
     ORDER BY managed_product_id`,
  )
}

export async function loadInvestmentOverviewNavFromCache(
  productIds: string[],
  startDate: string,
  endDate: string,
): Promise<CachedOverviewNavRow[]> {
  await ensureInvestmentOverviewCacheTables()
  if (productIds.length === 0) return []

  return query<CachedOverviewNavRow>(
    `SELECT managed_product_id::text AS product_id,
            valuation_date::text AS valuation_date,
            net_asset_value::text AS net_asset_value
     FROM ops_investment_overview_nav_daily
     WHERE managed_product_id = ANY($1::bigint[])
       AND valuation_date BETWEEN $2::date AND $3::date
     ORDER BY managed_product_id, valuation_date`,
    [productIds, startDate, endDate],
  )
}

export async function loadInvestmentOverviewUnderlyingFromCache(
  managedProductIds?: string[],
): Promise<CachedOverviewUnderlyingRow[]> {
  await ensureInvestmentOverviewCacheTables()
  if (managedProductIds?.length) {
    return query<CachedOverviewUnderlyingRow>(
      `SELECT managed_product_id::text,
              product_key,
              product_name,
              beian_hao,
              market_value::text,
              valuation_date::text,
              manager_name,
              company_strategy_l1,
              company_strategy_l2,
              company_strategy_l3,
              platform_strategy_l1,
              platform_strategy_l2,
              platform_strategy_l3
       FROM ops_investment_overview_underlying_cache
       WHERE managed_product_id = ANY($1::bigint[])
       ORDER BY market_value::numeric DESC NULLS LAST, product_name`,
      [managedProductIds],
    )
  }

  return query<CachedOverviewUnderlyingRow>(
    `SELECT managed_product_id::text,
            product_key,
            product_name,
            beian_hao,
            market_value::text,
            valuation_date::text,
            manager_name,
            company_strategy_l1,
            company_strategy_l2,
            company_strategy_l3,
            platform_strategy_l1,
            platform_strategy_l2,
            platform_strategy_l3
     FROM ops_investment_overview_underlying_cache
     ORDER BY market_value::numeric DESC NULLS LAST, product_name`,
  )
}

/** Rebuild all investment overview caches (products, NAV series, underlying holdings). */
export async function refreshInvestmentOverviewCache(): Promise<{
  products: number
  navRows: number
  underlyingRows: number
}> {
  await ensureManagedProductsListCachePopulated()
  await ensureEmailValuationTable()
  await ensureManagedFofUnderlyingTable()
  await ensureInvestmentOverviewCacheTables()

  const asOfDate = new Date().toISOString().slice(0, 10)
  const companyCols = strategyColumns("company", "cache")
  const platformCols = strategyColumns("platform", "cache")
  const underlyingCompanyCols = strategyColumns("company", "agg")
  const underlyingPlatformCols = strategyColumns("platform", "agg")

  logProgress("loading managed products…")
  const productRows = await query<{
    id: string
    product_name: string
    short_name: string | null
    beian_hao: string | null
    company_strategy_l1: string | null
    company_strategy_l2: string | null
    company_strategy_l3: string | null
    platform_strategy_l1: string | null
    platform_strategy_l2: string | null
    platform_strategy_l3: string | null
    team_tags: unknown
    cache_nav_date: string | null
    net_asset_value: string | null
  }>(
    `SELECT m.id::text AS id,
            m.product_name,
            ${SHORT_EXPR} AS short_name,
            cache.beian_hao,
            ${companyCols.l1} AS company_strategy_l1,
            ${companyCols.l2} AS company_strategy_l2,
            ${companyCols.l3} AS company_strategy_l3,
            ${platformCols.l1} AS platform_strategy_l1,
            ${platformCols.l2} AS platform_strategy_l2,
            ${platformCols.l3} AS platform_strategy_l3,
            cache.team_tags AS team_tags,
            cache.nav_date::text AS cache_nav_date,
            COALESCE(cache.net_asset_value, m.net_asset_value)::text AS net_asset_value
     ${buildManagedProductsFrom(PRODUCT_EXPR)}
     LEFT JOIN ops_managed_products_list_cache cache
       ON cache.managed_product_id = m.id
     ${OPS_BY_BEIAN_JOIN}
     WHERE m.product_name <> '合计'
       AND (COALESCE(cache.net_asset_value, m.net_asset_value) IS NULL
            OR COALESCE(cache.net_asset_value, m.net_asset_value) > 0)
     ORDER BY m.sequence_no NULLS LAST, m.id`,
  )

  logProgress(`writing ${productRows.length} product rows…`)
  await query(`DELETE FROM ops_investment_overview_product_cache`)
  if (productRows.length > 0) {
    const values: unknown[] = []
    const placeholders: string[] = []
    let pi = 1
    for (const row of productRows) {
      placeholders.push(
        `($${pi}, $${pi + 1}, $${pi + 2}, $${pi + 3}, $${pi + 4}, $${pi + 5}, $${pi + 6}, $${pi + 7}, $${pi + 8}, $${pi + 9}, $${pi + 10}::jsonb, $${pi + 11}, $${pi + 12}::date, NOW())`,
      )
      values.push(
        row.id,
        row.product_name,
        row.short_name,
        row.beian_hao,
        row.company_strategy_l1,
        row.company_strategy_l2,
        row.company_strategy_l3,
        row.platform_strategy_l1,
        row.platform_strategy_l2,
        row.platform_strategy_l3,
        row.team_tags != null ? JSON.stringify(row.team_tags) : null,
        row.net_asset_value != null ? parseFloat(row.net_asset_value) : null,
        row.cache_nav_date,
      )
      pi += 13
    }
    await chunkedInsert(
      `INSERT INTO ops_investment_overview_product_cache (
         managed_product_id, product_name, short_name, beian_hao,
         company_strategy_l1, company_strategy_l2, company_strategy_l3,
         platform_strategy_l1, platform_strategy_l2, platform_strategy_l3,
         team_tags, net_asset_value, nav_date, refreshed_at
       ) VALUES`,
      "",
      placeholders,
      values,
      13,
    )
  }

  const productIds = productRows.map((r) => r.id)
  let navRows: Array<{ product_id: string; valuation_date: string; net_asset_value: string | null }> = []

  if (productIds.length > 0) {
    logProgress("loading full NAV history…")
    navRows = await query(
      `SELECT DISTINCT ON (m.id, v.valuation_date)
              m.id::text AS product_id,
              v.valuation_date::text AS valuation_date,
              COALESCE(v.net_asset_value, v.net_asset)::text AS net_asset_value
       ${buildManagedProductsFrom(PRODUCT_EXPR)}
       INNER JOIN ops_managed_products_list_cache cache
         ON cache.managed_product_id = m.id
       INNER JOIN ops_email_valuation_records v
         ON v.valuation_date <= $2::date
        AND COALESCE(v.net_asset_value, v.net_asset) IS NOT NULL
        AND COALESCE(v.net_asset_value, v.net_asset) > 0
        AND (
          (cache.beian_hao IS NOT NULL AND BTRIM(cache.beian_hao) <> ''
           AND UPPER(BTRIM(v.product_code)) = UPPER(BTRIM(cache.beian_hao)))
          OR v.fund_name = m.product_name
          OR v.fund_name = ${SHORT_EXPR}
        )
       WHERE m.id = ANY($1::bigint[])
       ORDER BY m.id, v.valuation_date, v.id DESC`,
      [productIds, asOfDate],
    )
  }

  logProgress(`writing ${navRows.length} NAV daily rows…`)
  await query(`DELETE FROM ops_investment_overview_nav_daily`)
  if (navRows.length > 0) {
    const values: unknown[] = []
    const placeholders: string[] = []
    let pi = 1
    for (const row of navRows) {
      const nav = row.net_asset_value != null ? parseFloat(row.net_asset_value) : NaN
      if (!Number.isFinite(nav) || nav <= 0) continue
      placeholders.push(`($${pi}, $${pi + 1}::date, $${pi + 2})`)
      values.push(row.product_id, row.valuation_date, nav)
      pi += 3
    }
    if (placeholders.length > 0) {
      await chunkedInsert(
        `INSERT INTO ops_investment_overview_nav_daily (
           managed_product_id, valuation_date, net_asset_value
         ) VALUES`,
        "",
        placeholders,
        values,
        3,
      )
    }
  }

  logProgress("loading underlying holdings…")
  const underlyingRows = await query<{
    managed_product_id: string
    product_key: string
    product_name: string
    beian_hao: string | null
    market_value: string | null
    valuation_date: string | null
    manager_name: string | null
    company_strategy_l1: string | null
    company_strategy_l2: string | null
    company_strategy_l3: string | null
    platform_strategy_l1: string | null
    platform_strategy_l2: string | null
    platform_strategy_l3: string | null
  }>(
    `SELECT
       agg.managed_product_id::text,
       agg.product_key,
       agg.product_name,
       agg.beian_hao,
       agg.market_value,
       agg.valuation_date,
       COALESCE(
         NULLIF(BTRIM(pfi.manager), ''),
         NULLIF(BTRIM(track.manager_names), ''),
         NULLIF(BTRIM(track.advisor), '')
       ) AS manager_name,
       ${underlyingCompanyCols.l1} AS company_strategy_l1,
       ${underlyingCompanyCols.l2} AS company_strategy_l2,
       ${underlyingCompanyCols.l3} AS company_strategy_l3,
       ${underlyingPlatformCols.l1} AS platform_strategy_l1,
       ${underlyingPlatformCols.l2} AS platform_strategy_l2,
       ${underlyingPlatformCols.l3} AS platform_strategy_l3
     FROM (
       SELECT
         m.managed_product_id,
         COALESCE(
           NULLIF(BTRIM(UPPER(m.underlying_product_code)), ''),
           'NAME:' || TRIM(m.underlying_name)
         ) AS product_key,
         m.underlying_name AS product_name,
         NULLIF(BTRIM(m.underlying_product_code), '') AS beian_hao,
         COALESCE(m.market_value, 0)::text AS market_value,
         m.valuation_date::text AS valuation_date
       FROM ops_managed_fof_underlying m
       WHERE COALESCE(m.market_value, 0) > 0
     ) agg
     ${buildFofUnderlyingBeianJoins(UNDERLYING_PRODUCT_EXPR)}
     ${UNDERLYING_OPS_BY_BEIAN_JOIN}
     LEFT JOIN private_fund_info pfi ON pfi.beian_hao = agg.beian_hao
     LEFT JOIN LATERAL (
       SELECT manager_names, advisor
       FROM basicinfo_bfl_track b
       WHERE agg.beian_hao IS NOT NULL AND BTRIM(agg.beian_hao) <> ''
         AND b.register_number = agg.beian_hao
       ORDER BY b.updated_at DESC NULLS LAST, b.id DESC
       LIMIT 1
     ) track ON true
     WHERE COALESCE(agg.market_value::numeric, 0) > 0`,
  )

  logProgress(`writing ${underlyingRows.length} underlying rows…`)
  await query(`DELETE FROM ops_investment_overview_underlying_cache`)
  if (underlyingRows.length > 0) {
    const values: unknown[] = []
    const placeholders: string[] = []
    let pi = 1
    for (const row of underlyingRows) {
      const mv = row.market_value != null ? parseFloat(row.market_value) : NaN
      if (!Number.isFinite(mv) || mv <= 0) continue
      placeholders.push(
        `($${pi}, $${pi + 1}, $${pi + 2}, $${pi + 3}, $${pi + 4}, $${pi + 5}::date, $${pi + 6}, $${pi + 7}, $${pi + 8}, $${pi + 9}, $${pi + 10}, $${pi + 11}, $${pi + 12}, NOW())`,
      )
      values.push(
        row.managed_product_id,
        row.product_key,
        row.product_name,
        row.beian_hao,
        mv,
        row.valuation_date,
        row.manager_name,
        row.company_strategy_l1,
        row.company_strategy_l2,
        row.company_strategy_l3,
        row.platform_strategy_l1,
        row.platform_strategy_l2,
        row.platform_strategy_l3,
      )
      pi += 13
    }
    if (placeholders.length > 0) {
      await chunkedInsert(
        `INSERT INTO ops_investment_overview_underlying_cache (
           managed_product_id, product_key, product_name, beian_hao,
           market_value, valuation_date, manager_name,
           company_strategy_l1, company_strategy_l2, company_strategy_l3,
           platform_strategy_l1, platform_strategy_l2, platform_strategy_l3,
           refreshed_at
         ) VALUES`,
        "",
        placeholders,
        values,
        13,
      )
    }
  }

  await query(
    `INSERT INTO ops_investment_overview_cache_meta (
       id, product_count, nav_row_count, underlying_row_count,
       nav_min_date, nav_max_date, refreshed_at
     ) VALUES (
       1, $1, $2, $3,
       (SELECT MIN(valuation_date) FROM ops_investment_overview_nav_daily),
       (SELECT MAX(valuation_date) FROM ops_investment_overview_nav_daily),
       NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       product_count = EXCLUDED.product_count,
       nav_row_count = EXCLUDED.nav_row_count,
       underlying_row_count = EXCLUDED.underlying_row_count,
       nav_min_date = EXCLUDED.nav_min_date,
       nav_max_date = EXCLUDED.nav_max_date,
       refreshed_at = EXCLUDED.refreshed_at`,
    [productRows.length, navRows.length, underlyingRows.length],
  )
  await refreshCacheMetaFromDb()

  logProgress(
    `done — products=${productRows.length} nav=${navRows.length} underlying=${underlyingRows.length}`,
  )
  return {
    products: productRows.length,
    navRows: navRows.length,
    underlyingRows: underlyingRows.length,
  }
}

let cacheRefreshInFlight: Promise<{ products: number; navRows: number; underlyingRows: number }> | null = null
let populateCheckDone = false

/** Populate cache when empty (e.g. first deploy before nightly ETL has run). */
export async function ensureInvestmentOverviewCachePopulated(): Promise<void> {
  if (populateCheckDone) return
  populateCheckDone = true
  await ensureInvestmentOverviewCacheTables()
  const ready = await investmentOverviewCacheReady()
  if (!ready && !cacheRefreshInFlight) {
    cacheRefreshInFlight = refreshInvestmentOverviewCache()
      .catch((err) => {
        console.error("[investment-overview-cache] background refresh failed:", err)
        return { products: 0, navRows: 0, underlyingRows: 0 }
      })
      .finally(() => {
        cacheRefreshInFlight = null
      })
  }
}
