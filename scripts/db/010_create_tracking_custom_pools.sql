-- Create tracking_custom_pools table and grant access to market_user.
-- Run once on the DB server as a superuser (required for production pool rename to work):
--   sudo -u postgres psql -d market_data -f scripts/db/010_create_tracking_custom_pools.sql
--
-- Safe to re-run: uses IF NOT EXISTS and re-applies GRANTs.

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

-- Seed the four built-in team pools if missing (labels preserved when row already exists).
INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
SELECT 'bfl_ops', 'bfl 运维池', 'team', '', 1, NOW()
WHERE NOT EXISTS (SELECT 1 FROM tracking_custom_pools WHERE pool_key = 'bfl_ops');
INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
SELECT 'bfl', 'bfl跟踪池', 'team', '', 2, NOW()
WHERE NOT EXISTS (SELECT 1 FROM tracking_custom_pools WHERE pool_key = 'bfl');
INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
SELECT 'jy_ops', 'JY运维池', 'team', '', 3, NOW()
WHERE NOT EXISTS (SELECT 1 FROM tracking_custom_pools WHERE pool_key = 'jy_ops');
INSERT INTO tracking_custom_pools (pool_key, label, scope, user_key, sort_order, updated_at)
SELECT 'jy', 'JY跟踪池', 'team', '', 4, NOW()
WHERE NOT EXISTS (SELECT 1 FROM tracking_custom_pools WHERE pool_key = 'jy');
