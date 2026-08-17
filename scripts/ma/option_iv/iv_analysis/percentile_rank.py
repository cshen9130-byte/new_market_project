"""Percentile rank helpers — no matplotlib (used by option IV ETL fetch)."""

from __future__ import annotations

import pandas as pd


def _percentile_rank(series: pd.Series, window: int | None = None) -> pd.Series:
    if window:
        return series.rolling(window, min_periods=60).apply(
            lambda x: pd.Series(x).rank(pct=True).iloc[-1] * 100,
            raw=False,
        )
    return series.rank(pct=True) * 100
