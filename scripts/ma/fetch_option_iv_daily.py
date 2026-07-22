#!/usr/bin/env python3
"""
fetch_option_iv_daily.py
========================
Fetch China financial option IV data (cross-section + QVIX history) and emit
JSON for nightly ETL storage.

Usage
-----
  python fetch_option_iv_daily.py

Output JSON schema
------------------
{
  "trade_date": "YYYY-MM-DD",
  "snapshot_count": <int>,
  "underlyings": { "<key>": { ... chart payload ... }, ... },
  "summary": [ { "group_label", "keys", "iv_display", "percentile", "products" }, ... ],
  "qvix_rows": [ { "underlying_key", "trade_date", "iv", "open", "high", "low" }, ... ]
}
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

# Allow imports from option_iv package
_OPTION_IV_DIR = Path(__file__).resolve().parent / "option_iv"
if str(_OPTION_IV_DIR) not in sys.path:
    sys.path.insert(0, str(_OPTION_IV_DIR))

from config import FINANCIAL_UNDERLYINGS  # noqa: E402
from iv_analysis.data import fetch_option_snapshot, fetch_option_snapshot_em, fetch_qvix_history  # noqa: E402
from serialize import build_summary_rows, build_underlying_payload  # noqa: E402


def _qvix_rows(key: str, qvix) -> list[dict]:
    if qvix.empty:
        return []
    rows = []
    for r in qvix.itertuples():
        rows.append({
            "underlying_key": key,
            "trade_date": r.trade_date.strftime("%Y-%m-%d")
            if hasattr(r.trade_date, "strftime")
            else str(r.trade_date)[:10],
            "iv": float(r.iv) if r.iv == r.iv else None,
            "open": float(r.open) if hasattr(r, "open") and r.open == r.open else None,
            "high": float(r.high) if hasattr(r, "high") and r.high == r.high else None,
            "low": float(r.low) if hasattr(r, "low") and r.low == r.low else None,
        })
    return rows


def main() -> int:
    trade_date = date.today().isoformat()

    print("Fetching option snapshot...", file=sys.stderr)
    snapshot = fetch_option_snapshot()
    print(f"  Loaded {len(snapshot)} contracts", file=sys.stderr)

    em_snapshot = None
    try:
        em_snapshot = fetch_option_snapshot_em()
        print(f"  Loaded {len(em_snapshot)} East Money contracts", file=sys.stderr)
    except Exception as exc:  # noqa: BLE001
        print(f"  East Money snapshot unavailable: {exc}", file=sys.stderr)

    underlyings: dict[str, dict] = {}
    all_qvix_rows: list[dict] = []

    for key in FINANCIAL_UNDERLYINGS:
        print(f"Processing {key}...", file=sys.stderr)
        qvix = fetch_qvix_history(key)
        payload = build_underlying_payload(key, snapshot, qvix, em_snapshot)
        if payload:
            underlyings[key] = payload
        all_qvix_rows.extend(_qvix_rows(key, qvix))

    summary = build_summary_rows(underlyings)

    out = {
        "trade_date": trade_date,
        "snapshot_count": len(snapshot),
        "underlying_count": len(underlyings),
        "underlyings": underlyings,
        "summary": summary,
        "qvix_rows": all_qvix_rows,
    }

    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
