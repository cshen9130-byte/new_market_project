from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent.parent if ROOT.parent.name == "services" else ROOT
FLOW_DIR = ROOT / "flow"

load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(ROOT / ".env")


def _csv(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [part.strip() for part in raw.split(",") if part.strip()]


@dataclass
class Settings:
    profile: str = os.getenv("CTP_PROFILE", "simnow").strip().lower()
    broker_id: str = os.getenv("CTP_BROKER_ID", "9999")
    user_id: str = os.getenv("CTP_USER_ID", "")
    password: str = os.getenv("CTP_PASSWORD", "")
    instruments: list[str] = field(
        default_factory=lambda: _csv(
            "CTP_INSTRUMENTS",
            "IM2609,IM2608,IF2609,IF2608,IH2609,IH2608,IC2609,IC2608",
        )
    )
    openctp_md_front: str = os.getenv(
        "OPENCTP_MD_FRONT", "tcp://trading.openctp.cn:30011"
    )
    simnow_md_front: str = os.getenv(
        "SIMNOW_MD_FRONT", "tcp://182.254.243.31:30011"
    )
    host: str = os.getenv("CHART_HOST", "127.0.0.1")
    port: int = int(os.getenv("CHART_PORT", "8000"))

    @property
    def md_front(self) -> str:
        if self.profile == "simnow":
            return self.simnow_md_front
        return self.openctp_md_front

    @property
    def default_symbol(self) -> str:
        return self.instruments[0] if self.instruments else "IM2609"


settings = Settings()
