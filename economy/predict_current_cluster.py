import pandas as pd
import joblib
from pathlib import Path

DATA_DIR = Path("data")
INPUT_FILE = DATA_DIR / "log_returns.csv"
OUTPUT_FILE = DATA_DIR / "current_market_cluster.csv"
MODEL_DIR = Path("models")


def main():
    scaler = joblib.load(MODEL_DIR / "scaler.joblib")
    pca    = joblib.load(MODEL_DIR / "pca.joblib")
    gmm    = joblib.load(MODEL_DIR / "gmm.joblib")
    print("模型已加载 (scaler / pca / gmm)")

    df = pd.read_csv(INPUT_FILE, index_col="date", parse_dates=True)
    df.sort_index(inplace=True)
    df.dropna(inplace=True)

    latest_date = df.index.max()
    new_data = df.loc[[latest_date]]

    new_data_scaled = scaler.transform(new_data.values)
    new_pc = pca.transform(new_data_scaled)
    new_pc_features = pd.DataFrame(new_pc[:, :2], columns=["PC1", "PC2"])
    current_cluster = gmm.predict(new_pc_features)

    result = pd.DataFrame(
        {
            "date": [latest_date],
            "PC1_today": [new_pc[0, 0]],
            "PC2_today": [new_pc[0, 1]],
            "cluster": [int(current_cluster[0])],
        }
    )
    result.to_csv(OUTPUT_FILE, index=False, encoding="utf-8-sig")

    print(f"最新市场日期：{latest_date.date()}")
    print(f"当日 PC1：{new_pc[0, 0]:.6f}")
    print(f"当日 PC2：{new_pc[0, 1]:.6f}")
    print(f"当前市场属于第 {current_cluster[0]} 簇")
    print(f"结果已保存至 {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
