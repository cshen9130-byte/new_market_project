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
  calcDailyReturnPctFromHistory,
  calcPeriodReturnsFromHistory,
  chunkedInsert,
  clampPgNumeric,
  computeOneYearRiskMetrics,
  loadPrivateFundRiskMetrics,
  NAV_HISTORY_LOOKBACK_DAYS,
  type NavPoint,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"
import { isPlausibleRiskRatio } from "@/lib/fund-nav-metrics"
import { isCodeLikeProductName, resolveTrackingProductName } from "@/lib/server/tracking-product-name"

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
  // Index for the DISTINCT ON dedup query on type6_ops_team_full (bfl_ops pool).
  // Fires as a non-blocking background DDL so it never delays the first request;
  // once built it makes the DISTINCT ON query go from O(N log N) full sort to
  // O(distinct) index scan.
  query(
    `CREATE INDEX IF NOT EXISTS idx_type6_ops_team_full_dedup
       ON type6_ops_team_full (register_number, updated_at DESC NULLS LAST, id DESC)
      WHERE register_number IS NOT NULL`,
  ).catch(() => {})
  // Simple single-column index used by the EXISTS probe in the bfl_ops query.
  query(
    `CREATE INDEX IF NOT EXISTS idx_type6_ops_team_full_register
       ON type6_ops_team_full (register_number)
      WHERE register_number IS NOT NULL`,
  ).catch(() => {})
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

/** Upsert one fund into the list cache so manual pool adds show up immediately. */
export async function upsertTrackingFundListCacheEntry(
  beian_hao: string,
  product_name: string,
): Promise<void> {
  await ensureEmailNavTable()
  await ensureTrackingFundsListCacheTable()

  const asOfDate = new Date().toISOString().slice(0, 10)
  const bflRows = await query<{
    product_name: string | null
    short_name: string | null
    raw_strategy: string | null
  }>(
    `SELECT product_name, short_name, raw_strategy
     FROM private_fund_info_bfl
     WHERE beian_hao = $1
     LIMIT 1`,
    [beian_hao],
  )
  const poolRows = await query<{ product_name: string }>(
    `SELECT product_name FROM user_custom_pool
     WHERE pool_key = 'custom_email_nav' AND register_number = $1
     LIMIT 1`,
    [beian_hao],
  )
  const poolName = poolRows[0]?.product_name ?? product_name
  const resolvedName = isCodeLikeProductName(poolName, beian_hao)
    ? await resolveTrackingProductName(beian_hao, poolName)
    : poolName
  const row: BaseFundRow = {
    beian_hao,
    product_name: resolvedName,
    short_name: bflRows[0]?.short_name ?? (isCodeLikeProductName(poolName, beian_hao) ? null : poolName),
    raw_strategy: bflRows[0]?.raw_strategy ?? null,
  }

  const identity = {
    beian_hao: row.beian_hao,
    product_name: row.product_name,
    short_name: row.short_name,
  }
  const navResolver = await BatchNavResolver.create([identity], asOfDate)
  const [riskFromInfo, opsStrategyMap] = await Promise.all([
    loadPrivateFundRiskMetrics([beian_hao]),
    loadOpsFullStrategy([beian_hao]),
  ])

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
  const fromInfo = riskFromInfo.get(beian_hao)
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

  const ops = opsStrategyMap.get(beian_hao)
  const rawStrategyJson = parseRawStrategyJson(row.raw_strategy)
  const teamTags = ops?.team_tags != null ? JSON.stringify(ops.team_tags) : null
  const companyL1 = ops?.company_strategy_l1 ?? strategyFromRawJson(rawStrategyJson, "company", "one")
  const companyL2 = ops?.company_strategy_l2 ?? strategyFromRawJson(rawStrategyJson, "company", "two")
  const companyL3 = ops?.company_strategy_l3 ?? strategyFromRawJson(rawStrategyJson, "company", "three")
  const platformL1 = ops?.platform_strategy_l1 ?? strategyFromRawJson(rawStrategyJson, "platform", "one")
  const platformL2 = ops?.platform_strategy_l2 ?? strategyFromRawJson(rawStrategyJson, "platform", "two")
  const platformL3 = ops?.platform_strategy_l3 ?? strategyFromRawJson(rawStrategyJson, "platform", "three")

  await query(
    `INSERT INTO ops_tracking_funds_list_cache (
       beian_hao, product_name, short_name,
       unit_nav, nav_date, return_pct,
       ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
       sharpe_1y, calmar_1y,
       company_strategy_l1, company_strategy_l2, company_strategy_l3,
       platform_strategy_l1, platform_strategy_l2, platform_strategy_l3,
       raw_strategy_json, team_tags,
       as_of_date, refreshed_at
     ) VALUES (
       $1, $2, $3,
       $4, $5::date, $6,
       $7, $8, $9, $10, $11,
       $12, $13,
       $14, $15, $16,
       $17, $18, $19,
       $20::jsonb, $21::jsonb,
       $22::date, NOW()
     )
     ON CONFLICT (beian_hao) DO UPDATE SET
       product_name = EXCLUDED.product_name,
       short_name = EXCLUDED.short_name,
       unit_nav = EXCLUDED.unit_nav,
       nav_date = EXCLUDED.nav_date,
       return_pct = EXCLUDED.return_pct,
       ret_1w = EXCLUDED.ret_1w,
       ret_1m = EXCLUDED.ret_1m,
       ret_3m = EXCLUDED.ret_3m,
       ret_6m = EXCLUDED.ret_6m,
       ret_1y = EXCLUDED.ret_1y,
       sharpe_1y = EXCLUDED.sharpe_1y,
       calmar_1y = EXCLUDED.calmar_1y,
       company_strategy_l1 = EXCLUDED.company_strategy_l1,
       company_strategy_l2 = EXCLUDED.company_strategy_l2,
       company_strategy_l3 = EXCLUDED.company_strategy_l3,
       platform_strategy_l1 = EXCLUDED.platform_strategy_l1,
       platform_strategy_l2 = EXCLUDED.platform_strategy_l2,
       platform_strategy_l3 = EXCLUDED.platform_strategy_l3,
       raw_strategy_json = EXCLUDED.raw_strategy_json,
       team_tags = EXCLUDED.team_tags,
       as_of_date = EXCLUDED.as_of_date,
       refreshed_at = NOW()`,
    [
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
    ],
  )
  cacheAsOfMemo = null

  // Keep product-page series in sync for the touched tracking fund.
  try {
    const { refreshDetailNavCacheForFund } = await import(
      "@/lib/server/fund-detail-nav-cache-pg"
    )
    await refreshDetailNavCacheForFund({
      beian_hao: row.beian_hao,
      product_name: row.product_name,
      short_name: row.short_name,
    })
  } catch (err) {
    console.warn(
      "[tracking-funds-list-cache] detail NAV cache refresh failed",
      row.beian_hao,
      err,
    )
  }
}

const TRACKING_CACHE_INSERT_SQL = `INSERT INTO ops_tracking_funds_list_cache (
       beian_hao, product_name, short_name,
       unit_nav, nav_date, return_pct,
       ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
       sharpe_1y, calmar_1y,
       company_strategy_l1, company_strategy_l2, company_strategy_l3,
       platform_strategy_l1, platform_strategy_l2, platform_strategy_l3,
       raw_strategy_json, team_tags,
       as_of_date, refreshed_at
     ) VALUES`

const TRACKING_CACHE_UPSERT_SQL = `ON CONFLICT (beian_hao) DO UPDATE SET
       product_name = EXCLUDED.product_name,
       short_name = EXCLUDED.short_name,
       unit_nav = EXCLUDED.unit_nav,
       nav_date = EXCLUDED.nav_date,
       return_pct = EXCLUDED.return_pct,
       ret_1w = EXCLUDED.ret_1w,
       ret_1m = EXCLUDED.ret_1m,
       ret_3m = EXCLUDED.ret_3m,
       ret_6m = EXCLUDED.ret_6m,
       ret_1y = EXCLUDED.ret_1y,
       sharpe_1y = EXCLUDED.sharpe_1y,
       calmar_1y = EXCLUDED.calmar_1y,
       company_strategy_l1 = EXCLUDED.company_strategy_l1,
       company_strategy_l2 = EXCLUDED.company_strategy_l2,
       company_strategy_l3 = EXCLUDED.company_strategy_l3,
       platform_strategy_l1 = EXCLUDED.platform_strategy_l1,
       platform_strategy_l2 = EXCLUDED.platform_strategy_l2,
       platform_strategy_l3 = EXCLUDED.platform_strategy_l3,
       raw_strategy_json = EXCLUDED.raw_strategy_json,
       team_tags = EXCLUDED.team_tags,
       as_of_date = EXCLUDED.as_of_date,
       refreshed_at = NOW()`

const TRACKING_CACHE_BATCH = 50

/** Rebuild precomputed list cache for all tracked funds (as of CURRENT_DATE). */
export async function refreshTrackingFundsListCache(): Promise<number> {
  await ensureEmailNavTable()
  await ensureTrackingFundsListCacheTable()

  const asOfDate = new Date().toISOString().slice(0, 10)
  logProgress("loading fund identities…")

  const funds = await query<BaseFundRow>(`${IDENTITY_SQL.trim()} ORDER BY product_name`)
  logProgress(`found ${funds.length} funds — upserting in batches of ${TRACKING_CACHE_BATCH}…`)

  if (funds.length === 0) return 0

  const { resolveTeamSeriesListNavAt } = await import("@/lib/server/managed-product-nav-seed")
  const { loadManagedProductTeamNavBatch } = await import("@/lib/server/team-nav-manage-pg")

  for (let start = 0; start < funds.length; start += TRACKING_CACHE_BATCH) {
    const batch = funds.slice(start, start + TRACKING_CACHE_BATCH)
    const identities = batch.map((f) => ({
      beian_hao: f.beian_hao,
      product_name: f.product_name,
      short_name: f.short_name,
    }))
    const navResolver = await BatchNavResolver.create(identities, asOfDate)
    const beianHaos = batch.map((f) => f.beian_hao)
    const [riskFromInfo, opsStrategyMap, teamNavBatch] = await Promise.all([
      loadPrivateFundRiskMetrics(beianHaos),
      loadOpsFullStrategy(beianHaos),
      loadManagedProductTeamNavBatch(identities),
    ])
    const teamNavByBeian = new Map<string, Array<{ nav_date: string; unit_nav: string }>>()
    for (const [code, series] of teamNavBatch) {
      teamNavByBeian.set(code.trim().toUpperCase(), series)
    }

    const values: unknown[] = []
    const placeholders: string[] = []
    let pi = 1

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i]
      const identity = identities[i]
      const latest = navResolver.resolveAt(identity, asOfDate)
      let unitNav = latest?.nav ?? null
      let navDate = latest?.nav_date ?? null
      const teamPoint = resolveTeamSeriesListNavAt(
        teamNavByBeian.get(row.beian_hao.trim().toUpperCase()) ?? [],
        asOfDate,
      )
      if (teamPoint && (!navDate || teamPoint.nav_date >= navDate)) {
        unitNav = parseFloat(teamPoint.nav)
        if (!Number.isFinite(unitNav)) unitNav = latest?.nav ?? null
        else navDate = teamPoint.nav_date
      }

      let returnPct: number | null = null
      if (unitNav != null && navDate) {
        if (teamPoint && navDate === teamPoint.nav_date && teamPoint.prev_nav != null) {
          const prev = parseFloat(teamPoint.prev_nav)
          if (Number.isFinite(prev) && prev !== 0) returnPct = unitNav / prev - 1
        } else {
          returnPct = navResolver.calcDailyReturnPct(identity, unitNav, navDate, null)
        }
      }

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

    await chunkedInsert(
      TRACKING_CACHE_INSERT_SQL,
      TRACKING_CACHE_UPSERT_SQL,
      placeholders,
      values,
      22,
    )
    logProgress(`upserted [${Math.min(start + batch.length, funds.length)}/${funds.length}]`)
  }

  logProgress("backfilling null-NAV rows from wider history…")
  const patched = await patchTrackingFundsCacheNullNav(asOfDate)
  logProgress("refreshing detail NAV series cache…")
  try {
    const { refreshDetailNavCacheForFunds } = await import(
      "@/lib/server/fund-detail-nav-cache-pg"
    )
    const detail = await refreshDetailNavCacheForFunds(
      funds.map((f) => ({
        beian_hao: f.beian_hao,
        product_name: f.product_name,
        short_name: f.short_name,
      })),
      { label: "tracking-detail-nav-cache" },
    )
    logProgress(
      `detail NAV cache updated ${detail.updated}/${funds.length}` +
        (detail.failed ? ` (failed ${detail.failed})` : ""),
    )
  } catch (err) {
    console.error("[tracking-funds-list-cache] detail NAV cache refresh failed:", err)
  }

  logProgress(`done — ${funds.length} rows (backfilled ${patched} null-NAV rows)`)
  return funds.length
}

type TrackingTipFromSeries = {
  nav_date: string
  unit_nav: number
  return_pct: number | null
  ret_1w: number | null
  ret_1m: number | null
  ret_3m: number | null
  ret_6m: number | null
  ret_1y: number | null
  sharpe_1y: number | null
  calmar_1y: number | null
}

function seriesToNavPoints(
  series: Array<{
    price_date?: string
    nav?: string
    cumulative_nav?: string
  }>,
): NavPoint[] {
  const out: NavPoint[] = []
  for (const row of series) {
    const navDate = row.price_date?.slice(0, 10)
    const nav = parseFloat(String(row.nav ?? ""))
    if (!navDate || !/^\d{4}-\d{2}-\d{2}$/.test(navDate)) continue
    if (!Number.isFinite(nav) || nav <= 0) continue
    const cum = parseFloat(String(row.cumulative_nav ?? ""))
    const point: NavPoint = { nav, nav_date: navDate }
    if (Number.isFinite(cum) && cum > 0) point.return_nav = cum
    out.push(point)
  }
  return out
}

/** Tip + period metrics matching the product-page NAV series (复权净值 returns). */
function tipFieldsFromDetailSeries(
  series: Array<{
    price_date?: string
    nav?: string
    cumulative_nav?: string
    price_change?: string
  }>,
): TrackingTipFromSeries | null {
  if (series.length === 0) return null
  const latest = series[series.length - 1]
  const prev = series.length >= 2 ? series[series.length - 2] : null
  const navDate = latest.price_date?.slice(0, 10) ?? null
  const unitNav = parseFloat(String(latest.nav ?? ""))
  if (!navDate || !Number.isFinite(unitNav) || unitNav <= 0) return null

  const history = seriesToNavPoints(series)
  let returnPct = calcDailyReturnPctFromHistory(history, unitNav, navDate, null)
  if (returnPct == null && prev) {
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
  if (returnPct != null && !Number.isFinite(returnPct)) returnPct = null

  const returns =
    history.length >= 2
      ? calcPeriodReturnsFromHistory(history, unitNav, navDate)
      : { ret_1w: null, ret_1m: null, ret_3m: null, ret_6m: null, ret_1y: null }

  const risk =
    history.length >= 2
      ? computeOneYearRiskMetrics(
          navDate,
          history.filter((p) => p.nav_date >= addDays(navDate, NAV_HISTORY_LOOKBACK_DAYS)),
        )
      : { sharpe_1y: null, calmar_1y: null }

  return {
    nav_date: navDate,
    unit_nav: unitNav,
    return_pct: returnPct,
    ret_1w: returns.ret_1w,
    ret_1m: returns.ret_1m,
    ret_3m: returns.ret_3m,
    ret_6m: returns.ret_6m,
    ret_1y: returns.ret_1y,
    sharpe_1y: isPlausibleRiskRatio(risk.sharpe_1y) ? risk.sharpe_1y : null,
    calmar_1y: isPlausibleRiskRatio(risk.calmar_1y) ? risk.calmar_1y : null,
  }
}

/**
 * Write-through: when product detail NAV is refreshed, also advance 跟踪产品
 * 最新净值日期 / 最新单位净值 / 最新涨跌幅 / period returns so the list does not
 * lag the product page. No-op when the fund is not in ops_tracking_funds_list_cache.
 * Only advances (or fills null) — never regresses an already-newer tip.
 */
export async function patchTrackingFundsListCacheTipFromSeries(opts: {
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
  const beian = (opts.beian_hao ?? "").trim() || null
  const productName = opts.product_name.trim()
  if (!productName && !beian) return false

  try {
    await ensureTrackingFundsListCacheTable()
    const asOfDate = new Date().toISOString().slice(0, 10)
    const result = await query<{ n: string }>(
      `WITH updated AS (
         UPDATE ops_tracking_funds_list_cache
         SET unit_nav = $1,
             nav_date = $2::date,
             return_pct = $3,
             ret_1w = $4,
             ret_1m = $5,
             ret_3m = $6,
             ret_6m = $7,
             ret_1y = $8,
             sharpe_1y = COALESCE($9, sharpe_1y),
             calmar_1y = COALESCE($10, calmar_1y),
             as_of_date = GREATEST(as_of_date, $11::date),
             refreshed_at = NOW()
         WHERE (
             ($12::text IS NOT NULL AND UPPER(BTRIM(beian_hao)) = UPPER(BTRIM($12::text)))
             OR product_name = $13
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
        clampPgNumeric(tip.unit_nav, 16, 6),
        tip.nav_date,
        clampPgNumeric(tip.return_pct, 16, 8),
        clampPgNumeric(tip.ret_1w, 16, 8),
        clampPgNumeric(tip.ret_1m, 16, 8),
        clampPgNumeric(tip.ret_3m, 16, 8),
        clampPgNumeric(tip.ret_6m, 16, 8),
        clampPgNumeric(tip.ret_1y, 16, 8),
        clampPgNumeric(tip.sharpe_1y, 16, 6),
        clampPgNumeric(tip.calmar_1y, 16, 6),
        asOfDate,
        beian,
        productName,
      ],
    )
    const n = parseInt(result[0]?.n ?? "0", 10)
    if (n > 0) cacheAsOfMemo = null
    return n > 0
  } catch (err) {
    console.warn(
      `[tracking-funds-cache] tip patch failed for ${productName || beian}:`,
      err,
    )
    return false
  }
}

/** Backfill cache rows that were stored with null NAV (stale platform data outside the default window). */
export async function patchTrackingFundsCacheNullNav(
  asOfDate?: string,
  batchSize = 50,
): Promise<number> {
  await ensureTrackingFundsListCacheTable()
  const effectiveAsOf = asOfDate ?? new Date().toISOString().slice(0, 10)

  let patched = 0
  // Keyset cursor on beian_hao so we always move forward. Rows that stay null
  // (genuinely unresolvable NAV) are skipped instead of being re-selected
  // forever, which the previous LIMIT-only loop could do (infinite loop).
  let cursor = ""
  for (;;) {
    const staleRows = await query<{
      beian_hao: string
      product_name: string
      short_name: string | null
    }>(
      `SELECT beian_hao, product_name, short_name
       FROM ops_tracking_funds_list_cache
       WHERE unit_nav IS NULL AND beian_hao > $1
       ORDER BY beian_hao
       LIMIT $2`,
      [cursor, batchSize],
    )
    if (staleRows.length === 0) break
    cursor = staleRows[staleRows.length - 1].beian_hao

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

// Memoized snapshot date of the precomputed cache so the fast-path gate does not
// issue a query on every request. Short TTL keeps it fresh across nightly ETL.
let cacheAsOfMemo: { date: string | null; at: number } | null = null
const CACHE_ASOF_TTL_MS = 5 * 60 * 1000

async function getCacheAsOfDate(): Promise<string | null> {
  const now = Date.now()
  if (cacheAsOfMemo && now - cacheAsOfMemo.at < CACHE_ASOF_TTL_MS) {
    return cacheAsOfMemo.date
  }
  try {
    await ensureTrackingFundsListCacheTable()
    const rows = await query<{ as_of: string | null }>(
      `SELECT MAX(as_of_date)::text AS as_of FROM ops_tracking_funds_list_cache`,
    )
    const date = rows[0]?.as_of ?? null
    cacheAsOfMemo = { date, at: now }
    return date
  } catch {
    // On failure keep any previously known value rather than forcing the slow path.
    return cacheAsOfMemo?.date ?? null
  }
}

/**
 * Async gate used by the list API. Serves the precomputed cache whenever the
 * request is for the latest data — i.e. no/invalid cutoff, a cutoff on/after
 * today (any timezone skew), or a cutoff that is not strictly older than the
 * snapshot the cache was built for. Only genuinely historical cutoffs (before
 * the cache snapshot) fall through to the slower live computation.
 */
export async function shouldUseTrackingFundsListCache(cutoffRaw: string): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffRaw)) return true
  if (cutoffRaw >= new Date().toISOString().slice(0, 10)) return true
  const asOf = await getCacheAsOfDate()
  if (asOf && cutoffRaw >= asOf) return true
  return false
}

/** Populate cache when empty (e.g. first deploy before nightly ETL has run). */
// Use global so the one-time guard survives Next.js hot-module reloads.
declare global { var _ensurePopulatedDone: boolean | undefined }
export async function ensureTrackingFundsListCachePopulated(): Promise<void> {
  if (global._ensurePopulatedDone) return
  await ensureTrackingFundsListCacheTable()
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_tracking_funds_list_cache`,
  )
  if (parseInt(rows[0]?.n ?? "0", 10) === 0) {
    // Production web sets RUN_BACKGROUND_JOBS=0 — never start a multi-minute
    // rebuild here (pegs next-server and freezes login / tracking lists).
    if (process.env.RUN_BACKGROUND_JOBS === "0") {
      console.warn(
        "[tracking-funds-cache] empty — not rebuilding in next-server (RUN_BACKGROUND_JOBS=0); start PM2 worker / nightly ETL",
      )
      global._ensurePopulatedDone = true
      return
    }
    await refreshTrackingFundsListCache()
  }
  global._ensurePopulatedDone = true
}
