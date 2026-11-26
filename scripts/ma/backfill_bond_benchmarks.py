#!/usr/bin/env python3
"""Load bond benchmark closes into raw_ashare_index_daily.

Choice / EmQuant codes (confirmed with c.css NAME, then c.csd CLOSE):
  H11001.CSI  中证全债
  000012.SH   上证国债
  000013.SH   上证企业债

ChinaBond wealth indexes are valid Choice codes, but this account's CLOSE
field is empty. Their levels are read from the ChinaBond website:
  CBA00201.CS  中债综合财富(总值)
  CBA00601.CS  中债国债总财富(总值)
  CBA02701.CS  中债信用债总财富(总值)

Usage
  python backfill_bond_benchmarks.py --chinabond
  python backfill_bond_benchmarks.py --choice
  python backfill_bond_benchmarks.py --ten-year-etf
"""

from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

START = "2002-01-01"
CHOICE_CODES = ["H11001.CSI", "000012.SH", "000013.SH"]
CHINABOND = [
    ("CBA00201.CS", "综合指数"),
    ("CBA00601.CS", "国债总指数"),
    ("CBA02701.CS", "信用债总指数"),
]
CSD_OPTS = "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH"


def load_env() -> None:
    bases = [Path("/root/new_market_project"), Path.cwd()]
    here = Path(__file__).resolve()
    if len(here.parents) > 2:
        bases.append(here.parents[2])
    for base in bases:
        for name in (".env.local", ".env"):
            f = base / name
            if not f.is_file():
                continue
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def connect():
    import psycopg2

    url = os.environ.get("DATABASE_URL") or ""
    if not url:
        raise SystemExit("DATABASE_URL is missing")
    pr = urlparse(url)
    return psycopg2.connect(
        host=pr.hostname,
        port=pr.port or 5432,
        dbname=(pr.path or "/").lstrip("/") or "market_data",
        user=pr.username,
        password=unquote(pr.password or ""),
    )


def upsert(conn, records: list[tuple]) -> int:
    if not records:
        return 0
    from psycopg2.extras import execute_values

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_ashare_index_daily (trade_date, ts_code, close, amount, source)
            VALUES %s
            ON CONFLICT (trade_date, ts_code) DO UPDATE
                SET close = EXCLUDED.close,
                    amount = COALESCE(EXCLUDED.amount, raw_ashare_index_daily.amount),
                    source = EXCLUDED.source,
                    fetched_at = NOW()
            """,
            records,
            page_size=2000,
        )
    conn.commit()
    return len(records)


def parse_csd(data) -> list[tuple[str, float]]:
    dates = list(getattr(data, "Dates", None) or getattr(data, "Times", None) or [])
    dd = getattr(data, "Data", None)
    values = None
    if isinstance(dd, dict):
        values = dd.get("CLOSE")
        if values is None and len(dd) == 1:
            values = next(iter(dd.values()))
        if isinstance(values, (list, tuple)) and values and isinstance(values[0], (list, tuple)):
            values = values[0]
    elif isinstance(dd, (list, tuple)) and dd:
        values = dd[0]
    if not dates or values is None:
        return []
    values = list(values)
    if values and isinstance(values[0], (list, tuple)):
        values = list(values[0])
    out = []
    for d, v in zip(dates, values):
        ds = d if isinstance(d, str) else d.strftime("%Y-%m-%d")
        if isinstance(ds, str) and "/" in ds:
            ds = datetime.strptime(ds, "%Y/%m/%d").strftime("%Y-%m-%d")
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        if fv > 0:
            out.append((ds[:10], round(fv, 4)))
    return out


def log_callback(_msg):
    return 0


def fetch_choice(conn) -> None:
    from EmQuantAPI import c  # type: ignore

    username = os.environ.get("EMQ_USERNAME")
    password = os.environ.get("EMQ_PASSWORD")
    if not username or not password:
        raise SystemExit("Missing EMQ_USERNAME/EMQ_PASSWORD")
    login = c.start(
        f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0",
        log_callback,
        None,
    )
    if login.ErrorCode != 0:
        raise SystemExit(f"Choice login failed: {login.ErrorCode} {getattr(login, 'ErrorMsg', '')}")
    end = datetime.today().strftime("%Y-%m-%d")
    try:
        for code in CHOICE_CODES:
            data = c.csd(code, "CLOSE", START, end, CSD_OPTS)
            if getattr(data, "ErrorCode", 0) != 0:
                print(f"choice miss {code} {getattr(data, 'ErrorMsg', '')}")
                continue
            rows = parse_csd(data)
            n = upsert(conn, [(d, code, close, None, "choice") for d, close in rows])
            last = rows[-1] if rows else None
            print(f"choice {code} upserted {n} last={last}")
    finally:
        try:
            c.stop()
        except Exception:
            pass


def fetch_ten_year_etf(conn) -> None:
    """511260.SH 十年国债ETF unit NAV. Choice code confirmed via 妙想."""
    from EmQuantAPI import c  # type: ignore

    username = os.environ.get("EMQ_USERNAME")
    password = os.environ.get("EMQ_PASSWORD")
    if not username or not password:
        raise SystemExit("Missing EMQ_USERNAME/EMQ_PASSWORD")
    login = c.start(
        f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0",
        log_callback,
        None,
    )
    if login.ErrorCode != 0:
        raise SystemExit(f"Choice login failed: {login.ErrorCode} {getattr(login, 'ErrorMsg', '')}")
    end = datetime.today().strftime("%Y-%m-%d")
    try:
        named = c.css("511260.SH", "NAME", "")
        name = None
        data_map = getattr(named, "Data", None)
        if isinstance(data_map, dict):
            raw = data_map.get("511260.SH")
            if isinstance(raw, (list, tuple)) and raw:
                name = raw[0]
        data = c.csd("511260.SH", "ORIGINALUNIT", "2017-01-01", end, CSD_OPTS)
        if getattr(data, "ErrorCode", 0) != 0:
            raise SystemExit(f"csd failed: {getattr(data, 'ErrorMsg', '')}")
        rows = parse_csd(data)
        n = upsert_etf(conn, rows)
        last = rows[-1] if rows else None
        print(f"etf 511260.SH name={name} upserted {n} last={last}")
    finally:
        try:
            c.stop()
        except Exception:
            pass


def upsert_etf(conn, rows: list[tuple[str, float]]) -> int:
    if not rows:
        return 0
    from psycopg2.extras import execute_values

    records = [(d, "511260.SH", "ORIGINALUNIT", close, "choice") for d, close in rows]
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_etf_daily (trade_date, ticker, field, value, source)
            VALUES %s
            ON CONFLICT (trade_date, ticker, field) DO UPDATE
                SET value = EXCLUDED.value, fetched_at = NOW()
            """,
            records,
            page_size=2000,
        )
    conn.commit()
    return len(records)


def fetch_chinabond(conn) -> None:
    import akshare as ak

    end = datetime.today().strftime("%Y-%m-%d")
    for code, category in CHINABOND:
        if category == "综合指数":
            df = ak.bond_composite_index_cbond(indicator="财富", period="总值")
        else:
            df = ak.bond_index_general_cbond(index_category=category, indicator="财富", period="总值")
        records = []
        for _, r in df.iterrows():
            d = str(r.get("date", ""))[:10]
            try:
                close = float(r.get("value"))
            except (TypeError, ValueError):
                continue
            if not d or d < START or d > end or close <= 0:
                continue
            records.append((d, code, round(close, 4), None, "chinabond"))
        n = upsert(conn, records)
        last = records[-1][0] if records else None
        print(f"chinabond {code} upserted {n} last={last}")


def main() -> None:
    load_env()
    which = set(sys.argv[1:])
    if not which:
        which = {"--chinabond", "--choice"}
    conn = connect()
    try:
        if "--chinabond" in which:
            fetch_chinabond(conn)
        if "--choice" in which:
            fetch_choice(conn)
        if "--ten-year-etf" in which:
            fetch_ten_year_etf(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
