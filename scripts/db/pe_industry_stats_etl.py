#!/usr/bin/env python3
"""
pe_industry_stats_etl.py
========================
Aggregate AMAC PostgreSQL data into precomputed tables for the 私募行业 dashboard.

Reads from amac_private_funds, amac_managers, amac_manager_details, and
amac_manager_metrics_history. Writes to pe_industry_monthly_stats and
pe_industry_snapshot.

Usage:
    python scripts/db/pe_industry_stats_etl.py
    python scripts/db/pe_industry_stats_etl.py --dry-run
    python scripts/ma/nightly_etl.py --step pe_industry_stats
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from calendar import monthrange
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

# 私募证券类 = 私募证券投资基金管理人 + 私募资产配置类基金管理人 (same scope as 火富牛)
SEC_MANAGER_FILTER = """
    (
        m.org_type LIKE '%%私募证券%%'
        OR m.org_type LIKE '%%私募资产配置%%'
        OR d.org_type LIKE '%%私募证券%%'
        OR d.org_type LIKE '%%私募资产配置%%'
        OR d.business_type LIKE '%%私募证券%%'
        OR d.business_type LIKE '%%私募资产配置%%'
    )
"""

# Classify funds via materialized sec_managers / sec_funds temp tables.
SEC_FUND_JOIN = "INNER JOIN sec_managers sm ON f.manager_name = sm.manager_name"

LIQUIDATION_STATES = ("提前清算", "正常清算", "延期清算")


def _log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _prepare_workspace(cur) -> tuple[int, int]:
    """Materialize sec managers + their funds once for all downstream aggregations."""
    _log("Caching 私募证券类 managers and funds…")
    cur.execute("DROP TABLE IF EXISTS sec_funds")
    cur.execute("DROP TABLE IF EXISTS sec_managers")
    cur.execute(
        f"""
        CREATE TEMP TABLE sec_managers AS
        SELECT DISTINCT m.manager_name, m.registration_no, m.registration_date
        {_manager_from_clause()}
        WHERE {SEC_MANAGER_FILTER}
        """,
    )
    cur.execute("CREATE INDEX sec_managers_name_idx ON sec_managers (manager_name)")
    cur.execute("CREATE INDEX sec_managers_reg_date_idx ON sec_managers (registration_date)")
    cur.execute(
        """
        CREATE TEMP TABLE sec_funds AS
        SELECT f.manager_name, f.put_on_record_date, f.working_state, f.updated_at
        FROM amac_private_funds f
        WHERE EXISTS (
            SELECT 1
            FROM sec_managers sm
            WHERE f.manager_name = sm.manager_name
               OR regexp_replace(f.manager_name, '[\\s　]+', '', 'g')
                  = regexp_replace(sm.manager_name, '[\\s　]+', '', 'g')
        )
        """,
    )
    cur.execute("CREATE INDEX sec_funds_put_on_record_date_idx ON sec_funds (put_on_record_date)")
    cur.execute("CREATE INDEX sec_funds_updated_at_idx ON sec_funds (updated_at)")
    cur.execute("SELECT COUNT(*) FROM sec_managers")
    manager_count = int(cur.fetchone()[0])
    cur.execute("SELECT COUNT(*) FROM sec_funds")
    fund_count = int(cur.fetchone()[0])
    _log(f"Cached {manager_count:,} sec managers and {fund_count:,} sec funds")
    return manager_count, fund_count


def _fund_stock_state_clause(month_end: date) -> tuple[str, tuple]:
    return (
        """
          AND f.put_on_record_date IS NOT NULL
          AND f.put_on_record_date <= %s
          AND (
            f.working_state = '正在运作'
            OR (
              f.working_state = ANY(%s)
              AND f.updated_at::date > %s
            )
          )
        """,
        (month_end, list(LIQUIDATION_STATES), month_end),
    )


SCALE_BUCKETS = (
    "0-5亿元",
    "5-10亿元",
    "10-20亿元",
    "20-50亿元",
    "50-100亿元",
    "100亿元以上",
)

SCALE_MIDPOINTS = {
    # Use upper-mid estimates — AMAC bucket midpoints understate vs industry totals (火富牛).
    "0-5亿元": 3.5,
    "5-10亿元": 8.5,
    "10-20亿元": 18.0,
    "20-50亿元": 40.0,
    "50-100亿元": 85.0,
    "100亿元以上": 200.0,
}

DONUT_COLORS = ("#D93025", "#1A73E8", "#FBBC04", "#14b8a6", "#84cc16", "#9333ea")

DDL = """
CREATE TABLE IF NOT EXISTS pe_industry_monthly_stats (
    month                       DATE PRIMARY KEY,
    new_filing_count            INTEGER NOT NULL DEFAULT 0,
    new_filing_scale            NUMERIC(14, 2) NOT NULL DEFAULT 0,
    new_manager_count           INTEGER NOT NULL DEFAULT 0,
    stock_fund_count            INTEGER NOT NULL DEFAULT 0,
    stock_fund_scale            NUMERIC(14, 2) NOT NULL DEFAULT 0,
    stock_manager_count         INTEGER NOT NULL DEFAULT 0,
    liquidation_count           INTEGER NOT NULL DEFAULT 0,
    deregistered_manager_count  INTEGER NOT NULL DEFAULT 0,
    computed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pe_industry_snapshot (
    id                  TEXT PRIMARY KEY DEFAULT 'default',
    as_of               DATE NOT NULL,
    stock_scale         NUMERIC(14, 2) NOT NULL DEFAULT 0,
    stock_fund_count    INTEGER NOT NULL DEFAULT 0,
    stock_manager_count INTEGER NOT NULL DEFAULT 0,
    scale_dist          JSONB NOT NULL DEFAULT '[]'::jsonb,
    region_donut        JSONB NOT NULL DEFAULT '[]'::jsonb,
    region_table        JSONB NOT NULL DEFAULT '[]'::jsonb,
    scale_trend         JSONB NOT NULL DEFAULT '[]'::jsonb,
    scale_changes       JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""


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


def _month_start(year: int, month: int) -> date:
    return date(year, month, 1)


def _month_end(month_start: date) -> date:
    last_day = monthrange(month_start.year, month_start.month)[1]
    return date(month_start.year, month_start.month, last_day)


def _add_months(month_start: date, delta: int) -> date:
    year = month_start.year + (month_start.month - 1 + delta) // 12
    month = (month_start.month - 1 + delta) % 12 + 1
    return date(year, month, 1)


def _month_range(months_back: int) -> list[date]:
    today = date.today()
    end_month = _month_start(today.year, today.month)
    start_month = _add_months(end_month, -(months_back - 1))
    months: list[date] = []
    cursor = start_month
    while cursor <= end_month:
        months.append(cursor)
        cursor = _add_months(cursor, 1)
    return months


def _manager_from_clause() -> str:
    return """
        FROM amac_managers m
        LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
    """


def _sum_scale_from_buckets(bucket_counts: dict[str, int], *, total_managers: int) -> float:
    """Sum manager-scale midpoints; impute average for managers missing scale data."""
    known_total = 0.0
    known_count = 0
    for scale_range, count in bucket_counts.items():
        midpoint = SCALE_MIDPOINTS.get(scale_range)
        if midpoint is None:
            continue
        known_total += midpoint * int(count)
        known_count += int(count)
    missing = max(total_managers - known_count, 0)
    if known_count > 0 and missing > 0:
        known_total += (known_total / known_count) * missing
    return round(known_total, 2)


def _count_new_filings(cur, month_start: date, month_end: date) -> int:
    cur.execute(
        f"""
        SELECT COUNT(*)
        FROM amac_private_funds f
        {SEC_FUND_JOIN}
        WHERE f.put_on_record_date >= %s
          AND f.put_on_record_date <= %s
        """,
        (month_start, month_end),
    )
    return int(cur.fetchone()[0])


def _count_stock_funds(cur, month_end: date) -> int:
    state_clause, state_params = _fund_stock_state_clause(month_end)
    cur.execute(
        f"""
        SELECT COUNT(*)
        FROM amac_private_funds f
        {SEC_FUND_JOIN}
        WHERE 1=1
        {state_clause}
        """,
        state_params,
    )
    return int(cur.fetchone()[0])


def _count_new_managers(cur, month_start: date, month_end: date) -> int:
    cur.execute(
        f"""
        SELECT COUNT(*)
        {_manager_from_clause()}
        WHERE {SEC_MANAGER_FILTER}
          AND m.registration_date >= %s
          AND m.registration_date <= %s
        """,
        (month_start, month_end),
    )
    return int(cur.fetchone()[0])


def _count_stock_managers(cur, month_end: date) -> int:
    cur.execute(
        f"""
        SELECT COUNT(*)
        {_manager_from_clause()}
        WHERE {SEC_MANAGER_FILTER}
          AND m.registration_date IS NOT NULL
          AND m.registration_date <= %s
        """,
        (month_end,),
    )
    return int(cur.fetchone()[0])


def _count_liquidations(cur, month_start: date, next_month_start: date) -> int:
    cur.execute(
        f"""
        SELECT COUNT(*)
        FROM amac_private_funds f
        {SEC_FUND_JOIN}
        WHERE f.working_state = ANY(%s)
          AND f.updated_at >= %s
          AND f.updated_at < %s
        """,
        (list(LIQUIDATION_STATES), month_start, next_month_start),
    )
    return int(cur.fetchone()[0])


def _current_stock_scale(cur) -> float:
    cur.execute("SELECT COUNT(*) FROM sec_managers")
    total_managers = int(cur.fetchone()[0])

    cur.execute(
        f"""
        SELECT d.mgmt_scale_range, COUNT(*) AS cnt
        FROM sec_managers sm
        JOIN amac_manager_details d ON d.registration_no = sm.registration_no
        WHERE d.mgmt_scale_range IS NOT NULL
          AND d.mgmt_scale_range <> '-'
        GROUP BY d.mgmt_scale_range
        """,
    )
    bucket_counts = {row[0]: int(row[1]) for row in cur.fetchall()}
    return _sum_scale_from_buckets(bucket_counts, total_managers=total_managers)


def _scale_distribution(cur) -> list[dict]:
    cur.execute(
        """
        SELECT d.mgmt_scale_range, COUNT(*) AS cnt
        FROM sec_managers sm
        JOIN amac_manager_details d ON d.registration_no = sm.registration_no
        WHERE d.mgmt_scale_range IS NOT NULL
          AND d.mgmt_scale_range <> '-'
        GROUP BY d.mgmt_scale_range
        """,
    )
    counts = {row[0]: int(row[1]) for row in cur.fetchall()}
    return [
        {"label": bucket, "count": counts.get(bucket, 0)}
        for bucket in SCALE_BUCKETS
    ]


def _region_stats(cur) -> list[dict]:
    cur.execute(
        f"""
        WITH sec_mgr AS (
            SELECT sm.registration_no, sm.manager_name,
                   COALESCE(NULLIF(TRIM(m.reg_province), ''), '未知') AS region
            FROM sec_managers sm
            JOIN amac_managers m ON m.registration_no = sm.registration_no
        ),
        active_funds AS (
            SELECT sf.manager_name, COUNT(*) AS active_count
            FROM sec_funds sf
            WHERE sf.working_state = '正在运作'
            GROUP BY sf.manager_name
        )
        SELECT s.region,
               COUNT(*) AS manager_count,
               COALESCE(SUM(a.active_count), 0) AS active_product_count
        FROM sec_mgr s
        LEFT JOIN active_funds a ON a.manager_name = s.manager_name
        GROUP BY s.region
        ORDER BY manager_count DESC, region ASC
        """,
    )
    return [
        {
            "region": row[0],
            "managerCount": int(row[1]),
            "activeProductCount": int(row[2]),
        }
        for row in cur.fetchall()
    ]


def _region_donut(region_table: list[dict]) -> list[dict]:
    top = region_table[:5]
    other_count = sum(row["managerCount"] for row in region_table[5:])
    donut = [
        {
            "name": row["region"],
            "value": row["managerCount"],
            "color": DONUT_COLORS[index % len(DONUT_COLORS)],
        }
        for index, row in enumerate(top)
    ]
    if other_count > 0:
        donut.append(
            {
                "name": "其他",
                "value": other_count,
                "color": DONUT_COLORS[5 % len(DONUT_COLORS)],
            }
        )
    return donut


def _scale_trend(cur) -> list[dict]:
    cur.execute(
        f"""
        SELECT to_char(date_trunc('month', h.snapshot_date), 'YYYY-MM') AS month,
               h.mgmt_scale_range,
               COUNT(DISTINCT h.registration_no) AS cnt
        FROM amac_manager_metrics_history h
        JOIN amac_managers m ON m.registration_no = h.registration_no
        LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
        WHERE {SEC_MANAGER_FILTER}
          AND h.mgmt_scale_range IS NOT NULL
          AND h.mgmt_scale_range <> '-'
        GROUP BY 1, 2
        ORDER BY 1 ASC
        """,
    )
    by_month: dict[str, dict[str, int]] = {}
    for month, scale_range, count in cur.fetchall():
        bucket_counts = by_month.setdefault(month, {})
        bucket_counts[scale_range] = int(count)

    if not by_month:
        dist = _scale_distribution(cur)
        month_key = date.today().strftime("%Y-%m")
        by_month[month_key] = {row["label"]: row["count"] for row in dist}

    trend: list[dict] = []
    for month in sorted(by_month.keys()):
        counts = by_month[month]
        trend.append(
            {
                "month": month,
                "counts": {bucket: counts.get(bucket, 0) for bucket in SCALE_BUCKETS},
            }
        )
    return trend


def _scale_changes(cur) -> dict:
    cur.execute(
        f"""
        SELECT DISTINCT snapshot_date
        FROM amac_manager_metrics_history
        ORDER BY snapshot_date DESC
        LIMIT 2
        """,
    )
    dates = [row[0] for row in cur.fetchall()]
    if len(dates) < 2:
        return {"updatedAt": date.today().strftime("%Y-%m"), "rows": []}

    latest, previous = dates[0], dates[1]
    cur.execute(
        f"""
        WITH latest AS (
            SELECT DISTINCT ON (h.registration_no)
                h.registration_no,
                h.manager_name,
                h.mgmt_scale_range
            FROM amac_manager_metrics_history h
            JOIN amac_managers m ON m.registration_no = h.registration_no
            LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
            WHERE {SEC_MANAGER_FILTER}
              AND h.snapshot_date = %s
              AND h.mgmt_scale_range IS NOT NULL
              AND h.mgmt_scale_range <> '-'
            ORDER BY h.registration_no, h.captured_at DESC
        ),
        previous AS (
            SELECT DISTINCT ON (h.registration_no)
                h.registration_no,
                h.mgmt_scale_range
            FROM amac_manager_metrics_history h
            JOIN amac_managers m ON m.registration_no = h.registration_no
            LEFT JOIN amac_manager_details d ON d.registration_no = m.registration_no
            WHERE {SEC_MANAGER_FILTER}
              AND h.snapshot_date = %s
              AND h.mgmt_scale_range IS NOT NULL
              AND h.mgmt_scale_range <> '-'
            ORDER BY h.registration_no, h.captured_at DESC
        )
        SELECT l.manager_name,
               l.registration_no,
               m.inception_date,
               p.mgmt_scale_range,
               l.mgmt_scale_range
        FROM latest l
        JOIN previous p ON p.registration_no = l.registration_no
        JOIN amac_managers m ON m.registration_no = l.registration_no
        WHERE p.mgmt_scale_range <> l.mgmt_scale_range
        ORDER BY l.manager_name
        LIMIT 200
        """,
        (latest, previous),
    )

    bucket_rank = {bucket: index for index, bucket in enumerate(SCALE_BUCKETS)}
    rows: list[dict] = []
    for manager_name, registration_no, inception_date, scale_before, scale_after in cur.fetchall():
        before_rank = bucket_rank.get(scale_before)
        after_rank = bucket_rank.get(scale_after)
        if before_rank is None or after_rank is None:
            continue
        direction = "up" if after_rank > before_rank else "down"
        rows.append(
            {
                "managerName": manager_name or "",
                "registrationNo": registration_no,
                "inceptionDate": inception_date.isoformat() if inception_date else "",
                "scaleBefore": scale_before,
                "scaleAfter": scale_after,
                "direction": direction,
            }
        )

    return {"updatedAt": latest.strftime("%Y-%m"), "rows": rows}


def compute_monthly_stats(cur, months_back: int = 24) -> list[tuple]:
    if not months:
        return []

    start_month = months[0]
    end_month = months[-1]
    liquidation_states = list(LIQUIDATION_STATES)
    cur.execute(
        """
        WITH months AS (
            SELECT d::date AS month_start,
                   (date_trunc('month', d::timestamp) + interval '1 month' - interval '1 day')::date AS month_end,
                   (date_trunc('month', d::timestamp) + interval '1 month')::date AS next_month_start
            FROM generate_series(%s::date, %s::date, interval '1 month') AS d
        ),
        fund_by_month AS (
            SELECT m.month_start,
                   COUNT(*) FILTER (
                       WHERE sf.put_on_record_date >= m.month_start
                         AND sf.put_on_record_date <= m.month_end
                   ) AS new_filing_count,
                   COUNT(*) FILTER (
                       WHERE sf.put_on_record_date IS NOT NULL
                         AND sf.put_on_record_date <= m.month_end
                         AND sf.working_state = '正在运作'
                   ) AS stock_fund_count,
                   COUNT(*) FILTER (
                       WHERE sf.working_state = ANY(%s)
                         AND sf.updated_at >= m.month_start
                         AND sf.updated_at < m.next_month_start
                   ) AS liquidation_count
            FROM months m
            CROSS JOIN sec_funds sf
            GROUP BY m.month_start
        ),
        mgr_by_month AS (
            SELECT m.month_start,
                   COUNT(*) FILTER (
                       WHERE sm.registration_date >= m.month_start
                         AND sm.registration_date <= m.month_end
                   ) AS new_manager_count,
                   COUNT(*) FILTER (
                       WHERE sm.registration_date IS NOT NULL
                         AND sm.registration_date <= m.month_end
                   ) AS stock_manager_count
            FROM months m
            CROSS JOIN sec_managers sm
            GROUP BY m.month_start
        )
        SELECT f.month_start,
               f.new_filing_count,
               f.stock_fund_count,
               f.liquidation_count,
               mg.new_manager_count,
               mg.stock_manager_count
        FROM fund_by_month f
        JOIN mgr_by_month mg USING (month_start)
        ORDER BY f.month_start
        """,
        (start_month, end_month, liquidation_states),
    )
    columns = (
        "month_start",
        "new_filing_count",
        "stock_fund_count",
        "liquidation_count",
        "new_manager_count",
        "stock_manager_count",
    )
    return [dict(zip(columns, row)) for row in cur.fetchall()]


def compute_monthly_stats(cur, months_back: int = 24) -> list[tuple]:
    months = _month_range(months_back)
    _log(f"Computing monthly stats for {len(months)} months (bulk SQL)…")
    started = time.monotonic()

    bulk_rows = _compute_monthly_counts_bulk(cur, months)
    current_scale = _current_stock_scale(cur)
    latest_fund_count = int(bulk_rows[-1]["stock_fund_count"]) if bulk_rows else 0

    rows: list[tuple] = []
    for index, row in enumerate(bulk_rows, start=1):
        month_start = row["month_start"]
        month_key = month_start.strftime("%Y-%m")
        new_filing_count = int(row["new_filing_count"])
        stock_fund_count = int(row["stock_fund_count"])
        new_manager_count = int(row["new_manager_count"])
        stock_manager_count = int(row["stock_manager_count"])
        liquidation_count = int(row["liquidation_count"])

        # Keep 存量规模 consistent with 存量数量 — scale moves proportionally with active funds.
        stock_fund_scale = (
            round(current_scale * stock_fund_count / latest_fund_count, 2)
            if latest_fund_count > 0 and stock_fund_count > 0
            else 0.0
        )

        avg_fund_scale = (
            round(stock_fund_scale / stock_fund_count, 4)
            if stock_fund_count > 0 and stock_fund_scale > 0
            else 0.0
        )
        new_filing_scale = round(new_filing_count * avg_fund_scale, 2) if avg_fund_scale > 0 else 0.0

        rows.append(
            (
                month_start,
                new_filing_count,
                new_filing_scale,
                new_manager_count,
                stock_fund_count,
                stock_fund_scale,
                stock_manager_count,
                liquidation_count,
                0,
            )
        )
        if index == 1 or index == len(bulk_rows) or index % 6 == 0:
            _log(
                f"  month {index}/{len(bulk_rows)} {month_key}: "
                f"funds={stock_fund_count:,}, managers={stock_manager_count:,}, scale={stock_fund_scale:,.2f}"
            )

    _log(f"Monthly stats computed in {time.monotonic() - started:.1f}s")
    return rows


def run_etl(*, dry_run: bool = False, months_back: int = 24) -> dict:
    _load_env()
    conn = _connect()
    try:
        with conn.cursor() as cur:
            required = ("amac_private_funds", "amac_managers", "amac_manager_details")
            missing = [name for name in required if not _table_exists(cur, name)]
            if missing:
                raise RuntimeError(
                    f"Missing required tables: {', '.join(missing)}. "
                    "Run amac_private_funds_etl.py and amac_extra_etl.py first."
                )

            cur.execute(DDL)
            if not dry_run:
                conn.commit()

            _prepare_workspace(cur)
            monthly_rows = compute_monthly_stats(cur, months_back=months_back)
            if not monthly_rows:
                raise RuntimeError("No monthly stats computed")

            _log("Building snapshot aggregates…")
            latest = monthly_rows[-1]
            as_of = latest[0]
            stock_fund_count = latest[4]
            stock_manager_count = latest[6]
            stock_scale = latest[5]

            scale_dist = _scale_distribution(cur)
            region_table = _region_stats(cur)
            region_donut = _region_donut(region_table)
            scale_trend = _scale_trend(cur)
            scale_changes = _scale_changes(cur)

            if dry_run:
                return {
                    "ok": True,
                    "dry_run": True,
                    "monthly_rows": len(monthly_rows),
                    "as_of": as_of.isoformat(),
                    "stock_fund_count": stock_fund_count,
                    "stock_manager_count": stock_manager_count,
                    "stock_scale": float(stock_scale),
                }

            cur.execute("DELETE FROM pe_industry_monthly_stats")
            cur.executemany(
                """
                INSERT INTO pe_industry_monthly_stats (
                    month, new_filing_count, new_filing_scale, new_manager_count,
                    stock_fund_count, stock_fund_scale, stock_manager_count,
                    liquidation_count, deregistered_manager_count, computed_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                monthly_rows,
            )

            cur.execute(
                """
                INSERT INTO pe_industry_snapshot (
                    id, as_of, stock_scale, stock_fund_count, stock_manager_count,
                    scale_dist, region_donut, region_table, scale_trend, scale_changes,
                    computed_at
                ) VALUES (
                    'default', %s, %s, %s, %s,
                    %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb,
                    NOW()
                )
                ON CONFLICT (id) DO UPDATE SET
                    as_of = EXCLUDED.as_of,
                    stock_scale = EXCLUDED.stock_scale,
                    stock_fund_count = EXCLUDED.stock_fund_count,
                    stock_manager_count = EXCLUDED.stock_manager_count,
                    scale_dist = EXCLUDED.scale_dist,
                    region_donut = EXCLUDED.region_donut,
                    region_table = EXCLUDED.region_table,
                    scale_trend = EXCLUDED.scale_trend,
                    scale_changes = EXCLUDED.scale_changes,
                    computed_at = NOW()
                """,
                (
                    as_of,
                    stock_scale,
                    stock_fund_count,
                    stock_manager_count,
                    json.dumps(scale_dist, ensure_ascii=False),
                    json.dumps(region_donut, ensure_ascii=False),
                    json.dumps(region_table, ensure_ascii=False),
                    json.dumps(scale_trend, ensure_ascii=False),
                    json.dumps(scale_changes, ensure_ascii=False),
                ),
            )
            conn.commit()

            return {
                "ok": True,
                "monthly_rows": len(monthly_rows),
                "as_of": as_of.isoformat(),
                "stock_fund_count": stock_fund_count,
                "stock_manager_count": stock_manager_count,
                "stock_scale": float(stock_scale),
                "scale_change_rows": len(scale_changes.get("rows", [])),
            }
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Aggregate AMAC data for 私募行业 dashboard")
    parser.add_argument("--dry-run", action="store_true", help="Compute only; do not write")
    parser.add_argument("--months-back", type=int, default=24, help="Months of history (default 24)")
    args = parser.parse_args()

    summary = run_etl(dry_run=args.dry_run, months_back=args.months_back)
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
