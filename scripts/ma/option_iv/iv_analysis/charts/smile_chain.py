"""Volatility smile for a single expiry chain (OpenVlab-style).

Uses the nearest listed expiry month only (e.g. 2607), one IV per strike from
that month's call/put contracts. Differs from iv_smile.png which may roll to a
later expiry when the front month is too thin.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from iv_analysis.charts.smile import MIN_IV_PCT, _select_smile_slice, _spot_price, _trim_symmetric_wings
from iv_analysis.data import enrich_chain_open_interest

# Chain uses a slightly relaxed premium gate so liquid near-ATM wings (e.g. 2.95) remain.
CHAIN_MIN_PREMIUM_TO_SPOT = 0.00005  # 0.005% of spot

# Chain-specific gates (ATM-focused, like commercial chain viewers).
CHAIN_MAX_IV_PCT = 50.0
MIN_CHAIN_STRIKES = 4
MAX_IV_JUMP_PCT = 12.0  # drop wing quotes with a cliff vs the next strike

CHAIN_METHODOLOGY = (
    "Nearest expiry (>=4 strikes) | strict OTM IV | ATM plateau below spot | "
    "symmetric wing trim (same window as OTM smile) | OI bars = call (green) / put (red)"
)


def _expiry_candidates(df: pd.DataFrame) -> list[tuple[pd.Timestamp, pd.DataFrame, float, int]]:
    valid = df.dropna(subset=["expiry_date"]).copy()
    if valid.empty:
        return []

    if "days_to_expiry" not in valid.columns or valid["days_to_expiry"].isna().all():
        today = pd.Timestamp.now().normalize()
        valid["days_to_expiry"] = (pd.to_datetime(valid["expiry_date"]) - today).dt.days
    else:
        valid["days_to_expiry"] = pd.to_numeric(valid["days_to_expiry"], errors="coerce")

    valid = valid.dropna(subset=["days_to_expiry"])
    valid = valid[valid["days_to_expiry"] >= 0]
    if valid.empty:
        return []

    candidates: list[tuple[pd.Timestamp, pd.DataFrame, float, int]] = []
    for expiry in valid.groupby("expiry_date")["days_to_expiry"].min().sort_values().index:
        sub = valid[valid["expiry_date"] == expiry].copy()
        spot = _spot_price(sub)
        if spot is None:
            continue
        days = int(sub["days_to_expiry"].min())
        candidates.append((expiry, sub, spot, days))
    return candidates


def _select_chain_expiry(df: pd.DataFrame) -> tuple[pd.Timestamp, pd.DataFrame, float] | None:
    """Prefer nearest expiry; roll forward only when the front month is too thin."""
    candidates = _expiry_candidates(df)
    if not candidates:
        return None

    fallback: tuple[pd.Timestamp, pd.DataFrame, float] | None = None

    for i, (expiry, sub, spot, _days) in enumerate(candidates):
        table = _build_chain_table(sub, spot, apply_plateau=False)
        count = len(table)
        if count == 0:
            continue
        below = int((table["strike"] < spot).sum())
        above = int((table["strike"] > spot).sum())

        if count >= 2:
            fallback = (expiry, sub, spot)

        spans_spot = below >= 1 and above >= 1
        if not spans_spot:
            continue
        if i == 0 and count >= 3:
            return expiry, sub, spot
        if count >= MIN_CHAIN_STRIKES:
            return expiry, sub, spot

    return fallback


def _filter_chain_quotes(df: pd.DataFrame, spot: float) -> pd.DataFrame:
    base = df.dropna(subset=["iv", "strike", "option_type"]).copy()
    base["iv"] = pd.to_numeric(base["iv"], errors="coerce")
    base["last_price"] = pd.to_numeric(base.get("last_price"), errors="coerce")
    base = base[base["iv"].between(MIN_IV_PCT, CHAIN_MAX_IV_PCT)]
    if "time_value" in base.columns:
        base = base[base["time_value"].isna() | (base["time_value"] >= 0)]

    min_premium = spot * CHAIN_MIN_PREMIUM_TO_SPOT
    base = base[base["last_price"].notna() & (base["last_price"] >= min_premium)]
    return base


def _pick_chain_iv(group: pd.DataFrame, spot: float) -> float | None:
    """Strict OTM IV per strike — never use ITM legs (avoids index-option cliffs)."""
    strike = float(group["strike"].iloc[0])
    calls = group[group["option_type"] == "call"]
    puts = group[group["option_type"] == "put"]

    if strike < spot and not puts.empty:
        return float(puts.iloc[0]["iv"])
    if strike > spot and not calls.empty:
        return float(calls.iloc[0]["iv"])

    # Spot sits on the strike grid or only ITM legs remain.
    if not calls.empty and not puts.empty:
        return float(min(calls.iloc[0]["iv"], puts.iloc[0]["iv"]))
    side = puts if not puts.empty else calls
    if side.empty:
        return None
    return float(side.iloc[0]["iv"])


def _apply_atm_plateau(table: pd.DataFrame, spot: float) -> pd.DataFrame:
    """When spot sits between two strikes, flatten IV on the strike just below spot."""
    both = table.dropna(subset=["call_iv", "put_iv"])
    if both.empty:
        return table

    atm_idx = (both["strike"] - spot).abs().idxmin()
    atm_strike = float(both.loc[atm_idx, "strike"])
    atm_iv = float(both.loc[atm_idx, "iv"])

    below = table[table["strike"] < atm_strike]
    if below.empty:
        return table

    strike_below = float(below["strike"].max())
    below_row = table.loc[table["strike"] == strike_below].iloc[0]
    single_sided = pd.isna(below_row["call_iv"]) or pd.isna(below_row["put_iv"])
    if single_sided and strike_below < spot < atm_strike:
        out = table.copy()
        out.loc[out["strike"] == strike_below, "iv"] = atm_iv
        return out
    return table


def _drop_iv_cliffs(table: pd.DataFrame) -> pd.DataFrame:
    """Remove isolated wing quotes that create artificial cliffs in the curve."""
    if len(table) < 3:
        return table

    out = table.copy().reset_index(drop=True)
    keep = np.ones(len(out), dtype=bool)
    iv = out["iv"].to_numpy()

    for i in range(len(out) - 1):
        jump = abs(iv[i + 1] - iv[i])
        if jump <= MAX_IV_JUMP_PCT:
            continue
        # Drop the lone wing point that disagrees with both neighbours.
        if i == 0:
            keep[i] = False
        elif i + 1 == len(out) - 1:
            keep[i + 1] = False
        else:
            left = abs(iv[i] - iv[i - 1])
            right = abs(iv[i + 1] - iv[i + 2]) if i + 2 < len(out) else np.inf
            if left >= right:
                keep[i] = False
            else:
                keep[i + 1] = False

    return out.loc[keep].reset_index(drop=True)


def _infer_strike_step(strikes: np.ndarray) -> float:
    if len(strikes) < 2:
        return 0.05
    diffs = np.diff(np.sort(strikes))
    diffs = diffs[diffs > 1e-6]
    return float(np.median(diffs)) if len(diffs) else 0.05


def _leg_open_interest(group: pd.DataFrame, side: str) -> float:
    legs = group[group["option_type"] == side]
    if legs.empty:
        return 0.0
    oi = pd.to_numeric(legs.iloc[0].get("open_interest"), errors="coerce")
    return float(oi) if pd.notna(oi) and oi > 0 else 0.0


def _build_chain_table(
    expiry_df: pd.DataFrame,
    spot: float,
    *,
    apply_plateau: bool = True,
) -> pd.DataFrame:
    """Build chain rows on OTM smile strikes with OI from the full expiry chain."""
    otm_slice = _select_smile_slice(expiry_df, "otm", spot)
    if not otm_slice.empty:
        oi_df = enrich_chain_open_interest(
            expiry_df.dropna(subset=["strike", "option_type"]).copy()
        )
        rows: list[dict] = []
        for strike in sorted(otm_slice["strike"].unique()):
            strike_f = float(strike)
            iv = float(otm_slice.loc[otm_slice["strike"] == strike, "iv"].iloc[0])
            grp = oi_df[np.isclose(oi_df["strike"].astype(float), strike_f)]
            calls = grp[grp["option_type"] == "call"]
            puts = grp[grp["option_type"] == "put"]
            rows.append(
                {
                    "strike": strike_f,
                    "iv": iv,
                    "call_iv": float(calls.iloc[0]["iv"]) if not calls.empty else np.nan,
                    "put_iv": float(puts.iloc[0]["iv"]) if not puts.empty else np.nan,
                    "call_oi": _leg_open_interest(grp, "call"),
                    "put_oi": _leg_open_interest(grp, "put"),
                }
            )
        if rows:
            return pd.DataFrame(rows).sort_values("strike").reset_index(drop=True)

    valid = enrich_chain_open_interest(_filter_chain_quotes(expiry_df, spot))
    rows: list[dict] = []

    for strike, group in valid.groupby("strike"):
        calls = group[group["option_type"] == "call"]
        puts = group[group["option_type"] == "put"]
        iv = _pick_chain_iv(group, spot)
        if iv is None:
            continue

        call_oi = (
            float(calls.iloc[0]["open_interest"])
            if not calls.empty and pd.notna(calls.iloc[0].get("open_interest"))
            else 0.0
        )
        put_oi = (
            float(puts.iloc[0]["open_interest"])
            if not puts.empty and pd.notna(puts.iloc[0].get("open_interest"))
            else 0.0
        )

        rows.append(
            {
                "strike": float(strike),
                "iv": iv,
                "call_iv": float(calls.iloc[0]["iv"]) if not calls.empty else np.nan,
                "put_iv": float(puts.iloc[0]["iv"]) if not puts.empty else np.nan,
                "call_oi": call_oi,
                "put_oi": put_oi,
            }
        )

    if not rows:
        return pd.DataFrame()

    table = pd.DataFrame(rows).sort_values("strike")
    table = _drop_iv_cliffs(table)
    if apply_plateau:
        table = _apply_atm_plateau(table, spot)
    table = _trim_symmetric_wings(table, spot)
    return table


def _save_chain_table(table: pd.DataFrame, output_path: Path, spot: float, expiry: pd.Timestamp, days: int) -> None:
    out = table.copy()
    out.insert(0, "expiry_date", expiry.date())
    out.insert(1, "days_to_expiry", days)
    out.insert(2, "spot", spot)
    out.to_csv(output_path.with_name("iv_smile_chain.csv"), index=False, encoding="utf-8-sig")


def _plot_iv_curve(ax, table: pd.DataFrame) -> None:
    strikes = table["strike"].to_numpy()
    ivs = table["iv"].to_numpy()

    ax.scatter(
        strikes,
        ivs,
        color="#7c3aed",
        s=36,
        zorder=4,
        label=f"Today IV ({len(table)} strikes)",
    )
    ax.plot(strikes, ivs, color="#7c3aed", linewidth=2, zorder=3)


def plot_iv_smile_chain(df: pd.DataFrame, label: str, output_path: Path) -> Path | None:
    selected = _select_chain_expiry(df)
    if selected is None:
        return None

    expiry, expiry_df, spot = selected
    table = _build_chain_table(expiry_df, spot)
    if table.empty or len(table) < 2:
        return None

    days = int(expiry_df["days_to_expiry"].min())
    expiry_code = expiry.strftime("%y%m")
    import matplotlib.pyplot as plt
    from iv_analysis.plot_utils import save_figure
    strikes = table["strike"].to_numpy()
    step = _infer_strike_step(strikes)
    bar_width = step * 0.35

    fig, ax_iv = plt.subplots()
    ax_oi = ax_iv.twinx()

    _plot_iv_curve(ax_iv, table)
    ax_iv.axvline(spot, color="#0ea5e9", linestyle="-", linewidth=1.2, label=f"Spot {spot:.4f}", zorder=2)

    has_oi = (table["call_oi"] + table["put_oi"]).sum() > 0
    if has_oi:
        ax_oi.bar(
            strikes - bar_width / 2,
            table["put_oi"],
            width=bar_width,
            color="#86efac",
            alpha=0.7,
            label="Put OI",
            zorder=1,
        )
        ax_oi.bar(
            strikes + bar_width / 2,
            table["call_oi"],
            width=bar_width,
            color="#fca5a5",
            alpha=0.7,
            label="Call OI",
            zorder=1,
        )
        ax_oi.set_ylabel("Open Interest")
        ax_oi.ticklabel_format(style="plain", axis="y")

    ax_iv.set_xlabel("Strike")
    ax_iv.set_ylabel("Implied Volatility (%)")
    ax_iv.set_title(f"{label} — Chain Smile ({expiry_code}, {days}D, S={spot:.4f})")

    k_lo = strikes.min() - step * 0.5
    k_hi = strikes.max() + step * 0.5
    ax_iv.set_xlim(k_lo, k_hi)
    tick_start = np.ceil(k_lo / step) * step
    ticks = np.arange(tick_start, k_hi + step / 2, step)
    if step >= 0.08 and len(strikes) <= 8:
        half = step / 2
        tick_start = np.ceil(k_lo / half) * half
        ticks = np.arange(tick_start, k_hi + half / 2, half)
    ax_iv.set_xticks(ticks)

    iv_lo, iv_hi = table["iv"].min(), table["iv"].max()
    pad = max(2.0, (iv_hi - iv_lo) * 0.15)
    ax_iv.set_ylim(max(0, iv_lo - pad), iv_hi + pad)

    lines1, labels1 = ax_iv.get_legend_handles_labels()
    if has_oi:
        lines2, labels2 = ax_oi.get_legend_handles_labels()
        ax_iv.legend(lines1 + lines2, labels1 + labels2, loc="best", fontsize=8)
    else:
        ax_iv.legend(loc="best", fontsize=8)

    fig.text(0.5, -0.02, CHAIN_METHODOLOGY, ha="center", fontsize=8, color="#64748b", wrap=True)
    _save_chain_table(table, output_path, spot, expiry, days)
    return save_figure(fig, output_path)
