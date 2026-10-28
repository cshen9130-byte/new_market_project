#!/usr/bin/env python3
"""Tue-Thu cheap FundAdvancedList fill for tracking-pool fof99 products.

Uses at most `--max-list-pages` credits (default 2). No FundMultiPrice, no
universe maintain, no skip-revival, no FundPrice history.

Target = tracking_pool intersect ops best-update-channel fof99 intersect
(not in universe OR policy weekly/weekly_plus). Primary stamps: list tip
covers this run's previous Friday week. Leftover rows on the same paid pages:
prioritized hole dates (default 2026-10-09) then other missing tips.

  python scripts/ma/fof99_midweek_advancedlist_etl.py --dry-run
  python scripts/ma/fof99_midweek_advancedlist_etl.py
  python scripts/ma/fof99_midweek_advancedlist_etl.py --scheduled

Disable with FOF99_MIDWEEK_ETL_DISABLED=1.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SDK = ROOT / "fof99_api" / "mall_sdk"
if str(SDK) not in sys.path:
    sys.path.insert(0, str(SDK))
if str(ROOT / "scripts" / "ma") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from cn_market_holidays import resolve_week_target  # noqa: E402
from fof99_mall_credits import (  # noqa: E402
    credit_usage,
    format_credit_usage,
    log_other_mall_credit,
)
from fof99_friday_afternoon_fetch import (  # noqa: E402
    credit_note,
    parse_iso,
    parse_list_page,
    persist_list_point,
    previous_week_friday,
)
from fof99_weekly_nav_fetch import (  # noqa: E402
    connect,
    ensure_log_table,
    invalidate_detail_nav_cache,
    load_env,
    load_fof99_keys,
    log,
)

PAGE_SIZE = 1000
DEFAULT_MAX_PAGES = 2
DEFAULT_HOLE_DATES = (date(2026, 10, 9),)
# 不限 — same as Friday advancedlist crawl
STRATEGY_UNLIMITED = "\u4e0d\u9650"

# Ops best-channel SQL (mirrors lib/server/ops-data-overview.ts channels CTE).
TARGET_CODES_SQL = """
WITH pool AS MATERIALIZED (
  SELECT DISTINCT UPPER(BTRIM(register_number)) AS code
  FROM tracking_pool
  WHERE NULLIF(BTRIM(register_number), '') IS NOT NULL
),
channels AS MATERIALIZED (
  SELECT code, channel, MAX(d) AS d
  FROM (
    SELECT p.code, 'email'::text AS channel, e.nav_date::date AS d
    FROM pool p
    JOIN ops_email_nav_records e ON UPPER(BTRIM(e.product_code)) = p.code
    WHERE e.nav IS NOT NULL AND e.nav_date IS NOT NULL AND e.nav_date > DATE '1970-01-01'
    UNION ALL
    SELECT p.code,
      CASE
        WHEN COALESCE(v.source, '') = 'manual_upload'
          OR COALESCE(v.crawl_email_account, '') = 'team_manual_upload'
        THEN 'manual' ELSE 'email'
      END,
      v.valuation_date::date
    FROM pool p
    JOIN ops_email_valuation_records v ON UPPER(BTRIM(v.product_code)) = p.code
    WHERE v.valuation_date IS NOT NULL AND v.valuation_date > DATE '1970-01-01'
    UNION ALL
    SELECT p.code, 'manual', m.nav_date::date
    FROM pool p
    JOIN ops_team_nav_manual m ON UPPER(BTRIM(m.beian_hao)) = p.code
    WHERE m.unit_nav IS NOT NULL
      AND m.nav_date IS NOT NULL
      AND m.nav_type = 'pre_fee'
      AND m.nav_date > DATE '1970-01-01'
    UNION ALL
    SELECT p.code, 'fof99', f.price_date::date
    FROM pool p
    JOIN fof99_nav_fetch_log f ON UPPER(BTRIM(f.reg_code)) = p.code
    WHERE f.status = 'ok' AND f.price_date > DATE '1970-01-01'
  ) s
  WHERE d IS NOT NULL
  GROUP BY code, channel
),
best_channel AS MATERIALIZED (
  SELECT DISTINCT ON (code) code, channel
  FROM channels
  ORDER BY code, d DESC,
    CASE channel WHEN 'manual' THEN 3 WHEN 'email' THEN 2 ELSE 1 END DESC
)
SELECT p.code
FROM pool p
JOIN best_channel bc ON bc.code = p.code AND bc.channel = 'fof99'
LEFT JOIN fof99_nav_universe u ON UPPER(BTRIM(u.reg_code)) = p.code
WHERE u.reg_code IS NULL
   OR u.policy IN ('weekly', 'weekly_plus')
ORDER BY 1
"""


def load_target_codes(cur) -> set[str]:
    cur.execute(TARGET_CODES_SQL)
    return {r[0] for r in cur.fetchall() if r[0]}


def load_names(cur, codes: set[str]) -> dict[str, str]:
    if not codes:
        return {}
    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), COALESCE(product_name, '')
        FROM private_fund_info
        WHERE UPPER(BTRIM(beian_hao)) = ANY(%s)
        """,
        (list(codes),),
    )
    return {r[0]: (r[1] or "") for r in cur.fetchall()}


def load_have_dates(cur, codes: set[str], dates: list[date]) -> set[tuple[str, date]]:
    """(code, date) already in private_fund_nav or fetch-log ok/no_data."""
    if not codes or not dates:
        return set()
    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), price_date::date
        FROM private_fund_nav
        WHERE UPPER(BTRIM(beian_hao)) = ANY(%s)
          AND price_date = ANY(%s)
        UNION
        SELECT UPPER(BTRIM(reg_code)), price_date::date
        FROM fof99_nav_fetch_log
        WHERE UPPER(BTRIM(reg_code)) = ANY(%s)
          AND price_date = ANY(%s)
          AND status IN ('ok', 'no_data')
        """,
        (list(codes), dates, list(codes), dates),
    )
    return {(r[0], r[1]) for r in cur.fetchall()}


def parse_hole_dates(raw: str | None) -> list[date]:
    if raw is None:
        return list(DEFAULT_HOLE_DATES)
    out: list[date] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        out.append(date.fromisoformat(part))
    return out


def classify_row(
    *,
    code: str,
    price_date: date,
    target: set[str],
    cover_days: set[date],
    hole_dates: set[date],
    have: set[tuple[str, date]],
) -> str | None:
    """Return stamp bucket or None to ignore.

    primary — tip covers this run's week
    hole    — prioritized missing dates (e.g. 2026-10-09)
    other   — other missing tips already on the paid page
    """
    if code not in target:
        return None
    if (code, price_date) in have:
        return None
    if price_date in cover_days:
        return "primary"
    if price_date in hole_dates:
        return "hole"
    return "other"


def stamp_page(
    cur,
    chunk: list[dict],
    *,
    target: set[str],
    names: dict[str, str],
    cover_days: set[date],
    hole_dates: set[date],
    have: set[tuple[str, date]],
    batch_id: str,
) -> dict[str, int]:
    counts = {"primary": 0, "hole": 0, "other": 0, "ignored": 0}
    ok_codes: list[str] = []
    for raw in chunk:
        code = str(raw.get("register_number") or "").strip().upper()
        dt = parse_iso(raw.get("price_date"))
        if not code or dt is None:
            counts["ignored"] += 1
            continue
        bucket = classify_row(
            code=code,
            price_date=dt,
            target=target,
            cover_days=cover_days,
            hole_dates=hole_dates,
            have=have,
        )
        if bucket is None:
            counts["ignored"] += 1
            continue
        try:
            nav = float(raw.get("price_nav"))
        except (TypeError, ValueError):
            counts["ignored"] += 1
            continue
        if nav <= 0:
            counts["ignored"] += 1
            continue
        persist_list_point(
            cur,
            code=code,
            name=names.get(code, str(raw.get("fund_name") or "")),
            price_date=dt,
            nav=nav,
            cum=raw.get("price_cw_nav"),
            withdraw=raw.get("price_cnw"),
            change=raw.get("price_change"),
            batch_id=batch_id,
        )
        have.add((code, dt))
        ok_codes.append(code)
        counts[bucket] += 1
    invalidate_detail_nav_cache(cur, ok_codes)
    return counts


def run_pages(
    conn,
    *,
    appid: str,
    appkey: str,
    friday: date,
    target: set[str],
    names: dict[str, str],
    cover_days: set[date],
    hole_dates: set[date],
    have: set[tuple[str, date]],
    max_pages: int,
    dry_run: bool,
) -> tuple[int, dict[str, int]]:
    from fof99 import FundAdvancedList

    cur = conn.cursor()
    pages_paid = 0
    totals = {"primary": 0, "hole": 0, "other": 0, "ignored": 0}
    for page in range(1, max_pages + 1):
        batch_id = f"midweek-{friday.isoformat()}-p{page:04d}"
        existing = credit_note(cur, batch_id)
        if existing is not None:
            log(f"list page {page}: already logged ({batch_id}), skip HTTP")
            continue

        if dry_run:
            log(
                f"dry-run: would pay 1 credit for advancedlist page={page} "
                f"pagesize={PAGE_SIZE} batch_id={batch_id}"
            )
            pages_paid += 1
            continue

        req = FundAdvancedList(appid, appkey)
        req.set_params(
            type_=1,
            fund_state=1,
            fund_type=2,
            strategy_one=STRATEGY_UNLIMITED,
            strategy_two=STRATEGY_UNLIMITED,
            strategy_three=STRATEGY_UNLIMITED,
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
            log(
                f"STOP: list API error page={page} error_code={err} "
                f"msg={debug.get('msg')}"
            )
            raise SystemExit(1)
        chunk = parse_list_page(data, debug)
        page_counts = stamp_page(
            cur,
            chunk,
            target=target,
            names=names,
            cover_days=cover_days,
            hole_dates=hole_dates,
            have=have,
            batch_id=batch_id,
        )
        log_other_mall_credit(
            cur,
            api="/fund/advancedlist",
            credits=1,
            note=(
                f"midweek page={page} pagesize={PAGE_SIZE} friday={friday} "
                f"primary={page_counts['primary']} hole={page_counts['hole']} "
                f"other={page_counts['other']}"
            ),
            batch_id=batch_id,
        )
        conn.commit()
        pages_paid += 1
        for k, v in page_counts.items():
            totals[k] += v
        log(
            f"list page {page}: n={len(chunk)}  primary={page_counts['primary']}  "
            f"hole={page_counts['hole']}  other={page_counts['other']}  "
            f"ignored={page_counts['ignored']}  credits_used={pages_paid}/{max_pages}"
        )
        if not chunk:
            break
    return pages_paid, totals


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Tue-Thu FundAdvancedList midweek fill "
            "(<=2 credits, no FundMultiPrice)"
        )
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--friday", metavar="YYYY-MM-DD", help="override previous Friday")
    parser.add_argument(
        "--max-list-pages",
        type=int,
        default=DEFAULT_MAX_PAGES,
        help=f"max advancedlist pages / credits (default {DEFAULT_MAX_PAGES})",
    )
    parser.add_argument(
        "--hole-dates",
        metavar="YYYY-MM-DD,YYYY-MM-DD",
        default=None,
        help="comma-separated prioritized backfill dates (default 2026-10-09)",
    )
    parser.add_argument(
        "--scheduled",
        action="store_true",
        help="accepted for the scheduler; same behavior as manual",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="ignore FOF99_MIDWEEK_ETL_DISABLED",
    )
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    if os.environ.get("FOF99_MIDWEEK_ETL_DISABLED") == "1" and not args.force:
        log("skip: FOF99_MIDWEEK_ETL_DISABLED=1")
        return 0

    max_pages = max(1, int(args.max_list_pages))
    today = date.today()
    nominal = date.fromisoformat(args.friday) if args.friday else previous_week_friday(today)
    friday, cover_list = resolve_week_target(nominal)
    if friday is None:
        log(f"skip: week of {nominal} has no trading day")
        return 0
    cover_days = set(cover_list)
    hole_dates = set(parse_hole_dates(args.hole_dates))
    hole_dates -= cover_days

    load_env()
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    ensure_log_table(cur)
    conn.commit()

    log(format_credit_usage(credit_usage(cur)))
    conn.commit()
    if friday != nominal:
        covered = ", ".join(d.isoformat() for d in sorted(cover_days))
        log(
            f"Friday {nominal} is a CN holiday; cover open days ({covered}), "
            f"fetch tip date preference {friday}"
        )
    log(
        f"midweek target previous Friday: {nominal}  "
        f"cover={sorted(cover_days)}  (today={today})"
    )
    log(f"max_list_pages={max_pages}  hole_dates={sorted(hole_dates)}")

    target = load_target_codes(cur)
    names = load_names(cur, target)
    interest_dates = sorted(cover_days | hole_dates)
    have = load_have_dates(cur, target, interest_dates)
    missing_cover = sum(
        1 for c in target if not any((c, d) in have for d in cover_days)
    )
    missing_holes = {
        d: sum(1 for c in target if (c, d) not in have) for d in sorted(hole_dates)
    }
    log(f"target tracking intersect fof99 (-skip/slow)={len(target)}")
    log(f"missing this-week cover tip: {missing_cover}/{len(target)}")
    for d, n in missing_holes.items():
        log(f"missing hole {d.isoformat()}: {n}/{len(target)}")

    if args.dry_run:
        log(
            "dry-run: no API calls; would walk advancedlist pages "
            "and stamp primary/hole/other"
        )
        pages_paid, _totals = run_pages(
            conn,
            appid="",
            appkey="",
            friday=friday,
            target=target,
            names=names,
            cover_days=cover_days,
            hole_dates=hole_dates,
            have=have,
            max_pages=max_pages,
            dry_run=True,
        )
        log(f"dry-run plan: pages={pages_paid}  (no stamps)")
        return 0

    appid, appkey = load_fof99_keys()
    try:
        pages_paid, totals = run_pages(
            conn,
            appid=appid,
            appkey=appkey,
            friday=friday,
            target=target,
            names=names,
            cover_days=cover_days,
            hole_dates=hole_dates,
            have=have,
            max_pages=max_pages,
            dry_run=False,
        )
    except SystemExit:
        return 1
    except Exception:
        return 1

    log(format_credit_usage(credit_usage(cur)))
    conn.commit()
    log(
        f"done. pages={pages_paid}  primary={totals['primary']}  "
        f"hole={totals['hole']}  other={totals['other']}  "
        f"ignored={totals['ignored']}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("stopped by user; committed pages stay in the database", flush=True)
        raise SystemExit(130)
