-- Precomputed latest email NAV per fund scope (refreshed after email ETL).
-- Safe to re-run (uses IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS ops_email_nav_fund_latest (
    scope_type   TEXT        NOT NULL,
    scope_id     TEXT        NOT NULL,
    product_name TEXT        NOT NULL,
    beian_hao    TEXT,
    unit_nav     NUMERIC(16,6),
    nav_date     DATE,
    return_pct   NUMERIC(16,8),
    nav_source   TEXT,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (scope_type, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_email_nav_fund_latest_beian
    ON ops_email_nav_fund_latest (beian_hao);

CREATE INDEX IF NOT EXISTS idx_email_nav_fund_latest_product
    ON ops_email_nav_fund_latest (product_name);
