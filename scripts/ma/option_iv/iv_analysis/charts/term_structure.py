"""IV term structure chart (ATM IV vs expiry)."""

from __future__ import annotations

from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd

from iv_analysis.plot_utils import save_figure


def _atm_by_expiry(df: pd.DataFrame) -> pd.DataFrame:
    valid = df.dropna(subset=["iv", "expiry_date", "moneyness", "days_to_expiry"]).copy()
    valid = valid[valid["days_to_expiry"] >= 0]
    if valid.empty:
        return valid

    valid["moneyness_dist"] = (valid["moneyness"] - 1.0).abs()
    idx = valid.groupby("expiry_date")["moneyness_dist"].idxmin()
    atm = valid.loc[idx].sort_values("days_to_expiry")
    return atm


def plot_iv_term_structure(df: pd.DataFrame, label: str, output_path: Path) -> Path | None:
    atm = _atm_by_expiry(df)
    if atm.empty:
        return None

    fig, ax = plt.subplots()
    ax.plot(atm["days_to_expiry"], atm["iv"], marker="o", linewidth=2, color="#2563eb")
    ax.set_xlabel("Days to Expiry")
    ax.set_ylabel("ATM Implied Volatility (%)")
    ax.set_title(f"{label} — IV Term Structure")

    for _, row in atm.iterrows():
        ax.annotate(
            row["expiry_date"].strftime("%Y-%m-%d"),
            (row["days_to_expiry"], row["iv"]),
            textcoords="offset points",
            xytext=(0, 8),
            ha="center",
            fontsize=8,
        )

    return save_figure(fig, output_path)
