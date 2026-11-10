# -*- coding: utf-8 -*-
"""Record of the RX383 checks run after the outside notes. Local Word file only."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Inches

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _generate_rx319_profile_word_report as prof  # noqa: E402
import _rx383_combined_report as rep  # noqa: E402
import _rx383_option_strategy_report as base  # noqa: E402
import _rx383_pick_model as pick  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "reports" / "RX383_假设检验.docx"
CHART = Path(__file__).resolve().parents[2] / "reports" / "_rx383_option_strategy" / "charts"
END = pd.Timestamp("2026-11-09")
METALS = {"CU", "AL", "ZN", "NI", "SN", "PB", "AO"}
AGS = {"M", "RM", "Y", "P", "A", "B", "C", "CS", "JD", "LH", "CF", "SR", "OI", "PK", "AP"}
PAIR = {"LC", "SI"}


def _wmed(x, w):
    x = np.asarray(x, float)
    w = np.asarray(w, float)
    ok = np.isfinite(x) & np.isfinite(w) & (w > 0)
    if not ok.any():
        return float("nan")
    x, w = x[ok], w[ok]
    order = np.argsort(x)
    w = w[order]
    return float(x[order][np.searchsorted(w.cumsum(), 0.5 * w.sum())])


STATS: dict = {}


def _rank_block(frame: pd.DataFrame, col: str, higher: bool = True) -> dict:
    """Same-count rank. higher=True takes the largest gap first."""
    if frame is None or frame.empty or col not in frame.columns:
        return {"hits": 0, "trials": 0, "base": float("nan"), "his": float("nan"), "oth": float("nan")}
    sub = frame.dropna(subset=[col]).copy()
    hits = trials = 0
    base = []
    sold_mask = sub["y"] == 1
    his = float(sub.loc[sold_mask, col].median()) if sold_mask.any() else float("nan")
    oth = float(sub.loc[~sold_mask, col].median()) if (~sold_mask).any() else float("nan")
    for _dt, g in sub.groupby("dt"):
        k = int((g["y"] == 1).sum())
        if k <= 0:
            continue
        top = set(g.sort_values(col, ascending=not higher)["product"].head(k))
        sold = set(g.loc[g["y"] == 1, "product"])
        trials += k
        hits += len(top & sold)
        base.append(k / len(g))
    return {
        "hits": hits,
        "trials": trials,
        "base": float(np.mean(base)) if base else float("nan"),
        "his": his,
        "oth": oth,
    }


def _garch(rets, alpha=0.06, beta=0.92) -> float:
    x = np.asarray(rets, float)
    x = x[np.isfinite(x)]
    if len(x) < 40:
        return float("nan")
    var = float(np.var(x))
    if not math.isfinite(var) or var <= 0:
        return float("nan")
    omega = (1.0 - alpha - beta) * var
    v = var
    for r in x:
        v = omega + alpha * r * r + beta * v
    return math.sqrt(max(v, 0.0) * 252.0) * 100.0


def _har(sq, i) -> float:
    if i < 80:
        return float("nan")
    y, d, w, m = [], [], [], []
    for t in range(22, i - 1):
        if not np.isfinite(sq[t + 1]):
            continue
        day, week, month = sq[t], sq[t - 4 : t + 1], sq[t - 21 : t + 1]
        if not (np.isfinite(day) and np.isfinite(week).all() and np.isfinite(month).all()):
            continue
        y.append(sq[t + 1])
        d.append(day)
        w.append(float(np.mean(week)))
        m.append(float(np.mean(month)))
    if len(y) < 40:
        return float("nan")
    coef, *_ = np.linalg.lstsq(np.column_stack([np.ones(len(y)), d, w, m]), np.array(y), rcond=None)
    day, week, month = sq[i - 1], sq[i - 5 : i], sq[i - 22 : i]
    if not (np.isfinite(day) and np.isfinite(week).all() and np.isfinite(month).all()):
        return float("nan")
    pred = float(coef[0] + coef[1] * day + coef[2] * np.mean(week) + coef[3] * np.mean(month))
    if pred <= 0:
        return float("nan")
    return math.sqrt(pred * 252.0) * 100.0


def _forecasts(panel: pd.DataFrame) -> tuple[pd.DataFrame, list]:
    from mom_data_etl import get_conn

    conn = get_conn()
    try:
        ak = prof.read_sql(conn, """
            SELECT trade_date::date AS dt, code, COALESCE(clear, close)::float8 AS px
            FROM raw_akshare_futures_daily
            WHERE trade_date BETWEEN DATE '2025-01-01' AND DATE '2026-11-09'
        """)
    finally:
        conn.close()
    ak["dt"] = pd.to_datetime(ak["dt"]).dt.normalize()
    root = ak["code"].str.upper().str.split(".").str[0]
    ak["product"] = root.str.replace(r"(0|M)$", "", regex=True)
    ak = ak.dropna(subset=["product", "px"])
    ak = ak[ak["px"] > 0].drop_duplicates(["dt", "product"]).sort_values(["product", "dt"])
    ak["ret"] = ak.groupby("product")["px"].pct_change()
    want = {(pd.Timestamp(dt), p) for dt, p in zip(panel["dt"], panel["product"])}
    rows = []
    for product, g in ak.groupby("product"):
        g = g.sort_values("dt")
        rets = g["ret"].to_numpy(float)
        dates = list(g["dt"])
        sq = rets ** 2
        for i, dt in enumerate(dates):
            if (pd.Timestamp(dt), product) not in want:
                continue
            hist = rets[:i]
            hist = hist[np.isfinite(hist)]
            fwd = rets[i + 1 : i + 11]
            fwd = fwd[np.isfinite(fwd)]
            fwd_rv = float(np.std(fwd, ddof=1) * math.sqrt(252.0) * 100.0) if len(fwd) >= 5 else float("nan")
            rows.append((pd.Timestamp(dt), product, _har(sq, i), _garch(hist), fwd_rv))
    return pd.DataFrame(rows, columns=["dt", "product", "har", "garch", "fwd"]), sorted(pd.to_datetime(ak["dt"]).unique())


def _skew(trades: pd.DataFrame, mkt: dict) -> pd.DataFrame:
    sells = trades[trades["is_open"] & trades["is_sell"]].copy()
    sells = sells[sells["dt"] <= END]
    futs = mkt["futs"].copy()
    futs["dt"] = pd.to_datetime(futs["dt"]).dt.normalize()
    if "code" not in futs.columns:
        futs["code"] = futs["contract"].map(base.norm_code)
    futs = futs[futs["settl"] > 0].drop_duplicates(["dt", "code"])
    chain = mkt["chain"].copy()
    chain["dt"] = pd.to_datetime(chain["dt"]).dt.normalize()
    chain = chain[(chain["dt"] >= "2026-10-15") & (chain["dt"] <= END) & (chain["settl"] > 0)]
    if chain.empty or "product" not in chain.columns:
        return pd.DataFrame(columns=["dt", "product", "y", "skew"])
    chain["fut_code"] = [base.fut_lookup_keys(p, m)[0] for p, m in zip(chain["product"], chain["month"])]
    chain = chain.merge(futs[["dt", "code", "settl"]].rename(columns={"code": "fut_code", "settl": "fut"}), on=["dt", "fut_code"], how="inner")
    chain["otm"] = np.where(chain["cp"].eq("C"), chain["strike"] / chain["fut"] - 1.0, 1.0 - chain["strike"] / chain["fut"])
    sells["fut_code"] = [base.fut_lookup_keys(p, m)[0] for p, m in zip(sells["product"], sells["month"])]
    known = sells.merge(futs[["dt", "code", "settl"]].rename(columns={"code": "fut_code", "settl": "fut"}), on=["dt", "fut_code"], how="inner")
    known = known[known["fut"].gt(0) & known["strike"].gt(0)]
    known["otm"] = np.where(known["cp"].eq("C"), known["strike"] / known["fut"] - 1.0, 1.0 - known["strike"] / known["fut"])
    known = known[known["otm"].between(0, 0.8)]
    day_otm = known.groupby(["dt", "cp"]).apply(lambda s: _wmed(s["otm"], s["lots"]), include_groups=False).unstack("cp")
    sold_side = set(zip(sells["dt"], sells["product"], sells["cp"]))
    rows = []
    for (dt, cp), sub in chain.groupby(["dt", "cp"]):
        if dt not in day_otm.index or cp not in day_otm.columns or not math.isfinite(day_otm.loc[dt, cp]):
            continue
        target = float(day_otm.loc[dt, cp])
        leg = sub[sub["otm"].between(target - 0.04, target + 0.04)].copy()
        if leg.empty:
            continue
        leg = leg.assign(err=(leg["otm"] - target).abs()).sort_values("err").drop_duplicates("product")
        for r in leg.itertuples(index=False):
            exp = rep.option_expiry(r.product, r.month)
            if exp is None:
                continue
            dte = (exp - pd.Timestamp(dt).date()).days
            if dte <= 1:
                continue
            try:
                sigma = rep._implied_vol(float(r.fut), float(r.strike), dte / 365.0, float(r.settl), cp) * 100.0
            except Exception:
                continue
            rows.append((pd.Timestamp(dt), r.product, int((dt, r.product, cp) in sold_side), sigma))
    w = pd.DataFrame(rows, columns=["dt", "product", "y", "wiv"])
    return w


def _scatter(path: Path, frame: pd.DataFrame, xcol: str, ycol: str, xlabel: str, ylabel: str, legend: str = "upper left") -> int:
    sub = frame.dropna(subset=[xcol, ycol]).copy()
    prof.configure_matplotlib()
    fig, ax = plt.subplots(figsize=(8.2, 3.8))
    if not sub.empty:
        ax.scatter(sub.loc[sub["y"] == 0, xcol], sub.loc[sub["y"] == 0, ycol], s=12, color="#A0AEC0", alpha=0.7, label="当天没卖")
        ax.scatter(sub.loc[sub["y"] == 1, xcol], sub.loc[sub["y"] == 1, ycol], s=28, color=prof.C_NAVY, alpha=0.9, label="他卖开", zorder=3)
        ax.legend(frameon=False, loc=legend)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=140)
    plt.close()
    return int(len(sub))


def _order_chart(path: Path, frame: pd.DataFrame, xcol: str) -> tuple[Path, str]:
    """One row per day he sold in this subset. Names run from the larger gap to the smaller."""
    sub = frame.dropna(subset=[xcol]).copy()
    days = list(sorted(sub.loc[sub["y"] == 1, "dt"].unique()))
    prof.configure_matplotlib()
    fig, ax = plt.subplots(figsize=(8.2, max(2.4, 0.46 * len(days) + 0.8)))
    hits = trials = 0
    widest = 1
    for i, dt in enumerate(days):
        g = sub[sub["dt"] == dt].sort_values(xcol, ascending=False)
        k = int((g["y"] == 1).sum())
        sold = set(g.loc[g["y"] == 1, "product"])
        top = set(g["product"].head(k))
        trials += k
        hits += len(top & sold)
        widest = max(widest, len(g))
        for j, r in enumerate(g.itertuples(index=False)):
            color = prof.C_NAVY if r.y == 1 else "#A0AEC0"
            ax.text(
                j, i, prof.PRODUCT_CN.get(r.product, r.product),
                color=color, fontsize=8, fontweight="bold" if r.y == 1 else "normal",
                ha="center", va="center", **prof.fp(),
            )
    ax.set_yticks(range(len(days)))
    ax.set_yticklabels([pd.Timestamp(d).strftime("%m-%d") for d in days])
    ax.set_xlim(-0.7, widest - 0.3)
    ax.set_ylim(len(days) - 0.5, -0.5)
    ax.set_xticks([])
    ax.set_xlabel("当天差额从高到低，左高右低")
    ax.tick_params(length=0)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=140)
    plt.close()
    print(f"order {path.name} {hits}/{trials}")
    cap = f"每一行是他卖过这一组的一个交易日。名字从左到右按差额从高到低。深蓝是他当天卖开的。这一张按个数打中 {hits}/{trials}。"
    return path, cap


def _pair_chart(path: Path, garch_df: pd.DataFrame, civ: pd.DataFrame, lc_days: list, trade_days: list) -> tuple[Path, str]:
    """One row per day he sold lithium. A point is drawn only when yesterday's ATM exists."""
    civ = civ.copy()
    civ["dt"] = pd.to_datetime(civ["dt"]).dt.normalize()
    iv = {
        (pd.Timestamp(r.dt), str(r.product)): float(r.iv)
        for r in civ.itertuples(index=False)
        if str(r.product) in PAIR and math.isfinite(float(r.iv))
    }
    garch = {
        (pd.Timestamp(r.dt), str(r.product)): float(r.garch)
        for r in garch_df.itertuples(index=False)
        if str(r.product) in PAIR and math.isfinite(float(r.garch))
    }
    trade_days = sorted(pd.Timestamp(d) for d in trade_days)
    rows = []
    for dt in lc_days:
        prevs = [d for d in trade_days if d < dt]
        prev = prevs[-1] if prevs else None
        gaps = {}
        for product in ("LC", "SI"):
            atm = iv.get((prev, product)) if prev is not None else None
            gh = garch.get((dt, product))
            gaps[product] = atm - gh if atm is not None and gh is not None else None
        rows.append((dt, gaps["LC"], gaps["SI"]))
        print(f"pair {pd.Timestamp(dt).date()} prev {None if prev is None else pd.Timestamp(prev).date()} LC {gaps['LC']} SI {gaps['SI']}")
    finite = [v for _dt, lc, si in rows for v in (lc, si) if v is not None]
    left = (min(finite) - 1.5) if finite else 0.0
    prof.configure_matplotlib()
    fig, ax = plt.subplots(figsize=(8.2, max(3.2, 0.46 * len(rows) + 0.9)))
    comparable = higher = 0
    for i, (dt, lc, si) in enumerate(rows):
        if lc is None or si is None:
            ax.text(left, i, "碳酸锂没有前一日平值", color="#A0AEC0", fontsize=8, ha="left", va="center", **prof.fp())
            continue
        comparable += 1
        higher += int(lc > si)
        ax.plot([si, lc], [i, i], color="#CBD5E0", lw=1, zorder=1)
        ax.scatter([si], [i], s=36, color="#A0AEC0", zorder=3)
        ax.scatter([lc], [i], s=36, color=prof.C_NAVY, zorder=3)
        ax.text(si, i + 0.18, "硅", color="#A0AEC0", fontsize=8, ha="center", va="bottom", **prof.fp())
        ax.text(lc, i + 0.18, "锂", color=prof.C_NAVY, fontsize=8, ha="center", va="bottom", **prof.fp())
    if finite:
        ax.set_xlim(left - 0.4, max(finite) + 4)
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels([pd.Timestamp(d).strftime("%m-%d") for d, _lc, _si in rows])
    ax.set_ylim(len(rows) - 0.45, -0.55)
    ax.set_xlabel("前一日平值隐波 − GARCH 预测（个百分点）")
    ax.scatter([], [], s=36, color=prof.C_NAVY, label="他卖开")
    ax.scatter([], [], s=36, color="#A0AEC0", label="当天没卖")
    ax.legend(frameon=False, loc="lower right")
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=140)
    plt.close()
    print(f"pair comparable {comparable} lc_higher {higher} of {len(rows)}")
    cap = (
        f"九行是他卖碳酸锂的 {len(rows)} 个交易日，工业硅这些天都没卖。"
        f"能画两点的是前一个交易日两边都有平值隐波的日子，共 {comparable} 天。"
        "写着「没有前一日平值」的，这条差额算不出来。"
    )
    return path, cap


def _hit_bar(path: Path) -> tuple[Path, str]:
    pick_path = CHART.parent / "pick.json"
    logit = {"hits": 0, "k": 0}
    rnd = 0.1
    if pick_path.exists():
        loaded = json.loads(pick_path.read_text(encoding="utf-8"))
        logit = loaded.get("logit") or logit
        rnd = float((loaded.get("random") or {}).get("mean") or rnd)
    k = int(logit.get("k") or 0)
    labels = ["线性组合", "盲抽平均"]
    vals = [int(logit.get("hits") or 0), k * rnd]
    tags = [f"{int(logit.get('hits') or 0)}/{k}", f"约 {k * rnd:.1f}/{k}" if k else "—"]
    colors = [prof.C_NAVY, "#A0AEC0"]
    prof.configure_matplotlib()
    fig, ax = plt.subplots(figsize=(8.2, 3.2))
    bars = ax.bar(labels, vals, color=colors, width=0.62)
    for bar, tag in zip(bars, tags):
        ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.35, tag, ha="center", va="bottom", fontsize=9, **prof.fp())
    ax.set_ylabel("卖出品种日里打中的个数")
    ax.set_ylim(0, max(vals + [1]) * 1.35)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=140)
    plt.close()
    return path, "三条是全板按当天个数打中的个数。浅灰是同样个数盲抽的平均。"


def build_charts() -> list[list[tuple[Path, str]]]:
    data = pick.load()
    trades = data["raw"]["opt_trades"]
    trades = trades[pd.to_datetime(trades["dt"]) <= END].copy()
    mult = pick.infer_mult(
        data["mkt"]["chain"].merge(data["vol"][["dt", "code", "volume", "amount"]], on=["dt", "code"], how="left")
        if not data["vol"].empty else data["mkt"]["chain"],
        base.multipliers(trades),
    )
    feat, _quotes = pick.build_features(data["mkt"], data["vol"], mult, data["ak"])
    panel = pick.label_panel(feat, trades)
    panel["dt"] = pd.to_datetime(panel["dt"]).dt.normalize()
    lc_days = sorted(pd.to_datetime(
        trades.loc[trades["is_open"] & trades["is_sell"] & trades["product"].eq("LC"), "dt"]
    ).dt.normalize().unique())
    pair_idx = pd.DataFrame([(d, p) for d in lc_days for p in PAIR], columns=["dt", "product"])
    want = pd.concat([panel[["dt", "product"]], pair_idx], ignore_index=True).drop_duplicates()
    extra, trade_days = _forecasts(want)
    panel = panel.merge(extra, on=["dt", "product"], how="left")
    panel["har_gap"] = panel["atm_iv_lag"] - panel["har"]
    panel["garch_gap"] = panel["atm_iv_lag"] - panel["garch"]
    panel["fwd_gap"] = panel["atm_iv_lag"] - panel["fwd"]
    use_cols = [c for c in ("iv_pct_lag", "vrp_lag", "credit_yuan_lag", "fut_vol_lag", "basis_pct_lag", "ret5_lag") if c in panel.columns and panel[c].notna().mean() > 0.45]
    scores, _coef = pick.logit_scores(panel, use_cols)
    panel["logit"] = scores
    wings = _skew(trades, data["mkt"])
    if len(wings):
        atm = panel[["dt", "product", "atm_iv_lag", "basis_pct_lag"]].drop_duplicates(["dt", "product"])
        wings = wings.merge(atm, on=["dt", "product"], how="left")
        wings["skew"] = wings["wiv"] - wings["atm_iv_lag"]
    y_label = "前一日期货曲线的自身历史分位"
    specs = [
        (panel, "vrp_lag", "basis_pct_lag", "前一日：平值隐波 − 20日实现波动（个百分点）", y_label,
         "hyp_vrp.png", "upper left"),
        (panel, "har_gap", "basis_pct_lag", "前一日：平值隐波 − HAR 预测（个百分点）", y_label,
         "hyp_har.png", "upper left"),
        (panel, "fwd_gap", "basis_pct_lag", "前一日平值隐波 − 卖出后 10 日实现波动（个百分点）", y_label,
         "hyp_fwd.png", "upper left"),
        (wings, "skew", "basis_pct_lag", "虚值隐波 − 前一日平值隐波（个百分点）", y_label,
         "hyp_skew.png", "upper left"),
        (panel[panel["product"].isin(METALS)], "garch_gap", "basis_pct_lag", "有色：平值隐波 − GARCH 预测（个百分点）", y_label,
         "hyp_metal.png", "upper left"),
        (panel[panel["product"].isin(AGS)], "garch_gap", "basis_pct_lag", "农产品：平值隐波 − GARCH 预测（个百分点）", y_label,
         "hyp_ags.png", "upper left"),
        (panel, "logit", "basis_pct_lag", "留出当天再训练的线性分数", y_label,
         "hyp_logit.png", "upper right"),
    ]
    scatters = []
    for frame, xcol, ycol, xlabel, ylabel, name, legend in specs:
        path = CHART / name
        n = _scatter(path, frame, xcol, ycol, xlabel, ylabel, legend)
        scatters.append((path, f"每个点是一个品种的一个交易日，共 {n} 个点。深蓝是他卖开的，浅灰是当天没卖的。"))
    STATS["vrp"] = _rank_block(panel, "vrp_lag")
    STATS["har"] = _rank_block(panel, "har_gap")
    STATS["metal"] = _rank_block(panel[panel["product"].isin(METALS)], "garch_gap")
    STATS["ags"] = _rank_block(panel[panel["product"].isin(AGS)], "garch_gap")
    if len(wings) and "skew" in getattr(wings, "columns", []):
        STATS["skew"] = _rank_block(wings, "skew", higher=False)
        STATS["skew_steep"] = _rank_block(wings, "skew", higher=True)
    sell = trades[trades["is_open"] & trades["is_sell"]]
    buckets = rep.sell_buckets(trades)
    STATS["sell_lots"] = float(sell["lots"].sum())
    STATS["sell_days"] = int(pd.to_datetime(sell["dt"]).nunique()) if not sell.empty else 0
    STATS["buckets"] = {k: float(buckets[k]) for k in ("both_only", "both_wing", "one_wing", "one_naked", "one_call", "one_put")}
    metal_order = _order_chart(CHART / "hyp_metal_order.png", panel[panel["product"].isin(METALS)], "garch_gap")
    ag_order = _order_chart(CHART / "hyp_ags_order.png", panel[panel["product"].isin(AGS)], "garch_gap")
    pair = _pair_chart(CHART / "hyp_pair.png", extra, data["mkt"]["civ"], lc_days, trade_days)
    hits = _hit_bar(CHART / "hyp_hits.png")
    (CHART.parent / "window_stats.json").write_text(
        json.dumps(STATS, ensure_ascii=False, indent=2, default=float),
        encoding="utf-8",
    )
    print("STATS", STATS.get("sell_lots"), STATS.get("buckets"), STATS.get("vrp"), STATS.get("har"), STATS.get("metal"))
    # scatters: vrp, har, fwd, skew, metal, ags, logit
    return [
        [scatters[0]],
        [scatters[1]],
        [scatters[2]],
        [scatters[3]],
        [scatters[4], metal_order],
        [pair],
        [scatters[5], ag_order],
        [scatters[6], hits],
    ]


def main() -> None:
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.left_margin = Cm(1.6)
    sec.right_margin = Cm(1.6)
    sec.top_margin = Cm(1.5)
    sec.bottom_margin = Cm(1.5)
    prof.heading.offset = 0
    seq = {"tab": 0, "fig": 0}
    charts = build_charts()

    def add_tab(headers, body, cap: str) -> None:
        prof.add_table(doc, headers, body)
        seq["tab"] += 1
        prof.caption(doc, f"表{seq['tab']}  {cap}")

    prof.para(doc, "内部资料 · 假设检验 · 请勿外传", size=9, color=prof.GOLD, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)
    prof.para(doc, "RX383 假设检验", size=24, bold=True, color=prof.NAVY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    prof.para(doc, "未登记投顾 · 未登记团队", size=12, color=prof.TEXT, align=WD_ALIGN_PARAGRAPH.CENTER)
    prof.para(
        doc,
        f"成交  2026-10-15  ~  {END.date()}      卖开 {STATS.get('sell_lots', 0):.0f} 手      {STATS.get('sell_days', 0)} 个卖出日",
        size=11, color=prof.MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=10,
    )

    prof.heading(doc, "一、这份记录记什么", 1)
    prof.para(
        doc,
        "交易例子、四类结构和 Black-76 的算法在《RX383 交易策略》。这里只记后来逐条跑过的检验。"
        "提出来的做法包括：把平值隐波当成真实密度、支撑和压力、隐波减实现波动、权利金和手续费、日内振幅、行权价是否缺档、"
        "保证金配额、时间衰减、冲高回落、成交量和持仓量、开盘隐波跳升、板块配额、偏斜的历史分位、HAR 和 GARCH、权利金除以保证金。"
        "每一条都放在挂牌品种上重算。每天取出的个数等于他当天卖出的个数，再和同样个数的盲抽比。",
    )
    prof.para(
        doc,
        "下面先写成交里直接数出来的，这些句子不依赖选品种的模型。再写中位上有差、按当天个数去排却接近盲抽的。"
        "最后写同一批数撑不住的说法。这一窗收到 11 月 9 日，5 日、6 日、9 日的成交都算在里面。",
    )

    prof.heading(doc, "二、成交里直接数出来的", 1)
    prof.para(
        doc,
        f"卖开 {STATS.get('sell_lots', 0):.0f} 手分成四块，加总就是这些。"
        f"短宽跨式（两边一起卖，不再买）{STATS.get('buckets', {}).get('both_only', 0):.0f} 手。"
        f"短宽跨式加近买（两边一起卖，再买一翼）{STATS.get('buckets', {}).get('both_wing', 0):.0f} 手。"
        f"比率价差（只卖一边，再买同向）{STATS.get('buckets', {}).get('one_wing', 0):.0f} 手。"
        f"单边卖权（只卖一边，不再买）{STATS.get('buckets', {}).get('one_naked', 0):.0f} 手，"
        f"其中认购 {STATS.get('buckets', {}).get('one_call', 0):.0f} 手、认沽 {STATS.get('buckets', {}).get('one_put', 0):.0f} 手。"
        "买进的行权价都比同边卖出的更靠近期货，买入手数也不超过同边卖出。价格走过卖出行权价以后，空头手数仍然更多，亏损不封顶。",
    )
    prof.para(
        doc,
        "已经在到期日了结的，是 10 月 26 日上期所 11 月期权 117 手空头，16:45 一批买平，权利金为 0；"
        "以及 10 月 23 日大商所 1 手生猪认购，16:44 同样了结。盘中另外买平 33 手。"
        "权利金为 0 的买平共 118 手。能对上期货价的 101 手都停在行权价外侧。另外 17 手是螺纹和橡胶的 11 月合约，期货价对不上，权利金同样是 0。"
        f"卖开 {STATS.get('sell_lots', 0):.0f} 手的期限分位，按这一窗写在《交易策略》。",
    )
    add_tab(
        ["事项", "数", "这数能说的话"],
        [
            ["四块卖开", (
                f"{STATS.get('buckets', {}).get('both_only', 0):.0f} / "
                f"{STATS.get('buckets', {}).get('both_wing', 0):.0f} / "
                f"{STATS.get('buckets', {}).get('one_wing', 0):.0f} / "
                f"{STATS.get('buckets', {}).get('one_naked', 0):.0f}"
            ), "大头是两边一起卖、不再买"],
            ["买进的一翼", "更近，手数不超过卖出", "这一侧的亏损不封顶"],
            ["到期批次", "10-26 共 117 手，10-23 共 1 手", "走到到期日的，在到期日权利金为 0 地了结"],
            ["开仓到到期", "中位 26 天，最短 4 天", "会卖近月，中位仍是二十多天"],
            ["卖开里的近端", "1 天内 0 手，14 天内 130 手", "近端有一截，不是到期当天的卖方"],
            ["认购 / 认沽虚值", "大约 13% / 12%", "卖的是距离"],
            ["绝对 delta", "中位约 0.023", "卖出时离平值远"],
            ["期货", "碳酸锂、生猪，35 手全是卖开", "是加一截空头，两头都没有买回"],
        ],
        "结构和期限。虚值、delta 的口径与《RX383 交易策略》相同。",
    )
    prof.para(
        doc,
        "269 手对得上当天的期权结算价。成交价中位 3.5 个点，结算价中位 2.5 个点。成交价高于结算价的占 76%，手数加权中位高出 1.5 个点，相差不超过 0.5 个点的占 27%。"
        "高出的部分大约是成交价的三分之一。结算价在 1 个点及以下的占 4%。"
        "这 269 手也对得上当天的最高价和最低价。成交价在这一高一低之间的位置，中位是 0.47。落在靠近最高价那五分之一里的占 14%。"
        "212 手还能用开盘价反解隐波。成交隐波减开盘隐波的中位是 0，成交隐波更高的占 33%。",
    )
    prof.para(
        doc,
        "同一笔高出结算价的差，按钟点拆开不一样。上午 11 点前的 54 手，中位高出 7.5 个点，89% 的手数在结算价之上。"
        "下午 13 点及以后的 210 手，中位高出 1.5 个点，73% 在结算价之上。"
        "卖得越早，到结算价之间空出来的时间越长，期权标记掉下去的余地越大。",
    )
    add_tab(
        ["事项", "数", "这数能说的话"],
        [
            ["成交价对结算价", "269 手，76% 更高，中位高出 1.5 点", "收盘标记低于成交价"],
            ["成交价对当日高低", "位置中位 0.47，靠近最高价的占 14%", "不在期权当天的最高价附近"],
            ["成交隐波对开盘隐波", "212 手，中位相差 0，更高的占 33%", "和这张期权的开盘价解出的隐波齐"],
            ["上午的高出", "54 手，中位 7.5 点", "离结算更远的成交，高出更多"],
            ["下午的高出", "210 手，中位 1.5 点", "下午的高出小于上午"],
            ["成交隐波对前一日平值", "319 手，中位高出 7.5 点，至少 8 点的占 49%", "他卖出的这些虚值，高于前一日平值"],
        ],
        "成交价相对当天期权行情。没有买价和卖价，1.5 个点是成交价和结算价的差。",
    )
    prof.para(
        doc,
        f"卖开 {STATS.get('sell_lots', 0):.0f} 手的钟点，按这一窗写在《交易策略》。"
        "手数加权的十分位在 09:16，中位在 13:32，九十分位在 22:04。"
        "两边都卖的 27 个品种日，认购第一笔和认沽第一笔相隔的中位是 88 秒。15 秒以内占 15%，60 秒以内占 44%，九十分位是 82 分钟。"
        "一个品种从当天第一笔到最后一笔，中位跨度 45 分钟。",
    )
    prof.para(
        doc,
        "期权保证金对客户权益，10 月 15 日 24%，10 月 23 日 41%，10 月 26 日到期批次过后 9%，11 月 3 日回到 41%。"
        "10 月 22 日收到 40%，当天又卖开 43 手。10 月 23 日 41%，又卖开 25 手。11 月 2 日 40%，又卖开 25 手。"
        "10 月 16 日只占 24%，当天没有新开。10 月 26 日掉到 9% 是 11 月合约到期把保证金放出来，之后从 10 月 27 日的 20% 用了几个交易日才回到 41%。",
    )
    prof.para(
        doc,
        f"卖开 {STATS.get('sell_lots', 0):.0f} 手的手续费和权利金分位，按这一窗写在《交易策略》。",
    )
    add_tab(
        ["事项", "数", "这数能说的话"],
        [
            ["开盘 15 分钟", "7%", "开盘这一刻不是成交的主体"],
            ["9 点 / 下午 / 夜盘", "27% / 28% / 23%", "三个时段各有一截，中位在 13:32"],
            ["两腿第一笔", "中位相隔 88 秒，九十分位 82 分钟", "常常先后起步，不是每一笔都在十几秒内完成"],
            ["一个品种当天的跨度", "中位 45 分钟", "一笔往往做上一阵"],
            ["保证金路径", "24% → 41% → 9% → 41%", "到期把保证金放出来，再用几个交易日加回去"],
            ["已经到 40% 的日子", "10-22 再开 43 手，10-23 再开 25 手，11-02 再开 25 手", "到了四成附近仍在卖开"],
            ["只用 24% 的日子", "10-16 新开 0 手", "有的日子留着额度不用"],
            ["手续费", "每手中位 1.5 元，权利金十分位 17.5 元", "手续费没有挡掉他卖过的单"],
        ],
        "钟点、两腿间隔和保证金。保证金是持仓表里的期权保证金除以客户权益。",
    )

    prof.heading(doc, "三、中位有差，按当天个数去排却接近盲抽", 1)
    prof.para(
        doc,
        "下面先给一张总表，再按行展开。每一条先写检验怎么定义，再放图，再写这张图能说到哪一步。打中是当天取出和他卖出个数相同的名字，看重合多少。这些差是真的。把它们当成每天的选品种规则，打中的个数仍接近盲抽，或者只在很小的一块里成立。",
    )
    _pick_loaded = json.loads((CHART.parent / "pick.json").read_text(encoding="utf-8")) if (CHART.parent / "pick.json").exists() else {}
    _pick_logit = _pick_loaded.get("logit") or {}
    _pick_rnd = float((_pick_loaded.get("random") or {}).get("mean") or float("nan"))
    add_tab(
        ["比较", "他", "没卖的", "按个数打中", "能说到哪一步"],
        [
            ["平值隐波减 20 日实现波动", f"高出 {STATS.get('vrp', {}).get('his', float('nan')):.1f} 点", f"高出 {STATS.get('vrp', {}).get('oth', float('nan')):.1f} 点", f"{STATS.get('vrp', {}).get('hits', 0)}/{STATS.get('vrp', {}).get('trials', 0)}，盲抽约 {STATS.get('vrp', {}).get('base', float('nan')):.0%}", "中位更高，当天的名单对不上"],
            ["平值隐波减 HAR", f"高出 {STATS.get('har', {}).get('his', float('nan')):.1f} 点", f"高出 {STATS.get('har', {}).get('oth', float('nan')):.1f} 点", f"{STATS.get('har', {}).get('hits', 0)}/{STATS.get('har', {}).get('trials', 0)}，盲抽约 {STATS.get('har', {}).get('base', float('nan')):.0%}", "开盘前能用的预测，同样对不上名单"],
            ["卖出后 10 日的实现波动", "高出 9.3 点", "高出 3.9 点", "事后才有", "卖完之后的差额更大，下单时还没有这个数"],
            ["虚值隐波减前一日平值", "1.7 点", "6.4 点", "从平到陡 9/19，盲抽约 42%", "有结算价的翼里他更平，自己仍有 8 条超过 3 点"],
            ["有色里的 GARCH 差额", f"{STATS.get('metal', {}).get('trials', 0)} 次里 {STATS.get('metal', {}).get('hits', 0)} 次排在前面", f"盲抽约 {STATS.get('metal', {}).get('base', float('nan')):.0%}", f"{STATS.get('metal', {}).get('hits', 0)}/{STATS.get('metal', {}).get('trials', 0)}", "有色这一小块有倾斜，两天把镍和锡排反"],
            ["碳酸锂对工业硅", "只比前一日两边都有平值的日子", "两个名字", "见下图", "没有平值的日子不能算打中"],
            ["农产品里的同一条", "8 次里 1 次", "盲抽约 16%", "1/8", "农产品没有这条倾斜"],
            ["线性组合", f"{_pick_logit.get('hits', 0)}/{_pick_logit.get('k', 0)}", f"随机约 {_pick_rnd:.0%}", f"{_pick_logit.get('hits', 0)}/{_pick_logit.get('k', 0)}", "全板最好的一档仍是十几个里中几个"],
        ],
        "选品种。打中是当天取出和他卖出个数相同的名字，看重合多少。下面八条按这张表的行序展开。",
    )
    blocks = [
        (
            "平值隐波减 20 日实现波动",
            "每个点是一个品种的一个交易日。横轴是前一日平值隐波减去该品种前 20 个交易日收益的年化波动，单位是百分点。这个数开盘前就有。纵轴是前一日期货曲线在自身历史上的分位。深蓝是他当天卖开的，浅灰是当天挂牌、他没卖的。检验是每天按横轴从高到低取出和他当天卖出个数相同的名字，看重合多少。对得上这条差额的卖出品种日有 41 个。",
            f"他的中位高出 {STATS.get('vrp', {}).get('his', float('nan')):.1f} 个点，没卖的高出 {STATS.get('vrp', {}).get('oth', float('nan')):.1f} 个点。深蓝略偏右，灰点从很负铺到很正，两边重叠很大。按个数去取打中 {STATS.get('vrp', {}).get('hits', 0)}/{STATS.get('vrp', {}).get('trials', 0)}，盲抽大约 {STATS.get('vrp', {}).get('base', float('nan')):.0%}。中位更高，当天的名单对不上。",
        ),
        (
            "平值隐波减 HAR",
            "横轴换成 HAR。用截止前一日的日收益、近 5 日和近 22 日的平方收益回归下一日方差，开方后成年化波动，再用前一日平值隐波减去它。开盘前算得出来。纵轴仍是期货曲线分位。取数的方法和上一条一样，每天取差额最大的那些，个数和他当天卖出的一样。",
            f"他高出 {STATS.get('har', {}).get('his', float('nan')):.1f} 个点，没卖的高出 {STATS.get('har', {}).get('oth', float('nan')):.1f} 个点。打中是 {STATS.get('har', {}).get('hits', 0)}/{STATS.get('har', {}).get('trials', 0)}，盲抽大约 {STATS.get('har', {}).get('base', float('nan')):.0%}。换一套开盘前能用的预测，名单还是对不上。",
        ),
        (
            "卖出后 10 日的实现波动",
            [
                "平值隐波是这个品种前一个交易日的平值隐含波动率，写成百分数，18 就是年化 18%。优先用公布的商品期权平值隐波。没有公布数时，用行权价离期货价 4% 以内的合约隐波中位数。这是平值，不是他卖掉的那一档虚值。他成交价反解出来的隐波比平值更高，那一条不在这张图里。",
                "卖出后 10 日实现波动是期货的，不是期权的。从卖出日的下一个交易日算起，取连续合约结算价的日收益，往后最多 10 个，至少要有 5 个。样本标准差乘以根号 252，再写成百分数。卖出当天的涨跌不放进去。行情只用到 11 月 3 日，所以 10 月 28 日以后的卖出，后面凑不满 5 天，不进这张图。",
                "差额是前一日平值隐波减去这段实现波动，单位是百分点。横轴 10 就是平值隐波比后来这 10 天走出的波动高出 10 个百分点。横轴为负，就是后来的波动比平值隐波更高。纵轴仍是前一日期货曲线的分位，只为和前两张图用同一根纵轴，不参与这个差额。",
                "两条波动都有、曲线分位也有的，图上 166 个点：他卖开 23 个，没卖 143 个。不要求曲线分位、只要两条波动都有的，他 26 个，没卖的 279 个。",
            ],
            [
                "这张图的横轴是卖出之后的差额。卖出之前的差额在第一张图，减的是卖出前 20 个交易日的实现波动。两个差额用的是同一个前一日平值隐波。从卖出前到卖出后，平值隐波这个数没有变。变的是减数：前 20 日的实现波动，换成了卖出之后 10 日的实现波动。",
                "能配成对的 26 个卖出品种日，卖出前的差额中位是 4.0 个点，卖出后是 5.3 个点。没卖的从 1.3 个点到 3.5 个点。把每个品种日自己的前 20 日实现波动减去后 10 日实现波动，他大约低 3 个点，没卖的也大约低 3 个点。后来这 10 天，整板都比各自的前 20 天更静，不是他卖的名字单独静下来。早先另一批卖出品种日上，卖出后的中位曾经写成 9.3 对 3.9。那不是这 166 个点的中位。",
                "所以差额变大，是减数变小了，不是平值隐波变大了。没卖的名字也变大了。单看这一张图看不出变大，横轴上没有卖出前的那个数。要和第一张图对着看，或者把两个差额相减，才看得到。",
                "这一张图自己能看的，是深蓝和灰点谁更靠右。图上 23 个深蓝的差额中位是 7.2 个点，143 个灰点是 2.6 个点。这 23 个的平值隐波中位是 21.5%，灰点是 17.4%。后来的实现波动中位是 13.8%，灰点是 14.6%。图上这一截差距，主要是平值隐波更高，后来的波动只低大约 1 个点。把没有曲线分位的点加回来，26 对 279，平值隐波中位是他 18.7%、没卖的 19.2%，后来的实现波动是他 13.3%、没卖的 15.3%，差额中位 5.3 对 3.5。这一组里差额更大，是因为后来的波动更低，不是因为平值隐波更高。两种切法方向不一样，不能收成「他的隐波更高」或「他的波动更低」中的一句。",
                "卖方若在赌波动，赌的是以后走出来的波动低于权利金里的隐波。平值上，差额为正，就是平值隐波高于后来的实现波动。他这 26 个里大约八成是正的，没卖的 279 个里大约七成也是正的。整板大多数名字后来都比平值隐波更静，他只是略多一点。按卖出后的差额从高到低、每天取和他当天卖出个数相同的名字，打中 4/26。按卖出前就有的差额去取，打中 3/34。事后知道这 10 天的结果，也没有把他的名单排出来。",
                "他卖的是虚值。这张图是平值。平值上这几个点的高低，不是他那一档虚值权利金赚没赚到。",
            ],
        ),
        (
            "虚值隐波减前一日平值",
            "只画对得上虚值结算价、又有期货曲线分位的翼。横轴是该翼用结算价反解的隐波，减去前一日平值隐波。纵轴是曲线分位。检验是在这些有价格的翼里，按横轴从平到陡取出和他当天一样多个。",
            "他的中位是 1.7 个点，没卖的是 6.4 个点。从平到陡打中 9/19，盲抽大约 42%。从陡到平打中 7/19，盲抽大约 46%。对得上的有 51 条，他占 19 条。偏斜低于 2 个点的，他占 53%，没卖的占 34%。低于 3 个点的，他占 58%，没卖的占 41%。他自己的 19 条里有 8 条超过 3 个点，玉米、镍、铁矿、豆二都在里面。有结算价的翼里他更平。把「偏斜超过 3 个点就不卖」写成硬门槛，会删掉他自己的这些单。",
        ),
        (
            "有色里的 GARCH 差额",
            "只留铜、铝、锌、镍、锡、铅、氧化铝。差额是前一日平值隐波减去固定参数的 GARCH(1,1)，α 取 0.06，β 取 0.92，方差对准该品种自己的历史。第一张图是这些品种日的散点，纵轴是期货曲线分位，用来看深蓝有没有离开灰点。第二张图只留他卖过有色的交易日，名字从左到右按差额从高到低排。检验是每天只在有色内部，取出和他当天卖出的有色个数相同的名字。",
            f"{STATS.get('metal', {}).get('trials', 0)} 次里 {STATS.get('metal', {}).get('hits', 0)} 次排在前面，盲抽大约 {STATS.get('metal', {}).get('base', float('nan')):.0%}。深蓝多在横轴偏右，灰点并没有让出这一侧。10 月 19 日他卖锡，当天差额更高的是镍。10 月 21 日他卖镍，当天差额更高的是锡。有色这一小块有倾斜，两天把镍和锡排反。",
        ),
        (
            "碳酸锂对工业硅",
            "只留碳酸锂和工业硅。每一行是他卖碳酸锂的一个交易日。两点是前一个交易日的平值隐波减去同一条 GARCH，连线只为看谁更高。前一个交易日没有碳酸锂平值隐波的，这一行不画点。工业硅这些天没有卖开。",
            "他卖碳酸锂的每个交易日都在下图，工业硅这些天没有卖开。能画两点的，才是前一日两边都有平值的日子。写着没有前一日平值的，差额算不出来，不能算进打中。这一组只有两个名字，也不能当成全板的规则。",
        ),
        (
            "农产品里的同一条",
            "只留农产品。差额仍是平值隐波减同一条 GARCH。第一张图是散点，纵轴是期货曲线分位。第二张图是他卖过农产品的每个交易日，名字从左到右按差额从高到低排。检验是每天在农产品内部取出和他当天卖出的农产品个数相同的名字。",
            "8 次里打中 1 次，盲抽大约 16%。深蓝没有站到横轴的右侧。农产品没有这条倾斜。",
        ),
        (
            "线性组合、曲线年化和树",
            "第一张图的横轴是留出当天、用其余日子重新训练的线性分数。用到前一日隐波分位、隐波减实现波动、权利金、期货成交量、曲线分位和 5 日涨跌。分数越高，越像当天会卖的名字。纵轴是期货曲线分位。第二张图是这一窗重新打出来的线性组合，旁边是同样个数的盲抽。深度为 2 的树没有在拉长后的这一窗上重训。每天取出的个数和他当天卖出的一样。",
            f"线性组合打中 {_pick_logit.get('hits', 0)}/{_pick_logit.get('k', 0)}，随机大约 {_pick_rnd:.0%}。深蓝略偏右，和灰点重叠很大。全板最好的一档仍是十几个里中几个。深度为 2 的树没有在拉长后的这一窗上重训。",
        ),
    ]
    for (title, definition, conclusion), pics in zip(blocks, charts):
        prof.heading(doc, title, 2)
        for text in (definition if isinstance(definition, list) else [definition]):
            prof.para(doc, text)
        for path, cap in pics:
            if path.is_file():
                doc.add_picture(str(path), width=Inches(6.3))
                doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
                seq["fig"] += 1
                prof.caption(doc, f"图{seq['fig']}  {cap}")
        for text in (conclusion if isinstance(conclusion, list) else [conclusion]):
            prof.para(doc, text)
    prof.para(
        doc,
        "12 个卖出日的板块个数不齐。黑色一天 0 到 2 个，有色 0 到 3 个，农产品 0 到 3 个，化工 0 到 2 个，碳酸锂那一组 0 到 1 个。"
        "10 月 15 日是农产品 2 个、化工 2 个、有色 3 个、黑色 1 个。10 月 20 日只有锡。11 月 3 日只有碳酸锂。"
        "黑色用同一条 GARCH 差额排，6 次里打中 3 次，盲抽大约 33%。"
        "碳酸锂、镍、锡、铜，他卖的日子和没卖的日子，近月对次近月的价差中位大约差 0.1 个百分点。持仓量在两边都下降。",
    )
    prof.para(
        doc,
        "期货价和平值隐波都对得上的卖开有 319 手。成交价反解的隐波中位约 25%，当天平值隐波中位约 17%，高出约 8 个点。"
        "用平值隐波算出的实值概率中位约 0.2%，成交价里的实值概率中位约 3.9%。这 319 手里约 303 手是前者更低。"
        "把「平值隐波下，13% 认购和 12% 认沽的实值概率都低于 5%」套到 12 个卖出日，有 331 个品种日，他卖了 24 个，放过 307 个。打中 7.3%，这些品种日里他卖出的底子是 6.2%。"
        "改用他当天自己的距离，认购中位 13.2%、认沽 11.3%，还有 300 个品种日两边都低于 5%，他卖了 20 个，放过 280 个。",
    )
    prof.para(
        doc,
        "能按当天距离对上结算价的只有 70 条、17 个品种。他卖的那些每手中位 130 元，没卖的中位 45 元。"
        "没卖的里面焦炭大约 1,530 元、橡胶大约 1,930 元。镍、锡、铅、螺纹在他没卖的日子，同样距离的结算价只有几元。"
        "能估出权利金和一份卖方保证金的翼有 58 条，他卖了 23 条。保证金按权利金加上期货名义价值的大约 10%，再扣掉虚值额的一半。"
        "权利金除以保证金，他的中位是 1.1%，没卖的中位是 3.1%。按这个比例从高到低打中 9/23，盲抽大约 45%。"
        "从占保证金 0.5% 到 8%，每一档门槛留下来的没卖品种都多于他卖的。",
    )
    prof.para(
        doc,
        "能按当天距离对上结算价的翼另有 69 条，他卖了 23 条。权利金一天衰减掉的比例，他的中位高于没卖的。"
        "按这个比例从高到低打中 13/23。按剩余天数从短到长打中 12/23。这 69 条里盲抽大约是 39%。"
        "卖开里，14 天以内的 101 手一天衰减的中位是 35%，40 天以上的 246 手是 3.8%。衰减比例高的，就是剩下天数短的。",
    )

    prof.heading(doc, "四、同一批数撑不住的说法", 1)
    add_tab(
        ["说法", "跑出来的数"],
        [
            ["每天按振幅大的卖", "他 2.2%，没卖的 2.0%。打中 6/51，盲抽约 8%"],
            ["卖认购的日子收在低位，卖认沽的日子收在高位", "认购打中 1/40。只卖认沽的 11 天，探底回升打中 0"],
            ["专挑成交量最大的，或专挑最小的", "期权成交量打中 8/24，盲抽约 37%。期货成交量下四分位以下仍有 487 个没卖的"],
            ["权利金相对保证金越高越卖", "他 1.1%，没卖的 3.1%。打中 9/23，盲抽约 45%"],
            ["保证金到 40% 就停", "10-22、10-23、11-02 到了 40% 附近仍卖开 43、25、25 手"],
            ["每天把额度用满", "10-16 只用 24%，新开 0 手"],
            ["每天固定几个板块", "一天里黑色 0 到 2 个，有色 0 到 3 个。10-20 只有锡，11-03 只有碳酸锂"],
            ["只在开盘 15 分钟做", "这 15 分钟占 7%"],
            ["只在下午做，并在最高价附近卖", "下午占 28%。成交在当日高低之间的位置是 0.47"],
            ["到期当天或隔一天的卖方", "1 天内 0 手，4 天内 4 手"],
            ["行权价靠近此前的摆动点", "他的中位 5.1%。同一合约其他虚值行权价的中位 2.5%"],
            ["库里没有 13% 那一档，所以不卖锰硅、纯碱", "10-27 螺纹 2701 认购只入库四档。这张表不是交易所挂牌表"],
        ],
        "提出来之后对不上的做法。振幅用的是连续合约 870 个品种日里他卖出的 51 个。",
    )
    prof.para(
        doc,
        "支撑和压力用开仓前已经走出来的该合约日线。622 手里，行权价离最近同向摆动点的中位是 5.1%，落在 2% 以内的占 30%。"
        "同一合约上虚值 5% 到 25% 的其他行权价，离摆动点的中位是 2.5%，2% 以内占 42%。"
        "把 13% 认购和 12% 认沽套到有日线的品种上，386 个品种日里他卖了 37 个。落在摆动点 2% 以内的，卖的是 19%，没卖的是 21%。",
    )
    prof.para(
        doc,
        "有期权成交量的品种日只有 100 个，他占 24 个。这一窗没有买卖价差。"
        "期货成交量低于他卖出品种日的下四分位、大约 15 万手的，他自己有 13 个品种日，没卖的有 332 个。"
        "库里的分钟线只有 50、300、500 的 ETF 和股指期权，从 10 月 23 日才有，盖不住这些商品合约。13:30 的期货价对不上结算价，因为没有这批商品的分钟线。",
    )

    prof.heading(doc, "五、这窗还量不到的", 1)
    prof.para(
        doc,
        "商品期权没有逐笔盘口，也没有买一卖一。行权价上的隐波字段在这一窗是空的，虚值隐波是用结算价或成交价反解的，而且只在有价格的那些合约上。"
        "有结算价的日子从 8 月 3 日到 11 月 3 日共 33 天，不是每个交易日，也不是同一批行权价，排不出过去 20 天的偏斜分位。"
        "每天入库的行权价常常只有两三条，回答不了交易所有没有挂出 13% 那一档。",
    )
    prof.para(
        doc,
        "12 个卖出日、对得上预测的 41 个卖出品种日，不够把某一天他按下的名字收成一条稳定的规则。"
        "有色 12/15，平值隐波高出已实现波动的那几个点，是这批检验里还站着的倾斜。它们都还没有变成「当天该卖哪几个」的名单。"
        "有色这一条把五个没卖的交易日补回去，并且不再借用他当天的个数，写在第六部分。"
        "碳酸锂他卖了 9 天、工业硅没卖，但前一日平值两边都在的只有 3 天。",
    )

    prof.heading(doc, "六、有色：哪一天做、做几个、为什么放过第一名", 1)
    prof.para(
        doc,
        "上面那张有色排序只留了他卖过有色的 9 天，而且每一天取出的个数就是他当天卖出的个数。天数和个数都是他做完之后才知道的。这里把 10 月 15 日到 11 月 3 日的 14 个交易日都放回来，七个名字每天都在。差额仍是前一个交易日的平值隐波减去同一条 GARCH，α 取 0.06，β 取 0.92。前一个交易日没有平值的，这个名字留空，不拿更早的数来补。规则开盘前只能看见差额。",
    )
    metal14 = CHART / "hyp_metal_14d.png"
    if metal14.is_file():
        doc.add_picture(str(metal14), width=Inches(6.3))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
        seq["fig"] += 1
        prof.caption(doc, f"图{seq['fig']}  十四个交易日都在。名字从左到右按差额从高到低。深蓝是他当天卖开的。10 月 16 日、23 日、26 日和 11 月 2 日、3 日他没有卖有色。")
    add_tab(
        ["规则", "借用他的个数", "天数对上", "名字打中", "开出几个", "个数平均差"],
        [
            ["按他当天的个数取前面的", "用。歇着的日子个数是 0", "14/14，其中 5 天两边都空", "12/15", "15", "0"],
            ["差额满 4 个点就卖", "不用", "9/14", "15/15", "46", "2.2"],
            ["只卖差额最大的一个", "不用", "9/14", "6/15", "14", "0.8"],
            ["最大的那个，再带落后 2 个点以内的", "不用", "9/14", "13/15", "31", "1.3"],
        ],
        "有色七个名字、14 个交易日。天数对上 9/14，和「猜他每天都做」是同一个数。同样个数到七个名字里去盲抽，只卖第一名大约中 2 个，落后 2 个点那条大约中 5 个。",
    )
    prof.para(
        doc,
        "天数对不上。他做有色的 9 天，当天最高的差额从 5.0 到 8.9，中位 7.3。没做的 5 天是 7.5、11.1、4.9、8.6、10.6，中位 8.6。歇着的日子差额更高。门槛从 0 收到 9，没有一档的天数对上超过 9/14，而 9/14 就是猜他每天都做。10 月 16 日整户没有新开，10 月 26 日是上期所到期、卖开也是 0。这两天拿掉，还剩 10 月 23 日、11 月 2 日、11 月 3 日。这三天他在卖别的品种，镍或锡的差额却是这窗里最高的一截：23 日镍 11.1，排在全板第四；3 日锡 10.6、铜 9.8。反过来，10 月 20 日锡 8.9，前面还有四个差额更高的品种，他一个没卖，只卖了锡。差额的高低没有把「做不做有色」分开。",
    )
    prof.para(
        doc,
        "个数也定不住。这 9 天他卖 1 个、2 个或 3 个。差额满 4 个点，他的 15 个名字都留得下，同时开出 46 个，一天平均多 2.2 个。只拿第一名，15 个里中 6 个，盲抽大约中 2 个，方向对，个数比他少。第一名再带上落后 2 个点以内的，中 13 个，盲抽大约中 5 个，可是开出 31 个，一天平均多 1.3 个。多出来的，一部分是他没拿的那个镍或锡，一部分是他整天没做有色的那 5 天。旧的 12/15 把取出的个数设成他当天的个数，所以个数差是 0。那一列是照他的单子填的。",
    )
    prof.para(
        doc,
        "放过第一名，这条差额也说不出来。15 个卖出品种日都落在当天从左数的前四名里，铝、锌、氧化铝一次都没有。前四名比「取和他个数相同的前几名」松，跳过第一名的那几天就被含进去了，名单也宽了。10 月 19 日镍 7.2、锡 5.9，他卖锡。10 月 21 日锡 7.3、镍 6.5，他卖镍。10 月 27 日锡 8.3 最高，他卖的是镍 8.1、铜 6.1、铅 5.7。10 月 20 日锡只比镍高 0.7，他又只卖锡，没有两个都卖。只在镍和锡里挑一个的有 8 天，差额更高的那个他对上 5 天。换成差额比前一天升了还是降了，对上的还是这 5 天，错的还是 19 日、21 日和 27 日。",
    )
    prof.para(
        doc,
        "这条差额能把七个名字从高到低排开，他卖的 15 个都在左半边。它定不了他哪天做有色，定不了做 1 个还是 3 个，也定不了镍和锡里拿哪一个。不拿他当天的个数来补，开出来的名单比他的宽。"
        "把空头和连续卖了几天补进去，开盘前可以给一份名单。那份模型在第七部分。",
    )

    prof.heading(doc, "七、有色开仓模型", 1)
    prof.para(
        doc,
        "模型在开盘前只用两样东西。差额仍是前一个交易日的平值隐波减去同一条 GARCH，α 取 0.06，β 取 0.92。空头用他的成交回推，卖开加上，买平减去，从 10 月 15 日开盘的空仓算起。持仓表这一窗不是全本，不拿来当输入。名单按下边的顺序定，不再借用他当天卖了几个。",
    )
    prof.para(
        doc,
        "第一，今天是 10 月 26 日上期所到期，或者这个本子已经连续卖了 4 个交易日，今天有色不开。连续 4 天这条一旦碰上，本子没有回到空仓就一直关着。10 月 26 日的买平把 11 月合约清掉，27 日开盘本子是空的，模型重新开。",
    )
    prof.para(
        doc,
        "第二，本子是空的。差额达到 4.5 个点、并且离当天最高不超过 3 个点的名字，全部卖。",
    )
    prof.para(
        doc,
        "第三，本子不是空的，最高的那个比第二名高出 1.5 个点及以上。只卖最高的那个。它的空头已经到 40 手，这个也不卖。",
    )
    prof.para(
        doc,
        "第四，剩下的日子。在第二步那个范围里，卖空头最少的一个。昨天卖过、空头还不超过 10 手、差额仍在这个范围里的，再加一个。",
    )
    import _rx383_metal_predict as metal_model
    import _rx383_metal_quote as metal_quote
    _metal_frame = metal_model.mm.build()[0]
    _metal_out = metal_model.run(_metal_frame, metal_model.tape())
    add_tab(
        ["日期", "开盘时空头", "模型开的", "他开的"],
        metal_model.table_rows(_metal_out),
        "有色开仓模型。空头是开盘前由成交回推的手数。14 天里做不做有色对上 13 天。他的 15 个名字中 13 个，模型另外多开了 4 个。",
    )
    prof.para(
        doc,
        "14 天里有 10 天名单和他的一致，包括 10 月 23 日、26 日和 11 月 2 日、3 日的不开。对不上的是 4 天。10 月 16 日模型开镍和锡，他整天没有新开，开盘前的空头和 19 日是同一本。10 月 20 日锡的空头 21 手、镍 10 手，差额锡 8.87、镍 8.25，模型卖空头少的镍，他卖了锡。10 月 27 日本子是空的，模型把锡、镍、铜、铅都开了，他没卖锡。10 月 28 日镍的差额是 4.46，低过 4.5，模型只留铜；他当天镍也卖了。15 日他没卖的铅是 4.44，和 4.46 挨在一起，同一条 4.5 的线保不住一个又丢掉另一个。",
    )
    prof.para(
        doc,
        "4.5、3、1.5、10 手、40 手、连续 4 天，都是按这 14 天定的。10 月 30 日锡比铜高出 2.02，1.5 这条还盖得住；换成比 2.02 更高的线，30 日就会把铜也开出来。连续 4 天是前一段 19 日到 22 日的长度，用到后一段就把 11 月 2 日和 3 日关掉。这是这一窗的模型，不是拿到窗外汇上的规则。"
        "名字定了以后开哪张合约、权利金写多少，在第八部分。",
    )

    prof.heading(doc, "八、有色开哪张合约、权利金写多少", 1)
    prof.para(
        doc,
        "合约在开盘前用前一个交易日的期货结算价。月份取期权到期日还差至少 4 个日历日的最近月份。铜的 2611 到期日是 10 月 26 日，所以 22 日及以前开 2611，27 日起开 2612。认购行权价取期货上方 10%，认沽取下方 14%，再靠到交易所的行权价间距：铜、镍 2000，锡 5000，铅 200。10% 和 14% 是他这 27 条成交虚值程度的中位，认购大约 10.5 个点、认沽大约 14 个点，取成整数。模型每次认购和认沽都开一张。他一个品种一天常常不止一个行权价，模型只给一个。",
    )
    add_tab(
        ["日期", "品种", "模型认购", "他的认购（成交价）", "模型认沽", "他的认沽（成交价）"],
        metal_quote.compare_rows(_metal_frame),
        "有色卖开的合约。模型行权价是开盘前按前一日期货算的。成交价是他当天该行权价的手数加权均价，括号里是点数。",
    )
    prof.para(
        doc,
        "月份 27 条全部对上。行权价正好对上 6 条，落在相邻一档里的 12 条，虚值程度的中位偏差是 3.6 个点。他 15 个品种日里 9 个两边都卖了，6 个只卖了一边，模型这 6 天多开了那一边。",
    )
    prof.para(
        doc,
        "权利金用 Black-76，利率为零，波动率用前一个交易日的平值隐波，期货用前一个交易日的结算价，算在他实际卖掉的那个行权价上。库里的期权结算价这一窗常常是空的，或者是 2 个点这种对不上成交价的数，不用。",
    )
    prof.para(
        doc,
        "12 月合约还剩 25 到 28 天的那 8 条认购，成交价除以这个价依次是 1.88、0.56、1.11、2.46、1.05、1.12、1.30、0.40，中位 1.12。镍 28 日的 1.05、铅 27 日的 1.11、锡 29 日两条 1.12 和 1.30 挨得近。铜 28 日是 2.46，锡 30 日是 0.40。同一条平值隐波算认沽，价低了好几倍。这 7 条认沽的成交隐波比前一日平值高 2 到 23 个点，中位高 10 个点。11 月合约只剩 4 到 11 天的 12 条，平值隐波算出来的价常常接近 0，他的成交价还在几十个点，成交隐波比平值的中位高 9 个点。到期前两周的权利金，这条平值隐波定不住。"
        "同一套规则拿到 11 月 3 日到 9 日，在第九部分。",
    )

    prof.heading(doc, "九、11月3日到9日，模型开什么、他做了什么", 1)
    prof.para(
        doc,
        "还是前面那套规则，开盘前只用差额和由成交回推的空头。4.5、1.5、10 手、40 手和连续 4 天是按 10 月 15 日到 11 月 3 日读的，4 日到 9 日没有拿来重定。这些天的卖开已经算进前面的手数。模型不开的日子没有合约，也没有权利金。",
    )
    import _rx383_forward_nov as forward_nov
    add_tab(
        ["日期", "开盘时空头", "模型", "他的有色卖开", "他的卖开"],
        forward_nov.holdout_rows(),
        "11月3日到9日。空头是开盘前的手数。模型一列是有色名单。他的卖开含非有色，成交价是点数。门槛没有按这几天重定。",
    )
    prof.para(
        doc,
        "五天开盘前的空头，3 日到 6 日都是铜 1、镍 8、锡 13、铅 20。6 日他卖开铜 3 手、锡 1 手，9 日开盘变成铜 4、镍 8、锡 14、铅 20。10 月 27 日到 30 日连续卖了 4 天有色，这条从 11 月 2 日起关着，本子没有回到空仓，所以这五天模型都是不开。",
    )
    prof.para(
        doc,
        "3 日、4 日、5 日、9 日他没有有色卖开，和模型一致。3 日他卖开碳酸锂 2701 认购 120000 两手，成交价 670。4 日交易所有行情，这个账户没有期权成交，也没有期货成交，结算日报没有这一天。5 日卖开碳酸锂 2701 认购 120000 五手 550、认沽 72000 三手 680、认沽 80000 两手 1850，同一天买平认沽 72000 三手，成交价 430。9 日只卖开生猪 2701 认沽 8800 三手 190。有色模型不预测碳酸锂和生猪。",
    )
    prof.para(
        doc,
        "对不上的是 6 日。模型不开，他卖开锡 2612 认沽 285000 一手 1972、铜 2612 认沽 90000 三手 171，同一天还卖了碳酸锂和生猪。差额并不低：锡是最高的，3 日 10.6、4 日 13.3、5 日 14.5、6 日 14.8、9 日 19.3，铜 3 日 9.8、4 日 10.3、5 日 13.0、6 日 13.3、9 日 14.9，都高于他做过有色那些天的最高差额。模型不是因为差额不够才停，是连续 4 天这条还关着。这五天做不做有色对上 4 天；他这两天以外没有有色卖开，6 日这两个名字模型一个也没开。门槛没有按这几天重定。周末没有成交。",
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT)
    print(f"SAVED {OUT}")


if __name__ == "__main__":
    main()
