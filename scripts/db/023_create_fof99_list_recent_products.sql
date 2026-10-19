-- Products on the paid 火富牛 /fund/advancedlist read used by 近一月名单.
-- type=1 平台策略, fund_type=2 私募证券, fund_state=1 正常运作,
-- price_date >= cutoff. The page reads this table and does not call the API.
CREATE TABLE IF NOT EXISTS fof99_list_recent_products (
  reg_code     TEXT        PRIMARY KEY,
  product_name TEXT,
  price_date   DATE        NOT NULL,
  price_nav    NUMERIC(16, 6),
  policy       TEXT        NOT NULL CHECK (policy IN ('weekly', 'weekly_plus', 'update_slow', 'skip', 'none')),
  measured_on  DATE        NOT NULL,
  cutoff       DATE        NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fof99_list_recent_products_policy
  ON fof99_list_recent_products (policy, price_date DESC);
