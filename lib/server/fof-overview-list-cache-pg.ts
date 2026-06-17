/**
 * Precomputed FOF概览 list metrics — refreshed nightly after email NAV ETL
 * so the dashboard table loads from a single indexed table instead of per-row
 * multi-table NAV fallback scans.
 */

import { query } from "@/lib/db"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import {
  buildFofUnderlyingSummaryFrom,
  FOF_UNDERLYING_BEIAN_EXPR,
  fofUnderlyingShortExpr,
} from "@/lib/server/fof-underlying-query"
import {
  loadEmailUnderlyingMarketLookup,
  resolveEmailUnderlyingMarket,
} from "@/lib/server/email-valuation-cache-enrich"
import {
  addDays,
  BatchNavResolver,
  chunkedInsert,
  computeOneYearRiskMetrics,
  fmtDate,
  loadBflStrategies,
  loadOpsStrategyAndTags,
  loadPrivateFundRiskMetrics,
} from "@/lib/server/list-cache-nav-batch"

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
    platform_strategy_l1  TEXT,
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
  `ALTER TABLE ops_fof_overview_list_cache ADD COLUMN IF NOT EXISTS platform_strategy_l1 TEXT`,
  `ALTER TABLE ops_fof_overview_list_cache ADD COLUMN IF NOT EXISTS team_tags             JSONB`,
  `ALTER TABLE ops_fof_overview_list_cache ADD COLUMN IF NOT EXISTS market_value          NUMERIC(20,2)`,
  `CREATE INDEX IF NOT EXISTS idx_fof_overview_list_cache_company_strat  ON ops_fof_overview_list_cache (company_strategy_l1)`,
  `CREATE INDEX IF NOT EXISTS idx_fof_overview_list_cache_platform_strat ON ops_fof_overview_list_cache (platform_strategy_l1)`,
]

let tableEnsured = false

export async function ensureFofOverviewListCacheTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  for (const stmt of MIGRATE_STMTS) {
    await query(stmt)
  }
  tableEnsured = true
}

function logProgress(msg: string): void {
  console.error(`[fof-overview-cache] ${new Date().toISOString()} ${msg}`)
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

/** Rebuild precomputed list cache for all FOF概览 rows (as of CURRENT_DATE). */
export async function refreshFofOverviewListCache(): Promise<number> {
  await ensureEmailNavTable()
  await ensureFofOverviewListCacheTable()

  const asOfDate = new Date().toISOString().slice(0, 10)
  logProgress("resolving product identities (may take 1–3 min)…")

  const products = await query<BaseProductRow>(
    `SELECT
       f.id::text AS fof_underlying_id,
       f.product_name,
       ${FOF_UNDERLYING_BEIAN_EXPR} AS beian_hao,
       ${fofUnderlyingShortExpr("f.product_name")} AS short_name,
       f.latest_unit_nav::text AS fallback_nav,
       f.latest_nav_date AS fallback_nav_date,
       f.latest_return_pct::text AS fallback_return_pct
     ${buildFofUnderlyingSummaryFrom("f.product_name")}
     WHERE f.product_name <> '合计'`,
  )

  logProgress(`found ${products.length} products — preloading NAV history…`)

  const emailUnderlyingMarket = await loadEmailUnderlyingMarketLookup()

  const identities = products.map((p) => ({
    beian_hao: p.beian_hao,
    product_name: p.product_name,
    short_name: p.short_name,
  }))
  const navResolver = await BatchNavResolver.create(identities, asOfDate)

  const beianHaos = products.map((p) => p.beian_hao).filter(Boolean) as string[]
  logProgress("loading strategy & risk metadata…")
  const [riskFromInfo, opsStrategyMap, bflStrategyMap] = await Promise.all([
    loadPrivateFundRiskMetrics(beianHaos),
    loadOpsStrategyAndTags(beianHaos),
    loadBflStrategies(beianHaos),
  ])

  await query(`DELETE FROM ops_fof_overview_list_cache`)
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
    const unitNav = latest?.nav ?? fallbackNav
    const navDate = latest?.nav_date ?? fallbackDate

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
    if (fromInfo?.sharpe_1y != null || fromInfo?.calmar_1y != null) {
      sharpe_1y = fromInfo.sharpe_1y
      calmar_1y = fromInfo.calmar_1y
    } else if (navDate) {
      const risk = computeOneYearRiskMetrics(
        navDate,
        navResolver.mergedHistory(identity, sinceRisk),
      )
      sharpe_1y = risk.sharpe_1y
      calmar_1y = risk.calmar_1y
    }

    const ops = beian ? opsStrategyMap.get(beian) : undefined
    const bflStrategy = beian ? bflStrategyMap.get(beian) : undefined
    const company_strategy_l1 = ops?.company_strategy_l1 ?? bflStrategy ?? null
    const platform_strategy_l1 = ops?.platform_strategy_l1 ?? bflStrategy ?? null
    const team_tags = ops?.team_tags != null ? JSON.stringify(ops.team_tags) : null
    const emailMarket = resolveEmailUnderlyingMarket(row.product_name, row.beian_hao, emailUnderlyingMarket)

    placeholders.push(
      `($${pi}, $${pi + 1}, $${pi + 2}, $${pi + 3}, $${pi + 4}, $${pi + 5}, $${pi + 6}, $${pi + 7}, $${pi + 8}, $${pi + 9}, $${pi + 10}, $${pi + 11}, $${pi + 12}, $${pi + 13}, $${pi + 14}, $${pi + 15}, $${pi + 16}::jsonb, $${pi + 17}, $${pi + 18}::date, NOW())`,
    )
    values.push(
      row.fof_underlying_id,
      row.product_name,
      row.beian_hao,
      row.short_name,
      unitNav,
      navDate,
      returnPct,
      returns.ret_1w,
      returns.ret_1m,
      returns.ret_3m,
      returns.ret_6m,
      returns.ret_1y,
      sharpe_1y,
      calmar_1y,
      company_strategy_l1,
      platform_strategy_l1,
      team_tags,
      emailMarket.market_value,
      asOfDate,
    )
    pi += 19
  }

  logProgress("writing cache table…")
  await chunkedInsert(
    `INSERT INTO ops_fof_overview_list_cache (
       fof_underlying_id, product_name, beian_hao, short_name,
       unit_nav, nav_date, return_pct,
       ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
       sharpe_1y, calmar_1y,
       company_strategy_l1, platform_strategy_l1, team_tags,
       market_value,
       as_of_date, refreshed_at
     ) VALUES`,
    "",
    placeholders,
    values,
    19,
  )

  logProgress(`done — ${products.length} rows`)
  return products.length
}

/** True when the API can serve from the nightly precomputed cache. */
export function useFofOverviewListCache(cutoffRaw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)) return true
  return cutoffRaw === new Date().toISOString().slice(0, 10)
}

/** Populate cache when empty (e.g. first deploy before nightly ETL has run). */
export async function ensureFofOverviewListCachePopulated(): Promise<void> {
  await ensureFofOverviewListCacheTable()
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_fof_overview_list_cache`,
  )
  if (parseInt(rows[0]?.n ?? "0", 10) === 0) {
    await refreshFofOverviewListCache()
  }
}
