#!/usr/bin/env python3
"""Save 火富牛 list products whose NAV date is on or after the coverage cutoff.

One mall credit per page. Stops once a page goes older than the cutoff.
Replaces fof99_list_recent_products only after the read finishes.
"""
from __future__ import annotations

import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SDK = ROOT / "fof99_api" / "mall_sdk"
sys.path.insert(0, str(SDK))
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from fof99 import FundAdvancedList  # noqa: E402
from fof99_mall_credits import credit_usage, format_credit_usage, log_other_mall_credit  # noqa: E402
from fof99_weekly_nav_fetch import connect, load_env, load_fof99_keys  # noqa: E402

CUTOFF = "2026-09-16"
PAGE_SIZE = 1000
MAX_CALLS = 16
POLICIES = ("weekly", "weekly_plus", "update_slow", "skip", "none")


def parse_iso(raw: object) -> str:
    s = str(raw or "").strip()[:10]
    return s if len(s) == 10 and s[0].isdigit() else ""


def parse_nav(raw: object) -> float | None:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value <= 0:
        return None
    return value


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    load_env()
    appid, appkey = load_fof99_keys()
    conn = connect()
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute((ROOT / "scripts" / "db" / "023_create_fof99_list_recent_products.sql").read_text(encoding="utf-8"))
    conn.commit()
    print(format_credit_usage(credit_usage(cur)), flush=True)
    conn.commit()
    cur.execute(
        """
        SELECT UPPER(BTRIM(reg_code)), policy
        FROM fof99_nav_universe
        WHERE NULLIF(BTRIM(reg_code), '') IS NOT NULL
        """
    )
    policies = {code: policy for code, policy in cur.fetchall()}
    conn.commit()

    seen: dict[str, tuple[str, str, float | None]] = {}
    calls = 0
    page = 1
    while calls < MAX_CALLS:
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
        data = req.do_request(use_df=False)
        calls += 1
        log_other_mall_credit(
            cur,
            api="/fund/advancedlist",
            credits=1,
            note=f"recent-list products page={page} cutoff={CUTOFF}",
            batch_id=f"recent-list-{CUTOFF}-p{page:04d}-{int(time.time())}",
        )
        conn.commit()
        debug = req.get_debug_info() or {}
        err = debug.get("error_code")
        if err not in (0, "0", None):
            print(f"STOP error_code={err} msg={debug.get('msg')}", flush=True)
            return 1
        chunk = data if isinstance(data, list) else []
        dates = [parse_iso(row.get("price_date")) for row in chunk]
        dated = [day for day in dates if day]
        kept = 0
        for raw, day in zip(chunk, dates):
            if not day or day < CUTOFF:
                continue
            code = str(raw.get("register_number") or "").strip().upper()
            if not code or code in seen:
                continue
            name = str(raw.get("fund_name") or "").strip()
            seen[code] = (name, day, parse_nav(raw.get("price_nav")))
            kept += 1
        print(
            f"page={page} n={len(chunk)} kept={kept} "
            f"newest={max(dated) if dated else '-'} oldest={min(dated) if dated else '-'}",
            flush=True,
        )
        if not chunk or not dated or min(dated) < CUTOFF or len(chunk) < PAGE_SIZE:
            break
        page += 1
        time.sleep(0.12)

    measured_on = date.today().isoformat()
    rows = []
    counts = {key: 0 for key in POLICIES}
    for code, (name, day, nav) in seen.items():
        policy = policies.get(code, "none")
        if policy not in counts:
            policy = "none"
        counts[policy] += 1
        rows.append((code, name or None, day, nav, policy, measured_on, CUTOFF))

    cur.execute("DELETE FROM fof99_list_recent_products")
    cur.executemany(
        """
        INSERT INTO fof99_list_recent_products
          (reg_code, product_name, price_date, price_nav, policy, measured_on, cutoff)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        rows,
    )
    conn.commit()
    print(f"recent_1m={len(rows)} calls={calls} measured_on={measured_on}", flush=True)
    for key in POLICIES:
        print(f"  {key}={counts[key]}", flush=True)
    print(format_credit_usage(credit_usage(cur)), flush=True)
    conn.commit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
