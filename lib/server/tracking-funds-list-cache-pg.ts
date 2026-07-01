/**
 * Precomputed 跟踪产品 list metrics — refreshed nightly after email NAV ETL
 * so the dashboard table loads from a single indexed table instead of per-row
 * multi-table NAV fallback scans.
 */

import { query } from "@/lib/db"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import {
  addDays,
  BatchNavResolver,
  chunkedInsert,
  clampPgNumeric,
  computeOneYearRiskMetrics,
  loadPrivateFundRiskMetrics,
  NAV_HISTORY_LOOKBACK_DAYS,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"
import { isPlausibleRiskRatio } from "@/lib/fund-nav-metrics"

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_tracking_funds_list_cache (
    beian_hao             TEXT        PRIMARY KEY,
    product_name          TEXT        NOT NULL,
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
    raw_strategy_json     JSONB,
    team_tags             JSONB,
    as_of_date            DATE        NOT NULL,
    refreshed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_tracking_funds_list_cache_product
    ON ops_tracking_funds_list_cache (product_name);

  CREATE INDEX IF NOT EXISTS idx_tracking_funds_list_cache_company_l1
    ON ops_tracking_funds_list_cache (company_strategy_l1);

  CREATE INDEX IF NOT EXISTS idx_tracking_funds_list_cache_platform_l1
    ON ops_tracking_funds_list_cache (platform_strategy_l1);
`

const IDENTITY_SQL = `
  WITH all_funds AS (
    SELECT beian_hao, product_name, short_name, 1 AS priority
    FROM private_fund_info_bfl WHERE beian_hao IS NOT NULL
    UNION ALL
    SELECT register_number, product_name, NULL::text, 2
    FROM tracking_pool WHERE register_number IS NOT NULL
    UNION ALL
    SELECT register_number, product_name, NULL::text, 3
    FROM selected_pool WHERE register_number IS NOT NULL
    UNION ALL
    SELECT register_number, product_name, NULL::text, 4
    FROM core_pool WHERE register_number IS NOT NULL
    UNION ALL
    SELECT register_number, product_name, NULL::text, 5
    FROM hy_tracking_pool WHERE register_number IS NOT NULL
    UNION ALL
    SELECT register_number, product_name, NULL::text, 6
    FROM fof_mom_tracking WHERE register_number IS NOT NULL
    UNION ALL
    SELECT register_number, COALESCE(fund_short_name, fund_name), fund_name, 7
    FROM type6_ops_team_full WHERE register_number IS NOT NULL
    UNION ALL
    SELECT register_number, product_name, NULL::text, 8
    FROM user_custom_pool WHERE register_number IS NOT NULL
  ),
  deduped AS (
    SELECT DISTINCT ON (beian_hao) beian_hao, product_name, short_name
    FROM all_funds
    ORDER BY beian_hao, priority ASC
  )
  SELECT
    d.beian_hao,
    d.product_name,
    COALESCE(d.short_name, bfl.short_name) AS short_name,
    bfl.raw_strategy
  FROM deduped d
  LEFT JOIN private_fund_info_bfl bfl ON bfl.beian_hao = d.beian_hao
`

let tableEnsured = false

export async function ensureTrackingFundsListCacheTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  tableEnsured = true
}

function logProgress(msg: string): void {
  console.error(`[tracking-funds-cache] ${new Date().toISOString()} ${msg}`)
}

type BaseFundRow = {
  beian_hao: string
  product_name: string
  short_name: string | null
  raw_strategy: string | null
}

type OpsStrategyRow = {
  register_number: string
  company_strategy_l1: string | null
  company_strategy_l2: string | null
  company_strategy_l3: string | null
  platform_strategy_l1: string | null
  platform_strategy_l2: string | null
  platform_strategy_l3: string | null
  team_tags: unknown
}

function parseRawStrategyJson(raw: string | null): object | null {
  const text = (raw ?? "").trim()
  if (!text) return null
  try {
    if (text.startsWith('{"')) return JSON.parse(text) as object
    if (text.startsWith("{'")) return JSON.parse(text.replace(/'/g, '"')) as object
  } catch {
    /* ignore malformed strategy JSON */
  }
  return null
}

function strategyFromRawJson(
  raw: object | null,
  side: "platform" | "company",
  level: "one" | "two" | "three",
): string | null {
  if (!raw || typeof raw !== "object") return null
  const sideObj = (raw as Record<string, unknown>)[side]
  if (!sideObj || typeof sideObj !== "object") return null
  const key = level === "one" ? "strategy_one" : level === "two" ? "strategy_two" : "strategy_three"
  const val = (sideObj as Record<string, unknown>)[key]
  if (typeof val !== "string") return null
  const trimmed = val.trim()
  return trimmed || null
}

async function loadOpsFullStrategy(
  beianHaos: string[],
): Promise<Map<string, OpsStrategyRow>> {
  const codes = beianHaos.map((b) => b.trim()).filter(Boolean)
  const out = new Map<string, OpsStrategyRow>()
  if (codes.length === 0) return out

  const rows = await query<OpsStrategyRow>(
    `SELECT DISTINCT ON (register_number)
       register_number,
       NULLIF(BTRIM(company_strategy_one), '')   AS company_strategy_l1,
       NULLIF(BTRIM(company_strategy_two), '')   AS company_strategy_l2,
       NULLIF(BTRIM(company_strategy_three), '') AS company_strategy_l3,
       NULLIF(BTRIM(platform_strategy_one), '')  AS platform_strategy_l1,
       NULLIF(BTRIM(platform_strategy_two), '')  AS platform_strategy_l2,
       NULLIF(BTRIM(platform_strategy_three), '') AS platform_strategy_l3,
       CASE WHEN jsonb_typeof(tag->'company') = 'array'
            THEN tag->'company' ELSE '[]'::jsonb END AS team_tags
     FROM type6_ops_team_full
     WHERE register_number = ANY($1::text[])
     ORDER BY register_number, updated_at DESC NULLS LAST, id DESC`,
    [codes],
  )
  for (const row of rows) out.set(row.register_number, row)
  return out
}

/** Rebuild precomputed list cache for all tracked funds (as of CURRENT_DATE). */
export async function refreshTrackingFundsListCache(): Promise<number> {
  await ensureEmailNavTable()
  await ensureTrackingFundsListCacheTable()

  const asOfDate = new Date().toISOString().slice(0, 10)
  logProgress("loading fund identities…")

  const funds = await query<BaseFundRow>(IDENTITY_SQL)
  logProgress(`found ${funds.length} funds — preloading NAV history…`)

  const identities = funds.map((f) => ({
    beian_hao: f.beian_hao,
    product_name: f.product_name,
    short_name: f.short_name,
  }))
  const navResolver = await BatchNavResolver.create(identities, asOfDate)

  const beianHaos = funds.map((f) => f.beian_hao)
  logProgress("loading strategy & risk metadata…")
  const [riskFromInfo, opsStrategyMap] = await Promise.all([
    loadPrivateFundRiskMetrics(beianHaos),
    loadOpsFullStrategy(beianHaos),
  ])

  await query(`DELETE FROM ops_tracking_funds_list_cache`)
  if (funds.length === 0) return 0

  const values: unknown[] = []
  const placeholders: string[] = []
  let pi = 1

  for (let i = 0; i < funds.length; i++) {
    const row = funds[i]
    if (i === 0 || (i + 1) % 100 === 0 || i + 1 === funds.length) {
      logProgress(`computing metrics [${i + 1}/${funds.length}]`)
    }

    const identity = identities[i]
    const latest = navResolver.resolveAt(identity, asOfDate)
    const unitNav = latest?.nav ?? null
    const navDate = latest?.nav_date ?? null

    const returnPct =
      unitNav != null && navDate
        ? navResolver.calcDailyReturnPct(identity, unitNav, navDate, null)
        : null

    const returns =
      unitNav != null && navDate
        ? navResolver.calcPeriodReturns(identity, unitNav, navDate)
        : { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null }

    let sharpe_1y: number | null = null
    let calmar_1y: number | null = null
    const fromInfo = riskFromInfo.get(row.beian_hao)
    if (
      isPlausibleRiskRatio(fromInfo?.sharpe_1y)
      && isPlausibleRiskRatio(fromInfo?.calmar_1y)
    ) {
      sharpe_1y = fromInfo!.sharpe_1y
      calmar_1y = fromInfo!.calmar_1y
    } else if (navDate) {
      const risk = computeOneYearRiskMetrics(
        navDate,
        navResolver.mergedHistoryForRiskMetrics(
          identity,
          addDays(navDate, NAV_HISTORY_LOOKBACK_DAYS),
        ),
      )
      sharpe_1y = isPlausibleRiskRatio(risk.sharpe_1y) ? risk.sharpe_1y : null
      calmar_1y = isPlausibleRiskRatio(risk.calmar_1y) ? risk.calmar_1y : null
    }

    const ops = opsStrategyMap.get(row.beian_hao)
    const rawStrategyJson = parseRawStrategyJson(row.raw_strategy)
    const teamTags = ops?.team_tags != null ? JSON.stringify(ops.team_tags) : null
    const companyL1 = ops?.company_strategy_l1 ?? strategyFromRawJson(rawStrategyJson, "company", "one")
    const companyL2 = ops?.company_strategy_l2 ?? strategyFromRawJson(rawStrategyJson, "company", "two")
    const companyL3 = ops?.company_strategy_l3 ?? strategyFromRawJson(rawStrategyJson, "company", "three")
    const platformL1 = ops?.platform_strategy_l1 ?? strategyFromRawJson(rawStrategyJson, "platform", "one")
    const platformL2 = ops?.platform_strategy_l2 ?? strategyFromRawJson(rawStrategyJson, "platform", "two")
    const platformL3 = ops?.platform_strategy_l3 ?? strategyFromRawJson(rawStrategyJson, "platform", "three")

    placeholders.push(
      `($${pi}, $${pi + 1}, $${pi + 2}, $${pi + 3}, $${pi + 4}, $${pi + 5}, $${pi + 6}, $${pi + 7}, $${pi + 8}, $${pi + 9}, $${pi + 10}, $${pi + 11}, $${pi + 12}, $${pi + 13}, $${pi + 14}, $${pi + 15}, $${pi + 16}, $${pi + 17}, $${pi + 18}, $${pi + 19}::jsonb, $${pi + 20}::jsonb, $${pi + 21}::date, NOW())`,
    )
    values.push(
      row.beian_hao,
      row.product_name,
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
      companyL1,
      companyL2,
      companyL3,
      platformL1,
      platformL2,
      platformL3,
      rawStrategyJson != null ? JSON.stringify(rawStrategyJson) : null,
      teamTags,
      asOfDate,
    )
    pi += 22
  }

  logProgress("writing cache table…")
  await chunkedInsert(
    `INSERT INTO ops_tracking_funds_list_cache (
       beian_hao, product_name, short_name,
       unit_nav, nav_date, return_pct,
       ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
       sharpe_1y, calmar_1y,
       company_strategy_l1, company_strategy_l2, company_strategy_l3,
       platform_strategy_l1, platform_strategy_l2, platform_strategy_l3,
       raw_strategy_json, team_tags,
       as_of_date, refreshed_at
     ) VALUES`,
    "",
    placeholders,
    values,
    22,
  )

  logProgress(`done — ${funds.length} rows`)
  return funds.length
}

/** Backfill cache rows that were stored with null NAV (stale platform data outside the default window). */
export async function patchTrackingFundsCacheNullNav(
  asOfDate?: string,
  batchSize = 50,
): Promise<number> {
  await ensureTrackingFundsListCacheTable()
  const effectiveAsOf = asOfDate ?? new Date().toISOString().slice(0, 10)

  let patched = 0
  for (;;) {
    const staleRows = await query<{
      beian_hao: string
      product_name: string
      short_name: string | null
    }>(
      `SELECT beian_hao, product_name, short_name
       FROM ops_tracking_funds_list_cache
       WHERE unit_nav IS NULL
       LIMIT $1`,
      [batchSize],
    )
    if (staleRows.length === 0) break

    logProgress(`patching null NAV cache batch (${staleRows.length} rows)…`)
    const identities: ProductNavIdentity[] = staleRows.map((row) => ({
      beian_hao: row.beian_hao,
      product_name: row.product_name,
      short_name: row.short_name,
    }))
    const resolver = await BatchNavResolver.create(identities, effectiveAsOf)

    for (let i = 0; i < staleRows.length; i++) {
      const row = staleRows[i]
      const identity = identities[i]
      const latest = resolver.resolveAt(identity, effectiveAsOf)
      if (!latest) continue

      const returnPct = resolver.calcDailyReturnPct(identity, latest.nav, latest.nav_date, null)
      const returns = resolver.calcPeriodReturns(identity, latest.nav, latest.nav_date)
      const risk = computeOneYearRiskMetrics(
        latest.nav_date,
        resolver.mergedHistoryForRiskMetrics(
          identity,
          addDays(latest.nav_date, NAV_HISTORY_LOOKBACK_DAYS),
        ),
      )

      await query(
        `UPDATE ops_tracking_funds_list_cache
         SET unit_nav = $2,
             nav_date = $3::date,
             return_pct = $4,
             ret_1w = $5,
             ret_1m = $6,
             ret_3m = $7,
             ret_6m = $8,
             ret_1y = $9,
             sharpe_1y = $10,
             calmar_1y = $11,
             as_of_date = $12::date,
             refreshed_at = NOW()
         WHERE beian_hao = $1`,
        [
          row.beian_hao,
          clampPgNumeric(latest.nav, 16, 6),
          latest.nav_date,
          clampPgNumeric(returnPct, 16, 8),
          clampPgNumeric(returns.ret_1w, 16, 8),
          clampPgNumeric(returns.ret_1m, 16, 8),
          clampPgNumeric(returns.ret_3m, 16, 8),
          clampPgNumeric(returns.ret_6m, 16, 8),
          clampPgNumeric(returns.ret_1y, 16, 8),
          clampPgNumeric(risk.sharpe_1y, 16, 6),
          clampPgNumeric(risk.calmar_1y, 16, 6),
          effectiveAsOf,
        ],
      )
      patched++
    }
  }

  if (patched > 0) logProgress(`patched ${patched} null NAV cache rows`)
  return patched
}

/** True when the API can serve from the nightly precomputed cache. */
export function useTrackingFundsListCache(cutoffRaw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)) return true
  return cutoffRaw === new Date().toISOString().slice(0, 10)
}

/** Populate cache when empty (e.g. first deploy before nightly ETL has run). */
export async function ensureTrackingFundsListCachePopulated(): Promise<void> {
  await ensureTrackingFundsListCacheTable()
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_tracking_funds_list_cache`,
  )
  if (parseInt(rows[0]?.n ?? "0", 10) === 0) {
    await refreshTrackingFundsListCache()
  }
}
