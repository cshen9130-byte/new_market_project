"""Redraw contribution charts from the first session after 2025-08.

The July-August book is the position-building period. A few contracts can
print a very high contribution then, and that is expected. The charts start
on the first settlement date on or after 2025-09-01.
"""
from __future__ import annotations

import io
import zipfile
from collections import defaultdict
from datetime import datetime

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import numpy as np
import psycopg2
from matplotlib import font_manager

START = "2025-09-01"
END = "2026-11-11"
Z = 1.6449
VOL = 20
CORR = 252
MV_MIN = 1000

SECTOR = {
    "C": "农产", "CS": "农产", "WH": "农产", "PM": "农产", "RR": "农产", "RI": "农产", "JR": "农产", "LR": "农产",
    "A": "农产", "B": "农产", "M": "农产", "Y": "农产", "RM": "农产", "OI": "农产", "RS": "农产", "PK": "农产", "P": "农产",
    "SR": "农产", "CF": "农产", "CY": "农产", "LG": "农产", "SP": "农产", "OP": "农产",
    "AP": "生鲜", "CJ": "生鲜", "LH": "生鲜", "JD": "生鲜",
    "AU": "贵金属", "AG": "贵金属", "PT": "贵金属", "PD": "贵金属",
    "CU": "有色", "BC": "有色", "AL": "有色", "AO": "有色", "AD": "有色", "ZN": "有色", "PB": "有色", "NI": "有色", "SN": "有色",
    "LC": "新能源", "PS": "新能源", "SI": "新能源",
    "I": "黑色", "SF": "黑色", "SM": "黑色", "RB": "黑色", "HC": "黑色", "SS": "黑色", "WR": "黑色",
    "JM": "黑色", "J": "黑色", "ZC": "黑色", "FG": "黑色", "BB": "黑色", "FB": "黑色",
    "SC": "能源化工", "FU": "能源化工", "LU": "能源化工", "PG": "能源化工", "BU": "能源化工",
    "TA": "能源化工", "EG": "能源化工", "PF": "能源化工", "PR": "能源化工", "PL": "能源化工", "PP": "能源化工", "L": "能源化工",
    "BZ": "能源化工", "PX": "能源化工", "EB": "能源化工",
    "RU": "能源化工", "BR": "能源化工", "NR": "能源化工",
    "SA": "能源化工", "SH": "能源化工", "V": "能源化工", "UR": "能源化工", "MA": "能源化工",
    "EC": "航运",
    "IH": "股指", "IF": "股指", "IC": "股指", "IM": "股指", "MO": "股指",
    "TS": "国债", "TF": "国债", "T": "国债", "TL": "国债",
}
NAME = {
    "MA": "甲醇", "P": "棕榈油", "B": "黄大豆2号", "M": "豆粕", "AP": "苹果", "Y": "豆油", "JM": "焦煤", "RM": "菜籽粕",
    "JD": "鸡蛋", "LC": "碳酸锂", "AU": "黄金", "AG": "白银", "PP": "聚丙烯", "EG": "乙二醇", "L": "塑料", "TA": "PTA",
    "RU": "橡胶", "CU": "沪铜", "AL": "沪铝", "RB": "螺纹", "I": "铁矿", "CF": "棉花", "SR": "白糖", "C": "玉米",
    "OI": "菜油", "LH": "生猪", "NI": "沪镍", "SN": "沪锡", "ZN": "沪锌", "PB": "沪铅", "FG": "玻璃", "SA": "纯碱",
    "UR": "尿素", "V": "PVC", "BU": "沥青", "FU": "燃油", "SC": "原油", "EB": "苯乙烯", "PF": "短纤", "PX": "PX",
    "BZ": "纯苯", "NR": "20号胶", "BR": "丁二烯", "SP": "纸浆", "PK": "花生", "SI": "工业硅", "PS": "多晶硅",
    "AO": "氧化铝", "HC": "热卷", "SS": "不锈钢", "SF": "硅铁", "SM": "锰硅", "J": "焦炭", "PG": "LPG",
    "IH": "上证50", "IF": "沪深300", "IC": "中证500", "IM": "中证1000",
}
AK = {
    "A": "A0.DCE", "AD": "AD0.SHF", "AG": "AG0.SHF", "AL": "AL0.SHF", "AO": "AO0.SHF", "AP": "AP0.CZC",
    "AU": "AU0.SHF", "B": "B0.DCE", "BB": "BB0.DCE", "BC": "BCM.INE", "BR": "BR0.SHF", "BU": "BU0.SHF",
    "BZ": "BZ0.DCE", "C": "C0.DCE", "CF": "CF0.CZC", "CJ": "CJ0.CZC", "CS": "CS0.DCE", "CU": "CU0.SHF",
    "CY": "CY0.CZC", "EB": "EB0.DCE", "EC": "ECM.INE", "EG": "EG0.DCE", "FB": "FB0.DCE", "FG": "FG0.CZC",
    "FU": "FU0.SHF", "HC": "HC0.SHF", "I": "I0.DCE", "IC": "IC0.CFE", "IF": "IF0.CFE", "IH": "IH0.CFE",
    "IM": "IM0.CFE", "J": "J0.DCE", "JD": "JD0.DCE", "JM": "JM0.DCE", "JR": "JR0.CZC", "L": "L0.DCE",
    "LC": "LCM.GFE", "LG": "LG0.DCE", "LH": "LH0.DCE", "LR": "LR0.CZC", "LU": "LUM.INE", "M": "M0.DCE",
    "MA": "MA0.CZC", "NI": "NI0.SHF", "NR": "NRM.INE", "OI": "OI0.CZC", "OP": "OP0.SHF", "P": "P0.DCE",
    "PB": "PB0.SHF", "PD": "PDM.GFE", "PF": "PF0.CZC", "PG": "PG0.DCE", "PK": "PK0.CZC", "PL": "PL0.CZC",
    "PM": "PM0.CZC", "PP": "PP0.DCE", "PR": "PR0.CZC", "PS": "PSM.GFE", "PT": "PTM.GFE", "PX": "PX0.CZC",
    "RB": "RB0.SHF", "RI": "RI0.CZC", "RM": "RM0.CZC", "RR": "RR0.DCE", "RS": "RS0.CZC", "RU": "RU0.SHF",
    "SA": "SA0.CZC", "SC": "SCM.INE", "SF": "SF0.CZC", "SH": "SH0.CZC", "SI": "SIM.GFE", "SM": "SM0.CZC",
    "SN": "SN0.SHF", "SP": "SP0.SHF", "SR": "SR0.CZC", "SS": "SS0.SHF", "TA": "TA0.CZC", "T": "T0.CFE",
    "TF": "TF0.CFE", "TL": "TL0.CFE", "TS": "TS0.CFE", "UR": "UR0.CZC", "V": "V0.DCE", "WH": "WH0.CZC",
    "WR": "WR0.SHF", "Y": "Y0.DCE", "ZC": "ZC0.CZC", "ZN": "ZN0.SHF",
}
SECTOR_ORDER = ["能源化工", "农产品", "生鲜", "黑色", "新能源", "有色", "国债", "贵金属", "股指", "航运"]
SECTOR_COLOR = {
    "能源化工": "#1B3A4B",
    "农产品": "#E07A3D",
    "生鲜": "#F2C14E",
    "黑色": "#4A5568",
    "新能源": "#3B82C4",
    "有色": "#7C5CBF",
    "国债": "#2F855A",
    "贵金属": "#D53F8C",
    "股指": "#C53030",
    "航运": "#2C7A7B",
}
PROD_COLOR = {
    "MA": "#1B3A4B", "P": "#E07A3D", "B": "#2F855A", "M": "#3B82C4", "AP": "#7C5CBF",
    "Y": "#D53F8C", "JM": "#4A5568", "RM": "#2C7A7B", "JD": "#C53030", "LC": "#DD6B20",
    "AU": "#B7791F", "EG": "#6B46C1", "PP": "#2B6CB0",
}


def zero_spikes(rets: np.ndarray) -> np.ndarray:
    out = rets.copy()
    if len(rets) < 42:
        return out
    for i in range(40, len(rets)):
        win = np.sort(np.abs(rets[i - 40:i]))
        med = win[len(win) // 2]
        devs = np.sort(np.abs(win - med))
        mad = devs[len(devs) // 2]
        thr = max(0.06, med + 12 * mad * 1.4826)
        if abs(rets[i]) > thr:
            out[i] = 0.0
    return out


def sample_std(xs: np.ndarray) -> float:
    xs = xs[xs != 0]
    if xs.size < 2:
        return 0.0
    return float(xs.std(ddof=1))


def shares_from(prods, mv, sigma, corr):
    dv = sigma * mv
    mvc = dv * (corr @ dv)
    port = float(mvc.sum())
    if port <= 0:
        return None
    mcr = np.abs(mvc)
    use = mcr >= 1
    total = float(mcr[use].sum())
    if total <= 0:
        return None
    prod_pct = {}
    sec = defaultdict(float)
    for i, prod in enumerate(prods):
        if not use[i]:
            continue
        prod_pct[prod] = mcr[i] / total * 100
        raw_sec = SECTOR.get(prod, "其他")
        sec["农产品" if raw_sec == "农产" else raw_sec] += mcr[i]
    return prod_pct, {k: v / total * 100 for k, v in sec.items()}


def load_series():
    conn = psycopg2.connect("postgresql://market_user:2026SmartDashboard!@127.0.0.1:5433/market_data")
    cur = conn.cursor()
    cur.execute(
        """
        SELECT "交易日期"::text, UPPER(TRIM("合约")),
               SUM(CASE WHEN COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("买持仓"::text,''),',',''),' ',''),'')::numeric,0) > 0
                        THEN COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("持仓市値"::text,''),',',''),' ',''),'')::numeric,0)
                        ELSE -COALESCE(NULLIF(REPLACE(REPLACE(COALESCE("持仓市値"::text,''),',',''),' ',''),'')::numeric,0)
                   END)
        FROM mom_position_details
        WHERE "交易日期" IS NOT NULL AND "合约" IS NOT NULL
          AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOXIN%'
          AND UPPER(TRIM("账户"::text)) NOT LIKE '%GUOSEN%'
          AND TRIM("账户"::text) NOT LIKE '%国信%'
          AND TRIM("账户"::text) <> '665300200077'
          AND UPPER(TRIM("合约")) !~ '[0-9][CP][0-9]'
          AND TRIM("合约") NOT LIKE '%-%-%'
        GROUP BY 1, 2
        """
    )
    mv_by_date = defaultdict(dict)
    for d, contract, mv in cur.fetchall():
        prod = "".join(ch for ch in contract if ch.isalpha())
        mv_by_date[d][prod] = mv_by_date[d].get(prod, 0.0) + float(mv or 0)
    dates = sorted(mv_by_date)
    codes = sorted({AK[p] for day in mv_by_date.values() for p in day if p in AK})
    cur.execute(
        """
        SELECT trade_date::text, code, pct_change
        FROM raw_akshare_futures_daily
        WHERE code = ANY(%s) AND pct_change IS NOT NULL
        ORDER BY trade_date
        """,
        (codes,),
    )
    pct = defaultdict(dict)
    mkt_set = set()
    for d, code, pct_change in cur.fetchall():
        mkt_set.add(d)
        pct[code][d] = float(pct_change) / 100.0
    mkt = sorted(mkt_set)
    mkt_index = {d: i for i, d in enumerate(mkt)}
    raw = {code: np.array([pct[code].get(d, 0.0) for d in mkt], dtype=float) for code in codes}
    clean = {code: zero_spikes(arr) for code, arr in raw.items()}
    rows = []
    for d in dates:
        idx = mkt_index.get(d)
        if idx is None or idx < max(VOL, CORR):
            continue
        vol_sl = slice(idx - VOL + 1, idx + 1)
        corr_sl = slice(idx - CORR + 1, idx + 1)
        held = [(p, mv) for p, mv in mv_by_date[d].items() if abs(mv) >= MV_MIN and p in AK]
        if not held:
            continue
        prods = [p for p, _ in held]
        mv = np.array([m for _, m in held], dtype=float)
        sigma = np.array([sample_std(clean[AK[p]][vol_sl]) for p in prods])
        mat = np.vstack([raw[AK[p]][corr_sl] for p in prods])
        with np.errstate(invalid="ignore", divide="ignore"):
            c = np.corrcoef(mat)
        c = np.nan_to_num(c, nan=0.0)
        np.fill_diagonal(c, 1.0)
        got = shares_from(prods, mv, sigma, c)
        if not got:
            continue
        prod_pct, sec_pct = got
        rows.append((d, prod_pct, sec_pct, len(held)))
    return rows


def setup_font():
    for family in ("Microsoft YaHei", "SimHei", "微软雅黑"):
        try:
            font_manager.findfont(family, fallback_to_default=False)
            plt.rcParams["font.sans-serif"] = [family]
            break
        except Exception:
            continue
    plt.rcParams["axes.unicode_minus"] = False
    plt.rcParams["figure.facecolor"] = "white"
    plt.rcParams["savefig.facecolor"] = "white"
    plt.rcParams["axes.edgecolor"] = "#CBD5E0"
    plt.rcParams["axes.labelcolor"] = "#2D3748"
    plt.rcParams["xtick.color"] = "#4A5568"
    plt.rcParams["ytick.color"] = "#4A5568"
    plt.rcParams["text.color"] = "#1A202C"


def as_dates(days):
    return [datetime.strptime(d, "%Y-%m-%d") for d in days]


def style_ax(ax, title):
    ax.set_title(title, fontsize=15, pad=12, color="#1A202C")
    ax.set_ylabel("贡献占比", fontsize=11)
    ax.set_ylim(0, 105)
    ax.set_yticks([0, 20, 40, 60, 80, 100])
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _p: f"{int(v)}%"))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=2))
    ax.grid(True, axis="y", color="#E2E8F0", linewidth=0.8)
    ax.grid(True, axis="x", color="#EDF2F7", linewidth=0.6)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    for label in ax.get_xticklabels():
        label.set_rotation(0)
        label.set_fontsize(9)


def footer(fig, text):
    fig.text(0.01, 0.012, text, fontsize=8, color="#718096")


def save_fig(fig, path, size):
    fig.savefig(path, dpi=150)
    plt.close(fig)
    from PIL import Image
    im = Image.open(path).convert("RGBA")
    if im.size != size:
        im = im.resize(size, Image.Resampling.LANCZOS)
        im.save(path)
    print("wrote", path, im.size)


def main():
    setup_font()
    rows = load_series()
    print("all", rows[0][0], rows[-1][0], len(rows))
    early = [r for r in rows if r[0] < START]
    late = [r for r in rows if START <= r[0] <= END]
    print("chart", late[0][0], late[-1][0], len(late), "dropped", len(early))
    if early:
        def peak_sec(sample):
            best = {}
            for d, _prod, sec, _n in sample:
                for name, val in sec.items():
                    if val > best.get(name, (0, ""))[0]:
                        best[name] = (val, d)
            return best
        print("BEFORE", {k: (round(v, 1), d) for k, (v, d) in peak_sec(early).items() if v >= 50})
    days = [r[0] for r in late]
    x = as_dates(days)
    sec_series = {name: [] for name in SECTOR_ORDER}
    prod_series = defaultdict(list)
    for d, prod, sec, _n in late:
        for name in SECTOR_ORDER:
            sec_series[name].append(sec.get(name, 0.0))
        seen = set()
        for code, val in prod.items():
            prod_series[code].append(val)
            seen.add(code)
        for code in list(prod_series):
            if code not in seen:
                prod_series[code].append(0.0)
    # pad products that appear late
    for code, seq in prod_series.items():
        if len(seq) < len(days):
            prod_series[code] = [0.0] * (len(days) - len(seq)) + seq

    sec_over = {}
    for name, seq in sec_series.items():
        arr = np.array(seq)
        hits = int(np.sum(arr >= 50))
        if hits:
            i = int(np.argmax(arr))
            sec_over[name] = (hits, round(float(arr[i]), 1), days[i])
    print("SECTOR >=50 in window", sec_over)

    prod_over = {}
    for code, seq in prod_series.items():
        arr = np.array(seq)
        hits = int(np.sum(arr >= 30))
        if hits:
            i = int(np.argmax(arr))
            prod_over[code] = (hits, round(float(arr[i]), 1), days[i], NAME.get(code, code))
    print("PROD >=30 in window", prod_over)

    end_row = [r for r in late if r[0] == END][-1]
    top8 = [c for c, _v in sorted(end_row[1].items(), key=lambda kv: -kv[1])[:8]]
    print("top8", [(c, NAME.get(c, c), round(end_row[1][c], 2)) for c in top8])

    foot = (
        "数据来源：生产库 mom_position_details + raw_akshare_futures_daily；口径对齐日间风控 VaR 沙盘（含当日窗口）。"
        f"图自 {late[0][0]} 起，不含 2025 年 7–8 月建仓期。"
    )

    # 图 8 stacked
    fig, ax = plt.subplots(figsize=(12.47, 6.53))
    stack = np.vstack([sec_series[name] for name in SECTOR_ORDER])
    ax.stackplot(x, stack, colors=[SECTOR_COLOR[n] for n in SECTOR_ORDER], labels=SECTOR_ORDER, linewidth=0)
    ax.axhline(50, color="#D69E2E", linestyle="--", linewidth=1.1, label="板块软预警 50%")
    ax.axhline(65, color="#C53030", linestyle=":", linewidth=1.2, label="板块硬干预 65%")
    # end label for energy
    ax.annotate(
        f"{END[5:]} 能源化工 {sec_series['能源化工'][-1]:.1f}%",
        xy=(x[-1], sec_series["能源化工"][-1]),
        xytext=(-150, 16),
        textcoords="offset points",
        fontsize=8,
        color="#1B3A4B",
        ha="right",
        arrowprops=dict(arrowstyle="-", color="#4A5568", lw=0.6),
    )
    style_ax(ax, "板块边际波动贡献占比（堆叠面积）")
    ax.legend(ncol=5, fontsize=8, frameon=False, loc="upper center", bbox_to_anchor=(0.5, 1.0))
    ax.set_xlim(x[0], x[-1])
    fig.tight_layout(rect=(0, 0.03, 1, 0.96))
    footer(fig, foot)
    save_fig(fig, "reports/_chart_ref/image13.png", (1871, 979))

    # 图 8b lines
    fig, ax = plt.subplots(figsize=(12.47, 6.95))
    for name in SECTOR_ORDER:
        seq = sec_series[name]
        hit = name in sec_over
        ax.plot(
            x, seq, color=SECTOR_COLOR[name], label=name,
            linewidth=2.2 if hit else 1.0, alpha=1.0 if hit else 0.85,
        )
    ax.axhline(50, color="#D69E2E", linestyle="--", linewidth=1.1, label="板块软预警 50%")
    ax.axhline(65, color="#C53030", linestyle=":", linewidth=1.2, label="板块硬干预 65%")
    for name, (hits, peak, when) in sec_over.items():
        i = days.index(when)
        y = sec_series[name][i]
        frac = i / max(len(days) - 1, 1)
        dx, ha = (-6, "right") if frac > 0.8 else (6, "left")
        dy, va = (-12, "top") if y > 78 else (8, "bottom")
        ax.annotate(
            f"{name} {peak:.0f}%",
            xy=(x[i], y),
            xytext=(dx, dy),
            textcoords="offset points",
            fontsize=8,
            color=SECTOR_COLOR[name],
            ha=ha,
            va=va,
        )
    style_ax(ax, "全部板块边际波动贡献占比（时序，建仓期之后）")
    ax.legend(ncol=4, fontsize=8, frameon=False, loc="upper center", bbox_to_anchor=(0.38, 0.98))
    ax.set_xlim(x[0], x[-1])
    fig.tight_layout(rect=(0, 0.04, 1, 0.98))
    footer(fig, foot + f" 共 {len(SECTOR_ORDER)} 个板块。加粗线曾达到或超过 50% 软预警。")
    save_fig(fig, "reports/_chart_ref/image14.png", (1871, 1042))

    # 图 9 top 8 on the end date
    fig, ax = plt.subplots(figsize=(12.47, 6.53))
    palette = ["#1B3A4B", "#E07A3D", "#2F855A", "#3B82C4", "#7C5CBF", "#D53F8C", "#4A5568", "#2C7A7B"]
    for i, code in enumerate(top8):
        ax.plot(x, prod_series[code], color=palette[i], linewidth=1.5, label=f"{code}（{NAME.get(code, code)}）")
    ax.axhline(30, color="#D69E2E", linestyle="--", linewidth=1.1, label="品种软预警 30%")
    ax.axhline(50, color="#C53030", linestyle=":", linewidth=1.2, label="品种硬干预 50%")
    style_ax(ax, f"主要品种边际波动贡献占比（时序，截至 {END}）")
    ax.legend(ncol=5, fontsize=8, frameon=False, loc="upper center", bbox_to_anchor=(0.5, 1.02))
    ax.set_xlim(x[0], x[-1])
    fig.tight_layout(rect=(0, 0.03, 1, 0.94))
    footer(fig, foot + " 线条是期末当天贡献最大的 8 个品种。")
    save_fig(fig, "reports/_chart_ref/image15.png", (1871, 979))

    # 图 9b all products
    fig, ax = plt.subplots(figsize=(13.09, 6.95))
    colored = sorted(prod_over, key=lambda c: -prod_over[c][1])
    for code, seq in prod_series.items():
        if code in prod_over:
            continue
        ax.plot(x, seq, color="#CBD5E0", linewidth=0.6, alpha=0.9, zorder=1)
    highlight = ["#C53030", "#DD6B20", "#B7791F", "#1B3A4B", "#2B6CB0", "#6B46C1", "#2F855A", "#D53F8C", "#3B82C4", "#718096", "#E07A3D"]
    for i, code in enumerate(colored):
        color = highlight[i % len(highlight)]
        ax.plot(x, prod_series[code], color=color, linewidth=1.6, zorder=2, label=f"{code}（{NAME.get(code, code)}）")
        hits, peak, when, _label = prod_over[code]
        if peak >= 33:
            j = days.index(when)
            ax.annotate(
                f"{NAME.get(code, code)} {peak:.0f}%",
                xy=(x[j], prod_series[code][j]),
                xytext=(6, 6),
                textcoords="offset points",
                fontsize=8,
                color=color,
            )
    ax.plot([], [], color="#A0AEC0", linewidth=0.8, label=f"其余品种（未到 30%）")
    ax.axhline(30, color="#D69E2E", linestyle="--", linewidth=1.1, label="品种软预警 30%")
    ax.axhline(50, color="#C53030", linestyle=":", linewidth=1.2, label="品种硬干预 50%")
    style_ax(ax, "全部品种边际波动贡献占比（时序，建仓期之后）")
    ax.legend(ncol=2, fontsize=7.5, frameon=False, loc="upper right")
    ax.set_xlim(x[0], x[-1])
    fig.tight_layout(rect=(0, 0.04, 1, 1))
    n_color = len(colored)
    n_rest = len(prod_series) - n_color
    footer(fig, foot + f" 彩色线 {n_color} 个曾达到或超过 30%，细灰线 {n_rest} 个。")
    save_fig(fig, "reports/_chart_ref/image16.png", (1964, 1042))

    # patch docx images and the two captions that quote the old sample start
    doc_path = r"reports/MOM板块品种VaR贡献风控分析报告 (1).docx"
    repl = {
        "word/media/image13.png": open("reports/_chart_ref/image13.png", "rb").read(),
        "word/media/image14.png": open("reports/_chart_ref/image14.png", "rb").read(),
        "word/media/image15.png": open("reports/_chart_ref/image15.png", "rb").read(),
        "word/media/image16.png": open("reports/_chart_ref/image16.png", "rb").read(),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(doc_path, "r") as zin, zipfile.ZipFile(buf, "w") as zout:
        for item in zin.infolist():
            data = repl.get(item.filename, zin.read(item.filename))
            zout.writestr(item, data)
    with open(doc_path, "wb") as f:
        f.write(buf.getvalue())
    print("docx images replaced")

    # caption text
    import docx
    document = docx.Document(doc_path)
    start_s = late[0][0]
    sec_bits = "、".join(
        f"{name} {hits} 个交易日（高点 {when} 的 {peak:.1f}%）"
        for name, (hits, peak, when) in sorted(sec_over.items(), key=lambda kv: -kv[1][1])
    )
    prod_bits = "、".join(
        f"{NAME.get(code, code)} {hits} 个交易日（高点 {peak:.1f}%，{when}）"
        for code, (hits, peak, when, _n) in sorted(prod_over.items(), key=lambda kv: -kv[1][1])
    )
    print("SEC TEXT", sec_bits)
    print("PROD TEXT", prod_bits)
    print("NPROD", len(prod_series), "NCOLOR", n_color, "NREST", n_rest, "START", start_s)

    def replace_paragraph(prefix, new_text):
        for para in document.paragraphs:
            if para.text.startswith(prefix):
                if not para.runs:
                    return False
                para.runs[0].text = new_text
                for run in para.runs[1:]:
                    run.text = ""
                print("updated", prefix[:12], "->", len(new_text))
                return True
        print("MISSING", prefix[:20])
        return False

    replace_paragraph(
        "解读与入库建议。共 10 个板块。图从",
        "解读与入库建议。共 10 个板块。图从 "
        f"{start_s} 画到 {END}，2025 年 7–8 月是建仓期，品种少，少数合约可以把贡献占比顶得很高，这在建仓阶段是正常的，所以没有画进这张图。"
        f"加粗线是这一窗口里曾达到或超过 50% 软预警的板块：{sec_bits}。"
        "贵金属在 2026-09-18 到过 49.7%，未到软线。图 8 看主导如何在板块之间切换，图 8b 直接对照软硬线。"
        " 入库建议：仅报告用——适合定期复盘或研究报告，不必做到每日刷新。",
    )
    replace_paragraph(
        "解读与入库建议。图从",
        "解读与入库建议。图从 "
        f"{start_s} 画到 {END}，同样去掉 2025 年 7–8 月建仓期。窗口内有 {len(prod_series)} 个品种。"
        f"彩色线是这一窗口里曾达到或超过 30% 软预警的 {n_color} 个品种，细灰线是其余 {n_rest} 个。"
        f"越过 30% 的是：{prod_bits}。"
        "要看期末当天最大的 8 个品种，用图 9；要看谁真正越过 30%，用图 9b，不要拿图 9 去对图 12 的蓝线。"
        " 入库建议：仅报告用——适合定期复盘或研究报告，不必做到每日刷新。",
    )
    document.save(doc_path)
    print("captions saved")


if __name__ == "__main__":
    main()
