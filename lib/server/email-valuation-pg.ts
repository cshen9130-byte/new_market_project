/**
 * PostgreSQL persistence for ops_email_valuation_records.
 * Stores full 估值表 holdings extracted from fund emails.
 */

import { query } from "@/lib/db"
import type { ValuationRow, ValuationSummary } from "@/lib/server/valuation-analyzer"
import { resolveCustodianFromValuationRecord } from "@/lib/server/email-valuation-custodian"
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
  paidInCapital: number | null
  totalAsset: number | null
  totalLiability: number | null
  custodian: string | null
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
    paid_in_capital      NUMERIC(20,2),
    custodian            TEXT,
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
  ALTER TABLE ops_email_valuation_records
    ADD COLUMN IF NOT EXISTS paid_in_capital NUMERIC(20,2);
  ALTER TABLE ops_email_valuation_records
    ADD COLUMN IF NOT EXISTS custodian TEXT;
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
    const custodian = resolveCustodianFromValuationRecord({
      custodian: r.custodian,
      summaryCustodian: r.summary?.custodian ?? null,
      senderEmail: r.senderEmail,
      subject: r.subject,
      attachmentFilename: r.attachmentFilename,
    })
    const summary = {
      ...r.summary,
      custodian: custodian ?? r.summary?.custodian ?? null,
    }

    const inserted = await query<{ id: string }>(
      `INSERT INTO ops_email_valuation_records
         (crawl_email_account, email_uid, sent_at, subject, sender_email,
          attachment_filename, product_code, fund_name, valuation_date,
          unit_nav, cumulative_nav, total_asset, total_liability, net_asset,
          custody_balance, net_asset_value, paid_in_capital, custodian,
          holdings_count, source, summary, holdings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
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
         paid_in_capital   = EXCLUDED.paid_in_capital,
         custodian         = EXCLUDED.custodian,
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
        r.paidInCapital,
        custodian,
        r.holdingsCount,
        r.source,
        JSON.stringify(summary),
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
        paidInCapital: r.paidInCapital,
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

function resolveCustodianFromRecordRow(row: {
  custodian: string | null
  summary: ValuationSummary | null
  sender_email: string | null
  subject: string | null
  attachment_filename: string | null
}): string | null {
  return resolveCustodianFromValuationRecord({
    custodian: row.custodian,
    summaryCustodian: row.summary?.custodian ?? null,
    headerRows: row.summary?.header_rows ?? null,
    senderEmail: row.sender_email,
    subject: row.subject,
    attachmentFilename: row.attachment_filename,
  })
}

/** Resolve 托管券商 for a record and persist — for offline backfill only (may use IMAP). */
export async function resolveAndPersistValuationCustodian(
  recordId: number | null | undefined,
): Promise<string | null> {
  if (!recordId || recordId <= 0) return null
  await ensureEmailValuationTable()

  const rows = await query<{
    id: string
    custodian: string | null
    summary: ValuationSummary | null
    sender_email: string | null
    subject: string | null
    attachment_filename: string | null
    crawl_email_account: string
    email_uid: string
  }>(
    `SELECT id, custodian, summary, sender_email, subject, attachment_filename,
            crawl_email_account, email_uid
     FROM ops_email_valuation_records
     WHERE id = $1
     LIMIT 1`,
    [recordId],
  )

  const row = rows[0]
  if (!row) return null

  let resolved = resolveCustodianFromRecordRow(row)
  if (!resolved && row.attachment_filename?.trim()) {
    const { refetchValuationCustodianFromEmail } = await import(
      "@/lib/server/email-valuation-custodian-refetch"
    )
    resolved = await refetchValuationCustodianFromEmail({
      crawlEmailAccount: row.crawl_email_account,
      emailUid: row.email_uid,
      attachmentFilename: row.attachment_filename,
      subject: row.subject,
      senderEmail: row.sender_email,
    })
  }

  if (!resolved) return null

  const existing = row.custodian?.trim() ?? row.summary?.custodian?.trim() ?? ""
  if (existing === resolved) return resolved

  await query(
    `UPDATE ops_email_valuation_records
     SET custodian = $2,
         summary = COALESCE(summary, '{}'::jsonb) || jsonb_build_object('custodian', $2::text)
     WHERE id = $1`,
    [recordId, resolved],
  )
  await query(
    `UPDATE ops_email_valuation_fund_metrics_latest
     SET custodian = $2
     WHERE valuation_record_id = $1`,
    [recordId, resolved],
  )

  return resolved
}

/** Resolve 托管券商 from the latest stored valuation email for a fund. */
export async function lookupLatestValuationCustodian(options: {
  productCodes?: string[]
  fundName?: string | null
}): Promise<string | null> {
  await ensureEmailValuationTable()

  const codes = [...new Set((options.productCodes ?? []).map((c) => c.trim()).filter(Boolean))]
  const fundName = options.fundName?.trim() ?? ""
  if (codes.length === 0 && !fundName) return null

  const conditions: string[] = []
  const params: unknown[] = []
  let idx = 1

  if (codes.length > 0) {
    conditions.push(`product_code = ANY($${idx++})`)
    params.push(codes)
  }
  if (fundName) {
    conditions.push(`fund_name ILIKE $${idx++}`)
    params.push(`%${fundName}%`)
  }

  const rows = await query<{
    id: string
    custodian: string | null
    summary: ValuationSummary | null
    sender_email: string | null
    subject: string | null
    attachment_filename: string | null
  }>(
    `SELECT id, custodian, summary, sender_email, subject, attachment_filename
     FROM ops_email_valuation_records
     WHERE ${conditions.join(" OR ")}
     ORDER BY valuation_date DESC, id DESC
     LIMIT 10`,
    params,
  )

  for (const row of rows) {
    const resolved = resolveCustodianFromRecordRow(row)
    if (resolved) return resolved
  }
  return null
}

/** Fast lookup from stored record metadata — never blocks on IMAP. */
export async function lookupValuationCustodianByRecordId(
  recordId: number | null | undefined,
): Promise<string | null> {
  if (!recordId || recordId <= 0) return null
  await ensureEmailValuationTable()

  const rows = await query<{
    custodian: string | null
    summary: ValuationSummary | null
    sender_email: string | null
    subject: string | null
    attachment_filename: string | null
  }>(
    `SELECT custodian, summary, sender_email, subject, attachment_filename
     FROM ops_email_valuation_records
     WHERE id = $1
     LIMIT 1`,
    [recordId],
  )

  const row = rows[0]
  if (!row) return null
  return resolveCustodianFromRecordRow(row)
}
