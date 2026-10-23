"""Compare chart tip and later 火富牛 points for the two funds not filled."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))
from fof99_weekly_nav_fetch import connect, load_env  # noqa: E402

SQL = """
SELECT 'team' AS src, nav_date::text, unit_nav::text
FROM ops_team_nav_manual
WHERE UPPER(BTRIM(beian_hao)) = %s AND nav_type = 'pre_fee'
  AND nav_date >= DATE '2026-08-01'
UNION ALL
SELECT 'fof', price_date::text, nav::text
FROM private_fund_nav
WHERE UPPER(BTRIM(beian_hao)) = %s
  AND price_date >= DATE '2026-08-01'
ORDER BY 2, 1
"""


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    load_env()
    conn = connect()
    cur = conn.cursor()
    for code in ("ZG868A", "SAYP39", "SXF368"):
        print("==", code)
        cur.execute(SQL, (code, code))
        for row in cur.fetchall():
            print(" ", row)
        if code == "ZG868A":
            cur.execute(
                """
                SELECT price_date::text, nav::text,
                       cum_nav_withdrawal::text, cumulative_nav::text
                FROM private_fund_nav
                WHERE UPPER(BTRIM(beian_hao)) = 'ZG868A'
                  AND price_date >= DATE '2026-08-12'
                ORDER BY 1
                """
            )
            print(" detail")
            for row in cur.fetchall():
                print(" ", row)
    conn.close()


if __name__ == "__main__":
    main()
