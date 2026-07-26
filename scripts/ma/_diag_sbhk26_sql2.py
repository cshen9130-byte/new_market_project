#!/usr/bin/env python3
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
    url = env.get("DATABASE_URL") or os.environ.get("DATABASE_URL")
    conn = psycopg2.connect(url)
    cur = conn.cursor()

    print("--- SBHK26 product_code rows last 20 ---")
    cur.execute(
        """
        SELECT nav_date::text, nav::text, cumulative_nav::text, product_code,
               fund_name, source, left(subject, 100)
        FROM ops_email_nav_records
        WHERE product_code = 'SBHK26'
        ORDER BY nav_date DESC, id DESC
        LIMIT 20
        """
    )
    for r in cur.fetchall():
        print(r)

    print("--- fund_name parent-like (no A类) last 20 ---")
    cur.execute(
        """
        SELECT nav_date::text, nav::text, cumulative_nav::text, product_code,
               fund_name, source, left(subject, 100)
        FROM ops_email_nav_records
        WHERE fund_name ILIKE %s
          AND fund_name NOT ILIKE %s
        ORDER BY nav_date DESC, id DESC
        LIMIT 20
        """,
        ("%六妙星豪鑫6号%", "%A类%"),
    )
    for r in cur.fetchall():
        print(r)

    print("--- valuation metrics schema ---")
    cur.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'ops_email_valuation_fund_metrics_latest'
        ORDER BY ordinal_position
        """
    )
    cols = [r[0] for r in cur.fetchall()]
    print(cols)
    if cols:
        name_col = "fund_name" if "fund_name" in cols else cols[0]
        code_col = "product_code" if "product_code" in cols else None
        sql = f"SELECT * FROM ops_email_valuation_fund_metrics_latest WHERE {name_col} ILIKE %s"
        args: list = ["%豪鑫6号%"]
        if code_col:
            sql += f" OR {code_col} IN ('SBHK26','BHK26A')"
        sql += " LIMIT 10"
        cur.execute(sql, args)
        c = [d[0] for d in cur.description]
        for r in cur.fetchall():
            print(dict(zip(c, r)))

    print("--- cache as_of ---")
    cur.execute(
        """
        SELECT MAX(nav_date)::text AS max_nav_date, COUNT(*) AS n
        FROM ops_tracking_funds_list_cache
        """
    )
    print(cur.fetchone())

    conn.close()


if __name__ == "__main__":
    main()
