-- Team / personal FOF 波动分析 gap-fill presets (ignore / proxy / assume).
-- Run once on the DB server as a superuser if the app user cannot CREATE TABLE:
--   sudo -u postgres psql -d market_data -f scripts/db/021_fof_var_gap_presets.sql
--
-- Safe to re-run: uses IF NOT EXISTS and re-applies GRANTs.

CREATE TABLE IF NOT EXISTS public.fof_var_gap_presets (
  id TEXT PRIMARY KEY,
  parent_beian VARCHAR(128) NOT NULL,
  scope VARCHAR(16) NOT NULL,
  user_id VARCHAR(255) NOT NULL DEFAULT '',
  name VARCHAR(255) NOT NULL,
  assume_vol_pct NUMERIC NOT NULL DEFAULT 10,
  assume_corr NUMERIC NOT NULL DEFAULT 0.3,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by VARCHAR(255) NOT NULL DEFAULT '',
  created_by_name VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS fof_var_gap_presets_uniq
  ON public.fof_var_gap_presets (parent_beian, scope, user_id, lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fof_var_gap_presets TO market_user;
