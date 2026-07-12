#!/usr/bin/env python3
"""
fetch_afre_monthly.py — Fetch 社融存量同比 (AFRE) via Choice EmQuant EDB
=======================================================================
Writes china_afre_stock_yoy_monthly.csv for regime similarity + money-credit
charts, then prints JSON for nightly_etl.py.

Usage
-----
  python scripts/ma/fetch_afre_monthly.py

Environment
-----------
  EMQ_USERNAME / EMQ_PASSWORD  — Choice / EmQuant credentials
"""

from __future__ import annotations

import csv
import json
import os
import sys
from datetime import date
from pathlib import Path

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def _load_env() -> None:
    candidates = [
        Path.cwd(),
        Path(__file__).resolve().parent,
        Path(__file__).resolve().parent.parent,
        Path(__file__).resolve().parent.parent.parent,
    ]
    for base in candidates:
        for fname in (".env.local", ".env"):
            f = base / fname
            if not f.is_file():
                continue
            try:
                for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
            except Exception:
                pass


_load_env()

AFRE_CODE = "EMM00191807"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_PATHS = [
    PROJECT_ROOT / "similar_regime" / "data" / "china_afre_stock_yoy_monthly.csv",
    PROJECT_ROOT / "money_credit" / "data" / "china_afre_stock_yoy_monthly.csv",
]


def _to_text(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)


def _extract_rows(edb_result) -> list[list[str]]:
    codes = getattr(edb_result, "Codes", []) or []
    dates = getattr(edb_result, "Dates", []) or []
    data_map = getattr(edb_result, "Data", {}) or {}

    rows: list[list[str]] = []
    for code in codes:
        series = data_map.get(code, []) or []
        if len(series) == 1 and isinstance(series[0], (list, tuple)):
            series = series[0]
        row_count = min(len(dates), len(series))
        for i in range(row_count):
            rows.append([_to_text(dates[i]), code, _to_text(series[i])])
    return rows


def main() -> None:
    username = os.environ.get("EMQ_USERNAME", "")
    password = os.environ.get("EMQ_PASSWORD", "")
    if not username or not password:
        print(json.dumps({"error": "Missing EMQ_USERNAME/EMQ_PASSWORD in environment"}))
        sys.exit(1)

    try:
        from EmQuantAPI import c  # type: ignore
    except ImportError:
        print(json.dumps({"error": "EmQuantAPI not installed / not on PYTHONPATH"}))
        sys.exit(1)

    options = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0"
    login_result = c.start(options)
    if getattr(login_result, "ErrorCode", 0) != 0:
        print(json.dumps({"error": f"EmQuant login failed: {getattr(login_result, 'ErrorMsg', login_result)}"}))
        sys.exit(1)

    try:
        today_str = date.today().strftime("%Y-%m-%d")
        data = c.edb(AFRE_CODE, f"IsLatest=0,StartDate=2000-01-01,EndDate={today_str}")
        if getattr(data, "ErrorCode", 0) != 0:
            print(json.dumps({"error": f"AFRE edb failed: {getattr(data, 'ErrorMsg', data)}"}))
            sys.exit(1)

        rows = _extract_rows(data)
        if not rows:
            print(json.dumps({"error": "AFRE edb returned no rows"}))
            sys.exit(1)

        written = []
        for path in OUTPUT_PATHS:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("w", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                writer.writerow(["date", "code", "value"])
                writer.writerows(rows)
            written.append(str(path))

        latest = max((r[0] for r in rows if r[0]), default=None)
        print(json.dumps({
            "status": "ok",
            "count": len(rows),
            "latest": latest,
            "files": written,
        }))
    finally:
        try:
            c.stop()
        except Exception:
            pass


if __name__ == "__main__":
    main()
