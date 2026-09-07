-- Allow weekly_plus on existing fof99_nav_universe rows.
-- weekly_plus = email-first; Friday FundMultiPrice only if list_nav_date is behind that week.
ALTER TABLE fof99_nav_universe DROP CONSTRAINT IF EXISTS fof99_nav_universe_policy_check;
ALTER TABLE fof99_nav_universe
  ADD CONSTRAINT fof99_nav_universe_policy_check
  CHECK (policy IN ('weekly', 'weekly_plus', 'skip', 'update_slow'));
