"""Deeper analysis helpers for commodity options (IV–RV, skew, PCR, term slope, vol cone)."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from commodity_config import UNDERLYINGS, CommodityUnderlying
from commodity_fetch import _norm_iv, _pick_col
from deeper_analysis import (
    build_iv_rv,
    build_pcr,
    build_skew,
    build_term_slope,
    build_vol_cone,
)


def fetch_futures_closes(futures_code: str, lookback_days: int = 800) -> pd.Series:
    """Load continuous futures closes from raw_akshare_futures_daily."""
    if not futures_code:
        return pd.Series(dtype=float)
    try:
        import os
        import psycopg2
    except ImportError:
        return pd.Series(dtype=float)

    url = os.environ.get("DATABASE_URL", "")
    if not url:
        return pd.Series(dtype=float)

    try:
        conn = psycopg2.connect(url)
        cur = conn.cursor()
        cur.execute(
            """
            SELECT trade_date, close
            FROM raw_akshare_futures_daily
            WHERE code = %s
              AND close IS NOT NULL
            ORDER BY trade_date
            """,
            (futures_code,),
        )
        rows = cur.fetchall()
        conn.close()
    except Exception:  # noqa: BLE001
        return pd.Series(dtype=float)

    if not rows:
        return pd.Series(dtype=float)

    dates: list[date] = []
    vals: list[float] = []
    for td, close in rows:
        d = td.date() if hasattr(td, "date") and not isinstance(td, date) else td
        if hasattr(d, "isoformat") and not isinstance(d, date):
            d = d.date() if hasattr(d, "date") else d
        try:
            vals.append(float(close))
            dates.append(d)
        except (TypeError, ValueError):
            continue

    series = pd.Series(vals, index=dates, dtype=float).sort_index()
    if lookback_days and len(series) > lookback_days:
        series = series.iloc[-lookback_days:]
    return series


def _parse_option_side(code: str) -> tuple[str | None, float | None, str | None]:
    """Return (expiry_key, strike, side) from commodity option codes."""
    raw = code.replace("-", "").upper()
    # CZCE: SR609C4600 / TAC609 / MA609P2450
    m = re.search(r"([A-Z]{1,2})(\d{3,4})([CP])(\d+(?:\.\d+)?)", raw)
    if m:
        return f"{m.group(1).lower()}{m.group(2)}", float(m.group(4)), m.group(3).lower()
    # DCE-like: M2509C3200
    m = re.search(r"([A-Z]+)(\d{4})([CP])(\d+(?:\.\d+)?)", raw)
    if m:
        return f"{m.group(1).lower()}{m.group(2)}", float(m.group(4)), m.group(3).lower()
    return None, None, None


def _expiry_meta(exp_key: str) -> tuple[str | None, int | None]:
    m = re.search(r"(\d{3,4})$", exp_key)
    if not m:
        return None, None
    token = m.group(1)
    if len(token) == 3:
        yy, mm = int(token[0]), int(token[1:])
        year = 2020 + yy
    else:
        yy, mm = int(token[:2]), int(token[2:])
        year = 2000 + yy
    if not (1 <= mm <= 12):
        return None, None
    expiry = f"{year:04d}-{mm:02d}-15"
    days = max(1, (date(year, mm, 15) - date.today()).days)
    return expiry, days


def build_smile_and_chain_from_hist(
    df: pd.DataFrame,
    spot: float | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Build near-month OTM smile + chain OI tables from exchange option hist.

    SHFE daily bulletins omit IV — settle prices are inverted via Black-76/BS
    (futures as forward, r≈0) when needed. PCR chain can still be built from OI alone.
    """
    if df is None or df.empty:
        return None, None

    from iv_analysis.iv_calc import implied_volatility

    code_col = _pick_col(df, "合约代码", "合约", "合约名称") or df.columns[0]
    iv_col = _pick_col(df, "隐含波动率", "隐含波动率(%)")
    oi_col = _pick_col(df, "持仓量")
    vol_col = _pick_col(df, "成交量", "成交量(手)")
    settle_col = _pick_col(df, "结算价", "今结算", "收盘价")

    rows: list[dict[str, Any]] = []
    for _, r in df.iterrows():
        code = str(r.get(code_col, ""))
        exp, strike, side = _parse_option_side(code)
        if exp is None or strike is None or side is None:
            continue
        iv = _norm_iv(r.get(iv_col)) if iv_col else None
        oi = float(pd.to_numeric(r.get(oi_col), errors="coerce") or 0) if oi_col else 0.0
        vol = float(pd.to_numeric(r.get(vol_col), errors="coerce") or 0) if vol_col else 0.0
        settle = float(pd.to_numeric(r.get(settle_col), errors="coerce") or np.nan) if settle_col else np.nan
        rows.append({
            "exp": exp,
            "strike": float(strike),
            "side": side,
            "iv": iv,
            "oi": oi,
            "volume": vol,
            "settle": settle if np.isfinite(settle) else None,
        })
    if not rows:
        return None, None

    work = pd.DataFrame(rows)
    # Prefer expiry with most OI / volume
    exp_stats = work.groupby("exp").agg(oi=("oi", "sum"), volume=("volume", "sum"), n=("strike", "count"))
    exp_stats["score"] = exp_stats["oi"] * 10 + exp_stats["volume"] + exp_stats["n"]
    exp_key = str(exp_stats["score"].idxmax())
    slice_df = work[work["exp"] == exp_key].copy()
    expiry_date, dte = _expiry_meta(exp_key)
    time_years = max((dte or 30) / 365.0, 1 / 365.0)

    # Spot / forward estimate
    if spot is None or not np.isfinite(spot) or spot <= 0:
        liquid = slice_df.sort_values("oi", ascending=False).head(20)
        spot = float(liquid["strike"].median()) if len(liquid) else float(slice_df["strike"].median())

    # Back out missing IVs from settlement premiums (SHFE)
    if slice_df["iv"].isna().all() or slice_df["iv"].isna().mean() > 0.5:
        computed: list[float | None] = []
        for row in slice_df.itertuples():
            if row.iv is not None and np.isfinite(row.iv):
                computed.append(float(row.iv))
                continue
            if row.settle is None or spot is None:
                computed.append(None)
                continue
            opt_type = "call" if row.side == "c" else "put"
            # Commodity options: treat futures price as forward, r≈0 (Black-76 style)
            iv = implied_volatility(
                float(row.settle),
                float(spot),
                float(row.strike),
                time_years,
                opt_type,
                rate=0.0,
            )
            computed.append(iv)
        slice_df = slice_df.copy()
        slice_df["iv"] = computed

    # Chain by strike
    by_strike: dict[float, dict[str, Any]] = {}
    for row in slice_df.itertuples():
        bucket = by_strike.setdefault(float(row.strike), {
            "strike": float(row.strike),
            "call_iv": None,
            "put_iv": None,
            "call_oi": 0.0,
            "put_oi": 0.0,
            "iv": None,
            "moneyness": None,
        })
        if row.side == "c":
            if row.iv is not None and np.isfinite(row.iv):
                bucket["call_iv"] = float(row.iv)
            bucket["call_oi"] = float(row.oi)
        else:
            if row.iv is not None and np.isfinite(row.iv):
                bucket["put_iv"] = float(row.iv)
            bucket["put_oi"] = float(row.oi)

    chain_points: list[dict[str, Any]] = []
    smile_points: list[dict[str, Any]] = []
    for strike, b in sorted(by_strike.items()):
        mny = strike / spot if spot else None
        if mny is not None and mny < 0.995 and b["put_iv"] is not None:
            otm_iv = b["put_iv"]
        elif mny is not None and mny > 1.005 and b["call_iv"] is not None:
            otm_iv = b["call_iv"]
        else:
            vals = [v for v in (b["call_iv"], b["put_iv"]) if v is not None]
            otm_iv = float(np.mean(vals)) if vals else None
        b["iv"] = otm_iv
        b["moneyness"] = round(mny, 6) if mny is not None else None
        chain_points.append({
            "strike": strike,
            "call_oi": b["call_oi"],
            "put_oi": b["put_oi"],
            "call_iv": b["call_iv"],
            "put_iv": b["put_iv"],
            "iv": otm_iv,
            "moneyness": b["moneyness"],
        })
        if otm_iv is not None and mny is not None and 0.85 <= mny <= 1.15:
            smile_points.append({
                "strike": strike,
                "iv": otm_iv,
                "moneyness": b["moneyness"],
                "call_oi": b["call_oi"],
                "put_oi": b["put_oi"],
            })

    chain = {
        "spot": round(float(spot), 4) if spot else None,
        "expiry_date": expiry_date,
        "days_to_expiry": dte,
        "expiry_code": exp_key,
        "points": chain_points,
    } if chain_points else None

    smile = None
    if len(smile_points) >= 4 and spot:
        smile = {
            "spot": round(float(spot), 4),
            "expiry_date": expiry_date,
            "days_to_expiry": dte,
            "expiry_code": exp_key,
            "points": smile_points,
        }

    return smile, chain


def attach_commodity_deeper_charts(
    charts: dict[str, Any],
    cfg: CommodityUnderlying,
    current_iv: float | None,
    hist_df: pd.DataFrame | None = None,
    spot: float | None = None,
    *,
    min_iv_rv_points: int = 1,
) -> dict[str, Any]:
    """Attach deeper-analysis blocks for a commodity underlying."""
    smile = charts.get("smile")
    chain = charts.get("smile_chain")

    if (not isinstance(smile, dict) or not isinstance(chain, dict)) and hist_df is not None:
        built_smile, built_chain = build_smile_and_chain_from_hist(hist_df, spot)
        if built_smile and not isinstance(smile, dict):
            charts["smile"] = built_smile
            smile = built_smile
        if built_chain and not isinstance(chain, dict):
            charts["smile_chain"] = built_chain
            chain = built_chain

    charts["skew"] = build_skew(smile if isinstance(smile, dict) else None)
    charts["pcr"] = build_pcr(chain if isinstance(chain, dict) else None)
    charts["term_slope"] = build_term_slope(
        charts.get("term_structure") if isinstance(charts.get("term_structure"), list) else None
    )

    history = charts.get("history")
    asof = None
    if isinstance(history, list) and history:
        asof = str(history[-1].get("trade_date") or "")[:10]

    skew = charts.get("skew")
    if isinstance(skew, dict) and not skew.get("series") and asof and skew.get("risk_reversal") is not None:
        skew["series"] = [{
            "trade_date": asof,
            "risk_reversal": skew.get("risk_reversal"),
            "butterfly": skew.get("butterfly"),
            "put_wing_5pct": skew.get("put_wing_5pct"),
            "call_wing_5pct": skew.get("call_wing_5pct"),
        }]
        charts["skew"] = skew

    pcr = charts.get("pcr")
    if isinstance(pcr, dict) and not pcr.get("series") and asof and pcr.get("pcr_oi") is not None:
        pcr["series"] = [{"trade_date": asof, "pcr_oi": pcr.get("pcr_oi")}]
        charts["pcr"] = pcr

    term_slope = charts.get("term_slope")
    if isinstance(term_slope, dict) and not term_slope.get("series") and asof and term_slope.get("slope") is not None:
        term_slope["series"] = [{"trade_date": asof, "slope": term_slope.get("slope")}]
        charts["term_slope"] = term_slope

    closes = fetch_futures_closes(cfg.futures_code)
    hist_list = history if isinstance(history, list) else None
    iv_rv = build_iv_rv(hist_list, closes)
    # Commodity IV history may still be short; accept thinner samples.
    if iv_rv is None and hist_list and closes is not None and not closes.empty:
        iv_rv = _build_iv_rv_short(hist_list, closes, min_points=min_iv_rv_points)
    charts["iv_rv"] = iv_rv
    charts["vol_cone"] = build_vol_cone(closes, current_iv)
    return charts


def _build_iv_rv_short(
    qvix_history: list[dict],
    closes: pd.Series,
    *,
    min_points: int = 1,
) -> dict[str, Any] | None:
    """Like build_iv_rv but with a lower minimum length for early commodity samples."""
    full = build_iv_rv(qvix_history, closes)
    if full is not None:
        return full

    from deeper_analysis import _rolling_rv, _safe_float

    rv20 = _rolling_rv(closes, 20)
    rv60 = _rolling_rv(closes, 60)
    if rv20.empty and rv60.empty:
        return None

    rows: list[dict] = []
    for p in qvix_history:
        td = str(p.get("trade_date") or "")[:10]
        iv = _safe_float(p.get("iv"))
        if not td or iv is None:
            continue
        try:
            d = date.fromisoformat(td)
        except ValueError:
            continue
        r20 = _safe_float(rv20.get(d)) if d in rv20.index else None
        r60 = _safe_float(rv60.get(d)) if d in rv60.index else None
        if r20 is None and not rv20.empty:
            prior = rv20.loc[:d]
            if not prior.empty and (d - prior.index[-1]).days <= 5:
                r20 = _safe_float(prior.iloc[-1])
        if r60 is None and not rv60.empty:
            prior = rv60.loc[:d]
            if not prior.empty and (d - prior.index[-1]).days <= 5:
                r60 = _safe_float(prior.iloc[-1])
        rows.append({
            "trade_date": td,
            "iv": round(iv, 4),
            "rv_20": round(r20, 4) if r20 is not None else None,
            "rv_60": round(r60, 4) if r60 is not None else None,
            "iv_rv_20": round(iv - r20, 4) if r20 is not None else None,
            "iv_rv_60": round(iv - r60, 4) if r60 is not None else None,
        })

    if len(rows) < min_points:
        return None
    latest = rows[-1]
    return {
        "latest_iv": latest.get("iv"),
        "latest_rv_20": latest.get("rv_20"),
        "latest_rv_60": latest.get("rv_60"),
        "latest_iv_rv_20": latest.get("iv_rv_20"),
        "latest_iv_rv_60": latest.get("iv_rv_60"),
        "series": rows,
    }
