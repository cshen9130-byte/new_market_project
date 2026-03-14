#!/usr/bin/env python3
"""
backfill_from_2000.py
=====================
One-shot script to backfill ALL historical market data from 2000-01-01 to today:
  1. ETF prices        (raw_etf_daily)     via EmQuant
  2. NHCI close        (raw_nhci_daily)    via EmQuant
  3. Cluster prediction (current_market_prediction) — daily / weekly / monthly

Usage
-----
  python scripts/ma/backfill_from_2000.py           # full run
  python scripts/ma/backfill_from_2000.py --etf-only
  python scripts/ma/backfill_from_2000.py --nhci-only
  python scripts/ma/backfill_from_2000.py --predict-only
  python scripts/ma/backfill_from_2000.py --start 20100101   # custom start date

The script is safe to re-run — all inserts use ON CONFLICT DO UPDATE (upsert).
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import date, datetime
from pathlib import Path

# ── load .env / .env.local ────────────────────────────────────────────────────
def _load_env() -> None:
    candidates = [Path.cwd(), Path(__file__).resolve().parent]
    for base in candidates:
        for _ in range(4):
            for fname in (".env.local", ".env"):
                f = base / fname
                if f.is_file():
                    for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip().strip('"').strip("'")
                        if k and k not in os.environ:
                            os.environ[k] = v
            base = base.parent

_load_env()

# ── logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("backfill")

# ── import nightly_etl helpers ────────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))
from nightly_etl import (   # noqa: E402
    get_conn,
    step_etf_backfill,
    step_nhci,
    step_predict_market_cluster,
    iso,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill market data from a given start date.")
    parser.add_argument("--start",        default="20000101",
                        help="Start date YYYYMMDD (default: 20000101)")
    parser.add_argument("--etf-only",     action="store_true")
    parser.add_argument("--nhci-only",    action="store_true")
    parser.add_argument("--predict-only", action="store_true")
    args = parser.parse_args()

    start = datetime.strptime(args.start.replace("-", ""), "%Y%m%d").date()
    today = date.today()

    run_etf     = not (args.nhci_only or args.predict_only)
    run_nhci    = not (args.etf_only  or args.predict_only)
    run_predict = not (args.etf_only  or args.nhci_only)

    log.info("=== Backfill %s → %s ===", iso(start), iso(today))

    conn = get_conn()
    try:
        # ── 1. ETF prices ─────────────────────────────────────────────────────
        if run_etf:
            log.info("Step 1/3 — ETF prices (%s → %s) …", iso(start), iso(today))
            n = step_etf_backfill(conn, start, today)
            log.info("  ETF upserted %d rows.", n)

        # ── 2. NHCI ───────────────────────────────────────────────────────────
        if run_nhci:
            log.info("Step 2/3 — NHCI (%s → %s) …", iso(start), iso(today))
            n = step_nhci(conn, force=True, start=start)
            log.info("  NHCI upserted %d rows.", n)

        # ── 3. Cluster prediction — all three frequencies ─────────────────────
        if run_predict:
            for freq in ("daily", "weekly", "monthly"):
                log.info("Step 3/3 — Predict %s (all dates) …", freq)
                n = step_predict_market_cluster(conn, trade_date=None, freq=freq, force=True)
                log.info("  %s prediction: %d rows written.", freq, n)

    finally:
        conn.close()

    log.info("=== Backfill complete ===")


if __name__ == "__main__":
    main()
