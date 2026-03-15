from EmQuantAPI import *
import csv
import os


def log_callback(msg):
    try:
        msg_str = msg.decode("utf-8", errors="ignore").strip() if isinstance(msg, bytes) else str(msg)
        if "heartbeat" not in msg_str.lower():
            print(f"[LOG] {msg_str}")
    except Exception:
        pass
    return 0


def main():
    options = "UserName=bflzg0006,PassWord=tx654954,TestLatency=1,ForceLogin=0"
    login_result = c.start(options, log_callback, None)

    if login_result.ErrorCode != 0:
        print(f"Login failed: {login_result.ErrorMsg}")
        return

    try:
        data = c.csd("SHIBOR3M.IR", "CLOSE", "2000-01-01", "2026-03-15",
                     "period=3,adjustflag=1,curtype=1,order=1,market=CNSESH")

        print("Raw data:", data)

        if getattr(data, "ErrorCode", -1) != 0:
            print(f"Query failed: {data.ErrorMsg}")
            return

        dates = data.Dates
        values_map = data.Data  # typically a dict keyed by field or symbol

        # Flatten to (date, close) pairs
        if isinstance(values_map, dict):
            close_values = next(iter(values_map.values()), [])
        elif isinstance(values_map, list):
            close_values = values_map
        else:
            close_values = []

        # Unwrap one level of nesting if needed: [[v1, v2, ...]] -> [v1, v2, ...]
        if (isinstance(close_values, list) and len(close_values) == 1
                and isinstance(close_values[0], list)):
            close_values = close_values[0]

        if not dates or not close_values or len(dates) != len(close_values):
            print(f"Unexpected structure — dates={len(dates) if dates else 0}, values={len(close_values) if close_values else 0}")
            return

        output_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
        os.makedirs(output_dir, exist_ok=True)
        output_file = os.path.join(output_dir, "shibor_3m_monthly.csv")

        with open(output_file, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["date", "shibor_3m_close"])
            for d, v in zip(dates, close_values):
                writer.writerow([str(d)[:10], v])

        print(f"Saved {len(dates)} rows to: {output_file}")

    finally:
        logout = c.stop()
        if logout.ErrorCode == 0:
            print("Logged out")


if __name__ == "__main__":
    main()
