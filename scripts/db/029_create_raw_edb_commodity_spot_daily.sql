-- 029_create_raw_edb_commodity_spot_daily.sql
-- Choice/EmQuant c.edb physical commodity spot prices for CTA report_basis_spot (国君「基差」≈GTJAQH012).

CREATE TABLE IF NOT EXISTS raw_edb_commodity_spot_daily (
  id           BIGSERIAL PRIMARY KEY,
  trade_date   DATE         NOT NULL,
  emi_code     VARCHAR(32)  NOT NULL,
  product      VARCHAR(16),
  name_cn      VARCHAR(128),
  value        NUMERIC,
  freq_hint    VARCHAR(16),
  source_hint  VARCHAR(32),
  unit_hint    VARCHAR(16),
  priority     SMALLINT     NOT NULL DEFAULT 50,
  source       VARCHAR(30)  NOT NULL DEFAULT 'emquant',
  fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (trade_date, emi_code)
);

CREATE INDEX IF NOT EXISTS idx_raw_edb_spot_date
  ON raw_edb_commodity_spot_daily (trade_date);

CREATE INDEX IF NOT EXISTS idx_raw_edb_spot_product_date
  ON raw_edb_commodity_spot_daily (product, trade_date);

COMMENT ON TABLE raw_edb_commodity_spot_daily IS
  'Choice c.edb EMI physical commodity spot (SMM/钢之家/金联创/郑商所 etc). Feeds Futures Style report_basis_spot; Wind GTJAQH012 calib only.';
