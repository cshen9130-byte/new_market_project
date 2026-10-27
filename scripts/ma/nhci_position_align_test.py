"""python scripts/ma/nhci_position_align_test.py"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

import nightly_etl as ne  # noqa: E402


def main() -> None:
    conn = MagicMock()

    # Monkeypatch DB lookups
    ne.position_asof_date = lambda _c: date(2026, 10, 27)  # type: ignore
    ne.max_valid_close_date = lambda *_a, **_k: date(2026, 10, 26)  # type: ignore
    ne.max_date = lambda *_a, **_k: date(2026, 10, 26)  # type: ignore
    ne.market_data_target_date = lambda *_a, **_k: date(2026, 10, 27)  # type: ignore

    try:
        ne.assert_nhci_aligned_with_positions(conn)
        raise SystemExit("expected RuntimeError when NHCI lags positions")
    except RuntimeError as e:
        if "lags MOM positions" not in str(e):
            raise SystemExit(f"unexpected message: {e}")

    ne.max_valid_close_date = lambda *_a, **_k: date(2026, 10, 27)  # type: ignore
    ne.assert_nhci_aligned_with_positions(conn)  # should not raise

    print("ok")


if __name__ == "__main__":
    main()
