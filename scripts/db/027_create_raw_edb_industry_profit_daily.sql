-- 027_create_raw_edb_industry_profit_daily.sql
-- Choice/EmQuant c.edb industry / processing margin series for CTA 利润 factor.

CREATE TABLE IF NOT EXISTS raw_edb_industry_profit_daily (
  id           BIGSERIAL PRIMARY KEY,
  trade_date   DATE         NOT NULL,
  emi_code     VARCHAR(32)  NOT NULL,
  product      VARCHAR(16),
  name_cn      VARCHAR(128),
  value        NUMERIC,
  freq_hint    VARCHAR(16),
  source       VARCHAR(30)  NOT NULL DEFAULT 'emquant',
  fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (trade_date, emi_code)
);

CREATE INDEX IF NOT EXISTS idx_raw_edb_profit_date
  ON raw_edb_industry_profit_daily (trade_date);

CREATE INDEX IF NOT EXISTS idx_raw_edb_profit_product_date
  ON raw_edb_industry_profit_daily (product, trade_date);

COMMENT ON TABLE raw_edb_industry_profit_daily IS
  'Choice c.edb EMI/EMM industry profit & processing margins. For CTA report_profit calibration; not live-wired yet.';
