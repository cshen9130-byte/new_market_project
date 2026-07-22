"""Implied volatility helpers for index options."""

from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
from scipy.stats import norm
from scipy.optimize import brentq

RISK_FREE_RATE = 0.018


def third_friday(year: int, month: int) -> date:
    """Return the expiry date (3rd Friday) for CFFEX index options."""
    first = date(year, month, 1)
    days_until_friday = (4 - first.weekday()) % 7
    first_friday = first + timedelta(days=days_until_friday)
    return first_friday + timedelta(weeks=2)


def expiry_from_cffex_symbol(symbol: str) -> date | None:
    """Parse expiry month from symbols like io2608C4050 or io2608."""
    body = symbol.lower()
    for prefix in ("io", "ho", "mo"):
        if body.startswith(prefix) and len(body) >= 6:
            yy = int(body[2:4])
            mm = int(body[4:6])
            return third_friday(2000 + yy, mm)
    return None


def _bs_price(
    spot: float,
    strike: float,
    time_years: float,
    rate: float,
    sigma: float,
    option_type: str,
) -> float:
    if time_years <= 0 or spot <= 0 or strike <= 0 or sigma <= 0:
        return max(spot - strike, 0.0) if option_type == "call" else max(strike - spot, 0.0)

    sqrt_t = math.sqrt(time_years)
    d1 = (math.log(spot / strike) + (rate + 0.5 * sigma * sigma) * time_years) / (sigma * sqrt_t)
    d2 = d1 - sigma * sqrt_t
    if option_type == "call":
        return spot * norm.cdf(d1) - strike * math.exp(-rate * time_years) * norm.cdf(d2)
    return strike * math.exp(-rate * time_years) * norm.cdf(-d2) - spot * norm.cdf(-d1)


def implied_volatility(
    price: float,
    spot: float,
    strike: float,
    time_years: float,
    option_type: str,
    rate: float = RISK_FREE_RATE,
) -> float | None:
    """Return implied vol (percent) or None if it cannot be solved."""
    if price <= 0 or spot <= 0 or strike <= 0 or time_years <= 0:
        return None

    intrinsic = max(spot - strike, 0.0) if option_type == "call" else max(strike - spot, 0.0)
    if price < intrinsic * 0.99:
        return None

    def objective(sigma: float) -> float:
        return _bs_price(spot, strike, time_years, rate, sigma, option_type) - price

    try:
        low, high = 1e-4, 5.0
        if objective(low) * objective(high) > 0:
            return None
        iv = brentq(objective, low, high)
        return iv * 100.0
    except (ValueError, RuntimeError):
        return None
