from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
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


def _csv(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [part.strip() for part in raw.split(",") if part.strip()]


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


def default_cffex_instruments() -> str:
    now = shanghai_now()
    months: list[str] = []
    year, month = now.year, now.month
    for _ in range(2):
        months.append(f"{str(year)[2:]}{month:02d}")
        month += 1
        if month > 12:
            month = 1
            year += 1
    parts: list[str] = []
    for product in ("IM", "IF", "IH", "IC"):
        for yymm in months:
            parts.append(f"{product}{yymm}")
    return ",".join(parts)


@dataclass
class Settings:
    profile: str = os.getenv("CTP_PROFILE", "simnow").strip().lower()
    broker_id: str = os.getenv("CTP_BROKER_ID", "9999")
    user_id: str = os.getenv("CTP_USER_ID", "")
    password: str = os.getenv("CTP_PASSWORD", "")
    instruments: list[str] = field(
        default_factory=lambda: _csv("CTP_INSTRUMENTS", default_cffex_instruments())
    )
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
        return self.instruments[0] if self.instruments else "IM2609"


settings = Settings()
