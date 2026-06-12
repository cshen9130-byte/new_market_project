#!/usr/bin/env python3
"""
migrate_nav_csv_group_type6.py
================================
Creates private_fund_nav_group_type6 and loads NAV time-series from
nav_csv_group_type6/ (one CSV per fund: {product_name}_{beian_hao}.csv).

Safe to re-run: CREATE TABLE uses IF NOT EXISTS; rows upsert on (beian_hao, price_date).

Usage:
    python scripts/db/migrate_nav_csv_group_type6.py
"""

from __future__ import annotations

import os
import sys
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
NAV_DIR = ROOT / "nav_csv_group_type6"


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


def _parse_date(val) -> date | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    s = str(val).strip()
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _parse_numeric(val) -> Decimal | None:
    if val is None:
        return None
    s = str(val).strip().replace(",", "")
    if not s or s.lower() in ("nan", "none", "-"):
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


_load_env()

try:
    import pandas as pd
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError as exc:
    print(f"Missing dependency: {exc}. Run: pip install pandas psycopg2-binary")
    sys.exit(1)

if not NAV_DIR.is_dir():
    print(f"NAV directory not found: {NAV_DIR}")
    sys.exit(1)

url = os.environ.get("DATABASE_URL")
if url:
    conn = psycopg2.connect(url)
else:
    conn = psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", "market_data"),
        user=os.environ.get("DB_USER", "market_user"),
        password=os.environ.get("DB_PASSWORD", ""),
    )

DDL = """
CREATE TABLE IF NOT EXISTS private_fund_nav_group_type6 (
    id                  BIGSERIAL PRIMARY KEY,
    beian_hao           TEXT NOT NULL,
    product_name        TEXT,
    price_date          DATE NOT NULL,
    nav                 NUMERIC(16,6),
    cumulative_nav      NUMERIC(16,6),
    cum_nav_withdrawal  NUMERIC(16,6),
    price_change        NUMERIC(16,6),
    CONSTRAINT uq_fund_nav_group_type6 UNIQUE (beian_hao, price_date)
);

CREATE INDEX IF NOT EXISTS idx_pfngt6_beian
    ON private_fund_nav_group_type6 (beian_hao);

CREATE INDEX IF NOT EXISTS idx_pfngt6_date
    ON private_fund_nav_group_type6 (price_date);

CREATE INDEX IF NOT EXISTS idx_pfngt6_product
    ON private_fund_nav_group_type6 (product_name);

CREATE INDEX IF NOT EXISTS idx_pfngt6_beian_date
    ON private_fund_nav_group_type6 (beian_hao, price_date DESC);

CREATE INDEX IF NOT EXISTS idx_pfngt6_product_date
    ON private_fund_nav_group_type6 (product_name, price_date DESC);
"""

UPSERT_SQL = """
INSERT INTO private_fund_nav_group_type6
    (beian_hao, product_name, price_date, nav, cumulative_nav,
     cum_nav_withdrawal, price_change)
VALUES %s
ON CONFLICT (beian_hao, price_date) DO UPDATE SET
    product_name       = EXCLUDED.product_name,
    nav                = EXCLUDED.nav,
    cumulative_nav     = EXCLUDED.cumulative_nav,
    cum_nav_withdrawal = EXCLUDED.cum_nav_withdrawal,
    price_change       = EXCLUDED.price_change
"""


def main() -> None:
    csv_files = sorted(f for f in os.listdir(NAV_DIR) if f.endswith(".csv"))
    if not csv_files:
        print(f"No CSV files found in {NAV_DIR}")
        sys.exit(1)

    print(f"Found {len(csv_files)} CSV files in {NAV_DIR.name}/")

    batch_size = 200
    nav_batch: list[tuple] = []
    errors: list[str] = []
    rows_loaded = 0

    with conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            print("  + private_fund_nav_group_type6 table ready")

            for idx, fname in enumerate(csv_files, 1):
                stem = fname[:-4]
                parts = stem.rsplit("_", 1)
                if len(parts) != 2:
                    errors.append(f"Skipped (bad name): {fname}")
                    continue
                product_name, beian_hao = parts[0].strip(), parts[1].strip()

                fpath = NAV_DIR / fname
                try:
                    nav_df = pd.read_csv(fpath, parse_dates=["price_date"])
                except Exception as exc:
                    errors.append(f"Read error {fname}: {exc}")
                    continue

                for _, row in nav_df.iterrows():
                    price_date = _parse_date(row.get("price_date"))
                    if price_date is None:
                        continue
                    nav_batch.append((
                        beian_hao,
                        product_name,
                        price_date,
                        _parse_numeric(row.get("nav")),
                        _parse_numeric(row.get("cumulative_nav")),
                        _parse_numeric(row.get("cumulative_nav_withdrawal")),
                        _parse_numeric(row.get("price_change")),
                    ))

                if idx % batch_size == 0 or idx == len(csv_files):
                    deduped: dict[tuple[str, date], tuple] = {}
                    for row in nav_batch:
                        deduped[(row[0], row[2])] = row
                    unique_batch = list(deduped.values())
                    if unique_batch:
                        execute_values(cur, UPSERT_SQL, unique_batch, page_size=2000)
                        rows_loaded += len(unique_batch)
                    nav_batch.clear()
                    print(f"  Committed up to file {idx}/{len(csv_files)}")

            cur.execute("SELECT COUNT(*) FROM private_fund_nav_group_type6")
            total = cur.fetchone()[0]
            cur.execute("SELECT COUNT(DISTINCT beian_hao) FROM private_fund_nav_group_type6")
            funds = cur.fetchone()[0]

    conn.close()

    if errors:
        print(f"\n{len(errors)} warnings:")
        for err in errors[:20]:
            print(err)
        if len(errors) > 20:
            print(f"  … and {len(errors) - 20} more")

    print(f"\nLoaded {rows_loaded} NAV rows for {funds} funds ({total} rows in table).")
    print("Migration complete.")


if __name__ == "__main__":
    main()
