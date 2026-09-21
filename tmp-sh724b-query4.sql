\pset pager off
SELECT jsonb_typeof(nav_series) AS t,
       nav_series->0 AS first_el,
       nav_series->-1 AS last_el
FROM ops_private_fund_detail_nav_cache
WHERE UPPER(BTRIM(beian_hao)) = 'SH724B';
