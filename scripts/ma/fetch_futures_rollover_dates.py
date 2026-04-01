#!/usr/bin/env python3
"""
fetch_futures_rollover_dates.py
================================
Detects main-contract rollover dates for Chinese commodity futures.

Method
------
For each product and trading day, we call ak.get_futures_daily() which returns
all active individual contracts with their open interest.  The *dominant*
contract on any given day is the one with the highest open interest.  When the
dominant contract changes from day T−1 to day T, day T is flagged as a rollover
date.

This is superior to statistical heuristics (e.g. 4σ on returns) because it
uses actual market-structure data and will never falsely flag a genuine large
price move.

Supported exchanges: SHFE, DCE, CZCE, INE
Not supported: GFEX (ak.get_futures_daily does not yet cover Guangzhou Exchange)

Usage
-----
  python fetch_futures_rollover_dates.py 2024-01-01              # → today
  python fetch_futures_rollover_dates.py 2024-01-01 2025-03-31  # date range

Output JSON schema
------------------
{
  "start_date": "YYYY-MM-DD",
  "end_date":   "YYYY-MM-DD",
  "count":      <int>,
  "data": [
    {
      "product":       "CU",
      "rollover_date": "2025-01-15",
      "from_contract": "cu2501",
      "to_contract":   "cu2503"
    },
    ...
  ]
}
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date as date_cls, datetime, timedelta
from typing import Optional

import pandas as pd

try:
    import akshare as ak
except ImportError:
    print(json.dumps({"error": "akshare not installed. Run: pip install akshare"}))
    sys.exit(1)


# Exchanges supported by ak.get_futures_daily  (DCE uses a separate per-day API)
MARKETS = ["SHFE", "CZCE", "INE"]

# Regex for extracting the product root from a specific contract symbol.
# Handles:
#   CU2506 (SHFE), cu2506 → CU
#   JM2309 (DCE)  → JM
#   SR509  (CZCE 3-digit) → SR
#   SR2509 (CZCE 4-digit) → SR
#   sc2406 (INE)  → SC
#   PPF2509       → PPF
_CONTRACT_RE = re.compile(r"^([A-Z]{1,5})\d{3,4}$", re.IGNORECASE)

# Patterns that indicate a synthetic / continuous / index contract — skip them.
_SYNTHETIC_SUFFIXES_RE = re.compile(r"(88|99|00)\s*$")


def extract_product(symbol: str) -> Optional[str]:
    """Return the product code (uppercase) for a real delivery contract.

    Returns None for:
    - synthetic / index / continuous symbols (endings 88, 99, 00)
    - symbols that don't match the expected pattern
    """
    s = symbol.strip().upper()
    if _SYNTHETIC_SUFFIXES_RE.search(s):
        return None
    m = _CONTRACT_RE.match(s)
    if not m:
        return None
    return m.group(1).upper()


def ymd(d: date_cls) -> str:
    return d.strftime("%Y%m%d")


def _parse_date(val) -> Optional[date_cls]:
    """Parse a date from various formats AkShare may return (int, str)."""
    if pd.isna(val):
        return None
    s = str(int(val)) if isinstance(val, float) else str(val).strip()
    s = s.replace("-", "")
    try:
        return datetime.strptime(s, "%Y%m%d").date()
    except ValueError:
        return None


def fetch_market_chunk(
    market: str, start: date_cls, end: date_cls
) -> pd.DataFrame:
    """Fetch all contract daily data for one exchange over [start, end]."""
    try:
        df = ak.get_futures_daily(
            start_date=ymd(start),
            end_date=ymd(end),
            market=market,
        )
        if df is None or df.empty:
            return pd.DataFrame()
        return df.copy()
    except Exception as exc:
        print(
            f"[Warn] {market} {ymd(start)}-{ymd(end)}: {exc}", file=sys.stderr
        )
        return pd.DataFrame()


def parse_chunk_rows(df: pd.DataFrame) -> list[dict]:
    """Normalise a DataFrame from get_futures_daily into a list of dicts."""
    if df.empty:
        return []

    # Lowercase all column names for consistent access
    df = df.rename(columns={c: c.lower().strip() for c in df.columns})

    # Identify required columns
    symbol_col = next(
        (c for c in df.columns if c in ("symbol",)), None
    )
    date_col = next(
        (c for c in df.columns if "date" in c), None
    )
    oi_col = next(
        (c for c in df.columns if c in ("open_interest", "oi")), None
    )

    if not symbol_col or not date_col or not oi_col:
        print(
            f"[Warn] Unexpected columns: {list(df.columns)}", file=sys.stderr
        )
        return []

    rows: list[dict] = []
    for _, row in df.iterrows():
        symbol = str(row[symbol_col]).strip()
        product = extract_product(symbol)
        if not product:
            continue
        trade_date = _parse_date(row[date_col])
        if trade_date is None:
            continue
        try:
            oi = float(row[oi_col])
        except (TypeError, ValueError):
            oi = 0.0
        rows.append(
            {
                "trade_date": trade_date,
                "product": product,
                "contract": symbol.upper(),
                "open_interest": oi,
            }
        )
    return rows


def fetch_dce_day(trade_date: date_cls) -> list[dict]:
    """
    Fetch DCE contract data for a single day using ak.futures_dce_daily().

    DCE's website blocks the bulk ak.get_futures_daily(market="DCE") call,
    so we use the per-day endpoint instead.  Column names returned by
    ak.futures_dce_daily() are Chinese; we normalise them here.
    """
    date_str = ymd(trade_date)
    try:
        df = ak.futures_dce_daily(trade_date=date_str)
        if df is None or df.empty:
            return []
        df = df.rename(columns={c: c.strip() for c in df.columns})
        # Possible column name variants
        col_map = {
            # contract code
            "合约代码": "contract",
            "商品代码": "contract",
            # open interest
            "持仓量": "open_interest",
            "持仓量(手)": "open_interest",
        }
        df = df.rename(columns={k: v for k, v in col_map.items() if k in df.columns})
        if "contract" not in df.columns or "open_interest" not in df.columns:
            print(f"[Warn] DCE {date_str}: unexpected columns {list(df.columns)}", file=sys.stderr)
            return []
        rows: list[dict] = []
        for _, row in df.iterrows():
            symbol = str(row["contract"]).strip().upper()
            product = extract_product(symbol)
            if not product:
                continue
            try:
                oi = float(row["open_interest"])
            except (TypeError, ValueError):
                oi = 0.0
            rows.append({
                "trade_date": trade_date,
                "product": product,
                "contract": symbol,
                "open_interest": oi,
            })
        return rows
    except Exception as exc:
        print(f"[Warn] DCE {date_str}: {exc}", file=sys.stderr)
        return []


def iter_trading_days(start: date_cls, end: date_cls):
    """Yield Mon–Fri dates in [start, end] (simple weekday filter)."""
    d = start
    while d <= end:
        if d.weekday() < 5:          # 0=Mon … 4=Fri
            yield d
        d += timedelta(days=1)


def detect_rollovers(rows: list[dict]) -> list[dict]:
    """Find dates when the dominant contract (max OI) changed per product."""
    if not rows:
        return []

    df = pd.DataFrame(rows)
    df["trade_date"] = pd.to_datetime(df["trade_date"])
    df = df[df["open_interest"] > 0].copy()
    if df.empty:
        return []

    # Dominant contract = highest OI per (product, date)
    idx = df.groupby(["trade_date", "product"])["open_interest"].idxmax()
    dominant = (
        df.loc[idx][["trade_date", "product", "contract"]]
        .sort_values(["product", "trade_date"])
        .reset_index(drop=True)
    )

    rollovers: list[dict] = []
    for product, grp in dominant.groupby("product"):
        grp = grp.sort_values("trade_date").reset_index(drop=True)
        for i in range(1, len(grp)):
            prev_contract = grp.loc[i - 1, "contract"]
            curr_contract = grp.loc[i, "contract"]
            if curr_contract != prev_contract:
                rollovers.append(
                    {
                        "product": str(product),
                        "rollover_date": grp.loc[i, "trade_date"].strftime(
                            "%Y-%m-%d"
                        ),
                        "from_contract": prev_contract,
                        "to_contract": curr_contract,
                    }
                )

    return rollovers


def main() -> None:
    args = sys.argv[1:]
    today = date_cls.today()

    if len(args) == 0:
        start_date = today - timedelta(days=90)
        end_date = today
    elif len(args) == 1:
        start_date = datetime.strptime(
            args[0].replace("-", ""), "%Y%m%d"
        ).date()
        end_date = today
    else:
        start_date = datetime.strptime(
            args[0].replace("-", ""), "%Y%m%d"
        ).date()
        end_date = datetime.strptime(
            args[1].replace("-", ""), "%Y%m%d"
        ).date()

    all_rows: list[dict] = []

    # ── SHFE / CZCE / INE: bulk monthly fetch ──────────────────────────────
    current = start_date
    while current <= end_date:
        # Compute end of this month
        if current.month == 12:
            next_month_start = date_cls(current.year + 1, 1, 1)
        else:
            next_month_start = date_cls(current.year, current.month + 1, 1)
        chunk_end = min(next_month_start - timedelta(days=1), end_date)

        for market in MARKETS:
            print(
                f"[Info] Fetching {market} {ymd(current)}-{ymd(chunk_end)} …",
                file=sys.stderr,
            )
            df = fetch_market_chunk(market, current, chunk_end)
            rows = parse_chunk_rows(df)
            all_rows.extend(rows)

        current = next_month_start

    # ── DCE: per-day fetch using ak.futures_dce_daily() ────────────────────
    dce_days = list(iter_trading_days(start_date, end_date))
    total_dce = len(dce_days)
    for i, day in enumerate(dce_days, 1):
        if i % 20 == 0 or i == 1 or i == total_dce:
            print(f"[Info] Fetching DCE {ymd(day)} ({i}/{total_dce}) …", file=sys.stderr)
        rows = fetch_dce_day(day)
        all_rows.extend(rows)

    rollovers = detect_rollovers(all_rows)

    print(
        json.dumps(
            {
                "start_date": start_date.strftime("%Y-%m-%d"),
                "end_date": end_date.strftime("%Y-%m-%d"),
                "count": len(rollovers),
                "data": rollovers,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
