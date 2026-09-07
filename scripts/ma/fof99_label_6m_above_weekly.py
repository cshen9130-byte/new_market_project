#!/usr/bin/env python3
"""Label 6个月以上 funds whose 火富牛 latest is in 2026-08 or 2026-09 as weekly.

Reads scripts/ma/fof99_current_6m_above_have_data.csv. No paid calls.
Never overwrites policy=skip.
"""
from __future__ import annotations

import csv
import sys
from collections import Counter
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from fof99_weekly_nav_fetch import (  # noqa: E402
    connect,
    ensure_universe_table,
    load_env,
    log,
    policy_counts,
    upsert_policies,
)

CSV_PATH = ROOT / "scripts" / "ma" / "fof99_current_6m_above_have_data.csv"
AUG = date(2026, 8, 1)
OCT = date(2026, 10, 1)


def parse_iso(raw: object) -> date | None:
    s = str(raw or "").strip()[:10].replace("/", "-")
    if len(s) < 10 or not s[0].isdigit():
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        return None


def load_items() -> tuple[list[tuple[str, str, str, str]], Counter]:
    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8-sig", newline="")))
    items: list[tuple[str, str, str, str]] = []
    stats: Counter = Counter()
    stats["csv_rows"] = len(rows)
    for row in rows:
        code = (row.get("beian_hao") or "").strip().upper()
        name = (row.get("product_name") or "").strip()
        dt = parse_iso(row.get("fof99_latest_date"))
        existing = (row.get("fof99_policy") or "").strip()
        if not code or dt is None:
            continue
        if dt < AUG or dt >= OCT:
            continue
        stats["aug_sep"] += 1
        stats[f"existing:{existing or '(none)'}"] += 1
        if existing == "skip":
            stats["kept_skip"] += 1
            continue
        reason = (
            f"6m+: 火富牛 latest {dt.isoformat()} in 2026-08/09; "
            "weekly Friday FundMultiPrice"
        )
        items.append((code, name, "weekly", reason))
    stats["to_upsert"] = len(items)
    return items, stats


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    dry = "--dry-run" in sys.argv
    if not CSV_PATH.is_file():
        log(f"missing {CSV_PATH}")
        return 1
    items, stats = load_items()
    log(
        f"csv_rows={stats['csv_rows']}  fof99_latest in 2026-08/09={stats['aug_sep']}  "
        f"to_weekly={stats['to_upsert']}  kept_skip={stats['kept_skip']}"
    )
    extra = {k: v for k, v in stats.items() if k.startswith("existing:")}
    log(f"aug_sep existing policy {extra}")
    if dry:
        log("dry-run: no database writes")
        return 0

    load_env()
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    ensure_universe_table(cur)
    before = policy_counts(cur)
    log(f"universe before {before}")
    n = upsert_policies(cur, items)
    conn.commit()
    after = policy_counts(cur)
    log(f"upserted rows={n}  universe after {after}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
