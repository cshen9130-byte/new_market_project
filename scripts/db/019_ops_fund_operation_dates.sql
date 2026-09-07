-- 运作日 is stored here because market_user cannot ALTER basicinfo_bfl_track
-- (migration 013 / ADD COLUMN operation_date fails with "must be owner").
CREATE TABLE IF NOT EXISTS ops_fund_operation_dates (
  beian_hao VARCHAR(64) PRIMARY KEY,
  operation_date DATE NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
