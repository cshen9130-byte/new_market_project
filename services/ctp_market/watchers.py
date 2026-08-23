from __future__ import annotations

import re
import time
from threading import Lock

WATCH_TTL_S = 40
CONTRACT_RE = re.compile(r"^([A-Za-z]{1,3})(\d{3,4})$")

INDEX_PRODUCTS = {"IF", "IH", "IC", "IM"}
CFFEX_PRODUCTS = INDEX_PRODUCTS | {"T", "TF", "TS", "TL"}
CZCE_PRODUCTS = {
    "AP",
    "CF",
    "CJ",
    "CY",
    "FG",
    "JR",
    "LR",
    "MA",
    "OI",
    "PF",
    "PK",
    "PM",
    "PR",
    "PX",
    "RI",
    "RM",
    "RS",
    "SA",
    "SF",
    "SH",
    "SM",
    "SR",
    "TA",
    "UR",
    "WH",
    "ZC",
}


def variants(contract: str) -> list[str]:
    """CTP instrument ids that may match a book contract (case + CZCE 3-digit)."""
    m = CONTRACT_RE.match(contract)
    if not m:
        return [contract] if contract else []
    product, digits = m.group(1).upper(), m.group(2)
    out: list[str] = []

    def add(symbol: str) -> None:
        if symbol and symbol not in out:
            out.append(symbol)

    add(f"{product}{digits}")
    if product in CFFEX_PRODUCTS:
        return out
    add(f"{product.lower()}{digits}")
    if product in CZCE_PRODUCTS and len(digits) == 4:
        add(f"{product}{digits[1:]}")
        add(f"{product.lower()}{digits[1:]}")
    if product in CZCE_PRODUCTS and len(digits) == 3:
        add(f"{product}2{digits}")
        add(f"{product.lower()}2{digits}")
    return out


class WatchBook:
    def __init__(self) -> None:
        self._lock = Lock()
        self._watchers: dict[str, tuple[float, frozenset[str]]] = {}
        self._canon: dict[str, str] = {}

    def touch(self, watcher_id: str, symbols: list[str]) -> list[str]:
        wanted = _normalize(symbols)
        with self._lock:
            self._watchers[watcher_id] = (time.monotonic() + WATCH_TTL_S, frozenset(wanted))
            self._rebuild_canon()
            return sorted(self._wanted_unlocked())

    def drop(self, watcher_id: str) -> None:
        with self._lock:
            self._watchers.pop(watcher_id, None)
            self._rebuild_canon()

    def expire(self) -> bool:
        now = time.monotonic()
        with self._lock:
            before = len(self._watchers)
            self._watchers = {key: value for key, value in self._watchers.items() if value[0] > now}
            if len(self._watchers) == before:
                return False
            self._rebuild_canon()
            return True

    def wanted(self) -> list[str]:
        with self._lock:
            return sorted(self._wanted_unlocked())

    def subscribe_ids(self, base: list[str]) -> list[str]:
        base_u = {item.upper() for item in base}
        with self._lock:
            extras: list[str] = []
            seen: set[str] = set()
            for book in self._wanted_unlocked():
                for vid in variants(book):
                    if vid.upper() in base_u or vid in seen:
                        continue
                    seen.add(vid)
                    extras.append(vid)
            return extras

    def canonical(self, raw: str) -> str:
        key = str(raw or "")
        with self._lock:
            return self._canon.get(key) or self._canon.get(key.upper()) or key.upper()

    def watcher_count(self) -> int:
        with self._lock:
            return len(self._watchers)

    def _wanted_unlocked(self) -> set[str]:
        out: set[str] = set()
        for _, symbols in self._watchers.values():
            out.update(symbols)
        return out

    def _rebuild_canon(self) -> None:
        canon: dict[str, str] = {}
        for book in self._wanted_unlocked():
            for vid in [book, *variants(book)]:
                canon[vid] = book
                canon[vid.upper()] = book
                canon[vid.lower()] = book
        self._canon = canon


def _normalize(symbols: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in symbols:
        symbol = re.sub(r"[^a-zA-Z0-9]", "", str(raw or "")).upper()
        match = CONTRACT_RE.match(symbol)
        if not match:
            continue
        if match.group(1).upper() in INDEX_PRODUCTS:
            continue
        if symbol in seen:
            continue
        seen.add(symbol)
        out.append(symbol)
    return out
