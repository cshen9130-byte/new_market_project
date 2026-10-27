-- 026_create_raw_futures_warehouse_receipts_daily.sql
-- Choice/EmQuant FTREGORDERVOL for commodity continuous contracts.

CREATE TABLE IF NOT EXISTS raw_futures_warehouse_receipts_daily (
  id              BIGSERIAL PRIMARY KEY,
  trade_date      DATE         NOT NULL,
  wind_code       VARCHAR(32)  NOT NULL,
  product         VARCHAR(16)  NOT NULL,
  exchange        VARCHAR(8)   NOT NULL,
  ftregordervol   NUMERIC,
  source          VARCHAR(30)  NOT NULL DEFAULT 'emquant',
  fetched_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (trade_date, wind_code)
);

CREATE INDEX IF NOT EXISTS idx_raw_ft_wh_receipts_date
  ON raw_futures_warehouse_receipts_daily (trade_date);

CREATE INDEX IF NOT EXISTS idx_raw_ft_wh_receipts_product_date
  ON raw_futures_warehouse_receipts_daily (product, trade_date);

COMMENT ON TABLE raw_futures_warehouse_receipts_daily IS
  'Choice c.csd FTREGORDERVOL (registered warehouse receipts). Continuous mains like AU0.SHF. ETL only; not wired into live report_inventory yet.';
