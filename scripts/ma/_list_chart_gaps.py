"""Funds whose chart stops before stored 火富牛 points. Read-only."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from fof99_weekly_nav_fetch import connect, load_env  # noqa: E402

SQL = """
WITH manual AS (
  SELECT UPPER(BTRIM(beian_hao)) AS code, MAX(nav_date) AS tip, COUNT(*) AS n
  FROM ops_team_nav_manual
  WHERE nav_type = 'pre_fee'
  GROUP BY 1
),
email AS (
  SELECT UPPER(BTRIM(product_code)) AS code, MAX(nav_date) AS tip
  FROM ops_email_nav_records
  WHERE nav IS NOT NULL AND nav > 0 AND product_code IS NOT NULL
  GROUP BY 1
),
shown AS (
  SELECT m.code, m.tip AS manual_tip, m.n AS manual_n, e.tip AS email_tip,
         CASE WHEN e.tip IS NOT NULL AND e.tip > m.tip THEN e.tip ELSE m.tip END AS shown_tip
  FROM manual m
  LEFT JOIN email e ON e.code = m.code
)
SELECT s.code,
       COALESCE(i.product_name, s.code),
       s.manual_tip::text,
       COALESCE(s.email_tip::text, ''),
       s.shown_tip::text,
       MIN(f.price_date) FILTER (WHERE f.price_date > s.shown_tip)::text,
       MAX(f.price_date)::text,
       COUNT(*) FILTER (WHERE f.price_date > s.shown_tip)
FROM shown s
JOIN private_fund_nav f ON UPPER(BTRIM(f.beian_hao)) = s.code
LEFT JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = s.code
GROUP BY s.code, i.product_name, s.manual_tip, s.email_tip, s.shown_tip
HAVING COUNT(*) FILTER (WHERE f.price_date > s.shown_tip) >= 2
   AND (MAX(f.price_date) - (
     CASE WHEN s.email_tip IS NOT NULL AND s.email_tip > s.manual_tip THEN s.email_tip ELSE s.manual_tip END
   )) >= 7
ORDER BY COUNT(*) FILTER (WHERE f.price_date > s.shown_tip) DESC, s.code
"""


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    load_env()
    conn = connect()
    cur = conn.cursor()
    cur.execute(SQL)
    rows = cur.fetchall()
    print(f"count={len(rows)}")
    for row in rows:
        print("\t".join(str(c) for c in row))
    conn.close()


if __name__ == "__main__":
    main()
