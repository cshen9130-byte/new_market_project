\pset pager off
\pset format aligned

SELECT 'info' AS src, beian_hao, product_name, latest_nav, latest_nav_date::text
FROM private_fund_info
WHERE UPPER(BTRIM(beian_hao)) IN ('SH724B','SSH724','SH77248','SH7248');

SELECT 'universe' AS src, reg_code, product_name, policy, reason, updated_at::text
FROM fof99_nav_universe
WHERE UPPER(BTRIM(reg_code)) IN ('SH724B','SSH724','SH77248','SH7248');

SELECT 'nav_2026' AS src, beian_hao, price_date::text, nav, cumulative_nav, cum_nav_withdrawal
FROM private_fund_nav
WHERE UPPER(BTRIM(beian_hao)) IN ('SH724B','SSH724','SH77248','SH7248')
  AND price_date BETWEEN DATE '2026-04-01' AND DATE '2026-09-11'
ORDER BY beian_hao, price_date;

SELECT beian_hao,
       COUNT(*) FILTER (WHERE price_date > DATE '2026-05-22' AND price_date < DATE '2026-08-07') AS pts_in_gap,
       MIN(price_date) FILTER (WHERE price_date > DATE '2026-05-22' AND price_date < DATE '2026-08-07') AS first_gap_pt,
       MAX(price_date) FILTER (WHERE price_date > DATE '2026-05-22' AND price_date < DATE '2026-08-07') AS last_gap_pt
FROM private_fund_nav
WHERE UPPER(BTRIM(beian_hao)) IN ('SH724B','SSH724','SH77248','SH7248')
GROUP BY beian_hao;

SELECT 'fetch_log' AS src, reg_code, price_date::text, status, rows_ok, fetched_at::text, LEFT(COALESCE(error,''), 120) AS err
FROM fof99_nav_fetch_log
WHERE UPPER(BTRIM(reg_code)) IN ('SH724B','SSH724','SH77248','SH7248','batch:SH724B')
   OR UPPER(BTRIM(reg_code)) LIKE '%SH724B%'
   OR UPPER(BTRIM(reg_code)) LIKE '%SSH724%'
ORDER BY price_date DESC, fetched_at DESC
LIMIT 80;

SELECT 'amac' AS src, fund_no, fund_name, working_state
FROM amac_private_funds
WHERE UPPER(BTRIM(fund_no)) IN ('SH724B','SSH724','SH77248','SH7248')
   OR fund_name ILIKE '%多璨价值驱动6号%';
