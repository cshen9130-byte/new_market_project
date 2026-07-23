"""Deeper option IV analysis: IV–RV, skew, PCR, term slope, vol cone."""

from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Any

import numpy as np
import pandas as pd

from config import UNDERLYINGS

# Index / ETF spot symbols for price history (AkShare eastmoney index / fund APIs).
SPOT_HISTORY_SYMBOL: dict[str, str] = {
    "50etf": "sh510050",
    "300etf": "sh510300",
    "500etf": "sh510500",
    "cyb": "sz159915",
    "kcb": "sh588000",
    "kcb_efund": "sh588080",
    "100etf": "sz159901",
    "300etf_sz": "sz159919",
    "500etf_sz": "sz159922",
    "50index": "sh000016",
    "300index": "sh000300",
    "1000index": "sh000852",
}

_INDEX_KEYS = frozenset({"50index", "300index", "1000index"})
_INDEX_DB_SYMBOL: dict[str, tuple[str, ...]] = {
    "50index": ("IH", "000016.SH", "sh000016"),
    "300index": ("IF", "000300.SH", "sh000300"),
    "1000index": ("IM", "000852.SH", "sh000852"),
}
_close_cache: dict[str, pd.Series] = {}


def _closes_from_db(key: str) -> pd.Series:
    """Prefer DB spot/index closes when available (SSH tunnel / local DATABASE_URL)."""
    if key not in _INDEX_DB_SYMBOL:
        return pd.Series(dtype=float)
    try:
        import os
        import psycopg2
    except ImportError:
        return pd.Series(dtype=float)

    url = os.environ.get("DATABASE_URL", "")
    if not url:
        return pd.Series(dtype=float)

    symbols = _INDEX_DB_SYMBOL[key]
    try:
        conn = psycopg2.connect(url)
        cur = conn.cursor()
        # raw_spot_daily: IH/IF/IM
        cur.execute(
            """
            SELECT trade_date, close
            FROM raw_spot_daily
            WHERE symbol = ANY(%s)
            ORDER BY trade_date
            """,
            (list(symbols),),
        )
        rows = cur.fetchall()
        if not rows:
            cur.execute(
                """
                SELECT trade_date, close
                FROM raw_ashare_index_daily
                WHERE ts_code = ANY(%s)
                ORDER BY trade_date
                """,
                (list(symbols),),
            )
            rows = cur.fetchall()
        conn.close()
        if not rows:
            return pd.Series(dtype=float)
        idx = [r[0] if not hasattr(r[0], "date") else r[0] for r in rows]
        # normalize to date
        dates = []
        vals = []
        for r in rows:
            d = r[0]
            if hasattr(d, "isoformat"):
                d = d if not hasattr(d, "date") else (d if isinstance(d, date) else d.date())
            dates.append(d)
            vals.append(float(r[1]))
        return pd.Series(vals, index=dates, dtype=float).sort_index()
    except Exception:  # noqa: BLE001
        return pd.Series(dtype=float)


def fetch_underlying_closes(key: str, lookback_days: int = 800) -> pd.Series:
    """Daily close series indexed by date. Cached per process."""
    if key in _close_cache:
        return _close_cache[key]

    # DB first for index underlyings (more reliable than public EM API).
    if key in _INDEX_KEYS:
        db_series = _closes_from_db(key)
        if len(db_series) >= 80:
            _close_cache[key] = db_series
            return db_series

    symbol = SPOT_HISTORY_SYMBOL.get(key) or (UNDERLYINGS.get(key).spot_symbol if key in UNDERLYINGS else None)
    if not symbol:
        _close_cache[key] = pd.Series(dtype=float)
        return _close_cache[key]

    end = date.today()
    start = end - timedelta(days=lookback_days)
    series = pd.Series(dtype=float)

    try:
        import akshare as ak

        last_error: Exception | None = None
        for attempt in range(3):
            try:
                if key in _INDEX_KEYS or symbol.startswith("sh000") or symbol.startswith("sz399"):
                    df = ak.stock_zh_index_daily_em(symbol=symbol)
                    date_col = "date"
                    close_col = "close"
                else:
                    # ETF: try eastmoney fund hist with bare code
                    code = symbol[2:] if len(symbol) > 2 and symbol[:2] in ("sh", "sz") else symbol
                    try:
                        df = ak.fund_etf_hist_em(symbol=code, period="daily", adjust="qfq")
                        date_col = "日期"
                        close_col = "收盘"
                    except Exception:
                        df = ak.fund_etf_hist_sina(symbol=symbol)
                        date_col = "date"
                        close_col = "close"

                df = df.copy()
                df["_dt"] = pd.to_datetime(df[date_col], errors="coerce").dt.date
                df["_close"] = pd.to_numeric(df[close_col], errors="coerce")
                mask = (df["_dt"] >= start) & (df["_dt"] <= end)
                out = df.loc[mask, ["_dt", "_close"]].dropna()
                series = out.set_index("_dt")["_close"].sort_index()
                last_error = None
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                time.sleep(0.8 * (attempt + 1))
        if last_error and series.empty:
            pass
    except Exception:  # noqa: BLE001
        series = pd.Series(dtype=float)

    if series.empty and key in _INDEX_KEYS:
        series = _closes_from_db(key)

    _close_cache[key] = series
    return series


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(f):
        return None
    return f


def _interp_iv_at_moneyness(points: list[dict], spot: float, moneyness: float) -> float | None:
    """Linear interpolate OTM smile IV at strike = spot * moneyness."""
    if not points or spot is None or spot <= 0:
        return None
    target = spot * moneyness
    rows = []
    for p in points:
        strike = _safe_float(p.get("strike"))
        iv = _safe_float(p.get("iv"))
        if strike is None or iv is None or iv <= 0:
            continue
        rows.append((strike, iv))
    if len(rows) < 2:
        return None
    rows.sort(key=lambda x: x[0])
    strikes = np.array([r[0] for r in rows], dtype=float)
    ivs = np.array([r[1] for r in rows], dtype=float)
    if target < strikes[0] or target > strikes[-1]:
        # clamp to nearest wing
        idx = 0 if abs(target - strikes[0]) <= abs(target - strikes[-1]) else -1
        return float(ivs[idx])
    return float(np.interp(target, strikes, ivs))


def build_skew(smile: dict | None) -> dict | None:
    """Snapshot skew from OTM smile: ±5% wings and risk reversal."""
    if not smile:
        return None
    spot = _safe_float(smile.get("spot"))
    points = smile.get("points") or []
    if spot is None or spot <= 0 or len(points) < 4:
        return None

    put_wing = _interp_iv_at_moneyness(points, spot, 0.95)  # downside
    call_wing = _interp_iv_at_moneyness(points, spot, 1.05)
    atm = _interp_iv_at_moneyness(points, spot, 1.00)
    if put_wing is None or call_wing is None:
        return None

    rr = put_wing - call_wing
    fly = None
    if atm is not None:
        fly = 0.5 * (put_wing + call_wing) - atm

    return {
        "expiry_code": smile.get("expiry_code"),
        "expiry_date": smile.get("expiry_date"),
        "days_to_expiry": smile.get("days_to_expiry"),
        "spot": spot,
        "put_wing_5pct": round(put_wing, 4),
        "call_wing_5pct": round(call_wing, 4),
        "atm_iv": round(atm, 4) if atm is not None else None,
        "risk_reversal": round(rr, 4),
        "butterfly": round(fly, 4) if fly is not None else None,
        "metrics": [
            {"key": "put_wing", "label": "Put翼 (−5%)", "value": round(put_wing, 2)},
            {"key": "atm", "label": "ATM", "value": round(atm, 2) if atm is not None else None},
            {"key": "call_wing", "label": "Call翼 (+5%)", "value": round(call_wing, 2)},
            {"key": "rr", "label": "Risk Reversal", "value": round(rr, 2)},
            {"key": "fly", "label": "Butterfly", "value": round(fly, 2) if fly is not None else None},
        ],
    }


def build_pcr(smile_chain: dict | None) -> dict | None:
    """Put/call open interest ratio from near-month chain."""
    if not smile_chain:
        return None
    points = smile_chain.get("points") or []
    if not points:
        return None

    put_oi = 0.0
    call_oi = 0.0
    by_strike: list[dict] = []
    for p in points:
        strike = _safe_float(p.get("strike"))
        c_oi = _safe_float(p.get("call_oi")) or 0.0
        p_oi = _safe_float(p.get("put_oi")) or 0.0
        put_oi += p_oi
        call_oi += c_oi
        if strike is not None:
            by_strike.append({
                "strike": strike,
                "call_oi": c_oi,
                "put_oi": p_oi,
                "pcr": (p_oi / c_oi) if c_oi > 0 else None,
            })

    if put_oi <= 0 and call_oi <= 0:
        return None

    return {
        "expiry_code": smile_chain.get("expiry_code"),
        "expiry_date": smile_chain.get("expiry_date"),
        "days_to_expiry": smile_chain.get("days_to_expiry"),
        "put_oi": round(put_oi, 2),
        "call_oi": round(call_oi, 2),
        "pcr_oi": round(put_oi / call_oi, 4) if call_oi > 0 else None,
        "by_strike": by_strike,
    }


def build_term_slope(term_structure: list[dict] | None) -> dict | None:
    """Near vs far ATM IV slope from current term structure."""
    if not term_structure or len(term_structure) < 2:
        return None
    rows = []
    for p in term_structure:
        dte = _safe_float(p.get("days_to_expiry"))
        iv = _safe_float(p.get("iv"))
        if dte is None or iv is None or dte < 0:
            continue
        rows.append({
            "days_to_expiry": dte,
            "iv": iv,
            "expiry_date": str(p.get("expiry_date") or "")[:10],
        })
    if len(rows) < 2:
        return None
    rows.sort(key=lambda r: r["days_to_expiry"])
    near = rows[0]
    far = rows[-1]
    slope = far["iv"] - near["iv"]
    # per 30 DTE normalized slope when span is meaningful
    span = far["days_to_expiry"] - near["days_to_expiry"]
    slope_per_30d = (slope / span * 30.0) if span > 0 else None

    return {
        "near_dte": near["days_to_expiry"],
        "far_dte": far["days_to_expiry"],
        "near_iv": round(near["iv"], 4),
        "far_iv": round(far["iv"], 4),
        "near_expiry": near["expiry_date"],
        "far_expiry": far["expiry_date"],
        "slope": round(slope, 4),
        "slope_per_30d": round(slope_per_30d, 4) if slope_per_30d is not None else None,
        "regime": "backwardation" if slope < -0.5 else ("steep_contango" if slope > 2.0 else "contango"),
        "points": [{
            "days_to_expiry": r["days_to_expiry"],
            "iv": round(r["iv"], 4),
            "expiry_date": r["expiry_date"],
        } for r in rows],
    }


def _rolling_rv(closes: pd.Series, window: int) -> pd.Series:
    """Annualized realized vol (%) from log returns."""
    if closes is None or len(closes) < window + 2:
        return pd.Series(dtype=float)
    rets = np.log(closes / closes.shift(1))
    rv = rets.rolling(window, min_periods=max(10, window // 2)).std() * np.sqrt(252) * 100.0
    return rv


def build_iv_rv(qvix_history: list[dict] | None, closes: pd.Series) -> dict | None:
    """Align QVIX IV with 20D/60D realized vol."""
    if not qvix_history or closes is None or closes.empty:
        return None

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
        # nearest prior close date within 5 days if exact miss
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

    if len(rows) < 30:
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


def build_vol_cone(closes: pd.Series, current_iv: float | None) -> dict | None:
    """Realized-vol cone across windows with percentile bands + current RV/IV markers."""
    if closes is None or len(closes) < 80:
        return None

    windows = [10, 20, 40, 60, 120]
    cone: list[dict] = []
    for w in windows:
        rv = _rolling_rv(closes, w).dropna()
        if len(rv) < 40:
            continue
        current_rv = _safe_float(rv.iloc[-1])
        cone.append({
            "window": w,
            "p5": round(float(np.nanpercentile(rv, 5)), 4),
            "p25": round(float(np.nanpercentile(rv, 25)), 4),
            "p50": round(float(np.nanpercentile(rv, 50)), 4),
            "p75": round(float(np.nanpercentile(rv, 75)), 4),
            "p95": round(float(np.nanpercentile(rv, 95)), 4),
            "current_rv": round(current_rv, 4) if current_rv is not None else None,
            "current_iv": round(current_iv, 4) if current_iv is not None and np.isfinite(current_iv) else None,
        })

    if not cone:
        return None
    return {"windows": [c["window"] for c in cone], "bands": cone}


def attach_deeper_charts(
    charts: dict[str, Any],
    key: str,
    current_iv: float | None,
    fetch_prices: bool = True,
) -> dict[str, Any]:
    """Mutate/return charts dict with deeper-analysis blocks."""
    smile = charts.get("smile")
    chain = charts.get("smile_chain")
    term = charts.get("term_structure")
    history = charts.get("history")

    charts["skew"] = build_skew(smile if isinstance(smile, dict) else None)
    charts["pcr"] = build_pcr(chain if isinstance(chain, dict) else None)
    charts["term_slope"] = build_term_slope(term if isinstance(term, list) else None)

    # Seed 1-day history series from today's snapshot so charts aren't blank
    # before multi-day ETL accumulation.
    skew = charts.get("skew")
    if isinstance(skew, dict) and not skew.get("series"):
        asof = None
        if isinstance(history, list) and history:
            asof = str(history[-1].get("trade_date") or "")[:10]
        if asof and skew.get("risk_reversal") is not None:
            skew["series"] = [{
                "trade_date": asof,
                "risk_reversal": skew.get("risk_reversal"),
                "butterfly": skew.get("butterfly"),
                "put_wing_5pct": skew.get("put_wing_5pct"),
                "call_wing_5pct": skew.get("call_wing_5pct"),
            }]
            charts["skew"] = skew

    pcr = charts.get("pcr")
    if isinstance(pcr, dict) and not pcr.get("series") and pcr.get("pcr_oi") is not None:
        asof = None
        if isinstance(history, list) and history:
            asof = str(history[-1].get("trade_date") or "")[:10]
        if asof:
            pcr["series"] = [{"trade_date": asof, "pcr_oi": pcr.get("pcr_oi")}]
            charts["pcr"] = pcr

    term_slope = charts.get("term_slope")
    if isinstance(term_slope, dict) and not term_slope.get("series") and term_slope.get("slope") is not None:
        asof = None
        if isinstance(history, list) and history:
            asof = str(history[-1].get("trade_date") or "")[:10]
        if asof:
            term_slope["series"] = [{"trade_date": asof, "slope": term_slope.get("slope")}]
            charts["term_slope"] = term_slope

    closes = fetch_underlying_closes(key) if fetch_prices else pd.Series(dtype=float)
    hist_list = history if isinstance(history, list) else None
    charts["iv_rv"] = build_iv_rv(hist_list, closes)
    charts["vol_cone"] = build_vol_cone(closes, current_iv)
    return charts
