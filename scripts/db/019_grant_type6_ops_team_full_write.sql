-- Grant market_user write access to type6_ops_team_full (required for bfl运维池 add/remove).
-- Run once on the server as postgres superuser:
--   sudo -u postgres psql -d market_data -f scripts/db/019_grant_type6_ops_team_full_write.sql

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE type6_ops_team_full TO market_user;
GRANT USAGE, SELECT ON SEQUENCE type6_ops_team_full_id_seq TO market_user;
