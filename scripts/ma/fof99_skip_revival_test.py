"""python scripts/ma/fof99_skip_revival_test.py"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from fof99_friday_afternoon_fetch import is_skip_revival  # noqa: E402

CUTOFF = date(2026, 9, 16)
SKIP = {"SVK343", "SAEJ80", "SBBB12"}


def check(label: str, got: bool, want: bool) -> None:
    if got != want:
        raise SystemExit(f"{label}: got {got}, want {want}")


def main() -> None:
    check("recent skip nav", is_skip_revival("SVK343", date(2026, 10, 15), 1.5629, SKIP, CUTOFF), True)
    check("before window", is_skip_revival("SVK343", date(2026, 9, 15), 1.1, SKIP, CUTOFF), False)
    check("not skip", is_skip_revival("SAUN55", date(2026, 10, 15), 1.1, SKIP, CUTOFF), False)
    check("zero nav", is_skip_revival("SAEJ80", date(2026, 10, 15), 0, SKIP, CUTOFF), False)
    check("blank nav", is_skip_revival("SAEJ80", date(2026, 10, 15), None, SKIP, CUTOFF), False)
    check("on the cutoff day", is_skip_revival("SAEJ80", CUTOFF, "1.05", SKIP, CUTOFF), True)
    check("update_slow in the same set", is_skip_revival("SBBB12", date(2026, 10, 9), 1.2, SKIP, CUTOFF), True)
    print("ok")


if __name__ == "__main__":
    main()
