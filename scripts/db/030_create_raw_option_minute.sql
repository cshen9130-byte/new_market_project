-- Rolling 1-minute option and underlying prints for the index IV charts.
-- Keeps the latest 10 Shanghai trading days (call, put, and spot for every listed month).

CREATE TABLE IF NOT EXISTS raw_option_contract (
  underlying_key TEXT NOT NULL,
  contract_id    TEXT NOT NULL,
  side           TEXT NOT NULL,
  month_code     TEXT NOT NULL DEFAULT '',
  strike         DOUBLE PRECISION,
  expire_day     DATE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (underlying_key, contract_id)
);

CREATE TABLE IF NOT EXISTS raw_option_minute (
  underlying_key TEXT NOT NULL,
  contract_id    TEXT NOT NULL,
  bar_time       TIMESTAMPTZ NOT NULL,
  price          DOUBLE PRECISION NOT NULL,
  volume         DOUBLE PRECISION,
  PRIMARY KEY (underlying_key, contract_id, bar_time)
);

CREATE INDEX IF NOT EXISTS idx_raw_option_minute_key_time
  ON raw_option_minute (underlying_key, bar_time DESC);

CREATE TABLE IF NOT EXISTS raw_option_minute_state (
  job         TEXT PRIMARY KEY,
  finished_on DATE NOT NULL,
  row_count   INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE raw_option_minute IS
  'Rolling 10-session 1-minute prices for SSE ETF options, CFFEX HO/IO/MO, and their underlyings. Feeds /ma dashboard IV lookback.';
