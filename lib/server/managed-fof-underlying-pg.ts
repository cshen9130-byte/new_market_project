/**
 * 在管产品 FOF 底层持仓 — extracted from email 估值表.
 * All managed products are treated as FOF except 荣熙恒盈2号.
 */

import { fmtIso, query } from "@/lib/db"
import {
  BatchNavResolver,
  addDays,
  type NavPoint,
  type ProductNavIdentity,
} from "@/lib/server/list-cache-nav-batch"
import { ensureEmailValuationMetricsTables } from "@/lib/server/email-valuation-metrics-pg"
import { ensureEmailValuationHoldingsTables } from "@/lib/server/email-valuation-holdings-pg"
import {
  buildFofUnderlyingSummaryFrom,
  buildManagedProductsFrom,
  FOF_UNDERLYING_BEIAN_EXPR,
  fofUnderlyingBeianExpr,
} from "@/lib/server/fof-underlying-query"
import {
  fundDisplayNamesMatch,
  shareClassCodeMatchesProductLenient,
  shareClassProductNamesMatch,
  sqlFundNameMatch,
  sqlShareClassCodeGuard,
  sqlShareClassHoldingCodeGuard,
  sqlShareClassProductNameGuard,
} from "@/lib/server/fund-name-match"
import { backfillFundHoldingSymbols, fofUnderlyingNavLookupKeys, resolveFundHoldingCode, SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF, SQL_VALUATION_HOLDING_IS_DIRECT_EQUITY_OR_ETF, formatFundHoldingCode, isDirectEquityOrEtfValuationHolding } from "@/lib/server/fund-holding-code"
import type { ValuationRow } from "@/lib/server/valuation-analyzer"

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
    unit_nav                 NUMERIC(16,6),
    nav_date                 DATE,
    price_change             NUMERIC(10,4),
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

const MIGRATE_NAV_COLUMNS = [
  `ALTER TABLE ops_managed_fof_underlying ADD COLUMN IF NOT EXISTS unit_nav NUMERIC(16,6)`,
  `ALTER TABLE ops_managed_fof_underlying ADD COLUMN IF NOT EXISTS nav_date DATE`,
  `ALTER TABLE ops_managed_fof_underlying ADD COLUMN IF NOT EXISTS price_change NUMERIC(10,4)`,
  `ALTER TABLE ops_managed_fof_underlying ADD COLUMN IF NOT EXISTS price NUMERIC(16,6)`,
  `CREATE INDEX IF NOT EXISTS idx_managed_fof_underlying_fof_name
     ON ops_managed_fof_underlying (fof_product_name)`,
]

let tableEnsured = false

export async function ensureManagedFofUnderlyingTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  await query(MIGRATE_UNIQUE_SQL)
  for (const stmt of MIGRATE_NAV_COLUMNS) {
    await query(stmt)
  }
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
         h.market_weight,
         h.price
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
         AND NOT ${SQL_VALUATION_HOLDING_IS_DIRECT_EQUITY_OR_ETF}
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
         market_value, quantity, cost, market_weight, price
       )
       SELECT
         managed_product_id, fof_product_name, fof_product_code,
         valuation_date, valuation_record_id,
         underlying_product_code, underlying_name, subject_code, row_kind,
         market_value, quantity, cost, market_weight, price
       FROM underlying_rows
       ON CONFLICT (managed_product_id, valuation_date, underlying_product_code, underlying_name, subject_code)
       DO UPDATE SET
         market_value  = EXCLUDED.market_value,
         quantity      = EXCLUDED.quantity,
         cost          = EXCLUDED.cost,
         market_weight = EXCLUDED.market_weight,
         price         = EXCLUDED.price,
         refreshed_at  = NOW()
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
    [MANAGED_FOF_EXCLUDED_PRODUCT_PATTERN],
  )

  const inserted = parseInt(rows[0]?.n ?? "0", 10)
  if (inserted > 0) {
    await backfillManagedFofUnderlyingNavFields()
  }
  return inserted
}

let navBackfillInFlight: Promise<number> | null = null

/** Populate precomputed NAV columns so list API avoids per-request BatchNavResolver. */
export async function backfillManagedFofUnderlyingNavFields(): Promise<number> {
  await ensureManagedFofUnderlyingTable()

  const rawRows = await query<DetailRawRow>(
    `SELECT
       m.id,
       m.fof_product_name AS fof_fund_name,
       m.underlying_name AS product_name,
       NULLIF(BTRIM(m.underlying_product_code), '') AS beian_hao,
       m.valuation_date,
       m.quantity AS investment_shares,
       m.market_value,
       m.market_weight,
       m.price
     FROM ops_managed_fof_underlying m
     WHERE COALESCE(m.market_value, 0) > 0`,
  )
  if (rawRows.length === 0) return 0

  const asOfDate = new Date().toISOString().slice(0, 10)
  const identities: ProductNavIdentity[] = rawRows.map((r) => ({
    beian_hao: r.beian_hao,
    product_name: r.product_name,
    short_name: null,
  }))
  const resolver = await BatchNavResolver.create(identities, asOfDate)
  const valuationNavSince = addDays(asOfDate, 400)
  const valuationNavHistory = await loadManagedUnderlyingNavHistory(valuationNavSince)
  resolver.setValuationNavHistory(valuationNavHistory.byCode, valuationNavHistory.byName)
  const enriched = enrichDetailRows(rawRows, resolver)

  const CHUNK = 100
  for (let i = 0; i < enriched.length; i += CHUNK) {
    const chunk = enriched.slice(i, i + CHUNK)
    const values: unknown[] = []
    const placeholders: string[] = []
    let pi = 1
    for (const row of chunk) {
      placeholders.push(
        `($${pi}::bigint, $${pi + 1}::numeric, $${pi + 2}::date, $${pi + 3}::numeric)`,
      )
      values.push(
        parseInt(row.id, 10),
        row.unit_nav != null ? parseFloat(row.unit_nav) : null,
        row.nav_date,
        row.price_change != null ? parseFloat(row.price_change) : null,
      )
      pi += 4
    }
    await query(
      `UPDATE ops_managed_fof_underlying AS m SET
         unit_nav = v.unit_nav,
         nav_date = v.nav_date,
         price_change = v.price_change
       FROM (VALUES ${placeholders.join(", ")}) AS v(id, unit_nav, nav_date, price_change)
       WHERE m.id = v.id`,
      values,
    )
  }

  return enriched.length
}

/** Backfill NAV columns in background when missing (e.g. after schema migration). */
async function ensureManagedFofUnderlyingNavPopulated(): Promise<void> {
  await ensureManagedFofUnderlyingTable()
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_managed_fof_underlying
     WHERE COALESCE(market_value, 0) > 0 AND unit_nav IS NULL`,
  )
  if (parseInt(rows[0]?.n ?? "0", 10) === 0 || navBackfillInFlight) return
  navBackfillInFlight = backfillManagedFofUnderlyingNavFields()
    .catch((err) => {
      console.error("[managed-fof-underlying] NAV backfill failed:", err)
      return 0
    })
    .finally(() => {
      navBackfillInFlight = null
    })
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

/** Holding rows eligible for FOF underlying NAV extraction (alias h), excluding include_in_detail. */
const SQL_FOF_VALUATION_HOLDING_CORE_FILTERS = `
  AND COALESCE(h.market_value, h.cost, 0) > 0
  AND h.row_kind NOT IN (
    'bank_deposit', 'receivable', 'payable', 'settlement_reserve',
    'margin_deposit', 'clearing', 'derivative', 'stock', 'bond', 'repo'
  )
  AND NOT ${SQL_VALUATION_HOLDING_IS_DIRECT_EQUITY_OR_ETF}
  AND (
    h.row_kind IN ('private_fund', 'fund_or_stock', 'fund', 'money_fund')
    OR h.subject_code LIKE '1109%'
    OR h.subject_code LIKE '1108%'
    OR h.subject_name ~ '私募证券投资基金'
    OR h.subject_name ~ '私募基金'
    OR h.row_kind = 'other'
  )`

/** Holdings inside managed-FOF 估值表 attachments (all dates, not just latest snapshot). */
export async function loadManagedFofValuationHoldingRows(
  sinceDate: string,
  subjectCodes: string[] = [],
): Promise<{
  subject_name: string
  subject_code: string
  symbol: string | null
  valuation_date: string
  price: string | null
  quantity: string | null
  market_value: string | null
}[]> {
  const managedProductExpr = "m.product_name"
  const managedBeianExpr = fofUnderlyingBeianExpr(managedProductExpr)
  const fundMatch = sqlFundNameMatch("r.fund_name", "mf.product_name")
  const detailFilter = subjectCodes.length > 0
    ? `(h.include_in_detail = TRUE OR h.subject_code = ANY($3::text[]))`
    : `h.include_in_detail = TRUE`

  return query(
    `WITH managed_fof AS (
       SELECT
         m.id AS managed_product_id,
         m.product_name,
         ${managedBeianExpr} AS beian_hao
       ${buildManagedProductsFrom(managedProductExpr)}
       WHERE m.product_name <> '合计'
         AND m.product_name NOT ILIKE $2
     )
     SELECT
       TRIM(h.subject_name) AS subject_name,
       h.subject_code,
       h.symbol,
       r.valuation_date::text AS valuation_date,
       h.price, h.quantity, h.market_value
     FROM managed_fof mf
     INNER JOIN ops_email_valuation_records r ON (
       (NULLIF(BTRIM(mf.beian_hao), '') IS NOT NULL AND r.product_code = mf.beian_hao)
       OR ${fundMatch}
     )
     INNER JOIN ops_email_valuation_holdings h ON h.valuation_record_id = r.id
     WHERE r.valuation_date >= $1::date
       AND ${detailFilter}
       ${SQL_FOF_VALUATION_HOLDING_CORE_FILTERS}
     ORDER BY r.valuation_date ASC`,
    subjectCodes.length > 0
      ? [sinceDate, MANAGED_FOF_EXCLUDED_PRODUCT_PATTERN, subjectCodes]
      : [sinceDate, MANAGED_FOF_EXCLUDED_PRODUCT_PATTERN],
  )
}

/** Match managed holding rows to a summary row; A/B/C share class must agree. */
export function managedUnderlyingMatchSql(
  beianExpr: string,
  productNameExpr: string,
  alias = "m",
): string {
  const codeCol = `${alias}.underlying_product_code`
  const nameCol = `${alias}.underlying_name`
  const codePresent = `NULLIF(BTRIM(${codeCol}), '') IS NOT NULL`
  const beianMatch = `NULLIF(BTRIM(UPPER(${beianExpr})), '') IS NOT NULL AND ${codePresent} AND TRIM(UPPER(${codeCol})) = TRIM(UPPER(${beianExpr})) AND ${sqlShareClassCodeGuard(codeCol, productNameExpr)}`
  const nameMatch = sqlFundNameMatch(nameCol, productNameExpr)
  const shareGuard = sqlShareClassProductNameGuard(nameCol, productNameExpr)
  const codeShareGuard = `(NOT ${codePresent} OR ${sqlShareClassCodeGuard(codeCol, productNameExpr)})`
  return `(${beianMatch} OR (${nameMatch} AND ${shareGuard} AND ${codeShareGuard}))`
}

/** Match ops_email_valuation_holdings rows (subject_name / symbol columns). */
export function valuationHoldingMatchSql(
  beianExpr: string,
  productNameExpr: string,
  alias = "h",
): string {
  const codeCol = `${alias}.symbol`
  const nameCol = `${alias}.subject_name`
  const codePresent = `NULLIF(BTRIM(${codeCol}), '') IS NOT NULL`
  const beianMatch = `NULLIF(BTRIM(UPPER(${beianExpr})), '') IS NOT NULL AND ${codePresent} AND TRIM(UPPER(${codeCol})) = TRIM(UPPER(${beianExpr})) AND ${sqlShareClassCodeGuard(codeCol, productNameExpr)}`
  const nameMatch = sqlFundNameMatch(nameCol, productNameExpr)
  const shareGuard = sqlShareClassProductNameGuard(nameCol, productNameExpr)
  const codeShareGuard = sqlShareClassHoldingCodeGuard(codeCol, nameCol, productNameExpr)
  return `(${beianMatch} OR (${nameMatch} AND ${shareGuard} AND ${codeShareGuard}))`
}

export type ValuationHoldingMatchRow = {
  subject_name: string
  subject_code: string
  symbol: string | null
}

export type UnderlyingNavTarget = {
  product_name: string
  beian_hao: string | null
}

export function resolveValuationHoldingCode(row: ValuationHoldingMatchRow): string | null {
  return formatFundHoldingCode(
    resolveFundHoldingCode(row.subject_code, row.subject_name, row.symbol) ?? row.symbol,
  )
}

/** Match a normalized valuation holding row to a fof_underlying_summary target. */
export function matchValuationHoldingToTarget(
  row: ValuationHoldingMatchRow,
  target: UnderlyingNavTarget,
  opts?: { subject_codes?: Set<string> },
): boolean {
  const subjectName = row.subject_name.trim()
  const subjectCode = row.subject_code.trim()
  const code = resolveValuationHoldingCode(row)
  const beian = target.beian_hao?.trim().toUpperCase() ?? null
  const lookupKeys = new Set(
    fofUnderlyingNavLookupKeys(target.product_name, target.beian_hao, null).map((k) => k.toUpperCase()),
  )

  const codeOk = (c: string | null) =>
    !c || shareClassCodeMatchesProductLenient(c, subjectName, target.product_name)

  if (opts?.subject_codes?.has(subjectCode)) {
    return shareClassProductNamesMatch(subjectName, target.product_name) && codeOk(code)
  }

  if (code && beian && code.toUpperCase() === beian) {
    return shareClassProductNamesMatch(subjectName, target.product_name) && codeOk(code)
  }
  if (code && lookupKeys.has(code.toUpperCase())) {
    return shareClassProductNamesMatch(subjectName, target.product_name) && codeOk(code)
  }
  if (!fundDisplayNamesMatch(subjectName, target.product_name)) return false
  return codeOk(code)
}

function buildUnderlyingTargetCodeIndex(
  targets: UnderlyingNavTarget[],
): Map<string, UnderlyingNavTarget[]> {
  const index = new Map<string, UnderlyingNavTarget[]>()
  for (const target of targets) {
    for (const key of fofUnderlyingNavLookupKeys(target.product_name, target.beian_hao, null)) {
      if (!/^[A-Z0-9]+$/i.test(key)) continue
      const upper = key.toUpperCase()
      const list = index.get(upper) ?? []
      if (!list.some((t) => t.product_name === target.product_name)) list.push(target)
      index.set(upper, list)
    }
  }
  return index
}

async function loadUnderlyingSubjectCodeHints(
  targets: UnderlyingNavTarget[],
): Promise<Map<string, Set<string>>> {
  const rows = await query<{
    underlying_name: string
    underlying_product_code: string | null
    subject_code: string
  }>(
    `SELECT DISTINCT underlying_name, underlying_product_code, subject_code
     FROM ops_managed_fof_underlying
     WHERE NULLIF(BTRIM(subject_code), '') IS NOT NULL`,
  )

  const hints = new Map<string, Set<string>>()
  for (const row of rows) {
    const code = row.subject_code.trim()
    if (!code) continue
    for (const target of targets) {
      const beian = target.beian_hao?.trim().toUpperCase() ?? ""
      const rowCode = row.underlying_product_code?.trim().toUpperCase() ?? ""
      const nameOk = fundDisplayNamesMatch(row.underlying_name, target.product_name)
      const codeOk = Boolean(beian && rowCode && rowCode === beian)
      if (!nameOk && !codeOk) continue
      const set = hints.get(target.product_name) ?? new Set<string>()
      set.add(code)
      hints.set(target.product_name, set)
    }
  }
  return hints
}

/** Parameterized variant for prepared queries ($1 = beian, $2 = product name). */
export function managedUnderlyingMatchParamsSql(
  beianParam: string,
  nameParam: string,
  alias = "m",
): string {
  const codeCol = `${alias}.underlying_product_code`
  const nameCol = `${alias}.underlying_name`
  const codePresent = `NULLIF(BTRIM(${codeCol}), '') IS NOT NULL`
  const beianMatch = `(${beianParam} <> '' AND ${codePresent} AND TRIM(UPPER(${codeCol})) = TRIM(UPPER(${beianParam})) AND ${sqlShareClassCodeGuard(codeCol, nameParam)})`
  const nameMatch = sqlFundNameMatch(nameCol, nameParam)
  const shareGuard = sqlShareClassProductNameGuard(nameCol, nameParam)
  const codeShareGuard = `(NOT ${codePresent} OR ${sqlShareClassCodeGuard(codeCol, nameParam)})`
  return `(${beianMatch} OR (${nameMatch} AND ${shareGuard} AND ${codeShareGuard}))`
}

/** Per-summary-row managed 市值 from email 估值表 holdings (same match as 持仓 modal). */
export async function loadManagedUnderlyingMarketValueMap(): Promise<Map<string, number>> {
  await ensureManagedFofUnderlyingTable()

  const managedMv = managedUnderlyingMarketValueExpr(FOF_UNDERLYING_BEIAN_EXPR, "f.product_name")
  const rows = await query<{ id: string; market_value: string | null }>(
    `SELECT f.id::text AS id, (${managedMv})::text AS market_value
     ${buildFofUnderlyingSummaryFrom("f.product_name")}
     WHERE f.product_name <> '合计'`,
  )

  const map = new Map<string, number>()
  for (const row of rows) {
    const mv = row.market_value != null ? parseFloat(row.market_value) : NaN
    if (Number.isFinite(mv) && mv > 0) map.set(row.id, mv)
  }
  return map
}

export type UnderlyingMarketAggregate = {
  market_value: number | null
}

export type UnderlyingValuationNav = {
  unit_nav: number | null
  nav_date: string | null
}

/** 市价 column from 估值表 — same plausibility band as buildFundHoldings. */
export function parseValuationTablePrice(value: unknown): number | null {
  const n = parseFloat(String(value ?? ""))
  if (Number.isFinite(n) && n > 0.05 && n < 500) return n
  return null
}

/** Unit NAV from 估值表 holding row: 市价 first, else 市值/份额. */
export function resolveNavFromValuationTable(
  price: unknown,
  quantity: unknown,
  marketValue: unknown,
): number | null {
  return parseValuationTablePrice(price) ?? deriveNavFromValuation(quantity, marketValue)
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

/** Latest 估值表-derived NAV per underlying (by备案号 or name). */
export async function loadManagedUnderlyingValuationNavLookup(): Promise<{
  byProductCode: Map<string, UnderlyingValuationNav>
  byName: Map<string, UnderlyingValuationNav>
}> {
  await ensureManagedFofUnderlyingTable()

  const rows = await query<{
    underlying_product_code: string | null
    underlying_name: string
    valuation_date: string | Date
    price: string | null
    quantity: string | null
    market_value: string | null
  }>(
    `WITH ranked AS (
       SELECT
         NULLIF(TRIM(UPPER(underlying_product_code)), '') AS underlying_product_code,
         TRIM(underlying_name) AS underlying_name,
         valuation_date,
         price,
         quantity,
         market_value,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(NULLIF(TRIM(UPPER(underlying_product_code)), ''), TRIM(underlying_name))
           ORDER BY valuation_date DESC, market_value DESC NULLS LAST
         ) AS rn
       FROM ops_managed_fof_underlying
       WHERE COALESCE(market_value, 0) > 0
     )
     SELECT underlying_product_code, underlying_name, valuation_date, price, quantity, market_value
     FROM ranked
     WHERE rn = 1`,
  )

  const byProductCode = new Map<string, UnderlyingValuationNav>()
  const byName = new Map<string, UnderlyingValuationNav>()

  for (const row of rows) {
    const nav = resolveNavFromValuationTable(row.price, row.quantity, row.market_value)
    const navDate = fmtIso(row.valuation_date)
    const entry: UnderlyingValuationNav = {
      unit_nav: nav,
      nav_date: nav != null ? navDate : null,
    }
    const code = row.underlying_product_code?.trim().toUpperCase()
    if (code) byProductCode.set(code, entry)
    byName.set(row.underlying_name, entry)
    byName.set(normalizeUnderlyingName(row.underlying_name), entry)
  }

  return { byProductCode, byName }
}

/**
 * Load historical NAV from 估值表 when 净值表 has no usable series.
 * Sources (merged, custody wins on same date):
 * 1. FOF holding rows across ALL managed-FOF 估值表 dates (not just latest snapshot)
 * 2. Direct custody 估值表 unit_nav from ops_email_valuation_records
 */
export async function loadManagedUnderlyingNavHistory(
  sinceDate: string,
  options?: {
    /** Skip scanning 97k holdings to patch symbol — safe when symbols already populated. */
    skipSymbolBackfill?: boolean
    /** Reuse summary rows from caller to avoid repeating beian lateral joins. */
    targets?: UnderlyingNavTarget[]
  },
): Promise<{
  byCode: Map<string, NavPoint[]>
  byName: Map<string, NavPoint[]>
}> {
  await ensureManagedFofUnderlyingTable()
  await ensureEmailValuationHoldingsTables()
  if (!options?.skipSymbolBackfill) {
    console.error("[managed-fof-underlying] backfilling fund holding symbols…")
    await backfillFundHoldingSymbols()
  }

  const byCode = new Map<string, NavPoint[]>()
  const byName = new Map<string, NavPoint[]>()

  const productExpr = "f.product_name"
  const beianExpr = FOF_UNDERLYING_BEIAN_EXPR

  const targets = options?.targets?.length
    ? options.targets
    : await query<UnderlyingNavTarget>(
      `SELECT f.product_name, ${beianExpr} AS beian_hao
       ${buildFofUnderlyingSummaryFrom(productExpr)}
       WHERE f.product_name <> '合计'`,
    )
  const targetIndexByCode = buildUnderlyingTargetCodeIndex(targets)
  const subjectCodeHints = await loadUnderlyingSubjectCodeHints(targets)
  const knownSubjectCodes = [...new Set(
    [...subjectCodeHints.values()].flatMap((codes) => [...codes]),
  )]

  const holdingCandidates = await loadManagedFofValuationHoldingRows(sinceDate, knownSubjectCodes)

  console.error(
    `[managed-fof-underlying] scanning ${holdingCandidates.length} FOF 估值表 holding rows since ${sinceDate}`,
  )

  const seenHoldings = new Set<string>()

  const indexPoint = (
    productName: string,
    beian: string | null,
    point: NavPoint,
    replaceExisting = false,
  ) => {
    const push = (map: Map<string, NavPoint[]>, key: string) => {
      const arr = map.get(key) ?? []
      const idx = arr.findIndex((p) => p.nav_date === point.nav_date)
      if (idx >= 0) {
        if (replaceExisting) arr[idx] = point
      } else {
        arr.push(point)
      }
      map.set(key, arr)
    }
    for (const key of fofUnderlyingNavLookupKeys(productName, beian, null)) {
      if (/^[A-Z0-9]+$/i.test(key)) push(byCode, key.toUpperCase())
      else push(byName, key)
    }
  }

  let matchedHoldingRows = 0

  for (const row of holdingCandidates) {
    const name = row.subject_name
    const code = resolveValuationHoldingCode(row)
    if (!code && !/私募/u.test(name)) continue

    const nav = resolveNavFromValuationTable(row.price, row.quantity, row.market_value)
    if (nav == null || nav <= 0) continue

    const navDate = row.valuation_date.slice(0, 10)
    const matchedTargets = new Set<string>()

    const attachTarget = (target: UnderlyingNavTarget) => {
      if (matchedTargets.has(target.product_name)) return
      if (!matchValuationHoldingToTarget(row, target, {
        subject_codes: subjectCodeHints.get(target.product_name),
      })) return
      matchedTargets.add(target.product_name)
      const dedupe = `${target.product_name}\0${navDate}`
      if (seenHoldings.has(dedupe)) return
      seenHoldings.add(dedupe)
      matchedHoldingRows++
      indexPoint(target.product_name, target.beian_hao ?? code, { nav, nav_date: navDate })
    }

    if (code) {
      for (const target of targetIndexByCode.get(code.toUpperCase()) ?? []) attachTarget(target)
    }
    if (matchedTargets.size === 0) {
      for (const target of targets) attachTarget(target)
    }
  }

  console.error(
    `[managed-fof-underlying] matched ${matchedHoldingRows} FOF underlying holding rows since ${sinceDate}`,
  )

  const jsonbPoints = await appendHistoryFromValuationJsonb(
    sinceDate,
    seenHoldings,
    (name, code, point) => {
      indexPoint(name, code, point)
    },
    subjectCodeHints,
  )
  if (jsonbPoints > 0) {
    console.error(`[managed-fof-underlying] JSONB 估值表 NAV history: ${jsonbPoints} points`)
  }

  const { loadCustodyValuationNavHistory } = await import("@/lib/server/email-valuation-nav-backfill")
  const custody = await loadCustodyValuationNavHistory(sinceDate)
  for (const [code, points] of custody.byCode) {
    for (const point of points) indexPoint(code, code, point, true)
  }
  for (const [name, points] of custody.byName) {
    for (const point of points) indexPoint(name, null, point, true)
  }

  for (const map of [byCode, byName]) {
    for (const [key, arr] of map) {
      arr.sort((a, b) => b.nav_date.localeCompare(a.nav_date))
      map.set(key, arr)
    }
  }

  return { byCode, byName }
}

const EXCLUDED_ROW_KINDS = new Set([
  "bank_deposit", "receivable", "payable", "settlement_reserve",
  "margin_deposit", "clearing", "derivative", "stock", "bond", "repo",
])

function parseHoldingAmount(value: unknown): number {
  const n = parseFloat(String(value ?? ""))
  return Number.isFinite(n) ? n : 0
}

function isPrivateFundUnderlyingValuationRow(row: ValuationRow): boolean {
  if (row.include_in_detail === false) return false
  const marketValue = parseHoldingAmount(row.market_value ?? row.signed_market_value ?? row.notional_value)
  const cost = parseHoldingAmount(row.cost ?? row.signed_cost)
  if (marketValue <= 0 && cost <= 0) return false

  const subjectCode = String(row.code ?? "")
  const subjectName = String(row.name ?? "")
  const rowKind = String(row.row_kind ?? "")
  const symbol = row.symbol != null ? String(row.symbol) : null

  if (EXCLUDED_ROW_KINDS.has(rowKind)) return false
  if (isDirectEquityOrEtfValuationHolding(subjectName, subjectCode, symbol, rowKind)) return false

  return (
    rowKind === "private_fund"
    || rowKind === "fund_or_stock"
    || rowKind === "fund"
    || rowKind === "money_fund"
    || subjectCode.startsWith("1109")
    || subjectCode.startsWith("1108")
    || /私募证券投资基金|私募基金/u.test(subjectName)
    || rowKind === "other"
  )
}

/** Parse FOF underlying NAV points from stored 估值表 JSONB (when normalized holdings table is empty). */
async function appendHistoryFromValuationJsonb(
  sinceDate: string,
  seenHoldings: Set<string>,
  indexPoint: (productName: string, beian: string | null, point: NavPoint) => void,
  subjectCodeHints: Map<string, Set<string>>,
): Promise<number> {
  const { ensureEmailValuationTable } = await import("@/lib/server/email-valuation-pg")
  await ensureEmailValuationTable()

  const productExpr = "f.product_name"
  const targets = await query<{ product_name: string; beian_hao: string | null }>(
    `SELECT f.product_name, ${FOF_UNDERLYING_BEIAN_EXPR} AS beian_hao
     ${buildFofUnderlyingSummaryFrom(productExpr)}
     WHERE f.product_name <> '合计'`,
  )

  const targetIndexByCode = buildUnderlyingTargetCodeIndex(targets)

  const managedProductExpr = "m.product_name"
  const managedBeianExpr = fofUnderlyingBeianExpr(managedProductExpr)
  const fundMatch = sqlFundNameMatch("r.fund_name", "mf.product_name")

  const records = await query<{ valuation_date: string; holdings: ValuationRow[] }>(
    `WITH managed_fof AS (
       SELECT
         m.id AS managed_product_id,
         m.product_name,
         ${managedBeianExpr} AS beian_hao
       ${buildManagedProductsFrom(managedProductExpr)}
       WHERE m.product_name <> '合计'
         AND m.product_name NOT ILIKE $2
     )
     SELECT r.valuation_date::text, r.holdings
     FROM managed_fof mf
     INNER JOIN ops_email_valuation_records r ON (
       (NULLIF(BTRIM(mf.beian_hao), '') IS NOT NULL AND r.product_code = mf.beian_hao)
       OR ${fundMatch}
     )
     WHERE r.valuation_date >= $1::date
       AND jsonb_array_length(r.holdings) > 0
     ORDER BY r.valuation_date ASC`,
    [sinceDate, MANAGED_FOF_EXCLUDED_PRODUCT_PATTERN],
  )

  let saved = 0
  for (let ri = 0; ri < records.length; ri++) {
    const record = records[ri]
    if (ri > 0 && ri % 200 === 0) {
      console.error(`[managed-fof-underlying] JSONB scan ${ri}/${records.length} valuation records…`)
    }
    const navDate = record.valuation_date.slice(0, 10)
    const rows = Array.isArray(record.holdings) ? record.holdings : []
    for (const row of rows) {
      if (!isPrivateFundUnderlyingValuationRow(row)) continue

      const subjectName = String(row.name ?? "").trim()
      const subjectCode = String(row.code ?? "")
      const symbol = row.symbol != null ? String(row.symbol) : null
      const code = formatFundHoldingCode(
        resolveFundHoldingCode(subjectCode, subjectName, symbol) ?? symbol,
      )
      const holdingRow: ValuationHoldingMatchRow = { subject_name: subjectName, subject_code: subjectCode, symbol }
      if (!code && !/私募/u.test(subjectName)) continue

      const nav = resolveNavFromValuationTable(
        row.price ?? row.current_price,
        row.quantity ?? row.position ?? row.volume,
        row.market_value ?? row.signed_market_value,
      )
      if (nav == null || nav <= 0) continue

      const matchedTargets = new Set<string>()
      const attachTarget = (target: UnderlyingNavTarget) => {
        if (matchedTargets.has(target.product_name)) return
        if (!matchValuationHoldingToTarget(holdingRow, target, {
          subject_codes: subjectCodeHints.get(target.product_name),
        })) return
        matchedTargets.add(target.product_name)
        const dedupe = `${target.product_name}\0${navDate}`
        if (seenHoldings.has(dedupe)) return
        seenHoldings.add(dedupe)
        indexPoint(target.product_name, target.beian_hao ?? code, { nav, nav_date: navDate })
        saved++
      }

      if (code) {
        for (const target of targetIndexByCode.get(code.toUpperCase()) ?? []) attachTarget(target)
      }
      if (matchedTargets.size === 0) {
        for (const target of targets) attachTarget(target)
      }
    }
  }
  return saved
}

export function resolveManagedUnderlyingValuationNav(
  productName: string,
  beianHao: string | null,
  lookup: Awaited<ReturnType<typeof loadManagedUnderlyingValuationNavLookup>>,
): UnderlyingValuationNav {
  const beian = beianHao?.trim().toUpperCase()
  if (beian && lookup.byProductCode.has(beian)) {
    return lookup.byProductCode.get(beian)!
  }
  const exact = lookup.byName.get(productName.trim())
  if (exact) return exact
  const normalized = lookup.byName.get(normalizeUnderlyingName(productName))
  if (normalized) return normalized
  return { unit_nav: null, nav_date: null }
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
  const shareGuard = sqlShareClassProductNameGuard("mf.underlying_name", productNameExpr)
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
       MIN(m.id)::text AS id,
       m.fof_product_name,
       m.valuation_date,
       SUM(m.quantity)::text AS quantity,
       SUM(m.market_value)::text AS market_value,
       SUM(m.market_weight)::text AS market_weight
     FROM ops_managed_fof_underlying m
     WHERE COALESCE(m.market_value, 0) > 0
       AND NOT ${SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF}
       AND ${matchSql}
     GROUP BY m.managed_product_id, m.fof_product_name, m.valuation_date
     ORDER BY SUM(m.market_value) DESC NULLS LAST, m.fof_product_name ASC`,
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

export type ManagedFofDetailListRow = {
  id: string
  seq_no: number | null
  fof_fund_name: string
  product_name: string
  short_name: string | null
  beian_hao: string | null
  unit_nav: string | null
  nav_date: string | null
  price_change: string | null
  investment_shares: string | null
  market_value: string | null
  market_value_pct: string | null
  ret_1w: string | null
  ret_1m: string | null
  ret_3m: string | null
  ret_6m: string | null
  ret_1y: string | null
  sharpe_1y: string | null
  calmar_1y: string | null
}

const DETAIL_SORT_COLS: Record<string, string> = {
  seq_no: "m.id",
  fof_fund_name: "m.fof_product_name",
  product_name: "m.underlying_name",
  beian_hao: "m.underlying_product_code",
  unit_nav: "unit_nav",
  nav_date: "nav_date",
  price_change: "price_change",
  investment_shares: "m.quantity",
  market_value: "m.market_value",
  market_value_pct: "m.market_weight",
  ret_1w: "m.id",
  ret_1m: "m.id",
  ret_3m: "m.id",
  ret_6m: "m.id",
  ret_1y: "m.id",
  sharpe_1y: "m.id",
  calmar_1y: "m.id",
}

/** Sort keys that can paginate in SQL without loading the full holdings table. */
const DETAIL_SQL_SORT: Record<string, string> = {
  fof_fund_name: "m.fof_product_name",
  product_name: "m.underlying_name",
  beian_hao: "m.underlying_product_code",
  unit_nav: "m.unit_nav",
  nav_date: "m.nav_date",
  price_change: "m.price_change",
  investment_shares: "m.quantity",
  market_value: "m.market_value",
  market_value_pct: "m.market_weight",
  ret_1w: "m.id",
  ret_1m: "m.id",
  ret_3m: "m.id",
  ret_6m: "m.id",
  ret_1y: "m.id",
  sharpe_1y: "m.id",
  calmar_1y: "m.id",
}

const DETAIL_DEFAULT_ORDER = "m.fof_product_name ASC, m.market_value DESC NULLS LAST, m.id ASC"

function fmtMarketValuePct(weight: unknown): string | null {
  if (weight == null) return null
  const n = parseFloat(String(weight))
  if (isNaN(n)) return null
  return String(Math.abs(n) <= 1 ? n * 100 : n)
}

/** Private-fund unit NAV should sit in a sane range; reject cost / cumulative NAV mismatches. */
const MAX_PLAUSIBLE_UNIT_NAV = 50
const MAX_DAILY_RETURN = 0.5

function isPlausibleUnitNav(nav: number): boolean {
  return Number.isFinite(nav) && nav >= 0.1 && nav <= MAX_PLAUSIBLE_UNIT_NAV
}

function deriveNavFromValuation(quantity: unknown, marketValue: unknown): number | null {
  const qty = parseFloat(String(quantity ?? ""))
  const mv = parseFloat(String(marketValue ?? ""))
  if (!Number.isFinite(qty) || !Number.isFinite(mv) || qty <= 0 || mv <= 0) return null
  const nav = mv / qty
  return isPlausibleUnitNav(nav) ? nav : null
}

function fmtPriceChangePct(decimal: number | null): string | null {
  if (decimal == null || !Number.isFinite(decimal)) return null
  if (Math.abs(decimal) > MAX_DAILY_RETURN) return null
  return String(decimal * 100)
}

type DetailRawRow = {
  id: number
  fof_fund_name: string
  product_name: string
  beian_hao: string | null
  valuation_date: string | Date
  investment_shares: string | number | null
  market_value: string | number | null
  market_weight: string | number | null
  price?: string | number | null
  unit_nav?: string | number | null
  nav_date?: string | Date | null
  price_change?: string | number | null
}

type DetailEnrichedRow = ManagedFofDetailListRow

function mapDetailRowFromDb(r: DetailRawRow, seqNo: number | null): DetailEnrichedRow {
  const beian = r.beian_hao?.trim() || null
  const valuationDate = fmtIso(r.valuation_date)

  let unitNav: number | null = null
  if (r.unit_nav != null) {
    const stored = parseFloat(String(r.unit_nav))
    if (isPlausibleUnitNav(stored)) unitNav = stored
  }
  if (unitNav == null) {
    unitNav = resolveNavFromValuationTable(r.price, r.investment_shares, r.market_value)
  }

  const navDate = r.nav_date ? fmtIso(r.nav_date) : valuationDate
  const priceChange = r.price_change != null ? String(r.price_change) : null

  return {
    id: String(r.id),
    seq_no: seqNo,
    fof_fund_name: r.fof_fund_name,
    product_name: r.product_name,
    short_name: r.product_name,
    beian_hao: beian,
    unit_nav: unitNav != null ? String(unitNav) : null,
    nav_date: navDate,
    price_change: priceChange,
    investment_shares: r.investment_shares != null ? String(r.investment_shares) : null,
    market_value: r.market_value != null ? String(r.market_value) : null,
    market_value_pct: fmtMarketValuePct(r.market_weight),
    ret_1w: null,
    ret_1m: null,
    ret_3m: null,
    ret_6m: null,
    ret_1y: null,
    sharpe_1y: null,
    calmar_1y: null,
  }
}

function enrichDetailRows(
  rawRows: DetailRawRow[],
  resolver: BatchNavResolver | null,
): DetailEnrichedRow[] {
  return rawRows.map((r) => {
    const beian = r.beian_hao?.trim() || null
    const valuationDate = fmtIso(r.valuation_date)
    const identity: ProductNavIdentity = {
      beian_hao: beian,
      product_name: r.product_name,
      short_name: null,
    }

    const derivedNav = resolveNavFromValuationTable(r.price, r.investment_shares, r.market_value)
    let unitNav: number | null = derivedNav
    let navDate: string | null = valuationDate

    if (resolver) {
      const resolved = resolver.resolveAt(identity, valuationDate, derivedNav, valuationDate)
      if (resolved && isPlausibleUnitNav(resolved.nav)) {
        // Prefer valuation-derived NAV when available (matches 估值表); else email/legacy NAV.
        if (derivedNav == null) {
          unitNav = resolved.nav
          navDate = resolved.nav_date
        }
      } else if (derivedNav == null) {
        unitNav = null
      }
    }

    let priceChange: string | null = null
    if (unitNav != null && navDate && resolver) {
      const pct = resolver.calcDailyReturnPct(identity, unitNav, navDate, null)
      priceChange = fmtPriceChangePct(pct)
    }

    return {
      id: String(r.id),
      seq_no: null,
      fof_fund_name: r.fof_fund_name,
      product_name: r.product_name,
      short_name: r.product_name,
      beian_hao: beian,
      unit_nav: unitNav != null ? String(unitNav) : null,
      nav_date: navDate,
      price_change: priceChange,
      investment_shares: r.investment_shares != null ? String(r.investment_shares) : null,
      market_value: r.market_value != null ? String(r.market_value) : null,
      market_value_pct: fmtMarketValuePct(r.market_weight),
      ret_1w: null,
      ret_1m: null,
      ret_3m: null,
      ret_6m: null,
      ret_1y: null,
      sharpe_1y: null,
      calmar_1y: null,
    }
  })
}

/** Paginated 投资 FOF底层明细 — sourced from ops_managed_fof_underlying (email 估值表). */
export async function listManagedFofUnderlyingDetail(options: {
  page: number
  pageSize: number
  keyword?: string
  fofFundName?: string
  valuationDate?: string
  sortKey?: string
  sortDir?: "asc" | "desc"
}): Promise<{ rows: ManagedFofDetailListRow[]; total: number; totalMarketValue: string }> {
  await ensureManagedFofUnderlyingTable()
  void ensureManagedFofUnderlyingNavPopulated()

  const emptyTable = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ops_managed_fof_underlying`,
  )
  if (parseInt(emptyTable[0]?.n ?? "0", 10) === 0) {
    void refreshManagedFofUnderlying().catch((err) => {
      console.error("[managed-fof-underlying] background refresh failed:", err)
    })
  }

  const page = Math.max(1, options.page)
  const pageSize = Math.min(200, Math.max(1, options.pageSize))
  const offset = (page - 1) * pageSize
  const keyword = (options.keyword ?? "").trim()
  const fofFundName = (options.fofFundName ?? "").trim()
  const valuationDate = (options.valuationDate ?? "").trim()
  const sortParam = options.sortKey ?? ""
  const sortKey = DETAIL_SORT_COLS[sortParam] ? sortParam : "seq_no"
  const sortAsc = options.sortDir !== "desc"

  const conditions: string[] = ["COALESCE(m.market_value, 0) > 0", `NOT ${SQL_MANAGED_FOF_UNDERLYING_IS_DIRECT_EQUITY_OR_ETF}`]
  const params: unknown[] = []
  let pi = 1

  if (keyword) {
    conditions.push(`(
      m.fof_product_name ILIKE $${pi}
      OR m.underlying_name ILIKE $${pi}
      OR COALESCE(NULLIF(BTRIM(m.underlying_product_code), ''), '') ILIKE $${pi}
    )`)
    params.push(`%${keyword}%`)
    pi++
  }

  if (fofFundName) {
    conditions.push(`m.fof_product_name = $${pi}`)
    params.push(fofFundName)
    pi++
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(valuationDate)) {
    conditions.push(`m.valuation_date = $${pi}::date`)
    params.push(valuationDate)
    pi++
  }

  const where = `WHERE ${conditions.join(" AND ")}`

  const [countRow, sumRow] = await Promise.all([
    query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ops_managed_fof_underlying m ${where}`, params),
    query<{ total_mv: string }>(
      `SELECT COALESCE(SUM(COALESCE(m.market_value, 0)), 0)::text AS total_mv FROM ops_managed_fof_underlying m ${where}`,
      params,
    ),
  ])
  const total = parseInt(countRow[0]?.n ?? "0", 10)
  const totalMarketValue = sumRow[0]?.total_mv ?? "0"

  if (total === 0) {
    return { rows: [], total: 0, totalMarketValue: "0" }
  }

  const selectSql = `SELECT
       m.id,
       m.fof_product_name AS fof_fund_name,
       m.underlying_name AS product_name,
       NULLIF(BTRIM(m.underlying_product_code), '') AS beian_hao,
       m.valuation_date,
       m.quantity AS investment_shares,
       m.market_value,
       m.market_weight,
       m.unit_nav,
       m.nav_date,
       m.price_change
     FROM ops_managed_fof_underlying m`

  const orderSql = sortKey === "seq_no"
    ? DETAIL_DEFAULT_ORDER
    : `${DETAIL_SQL_SORT[sortKey]} ${sortAsc ? "ASC" : "DESC"} NULLS LAST, m.id ASC`

  const rawRows = await query<DetailRawRow>(
    `${selectSql}
     ${where}
     ORDER BY ${orderSql}
     LIMIT $${pi} OFFSET $${pi + 1}`,
    [...params, pageSize, offset],
  )

  const pageRows = rawRows.map((row, i) => mapDetailRowFromDb(row, offset + i + 1))

  return {
    rows: pageRows,
    total,
    totalMarketValue,
  }
}
