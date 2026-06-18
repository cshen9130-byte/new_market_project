-- Underlying holdings (底层产品) for 在管产品 FOF funds, extracted from email 估值表.
-- Excludes 荣熙恒盈2号 (non-FOF). Safe to re-run.

CREATE TABLE IF NOT EXISTS ops_managed_fof_underlying (
    id                       BIGSERIAL PRIMARY KEY,
    managed_product_id       BIGINT      NOT NULL,
    fof_product_name         TEXT        NOT NULL,
    fof_product_code         TEXT,
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

CREATE INDEX IF NOT EXISTS idx_managed_fof_underlying_product
    ON ops_managed_fof_underlying (managed_product_id);

CREATE INDEX IF NOT EXISTS idx_managed_fof_underlying_fof_code
    ON ops_managed_fof_underlying (fof_product_code);

CREATE INDEX IF NOT EXISTS idx_managed_fof_underlying_underlying_code
    ON ops_managed_fof_underlying (underlying_product_code);

CREATE INDEX IF NOT EXISTS idx_managed_fof_underlying_date
    ON ops_managed_fof_underlying (valuation_date DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_managed_fof_underlying_row'
    ) THEN
        ALTER TABLE ops_managed_fof_underlying
            ADD CONSTRAINT uq_managed_fof_underlying_row
            UNIQUE (managed_product_id, valuation_date, underlying_product_code, underlying_name, subject_code);
    END IF;
END $$;
