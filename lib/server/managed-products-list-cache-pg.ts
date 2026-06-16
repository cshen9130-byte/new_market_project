/**
 * Precomputed 在管产品 list metrics — refreshed nightly after email NAV ETL
 * so the dashboard table loads from a single indexed table instead of per-row
 * multi-table NAV fallback scans.
 */

import { query } from "@/lib/db"
import { computeFundNavMetrics } from "@/lib/fund-nav-metrics"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import {
  loadEmailNavSeries,
  mergeNavSeriesWithEmail,
  type EmailNavPoint,
} from "@/lib/server/email-nav-query"
import {
  buildManagedProductsMetricSelectSql,
  managedShortExpr,
} from "@/lib/server/managed-products-nav-query"

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_managed_products_list_cache (
    managed_product_id  BIGINT      PRIMARY KEY,
    product_name        TEXT        NOT NULL,
    beian_hao           TEXT,
    short_name          TEXT,
    unit_nav            NUMERIC(16,6),
    nav_date            DATE,
    return_pct          NUMERIC(16,8),
    ret_1w              NUMERIC(16,8),
    ret_1m              NUMERIC(16,8),
    ret_3m              NUMERIC(16,8),
    ret_6m              NUMERIC(16,8),
    ret_1y              NUMERIC(16,8),
    sharpe_1y           NUMERIC(16,6),
    calmar_1y           NUMERIC(16,6),
    as_of_date          DATE        NOT NULL,
    refreshed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_managed_products_list_cache_beian
    ON ops_managed_products_list_cache (beian_hao);

  CREATE INDEX IF NOT EXISTS idx_managed_products_list_cache_product
    ON ops_managed_products_list_cache (product_name);
`

let tableEnsured = false

export async function ensureManagedProductsListCacheTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  tableEnsured = true
}

type RefreshRow = {
  managed_product_id: string
  product_name: string
  beian_hao: string | null
  short_name: string | null
  unit_nav: string | null
  nav_date: string | Date | null
  return_pct: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
}

type LegacyNavRow = {
  price_date: string
  nav: string
}

async function loadLegacyNavHistory(
  beianHao: string | null,
  productName: string,
  shortName: string | null,
): Promise<LegacyNavRow[]> {
  const short = (shortName ?? "").trim()
  try {
    return await query<LegacyNavRow>(
      `SELECT DISTINCT ON (price_date)
         price_date::text AS price_date,
         nav::text AS nav
       FROM (
         SELECT price_date, nav, 0 AS pri FROM private_fund_nav_group
         WHERE ($1 <> '' AND beian_hao = $1)
            OR product_name = $2
            OR ($3 <> '' AND product_name = $3)
         UNION ALL
         SELECT price_date, nav, 1 AS pri FROM private_fund_nav_group_hy
         WHERE ($1 <> '' AND beian_hao = $1)
            OR product_name = $2
            OR ($3 <> '' AND product_name = $3)
         UNION ALL
         SELECT price_date, nav, 2 AS pri FROM private_fund_nav
         WHERE ($1 <> '' AND beian_hao = $1)
            OR product_name = $2
            OR ($3 <> '' AND product_name = $3)
       ) nav_union
       WHERE nav IS NOT NULL AND nav > 0
       ORDER BY price_date ASC, pri ASC`,
      [beianHao ?? "", productName, short],
    )
  } catch {
    return []
  }
}

function computeOneYearRiskMetrics(
  navDate: string | null,
  legacyRows: LegacyNavRow[],
  emailRows: EmailNavPoint[],
): { sharpe_1y: number | null; calmar_1y: number | null } {
  const merged = mergeNavSeriesWithEmail(legacyRows, emailRows)
  if (merged.length < 2) return { sharpe_1y: null, calmar_1y: null }

  const refDate = navDate ? new Date(navDate) : new Date(merged[merged.length - 1].price_date)
  const cutoffTs = refDate.getTime() - 365 * 86400000

  const dates: string[] = []
  const values: number[] = []
  for (const row of merged) {
    const ts = new Date(row.price_date).getTime()
    const nav = parseFloat(row.nav)
    if (ts >= cutoffTs && ts <= refDate.getTime() && Number.isFinite(nav) && nav > 0) {
      dates.push(row.price_date)
      values.push(nav)
    }
  }

  if (dates.length < 20) return { sharpe_1y: null, calmar_1y: null }

  const metrics = computeFundNavMetrics({ dates, values })
  if (!metrics) return { sharpe_1y: null, calmar_1y: null }

  return {
    sharpe_1y: Number.isFinite(metrics.sharpe) ? Math.round(metrics.sharpe * 10000) / 10000 : null,
    calmar_1y: Number.isFinite(metrics.calmar) ? Math.round(metrics.calmar * 10000) / 10000 : null,
  }
}

/** Rebuild precomputed list cache for all 在管产品 rows (as of CURRENT_DATE). */
export async function refreshManagedProductsListCache(): Promise<number> {
  await ensureEmailNavTable()
  await ensureManagedProductsListCacheTable()

  const cutoffExpr = "CURRENT_DATE"
  const {
    baseFrom,
    emailNavJoins,
    histJoins,
    beianExpr,
    currentNavExpr,
    currentDateExpr,
    currentPctExpr,
  } = buildManagedProductsMetricSelectSql(cutoffExpr)

  const rows = await query<RefreshRow>(
    `SELECT
       m.id::text AS managed_product_id,
       m.product_name,
       ${beianExpr} AS beian_hao,
       ${managedShortExpr("m.product_name")} AS short_name,
       (${currentNavExpr})::text AS unit_nav,
       ${currentDateExpr} AS nav_date,
       (${currentPctExpr})::text AS return_pct,
       CASE WHEN h1w.nav IS NOT NULL AND h1w.nav <> 0
         THEN ((${currentNavExpr}) / h1w.nav - 1)::text END AS ret_1w,
       CASE WHEN h1m.nav IS NOT NULL AND h1m.nav <> 0
         THEN ((${currentNavExpr}) / h1m.nav - 1)::text END AS ret_1m,
       CASE WHEN h3m.nav IS NOT NULL AND h3m.nav <> 0
         THEN ((${currentNavExpr}) / h3m.nav - 1)::text END AS ret_3m,
       CASE WHEN h6m.nav IS NOT NULL AND h6m.nav <> 0
         THEN ((${currentNavExpr}) / h6m.nav - 1)::text END AS ret_6m,
       CASE WHEN h1y.nav IS NOT NULL AND h1y.nav <> 0
         THEN ((${currentNavExpr}) / h1y.nav - 1)::text END AS ret_1y
     ${baseFrom}
     ${emailNavJoins}
     ${histJoins}
     WHERE m.product_name <> '合计'`,
  )

  await query(`DELETE FROM ops_managed_products_list_cache`)

  if (rows.length === 0) return 0

  const asOfDate = new Date().toISOString().slice(0, 10)
  const values: unknown[] = []
  const placeholders: string[] = []
  let pi = 1

  for (const row of rows) {
    const navDate =
      row.nav_date instanceof Date
        ? row.nav_date.toISOString().slice(0, 10)
        : row.nav_date
          ? String(row.nav_date).slice(0, 10)
          : null

    const [legacyNav, emailNav] = await Promise.all([
      loadLegacyNavHistory(row.beian_hao, row.product_name, row.short_name),
      loadEmailNavSeries(row.beian_hao ?? "", row.product_name, row.short_name),
    ])
    const { sharpe_1y, calmar_1y } = computeOneYearRiskMetrics(navDate, legacyNav, emailNav)

    placeholders.push(
      `($${pi}, $${pi + 1}, $${pi + 2}, $${pi + 3}, $${pi + 4}, $${pi + 5}, $${pi + 6}, $${pi + 7}, $${pi + 8}, $${pi + 9}, $${pi + 10}, $${pi + 11}, $${pi + 12}, $${pi + 13}, $${pi + 14}::date, NOW())`,
    )
    values.push(
      row.managed_product_id,
      row.product_name,
      row.beian_hao,
      row.short_name,
      row.unit_nav != null ? parseFloat(row.unit_nav) : null,
      navDate,
      row.return_pct != null ? parseFloat(row.return_pct) : null,
      row.ret_1w != null ? parseFloat(row.ret_1w) : null,
      row.ret_1m != null ? parseFloat(row.ret_1m) : null,
      row.ret_3m != null ? parseFloat(row.ret_3m) : null,
      row.ret_6m != null ? parseFloat(row.ret_6m) : null,
      row.ret_1y != null ? parseFloat(row.ret_1y) : null,
      sharpe_1y,
      calmar_1y,
      asOfDate,
    )
    pi += 15
  }

  await query(
    `INSERT INTO ops_managed_products_list_cache (
       managed_product_id, product_name, beian_hao, short_name,
       unit_nav, nav_date, return_pct,
       ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
       sharpe_1y, calmar_1y, as_of_date, refreshed_at
     ) VALUES ${placeholders.join(", ")}`,
    values,
  )

  return rows.length
}

/** True when the API can serve from the nightly precomputed cache. */
export function useManagedProductsListCache(cutoffRaw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)) return true
  return cutoffRaw === new Date().toISOString().slice(0, 10)
}

/** Populate cache when empty (e.g. first deploy before nightly ETL has run). */
export async function ensureManagedProductsListCachePopulated(): Promise<void> {
  await ensureManagedProductsListCacheTable()
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_managed_products_list_cache`,
  )
  if (parseInt(rows[0]?.n ?? "0", 10) === 0) {
    await refreshManagedProductsListCache()
  }
}
