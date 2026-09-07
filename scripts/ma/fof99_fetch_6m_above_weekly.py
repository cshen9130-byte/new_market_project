#!/usr/bin/env python3
"""Fetch known 火富牛 dates for 6个月以上 weekly funds. No historical Friday backfill.

Reads fof99_current_6m_above_have_data.csv (policy=weekly). Pays one FundMultiPrice
credit per distinct known date, then one for the latest trading Friday.
"""
from __future__ import annotations

import csv
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from cn_market_holidays import (  # noqa: E402
    is_cn_market_closed,
    last_trading_friday_on_or_before,
)
from fof99_mall_credits import credit_usage, format_credit_usage  # noqa: E402
from fof99_weekly_nav_fetch import (  # noqa: E402
    BATCH_SIZE,
    connect,
    ensure_log_table,
    fetch_batch,
    load_env,
    load_fof99_keys,
    load_skip_pairs,
    log,
    save_batch,
)

CSV_PATH = ROOT / "scripts" / "ma" / "fof99_current_6m_above_have_data.csv"


def iso(raw: object) -> date | None:
    s = str(raw or "").strip()[:10].replace("/", "-")
    if len(s) != 10 or not s[0].isdigit():
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def load_targets() -> list[tuple[str, str, date]]:
    rows = []
    for r in csv.DictReader(CSV_PATH.open(encoding="utf-8-sig", newline="")):
        if (r.get("fof99_policy") or "").strip() != "weekly":
            continue
        code = (r.get("beian_hao") or "").strip().upper()
        name = (r.get("product_name") or "").strip()
        dt = iso(r.get("fof99_latest_date"))
        if code and dt:
            rows.append((code, name, dt))
    rows.sort(key=lambda x: x[0])
    return rows


def chunk_by_date(pairs: list[tuple[date, str, str]]) -> list[tuple[date, list[tuple[str, str]]]]:
    by: dict[date, list[tuple[str, str]]] = {}
    for dt, code, name in pairs:
        by.setdefault(dt, []).append((code, name))
    batches: list[tuple[date, list[tuple[str, str]]]] = []
    for dt in sorted(by, reverse=True):
        rows = by[dt]
        for i in range(0, len(rows), BATCH_SIZE):
            batches.append((dt, rows[i : i + BATCH_SIZE]))
    return batches


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    dry = "--dry-run" in sys.argv
    targets = load_targets()
    log(f"6m+ weekly targets: {len(targets)}")
    if not targets:
        return 0

    load_env()
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    ensure_log_table(cur)
    conn.commit()
    log(format_credit_usage(credit_usage(cur)))

    codes = [c for c, _n, _d in targets]
    latest_friday = last_trading_friday_on_or_before(date.today())
    known_dates = sorted({d for _c, _n, d in targets})
    skip = load_skip_pairs(cur, codes, known_dates + [latest_friday])

    known_pairs = [
        (dt, code, name) for code, name, dt in targets if (code, dt) not in skip
    ]
    batches = chunk_by_date(known_pairs)
    latest_chunk = [
        (code, name)
        for code, name, _dt in targets
        if (code, latest_friday) not in skip
    ]
    if latest_chunk and latest_friday not in {d for d, _ in batches}:
        batches.append((latest_friday, latest_chunk))
    elif latest_chunk:
        # already have a known-date batch on latest Friday; still request any not in that set
        already = {c for d, chunk in batches if d == latest_friday for c, _ in chunk}
        extra = [(c, n) for c, n in latest_chunk if c not in already]
        if extra:
            batches.append((latest_friday, extra))

    credits = len(batches)
    log(f"latest Friday: {latest_friday}")
    log(f"planned batches: {credits}")
    for dt, chunk in batches:
        kind = "known" if dt in {d for _c, _n, d in targets} else "Friday"
        log(f"  {dt} ({kind}): {len(chunk)} products → 1 credit")
    if credits == 0:
        log("nothing to fetch")
        return 0
    if dry:
        log("dry-run: no API calls")
        return 0

    known_date_set = {d for _c, _n, d in targets}
    appid, appkey = load_fof99_keys()
    used = 0
    ok_total = 0
    no_data_total = 0
    for i, (price_date, chunk) in enumerate(batches, start=1):
        if is_cn_market_closed(price_date) and price_date not in known_date_set:
            log(f"skip {price_date}: CN market holiday, no API call")
            continue
        codes_only = [c for c, _ in chunk]
        batch_id = f"6m-weekly-{price_date.isoformat()}-{i:04d}"
        log(
            f"[{i}/{credits}] credit {used + 1}  {price_date}  "
            f"n={len(codes_only)}  {codes_only[0]}…{codes_only[-1]}"
        )
        try:
            data, debug = fetch_batch(appid, appkey, codes_only, price_date)
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
        persist_empty = price_date in known_date_set or price_date < latest_friday
        ok, no_data = save_batch(
            conn, price_date, chunk, data, batch_id, persist_empty=persist_empty
        )
        used += 1
        ok_total += ok
        no_data_total += no_data
        log(f"    saved ok={ok} no_data={no_data}  credits_used={used}/{credits}")

    log(format_credit_usage(credit_usage(cur)))
    conn.commit()
    log(f"done. credits_used={used} ok={ok_total} no_data={no_data_total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
