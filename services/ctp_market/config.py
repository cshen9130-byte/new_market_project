from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent if ROOT.parent.name == "services" else ROOT
FLOW_DIR = ROOT / "flow"

load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(ROOT / ".env")

SIMNOW_SESSION_FRONT = "tcp://182.254.243.31:30011"
SIMNOW_24X7_FRONT = "tcp://182.254.243.31:40011"
SHANGHAI = timezone(timedelta(hours=8))


def shanghai_now() -> datetime:
    return datetime.now(SHANGHAI)


def simnow_session_open(now: datetime | None = None) -> bool:
    """SimNow 仿真前置 (30011) only accepts connections in CFFEX hours."""
    now = now or shanghai_now()
    if now.weekday() >= 5:
        return False
    hhmm = now.hour * 100 + now.minute
    return (830 <= hhmm <= 1135) or (1300 <= hhmm <= 1530)


def default_simnow_front() -> str:
    env = (os.getenv("SIMNOW_MD_FRONT") or "").strip()
    if env:
        return env
    return SIMNOW_SESSION_FRONT if simnow_session_open() else SIMNOW_24X7_FRONT


INDEX_PRODUCTS = ("IM", "IF", "IH", "IC")


def _third_friday(year: int, month: int) -> date:
    first = date(year, month, 1)
    first_friday = 1 + (4 - first.weekday()) % 7
    return date(year, month, first_friday + 14)


def listed_cffex_index_yms(now: datetime | None = None) -> list[tuple[int, int]]:
    """CFFEX stock-index futures: current month, next month, next two quarter months."""
    as_of = (now or shanghai_now()).date()
    y, m = as_of.year, as_of.month
    if as_of > _third_friday(y, m):
        m += 1
        if m > 12:
            m, y = 1, y + 1
    near = (y, m)
    y2, m2 = y, m + 1
    if m2 > 12:
        m2, y2 = 1, y2 + 1
    nxt = (y2, m2)
    quarterly: list[tuple[int, int]] = []
    yy, mm = y2, m2
    while len(quarterly) < 2:
        mm += 1
        if mm > 12:
            mm, yy = 1, yy + 1
        if mm in (3, 6, 9, 12):
            quarterly.append((yy, mm))
    return [near, nxt, quarterly[0], quarterly[1]]


def listed_cffex_index_instruments(now: datetime | None = None) -> list[str]:
    months = listed_cffex_index_yms(now)
    return [
        f"{product}{year % 100:02d}{month:02d}"
        for product in INDEX_PRODUCTS
        for year, month in months
    ]


def default_cffex_instruments() -> str:
    return ",".join(listed_cffex_index_instruments())


def _merge_instruments() -> list[str]:
    listed = listed_cffex_index_instruments()
    extra = [part.strip() for part in (os.getenv("CTP_INSTRUMENTS") or "").split(",") if part.strip()]
    seen: set[str] = set()
    out: list[str] = []
    for symbol in listed + extra:
        key = symbol.upper()
        if key in seen:
            continue
        seen.add(key)
        out.append(symbol)
    return out


@dataclass
class Settings:
    profile: str = os.getenv("CTP_PROFILE", "simnow").strip().lower()
    broker_id: str = os.getenv("CTP_BROKER_ID", "9999")
    user_id: str = os.getenv("CTP_USER_ID", "")
    password: str = os.getenv("CTP_PASSWORD", "")
    instruments: list[str] = field(default_factory=_merge_instruments)
    openctp_md_front: str = os.getenv(
        "OPENCTP_MD_FRONT", "tcp://trading.openctp.cn:30011"
    )
    simnow_md_front: str = field(default_factory=default_simnow_front)
    host: str = os.getenv("CHART_HOST", "127.0.0.1")
    port: int = int(os.getenv("CHART_PORT", "8000"))
    _front_override: str | None = field(default=None, init=False, repr=False)

    def use_front(self, front: str) -> None:
        self._front_override = front.strip()

    @property
    def md_front(self) -> str:
        if self._front_override:
            return self._front_override
        if self.profile == "simnow":
            return self.simnow_md_front
        return self.openctp_md_front

    @property
    def fallback_md_front(self) -> str:
        if self.profile != "simnow":
            return self.md_front
        current = self.md_front
        if current == SIMNOW_SESSION_FRONT:
            return SIMNOW_24X7_FRONT
        if current == SIMNOW_24X7_FRONT:
            return SIMNOW_SESSION_FRONT
        if "30011" in current:
            return SIMNOW_24X7_FRONT
        return SIMNOW_SESSION_FRONT

    @property
    def default_symbol(self) -> str:
        return self.instruments[0] if self.instruments else listed_cffex_index_instruments()[0]


settings = Settings()
