#!/usr/bin/env python3
"""
backfill_ashare_board_amount_hist.py
====================================
Backfill daily board amount + change_pct for selected industry/concept boards
from Tonghuashun index history into derived_ashare_board_amount_daily.

Used by the "板块成交额占比 vs 全A拥挤度" chart.

Usage
-----
  python backfill_ashare_board_amount_hist.py --days 365
  python backfill_ashare_board_amount_hist.py --board 人工智能 --type concept --days 365
  python backfill_ashare_board_amount_hist.py --preset ai --days 365
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
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

# Curated boards for AI / crowding narrative
AI_PRESET: list[tuple[str, str]] = [
    ("concept", "人工智能"),
    ("concept", "共封装光学(CPO)"),
    ("concept", "东数西算(算力)"),
    ("concept", "AI应用"),
    ("concept", "数据中心(AIDC)"),
    ("concept", "算力租赁"),
    ("concept", "华为概念"),
    ("concept", "存储芯片"),
    ("industry", "半导体"),
    ("industry", "通信设备"),
    ("industry", "元件"),
    ("industry", "软件开发"),
    ("industry", "光学光电子"),
    ("industry", "计算机设备"),
    ("industry", "消费电子"),
]


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
    s = str(v).strip().replace("/", "-")
    if len(s) >= 10 and s[4] == "-":
        return s[:10]
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    try:
        ms = float(s)
        if ms > 1e11:
            return datetime.utcfromtimestamp(ms / 1000.0).strftime("%Y-%m-%d")
    except ValueError:
        pass
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
            CREATE TABLE IF NOT EXISTS derived_ashare_board_amount_daily (
                trade_date   DATE         NOT NULL,
                board_type   VARCHAR(20)  NOT NULL,
                board_name   VARCHAR(100) NOT NULL,
                amount       NUMERIC(20,2),
                change_pct   NUMERIC(10,4),
                close        NUMERIC(16,4),
                source       VARCHAR(60),
                fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, board_type, board_name)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS derived_ashare_board_amount_daily_lookup_idx
              ON derived_ashare_board_amount_daily (board_type, board_name, trade_date DESC)
        """)
    conn.commit()


def _fetch_hist(ak, board_type: str, name: str, start: str, end: str):
    start_ymd = start.replace("-", "")
    end_ymd = end.replace("-", "")
    if board_type == "industry":
        return ak.stock_board_industry_index_ths(symbol=name, start_date=start_ymd, end_date=end_ymd)
    return ak.stock_board_concept_index_ths(symbol=name, start_date=start_ymd, end_date=end_ymd)


def _hist_rows(df) -> list[tuple[str, float | None, float | None, float | None]]:
    """[(date, amount, change_pct, close), ...]"""
    if df is None or df.empty:
        return []
    date_c = close_c = amt_c = None
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

    work = df[[date_c, close_c] + ([amt_c] if amt_c else [])].copy()
    try:
        work = work.sort_values(date_c)
    except Exception:
        pass

    out = []
    prev_close = None
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
        chg = None
        if prev_close and prev_close > 0:
            chg = (close / prev_close - 1.0) * 100.0
        prev_close = close
        if chg is None and amt is None:
            continue
        out.append((d, amt, chg, close))
    return out


def backfill_boards(boards: list[tuple[str, str]], days: int, sleep_s: float) -> dict:
    import akshare as ak
    from psycopg2.extras import execute_values

    end = _today_cn()
    start = end - timedelta(days=days + 20)
    start_s = start.strftime("%Y-%m-%d")
    end_s = end.strftime("%Y-%m-%d")
    cutoff = (end - timedelta(days=days + 5)).strftime("%Y-%m-%d")

    conn = _db_conn()
    _ensure_table(conn)

    summaries = []
    total_rows = 0
    try:
        for board_type, name in boards:
            source = f"ths_{board_type}_index_hist"
            try:
                df = _fetch_hist(ak, board_type, name, start_s, end_s)
                series = _hist_rows(df)
            except Exception as e:
                summaries.append({"board_type": board_type, "board_name": name, "error": str(e), "rows": 0})
                continue

            records = []
            for d, amt, chg, close in series:
                if d < cutoff:
                    continue
                records.append((
                    d,
                    board_type,
                    name[:100],
                    None if amt is None else round(amt, 2),
                    None if chg is None else round(chg, 4),
                    None if close is None else round(close, 4),
                    source,
                ))

            if not records:
                summaries.append({"board_type": board_type, "board_name": name, "error": "empty", "rows": 0})
                continue

            with conn.cursor() as cur:
                cur.execute(
                    """
                    DELETE FROM derived_ashare_board_amount_daily
                    WHERE board_type = %s AND board_name = %s AND trade_date >= %s::date
                    """,
                    (board_type, name[:100], cutoff),
                )
                execute_values(
                    cur,
                    """
                    INSERT INTO derived_ashare_board_amount_daily (
                        trade_date, board_type, board_name, amount, change_pct, close, source, fetched_at
                    ) VALUES %s
                    ON CONFLICT (trade_date, board_type, board_name) DO UPDATE
                        SET amount = EXCLUDED.amount,
                            change_pct = EXCLUDED.change_pct,
                            close = EXCLUDED.close,
                            source = EXCLUDED.source,
                            fetched_at = NOW()
                    """,
                    records,
                    template="(%s, %s, %s, %s, %s, %s, %s, NOW())",
                    page_size=500,
                )
            conn.commit()
            total_rows += len(records)
            summaries.append({
                "board_type": board_type,
                "board_name": name,
                "rows": len(records),
                "start": records[0][0],
                "end": records[-1][0],
            })
            sys.stderr.write(f"[board-amount] {board_type}/{name}: {len(records)} rows\n")
            if sleep_s > 0:
                time.sleep(sleep_s)
    finally:
        conn.close()

    return {"ok": True, "rows": total_rows, "boards": summaries, "cutoff": cutoff, "end": end_s}


def main() -> int:
    _load_env()
    parser = argparse.ArgumentParser(description="Backfill board amount history for sector crowding chart")
    parser.add_argument("--days", type=int, default=365)
    parser.add_argument("--preset", choices=["ai"], default=None)
    parser.add_argument("--board", type=str, default=None, help="Single board name")
    parser.add_argument("--type", choices=["industry", "concept"], default="concept")
    parser.add_argument("--sleep", type=float, default=0.08)
    args = parser.parse_args()

    days = max(30, min(800, args.days))
    if args.board:
        boards = [(args.type, args.board.strip())]
    else:
        boards = list(AI_PRESET)

    try:
        payload = backfill_boards(boards, days, args.sleep)
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 1
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
