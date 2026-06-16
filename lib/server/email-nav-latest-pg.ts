/**
 * Precomputed latest email NAV per fund scope (managed products, etc.).
 * Refreshed after email extraction ETL so list APIs avoid per-row lateral scans.
 */

import { query } from "@/lib/db"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import {
  buildEmailNavLatestExprs,
  buildEmailNavLatestJoins,
} from "@/lib/server/email-nav-query"
import { refreshFofOverviewListCache } from "@/lib/server/fof-overview-list-cache-pg"
import { refreshManagedProductsListCache } from "@/lib/server/managed-products-list-cache-pg"
import {
  buildManagedProductsFrom,
  FOF_UNDERLYING_BEIAN_EXPR,
  fofUnderlyingShortExpr,
} from "@/lib/server/fof-underlying-query"

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_email_nav_fund_latest (
    scope_type   TEXT        NOT NULL,
    scope_id     TEXT        NOT NULL,
    product_name TEXT        NOT NULL,
    beian_hao    TEXT,
    unit_nav     NUMERIC(16,6),
    nav_date     DATE,
    return_pct   NUMERIC(16,8),
    nav_source   TEXT,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope_type, scope_id)
  );

  CREATE INDEX IF NOT EXISTS idx_email_nav_fund_latest_beian
    ON ops_email_nav_fund_latest (beian_hao);

  CREATE INDEX IF NOT EXISTS idx_email_nav_fund_latest_product
    ON ops_email_nav_fund_latest (product_name);
`

let tableEnsured = false

export async function ensureEmailNavFundLatestTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  tableEnsured = true
}

/** Rebuild precomputed latest NAV for all 在管产品 rows (as of CURRENT_DATE). */
export async function refreshManagedProductsEmailNavLatest(): Promise<number> {
  await ensureEmailNavTable()
  await ensureEmailNavFundLatestTable()

  const beianExpr = FOF_UNDERLYING_BEIAN_EXPR
  const productExpr = "m.product_name"
  const shortExpr = fofUnderlyingShortExpr(productExpr)
  const cutoffExpr = "CURRENT_DATE"
  const fallbackNavExpr = "m.latest_unit_nav::numeric"
  const fallbackDateExpr = "m.latest_nav_date"
  const fallbackPctExpr = "m.latest_return_pct::numeric / 100"
  const emailNavJoins = buildEmailNavLatestJoins(beianExpr, productExpr, shortExpr, cutoffExpr)
  const { navExpr, dateExpr, pctExpr } = buildEmailNavLatestExprs(
    fallbackNavExpr,
    fallbackDateExpr,
    fallbackPctExpr,
  )

  await query(`DELETE FROM ops_email_nav_fund_latest WHERE scope_type = 'managed_product'`)

  const rows = await query<{ n: string }>(
    `WITH inserted AS (
       INSERT INTO ops_email_nav_fund_latest
         (scope_type, scope_id, product_name, beian_hao, unit_nav, nav_date, return_pct, nav_source)
       SELECT
         'managed_product',
         m.id::text,
         m.product_name,
         ${beianExpr},
         (${navExpr})::numeric,
         (${dateExpr})::date,
         (${pctExpr})::numeric,
         CASE WHEN en.nav IS NOT NULL THEN 'email' ELSE 'table_fallback' END
       ${buildManagedProductsFrom(productExpr)}
       ${emailNavJoins}
       WHERE m.product_name <> '合计'
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
  )

  return parseInt(rows[0]?.n ?? "0", 10)
}

/** Refresh list caches and sync ops_email_nav_fund_latest from cache (fast). */
export async function refreshManagedProductsNavAndListCache(): Promise<{
  emailNavLatest: number
  listCache: number
  fofOverviewListCache: number
}> {
  const listCache = await refreshManagedProductsListCache()
  const fofOverviewListCache = await refreshFofOverviewListCache()

  await ensureEmailNavFundLatestTable()
  await query(`DELETE FROM ops_email_nav_fund_latest WHERE scope_type = 'managed_product'`)
  const synced = await query<{ n: string }>(
    `WITH inserted AS (
       INSERT INTO ops_email_nav_fund_latest
         (scope_type, scope_id, product_name, beian_hao, unit_nav, nav_date, return_pct, nav_source)
       SELECT
         'managed_product',
         managed_product_id::text,
         product_name,
         beian_hao,
         unit_nav,
         nav_date,
         return_pct,
         'list_cache'
       FROM ops_managed_products_list_cache
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
  )
  const emailNavLatest = parseInt(synced[0]?.n ?? "0", 10)
  return { emailNavLatest, listCache, fofOverviewListCache }
}
