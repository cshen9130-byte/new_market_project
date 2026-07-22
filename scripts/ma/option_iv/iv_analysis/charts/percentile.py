"""IV percentile and rank vs historical QVIX."""

from __future__ import annotations

from pathlib import Path

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import pandas as pd

from iv_analysis.plot_utils import save_figure


def _percentile_rank(series: pd.Series, window: int | None = None) -> pd.Series:
    if window:
        return series.rolling(window, min_periods=60).apply(
            lambda x: pd.Series(x).rank(pct=True).iloc[-1] * 100,
            raw=False,
        )
    return series.rank(pct=True) * 100


def plot_iv_percentile(qvix: pd.DataFrame, label: str, output_path: Path, lookback_days: int = 1260) -> Path | None:
    if qvix.empty:
        return None

    df = qvix.sort_values("trade_date").tail(lookback_days).copy()
    df["percentile_all"] = _percentile_rank(df["iv"])
    df["percentile_1y"] = _percentile_rank(df["iv"], window=252)

    latest = df.iloc[-1]
    fig, axes = plt.subplots(2, 1, figsize=(10, 8), sharex=True)

    axes[0].plot(df["trade_date"], df["iv"], color="#0f766e", linewidth=1.4)
    axes[0].axhline(latest["iv"], color="#94a3b8", linestyle="--", linewidth=1)
    axes[0].set_ylabel("QVIX (%)")
    axes[0].set_title(f"{label} — IV Percentile Analysis")

    axes[1].plot(df["trade_date"], df["percentile_all"], label="All-history percentile", color="#2563eb")
    axes[1].plot(df["trade_date"], df["percentile_1y"], label="1Y rolling percentile", color="#ea580c", alpha=0.85)
    axes[1].axhline(50, color="#94a3b8", linestyle=":", linewidth=1)
    axes[1].set_ylim(0, 100)
    axes[1].set_ylabel("Percentile")
    axes[1].set_xlabel("Date")
    axes[1].legend(loc="upper left")

    axes[1].xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    axes[1].xaxis.set_major_locator(mdates.MonthLocator(interval=6))
    plt.setp(axes[1].xaxis.get_majorticklabels(), rotation=45, ha="right")

    fig.text(
        0.02,
        0.01,
        f"Latest IV {latest['iv']:.2f}% | All-history pct {latest['percentile_all']:.1f} | 1Y rolling pct {latest['percentile_1y']:.1f}",
        fontsize=9,
        color="#334155",
    )

    return save_figure(fig, output_path)
