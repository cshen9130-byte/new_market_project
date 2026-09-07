#!/usr/bin/env python3
"""Label current-1m blank-policy funds as weekly_plus. No paid calls.

Reads scripts/ma/fof99_current_1m_have_data.csv:
  fof99_policy blank → weekly_plus (email-first; Friday API only if list tip is behind)

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

CSV_PATH = ROOT / "scripts" / "ma" / "fof99_current_1m_have_data.csv"
REASON = (
    "1m blank-policy: email usually has the week; "
    "weekly_plus Friday FundMultiPrice only if list_nav_date is behind"
)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    dry = "--dry-run" in sys.argv
    if not CSV_PATH.is_file():
        log(f"missing {CSV_PATH}")
        return 1
    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8-sig", newline="")))
    items: list[tuple[str, str, str, str]] = []
    stats: Counter = Counter()
    stats["csv_rows"] = len(rows)
    aug28 = date(2026, 8, 28)
    for row in rows:
        if (row.get("fof99_policy") or "").strip():
            continue
        stats["blank_policy"] += 1
        code = (row.get("beian_hao") or "").strip().upper()
        name = (row.get("product_name") or "").strip()
        if not code:
            stats["blank_code"] += 1
            continue
        raw = (row.get("list_nav_date") or "").strip()[:10]
        if len(raw) == 10:
            try:
                tip = date.fromisoformat(raw)
                if tip < aug28:
                    stats["behind_2026-08-28"] += 1
            except ValueError:
                pass
        items.append((code, name, "weekly_plus", REASON))
    log(
        f"csv_rows={stats['csv_rows']}  blank_policy={stats['blank_policy']}  "
        f"to_weekly_plus={len(items)}  list_nav_date<2026-08-28={stats['behind_2026-08-28']}"
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
