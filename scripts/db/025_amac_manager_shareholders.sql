-- AMAC 出资人信息 + cached GSXT/工商 snapshot for the 企业信息 tab.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS amac_manager_shareholders (
    id                      SERIAL PRIMARY KEY,
    registration_no         TEXT NOT NULL,
    manager_name            TEXT,
    seq                     INTEGER,
    investor_name           TEXT NOT NULL,
    holding_ratio           TEXT,
    shareholder_type        TEXT,
    subscribed_amount       TEXT,
    source_file             TEXT NOT NULL DEFAULT 'manager_shareholders.csv',
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_manager_shareholders_uq UNIQUE (registration_no, investor_name)
);

CREATE INDEX IF NOT EXISTS idx_amac_manager_shareholders_registration_no
    ON amac_manager_shareholders (registration_no);

CREATE TABLE IF NOT EXISTS manager_gsxt_cache (
    registration_no         TEXT PRIMARY KEY,
    manager_name            TEXT,
    status                  TEXT NOT NULL DEFAULT 'empty',
    source                  TEXT,
    business_reg_no         TEXT,
    unified_credit_code     TEXT,
    business_term           TEXT,
    business_scope          TEXT,
    operating_status        TEXT,
    payload                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    fetched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE ON TABLE amac_manager_shareholders TO market_user;
GRANT USAGE, SELECT ON SEQUENCE amac_manager_shareholders_id_seq TO market_user;
GRANT SELECT, INSERT, UPDATE ON TABLE manager_gsxt_cache TO market_user;
