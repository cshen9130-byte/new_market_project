"""Synthetic QVIX series for CFFEX index options when optbbs feed stalls."""

from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Callable

import akshare as ak
import numpy as np
import pandas as pd

from iv_analysis.data import fetch_qvix_history
from iv_analysis.iv_calc import expiry_from_cffex_symbol, implied_volatility
from serialize import latest_trade_date

SYNTHETIC_QVIX_KEYS = frozenset({"1000index", "300index", "50index"})

_SYNTHETIC_CONFIG: dict[str, tuple[str, str, int, Callable[[str], pd.DataFrame]]] = {
    "1000index": ("mo", "sh000852", 100, ak.option_cffex_zz1000_daily_sina),
    "300index": ("io", "sh000300", 50, ak.option_cffex_hs300_daily_sina),
    "50index": ("ho", "sh000016", 50, ak.option_cffex_sz50_daily_sina),
}

_MIN_DTE = 7


def _month_codes(prefix: str, start: date, end: date) -> list[str]:
    """Month symbols covering [start, end] plus one month on each side for rolls."""
    pad_start = start - timedelta(days=45)
    pad_end = end + timedelta(days=45)
    months: list[str] = []
    cursor = date(pad_start.year, pad_start.month, 1)
    end_month = date(pad_end.year, pad_end.month, 1)
    while cursor <= end_month:
        months.append(f"{prefix}{cursor.year % 100:02d}{cursor.month:02d}")
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return months


def _fetch_spot_history(symbol: str, start: date, end: date) -> pd.Series:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            df = ak.stock_zh_index_daily_em(symbol=symbol)
            df["date"] = pd.to_datetime(df["date"]).dt.date
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            mask = (df["date"] >= start) & (df["date"] <= end)
            out = df.loc[mask, ["date", "close"]].dropna()
            return out.set_index("date")["close"]
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"Spot history fetch failed for {symbol}: {last_error}") from last_error


_option_daily_cache: dict[str, pd.DataFrame] = {}


def _fetch_option_daily(fetcher: Callable[[str], pd.DataFrame], symbol: str) -> pd.DataFrame:
    cached = _option_daily_cache.get(symbol)
    if cached is not None:
        return cached
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            raw = fetcher(symbol=symbol)
            df = raw.rename(columns={"date": "trade_date", "close": "close"})
            df["trade_date"] = pd.to_datetime(df["trade_date"]).dt.date
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            df = df.dropna(subset=["trade_date", "close"])
            _option_daily_cache[symbol] = df
            time.sleep(0.15)
            return df
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {symbol}: {last_error}") from last_error


def _select_month(prefix: str, trade_day: date, months: list[str]) -> str | None:
    candidates: list[tuple[int, str]] = []
    for month in months:
        expiry = expiry_from_cffex_symbol(month)
        if expiry is None:
            continue
        dte = (expiry - trade_day).days
        if dte > 0:
            candidates.append((dte, month))
    if not candidates:
        return None
    preferred = [item for item in candidates if item[0] >= _MIN_DTE]
    pool = preferred if preferred else candidates
    pool.sort(key=lambda item: item[0])
    return pool[0][1]


def _atm_strike(spot: float, step: int) -> int:
    return int(round(spot / step) * step)


def _daily_iv(
    fetcher: Callable[[str], pd.DataFrame],
    month: str,
    strike: int,
    spot: float,
    trade_day: date,
) -> float | None:
    expiry = expiry_from_cffex_symbol(month)
    if expiry is None:
        return None
    dte = (expiry - trade_day).days
    if dte <= 0:
        return None
    time_years = max(dte, 1) / 365.0

    call_sym = f"{month}C{strike}"
    put_sym = f"{month}P{strike}"
    try:
        call_df = _fetch_option_daily(fetcher, call_sym)
        put_df = _fetch_option_daily(fetcher, put_sym)
    except RuntimeError:
        return None

    call_row = call_df[call_df["trade_date"] == trade_day]
    put_row = put_df[put_df["trade_date"] == trade_day]
    if call_row.empty or put_row.empty:
        return None

    call = float(call_row.iloc[0]["close"])
    put = float(put_row.iloc[0]["close"])
    if call <= 0 or put <= 0:
        return None

    strike_f = float(strike)
    civ = implied_volatility(call, spot, strike_f, time_years, "call")
    piv = implied_volatility(put, spot, strike_f, time_years, "put")
    if civ is None or piv is None:
        return None
    return (civ + piv) / 2.0


def _preload_option_bars(
    fetcher: Callable[[str], pd.DataFrame],
    prefix: str,
    months: list[str],
    spot_series: pd.Series,
    step: int,
) -> None:
    if spot_series.empty:
        return
    lo = float(spot_series.min())
    hi = float(spot_series.max())
    low_strike = _atm_strike(lo, step) - step * 3
    high_strike = _atm_strike(hi, step) + step * 3
    strikes = range(low_strike, high_strike + step, step)
    for month in months:
        for strike in strikes:
            for side in ("C", "P"):
                sym = f"{month}{side}{strike}"
                try:
                    _fetch_option_daily(fetcher, sym)
                except RuntimeError:
                    continue


def build_synthetic_qvix_series(
    underlying_key: str,
    start: date,
    end: date,
) -> pd.DataFrame:
    """Compute daily ATM implied vol from CFFEX option settlement prices."""
    if underlying_key not in _SYNTHETIC_CONFIG:
        return pd.DataFrame()

    prefix, spot_symbol, step, fetcher = _SYNTHETIC_CONFIG[underlying_key]
    spot = _fetch_spot_history(spot_symbol, start, end)
    if spot.empty:
        return pd.DataFrame()

    months = _month_codes(prefix, start, end)
    _preload_option_bars(fetcher, prefix, months, spot, step)

    rows: list[dict] = []
    for trade_day, spot_px in spot.items():
        month = _select_month(prefix, trade_day, months)
        if month is None:
            continue
        strike = _atm_strike(float(spot_px), step)
        iv = _daily_iv(fetcher, month, strike, float(spot_px), trade_day)
        if iv is None or not np.isfinite(iv) or iv <= 0:
            continue
        rows.append(
            {
                "trade_date": pd.Timestamp(trade_day),
                "iv": float(iv),
                "open": float(iv),
                "high": float(iv),
                "low": float(iv),
            }
        )

    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows).sort_values("trade_date").reset_index(drop=True)


def last_official_qvix_date(underlying_key: str) -> date | None:
    official = fetch_qvix_history(underlying_key)
    if official.empty:
        return None
    return pd.Timestamp(official.iloc[-1]["trade_date"]).date()


def merge_synthetic_qvix_gaps(
    underlying_key: str,
    qvix: pd.DataFrame,
    end: date | None = None,
) -> pd.DataFrame:
    """Fill missing QVIX dates after the official optbbs feed stops."""
    if underlying_key not in SYNTHETIC_QVIX_KEYS:
        return qvix

    target = end or latest_trade_date()
    qvix = qvix.sort_values("trade_date").reset_index(drop=True)

    try:
        official_end = last_official_qvix_date(underlying_key)
    except Exception:  # noqa: BLE001
        return qvix
    if official_end is None or official_end >= target:
        return qvix

    _, spot_symbol, _, _ = _SYNTHETIC_CONFIG[underlying_key]
    fill_start = official_end + timedelta(days=1)
    if fill_start > target:
        return qvix

    existing_dates = set(pd.to_datetime(qvix["trade_date"]).dt.date)
    try:
        spot_dates = _fetch_spot_history(spot_symbol, fill_start, target).index
    except Exception:  # noqa: BLE001
        return qvix
    missing = [d for d in spot_dates if d not in existing_dates]
    if not missing:
        return qvix

    _option_daily_cache.clear()
    synthetic = build_synthetic_qvix_series(underlying_key, min(missing), max(missing))
    if synthetic.empty:
        return qvix

    missing_set = set(missing)
    synthetic = synthetic[
        pd.to_datetime(synthetic["trade_date"]).dt.date.isin(missing_set)
    ]
    if synthetic.empty:
        return qvix

    combined = pd.concat([qvix, synthetic], ignore_index=True)
    return combined.sort_values("trade_date").reset_index(drop=True)
