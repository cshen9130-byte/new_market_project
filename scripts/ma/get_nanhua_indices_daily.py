#!/usr/bin/env python3
"""
get_nanhua_indices_daily.py — Fetch daily OHLCV data for 17 南华 indices via EmQuant / Choice API
==================================================================================================
Fetches OPEN,CLOSE,HIGH,LOW,PRECLOSE,CHANGE,PCTCHANGE,VOLUME,AMOUNT,TURN,AMPLITUDE
for all 17 南华 sub-indices and prints a single JSON object to stdout so that
nightly_etl.py can parse and upsert the records.

Usage
-----
  python get_nanhua_indices_daily.py                        # yesterday (default)
  python get_nanhua_indices_daily.py 20250101               # single date
  python get_nanhua_indices_daily.py 20250101 20260321      # date range (backfill)

Environment
-----------
  EMQ_USERNAME  / EMQ_PASSWORD  — Choice / EmQuant credentials

Output JSON schema
------------------
{
  "start_date": "YYYY-MM-DD",
  "end_date":   "YYYY-MM-DD",
  "count":      <int>,
  "data": [
    {
      "date": "YYYY-MM-DD",
      "code": "NHCI.NH",
      "open": ..., "close": ..., "high": ..., "low": ...,
      "preclose": ..., "change": ..., "pct_change": ...,
      "volume": ..., "amount": ..., "turn": ..., "amplitude": ...
    },
    ...
  ]
}
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

NH_CODES = [
    "NHAECI.NH", "NHAI.NH",   "NHBMI.NH", "NHCCI.NH", "NHCI.NH",
    "NHECI.NH",  "NHEI.NH",   "NHFI.NH",  "NHFMI.NH", "NHII.NH",
    "NHMI.NH",   "NHNEI.NH",  "NHNFI.NH", "NHOOI.NH", "NHPCI.NH",
    "NHPMI.NH",  "NHQFII.NH",
]

NH_NAMES: dict[str, str] = {
    "NHAECI.NH":  "南华经济作物指数",
    "NHAI.NH":    "南华农产品指数",
    "NHBMI.NH":   "南华建材指数",
    "NHCCI.NH":   "南华煎制化工指数",
    "NHCI.NH":    "南华商品指数",
    "NHECI.NH":   "南华能化指数",
    "NHEI.NH":    "南华能源指数",
    "NHFI.NH":    "南华黑色指数",
    "NHFMI.NH":   "南华黑色原材料指数",
    "NHII.NH":    "南华工业品指数",
    "NHMI.NH":    "南华金属指数",
    "NHNEI.NH":   "南华新能源指数",
    "NHNFI.NH":   "南华有色金属指数",
    "NHOOI.NH":   "南华油脂油料指数",
    "NHPCI.NH":   "南华石油化工指数",
    "NHPMI.NH":   "南华贵金属指数",
    "NHQFII.NH":  "南华QFII商品指数",
}

FIELD_NAMES = [
    "OPEN", "CLOSE", "HIGH", "LOW", "PRECLOSE",
    "CHANGE", "PCTCHANGE", "VOLUME", "AMOUNT", "TURN", "AMPLITUDE",
]
CSD_FIELDS = ",".join(FIELD_NAMES)
CSD_OPTS   = "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH"


# ── env loader ────────────────────────────────────────────────────────────────

def _load_env_from_files():
    candidates = []
    try:
        candidates.append(Path.cwd())
    except Exception:
        pass
    try:
        script_dir = Path(__file__).resolve().parent
        candidates.extend([script_dir, script_dir.parent, script_dir.parent.parent])
    except Exception:
        pass
    for base in candidates:
        for fname in (".env", ".env.local"):
            f = base / fname
            if f.exists() and f.is_file():
                try:
                    for line in f.read_text(encoding="utf-8").splitlines():
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        key, val = line.split("=", 1)
                        key = key.strip()
                        val = val.strip().strip('"').strip("'")
                        if key and os.environ.get(key) is None:
                            os.environ[key] = val
                except Exception:
                    pass


# ── helpers ───────────────────────────────────────────────────────────────────

def _fmt(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


def _parse_date(s: str) -> str:
    s = s.strip().replace("-", "")
    return datetime.strptime(s, "%Y%m%d").strftime("%Y-%m-%d")


def _to_float(v: object) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _norm_date(d: object) -> str:
    if isinstance(d, str):
        if "/" in d:
            try:
                return datetime.strptime(d, "%Y/%m/%d").strftime("%Y-%m-%d")
            except Exception:
                pass
        return d
    return getattr(d, "strftime", lambda *_: str(d))("%Y-%m-%d")


def _flatten(series) -> list:
    """Unwrap single-element nested lists from EmQuant."""
    try:
        s = list(series)
    except Exception:
        return []
    # EmQuant sometimes returns [[values]] when result has 1 code
    if s and isinstance(s[0], (list, tuple)):
        try:
            return list(s[0])
        except Exception:
            pass
    return s


# ── response normalizer ───────────────────────────────────────────────────────

def extract_multi_field_single_code(csd_result, code: str = "") -> list[dict]:
    """
    Parse EmQuant c.csd result for a single code + multiple fields.
    Returns list of row dicts with lower-case field keys plus 'date'.
    """
    # EmQuant uses different attribute names depending on version / data type
    dates = (
        list(getattr(csd_result, "Dates",  []) or []) or
        list(getattr(csd_result, "Times",  []) or []) or
        list(getattr(csd_result, "dates",  []) or [])
    )
    if not dates:
        sys.stderr.write(
            f"[{code}] NO DATES. attrs={[a for a in dir(csd_result) if not a.startswith('_')]}\n"
        )
        return []

    DD = getattr(csd_result, "Data", None) or getattr(csd_result, "data", None)
    if DD is None:
        sys.stderr.write(f"[{code}] Data is None\n")
        return []

    # Log raw structure once for first code to aid debugging
    if code == NH_CODES[0]:
        sys.stderr.write(
            f"[{code}] Data type={type(DD).__name__}, "
            f"Indicators={getattr(csd_result,'Indicators',None)}, "
            f"Fields={getattr(csd_result,'Fields',None)}, "
            f"len(dates)={len(dates)}\n"
        )
        if isinstance(DD, dict):
            sys.stderr.write(f"[{code}] Data keys={list(DD.keys())[:5]}\n")
        elif isinstance(DD, (list, tuple)):
            sys.stderr.write(f"[{code}] Data shape: {len(DD)} series, first len={len(DD[0]) if DD else 0}\n")

    indicators = list(
        getattr(csd_result, "Indicators", None)
        or getattr(csd_result, "Fields",     None)
        or FIELD_NAMES
    )
    ind_upper = [str(i).upper() for i in indicators]

    field_series: dict[str, list] = {}

    if isinstance(DD, dict):
        # Shape A: keyed by field name → {"OPEN": [...], "CLOSE": [...]}
        # Shape B: keyed by code      → {"NHAECI.NH": [open_v, close_v, ...]} aligned to Indicators
        first_key = next(iter(DD), None)
        if first_key and first_key.upper() not in [fn.upper() for fn in FIELD_NAMES]:
            # Shape B — values are scalars or single-element lists (one date row)
            vals = DD.get(code) or DD.get(list(DD.keys())[0])
            if vals is None:
                sys.stderr.write(f"[{code}] Data keyed by code but code key missing\n")
                return []
            # vals is either a list of [field0, field1, ...] per indicator
            # or already the scalar values themselves
            if isinstance(vals, (list, tuple)):
                # Each element corresponds to one Indicator entry
                for fn in FIELD_NAMES:
                    try:
                        idx = ind_upper.index(fn)
                        v = vals[idx]
                        # wrap scalar into list aligned with dates
                        field_series[fn] = list(v) if isinstance(v, (list, tuple)) else [v] * len(dates)
                    except (ValueError, IndexError):
                        pass
            else:
                sys.stderr.write(f"[{code}] Unexpected vals type: {type(vals)}\n")
                return []
        else:
            # Shape A: keyed by field name
            for fn in FIELD_NAMES:
                s = DD.get(fn) or DD.get(fn.lower())
                if s is not None:
                    field_series[fn] = _flatten(s)
    elif isinstance(DD, (list, tuple)):
        # list of series: DD[field_index] = [values per date]
        for fn in FIELD_NAMES:
            try:
                idx = ind_upper.index(fn)
                field_series[fn] = _flatten(DD[idx])
            except (ValueError, IndexError):
                pass

    if not field_series:
        sys.stderr.write(f"[{code}] Could not extract any field series from Data\n")
        return []

    key_map = {fn: (fn.lower() if fn != "PCTCHANGE" else "pct_change") for fn in FIELD_NAMES}

    rows = []
    for i, d in enumerate(dates):
        row: dict = {"date": _norm_date(d)}
        for fn in FIELD_NAMES:
            series = field_series.get(fn, [])
            v = series[i] if i < len(series) else None
            row[key_map[fn]] = _to_float(v)
        rows.append(row)
    return rows


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    _load_env_from_files()

    today = datetime.today()
    args = sys.argv[1:]
    if args:
        start_date = _parse_date(args[0])
        end_date   = _parse_date(args[1]) if len(args) > 1 else _fmt(today)
    else:
        yesterday  = today - timedelta(days=1)
        start_date = end_date = _fmt(yesterday)

    username = os.environ.get("EMQ_USERNAME")
    password = os.environ.get("EMQ_PASSWORD")
    if not username or not password:
        print(json.dumps({"error": "Missing EMQ_USERNAME/EMQ_PASSWORD in environment"}))
        sys.exit(2)

    try:
        from EmQuantAPI import c  # type: ignore[import-untyped]
    except ImportError:
        print(json.dumps({"error": "EmQuantAPI not installed. Run: pip install emquantapi"}))
        sys.exit(1)

    options = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0"
    login = c.start(options)
    if login.ErrorCode != 0:
        print(json.dumps({"error": f"EmQuant login failed: {login.ErrorMsg}"}))
        sys.exit(1)

    records = []
    try:
        for code in NH_CODES:
            try:
                data = c.csd(code, CSD_FIELDS, start_date, end_date, CSD_OPTS)
                if data.ErrorCode != 0:
                    sys.stderr.write(
                        f"[{code}] API error ({data.ErrorCode}): {data.ErrorMsg}\n"
                    )
                    continue
                rows = extract_multi_field_single_code(data, code)
                for r in rows:
                    r["code"] = code
                    r["name"] = NH_NAMES.get(code, "")
                    records.append(r)
            except Exception as exc:
                sys.stderr.write(f"[{code}] Exception: {exc}\n")
    finally:
        try:
            c.stop()
        except Exception:
            pass

    print(json.dumps({
        "start_date": start_date,
        "end_date":   end_date,
        "count":      len(records),
        "data":       records,
    }))


if __name__ == "__main__":
    main()
