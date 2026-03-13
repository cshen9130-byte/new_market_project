import pandas as pd
import matplotlib.pyplot as plt
from pathlib import Path


DATA_DIR = Path("data")
SCORES_FILE = DATA_DIR / "pca_scores_clustered.csv"
CURRENT_FILE = DATA_DIR / "current_market_cluster.csv"
OUTPUT_FILE = DATA_DIR / "current_market_prediction.png"


def main():
    scores_df = pd.read_csv(SCORES_FILE, parse_dates=["date"])
    current_df = pd.read_csv(CURRENT_FILE, parse_dates=["date"])

    latest = current_df.iloc[0]
    latest_date = latest["date"]
    latest_cluster = int(latest["cluster"])

    plt.rcParams["font.family"] = ["SimHei", "Microsoft YaHei", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False

    fig, ax = plt.subplots(figsize=(10, 8))

    cluster_colors = {
        0: "#1f77b4",
        1: "#ff7f0e",
        2: "#2ca02c",
        3: "#d62728",
    }

    for cluster_id, cluster_frame in scores_df.groupby("Cluster"):
        ax.scatter(
            cluster_frame["PC1"],
            cluster_frame["PC2"],
            s=18,
            alpha=0.35,
            color=cluster_colors.get(int(cluster_id), "#7f7f7f"),
            label=f"簇 {int(cluster_id)}",
        )

    ax.scatter(
        latest["PC1_today"],
        latest["PC2_today"],
        s=220,
        marker="*",
        color="black",
        edgecolor="white",
        linewidth=1.2,
        label="最新交易日",
        zorder=5,
    )

    ax.annotate(
        f"最新日期: {pd.to_datetime(latest_date).date()}\n所属簇: {latest_cluster}",
        xy=(latest["PC1_today"], latest["PC2_today"]),
        xytext=(12, 12),
        textcoords="offset points",
        fontsize=10,
        bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="#333333", alpha=0.9),
    )

    ax.axhline(0, color="#666666", linewidth=0.8, linestyle="--")
    ax.axvline(0, color="#666666", linewidth=0.8, linestyle="--")

    x_min, x_max = scores_df["PC1"].min(), scores_df["PC1"].max()
    y_min, y_max = scores_df["PC2"].min(), scores_df["PC2"].max()
    x_pad = (x_max - x_min) * 0.08
    y_pad = (y_max - y_min) * 0.08
    ax.set_xlim(x_min - x_pad, x_max + x_pad)
    ax.set_ylim(y_min - y_pad, y_max + y_pad)

    ax.set_xlabel("PC1: 经济增长因子", fontsize=12)
    ax.set_ylabel("PC2: 避险情绪 / 利率预期因子", fontsize=12)
    ax.set_title("PCA 空间中的最新市场状态预测", fontsize=14)

    ax.text(0.98, 0.03, "PC1 > 0: 增长偏强\nPC2 > 0: 避险情绪/利率预期上行",
            transform=ax.transAxes, ha="right", va="bottom", fontsize=10,
            bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="none", alpha=0.7))

    ax.legend(frameon=True)
    fig.tight_layout()
    fig.savefig(OUTPUT_FILE, dpi=160, bbox_inches="tight")
    plt.close(fig)

    print(f"Saved latest-day prediction chart to {OUTPUT_FILE}")
    print(f"Latest date: {pd.to_datetime(latest_date).date()}")
    print(f"Latest coordinates: PC1={latest['PC1_today']:.6f}, PC2={latest['PC2_today']:.6f}")
    print(f"Latest cluster: {latest_cluster}")


if __name__ == "__main__":
    main()