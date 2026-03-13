import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import matplotlib.font_manager as fm
import joblib
from pathlib import Path
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA

# Use a font that supports CJK characters (SimHei ships with Windows)
plt.rcParams["font.family"] = ["SimHei", "Microsoft YaHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False  # prevent minus sign rendering issue

DATA_DIR = Path("data")
INPUT_FILE = DATA_DIR / "log_returns.csv"
OUT_VARIANCE   = DATA_DIR / "pca_explained_variance.csv"
OUT_LOADINGS   = DATA_DIR / "pca_loadings.csv"
OUT_SCORES     = DATA_DIR / "pca_scores.csv"
PLOT_SCREE     = DATA_DIR / "pca_scree.png"
PLOT_BIPLOT    = DATA_DIR / "pca_biplot.png"
MODEL_DIR      = Path("models")
MODEL_SCALER   = MODEL_DIR / "scaler.joblib"
MODEL_PCA      = MODEL_DIR / "pca.joblib"

ASSET_LABELS = {
    "510300.SH_ORIGINALUNIT": "沪深300ETF",
    "510500.SH_ORIGINALUNIT": "中证500ETF",
    "511010.SH_ORIGINALUNIT": "国债ETF",
    "511220.SH_ORIGINALUNIT": "公司债ETF",
    "511880.SH_ORIGINALUNIT": "货币基金ETF",
    "518880.SH_ORIGINALUNIT": "黄金ETF",
    "NHCI.NH_CLOSE":          "南华商品指数",
}


def main():
    # ── 1. Load data ──────────────────────────────────────────────────────────
    df = pd.read_csv(INPUT_FILE, index_col="date", parse_dates=True)
    df.sort_index(inplace=True)
    df.dropna(inplace=True)

    cols = list(df.columns)
    labels = [ASSET_LABELS.get(c, c) for c in cols]

    print(f"已载入 {len(df)} 行 x {len(cols)} 列")

    # ── 2. Standardise ────────────────────────────────────────────────────────
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(df.values)

    # ── 3. Fit PCA (all components) ───────────────────────────────────────────
    n_components = len(cols)
    pca = PCA(n_components=n_components)
    scores = pca.fit_transform(X_scaled)

    pc_names = [f"PC{i+1}" for i in range(n_components)]

    # ── 4. Explained variance table ───────────────────────────────────────────
    ev = pd.DataFrame({
        "PC":                    pc_names,
        "eigenvalue":            pca.explained_variance_,
        "explained_variance_pct": pca.explained_variance_ratio_ * 100,
        "cumulative_pct":         np.cumsum(pca.explained_variance_ratio_) * 100,
    })
    ev.to_csv(OUT_VARIANCE, index=False, encoding="utf-8-sig")
    print("\n── 方差解释 ──")
    print(ev.to_string(index=False))

    # ── 5. Loadings (eigenvectors) ────────────────────────────────────────────
    loadings = pd.DataFrame(
        pca.components_.T,
        index=cols,
        columns=pc_names,
    )
    loadings.index.name = "asset"
    loadings.to_csv(OUT_LOADINGS, encoding="utf-8-sig")
    print("\n── 因子载荷 (PC1–PC3) ──")
    print(loadings.iloc[:, :3].to_string())

    # ── 6. PC scores time series ──────────────────────────────────────────────
    scores_df = pd.DataFrame(scores, index=df.index, columns=pc_names)
    scores_df.index.name = "date"
    scores_df.to_csv(OUT_SCORES, encoding="utf-8-sig")

    # ── 6b. 保存 scaler 和 PCA 模型 ──────────────────────────────────────────
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(scaler, MODEL_SCALER)
    joblib.dump(pca, MODEL_PCA)
    print(f"模型已保存至 {MODEL_DIR}/scaler.joblib 和 pca.joblib")
    fig, ax1 = plt.subplots(figsize=(8, 5))
    ax1.bar(pc_names, ev["explained_variance_pct"], color="steelblue", alpha=0.8, label="各成分 %")
    ax1.set_ylabel("各成分方差解释率 (%)", color="steelblue")
    ax1.tick_params(axis="y", labelcolor="steelblue")
    ax1.set_ylim(0, 100)

    ax2 = ax1.twinx()
    ax2.plot(pc_names, ev["cumulative_pct"], color="tomato", marker="o", linewidth=2, label="累计 %")
    ax2.set_ylabel("累计方差解释率 (%)", color="tomato")
    ax2.tick_params(axis="y", labelcolor="tomato")
    ax2.set_ylim(0, 105)
    ax2.yaxis.set_major_formatter(mticker.FormatStrFormatter("%.0f%%"))

    ax1.set_title("PCA 碎石图 — 日对数收益率")
    ax1.set_xlabel("主成分")
    fig.tight_layout()
    fig.savefig(PLOT_SCREE, dpi=150)
    plt.close(fig)
    print(f"\n碎石图已保存至 {PLOT_SCREE}")

    # ── 8. Biplot (PC1 vs PC2) ────────────────────────────────────────────────
    fig, ax = plt.subplots(figsize=(9, 8))

    # Normalise scores to [-1, 1] range so they sit inside the loading circle
    s1 = scores_df["PC1"].values
    s2 = scores_df["PC2"].values
    score_max = max(np.abs(s1).max(), np.abs(s2).max())
    ax.scatter(s1 / score_max, s2 / score_max,
               alpha=0.12, s=8, color="steelblue", zorder=1)

    # Draw loading arrows scaled to 0.85 so labels have room inside the frame
    arrow_scale = 0.85
    label_scale = 1.0   # label sits right at arrow tip edge (inside ±1 box)
    for col, lab in zip(cols, labels):
        lx = loadings.loc[col, "PC1"]
        ly = loadings.loc[col, "PC2"]
        ax.annotate(
            "", xy=(lx * arrow_scale, ly * arrow_scale), xytext=(0, 0),
            arrowprops=dict(arrowstyle="->", color="tomato", lw=1.8),
            zorder=2,
        )
        # Offset label slightly beyond the arrow tip; keep it inside ±1
        tx = lx * label_scale
        ty = ly * label_scale
        # Determine alignment based on quadrant
        ha = "left" if tx >= 0 else "right"
        va = "bottom" if ty >= 0 else "top"
        ax.text(tx, ty, lab, color="tomato", fontsize=9,
                ha=ha, va=va, zorder=3,
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.6))

    # Fixed axis limits with a small margin so labels are never clipped
    ax.set_xlim(-1.15, 1.15)
    ax.set_ylim(-1.15, 1.15)
    ax.axhline(0, color="grey", linewidth=0.5, linestyle="--")
    ax.axvline(0, color="grey", linewidth=0.5, linestyle="--")

    # Draw the unit circle for reference
    theta = np.linspace(0, 2 * np.pi, 300)
    ax.plot(np.cos(theta), np.sin(theta), color="grey", linewidth=0.6, linestyle=":")

    ax.set_xlabel(f"PC1 ({ev.loc[0,'explained_variance_pct']:.1f}%)")
    ax.set_ylabel(f"PC2 ({ev.loc[1,'explained_variance_pct']:.1f}%)")
    ax.set_title("PCA 双标图 (PC1 vs PC2) — 日对数收益率")
    ax.set_aspect("equal")
    fig.tight_layout()
    fig.savefig(PLOT_BIPLOT, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"双标图已保存至 {PLOT_BIPLOT}")

    print(f"\n输出文件已写入 {DATA_DIR}/：")
    for f in [OUT_VARIANCE, OUT_LOADINGS, OUT_SCORES, PLOT_SCREE, PLOT_BIPLOT]:
        print(f"  {f.name}")


if __name__ == "__main__":
    main()
