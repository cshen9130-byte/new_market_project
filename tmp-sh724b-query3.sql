\pset pager off

SELECT 'email' AS src, product_code, fund_name, nav_date::text, nav, source
FROM ops_email_nav_records
WHERE UPPER(BTRIM(COALESCE(product_code,''))) IN ('SH724B','SSH724')
   OR fund_name ILIKE '%多璨价值驱动6号%'
  AND nav_date BETWEEN DATE '2026-05-01' AND DATE '2026-09-11'
ORDER BY nav_date, product_code
LIMIT 80;

SELECT beian_hao, jsonb_array_length(nav_series) AS n,
       (SELECT MIN(x->>'d') FROM jsonb_array_elements(nav_series) x) AS first_d,
       (SELECT MAX(x->>'d') FROM jsonb_array_elements(nav_series) x) AS last_d
FROM ops_private_fund_detail_nav_cache
WHERE UPPER(BTRIM(beian_hao)) IN ('SH724B','SSH724');

SELECT x->>'d' AS d, x->>'v' AS v, x->>'nav' AS nav, x->>'unit_nav' AS unit_nav
FROM ops_private_fund_detail_nav_cache c,
     jsonb_array_elements(c.nav_series) x
WHERE UPPER(BTRIM(c.beian_hao)) = 'SH724B'
  AND (x->>'d') BETWEEN '2026-05-01' AND '2026-09-11'
ORDER BY 1;

SELECT total_credits, fund_multi_price_credits, other_mall_credits FROM fof99_credit_usage;
