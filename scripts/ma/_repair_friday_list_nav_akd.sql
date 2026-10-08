\pset pager off
SELECT n.price_date::text, n.nav, n.cumulative_nav, n.cum_nav_withdrawal, g.batch_id
FROM private_fund_nav n
LEFT JOIN fof99_nav_fetch_log g
  ON g.reg_code = n.beian_hao AND g.price_date = n.price_date
WHERE n.beian_hao = 'AKD71B'
ORDER BY n.price_date;

SELECT price_date::text, cumulative_nav, cum_nav_withdrawal
FROM private_fund_nav
WHERE beian_hao = 'SXL292' AND price_date IN (DATE '2026-09-04', DATE '2026-09-29')
ORDER BY price_date;
