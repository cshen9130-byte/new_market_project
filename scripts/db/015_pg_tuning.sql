-- PostgreSQL server tuning for the 2 vCPU / 3.4 GB ETL host.
-- Defaults shipped by the Ubuntu package assume a spinning disk and a tiny cache,
-- which pushed the planner away from index scans on the fund-name match joins.
--
-- Apply as superuser:  psql -d market_data -f 015_pg_tuning.sql
-- Every setting below except shared_buffers takes effect on reload.
-- shared_buffers stays pending until the next postgres restart.

-- 128MB -> 1GB (~29% of RAM). Keeps the hot fund/NAV tables resident.
ALTER SYSTEM SET shared_buffers = '1GB';

-- Cloud ESSD, not a spinning disk: random reads cost about the same as sequential.
-- At the default 4.0 the planner priced index scans out of contention.
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;

-- Total RAM is 3.4GB, so the 4GB default oversold how much the OS can cache.
ALTER SYSTEM SET effective_cache_size = '2560MB';

-- 4MB spilled almost every sort/hash in the list-cache rebuilds to disk.
-- Bounded by DB_POOL_MAX=20 app connections, so worst case stays under ~1GB.
ALTER SYSTEM SET work_mem = '16MB';

-- Speeds up CREATE INDEX and VACUUM on the 250k-row private_fund_info.
ALTER SYSTEM SET maintenance_work_mem = '256MB';

SELECT pg_reload_conf();

-- Settings still waiting on a restart (expect shared_buffers here).
SELECT name, setting, pending_restart FROM pg_settings WHERE pending_restart;
