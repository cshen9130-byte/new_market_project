from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from threading import Lock


def valid_price(value: float | None) -> bool:
    if value is None:
        return False
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return number == number and 0 < number < 1e12


def parse_tick_time(action_day: str, update_time: str, millis: int = 0) -> datetime | None:
    day = (action_day or "").strip()
    clock = (update_time or "").strip()
    if len(day) != 8 or not clock:
        return None
    parts = clock.split(":")
    if len(parts) < 3:
        return None
    try:
        year, month, date = int(day[:4]), int(day[4:6]), int(day[6:8])
        hour, minute, second = int(parts[0]), int(parts[1]), int(parts[2])
        return datetime(year, month, date, hour, minute, second, min(millis, 999) * 1000)
    except ValueError:
        return None


def bar_unix(dt: datetime) -> int:
    """Treat China local wall time as UTC so the chart displays exchange time."""
    floored = dt.replace(second=0, microsecond=0, tzinfo=timezone.utc)
    return int(floored.timestamp())


@dataclass
class Candle:
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float

    def as_dict(self) -> dict:
        return asdict(self)


class MinuteAggregator:
    """Build 1-minute OHLCV candles from CTP ticks."""

    def __init__(self, max_bars: int = 1500) -> None:
        self.max_bars = max_bars
        self._lock = Lock()
        self._current: dict[str, Candle] = {}
        self._history: dict[str, list[Candle]] = {}
        self._last_cum_volume: dict[str, int] = {}

    def on_tick(
        self,
        symbol: str,
        last_price: float,
        cum_volume: int,
        action_day: str,
        update_time: str,
        millis: int = 0,
    ) -> Candle | None:
        if not valid_price(last_price):
            return None
        dt = parse_tick_time(action_day, update_time, millis)
        if dt is None:
            dt = datetime.now()
        t = bar_unix(dt)
        price = float(last_price)
        volume = max(int(cum_volume or 0), 0)

        with self._lock:
            prev_cum = self._last_cum_volume.get(symbol)
            delta = 0 if prev_cum is None else max(volume - prev_cum, 0)
            self._last_cum_volume[symbol] = volume

            current = self._current.get(symbol)
            history = self._history.setdefault(symbol, [])
            if current is not None and t < current.time:
                history.clear()
                current = None
            if current is None or current.time != t:
                candle = Candle(t, price, price, price, price, float(delta))
                if history and history[-1].time == t:
                    history[-1] = candle
                else:
                    history.append(candle)
                    if len(history) > self.max_bars:
                        del history[: len(history) - self.max_bars]
                self._current[symbol] = candle
                return candle

            current.high = max(current.high, price)
            current.low = min(current.low, price)
            current.close = price
            current.volume += delta
            return current

    def history(self, symbol: str) -> list[dict]:
        with self._lock:
            return [c.as_dict() for c in self._history.get(symbol, [])]

    def current(self, symbol: str) -> dict | None:
        with self._lock:
            candle = self._current.get(symbol)
            return candle.as_dict() if candle else None
