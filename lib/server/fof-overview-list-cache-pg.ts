/**
 * Precomputed FOF概览 list metrics — refreshed nightly after email NAV ETL
 * so the dashboard table loads from a single indexed table instead of per-row
 * multi-table NAV fallback scans.
 */

import { query, queryUnbounded } from "@/lib/db"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import {
  buildFofUnderlyingSummaryFrom,
  FOF_UNDERLYING_BEIAN_EXPR,
  fofUnderlyingShortExpr,
} from "@/lib/server/fof-underlying-query"
import { loadManagedUnderlyingMarketValueMap, loadManagedUnderlyingMarketValueMapFromCache, loadManagedUnderlyingValuationNavLookup, loadManagedUnderlyingNavHistoryIncremental, resolveManagedUnderlyingValuationNav } from "@/lib/server/managed-fof-underlying-pg"
import { isPlausibleRiskRatio } from "@/lib/fund-nav-metrics"
import { shanghaiTodayIsoDate } from "@/lib/server/china-trading-calendar"
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
import {
  atomicSwapListCacheTable,
  createListCacheStagingIndexes,
  ensureListCachePrimaryKey,
  prepareListCacheStagingTable,
} from "@/lib/server/list-cache-table-swap"

const LIVE_CACHE_TABLE = "ops_fof_overview_list_cache"
const STAGING_CACHE_TABLE = "ops_fof_overview_list_cache_staging"

// Unnamed indexes avoid clashing with live-table index names (schema-global in PG).
const STAGING_INDEX_SQLS = [
  `CREATE INDEX ON ${STAGING_CACHE_TABLE} (beian_hao)`,
  `CREATE INDEX ON ${STAGING_CACHE_TABLE} (product_name)`,
  `CREATE INDEX ON ${STAGING_CACHE_TABLE} (company_strategy_l1)`,
  `CREATE INDEX ON ${STAGING_CACHE_TABLE} (company_strategy_l2)`,
  `CREATE INDEX ON ${STAGING_CACHE_TABLE} (platform_strategy_l1)`,
  `CREATE INDEX ON ${STAGING_CACHE_TABLE} (platform_strategy_l2)`,
]

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_fof_overview_list_cache (
    fof_underlying_id     BIGINT      PRIMARY KEY,
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
    company_strategy_l2   TEXT,
    company_strategy_l3   TEXT,
    platform_strategy_l1  TEXT,
    platform_strategy_l2  TEXT,
    platform_strategy_l3  TEXT,
    team_tags             JSONB,
    as_of_date            DATE        NOT NULL,
    refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_fof_overview_list_cache_beian
    ON ops_fof_overview_list_cache (beian_hao);

  CREATE INDEX IF NOT EXISTS idx_fof_overview_list_cache_product
    ON ops_fof_overview_list_cache (product_name);

  CREATE INDEX IF NOT EXISTS idx_fof_overview_list_cache_company_strat
    ON ops_fof_overview_list_cache (company_strategy_l1);

  CREATE INDEX IF NOT EXISTS idx_fof_overview_list_cache_platform_strat
    ON ops_fof_overview_list_cache (platform_strategy_l1);
`

const MIGRATE_STMTS = [
  `ALTER TABLE ops_fof_overview_list_cache ADD COLUMN IF NOT EXISTS company_strategy_l1  TEXT`,
  `ALTER TABLE ops_fof_overview_list_cache ADD COLUMN IF NOT EXISTS company_strategy_l2  TEXT`,
  `ALTER TABLE ops_fof_overview_list_cache ADD COLUMN IF NOT EXISTS company_strategy_l3  TEXT`,
  `ALTER TABLE ops_fof_overview_list_cache ADD COLUMN IF NOT EXISTS platform_strategy_l1 TEXT`,
  `ALTER TABLE ops_fof_overview_list_cache ADD COLUMN IF NOT EXISTS platform_strategy_l2 TEXT`,
  `ALTER TABLE ops_fof_overview_list_cache ADD COLUMN IF NOT EXISTS platform_strategy_l3 TEXT`,
  `ALTER TABLE ops_fof_overview_list_cache ADD COLUMN IF NOT EXISTS team_tags             JSONB`,
  `ALTER TABLE ops_fof_overview_list_cache ADD COLUMN IF NOT EXISTS market_value          NUMERIC(20,2)`,
  `CREATE INDEX IF NOT EXISTS idx_fof_overview_list_cache_company_strat  ON ops_fof_overview_list_cache (company_strategy_l1)`,
  `CREATE INDEX IF NOT EXISTS idx_fof_overview_list_cache_company_strat_l2 ON ops_fof_overview_list_cache (company_strategy_l2)`,
  `CREATE INDEX IF NOT EXISTS idx_fof_overview_list_cache_platform_strat ON ops_fof_overview_list_cache (platform_strategy_l1)`,
  `CREATE INDEX IF NOT EXISTS idx_fof_overview_list_cache_platform_strat_l2 ON ops_fof_overview_list_cache (platform_strategy_l2)`,
]

let tableEnsured = false
let strategyL2L3Backfilled = false

/** Patch l2/l3 from type6 without a full metric rebuild (one-shot after migrate). */
async function backfillFofStrategyL2L3(): Promise<void> {
  if (strategyL2L3Backfilled) return
  await query(
    `UPDATE ops_fof_overview_list_cache c
     SET company_strategy_l2 = o.company_strategy_l2,
         company_strategy_l3 = o.company_strategy_l3,
         platform_strategy_l2 = o.platform_strategy_l2,
         platform_strategy_l3 = o.platform_strategy_l3
     FROM (
       SELECT DISTINCT ON (register_number)
         register_number,
         NULLIF(BTRIM(company_strategy_two), '')    AS company_strategy_l2,
         NULLIF(BTRIM(company_strategy_three), '')  AS company_strategy_l3,
         NULLIF(BTRIM(platform_strategy_two), '')   AS platform_strategy_l2,
         NULLIF(BTRIM(platform_strategy_three), '') AS platform_strategy_l3
       FROM type6_ops_team_full
       WHERE register_number IS NOT NULL
       ORDER BY register_number, updated_at DESC NULLS LAST, id DESC
     ) o
     WHERE UPPER(BTRIM(c.beian_hao)) = UPPER(BTRIM(o.register_number))
       AND (
         c.company_strategy_l2 IS DISTINCT FROM o.company_strategy_l2
         OR c.company_strategy_l3 IS DISTINCT FROM o.company_strategy_l3
         OR c.platform_strategy_l2 IS DISTINCT FROM o.platform_strategy_l2
         OR c.platform_strategy_l3 IS DISTINCT FROM o.platform_strategy_l3
       )`,
  ).catch(() => undefined)
  strategyL2L3Backfilled = true
}

export async function ensureFofOverviewListCacheTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  for (const stmt of MIGRATE_STMTS) {
    await query(stmt)
  }
  // CREATE TABLE IF NOT EXISTS does not add a missing PK on an existing table.
  await ensureListCachePrimaryKey(LIVE_CACHE_TABLE, "fof_underlying_id")
  await backfillFofStrategyL2L3()
  tableEnsured = true
}

function logProgress(msg: string, startedAt?: number): void {
  const elapsed = startedAt != null ? ` (+${((Date.now() - startedAt) / 1000).toFixed(1)}s)` : ""
  console.error(`[fof-overview-cache] ${new Date().toISOString()} ${msg}${elapsed}`)
}

type BaseProductRow = {
  fof_underlying_id: string
  product_name: string
  beian_hao: string | null
  short_name: string | null
  fallback_nav: string | null
  fallback_nav_date: string | Date | null
  fallback_return_pct: string | null
}

const FOF_CACHE_UPSERT_SUFFIX = `
  ON CONFLICT (fof_underlying_id) DO UPDATE SET
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
    company_strategy_l2  = EXCLUDED.company_strategy_l2,
    company_strategy_l3  = EXCLUDED.company_strategy_l3,
    platform_strategy_l1 = EXCLUDED.platform_strategy_l1,
    platform_strategy_l2 = EXCLUDED.platform_strategy_l2,
    platform_strategy_l3 = EXCLUDED.platform_strategy_l3,
    team_tags            = EXCLUDED.team_tags,
    market_value         = EXCLUDED.market_value,
    as_of_date           = EXCLUDED.as_of_date,
    refreshed_at         = NOW()`

export type FofOverviewListCacheRefreshOptions = {
  /**
   * Intraday mode: refresh NAV / 市值 / returns for products already in the cache and skip
   * every fuzzy fund-name join, including the one behind the 市值 map. Products missing from
   * the cache are left for the next full rebuild rather than resolved on the spot.
   */
  reuseResolvedIdentities?: boolean
}

/** Rebuild precomputed list cache for all FOF概览 rows (as of CURRENT_DATE). */
export async function refreshFofOverviewListCache(
  options: FofOverviewListCacheRefreshOptions = {},
): Promise<number> {
  const t0 = Date.now()
  await ensureEmailNavTable()
  await ensureFofOverviewListCacheTable()

  const reuseIdentities = options.reuseResolvedIdentities === true
  const asOfDate = new Date().toISOString().slice(0, 10)

  // Fast path: reuse beian codes from yesterday's cache; only run expensive lateral
  // joins for products not yet in cache. This makes rebuilds after the first run ~5s.
  logProgress("loading cached beian codes (fast path)…", t0)
  const cachedBeian = new Map<string, string | null>()
  const cachedBeianRows = await query<{ product_name: string; beian_hao: string | null }>(
    `SELECT product_name, beian_hao FROM ops_fof_overview_list_cache`,
  )
  for (const r of cachedBeianRows) cachedBeian.set(r.product_name, r.beian_hao)
  logProgress(`cached beian: ${cachedBeian.size} products`, t0)

  // Get the base product list without lateral joins first (fast).
  logProgress("loading product list from fof_underlying_summary…", t0)
  const baseRows = await query<{
    fof_underlying_id: string
    product_name: string
    fallback_nav: string | null
    fallback_nav_date: string | Date | null
    fallback_return_pct: string | null
  }>(
    `SELECT
       f.id::text AS fof_underlying_id,
       f.product_name,
       f.latest_unit_nav::text AS fallback_nav,
       f.latest_nav_date AS fallback_nav_date,
       f.latest_return_pct::text AS fallback_return_pct
     FROM fof_underlying_summary f
     WHERE f.product_name <> '合计'`,
  )
  logProgress(`found ${baseRows.length} products`, t0)

  // Products already in cache get beian without lateral joins. Intraday runs never pay for
  // the joins at all: an unseen product waits for the next full rebuild.
  const needBeianJoin = reuseIdentities
    ? []
    : baseRows.filter((r) => !cachedBeian.has(r.product_name))
  logProgress(
    `${baseRows.length - needBeianJoin.length} beian from cache, ${needBeianJoin.length} need lateral join…`,
    t0,
  )

  let joinedBeian = new Map<string, { beian_hao: string | null; short_name: string | null }>()
  if (needBeianJoin.length > 0) {
    logProgress(`running beian lateral joins for ${needBeianJoin.length} products (no timeout)…`, t0)
    const ids = needBeianJoin.map((r) => parseInt(r.fof_underlying_id, 10))
    const joinRows = await queryUnbounded<{ fof_underlying_id: string; beian_hao: string | null; short_name: string | null }>(
      `SELECT
         f.id::text AS fof_underlying_id,
         ${FOF_UNDERLYING_BEIAN_EXPR} AS beian_hao,
         ${fofUnderlyingShortExpr("f.product_name")} AS short_name
       ${buildFofUnderlyingSummaryFrom("f.product_name")}
       WHERE f.id = ANY($1::bigint[])`,
      [ids],
    )
    for (const r of joinRows) joinedBeian.set(r.fof_underlying_id, { beian_hao: r.beian_hao, short_name: r.short_name })
    logProgress(`lateral joins done`, t0)
  }

  const products: BaseProductRow[] = baseRows
    // Intraday runs resolve nothing, so a product missing from the cache would be written with
    // a null 备案号 and stay wrong until the nightly rebuild. Leave it out instead.
    .filter((r) => !reuseIdentities || cachedBeian.has(r.product_name))
    .map((r) => {
      const fromCache = cachedBeian.has(r.product_name)
      const fromJoin = joinedBeian.get(r.fof_underlying_id)
      const beian_hao = fromJoin?.beian_hao ?? (fromCache ? cachedBeian.get(r.product_name)! : null)
      const short_name = fromJoin?.short_name ?? r.product_name
      return { ...r, beian_hao, short_name }
    })

  // Prefer the cache-backed 市值 map whenever the overview cache is warm. The full
  // buildFofUnderlyingSummaryFrom path re-derives 备案号 via 250k-row fuzzy joins and
  // was the main reason nightly investment_pool_metrics hit the 30-minute timeout.
  logProgress("loading managed 市值 map…", t0)
  let managedMarketById =
    cachedBeian.size > 0
      ? await loadManagedUnderlyingMarketValueMapFromCache()
      : new Map<string, number>()
  if (managedMarketById.size === 0) {
    managedMarketById = await loadManagedUnderlyingMarketValueMap()
  }
  logProgress(`managed 市值 map loaded (${managedMarketById.size} ids)`, t0)

  logProgress("loading latest 估值表 NAV lookup…", t0)
  const valuationNavLookup = await loadManagedUnderlyingValuationNavLookup()
  logProgress("latest 估值表 NAV lookup loaded", t0)

  const identities = products.map((p) => ({
    beian_hao: p.beian_hao,
    product_name: p.product_name,
    short_name: p.short_name,
  }))
  logProgress("creating BatchNavResolver (email/type6/legacy NAV)…", t0)
  const navResolver = await BatchNavResolver.create(identities, asOfDate)
  logProgress("BatchNavResolver ready", t0)

  const valuationNavSince = addDays(asOfDate, 400)
  const historyTargets = products.map((p) => ({
    product_name: p.product_name,
    beian_hao: p.beian_hao,
  }))
  // Incremental history (persisted series + short delta) is correct for nightly too once
  // the history table is seeded; it falls back to a full scan automatically when empty.
  logProgress(
    `loading 估值表 NAV history (cached series + recent delta) since ${valuationNavSince}…`,
    t0,
  )
  const valuationNavHistory = await loadManagedUnderlyingNavHistoryIncremental(
    valuationNavSince,
    historyTargets,
  )
  logProgress(
    `估值表 NAV history loaded (codes=${valuationNavHistory.byCode.size}, names=${valuationNavHistory.byName.size})`,
    t0,
  )
  navResolver.setValuationNavHistory(valuationNavHistory.byCode, valuationNavHistory.byName)

  const beianHaos = products.map((p) => p.beian_hao).filter(Boolean) as string[]
  logProgress("loading strategy & risk metadata…", t0)
  const [riskFromInfo, opsStrategyMap, bflStrategyMap] = await Promise.all([
    loadPrivateFundRiskMetrics(beianHaos),
    loadOpsStrategyAndTags(beianHaos),
    loadBflStrategies(beianHaos),
  ])

  logProgress("strategy & risk metadata loaded", t0)
  // Full rebuild → staging then atomic swap; incremental upserts live in place.
  const writeTable = reuseIdentities ? LIVE_CACHE_TABLE : STAGING_CACHE_TABLE
  if (!reuseIdentities) {
    logProgress("preparing staging table for build-then-swap…", t0)
    await prepareListCacheStagingTable(
      LIVE_CACHE_TABLE,
      STAGING_CACHE_TABLE,
      "fof_underlying_id",
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
      logProgress(`computing metrics [${i + 1}/${products.length}]`, t0)
    }

    const identity = identities[i]
    const fallbackNav = row.fallback_nav != null ? parseFloat(row.fallback_nav) : null
    const fallbackDate = fmtDate(row.fallback_nav_date)
    const fallbackReturnPct =
      row.fallback_return_pct != null ? parseFloat(row.fallback_return_pct) / 100 : null

    const latest = navResolver.resolveAt(identity, asOfDate)
    let unitNav = latest?.nav ?? null
    let navDate = latest?.nav_date ?? null

    // When email / type6 / legacy NAV is missing, fall back to 估值表 市价 or 市值/份额.
    if (unitNav == null) {
      const valNav = resolveManagedUnderlyingValuationNav(
        row.product_name,
        row.beian_hao,
        valuationNavLookup,
      )
      if (valNav.unit_nav != null) {
        unitNav = valNav.unit_nav
        navDate = valNav.nav_date
      }
    }

    if (unitNav == null) {
      unitNav = fallbackNav
      navDate = fallbackDate
    }

    const returnPct =
      unitNav != null && navDate
        ? navResolver.calcDailyReturnPct(identity, unitNav, navDate, fallbackReturnPct)
        : null

    const returns =
      unitNav != null && navDate
        ? navResolver.calcPeriodReturns(identity, unitNav, navDate)
        : { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null }

    let sharpe_1y: number | null = null
    let calmar_1y: number | null = null
    const beian = (row.beian_hao ?? "").trim()
    const fromInfo = beian ? riskFromInfo.get(beian) : undefined
    if (
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
    const company_strategy_l2 = ops?.company_strategy_l2 ?? null
    const company_strategy_l3 = ops?.company_strategy_l3 ?? null
    const platform_strategy_l1 = ops?.platform_strategy_l1 ?? bflStrategy ?? null
    const platform_strategy_l2 = ops?.platform_strategy_l2 ?? null
    const platform_strategy_l3 = ops?.platform_strategy_l3 ?? null
    const team_tags = ops?.team_tags != null ? JSON.stringify(ops.team_tags) : null
    const managedMarketValue = managedMarketById.get(row.fof_underlying_id) ?? null

    placeholders.push(
      `($${pi}, $${pi + 1}, $${pi + 2}, $${pi + 3}, $${pi + 4}, $${pi + 5}, $${pi + 6}, $${pi + 7}, $${pi + 8}, $${pi + 9}, $${pi + 10}, $${pi + 11}, $${pi + 12}, $${pi + 13}, $${pi + 14}, $${pi + 15}, $${pi + 16}, $${pi + 17}, $${pi + 18}, $${pi + 19}, $${pi + 20}::jsonb, $${pi + 21}, $${pi + 22}::date, NOW())`,
    )
    values.push(
      row.fof_underlying_id,
      row.product_name,
      row.beian_hao,
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
      company_strategy_l2,
      company_strategy_l3,
      platform_strategy_l1,
      platform_strategy_l2,
      platform_strategy_l3,
      team_tags,
      clampPgNumeric(managedMarketValue, 20, 2),
      asOfDate,
    )
    pi += 23
  }

  logProgress(
    reuseIdentities ? "upserting cache table…" : "writing staging cache table…",
    t0,
  )
  await chunkedInsert(
    `INSERT INTO ${writeTable} (
       fof_underlying_id, product_name, beian_hao, short_name,
       unit_nav, nav_date, return_pct,
       ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
       sharpe_1y, calmar_1y,
       company_strategy_l1, company_strategy_l2, company_strategy_l3,
       platform_strategy_l1, platform_strategy_l2, platform_strategy_l3,
       team_tags,
       market_value,
       as_of_date, refreshed_at
     ) VALUES`,
    reuseIdentities ? FOF_CACHE_UPSERT_SUFFIX : "",
    placeholders,
    values,
    23,
  )

  // Force 最新涨跌幅 (+ tip NAV/date) to match each product's detail 平台数据 row.
  // For full rebuild, patch staging before swap so live never shows a half-built set.
  logProgress("syncing 最新涨跌幅 from detail 平台数据…", t0)
  const synced = await syncFofOverviewLatestFromDetail(
    products.map((p) => ({
      product_name: p.product_name,
      beian_hao: p.beian_hao,
      short_name: p.short_name,
    })),
    writeTable,
  )
  logProgress(`detail sync updated ${synced}/${products.length} rows`, t0)

  if (!reuseIdentities) {
    logProgress("indexing staging cache…", t0)
    await createListCacheStagingIndexes(STAGING_INDEX_SQLS)
    logProgress("swapping staging → live cache…", t0)
    await atomicSwapListCacheTable(LIVE_CACHE_TABLE, STAGING_CACHE_TABLE)
  }

  // Keep spreadsheet 市值 aligned with latest 在管估值表 so cleared underlyings
  // (e.g. sold out of all FOFs) leave 持仓中 even for readers of f.market_value.
  logProgress("syncing fof_underlying_summary.market_value from managed holdings…", t0)
  await syncFofUnderlyingSummaryMarketValues(managedMarketById)

  logProgress(`done — ${products.length} rows`, t0)
  return products.length
}

async function syncFofUnderlyingSummaryMarketValues(
  managedMarketById: Map<string, number>,
): Promise<void> {
  const ids = [...managedMarketById.keys()].map((id) => parseInt(id, 10)).filter((n) => Number.isFinite(n))
  const mvs = ids.map((id) => managedMarketById.get(String(id)) ?? 0)

  if (ids.length > 0) {
    await query(
      `UPDATE fof_underlying_summary AS f
       SET market_value = v.mv, updated_at = NOW()
       FROM (
         SELECT UNNEST($1::bigint[]) AS id, UNNEST($2::numeric[]) AS mv
       ) v
       WHERE f.id = v.id
         AND COALESCE(f.market_value, 0) IS DISTINCT FROM v.mv`,
      [ids, mvs],
    )
  }

  await query(
    `UPDATE fof_underlying_summary f
     SET market_value = 0, updated_at = NOW()
     WHERE f.product_name <> '合计'
       AND COALESCE(f.market_value, 0) <> 0
       AND NOT (f.id = ANY($1::bigint[]))`,
    [ids],
  )
}

type FofTipFromSeries = {
  nav_date: string
  unit_nav: number
  return_pct: number | null
}

/** Tip fields matching product-page 平台数据 (复权净值 day-over-day). */
function tipFieldsFromDetailSeries(
  series: Array<{
    price_date?: string
    nav?: string
    cumulative_nav?: string
    price_change?: string
  }>,
): FofTipFromSeries | null {
  if (series.length === 0) return null
  const latest = series[series.length - 1]
  const prev = series.length >= 2 ? series[series.length - 2] : null
  const navDate = latest.price_date?.slice(0, 10) ?? null
  const unitNav = parseFloat(String(latest.nav ?? ""))
  if (!navDate || !Number.isFinite(unitNav) || unitNav <= 0) return null

  // Prefer 复权净值 day-over-day (same as product page default 涨跌幅).
  let returnPct: number | null = null
  if (prev) {
    const currAdj = parseFloat(String(latest.cumulative_nav ?? ""))
    const prevAdj = parseFloat(String(prev.cumulative_nav ?? ""))
    if (
      Number.isFinite(currAdj)
      && Number.isFinite(prevAdj)
      && prevAdj > 0
      && currAdj > 0
    ) {
      returnPct = currAdj / prevAdj - 1
    }
  }
  if (returnPct == null) {
    const changeRaw = latest.price_change
    if (changeRaw != null && changeRaw !== "") {
      const fromUnit = parseFloat(String(changeRaw)) / 100
      if (Number.isFinite(fromUnit)) returnPct = fromUnit
    }
  }
  if (returnPct != null && !Number.isFinite(returnPct)) return null
  return { nav_date: navDate, unit_nav: unitNav, return_pct: returnPct }
}

async function writeFofCacheTipRow(
  targetTable: string,
  row: {
    product_name: string
    beian_hao: string | null
    nav_date: string
    unit_nav: number
    return_pct: number | null
  },
): Promise<boolean> {
  // Prefer product_name match (FOF tip must advance even when cached 备案号
  // differs slightly from the detail/email code, e.g. BSJ74B vs BSJ748 OCR).
  // Also allow a pure 备案号 match when the display name drifts.
  // Never regress tip date — stale detail-cache write-through used to pull FOF
  // tips backward (TG733C 08-05 → 07-15) and trap the detail page on a "fresh" miss.
  const result = await query<{ n: string }>(
    `WITH updated AS (
       UPDATE ${targetTable}
       SET unit_nav = $1,
           nav_date = $2::date,
           return_pct = $3,
           refreshed_at = NOW()
       WHERE (
            product_name = $4
            OR (
              $5::text IS NOT NULL
              AND NULLIF(BTRIM(COALESCE(beian_hao, '')), '') IS NOT NULL
              AND UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($5::text))
            )
          )
          AND (
            nav_date IS NULL
            OR nav_date < $2::date
            OR (
              nav_date = $2::date
              AND (
                unit_nav IS DISTINCT FROM $1
                OR return_pct IS DISTINCT FROM $3
              )
            )
          )
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM updated`,
    [
      clampPgNumeric(row.unit_nav, 16, 6),
      row.nav_date,
      clampPgNumeric(row.return_pct, 16, 8),
      row.product_name,
      row.beian_hao,
    ],
  )
  return parseInt(result[0]?.n ?? "0", 10) > 0
}

/**
 * Write-through: when product detail NAV is refreshed, also advance FOF底层
 * 最新净值日期 / 最新单位净值 / 最新涨跌幅 so the list does not lag the product page.
 * No-op when the fund is not in ops_fof_overview_list_cache.
 */
export async function patchFofOverviewListCacheTipFromSeries(opts: {
  product_name: string
  beian_hao?: string | null
  series: Array<{
    price_date?: string
    nav?: string
    cumulative_nav?: string
    price_change?: string
  }>
}): Promise<boolean> {
  const tip = tipFieldsFromDetailSeries(opts.series)
  if (!tip) return false
  try {
    await ensureFofOverviewListCacheTable()
    return await writeFofCacheTipRow(LIVE_CACHE_TABLE, {
      product_name: opts.product_name,
      beian_hao: (opts.beian_hao ?? "").trim() || null,
      ...tip,
    })
  } catch (err) {
    console.warn(
      `[fof-overview-cache] tip patch failed for ${opts.product_name}:`,
      err,
    )
    return false
  }
}

/**
 * Overwrite list-cache tip NAV / 最新涨跌幅 from the same series the fund detail
 * page shows. 最新涨跌幅 must match the product-page 平台数据 column under default
 * 净值类型=复权净值 (cumulative_nav ratio) — NOT LegacyNavRow.price_change, which is
 * unit-NAV based and diverges on TA/分红 dates (BSJ74B: −5.76% unit vs −3.92% 复权).
 */
export async function syncFofOverviewLatestFromDetail(
  products: Array<{
    product_name: string
    beian_hao: string | null
    short_name: string | null
  }>,
  targetTable: string = LIVE_CACHE_TABLE,
): Promise<number> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(targetTable)) {
    throw new Error(`invalid cache table: ${targetTable}`)
  }
  const { loadDetailNavSeriesFast } = await import("@/lib/server/fund-detail-fast-path")
  const { persistDetailNavSeries } = await import("@/lib/server/fund-detail-nav-cache-pg")
  let updated = 0
  const chunkSize = 8
  for (let i = 0; i < products.length; i += chunkSize) {
    const chunk = products.slice(i, i + chunkSize)
    const results = await Promise.all(
      chunk.map(async (p) => {
        const beian = (p.beian_hao ?? "").trim()
        try {
          // listHeader: null — do not chase the pre-sync cache tip (avoids short
          // BSJ74B 市价 leads). loadDetailNavSeriesFast still extends with FOF 估值表
          // when platform/email lags by VALUATION_EXTEND_MIN_GAP_DAYS+ (holdings-only).
          const series = await loadDetailNavSeriesFast({
            beian_hao: beian,
            product_name: p.product_name,
            short_name: p.short_name ?? "",
            listHeader: null,
          })
          if (series.length === 0) return null

          // Piggyback: persist the exact detail series for instant product pages.
          // skipFofListTip: this path writes the tip itself (staging or live).
          void persistDetailNavSeries({
            beian_hao: beian || null,
            product_name: p.product_name,
            short_name: p.short_name,
            nav_series: series,
            skipFofListTip: true,
          })

          const tip = tipFieldsFromDetailSeries(series)
          if (!tip) return null
          return {
            product_name: p.product_name,
            beian_hao: beian || null,
            ...tip,
          }
        } catch (err) {
          console.error(
            `[fof-overview-cache] detail sync failed for ${p.product_name}:`,
            err,
          )
          return null
        }
      }),
    )
    for (const row of results) {
      if (!row) continue
      const ok = await writeFofCacheTipRow(targetTable, row)
      if (ok) updated++
    }
  }
  return updated
}

/** True when the API can serve from the nightly precomputed cache. */
export function useFofOverviewListCache(cutoffRaw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)) return true
  const shanghaiToday = shanghaiTodayIsoDate()
  const utcToday = new Date().toISOString().slice(0, 10)
  // Same UTC vs Shanghai midnight trap as managed products — do not treat UTC
  // "today" as historical just because Shanghai already rolled over.
  return cutoffRaw >= shanghaiToday || cutoffRaw >= utcToday
}

let fofCacheAsOfMemo: { date: string | null; at: number } | null = null

async function getFofOverviewCacheAsOfDate(): Promise<string | null> {
  const now = Date.now()
  if (fofCacheAsOfMemo && now - fofCacheAsOfMemo.at < 60_000) {
    return fofCacheAsOfMemo.date
  }
  try {
    const rows = await query<{ d: string | null }>(
      `SELECT MAX(as_of_date)::text AS d FROM ops_fof_overview_list_cache`,
    )
    const date = rows[0]?.d ?? null
    fofCacheAsOfMemo = { date, at: now }
    return date
  } catch {
    return fofCacheAsOfMemo?.date ?? null
  }
}

/** Async gate: also allow cutoff >= cache snapshot as_of. */
export async function shouldUseFofOverviewListCache(cutoffRaw: string): Promise<boolean> {
  if (useFofOverviewListCache(cutoffRaw)) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)) return true
  const asOf = await getFofOverviewCacheAsOfDate()
  return Boolean(asOf && cutoffRaw >= asOf)
}

let cacheRefreshInFlight: Promise<number> | null = null

/** Populate cache when empty (e.g. first deploy before nightly ETL has run). */
export async function ensureFofOverviewListCachePopulated(): Promise<void> {
  await ensureFofOverviewListCacheTable()
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_fof_overview_list_cache`,
  )
  if (parseInt(rows[0]?.n ?? "0", 10) === 0 && !cacheRefreshInFlight) {
    // Production web sets RUN_BACKGROUND_JOBS=0 — never start a multi-minute rebuild here.
    if (process.env.RUN_BACKGROUND_JOBS === "0") {
      console.warn(
        "[fof-overview-cache] empty — not rebuilding in next-server (RUN_BACKGROUND_JOBS=0); start PM2 worker / nightly ETL",
      )
      return
    }
    // Do not block page loads on a multi-minute cache rebuild — refresh in background.
    cacheRefreshInFlight = refreshFofOverviewListCache()
      .catch((err) => {
        console.error("[fof-overview-cache] background refresh failed:", err)
        return 0
      })
      .finally(() => {
        cacheRefreshInFlight = null
      })
  }
}
