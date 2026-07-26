#!/usr/bin/env python3
"""Dump SBHK26 list vs detail NAV source rows."""
from __future__ import annotations

import os
from pathlib import Path

import psycopg2


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for path in (Path(".env"), Path(".env.local")):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def main() -> None:
    env = load_env()
    url = env.get("DATABASE_URL") or env.get("POSTGRES_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL missing")
    print("db:", url.split("@")[-1])
    conn = psycopg2.connect(url)
    cur = conn.cursor()

    def q(sql: str, args=None):
        cur.execute(sql, args)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    print("=== CACHE ===")
    for r in q(
        """
        SELECT beian_hao, product_name, nav_date::text, unit_nav::text,
               return_pct::text, ret_1w::text
        FROM ops_tracking_funds_list_cache
        WHERE beian_hao IN ('SBHK26','BHK26A') OR product_name ILIKE %s
        """,
        ("%豪鑫6号%",),
    ):
        print(r)

    print("=== EMAIL >= 2026-06-20 ===")
    for r in q(
        """
        SELECT nav_date::text, nav::text, cumulative_nav::text, product_code,
               fund_name, source, left(subject, 80) AS subject
        FROM ops_email_nav_records
        WHERE (product_code IN ('SBHK26','BHK26A') OR fund_name ILIKE %s)
          AND nav_date >= '2026-06-20'
        ORDER BY nav_date DESC, id DESC
        LIMIT 40
        """,
        ("%豪鑫6号%",),
    ):
        print(r)

    print("=== TYPE6 ===")
    for r in q(
        """
        SELECT beian_hao, product_name, price_date::text, nav::text
        FROM private_fund_nav_group_type6
        WHERE beian_hao IN ('SBHK26','BHK26A') OR product_name ILIKE %s
        ORDER BY price_date DESC
        LIMIT 20
        """,
        ("%豪鑫6号%",),
    ):
        print(r)

    print("=== LEGACY group ===")
    for r in q(
        """
        SELECT beian_hao, product_name, price_date::text, nav::text
        FROM private_fund_nav_group
        WHERE beian_hao IN ('SBHK26','BHK26A') OR product_name ILIKE %s
        ORDER BY price_date DESC
        LIMIT 15
        """,
        ("%豪鑫6号%",),
    ):
        print(r)

    print("=== private_fund_nav ===")
    for r in q(
        """
        SELECT beian_hao, product_name, price_date::text, nav::text
        FROM private_fund_nav
        WHERE beian_hao IN ('SBHK26','BHK26A') OR product_name ILIKE %s
        ORDER BY price_date DESC
        LIMIT 15
        """,
        ("%豪鑫6号%",),
    ):
        print(r)

    print("=== valuation metrics latest ===")
    try:
        for r in q(
            """
            SELECT beian_hao, fund_name, valuation_date::text, unit_nav::text
            FROM ops_email_valuation_fund_metrics_latest
            WHERE beian_hao IN ('SBHK26','BHK26A') OR fund_name ILIKE %s
            LIMIT 20
            """,
            ("%豪鑫6号%",),
        ):
            print(r)
    except Exception as e:
        print("skip metrics:", e)
        conn.rollback()

    conn.close()


if __name__ == "__main__":
    main()
