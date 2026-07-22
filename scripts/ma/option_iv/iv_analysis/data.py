"""Fetch China option IV data via akshare with retries and fallbacks."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from typing import Callable

import akshare as ak
import numpy as np
import pandas as pd
from akshare.utils.func import fetch_paginated_data

from config import UNDERLYINGS, UnderlyingConfig
from iv_analysis.iv_calc import expiry_from_cffex_symbol, implied_volatility

EM_VALUE_URL = "https://push2.eastmoney.com/api/qt/clist/get"
EM_VALUE_FIELDS = "f1,f2,f3,f12,f13,f14,f298,f299,f249,f300,f330,f331,f332,f333,f334,f335,f336,f301,f152"
EM_VALUE_UT = "b2884a393a59ad64002292a3e90d46a5"

CFFEX_INDEX_SOURCES: dict[str, tuple[str, Callable[[], dict], str, str]] = {
    "300index": ("io", ak.option_cffex_hs300_list_sina, "sh000300", "沪深300指数"),
    "50index": ("ho", ak.option_cffex_sz50_list_sina, "sh000016", "上证50指数"),
    "1000index": ("mo", ak.option_cffex_zz1000_list_sina, "sh000852", "中证1000指数"),
}

OPTION_COLUMNS = [
    "option_code",
    "option_name",
    "last_price",
    "time_value",
    "intrinsic_value",
    "iv",
    "theoretical_price",
    "underlying_name",
    "underlying_price",
    "underlying_hv_1y",
    "expiry_date",
    "option_type",
    "strike",
    "days_to_expiry",
    "moneyness",
    "underlying_key",
    "open_interest",
]


def _retry(func: Callable[[], pd.DataFrame], retries: int = 5, delay: float = 3.0) -> pd.DataFrame:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            return func()
        except Exception as exc:  # noqa: BLE001 - surface upstream API errors
            last_error = exc
            if attempt < retries - 1:
                time.sleep(delay * (attempt + 1))
    raise RuntimeError(f"Data fetch failed after {retries} attempts: {last_error}") from last_error


def fetch_option_snapshot_em() -> pd.DataFrame:
    """Fetch cross-sectional IV from East Money (SSE + SZSE ETF options)."""
    frames: list[pd.DataFrame] = []
    errors: list[str] = []

    for fs in ("m:10", "m:12"):
        try:
            frames.append(_fetch_em_value_analysis(fs))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{fs}: {exc}")

    if not frames:
        raise RuntimeError("East Money IV snapshot unavailable. " + " | ".join(errors))

    combined = pd.concat(frames, ignore_index=True)
    combined = combined.drop_duplicates(subset=["option_code"], keep="first")
    return _normalize_snapshot(combined, iv_scale=100.0)


def _fetch_em_value_analysis(fs: str) -> pd.DataFrame:
    """Fetch East Money option value analysis for a market filter."""

    def _fetch() -> pd.DataFrame:
        params = {
            "fid": "f301",
            "po": "1",
            "pz": "100",
            "pn": "1",
            "np": "1",
            "fltt": "2",
            "invt": "2",
            "ut": EM_VALUE_UT,
            "fields": EM_VALUE_FIELDS,
            "fs": fs,
        }
        temp_df = fetch_paginated_data(EM_VALUE_URL, params)
        temp_df.columns = [
            "-",
            "-",
            "最新价",
            "-",
            "期权代码",
            "-",
            "期权名称",
            "-",
            "隐含波动率",
            "时间价值",
            "内在价值",
            "理论价格",
            "到期日",
            "-",
            "-",
            "-",
            "标的名称",
            "标的最新价",
            "-",
            "标的近一年波动率",
        ]
        return temp_df[
            [
                "期权代码",
                "期权名称",
                "最新价",
                "时间价值",
                "内在价值",
                "隐含波动率",
                "理论价格",
                "标的名称",
                "标的最新价",
                "标的近一年波动率",
                "到期日",
            ]
        ]

    raw = _retry(_fetch)
    df = raw.rename(
        columns={
            "期权代码": "option_code",
            "期权名称": "option_name",
            "最新价": "last_price",
            "时间价值": "time_value",
            "内在价值": "intrinsic_value",
            "隐含波动率": "iv",
            "理论价格": "theoretical_price",
            "标的名称": "underlying_name",
            "标的最新价": "underlying_price",
            "标的近一年波动率": "underlying_hv_1y",
            "到期日": "expiry_date",
        }
    )
    return df


def _recent_trade_dates(max_days: int = 10) -> list[date]:
    today = datetime.now().date()
    return [today - timedelta(days=i) for i in range(max_days)]


def fetch_option_snapshot_sse(trade_date: date | None = None) -> pd.DataFrame:
    """Fetch SSE ETF option IV from exchange risk indicators (fallback)."""
    candidates = [trade_date] if trade_date else list(_recent_trade_dates())
    last_error: Exception | None = None

    raw: pd.DataFrame | None = None
    for candidate in candidates:
        if candidate is None:
            continue
        date_str = candidate.strftime("%Y%m%d")

        def _fetch(d: str = date_str) -> pd.DataFrame:
            return ak.option_risk_indicator_sse(date=d)

        try:
            raw = _retry(_fetch, retries=2, delay=1.5)
            if not raw.empty:
                break
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            continue

    if raw is None or raw.empty:
        raise RuntimeError(f"SSE option snapshot unavailable: {last_error}")
    df = raw.rename(
        columns={
            "SECURITY_ID": "option_code",
            "CONTRACT_SYMBOL": "option_name",
            "IMPLC_VOLATLTY": "iv",
        }
    )
    df["iv"] = pd.to_numeric(df["iv"], errors="coerce") * 100.0
    df = df[df["iv"] > 0].copy()
    df["underlying_name"] = df["option_name"].str.extract(r"^(\d+ETF)", expand=False).map(
        {"50ETF": "上证50ETF", "300ETF": "沪深300ETF", "500ETF": "中证500ETF"}
    )
    return _normalize_snapshot(df, iv_scale=1.0)


SZSE_ETF_CODES: dict[str, tuple[str, str, str]] = {
    "cyb": ("159915", "创业板ETF", "sz159915"),
    "100etf": ("159901", "深证100ETF", "sz159901"),
    "300etf_sz": ("159919", "嘉实沪深300ETF", "sz159919"),
    "500etf_sz": ("159922", "嘉实中证500ETF", "sz159922"),
}

SSE_ETF_CODES: dict[str, tuple[str, str, str]] = {
    "50etf": ("510050", "上证50ETF", "sh510050"),
    "300etf": ("510300", "沪深300ETF", "sh510300"),
    "500etf": ("510500", "中证500ETF", "sh510500"),
    "kcb": ("588000", "科创50ETF华夏", "sh588000"),
    "kcb_efund": ("588080", "科创50ETF易方达", "sh588080"),
}

SNAPSHOT_SOURCE_PRIORITY = {
    "em": 1,
    "sse_risk": 2,
    "cffex": 3,
    "szse": 4,
    "sse_chain": 5,
}


def _fetch_option_prices_sina(
    contract_codes: list[str],
    max_workers: int = 12,
    timeout_per: float = 5.0,
) -> dict[str, float]:
    """Fetch live option prices from Sina in parallel."""
    unique_codes = list(dict.fromkeys(str(code) for code in contract_codes if code))
    if not unique_codes:
        return {}

    prices: dict[str, float] = {}
    workers = min(max_workers, len(unique_codes))
    batch_timeout = max(90.0, len(unique_codes) * timeout_per / max(workers, 1) + 30.0)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_fetch_option_price_sina, code): code for code in unique_codes}
        try:
            completed = as_completed(futures, timeout=batch_timeout)
            for fut in completed:
                code = futures[fut]
                try:
                    price = fut.result(timeout=timeout_per)
                except Exception:  # noqa: BLE001
                    continue
                if price is not None and price > 0:
                    prices[code] = price
        except TimeoutError:
            pass
    return prices


def _resolve_szse_option_price(contract_code: str, row: pd.Series, live_prices: dict[str, float]) -> float | None:
    """Prefer live quote; exchange file only publishes prior settlement."""
    live = live_prices.get(str(contract_code))
    if live is not None and live > 0:
        return live

    settlement = pd.to_numeric(row.get("前结算价"), errors="coerce")
    if pd.notna(settlement) and settlement > 0:
        return float(settlement)
    return None


def fetch_option_snapshot_szse() -> pd.DataFrame:
    """Fetch SZSE ETF option chains and compute implied volatility."""
    raw = _retry(ak.option_current_day_szse, retries=3, delay=2.0)
    rows: list[dict] = []
    today = datetime.now().date()
    spot_cache: dict[str, float] = {}
    szse_codes = tuple(code for code, _, _ in SZSE_ETF_CODES.values())
    tracked = raw[raw["标的证券简称(代码)"].astype(str).str.contains("|".join(szse_codes), na=False)]
    live_prices = _fetch_option_prices_sina(tracked["合约编码"].astype(str).tolist())

    for _key, (code, underlying_name, spot_symbol) in SZSE_ETF_CODES.items():
        subset = raw[raw["标的证券简称(代码)"].astype(str).str.contains(code, na=False)].copy()
        if subset.empty:
            continue
        if spot_symbol not in spot_cache:
            spot_cache[spot_symbol] = _fetch_spot_price(spot_symbol) or 0.0
        spot = spot_cache[spot_symbol]
        if not spot:
            continue

        for _, row in subset.iterrows():
            contract_code = str(row["合约编码"])
            strike = pd.to_numeric(row["行权价"], errors="coerce")
            expiry = pd.to_datetime(row["行权日"], errors="coerce")
            if pd.isna(strike) or pd.isna(expiry) or strike <= 0:
                continue
            days = (expiry.date() - today).days if hasattr(expiry, "date") else (expiry - pd.Timestamp(today)).days
            if days < 0:
                continue
            time_years = max(days, 1) / 365.0
            option_type = "call" if "购" in str(row["合约类型"]) else "put"

            price = _resolve_szse_option_price(contract_code, row, live_prices)
            if price is None or price <= 0:
                continue

            iv = implied_volatility(float(price), float(spot), float(strike), time_years, option_type)
            if iv is None or iv <= 0:
                continue

            rows.append(
                {
                    "option_code": contract_code,
                    "CONTRACT_ID": str(row["合约代码"]),
                    "option_name": str(row["合约简称"]),
                    "last_price": float(price),
                    "iv": iv,
                    "underlying_name": underlying_name,
                    "underlying_price": float(spot),
                    "expiry_date": expiry,
                    "option_type": option_type,
                    "strike": float(strike),
                    "open_interest": float(pd.to_numeric(row.get("合约总持仓"), errors="coerce") or 0),
                }
            )

    if not rows:
        return pd.DataFrame(columns=OPTION_COLUMNS)
    return _normalize_snapshot(pd.DataFrame(rows), iv_scale=1.0)


def fetch_option_snapshot_sse_chain() -> pd.DataFrame:
    """Fetch SSE ETF option chains with live Sina prices and BS implied vol."""
    raw = _retry(ak.option_current_day_sse, retries=3, delay=2.0)
    rows: list[dict] = []
    today = datetime.now().date()
    spot_cache: dict[str, float] = {}
    sse_codes = tuple(code for code, _, _ in SSE_ETF_CODES.values())
    tracked = raw[raw["标的券名称及代码"].astype(str).str.contains("|".join(sse_codes), na=False)]
    live_prices = _fetch_option_prices_sina(tracked["合约编码"].astype(str).tolist())

    for key, (code, underlying_name, spot_symbol) in SSE_ETF_CODES.items():
        subset = raw[raw["标的券名称及代码"].astype(str).str.contains(code, na=False)].copy()
        if key == "kcb":
            subset = subset[~subset["合约简称"].astype(str).str.contains("科创板50", na=False)]
            subset = subset[~subset["合约交易代码"].astype(str).str.contains("588080", na=False)]
        elif key == "kcb_efund":
            subset = subset[subset["合约交易代码"].astype(str).str.contains("588080", na=False)]
        if subset.empty:
            continue
        if spot_symbol not in spot_cache:
            spot_cache[spot_symbol] = _fetch_spot_price(spot_symbol) or 0.0
        spot = spot_cache[spot_symbol]
        if not spot:
            continue

        for _, row in subset.iterrows():
            contract_code = str(row["合约编码"])
            trade_code = str(row["合约交易代码"])
            strike = pd.to_numeric(row["行权价"], errors="coerce")
            expiry_raw = str(row.get("期权行权日", row.get("到期日", "")))
            expiry = pd.to_datetime(expiry_raw, format="%Y%m%d", errors="coerce")
            if pd.isna(strike) or pd.isna(expiry) or strike <= 0:
                continue
            days = (expiry.date() - today).days if hasattr(expiry, "date") else (expiry - pd.Timestamp(today)).days
            if days < 0:
                continue
            time_years = max(days, 1) / 365.0
            option_type = "call" if "购" in str(row["类型"]) else "put"

            price = live_prices.get(contract_code)
            if price is None or price <= 0:
                continue

            iv = implied_volatility(float(price), float(spot), float(strike), time_years, option_type)
            if iv is None or iv <= 0:
                continue

            rows.append(
                {
                    "option_code": contract_code,
                    "CONTRACT_ID": trade_code,
                    "option_name": str(row["合约简称"]),
                    "last_price": float(price),
                    "iv": iv,
                    "underlying_name": underlying_name,
                    "underlying_price": float(spot),
                    "expiry_date": expiry,
                    "option_type": option_type,
                    "strike": float(strike),
                }
            )

    if not rows:
        return pd.DataFrame(columns=OPTION_COLUMNS)
    return _normalize_snapshot(pd.DataFrame(rows), iv_scale=1.0)


def _fetch_option_price_sina(contract_code: str) -> float | None:
    price, _oi = _fetch_option_quote_sina(contract_code)
    return price


def _fetch_option_quote_sina(contract_code: str) -> tuple[float | None, float | None]:
    try:
        df = ak.option_sse_spot_price_sina(symbol=contract_code)
        values = dict(zip(df.iloc[:, 0].astype(str), df.iloc[:, 1]))
        price = pd.to_numeric(values.get("最新价"), errors="coerce")
        oi = pd.to_numeric(values.get("持仓量"), errors="coerce")
        price_out = float(price) if pd.notna(price) and price > 0 else None
        oi_out = float(oi) if pd.notna(oi) and oi >= 0 else None
        return price_out, oi_out
    except Exception:  # noqa: BLE001
        return None, None


def _fetch_option_open_interest_sina(contract_codes: list[str], max_workers: int = 12, timeout_per: float = 5.0) -> dict[str, float]:
    unique_codes = list(dict.fromkeys(str(code) for code in contract_codes if code))
    if not unique_codes:
        return {}

    oi_map: dict[str, float] = {}
    workers = min(max_workers, len(unique_codes))
    batch_timeout = max(60.0, len(unique_codes) * timeout_per / max(workers, 1) + 20.0)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_fetch_option_quote_sina, code): code for code in unique_codes}
        try:
            for fut in as_completed(futures, timeout=batch_timeout):
                code = futures[fut]
                try:
                    _price, oi = fut.result(timeout=timeout_per)
                except Exception:  # noqa: BLE001
                    continue
                if oi is not None:
                    oi_map[code] = oi
        except TimeoutError:
            pass
    return oi_map


def enrich_chain_open_interest(df: pd.DataFrame) -> pd.DataFrame:
    """Fill missing open interest for chain charts (SSE/Sina contracts)."""
    if df.empty:
        return df

    out = df.copy()
    if "open_interest" not in out.columns:
        out["open_interest"] = np.nan

    missing = out["open_interest"].isna() | (pd.to_numeric(out["open_interest"], errors="coerce").fillna(0) <= 0)
    if not missing.any():
        return out

    codes = out.loc[missing, "option_code"].astype(str).tolist()
    oi_map = _fetch_option_open_interest_sina(codes)
    if oi_map:
        mapped = out.loc[missing, "option_code"].astype(str).map(oi_map)
        out.loc[missing, "open_interest"] = out.loc[missing, "open_interest"].fillna(mapped)
    out["open_interest"] = pd.to_numeric(out["open_interest"], errors="coerce").fillna(0.0)
    return out


def fetch_option_snapshot_cffex() -> pd.DataFrame:
    """Fetch CFFEX index option chains and compute implied volatility."""
    rows: list[dict] = []
    today = datetime.now().date()

    for _key, (_prefix, list_func, spot_symbol, underlying_name) in CFFEX_INDEX_SOURCES.items():
        spot = _fetch_spot_price(spot_symbol)
        if not spot:
            continue

        month_map = list_func()
        month_symbols = next(iter(month_map.values()), [])
        for month_symbol in month_symbols[:4]:
            try:
                chain = _retry(lambda ms=month_symbol, p=_prefix: _fetch_cffex_chain(p, ms), retries=2, delay=1.0)
            except Exception:  # noqa: BLE001
                continue
            if chain.empty:
                continue

            expiry = expiry_from_cffex_symbol(month_symbol)
            if expiry is None:
                continue
            days = (expiry - today).days
            if days < 0:
                continue
            time_years = max(days, 1) / 365.0

            for _, row in chain.iterrows():
                strike = pd.to_numeric(row.get("strike"), errors="coerce")
                if pd.isna(strike) or strike <= 0:
                    continue

                for side, option_type, price_col, symbol_col, oi_col in (
                    ("call", "call", "call_last", "call_symbol", "call_oi"),
                    ("put", "put", "put_last", "put_symbol", "put_oi"),
                ):
                    price = pd.to_numeric(row.get(price_col), errors="coerce")
                    symbol = str(row.get(symbol_col, "")).strip()
                    oi = pd.to_numeric(row.get(oi_col), errors="coerce")
                    if not symbol or pd.isna(price) or price <= 0:
                        continue
                    iv = implied_volatility(float(price), float(spot), float(strike), time_years, option_type)
                    if iv is None or iv <= 0:
                        continue
                    rows.append(
                        {
                            "option_code": symbol,
                            "CONTRACT_ID": symbol,
                            "option_name": symbol,
                            "last_price": float(price),
                            "iv": iv,
                            "underlying_name": underlying_name,
                            "underlying_price": float(spot),
                            "expiry_date": pd.Timestamp(expiry),
                            "option_type": side,
                            "strike": float(strike),
                            "open_interest": float(oi) if pd.notna(oi) else 0.0,
                        }
                    )

    if not rows:
        return pd.DataFrame(columns=OPTION_COLUMNS)
    return _normalize_snapshot(pd.DataFrame(rows), iv_scale=1.0)


def _fetch_cffex_chain(prefix: str, month_symbol: str) -> pd.DataFrame:
    fetchers = {
        "io": ak.option_cffex_hs300_spot_sina,
        "ho": ak.option_cffex_sz50_spot_sina,
        "mo": ak.option_cffex_zz1000_spot_sina,
    }
    raw = fetchers[prefix](symbol=month_symbol)
    raw = raw.rename(
        columns={
            "看涨合约-最新价": "call_last",
            "看跌合约-最新价": "put_last",
            "行权价": "strike",
            "看涨合约-标识": "call_symbol",
            "看跌合约-标识": "put_symbol",
            "看涨合约-持仓量": "call_oi",
            "看跌合约-持仓量": "put_oi",
        }
    )
    keep = [c for c in ("call_last", "put_last", "strike", "call_symbol", "put_symbol", "call_oi", "put_oi") if c in raw.columns]
    return raw[keep].copy()


def _tag_snapshot_source(df: pd.DataFrame, source: str) -> pd.DataFrame:
    out = df.copy()
    out["_source_priority"] = SNAPSHOT_SOURCE_PRIORITY[source]
    out["_snapshot_source"] = source
    return out


def _dedupe_snapshot_sources(combined: pd.DataFrame) -> pd.DataFrame:
    out = combined.copy()
    contract_id = out.get("CONTRACT_ID", pd.Series("", index=out.index)).astype(str)
    out["_dedupe_key"] = contract_id.where(contract_id.notna() & ~contract_id.isin(["", "nan", "None"]), other="")
    missing = out["_dedupe_key"] == ""
    out.loc[missing, "_dedupe_key"] = out.loc[missing, "option_name"].astype(str)
    missing = out["_dedupe_key"].isin(["", "nan", "None"])
    out.loc[missing, "_dedupe_key"] = out.loc[missing, "option_code"].astype(str)

    out = out.sort_values("_source_priority", kind="stable")
    out = out.drop_duplicates(subset=["_dedupe_key"], keep="last")
    return out.drop(columns=["_source_priority", "_dedupe_key"], errors="ignore")


def fetch_option_snapshot() -> pd.DataFrame:
    """Fetch financial option IV snapshot, preferring live chain recalculations."""
    frames: list[pd.DataFrame] = []
    errors: list[str] = []

    em_loaded = False
    for attempt in range(3):
        try:
            frames.append(_tag_snapshot_source(fetch_option_snapshot_em(), "em"))
            em_loaded = True
            break
        except Exception as exc:  # noqa: BLE001
            errors.append(f"EM attempt {attempt + 1}: {exc}")
            time.sleep(2 * (attempt + 1))

    if not em_loaded:
        try:
            frames.append(_tag_snapshot_source(fetch_option_snapshot_sse(), "sse_risk"))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"SSE fallback: {exc}")

    for source, fetcher in (
        ("cffex", fetch_option_snapshot_cffex),
        ("szse", fetch_option_snapshot_szse),
        ("sse_chain", fetch_option_snapshot_sse_chain),
    ):
        try:
            df = fetcher()
            if not df.empty:
                frames.append(_tag_snapshot_source(df, source))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{source}: {exc}")

    if not frames:
        raise RuntimeError("Unable to fetch option IV snapshot. " + " | ".join(errors))

    combined = pd.concat(frames, ignore_index=True)
    return _dedupe_snapshot_sources(combined)


def _clean_qvix_history(df: pd.DataFrame, max_fill_gap_days: int = 5) -> pd.DataFrame:
    """Drop invalid QVIX readings and fill short gaps caused by zero placeholders."""
    if df.empty:
        return df

    out = df.sort_values("trade_date").copy()
    out["trade_date"] = pd.to_datetime(out["trade_date"])
    out["iv"] = pd.to_numeric(out["iv"], errors="coerce")

    quote_cols = [col for col in ("open", "high", "low", "iv") if col in out.columns]
    if len(quote_cols) > 1:
        out = out[out[quote_cols].notna().any(axis=1)].copy()

    out.loc[out["iv"] <= 0, "iv"] = pd.NA
    out = out.drop_duplicates(subset=["trade_date"], keep="last").reset_index(drop=True)

    if max_fill_gap_days > 0 and not out.empty:
        iv_values = out["iv"].tolist()
        dates = out["trade_date"].tolist()
        last_valid: float | None = None
        last_date = None
        for i, iv in enumerate(iv_values):
            if pd.notna(iv):
                last_valid = float(iv)
                last_date = dates[i]
                continue
            if last_valid is None or last_date is None:
                continue
            if (dates[i] - last_date).days <= max_fill_gap_days:
                iv_values[i] = last_valid
        out["iv"] = iv_values

    return out.dropna(subset=["iv"]).reset_index(drop=True)


def fetch_qvix_history(underlying_key: str) -> pd.DataFrame:
    """Fetch daily QVIX (ATM IV proxy) history for an underlying."""
    cfg = UNDERLYINGS[underlying_key]
    func = getattr(ak, cfg.qvix_func)
    raw = _retry(func, retries=3, delay=2.0)
    df = raw.rename(columns={"date": "trade_date", "close": "iv"})
    for col in ("open", "high", "low"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df["trade_date"] = pd.to_datetime(df["trade_date"])
    df["iv"] = pd.to_numeric(df["iv"], errors="coerce")
    df["underlying_key"] = underlying_key
    df["underlying_label"] = cfg.label
    return _clean_qvix_history(df)


def _fetch_spot_price(symbol: str) -> float | None:
    df = ak.option_sse_underlying_spot_price_sina(symbol=symbol)
    price_row = df.loc[df.iloc[:, 0].astype(str).str.contains("最近成交价|最新价", na=False)]
    if price_row.empty:
        price_row = df.iloc[3:4]
    try:
        return float(price_row.iloc[0, 1])
    except (TypeError, ValueError, IndexError):
        return None


def _attach_sse_underlying_prices(df: pd.DataFrame) -> pd.DataFrame:
    """Fill missing underlying prices for SSE fallback rows."""
    if df.empty:
        return df

    prefix_to_spot = {
        "50ETF": "sh510050",
        "300ETF": "sh510300",
        "500ETF": "sh510500",
        "科创50ETF": "sh588000",
        "科创板50ETF": "sh588080",
        "创业板ETF": "sz159915",
        "深证100ETF": "sz159901",
        "沪深300ETF": "sz159919",
        "中证500ETF": "sz159922",
    }
    spot_cache: dict[str, float] = {}

    def _price_for_name(name: str) -> float | None:
        for prefix, spot in prefix_to_spot.items():
            if prefix in str(name):
                if spot not in spot_cache:
                    spot_cache[spot] = _fetch_spot_price(spot) or 0.0
                return spot_cache[spot] or None
        return None

    out = df.copy()
    if "underlying_price" not in out.columns:
        out["underlying_price"] = pd.Series(pd.NA, index=out.index, dtype="Float64")
    missing = out["underlying_price"].isna()
    if missing.any():
        mapped = out.loc[missing, "option_name"].map(_price_for_name)
        out.loc[missing, "underlying_price"] = mapped.astype("Float64")
    return out


def filter_underlying(df: pd.DataFrame, cfg: UnderlyingConfig) -> pd.DataFrame:
    """Filter snapshot rows for a configured underlying."""
    if df.empty:
        return df

    name = df["option_name"].astype(str)
    uname = df.get("underlying_name", pd.Series("", index=df.index)).astype(str)

    contract_id = df.get("CONTRACT_ID", pd.Series("", index=df.index)).astype(str)
    option_code = df.get("option_code", pd.Series("", index=df.index)).astype(str)

    rules: dict[str, tuple[str, ...]] = {
        "50etf": ("上证50ETF", r"(?<![0-9])50ETF"),
        "300etf": (r"^300ETF", r"510300"),
        "500etf": (r"^500ETF", r"510500"),
        "cyb": ("创业板ETF", r"159915"),
        "kcb": ("科创50ETF华夏", r"588000", r"^科创50(?!板)"),
        "300index": (r"(?i)\bio", "沪深300指数", "300指数"),
        "50index": (r"(?i)\bho", "上证50指数", "50指数"),
        "1000index": (r"(?i)\bmo", "中证1000指数", "1000指数"),
        "100etf": ("深证100ETF", r"^100ETF", r"159901"),
        "300etf_sz": ("嘉实沪深300ETF", r"159919"),
        "500etf_sz": ("嘉实中证500ETF", r"159922"),
        "kcb_efund": ("科创50ETF易方达", "易方达", r"588080", r"^科创板50"),
    }

    mask = pd.Series(False, index=df.index)
    for pattern in rules.get(cfg.key, cfg.em_keywords):
        if pattern.startswith("(") or pattern.startswith("^") or "(?<" in pattern or "(?i)" in pattern:
            mask |= name.str.contains(pattern, regex=True, na=False)
            mask |= contract_id.str.contains(pattern, regex=True, na=False)
            mask |= option_code.str.contains(pattern, regex=True, na=False)
        else:
            mask |= uname.str.contains(pattern, na=False)
            mask |= name.str.contains(pattern, na=False)
            mask |= contract_id.str.contains(pattern, na=False)
            mask |= option_code.str.contains(pattern, na=False)

    out = df.loc[mask].copy()
    if cfg.key == "300etf":
        szse = out[contract_id.loc[out.index].str.contains("159919", na=False)]
        out = out.drop(szse.index, errors="ignore")
    elif cfg.key == "500etf":
        szse = out[contract_id.loc[out.index].str.contains("159922", na=False)]
        out = out.drop(szse.index, errors="ignore")
    elif cfg.key == "kcb":
        out = out[~out["option_name"].astype(str).str.contains(r"^科创板50", regex=True, na=False)]
        out = out[~out.get("underlying_name", pd.Series("", index=out.index)).astype(str).str.contains("易方达", na=False)]
        out = out[~contract_id.loc[out.index].str.contains("588080", na=False)]
    elif cfg.key == "300etf_sz":
        sse = out[contract_id.loc[out.index].str.contains("510300", na=False)]
        out = out.drop(sse.index, errors="ignore")
    elif cfg.key == "500etf_sz":
        sse = out[contract_id.loc[out.index].str.contains("510500", na=False)]
        out = out.drop(sse.index, errors="ignore")

    if cfg.primary_underlying:
        primary = out[out["underlying_name"].astype(str).str.contains(cfg.primary_underlying, na=False)]
        if not primary.empty:
            out = primary
    out["underlying_key"] = cfg.key
    return out


def _normalize_snapshot(df: pd.DataFrame, iv_scale: float) -> pd.DataFrame:
    from iv_analysis.parser import enrich_option_frame

    if "iv" in df.columns:
        df["iv"] = pd.to_numeric(df["iv"], errors="coerce")
        if iv_scale != 1.0 and df["iv"].dropna().median() < 5:
            df["iv"] = df["iv"] * iv_scale

    for col in ("last_price", "underlying_price", "time_value", "intrinsic_value", "theoretical_price"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    if "expiry_date" in df.columns:
        df["expiry_date"] = pd.to_datetime(df["expiry_date"], errors="coerce")

    df = _attach_sse_underlying_prices(df)
    return enrich_option_frame(df)
