#!/usr/bin/env python3
"""
amac_futures_etl.py
===================
Fetch AMAC 期货公司集合资管 disclosures and upsert into PostgreSQL, then insert
new product codes into private_fund_info so dashboard search and 要素提取 can
find them with the existing indexed queries (no extra live AMAC lookup).

The futures catalog is ~7k rows, so nightly runs do a full sync by default.

Usage:
    python scripts/db/amac_futures_etl.py
    python scripts/db/amac_futures_etl.py --dry-run
    python scripts/db/amac_futures_etl.py --max-pages 2

Env:
    AMAC_ETL_SYNC_PRIVATE_FUND_INFO  — sync new rows into private_fund_info (default 1)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "fetch_amac_data"))
sys.path.insert(0, str(ROOT / "scripts" / "db"))

from amac_client import (  # noqa: E402
    DEFAULT_REQUEST_DELAY,
    FUTURES_PAGE_SIZE,
    iter_futures_pages,
)
from amac_etl_lock import (  # noqa: E402
    AMAC_LIST_LOCK_KEY,
    acquire_advisory_lock,
    execute_values_retry,
    release_advisory_lock,
)

SOURCE_NAME = "amac_futures_api"


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


def _dash_to_none(val):
    if val is None:
        return None
    s = str(val).strip()
    if not s or s == "-":
        return None
    return s


def _parse_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s or s == "-":
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


DDL = """
CREATE TABLE IF NOT EXISTS amac_futures_products (
    id                  SERIAL PRIMARY KEY,
    fund_name           TEXT NOT NULL,
    fund_no             TEXT NOT NULL,
    manager_name        TEXT,
    manager_type        TEXT,
    working_state       TEXT,
    mandator_name       TEXT,
    establish_date      DATE,
    put_on_record_date  DATE,
    due_date            DATE,
    detail_url          TEXT,
    fund_type           TEXT NOT NULL DEFAULT '期货公司集合资管产品',
    investment_type     TEXT,
    is_tiered           TEXT,
    source_file         TEXT NOT NULL DEFAULT 'amac_futures_api',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_futures_products_fund_no_uq UNIQUE (fund_no)
);

CREATE INDEX IF NOT EXISTS idx_amac_futures_products_fund_name
    ON amac_futures_products (fund_name);

CREATE INDEX IF NOT EXISTS idx_amac_futures_products_manager_name
    ON amac_futures_products (manager_name);

CREATE INDEX IF NOT EXISTS idx_amac_futures_products_working_state
    ON amac_futures_products (working_state);

CREATE TABLE IF NOT EXISTS amac_futures_products_sync_state (
    id                       TEXT PRIMARY KEY DEFAULT 'default',
    last_total_elements      INTEGER,
    last_db_count            INTEGER,
    last_pages_fetched       INTEGER NOT NULL DEFAULT 0,
    last_rows_upserted       INTEGER NOT NULL DEFAULT 0,
    last_full_sync_at        TIMESTAMPTZ,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

UPSERT_SQL = """
INSERT INTO amac_futures_products (
    fund_name, fund_no, manager_name, manager_type, working_state,
    mandator_name, establish_date, put_on_record_date, due_date, detail_url,
    fund_type, investment_type, is_tiered, source_file
) VALUES %s
ON CONFLICT (fund_no) DO UPDATE SET
    fund_name          = EXCLUDED.fund_name,
    manager_name       = EXCLUDED.manager_name,
    manager_type       = EXCLUDED.manager_type,
    working_state      = EXCLUDED.working_state,
    mandator_name      = EXCLUDED.mandator_name,
    establish_date     = EXCLUDED.establish_date,
    put_on_record_date = EXCLUDED.put_on_record_date,
    due_date           = EXCLUDED.due_date,
    detail_url         = EXCLUDED.detail_url,
    fund_type          = EXCLUDED.fund_type,
    investment_type    = EXCLUDED.investment_type,
    is_tiered          = EXCLUDED.is_tiered,
    source_file        = EXCLUDED.source_file,
    updated_at         = NOW()
"""

INSERT_PRIVATE_FUND_INFO_SQL = """
INSERT INTO private_fund_info (beian_hao, product_name, manager, inception_date)
SELECT
    a.fund_no,
    a.fund_name,
    a.manager_name,
    a.establish_date
FROM amac_futures_products a
WHERE NOT EXISTS (
    SELECT 1 FROM private_fund_info p WHERE p.beian_hao = a.fund_no
)
ON CONFLICT (beian_hao) DO NOTHING
"""


def _rows_to_tuples(rows: list[dict]) -> list[tuple]:
    out = []
    for row in rows:
        fund_no = str(row.get("fund_no", "")).strip()
        fund_name = str(row.get("fund_name", "")).strip()
        if not fund_no or not fund_name:
            continue
        out.append((
            fund_name,
            fund_no,
            _dash_to_none(row.get("manager_name")),
            _dash_to_none(row.get("manager_type")),
            _dash_to_none(row.get("working_state")),
            _dash_to_none(row.get("mandator_name")),
            _parse_date(row.get("establish_date")),
            _parse_date(row.get("put_on_record_date")),
            _parse_date(row.get("due_date")),
            _dash_to_none(row.get("detail_url")),
            _dash_to_none(row.get("fund_type")) or "期货公司集合资管产品",
            _dash_to_none(row.get("investment_type")),
            _dash_to_none(row.get("is_tiered")),
            SOURCE_NAME,
        ))
    return out


def run_etl(
    *,
    dry_run: bool = False,
    sync_private_fund_info: bool = True,
    page_size: int = FUTURES_PAGE_SIZE,
    request_delay: float = DEFAULT_REQUEST_DELAY,
    max_pages_override: int | None = None,
) -> dict:
    conn = _connect()
    pages_fetched = 0
    rows_upserted = 0
    total_elements = 0
    db_count = 0
    db_after = 0
    private_fund_info_inserted = 0
    mode = "full"

    try:
        acquire_advisory_lock(conn, AMAC_LIST_LOCK_KEY)
        with conn:
            with conn.cursor() as cur:
                cur.execute(DDL)
                cur.execute("SELECT COUNT(*) FROM amac_futures_products")
                db_count = int(cur.fetchone()[0])
                pages_limit = max_pages_override if max_pages_override and max_pages_override > 0 else None
                mode = "limited" if pages_limit is not None else "full"

                print(
                    f"amac_futures_etl: mode={mode} db_count={db_count:,} "
                    f"pages_limit={pages_limit if pages_limit is not None else 'all'}"
                )

                def on_page(page: int, row_count: int, total: int) -> None:
                    nonlocal total_elements
                    total_elements = total
                    if page == 0 and total > 0:
                        print(f"  AMAC futures total={total:,} products on record")

                if dry_run:
                    first_meta = None
                    for page_idx, rows, meta in iter_futures_pages(
                        page_size=page_size,
                        start_page=0,
                        end_page=1,
                        request_delay=request_delay,
                        on_page=on_page,
                    ):
                        _ = page_idx
                        first_meta = meta
                        rows_upserted += len(rows)
                    pages_fetched = 1
                    total_elements = int((first_meta or {}).get("total_elements", 0) or 0)
                    db_after = db_count
                else:
                    for page_idx, rows, meta in iter_futures_pages(
                        page_size=page_size,
                        start_page=0,
                        end_page=pages_limit,
                        request_delay=request_delay,
                        on_page=on_page,
                    ):
                        _ = page_idx
                        total_elements = int(meta.get("total_elements", 0) or 0)
                        batch = _rows_to_tuples(rows)
                        if batch:
                            execute_values_retry(cur, UPSERT_SQL, batch, page_size=1000)
                            rows_upserted += len(batch)
                        pages_fetched += 1
                        if pages_fetched % 20 == 0:
                            conn.commit()
                            print(f"  committed {pages_fetched} page(s), upserted={rows_upserted:,}")

                    conn.commit()
                    cur.execute("ANALYZE amac_futures_products")
                    cur.execute("SELECT COUNT(*) FROM amac_futures_products")
                    db_after = int(cur.fetchone()[0])
                    now = datetime.now(timezone.utc)
                    cur.execute(
                        """
                        INSERT INTO amac_futures_products_sync_state (
                            id, last_total_elements, last_db_count, last_pages_fetched,
                            last_rows_upserted, last_full_sync_at, updated_at
                        ) VALUES (
                            'default', %s, %s, %s, %s, %s, %s
                        )
                        ON CONFLICT (id) DO UPDATE SET
                            last_total_elements = EXCLUDED.last_total_elements,
                            last_db_count       = EXCLUDED.last_db_count,
                            last_pages_fetched  = EXCLUDED.last_pages_fetched,
                            last_rows_upserted  = EXCLUDED.last_rows_upserted,
                            last_full_sync_at   = EXCLUDED.last_full_sync_at,
                            updated_at          = EXCLUDED.updated_at
                        """,
                        (total_elements, db_after, pages_fetched, rows_upserted, now, now),
                    )

                    if sync_private_fund_info:
                        cur.execute("SELECT to_regclass('public.private_fund_info')")
                        if cur.fetchone()[0] is not None:
                            cur.execute(INSERT_PRIVATE_FUND_INFO_SQL)
                            private_fund_info_inserted = cur.rowcount
    finally:
        try:
            release_advisory_lock(conn, AMAC_LIST_LOCK_KEY)
        except Exception:
            pass
        conn.close()

    summary = {
        "ok": True,
        "mode": mode,
        "pages_fetched": pages_fetched,
        "rows_upserted": rows_upserted,
        "total_elements": total_elements,
        "db_count_before": db_count,
        "db_count_after": db_after,
        "private_fund_info_inserted": private_fund_info_inserted,
        "dry_run": dry_run,
    }
    print(json.dumps(summary, ensure_ascii=False))
    print(
        f"Done. mode={mode} pages={pages_fetched} upserted={rows_upserted:,} "
        f"db={db_count:,}->{db_after:,} private_fund_info+={private_fund_info_inserted:,}"
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch AMAC futures 资管 products into PostgreSQL.")
    parser.add_argument("--dry-run", action="store_true", help="Fetch first page only; do not write.")
    parser.add_argument("--no-sync-private-fund-info", action="store_true", help="Skip private_fund_info insert.")
    parser.add_argument("--page-size", type=int, default=FUTURES_PAGE_SIZE)
    parser.add_argument("--delay", type=float, default=DEFAULT_REQUEST_DELAY)
    parser.add_argument("--max-pages", type=int, default=0, help="Limit pages fetched (testing).")
    args = parser.parse_args()

    _load_env()

    try:
        run_etl(
            dry_run=args.dry_run,
            sync_private_fund_info=not args.no_sync_private_fund_info,
            page_size=args.page_size,
            request_delay=args.delay,
            max_pages_override=args.max_pages if args.max_pages > 0 else None,
        )
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
