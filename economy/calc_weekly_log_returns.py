import pandas as pd
from pathlib import Path

DATA_DIR = Path("data")
INPUT_FILE = DATA_DIR / "log_returns.csv"
OUTPUT_FILE = DATA_DIR / "log_returns_weekly.csv"


def main():
    df = pd.read_csv(INPUT_FILE, index_col="date", parse_dates=True)
    df.sort_index(inplace=True)

    # Log returns are additive: weekly log return = sum of daily log returns in the week
    # Resample to week-ending Friday (W-FRI), summing each week's daily returns
    weekly = df.resample("W-FRI").sum(min_count=1)

    # Drop any weeks that have no data at all (e.g. holiday weeks)
    weekly.dropna(how="all", inplace=True)

    weekly.to_csv(OUTPUT_FILE, encoding="utf-8-sig")
    print(f"已保存 {len(weekly)} 行 x {len(weekly.columns)} 列至 {OUTPUT_FILE}")
    print("\n日期范围：", weekly.index.min().date(), "→", weekly.index.max().date())
    print("\n前3周数据样例：")
    print(weekly.head(3).to_string())


if __name__ == "__main__":
    main()
