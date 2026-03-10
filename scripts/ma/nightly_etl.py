#!/usr/bin/env python3
"""
nightly_etl.py — Nightly market data pipeline
===============================================
Fetches raw data from EmQuant / Tushare / Choice, stores it in PostgreSQL,
then computes derived chart-ready metrics.

Usage
-----
  python scripts/ma/nightly_etl.py               # normal nightly run
  python scripts/ma/nightly_etl.py --step nhci   # run single step only
  python scripts/ma/nightly_etl.py --backfill    # force full history reload (2023-01-01 → today)

Required env vars (loaded automatically from .env / .env.local):
  DATABASE_URL                          — e.g. postgresql://user:pass@localhost/market_data
  OR  DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
  TUSHARE_TOKEN
  EMQ_USERNAME / EMQ_PASSWORD
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("etl")

# ── Load .env files ───────────────────────────────────────────────────────────

def _load_env_files():
    """Walk up from script dir looking for .env / .env.local and load them."""
    candidates = [Path(__file__).resolve().parent, Path.cwd()]
    for base in candidates:
        for _ in range(3):          # up to 3 parent levels
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

# ── psycopg2 ──────────────────────────────────────────────────────────────────
try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    log.error("psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)


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


# ── Script runner ─────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent


def run_script(
    script_name: str,
    extra_env: dict | None = None,
    extra_args: list | None = None,
    timeout: int = 180,
) -> dict | None:
    """Run a Python script in scripts/ma/ and return its JSON stdout."""
    script_path = SCRIPT_DIR / script_name
    env = {**os.environ}
    if extra_env:
        env.update(extra_env)

    python_exe = os.environ.get("PYTHON_EXE") or (
        "py" if sys.platform == "win32" else "python3"
    )
    prefix = ["py", "-3"] if sys.platform == "win32" and python_exe == "py" else [python_exe]
    cmd = prefix + [str(script_path)] + (extra_args or [])

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, env=env
        )
        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()
        if result.returncode != 0:
            log.warning("[%s] exit %d: %s", script_name, result.returncode, stderr[:400])
        if stdout:
            first = stdout.find("{")
            last = stdout.rfind("}")
            if first != -1 and last > first:
                try:
                    return json.loads(stdout[first : last + 1])
                except json.JSONDecodeError:
                    pass
        log.warning("[%s] no valid JSON in stdout", script_name)
        return None
    except subprocess.TimeoutExpired:
        log.error("[%s] timed out after %ds", script_name, timeout)
        return None
    except Exception as exc:
        log.error("[%s] exception: %s", script_name, exc)
        return None


# ── Date helpers ─────────────────────────────────────────────────────────────

def to_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, date):
        return val
    s = str(val).replace("-", "").strip()
    try:
        return datetime.strptime(s, "%Y%m%d").date()
    except ValueError:
        return None


def ymd(d: date) -> str:
    return d.strftime("%Y%m%d")


def iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def third_friday(year: int, month: int) -> date:
    first_day = date(year, month, 1)
    # weekday(): 0=Mon … 4=Fri
    days_to_first_fri = (4 - first_day.weekday()) % 7
    return date(year, month, 1 + days_to_first_fri + 14)


def next_expiry(from_date: date) -> date:
    """Return the third Friday of the current or next month after from_date."""
    y, m = from_date.year, from_date.month
    cand = third_friday(y, m)
    if cand <= from_date:
        # Move to next month
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
        cand = third_friday(y, m)
    return cand


def parse_expiry_from_ts_code(ts_code: str) -> date | None:
    """IF2506.CFX  →  third Friday of 2025-06."""
    import re
    m = re.match(r"^[A-Z]{2}(\d{2})(\d{2})\.", ts_code or "")
    if not m:
        return None
    return third_friday(2000 + int(m.group(1)), int(m.group(2)))


def safe_float(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


# ── Pipeline ops logging ──────────────────────────────────────────────────────

def log_run(
    conn,
    job: str,
    step: str,
    status: str,
    trade_date: date | None = None,
    rows: int | None = None,
    error: str | None = None,
):
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO pipeline_runs
                    (job_name, step_name, status, trade_date, rows_affected, error_message, finished_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                """,
                (job, step, status, trade_date, rows, error),
            )
        conn.commit()
    except Exception as exc:
        log.warning("Could not write pipeline_runs: %s", exc)


def max_date(conn, table: str, col: str = "trade_date") -> date | None:
    with conn.cursor() as cur:
        cur.execute(f"SELECT MAX({col}) FROM {table}")  # noqa: S608 (col is internal const)
        row = cur.fetchone()
    return row[0] if (row and row[0]) else None


def row_count(conn, table: str, where_sql: str = "", params=()) -> int:
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {table} {where_sql}", params)  # noqa: S608
        return cur.fetchone()[0]


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1 — NHCI (South China Commodity Index)  via EmQuant
# ═══════════════════════════════════════════════════════════════════════════════

def step_nhci(conn, *, force: bool = False) -> int:
    cur_max = max_date(conn, "raw_nhci_daily")
    today = date.today()
    if not force and cur_max and cur_max >= today - timedelta(days=1):
        log.info("NHCI up-to-date (%s), skipping.", cur_max)
        return 0

    log.info("Fetching NHCI …")
    out = run_script("get_nanhua_index.py")
    if not out or out.get("error"):
        raise RuntimeError(f"NHCI fetch failed: {out}")

    rows_raw = out.get("data") or []
    if not rows_raw:
        raise RuntimeError("NHCI: empty data returned")

    records = []
    for r in rows_raw:
        d = to_date(str(r.get("date", "")).replace("-", ""))
        cl = safe_float(r.get("close"))
        if d and cl is not None:
            records.append((d, cl, "emquant"))

    if not records:
        raise RuntimeError("NHCI: no valid rows parsed")

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_nhci_daily (trade_date, close, source)
            VALUES %s
            ON CONFLICT (trade_date) DO UPDATE
                SET close = EXCLUDED.close, fetched_at = NOW()
            """,
            records,
        )
    conn.commit()
    log.info("NHCI: upserted %d rows (max date now %s).", len(records), max(r[0] for r in records))
    return len(records)


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Spot index closes  (EmQuant with Tushare fallback)
# ═══════════════════════════════════════════════════════════════════════════════

def _upsert_spot(conn, rows: list[tuple], source: str) -> int:
    """rows: list of (symbol, trade_date, close)."""
    records = [(sym, d, cl, source) for sym, d, cl in rows]
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_spot_daily (symbol, trade_date, close, source)
            VALUES %s
            ON CONFLICT (symbol, trade_date, source) DO UPDATE
                SET close = EXCLUDED.close, fetched_at = NOW()
            """,
            records,
        )
    conn.commit()
    return len(records)


def step_spot_closes(conn, trade_date: date, *, force: bool = False) -> int:
    """Fetch spot closes for one trade_date (both EmQuant and Tushare if available)."""
    if not force:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(DISTINCT symbol) FROM raw_spot_daily WHERE trade_date = %s",
                (trade_date,),
            )
            count = cur.fetchone()[0]
        if count >= 4:
            log.info("Spot closes for %s already in DB, skipping.", trade_date)
            return 0

    log.info("Fetching spot closes for %s …", trade_date)
    date_arg = iso(trade_date)
    total = 0

    # EmQuant
    out_eq = run_script("get_spot_indices_close.py", extra_env={"SPOT_TRADE_DATE": date_arg})
    if out_eq and not out_eq.get("error") and out_eq.get("data"):
        rows = []
        for sym, v in out_eq["data"].items():
            if isinstance(v, dict) and safe_float(v.get("close")) is not None:
                rows.append((sym, trade_date, safe_float(v["close"])))
        if rows:
            total += _upsert_spot(conn, rows, "emquant")
            log.info("  Spot EmQuant: %d rows.", len(rows))

    # Tushare (always try — useful as a cross-check / fallback)
    out_ts = run_script("get_spot_indices_close_tushare.py", extra_env={"SPOT_TRADE_DATE": date_arg})
    if out_ts and not out_ts.get("error") and out_ts.get("data"):
        rows = []
        for sym, v in out_ts["data"].items():
            if isinstance(v, dict) and safe_float(v.get("close")) is not None:
                rows.append((sym, trade_date, safe_float(v["close"])))
        if rows:
            total += _upsert_spot(conn, rows, "tushare")
            log.info("  Spot Tushare: %d rows.", len(rows))

    if total == 0:
        raise RuntimeError(f"Spot closes for {trade_date}: both sources returned no data")
    return total


def step_spot_timeseries_backfill(conn, start: date, end: date) -> int:
    """Bulk-load historical spot closes using EmQuant timeseries script."""
    log.info("Spot timeseries backfill %s → %s …", start, end)
    out = run_script(
        "get_spot_indices_timeseries.py",
        extra_args=[iso(start), iso(end)],
        timeout=300,
    )
    if not out or out.get("error"):
        raise RuntimeError(f"Spot timeseries backfill failed: {out}")

    total = 0
    for sym, series in (out.get("data") or {}).items():
        rows = []
        for r in series:
            d = to_date(str(r.get("date", "")).replace("-", ""))
            cl = safe_float(r.get("close"))
            if d and cl is not None:
                rows.append((sym, d, cl))
        if rows:
            total += _upsert_spot(conn, rows, "emquant")

    log.info("Spot backfill: %d rows.", total)
    return total


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 3 — CFFEX futures  (Tushare)
# ═══════════════════════════════════════════════════════════════════════════════

def _upsert_futures(conn, records: list) -> int:
    """records: (ts_code, symbol, trade_date, close, settle, pre_close, pre_settle, settle_return, source)."""
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_futures_daily
                (ts_code, symbol, trade_date, close, settle, pre_close, pre_settle, settle_return, source)
            VALUES %s
            ON CONFLICT (ts_code, trade_date) DO UPDATE
                SET close = EXCLUDED.close,
                    settle = EXCLUDED.settle,
                    pre_close = EXCLUDED.pre_close,
                    pre_settle = EXCLUDED.pre_settle,
                    settle_return = EXCLUDED.settle_return,
                    fetched_at = NOW()
            """,
            records,
        )
    conn.commit()
    return len(records)


def step_futures_latest(conn, trade_date: date, *, force: bool = False) -> int:
    """
    Fetch the latest CFFEX snapshot via get_cffex_index_futures_latest.py and:
      1. Upsert the continuous-leg rows into raw_futures_daily.
      2. Upsert the rich snapshot into derived_futures_snapshot.
    """
    if not force:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(DISTINCT symbol) FROM raw_futures_daily WHERE trade_date = %s",
                (trade_date,),
            )
            if cur.fetchone()[0] >= 4:
                log.info("Futures daily for %s already in DB, skipping.", trade_date)
                return 0

    log.info("Fetching CFFEX futures latest …")
    out = run_script("get_cffex_index_futures_latest.py")
    if not out or out.get("error"):
        raise RuntimeError(f"Futures latest fetch failed: {out}")

    actual_td = to_date(str(out.get("trade_date", ""))) or trade_date
    data = out.get("data") or {}

    raw_records: list = []
    snap_records: list = []
    seen_raw: set = set()

    for sym, row in data.items():
        if not isinstance(row, dict):
            continue
        td = to_date(str(row.get("trade_date", ""))) or actual_td

        def add_raw(ts_code, close_v, settle_v, settle_ret):
            if ts_code and (ts_code, td) not in seen_raw:
                seen_raw.add((ts_code, td))
                raw_records.append((ts_code, sym, td, close_v, settle_v, None, None, settle_ret, "tushare"))

        # Main/L1 continuous contract
        add_raw(row.get("ts_code"), safe_float(row.get("close")), safe_float(row.get("settle")), safe_float(row.get("settle_return")))
        # Near/L continuous
        add_raw(row.get("near_ts_code"), safe_float(row.get("near_close")), safe_float(row.get("near_settle")), safe_float(row.get("near_settle_return")))
        # Far/L3
        add_raw(row.get("far_ts_code"), safe_float(row.get("far_close")), None, None)

        snap_records.append((
            sym, td,
            row.get("ts_code"),
            safe_float(row.get("close")),
            safe_float(row.get("settle")),
            safe_float(row.get("settle_return")),
            row.get("near_ts_code"),
            safe_float(row.get("near_close")),
            safe_float(row.get("near_settle")),
            safe_float(row.get("near_settle_return")),
            row.get("far_ts_code"),
            safe_float(row.get("far_close")),
            # far_settle in the script output is actually L1 settle (used for basis calc)
            safe_float(row.get("far_settle")),
            safe_float(row.get("far_settle_return")),
            row.get("far_cont_ts_code"),
        ))

    raw_cnt = _upsert_futures(conn, raw_records)

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO derived_futures_snapshot
                (symbol, trade_date,
                 ts_code, close, settle, settle_return,
                 near_ts_code, near_close, near_settle, near_settle_return,
                 far_ts_code, far_close, far_settle, far_settle_return, far_cont_ts_code)
            VALUES %s
            ON CONFLICT (symbol, trade_date) DO UPDATE
                SET ts_code = EXCLUDED.ts_code,
                    close = EXCLUDED.close,
                    settle = EXCLUDED.settle,
                    settle_return = EXCLUDED.settle_return,
                    near_ts_code = EXCLUDED.near_ts_code,
                    near_close = EXCLUDED.near_close,
                    near_settle = EXCLUDED.near_settle,
                    near_settle_return = EXCLUDED.near_settle_return,
                    far_ts_code = EXCLUDED.far_ts_code,
                    far_close = EXCLUDED.far_close,
                    far_settle = EXCLUDED.far_settle,
                    far_settle_return = EXCLUDED.far_settle_return,
                    far_cont_ts_code = EXCLUDED.far_cont_ts_code,
                    computed_at = NOW()
            """,
            snap_records,
        )
    conn.commit()

    log.info("Futures latest: %d raw rows, %d snapshot rows (trade_date=%s).", raw_cnt, len(snap_records), actual_td)
    return raw_cnt + len(snap_records)


def step_futures_range_backfill(conn, start_ymd: str, end_ymd: str) -> int:
    """Bulk-load historical continuous legs L, L1, L2, L3 from Tushare."""
    log.info("Futures range backfill %s → %s (L/L1/L2/L3) …", start_ymd, end_ymd)
    total = 0

    # ---- L/L1/L2/L3 from the combined continuous script
    out_cont = run_script(
        "get_cffex_index_futures_continuous_range.py",
        extra_args=[start_ymd, end_ymd],
        timeout=600,
    )
    if out_cont and not out_cont.get("error"):
        records = []
        seen = set()
        for sym, legs in (out_cont.get("data") or {}).items():
            for leg, series in legs.items():
                for r in (series or []):
                    td = to_date(str(r.get("trade_date", "")))
                    if not td:
                        continue
                    ts_code = f"{sym}{leg}.CFX"
                    key = (ts_code, td)
                    if key in seen:
                        continue
                    seen.add(key)
                    records.append((
                        ts_code, sym, td,
                        safe_float(r.get("close")),
                        safe_float(r.get("settle")),
                        safe_float(r.get("pre_close")),
                        safe_float(r.get("pre_settle")),
                        safe_float(r.get("settle_return")),
                        "tushare",
                    ))
        if records:
            total += _upsert_futures(conn, records)
            log.info("  Continuous legs (L/L1/L2/L3): %d rows.", len(records))
    else:
        log.warning("  get_cffex_index_futures_continuous_range.py returned no data.")

    log.info("Futures backfill total: %d rows.", total)
    return total


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4 — Commodity amount heatmap  (Choice / EmQuant)
# ═══════════════════════════════════════════════════════════════════════════════

# Mirror of SECTOR_RULES in the existing Python scripts
_SECTOR_RULES: dict[str, set[str]] = {
    "农产":   {"C","CS","WH","PM","RR","RI","JR","LR","A","B","M","Y","RM","OI","RS","PK","P","SR","CF","CY","AP","CJ","LH","JD","LG","SP","OP"},
    "贵金属": {"AU","AG","PT","PD"},
    "有色":   {"CU","BC","AL","AO","AD","ZN","PB","NI","SN"},
    "新能源": {"LC","PS","SI"},
    "黑色":   {"I","SF","SM","RB","HC","SS","WR","JM","J","ZC","FG","BB","FB"},
    "能化":   {"SC","FU","LU","PG","BU","TA","EG","PF","PR","PL","PP","L","BZ","PX","EB","RU","BR","NR","SA","SH","V","UR","MA"},
    "航运":   {"EC"},
    "股指":   {"IH","IF","IC","IM","MO"},
    "国债":   {"TS","TF","T","TL"},
}


def _get_sector(code: str) -> str:
    head = (code.split(".")[0] or "").upper()
    # Strip trailing digits
    pure = "".join(c for c in head if not c.isdigit())
    if len(pure) > 2 and pure[-1] in ("M", "F", "X"):
        pure = pure[:-1]
    for sector, codes in _SECTOR_RULES.items():
        if pure in codes:
            return sector
    return "其他"


def step_commodity_amounts(conn, trade_date: date, *, force: bool = False) -> int:
    if not force:
        cnt = row_count(conn, "raw_commodity_amount_daily", "WHERE trade_date = %s", (trade_date,))
        if cnt > 0:
            log.info("Commodity amounts for %s already in DB (%d rows), skipping.", trade_date, cnt)
            return 0

    log.info("Fetching commodity amounts for %s …", trade_date)
    out = run_script("get_choice_all_futures_latest.py", extra_env={"CHOICE_TRADE_DATE": iso(trade_date)})
    if not out or out.get("error"):
        raise RuntimeError(f"Commodity amounts fetch failed: {out}")

    items = out.get("data") or []
    if not items:
        raise RuntimeError("Commodity amounts: empty data")

    records = []
    for item in items:
        code = item.get("code") or ""
        records.append((
            trade_date,
            code,
            item.get("name"),
            _get_sector(code),
            safe_float(item.get("return_pct")),
            int(item["amount"]) if item.get("amount") is not None else None,
            "choice",
        ))

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_commodity_amount_daily
                (trade_date, code, name, sector, return_pct, amount, source)
            VALUES %s
            ON CONFLICT (trade_date, code) DO UPDATE
                SET name = EXCLUDED.name,
                    return_pct = EXCLUDED.return_pct,
                    amount = EXCLUDED.amount,
                    fetched_at = NOW()
            """,
            records,
        )
    conn.commit()
    log.info("Commodity amounts: upserted %d rows.", len(records))
    return len(records)


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Derived: basis_daily  (annualized basis for far/near L1/L)
# ═══════════════════════════════════════════════════════════════════════════════

def step_compute_basis_daily(conn) -> int:
    """
    For every (symbol, trade_date) where we have continuous-leg data (L and L1)
    in raw_futures_daily AND spot data in raw_spot_daily but NOT yet in
    derived_basis_daily, compute annualized basis % and basis diff.
    """
    log.info("Computing derived_basis_daily …")
    symbols = ["IH", "IF", "IC", "IM"]
    total = 0

    for sym in symbols:
        near_code = f"{sym}L.CFX"
        far_code  = f"{sym}L1.CFX"

        # Find dates that need computing
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT f.trade_date
                FROM raw_futures_daily f
                JOIN raw_spot_daily s
                    ON s.symbol = %s AND s.trade_date = f.trade_date
                WHERE f.symbol = %s
                  AND f.ts_code IN (%s, %s)
                  AND NOT EXISTS (
                      SELECT 1 FROM derived_basis_daily d
                      WHERE d.symbol = %s AND d.trade_date = f.trade_date
                  )
                ORDER BY f.trade_date
                """,
                (sym, sym, near_code, far_code, sym),
            )
            pending_dates = [r[0] for r in cur.fetchall()]

        if not pending_dates:
            continue

        log.info("  Basis %s: computing %d dates.", sym, len(pending_dates))
        all_records = []

        for td in pending_dates:
            # Spot close: prefer emquant over tushare
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT close FROM raw_spot_daily
                    WHERE symbol = %s AND trade_date = %s
                    ORDER BY (CASE WHEN source = 'emquant' THEN 0 ELSE 1 END)
                    LIMIT 1
                    """,
                    (sym, td),
                )
                row = cur.fetchone()
            if not row:
                continue
            spot_close = float(row[0])
            td_py = td if isinstance(td, date) else td.date()

            with conn.cursor() as cur:
                cur.execute(
                    "SELECT ts_code, settle FROM raw_futures_daily WHERE ts_code IN (%s, %s) AND trade_date = %s",
                    (far_code, near_code, td),
                )
                fut_rows = {r[0]: float(r[1]) for r in cur.fetchall() if r[1] is not None}

            expiry = next_expiry(td_py)
            days_to_exp = max(1, (expiry - td_py).days)

            for basis_type, ts_code in (("far", far_code), ("near", near_code)):
                settle = fut_rows.get(ts_code)
                if settle is None:
                    continue
                ann_pct = (settle - spot_close) / spot_close / days_to_exp * 365 * 100
                basis_diff = settle - spot_close
                all_records.append((
                    sym, td, basis_type, ts_code,
                    spot_close, settle,
                    days_to_exp, expiry,
                    ann_pct, basis_diff,
                ))

        if all_records:
            with conn.cursor() as cur:
                execute_values(
                    cur,
                    """
                    INSERT INTO derived_basis_daily
                        (symbol, trade_date, basis_type, futures_ts_code,
                         spot_close, futures_settle, days_to_maturity, expiry_date,
                         annualized_basis_pct, basis_diff)
                    VALUES %s
                    ON CONFLICT (symbol, trade_date, basis_type) DO UPDATE
                        SET futures_ts_code      = EXCLUDED.futures_ts_code,
                            spot_close           = EXCLUDED.spot_close,
                            futures_settle       = EXCLUDED.futures_settle,
                            days_to_maturity     = EXCLUDED.days_to_maturity,
                            expiry_date          = EXCLUDED.expiry_date,
                            annualized_basis_pct = EXCLUDED.annualized_basis_pct,
                            basis_diff           = EXCLUDED.basis_diff,
                            computed_at          = NOW()
                    """,
                    all_records,
                )
            conn.commit()
            total += len(all_records)

    log.info("Basis daily: computed %d rows.", total)
    return total


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 6 — Derived: basis_cont_daily  (basis diff for all L/L1/L2/L3 legs)
# ═══════════════════════════════════════════════════════════════════════════════

def step_compute_basis_cont_daily(conn) -> int:
    """
    For all (symbol, leg, trade_date) in raw_futures_daily not yet in
    derived_basis_cont_daily, compute basis_diff = futures_settle - spot_close.
    """
    log.info("Computing derived_basis_cont_daily …")
    symbols = ["IH", "IF", "IC", "IM"]
    legs    = ["L", "L1", "L2", "L3"]
    total   = 0

    for sym in symbols:
        for leg in legs:
            ts_code = f"{sym}{leg}.CFX"

            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT f.trade_date
                    FROM raw_futures_daily f
                    JOIN raw_spot_daily s ON s.symbol = %s AND s.trade_date = f.trade_date
                    WHERE f.ts_code = %s
                      AND NOT EXISTS (
                          SELECT 1 FROM derived_basis_cont_daily d
                          WHERE d.symbol = %s AND d.trade_date = f.trade_date AND d.leg = %s
                      )
                    ORDER BY f.trade_date
                    """,
                    (sym, ts_code, sym, leg),
                )
                pending = [r[0] for r in cur.fetchall()]

            if not pending:
                continue

            records = []
            for td in pending:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT settle FROM raw_futures_daily WHERE ts_code = %s AND trade_date = %s",
                        (ts_code, td),
                    )
                    fut = cur.fetchone()
                    cur.execute(
                        """
                        SELECT close FROM raw_spot_daily
                        WHERE symbol = %s AND trade_date = %s
                        ORDER BY (CASE WHEN source = 'emquant' THEN 0 ELSE 1 END)
                        LIMIT 1
                        """,
                        (sym, td),
                    )
                    spot = cur.fetchone()

                if not fut or not spot or fut[0] is None:
                    continue
                settle     = float(fut[0])
                spot_close = float(spot[0])
                records.append((sym, td, leg, ts_code, spot_close, settle, settle - spot_close))

            if records:
                with conn.cursor() as cur:
                    execute_values(
                        cur,
                        """
                        INSERT INTO derived_basis_cont_daily
                            (symbol, trade_date, leg, futures_ts_code, spot_close, futures_settle, basis_diff)
                        VALUES %s
                        ON CONFLICT (symbol, trade_date, leg) DO UPDATE
                            SET futures_ts_code = EXCLUDED.futures_ts_code,
                                spot_close      = EXCLUDED.spot_close,
                                futures_settle  = EXCLUDED.futures_settle,
                                basis_diff      = EXCLUDED.basis_diff,
                                computed_at     = NOW()
                        """,
                        records,
                    )
                conn.commit()
                total += len(records)

    log.info("Basis cont daily: computed %d rows.", total)
    return total


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def latest_trade_date() -> date:
    """Best-guess of the latest exchange trade date (skips weekends)."""
    today = date.today()
    wd    = today.weekday()  # 0=Mon … 6=Sun
    if wd == 5:
        return today - timedelta(days=1)
    if wd == 6:
        return today - timedelta(days=2)
    return today


JOB_NAME = "nightly_etl"

ORDERED_STEPS = [
    "nhci",
    "spot_closes",
    "futures_latest",
    "commodity_amounts",
    "derive_basis",
    "derive_basis_cont",
]


def _needs_backfill(conn: object) -> bool:
    return row_count(conn, "raw_futures_daily") == 0


def run_backfill(conn, trade_date: date):
    log.info(">>> Initial backfill mode (DB is empty) <<<")
    start_ymd = "20230101"
    start_iso = "2023-01-01"

    try:
        step_spot_timeseries_backfill(conn, date(2023, 1, 1), trade_date)
        log_run(conn, JOB_NAME, "backfill_spot", "success", trade_date)
    except Exception as exc:
        log.warning("Spot timeseries backfill failed (non-fatal): %s", exc)
        log_run(conn, JOB_NAME, "backfill_spot", "failed", trade_date, error=str(exc))

    try:
        step_futures_range_backfill(conn, start_ymd, ymd(trade_date))
        log_run(conn, JOB_NAME, "backfill_futures", "success", trade_date)
    except Exception as exc:
        log.warning("Futures range backfill failed (non-fatal): %s", exc)
        log_run(conn, JOB_NAME, "backfill_futures", "failed", trade_date, error=str(exc))


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Nightly market data ETL")
    parser.add_argument("--step", choices=ORDERED_STEPS, help="Run a single step only")
    parser.add_argument("--backfill", action="store_true", help="Force full history reload")
    parser.add_argument("--force", action="store_true", help="Re-fetch even if data already in DB")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("Nightly ETL starting  (pid=%d)", os.getpid())
    log.info("=" * 60)

    td = latest_trade_date()
    log.info("Target trade date: %s", td)

    try:
        conn = get_conn()
    except Exception as exc:
        log.error("Database connection failed: %s", exc)
        sys.exit(1)

    # Initial backfill when DB is empty (or explicitly requested)
    if args.backfill or _needs_backfill(conn):
        run_backfill(conn, td)

    force = args.force

    step_fns = {
        "nhci":             lambda: step_nhci(conn, force=force),
        "spot_closes":      lambda: step_spot_closes(conn, td, force=force),
        "futures_latest":   lambda: step_futures_latest(conn, td, force=force),
        "commodity_amounts":lambda: step_commodity_amounts(conn, td, force=force),
        "derive_basis":     lambda: step_compute_basis_daily(conn),
        "derive_basis_cont":lambda: step_compute_basis_cont_daily(conn),
    }

    steps_to_run = [args.step] if args.step else ORDERED_STEPS
    errors = []

    for step_name in steps_to_run:
        try:
            rows = step_fns[step_name]()
            log_run(conn, JOB_NAME, step_name, "success", td, rows)
            log.info("  ✓  %-24s %d rows", step_name, rows or 0)
        except Exception as exc:
            log.error("  ✗  %-24s %s", step_name, exc)
            errors.append(step_name)
            log_run(conn, JOB_NAME, step_name, "failed", td, error=str(exc))

    conn.close()

    log.info("=" * 60)
    if errors:
        log.warning("ETL finished WITH ERRORS: %s", ", ".join(errors))
        sys.exit(1)
    else:
        log.info("ETL completed successfully.")


if __name__ == "__main__":
    main()
