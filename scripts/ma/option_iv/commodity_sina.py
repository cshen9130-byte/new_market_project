"""Sina finance commodity-option fallback (used when DCE hist API is down)."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from commodity_config import CommodityUnderlying
from commodity_deeper import fetch_futures_closes
from iv_analysis.iv_calc import implied_volatility

# Keys → Sina option_commodity_* symbol names (subset of exchange universe)
SINA_SYMBOL: dict[str, str] = {
    "a": "黄大豆1号期权",
    "b": "黄大豆2号期权",
    "m": "豆粕期权",
    "y": "豆油期权",
    "c": "玉米期权",
    "i": "铁矿石期权",
    "pg": "液化石油气期权",
    "eg": "乙二醇期权",
    "eb": "苯乙烯期权",
    "rb": "螺纹钢期权",
    "al": "沪铝期权",
    "cu": "沪铜期权",
    "au": "黄金期权",
    "ru": "橡胶期权",
    "sr": "白糖期权",
    "cf": "棉花期权",
    "ta": "PTA期权",
    "ma": "甲醇期权",
    "rm": "菜籽粕期权",
    "oi": "菜籽油期权",
    "pk": "花生期权",
    "zc": "动力煤期权",
    "sh": "烧碱期权",
    "br": "丁二烯橡胶期权",
}


def _parse_month_dte(contract: str) -> tuple[str | None, int | None]:
    m = re.search(r"(\d{2})(\d{2})$", contract.lower())
    if not m:
        return None, None
    yy, mm = int(m.group(1)), int(m.group(2))
    if not (1 <= mm <= 12):
        return None, None
    year = 2000 + yy
    expiry = f"{year:04d}-{mm:02d}-15"
    days = max(1, (date(year, mm, 15) - date.today()).days)
    return expiry, days


def fetch_sina_option_snapshot(cfg: CommodityUnderlying) -> dict[str, Any] | None:
    """Build IV / term / smile / chain from Sina live option tables."""
    symbol = SINA_SYMBOL.get(cfg.key) or cfg.ak_symbol
    try:
        import akshare as ak
    except ImportError:
        return None

    try:
        months = ak.option_commodity_contract_sina(symbol=symbol)
    except Exception:  # noqa: BLE001
        return None
    if months is None or getattr(months, "empty", True):
        return None

    contract_col = months.columns[1] if len(months.columns) > 1 else months.columns[0]
    contracts = [str(x).strip() for x in months[contract_col].tolist() if str(x).strip()]
    if not contracts:
        return None

    closes = fetch_futures_closes(cfg.futures_code)
    spot = float(closes.iloc[-1]) if closes is not None and not closes.empty else None

    term: list[dict[str, Any]] = []
    front_smile = None
    front_chain = None
    front_iv = None

    for i, contract in enumerate(contracts[:6]):
        try:
            table = ak.option_commodity_contract_table_sina(symbol=symbol, contract=contract)
        except Exception:  # noqa: BLE001
            continue
        if table is None or table.empty:
            continue

        expiry, dte = _parse_month_dte(contract)
        time_years = max((dte or 30) / 365.0, 1 / 365.0)

        # Estimate spot from deep ITM call intrinsic if missing
        local_spot = spot
        if local_spot is None:
            try:
                strikes = pd.to_numeric(table["行权价"], errors="coerce")
                call_px = pd.to_numeric(table["看涨合约-最新价"], errors="coerce")
                # deep ITM call ≈ F - K
                mask = call_px.notna() & strikes.notna() & (call_px > 5)
                if mask.any():
                    est = (call_px[mask] + strikes[mask]).median()
                    if np.isfinite(est) and est > 0:
                        local_spot = float(est)
            except Exception:  # noqa: BLE001
                local_spot = None
        if local_spot is None or local_spot <= 0:
            continue

        atm_ivs: list[float] = []
        chain_points: list[dict[str, Any]] = []
        smile_points: list[dict[str, Any]] = []

        for _, row in table.iterrows():
            strike = float(pd.to_numeric(row.get("行权价"), errors="coerce") or np.nan)
            if not np.isfinite(strike) or strike <= 0:
                continue
            call_px = float(pd.to_numeric(row.get("看涨合约-最新价"), errors="coerce") or np.nan)
            put_px = float(pd.to_numeric(row.get("看跌合约-最新价"), errors="coerce") or np.nan)
            call_oi = float(pd.to_numeric(row.get("看涨合约-持仓量"), errors="coerce") or 0)
            put_oi = float(pd.to_numeric(row.get("看跌合约-持仓量"), errors="coerce") or 0)
            if not np.isfinite(call_oi):
                call_oi = 0.0
            if not np.isfinite(put_oi):
                put_oi = 0.0

            call_iv = None
            put_iv = None
            if np.isfinite(call_px) and call_px > 0:
                call_iv = implied_volatility(call_px, local_spot, strike, time_years, "call", rate=0.0)
            if np.isfinite(put_px) and put_px > 0:
                put_iv = implied_volatility(put_px, local_spot, strike, time_years, "put", rate=0.0)

            mny = strike / local_spot
            if abs(mny - 1.0) <= 0.03:
                for v in (call_iv, put_iv):
                    if v is not None:
                        atm_ivs.append(v)

            if mny < 0.995 and put_iv is not None:
                otm_iv = put_iv
            elif mny > 1.005 and call_iv is not None:
                otm_iv = call_iv
            else:
                vals = [v for v in (call_iv, put_iv) if v is not None]
                otm_iv = float(np.mean(vals)) if vals else None

            chain_points.append({
                "strike": strike,
                "call_oi": call_oi,
                "put_oi": put_oi,
                "call_iv": call_iv,
                "put_iv": put_iv,
                "iv": otm_iv,
                "moneyness": round(mny, 6),
            })
            if otm_iv is not None and 0.85 <= mny <= 1.15:
                smile_points.append({
                    "strike": strike,
                    "iv": otm_iv,
                    "moneyness": round(mny, 6),
                    "call_oi": call_oi,
                    "put_oi": put_oi,
                })

        month_iv = float(np.median(atm_ivs)) if atm_ivs else None
        if month_iv is None and smile_points:
            month_iv = float(np.median([p["iv"] for p in smile_points]))
        if month_iv is None:
            continue

        term.append({
            "series": contract,
            "expiry_date": expiry,
            "days_to_expiry": dte,
            "iv": round(month_iv, 4),
            "volume": 0,
        })
        if front_iv is None:
            front_iv = month_iv
            if len(smile_points) >= 4:
                front_smile = {
                    "spot": round(local_spot, 4),
                    "expiry_date": expiry,
                    "days_to_expiry": dte,
                    "expiry_code": contract,
                    "points": smile_points,
                }
            if chain_points:
                front_chain = {
                    "spot": round(local_spot, 4),
                    "expiry_date": expiry,
                    "days_to_expiry": dte,
                    "expiry_code": contract,
                    "points": chain_points,
                }

        # Only need a few months for term structure
        if i >= 3 and len(term) >= 2:
            break

    if front_iv is None:
        return None

    term.sort(key=lambda x: int(x.get("days_to_expiry") or 10_000))
    # Align with exchange session date (previous weekday), not calendar today
    asof = date.today()
    while True:
        asof = asof.fromordinal(asof.toordinal() - 1)
        if asof.weekday() < 5:
            break
    return {
        "trade_date": asof.isoformat(),
        "iv": round(float(front_iv), 4),
        "term_structure": term,
        "spot": spot,
        "smile": front_smile,
        "smile_chain": front_chain,
        "source": "sina",
    }
