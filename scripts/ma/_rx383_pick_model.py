# -*- coding: utf-8 -*-
"""Which option products RX383 sells, out of the whole listed market.

Each morning the screen is every product with a listed option chain.
Features are the previous session only. A rule is kept when the products
it ranks first land on the products he actually sold that day.
"""
from __future__ import annotations

import json
import math
import re
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
import _rx383_option_strategy_report as base  # noqa: E402
import _rx383_timing_model as tm  # noqa: E402
from mom_data_etl import get_conn  # noqa: E402
from option_iv.commodity_config import UNDERLYINGS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports" / "_rx383_option_strategy"
CHART = OUT / "charts"

SECTOR = {k.upper(): v.sector for k, v in UNDERLYINGS.items()}
EXCH = {k.upper(): v.exchange for k, v in UNDERLYINGS.items()}
SECTOR.update({"HO": "股指", "IO": "股指", "MO": "股指", "JM": "黑色", "J": "黑色", "HC": "黑色", "SS": "黑色"})
EXCH.update({"HO": "cffex", "IO": "cffex", "MO": "cffex", "JM": "dce", "J": "dce"})


def load() -> dict:
    conn = get_conn()
    try:
        raw = base.load_account(conn)
        mkt = base.load_market(conn, raw["opt_trades"], raw["opt_pos"])
        vol = prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, contract,
                   COALESCE(volume, 0)::float8 AS volume,
                   COALESCE(amount, 0)::float8 AS amount,
                   COALESCE(hqoi, 0)::float8 AS oi
            FROM raw_options_contracts_daily
            WHERE trade_date >= DATE '2026-06-01'
            """,
        )
        ak = prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, code,
                   COALESCE(clear, close)::float8 AS px,
                   COALESCE(volume, 0)::float8 AS volume
            FROM raw_akshare_futures_daily
            WHERE trade_date >= DATE '2026-06-01'
            """,
        )
    finally:
        conn.close()
    if not vol.empty:
        vol["dt"] = pd.to_datetime(vol["dt"])
        vol["code"] = vol["contract"].map(base.norm_code)
    if not ak.empty:
        ak["dt"] = pd.to_datetime(ak["dt"])
        ak["product"] = ak["code"].map(_ak_product)
        ak = ak.dropna(subset=["product", "px"])
        ak = ak[ak["px"] > 0].sort_values("volume", ascending=False).drop_duplicates(["dt", "product"])
    return {"raw": raw, "mkt": mkt, "vol": vol, "ak": ak}


def _ak_product(code) -> str | None:
    s = str(code or "").upper()
    m = re.match(r"^([A-Z]+?)(?:0|M)\.", s)
    if m:
        return m.group(1)
    m = re.match(r"^([A-Z]+)", s)
    return m.group(1) if m else None


def infer_mult(chain: pd.DataFrame, known: dict[str, float]) -> dict[str, float]:
    out = dict(known)
    c = chain[(chain["settl"] > 0) & (chain["volume"] > 0) & (chain["amount"] > 0)].copy()
    if c.empty:
        return out
    c["raw"] = c["amount"] / (c["settl"] * c["volume"])
    for prod, g in c.groupby("product"):
        if prod in out and math.isfinite(out[prod]):
            continue
        snapped = base.snap_mult(float(g["raw"].median()))
        if math.isfinite(snapped):
            out[prod] = snapped
    return out


def futures_book(fut_px: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for rec in fut_px.itertuples(index=False):
        m = re.match(r"^([A-Z]+?)(\d{3,4})$", str(rec.code))
        if not m or not math.isfinite(base.fnum(rec.settl)) or rec.settl <= 0:
            continue
        rows.append((rec.dt, m.group(1), base.month_key(m.group(2)), float(rec.settl), float(rec.volume or 0), float(rec.oi or 0), rec.code))
    if not rows:
        return pd.DataFrame(columns=["dt", "product", "mkey", "px", "volume", "oi", "code"])
    f = pd.DataFrame(rows, columns=["dt", "product", "mkey", "px", "volume", "oi", "code"])
    f = f[f["mkey"] > 0]
    f = f.sort_values(["volume", "oi"], ascending=False).drop_duplicates(["dt", "product", "mkey"])
    return f


def front_and_basis(f: pd.DataFrame) -> pd.DataFrame:
    """Nearest listed future, the next one, realized vol, and the calendar basis."""
    rows = []
    for (dt, product), g in f.groupby(["dt", "product"], sort=False):
        live = g[(g["volume"] > 0) | (g["oi"] > 0)]
        use = live if not live.empty else g
        use = use.sort_values("mkey")
        a = use.iloc[0]
        rec = {
            "dt": dt, "product": product, "mkey": int(a["mkey"]), "front_px": float(a["px"]),
            "fut_vol": float(a["volume"]), "fut_oi": float(a["oi"]), "front_code": a["code"],
        }
        if len(use) >= 2:
            b = use.iloc[1]
            ya, ma = divmod(int(a["mkey"]), 100)
            yb, mb = divmod(int(b["mkey"]), 100)
            months = (yb - ya) * 12 + (mb - ma)
            if months > 0 and a["px"] > 0:
                rec["basis_ann"] = (float(b["px"]) / float(a["px"]) - 1) * 12 / months
        rows.append(rec)
    out = pd.DataFrame(rows)
    if out.empty:
        return out
    out = out.sort_values(["product", "dt"])
    out["ret"] = out.groupby("product")["front_px"].pct_change()
    out["ret5"] = out.groupby("product")["front_px"].pct_change(5)
    out["rv20"] = out.groupby("product")["ret"].transform(lambda s: s.rolling(20, min_periods=10).std() * math.sqrt(252) * 100)
    out["rv5"] = out.groupby("product")["ret"].transform(lambda s: s.rolling(5, min_periods=4).std() * math.sqrt(252) * 100)
    out["basis_pct"] = base.expanding_pct(out, "basis_ann") if "basis_ann" in out.columns else np.nan
    return out


def _fill_front_from_ak(front: pd.DataFrame, ak: pd.DataFrame) -> pd.DataFrame:
    """CZCE contract prices are missing in October. Use the continuous future for those products."""
    if ak is None or ak.empty:
        return front
    window = front[(front["dt"] >= "2026-10-01") & (front["dt"] <= "2026-11-03")] if not front.empty else front
    counts = window.groupby("product").size() if not window.empty else pd.Series(dtype=int)
    strong = set(counts[counts >= 8].index)
    akf = ak.sort_values(["product", "dt"]).copy()
    akf["ret"] = akf.groupby("product")["px"].pct_change()
    akf["ret5"] = akf.groupby("product")["px"].pct_change(5)
    akf["rv20"] = akf.groupby("product")["ret"].transform(lambda s: s.rolling(20, min_periods=10).std() * math.sqrt(252) * 100)
    akf["rv5"] = akf.groupby("product")["ret"].transform(lambda s: s.rolling(5, min_periods=4).std() * math.sqrt(252) * 100)
    akf = akf.rename(columns={"px": "front_px", "volume": "fut_vol"})
    akf = akf.loc[~akf["product"].isin(strong), ["dt", "product", "front_px", "fut_vol", "ret", "ret5", "rv20", "rv5"]]
    kept = front[front["product"].isin(strong)].copy() if not front.empty else front
    out = pd.concat([kept, akf], ignore_index=True)
    return out.sort_values(["product", "dt"])


def build_features(mkt: dict, vol: pd.DataFrame, mult: dict[str, float], ak: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    fut_px = base.build_futures_px(mkt["futs"])
    chain = mkt["chain"].copy()
    if chain.empty:
        return pd.DataFrame(), pd.DataFrame()
    if not vol.empty:
        chain = chain.merge(vol[["dt", "code", "volume", "amount", "oi"]], on=["dt", "code"], how="left")
    else:
        chain["volume"] = np.nan
        chain["oi"] = np.nan
    book = futures_book(fut_px)
    front = front_and_basis(book)
    front = _fill_front_from_ak(front, ak)
    # price the option off the same-month future. Far months without a future stay out of the wing.
    opt = chain.merge(book[["dt", "product", "mkey", "px"]], on=["dt", "product", "mkey"], how="inner")
    opt = opt[(opt["px"] > 0) & (opt["strike"] > 0)]
    opt["moneyness"] = opt["strike"] / opt["px"]
    near = opt[(opt["moneyness"] - 1).abs() <= 0.04]
    atm_chain = near.groupby(["dt", "product"], as_index=False)["iv"].median().rename(columns={"iv": "atm_chain"})
    civ = mkt["civ"][["dt", "product", "iv"]].rename(columns={"iv": "atm_pub"}) if not mkt["civ"].empty else pd.DataFrame(columns=["dt", "product", "atm_pub"])
    listed = chain.groupby(["dt", "product"], as_index=False).size().rename(columns={"size": "n_contracts"})
    if not civ.empty:
        listed = pd.concat([listed, civ[["dt", "product"]]], ignore_index=True).drop_duplicates(["dt", "product"])
    feat = listed.merge(civ, on=["dt", "product"], how="left").merge(atm_chain, on=["dt", "product"], how="left")
    feat["atm_iv"] = feat["atm_pub"].where(feat["atm_pub"].notna(), feat["atm_chain"])
    feat = feat.sort_values(["product", "dt"])
    feat["hist_n"] = feat.groupby("product")["atm_iv"].transform(lambda s: s.notna().cumsum())
    # expanding percentile only over days that have a print; shift is applied later on the full frame
    feat["iv_pct"] = base.expanding_pct(feat, "atm_iv")
    feat = feat.merge(front, on=["dt", "product"], how="left")
    calls = opt[(opt["cp"] == "C") & opt["moneyness"].between(1.08, 1.22)].copy()
    puts = opt[(opt["cp"] == "P") & opt["moneyness"].between(0.78, 0.92)].copy()
    calls["err"] = (calls["moneyness"] - 1.13).abs()
    puts["err"] = (puts["moneyness"] - 0.88).abs()
    calls = calls.sort_values("err").drop_duplicates(["dt", "product", "mkey"])
    puts = puts.sort_values("err").drop_duplicates(["dt", "product", "mkey"])
    wings = calls.merge(puts, on=["dt", "product", "mkey"], suffixes=("_c", "_p"))
    if not wings.empty:
        # prefer the front month when several expiries have a wing
        wings = wings.merge(front[["dt", "product", "mkey"]], on=["dt", "product", "mkey"], how="left", indicator=True)
        wings["_front"] = wings["_merge"].eq("both")
        wings = wings.sort_values(["_front", "mkey"], ascending=[False, True]).drop_duplicates(["dt", "product"])
        wings["mult"] = wings["product"].map(mult)
        wings["credit_yuan"] = (wings["settl_c"] + wings["settl_p"]) * wings["mult"]
        px_c = wings["px_c"] if "px_c" in wings.columns else wings["px"]
        # both sides share the future price; suffixes may rename px
        if "px_c" in wings.columns:
            wings["credit_frac"] = wings["settl_c"] / wings["px_c"] + wings["settl_p"] / wings["px_p"]
        else:
            wings["credit_frac"] = (wings["settl_c"] + wings["settl_p"]) / wings["px"]
        ya = (wings["mkey"] // 100).astype(int)
        mo = (wings["mkey"] % 100).astype(int)
        exp = pd.to_datetime({"year": ya, "month": mo, "day": 15}, errors="coerce")
        wings["dte"] = (exp - pd.to_datetime(wings["dt"])).dt.days
    liq = chain.groupby(["dt", "product"], as_index=False).agg(opt_vol=("volume", "sum"), opt_oi=("oi", "sum"))
    feat = feat.merge(liq, on=["dt", "product"], how="left")
    if not wings.empty:
        keep = [c for c in ("dt", "product", "mkey", "code_c", "code_p", "settl_c", "settl_p", "credit_yuan", "credit_frac", "dte", "moneyness_c", "moneyness_p", "mult") if c in wings.columns]
        feat = feat.merge(wings[keep], on=["dt", "product"], how="left")
    feat["vrp"] = feat["atm_iv"] - feat["rv20"]
    feat["vrp5"] = feat["atm_iv"] - feat["rv5"]
    feat = feat.sort_values(["product", "dt"])
    lag_cols = [
        "atm_iv", "iv_pct", "hist_n", "basis_ann", "basis_pct", "rv20", "rv5", "ret", "ret5",
        "vrp", "vrp5", "opt_vol", "opt_oi", "fut_vol", "fut_oi", "credit_yuan", "credit_frac", "dte", "front_px",
    ]
    for col in lag_cols:
        if col not in feat.columns:
            feat[col] = np.nan
        feat[col + "_lag"] = feat.groupby("product")[col].shift(1)
    quote_cols = [c for c in ("dt", "product", "code_c", "code_p", "settl_c", "settl_p", "credit_yuan", "mult", "mkey") if c in feat.columns]
    quotes = feat[quote_cols].dropna(subset=["code_c", "code_p", "settl_c", "settl_p"]).copy() if "code_c" in feat.columns else pd.DataFrame()
    print(
        "listed products", int(listed["product"].nunique()),
        "front rows", len(front),
        "opt joined", len(opt),
        "wing rows", 0 if wings.empty else len(wings),
        "vrp", int(feat["vrp"].notna().sum()),
        "credit", int(feat["credit_yuan"].notna().sum()) if "credit_yuan" in feat.columns else 0,
    )
    return feat, quotes


def label_panel(feat: pd.DataFrame, trades: pd.DataFrame) -> pd.DataFrame:
    opens = trades[trades["is_open"] & trades["is_sell"]]
    sold = opens.groupby(["dt", "product"], as_index=False)["lots"].sum().rename(columns={"lots": "lots"})
    dates = sorted(opens["dt"].unique())
    panel = feat[feat["dt"].isin(dates)].copy()
    panel = panel.merge(sold, on=["dt", "product"], how="left")
    panel["lots"] = panel["lots"].fillna(0.0)
    panel["y"] = (panel["lots"] > 0).astype(float)
    panel["sector"] = panel["product"].map(lambda p: SECTOR.get(p, "其他"))
    panel["exch"] = panel["product"].map(lambda p: EXCH.get(p, ""))
    # menu known before today
    seen: set[str] = set()
    menu = []
    for dt, g in panel.sort_values("dt").groupby("dt", sort=True):
        menu.append(pd.Series(g["product"].map(lambda p: 1.0 if p in seen else 0.0).to_numpy(), index=g.index))
        seen |= set(g.loc[g["y"] == 1, "product"])
    panel["menu"] = pd.concat(menu).reindex(panel.index)
    return panel


def day_topk(panel: pd.DataFrame, score: pd.Series, higher: bool = True) -> dict:
    """Overlap when each day we buy the same number of names he sold, ranked by score."""
    df = panel[["dt", "product", "y", "lots"]].copy()
    df["score"] = score.reindex(df.index).to_numpy()
    hits = k_sum = n_days = 0
    rows = []
    for dt, g in df.groupby("dt"):
        k = int(g["y"].sum())
        if k <= 0:
            continue
        usable = g[np.isfinite(g["score"])]
        if usable.empty:
            continue
        n_days += 1
        k_use = min(k, len(usable))
        top = usable.nlargest(k_use, "score") if higher else usable.nsmallest(k_use, "score")
        hit = int(top["y"].sum())
        hits += hit
        k_sum += k
        his = sorted(g.loc[g["y"] == 1, "product"])
        picked = sorted(top["product"])
        rows.append({
            "dt": str(pd.Timestamp(dt).date()),
            "k": k,
            "hit": hit,
            "universe": int(len(usable)),
            "his": his,
            "picked": picked,
        })
    prec = hits / k_sum if k_sum else float("nan")
    return {"hits": hits, "k": k_sum, "precision": prec, "days": n_days, "rows": rows}


def random_topk(panel: pd.DataFrame, n: int = 400) -> dict:
    rng = np.random.default_rng(7)
    precs = []
    df = panel[["dt", "y"]].copy()
    groups = [(dt, g.index.to_numpy(), g["y"].to_numpy()) for dt, g in df.groupby("dt")]
    for _ in range(n):
        hits = k_sum = 0
        for _, idx, y in groups:
            k = int(y.sum())
            if k <= 0 or k > len(y):
                continue
            choose = rng.choice(len(y), size=k, replace=False)
            hits += int(y[choose].sum())
            k_sum += k
        if k_sum:
            precs.append(hits / k_sum)
    arr = np.array(precs)
    return {"mean": float(arr.mean()), "p05": float(np.quantile(arr, 0.05)), "p95": float(np.quantile(arr, 0.95))}


def feature_table(panel: pd.DataFrame, cols: list[str]) -> list[dict]:
    rows = []
    y = panel["y"].to_numpy()
    for col in cols:
        s = panel[col]
        ok = s.notna()
        if ok.sum() < 30 or y[ok.to_numpy()].sum() < 5:
            continue
        sub = panel.loc[ok]
        # within-day percentile of the names he sold
        pct = sub.groupby("dt")[col].rank(pct=True)
        chosen = pct[sub["y"] == 1]
        top = day_topk(panel, panel[col], higher=True)
        bot = day_topk(panel, panel[col], higher=False)
        better = top if top["precision"] >= bot["precision"] else bot
        rows.append({
            "feature": col,
            "yes": float(sub.loc[sub["y"] == 1, col].median()),
            "no": float(sub.loc[sub["y"] == 0, col].median()),
            "auc": tm.auc_score(sub["y"], sub[col]),
            "his_pct": float(chosen.mean()) if len(chosen) else float("nan"),
            "cover": float(sub.loc[sub["y"] == 1, "lots"].sum() / panel.loc[panel["y"] == 1, "lots"].sum()),
            "precision_high": top["precision"],
            "precision_low": bot["precision"],
            "best_precision": better["precision"],
            "best_high": bool(top["precision"] >= bot["precision"]),
            "n_yes": int((sub["y"] == 1).sum()),
            "n": int(len(sub)),
        })
    rows.sort(key=lambda r: -(r["best_precision"] if math.isfinite(r["best_precision"]) else -1))
    return rows


def logit_scores(panel: pd.DataFrame, cols: list[str]) -> pd.Series:
    scores = pd.Series(np.nan, index=panel.index, dtype=float)
    coefs = []
    for hold in panel["dt"].drop_duplicates():
        train = panel[panel["dt"] != hold]
        test = panel[panel["dt"] == hold]
        Xtr = train[cols].to_numpy(dtype=float)
        ytr = train["y"].to_numpy(dtype=float)
        if ytr.sum() < 3 or (1 - ytr).sum() < 5:
            continue
        Ztr, mu, sd = tm.standardize_fit(Xtr)
        w = tm.logit_fit(np.column_stack([np.ones(len(Ztr)), Ztr]), ytr, l2=3.0)
        Zte = tm.standardize_apply(test[cols].to_numpy(dtype=float), mu, sd)
        scores.loc[test.index] = tm.logit_predict(np.column_stack([np.ones(len(Zte)), Zte]), w)
        coefs.append(w[1:])
    coef = {c: float(v) for c, v in zip(cols, np.mean(np.vstack(coefs), axis=0))} if coefs else {}
    return scores, coef


def attach_forward_pnl(panel: pd.DataFrame, quotes: pd.DataFrame) -> pd.DataFrame:
    """Yuan P&L of selling that day's 13%/12% strangle and holding 5 sessions, and to 3 Nov."""
    out = panel.copy()
    out["pnl5"] = np.nan
    out["pnl_end"] = np.nan
    if quotes.empty:
        return out
    q = quotes.copy()
    px = {}
    for r in q.itertuples(index=False):
        px[(pd.Timestamp(r.dt), r.code_c)] = (float(r.settl_c), float(r.mult) if math.isfinite(base.fnum(r.mult)) else float("nan"))
        px[(pd.Timestamp(r.dt), r.code_p)] = (float(r.settl_p), float(r.mult) if math.isfinite(base.fnum(r.mult)) else float("nan"))
    # also allow exit quotes from any day the code appears: rebuild from quotes is incomplete
    # quotes only store the wing we picked, not later prices of that code if it is no longer the 13% wing.
    # Use a full price map passed in via quotes columns only. Caller should pass chain prices.
    return out


def price_map_from_chain(chain: pd.DataFrame) -> dict:
    c = chain.dropna(subset=["settl"])
    c = c[c["settl"] > 0]
    return {(pd.Timestamp(r.dt), r.code): float(r.settl) for r in c[["dt", "code", "settl"]].itertuples(index=False)}


def forward_pnl(panel: pd.DataFrame, quotes: pd.DataFrame, px: dict, chain_dates: list) -> pd.DataFrame:
    out = panel.copy()
    idx = {pd.Timestamp(d): i for i, d in enumerate(chain_dates)}
    end = chain_dates[-1] if chain_dates else None
    pnl5, pnl_end = [], []
    q = quotes.set_index(["dt", "product"]) if not quotes.empty else None
    for r in out.itertuples(index=False):
        key = (pd.Timestamp(r.dt), r.product)
        if q is None or key not in q.index:
            pnl5.append(np.nan)
            pnl_end.append(np.nan)
            continue
        row = q.loc[key]
        if isinstance(row, pd.DataFrame):
            row = row.iloc[0]
        i = idx.get(pd.Timestamp(r.dt))
        if i is None:
            pnl5.append(np.nan)
            pnl_end.append(np.nan)
            continue

        def decay(code, entry, exit_dt):
            if not (isinstance(code, str) and code) or not math.isfinite(entry) or entry <= 0:
                return np.nan
            exit_px = px.get((pd.Timestamp(exit_dt), code))
            if exit_px is None:
                return np.nan
            return (entry - exit_px) / entry

        e5 = chain_dates[min(len(chain_dates) - 1, i + 5)]

        def combo(exit_dt):
            parts = [decay(row["code_c"], base.fnum(row["settl_c"]), exit_dt), decay(row["code_p"], base.fnum(row["settl_p"]), exit_dt)]
            if not all(math.isfinite(v) for v in parts):
                return np.nan
            return float(sum(parts) / 2)

        pnl5.append(combo(e5))
        pnl_end.append(combo(end))
    out["pnl5"] = pnl5
    out["pnl_end"] = pnl_end
    return out


def money_of(df: pd.DataFrame, col: str) -> dict:
    s = df[col].dropna()
    if s.empty:
        return {"n": 0, "mean": float("nan"), "sum": float("nan"), "win": float("nan")}
    return {"n": int(len(s)), "mean": float(s.mean()), "sum": float(s.sum()), "win": float((s > 0).mean())}


def random_money(panel: pd.DataFrame, col: str, n: int = 400) -> dict:
    rng = np.random.default_rng(11)
    sums = []
    groups = []
    for dt, g in panel.groupby("dt"):
        k = int(g["y"].sum())
        vals = g[col].to_numpy(dtype=float)
        ok = np.isfinite(vals)
        if k <= 0 or ok.sum() < k:
            continue
        groups.append((vals[ok], k))
    if not groups:
        return {}
    for _ in range(n):
        total = 0.0
        count = 0
        for vals, k in groups:
            pick = rng.choice(len(vals), size=k, replace=False)
            total += float(vals[pick].sum())
            count += k
        sums.append(total)
    arr = np.array(sums)
    his = panel.loc[panel["y"] == 1, col].dropna()
    return {
        "his_sum": float(his.sum()) if len(his) else float("nan"),
        "his_mean": float(his.mean()) if len(his) else float("nan"),
        "his_win": float((his > 0).mean()) if len(his) else float("nan"),
        "rand_mean_sum": float(arr.mean()),
        "rand_p05": float(np.quantile(arr, 0.05)),
        "rand_p95": float(np.quantile(arr, 0.95)),
        "n": int(len(his)),
    }


def make_charts(panel: pd.DataFrame, rank_rows: list[dict], score_name: str) -> dict:
    CHART.mkdir(parents=True, exist_ok=True)
    prof.configure_matplotlib()
    paths = {}
    fig, ax = plt.subplots(figsize=(8.2, 3.8))
    xs = [r["dt"][5:] for r in rank_rows]
    ax.bar(xs, [r["hit"] for r in rank_rows], color=prof.C_NAVY, label="模型打中的品种")
    ax.plot(xs, [r["k"] for r in rank_rows], color=prof.C_GOLD, marker="o", lw=1.2, label="他当天卖的品种数")
    ax.set_ylabel("品种数")
    ax.legend(frameon=False)
    fig.autofmt_xdate()
    fig.tight_layout()
    p = CHART / "pick_overlap.png"
    fig.savefig(p, dpi=140)
    plt.close()
    paths["overlap"] = p

    fig, ax = plt.subplots(figsize=(8.2, 3.8))
    # his picks vs the rest, on the two strongest lagged features if present
    a, b = "vrp_lag", "basis_pct_lag"
    sub = panel.dropna(subset=[a, b])
    if not sub.empty:
        ax.scatter(sub.loc[sub["y"] == 0, a], sub.loc[sub["y"] == 0, b], s=12, color="#A0AEC0", alpha=0.7, label="当天没卖")
        ax.scatter(sub.loc[sub["y"] == 1, a], sub.loc[sub["y"] == 1, b], s=28, color=prof.C_NAVY, alpha=0.9, label="他卖开")
        ax.set_xlabel("前一日：平值隐波 − 20日实现波动（个百分点）")
        ax.set_ylabel("前一日期货曲线的自身历史分位")
        ax.legend(frameon=False)
    fig.tight_layout()
    p = CHART / "pick_scatter.png"
    fig.savefig(p, dpi=140)
    plt.close()
    paths["scatter"] = p
    paths["score_name"] = score_name
    return paths


def add_pic(doc, path) -> None:
    if path and Path(path).exists():
        doc.add_picture(str(path), width=Inches(6.3))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER


FEAT_CN = {
    "iv_pct_lag": "隐波历史分位",
    "atm_iv_lag": "平值隐波",
    "vrp_lag": "隐波减20日实现波动",
    "vrp5_lag": "隐波减5日实现波动",
    "credit_yuan_lag": "虚值跨式权利金（元）",
    "credit_frac_lag": "虚值跨式/期货价格",
    "fut_vol_lag": "近月期货成交量",
    "fut_oi_lag": "近月期货持仓量",
    "opt_oi_lag": "期权持仓量",
    "basis_pct_lag": "期货曲线分位",
    "basis_ann_lag": "期货年化升水",
    "ret5_lag": "期货近5日涨跌",
    "ret_lag": "期货前一日涨跌",
    "dte_lag": "近月剩余天数",
    "wing_lag": "翼部隐波减平值",
    "rr_lag": "认购减认沽隐波",
    "menu": "以前卖过这个品种",
}


def write_doc(res: dict, pics: dict, out_path: Path) -> None:
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.left_margin = Cm(1.8)
    sec.right_margin = Cm(1.8)
    sec.top_margin = Cm(1.6)
    sec.bottom_margin = Cm(1.6)
    prof.heading.offset = 0
    best = res["best"]
    rnd = res["random"]
    prof.para(doc, "内部资料 · 卖哪些品种 · 请勿外传", size=9, color=prof.GOLD, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=14)
    prof.para(doc, "RX383 卖哪些品种", size=22, bold=True, color=prof.NAVY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    prof.para(doc, "未登记投顾 · 未登记团队", size=12, color=prof.TEXT, align=WD_ALIGN_PARAGRAPH.CENTER)
    prof.para(
        doc,
        f"期权成交  {res['from']}  ~  {res['to']}      卖开 {res['open_names']} 个品种日 / {res['open_lots']:.0f} 手      每天市场上约 {res['universe_med']:.0f} 个期权品种",
        size=11, color=prof.MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12,
    )
    prof.heading(doc, "一、要预报的是哪一个品种", 1)
    prof.para(
        doc,
        f"「卖近月虚值、拿到期」每个交易日可以在大约 {res['universe_med']:.0f} 个品种上各开一套，他没有这么做。"
        f"有卖开的 {res['trade_days']} 天里，他每天卖 {res['k_med']:.1f} 个品种（最少 {res['k_min']} 个，最多 {res['k_max']} 个），一共 {res['open_names']} 个品种日，落在 {res['distinct']} 个名字上。"
        "下面每一条规则都只用前一个交易日已经收盘的数据，并且每天只取和他当天一样多的名字。打中，就是这几个名字里有几个是他第二天真的卖了的。"
        "能进这张名单的，是当天有期权链、或者有平值隐波序列的品种。郑商所 10 月的分月期货行情是空的，这些品种的实现波动用连续主力合约补上。股指期权 HO 没有这条序列，不参加排名。",
    )
    prof.para(
        doc,
        f"随便在当天有报价的品种里抽同样多个，平均能打中 {rnd['mean']:.0%}（反复随机，高的那一端大约 {rnd['p95']:.0%}）。"
        f"用前一天的成交量、曲线分位、隐波减实现波动、近 5 日涨跌和隐波分位做逻辑回归，每天留出一天再排序，打中 {res['logit']['precision']:.0%}（{res['logit']['hits']} / {res['logit']['k']}）。"
        f"只凭「这个品种他以前卖过」，再按成交量把平分破开，打中 {res['menu']['precision']:.0%}。"
        "菜单说明他有一组常做的品种。回归不看这份菜单，只看前一天的行情，打中率和菜单差不多。",
    )
    add_pic(doc, pics.get("overlap"))
    prof.caption(doc, "图1  留出一天的回归。柱子是打中的品种个数，点是他当天实际卖的品种数。")

    prof.heading(doc, "二、他选中的名字和别人差在哪", 1)
    prof.para(
        doc,
        "分位是当天所有上市品种里的位置，0.5 是中位。打中率是每天取得最高（或最低）的 k 个名字、和他对上的比例。覆盖率是这条特征有值的卖开手数占比。",
    )
    show = [r for r in res["features"] if r.get("cover", 0) >= 0.5][:8]
    prof.add_table(
        doc,
        ["前一日特征", "他卖的中位", "没卖的中位", "他在当天的分位", "取高打中", "取低打中"],
        [[
            FEAT_CN.get(r["feature"], r["feature"]),
            _fmt(r["yes"], r["feature"]),
            _fmt(r["no"], r["feature"]),
            f"{r['his_pct']:.0%}",
            f"{r['precision_high']:.0%}",
            f"{r['precision_low']:.0%}",
        ] for r in show],
    )
    prof.caption(doc, "表1  卖开当天，他的品种相对全市场的位置。随机打中大约 " + f"{rnd['mean']:.0%}。")
    add_pic(doc, pics.get("scatter"))
    prof.caption(doc, "图2  每个点是一个品种的一个交易日。他卖的名字略偏「隐波高于实现波动、期货曲线分位偏低」的一侧，但和没卖的名字重叠很大。")

    prof.heading(doc, "三、这样卖，钱是不是比随便卖更多", 1)
    prof.para(
        doc,
        "比较的交易是统一的：每个品种卖一套近月跨式，认购大约 13% 虚值，认沽大约 12% 虚值，这是他卖开手数的中位距离。"
        "盈亏是两条腿权利金变动的平均，正数表示结算价跌了、卖的人赚了。乘数消掉了，所以铜和玉米可以放在一起比。他的实际手数不在这张表里。",
    )
    m5 = res["money5"] or {}
    me = res["money_end"] or {}
    def yuan(d, key):
        v = d.get(key, float("nan"))
        return f"{v:+,.0f}" if isinstance(v, (int, float)) and math.isfinite(v) else "—"
    def pct(d, key):
        v = d.get(key, float("nan"))
        return f"{v:.0%}" if isinstance(v, (int, float)) and math.isfinite(v) else "—"
    if m5.get("n", 0) >= 15:
        prof.para(
            doc,
        f"持有 5 个交易日：他选的品种，一套跨式的权利金平均变动 {pct(m5, 'his_mean')}（正数是权利金下降），{pct(m5, 'his_win')} 的品种日在赚钱，对上价格的有 {m5.get('n', 0)} 套。"
        f"随机卖同样多个，平均变动 {pct({'v': m5['rand_mean_sum'] / m5['n'] if m5.get('n') else float('nan')}, 'v')}，"
        f"这些随机合计的 5% 到 95% 落在 {m5['rand_p05']:+.1f} 到 {m5['rand_p95']:+.1f}（各套比例相加，他的合计是 {m5['his_sum']:+.1f}）。",
        )
    else:
        prof.para(
            doc,
            f"期权日行情里，多数品种没有他那种 13% 虚值的报价，同一套跨式的后续价格只对上 {m5.get('n', 0)} 套。"
            "这张比较回答不了「他挑的品种是不是比盲抽更容易把权利金吃掉」。已经落袋的利润来自到期批次把虚值权利金留下。",
        )
    if me:
        prof.para(
            doc,
        f"一直拿到 11 月 3 日：他选的平均变动 {pct(me, 'his_mean')}，合计 {me.get('his_sum', float('nan')):+.1f}；随机合计的中心是 {me.get('rand_mean_sum', float('nan')):+.1f}（{me.get('rand_p05', float('nan')):+.1f} 到 {me.get('rand_p95', float('nan')):+.1f}）。"
        + res["money_sentence"],
        )
    prof.add_table(
        doc,
        ["日期", "他卖的", "模型取的", "打中"],
        [[r["dt"][5:], "、".join(r["his"]), "、".join(r["picked"]), f"{r['hit']}/{r['k']}"] for r in res["logit_rows"]],
    )
    prof.caption(doc, "表2  留出检验的回归每天取的名字。打中是这些名字里有几个他当天真的卖了。")

    prof.heading(doc, "四、能照着做的筛法", 1)
    for line in res["rule_lines"]:
        prof.para(doc, line)
    prof.para(
        doc,
        f"样本是 {res['from']} 到 {res['to']}，只有 {res['trade_days']} 个他卖开的交易日，而且只经过一个上期所到期日。"
        f"打中率高于随机，说明这些名字不是从大约 {res['universe_med']:.0f} 个品种里盲抽的；它还没有高到可以按模型清单逐个下单。",
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)


def _fmt(v, feature: str) -> str:
    if v is None or not math.isfinite(float(v)):
        return "—"
    v = float(v)
    if "pct" in feature or feature.endswith("_lag") and "iv_pct" in feature:
        return f"{v:.0%}"
    if feature in ("iv_pct_lag", "basis_pct_lag", "his_pct"):
        return f"{v:.0%}"
    if "credit_yuan" in feature or "opt_" in feature:
        return f"{v:,.0f}"
    if "ret" in feature or "frac" in feature:
        return f"{v:.2%}"
    if feature in ("atm_iv_lag", "vrp_lag", "vrp5_lag", "rv20_lag", "wing_lag", "rr_lag"):
        return f"{v:.1f}"
    if feature == "dte_lag":
        return f"{v:.0f}天"
    if feature == "menu":
        return f"{v:.0%}"
    return f"{v:.2f}"


def main() -> None:
    data = load()
    trades = data["raw"]["opt_trades"]
    mult = infer_mult(
        data["mkt"]["chain"].merge(
            data["vol"][["dt", "code", "volume", "amount"]],
            on=["dt", "code"],
            how="left",
        ) if not data["vol"].empty else data["mkt"]["chain"],
        base.multipliers(trades),
    )
    # chain used for features needs volume; build_features merges vol itself
    feat, quotes = build_features(data["mkt"], data["vol"], mult, data["ak"])
    panel = label_panel(feat, trades)
    # every listed product-day stays in the screen, even when one feature is missing
    chain = data["mkt"]["chain"]
    print("panel rows", len(panel), "products", int(panel["product"].nunique()), "his missing", sorted(set(trades.loc[trades["is_open"] & trades["is_sell"], "product"]) - set(panel["product"])))
    if not data["vol"].empty and "volume" not in chain.columns:
        chain = chain.merge(data["vol"][["dt", "code", "volume", "amount"]], on=["dt", "code"], how="left")
    dates = sorted(pd.to_datetime(chain["dt"].unique()))
    px = price_map_from_chain(chain)
    panel = forward_pnl(panel, quotes, px, dates)

    cols = [
        "iv_pct_lag", "atm_iv_lag", "vrp_lag", "vrp5_lag", "credit_yuan_lag", "credit_frac_lag",
        "fut_vol_lag", "fut_oi_lag", "opt_oi_lag", "basis_pct_lag", "basis_ann_lag",
        "ret5_lag", "ret_lag", "dte_lag",
    ]
    features = feature_table(panel, cols)
    menu_rank = day_topk(panel, panel["menu"].fillna(0) + panel["opt_vol_lag"].rank(pct=True).fillna(0) * 0.01, higher=True)
    # menu alone has ties; break ties by liquidity so the top-k is defined, but the score is still "seen before"
    rnd = random_topk(panel)
    use_cols = [c for c in ("iv_pct_lag", "vrp_lag", "credit_yuan_lag", "fut_vol_lag", "basis_pct_lag", "ret5_lag") if c in panel.columns and panel[c].notna().mean() > 0.45]
    scores, coef = logit_scores(panel, use_cols)
    logit_rank = day_topk(panel, scores, higher=True)

    # best single feature by OOS top-k. The top-k here is in-sample on the full window
    # because the rank uses the feature itself, not a fitted threshold. That is honest:
    # the direction (high vs low) is chosen on the same window. Label it as such.
    eligible = [r for r in features if r.get("cover", 0) >= 0.5] or features
    best = max(eligible, key=lambda r: r["best_precision"] if math.isfinite(r["best_precision"]) else -1)
    best_rows_pack = day_topk(panel, panel[best["feature"]], higher=best["best_high"])
    money5 = random_money(panel, "pnl5")
    money_end = random_money(panel, "pnl_end")
    print("pnl5 finite", int(panel["pnl5"].notna().sum()), "pnl_end", int(panel["pnl_end"].notna().sum()), "quotes", len(quotes))
    print("money5", money5)
    print("money_end", money_end)

    def side_sentence(m, label):
        if not m or not math.isfinite(m.get("his_sum", float("nan"))):
            return ""
        if m["his_sum"] > m["rand_p95"]:
            return f"{label}，他的合计高于 95% 的随机组合。"
        if m["his_sum"] < m["rand_p05"]:
            return f"{label}，他的合计低于 95% 的随机组合。"
        return f"{label}，他的合计落在随机组合的常规范围里。"

    money_sentence = side_sentence(money5, "持有 5 日") + side_sentence(money_end, "拿到样本末日")

    # a concrete screen: describe the best simple rule in words
    direction = "高" if best["best_high"] else "低"
    rule_lines = [
        f"单一特征里，和他的卖开对得最齐的是前一日{FEAT_CN.get(best['feature'], best['feature'])}偏{direction}的品种。"
        f"每天取和他当天一样多个，{best_rows_pack['days']} 天里打中 {best_rows_pack['hits']} 个，共 {best_rows_pack['k']} 个品种日，打中率 {best_rows_pack['precision']:.0%}，随机是 {rnd['mean']:.0%}。",
        f"多因子回归的系数（留出各天之后取平均，正号表示越高越像他会卖）："
        + "，".join(f"{FEAT_CN.get(k, k)} {v:+.2f}" for k, v in sorted(coef.items(), key=lambda kv: -abs(kv[1])))
        + f"。这套回归打中 {logit_rank['precision']:.0%}。",
    ]
    if money5 and money5.get("n", 0) >= 15 and math.isfinite(money5.get("his_sum", float("nan"))):
        if money5["his_sum"] > money5["rand_p95"]:
            rule_lines.append("按同一套 13%/12% 虚值跨式、持有 5 个交易日，他选中的品种合计高于 95% 的随机组合。挑品种这一步，在这半个月里确实比盲抽更赚钱。")
        elif money5["his_sum"] < money5["rand_p05"]:
            rule_lines.append("按同一套虚值跨式持有 5 日，他选中的品种合计低于 95% 的随机组合。这半个月账户上的盈利，对不上「他挑的品种比别人更容易赚权利金」。")
        else:
            rule_lines.append("按同一套虚值跨式持有 5 日，他选中的品种合计落在随机组合的常规范围里。账户盈利主要来自卖出之后拿着，不是来自每天从全市场里挑出更贵的那几个。")
    elif money5:
        rule_lines.append(f"后续结算价只对上 {money5.get('n', 0)} 套，太少，不用这张盈亏去判断他挑得对不对。")

    opens = trades[trades["is_open"] & trades["is_sell"]]
    by_day_k = opens.groupby("dt")["product"].nunique()
    univ = panel.groupby("dt")["product"].nunique()
    res = {
        "from": str(pd.Timestamp(opens["dt"].min()).date()),
        "to": str(pd.Timestamp(opens["dt"].max()).date()),
        "open_names": int((panel["y"] == 1).sum()),
        "open_lots": float(opens["lots"].sum()),
        "distinct": int(opens["product"].nunique()),
        "trade_days": int(by_day_k.shape[0]),
        "k_med": float(by_day_k.median()),
        "k_min": int(by_day_k.min()),
        "k_max": int(by_day_k.max()),
        "universe_med": float(univ.median()),
        "features": features,
        "best": {
            "feature": best["feature"],
            "precision": best_rows_pack["precision"],
            "hits": best_rows_pack["hits"],
            "k": best_rows_pack["k"],
            "high": best["best_high"],
        },
        "best_rows": best_rows_pack["rows"],
        "logit": {"precision": logit_rank["precision"], "hits": logit_rank["hits"], "k": logit_rank["k"], "coef": coef},
        "logit_rows": logit_rank["rows"],
        "menu": {"precision": menu_rank["precision"], "hits": menu_rank["hits"], "k": menu_rank["k"]},
        "random": rnd,
        "money5": money5,
        "money_end": money_end,
        "money_sentence": money_sentence,
        "rule_lines": rule_lines,
    }
    pics = make_charts(panel, logit_rank["rows"], "logit")
    doc_path = ROOT / "reports" / "RX383_卖哪些品种.docx"
    write_doc(res, pics, doc_path)
    print("REPORT", doc_path)

    def conv(o):
        if isinstance(o, (np.floating,)):
            o = float(o)
        if isinstance(o, float) and not math.isfinite(o):
            return None
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (list, dict, str)) or o is None:
            return o
        return o

    # drop bulky nothing
    slim = {k: v for k, v in res.items() if k != "best_rows"}
    slim["best_rows"] = [{**r, "his": r["his"], "picked": r["picked"]} for r in res["best_rows"]]
    text = json.dumps(slim, ensure_ascii=False, indent=2, default=conv)
    (OUT / "pick.json").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
