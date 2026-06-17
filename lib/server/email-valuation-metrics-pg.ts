/**
 * Latest fund metrics + FOF underlying 市值 snapshots from email 估值表.
 */

import { query } from "@/lib/db"
import { ensureEmailValuationTable } from "@/lib/server/email-valuation-pg"
import { ensureEmailValuationHoldingsTables } from "@/lib/server/email-valuation-holdings-pg"
import type { FofUnderlyingMetric } from "@/lib/server/email-valuation-metrics"

const CREATE_FUND_METRICS_SQL = `
  CREATE TABLE IF NOT EXISTS ops_email_valuation_fund_metrics_latest (
    product_code         TEXT,
    fund_name            TEXT        NOT NULL,
    valuation_date       DATE        NOT NULL,
    valuation_record_id  BIGINT      NOT NULL,
    unit_nav             NUMERIC(16,6),
    cumulative_nav       NUMERIC(16,6),
    custody_balance      NUMERIC(20,2),
    net_asset_value      NUMERIC(20,2),
    total_asset          NUMERIC(20,2),
    total_liability      NUMERIC(20,2),
    refreshed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (fund_name)
  );
  CREATE INDEX IF NOT EXISTS idx_email_valuation_fund_metrics_latest_code
    ON ops_email_valuation_fund_metrics_latest (product_code);
  CREATE INDEX IF NOT EXISTS idx_email_valuation_fund_metrics_latest_date
    ON ops_email_valuation_fund_metrics_latest (valuation_date DESC);
`

const CREATE_FOF_UNDERLYING_SQL = `
  CREATE TABLE IF NOT EXISTS ops_email_valuation_fof_underlying_latest (
    id                       BIGSERIAL PRIMARY KEY,
    fof_product_code         TEXT,
    fof_fund_name            TEXT        NOT NULL,
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
  CREATE INDEX IF NOT EXISTS idx_email_valuation_fof_underlying_fof
    ON ops_email_valuation_fof_underlying_latest (fof_product_code, fof_fund_name);
  CREATE INDEX IF NOT EXISTS idx_email_valuation_fof_underlying_underlying
    ON ops_email_valuation_fof_underlying_latest (underlying_product_code);
  CREATE INDEX IF NOT EXISTS idx_email_valuation_fof_underlying_date
    ON ops_email_valuation_fof_underlying_latest (valuation_date DESC);

  CREATE TABLE IF NOT EXISTS ops_email_valuation_underlying_market_latest (
    underlying_product_code  TEXT        NOT NULL DEFAULT '',
    underlying_name          TEXT        NOT NULL,
    valuation_date           DATE        NOT NULL,
    market_value             NUMERIC(20,2),
    quantity                 NUMERIC(20,4),
    source_fof_product_code  TEXT,
    source_fof_fund_name     TEXT,
    refreshed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (underlying_product_code, underlying_name)
  );
  CREATE INDEX IF NOT EXISTS idx_email_valuation_underlying_market_code
    ON ops_email_valuation_underlying_market_latest (underlying_product_code);
`

const MIGRATE_RECORDS_SQL = `
  ALTER TABLE ops_email_valuation_records
    ADD COLUMN IF NOT EXISTS custody_balance NUMERIC(20,2);
  ALTER TABLE ops_email_valuation_records
    ADD COLUMN IF NOT EXISTS net_asset_value NUMERIC(20,2);
`

const MIGRATE_UNDERLYING_MARKET_PK = `
  TRUNCATE ops_email_valuation_underlying_market_latest;
  UPDATE ops_email_valuation_underlying_market_latest
    SET underlying_product_code = '' WHERE underlying_product_code IS NULL;
  ALTER TABLE ops_email_valuation_underlying_market_latest
    ALTER COLUMN underlying_product_code SET DEFAULT '';
  ALTER TABLE ops_email_valuation_underlying_market_latest
    ALTER COLUMN underlying_product_code SET NOT NULL;
  ALTER TABLE ops_email_valuation_underlying_market_latest
    DROP CONSTRAINT IF EXISTS ops_email_valuation_underlying_market_latest_pkey;
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'ops_email_valuation_underlying_market_pkey'
    ) THEN
      ALTER TABLE ops_email_valuation_underlying_market_latest
        ADD CONSTRAINT ops_email_valuation_underlying_market_pkey
        PRIMARY KEY (underlying_product_code, underlying_name);
    END IF;
  END $$;
`

const MIGRATE_FOF_UNIQUE = `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_valuation_fof_underlying'
    ) THEN
      ALTER TABLE ops_email_valuation_fof_underlying_latest
        ADD CONSTRAINT uq_email_valuation_fof_underlying
        UNIQUE (fof_product_code, fof_fund_name, valuation_date, underlying_product_code, underlying_name, subject_code);
    END IF;
  END $$;
`

let tablesEnsured = false

export async function ensureEmailValuationMetricsTables(): Promise<void> {
  if (tablesEnsured) return
  await ensureEmailValuationTable()
  await query(MIGRATE_RECORDS_SQL)
  await query(CREATE_FUND_METRICS_SQL)
  await query(CREATE_FOF_UNDERLYING_SQL)
  await query(MIGRATE_FOF_UNIQUE)
  await query(MIGRATE_UNDERLYING_MARKET_PK)
  tablesEnsured = true
}

export type EmailValuationMetricsInsert = {
  valuationRecordId: number
  productCode: string | null
  fundName: string | null
  valuationDate: string
  unitNav: number | null
  cumulativeNav: number | null
  custodyBalance: number | null
  netAssetValue: number | null
  totalAsset: number | null
  totalLiability: number | null
  underlyingHoldings: FofUnderlyingMetric[]
}

export async function upsertValuationMetricsForRecord(data: EmailValuationMetricsInsert): Promise<void> {
  if (!data.fundName && !data.productCode) return
  await ensureEmailValuationMetricsTables()

  await query(
    `UPDATE ops_email_valuation_records
     SET custody_balance = $2, net_asset_value = $3
     WHERE id = $1`,
    [data.valuationRecordId, data.custodyBalance, data.netAssetValue],
  )
}

/** Rebuild latest fund metrics (在管产品) and FOF underlying 市值 (FOF底层). */
export async function refreshEmailValuationMetricsLatest(): Promise<{
  fundMetricsRefreshed: number
  fofUnderlyingRefreshed: number
  underlyingMarketRefreshed: number
}> {
  await ensureEmailValuationMetricsTables()
  await ensureEmailValuationHoldingsTables()

  await query(`DELETE FROM ops_email_valuation_fund_metrics_latest`)

  const fundRows = await query<{ n: string }>(
    `WITH latest_records AS (
       SELECT DISTINCT ON (fund_key)
         id, product_code, fund_name, valuation_date,
         unit_nav, cumulative_nav, custody_balance, net_asset_value,
         total_asset, total_liability
       FROM (
         SELECT
           id, product_code, fund_name, valuation_date,
           unit_nav, cumulative_nav, custody_balance, net_asset_value,
           total_asset, total_liability,
           COALESCE(NULLIF(TRIM(product_code), ''), NULLIF(TRIM(fund_name), '')) AS fund_key
         FROM ops_email_valuation_records
       ) src
       WHERE fund_key IS NOT NULL
       ORDER BY fund_key, valuation_date DESC, id DESC
     ),
     inserted AS (
       INSERT INTO ops_email_valuation_fund_metrics_latest (
         product_code, fund_name, valuation_date, valuation_record_id,
         unit_nav, cumulative_nav, custody_balance, net_asset_value,
         total_asset, total_liability
       )
       SELECT
         product_code, fund_name, valuation_date, id,
         unit_nav, cumulative_nav, custody_balance, net_asset_value,
         total_asset, total_liability
       FROM latest_records
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
  )

  await query(`DELETE FROM ops_email_valuation_fof_underlying_latest`)

  const fofRows = await query<{ n: string }>(
    `WITH latest_fof AS (
       SELECT DISTINCT ON (fund_key)
         r.id AS valuation_record_id,
         r.product_code AS fof_product_code,
         r.fund_name AS fof_fund_name,
         r.valuation_date
       FROM (
         SELECT id, product_code, fund_name, valuation_date,
           COALESCE(NULLIF(TRIM(product_code), ''), NULLIF(TRIM(fund_name), '')) AS fund_key
         FROM ops_email_valuation_records
       ) keyed
       INNER JOIN ops_email_valuation_records r ON r.id = keyed.id
       WHERE keyed.fund_key IS NOT NULL
       ORDER BY fund_key, r.valuation_date DESC, r.id DESC
     ),
     inserted AS (
       INSERT INTO ops_email_valuation_fof_underlying_latest (
         fof_product_code, fof_fund_name, valuation_date, valuation_record_id,
         underlying_product_code, underlying_name, subject_code, row_kind,
         market_value, quantity, cost, market_weight
       )
       SELECT
         lf.fof_product_code,
         lf.fof_fund_name,
         lf.valuation_date,
         lf.valuation_record_id,
         COALESCE(
           NULLIF(TRIM(h.symbol), ''),
           NULLIF(
             (regexp_match(h.subject_name, '([A-Z0-9]{4,8})'))[1],
             ''
           )
         ),
         h.subject_name,
         h.subject_code,
         h.row_kind,
         h.market_value,
         h.quantity,
         h.cost,
         h.market_weight
       FROM latest_fof lf
       INNER JOIN ops_email_valuation_holdings h ON h.valuation_record_id = lf.valuation_record_id
       WHERE h.include_in_detail = TRUE
         AND h.row_kind IN ('private_fund', 'fund_or_stock', 'fund', 'money_fund')
         AND COALESCE(h.market_value, h.cost, 0) > 0
       ON CONFLICT (fof_product_code, fof_fund_name, valuation_date, underlying_product_code, underlying_name, subject_code)
       DO UPDATE SET
         market_value  = EXCLUDED.market_value,
         quantity      = EXCLUDED.quantity,
         cost          = EXCLUDED.cost,
         market_weight = EXCLUDED.market_weight,
         refreshed_at  = NOW()
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
  )

  await query(`DELETE FROM ops_email_valuation_underlying_market_latest`)

  const underlyingMarketRows = await query<{ n: string }>(
    `WITH ranked AS (
       SELECT
         underlying_product_code,
         underlying_name,
         valuation_date,
         market_value,
         quantity,
         fof_product_code AS source_fof_product_code,
         fof_fund_name AS source_fof_fund_name,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(NULLIF(TRIM(underlying_product_code), ''), TRIM(underlying_name))
           ORDER BY valuation_date DESC, market_value DESC NULLS LAST
         ) AS rn
       FROM ops_email_valuation_fof_underlying_latest
       WHERE COALESCE(market_value, 0) > 0
     ),
     inserted AS (
       INSERT INTO ops_email_valuation_underlying_market_latest (
         underlying_product_code, underlying_name, valuation_date,
         market_value, quantity, source_fof_product_code, source_fof_fund_name
       )
       SELECT
         COALESCE(underlying_product_code, ''),
         underlying_name,
         valuation_date,
         market_value,
         quantity,
         source_fof_product_code,
         source_fof_fund_name
       FROM ranked
       WHERE rn = 1
       ON CONFLICT (underlying_product_code, underlying_name) DO UPDATE SET
         valuation_date          = EXCLUDED.valuation_date,
         market_value            = EXCLUDED.market_value,
         quantity                = EXCLUDED.quantity,
         source_fof_product_code = EXCLUDED.source_fof_product_code,
         source_fof_fund_name    = EXCLUDED.source_fof_fund_name,
         refreshed_at            = NOW()
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
  )

  return {
    fundMetricsRefreshed: parseInt(fundRows[0]?.n ?? "0", 10),
    fofUnderlyingRefreshed: parseInt(fofRows[0]?.n ?? "0", 10),
    underlyingMarketRefreshed: parseInt(underlyingMarketRows[0]?.n ?? "0", 10),
  }
}

export type FundMetricsLatestRow = {
  product_code: string | null
  fund_name: string
  valuation_date: string
  valuation_record_id: number
  unit_nav: string | null
  cumulative_nav: string | null
  custody_balance: string | null
  net_asset_value: string | null
  total_asset: string | null
  total_liability: string | null
  refreshed_at: string
}

export async function listFundMetricsLatest(options?: {
  productCode?: string
  fundName?: string
}): Promise<FundMetricsLatestRow[]> {
  await ensureEmailValuationMetricsTables()
  const conditions: string[] = []
  const params: unknown[] = []
  let idx = 1
  if (options?.productCode) {
    conditions.push(`product_code = $${idx++}`)
    params.push(options.productCode)
  }
  if (options?.fundName) {
    conditions.push(`fund_name ILIKE $${idx++}`)
    params.push(`%${options.fundName}%`)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  return query<FundMetricsLatestRow>(
    `SELECT * FROM ops_email_valuation_fund_metrics_latest ${where} ORDER BY fund_name`,
    params,
  )
}

export type FofUnderlyingLatestRow = {
  id: number
  fof_product_code: string | null
  fof_fund_name: string
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

export async function listFofUnderlyingLatest(options?: {
  fofProductCode?: string
  fofFundName?: string
  underlyingProductCode?: string
  limit?: number
  offset?: number
}): Promise<{ rows: FofUnderlyingLatestRow[]; total: number }> {
  await ensureEmailValuationMetricsTables()
  const conditions: string[] = []
  const params: unknown[] = []
  let idx = 1
  if (options?.fofProductCode) {
    conditions.push(`fof_product_code = $${idx++}`)
    params.push(options.fofProductCode)
  }
  if (options?.fofFundName) {
    conditions.push(`fof_fund_name ILIKE $${idx++}`)
    params.push(`%${options.fofFundName}%`)
  }
  if (options?.underlyingProductCode) {
    conditions.push(`underlying_product_code = $${idx++}`)
    params.push(options.underlyingProductCode)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = Math.min(options?.limit ?? 500, 2000)
  const offset = options?.offset ?? 0

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ops_email_valuation_fof_underlying_latest ${where}`,
    params,
  )

  const rows = await query<FofUnderlyingLatestRow>(
    `SELECT * FROM ops_email_valuation_fof_underlying_latest
     ${where}
     ORDER BY fof_fund_name, market_value DESC NULLS LAST
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  )

  return { rows, total: parseInt(countRows[0]?.count ?? "0", 10) }
}
