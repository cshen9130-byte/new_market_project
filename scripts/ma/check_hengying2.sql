SELECT 'metrics' AS src, fund_name, product_code, custody_balance::text, net_asset_value::text
FROM ops_email_valuation_fund_metrics_latest
WHERE fund_name ILIKE '%恒盈2%';

SELECT 'cache' AS src, product_name, custody_balance::text, net_asset_value::text
FROM ops_managed_products_list_cache
WHERE product_name ILIKE '%恒盈2%';

SELECT id, custody_balance::text, net_asset_value::text, total_asset::text, total_liability::text
FROM ops_email_valuation_records
WHERE id = 166;
