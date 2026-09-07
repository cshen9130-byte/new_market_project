#!/usr/bin/env python3
"""Label current-1m blank-policy funds whose 火富牛 latest is before 2026-08.

Reads scripts/ma/fof99_current_1m_have_data.csv:
  fof99_policy blank AND fof99_latest_date < 2026-08-01 → update_slow

No paid calls. Never overwrites policy=skip.
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

CSV_PATH = ROOT / "scripts" / "ma" / "fof99_current_1m_have_data.csv"
AUG_START = date(2026, 8, 1)


def parse_iso(raw: object) -> date | None:
    s = str(raw or "").strip()[:10]
    if len(s) != 10 or not s[0].isdigit():
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def load_items() -> tuple[list[tuple[str, str, str, str]], Counter]:
    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8-sig", newline="")))
    items: list[tuple[str, str, str, str]] = []
    stats: Counter = Counter()
    stats["csv_rows"] = len(rows)
    for row in rows:
        if (row.get("fof99_policy") or "").strip():
            continue
        stats["blank_policy"] += 1
        code = (row.get("beian_hao") or "").strip().upper()
        name = (row.get("product_name") or "").strip()
        dt = parse_iso(row.get("fof99_latest_date"))
        if not code:
            stats["blank_code"] += 1
            continue
        if dt is None:
            stats["missing_date"] += 1
            continue
        if dt >= AUG_START:
            stats["aug_or_later"] += 1
            continue
        reason = (
            f"1m blank-policy: 火富牛 latest {dt.isoformat()} before 2026-08; "
            "do not pay weekly unless policy changed"
        )
        items.append((code, name, "update_slow", reason))
        stats["update_slow"] += 1
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
        f"csv_rows={stats['csv_rows']}  blank_policy={stats['blank_policy']}  "
        f"before_2026-08={stats['update_slow']}  aug_or_later={stats['aug_or_later']}  "
        f"missing_date={stats['missing_date']}"
    )
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
