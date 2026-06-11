-- Migration: create ops_email_nav_records table
-- Stores NAV values extracted from crawled fund emails.
-- Safe to run multiple times (uses CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).

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
    source               TEXT,       -- 'subject' | 'body_table' | 'body_post_table'
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_email_nav_record UNIQUE (crawl_email_account, email_uid)
);

CREATE INDEX IF NOT EXISTS idx_email_nav_records_nav_date
    ON ops_email_nav_records (nav_date DESC);

CREATE INDEX IF NOT EXISTS idx_email_nav_records_fund_name
    ON ops_email_nav_records (fund_name);

CREATE INDEX IF NOT EXISTS idx_email_nav_records_product_code
    ON ops_email_nav_records (product_code);
