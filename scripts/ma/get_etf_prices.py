#!/usr/bin/env python3
"""
get_etf_prices.py — Fetch daily ETF ORIGINALUNIT prices via EmQuant / Choice API
==================================================================================
Fetches ORIGINALUNIT (adjusted net asset value) for the 6 ETFs used by the
market-prediction model and prints a single JSON object to stdout so that
nightly_etl.py can parse and upsert the records.

Usage
-----
  python get_etf_prices.py                        # yesterday (default)
  python get_etf_prices.py 20260312               # single date
  python get_etf_prices.py 20250313 20260313      # date range (backfill)

Environment (loaded from .env / .env.local automatically)
----------------------------------------------------------
  EMQ_USERNAME  / EMQ_PASSWORD  — Choice / EmQuant credentials
                                  (fall back to hard-coded defaults if absent)

Output JSON schema
------------------
{
  "start_date": "YYYY-MM-DD",
  "end_date":   "YYYY-MM-DD",
  "count":      <int>,
  "data": [
    { "date": "YYYY-MM-DD", "ticker": "510300.SH", "field": "ORIGINALUNIT", "value": 3.456 },
    ...
  ]
}
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# ── ensure UTF-8 stdout/stderr on Windows ────────────────────────────────────
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


# ── load .env / .env.local ────────────────────────────────────────────────────
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

# ── constants ─────────────────────────────────────────────────────────────────

# Column order MUST match the training data used for scaler / PCA / GMM.
ETF_TICKERS = [
    "510300.SH",  # 沪深300 ETF
    "510500.SH",  # 中证500 ETF
    "511010.SH",  # 国债 ETF
    "511220.SH",  # 公司债 ETF
    "511880.SH",  # 货币基金 ETF
    "518880.SH",  # 黄金 ETF
]


# ── helpers ───────────────────────────────────────────────────────────────────

def _parse_date(s: str) -> date:
    s = s.replace("-", "").strip()
    return datetime.strptime(s, "%Y%m%d").date()


def _fmt_iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def _fmt_date(v: object) -> str:
    if isinstance(v, (date, datetime)):
        return v.strftime("%Y-%m-%d")
    return str(v)[:10]


def _to_float(v: object) -> float | None:
    try:
        return float(v) if v is not None else None  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def extract_series(csd_result: object) -> tuple[list, list]:
    """Extract parallel date / value lists from an EmQuant c.csd() result."""
    dates = list(getattr(csd_result, "Dates", []) or [])
    raw_data = getattr(csd_result, "Data", None)

    values: list = []
    if isinstance(raw_data, list):
        if len(raw_data) == 1 and isinstance(raw_data[0], (list, tuple)):
            values = list(raw_data[0])
        else:
            values = list(raw_data)
    elif isinstance(raw_data, dict):
        first = next(iter(raw_data.values()), [])
        if isinstance(first, (list, tuple)):
            values = list(first[0]) if (
                len(first) == 1 and isinstance(first[0], (list, tuple))
            ) else list(first)
        else:
            values = [first]

    if len(dates) != len(values):
        raise ValueError(
            f"Date/value length mismatch: {len(dates)} dates vs {len(values)} values"
        )
    return dates, values


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    args = sys.argv[1:]
    today = date.today()

    if len(args) == 0:
        start_dt = today - timedelta(days=1)
        end_dt = start_dt
    elif len(args) == 1:
        start_dt = _parse_date(args[0])
        end_dt = start_dt
    else:
        start_dt = _parse_date(args[0])
        end_dt = _parse_date(args[1])

    username = os.environ.get("EMQ_USERNAME", "bflzg0006")
    password = os.environ.get("EMQ_PASSWORD", "")

    try:
        from EmQuantAPI import c  # type: ignore[import-untyped]
    except ImportError:
        print(json.dumps({"error": "EmQuantAPI not installed. Run: pip install emquantapi"}))
        sys.exit(1)

    options = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0"
    login_result = c.start(options)
    if login_result.ErrorCode != 0:
        print(json.dumps({"error": f"EmQuant login failed: {login_result.ErrorMsg}"}))
        sys.exit(1)

    start_str = _fmt_iso(start_dt)
    end_str = _fmt_iso(end_dt)
    records = []

    try:
        for ticker in ETF_TICKERS:
            try:
                data = c.csd(
                    ticker,
                    "ORIGINALUNIT",
                    start_str,
                    end_str,
                    "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH",
                )
                if data.ErrorCode != 0:
                    sys.stderr.write(
                        f"[{ticker}] API error ({data.ErrorCode}): {data.ErrorMsg}\n"
                    )
                    continue
                dates, values = extract_series(data)
                for dt, val in zip(dates, values):
                    v = _to_float(val)
                    if v is not None:
                        records.append({
                            "date":   _fmt_date(dt),
                            "ticker": ticker,
                            "field":  "ORIGINALUNIT",
                            "value":  v,
                        })
            except Exception as exc:
                sys.stderr.write(f"[{ticker}] Exception: {exc}\n")
    finally:
        try:
            c.stop()
        except Exception:
            pass

    print(json.dumps({
        "start_date": start_str,
        "end_date":   end_str,
        "count":      len(records),
        "data":       records,
    }))


if __name__ == "__main__":
    main()
