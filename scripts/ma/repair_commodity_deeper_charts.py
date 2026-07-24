#!/usr/bin/env python3
"""Rebuild commodity option deeper charts (IV–RV, vol cone, skew, PCR, …) from DB."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "option_iv"))
sys.path.insert(0, str(ROOT))

for p in [ROOT.parent.parent / ".env.local", ROOT.parent.parent / ".env", ROOT / ".env"]:
    if not p.exists():
        continue
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from psycopg2.extras import execute_values  # noqa: E402

from commodity_config import UNDERLYINGS  # noqa: E402
from commodity_fetch import build_underlying_payload  # noqa: E402
from nightly_etl import get_conn, iso, to_date  # noqa: E402


def _scrub(payload: dict) -> str:
    return (
        json.dumps(payload, ensure_ascii=True, allow_nan=True)
        .replace(": NaN", ": null")
        .replace(": Infinity", ": null")
        .replace(": -Infinity", ": null")
    )


def main() -> int:
    keys_arg = sys.argv[1] if len(sys.argv) > 1 else ""
    only = {k.strip() for k in keys_arg.split(",") if k.strip()} if keys_arg else None

    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT trade_date, underlying_key, iv
            FROM raw_commodity_option_iv_daily
            WHERE iv IS NOT NULL
            ORDER BY underlying_key, trade_date
            """
        )
        db_hist: dict[str, list[dict]] = {}
        for td, key, iv in cur.fetchall():
            db_hist.setdefault(key, []).append({
                "trade_date": iso(td) if hasattr(td, "isoformat") else str(td)[:10],
                "iv": float(iv),
            })

        cur.execute(
            """
            SELECT DISTINCT ON (underlying_key)
                   trade_date, underlying_key, label, sector, chart_data
            FROM derived_commodity_option_iv_snapshot
            ORDER BY underlying_key, trade_date DESC
            """
        )
        snaps = cur.fetchall()

    rebuilt = 0
    with_iv_rv = 0
    with_cone = 0
    records: list[tuple] = []

    for trade_date, key, label, sector, chart_data in snaps:
        if only and key not in only:
            continue
        cfg = UNDERLYINGS.get(key)
        hist = db_hist.get(key) or []
        if not cfg or not hist:
            continue

        payload_old = chart_data
        if isinstance(payload_old, str):
            try:
                payload_old = json.loads(payload_old)
            except json.JSONDecodeError:
                payload_old = {}
        if not isinstance(payload_old, dict):
            payload_old = {}
        charts_old = payload_old.get("charts") if isinstance(payload_old.get("charts"), dict) else {}
        term = charts_old.get("term_structure") if isinstance(charts_old.get("term_structure"), list) else []

        payload = build_underlying_payload(cfg, hist, term, prior_charts=charts_old)
        if not payload:
            continue

        charts = payload.get("charts") or {}
        if charts.get("iv_rv"):
            with_iv_rv += 1
        if charts.get("vol_cone"):
            with_cone += 1

        records.append((
            to_date(trade_date) or to_date(hist[-1]["trade_date"]),
            key,
            payload.get("label") or label or cfg.label,
            payload.get("sector") or sector or cfg.sector,
            payload.get("current_iv"),
            payload.get("percentile_all"),
            payload.get("percentile_1y"),
            _scrub(payload),
        ))
        rebuilt += 1

    if records:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO derived_commodity_option_iv_snapshot
                    (trade_date, underlying_key, label, sector,
                     current_iv, percentile_all, percentile_1y, chart_data)
                VALUES %s
                ON CONFLICT (trade_date, underlying_key) DO UPDATE
                    SET label = EXCLUDED.label,
                        sector = EXCLUDED.sector,
                        current_iv = EXCLUDED.current_iv,
                        percentile_all = EXCLUDED.percentile_all,
                        percentile_1y = EXCLUDED.percentile_1y,
                        chart_data = EXCLUDED.chart_data,
                        fetched_at = NOW()
                """,
                records,
            )
        conn.commit()

    print(f"rebuilt={rebuilt} with_iv_rv={with_iv_rv} with_vol_cone={with_cone}")
    conn.close()
    return 0 if rebuilt else 1


if __name__ == "__main__":
    raise SystemExit(main())
