#!/usr/bin/env python3
"""Friday-afternoon 火富牛 fill for the previous week.

A holiday Friday is not requested. The job uses the last open day of that week
and keeps any earlier open day in the same week (2026-10-02 → 2026-09-30;
2026-09-25 → 2026-09-24). The week is skipped only when Mon–Fri is all closed.

1. FundAdvancedList newest-first, stop when a page has no date >= that week.
   Persist weekly / weekly_plus points on the request date (and other days in
   a holiday week). Also stamp NAV for products established within 2 months
   that are not yet in the universe (no extra list credits).
2. FundMultiPrice that request date for every weekly fund still missing the week.
   weekly_plus only if list tip is still before that date.
3. Late retry: previous trading Friday, only for funds that were no_data then
   and are ok on this Friday (they reported this week, so last Friday may
   have landed late). One attempt. Still empty stays no_data.
4. Universe maintain (default): downgrade 3-week empty weeklies; admit those
   new young funds as weekly and FundMultiPrice only the ones still missing
   that Friday.

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

from cn_market_holidays import is_cn_market_closed, resolve_week_target  # noqa: E402
from fof99_mall_credits import (  # noqa: E402
    credit_usage,
    format_credit_usage,
    log_other_mall_credit,
)
from fof99_weekly_nav_fetch import (  # noqa: E402
    BATCH_SIZE,
    DAILY_CREDIT_CAP,
    connect,
    ensure_log_table,
    ensure_universe_table,
    fetch_batch,
    fund_multi_price_credits_today,
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
from fof99_weekly_universe_maintain import (  # noqa: E402
    inception_cutoff,
    run_maintain,
    write_new_fund_snapshot,
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


def prior_trading_friday(friday: date) -> date | None:
    """Trading Friday strictly before `friday` (holiday Fridays skipped)."""
    d = friday - timedelta(days=7)
    for _ in range(16):
        if not is_cn_market_closed(d):
            return d
        d -= timedelta(days=7)
    return None


def load_late_retry_codes(cur, *, friday: date, prior: date) -> list[tuple[str, str]]:
    """no_data on the prior Friday, ok on this Friday, and still missing that prior NAV."""
    cur.execute(
        """
        SELECT UPPER(BTRIM(old.reg_code)), COALESCE(u.product_name, '')
        FROM fof99_nav_fetch_log old
        JOIN fof99_nav_fetch_log arrived
          ON UPPER(BTRIM(arrived.reg_code)) = UPPER(BTRIM(old.reg_code))
         AND arrived.price_date = %s
         AND arrived.status = 'ok'
        LEFT JOIN fof99_nav_universe u
          ON UPPER(BTRIM(u.reg_code)) = UPPER(BTRIM(old.reg_code))
        WHERE old.price_date = %s
          AND old.status = 'no_data'
          AND NOT EXISTS (
            SELECT 1 FROM private_fund_nav n
            WHERE UPPER(BTRIM(n.beian_hao)) = UPPER(BTRIM(old.reg_code))
              AND n.price_date = %s
          )
        ORDER BY 1
        """,
        (friday, prior, prior),
    )
    return [(r[0], r[1] or "") for r in cur.fetchall() if r[0]]


def price_credits_today(cur) -> int:
    """FundMultiPrice log batches plus same-day /fund/price rows in the other-mall ledger."""
    cur.execute(
        """
        SELECT COALESCE(SUM(credits), 0)::int
        FROM fof99_mall_other_credit
        WHERE api = '/fund/price'
          AND (fetched_at AT TIME ZONE 'Asia/Shanghai')::date
            = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
        """
    )
    other = int((cur.fetchone() or [0])[0])
    return fund_multi_price_credits_today(cur) + other


def save_late_retry(
    conn,
    prior: date,
    requested: list[tuple[str, str]],
    rows: list[dict],
    batch_id: str,
) -> tuple[int, int]:
    """Upgrade a prior-Friday no_data row when that date is present now. Count 1 credit."""
    by_code: dict[str, dict] = {}
    for raw in rows or []:
        code = str(raw.get("reg_code") or "").strip().upper()
        if code:
            by_code[code] = raw
    names = {c: n for c, n in requested}
    ok = 0
    still_empty = 0
    ok_codes: list[str] = []
    cur = conn.cursor()
    want = prior.isoformat()
    for code, _name in requested:
        raw = by_code.get(code)
        nav = None
        if raw is not None:
            try:
                nav = float(raw.get("nav"))
            except (TypeError, ValueError):
                nav = None
        returned = str((raw or {}).get("price_date") or "")[:10]
        if raw is None or nav is None or nav <= 0 or returned != want:
            still_empty += 1
            continue
        cur.execute(
            """
            INSERT INTO private_fund_nav
              (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (beian_hao, price_date) DO NOTHING
            """,
            (
                code,
                names.get(code) or None,
                prior,
                nav,
                raw.get("cumulative_nav"),
                raw.get("cumulative_nav_withdrawal"),
                raw.get("price_change"),
            ),
        )
        cur.execute(
            """
            UPDATE fof99_nav_fetch_log
            SET status = 'ok',
                nav = %s,
                error_code = NULL,
                error_msg = NULL
            WHERE UPPER(BTRIM(reg_code)) = %s
              AND price_date = %s
              AND status = 'no_data'
            """,
            (nav, code, prior),
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
            (nav, prior, code, prior),
        )
        ok += 1
        ok_codes.append(code)
    invalidate_detail_nav_cache(cur, ok_codes)
    log_other_mall_credit(
        cur,
        api="/fund/price",
        credits=1,
        note=(
            f"late retry {want} after arrived Friday "
            f"n={len(requested)} ok={ok} still_empty={still_empty}"
        ),
        batch_id=batch_id,
    )
    conn.commit()
    return ok, still_empty


def retry_last_week_misses(
    conn,
    *,
    friday: date,
    appid: str | None,
    appkey: str | None,
    dry_run: bool,
) -> int:
    """One FundMultiPrice pass on the prior Friday for funds that arrived this Friday."""
    prior = prior_trading_friday(friday)
    if prior is None:
        log("late retry: no prior trading Friday")
        return 0
    cur = conn.cursor()
    codes = load_late_retry_codes(cur, friday=friday, prior=prior)
    batches = [codes[i : i + BATCH_SIZE] for i in range(0, len(codes), BATCH_SIZE)]
    log(
        f"late retry: {prior} for funds with {friday} ok and {prior} no_data: "
        f"{len(codes)} products → {len(batches)} credits"
    )
    if dry_run or not codes:
        return 0
    if not appid or not appkey:
        log("STOP: late retry missing 火富牛 keys")
        return 1
    used_today = price_credits_today(cur)
    remaining = max(0, DAILY_CREDIT_CAP - used_today)
    if len(batches) > remaining:
        log(
            f"late retry cut from {len(batches)} to {remaining} credits "
            f"({used_today} already used today, cap {DAILY_CREDIT_CAP})"
        )
        batches = batches[:remaining]
    if not batches:
        log("late retry skipped: daily credit cap reached")
        return 0

    ok_total = 0
    empty_total = 0
    paid = 0
    for i, chunk in enumerate(batches, start=1):
        batch_id = f"fri-late-{friday.isoformat()}-{prior.isoformat()}-m{i:04d}"
        if credit_note(cur, batch_id) is not None:
            log(f"[late {i}/{len(batches)}] {batch_id} already paid, skip HTTP")
            continue
        only = [c for c, _ in chunk]
        log(
            f"[late {i}/{len(batches)}] credit {paid + 1}/{len(batches)}  {prior}  "
            f"n={len(only)}  {only[0]}…{only[-1]}"
        )
        try:
            data, debug = fetch_batch(appid, appkey, only, prior)
        except Exception as exc:
            log(f"STOP: late-retry exception on {batch_id}: {exc}")
            return 1
        err = debug.get("error_code")
        if err not in (0, "0", None, 0.0) or data is None:
            log(f"STOP: late-retry API error on {batch_id} error_code={err} msg={debug.get('msg')}")
            return 1
        if not isinstance(data, list):
            log(f"STOP: late-retry unexpected payload type {type(data)} on {batch_id}")
            return 1
        ok, empty = save_late_retry(conn, prior, chunk, data, batch_id)
        paid += 1
        ok_total += ok
        empty_total += empty
        log(
            f"    late saved ok={ok} still_empty={empty}  "
            f"credits_used={paid}/{len(batches)}"
        )
        cur = conn.cursor()
    log(format_credit_usage(credit_usage(conn.cursor())))
    log(f"late retry done. paid={paid} ok={ok_total} still_empty={empty_total}")
    return 0


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
    in_universe: set[str],
    cutoff: date,
    batch_id: str,
    not_before: date | None = None,
) -> tuple[int, int, int, bool, list[dict]]:
    """Returns friday_hits, extra_hits, ignored, page_has_hot_date, new_fund_rows."""
    floor = not_before or friday
    friday_hits = 0
    extra_hits = 0
    ignored = 0
    hot = False
    ok_codes: list[str] = []
    new_rows: list[dict] = []
    for raw in chunk:
        code = str(raw.get("register_number") or "").strip().upper()
        dt = parse_iso(raw.get("price_date"))
        if dt is not None and dt >= floor:
            hot = True
        inception = parse_iso(raw.get("inception_date"))
        young_new = (
            bool(code)
            and code not in in_universe
            and inception is not None
            and inception >= cutoff
        )
        if not code or dt is None or dt < floor:
            ignored += 1
            continue
        if code not in allow and not young_new:
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
            # List fields are named the other way from FundMultiPrice.
            # price_cnw is 累计净值 → cum_nav_withdrawal; price_cw_nav is 复权净值 → cumulative_nav.
            cum=raw.get("price_cw_nav"),
            withdraw=raw.get("price_cnw"),
            change=raw.get("price_change"),
            batch_id=batch_id,
        )
        ok_codes.append(code)
        if dt == friday:
            friday_hits += 1
        else:
            extra_hits += 1
        if young_new:
            new_rows.append(
                {
                    "reg_code": code,
                    "product_name": str(raw.get("fund_name") or ""),
                    "inception_date": inception.isoformat(),
                    "price_date": dt.isoformat(),
                    "nav": nav,
                }
            )
    invalidate_detail_nav_cache(cur, ok_codes)
    return friday_hits, extra_hits, ignored, hot, new_rows


def run_list(
    conn,
    *,
    appid: str,
    appkey: str,
    friday: date,
    names: dict[str, str],
    allow: set[str],
    in_universe: set[str],
    cutoff: date,
    max_pages: int,
    not_before: date | None = None,
) -> tuple[int, int, int, list[dict]]:
    from fof99 import FundAdvancedList

    cur = conn.cursor()
    pages_paid = 0
    friday_total = 0
    extra_total = 0
    new_by_code: dict[str, dict] = {}
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
        fri_n, extra_n, _ign, hot, new_rows = persist_list_page(
            cur,
            chunk,
            friday=friday,
            names=names,
            allow=allow,
            in_universe=in_universe,
            cutoff=cutoff,
            batch_id=batch_id,
            not_before=not_before,
        )
        for row in new_rows:
            new_by_code[row["reg_code"]] = row
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
            f"midweek_extra={extra_n}  new_young={len(new_rows)}  "
            f"credits_used={pages_paid}  "
            f"{'STOP (page older than Friday)' if stop else 'continue'}"
        )
        if stop or not chunk:
            break
    else:
        log(f"list hit max pages {max_pages}; not all hot rows may be stamped")
    return pages_paid, friday_total, extra_total, list(new_by_code.values())


def missing_week_pairs(
    cur,
    weekly: list[tuple[str, str, date]],
    plus: list[tuple[str, str, date]],
    cover_days: list[date],
    price_date: date,
    *,
    min_tip: date | None = None,
) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Funds with no NAV and no ok/no_data log on any cover day.

    `min_tip` drops funds whose stored latest is still before the week. They
    did not publish that week; paying a holiday substitute for them is empty.
    Newest tips are first so a probe samples funds that did publish recently.
    """
    codes = [c for c, _, _ in weekly] + [c for c, _, _ in plus]
    skip = load_skip_pairs(cur, codes, cover_days)

    def covered(code: str) -> bool:
        return any((code, day) in skip for day in cover_days)

    weekly_ranked = [
        (c, n, tip)
        for c, n, tip in weekly
        if not covered(c) and (min_tip is None or tip >= min_tip)
    ]
    weekly_ranked.sort(key=lambda row: row[2], reverse=True)
    weekly_need = [(c, n) for c, n, _tip in weekly_ranked]
    plus_need = [
        (c, n)
        for c, n, tip in plus
        if tip < price_date and not covered(c) and (min_tip is None or tip >= min_tip)
    ]
    return weekly_need, plus_need


def _request_chunk(
    conn,
    *,
    appid: str,
    appkey: str,
    chunk: list[tuple[str, str]],
    price_date: date,
    batch_id: str,
    persist_empty: bool,
) -> tuple[int, int]:
    try:
        data, debug = fetch_batch(appid, appkey, [c for c, _ in chunk], price_date)
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
    return save_batch(conn, price_date, chunk, data, batch_id, persist_empty=persist_empty)


def _note_probe_spend(conn, batch_id: str, price_date: date, n: int) -> None:
    """A holiday-date probe that returned nothing still spent one mall credit."""
    cur = conn.cursor()
    log_other_mall_credit(
        cur,
        api="/fund/price",
        credits=1,
        note=f"holiday-week probe {price_date} empty n={n}; date not used",
        batch_id=batch_id,
    )
    conn.commit()


def _stamp_probe_empties(conn, chunk: list[tuple[str, str]], price_date: date, batch_id: str) -> int:
    """Log no_data for a probe we are keeping, on the same timestamp as its ok rows."""
    cur = conn.cursor()
    codes = [c for c, _ in chunk]
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code))
        FROM fof99_nav_fetch_log
        WHERE price_date = %s
          AND status = 'ok'
          AND UPPER(BTRIM(reg_code)) = ANY(%s)
        """,
        (price_date, codes),
    )
    have = {r[0] for r in cur.fetchall()}
    cur.execute(
        """
        SELECT MIN(fetched_at)
        FROM fof99_nav_fetch_log
        WHERE batch_id = %s AND price_date = %s
        """,
        (batch_id, price_date),
    )
    stamped = (cur.fetchone() or [None])[0]
    n = 0
    for code, _name in chunk:
        if code in have:
            continue
        if stamped is not None:
            cur.execute(
                """
                INSERT INTO fof99_nav_fetch_log
                  (reg_code, price_date, status, batch_id, fetched_at)
                VALUES (%s, %s, 'no_data', %s, %s)
                ON CONFLICT (reg_code, price_date) DO NOTHING
                """,
                (code, price_date, batch_id, stamped),
            )
        else:
            cur.execute(
                """
                INSERT INTO fof99_nav_fetch_log
                  (reg_code, price_date, status, batch_id)
                VALUES (%s, %s, 'no_data', %s)
                ON CONFLICT (reg_code, price_date) DO NOTHING
                """,
                (code, price_date, batch_id),
            )
        n += 1
    conn.commit()
    return n


def fill_price_dates(
    conn,
    *,
    appid: str,
    appkey: str,
    candidates: list[date],
    weekly: list[tuple[str, str, date]],
    plus: list[tuple[str, str, date]],
    cover_days: list[date],
    probe_fallback: bool,
) -> tuple[int, int, int, date | None]:
    """FundMultiPrice one date. Holiday weeks probe newest-first and step back if empty."""
    cur = conn.cursor()
    used = 0
    ok_total = 0
    no_data_total = 0
    min_tip = cover_days[0] if probe_fallback else None
    for price_date in candidates:
        weekly_need, plus_need = missing_week_pairs(
            cur, weekly, plus, cover_days, price_date, min_tip=min_tip
        )
        need = weekly_need + plus_need
        if not need:
            log(f"{price_date}: nothing left to FundMultiPrice")
            return used, ok_total, no_data_total, price_date
        remaining = max(0, DAILY_CREDIT_CAP - price_credits_today(cur))
        batches = [need[i : i + BATCH_SIZE] for i in range(0, len(need), BATCH_SIZE)]
        if len(batches) > remaining:
            log(
                f"{price_date}: cut {len(batches)} batches to {remaining} "
                f"(daily cap {DAILY_CREDIT_CAP})"
            )
            batches = batches[:remaining]
        if not batches:
            log(f"STOP: daily FundMultiPrice cap {DAILY_CREDIT_CAP} reached before {price_date}")
            return used, ok_total, no_data_total, None
        log(
            f"FundMultiPrice {price_date}: weekly missing={len(weekly_need)}  "
            f"weekly_plus missing+behind={len(plus_need)} → {len(batches)} credits"
        )

        if probe_fallback:
            probe_ok = 0
            probed_chunks: list[tuple[str, list[tuple[str, str]]]] = []
            for i in range(min(2, len(batches))):
                chunk = batches[i]
                batch_id = f"fri-pm-{price_date.isoformat()}-m{i + 1:04d}"
                codes_only = [c for c, _ in chunk]
                log(
                    f"[probe {i + 1}] {price_date}  "
                    f"n={len(codes_only)}  {codes_only[0]}…{codes_only[-1]}"
                )
                ok, _no_data = _request_chunk(
                    conn,
                    appid=appid,
                    appkey=appkey,
                    chunk=chunk,
                    price_date=price_date,
                    batch_id=batch_id,
                    persist_empty=False,
                )
                probed_chunks.append((batch_id, chunk))
                probe_ok += ok
                log(f"    probe saved ok={ok} (empties not logged yet)")
                if probe_ok > 0:
                    break
            if probe_ok == 0:
                stamp = date.today().strftime("%H%M%S")
                for i, (batch_id, chunk) in enumerate(probed_chunks, start=1):
                    _note_probe_spend(
                        conn,
                        f"fri-probe-{price_date.isoformat()}-m{i:04d}-{stamp}",
                        price_date,
                        len(chunk),
                    )
                log(f"{price_date} not available (probe ok=0); trying an earlier day in the week")
                continue
            for batch_id, chunk in probed_chunks:
                no_data_total += _stamp_probe_empties(conn, chunk, price_date, batch_id)
            ok_total += probe_ok
            used += len(probed_chunks)
            weekly_need, plus_need = missing_week_pairs(
                cur, weekly, plus, cover_days, price_date, min_tip=min_tip
            )
            need = weekly_need + plus_need
            remaining = max(0, DAILY_CREDIT_CAP - price_credits_today(cur))
            batches = [need[i : i + BATCH_SIZE] for i in range(0, len(need), BATCH_SIZE)]
            if len(batches) > remaining:
                log(
                    f"{price_date}: cut remaining {len(batches)} batches to {remaining} "
                    f"(daily cap {DAILY_CREDIT_CAP})"
                )
                batches = batches[:remaining]
            log(f"  committed to {price_date}; still missing {len(need)} → {len(batches)} credits")

        for i, chunk in enumerate(batches, start=1):
            if price_credits_today(cur) >= DAILY_CREDIT_CAP:
                log(f"STOP: daily FundMultiPrice cap {DAILY_CREDIT_CAP} reached")
                break
            codes_only = [c for c, _ in chunk]
            batch_id = f"fri-pm-{price_date.isoformat()}-m{used + 1:04d}"
            log(
                f"[{i}/{len(batches)}] credit {used + 1}  {price_date}  "
                f"n={len(codes_only)}  {codes_only[0]}…{codes_only[-1]}"
            )
            ok, no_data = _request_chunk(
                conn,
                appid=appid,
                appkey=appkey,
                chunk=chunk,
                price_date=price_date,
                batch_id=batch_id,
                persist_empty=True,
            )
            used += 1
            ok_total += ok
            no_data_total += no_data
            log(f"    saved ok={ok} no_data={no_data}  credits_used={used}")
        return used, ok_total, no_data_total, price_date
    return used, ok_total, no_data_total, None


def finish_with_maintain(args, conn, friday: date, today: date) -> int:
    if args.skip_maintain:
        return 0
    return run_maintain(conn, friday=friday, today=today, dry_run=args.dry_run)


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
        help="accepted for the scheduler; holiday Fridays use the week's last open day",
    )
    parser.add_argument(
        "--skip-maintain",
        action="store_true",
        help="do not run universe maintain after this fetch",
    )
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")
    today = date.today()
    nominal = date.fromisoformat(args.friday) if args.friday else previous_week_friday(today)
    friday, cover_days = resolve_week_target(nominal)
    if friday is None:
        log(f"skip: week of {nominal} has no trading day")
        return 0
    holiday_week = friday != nominal
    list_floor = cover_days[0] if holiday_week else friday

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
    if holiday_week:
        covered = ", ".join(d.isoformat() for d in cover_days)
        log(
            f"Friday {nominal} is a CN holiday; request {friday} "
            f"and keep any open day in the week ({covered})"
        )
    log(f"target previous Friday: {nominal}  fetch={friday}  (today={today})")
    if this_friday > nominal:
        log(f"this week Friday {this_friday} is not requested (usually unpublished Friday afternoon)")
    log(f"universe {policy_counts(cur)}")

    weekly = load_universe(cur, ("weekly",))
    plus = load_universe(cur, ("weekly_plus",))
    names = {c: n for c, n, _t in weekly + plus}
    allow = set(names)
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code))
        FROM fof99_nav_universe
        WHERE reg_code IS NOT NULL AND BTRIM(reg_code) <> ''
        """
    )
    in_universe = {r[0] for r in cur.fetchall()}
    cutoff = inception_cutoff(today)
    weekly_need, plus_need = missing_week_pairs(cur, weekly, plus, cover_days, friday)
    need = weekly_need + plus_need
    price_credits = (len(need) + BATCH_SIZE - 1) // BATCH_SIZE if need else 0
    log(f"weekly={len(weekly)}  weekly_plus={len(plus)}")
    log(
        f"weekly already have this week: {len(weekly) - len(weekly_need)}/{len(weekly)}  "
        f"missing={len(weekly_need)}"
    )
    log(f"weekly_plus behind and missing {friday}: {len(plus_need)}/{len(plus)}")
    log(
        f"plan: list ≤{0 if args.skip_list else args.max_list_pages} pages "
        f"(stop when page has no date ≥ {list_floor}; also stamp inception≥{cutoff} "
        f"not in universe), then "
        f"FundMultiPrice {len(need)} products → {price_credits} credits  "
        f"(before list stamps)"
    )
    if args.dry_run:
        log("dry-run: no API calls")
        rc = retry_last_week_misses(
            conn, friday=nominal, appid=None, appkey=None, dry_run=True
        )
        if rc != 0:
            return rc
        return finish_with_maintain(args, conn, friday, today)

    appid, appkey = load_fof99_keys()
    list_paid = 0
    if not args.skip_list:
        try:
            list_paid, fri_hits, extra_hits, new_rows = run_list(
                conn,
                appid=appid,
                appkey=appkey,
                friday=friday,
                names=names,
                allow=allow,
                in_universe=in_universe,
                cutoff=cutoff,
                max_pages=args.max_list_pages,
                not_before=list_floor,
            )
        except SystemExit:
            return 1
        except Exception:
            return 1
        if list_paid or new_rows:
            write_new_fund_snapshot(friday, new_rows)
        log(
            f"list done. pages={list_paid}  friday_stamps={fri_hits}  "
            f"midweek_extra={extra_hits}  new_young={len(new_rows)}"
        )
        plus = load_universe(cur, ("weekly_plus",))
        weekly_need, plus_need = missing_week_pairs(cur, weekly, plus, cover_days, friday)
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
        rc = retry_last_week_misses(
            conn, friday=nominal, appid=appid, appkey=appkey, dry_run=False
        )
        if rc != 0:
            return rc
        return finish_with_maintain(args, conn, friday, today)

    candidates = list(reversed(cover_days)) if holiday_week else [friday]
    try:
        used, ok_total, no_data_total, chosen = fill_price_dates(
            conn,
            appid=appid,
            appkey=appkey,
            candidates=candidates,
            weekly=weekly,
            plus=plus,
            cover_days=cover_days,
            probe_fallback=holiday_week,
        )
    except SystemExit:
        return 1
    if holiday_week and chosen is not None and chosen != friday:
        log(f"used {chosen} because {friday} was not available")
        friday = chosen

    log(format_credit_usage(credit_usage(cur)))
    conn.commit()
    log(
        f"done. list_pages={list_paid if not args.skip_list else 0}  "
        f"FundMultiPrice={used} ok={ok_total} no_data={no_data_total}"
    )
    rc = retry_last_week_misses(
        conn, friday=nominal, appid=appid, appkey=appkey, dry_run=False
    )
    if rc != 0:
        return rc
    return finish_with_maintain(args, conn, friday, today)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("stopped by user; committed batches stay in the database", flush=True)
        raise SystemExit(130)
