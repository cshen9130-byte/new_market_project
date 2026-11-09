-- Choice 公募「增强指数型」universe and daily NAV.
-- Share classes (A/C/E and listed ETFs) each keep their own series.
-- Source: EmQuant c.csd UNITNAV / ACCUMULATEDNAV / ADJUSTEDNAV.
-- ADJUSTEDNAV is 复权单位净值 and is stored in rehabilitation_nav.

CREATE TABLE IF NOT EXISTS public_enhanced_index_share (
    choice_code          VARCHAR(20) PRIMARY KEY,
    fund_code            VARCHAR(12) NOT NULL,
    short_name           TEXT,
    full_name            TEXT,
    share_class          TEXT,
    product_form         TEXT,
    market_type          TEXT,
    is_etf               BOOLEAN NOT NULL DEFAULT FALSE,
    is_feeder            BOOLEAN NOT NULL DEFAULT FALSE,
    type_l1              TEXT,
    type_l2              TEXT,
    track_method         TEXT,
    benchmark_index      TEXT,
    inception_date       DATE,
    manager_company      TEXT,
    fund_manager         TEXT,
    benchmark_desc       TEXT,
    snapshot_unit_nav    NUMERIC(20,8),
    snapshot_nav_date    DATE,
    snapshot_return_pct  NUMERIC(12,4),
    aum_yi               NUMERIC(20,4),
    share_scale_text     TEXT,
    top_industry         TEXT,
    list_as_of           DATE NOT NULL DEFAULT DATE '2026-11-09',
    nav_start_date       DATE,
    nav_end_date         DATE,
    nav_row_count        INTEGER,
    nav_fetched_through  DATE,
    nav_fetched_at       TIMESTAMPTZ,
    nav_error            TEXT,
    source               VARCHAR(30) NOT NULL DEFAULT 'choice',
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS public_enhanced_index_share_fund_code_idx
    ON public_enhanced_index_share (fund_code);

CREATE INDEX IF NOT EXISTS public_enhanced_index_share_full_name_idx
    ON public_enhanced_index_share (full_name);

CREATE TABLE IF NOT EXISTS public_enhanced_index_nav (
    choice_code         VARCHAR(20) NOT NULL,
    nav_date            DATE        NOT NULL,
    unit_nav            NUMERIC(20,8),
    accumulated_nav     NUMERIC(20,8),
    rehabilitation_nav  NUMERIC(20,8),
    source              VARCHAR(30) NOT NULL DEFAULT 'emquant',
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (choice_code, nav_date)
);

CREATE INDEX IF NOT EXISTS public_enhanced_index_nav_date_idx
    ON public_enhanced_index_nav (nav_date DESC);

COMMENT ON TABLE public_enhanced_index_share IS
    'Choice 增强指数型 share-class list (场内ETF and 场外). One row per Choice ticker such as 159552.SZ or 110003.OF.';

COMMENT ON TABLE public_enhanced_index_nav IS
    'Daily unit / accumulated / rehabilitation NAV from Choice c.csd for public enhanced-index share classes.';
