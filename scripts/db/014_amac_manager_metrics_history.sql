-- Append-only history for AMAC manager metrics (employee count, scale, etc.).
-- Run once as DB owner; safe to re-run.

CREATE TABLE IF NOT EXISTS amac_manager_metrics_history (
    id                        BIGSERIAL PRIMARY KEY,
    registration_no           TEXT NOT NULL,
    manager_name              TEXT,
    snapshot_date             DATE NOT NULL DEFAULT CURRENT_DATE,
    full_time_staff_count     INTEGER,
    fund_practitioner_count   INTEGER,
    mgmt_scale_range          TEXT,
    active_fund_count         INTEGER,
    staff_count               INTEGER,
    fund_manager_count        INTEGER,
    investment_manager_count  INTEGER,
    source                    TEXT NOT NULL DEFAULT 'amac_api',
    captured_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amac_manager_metrics_history_reg_captured
    ON amac_manager_metrics_history (registration_no, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_amac_manager_metrics_history_snapshot_date
    ON amac_manager_metrics_history (snapshot_date DESC, registration_no);

GRANT SELECT, INSERT ON TABLE amac_manager_metrics_history TO market_user;
GRANT USAGE, SELECT ON SEQUENCE amac_manager_metrics_history_id_seq TO market_user;
