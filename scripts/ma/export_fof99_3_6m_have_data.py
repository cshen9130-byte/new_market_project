#!/usr/bin/env python3
"""Export 3-6m funds that 火富牛 already has (advancedlist dated + price-API ok). No paid calls."""
from __future__ import annotations

import csv
import os
import sys
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
import psycopg2

ROOT = Path(__file__).resolve().parents[2]
LIST_CSV = ROOT / "scripts" / "ma" / "fof99_advancedlist_latest_nav.csv"
OUT = ROOT / "scripts" / "ma" / "fof99_3_6m_have_data.csv"


def load_env() -> None:
    for p in (ROOT / ".env.local", ROOT / ".env"):
        if p.exists():
            load_dotenv(p, override=False)


def iso(raw: object) -> str:
    s = str(raw or "").strip()[:10]
    return s if len(s) == 10 and s[0].isdigit() else ""


def minus_months(d0: date, n: int) -> date:
    import calendar

    y, m = d0.year, d0.month - n
    while m <= 0:
        y -= 1
        m += 12
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(d0.day, last))


def bucket(d: str, today: date) -> str:
    if not d:
        return ""
    dt = date.fromisoformat(d)
    if dt >= minus_months(today, 1):
        return "1个月内"
    if dt >= minus_months(today, 3):
        return "1-3个月"
    if dt >= minus_months(today, 6):
        return "3-6个月"
    return "6个月以上"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    load_env()
    today = date.today()

    list_rows = list(csv.DictReader(LIST_CSV.open(encoding="utf-8-sig", newline="")))
    fof99_list: dict[str, dict] = {}
    for r in list_rows:
        code = (r.get("register_number") or "").strip().upper()
        if not code:
            continue
        fof99_list[code] = r
    dated_list = {c for c, r in fof99_list.items() if iso(r.get("price_date"))}

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    cur = conn.cursor()
    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), COALESCE(product_name, ''),
               latest_nav_date, latest_nav
        FROM private_fund_info
        WHERE latest_nav_date >= CURRENT_DATE - INTERVAL '6 months'
          AND latest_nav_date < CURRENT_DATE - INTERVAL '3 months'
          AND beian_hao IS NOT NULL AND BTRIM(beian_hao) <> ''
        """
    )
    info_36: dict[str, tuple] = {r[0]: r for r in cur.fetchall()}

    cur.execute(
        """
        SELECT UPPER(BTRIM(l.reg_code)), l.price_date, l.nav,
               COALESCE(i.product_name, ''), i.latest_nav_date, i.latest_nav
        FROM fof99_nav_fetch_log l
        JOIN fof99_nav_fetch_log p
          ON p.reg_code = l.reg_code
         AND p.price_date = DATE '1970-01-01'
         AND p.status = 'ok'
         AND p.batch_id LIKE '3-6m-blank-%%'
        LEFT JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = UPPER(BTRIM(l.reg_code))
        WHERE l.status = 'ok'
          AND l.price_date > DATE '1970-01-01'
          AND l.batch_id LIKE '3-6m-blank-%%'
        """
    )
    price_ok = {r[0]: r for r in cur.fetchall()}

    codes_list = sorted(c for c in info_36 if c in dated_list)
    codes_price = sorted(c for c in price_ok if c not in dated_list)
    codes = codes_list + [c for c in codes_price if c not in codes_list]
    print(f"on_list_with_date={len(codes_list)}  missing_list_price_ok={len(codes_price)}  total={len(codes)}")

    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), MAX(price_date) AS d
        FROM private_fund_nav
        WHERE UPPER(BTRIM(beian_hao)) = ANY(%s)
        GROUP BY 1
        """,
        (codes,),
    )
    nav_max = {r[0]: r[1] for r in cur.fetchall()}

    cur.execute(
        """
        SELECT UPPER(BTRIM(n.beian_hao)), n.price_date, n.nav
        FROM private_fund_nav n
        JOIN (
          SELECT UPPER(BTRIM(beian_hao)) AS c, MAX(price_date) AS d
          FROM private_fund_nav
          WHERE UPPER(BTRIM(beian_hao)) = ANY(%s)
          GROUP BY 1
        ) m ON UPPER(BTRIM(n.beian_hao)) = m.c AND n.price_date = m.d
        """,
        (codes,),
    )
    nav_at_max = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code)), policy
        FROM fof99_nav_universe
        WHERE UPPER(BTRIM(reg_code)) = ANY(%s)
        """,
        (codes,),
    )
    policy = {r[0]: r[1] for r in cur.fetchall()}

    fields = [
        "beian_hao",
        "product_name",
        "list_nav_date",
        "list_nav",
        "nav_table_max_date",
        "nav_table_nav_at_max",
        "have_latest_date",
        "date_bucket",
        "empty_date_probe",
        "fof99_policy",
        "fof99_source",
        "fof99_latest_date",
        "fof99_latest_nav",
    ]
    out_rows = []
    for code in codes:
        if code in dated_list:
            src = "advancedlist"
            fr = fof99_list[code]
            fof_date = iso(fr.get("price_date"))
            fof_nav = fr.get("price_nav") or ""
            probe = ""
            name = (info_36[code][1] if code in info_36 else fr.get("fund_name") or "") or ""
            list_date = info_36[code][2] if code in info_36 else None
            list_nav = info_36[code][3] if code in info_36 else None
        else:
            src = "price_api"
            pr = price_ok[code]
            fof_date = iso(pr[1])
            fof_nav = pr[2]
            probe = "ok"
            name = pr[3] or ""
            list_date = pr[4]
            list_nav = pr[5]

        nd, nn = nav_at_max.get(code, (nav_max.get(code), None))
        have_dates = [iso(list_date), iso(nd)]
        have = max((d for d in have_dates if d), default="")
        out_rows.append(
            {
                "beian_hao": code,
                "product_name": name,
                "list_nav_date": iso(list_date),
                "list_nav": "" if list_nav is None else list_nav,
                "nav_table_max_date": iso(nd),
                "nav_table_nav_at_max": "" if nn is None else nn,
                "have_latest_date": have,
                "date_bucket": bucket(have, today),
                "empty_date_probe": probe,
                "fof99_policy": policy.get(code, ""),
                "fof99_source": src,
                "fof99_latest_date": fof_date,
                "fof99_latest_nav": "" if fof_nav is None else fof_nav,
            }
        )

    out_rows.sort(key=lambda r: (r["have_latest_date"] or "", r["beian_hao"]), reverse=True)
    with OUT.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(out_rows)
    from collections import Counter

    print("wrote", OUT, "rows", len(out_rows))
    print("source", dict(Counter(r["fof99_source"] for r in out_rows)))
    print("bucket", dict(Counter(r["date_bucket"] for r in out_rows)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
