-- AMAC manager 机构网址 + cached 公司简介 / 投资理念 / 投资策略.
-- Safe to re-run.

ALTER TABLE amac_manager_details
    ADD COLUMN IF NOT EXISTS website_url TEXT;

CREATE TABLE IF NOT EXISTS manager_profile_texts (
    registration_no                 TEXT PRIMARY KEY,
    manager_name                    TEXT,
    website_url                     TEXT,
    company_intro                   TEXT,
    investment_philosophy           TEXT,
    investment_strategy             TEXT,
    company_intro_source            TEXT,
    investment_philosophy_source    TEXT,
    investment_strategy_source      TEXT,
    fetched_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    website_fetched_at              TIMESTAMPTZ,
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manager_profile_texts_fetched_at
    ON manager_profile_texts (fetched_at DESC);

GRANT SELECT, INSERT, UPDATE ON TABLE manager_profile_texts TO market_user;
