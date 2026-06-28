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
  python scripts/ma/nightly_etl.py --step email_nav_parse
  python scripts/ma/nightly_etl.py --step investment_pool_metrics
  python scripts/ma/nightly_etl.py --backfill    # force full history reload (2023-01-01 → today)

Optional env:
  EMAIL_NAV_ETL_DAYS                    — email lookback window for nightly sync (default 400;
                                          set to 45 after initial backfill for faster runs)

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
import re
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
    import psycopg2 # type: ignore[import-untyped]
    from psycopg2.extras import execute_values # type: ignore[import-untyped]
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
    log_stderr: bool = False,
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
            log.warning("[%s] exit %d: %s", script_name, result.returncode, stderr[:800])
        elif log_stderr and stderr:
            log.info("[%s] stderr:\n%s", script_name, stderr[:10000])
        if stdout:
            first = stdout.find("{")
            last = stdout.rfind("}")
            if first != -1 and last > first:
                try:
                    return json.loads(stdout[first : last + 1])
                except json.JSONDecodeError:
                    pass
        log.warning("[%s] no valid JSON in stdout", script_name)
        if stderr:
            log.warning("[%s] stderr: %s", script_name, stderr[:800])
        return None
    except subprocess.TimeoutExpired:
        log.error("[%s] timed out after %ds", script_name, timeout)
        return None
    except Exception as exc:
        log.error("[%s] exception: %s", script_name, exc)
        return None


def run_node_script(
    script_name: str,
    extra_args: list | None = None,
    timeout: int = 900,
) -> dict | None:
    """Run a TypeScript script in scripts/ma/ via tsx and return its JSON stdout."""
    script_path = SCRIPT_DIR / script_name
    project_root = SCRIPT_DIR.parent.parent
    tsx_local = project_root / "node_modules" / ".bin" / (
        "tsx.cmd" if sys.platform == "win32" else "tsx"
    )

    if tsx_local.is_file():
        cmd = [str(tsx_local), str(script_path)] + (extra_args or [])
    else:
        npx = "npx.cmd" if sys.platform == "win32" else "npx"
        cmd = [npx, "--yes", "tsx", str(script_path)] + (extra_args or [])

    env = {**os.environ}
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
            cwd=str(project_root),
        )
        stdout = (result.stdout or "").strip()
        stderr = (result.stderr or "").strip()
        if result.returncode != 0:
            log.warning("[%s] exit %d: %s", script_name, result.returncode, stderr[:800])
        elif stderr:
            log.info("[%s] stderr:\n%s", script_name, stderr[:5000])
        if stdout:
            first = stdout.find("{")
            last = stdout.rfind("}")
            if first != -1 and last > first:
                try:
                    return json.loads(stdout[first : last + 1])
                except json.JSONDecodeError:
                    pass
        log.warning("[%s] no valid JSON in stdout", script_name)
        if stderr:
            log.warning("[%s] stderr: %s", script_name, stderr[:800])
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

def step_nhci(conn, *, force: bool = False, start: date | None = None) -> int:
    cur_max = max_date(conn, "raw_nhci_daily")
    today = date.today()
    if not force and start is None and cur_max and cur_max >= today - timedelta(days=1):
        log.info("NHCI up-to-date (%s), skipping.", cur_max)
        return 0

    log.info("Fetching NHCI …")
    extra_args: list[str] = []
    if start:
        extra_args = [iso(start), iso(today)]
    out = run_script("get_nanhua_index.py", extra_args=extra_args or None)
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
# STEP 1b — NHECI (South China Energy & Chemical Index)  via EmQuant
# ═══════════════════════════════════════════════════════════════════════════════

def step_nheci(conn, *, force: bool = False, start: date | None = None) -> int:
    cur_max = max_date(conn, "raw_nheci_daily")
    today = date.today()
    if not force and start is None and cur_max and cur_max >= today - timedelta(days=1):
        log.info("NHECI up-to-date (%s), skipping.", cur_max)
        return 0

    log.info("Fetching NHECI …")
    extra_args: list[str] = []
    if start:
        extra_args = [iso(start), iso(today)]
    out = run_script("get_nanhua_energy_index.py", extra_args=extra_args or None)
    if not out or out.get("error"):
        raise RuntimeError(f"NHECI fetch failed: {out}")

    rows_raw = out.get("data") or []
    if not rows_raw:
        raise RuntimeError("NHECI: empty data returned")

    records = []
    for r in rows_raw:
        d = to_date(str(r.get("date", "")).replace("-", ""))
        cl = safe_float(r.get("close"))
        if d and cl is not None:
            records.append((d, cl, "emquant"))

    if not records:
        raise RuntimeError("NHECI: no valid rows parsed")

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_nheci_daily (trade_date, close, source)
            VALUES %s
            ON CONFLICT (trade_date) DO UPDATE
                SET close = EXCLUDED.close, fetched_at = NOW()
            """,
            records,
        )
    conn.commit()
    log.info("NHECI: upserted %d rows (max date now %s).", len(records), max(r[0] for r in records))
    return len(records)


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1c — 南华17指数 daily OHLCV  (EmQuant / Choice API)
# ═══════════════════════════════════════════════════════════════════════════════

_NH_INDICES_BACKFILL_START = date(2025, 1, 1)


def step_nanhua_indices(conn, *, force: bool = False) -> int:
    """Fetch OPEN/CLOSE/HIGH/LOW/... for all 17 南华 sub-indices into raw_nanhua_indices_daily.
    First run: backfills from 2025-01-01. Subsequent runs: incremental from last stored date."""

    # Create table on first use so no separate migration is required
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_nanhua_indices_daily (
                trade_date  DATE        NOT NULL,
                code        TEXT        NOT NULL,
                name        TEXT,
                open        NUMERIC,
                close       NUMERIC,
                high        NUMERIC,
                low         NUMERIC,
                preclose    NUMERIC,
                change      NUMERIC,
                pct_change  NUMERIC,
                volume      NUMERIC,
                amount      NUMERIC,
                turn        NUMERIC,
                amplitude   NUMERIC,
                source      TEXT        NOT NULL DEFAULT 'emquant',
                fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, code)
            )
        """)
        # Add name column if upgrading from an older schema
        cur.execute("""
            ALTER TABLE raw_nanhua_indices_daily
            ADD COLUMN IF NOT EXISTS name TEXT
        """)
    conn.commit()

    today = date.today()
    cur_max = max_date(conn, "raw_nanhua_indices_daily")

    if not force and cur_max and cur_max >= today - timedelta(days=1):
        log.info("NH indices up-to-date (%s), skipping.", cur_max)
        return 0

    if cur_max is None or force:
        start = _NH_INDICES_BACKFILL_START
        log.info("NH indices: %s, backfilling from %s …", "forced" if force else "first run", start)
    else:
        start = cur_max + timedelta(days=1)
        log.info("NH indices: incremental fetch %s → %s …", start, today)

    if start > today:
        log.info("NH indices: already up-to-date, nothing to do.")
        return 0

    out = run_script(
        "get_nanhua_indices_daily.py",
        extra_args=[iso(start), iso(today)],
        timeout=300,
    )
    if not out or out.get("error"):
        raise RuntimeError(f"NH indices fetch failed: {out}")

    rows_raw = out.get("data") or []
    if not rows_raw:
        log.warning("NH indices: empty data returned for %s → %s.", start, today)
        return 0

    records = []
    for r in rows_raw:
        d    = to_date(str(r.get("date", "")).replace("-", ""))
        code = r.get("code")
        if not d or not code:
            continue
        records.append((
            d, code,
            r.get("name") or "",
            safe_float(r.get("open")),
            safe_float(r.get("close")),
            safe_float(r.get("high")),
            safe_float(r.get("low")),
            safe_float(r.get("preclose")),
            safe_float(r.get("change")),
            safe_float(r.get("pct_change")),
            safe_float(r.get("volume")),
            safe_float(r.get("amount")),
            safe_float(r.get("turn")),
            safe_float(r.get("amplitude")),
            "emquant",
        ))

    if not records:
        log.warning("NH indices: no valid rows parsed.")
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_nanhua_indices_daily
                (trade_date, code, name, open, close, high, low, preclose,
                 change, pct_change, volume, amount, turn, amplitude, source)
            VALUES %s
            ON CONFLICT (trade_date, code) DO UPDATE
                SET name=EXCLUDED.name, open=EXCLUDED.open, close=EXCLUDED.close, high=EXCLUDED.high,
                    low=EXCLUDED.low, preclose=EXCLUDED.preclose, change=EXCLUDED.change,
                    pct_change=EXCLUDED.pct_change, volume=EXCLUDED.volume,
                    amount=EXCLUDED.amount, turn=EXCLUDED.turn,
                    amplitude=EXCLUDED.amplitude, fetched_at=NOW()
            """,
            records,
        )
    conn.commit()
    log.info("NH indices: upserted %d rows (max date %s).", len(records), max(r[0] for r in records))
    return len(records)


# ─────────────────────────────────────────────────────────────────────────────
# STEP 1c — 南华单商品指数 OHLCV  (80 commodity-level NH indices)
# ─────────────────────────────────────────────────────────────────────────────

_NH_COMMODITY_BACKFILL_START = date(2025, 1, 1)


def step_nanhua_commodity_indices(conn, *, force: bool = False) -> int:
    """Fetch OHLCV for 80 南华单商品指数 into raw_nanhua_commodity_indices_daily.
    First run: backfills from 2025-01-01. Subsequent runs: incremental."""

    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_nanhua_commodity_indices_daily (
                trade_date  DATE        NOT NULL,
                code        TEXT        NOT NULL,
                name        TEXT,
                open        NUMERIC,
                close       NUMERIC,
                high        NUMERIC,
                low         NUMERIC,
                preclose    NUMERIC,
                change      NUMERIC,
                pct_change  NUMERIC,
                volume      NUMERIC,
                amount      NUMERIC,
                turn        NUMERIC,
                amplitude   NUMERIC,
                source      TEXT        NOT NULL DEFAULT 'emquant',
                fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, code)
            )
        """)
        cur.execute("""
            ALTER TABLE raw_nanhua_commodity_indices_daily
            ADD COLUMN IF NOT EXISTS name TEXT
        """)
    conn.commit()

    today   = date.today()
    cur_max = max_date(conn, "raw_nanhua_commodity_indices_daily")

    if not force and cur_max and cur_max >= today - timedelta(days=1):
        log.info("NH commodity indices up-to-date (%s), skipping.", cur_max)
        return 0

    if cur_max is None or force:
        start = _NH_COMMODITY_BACKFILL_START
        log.info("NH commodity indices: %s, backfilling from %s …",
                 "forced" if force else "first run", start)
    else:
        start = cur_max + timedelta(days=1)
        log.info("NH commodity indices: incremental fetch %s → %s …", start, today)

    if start > today:
        log.info("NH commodity indices: already up-to-date, nothing to do.")
        return 0

    out = run_script(
        "get_nanhua_commodity_indices_daily.py",
        extra_args=[iso(start), iso(today)],
        timeout=600,
    )
    if not out or out.get("error"):
        raise RuntimeError(f"NH commodity indices fetch failed: {out}")

    rows_raw = out.get("data") or []
    if not rows_raw:
        log.warning("NH commodity indices: empty data returned for %s → %s.", start, today)
        return 0

    records = []
    for r in rows_raw:
        d    = to_date(str(r.get("date", "")).replace("-", ""))
        code = r.get("code")
        if not d or not code:
            continue
        records.append((
            d, code,
            r.get("name") or "",
            safe_float(r.get("open")),
            safe_float(r.get("close")),
            safe_float(r.get("high")),
            safe_float(r.get("low")),
            safe_float(r.get("preclose")),
            safe_float(r.get("change")),
            safe_float(r.get("pct_change")),
            safe_float(r.get("volume")),
            safe_float(r.get("amount")),
            safe_float(r.get("turn")),
            safe_float(r.get("amplitude")),
            "emquant",
        ))

    if not records:
        log.warning("NH commodity indices: no valid rows parsed.")
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_nanhua_commodity_indices_daily
                (trade_date, code, name, open, close, high, low, preclose,
                 change, pct_change, volume, amount, turn, amplitude, source)
            VALUES %s
            ON CONFLICT (trade_date, code) DO UPDATE
                SET name=EXCLUDED.name, open=EXCLUDED.open, close=EXCLUDED.close,
                    high=EXCLUDED.high, low=EXCLUDED.low, preclose=EXCLUDED.preclose,
                    change=EXCLUDED.change, pct_change=EXCLUDED.pct_change,
                    volume=EXCLUDED.volume, amount=EXCLUDED.amount,
                    turn=EXCLUDED.turn, amplitude=EXCLUDED.amplitude,
                    fetched_at=NOW()
            """,
            records,
        )
    conn.commit()
    log.info("NH commodity indices: upserted %d rows (max date %s).",
             len(records), max(r[0] for r in records))
    return len(records)


# ───────────────────────────────────────────────────────────────────────────────
# STEP 1d — MOM traded futures contracts OHLCV  (all distinct contracts in DB)
# ───────────────────────────────────────────────────────────────────────────────

_FUTURES_CONTRACTS_BACKFILL_START = date(2025, 1, 1)

# DB columns for upsert (matches fetch script output keys)
_FC_FIELDS = (
    "open", "close", "high", "low", "preclose", "average",
    "change", "pct_change", "volume", "amount", "spread",
    "clear", "preclear", "pct_change_clear", "change_clear",
    "hqoi", "change_oi", "amplitude", "mainforce",
    "uni_volume", "uni_amount", "uni_hqoi", "uni_change_oi",
    "change_close", "pct_change_close",
)


def step_futures_contracts_ohlcv(conn, *, force: bool = False) -> int:
    """Fetch daily OHLCV + settlement for every contract MOM has traded.

    Source table : mom_futures_trade_details."合约"
    Target table : raw_futures_contracts_daily  (trade_date, contract) PK
    First run    : backfills 2025-01-01 → today
    Subsequent   : incremental from last stored date + 1 day
    """

    # ── Create / migrate target table ─────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_futures_contracts_daily (
                trade_date        DATE        NOT NULL,
                contract          TEXT        NOT NULL,
                open              NUMERIC,
                close             NUMERIC,
                high              NUMERIC,
                low               NUMERIC,
                preclose          NUMERIC,
                average           NUMERIC,
                change            NUMERIC,
                pct_change        NUMERIC,
                volume            NUMERIC,
                amount            NUMERIC,
                spread            NUMERIC,
                clear             NUMERIC,
                preclear          NUMERIC,
                pct_change_clear  NUMERIC,
                change_clear      NUMERIC,
                hqoi              NUMERIC,
                change_oi         NUMERIC,
                amplitude         NUMERIC,
                mainforce         TEXT,
                uni_volume        NUMERIC,
                uni_amount        NUMERIC,
                uni_hqoi          NUMERIC,
                uni_change_oi     NUMERIC,
                change_close      NUMERIC,
                pct_change_close  NUMERIC,
                source            TEXT        NOT NULL DEFAULT 'emquant',
                fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, contract)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_futures_contracts_daily_contract
              ON raw_futures_contracts_daily (contract)
        """)
    conn.commit()

    today   = date.today()
    cur_max = max_date(conn, "raw_futures_contracts_daily")

    if not force and cur_max and cur_max >= today - timedelta(days=1):
        log.info("Futures contracts OHLCV up-to-date (%s), skipping.", cur_max)
        return 0

    if cur_max is None or force:
        start = _FUTURES_CONTRACTS_BACKFILL_START
        log.info("Futures contracts OHLCV: %s, backfilling from %s …",
                 "forced" if force else "first run", start)
    else:
        start = cur_max + timedelta(days=1)
        log.info("Futures contracts OHLCV: incremental fetch %s → %s …", start, today)

    if start > today:
        log.info("Futures contracts OHLCV: already up-to-date.")
        return 0

    # ── Check that source table exists ────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'mom_futures_trade_details'
            )
        """)
        if not cur.fetchone()[0]:
            log.warning("mom_futures_trade_details does not exist — skipping futures OHLCV step.")
            return 0

    out = run_script(
        "fetch_futures_contracts_daily.py",
        extra_args=[iso(start), iso(today)],
        timeout=900,
        log_stderr=True,  # surface progress + API errors
    )
    if not out or out.get("error"):
        raise RuntimeError(f"Futures contracts fetch failed: {out}")

    contracts_found = out.get("contracts") or []
    log.info("Futures contracts: %d unique contracts loaded from DB (first 5: %s)",
             len(contracts_found), contracts_found[:5])

    rows_raw = out.get("data") or []
    if not rows_raw:
        log.warning("Futures contracts OHLCV: empty data returned for %s → %s. "
                    "contracts=%d  full_response_keys=%s",
                    start, today, len(contracts_found), list(out.keys()))
        return 0

    records = []
    for r in rows_raw:
        d        = to_date(str(r.get("date", "")).replace("-", ""))
        contract = r.get("contract", "").strip()
        if not d or not contract:
            continue
        records.append((
            d, contract,
            safe_float(r.get("open")),
            safe_float(r.get("close")),
            safe_float(r.get("high")),
            safe_float(r.get("low")),
            safe_float(r.get("preclose")),
            safe_float(r.get("average")),
            safe_float(r.get("change")),
            safe_float(r.get("pct_change")),
            safe_float(r.get("volume")),
            safe_float(r.get("amount")),
            safe_float(r.get("spread")),
            safe_float(r.get("clear")),
            safe_float(r.get("preclear")),
            safe_float(r.get("pct_change_clear")),
            safe_float(r.get("change_clear")),
            safe_float(r.get("hqoi")),
            safe_float(r.get("change_oi")),
            safe_float(r.get("amplitude")),
            r.get("mainforce") or None,       # TEXT — may be a contract code
            safe_float(r.get("uni_volume")),
            safe_float(r.get("uni_amount")),
            safe_float(r.get("uni_hqoi")),
            safe_float(r.get("uni_change_oi")),
            safe_float(r.get("change_close")),
            safe_float(r.get("pct_change_close")),
            "emquant",
        ))

    if not records:
        log.warning("Futures contracts OHLCV: no valid rows parsed.")
        return 0

    col_list = "trade_date, contract, " + ", ".join(_FC_FIELDS) + ", source"
    update_set = ", ".join(
        f"{f}=EXCLUDED.{f}" for f in _FC_FIELDS
    ) + ", fetched_at=NOW()"
    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""
            INSERT INTO raw_futures_contracts_daily ({col_list})
            VALUES %s
            ON CONFLICT (trade_date, contract) DO UPDATE
                SET {update_set}
            """,
            records,
        )
    conn.commit()
    log.info("Futures contracts OHLCV: upserted %d rows (max date %s).",
             len(records), max(r[0] for r in records))
    return len(records)


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1b — Options contracts OHLCV + greeks
# ═══════════════════════════════════════════════════════════════════════════════

_OPTIONS_CONTRACTS_BACKFILL_START = date(2025, 1, 1)

# DB columns for upsert (matches fetch script output keys)
_OC_FIELDS = (
    "close", "open", "high", "low", "preclose", "clear", "preclear",
    "change", "pct_change", "change_clear", "pct_change_clear",
    "hqoi", "volume", "amount", "change_oi", "amplitude",
    "impl_vol", "em_delta", "delta", "gamma", "rho", "theta", "vega",
    "em_theta", "em_gamma", "em_vega", "em_rho",
)


def step_options_contracts_ohlcv(conn, *, force: bool = False) -> int:
    """Fetch daily OHLCV + greeks for every options contract MOM has traded.

    Source table : mom_options_trade_details."合约"
    Target table : raw_options_contracts_daily  (trade_date, contract) PK
    First run    : backfills 2025-01-01 → today
    Subsequent   : incremental from last stored date + 1 day
    """

    # ── Create / migrate target table ─────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_options_contracts_daily (
                trade_date        DATE        NOT NULL,
                contract          TEXT        NOT NULL,
                -- price
                close             NUMERIC,
                open              NUMERIC,
                high              NUMERIC,
                low               NUMERIC,
                preclose          NUMERIC,
                clear             NUMERIC,
                preclear          NUMERIC,
                change            NUMERIC,
                pct_change        NUMERIC,
                change_clear      NUMERIC,
                pct_change_clear  NUMERIC,
                -- volume / open interest
                hqoi              NUMERIC,
                volume            NUMERIC,
                amount            NUMERIC,
                change_oi         NUMERIC,
                amplitude         NUMERIC,
                -- implied vol + greeks
                impl_vol          NUMERIC,
                em_delta          NUMERIC,
                delta             NUMERIC,
                gamma             NUMERIC,
                rho               NUMERIC,
                theta             NUMERIC,
                vega              NUMERIC,
                -- EM-calculated greeks
                em_theta          NUMERIC,
                em_gamma          NUMERIC,
                em_vega           NUMERIC,
                em_rho            NUMERIC,
                -- metadata
                source            TEXT        NOT NULL DEFAULT 'emquant',
                fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, contract)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_options_contracts_daily_contract
              ON raw_options_contracts_daily (contract)
        """)
    conn.commit()

    today   = date.today()
    cur_max = max_date(conn, "raw_options_contracts_daily")

    if not force and cur_max and cur_max >= today - timedelta(days=1):
        log.info("Options contracts OHLCV up-to-date (%s), skipping.", cur_max)
        return 0

    if cur_max is None or force:
        start = _OPTIONS_CONTRACTS_BACKFILL_START
        log.info("Options contracts OHLCV: %s, backfilling from %s …",
                 "forced" if force else "first run", start)
    else:
        start = cur_max + timedelta(days=1)
        log.info("Options contracts OHLCV: incremental fetch %s → %s …", start, today)

    if start > today:
        log.info("Options contracts OHLCV: already up-to-date.")
        return 0

    # ── Check that source table exists ────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'mom_options_trade_details'
            )
        """)
        if not cur.fetchone()[0]:
            log.warning("mom_options_trade_details does not exist — skipping options OHLCV step.")
            return 0

    out = run_script(
        "fetch_options_contracts_daily.py",
        extra_args=[iso(start), iso(today)],
        timeout=1200,
        log_stderr=True,
    )
    if not out or out.get("error"):
        raise RuntimeError(f"Options contracts fetch failed: {out}")

    contracts_found = out.get("contracts") or []
    log.info("Options contracts: %d unique contracts loaded from DB (first 5: %s)",
             len(contracts_found), contracts_found[:5])

    rows_raw = out.get("data") or []
    if not rows_raw:
        log.warning("Options contracts OHLCV: empty data returned for %s → %s.",
                    start, today)
        return 0

    records = []
    for r in rows_raw:
        d        = to_date(str(r.get("date", "")).replace("-", ""))
        contract = r.get("contract", "").strip()
        if not d or not contract:
            continue
        records.append((
            d, contract,
            safe_float(r.get("close")),
            safe_float(r.get("open")),
            safe_float(r.get("high")),
            safe_float(r.get("low")),
            safe_float(r.get("preclose")),
            safe_float(r.get("clear")),
            safe_float(r.get("preclear")),
            safe_float(r.get("change")),
            safe_float(r.get("pct_change")),
            safe_float(r.get("change_clear")),
            safe_float(r.get("pct_change_clear")),
            safe_float(r.get("hqoi")),
            safe_float(r.get("volume")),
            safe_float(r.get("amount")),
            safe_float(r.get("change_oi")),
            safe_float(r.get("amplitude")),
            safe_float(r.get("impl_vol")),
            safe_float(r.get("em_delta")),
            safe_float(r.get("delta")),
            safe_float(r.get("gamma")),
            safe_float(r.get("rho")),
            safe_float(r.get("theta")),
            safe_float(r.get("vega")),
            safe_float(r.get("em_theta")),
            safe_float(r.get("em_gamma")),
            safe_float(r.get("em_vega")),
            safe_float(r.get("em_rho")),
            "emquant",
        ))

    if not records:
        log.warning("Options contracts OHLCV: no valid rows parsed.")
        return 0

    col_list  = "trade_date, contract, " + ", ".join(_OC_FIELDS) + ", source"
    update_set = ", ".join(f"{f}=EXCLUDED.{f}" for f in _OC_FIELDS) + ", fetched_at=NOW()"
    with conn.cursor() as cur:
        execute_values(
            cur,
            f"""
            INSERT INTO raw_options_contracts_daily ({col_list})
            VALUES %s
            ON CONFLICT (trade_date, contract) DO UPDATE
                SET {update_set}
            """,
            records,
        )
    conn.commit()
    log.info("Options contracts OHLCV: upserted %d rows (max date %s).",
             len(records), max(r[0] for r in records))
    return len(records)


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 1e — AkShare futures daily OHLCV  (87 continuous main contracts / Sina)
# ═══════════════════════════════════════════════════════════════════════════════

_AK_FUTURES_BACKFILL_START = date(2025, 1, 1)


# Backfill start for exchange daily bulletin data
_AK_EXCHANGE_BACKFILL_START = date(2025, 1, 1)


def step_akshare_exchange_daily(conn, *, force: bool = False) -> int:
    """Fetch per-contract daily volume + OI from exchange bulletins via AkShare.

    Source : ak.futures_dce_daily / shfe / czce / cffex / gfex  (public, no auth)
    Table  : raw_futures_contracts_daily  (trade_date, contract) PK — shared with EmQuant
    Coverage: ALL contracts traded on each exchange (not just held ones)
    On conflict: preserves existing non-null values (EmQuant takes precedence)
    First run  : backfills from 2025-01-01 → today
    Subsequent : incremental from last stored date + 1 day
    """
    today   = date.today()
    cur_max = max_date(conn, "raw_futures_contracts_daily")

    if not force and cur_max and cur_max >= today - timedelta(days=1):
        log.info("AkShare exchange daily up-to-date (%s), skipping.", cur_max)
        return 0

    if cur_max is None or force:
        start = _AK_EXCHANGE_BACKFILL_START
        log.info("AkShare exchange daily: %s, backfilling from %s …",
                 "forced" if force else "first run", start)
    else:
        start = cur_max + timedelta(days=1)
        log.info("AkShare exchange daily: incremental fetch %s → %s …", start, today)

    if start > today:
        log.info("AkShare exchange daily: already up-to-date.")
        return 0

    out = run_script(
        "fetch_akshare_exchange_daily.py",
        extra_args=[iso(start), iso(today)],
        timeout=1200,
        log_stderr=True,
    )
    if not out or out.get("error"):
        log.warning("AkShare exchange daily fetch failed (non-fatal): %s", out)
        return 0

    rows = int(out.get("rows", 0))
    log.info("AkShare exchange daily: upserted %d rows (%s → %s).", rows, start, today)
    return rows


def step_akshare_futures_daily(conn, *, force: bool = False) -> int:
    """Fetch daily OHLCV + settlement for 87 continuous futures contracts via AkShare.

    Source : ak.futures_zh_daily_sina()  (Sina Finance — public, no auth needed)
    Table  : raw_akshare_futures_daily  (trade_date, code) PK
    Codes  : 87 continuous main contracts across DCE / SHF / CZC / INE / GFE / CFE
    First run  : backfills from 2025-01-01 → today
    Subsequent : incremental from last stored date + 1 day
    """
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_akshare_futures_daily (
                trade_date  DATE        NOT NULL,
                code        TEXT        NOT NULL,
                open        NUMERIC,
                close       NUMERIC,
                high        NUMERIC,
                low         NUMERIC,
                pct_change  NUMERIC,
                volume      NUMERIC,
                clear       NUMERIC,
                source      TEXT        NOT NULL DEFAULT 'akshare',
                fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, code)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_akshare_futures_daily_code
              ON raw_akshare_futures_daily (code)
        """)
    conn.commit()

    today   = date.today()
    cur_max = max_date(conn, "raw_akshare_futures_daily")

    if not force and cur_max and cur_max >= today - timedelta(days=1):
        log.info("AkShare futures daily up-to-date (%s), skipping.", cur_max)
        return 0

    if cur_max is None or force:
        start = _AK_FUTURES_BACKFILL_START
        log.info("AkShare futures daily: %s, backfilling from %s …",
                 "forced" if force else "first run", start)
    else:
        start = cur_max + timedelta(days=1)
        log.info("AkShare futures daily: incremental fetch %s → %s …", start, today)

    if start > today:
        log.info("AkShare futures daily: already up-to-date.")
        return 0

    out = run_script(
        "fetch_akshare_futures_daily.py",
        extra_args=[iso(start), iso(today)],
        timeout=900,
        log_stderr=True,   # surface tqdm progress + warnings
    )
    if not out or out.get("error"):
        raise RuntimeError(f"AkShare futures daily fetch failed: {out}")

    rows_raw = out.get("data") or []
    if not rows_raw:
        log.warning("AkShare futures daily: empty data for %s → %s.", start, today)
        return 0

    records = []
    for r in rows_raw:
        d    = to_date(str(r.get("date", "")).replace("-", ""))
        code = r.get("code", "").strip()
        if not d or not code:
            continue
        records.append((
            d, code,
            safe_float(r.get("open")),
            safe_float(r.get("close")),
            safe_float(r.get("high")),
            safe_float(r.get("low")),
            safe_float(r.get("pct_change")),
            safe_float(r.get("volume")),
            safe_float(r.get("clear")),
            "akshare",
        ))

    if not records:
        log.warning("AkShare futures daily: no valid rows parsed.")
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_akshare_futures_daily
                (trade_date, code, open, close, high, low, pct_change, volume, clear, source)
            VALUES %s
            ON CONFLICT (trade_date, code) DO UPDATE
                SET open=EXCLUDED.open, close=EXCLUDED.close,
                    high=EXCLUDED.high, low=EXCLUDED.low,
                    pct_change=EXCLUDED.pct_change, volume=EXCLUDED.volume,
                    clear=EXCLUDED.clear, fetched_at=NOW()
            """,
            records,
        )
    conn.commit()
    log.info("AkShare futures daily: upserted %d rows (max date %s).",
             len(records), max(r[0] for r in records))
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
            raw_cnt = cur.fetchone()[0]
            cur.execute(
                "SELECT COUNT(DISTINCT symbol) FROM derived_futures_snapshot WHERE trade_date = %s",
                (trade_date,),
            )
            snap_cnt = cur.fetchone()[0]
            # Skip only when both raw and snapshot are complete for 4 symbols.
            # This avoids a stale snapshot when a previous run failed mid-step.
            if raw_cnt >= 4 and snap_cnt >= 4:
                log.info("Futures for %s already complete in raw+snapshot, skipping.", trade_date)
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
        # Far continuous L1 (needed by step_compute_basis_daily which looks for {sym}L1.CFX)
        add_raw(row.get("far_cont_ts_code"), safe_float(row.get("far_settle")), safe_float(row.get("far_settle")), safe_float(row.get("far_settle_return")))

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

    # Repair NULL near_settle_return / far_settle_return using previous-day
    # settle from the DB.  Tushare sometimes omits pre_settle for continuous
    # contracts (IHL.CFX / IHL1.CFX), leaving these columns NULL even when
    # close / settle itself is populated.
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH prev AS (
                SELECT DISTINCT ON (symbol)
                    symbol,
                    near_settle,
                    far_settle
                FROM derived_futures_snapshot
                WHERE trade_date < %(td)s
                ORDER BY symbol, trade_date DESC
            )
            UPDATE derived_futures_snapshot cur
            SET
                near_settle_return = CASE
                    WHEN cur.near_settle_return IS NULL
                         AND cur.near_close IS NOT NULL
                         AND prev.near_settle IS NOT NULL
                         AND prev.near_settle > 0
                    THEN ROUND(100.0 * (cur.near_close / prev.near_settle - 1.0), 6)
                    ELSE cur.near_settle_return
                END,
                far_settle_return = CASE
                    WHEN cur.far_settle_return IS NULL
                         AND cur.far_settle IS NOT NULL
                         AND prev.far_settle IS NOT NULL
                         AND prev.far_settle > 0
                    THEN ROUND(100.0 * (cur.far_settle / prev.far_settle - 1.0), 6)
                    ELSE cur.far_settle_return
                END
            FROM prev
            WHERE cur.symbol = prev.symbol
              AND cur.trade_date = %(td)s
              AND (cur.near_settle_return IS NULL OR cur.far_settle_return IS NULL)
            """,
            {"td": actual_td},
        )
    conn.commit()
    log.info("Repaired NULL settle_return values using previous-day data.")

    log.info("Futures latest: %d raw rows, %d snapshot rows (trade_date=%s).", raw_cnt, len(snap_records), actual_td)
    return raw_cnt + len(snap_records)


def step_repair_settle_returns(conn) -> int:
    """
    One-shot (and nightly) repair: fill any NULL near_settle_return /
    far_settle_return in derived_futures_snapshot by computing
    (close / prev_settle - 1) * 100 from the preceding trading day's
    settle stored in the same table.

    Safe to run repeatedly; only touches rows where the value is NULL.
    """
    log.info("Repairing NULL settle_return values across all history …")
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH prev AS (
                SELECT
                    symbol,
                    trade_date,
                    near_settle,
                    far_settle,
                    LAG(near_settle) OVER (PARTITION BY symbol ORDER BY trade_date) AS prev_near_settle,
                    LAG(far_settle)  OVER (PARTITION BY symbol ORDER BY trade_date) AS prev_far_settle
                FROM derived_futures_snapshot
            )
            UPDATE derived_futures_snapshot cur
            SET
                near_settle_return = CASE
                    WHEN cur.near_settle_return IS NULL
                         AND cur.near_close IS NOT NULL
                         AND prev.prev_near_settle IS NOT NULL
                         AND prev.prev_near_settle > 0
                    THEN ROUND(100.0 * (cur.near_close / prev.prev_near_settle - 1.0), 6)
                    ELSE cur.near_settle_return
                END,
                far_settle_return = CASE
                    WHEN cur.far_settle_return IS NULL
                         AND cur.far_settle IS NOT NULL
                         AND prev.prev_far_settle IS NOT NULL
                         AND prev.prev_far_settle > 0
                    THEN ROUND(100.0 * (cur.far_settle / prev.prev_far_settle - 1.0), 6)
                    ELSE cur.far_settle_return
                END
            FROM prev
            WHERE cur.symbol = prev.symbol
              AND cur.trade_date = prev.trade_date
              AND (cur.near_settle_return IS NULL OR cur.far_settle_return IS NULL)
            """
        )
        updated = cur.rowcount
    conn.commit()
    log.info("Repaired %d snapshot rows with NULL settle_return.", updated)
    return updated


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

    # Choice may return the latest available trade date if requested day is not ready yet.
    # Persist using the actual returned date to keep DB date semantics correct.
    actual_td = to_date(str(out.get("trade_date", ""))) or trade_date

    records = []
    for item in items:
        code = item.get("code") or ""
        records.append((
            actual_td,
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

def step_compute_basis_daily(conn, *, force: bool = False) -> int:
    """
    For every (symbol, trade_date) where we have continuous-leg data (L and L1)
    in raw_futures_daily AND spot data in raw_spot_daily but NOT yet fully in
    derived_basis_daily (both near AND far), compute annualized basis % and basis diff.
    With force=True, recomputes all dates regardless of existing rows.
    """
    log.info("Computing derived_basis_daily …")
    symbols = ["IH", "IF", "IC", "IM"]
    total = 0

    for sym in symbols:
        near_code = f"{sym}L.CFX"
        far_code  = f"{sym}L1.CFX"

        # Find dates that need computing.
        # Skip a date only when BOTH near AND far rows already exist (count=2).
        # A partial run that wrote only one type will be re-processed.
        with conn.cursor() as cur:
            if force:
                cur.execute(
                    """
                    SELECT DISTINCT f.trade_date
                    FROM raw_futures_daily f
                    JOIN raw_spot_daily s
                        ON s.symbol = %s AND s.trade_date = f.trade_date
                    WHERE f.symbol = %s
                      AND f.ts_code IN (%s, %s)
                    ORDER BY f.trade_date
                    """,
                    (sym, sym, near_code, far_code),
                )
            else:
                cur.execute(
                    """
                    SELECT DISTINCT f.trade_date
                    FROM raw_futures_daily f
                    JOIN raw_spot_daily s
                        ON s.symbol = %s AND s.trade_date = f.trade_date
                    WHERE f.symbol = %s
                      AND f.ts_code IN (%s, %s)
                      AND (
                          SELECT COUNT(DISTINCT basis_type)
                          FROM derived_basis_daily d
                          WHERE d.symbol = %s AND d.trade_date = f.trade_date
                      ) < 2
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

def step_compute_basis_cont_daily(conn, *, force: bool = False) -> int:
    """
    For all (symbol, leg, trade_date) in raw_futures_daily not yet in
    derived_basis_cont_daily, compute basis_diff = futures_settle - spot_close.
    With force=True, recomputes all dates regardless of existing rows.
    """
    log.info("Computing derived_basis_cont_daily …")
    symbols = ["IH", "IF", "IC", "IM"]
    legs    = ["L", "L1", "L2", "L3"]
    total   = 0

    for sym in symbols:
        for leg in legs:
            ts_code = f"{sym}{leg}.CFX"

            with conn.cursor() as cur:
                if force:
                    cur.execute(
                        """
                        SELECT DISTINCT f.trade_date
                        FROM raw_futures_daily f
                        JOIN raw_spot_daily s ON s.symbol = %s AND s.trade_date = f.trade_date
                        WHERE f.ts_code = %s
                        ORDER BY f.trade_date
                        """,
                        (sym, ts_code),
                    )
                else:
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
# STEP 7 — ETF daily prices  (EmQuant / Choice API)
# Column order must match training data: 510300.SH 510500.SH 511010.SH
#                                         511220.SH 511880.SH 518880.SH
# ═══════════════════════════════════════════════════════════════════════════════

def step_etf_prices(conn, trade_date: date, *, force: bool = False) -> int:
    """Fetch ORIGINALUNIT prices for the 6 model-input ETFs for one trade_date."""
    if not force:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(DISTINCT ticker) FROM raw_etf_daily WHERE trade_date = %s",
                (trade_date,),
            )
            count = cur.fetchone()[0]
        if count >= 6:
            log.info("ETF prices for %s already in DB (%d tickers), skipping.", trade_date, count)
            return 0

    log.info("Fetching ETF prices for %s …", trade_date)
    out = run_script("get_etf_prices.py", extra_args=[iso(trade_date), iso(trade_date)])
    if not out or out.get("error"):
        raise RuntimeError(f"ETF price fetch failed: {out}")

    items = out.get("data") or []
    if not items:
        log.warning("ETF prices: no data returned for %s.", trade_date)
        return 0

    records = [
        (item["date"], item["ticker"], item.get("field", "ORIGINALUNIT"), item["value"], "emquant")
        for item in items
        if item.get("date") and item.get("ticker") and item.get("value") is not None
    ]
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_etf_daily (trade_date, ticker, field, value, source)
            VALUES %s
            ON CONFLICT (trade_date, ticker, field) DO UPDATE
                SET value = EXCLUDED.value, fetched_at = NOW()
            """,
            records,
        )
    conn.commit()
    log.info("ETF prices: upserted %d rows for %s.", len(records), trade_date)
    return len(records)


def step_backfill_benchmarks(conn, start: date | None = None, end: date | None = None) -> int:
    """One-off backfill of all benchmark tables used by the 私募基金 detail chart.

    Fills:
      - raw_spot_daily          (IH / IF / IC / IM)  via EmQuant timeseries
      - raw_etf_daily           (all 6 ETFs)          via EmQuant timeseries
      - raw_nanhua_indices_daily (NHCI.NH + 16 others) via EmQuant timeseries

    Can be run on demand:
        python3 nightly_etl.py --step backfill_benchmarks
    Or with a custom start date:
        python3 nightly_etl.py --step backfill_benchmarks --date 2020-01-01
    """
    today = date.today()
    _start = start or date(2020, 1, 1)
    _end   = end   or today
    log.info("backfill_benchmarks: %s → %s", _start, _end)
    total = 0

    # ── 1. Spot index closes: IH / IF / IC / IM ──────────────────────────────
    try:
        n = step_spot_timeseries_backfill(conn, _start, _end)
        log.info("  spot backfill: %d rows", n)
        total += n
    except Exception as exc:
        log.error("  spot backfill failed: %s", exc)

    # ── 2. ETF prices (all 6 tickers used by model + benchmark chart) ─────────
    try:
        n = step_etf_backfill(conn, _start, _end)
        log.info("  ETF backfill: %d rows", n)
        total += n
    except Exception as exc:
        log.error("  ETF backfill failed: %s", exc)

    # ── 3. 南华 sub-indices (includes NHCI.NH) ────────────────────────────────
    # Temporarily lower the module-level backfill-start constant so the step
    # function re-fetches history all the way back to _start instead of 2025.
    global _NH_INDICES_BACKFILL_START  # noqa: PLW0603
    _prev_start = _NH_INDICES_BACKFILL_START
    _NH_INDICES_BACKFILL_START = _start
    try:
        # force=True bypasses the "already up-to-date" early-exit check
        n = step_nanhua_indices(conn, force=True)
        log.info("  NH indices backfill: %d rows", n)
        total += n
    except Exception as exc:
        log.error("  NH indices backfill failed: %s", exc)
    finally:
        _NH_INDICES_BACKFILL_START = _prev_start

    log.info("backfill_benchmarks: total %d rows upserted.", total)
    return total


def step_etf_backfill(conn, start: date, end: date) -> int:
    """Bulk-load ETF prices for a date range (used during initial backfill)."""
    log.info("ETF backfill %s → %s …", start, end)
    out = run_script(
        "get_etf_prices.py",
        extra_args=[iso(start), iso(end)],
        timeout=600,
    )
    if not out or out.get("error"):
        raise RuntimeError(f"ETF backfill failed: {out}")

    items = out.get("data") or []
    if not items:
        log.warning("ETF backfill: no data returned.")
        return 0

    records = [
        (item["date"], item["ticker"], item.get("field", "ORIGINALUNIT"), item["value"], "emquant")
        for item in items
        if item.get("date") and item.get("ticker") and item.get("value") is not None
    ]
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_etf_daily (trade_date, ticker, field, value, source)
            VALUES %s
            ON CONFLICT (trade_date, ticker, field) DO UPDATE
                SET value = EXCLUDED.value, fetched_at = NOW()
            """,
            records,
        )
    conn.commit()
    log.info("ETF backfill: upserted %d rows.", len(records))
    return len(records)


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 8 — Market cluster prediction  (scaler → PCA → GMM)
# Requires raw_etf_daily + raw_nhci_daily to be populated first.
# ═══════════════════════════════════════════════════════════════════════════════

def step_predict_market_cluster(
    conn,
    trade_date: date | None,
    *,
    freq: str = "daily",
    force: bool = False,
) -> int:
    """
    Call predict_market_cluster.py to generate GMM cluster predictions.

    trade_date=None  →  predict all dates that don't yet have a row for this freq
                        (used during initial backfill)
    trade_date=<date> →  predict just that one date (nightly mode)
    """
    if not force and trade_date is not None:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM current_market_prediction WHERE trade_date = %s AND freq = %s",
                (trade_date, freq),
            )
            if cur.fetchone():
                log.info("Market prediction (%s) for %s already exists, skipping.", freq, trade_date)
                return 0

    label = iso(trade_date) if trade_date else "all missing dates"
    log.info("Predicting market cluster (%s): %s …", freq, label)

    extra_args: list[str] = ["--freq", freq, "--no-save"]
    if trade_date:
        extra_args += [iso(trade_date), iso(trade_date)]
    out = run_script("predict_market_cluster.py", extra_args=extra_args, timeout=300)
    if not out or out.get("error"):
        raise RuntimeError(f"Market prediction ({freq}) failed: {out}")

    predictions = out.get("data") or []
    if not predictions:
        log.info("No new predictions returned for freq=%s.", freq)
        return 0

    records = [
        (r["date"], r["cluster"], r["pc1"], r["pc2"], r.get("freq", freq))
        for r in predictions
        if r.get("date") and r.get("cluster") is not None
    ]
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
    log.info("Market prediction (%s): upserted %d rows.", freq, len(records))
    return len(records)


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def latest_trade_date() -> date:
    """Target previous trading day for scheduled night runs (e.g. 01:00 local)."""
    today = date.today()
    wd    = today.weekday()  # 0=Mon … 6=Sun
    # Nightly run should settle on yesterday's market data, not "today".
    # Mon -> Fri, Tue..Fri -> previous day, Sat/Sun -> previous Friday.
    if wd == 0:
        return today - timedelta(days=3)
    if wd == 5:
        return today - timedelta(days=1)
    if wd == 6:
        return today - timedelta(days=2)
    return today - timedelta(days=1)


JOB_NAME = "nightly_etl"

def step_regime_indicators(conn, *, force: bool = False) -> int:
    """Fetch monthly macro indicators (PMI, M1, CPI, bond yields, NHCI) into DB."""
    result = run_script("fetch_regime_indicators.py", timeout=300)
    return result.get("upserted", 0) if result else 0


def step_regime_similarity(conn) -> int:
    """Compute rolling z-score regime similarity and save top-20 results to DB."""
    result = run_script("calc_regime_similarity.py", timeout=120)
    if result and result.get("status") == "ok":
        return result.get("rows_top", 0)
    return 0


def step_shibor_3m(conn, *, force: bool = False) -> int:
    """Fetch monthly SHIBOR 3M data from akshare into shibor_3m_monthly."""
    result = run_script("fetch_shibor_3m.py", timeout=120)
    return result.get("upserted", 0) if result else 0


def step_money_credit(conn) -> int:
    """Compute 货币+信用 cycle from DB data and upsert into money_credit_cycle."""
    result = run_script("calc_money_credit.py", timeout=120)
    if result and result.get("status") == "ok":
        return result.get("rows", 0)
    return 0


# ═══════════════════════════════════════════════════════════════════════════════
# STEP — Futures rollover dates (dominant-contract OI tracking via AkShare)
# ═══════════════════════════════════════════════════════════════════════════════


def step_futures_rollover_dates(conn, *, force: bool = False) -> int:
    """Detect and store main-contract rollover dates for commodity futures.

    Uses ak.get_futures_daily() to find the dominant contract (max open-interest)
    per product per day across SHFE / DCE / CZCE / INE.  A rollover date is a
    day when the dominant contract changes.  Stored results replace the 4σ
    heuristic used by the vol-corr-scatter API endpoint.

    Supported exchanges: SHFE, DCE, CZCE, INE
    Not supported: GFEX (akshare does not yet provide get_futures_daily for GFEX);
                   the API falls back to 4σ for GFEX products.
    """
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_futures_rollover_dates (
                product         TEXT        NOT NULL,
                rollover_date   DATE        NOT NULL,
                from_contract   TEXT,
                to_contract     TEXT,
                source          TEXT        NOT NULL DEFAULT 'akshare',
                fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (product, rollover_date)
            )
        """)
    conn.commit()

    today = date.today()
    cur_max = max_date(conn, "raw_futures_rollover_dates", col="rollover_date")

    if not force and cur_max and cur_max >= today - timedelta(days=1):
        log.info("Futures rollover dates up-to-date (%s), skipping.", cur_max)
        return 0

    # First run / force: backfill from 2023-01-01
    # Incremental: re-fetch from 30 days before last known date (catches late OI updates)
    if cur_max is None or force:
        start = date(2023, 1, 1)
        log.info(
            "Futures rollover dates: %s, backfilling from %s …",
            "forced" if force else "first run",
            start,
        )
    else:
        start = cur_max - timedelta(days=30)
        log.info("Futures rollover dates: incremental %s → %s …", start, today)

    out = run_script(
        "fetch_futures_rollover_dates.py",
        extra_args=[iso(start), iso(today)],
        timeout=1200,
        log_stderr=True,
    )
    if not out or out.get("error"):
        raise RuntimeError(f"Futures rollover dates fetch failed: {out}")

    rows_raw = out.get("data") or []
    if not rows_raw:
        log.warning(
            "Futures rollover dates: no rollovers detected for %s → %s.", start, today
        )
        return 0

    records = []
    for r in rows_raw:
        d = to_date(r.get("rollover_date", "").replace("-", ""))
        product = (r.get("product") or "").strip().upper()
        if not d or not product:
            continue
        records.append((
            product,
            d,
            r.get("from_contract") or None,
            r.get("to_contract") or None,
            "akshare",
        ))

    if not records:
        log.warning("Futures rollover dates: no valid rows parsed.")
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_futures_rollover_dates
                (product, rollover_date, from_contract, to_contract, source)
            VALUES %s
            ON CONFLICT (product, rollover_date) DO UPDATE
                SET from_contract = EXCLUDED.from_contract,
                    to_contract   = EXCLUDED.to_contract,
                    fetched_at    = NOW()
            """,
            records,
        )
    conn.commit()
    log.info("Futures rollover dates: upserted %d rows.", len(records))
    return len(records)


# ═══════════════════════════════════════════════════════════════════════════════
# STEP — Warm MOM dashboard API caches
# ═══════════════════════════════════════════════════════════════════════════════

def step_private_fund_indicators(conn) -> int:
    """Recompute ret_1w/1m/3m/6m/1y, sharpe_1y, calmar_1y for every fund in
    private_fund_info from the raw private_fund_nav time-series.

    Delegates to scripts/ma/private_fund_indicators_etl.py (same logic as manual runs).
    """
    _ = conn  # standalone script uses DATABASE_URL / DB_* from env
    log.info("private_fund_indicators: running private_fund_indicators_etl.py …")
    script_path = SCRIPT_DIR / "private_fund_indicators_etl.py"
    python_exe = os.environ.get("PYTHON_EXE") or (
        "py" if sys.platform == "win32" else "python3"
    )
    prefix = ["py", "-3"] if sys.platform == "win32" and python_exe == "py" else [python_exe]
    result = subprocess.run(
        prefix + [str(script_path)],
        capture_output=True,
        text=True,
        timeout=3600,
        env={**os.environ},
        cwd=str(SCRIPT_DIR.parent.parent),
    )
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()
    if stdout:
        log.info(stdout)
    if stderr:
        for line in stderr.splitlines():
            log.info(line)
    if result.returncode != 0:
        raise RuntimeError(
            f"private_fund_indicators_etl.py failed (exit {result.returncode}): "
            f"{stderr or stdout or 'no output'}"
        )
    match = re.search(r"Done\.\s+(\d+)\s+funds updated", stderr + stdout)
    if match:
        return int(match.group(1))
    match = re.search(r"ETL completed successfully \((\d+) funds\)", stderr + stdout)
    if match:
        return int(match.group(1))
    return 0


def step_investment_pool_metrics() -> int:
    """Refresh 在管产品 + FOF底层 + 跟踪产品 list caches from stored email NAV / 估值表."""
    log.info("investment_pool_metrics: rebuilding managed / FOF / tracking list caches …")
    result = run_node_script("email_nav_etl.ts", extra_args=["--refresh-only"], timeout=3600)
    if not result:
        raise RuntimeError("investment_pool_metrics: no result from email_nav_etl.ts")
    if not result.get("ok"):
        raise RuntimeError(
            f"investment_pool_metrics: failed — {result.get('error', 'unknown')}"
        )

    managed = int(result.get("listCacheRefreshed") or 0)
    fof = int(result.get("fofOverviewListCacheRefreshed") or 0)
    tracking = int(result.get("trackingFundsListCacheRefreshed") or 0)
    managed_valuation = int(result.get("managedProductsValuationSynced") or 0)
    fof_market = int(result.get("fofUnderlyingMarketSynced") or 0)
    fof_holdings = int(result.get("managedFofUnderlyingRefreshed") or 0)

    log.info(
        "investment_pool_metrics: managed=%d fof=%d tracking=%d "
        "valuation_sync(managed=%d fof=%d) fof_holdings=%d",
        managed,
        fof,
        tracking,
        managed_valuation,
        fof_market,
        fof_holdings,
    )
    return managed + fof + tracking


def step_tracking_fund_metrics() -> int:
    """Backward-compatible alias for investment_pool_metrics."""
    return step_investment_pool_metrics()


def step_email_nav_parse(days: int | None = None) -> int:
    """Crawl fund emails, parse NAV/估值表 attachments, upsert ops_email_nav_records."""
    lookback = days
    if lookback is None:
        try:
            lookback = int(os.environ.get("EMAIL_NAV_ETL_DAYS", "400"))
        except ValueError:
            lookback = 400

    log.info("email_nav_parse: fetching fund emails (last %d days) …", lookback)
    result = run_node_script(
        "email_nav_etl.ts",
        extra_args=["--parse-only", f"--days={lookback}"],
        timeout=1800,
    )
    if not result:
        raise RuntimeError("email_nav_parse: no result from email_nav_etl.ts")

    if result.get("skipped"):
        log.warning("email_nav_parse: skipped — %s", result.get("error", "not configured"))
        return 0

    nav_saved = int(result.get("navSaved") or 0)
    valuation_saved = int(result.get("valuationSaved") or 0)
    emails_scanned = int(result.get("emailsScanned") or 0)
    records_found = int(result.get("recordsFound") or 0)
    errors = result.get("errors") or []

    log.info(
        "email_nav_parse: emails=%d records=%d nav_saved=%d valuation_saved=%d errors=%d",
        emails_scanned,
        records_found,
        nav_saved,
        valuation_saved,
        len(errors),
    )
    for err in errors[:8]:
        log.warning("  email_nav_parse: %s", err)
    return nav_saved + valuation_saved


def step_warm_mom_cache() -> int:
    """Call the /ma/api/mom-analysis/warm-cache endpoint to pre-compute all chart data."""
    import urllib.request
    base = os.environ.get("WARM_CACHE_BASE_URL", "http://127.0.0.1:3000")
    url = f"{base}/ma/api/mom-analysis/warm-cache"
    log.info("Warming MOM cache via %s …", url)
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read().decode())
        routes = body.get("results") or []
        ok_count = sum(1 for r in routes if r.get("ok"))
        total_ms = body.get("totalMs", 0)
        log.info("MOM cache warmed: %d/%d routes OK in %.1fs", ok_count, len(routes), total_ms / 1000)
        return ok_count
    except Exception as exc:
        log.warning("Cache warming failed (non-fatal): %s", exc)
        return 0


ORDERED_STEPS = [
    "nhci",
    "nheci",
    "nanhua_indices",              # all 17 NH sub-indices OHLCV
    "nanhua_commodity_indices",    # all 80 NH single-commodity indices OHLCV
    "futures_contracts_ohlcv",      # OHLCV for every futures contract MOM traded (EmQuant)
    "akshare_exchange_daily",       # per-contract volume+OI from exchange bulletins (free fallback)
    "options_contracts_ohlcv",      # OHLCV + greeks for every options contract MOM traded
    "akshare_futures_daily",        # 87 continuous contracts via AkShare/Sina (no auth)
    "futures_rollover_dates",       # rollover dates from OI-dominant-contract tracking
    "spot_closes",
    "futures_latest",
    "commodity_amounts",
    "derive_basis",
    "derive_basis_cont",
    "repair_settle_returns",
    "etf_prices",                    # nightly: today only
    "etf_extended_backfill",         # on-demand: re-fetch 2 years of ETF history
    "predict_market_cluster",        # daily
    "predict_market_cluster_weekly",
    "predict_market_cluster_monthly",
    "regime_indicators",             # monthly macro indicators for regime model
    "regime_similarity",             # compute economic regime similarity
    "shibor_3m",                     # monthly SHIBOR 3M data
    "money_credit",                  # money+credit cycle calculation
    "email_nav_parse",               # crawl fund emails → ops_email_nav_records + 估值表 (allocation trend history)
    "private_fund_indicators",       # recompute 私募基金 dashboard metrics from NAV
    "investment_pool_metrics",       # 在管产品 + FOF底层 + 跟踪产品 list caches
    "warm_mom_cache",                # warm MOM dashboard API caches
    "backfill_benchmarks",           # one-time: fill raw_spot_daily / raw_etf_daily / raw_nanhua_indices_daily from 2020
]


def _needs_backfill(conn: object) -> bool:
    return (
        row_count(conn, "raw_futures_daily") == 0
        or row_count(conn, "raw_etf_daily") == 0
    )


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

    # Backfill 2 years of ETF prices so monthly resampling has enough history
    etf_start = trade_date - timedelta(days=760)
    try:
        step_etf_backfill(conn, etf_start, trade_date)
        log_run(conn, JOB_NAME, "backfill_etf", "success", trade_date)
    except Exception as exc:
        log.warning("ETF backfill failed (non-fatal): %s", exc)
        log_run(conn, JOB_NAME, "backfill_etf", "failed", trade_date, error=str(exc))

    # Run predictions for all newly backfilled dates
    for freq in ("daily", "weekly", "monthly"):
        try:
            step_predict_market_cluster(conn, None, freq=freq, force=False)
            log_run(conn, JOB_NAME, f"backfill_predict_cluster_{freq}", "success", trade_date)
        except Exception as exc:
            log.warning("Market prediction backfill (%s) failed (non-fatal): %s", freq, exc)
            log_run(conn, JOB_NAME, f"backfill_predict_cluster_{freq}", "failed", trade_date, error=str(exc))


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Nightly market data ETL")
    parser.add_argument("--step", choices=ORDERED_STEPS, help="Run a single step only")
    parser.add_argument("--backfill", action="store_true", help="Force full history reload")
    parser.add_argument("--force", action="store_true", help="Re-fetch even if data already in DB")
    parser.add_argument("--date", help="Override target trade date (YYYY-MM-DD or YYYYMMDD)")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info("Nightly ETL starting  (pid=%d)", os.getpid())
    log.info("=" * 60)

    if args.date:
        td = to_date(args.date)
        if not td:
            log.error("Invalid --date value: %s (use YYYY-MM-DD or YYYYMMDD)", args.date)
            sys.exit(1)
        log.info("Target trade date: %s  (overridden via --date)", td)
    else:
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
        "nheci":            lambda: step_nheci(conn, force=force),
        "nanhua_indices":            lambda: step_nanhua_indices(conn, force=force),
        "nanhua_commodity_indices":  lambda: step_nanhua_commodity_indices(conn, force=force),
        "futures_contracts_ohlcv":    lambda: step_futures_contracts_ohlcv(conn, force=force),
        "akshare_exchange_daily":      lambda: step_akshare_exchange_daily(conn, force=force),
        "options_contracts_ohlcv":    lambda: step_options_contracts_ohlcv(conn, force=force),
        "akshare_futures_daily":      lambda: step_akshare_futures_daily(conn, force=force),
        "futures_rollover_dates":     lambda: step_futures_rollover_dates(conn, force=force),
        "spot_closes":      lambda: step_spot_closes(conn, td, force=force),
        "futures_latest":   lambda: step_futures_latest(conn, td, force=force),
        "commodity_amounts":lambda: step_commodity_amounts(conn, td, force=force),
        "derive_basis":          lambda: step_compute_basis_daily(conn, force=force),
        "derive_basis_cont":     lambda: step_compute_basis_cont_daily(conn, force=force),
        "repair_settle_returns": lambda: step_repair_settle_returns(conn),
        "etf_prices":            lambda: step_etf_prices(conn, td, force=force),
        "etf_extended_backfill": lambda: step_etf_backfill(conn, td - timedelta(days=760), td),
        "predict_market_cluster":          lambda: step_predict_market_cluster(conn, None, freq="daily",   force=force),
        "predict_market_cluster_weekly":   lambda: step_predict_market_cluster(conn, None, freq="weekly",  force=force),
        "predict_market_cluster_monthly":  lambda: step_predict_market_cluster(conn, None, freq="monthly", force=force),
        "regime_indicators":               lambda: step_regime_indicators(conn, force=force),
        "regime_similarity":               lambda: step_regime_similarity(conn),
        "shibor_3m":                       lambda: step_shibor_3m(conn, force=force),
        "money_credit":                    lambda: step_money_credit(conn),
        "email_nav_parse":                 lambda: step_email_nav_parse(),
        "private_fund_indicators":         lambda: step_private_fund_indicators(conn),
        "investment_pool_metrics":         lambda: step_investment_pool_metrics(),
        "tracking_fund_metrics":           lambda: step_tracking_fund_metrics(),
        "warm_mom_cache":                  lambda: step_warm_mom_cache(),
        "backfill_benchmarks":             lambda: step_backfill_benchmarks(conn, start=date(2020, 1, 1)),
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
