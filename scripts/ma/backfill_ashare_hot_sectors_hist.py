#!/usr/bin/env python3
"""
backfill_ashare_hot_sectors_hist.py
===================================
Backfill daily industry/concept board change_pct + ranks from Tonghuashun
index history (AkShare), then upsert into derived_ashare_hot_sectors_daily.

This powers the "热点持续性" chart (days in Top-N / consecutive hot streaks).

Usage
-----
  python backfill_ashare_hot_sectors_hist.py --type industry --days 60
  python backfill_ashare_hot_sectors_hist.py --type concept --days 40 --store-top 40
  python backfill_ashare_hot_sectors_hist.py --type both --days 60

Output JSON summary to stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

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
    os.environ.setdefault("TQDM_DISABLE", "1")


def _today_cn() -> datetime:
    return datetime.now(ZoneInfo("Asia/Shanghai")).replace(tzinfo=None)


def _ymd(d: datetime | str) -> str:
    if isinstance(d, datetime):
        return d.strftime("%Y-%m-%d")
    s = str(d).strip().replace("/", "-")
    if len(s) >= 10 and s[4] == "-":
        return s[:10]
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    # pandas ms timestamp via to_json-style
    try:
        ms = float(s)
        if ms > 1e11:
            return datetime.utcfromtimestamp(ms / 1000.0).strftime("%Y-%m-%d")
    except ValueError:
        pass
    raise ValueError(f"bad date: {d!r}")


def _parse_row_date(v) -> str | None:
    if v is None:
        return None
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    try:
        import pandas as pd
        if isinstance(v, pd.Timestamp):
            return v.strftime("%Y-%m-%d")
    except Exception:
        pass
    try:
        return _ymd(v)
    except Exception:
        return None


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
            CREATE TABLE IF NOT EXISTS derived_ashare_hot_sectors_daily (
                trade_date       DATE         NOT NULL,
                board_type       VARCHAR(20)  NOT NULL,
                board_name       VARCHAR(100) NOT NULL,
                change_pct       NUMERIC(10,4),
                amount           NUMERIC(20,2),
                lead_stock       VARCHAR(100),
                lead_change_pct  NUMERIC(10,4),
                rank_no          INTEGER,
                source           VARCHAR(60),
                fetched_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, board_type, board_name)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS derived_ashare_hot_sectors_daily_lookup_idx
              ON derived_ashare_hot_sectors_daily (trade_date DESC, board_type, rank_no)
        """)
    conn.commit()


def _list_boards(ak, board_type: str) -> list[str]:
    if board_type == "industry":
        df = ak.stock_board_industry_name_ths()
    else:
        df = ak.stock_board_concept_name_ths()
    if df is None or df.empty:
        return []
    col = "name" if "name" in df.columns else df.columns[0]
    names = []
    for v in df[col].tolist():
        s = str(v).strip()
        if s:
            names.append(s)
    return names


def _fetch_board_hist(ak, board_type: str, name: str, start: str, end: str):
    start_ymd = start.replace("-", "")
    end_ymd = end.replace("-", "")
    if board_type == "industry":
        return ak.stock_board_industry_index_ths(symbol=name, start_date=start_ymd, end_date=end_ymd)
    return ak.stock_board_concept_index_ths(symbol=name, start_date=start_ymd, end_date=end_ymd)


def _hist_to_changes(df) -> list[tuple[str, float, float | None]]:
    """Return [(trade_date, change_pct, amount), ...] from OHLCV hist."""
    if df is None or df.empty:
        return []
    date_c = None
    close_c = None
    amt_c = None
    for c in df.columns:
        cs = str(c)
        if cs in {"日期", "date", "Date"}:
            date_c = c
        elif cs in {"收盘价", "收盘", "close", "Close"}:
            close_c = c
        elif cs in {"成交额", "amount", "Amount"}:
            amt_c = c
    if date_c is None or close_c is None:
        return []

    rows = []
    prev_close = None
    # ensure chronological
    work = df[[date_c, close_c] + ([amt_c] if amt_c else [])].copy()
    try:
        work = work.sort_values(date_c)
    except Exception:
        pass
    for _, r in work.iterrows():
        d = _parse_row_date(r[date_c])
        try:
            close = float(r[close_c])
        except Exception:
            continue
        if not d or close <= 0:
            continue
        amt = None
        if amt_c is not None:
            try:
                amt = float(r[amt_c])
            except Exception:
                amt = None
        if prev_close and prev_close > 0:
            chg = (close / prev_close - 1.0) * 100.0
            rows.append((d, chg, amt))
        prev_close = close
    return rows


def backfill(board_type: str, days: int, store_top: int | None, sleep_s: float) -> dict:
    import akshare as ak
    from psycopg2.extras import execute_values

    end = _today_cn()
    # Extra buffer days so pct_change has prior close.
    start = end - timedelta(days=days + 20)
    start_s = start.strftime("%Y-%m-%d")
    end_s = end.strftime("%Y-%m-%d")
    cutoff = (end - timedelta(days=days + 5)).strftime("%Y-%m-%d")

    names = _list_boards(ak, board_type)
    if not names:
        raise RuntimeError(f"no {board_type} board names from THS")

    # concept universe is large; allow limiting boards for faster backfill
    max_boards = int(os.environ.get("HOT_SECTORS_HIST_MAX_BOARDS", "0") or "0")
    if max_boards > 0:
        names = names[:max_boards]

    by_date: dict[str, list[tuple[str, float, float | None]]] = defaultdict(list)
    errors = 0
    ok = 0
    source = f"ths_{board_type}_index_hist"

    for i, name in enumerate(names, start=1):
        try:
            df = _fetch_board_hist(ak, board_type, name, start_s, end_s)
            series = _hist_to_changes(df)
            for d, chg, amt in series:
                if d >= cutoff:
                    by_date[d].append((name[:100], chg, amt))
            ok += 1
        except Exception as e:
            errors += 1
            sys.stderr.write(f"[{board_type}] {name}: {e}\n")
        if sleep_s > 0:
            time.sleep(sleep_s)
        if i % 20 == 0:
            sys.stderr.write(f"[{board_type}] progress {i}/{len(names)} ok={ok} err={errors}\n")

    records: list[tuple] = []
    dates_written = 0
    for d in sorted(by_date.keys()):
        items = by_date[d]
        if len(items) < 10:
            continue
        items.sort(key=lambda x: x[1], reverse=True)
        if store_top is not None:
            items = items[:store_top]
        dates_written += 1
        for rank, (name, chg, amt) in enumerate(items, start=1):
            records.append((
                d,
                board_type,
                name,
                round(chg, 4),
                None if amt is None else round(amt, 2),
                None,  # lead_stock
                None,  # lead_change_pct
                rank,
                source,
            ))

    if not records:
        raise RuntimeError(f"{board_type} hist backfill produced no records")

    conn = _db_conn()
    try:
        _ensure_table(conn)
        with conn.cursor() as cur:
            # Replace only hist-sourced rows in the window for this board_type,
            # keep live snapshot rows for dates outside / other sources.
            cur.execute(
                """
                DELETE FROM derived_ashare_hot_sectors_daily
                WHERE board_type = %s
                  AND trade_date >= %s::date
                  AND (source IS NULL OR source LIKE 'ths_%%_index_hist' OR source LIKE '%%_hist')
                """,
                (board_type, cutoff),
            )
            execute_values(
                cur,
                """
                INSERT INTO derived_ashare_hot_sectors_daily (
                    trade_date, board_type, board_name, change_pct, amount,
                    lead_stock, lead_change_pct, rank_no, source, fetched_at
                ) VALUES %s
                ON CONFLICT (trade_date, board_type, board_name) DO UPDATE
                    SET change_pct = EXCLUDED.change_pct,
                        amount = COALESCE(EXCLUDED.amount, derived_ashare_hot_sectors_daily.amount),
                        rank_no = EXCLUDED.rank_no,
                        source = EXCLUDED.source,
                        fetched_at = NOW()
                """,
                records,
                template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())",
                page_size=1000,
            )
        conn.commit()
    finally:
        conn.close()

    return {
        "board_type": board_type,
        "boards_fetched": ok,
        "boards_failed": errors,
        "dates": dates_written,
        "rows": len(records),
        "start": cutoff,
        "end": end_s,
        "source": source,
        "store_top": store_top,
    }


def main() -> int:
    _load_env()
    parser = argparse.ArgumentParser(description="Backfill hot sector daily ranks from THS hist")
    parser.add_argument("--type", choices=["industry", "concept", "both"], default="industry")
    parser.add_argument("--days", type=int, default=60, help="Calendar lookback days (default 60)")
    parser.add_argument(
        "--store-top",
        type=int,
        default=0,
        help="Store only top N boards per day (0 = store all ranked boards)",
    )
    parser.add_argument("--sleep", type=float, default=0.05, help="Sleep between board requests")
    args = parser.parse_args()

    days = max(10, min(400, args.days))
    store_top = None if args.store_top <= 0 else max(10, min(200, args.store_top))
    types = ["industry", "concept"] if args.type == "both" else [args.type]

    summaries = []
    try:
        for t in types:
            # Concept universe is large; default to top-40 store if unset.
            st = store_top
            if t == "concept" and st is None:
                st = 40
            summaries.append(backfill(t, days, st, args.sleep))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 1

    print(json.dumps({"ok": True, "results": summaries}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
