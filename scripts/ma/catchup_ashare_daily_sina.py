#!/usr/bin/env python3
"""
catchup_ashare_daily_sina.py
============================
Reliable A-share daily catch-up via Sina (ak.stock_zh_a_daily), upserting
directly into PostgreSQL in batches — avoids East Money blocks and the
huge-JSON / stderr-pipe hang that stalls nightly_etl ashare_daily.

Usage
-----
  py -3 scripts/ma/catchup_ashare_daily_sina.py
  py -3 scripts/ma/catchup_ashare_daily_sina.py 2026-07-29 2026-08-05
  py -3 scripts/ma/catchup_ashare_daily_sina.py --compute-only

Env
---
  ASHARE_AK_MAX_WORKERS   default 8
  ASHARE_AK_DELAY         default 0.02
  ASHARE_AK_CODE_LIMIT    default 0 (all)
  ASHARE_TASK_TIMEOUT     per-stock timeout seconds (default 25)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from datetime import date, datetime, timedelta
from pathlib import Path

# Harden hangs: apply before akshare/requests import path runs.
os.environ.setdefault("TQDM_DISABLE", "1")

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
sys.path.insert(0, str(SCRIPT_DIR))

from fetch_ashare_daily_akshare import (  # noqa: E402
    _fetch_universe,
    _load_env,
    _norm_date,
    _rows_from_hist_sina,
    _to_ts_code,
)


def _log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{ts} {msg}"
    print(line, flush=True)
    try:
        with open(PROJECT_ROOT / "_tmp_ashare_catchup.log", "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def _get_conn():
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


def _upsert_rows(conn, rows: list[dict]) -> int:
    from psycopg2.extras import execute_values

    records = []
    for r in rows:
        d = r.get("date")
        code = (r.get("ts_code") or "").strip()
        if not d or not code:
            continue
        vol = r.get("volume")
        records.append((
            d,
            code,
            r.get("open"),
            r.get("close"),
            r.get("high"),
            r.get("low"),
            int(vol) if vol is not None else None,
            r.get("amount"),
            r.get("turn"),
            r.get("source") or "akshare_sina_daily",
        ))
    if not records:
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_ashare_daily
                (trade_date, ts_code, open, close, high, low, volume, amount, turn, source)
            VALUES %s
            ON CONFLICT (trade_date, ts_code) DO UPDATE
                SET open = EXCLUDED.open,
                    close = EXCLUDED.close,
                    high = EXCLUDED.high,
                    low = EXCLUDED.low,
                    volume = EXCLUDED.volume,
                    amount = EXCLUDED.amount,
                    turn = EXCLUDED.turn,
                    source = EXCLUDED.source,
                    fetched_at = NOW()
            """,
            records,
            page_size=2000,
        )
    conn.commit()
    return len(records)


def _fetch_and_upsert(start: str, end: str) -> int:
    import socket

    # Bound stuck sockets; individual futures also have a timeout.
    socket.setdefaulttimeout(int(os.environ.get("ASHARE_SOCKET_TIMEOUT", "20")))

    codes = _fetch_universe()
    max_workers = int(os.environ.get("ASHARE_AK_MAX_WORKERS", "8"))
    delay = float(os.environ.get("ASHARE_AK_DELAY", "0.02"))
    limit = int(os.environ.get("ASHARE_AK_CODE_LIMIT", "0"))
    task_timeout = float(os.environ.get("ASHARE_TASK_TIMEOUT", "25"))
    if limit > 0:
        codes = codes[:limit]

    _log(f"catchup sina: {len(codes)} codes, {start} → {end}, workers={max_workers}")

    conn = _get_conn()
    total = 0
    done = 0
    errors = 0
    timed_out = 0
    batch: list[dict] = []
    batch_size = 2000

    def task(code: str) -> list[dict]:
        if delay > 0:
            time.sleep(delay)
        return _rows_from_hist_sina(code, start, end)

    try:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(task, code): code for code in codes}
            for fut in as_completed(futures):
                code = futures[fut]
                try:
                    rows = fut.result(timeout=task_timeout)
                    batch.extend(rows)
                except FuturesTimeout:
                    timed_out += 1
                    if timed_out <= 5:
                        _log(f"  timeout {code}")
                except Exception as exc:
                    errors += 1
                    if errors <= 5:
                        _log(f"  fail {code}: {exc}")
                done += 1

                if len(batch) >= batch_size:
                    n = _upsert_rows(conn, batch)
                    total += n
                    batch.clear()

                if done % 250 == 0 or done == len(codes):
                    _log(
                        f"  progress {done}/{len(codes)} "
                        f"upserted={total} errors={errors} timeouts={timed_out}"
                    )

        if batch:
            total += _upsert_rows(conn, batch)
    finally:
        conn.close()

    _log(f"catchup sina done: upserted={total} errors={errors} timeouts={timed_out}")
    return total


def _compute_crowding() -> int:
    # Reuse nightly_etl step in-process.
    sys.path.insert(0, str(SCRIPT_DIR))
    import nightly_etl as etl

    conn = _get_conn()
    try:
        n = etl.step_compute_ashare_crowding(conn, force=False)
        _log(f"crowding compute: {n} rows")
        return n
    finally:
        conn.close()


def main() -> None:
    _load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("start", nargs="?", help="YYYY-MM-DD")
    parser.add_argument("end", nargs="?", help="YYYY-MM-DD")
    parser.add_argument("--compute-only", action="store_true")
    args = parser.parse_args()

    if args.compute_only:
        _compute_crowding()
        return

    today = date.today()
    if args.start and args.end:
        start = _norm_date(args.start)
        end = _norm_date(args.end)
    else:
        # Default: from day after DB max → today
        conn = _get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT MAX(trade_date) FROM raw_ashare_daily")
                row = cur.fetchone()
                cur_max = row[0] if row else None
        finally:
            conn.close()
        if cur_max is None:
            start = (today - timedelta(days=14)).isoformat()
        else:
            start = (cur_max + timedelta(days=1)).isoformat()
        end = today.isoformat()
        if start > end:
            _log(f"already up-to-date (max={cur_max})")
            _compute_crowding()
            return

    _log(f"starting catchup {start} → {end}")
    n = _fetch_and_upsert(start, end)
    if n == 0:
        _log("WARNING: no rows upserted")
        sys.exit(2)
    _compute_crowding()

    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(trade_date) FROM raw_ashare_daily")
            raw_max = cur.fetchone()[0]
            cur.execute("SELECT MAX(trade_date) FROM derived_ashare_crowding_daily")
            crowd_max = cur.fetchone()[0]
        _log(f"DONE raw_max={raw_max} crowding_max={crowd_max}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
