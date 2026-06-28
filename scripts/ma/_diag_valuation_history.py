#!/usr/bin/env python3
"""Diagnose valuation email history gaps."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
for fname in (".env.local", ".env"):
    f = ROOT / fname
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


def main() -> None:
    conn = psycopg2.connect(os.environ.get("DATABASE_URL") or "")
    cur = conn.cursor()

    def run(label: str, sql: str, params=None):
        cur.execute(sql, params or ())
        print(f"{label}: {cur.fetchone()}")

    run(
        "hengying name",
        """
        SELECT COUNT(*), MIN(valuation_date), MAX(valuation_date)
        FROM ops_email_valuation_records
        WHERE fund_name ILIKE '%%恒盈2号%%'
        """,
    )
    run(
        "before 2026",
        """
        SELECT COUNT(*), MIN(valuation_date), MAX(valuation_date)
        FROM ops_email_valuation_records
        WHERE valuation_date < DATE '2026-01-01'
        """,
    )
    run(
        "2025-06 window",
        """
        SELECT COUNT(*), MIN(valuation_date), MAX(valuation_date)
        FROM ops_email_valuation_records
        WHERE valuation_date BETWEEN DATE '2025-06-01' AND DATE '2025-07-31'
        """,
    )

    cur.execute(
        """
        SELECT product_code, fund_name, COUNT(*), MIN(valuation_date), MAX(valuation_date)
        FROM ops_email_valuation_records
        WHERE fund_name ILIKE '%%恒盈%%'
        GROUP BY 1, 2
        ORDER BY 3 DESC
        LIMIT 20
        """
    )
    print("hengying groups:", cur.fetchall())

    cur.execute(
        """
        SELECT product_code, fund_name, COUNT(*), MIN(valuation_date)
        FROM ops_email_valuation_records
        WHERE valuation_date BETWEEN DATE '2025-06-01' AND DATE '2025-07-31'
        GROUP BY 1, 2
        ORDER BY 3 DESC
        LIMIT 15
        """
    )
    print("2025-06 funds:", cur.fetchall())

    cur.execute(
        """
        SELECT beian_hao, product_name, inception_date
        FROM managed_products
        WHERE product_name ILIKE '%恒盈2号%'
        LIMIT 5
        """
    )
    print("managed_products:", cur.fetchall())

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
