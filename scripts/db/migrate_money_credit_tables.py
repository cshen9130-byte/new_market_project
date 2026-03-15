"""
migrate_money_credit_tables.py
Create DB tables for the money+credit cycle model.
Run once: python3 scripts/db/migrate_money_credit_tables.py
"""
import os, sys
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

    # 1. SHIBOR 3M monthly (month-end)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS shibor_3m_monthly (
            month           DATE PRIMARY KEY,
            shibor_3m_close NUMERIC(10,4),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    print('  ✓ shibor_3m_monthly')

    # 2. Money+credit cycle results
    cur.execute("""
        CREATE TABLE IF NOT EXISTS money_credit_cycle (
            month          DATE PRIMARY KEY,
            social         NUMERIC(10,4),
            shibor         NUMERIC(10,4),
            social_ma      NUMERIC(10,4),
            shibor_ma      NUMERIC(10,4),
            social_slope   NUMERIC(10,6),
            shibor_slope   NUMERIC(10,6),
            monetary_state TEXT,
            credit_state   TEXT,
            monetary       TEXT,
            credit         TEXT,
            quadrant       TEXT,
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    print('  ✓ money_credit_cycle')

    conn.commit()
    cur.close()
    conn.close()
    print('Done.')
    sys.exit(0)

except Exception as e:
    print(f'ERROR: {e}')
    sys.exit(1)
