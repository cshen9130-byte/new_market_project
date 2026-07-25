-- Persisted FOF底层 估值表 NAV series for the 15-minute incremental refresh.
-- Full rebuilds rewrite the lookback window; intraday ticks read this table and only
-- rescans a short recent holdings delta (see loadManagedUnderlyingNavHistoryIncremental).
-- The app also CREATE TABLE IF NOT EXISTS on first use — this file is for explicit ops apply.

CREATE TABLE IF NOT EXISTS ops_fof_underlying_valuation_nav_history (
  product_name  TEXT           NOT NULL,
  beian_hao     TEXT,
  nav_date      DATE           NOT NULL,
  unit_nav      NUMERIC(16,6)  NOT NULL,
  refreshed_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_name, nav_date)
);

CREATE INDEX IF NOT EXISTS idx_fof_val_nav_hist_beian_date
  ON ops_fof_underlying_valuation_nav_history (beian_hao, nav_date DESC);
