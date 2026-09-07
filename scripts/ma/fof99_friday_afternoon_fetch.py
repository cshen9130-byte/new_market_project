#!/usr/bin/env python3
"""Friday-afternoon 火富牛 fill for the previous trading Friday.

1. FundAdvancedList newest-first, stop when a page has no date >= that Friday.
   Persist weekly / weekly_plus points on that Friday (and newer mid-week extras).
2. FundMultiPrice that Friday for every weekly fund still missing it.
   weekly_plus only if list tip is still before that Friday.

Does not request this week's Friday (usually unpublished Friday afternoon).

  python scripts/ma/fof99_friday_afternoon_fetch.py --dry-run
  python scripts/ma/fof99_friday_afternoon_fetch.py
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SDK = ROOT / "fof99_api" / "mall_sdk"
if str(SDK) not in sys.path:
    sys.path.insert(0, str(SDK))
if str(ROOT / "scripts" / "ma") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from cn_market_holidays import is_cn_market_closed  # noqa: E402
from fof99_mall_credits import (  # noqa: E402
    credit_usage,
    format_credit_usage,
    log_other_mall_credit,
)
from fof99_weekly_nav_fetch import (  # noqa: E402
    BATCH_SIZE,
    connect,
    ensure_log_table,
    ensure_universe_table,
    fetch_batch,
    invalidate_detail_nav_cache,
    last_friday_on_or_before,
    load_env,
    load_fof99_keys,
    load_skip_pairs,
    load_universe,
    log,
    policy_counts,
    save_batch,
)

PAGE_SIZE = 1000
MAX_LIST_PAGES = 20


def parse_iso(raw: object) -> date | None:
    s = str(raw or "").strip()[:10]
    if len(s) != 10 or not s[0].isdigit():
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def previous_week_friday(today: date) -> date:
    """Last calendar Friday strictly before today (Friday afternoon → last week)."""
    return last_friday_on_or_before(today - timedelta(days=1))


def parse_list_page(data, debug: dict) -> list[dict]:
    payload = debug.get("data")
    if isinstance(data, list):
        return data
    if isinstance(payload, dict) and isinstance(payload.get("list"), list):
        return payload["list"]
    return []


def credit_note(cur, batch_id: str) -> str | None:
    cur.execute(
        "SELECT note FROM fof99_mall_other_credit WHERE batch_id = %s",
        (batch_id,),
    )
    row = cur.fetchone()
    return None if row is None else (row[0] or "")


def persist_list_point(
    cur,
    *,
    code: str,
    name: str,
    price_date: date,
    nav: float,
    cum,
    withdraw,
    change,
    batch_id: str,
) -> bool:
    cur.execute(
        """
        INSERT INTO private_fund_nav
          (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (beian_hao, price_date) DO NOTHING
        """,
        (code, name or None, price_date, nav, cum, withdraw, change),
    )
    cur.execute(
        """
        INSERT INTO fof99_nav_fetch_log
          (reg_code, price_date, status, nav, batch_id)
        VALUES (%s, %s, 'ok', %s, %s)
        ON CONFLICT (reg_code, price_date) DO NOTHING
        """,
        (code, price_date, nav, batch_id),
    )
    cur.execute(
        """
        UPDATE private_fund_info
        SET latest_nav = %s,
            latest_nav_date = %s::date,
            updated_at = NOW()
        WHERE beian_hao = %s
          AND (latest_nav_date IS NULL OR latest_nav_date < %s::date)
        """,
        (nav, price_date, code, price_date),
    )
    return True


def persist_list_page(
    cur,
    chunk: list[dict],
    *,
    friday: date,
    names: dict[str, str],
    allow: set[str],
    batch_id: str,
) -> tuple[int, int, int, bool]:
    """Returns friday_hits, extra_hits, ignored, page_has_hot_date."""
    friday_hits = 0
    extra_hits = 0
    ignored = 0
    hot = False
    ok_codes: list[str] = []
    for raw in chunk:
        code = str(raw.get("register_number") or "").strip().upper()
        dt = parse_iso(raw.get("price_date"))
        if dt is not None and dt >= friday:
            hot = True
        if not code or code not in allow or dt is None or dt < friday:
            ignored += 1
            continue
        try:
            nav = float(raw.get("price_nav"))
        except (TypeError, ValueError):
            ignored += 1
            continue
        if nav <= 0:
            ignored += 1
            continue
        persist_list_point(
            cur,
            code=code,
            name=names.get(code, str(raw.get("fund_name") or "")),
            price_date=dt,
            nav=nav,
            cum=raw.get("price_cnw"),
            withdraw=raw.get("price_cw_nav"),
            change=raw.get("price_change"),
            batch_id=batch_id,
        )
        ok_codes.append(code)
        if dt == friday:
            friday_hits += 1
        else:
            extra_hits += 1
    invalidate_detail_nav_cache(cur, ok_codes)
    return friday_hits, extra_hits, ignored, hot


def run_list(
    conn,
    *,
    appid: str,
    appkey: str,
    friday: date,
    names: dict[str, str],
    allow: set[str],
    max_pages: int,
) -> tuple[int, int, int]:
    from fof99 import FundAdvancedList

    cur = conn.cursor()
    pages_paid = 0
    friday_total = 0
    extra_total = 0
    for page in range(1, max_pages + 1):
        batch_id = f"fri-pm-{friday.isoformat()}-p{page:04d}"
        existing = credit_note(cur, batch_id)
        if existing is not None:
            log(f"list page {page}: already logged, skip HTTP")
            if "stop=1" in existing:
                break
            continue

        req = FundAdvancedList(appid, appkey)
        req.set_params(
            type_=1,
            fund_state=1,
            fund_type=2,
            strategy_one="不限",
            strategy_two="不限",
            strategy_three="不限",
            order="0",
            order_by="price_date",
            page=page,
            pagesize=PAGE_SIZE,
        )
        try:
            data = req.do_request(use_df=False)
        except Exception as exc:
            log(f"STOP: list exception on page {page}: {exc}")
            raise
        debug = req.get_debug_info() or {}
        err = debug.get("error_code")
        if err not in (0, "0", None) or data is None:
            log(f"STOP: list API error page={page} error_code={err} msg={debug.get('msg')}")
            raise SystemExit(1)
        chunk = parse_list_page(data, debug)
        fri_n, extra_n, _ign, hot = persist_list_page(
            cur,
            chunk,
            friday=friday,
            names=names,
            allow=allow,
            batch_id=batch_id,
        )
        stop = 0 if hot else 1
        log_other_mall_credit(
            cur,
            api="/fund/advancedlist",
            credits=1,
            note=f"page={page} pagesize={PAGE_SIZE} friday={friday} hot={int(hot)} stop={stop}",
            batch_id=batch_id,
        )
        conn.commit()
        pages_paid += 1
        friday_total += fri_n
        extra_total += extra_n
        log(
            f"list page {page}: n={len(chunk)}  friday_hits={fri_n}  "
            f"midweek_extra={extra_n}  credits_used={pages_paid}  "
            f"{'STOP (page older than Friday)' if stop else 'continue'}"
        )
        if stop or not chunk:
            break
    else:
        log(f"list hit max pages {max_pages}; not all hot rows may be stamped")
    return pages_paid, friday_total, extra_total


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Friday-afternoon previous-Friday fill (list first, then FundMultiPrice)"
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--friday", metavar="YYYY-MM-DD", help="override previous Friday")
    parser.add_argument("--skip-list", action="store_true", help="FundMultiPrice only")
    parser.add_argument("--max-list-pages", type=int, default=MAX_LIST_PAGES)
    parser.add_argument(
        "--scheduled",
        action="store_true",
        help="cron mode: exit 0 if last week's Friday is a CN holiday (no NAV that week)",
    )
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    today = date.today()
    friday = date.fromisoformat(args.friday) if args.friday else previous_week_friday(today)
    if is_cn_market_closed(friday):
        log(f"skip: previous week Friday {friday} is a CN holiday (no NAV to fetch)")
        return 0

    load_env()
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    ensure_log_table(cur)
    ensure_universe_table(cur)
    conn.commit()
    this_friday = last_friday_on_or_before(today)
    log(format_credit_usage(credit_usage(cur)))
    conn.commit()
    log(f"target previous Friday: {friday}  (today={today})")
    if this_friday > friday:
        log(f"this week Friday {this_friday} is not requested (usually unpublished Friday afternoon)")
    log(f"universe {policy_counts(cur)}")

    weekly = load_universe(cur, ("weekly",))
    plus = load_universe(cur, ("weekly_plus",))
    names = {c: n for c, n, _t in weekly + plus}
    allow = set(names)
    skip = load_skip_pairs(cur, list(allow), [friday])
    weekly_need = [(c, n) for c, n, _t in weekly if (c, friday) not in skip]
    plus_need = [(c, n) for c, n, tip in plus if tip < friday and (c, friday) not in skip]
    need = weekly_need + plus_need
    price_credits = (len(need) + BATCH_SIZE - 1) // BATCH_SIZE if need else 0
    log(f"weekly={len(weekly)}  weekly_plus={len(plus)}")
    log(
        f"weekly already have {friday}: {len(weekly) - len(weekly_need)}/{len(weekly)}  "
        f"missing={len(weekly_need)}"
    )
    log(f"weekly_plus behind and missing {friday}: {len(plus_need)}/{len(plus)}")
    log(
        f"plan: list ≤{0 if args.skip_list else args.max_list_pages} pages "
        f"(stop when page has no date ≥ {friday}), then "
        f"FundMultiPrice {len(need)} products → {price_credits} credits  "
        f"(before list stamps)"
    )
    if args.dry_run:
        log("dry-run: no API calls")
        return 0

    appid, appkey = load_fof99_keys()
    list_paid = 0
    if not args.skip_list:
        try:
            list_paid, fri_hits, extra_hits = run_list(
                conn,
                appid=appid,
                appkey=appkey,
                friday=friday,
                names=names,
                allow=allow,
                max_pages=args.max_list_pages,
            )
        except SystemExit:
            return 1
        except Exception:
            return 1
        log(f"list done. pages={list_paid}  friday_stamps={fri_hits}  midweek_extra={extra_hits}")
        skip = load_skip_pairs(cur, list(allow), [friday])
        plus = load_universe(cur, ("weekly_plus",))
        weekly_need = [(c, n) for c, n, _t in weekly if (c, friday) not in skip]
        plus_need = [(c, n) for c, n, tip in plus if tip < friday and (c, friday) not in skip]
        need = weekly_need + plus_need
        price_credits = (len(need) + BATCH_SIZE - 1) // BATCH_SIZE if need else 0
        log(
            f"after list: weekly missing={len(weekly_need)}  "
            f"weekly_plus missing+behind={len(plus_need)} → {price_credits} FundMultiPrice"
        )

    if not need:
        log("nothing to FundMultiPrice")
        log(format_credit_usage(credit_usage(cur)))
        conn.commit()
        return 0

    used = 0
    ok_total = 0
    no_data_total = 0
    batches = [need[i : i + BATCH_SIZE] for i in range(0, len(need), BATCH_SIZE)]
    for i, chunk in enumerate(batches, start=1):
        codes_only = [c for c, _ in chunk]
        batch_id = f"fri-pm-{friday.isoformat()}-m{i:04d}"
        log(
            f"[{i}/{len(batches)}] credit {used + 1}  {friday}  "
            f"n={len(codes_only)}  {codes_only[0]}…{codes_only[-1]}"
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
            log(f"STOP: unexpected payload type {type(data)} on {batch_id}")
            return 1
        ok, no_data = save_batch(
            conn, friday, chunk, data, batch_id, persist_empty=True
        )
        used += 1
        ok_total += ok
        no_data_total += no_data
        log(f"    saved ok={ok} no_data={no_data}  credits_used={used}/{len(batches)}")

    log(format_credit_usage(credit_usage(cur)))
    conn.commit()
    log(
        f"done. list_pages={list_paid if not args.skip_list else 0}  "
        f"FundMultiPrice={used} ok={ok_total} no_data={no_data_total}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("stopped by user; committed batches stay in the database", flush=True)
        raise SystemExit(130)
