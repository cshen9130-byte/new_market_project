#!/usr/bin/env python3
"""
fetch_commodity_option_iv_daily.py
=================================
Fetch China commodity option series / ATM IV and emit JSON for nightly ETL.

Usage
-----
  python fetch_commodity_option_iv_daily.py
  python fetch_commodity_option_iv_daily.py --days 60
  python fetch_commodity_option_iv_daily.py --keys cu,al,rb
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

_OPTION_IV_DIR = Path(__file__).resolve().parent / "option_iv"
if str(_OPTION_IV_DIR) not in sys.path:
    sys.path.insert(0, str(_OPTION_IV_DIR))

from commodity_config import COMMODITY_UNDERLYINGS, UNDERLYINGS  # noqa: E402
from commodity_fetch import (  # noqa: E402
    HISTORY_DAYS,
    build_summary_rows,
    build_underlying_payload,
    fetch_iv_history,
)


def _default_end() -> date:
    today = date.today()
    wd = today.weekday()
    if wd == 0:
        return today - timedelta(days=3)
    if wd == 5:
        return today - timedelta(days=1)
    if wd == 6:
        return today - timedelta(days=2)
    return today - timedelta(days=1)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch commodity option IV")
    parser.add_argument("--days", type=int, default=HISTORY_DAYS, help="History window (trading days)")
    parser.add_argument("--keys", type=str, default="", help="Comma-separated underlying keys")
    args = parser.parse_args()

    keys = [k.strip() for k in args.keys.split(",") if k.strip()] or list(COMMODITY_UNDERLYINGS)
    end = _default_end()

    underlyings: dict[str, dict] = {}
    iv_rows: list[dict] = []

    for key in keys:
        cfg = UNDERLYINGS.get(key)
        if not cfg:
            print(f"  skip unknown key {key}", file=sys.stderr)
            continue
        print(f"Processing {cfg.label} ({key}, {cfg.exchange})…", file=sys.stderr)
        try:
            history, term, hist_df = fetch_iv_history(cfg, end, days=args.days)
        except Exception as exc:  # noqa: BLE001
            print(f"  FAILED {key}: {exc}", file=sys.stderr)
            continue
        if not history:
            print(f"  no data for {key}", file=sys.stderr)
            continue
        payload = build_underlying_payload(cfg, history, term, hist_df=hist_df)
        if not payload:
            continue
        underlyings[key] = payload
        for h in history:
            iv_rows.append({
                "underlying_key": key,
                "trade_date": h["trade_date"],
                "iv": h["iv"],
            })
        print(
            f"  ok: {len(history)} days, IV={payload['current_iv']:.2f}%, "
            f"pct={payload.get('percentile_all')}",
            file=sys.stderr,
        )

    trade_dates = [r["trade_date"] for r in iv_rows if r.get("trade_date")]
    trade_date = max(trade_dates) if trade_dates else end.isoformat()

    out = {
        "trade_date": trade_date,
        "underlying_count": len(underlyings),
        "underlyings": underlyings,
        "summary": build_summary_rows(underlyings),
        "iv_rows": iv_rows,
    }
    # ensure_ascii=True keeps Windows pipe decoding safe for nightly_etl JSON capture
    json.dump(out, sys.stdout, ensure_ascii=True)
    print(file=sys.stdout)
    return 0 if underlyings else 1


if __name__ == "__main__":
    raise SystemExit(main())
