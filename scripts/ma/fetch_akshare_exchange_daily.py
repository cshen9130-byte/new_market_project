#!/usr/bin/env python3
"""
fetch_akshare_exchange_daily.py — Per-contract daily OHLCV via AkShare
========================================================================
Fetches daily volume, open interest, and settlement price for EVERY futures
contract traded on each Chinese exchange using AkShare's free APIs.

This is a FREE complement / fallback to fetch_futures_contracts_daily.py
(which requires paid EmQuant / Choice API access).

AkShare API strategy (akshare >= 1.8):
  Primary  : ak.get_futures_daily(start_date, end_date, market)
               market in {"DCE","CZCE","SHFE","CFFEX","GFEX","INE"}
               Returns all contracts across the date range.
  Fallback : ak.futures_settle_shfe/czce/cffex/gfex(date)
               Per-exchange settlement bulletin (single date, richer data).

On conflict (trade_date, contract): preserves existing non-null values
from EmQuant so AkShare only fills gaps.

Usage
-----
  python fetch_akshare_exchange_daily.py                   # yesterday
  python fetch_akshare_exchange_daily.py 20250424          # single date
  python fetch_akshare_exchange_daily.py 20250101 20250424 # date range (backfill)
  python fetch_akshare_exchange_daily.py 20250424 --held-only  # only needed exchanges

Outputs JSON to stdout (nightly_etl.py run_script-compatible).
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import TypedDict

# ── Column aliases ────────────────────────────────────────────────────────────
# AkShare column names vary by function and version — try all known candidates.

_CONTRACT_COLS = ["合约代码", "合约", "品种月份", "商品合约", "合约名称", "symbol", "contract"]
_VOLUME_COLS   = ["成交量(手)", "成交量", "成交量（手）", "volume", "vol"]
_OI_COLS       = ["持仓量(手)", "持仓量", "持仓量（手）", "open_interest", "oi", "持仓量(手)"]
_CLOSE_COLS    = ["收盘价", "close"]
_SETTLE_COLS   = ["结算价", "当日结算价", "settle", "settlement"]
_OPEN_COLS     = ["开盘价", "open"]
_HIGH_COLS     = ["最高价", "high"]
_LOW_COLS      = ["最低价", "low"]
_PRECLOSE_COLS = ["前结算价", "昨结算价", "preclose", "前收盘价", "pre_settle"]


def _first_col(df, candidates: list[str]):
    """Return the first matching column name found in df, or None."""
    for c in candidates:
        if c in df.columns:
            return c
    return None


def _safe_float(v) -> float | None:
    if v is None:
        return None
    try:
        s = str(v).replace(",", "").strip()
        if s in ("", "-", "--", "—"):
            return None
        return float(s)
    except (ValueError, TypeError):
        return None


# ── CZCE 3-digit delivery code expansion ─────────────────────────────────────

def _czce_expand(raw: str, ref_year: int) -> str:
    """
    Expand a CZCE 3-digit delivery code to 4-digit (YYMM).

    CZCE AkShare returns e.g. 'CF501'  (CF + year_digit=5 + month=01)
    We want:                   'CF2501' (CF + 2-digit year + 2-digit month)

    ref_year: current year (used to determine the decade).
    """
    m = re.match(r"^([A-Za-z]{1,4})(\d)(\d{2})$", raw.strip())
    if not m:
        return raw  # already 4-digit or unparseable

    product, yr_digit, month = m.group(1).upper(), int(m.group(2)), m.group(3)
    decade = (ref_year // 10)   # 2025 → 202
    candidate = decade * 10 + yr_digit  # 202*10+5 = 2025
    if candidate < ref_year - 1:
        candidate += 10  # wrap: e.g. digit=0 in 2025 → 2030

    year_2d = candidate % 100   # 2025 → 25
    return f"{product}{year_2d:02d}{month}"


# ── Exchange fetcher map ───────────────────────────────────────────────────────

class DayRecord(TypedDict):
    date: str       # YYYY-MM-DD
    contract: str   # uppercase, e.g. "LC2702"
    exchange: str   # e.g. "GFEX"
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    preclose: float | None
    settlement: float | None
    volume: float | None
    hqoi: float | None
    amount: float | None


def _parse_df(df, exchange: str, trade_date_str: str, ref_year: int) -> list[DayRecord]:
    """Normalise an AkShare exchange DataFrame → list of DayRecord."""
    import pandas as pd  # noqa: PLC0415

    records: list[DayRecord] = []
    if df is None or df.empty:
        return records

    # Debug: print columns on first call so we can diagnose issues
    sys.stderr.write(f"    columns ({exchange}): {list(df.columns[:15])}\n")

    contract_col = _first_col(df, _CONTRACT_COLS)
    if contract_col is None:
        sys.stderr.write(f"    WARNING: no contract column found in {list(df.columns)}\n")
        return records

    # get_futures_daily may include a date column per row
    date_col = _first_col(df, ["date", "trade_date", "日期", "交易日"])

    volume_col   = _first_col(df, _VOLUME_COLS)
    oi_col       = _first_col(df, _OI_COLS)
    close_col    = _first_col(df, _CLOSE_COLS)
    settle_col   = _first_col(df, _SETTLE_COLS)
    open_col     = _first_col(df, _OPEN_COLS)
    high_col     = _first_col(df, _HIGH_COLS)
    low_col      = _first_col(df, _LOW_COLS)
    preclose_col = _first_col(df, _PRECLOSE_COLS)

    for _, row in df.iterrows():
        raw_code = str(row[contract_col]).strip()
        if not raw_code or raw_code in ("-", "--", "小计", "合计", "总计", ""):
            continue

        # Normalise code: uppercase + CZCE expansion
        code = raw_code.upper()
        if exchange == "CZCE":
            code = _czce_expand(code, ref_year)

        # Must look like a futures contract: letters + 4 digits
        if not re.match(r"^[A-Z]{1,4}\d{4}$", code):
            continue

        def g(col):
            return _safe_float(row[col]) if col else None

        # Use per-row date if available (get_futures_daily returns multi-day data)
        row_date = trade_date_str
        if date_col:
            try:
                raw_date = str(row[date_col])
                # Normalise to YYYY-MM-DD
                raw_date = raw_date.replace("-", "").strip()
                if len(raw_date) == 8:
                    row_date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"
            except Exception:
                pass

        records.append(DayRecord(
            date       = row_date,
            contract   = code,
            exchange   = exchange,
            open       = g(open_col),
            high       = g(high_col),
            low        = g(low_col),
            close      = g(close_col),
            preclose   = g(preclose_col),
            settlement = g(settle_col),
            volume     = g(volume_col),
            hqoi       = g(oi_col),
            amount     = None,
        ))

    return records


def fetch_exchange_day(exchange: str, date_str_yyyymmdd: str, ref_year: int) -> list[DayRecord]:
    """
    Fetch all contracts for one exchange on one date using available AkShare APIs.

    Strategy (akshare 1.8+):
      1. ak.get_futures_daily(start_date, end_date, market) — covers DCE/CZCE/SHFE/CFFEX/GFEX/INE
      2. ak.futures_settle_<exchange>(date) — richer settlement bulletin per exchange
    date_str_yyyymmdd: "20250424"
    """
    try:
        import akshare as ak  # noqa: PLC0415
    except ImportError:
        sys.stderr.write("akshare not installed. Run: pip install akshare\n")
        return []

    trade_date_iso = f"{date_str_yyyymmdd[:4]}-{date_str_yyyymmdd[4:6]}-{date_str_yyyymmdd[6:]}"
    df = None

    # ── Strategy 1: get_futures_daily (primary, covers all exchanges) ──────────
    if hasattr(ak, "get_futures_daily"):
        try:
            df_raw = ak.get_futures_daily(
                start_date=date_str_yyyymmdd,
                end_date=date_str_yyyymmdd,
                market=exchange,
            )
            if df_raw is not None and not df_raw.empty:
                df = df_raw
                sys.stderr.write(
                    f"  {exchange} {date_str_yyyymmdd}: get_futures_daily → {len(df)} rows\n"
                )
        except Exception as exc:
            sys.stderr.write(
                f"  {exchange} {date_str_yyyymmdd}: get_futures_daily failed ({exc}), trying fallback\n"
            )

    # ── Strategy 2: exchange-specific settle bulletin (richer data) ────────────
    _settle_fn_map = {
        "SHFE":  "futures_settle_shfe",
        "CZCE":  "futures_settle_czce",
        "CFFEX": "futures_settle_cffex",
        "GFEX":  "futures_settle_gfex",
    }
    if df is None and exchange in _settle_fn_map:
        fn_name = _settle_fn_map[exchange]
        fn = getattr(ak, fn_name, None)
        if fn is not None:
            try:
                df_settle = fn(date=date_str_yyyymmdd)
                if df_settle is not None and not df_settle.empty:
                    df = df_settle
                    sys.stderr.write(
                        f"  {exchange} {date_str_yyyymmdd}: {fn_name} → {len(df)} rows\n"
                    )
            except Exception as exc:
                sys.stderr.write(
                    f"  {exchange} {date_str_yyyymmdd}: {fn_name} failed ({exc})\n"
                )

    if df is None or df.empty:
        sys.stderr.write(f"  {exchange} {date_str_yyyymmdd}: no data\n")
        return []

    records = _parse_df(df, exchange, trade_date_iso, ref_year)
    sys.stderr.write(f"  {exchange} {date_str_yyyymmdd}: parsed {len(records)} contracts\n")
    return records


# ── Exchange detection from held contracts ────────────────────────────────────

# Mirror of _PRODUCT_EXCHANGE in fetch_futures_contracts_daily.py
_PRODUCT_EXCHANGE: dict[str, str] = {
    "A": "DCE", "B": "DCE", "BB": "DCE", "BZ": "DCE", "C": "DCE",
    "CS": "DCE", "EB": "DCE", "EG": "DCE", "FB": "DCE", "I": "DCE",
    "J": "DCE", "JD": "DCE", "JM": "DCE", "L": "DCE", "LF": "DCE",
    "LG": "DCE", "LH": "DCE", "M": "DCE", "P": "DCE", "PG": "DCE",
    "PP": "DCE", "PPF": "DCE", "RR": "DCE", "V": "DCE", "VF": "DCE", "Y": "DCE",
    "AD": "SHFE", "AG": "SHFE", "AL": "SHFE", "AO": "SHFE", "AU": "SHFE",
    "BC": "SHFE", "BR": "SHFE", "BU": "SHFE", "CU": "SHFE", "FU": "SHFE",
    "HC": "SHFE", "NI": "SHFE", "NR": "SHFE", "OP": "SHFE",
    "PB": "SHFE", "PD": "SHFE", "PL": "SHFE", "PT": "SHFE", "RB": "SHFE",
    "RU": "SHFE", "SN": "SHFE", "SP": "SHFE", "SS": "SHFE", "WR": "SHFE", "ZN": "SHFE",
    "EC": "INE", "LU": "INE", "SC": "INE",
    "AP": "CZCE", "CF": "CZCE", "CJ": "CZCE", "CY": "CZCE", "ER": "CZCE",
    "FG": "CZCE", "JR": "CZCE", "LR": "CZCE", "MA": "CZCE", "OI": "CZCE",
    "PF": "CZCE", "PK": "CZCE", "PL": "CZCE", "PM": "CZCE", "PR": "CZCE",
    "PX": "CZCE", "RI": "CZCE", "RM": "CZCE", "RO": "CZCE", "RS": "CZCE",
    "SA": "CZCE", "SF": "CZCE", "SH": "CZCE", "SM": "CZCE", "SR": "CZCE",
    "TA": "CZCE", "TC": "CZCE", "UR": "CZCE", "WH": "CZCE", "WS": "CZCE", "ZC": "CZCE",
    "LC": "GFEX", "PS": "GFEX", "SI": "GFEX",
    "IC": "CFFEX", "IF": "CFFEX", "IH": "CFFEX", "IM": "CFFEX",
    "T": "CFFEX", "TF": "CFFEX", "TL": "CFFEX", "TS": "CFFEX",
}
_ALL_EXCHANGES = ["DCE", "SHFE", "CZCE", "CFFEX", "GFEX", "INE"]


def _contract_to_exchange(contract: str) -> str | None:
    m = re.match(r"^([A-Za-z]+)", contract.strip())
    if not m:
        return None
    return _PRODUCT_EXCHANGE.get(m.group(1).upper())


def _held_exchanges_from_db(conn) -> list[str]:
    """Return exchanges needed for contracts currently held in mom_position_details."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT UPPER(TRIM("合约")) AS contract
            FROM mom_position_details
            WHERE "交易日期" = (SELECT MAX("交易日期") FROM mom_position_details)
              AND "合约" IS NOT NULL AND TRIM("合约") <> ''
        """)
        contracts = [row[0] for row in cur.fetchall()]

    exchanges: set[str] = set()
    for c in contracts:
        exch = _contract_to_exchange(c)
        if exch:
            exchanges.add(exch)

    # Also check guosen_position_detail
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT DISTINCT UPPER(TRIM(instrument)) AS instrument
                FROM guosen_position_detail
                WHERE settlement_date = (SELECT MAX(settlement_date) FROM guosen_position_detail)
                  AND COALESCE(position_lots, 0) > 0
            """)
            for row in cur.fetchall():
                exch = _contract_to_exchange(row[0])
                if exch:
                    exchanges.add(exch)
    except Exception:
        pass

    return sorted(exchanges) if exchanges else _ALL_EXCHANGES


# ── env / .env loader ─────────────────────────────────────────────────────────

def _load_env():
    candidates = [Path.cwd()]
    try:
        candidates += [
            Path(__file__).resolve().parent,
            Path(__file__).resolve().parent.parent,
            Path(__file__).resolve().parent.parent.parent,
        ]
    except Exception:
        pass
    for base in candidates:
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


# ── DB helpers ────────────────────────────────────────────────────────────────

def _get_conn():
    try:
        import psycopg2  # noqa: PLC0415
    except ImportError:
        sys.stderr.write("psycopg2 not installed. Run: pip install psycopg2-binary\n")
        sys.exit(1)

    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", "5433")),
        dbname=os.environ.get("DB_NAME", "market_data"),
        user=os.environ.get("DB_USER", "market_user"),
        password=os.environ.get("DB_PASSWORD", ""),
    )


def _ensure_table(conn):
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
                source            TEXT        NOT NULL DEFAULT 'akshare_exchange',
                fetched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, contract)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_raw_futures_contracts_daily_contract
            ON raw_futures_contracts_daily (contract)
        """)
    conn.commit()


def _upsert_records(conn, records: list[DayRecord]) -> int:
    """
    Upsert records into raw_futures_contracts_daily.

    On conflict (trade_date, contract):
      - Preserve existing non-null volume / hqoi / close (from EmQuant if present)
      - Fill NULL columns with AkShare values
      - Always update fetched_at so we know when AkShare last ran
    """
    try:
        from psycopg2.extras import execute_values  # noqa: PLC0415
    except ImportError:
        sys.stderr.write("psycopg2 not installed\n")
        sys.exit(1)

    if not records:
        return 0

    rows = [
        (
            r["date"], r["contract"],
            r["open"], r["high"], r["low"], r["close"],
            r["preclose"], r["settlement"], r["volume"], r["hqoi"],
            r["exchange"],
        )
        for r in records
    ]

    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO raw_futures_contracts_daily
                (trade_date, contract, open, high, low, close, preclose, clear,
                 volume, hqoi, source, fetched_at)
            VALUES %s
            ON CONFLICT (trade_date, contract) DO UPDATE SET
                open       = COALESCE(raw_futures_contracts_daily.open,    EXCLUDED.open),
                high       = COALESCE(raw_futures_contracts_daily.high,    EXCLUDED.high),
                low        = COALESCE(raw_futures_contracts_daily.low,     EXCLUDED.low),
                close      = COALESCE(raw_futures_contracts_daily.close,   EXCLUDED.close),
                preclose   = COALESCE(raw_futures_contracts_daily.preclose, EXCLUDED.preclose),
                clear      = COALESCE(raw_futures_contracts_daily.clear,   EXCLUDED.clear),
                volume     = COALESCE(raw_futures_contracts_daily.volume,  EXCLUDED.volume),
                hqoi       = COALESCE(raw_futures_contracts_daily.hqoi,    EXCLUDED.hqoi),
                source     = CASE
                               WHEN raw_futures_contracts_daily.volume IS NULL
                               THEN EXCLUDED.source
                               ELSE raw_futures_contracts_daily.source
                             END,
                fetched_at = NOW()
            """,
            rows,
        )
    conn.commit()
    return len(rows)


# ── Date helpers ──────────────────────────────────────────────────────────────

def _date_range(start: date, end: date) -> list[date]:
    days: list[date] = []
    d = start
    while d <= end:
        # Skip weekends (exchanges don't publish on weekends)
        if d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)
    return days


def _parse_date(s: str) -> date:
    s = s.replace("-", "").strip()
    return datetime.strptime(s, "%Y%m%d").date()


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    _load_env()

    # ── Parse CLI args ─────────────────────────────────────────────────────────
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    held_only = "--held-only" in sys.argv

    today     = date.today()
    yesterday = today - timedelta(days=1)
    # Skip back to last weekday if yesterday was a weekend
    while yesterday.weekday() >= 5:
        yesterday -= timedelta(days=1)

    if len(args) == 0:
        start_date = end_date = yesterday
    elif len(args) == 1:
        start_date = end_date = _parse_date(args[0])
    else:
        start_date = _parse_date(args[0])
        end_date   = _parse_date(args[1])

    dates_to_fetch = _date_range(start_date, end_date)
    if not dates_to_fetch:
        print(json.dumps({"ok": True, "rows": 0, "message": "No trading days in range"}))
        return

    sys.stderr.write(
        f"fetch_akshare_exchange_daily: {start_date} → {end_date} "
        f"({len(dates_to_fetch)} trading day(s))\n"
    )

    # ── Connect ────────────────────────────────────────────────────────────────
    conn = _get_conn()
    _ensure_table(conn)

    # ── Determine exchanges to query ───────────────────────────────────────────
    if held_only:
        try:
            exchanges = _held_exchanges_from_db(conn)
            sys.stderr.write(f"Exchanges from held positions: {exchanges}\n")
        except Exception as exc:
            sys.stderr.write(f"Could not read held contracts ({exc}), querying all exchanges\n")
            exchanges = _ALL_EXCHANGES
    else:
        exchanges = _ALL_EXCHANGES

    # ── Fetch and upsert ───────────────────────────────────────────────────────
    total_rows = 0
    ref_year = today.year

    for d in dates_to_fetch:
        date_str = d.strftime("%Y%m%d")
        day_records: list[DayRecord] = []

        for exch in exchanges:
            day_records.extend(fetch_exchange_day(exch, date_str, ref_year))

        if day_records:
            n = _upsert_records(conn, day_records)
            total_rows += n
            sys.stderr.write(f"  {d.isoformat()}: upserted {n} rows\n")
        else:
            sys.stderr.write(f"  {d.isoformat()}: no data (holiday?)\n")

    conn.close()
    sys.stderr.write(f"Done. Total rows upserted: {total_rows}\n")

    print(json.dumps({
        "ok":         True,
        "start":      start_date.isoformat(),
        "end":        end_date.isoformat(),
        "days":       len(dates_to_fetch),
        "exchanges":  exchanges,
        "rows":       total_rows,
    }))


if __name__ == "__main__":
    main()
