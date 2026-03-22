#!/usr/bin/env python3
"""
fetch_akshare_futures_daily.py — Fetch Chinese futures daily OHLCV via AkShare/Sina
======================================================================================
Fetches OHLCV + settlement for 87 continuous main-contract codes using
ak.futures_zh_daily_sina(), filters to the requested date range, and prints
a single JSON object to stdout for nightly_etl.py to parse and upsert.

Usage
-----
  python fetch_akshare_futures_daily.py 2025-01-01 2025-03-22   # date range
  python fetch_akshare_futures_daily.py 2025-03-22              # single date

Output JSON schema
------------------
{
  "start_date": "YYYY-MM-DD",
  "end_date":   "YYYY-MM-DD",
  "count":      <int>,
  "data": [
    {
      "date":       "YYYY-MM-DD",
      "code":       "AU0.SHF",
      "open":       ...,
      "close":      ...,
      "high":       ...,
      "low":        ...,
      "pct_change": ...,
      "volume":     ...,
      "clear":      ...
    },
    ...
  ]
}
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from typing import Tuple

import pandas as pd

try:
    import akshare as ak
except ImportError:
    print(json.dumps({"error": "akshare not installed. Run: pip install akshare"}))
    sys.exit(1)

try:
    from tqdm import tqdm as _tqdm

    def tqdm(iterable, **kwargs):
        return _tqdm(iterable, file=sys.stderr, **kwargs)

except ImportError:
    # Minimal fallback — writes plain progress lines to stderr
    def tqdm(iterable, desc="", ncols=None, **kwargs):  # type: ignore[misc]
        items = list(iterable)
        total = len(items)
        for i, item in enumerate(items, 1):
            print(f"\r{desc}: {i}/{total}", end="", flush=True, file=sys.stderr)
            yield item
        print(file=sys.stderr)


# ── Full continuous main-contract code list ───────────────────────────────────
CODES = (
    "A0.DCE,AD0.SHF,AG0.SHF,AL0.SHF,AO0.SHF,AP0.CZC,AU0.SHF,B0.DCE,BB0.DCE,BCM.INE,BR0.SHF,BU0.SHF,BZ0.DCE,"
    "C0.DCE,CF0.CZC,CJ0.CZC,CS0.DCE,CU0.SHF,CY0.CZC,EB0.DCE,ECM.INE,EG0.DCE,FB0.DCE,FG0.CZC,FU0.SHF,HC0.SHF,"
    "I0.DCE,J0.DCE,JD0.DCE,JM0.DCE,JR0.CZC,L0.DCE,LCM.GFE,LF0.DCE,LG0.DCE,LH0.DCE,LR0.CZC,LUM.INE,M0.DCE,"
    "MA0.CZC,NI0.SHF,NRM.INE,OI0.CZC,OP0.SHF,P0.DCE,PB0.SHF,PDM.GFE,PF0.CZC,PG0.DCE,PK0.CZC,PL0.CZC,PM0.CZC,"
    "PP0.DCE,PPF0.DCE,PR0.CZC,PSM.GFE,PTM.GFE,PX0.CZC,RB0.SHF,RI0.CZC,RM0.CZC,RR0.DCE,RS0.CZC,RU0.SHF,SA0.CZC,"
    "SCM.INE,SF0.CZC,SH0.CZC,SIM.GFE,SM0.CZC,SN0.SHF,SP0.SHF,SR0.CZC,SS0.SHF,TA0.CZC,UR0.CZC,V0.DCE,VF0.DCE,"
    "WH0.CZC,WR0.SHF,Y0.DCE,ZC0.CZC,ZN0.SHF,IC0.CFE,IF0.CFE,IH0.CFE,IM0.CFE,T0.CFE,TF0.CFE,TL0.CFE,TS0.CFE"
)


def parse_code(code_exch: str) -> Tuple[str, str, str]:
    """Split 'CODE.EXCH' → (code_label, ak_symbol, exchange).

    AkShare uses the raw symbol without exchange suffix.
    Codes ending in 'M' (INE/GFE continuous) are converted to '0':
      e.g. 'BCM.INE' → ak_symbol='BC0', 'SCM.INE' → 'SC0'
    """
    parts = code_exch.strip().split(".")
    if len(parts) != 2:
        raise ValueError(f"Invalid code format: {code_exch!r}")
    raw_code, exch = parts
    ak_symbol = raw_code[:-1] + "0" if raw_code.endswith("M") else raw_code
    return code_exch, ak_symbol, exch


def fetch_symbol(ak_symbol: str, start_date: str, end_date: str) -> list[dict]:
    """Fetch full history for one symbol, filter to [start_date, end_date].

    pct_change is computed on the full (unsliced) series so that the first
    row after the cutoff date has a correct pct_change value.
    """
    df = ak.futures_zh_daily_sina(symbol=ak_symbol)
    if df is None or df.empty:
        return []

    df = df.copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce")

    # Compute pct_change on the full series BEFORE date-slicing
    pct = df["close"].pct_change() * 100.0
    df["_pct_change"] = pct.fillna(0.0)

    mask = (
        (df["date"] >= pd.to_datetime(start_date))
        & (df["date"] <= pd.to_datetime(end_date))
    )
    df = df.loc[mask].sort_values("date")
    if df.empty:
        return []

    rows: list[dict] = []
    for _, row in df.iterrows():
        def _f(col: str):
            v = row.get(col)
            return float(v) if v is not None and pd.notna(v) else None

        rows.append({
            "date":       row["date"].strftime("%Y-%m-%d"),
            "open":       _f("open"),
            "close":      _f("close"),
            "high":       _f("high"),
            "low":        _f("low"),
            "pct_change": round(float(row["_pct_change"]), 4),
            "volume":     _f("volume"),
            "clear":      _f("settle"),   # AkShare column: 'settle'
        })
    return rows


def main() -> None:
    args = sys.argv[1:]
    today_iso = datetime.today().strftime("%Y-%m-%d")

    if len(args) == 0:
        start_date = end_date = today_iso
    elif len(args) == 1:
        start_date = end_date = args[0]
    else:
        start_date, end_date = args[0], args[1]

    codes = [s.strip() for s in CODES.split(",") if s.strip()]
    all_rows: list[dict] = []
    warn_codes: list[str] = []

    for code_exch in tqdm(codes, desc="AkShare futures", ncols=80):
        try:
            code_label, ak_symbol, _exch = parse_code(code_exch)
            rows = fetch_symbol(ak_symbol, start_date, end_date)
            if not rows:
                print(f"[Warn] {code_label}: no data in {start_date}..{end_date}",
                      file=sys.stderr)
                continue
            for r in rows:
                r["code"] = code_label
            all_rows.extend(rows)
        except Exception as exc:
            warn_codes.append(code_exch)
            print(f"[Error] {code_exch}: {exc}", file=sys.stderr)

    if warn_codes:
        print(f"[Warn] {len(warn_codes)} code(s) failed: {', '.join(warn_codes)}",
              file=sys.stderr)

    # Output JSON to stdout for nightly_etl.py
    print(json.dumps({
        "start_date": start_date,
        "end_date":   end_date,
        "count":      len(all_rows),
        "data":       all_rows,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
