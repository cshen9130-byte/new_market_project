\pset pager off

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'fof99_nav_fetch_log'
ORDER BY ordinal_position;

SELECT reg_code, price_date::text, status, nav, error_code, LEFT(COALESCE(error_msg,''), 80) AS err, batch_id, fetched_at::text
FROM fof99_nav_fetch_log
WHERE UPPER(BTRIM(reg_code)) IN ('SH724B','SSH724')
ORDER BY price_date DESC, fetched_at DESC;

SELECT 'nav_all_range' AS src, beian_hao, MIN(price_date)::text, MAX(price_date)::text, COUNT(*) 
FROM private_fund_nav
WHERE UPPER(BTRIM(beian_hao)) IN ('SH724B','SSH724')
GROUP BY 1,2;

SELECT 'after_may' AS src, beian_hao, price_date::text, nav
FROM private_fund_nav
WHERE UPPER(BTRIM(beian_hao)) IN ('SH724B','SSH724')
  AND price_date > DATE '2026-05-22'
ORDER BY beian_hao, price_date;

SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
  AND table_name ILIKE '%nav%'
ORDER BY 1;
