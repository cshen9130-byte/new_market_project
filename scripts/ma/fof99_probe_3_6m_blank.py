#!/usr/bin/env python3
"""Empty-date FundMultiPrice probe for 3-6m funds missing from / blank on 火富牛 list.

Saves any returned NAV. Skips codes already logged at 1970-01-01.
"""
from __future__ import annotations

import csv
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from fof99_weekly_nav_fetch import (  # noqa: E402
    BATCH_SIZE,
    LATEST_PROBE_DATE,
    connect,
    ensure_log_table,
    ensure_universe_table,
    fetch_batch,
    load_env,
    load_fof99_keys,
    load_latest_done,
    load_skip_codes,
    log,
    policy_counts,
    save_latest_batch,
    upsert_skip_codes,
)

CSV_PATH = ROOT / "scripts" / "ma" / "fof99_advancedlist_latest_nav.csv"


def load_fof99_codes() -> tuple[set[str], set[str]]:
    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8-sig", newline="")))
    on_list: set[str] = set()
    dated: set[str] = set()
    for r in rows:
        code = (r.get("register_number") or "").strip().upper()
        if not code:
            continue
        on_list.add(code)
        d = str(r.get("price_date") or "").strip()[:10]
        if len(d) == 10 and d[0].isdigit():
            dated.add(code)
    return on_list, dated


def load_db_3_6m(cur) -> list[tuple[str, str, date]]:
    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), COALESCE(product_name, ''), latest_nav_date
        FROM private_fund_info
        WHERE latest_nav_date >= CURRENT_DATE - INTERVAL '6 months'
          AND latest_nav_date < CURRENT_DATE - INTERVAL '3 months'
          AND beian_hao IS NOT NULL AND BTRIM(beian_hao) <> ''
        ORDER BY beian_hao
        """
    )
    return [(r[0], r[1], r[2]) for r in cur.fetchall()]


def label_confirmed_no_data(cur, on_list: set[str], dated: set[str]) -> int:
    """Skip 3-6m funds whose empty-date probe returned no_data (blank list or missing)."""
    cur.execute(
        """
        SELECT UPPER(BTRIM(p.reg_code)), COALESCE(i.product_name, '')
        FROM fof99_nav_fetch_log p
        LEFT JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = UPPER(BTRIM(p.reg_code))
        WHERE p.price_date = DATE '1970-01-01'
          AND p.status = 'no_data'
          AND p.batch_id LIKE '3-6m-blank-%%'
        """
    )
    items: list[tuple[str, str, str]] = []
    for code, name in cur.fetchall():
        if code in on_list and code not in dated:
            reason = "3-6m: on advancedlist with blank NAV; empty-date FundMultiPrice no_data"
        elif code not in on_list:
            reason = "3-6m: missing from advancedlist; empty-date FundMultiPrice no_data"
        else:
            continue
        items.append((code, name, reason))
    return upsert_skip_codes(cur, items)


def main() -> int:
    dry = "--dry-run" in sys.argv
    load_env()
    on_list, dated = load_fof99_codes()
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    ensure_log_table(cur)
    ensure_universe_table(cur)
    conn.commit()

    universe = load_db_3_6m(cur)
    blank = [(c, n) for c, n, _d in universe if c in on_list and c not in dated]
    missing = [(c, n) for c, n, _d in universe if c not in on_list]
    targets = blank + missing
    log(f"3-6m blank-on-list={len(blank)}  missing-from-list={len(missing)}  probe={len(targets)}")

    codes = [c for c, _ in targets]
    done = load_latest_done(cur, codes)
    skip = load_skip_codes(cur)
    pending = [(c, n) for c, n in targets if c not in done and c not in skip]
    log(f"already probed latest: {len(done)}  still to fetch: {len(pending)}")
    batches = [pending[i : i + BATCH_SIZE] for i in range(0, len(pending), BATCH_SIZE)]
    credits = len(batches)
    log(f"planned credits: {credits}")
    labeled = label_confirmed_no_data(cur, on_list, dated)
    conn.commit()
    log(f"labeled skip={labeled}  policies {policy_counts(cur)}")
    if dry or credits == 0:
        log("dry-run: no API calls" if dry else "nothing to fetch")
        return 0

    appid, appkey = load_fof99_keys()
    used = 0
    ok_total = 0
    no_data_total = 0
    for i, chunk in enumerate(batches, start=1):
        codes_only = [c for c, _ in chunk]
        batch_id = f"3-6m-blank-{i:04d}"
        log(f"[{i}/{credits}] date=empty n={len(codes_only)} {codes_only[0]}…{codes_only[-1]}")
        try:
            data, debug = fetch_batch(appid, appkey, codes_only, None)
        except Exception as exc:
            log(f"STOP: request exception on {batch_id}: {exc}")
            return 1
        err = debug.get("error_code")
        if err not in (0, "0", None) or data is None:
            log(f"STOP: API error on {batch_id} error_code={err} msg={debug.get('msg')}")
            return 1
        if not isinstance(data, list):
            log(f"STOP: unexpected payload type {type(data)} on {batch_id}")
            return 1
        ok, no_data, dates = save_latest_batch(conn, chunk, data, batch_id)
        used += 1
        ok_total += ok
        no_data_total += no_data
        hint = f"  dates {min(dates)}…{max(dates)}" if dates else ""
        log(f"    saved ok={ok} no_data={no_data}  credits_used={used}/{credits}{hint}")

    labeled = label_confirmed_no_data(cur, on_list, dated)
    conn.commit()
    log(f"labeled skip={labeled}  policies {policy_counts(cur)}")
    log(f"done. credits_used={used} ok={ok_total} no_data={no_data_total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
