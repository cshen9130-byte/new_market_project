"""Historical ATM IV time series from QVIX."""

from __future__ import annotations

from pathlib import Path

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import pandas as pd

from iv_analysis.plot_utils import save_figure


def plot_iv_history(qvix: pd.DataFrame, label: str, output_path: Path, lookback_days: int = 504) -> Path | None:
    if qvix.empty:
        return None

    df = qvix.sort_values("trade_date").tail(lookback_days)
    fig, ax = plt.subplots()
    ax.plot(df["trade_date"], df["iv"], linewidth=1.5, color="#7c3aed")
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
    plt.setp(ax.xaxis.get_majorticklabels(), rotation=45, ha="right")
    ax.set_xlabel("Date")
    ax.set_ylabel("QVIX / ATM IV (%)")
    ax.set_title(f"{label} — Historical Implied Volatility")

    latest = df.iloc[-1]
    ax.annotate(
        f"Latest: {latest['iv']:.2f}%",
        xy=(latest["trade_date"], latest["iv"]),
        xytext=(10, 10),
        textcoords="offset points",
        fontsize=9,
        bbox={"boxstyle": "round,pad=0.3", "fc": "#f8fafc", "ec": "#cbd5e1"},
    )

    return save_figure(fig, output_path)
