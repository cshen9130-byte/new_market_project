#!/usr/bin/env python3
"""火富牛 mall credit ledger: FundMultiPrice log + other mall APIs.

Total consumed = fof99_credit_usage.total_credits
  = FundMultiPrice (fof99_nav_fetch_log, batch × minute)
  + other mall calls (fof99_mall_other_credit)

  python scripts/ma/fof99_mall_credits.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SQL_PATH = ROOT / "scripts" / "db" / "022_create_fof99_mall_other_credit.sql"


def ensure_other_credit_table(cur) -> None:
    cur.execute(SQL_PATH.read_text(encoding="utf-8"))


def log_other_mall_credit(
    cur,
    *,
    api: str,
    credits: int = 1,
    note: str = "",
    batch_id: str | None = None,
) -> None:
    """Record one or more non-/fund/price mall credits. Skip duplicate batch_id."""
    if credits <= 0:
        return
    cur.execute(
        """
        INSERT INTO fof99_mall_other_credit (api, credits, note, batch_id)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (batch_id) DO NOTHING
        """,
        (api, credits, note or None, batch_id),
    )


def credit_usage(cur) -> dict[str, int]:
    ensure_other_credit_table(cur)
    cur.execute(
        """
        SELECT fund_multi_price_credits, other_mall_credits, total_credits
        FROM fof99_credit_usage
        """
    )
    price, other, total = cur.fetchone()
    return {
        "fund_multi_price": int(price),
        "other_mall": int(other),
        "total": int(total),
    }


def format_credit_usage(usage: dict[str, int]) -> str:
    return (
        f"credits consumed: {usage['total']}  "
        f"(FundMultiPrice={usage['fund_multi_price']} + other_mall={usage['other_mall']})"
    )


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.path.insert(0, str(ROOT / "scripts" / "ma"))
    from fof99_weekly_nav_fetch import connect, load_env

    load_env()
    conn = connect()
    cur = conn.cursor()
    usage = credit_usage(cur)
    conn.commit()
    print(format_credit_usage(usage), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
