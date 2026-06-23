/**
 * 在管产品 FOF 底层持仓 — extracted from email 估值表.
 * All managed products are treated as FOF except 荣熙恒盈2号.
 */

import { query } from "@/lib/db"
import { ensureEmailValuationMetricsTables } from "@/lib/server/email-valuation-metrics-pg"
import { ensureEmailValuationHoldingsTables } from "@/lib/server/email-valuation-holdings-pg"
import {
  buildManagedProductsFrom,
  fofUnderlyingBeianExpr,
} from "@/lib/server/fof-underlying-query"
import { sqlFundNameMatch, sqlEmailNavShareClassGuard, sqlShareClassCodeGuard } from "@/lib/server/fund-name-match"
import { backfillFundHoldingSymbols } from "@/lib/server/fund-holding-code"

/** Managed products excluded from FOF underlying extraction (non-FOF). */
export const MANAGED_FOF_EXCLUDED_PRODUCT_PATTERN = "%恒盈2号%"

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_managed_fof_underlying (
    id                       BIGSERIAL PRIMARY KEY,
    managed_product_id       BIGINT      NOT NULL,
    fof_product_name         TEXT        NOT NULL,
    fof_product_code         TEXT,
    valuation_date           DATE        NOT NULL,
    valuation_record_id      BIGINT      NOT NULL,
    underlying_product_code  TEXT,
    underlying_name          TEXT        NOT NULL,
    subject_code             TEXT        NOT NULL,
    row_kind                 TEXT,
    market_value             NUMERIC(20,2),
    quantity                 NUMERIC(20,4),
    cost                     NUMERIC(20,2),
    market_weight            NUMERIC(12,6),
    refreshed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_managed_fof_underlying_product
    ON ops_managed_fof_underlying (managed_product_id);
  CREATE INDEX IF NOT EXISTS idx_managed_fof_underlying_fof_code
    ON ops_managed_fof_underlying (fof_product_code);
  CREATE INDEX IF NOT EXISTS idx_managed_fof_underlying_underlying_code
    ON ops_managed_fof_underlying (underlying_product_code);
  CREATE INDEX IF NOT EXISTS idx_managed_fof_underlying_date
    ON ops_managed_fof_underlying (valuation_date DESC);
`

const MIGRATE_UNIQUE_SQL = `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'uq_managed_fof_underlying_row'
    ) THEN
      ALTER TABLE ops_managed_fof_underlying
        ADD CONSTRAINT uq_managed_fof_underlying_row
        UNIQUE (managed_product_id, valuation_date, underlying_product_code, underlying_name, subject_code);
    END IF;
  END $$;
`

let tableEnsured = false

export async function ensureManagedFofUnderlyingTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  await query(MIGRATE_UNIQUE_SQL)
  tableEnsured = true
}

/** Rebuild 在管产品 FOF 底层持仓 from latest email 估值表 per managed fund. */
export async function refreshManagedFofUnderlying(): Promise<number> {
  await ensureManagedFofUnderlyingTable()
  await ensureEmailValuationMetricsTables()
  await ensureEmailValuationHoldingsTables()

  // Repair row_kind for 4-level 估值表 private fund rows stored as "other" (1109xxxx codes).
  await query(
    `UPDATE ops_email_valuation_holdings
     SET row_kind = 'private_fund'
     WHERE row_kind = 'other'
       AND (
         subject_code LIKE '1109%'
         OR subject_code LIKE '1108%'
         OR subject_name ~ '私募证券投资基金'
         OR subject_name ~ '私募基金'
       )`,
  )

  await backfillFundHoldingSymbols()

  await query(`DELETE FROM ops_managed_fof_underlying`)

  const productExpr = "m.product_name"
  const beianExpr = fofUnderlyingBeianExpr(productExpr)
  const fundMatch = sqlFundNameMatch("r.fund_name", "mf.product_name")
  const underlyingKey = `NULLIF(BTRIM(UPPER(h.symbol)), '')`

  const rows = await query<{ n: string }>(
    `WITH managed_fof AS (
       SELECT
         m.id AS managed_product_id,
         m.product_name,
         ${beianExpr} AS beian_hao
       ${buildManagedProductsFrom(productExpr)}
       WHERE m.product_name <> '合计'
         AND m.product_name NOT ILIKE $1
     ),
     latest_valuation AS (
       SELECT DISTINCT ON (mf.managed_product_id)
         mf.managed_product_id,
         mf.product_name AS fof_product_name,
         mf.beian_hao AS fof_product_code,
         r.id AS valuation_record_id,
         r.valuation_date
       FROM managed_fof mf
       INNER JOIN ops_email_valuation_records r ON (
         (NULLIF(BTRIM(mf.beian_hao), '') IS NOT NULL AND r.product_code = mf.beian_hao)
         OR ${fundMatch}
       )
       ORDER BY mf.managed_product_id, r.valuation_date DESC, r.id DESC
     ),
     underlying_rows AS (
       SELECT DISTINCT ON (lv.managed_product_id, ${underlyingKey})
         lv.managed_product_id,
         lv.fof_product_name,
         lv.fof_product_code,
         lv.valuation_date,
         lv.valuation_record_id,
         NULLIF(BTRIM(UPPER(h.symbol)), '') AS underlying_product_code,
         h.subject_name AS underlying_name,
         h.subject_code,
         CASE
           WHEN h.row_kind IN ('private_fund', 'fund_or_stock', 'fund', 'money_fund') THEN h.row_kind
           WHEN h.subject_code LIKE '1109%' OR h.subject_code LIKE '1108%'
             OR h.subject_name ~ '私募证券投资基金' OR h.subject_name ~ '私募基金'
             THEN 'private_fund'
           ELSE h.row_kind
         END AS row_kind,
         h.market_value,
         h.quantity,
         h.cost,
         h.market_weight
       FROM latest_valuation lv
       INNER JOIN ops_email_valuation_holdings h ON h.valuation_record_id = lv.valuation_record_id
       WHERE h.include_in_detail = TRUE
         AND COALESCE(h.market_value, h.cost, 0) > 0
         AND h.row_kind NOT IN (
           'bank_deposit', 'receivable', 'payable', 'settlement_reserve',
           'margin_deposit', 'clearing', 'derivative', 'stock', 'bond', 'repo'
         )
         AND NULLIF(BTRIM(h.symbol), '') IS NOT NULL
         AND BTRIM(h.symbol) ~ '^[A-Za-z0-9]+$'
         AND (
           h.row_kind IN ('private_fund', 'fund_or_stock', 'fund', 'money_fund')
           OR h.subject_code LIKE '1109%'
           OR h.subject_code LIKE '1108%'
           OR h.subject_name ~ '私募证券投资基金'
           OR h.subject_name ~ '私募基金'
           OR (h.row_kind = 'other' AND NULLIF(BTRIM(h.symbol), '') IS NOT NULL)
         )
       ORDER BY lv.managed_product_id, ${underlyingKey}, h.market_value DESC NULLS LAST
     ),
     inserted AS (
       INSERT INTO ops_managed_fof_underlying (
         managed_product_id, fof_product_name, fof_product_code,
         valuation_date, valuation_record_id,
         underlying_product_code, underlying_name, subject_code, row_kind,
         market_value, quantity, cost, market_weight
       )
       SELECT
         managed_product_id, fof_product_name, fof_product_code,
         valuation_date, valuation_record_id,
         underlying_product_code, underlying_name, subject_code, row_kind,
         market_value, quantity, cost, market_weight
       FROM underlying_rows
       ON CONFLICT (managed_product_id, valuation_date, underlying_product_code, underlying_name, subject_code)
       DO UPDATE SET
         market_value  = EXCLUDED.market_value,
         quantity      = EXCLUDED.quantity,
         cost          = EXCLUDED.cost,
         market_weight = EXCLUDED.market_weight,
         refreshed_at  = NOW()
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
    [MANAGED_FOF_EXCLUDED_PRODUCT_PATTERN],
  )

  return parseInt(rows[0]?.n ?? "0", 10)
}

export type ManagedFofUnderlyingRow = {
  id: number
  managed_product_id: number
  fof_product_name: string
  fof_product_code: string | null
  valuation_date: string
  valuation_record_id: number
  underlying_product_code: string | null
  underlying_name: string
  subject_code: string
  row_kind: string | null
  market_value: string | null
  quantity: string | null
  cost: string | null
  market_weight: string | null
  refreshed_at: string
}

function normalizeUnderlyingName(name: string): string {
  return name
    .replace(/(私募证券投资基金|私募基金|证券投资基金|投资基金)$/u, "")
    .trim()
}

/** Match managed holding rows to a summary row; share class (A/B/C) must agree when present. */
export function managedUnderlyingMatchSql(
  beianExpr: string,
  productNameExpr: string,
  alias = "m",
): string {
  const beianMatch = `NULLIF(BTRIM(UPPER(${beianExpr})), '') IS NOT NULL AND TRIM(UPPER(${alias}.underlying_product_code)) = TRIM(UPPER(${beianExpr})) AND ${sqlShareClassCodeGuard(`${alias}.underlying_product_code`, productNameExpr)}`
  const nameMatch = sqlFundNameMatch(`${alias}.underlying_name`, productNameExpr)
  const shareGuard = sqlEmailNavShareClassGuard(
    `${alias}.underlying_name`,
    productNameExpr,
    `${alias}.underlying_product_code`,
  )
  return `(${beianMatch} OR (${nameMatch} AND ${shareGuard}))`
}

/** Parameterized variant for prepared queries ($1 = beian, $2 = product name). */
export function managedUnderlyingMatchParamsSql(
  beianParam: string,
  nameParam: string,
  alias = "m",
): string {
  const beianMatch = `(${beianParam} <> '' AND NULLIF(BTRIM(UPPER(${alias}.underlying_product_code)), '') = TRIM(UPPER(${beianParam})))`
  const nameMatch = sqlFundNameMatch(`${alias}.underlying_name`, nameParam)
  const shareGuard = sqlEmailNavShareClassGuard(
    `${alias}.underlying_name`,
    nameParam,
    `${alias}.underlying_product_code`,
  )
  return `(${beianMatch} OR (${nameMatch} AND ${shareGuard}))`
}

export type UnderlyingMarketAggregate = {
  market_value: number | null
}

/** Sum of 在管产品 FOF holdings per underlying fund (by备案号 or name). */
export async function loadManagedUnderlyingMarketLookup(): Promise<{
  byProductCode: Map<string, UnderlyingMarketAggregate>
  byName: Map<string, UnderlyingMarketAggregate>
}> {
  await ensureManagedFofUnderlyingTable()

  const byCodeRows = await query<{
    underlying_product_code: string
    total_market_value: string
  }>(
    `SELECT
       TRIM(UPPER(underlying_product_code)) AS underlying_product_code,
       SUM(COALESCE(market_value, 0))::text AS total_market_value
     FROM ops_managed_fof_underlying
     WHERE COALESCE(market_value, 0) > 0
       AND NULLIF(BTRIM(underlying_product_code), '') IS NOT NULL
     GROUP BY TRIM(UPPER(underlying_product_code))`,
  )

  const byNameRows = await query<{
    underlying_name: string
    total_market_value: string
  }>(
    `SELECT
       TRIM(underlying_name) AS underlying_name,
       SUM(COALESCE(market_value, 0))::text AS total_market_value
     FROM ops_managed_fof_underlying
     WHERE COALESCE(market_value, 0) > 0
     GROUP BY TRIM(underlying_name)`,
  )

  const byProductCode = new Map<string, UnderlyingMarketAggregate>()
  const byName = new Map<string, UnderlyingMarketAggregate>()

  for (const row of byCodeRows) {
    const mv = parseFloat(row.total_market_value)
    byProductCode.set(row.underlying_product_code, {
      market_value: Number.isFinite(mv) ? mv : null,
    })
  }

  for (const row of byNameRows) {
    const mv = parseFloat(row.total_market_value)
    const metrics: UnderlyingMarketAggregate = {
      market_value: Number.isFinite(mv) ? mv : null,
    }
    byName.set(row.underlying_name, metrics)
    byName.set(normalizeUnderlyingName(row.underlying_name), metrics)
  }

  return { byProductCode, byName }
}

export function resolveManagedUnderlyingMarket(
  productName: string,
  beianHao: string | null,
  lookup: Awaited<ReturnType<typeof loadManagedUnderlyingMarketLookup>>,
): UnderlyingMarketAggregate {
  const beian = beianHao?.trim().toUpperCase()
  if (beian && lookup.byProductCode.has(beian)) {
    return lookup.byProductCode.get(beian)!
  }
  const exact = lookup.byName.get(productName.trim())
  if (exact) return exact
  const normalized = lookup.byName.get(normalizeUnderlyingName(productName))
  if (normalized) return normalized
  return { market_value: null }
}

/** Resolved 备案号: prefer cache when share-class suffix matches, else managed holdings. */
export function managedUnderlyingBeianExpr(cacheBeianCol: string, productNameExpr: string): string {
  const fallback = managedUnderlyingBeianFallbackExpr(productNameExpr)
  return `COALESCE(
    CASE
      WHEN NULLIF(BTRIM(${cacheBeianCol}), '') IS NOT NULL
        AND ${sqlShareClassCodeGuard(cacheBeianCol, productNameExpr)}
      THEN BTRIM(${cacheBeianCol})
    END,
    ${fallback}
  )`
}

/** Fallback 备案号 from managed holdings when cache has not been built yet. */
export function managedUnderlyingBeianFallbackExpr(productNameExpr: string): string {
  const nameMatch = sqlFundNameMatch("mf.underlying_name", productNameExpr)
  const shareGuard = sqlEmailNavShareClassGuard(
    "mf.underlying_name",
    productNameExpr,
    "mf.underlying_product_code",
  )
  const codeGuard = sqlShareClassCodeGuard("mf.underlying_product_code", productNameExpr)
  return `(
    SELECT NULLIF(TRIM(mf.underlying_product_code), '')
    FROM ops_managed_fof_underlying mf
    WHERE COALESCE(mf.market_value, 0) > 0
      AND ${nameMatch}
      AND ${shareGuard}
      AND ${codeGuard}
    ORDER BY mf.market_value DESC NULLS LAST
    LIMIT 1
  )`
}

export function managedUnderlyingMarketValueExpr(
  beianExpr: string,
  productNameExpr: string,
): string {
  const match = managedUnderlyingMatchSql(beianExpr, productNameExpr, "mv")
  return `(
    SELECT SUM(mv.market_value)
    FROM ops_managed_fof_underlying mv
    WHERE COALESCE(mv.market_value, 0) > 0
      AND ${match}
  )`
}

/** Prefer managed 市值 sum, then cached / summary values. */
export function effectiveUnderlyingMarketValueExpr(
  beianExpr: string,
  productNameExpr: string,
): string {
  const managedMv = managedUnderlyingMarketValueExpr(beianExpr, productNameExpr)
  return `COALESCE(NULLIF(${managedMv}, 0), cache.market_value, f.market_value)`
}

export type UnderlyingHoldingsRow = {
  id: string
  fof_product_name: string
  valuation_date: string
  quantity: string | null
  market_value: string | null
  market_weight: string | null
}

export async function listUnderlyingHoldings(options: {
  beianHao?: string | null
  productName: string
}): Promise<{
  rows: UnderlyingHoldingsRow[]
  totalQuantity: string | null
  totalMarketValue: string | null
}> {
  await ensureManagedFofUnderlyingTable()

  const beian = options.beianHao?.trim() || ""
  const productName = options.productName.trim()
  const matchSql = managedUnderlyingMatchParamsSql("$1", "$2")

  const rows = await query<{
    id: string
    fof_product_name: string
    valuation_date: string | Date
    quantity: string | null
    market_value: string | null
    market_weight: string | null
  }>(
    `SELECT
       m.id::text,
       m.fof_product_name,
       m.valuation_date,
       m.quantity::text,
       m.market_value::text,
       m.market_weight::text
     FROM ops_managed_fof_underlying m
     WHERE COALESCE(m.market_value, 0) > 0
       AND ${matchSql}
     ORDER BY m.market_value DESC NULLS LAST, m.fof_product_name ASC`,
    [beian, productName],
  )

  let totalQty = 0
  let totalMv = 0
  for (const row of rows) {
    const q = row.quantity != null ? parseFloat(row.quantity) : NaN
    const mv = row.market_value != null ? parseFloat(row.market_value) : NaN
    if (Number.isFinite(q)) totalQty += q
    if (Number.isFinite(mv)) totalMv += mv
  }

  return {
    rows: rows.map((r) => ({
      id: r.id,
      fof_product_name: r.fof_product_name,
      valuation_date: typeof r.valuation_date === "string"
        ? r.valuation_date.slice(0, 10)
        : r.valuation_date.toISOString().slice(0, 10),
      quantity: r.quantity,
      market_value: r.market_value,
      market_weight: r.market_weight,
    })),
    totalQuantity: rows.length > 0 ? String(totalQty) : null,
    totalMarketValue: rows.length > 0 ? String(totalMv) : null,
  }
}

export async function listManagedFofUnderlying(options?: {
  managedProductId?: number
  fofProductCode?: string
  fofProductName?: string
  limit?: number
  offset?: number
}): Promise<{ rows: ManagedFofUnderlyingRow[]; total: number }> {
  await ensureManagedFofUnderlyingTable()

  const conditions: string[] = []
  const params: unknown[] = []
  let idx = 1

  if (options?.managedProductId != null) {
    conditions.push(`managed_product_id = $${idx++}`)
    params.push(options.managedProductId)
  }
  if (options?.fofProductCode) {
    conditions.push(`fof_product_code = $${idx++}`)
    params.push(options.fofProductCode)
  }
  if (options?.fofProductName) {
    conditions.push(`fof_product_name ILIKE $${idx++}`)
    params.push(`%${options.fofProductName}%`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = Math.min(options?.limit ?? 500, 2000)
  const offset = options?.offset ?? 0

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ops_managed_fof_underlying ${where}`,
    params,
  )

  const rows = await query<ManagedFofUnderlyingRow>(
    `SELECT * FROM ops_managed_fof_underlying
     ${where}
     ORDER BY fof_product_name, market_value DESC NULLS LAST
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  )

  return { rows, total: parseInt(countRows[0]?.count ?? "0", 10) }
}
