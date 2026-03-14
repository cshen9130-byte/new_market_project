"""
plot_regime_results.py
Visualise the output from regime_identification.py.

Charts produced (saved to data/):
  1. regime_chart_similarity.png
       Panel A – Top-20 most similar months (horizontal bar, distance)
       Panel B – Current macro fingerprint (z-score bar chart)
  2. regime_chart_heatmap.png
       Z-score heatmap: current month + top-20 historical months × 7 variables
  3. regime_chart_timeline.png
       Timeline scatter showing when similar periods cluster historically
"""

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
matplotlib.rcParams['font.family'] = ['Microsoft YaHei', 'SimHei', 'DejaVu Sans']
matplotlib.rcParams['axes.unicode_minus'] = False
import matplotlib.patches as mpatches
import matplotlib.gridspec as gridspec
from pathlib import Path

# ── paths ──────────────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).parent / "data"
top20    = pd.read_csv(DATA_DIR / "regime_top20_similar.csv")
dist_all = pd.read_csv(DATA_DIR / "regime_distances.csv")

current_date_label = "2026-02"
current_zscores = {
    'pmi_chg':    -0.5136,
    'yield_chg':  +0.6439,
    'spread_chg': +0.7575,
    'nhii_yoy':   -0.7668,
    'afre':       -1.5776,
    'm1':         -0.1457,
    'cpi':        -0.1024,
}

z_cols   = ['pmi_chg_z', 'yield_chg_z', 'spread_chg_z',
            'nhii_yoy_z', 'afre_z', 'm1_z', 'cpi_z']
var_labels = ['PMI变化', '10Y收益率变化', '期限利差变化',
              '南华工业品同比', '社融存量同比', 'M1同比', 'CPI同比']

# palette — decade colour coding
DECADE_COLORS = {
    '2006': '#4e79a7', '2007': '#4e79a7', '2008': '#4e79a7', '2009': '#4e79a7',
    '2010': '#f28e2b', '2011': '#f28e2b', '2012': '#f28e2b', '2013': '#f28e2b',
    '2014': '#f28e2b', '2015': '#f28e2b', '2016': '#f28e2b', '2017': '#f28e2b',
    '2018': '#e15759', '2019': '#e15759',
    '2020': '#76b7b2', '2021': '#76b7b2', '2022': '#76b7b2', '2023': '#76b7b2',
    '2024': '#59a14f', '2025': '#59a14f',
}
DEFAULT_COLOR = '#bab0ac'

def decade_color(date_str):
    year = str(date_str)[:4]
    return DECADE_COLORS.get(year, DEFAULT_COLOR)


# ══════════════════════════════════════════════════════════════════════════════
# Chart 1 — Similarity ranking  +  Current macro fingerprint
# ══════════════════════════════════════════════════════════════════════════════
fig, axes = plt.subplots(1, 2, figsize=(16, 8),
                          gridspec_kw={'width_ratios': [1.6, 1]})
fig.patch.set_facecolor('#f7f7f7')

# ── Panel A: horizontal bar chart (top-20, ascending distance left→right) ──
ax = axes[0]
ax.set_facecolor('#f7f7f7')

dates     = top20['date'].tolist()
distances = top20['distance'].tolist()
colors    = [decade_color(d) for d in dates]
y_pos     = np.arange(len(dates))

bars = ax.barh(y_pos, distances, color=colors, edgecolor='white', linewidth=0.6)
ax.set_yticks(y_pos)
ax.set_yticklabels(dates, fontsize=9)
ax.invert_yaxis()           # closest at top
ax.set_xlabel('欧氏距离（Z分数空间）', fontsize=10)
ax.set_title(f'与{current_date_label}最相似的历史前20个月份',
             fontsize=12, fontweight='bold', pad=10)
ax.axvline(x=distances[0], color='#999999', linestyle='--', linewidth=0.8, alpha=0.6)

# add distance label
for bar, d in zip(bars, distances):
    ax.text(d + 0.01, bar.get_y() + bar.get_height() / 2,
            f'{d:.3f}', va='center', ha='left', fontsize=8, color='#555555')

# legend for decade colours
legend_entries = [
    mpatches.Patch(color='#4e79a7', label='2006–2009'),
    mpatches.Patch(color='#f28e2b', label='2010–2019'),
    mpatches.Patch(color='#e15759', label='2018–2019（贸易战）'),
    mpatches.Patch(color='#76b7b2', label='2020–2023'),
    mpatches.Patch(color='#59a14f', label='2024–2025'),
]
ax.legend(handles=legend_entries, fontsize=7.5, loc='lower right',
          framealpha=0.85, edgecolor='#cccccc')

ax.spines[['top', 'right']].set_visible(False)
ax.set_xlim(0, max(distances) * 1.15)

# ── Panel B: current macro fingerprint (z-score bar chart) ──
ax2 = axes[1]
ax2.set_facecolor('#f7f7f7')

vars_     = list(current_zscores.keys())
z_values  = list(current_zscores.values())
bar_colors = ['#e15759' if z < 0 else '#4e79a7' for z in z_values]

ax2.barh(var_labels, z_values, color=bar_colors, edgecolor='white', linewidth=0.6)
ax2.axvline(x=0, color='#333333', linewidth=1.0)
ax2.axvline(x=1,  color='#aaaaaa', linestyle='--', linewidth=0.7)
ax2.axvline(x=-1, color='#aaaaaa', linestyle='--', linewidth=0.7)
ax2.axvline(x=2,  color='#cccccc', linestyle=':', linewidth=0.7)
ax2.axvline(x=-2, color='#cccccc', linestyle=':', linewidth=0.7)
ax2.set_xlim(-3.2, 3.2)
ax2.set_xlabel('Z分数（滚动120个月窗口）', fontsize=10)
ax2.set_title(f'当前宏观特征\n（{current_date_label}）',
              fontsize=12, fontweight='bold', pad=10)

for i, (v, label) in enumerate(zip(z_values, var_labels)):
    ax2.text(v + (0.08 if v >= 0 else -0.08),
             i, f'{v:+.2f}',
             va='center', ha='left' if v >= 0 else 'right',
             fontsize=9, color='#333333', fontweight='bold')

ax2.spines[['top', 'right']].set_visible(False)

fig.suptitle('中国宏观经济周期识别 — 2026年3月',
             fontsize=14, fontweight='bold', y=1.01)
plt.tight_layout(pad=2.0)
out1 = DATA_DIR / 'regime_chart_similarity.png'
fig.savefig(out1, dpi=150, bbox_inches='tight', facecolor=fig.get_facecolor())
plt.close(fig)
print(f"Saved: {out1}")


# ══════════════════════════════════════════════════════════════════════════════
# Chart 2 — Z-score heatmap  (current + top-20)
# ══════════════════════════════════════════════════════════════════════════════
# Build matrix: first row = current month, then top-20
current_row = pd.DataFrame(
    [[current_date_label] + list(current_zscores.values())],
    columns=['date'] + z_cols
)
# top20 has z-score columns already
heat_df = pd.concat([current_row, top20[['date'] + z_cols]], ignore_index=True)
heat_matrix = heat_df[z_cols].values.astype(float)

fig2, ax = plt.subplots(figsize=(12, 9))
fig2.patch.set_facecolor('#f7f7f7')
ax.set_facecolor('#f7f7f7')

# diverging colour map clipped to [-3, 3]
import matplotlib.colors as mcolors
cmap = plt.cm.RdYlBu  # blue=positive, red=negative
norm = mcolors.TwoSlopeNorm(vmin=-3, vcenter=0, vmax=3)

im = ax.imshow(heat_matrix, cmap=cmap, norm=norm, aspect='auto')

# axis labels
ax.set_xticks(np.arange(len(var_labels)))
ax.set_xticklabels(var_labels, fontsize=10)
row_labels = heat_df['date'].tolist()
ax.set_yticks(np.arange(len(row_labels)))
ax.set_yticklabels(row_labels, fontsize=9)

# draw a separator line after current month row
ax.axhline(y=0.5, color='black', linewidth=2)

# annotate cells
for i in range(heat_matrix.shape[0]):
    for j in range(heat_matrix.shape[1]):
        val = heat_matrix[i, j]
        text_color = 'white' if abs(val) > 1.8 else '#333333'
        ax.text(j, i, f'{val:.2f}', ha='center', va='center',
                fontsize=8, color=text_color, fontweight='bold')

# colour-bar
cbar = fig2.colorbar(im, ax=ax, fraction=0.03, pad=0.02)
cbar.set_label('Z分数', fontsize=10)
cbar.set_ticks([-3, -2, -1, 0, 1, 2, 3])

# highlight current row label
ax.get_yticklabels()[0].set_fontweight('bold')
ax.get_yticklabels()[0].set_color('#e15759')
ax.set_title(f'Z分数热力图：当前月份与前20个相似历史时期对比\n'
             f'（红色=低于均值，蓝色=高于均值）',
             fontsize=12, fontweight='bold', pad=12)

plt.tight_layout()
out2 = DATA_DIR / 'regime_chart_heatmap.png'
fig2.savefig(out2, dpi=150, bbox_inches='tight', facecolor=fig2.get_facecolor())
plt.close(fig2)
print(f"Saved: {out2}")


# ══════════════════════════════════════════════════════════════════════════════
# Chart 3 — Historical timeline: where do similar periods cluster?
# ══════════════════════════════════════════════════════════════════════════════
dist_all['date'] = pd.to_datetime(dist_all['date'])
dist_all = dist_all.sort_values('date').reset_index(drop=True)

top20_dates_set = set(pd.to_datetime(top20['date']).dt.to_period('M').astype(str))
dist_all['in_top20'] = dist_all['date'].dt.to_period('M').astype(str).isin(top20_dates_set)

fig3, ax = plt.subplots(figsize=(16, 5))
fig3.patch.set_facecolor('#f7f7f7')
ax.set_facecolor('#f8f8f8')

# all months as scatter — colour by distance
non_top = dist_all[~dist_all['in_top20']]
ax.scatter(non_top['date'], non_top['distance'],
           c=non_top['distance'], cmap='YlOrRd_r',
           s=15, alpha=0.55, linewidths=0, vmin=0, vmax=5,
           label='所有历史月份')

# top-20 highlighted
top_rows = dist_all[dist_all['in_top20']]
sc = ax.scatter(top_rows['date'], top_rows['distance'],
                c='#e15759', s=90, zorder=5,
                edgecolors='#333333', linewidths=0.7,
                label='前20个最相似月份')

# label each top-20 point
for _, row in top_rows.iterrows():
    label = row['date'].strftime('%Y-%m')
    ax.annotate(label,
                xy=(row['date'], row['distance']),
                xytext=(0, 8), textcoords='offset points',
                ha='center', fontsize=7.5, color='#333333',
                arrowprops=None)

# shade era bands
era_bands = [
    ('2008-09-01', '2009-06-01', '#ffd6cc', '全球金融危机'),
    ('2015-06-01', '2016-03-01', '#d4e8ff', '股市大跌'),
    ('2018-01-01', '2019-12-01', '#ffe8cc', '贸易战'),
    ('2020-01-01', '2020-06-01', '#e8ffcc', '新冠疫情'),
    ('2022-01-01', '2023-06-01', '#e8ccff', '经济重启'),
]
ymin, ymax = ax.get_ylim()
for start, end, color, lbl in era_bands:
    ax.axvspan(pd.Timestamp(start), pd.Timestamp(end),
               alpha=0.25, color=color, zorder=0)
    mid = pd.Timestamp(start) + (pd.Timestamp(end) - pd.Timestamp(start)) / 2
    ax.text(mid, ymax * 0.97, lbl, ha='center', va='top',
            fontsize=8, color='#555555', style='italic')

ax.set_xlabel('月份', fontsize=11)
ax.set_ylabel('与2026-02的欧氏距离', fontsize=11)
ax.set_title('各历史月份与当前宏观环境（2026-02）的距离\n'
             '距离越小表示越相似', fontsize=12, fontweight='bold', pad=10)
ax.legend(fontsize=9, loc='upper left', framealpha=0.85, edgecolor='#cccccc')
ax.spines[['top', 'right']].set_visible(False)
ax.set_xlim(dist_all['date'].min() - pd.Timedelta(days=90),
            pd.Timestamp('2026-01-01'))
plt.tight_layout()
out3 = DATA_DIR / 'regime_chart_timeline.png'
fig3.savefig(out3, dpi=150, bbox_inches='tight', facecolor=fig3.get_facecolor())
plt.close(fig3)
print(f"Saved: {out3}")

print("\nAll charts generated successfully.")
