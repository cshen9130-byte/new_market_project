-- 028_create_raw_edb_commodity_inventory_daily.sql
-- Choice/EmQuant c.edb social / exchange commodity inventory for CTA report_inventory.

CREATE TABLE IF NOT EXISTS raw_edb_commodity_inventory_daily (
  id           BIGSERIAL PRIMARY KEY,
  trade_date   DATE         NOT NULL,
  emi_code     VARCHAR(32)  NOT NULL,
  product      VARCHAR(16),
  name_cn      VARCHAR(128),
  value        NUMERIC,
  freq_hint    VARCHAR(16),
  region_hint  VARCHAR(16),
  priority     SMALLINT     NOT NULL DEFAULT 50,
  source       VARCHAR(30)  NOT NULL DEFAULT 'emquant',
  fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (trade_date, emi_code)
);

CREATE INDEX IF NOT EXISTS idx_raw_edb_inv_date
  ON raw_edb_commodity_inventory_daily (trade_date);

CREATE INDEX IF NOT EXISTS idx_raw_edb_inv_product_date
  ON raw_edb_commodity_inventory_daily (product, trade_date);

COMMENT ON TABLE raw_edb_commodity_inventory_daily IS
  'Choice c.edb EMI/EMM commodity social/exchange inventory. Prefer China series over LME for CTA report_inventory.';
