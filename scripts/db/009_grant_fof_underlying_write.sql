-- Grant the app user write access to fof_underlying_summary and fof_underlying_detail.
-- Required for auto-add of new FOF underlying funds discovered via email parsing,
-- and for syncEmailValuationToProductTables() updating fof_underlying_summary.market_value.
--
-- Run once on the server as postgres superuser:
--   sudo -u postgres psql -d market_data -f scripts/db/009_grant_fof_underlying_write.sql

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE fof_underlying_summary TO market_user;
GRANT USAGE, SELECT ON SEQUENCE fof_underlying_summary_id_seq TO market_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE fof_underlying_detail TO market_user;
GRANT USAGE, SELECT ON SEQUENCE fof_underlying_detail_id_seq TO market_user;
