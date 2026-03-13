import pandas as pd
import numpy as np
from pathlib import Path

DATA_DIR = Path("data")
INPUT_FILE = DATA_DIR / "combined_etf_data.csv"
OUTPUT_FILE = DATA_DIR / "log_returns.csv"


def main():
    df = pd.read_csv(INPUT_FILE, index_col="date", parse_dates=True)
    df.sort_index(inplace=True)

    # Compute log returns: ln(P_t / P_{t-1})
    log_returns = np.log(df / df.shift(1))

    # Drop the first row (all NaN after differencing), then trim to the date
    # all columns have data simultaneously
    log_returns.dropna(how="all", inplace=True)
    first_full_date = log_returns.dropna(how="any").index.min()
    log_returns = log_returns.loc[first_full_date:]
    print(f"已截断至所有列均有数据的最早日期：{first_full_date.date()}")

    log_returns.to_csv(OUTPUT_FILE, encoding="utf-8-sig")
    print(f"已保存 {len(log_returns)} 行 x {len(log_returns.columns)} 列至 {OUTPUT_FILE}")
    print("\n列名：", list(log_returns.columns))
    print("\n日期范围：", log_returns.index.min().date(), "→", log_returns.index.max().date())
    print("\n前3行数据样例：")
    print(log_returns.dropna(how="all").head(3).to_string())


if __name__ == "__main__":
    main()
