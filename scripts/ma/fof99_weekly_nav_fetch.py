#!/usr/bin/env python3
"""
Fill weekly Friday platform NAV via 火富牛 FundMultiPrice (40 codes / 1 date / 1 credit).

See docs/fof99-multi-nav-fetch.md. Stops on the first API failure. Commits each batch.

Only `fof99_nav_universe.policy = 'weekly'` is fetched. `skip` and `update_slow` are not paid.

  python scripts/ma/fof99_weekly_nav_fetch.py --dry-run
  python scripts/ma/fof99_weekly_nav_fetch.py
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SDK = ROOT / "fof99_api" / "mall_sdk"
if str(SDK) not in sys.path:
    sys.path.insert(0, str(SDK))
if str(ROOT / "scripts" / "ma") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from cn_market_holidays import (  # noqa: E402
    is_cn_market_closed,
    last_trading_friday_on_or_before,
)

BATCH_SIZE = 40
CREDIT_BUDGET = 40
LATEST_BUDGET = 20
# Sentinel in fof99_nav_fetch_log: this code already had a date-empty latest probe.
LATEST_PROBE_DATE = date(1970, 1, 1)
CSV_PATH = ROOT / "scripts" / "ma" / "fof99_1_3m_927_latest_nav.csv"
HAVE_DATA_CSV = ROOT / "scripts" / "ma" / "fof99_3_6m_have_data.csv"


def load_env() -> None:
    for fname in (".env.local", ".env"):
        f = ROOT / fname
        if not f.is_file():
            continue
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def load_fof99_keys() -> tuple[str, str]:
    appid = (os.environ.get("FOF99_APP_ID") or "").strip()
    appkey = (os.environ.get("FOF99_APP_KEY") or "").strip()
    key_file = ROOT / "fof99_api" / "api_key.txt"
    if (not appid or not appkey) and key_file.is_file():
        text = key_file.read_text(encoding="utf-8", errors="ignore")
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        for i, ln in enumerate(lines):
            if ln.upper() == "APPID" and i + 1 < len(lines):
                appid = appid or lines[i + 1]
            if ln.replace(" ", "") in ("API密钥", "APIKEY") and i + 1 < len(lines):
                appkey = appkey or lines[i + 1]
    if not appid or not appkey:
        raise SystemExit("FOF99_APP_ID / FOF99_APP_KEY missing (or fof99_api/api_key.txt)")
    return appid, appkey


def connect():
    import psycopg2

    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL not set")
    return psycopg2.connect(url)


def ensure_log_table(cur) -> None:
    sql = (ROOT / "scripts" / "db" / "020_create_fof99_nav_fetch_log.sql").read_text(encoding="utf-8")
    cur.execute(sql)


def ensure_universe_table(cur) -> None:
    sql = (ROOT / "scripts" / "db" / "021_create_fof99_nav_universe.sql").read_text(encoding="utf-8")
    cur.execute(sql)


def seed_universe_if_empty(cur) -> dict[str, int]:
    """Snapshot the 927-job policies once. Existing rows are left alone."""
    cur.execute("SELECT COUNT(*) FROM fof99_nav_universe")
    if (cur.fetchone() or [0])[0]:
        return policy_counts(cur)
    cur.execute(
        """
        WITH job AS (
          SELECT DISTINCT UPPER(BTRIM(reg_code)) AS reg_code
          FROM fof99_nav_fetch_log
          WHERE reg_code NOT LIKE 'batch:%'
        ),
        probe AS (
          SELECT UPPER(BTRIM(reg_code)) AS reg_code, status
          FROM fof99_nav_fetch_log
          WHERE price_date = DATE '1970-01-01'
        )
        INSERT INTO fof99_nav_universe (reg_code, product_name, policy, reason)
        SELECT
          j.reg_code,
          COALESCE(i.product_name, ''),
          CASE
            WHEN p.status = 'no_data' THEN 'skip'
            WHEN i.latest_nav_date >= CURRENT_DATE - INTERVAL '1 month' THEN 'weekly'
            ELSE 'update_slow'
          END,
          CASE
            WHEN p.status = 'no_data' THEN 'empty-date probe: 火富牛 has no series'
            WHEN i.latest_nav_date >= CURRENT_DATE - INTERVAL '1 month'
              THEN '1-3m job now within 1 month; weekly Friday FundMultiPrice'
            ELSE '火富牛 latest older than list; do not pay unless policy changed'
          END
        FROM job j
        LEFT JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = j.reg_code
        LEFT JOIN probe p ON p.reg_code = j.reg_code
        ON CONFLICT (reg_code) DO NOTHING
        """
    )
    return policy_counts(cur)


def policy_counts(cur) -> dict[str, int]:
    cur.execute(
        """
        SELECT policy, COUNT(*)
        FROM fof99_nav_universe
        GROUP BY policy
        ORDER BY policy
        """
    )
    return {r[0]: int(r[1]) for r in cur.fetchall()}


def load_skip_codes(cur) -> set[str]:
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code))
        FROM fof99_nav_universe
        WHERE policy = 'skip'
        """
    )
    return {r[0] for r in cur.fetchall()}


def upsert_policies(cur, items: list[tuple[str, str, str, str]]) -> int:
    """Set weekly / update_slow. Never overwrite policy=skip."""
    from psycopg2.extras import execute_values

    rows: list[tuple[str, str, str, str]] = []
    for code, name, policy, reason in items:
        code = (code or "").strip().upper()
        if not code or policy not in ("weekly", "update_slow", "skip"):
            continue
        rows.append((code, name or "", policy, reason))
    if not rows:
        return 0
    execute_values(
        cur,
        """
        INSERT INTO fof99_nav_universe (reg_code, product_name, policy, reason)
        VALUES %s
        ON CONFLICT (reg_code) DO UPDATE SET
          product_name = COALESCE(NULLIF(EXCLUDED.product_name, ''), fof99_nav_universe.product_name),
          policy = EXCLUDED.policy,
          reason = EXCLUDED.reason,
          updated_at = NOW()
        WHERE fof99_nav_universe.policy IS DISTINCT FROM 'skip'
        """,
        rows,
        page_size=500,
    )
    return cur.rowcount or 0


def upsert_skip_codes(cur, items: list[tuple[str, str, str]]) -> int:
    """Label codes skip. Never overwrite policy=weekly."""
    n = 0
    for code, name, reason in items:
        code = (code or "").strip().upper()
        if not code:
            continue
        cur.execute(
            """
            INSERT INTO fof99_nav_universe (reg_code, product_name, policy, reason)
            VALUES (%s, %s, 'skip', %s)
            ON CONFLICT (reg_code) DO UPDATE SET
              product_name = COALESCE(NULLIF(EXCLUDED.product_name, ''), fof99_nav_universe.product_name),
              policy = 'skip',
              reason = EXCLUDED.reason,
              updated_at = NOW()
            WHERE fof99_nav_universe.policy IS DISTINCT FROM 'weekly'
            """,
            (code, name or "", reason),
        )
        n += cur.rowcount
    return n


def write_policy_csv(cur) -> None:
    """Add fof99_policy to the 927-job CSV so the sheet matches the DB freeze."""
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code)), policy
        FROM fof99_nav_universe
        """
    )
    policy_by_code = {r[0]: r[1] for r in cur.fetchall()}
    if not CSV_PATH.is_file():
        return
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
        fieldnames = list(rows[0].keys()) if rows else []
    if "fof99_policy" not in fieldnames:
        fieldnames.append("fof99_policy")
    for row in rows:
        code = str(row.get("beian_hao") or "").strip().upper()
        row["fof99_policy"] = policy_by_code.get(code, "")
    out_path = CSV_PATH
    try:
        with out_path.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
    except OSError:
        out_path = CSV_PATH.with_name("fof99_1_3m_927_with_policy.csv")
        with out_path.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        log(f"{CSV_PATH.name} is locked; wrote {out_path.name} instead")


def load_universe(cur) -> list[tuple[str, str, date]]:
    cur.execute(
        """
        SELECT u.reg_code, COALESCE(i.product_name, u.product_name, ''), i.latest_nav_date
        FROM fof99_nav_universe u
        LEFT JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = u.reg_code
        WHERE u.policy = 'weekly'
          AND u.reg_code IS NOT NULL AND BTRIM(u.reg_code) <> ''
        ORDER BY u.reg_code
        """
    )
    rows = []
    for code, name, tip in cur.fetchall():
        if tip is None:
            continue
        rows.append((code.strip().upper(), name or "", tip))
    return rows


def last_friday_on_or_before(day: date) -> date:
    return day - timedelta(days=(day.weekday() - 4) % 7)


def fridays_after(have_through: date, latest_friday: date) -> list[date]:
    first = last_friday_on_or_before(have_through + timedelta(days=7))
    if first <= have_through:
        first += timedelta(days=7)
    out: list[date] = []
    d = latest_friday
    while d >= first:
        if not is_cn_market_closed(d):
            out.append(d)
        d -= timedelta(days=7)
    return out


def invalidate_detail_nav_cache(cur, codes: list[str]) -> None:
    """Drop product-page NAV cache so the next open remakes the series from private_fund_nav."""
    keys = sorted({c.strip().upper() for c in codes if c and str(c).strip()})
    if not keys:
        return
    cur.execute(
        "DELETE FROM ops_private_fund_detail_nav_cache WHERE cache_key = ANY(%s)",
        (keys,),
    )


def load_have_through(cur, codes: list[str]) -> dict[str, date]:
    if not codes:
        return {}
    cur.execute(
        """
        SELECT u.beian_hao,
               GREATEST(u.latest_nav_date, COALESCE(MAX(n.price_date), u.latest_nav_date))
        FROM (
          SELECT beian_hao, latest_nav_date
          FROM private_fund_info
          WHERE UPPER(BTRIM(beian_hao)) = ANY(%s)
        ) u
        LEFT JOIN private_fund_nav n ON n.beian_hao = u.beian_hao
        GROUP BY u.beian_hao, u.latest_nav_date
        """,
        (codes,),
    )
    return {r[0].strip().upper(): r[1] for r in cur.fetchall()}


def load_skip_pairs(cur, codes: list[str], fridays: list[date]) -> set[tuple[str, date]]:
    skip: set[tuple[str, date]] = set()
    if not codes or not fridays:
        return skip
    cur.execute(
        """
        SELECT UPPER(BTRIM(beian_hao)), price_date
        FROM private_fund_nav
        WHERE UPPER(BTRIM(beian_hao)) = ANY(%s)
          AND price_date = ANY(%s)
        """,
        (codes, fridays),
    )
    for code, d in cur.fetchall():
        skip.add((code, d))
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code)), price_date
        FROM fof99_nav_fetch_log
        WHERE status IN ('ok', 'no_data')
          AND UPPER(BTRIM(reg_code)) = ANY(%s)
          AND price_date = ANY(%s)
        """,
        (codes, fridays),
    )
    for code, d in cur.fetchall():
        skip.add((code, d))
    return skip


def build_batches(
    universe: list[tuple[str, str, date]],
    have_through: dict[str, date],
    skip: set[tuple[str, date]],
    latest_friday: date,
    known_latest: dict[str, date] | None = None,
) -> list[tuple[date, list[tuple[str, str]]]]:
    needed: dict[date, list[tuple[str, str]]] = {}
    for code, name, tip in universe:
        through = have_through.get(code, tip)
        cap = latest_friday
        if known_latest and code in known_latest:
            cap = min(cap, last_friday_on_or_before(known_latest[code]))
        for friday in fridays_after(through, cap):
            if (code, friday) in skip:
                continue
            needed.setdefault(friday, []).append((code, name))
    batches: list[tuple[date, list[tuple[str, str]]]] = []
    for friday in sorted(needed, reverse=True):
        rows = needed[friday]
        for i in range(0, len(rows), BATCH_SIZE):
            batches.append((friday, rows[i : i + BATCH_SIZE]))
    return batches


def load_have_data_latest(
    since: date | None = None,
    before: date | None = None,
) -> dict[str, date]:
    """备案号 → 火富牛 latest from the 3-6m have-data CSV (no paid calls)."""
    out: dict[str, date] = {}
    if not HAVE_DATA_CSV.is_file():
        return out
    with HAVE_DATA_CSV.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            code = (row.get("beian_hao") or "").strip().upper()
            raw = str(row.get("fof99_latest_date") or "").strip()[:10]
            if not code or len(raw) != 10:
                continue
            try:
                dt = date.fromisoformat(raw)
            except ValueError:
                continue
            if since is not None and dt < since:
                continue
            if before is not None and dt >= before:
                continue
            out[code] = dt
    return out


def cap_batches_newest_dates(
    batches: list[tuple[date, list[tuple[str, str]]]],
    *,
    max_dates: int | None,
    exclude: set[date] | None = None,
) -> list[tuple[date, list[tuple[str, str]]]]:
    if exclude:
        batches = [(d, chunk) for d, chunk in batches if d not in exclude]
    if max_dates is None:
        return batches
    keep = sorted({d for d, _ in batches}, reverse=True)[:max_dates]
    keep_set = set(keep)
    return [(d, chunk) for d, chunk in batches if d in keep_set]


def build_known_date_batches(
    universe: list[tuple[str, str, date]],
    known: dict[str, date],
    skip: set[tuple[str, date]],
) -> list[tuple[date, list[tuple[str, str]]]]:
    needed: dict[date, list[tuple[str, str]]] = {}
    for code, name, _tip in universe:
        dt = known.get(code)
        if dt is None or (code, dt) in skip:
            continue
        needed.setdefault(dt, []).append((code, name))
    batches: list[tuple[date, list[tuple[str, str]]]] = []
    for dt in sorted(needed, reverse=True):
        rows = needed[dt]
        for i in range(0, len(rows), BATCH_SIZE):
            batches.append((dt, rows[i : i + BATCH_SIZE]))
    return batches


def fetch_batch(appid: str, appkey: str, codes: list[str], friday: date | None):
    from fof99 import FundMultiPrice

    req = FundMultiPrice(appid, appkey)
    if friday is None:
        req.set_params(reg_code=",".join(codes), date_=None, order_by="nav", order="0")
    else:
        req.set_params(reg_code=",".join(codes), date_=friday.isoformat(), order_by="nav", order="0")
    data = req.do_request(use_df=False)
    debug = req.get_debug_info() or {}
    return data, debug


def load_latest_done(cur, codes: list[str]) -> set[str]:
    if not codes:
        return set()
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code))
        FROM fof99_nav_fetch_log
        WHERE price_date = %s
          AND status IN ('ok', 'no_data')
          AND UPPER(BTRIM(reg_code)) = ANY(%s)
        """,
        (LATEST_PROBE_DATE, codes),
    )
    return {r[0] for r in cur.fetchall()}


def save_latest_batch(
    conn,
    requested: list[tuple[str, str]],
    rows: list[dict],
    batch_id: str,
) -> tuple[int, int, list[str]]:
    by_code: dict[str, dict] = {}
    for raw in rows or []:
        code = str(raw.get("reg_code") or "").strip().upper()
        if not code:
            continue
        by_code[code] = raw

    names = {c: n for c, n in requested}
    ok = 0
    no_data = 0
    sample_dates: list[str] = []
    ok_codes: list[str] = []
    cur = conn.cursor()
    for code, _name in requested:
        raw = by_code.get(code)
        nav = None
        if raw is not None:
            try:
                nav = float(raw.get("nav"))
            except (TypeError, ValueError):
                nav = None
        if raw is None or nav is None or nav <= 0:
            cur.execute(
                """
                INSERT INTO fof99_nav_fetch_log
                  (reg_code, price_date, status, batch_id)
                VALUES (%s, %s, 'no_data', %s)
                ON CONFLICT (reg_code, price_date) DO NOTHING
                """,
                (code, LATEST_PROBE_DATE, batch_id),
            )
            no_data += 1
            continue

        price_date = str(raw.get("price_date") or "")[:10]
        if not price_date:
            cur.execute(
                """
                INSERT INTO fof99_nav_fetch_log
                  (reg_code, price_date, status, batch_id)
                VALUES (%s, %s, 'no_data', %s)
                ON CONFLICT (reg_code, price_date) DO NOTHING
                """,
                (code, LATEST_PROBE_DATE, batch_id),
            )
            no_data += 1
            continue

        cum = raw.get("cumulative_nav")
        withdraw = raw.get("cumulative_nav_withdrawal")
        change = raw.get("price_change")
        cur.execute(
            """
            INSERT INTO private_fund_nav
              (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (beian_hao, price_date) DO UPDATE SET
              nav = EXCLUDED.nav,
              cumulative_nav = COALESCE(EXCLUDED.cumulative_nav, private_fund_nav.cumulative_nav),
              cum_nav_withdrawal = COALESCE(EXCLUDED.cum_nav_withdrawal, private_fund_nav.cum_nav_withdrawal),
              price_change = COALESCE(EXCLUDED.price_change, private_fund_nav.price_change)
            """,
            (code, names.get(code) or None, price_date, nav, cum, withdraw, change),
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
            INSERT INTO fof99_nav_fetch_log
              (reg_code, price_date, status, nav, batch_id)
            VALUES (%s, %s, 'ok', %s, %s)
            ON CONFLICT (reg_code, price_date) DO NOTHING
            """,
            (code, LATEST_PROBE_DATE, nav, batch_id),
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
        ok += 1
        sample_dates.append(price_date)
        ok_codes.append(code)
    invalidate_detail_nav_cache(cur, ok_codes)
    conn.commit()
    return ok, no_data, sample_dates


def run_latest(conn, args) -> int:
    cur = conn.cursor()
    counts = policy_counts(cur)
    log(
        "empty-date latest probe is finished. "
        f"policies weekly={counts.get('weekly', 0)} "
        f"skip={counts.get('skip', 0)} "
        f"update_slow={counts.get('update_slow', 0)}. "
        "skip and update_slow are not re-probed; weekly ETL uses Friday dates only."
    )
    return 0


def save_batch(
    conn,
    friday: date,
    requested: list[tuple[str, str]],
    rows: list[dict],
    batch_id: str,
    *,
    persist_empty: bool,
) -> tuple[int, int]:
    by_code: dict[str, dict] = {}
    for raw in rows or []:
        code = str(raw.get("reg_code") or "").strip().upper()
        if not code:
            continue
        by_code[code] = raw

    names = {c: n for c, n in requested}
    ok = 0
    no_data = 0
    ok_codes: list[str] = []
    cur = conn.cursor()
    for code, _name in requested:
        raw = by_code.get(code)
        nav = None
        if raw is not None:
            try:
                nav = float(raw.get("nav"))
            except (TypeError, ValueError):
                nav = None
        if raw is None or nav is None or nav <= 0:
            if persist_empty:
                cur.execute(
                    """
                    INSERT INTO fof99_nav_fetch_log
                      (reg_code, price_date, status, batch_id)
                    VALUES (%s, %s, 'no_data', %s)
                    ON CONFLICT (reg_code, price_date) DO NOTHING
                    """,
                    (code, friday, batch_id),
                )
            no_data += 1
            continue

        price_date = raw.get("price_date") or friday.isoformat()
        cum = raw.get("cumulative_nav")
        withdraw = raw.get("cumulative_nav_withdrawal")
        change = raw.get("price_change")
        cur.execute(
            """
            INSERT INTO private_fund_nav
              (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (beian_hao, price_date) DO NOTHING
            """,
            (code, names.get(code) or None, price_date, nav, cum, withdraw, change),
        )
        cur.execute(
            """
            INSERT INTO fof99_nav_fetch_log
              (reg_code, price_date, status, nav, batch_id)
            VALUES (%s, %s, 'ok', %s, %s)
            ON CONFLICT (reg_code, price_date) DO NOTHING
            """,
            (code, friday, nav, batch_id),
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
        ok += 1
        ok_codes.append(code)
    invalidate_detail_nav_cache(cur, ok_codes)
    conn.commit()
    return ok, no_data


def log(msg: str) -> None:
    print(msg, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch weekly Friday NAV via FundMultiPrice")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--latest",
        action="store_true",
        help="no-op: empty-date probe is done; skip/update_slow are not re-fetched",
    )
    parser.add_argument("--budget", type=int, default=None)
    parser.add_argument(
        "--only-fof99-since",
        metavar="YYYY-MM-DD",
        help="restrict to weekly funds whose stored 火富牛 latest is on/after this date",
    )
    parser.add_argument(
        "--only-fof99-before",
        metavar="YYYY-MM-DD",
        help="restrict to weekly funds whose stored 火富牛 latest is before this date",
    )
    parser.add_argument(
        "--max-fridays",
        type=int,
        default=None,
        help="keep only the newest N Friday dates (after known-latest batches)",
    )
    parser.add_argument(
        "--skip-latest-friday",
        action="store_true",
        help="do not request this week's Friday (use when 火富牛 latest is mid-week)",
    )
    parser.add_argument(
        "--known-latest-first",
        action="store_true",
        help="fetch each fund's stored 火富牛 latest date before Friday backfill",
    )
    parser.add_argument(
        "--skip-empty-after",
        type=int,
        default=2,
        help="skip remaining chunks of a historical date after N empty batches (0=never)",
    )
    args = parser.parse_args()

    load_env()
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    ensure_log_table(cur)
    ensure_universe_table(cur)
    counts = seed_universe_if_empty(cur)
    if not args.only_fof99_since and not args.only_fof99_before:
        write_policy_csv(cur)
    conn.commit()
    log(
        "fof99 policy: "
        f"weekly={counts.get('weekly', 0)}  "
        f"skip={counts.get('skip', 0)}  "
        f"update_slow={counts.get('update_slow', 0)}"
    )

    if args.latest:
        args.budget = args.budget if args.budget is not None else LATEST_BUDGET
        return run_latest(conn, args)
    args.budget = args.budget if args.budget is not None else CREDIT_BUDGET

    universe = load_universe(cur)
    known_latest: dict[str, date] = {}
    if args.only_fof99_since or args.only_fof99_before:
        since = date.fromisoformat(args.only_fof99_since) if args.only_fof99_since else None
        before = date.fromisoformat(args.only_fof99_before) if args.only_fof99_before else None
        known_latest = load_have_data_latest(since, before)
        allow = set(known_latest)
        universe = [(c, n, t) for c, n, t in universe if c in allow]
        lo = since.isoformat() if since else "…"
        hi = before.isoformat() if before else "…"
        log(f"filter 火富牛 latest in [{lo}, {hi}): {len(universe)} weekly products")
    codes = [c for c, _, _ in universe]
    log(f"universe policy=weekly: {len(universe)} products")
    if not universe:
        return 0

    calendar_friday = last_friday_on_or_before(date.today())
    latest_friday = last_trading_friday_on_or_before(date.today())
    have_through = load_have_through(cur, codes)
    all_fridays: list[date] = []
    d = calendar_friday
    oldest = min(have_through.values()) if have_through else latest_friday
    while d > oldest:
        all_fridays.append(d)
        d -= timedelta(days=7)
    holiday_fridays = [f for f in all_fridays if is_cn_market_closed(f)]
    if holiday_fridays:
        log(
            "skip CN holiday Fridays (no credits): "
            + ", ".join(f.isoformat() for f in holiday_fridays)
        )
    known_dates = sorted({known_latest[c] for c in codes if c in known_latest})
    skip_dates = list(dict.fromkeys((all_fridays or [latest_friday]) + known_dates))
    skip = load_skip_pairs(cur, codes, skip_dates)

    known_batches: list[tuple[date, list[tuple[str, str]]]] = []
    if args.known_latest_first:
        if not known_latest:
            known_latest = load_have_data_latest()
        known_batches = build_known_date_batches(universe, known_latest, skip)
        for code, dt in known_latest.items():
            skip.add((code, dt))
        log(f"known 火富牛 latest batches: {len(known_batches)}")

    friday_batches = build_batches(
        universe, have_through, skip, latest_friday, known_latest=known_latest or None
    )
    exclude = {latest_friday} if args.skip_latest_friday else None
    friday_batches = cap_batches_newest_dates(
        friday_batches, max_dates=args.max_fridays, exclude=exclude
    )
    batches = known_batches + friday_batches
    credits = len(batches)
    log(f"latest Friday: {latest_friday}")
    log(f"planned batches: {credits}  (budget {args.budget})")
    by_date: dict[date, int] = {}
    for dt, chunk in batches:
        by_date[dt] = by_date.get(dt, 0) + 1
    for dt in sorted(by_date, reverse=True):
        n = sum(len(c) for d, c in batches if d == dt)
        kind = "known" if known_batches and any(d == dt for d, _ in known_batches) else "Friday"
        log(f"  {dt} ({kind}): {n} products → {by_date[dt]} credits")

    if credits == 0:
        log("nothing to fetch")
        return 0
    if credits > args.budget:
        log(f"STOP: planned {credits} credits > budget {args.budget}")
        return 2
    if args.dry_run:
        log("dry-run: no API calls")
        return 0

    known_date_set = {d for d, _ in known_batches}
    appid, appkey = load_fof99_keys()
    used = 0
    skip_dates_run: set[date] = set()
    empty_streak = 0
    last_date: date | None = None
    for i, (price_date, chunk) in enumerate(batches, start=1):
        if price_date in skip_dates_run:
            continue
        if is_cn_market_closed(price_date) and price_date not in known_date_set:
            log(f"skip {price_date}: CN market holiday, no API call")
            continue
        if last_date != price_date:
            empty_streak = 0
            last_date = price_date
        codes_only = [c for c, _ in chunk]
        batch_id = f"{price_date.isoformat()}-{i:04d}"
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
            cur.execute(
                """
                INSERT INTO fof99_nav_fetch_log
                  (reg_code, price_date, status, error_code, error_msg, batch_id)
                VALUES (%s, %s, 'error', %s, %s, %s)
                """,
                (
                    f"batch:{','.join(codes_only[:3])}",
                    price_date,
                    str(err),
                    str(debug.get("msg") or "")[:500],
                    batch_id,
                ),
            )
            conn.commit()
            return 1
        if not isinstance(data, list):
            log(f"STOP: unexpected payload type {type(data)} on {batch_id}")
            return 1
        persist_empty = price_date in known_date_set or price_date < latest_friday
        ok, no_data = save_batch(
            conn, price_date, chunk, data, batch_id, persist_empty=persist_empty
        )
        used += 1
        log(f"    saved ok={ok} no_data={no_data}  credits_used={used}/{credits}")
        if price_date == latest_friday and ok == 0 and price_date not in known_date_set:
            skip_dates_run.add(price_date)
            log("latest Friday has no published NAV yet; skip remaining batches for this date")
        elif (
            args.skip_empty_after > 0
            and persist_empty
            and ok == 0
            and price_date not in known_date_set
        ):
            empty_streak += 1
            if empty_streak >= args.skip_empty_after:
                skip_dates_run.add(price_date)
                log(
                    f"{price_date} empty for {empty_streak} batches; "
                    "skip remaining batches for this date"
                )
        else:
            empty_streak = 0

    log(f"done. credits_used={used}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("stopped by user; committed batches stay in the database", flush=True)
        raise SystemExit(130)
