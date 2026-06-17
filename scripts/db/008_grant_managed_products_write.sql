-- Grant the app user write access to managed_products (required for 单只添加).
-- Run once on the server as postgres superuser:
--   sudo -u postgres psql -d market_data -f scripts/db/008_grant_managed_products_write.sql

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE managed_products TO market_user;
GRANT USAGE, SELECT ON SEQUENCE managed_products_id_seq TO market_user;
