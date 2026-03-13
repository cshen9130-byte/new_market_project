import pandas as pd
import joblib
from sklearn.mixture import GaussianMixture
from pathlib import Path

DATA_DIR = Path("data")
INPUT_FILE = DATA_DIR / "pca_scores.csv"
OUTPUT_FILE = DATA_DIR / "pca_scores_clustered.csv"
MODEL_DIR = Path("models")
MODEL_GMM = MODEL_DIR / "gmm.joblib"


def main():
    pc_df = pd.read_csv(INPUT_FILE, index_col="date", parse_dates=True)
    features_for_clustering = pc_df[["PC1", "PC2"]]

    gmm = GaussianMixture(n_components=4, random_state=42)
    cluster_labels = gmm.fit_predict(features_for_clustering)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(gmm, MODEL_GMM)
    print(f"GMM 模型已保存至 {MODEL_GMM}")

    pc_df["Cluster"] = cluster_labels
    pc_df.to_csv(OUTPUT_FILE, encoding="utf-8-sig")
    print(f"聚类得分已保存至 {OUTPUT_FILE}")
    print("各簇数量：")
    print(pc_df["Cluster"].value_counts().sort_index())


if __name__ == "__main__":
    main()
