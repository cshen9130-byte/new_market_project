/**
 * PostgreSQL persistence for ops_email_valuation_records.
 * Stores full 估值表 holdings extracted from fund emails.
 */

import { query } from "@/lib/db"
import type { ValuationRow, ValuationSummary } from "@/lib/server/valuation-analyzer"
import { replaceValuationHoldings } from "@/lib/server/email-valuation-holdings-pg"
import { upsertValuationMetricsForRecord } from "@/lib/server/email-valuation-metrics-pg"
import type { FofUnderlyingMetric } from "@/lib/server/email-valuation-metrics"

export type EmailValuationInsert = {
  crawlEmailAccount: string
  emailUid: string
  sentAt: string | null
  subject: string
  senderEmail: string
  attachmentFilename: string
  productCode: string | null
  fundName: string | null
  valuationDate: string
  unitNav: number | null
  cumulativeNav: number | null
  custodyBalance: number | null
  netAssetValue: number | null
  totalAsset: number | null
  totalLiability: number | null
  netAsset: number | null
  underlyingHoldings: FofUnderlyingMetric[]
  holdingsCount: number
  source: string
  summary: ValuationSummary
  holdings: ValuationRow[]
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_email_valuation_records (
    id                   BIGSERIAL PRIMARY KEY,
    crawl_email_account  TEXT        NOT NULL,
    email_uid            TEXT        NOT NULL,
    sent_at              TIMESTAMPTZ,
    subject              TEXT,
    sender_email         TEXT,
    attachment_filename  TEXT        NOT NULL DEFAULT '',
    product_code         TEXT,
    fund_name            TEXT,
    valuation_date       DATE        NOT NULL,
    unit_nav             NUMERIC(16,6),
    cumulative_nav       NUMERIC(16,6),
    total_asset          NUMERIC(20,2),
    total_liability      NUMERIC(20,2),
    net_asset            NUMERIC(20,2),
    custody_balance      NUMERIC(20,2),
    net_asset_value      NUMERIC(20,2),
    holdings_count       INT         NOT NULL DEFAULT 0,
    source               TEXT,
    summary              JSONB,
    holdings             JSONB       NOT NULL DEFAULT '[]',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_email_valuation_records_valuation_date
    ON ops_email_valuation_records (valuation_date DESC);
  CREATE INDEX IF NOT EXISTS idx_email_valuation_records_fund_name
    ON ops_email_valuation_records (fund_name);
  CREATE INDEX IF NOT EXISTS idx_email_valuation_records_product_code
    ON ops_email_valuation_records (product_code);
`

const MIGRATE_METRICS_COLUMNS_SQL = `
  ALTER TABLE ops_email_valuation_records
    ADD COLUMN IF NOT EXISTS custody_balance NUMERIC(20,2);
  ALTER TABLE ops_email_valuation_records
    ADD COLUMN IF NOT EXISTS net_asset_value NUMERIC(20,2);
`

const MIGRATE_TABLE_SQL = `
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_valuation_record'
    ) THEN
      ALTER TABLE ops_email_valuation_records
        ADD CONSTRAINT uq_email_valuation_record
        UNIQUE (crawl_email_account, email_uid, attachment_filename, valuation_date);
    END IF;
  END $$;
`

let tableEnsured = false

export async function ensureEmailValuationTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  await query(MIGRATE_METRICS_COLUMNS_SQL)
  await query(MIGRATE_TABLE_SQL)
  tableEnsured = true
}

export async function upsertEmailValuationRecords(records: EmailValuationInsert[]): Promise<{
  recordsSaved: number
  holdingsSaved: number
}> {
  if (records.length === 0) return { recordsSaved: 0, holdingsSaved: 0 }
  await ensureEmailValuationTable()

  let recordsSaved = 0
  let holdingsSaved = 0
  for (const r of records) {
    const inserted = await query<{ id: string }>(
      `INSERT INTO ops_email_valuation_records
         (crawl_email_account, email_uid, sent_at, subject, sender_email,
          attachment_filename, product_code, fund_name, valuation_date,
          unit_nav, cumulative_nav, total_asset, total_liability, net_asset,
          custody_balance, net_asset_value,
          holdings_count, source, summary, holdings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (crawl_email_account, email_uid, attachment_filename, valuation_date) DO UPDATE SET
         sent_at           = EXCLUDED.sent_at,
         subject           = EXCLUDED.subject,
         sender_email      = EXCLUDED.sender_email,
         product_code      = EXCLUDED.product_code,
         fund_name         = EXCLUDED.fund_name,
         unit_nav          = EXCLUDED.unit_nav,
         cumulative_nav    = EXCLUDED.cumulative_nav,
         total_asset       = EXCLUDED.total_asset,
         total_liability   = EXCLUDED.total_liability,
         net_asset         = EXCLUDED.net_asset,
         custody_balance   = EXCLUDED.custody_balance,
         net_asset_value   = EXCLUDED.net_asset_value,
         holdings_count    = EXCLUDED.holdings_count,
         source            = EXCLUDED.source,
         summary           = EXCLUDED.summary,
         holdings          = EXCLUDED.holdings
       RETURNING id`,
      [
        r.crawlEmailAccount,
        r.emailUid,
        r.sentAt,
        r.subject,
        r.senderEmail,
        r.attachmentFilename ?? "",
        r.productCode,
        r.fundName,
        r.valuationDate,
        r.unitNav,
        r.cumulativeNav,
        r.totalAsset,
        r.totalLiability,
        r.netAsset ?? r.netAssetValue,
        r.custodyBalance,
        r.netAssetValue,
        r.holdingsCount,
        r.source,
        JSON.stringify(r.summary),
        JSON.stringify(r.holdings),
      ],
    )
    const recordId = parseInt(inserted[0]?.id ?? "0", 10)
    if (recordId > 0 && r.holdings.length > 0) {
      holdingsSaved += await replaceValuationHoldings(
        recordId,
        {
          productCode: r.productCode,
          fundName: r.fundName,
          valuationDate: r.valuationDate,
        },
        r.holdings,
      )
    }
    if (recordId > 0) {
      await upsertValuationMetricsForRecord({
        valuationRecordId: recordId,
        productCode: r.productCode,
        fundName: r.fundName,
        valuationDate: r.valuationDate,
        unitNav: r.unitNav,
        cumulativeNav: r.cumulativeNav,
        custodyBalance: r.custodyBalance,
        netAssetValue: r.netAssetValue,
        totalAsset: r.totalAsset,
        totalLiability: r.totalLiability,
        underlyingHoldings: r.underlyingHoldings ?? [],
      })
    }
    recordsSaved++
  }
  return { recordsSaved, holdingsSaved }
}

export type EmailValuationRecordRow = {
  id: number
  crawl_email_account: string
  email_uid: string
  sent_at: string | null
  subject: string | null
  sender_email: string | null
  attachment_filename: string
  product_code: string | null
  fund_name: string | null
  valuation_date: string
  unit_nav: string | null
  cumulative_nav: string | null
  total_asset: string | null
  total_liability: string | null
  net_asset: string | null
  holdings_count: number
  source: string | null
  summary: ValuationSummary | null
  holdings: ValuationRow[]
  created_at: string
}

export async function listEmailValuationRecords(options?: {
  productCode?: string
  fundName?: string
  valuationDateFrom?: string
  valuationDateTo?: string
  limit?: number
  offset?: number
}): Promise<{ records: EmailValuationRecordRow[]; total: number }> {
  await ensureEmailValuationTable()

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
  if (options?.valuationDateFrom) {
    conditions.push(`valuation_date >= $${idx++}`)
    params.push(options.valuationDateFrom)
  }
  if (options?.valuationDateTo) {
    conditions.push(`valuation_date <= $${idx++}`)
    params.push(options.valuationDateTo)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = Math.min(options?.limit ?? 50, 200)
  const offset = options?.offset ?? 0

  const countRows = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ops_email_valuation_records ${where}`,
    params,
  )
  const total = parseInt(countRows[0]?.count ?? "0", 10)

  const records = await query<EmailValuationRecordRow>(
    `SELECT * FROM ops_email_valuation_records
     ${where}
     ORDER BY valuation_date DESC, id DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset],
  )

  return { records, total }
}

export async function getEmailValuationRecordById(id: number): Promise<EmailValuationRecordRow | null> {
  await ensureEmailValuationTable()
  const rows = await query<EmailValuationRecordRow>(
    `SELECT * FROM ops_email_valuation_records WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}
