#!/usr/bin/env python3
"""Diagnose allocation trend data for a fund."""
from __future__ import annotations

import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent.parent
for base in (ROOT, Path.cwd()):
    for fname in (".env.local", ".env"):
        f = base / fname
        if f.is_file():
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v

import psycopg2  # type: ignore


def get_conn():
    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", "market_data"),
        user=os.environ.get("DB_USER", "market_user"),
        password=os.environ.get("DB_PASSWORD", ""),
    )


def main() -> None:
    beian = sys.argv[1] if len(sys.argv) > 1 else "SBAH39"
    from_date = sys.argv[2] if len(sys.argv) > 2 else "2023-06-26"
    to_date = sys.argv[3] if len(sys.argv) > 3 else "2024-06-26"

    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        "SELECT beian_hao, product_name FROM private_fund_info WHERE beian_hao = %s LIMIT 1",
        (beian,),
    )
    print("FUND:", cur.fetchone())

    cur.execute(
        """
        SELECT COUNT(*), MIN(valuation_date), MAX(valuation_date)
        FROM ops_email_valuation_records
        WHERE product_code = %s
           OR fund_name ILIKE %s
        """,
        (beian, f"%{beian}%"),
    )
    print("RECORDS_BY_CODE:", cur.fetchone())

    cur.execute(
        """
        SELECT COUNT(*), MIN(valuation_date), MAX(valuation_date)
        FROM ops_email_valuation_records
        WHERE fund_name ILIKE '%荣熙恒盈2号%'
        """,
    )
    print("RECORDS_BY_NAME:", cur.fetchone())

    cur.execute(
        """
        SELECT COUNT(DISTINCT r.id),
               COUNT(DISTINCT CASE WHEN jsonb_array_length(r.holdings) > 0 THEN r.id END),
               COUNT(DISTINCT h.valuation_record_id)
        FROM ops_email_valuation_records r
        LEFT JOIN ops_email_valuation_holdings h ON h.valuation_record_id = r.id
        WHERE (r.product_code = %s OR r.fund_name ILIKE '%%荣熙恒盈2号%%')
          AND r.valuation_date >= %s::date
          AND r.valuation_date <= %s::date
        """,
        (beian, from_date, to_date),
    )
    print("IN_RANGE (records, json_holdings, norm_holdings):", cur.fetchone())

    cur.execute(
        """
        SELECT product_code, fund_name, COUNT(*) AS n
        FROM ops_email_valuation_records
        WHERE fund_name ILIKE '%%荣熙恒盈2号%%' OR product_code = %s
        GROUP BY 1, 2
        ORDER BY n DESC
        LIMIT 10
        """,
        (beian,),
    )
    print("GROUPS:", cur.fetchall())

    cur.execute(
        """
        SELECT COUNT(DISTINCT valuation_date)
        FROM ops_email_valuation_records r
        WHERE (r.product_code = %s OR r.fund_name ILIKE '%%荣熙恒盈2号%%')
          AND r.valuation_date >= %s::date
          AND r.valuation_date <= %s::date
          AND EXISTS (
            SELECT 1 FROM ops_email_valuation_holdings h
            WHERE h.valuation_record_id = r.id
          )
        """,
        (beian, from_date, to_date),
    )
    print("TREND_ELIGIBLE_DATES:", cur.fetchone())

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
