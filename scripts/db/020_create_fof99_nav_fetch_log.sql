-- Paid 火富牛 FundMultiPrice attempts. status ok/no_data must never be refetched.
CREATE TABLE IF NOT EXISTS fof99_nav_fetch_log (
  id           BIGSERIAL PRIMARY KEY,
  reg_code     TEXT        NOT NULL,
  price_date   DATE        NOT NULL,
  status       TEXT        NOT NULL CHECK (status IN ('ok', 'no_data', 'error')),
  nav          NUMERIC(16,6),
  error_code   TEXT,
  error_msg    TEXT,
  batch_id     TEXT,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reg_code, price_date)
);

CREATE INDEX IF NOT EXISTS idx_fof99_nav_fetch_date
  ON fof99_nav_fetch_log (price_date DESC, status);
