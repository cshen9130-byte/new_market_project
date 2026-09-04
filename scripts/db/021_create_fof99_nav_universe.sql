-- Frozen 火富牛 fetch policy.
-- weekly      = keep paying Friday FundMultiPrice
-- skip        = confirmed no 火富牛 series (empty-date probe no_data); never retry
-- update_slow = 火富牛 has an old latest NAV; do not pay unless policy is changed
CREATE TABLE IF NOT EXISTS fof99_nav_universe (
  reg_code     TEXT        PRIMARY KEY,
  product_name TEXT,
  policy       TEXT        NOT NULL CHECK (policy IN ('weekly', 'skip', 'update_slow')),
  reason       TEXT,
  listed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fof99_nav_universe_policy
  ON fof99_nav_universe (policy);
