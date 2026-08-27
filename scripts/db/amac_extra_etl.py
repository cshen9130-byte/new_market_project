#!/usr/bin/env python3
"""
amac_extra_etl.py
=================
Fetch AMAC manager / personnel data and upsert into PostgreSQL.

Tables: amac_managers, amac_person_org_stats, amac_manager_details,
        amac_manager_executives, amac_manager_executive_resume,
        amac_personnel, amac_personnel_cert_history,
        amac_manager_metrics_history (append-only metric snapshots)

Nightly incremental (default):
  - Full refresh of manager list + every institution's person-org stats
  - Manager detail pages for new managers + a rotating stale batch
  - Personnel for orgs not yet fetched, plus a rotating stale batch

Weekly full sync (default Sunday, AMAC_ETL_FULL_SYNC_DOW=6):
  - Re-fetch all manager detail pages (~19k HTML requests)
  - Re-fetch personnel for every institution

Usage:
    python scripts/db/amac_extra_etl.py
    python scripts/db/amac_extra_etl.py --full
    python scripts/db/amac_extra_etl.py --dry-run

Env:
    AMAC_ETL_FULL_SYNC_DOW              — weekday for weekly full detail sync (default 6)
    AMAC_EXTRA_ETL_DETAIL_BATCH_SIZE    — stale managers refreshed nightly (default 300)
    AMAC_EXTRA_ETL_PERSONNEL_BATCH_SIZE — max orgs whose people lists to fetch (0 = all missing + stale)
    AMAC_EXTRA_ETL_PERSONNEL_STALE_SIZE — already-fetched orgs to refresh nightly (default 300)
    AMAC_EXTRA_ETL_REQUEST_DELAY        — delay between AMAC requests (default 0.3)
    AMAC_EXTRA_ETL_PAGE_SIZE            — API page size (default 100)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "fetch_amac_data"))
sys.path.insert(0, str(ROOT / "scripts" / "db"))

from fetch_amac_extra import (  # noqa: E402
    HEADERS,
    PAGE_SIZE,
    PERSON_API_PAGE_SIZE,
    PERSON_LIST_REFERER,
    PERSON_ORG_ALL_BODY,
    PERSON_ORG_REFERER,
    REQUEST_DELAY,
    as_text,
    get_html,
    iter_personnel_for_org,
    manager_row,
    parse_manager_detail,
    person_org_row,
    post_json,
)
from amac_extra_db import (  # noqa: E402
    DELETE_PERSONNEL_FOR_ORG,
    DELETE_PERSONNEL_HISTORY_FOR_ORG,
    MARK_PERSONNEL_FETCHED,
    SELECT_PERSONNEL_TARGETS,
    UPSERT_EXECUTIVE_RESUME,
    UPSERT_EXECUTIVES,
    UPSERT_MANAGER_DETAILS,
    UPSERT_MANAGERS,
    UPSERT_PERSON_ORG,
    UPSERT_PERSONNEL,
    UPSERT_PERSONNEL_CERT_HISTORY,
    append_manager_metrics_history,
    dedupe_tuples,
    ensure_schema,
    executive_csv_row_to_tuple,
    executive_resume_csv_row_to_tuple,
    manager_csv_row_to_tuple,
    manager_detail_csv_row_to_tuple,
    person_org_csv_row_to_tuple,
    personnel_cert_history_csv_row_to_tuple,
    personnel_csv_row_to_tuple,
)


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


def _should_run_full_sync(force_full: bool, full_sync_dow: int) -> bool:
    if force_full:
        return True
    return datetime.now().weekday() == full_sync_dow


def _save_sync_state(
    cur,
    *,
    managers_upserted: int,
    person_org_upserted: int,
    details_fetched: int,
    executives_upserted: int,
    resumes_upserted: int,
    personnel_upserted: int,
    personnel_orgs_fetched: int,
    personnel_certs_upserted: int,
    full_details_sync: bool,
) -> None:
    now = datetime.now(timezone.utc)
    cur.execute(
        """
        INSERT INTO amac_extra_sync_state (
            id, last_managers_upserted, last_person_org_upserted,
            last_details_fetched, last_executives_upserted, last_resumes_upserted,
            last_personnel_upserted, last_personnel_orgs_fetched, last_personnel_certs_upserted,
            last_full_details_sync_at, last_incremental_sync_at, updated_at
        ) VALUES (
            'default', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        ON CONFLICT (id) DO UPDATE SET
            last_managers_upserted       = EXCLUDED.last_managers_upserted,
            last_person_org_upserted     = EXCLUDED.last_person_org_upserted,
            last_details_fetched         = EXCLUDED.last_details_fetched,
            last_executives_upserted     = EXCLUDED.last_executives_upserted,
            last_resumes_upserted        = EXCLUDED.last_resumes_upserted,
            last_personnel_upserted      = EXCLUDED.last_personnel_upserted,
            last_personnel_orgs_fetched  = EXCLUDED.last_personnel_orgs_fetched,
            last_personnel_certs_upserted = EXCLUDED.last_personnel_certs_upserted,
            last_full_details_sync_at    = CASE
                WHEN %s THEN EXCLUDED.last_full_details_sync_at
                ELSE amac_extra_sync_state.last_full_details_sync_at
            END,
            last_incremental_sync_at = CASE
                WHEN %s THEN EXCLUDED.last_incremental_sync_at
                ELSE amac_extra_sync_state.last_incremental_sync_at
            END,
            updated_at = EXCLUDED.updated_at
        """,
        (
            managers_upserted,
            person_org_upserted,
            details_fetched,
            executives_upserted,
            resumes_upserted,
            personnel_upserted,
            personnel_orgs_fetched,
            personnel_certs_upserted,
            now if full_details_sync else None,
            now if not full_details_sync else None,
            now,
            full_details_sync,
            not full_details_sync,
        ),
    )


def _iter_api_pages(
    session,
    api_path: str,
    row_fn,
    *,
    json_body: dict | None = None,
    page_size: int = PAGE_SIZE,
    max_pages: int | None = None,
    delay: float = REQUEST_DELAY,
):
    first = post_json(session, api_path, 0, page_size, json_body)
    total_pages = int(first.get("totalPages", 0))
    total_elements = int(first.get("totalElements", 0))
    end_page = total_pages if max_pages is None else min(max_pages, total_pages)

    yield 0, [row_fn(item) for item in first.get("content", [])], total_elements, total_pages

    for page in range(1, end_page):
        data = post_json(session, api_path, page, page_size, json_body)
        items = data.get("content", [])
        if not items:
            break
        yield page, [row_fn(item) for item in items], total_elements, total_pages
        time.sleep(delay)


def _upsert_managers(session, cur, execute_values, *, page_size: int, delay: float) -> tuple[int, list[dict]]:
    import requests

    try:
        session.get(
            "https://gs.amac.org.cn/amac-infodisc/res/pof/manager/managerList.html",
            headers={"User-Agent": HEADERS["User-Agent"]},
            verify=False,
            timeout=60,
        )
    except requests.RequestException:
        pass

    upserted = 0
    manager_rows: list[dict] = []
    total_elements = 0

    for page_idx, rows, total, _total_pages in _iter_api_pages(
        session,
        "/api/pof/manager",
        manager_row,
        json_body={},
        page_size=page_size,
        delay=delay,
    ):
        total_elements = total
        if page_idx == 0 and total > 0:
            print(f"  AMAC managers total={total:,}")

        batch = [manager_csv_row_to_tuple(row) for row in rows]
        # AMAC list pages occasionally repeat registration_no within one response;
        # Postgres rejects ON CONFLICT when the same key appears twice in VALUES.
        batch = dedupe_tuples([t for t in batch if t], lambda r: r[3])
        if batch:
            execute_values(cur, UPSERT_MANAGERS, batch, page_size=1000)
            upserted += len(batch)
        manager_rows.extend(rows)

    cur.execute("ANALYZE amac_managers")
    print(f"  Upserted {upserted:,} managers (API total={total_elements:,})")
    return upserted, manager_rows


def _upsert_person_org(session, cur, execute_values, *, page_size: int, delay: float) -> int:
    import requests

    try:
        session.get(
            PERSON_ORG_REFERER,
            headers={"User-Agent": HEADERS["User-Agent"]},
            verify=False,
            timeout=60,
        )
    except requests.RequestException:
        pass

    upserted = 0
    total_elements = 0
    person_page_size = min(page_size, PERSON_API_PAGE_SIZE)

    for page_idx, rows, total, _total_pages in _iter_api_pages(
        session,
        "/api/pof/personOrg",
        person_org_row,
        json_body=dict(PERSON_ORG_ALL_BODY),
        page_size=person_page_size,
        delay=delay,
    ):
        total_elements = total
        if page_idx == 0 and total > 0:
            print(f"  AMAC person-org stats total={total:,}")

        batch = [person_org_csv_row_to_tuple(row) for row in rows]
        batch = dedupe_tuples([t for t in batch if t], lambda r: r[0])
        if batch:
            execute_values(cur, UPSERT_PERSON_ORG, batch, page_size=1000)
            upserted += len(batch)

    cur.execute("ANALYZE amac_person_org_stats")
    print(f"  Upserted {upserted:,} person-org rows (API total={total_elements:,})")
    return upserted


def _select_detail_targets(cur, manager_rows: list[dict], *, full_sync: bool, batch_size: int) -> list[dict]:
    if full_sync:
        return [m for m in manager_rows if m.get("详情链接")]

    cur.execute("SELECT registration_no FROM amac_manager_details")
    existing = {row[0] for row in cur.fetchall()}

    missing = [
        m
        for m in manager_rows
        if m.get("登记编号") and m.get("登记编号") not in existing and m.get("详情链接")
    ]

    targets_by_reg: dict[str, dict] = {}
    for m in missing:
        reg = m.get("登记编号", "")
        if reg:
            targets_by_reg[reg] = m

    # Prioritize managers from our product list that still lack scraped detail pages.
    if batch_size > 0:
        try:
            cur.execute(
                """
                SELECT m.registration_no, m.detail_url, m.manager_name
                FROM private_fund_managers_list p
                JOIN amac_managers m ON UPPER(m.registration_no) = UPPER(p.registration_no)
                LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
                WHERE m.detail_url IS NOT NULL AND m.detail_url <> ''
                  AND d.registration_no IS NULL
                ORDER BY p.seq_no ASC NULLS LAST, p.id ASC
                LIMIT %s
                """,
                (batch_size,),
            )
            for reg_no, detail_url, manager_name in cur.fetchall():
                if reg_no in targets_by_reg:
                    continue
                targets_by_reg[reg_no] = {
                    "登记编号": reg_no,
                    "详情链接": detail_url,
                    "私募基金管理人名称": manager_name,
                }
        except Exception:
            pass

    remaining = max(0, batch_size - len(targets_by_reg)) if batch_size > 0 else 0
    stale: list[tuple] = []
    if remaining > 0:
        cur.execute(
            """
            SELECT m.registration_no, m.detail_url, m.manager_name
            FROM amac_managers m
            WHERE m.detail_url IS NOT NULL AND m.detail_url <> ''
            ORDER BY COALESCE(
                (SELECT d.updated_at FROM amac_manager_details d WHERE d.registration_no = m.registration_no),
                TIMESTAMPTZ '1970-01-01'
            ) ASC
            LIMIT %s
            """,
            (remaining,),
        )
        stale = cur.fetchall()

    for reg_no, detail_url, manager_name in stale:
        if reg_no in targets_by_reg:
            continue
        targets_by_reg[reg_no] = {
            "登记编号": reg_no,
            "详情链接": detail_url,
            "私募基金管理人名称": manager_name,
        }

    return list(targets_by_reg.values())


def _upsert_manager_details(
    session,
    cur,
    execute_values,
    manager_rows: list[dict],
    *,
    full_sync: bool,
    batch_size: int,
    delay: float,
) -> tuple[int, int, int]:
    targets = _select_detail_targets(cur, manager_rows, full_sync=full_sync, batch_size=batch_size)
    if not targets:
        print("  No manager detail pages to fetch.")
        return 0, 0, 0

    mode = "full" if full_sync else "incremental"
    print(f"  Fetching manager details ({mode}): {len(targets):,} pages …")

    details_fetched = 0
    executives_upserted = 0
    resumes_upserted = 0
    detail_batch: list[tuple] = []
    exec_batch: list[tuple] = []
    resume_batch: list[tuple] = []

    def flush() -> None:
        nonlocal details_fetched, executives_upserted, resumes_upserted
        if detail_batch:
            details = dedupe_tuples(detail_batch, lambda r: r[0])
            execute_values(cur, UPSERT_MANAGER_DETAILS, details, page_size=500)
            details_fetched += len(details)
            detail_batch.clear()
        if exec_batch:
            execs = dedupe_tuples(exec_batch, lambda r: (r[0], r[2], r[3]))
            execute_values(cur, UPSERT_EXECUTIVES, execs, page_size=500)
            executives_upserted += len(execs)
            exec_batch.clear()
        if resume_batch:
            resumes = dedupe_tuples(
                resume_batch,
                lambda r: (r[0], r[2], r[3], r[4], r[5], r[6], r[7]),
            )
            execute_values(cur, UPSERT_EXECUTIVE_RESUME, resumes, page_size=500)
            resumes_upserted += len(resumes)
            resume_batch.clear()

    # Same registration_no twice in one flush also trips ON CONFLICT.
    seen_detail_regs: set[str] = set()
    unique_targets: list[dict] = []
    for mgr in targets:
        reg = str(mgr.get("登记编号") or "").strip()
        if reg and reg in seen_detail_regs:
            continue
        if reg:
            seen_detail_regs.add(reg)
        unique_targets.append(mgr)
    targets = unique_targets

    for idx, mgr in enumerate(targets, start=1):
        url = mgr.get("详情链接", "")
        if not url:
            continue

        html = get_html(session, url)
        detail_row, exec_rows, resume_rows = parse_manager_detail(html, url)
        if not detail_row.get("登记编号"):
            detail_row["登记编号"] = mgr.get("登记编号", "")
        if not detail_row.get("基金管理人全称(中文)"):
            detail_row["基金管理人全称(中文)"] = mgr.get("私募基金管理人名称", "")

        reg = detail_row.get("登记编号", "")
        mgr_name = detail_row.get("基金管理人全称(中文)", "")
        for er in exec_rows:
            er.setdefault("登记编号", reg)
            er.setdefault("管理人名称", mgr_name)
        for rr in resume_rows:
            rr.setdefault("登记编号", reg)
            rr.setdefault("管理人名称", mgr_name)

        detail_tuple = manager_detail_csv_row_to_tuple(detail_row)
        if detail_tuple:
            detail_batch.append(detail_tuple)
        exec_batch.extend(t for t in (executive_csv_row_to_tuple(r) for r in exec_rows) if t)
        resume_batch.extend(
            t for t in (executive_resume_csv_row_to_tuple(r) for r in resume_rows) if t
        )

        if len(detail_batch) >= 100:
            flush()

        if idx % 100 == 0 or idx == len(targets):
            print(f"    detail progress: {idx:,}/{len(targets):,}")

        time.sleep(delay)

    flush()
    cur.execute("ANALYZE amac_manager_details")
    cur.execute("ANALYZE amac_manager_executives")
    cur.execute("ANALYZE amac_manager_executive_resume")
    print(
        f"  Details upserted={details_fetched:,} executives={executives_upserted:,} "
        f"resumes={resumes_upserted:,}"
    )
    return details_fetched, executives_upserted, resumes_upserted


def _select_personnel_targets(
    cur,
    *,
    full_sync: bool,
    batch_size: int,
    stale_size: int,
) -> list[tuple[str, str]]:
    cur.execute(SELECT_PERSONNEL_TARGETS)
    rows = [(as_text(r[0]), as_text(r[1]), r[2], r[3]) for r in cur.fetchall() if as_text(r[0])]
    if full_sync:
        return [(org_user_id, org_name) for org_user_id, org_name, _staff, _fetched in rows]

    missing = [
        (org_user_id, org_name)
        for org_user_id, org_name, _staff, fetched_at in rows
        if fetched_at is None
    ]
    stale = [
        (org_user_id, org_name)
        for org_user_id, org_name, _staff, fetched_at in rows
        if fetched_at is not None
    ]
    targets = missing + stale[: max(0, stale_size)]
    if batch_size > 0:
        targets = targets[:batch_size]
    return targets


def _upsert_personnel(
    session,
    cur,
    execute_values,
    conn,
    *,
    full_sync: bool,
    batch_size: int,
    stale_size: int,
    delay: float,
) -> tuple[int, int, int]:
    import requests

    try:
        session.get(
            PERSON_LIST_REFERER,
            headers={"User-Agent": HEADERS["User-Agent"]},
            verify=False,
            timeout=60,
        )
    except requests.RequestException:
        pass

    targets = _select_personnel_targets(
        cur, full_sync=full_sync, batch_size=batch_size, stale_size=stale_size
    )
    if not targets:
        print("  No personnel org lists to fetch.")
        return 0, 0, 0

    mode = "full" if full_sync else "incremental"
    print(f"  Fetching personnel ({mode}): {len(targets):,} orgs …")

    people_upserted = 0
    certs_upserted = 0
    orgs_fetched = 0
    page_size = PERSON_API_PAGE_SIZE

    for idx, (org_user_id, org_name) in enumerate(targets, start=1):
        try:
            people_rows, history_rows = iter_personnel_for_org(
                session, org_user_id, page_size=page_size, delay=delay
            )
        except Exception as exc:
            print(f"    skip {org_name} ({org_user_id}): {exc}")
            time.sleep(delay)
            continue
        people = dedupe_tuples(
            [t for t in (personnel_csv_row_to_tuple(r) for r in people_rows) if t],
            lambda r: (r[0], r[4]),
        )
        history = dedupe_tuples(
            [t for t in (personnel_cert_history_csv_row_to_tuple(r) for r in history_rows) if t],
            lambda r: r[3],
        )

        cur.execute(DELETE_PERSONNEL_HISTORY_FOR_ORG, (org_user_id,))
        cur.execute(DELETE_PERSONNEL_FOR_ORG, (org_user_id,))
        if people:
            execute_values(cur, UPSERT_PERSONNEL, people, page_size=500)
            people_upserted += len(people)
        if history:
            execute_values(cur, UPSERT_PERSONNEL_CERT_HISTORY, history, page_size=500)
            certs_upserted += len(history)
        cur.execute(MARK_PERSONNEL_FETCHED, (org_user_id,))
        orgs_fetched += 1

        if idx % 20 == 0:
            conn.commit()
        if idx % 100 == 0 or idx == len(targets):
            print(
                f"    personnel progress: {idx:,}/{len(targets):,} "
                f"orgs people={people_upserted:,} certs={certs_upserted:,}"
                f"  last={org_name}"
            )
        time.sleep(delay)

    conn.commit()
    cur.execute("ANALYZE amac_personnel")
    cur.execute("ANALYZE amac_personnel_cert_history")
    print(
        f"  Personnel orgs={orgs_fetched:,} people={people_upserted:,} "
        f"cert_history={certs_upserted:,}"
    )
    return people_upserted, orgs_fetched, certs_upserted


def run_etl(
    *,
    force_full: bool = False,
    dry_run: bool = False,
    page_size: int = PAGE_SIZE,
    request_delay: float = REQUEST_DELAY,
    detail_batch_size: int | None = None,
    personnel_batch_size: int | None = None,
    personnel_stale_size: int | None = None,
) -> dict:
    import requests
    from psycopg2.extras import execute_values

    try:
        full_sync_dow = int(os.environ.get("AMAC_ETL_FULL_SYNC_DOW", "6"))
    except ValueError:
        full_sync_dow = 6
    if detail_batch_size is None:
        try:
            detail_batch_size = int(os.environ.get("AMAC_EXTRA_ETL_DETAIL_BATCH_SIZE", "300"))
        except ValueError:
            detail_batch_size = 300
    if personnel_batch_size is None:
        try:
            personnel_batch_size = int(os.environ.get("AMAC_EXTRA_ETL_PERSONNEL_BATCH_SIZE", "0"))
        except ValueError:
            personnel_batch_size = 0
    if personnel_stale_size is None:
        try:
            personnel_stale_size = int(os.environ.get("AMAC_EXTRA_ETL_PERSONNEL_STALE_SIZE", "300"))
        except ValueError:
            personnel_stale_size = 300

    conn = _connect()
    session = requests.Session()

    with conn:
        with conn.cursor() as cur:
            ensure_schema(cur)
            cur.execute("SELECT COUNT(*) FROM amac_manager_details")
            details_count = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM amac_personnel")
            personnel_count = int(cur.fetchone()[0])
            full_details_sync = _should_run_full_sync(force_full, full_sync_dow) or details_count == 0
            mode = "full" if full_details_sync else "incremental"

            print(
                f"amac_extra_etl: mode={mode} details_in_db={details_count:,} "
                f"personnel_in_db={personnel_count:,} "
                f"detail_batch_size={detail_batch_size if not full_details_sync else 'all'} "
                f"personnel_batch_size={personnel_batch_size if not full_details_sync else 'all'}"
            )

            if dry_run:
                first = post_json(session, "/api/pof/manager", 0, min(page_size, 10), {})
                person_org = post_json(
                    session,
                    "/api/pof/personOrg",
                    0,
                    PERSON_API_PAGE_SIZE,
                    dict(PERSON_ORG_ALL_BODY),
                )
                summary = {
                    "ok": True,
                    "dry_run": True,
                    "mode": mode,
                    "full_details_sync": full_details_sync,
                    "managers_api_total": int(first.get("totalElements", 0)),
                    "person_org_api_total": int(person_org.get("totalElements", 0)),
                    "rows_upserted": len(first.get("content", [])),
                }
                print(json.dumps(summary, ensure_ascii=False))
                return summary

            managers_upserted, manager_rows = _upsert_managers(
                session, cur, execute_values, page_size=page_size, delay=request_delay
            )
            conn.commit()
            person_org_upserted = _upsert_person_org(
                session, cur, execute_values, page_size=page_size, delay=request_delay
            )
            conn.commit()
            details_fetched, executives_upserted, resumes_upserted = _upsert_manager_details(
                session,
                cur,
                execute_values,
                manager_rows,
                full_sync=full_details_sync,
                batch_size=0 if full_details_sync else detail_batch_size,
                delay=request_delay,
            )
            conn.commit()
            personnel_upserted, personnel_orgs_fetched, personnel_certs_upserted = _upsert_personnel(
                session,
                cur,
                execute_values,
                conn,
                full_sync=full_details_sync,
                batch_size=0 if full_details_sync else personnel_batch_size,
                stale_size=0 if full_details_sync else personnel_stale_size,
                delay=request_delay,
            )

            _save_sync_state(
                cur,
                managers_upserted=managers_upserted,
                person_org_upserted=person_org_upserted,
                details_fetched=details_fetched,
                executives_upserted=executives_upserted,
                resumes_upserted=resumes_upserted,
                personnel_upserted=personnel_upserted,
                personnel_orgs_fetched=personnel_orgs_fetched,
                personnel_certs_upserted=personnel_certs_upserted,
                full_details_sync=full_details_sync,
            )

            metrics_history_appended = append_manager_metrics_history(cur)

    conn.close()
    rows_upserted = (
        managers_upserted
        + person_org_upserted
        + details_fetched
        + executives_upserted
        + resumes_upserted
        + personnel_upserted
        + personnel_certs_upserted
    )
    summary = {
        "ok": True,
        "mode": mode,
        "full_details_sync": full_details_sync,
        "managers_upserted": managers_upserted,
        "person_org_upserted": person_org_upserted,
        "details_fetched": details_fetched,
        "executives_upserted": executives_upserted,
        "resumes_upserted": resumes_upserted,
        "personnel_upserted": personnel_upserted,
        "personnel_orgs_fetched": personnel_orgs_fetched,
        "personnel_certs_upserted": personnel_certs_upserted,
        "metrics_history_appended": metrics_history_appended,
        "rows_upserted": rows_upserted,
        "dry_run": False,
    }
    print(json.dumps(summary, ensure_ascii=False))
    print(
        f"Done. mode={mode} managers={managers_upserted:,} person_org={person_org_upserted:,} "
        f"details={details_fetched:,} executives={executives_upserted:,} resumes={resumes_upserted:,} "
        f"personnel_orgs={personnel_orgs_fetched:,} people={personnel_upserted:,} "
        f"certs={personnel_certs_upserted:,} history+={metrics_history_appended:,}"
    )
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch AMAC extra data into PostgreSQL.")
    parser.add_argument("--full", action="store_true", help="Full manager-detail + personnel refresh.")
    parser.add_argument("--dry-run", action="store_true", help="Probe AMAC API only; do not write.")
    parser.add_argument("--page-size", type=int, default=PAGE_SIZE)
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY)
    parser.add_argument(
        "--detail-batch-size",
        type=int,
        default=0,
        help="Stale managers to refresh nightly (0 = use env AMAC_EXTRA_ETL_DETAIL_BATCH_SIZE).",
    )
    parser.add_argument(
        "--personnel-batch-size",
        type=int,
        default=-1,
        help="Max orgs to fetch people for (0 = all missing+stale, -1 = env AMAC_EXTRA_ETL_PERSONNEL_BATCH_SIZE).",
    )
    args = parser.parse_args()

    _load_env()

    batch_size = args.detail_batch_size if args.detail_batch_size > 0 else None
    personnel_batch = None if args.personnel_batch_size < 0 else args.personnel_batch_size

    try:
        run_etl(
            force_full=args.full,
            dry_run=args.dry_run,
            page_size=args.page_size,
            request_delay=args.delay,
            detail_batch_size=batch_size,
            personnel_batch_size=personnel_batch,
        )
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
