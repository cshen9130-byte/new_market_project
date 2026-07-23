"""Serialize option IV chart data to JSON-friendly structures."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd
from scipy.interpolate import griddata

from config import UNDERLYINGS
from iv_analysis.charts.percentile import _percentile_rank
from iv_analysis.charts.smile import (
    _select_smile_expiry,
    _select_smile_slice,
)
from iv_analysis.charts.smile_chain import (
    _build_chain_table,
    _select_chain_expiry,
)
from iv_analysis.charts.term_structure import _atm_by_expiry
from iv_analysis.data import filter_underlying


GROUPS: list[tuple[str, list[str]]] = [
    ("科创50 ETF期权", ["kcb", "kcb_efund"]),
    ("创业板 ETF期权", ["cyb"]),
    ("深证100 ETF期权", ["100etf"]),
    ("中证500 ETF期权", ["500etf", "500etf_sz"]),
    ("中证1000 股指期权", ["1000index"]),
    ("沪深300 股指/ETF期权", ["300index", "300etf", "300etf_sz"]),
    ("上证50 ETF/股指期权", ["50etf", "50index"]),
]

KEY_TO_GROUP = {k: g for g, keys in GROUPS for k in keys}

SHORT_LABELS: dict[str, str] = {
    "50etf": "50ETF (510050)",
    "50index": "50股指 (HO)",
    "300etf": "300ETF (510300)",
    "300etf_sz": "300ETF (159919)",
    "300index": "300股指 (IO)",
    "500etf": "500ETF (510500)",
    "500etf_sz": "500ETF (159922)",
    "1000index": "1000股指 (MO)",
    "cyb": "创业板ETF",
    "kcb": "科创50 (588000)",
    "kcb_efund": "科创50 (588080)",
    "100etf": "深证100ETF",
}

HISTORY_DAYS = 504
PERCENTILE_DAYS = 1260


def latest_trade_date() -> date:
    """Previous trading day (matches nightly_etl.latest_trade_date)."""
    today = date.today()
    wd = today.weekday()
    if wd == 0:
        return today - timedelta(days=3)
    if wd == 5:
        return today - timedelta(days=1)
    if wd == 6:
        return today - timedelta(days=2)
    return today - timedelta(days=1)


def extend_qvix_with_snapshot(
    qvix: pd.DataFrame,
    snapshot_iv: float | None,
    as_of: date | None = None,
) -> pd.DataFrame:
    """Append live ATM IV when the official QVIX feed is stale (common for MO/IO/HO)."""
    if snapshot_iv is None or not np.isfinite(snapshot_iv) or snapshot_iv <= 0:
        return qvix

    target = as_of or latest_trade_date()
    if qvix.empty:
        return pd.DataFrame([{
            "trade_date": pd.Timestamp(target),
            "iv": float(snapshot_iv),
            "open": float(snapshot_iv),
            "high": float(snapshot_iv),
            "low": float(snapshot_iv),
        }])

    out = qvix.sort_values("trade_date").copy()
    last = pd.Timestamp(out.iloc[-1]["trade_date"]).date()
    if last >= target:
        return out

    extra = {
        "trade_date": pd.Timestamp(target),
        "iv": float(snapshot_iv),
        "open": float(snapshot_iv),
        "high": float(snapshot_iv),
        "low": float(snapshot_iv),
    }
    for col in ("underlying_key", "underlying_label"):
        if col in out.columns:
            extra[col] = out.iloc[-1][col]
    return pd.concat([out, pd.DataFrame([extra])], ignore_index=True)


def _is_flat_snapshot_row(row: pd.Series) -> bool:
    iv = pd.to_numeric(row.get("iv"), errors="coerce")
    if not np.isfinite(iv):
        return False
    for col in ("open", "high", "low"):
        val = pd.to_numeric(row.get(col), errors="coerce")
        if not np.isfinite(val) or abs(val - iv) > 1e-6:
            return False
    return True


def official_qvix_only(qvix: pd.DataFrame) -> pd.DataFrame:
    """Drop snapshot-synthesized QVIX rows used to extend stale index feeds."""
    if qvix.empty:
        return qvix
    out = qvix.sort_values("trade_date").reset_index(drop=True)
    while len(out) >= 2:
        last = out.iloc[-1]
        prev = out.iloc[-2]
        if not _is_flat_snapshot_row(last):
            break
        gap = (pd.Timestamp(last["trade_date"]) - pd.Timestamp(prev["trade_date"])).days
        if gap > 10:
            out = out.iloc[:-1].reset_index(drop=True)
            continue
        break
    return out


def apply_qvix_charts(payload: dict[str, Any], qvix: pd.DataFrame) -> dict[str, Any]:
    """Rebuild history / percentile chart blocks from a QVIX dataframe."""
    saved_iv = payload.get("current_iv")
    charts = dict(payload.get("charts") or {})
    charts["history"] = build_history(qvix)
    pct = build_percentile_with_current(official_qvix_only(qvix), current_iv=saved_iv)
    charts["percentile"] = pct
    payload["charts"] = charts
    if pct:
        payload["percentile_all"] = pct.get("percentile_all")
        payload["percentile_1y"] = pct.get("percentile_1y")
    if saved_iv is not None:
        payload["current_iv"] = saved_iv
    return payload


def _percentile_summary(pcts: list[float]) -> tuple[str | None, float | None]:
    """Format group percentile for the overview table (range when products diverge)."""
    if not pcts:
        return None, None
    lo, hi = min(pcts), max(pcts)
    if hi - lo < 5:
        val = round(lo, 1)
        return f"约 {val:.0f}%", val
    return f"{lo:.0f}% - {hi:.0f}%", round(hi, 1)


def _safe_float(v: Any) -> float | None:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _df_records(df: pd.DataFrame, cols: list[str]) -> list[dict]:
    if df.empty:
        return []
    out = df[cols].copy()
    for col in out.columns:
        if col == "trade_date" or pd.api.types.is_datetime64_any_dtype(out[col]):
            out[col] = pd.to_datetime(out[col], errors="coerce").dt.strftime("%Y-%m-%d")
    return out.replace({np.nan: None}).to_dict(orient="records")


def _term_structure_df(udf: pd.DataFrame, em_udf: pd.DataFrame | None = None) -> pd.DataFrame:
    """Merge EM + chain: prefer exchange IV per expiry, keep chain-only expiries (weeklies)."""
    if em_udf is None or em_udf.empty:
        return udf
    if udf.empty:
        return em_udf

    em_expiries = pd.to_datetime(em_udf["expiry_date"], errors="coerce")
    chain_expiries = pd.to_datetime(udf["expiry_date"], errors="coerce")
    all_expiries = sorted(set(em_expiries.dropna()) | set(chain_expiries.dropna()))

    parts: list[pd.DataFrame] = []
    for expiry in all_expiries:
        em_rows = em_udf[pd.to_datetime(em_udf["expiry_date"], errors="coerce") == expiry]
        if not em_rows.empty:
            parts.append(em_rows)
            continue
        chain_rows = udf[pd.to_datetime(udf["expiry_date"], errors="coerce") == expiry]
        if not chain_rows.empty:
            parts.append(chain_rows)

    return pd.concat(parts, ignore_index=True) if parts else udf


def _em_expiry_dates(em_udf: pd.DataFrame | None) -> set[pd.Timestamp]:
    if em_udf is None or em_udf.empty:
        return set()
    return set(pd.to_datetime(em_udf["expiry_date"], errors="coerce").dropna())


def build_term_structure(udf: pd.DataFrame, em_udf: pd.DataFrame | None = None) -> list[dict] | None:
    src = _term_structure_df(udf, em_udf)
    atm = _atm_by_expiry(src)
    if atm.empty:
        return None

    em_expiries = _em_expiry_dates(em_udf)
    if len(atm) > 1:
        keep: list[bool] = []
        for row in atm.itertuples():
            dte = float(row.days_to_expiry)
            expiry = pd.to_datetime(row.expiry_date)
            if dte > 0:
                keep.append(True)
            else:
                # Keep same-day EM IV; drop unreliable chain-only 0DTE recalc.
                keep.append(expiry in em_expiries)
        atm = atm.loc[keep]

    if atm.empty:
        return None
    return _df_records(
        atm,
        ["days_to_expiry", "iv", "expiry_date", "strike", "moneyness"],
    )


def build_smile(udf: pd.DataFrame) -> dict | None:
    selected = _select_smile_expiry(udf, "otm")
    if selected is None:
        return None
    expiry, expiry_df, spot = selected
    slice_df = _select_smile_slice(expiry_df, "otm", spot)
    if slice_df.empty:
        return None
    days = int(expiry_df["days_to_expiry"].min())
    return {
        "spot": spot,
        "expiry_date": expiry.strftime("%Y-%m-%d"),
        "days_to_expiry": days,
        "expiry_code": expiry.strftime("%y%m"),
        "points": _df_records(slice_df, ["strike", "iv", "option_type", "last_price"]),
    }


def build_smile_chain(udf: pd.DataFrame) -> dict | None:
    selected = _select_chain_expiry(udf)
    if selected is None:
        return None
    expiry, expiry_df, spot = selected
    table = _build_chain_table(expiry_df, spot)
    if table.empty or len(table) < 2:
        return None
    days = int(expiry_df["days_to_expiry"].min())
    return {
        "spot": spot,
        "expiry_date": expiry.strftime("%Y-%m-%d"),
        "days_to_expiry": days,
        "expiry_code": expiry.strftime("%y%m"),
        "points": _df_records(
            table,
            ["strike", "iv", "call_iv", "put_iv", "call_oi", "put_oi"],
        ),
    }


def build_surface(udf: pd.DataFrame) -> dict | None:
    valid = udf.dropna(subset=["iv", "strike", "days_to_expiry"]).copy()
    valid = valid[valid["days_to_expiry"] >= 0]
    if len(valid) < 10:
        return None

    x = valid["strike"].values.astype(float)
    y = valid["days_to_expiry"].values.astype(float)
    z = valid["iv"].values.astype(float)

    xi = np.linspace(x.min(), x.max(), 30)
    yi = np.linspace(y.min(), y.max(), 30)
    xi_grid, yi_grid = np.meshgrid(xi, yi)
    zi = griddata((x, y), z, (xi_grid, yi_grid), method="linear")

    heatmap: list[list[float | None]] = []
    for j in range(len(yi)):
        row: list[float | None] = []
        for i in range(len(xi)):
            val = _safe_float(zi[j, i])
            row.append(val)
        heatmap.append(row)

    return {
        "strikes": [round(float(v), 4) for v in xi],
        "days_to_expiry": [int(round(float(v))) for v in yi],
        "heatmap": heatmap,
        "scatter": [
            {
                "strike": _safe_float(r.strike),
                "days_to_expiry": _safe_float(r.days_to_expiry),
                "iv": _safe_float(r.iv),
            }
            for r in valid.itertuples()
        ],
    }


def build_history(qvix: pd.DataFrame) -> list[dict] | None:
    if qvix.empty:
        return None
    df = qvix.sort_values("trade_date").tail(HISTORY_DAYS)
    return _df_records(df, ["trade_date", "iv", "open", "high", "low"])


def build_percentile(qvix: pd.DataFrame) -> dict | None:
    if qvix.empty:
        return None
    df = qvix.sort_values("trade_date").tail(PERCENTILE_DAYS).copy()
    df["percentile_all"] = _percentile_rank(df["iv"])
    df["percentile_1y"] = _percentile_rank(df["iv"], window=252)
    latest = df.iloc[-1]
    return {
        "latest_iv": _safe_float(latest["iv"]),
        "percentile_all": _safe_float(latest["percentile_all"]),
        "percentile_1y": _safe_float(latest["percentile_1y"]),
        "series": _df_records(df, ["trade_date", "iv", "percentile_all", "percentile_1y"]),
    }


def _percentile_of_value(series: pd.Series, value: float) -> float | None:
    s = pd.to_numeric(series, errors="coerce").dropna()
    if s.empty or not np.isfinite(value):
        return None
    combined = pd.concat([s, pd.Series([value])], ignore_index=True)
    return float(combined.rank(pct=True).iloc[-1] * 100)


def build_percentile_with_current(
    qvix: pd.DataFrame,
    current_iv: float | None = None,
    as_of: date | None = None,
) -> dict | None:
    """Rank official QVIX history; overlay current IV when feed is stale or diverged."""
    if qvix.empty:
        return None
    df = qvix.sort_values("trade_date").tail(PERCENTILE_DAYS).copy()
    df["percentile_all"] = _percentile_rank(df["iv"])
    df["percentile_1y"] = _percentile_rank(df["iv"], window=252)

    latest_iv = _safe_float(df.iloc[-1]["iv"])
    pct_all = _safe_float(df.iloc[-1]["percentile_all"])
    pct_1y = _safe_float(df.iloc[-1]["percentile_1y"])

    if current_iv is not None and np.isfinite(current_iv) and current_iv > 0:
        target = as_of or latest_trade_date()
        last_date = pd.Timestamp(df.iloc[-1]["trade_date"]).date()
        stale = target > last_date
        if stale:
            ranked_all = _percentile_of_value(df["iv"], current_iv)
            ranked_1y = _percentile_of_value(df["iv"].tail(252), current_iv)
            if ranked_all is not None:
                pct_all = ranked_all
            if ranked_1y is not None:
                pct_1y = ranked_1y
            overlay = {
                "trade_date": pd.Timestamp(target),
                "iv": float(current_iv),
                "percentile_all": pct_all,
                "percentile_1y": pct_1y,
            }
            df = pd.concat([df, pd.DataFrame([overlay])], ignore_index=True)
            latest_iv = current_iv

    return {
        "latest_iv": _safe_float(latest_iv),
        "percentile_all": _safe_float(pct_all),
        "percentile_1y": _safe_float(pct_1y),
        "series": _df_records(df, ["trade_date", "iv", "percentile_all", "percentile_1y"]),
    }


def _nearest_atm_iv(udf: pd.DataFrame, em_udf: pd.DataFrame | None = None) -> float | None:
    if udf.empty or "iv" not in udf.columns:
        return None
    atm = _atm_by_expiry(_term_structure_df(udf, em_udf))
    if atm.empty:
        return _safe_float(udf["iv"].median())
    nearest = atm.loc[atm["days_to_expiry"].idxmin()]
    return _safe_float(nearest["iv"])


def _choose_iv(snapshot_iv: float | None, qvix_iv: float, qvix_date: datetime) -> float:
    if snapshot_iv is None:
        return qvix_iv
    if (datetime.now() - qvix_date).days > 45:
        return snapshot_iv
    if qvix_iv <= 0:
        return snapshot_iv
    if abs(snapshot_iv - qvix_iv) / qvix_iv > 0.35:
        return qvix_iv
    return snapshot_iv


def prepare_qvix_series(
    key: str,
    snapshot: pd.DataFrame,
    qvix: pd.DataFrame,
    em_snapshot: pd.DataFrame | None = None,
) -> pd.DataFrame:
    cfg = UNDERLYINGS[key]
    udf = filter_underlying(snapshot, cfg)
    em_udf = filter_underlying(em_snapshot, cfg) if em_snapshot is not None else None
    snapshot_iv = _nearest_atm_iv(udf, em_udf) if not udf.empty or (em_udf is not None and not em_udf.empty) else None
    q = qvix.sort_values("trade_date").copy() if not qvix.empty else pd.DataFrame()
    return extend_qvix_with_snapshot(q, snapshot_iv)


def build_underlying_payload(
    key: str,
    snapshot: pd.DataFrame,
    qvix: pd.DataFrame,
    em_snapshot: pd.DataFrame | None = None,
) -> dict | None:
    cfg = UNDERLYINGS[key]
    udf = filter_underlying(snapshot, cfg)
    em_udf = filter_underlying(em_snapshot, cfg) if em_snapshot is not None else None
    if udf.empty and qvix.empty:
        return None

    snapshot_iv = _nearest_atm_iv(udf, em_udf) if not udf.empty or (em_udf is not None and not em_udf.empty) else None
    q_official = qvix.sort_values("trade_date").copy() if not qvix.empty else pd.DataFrame()
    q_history = extend_qvix_with_snapshot(q_official, snapshot_iv)

    current_iv = None
    percentile_all = None
    percentile_1y = None
    qvix_date = datetime.now()
    spot = None

    if not udf.empty:
        prices = pd.to_numeric(udf["underlying_price"], errors="coerce").dropna()
        if not prices.empty:
            spot = float(prices.median())

    if not q_official.empty:
        latest = q_official.iloc[-1]
        qvix_iv = float(latest["iv"])
        qvix_date = pd.Timestamp(latest["trade_date"]).to_pydatetime()
        current_iv = _choose_iv(snapshot_iv, qvix_iv, qvix_date)
        pct_series = build_percentile_with_current(q_official, current_iv=current_iv)
        if pct_series:
            percentile_all = pct_series["percentile_all"]
            percentile_1y = pct_series["percentile_1y"]
    elif snapshot_iv is not None:
        current_iv = snapshot_iv
        pct_series = build_percentile_with_current(q_official, current_iv=current_iv)
        if pct_series:
            percentile_all = pct_series["percentile_all"]
            percentile_1y = pct_series["percentile_1y"]

    short_label = SHORT_LABELS.get(key, cfg.label)

    return {
        "key": key,
        "label": cfg.label,
        "short_label": short_label,
        "group": KEY_TO_GROUP.get(key, cfg.folder_name),
        "spot": spot,
        "current_iv": current_iv,
        "percentile_all": percentile_all,
        "percentile_1y": percentile_1y,
        "contract_count": len(udf),
        "charts": {
            "term_structure": build_term_structure(udf, em_udf)
            if not udf.empty or (em_udf is not None and not em_udf.empty)
            else None,
            "smile": build_smile(udf) if not udf.empty else None,
            "smile_chain": build_smile_chain(udf) if not udf.empty else None,
            "surface": build_surface(udf) if not udf.empty else None,
            "history": build_history(q_history),
            "percentile": build_percentile_with_current(q_official, current_iv=current_iv),
        },
    }


def build_summary_rows(underlyings: dict[str, dict]) -> list[dict]:
    rows: list[dict] = []
    for group_label, keys in GROUPS:
        items = [underlyings[k] for k in keys if k in underlyings]
        if not items:
            continue

        ivs = [u["current_iv"] for u in items if u.get("current_iv") is not None]
        pcts = [u["percentile_all"] for u in items if u.get("percentile_all") is not None]

        if not ivs:
            iv_display = "—"
        elif max(ivs) - min(ivs) < 0.5:
            iv_display = f"约 {min(ivs):.0f}%"
        else:
            iv_display = f"{min(ivs):.0f}% - {max(ivs):.0f}%"

        pct_display, pct_rating = _percentile_summary(pcts)

        rows.append({
            "group_label": group_label,
            "keys": keys,
            "iv_display": iv_display,
            "percentile": pct_rating,
            "percentile_display": pct_display,
            "products": [
                {
                    "key": u["key"],
                    "label": u["short_label"],
                    "current_iv": u.get("current_iv"),
                    "percentile_all": u.get("percentile_all"),
                }
                for u in items
            ],
        })
    return rows
