#!/usr/bin/env python3
"""
Backfill CFFEX index futures month-contract daily prices into
raw_futures_contracts_daily via AkShare / Sina.

Fetches currently listed (+ nearby) IH/IF/IC/IM month contracts so the
product-window annualized basis charts have complete histories.

Usage
-----
  py -3 scripts/ma/backfill_cffex_index_month_contracts.py
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import akshare as ak
except ImportError:
    print("akshare not installed", file=sys.stderr)
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    print("pandas not installed", file=sys.stderr)
    sys.exit(1)

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("psycopg2 not installed", file=sys.stderr)
    sys.exit(1)


BASES = ("IH", "IF", "IC", "IM")


def load_env() -> None:
    for name in (".env.local", ".env"):
        p = ROOT / name
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            os.environ.setdefault(k, v)


def third_friday(year: int, month: int) -> date:
    first = date(year, month, 1)
    days_to_first_fri = (4 - first.weekday()) % 7
    return date(year, month, 1 + days_to_first_fri + 14)


def listed_yms(as_of: date) -> list[tuple[int, int]]:
    y, m = as_of.year, as_of.month
    if as_of > third_friday(y, m):
        m += 1
        if m > 12:
            m, y = 1, y + 1
    near = (y, m)
    y2, m2 = y, m + 1
    if m2 > 12:
        m2, y2 = 1, y2 + 1
    nxt = (y2, m2)
    quarterly: list[tuple[int, int]] = []
    yy, mm = y2, m2
    while len(quarterly) < 2:
        mm += 1
        if mm > 12:
            mm, yy = 1, yy + 1
        if mm in (3, 6, 9, 12):
            quarterly.append((yy, mm))
    return [near, nxt, quarterly[0], quarterly[1]]


def ym_code(y: int, m: int) -> str:
    return f"{y % 100:02d}{m:02d}"


def needed_roots(as_of: date) -> list[str]:
    """Listed window as of today, plus prior ~6 months of month codes for history."""
    roots: set[str] = set()
    # Walk back ~200 calendar days to catch recently expired near months still useful
    d = as_of - timedelta(days=200)
    while d <= as_of + timedelta(days=40):
        if d.weekday() < 5:
            for base in BASES:
                for y, m in listed_yms(d):
                    roots.add(f"{base}{ym_code(y, m)}")
        d += timedelta(days=1)
    return sorted(roots)


def fetch_contract(root: str) -> list[tuple]:
    try:
        df = ak.futures_zh_daily_sina(symbol=root)
    except Exception as e:
        print(f"  skip {root}: {e}", file=sys.stderr)
        return []
    if df is None or getattr(df, "empty", True):
        print(f"  empty {root}", file=sys.stderr)
        return []
    out: list[tuple] = []
    for _, row in df.iterrows():
        td = str(row.get("date", ""))[:10]
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", td):
            continue

        def _f(col: str):
            v = row.get(col)
            try:
                if v is None or (isinstance(v, float) and pd.isna(v)):
                    return None
                return float(v)
            except Exception:
                return None

        close = _f("close")
        settle = _f("settle")
        if settle is None or settle == 0:
            settle = close
        if close is None and settle is None:
            continue
        out.append(
            (
                td,
                root,  # store bare root; API normalizes .CFE away
                _f("open"),
                _f("high"),
                _f("low"),
                close,
                settle,
                _f("volume"),
                "akshare_sina",
            )
        )
    return out


def main() -> None:
    load_env()
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL missing", file=sys.stderr)
        sys.exit(1)

    today = date.today()
    roots = needed_roots(today)
    print(f"Fetching {len(roots)} contracts …", file=sys.stderr)

    all_rows: list[tuple] = []
    for root in roots:
        rows = fetch_contract(root)
        print(f"  {root}: {len(rows)} rows", file=sys.stderr)
        all_rows.extend(rows)

    if not all_rows:
        print("No rows fetched", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO raw_futures_contracts_daily
                    (trade_date, contract, open, high, low, close, clear, volume, source)
                VALUES %s
                ON CONFLICT (trade_date, contract) DO UPDATE SET
                    open   = COALESCE(EXCLUDED.open,   raw_futures_contracts_daily.open),
                    high   = COALESCE(EXCLUDED.high,   raw_futures_contracts_daily.high),
                    low    = COALESCE(EXCLUDED.low,    raw_futures_contracts_daily.low),
                    close  = COALESCE(EXCLUDED.close,  raw_futures_contracts_daily.close),
                    clear  = CASE
                               WHEN EXCLUDED.clear IS NOT NULL AND EXCLUDED.clear::float8 > 0
                               THEN EXCLUDED.clear
                               WHEN raw_futures_contracts_daily.clear IS NOT NULL
                                    AND raw_futures_contracts_daily.clear::float8 > 0
                               THEN raw_futures_contracts_daily.clear
                               ELSE COALESCE(EXCLUDED.close, raw_futures_contracts_daily.close)
                             END,
                    volume = COALESCE(EXCLUDED.volume, raw_futures_contracts_daily.volume),
                    source = EXCLUDED.source,
                    fetched_at = NOW()
                """,
                all_rows,
                page_size=500,
            )
        conn.commit()
        print(f"Upserted {len(all_rows)} rows.", file=sys.stderr)
        print(json.dumps({"rows": len(all_rows), "contracts": len(roots)}))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
