\pset pager off

SELECT 'SXL292' AS fund, price_date::text, nav, cumulative_nav, cum_nav_withdrawal
FROM private_fund_nav
WHERE beian_hao = 'SXL292' AND price_date >= DATE '2026-08-28'
ORDER BY price_date;

SELECT 'AKD71B' AS fund, price_date::text, nav, cumulative_nav, cum_nav_withdrawal
FROM private_fund_nav
WHERE beian_hao = 'AKD71B' AND price_date >= DATE '2026-09-04'
ORDER BY price_date;

SELECT 'STE102' AS fund, price_date::text, nav, cumulative_nav, cum_nav_withdrawal
FROM private_fund_nav
WHERE beian_hao = 'STE102' AND price_date IN (DATE '2026-09-10', DATE '2026-09-23')
ORDER BY price_date;

SELECT 'SSD519' AS fund, price_date::text, nav, cumulative_nav, cum_nav_withdrawal
FROM private_fund_nav
WHERE beian_hao = 'SSD519' AND price_date IN (DATE '2026-09-04', DATE '2026-09-24')
ORDER BY price_date;

SELECT cache_key, beian_hao, tip_nav_date::text, tip_unit_nav::text, refreshed_at::text
FROM ops_private_fund_detail_nav_cache
WHERE UPPER(BTRIM(cache_key)) IN ('SXL292', 'AKD71B', 'ZB0807')
   OR UPPER(BTRIM(beian_hao)) IN ('SXL292', 'AKD71B');
