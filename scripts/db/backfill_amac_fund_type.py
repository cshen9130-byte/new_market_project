#!/usr/bin/env python3
"""
backfill_amac_fund_type.py
==========================
Fetch AMAC fund detail pages and populate amac_private_funds.fund_type.

基金类型 is only on the detail page, not the list API — required to match
AMAC monthly bulletin fund counts (私募证券投资基金 / 私募资产配置基金).

Usage:
    python scripts/db/backfill_amac_fund_type.py
    python scripts/db/backfill_amac_fund_type.py --batch-size 500 --max-batches 20
"""

from __future__ import annotations

import argparse
import http.client
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "fetch_amac_data"))

from amac_fund_detail import parse_fund_type  # noqa: E402

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml",
    "Referer": "https://gs.amac.org.cn/amac-infodisc/res/pof/fund/index.html",
}


def _load_env() -> None:
    for base in (Path.cwd(), ROOT):
        for fname in (".env.local", ".env"):
            f = base / fname
            if not f.is_file():
                continue
            with f.open(encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _connect():
    import psycopg2

    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", "market_data"),
        user=os.environ.get("DB_USER", "market_user"),
        password=os.environ.get("DB_PASSWORD", ""),
    )


def _ensure_column(cur) -> None:
    cur.execute(
        """
        ALTER TABLE amac_private_funds
        ADD COLUMN IF NOT EXISTS fund_type TEXT
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_amac_private_funds_fund_type
            ON amac_private_funds (fund_type)
        """
    )


def _fetch_html(url: str, *, retries: int = 3) -> str | None:
    req = urllib.request.Request(url, headers=HEADERS, method="GET")
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except (
            urllib.error.URLError,
            urllib.error.HTTPError,
            http.client.IncompleteRead,
            TimeoutError,
            OSError,
        ):
            if attempt + 1 >= retries:
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def run(*, batch_size: int, max_batches: int, delay: float) -> dict:
    _load_env()
    conn = _connect()
    updated = 0
    scanned = 0
    try:
        with conn.cursor() as cur:
            _ensure_column(cur)
            conn.commit()

            for _ in range(max_batches):
                cur.execute(
                    """
                    SELECT fund_no, detail_url
                    FROM amac_private_funds
                    WHERE fund_type IS NULL
                      AND detail_url IS NOT NULL
                      AND TRIM(detail_url) <> ''
                    ORDER BY updated_at DESC
                    LIMIT %s
                    """,
                    (batch_size,),
                )
                rows = cur.fetchall()
                if not rows:
                    break

                for fund_no, detail_url in rows:
                    scanned += 1
                    try:
                        html = _fetch_html(detail_url)
                        fund_type = parse_fund_type(html or "")
                        if fund_type:
                            cur.execute(
                                """
                                UPDATE amac_private_funds
                                SET fund_type = %s, updated_at = NOW()
                                WHERE fund_no = %s
                                """,
                                (fund_type, fund_no),
                            )
                            updated += 1
                    except Exception as exc:
                        print(f"skip {fund_no}: {exc}", file=sys.stderr, flush=True)
                    if delay > 0:
                        time.sleep(delay)

                conn.commit()
                print(f"batch done: scanned={scanned}, updated={updated}", flush=True)

        return {"ok": True, "scanned": scanned, "updated": updated}
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill amac_private_funds.fund_type from detail pages")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--max-batches", type=int, default=20)
    parser.add_argument("--delay", type=float, default=0.2)
    args = parser.parse_args()
    summary = run(batch_size=args.batch_size, max_batches=args.max_batches, delay=args.delay)
    print(summary)
    return 0 if summary.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
