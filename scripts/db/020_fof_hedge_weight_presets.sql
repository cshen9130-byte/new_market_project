-- Shared / personal FOF 股票单边敞口 product-risk-weight presets.
-- Run once on the DB server as a superuser if the app user cannot CREATE TABLE:
--   sudo -u postgres psql -d market_data -f scripts/db/020_fof_hedge_weight_presets.sql
--
-- Safe to re-run: uses IF NOT EXISTS and re-applies GRANTs.

CREATE TABLE IF NOT EXISTS public.fof_hedge_weight_presets (
  id TEXT PRIMARY KEY,
  parent_beian VARCHAR(128) NOT NULL,
  scope VARCHAR(16) NOT NULL,
  user_id VARCHAR(255) NOT NULL DEFAULT '',
  name VARCHAR(255) NOT NULL,
  ls_net_assumption_pct NUMERIC NOT NULL DEFAULT 20,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  created_by_name VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS fof_hedge_weight_presets_uniq
  ON public.fof_hedge_weight_presets (parent_beian, scope, user_id, lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fof_hedge_weight_presets TO market_user;
