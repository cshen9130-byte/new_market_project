# -*- coding: utf-8 -*-
import shutil
import zipfile
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from docx import Document

ROOT = Path(r"d:\coding\market_website")
DOCS = ROOT / "docs"
CHART = DOCS / "strategy-observation-compare-charts"
DOC = next(p for p in DOCS.glob("*.docx") if "\u7b56\u7565\u89c2\u5bdf" in p.name)
font_manager.fontManager.addfont(r"C:\Windows\Fonts\msyh.ttc")
plt.rcParams["font.family"] = "Microsoft YaHei"
plt.rcParams["axes.unicode_minus"] = False

FOF_MED = {
    "股票市场中性": 4.91, "1000指增": 14.02, "500指增": 13.57, "300指增": 12.57,
    "A500指增": 11.52, "2000指增": 18.44, "量化选股": 12.47, "主观多头": 1.17,
    "量化期货": 12.47, "主观期货": 12.10, "期货策略": 13.41, "股票对冲": 5.38,
    "套利策略": 6.12, "期权策略": 4.81, "多资产策略": 7.30, "债券策略": 3.01,
    "组合策略": 3.82, "可转债多头": 2.85,
}
OUR_MED = {
    "股票市场中性": 4.54, "1000指增": 13.13, "500指增": 14.11, "300指增": 12.90,
    "A500指增": 10.12, "2000指增": 14.83, "量化选股": 9.61, "主观多头": 2.12,
    "量化期货": 10.70, "主观期货": 10.71, "期货策略": 10.27, "股票对冲": 5.36,
    "套利策略": 6.49, "期权策略": 5.36, "多资产策略": 6.29, "债券策略": 3.44,
    "组合策略": 4.65, "可转债多头": 4.03,
}
ORDER = list(FOF_MED)
GRADE = {
    "股票市场中性": "好", "1000指增": "好", "500指增": "好", "股票对冲": "好",
    "套利策略": "好", "期权策略": "好", "多资产策略": "好",
    "300指增": "较好", "A500指增": "较好", "主观多头": "较好", "主观期货": "较好", "债券策略": "较好",
    "量化期货": "一般", "期货策略": "一般", "组合策略": "一般", "2000指增": "一般",
    "量化选股": "较差", "可转债多头": "较差",
}
COLOR = {"好": "#2e7d32", "较好": "#7cb342", "一般": "#f9a825", "较差": "#c62828"}
offsets = {
    "股票市场中性": (8, -12), "1000指增": (6, 8), "500指增": (-36, 12),
    "300指增": (-46, 8), "A500指增": (-58, -4), "2000指增": (-72, 8),
    "量化选股": (8, -16), "主观多头": (8, -2), "量化期货": (46, 16),
    "主观期货": (-78, 14), "期货策略": (52, -18), "股票对冲": (8, 10),
    "套利策略": (8, 6), "期权策略": (-52, 10), "多资产策略": (8, -12),
    "债券策略": (-46, -12), "组合策略": (-50, 8), "可转债多头": (8, 8),
}
fig, ax = plt.subplots(figsize=(7.8, 7.0), dpi=140)
xs = [FOF_MED[n] for n in ORDER]
ys = [OUR_MED[n] for n in ORDER]
for n, x, yv in zip(ORDER, xs, ys):
    ax.scatter(x, yv, s=46, color=COLOR[GRADE[n]], zorder=3)
    dx, dy = offsets[n]
    kw = {}
    if abs(dx) + abs(dy) > 24:
        kw["arrowprops"] = dict(arrowstyle="-", color="#bdbdbd", lw=0.6, shrinkA=0, shrinkB=3)
    ax.annotate(n, (x, yv), textcoords="offset points", xytext=(dx, dy), fontsize=8, color="#424242", **kw)
lo = min(xs + ys) - 1.5
hi = max(xs + ys) + 2.4
ax.plot([lo, hi], [lo, hi], color="#bdbdbd", lw=1, ls="--")
ax.set_xlim(lo, hi)
ax.set_ylim(lo, hi)
ax.set_xlabel("火富牛 50% 分位（%）", fontsize=10)
ax.set_ylabel("本系统 50% 分位（%）", fontsize=10)
ax.set_title("中位数越靠近虚线，类别越对齐", fontsize=13, pad=10, loc="left")
ax.grid(color="#f5f5f5")
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
fig.tight_layout()
fig.savefig(CHART / "scatter.png", bbox_inches="tight", facecolor="white")
plt.close()

doc = Document(str(DOC))
old = "现在可以认为指增、市场中性、股票对冲、期权、多资产、套利的一年分布已经可用"
new = "现在可以认为 1000、500、300、A500 指增、市场中性、股票对冲、期权、多资产、套利的一年分布已经可用"
hits = [p for p in doc.paragraphs if old in p.text]
if len(hits) != 1:
    raise SystemExit("hits %s" % len(hits))
p = hits[0]
full = p.text.replace(old, new, 1)
p.runs[0].text = full
for run in p.runs[1:]:
    run.text = ""
stage = DOCS / "_strategy_obs_stage.docx"
doc.save(str(stage))

src = (CHART / "scatter.png").read_bytes()
tmp = DOCS / "_strategy_obs_stage_img.docx"
found = False
with zipfile.ZipFile(stage, "r") as zin, zipfile.ZipFile(tmp, "w") as zout:
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "word/media/image2.png":
            data = src
            found = True
        zout.writestr(item, data)
if not found:
    raise SystemExit("image2 missing")
stage.unlink()
try:
    tmp.replace(DOC)
    print("replaced", len(src))
except OSError as err:
    final = DOCS / (DOC.stem + "-updated.docx")
    tmp.replace(final)
    print("locked", err)
    print("wrote", final.name.encode("unicode_escape").decode(), len(src))
