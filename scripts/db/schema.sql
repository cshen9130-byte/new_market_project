-- =============================================================
-- Market Dashboard – PostgreSQL Schema
-- Standalone PostgreSQL (not Supabase-managed; no RLS / auth.users)
--
-- Run once on the server:
--   psql -U market_user -d market_data -f schema.sql
--
-- Tables
--   Raw layer  : stores exactly what each external API returns
--   Derived    : pre-computed chart-ready metrics
--   Ops        : pipeline audit log
-- =============================================================


-- =============================================================
-- RAW LAYER
-- =============================================================

-- South-China Commodity Index (NHCI) daily close
-- Source: EmQuant  (get_nanhua_index.py)
CREATE TABLE IF NOT EXISTS raw_nhci_daily (
    id          BIGSERIAL     PRIMARY KEY,
    trade_date  DATE          NOT NULL,
    close       NUMERIC(12,4) NOT NULL,
    source      VARCHAR(30)   NOT NULL DEFAULT 'emquant',
    fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT raw_nhci_daily_uq UNIQUE (trade_date)
);
CREATE INDEX IF NOT EXISTS raw_nhci_daily_date_idx
    ON raw_nhci_daily (trade_date DESC);


-- South-China Energy & Chemical Index (NHECI) daily close
-- Source: EmQuant  (get_nanhua_energy_index.py)
CREATE TABLE IF NOT EXISTS raw_nheci_daily (
    id          BIGSERIAL     PRIMARY KEY,
    trade_date  DATE          NOT NULL,
    close       NUMERIC(12,4) NOT NULL,
    source      VARCHAR(30)   NOT NULL DEFAULT 'emquant',
    fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT raw_nheci_daily_uq UNIQUE (trade_date)
);
CREATE INDEX IF NOT EXISTS raw_nheci_daily_date_idx
    ON raw_nheci_daily (trade_date DESC);


-- CFFEX index futures daily quotes
-- Covers both specific-expiry contracts (IF2506.CFX) and
-- continuous legs (IFL.CFX = near/L, IFL1.CFX = L1, IFL2.CFX, IFL3.CFX)
-- Source: Tushare  (get_cffex_index_futures_*.py)
CREATE TABLE IF NOT EXISTS raw_futures_daily (
    id              BIGSERIAL     PRIMARY KEY,
    ts_code         VARCHAR(20)   NOT NULL,   -- e.g. IF2506.CFX, IFL1.CFX
    symbol          VARCHAR(5)    NOT NULL,   -- IH | IF | IC | IM
    trade_date      DATE          NOT NULL,
    close           NUMERIC(12,4),
    settle          NUMERIC(12,4),
    pre_close       NUMERIC(12,4),
    pre_settle      NUMERIC(12,4),
    settle_return   NUMERIC(12,6),            -- % daily change
    source          VARCHAR(30)   NOT NULL DEFAULT 'tushare',
    fetched_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT raw_futures_daily_uq UNIQUE (ts_code, trade_date)
);
CREATE INDEX IF NOT EXISTS raw_futures_daily_sym_date_idx
    ON raw_futures_daily (symbol, trade_date DESC);
CREATE INDEX IF NOT EXISTS raw_futures_daily_code_date_idx
    ON raw_futures_daily (ts_code, trade_date DESC);


-- Spot index daily close for IH/IF/IC/IM underlying indices
-- Source: EmQuant css()  (get_spot_indices_close.py)
--         or Tushare index_daily  (get_spot_indices_close_tushare.py)
CREATE TABLE IF NOT EXISTS raw_spot_daily (
    id          BIGSERIAL     PRIMARY KEY,
    symbol      VARCHAR(5)    NOT NULL,   -- IH | IF | IC | IM
    trade_date  DATE          NOT NULL,
    close       NUMERIC(12,4) NOT NULL,
    source      VARCHAR(30)   NOT NULL,   -- 'emquant' | 'tushare'
    fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT raw_spot_daily_uq UNIQUE (symbol, trade_date, source)
);
CREATE INDEX IF NOT EXISTS raw_spot_daily_sym_date_idx
    ON raw_spot_daily (symbol, trade_date DESC);


-- All-commodity futures daily amount + return (for heatmap chart)
-- Source: Choice / EmQuant css()  (get_choice_all_futures_latest.py)
CREATE TABLE IF NOT EXISTS raw_commodity_amount_daily (
    id          BIGSERIAL     PRIMARY KEY,
    trade_date  DATE          NOT NULL,
    code        VARCHAR(30)   NOT NULL,   -- e.g. A0.DCE
    name        VARCHAR(100),             -- Chinese product name
    sector      VARCHAR(30)   NOT NULL,   -- computed sector bucket
    return_pct  NUMERIC(10,4),
    amount      BIGINT,                   -- CNY
    source      VARCHAR(30)   NOT NULL DEFAULT 'choice',
    fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT raw_commodity_amount_daily_uq UNIQUE (trade_date, code)
);
CREATE INDEX IF NOT EXISTS raw_commodity_amount_daily_date_idx
    ON raw_commodity_amount_daily (trade_date DESC);


-- A-share stock daily OHLCV + volume + amount + turnover
-- Source: Choice / EmQuant c.csd()  (fetch_ashare_daily.py)
CREATE TABLE IF NOT EXISTS raw_ashare_daily (
    trade_date  DATE          NOT NULL,
    ts_code     VARCHAR(20)   NOT NULL,
    open        NUMERIC(12,4),
    close       NUMERIC(12,4),
    high        NUMERIC(12,4),
    low         NUMERIC(12,4),
    volume      BIGINT,
    amount      NUMERIC(20,2),
    turn        NUMERIC(12,6),
    source      VARCHAR(30)   NOT NULL DEFAULT 'choice',
    fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT raw_ashare_daily_uq UNIQUE (trade_date, ts_code)
);
CREATE INDEX IF NOT EXISTS raw_ashare_daily_date_idx
    ON raw_ashare_daily (trade_date DESC);
CREATE INDEX IF NOT EXISTS raw_ashare_daily_code_date_idx
    ON raw_ashare_daily (ts_code, trade_date DESC);


-- A-share stock code → Chinese name lookup
-- Source: AkShare stock_info_a_code_name()  (nightly_etl step_ashare_stock_names)
CREATE TABLE IF NOT EXISTS dim_ashare_stock (
    ts_code     VARCHAR(20)   PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);


-- A-share market crowding metrics (成交额集中度 / 板块占比)
-- Computed from raw_ashare_daily by nightly_etl step_compute_ashare_crowding
CREATE TABLE IF NOT EXISTS derived_ashare_crowding_daily (
    trade_date       DATE          PRIMARY KEY,
    total_amount     NUMERIC(20,2),
    hhi              NUMERIC(12,8),
    top3_share       NUMERIC(8,4),
    top10_share      NUMERIC(8,4),
    top5pct_share    NUMERIC(8,4),
    crowding_pct     NUMERIC(6,2),
    top_board        VARCHAR(30),
    top_board_share  NUMERIC(8,4),
    board_shares     JSONB,
    computed_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS derived_ashare_crowding_daily_date_idx
    ON derived_ashare_crowding_daily (trade_date DESC);


-- A-share hot industry / concept boards (涨跌幅排名)
-- Source: AkShare 同花顺行业 + 新浪概念 (nightly_etl step_ashare_hot_sectors)
CREATE TABLE IF NOT EXISTS derived_ashare_hot_sectors_daily (
    trade_date       DATE         NOT NULL,
    board_type       VARCHAR(20)  NOT NULL,  -- industry | concept
    board_name       VARCHAR(100) NOT NULL,
    change_pct       NUMERIC(10,4),
    amount           NUMERIC(20,2),         -- yuan
    lead_stock       VARCHAR(100),
    lead_change_pct  NUMERIC(10,4),
    rank_no          INTEGER,
    source           VARCHAR(60),
    fetched_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (trade_date, board_type, board_name)
);
CREATE INDEX IF NOT EXISTS derived_ashare_hot_sectors_daily_lookup_idx
    ON derived_ashare_hot_sectors_daily (trade_date DESC, board_type, rank_no);


-- Selected industry/concept board daily amount + return (for sector crowding chart)
-- Source: AkShare 同花顺板块指数历史 (backfill_ashare_board_amount_hist.py)
CREATE TABLE IF NOT EXISTS derived_ashare_board_amount_daily (
    trade_date   DATE         NOT NULL,
    board_type   VARCHAR(20)  NOT NULL,  -- industry | concept
    board_name   VARCHAR(100) NOT NULL,
    amount       NUMERIC(20,2),         -- yuan
    change_pct   NUMERIC(10,4),
    close        NUMERIC(16,4),
    source       VARCHAR(60),
    fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (trade_date, board_type, board_name)
);
CREATE INDEX IF NOT EXISTS derived_ashare_board_amount_daily_lookup_idx
    ON derived_ashare_board_amount_daily (board_type, board_name, trade_date DESC);


-- Sector fund flow (净流入, 亿元) + cumulative stock computed in API
-- Live: AkShare 同花顺即时行业/概念资金流; Hist proxy: amount × return
CREATE TABLE IF NOT EXISTS derived_ashare_sector_fund_flow_daily (
    trade_date   DATE         NOT NULL,
    board_type   VARCHAR(20)  NOT NULL,  -- industry | concept
    board_name   VARCHAR(100) NOT NULL,
    inflow       NUMERIC(20,4),         -- 亿元
    outflow      NUMERIC(20,4),
    net_flow     NUMERIC(20,4),         -- 亿元
    change_pct   NUMERIC(10,4),
    source       VARCHAR(60),
    fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (trade_date, board_type, board_name)
);
CREATE INDEX IF NOT EXISTS derived_ashare_sector_fund_flow_daily_lookup_idx
    ON derived_ashare_sector_fund_flow_daily (board_type, board_name, trade_date DESC);


-- =============================================================
-- DERIVED LAYER  (computed from raw tables)
-- =============================================================

-- Latest-day snapshot per symbol  →  replaces futures_cache.json
-- Mirrors the structure consumed by the futures-market page cards
CREATE TABLE IF NOT EXISTS derived_futures_snapshot (
    id                  BIGSERIAL     PRIMARY KEY,
    symbol              VARCHAR(5)    NOT NULL,   -- IH | IF | IC | IM
    trade_date          DATE          NOT NULL,
    -- main contract (L1 continuous, highest OI in the day)
    ts_code             VARCHAR(20),
    close               NUMERIC(12,4),
    settle              NUMERIC(12,4),
    settle_return       NUMERIC(12,6),
    -- near-month continuous (L)
    near_ts_code        VARCHAR(20),
    near_close          NUMERIC(12,4),
    near_settle         NUMERIC(12,4),
    near_settle_return  NUMERIC(12,6),
    -- far-month from daily pool (L3 / furthest available)
    far_ts_code         VARCHAR(20),
    far_close           NUMERIC(12,4),
    far_settle          NUMERIC(12,4),
    far_settle_return   NUMERIC(12,6),
    -- L1 continuous used as anchor for basis computation
    far_cont_ts_code    VARCHAR(20),
    computed_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT derived_futures_snapshot_uq UNIQUE (symbol, trade_date)
);
CREATE INDEX IF NOT EXISTS derived_futures_snapshot_sym_date_idx
    ON derived_futures_snapshot (symbol, trade_date DESC);


-- Daily annualised basis and absolute diff for near/far contracts
-- Replaces basis_cache.json (far) and basis_near_cache.json (near)
-- Also contains basis_diff_timeseries_cache and near_diff_timeseries series
CREATE TABLE IF NOT EXISTS derived_basis_daily (
    id                   BIGSERIAL     PRIMARY KEY,
    symbol               VARCHAR(5)    NOT NULL,   -- IH | IF | IC | IM
    trade_date           DATE          NOT NULL,
    basis_type           VARCHAR(5)    NOT NULL,   -- 'far' | 'near'
    futures_ts_code      VARCHAR(20),
    spot_close           NUMERIC(12,4),
    futures_settle       NUMERIC(12,4),
    days_to_maturity     INTEGER,
    expiry_date          DATE,
    annualized_basis_pct NUMERIC(12,6),
    basis_diff           NUMERIC(10,4),            -- futures_settle - spot_close
    computed_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT derived_basis_daily_uq UNIQUE (symbol, trade_date, basis_type)
);
CREATE INDEX IF NOT EXISTS derived_basis_daily_sym_date_type_idx
    ON derived_basis_daily (symbol, trade_date DESC, basis_type);


-- Daily basis diffs for continuous legs L / L1 / L2 / L3
-- Replaces basis_cont_diff_timeseries_cache.json
CREATE TABLE IF NOT EXISTS derived_basis_cont_daily (
    id              BIGSERIAL     PRIMARY KEY,
    symbol          VARCHAR(5)    NOT NULL,   -- IH | IF | IC | IM
    trade_date      DATE          NOT NULL,
    leg             VARCHAR(5)    NOT NULL,   -- L | L1 | L2 | L3
    futures_ts_code VARCHAR(20),
    spot_close      NUMERIC(12,4),
    futures_settle  NUMERIC(12,4),
    basis_diff      NUMERIC(10,4),
    computed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT derived_basis_cont_daily_uq UNIQUE (symbol, trade_date, leg)
);
CREATE INDEX IF NOT EXISTS derived_basis_cont_daily_sym_date_idx
    ON derived_basis_cont_daily (symbol, trade_date DESC);


-- =============================================================
-- TRACKING FUNDS  (investment dashboard – pool management)
-- =============================================================

-- User-created pool definitions (team-shared or per-user "mine" lists).
-- Managed by /ma/api/tracking-funds/pools.
CREATE TABLE IF NOT EXISTS tracking_custom_pools (
  id         SERIAL       PRIMARY KEY,
  pool_key   VARCHAR(128) NOT NULL UNIQUE,
  label      VARCHAR(255) NOT NULL,
  scope      VARCHAR(16)  NOT NULL DEFAULT 'team',  -- 'team' | 'mine'
  user_key   VARCHAR(255) NOT NULL DEFAULT '',
  sort_order INTEGER      NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tracking_custom_pools TO market_user;
GRANT USAGE, SELECT ON SEQUENCE tracking_custom_pools_id_seq TO market_user;

-- =============================================================
-- OPERATIONS / AUDIT
-- =============================================================

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id            BIGSERIAL    PRIMARY KEY,
    job_name      VARCHAR(100) NOT NULL,
    step_name     VARCHAR(100),
    started_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ,
    status        VARCHAR(20)  NOT NULL DEFAULT 'running',  -- running | success | failed | skipped
    trade_date    DATE,
    rows_affected INTEGER,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS pipeline_runs_started_idx
    ON pipeline_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_runs_status_idx
    ON pipeline_runs (status);


-- =============================================================
-- MARKET PREDICTION  (current_market_prediction model)
-- =============================================================

-- Raw daily prices for the 6 ETFs used by the scaler/PCA/GMM pipeline.
-- Tickers: 510300.SH 510500.SH 511010.SH 511220.SH 511880.SH 518880.SH
-- Field is always ORIGINALUNIT (adjusted NAV).  Source: EmQuant / Choice API.
CREATE TABLE IF NOT EXISTS raw_etf_daily (
    id          BIGSERIAL     PRIMARY KEY,
    trade_date  DATE          NOT NULL,
    ticker      VARCHAR(20)   NOT NULL,
    field       VARCHAR(30)   NOT NULL DEFAULT 'ORIGINALUNIT',
    value       NUMERIC(20,6),
    source      VARCHAR(30)   NOT NULL DEFAULT 'emquant',
    fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT raw_etf_daily_uq UNIQUE (trade_date, ticker, field)
);
CREATE INDEX IF NOT EXISTS raw_etf_daily_date_idx
    ON raw_etf_daily (trade_date DESC);
CREATE INDEX IF NOT EXISTS raw_etf_daily_ticker_date_idx
    ON raw_etf_daily (ticker, trade_date DESC);


-- Daily market cluster prediction (PC1, PC2 coordinates + GMM cluster label).
-- One row per trading day; written by predict_market_cluster.py via nightly ETL.
CREATE TABLE IF NOT EXISTS current_market_prediction (
    id          BIGSERIAL     PRIMARY KEY,
    trade_date  DATE          NOT NULL,
    cluster     SMALLINT,
    pc1         NUMERIC(12,8),
    pc2         NUMERIC(12,8),
    freq        VARCHAR(10)   NOT NULL DEFAULT 'daily',
    computed_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT current_market_prediction_uq UNIQUE (trade_date, freq)
);
CREATE INDEX IF NOT EXISTS current_market_prediction_date_idx
    ON current_market_prediction (trade_date DESC);
