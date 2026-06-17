-- Migration: create ops_email_valuation_records table
-- Stores full 估值表 data extracted from crawled fund emails (attachments + inline tables).
-- Safe to re-run (uses IF NOT EXISTS).

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
    holdings_count       INT         NOT NULL DEFAULT 0,
    source               TEXT,       -- attachment_valuation_table | body_html_table
    summary              JSONB,
    holdings             JSONB       NOT NULL DEFAULT '[]',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE INDEX IF NOT EXISTS idx_email_valuation_records_valuation_date
    ON ops_email_valuation_records (valuation_date DESC);

CREATE INDEX IF NOT EXISTS idx_email_valuation_records_fund_name
    ON ops_email_valuation_records (fund_name);

CREATE INDEX IF NOT EXISTS idx_email_valuation_records_product_code
    ON ops_email_valuation_records (product_code);
