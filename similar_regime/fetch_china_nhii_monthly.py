from EmQuantAPI import *
import csv
from pathlib import Path


def log_callback(msg):
    try:
        msg_str = msg.decode("utf-8", errors="ignore").strip() if isinstance(msg, bytes) else str(msg)
        if "heartbeat" not in msg_str.lower():
            print(f"[LOG] {msg_str}")
    except Exception:
        pass
    return 0


def _to_text(value):
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)


def main():
    options = "UserName=bflzg0006,PassWord=tx654954,TestLatency=1,ForceLogin=0"
    login_result = c.start(options, log_callback, None)

    if login_result.ErrorCode != 0:
        print(f"Login failed: {login_result.ErrorMsg}")
        return

    try:
        data = c.csd("NHII.NH", "CLOSE", "2000-01-01", "2026-03-14",
                     "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH")
        if data.ErrorCode != 0:
            print(f"Fetch failed: {data.ErrorMsg}")
            return

        codes = getattr(data, "Codes", []) or []
        dates = getattr(data, "Dates", []) or []
        data_map = getattr(data, "Data", {}) or {}

        rows = []
        for code in codes:
            series = data_map.get(code, []) or []
            # csd Data is a dict of indicator -> list; if it's a list of lists, flatten
            if isinstance(series, list) and len(series) == 1 and isinstance(series[0], (list, tuple)):
                series = series[0]

            row_count = min(len(dates), len(series))
            for i in range(row_count):
                if series[i] is not None:
                    rows.append([_to_text(dates[i]), code, _to_text(series[i])])

        output_path = Path(__file__).parent / "data" / "china_nhii_monthly.csv"
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with output_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["date", "code", "close"])
            writer.writerows(rows)

        print(f"Saved {len(rows)} rows to: {output_path}")
    finally:
        logout_result = c.stop()
        if logout_result.ErrorCode == 0:
            print("Logged out")


if __name__ == "__main__":
    main()
