-- Normalized 估值表 holding rows + latest-trading-day snapshot per fund.
-- Safe to re-run (uses IF NOT EXISTS).

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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_valuation_holding_row'
    ) THEN
        ALTER TABLE ops_email_valuation_holdings
            ADD CONSTRAINT uq_email_valuation_holding_row
            UNIQUE (valuation_record_id, subject_code, subject_name);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_valuation_holdings_record
    ON ops_email_valuation_holdings (valuation_record_id);

CREATE INDEX IF NOT EXISTS idx_email_valuation_holdings_product_date
    ON ops_email_valuation_holdings (product_code, valuation_date DESC);

CREATE INDEX IF NOT EXISTS idx_email_valuation_holdings_fund_date
    ON ops_email_valuation_holdings (fund_name, valuation_date DESC);

CREATE INDEX IF NOT EXISTS idx_email_valuation_holdings_detail
    ON ops_email_valuation_holdings (include_in_detail)
    WHERE include_in_detail = TRUE;

-- Latest trading day holdings per fund (refreshed after email ETL).
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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_email_valuation_fund_holding_latest'
    ) THEN
        ALTER TABLE ops_email_valuation_fund_holdings_latest
            ADD CONSTRAINT uq_email_valuation_fund_holding_latest
            UNIQUE (product_code, fund_name, valuation_date, subject_code, subject_name);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_valuation_fund_holdings_latest_product
    ON ops_email_valuation_fund_holdings_latest (product_code);

CREATE INDEX IF NOT EXISTS idx_email_valuation_fund_holdings_latest_fund
    ON ops_email_valuation_fund_holdings_latest (fund_name);

CREATE INDEX IF NOT EXISTS idx_email_valuation_fund_holdings_latest_date
    ON ops_email_valuation_fund_holdings_latest (valuation_date DESC);
