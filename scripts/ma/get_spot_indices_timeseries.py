import json
import os
import sys
from datetime import datetime
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


def log_callback(msg):
    try:
        if isinstance(msg, bytes):
            msg_str = msg.decode('utf-8', errors='ignore').strip()
        else:
            msg_str = str(msg)
        if 'heartbeat' in msg_str.lower():
            return 0
    except Exception:
        pass
    return 0


def normalize_csd(data_obj):
    result = []
    try:
        from datetime import datetime as dt
        dates = getattr(data_obj, "Dates", None) or getattr(data_obj, "Times", None)
        DD = getattr(data_obj, "Data", None) or getattr(data_obj, "Values", None)
        values = None
        if DD is not None:
            if isinstance(DD, dict):
                values = DD.get("CLOSE")
                if values is None and len(DD) > 0:
                    try:
                        values = next(iter(DD.values()))
                    except Exception:
                        values = None
            elif isinstance(DD, (list, tuple)):
                values = DD[0] if len(DD) > 0 else []
            else:
                values = DD
        if dates and values:
            try:
                dates = list(dates)
            except Exception:
                pass
            try:
                values = list(values)
            except Exception:
                pass
            try:
                if isinstance(values, (list, tuple)) and len(values) == 1:
                    inner = values[0]
                    try:
                        values = list(inner)
                    except Exception:
                        values = inner
                elif isinstance(values, (list, tuple)) and values and isinstance(values[0], (list, tuple)):
                    values = values[0]
            except Exception:
                pass
            if len(dates) == len(values):
                for d, v in zip(dates, values):
                    ds = d if isinstance(d, str) else getattr(d, "strftime", lambda *_: str(d))("%Y-%m-%d")
                    try:
                        if isinstance(ds, str) and "/" in ds:
                            ds_dt = dt.strptime(ds, "%Y/%m/%d")
                            ds = ds_dt.strftime("%Y-%m-%d")
                    except Exception:
                        pass
                    try:
                        fv = float(v)
                    except Exception:
                        fv = None
                    if fv is not None:
                        result.append({"date": ds, "close": fv})
    except Exception:
        pass
    return result


def main():
    _load_env_from_files()

    start_date = os.environ.get("START_ISO", "2023-01-01")
    end_date = os.environ.get("END_ISO", datetime.today().strftime("%Y-%m-%d"))
    if len(sys.argv) >= 3:
        start_date = sys.argv[1]
        end_date = sys.argv[2]

    try:
        import EmQuantAPI as Emq  # type: ignore
        c = Emq.c
    except Exception as e:
        print(json.dumps({"error": f"EmQuantAPI import failed: {e}"}))
        sys.exit(1)

    username = os.environ.get("EMQ_USERNAME")
    password = os.environ.get("EMQ_PASSWORD")
    if not username or not password:
        print(json.dumps({"error": "Missing EMQ_USERNAME/EMQ_PASSWORD in environment"}))
        sys.exit(2)

    options = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0"
    loginresult = c.start(options, log_callback, None)
    if loginresult.ErrorCode != 0:
        print(json.dumps({"error": f"login failed: {getattr(loginresult, 'ErrorMsg', 'unknown')}"}))
        sys.exit(3)

    codes = {
        "IH": "000016.SH",  # 上证50
        "IF": "000300.SH",  # 沪深300
        "IC": "000905.SH",  # 中证500
        "IM": "000852.SH",  # 中证1000
    }

    out = {"start": start_date, "end": end_date, "data": {}}
    try:
        for key, code in codes.items():
            data = c.csd(
                code,
                "CLOSE",
                start_date,
                end_date,
                "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH",
            )
            if getattr(data, "ErrorCode", 0) != 0:
                out["data"][key] = {"error": f"csd error: {getattr(data, 'ErrorCode', 'unknown')}"}
                continue
            series = normalize_csd(data)
            out["data"][key] = series
    finally:
        try:
            c.stop()
        except Exception:
            pass

    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
