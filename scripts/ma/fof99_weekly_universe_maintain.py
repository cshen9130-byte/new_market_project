#!/usr/bin/env python3
"""Weekly universe hygiene. Runs after Friday-afternoon 火富牛 fetch.

1. Downgrade `weekly` → `update_slow` when the last 3 trading Fridays are all
   empty (`no_data` and no NAV). 火富牛 has stopped updating that product.
2. Admit new private funds into `weekly` when they are not yet in the universe,
   established within 2 months, live in `private_fund_info`, and 火富牛 already
   returned NAV (cheaper `/fund/advancedlist` stamp). FundMultiPrice the previous
   Friday only if that point is still missing — typically 0–1 extra credit.

Does not overwrite `skip` or `weekly_plus`. Does not recrawl advancedlist.

  python scripts/ma/fof99_weekly_universe_maintain.py --dry-run
  python scripts/ma/fof99_weekly_universe_maintain.py
"""
from __future__ import annotations

import argparse
import calendar
import json
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "scripts" / "ma") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from cn_market_holidays import is_cn_market_closed  # noqa: E402
from fof99_mall_credits import credit_usage, format_credit_usage  # noqa: E402
from fof99_weekly_nav_fetch import (  # noqa: E402
    BATCH_SIZE,
    DAILY_CREDIT_CAP,
    connect,
    ensure_log_table,
    ensure_universe_table,
    fetch_batch,
    fund_multi_price_credits_today,
    last_friday_on_or_before,
    load_env,
    load_fof99_keys,
    load_skip_pairs,
    log,
    policy_counts,
    save_batch,
    upsert_policies,
)

INCEPTION_MONTHS = 2
EMPTY_WEEKS = 3
MAX_NEW_CREDITS = 3
NEW_FUNDS_JSON = ROOT / "data" / "runtime" / "fof99_friday_new_funds.json"
LATEST_PROBE = date(1970, 1, 1)


def add_months(day: date, months: int) -> date:
    month = day.month - 1 + months
    year = day.year + month // 12
    month = month % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def inception_cutoff(today: date) -> date:
    return add_months(today, -INCEPTION_MONTHS)


def previous_week_friday(today: date) -> date:
    return last_friday_on_or_before(today - timedelta(days=1))


def last_n_trading_fridays(today: date, n: int) -> list[date]:
    """Newest-first trading Fridays (skip CN holidays), starting at last week's Friday."""
    d = previous_week_friday(today)
    out: list[date] = []
    guard = 0
    while len(out) < n and guard < 80:
        if not is_cn_market_closed(d):
            out.append(d)
        d -= timedelta(days=7)
        guard += 1
    return out


def write_new_fund_snapshot(friday: date, rows: list[dict]) -> None:
    NEW_FUNDS_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "friday": friday.isoformat(),
        "candidates": rows,
    }
    NEW_FUNDS_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_new_fund_snapshot(friday: date) -> list[dict]:
    if not NEW_FUNDS_JSON.is_file():
        return []
    try:
        raw = json.loads(NEW_FUNDS_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if str(raw.get("friday") or "")[:10] != friday.isoformat():
        return []
    rows = raw.get("candidates")
    return rows if isinstance(rows, list) else []


def load_universe_codes(cur) -> set[str]:
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code))
        FROM fof99_nav_universe
        WHERE reg_code IS NOT NULL AND BTRIM(reg_code) <> ''
        """
    )
    return {r[0] for r in cur.fetchall()}


def load_weekly_codes(cur) -> list[tuple[str, str]]:
    cur.execute(
        """
        SELECT u.reg_code, COALESCE(i.product_name, u.product_name, '')
        FROM fof99_nav_universe u
        LEFT JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = u.reg_code
        WHERE u.policy = 'weekly'
        ORDER BY u.reg_code
        """
    )
    return [(r[0].strip().upper(), r[1] or "") for r in cur.fetchall() if r[0]]


def downgrade_empty_weeklies(
    cur,
    *,
    fridays: list[date],
    dry_run: bool,
) -> list[tuple[str, str]]:
    """weekly → update_slow when every one of `fridays` is empty."""
    weekly = load_weekly_codes(cur)
    if not weekly or len(fridays) < EMPTY_WEEKS:
        return []
    codes = [c for c, _ in weekly]
    names = {c: n for c, n in weekly}
    has_nav: set[tuple[str, date]] = set()
    log_status: dict[tuple[str, date], str] = {}
    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), price_date
        FROM private_fund_nav
        WHERE UPPER(BTRIM(beian_hao)) = ANY(%s)
          AND price_date = ANY(%s)
        """,
        (codes, fridays),
    )
    for code, dt in cur.fetchall():
        has_nav.add((code, dt))
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code)), price_date, status
        FROM fof99_nav_fetch_log
        WHERE UPPER(BTRIM(reg_code)) = ANY(%s)
          AND price_date = ANY(%s)
          AND price_date > %s
          AND status IN ('ok', 'no_data')
        """,
        (codes, fridays, LATEST_PROBE),
    )
    for code, dt, status in cur.fetchall():
        log_status[(code, dt)] = status

    stale: list[tuple[str, str]] = []
    for code, name in weekly:
        statuses: list[str] = []
        for dt in fridays:
            if (code, dt) in has_nav or log_status.get((code, dt)) == "ok":
                statuses.append("ok")
            elif log_status.get((code, dt)) == "no_data":
                statuses.append("empty")
            else:
                statuses.append("unknown")
        if statuses and all(s == "empty" for s in statuses):
            stale.append((code, name))

    friday_note = ", ".join(d.isoformat() for d in fridays)
    if not stale:
        log(f"downgrade: 0 of {len(weekly)} weekly funds empty on {friday_note}")
        return []

    reason = (
        f"3 consecutive weekly Fridays empty ({', '.join(d.isoformat() for d in fridays)}); "
        "火富牛 no longer updating; weekly → update_slow"
    )
    log(
        f"downgrade: {len(stale)} weekly funds empty on {friday_note}  "
        f"e.g. {stale[0][0]}"
        + (f"…{stale[-1][0]}" if len(stale) > 1 else "")
    )
    if dry_run:
        return stale
    cur.execute(
        """
        UPDATE fof99_nav_universe
        SET policy = 'update_slow',
            reason = %s,
            updated_at = NOW()
        WHERE policy = 'weekly'
          AND UPPER(BTRIM(reg_code)) = ANY(%s)
        """,
        (reason, [c for c, _ in stale]),
    )
    return stale


def _info_row(cur, code: str) -> tuple[str, date | None] | None:
    cur.execute(
        """
        SELECT COALESCE(product_name, ''), inception_date
        FROM private_fund_info
        WHERE UPPER(BTRIM(beian_hao)) = %s
        """,
        (code,),
    )
    row = cur.fetchone()
    if row is None:
        return None
    return (row[0] or "", row[1])


def load_sql_new_candidates(cur, *, cutoff: date, in_universe: set[str]) -> list[dict]:
    """Young funds already in private_fund_info with a 火富牛 NAV stamp, not in universe."""
    cur.execute(
        """
        SELECT UPPER(BTRIM(i.beian_hao)),
               COALESCE(i.product_name, ''),
               i.inception_date,
               i.latest_nav_date
        FROM private_fund_info i
        WHERE i.inception_date >= %s
          AND i.latest_nav_date IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM fof99_nav_fetch_log l
            WHERE UPPER(BTRIM(l.reg_code)) = UPPER(BTRIM(i.beian_hao))
              AND l.status = 'ok'
              AND l.price_date > %s
          )
        """,
        (cutoff, LATEST_PROBE),
    )
    out: list[dict] = []
    for code, name, inception, tip in cur.fetchall():
        code = (code or "").strip().upper()
        if not code or code in in_universe:
            continue
        out.append(
            {
                "reg_code": code,
                "product_name": name or "",
                "inception_date": inception.isoformat() if inception else None,
                "price_date": tip.isoformat() if tip else None,
            }
        )
    return out


def admit_new_weeklies(
    cur,
    *,
    friday: date,
    cutoff: date,
    dry_run: bool,
) -> list[tuple[str, str]]:
    in_universe = load_universe_codes(cur)
    merged: dict[str, dict] = {}
    for raw in load_new_fund_snapshot(friday) + load_sql_new_candidates(
        cur, cutoff=cutoff, in_universe=in_universe
    ):
        code = str(raw.get("reg_code") or "").strip().upper()
        if not code or code in in_universe:
            continue
        merged[code] = raw

    admitted: list[tuple[str, str]] = []
    skipped_no_info = 0
    skipped_old = 0
    for code, raw in sorted(
        merged.items(),
        key=lambda item: str(item[1].get("inception_date") or ""),
        reverse=True,
    ):
        info = _info_row(cur, code)
        if info is None:
            skipped_no_info += 1
            continue
        name, inception = info
        name = name or str(raw.get("product_name") or "")
        inc = inception
        if inc is None:
            raw_inc = str(raw.get("inception_date") or "")[:10]
            if len(raw_inc) == 10:
                try:
                    inc = date.fromisoformat(raw_inc)
                except ValueError:
                    inc = None
        if inc is None or inc < cutoff:
            skipped_old += 1
            continue
        admitted.append((code, name))

    log(
        f"admit: {len(admitted)} new funds (inception ≥ {cutoff}, 火富牛 NAV, not in universe)"
        + (f"  skipped_no_info={skipped_no_info}" if skipped_no_info else "")
        + (f"  skipped_old_or_blank_inception={skipped_old}" if skipped_old else "")
    )
    if not admitted:
        return []
    if dry_run:
        log(f"  dry-run sample: {[c for c, _ in admitted[:8]]}")
        return admitted
    reason = (
        f"new fund inception within {INCEPTION_MONTHS} months; "
        "火富牛 advancedlist NAV; weekly Friday FundMultiPrice"
    )
    upsert_policies(cur, [(c, n, "weekly", reason) for c, n in admitted])
    return admitted


def fetch_new_friday(
    conn,
    *,
    friday: date,
    admitted: list[tuple[str, str]],
    dry_run: bool,
    max_new_credits: int,
) -> tuple[int, int, int]:
    """FundMultiPrice previous Friday for newly admitted weeklies still missing it."""
    if not admitted:
        return 0, 0, 0
    cur = conn.cursor()
    skip = load_skip_pairs(cur, [c for c, _ in admitted], [friday])
    need = [(c, n) for c, n in admitted if (c, friday) not in skip]
    credits = (len(need) + BATCH_SIZE - 1) // BATCH_SIZE if need else 0
    used_today = fund_multi_price_credits_today(cur)
    remain = max(0, DAILY_CREDIT_CAP - used_today)
    cap = min(max(0, max_new_credits), remain)
    if credits > cap:
        log(
            f"admit fetch: {len(need)} missing {friday} would cost {credits} credits; "
            f"capped at {cap} (max_new={max_new_credits}, daily remain={remain})"
        )
        need = need[: cap * BATCH_SIZE]
        credits = (len(need) + BATCH_SIZE - 1) // BATCH_SIZE if need else 0
    log(
        f"admit fetch: {len(admitted)} new weekly  already have {friday}="
        f"{len(admitted) - len(need)}  missing={len(need)} → {credits} credits"
    )
    if dry_run or not need:
        return 0, 0, 0
    if credits <= 0:
        return 0, 0, 0

    appid, appkey = load_fof99_keys()
    used = 0
    ok_total = 0
    no_data_total = 0
    batches = [need[i : i + BATCH_SIZE] for i in range(0, len(need), BATCH_SIZE)]
    for i, chunk in enumerate(batches, start=1):
        codes_only = [c for c, _ in chunk]
        batch_id = f"fri-pm-{friday.isoformat()}-u{i:04d}"
        log(
            f"  [new {i}/{len(batches)}] credit {used + 1}  {friday}  "
            f"n={len(codes_only)}  {codes_only[0]}…{codes_only[-1]}"
        )
        try:
            data, debug = fetch_batch(appid, appkey, codes_only, friday)
        except Exception as exc:
            log(f"STOP: request exception on {batch_id}: {exc}")
            raise SystemExit(1) from exc
        err = debug.get("error_code")
        if err not in (0, "0", None) or data is None:
            log(f"STOP: API error on {batch_id} error_code={err} msg={debug.get('msg')}")
            raise SystemExit(1)
        if not isinstance(data, list):
            log(f"STOP: unexpected payload type {type(data)} on {batch_id}")
            raise SystemExit(1)
        ok, no_data = save_batch(
            conn, friday, chunk, data, batch_id, persist_empty=True
        )
        used += 1
        ok_total += ok
        no_data_total += no_data
        log(f"    saved ok={ok} no_data={no_data}  credits_used={used}/{len(batches)}")
    return used, ok_total, no_data_total


def run_maintain(
    conn,
    *,
    friday: date,
    today: date | None = None,
    dry_run: bool = False,
    skip_fetch: bool = False,
    max_new_credits: int = MAX_NEW_CREDITS,
    empty_weeks: int = EMPTY_WEEKS,
) -> int:
    today = today or date.today()
    cutoff = inception_cutoff(today)
    fridays = last_n_trading_fridays(today, empty_weeks)
    cur = conn.cursor()
    ensure_log_table(cur)
    ensure_universe_table(cur)
    conn.commit()
    log("universe maintain start")
    log(
        f"  previous Friday={friday}  inception cutoff={cutoff}  "
        f"empty-check Fridays={[d.isoformat() for d in fridays]}"
    )
    log(f"  before {policy_counts(cur)}")

    stale = downgrade_empty_weeklies(cur, fridays=fridays, dry_run=dry_run)
    if not dry_run:
        conn.commit()
    admitted = admit_new_weeklies(cur, friday=friday, cutoff=cutoff, dry_run=dry_run)
    if not dry_run:
        conn.commit()

    used = ok = no_data = 0
    if not skip_fetch:
        used, ok, no_data = fetch_new_friday(
            conn,
            friday=friday,
            admitted=admitted,
            dry_run=dry_run,
            max_new_credits=max_new_credits,
        )
    log(format_credit_usage(credit_usage(cur)))
    conn.commit()
    log(
        f"universe maintain done. downgraded={len(stale)}  admitted={len(admitted)}  "
        f"new_FundMultiPrice={used} ok={ok} no_data={no_data}"
    )
    log(f"  after {policy_counts(cur)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Weekly 火富牛 universe hygiene (after Friday-afternoon fetch)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--friday", metavar="YYYY-MM-DD", help="override previous Friday")
    parser.add_argument("--skip-fetch", action="store_true", help="label only; no FundMultiPrice")
    parser.add_argument(
        "--max-new-credits",
        type=int,
        default=MAX_NEW_CREDITS,
        help=f"cap FundMultiPrice credits for newly admitted funds (default {MAX_NEW_CREDITS})",
    )
    parser.add_argument(
        "--empty-weeks",
        type=int,
        default=EMPTY_WEEKS,
        help=f"consecutive empty trading Fridays before weekly → update_slow (default {EMPTY_WEEKS})",
    )
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    today = date.today()
    friday = date.fromisoformat(args.friday) if args.friday else previous_week_friday(today)
    if is_cn_market_closed(friday):
        log(f"skip: previous week Friday {friday} is a CN holiday")
        return 0

    load_env()
    conn = connect()
    conn.autocommit = False
    return run_maintain(
        conn,
        friday=friday,
        today=today,
        dry_run=args.dry_run,
        skip_fetch=args.skip_fetch,
        max_new_credits=max(0, args.max_new_credits),
        empty_weeks=max(1, args.empty_weeks),
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("stopped by user; committed batches stay in the database", flush=True)
        raise SystemExit(130)
