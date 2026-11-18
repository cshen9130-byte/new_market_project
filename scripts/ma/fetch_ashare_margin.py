"""Print daily SH+SZ 融资融券余额 as date,yuan. One row per date."""
import sys

import akshare as ak
import pandas as pd


def main() -> None:
    sh = ak.macro_china_market_margin_sh()
    sz = ak.macro_china_market_margin_sz()
    sh["日期"] = pd.to_datetime(sh["日期"])
    sz["日期"] = pd.to_datetime(sz["日期"])
    merged = sh.merge(sz, on="日期", suffixes=("_sh", "_sz"))
    balance = merged["融资融券余额_sh"].astype(float) + merged["融资融券余额_sz"].astype(float)
    start = pd.Timestamp.today().normalize() - pd.Timedelta(days=900)
    kept = merged.loc[merged["日期"] >= start, ["日期"]].copy()
    kept["margin"] = balance.loc[kept.index]
    for date, value in zip(kept["日期"], kept["margin"]):
        if pd.isna(value):
            continue
        print(f"{date.strftime('%Y-%m-%d')},{float(value):.0f}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
