SELECT fund_name, product_code, custody_balance::text, net_asset_value::text
FROM ops_email_valuation_fund_metrics_latest
WHERE fund_name ILIKE '%海宸1号%' OR fund_name ILIKE '%恒盈2%'
ORDER BY fund_name;

SELECT product_name, custody_balance::text, net_asset_value::text
FROM ops_managed_products_list_cache
WHERE product_name ILIKE '%海宸1号%' OR product_name ILIKE '%恒盈2%'
ORDER BY product_name;
