"""IV term structure chart (ATM IV vs expiry)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd


def _atm_by_expiry(df: pd.DataFrame) -> pd.DataFrame:
    valid = df.dropna(subset=["iv", "expiry_date", "moneyness", "days_to_expiry"]).copy()
    valid = valid[valid["days_to_expiry"] >= 0]
    if valid.empty:
        return valid

    # When call/put IV diverge (common on CFFEX index chains), average both at the
    # ATM strike instead of picking whichever leg happened to be closest to spot.
    if "strike" in valid.columns:
        rows: list[dict] = []
        for expiry, grp in valid.groupby("expiry_date", sort=False):
            grp = grp.copy()
            grp["moneyness_dist"] = (grp["moneyness"] - 1.0).abs()
            atm_strike = grp.loc[grp["moneyness_dist"].idxmin(), "strike"]
            at_strike = grp[grp["strike"] == atm_strike]
            if at_strike.empty:
                continue
            template = at_strike.iloc[0]
            rows.append(
                {
                    "expiry_date": expiry,
                    "days_to_expiry": template["days_to_expiry"],
                    "strike": atm_strike,
                    "moneyness": template["moneyness"],
                    "iv": float(at_strike["iv"].mean()),
                }
            )
        if rows:
            return pd.DataFrame(rows).sort_values("days_to_expiry").reset_index(drop=True)

    valid["moneyness_dist"] = (valid["moneyness"] - 1.0).abs()
    idx = valid.groupby("expiry_date")["moneyness_dist"].idxmin()
    atm = valid.loc[idx].sort_values("days_to_expiry")
    return atm


def plot_iv_term_structure(df: pd.DataFrame, label: str, output_path: Path) -> Path | None:
    atm = _atm_by_expiry(df)
    if atm.empty:
        return None

    import matplotlib.pyplot as plt
    from iv_analysis.plot_utils import save_figure
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
