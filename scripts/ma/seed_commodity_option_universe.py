#!/usr/bin/env python3
"""Seed / refresh all configured commodity option underlyings into Postgres."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> int:
    days = sys.argv[1] if len(sys.argv) > 1 else "5"
    keys = sys.argv[2] if len(sys.argv) > 2 else ""
    cmd = [sys.executable, str(ROOT / "fetch_commodity_option_iv_daily.py"), "--days", str(days)]
    if keys:
        cmd.extend(["--keys", keys])

    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    print(f"running: {' '.join(cmd)}", flush=True)
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    (ROOT / "commodity_universe_fetch.log").write_text(proc.stderr or "", encoding="utf-8")
    raw = proc.stdout or ""
    first, last = raw.find("{"), raw.rfind("}")
    if first < 0 or last <= first:
        print("FETCH_FAILED", file=sys.stderr)
        print((proc.stderr or "")[-2000:], file=sys.stderr)
        return 1

    data = json.loads(raw[first : last + 1])
    print(
        f"fetched underlyings={data.get('underlying_count')} "
        f"trade_date={data.get('trade_date')} iv_rows={len(data.get('iv_rows') or [])}"
    )

    sys.path.insert(0, str(ROOT))
    from nightly_etl import get_conn, iso, to_date  # noqa: E402
    from psycopg2.extras import execute_values  # noqa: E402

    conn = get_conn()
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_commodity_option_iv_daily (
                trade_date DATE NOT NULL,
                underlying_key TEXT NOT NULL,
                iv NUMERIC,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, underlying_key)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS derived_commodity_option_iv_snapshot (
                trade_date DATE NOT NULL,
                underlying_key TEXT NOT NULL,
                label TEXT NOT NULL,
                sector TEXT,
                current_iv NUMERIC,
                percentile_all NUMERIC,
                percentile_1y NUMERIC,
                chart_data JSONB NOT NULL,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (trade_date, underlying_key)
            )
        """)
    conn.commit()

    trade_date = to_date(data.get("trade_date"))
    iv_rows = data.get("iv_rows") or []
    iv_records = [
        (to_date(r["trade_date"]), r["underlying_key"], r.get("iv"))
        for r in iv_rows
        if r.get("trade_date") and r.get("underlying_key")
    ]
    underlyings = data.get("underlyings") or {}

    with conn.cursor() as cur:
        if iv_records:
            execute_values(
                cur,
                """
                INSERT INTO raw_commodity_option_iv_daily (trade_date, underlying_key, iv)
                VALUES %s
                ON CONFLICT (trade_date, underlying_key) DO UPDATE
                    SET iv = EXCLUDED.iv, fetched_at = NOW()
                """,
                iv_records,
            )
        snapshot_records = []
        for key, payload in underlyings.items():
            snapshot_records.append((
                trade_date,
                key,
                payload.get("label") or key,
                payload.get("sector") or payload.get("group"),
                payload.get("current_iv"),
                payload.get("percentile_all"),
                payload.get("percentile_1y"),
                # allow_nan then scrub — Postgres JSONB rejects bare NaN tokens
                json.dumps(payload, ensure_ascii=True, allow_nan=True)
                    .replace(": NaN", ": null")
                    .replace(": Infinity", ": null")
                    .replace(": -Infinity", ": null"),
            ))
        if snapshot_records:
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
                snapshot_records,
            )
    conn.commit()
    print(
        f"upserted iv_rows={len(iv_records)} snapshots={len(underlyings)} "
        f"date={iso(trade_date) if trade_date else None}"
    )
    # Keep previous keys that weren't refreshed this run (don't wipe)
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(DISTINCT underlying_key) FROM derived_commodity_option_iv_snapshot")
        total_keys = cur.fetchone()[0]
    print(f"total distinct underlyings in snapshots={total_keys}")
    conn.close()
    return 0 if underlyings else 1


if __name__ == "__main__":
    raise SystemExit(main())
