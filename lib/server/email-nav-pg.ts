/**
 * PostgreSQL persistence for ops_email_nav_records.
 * The table is auto-created on first use (idempotent DDL).
 */

import { query } from "@/lib/db"
import { applyEmailProductCodeOverride, type ExtractedNavData } from "./email-nav-extract"
import { fundNicknameMatchesFullName } from "@/lib/server/fund-name-match"

export type EmailNavInsert = ExtractedNavData & {
  crawlEmailAccount: string
  emailUid: string
  sentAt: string | null
  subject: string
  senderEmail: string
  /** Envelope To/Cc/Bcc, comma-separated and lowercased. */
  receiverEmail?: string
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
  CREATE INDEX IF NOT EXISTS idx_email_nav_records_product_code_date
    ON ops_email_nav_records (product_code, nav_date DESC, id DESC);
`

const MIGRATE_TABLE_SQL = `
  ALTER TABLE ops_email_nav_records
    ADD COLUMN IF NOT EXISTS attachment_filename TEXT NOT NULL DEFAULT '';

  ALTER TABLE ops_email_nav_records
    ADD COLUMN IF NOT EXISTS adjusted_nav NUMERIC(16,6);

  ALTER TABLE ops_email_nav_records
    DROP CONSTRAINT IF EXISTS uq_email_nav_record;

  -- CMS/招商 【净值表】 often packs multiple products in one email/attachment.
  -- Unique key must include product_code so same-date rows do not overwrite.
  ALTER TABLE ops_email_nav_records
    DROP CONSTRAINT IF EXISTS uq_email_nav_record_date;

  UPDATE ops_email_nav_records
    SET product_code = ''
    WHERE product_code IS NULL;

  DELETE FROM ops_email_nav_records a
    USING ops_email_nav_records b
    WHERE a.id < b.id
      AND a.crawl_email_account = b.crawl_email_account
      AND a.email_uid = b.email_uid
      AND a.nav_date IS NOT DISTINCT FROM b.nav_date
      AND a.attachment_filename = b.attachment_filename
      AND COALESCE(a.product_code, '') = COALESCE(b.product_code, '');

  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_nav_record_date_code'
    ) THEN
      ALTER TABLE ops_email_nav_records
        ADD CONSTRAINT uq_email_nav_record_date_code
        UNIQUE (crawl_email_account, email_uid, nav_date, attachment_filename, product_code);
    END IF;
  END $$;
`

let tableEnsured = false
// Prevent concurrent DDL races: only one in-flight call at a time per process.
let ensureInFlight: Promise<void> | null = null

export async function ensureEmailNavTable(): Promise<void> {
  if (tableEnsured) return
  if (ensureInFlight) return ensureInFlight
  ensureInFlight = _runEnsure().finally(() => { ensureInFlight = null })
  return ensureInFlight
}

async function _runEnsure(): Promise<void> {
  // Fast path: check whether the table and all migrated columns/constraints
  // already exist. If so, skip ALL DDL — this avoids the ACCESS EXCLUSIVE locks
  // that ALTER TABLE requires. (Those locks were what cascaded into the
  // site-wide hang when they queued behind a long-running SELECT.)
  const schemaCheck = await query<{ col_count: string; has_constraint: boolean }>(`
    SELECT
      (SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name   = 'ops_email_nav_records'
           AND column_name  IN ('attachment_filename', 'adjusted_nav')) AS col_count,
      EXISTS (SELECT 1 FROM pg_constraint
              WHERE conname = 'uq_email_nav_record_date_code') AS has_constraint
  `).catch(() => [] as { col_count: string; has_constraint: boolean }[])

  const colCount = parseInt(schemaCheck[0]?.col_count ?? "0", 10)
  const hasConstraint = schemaCheck[0]?.has_constraint === true

  if (colCount >= 2 && hasConstraint) {
    // New unique key can exist alongside the old 4-column key. The leftover
    // constraint rejects same-email multi-product NAV rows (CMS/招商 净值表).
    await query(
      `ALTER TABLE ops_email_nav_records DROP CONSTRAINT IF EXISTS uq_email_nav_record_date`,
    ).catch(() => {})
    await ensureReceiverEmailColumn()
    tableEnsured = true
    return
  }

  // Schema needs to be created or migrated. The DDL is idempotent
  // (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS), so concurrent
  // callers are safe — Postgres serializes them with brief table locks, and
  // the pool-level statement_timeout prevents any indefinite wait.
  try {
    await query(CREATE_TABLE_SQL)
    await query(MIGRATE_TABLE_SQL)
    await ensureReceiverEmailColumn()
    tableEnsured = true
  } catch (err) {
    console.error("[ensureEmailNavTable] DDL failed:", err)
    // Leave tableEnsured false so a later request can retry.
  }
}

/**
 * Upsert a batch of extracted NAV records.
 * Multiple rows per email are allowed (historical NAV from attachments).
 *
 * @returns Number of rows inserted or updated.
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err != null && (err as { code?: string }).code === "23505"
}

async function ensureReceiverEmailColumn(): Promise<void> {
  const cols = await query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'ops_email_nav_records'
        AND column_name = 'receiver_email'
    ) AS exists
  `)
  if (cols[0]?.exists) return
  await query(
    `ALTER TABLE ops_email_nav_records
       ADD COLUMN IF NOT EXISTS receiver_email TEXT NOT NULL DEFAULT ''`,
  )
}

function receiverEmailValue(r: EmailNavInsert): string {
  return String(r.receiverEmail ?? "").trim().toLowerCase()
}

/**
 * `添运1号历史净值.xlsx` has no 备案号. Reuse a code already stored on a
 * longer legal name (众量资产添运1号…) so the series lands on the same fund.
 */
async function fillMissingEmailNavProductCodes(records: EmailNavInsert[]): Promise<void> {
  const missingNames = [
    ...new Set(
      records
        .filter((r) => !String(r.productCode ?? "").trim() && String(r.fundName ?? "").trim())
        .map((r) => String(r.fundName).trim()),
    ),
  ]
  if (missingNames.length === 0) return

  const known = await query<{ product_code: string; fund_name: string }>(
    `SELECT DISTINCT UPPER(BTRIM(product_code)) AS product_code, BTRIM(fund_name) AS fund_name
     FROM ops_email_nav_records
     WHERE NULLIF(BTRIM(product_code), '') IS NOT NULL
       AND NULLIF(BTRIM(fund_name), '') IS NOT NULL
       AND (${missingNames.map((_, i) => `fund_name ILIKE '%' || $${i + 1} || '%'`).join(" OR ")})`,
    missingNames,
  )
  if (known.length === 0) return

  const codeByNickname = new Map<string, string>()
  for (const nick of missingNames) {
    const hits = known.filter((row) => fundNicknameMatchesFullName(nick, row.fund_name))
    const codes = [...new Set(hits.map((row) => row.product_code))]
    if (codes.length === 1 && codes[0]) codeByNickname.set(nick, codes[0])
  }
  if (codeByNickname.size === 0) return

  for (const record of records) {
    if (String(record.productCode ?? "").trim()) continue
    const nick = String(record.fundName ?? "").trim()
    const code = codeByNickname.get(nick)
    if (code) record.productCode = code
  }
}

export async function upsertEmailNavRecords(records: EmailNavInsert[]): Promise<number> {
  if (records.length === 0) return 0
  await ensureEmailNavTable()
  await fillMissingEmailNavProductCodes(records)

  // Custody 净值表 often forward-fills Fri onto Sat/Sun — never persist those as NAV dates.
  const { isChinaTradingDay } = await import("@/lib/server/china-trading-calendar")

  let droppedLegacyUnique = false
  let count = 0
  for (const r of records) {
    const navDate = String(r.navDate ?? "").slice(0, 10)
    if (!navDate || !isChinaTradingDay(navDate)) continue

    const productCode =
      applyEmailProductCodeOverride(
        r.productCode,
        r.fundName,
        r.subject,
      ) ?? ""
    const params = [
      r.crawlEmailAccount,
      r.emailUid,
      r.sentAt,
      r.subject,
      r.senderEmail,
      receiverEmailValue(r),
      navDate,
      r.nav,
      r.cumulativeNav,
      r.adjustedNav,
      productCode,
      r.fundName,
      r.source,
      r.attachmentFilename ?? "",
    ]
    const insertSql = `INSERT INTO ops_email_nav_records
         (crawl_email_account, email_uid, sent_at, subject, sender_email, receiver_email,
          nav_date, nav, cumulative_nav, adjusted_nav, product_code, fund_name, source, attachment_filename)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (crawl_email_account, email_uid, nav_date, attachment_filename, product_code) DO UPDATE SET
         sent_at         = EXCLUDED.sent_at,
         subject         = EXCLUDED.subject,
         sender_email    = EXCLUDED.sender_email,
         receiver_email  = COALESCE(NULLIF(EXCLUDED.receiver_email, ''), ops_email_nav_records.receiver_email),
         nav             = EXCLUDED.nav,
         cumulative_nav  = EXCLUDED.cumulative_nav,
         adjusted_nav    = EXCLUDED.adjusted_nav,
         fund_name       = EXCLUDED.fund_name,
         source          = EXCLUDED.source`
    try {
      await query(insertSql, params)
      count++
    } catch (err) {
      if (!isUniqueViolation(err) || droppedLegacyUnique) throw err
      // Leftover 4-column unique key still rejects same-email multi-product rows.
      await query(
        `ALTER TABLE ops_email_nav_records DROP CONSTRAINT IF EXISTS uq_email_nav_record_date`,
      ).catch(() => {})
      droppedLegacyUnique = true
      await query(insertSql, params)
      count++
    }
  }
  return count
}
