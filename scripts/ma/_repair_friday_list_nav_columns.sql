\pset pager off

SELECT
  COUNT(*) AS list_rows,
  COUNT(*) FILTER (WHERE n.cum_nav_withdrawal > n.cumulative_nav) AS still_reversed,
  COUNT(*) FILTER (WHERE n.cumulative_nav > n.cum_nav_withdrawal) AS already_adj_above_cum,
  COUNT(*) FILTER (WHERE n.cumulative_nav IS NOT DISTINCT FROM n.cum_nav_withdrawal) AS equal_or_null
FROM private_fund_nav n
JOIN fof99_nav_fetch_log g
  ON UPPER(BTRIM(g.reg_code)) = UPPER(BTRIM(n.beian_hao))
 AND g.price_date = n.price_date
WHERE g.batch_id ~ '^fri-pm-[0-9]{4}-[0-9]{2}-[0-9]{2}-p[0-9]+$'
  AND g.status = 'ok';
