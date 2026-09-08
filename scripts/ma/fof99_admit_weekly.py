#!/usr/bin/env python3
"""Admit a 火富牛 product into weekly Friday updates, with a one-shot history fill.

Default: `FundPrice` (`GET /price`) — one 备案号, full platform NAV series, 1 credit.
Then the Friday ETL keeps it current via FundMultiPrice (40 codes × 1 Friday).

  python scripts/ma/fof99_admit_weekly.py --codes SAUN55 --dry-run
  python scripts/ma/fof99_admit_weekly.py --codes SAUN55
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "scripts" / "ma") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from fof99_mall_credits import credit_usage, format_credit_usage, log_other_mall_credit  # noqa: E402
from fof99_weekly_nav_fetch import (  # noqa: E402
    connect,
    ensure_log_table,
    ensure_universe_table,
    invalidate_detail_nav_cache,
    load_env,
    load_fof99_keys,
    log,
)


def parse_codes(raw: str) -> list[str]:
    codes: list[str] = []
    seen: set[str] = set()
    for part in raw.replace(";", ",").split(","):
        code = part.strip().upper()
        if not code or code in seen:
            continue
        seen.add(code)
        codes.append(code)
    if not codes:
        raise SystemExit("no --codes given")
    return codes


def resolve_names(cur, codes: list[str]) -> list[tuple[str, str]]:
    cur.execute(
        """
        SELECT UPPER(BTRIM(a.fund_no)), a.fund_name, i.product_name
        FROM (SELECT UNNEST(%s::text[]) AS code) c
        LEFT JOIN amac_private_funds a ON UPPER(BTRIM(a.fund_no)) = c.code
        LEFT JOIN private_fund_info i ON UPPER(BTRIM(i.beian_hao)) = c.code
        """,
        (codes,),
    )
    by_code = {r[0]: r for r in cur.fetchall() if r[0]}
    out: list[tuple[str, str]] = []
    missing: list[str] = []
    for code in codes:
        row = by_code.get(code)
        name = ""
        if row:
            name = (row[1] or row[2] or "").strip()
        if not name:
            missing.append(code)
        out.append((code, name or code))
    if missing:
        raise SystemExit("not in private_fund_info / amac_private_funds: " + ", ".join(missing))
    return out


def force_weekly(cur, items: list[tuple[str, str]], reason: str) -> None:
    for code, name in items:
        cur.execute(
            """
            INSERT INTO fof99_nav_universe (reg_code, product_name, policy, reason)
            VALUES (%s, %s, 'weekly', %s)
            ON CONFLICT (reg_code) DO UPDATE SET
              product_name = COALESCE(NULLIF(EXCLUDED.product_name, ''), fof99_nav_universe.product_name),
              policy = 'weekly',
              reason = EXCLUDED.reason,
              updated_at = NOW()
            """,
            (code, name, reason),
        )


def fetch_fund_history(appid: str, appkey: str, code: str):
    from fof99 import FundPrice

    req = FundPrice(appid, appkey)
    req.set_params(reg_code=code, order_by="price_date", order=1)
    data = req.do_request(use_df=False)
    return data, req.get_debug_info() or {}


def _as_rows(data) -> list[dict]:
    if data is None:
        return []
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        for key in ("list", "items", "data", "price"):
            inner = data.get(key)
            if isinstance(inner, list):
                return [row for row in inner if isinstance(row, dict)]
        return [data]
    return []


def save_fund_history(conn, code: str, name: str, rows: list[dict]) -> tuple[int, str | None, str | None]:
    from psycopg2.extras import execute_values

    tuples: list[tuple] = []
    dates: list[str] = []
    for raw in rows:
        price_date = str(raw.get("price_date") or "")[:10]
        try:
            nav = float(raw.get("nav"))
        except (TypeError, ValueError):
            nav = None
        if len(price_date) != 10 or nav is None or nav <= 0:
            continue
        tuples.append(
            (
                code,
                name or None,
                price_date,
                nav,
                raw.get("cumulative_nav"),
                raw.get("cumulative_nav_withdrawal"),
                raw.get("price_change"),
            )
        )
        dates.append(price_date)
    if not tuples:
        return 0, None, None

    cur = conn.cursor()
    execute_values(
        cur,
        """
        INSERT INTO private_fund_nav
          (beian_hao, product_name, price_date, nav, cumulative_nav, cum_nav_withdrawal, price_change)
        VALUES %s
        ON CONFLICT (beian_hao, price_date) DO UPDATE SET
          nav = EXCLUDED.nav,
          product_name = COALESCE(EXCLUDED.product_name, private_fund_nav.product_name),
          cumulative_nav = COALESCE(EXCLUDED.cumulative_nav, private_fund_nav.cumulative_nav),
          cum_nav_withdrawal = COALESCE(EXCLUDED.cum_nav_withdrawal, private_fund_nav.cum_nav_withdrawal),
          price_change = COALESCE(EXCLUDED.price_change, private_fund_nav.price_change)
        """,
        tuples,
        page_size=500,
    )
    first_date, last_date = min(dates), max(dates)
    last_nav = next(t[3] for t in tuples if t[2] == last_date)
    cur.execute(
        """
        UPDATE private_fund_info
        SET latest_nav = %s,
            latest_nav_date = %s::date,
            updated_at = NOW()
        WHERE beian_hao = %s
          AND (latest_nav_date IS NULL OR latest_nav_date <= %s::date)
        """,
        (last_nav, last_date, code, last_date),
    )
    invalidate_detail_nav_cache(cur, [code])
    conn.commit()
    return len(tuples), first_date, last_date


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="Admit codes as weekly and FundPrice full NAV history (1 credit per product)."
    )
    parser.add_argument("--codes", required=True, help="comma-separated 备案号")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--reason",
        default="operator override: 火富牛 has series; weekly Friday FundMultiPrice",
    )
    args = parser.parse_args()
    codes = parse_codes(args.codes)

    load_env()
    conn = connect()
    cur = conn.cursor()
    ensure_log_table(cur)
    ensure_universe_table(cur)
    conn.commit()

    requested = resolve_names(cur, codes)
    usage_before = credit_usage(cur)
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code)), policy, reason
        FROM fof99_nav_universe
        WHERE UPPER(BTRIM(reg_code)) = ANY(%s)
        """,
        (codes,),
    )
    existing = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

    log(f"codes: {', '.join(c for c, _ in requested)}")
    for code, name in requested:
        prev = existing.get(code)
        log(f"  {code}  {name}")
        log(f"    universe now: {prev[0] if prev else '(absent)'}  {prev[1] if prev else ''}")
    log(
        f"plan: upsert policy=weekly, then FundPrice GET /price "
        f"({len(requested)} credit(s), full history per product)"
    )
    log(format_credit_usage(usage_before))

    if args.dry_run:
        log("dry-run: no writes, no API calls")
        return 0

    force_weekly(cur, requested, args.reason)
    conn.commit()
    log("universe: policy=weekly saved")

    appid, appkey = load_fof99_keys()
    failed = 0
    for code, name in requested:
        batch_id = f"fundprice-history-{date.today().isoformat()}-{code}"
        log(f"API FundPrice /price  {code}  batch={batch_id}")
        try:
            data, debug = fetch_fund_history(appid, appkey, code)
        except Exception as exc:
            log(f"STOP: request exception on {code}: {exc}")
            return 1
        err = debug.get("error_code")
        if err not in (0, "0", None, 0.0) or data is None:
            log(f"STOP: API error on {code} error_code={err} msg={debug.get('msg')}")
            return 1
        rows = _as_rows(data)
        n, first_date, last_date = save_fund_history(conn, code, name, rows)
        cur = conn.cursor()
        log_other_mall_credit(
            cur,
            api="/price",
            credits=1,
            note=f"FundPrice history {code} n={n} {first_date}..{last_date}",
            batch_id=batch_id,
        )
        conn.commit()
        log(f"    saved {n} NAV rows  {first_date} → {last_date}")
        if n == 0:
            failed += 1
    usage_after = credit_usage(conn.cursor())
    log(format_credit_usage(usage_after))
    log("weekly Friday ETL will keep these codes current via FundMultiPrice batches")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
