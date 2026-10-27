"""python scripts/ma/nhci_trade_date_skip_test.py"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from cn_market_holidays import (  # noqa: E402
    is_cn_market_closed,
    last_trading_day_on_or_before,
    previous_trading_day,
)
import nightly_etl as ne  # noqa: E402


def check(label: str, got, want) -> None:
    if got != want:
        raise SystemExit(f"{label}: got {got!r}, want {want!r}")


def main() -> None:
    # Weekend: last open on or before Sunday is Friday.
    check("sun->fri", last_trading_day_on_or_before(date(2026, 10, 25)), date(2026, 10, 23))
    check("sat->fri", last_trading_day_on_or_before(date(2026, 10, 24)), date(2026, 10, 23))
    check("mon->mon", last_trading_day_on_or_before(date(2026, 10, 26)), date(2026, 10, 26))
    check("prev mon", previous_trading_day(date(2026, 10, 26)), date(2026, 10, 23))

    # National Day 2026-10-01 is closed.
    check("oct1 closed", is_cn_market_closed(date(2026, 10, 1)), True)
    check("before nd", last_trading_day_on_or_before(date(2026, 10, 1)), date(2026, 9, 30))

    # Skip semantics that caused the Monday lag with calendar today-1:
    # Friday bars must NOT look current on Monday afternoon.
    mon = date(2026, 10, 26)
    fri = date(2026, 10, 23)
    check("target mon", ne.market_data_target_date(mon), mon)
    check("fri not current mon", ne.is_market_data_current(fri, as_of=mon), False)
    check("mon current mon", ne.is_market_data_current(mon, as_of=mon), True)

    # Old buggy guard: cur_max >= today-1 on Monday with Friday data → False (fetch),
    # but on Saturday with Friday data → True (skip). New guard uses trade calendar.
    sat = date(2026, 10, 24)
    check("fri current sat", ne.is_market_data_current(fri, as_of=sat), True)

    # Overnight previous-session target for Monday is Friday (trade calendar).
    # Monkeypatch date.today via market_data helpers already covered; call previous directly.
    check("overnight mon target", previous_trading_day(mon), fri)

    print("ok")


if __name__ == "__main__":
    main()
