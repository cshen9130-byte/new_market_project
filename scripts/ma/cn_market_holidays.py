#!/usr/bin/env python3
"""China A-share closed dates for 火富牛 Friday FundMultiPrice planning.

Reads lib/cn-statutory-holiday-dates.json (State Council 放假调休, same list as
lib/server/china-trading-calendar.ts). Weekends are always closed.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HOLIDAY_JSON = ROOT / "lib" / "cn-statutory-holiday-dates.json"


@lru_cache(maxsize=1)
def cn_statutory_holidays() -> frozenset[date]:
    raw = json.loads(HOLIDAY_JSON.read_text(encoding="utf-8"))
    return frozenset(date.fromisoformat(s) for s in raw)


def is_cn_market_closed(day: date) -> bool:
    """True on weekends and official PRC public-holiday / 调休 rest days."""
    return day.weekday() >= 5 or day in cn_statutory_holidays()


def last_friday_on_or_before(day: date) -> date:
    return day - timedelta(days=(day.weekday() - 4) % 7)


def last_trading_friday_on_or_before(day: date) -> date:
    d = last_friday_on_or_before(day)
    while is_cn_market_closed(d):
        d -= timedelta(days=7)
    return d
