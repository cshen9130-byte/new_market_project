/**
 * Precomputed 在管产品 list metrics — refreshed nightly after email NAV ETL
 * so the dashboard table loads from a single indexed table instead of per-row
 * multi-table NAV fallback scans.
 */

import { query } from "@/lib/db"
import { isChinaTradingDay, shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import {
  buildManagedProductsFrom,
  MANAGED_PRODUCTS_BEIAN_EXPR,
} from "@/lib/server/fof-underlying-query"
import {
  addDays,
  BatchNavResolver,
  calcPeriodReturnsFromHistory,
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
  buildManagedProductListNavHistory,
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
import {
  atomicSwapListCacheTable,
  createListCacheStagingIndexes,
  ensureListCachePrimaryKey,
  prepareListCacheStagingTable,
} from "@/lib/server/list-cache-table-swap"

const LIVE_CACHE_TABLE = "ops_managed_products_list_cache"
const STAGING_CACHE_TABLE = "ops_managed_products_list_cache_staging"

// Unnamed indexes avoid clashing with live-table index names (schema-global in PG).
const STAGING_INDEX_SQLS = [
  `CREATE INDEX ON ${STAGING_CACHE_TABLE} (beian_hao)`,
  `CREATE INDEX ON ${STAGING_CACHE_TABLE} (product_name)`,
  `CREATE INDEX ON ${STAGING_CACHE_TABLE} (company_strategy_l1)`,
  `CREATE INDEX ON ${STAGING_CACHE_TABLE} (platform_strategy_l1)`,
]

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
  // CREATE TABLE IF NOT EXISTS does not add a missing PK on an existing table.
  await ensureListCachePrimaryKey(LIVE_CACHE_TABLE, "managed_product_id")
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

export type ManagedProductsListCacheRefreshOptions = {
  /**
   * Take 备案号 / 简称 from the existing cache rows instead of re-deriving them through the
   * fuzzy fund-name joins. Those joins cost ~77s of the ~85s full rebuild because they scan
   * private_fund_info (250k rows) re-evaluating regexes per row, yet they only change when a
   * product is added, removed or renamed. Intended for the intraday NAV/市值 refresh; the
   * nightly ETL and add/delete paths must still run a full rebuild.
   */
  reuseResolvedIdentities?: boolean
}

/**
 * Identity rows for the intraday refresh, keyed on 备案号 already resolved by a full rebuild.
 * Rows whose live product_name no longer matches the cached one are skipped: a rename means
 * the cached 备案号 can no longer be trusted, so those wait for the next full rebuild.
 */
async function loadResolvedProductRows(): Promise<BaseProductRow[]> {
  return await query<BaseProductRow>(
    `SELECT
       m.id::text            AS managed_product_id,
       m.product_name,
       c.beian_hao,
       c.short_name,
       m.latest_unit_nav::text   AS fallback_nav,
       m.latest_nav_date         AS fallback_nav_date,
       m.latest_return_pct::text AS fallback_return_pct
     FROM ops_managed_products_list_cache c
     JOIN managed_products m ON m.id = c.managed_product_id
     WHERE m.product_name <> '合计'
       AND BTRIM(m.product_name) = BTRIM(c.product_name)
     ORDER BY m.id`,
  )
}

const CACHE_UPSERT_SUFFIX = `
  ON CONFLICT (managed_product_id) DO UPDATE SET
    product_name         = EXCLUDED.product_name,
    beian_hao            = EXCLUDED.beian_hao,
    short_name           = EXCLUDED.short_name,
    unit_nav             = EXCLUDED.unit_nav,
    nav_date             = EXCLUDED.nav_date,
    return_pct           = EXCLUDED.return_pct,
    ret_1w               = EXCLUDED.ret_1w,
    ret_1m               = EXCLUDED.ret_1m,
    ret_3m               = EXCLUDED.ret_3m,
    ret_6m               = EXCLUDED.ret_6m,
    ret_1y               = EXCLUDED.ret_1y,
    sharpe_1y            = EXCLUDED.sharpe_1y,
    calmar_1y            = EXCLUDED.calmar_1y,
    company_strategy_l1  = EXCLUDED.company_strategy_l1,
    platform_strategy_l1 = EXCLUDED.platform_strategy_l1,
    team_tags            = EXCLUDED.team_tags,
    custody_balance      = EXCLUDED.custody_balance,
    net_asset_value      = EXCLUDED.net_asset_value,
    as_of_date           = EXCLUDED.as_of_date,
    refreshed_at         = NOW()`

/** Rebuild precomputed list cache for all 在管产品 rows (as of CURRENT_DATE). */
export async function refreshManagedProductsListCache(
  options: ManagedProductsListCacheRefreshOptions = {},
): Promise<number> {
  await ensureEmailNavTable()
  await ensureManagedProductsListCacheTable()

  const reuseIdentities = options.reuseResolvedIdentities === true
  const asOfDate = new Date().toISOString().slice(0, 10)

  let products: BaseProductRow[]
  if (reuseIdentities) {
    logProgress("reusing resolved identities from cache…")
    products = await loadResolvedProductRows()
  } else {
    logProgress("resolving product identities (may take 1–3 min)…")
    products = await query<BaseProductRow>(
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
  }

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

  // Full rebuild writes a staging table then atomically swaps so readers keep
  // the previous cache until the new one is ready. Incremental upserts in place.
  const writeTable = reuseIdentities ? LIVE_CACHE_TABLE : STAGING_CACHE_TABLE
  if (!reuseIdentities) {
    logProgress("preparing staging table for build-then-swap…")
    await prepareListCacheStagingTable(
      LIVE_CACHE_TABLE,
      STAGING_CACHE_TABLE,
      "managed_product_id",
    )
  }
  if (products.length === 0) {
    if (!reuseIdentities) {
      await query(`DROP TABLE IF EXISTS ${STAGING_CACHE_TABLE}`)
    }
    return 0
  }

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

    // resolveAt already applies trading-day + fallback rules — do not re-accept a
    // weekend managed_products.latest_nav_date when the resolver rejected it.
    const latest = navResolver.resolveAt(identity, asOfDate, fallbackNav, fallbackDate)
    let unitNav = latest?.nav ?? null
    let navDate = latest?.nav_date ?? null

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

    const emailMetrics = resolveEmailFundMetrics(
      row.product_name,
      beian || row.beian_hao,
      emailFundMetrics,
    )
    // 估值表 metrics often land before email NAV backfill (金舆守安一号 / SCN504).
    if (
      (unitNav == null || navDate == null)
      && emailMetrics.unit_nav != null
      && emailMetrics.valuation_date
      && isChinaTradingDay(emailMetrics.valuation_date)
    ) {
      unitNav = emailMetrics.unit_nav
      navDate = emailMetrics.valuation_date
    }

    // Final guard: never persist Sat/Sun / CN holiday as 最新净值日期.
    if (navDate && !isChinaTradingDay(navDate)) {
      unitNav = null
      navDate = null
      returnPct = null
    }

    let returns =
      unitNav != null && navDate
        ? navResolver.calcPeriodReturns(identity, unitNav, navDate)
        : { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null }

    // Prefer the same team/seed unit series used for list NAV (avoids contaminated
    // email/legacy merges, e.g. 金舆基石一号 近一周 −11.89% vs max DD −6.35%).
    if (unitNav != null && navDate) {
      const listHistory = buildManagedProductListNavHistory(
        beian || managedOverride?.beian_hao || "",
        managedOverride
          ? (postSeedByBeian.get(managedOverride.beian_hao) ?? [])
          : [],
        fullTeamByBeian.get(beian || managedOverride?.beian_hao || "") ?? [],
      )
      if (listHistory.length >= 2) {
        returns = calcPeriodReturnsFromHistory(listHistory, unitNav, navDate)
      }
    }

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

  logProgress(
    reuseIdentities
      ? "upserting cache table…"
      : "writing staging cache table…",
  )
  await chunkedInsert(
    `INSERT INTO ${writeTable} (
       managed_product_id, product_name, beian_hao, short_name,
       unit_nav, nav_date, return_pct,
       ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
       sharpe_1y, calmar_1y,
       company_strategy_l1, platform_strategy_l1, team_tags,
       custody_balance, net_asset_value,
       as_of_date, refreshed_at
     ) VALUES`,
    reuseIdentities ? CACHE_UPSERT_SUFFIX : "",
    placeholders,
    values,
    20,
  )

  if (!reuseIdentities) {
    logProgress("indexing staging cache…")
    await createListCacheStagingIndexes(STAGING_INDEX_SQLS)
    logProgress("swapping staging → live cache…")
    await atomicSwapListCacheTable(LIVE_CACHE_TABLE, STAGING_CACHE_TABLE)

    // Full rebuild only: warm detail NAV series for instant product pages.
    // Incremental path relies on email-touched refresh + write-through.
    logProgress("refreshing detail NAV series cache…")
    try {
      const { refreshDetailNavCacheForFunds } = await import(
        "@/lib/server/fund-detail-nav-cache-pg"
      )
      const detail = await refreshDetailNavCacheForFunds(
        products.map((p) => ({
          beian_hao: p.beian_hao,
          product_name: p.product_name,
          short_name: p.short_name,
        })),
        { label: "managed-detail-nav-cache" },
      )
      logProgress(
        `detail NAV cache updated ${detail.updated}/${products.length}` +
          (detail.failed ? ` (failed ${detail.failed})` : ""),
      )
    } catch (err) {
      console.error("[managed-products-list-cache] detail NAV cache refresh failed:", err)
    }
  }

  logProgress(`done — ${products.length} rows`)
  return products.length
}

/** True when the API can serve from the nightly precomputed cache. */
export function useManagedProductsListCache(cutoffRaw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)) return true
  const shanghaiToday = shanghaiTodayIsoDate()
  const utcToday = new Date().toISOString().slice(0, 10)
  // UI cutoffs often come from `toISOString()` (UTC). Around China midnight that
  // is still "yesterday" vs Shanghai today — must not force the historical
  // LATERAL slow path (pegs Postgres and freezes 在管产品).
  return cutoffRaw >= shanghaiToday || cutoffRaw >= utcToday
}

let managedCacheAsOfMemo: { date: string | null; at: number } | null = null

async function getManagedCacheAsOfDate(): Promise<string | null> {
  const now = Date.now()
  if (managedCacheAsOfMemo && now - managedCacheAsOfMemo.at < 60_000) {
    return managedCacheAsOfMemo.date
  }
  try {
    const rows = await query<{ d: string | null }>(
      `SELECT MAX(as_of_date)::text AS d FROM ops_managed_products_list_cache`,
    )
    const date = rows[0]?.d ?? null
    managedCacheAsOfMemo = { date, at: now }
    return date
  } catch {
    return managedCacheAsOfMemo?.date ?? null
  }
}

/**
 * Prefer this over {@link useManagedProductsListCache}: also serves cache when the
 * cutoff is not older than the snapshot the cache was built for (e.g. UI still
 * on yesterday while Shanghai has rolled past midnight).
 */
export async function shouldUseManagedProductsListCache(cutoffRaw: string): Promise<boolean> {
  if (useManagedProductsListCache(cutoffRaw)) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)) return true
  const asOf = await getManagedCacheAsOfDate()
  return Boolean(asOf && cutoffRaw >= asOf)
}

/** Populate cache when empty (e.g. first deploy before nightly ETL has run). */
let managedCacheRefreshInFlight: Promise<number> | null = null

function mayStartCacheRebuildInThisProcess(): boolean {
  // Production web sets RUN_BACKGROUND_JOBS=0 — heavy rebuilds belong in the PM2 worker.
  // Starting them here pegs next-server and freezes login / 在管产品 / FOF底层.
  return process.env.RUN_BACKGROUND_JOBS !== "0"
}

export async function ensureManagedProductsListCachePopulated(): Promise<void> {
  await ensureManagedProductsListCacheTable()
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_managed_products_list_cache`,
  )
  if (parseInt(rows[0]?.n ?? "0", 10) === 0 && !managedCacheRefreshInFlight) {
    if (!mayStartCacheRebuildInThisProcess()) {
      console.warn(
        "[managed-products-cache] empty — not rebuilding in next-server (RUN_BACKGROUND_JOBS=0); start PM2 worker / nightly ETL",
      )
      return
    }
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
