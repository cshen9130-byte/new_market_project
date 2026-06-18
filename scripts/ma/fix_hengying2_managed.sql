UPDATE managed_products
SET custody_account_balance = 180827.78,
    net_asset_value = 72159184.17
WHERE product_name ILIKE '%恒盈2号%'
RETURNING product_name, custody_account_balance, net_asset_value;
