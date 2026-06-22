-- Create tracking_custom_pools table and grant access to market_user.
-- Run once on the DB server as a superuser if the table does not yet exist:
--   sudo -u postgres psql -d market_data -f scripts/db/010_create_tracking_custom_pools.sql

CREATE TABLE IF NOT EXISTS tracking_custom_pools (
  id         SERIAL       PRIMARY KEY,
  pool_key   VARCHAR(128) NOT NULL UNIQUE,
  label      VARCHAR(255) NOT NULL,
  scope      VARCHAR(16)  NOT NULL DEFAULT 'team',  -- 'team' | 'mine'
  user_key   VARCHAR(255) NOT NULL DEFAULT '',
  sort_order INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tracking_custom_pools TO market_user;
GRANT USAGE, SELECT ON SEQUENCE tracking_custom_pools_id_seq TO market_user;
