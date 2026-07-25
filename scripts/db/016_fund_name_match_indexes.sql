-- Functional indexes for the fuzzy fund-name matching in lib/server/fund-name-match.ts.
--
-- The lateral joins in the 在管产品 / FOF底层 rebuilds compare BTRIM(name) and the
-- suffix-stripped "base" name. Neither was indexed, so every outer row drove a full
-- scan of private_fund_info (249k rows) while re-evaluating three regexp_replace calls
-- per inner row. The expressions below are byte-for-byte the ones sqlFundNameBase emits;
-- if that helper changes, these indexes must change with it or they stop being used.
--
-- Apply as superuser, NOT inside a transaction (CONCURRENTLY forbids it):
--   psql -d market_data -f 016_fund_name_match_indexes.sql
-- CONCURRENTLY keeps writes online: it takes only SHARE UPDATE EXCLUSIVE.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- private_fund_info: the 249k-row table that dominates every match join.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pfi_name_trim
  ON private_fund_info (BTRIM(product_name));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pfi_name_base
  ON private_fund_info ((NULLIF(regexp_replace(
    regexp_replace(
      regexp_replace(BTRIM(product_name), '[ABC]类$', ''),
      '(私募证券投资基金|私募基金|证券投资基金|投资基金)$', ''
    ),
    '\s+$', ''
  ), '')));

-- Trigram indexes serve the forward-prefix branches (column ILIKE target || '%').
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pfi_name_trim_trgm
  ON private_fund_info USING gin (BTRIM(product_name) gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pfi_name_base_trgm
  ON private_fund_info USING gin ((NULLIF(regexp_replace(
    regexp_replace(
      regexp_replace(BTRIM(product_name), '[ABC]类$', ''),
      '(私募证券投资基金|私募基金|证券投资基金|投资基金)$', ''
    ),
    '\s+$', ''
  ), '')) gin_trgm_ops);

-- ops_email_valuation_holdings: 117k rows, matched on subject_name.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oevh_subject_trim
  ON ops_email_valuation_holdings (BTRIM(subject_name));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oevh_subject_base
  ON ops_email_valuation_holdings ((NULLIF(regexp_replace(
    regexp_replace(
      regexp_replace(BTRIM(subject_name), '[ABC]类$', ''),
      '(私募证券投资基金|私募基金|证券投资基金|投资基金)$', ''
    ),
    '\s+$', ''
  ), '')));

-- ops_email_nav_records: 17k rows, matched on fund_name when resolving 备案号.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oenr_fund_name_trim
  ON ops_email_nav_records (BTRIM(fund_name));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_oenr_fund_name_base
  ON ops_email_nav_records ((NULLIF(regexp_replace(
    regexp_replace(
      regexp_replace(BTRIM(fund_name), '[ABC]类$', ''),
      '(私募证券投资基金|私募基金|证券投资基金|投资基金)$', ''
    ),
    '\s+$', ''
  ), '')));

-- type6_ops_team_full and private_fund_info_bfl are small but sit in the hot
-- lateral chain, and both had stale statistics (n_live_tup reported 0).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_t6otf_fund_name_trim
  ON type6_ops_team_full (BTRIM(fund_name));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_t6otf_fund_short_name_trim
  ON type6_ops_team_full (BTRIM(fund_short_name));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pfib_product_name_trim
  ON private_fund_info_bfl (BTRIM(product_name));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pfib_short_name_trim
  ON private_fund_info_bfl (BTRIM(short_name));

-- Expression indexes get their own statistics only after ANALYZE.
ANALYZE private_fund_info;
ANALYZE ops_email_valuation_holdings;
ANALYZE ops_email_nav_records;
ANALYZE ops_email_valuation_records;
ANALYZE type6_ops_team_full;
ANALYZE private_fund_info_bfl;
