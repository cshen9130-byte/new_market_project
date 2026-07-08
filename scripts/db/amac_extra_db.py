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
    source_file                           TEXT NOT NULL DEFAULT 'person_org_stats.csv',
    updated_at                            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_person_org_stats_org_name_uq UNIQUE (org_name)
);

CREATE INDEX IF NOT EXISTS idx_amac_person_org_stats_org_type
    ON amac_person_org_stats (org_type);

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

CREATE TABLE IF NOT EXISTS amac_extra_sync_state (
    id                          TEXT PRIMARY KEY DEFAULT 'default',
    last_managers_upserted      INTEGER NOT NULL DEFAULT 0,
    last_person_org_upserted    INTEGER NOT NULL DEFAULT 0,
    last_details_fetched        INTEGER NOT NULL DEFAULT 0,
    last_executives_upserted    INTEGER NOT NULL DEFAULT 0,
    last_resumes_upserted       INTEGER NOT NULL DEFAULT 0,
    last_full_details_sync_at   TIMESTAMPTZ,
    last_incremental_sync_at  TIMESTAMPTZ,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

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
    active_fund_count = EXCLUDED.active_fund_count,
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
    org_name, org_type, staff_count, fund_qualification_count,
    fund_sales_qualification_count, investment_manager_count, fund_manager_count,
    external_staff_count, external_fund_qualification_count,
    external_fund_sales_qualification_count, external_investment_manager_count,
    external_fund_manager_count, source_file
) VALUES %s
ON CONFLICT (org_name) DO UPDATE SET
    org_type                              = EXCLUDED.org_type,
    staff_count                           = EXCLUDED.staff_count,
    fund_qualification_count              = EXCLUDED.fund_qualification_count,
    fund_sales_qualification_count        = EXCLUDED.fund_sales_qualification_count,
    investment_manager_count              = EXCLUDED.investment_manager_count,
    fund_manager_count                    = EXCLUDED.fund_manager_count,
    external_staff_count                  = EXCLUDED.external_staff_count,
    external_fund_qualification_count     = EXCLUDED.external_fund_qualification_count,
    external_fund_sales_qualification_count = EXCLUDED.external_fund_sales_qualification_count,
    external_investment_manager_count     = EXCLUDED.external_investment_manager_count,
    external_fund_manager_count           = EXCLUDED.external_fund_manager_count,
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
    full_time_staff_count                 = EXCLUDED.full_time_staff_count,
    fund_practitioner_count               = EXCLUDED.fund_practitioner_count,
    mgmt_scale_range                      = EXCLUDED.mgmt_scale_range,
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
