# -*- coding: utf-8 -*-
"""Does prior-ATM minus GARCH decide his nonferrous day, his count, and a skipped leader?

The published 12/15 strip drops days he sold nothing in the group and, on the
days it keeps, takes exactly as many names as he sold. Neither input is available
before he trades. This script scores rules that do not use those inputs.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_hypothesis_record as hyp  # noqa: E402
import _rx383_option_strategy_report as base  # noqa: E402
import _rx383_pick_model as pick  # noqa: E402

METALS = ["CU", "AL", "ZN", "NI", "SN", "PB", "AO"]
START = pd.Timestamp("2026-10-15")
END = pd.Timestamp("2026-11-03")
CHART = Path("reports/_rx383_option_strategy/charts/hyp_metal_14d.png")


def _load():
    data = pick.load()
    trades = data["raw"]["opt_trades"]
    trades = trades[pd.to_datetime(trades["dt"]) <= END].copy()
    trades["dt"] = pd.to_datetime(trades["dt"]).dt.normalize()
    chain = data["mkt"]["chain"]
    if not data["vol"].empty:
        chain = chain.merge(data["vol"][["dt", "code", "volume", "amount"]], on=["dt", "code"], how="left")
    mult = pick.infer_mult(chain, base.multipliers(trades))
    feat, _q = pick.build_features(data["mkt"], data["vol"], mult, data["ak"])
    feat["dt"] = pd.to_datetime(feat["dt"]).dt.normalize()
    ak = data["ak"].copy()
    ak["dt"] = pd.to_datetime(ak["dt"]).dt.normalize()
    return feat, trades, ak


def _calendar(ak: pd.DataFrame, feat: pd.DataFrame) -> list[pd.Timestamp]:
    days = set(pd.to_datetime(ak["dt"]).dt.normalize())
    days |= set(pd.to_datetime(feat["dt"]).dt.normalize())
    return sorted(d for d in days if d <= END)


def _prev_print(feat: pd.DataFrame, cal: list[pd.Timestamp], days: list[pd.Timestamp], col: str) -> pd.DataFrame:
    """Value from the previous trading day. A missing session stays missing."""
    hist = feat[["dt", "product", col]].dropna(subset=[col]).drop_duplicates(["dt", "product"])
    lookup = {(pd.Timestamp(r.dt), str(r.product)): float(getattr(r, col)) for r in hist.itertuples(index=False)}
    prev = {cal[i]: cal[i - 1] for i in range(1, len(cal))}
    rows = []
    products = sorted(set(hist["product"].astype(str)) | set(METALS))
    for d in days:
        src = prev.get(d)
        for p in products:
            rows.append((d, p, lookup.get((src, p), np.nan) if src is not None else np.nan))
    return pd.DataFrame(rows, columns=["dt", "product", col + "_prev", ])


def build() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    feat, trades, ak = _load()
    cal = _calendar(ak, feat)
    days = [d for d in cal if START <= d <= END]
    products = sorted(set(feat.loc[feat["dt"].between(START - pd.Timedelta(days=10), END), "product"].astype(str)) | set(METALS))
    grid = pd.DataFrame([(d, p) for d in days for p in products], columns=["dt", "product"])
    extra, _td = hyp._forecasts(grid)
    extra["dt"] = pd.to_datetime(extra["dt"]).dt.normalize()
    atm = _prev_print(feat, cal, days, "atm_iv")
    credit_col = "credit_yuan" if "credit_yuan" in feat.columns else None
    out = grid.merge(extra[["dt", "product", "garch"]], on=["dt", "product"], how="left")
    out = out.merge(atm, on=["dt", "product"], how="left")
    if credit_col:
        out = out.merge(_prev_print(feat, cal, days, "credit_yuan"), on=["dt", "product"], how="left")
    out["gap"] = out["atm_iv_prev"] - out["garch"]
    out = out.sort_values(["product", "dt"])
    out["gap_prev"] = out.groupby("product")["gap"].shift(1)
    out["gap_chg"] = out["gap"] - out["gap_prev"]
    sells = trades[trades["is_open"] & trades["is_sell"]].copy()
    sold = sells.groupby(["dt", "product"], as_index=False).agg(lots=("lots", "sum"), months=("month", lambda s: ",".join(sorted(set(s.astype(str))))))
    out = out.merge(sold, on=["dt", "product"], how="left")
    out["lots"] = out["lots"].fillna(0.0)
    out["y"] = (out["lots"] > 0).astype(int)
    out["sector"] = out["product"].map(lambda p: pick.SECTOR.get(p, "其他"))
    metal = out[out["product"].isin(METALS)].copy()
    return metal, out, sells


def _fmt(v: float) -> str:
    return "  na" if not math.isfinite(v) else f"{v:5.1f}"


def _print_grid(metal: pd.DataFrame, sells: pd.DataFrame) -> None:
    print("METAL GRID  gap = previous session ATM - GARCH    * = sold open")
    for dt, g in metal.groupby("dt"):
        g = g.sort_values("gap", ascending=False, na_position="last")
        bits = []
        for r in g.itertuples(index=False):
            mark = "*" if r.y else " "
            bits.append(f"{mark}{r.product}{_fmt(r.gap)}")
        others = sells[(sells["dt"] == dt) & ~sells["product"].isin(METALS)]
        oth = ",".join(f"{p}{int(n)}" for p, n in others.groupby("product")["lots"].sum().items()) or "-"
        sold = ",".join(f"{r.product}{int(r.lots)}" for r in g.itertuples(index=False) if r.y) or "-"
        print(pd.Timestamp(dt).strftime("%m-%d"), "metal", sold, "other", oth)
        print("   ", " ".join(bits))


def _print_board(full: pd.DataFrame) -> None:
    print("\nFULL BOARD top of the gap, each day")
    for dt, g in full.groupby("dt"):
        known = g.dropna(subset=["gap"]).sort_values("gap", ascending=False)
        metal_max = g.loc[g["product"].isin(METALS), "gap"].max()
        bits = []
        for r in known.head(8).itertuples(index=False):
            mark = "*" if r.y else " "
            tag = "M" if r.product in METALS else r.sector[:1]
            bits.append(f"{mark}{r.product}{tag}{_fmt(r.gap)}")
        his = g[g["y"] == 1].sort_values("gap", ascending=False)
        his_bits = ",".join(f"{r.product}{_fmt(r.gap).strip()}" for r in his.itertuples(index=False)) or "-"
        print(pd.Timestamp(dt).strftime("%m-%d"), f"metal_max{_fmt(metal_max)}", "his", his_bits)
        print("   ", " ".join(bits))


def _print_pair(metal: pd.DataFrame) -> None:
    print("\nNI vs SN on days he sold at least one of them")
    sub = metal[metal["product"].isin(["NI", "SN"])]
    for dt, g in sub.groupby("dt"):
        if int(g["y"].sum()) == 0:
            continue
        ni = g[g["product"] == "NI"].iloc[0]
        sn = g[g["product"] == "SN"].iloc[0]
        credit = ""
        if "credit_yuan_prev" in g.columns:
            credit = f"  credit NI {_fmt(ni.credit_yuan_prev)} SN {_fmt(sn.credit_yuan_prev)}"
        print(
            pd.Timestamp(dt).strftime("%m-%d"),
            f"NI gap{_fmt(ni.gap)} chg{_fmt(ni.gap_chg)} sold {int(ni.y)}",
            f"SN gap{_fmt(sn.gap)} chg{_fmt(sn.gap_chg)} sold {int(sn.y)}",
            credit,
        )


def _score(frame: pd.DataFrame, take: pd.Series) -> dict:
    m = frame[["dt", "product", "y", "gap"]].copy()
    m["take"] = take.reindex(m.index).fillna(0).astype(int).to_numpy()
    day_hit = name_hit = name_pred = his = 0
    count_err = 0.0
    n = 0
    for _dt, g in m.groupby("dt"):
        n += 1
        y = set(g.loc[g["y"] == 1, "product"])
        p = set(g.loc[g["take"] == 1, "product"])
        day_hit += int(bool(y) == bool(p))
        name_hit += len(y & p)
        name_pred += len(p)
        his += len(y)
        count_err += abs(len(y) - len(p))
    return {
        "days": n,
        "day_hit": day_hit,
        "hits": name_hit,
        "his": his,
        "pred": name_pred,
        "count_mae": count_err / n if n else float("nan"),
    }


def _apply_threshold(frame: pd.DataFrame, t: float) -> pd.Series:
    return (frame["gap"] >= t).astype(int)


def _apply_cluster(frame: pd.DataFrame, floor: float, band: float) -> pd.Series:
    take = pd.Series(0, index=frame.index)
    for _dt, idx in frame.groupby("dt").groups.items():
        g = frame.loc[idx]
        known = g["gap"].dropna()
        if known.empty or float(known.max()) < floor:
            continue
        lead = float(known.max())
        take.loc[idx] = ((g["gap"] >= lead - band) & (g["gap"] >= floor)).astype(int)
    return take


def _apply_topk_fixed(frame: pd.DataFrame, k: int, floor: float) -> pd.Series:
    take = pd.Series(0, index=frame.index)
    for _dt, idx in frame.groupby("dt").groups.items():
        g = frame.loc[idx].dropna(subset=["gap"]).sort_values("gap", ascending=False)
        if g.empty or float(g["gap"].iloc[0]) < floor:
            continue
        take.loc[g.index[:k]] = 1
    return take


def _apply_old(frame: pd.DataFrame) -> pd.Series:
    take = pd.Series(0, index=frame.index)
    for _dt, idx in frame.groupby("dt").groups.items():
        g = frame.loc[idx]
        k = int(g["y"].sum())
        ranked = g.dropna(subset=["gap"]).sort_values("gap", ascending=False)
        take.loc[ranked.index[:k]] = 1
    return take


def _print_rules(metal: pd.DataFrame) -> None:
    print("\nOLD top-k uses his count. Quiet days contribute a free day-hit when both sides are empty.")
    print(_score(metal, _apply_old(metal)))
    print("\nTHRESHOLD take every metal with gap >= T")
    for t in (0, 2, 4, 5, 6, 7, 8, 9):
        s = _score(metal, _apply_threshold(metal, float(t)))
        print(f"T={t:4.0f}  day {s['day_hit']:2d}/{s['days']}  names {s['hits']:2d}/{s['his']}  pred {s['pred']:2d}  mae {s['count_mae']:.2f}")
    print("\nLEADER ONLY if the leader clears the floor, else sit out")
    for floor in (0, 4, 6, 8):
        s = _score(metal, _apply_topk_fixed(metal, 1, float(floor)))
        print(f"floor={floor:4.0f}  day {s['day_hit']:2d}/{s['days']}  names {s['hits']:2d}/{s['his']}  pred {s['pred']:2d}  mae {s['count_mae']:.2f}")
    print("\nCLUSTER leader clears the floor, then everyone within band")
    for floor in (0, 4, 6):
        for band in (1, 2, 3):
            s = _score(metal, _apply_cluster(metal, float(floor), float(band)))
            print(f"floor={floor:4.0f} band={band:.0f}  day {s['day_hit']:2d}/{s['days']}  names {s['hits']:2d}/{s['his']}  pred {s['pred']:2d}  mae {s['count_mae']:.2f}")


def _null(metal: pd.DataFrame, take: pd.Series, draws: int = 2000) -> None:
    """Same predicted count each day, names drawn from the seven."""
    rng = np.random.default_rng(7)
    m = metal[["dt", "product", "y"]].copy()
    m["take"] = take.reindex(m.index).fillna(0).astype(int).to_numpy()
    hits = []
    day_hits = []
    for _ in range(draws):
        h = d = 0
        for _dt, g in m.groupby("dt"):
            k = int(g["take"].sum())
            y = set(g.loc[g["y"] == 1, "product"])
            pick_i = set(rng.choice(g["product"].to_numpy(), size=k, replace=False)) if k else set()
            h += len(y & pick_i)
            d += int(bool(y) == bool(pick_i))
        hits.append(h)
        day_hits.append(d)
    s = _score(metal, take)
    print(
        f"null same-count random  name hits mean {np.mean(hits):.1f}  "
        f"day hits mean {np.mean(day_hits):.1f}   rule names {s['hits']} days {s['day_hit']}"
    )


def _chart(metal: pd.DataFrame) -> None:
    import matplotlib.pyplot as plt
    prof = hyp.prof
    prof.configure_matplotlib()
    days = list(sorted(metal["dt"].unique()))
    fig, ax = plt.subplots(figsize=(8.2, max(2.8, 0.42 * len(days) + 0.8)))
    widest = 1
    for i, dt in enumerate(days):
        g = metal[metal["dt"] == dt].dropna(subset=["gap"]).sort_values("gap", ascending=False)
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
    ax.set_xlim(-0.7, max(widest - 0.3, 6.3))
    ax.set_ylim(len(days) - 0.5, -0.5)
    ax.set_xticks([])
    ax.set_xlabel("当天差额从高到低，左高右低。没卖有色的日子也留在图里")
    ax.tick_params(length=0)
    fig.tight_layout()
    CHART.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(CHART, dpi=140)
    plt.close()
    print("chart", CHART)


def main() -> None:
    metal, full, sells = build()
    _print_grid(metal, sells)
    _print_board(full)
    _print_pair(metal)
    _print_rules(metal)
    print("\nNULL against leader-only floor 0, and against cluster floor 4 band 2")
    _null(metal, _apply_topk_fixed(metal, 1, 0.0))
    _null(metal, _apply_cluster(metal, 4.0, 2.0))
    _chart(metal)


if __name__ == "__main__":
    main()
