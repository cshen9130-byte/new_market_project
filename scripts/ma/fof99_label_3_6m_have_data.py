#!/usr/bin/env python3
"""Label 3-6m funds that 火富牛 already has: weekly vs update_slow. No paid calls.

Cutoff is 火富牛 latest NAV date from scripts/ma/fof99_3_6m_have_data.csv
(fof99_latest_date), not our AMAC list tip:

  <  2026-08-01  → update_slow
  >= 2026-08-01  → weekly  (August 2026 and later)

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
    write_policy_csv,
)

CSV_PATH = ROOT / "scripts" / "ma" / "fof99_3_6m_have_data.csv"
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
    for row in rows:
        code = (row.get("beian_hao") or "").strip().upper()
        name = (row.get("product_name") or "").strip()
        dt = parse_iso(row.get("fof99_latest_date"))
        if not code:
            stats["blank_code"] += 1
            continue
        if dt is None:
            stats["missing_date"] += 1
            continue
        if dt < AUG_START:
            policy = "update_slow"
            reason = (
                f"3-6m: 火富牛 latest {dt.isoformat()} before 2026-08; "
                "do not pay weekly unless policy changed"
            )
            stats["update_slow"] += 1
        else:
            policy = "weekly"
            reason = (
                f"3-6m: 火富牛 latest {dt.isoformat()} in/after 2026-08; "
                "weekly Friday FundMultiPrice"
            )
            stats["weekly"] += 1
        items.append((code, name, policy, reason))
    stats["csv_rows"] = len(rows)
    stats["to_upsert"] = len(items)
    return items, stats


def rewrite_csv_policy(cur) -> None:
    cur.execute("SELECT UPPER(BTRIM(reg_code)), policy FROM fof99_nav_universe")
    policy_by_code = {r[0]: r[1] for r in cur.fetchall()}
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
        fieldnames = list(rows[0].keys()) if rows else []
    if "fof99_policy" not in fieldnames:
        fieldnames.append("fof99_policy")
    for row in rows:
        code = str(row.get("beian_hao") or "").strip().upper()
        row["fof99_policy"] = policy_by_code.get(code, "")
    with CSV_PATH.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    dry = "--dry-run" in sys.argv
    if not CSV_PATH.is_file():
        log(f"missing {CSV_PATH}")
        return 1
    items, stats = load_items()
    log(
        f"csv_rows={stats['csv_rows']}  "
        f"weekly={stats['weekly']}  update_slow={stats['update_slow']}  "
        f"missing_date={stats['missing_date']}  blank_code={stats['blank_code']}"
    )
    log(
        f"cutoff: 火富牛 latest < {AUG_START.isoformat()} → update_slow; "
        f">= {AUG_START.isoformat()} → weekly"
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
    rewrite_csv_policy(cur)
    write_policy_csv(cur)
    conn.commit()
    log(f"wrote fof99_policy on {CSV_PATH.name}")
    weekly = after.get("weekly", 0)
    credits = (weekly + 39) // 40
    log(
        f"weekly fetch size={weekly} → ~{credits} credits per Friday "
        f"(script default budget is 40; pass --budget {credits} to run all)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
