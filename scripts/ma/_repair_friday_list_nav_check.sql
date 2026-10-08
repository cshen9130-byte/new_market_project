\pset pager off
SELECT price_date::text, cumulative_nav, cum_nav_withdrawal
FROM private_fund_nav
WHERE beian_hao = 'SXL292'
  AND price_date IN (DATE '2026-09-04', DATE '2026-09-24', DATE '2026-09-29')
ORDER BY price_date;
