import json
import os
import sys
from datetime import datetime

try:
    from EmQuantAPI import *  # noqa
except Exception as e:
    print(json.dumps({"error": f"EmQuantAPI import failed: {e}"}))
    sys.exit(1)


def log_callback(msg):
    try:
        if isinstance(msg, bytes):
            msg_str = msg.decode('utf-8', errors='ignore').strip()
        else:
            msg_str = str(msg)
        if 'heartbeat' not in msg_str.lower():
            # optional: print to stderr to avoid polluting stdout JSON
            pass
    except Exception:
        pass
    return 0


def main():
    # Compute last full calendar year
    today = datetime.today()
    last_year = today.year - 1
    start_date = f"{last_year}-01-01"
    end_date = f"{last_year}-12-31"

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

    try:
        # 南华商品指数: NHCI.NH, field CLOSE, daily
        data = c.csd(
            "NHCI.NH",
            "CLOSE",
            start_date,
            end_date,
            "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH",
        )

        if data.ErrorCode != 0:
            print(json.dumps({"error": f"csd error: {data.ErrorCode}"}))
            sys.exit(4)

        # Attempt to normalize EmQuant result into [{date, close}]
        result = []
        dates = getattr(data, "Dates", None) or getattr(data, "dates", None) or getattr(data, "Times", None)
        values = None
        # Data may be nested: data.Data is list of columns aligned to fields
        DD = getattr(data, "Data", None) or getattr(data, "data", None) or getattr(data, "Values", None)
        if DD is not None:
            # EmQuant may return Data as dict keyed by field name (e.g., 'CLOSE')
            if isinstance(DD, dict):
                values = DD.get("CLOSE")
                if values is None and len(DD) > 0:
                    # fallback to first series
                    try:
                        values = next(iter(DD.values()))
                    except Exception:
                        values = None
            elif isinstance(DD, (list, tuple)):
                values = DD[0] if len(DD) > 0 else []
            else:
                values = DD
        # Fallback: try Records
        if (not dates or not values) and hasattr(data, "Records"):
            records = getattr(data, "Records")
            for rec in records:
                # rec may have fields: rec.Date, rec.Close
                d = getattr(rec, "Date", None) or getattr(rec, "date", None)
                v = getattr(rec, "Close", None) or getattr(rec, "close", None)
                if d is not None and v is not None:
                    result.append({"date": str(d), "close": float(v)})
        else:
            # Some EmQuant versions return date strings in data.Dates and a nested list in Data
            if dates and values:
                # Coerce to Python lists for reliable length checks
                try:
                    dates = list(dates)
                except Exception:
                    pass
                try:
                    values = list(values)
                except Exception:
                    pass
                # Flatten values if nested to single series
                try:
                    if isinstance(values, (list, tuple)) and len(values) == 1:
                        # Inner container may be an EmQuant vector; coerce to list
                        inner = values[0]
                        try:
                            values = list(inner)
                        except Exception:
                            values = inner
                    elif isinstance(values, (list, tuple)) and values and isinstance(values[0], (list, tuple)):
                        values = values[0]
                except Exception:
                    pass

                # After flattening, ensure comparable lengths
                try:
                    values_len = len(values)
                except Exception:
                    # Attempt to coerce to list
                    try:
                        values = list(values)
                        values_len = len(values)
                    except Exception:
                        values_len = 0

                if len(dates) == values_len:
                    for d, v in zip(dates, values):
                        # Ensure date string format
                        ds = d if isinstance(d, str) else getattr(d, "strftime", lambda *_: str(d))("%Y-%m-%d")
                        # Normalize 'YYYY/M/D' to 'YYYY-MM-DD'
                        try:
                            if isinstance(ds, str) and "/" in ds:
                                ds_dt = datetime.strptime(ds, "%Y/%m/%d")
                                ds = ds_dt.strftime("%Y-%m-%d")
                        except Exception:
                            pass
                        try:
                            fv = float(v)
                        except Exception:
                            fv = None
                        if fv is not None:
                            result.append({"date": ds, "close": fv})

        # Attach meta for debugging if empty
        meta = None
        if not result:
            # Collect simple metadata to help debugging
            try:
                sample_date_type = None
                sample_value_type = None
                sample_value0_len = None
                try:
                    sample_date_type = str(type((getattr(data, "Dates", None) or getattr(data, "Times", None))[0]))
                except Exception:
                    pass
                try:
                    sample_values = getattr(data, "Data", None)
                    sample_value_type = str(type(sample_values))
                    if sample_values is not None:
                        # try inner
                        inner0 = None
                        try:
                            inner0 = sample_values[0]
                        except Exception:
                            inner0 = None
                        if inner0 is not None:
                            try:
                                sample_value0_len = len(inner0)
                            except Exception:
                                sample_value0_len = None
                except Exception:
                    pass
                meta = {
                    "has_Dates": hasattr(data, "Dates"),
                    "has_Times": hasattr(data, "Times"),
                    "has_Data": hasattr(data, "Data"),
                    "len_Dates": len(getattr(data, "Dates", []) or []),
                    "len_Data": len(getattr(data, "Data", []) or []),
                    "fields": getattr(data, "Fields", None),
                    "date0_type": sample_date_type,
                    "values_type": sample_value_type,
                    "inner0_len": sample_value0_len,
                }
            except Exception:
                meta = None

        print(json.dumps({"code": "NHCI.NH", "start": start_date, "end": end_date, "data": result, "meta": meta}, ensure_ascii=False))
    finally:
        try:
            logout = c.stop()
        except Exception:
            pass


if __name__ == "__main__":
    main()
