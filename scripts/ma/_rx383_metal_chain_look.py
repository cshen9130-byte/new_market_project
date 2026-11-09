# -*- coding: utf-8 -*-
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_option_strategy_report as base  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402

conn = get_conn()
try:
    chain = base.prof.read_sql(
        conn,
        """
        SELECT trade_date::date AS dt, contract, COALESCE(clear, close)::float8 AS settl
        FROM raw_options_contracts_daily
        WHERE trade_date BETWEEN DATE '2026-10-13' AND DATE '2026-10-31'
          AND (
            contract ILIKE 'cu2611%' OR contract ILIKE 'cu2612%'
            OR contract ILIKE 'ni2611%' OR contract ILIKE 'ni2612%'
            OR contract ILIKE 'sn2611%' OR contract ILIKE 'sn2612%'
            OR contract ILIKE 'pb2612%'
          )
        """,
    )
finally:
    conn.close()
print("rows", len(chain))
if chain.empty:
    raise SystemExit
chain["dt"] = pd.to_datetime(chain["dt"])
chain["code"] = chain["contract"].map(base.norm_code)
print(chain.groupby(chain["dt"].dt.strftime("%m-%d"))["code"].count())
print("sample", chain["contract"].head(8).tolist())
print("codes", sorted(chain["code"].unique())[:30])
# the trades we care about
want = ["CU2611C120000", "NI2611C130000", "SN2611C450000", "CU2612C120000", "NI2612P100000", "PB2612C17000", "SN2612P310000"]
sub = chain[chain["code"].isin(want)]
print("wanted hits", len(sub))
print(sub.sort_values(["code", "dt"])[["dt", "contract", "settl"]].to_string(index=False))
