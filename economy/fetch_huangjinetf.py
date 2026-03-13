from EmQuantAPI import *
import csv
from datetime import datetime
from pathlib import Path


def format_date(value):
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    return str(value)


def extract_series(csd_result):
    dates = list(getattr(csd_result, "Dates", []) or [])
    raw_data = getattr(csd_result, "Data", None)

    values = []
    if isinstance(raw_data, list):
        if len(raw_data) == 1 and isinstance(raw_data[0], (list, tuple)):
            values = list(raw_data[0])
        else:
            values = list(raw_data)
    elif isinstance(raw_data, dict):
        first_value = next(iter(raw_data.values()), [])
        if isinstance(first_value, (list, tuple)):
            if len(first_value) == 1 and isinstance(first_value[0], (list, tuple)):
                values = list(first_value[0])
            else:
                values = list(first_value)
        else:
            values = [first_value]

    if len(dates) != len(values):
        raise ValueError(
            f"意外的数据格式：{len(dates)} 个日期 vs {len(values)} 个数值"
        )

    return dates, values


def main():
    options = "UserName=bflzg0006,PassWord=tx654954,TestLatency=1,ForceLogin=0"
    login_result = c.start(options)
    if login_result.ErrorCode != 0:
        raise RuntimeError(f"登录失败：{login_result.ErrorMsg}")

    try:
        data = c.csd(
            "518880.SH",
            "ORIGINALUNIT",
            "2000-01-01",
            "2026-03-13",
            "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH",
        )

        if data.ErrorCode != 0:
            raise RuntimeError(f"数据获取失败：{data.ErrorMsg}")

        dates, values = extract_series(data)

        output_dir = Path("data")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_file = output_dir / "huangjinetf_originalunit_2000_2026.csv"

        with output_file.open("w", newline="", encoding="utf-8-sig") as f:
            writer = csv.writer(f)
            writer.writerow(["date", "ticker", "field", "value"])
            for dt, val in zip(dates, values):
                writer.writerow([format_date(dt), "518880.SH", "ORIGINALUNIT", val])

        print(f"已保存 {len(values)} 行至 {output_file}")
    finally:
        c.stop()


if __name__ == "__main__":
    main()