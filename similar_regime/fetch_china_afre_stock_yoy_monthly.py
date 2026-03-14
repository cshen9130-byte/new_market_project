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


def _extract_rows(edb_result):
    codes = getattr(edb_result, "Codes", []) or []
    dates = getattr(edb_result, "Dates", []) or []
    data_map = getattr(edb_result, "Data", {}) or {}

    rows = []
    for code in codes:
        series = data_map.get(code, []) or []
        if len(series) == 1 and isinstance(series[0], (list, tuple)):
            series = series[0]

        row_count = min(len(dates), len(series))
        for i in range(row_count):
            rows.append([
                _to_text(dates[i]),
                code,
                _to_text(series[i]),
            ])
    return rows


def main():
    options = "UserName=bflzg0006,PassWord=tx654954,TestLatency=1,ForceLogin=0"
    login_result = c.start(options, log_callback, None)

    if login_result.ErrorCode != 0:
        print(f"Login failed: {login_result.ErrorMsg}")
        return

    try:
        data = c.edb("EMM00191807", "IsLatest=0,StartDate=2000-01-01,EndDate=2026-03-14")
        if data.ErrorCode != 0:
            print(f"Fetch failed: {data.ErrorMsg}")
            return

        rows = _extract_rows(data)
        output_path = Path(__file__).parent / "data" / "china_afre_stock_yoy_monthly.csv"
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with output_path.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["date", "code", "value"])
            writer.writerows(rows)

        print(f"Saved {len(rows)} rows to: {output_path}")
    finally:
        logout_result = c.stop()
        if logout_result.ErrorCode == 0:
            print("Logged out")


if __name__ == "__main__":
    main()
