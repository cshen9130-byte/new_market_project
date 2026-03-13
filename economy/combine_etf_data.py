import pandas as pd
from pathlib import Path

DATA_DIR = Path("data")
OUTPUT_FILE = DATA_DIR / "combined_etf_data.csv"


def load_csv(filepath: Path) -> pd.DataFrame:
    df = pd.read_csv(filepath, parse_dates=["date"])
    # Build a single column name from ticker + field
    df["column"] = df["ticker"] + "_" + df["field"]
    return df[["date", "column", "value"]]


def main():
    csv_files = [
        f for f in DATA_DIR.glob("*.csv") if f.name != OUTPUT_FILE.name
    ]
    if not csv_files:
        raise FileNotFoundError(f"{DATA_DIR} 中未找到 CSV 文件")

    print(f"共找到 {len(csv_files)} 个文件：")
    for f in sorted(csv_files):
        print(f"  {f.name}")

    # Load and concatenate all files in long format
    frames = [load_csv(f) for f in csv_files]
    long_df = pd.concat(frames, ignore_index=True)

    # Drop rows where value is missing (pre-listing rows per ticker)
    long_df = long_df.dropna(subset=["value"])

    # Pivot to wide format: rows = date, columns = ticker_field
    wide_df = long_df.pivot_table(
        index="date", columns="column", values="value", aggfunc="first"
    )
    wide_df.sort_index(inplace=True)
    wide_df.columns.name = None  # remove column axis name

    # Drop rows where every column is NaN (dates before any ticker had data)
    wide_df.dropna(how="all", inplace=True)

    # Forward-fill any remaining gaps within each ticker's active period
    wide_df.ffill(inplace=True)

    wide_df.to_csv(OUTPUT_FILE, encoding="utf-8-sig")
    print(f"\n已保存 {len(wide_df)} 行 x {len(wide_df.columns)} 列至 {OUTPUT_FILE}")
    print("\n列名：", list(wide_df.columns))
    print("\n日期范围：", wide_df.index.min().date(), "→", wide_df.index.max().date())
    print("\n各列首个有效日期：")
    for col in wide_df.columns:
        first = wide_df[col].first_valid_index()
        print(f"  {col}: {first.date() if first is not None else '无数据'}")


if __name__ == "__main__":
    main()
