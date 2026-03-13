import os, sys, traceback
from pathlib import Path

for fname in ('.env.local', '.env'):
    f = Path(fname)
    if f.is_file():
        for line in f.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k] = v

try:
    import psycopg2
    url = os.environ.get('DATABASE_URL')
    print('DATABASE_URL present:', bool(url))
    conn = psycopg2.connect(url) if url else psycopg2.connect(
        host=os.environ.get('DB_HOST', 'localhost'),
        port=int(os.environ.get('DB_PORT', '5432')),
        dbname=os.environ.get('DB_NAME', 'market_data'),
        user=os.environ.get('DB_USER', 'market_user'),
        password=os.environ.get('DB_PASSWORD', ''),
    )
    print('Connected OK')
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS raw_etf_daily (
            id          BIGSERIAL     PRIMARY KEY,
            trade_date  DATE          NOT NULL,
            ticker      VARCHAR(20)   NOT NULL,
            field       VARCHAR(30)   NOT NULL DEFAULT 'ORIGINALUNIT',
            value       NUMERIC(20,6),
            source      VARCHAR(30)   NOT NULL DEFAULT 'emquant',
            fetched_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
            CONSTRAINT raw_etf_daily_uq UNIQUE (trade_date, ticker, field)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS raw_etf_daily_date_idx ON raw_etf_daily (trade_date DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS raw_etf_daily_ticker_date_idx ON raw_etf_daily (ticker, trade_date DESC)")
    cur.execute("""
        CREATE TABLE IF NOT EXISTS current_market_prediction (
            id          BIGSERIAL     PRIMARY KEY,
            trade_date  DATE          NOT NULL,
            cluster     SMALLINT,
            pc1         NUMERIC(12,8),
            pc2         NUMERIC(12,8),
            computed_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
            CONSTRAINT current_market_prediction_uq UNIQUE (trade_date)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS current_market_prediction_date_idx ON current_market_prediction (trade_date DESC)")
    conn.commit()
    cur.close()
    conn.close()
    print('OK: raw_etf_daily and current_market_prediction created (or already exist)')
except Exception:
    traceback.print_exc()
    sys.exit(1)
