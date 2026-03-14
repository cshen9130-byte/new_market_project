import akshare as ak
import pandas as pd
from pathlib import Path
from datetime import date
import time

# akshare bond_china_yield accepts start_date / end_date as 'YYYYMMDD' strings
# and returns multiple curve types; we filter for the govt bond curve (中债国债收益率曲线)
CURVE_NAME = "中债国债收益率曲线"
YIELD_COL  = "10年"
DATE_COL   = "日期"
CHUNK_DAYS = 365           # fetch one year at a time to avoid large single requests
MAX_RETRIES = 5
RETRY_DELAY = 5            # seconds between retries

def daterange_chunks(start: date, end: date, days: int):
    cur = start
    while cur <= end:
        chunk_end = min(date.fromordinal(cur.toordinal() + days - 1), end)
        yield cur, chunk_end
        cur = date.fromordinal(chunk_end.toordinal() + 1)

start_date = date(2000, 1, 1)
end_date   = date(2026, 3, 14)

frames = []
for s, e in daterange_chunks(start_date, end_date, CHUNK_DAYS):
    s_str, e_str = s.strftime("%Y%m%d"), e.strftime("%Y%m%d")
    success = False
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            df = ak.bond_china_yield(start_date=s_str, end_date=e_str)
            gov = df[df["曲线名称"] == CURVE_NAME]
            if not gov.empty:
                frames.append(gov[[DATE_COL, YIELD_COL]])
            print(f"Fetched {s_str}~{e_str}: {len(gov)} govt-bond rows")
            success = True
            break
        except Exception as exc:
            if attempt < MAX_RETRIES:
                print(f"Attempt {attempt} failed for {s_str}~{e_str}: {exc}. Retrying in {RETRY_DELAY}s...")
                time.sleep(RETRY_DELAY)
            else:
                print(f"Skipped {s_str}~{e_str} after {MAX_RETRIES} attempts: {exc}")

if not frames:
    print("No data fetched.")
    raise SystemExit(1)

raw = pd.concat(frames, ignore_index=True)
raw[DATE_COL] = pd.to_datetime(raw[DATE_COL])
raw[YIELD_COL] = pd.to_numeric(raw[YIELD_COL], errors="coerce")
raw = raw.dropna().sort_values(DATE_COL).set_index(DATE_COL)

# Resample to monthly mean
monthly = raw.resample("ME").mean().reset_index()
monthly.columns = ["date", "china_10y_yield"]
monthly["date"] = monthly["date"].dt.strftime("%Y/%m/%d")

output_path = Path(__file__).parent / "data" / "china_10y_bond_yield_monthly.csv"
output_path.parent.mkdir(parents=True, exist_ok=True)
monthly.to_csv(output_path, index=False, encoding="utf-8-sig")
print(f"\nSaved {len(monthly)} rows to: {output_path}")
print(monthly.tail())
