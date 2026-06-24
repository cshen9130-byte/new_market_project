/**
 * PostgreSQL persistence for ops_email_nav_records.
 * The table is auto-created on first use (idempotent DDL).
 */

import { query } from "@/lib/db"
import type { ExtractedNavData } from "./email-nav-extract"

export type EmailNavInsert = ExtractedNavData & {
  crawlEmailAccount: string
  emailUid: string
  sentAt: string | null
  subject: string
  senderEmail: string
  attachmentFilename?: string
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ops_email_nav_records (
    id                   BIGSERIAL PRIMARY KEY,
    crawl_email_account  TEXT        NOT NULL,
    email_uid            TEXT        NOT NULL,
    sent_at              TIMESTAMPTZ,
    subject              TEXT,
    sender_email         TEXT,
    nav_date             DATE,
    nav                  NUMERIC(16,6),
    cumulative_nav       NUMERIC(16,6),
    product_code         TEXT,
    fund_name            TEXT,
    source               TEXT,
    attachment_filename  TEXT        NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_email_nav_records_nav_date
    ON ops_email_nav_records (nav_date DESC);
  CREATE INDEX IF NOT EXISTS idx_email_nav_records_fund_name
    ON ops_email_nav_records (fund_name);
  CREATE INDEX IF NOT EXISTS idx_email_nav_records_product_code
    ON ops_email_nav_records (product_code);
`

const MIGRATE_TABLE_SQL = `
  ALTER TABLE ops_email_nav_records
    ADD COLUMN IF NOT EXISTS attachment_filename TEXT NOT NULL DEFAULT '';

  ALTER TABLE ops_email_nav_records
    ADD COLUMN IF NOT EXISTS adjusted_nav NUMERIC(16,6);

  ALTER TABLE ops_email_nav_records
    DROP CONSTRAINT IF EXISTS uq_email_nav_record;

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_nav_record_date'
    ) THEN
      ALTER TABLE ops_email_nav_records
        ADD CONSTRAINT uq_email_nav_record_date
        UNIQUE (crawl_email_account, email_uid, nav_date, attachment_filename);
    END IF;
  END $$;
`

let tableEnsured = false

export async function ensureEmailNavTable(): Promise<void> {
  if (tableEnsured) return
  await query(CREATE_TABLE_SQL)
  await query(MIGRATE_TABLE_SQL)
  tableEnsured = true
}

/**
 * Upsert a batch of extracted NAV records.
 * Multiple rows per email are allowed (historical NAV from attachments).
 *
 * @returns Number of rows inserted or updated.
 */
export async function upsertEmailNavRecords(records: EmailNavInsert[]): Promise<number> {
  if (records.length === 0) return 0
  await ensureEmailNavTable()

  let count = 0
  for (const r of records) {
    await query(
      `INSERT INTO ops_email_nav_records
         (crawl_email_account, email_uid, sent_at, subject, sender_email,
          nav_date, nav, cumulative_nav, adjusted_nav, product_code, fund_name, source, attachment_filename)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (crawl_email_account, email_uid, nav_date, attachment_filename) DO UPDATE SET
         sent_at        = EXCLUDED.sent_at,
         subject        = EXCLUDED.subject,
         sender_email   = EXCLUDED.sender_email,
         nav            = EXCLUDED.nav,
         cumulative_nav = EXCLUDED.cumulative_nav,
         adjusted_nav   = EXCLUDED.adjusted_nav,
         product_code   = EXCLUDED.product_code,
         fund_name      = EXCLUDED.fund_name,
         source         = EXCLUDED.source`,
      [
        r.crawlEmailAccount,
        r.emailUid,
        r.sentAt,
        r.subject,
        r.senderEmail,
        r.navDate,
        r.nav,
        r.cumulativeNav,
        r.adjustedNav,
        r.productCode,
        r.fundName,
        r.source,
        r.attachmentFilename ?? "",
      ],
    )
    count++
  }
  return count
}
