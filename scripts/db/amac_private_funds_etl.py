#!/usr/bin/env python3
"""
amac_private_funds_etl.py
=========================
Fetch AMAC private fund disclosures and upsert into PostgreSQL.

Designed for nightly incremental sync on the server (no CSV required).
Full sync can be run manually or on a weekly schedule.

Usage:
    python scripts/db/amac_private_funds_etl.py
    python scripts/db/amac_private_funds_etl.py --full
    python scripts/db/amac_private_funds_etl.py --step amac_private_funds --dry-run

Env:
    AMAC_ETL_INCREMENTAL_MAX_PAGES   — max pages per incremental run (default 80)
    AMAC_ETL_INCREMENTAL_MIN_PAGES   — minimum pages to refresh recent records (default 40)
    AMAC_ETL_FULL_SYNC_DOW           — day-of-week for automatic full sync, 0=Mon..6=Sun (default 6)
    AMAC_ETL_SYNC_PRIVATE_FUND_INFO  — sync new rows into private_fund_info (default 1)
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "fetch_amac_data"))
sys.path.insert(0, str(ROOT / "scripts" / "db"))

from amac_client import (  # noqa: E402
    DEFAULT_PAGE_SIZE,
    DEFAULT_REQUEST_DELAY,
    iter_fund_pages,
)
from amac_etl_lock import (  # noqa: E402
    AMAC_LIST_LOCK_KEY,
    acquire_advisory_lock,
    execute_values_retry,
    release_advisory_lock,
)

SOURCE_NAME = "amac_api"


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
CREATE TABLE IF NOT EXISTS amac_private_funds (
    id                  SERIAL PRIMARY KEY,
    fund_name           TEXT NOT NULL,
    fund_no             TEXT NOT NULL,
    manager_name        TEXT,
    manager_type        TEXT,
    working_state       TEXT,
    mandator_name       TEXT,
    establish_date      DATE,
    put_on_record_date  DATE,
    detail_url          TEXT,
    fund_type           TEXT,
    source_file         TEXT NOT NULL DEFAULT 'amac_api',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amac_private_funds_fund_no_uq UNIQUE (fund_no)
);

CREATE INDEX IF NOT EXISTS idx_amac_private_funds_fund_name
    ON amac_private_funds (fund_name);

CREATE INDEX IF NOT EXISTS idx_amac_private_funds_manager_name
    ON amac_private_funds (manager_name);

CREATE INDEX IF NOT EXISTS idx_amac_private_funds_working_state
    ON amac_private_funds (working_state);

CREATE INDEX IF NOT EXISTS idx_amac_private_funds_put_on_record_date
    ON amac_private_funds (put_on_record_date DESC);

CREATE INDEX IF NOT EXISTS idx_amac_private_funds_fund_type
    ON amac_private_funds (fund_type);

CREATE TABLE IF NOT EXISTS amac_private_funds_sync_state (
    id                      TEXT PRIMARY KEY DEFAULT 'default',
    last_total_elements     INTEGER,
    last_db_count           INTEGER,
    last_pages_fetched      INTEGER NOT NULL DEFAULT 0,
    last_rows_upserted      INTEGER NOT NULL DEFAULT 0,
    last_full_sync_at       TIMESTAMPTZ,
    last_incremental_sync_at TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

UPSERT_SQL = """
INSERT INTO amac_private_funds (
    fund_name, fund_no, manager_name, manager_type, working_state,
    mandator_name, establish_date, put_on_record_date, detail_url, source_file
) VALUES %s
ON CONFLICT (fund_no) DO UPDATE SET
    fund_name          = EXCLUDED.fund_name,
    manager_name       = EXCLUDED.manager_name,
    manager_type       = EXCLUDED.manager_type,
    working_state      = EXCLUDED.working_state,
    mandator_name      = EXCLUDED.mandator_name,
    establish_date     = EXCLUDED.establish_date,
    put_on_record_date = EXCLUDED.put_on_record_date,
    detail_url         = EXCLUDED.detail_url,
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
FROM amac_private_funds a
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
            _dash_to_none(row.get("detail_url")),
            SOURCE_NAME,
        ))
    return out


def _get_db_count(cur) -> int:
    cur.execute("SELECT COUNT(*) FROM amac_private_funds")
    return int(cur.fetchone()[0])


def _should_run_full_sync(force_full: bool, full_sync_dow: int) -> bool:
    if force_full:
        return True
    return datetime.now().weekday() == full_sync_dow


def _pages_for_incremental(
    total_elements: int,
    db_count: int,
    *,
    page_size: int,
    min_pages: int,
    max_pages: int,
) -> int:
    delta = max(0, total_elements - db_count)
    pages_for_delta = math.ceil((delta + page_size) / page_size) if delta else 0
    pages = max(min_pages, pages_for_delta)
    return min(max_pages, max(1, pages))


def _save_sync_state(
    cur,
    *,
    total_elements: int,
    db_count: int,
    pages_fetched: int,
    rows_upserted: int,
    full_sync: bool,
) -> None:
    now = datetime.now(timezone.utc)
    cur.execute(
        """
        INSERT INTO amac_private_funds_sync_state (
            id, last_total_elements, last_db_count, last_pages_fetched,
            last_rows_upserted, last_full_sync_at, last_incremental_sync_at, updated_at
        ) VALUES (
            'default', %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (id) DO UPDATE SET
            last_total_elements      = EXCLUDED.last_total_elements,
            last_db_count            = EXCLUDED.last_db_count,
            last_pages_fetched       = EXCLUDED.last_pages_fetched,
            last_rows_upserted       = EXCLUDED.last_rows_upserted,
            last_full_sync_at        = CASE WHEN %s THEN EXCLUDED.last_full_sync_at ELSE amac_private_funds_sync_state.last_full_sync_at END,
            last_incremental_sync_at = CASE WHEN %s THEN EXCLUDED.last_incremental_sync_at ELSE amac_private_funds_sync_state.last_incremental_sync_at END,
            updated_at               = EXCLUDED.updated_at
        """,
        (
            total_elements,
            db_count,
            pages_fetched,
            rows_upserted,
            now if full_sync else None,
            now if not full_sync else None,
            now,
            full_sync,
            not full_sync,
        ),
    )


def run_etl(
    *,
    force_full: bool = False,
    dry_run: bool = False,
    sync_private_fund_info: bool = True,
    page_size: int = DEFAULT_PAGE_SIZE,
    request_delay: float = DEFAULT_REQUEST_DELAY,
    max_pages_override: int | None = None,
) -> dict:
    try:
        incremental_max_pages = int(os.environ.get("AMAC_ETL_INCREMENTAL_MAX_PAGES", "80"))
    except ValueError:
        incremental_max_pages = 80
    try:
        incremental_min_pages = int(os.environ.get("AMAC_ETL_INCREMENTAL_MIN_PAGES", "40"))
    except ValueError:
        incremental_min_pages = 40
    try:
        full_sync_dow = int(os.environ.get("AMAC_ETL_FULL_SYNC_DOW", "6"))
    except ValueError:
        full_sync_dow = 6

    conn = _connect()
    pages_fetched = 0
    rows_upserted = 0
    total_elements = 0
    full_sync = False
    db_after = 0
    private_fund_info_inserted = 0
    mode = "incremental"
    db_count = 0

    try:
        acquire_advisory_lock(conn, AMAC_LIST_LOCK_KEY)
        with conn:
            with conn.cursor() as cur:
                cur.execute(DDL)
                db_count = _get_db_count(cur)
                full_sync = _should_run_full_sync(force_full, full_sync_dow) or db_count == 0

                if max_pages_override is not None and max_pages_override > 0:
                    pages_limit = max_pages_override
                    mode = "limited"
                elif full_sync:
                    pages_limit = None
                    mode = "full"
                else:
                    pages_limit = None
                    mode = "incremental"

                print(
                    f"amac_private_funds_etl: mode={mode} db_count={db_count:,} "
                    f"pages_limit={pages_limit if pages_limit is not None else 'all'}"
                )

                def on_page(page: int, row_count: int, total: int) -> None:
                    nonlocal total_elements
                    total_elements = total
                    if page == 0 and total > 0:
                        print(f"  AMAC total={total:,} funds on record")

                if dry_run:
                    first_meta = None
                    for page_idx, rows, meta in iter_fund_pages(
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
                    private_fund_info_inserted = 0
                else:
                    incremental_pages_limit = pages_limit
                    for page_idx, rows, meta in iter_fund_pages(
                        page_size=page_size,
                        start_page=0,
                        end_page=pages_limit if mode != "incremental" else None,
                        request_delay=request_delay,
                        on_page=on_page,
                    ):
                        if mode == "incremental" and incremental_pages_limit is None:
                            total_elements = int(meta.get("total_elements", 0) or 0)
                            incremental_pages_limit = _pages_for_incremental(
                                total_elements=total_elements,
                                db_count=db_count,
                                page_size=page_size,
                                min_pages=incremental_min_pages,
                                max_pages=incremental_max_pages,
                            )
                            print(
                                f"  Incremental sync: fetching first {incremental_pages_limit} page(s)"
                            )

                        total_elements = int(meta.get("total_elements", 0) or 0)
                        batch = _rows_to_tuples(rows)
                        if batch:
                            execute_values_retry(cur, UPSERT_SQL, batch, page_size=1000)
                            rows_upserted += len(batch)
                        pages_fetched += 1
                        # Commit in chunks so a 40-minute full sync does not hold one
                        # transaction (and table lock) for the entire run.
                        if pages_fetched % 20 == 0:
                            conn.commit()
                            print(f"  committed {pages_fetched} page(s), upserted={rows_upserted:,}")

                        if (
                            mode == "incremental"
                            and incremental_pages_limit is not None
                            and pages_fetched >= incremental_pages_limit
                        ):
                            break

                    conn.commit()

                    cur.execute("ANALYZE amac_private_funds")
                    db_after = _get_db_count(cur)
                    _save_sync_state(
                        cur,
                        total_elements=total_elements,
                        db_count=db_after,
                        pages_fetched=pages_fetched,
                        rows_upserted=rows_upserted,
                        full_sync=full_sync,
                    )

                    private_fund_info_inserted = 0
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
        "full_sync": full_sync,
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
    parser = argparse.ArgumentParser(description="Fetch AMAC private funds into PostgreSQL.")
    parser.add_argument("--full", action="store_true", help="Fetch all pages (ignore incremental limits).")
    parser.add_argument("--dry-run", action="store_true", help="Fetch first page only; do not write.")
    parser.add_argument("--no-sync-private-fund-info", action="store_true", help="Skip private_fund_info insert.")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE)
    parser.add_argument("--delay", type=float, default=DEFAULT_REQUEST_DELAY)
    parser.add_argument("--max-pages", type=int, default=0, help="Limit pages fetched (testing).")
    args = parser.parse_args()

    _load_env()

    try:
        run_etl(
            force_full=args.full,
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
