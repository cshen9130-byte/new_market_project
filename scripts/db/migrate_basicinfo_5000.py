#!/usr/bin/env python3
"""
migrate_basicinfo_5000.py
=========================
Loads basicinfo_5000.csv into basicinfo_bfl_track.

Safe to re-run: upserts on record_key (备案编码).

Usage:
    npx tsx scripts/db/apply_basicinfo_grants.ts   # once, as DB admin
    python scripts/db/migrate_basicinfo_5000.py
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CSV_PATH = ROOT / "basicinfo_5000.csv"
SOURCE_FILE = CSV_PATH.name

TEMP_OPEN_MAP = {
    "否": 0,
    "不可临开": 2,
    "可": 1,
    "可临开": 1,
    "可临开申购": 1,
    "可临开赎回": 3,
    "可临开申购和可临开赎回": 1,
}


def _load_env() -> None:
    for base in (Path.cwd(), ROOT):
        for fname in (".env.local", ".env"):
            f = base / fname
            if not f.is_file():
                continue
            with f.open(encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _text(val) -> str | None:
    if val is None:
        return None
    if isinstance(val, float) and val != val:
        return None
    s = str(val).strip()
    return s or None


def _parse_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = _text(val)
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _parse_fee_rate(val) -> Decimal | None:
    s = _text(val)
    if not s:
        return None
    s = s.replace(",", "").replace("%", "").replace("+", "")
    if not s or s in ("-", "-%"):
        return None
    try:
        num = Decimal(s)
    except InvalidOperation:
        return None
    if "%" in str(val) or num > 1:
        return num / Decimal("100")
    return num


def _parse_temp_open(val) -> int | None:
    s = _text(val)
    if not s:
        return None
    if s in TEMP_OPEN_MAP:
        return TEMP_OPEN_MAP[s]
    if "申购" in s and "赎回" in s:
        return 1
    if "赎回" in s:
        return 3
    if "申购" in s or s.startswith("可"):
        return 1
    if s in ("否", "不可"):
        return 0
    return None


def _row_hash(record_key: str) -> str:
    payload = f"{SOURCE_FILE}::{record_key}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _build_payload(row: dict) -> dict:
    funds_base = {
        "scale": row["scale"],
        "fee_pay": row["fee_pay"],
        "open_day": row["open_day"],
        "fee_trust": row["fee_trust"],
        "stop_line": row["stop_line"],
        "add_amount": row["add_amount"],
        "fee_manage": row["fee_manage"],
        "fee_redeem": row["fee_redeem"],
        "fee_purchase": row["fee_purchase"],
        "closed_period": row["closed_period"],
        "register_code": row["register_code"],
        "fee_manage_rate": float(row["fee_manage_rate"]) if row["fee_manage_rate"] is not None else None,
        "precautious_line": row["precautious_line"],
        "fee_admin_service": row["fee_admin_service"],
        "is_temporary_open": row["is_temporary_open"],
    }
    return {
        "tag": {"company": []},
        "advisor": row["advisor"] or "",
        "advisor2": row["advisor2"] or "",
        "managers": [],
        "strategy": {
            "company": {"strategy_one": "", "strategy_two": "", "strategy_three": ""},
            "platform": {"strategy_one": "", "strategy_two": "", "strategy_three": ""},
        },
        "FundsBase": funds_base,
        "fund_name": row["fund_name"],
        "fund_type": 2,
        "puton_date": row["puton_date"].isoformat() if row["puton_date"] else None,
        "mandator_name": row["mandator_name"],
        "inception_date": row["inception_date"].isoformat() if row["inception_date"] else None,
        "fund_short_name": row["fund_short_name"],
        "register_number": row["register_number"],
    }


def main() -> None:
    _load_env()

    try:
        import pandas as pd
        import psycopg2
        from psycopg2.extras import execute_values, Json
    except ImportError as exc:
        print(f"Missing dependency: {exc}. Run: pip install pandas psycopg2-binary")
        sys.exit(1)

    if not CSV_PATH.is_file():
        print(f"csv not found: {CSV_PATH}")
        sys.exit(1)

    try:
        df = pd.read_csv(CSV_PATH, encoding="utf-8")
    except Exception:
        df = pd.read_csv(CSV_PATH, encoding="gbk")

    expected = [
        "来源", "产品名称", "备案编码", "产品全称", "备案编号", "基金管理人", "投资顾问",
        "成立日期", "备案日期", "托管券商", "基金经理", "开放日", "是否可临开", "申购费",
        "追加限制", "赎回费", "预警线", "封闭期", "平仓线", "管理费率", "管理费说明",
        "托管费", "行政外包服务费", "业绩报酬说明", "管理规模", "登记编号",
    ]
    missing = [col for col in expected if col not in df.columns]
    if missing:
        print(f"Unexpected csv columns. Missing: {missing}")
        print(f"Found: {list(df.columns)}")
        sys.exit(1)

    rows: list[tuple] = []
    skipped = 0
    for _, raw in df.iterrows():
        record_key = _text(raw["备案编码"]) or _text(raw["备案编号"])
        if not record_key:
            skipped += 1
            continue

        register_number = _text(raw["备案编码"]) or record_key
        fee_manage_rate = _parse_fee_rate(raw["管理费率"])
        is_temporary_open = _parse_temp_open(raw["是否可临开"])
        parsed = {
            "source": _text(raw["来源"]) or SOURCE_FILE,
            "fund_short_name": _text(raw["产品名称"]),
            "fund_name": _text(raw["产品全称"]) or _text(raw["产品名称"]),
            "register_number": register_number,
            "advisor": _text(raw["基金管理人"]),
            "advisor2": _text(raw["投资顾问"]),
            "inception_date": _parse_date(raw["成立日期"]),
            "puton_date": _parse_date(raw["备案日期"]),
            "mandator_name": _text(raw["托管券商"]),
            "manager_names": _text(raw["基金经理"]),
            "open_day": _text(raw["开放日"]),
            "is_temporary_open": is_temporary_open,
            "fee_purchase": _text(raw["申购费"]),
            "add_amount": _text(raw["追加限制"]),
            "fee_redeem": _text(raw["赎回费"]),
            "precautious_line": _text(raw["预警线"]),
            "closed_period": _text(raw["封闭期"]),
            "stop_line": _text(raw["平仓线"]),
            "fee_manage_rate": fee_manage_rate,
            "fee_manage": _text(raw["管理费说明"]),
            "fee_trust": _text(raw["托管费"]),
            "fee_admin_service": _text(raw["行政外包服务费"]),
            "fee_pay": _text(raw["业绩报酬说明"]),
            "scale": _text(raw["管理规模"]),
            "register_code": _text(raw["登记编号"]),
        }
        payload = _build_payload(parsed)
        rows.append((
            record_key,
            Json(payload),
            _row_hash(record_key),
            parsed["source"],
            parsed["fund_short_name"],
            parsed["fund_name"],
            parsed["register_number"],
            2,
            parsed["advisor"],
            parsed["advisor2"],
            parsed["inception_date"],
            parsed["puton_date"],
            parsed["mandator_name"],
            parsed["manager_names"],
            parsed["open_day"],
            parsed["is_temporary_open"],
            parsed["fee_purchase"],
            parsed["add_amount"],
            parsed["fee_redeem"],
            parsed["precautious_line"],
            parsed["closed_period"],
            parsed["stop_line"],
            parsed["fee_manage_rate"],
            parsed["fee_trust"],
            parsed["fee_manage"],
            parsed["fee_admin_service"],
            parsed["fee_pay"],
            parsed["scale"],
            parsed["register_code"],
        ))

    url = os.environ.get("DATABASE_URL")
    if url:
        conn = psycopg2.connect(url)
    else:
        conn = psycopg2.connect(
            host=os.environ.get("DB_HOST", "localhost"),
            port=int(os.environ.get("DB_PORT", "5432")),
            dbname=os.environ.get("DB_NAME", "market_data"),
            user=os.environ.get("DB_USER", "market_user"),
            password=os.environ.get("DB_PASSWORD", ""),
        )

    upsert_sql = """
    INSERT INTO basicinfo_bfl_track (
        record_key, payload, row_hash, source,
        fund_short_name, fund_name, register_number, fund_type,
        advisor, advisor2, inception_date, puton_date, mandator_name,
        manager_names, open_day, is_temporary_open,
        fee_purchase, add_amount, fee_redeem,
        precautious_line, closed_period, stop_line,
        fee_manage_rate, fee_trust, fee_manage, fee_admin_service, fee_pay,
        scale, register_code,
        imported_at, updated_at
    ) VALUES %s
    ON CONFLICT (record_key) DO UPDATE SET
        payload = EXCLUDED.payload,
        row_hash = EXCLUDED.row_hash,
        source = EXCLUDED.source,
        fund_short_name = EXCLUDED.fund_short_name,
        fund_name = EXCLUDED.fund_name,
        register_number = EXCLUDED.register_number,
        fund_type = EXCLUDED.fund_type,
        advisor = EXCLUDED.advisor,
        advisor2 = EXCLUDED.advisor2,
        inception_date = EXCLUDED.inception_date,
        puton_date = EXCLUDED.puton_date,
        mandator_name = EXCLUDED.mandator_name,
        manager_names = EXCLUDED.manager_names,
        open_day = EXCLUDED.open_day,
        is_temporary_open = EXCLUDED.is_temporary_open,
        fee_purchase = EXCLUDED.fee_purchase,
        add_amount = EXCLUDED.add_amount,
        fee_redeem = EXCLUDED.fee_redeem,
        precautious_line = EXCLUDED.precautious_line,
        closed_period = EXCLUDED.closed_period,
        stop_line = EXCLUDED.stop_line,
        fee_manage_rate = EXCLUDED.fee_manage_rate,
        fee_trust = EXCLUDED.fee_trust,
        fee_manage = EXCLUDED.fee_manage,
        fee_admin_service = EXCLUDED.fee_admin_service,
        fee_pay = EXCLUDED.fee_pay,
        scale = EXCLUDED.scale,
        register_code = EXCLUDED.register_code,
        updated_at = NOW()
    """

    template = (
        "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
        "%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())"
    )

    print(f"Reading {CSV_PATH.name} …")
    print(f"  Parsed {len(rows)} rows ({skipped} skipped without 备案编码/备案编号)")

    try:
        with conn:
            with conn.cursor() as cur:
                execute_values(cur, upsert_sql, rows, template=template, page_size=500)
                cur.execute("SELECT COUNT(*) FROM basicinfo_bfl_track")
                total = cur.fetchone()[0]
                cur.execute("ANALYZE basicinfo_bfl_track")
    except Exception as exc:
        conn.close()
        if "permission denied for table basicinfo_bfl_track" in str(exc):
            print(
                "Write permission missing on basicinfo_bfl_track for market_user.\n"
                "Run once as DB admin:\n"
                "  npx tsx scripts/db/apply_basicinfo_grants.ts\n"
                "Or on the server:\n"
                "  sudo -u postgres psql -d market_data -f scripts/db/011_grant_basicinfo_bfl_track_write.sql"
            )
        raise

    conn.close()
    print(f"Upserted {len(rows)} rows from csv ({total} rows in basicinfo_bfl_track).")
    print("Migration complete.")


if __name__ == "__main__":
    main()
