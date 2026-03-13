#!/usr/bin/env python3
"""
predict_market_cluster.py — Load trained models and predict current market cluster
====================================================================================
Reads ETF prices from raw_etf_daily + NHCI from raw_nhci_daily, computes daily
log returns, applies the pre-trained (scaler → PCA → GMM) pipeline, and writes a
single JSON object to stdout for nightly_etl.py to parse and upsert.

Usage
-----
  python predict_market_cluster.py                     # all dates not yet predicted
  python predict_market_cluster.py 20260312            # single date
  python predict_market_cluster.py 20250313 20260313   # date range

Environment
-----------
  DATABASE_URL  or  DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
  MODEL_DIR     — path to directory containing scaler.joblib / pca.joblib / gmm.joblib
                  (defaults to <project_root>/economy/models)

Output JSON schema
------------------
{
  "count": <int>,
  "data": [
    { "date": "YYYY-MM-DD", "cluster": 2, "pc1": 0.1234, "pc2": -0.5678, "freq": "daily" },
    ...
  ]
}

Frequency modes (--freq)
------------------------
  daily   — one log return per trading day (default)
  weekly  — prices resampled to week-end (last price per calendar week)
  monthly — prices resampled to month-end (last price per calendar month)
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime
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


# ── DB helper ─────────────────────────────────────────────────────────────────
def _get_conn():
    try:
        import psycopg2  # type: ignore[import-untyped]
    except ImportError:
        raise RuntimeError("psycopg2 not installed. Run: pip install psycopg2-binary")
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


# ── Column order MUST match the training data used for scaler / PCA / GMM ────
ETF_TICKERS = [
    "510300.SH",
    "510500.SH",
    "511010.SH",
    "511220.SH",
    "511880.SH",
    "518880.SH",
]
ETF_COLS  = [f"{t}_ORIGINALUNIT" for t in ETF_TICKERS]
NHCI_COL  = "NHCI.NH_CLOSE"
ALL_COLS  = ETF_COLS + [NHCI_COL]


# ── helpers ───────────────────────────────────────────────────────────────────
def _parse_date(s: str) -> date:
    s = s.replace("-", "").strip()
    return datetime.strptime(s, "%Y%m%d").date()


# ── main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Predict market cluster via GMM on PCA-reduced log returns."
    )
    parser.add_argument(
        "--freq",
        choices=["daily", "weekly", "monthly"],
        default="daily",
        help="Return frequency: daily, weekly, or monthly (default: daily)",
    )
    parser.add_argument("start_date", nargs="?", help="Start date YYYYMMDD or YYYY-MM-DD")
    parser.add_argument("end_date",   nargs="?", help="End date   YYYYMMDD or YYYY-MM-DD")
    pargs = parser.parse_args()

    freq      = pargs.freq
    start_dt: date | None = _parse_date(pargs.start_date) if pargs.start_date else None
    end_dt:   date | None = _parse_date(pargs.end_date)   if pargs.end_date   else start_dt

    # ── locate model directory ─────────────────────────────────────────────────
    script_dir   = Path(__file__).resolve().parent        # scripts/ma/
    project_root = script_dir.parent.parent               # project root
    model_dir    = Path(
        os.environ.get("MODEL_DIR") or str(project_root / "economy" / "models")
    )
    if not model_dir.exists():
        print(json.dumps({"error": f"Model directory not found: {model_dir}"}))
        sys.exit(1)

    # ── load models ────────────────────────────────────────────────────────────
    try:
        import joblib  # type: ignore[import-untyped]
    except ImportError:
        print(json.dumps({"error": "joblib not installed. Run: pip install joblib"}))
        sys.exit(1)

    try:
        scaler = joblib.load(model_dir / "scaler.joblib")
        pca    = joblib.load(model_dir / "pca.joblib")
        gmm    = joblib.load(model_dir / "gmm.joblib")
    except Exception as exc:
        print(json.dumps({"error": f"Failed to load models: {exc}"}))
        sys.exit(1)

    # ── connect to DB ──────────────────────────────────────────────────────────
    try:
        conn = _get_conn()
    except Exception as exc:
        print(json.dumps({"error": f"DB connection failed: {exc}"}))
        sys.exit(1)

    try:
        import numpy as np
        import pandas as pd

        # ── fetch all ETF prices (full history for stable log-return computation)
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT trade_date,
                       ticker || '_' || field AS col,
                       value
                FROM raw_etf_daily
                WHERE ticker IN %s AND field = 'ORIGINALUNIT'
                ORDER BY trade_date
                """,
                (tuple(ETF_TICKERS),),
            )
            etf_rows = cur.fetchall()

        # ── fetch NHCI (full history) ──────────────────────────────────────────
        with conn.cursor() as cur:
            cur.execute(
                "SELECT trade_date, close FROM raw_nhci_daily ORDER BY trade_date"
            )
            nhci_rows = cur.fetchall()

        if not etf_rows:
            print(json.dumps({"error": "No ETF data found in raw_etf_daily", "data": [], "count": 0}))
            return

        # ── build wide price DataFrame ─────────────────────────────────────────
        etf_df = pd.DataFrame(etf_rows, columns=["date", "col", "value"])
        etf_df["date"] = pd.to_datetime(etf_df["date"])
        etf_wide = etf_df.pivot_table(
            index="date", columns="col", values="value", aggfunc="first"
        )

        nhci_df = pd.DataFrame(nhci_rows, columns=["date", NHCI_COL])
        nhci_df["date"] = pd.to_datetime(nhci_df["date"])
        nhci_df = nhci_df.set_index("date")

        wide = etf_wide.join(nhci_df, how="inner")

        # Make sure columns are in the exact training order
        available_cols = [c for c in ALL_COLS if c in wide.columns]
        missing = [c for c in ALL_COLS if c not in wide.columns]
        if missing:
            sys.stderr.write(f"WARNING: missing model input columns: {missing}\n")
        if not available_cols:
            print(json.dumps({"error": "No matching model input columns found in DB", "data": [], "count": 0}))
            return

        wide = wide[available_cols].sort_index()
        # Cast to float64: psycopg2 returns NUMERIC as decimal.Decimal which
        # numpy ufuncs cannot handle directly.
        wide = wide.astype(float)
        wide = wide.dropna()

        # ── resample prices to the requested frequency ────────────────────────
        if freq == "weekly":
            wide = wide.resample("W").last().dropna()
        elif freq == "monthly":
            wide = wide.resample("ME").last().dropna()
        # (daily: no resampling needed)

        # ── compute log returns ────────────────────────────────────────────────
        log_ret = np.log(wide / wide.shift(1)).dropna()
        log_ret = log_ret[available_cols]

        # ── determine which dates to predict ──────────────────────────────────
        if start_dt is not None and end_dt is not None:
            start_ts = pd.Timestamp(start_dt)
            end_ts   = pd.Timestamp(end_dt)
            target   = log_ret[(log_ret.index >= start_ts) & (log_ret.index <= end_ts)]
        elif start_dt is not None:
            target = log_ret[log_ret.index >= pd.Timestamp(start_dt)]
        else:
            # Default: all dates not yet in current_market_prediction for this freq
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT trade_date FROM current_market_prediction WHERE freq = %s",
                    (freq,),
                )
                already_done = {
                    pd.Timestamp(r[0]) for r in cur.fetchall()
                }
            target = log_ret[~log_ret.index.isin(already_done)]

        if target.empty:
            print(json.dumps({"data": [], "count": 0}))
            return

        # ── transform: scale → PCA → GMM ──────────────────────────────────────
        X_scaled = scaler.transform(target.values)
        pcs      = pca.transform(X_scaled)
        clusters = gmm.predict(
            pd.DataFrame(pcs[:, :2], columns=["PC1", "PC2"])
        )

        results = [
            {
                "date":    idx.strftime("%Y-%m-%d"),
                "cluster": int(clusters[i]),
                "pc1":     float(pcs[i, 0]),
                "pc2":     float(pcs[i, 1]),
                "freq":    freq,
            }
            for i, (idx, _) in enumerate(target.iterrows())
        ]

        # ── save to DB if requested (default: yes) ─────────────────────────────
        if save_to_db and results:
            try:
                from psycopg2.extras import execute_values  # type: ignore[import-untyped]
                records = [(r["date"], r["cluster"], r["pc1"], r["pc2"], r["freq"]) for r in results]
                with conn.cursor() as cur:
                    execute_values(
                        cur,
                        """
                        INSERT INTO current_market_prediction (trade_date, cluster, pc1, pc2, freq)
                        VALUES %s
                        ON CONFLICT (trade_date, freq) DO UPDATE
                            SET cluster     = EXCLUDED.cluster,
                                pc1         = EXCLUDED.pc1,
                                pc2         = EXCLUDED.pc2,
                                computed_at = NOW()
                        """,
                        records,
                    )
                conn.commit()
                sys.stderr.write(f"Saved {len(records)} rows (freq={freq}) to DB.\n")
            except Exception as exc:
                sys.stderr.write(f"WARNING: DB save failed: {exc}\n")

        print(json.dumps({"data": results, "count": len(results)}))

    finally:
        conn.close()


if __name__ == "__main__":
    main()
