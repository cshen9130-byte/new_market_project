#!/usr/bin/env python3
"""
backfill_ashare_sector_fund_flow_proxy.py
=======================================
Build historical sector fund-flow proxy from derived_ashare_board_amount_daily:

  net_flow_yi ≈ (amount_yuan / 1e8) * (change_pct / 100)

i.e. turnover × return, in 亿元. This is NOT East-Money "主力净流入", but a
stable proxy for capital momentum when hist fund-flow APIs are blocked.

Does not overwrite rows that already have source like '%fund_flow%_spot'
(live snapshots).

Usage
-----
  python backfill_ashare_sector_fund_flow_proxy.py --days 365
  python backfill_ashare_sector_fund_flow_proxy.py --type industry --days 250
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def _load_env() -> None:
    for base in (Path.cwd(), Path(__file__).resolve().parent, Path(__file__).resolve().parent.parent.parent):
        for fname in (".env.local", ".env"):
            f = base / fname
            if not f.is_file():
                continue
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _db_conn():
    import psycopg2

    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", "market_data"),
        user=os.environ.get("DB_USER", "market_user"),
        password=os.environ.get("DB_PASSWORD", ""),
    )


def _ensure_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS derived_ashare_sector_fund_flow_daily (
                trade_date   DATE         NOT NULL,
                board_type   VARCHAR(20)  NOT NULL,
                board_name   VARCHAR(100) NOT NULL,
                inflow       NUMERIC(20,4),
                outflow      NUMERIC(20,4),
                net_flow     NUMERIC(20,4),
                change_pct   NUMERIC(10,4),
                source       VARCHAR(60),
                fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, board_type, board_name)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS derived_ashare_sector_fund_flow_daily_lookup_idx
              ON derived_ashare_sector_fund_flow_daily (board_type, board_name, trade_date DESC)
        """)
    conn.commit()


def backfill(board_type: str | None, days: int) -> dict:
    from psycopg2.extras import execute_values

    conn = _db_conn()
    try:
        _ensure_table(conn)
        params: list = [days]
        type_clause = ""
        if board_type in {"industry", "concept"}:
            type_clause = "AND board_type = %s"
            params.append(board_type)

        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT trade_date::text, board_type, board_name, amount, change_pct
                FROM derived_ashare_board_amount_daily
                WHERE amount IS NOT NULL
                  AND change_pct IS NOT NULL
                  AND trade_date >= CURRENT_DATE - (%s || ' days')::interval
                  {type_clause}
                ORDER BY trade_date, board_type, board_name
                """,
                params,
            )
            rows = cur.fetchall()

        records = []
        for d, btype, name, amount, chg in rows:
            try:
                amt = float(amount)
                c = float(chg)
            except Exception:
                continue
            # 亿元 × 收益率
            net = (amt / 1e8) * (c / 100.0)
            records.append((
                d[:10],
                btype,
                str(name)[:100],
                None,
                None,
                round(net, 4),
                round(c, 4),
                "amount_return_proxy",
            ))

        if not records:
            return {"ok": True, "rows": 0, "note": "no board amount history to proxy"}

        with conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO derived_ashare_sector_fund_flow_daily (
                    trade_date, board_type, board_name, inflow, outflow,
                    net_flow, change_pct, source, fetched_at
                ) VALUES %s
                ON CONFLICT (trade_date, board_type, board_name) DO UPDATE
                    SET net_flow = EXCLUDED.net_flow,
                        change_pct = EXCLUDED.change_pct,
                        source = EXCLUDED.source,
                        fetched_at = NOW()
                  WHERE derived_ashare_sector_fund_flow_daily.source IS NULL
                     OR derived_ashare_sector_fund_flow_daily.source = 'amount_return_proxy'
                     OR derived_ashare_sector_fund_flow_daily.source NOT LIKE '%%fund_flow%%spot%%'
                """,
                records,
                template="(%s, %s, %s, %s, %s, %s, %s, %s, NOW())",
                page_size=1000,
            )
        conn.commit()
        return {"ok": True, "rows": len(records), "unit": "yi", "source": "amount_return_proxy"}
    finally:
        conn.close()


def main() -> int:
    _load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--type", choices=["industry", "concept", "both"], default="both")
    args = parser.parse_args()
    days = max(30, min(800, args.days))
    try:
        if args.type == "both":
            a = backfill("industry", days)
            b = backfill("concept", days)
            payload = {"ok": True, "results": [a, b], "rows": int(a.get("rows") or 0) + int(b.get("rows") or 0)}
        else:
            payload = backfill(args.type, days)
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 1
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
