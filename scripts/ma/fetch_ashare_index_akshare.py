#!/usr/bin/env python3
"""
fetch_ashare_index_akshare.py
=============================
Fetch A-share benchmark index daily close via AkShare stock_zh_index_daily().

Default symbol: sh000300 (沪深300). Set ASHARE_INDEX_AK_SYMBOL=sz399106 etc.

Usage: python fetch_ashare_index_akshare.py 2025-01-01 2026-07-13
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# AkShare sina symbol → Tushare-style ts_code label stored in DB
SYMBOL_TO_TSCODE = {
    "sh000300": "000300.SH",
    "sh000985": "000985.SH",
    "sh000001": "000001.SH",
    "sh000016": "000016.SH",
    "sh000905": "000905.SH",
    "sh000852": "000852.SH",
    "sz399106": "399106.SZ",
    "sz399107": "399107.SZ",
}


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
    return datetime.strptime(s.strip().replace("-", ""), "%Y%m%d").strftime("%Y-%m-%d")


def main() -> None:
    _load_env()

    today = datetime.today().strftime("%Y-%m-%d")
    if len(sys.argv) >= 3:
        start_date = _norm_date(sys.argv[1])
        end_date = _norm_date(sys.argv[2])
    else:
        end_date = today
        start_date = (datetime.today() - timedelta(days=90)).strftime("%Y-%m-%d")

    ak_symbol = os.environ.get("ASHARE_INDEX_AK_SYMBOL", "sh000300").strip().lower()
    ts_code = os.environ.get("ASHARE_INDEX_CODE", SYMBOL_TO_TSCODE.get(ak_symbol, "000300.SH"))

    import akshare as ak

    last_exc: Exception | None = None
    df = None
    for i in range(4):
        try:
            df = ak.stock_zh_index_daily(symbol=ak_symbol)
            break
        except Exception as exc:
            last_exc = exc
            time.sleep(2 * (i + 1))
    if df is None:
        print(json.dumps({"error": str(last_exc), "ak_symbol": ak_symbol}))
        sys.exit(1)

    rows = []
    for _, r in df.iterrows():
        d = str(r.get("date", ""))[:10]
        if not d or d < start_date or d > end_date:
            continue
        try:
            close = float(r["close"])
        except (TypeError, ValueError, KeyError):
            continue
        rows.append({"date": d, "ts_code": ts_code, "close": close, "source": "akshare"})

    print(json.dumps({
        "ak_symbol": ak_symbol,
        "ts_code": ts_code,
        "start_date": start_date,
        "end_date": end_date,
        "count": len(rows),
        "data": rows,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
