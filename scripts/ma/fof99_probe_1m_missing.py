#!/usr/bin/env python3
"""Empty-date FundMultiPrice probe for current 1个月以内 funds with no 火富牛 date.

Targets: list tip within 1 month, not in fof99_nav_universe, not on advancedlist with a date.
Confirmed no_data rows are labeled skip so weekly ETL never spends on them.
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from fof99_weekly_nav_fetch import (  # noqa: E402
    BATCH_SIZE,
    connect,
    ensure_log_table,
    ensure_universe_table,
    fetch_batch,
    load_env,
    load_fof99_keys,
    load_latest_done,
    log,
    policy_counts,
    save_latest_batch,
    upsert_skip_codes,
)
from fof99_mall_credits import credit_usage, format_credit_usage  # noqa: E402

LIST_CSV = ROOT / "scripts" / "ma" / "fof99_advancedlist_latest_nav.csv"


def iso(raw: object) -> str:
    s = str(raw or "").strip()[:10]
    return s if len(s) == 10 and s[0].isdigit() else ""


SKIP_REASON = "1m: no 火富牛 date on advancedlist; empty-date FundMultiPrice no_data"


def dated_advancedlist() -> set[str]:
    dated: set[str] = set()
    for r in csv.DictReader(LIST_CSV.open(encoding="utf-8-sig", newline="")):
        code = (r.get("register_number") or "").strip().upper()
        if code and iso(r.get("price_date")):
            dated.add(code)
    return dated


def label_confirmed_no_data(cur) -> int:
    """Skip 1m funds whose empty-date probe returned no_data. Never overwrites weekly."""
    cur.execute(
        """
        SELECT UPPER(BTRIM(p.reg_code)), COALESCE(i.product_name, '')
        FROM fof99_nav_fetch_log p
        LEFT JOIN private_fund_info i
          ON UPPER(BTRIM(i.beian_hao)) = UPPER(BTRIM(p.reg_code))
        WHERE p.price_date = DATE '1970-01-01'
          AND p.status = 'no_data'
          AND p.batch_id LIKE '1m-missing-%'
        """
    )
    items = [(code, name, SKIP_REASON) for code, name in cur.fetchall()]
    return upsert_skip_codes(cur, items)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    load_env()
    dated = dated_advancedlist()
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    ensure_log_table(cur)
    ensure_universe_table(cur)
    conn.commit()
    log(format_credit_usage(credit_usage(cur)))
    conn.commit()

    cur.execute(
        """
        SELECT UPPER(BTRIM(i.beian_hao)), COALESCE(i.product_name, '')
        FROM private_fund_info i
        LEFT JOIN fof99_nav_universe u ON u.reg_code = UPPER(BTRIM(i.beian_hao))
        WHERE i.latest_nav_date >= CURRENT_DATE - INTERVAL '1 month'
          AND i.beian_hao IS NOT NULL AND BTRIM(i.beian_hao) <> ''
          AND u.reg_code IS NULL
        ORDER BY i.beian_hao
        """
    )
    missing_univ = [(r[0], r[1]) for r in cur.fetchall()]
    targets = [(c, n) for c, n in missing_univ if c not in dated]
    log(f"1m not-in-universe={len(missing_univ)}  no_fof99_date={len(targets)}")

    codes = [c for c, _ in targets]
    done = load_latest_done(cur, codes)
    pending = [(c, n) for c, n in targets if c not in done]
    log(f"already probed latest: {len(done)}  still to fetch: {len(pending)}")
    batches = [pending[i : i + BATCH_SIZE] for i in range(0, len(pending), BATCH_SIZE)]
    credits = len(batches)
    log(f"planned credits: {credits}")
    if credits == 0:
        labeled = label_confirmed_no_data(cur)
        conn.commit()
        log(f"labeled skip={labeled}  policies {policy_counts(cur)}")
        log("nothing to fetch")
        return 0

    appid, appkey = load_fof99_keys()
    used = 0
    ok_total = 0
    no_data_total = 0
    for i, chunk in enumerate(batches, start=1):
        codes_only = [c for c, _ in chunk]
        batch_id = f"1m-missing-{i:04d}"
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

    labeled = label_confirmed_no_data(cur)
    conn.commit()
    log(format_credit_usage(credit_usage(cur)))
    log(f"labeled skip={labeled}  policies {policy_counts(cur)}")
    log(f"done. credits_used={used} ok={ok_total} no_data={no_data_total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
