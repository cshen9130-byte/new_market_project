#!/usr/bin/env python3
"""
fetch_ashare_index.py
=====================
Fetch A-share benchmark index daily close via Choice / EmQuant c.csd().

Default: 000985.SH (中证全指) as the 全A proxy for crowding charts.

Usage
-----
  python fetch_ashare_index.py
  python fetch_ashare_index.py 2025-01-01 2026-07-13
  python fetch_ashare_index.py 2025-01-01 2026-07-13 000985.SH

Environment
-----------
  EMQ_USERNAME / EMQ_PASSWORD
  ASHARE_INDEX_CODE — default 000985.SH
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

DEFAULT_CODE = os.environ.get("ASHARE_INDEX_CODE", "000985.SH")
CSD_OPTS = "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH"


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


def log_callback(_msg):
    return 0


def normalize_csd(data_obj):
    result = []
    try:
        dates = getattr(data_obj, "Dates", None) or getattr(data_obj, "Times", None)
        dd = getattr(data_obj, "Data", None) or getattr(data_obj, "Values", None)
        values = None
        if dd is not None:
            if isinstance(dd, dict):
                values = dd.get("CLOSE")
                if values is None and dd:
                    values = next(iter(dd.values()))
            elif isinstance(dd, (list, tuple)):
                values = dd[0] if dd else []
            else:
                values = dd
        if not dates or values is None:
            return result
        dates = list(dates)
        values = list(values)
        if isinstance(values[0], (list, tuple)):
            values = values[0]
        if len(dates) != len(values):
            return result
        for d, v in zip(dates, values):
            ds = d if isinstance(d, str) else d.strftime("%Y-%m-%d")
            if isinstance(ds, str) and "/" in ds:
                ds = datetime.strptime(ds, "%Y/%m/%d").strftime("%Y-%m-%d")
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            result.append({"date": ds, "close": fv})
    except Exception:
        pass
    return result


def main() -> None:
    _load_env()

    end_date = datetime.today().strftime("%Y-%m-%d")
    start_date = (datetime.today() - timedelta(days=90)).strftime("%Y-%m-%d")
    code = DEFAULT_CODE

    if len(sys.argv) >= 3:
        start_date = sys.argv[1]
        end_date = sys.argv[2]
    if len(sys.argv) >= 4:
        code = sys.argv[3]

    try:
        import EmQuantAPI as Emq  # type: ignore
        c = Emq.c
    except Exception as e:
        print(json.dumps({"error": f"EmQuantAPI import failed: {e}"}))
        sys.exit(1)

    username = os.environ.get("EMQ_USERNAME")
    password = os.environ.get("EMQ_PASSWORD")
    if not username or not password:
        print(json.dumps({"error": "Missing EMQ_USERNAME/EMQ_PASSWORD"}))
        sys.exit(2)

    login = c.start(f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0", log_callback, None)
    if login.ErrorCode != 0:
        print(json.dumps({"error": f"login failed: {getattr(login, 'ErrorMsg', 'unknown')}"}))
        sys.exit(3)

    out = {
        "ts_code": code,
        "start_date": start_date,
        "end_date": end_date,
        "count": 0,
        "data": [],
    }
    try:
        data = c.csd(code, "CLOSE", start_date, end_date, CSD_OPTS)
        if getattr(data, "ErrorCode", 0) != 0:
            print(json.dumps({
                "error": f"csd error: {getattr(data, 'ErrorMsg', getattr(data, 'ErrorCode', 'unknown'))}",
                "ts_code": code,
            }))
            sys.exit(4)
        rows = normalize_csd(data)
        out["data"] = [{"date": r["date"], "ts_code": code, "close": r["close"]} for r in rows]
        out["count"] = len(out["data"])
    finally:
        try:
            c.stop()
        except Exception:
            pass

    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
