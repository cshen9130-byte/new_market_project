\pset pager off
SELECT cache_key, beian_hao, tip_nav_date::text, refreshed_at::text
FROM ops_private_fund_detail_nav_cache
WHERE cache_key IN (
  'ZB0807', '宽价种子1号B', 'SALF51', 'SVN917', 'SATL22', 'STG733'
)
   OR beian_hao IN ('ZB0807', 'SXL292', 'AKD71B');

SELECT beian_hao, product_name, nav_date::text, unit_nav::text, return_pct::text, refreshed_at::text
FROM ops_fof_overview_list_cache
WHERE UPPER(BTRIM(beian_hao)) IN ('SXL292', 'ZB0807', 'AKD71B');

DELETE FROM ops_private_fund_detail_nav_cache
WHERE UPPER(BTRIM(cache_key)) = 'ZB0807'
   OR UPPER(BTRIM(beian_hao)) = 'ZB0807';
