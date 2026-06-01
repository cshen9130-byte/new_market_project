#!/usr/bin/env python3
"""
private_fund_indicators_etl.py — Nightly private fund metric computation
=========================================================================
Reads all NAV data from ``private_fund_nav`` and recomputes the following
performance metrics, then writes them back into ``private_fund_info``:

  ret_1w    — total return over last 7 calendar days    (%, e.g. 2.42)
  ret_1m    — total return over last 30 calendar days   (%)
  ret_3m    — total return over last 91 calendar days   (%)
  ret_6m    — total return over last 182 calendar days  (%)
  ret_1y    — total return over last 365 calendar days  (%)
  sharpe_1y — (annualized_return − 3%) / annualized_vol over 1Y  (ratio)
  calmar_1y — annualized_return / max_drawdown          over 1Y  (ratio)

Usage
-----
  python scripts/ma/private_fund_indicators_etl.py          # run now
  python scripts/ma/private_fund_indicators_etl.py --dry-run # compute but do not write

Cron example (2:00 AM daily)
------------------------------
  0 2 * * * /root/new_market_project/.venv/bin/python3 \
      /root/new_market_project/scripts/ma/private_fund_indicators_etl.py \
      >> /var/log/private_fund_indicators_etl.log 2>&1

Notes
-----
* Returns are stored as plain percentages (7.53 means 7.53 %).
* Sharpe / Calmar are unitless ratios.
* Funds with fewer than 20 NAV data points in the look-back window get
  NULL for Sharpe / Calmar.
* Risk-free rate assumption: 3 % p.a. (Chinese money-market convention).
"""

from __future__ import annotations

import argparse
import logging
import math
import os
import sys
from datetime import date, timedelta
from pathlib import Path

# ── logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("pf_indicators")

# ── .env loader ───────────────────────────────────────────────────────────────

def _load_env_files() -> None:
    candidates = [Path(__file__).resolve().parent, Path.cwd()]
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
                        k = k.strip()
                        v = v.strip().strip('"').strip("'")
                        if k and k not in os.environ:
                            os.environ[k] = v
            base = base.parent


_load_env_files()

# ── deps ──────────────────────────────────────────────────────────────────────
try:
    import psycopg2  # type: ignore[import-untyped]
    from psycopg2.extras import execute_values  # type: ignore[import-untyped]
except ImportError:
    log.error("psycopg2 not installed.  Run: pip install psycopg2-binary")
    sys.exit(1)

try:
    import numpy as np  # type: ignore[import-untyped]
    import pandas as pd  # type: ignore[import-untyped]
except ImportError:
    log.error("pandas / numpy not installed.  Run: pip install pandas numpy")
    sys.exit(1)

# ── constants ─────────────────────────────────────────────────────────────────
RISK_FREE_RATE = 0.03        # 3 % p.a.
SQRT_252       = math.sqrt(252)
MIN_POINTS     = 20          # minimum NAV observations for Sharpe / Calmar
LOOKBACK_DAYS  = 400         # load 400 days of history (>365 + buffer for weekends)
BATCH_SIZE     = 1_000       # rows per UPDATE batch

# ── DB connection ─────────────────────────────────────────────────────────────

def get_conn():
    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", "market_data"),
        user=os.environ.get("DB_USER", "market_user"),
        password=os.environ.get("DB_PASSWORD", ""),
    )

# ── metric computation ────────────────────────────────────────────────────────

def _base_nav(gdf: "pd.DataFrame", cutoff: date) -> float | None:
    """Return the last NAV on or before *cutoff*, or None."""
    sub = gdf.loc[gdf["price_date"].dt.date <= cutoff]
    if sub.empty:
        return None
    return float(sub.iloc[-1]["nav"])


def _pct_return(latest: float, base: float | None) -> float | None:
    if base is None or base <= 0:
        return None
    return round((latest / base - 1) * 100, 4)


def compute_fund_metrics(
    gdf: "pd.DataFrame",
) -> tuple:
    """Return (ret_1w, ret_1m, ret_3m, ret_6m, ret_1y, sharpe_1y, calmar_1y)."""
    gdf = gdf.sort_values("price_date")

    # Use the fund's own latest NAV date as reference so that
    # returns are measured up to the most-recent available data point,
    # not today's calendar date (which may be days after the last NAV).
    latest_row  = gdf.iloc[-1]
    latest_nav  = float(latest_row["nav"])
    ref_date    = latest_row["price_date"].date()

    cutoff_1w   = ref_date - timedelta(days=7)
    cutoff_1m   = ref_date - timedelta(days=30)
    cutoff_3m   = ref_date - timedelta(days=91)
    cutoff_6m   = ref_date - timedelta(days=182)
    cutoff_1y   = ref_date - timedelta(days=365)

    ret_1w  = _pct_return(latest_nav, _base_nav(gdf, cutoff_1w))
    ret_1m  = _pct_return(latest_nav, _base_nav(gdf, cutoff_1m))
    ret_3m  = _pct_return(latest_nav, _base_nav(gdf, cutoff_3m))
    ret_6m  = _pct_return(latest_nav, _base_nav(gdf, cutoff_6m))

    base_1y = _base_nav(gdf, cutoff_1y)
    ret_1y  = _pct_return(latest_nav, base_1y)

    sharpe_1y: float | None = None
    calmar_1y: float | None = None

    sub_1y = gdf.loc[gdf["price_date"].dt.date >= cutoff_1y]
    if len(sub_1y) >= MIN_POINTS and ret_1y is not None:
        nav_arr    = sub_1y["nav"].to_numpy(dtype=float)
        daily_rets = np.diff(nav_arr) / nav_arr[:-1]

        if len(daily_rets) >= MIN_POINTS - 1:
            ann_vol = float(daily_rets.std()) * SQRT_252
            if ann_vol > 0:
                ann_ret    = ret_1y / 100.0
                sharpe_1y  = round((ann_ret - RISK_FREE_RATE) / ann_vol, 4)

            # Max drawdown
            rolling_max = np.maximum.accumulate(nav_arr)
            drawdowns   = (rolling_max - nav_arr) / rolling_max
            max_dd      = float(drawdowns.max())
            if max_dd > 0:
                ann_ret   = ret_1y / 100.0
                calmar_1y = round(ann_ret / max_dd, 4)

    return (ret_1w, ret_1m, ret_3m, ret_6m, ret_1y, sharpe_1y, calmar_1y)

# ── main ETL function ─────────────────────────────────────────────────────────

def run(conn, *, dry_run: bool = False) -> int:
    """Compute metrics for all funds and upsert into private_fund_info.

    Returns the number of funds processed.
    """
    today    = date.today()
    lookback = today - timedelta(days=LOOKBACK_DAYS)

    # No fixed lookback cutoff — load all history needed so that funds with
    # old latest-nav-dates (e.g. monthly reporters) still get correct 1Y metrics.
    # We keep LOOKBACK_DAYS as a safeguard only.
    log.info("Loading NAV data since %s …", lookback)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT beian_hao, price_date, nav
            FROM private_fund_nav
            WHERE price_date >= %s
              AND nav IS NOT NULL
              AND nav > 0
            ORDER BY beian_hao, price_date
            """,
            (lookback,),
        )
        rows = cur.fetchall()

    if not rows:
        log.warning("No NAV data found — aborting.")
        return 0

    df = pd.DataFrame(rows, columns=["beian_hao", "price_date", "nav"])
    df["price_date"] = pd.to_datetime(df["price_date"])
    df["nav"]        = df["nav"].astype(float)

    n_funds = df["beian_hao"].nunique()
    log.info("Loaded %d NAV rows for %d funds.", len(df), n_funds)

    # ── compute per fund ──────────────────────────────────────────────────────
    results: list[tuple] = []
    for beian_hao, gdf in df.groupby("beian_hao", sort=False):
        metrics = compute_fund_metrics(gdf)
        # tuple order: ret_1w, ret_1m, ret_3m, ret_6m, ret_1y, sharpe_1y, calmar_1y, beian_hao
        results.append((*metrics, beian_hao))

    log.info("Metrics computed for %d funds.", len(results))

    if dry_run:
        log.info("[DRY-RUN] Skipping DB write.  Sample (first 5):")
        cols = ("ret_1w", "ret_1m", "ret_3m", "ret_6m", "ret_1y", "sharpe_1y", "calmar_1y", "beian_hao")
        for row in results[:5]:
            log.info("  %s", dict(zip(cols, row)))
        return len(results)

    # ── batch upsert into private_fund_info ───────────────────────────────────
    total_updated = 0
    for batch_start in range(0, len(results), BATCH_SIZE):
        batch = results[batch_start : batch_start + BATCH_SIZE]
        with conn.cursor() as cur:
            execute_values(
                cur,
                """
                UPDATE private_fund_info AS t SET
                    ret_1w     = v.ret_1w::numeric,
                    ret_1m     = v.ret_1m::numeric,
                    ret_3m     = v.ret_3m::numeric,
                    ret_6m     = v.ret_6m::numeric,
                    ret_1y     = v.ret_1y::numeric,
                    sharpe_1y  = v.sharpe_1y::numeric,
                    calmar_1y  = v.calmar_1y::numeric,
                    updated_at = NOW()
                FROM (VALUES %s) AS v(
                    ret_1w, ret_1m, ret_3m, ret_6m, ret_1y,
                    sharpe_1y, calmar_1y, beian_hao
                )
                WHERE t.beian_hao = v.beian_hao
                """,
                batch,
            )
        conn.commit()
        total_updated += len(batch)
        log.info("  Updated %d / %d rows …", total_updated, len(results))

    log.info("Done.  %d funds updated.", total_updated)
    return total_updated


# ── CLI entry-point ───────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Recompute private fund performance metrics from NAV data."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute metrics but do not write to the database.",
    )
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("Private fund indicators ETL starting  (pid=%d)", os.getpid())
    log.info("=" * 60)

    try:
        conn = get_conn()
    except Exception as exc:
        log.error("Database connection failed: %s", exc)
        sys.exit(1)

    try:
        n = run(conn, dry_run=args.dry_run)
    except Exception as exc:
        log.error("ETL failed: %s", exc)
        conn.close()
        sys.exit(1)

    conn.close()
    log.info("=" * 60)
    log.info("ETL completed successfully (%d funds).", n)


if __name__ == "__main__":
    main()
