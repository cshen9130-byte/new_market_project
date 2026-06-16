/**
 * Precomputed 在管产品 list metrics — refreshed nightly after email NAV ETL
 * so the dashboard table loads from a single indexed table instead of per-row
 * multi-table NAV fallback scans.
 */

import { query } from "@/lib/db"
import { computeFundNavMetrics } from "@/lib/fund-nav-metrics"
import { ensureEmailNavTable } from "@/lib/server/email-nav-pg"
import {
  buildManagedProductsFrom,
  FOF_UNDERLYING_BEIAN_EXPR,
} from "@/lib/server/fof-underlying-query"
import { managedShortExpr } from "@/lib/server/managed-products-nav-query"

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

  CREATE INDEX IF NOT EXISTS idx_managed_products_list_cache_company_strat
    ON ops_managed_products_list_cache (company_strategy_l1);

  CREATE INDEX IF NOT EXISTS idx_managed_products_list_cache_platform_strat
    ON ops_managed_products_list_cache (platform_strategy_l1);
`

/* Add new columns to existing tables created before this migration. */
const MIGRATE_SQL = `
  ALTER TABLE ops_managed_products_list_cache
    ADD COLUMN IF NOT EXISTS company_strategy_l1  TEXT,
    ADD COLUMN IF NOT EXISTS platform_strategy_l1 TEXT,
    ADD COLUMN IF NOT EXISTS team_tags             JSONB;

  CREATE INDEX IF NOT EXISTS idx_managed_products_list_cache_company_strat
    ON ops_managed_products_list_cache (company_strategy_l1);

  CREATE INDEX IF NOT EXISTS idx_managed_products_list_cache_platform_strat
    ON ops_managed_products_list_cache (platform_strategy_l1);
`

const RETURN_OFFSETS = [
  { key: "ret_1w" as const, days: 7 },
  { key: "ret_1m" as const, days: 30 },
  { key: "ret_3m" as const, days: 90 },
  { key: "ret_6m" as const, days: 180 },
  { key: "ret_1y" as const, days: 365 },
]

let tableEnsured = false

export async function ensureManagedProductsListCacheTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  await query(MIGRATE_SQL)
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

type NavPoint = {
  nav: number
  nav_date: string
}

type LegacyNavRow = {
  price_date: string
  nav: string
}

function fmtDate(d: string | Date | null): string | null {
  if (!d) return null
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return String(d).slice(0, 10)
}

function addDays(isoDate: string, days: number): string {
  const dt = new Date(isoDate)
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

function calcReturn(current: number, base: number | null | undefined): number | null {
  if (base == null || !Number.isFinite(base) || base === 0 || !Number.isFinite(current)) return null
  return current / base - 1
}

/** Fast indexed email NAV lookup by product_code (no ILIKE scan). */
async function fastEmailNavAt(
  beianHao: string | null,
  beforeDate: string,
): Promise<NavPoint | null> {
  const beian = (beianHao ?? "").trim()
  if (!beian) return null
  const rows = await query<{ nav: string; nav_date: string }>(
    `SELECT nav::text AS nav, nav_date::text AS nav_date
     FROM ops_email_nav_records
     WHERE BTRIM(product_code) = $1
       AND nav IS NOT NULL
       AND nav_date <= $2::date
     ORDER BY nav_date DESC, id DESC
     LIMIT 1`,
    [beian, beforeDate],
  )
  const row = rows[0]
  if (!row) return null
  const nav = parseFloat(row.nav)
  if (!Number.isFinite(nav) || nav <= 0) return null
  return { nav, nav_date: row.nav_date.slice(0, 10) }
}

/** Fast legacy NAV at or before a date — exact match only (beian / product name). */
async function fastLegacyNavAt(
  beianHao: string | null,
  productName: string,
  shortName: string | null,
  beforeDate: string,
): Promise<NavPoint | null> {
  const beian = (beianHao ?? "").trim()
  const short = (shortName ?? "").trim()
  const rows = await query<{ nav: string; price_date: string }>(
    `SELECT nav::text AS nav, price_date::text AS price_date
     FROM (
       SELECT nav, price_date, 0 AS pri FROM private_fund_nav_group
       WHERE price_date <= $4::date
         AND (($1 <> '' AND beian_hao = $1) OR product_name = $2 OR ($3 <> '' AND product_name = $3))
       UNION ALL
       SELECT nav, price_date, 1 AS pri FROM private_fund_nav_group_hy
       WHERE price_date <= $4::date
         AND (($1 <> '' AND beian_hao = $1) OR product_name = $2 OR ($3 <> '' AND product_name = $3))
       UNION ALL
       SELECT nav, price_date, 2 AS pri FROM private_fund_nav
       WHERE price_date <= $4::date
         AND (($1 <> '' AND beian_hao = $1) OR product_name = $2 OR ($3 <> '' AND product_name = $3))
     ) nav_union
     WHERE nav IS NOT NULL AND nav > 0
     ORDER BY price_date DESC, pri ASC
     LIMIT 1`,
    [beian, productName, short, beforeDate],
  )
  const row = rows[0]
  if (!row) return null
  const nav = parseFloat(row.nav)
  if (!Number.isFinite(nav) || nav <= 0) return null
  return { nav, nav_date: row.price_date.slice(0, 10) }
}

async function resolveNavAt(
  beianHao: string | null,
  productName: string,
  shortName: string | null,
  beforeDate: string,
  fallbackNav: number | null,
  fallbackDate: string | null,
): Promise<NavPoint | null> {
  const email = await fastEmailNavAt(beianHao, beforeDate)
  if (email) return email
  const legacy = await fastLegacyNavAt(beianHao, productName, shortName, beforeDate)
  if (legacy) return legacy
  if (fallbackNav != null && fallbackDate && fallbackDate <= beforeDate) {
    return { nav: fallbackNav, nav_date: fallbackDate }
  }
  return null
}

async function loadLegacyNavHistory(
  beianHao: string | null,
  productName: string,
  shortName: string | null,
  sinceDate: string,
): Promise<LegacyNavRow[]> {
  const beian = (beianHao ?? "").trim()
  const short = (shortName ?? "").trim()
  try {
    return await query<LegacyNavRow>(
      `SELECT DISTINCT ON (price_date)
         price_date::text AS price_date,
         nav::text AS nav
       FROM (
         SELECT price_date, nav, 0 AS pri FROM private_fund_nav_group
         WHERE price_date >= $4::date
           AND (($1 <> '' AND beian_hao = $1) OR product_name = $2 OR ($3 <> '' AND product_name = $3))
         UNION ALL
         SELECT price_date, nav, 1 AS pri FROM private_fund_nav_group_hy
         WHERE price_date >= $4::date
           AND (($1 <> '' AND beian_hao = $1) OR product_name = $2 OR ($3 <> '' AND product_name = $3))
         UNION ALL
         SELECT price_date, nav, 2 AS pri FROM private_fund_nav
         WHERE price_date >= $4::date
           AND (($1 <> '' AND beian_hao = $1) OR product_name = $2 OR ($3 <> '' AND product_name = $3))
       ) nav_union
       WHERE nav IS NOT NULL AND nav > 0
       ORDER BY price_date ASC, pri ASC`,
      [beian, productName, short, sinceDate],
    )
  } catch {
    return []
  }
}

async function loadEmailNavHistory(
  beianHao: string | null,
  sinceDate: string,
): Promise<LegacyNavRow[]> {
  const beian = (beianHao ?? "").trim()
  if (!beian) return []
  try {
    const rows = await query<{ nav_date: string; nav: string }>(
      `SELECT nav_date::text AS nav_date, nav::text AS nav
       FROM ops_email_nav_records
       WHERE BTRIM(product_code) = $1
         AND nav IS NOT NULL
         AND nav_date >= $2::date
       ORDER BY nav_date ASC, id ASC`,
      [beian, sinceDate],
    )
    return rows.map((r) => ({ price_date: r.nav_date.slice(0, 10), nav: r.nav }))
  } catch {
    return []
  }
}

function mergeNavHistory(legacyRows: LegacyNavRow[], emailRows: LegacyNavRow[]): LegacyNavRow[] {
  const byDate = new Map<string, LegacyNavRow>()
  for (const row of legacyRows) byDate.set(row.price_date, row)
  for (const row of emailRows) byDate.set(row.price_date, row)
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row)
}

function computeOneYearRiskMetrics(
  navDate: string | null,
  history: LegacyNavRow[],
): { sharpe_1y: number | null; calmar_1y: number | null } {
  if (history.length < 2) return { sharpe_1y: null, calmar_1y: null }

  const refDate = navDate ? new Date(navDate) : new Date(history[history.length - 1].price_date)
  const cutoffTs = refDate.getTime() - 365 * 86400000

  const dates: string[] = []
  const values: number[] = []
  for (const row of history) {
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

type OpsStrategyRow = {
  register_number: string
  company_strategy_l1: string | null
  platform_strategy_l1: string | null
  team_tags: unknown
}

async function loadOpsStrategyAndTags(
  beianHaos: string[],
): Promise<Map<string, OpsStrategyRow>> {
  const codes = beianHaos.map((b) => b.trim()).filter(Boolean)
  const out = new Map<string, OpsStrategyRow>()
  if (codes.length === 0) return out

  const rows = await query<OpsStrategyRow>(
    `SELECT DISTINCT ON (register_number)
       register_number,
       NULLIF(BTRIM(company_strategy_one), '')  AS company_strategy_l1,
       NULLIF(BTRIM(platform_strategy_one), '') AS platform_strategy_l1,
       CASE WHEN jsonb_typeof(tag->'company') = 'array'
            THEN tag->'company' ELSE '[]'::jsonb END AS team_tags
     FROM type6_ops_team_full
     WHERE register_number = ANY($1::text[])
     ORDER BY register_number, updated_at DESC NULLS LAST, id DESC`,
    [codes],
  )
  for (const r of rows) out.set(r.register_number, r)
  return out
}

async function loadBflStrategies(
  beianHaos: string[],
): Promise<Map<string, string>> {
  const codes = beianHaos.map((b) => b.trim()).filter(Boolean)
  const out = new Map<string, string>()
  if (codes.length === 0) return out

  const rows = await query<{ beian_hao: string; strategy: string | null }>(
    `SELECT beian_hao,
       NULLIF(BTRIM(split_part(COALESCE(strategy_company, ''), ',', 1)), '') AS strategy
     FROM private_fund_info_bfl
     WHERE beian_hao = ANY($1::text[])`,
    [codes],
  )
  for (const r of rows) {
    if (r.strategy) out.set(r.beian_hao, r.strategy)
  }
  return out
}

async function loadPrivateFundRiskMetrics(
  beianHaos: string[],
): Promise<Map<string, { sharpe_1y: number | null; calmar_1y: number | null }>> {
  const out = new Map<string, { sharpe_1y: number | null; calmar_1y: number | null }>()
  const codes = beianHaos.map((b) => b.trim()).filter(Boolean)
  if (codes.length === 0) return out

  const rows = await query<{ beian_hao: string; sharpe_1y: string | null; calmar_1y: string | null }>(
    `SELECT beian_hao, sharpe_1y::text, calmar_1y::text
     FROM private_fund_info
     WHERE beian_hao = ANY($1::text[])`,
    [codes],
  )
  for (const row of rows) {
    out.set(row.beian_hao, {
      sharpe_1y: row.sharpe_1y != null ? parseFloat(row.sharpe_1y) : null,
      calmar_1y: row.calmar_1y != null ? parseFloat(row.calmar_1y) : null,
    })
  }
  return out
}

/** Rebuild precomputed list cache for all 在管产品 rows (as of CURRENT_DATE). */
export async function refreshManagedProductsListCache(): Promise<number> {
  await ensureEmailNavTable()
  await ensureManagedProductsListCacheTable()

  const asOfDate = new Date().toISOString().slice(0, 10)
  logProgress("loading managed products…")

  const products = await query<BaseProductRow>(
    `SELECT
       m.id::text AS managed_product_id,
       m.product_name,
       ${FOF_UNDERLYING_BEIAN_EXPR} AS beian_hao,
       ${managedShortExpr("m.product_name")} AS short_name,
       m.latest_unit_nav::text AS fallback_nav,
       m.latest_nav_date AS fallback_nav_date,
       m.latest_return_pct::text AS fallback_return_pct
     ${buildManagedProductsFrom("m.product_name")}
     WHERE m.product_name <> '合计'`,
  )

  logProgress(`found ${products.length} products`)

  const beianHaos = products.map((p) => p.beian_hao).filter(Boolean) as string[]
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

  for (let i = 0; i < products.length; i++) {
    const row = products[i]
    logProgress(`[${i + 1}/${products.length}] ${row.product_name}`)

    const fallbackNav = row.fallback_nav != null ? parseFloat(row.fallback_nav) : null
    const fallbackDate = fmtDate(row.fallback_nav_date)

    const latest = await resolveNavAt(
      row.beian_hao,
      row.product_name,
      row.short_name,
      asOfDate,
      fallbackNav,
      fallbackDate,
    )

    const unitNav = latest?.nav ?? fallbackNav
    const navDate = latest?.nav_date ?? fallbackDate

    let returnPct: number | null = null
    if (unitNav != null && navDate) {
      const prevEmail = await query<{ nav: string }>(
        `SELECT nav::text AS nav
         FROM ops_email_nav_records
         WHERE BTRIM(product_code) = $1
           AND nav IS NOT NULL
           AND nav_date < $2::date
         ORDER BY nav_date DESC, id DESC
         LIMIT 1`,
        [(row.beian_hao ?? "").trim(), navDate],
      )
      const prevNav = prevEmail[0] ? parseFloat(prevEmail[0].nav) : null
      returnPct = calcReturn(unitNav, prevNav)
      if (returnPct == null && row.fallback_return_pct != null) {
        returnPct = parseFloat(row.fallback_return_pct) / 100
      }
    }

    const returns: Record<string, number | null> = {}
    if (unitNav != null && navDate) {
      for (const { key, days } of RETURN_OFFSETS) {
        const offsetDate = addDays(navDate, days)
        const base = await resolveNavAt(
          row.beian_hao,
          row.product_name,
          row.short_name,
          offsetDate,
          null,
          null,
        )
        returns[key] = calcReturn(unitNav, base?.nav)
      }
    } else {
      for (const { key } of RETURN_OFFSETS) returns[key] = null
    }

    let sharpe_1y: number | null = null
    let calmar_1y: number | null = null
    const beian = (row.beian_hao ?? "").trim()
    const fromInfo = beian ? riskFromInfo.get(beian) : undefined
    if (fromInfo?.sharpe_1y != null || fromInfo?.calmar_1y != null) {
      sharpe_1y = fromInfo.sharpe_1y
      calmar_1y = fromInfo.calmar_1y
    } else if (navDate) {
      const sinceDate = addDays(navDate, 400)
      const [legacyNav, emailNav] = await Promise.all([
        loadLegacyNavHistory(row.beian_hao, row.product_name, row.short_name, sinceDate),
        loadEmailNavHistory(row.beian_hao, sinceDate),
      ])
      const risk = computeOneYearRiskMetrics(navDate, mergeNavHistory(legacyNav, emailNav))
      sharpe_1y = risk.sharpe_1y
      calmar_1y = risk.calmar_1y
    }

    const ops = beian ? opsStrategyMap.get(beian) : undefined
    const bflStrategy = beian ? bflStrategyMap.get(beian) : undefined
    const company_strategy_l1 = ops?.company_strategy_l1 ?? bflStrategy ?? null
    const platform_strategy_l1 = ops?.platform_strategy_l1 ?? bflStrategy ?? null
    const team_tags = ops?.team_tags != null ? JSON.stringify(ops.team_tags) : null

    placeholders.push(
      `($${pi}, $${pi+1}, $${pi+2}, $${pi+3}, $${pi+4}, $${pi+5}, $${pi+6}, $${pi+7}, $${pi+8}, $${pi+9}, $${pi+10}, $${pi+11}, $${pi+12}, $${pi+13}, $${pi+14}, $${pi+15}, $${pi+16}::jsonb, $${pi+17}::date, NOW())`,
    )
    values.push(
      row.managed_product_id,
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
      asOfDate,
    )
    pi += 18
  }

  logProgress("writing cache table…")
  await query(
    `INSERT INTO ops_managed_products_list_cache (
       managed_product_id, product_name, beian_hao, short_name,
       unit_nav, nav_date, return_pct,
       ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
       sharpe_1y, calmar_1y,
       company_strategy_l1, platform_strategy_l1, team_tags,
       as_of_date, refreshed_at
     ) VALUES ${placeholders.join(", ")}`,
    values,
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
export async function ensureManagedProductsListCachePopulated(): Promise<void> {
  await ensureManagedProductsListCacheTable()
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_managed_products_list_cache`,
  )
  if (parseInt(rows[0]?.n ?? "0", 10) === 0) {
    await refreshManagedProductsListCache()
  }
}
