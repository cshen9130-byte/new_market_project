-- Migration: create ops_email_nav_records table
-- Stores NAV values extracted from crawled fund emails.
-- Supports multiple NAV dates per email (e.g. historical rows from 净值表 attachments)
-- and multiple products packed into one CMS/招商 【净值表】 email.
-- Safe to re-run (uses IF NOT EXISTS / IF EXISTS).

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
    source               TEXT,       -- subject | body_table | body_post_table | attachment_nav_table
    attachment_filename  TEXT        NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ops_email_nav_records
    ADD COLUMN IF NOT EXISTS attachment_filename TEXT NOT NULL DEFAULT '';

ALTER TABLE ops_email_nav_records
    DROP CONSTRAINT IF EXISTS uq_email_nav_record;

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

CREATE INDEX IF NOT EXISTS idx_email_nav_records_nav_date
    ON ops_email_nav_records (nav_date DESC);

CREATE INDEX IF NOT EXISTS idx_email_nav_records_fund_name
    ON ops_email_nav_records (fund_name);

CREATE INDEX IF NOT EXISTS idx_email_nav_records_product_code
    ON ops_email_nav_records (product_code);
