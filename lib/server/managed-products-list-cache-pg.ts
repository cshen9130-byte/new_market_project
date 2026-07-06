/**
 * Precomputed 在管产品 list metrics — refreshed nightly after email NAV ETL
 * so the dashboard table loads from a single indexed table instead of per-row
 * multi-table NAV fallback scans.
 */

import { query } from "@/lib/db"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import {
  buildManagedProductsFrom,
  MANAGED_PRODUCTS_BEIAN_EXPR,
} from "@/lib/server/fof-underlying-query"
import {
  addDays,
  BatchNavResolver,
  chunkedInsert,
  clampPgNumeric,
  computeOneYearRiskMetrics,
  fmtDate,
  loadBflStrategies,
  loadOpsStrategyAndTags,
  loadPrivateFundRiskMetrics,
} from "@/lib/server/list-cache-nav-batch"
import { resolveManagedProductBeian, lookupManagedProductOverride, MANAGED_PRODUCT_BEIAN_OVERRIDES } from "@/lib/server/managed-product-beian"
import {
  computeManagedProductOneYearRiskMetrics,
  isPlausibleRiskRatio,
  resolveManagedProductListNavAt,
  resolveTeamSeriesListNavAt,
} from "@/lib/server/managed-product-nav-seed"
import { managedShortExpr } from "@/lib/server/managed-products-nav-query"
import { loadManagedProductPostSeedExtensions, loadManagedProductTeamNavBatch } from "@/lib/server/team-nav-manage-pg"
import {
  loadEmailFundMetricsLookup,
  resolveEmailFundMetrics,
} from "@/lib/server/email-valuation-cache-enrich"

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_managed_products_list_cache (
    managed_product_id    BIGINT      PRIMARY KEY,
    product_name          TEXT        NOT NULL,
    beian_hao             TEXT,
    short_name            TEXT,
    unit_nav              NUMERIC(16,6),
    nav_date              DATE,
    return_pct            NUMERIC(16,8),
    ret_1w                NUMERIC(16,8),
    ret_1m                NUMERIC(16,8),
    ret_3m                NUMERIC(16,8),
    ret_6m                NUMERIC(16,8),
    ret_1y                NUMERIC(16,8),
    sharpe_1y             NUMERIC(16,6),
    calmar_1y             NUMERIC(16,6),
    company_strategy_l1   TEXT,
    platform_strategy_l1  TEXT,
    team_tags             JSONB,
    as_of_date            DATE        NOT NULL,
    refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_managed_products_list_cache_beian
    ON ops_managed_products_list_cache (beian_hao);

  CREATE INDEX IF NOT EXISTS idx_managed_products_list_cache_product
    ON ops_managed_products_list_cache (product_name);
`

const MIGRATE_STMTS = [
  `ALTER TABLE ops_managed_products_list_cache ADD COLUMN IF NOT EXISTS company_strategy_l1  TEXT`,
  `ALTER TABLE ops_managed_products_list_cache ADD COLUMN IF NOT EXISTS platform_strategy_l1 TEXT`,
  `ALTER TABLE ops_managed_products_list_cache ADD COLUMN IF NOT EXISTS team_tags             JSONB`,
  `ALTER TABLE ops_managed_products_list_cache ADD COLUMN IF NOT EXISTS custody_balance      NUMERIC(20,2)`,
  `ALTER TABLE ops_managed_products_list_cache ADD COLUMN IF NOT EXISTS net_asset_value      NUMERIC(20,2)`,
  `CREATE INDEX IF NOT EXISTS idx_managed_products_list_cache_company_strat  ON ops_managed_products_list_cache (company_strategy_l1)`,
  `CREATE INDEX IF NOT EXISTS idx_managed_products_list_cache_platform_strat ON ops_managed_products_list_cache (platform_strategy_l1)`,
]

let tableEnsured = false

export async function ensureManagedProductsListCacheTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  for (const stmt of MIGRATE_STMTS) {
    await query(stmt)
  }
  tableEnsured = true
}

function logProgress(msg: string): void {
  console.error(`[managed-products-cache] ${new Date().toISOString()} ${msg}`)
}

type BaseProductRow = {
  managed_product_id: string
  product_name: string
  beian_hao: string | null
  short_name: string | null
  fallback_nav: string | null
  fallback_nav_date: string | Date | null
  fallback_return_pct: string | null
}

/** Rebuild precomputed list cache for all 在管产品 rows (as of CURRENT_DATE). */
export async function refreshManagedProductsListCache(): Promise<number> {
  await ensureEmailNavTable()
  await ensureManagedProductsListCacheTable()

  const asOfDate = new Date().toISOString().slice(0, 10)
  logProgress("resolving product identities (may take 1–3 min)…")

  const products = await query<BaseProductRow>(
    `SELECT
       m.id::text AS managed_product_id,
       m.product_name,
       ${MANAGED_PRODUCTS_BEIAN_EXPR} AS beian_hao,
       ${managedShortExpr("m.product_name")} AS short_name,
       m.latest_unit_nav::text AS fallback_nav,
       m.latest_nav_date AS fallback_nav_date,
       m.latest_return_pct::text AS fallback_return_pct
     ${buildManagedProductsFrom("m.product_name")}
     WHERE m.product_name <> '合计'`,
  )

  logProgress(`found ${products.length} products — preloading NAV history…`)

  const emailFundMetrics = await loadEmailFundMetricsLookup()

  const identities = products.map((p) => ({
    beian_hao: resolveManagedProductBeian(p.product_name, p.beian_hao),
    product_name: p.product_name,
    short_name: p.short_name,
  }))
  const navResolver = await BatchNavResolver.create(identities, asOfDate)

  const overrideItems = Object.entries(MANAGED_PRODUCT_BEIAN_OVERRIDES).map(
    ([product_name, beian_hao]) => ({ product_name, beian_hao }),
  )
  const allTeamItems = products.map((p, i) => ({
    beian_hao: identities[i].beian_hao ?? p.beian_hao ?? "",
    product_name: p.product_name,
    short_name: p.short_name,
  })).filter((item) => item.beian_hao)
  const [postSeedByBeian, fullTeamByBeian] = await Promise.all([
    loadManagedProductPostSeedExtensions(Object.values(MANAGED_PRODUCT_BEIAN_OVERRIDES)),
    loadManagedProductTeamNavBatch(allTeamItems.length > 0 ? allTeamItems : overrideItems),
  ])

  const beianHaos = products.map((p) => p.beian_hao).filter(Boolean) as string[]
  logProgress("loading strategy & risk metadata…")
  const [riskFromInfo, opsStrategyMap, bflStrategyMap] = await Promise.all([
    loadPrivateFundRiskMetrics(beianHaos),
    loadOpsStrategyAndTags(beianHaos),
    loadBflStrategies(beianHaos),
  ])

  await query(`DELETE FROM ops_managed_products_list_cache`)
  if (products.length === 0) return 0

  const values: unknown[] = []
  const placeholders: string[] = []
  let pi = 1
  const sinceRisk = addDays(asOfDate, 400)

  for (let i = 0; i < products.length; i++) {
    const row = products[i]
    if (i === 0 || (i + 1) % 50 === 0 || i + 1 === products.length) {
      logProgress(`computing metrics [${i + 1}/${products.length}]`)
    }

    const identity = identities[i]
    const fallbackNav = row.fallback_nav != null ? parseFloat(row.fallback_nav) : null
    const fallbackDate = fmtDate(row.fallback_nav_date)
    const fallbackReturnPct =
      row.fallback_return_pct != null ? parseFloat(row.fallback_return_pct) / 100 : null

    const latest = navResolver.resolveAt(identity, asOfDate, fallbackNav, fallbackDate)
    let unitNav = latest?.nav ?? fallbackNav
    let navDate = latest?.nav_date ?? fallbackDate

    let returnPct =
      unitNav != null && navDate
        ? navResolver.calcDailyReturnPct(identity, unitNav, navDate, fallbackReturnPct)
        : null

    const beian = resolveManagedProductBeian(row.product_name, row.beian_hao) ?? ""
    const managedOverride =
      lookupManagedProductOverride(row.product_name)
      ?? (beian ? lookupManagedProductOverride(beian) : null)

    if (managedOverride) {
      const listPoint =
        resolveManagedProductListNavAt(
          managedOverride.beian_hao,
          asOfDate,
          postSeedByBeian.get(managedOverride.beian_hao) ?? [],
        )
        ?? resolveTeamSeriesListNavAt(
          fullTeamByBeian.get(managedOverride.beian_hao) ?? [],
          asOfDate,
        )
      if (listPoint) {
        unitNav = parseFloat(listPoint.nav)
        navDate = listPoint.nav_date
        if (listPoint.prev_nav != null) {
          const prev = parseFloat(listPoint.prev_nav)
          if (Number.isFinite(unitNav) && Number.isFinite(prev) && prev !== 0) {
            returnPct = unitNav / prev - 1
          }
        }
      }
    } else if (beian) {
      const listPoint = resolveTeamSeriesListNavAt(fullTeamByBeian.get(beian) ?? [], asOfDate)
      if (listPoint) {
        unitNav = parseFloat(listPoint.nav)
        navDate = listPoint.nav_date
        if (listPoint.prev_nav != null) {
          const prev = parseFloat(listPoint.prev_nav)
          if (Number.isFinite(unitNav) && Number.isFinite(prev) && prev !== 0) {
            returnPct = unitNav / prev - 1
          }
        }
      }
    }

    const returns =
      unitNav != null && navDate
        ? navResolver.calcPeriodReturns(identity, unitNav, navDate)
        : { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null }

    let sharpe_1y: number | null = null
    let calmar_1y: number | null = null
    const fromInfo = beian ? riskFromInfo.get(beian) : undefined

    if (managedOverride && navDate) {
      const risk = computeManagedProductOneYearRiskMetrics(
        managedOverride.beian_hao,
        navDate,
        navResolver.mergedHistoryForRiskMetrics(identity, sinceRisk),
      )
      sharpe_1y = risk.sharpe_1y
      calmar_1y = risk.calmar_1y
    } else if (
      isPlausibleRiskRatio(fromInfo?.sharpe_1y)
      && isPlausibleRiskRatio(fromInfo?.calmar_1y)
    ) {
      sharpe_1y = fromInfo!.sharpe_1y
      calmar_1y = fromInfo!.calmar_1y
    } else if (navDate) {
      const risk = computeOneYearRiskMetrics(
        navDate,
        navResolver.mergedHistoryForRiskMetrics(identity, sinceRisk),
      )
      sharpe_1y = isPlausibleRiskRatio(risk.sharpe_1y) ? risk.sharpe_1y : null
      calmar_1y = isPlausibleRiskRatio(risk.calmar_1y) ? risk.calmar_1y : null
    }

    const ops = beian ? opsStrategyMap.get(beian) : undefined
    const bflStrategy = beian ? bflStrategyMap.get(beian) : undefined
    const company_strategy_l1 = ops?.company_strategy_l1 ?? bflStrategy ?? null
    const platform_strategy_l1 = ops?.platform_strategy_l1 ?? null
    const team_tags = ops?.team_tags != null ? JSON.stringify(ops.team_tags) : null
    const emailMetrics = resolveEmailFundMetrics(row.product_name, row.beian_hao, emailFundMetrics)

    placeholders.push(
      `($${pi}, $${pi + 1}, $${pi + 2}, $${pi + 3}, $${pi + 4}, $${pi + 5}, $${pi + 6}, $${pi + 7}, $${pi + 8}, $${pi + 9}, $${pi + 10}, $${pi + 11}, $${pi + 12}, $${pi + 13}, $${pi + 14}, $${pi + 15}, $${pi + 16}::jsonb, $${pi + 17}, $${pi + 18}, $${pi + 19}::date, NOW())`,
    )
    values.push(
      row.managed_product_id,
      row.product_name,
      resolveManagedProductBeian(row.product_name, row.beian_hao),
      row.short_name,
      clampPgNumeric(unitNav, 16, 6),
      navDate,
      clampPgNumeric(returnPct, 16, 8),
      clampPgNumeric(returns.ret_1w, 16, 8),
      clampPgNumeric(returns.ret_1m, 16, 8),
      clampPgNumeric(returns.ret_3m, 16, 8),
      clampPgNumeric(returns.ret_6m, 16, 8),
      clampPgNumeric(returns.ret_1y, 16, 8),
      clampPgNumeric(sharpe_1y, 16, 6),
      clampPgNumeric(calmar_1y, 16, 6),
      company_strategy_l1,
      platform_strategy_l1,
      team_tags,
      clampPgNumeric(emailMetrics.custody_balance, 20, 2),
      clampPgNumeric(emailMetrics.net_asset_value, 20, 2),
      asOfDate,
    )
    pi += 20
  }

  logProgress("writing cache table…")
  await chunkedInsert(
    `INSERT INTO ops_managed_products_list_cache (
       managed_product_id, product_name, beian_hao, short_name,
       unit_nav, nav_date, return_pct,
       ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
       sharpe_1y, calmar_1y,
       company_strategy_l1, platform_strategy_l1, team_tags,
       custody_balance, net_asset_value,
       as_of_date, refreshed_at
     ) VALUES`,
    "",
    placeholders,
    values,
    20,
  )

  logProgress(`done — ${products.length} rows`)
  return products.length
}

/** True when the API can serve from the nightly precomputed cache. */
export function useManagedProductsListCache(cutoffRaw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)) return true
  return cutoffRaw === new Date().toISOString().slice(0, 10)
}

/** Populate cache when empty (e.g. first deploy before nightly ETL has run). */
let managedCacheRefreshInFlight: Promise<number> | null = null

export async function ensureManagedProductsListCachePopulated(): Promise<void> {
  await ensureManagedProductsListCacheTable()
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_managed_products_list_cache`,
  )
  if (parseInt(rows[0]?.n ?? "0", 10) === 0 && !managedCacheRefreshInFlight) {
    managedCacheRefreshInFlight = refreshManagedProductsListCache()
      .catch((err) => {
        console.error("[managed-products-cache] background refresh failed:", err)
        return 0
      })
      .finally(() => {
        managedCacheRefreshInFlight = null
      })
  }
}
