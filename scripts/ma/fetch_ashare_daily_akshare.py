#!/usr/bin/env python3
"""
fetch_ashare_daily_akshare.py
=============================
Fetch A-share daily OHLCV + amount + turnover via AkShare (free, no Choice quota).

Modes (ASHARE_AK_MODE env):
  spot  — one call to stock_zh_a_spot_em() for the latest session (fast nightly)
  hist  — per-stock stock_zh_a_hist() over a date range (slower backfill)

Usage
-----
  python fetch_ashare_daily_akshare.py 2026-07-10 2026-07-13
  ASHARE_AK_MODE=spot python fetch_ashare_daily_akshare.py 2026-07-13 2026-07-13

Output JSON: { start_date, end_date, mode, count, data: [{date, ts_code, open, ...}] }
"""

from __future__ import annotations

import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
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


def _norm_date(s: str) -> str:
    s = s.strip().replace("-", "")
    return datetime.strptime(s, "%Y%m%d").strftime("%Y-%m-%d")


def _to_yyyymmdd(s: str) -> str:
    return s.replace("-", "")


def _to_ts_code(code: str) -> str:
    c = str(code).strip().zfill(6)
    if c.startswith("92") or c.startswith(("83", "87", "43", "82", "88")):
        return f"{c}.BJ"
    if c.startswith("6"):
        return f"{c}.SH"
    return f"{c}.SZ"


def _retry(fn, *, attempts: int = 4, base_sleep: float = 2.0):
    last_exc: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if i < attempts - 1:
                time.sleep(base_sleep * (i + 1))
    raise last_exc  # type: ignore[misc]


def _fetch_universe() -> list[str]:
    import akshare as ak

    df = _retry(lambda: ak.stock_info_a_code_name())
    return [str(c).zfill(6) for c in df["code"].tolist()]


def _rows_from_spot(trade_date: str) -> list[dict]:
    import akshare as ak

    df = _retry(lambda: ak.stock_zh_a_spot_em())
    col = {c: c for c in df.columns}
    # AkShare Chinese column names (stable in recent versions)
    code_col = "代码"
    for need in (code_col, "最新价", "今开", "最高", "最低", "成交量", "成交额", "换手率"):
        if need not in df.columns:
            raise ValueError(f"spot_em missing column {need}; got {list(df.columns)}")

    rows: list[dict] = []
    for _, r in df.iterrows():
        code = str(r[code_col]).strip().zfill(6)
        close = r.get("最新价")
        if close is None:
            continue
        try:
            close_f = float(close)
        except (TypeError, ValueError):
            continue
        if close_f <= 0:
            continue

        def fval(key: str):
            v = r.get(key)
            if v is None or v == "" or v == "-":
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        vol = fval("成交量")
        rows.append({
            "date": trade_date,
            "ts_code": _to_ts_code(code),
            "open": fval("今开"),
            "close": close_f,
            "high": fval("最高"),
            "low": fval("最低"),
            "volume": int(vol) if vol is not None else None,
            "amount": fval("成交额"),
            "turn": fval("换手率"),
            "source": "akshare_spot",
        })
    return rows


def _rows_from_hist(code: str, start: str, end: str) -> list[dict]:
    import akshare as ak

    df = _retry(
        lambda: ak.stock_zh_a_hist(
            symbol=code,
            period="daily",
            start_date=_to_yyyymmdd(start),
            end_date=_to_yyyymmdd(end),
            adjust="",
        ),
        attempts=3,
        base_sleep=1.5,
    )
    if df is None or df.empty:
        return []

    rows: list[dict] = []
    for _, r in df.iterrows():
        d = str(r.get("日期", ""))[:10]
        if not d:
            continue
        close = r.get("收盘")
        try:
            close_f = float(close)
        except (TypeError, ValueError):
            continue
        if close_f <= 0:
            continue

        def fval(key: str):
            v = r.get(key)
            if v is None or v == "" or v == "-":
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        vol = fval("成交量")
        rows.append({
            "date": d,
            "ts_code": _to_ts_code(code),
            "open": fval("开盘"),
            "close": close_f,
            "high": fval("最高"),
            "low": fval("最低"),
            "volume": int(vol) if vol is not None else None,
            "amount": fval("成交额"),
            "turn": fval("换手率"),
            "source": "akshare_hist",
        })
    return rows


def _fetch_hist_range(start: str, end: str) -> list[dict]:
    codes = _fetch_universe()
    max_workers = int(os.environ.get("ASHARE_AK_MAX_WORKERS", "8"))
    delay = float(os.environ.get("ASHARE_AK_DELAY", "0.05"))
    limit = int(os.environ.get("ASHARE_AK_CODE_LIMIT", "0"))
    if limit > 0:
        codes = codes[:limit]

    sys.stderr.write(f"akshare hist: {len(codes)} codes, {start} → {end}, workers={max_workers}\n")
    all_rows: list[dict] = []
    done = 0
    errors = 0

    def task(code: str) -> list[dict]:
        if delay > 0:
            time.sleep(delay)
        return _rows_from_hist(code, start, end)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(task, code): code for code in codes}
        for fut in as_completed(futures):
            code = futures[fut]
            try:
                rows = fut.result()
                all_rows.extend(rows)
            except Exception as exc:
                errors += 1
                if errors <= 5:
                    sys.stderr.write(f"  {code} failed: {exc}\n")
            done += 1
            if done % 500 == 0:
                sys.stderr.write(f"  progress {done}/{len(codes)} codes, {len(all_rows)} rows\n")

    sys.stderr.write(f"akshare hist done: {len(all_rows)} rows, {errors} errors\n")
    return all_rows


def main() -> None:
    _load_env()

    today = datetime.today().strftime("%Y-%m-%d")
    argv = sys.argv[1:]
    if len(argv) >= 2:
        start_date = _norm_date(argv[0])
        end_date = _norm_date(argv[1])
    else:
        end_date = today
        start_date = (datetime.today() - timedelta(days=7)).strftime("%Y-%m-%d")

    mode = os.environ.get("ASHARE_AK_MODE", "").strip().lower()
    if not mode:
        # Single-day incremental → spot; multi-day backfill → hist
        mode = "spot" if start_date == end_date else "hist"

    try:
        if mode == "spot":
            rows = _rows_from_spot(end_date)
        else:
            rows = _fetch_hist_range(start_date, end_date)
    except Exception as exc:
        print(json.dumps({"error": str(exc), "mode": mode, "start_date": start_date, "end_date": end_date}))
        sys.exit(1)

    out = {
        "start_date": start_date,
        "end_date": end_date,
        "mode": mode,
        "count": len(rows),
        "data": rows,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
