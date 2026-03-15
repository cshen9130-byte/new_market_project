"""
货币+信用 四象限周期模型 — 可视化
依赖：matplotlib（已安装）
"""

import os
import pandas as pd
import numpy as np
import matplotlib
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.colors import ListedColormap
from matplotlib.lines import Line2D

matplotlib.rcParams["font.family"] = ["Microsoft YaHei", "SimHei", "sans-serif"]
matplotlib.rcParams["axes.unicode_minus"] = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
OUT_DIR  = os.path.join(BASE_DIR, "data")

# ── 读取已计算好的结果 ────────────────────────────────────────────────────────
df = pd.read_csv(os.path.join(DATA_DIR, "money_credit_cycle.csv"), index_col=0, parse_dates=True)

QUADRANT_COLORS = {
    "衰退/防御": "#4C72B0",   # 蓝
    "复苏/进攻": "#55A868",   # 绿
    "过热/商品": "#DD8452",   # 橙
    "滞胀/现金": "#C44E52",   # 红
    "中性":      "#8C8C8C",   # 灰
}

# ── 图1：SHIBOR & 社融时序 + 背景色（象限着色）───────────────────────────────
fig1, (ax1, ax2) = plt.subplots(2, 1, figsize=(16, 8), sharex=True)
fig1.suptitle("货币+信用 周期模型 — 历史走势", fontsize=14, fontweight="bold")

def shade_background(ax, series, color_map):
    """按象限给每个月填充背景色（透明色带）。"""
    prev_q, prev_date = None, None
    for date, q in series.items():
        if prev_q is None:
            prev_q, prev_date = q, date
            continue
        if q != prev_q or date == series.index[-1]:
            col = color_map.get(prev_q, "#cccccc")
            ax.axvspan(prev_date, date, color=col, alpha=0.15, linewidth=0)
            prev_q, prev_date = q, date

df_valid = df.dropna(subset=["quadrant"])
shade_background(ax1, df_valid["quadrant"], QUADRANT_COLORS)
shade_background(ax2, df_valid["quadrant"], QUADRANT_COLORS)

# 上图：SHIBOR 3M
ax1.plot(df.index, df["shibor"], color="#1f77b4", lw=1.2, label="SHIBOR 3M（月末）")
ax1.plot(df.index, df["shibor_ma"], color="#1f77b4", lw=2.0, ls="--", label="3月均值")
ax1.set_ylabel("SHIBOR 3M (%)", fontsize=10)
ax1.legend(loc="upper right", fontsize=9)
ax1.grid(axis="y", ls=":", alpha=0.5)

# 下图：社融同比
ax2.plot(df.index, df["social"], color="#d62728", lw=1.2, label="社融存量同比（月末）")
ax2.plot(df.index, df["social_ma"], color="#d62728", lw=2.0, ls="--", label="3月均值")
ax2.set_ylabel("社融存量同比 (%)", fontsize=10)
ax2.set_xlabel("日期", fontsize=10)
ax2.legend(loc="upper right", fontsize=9)
ax2.grid(axis="y", ls=":", alpha=0.5)

# 图例（象限颜色）
patches = [mpatches.Patch(color=c, alpha=0.4, label=q)
           for q, c in QUADRANT_COLORS.items()]
fig1.legend(handles=patches, loc="lower center", ncol=5, fontsize=9,
            bbox_to_anchor=(0.5, -0.02), frameon=True)
fig1.tight_layout(rect=[0, 0.03, 1, 1])
path1 = os.path.join(OUT_DIR, "chart1_timeseries.png")
fig1.savefig(path1, dpi=150, bbox_inches="tight")
print(f"保存：{path1}")

# ── 图2：象限分布饼图 & 条形图 ────────────────────────────────────────────────
fig2, (ax3, ax4) = plt.subplots(1, 2, figsize=(13, 5))
fig2.suptitle("象限历史分布统计", fontsize=14, fontweight="bold")

counts = df_valid["quadrant"].value_counts()
order  = ["衰退/防御", "复苏/进攻", "过热/商品", "滞胀/现金", "中性"]
counts = counts.reindex(order).dropna()
colors = [QUADRANT_COLORS[q] for q in counts.index]

# 饼图
wedges, texts, autotexts = ax3.pie(
    counts, labels=counts.index, colors=colors,
    autopct="%1.1f%%", startangle=90,
    wedgeprops=dict(edgecolor="white", linewidth=1.5)
)
for t in autotexts:
    t.set_fontsize(9)
ax3.set_title("各象限占比", fontsize=11)

# 条形图（月数 & 斜率分布）
bars = ax4.barh(counts.index, counts.values, color=colors, edgecolor="white", height=0.6)
ax4.set_xlabel("月份数", fontsize=10)
ax4.set_title("各象限月份数", fontsize=11)
for bar, val in zip(bars, counts.values):
    ax4.text(bar.get_width() + 0.5, bar.get_y() + bar.get_height() / 2,
             str(val), va="center", fontsize=9)
ax4.set_xlim(0, counts.max() * 1.15)
ax4.invert_yaxis()
ax4.grid(axis="x", ls=":", alpha=0.5)

fig2.tight_layout()
path2 = os.path.join(OUT_DIR, "chart2_distribution.png")
fig2.savefig(path2, dpi=150, bbox_inches="tight")
print(f"保存：{path2}")

# ── 图3：散点图 — SHIBOR MA vs 社融MA，颜色=象限 ────────────────────────────
fig3, ax5 = plt.subplots(figsize=(9, 7))
ax5.set_title("货币-信用状态空间散点图\n（X=社融同比MA，Y=SHIBOR MA，颜色=象限）",
              fontsize=12, fontweight="bold")

df_plot = df.dropna(subset=["shibor_ma", "social_ma", "quadrant"])
for q, grp in df_plot.groupby("quadrant"):
    ax5.scatter(grp["social_ma"], grp["shibor_ma"],
                c=QUADRANT_COLORS[q], label=q, s=28, alpha=0.7, edgecolors="none")

# 最新点（加大、描边）
latest = df_plot.iloc[-1]
ax5.scatter(latest["social_ma"], latest["shibor_ma"],
            c=QUADRANT_COLORS[latest["quadrant"]], s=180,
            edgecolors="black", linewidths=1.5, zorder=10)
ax5.annotate(f"最新\n{df_plot.index[-1].strftime('%Y-%m')}",
             xy=(latest["social_ma"], latest["shibor_ma"]),
             xytext=(8, 8), textcoords="offset points",
             fontsize=9, fontweight="bold",
             arrowprops=dict(arrowstyle="->", color="black", lw=1))

ax5.set_xlabel("社融存量同比 3月均值 (%)", fontsize=10)
ax5.set_ylabel("SHIBOR 3M 3月均值 (%)", fontsize=10)
ax5.legend(title="象限", fontsize=9, title_fontsize=9)
ax5.grid(ls=":", alpha=0.4)
fig3.tight_layout()
path3 = os.path.join(OUT_DIR, "chart3_state_space.png")
fig3.savefig(path3, dpi=150, bbox_inches="tight")
print(f"保存：{path3}")

# ── 图4：最近 36 个月象限状态热力图 ─────────────────────────────────────────
fig4, ax6 = plt.subplots(figsize=(16, 2.8))
ax6.set_title("最近 36 个月象限状态（色块时间轴）", fontsize=12, fontweight="bold")

df36 = df_valid.tail(36)
quad_idx = {q: i for i, q in enumerate(order)}
colors36  = [QUADRANT_COLORS[q] for q in df36["quadrant"]]

for i, (date, row) in enumerate(df36.iterrows()):
    q   = row["quadrant"]
    col = QUADRANT_COLORS[q]
    rect = mpatches.FancyBboxPatch(
        (i, 0), 0.92, 0.85,
        boxstyle="round,pad=0.04",
        facecolor=col, edgecolor="white", linewidth=1.2
    )
    ax6.add_patch(rect)
    ax6.text(i + 0.46, 0.42, q, ha="center", va="center",
             fontsize=6.5, color="white", fontweight="bold")

# x 轴刻度：每 6 个月标一次
tick_pos   = list(range(0, len(df36), 6))
tick_labels = [df36.index[i].strftime("%Y-%m") for i in tick_pos]
ax6.set_xticks([p + 0.46 for p in tick_pos])
ax6.set_xticklabels(tick_labels, fontsize=8)
ax6.set_xlim(-0.1, len(df36))
ax6.set_ylim(-0.1, 1.1)
ax6.axis("off")
ax6.xaxis.set_visible(True)
ax6.set_frame_on(False)

# 在最后一格加"▶ 当前"标注
ax6.text(len(df36) - 0.5, 1.0, "▶ 当前",
         ha="center", fontsize=8, color="black", fontweight="bold")

fig4.tight_layout()
path4 = os.path.join(OUT_DIR, "chart4_recent_timeline.png")
fig4.savefig(path4, dpi=150, bbox_inches="tight")
print(f"保存：{path4}")

plt.show()
print("\n全部图表已生成完毕。")
