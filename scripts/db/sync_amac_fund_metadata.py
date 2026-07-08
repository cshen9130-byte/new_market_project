#!/usr/bin/env python3
"""
sync_amac_fund_metadata.py
============================
Sync fund basic metadata from AMAC tables into basicinfo_bfl_track and
private_fund_managers_list.

Fields synced:
  - 备案日期  basicinfo_bfl_track.puton_date  ← amac_private_funds.put_on_record_date
  - 公司管理规模 basicinfo_bfl_track.scale     ← amac_manager_details.mgmt_scale_range
  - 管理人规模  private_fund_managers_list.mgmt_scale ← amac_manager_details.mgmt_scale_range

Default behaviour: fill NULL values only — never overwrite existing data.
Manual ops edits (source = ops/fund-elements) for 备案日期 are always preserved.

Manager metric trends (employee count, scale, etc.) are tracked in
amac_manager_metrics_history by amac_extra_etl.py (append-only snapshots).

Usage:
    python scripts/db/sync_amac_fund_metadata.py
    python scripts/db/sync_amac_fund_metadata.py --dry-run
    python scripts/db/sync_amac_fund_metadata.py --beian-hao SBAA99 --backfill-rows
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SOURCE_NAME = "amac_api"
OPS_SOURCE = "ops/fund-elements"
sys.path.insert(0, str(ROOT / "fetch_amac_data"))


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


def _table_exists(cur, name: str) -> bool:
    cur.execute("SELECT to_regclass(%s)", (f"public.{name}",))
    return cur.fetchone()[0] is not None


def _amac_fund_match_clause(track_alias: str, fund_alias: str) -> str:
    """Match 备案编号 exactly or via share-class suffix (TY187B → TY187)."""
    key = f"COALESCE({track_alias}.register_number, {track_alias}.record_key)"
    return f"""(
            {fund_alias}.fund_no = {key}
            OR (
                {key} ~ '[A-Z]$'
                AND REGEXP_REPLACE({key}, '[A-Z]$', '') = {fund_alias}.fund_no
            )
        )"""


def _fetch_amac_fund_by_keyword(fund_no: str) -> dict | None:
    import json
    import urllib.error
    import urllib.request

    from amac_client import fund_to_row  # type: ignore

    url = "https://gs.amac.org.cn/amac-infodisc/api/pof/fund?page=0&size=5"
    req = urllib.request.Request(
        url,
        data=json.dumps({"keywordCode": fund_no}).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json;charset=UTF-8",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Referer": "https://gs.amac.org.cn/amac-infodisc/res/pof/fund/index.html",
            "Origin": "https://gs.amac.org.cn",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None

    content = data.get("content") or []
    fund_no_upper = fund_no.upper()
    base_no = fund_no_upper.rstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    for item in content:
        row = fund_to_row(item)
        code = (row.get("fund_no") or "").upper()
        if code == fund_no_upper or (fund_no_upper.endswith(("A", "B", "C", "D")) and code == base_no):
            return row
    return None


def _upsert_amac_fund_row(cur, row: dict) -> None:
    from datetime import datetime

    def _parse_date(val):
        if not val:
            return None
        try:
            return datetime.strptime(str(val)[:10], "%Y-%m-%d").date()
        except ValueError:
            return None

    cur.execute(
        """
        INSERT INTO amac_private_funds (
            fund_name, fund_no, manager_name, manager_type, working_state,
            mandator_name, establish_date, put_on_record_date, detail_url, updated_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (fund_no) DO UPDATE SET
            fund_name = EXCLUDED.fund_name,
            manager_name = EXCLUDED.manager_name,
            manager_type = EXCLUDED.manager_type,
            working_state = EXCLUDED.working_state,
            mandator_name = EXCLUDED.mandator_name,
            establish_date = EXCLUDED.establish_date,
            put_on_record_date = EXCLUDED.put_on_record_date,
            detail_url = EXCLUDED.detail_url,
            updated_at = NOW()
        """,
        (
            row.get("fund_name"),
            row.get("fund_no"),
            row.get("manager_name"),
            row.get("manager_type"),
            row.get("working_state"),
            row.get("mandator_name"),
            _parse_date(row.get("establish_date")),
            _parse_date(row.get("put_on_record_date")),
            row.get("detail_url"),
        ),
    )


def _fetch_missing_amac_funds(cur, beian_haos: list[str], limit: int) -> int:
    params: list = []
    beian_clause = ""
    if beian_haos:
        placeholders = ", ".join(["%s"] * len(beian_haos))
        beian_clause = (
            f" AND (b.register_number IN ({placeholders}) OR b.record_key IN ({placeholders}))"
        )
        params.extend(beian_haos)
        params.extend(beian_haos)

    cur.execute(
        f"""
        SELECT DISTINCT COALESCE(b.register_number, b.record_key) AS fund_no
        FROM basicinfo_bfl_track b
        WHERE b.puton_date IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM amac_private_funds a
            WHERE {_amac_fund_match_clause("b", "a")}
          )
          {beian_clause}
        LIMIT %s
        """,
        [*params, limit],
    )
    candidates = [r[0] for r in cur.fetchall() if r[0]]
    fetched = 0
    for fund_no in candidates:
        row = _fetch_amac_fund_by_keyword(fund_no)
        if row and row.get("fund_no"):
            _upsert_amac_fund_row(cur, row)
            fetched += 1
    return fetched


def _beian_filter(alias: str, beian_haos: list[str], params: list) -> str:
    if not beian_haos:
        return ""
    placeholders = ", ".join(["%s"] * len(beian_haos))
    params.extend(beian_haos)
    return (
        f" AND ({alias}.register_number IN ({placeholders})"
        f" OR {alias}.record_key IN ({placeholders}))"
    )


def _build_puton_date_sql(beian_haos: list[str]) -> tuple[str, list]:
    params: list = []
    beian_clause = _beian_filter("b", beian_haos, params)
    if beian_haos:
        params.extend(beian_haos)

    return (
        f"""
        UPDATE basicinfo_bfl_track b
        SET
            puton_date = a.put_on_record_date,
            payload = jsonb_set(
                COALESCE(b.payload, '{{}}'::jsonb),
                '{{puton_date}}',
                to_jsonb(to_char(a.put_on_record_date, 'YYYY-MM-DD')),
                true
            ),
            updated_at = NOW()
        FROM amac_private_funds a
        WHERE {_amac_fund_match_clause("b", "a")}
          AND a.put_on_record_date IS NOT NULL
          AND b.puton_date IS NULL
          AND (b.source IS NULL OR b.source <> '{OPS_SOURCE}')
          {beian_clause}
        """,
        params,
    )


def _build_scale_sql(beian_haos: list[str]) -> tuple[str, list]:
    params: list = []
    beian_clause = _beian_filter("b", beian_haos, params)
    if beian_haos:
        params.extend(beian_haos)

    return (
        f"""
        UPDATE basicinfo_bfl_track b
        SET
            scale = src.mgmt_scale_range,
            register_code = COALESCE(NULLIF(BTRIM(b.register_code), ''), src.registration_no),
            payload = jsonb_set(
                jsonb_set(
                    COALESCE(b.payload, '{{}}'::jsonb),
                    '{{FundsBase,scale}}',
                    to_jsonb(src.mgmt_scale_range),
                    true
                ),
                '{{FundsBase,register_code}}',
                to_jsonb(COALESCE(NULLIF(BTRIM(b.register_code), ''), src.registration_no)),
                true
            ),
            updated_at = NOW()
        FROM (
            SELECT
                b2.id,
                COALESCE(d_reg.mgmt_scale_range, d_name.mgmt_scale_range, d_fuzzy.mgmt_scale_range) AS mgmt_scale_range,
                COALESCE(d_reg.registration_no, d_name.registration_no, d_fuzzy.registration_no) AS registration_no
            FROM basicinfo_bfl_track b2
            LEFT JOIN private_fund_info pfi
                ON pfi.beian_hao = COALESCE(b2.register_number, b2.record_key)
            LEFT JOIN amac_manager_details d_reg
                ON d_reg.registration_no = NULLIF(BTRIM(b2.register_code), '')
            LEFT JOIN amac_managers m_exact
                ON m_exact.manager_name = COALESCE(
                    NULLIF(BTRIM(pfi.manager), ''),
                    NULLIF(BTRIM(b2.advisor), ''),
                    NULLIF(BTRIM(b2.advisor2), '')
                )
            LEFT JOIN amac_manager_details d_name
                ON d_name.registration_no = m_exact.registration_no
            LEFT JOIN LATERAL (
                SELECT m.registration_no, d.mgmt_scale_range
                FROM amac_managers m
                JOIN amac_manager_details d ON d.registration_no = m.registration_no
                WHERE COALESCE(NULLIF(BTRIM(pfi.manager), ''), NULLIF(BTRIM(b2.advisor), '')) IS NOT NULL
                  AND m.manager_name ILIKE '%%' || COALESCE(NULLIF(BTRIM(pfi.manager), ''), NULLIF(BTRIM(b2.advisor), '')) || '%%'
                ORDER BY LENGTH(m.manager_name) ASC
                LIMIT 1
            ) d_fuzzy ON TRUE
        ) src
        WHERE b.id = src.id
          AND src.mgmt_scale_range IS NOT NULL
          AND b.scale IS NULL
          {beian_clause}
        """,
        params,
    )


MANAGERS_LIST_SQL = """
UPDATE private_fund_managers_list p
SET
    mgmt_scale = COALESCE(p.mgmt_scale, d.mgmt_scale_range),
    active_product_count = COALESCE(p.active_product_count, m.active_fund_count),
    updated_at = NOW()
FROM amac_manager_details d
JOIN amac_managers m ON m.registration_no = d.registration_no
WHERE p.registration_no = d.registration_no
  AND (
    (p.mgmt_scale IS NULL AND d.mgmt_scale_range IS NOT NULL)
    OR (p.active_product_count IS NULL AND m.active_fund_count IS NOT NULL)
  )
"""


BACKFILL_ROWS_SQL = """
INSERT INTO basicinfo_bfl_track (
    record_key, register_number, fund_name, fund_short_name, advisor,
    inception_date, puton_date, scale, register_code,
    payload, row_hash, source, fund_type, imported_at, updated_at
)
SELECT
    a.fund_no,
    a.fund_no,
    a.fund_name,
    a.fund_name,
    a.manager_name,
    a.establish_date,
    a.put_on_record_date,
    d.mgmt_scale_range,
    COALESCE(d.registration_no, m.registration_no),
    jsonb_build_object(
        'fund_name', a.fund_name,
        'fund_short_name', a.fund_name,
        'register_number', a.fund_no,
        'advisor', COALESCE(a.manager_name, ''),
        'puton_date', to_char(a.put_on_record_date, 'YYYY-MM-DD'),
        'inception_date', to_char(a.establish_date, 'YYYY-MM-DD'),
        'fund_type', 2,
        'FundsBase', jsonb_build_object(
            'scale', d.mgmt_scale_range,
            'register_code', COALESCE(d.registration_no, m.registration_no)
        )
    ),
    %s,
    %s,
    2,
    NOW(),
    NOW()
FROM amac_private_funds a
JOIN private_fund_info p ON p.beian_hao = a.fund_no
LEFT JOIN amac_managers m ON m.manager_name = a.manager_name
LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
WHERE a.fund_no = %s
ON CONFLICT (record_key) DO UPDATE SET
    puton_date = COALESCE(basicinfo_bfl_track.puton_date, EXCLUDED.puton_date),
    scale = COALESCE(basicinfo_bfl_track.scale, EXCLUDED.scale),
    register_code = COALESCE(NULLIF(BTRIM(basicinfo_bfl_track.register_code), ''), EXCLUDED.register_code),
    advisor = COALESCE(NULLIF(BTRIM(basicinfo_bfl_track.advisor), ''), EXCLUDED.advisor),
    fund_name = COALESCE(NULLIF(BTRIM(basicinfo_bfl_track.fund_name), ''), EXCLUDED.fund_name),
    fund_short_name = COALESCE(NULLIF(BTRIM(basicinfo_bfl_track.fund_short_name), ''), EXCLUDED.fund_short_name),
    inception_date = COALESCE(basicinfo_bfl_track.inception_date, EXCLUDED.inception_date),
    payload = CASE
        WHEN basicinfo_bfl_track.puton_date IS NULL OR basicinfo_bfl_track.scale IS NULL
        THEN EXCLUDED.payload
        ELSE basicinfo_bfl_track.payload
    END,
    updated_at = NOW()
"""


def _row_hash(record_key: str) -> str:
    payload = f"sync_amac_fund_metadata::{record_key}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _preview_counts(cur, beian_haos: list[str]) -> dict:
    params: list = []
    beian_clause = ""
    if beian_haos:
        placeholders = ", ".join(["%s"] * len(beian_haos))
        beian_clause = (
            f" AND (b.register_number IN ({placeholders}) OR b.record_key IN ({placeholders}))"
        )
        params.extend(beian_haos)
        params.extend(beian_haos)

    cur.execute(
        f"""
        SELECT COUNT(*)
        FROM basicinfo_bfl_track b
        JOIN amac_private_funds a
          ON {_amac_fund_match_clause("b", "a")}
        WHERE a.put_on_record_date IS NOT NULL
          AND b.puton_date IS NULL
          {beian_clause}
        """,
        params,
    )
    puton_null = cur.fetchone()[0]

    cur.execute(
        f"""
        SELECT COUNT(*)
        FROM basicinfo_bfl_track b
        JOIN (
            SELECT
                b2.id,
                COALESCE(d_reg.mgmt_scale_range, d_name.mgmt_scale_range, d_fuzzy.mgmt_scale_range) AS mgmt_scale_range
            FROM basicinfo_bfl_track b2
            LEFT JOIN private_fund_info pfi
                ON pfi.beian_hao = COALESCE(b2.register_number, b2.record_key)
            LEFT JOIN amac_manager_details d_reg
                ON d_reg.registration_no = NULLIF(BTRIM(b2.register_code), '')
            LEFT JOIN amac_managers m_exact
                ON m_exact.manager_name = COALESCE(
                    NULLIF(BTRIM(pfi.manager), ''),
                    NULLIF(BTRIM(b2.advisor), ''),
                    NULLIF(BTRIM(b2.advisor2), '')
                )
            LEFT JOIN amac_manager_details d_name
                ON d_name.registration_no = m_exact.registration_no
            LEFT JOIN LATERAL (
                SELECT d.mgmt_scale_range
                FROM amac_managers m
                JOIN amac_manager_details d ON d.registration_no = m.registration_no
                WHERE COALESCE(NULLIF(BTRIM(pfi.manager), ''), NULLIF(BTRIM(b2.advisor), '')) IS NOT NULL
                  AND m.manager_name ILIKE '%%' || COALESCE(NULLIF(BTRIM(pfi.manager), ''), NULLIF(BTRIM(b2.advisor), '')) || '%%'
                ORDER BY LENGTH(m.manager_name) ASC
                LIMIT 1
            ) d_fuzzy ON TRUE
        ) src ON src.id = b.id
        WHERE src.mgmt_scale_range IS NOT NULL
          AND b.scale IS NULL
          {beian_clause}
        """,
        params,
    )
    scale_null = cur.fetchone()[0]

    return {"puton_date_null": puton_null, "scale_null": scale_null}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync 备案日期 and 公司管理规模 from AMAC tables into basicinfo_bfl_track."
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview counts only.")
    parser.add_argument(
        "--backfill-rows",
        action="store_true",
        help="Insert basicinfo_bfl_track rows for tracked funds missing from the table.",
    )
    parser.add_argument(
        "--beian-hao",
        action="append",
        default=[],
        dest="beian_haos",
        help="Limit sync to specific 备案编号 (repeatable).",
    )
    parser.add_argument(
        "--fetch-missing",
        type=int,
        default=50,
        metavar="N",
        help="Fetch up to N funds missing from amac_private_funds via AMAC keyword API (0=skip).",
    )
    args = parser.parse_args()
    beian_haos = [h.strip().upper() for h in args.beian_haos if h and h.strip()]

    _load_env()

    try:
        conn = _connect()
    except Exception as exc:
        print(f"Database connection failed: {exc}")
        sys.exit(1)

    required = [
        "basicinfo_bfl_track",
        "amac_private_funds",
        "amac_manager_details",
        "amac_managers",
    ]
    with conn:
        with conn.cursor() as cur:
            missing = [t for t in required if not _table_exists(cur, t)]
            if missing:
                print(f"Missing tables: {', '.join(missing)}")
                print("Run amac_private_funds_etl.py and amac_extra_etl.py first.")
                sys.exit(1)

            preview = _preview_counts(cur, beian_haos)
            print(
                f"Candidates (NULL only): puton_date={preview['puton_date_null']:,}, "
                f"scale={preview['scale_null']:,}"
            )
            if beian_haos:
                print(f"Filtered to: {', '.join(beian_haos)}")

            if args.dry_run:
                print("Dry run — no rows updated.")
                return

            fetched = 0
            if args.fetch_missing > 0:
                fetched = _fetch_missing_amac_funds(cur, beian_haos, args.fetch_missing)
                if fetched:
                    print(f"Fetched {fetched} missing fund(s) from AMAC API")

            puton_sql, puton_params = _build_puton_date_sql(beian_haos)
            cur.execute(puton_sql, puton_params)
            puton_updated = cur.rowcount

            scale_sql, scale_params = _build_scale_sql(beian_haos)
            cur.execute(scale_sql, scale_params)
            scale_updated = cur.rowcount

            cur.execute(MANAGERS_LIST_SQL)
            managers_updated = cur.rowcount

            backfill_inserted = 0
            if args.backfill_rows:
                backfill_sql = """
                    SELECT a.fund_no
                    FROM amac_private_funds a
                    JOIN private_fund_info p ON p.beian_hao = a.fund_no
                    WHERE NOT EXISTS (
                        SELECT 1 FROM basicinfo_bfl_track b
                        WHERE b.register_number = a.fund_no OR b.record_key = a.fund_no
                    )
                """
                backfill_params: list = []
                if beian_haos:
                    placeholders = ", ".join(["%s"] * len(beian_haos))
                    backfill_sql += f" AND a.fund_no IN ({placeholders})"
                    backfill_params.extend(beian_haos)
                cur.execute(backfill_sql, backfill_params)
                for (fund_no,) in cur.fetchall():
                    cur.execute(
                        BACKFILL_ROWS_SQL,
                        [_row_hash(fund_no), SOURCE_NAME, fund_no],
                    )
                    backfill_inserted += cur.rowcount

            cur.execute("ANALYZE basicinfo_bfl_track")

    conn.close()

    summary = {
        "ok": True,
        "amac_funds_fetched": fetched,
        "puton_date_updated": puton_updated,
        "scale_updated": scale_updated,
        "managers_list_updated": managers_updated,
        "backfill_inserted": backfill_inserted,
        "beian_haos": beian_haos,
    }
    print(json.dumps(summary, ensure_ascii=False))
    print(
        f"Updated puton_date={puton_updated:,}, scale={scale_updated:,}, "
        f"managers_list={managers_updated:,}, backfill={backfill_inserted:,}"
    )


if __name__ == "__main__":
    main()
