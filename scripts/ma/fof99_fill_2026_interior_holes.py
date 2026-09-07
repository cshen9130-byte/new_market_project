#!/usr/bin/env python3
"""Fill 2026 中间缺失 Fridays via FundMultiPrice. Newest Friday first.

Skip skip/no_data funds. Do not request a Friday after that fund's 火富牛 latest.
After 2 consecutive empty weeks for a fund, stop older remaining Fridays for it.

  python scripts/ma/fof99_fill_2026_interior_holes.py --dry-run
  python scripts/ma/fof99_fill_2026_interior_holes.py
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from cn_market_holidays import is_cn_market_closed, last_friday_on_or_before  # noqa: E402
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

GAP_CSV = ROOT / "data" / "exports" / "私募基金_净值日期1个月以内_中间缺失超1_10_2026-09-07.csv"
LIST_CSV = ROOT / "scripts" / "ma" / "fof99_advancedlist_latest_nav.csv"
YEAR = 2026
EMPTY_STOP = 2


def iso(raw: object) -> date | None:
    s = str(raw or "").strip()[:10]
    if len(s) != 10 or not s[0].isdigit():
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def trading_fridays(start: date, end: date) -> list[date]:
    d = last_friday_on_or_before(start)
    if d < start:
        d += timedelta(days=7)
    out: list[date] = []
    while d <= end:
        if not is_cn_market_closed(d):
            out.append(d)
        d += timedelta(days=7)
    return out


def load_gap_funds() -> dict[str, tuple[str, date, date, float]]:
    out: dict[str, tuple[str, date, date, float]] = {}
    for r in csv.DictReader(GAP_CSV.open(encoding="utf-8-sig", newline="")):
        code = (r.get("备案号") or "").strip().upper()
        first = iso(r.get("首个净值日"))
        last = iso(r.get("最近净值日"))
        try:
            typical = float(r.get("典型间隔天数") or 0)
        except ValueError:
            typical = 0
        if code and first and last and last > first:
            out[code] = ((r.get("产品名称") or "").strip(), first, last, typical)
    return out


def load_list_latest() -> dict[str, date]:
    latest: dict[str, date] = {}
    if not LIST_CSV.is_file():
        return latest
    for r in csv.DictReader(LIST_CSV.open(encoding="utf-8-sig", newline="")):
        code = (r.get("register_number") or "").strip().upper()
        dt = iso(r.get("price_date"))
        if code and dt:
            latest[code] = dt
    return latest


def main() -> int:
    parser = argparse.ArgumentParser(description="Fill 2026 interior-gap Fridays")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--empty-stop", type=int, default=EMPTY_STOP)
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    load_env()

    funds = load_gap_funds()
    list_latest = load_list_latest()
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    ensure_log_table(cur)
    conn.commit()
    log(format_credit_usage(credit_usage(cur)))
    conn.commit()

    codes = list(funds)
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code)), policy
        FROM fof99_nav_universe WHERE UPPER(BTRIM(reg_code)) = ANY(%s)
        """,
        (codes,),
    )
    policy = {r[0]: r[1] for r in cur.fetchall()}
    banned = {c for c, p in policy.items() if p == "skip"}
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code))
        FROM fof99_nav_fetch_log
        WHERE price_date = DATE '1970-01-01' AND status = 'no_data'
          AND UPPER(BTRIM(reg_code)) = ANY(%s)
        """,
        (codes,),
    )
    banned |= {r[0] for r in cur.fetchall()}
    tryable = [c for c in codes if c not in banned]

    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), price_date FROM private_fund_nav
        WHERE UPPER(BTRIM(beian_hao)) = ANY(%s)
        """,
        (tryable,),
    )
    have: dict[str, set[date]] = defaultdict(set)
    for code, d in cur.fetchall():
        have[code].add(d)
    all_fridays: list[date] = []
    d0 = date(YEAR, 1, 1)
    while d0.year == YEAR:
        all_fridays.append(d0)
        d0 += timedelta(days=7)
    skip_pairs = load_skip_pairs(cur, tryable, trading_fridays(date(YEAR, 1, 1), date(YEAR, 12, 31)))
    for code, d in skip_pairs:
        have[code].add(d)

    needed: dict[date, list[tuple[str, str]]] = defaultdict(list)
    dropped_after_tip = 0
    for code in tryable:
        name, first, last, typical = funds[code]
        typical_i = typical if typical > 0 else 7
        hole_floor = max(typical_i * 2, 7)
        held = sorted(have.get(code, set()) | {first, last})
        tip = list_latest.get(code)
        for a, b in zip(held, held[1:]):
            if (b - a).days <= hole_floor:
                continue
            for friday in trading_fridays(a + timedelta(days=1), b - timedelta(days=1)):
                if friday.year != YEAR or friday in have.get(code, set()):
                    continue
                if tip is not None and friday > tip:
                    dropped_after_tip += 1
                    continue
                needed[friday].append((code, name))

    dates = sorted(needed, reverse=True)
    credits = sum((len(needed[d]) + BATCH_SIZE - 1) // BATCH_SIZE for d in dates)
    pairs = sum(len(needed[d]) for d in dates)
    log(
        f"2026 hole Fridays: funds={len(tryable)} (skip {len(banned)})  "
        f"pairs={pairs}  dates={len(dates)}  planned credits={credits}  "
        f"dropped after 火富牛 latest={dropped_after_tip}  "
        f"empty-stop={args.empty_stop} consecutive weeks"
    )
    for d in dates[:8]:
        log(f"  {d}: {len(needed[d])} products → {(len(needed[d]) + 39) // 40} credits")
    if len(dates) > 8:
        log(f"  … {len(dates) - 8} more Fridays")
    if args.dry_run:
        log("dry-run: no API calls")
        return 0
    if credits == 0:
        log("nothing to fetch")
        return 0

    appid, appkey = load_fof99_keys()
    stopped: set[str] = set()
    last_empty: dict[str, date] = {}
    empty_streak: dict[str, int] = {}
    used = 0
    ok_total = 0
    no_data_total = 0
    stopped_n = 0
    planned = credits
    for friday in dates:
        rows = [(c, n) for c, n in needed[friday] if c not in stopped]
        batches = [rows[i : i + BATCH_SIZE] for i in range(0, len(rows), BATCH_SIZE)]
        for i, chunk in enumerate(batches, start=1):
            codes_only = [c for c, _ in chunk]
            batch_id = f"hole2026-{friday.isoformat()}-{i:04d}"
            log(
                f"credit {used + 1}  {friday}  n={len(codes_only)}  "
                f"{codes_only[0]}…{codes_only[-1]}"
            )
            try:
                data, debug = fetch_batch(appid, appkey, codes_only, friday)
            except Exception as exc:
                log(f"STOP: request exception on {batch_id}: {exc}")
                return 1
            err = debug.get("error_code")
            if err not in (0, "0", None) or data is None:
                log(f"STOP: API error on {batch_id} error_code={err} msg={debug.get('msg')}")
                return 1
            if not isinstance(data, list):
                log(f"STOP: unexpected payload type {type(data)}")
                return 1
            ok, no_data = save_batch(
                conn, friday, chunk, data, batch_id, persist_empty=True
            )
            used += 1
            ok_total += ok
            no_data_total += no_data
            by_code = {
                str(raw.get("reg_code") or "").strip().upper(): raw for raw in (data or [])
            }
            for code, _name in chunk:
                raw = by_code.get(code)
                nav = None
                if raw is not None:
                    try:
                        nav = float(raw.get("nav"))
                    except (TypeError, ValueError):
                        nav = None
                raw_ok = nav is not None and nav > 0
                if raw_ok:
                    empty_streak[code] = 0
                    last_empty.pop(code, None)
                    continue
                prev = last_empty.get(code)
                if prev is not None and prev - friday == timedelta(days=7):
                    empty_streak[code] = empty_streak.get(code, 1) + 1
                else:
                    empty_streak[code] = 1
                last_empty[code] = friday
                if empty_streak[code] >= args.empty_stop and code not in stopped:
                    stopped.add(code)
                    stopped_n += 1
            log(
                f"    saved ok={ok} no_data={no_data}  credits_used={used}  "
                f"funds_stopped={stopped_n}"
            )
    log(format_credit_usage(credit_usage(cur)))
    conn.commit()
    log(
        f"done. credits_used={used} (planned ≤{planned})  "
        f"ok={ok_total} no_data={no_data_total}  stopped_after_{args.empty_stop}_empty={stopped_n}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("stopped by user; committed batches stay in the database", flush=True)
        raise SystemExit(130)
