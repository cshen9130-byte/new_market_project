"""Fetch commodity option series IV from exchange feeds (AkShare)."""

from __future__ import annotations

import re
import warnings
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd

from commodity_config import UNDERLYINGS, CommodityUnderlying
from iv_analysis.charts.percentile import _percentile_rank

HISTORY_DAYS = 252


def _to_date(val: Any) -> date | None:
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    try:
        ts = pd.Timestamp(val)
        if pd.isna(ts):
            return None
        return ts.date()
    except Exception:  # noqa: BLE001
        return None


def _ymd(d: date) -> str:
    return d.strftime("%Y%m%d")


def _iso(d: date) -> str:
    return d.isoformat()


def _trading_days_back(end: date, n: int) -> list[date]:
    """Approximate trading calendar (skip weekends)."""
    out: list[date] = []
    cur = end
    while len(out) < n:
        if cur.weekday() < 5:
            out.append(cur)
        cur -= timedelta(days=1)
    return list(reversed(out))


def _norm_iv(raw: Any) -> float | None:
    v = pd.to_numeric(raw, errors="coerce")
    if not np.isfinite(v) or v <= 0:
        return None
    # SHFE/GFEX series vol is often a decimal (0.18); CZCE hist is percent (18)
    return float(v * 100.0) if v <= 2.5 else float(v)


def _pick_col(df: pd.DataFrame, *candidates: str) -> str | None:
    cols = {str(c).strip(): c for c in df.columns}
    for name in candidates:
        if name in cols:
            return cols[name]
    # Fuzzy: last numeric-looking Chinese/English IV column
    for c in df.columns:
        s = str(c)
        if "隐含波动" in s or s.lower() in {"iv", "volatility", "impliedvolatility"}:
            return c
    return None


def _series_front_iv(df: pd.DataFrame) -> tuple[float | None, list[dict[str, Any]]]:
    """Pick front-month series IV (highest volume) and build term structure."""
    if df is None or df.empty:
        return None, []

    series_col = _pick_col(df, "合约系列", "系列", "合约") or df.columns[0]
    vol_col = _pick_col(df, "成交量", "成交量(手)")
    oi_col = _pick_col(df, "持仓量")
    iv_col = _pick_col(df, "隐含波动率", "隐含波动率(%)") or df.columns[-1]

    rows: list[dict[str, Any]] = []
    best_iv: float | None = None
    best_score = -1.0

    for _, r in df.iterrows():
        iv = _norm_iv(r.get(iv_col))
        if iv is None:
            continue
        series = str(r.get(series_col, "")).strip()
        vol = float(pd.to_numeric(r.get(vol_col), errors="coerce") or 0) if vol_col else 0.0
        oi = float(pd.to_numeric(r.get(oi_col), errors="coerce") or 0) if oi_col else 0.0
        # Rough DTE proxy from series code month (cu2608 → 2026-08)
        m = re.search(r"(\d{2})(\d{2})$", series.lower().replace("-", ""))
        days = None
        expiry = None
        if m:
            yy, mm = int(m.group(1)), int(m.group(2))
            if 1 <= mm <= 12:
                year = 2000 + yy
                expiry = f"{year:04d}-{mm:02d}-15"
                days = max(1, (date(year, mm, 15) - date.today()).days)
        rows.append({
            "series": series,
            "expiry_date": expiry,
            "days_to_expiry": days,
            "iv": round(iv, 4),
            "volume": vol,
            "open_interest": oi,
        })
        score = vol * 10 + oi
        if score > best_score:
            best_score = score
            best_iv = iv

    if best_iv is None and rows:
        best_iv = rows[0]["iv"]

    # Term structure sorted by DTE when available
    term = [r for r in rows if r.get("days_to_expiry") is not None]
    term.sort(key=lambda x: int(x["days_to_expiry"]))
    if not term:
        term = rows
    return best_iv, term


def _fetch_vol_table(cfg: CommodityUnderlying, trade_date: date) -> pd.DataFrame | None:
    import akshare as ak

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            if cfg.exchange == "shfe":
                df = ak.option_vol_shfe(symbol=cfg.ak_symbol, trade_date=_ymd(trade_date))
            elif cfg.exchange == "gfex":
                df = ak.option_vol_gfex(symbol=cfg.ak_symbol, trade_date=_ymd(trade_date))
            else:
                return None
        except Exception:  # noqa: BLE001
            return None
    if df is None or getattr(df, "empty", True):
        return None
    return df


def _atm_iv_from_hist(df: pd.DataFrame) -> tuple[float | None, list[dict[str, Any]]]:
    """Estimate near-month ATM IV from exchange option hist (DCE/CZCE)."""
    if df is None or df.empty:
        return None, []

    code_col = _pick_col(df, "合约代码", "合约", "合约名称") or df.columns[0]
    iv_col = _pick_col(df, "隐含波动率", "隐含波动率(%)")
    delta_col = _pick_col(df, "DELTA", "Delta", "德尔塔")
    vol_col = _pick_col(df, "成交量", "成交量(手)")
    if iv_col is None:
        return None, []

    work = df.copy()
    work["_code"] = work[code_col].astype(str)
    work["_iv"] = work[iv_col].map(_norm_iv)
    work = work[work["_iv"].notna()]
    if work.empty:
        return None, []

    # Parse expiry token: SR609C4600 / m2509-C-3200 / M2509-C-3200
    def _expiry_key(code: str) -> str | None:
        m = re.search(r"([A-Za-z]{1,2})(\d{3,4})", code.replace("-", ""))
        if not m:
            return None
        return f"{m.group(1).lower()}{m.group(2)}"

    work["_exp"] = work["_code"].map(_expiry_key)
    work = work[work["_exp"].notna()]
    if work.empty:
        return None, []

    # Prefer rows with delta closest to 0.5 (ATM), weighted by volume
    if delta_col:
        work["_delta"] = pd.to_numeric(work[delta_col], errors="coerce").abs()
    else:
        work["_delta"] = np.nan
    if vol_col:
        work["_vol"] = pd.to_numeric(work[vol_col], errors="coerce").fillna(0.0)
    else:
        work["_vol"] = 0.0

    term: list[dict[str, Any]] = []
    front_iv: float | None = None

    for exp, g in work.groupby("_exp", sort=True):
        # ATM: |delta-0.5| min among liquid names, else median IV
        gg = g.copy()
        if gg["_delta"].notna().any():
            gg["_atm_dist"] = (gg["_delta"] - 0.5).abs()
            gg = gg.sort_values(["_atm_dist", "_vol"], ascending=[True, False])
            atm_rows = gg.head(4)
        else:
            atm_rows = gg.nlargest(min(6, len(gg)), "_vol") if gg["_vol"].sum() > 0 else gg.head(6)

        ivs = [float(x) for x in atm_rows["_iv"].tolist() if x is not None]
        if not ivs:
            continue
        iv = float(np.median(ivs))
        m = re.search(r"(\d{3,4})$", str(exp))
        days = None
        expiry = None
        if m:
            token = m.group(1)
            if len(token) == 3:
                yy, mm = int(token[0]), int(token[1:])
            else:
                yy, mm = int(token[:2]), int(token[2:])
            if 1 <= mm <= 12:
                year = 2000 + yy if yy < 100 else yy
                if yy < 10:
                    year = 2020 + yy  # CZCE 3-digit: 609 → 2026-09
                expiry = f"{year:04d}-{mm:02d}-15"
                days = max(1, (date(year, mm, 15) - date.today()).days)
        term.append({
            "series": str(exp),
            "expiry_date": expiry,
            "days_to_expiry": days,
            "iv": round(iv, 4),
            "volume": float(atm_rows["_vol"].sum()),
        })
        if front_iv is None:
            front_iv = iv

    term.sort(key=lambda x: int(x["days_to_expiry"] or 10_000))
    if term:
        front_iv = term[0]["iv"]
    return front_iv, term


def _fetch_hist_table(cfg: CommodityUnderlying, trade_date: date) -> pd.DataFrame | None:
    import akshare as ak

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            if cfg.exchange == "dce":
                df = ak.option_hist_dce(symbol=cfg.ak_symbol, trade_date=_ymd(trade_date))
            elif cfg.exchange == "czce":
                df = ak.option_hist_czce(symbol=cfg.ak_symbol, trade_date=_ymd(trade_date))
            elif cfg.exchange == "shfe":
                df = ak.option_hist_shfe(symbol=cfg.ak_symbol, trade_date=_ymd(trade_date))
            elif cfg.exchange == "gfex":
                df = ak.option_hist_gfex(symbol=cfg.ak_symbol, trade_date=_ymd(trade_date))
            else:
                return None
        except Exception:  # noqa: BLE001
            return None
    if df is None or getattr(df, "empty", True):
        return None
    return df


def fetch_day_iv(cfg: CommodityUnderlying, trade_date: date) -> dict[str, Any] | None:
    hist_df = None
    iv = None
    term: list[dict[str, Any]] = []

    if cfg.exchange in {"shfe", "gfex"}:
        df = _fetch_vol_table(cfg, trade_date)
        if df is not None:
            iv, term = _series_front_iv(df)
        # Chain hist for deeper analysis / fallback when series-vol feed is missing
        hist_df = _fetch_hist_table(cfg, trade_date)
        if iv is None and hist_df is not None:
            iv, term = _atm_iv_from_hist(hist_df)
    else:
        hist_df = _fetch_hist_table(cfg, trade_date)
        if hist_df is None:
            return None
        iv, term = _atm_iv_from_hist(hist_df)

    if iv is None:
        return None
    return {
        "trade_date": _iso(trade_date),
        "underlying_key": cfg.key,
        "iv": round(float(iv), 4),
        "term_structure": term,
        "hist_df": hist_df,
    }


def fetch_iv_history(
    cfg: CommodityUnderlying,
    end: date,
    *,
    days: int = HISTORY_DAYS,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], Any]:
    """Walk recent sessions and collect front-month IV points + latest term/hist."""
    # Hist-based exchanges are heavier — keep a shorter default window
    window = days if cfg.exchange in {"shfe", "gfex"} else min(days, 60)
    points: list[dict[str, Any]] = []
    latest_term: list[dict[str, Any]] = []
    latest_hist = None

    for d in _trading_days_back(end, window):
        row = fetch_day_iv(cfg, d)
        if not row:
            continue
        points.append({
            "trade_date": row["trade_date"],
            "iv": row["iv"],
        })
        if row.get("term_structure"):
            latest_term = row["term_structure"]
        if row.get("hist_df") is not None:
            latest_hist = row["hist_df"]

    # SHFE/GFEX series-IV path doesn't load chains during the walk — fetch one
    # recent hist day for smile / PCR deeper analysis.
    if latest_hist is None and cfg.exchange in {"shfe", "gfex"}:
        for d in _trading_days_back(end, 8):
            latest_hist = _fetch_hist_table(cfg, d)
            if latest_hist is not None and not latest_hist.empty:
                break

    # DCE official hist is often unavailable — fall back to Sina live tables.
    if not points:
        try:
            from commodity_sina import fetch_sina_option_snapshot
            snap = fetch_sina_option_snapshot(cfg)
        except Exception:  # noqa: BLE001
            snap = None
        if snap and snap.get("iv") is not None:
            td = str(snap.get("trade_date") or end.isoformat())[:10]
            points = [{"trade_date": td, "iv": snap["iv"]}]
            latest_term = snap.get("term_structure") or []
            # Stash smile/chain on a sentinel so build_underlying_payload can use them
            latest_hist = {"__sina_snap__": snap}

    return points, latest_term, latest_hist


def build_percentile_series(history: list[dict[str, Any]]) -> dict[str, Any] | None:
    if len(history) < 1:
        return None
    df = pd.DataFrame(history).sort_values("trade_date").reset_index(drop=True)
    if len(df) == 1:
        # Single observation — neutral placeholder until history accumulates
        iv = float(df.iloc[0]["iv"])
        td = str(df.iloc[0]["trade_date"])[:10]
        return {
            "latest_iv": iv,
            "percentile_all": 50.0,
            "percentile_1y": 50.0,
            "series": [{
                "trade_date": td,
                "iv": iv,
                "percentile_all": 50.0,
                "percentile_1y": 50.0,
            }],
        }
    df["percentile_all"] = _percentile_rank(df["iv"])
    # Upstream rolling helper requires min_periods=60 <= window
    if len(df) >= 60:
        df["percentile_1y"] = _percentile_rank(df["iv"], window=min(252, len(df)))
        if df["percentile_1y"].isna().all():
            df["percentile_1y"] = df["percentile_all"]
    else:
        df["percentile_1y"] = df["percentile_all"]

    series = [
        {
            "trade_date": str(row.trade_date)[:10],
            "iv": float(row.iv),
            "percentile_all": round(float(row.percentile_all), 2) if pd.notna(row.percentile_all) else None,
            "percentile_1y": round(float(row.percentile_1y), 2) if pd.notna(row.percentile_1y) else None,
        }
        for row in df.itertuples()
    ]
    last = series[-1]
    return {
        "latest_iv": last["iv"],
        "percentile_all": last["percentile_all"],
        "percentile_1y": last["percentile_1y"],
        "series": series,
    }


def _json_sanitize(obj: Any) -> Any:
    """Replace NaN/Inf with None so Postgres JSONB accepts the payload."""
    if isinstance(obj, dict):
        return {k: _json_sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_sanitize(v) for v in obj]
    if isinstance(obj, float):
        if not np.isfinite(obj):
            return None
        return obj
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return None if not np.isfinite(v) else v
    if isinstance(obj, (np.integer,)):
        return int(obj)
    return obj


def build_underlying_payload(
    cfg: CommodityUnderlying,
    history: list[dict[str, Any]],
    term: list[dict[str, Any]],
    hist_df: Any = None,
    prior_charts: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if not history:
        return None
    pct = build_percentile_series(history)
    current_iv = history[-1]["iv"]
    spot: float | None = None
    charts: dict[str, Any] = {
        "history": [{"trade_date": h["trade_date"], "iv": h["iv"]} for h in history],
        "percentile": pct,
        "term_structure": [
            {
                "expiry_date": t.get("expiry_date"),
                "days_to_expiry": t.get("days_to_expiry"),
                "iv": t.get("iv"),
                "series": t.get("series"),
            }
            for t in term
            if t.get("iv") is not None
        ] or None,
    }

    # Sina fallback may pass a dict snap instead of a DataFrame hist
    if isinstance(hist_df, dict) and hist_df.get("__sina_snap__"):
        sina_snap = hist_df["__sina_snap__"]
        hist_df = None
        if sina_snap.get("smile"):
            charts["smile"] = sina_snap["smile"]
        if sina_snap.get("smile_chain"):
            charts["smile_chain"] = sina_snap["smile_chain"]
        if sina_snap.get("spot") is not None:
            spot = float(sina_snap["spot"])

    # Preserve smile / chain from a prior fetch when hist_df is unavailable
    if prior_charts:
        for key in ("smile", "smile_chain"):
            if prior_charts.get(key) and not charts.get(key):
                charts[key] = prior_charts[key]

    try:
        from commodity_deeper import attach_commodity_deeper_charts, fetch_futures_closes
        closes = fetch_futures_closes(cfg.futures_code)
        if closes is not None and not closes.empty and spot is None:
            spot = float(closes.iloc[-1])
        attach_commodity_deeper_charts(
            charts,
            cfg,
            current_iv,
            hist_df=hist_df,
            spot=spot,
        )
    except Exception as exc:  # noqa: BLE001
        # Deeper charts are best-effort; keep core IV payload.
        charts["deeper_error"] = str(exc)[:200]

    return _json_sanitize({
        "key": cfg.key,
        "label": cfg.label,
        "short_label": cfg.short_label,
        "group": cfg.sector,
        "sector": cfg.sector,
        "exchange": cfg.exchange,
        "spot": spot,
        "current_iv": current_iv,
        "percentile_all": pct["percentile_all"] if pct else None,
        "percentile_1y": pct["percentile_1y"] if pct else None,
        "charts": charts,
    })


def build_summary_rows(underlyings: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for key, cfg in sorted(UNDERLYINGS.items(), key=lambda kv: kv[1].rank):
        u = underlyings.get(key)
        if not u:
            continue
        iv = u.get("current_iv")
        pct = u.get("percentile_all")
        rows.append({
            "group_label": cfg.label,
            "keys": [key],
            "iv_display": f"约 {iv:.0f}%" if isinstance(iv, (int, float)) else "—",
            "percentile": float(pct) if isinstance(pct, (int, float)) else None,
            "percentile_display": f"约 {pct:.0f}%" if isinstance(pct, (int, float)) else None,
            "products": [{
                "key": key,
                "label": cfg.short_label,
                "current_iv": iv,
                "percentile_all": pct,
            }],
        })
    return rows
