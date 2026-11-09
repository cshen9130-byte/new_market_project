# -*- coding: utf-8 -*-
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_option_strategy_report as base
from mom_data_etl import get_conn

conn = get_conn()
try:
    df = base.prof.read_sql(conn, """
        SELECT contract, MAX(trade_date)::date AS last, COUNT(*) AS n
        FROM raw_futures_contracts_daily
        WHERE contract ILIKE 'RB2611%' OR contract ILIKE 'RU2611%'
           OR contract ILIKE 'rb2611%' OR contract ILIKE 'ru2611%'
        GROUP BY contract
    """)
finally:
    conn.close()
print(df.to_string(index=False) if len(df) else "none")
