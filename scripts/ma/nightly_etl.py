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
  python scripts/ma/nightly_etl.py --step amac_private_funds
  python scripts/ma/nightly_etl.py --step amac_futures
  python scripts/ma/nightly_etl.py --step amac_extra
  python scripts/ma/nightly_etl.py --step investment_pool_metrics
  python scripts/ma/nightly_etl.py --step dd_materials_links
  python scripts/ma/nightly_etl.py --group macro   # macro-market charts only
  python scripts/ma/nightly_etl.py --group stock   # stock-market charts only (A-share crowding)
  python scripts/ma/nightly_etl.py --group amac    # AMAC fund + futures 资管 lists → private_fund_info
  python scripts/ma/nightly_etl.py --backfill    # force full history reload (2023-01-01 → today)

Optional env:
  EMAIL_NAV_ETL_DAYS                    — explicit backfill lookback when --days=N is passed (default 400)
  EMAIL_NAV_ETL_INITIAL_DAYS            — first-time mailbox scan window (default 400)
  EMAIL_NAV_ETL_OVERLAP_DAYS            — incremental scan overlap before last parsed mail (default 2)
  AMAC_ETL_INCREMENTAL_MAX_PAGES        — AMAC nightly incremental page cap (default 80)
  AMAC_ETL_INCREMENTAL_MIN_PAGES        — minimum AMAC pages refreshed nightly (default 40)
  AMAC_ETL_FULL_SYNC_DOW                — weekday for weekly full AMAC sync, 0=Mon..6=Sun (default 6)
  AMAC_EXTRA_ETL_DETAIL_BATCH_SIZE      — nightly stale manager-detail refresh batch (default 300)
  AMAC_EXTRA_ETL_REQUEST_DELAY          — delay between AMAC extra requests (default 0.3)

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
import signal
import subprocess
import sys
import threading
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
PROJECT_ROOT = SCRIPT_DIR.parent.parent

# Model-input ETFs for PCA / GMM market prediction
PCA_ETF_TICKERS = [
    "510300.SH",
    "510500.SH",
    "511010.SH",
    "511220.SH",
    "511880.SH",
    "518880.SH",
]


def _python_path_ok(exe: str) -> bool:
    if exe in ("py", "python", "python3"):
        return True
    try:
        return Path(exe).is_file()
    except OSError:
        return False


def _resolve_python_exe() -> str:
    """Resolve interpreter for child scripts.

    Prefer, in order:
      1. Explicit PYTHON_EXE path (if the file still exists)
      2. The interpreter currently running this ETL (sys.executable)
      3. Project .venv
      4. Platform default

    Using sys.executable avoids a common failure mode where the outer job
    launcher picks a Python that has akshare/deps, but child scripts were
    force-routed to a .venv that is missing those packages — leaving
    ashare_daily stuck and stock-market charts frozen.
    """
    env_exe = (os.environ.get("PYTHON_EXE") or "").strip()
    if env_exe and env_exe not in ("py", "python", "python3"):
        if _python_path_ok(env_exe):
            return env_exe
        log.warning("PYTHON_EXE=%s is missing; falling back", env_exe)

    # Same interpreter that is already running nightly_etl.py (has working deps).
    if sys.executable and _python_path_ok(sys.executable):
        return sys.executable

    if sys.platform == "win32":
        venv_candidates = [
            PROJECT_ROOT / ".venv" / "Scripts" / "python.exe",
            PROJECT_ROOT / "venv" / "Scripts" / "python.exe",
        ]
    else:
        venv_candidates = [
            PROJECT_ROOT / ".venv" / "bin" / "python3",
            PROJECT_ROOT / ".venv" / "bin" / "python",
            PROJECT_ROOT / "venv" / "bin" / "python3",
            PROJECT_ROOT / "venv" / "bin" / "python",
        ]
    for cand in venv_candidates:
        if cand.is_file():
            return str(cand)

    if env_exe and env_exe in ("py", "python", "python3"):
        return env_exe
    return "py" if sys.platform == "win32" else "python3"


def _python_cmd(*args: str) -> list[str]:
    python_exe = _resolve_python_exe()
    prefix = ["py", "-3"] if sys.platform == "win32" and python_exe == "py" else [python_exe]
    return prefix + [str(a) for a in args]


def _kill_process_tree(proc: subprocess.Popen) -> None:
    """Force-kill a child (and its process group on Unix).

    Used after communicate() timeouts. A bare proc.kill() is not enough when the
    child has spawned helpers, and a second communicate() without a timeout can
    hang forever if pipes/readers are wedged — that previously left nightly ETL
    stuck on option_iv for ~20h and blocked later steps like akshare_futures_daily.
    """
    if proc.poll() is not None:
        return
    try:
        if sys.platform != "win32" and proc.pid:
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            proc.kill()
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except (ProcessLookupError, OSError):
            pass


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
    # Avoid tqdm pipe-fill deadlocks when stderr is captured.
    env.setdefault("TQDM_DISABLE", "1")
    if extra_env:
        env.update(extra_env)

    python_exe = _resolve_python_exe()
    prefix = ["py", "-3"] if sys.platform == "win32" and python_exe == "py" else [python_exe]
    cmd = prefix + [str(script_path)] + (extra_args or [])

    try:
        # Use a new session on Unix so timeout can kill the whole process group.
        # Rely solely on communicate() to drain stdout/stderr — a competing
        # stderr reader thread previously raced communicate() and could prevent
        # clean timeout teardown (nightly ETL hung overnight on option_iv).
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            start_new_session=(sys.platform != "win32"),
        )
        try:
            stdout, stderr = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            log.error("[%s] timed out after %ds — killing process tree", script_name, timeout)
            _kill_process_tree(proc)
            try:
                stdout, stderr = proc.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                _kill_process_tree(proc)
                stdout, stderr = "", ""
            return None
        stderr = (stderr or "").strip()
        stdout = (stdout or "").strip()
        if proc.returncode != 0:
            log.warning("[%s] exit %d: %s", script_name, proc.returncode, stderr[:800])
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
    """Return the third Friday of the current or next month after from_date (当月/L)."""
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


def far_expiry(from_date: date) -> date:
    """Expiry of the next-month continuous (次月/L1): third Friday after near expiry's month."""
    near = next_expiry(from_date)
    y, m = near.year, near.month
    if m == 12:
        y, m = y + 1, 1
    else:
        m += 1
    return third_friday(y, m)


_CFFEX_INDEX_PRODUCTS = ("IH", "IF", "IC", "IM")


def listed_cffex_index_yms(as_of: date) -> list[tuple[int, int]]:
    """CFFEX index futures window: 当月 / 次月 / 当季 / 下季."""
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
    quarterly: list[tuple[int, int]] = []
    yy, mm = y2, m2
    while len(quarterly) < 2:
        mm += 1
        if mm > 12:
            mm, yy = 1, yy + 1
        if mm in (3, 6, 9, 12):
            quarterly.append((yy, mm))
    return [near, nxt, quarterly[0], quarterly[1]]


def listed_cffex_index_roots(as_of: date) -> list[str]:
    return [
        f"{base}{y % 100:02d}{m:02d}"
        for base in _CFFEX_INDEX_PRODUCTS
        for y, m in listed_cffex_index_yms(as_of)
    ]


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


def max_valid_close_date(conn, table: str, extra_where: str = "") -> date | None:
    """Max trade_date that has a usable close, so empty pre-close rows cannot freeze skip logic."""
    where = "close IS NOT NULL AND close > 0"
    if extra_where:
        where = f"{where} AND ({extra_where})"
    with conn.cursor() as cur:
        cur.execute(f"SELECT MAX(trade_date) FROM {table} WHERE {where}")  # noqa: S608
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
    cur_max = max_valid_close_date(conn, "raw_nanhua_indices_daily")

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
        cl   = safe_float(r.get("close"))
        if not d or not code or cl is None or cl <= 0:
            continue
        records.append((
            d, code,
            r.get("name") or "",
            safe_float(r.get("open")),
            cl,
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
# STEP 1c — China financial option IV (cross-section + QVIX)
# ═══════════════════════════════════════════════════════════════════════════════


def _upsert_option_iv_structure_metrics(conn, underlyings: dict, trade_date) -> int:
    """Persist daily skew / term-slope / PCR for historical charts."""
    records = []
    for key, payload in underlyings.items():
        charts = (payload or {}).get("charts") or {}
        skew = charts.get("skew") or {}
        term = charts.get("term_slope") or {}
        pcr = charts.get("pcr") or {}
        records.append((
            trade_date,
            key,
            skew.get("risk_reversal"),
            skew.get("butterfly"),
            skew.get("put_wing_5pct"),
            skew.get("call_wing_5pct"),
            term.get("slope"),
            pcr.get("pcr_oi"),
        ))
    if not records:
        return 0
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_option_iv_structure_daily
                (trade_date, underlying_key, risk_reversal, butterfly,
                 put_wing_5pct, call_wing_5pct, term_slope, pcr_oi)
            VALUES %s
            ON CONFLICT (trade_date, underlying_key) DO UPDATE
                SET risk_reversal = EXCLUDED.risk_reversal,
                    butterfly = EXCLUDED.butterfly,
                    put_wing_5pct = EXCLUDED.put_wing_5pct,
                    call_wing_5pct = EXCLUDED.call_wing_5pct,
                    term_slope = EXCLUDED.term_slope,
                    pcr_oi = EXCLUDED.pcr_oi,
                    fetched_at = NOW()
            """,
            records,
        )
    conn.commit()
    return len(records)


def _attach_option_iv_structure_history(conn, underlyings: dict) -> dict:
    """Attach rolling structure history series onto chart payloads."""
    if not underlyings:
        return underlyings
    with conn.cursor() as cur:
        for key, payload in underlyings.items():
            cur.execute(
                """
                SELECT trade_date, risk_reversal, butterfly, put_wing_5pct,
                       call_wing_5pct, term_slope, pcr_oi
                FROM raw_option_iv_structure_daily
                WHERE underlying_key = %s
                ORDER BY trade_date
                """,
                (key,),
            )
            rows = cur.fetchall()
            if not rows:
                continue
            skew_series = []
            term_series = []
            pcr_series = []
            for r in rows:
                td = r[0].isoformat() if hasattr(r[0], "isoformat") else str(r[0])[:10]
                if r[1] is not None:
                    skew_series.append({
                        "trade_date": td,
                        "risk_reversal": float(r[1]) if r[1] is not None else None,
                        "butterfly": float(r[2]) if r[2] is not None else None,
                        "put_wing_5pct": float(r[3]) if r[3] is not None else None,
                        "call_wing_5pct": float(r[4]) if r[4] is not None else None,
                    })
                if r[5] is not None:
                    term_series.append({
                        "trade_date": td,
                        "slope": float(r[5]),
                    })
                if r[6] is not None:
                    pcr_series.append({
                        "trade_date": td,
                        "pcr_oi": float(r[6]),
                    })
            charts = dict(payload.get("charts") or {})
            if skew_series:
                skew = dict(charts.get("skew") or {})
                skew["series"] = skew_series[-504:]
                charts["skew"] = skew
            if term_series:
                term = dict(charts.get("term_slope") or {})
                term["series"] = term_series[-504:]
                charts["term_slope"] = term
            if pcr_series:
                pcr = dict(charts.get("pcr") or {})
                pcr["series"] = pcr_series[-504:]
                charts["pcr"] = pcr
            payload["charts"] = charts
            underlyings[key] = payload
    return underlyings


def _refresh_option_iv_payloads_from_db(conn, underlyings: dict) -> dict:
    """Rebuild QVIX history/percentile charts from DB (includes snapshot extensions)."""
    import pandas as pd

    option_iv_dir = Path(__file__).resolve().parent / "option_iv"
    if str(option_iv_dir) not in sys.path:
        sys.path.insert(0, str(option_iv_dir))
    from serialize import apply_qvix_charts  # noqa: WPS433
    from synthetic_qvix import SYNTHETIC_QVIX_KEYS, merge_synthetic_qvix_gaps  # noqa: WPS433

    refreshed: dict = {}
    with conn.cursor() as cur:
        for key, payload in underlyings.items():
            cur.execute(
                """
                SELECT trade_date, iv, open, high, low
                FROM raw_option_iv_qvix_daily
                WHERE underlying_key = %s
                ORDER BY trade_date
                """,
                (key,),
            )
            rows = cur.fetchall()
            if not rows:
                refreshed[key] = payload
                continue
            df = pd.DataFrame(rows, columns=["trade_date", "iv", "open", "high", "low"])
            df["trade_date"] = pd.to_datetime(df["trade_date"])
            for col in ("iv", "open", "high", "low"):
                df[col] = pd.to_numeric(df[col], errors="coerce")
            if key in SYNTHETIC_QVIX_KEYS:
                df = merge_synthetic_qvix_gaps(key, df)
            refreshed[key] = apply_qvix_charts(dict(payload), df)
    return refreshed


def _upsert_synthetic_qvix_gaps(conn) -> int:
    """Backfill CFFEX index QVIX gaps when the optbbs feed stops updating."""
    import pandas as pd

    option_iv_dir = Path(__file__).resolve().parent / "option_iv"
    if str(option_iv_dir) not in sys.path:
        sys.path.insert(0, str(option_iv_dir))
    from serialize import _is_flat_snapshot_row  # noqa: WPS433
    from synthetic_qvix import SYNTHETIC_QVIX_KEYS, merge_synthetic_qvix_gaps  # noqa: WPS433

    inserted = 0
    with conn.cursor() as cur:
        for key in SYNTHETIC_QVIX_KEYS:
            cur.execute(
                """
                SELECT trade_date, iv, open, high, low
                FROM raw_option_iv_qvix_daily
                WHERE underlying_key = %s
                ORDER BY trade_date
                """,
                (key,),
            )
            rows = cur.fetchall()
            if not rows:
                continue
            df = pd.DataFrame(rows, columns=["trade_date", "iv", "open", "high", "low"])
            df["trade_date"] = pd.to_datetime(df["trade_date"])
            for col in ("iv", "open", "high", "low"):
                df[col] = pd.to_numeric(df[col], errors="coerce")
            before_dates = set(df["trade_date"].dt.date)
            try:
                merged = merge_synthetic_qvix_gaps(key, df)
            except Exception as exc:  # noqa: BLE001
                log.warning("Synthetic QVIX gap fill skipped for %s: %s", key, exc)
                continue
            rows_to_upsert = []
            for row in merged.itertuples():
                trade_day = pd.Timestamp(row.trade_date).date()
                if trade_day not in before_dates:
                    rows_to_upsert.append(row)
                    continue
                existing = df.loc[df["trade_date"].dt.date == trade_day]
                if not existing.empty and _is_flat_snapshot_row(existing.iloc[-1]):
                    rows_to_upsert.append(row)
            if not rows_to_upsert:
                continue
            records = [
                (
                    pd.Timestamp(row.trade_date).date(),
                    key,
                    float(row.iv) if pd.notna(row.iv) else None,
                    float(row.open) if pd.notna(row.open) else None,
                    float(row.high) if pd.notna(row.high) else None,
                    float(row.low) if pd.notna(row.low) else None,
                )
                for row in rows_to_upsert
            ]
            execute_values(
                cur,
                """
                INSERT INTO raw_option_iv_qvix_daily
                    (trade_date, underlying_key, iv, open, high, low)
                VALUES %s
                ON CONFLICT (trade_date, underlying_key) DO UPDATE
                    SET iv = EXCLUDED.iv,
                        open = EXCLUDED.open,
                        high = EXCLUDED.high,
                        low = EXCLUDED.low,
                        fetched_at = NOW()
                """,
                records,
            )
            inserted += len(records)
            log.info("Option IV: added %d synthetic QVIX row(s) for %s.", len(records), key)
    if inserted:
        conn.commit()
    return inserted


def step_option_iv(conn, *, force: bool = False) -> int:
    """Fetch financial option IV snapshot + QVIX history via AkShare.

    Source script : fetch_option_iv_daily.py  (option_iv package)
    Target tables :
      raw_option_iv_qvix_daily      — QVIX time series per underlying
      derived_option_iv_snapshot    — latest chart-ready JSON per underlying
    """

    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_option_iv_qvix_daily (
                trade_date      DATE        NOT NULL,
                underlying_key  TEXT        NOT NULL,
                iv              NUMERIC,
                open            NUMERIC,
                high            NUMERIC,
                low             NUMERIC,
                fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, underlying_key)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS derived_option_iv_snapshot (
                trade_date      DATE        NOT NULL,
                underlying_key  TEXT        NOT NULL,
                label           TEXT        NOT NULL,
                group_label     TEXT,
                spot            NUMERIC,
                current_iv      NUMERIC,
                percentile_all  NUMERIC,
                percentile_1y   NUMERIC,
                chart_data      JSONB       NOT NULL,
                fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, underlying_key)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_option_iv_structure_daily (
                trade_date      DATE        NOT NULL,
                underlying_key  TEXT        NOT NULL,
                risk_reversal   NUMERIC,
                butterfly       NUMERIC,
                put_wing_5pct   NUMERIC,
                call_wing_5pct  NUMERIC,
                term_slope      NUMERIC,
                pcr_oi          NUMERIC,
                fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, underlying_key)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_option_iv_structure_key_date
              ON raw_option_iv_structure_daily (underlying_key, trade_date DESC)
        """)
    conn.commit()

    today = date.today()
    target = latest_trade_date()
    with conn.cursor() as cur:
        cur.execute("""
            SELECT underlying_key, MAX(trade_date) AS max_date
            FROM raw_option_iv_qvix_daily
            GROUP BY underlying_key
        """)
        qvix_by_key = {row[0]: row[1] for row in cur.fetchall()}

    if not force and qvix_by_key:
        stale = [k for k, d in qvix_by_key.items() if d < target]
        if not stale:
            log.info("Option IV QVIX up-to-date for all underlyings (>= %s), skipping.", target)
            return 0
        log.info("Option IV: refreshing stale underlyings (< %s): %s", target, ", ".join(stale))

    log.info("Option IV: fetching cross-section + QVIX …")
    # Hard-cap wall time; run_script kills the process group on timeout.
    out = run_script(
        "fetch_option_iv_daily.py",
        timeout=900,
        log_stderr=True,
    )
    if not out or out.get("error"):
        raise RuntimeError(f"Option IV fetch failed: {out}")

    trade_date = to_date(out.get("trade_date")) or today
    underlyings = out.get("underlyings") or {}
    qvix_rows = out.get("qvix_rows") or []

    qvix_records = [
        (
            to_date(r["trade_date"]),
            r["underlying_key"],
            r.get("iv"),
            r.get("open"),
            r.get("high"),
            r.get("low"),
        )
        for r in qvix_rows
        if r.get("trade_date") and r.get("underlying_key")
    ]

    total = 0
    with conn.cursor() as cur:
        if qvix_records:
            execute_values(
                cur,
                """
                INSERT INTO raw_option_iv_qvix_daily
                    (trade_date, underlying_key, iv, open, high, low)
                VALUES %s
                ON CONFLICT (trade_date, underlying_key) DO UPDATE
                    SET iv = EXCLUDED.iv,
                        open = EXCLUDED.open,
                        high = EXCLUDED.high,
                        low = EXCLUDED.low,
                        fetched_at = NOW()
                """,
                qvix_records,
            )
            total += len(qvix_records)

    conn.commit()
    total += _upsert_synthetic_qvix_gaps(conn)
    underlyings = _refresh_option_iv_payloads_from_db(conn, underlyings)
    total += _upsert_option_iv_structure_metrics(conn, underlyings, trade_date)
    underlyings = _attach_option_iv_structure_history(conn, underlyings)

    snapshot_records = []
    for key, payload in underlyings.items():
        snapshot_records.append((
            trade_date,
            key,
            payload.get("label") or key,
            payload.get("group"),
            payload.get("spot"),
            payload.get("current_iv"),
            payload.get("percentile_all"),
            payload.get("percentile_1y"),
            json.dumps(payload, ensure_ascii=False),
        ))

    with conn.cursor() as cur:
        if snapshot_records:
            execute_values(
                cur,
                """
                INSERT INTO derived_option_iv_snapshot
                    (trade_date, underlying_key, label, group_label,
                     spot, current_iv, percentile_all, percentile_1y, chart_data)
                VALUES %s
                ON CONFLICT (trade_date, underlying_key) DO UPDATE
                    SET label = EXCLUDED.label,
                        group_label = EXCLUDED.group_label,
                        spot = EXCLUDED.spot,
                        current_iv = EXCLUDED.current_iv,
                        percentile_all = EXCLUDED.percentile_all,
                        percentile_1y = EXCLUDED.percentile_1y,
                        chart_data = EXCLUDED.chart_data,
                        fetched_at = NOW()
                """,
                snapshot_records,
            )
            total += len(snapshot_records)

    conn.commit()
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM derived_option_iv_snapshot
            WHERE trade_date > %s
            """,
            (trade_date,),
        )
        if cur.rowcount:
            log.info("Option IV: removed %d stale snapshot row(s) after %s.", cur.rowcount, trade_date)
    conn.commit()
    log.info(
        "Option IV: upserted %d QVIX rows + %d snapshot rows (trade_date=%s, underlyings=%d).",
        len(qvix_records),
        len(snapshot_records),
        trade_date,
        len(underlyings),
    )
    return total


def step_commodity_option_iv(conn, *, force: bool = False) -> int:
    """Fetch commodity option series/ATM IV via AkShare exchange feeds.

    Source script : fetch_commodity_option_iv_daily.py
    Target tables :
      raw_commodity_option_iv_daily      — front-month IV time series
      derived_commodity_option_iv_snapshot — latest chart-ready JSON
    """
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_commodity_option_iv_daily (
                trade_date      DATE        NOT NULL,
                underlying_key  TEXT        NOT NULL,
                iv              NUMERIC,
                fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, underlying_key)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS derived_commodity_option_iv_snapshot (
                trade_date      DATE        NOT NULL,
                underlying_key  TEXT        NOT NULL,
                label           TEXT        NOT NULL,
                sector          TEXT,
                current_iv      NUMERIC,
                percentile_all  NUMERIC,
                percentile_1y   NUMERIC,
                chart_data      JSONB       NOT NULL,
                fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, underlying_key)
            )
        """)
    conn.commit()

    today = date.today()
    target = latest_trade_date()
    with conn.cursor() as cur:
        cur.execute("""
            SELECT underlying_key, MAX(trade_date) AS max_date
            FROM raw_commodity_option_iv_daily
            GROUP BY underlying_key
        """)
        by_key = {row[0]: row[1] for row in cur.fetchall()}

    if not force and by_key:
        stale = [k for k, d in by_key.items() if d < target]
        if not stale and len(by_key) >= 8:
            log.info("Commodity option IV up-to-date (>= %s, %d keys), skipping.", target, len(by_key))
            return 0

    # First runs / sparse history: pull a shorter window for speed across ~50 products
    hist_days = 8 if not by_key or force else 10
    log.info("Commodity option IV: fetching (days=%d, universe=%d) …", hist_days, len(by_key) or 52)
    out = run_script(
        "fetch_commodity_option_iv_daily.py",
        extra_args=["--days", str(hist_days)],
        timeout=900,
        log_stderr=True,
    )
    if not out or out.get("error"):
        raise RuntimeError(f"Commodity option IV fetch failed: {out}")

    trade_date = to_date(out.get("trade_date")) or today
    underlyings = out.get("underlyings") or {}
    iv_rows = out.get("iv_rows") or []

    iv_records = [
        (to_date(r["trade_date"]), r["underlying_key"], r.get("iv"))
        for r in iv_rows
        if r.get("trade_date") and r.get("underlying_key")
    ]

    total = 0
    with conn.cursor() as cur:
        if iv_records:
            execute_values(
                cur,
                """
                INSERT INTO raw_commodity_option_iv_daily
                    (trade_date, underlying_key, iv)
                VALUES %s
                ON CONFLICT (trade_date, underlying_key) DO UPDATE
                    SET iv = EXCLUDED.iv,
                        fetched_at = NOW()
                """,
                iv_records,
            )
            total += len(iv_records)
    conn.commit()

    # Rebuild history charts from accumulated DB series so percentiles deepen over time
    with conn.cursor() as cur:
        cur.execute("""
            SELECT trade_date, underlying_key, iv
            FROM raw_commodity_option_iv_daily
            ORDER BY underlying_key, trade_date
        """)
        db_hist: dict[str, list[dict]] = {}
        for td, key, iv in cur.fetchall():
            if iv is None:
                continue
            db_hist.setdefault(key, []).append({
                "trade_date": iso(td) if isinstance(td, date) else str(td)[:10],
                "iv": float(iv),
            })

    # Prefer in-process rebuild helpers when available
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent / "option_iv"))
        from commodity_config import UNDERLYINGS as COMM_UNDERLYINGS  # type: ignore
        from commodity_fetch import build_underlying_payload  # type: ignore
    except Exception as exc:  # noqa: BLE001
        log.warning("Commodity option IV: rebuild helpers unavailable (%s), using fetch payloads.", exc)
        COMM_UNDERLYINGS = {}
        build_underlying_payload = None

    rebuilt: dict[str, dict] = {}
    if build_underlying_payload and COMM_UNDERLYINGS:
        for key, hist in db_hist.items():
            cfg = COMM_UNDERLYINGS.get(key)
            if not cfg or len(hist) < 1:
                continue
            term = ((underlyings.get(key) or {}).get("charts") or {}).get("term_structure") or []
            prior_charts = ((underlyings.get(key) or {}).get("charts") or {}) or None
            payload = build_underlying_payload(cfg, hist, term, prior_charts=prior_charts)
            if payload:
                rebuilt[key] = payload
    if rebuilt:
        underlyings = {**underlyings, **rebuilt}

    snapshot_records = []
    for key, payload in underlyings.items():
        snapshot_records.append((
            trade_date,
            key,
            payload.get("label") or key,
            payload.get("sector") or payload.get("group"),
            payload.get("current_iv"),
            payload.get("percentile_all"),
            payload.get("percentile_1y"),
            json.dumps(payload, ensure_ascii=True, allow_nan=True)
                .replace(": NaN", ": null")
                .replace(": Infinity", ": null")
                .replace(": -Infinity", ": null"),
        ))

    with conn.cursor() as cur:
        if snapshot_records:
            execute_values(
                cur,
                """
                INSERT INTO derived_commodity_option_iv_snapshot
                    (trade_date, underlying_key, label, sector,
                     current_iv, percentile_all, percentile_1y, chart_data)
                VALUES %s
                ON CONFLICT (trade_date, underlying_key) DO UPDATE
                    SET label = EXCLUDED.label,
                        sector = EXCLUDED.sector,
                        current_iv = EXCLUDED.current_iv,
                        percentile_all = EXCLUDED.percentile_all,
                        percentile_1y = EXCLUDED.percentile_1y,
                        chart_data = EXCLUDED.chart_data,
                        fetched_at = NOW()
                """,
                snapshot_records,
            )
            total += len(snapshot_records)
        cur.execute(
            "DELETE FROM derived_commodity_option_iv_snapshot WHERE trade_date > %s",
            (trade_date,),
        )
    conn.commit()
    log.info(
        "Commodity option IV: upserted %d IV rows + %d snapshots (trade_date=%s, underlyings=%d).",
        len(iv_records),
        len(snapshot_records),
        trade_date,
        len(underlyings),
    )
    return total


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
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT MAX(trade_date) FROM raw_futures_contracts_daily
            WHERE contract ~* '^(IH|IF|IC|IM)[0-9]{4}'
            """
        )
        row = cur.fetchone()
    index_max = row[0] if (row and row[0]) else None
    # Table-wide max can be commodity contracts; CFFEX index months often lag.
    effective_max = index_max if index_max and (cur_max is None or index_max < cur_max) else cur_max

    if not force and effective_max and effective_max >= today - timedelta(days=1):
        log.info("AkShare exchange daily up-to-date (%s), skipping.", effective_max)
        return 0

    if effective_max is None or force:
        start = _AK_EXCHANGE_BACKFILL_START
        log.info("AkShare exchange daily: %s, backfilling from %s …",
                 "forced" if force else "first run", start)
    else:
        start = effective_max + timedelta(days=1)
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


def step_cffex_index_month_contracts(conn, *, force: bool = False) -> int:
    """Refresh IH/IF/IC/IM month contracts for 合约年化基差率时序 via Sina/AkShare.

    Do not use a single MAX(trade_date) across all index months. After a
    CFFEX roll the new 次月 / 下季 contracts can be missing while 当月 / 当季
    (often MOM-traded) still look current, which froze the 下季 chart line.
    """
    today = date.today()
    listed = listed_cffex_index_roots(today)
    cutoff = today - timedelta(days=1)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT UPPER(SPLIT_PART(contract, '.', 1)) AS root, MAX(trade_date)
            FROM raw_futures_contracts_daily
            WHERE UPPER(SPLIT_PART(contract, '.', 1)) = ANY(%s)
              AND COALESCE(NULLIF(clear, 0), NULLIF(close, 0)) IS NOT NULL
            GROUP BY 1
            """,
            [listed],
        )
        last_by_root = {r[0]: r[1] for r in cur.fetchall()}
    stale = [
        root
        for root in listed
        if last_by_root.get(root) is None or last_by_root[root] < cutoff
    ]
    if not force and not stale:
        newest = max(last_by_root[root] for root in listed)
        log.info("CFFEX index month contracts up-to-date (%s), skipping.", newest)
        return 0
    if stale:
        log.info(
            "CFFEX index month contracts stale: %s",
            ", ".join(f"{root}={last_by_root.get(root)}" for root in stale),
        )

    log.info("Fetching CFFEX index month contracts (IH/IF/IC/IM) …")
    out = run_script(
        "backfill_cffex_index_month_contracts.py",
        timeout=600,
        log_stderr=True,
    )
    if not out or out.get("error"):
        raise RuntimeError(f"CFFEX index month contracts fetch failed: {out}")
    rows = int(out.get("rows") or 0)
    log.info("CFFEX index month contracts: upserted %d rows.", rows)
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
    cur_max = max_valid_close_date(conn, "raw_akshare_futures_daily")

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
        cl   = safe_float(r.get("close"))
        if not d or not code or cl is None or cl <= 0:
            continue
        records.append((
            d, code,
            safe_float(r.get("open")),
            cl,
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
                """
                SELECT COUNT(DISTINCT symbol) FROM raw_futures_daily
                WHERE trade_date = %s AND settle IS NOT NULL
                  AND ts_code LIKE %s
                """,
                (trade_date, "%L.CFX"),
            )
            raw_cnt = cur.fetchone()[0]
            cur.execute(
                """
                SELECT COUNT(DISTINCT symbol) FROM derived_futures_snapshot
                WHERE trade_date = %s AND near_settle IS NOT NULL
                """,
                (trade_date,),
            )
            snap_cnt = cur.fetchone()[0]
            # Skip only when continuous L settles and near_settle snapshot are present.
            # Empty null snapshots (Tushare permission failures) must not block retries.
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

    # Never persist empty shells — they become MAX(trade_date) and blank the UI cards.
    snap_records = [
        r for r in snap_records
        if any(v is not None for v in (r[3], r[4], r[7], r[8], r[12]))  # close/settle/near_*/far_settle
    ]
    if snap_records:
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
                    SET ts_code = COALESCE(EXCLUDED.ts_code, derived_futures_snapshot.ts_code),
                        close = COALESCE(EXCLUDED.close, derived_futures_snapshot.close),
                        settle = COALESCE(EXCLUDED.settle, derived_futures_snapshot.settle),
                        settle_return = COALESCE(EXCLUDED.settle_return, derived_futures_snapshot.settle_return),
                        near_ts_code = COALESCE(EXCLUDED.near_ts_code, derived_futures_snapshot.near_ts_code),
                        near_close = COALESCE(EXCLUDED.near_close, derived_futures_snapshot.near_close),
                        near_settle = COALESCE(EXCLUDED.near_settle, derived_futures_snapshot.near_settle),
                        near_settle_return = COALESCE(EXCLUDED.near_settle_return, derived_futures_snapshot.near_settle_return),
                        far_ts_code = COALESCE(EXCLUDED.far_ts_code, derived_futures_snapshot.far_ts_code),
                        far_close = COALESCE(EXCLUDED.far_close, derived_futures_snapshot.far_close),
                        far_settle = COALESCE(EXCLUDED.far_settle, derived_futures_snapshot.far_settle),
                        far_settle_return = COALESCE(EXCLUDED.far_settle_return, derived_futures_snapshot.far_settle_return),
                        far_cont_ts_code = COALESCE(EXCLUDED.far_cont_ts_code, derived_futures_snapshot.far_cont_ts_code),
                        computed_at = NOW()
                """,
                snap_records,
            )
        conn.commit()
    else:
        log.warning("Futures latest returned no usable snapshot rows; repairing from continuous legs.")
        raw_cnt += step_repair_futures_snapshot_from_continuous(conn, force=True)

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


def _records_from_continuous_payload(out_cont: dict, source: str) -> list:
    """Flatten continuous-leg JSON into raw_futures_daily upsert tuples."""
    records = []
    seen = set()
    for sym, legs in (out_cont.get("data") or {}).items():
        for leg, series in legs.items():
            for r in (series or []):
                td = to_date(str(r.get("trade_date", "")))
                if not td:
                    continue
                settle = safe_float(r.get("settle"))
                close = safe_float(r.get("close"))
                if settle is None or settle == 0:
                    settle = close
                if settle is None and close is None:
                    continue
                ts_code = f"{sym}{leg}.CFX"
                key = (ts_code, td)
                if key in seen:
                    continue
                seen.add(key)
                records.append((
                    ts_code, sym, td,
                    close,
                    settle,
                    safe_float(r.get("pre_close")),
                    safe_float(r.get("pre_settle")),
                    safe_float(r.get("settle_return")),
                    source,
                ))
    return records


def step_futures_range_backfill(conn, start_ymd: str, end_ymd: str) -> int:
    """Bulk-load historical continuous legs L, L1, L2, L3 (Tushare, AkShare fallback)."""
    log.info("Futures range backfill %s → %s (L/L1/L2/L3) …", start_ymd, end_ymd)
    total = 0

    out_cont = run_script(
        "get_cffex_index_futures_continuous_range.py",
        extra_args=[start_ymd, end_ymd],
        timeout=600,
    )
    records = []
    source = "tushare"
    if out_cont and not out_cont.get("error"):
        records = _records_from_continuous_payload(out_cont, "tushare")

    if not records:
        log.warning("  Tushare continuous range empty/failed; trying AkShare month synthesis …")
        out_ak = run_script(
            "get_cffex_index_futures_continuous_akshare.py",
            extra_args=[start_ymd, end_ymd],
            timeout=900,
        )
        if out_ak and not out_ak.get("error"):
            records = _records_from_continuous_payload(out_ak, "akshare")
            source = "akshare"
        else:
            log.warning("  AkShare continuous synthesis also returned no data: %s", out_ak)

    if records:
        total += _upsert_futures(conn, records)
        log.info("  Continuous legs (L/L1/L2/L3) via %s: %d rows.", source, len(records))
    else:
        log.warning("  No continuous leg rows upserted for %s → %s.", start_ymd, end_ymd)

    log.info("Futures backfill total: %d rows.", total)
    return total


def step_futures_continuous_gapfill(conn, trade_date: date, *, force: bool = False) -> int:
    """
    Keep IFL/IFL1/IFL2/IFL3 (and IH/IC/IM) continuous series current.

    Nightly futures_latest only writes a single day and depends on Tushare
    fut_daily permissions.  When those lapse, the four-leg basis chart freezes
    even though spot data keeps updating.  This step gap-fills from the oldest
    lagging leg through trade_date via Tushare, with AkShare synthesis fallback.
    """
    codes = [
        f"{sym}{leg}.CFX"
        for sym in ("IH", "IF", "IC", "IM")
        for leg in ("L", "L1", "L2", "L3")
    ]
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT MIN(mx) FROM (
                SELECT COALESCE(MAX(trade_date), DATE '2023-01-01') AS mx
                FROM raw_futures_daily
                WHERE ts_code = ANY(%s)
                GROUP BY ts_code
            ) t
            """,
            (codes,),
        )
        row = cur.fetchone()
        min_max = row[0] if row and row[0] else date(2023, 1, 1)

        # Also detect sparse recent history: if L has fewer than ~15 rows in the
        # last 45 calendar days, rewind the window to re-fetch holes.
        cur.execute(
            """
            SELECT COUNT(*) FROM raw_futures_daily
            WHERE ts_code = 'IFL.CFX'
              AND trade_date >= %s
              AND settle IS NOT NULL
            """,
            (trade_date - timedelta(days=45),),
        )
        recent_l = cur.fetchone()[0] or 0

    if recent_l < 15:
        start = trade_date - timedelta(days=90)
        log.info(
            "Continuous gapfill: sparse IFL history (%d rows / 45d); rewinding to %s",
            recent_l, start,
        )
    else:
        start = min_max - timedelta(days=5)

    if not force and start >= trade_date and recent_l >= 15:
        log.info("Continuous legs already current through %s, skipping gapfill.", trade_date)
        return 0

    if start > trade_date:
        start = trade_date - timedelta(days=30)

    return step_futures_range_backfill(conn, ymd(start), ymd(trade_date))


def step_repair_futures_snapshot_from_continuous(conn, *, force: bool = False) -> int:
    """
    Rebuild derived_futures_snapshot from continuous L / L1 rows in raw_futures_daily.

    When Tushare fut_daily permissions lapse, futures_latest writes empty snapshot
    shells (all NULL).  The futures cards then show "-" because /futures/latest
    picks MAX(trade_date).  This step fills settle / near_* / far_* from the
    AkShare-synthesized continuous legs so the UI stays populated.
    """
    log.info("Repairing futures snapshot from continuous L/L1 …")
    with conn.cursor() as cur:
        cur.execute(
            """
            WITH near AS (
                SELECT
                    symbol,
                    trade_date,
                    ts_code,
                    close,
                    COALESCE(settle, close) AS settle,
                    LAG(COALESCE(settle, close)) OVER (
                        PARTITION BY symbol ORDER BY trade_date
                    ) AS prev_settle
                FROM raw_futures_daily
                WHERE ts_code IN ('IHL.CFX', 'IFL.CFX', 'ICL.CFX', 'IML.CFX')
            ),
            far AS (
                SELECT
                    symbol,
                    trade_date,
                    ts_code,
                    close,
                    COALESCE(settle, close) AS settle,
                    LAG(COALESCE(settle, close)) OVER (
                        PARTITION BY symbol ORDER BY trade_date
                    ) AS prev_settle
                FROM raw_futures_daily
                WHERE ts_code IN ('IHL1.CFX', 'IFL1.CFX', 'ICL1.CFX', 'IML1.CFX')
            ),
            src AS (
                SELECT
                    COALESCE(f.symbol, n.symbol) AS symbol,
                    COALESCE(f.trade_date, n.trade_date) AS trade_date,
                    f.ts_code AS ts_code,
                    f.close AS close,
                    f.settle AS settle,
                    CASE
                        WHEN f.settle IS NOT NULL AND f.prev_settle IS NOT NULL AND f.prev_settle > 0
                        THEN ROUND(100.0 * (f.settle / f.prev_settle - 1.0), 6)
                        ELSE NULL
                    END AS settle_return,
                    n.ts_code AS near_ts_code,
                    n.close AS near_close,
                    n.settle AS near_settle,
                    CASE
                        WHEN n.settle IS NOT NULL AND n.prev_settle IS NOT NULL AND n.prev_settle > 0
                        THEN ROUND(100.0 * (n.settle / n.prev_settle - 1.0), 6)
                        ELSE NULL
                    END AS near_settle_return,
                    NULL::text AS far_ts_code,
                    NULL::numeric AS far_close,
                    f.settle AS far_settle,
                    CASE
                        WHEN f.settle IS NOT NULL AND f.prev_settle IS NOT NULL AND f.prev_settle > 0
                        THEN ROUND(100.0 * (f.settle / f.prev_settle - 1.0), 6)
                        ELSE NULL
                    END AS far_settle_return,
                    f.ts_code AS far_cont_ts_code
                FROM far f
                FULL OUTER JOIN near n
                  ON n.symbol = f.symbol AND n.trade_date = f.trade_date
                WHERE COALESCE(f.settle, n.settle) IS NOT NULL
            )
            INSERT INTO derived_futures_snapshot
                (symbol, trade_date,
                 ts_code, close, settle, settle_return,
                 near_ts_code, near_close, near_settle, near_settle_return,
                 far_ts_code, far_close, far_settle, far_settle_return, far_cont_ts_code)
            SELECT
                symbol, trade_date,
                ts_code, close, settle, settle_return,
                near_ts_code, near_close, near_settle, near_settle_return,
                far_ts_code, far_close, far_settle, far_settle_return, far_cont_ts_code
            FROM src
            WHERE %s
               OR NOT EXISTS (
                    SELECT 1 FROM derived_futures_snapshot d
                    WHERE d.symbol = src.symbol
                      AND d.trade_date = src.trade_date
                      AND (d.settle IS NOT NULL OR d.near_settle IS NOT NULL OR d.far_settle IS NOT NULL)
               )
            ON CONFLICT (symbol, trade_date) DO UPDATE
                SET ts_code = COALESCE(EXCLUDED.ts_code, derived_futures_snapshot.ts_code),
                    close = COALESCE(EXCLUDED.close, derived_futures_snapshot.close),
                    settle = COALESCE(EXCLUDED.settle, derived_futures_snapshot.settle),
                    settle_return = COALESCE(EXCLUDED.settle_return, derived_futures_snapshot.settle_return),
                    near_ts_code = COALESCE(EXCLUDED.near_ts_code, derived_futures_snapshot.near_ts_code),
                    near_close = COALESCE(EXCLUDED.near_close, derived_futures_snapshot.near_close),
                    near_settle = COALESCE(EXCLUDED.near_settle, derived_futures_snapshot.near_settle),
                    near_settle_return = COALESCE(EXCLUDED.near_settle_return, derived_futures_snapshot.near_settle_return),
                    far_ts_code = COALESCE(EXCLUDED.far_ts_code, derived_futures_snapshot.far_ts_code),
                    far_close = COALESCE(EXCLUDED.far_close, derived_futures_snapshot.far_close),
                    far_settle = COALESCE(EXCLUDED.far_settle, derived_futures_snapshot.far_settle),
                    far_settle_return = COALESCE(EXCLUDED.far_settle_return, derived_futures_snapshot.far_settle_return),
                    far_cont_ts_code = COALESCE(EXCLUDED.far_cont_ts_code, derived_futures_snapshot.far_cont_ts_code),
                    computed_at = NOW()
            """,
            (force,),
        )
        total = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0

        # Drop empty shell rows that would otherwise win MAX(trade_date).
        cur.execute(
            """
            DELETE FROM derived_futures_snapshot
            WHERE settle IS NULL
              AND near_settle IS NULL
              AND far_settle IS NULL
              AND close IS NULL
              AND near_close IS NULL
            """
        )
        deleted = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    conn.commit()
    log.info("Snapshot repair: upserted %d rows, deleted %d empty shells.", total, deleted)
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
# STEP — A-share daily OHLCV + amount + turnover  (Choice c.csd)
# ═══════════════════════════════════════════════════════════════════════════════

_ASHARE_BACKFILL_MONTHS = int(os.environ.get("ASHARE_BACKFILL_MONTHS", "3"))


def _ashare_backfill_start(today: date) -> date:
    """Resolve backfill start: ASHARE_BACKFILL_START env, else last N months."""
    fixed = os.environ.get("ASHARE_BACKFILL_START", "").strip()
    if fixed:
        parsed = to_date(fixed.replace("-", ""))
        if parsed:
            return parsed
    return today - timedelta(days=_ASHARE_BACKFILL_MONTHS * 31)


def _ashare_fetch_chunks(start: date, end: date) -> list[tuple[date, date]]:
    """Split fetches into chunks to limit JSON payload size / isolate failures.

    Short incremental gaps (default ≤7 calendar days) are fetched day-by-day so:
      - today/yesterday can use fast spot mode
      - a single bad day does not abort the whole catch-up range
    Longer backfills stay on ASHARE_CHUNK_DAYS (default 31).
    """
    span_days = (end - start).days
    day_by_day_max = int(os.environ.get("ASHARE_DAY_BY_DAY_MAX", "7"))
    if 0 <= span_days <= day_by_day_max:
        return [
            (start + timedelta(days=i), start + timedelta(days=i))
            for i in range(span_days + 1)
        ]

    chunk_days = int(os.environ.get("ASHARE_CHUNK_DAYS", "31"))
    if span_days <= chunk_days:
        return [(start, end)]
    chunks: list[tuple[date, date]] = []
    cur = start
    while cur <= end:
        chunk_end = min(cur + timedelta(days=chunk_days - 1), end)
        chunks.append((cur, chunk_end))
        cur = chunk_end + timedelta(days=1)
    return chunks


def _ashare_data_source() -> str:
    return os.environ.get("ASHARE_DATA_SOURCE", "akshare").strip().lower()


def _ashare_daily_script() -> str:
    src = _ashare_data_source()
    if src == "choice":
        return "fetch_ashare_daily.py"
    if src == "tushare":
        return "fetch_ashare_daily_tushare.py"
    return "fetch_ashare_daily_akshare.py"


def _ashare_index_script() -> str:
    src = _ashare_data_source()
    if src == "choice":
        return "fetch_ashare_index.py"
    return "fetch_ashare_index_akshare.py"


def _upsert_ashare_rows(conn, rows_raw: list) -> int:
    records = []
    for r in rows_raw:
        d = to_date(str(r.get("date", "")).replace("-", ""))
        ts_code = (r.get("ts_code") or "").strip()
        if not d or not ts_code:
            continue
        vol = safe_float(r.get("volume"))
        source = (r.get("source") or _ashare_data_source()).strip() or "akshare"
        records.append((
            d,
            ts_code,
            safe_float(r.get("open")),
            safe_float(r.get("close")),
            safe_float(r.get("high")),
            safe_float(r.get("low")),
            int(vol) if vol is not None else None,
            safe_float(r.get("amount")),
            safe_float(r.get("turn")),
            source,
        ))

    if not records:
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_ashare_daily
                (trade_date, ts_code, open, close, high, low, volume, amount, turn, source)
            VALUES %s
            ON CONFLICT (trade_date, ts_code) DO UPDATE
                SET open = EXCLUDED.open,
                    close = EXCLUDED.close,
                    high = EXCLUDED.high,
                    low = EXCLUDED.low,
                    volume = EXCLUDED.volume,
                    amount = EXCLUDED.amount,
                    turn = EXCLUDED.turn,
                    fetched_at = NOW()
            """,
            records,
            page_size=5000,
        )
    conn.commit()
    return len(records)


def step_ashare_daily(conn, *, force: bool = False) -> int:
    """Fetch A-share daily quotes (AkShare by default; Choice if ASHARE_DATA_SOURCE=choice).

    Target table : raw_ashare_daily  (trade_date, ts_code) PK
    First run    : backfills from ASHARE_BACKFILL_START (or last 3 months) → today
    Subsequent   : incremental from last stored date + 1 day
    Force        : re-fetch from ASHARE_BACKFILL_START (or last 3 months) → today
    """
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_ashare_daily (
                trade_date  DATE          NOT NULL,
                ts_code     VARCHAR(20)   NOT NULL,
                open        NUMERIC(12,4),
                close       NUMERIC(12,4),
                high        NUMERIC(12,4),
                low         NUMERIC(12,4),
                volume      BIGINT,
                amount      NUMERIC(20,2),
                turn        NUMERIC(12,6),
                source      VARCHAR(30)   NOT NULL DEFAULT 'choice',
                fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
                CONSTRAINT raw_ashare_daily_uq UNIQUE (trade_date, ts_code)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS raw_ashare_daily_date_idx
              ON raw_ashare_daily (trade_date DESC)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS raw_ashare_daily_code_date_idx
              ON raw_ashare_daily (ts_code, trade_date DESC)
        """)
    conn.commit()

    today = date.today()
    cur_max = max_date(conn, "raw_ashare_daily")

    if not force and cur_max and cur_max >= today - timedelta(days=1):
        log.info("A-share daily up-to-date (%s), skipping.", cur_max)
        return 0

    if cur_max is None or force:
        start = _ashare_backfill_start(today)
        log.info(
            "A-share daily: %s, backfilling from %s …",
            "forced" if force else "first run",
            start,
        )
    else:
        start = cur_max + timedelta(days=1)
        log.info("A-share daily: incremental fetch %s → %s …", start, today)

    if start > today:
        log.info("A-share daily: already up-to-date.")
        return 0

    chunks = _ashare_fetch_chunks(start, today)
    total_upserted = 0
    timeout = int(os.environ.get("ASHARE_ETL_TIMEOUT", "7200"))
    script = _ashare_daily_script()
    source = _ashare_data_source()
    log.info("A-share daily: source=%s script=%s", source, script)

    for idx, (chunk_start, chunk_end) in enumerate(chunks, 1):
        log.info(
            "A-share daily: chunk %d/%d  %s → %s …",
            idx, len(chunks), chunk_start, chunk_end,
        )
        extra_env = {}
        if source == "akshare":
            # Spot returns the *latest* session only — safe solely when catching up
            # the current/previous calendar day. Historical single-day gaps must
            # use hist or they would be mis-labeled with today's prices.
            use_spot = (
                chunk_start == chunk_end
                and chunk_end >= today - timedelta(days=1)
            )
            extra_env["ASHARE_AK_MODE"] = "spot" if use_spot else "hist"
            # Default to Sina — East Money spot/hist are often IP-blocked.
            # Override with ASHARE_AK_PROVIDER=em to force East Money.
            extra_env["ASHARE_AK_PROVIDER"] = (
                os.environ.get("ASHARE_AK_PROVIDER", "").strip() or "sina"
            )
            extra_env.setdefault("TQDM_DISABLE", "1")
        out = run_script(
            script,
            extra_args=[iso(chunk_start), iso(chunk_end)],
            extra_env=extra_env,
            timeout=timeout,
            log_stderr=True,
        )
        if not out or out.get("error"):
            if out and out.get("quota_exceeded"):
                log.warning(
                    "A-share daily: API quota hit at chunk %d/%d (%s→%s). "
                    "Stopping backfill; %d rows saved so far.",
                    idx, len(chunks), chunk_start, chunk_end, total_upserted,
                )
                if total_upserted > 0:
                    return total_upserted
                return 0
            raise RuntimeError(f"A-share daily fetch failed ({chunk_start}→{chunk_end}): {out}")

        rows_raw = out.get("data") or []
        codes_found = out.get("codes") or []
        log.info(
            "A-share daily: chunk %d/%d — %d codes, %d raw rows",
            idx, len(chunks), len(codes_found), len(rows_raw),
        )
        if not rows_raw:
            # Day-by-day catch-up hits Sat/Sun/holidays with zero bars — skip and
            # continue so a weekend gap cannot abort Monday's refresh.
            if chunk_start == chunk_end:
                log.info(
                    "A-share daily: no bars for %s (non-trading day?) — continuing.",
                    chunk_start,
                )
                continue
            log.warning(
                "A-share daily: empty data for %s → %s (likely quota); stopping backfill.",
                chunk_start, chunk_end,
            )
            if total_upserted > 0:
                log.info("A-share daily: partial backfill done, %d rows saved.", total_upserted)
                return total_upserted
            return 0

        n = _upsert_ashare_rows(conn, rows_raw)
        total_upserted += n
        log.info("A-share daily: chunk %d/%d upserted %d rows.", idx, len(chunks), n)

    purged = _purge_thin_ashare_days(conn, start, today)
    if purged:
        log.warning(
            "A-share daily: removed %d incomplete session(s) below %d codes.",
            purged,
            _ashare_min_daily_codes(),
        )

    if total_upserted == 0:
        log.warning("A-share daily: no rows upserted.")
        return 0

    log.info("A-share daily: done, %d total rows upserted.", total_upserted)
    return total_upserted


def _to_ts_code(code: str) -> str:
    c = str(code).strip().zfill(6)
    if c.startswith("92") or c.startswith(("83", "87", "43", "82", "88")):
        return f"{c}.BJ"
    if c.startswith("6"):
        return f"{c}.SH"
    return f"{c}.SZ"


def _ashare_name_records_from_df(df) -> list[tuple[str, str]]:
    if df is None or getattr(df, "empty", True):
        return []
    cols = {str(c): c for c in df.columns}
    code_col = cols.get("code") or cols.get("代码") or list(df.columns)[0]
    name_col = cols.get("name") or cols.get("名称")
    if name_col is None:
        return []
    records: list[tuple[str, str]] = []
    seen: set[str] = set()
    for _, row in df.iterrows():
        raw = str(row.get(code_col, "")).strip()
        digits = "".join(ch for ch in raw if ch.isdigit())
        if len(digits) < 6:
            continue
        name = str(row.get(name_col, "")).strip()
        if not name:
            continue
        ts_code = _to_ts_code(digits[-6:])
        if ts_code in seen:
            continue
        seen.add(ts_code)
        records.append((ts_code, name[:100]))
    return records


def _fetch_ashare_stock_name_records() -> list[tuple[str, str]]:
    """East Money name list is often RemoteDisconnected; fall back to Sina spot."""
    import time

    import akshare as ak

    last_exc: Exception | None = None
    for attempt in range(1, 4):
        try:
            df = ak.stock_info_a_code_name()
            records = _ashare_name_records_from_df(df)
            if len(records) >= 3000:
                return records
            last_exc = RuntimeError(f"stock_info_a_code_name returned only {len(records)} rows")
            log.warning("A-share stock names: %s (attempt %d/3)", last_exc, attempt)
        except Exception as exc:
            last_exc = exc
            log.warning("A-share stock names: AkShare failed (attempt %d/3): %s", attempt, exc)
        time.sleep(1.5 * attempt)

    log.warning("A-share stock names: falling back to Sina spot codes (%s)", last_exc)
    df = ak.stock_zh_a_spot()
    records = _ashare_name_records_from_df(df)
    if len(records) < 3000:
        raise RuntimeError(
            f"A-share stock names: Sina spot too small ({len(records)} rows); last error={last_exc}"
        )
    return records


def step_ashare_stock_names(conn, *, force: bool = False) -> int:
    """Sync A-share ts_code → Chinese name from AkShare stock_info_a_code_name().

    Always refreshes when:
      - force=True, or
      - dim table is small / empty, or
      - latest trade date in raw_ashare_daily has codes missing from dim
        (covers new listings like 688825 长鑫科技), or
      - dim has not been refreshed in >7 days.
    """
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS dim_ashare_stock (
                ts_code     VARCHAR(20)   PRIMARY KEY,
                name        VARCHAR(100)  NOT NULL,
                updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
            )
        """)
    conn.commit()

    if not force:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), MAX(updated_at) FROM dim_ashare_stock")
            row = cur.fetchone()
            dim_count = int(row[0] or 0) if row else 0
            max_updated = row[1] if row else None

            cur.execute("""
                SELECT COUNT(*) FROM (
                  SELECT r.ts_code
                  FROM raw_ashare_daily r
                  LEFT JOIN dim_ashare_stock s ON s.ts_code = r.ts_code
                  WHERE r.trade_date = (SELECT MAX(trade_date) FROM raw_ashare_daily)
                    AND r.amount > 0
                    AND s.ts_code IS NULL
                  LIMIT 5
                ) missing
            """)
            missing = int((cur.fetchone() or [0])[0] or 0)

            fresh = False
            if max_updated is not None:
                try:
                    from datetime import timezone as _tz
                    now = datetime.now(_tz.utc)
                    updated = (
                        max_updated
                        if getattr(max_updated, "tzinfo", None)
                        else max_updated.replace(tzinfo=_tz.utc)
                    )
                    fresh = (now - updated).total_seconds() < 7 * 24 * 3600
                except Exception:
                    fresh = False

            if dim_count > 4000 and missing == 0 and fresh:
                log.info(
                    "A-share stock names: %d rows, no missing codes on latest day, fresh — skipping.",
                    dim_count,
                )
                return 0
            if missing:
                log.info("A-share stock names: %d missing codes on latest day — refreshing.", missing)

    try:
        import akshare
    except ImportError:
        log.warning("A-share stock names: akshare not installed, skipping.")
        return 0

    log.info("A-share stock names: fetching from AkShare …")
    try:
        records = _fetch_ashare_stock_name_records()
    except Exception as exc:
        log.warning("A-share stock names: skipped — %s", exc)
        return 0

    if not records:
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO dim_ashare_stock (ts_code, name, updated_at)
            VALUES %s
            ON CONFLICT (ts_code) DO UPDATE
                SET name = EXCLUDED.name,
                    updated_at = NOW()
            """,
            records,
            template="(%s, %s, NOW())",
            page_size=2000,
        )
    conn.commit()
    log.info("A-share stock names: upserted %d rows.", len(records))
    return len(records)


def _ashare_board(ts_code: str) -> str:
    base, _, suffix = ts_code.partition(".")
    if suffix == "BJ" or base.startswith(("920", "83", "87", "43", "82", "88")):
        return "北交所"
    if base.startswith(("688", "689")):
        return "科创板"
    if base.startswith(("300", "301")):
        return "创业板"
    if base.startswith(("600", "601", "603", "605")):
        return "上证主板"
    if base.startswith(("000", "001", "002", "003")):
        return "深证主板"
    return "其他"


def _ashare_min_daily_codes() -> int:
    """Reject / skip sessions below this stock count (partial hist fetches)."""
    return int(os.environ.get("ASHARE_MIN_DAILY_CODES", "3000"))


def _purge_thin_ashare_days(conn, start: date, end: date) -> int:
    """Delete trade dates whose stock coverage is clearly incomplete."""
    min_codes = _ashare_min_daily_codes()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT trade_date, COUNT(*) AS n
            FROM raw_ashare_daily
            WHERE trade_date BETWEEN %s AND %s
            GROUP BY trade_date
            HAVING COUNT(*) < %s
            ORDER BY trade_date
            """,
            (start, end, min_codes),
        )
        thin = cur.fetchall()
        if not thin:
            return 0
        for td, n in thin:
            log.warning(
                "A-share daily: %s has only %d codes (< %d) — deleting incomplete session",
                td, n, min_codes,
            )
            cur.execute("DELETE FROM raw_ashare_daily WHERE trade_date = %s", (td,))
            cur.execute(
                """
                DELETE FROM derived_ashare_crowding_daily
                WHERE trade_date = %s
                  AND EXISTS (
                    SELECT 1 FROM information_schema.tables
                    WHERE table_name = 'derived_ashare_crowding_daily'
                  )
                """,
                (td,),
            )
    conn.commit()
    return len(thin)


def _pct_rank_series(values: list[float], lookback: int) -> list[float]:
    out: list[float] = []
    for i, v in enumerate(values):
        window = values[max(0, i - lookback + 1): i + 1]
        rank = sum(1 for x in window if x <= v)
        out.append(round(rank / len(window) * 100, 2))
    return out


def _sma_series(values: list[float | None], window: int) -> list[float | None]:
    out: list[float | None] = []
    for i in range(len(values)):
        sl = [x for x in values[max(0, i - window + 1): i + 1] if x is not None]
        out.append(round(sum(sl) / len(sl), 2) if sl else None)
    return out


def step_ashare_index(conn, *, force: bool = False) -> int:
    """Fetch 全A benchmark index close via AkShare (default) or Choice."""
    index_code = os.environ.get("ASHARE_INDEX_CODE", "000300.SH")

    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_ashare_index_daily (
                trade_date  DATE          NOT NULL,
                ts_code     VARCHAR(20)   NOT NULL,
                close       NUMERIC(12,4) NOT NULL,
                source      VARCHAR(30)   NOT NULL DEFAULT 'choice',
                fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
                CONSTRAINT raw_ashare_index_daily_uq UNIQUE (trade_date, ts_code)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS raw_ashare_index_daily_code_date_idx
              ON raw_ashare_index_daily (ts_code, trade_date DESC)
        """)
    conn.commit()

    today = date.today()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT MAX(trade_date) FROM raw_ashare_index_daily WHERE ts_code = %s",
            (index_code,),
        )
        cur_max = cur.fetchone()[0]

    if not force and cur_max and cur_max >= today - timedelta(days=1):
        log.info("A-share index %s up-to-date (%s), skipping.", index_code, cur_max)
        return 0

    if cur_max is None or force:
        start = _ashare_backfill_start(today)
        log.info(
            "A-share index %s: %s, backfilling from %s …",
            index_code,
            "forced" if force else "first run",
            start,
        )
    else:
        start = cur_max + timedelta(days=1)
        log.info("A-share index %s: incremental fetch %s → %s …", index_code, start, today)

    if start > today:
        log.info("A-share index: already up-to-date.")
        return 0

    out = run_script(
        _ashare_index_script(),
        extra_args=[iso(start), iso(today)],
        timeout=int(os.environ.get("ASHARE_ETL_TIMEOUT", "300")),
    )
    if not out or out.get("error"):
        log.warning(
            "A-share index fetch failed for %s (%s); charts will use synthetic 全A from stock data.",
            index_code,
            out.get("error") if out else "no output",
        )
        return 0

    rows_raw = out.get("data") or []
    records = []
    for r in rows_raw:
        d = to_date(str(r.get("date", "")).replace("-", ""))
        cl = safe_float(r.get("close"))
        code = (r.get("ts_code") or index_code).strip()
        src = (r.get("source") or _ashare_data_source()).strip() or "akshare"
        if d and cl is not None:
            records.append((d, code, cl, src))

    if not records:
        log.warning("A-share index: no rows returned for %s → %s.", start, today)
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_ashare_index_daily (trade_date, ts_code, close, source)
            VALUES %s
            ON CONFLICT (trade_date, ts_code) DO UPDATE
                SET close = EXCLUDED.close, fetched_at = NOW()
            """,
            records,
        )
    conn.commit()
    log.info("A-share index %s: upserted %d rows.", index_code, len(records))
    return len(records)


def step_compute_ashare_crowding(conn, *, force: bool = False) -> int:
    """Compute daily A-share crowding metrics from raw_ashare_daily.

    Primary crowding signal (reference-style):
      - market_turn: amount-weighted average turnover (%)
      - crowding_pct: percentile of market_turn vs prior N trading days (default 250)
      - crowding_smooth: N-day SMA of crowding_pct (default 20) — used in charts

    Auxiliary concentration metrics:
      - hhi, top3_share, top10_share, top5pct_share, board_shares
    """
    lookback = int(os.environ.get("ASHARE_CROWDING_LOOKBACK", "250"))
    smooth_window = int(os.environ.get("ASHARE_CROWDING_SMOOTH", "20"))

    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS derived_ashare_crowding_daily (
                trade_date       DATE          PRIMARY KEY,
                total_amount     NUMERIC(20,2),
                market_turn      NUMERIC(10,4),
                hhi              NUMERIC(12,8),
                top3_share       NUMERIC(8,4),
                top10_share      NUMERIC(8,4),
                top5pct_share    NUMERIC(8,4),
                crowding_pct     NUMERIC(6,2),
                crowding_smooth  NUMERIC(6,2),
                top_board        VARCHAR(30),
                top_board_share  NUMERIC(8,4),
                board_shares     JSONB,
                computed_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS derived_ashare_crowding_daily_date_idx
              ON derived_ashare_crowding_daily (trade_date DESC)
        """)
        cur.execute(
            "ALTER TABLE derived_ashare_crowding_daily "
            "ADD COLUMN IF NOT EXISTS market_turn NUMERIC(10,4)"
        )
        cur.execute(
            "ALTER TABLE derived_ashare_crowding_daily "
            "ADD COLUMN IF NOT EXISTS crowding_smooth NUMERIC(6,2)"
        )
        cur.execute(
            "ALTER TABLE derived_ashare_crowding_daily "
            "ADD COLUMN IF NOT EXISTS top5pct_share NUMERIC(8,4)"
        )
    conn.commit()

    with conn.cursor() as cur:
        if force:
            cur.execute(
                "SELECT DISTINCT trade_date FROM raw_ashare_daily ORDER BY trade_date"
            )
        else:
            cur.execute("""
                SELECT DISTINCT r.trade_date
                FROM raw_ashare_daily r
                LEFT JOIN derived_ashare_crowding_daily d
                  ON d.trade_date = r.trade_date
                WHERE d.trade_date IS NULL
                   OR d.market_turn IS NULL
                   OR d.crowding_smooth IS NULL
                   OR d.top5pct_share IS NULL
                ORDER BY r.trade_date
            """)
        dates_to_compute = [row[0] for row in cur.fetchall()]

    if not dates_to_compute:
        log.info("A-share crowding: up-to-date, skipping.")
        return 0

    log.info("A-share crowding: computing %d dates …", len(dates_to_compute))

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT trade_date, ts_code, amount, turn
            FROM raw_ashare_daily
            WHERE trade_date = ANY(%s) AND amount > 0
            """,
            (dates_to_compute,),
        )
        raw_rows = cur.fetchall()

    by_date: dict[date, list[tuple[str, float, float | None]]] = {}
    for td, code, amt, turn in raw_rows:
        if amt is None:
            continue
        by_date.setdefault(td, []).append((code, float(amt), safe_float(turn)))

    pending: list[tuple] = []

    min_codes = _ashare_min_daily_codes()
    for td in sorted(by_date.keys()):
        stocks = by_date[td]
        if len(stocks) < min_codes:
            log.warning(
                "A-share crowding: skip %s — only %d stocks (< %d)",
                td, len(stocks), min_codes,
            )
            continue
        total = sum(a for _, a, _ in stocks)
        if total <= 0:
            continue

        hhi = sum((a / total) ** 2 for _, a, _ in stocks)
        sorted_amts = sorted((a for _, a, _ in stocks), reverse=True)
        top3_share = sum(sorted_amts[:3]) / total * 100
        top10_share = sum(sorted_amts[:10]) / total * 100
        top5pct_n = max(1, (len(sorted_amts) * 5 + 99) // 100)
        top5pct_share = sum(sorted_amts[:top5pct_n]) / total * 100

        turn_amt = sum(a for _, a, t in stocks if t is not None and t > 0)
        if turn_amt > 0:
            market_turn = sum(a * t for _, a, t in stocks if t is not None and t > 0) / turn_amt
        else:
            market_turn = None

        board_totals: dict[str, float] = {}
        for code, amt, _ in stocks:
            board = _ashare_board(code)
            board_totals[board] = board_totals.get(board, 0.0) + amt
        board_shares = {
            b: round(amt / total * 100, 2) for b, amt in board_totals.items()
        }
        top_board = max(board_shares, key=board_shares.get)
        top_board_share = board_shares[top_board]

        pending.append((
            td,
            total,
            round(market_turn, 4) if market_turn is not None else None,
            hhi,
            round(top3_share, 4),
            round(top10_share, 4),
            round(top5pct_share, 4),
            top_board,
            top_board_share,
            json.dumps(board_shares, ensure_ascii=False),
        ))

    if not pending:
        return 0

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO derived_ashare_crowding_daily
                (trade_date, total_amount, market_turn, hhi, top3_share, top10_share,
                 top5pct_share, top_board, top_board_share, board_shares)
            VALUES %s
            ON CONFLICT (trade_date) DO UPDATE
                SET total_amount = EXCLUDED.total_amount,
                    market_turn = EXCLUDED.market_turn,
                    hhi = EXCLUDED.hhi,
                    top3_share = EXCLUDED.top3_share,
                    top10_share = EXCLUDED.top10_share,
                    top5pct_share = EXCLUDED.top5pct_share,
                    top_board = EXCLUDED.top_board,
                    top_board_share = EXCLUDED.top_board_share,
                    board_shares = EXCLUDED.board_shares,
                    computed_at = NOW()
            """,
            pending,
        )
    conn.commit()

    with conn.cursor() as cur:
        cur.execute("""
            SELECT trade_date, market_turn
            FROM derived_ashare_crowding_daily
            WHERE market_turn IS NOT NULL
            ORDER BY trade_date
        """)
        hist_rows = cur.fetchall()

    if not hist_rows:
        return 0

    all_dates = [row[0] for row in hist_rows]
    turns = [float(row[1]) for row in hist_rows]
    pct_series = _pct_rank_series(turns, lookback)
    smooth_series = _sma_series(pct_series, smooth_window)

    score_rows = [
        (all_dates[i], pct_series[i], smooth_series[i])
        for i in range(len(all_dates))
        if smooth_series[i] is not None
    ]

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            UPDATE derived_ashare_crowding_daily AS d
               SET crowding_pct = v.crowding_pct::numeric,
                   crowding_smooth = v.crowding_smooth::numeric,
                   computed_at = NOW()
              FROM (VALUES %s) AS v(trade_date, crowding_pct, crowding_smooth)
             WHERE d.trade_date = v.trade_date::date
            """,
            score_rows,
        )
    conn.commit()
    log.info(
        "A-share crowding: upserted %d rows, rescored %d dates (lookback=%d, smooth=%d).",
        len(pending),
        len(score_rows),
        lookback,
        smooth_window,
    )
    return len(pending)


def step_ashare_hot_sectors(conn, *, force: bool = False) -> int:
    """Snapshot hot industry/concept boards (同花顺/新浪) into derived_ashare_hot_sectors_daily."""
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS derived_ashare_hot_sectors_daily (
                trade_date       DATE         NOT NULL,
                board_type       VARCHAR(20)  NOT NULL,
                board_name       VARCHAR(100) NOT NULL,
                change_pct       NUMERIC(10,4),
                amount           NUMERIC(20,2),
                lead_stock       VARCHAR(100),
                lead_change_pct  NUMERIC(10,4),
                rank_no          INTEGER,
                source           VARCHAR(60),
                fetched_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, board_type, board_name)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS derived_ashare_hot_sectors_daily_lookup_idx
              ON derived_ashare_hot_sectors_daily (trade_date DESC, board_type, rank_no)
        """)
    conn.commit()

    if not force:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM derived_ashare_hot_sectors_daily
                WHERE trade_date = CURRENT_DATE
                  AND fetched_at > NOW() - INTERVAL '4 hours'
            """)
            row = cur.fetchone()
            if row and row[0] and int(row[0]) >= 20:
                log.info("A-share hot sectors: fresh snapshot exists (%d rows), skipping.", row[0])
                return 0

    payload = run_script("fetch_ashare_hot_sectors.py", extra_args=["--top", "100"], timeout=120)
    if not payload or payload.get("error"):
        raise RuntimeError(f"ashare_hot_sectors fetch failed: {(payload or {}).get('error', 'no data')}")

    trade_date = str(payload.get("trade_date") or date.today().isoformat())[:10]
    # Prefer latest A-share session date when today's bar data is not in yet.
    with conn.cursor() as cur:
        cur.execute("SELECT MAX(trade_date) FROM raw_ashare_daily")
        row = cur.fetchone()
        if row and row[0]:
            latest_ashare = row[0] if isinstance(row[0], date) else date.fromisoformat(str(row[0])[:10])
            try:
                snap = date.fromisoformat(trade_date)
            except ValueError:
                snap = latest_ashare
            if snap > latest_ashare:
                trade_date = latest_ashare.isoformat()
    sources = payload.get("source") or {}
    records: list[tuple] = []
    for board_type in ("industry", "concept"):
        src = None
        if isinstance(sources, dict):
            src = sources.get(board_type)
        for item in payload.get(board_type) or []:
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            records.append((
                trade_date,
                board_type,
                name[:100],
                item.get("change_pct"),
                item.get("amount"),
                (str(item["lead_stock"])[:100] if item.get("lead_stock") else None),
                item.get("lead_change_pct"),
                item.get("rank"),
                (str(src)[:60] if src else None),
            ))

    if not records:
        raise RuntimeError("ashare_hot_sectors: empty normalized records")

    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM derived_ashare_hot_sectors_daily WHERE trade_date = %s::date",
            (trade_date,),
        )
        execute_values(
            cur,
            """
            INSERT INTO derived_ashare_hot_sectors_daily (
                trade_date, board_type, board_name, change_pct, amount,
                lead_stock, lead_change_pct, rank_no, source, fetched_at
            ) VALUES %s
            ON CONFLICT (trade_date, board_type, board_name) DO UPDATE
                SET change_pct = EXCLUDED.change_pct,
                    amount = EXCLUDED.amount,
                    lead_stock = EXCLUDED.lead_stock,
                    lead_change_pct = EXCLUDED.lead_change_pct,
                    rank_no = EXCLUDED.rank_no,
                    source = EXCLUDED.source,
                    fetched_at = NOW()
            """,
            records,
            template="(%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())",
            page_size=200,
        )
    conn.commit()
    log.info("A-share hot sectors: upserted %d rows for %s.", len(records), trade_date)
    return len(records)


def step_ashare_board_amount_hist(conn, *, force: bool = False) -> int:
    """Backfill curated AI/related board amount history for sector-crowding chart."""
    lookback_days = int(os.environ.get("BOARD_AMOUNT_HIST_DAYS", "365"))
    min_dates = int(os.environ.get("BOARD_AMOUNT_HIST_MIN_DATES", "80"))

    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS derived_ashare_board_amount_daily (
                trade_date   DATE         NOT NULL,
                board_type   VARCHAR(20)  NOT NULL,
                board_name   VARCHAR(100) NOT NULL,
                amount       NUMERIC(20,2),
                change_pct   NUMERIC(10,4),
                close        NUMERIC(16,4),
                source       VARCHAR(60),
                fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, board_type, board_name)
            )
        """)
        cur.execute("""
            SELECT COUNT(DISTINCT trade_date)
            FROM derived_ashare_board_amount_daily
            WHERE board_name = '人工智能'
              AND amount IS NOT NULL
              AND trade_date >= CURRENT_DATE - (%s || ' days')::interval
        """, (lookback_days,))
        row = cur.fetchone()
        ai_dates = int(row[0] or 0) if row else 0

    if not force and ai_dates >= min_dates:
        log.info(
            "A-share board amount hist: 人工智能 has %d dates (>= %d), skipping.",
            ai_dates,
            min_dates,
        )
        return 0

    log.info("A-share board amount hist: backfilling AI preset for %d days …", lookback_days)
    payload = run_script(
        "backfill_ashare_board_amount_hist.py",
        extra_args=["--preset", "ai", "--days", str(lookback_days)],
        timeout=900,
    )
    if not payload or payload.get("error"):
        raise RuntimeError(
            f"ashare_board_amount_hist failed: {(payload or {}).get('error', 'no data')}"
        )
    rows = int(payload.get("rows") or 0)
    log.info("A-share board amount hist: upserted %d rows.", rows)
    return rows


def _ensure_sector_fund_flow_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS derived_ashare_sector_fund_flow_daily (
                trade_date   DATE         NOT NULL,
                board_type   VARCHAR(20)  NOT NULL,
                board_name   VARCHAR(100) NOT NULL,
                inflow       NUMERIC(20,4),
                outflow      NUMERIC(20,4),
                net_flow     NUMERIC(20,4),
                change_pct   NUMERIC(10,4),
                source       VARCHAR(60),
                fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, board_type, board_name)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS derived_ashare_sector_fund_flow_daily_lookup_idx
              ON derived_ashare_sector_fund_flow_daily (board_type, board_name, trade_date DESC)
        """)
    conn.commit()


def step_ashare_sector_fund_flow(conn, *, force: bool = False) -> int:
    """
    1) Upsert today's industry/concept fund-flow snapshot (同花顺即时净额, 亿元)
    2) Gap-fill historical proxy from board amount × return when coverage is thin
    """
    _ensure_sector_fund_flow_table(conn)

    force_fetch = True
    if not force:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM derived_ashare_sector_fund_flow_daily
                WHERE trade_date = (
                        SELECT MAX(trade_date) FROM raw_ashare_daily
                      )
                  AND source LIKE '%fund_flow%spot%'
                  AND fetched_at > NOW() - INTERVAL '4 hours'
            """)
            row = cur.fetchone()
            live_n = int(row[0] or 0) if row else 0
            if live_n >= 50:
                log.info("A-share sector fund flow: fresh live snapshot (%d rows), skipping fetch.", live_n)
                force_fetch = False

    total = 0
    live_ok = False
    if force_fetch:
        payload = run_script("fetch_ashare_sector_fund_flow.py", timeout=180)
        if not payload or payload.get("error"):
            log.warning(
                "A-share sector fund flow live fetch failed: %s — will rely on proxy.",
                (payload or {}).get("error", "no data"),
            )
        else:
            trade_date = str(payload.get("trade_date") or date.today().isoformat())[:10]
            with conn.cursor() as cur:
                cur.execute("SELECT MAX(trade_date) FROM raw_ashare_daily")
                row = cur.fetchone()
                if row and row[0]:
                    latest = row[0] if isinstance(row[0], date) else date.fromisoformat(str(row[0])[:10])
                    try:
                        snap = date.fromisoformat(trade_date)
                    except ValueError:
                        snap = latest
                    if snap > latest:
                        trade_date = latest.isoformat()

            sources = payload.get("source") or {}
            records: list[tuple] = []
            seen: set[tuple[str, str]] = set()
            for board_type in ("industry", "concept"):
                src = sources.get(board_type) if isinstance(sources, dict) else None
                for item in payload.get(board_type) or []:
                    name = str(item.get("name") or "").strip()[:100]
                    if not name or item.get("net_flow") is None:
                        continue
                    key = (board_type, name)
                    if key in seen:
                        continue
                    seen.add(key)
                    records.append((
                        trade_date,
                        board_type,
                        name,
                        item.get("inflow"),
                        item.get("outflow"),
                        item.get("net_flow"),
                        item.get("change_pct"),
                        (str(src)[:60] if src else "ths_fund_flow_spot"),
                    ))
            if records:
                with conn.cursor() as cur:
                    execute_values(
                        cur,
                        """
                        INSERT INTO derived_ashare_sector_fund_flow_daily (
                            trade_date, board_type, board_name, inflow, outflow,
                            net_flow, change_pct, source, fetched_at
                        ) VALUES %s
                        ON CONFLICT (trade_date, board_type, board_name) DO UPDATE
                            SET inflow = EXCLUDED.inflow,
                                outflow = EXCLUDED.outflow,
                                net_flow = EXCLUDED.net_flow,
                                change_pct = EXCLUDED.change_pct,
                                source = EXCLUDED.source,
                                fetched_at = NOW()
                        """,
                        records,
                        template="(%s, %s, %s, %s, %s, %s, %s, %s, NOW())",
                        page_size=500,
                    )
                conn.commit()
                total += len(records)
                live_ok = True
                log.info("A-share sector fund flow: upserted %d live rows for %s.", len(records), trade_date)

    # Proxy history for cumulative stock chart
    with conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(DISTINCT trade_date)
            FROM derived_ashare_sector_fund_flow_daily
            WHERE board_type = 'industry'
              AND trade_date >= CURRENT_DATE - INTERVAL '120 days'
        """)
        hist_dates = int((cur.fetchone() or [0])[0] or 0)

    if force or hist_dates < 40 or not live_ok:
        proxy = run_script(
            "backfill_ashare_sector_fund_flow_proxy.py",
            extra_args=["--days", os.environ.get("SECTOR_FUND_FLOW_PROXY_DAYS", "365")],
            timeout=300,
        )
        if proxy and not proxy.get("error"):
            proxied = int(proxy.get("rows") or 0)
            total += proxied
            log.info("A-share sector fund flow: proxy backfilled %d rows.", proxied)
        elif proxy and proxy.get("error"):
            log.warning("A-share sector fund flow proxy failed: %s", proxy.get("error"))

    if total <= 0:
        raise RuntimeError("ashare_sector_fund_flow: no live or proxy rows written")
    return total


def step_ashare_hot_sectors_hist(conn, *, force: bool = False) -> int:
    """
    Gap-fill industry (and optionally concept) daily ranks from THS index history.
    Skips when industry already has enough distinct trade dates in the lookback window.
    """
    lookback_days = int(os.environ.get("HOT_SECTORS_HIST_DAYS", "60"))
    min_dates = int(os.environ.get("HOT_SECTORS_HIST_MIN_DATES", "20"))

    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS derived_ashare_hot_sectors_daily (
                trade_date       DATE         NOT NULL,
                board_type       VARCHAR(20)  NOT NULL,
                board_name       VARCHAR(100) NOT NULL,
                change_pct       NUMERIC(10,4),
                amount           NUMERIC(20,2),
                lead_stock       VARCHAR(100),
                lead_change_pct  NUMERIC(10,4),
                rank_no          INTEGER,
                source           VARCHAR(60),
                fetched_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, board_type, board_name)
            )
        """)
        cur.execute("""
            SELECT COUNT(DISTINCT trade_date)
            FROM derived_ashare_hot_sectors_daily
            WHERE board_type = 'industry'
              AND trade_date >= CURRENT_DATE - (%s || ' days')::interval
        """, (lookback_days,))
        row = cur.fetchone()
        industry_dates = int(row[0] or 0) if row else 0

    if not force and industry_dates >= min_dates:
        log.info(
            "A-share hot sectors hist: industry has %d dates (>= %d), skipping.",
            industry_dates,
            min_dates,
        )
        return 0

    # Industry first ( ~90 boards). Concept hist is heavier; opt-in via env.
    include_concept = os.environ.get("HOT_SECTORS_HIST_INCLUDE_CONCEPT", "0") == "1"
    board_type = "both" if include_concept else "industry"
    timeout = 1800 if include_concept else 600

    log.info(
        "A-share hot sectors hist: backfilling %s for %d days …",
        board_type,
        lookback_days,
    )
    payload = run_script(
        "backfill_ashare_hot_sectors_hist.py",
        extra_args=["--type", board_type, "--days", str(lookback_days), "--store-top", "0"],
        timeout=timeout,
    )
    if not payload or payload.get("error"):
        raise RuntimeError(
            f"ashare_hot_sectors_hist failed: {(payload or {}).get('error', 'no data')}"
        )

    total = 0
    for r in payload.get("results") or []:
        total += int(r.get("rows") or 0)
    log.info("A-share hot sectors hist: upserted %d rows.", total)
    return total


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Derived: basis_daily  (annualized basis for far/near L1/L)
# ═══════════════════════════════════════════════════════════════════════════════

def step_repair_basis_annualization(conn, *, force: bool = False) -> int:
    """
    Recompute days_to_maturity / annualized_basis_pct for existing basis rows.

    Far (L1) previously reused near-month expiry, so days_to_maturity collapsed
    to 1 around monthly rolls and the annualized series spiked to ±1000%.
    """
    log.info("Repairing basis annualization (near vs far expiry) …")
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT symbol, trade_date, basis_type, futures_settle, spot_close
            FROM derived_basis_daily
            WHERE futures_settle IS NOT NULL AND spot_close IS NOT NULL AND spot_close <> 0
            """
        )
        rows = cur.fetchall()

    if not rows:
        log.info("No basis rows to repair.")
        return 0

    updates = []
    for sym, td, basis_type, settle, spot in rows:
        td_py = td if isinstance(td, date) else td.date()
        settle_f = float(settle)
        spot_f = float(spot)
        expiry = far_expiry(td_py) if basis_type == "far" else next_expiry(td_py)
        days = max(1, (expiry - td_py).days)
        ann = (settle_f - spot_f) / spot_f / days * 365 * 100
        updates.append((days, expiry, ann, sym, td, basis_type))

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            UPDATE derived_basis_daily AS d
               SET days_to_maturity = v.days::int,
                   expiry_date = v.expiry::date,
                   annualized_basis_pct = v.ann::numeric,
                   computed_at = NOW()
              FROM (VALUES %s) AS v(days, expiry, ann, symbol, trade_date, basis_type)
             WHERE d.symbol = v.symbol
               AND d.trade_date = v.trade_date::date
               AND d.basis_type = v.basis_type
            """,
            updates,
            template="(%s, %s::date, %s, %s, %s::date, %s)",
        )
    conn.commit()
    log.info("Basis annualization repaired for %d rows.", len(updates))
    return len(updates)


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

            near_exp = next_expiry(td_py)
            far_exp = far_expiry(td_py)

            for basis_type, ts_code in (("far", far_code), ("near", near_code)):
                settle = fut_rows.get(ts_code)
                if settle is None:
                    continue
                # Far (L1) must use next-month expiry — using near expiry makes
                # days_to_maturity collapse to 1 near monthly rolls and spikes
                # annualized basis to hundreds/thousands of percent.
                expiry = far_exp if basis_type == "far" else near_exp
                days_to_exp = max(1, (expiry - td_py).days)
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

    with conn.cursor() as cur:
        # Prefer EmQuant spot when both sources exist for the same day.
        sql = """
            WITH legs(symbol, leg, ts_code) AS (
                VALUES
                  ('IH','L','IHL.CFX'), ('IH','L1','IHL1.CFX'), ('IH','L2','IHL2.CFX'), ('IH','L3','IHL3.CFX'),
                  ('IF','L','IFL.CFX'), ('IF','L1','IFL1.CFX'), ('IF','L2','IFL2.CFX'), ('IF','L3','IFL3.CFX'),
                  ('IC','L','ICL.CFX'), ('IC','L1','ICL1.CFX'), ('IC','L2','ICL2.CFX'), ('IC','L3','ICL3.CFX'),
                  ('IM','L','IML.CFX'), ('IM','L1','IML1.CFX'), ('IM','L2','IML2.CFX'), ('IM','L3','IML3.CFX')
            ),
            spot AS (
                SELECT DISTINCT ON (symbol, trade_date)
                       symbol, trade_date, close AS spot_close
                FROM raw_spot_daily
                WHERE symbol IN ('IH','IF','IC','IM')
                ORDER BY symbol, trade_date,
                         CASE WHEN source = 'emquant' THEN 0 ELSE 1 END
            ),
            src AS (
                SELECT
                    l.symbol,
                    f.trade_date,
                    l.leg,
                    l.ts_code AS futures_ts_code,
                    s.spot_close,
                    COALESCE(f.settle, f.close) AS futures_settle,
                    COALESCE(f.settle, f.close) - s.spot_close AS basis_diff
                FROM legs l
                JOIN raw_futures_daily f
                  ON f.ts_code = l.ts_code
                JOIN spot s
                  ON s.symbol = l.symbol AND s.trade_date = f.trade_date
                WHERE COALESCE(f.settle, f.close) IS NOT NULL
            """
        if not force:
            sql += """
                  AND NOT EXISTS (
                      SELECT 1 FROM derived_basis_cont_daily d
                      WHERE d.symbol = l.symbol
                        AND d.trade_date = f.trade_date
                        AND d.leg = l.leg
                  )
            """
        sql += """
            )
            INSERT INTO derived_basis_cont_daily
                (symbol, trade_date, leg, futures_ts_code, spot_close, futures_settle, basis_diff)
            SELECT symbol, trade_date, leg, futures_ts_code, spot_close, futures_settle, basis_diff
            FROM src
            ON CONFLICT (symbol, trade_date, leg) DO UPDATE
                SET futures_ts_code = EXCLUDED.futures_ts_code,
                    spot_close      = EXCLUDED.spot_close,
                    futures_settle  = EXCLUDED.futures_settle,
                    basis_diff      = EXCLUDED.basis_diff,
                    computed_at     = NOW()
            """
        cur.execute(sql)
        total = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    conn.commit()
    log.info("Basis cont daily: computed %d rows.", total)
    return total


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 7 — ETF daily prices  (EmQuant / Choice API)
# Column order must match training data: 510300.SH 510500.SH 511010.SH
#                                         511220.SH 511880.SH 518880.SH
# ═══════════════════════════════════════════════════════════════════════════════

def step_etf_prices(conn, trade_date: date, *, force: bool = False) -> int:
    """Fetch ORIGINALUNIT prices for the 6 model-input ETFs through trade_date.

    Gap-fills from the day after the oldest PCA-ETF max date so a missed nightly
    run does not leave multi-day holes that block predict_market_cluster.
    """
    if not force:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(DISTINCT ticker) FROM raw_etf_daily
                WHERE trade_date = %s AND field = 'ORIGINALUNIT'
                  AND ticker = ANY(%s)
                """,
                (trade_date, PCA_ETF_TICKERS),
            )
            count = cur.fetchone()[0]
        if count >= 6:
            log.info("ETF prices for %s already in DB (%d PCA tickers), skipping.", trade_date, count)
            return 0

    start = trade_date
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT MIN(max_d) FROM (
                SELECT ticker, MAX(trade_date) AS max_d
                FROM raw_etf_daily
                WHERE field = 'ORIGINALUNIT' AND ticker = ANY(%s)
                GROUP BY ticker
            ) t
            """,
            (PCA_ETF_TICKERS,),
        )
        row = cur.fetchone()
        cur_max = row[0] if row else None
    if cur_max and cur_max < trade_date and not force:
        # Catch up multi-day gaps after a missed/failed nightly run
        start = cur_max + timedelta(days=1)

    log.info("Fetching ETF prices %s → %s …", start, trade_date)
    out = run_script(
        "get_etf_prices.py",
        extra_args=[iso(start), iso(trade_date)],
        timeout=300,
    )
    if not out or out.get("error"):
        raise RuntimeError(f"ETF price fetch failed: {out}")

    items = out.get("data") or []
    if not items:
        log.warning("ETF prices: no data returned for %s → %s.", start, trade_date)
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
    log.info("ETF prices: upserted %d rows (%s → %s).", len(records), start, trade_date)
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

def step_afre(conn, *, force: bool = False) -> int:
    """Refresh 社融存量同比 CSV via Choice EDB (feeds regime + money-credit)."""
    log.info("Fetching AFRE (社融存量同比) …")
    result = run_script("fetch_afre_monthly.py", timeout=180)
    if not result or result.get("error"):
        raise RuntimeError(f"AFRE fetch failed: {result}")
    count = int(result.get("count") or 0)
    log.info("AFRE: wrote %d rows (latest=%s).", count, result.get("latest"))
    return count


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


def step_valuation_cache() -> int:
    """Pre-compute 估值表分析 page data (snapshot + trend + curves) for all managed funds.

    Results are stored in ops_valuation_precomputed_cache so the API can serve
    them instantly from cache instead of recomputing per request.

    Runs after investment_pool_metrics so the *_latest tables are fresh.
    """
    log.info("valuation_cache: pre-computing 估值表分析 data for all funds …")
    result = run_node_script("precompute_valuation_cache.ts", timeout=3600)
    if not result:
        raise RuntimeError("valuation_cache: no result from precompute_valuation_cache.ts")
    ok = int(result.get("ok") or 0)
    failed = int(result.get("failed") or 0)
    total = int(result.get("total") or 0)
    error_count = int(result.get("errorCount") or 0)
    log.info(
        "valuation_cache: ok=%d failed=%d total=%d errors=%d",
        ok, failed, total, error_count,
    )
    for err in (result.get("errors") or [])[:10]:
        log.warning("  valuation_cache: %s", err)
    return ok


def step_investment_pool_metrics() -> int:
    """Refresh 在管产品 + FOF底层 + 跟踪产品 list caches from stored email NAV / 估值表."""
    log.info("investment_pool_metrics: rebuilding managed / FOF / tracking list caches …")
    # --cache-only skips valuation JSONB backfills that exceed the 60-min timeout;
    # run full `email_nav_etl.ts --refresh-only` manually after deploy if needed.
    # 90m budget: tracking list (~6k funds) + FOF overview still need headroom even
    # after the cached 市值 / NAV-history fast path.
    result = run_node_script(
        "email_nav_etl.ts",
        extra_args=["--refresh-only", "--cache-only"],
        timeout=5400,
    )
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
    inv_overview_products = int(result.get("investmentOverviewProducts") or 0)
    inv_overview_nav = int(result.get("investmentOverviewNavRows") or 0)
    inv_overview_underlying = int(result.get("investmentOverviewUnderlyingRows") or 0)

    log.info(
        "investment_pool_metrics: managed=%d fof=%d tracking=%d "
        "valuation_sync(managed=%d fof=%d) fof_holdings=%d "
        "inv_overview(products=%d nav=%d underlying=%d)",
        managed,
        fof,
        tracking,
        managed_valuation,
        fof_market,
        fof_holdings,
        inv_overview_products,
        inv_overview_nav,
        inv_overview_underlying,
    )
    return managed + fof + tracking


def step_tracking_fund_metrics() -> int:
    """Backward-compatible alias for investment_pool_metrics."""
    return step_investment_pool_metrics()


def step_email_nav_parse(days: int | None = None) -> int:
    """Crawl fund emails, parse NAV/估值表 attachments, upsert ops_email_nav_records."""
    extra_args = ["--parse-only"]
    if days is not None:
        extra_args.append(f"--days={days}")
        log.info("email_nav_parse: explicit backfill (last %d days) …", days)
    else:
        log.info("email_nav_parse: incremental scan from last checkpoint …")

    result = run_node_script(
        "email_nav_etl.ts",
        extra_args=extra_args,
        timeout=5400,
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
    pool_sync = result.get("emailPoolSync") or {}

    log.info(
        "email_nav_parse: emails=%d records=%d nav_saved=%d valuation_saved=%d errors=%d",
        emails_scanned,
        records_found,
        nav_saved,
        valuation_saved,
        len(errors),
    )
    if pool_sync:
        log.info(
            "email_nav_parse: email_ops_pool inserted=%s removed=%s total=%s",
            pool_sync.get("inserted", 0),
            pool_sync.get("removed", 0),
            pool_sync.get("total", 0),
        )
    for err in errors[:8]:
        log.warning("  email_nav_parse: %s", err)
    return nav_saved + valuation_saved


def step_dd_materials_links() -> int:
    """Refresh 尽调表格 ↔ 「内部尽调资料」 links. Auto-matching is currently off."""
    log.info("dd_materials_links: syncing due diligence material folder links …")
    result = run_node_script("dd_materials_link_etl.ts", timeout=600)
    if not result:
        raise RuntimeError("dd_materials_links: no result from dd_materials_link_etl.ts")
    if not result.get("ok"):
        raise RuntimeError(
            f"dd_materials_links: failed — {result.get('error', 'unknown')}"
        )

    changed = int(result.get("changedRows") or 0)
    linked = int(result.get("linkedRows") or 0)
    cleared = int(result.get("clearedRows") or 0)
    folders = int(result.get("kbFolderCount") or 0)
    log.info(
        "dd_materials_links: folders=%d changed=%d linked=%d cleared=%d",
        folders,
        changed,
        linked,
        cleared,
    )
    for change in (result.get("changes") or [])[:10]:
        log.info(
            "  dd_materials_links: %s (%s): %s -> %s",
            change.get("fundCompany") or change.get("rowId"),
            change.get("ddDate"),
            change.get("fromPath") or "(empty)",
            change.get("toPath") or "(empty)",
        )
    return changed


def step_contract_extract() -> int:
    """Drain queued/failed fund-contract element extract jobs (LLM)."""
    log.info("contract_extract: draining queued contract extract jobs …")
    result = run_node_script("contract_extract_etl.ts", extra_args=["--retry-failed"], timeout=3600)
    if not result:
        raise RuntimeError("contract_extract: no result from contract_extract_etl.ts")
    if not result.get("ok"):
        raise RuntimeError(
            f"contract_extract: failed — {result.get('error', 'unknown')}"
        )
    processed = int(result.get("processed") or 0)
    applied = int(result.get("applied") or 0)
    needs_review = int(result.get("needsReview") or 0)
    failed = int(result.get("failed") or 0)
    remaining = int(result.get("remaining") or 0)
    log.info(
        "contract_extract: processed=%d applied=%d needs_review=%d failed=%d remaining=%d",
        processed,
        applied,
        needs_review,
        failed,
        remaining,
    )
    return processed


def step_dd_table_daily_backup() -> int:
    """Snapshot 尽调表格 into due_diligence_team_table_backups (keep last 3 daily)."""
    log.info("dd_table_daily_backup: creating daily due diligence table backup …")
    result = run_node_script("dd_table_daily_backup_etl.ts", timeout=300)
    if not result:
        raise RuntimeError("dd_table_daily_backup: no result from dd_table_daily_backup_etl.ts")
    if not result.get("ok"):
        raise RuntimeError(
            f"dd_table_daily_backup: failed — {result.get('error', 'unknown')}"
        )
    if result.get("skipped"):
        log.info("dd_table_daily_backup: skipped (%s)", result.get("reason") or "empty")
        return 0
    log.info(
        "dd_table_daily_backup: id=%s rows=%s created_at=%s",
        result.get("id"),
        result.get("rowCount"),
        result.get("createdAt"),
    )
    return 1


def step_amac_extra(force_full: bool = False) -> int:
    """Fetch AMAC manager/personnel data and upsert amac_* extra tables."""
    project_root = SCRIPT_DIR.parent.parent
    script_path = project_root / "scripts" / "db" / "amac_extra_etl.py"
    cmd = _python_cmd(str(script_path), *(["--full"] if force_full else []))

    try:
        full_sync_dow = int(os.environ.get("AMAC_ETL_FULL_SYNC_DOW", "6"))
    except ValueError:
        full_sync_dow = 6
    weekly_full = datetime.now().weekday() == full_sync_dow
    # Full manager-detail (~19k HTML) + every org's personnel list can take many hours.
    timeout = 43200 if force_full or weekly_full else 14400

    log.info(
        "amac_extra: running amac_extra_etl.py (timeout=%ds%s) …",
        timeout,
        ", full detail sync" if force_full or weekly_full else ", incremental",
    )
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
        cwd=str(project_root),
    )
    stdout_lines: list[str] = []
    assert proc.stdout is not None

    def _pump_amac_extra_output() -> None:
        for line in proc.stdout:
            line = line.rstrip("\n")
            if line:
                log.info(line)
                stdout_lines.append(line)

    pump = threading.Thread(target=_pump_amac_extra_output, daemon=True)
    pump.start()
    pump.join(timeout)
    if pump.is_alive():
        proc.kill()
        raise RuntimeError(f"amac_extra_etl.py timed out after {timeout}s")
    proc.wait()
    stdout = "\n".join(stdout_lines).strip()
    if proc.returncode != 0:
        raise RuntimeError(
            f"amac_extra_etl.py failed (exit {proc.returncode}): "
            f"{stdout or 'no output'}"
        )

    summary = None
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                summary = json.loads(line)
                break
            except json.JSONDecodeError:
                continue

    if summary and summary.get("ok"):
        return int(summary.get("rows_upserted") or 0)

    match = re.search(r"managers=([\d,]+)", stdout)
    if match:
        return int(match.group(1).replace(",", ""))
    return 0


def step_pe_industry_stats() -> int:
    """Aggregate AMAC data into pe_industry_* tables for the 私募行业 dashboard."""
    project_root = SCRIPT_DIR.parent.parent
    script_path = project_root / "scripts" / "db" / "pe_industry_stats_etl.py"
    python_exe = os.environ.get("PYTHON_EXE") or (
        "py" if sys.platform == "win32" else "python3"
    )
    prefix = ["py", "-3"] if sys.platform == "win32" and python_exe == "py" else [python_exe]
    cmd = prefix + [str(script_path)]

    log.info("pe_industry_stats: running pe_industry_stats_etl.py …")
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env={**os.environ},
        cwd=str(project_root),
    )
    stdout_lines: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip("\n")
        if line:
            log.info(line)
            stdout_lines.append(line)
    try:
        proc.wait(timeout=1800)
    except subprocess.TimeoutExpired as exc:
        proc.kill()
        raise RuntimeError("pe_industry_stats_etl.py timed out after 1800s") from exc
    stdout = "\n".join(stdout_lines).strip()
    if proc.returncode != 0:
        raise RuntimeError(
            f"pe_industry_stats_etl.py failed (exit {proc.returncode}): "
            f"{stdout or 'no output'}"
        )

    summary = None
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                summary = json.loads(line)
                break
            except json.JSONDecodeError:
                continue

    if summary and summary.get("ok"):
        return int(summary.get("monthly_rows") or 0)
    return 0


def step_sync_amac_fund_metadata() -> int:
    """Sync 备案日期 / 公司管理规模 from amac_* tables into basicinfo_bfl_track."""
    project_root = SCRIPT_DIR.parent.parent
    script_path = project_root / "scripts" / "db" / "sync_amac_fund_metadata.py"
    cmd = _python_cmd(str(script_path), "--backfill-rows")

    log.info("sync_amac_fund_metadata: running sync_amac_fund_metadata.py …")
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=1800,
        env={**os.environ},
        cwd=str(project_root),
    )
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()
    if stdout:
        for line in stdout.splitlines():
            log.info(line)
    if stderr:
        for line in stderr.splitlines():
            log.info(line)
    if result.returncode != 0:
        raise RuntimeError(
            f"sync_amac_fund_metadata.py failed (exit {result.returncode}): "
            f"{stderr or stdout or 'no output'}"
        )

    summary = None
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                summary = json.loads(line)
                break
            except json.JSONDecodeError:
                continue

    if summary and summary.get("ok"):
        return int(summary.get("puton_date_updated") or 0) + int(summary.get("scale_updated") or 0)

    match = re.search(r"puton_date=([\d,]+)", stdout)
    if match:
        return int(match.group(1).replace(",", ""))
    return 0


def step_amac_private_funds(force_full: bool = False) -> int:
    """Fetch AMAC private fund list and upsert amac_private_funds (+ new private_fund_info rows)."""
    project_root = SCRIPT_DIR.parent.parent
    script_path = project_root / "scripts" / "db" / "amac_private_funds_etl.py"
    cmd = _python_cmd(str(script_path), *(["--full"] if force_full else []))

    try:
        full_sync_dow = int(os.environ.get("AMAC_ETL_FULL_SYNC_DOW", "6"))
    except ValueError:
        full_sync_dow = 6
    weekly_full = datetime.now().weekday() == full_sync_dow
    timeout = 14400 if force_full or weekly_full else 3600

    log.info(
        "amac_private_funds: running amac_private_funds_etl.py (timeout=%ds%s) …",
        timeout,
        ", full sync" if force_full or weekly_full else ", incremental",
    )
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        env={**os.environ},
        cwd=str(project_root),
    )
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()
    if stdout:
        for line in stdout.splitlines():
            log.info(line)
    if stderr:
        for line in stderr.splitlines():
            log.info(line)
    if result.returncode != 0:
        raise RuntimeError(
            f"amac_private_funds_etl.py failed (exit {result.returncode}): "
            f"{stderr or stdout or 'no output'}"
        )

    summary = None
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                summary = json.loads(line)
                break
            except json.JSONDecodeError:
                continue

    if summary and summary.get("ok"):
        return int(summary.get("rows_upserted") or 0)

    match = re.search(r"upserted=([\d,]+)", stdout)
    if match:
        return int(match.group(1).replace(",", ""))
    return 0


def step_amac_futures(force_full: bool = False) -> int:
    """Fetch AMAC 期货公司集合资管 list and upsert into private_fund_info."""
    _ = force_full
    project_root = SCRIPT_DIR.parent.parent
    script_path = project_root / "scripts" / "db" / "amac_futures_etl.py"
    cmd = _python_cmd(str(script_path))
    timeout = 1800

    log.info("amac_futures: running amac_futures_etl.py (timeout=%ds) …", timeout)
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        env={**os.environ},
        cwd=str(project_root),
    )
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()
    if stdout:
        for line in stdout.splitlines():
            log.info(line)
    if stderr:
        for line in stderr.splitlines():
            log.info(line)
    if result.returncode != 0:
        raise RuntimeError(
            f"amac_futures_etl.py failed (exit {result.returncode}): "
            f"{stderr or stdout or 'no output'}"
        )

    summary = None
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                summary = json.loads(line)
                break
            except json.JSONDecodeError:
                continue

    if summary and summary.get("ok"):
        return int(summary.get("rows_upserted") or 0)

    match = re.search(r"upserted=([\d,]+)", stdout)
    if match:
        return int(match.group(1).replace(",", ""))
    return 0


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


# Steps that refresh /ma/dashboard/macro-market and 期货市场 Nanhua charts.
# nanhua_indices lives here (not only the 01:00 full nightly) so sector charts
# keep updating when the full cron is down — the 02:30 macro job is the one
# that actually runs every day.
MACRO_STEPS = [
    "nhci",
    "nanhua_indices",
    "akshare_futures_daily",
    "futures_rollover_dates",
    "commodity_amounts",
    "spot_closes",
    "futures_continuous_gapfill",
    "repair_futures_snapshot",
    "derive_basis",
    "derive_basis_cont",
    "cffex_index_month_contracts",
    "etf_prices",
    "predict_market_cluster",
    "predict_market_cluster_weekly",
    "predict_market_cluster_monthly",
    "afre",
    "regime_indicators",
    "regime_similarity",
    "shibor_3m",
    "money_credit",
]

# AMAC fund-list sync. Scheduled separately so a broken 01:00 full nightly
# (missing +x on the launcher, vanished venv, hung option_iv, etc.) cannot
# stall private-fund search for newly filed products.
AMAC_STEPS = [
    "amac_private_funds",
    "amac_futures",
    "sync_amac_fund_metadata",
]

# Chart-critical 期货/期权 steps. Scheduled separately so a broken 01:00 full
# nightly (venv missing, later AMAC timeouts, etc.) cannot freeze those pages.
FUTURES_STEPS = [
    "nhci",
    "nanhua_indices",
    "akshare_futures_daily",
    "futures_rollover_dates",
    "commodity_amounts",
    "spot_closes",
    "futures_continuous_gapfill",
    "repair_futures_snapshot",
    "derive_basis",
    "derive_basis_cont",
    "cffex_index_month_contracts",
    "option_iv",
    "commodity_option_iv",
]

# Steps that refresh /ma/dashboard/stock-market charts (crowding, board share, top stocks, hot sectors).
STOCK_STEPS = [
    "ashare_daily",
    "ashare_stock_names",
    "ashare_index",
    "ashare_crowding",
    "ashare_hot_sectors",
    "ashare_hot_sectors_hist",
    "ashare_board_amount_hist",
    "ashare_sector_fund_flow",
]

ORDERED_STEPS = [
    "nhci",
    "nheci",
    "nanhua_indices",              # all 17 NH sub-indices OHLCV
    "nanhua_commodity_indices",    # all 80 NH single-commodity indices OHLCV
    "futures_contracts_ohlcv",      # OHLCV for every futures contract MOM traded (EmQuant)
    # Continuous futures BEFORE option IV — MOM VaR depends on this table. option_iv
    # has hung for hours on AkShare; it must not gate market-data catchup.
    "akshare_futures_daily",        # 87 continuous contracts via AkShare/Sina (no auth)
    "akshare_exchange_daily",       # per-contract volume+OI from exchange bulletins (free fallback)
    "cffex_index_month_contracts",  # IH/IF/IC/IM month contracts for 合约年化基差 charts
    "options_contracts_ohlcv",      # OHLCV + greeks for every options contract MOM traded
    "option_iv",                    # China financial option IV snapshot + QVIX (AkShare)
    "commodity_option_iv",          # China commodity option series/ATM IV (AkShare exchanges)
    "futures_rollover_dates",       # rollover dates from OI-dominant-contract tracking
    "spot_closes",
    "futures_latest",
    "futures_continuous_gapfill",   # keep IFL/L1/L2/L3 current (AkShare fallback if Tushare lapses)
    "repair_futures_snapshot",      # fill snapshot cards from continuous L/L1 when Tushare shells are empty
    "commodity_amounts",
    "ashare_daily",
    "ashare_stock_names",
    "ashare_index",
    "ashare_crowding",
    "ashare_hot_sectors",
    "ashare_hot_sectors_hist",
    "ashare_board_amount_hist",
    "ashare_sector_fund_flow",
    "derive_basis",
    "repair_basis_annualization",  # fix far L1 days-to-expiry / annualized spikes
    "derive_basis_cont",
    "repair_settle_returns",
    "etf_prices",                    # nightly: gap-fill PCA ETF prices → trade_date
    "etf_extended_backfill",         # on-demand: re-fetch 2 years of ETF history
    "predict_market_cluster",        # daily
    "predict_market_cluster_weekly",
    "predict_market_cluster_monthly",
    "afre",                          # Choice EDB 社融存量同比 → CSV (regime + money-credit)
    "regime_indicators",             # monthly macro indicators for regime model
    "regime_similarity",             # compute economic regime similarity
    "shibor_3m",                     # monthly SHIBOR 3M data
    "money_credit",                  # money+credit cycle calculation
    "email_nav_parse",               # crawl fund emails → ops_email_nav_records + 估值表 (allocation trend history)
    "amac_private_funds",            # AMAC disclosure list → amac_private_funds (+ new private_fund_info)
    "amac_futures",                  # AMAC 期货公司集合资管 → amac_futures_products (+ new private_fund_info)
    "amac_extra",                    # AMAC managers / all orgs / every person + executives → amac_* tables
    "sync_amac_fund_metadata",       # 备案日期 / 公司管理规模 → basicinfo_bfl_track
    "pe_industry_stats",             # 私募行业 dashboard aggregates from amac_* tables
    "private_fund_indicators",       # recompute 私募基金 dashboard metrics from NAV
    "investment_pool_metrics",       # 在管产品 + FOF底层 + 跟踪产品 list caches
    "dd_materials_links",            # 尽调表格 links (auto-matching currently off)
    "contract_extract",              # queued fund-contract LLM extract → 产品要素 + 合同附件
    "dd_table_daily_backup",         # 尽调表格 daily snapshot (rolling keep last 3)
    "valuation_cache",               # pre-compute 估值表分析 page data (snapshot + trend + curves)
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
    parser.add_argument(
        "--group",
        choices=["macro", "stock", "futures", "amac"],
        help="Run a predefined step group (macro / stock / futures+options / AMAC funds)",
    )
    parser.add_argument("--backfill", action="store_true", help="Force full history reload")
    parser.add_argument("--force", action="store_true", help="Re-fetch even if data already in DB")
    parser.add_argument("--date", help="Override target trade date (YYYY-MM-DD or YYYYMMDD)")
    args = parser.parse_args()

    if args.step and args.group:
        parser.error("Use only one of --step or --group")

    log.info("=" * 60)
    log.info("Nightly ETL starting  (pid=%d)", os.getpid())
    log.info("Python for child scripts: %s", _resolve_python_exe())
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
        "cffex_index_month_contracts": lambda: step_cffex_index_month_contracts(conn, force=force),
        "options_contracts_ohlcv":    lambda: step_options_contracts_ohlcv(conn, force=force),
        "option_iv":                  lambda: step_option_iv(conn, force=force),
        "commodity_option_iv":        lambda: step_commodity_option_iv(conn, force=force),
        "akshare_futures_daily":      lambda: step_akshare_futures_daily(conn, force=force),
        "futures_rollover_dates":     lambda: step_futures_rollover_dates(conn, force=force),
        "spot_closes":      lambda: step_spot_closes(conn, td, force=force),
        "futures_latest":   lambda: step_futures_latest(conn, td, force=force),
        "futures_continuous_gapfill": lambda: step_futures_continuous_gapfill(conn, td, force=force),
        "repair_futures_snapshot": lambda: step_repair_futures_snapshot_from_continuous(conn, force=force),
        "commodity_amounts":lambda: step_commodity_amounts(conn, td, force=force),
        "ashare_daily":        lambda: step_ashare_daily(conn, force=force),
        "ashare_stock_names":  lambda: step_ashare_stock_names(conn, force=force),
        "ashare_index":        lambda: step_ashare_index(conn, force=force),
        "ashare_crowding":     lambda: step_compute_ashare_crowding(conn, force=force),
        "ashare_hot_sectors":  lambda: step_ashare_hot_sectors(conn, force=force),
        "ashare_hot_sectors_hist": lambda: step_ashare_hot_sectors_hist(conn, force=force),
        "ashare_board_amount_hist": lambda: step_ashare_board_amount_hist(conn, force=force),
        "ashare_sector_fund_flow": lambda: step_ashare_sector_fund_flow(conn, force=force),
        "derive_basis":          lambda: step_compute_basis_daily(conn, force=force),
        "repair_basis_annualization": lambda: step_repair_basis_annualization(conn, force=force),
        "derive_basis_cont":     lambda: step_compute_basis_cont_daily(conn, force=force),
        "repair_settle_returns": lambda: step_repair_settle_returns(conn),
        "etf_prices":            lambda: step_etf_prices(conn, td, force=force),
        "etf_extended_backfill": lambda: step_etf_backfill(conn, td - timedelta(days=760), td),
        "predict_market_cluster":          lambda: step_predict_market_cluster(conn, None, freq="daily",   force=force),
        "predict_market_cluster_weekly":   lambda: step_predict_market_cluster(conn, None, freq="weekly",  force=force),
        "predict_market_cluster_monthly":  lambda: step_predict_market_cluster(conn, None, freq="monthly", force=force),
        "afre":                            lambda: step_afre(conn, force=force),
        "regime_indicators":               lambda: step_regime_indicators(conn, force=force),
        "regime_similarity":               lambda: step_regime_similarity(conn),
        "shibor_3m":                       lambda: step_shibor_3m(conn, force=force),
        "money_credit":                    lambda: step_money_credit(conn),
        "email_nav_parse":                 lambda: step_email_nav_parse(),
        "amac_private_funds":              lambda: step_amac_private_funds(force_full=force),
        "amac_futures":                    lambda: step_amac_futures(force_full=force),
        "amac_extra":                      lambda: step_amac_extra(force_full=force),
        "sync_amac_fund_metadata":         lambda: step_sync_amac_fund_metadata(),
        "pe_industry_stats":               lambda: step_pe_industry_stats(),
        "private_fund_indicators":         lambda: step_private_fund_indicators(conn),
        "investment_pool_metrics":         lambda: step_investment_pool_metrics(),
        "dd_materials_links":              lambda: step_dd_materials_links(),
        "contract_extract":                lambda: step_contract_extract(),
        "dd_table_daily_backup":           lambda: step_dd_table_daily_backup(),
        "tracking_fund_metrics":           lambda: step_tracking_fund_metrics(),
        "valuation_cache":                 lambda: step_valuation_cache(),
        "warm_mom_cache":                  lambda: step_warm_mom_cache(),
        "backfill_benchmarks":             lambda: step_backfill_benchmarks(conn, start=date(2020, 1, 1)),
    }

    if args.step:
        steps_to_run = [args.step]
    elif args.group == "macro":
        steps_to_run = MACRO_STEPS
        log.info("Running macro-market step group (%d steps)", len(steps_to_run))
    elif args.group == "stock":
        steps_to_run = STOCK_STEPS
        log.info("Running stock-market step group (%d steps)", len(steps_to_run))
    elif args.group == "futures":
        steps_to_run = FUTURES_STEPS
        log.info("Running futures/options step group (%d steps)", len(steps_to_run))
    elif args.group == "amac":
        steps_to_run = AMAC_STEPS
        log.info("Running AMAC fund-list step group (%d steps)", len(steps_to_run))
    else:
        steps_to_run = ORDERED_STEPS
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
