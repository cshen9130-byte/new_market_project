#!/usr/bin/env python3
"""Backfill product-page benchmark history into raw_ashare_index_daily.

Sources:
  - CSI official history (akshare stock_zh_index_hist_csindex) for SSE/CSI codes
  - AkShare stock_zh_index_daily for SZSE / BJ style and board-style indices
  - AkShare stock_hk_index_daily_sina for HSI / HSTECH
  - AkShare index_hist_sw + equal-weight composites for 801271-801276
  - raw_ashare_daily for EQW.CN (scaled to keep existing levels)
  - East Money kline for BK*.EM boards when reachable

Default window: 2018-01-01 through the last completed session (not today).
Does not restart services.

Usage:
  python scripts/ma/backfill_product_benchmarks.py
  python scripts/ma/backfill_product_benchmarks.py 2018-01-01 2026-11-20
"""

from __future__ import annotations

import os
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import unquote, urlparse

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_ashare_index_universe import (  # type: ignore
    SECTOR_COMPOSITES,
    SW_L1_CODES,
    chain_equal_weight,
    fetch_em,
    fetch_sw,
)


def _load_env() -> None:
    for base in (Path.cwd(), ROOT, Path(__file__).resolve().parent):
        for fname in (".env.local", ".env", ".env.production"):
            f = base / fname
            if not f.is_file():
                continue
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _log(msg: str) -> None:
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def _num(v: object) -> float | None:
    try:
        n = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return n if n == n and n > 0 else None


def last_completed_session() -> str:
    today = date.today()
    # Avoid upserting an in-progress session (this script ran on a Monday open).
    end = today - timedelta(days=1)
    while end.weekday() >= 5:
        end -= timedelta(days=1)
    return end.strftime("%Y-%m-%d")


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


def rows_to_records(ts_code: str, rows: list[dict], start: str, end: str) -> list[tuple]:
    out: list[tuple] = []
    seen: set[str] = set()
    for r in rows:
        d = str(r.get("date") or "")[:10]
        if not d or d < start or d > end or d in seen:
            continue
        close = _num(r.get("close"))
        if close is None:
            continue
        amount = _num(r.get("amount"))
        source = str(r.get("source") or "backfill")[:30]
        seen.add(d)
        out.append((d, ts_code, round(close, 4), amount, source))
    out.sort(key=lambda x: x[0])
    return out


def fetch_csindex(code: str, start: str, end: str) -> list[dict]:
    import akshare as ak

    df = ak.stock_zh_index_hist_csindex(
        symbol=code,
        start_date=start.replace("-", ""),
        end_date=end.replace("-", ""),
    )
    if df is None or df.empty:
        return []
    date_col = next((c for c in df.columns if str(c) in ("日期", "date", "Date")), None)
    close_col = next((c for c in df.columns if str(c) in ("收盘", "close", "Close")), None)
    amt_col = next((c for c in df.columns if "成交金额" in str(c) or str(c) in ("amount",)), None)
    if not date_col or not close_col:
        return []
    out: list[dict] = []
    for _, r in df.iterrows():
        d = str(r.get(date_col, ""))[:10]
        close = _num(r.get(close_col))
        amt = _num(r.get(amt_col)) if amt_col else None
        if amt is not None and amt < 1e6:
            amt = amt * 1e8
        if close is None or not d:
            continue
        out.append({"date": d, "close": close, "amount": amt, "source": "csindex"})
    return out


def fetch_ak_daily(symbol: str, start: str, end: str) -> list[dict]:
    import akshare as ak

    df = ak.stock_zh_index_daily(symbol=symbol)
    if df is None or df.empty or "date" not in df.columns or "close" not in df.columns:
        return []
    out: list[dict] = []
    for _, r in df.iterrows():
        d = str(r.get("date", ""))[:10]
        close = _num(r.get("close"))
        if close is None or not d or d < start or d > end:
            continue
        out.append({"date": d, "close": close, "amount": None, "source": "akshare"})
    return out


def fetch_ak_hk(symbol: str, start: str, end: str) -> list[dict]:
    import akshare as ak

    df = ak.stock_hk_index_daily_sina(symbol=symbol)
    if df is None or df.empty:
        return []
    date_col = next((c for c in df.columns if str(c).lower() in ("date", "日期")), None)
    close_col = next((c for c in df.columns if str(c).lower() in ("close", "收盘")), None)
    if not date_col or not close_col:
        return []
    out: list[dict] = []
    for _, r in df.iterrows():
        d = str(r.get(date_col, ""))[:10]
        close = _num(r.get(close_col))
        if close is None or not d or d < start or d > end:
            continue
        out.append({"date": d, "close": close, "amount": None, "source": "akshare_sina"})
    return out


# Official / published series. Do not use stock_zh_index_daily for 000985.SH:
# Sina's sh000985 history stops in 2016 and is not a reliable live series.
CSI_CODES = {
    "000001.SH": "000001",
    "000015.SH": "000015",
    "000016.SH": "000016",
    "000300.SH": "000300",
    "000510.SH": "000510",
    "000688.SH": "000688",
    "000832.SH": "000832",
    "000852.SH": "000852",
    "000902.SH": "000902",
    "000903.SH": "000903",
    "000905.SH": "000905",
    "000906.SH": "000906",
    "000922.SH": "000922",
    "000985.SH": "000985",
    "932000.CSI": "932000",
    "H00300.CSI": "H00300",
    "H11006.CSI": "H11006",
}

AK_DAILY = {
    "399006.SZ": "sz399006",
    "399372.SZ": "sz399372",
    "399373.SZ": "sz399373",
    "399374.SZ": "sz399374",
    "399375.SZ": "sz399375",
    "399376.SZ": "sz399376",
    "399377.SZ": "sz399377",
    "399303.SZ": "sz399303",
    "399997.SZ": "sz399997",
    "399808.SZ": "sz399808",
    "899050.BJ": "bj899050",
}

AK_HK = {
    "HSI.HI": "HSI",
    "HSTECH.HI": "HSTECH",
}

BK_EM = {
    "BK0999.EM": "90.BK0999",
    "BK1000.EM": "90.BK1000",
    "BK1158.EM": "90.BK1158",
}


def scale_to_anchor(rows: list[dict], anchor_date: str, anchor_value: float) -> list[dict]:
    hits = [r for r in rows if r["date"] == anchor_date and _num(r.get("close"))]
    if not hits:
        return rows
    base = float(hits[0]["close"])
    if base <= 0:
        return rows
    factor = anchor_value / base
    out = []
    for r in rows:
        close = _num(r.get("close"))
        if close is None:
            continue
        out.append({**r, "close": round(close * factor, 4)})
    return out


def existing_anchor(conn, ts_code: str) -> tuple[str, float] | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT trade_date, close
            FROM raw_ashare_index_daily
            WHERE ts_code = %s
            ORDER BY trade_date ASC
            LIMIT 1
            """,
            (ts_code,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return (row[0].strftime("%Y-%m-%d"), float(row[1]))


def backfill_eqw(conn, start: str, end: str) -> list[tuple]:
    """Rebuild EQW.CN from raw_ashare_daily and scale to the existing first level."""
    anchor = existing_anchor(conn, "EQW.CN")
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT trade_date, AVG(close / prev - 1.0) AS eq_ret
            FROM (
                SELECT trade_date, ts_code, close,
                       LAG(close) OVER (PARTITION BY ts_code ORDER BY trade_date) AS prev
                FROM raw_ashare_daily
                WHERE close > 0
                  AND trade_date >= %s
                  AND trade_date <= %s
            ) t
            WHERE prev > 0
            GROUP BY trade_date
            HAVING COUNT(*) >= 1000
            ORDER BY trade_date
            """,
            (start, end),
        )
        rows = cur.fetchall()
    if not rows:
        return []
    level = 1000.0
    series: list[dict] = []
    for td, eq_ret in rows:
        if eq_ret is None:
            continue
        d = td.strftime("%Y-%m-%d")
        if not series:
            level = 1000.0
        else:
            level *= 1.0 + float(eq_ret)
        series.append({"date": d, "close": level, "amount": None, "source": "ashare_daily"})
    if anchor:
        series = scale_to_anchor(series, anchor[0], anchor[1])
    return rows_to_records("EQW.CN", series, start, end)


def main() -> None:
    _load_env()
    start = "2018-01-01"
    end = last_completed_session()
    if len(sys.argv) >= 3:
        start = sys.argv[1]
        end = sys.argv[2]
    _log(f"backfill window {start} .. {end}")

    conn = connect()
    summary: list[str] = []
    errors: list[str] = []

    def commit_code(ts_code: str, rows: list[dict], source_note: str) -> None:
        recs = rows_to_records(ts_code, rows, start, end)
        n = upsert(conn, recs)
        if n:
            summary.append(f"{ts_code}: {n} rows {recs[0][0]}..{recs[-1][0]} via {source_note} last={recs[-1][2]}")
            _log("ok " + summary[-1])
        else:
            errors.append(ts_code)
            _log(f"miss {ts_code} ({source_note})")

    for ts_code, code in CSI_CODES.items():
        try:
            rows = fetch_csindex(code, start, end)
            time.sleep(0.15)
            commit_code(ts_code, rows, "csindex")
        except Exception as exc:
            errors.append(ts_code)
            _log(f"err {ts_code} csindex: {exc}")

    for ts_code, symbol in AK_DAILY.items():
        try:
            rows = fetch_ak_daily(symbol, start, end)
            time.sleep(0.15)
            commit_code(ts_code, rows, "akshare")
        except Exception as exc:
            errors.append(ts_code)
            _log(f"err {ts_code} akshare: {exc}")

    for ts_code, symbol in AK_HK.items():
        try:
            rows = fetch_ak_hk(symbol, start, end)
            time.sleep(0.15)
            commit_code(ts_code, rows, "akshare_sina")
        except Exception as exc:
            errors.append(ts_code)
            _log(f"err {ts_code} ak_hk: {exc}")

    # BK boards (East Money). Often blocked from the server; keep existing rows if so.
    span = (
        datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")
    ).days
    lmt = min(4000, max(200, span + 40))
    for ts_code, secid in BK_EM.items():
        try:
            rows = fetch_em(secid, start, end, lmt)
            time.sleep(0.2)
            if len(rows) >= 2:
                commit_code(ts_code, rows, "eastmoney")
            else:
                errors.append(ts_code)
                _log(f"miss {ts_code} eastmoney (kept existing rows if any)")
        except Exception as exc:
            errors.append(ts_code)
            _log(f"err {ts_code} eastmoney: {exc}")

    sw_rows: dict[str, list[dict]] = {}
    for code in SW_L1_CODES:
        ts_code = f"{code}.SI"
        try:
            rows = fetch_sw(code, start, end)
            time.sleep(0.15)
            if len(rows) >= 2:
                sw_rows[ts_code] = rows
                commit_code(ts_code, rows, "sw")
            else:
                errors.append(ts_code)
                _log(f"miss {ts_code} sw")
        except Exception as exc:
            errors.append(ts_code)
            _log(f"err {ts_code} sw: {exc}")

    for ts_code, members in SECTOR_COMPOSITES.items():
        series = chain_equal_weight([sw_rows.get(m, []) for m in members])
        anchor = existing_anchor(conn, ts_code)
        if anchor:
            series = scale_to_anchor(series, anchor[0], anchor[1])
        if series:
            commit_code(ts_code, series, "sw_composite")
        else:
            errors.append(ts_code)
            _log(f"miss {ts_code} sw_composite")

    try:
        recs = backfill_eqw(conn, "2025-01-02", end)
        n = upsert(conn, recs)
        if n:
            summary.append(f"EQW.CN: {n} rows {recs[0][0]}..{recs[-1][0]} via ashare_daily last={recs[-1][2]}")
            _log("ok " + summary[-1])
        else:
            errors.append("EQW.CN")
            _log("miss EQW.CN")
    except Exception as exc:
        errors.append("EQW.CN")
        _log(f"err EQW.CN: {exc}")

    conn.close()
    print("SUMMARY")
    for line in summary:
        print(" ", line)
    if errors:
        print("ERRORS/MISSES")
        for e in errors:
            print(" ", e)


if __name__ == "__main__":
    main()
