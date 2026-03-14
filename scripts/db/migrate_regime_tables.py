"""
migrate_regime_tables.py
Create DB tables for the regime similarity model.
Run once: python scripts/db/migrate_regime_tables.py
"""
import os, sys, traceback
from pathlib import Path

for fname in ('.env.local', '.env'):
    for base in (Path('.'), Path(__file__).resolve().parent.parent.parent):
        f = base / fname
        if f.is_file():
            for line in f.read_text(encoding='utf-8', errors='ignore').splitlines():
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v

try:
    import psycopg2
    url = os.environ.get('DATABASE_URL')
    conn = psycopg2.connect(url) if url else psycopg2.connect(
        host=os.environ.get('DB_HOST', 'localhost'),
        port=int(os.environ.get('DB_PORT', '5432')),
        dbname=os.environ.get('DB_NAME', 'market_data'),
        user=os.environ.get('DB_USER', 'market_user'),
        password=os.environ.get('DB_PASSWORD', ''),
    )
    print('Connected OK')
    cur = conn.cursor()

    # 1. Monthly macro indicators
    cur.execute("""
        CREATE TABLE IF NOT EXISTS macro_indicators_monthly (
            month        DATE PRIMARY KEY,
            pmi          NUMERIC(10,4),
            afre         NUMERIC(10,4),
            m1           NUMERIC(10,4),
            cpi          NUMERIC(10,4),
            yield_10y    NUMERIC(10,4),
            spread_10y1y NUMERIC(10,4),
            nhci         NUMERIC(14,4),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # 2. Top-20 similar months per run
    cur.execute("""
        CREATE TABLE IF NOT EXISTS regime_similarity_top (
            run_date      DATE     NOT NULL,
            rank          SMALLINT NOT NULL,
            similar_month DATE     NOT NULL,
            distance      NUMERIC(12,6) NOT NULL,
            pmi_chg_z     NUMERIC(10,6),
            yield_chg_z   NUMERIC(10,6),
            spread_chg_z  NUMERIC(10,6),
            nhci_yoy_z    NUMERIC(10,6),
            afre_z        NUMERIC(10,6),
            m1_z          NUMERIC(10,6),
            cpi_z         NUMERIC(10,6),
            PRIMARY KEY (run_date, rank)
        )
    """)

    # 3. Current z-scores per run
    cur.execute("""
        CREATE TABLE IF NOT EXISTS regime_current_zscores (
            run_date      DATE PRIMARY KEY,
            current_month DATE NOT NULL,
            pmi_chg_z     NUMERIC(10,6),
            yield_chg_z   NUMERIC(10,6),
            spread_chg_z  NUMERIC(10,6),
            nhci_yoy_z    NUMERIC(10,6),
            afre_z        NUMERIC(10,6),
            m1_z          NUMERIC(10,6),
            cpi_z         NUMERIC(10,6)
        )
    """)

    # 4. All-distances table (for timeline chart)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS regime_all_distances (
            run_date   DATE     NOT NULL,
            hist_month DATE     NOT NULL,
            distance   NUMERIC(12,6) NOT NULL,
            PRIMARY KEY (run_date, hist_month)
        )
    """)

    conn.commit()
    print('All regime tables created (or already exist).')
    conn.close()

except Exception:
    traceback.print_exc()
    sys.exit(1)
