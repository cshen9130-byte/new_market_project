#!/usr/bin/env python3
"""
Incremental MOM trade-detail ETL
================================

Reads xlsx files from MOM data folders (03.投顾逐日), parses:
- 品种汇总: D6(account), I6(trade_date)
- 成交明细: header row 11, data rows start at 12, columns B..Q

Then upserts detail rows into PostgreSQL.

Behavior:
- First run: processes all files
- Later runs: only files that are new/changed (mtime/size delta)

Environment:
- DATABASE_URL (preferred) OR DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
- MOM_DATA_DIR (preferred)
  default: ../mom_data/03.投顾逐日 relative to project root
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import posixpath
import re
import subprocess
import sys
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Tuple
from xml.etree import ElementTree as ET

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("mom_etl")


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"main": MAIN_NS, "rel": REL_NS, "pkg": PKG_REL_NS}

SUMMARY_SHEET_NAME = "品种汇总"
DETAIL_SHEET_NAME = "成交明细"
HEADER_ROW = 11
DATA_START_ROW = 12
FIRST_COLUMN = 2
LAST_COLUMN = 17

JOB_NAME = "mom_data_etl"

# Ordered list of (xlsx header text, SQL column name).
# Matches columns B-Q in 成交明细 sheet, same order as export_trade_details_by_account.py.
DETAIL_COLUMNS: List[Tuple[str, str]] = [
    ("合约",           "合约"),
    ("成交编号",        "成交编号"),
    ("成交时间",        "成交时间"),
    ("买/卖",          "买/卖"),
    ("投机/套保",       "投机/套保"),
    ("成交价",         "成交价"),
    ("手数",           "手数"),
    ("成交额",         "成交额"),
    ("开/平",          "开/平"),
    ("手续费",         "手续费"),
    ("平仓盈亏",        "平仓盈亏"),
    ("资金账户报单编号", "资金账户报单编号"),
    ("成交日期",        "成交日期"),
    ("权利金收支",      "权利金收支"),
    ("资金账户成交编号", "资金账户成交编号"),
    ("交易所",         "交易所"),
]
DETAIL_SQL_COLS = [f'"{sql}"' for _, sql in DETAIL_COLUMNS]
DETAIL_XLSX_HEADERS = [xlsx for xlsx, _ in DETAIL_COLUMNS]
FUTURES_DETAIL_SHEET_NAME = "期货成交明细"
# 期货成交明细 rows: same B-Q columns as 成交明细, plus 账户 (D6) and 交易日期 (I6).
FUTURES_SQL_COLS = ['"账户"', '"交易日期"'] + DETAIL_SQL_COLS

OPTIONS_DETAIL_SHEET_NAME = "期权成交明细"
# 期权成交明细 rows: same B-Q columns, plus 账户 (D6) and 交易日期 (I6).
OPTIONS_SQL_COLS = ['"账户"', '"交易日期"'] + DETAIL_SQL_COLS

CLOSE_DETAIL_SHEET_NAME = "平仓明细"
# 平仓明细 columns B11:N11 (13 cols). L11 is a second "开仓价" — stored as "开仓价2".
CLOSE_LAST_COLUMN = 14  # N = column index 14 (B=2 … N=14)
CLOSE_COLUMNS: List[Tuple[str, str]] = [
    ("合约",         "合约"),
    ("买/卖",        "买/卖"),
    ("成交价",       "成交价"),
    ("开仓价",       "开仓价"),
    ("手数",         "手数"),
    ("昨结算价",     "昨结算价"),
    ("平仓盈亏",     "平仓盈亏"),
    ("交易所",       "交易所"),
    ("权利金收支",   "权利金收支"),
    ("开仓日期",     "开仓日期"),
    ("开仓价2",      "开仓价2"),       # L11: second 开仓价 column
    ("开仓成交编号", "开仓成交编号"),
    ("逐笔平仓盈亏", "逐笔平仓盈亏"),
]
CLOSE_SQL_COLS = ['"账户"', '"交易日期"'] + [f'"{sql}"' for _, sql in CLOSE_COLUMNS]

POSITION_DETAIL_SHEET_NAME = "持仓明细"
# 持仓明细 columns B11:S11 (18 cols). S = column index 19.
POSITION_LAST_COLUMN = 19  # S = column index 19
POSITION_COLUMNS: List[Tuple[str, str]] = [
    ("合约",         "合约"),
    ("成交序号",     "成交序号"),
    ("买持仓",       "买持仓"),
    ("买入价",       "买入价"),
    ("卖持仓",       "卖持仓"),
    ("卖出价",       "卖出价"),
    ("昨结算价",     "昨结算价"),
    ("今结算价",     "今结算价"),
    ("持仓盈亏",     "持仓盈亏"),
    ("投机/套保",    "投机/套保"),
    ("交易编码",     "交易编码"),
    ("实际成交日期", "实际成交日期"),
    ("期权市値",     "期权市値"),
    ("多头期权市値", "多头期权市値"),
    ("空头期权市値", "空头期权市値"),
    ("持仓市値",     "持仓市値"),
    ("保证金",       "保证金"),
    ("交易所",       "交易所"),
]
POSITION_SQL_COLS = ['"账户"', '"交易日期"'] + [f'"{sql}"' for _, sql in POSITION_COLUMNS]

OPTIONS_POSITION_DETAIL_SHEET_NAME = "期权持仓明细"
# 期权持仓明细 has identical B11:S11 columns to 持仓明细 — reuse POSITION_COLUMNS / POSITION_LAST_COLUMN.

FUTURES_POSITION_DETAIL_SHEET_NAME = "期货持仓明细"
# 期货持仓明细 has identical B11:S11 columns to 持仓明细 — reuse POSITION_COLUMNS / POSITION_LAST_COLUMN.

ORDER_DETAIL_SHEET_NAME = "委托明细"
# 委托明细 columns B11:M11 (12 cols). M = column index 13.
ORDER_LAST_COLUMN = 13  # M = column index 13
ORDER_COLUMNS: List[Tuple[str, str]] = [
    ("报单编号",   "报单编号"),
    ("报单时间",   "报单时间"),
    ("合约",       "合约"),
    ("方向",       "方向"),
    ("开平",       "开平"),
    ("投保",       "投保"),
    ("价格",       "价格"),
    ("委托数量",   "委托数量"),
    ("成交数量",   "成交数量"),
    ("状态",       "状态"),
    ("交易日",     "交易日"),
    ("交易所",     "交易所"),
]
ORDER_SQL_COLS = ['"账户"', '"交易日期"'] + [f'"{sql}"' for _, sql in ORDER_COLUMNS]

SUMMARY_DETAIL_SHEET_NAME = "品种汇总"
# 品种汇总 columns B11:G11 (6 cols). G = column index 7.
SUMMARY_DETAIL_LAST_COLUMN = 7  # G = column index 7
SUMMARY_DETAIL_COLUMNS: List[Tuple[str, str]] = [
    ("品种",   "品种"),
    ("手数",   "手数"),
    ("成交额", "成交额"),
    ("手续费", "手续费"),
    ("平仓盈亏", "平仓盈亏"),
    ("交易日", "交易日"),
]
SUMMARY_DETAIL_SQL_COLS = ['"账户"', '"交易日期"'] + [f'"{sql}"' for _, sql in SUMMARY_DETAIL_COLUMNS]

DAILY_REPORT_SHEET_NAME = "客户交易核算日报"
# Ordered (cell_ref, column_name) pairs to read from 客户交易核算日报 sheet.
DAILY_REPORT_COL_ORDER: List[Tuple[str, str]] = [
    ("D6",  "账户"),
    ("I6",  "交易日期"),
    ("D11", "上日结存"),
    ("I11", "客户权益"),
    ("D12", "当日存取合计"),
    ("I12", "实有货币资金"),
    ("D13", "当日盈亏"),
    ("I13", "非货币充抖金额"),
    ("D14", "当日总权利金"),
    ("I14", "货币充抖金额"),
    ("D15", "当日手续费"),
    ("I15", "冻结资金"),
    ("D16", "当日结存"),
    ("I16", "保证金占用"),
    ("D17", "可用资金"),
    ("I17", "风险度"),
    ("D18", "追加保证金"),
    ("I18", "市値权益"),
    ("D19", "多头期权市値"),
    ("I19", "空头期权市値"),
    ("D20", "权利金收入"),
    ("I20", "权利金支出"),
    ("D21", "行权手续费"),
    ("I21", "行权盈亏"),
    ("D22", "申报费"),
    ("D23", "平仓盈亏"),
    ("I23", "持仓盈亏"),
]
DAILY_REPORT_SQL_COLS = [f'"{col}"' for _, col in DAILY_REPORT_COL_ORDER]

DAILY_REPORT_FUND_FLOW_SECTION_TITLE = "期货期权账户出入金明细（单位：人民币）"
DAILY_REPORT_FUND_FLOW_TITLE_ROW = 25
DAILY_REPORT_FUND_FLOW_HEADER_ROW = 26
DAILY_REPORT_FUND_FLOW_DATA_START_ROW = 27
DAILY_REPORT_FUND_FLOW_FIRST_COLUMN = 2  # B
DAILY_REPORT_FUND_FLOW_LAST_COLUMN = 6   # F
DAILY_REPORT_FUND_FLOW_COLUMNS: List[Tuple[str, str]] = [
    ("发生日期", "发生日期"),
    ("方向", "方向"),
    ("最大允许亏损金额", "最大允许亏损金额"),
    ("不可亏损金额", "不可亏损金额"),
    ("说明", "说明"),
]
DAILY_REPORT_FUND_FLOW_SQL_COLS = ['"账户"', '"交易日期"'] + [f'"{sql}"' for _, sql in DAILY_REPORT_FUND_FLOW_COLUMNS]

def load_env_files() -> None:
    """Walk up and load .env/.env.local without overriding existing env vars."""
    candidates = [Path(__file__).resolve().parent, Path.cwd()]
    for base in candidates:
        cursor = base
        for _ in range(4):
            for fname in (".env.local", ".env"):
                env_file = cursor / fname
                if not env_file.is_file():
                    continue
                for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
            cursor = cursor.parent


def get_conn():
    try:
        import psycopg2  # type: ignore[import-untyped]
    except ImportError as exc:
        raise RuntimeError("psycopg2 not installed. Run: pip install psycopg2-binary") from exc

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


def resolve_base_dir(override: str | None) -> Path:
    if override:
        return Path(override)
    env_dir = os.environ.get("MOM_DATA_DIR")
    if env_dir:
        return Path(env_dir)

    # default: project sibling folder ../mom_data/03.投顾逐日
    project_root = Path(__file__).resolve().parents[2]
    return project_root.parent / "mom_data" / "03.投顾逐日"


# ── Market data helpers ───────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent


def _safe_float(v) -> float | None:
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _to_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, date):
        return val
    s = str(val).replace("-", "").strip()
    try:
        return datetime.strptime(s, "%Y%m%d").date()
    except ValueError:
        return None


def _iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def _max_date(conn, table: str, col: str = "trade_date") -> date | None:
    with conn.cursor() as cur:
        cur.execute(f"SELECT MAX({col}) FROM {table}")  # noqa: S608
        row = cur.fetchone()
    return row[0] if (row and row[0]) else None


def _max_valid_date(conn, table: str, col: str = "trade_date", code: str | None = None) -> date | None:
    """Max date where close > 0 for a specific code (or table-wide if code is None).

    Using a specific representative code avoids the pitfall where other codes in
    the same table have valid close>0 for today while the target code still has
    close=0 (placeholder stored by a pre-close nightly ETL run).
    """
    with conn.cursor() as cur:
        try:
            if code:
                cur.execute(
                    f"SELECT MAX({col}) FROM {table} WHERE code = %s AND CAST(close AS float8) > 0",  # noqa: S608
                    (code,),
                )
            else:
                cur.execute(f"SELECT MAX({col}) FROM {table} WHERE CAST(close AS float8) > 0")  # noqa: S608
            row = cur.fetchone()
            return row[0] if (row and row[0]) else None
        except Exception:
            conn.rollback()
            return _max_date(conn, table, col)


def _run_script(
    script_name: str,
    extra_args: list | None = None,
    timeout: int = 600,
) -> dict | None:
    """Run a sibling script and return its JSON stdout, or None on failure."""
    script_path = SCRIPT_DIR / script_name
    python_exe = os.environ.get("PYTHON_EXE") or (
        "py" if sys.platform == "win32" else "python3"
    )
    prefix = ["py", "-3"] if sys.platform == "win32" and python_exe == "py" else [python_exe]
    cmd = prefix + [str(script_path)] + (extra_args or [])
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, env=os.environ
        )
        stderr = (result.stderr or "").strip()
        if result.returncode != 0:
            log.warning("[%s] exit %d: %s", script_name, result.returncode, stderr[:800])
        elif stderr:
            log.info("[%s] stderr:\n%s", script_name, stderr[:2000])
        stdout = (result.stdout or "").strip()
        if stdout:
            first = stdout.find("{")
            last = stdout.rfind("}")
            if first != -1 and last > first:
                try:
                    return json.loads(stdout[first: last + 1])
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


# ═══════════════════════════════════════════════════════════════════════════════
# Market data steps (mirrors nightly_etl.py, called after trade-detail ETL)
# ═══════════════════════════════════════════════════════════════════════════════

_MARKET_BACKFILL_START = date(2025, 1, 1)


def _step_nanhua_indices(conn) -> int:
    """Incremental fetch of 17 南华综合指数 OHLCV → raw_nanhua_indices_daily."""
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
        cur.execute("ALTER TABLE raw_nanhua_indices_daily ADD COLUMN IF NOT EXISTS name TEXT")
    conn.commit()

    today = date.today()
    # Check NHCI.NH specifically — other codes may have valid close>0 for today
    # while NHCI.NH still has close=0 (pre-close placeholder from nightly ETL)
    cur_max = _max_valid_date(conn, "raw_nanhua_indices_daily", code="NHCI.NH")
    if cur_max and cur_max >= today:
        log.info("NH indices up-to-date (NHCI.NH %s), skipping.", cur_max)
        return 0

    start = _MARKET_BACKFILL_START if cur_max is None else cur_max + timedelta(days=1)
    log.info("NH indices: fetching %s → %s …", start, today)
    out = _run_script("get_nanhua_indices_daily.py", extra_args=[_iso(start), _iso(today)], timeout=300)
    if not out or out.get("error"):
        log.warning("NH indices fetch failed: %s", out)
        return 0

    rows_raw = out.get("data") or []
    if not rows_raw:
        return 0

    try:
        from psycopg2.extras import execute_values  # type: ignore[import-untyped]
    except ImportError:
        log.warning("psycopg2 not available, skipping NH indices upsert")
        return 0

    records = []
    for r in rows_raw:
        d = _to_date(str(r.get("date", "")).replace("-", ""))
        code = r.get("code")
        if not d or not code:
            continue
        records.append((
            d, code, r.get("name") or "",
            _safe_float(r.get("open")), _safe_float(r.get("close")),
            _safe_float(r.get("high")), _safe_float(r.get("low")),
            _safe_float(r.get("preclose")), _safe_float(r.get("change")),
            _safe_float(r.get("pct_change")), _safe_float(r.get("volume")),
            _safe_float(r.get("amount")), _safe_float(r.get("turn")),
            _safe_float(r.get("amplitude")), "emquant",
        ))
    if not records:
        return 0

    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO raw_nanhua_indices_daily
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
        """, records)
    conn.commit()
    log.info("NH indices: upserted %d rows.", len(records))
    return len(records)


def _step_nanhua_commodity_indices(conn) -> int:
    """Incremental fetch of 80 南华单品种指数 OHLCV → raw_nanhua_commodity_indices_daily."""
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
        cur.execute("ALTER TABLE raw_nanhua_commodity_indices_daily ADD COLUMN IF NOT EXISTS name TEXT")
    conn.commit()

    today = date.today()
    # Check NHAU.NH (gold) as representative — all commodity indices are fetched
    # together, and if one has close=0 they all do
    cur_max = _max_valid_date(conn, "raw_nanhua_commodity_indices_daily", code="NHAU.NH")
    if cur_max is None:
        # NHAU.NH may not exist yet — fall back to table-wide check
        cur_max = _max_valid_date(conn, "raw_nanhua_commodity_indices_daily")
    if cur_max and cur_max >= today:
        log.info("NH commodity indices up-to-date (%s), skipping.", cur_max)
        return 0

    start = _MARKET_BACKFILL_START if cur_max is None else cur_max + timedelta(days=1)
    log.info("NH commodity indices: fetching %s → %s …", start, today)
    out = _run_script("get_nanhua_commodity_indices_daily.py", extra_args=[_iso(start), _iso(today)], timeout=600)
    if not out or out.get("error"):
        log.warning("NH commodity indices fetch failed: %s", out)
        return 0

    rows_raw = out.get("data") or []
    if not rows_raw:
        return 0

    try:
        from psycopg2.extras import execute_values  # type: ignore[import-untyped]
    except ImportError:
        log.warning("psycopg2 not available, skipping NH commodity indices upsert")
        return 0

    records = []
    for r in rows_raw:
        d = _to_date(str(r.get("date", "")).replace("-", ""))
        code = r.get("code")
        if not d or not code:
            continue
        records.append((
            d, code, r.get("name") or "",
            _safe_float(r.get("open")), _safe_float(r.get("close")),
            _safe_float(r.get("high")), _safe_float(r.get("low")),
            _safe_float(r.get("preclose")), _safe_float(r.get("change")),
            _safe_float(r.get("pct_change")), _safe_float(r.get("volume")),
            _safe_float(r.get("amount")), _safe_float(r.get("turn")),
            _safe_float(r.get("amplitude")), "emquant",
        ))
    if not records:
        return 0

    with conn.cursor() as cur:
        execute_values(cur, """
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
        """, records)
    conn.commit()
    log.info("NH commodity indices: upserted %d rows.", len(records))
    return len(records)


_FC_FIELDS = (
    "open", "close", "high", "low", "preclose", "average",
    "change", "pct_change", "volume", "amount", "spread",
    "clear", "preclear", "pct_change_clear", "change_clear",
    "hqoi", "change_oi", "amplitude", "mainforce",
    "uni_volume", "uni_amount", "uni_hqoi", "uni_change_oi",
    "change_close", "pct_change_close",
)


def _step_futures_contracts_ohlcv(conn) -> int:
    """Incremental fetch of per-contract daily OHLCV → raw_futures_contracts_daily.

    Source of contract list: mom_futures_trade_details."合约"
    """
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

    today = date.today()
    cur_max = _max_valid_date(conn, "raw_futures_contracts_daily")
    if cur_max and cur_max >= today:
        log.info("Futures contracts OHLCV up-to-date (%s), skipping.", cur_max)
        return 0

    # Verify source table exists
    with conn.cursor() as cur:
        cur.execute("""
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_name = 'mom_futures_trade_details'
            )
        """)
        if not cur.fetchone()[0]:
            log.warning("mom_futures_trade_details not found — skipping futures OHLCV.")
            return 0

    start = _MARKET_BACKFILL_START if cur_max is None else cur_max + timedelta(days=1)
    log.info("Futures contracts OHLCV: fetching %s → %s …", start, today)
    out = _run_script("fetch_futures_contracts_daily.py", extra_args=[_iso(start), _iso(today)], timeout=900)
    if not out or out.get("error"):
        log.warning("Futures contracts OHLCV fetch failed: %s", out)
        return 0

    rows_raw = out.get("data") or []
    if not rows_raw:
        return 0

    try:
        from psycopg2.extras import execute_values  # type: ignore[import-untyped]
    except ImportError:
        log.warning("psycopg2 not available, skipping futures OHLCV upsert")
        return 0

    col_placeholders = ", ".join(["%s"] * (2 + len(_FC_FIELDS) + 1))
    records = []
    for r in rows_raw:
        d = _to_date(str(r.get("date", "")).replace("-", ""))
        contract = (r.get("contract") or "").strip()
        if not d or not contract:
            continue
        row = [d, contract] + [_safe_float(r.get(f)) if f != "mainforce" else r.get(f) for f in _FC_FIELDS] + ["emquant"]
        records.append(tuple(row))
    if not records:
        return 0

    update_cols = [f for f in _FC_FIELDS]
    update_set = ", ".join(f"{c}=EXCLUDED.{c}" for c in update_cols)
    insert_cols = "trade_date, contract, " + ", ".join(_FC_FIELDS) + ", source"
    with conn.cursor() as cur:
        execute_values(cur, f"""
            INSERT INTO raw_futures_contracts_daily ({insert_cols})
            VALUES %s
            ON CONFLICT (trade_date, contract) DO UPDATE
                SET {update_set}, fetched_at=NOW()
        """, records)
    conn.commit()
    log.info("Futures contracts OHLCV: upserted %d rows.", len(records))
    return len(records)


def _step_akshare_futures_daily(conn) -> int:
    """Incremental fetch of 87 continuous futures contracts via AkShare → raw_akshare_futures_daily."""
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

    today = date.today()
    cur_max = _max_valid_date(conn, "raw_akshare_futures_daily")
    if cur_max and cur_max >= today:
        log.info("AkShare futures daily up-to-date (%s), skipping.", cur_max)
        return 0

    start = _MARKET_BACKFILL_START if cur_max is None else cur_max + timedelta(days=1)
    log.info("AkShare futures daily: fetching %s → %s …", start, today)
    out = _run_script("fetch_akshare_futures_daily.py", extra_args=[_iso(start), _iso(today)], timeout=900)
    if not out or out.get("error"):
        log.warning("AkShare futures daily fetch failed: %s", out)
        return 0

    rows_raw = out.get("data") or []
    if not rows_raw:
        return 0

    try:
        from psycopg2.extras import execute_values  # type: ignore[import-untyped]
    except ImportError:
        log.warning("psycopg2 not available, skipping AkShare futures upsert")
        return 0

    records = []
    for r in rows_raw:
        d = _to_date(str(r.get("date", "")).replace("-", ""))
        code = (r.get("code") or "").strip()
        if not d or not code:
            continue
        records.append((
            d, code,
            _safe_float(r.get("open")), _safe_float(r.get("close")),
            _safe_float(r.get("high")), _safe_float(r.get("low")),
            _safe_float(r.get("pct_change")), _safe_float(r.get("volume")),
            _safe_float(r.get("clear")), "akshare",
        ))
    if not records:
        return 0

    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO raw_akshare_futures_daily
                (trade_date, code, open, close, high, low, pct_change, volume, clear, source)
            VALUES %s
            ON CONFLICT (trade_date, code) DO UPDATE
                SET open=EXCLUDED.open, close=EXCLUDED.close,
                    high=EXCLUDED.high, low=EXCLUDED.low,
                    pct_change=EXCLUDED.pct_change, volume=EXCLUDED.volume,
                    clear=EXCLUDED.clear, fetched_at=NOW()
        """, records)
    conn.commit()
    log.info("AkShare futures daily: upserted %d rows.", len(records))
    return len(records)


def run_market_data_steps(conn) -> None:
    """Run all 4 market data steps needed by 品种交易回顾 charts."""
    market_steps = [
        ("nanhua_indices",           _step_nanhua_indices),
        ("nanhua_commodity_indices", _step_nanhua_commodity_indices),
        ("futures_contracts_ohlcv",  _step_futures_contracts_ohlcv),
        ("akshare_futures_daily",    _step_akshare_futures_daily),
    ]
    for name, fn in market_steps:
        try:
            n = fn(conn)
            log.info("Market step %s: %d rows upserted.", name, n)
        except Exception as exc:
            log.error("Market step %s failed: %s", name, exc)


def clean_cell(value):
    return "" if value is None else value


def collect_xlsx_files(base_dir: Path) -> List[Path]:
    files: List[Path] = []
    if not base_dir.exists():
        return files

    for folder in sorted(base_dir.iterdir()):
        if not folder.is_dir():
            continue
        for file_path in sorted(folder.iterdir()):
            if file_path.is_file() and file_path.suffix.lower() == ".xlsx" and not file_path.name.startswith("~$"):
                files.append(file_path)
    return files


def column_letter_to_index(column_letters: str) -> int:
    value = 0
    for char in column_letters:
        value = value * 26 + (ord(char.upper()) - ord("A") + 1)
    return value


def split_cell_reference(reference: str) -> Tuple[int | None, int | None]:
    match = re.match(r"([A-Z]+)(\d+)", reference)
    if not match:
        return None, None
    column_letters, row_number = match.groups()
    return column_letter_to_index(column_letters), int(row_number)


def normalize_sheet_target(target: str) -> str:
    normalized = target.replace("\\", "/")
    if normalized.startswith("/"):
        return normalized.lstrip("/")
    return posixpath.normpath(posixpath.join("xl", normalized))


def load_shared_strings(workbook_zip: zipfile.ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in workbook_zip.namelist():
        return []

    root = ET.fromstring(workbook_zip.read("xl/sharedStrings.xml"))
    shared_strings: List[str] = []
    for string_item in root.findall("main:si", NS):
        text_parts: List[str] = []
        for text_node in string_item.iterfind(".//main:t", NS):
            text_parts.append(text_node.text or "")
        shared_strings.append("".join(text_parts))
    return shared_strings


def get_sheet_paths(workbook_zip: zipfile.ZipFile) -> Dict[str, str]:
    workbook_root = ET.fromstring(workbook_zip.read("xl/workbook.xml"))
    rel_root = ET.fromstring(workbook_zip.read("xl/_rels/workbook.xml.rels"))

    rel_map: Dict[str, str] = {}
    for relationship in rel_root.findall("pkg:Relationship", NS):
        rel_map[relationship.attrib["Id"]] = normalize_sheet_target(relationship.attrib["Target"])

    sheet_paths: Dict[str, str] = {}
    for sheet in workbook_root.findall("main:sheets/main:sheet", NS):
        rel_id = sheet.attrib.get(f"{{{REL_NS}}}id")
        if rel_id in rel_map:
            sheet_paths[sheet.attrib["name"]] = rel_map[rel_id]
    return sheet_paths


def extract_cell_value(cell_element, shared_strings: List[str]) -> str:
    cell_type = cell_element.attrib.get("t")

    if cell_type == "inlineStr":
        text_parts: List[str] = []
        for text_node in cell_element.iterfind(".//main:t", NS):
            text_parts.append(text_node.text or "")
        return "".join(text_parts)

    value_element = cell_element.find("main:v", NS)
    if value_element is None:
        return ""

    raw_value = value_element.text or ""

    if cell_type == "s":
        index = int(raw_value)
        return shared_strings[index] if 0 <= index < len(shared_strings) else ""
    if cell_type == "b":
        return "TRUE" if raw_value == "1" else "FALSE"
    return raw_value


def parse_summary_sheet(workbook_zip: zipfile.ZipFile, sheet_path: str, shared_strings: List[str]) -> Tuple[str, str]:
    account = ""
    trade_date = ""

    with workbook_zip.open(sheet_path) as sheet_file:
        for _, element in ET.iterparse(sheet_file, events=("end",)):
            if element.tag != f"{{{MAIN_NS}}}row":
                continue

            row_number = int(element.attrib.get("r", "0"))
            if row_number == 6:
                for cell in element.findall(f"{{{MAIN_NS}}}c"):
                    reference = cell.attrib.get("r", "")
                    if reference == "D6":
                        account = str(clean_cell(extract_cell_value(cell, shared_strings))).strip()
                    elif reference == "I6":
                        trade_date = str(clean_cell(extract_cell_value(cell, shared_strings))).strip()
                element.clear()
                break
            element.clear()

    return account, trade_date


def parse_daily_report_sheet(workbook_zip: zipfile.ZipFile, sheet_path: str, shared_strings: List[str]) -> Dict[str, str]:
    """Read specific cells from 客户交易核算日报 and return {cell_ref: value}."""
    target_cells = {ref for ref, _ in DAILY_REPORT_COL_ORDER}
    values: Dict[str, str] = {ref: "" for ref, _ in DAILY_REPORT_COL_ORDER}
    with workbook_zip.open(sheet_path) as sheet_file:
        for _, element in ET.iterparse(sheet_file, events=("end",)):
            if element.tag != f"{{{MAIN_NS}}}row":
                continue
            row_number = int(element.attrib.get("r", "0"))
            if row_number > 23:
                element.clear()
                break
            for cell in element.findall(f"{{{MAIN_NS}}}c"):
                ref = cell.attrib.get("r", "")
                if ref in target_cells:
                    values[ref] = str(clean_cell(extract_cell_value(cell, shared_strings))).strip()
            element.clear()
    return values


def parse_daily_report_fund_flow_rows(workbook_zip: zipfile.ZipFile, sheet_path: str, shared_strings: List[str]) -> List[List[str]]:
    """Read the B26:F* 出入金子表 from 客户交易核算日报.

    The table starts with a title at B25, headers at B26:F26, data at row 27,
    and must stop at the first contiguous blank row or the first "合计" row so
    later sections in the same sheet are ignored.
    """
    rows: List[List[str]] = []
    saw_section_title = False
    headers_found = False
    width = DAILY_REPORT_FUND_FLOW_LAST_COLUMN - DAILY_REPORT_FUND_FLOW_FIRST_COLUMN + 1

    with workbook_zip.open(sheet_path) as sheet_file:
        for _, element in ET.iterparse(sheet_file, events=("end",)):
            if element.tag != f"{{{MAIN_NS}}}row":
                continue

            row_number = int(element.attrib.get("r", "0"))
            if row_number < DAILY_REPORT_FUND_FLOW_TITLE_ROW:
                element.clear()
                continue

            row_values = [""] * width
            for cell in element.findall(f"{{{MAIN_NS}}}c"):
                ref = cell.attrib.get("r", "")
                col_idx, _ = split_cell_reference(ref)
                if col_idx is None or col_idx < DAILY_REPORT_FUND_FLOW_FIRST_COLUMN or col_idx > DAILY_REPORT_FUND_FLOW_LAST_COLUMN:
                    continue
                row_values[col_idx - DAILY_REPORT_FUND_FLOW_FIRST_COLUMN] = str(clean_cell(extract_cell_value(cell, shared_strings))).strip()

            if row_number == DAILY_REPORT_FUND_FLOW_TITLE_ROW:
                saw_section_title = DAILY_REPORT_FUND_FLOW_SECTION_TITLE in (row_values[0] or "")
                element.clear()
                continue

            if row_number == DAILY_REPORT_FUND_FLOW_HEADER_ROW:
                headers_found = any(row_values)
                if not headers_found and not saw_section_title:
                    element.clear()
                    break
                element.clear()
                continue

            if row_number < DAILY_REPORT_FUND_FLOW_DATA_START_ROW:
                element.clear()
                continue

            if not headers_found:
                element.clear()
                break

            if not any(v != "" for v in row_values):
                element.clear()
                break

            if str(row_values[0]).strip() == "合计":
                element.clear()
                break

            rows.append(row_values)
            element.clear()

    return rows


def parse_detail_sheet(workbook_zip: zipfile.ZipFile, sheet_path: str, shared_strings: List[str], last_col: int | None = None) -> Tuple[List[str], List[List[str]]]:
    headers: List[str] = []
    rows: List[List[str]] = []
    lc = last_col if last_col is not None else LAST_COLUMN

    with workbook_zip.open(sheet_path) as sheet_file:
        for _, element in ET.iterparse(sheet_file, events=("end",)):
            if element.tag != f"{{{MAIN_NS}}}row":
                continue

            row_number = int(element.attrib.get("r", "0"))
            if row_number < HEADER_ROW:
                element.clear()
                continue

            row_values = [""] * (lc - FIRST_COLUMN + 1)
            for cell in element.findall(f"{{{MAIN_NS}}}c"):
                ref = cell.attrib.get("r", "")
                col_idx, _ = split_cell_reference(ref)
                if col_idx is None or col_idx < FIRST_COLUMN or col_idx > lc:
                    continue
                row_values[col_idx - FIRST_COLUMN] = str(clean_cell(extract_cell_value(cell, shared_strings)))

            if row_number == HEADER_ROW:
                headers = row_values
                element.clear()
                continue

            if row_number < DATA_START_ROW:
                element.clear()
                continue

            if not any(v != "" for v in row_values):
                element.clear()
                continue

            if str(row_values[0]).strip() == "合计":
                element.clear()
                break

            rows.append(row_values)
            element.clear()

    return headers, rows


def normalize_trade_date(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    s2 = s.replace("-", "").replace("/", "")
    if re.fullmatch(r"\d{8}", s2):
        return s2
    return s


def row_hash(file_rel: str, account: str, trade_date: str, values: Iterable[str], row_index: int = -1) -> str:
    payload = "|".join([file_rel, account, trade_date, str(row_index), *[str(v) for v in values]])
    return hashlib.sha1(payload.encode("utf-8", errors="ignore")).hexdigest()


def _old_schema_detected(conn) -> bool:
    """Return True if mom_trade_details still has the old JSONB 'detail_payload' column."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name   = 'mom_trade_details'
              AND column_name  = 'detail_payload'
            """
        )
        return cur.fetchone() is not None


def drop_tables(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS mom_trade_details CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_futures_trade_details CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_options_trade_details CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_close_details CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_position_details CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_options_position_details CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_futures_position_details CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_order_details CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_summary_details CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_daily_reports CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_daily_report_fund_flows CASCADE")
        cur.execute("DROP TABLE IF EXISTS mom_trade_detail_file_state CASCADE")
    conn.commit()


def ensure_tables(conn) -> None:
    detail_col_defs = "\n".join(f'  "{sql}" TEXT,' for _, sql in DETAIL_COLUMNS)
    sub_col_defs = "\n".join(f'  "{sql}" TEXT,' for _, sql in DETAIL_COLUMNS)
    close_col_defs = "\n".join(f'  "{sql}" TEXT,' for _, sql in CLOSE_COLUMNS)
    position_col_defs = "\n".join(f'  "{sql}" TEXT,' for _, sql in POSITION_COLUMNS)
    order_col_defs = "\n".join(f'  "{sql}" TEXT,' for _, sql in ORDER_COLUMNS)
    summary_detail_col_defs = "\n".join(f'  "{sql}" TEXT,' for _, sql in SUMMARY_DETAIL_COLUMNS)
    daily_report_non_key_cols = "\n".join(
        f'  "{col}" TEXT,' for _, col in DAILY_REPORT_COL_ORDER if col not in ("账户", "交易日期")
    )
    daily_report_fund_flow_col_defs = "\n".join(f'  "{sql}" TEXT,' for _, sql in DAILY_REPORT_FUND_FLOW_COLUMNS)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_trade_details (
              id              BIGSERIAL PRIMARY KEY,
              account         TEXT NOT NULL,
              trade_date      DATE,
{detail_col_defs}
              source_file_rel TEXT NOT NULL,
              row_hash        TEXT NOT NULL,
              UNIQUE (row_hash)
            )
            """
        )
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_futures_trade_details (
              id              BIGSERIAL PRIMARY KEY,
              "账户"          TEXT NOT NULL,
              "交易日期"      DATE,
{sub_col_defs}
              source_file_rel TEXT NOT NULL,
              row_hash        TEXT NOT NULL,
              UNIQUE (row_hash)
            )
            """
        )
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_options_trade_details (
              id              BIGSERIAL PRIMARY KEY,
              "账户"          TEXT NOT NULL,
              "交易日期"      DATE,
{sub_col_defs}
              source_file_rel TEXT NOT NULL,
              row_hash        TEXT NOT NULL,
              UNIQUE (row_hash)
            )
            """
        )
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_close_details (
              id              BIGSERIAL PRIMARY KEY,
              "账户"          TEXT NOT NULL,
              "交易日期"      DATE,
{close_col_defs}
              source_file_rel TEXT NOT NULL,
              row_hash        TEXT NOT NULL,
              UNIQUE (row_hash)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS mom_trade_detail_file_state (
              source_file_rel    TEXT PRIMARY KEY,
              source_mtime       TIMESTAMPTZ NOT NULL,
              source_size        BIGINT NOT NULL,
              account            TEXT,
              trade_date         TEXT,
              row_count          INTEGER NOT NULL DEFAULT 0,
              futures_row_count  INTEGER NOT NULL DEFAULT 0,
              options_row_count  INTEGER NOT NULL DEFAULT 0,
              status             TEXT NOT NULL DEFAULT 'ok',
              error_message      TEXT,
              processed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        for col in ("futures_row_count", "options_row_count", "close_row_count", "position_row_count", "options_position_row_count", "futures_position_row_count", "order_row_count", "summary_row_count", "daily_report_count", "daily_report_fund_flow_row_count"):
            cur.execute(
                f"""
                ALTER TABLE mom_trade_detail_file_state
                  ADD COLUMN IF NOT EXISTS {col} INTEGER NOT NULL DEFAULT 0
                """
            )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_trade_details_account_date
              ON mom_trade_details (account, trade_date)
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_futures_trade_details_account_date
              ON mom_futures_trade_details ("账户", "交易日期")
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_options_trade_details_account_date
              ON mom_options_trade_details ("账户", "交易日期")
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_close_details_account_date
              ON mom_close_details ("账户", "交易日期")
            """
        )
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_position_details (
              id              BIGSERIAL PRIMARY KEY,
              "账户"          TEXT NOT NULL,
              "交易日期"      DATE,
{position_col_defs}
              source_file_rel TEXT NOT NULL,
              row_hash        TEXT NOT NULL,
              UNIQUE (row_hash)
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_position_details_account_date
              ON mom_position_details ("账户", "交易日期")
            """
        )
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_options_position_details (
              id              BIGSERIAL PRIMARY KEY,
              "账户"          TEXT NOT NULL,
              "交易日期"      DATE,
{position_col_defs}
              source_file_rel TEXT NOT NULL,
              row_hash        TEXT NOT NULL,
              UNIQUE (row_hash)
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_options_position_details_account_date
              ON mom_options_position_details ("账户", "交易日期")
            """
        )
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_futures_position_details (
              id              BIGSERIAL PRIMARY KEY,
              "账户"          TEXT NOT NULL,
              "交易日期"      DATE,
{position_col_defs}
              source_file_rel TEXT NOT NULL,
              row_hash        TEXT NOT NULL,
              UNIQUE (row_hash)
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_futures_position_details_account_date
              ON mom_futures_position_details ("账户", "交易日期")
            """
        )
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_order_details (
              id              BIGSERIAL PRIMARY KEY,
              "账户"          TEXT NOT NULL,
              "交易日期"      DATE,
{order_col_defs}
              source_file_rel TEXT NOT NULL,
              row_hash        TEXT NOT NULL,
              UNIQUE (row_hash)
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_order_details_account_date
              ON mom_order_details ("账户", "交易日期")
            """
        )
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_summary_details (
              id              BIGSERIAL PRIMARY KEY,
              "账户"          TEXT NOT NULL,
              "交易日期"      DATE,
{summary_detail_col_defs}
              source_file_rel TEXT NOT NULL,
              row_hash        TEXT NOT NULL,
              UNIQUE (row_hash)
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_summary_details_account_date
              ON mom_summary_details ("账户", "交易日期")
            """
        )
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_daily_reports (
              id              BIGSERIAL PRIMARY KEY,
              "账户"          TEXT NOT NULL,
              "交易日期"      DATE,
{daily_report_non_key_cols}
              source_file_rel TEXT NOT NULL,
              UNIQUE (source_file_rel)
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_daily_reports_account_date
              ON mom_daily_reports ("账户", "交易日期")
            """
        )
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS mom_daily_report_fund_flows (
              id              BIGSERIAL PRIMARY KEY,
              "账户"          TEXT NOT NULL,
              "交易日期"      DATE,
{daily_report_fund_flow_col_defs}
              source_file_rel TEXT NOT NULL,
              row_hash        TEXT NOT NULL,
              UNIQUE (row_hash)
            )
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_mom_daily_report_fund_flows_account_date
              ON mom_daily_report_fund_flows ("账户", "交易日期")
            """
        )
    conn.commit()


def load_file_state(conn, files: List[Path], base_dir: Path) -> Dict[str, Tuple[datetime, int, str]]:
    rels = [str(p.relative_to(base_dir)).replace("\\", "/") for p in files]
    if not rels:
        return {}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT source_file_rel, source_mtime, source_size, status
            FROM mom_trade_detail_file_state
            WHERE source_file_rel = ANY(%s)
            """,
            (rels,),
        )
        rows = cur.fetchall()

    state: Dict[str, Tuple[datetime, int, str]] = {}
    for file_rel, mtime, size, status in rows:
        state[file_rel] = (mtime, int(size), str(status or ""))
    return state


def upsert_file_state(conn, file_rel: str, mtime_dt: datetime, size: int, account: str, trade_date: str, row_count: int, futures_row_count: int, options_row_count: int, close_row_count: int, position_row_count: int, options_position_row_count: int, futures_position_row_count: int, order_row_count: int, summary_row_count: int, daily_report_count: int, daily_report_fund_flow_row_count: int, status: str, error_message: str | None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO mom_trade_detail_file_state
                            (source_file_rel, source_mtime, source_size, account, trade_date, row_count, futures_row_count, options_row_count, close_row_count, position_row_count, options_position_row_count, futures_position_row_count, order_row_count, summary_row_count, daily_report_count, daily_report_fund_flow_row_count, status, error_message, processed_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (source_file_rel) DO UPDATE SET
              source_mtime                = EXCLUDED.source_mtime,
              source_size                 = EXCLUDED.source_size,
              account                     = EXCLUDED.account,
              trade_date                  = EXCLUDED.trade_date,
              row_count                   = EXCLUDED.row_count,
              futures_row_count           = EXCLUDED.futures_row_count,
              options_row_count           = EXCLUDED.options_row_count,
              close_row_count             = EXCLUDED.close_row_count,
              position_row_count          = EXCLUDED.position_row_count,
              options_position_row_count  = EXCLUDED.options_position_row_count,
              futures_position_row_count  = EXCLUDED.futures_position_row_count,
              order_row_count             = EXCLUDED.order_row_count,
              summary_row_count           = EXCLUDED.summary_row_count,
              daily_report_count          = EXCLUDED.daily_report_count,
                            daily_report_fund_flow_row_count = EXCLUDED.daily_report_fund_flow_row_count,
              status                      = EXCLUDED.status,
              error_message               = EXCLUDED.error_message,
              processed_at                = NOW()
            """,
                        (file_rel, mtime_dt, size, account, trade_date, row_count, futures_row_count, options_row_count, close_row_count, position_row_count, options_position_row_count, futures_position_row_count, order_row_count, summary_row_count, daily_report_count, daily_report_fund_flow_row_count, status, error_message),
        )


def process_file(conn, base_dir: Path, file_path: Path) -> Tuple[bool, str]:
    from psycopg2.extras import execute_values  # type: ignore[import-untyped]

    rel = str(file_path.relative_to(base_dir)).replace("\\", "/")
    try:
        stat = file_path.stat()
    except FileNotFoundError:
        # File may be moved/deleted after changed-file list is built.
        return False, f"missing file (skipped): {rel}"
    mtime_dt = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
    size = int(stat.st_size)

    try:
        with zipfile.ZipFile(file_path) as workbook_zip:
            sheet_paths = get_sheet_paths(workbook_zip)
            if SUMMARY_SHEET_NAME not in sheet_paths or DETAIL_SHEET_NAME not in sheet_paths:
                upsert_file_state(conn, rel, mtime_dt, size, "", "", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "error", "Missing required sheet")
                conn.commit()
                return False, f"missing sheet: {rel}"

            shared_strings = load_shared_strings(workbook_zip)
            account, trade_date_raw = parse_summary_sheet(workbook_zip, sheet_paths[SUMMARY_SHEET_NAME], shared_strings)
            headers, rows = parse_detail_sheet(workbook_zip, sheet_paths[DETAIL_SHEET_NAME], shared_strings)

            # 期货成交明细 sheet — same B-Q structure; D6/I6 carry account/date too.
            futures_rows: list = []
            futures_account = ""
            futures_date_raw = ""
            if FUTURES_DETAIL_SHEET_NAME in sheet_paths:
                futures_account, futures_date_raw = parse_summary_sheet(
                    workbook_zip, sheet_paths[FUTURES_DETAIL_SHEET_NAME], shared_strings
                )
                _, futures_rows = parse_detail_sheet(
                    workbook_zip, sheet_paths[FUTURES_DETAIL_SHEET_NAME], shared_strings
                )

            # 期权成交明细 sheet — same B-Q structure; D6/I6 carry account/date too.
            options_rows: list = []
            options_account = ""
            options_date_raw = ""
            if OPTIONS_DETAIL_SHEET_NAME in sheet_paths:
                options_account, options_date_raw = parse_summary_sheet(
                    workbook_zip, sheet_paths[OPTIONS_DETAIL_SHEET_NAME], shared_strings
                )
                _, options_rows = parse_detail_sheet(
                    workbook_zip, sheet_paths[OPTIONS_DETAIL_SHEET_NAME], shared_strings
                )

            # 平仓明细 sheet — B-N columns (13); D6/I6 carry account/date too.
            close_rows: list = []
            close_account = ""
            close_date_raw = ""
            if CLOSE_DETAIL_SHEET_NAME in sheet_paths:
                close_account, close_date_raw = parse_summary_sheet(
                    workbook_zip, sheet_paths[CLOSE_DETAIL_SHEET_NAME], shared_strings
                )
                _, close_rows = parse_detail_sheet(
                    workbook_zip, sheet_paths[CLOSE_DETAIL_SHEET_NAME], shared_strings,
                    last_col=CLOSE_LAST_COLUMN,
                )

            # 持仓明细 sheet — B-S columns (18); D6/I6 carry account/date too.
            position_rows: list = []
            position_account = ""
            position_date_raw = ""
            if POSITION_DETAIL_SHEET_NAME in sheet_paths:
                position_account, position_date_raw = parse_summary_sheet(
                    workbook_zip, sheet_paths[POSITION_DETAIL_SHEET_NAME], shared_strings
                )
                _, position_rows = parse_detail_sheet(
                    workbook_zip, sheet_paths[POSITION_DETAIL_SHEET_NAME], shared_strings,
                    last_col=POSITION_LAST_COLUMN,
                )

            # 期权持仓明细 sheet — identical B-S columns to 持仓明细; D6/I6 carry account/date.
            options_position_rows: list = []
            options_position_account = ""
            options_position_date_raw = ""
            if OPTIONS_POSITION_DETAIL_SHEET_NAME in sheet_paths:
                options_position_account, options_position_date_raw = parse_summary_sheet(
                    workbook_zip, sheet_paths[OPTIONS_POSITION_DETAIL_SHEET_NAME], shared_strings
                )
                _, options_position_rows = parse_detail_sheet(
                    workbook_zip, sheet_paths[OPTIONS_POSITION_DETAIL_SHEET_NAME], shared_strings,
                    last_col=POSITION_LAST_COLUMN,
                )

            # 期货持仓明细 sheet — identical B-S columns to 持仓明细; D6/I6 carry account/date.
            futures_position_rows: list = []
            futures_position_account = ""
            futures_position_date_raw = ""
            if FUTURES_POSITION_DETAIL_SHEET_NAME in sheet_paths:
                futures_position_account, futures_position_date_raw = parse_summary_sheet(
                    workbook_zip, sheet_paths[FUTURES_POSITION_DETAIL_SHEET_NAME], shared_strings
                )
                _, futures_position_rows = parse_detail_sheet(
                    workbook_zip, sheet_paths[FUTURES_POSITION_DETAIL_SHEET_NAME], shared_strings,
                    last_col=POSITION_LAST_COLUMN,
                )

            # 委托明细 sheet — B-M columns (12); D6/I6 carry account/date too.
            order_rows: list = []
            order_account = ""
            order_date_raw = ""
            if ORDER_DETAIL_SHEET_NAME in sheet_paths:
                order_account, order_date_raw = parse_summary_sheet(
                    workbook_zip, sheet_paths[ORDER_DETAIL_SHEET_NAME], shared_strings
                )
                _, order_rows = parse_detail_sheet(
                    workbook_zip, sheet_paths[ORDER_DETAIL_SHEET_NAME], shared_strings,
                    last_col=ORDER_LAST_COLUMN,
                )

            # 品种汇总 sheet — B-G columns (6); D6/I6 carry account/date too.
            summary_detail_rows: list = []
            summary_detail_account = ""
            summary_detail_date_raw = ""
            if SUMMARY_DETAIL_SHEET_NAME in sheet_paths:
                summary_detail_account, summary_detail_date_raw = parse_summary_sheet(
                    workbook_zip, sheet_paths[SUMMARY_DETAIL_SHEET_NAME], shared_strings
                )
                _, summary_detail_rows = parse_detail_sheet(
                    workbook_zip, sheet_paths[SUMMARY_DETAIL_SHEET_NAME], shared_strings,
                    last_col=SUMMARY_DETAIL_LAST_COLUMN,
                )

            # 客户交易核算日报 sheet — reads specific cells from rows 6 and 11-23.
            daily_report_row: dict | None = None
            daily_report_fund_flow_rows: list = []
            dr_account = ""
            dr_date_raw = ""
            if DAILY_REPORT_SHEET_NAME in sheet_paths:
                daily_cells = parse_daily_report_sheet(
                    workbook_zip, sheet_paths[DAILY_REPORT_SHEET_NAME], shared_strings
                )
                dr_account = daily_cells.get("D6", "")
                dr_date_raw = daily_cells.get("I6", "")
                daily_report_row = daily_cells
                daily_report_fund_flow_rows = parse_daily_report_fund_flow_rows(
                    workbook_zip, sheet_paths[DAILY_REPORT_SHEET_NAME], shared_strings
                )

        trade_date = normalize_trade_date(trade_date_raw)
        if not account or not trade_date:
            upsert_file_state(conn, rel, mtime_dt, size, account, trade_date, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "error", "Missing account/date in summary")
            conn.commit()
            return False, f"missing account/date: {rel}"

        futures_date = normalize_trade_date(futures_date_raw)
        futures_account = futures_account or account
        futures_date = futures_date or trade_date

        options_date = normalize_trade_date(options_date_raw)
        options_account = options_account or account
        options_date = options_date or trade_date

        close_date = normalize_trade_date(close_date_raw)
        close_account = close_account or account
        close_date = close_date or trade_date

        position_date = normalize_trade_date(position_date_raw)
        position_account = position_account or account
        position_date = position_date or trade_date

        options_position_date = normalize_trade_date(options_position_date_raw)
        options_position_account = options_position_account or account
        options_position_date = options_position_date or trade_date

        futures_position_date = normalize_trade_date(futures_position_date_raw)
        futures_position_account = futures_position_account or account
        futures_position_date = futures_position_date or trade_date

        order_date = normalize_trade_date(order_date_raw)
        order_account = order_account or account
        order_date = order_date or trade_date

        summary_detail_date = normalize_trade_date(summary_detail_date_raw)
        summary_detail_account = summary_detail_account or account
        summary_detail_date = summary_detail_date or trade_date

        dr_date = normalize_trade_date(dr_date_raw)
        dr_account = dr_account or account
        dr_date = dr_date or trade_date

        # Build column-position map (tolerates minor header variations).
        header_index_map: Dict[str, int] = {h.strip(): i for i, h in enumerate(headers)}
        col_positions: List[int | None] = [
            header_index_map.get(xlsx_hdr.strip())
            for xlsx_hdr in DETAIL_XLSX_HEADERS
        ]

        trade_date_iso = f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:8]}" if re.fullmatch(r"\d{8}", trade_date) else None
        futures_date_iso = f"{futures_date[:4]}-{futures_date[4:6]}-{futures_date[6:8]}" if re.fullmatch(r"\d{8}", futures_date) else None
        options_date_iso = f"{options_date[:4]}-{options_date[4:6]}-{options_date[6:8]}" if re.fullmatch(r"\d{8}", options_date) else None
        close_date_iso = f"{close_date[:4]}-{close_date[4:6]}-{close_date[6:8]}" if re.fullmatch(r"\d{8}", close_date) else None
        position_date_iso = f"{position_date[:4]}-{position_date[4:6]}-{position_date[6:8]}" if re.fullmatch(r"\d{8}", position_date) else None
        options_position_date_iso = f"{options_position_date[:4]}-{options_position_date[4:6]}-{options_position_date[6:8]}" if re.fullmatch(r"\d{8}", options_position_date) else None
        futures_position_date_iso = f"{futures_position_date[:4]}-{futures_position_date[4:6]}-{futures_position_date[6:8]}" if re.fullmatch(r"\d{8}", futures_position_date) else None
        order_date_iso = f"{order_date[:4]}-{order_date[4:6]}-{order_date[6:8]}" if re.fullmatch(r"\d{8}", order_date) else None
        summary_detail_date_iso = f"{summary_detail_date[:4]}-{summary_detail_date[4:6]}-{summary_detail_date[6:8]}" if re.fullmatch(r"\d{8}", summary_detail_date) else None
        dr_date_iso = f"{dr_date[:4]}-{dr_date[4:6]}-{dr_date[6:8]}" if re.fullmatch(r"\d{8}", dr_date) else None

        with conn.cursor() as cur:
            # ── 成交明细 ──────────────────────────────────────────────────────
            # Delete by business key so renamed files don't leave orphan rows
            cur.execute("DELETE FROM mom_trade_details WHERE account = %s AND trade_date = %s", (account, trade_date_iso))
            insert_cols = "account, trade_date, " + ", ".join(DETAIL_SQL_COLS) + ", source_file_rel, row_hash"
            values = []
            for ri, rv in enumerate(rows):
                detail_vals = [rv[pos] if pos is not None and pos < len(rv) else "" for pos in col_positions]
                rh = row_hash(rel, account, trade_date, rv, ri)
                values.append(tuple([account, trade_date_iso] + detail_vals + [rel, rh]))
            if values:
                execute_values(
                    cur,
                    f"INSERT INTO mom_trade_details ({insert_cols}) VALUES %s ON CONFLICT (row_hash) DO NOTHING",
                    values, page_size=1000,
                )

            # ── 期货成交明细 ──────────────────────────────────────────────────
            cur.execute('DELETE FROM mom_futures_trade_details WHERE "账户" = %s AND "交易日期" = %s', (futures_account, futures_date_iso))
            futures_insert_cols = ", ".join(FUTURES_SQL_COLS) + ", source_file_rel, row_hash"
            fvalues = []
            for ri, rv in enumerate(futures_rows):
                detail_vals = [rv[pos] if pos is not None and pos < len(rv) else "" for pos in col_positions]
                rh = row_hash(rel + "#futures", futures_account, futures_date, rv, ri)
                fvalues.append(tuple([futures_account, futures_date_iso] + detail_vals + [rel, rh]))
            if fvalues:
                execute_values(
                    cur,
                    f"INSERT INTO mom_futures_trade_details ({futures_insert_cols}) VALUES %s ON CONFLICT (row_hash) DO NOTHING",
                    fvalues, page_size=1000,
                )

            # ── 期权成交明细 ──────────────────────────────────────────────────
            cur.execute('DELETE FROM mom_options_trade_details WHERE "账户" = %s AND "交易日期" = %s', (options_account, options_date_iso))
            options_insert_cols = ", ".join(OPTIONS_SQL_COLS) + ", source_file_rel, row_hash"
            ovalues = []
            for ri, rv in enumerate(options_rows):
                detail_vals = [rv[pos] if pos is not None and pos < len(rv) else "" for pos in col_positions]
                rh = row_hash(rel + "#options", options_account, options_date, rv, ri)
                ovalues.append(tuple([options_account, options_date_iso] + detail_vals + [rel, rh]))
            if ovalues:
                execute_values(
                    cur,
                    f"INSERT INTO mom_options_trade_details ({options_insert_cols}) VALUES %s ON CONFLICT (row_hash) DO NOTHING",
                    ovalues, page_size=1000,
                )

            # ── 平仓明细 ──────────────────────────────────────────────────────
            cur.execute('DELETE FROM mom_close_details WHERE "账户" = %s AND "交易日期" = %s', (close_account, close_date_iso))
            close_insert_cols = ", ".join(CLOSE_SQL_COLS) + ", source_file_rel, row_hash"
            cvalues = []
            for ri, rv in enumerate(close_rows):
                # Positional extraction — avoids duplicate "开仓价" header at E11/L11.
                detail_vals = [rv[pos] if pos < len(rv) else "" for pos in range(len(CLOSE_COLUMNS))]
                rh = row_hash(rel + "#close", close_account, close_date, rv, ri)
                cvalues.append(tuple([close_account, close_date_iso] + detail_vals + [rel, rh]))
            if cvalues:
                execute_values(
                    cur,
                    f"INSERT INTO mom_close_details ({close_insert_cols}) VALUES %s ON CONFLICT (row_hash) DO NOTHING",
                    cvalues, page_size=1000,
                )

            # ── 持仓明细 ──────────────────────────────────────────────────────
            cur.execute('DELETE FROM mom_position_details WHERE "账户" = %s AND "交易日期" = %s', (position_account, position_date_iso))
            position_insert_cols = ", ".join(POSITION_SQL_COLS) + ", source_file_rel, row_hash"
            pvalues = []
            for ri, rv in enumerate(position_rows):
                detail_vals = [rv[pos] if pos < len(rv) else "" for pos in range(len(POSITION_COLUMNS))]
                rh = row_hash(rel + "#position", position_account, position_date, rv, ri)
                pvalues.append(tuple([position_account, position_date_iso] + detail_vals + [rel, rh]))
            if pvalues:
                execute_values(
                    cur,
                    f"INSERT INTO mom_position_details ({position_insert_cols}) VALUES %s ON CONFLICT (row_hash) DO NOTHING",
                    pvalues, page_size=1000,
                )

            # ── 期权持仓明细 ──────────────────────────────────────────────────
            cur.execute('DELETE FROM mom_options_position_details WHERE "账户" = %s AND "交易日期" = %s', (options_position_account, options_position_date_iso))
            options_position_insert_cols = ", ".join(POSITION_SQL_COLS) + ", source_file_rel, row_hash"
            opvalues = []
            for ri, rv in enumerate(options_position_rows):
                detail_vals = [rv[pos] if pos < len(rv) else "" for pos in range(len(POSITION_COLUMNS))]
                rh = row_hash(rel + "#optpos", options_position_account, options_position_date, rv, ri)
                opvalues.append(tuple([options_position_account, options_position_date_iso] + detail_vals + [rel, rh]))
            if opvalues:
                execute_values(
                    cur,
                    f"INSERT INTO mom_options_position_details ({options_position_insert_cols}) VALUES %s ON CONFLICT (row_hash) DO NOTHING",
                    opvalues, page_size=1000,
                )

            # ── 期货持仓明细 ──────────────────────────────────────────────────
            cur.execute('DELETE FROM mom_futures_position_details WHERE "账户" = %s AND "交易日期" = %s', (futures_position_account, futures_position_date_iso))
            futures_position_insert_cols = ", ".join(POSITION_SQL_COLS) + ", source_file_rel, row_hash"
            fpvalues = []
            for ri, rv in enumerate(futures_position_rows):
                detail_vals = [rv[pos] if pos < len(rv) else "" for pos in range(len(POSITION_COLUMNS))]
                rh = row_hash(rel + "#futpos", futures_position_account, futures_position_date, rv, ri)
                fpvalues.append(tuple([futures_position_account, futures_position_date_iso] + detail_vals + [rel, rh]))
            if fpvalues:
                execute_values(
                    cur,
                    f"INSERT INTO mom_futures_position_details ({futures_position_insert_cols}) VALUES %s ON CONFLICT (row_hash) DO NOTHING",
                    fpvalues, page_size=1000,
                )

            # ── 委托明细 ──────────────────────────────────────────────────────
            cur.execute('DELETE FROM mom_order_details WHERE "账户" = %s AND "交易日期" = %s', (order_account, order_date_iso))
            order_insert_cols = ", ".join(ORDER_SQL_COLS) + ", source_file_rel, row_hash"
            ordvalues = []
            for ri, rv in enumerate(order_rows):
                detail_vals = [rv[pos] if pos < len(rv) else "" for pos in range(len(ORDER_COLUMNS))]
                rh = row_hash(rel + "#order", order_account, order_date, rv, ri)
                ordvalues.append(tuple([order_account, order_date_iso] + detail_vals + [rel, rh]))
            if ordvalues:
                execute_values(
                    cur,
                    f"INSERT INTO mom_order_details ({order_insert_cols}) VALUES %s ON CONFLICT (row_hash) DO NOTHING",
                    ordvalues, page_size=1000,
                )

            # ── 品种汇总 ──────────────────────────────────────────────────────
            cur.execute('DELETE FROM mom_summary_details WHERE "账户" = %s AND "交易日期" = %s', (summary_detail_account, summary_detail_date_iso))
            summary_detail_insert_cols = ", ".join(SUMMARY_DETAIL_SQL_COLS) + ", source_file_rel, row_hash"
            sumvalues = []
            for ri, rv in enumerate(summary_detail_rows):
                detail_vals = [rv[pos] if pos < len(rv) else "" for pos in range(len(SUMMARY_DETAIL_COLUMNS))]
                rh = row_hash(rel + "#summary", summary_detail_account, summary_detail_date, rv, ri)
                sumvalues.append(tuple([summary_detail_account, summary_detail_date_iso] + detail_vals + [rel, rh]))
            if sumvalues:
                execute_values(
                    cur,
                    f"INSERT INTO mom_summary_details ({summary_detail_insert_cols}) VALUES %s ON CONFLICT (row_hash) DO NOTHING",
                    sumvalues, page_size=1000,
                )

            # ── 客户交易核算日报 ────────────────────────────────────────────────
            # Delete by business key; one daily report per account per date
            cur.execute('DELETE FROM mom_daily_reports WHERE "账户" = %s AND "交易日期" = %s', (dr_account, dr_date_iso))
            if daily_report_row is not None:
                dr_vals: list = []
                for ref, col in DAILY_REPORT_COL_ORDER:
                    if col == "账户":
                        dr_vals.append(dr_account)
                    elif col == "交易日期":
                        dr_vals.append(dr_date_iso)
                    else:
                        dr_vals.append(daily_report_row.get(ref, ""))
                dr_vals.append(rel)
                dr_insert_cols = ", ".join(DAILY_REPORT_SQL_COLS) + ", source_file_rel"
                placeholders = ", ".join(["%s"] * len(dr_vals))
                cur.execute(
                    f"INSERT INTO mom_daily_reports ({dr_insert_cols}) VALUES ({placeholders})",
                    dr_vals,
                )
            daily_report_count = 1 if daily_report_row is not None else 0

            # ── 客户交易核算日报 / 期货期权账户出入金明细 ───────────────────────
            cur.execute('DELETE FROM mom_daily_report_fund_flows WHERE "账户" = %s AND "交易日期" = %s', (dr_account, dr_date_iso))
            daily_report_fund_flow_insert_cols = ", ".join(DAILY_REPORT_FUND_FLOW_SQL_COLS) + ", source_file_rel, row_hash"
            dffvalues = []
            for ri, rv in enumerate(daily_report_fund_flow_rows):
                detail_vals = [rv[pos] if pos < len(rv) else "" for pos in range(len(DAILY_REPORT_FUND_FLOW_COLUMNS))]
                rh = row_hash(rel + "#daily-fund-flow", dr_account, dr_date, rv, ri)
                dffvalues.append(tuple([dr_account, dr_date_iso] + detail_vals + [rel, rh]))
            if dffvalues:
                execute_values(
                    cur,
                    f"INSERT INTO mom_daily_report_fund_flows ({daily_report_fund_flow_insert_cols}) VALUES %s ON CONFLICT (row_hash) DO NOTHING",
                    dffvalues, page_size=1000,
                )
            daily_report_fund_flow_count = len(daily_report_fund_flow_rows)

        upsert_file_state(conn, rel, mtime_dt, size, account, trade_date, len(rows), len(futures_rows), len(options_rows), len(close_rows), len(position_rows), len(options_position_rows), len(futures_position_rows), len(order_rows), len(summary_detail_rows), daily_report_count, daily_report_fund_flow_count, "ok", None)
        conn.commit()
        return True, f"ok: {rel} rows={len(rows)} futures={len(futures_rows)} options={len(options_rows)} close={len(close_rows)} pos={len(position_rows)} optpos={len(options_position_rows)} futpos={len(futures_position_rows)} ord={len(order_rows)} sum={len(summary_detail_rows)} daily={daily_report_count} fundflow={daily_report_fund_flow_count}"

    except Exception as exc:
        conn.rollback()
        try:
            upsert_file_state(conn, rel, mtime_dt, size, "", "", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "error", str(exc))
            conn.commit()
        except Exception:
            conn.rollback()
        return False, f"error: {rel} {exc}"


def _dedup_all_tables(conn) -> None:
    """Remove duplicate rows from all mom_ tables caused by the rename-then-reimport bug.

    When 标准化命名 renames a file the source_file_rel changes, so DELETEs keyed on
    source_file_rel missed the old rows.  row_hash also included file_rel so ON CONFLICT
    didn't catch them either.  For each (account, date) pair that has rows from multiple
    source_file_rel values, keep only rows from the newest (highest-id) source file.

    mom_daily_reports uses a simpler MAX(id) dedup since it has no row_hash.
    """

    # ── mom_daily_reports ── simple: one row per (账户, 交易日期)
    _dedup_table_simple(conn, "mom_daily_reports", '"账户"', '"交易日期"')

    # ── detail tables with (account TEXT, trade_date DATE) ──
    _dedup_detail_table(conn, "mom_trade_details", "account", "trade_date")

    # ── detail tables with ("账户" TEXT, "交易日期" DATE) ──
    for table in (
        "mom_futures_trade_details",
        "mom_options_trade_details",
        "mom_close_details",
        "mom_position_details",
        "mom_options_position_details",
        "mom_futures_position_details",
        "mom_order_details",
        "mom_summary_details",
        "mom_daily_report_fund_flows",
    ):
        _dedup_detail_table(conn, table, '"账户"', '"交易日期"')


def _dedup_table_simple(conn, table: str, acct_col: str, date_col: str) -> None:
    """Keep only the MAX(id) row per (acct, date). Safe for tables without row_hash."""
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                DELETE FROM {table}
                WHERE id NOT IN (
                    SELECT MAX(id)
                    FROM {table}
                    GROUP BY {acct_col}, {date_col}
                )
            """)  # noqa: S608
            deleted = cur.rowcount
        conn.commit()
        if deleted:
            log.info("Dedup %s: removed %d duplicate rows.", table, deleted)
    except Exception as exc:
        conn.rollback()
        log.warning("_dedup_table_simple(%s) skipped: %s", table, exc)


def _dedup_detail_table(conn, table: str, acct_col: str, date_col: str) -> None:
    """For each (acct, date) that has rows from >1 source_file_rel, delete all rows
    whose source_file_rel is NOT the one that produced the highest-id row for that pair.
    This keeps the most-recently-imported version and removes the pre-rename orphans.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(f"""
                WITH latest_source AS (
                    SELECT DISTINCT ON ({acct_col}, {date_col})
                           {acct_col}, {date_col}, source_file_rel
                    FROM {table}
                    ORDER BY {acct_col}, {date_col}, id DESC
                )
                DELETE FROM {table} t
                USING latest_source ls
                WHERE ls.{acct_col} = t.{acct_col}
                  AND ls.{date_col} = t.{date_col}
                  AND ls.source_file_rel <> t.source_file_rel
            """)  # noqa: S608
            deleted = cur.rowcount
        conn.commit()
        if deleted:
            log.info("Dedup %s: removed %d orphan rows from renamed files.", table, deleted)
    except Exception as exc:
        conn.rollback()
        log.warning("_dedup_detail_table(%s) skipped: %s", table, exc)


def run(base_dir: Path, reset: bool = False, skip_market_data: bool = False, skip_dedup: bool = False) -> int:
    files = collect_xlsx_files(base_dir)
    if not files:
        print(json.dumps({"job": JOB_NAME, "processed": 0, "changed": 0, "message": "No xlsx files found"}, ensure_ascii=False))
        return 0

    try:
        from tqdm import tqdm as _tqdm  # type: ignore[import-untyped]
        def progress(iterable, **kwargs):
            return _tqdm(iterable, file=sys.stderr, **kwargs)
    except ImportError:
        def progress(iterable, desc="", total=None, **kwargs):  # type: ignore[misc]
            total = total or len(iterable) if hasattr(iterable, "__len__") else "?"
            for i, item in enumerate(iterable, 1):
                print(f"\r{desc} {i}/{total}", end="", flush=True, file=sys.stderr)
                yield item
            print(file=sys.stderr)

    conn = get_conn()
    try:
        if reset:
            drop_tables(conn)
        elif _old_schema_detected(conn):
            # Auto-migrate: old JSONB schema detected, drop and recreate.
            drop_tables(conn)
        ensure_tables(conn)
        if not skip_dedup:
            _dedup_all_tables(conn)  # repair rename-caused duplicates in all mom_ tables

        state = load_file_state(conn, files, base_dir)

        changed: List[Path] = []
        for p in files:
            rel = str(p.relative_to(base_dir)).replace("\\", "/")
            try:
                stat = p.stat()
            except FileNotFoundError:
                # File may be renamed/deleted while ETL is scanning.
                log.warning("File disappeared during scan, skip: %s", rel)
                continue
            mtime_dt = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
            size = int(stat.st_size)

            old = state.get(rel)
            if not old:
                changed.append(p)
                continue
            old_mtime, old_size, old_status = old
            # Always retry files that were previously marked as error, even if unchanged.
            if old_status.lower() != "ok":
                changed.append(p)
                continue
            if int(old_mtime.timestamp()) != int(mtime_dt.timestamp()) or int(old_size) != size:
                changed.append(p)

        ok_count = 0
        err_count = 0
        messages: List[str] = []

        for fp in progress(changed, desc="处理文件", total=len(changed)):
            ok, msg = process_file(conn, base_dir, fp)
            # Deadlocks are transient under concurrent ETL; retry the same file quickly.
            if (not ok) and ("deadlock detected" in msg.lower()):
                log.warning("Deadlock on %s; retrying once.", fp)
                ok, msg = process_file(conn, base_dir, fp)
                if (not ok) and ("deadlock detected" in msg.lower()):
                    log.warning("Deadlock persisted on %s; retrying one final time.", fp)
                    ok, msg = process_file(conn, base_dir, fp)
            messages.append(msg)
            if ok:
                ok_count += 1
            else:
                err_count += 1

        total_futures = sum(
            1 for msg in messages if "futures=" in msg and not msg.startswith("error")
        )
        total_options = sum(
            1 for msg in messages if "options=" in msg and not msg.startswith("error")
        )
        total_close = sum(
            1 for msg in messages if "close=" in msg and not msg.startswith("error")
        )
        total_position = sum(
            1 for msg in messages if "pos=" in msg and not msg.startswith("error")
        )
        total_options_position = sum(
            1 for msg in messages if "optpos=" in msg and not msg.startswith("error")
        )
        total_futures_position = sum(
            1 for msg in messages if "futpos=" in msg and not msg.startswith("error")
        )
        total_order = sum(
            1 for msg in messages if "ord=" in msg and not msg.startswith("error")
        )
        total_summary = sum(
            1 for msg in messages if "sum=" in msg and not msg.startswith("error")
        )
        total_daily = sum(
            1 for msg in messages if "daily=1" in msg and not msg.startswith("error")
        )
        out = {
            "job": JOB_NAME,
            "total_files": len(files),
            "changed_files": len(changed),
            "processed_ok": ok_count,
            "processed_error": err_count,
            "futures_files_with_data": total_futures,
            "options_files_with_data": total_options,
            "close_files_with_data": total_close,
            "position_files_with_data": total_position,
            "options_position_files_with_data": total_options_position,
            "futures_position_files_with_data": total_futures_position,
            "order_files_with_data": total_order,
            "summary_files_with_data": total_summary,
            "daily_report_files_with_data": total_daily,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        # Include only first few messages for concise logs.
        if messages:
            out["sample"] = messages[:20]

        print(json.dumps(out, ensure_ascii=False))

        # ── Market data for 品种交易回顾 charts ──────────────────────────────
        if not skip_market_data:
            log.info("Running market data steps for 品种交易回顾 charts …")
            run_market_data_steps(conn)

        return 0 if err_count == 0 else 2

    finally:
        conn.close()


def main() -> None:
    load_env_files()

    parser = argparse.ArgumentParser(description="Incremental ETL for MOM 成交明细 to PostgreSQL")
    parser.add_argument("--base-dir", default=None, help="MOM data directory, defaults to MOM_DATA_DIR")
    parser.add_argument("--reset", action="store_true", help="Drop and recreate tables before processing (full reload)")
    parser.add_argument("--skip-market-data", action="store_true", help="Skip market data steps (nanhua indices, futures OHLCV, akshare)")
    parser.add_argument("--skip-dedup", action="store_true", help="Skip _dedup_all_tables on startup (safe when no renames just occurred)")
    args = parser.parse_args()

    base_dir = resolve_base_dir(args.base_dir)
    if not base_dir.exists():
        print(json.dumps({"job": JOB_NAME, "error": f"base dir not found: {base_dir}"}, ensure_ascii=False))
        sys.exit(1)

    code = run(base_dir, reset=args.reset, skip_market_data=args.skip_market_data, skip_dedup=args.skip_dedup)
    sys.exit(code)


if __name__ == "__main__":
    main()
