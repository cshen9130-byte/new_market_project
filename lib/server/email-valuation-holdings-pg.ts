/**
 * Normalized 估值表 holding rows + latest-trading-day snapshot per fund.
 */

import { query } from "@/lib/db"
import type { ValuationRow } from "@/lib/server/valuation-analyzer"
import { resolveFundHoldingCode } from "@/lib/server/fund-holding-code"
import { ensureEmailValuationTable } from "@/lib/server/email-valuation-pg"

const KNOWN_HOLDING_FIELDS = new Set([
  "code",
  "name",
  "original_code",
  "symbol",
  "row_kind",
  "direction",
  "exchange",
  "asset_class",
  "currency",
  "fx_rate",
  "position",
  "volume",
  "quantity",
  "unit_cost",
  "cost",
  "signed_cost",
  "current_price",
  "price",
  "market_value",
  "notional_value",
  "signed_market_value",
  "unrealized_pnl",
  "net_value_change",
  "cost_weight",
  "market_weight",
  "is_leaf",
  "include_in_detail",
  "include_in_analysis",
])

export type ValuationHoldingInsert = {
  valuationRecordId: number
  productCode: string | null
  fundName: string | null
  valuationDate: string
  rowIndex: number
  subjectCode: string
  originalSubjectCode: string | null
  subjectName: string
  symbol: string | null
  rowKind: string | null
  direction: string | null
  exchange: string | null
  assetClass: string | null
  currency: string | null
  fxRate: number | null
  quantity: number | null
  unitCost: number | null
  cost: number | null
  signedCost: number | null
  price: number | null
  marketValue: number | null
  signedMarketValue: number | null
  unrealizedPnl: number | null
  costWeight: number | null
  marketWeight: number | null
  isLeaf: boolean | null
  includeInDetail: boolean
  includeInAnalysis: boolean
  extra: Record<string, unknown>
}

const CREATE_HOLDINGS_SQL = `
  CREATE TABLE IF NOT EXISTS ops_email_valuation_holdings (
    id                   BIGSERIAL PRIMARY KEY,
    valuation_record_id  BIGINT      NOT NULL,
    product_code         TEXT,
    fund_name            TEXT,
    valuation_date       DATE        NOT NULL,
    row_index            INT         NOT NULL DEFAULT 0,
    subject_code         TEXT        NOT NULL,
    original_subject_code TEXT,
    subject_name         TEXT        NOT NULL,
    symbol               TEXT,
    row_kind             TEXT,
    direction            TEXT,
    exchange             TEXT,
    asset_class          TEXT,
    currency             TEXT,
    fx_rate              NUMERIC(16,8),
    quantity             NUMERIC(20,4),
    unit_cost            NUMERIC(20,6),
    cost                 NUMERIC(20,2),
    signed_cost          NUMERIC(20,2),
    price                NUMERIC(20,6),
    market_value         NUMERIC(20,2),
    signed_market_value  NUMERIC(20,2),
    unrealized_pnl       NUMERIC(20,2),
    cost_weight          NUMERIC(12,6),
    market_weight        NUMERIC(12,6),
    is_leaf              BOOLEAN,
    include_in_detail    BOOLEAN     NOT NULL DEFAULT FALSE,
    include_in_analysis  BOOLEAN     NOT NULL DEFAULT FALSE,
    extra                JSONB       NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_email_valuation_holdings_record
    ON ops_email_valuation_holdings (valuation_record_id);
  CREATE INDEX IF NOT EXISTS idx_email_valuation_holdings_product_date
    ON ops_email_valuation_holdings (product_code, valuation_date DESC);
  CREATE INDEX IF NOT EXISTS idx_email_valuation_holdings_fund_date
    ON ops_email_valuation_holdings (fund_name, valuation_date DESC);
  CREATE INDEX IF NOT EXISTS idx_email_valuation_holdings_valuation_date
    ON ops_email_valuation_holdings (valuation_date DESC);
`

const CREATE_LATEST_SQL = `
  CREATE TABLE IF NOT EXISTS ops_email_valuation_fund_holdings_latest (
    id                   BIGSERIAL PRIMARY KEY,
    valuation_record_id  BIGINT      NOT NULL,
    product_code         TEXT,
    fund_name            TEXT,
    valuation_date       DATE        NOT NULL,
    row_index            INT         NOT NULL DEFAULT 0,
    subject_code         TEXT        NOT NULL,
    original_subject_code TEXT,
    subject_name         TEXT        NOT NULL,
    symbol               TEXT,
    row_kind             TEXT,
    direction            TEXT,
    exchange             TEXT,
    asset_class          TEXT,
    currency             TEXT,
    fx_rate              NUMERIC(16,8),
    quantity             NUMERIC(20,4),
    unit_cost            NUMERIC(20,6),
    cost                 NUMERIC(20,2),
    signed_cost          NUMERIC(20,2),
    price                NUMERIC(20,6),
    market_value         NUMERIC(20,2),
    signed_market_value  NUMERIC(20,2),
    unrealized_pnl       NUMERIC(20,2),
    cost_weight          NUMERIC(12,6),
    market_weight        NUMERIC(12,6),
    is_leaf              BOOLEAN,
    include_in_detail    BOOLEAN     NOT NULL DEFAULT FALSE,
    include_in_analysis  BOOLEAN     NOT NULL DEFAULT FALSE,
    extra                JSONB       NOT NULL DEFAULT '{}',
    refreshed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_email_valuation_fund_holdings_latest_product
    ON ops_email_valuation_fund_holdings_latest (product_code);
  CREATE INDEX IF NOT EXISTS idx_email_valuation_fund_holdings_latest_fund
    ON ops_email_valuation_fund_holdings_latest (fund_name);
  CREATE INDEX IF NOT EXISTS idx_email_valuation_fund_holdings_latest_date
    ON ops_email_valuation_fund_holdings_latest (valuation_date DESC);
`

const MIGRATE_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_email_valuation_holdings_valuation_date
    ON ops_email_valuation_holdings (valuation_date DESC);
`

const MIGRATE_SQL = `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_valuation_holding_row'
    ) THEN
      ALTER TABLE ops_email_valuation_holdings
        ADD CONSTRAINT uq_email_valuation_holding_row
        UNIQUE (valuation_record_id, subject_code, subject_name);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_valuation_fund_holding_latest'
    ) THEN
      ALTER TABLE ops_email_valuation_fund_holdings_latest
        ADD CONSTRAINT uq_email_valuation_fund_holding_latest
        UNIQUE (product_code, fund_name, valuation_date, subject_code, subject_name);
    END IF;
  END $$;
`

let tablesEnsured = false

export async function ensureEmailValuationHoldingsTables(): Promise<void> {
  if (tablesEnsured) return
  await query(CREATE_HOLDINGS_SQL)
  await query(CREATE_LATEST_SQL)
  await query(MIGRATE_SQL)
  await query(MIGRATE_INDEXES_SQL)
  tablesEnsured = true
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return null
}

function strOrNull(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s || null
}

function boolOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  return null
}

export function mapValuationRowsToHoldings(
  rows: ValuationRow[],
  meta: {
    valuationRecordId: number
    productCode: string | null
    fundName: string | null
    valuationDate: string
  },
): ValuationHoldingInsert[] {
  return rows.map((row, rowIndex) => {
    const extra: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (!KNOWN_HOLDING_FIELDS.has(key)) extra[key] = value
    }

    return {
      valuationRecordId: meta.valuationRecordId,
      productCode: meta.productCode,
      fundName: meta.fundName,
      valuationDate: meta.valuationDate,
      rowIndex,
      subjectCode: String(row.code ?? ""),
      originalSubjectCode: strOrNull(row.original_code),
      subjectName: String(row.name ?? ""),
      symbol: resolveFundHoldingCode(
        String(row.code ?? ""),
        String(row.name ?? ""),
        strOrNull(row.symbol),
        strOrNull(row.original_code),
      ),
      rowKind: strOrNull(row.row_kind),
      direction: strOrNull(row.direction),
      exchange: strOrNull(row.exchange),
      assetClass: strOrNull(row.asset_class),
      currency: strOrNull(row.currency),
      fxRate: numOrNull(row.fx_rate),
      quantity: numOrNull(row.quantity ?? row.position ?? row.volume),
      unitCost: numOrNull(row.unit_cost),
      cost: numOrNull(row.cost),
      signedCost: numOrNull(row.signed_cost),
      price: numOrNull(row.price ?? row.current_price),
      marketValue: numOrNull(row.market_value ?? row.notional_value),
      signedMarketValue: numOrNull(row.signed_market_value),
      unrealizedPnl: numOrNull(row.unrealized_pnl ?? row.net_value_change),
      costWeight: numOrNull(row.cost_weight),
      marketWeight: numOrNull(row.market_weight),
      isLeaf: boolOrNull(row.is_leaf),
      includeInDetail: row.include_in_detail === true,
      includeInAnalysis: row.include_in_analysis === true,
      extra,
    }
  })
}

const HOLDING_INSERT_COLS = `
  valuation_record_id, product_code, fund_name, valuation_date, row_index,
  subject_code, original_subject_code, subject_name, symbol, row_kind, direction,
  exchange, asset_class, currency, fx_rate, quantity, unit_cost, cost, signed_cost,
  price, market_value, signed_market_value, unrealized_pnl, cost_weight, market_weight,
  is_leaf, include_in_detail, include_in_analysis, extra
`

function holdingParams(h: ValuationHoldingInsert): unknown[] {
  return [
    h.valuationRecordId,
    h.productCode,
    h.fundName,
    h.valuationDate,
    h.rowIndex,
    h.subjectCode,
    h.originalSubjectCode,
    h.subjectName,
    h.symbol,
    h.rowKind,
    h.direction,
    h.exchange,
    h.assetClass,
    h.currency,
    h.fxRate,
    h.quantity,
    h.unitCost,
    h.cost,
    h.signedCost,
    h.price,
    h.marketValue,
    h.signedMarketValue,
    h.unrealizedPnl,
    h.costWeight,
    h.marketWeight,
    h.isLeaf,
    h.includeInDetail,
    h.includeInAnalysis,
    JSON.stringify(h.extra),
  ]
}

async function insertHoldingsBatch(holdings: ValuationHoldingInsert[]): Promise<void> {
  const chunkSize = 100
  for (let i = 0; i < holdings.length; i += chunkSize) {
    const chunk = holdings.slice(i, i + chunkSize)
    const values: string[] = []
    const params: unknown[] = []
    let p = 1
    for (const h of chunk) {
      const placeholders = Array.from({ length: 29 }, (_, j) => `$${p + j}`).join(",")
      values.push(`(${placeholders})`)
      params.push(...holdingParams(h))
      p += 29
    }
    await query(
      `INSERT INTO ops_email_valuation_holdings (${HOLDING_INSERT_COLS})
       VALUES ${values.join(", ")}
       ON CONFLICT (valuation_record_id, subject_code, subject_name) DO UPDATE SET
         row_index           = EXCLUDED.row_index,
         original_subject_code = EXCLUDED.original_subject_code,
         symbol              = EXCLUDED.symbol,
         row_kind            = EXCLUDED.row_kind,
         direction           = EXCLUDED.direction,
         exchange            = EXCLUDED.exchange,
         asset_class         = EXCLUDED.asset_class,
         currency            = EXCLUDED.currency,
         fx_rate             = EXCLUDED.fx_rate,
         quantity            = EXCLUDED.quantity,
         unit_cost           = EXCLUDED.unit_cost,
         cost                = EXCLUDED.cost,
         signed_cost         = EXCLUDED.signed_cost,
         price               = EXCLUDED.price,
         market_value        = EXCLUDED.market_value,
         signed_market_value = EXCLUDED.signed_market_value,
         unrealized_pnl      = EXCLUDED.unrealized_pnl,
         cost_weight         = EXCLUDED.cost_weight,
         market_weight       = EXCLUDED.market_weight,
         is_leaf             = EXCLUDED.is_leaf,
         include_in_detail   = EXCLUDED.include_in_detail,
         include_in_analysis = EXCLUDED.include_in_analysis,
         extra               = EXCLUDED.extra`,
      params,
    )
  }
}

export async function replaceValuationHoldings(
  valuationRecordId: number,
  meta: {
    productCode: string | null
    fundName: string | null
    valuationDate: string
  },
  rows: ValuationRow[],
): Promise<number> {
  await ensureEmailValuationHoldingsTables()
  await query(`DELETE FROM ops_email_valuation_holdings WHERE valuation_record_id = $1`, [
    valuationRecordId,
  ])

  const holdings = mapValuationRowsToHoldings(rows, {
    valuationRecordId,
    ...meta,
  }).filter((h) => h.subjectCode && h.subjectName)

  if (holdings.length === 0) return 0
  await insertHoldingsBatch(holdings)
  return holdings.length
}

export async function refreshFundLatestValuationHoldings(): Promise<number> {
  await ensureEmailValuationTable()
  await ensureEmailValuationHoldingsTables()

  await query(`DELETE FROM ops_email_valuation_fund_holdings_latest`)

  const rows = await query<{ n: string }>(
    `WITH latest_records AS (
       SELECT DISTINCT ON (fund_key)
         id AS valuation_record_id,
         product_code,
         fund_name,
         valuation_date,
         fund_key
       FROM (
         SELECT
           id,
           product_code,
           fund_name,
           valuation_date,
           COALESCE(NULLIF(TRIM(product_code), ''), NULLIF(TRIM(fund_name), '')) AS fund_key
         FROM ops_email_valuation_records
       ) src
       WHERE fund_key IS NOT NULL
       ORDER BY fund_key, valuation_date DESC, id DESC
     ),
     inserted AS (
       INSERT INTO ops_email_valuation_fund_holdings_latest (
         valuation_record_id, product_code, fund_name, valuation_date, row_index,
         subject_code, original_subject_code, subject_name, symbol, row_kind, direction,
         exchange, asset_class, currency, fx_rate, quantity, unit_cost, cost, signed_cost,
         price, market_value, signed_market_value, unrealized_pnl, cost_weight, market_weight,
         is_leaf, include_in_detail, include_in_analysis, extra
       )
       SELECT
         h.valuation_record_id, h.product_code, h.fund_name, h.valuation_date, h.row_index,
         h.subject_code, h.original_subject_code, h.subject_name, h.symbol, h.row_kind, h.direction,
         h.exchange, h.asset_class, h.currency, h.fx_rate, h.quantity, h.unit_cost, h.cost, h.signed_cost,
         h.price, h.market_value, h.signed_market_value, h.unrealized_pnl, h.cost_weight, h.market_weight,
         h.is_leaf, h.include_in_detail, h.include_in_analysis, h.extra
       FROM ops_email_valuation_holdings h
       INNER JOIN latest_records lr ON lr.valuation_record_id = h.valuation_record_id
       WHERE h.include_in_detail = TRUE
       ON CONFLICT (product_code, fund_name, valuation_date, subject_code, subject_name) DO UPDATE SET
         valuation_record_id = EXCLUDED.valuation_record_id,
         row_index           = EXCLUDED.row_index,
         original_subject_code = EXCLUDED.original_subject_code,
         symbol              = EXCLUDED.symbol,
         row_kind            = EXCLUDED.row_kind,
         direction           = EXCLUDED.direction,
         exchange            = EXCLUDED.exchange,
         asset_class         = EXCLUDED.asset_class,
         currency            = EXCLUDED.currency,
         fx_rate             = EXCLUDED.fx_rate,
         quantity            = EXCLUDED.quantity,
         unit_cost           = EXCLUDED.unit_cost,
         cost                = EXCLUDED.cost,
         signed_cost         = EXCLUDED.signed_cost,
         price               = EXCLUDED.price,
         market_value        = EXCLUDED.market_value,
         signed_market_value = EXCLUDED.signed_market_value,
         unrealized_pnl      = EXCLUDED.unrealized_pnl,
         cost_weight         = EXCLUDED.cost_weight,
         market_weight       = EXCLUDED.market_weight,
         is_leaf             = EXCLUDED.is_leaf,
         include_in_detail   = EXCLUDED.include_in_detail,
         include_in_analysis = EXCLUDED.include_in_analysis,
         extra               = EXCLUDED.extra,
         refreshed_at        = NOW()
       RETURNING 1
     )
     SELECT COUNT(*)::text AS n FROM inserted`,
  )

  return parseInt(rows[0]?.n ?? "0", 10)
}

/** Backfill normalized holdings from existing JSONB blobs (one-time / repair). */
export async function backfillValuationHoldingsFromRecords(): Promise<{
  recordsProcessed: number
  holdingsSaved: number
}> {
  await ensureEmailValuationTable()
  await ensureEmailValuationHoldingsTables()

  const records = await query<{
    id: string
    product_code: string | null
    fund_name: string | null
    valuation_date: string
    holdings: ValuationRow[]
  }>(
    `SELECT id, product_code, fund_name, valuation_date, holdings
     FROM ops_email_valuation_records
     WHERE jsonb_array_length(holdings) > 0
     ORDER BY id`,
  )

  let holdingsSaved = 0
  for (const record of records) {
    const rows = Array.isArray(record.holdings) ? record.holdings : []
    holdingsSaved += await replaceValuationHoldings(
      parseInt(record.id, 10),
      {
        productCode: record.product_code,
        fundName: record.fund_name,
        valuationDate: record.valuation_date,
      },
      rows,
    )
  }

  return { recordsProcessed: records.length, holdingsSaved }
}

export type FundLatestHoldingRow = {
  id: number
  valuation_record_id: number
  product_code: string | null
  fund_name: string | null
  valuation_date: string
  row_index: number
  subject_code: string
  original_subject_code: string | null
  subject_name: string
  symbol: string | null
  row_kind: string | null
  direction: string | null
  exchange: string | null
  asset_class: string | null
  currency: string | null
  fx_rate: string | null
  quantity: string | null
  unit_cost: string | null
  cost: string | null
  signed_cost: string | null
  price: string | null
  market_value: string | null
  signed_market_value: string | null
  unrealized_pnl: string | null
  cost_weight: string | null
  market_weight: string | null
  is_leaf: boolean | null
  include_in_detail: boolean
  include_in_analysis: boolean
  extra: Record<string, unknown>
  refreshed_at: string
}

export async function listFundLatestValuationHoldings(options?: {
  productCode?: string
  fundName?: string
  rowKind?: string
  includeAnalysisOnly?: boolean
  limit?: number
  offset?: number
  /** Skip COUNT(*) — use when caller only needs the page of rows. */
  skipTotal?: boolean
}): Promise<{ holdings: FundLatestHoldingRow[]; total: number }> {
  await ensureEmailValuationHoldingsTables()

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
  if (options?.rowKind) {
    conditions.push(`row_kind = $${idx++}`)
    params.push(options.rowKind)
  }
  if (options?.includeAnalysisOnly) {
    conditions.push(`include_in_analysis = TRUE`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = Math.min(options?.limit ?? 500, 2000)
  const offset = options?.offset ?? 0

  const holdings = await query<FundLatestHoldingRow>(
    `SELECT * FROM ops_email_valuation_fund_holdings_latest
     ${where}
     ORDER BY product_code NULLS LAST, fund_name, row_index
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  )

  if (options?.skipTotal) {
    return { holdings, total: holdings.length }
  }

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ops_email_valuation_fund_holdings_latest ${where}`,
    params,
  )
  const total = parseInt(countRows[0]?.count ?? "0", 10)

  return { holdings, total }
}

export async function listValuationHoldingsByRecordId(
  valuationRecordId: number,
  options?: { detailOnly?: boolean },
): Promise<ValuationHoldingInsert[]> {
  await ensureEmailValuationHoldingsTables()
  const conditions = ["valuation_record_id = $1"]
  const params: unknown[] = [valuationRecordId]
  if (options?.detailOnly) {
    conditions.push("include_in_detail = TRUE")
  }
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM ops_email_valuation_holdings
     WHERE ${conditions.join(" AND ")}
     ORDER BY row_index`,
    params,
  )
  return rows.map((r) => ({
    valuationRecordId: Number(r.valuation_record_id),
    productCode: strOrNull(r.product_code),
    fundName: strOrNull(r.fund_name),
    valuationDate: String(r.valuation_date),
    rowIndex: Number(r.row_index),
    subjectCode: String(r.subject_code),
    originalSubjectCode: strOrNull(r.original_subject_code),
    subjectName: String(r.subject_name),
    symbol: strOrNull(r.symbol),
    rowKind: strOrNull(r.row_kind),
    direction: strOrNull(r.direction),
    exchange: strOrNull(r.exchange),
    assetClass: strOrNull(r.asset_class),
    currency: strOrNull(r.currency),
    fxRate: numOrNull(r.fx_rate),
    quantity: numOrNull(r.quantity),
    unitCost: numOrNull(r.unit_cost),
    cost: numOrNull(r.cost),
    signedCost: numOrNull(r.signed_cost),
    price: numOrNull(r.price),
    marketValue: numOrNull(r.market_value),
    signedMarketValue: numOrNull(r.signed_market_value),
    unrealizedPnl: numOrNull(r.unrealized_pnl),
    costWeight: numOrNull(r.cost_weight),
    marketWeight: numOrNull(r.market_weight),
    isLeaf: boolOrNull(r.is_leaf),
    includeInDetail: r.include_in_detail === true,
    includeInAnalysis: r.include_in_analysis === true,
    extra: (r.extra as Record<string, unknown>) ?? {},
  }))
}
