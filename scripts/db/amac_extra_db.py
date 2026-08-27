"""Shared PostgreSQL schema and row loaders for AMAC extra tables."""

from __future__ import annotations

import csv
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_CSV_DIR = ROOT / "fetch_amac_data" / "amac_extra"


def dash_to_none(val):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s == "-":
        return None
    return s


def parse_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s or s == "-":
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def parse_int(val) -> int | None:
    if val is None:
        return None
    s = str(val).strip()
    if not s or s == "-":
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


DDL = """
CREATE TABLE IF NOT EXISTS amac_managers (
    id                    SERIAL PRIMARY KEY,
    manager_name          TEXT NOT NULL,
    legal_rep_name        TEXT,
    org_type              TEXT,
    registration_no       TEXT NOT NULL,
    reg_province          TEXT,
    reg_city              TEXT,
    reg_location          TEXT,
    office_location       TEXT,
    inception_date        DATE,
    registration_date     DATE,
    active_fund_count     INTEGER,
    member_type           TEXT,
    has_alert_info        TEXT,
    has_integrity_info    TEXT,
    detail_url            TEXT,
    manager_id            TEXT,
    source_file           TEXT NOT NULL DEFAULT 'managers.csv',
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_managers_registration_no_uq UNIQUE (registration_no)
);

CREATE INDEX IF NOT EXISTS idx_amac_managers_manager_name
    ON amac_managers (manager_name);

CREATE TABLE IF NOT EXISTS amac_person_org_stats (
    id                                    SERIAL PRIMARY KEY,
    org_name                              TEXT NOT NULL,
    org_user_id                           TEXT,
    org_code                              TEXT,
    org_name_spell                        TEXT,
    org_type                              TEXT,
    staff_count                           INTEGER,
    fund_qualification_count              INTEGER,
    fund_sales_qualification_count        INTEGER,
    investment_manager_count              INTEGER,
    fund_manager_count                    INTEGER,
    external_staff_count                  INTEGER,
    external_fund_qualification_count     INTEGER,
    external_fund_sales_qualification_count INTEGER,
    external_investment_manager_count     INTEGER,
    external_fund_manager_count           INTEGER,
    personnel_fetched_at                  TIMESTAMPTZ,
    source_file                           TEXT NOT NULL DEFAULT 'person_org_stats.csv',
    updated_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_person_org_stats_org_name_uq UNIQUE (org_name)
);

CREATE INDEX IF NOT EXISTS idx_amac_person_org_stats_org_type
    ON amac_person_org_stats (org_type);

CREATE INDEX IF NOT EXISTS idx_amac_person_org_stats_org_user_id
    ON amac_person_org_stats (org_user_id);

CREATE TABLE IF NOT EXISTS amac_manager_details (
    id                                      SERIAL PRIMARY KEY,
    registration_no                         TEXT NOT NULL,
    manager_name_cn                         TEXT,
    manager_name_en                         TEXT,
    org_code                                TEXT,
    registration_date                       DATE,
    inception_date                          DATE,
    registered_address                      TEXT,
    office_address                          TEXT,
    registered_capital_cny_wan              TEXT,
    paid_in_capital_cny_wan                 TEXT,
    paid_in_capital_ratio                   TEXT,
    enterprise_nature                       TEXT,
    org_type                                TEXT,
    business_type                           TEXT,
    full_time_staff_count                   INTEGER,
    fund_practitioner_count                 INTEGER,
    mgmt_scale_range                        TEXT,
    is_investment_advisory_third_party      TEXT,
    actual_controller                       TEXT,
    is_member                               TEXT,
    law_firm_name                           TEXT,
    lawyer_name                             TEXT,
    disclosure_backup_investor_query_rate   TEXT,
    detail_url                              TEXT,
    source_file                             TEXT NOT NULL DEFAULT 'manager_details.csv',
    updated_at                              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_manager_details_registration_no_uq UNIQUE (registration_no)
);

CREATE INDEX IF NOT EXISTS idx_amac_manager_details_manager_name_cn
    ON amac_manager_details (manager_name_cn);

CREATE TABLE IF NOT EXISTS amac_manager_executives (
    id                      SERIAL PRIMARY KEY,
    registration_no         TEXT NOT NULL,
    manager_name            TEXT,
    person_name             TEXT NOT NULL,
    title                   TEXT NOT NULL,
    has_fund_qualification  TEXT,
    qualification_method    TEXT,
    source_file             TEXT NOT NULL DEFAULT 'manager_executives.csv',
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_manager_executives_uq UNIQUE (registration_no, person_name, title)
);

CREATE INDEX IF NOT EXISTS idx_amac_manager_executives_registration_no
    ON amac_manager_executives (registration_no);

CREATE TABLE IF NOT EXISTS amac_manager_executive_resume (
    id                SERIAL PRIMARY KEY,
    registration_no   TEXT NOT NULL,
    manager_name      TEXT,
    person_name       TEXT NOT NULL,
    executive_title   TEXT NOT NULL,
    period            TEXT,
    employer          TEXT,
    department        TEXT,
    title             TEXT,
    source_file       TEXT NOT NULL DEFAULT 'manager_executive_resume.csv',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_manager_executive_resume_uq UNIQUE (
        registration_no, person_name, executive_title, period, employer, department, title
    )
);

CREATE INDEX IF NOT EXISTS idx_amac_manager_executive_resume_registration_no
    ON amac_manager_executive_resume (registration_no);

CREATE TABLE IF NOT EXISTS amac_personnel (
    id                          SERIAL PRIMARY KEY,
    org_user_id                 TEXT NOT NULL,
    account_id                  TEXT,
    person_name                 TEXT NOT NULL,
    sex                         TEXT,
    cert_code                   TEXT NOT NULL,
    org_name                    TEXT,
    own_org_name                TEXT,
    cert_name                   TEXT,
    education_name              TEXT,
    cert_obtain_date            DATE,
    cert_end_date               DATE,
    cert_status_change_times    INTEGER,
    credit_record_num           INTEGER,
    cert_status                 INTEGER,
    cert_status_name            TEXT,
    office_state                INTEGER,
    removed                     TEXT,
    biz_id                      TEXT,
    exception_flag              TEXT,
    source_file                 TEXT NOT NULL DEFAULT 'personnel.csv',
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_personnel_uq UNIQUE (org_user_id, cert_code)
);

CREATE INDEX IF NOT EXISTS idx_amac_personnel_org_user_id
    ON amac_personnel (org_user_id);

CREATE INDEX IF NOT EXISTS idx_amac_personnel_org_name
    ON amac_personnel (org_name);

CREATE INDEX IF NOT EXISTS idx_amac_personnel_person_name
    ON amac_personnel (person_name);

CREATE INDEX IF NOT EXISTS idx_amac_personnel_account_id
    ON amac_personnel (account_id);

CREATE TABLE IF NOT EXISTS amac_personnel_cert_history (
    id                  SERIAL PRIMARY KEY,
    org_user_id         TEXT NOT NULL,
    account_id          TEXT,
    person_name         TEXT,
    history_id          TEXT NOT NULL,
    org_name            TEXT,
    cert_code           TEXT,
    cert_name           TEXT,
    cert_obtain_date    DATE,
    cert_end_date       DATE,
    cert_status         INTEGER,
    cert_status_name    TEXT,
    created_on          DATE,
    qlf_id              TEXT,
    source_file         TEXT NOT NULL DEFAULT 'personnel_cert_history.csv',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_personnel_cert_history_uq UNIQUE (history_id)
);

CREATE INDEX IF NOT EXISTS idx_amac_personnel_cert_history_org_user_id
    ON amac_personnel_cert_history (org_user_id);

CREATE INDEX IF NOT EXISTS idx_amac_personnel_cert_history_account_id
    ON amac_personnel_cert_history (account_id);

CREATE TABLE IF NOT EXISTS amac_extra_sync_state (
    id                              TEXT PRIMARY KEY DEFAULT 'default',
    last_managers_upserted          INTEGER NOT NULL DEFAULT 0,
    last_person_org_upserted        INTEGER NOT NULL DEFAULT 0,
    last_details_fetched            INTEGER NOT NULL DEFAULT 0,
    last_executives_upserted        INTEGER NOT NULL DEFAULT 0,
    last_resumes_upserted           INTEGER NOT NULL DEFAULT 0,
    last_personnel_upserted         INTEGER NOT NULL DEFAULT 0,
    last_personnel_orgs_fetched     INTEGER NOT NULL DEFAULT 0,
    last_personnel_certs_upserted   INTEGER NOT NULL DEFAULT 0,
    last_full_details_sync_at       TIMESTAMPTZ,
    last_incremental_sync_at        TIMESTAMPTZ,
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
"""

SCHEMA_MIGRATIONS = [
    "ALTER TABLE amac_person_org_stats ADD COLUMN IF NOT EXISTS org_user_id TEXT",
    "ALTER TABLE amac_person_org_stats ADD COLUMN IF NOT EXISTS org_code TEXT",
    "ALTER TABLE amac_person_org_stats ADD COLUMN IF NOT EXISTS org_name_spell TEXT",
    "ALTER TABLE amac_person_org_stats ADD COLUMN IF NOT EXISTS personnel_fetched_at TIMESTAMPTZ",
    "ALTER TABLE amac_extra_sync_state ADD COLUMN IF NOT EXISTS last_personnel_upserted INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE amac_extra_sync_state ADD COLUMN IF NOT EXISTS last_personnel_orgs_fetched INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE amac_extra_sync_state ADD COLUMN IF NOT EXISTS last_personnel_certs_upserted INTEGER NOT NULL DEFAULT 0",
]


def ensure_schema(cur) -> None:
    cur.execute(DDL)
    for stmt in SCHEMA_MIGRATIONS:
        cur.execute(stmt)
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_amac_person_org_stats_org_user_id
            ON amac_person_org_stats (org_user_id)
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_amac_person_org_stats_personnel_fetched
            ON amac_person_org_stats (personnel_fetched_at NULLS FIRST)
        """
    )


UPSERT_MANAGERS = """
INSERT INTO amac_managers (
    manager_name, legal_rep_name, org_type, registration_no, reg_province, reg_city,
    reg_location, office_location, inception_date, registration_date, active_fund_count,
    member_type, has_alert_info, has_integrity_info, detail_url, manager_id, source_file
) VALUES %s
ON CONFLICT (registration_no) DO UPDATE SET
    manager_name      = EXCLUDED.manager_name,
    legal_rep_name    = EXCLUDED.legal_rep_name,
    org_type          = EXCLUDED.org_type,
    reg_province      = EXCLUDED.reg_province,
    reg_city          = EXCLUDED.reg_city,
    reg_location      = EXCLUDED.reg_location,
    office_location   = EXCLUDED.office_location,
    inception_date    = EXCLUDED.inception_date,
    registration_date = EXCLUDED.registration_date,
    active_fund_count = COALESCE(EXCLUDED.active_fund_count, amac_managers.active_fund_count),
    member_type       = EXCLUDED.member_type,
    has_alert_info    = EXCLUDED.has_alert_info,
    has_integrity_info = EXCLUDED.has_integrity_info,
    detail_url        = EXCLUDED.detail_url,
    manager_id        = EXCLUDED.manager_id,
    source_file       = EXCLUDED.source_file,
    updated_at        = NOW()
"""

UPSERT_PERSON_ORG = """
INSERT INTO amac_person_org_stats (
    org_name, org_user_id, org_code, org_name_spell, org_type, staff_count, fund_qualification_count,
    fund_sales_qualification_count, investment_manager_count, fund_manager_count,
    external_staff_count, external_fund_qualification_count,
    external_fund_sales_qualification_count, external_investment_manager_count,
    external_fund_manager_count, source_file
) VALUES %s
ON CONFLICT (org_name) DO UPDATE SET
    org_user_id                           = COALESCE(EXCLUDED.org_user_id, amac_person_org_stats.org_user_id),
    org_code                              = COALESCE(EXCLUDED.org_code, amac_person_org_stats.org_code),
    org_name_spell                        = COALESCE(EXCLUDED.org_name_spell, amac_person_org_stats.org_name_spell),
    org_type                              = EXCLUDED.org_type,
    staff_count                           = COALESCE(EXCLUDED.staff_count, amac_person_org_stats.staff_count),
    fund_qualification_count              = COALESCE(EXCLUDED.fund_qualification_count, amac_person_org_stats.fund_qualification_count),
    fund_sales_qualification_count        = COALESCE(EXCLUDED.fund_sales_qualification_count, amac_person_org_stats.fund_sales_qualification_count),
    investment_manager_count              = COALESCE(EXCLUDED.investment_manager_count, amac_person_org_stats.investment_manager_count),
    fund_manager_count                    = COALESCE(EXCLUDED.fund_manager_count, amac_person_org_stats.fund_manager_count),
    external_staff_count                  = COALESCE(EXCLUDED.external_staff_count, amac_person_org_stats.external_staff_count),
    external_fund_qualification_count     = COALESCE(EXCLUDED.external_fund_qualification_count, amac_person_org_stats.external_fund_qualification_count),
    external_fund_sales_qualification_count = COALESCE(EXCLUDED.external_fund_sales_qualification_count, amac_person_org_stats.external_fund_sales_qualification_count),
    external_investment_manager_count     = COALESCE(EXCLUDED.external_investment_manager_count, amac_person_org_stats.external_investment_manager_count),
    external_fund_manager_count           = COALESCE(EXCLUDED.external_fund_manager_count, amac_person_org_stats.external_fund_manager_count),
    source_file                           = EXCLUDED.source_file,
    updated_at                            = NOW()
"""

UPSERT_MANAGER_DETAILS = """
INSERT INTO amac_manager_details (
    registration_no, manager_name_cn, manager_name_en, org_code, registration_date,
    inception_date, registered_address, office_address, registered_capital_cny_wan,
    paid_in_capital_cny_wan, paid_in_capital_ratio, enterprise_nature, org_type,
    business_type, full_time_staff_count, fund_practitioner_count, mgmt_scale_range,
    is_investment_advisory_third_party, actual_controller, is_member, law_firm_name,
    lawyer_name, disclosure_backup_investor_query_rate, detail_url, source_file
) VALUES %s
ON CONFLICT (registration_no) DO UPDATE SET
    manager_name_cn                       = EXCLUDED.manager_name_cn,
    manager_name_en                       = EXCLUDED.manager_name_en,
    org_code                              = EXCLUDED.org_code,
    registration_date                     = EXCLUDED.registration_date,
    inception_date                        = EXCLUDED.inception_date,
    registered_address                    = EXCLUDED.registered_address,
    office_address                        = EXCLUDED.office_address,
    registered_capital_cny_wan            = EXCLUDED.registered_capital_cny_wan,
    paid_in_capital_cny_wan               = EXCLUDED.paid_in_capital_cny_wan,
    paid_in_capital_ratio                 = EXCLUDED.paid_in_capital_ratio,
    enterprise_nature                     = EXCLUDED.enterprise_nature,
    org_type                              = EXCLUDED.org_type,
    business_type                         = EXCLUDED.business_type,
    full_time_staff_count                 = COALESCE(EXCLUDED.full_time_staff_count, amac_manager_details.full_time_staff_count),
    fund_practitioner_count               = COALESCE(EXCLUDED.fund_practitioner_count, amac_manager_details.fund_practitioner_count),
    mgmt_scale_range                      = COALESCE(EXCLUDED.mgmt_scale_range, amac_manager_details.mgmt_scale_range),
    is_investment_advisory_third_party    = EXCLUDED.is_investment_advisory_third_party,
    actual_controller                     = EXCLUDED.actual_controller,
    is_member                             = EXCLUDED.is_member,
    law_firm_name                         = EXCLUDED.law_firm_name,
    lawyer_name                           = EXCLUDED.lawyer_name,
    disclosure_backup_investor_query_rate = EXCLUDED.disclosure_backup_investor_query_rate,
    detail_url                            = EXCLUDED.detail_url,
    source_file                           = EXCLUDED.source_file,
    updated_at                            = NOW()
"""

UPSERT_EXECUTIVES = """
INSERT INTO amac_manager_executives (
    registration_no, manager_name, person_name, title,
    has_fund_qualification, qualification_method, source_file
) VALUES %s
ON CONFLICT (registration_no, person_name, title) DO UPDATE SET
    manager_name           = EXCLUDED.manager_name,
    has_fund_qualification = EXCLUDED.has_fund_qualification,
    qualification_method   = EXCLUDED.qualification_method,
    source_file            = EXCLUDED.source_file,
    updated_at             = NOW()
"""

UPSERT_EXECUTIVE_RESUME = """
INSERT INTO amac_manager_executive_resume (
    registration_no, manager_name, person_name, executive_title, period,
    employer, department, title, source_file
) VALUES %s
ON CONFLICT (
    registration_no, person_name, executive_title, period, employer, department, title
) DO UPDATE SET
    manager_name = EXCLUDED.manager_name,
    source_file  = EXCLUDED.source_file,
    updated_at   = NOW()
"""

UPSERT_PERSONNEL = """
INSERT INTO amac_personnel (
    org_user_id, account_id, person_name, sex, cert_code, org_name, own_org_name,
    cert_name, education_name, cert_obtain_date, cert_end_date, cert_status_change_times,
    credit_record_num, cert_status, cert_status_name, office_state, removed, biz_id,
    exception_flag, source_file
) VALUES %s
ON CONFLICT (org_user_id, cert_code) DO UPDATE SET
    account_id               = EXCLUDED.account_id,
    person_name              = EXCLUDED.person_name,
    sex                      = EXCLUDED.sex,
    org_name                 = EXCLUDED.org_name,
    own_org_name             = EXCLUDED.own_org_name,
    cert_name                = EXCLUDED.cert_name,
    education_name           = EXCLUDED.education_name,
    cert_obtain_date         = EXCLUDED.cert_obtain_date,
    cert_end_date            = EXCLUDED.cert_end_date,
    cert_status_change_times = COALESCE(EXCLUDED.cert_status_change_times, amac_personnel.cert_status_change_times),
    credit_record_num        = COALESCE(EXCLUDED.credit_record_num, amac_personnel.credit_record_num),
    cert_status              = EXCLUDED.cert_status,
    cert_status_name         = EXCLUDED.cert_status_name,
    office_state             = EXCLUDED.office_state,
    removed                  = EXCLUDED.removed,
    biz_id                   = EXCLUDED.biz_id,
    exception_flag           = EXCLUDED.exception_flag,
    source_file              = EXCLUDED.source_file,
    updated_at               = NOW()
"""

UPSERT_PERSONNEL_CERT_HISTORY = """
INSERT INTO amac_personnel_cert_history (
    org_user_id, account_id, person_name, history_id, org_name, cert_code, cert_name,
    cert_obtain_date, cert_end_date, cert_status, cert_status_name, created_on, qlf_id,
    source_file
) VALUES %s
ON CONFLICT (history_id) DO UPDATE SET
    org_user_id      = EXCLUDED.org_user_id,
    account_id       = EXCLUDED.account_id,
    person_name      = EXCLUDED.person_name,
    org_name         = EXCLUDED.org_name,
    cert_code        = EXCLUDED.cert_code,
    cert_name        = EXCLUDED.cert_name,
    cert_obtain_date = EXCLUDED.cert_obtain_date,
    cert_end_date    = EXCLUDED.cert_end_date,
    cert_status      = EXCLUDED.cert_status,
    cert_status_name = EXCLUDED.cert_status_name,
    created_on       = EXCLUDED.created_on,
    qlf_id           = EXCLUDED.qlf_id,
    source_file      = EXCLUDED.source_file,
    updated_at       = NOW()
"""

DELETE_PERSONNEL_FOR_ORG = "DELETE FROM amac_personnel WHERE org_user_id = %s"
DELETE_PERSONNEL_HISTORY_FOR_ORG = "DELETE FROM amac_personnel_cert_history WHERE org_user_id = %s"
MARK_PERSONNEL_FETCHED = """
UPDATE amac_person_org_stats
SET personnel_fetched_at = NOW()
WHERE org_user_id = %s
"""

SELECT_PERSONNEL_TARGETS = """
SELECT org_user_id, org_name, staff_count, personnel_fetched_at
FROM amac_person_org_stats
WHERE org_user_id IS NOT NULL AND org_user_id <> ''
ORDER BY
    CASE WHEN personnel_fetched_at IS NULL THEN 0 ELSE 1 END,
    personnel_fetched_at ASC NULLS FIRST,
    COALESCE(staff_count, 0) DESC,
    org_name
"""

SOURCE_API = "amac_api"


def manager_csv_row_to_tuple(row: dict, *, source: str = SOURCE_API) -> tuple | None:
    reg_no = dash_to_none(row.get("登记编号"))
    name = dash_to_none(row.get("私募基金管理人名称"))
    if not reg_no or not name:
        return None
    return (
        name,
        dash_to_none(row.get("法定代表人/执行事务合伙人(委派代表)姓名")),
        dash_to_none(row.get("机构类型")),
        reg_no,
        dash_to_none(row.get("注册地省份")),
        dash_to_none(row.get("注册地城市")),
        dash_to_none(row.get("注册地")),
        dash_to_none(row.get("办公地")),
        parse_date(row.get("成立时间")),
        parse_date(row.get("登记时间")),
        parse_int(row.get("在管基金数量")),
        dash_to_none(row.get("会员类型")),
        dash_to_none(row.get("是否有提示信息")),
        dash_to_none(row.get("是否有诚信信息")),
        dash_to_none(row.get("详情链接")),
        dash_to_none(row.get("管理人ID")),
        source,
    )


def person_org_csv_row_to_tuple(row: dict, *, source: str = SOURCE_API) -> tuple | None:
    org_name = dash_to_none(row.get("机构名称"))
    if not org_name:
        return None
    return (
        org_name,
        dash_to_none(row.get("机构用户ID")),
        dash_to_none(row.get("组织机构代码")),
        dash_to_none(row.get("机构名称拼音")),
        dash_to_none(row.get("机构类型")),
        parse_int(row.get("员工人数")),
        parse_int(row.get("基金从业资格")),
        parse_int(row.get("基金销售业务资格")),
        parse_int(row.get("投资经理")),
        parse_int(row.get("基金经理")),
        parse_int(row.get("外部员工人数")),
        parse_int(row.get("外部基金从业资格")),
        parse_int(row.get("外部基金销售业务资格")),
        parse_int(row.get("外部投资经理")),
        parse_int(row.get("外部基金经理")),
        source,
    )


def manager_detail_csv_row_to_tuple(row: dict, *, source: str = SOURCE_API) -> tuple | None:
    reg_no = dash_to_none(row.get("登记编号"))
    if not reg_no:
        return None
    return (
        reg_no,
        dash_to_none(row.get("基金管理人全称(中文)")),
        dash_to_none(row.get("基金管理人全称(英文)")),
        dash_to_none(row.get("组织机构代码")),
        parse_date(row.get("登记时间")),
        parse_date(row.get("成立时间")),
        dash_to_none(row.get("注册地址")),
        dash_to_none(row.get("办公地址")),
        dash_to_none(row.get("注册资本(万元)(人民币)")),
        dash_to_none(row.get("实缴资本(万元)(人民币)")),
        dash_to_none(row.get("注册资本实缴比例")),
        dash_to_none(row.get("企业性质")),
        dash_to_none(row.get("机构类型")),
        dash_to_none(row.get("业务类型")),
        parse_int(row.get("全职员工人数")),
        parse_int(row.get("取得基金从业人数")),
        dash_to_none(row.get("管理规模区间")),
        dash_to_none(row.get("是否为符合提供投资建议条件的第三方机构")),
        dash_to_none(row.get("实际控制人姓名 / 名称")),
        dash_to_none(row.get("是否为会员")),
        dash_to_none(row.get("律师事务所名称")),
        dash_to_none(row.get("律师姓名")),
        dash_to_none(row.get("私募基金信息披露备份系统投资者查询账号开立率")),
        dash_to_none(row.get("详情链接")),
        source,
    )


def executive_csv_row_to_tuple(row: dict, *, source: str = SOURCE_API) -> tuple | None:
    reg_no = dash_to_none(row.get("登记编号"))
    person_name = dash_to_none(row.get("姓名"))
    title = dash_to_none(row.get("职务"))
    if not reg_no or not person_name or not title:
        return None
    return (
        reg_no,
        dash_to_none(row.get("管理人名称")),
        person_name,
        title,
        dash_to_none(row.get("是否有基金从业资格")),
        dash_to_none(row.get("资格取得方式")),
        source,
    )


def executive_resume_csv_row_to_tuple(row: dict, *, source: str = SOURCE_API) -> tuple | None:
    reg_no = dash_to_none(row.get("登记编号"))
    person_name = dash_to_none(row.get("姓名"))
    executive_title = dash_to_none(row.get("高管职务"))
    if not reg_no or not person_name or not executive_title:
        return None
    return (
        reg_no,
        dash_to_none(row.get("管理人名称")),
        person_name,
        executive_title,
        dash_to_none(row.get("时间")),
        dash_to_none(row.get("任职单位")),
        dash_to_none(row.get("任职部门")),
        dash_to_none(row.get("职务")),
        source,
    )


def personnel_csv_row_to_tuple(row: dict, *, source: str = SOURCE_API) -> tuple | None:
    org_user_id = dash_to_none(row.get("机构用户ID"))
    person_name = dash_to_none(row.get("姓名"))
    cert_code = dash_to_none(row.get("证书编号"))
    if not org_user_id or not person_name:
        return None
    if not cert_code:
        account_id = dash_to_none(row.get("账号ID")) or ""
        cert_name = dash_to_none(row.get("从业资格类别")) or ""
        cert_code = f"{account_id}:{cert_name}".strip(":") or None
    if not cert_code:
        return None
    return (
        org_user_id,
        dash_to_none(row.get("账号ID")),
        person_name,
        dash_to_none(row.get("性别")),
        cert_code,
        dash_to_none(row.get("机构名称")),
        dash_to_none(row.get("所属机构名称")),
        dash_to_none(row.get("从业资格类别")),
        dash_to_none(row.get("学历")),
        parse_date(row.get("证书取得日期")),
        parse_date(row.get("证书到期日期")),
        parse_int(row.get("证书状态变更次数")),
        parse_int(row.get("诚信记录数")),
        parse_int(row.get("证书状态")),
        dash_to_none(row.get("证书状态名称")),
        parse_int(row.get("在职状态")),
        dash_to_none(row.get("是否注销")),
        dash_to_none(row.get("业务ID")),
        dash_to_none(row.get("异常标记")),
        source,
    )


def personnel_cert_history_csv_row_to_tuple(row: dict, *, source: str = SOURCE_API) -> tuple | None:
    org_user_id = dash_to_none(row.get("机构用户ID"))
    history_id = dash_to_none(row.get("历史记录ID"))
    if not org_user_id or not history_id:
        return None
    return (
        org_user_id,
        dash_to_none(row.get("账号ID")),
        dash_to_none(row.get("姓名")),
        history_id,
        dash_to_none(row.get("机构名称")),
        dash_to_none(row.get("证书编号")),
        dash_to_none(row.get("从业资格类别")),
        parse_date(row.get("证书取得日期")),
        parse_date(row.get("证书到期日期")),
        parse_int(row.get("证书状态")),
        dash_to_none(row.get("证书状态名称")),
        parse_date(row.get("创建时间")),
        dash_to_none(row.get("资格ID")),
        source,
    )


def dedupe_tuples(rows: list[tuple], key_fn) -> list[tuple]:
    seen: set = set()
    out: list[tuple] = []
    for row in rows:
        key = key_fn(row)
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def read_csv(name: str, csv_dir: Path = DEFAULT_CSV_DIR) -> list[dict[str, str]]:
    path = csv_dir / name
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def load_managers_from_csv(csv_dir: Path = DEFAULT_CSV_DIR) -> list[tuple]:
    rows = read_csv("managers.csv", csv_dir)
    tuples = [manager_csv_row_to_tuple(row, source="managers.csv") for row in rows]
    return dedupe_tuples([t for t in tuples if t], lambda r: r[3])


def load_person_org_stats_from_csv(csv_dir: Path = DEFAULT_CSV_DIR) -> list[tuple]:
    rows = read_csv("person_org_stats.csv", csv_dir)
    tuples = [person_org_csv_row_to_tuple(row, source="person_org_stats.csv") for row in rows]
    return dedupe_tuples([t for t in tuples if t], lambda r: r[0])


def load_manager_details_from_csv(csv_dir: Path = DEFAULT_CSV_DIR) -> list[tuple]:
    rows = read_csv("manager_details.csv", csv_dir)
    tuples = [manager_detail_csv_row_to_tuple(row, source="manager_details.csv") for row in rows]
    return dedupe_tuples([t for t in tuples if t], lambda r: r[0])


def load_manager_executives_from_csv(csv_dir: Path = DEFAULT_CSV_DIR) -> list[tuple]:
    rows = read_csv("manager_executives.csv", csv_dir)
    tuples = [executive_csv_row_to_tuple(row, source="manager_executives.csv") for row in rows]
    return dedupe_tuples([t for t in tuples if t], lambda r: (r[0], r[2], r[3]))


def load_manager_executive_resume_from_csv(csv_dir: Path = DEFAULT_CSV_DIR) -> list[tuple]:
    rows = read_csv("manager_executive_resume.csv", csv_dir)
    tuples = [
        executive_resume_csv_row_to_tuple(row, source="manager_executive_resume.csv") for row in rows
    ]
    return dedupe_tuples(
        [t for t in tuples if t],
        lambda r: (r[0], r[2], r[3], r[4], r[5], r[6], r[7]),
    )


def load_personnel_from_csv(csv_dir: Path = DEFAULT_CSV_DIR) -> list[tuple]:
    path = csv_dir / "personnel.csv"
    if not path.exists():
        return []
    rows = read_csv("personnel.csv", csv_dir)
    tuples = [personnel_csv_row_to_tuple(row, source="personnel.csv") for row in rows]
    return dedupe_tuples([t for t in tuples if t], lambda r: (r[0], r[4]))


def load_personnel_cert_history_from_csv(csv_dir: Path = DEFAULT_CSV_DIR) -> list[tuple]:
    path = csv_dir / "personnel_cert_history.csv"
    if not path.exists():
        return []
    rows = read_csv("personnel_cert_history.csv", csv_dir)
    tuples = [
        personnel_cert_history_csv_row_to_tuple(row, source="personnel_cert_history.csv") for row in rows
    ]
    return dedupe_tuples([t for t in tuples if t], lambda r: r[3])


SNAPSHOT_MANAGER_METRICS_SQL = """
INSERT INTO amac_manager_metrics_history (
    registration_no, manager_name, snapshot_date,
    full_time_staff_count, fund_practitioner_count, mgmt_scale_range, active_fund_count,
    staff_count, fund_manager_count, investment_manager_count,
    source, captured_at
)
SELECT
    d.registration_no,
    COALESCE(d.manager_name_cn, m.manager_name),
    CURRENT_DATE,
    d.full_time_staff_count,
    d.fund_practitioner_count,
    d.mgmt_scale_range,
    m.active_fund_count,
    p.staff_count,
    p.fund_manager_count,
    p.investment_manager_count,
    %s,
    NOW()
FROM amac_manager_details d
JOIN amac_managers m ON m.registration_no = d.registration_no
LEFT JOIN amac_person_org_stats p
    ON p.org_name = COALESCE(d.manager_name_cn, m.manager_name)
LEFT JOIN LATERAL (
    SELECT
        h.id,
        h.full_time_staff_count,
        h.fund_practitioner_count,
        h.mgmt_scale_range,
        h.active_fund_count,
        h.staff_count,
        h.fund_manager_count,
        h.investment_manager_count
    FROM amac_manager_metrics_history h
    WHERE h.registration_no = d.registration_no
    ORDER BY h.captured_at DESC
    LIMIT 1
) prev ON TRUE
WHERE prev.id IS NULL
   OR prev.full_time_staff_count IS DISTINCT FROM d.full_time_staff_count
   OR prev.fund_practitioner_count IS DISTINCT FROM d.fund_practitioner_count
   OR prev.mgmt_scale_range IS DISTINCT FROM d.mgmt_scale_range
   OR prev.active_fund_count IS DISTINCT FROM m.active_fund_count
   OR prev.staff_count IS DISTINCT FROM p.staff_count
   OR prev.fund_manager_count IS DISTINCT FROM p.fund_manager_count
   OR prev.investment_manager_count IS DISTINCT FROM p.investment_manager_count
"""


def append_manager_metrics_history(cur, *, source: str = SOURCE_API) -> int:
    """Append snapshot rows when tracked metrics change. Never updates existing history."""
    cur.execute(SNAPSHOT_MANAGER_METRICS_SQL, (source,))
    return cur.rowcount
