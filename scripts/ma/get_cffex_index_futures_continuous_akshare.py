#!/usr/bin/env python3
"""
Synthesize CFFEX index-futures continuous legs L/L1/L2/L3 via AkShare.

Tushare fut_daily (IFL.CFX / IFL1.CFX / …) requires paid permissions that can
lapse.  This script rebuilds the same four-leg series from exchange month
contracts using CFFEX listing rules:

  L  = current month
  L1 = next month
  L2 = next quarter-end month
  L3 = quarter-end month after that

Settlement: Sina often leaves settle=0; we use settle when > 0 else close.

Output JSON matches get_cffex_index_futures_continuous_range.py so nightly_etl
can reuse step_futures_range_backfill upsert logic.

Usage
-----
  python get_cffex_index_futures_continuous_akshare.py 20260401 20260730
  python get_cffex_index_futures_continuous_akshare.py          # 2023-01-01 → today
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

try:
    import akshare as ak
except ImportError:
    print(json.dumps({"error": "akshare not installed. Run: pip install akshare"}))
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    print(json.dumps({"error": "pandas not installed"}))
    sys.exit(1)


BASES = ("IH", "IF", "IC", "IM")
LEGS = ("L", "L1", "L2", "L3")


def _parse_ymd(s: str) -> date:
    s = s.strip().replace("-", "")
    return datetime.strptime(s, "%Y%m%d").date()


def third_friday(year: int, month: int) -> date:
    first = date(year, month, 1)
    first_friday = 1 + (4 - first.weekday()) % 7
    return date(year, month, first_friday + 14)


def listed_yms(as_of: date) -> List[Tuple[int, int]]:
    """CFFEX stock-index futures: near, next, and next two quarter months."""
    y, m = as_of.year, as_of.month
    if as_of > third_friday(y, m):
        m += 1
        if m > 12:
            m, y = 1, y + 1
    near = (y, m)
    y2, m2 = y, m + 1
    if m2 > 12:
        m2, y2 = 1, y2 + 1
    nxt = (y2, m2)
    quarterly: List[Tuple[int, int]] = []
    yy, mm = y2, m2
    while len(quarterly) < 2:
        mm += 1
        if mm > 12:
            mm, yy = 1, yy + 1
        if mm in (3, 6, 9, 12):
            quarterly.append((yy, mm))
    return [near, nxt, quarterly[0], quarterly[1]]


def ym_code(y: int, m: int) -> str:
    return f"{y % 100:02d}{m:02d}"


def _safe_float(v) -> Optional[float]:
    try:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        f = float(v)
        return f if f == f else None
    except Exception:
        return None


def fetch_month_history(base: str, y: int, m: int) -> Dict[str, dict]:
    """Return {YYYYMMDD: {close, settle}} for one month contract."""
    sym = f"{base}{ym_code(y, m)}"
    try:
        df = ak.futures_zh_daily_sina(symbol=sym)
    except Exception:
        return {}
    if df is None or getattr(df, "empty", True):
        return {}
    out: Dict[str, dict] = {}
    for _, row in df.iterrows():
        td = str(row.get("date", "")).replace("-", "")[:8]
        if len(td) != 8:
            continue
        close = _safe_float(row.get("close"))
        settle = _safe_float(row.get("settle"))
        if settle is None or settle == 0:
            settle = close
        if close is None and settle is None:
            continue
        out[td] = {"close": close, "settle": settle}
    return out


def needed_contracts(start: date, end: date) -> Dict[str, List[Tuple[int, int]]]:
    """Collect every (y,m) that appears as a listed leg in [start, end]."""
    needed: Dict[str, set] = {b: set() for b in BASES}
    d = start
    while d <= end:
        if d.weekday() < 5:
            for ym in listed_yms(d):
                for b in BASES:
                    needed[b].add(ym)
        d += timedelta(days=1)
    return {b: sorted(v) for b, v in needed.items()}


def build_series(start: date, end: date) -> dict:
    contracts = needed_contracts(start, end)
    # Cache month histories: base -> (y,m) -> {ymd: prices}
    cache: Dict[str, Dict[Tuple[int, int], Dict[str, dict]]] = {b: {} for b in BASES}
    for base, yms in contracts.items():
        for ym in yms:
            cache[base][ym] = fetch_month_history(base, *ym)

    data: Dict[str, Dict[str, list]] = {b: {leg: [] for leg in LEGS} for b in BASES}
    d = start
    while d <= end:
        if d.weekday() < 5:
            ymd = d.strftime("%Y%m%d")
            yms = listed_yms(d)
            for base in BASES:
                for leg, ym in zip(LEGS, yms):
                    prices = cache[base].get(ym, {}).get(ymd)
                    if not prices:
                        continue
                    data[base][leg].append(
                        {
                            "trade_date": ymd,
                            "close": prices.get("close"),
                            "settle": prices.get("settle"),
                        }
                    )
        d += timedelta(days=1)
    return data


def main() -> None:
    start = date(2023, 1, 1)
    end = date.today()
    if len(sys.argv) >= 3:
        start = _parse_ymd(sys.argv[1])
        end = _parse_ymd(sys.argv[2])
    elif len(sys.argv) == 2:
        start = end = _parse_ymd(sys.argv[1])

    data = build_series(start, end)
    counts = {
        f"{b}/{leg}": len(data[b][leg]) for b in BASES for leg in LEGS
    }
    payload = {
        "start_date": start.strftime("%Y%m%d"),
        "end_date": end.strftime("%Y%m%d"),
        "source": "akshare_sina_month_synth",
        "counts": counts,
        "data": data,
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
