-- Fund metrics + FOF underlying 市值 snapshots from email 估值表.
-- Safe to re-run.

ALTER TABLE ops_email_valuation_records
  ADD COLUMN IF NOT EXISTS custody_balance NUMERIC(20,2);
ALTER TABLE ops_email_valuation_records
  ADD COLUMN IF NOT EXISTS net_asset_value NUMERIC(20,2);

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

CREATE TABLE IF NOT EXISTS ops_email_valuation_underlying_market_latest (
    underlying_product_code  TEXT,
    underlying_name          TEXT        NOT NULL,
    valuation_date           DATE        NOT NULL,
    market_value             NUMERIC(20,2),
    quantity                 NUMERIC(20,4),
    source_fof_product_code  TEXT,
    source_fof_fund_name     TEXT,
    refreshed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (underlying_name)
);
