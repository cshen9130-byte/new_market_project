import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path


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


def _ymd_to_str(dt: str) -> str:
    # Expect YYYY-MM-DD
    try:
        d = datetime.strptime(dt, "%Y-%m-%d")
        return d.strftime("%Y%m%d")
    except Exception:
        return dt.replace("-", "")


def main():
    _load_env_from_files()
    token = os.environ.get("TUSHARE_TOKEN")
    if not token:
        print(json.dumps({"error": "Missing TUSHARE_TOKEN in environment"}))
        sys.exit(2)

    date_iso = os.environ.get("SPOT_TRADE_DATE") or (sys.argv[1] if len(sys.argv) > 1 else None)
    if not date_iso:
        date_iso = datetime.today().strftime("%Y-%m-%d")
    date_ymd = _ymd_to_str(date_iso)

    try:
        import tushare as ts
        pro = ts.pro_api(token)
    except Exception as e:
        print(json.dumps({"error": f"Tushare import/init failed: {e}"}))
        sys.exit(1)

    idx_map = {
        "IH": "000016.SH",
        "IF": "000300.SH",
        "IC": "000905.SH",
        "IM": "000852.SH",
    }

    result = {}
    for alias, code in idx_map.items():
        close_val = None
        used = date_ymd
        # Try today, else walk back up to 8 days
        for back in range(0, 8):
            dt = datetime.strptime(date_ymd, "%Y%m%d") - timedelta(days=back)
            ds = dt.strftime("%Y%m%d")
            try:
                df = pro.index_daily(ts_code=code, start_date=ds, end_date=ds)
                if df is not None and not df.empty:
                    row = df.iloc[-1]
                    v = row.get("close")
                    if v is not None:
                        try:
                            close_val = float(v)
                            used = ds
                            break
                        except Exception:
                            pass
            except Exception:
                pass
        result[alias] = {"code": code, "close": close_val, "trade_date": used}

    print(json.dumps({"trade_date": date_iso, "data": result}, ensure_ascii=False))


if __name__ == "__main__":
    main()