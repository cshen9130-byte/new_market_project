"""Volatility smile / skew chart (IV vs strike).

Frozen methodology (do not tune to match a reference chart):
- Front expiry with enough strikes (>= MIN_SMILE_STRIKES OTM points, else best available)
- One IV per strike: strict OTM (put if K < S, call if K > S)
- IV from snapshot (live price + spot BS, or East Money when that source wins)
- Quote gates: premium >= 0.01% of spot, 5% <= IV <= 150%, time value >= 0
- Unreliable quotes are excluded, not replaced with alternate rules
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import matplotlib.pyplot as plt
import pandas as pd

from iv_analysis.plot_utils import save_figure

SmileMode = Literal["otm", "raw"]

# Frozen quality gates — change only with an explicit methodology revision.
MIN_IV_PCT = 5.0
MAX_IV_PCT = 150.0
MIN_PREMIUM_TO_SPOT = 0.0001  # 0.01% of spot; below this 1DTE BS inversion is unstable
MIN_SMILE_STRIKES = 5  # front expiry must have at least this many OTM points

METHODOLOGY_NOTE = (
    "Front expiry with >=5 OTM strikes | strict OTM (put K<S, call K>S) | "
    "live-price BS IV | premium >= 0.01% spot, IV 5-150%"
)


def _select_smile_expiry(
    df: pd.DataFrame,
    mode: SmileMode,
    min_strikes: int = MIN_SMILE_STRIKES,
) -> tuple[pd.Timestamp, pd.DataFrame, float] | None:
    """Pick the nearest expiry with enough OTM smile points."""
    valid = df.dropna(subset=["expiry_date"]).copy()
    if valid.empty:
        return None

    if "days_to_expiry" not in valid.columns or valid["days_to_expiry"].isna().all():
        today = pd.Timestamp.now().normalize()
        valid["days_to_expiry"] = (pd.to_datetime(valid["expiry_date"]) - today).dt.days
    else:
        valid["days_to_expiry"] = pd.to_numeric(valid["days_to_expiry"], errors="coerce")

    valid = valid.dropna(subset=["days_to_expiry"])
    valid = valid[valid["days_to_expiry"] >= 0]
    if valid.empty:
        return None

    expiry_order = valid.groupby("expiry_date")["days_to_expiry"].min().sort_values()

    fallback: tuple[pd.Timestamp, pd.DataFrame, float] | None = None
    fallback_count = 0

    for expiry in expiry_order.index:
        sub = valid[valid["expiry_date"] == expiry]
        spot = _spot_price(sub)
        if spot is None:
            continue
        slice_df = _select_smile_slice(sub, mode, spot)
        count = len(slice_df)
        if count >= min_strikes:
            return expiry, sub, spot
        if count > fallback_count:
            fallback = (expiry, sub, spot)
            fallback_count = count

    return fallback


def _nearest_expiry(df: pd.DataFrame) -> pd.Timestamp | None:
    valid = df.dropna(subset=["expiry_date"]).copy()
    if valid.empty:
        return None

    if "days_to_expiry" not in valid.columns or valid["days_to_expiry"].isna().all():
        today = pd.Timestamp.now().normalize()
        valid["days_to_expiry"] = (pd.to_datetime(valid["expiry_date"]) - today).dt.days
    else:
        valid["days_to_expiry"] = pd.to_numeric(valid["days_to_expiry"], errors="coerce")

    valid = valid.dropna(subset=["days_to_expiry"])
    valid = valid[valid["days_to_expiry"] >= 0]
    if valid.empty:
        return None

    nearest_days = valid["days_to_expiry"].min()
    return valid.loc[valid["days_to_expiry"] == nearest_days, "expiry_date"].iloc[0]


def _spot_price(df: pd.DataFrame) -> float | None:
    prices = pd.to_numeric(df["underlying_price"], errors="coerce").dropna()
    if prices.empty:
        return None
    return float(prices.median())


def _filter_valid_quotes(df: pd.DataFrame, spot: float) -> pd.DataFrame:
    base = df.dropna(subset=["iv", "strike", "option_type"]).copy()
    base["iv"] = pd.to_numeric(base["iv"], errors="coerce")
    base["last_price"] = pd.to_numeric(base.get("last_price"), errors="coerce")
    base = base[base["iv"].between(MIN_IV_PCT, MAX_IV_PCT)]
    if "time_value" in base.columns:
        base = base[base["time_value"].isna() | (base["time_value"] >= 0)]

    min_premium = spot * MIN_PREMIUM_TO_SPOT
    base = base[base["last_price"].notna() & (base["last_price"] >= min_premium)]
    return base


def _pick_otm_quote(group: pd.DataFrame, spot: float) -> pd.Series | None:
    """Strict OTM: put below spot, call above spot."""
    strike = float(group["strike"].iloc[0])
    if strike < spot:
        side = group[group["option_type"] == "put"]
    elif strike > spot:
        side = group[group["option_type"] == "call"]
    else:
        side = group
    if side.empty:
        return None
    return side.iloc[0]


def _merge_otm_by_strike(df: pd.DataFrame, spot: float) -> pd.DataFrame:
    rows: list[pd.Series] = []
    for _, group in _filter_valid_quotes(df, spot).groupby("strike"):
        row = _pick_otm_quote(group, spot)
        if row is not None:
            rows.append(row)

    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows).sort_values("strike")


def _select_smile_slice(df: pd.DataFrame, mode: SmileMode, spot: float) -> pd.DataFrame:
    if mode == "raw":
        return _filter_valid_quotes(df, spot).sort_values(["strike", "option_type"])
    return _merge_otm_by_strike(df, spot)


def _save_smile_table(slice_df: pd.DataFrame, output_path: Path, spot: float) -> None:
    csv_path = output_path.with_name("iv_smile.csv")
    cols = [c for c in ("strike", "option_type", "iv", "last_price", "underlying_price", "days_to_expiry") if c in slice_df.columns]
    table = slice_df[cols].copy()
    table.insert(0, "spot", spot)
    table.to_csv(csv_path, index=False, encoding="utf-8-sig")


def plot_iv_smile(
    df: pd.DataFrame,
    label: str,
    output_path: Path,
    mode: SmileMode = "otm",
) -> Path | None:
    selected = _select_smile_expiry(df, mode)
    if selected is None:
        return None

    expiry, expiry_df, spot = selected
    slice_df = _select_smile_slice(expiry_df, mode, spot)
    if slice_df.empty:
        return None

    days = int(expiry_df["days_to_expiry"].min())
    expiry_code = expiry.strftime("%y%m")
    n_strikes = len(slice_df)

    fig, ax = plt.subplots()

    if mode == "otm":
        ax.plot(
            slice_df["strike"],
            slice_df["iv"],
            marker="o",
            linewidth=2,
            color="#7c3aed",
            label=f"OTM IV ({n_strikes} strikes)",
        )
    else:
        colors = {"call": "#16a34a", "put": "#dc2626"}
        for opt_type, group in slice_df.groupby("option_type"):
            g = group.sort_values("strike")
            ax.plot(
                g["strike"],
                g["iv"],
                marker="o",
                linewidth=2,
                label=opt_type.upper(),
                color=colors.get(opt_type, "#64748b"),
            )

    ax.axvline(spot, color="#2563eb", linestyle="-", linewidth=1.2, label=f"Spot {spot:.4f}")
    ax.set_xlabel("Strike")
    ax.set_ylabel("Implied Volatility (%)")
    ax.set_title(f"{label} — Volatility Smile ({expiry_code}, {days}D, S={spot:.4f})")
    ax.legend(loc="best", fontsize=8)
    fig.text(0.5, -0.02, METHODOLOGY_NOTE, ha="center", fontsize=8, color="#64748b", wrap=True)

    _save_smile_table(slice_df, output_path, spot)
    return save_figure(fig, output_path)
