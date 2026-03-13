import pandas as pd
import matplotlib.pyplot as plt
from pathlib import Path

DATA_DIR = Path("data")
INPUT_FILE = DATA_DIR / "pca_scores_clustered.csv"
OUTPUT_DIR = DATA_DIR / "last_week_prediction_charts"

CLUSTER_COLORS = {
    0: "#1f77b4",
    1: "#ff7f0e",
    2: "#2ca02c",
    3: "#d62728",
}


def get_last_week_dates(scores_df: pd.DataFrame) -> pd.DataFrame:
    latest_date = scores_df["date"].max()
    latest_period = latest_date.to_period("W-FRI")
    week_df = scores_df[scores_df["date"].dt.to_period("W-FRI") == latest_period].copy()
    return week_df.sort_values("date")


def plot_day(scores_df: pd.DataFrame, row: pd.Series, output_file: Path) -> None:
    fig, ax = plt.subplots(figsize=(10, 8))

    for cluster_id, cluster_frame in scores_df.groupby("Cluster"):
        ax.scatter(
            cluster_frame["PC1"],
            cluster_frame["PC2"],
            s=18,
            alpha=0.35,
            color=CLUSTER_COLORS.get(int(cluster_id), "#7f7f7f"),
            label=f"簇 {int(cluster_id)}",
        )

    ax.scatter(
        row["PC1"],
        row["PC2"],
        s=240,
        marker="*",
        color="black",
        edgecolor="white",
        linewidth=1.2,
        label="当日",
        zorder=5,
    )

    ax.annotate(
        f"日期: {row['date'].date()}\n所属簇: {int(row['Cluster'])}",
        xy=(row["PC1"], row["PC2"]),
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
    ax.set_title(f"{row['date'].date()} 市场状态预测", fontsize=14)

    ax.text(
        0.98,
        0.03,
        "PC1 > 0: 增长偏强\nPC2 > 0: 避险情绪/利率预期上行",
        transform=ax.transAxes,
        ha="right",
        va="bottom",
        fontsize=10,
        bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="none", alpha=0.7),
    )

    ax.legend(frameon=True)
    fig.tight_layout()
    fig.savefig(output_file, dpi=160, bbox_inches="tight")
    plt.close(fig)


def main():
    plt.rcParams["font.family"] = ["SimHei", "Microsoft YaHei", "DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False

    scores_df = pd.read_csv(INPUT_FILE, parse_dates=["date"])
    scores_df.sort_values("date", inplace=True)

    week_df = get_last_week_dates(scores_df)
    if week_df.empty:
        raise ValueError("上周无数据")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"生成 {len(week_df)} 张图表，截止日期: {week_df['date'].max().date()}")
    for _, row in week_df.iterrows():
        output_file = OUTPUT_DIR / f"market_prediction_{row['date'].strftime('%Y-%m-%d')}.png"
        plot_day(scores_df, row, output_file)
        print(f"  已保存 {output_file.name}")


if __name__ == "__main__":
    main()
