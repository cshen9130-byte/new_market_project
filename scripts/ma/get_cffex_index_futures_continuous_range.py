import json
import os
import sys
from pathlib import Path

import tushare as ts


def _load_env_from_files():
    candidates = []
    try:
        cwd = Path.cwd()
        candidates.append(cwd)
    except Exception:
        pass
    try:
        script_dir = Path(__file__).resolve().parent
        candidates.append(script_dir)
        candidates.append(script_dir.parent)
        candidates.append(script_dir.parent.parent)
    except Exception:
        pass
    for base in candidates:
        for fname in (".env", ".env.local"):
            f = base / fname
            if f.exists() and f.is_file():
                try:
                    for line in f.read_text(encoding="utf-8").splitlines():
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        if "=" not in line:
                            continue
                        key, val = line.split("=", 1)
                        key = key.strip()
                        val = val.strip().strip('"').strip("'")
                        if key and os.environ.get(key) is None:
                            os.environ[key] = val
                except Exception:
                    pass


def fetch_range(ts_code: str, start_date: str, end_date: str):
    pro = ts.pro_api(os.environ.get("TUSHARE_TOKEN"))
    fields = (
        "ts_code,trade_date,open,high,low,close,settle,vol,amount,oi,oi_chg"
    )
    df = pro.fut_daily(
        ts_code=ts_code,
        exchange="CFFEX",
        start_date=start_date,
        end_date=end_date,
        fields=fields,
    )
    if df is None or df.empty:
        return []
    df = df.sort_values("trade_date", ascending=True)
    out = []
    for _, row in df.iterrows():
        td = str(row.get("trade_date"))
        close = row.get("close")
        settle = row.get("settle")
        try:
            close = float(close) if close is not None else None
        except Exception:
            close = None
        try:
            settle = float(settle) if settle is not None else None
        except Exception:
            settle = None
        out.append({
            "trade_date": td,
            "close": close,
            "settle": settle,
        })
    return out


def main():
    _load_env_from_files()

    start_date = "20230101"
    end_date = ""
    if len(sys.argv) >= 3:
        start_date = sys.argv[1]
        end_date = sys.argv[2]
    if not end_date:
        from datetime import datetime
        end_date = datetime.today().strftime("%Y%m%d")

    # Four continuous legs for each index future
    legs = ["L", "L1", "L2", "L3"]
    bases = ["IH", "IF", "IC", "IM"]

    data = {}
    for base in bases:
        leg_data = {}
        for leg in legs:
            ts_code = f"{base}{leg}.CFX"
            leg_data[leg] = fetch_range(ts_code, start_date, end_date)
        data[base] = leg_data

    print(json.dumps({"start_date": start_date, "end_date": end_date, "data": data}, ensure_ascii=False))


if __name__ == "__main__":
    main()
