# -*- coding: utf-8 -*-
"""Deeper option-strategy note for MOM account RX383.

Option position rows store 持仓盈亏 as 0. Floating P&L is rebuilt from
settlement versus the fill price. Entry timing is then compared with ATM IV,
the futures calendar basis, and the option term structure.
"""
from __future__ import annotations

import json
import math
import re
import sys
from datetime import date
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
from mom_data_etl import get_conn, load_env_files  # noqa: E402

load_env_files()
prof.configure_matplotlib()

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "reports" / "_rx383_option_strategy"
CHART = OUT / "charts"
ACCOUNT = "rx383"
UNDER_FUT = {"HO": "IH", "IO": "IF", "MO": "IM"}
MULT_LADDER = np.array([1, 2, 3, 5, 10, 15, 16, 20, 30, 60, 100, 200, 300, 1000], dtype=float)


def fnum(v) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return float("nan")
    return x if math.isfinite(x) else float("nan")


def norm_code(contract) -> str:
    s = re.sub(r"\.[A-Za-z]+$", "", str(contract or "").strip())
    return re.sub(r"[^A-Za-z0-9]", "", s).upper()


def parse_contract(contract) -> dict | None:
    """Same grammar as the profile parser, after dropping an exchange suffix."""
    s = str(contract or "").strip()
    s = re.sub(r"\.[A-Za-z]+$", "", s)
    return prof.parse_option_contract(s)


def month_key(month: str) -> int:
    month = str(month or "")
    if len(month) == 4 and month.isdigit():
        return (2000 + int(month[:2])) * 100 + int(month[2:])
    if len(month) == 3 and month.isdigit():
        year = 2020 + int(month[0])
        if year < 2024:
            year += 10
        return year * 100 + int(month[1:])
    return 0


def fut_lookup_keys(product: str, month: str) -> list[str]:
    product = UNDER_FUT.get(product, product)
    keys = [f"{product}{month}".upper()]
    if len(month) == 4 and month.isdigit():
        keys.append(f"{product}{int(month[:2]) % 10}{month[2:]}".upper())
    if len(month) == 3 and month.isdigit():
        year = month_key(month) // 100
        keys.append(f"{product}{year % 100:02d}{month[1:]}".upper())
    out, seen = [], set()
    for k in keys:
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def snap_mult(x: float) -> float:
    if not math.isfinite(x) or x <= 0:
        return float("nan")
    return float(MULT_LADDER[np.argmin(np.abs(np.log(MULT_LADDER / x)))])


def to_percent(series: pd.Series) -> pd.Series:
    s = pd.to_numeric(series, errors="coerce")
    med = float(s.replace(0, np.nan).abs().median()) if s.notna().any() else float("nan")
    if math.isfinite(med) and med <= 3:
        return s * 100.0
    return s


def parse_side(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    parsed = out["contract"].map(parse_contract)
    out = out.loc[parsed.notna()].copy()
    info = pd.DataFrame(list(parsed.loc[out.index]))
    info.index = out.index
    out["product"] = info["product"]
    out["month"] = info["month"]
    out["cp"] = info["cp"]
    out["strike"] = info["strike"].astype(float)
    out["mkey"] = out["month"].map(month_key)
    out["code"] = out["contract"].map(norm_code)
    bs = out["bs"].fillna("").astype(str) if "bs" in out.columns else ""
    oc = out["oc"].fillna("").astype(str) if "oc" in out.columns else ""
    out["is_sell"] = bs.str.contains("卖") if isinstance(bs, pd.Series) else False
    out["is_buy"] = bs.str.contains("买") if isinstance(bs, pd.Series) else False
    out["is_open"] = oc.str.contains("开") if isinstance(oc, pd.Series) else False
    out["is_close"] = oc.str.contains("平") if isinstance(oc, pd.Series) else False
    return out


def load_account(conn) -> dict:
    acc = ACCOUNT
    opt_trades = parse_side(prof.read_sql(
        conn,
        f"""
        SELECT "交易日期"::date AS dt, "合约" AS contract, "成交时间" AS ttime,
               "买/卖" AS bs, "开/平" AS oc,
               {prof.num_sql("手数")} AS lots,
               {prof.num_sql("成交价")} AS price,
               {prof.num_sql("成交额")} AS turnover,
               {prof.num_sql("手续费")} AS fee,
               {prof.num_sql("平仓盈亏")} AS close_pnl,
               {prof.num_sql("权利金收支")} AS premium
        FROM mom_options_trade_details
        WHERE LOWER(TRIM("账户")) = %s
        """,
        (acc,),
    ))
    opt_pos = parse_side(prof.read_sql(
        conn,
        f"""
        SELECT "交易日期"::date AS dt, "合约" AS contract,
               {prof.num_sql("买持仓")} AS long_lots,
               {prof.num_sql("卖持仓")} AS short_lots,
               {prof.num_sql("买入价")} AS buy_px,
               {prof.num_sql("卖出价")} AS sell_px,
               {prof.num_sql("今结算价")} AS settl,
               {prof.num_sql("持仓盈亏")} AS mtm,
               {prof.num_sql("保证金")} AS margin,
               {prof.num_sql("期权市値")} AS opt_mv
        FROM mom_options_position_details
        WHERE LOWER(TRIM("账户")) = %s
        """,
        (acc,),
    ))
    daily = prof.read_sql(
        conn,
        f"""
        SELECT "交易日期"::date AS dt,
               {prof.num_sql("当日盈亏")} AS pnl,
               {prof.num_sql("客户权益")} AS equity,
               {prof.num_sql("当日手续费")} AS fee,
               {prof.num_sql("平仓盈亏")} AS close_pnl,
               {prof.num_sql("持仓盈亏")} AS pos_pnl
        FROM mom_daily_reports
        WHERE LOWER(TRIM("账户")) = %s
        ORDER BY 1
        """,
        (acc,),
    )
    fut_trades = prof.read_sql(
        conn,
        f"""
        SELECT "交易日期"::date AS dt, "合约" AS contract, "买/卖" AS bs, "开/平" AS oc,
               {prof.num_sql("手数")} AS lots, {prof.num_sql("成交价")} AS price,
               {prof.num_sql("平仓盈亏")} AS close_pnl
        FROM mom_futures_trade_details
        WHERE LOWER(TRIM("账户")) = %s
        ORDER BY 1
        """,
        (acc,),
    )
    fut_pos = prof.read_sql(
        conn,
        f"""
        SELECT "交易日期"::date AS dt, "合约" AS contract,
               {prof.num_sql("买持仓")} AS long_lots,
               {prof.num_sql("卖持仓")} AS short_lots,
               {prof.num_sql("今结算价")} AS settl
        FROM mom_position_details
        WHERE LOWER(TRIM("账户")) = %s
        """,
        (acc,),
    )
    advisor = prof.read_sql(
        conn,
        """
        SELECT advisor_name, company, sector, style
        FROM mom_advisor_info
        WHERE LOWER(TRIM(account_code)) = %s
           OR LOWER(TRIM(account_code)) LIKE %s
        LIMIT 1
        """,
        (acc, f"%{acc}%"),
    )
    for df in (opt_trades, opt_pos, daily, fut_trades, fut_pos):
        if not df.empty and "dt" in df.columns:
            df["dt"] = pd.to_datetime(df["dt"])
    if not opt_trades.empty:
        hm = opt_trades["ttime"].map(prof.parse_hms)
        opt_trades["hh"] = hm.map(lambda x: x[0] if x else -1)
        opt_trades["mm"] = hm.map(lambda x: x[1] if x else -1)
    if not opt_pos.empty:
        opt_pos = opt_pos.drop_duplicates()
    return {
        "opt_trades": opt_trades,
        "opt_pos": opt_pos,
        "daily": daily,
        "fut_trades": fut_trades,
        "fut_pos": fut_pos,
        "advisor": advisor,
    }


def load_market(conn, trades: pd.DataFrame, pos: pd.DataFrame) -> dict:
    chain = prof.read_sql(
        conn,
        """
        SELECT trade_date::date AS dt, contract,
               impl_vol::float8 AS iv,
               delta::float8 AS delta,
               em_delta::float8 AS em_delta,
               COALESCE(clear, close)::float8 AS settl
        FROM raw_options_contracts_daily
        WHERE trade_date >= DATE '2026-06-01'
        """,
    )
    futs = prof.read_sql(
        conn,
        """
        SELECT trade_date::date AS dt, contract,
               COALESCE(clear, close)::float8 AS settl,
               COALESCE(volume, 0)::float8 AS volume,
               COALESCE(hqoi, 0)::float8 AS oi
        FROM raw_futures_contracts_daily
        WHERE trade_date >= DATE '2026-06-01'
        """,
    )
    civ = prof.read_sql(
        conn,
        """
        SELECT trade_date::date AS dt, LOWER(underlying_key) AS product, iv::float8 AS iv
        FROM raw_commodity_option_iv_daily
        WHERE trade_date >= DATE '2026-06-01'
        """,
    )
    for df in (chain, futs, civ):
        if not df.empty:
            df["dt"] = pd.to_datetime(df["dt"])
    if not chain.empty:
        chain["iv"] = to_percent(chain["iv"])
        delta = pd.to_numeric(chain["delta"], errors="coerce")
        em = pd.to_numeric(chain["em_delta"], errors="coerce")
        use = delta.where(delta.notna(), em)
        med = float(use.abs().median()) if use.notna().any() else float("nan")
        chain["delta"] = use / 100.0 if math.isfinite(med) and med > 2 else use
        chain["code"] = chain["contract"].map(norm_code)
        sample = chain["contract"].head(8).tolist()
        parsed = chain["contract"].map(parse_contract)
        keep = parsed.notna()
        print(f"option chain rows={len(chain)} parsed={int(keep.sum())} sample={sample}")
        chain = chain.loc[keep].copy()
        if chain.empty:
            chain = pd.DataFrame(columns=["dt", "contract", "iv", "delta", "code", "product", "month", "cp", "strike", "mkey"])
        else:
            info = pd.DataFrame(list(parsed.loc[chain.index]))
            info.index = chain.index
            chain["product"] = info["product"]
            chain["month"] = info["month"]
            chain["cp"] = info["cp"]
            chain["strike"] = info["strike"].astype(float)
            chain["mkey"] = chain["month"].map(month_key)
    if not futs.empty:
        futs["code"] = futs["contract"].map(norm_code)
        futs["settl"] = pd.to_numeric(futs["settl"], errors="coerce")
    if not civ.empty:
        civ["product"] = civ["product"].astype(str).str.upper()
        civ["iv"] = to_percent(civ["iv"])
    wanted = set()
    for df in (trades, pos):
        if not df.empty:
            wanted |= set(df["code"])
    chain_acc = chain.loc[chain["code"].isin(wanted)].copy() if not chain.empty else chain
    return {"chain": chain, "chain_acc": chain_acc, "futs": futs, "civ": civ}


def multipliers(trades: pd.DataFrame) -> dict[str, float]:
    t = trades[(trades["price"] > 0) & (trades["lots"] > 0) & (trades["turnover"] > 0)].copy()
    t["raw"] = t["turnover"] / (t["price"] * t["lots"])
    out = {}
    for prod, g in t.groupby("product"):
        med = float(g["raw"].median())
        snapped = snap_mult(med)
        out[prod] = snapped if math.isfinite(snapped) else med
    return out


def build_futures_px(futs: pd.DataFrame) -> pd.DataFrame:
    if futs.empty:
        return pd.DataFrame(columns=["dt", "code", "settl", "volume", "oi"])
    g = (
        futs.dropna(subset=["settl"])
        .sort_values(["volume", "oi"], ascending=False)
        .drop_duplicates(["dt", "code"], keep="first")
    )
    return g[["dt", "code", "settl", "volume", "oi"]]


def attach_underlying_fast(df: pd.DataFrame, fut_px: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()
    pieces = []
    base = out.reset_index().rename(columns={"index": "idx"})
    if "idx" not in base.columns:
        base["idx"] = base.index
    # reset_index keeps original index in 'index' only if it was unnamed; force it
    base = df.copy()
    base["idx"] = df.index
    long_rows = []
    for rec in base[["idx", "dt", "product", "month"]].itertuples(index=False):
        for k in fut_lookup_keys(rec.product, rec.month):
            long_rows.append((rec.idx, rec.dt, k))
    if not long_rows:
        out["fut"] = np.nan
        out["moneyness"] = np.nan
        return out
    long = pd.DataFrame(long_rows, columns=["idx", "dt", "fut_code"])
    hit = long.merge(fut_px, left_on=["dt", "fut_code"], right_on=["dt", "code"], how="inner")
    hit = hit.drop_duplicates("idx", keep="first")
    out["fut"] = hit.set_index("idx")["settl"].reindex(out.index)
    out["moneyness"] = out["strike"] / out["fut"]
    out.loc[~out["moneyness"].between(0.4, 2.5), "moneyness"] = np.nan
    return out


def build_surface(chain: pd.DataFrame, fut_px: pd.DataFrame) -> pd.DataFrame:
    """ATM IV, 5% wing IV, and near/far slope by product-day. One row per product-day."""
    if chain.empty:
        return pd.DataFrame()
    c = attach_underlying_fast(chain.dropna(subset=["iv"]), fut_px)
    c = c.dropna(subset=["moneyness", "iv", "mkey"])
    c = c[c["iv"].between(1, 250)]
    if c.empty:
        return pd.DataFrame()
    rows = []
    for (dt, product), g in c.groupby(["dt", "product"], sort=False):
        by_exp = []
        for mkey, eg in g.groupby("mkey"):
            atm = eg.loc[(eg["moneyness"] - 1).abs() <= 0.035, "iv"]
            if atm.empty:
                j = (eg["moneyness"] - 1).abs().idxmin()
                if abs(float(eg.loc[j, "moneyness"]) - 1) > 0.08:
                    continue
                atm_iv = float(eg.loc[j, "iv"])
            else:
                atm_iv = float(atm.median())
            puts = eg[(eg["cp"] == "P") & (eg["moneyness"].between(0.90, 0.98))]
            calls = eg[(eg["cp"] == "C") & (eg["moneyness"].between(1.02, 1.10))]
            put_iv = float(puts.iloc[(puts["moneyness"] - 0.95).abs().argmin()]["iv"]) if not puts.empty else np.nan
            call_iv = float(calls.iloc[(calls["moneyness"] - 1.05).abs().argmin()]["iv"]) if not calls.empty else np.nan
            by_exp.append((int(mkey), atm_iv, put_iv, call_iv))
        if not by_exp:
            continue
        by_exp.sort()
        near_m, near_iv, near_put, near_call = by_exp[0]
        far_m, far_iv, _, _ = by_exp[-1] if len(by_exp) > 1 else by_exp[0]
        slope = far_iv - near_iv if len(by_exp) > 1 else np.nan
        rr = near_call - near_put if math.isfinite(near_call) and math.isfinite(near_put) else np.nan
        wing_vals = [v for v in (near_call, near_put) if isinstance(v, float) and math.isfinite(v)]
        wing = (sum(wing_vals) / len(wing_vals) - near_iv) if wing_vals and math.isfinite(near_iv) else np.nan
        rows.append({
            "dt": dt,
            "product": product,
            "atm_iv": near_iv,
            "far_iv": far_iv,
            "slope": slope,
            "rr": rr,
            "wing": wing,
            "n_exp": len(by_exp),
            "front": near_m,
            "back": far_m,
        })
    return pd.DataFrame(rows)


def build_basis(fut_px: pd.DataFrame, products: set[str]) -> pd.DataFrame:
    if fut_px.empty:
        return pd.DataFrame()
    parsed = []
    for code, dt, px, vol, oi in fut_px[["code", "dt", "settl", "volume", "oi"]].itertuples(index=False):
        m = re.match(r"^([A-Z]+?)(\d{3,4})$", str(code))
        if not m:
            continue
        prod = m.group(1)
        if prod not in products and prod not in {UNDER_FUT.get(p, p) for p in products}:
            continue
        parsed.append((dt, prod, month_key(m.group(2)), float(px), float(vol or 0), float(oi or 0)))
    if not parsed:
        return pd.DataFrame()
    f = pd.DataFrame(parsed, columns=["dt", "product", "mkey", "px", "volume", "oi"])
    f = f[f["mkey"] > 0]
    rows = []
    for (dt, product), g in f.groupby(["dt", "product"], sort=False):
        g = g.sort_values("mkey")
        # prefer contracts that actually trade
        live = g[(g["volume"] > 0) | (g["oi"] > 0)]
        use = live if len(live) >= 2 else g
        use = use.drop_duplicates("mkey", keep="first").sort_values("mkey")
        if len(use) < 2:
            continue
        a = use.iloc[0]
        b = use.iloc[1]
        if a["px"] <= 0:
            continue
        gap_months = max(1, int(round((b["mkey"] - a["mkey"]) % 100 / 1)) )
        # mkey is YYYYMM, difference in months:
        ya, ma = divmod(int(a["mkey"]), 100)
        yb, mb = divmod(int(b["mkey"]), 100)
        months = (yb - ya) * 12 + (mb - ma)
        if months <= 0:
            continue
        raw = b["px"] / a["px"] - 1
        ann = raw * 12 / months
        rows.append({
            "dt": dt,
            "product": product,
            "basis": raw,
            "basis_ann": ann,
            "front": int(a["mkey"]),
            "next": int(b["mkey"]),
            "front_px": float(a["px"]),
        })
    return pd.DataFrame(rows)


def expanding_pct(df: pd.DataFrame, col: str) -> pd.Series:
    """Expanding percentile of col within product, using history up to that day."""
    out = pd.Series(np.nan, index=df.index, dtype=float)
    if df.empty:
        return out
    for _, g in df.groupby("product", sort=False):
        g = g.sort_values("dt")
        vals = g[col].to_numpy(dtype=float)
        pct = np.full(len(vals), np.nan)
        hist: list[float] = []
        for i, v in enumerate(vals):
            if math.isfinite(v):
                hist.append(v)
                pct[i] = float(np.mean(np.array(hist) <= v))
        out.loc[g.index] = pct
    return out


def perm_p_vs_half(day_packs: list[tuple[np.ndarray, int]], observed: float, n: int = 2000) -> float:
    if not day_packs or not math.isfinite(observed):
        return float("nan")
    rng = np.random.default_rng(7)
    hits = 0
    target = abs(observed - 0.5)
    for _ in range(n):
        means = []
        for values, k in day_packs:
            if k <= 0 or k > len(values):
                continue
            pick = rng.choice(values, size=k, replace=False)
            means.append(float(pick.mean()))
        if not means:
            continue
        if abs(float(np.mean(means)) - 0.5) >= target - 1e-12:
            hits += 1
    return (hits + 1) / (n + 1)


def fifo_closes(trades: pd.DataFrame) -> pd.DataFrame:
    if trades.empty:
        return pd.DataFrame()
    t = trades.sort_values(["dt", "hh", "mm", "contract"]).copy()
    books: dict[tuple, list] = {}
    matched = []
    for r in t.itertuples(index=False):
        key = (r.product, r.code)
        book = books.setdefault(key, [])
        lots = float(r.lots)
        px = fnum(r.price)
        if lots <= 0 or not math.isfinite(px):
            continue
        iv = fnum(getattr(r, "iv", np.nan))
        if r.is_open and r.is_sell:
            book.append({"left": lots, "px": px, "iv": iv, "dt": r.dt, "side": "S", "mny": fnum(getattr(r, "moneyness", np.nan)), "cp": r.cp})
        elif r.is_open and r.is_buy:
            book.append({"left": lots, "px": px, "iv": iv, "dt": r.dt, "side": "L", "mny": fnum(getattr(r, "moneyness", np.nan)), "cp": r.cp})
        elif r.is_close:
            want = "S" if r.is_buy else "L"  # buy close covers shorts; sell close covers longs
            left = lots
            for lot in book:
                if left <= 1e-9:
                    break
                if lot["side"] != want or lot["left"] <= 1e-9:
                    continue
                take = min(lot["left"], left)
                lot["left"] -= take
                left -= take
                matched.append({
                    "product": r.product,
                    "cp": r.cp,
                    "side": want,
                    "lots": take,
                    "open_dt": lot["dt"],
                    "close_dt": r.dt,
                    "hold": int((pd.Timestamp(r.dt) - pd.Timestamp(lot["dt"])).days),
                    "open_px": lot["px"],
                    "close_px": px,
                    "open_iv": lot["iv"],
                    "close_iv": iv,
                    "open_mny": lot["mny"],
                    "close_mny": fnum(getattr(r, "moneyness", np.nan)),
                })
    return pd.DataFrame(matched)


def analyze(raw: dict, mkt: dict) -> dict:
    trades = raw["opt_trades"]
    pos = raw["opt_pos"]
    daily = raw["daily"]
    mult = multipliers(trades)
    fut_px = build_futures_px(mkt["futs"])
    chain = mkt["chain"]
    chain_acc = attach_underlying_fast(mkt["chain_acc"], fut_px) if not mkt["chain_acc"].empty else mkt["chain_acc"]
    iv_map = chain_acc.dropna(subset=["iv"]).drop_duplicates(["dt", "code"])[["dt", "code", "iv", "delta"]] if not chain_acc.empty else pd.DataFrame(columns=["dt", "code", "iv", "delta"])
    trades = trades.merge(iv_map, on=["dt", "code"], how="left", suffixes=("", "_m"))
    trades = attach_underlying_fast(trades, fut_px)

    pos = pos.merge(
        chain_acc.drop_duplicates(["dt", "code"])[["dt", "code", "settl", "delta"]].rename(columns={"settl": "mkt_settl", "delta": "delta"}),
        on=["dt", "code"],
        how="left",
    ) if not chain_acc.empty else pos.assign(mkt_settl=np.nan, delta=np.nan)
    if "mkt_settl" not in pos.columns:
        pos["mkt_settl"] = np.nan
        pos["delta"] = np.nan
    pos["mark"] = pd.to_numeric(pos["settl"], errors="coerce")
    pos.loc[pos["mark"] <= 0, "mark"] = np.nan
    pos["mark"] = pos["mark"].fillna(pd.to_numeric(pos["mkt_settl"], errors="coerce"))
    pos["mult"] = pos["product"].map(mult)

    pos["float_pnl"] = 0.0
    short = (pos["short_lots"] > 0) & (pos["sell_px"] > 0) & pos["mark"].notna() & pos["mult"].notna()
    long = (pos["long_lots"] > 0) & (pos["buy_px"] > 0) & pos["mark"].notna() & pos["mult"].notna()
    pos.loc[short, "float_pnl"] = (pos.loc[short, "sell_px"] - pos.loc[short, "mark"]) * pos.loc[short, "short_lots"] * pos.loc[short, "mult"]
    pos.loc[long, "float_pnl"] = (pos.loc[long, "mark"] - pos.loc[long, "buy_px"]) * pos.loc[long, "long_lots"] * pos.loc[long, "mult"]
    pos["marked_short"] = np.where(short, pos["short_lots"], 0.0)
    pos["marked_long"] = np.where(long, pos["long_lots"], 0.0)
    pos["delta_lots"] = 0.0
    dlt = pd.to_numeric(pos["delta"], errors="coerce")
    pos.loc[short, "delta_lots"] = -dlt[short] * pos.loc[short, "short_lots"]
    pos.loc[long, "delta_lots"] = dlt[long] * pos.loc[long, "long_lots"]

    # market-value check: |mv| / (mark * lots) should be near the multiplier
    mv_lots = pos["long_lots"].where(pos["long_lots"] > 0, pos["short_lots"])
    chk = pos[(pos["opt_mv"].abs() > 0) & (pos["mark"] > 0) & (mv_lots > 0)].copy()
    chk["implied"] = chk["opt_mv"].abs() / (chk["mark"] * mv_lots)
    mv_ratio = float((chk["implied"] / chk["product"].map(mult)).median()) if not chk.empty else float("nan")

    by_day = pos.groupby("dt", as_index=False).agg(
        floating=("float_pnl", "sum"),
        float_short=("float_pnl", lambda s: float(s[pos.loc[s.index, "short_lots"] > 0].sum()) if len(s) else 0.0),
        short_lots=("short_lots", "sum"),
        long_lots=("long_lots", "sum"),
        marked_short=("marked_short", "sum"),
        marked_long=("marked_long", "sum"),
        margin=("margin", "sum"),
        opt_mv=("opt_mv", "sum"),
        broker_mtm=("mtm", "sum"),
        delta_lots=("delta_lots", "sum"),
    )
    # fix float_short with a cleaner split
    pos["float_short"] = np.where(pos["short_lots"] > 0, pos["float_pnl"], 0.0)
    pos["float_long"] = np.where(pos["long_lots"] > 0, pos["float_pnl"], 0.0)
    by_day = pos.groupby("dt", as_index=False).agg(
        floating=("float_pnl", "sum"),
        float_short=("float_short", "sum"),
        float_long=("float_long", "sum"),
        short_lots=("short_lots", "sum"),
        long_lots=("long_lots", "sum"),
        marked_short=("marked_short", "sum"),
        marked_long=("marked_long", "sum"),
        margin=("margin", "sum"),
        opt_mv=("opt_mv", "sum"),
        broker_mtm=("mtm", "sum"),
        delta_lots=("delta_lots", "sum"),
    )

    tclose = trades[trades["is_close"]].copy()
    realized = tclose.groupby("dt")["close_pnl"].sum().rename("realized_day")
    fees = trades.groupby("dt")["fee"].sum().rename("fee_day")
    path = by_day.merge(realized, on="dt", how="outer").merge(fees, on="dt", how="outer")
    if not daily.empty:
        path = path.merge(daily[["dt", "pnl", "equity", "close_pnl", "pos_pnl", "fee"]].rename(
            columns={"pnl": "broker_pnl", "fee": "broker_fee", "close_pnl": "broker_close", "pos_pnl": "broker_pos"}
        ), on="dt", how="outer")
    path = path.sort_values("dt").reset_index(drop=True)
    for col in ("realized_day", "fee_day", "broker_pnl", "floating"):
        if col not in path.columns:
            path[col] = 0.0
        path[col] = path[col].fillna(0.0)
    path["realized"] = path["realized_day"].cumsum()
    path["fees"] = path["fee_day"].cumsum()
    path["broker"] = path["broker_pnl"].cumsum()
    path["economic"] = path["realized"] + path["floating"]
    path["economic_net"] = path["economic"] - path["fees"]

    prod_end_dt = pos["dt"].max() if not pos.empty else pd.NaT
    end_pos = pos[pos["dt"] == prod_end_dt] if not pos.empty else pos
    end_by = end_pos.groupby("product").agg(
        floating=("float_pnl", "sum"),
        short_lots=("short_lots", "sum"),
        long_lots=("long_lots", "sum"),
        margin=("margin", "sum"),
    )
    real_by = tclose.groupby("product")["close_pnl"].sum().rename("realized")
    fee_by = trades.groupby("product")["fee"].sum().rename("fee")
    open_lots = trades[trades["is_open"]].groupby("product")["lots"].sum().rename("open_lots")
    prod = end_by.join(real_by, how="outer").join(fee_by, how="outer").join(open_lots, how="outer").fillna(0.0)
    prod["economic"] = prod["realized"] + prod["floating"]
    prod["net"] = prod["economic"] - prod["fee"]
    prod = prod.reset_index().sort_values("economic")

    # structure of opens
    opens = trades[trades["is_open"]].copy()
    opens["tag"] = np.where(opens["is_sell"], "S", "L") + opens["cp"].astype(str)
    sell_lots = float(opens.loc[opens["is_sell"], "lots"].sum())
    buy_lots = float(opens.loc[opens["is_buy"], "lots"].sum())
    open_lot_sum = sell_lots + buy_lots
    pivot = opens.pivot_table(index=["dt", "product"], columns="tag", values="lots", aggfunc="sum", fill_value=0)
    for col in ("SC", "SP", "LC", "LP"):
        if col not in pivot.columns:
            pivot[col] = 0.0
    pivot = pivot.reset_index()
    pivot["sell"] = pivot["SC"] + pivot["SP"]
    pivot["buy"] = pivot["LC"] + pivot["LP"]
    pivot["strangle"] = (pivot["SC"] > 0) & (pivot["SP"] > 0)
    pivot["wing"] = ((pivot["SC"] > 0) & (pivot["LC"] > 0)) | ((pivot["SP"] > 0) & (pivot["LP"] > 0))
    pivot["rr"] = ((pivot["SC"] > 0) & (pivot["LP"] > 0) & (pivot["SP"] == 0)) | ((pivot["SP"] > 0) & (pivot["LC"] > 0) & (pivot["SC"] == 0))
    nexp = opens.groupby(["dt", "product"])["mkey"].nunique().rename("n_exp")
    pivot = pivot.merge(nexp, on=["dt", "product"], how="left")
    pivot["calendar"] = pivot["n_exp"] >= 2
    # These four sell-lot blocks are exclusive and add up to the sell opens.
    # strangle/wing below still overlap, so they are not shares of the same 100%.
    both_only_m = pivot["strangle"] & ~pivot["wing"]
    both_wing_m = pivot["strangle"] & pivot["wing"]
    one_wing_m = pivot["wing"] & ~pivot["strangle"]
    one_naked_m = ~pivot["strangle"] & ~pivot["wing"] & (pivot["sell"] > 0)
    one_call_m = one_naked_m & (pivot["SC"] > 0) & (pivot["SP"] == 0)
    one_put_m = one_naked_m & (pivot["SP"] > 0) & (pivot["SC"] == 0)

    def _sell(mask) -> float:
        return float(pivot.loc[mask, "sell"].sum())

    sell_both_only = _sell(both_only_m)
    sell_both_wing = _sell(both_wing_m)
    sell_one_wing = _sell(one_wing_m)
    sell_one_naked = _sell(one_naked_m)
    sell_one_call = _sell(one_call_m)
    sell_one_put = _sell(one_put_m)
    sell_both = sell_both_only + sell_both_wing
    w = pivot["sell"] + pivot["buy"]
    wsum = float(w.sum()) or 1.0

    def wmean(mask) -> float:
        return float(w[mask].sum() / wsum)

    # surface on the opens themselves
    opens["iv_gap"] = opens["iv"] - np.nan  # filled after surface merge
    surface = build_surface(chain, fut_px)
    products = set(trades["product"]) | set(pos["product"])
    basis = build_basis(fut_px, products)
    # map HO basis onto IH
    if not basis.empty:
        extra = basis[basis["product"].isin(UNDER_FUT.values())].copy()
        inv = {v: k for k, v in UNDER_FUT.items()}
        extra["product"] = extra["product"].map(lambda p: inv.get(p, p))
        basis = pd.concat([basis, extra], ignore_index=True)

    civ = mkt["civ"]
    # prefer exchange/AkShare ATM when the product has 20+ prints; else the rebuilt front ATM
    atm = surface[["dt", "product", "atm_iv", "slope", "rr", "wing", "n_exp", "front", "back"]].copy() if not surface.empty else pd.DataFrame()
    if not civ.empty:
        civ_ok = civ.groupby("product")["iv"].apply(lambda s: int(s.notna().sum()))
        good = set(civ_ok[civ_ok >= 20].index)
        use_civ = civ[civ["product"].isin(good)][["dt", "product", "iv"]].rename(columns={"iv": "atm_pub"})
        if atm.empty:
            atm = use_civ.rename(columns={"atm_pub": "atm_iv"})
            for col in ("slope", "rr", "wing", "n_exp", "front", "back"):
                atm[col] = np.nan
        else:
            atm = atm.merge(use_civ, on=["dt", "product"], how="outer")
            atm["atm_iv"] = atm["atm_pub"].where(atm["atm_pub"].notna(), atm["atm_iv"])
    if not atm.empty:
        atm = atm.sort_values(["product", "dt"])
        atm["hist_n"] = atm.groupby("product").cumcount() + 1
        atm["iv_pct"] = expanding_pct(atm, "atm_iv")
        atm["slope_pct"] = expanding_pct(atm, "slope")
    if not basis.empty:
        basis = basis.sort_values(["product", "dt"])
        basis["hist_n"] = basis.groupby("product").cumcount() + 1
        basis["basis_pct"] = expanding_pct(basis, "basis_ann")

    opens = opens.merge(
        atm[["dt", "product", "atm_iv", "slope", "rr", "wing", "iv_pct", "slope_pct", "hist_n", "front", "back"]] if not atm.empty else pd.DataFrame(columns=["dt", "product"]),
        on=["dt", "product"],
        how="left",
        suffixes=("", "_atm"),
    )
    opens = opens.merge(
        basis[["dt", "product", "basis_ann", "basis_pct", "front", "next"]] if not basis.empty else pd.DataFrame(columns=["dt", "product"]),
        on=["dt", "product"],
        how="left",
        suffixes=("", "_b"),
    )
    if "front_b" in opens.columns:
        pass
    opens["iv_gap"] = opens["iv"] - opens["atm_iv"] if "atm_iv" in opens.columns else np.nan
    # front/back column collision
    if "front_x" in opens.columns:
        opens["front_m"] = opens["front_x"]
    elif "front" in opens.columns:
        opens["front_m"] = opens["front"]

    sell_opens = opens[opens["is_sell"]].copy()
    iv_ready = sell_opens[sell_opens["hist_n"].fillna(0) >= 20] if "hist_n" in sell_opens.columns else sell_opens.iloc[0:0]
    iv_lot_cover = float(iv_ready["lots"].sum() / sell_lots) if sell_lots else 0.0

    # within-day IV percentile test, unit = product he sell-opened
    day_packs = []
    chosen_pcts = []
    if not atm.empty and not sell_opens.empty:
        sold_keys = set(zip(sell_opens["dt"], sell_opens["product"]))
        for dt, g in atm[atm["hist_n"] >= 20].groupby("dt"):
            vals = g["iv_pct"].dropna().to_numpy(dtype=float)
            chosen = g[g.apply(lambda r: (r["dt"], r["product"]) in sold_keys, axis=1)]["iv_pct"].dropna().to_numpy(dtype=float)
            if len(vals) < 5 or len(chosen) == 0:
                continue
            day_packs.append((vals, len(chosen)))
            chosen_pcts.extend(chosen.tolist())
    iv_mean = float(np.mean(chosen_pcts)) if chosen_pcts else float("nan")
    iv_p = perm_p_vs_half(day_packs, iv_mean)

    # basis timing, same design
    basis_packs, basis_chosen = [], []
    if not basis.empty and not sell_opens.empty:
        sold_keys = set(zip(sell_opens["dt"], sell_opens["product"]))
        for dt, g in basis[basis["hist_n"] >= 20].groupby("dt"):
            vals = g["basis_pct"].dropna().to_numpy(dtype=float)
            chosen = g[g.apply(lambda r: (r["dt"], r["product"]) in sold_keys, axis=1)]["basis_pct"].dropna().to_numpy(dtype=float)
            if len(vals) < 5 or len(chosen) == 0:
                continue
            basis_packs.append((vals, len(chosen)))
            basis_chosen.extend(chosen.tolist())
    basis_mean = float(np.mean(basis_chosen)) if basis_chosen else float("nan")
    basis_p = perm_p_vs_half(basis_packs, basis_mean)
    basis_lot_cover = float(sell_opens.loc[sell_opens["basis_pct"].notna(), "lots"].sum() / sell_lots) if sell_lots and "basis_pct" in sell_opens.columns else 0.0

    # term structure: slope percentile on days he opens 2+ expiries vs single expiry
    cal = pivot[pivot["calendar"]].merge(atm[["dt", "product", "slope", "slope_pct"]], on=["dt", "product"], how="left") if not atm.empty else pd.DataFrame()
    single = pivot[~pivot["calendar"]].merge(atm[["dt", "product", "slope", "slope_pct"]], on=["dt", "product"], how="left") if not atm.empty else pd.DataFrame()

    def _mean(df, col):
        if df is None or df.empty or col not in df.columns:
            return float("nan"), 0
        s = df[col].dropna()
        return (float(s.mean()) if len(s) else float("nan")), int(len(s))

    cal_slope, n_cal = _mean(cal, "slope")
    single_slope, n_single = _mean(single, "slope")
    cal_pct, n_cal_pct = _mean(cal, "slope_pct")
    single_pct, _ = _mean(single, "slope_pct")

    # signed calendar tilt vs slope, on open product-days with a known front and back
    tilt_rows = []
    if not opens.empty and "front_m" in opens.columns and "back" in opens.columns:
        for (dt, product), g in opens.groupby(["dt", "product"]):
            front = g["front_m"].dropna()
            back = g["back"].dropna()
            if front.empty or back.empty:
                continue
            fkey = int(front.iloc[0])
            bkey = int(back.iloc[0])
            if fkey == bkey:
                continue
            signed = np.where(g["is_buy"], g["lots"], -g["lots"])
            front_s = float(signed[g["mkey"] == fkey].sum())
            back_s = float(signed[g["mkey"] == bkey].sum())
            other = float(signed[~g["mkey"].isin([fkey, bkey])].sum())
            slope = fnum(g["slope"].iloc[0]) if "slope" in g.columns else float("nan")
            tilt_rows.append({
                "dt": dt, "product": product, "tilt": back_s - front_s,
                "front_s": front_s, "back_s": back_s, "other": other, "slope": slope,
                "lots": float(g["lots"].sum()),
            })
    tilt = pd.DataFrame(tilt_rows)
    long_cal = tilt[tilt["tilt"] > 0] if not tilt.empty else tilt
    short_cal = tilt[tilt["tilt"] < 0] if not tilt.empty else tilt
    long_cal_slope, n_long_cal = _mean(long_cal, "slope")
    short_cal_slope, n_short_cal = _mean(short_cal, "slope")

    # rich/cheap of the strikes he sells, and buy-vs-sell IV on the same product-day
    sell_gap = sell_opens["iv_gap"].dropna() if "iv_gap" in sell_opens.columns else pd.Series(dtype=float)
    both = opens.groupby(["dt", "product"]).filter(lambda g: g["is_sell"].any() and g["is_buy"].any()) if not opens.empty else opens
    gaps = []
    if not both.empty and "iv" in both.columns:
        for (_, _), g in both.groupby(["dt", "product"]):
            s = g[g["is_sell"] & g["iv"].notna()]
            b = g[g["is_buy"] & g["iv"].notna()]
            if s.empty or b.empty:
                continue
            sw = float(np.average(s["iv"], weights=s["lots"]))
            bw = float(np.average(b["iv"], weights=b["lots"]))
            gaps.append({"gap": sw - bw, "lots": float(g["lots"].sum()), "sell_mny": float(np.average(s["moneyness"].dropna(), weights=s.loc[s["moneyness"].notna(), "lots"])) if s["moneyness"].notna().any() else np.nan,
                         "buy_mny": float(np.average(b["moneyness"].dropna(), weights=b.loc[b["moneyness"].notna(), "lots"])) if b["moneyness"].notna().any() else np.nan})
    gap_df = pd.DataFrame(gaps)
    surface_gap = float(np.average(gap_df["gap"], weights=gap_df["lots"])) if not gap_df.empty else float("nan")

    # moneyness
    def mny_stats(mask) -> dict:
        s = opens.loc[mask, ["moneyness", "lots"]].dropna()
        if s.empty:
            return {"n": 0, "med": float("nan"), "otm": float("nan")}
        med = float(np.average(s["moneyness"], weights=s["lots"]))
        # OTM: calls above 1, puts below 1
        return {"n": int(len(s)), "lots": float(s["lots"].sum()), "med": med}

    mny_sc = mny_stats(opens["is_sell"] & (opens["cp"] == "C") & opens["moneyness"].notna())
    mny_sp = mny_stats(opens["is_sell"] & (opens["cp"] == "P") & opens["moneyness"].notna())
    mny_cover = float(opens.loc[opens["is_sell"] & opens["moneyness"].notna(), "lots"].sum() / sell_lots) if sell_lots else 0.0

    # daily short-vol signature: economic change vs book IV change
    book = pos.groupby(["dt", "product"], as_index=False).agg(short_lots=("short_lots", "sum"), long_lots=("long_lots", "sum"), floating=("float_pnl", "sum"))
    if not atm.empty:
        book = book.merge(atm[["dt", "product", "atm_iv"]], on=["dt", "product"], how="left")
    path_chg = path[["dt", "economic_net"]].sort_values("dt").copy()
    path_chg["dpnl"] = path_chg["economic_net"].diff()
    iv_chg_rows = []
    und_rows = []
    if not book.empty and "atm_iv" in book.columns:
        b2 = book.sort_values(["product", "dt"])
        b2["div"] = b2.groupby("product")["atm_iv"].diff()
        for dt, g in b2.groupby("dt"):
            wts = (g["short_lots"] + g["long_lots"]).to_numpy()
            d = g["div"].to_numpy(dtype=float)
            ok = np.isfinite(d) & (wts > 0)
            iv_chg_rows.append({"dt": dt, "div": float(np.average(d[ok], weights=wts[ok])) if ok.any() else np.nan})
    ivchg = pd.DataFrame(iv_chg_rows)
    if not ivchg.empty:
        path_chg = path_chg.merge(ivchg, on="dt", how="left")
    # underlying move of the front future, weighted by short lots
    if not book.empty and not basis.empty:
        px = basis[["dt", "product", "front_px"]].drop_duplicates(["dt", "product"])
        b3 = book.merge(px, on=["dt", "product"], how="left").sort_values(["product", "dt"])
        b3["ret"] = b3.groupby("product")["front_px"].pct_change()
        rows = []
        for dt, g in b3.groupby("dt"):
            wts = g["short_lots"].to_numpy()
            r = g["ret"].to_numpy(dtype=float)
            ok = np.isfinite(r) & (wts > 0)
            rows.append({"dt": dt, "abs_ret": float(np.average(np.abs(r[ok]), weights=wts[ok])) if ok.any() else np.nan})
        path_chg = path_chg.merge(pd.DataFrame(rows), on="dt", how="left")

    def corr(a, b) -> tuple[float, int]:
        x = pd.DataFrame({"a": a, "b": b}).dropna()
        if len(x) < 5:
            return float("nan"), int(len(x))
        return float(x["a"].corr(x["b"])), int(len(x))

    # Some closes store the strike in 成交价 and leave 权利金/成交额 at 0. Use that day's option settlement.
    if not chain_acc.empty and "settl" in chain_acc.columns:
        mkt_px = chain_acc.dropna(subset=["settl"]).drop_duplicates(["dt", "code"])[["dt", "code", "settl"]]
        trades = trades.merge(mkt_px.rename(columns={"settl": "opt_settl"}), on=["dt", "code"], how="left")
    else:
        trades["opt_settl"] = np.nan
    pos_px = pos.loc[pos["mark"].notna() & (pos["mark"] > 0), ["dt", "code", "mark"]].drop_duplicates(["dt", "code"], keep="last")
    pos_px = pos_px.sort_values("dt")
    attached = []
    for _, g in trades.groupby("code", sort=False):
        g = g.sort_values("dt")
        ref = pos_px.loc[pos_px["code"] == g["code"].iloc[0], ["dt", "mark"]].sort_values("dt")
        if ref.empty:
            g["pos_mark"] = np.nan
        else:
            g = pd.merge_asof(g, ref, on="dt", direction="backward").rename(columns={"mark": "pos_mark"})
        attached.append(g)
    trades = pd.concat(attached, ignore_index=True)

    def repaired_price(row) -> float:
        price = fnum(row["price"])
        strike = fnum(row["strike"])
        settl = fnum(row["opt_settl"]) if "opt_settl" in row.index else float("nan")
        if not (math.isfinite(settl) and settl > 0):
            settl = fnum(row["pos_mark"]) if "pos_mark" in row.index else float("nan")
        bogus = (
            abs(fnum(row["premium"])) < 1e-9
            and abs(fnum(row["turnover"])) < 1e-9
            and math.isfinite(strike)
            and strike > 0
            and math.isfinite(price)
            and abs(price - strike) / strike < 0.03
        )
        if not bogus:
            return price
        if math.isfinite(settl) and 0 < settl < strike * 0.5:
            return float(settl)
        return float("nan")

    trades["price_raw"] = trades["price"]
    trades["price"] = trades.apply(repaired_price, axis=1)
    n_repaired = int((trades["price"].notna() & ((trades["price_raw"] - trades["price"]).abs() > 1e-6)).sum())
    n_unpriced = int(trades["price"].isna().sum())
    matched = fifo_closes(trades)
    if not matched.empty:
        matched["mult"] = matched["product"].map(mult)
        sign = np.where(matched["side"].eq("S"), 1.0, -1.0)
        matched["pnl"] = sign * (matched["open_px"] - matched["close_px"]) * matched["lots"] * matched["mult"]
        day_real = matched.dropna(subset=["pnl"]).groupby("close_dt")["pnl"].sum()
        path["realized_day"] = path["dt"].map(day_real).fillna(0.0)
        path["realized"] = path["realized_day"].cumsum()
        path["economic"] = path["realized"] + path["floating"]
        path["economic_net"] = path["economic"] - path["fees"]
        path_chg = path_chg.drop(columns=["economic_net", "dpnl"], errors="ignore").merge(
            path[["dt", "economic_net"]], on="dt", how="left"
        )
        path_chg["dpnl"] = path_chg["economic_net"].diff()
    short_m = matched[matched["side"] == "S"] if not matched.empty else matched
    if not short_m.empty:
        hold_med = float(np.average(short_m["hold"], weights=short_m["lots"]))
        prem_down = float(short_m.loc[short_m["close_px"] < short_m["open_px"], "lots"].sum() / short_m["lots"].sum())
        iv_pair = short_m[np.isfinite(short_m["open_iv"]) & np.isfinite(short_m["close_iv"])]
        iv_drop = float(np.average(iv_pair["close_iv"] - iv_pair["open_iv"], weights=iv_pair["lots"])) if not iv_pair.empty else float("nan")
        n_matched_lots = float(short_m["lots"].sum())
        n_iv_lots = float(iv_pair["lots"].sum()) if not iv_pair.empty else 0.0
        realized_total = float(matched["pnl"].sum())
    else:
        hold_med = prem_down = iv_drop = n_matched_lots = n_iv_lots = realized_total = float("nan")

    corr_iv, n_corr_iv = corr(path_chg.get("dpnl"), path_chg["div"]) if "div" in path_chg.columns else (float("nan"), 0)
    corr_gamma, n_corr_g = corr(path_chg.get("dpnl"), path_chg["abs_ret"]) if "abs_ret" in path_chg.columns else (float("nan"), 0)

    # futures hedge. Drop option rows that also land in the futures position file.
    fut = raw["fut_trades"].copy() if not raw["fut_trades"].empty else pd.DataFrame()
    if not fut.empty:
        fut = fut.loc[~fut["contract"].map(lambda c: parse_contract(c) is not None)].copy()
    fut_lots = float(fut["lots"].sum()) if not fut.empty else 0.0
    end_pos_delta = pos[pos["dt"] == pos["dt"].max()] if not pos.empty else pos
    end_lots = float((end_pos_delta["short_lots"] + end_pos_delta["long_lots"]).sum()) if not end_pos_delta.empty else 0.0
    delta_lots_known = float((end_pos_delta.loc[end_pos_delta["delta"].notna(), "short_lots"] + end_pos_delta.loc[end_pos_delta["delta"].notna(), "long_lots"]).sum()) if not end_pos_delta.empty and "delta" in end_pos_delta.columns else 0.0
    delta_cover = delta_lots_known / end_lots if end_lots else 0.0
    last_delta = float(by_day["delta_lots"].iloc[-1]) if not by_day.empty and delta_cover >= 0.4 else float("nan")
    if not raw["fut_pos"].empty:
        fp = raw["fut_pos"]
        fp = fp.loc[~fp["contract"].map(lambda c: parse_contract(c) is not None)].copy()
        lastf = fp[fp["dt"] == fp["dt"].max()] if not fp.empty else fp
        fut_net = float((lastf["long_lots"] - lastf["short_lots"]).sum()) if not lastf.empty else 0.0
        fut_names = sorted({prof.product_code(c) for c in lastf["contract"]}) if not lastf.empty else []
    else:
        fut_net, fut_names = 0.0, []

    marked_share = float(by_day["marked_short"].sum() / by_day["short_lots"].sum()) if by_day["short_lots"].sum() else 0.0
    broker_mtm_abs = float(pos["mtm"].abs().sum()) if not pos.empty else 0.0

    def verdict_iv():
        if not chosen_pcts or len(day_packs) < 5:
            return "样本不够", "卖开当天能对上平值隐波历史的品种太少，这条择时检验立不住。"
        if iv_mean >= 0.62 and iv_p <= 0.1:
            return "支持", f"他卖开的品种，平值隐波处在该品种自身历史的 {iv_mean:.0%} 分位，随机去选同一天的品种很少选得这么高（p≈{iv_p:.2f}）。"
        if iv_mean <= 0.38 and iv_p <= 0.1:
            return "反向", f"他卖开时平值隐波在历史的 {iv_mean:.0%} 分位，更像挑低波而不是高波（p≈{iv_p:.2f}）。"
        return "不支持", f"他卖开品种的平值隐波分位平均 {iv_mean:.0%}，和当天随便选一个品种差不多（p≈{iv_p:.2f}）。高波才卖这条，数据对不上。"

    def verdict_surface():
        if buy_lots < 0.15 * open_lot_sum:
            return "不支持", f"买开只占开仓手数的 {buy_lots / open_lot_sum:.0%}。曲面套利要同时买便宜的一边、卖贵的一边，这本账几乎只有卖出。"
        if not gap_df.empty and len(gap_df) >= 5 and surface_gap >= 1.0:
            return "部分支持", f"同一标的同一天又买又卖的日子里，卖出合约的隐波比买入高 {surface_gap:.1f} 个点。有相对价值的痕迹，但买腿手数仍然小。"
        if not gap_df.empty:
            return "不支持", f"又买又卖的标的-天上，卖出隐波减买入隐波平均 {surface_gap:.1f} 个点，价差没有稳定地卖在更贵的隐波上。"
        return "样本不够", "能同时配上买卖两边隐波的日子不够。"

    def verdict_term():
        if wmean(pivot["calendar"]) < 0.12 or n_cal < 4:
            return "不支持", f"开仓手数里跨月只占 {wmean(pivot['calendar']):.0%}。期限结构套应该反复出现两个到期月，这里很少。"
        if n_long_cal >= 3 and n_short_cal >= 3 and math.isfinite(long_cal_slope) and math.isfinite(short_cal_slope):
            if long_cal_slope < short_cal_slope - 0.3:
                return "部分支持", f"他做多远月、做空近月时，远月减近月的平值隐波是 {long_cal_slope:.1f} 个点；反过来做时是 {short_cal_slope:.1f}。方向上像在卖更贵的那一端。"
        if math.isfinite(cal_pct) and abs(cal_pct - 0.5) >= 0.12 and n_cal_pct >= 4:
            side = "远月比近月贵" if cal_pct > 0.5 else "近月比远月贵"
            return "弱支持", f"他做跨月的日子，期限斜率处在自身历史的 {cal_pct:.0%} 分位（{side}）。单月开仓是 {single_pct:.0%}。差别不大，只能算弱痕迹。"
        if not math.isfinite(cal_slope) or not math.isfinite(single_slope):
            return "样本不够", "跨月日子对不上近远月平值隐波，期限结构检验立不住。"
        return "不支持", f"跨月日的期限斜率 {cal_slope:.1f} 个点，单月日 {single_slope:.1f} 个点。没有稳定的期限结构交易。"

    def verdict_basis():
        if not basis_chosen or len(basis_packs) < 5:
            return "样本不够", "卖开当天能对上期货近远月价差的品种不够，基差择时检验立不住。"
        if basis_mean >= 0.62 and basis_p <= 0.1:
            return "支持", f"卖开时期货年化升水处在自身历史的 {basis_mean:.0%} 分位（p≈{basis_p:.2f}）。他偏在远月更贵的时候卖期权。"
        if basis_mean <= 0.38 and basis_p <= 0.1:
            return "反向", f"卖开时期货年化升水只有历史的 {basis_mean:.0%} 分位（p≈{basis_p:.2f}），偏在贴水而不是高升水。"
        return "不支持", f"卖开时近远月升水的历史分位平均 {basis_mean:.0%}（p≈{basis_p:.2f}），和普通日子没有差别。"

    delta_med = float(pos["delta"].abs().median()) if "delta" in pos.columns and pos["delta"].notna().any() else float("nan")

    def verdict_hedge():
        end_short_lots = float(by_day["short_lots"].iloc[-1]) if not by_day.empty else 0.0
        delta_txt = f"{last_delta:.1f}" if math.isfinite(last_delta) else "—"
        flat = (not math.isfinite(last_delta)) or abs(last_delta) < max(8.0, 0.08 * end_short_lots)
        if flat:
            return "不支持", (
                f"期末期权净 delta {delta_txt} 手，空头还有 {end_short_lots:.0f} 手，|delta| 中位数 {delta_med:.2f}。"
                "卖的是低 delta 虚值，多空翅膀自己把 delta 抵掉了。"
                f"期货净持仓 {fut_net:.0f} 手、这半个月成交 {fut_lots:.0f} 手，比残余 delta 大，是另一条方向腿，不是用来对冲卖权的。"
            )
        cover = abs(fut_net) / abs(last_delta)
        if cover < 0.3:
            return "不支持", (
                f"期末期权净 delta {delta_txt} 手期货，期货净持仓 {fut_net:.0f} 手，大约盖住 {cover:.0%}。"
                "Delta 对冲不是这本账的结构。"
            )
        return "部分支持", (
            f"期末期权净 delta {delta_txt} 手，期货净持仓 {fut_net:.0f} 手，大约盖住 {cover:.0%}。有对冲，还不是完全中性。"
        )

    def verdict_premium():
        if sell_lots >= 0.7 * open_lot_sum and sell_both >= 0.25 * sell_lots:
            return "支持", (
                f"卖开占开仓的 {sell_lots / open_lot_sum:.0%}，共 {sell_lots:.0f} 手。"
                f"同一天同一标的两边一起卖 {sell_both:.0f} 手：{sell_both_only:.0f} 手不再买翼，{sell_both_wing:.0f} 手又买了一翼。"
                f"只卖一边 {sell_one_wing + sell_one_naked:.0f} 手：{sell_one_wing:.0f} 手买了同向翼，{sell_one_naked:.0f} 手没有再买。"
                "四块相加就是全部卖开。主结构是卖波动，买翼只出现在一部分短腿上。"
            )
        if sell_lots >= 0.7 * open_lot_sum:
            return "部分支持", f"卖开占 {sell_lots / open_lot_sum:.0%}，同一天两边一起卖 {sell_both:.0f} 手。更像单边卖虚值，不是成对的跨式。"
        return "不支持", "买卖开仓接近，不是以卖权利金为主。"

    v_prem = verdict_premium()
    v_iv = verdict_iv()
    v_surf = verdict_surface()
    v_term = verdict_term()
    v_basis = verdict_basis()
    v_hedge = verdict_hedge()

    # short gamma / short vega sentence from correlations
    if not math.isfinite(corr_iv):
        vega_txt = "日度经济盈亏和隐波变化重叠的天数不够，短 vega 的相关先不写。"
    elif corr_iv <= -0.25:
        vega_txt = f"日度经济盈亏和持仓加权的平值隐波变化相关 {corr_iv:.2f}（{n_corr_iv} 天）。隐波上升时这本账亏钱，方向上是短 vega。"
    elif corr_iv >= 0.25:
        vega_txt = f"日度经济盈亏和隐波变化相关 {corr_iv:.2f}（{n_corr_iv} 天）。隐波上升时账户在赚，这不像短波动。"
    else:
        vega_txt = f"日度经济盈亏和隐波变化相关 {corr_iv:.2f}（{n_corr_iv} 天）。相关接近 0，这半个月看不出稳定的短 vega。"
    if not math.isfinite(corr_gamma):
        gamma_txt = "标的涨跌和经济盈亏重叠的天数不够，短 gamma 的日度形状先不写。"
    elif corr_gamma <= -0.25:
        gamma_txt = f"和经济盈亏、标的绝对涨跌的相关是 {corr_gamma:.2f}（{n_corr_g} 天）：标的动得越大，账越差，这是短 gamma 的形状。"
    else:
        gamma_txt = f"和经济盈亏、标的绝对涨跌的相关是 {corr_gamma:.2f}（{n_corr_g} 天）。短 gamma 的日度痕迹还不清楚。"

    theories = [
        {"id": "卖权利金", "verdict": v_prem[0], "text": v_prem[1]},
        {"id": "高隐波才卖", "verdict": v_iv[0], "text": v_iv[1]},
        {"id": "曲面相对价值", "verdict": v_surf[0], "text": v_surf[1]},
        {"id": "期限结构", "verdict": v_term[0], "text": v_term[1]},
        {"id": "基差择时", "verdict": v_basis[0], "text": v_basis[1]},
        {"id": "Delta 对冲", "verdict": v_hedge[0], "text": v_hedge[1]},
    ]

    call_gap = sell_opens.loc[sell_opens["cp"] == "C", "iv_gap"].dropna()
    put_gap = sell_opens.loc[sell_opens["cp"] == "P", "iv_gap"].dropna()

    advisor = raw["advisor"]
    name = str(advisor.iloc[0]["advisor_name"]) if not advisor.empty else ""
    company = str(advisor.iloc[0]["company"]) if not advisor.empty and "company" in advisor.columns else ""

    return {
        "name": name,
        "company": company,
        "from": str(pd.Timestamp(trades["dt"].min()).date()) if not trades.empty else "",
        "to": str(pd.Timestamp(trades["dt"].max()).date()) if not trades.empty else "",
        "n_trades": int(len(trades)),
        "n_contracts": int(trades["code"].nunique()) if not trades.empty else 0,
        "n_products": int(trades["product"].nunique()) if not trades.empty else 0,
        "lots": float(trades["lots"].sum()) if not trades.empty else 0,
        "sell_lots": sell_lots,
        "buy_lots": buy_lots,
        "open_lots": open_lot_sum,
        "close_lots": float(trades.loc[trades["is_close"], "lots"].sum()) if not trades.empty else 0,
        "sell_call": float(opens.loc[opens["is_sell"] & (opens["cp"] == "C"), "lots"].sum()),
        "sell_put": float(opens.loc[opens["is_sell"] & (opens["cp"] == "P"), "lots"].sum()),
        "strangle": wmean(pivot["strangle"]),
        "wing": wmean(pivot["wing"]),
        "rr_share": wmean(pivot["rr"]),
        "calendar": wmean(pivot["calendar"]),
        "sell_both": sell_both,
        "sell_both_only": sell_both_only,
        "sell_both_wing": sell_both_wing,
        "sell_one_wing": sell_one_wing,
        "sell_one_naked": sell_one_naked,
        "sell_one_call": sell_one_call,
        "sell_one_put": sell_one_put,
        "n_pdays": int(len(pivot)),
        "premium_net": float(trades["premium"].sum()) if not trades.empty else 0,
        "fees": float(trades["fee"].sum()) if not trades.empty else 0,
        "broker_pnl": float(daily["pnl"].sum()) if not daily.empty else 0,
        "broker_mtm_abs": broker_mtm_abs,
        "marked_share": marked_share,
        "mv_ratio": mv_ratio,
        "end_floating": float(path["floating"].iloc[-1]) if not path.empty else 0,
        "end_realized": float(path["realized"].iloc[-1]) if not path.empty else 0,
        "end_econ": float(path["economic_net"].iloc[-1]) if not path.empty else 0,
        "end_short": float(by_day["short_lots"].iloc[-1]) if not by_day.empty else 0,
        "end_long": float(by_day["long_lots"].iloc[-1]) if not by_day.empty else 0,
        "end_margin": float(by_day["margin"].iloc[-1]) if not by_day.empty else 0,
        "end_date": str(pd.Timestamp(by_day["dt"].iloc[-1]).date()) if not by_day.empty else "",
        "iv_mean": iv_mean,
        "iv_p": iv_p,
        "iv_days": len(day_packs),
        "iv_cover": iv_lot_cover,
        "basis_mean": basis_mean,
        "basis_p": basis_p,
        "basis_days": len(basis_packs),
        "basis_cover": basis_lot_cover,
        "cal_slope": cal_slope,
        "single_slope": single_slope,
        "cal_pct": cal_pct,
        "single_pct": single_pct,
        "n_cal": n_cal,
        "n_single": n_single,
        "long_cal_slope": long_cal_slope,
        "short_cal_slope": short_cal_slope,
        "n_long_cal": n_long_cal,
        "n_short_cal": n_short_cal,
        "surface_gap": surface_gap,
        "n_surface": int(len(gap_df)),
        "sell_gap": float(sell_gap.mean()) if len(sell_gap) else float("nan"),
        "n_sell_gap": int(len(sell_gap)),
        "call_gap": float(call_gap.mean()) if len(call_gap) else float("nan"),
        "put_gap": float(put_gap.mean()) if len(put_gap) else float("nan"),
        "mny_sc": mny_sc,
        "mny_sp": mny_sp,
        "mny_cover": mny_cover,
        "hold_med": hold_med,
        "prem_down": prem_down,
        "iv_drop": iv_drop,
        "n_matched_lots": n_matched_lots if isinstance(n_matched_lots, float) else float("nan"),
        "n_iv_lots": n_iv_lots if isinstance(n_iv_lots, float) else 0,
        "corr_iv": corr_iv,
        "n_corr_iv": n_corr_iv,
        "corr_gamma": corr_gamma,
        "vega_txt": vega_txt,
        "gamma_txt": gamma_txt,
        "fut_lots": fut_lots,
        "fut_net": fut_net,
        "fut_names": fut_names,
        "last_delta": last_delta,
        "delta_med": delta_med,
        "n_repaired": n_repaired,
        "n_unpriced": n_unpriced,
        "theories": theories,
        "path": path,
        "prod": prod,
        "fut": fut,
        "mult": mult,
        "opens": opens,
        "sell_opens": sell_opens,
    }


def savefig(fig, name: str) -> Path:
    CHART.mkdir(parents=True, exist_ok=True)
    path = CHART / name
    fig.savefig(path, dpi=160, bbox_inches="tight")
    plt.close(fig)
    return path


def charts(res: dict) -> dict[str, Path]:
    fp = prof.fp()
    path = res["path"].copy()
    path["dt"] = pd.to_datetime(path["dt"])
    fig, ax = plt.subplots(figsize=(9.4, 4.8))
    ax.plot(path["dt"], path["economic_net"] / 10000, color=prof.C_NAVY, lw=2.0, label="期权经济盈亏（已实现+浮动−手续费）")
    ax.plot(path["dt"], path["floating"] / 10000, color=prof.C_ORANGE, lw=1.4, label="仍在仓的浮动")
    ax.plot(path["dt"], path["realized"] / 10000, color=prof.C_TEAL, lw=1.2, label="已平仓盈亏")
    ax.plot(path["dt"], path["broker"] / 10000, color=prof.C_GOLD, lw=1.3, ls="--", label="日报累计当日盈亏")
    ax.axhline(0, color="#A0AEC0", lw=0.8)
    ax.set_ylabel("万元", **fp)
    ax.set_title("RX383 期权浮动盈亏（持仓盈亏字段为 0，这里用结算价对开仓价重估）", **fp)
    ax.grid(True, color="#E2E8F0", lw=0.6)
    ax.legend(prop=prof._CN_FONT, frameon=False, fontsize=8)
    fig.autofmt_xdate()
    fig.tight_layout()
    p1 = savefig(fig, "floating.png")

    prod = res["prod"].sort_values("net")
    fig, ax = plt.subplots(figsize=(9.4, 5.2))
    colors = [prof.C_RED if v < 0 else prof.C_GREEN for v in prod["net"]]
    labels = [prof.pname(x) for x in prod["product"]]
    ax.barh(labels, prod["net"] / 10000, color=colors)
    ax.axvline(0, color="#A0AEC0", lw=0.8)
    ax.set_xlabel("万元（已实现 + 期末浮动 − 手续费）", **fp)
    ax.set_title("期权经济盈亏按标的", **fp)
    ax.grid(True, axis="x", color="#E2E8F0", lw=0.6)
    fig.tight_layout()
    p2 = savefig(fig, "by_product.png")

    so = res["sell_opens"]
    fig, ax = plt.subplots(figsize=(9.4, 4.4))
    for cp, color, name in (("C", prof.C_RED, "卖认购"), ("P", prof.C_TEAL, "卖认沽")):
        s = so.loc[(so["cp"] == cp) & so["moneyness"].notna(), "moneyness"]
        if s.empty:
            continue
        ax.hist(s, bins=np.linspace(0.7, 1.3, 25), alpha=0.55, color=color, label=name)
    ax.axvline(1, color="#1A202C", lw=0.8)
    ax.set_xlabel("行权价 / 期货价", **fp)
    ax.set_title("卖开 strike 的虚实值（1 = 平值）", **fp)
    ax.legend(prop=prof._CN_FONT, frameon=False)
    ax.grid(True, color="#E2E8F0", lw=0.6)
    fig.tight_layout()
    p3 = savefig(fig, "moneyness.png")

    fig, ax = plt.subplots(figsize=(9.4, 4.4))
    pct = so["iv_pct"].dropna() if "iv_pct" in so.columns else pd.Series(dtype=float)
    if not pct.empty:
        ax.hist(pct, bins=np.linspace(0, 1, 11), color=prof.C_NAVY, alpha=0.85)
    ax.axvline(0.5, color=prof.C_GOLD, lw=1.2, label="历史中位数")
    if math.isfinite(res["iv_mean"]):
        ax.axvline(res["iv_mean"], color=prof.C_ORANGE, lw=1.4, label=f"卖开均值 {res['iv_mean']:.0%}")
    ax.set_xlabel("卖开当日，该品种平值隐波的扩展历史分位", **fp)
    ax.set_title("他是不是在高隐波时卖开", **fp)
    ax.legend(prop=prof._CN_FONT, frameon=False)
    ax.grid(True, color="#E2E8F0", lw=0.6)
    fig.tight_layout()
    p4 = savefig(fig, "iv_pct.png")
    return {"floating": p1, "product": p2, "mny": p3, "iv": p4}


def add_pic(doc, path: Path):
    if path and path.exists():
        doc.add_picture(str(path), width=Inches(6.3))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER


def write_doc(res: dict, pics: dict, out_path: Path) -> None:
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.left_margin = Cm(1.8)
    sec.right_margin = Cm(1.8)
    sec.top_margin = Cm(1.6)
    sec.bottom_margin = Cm(1.6)
    def ntext(v, digits=1, pct=False) -> str:
        try:
            x = float(v)
        except (TypeError, ValueError):
            return "—"
        if not math.isfinite(x):
            return "—"
        return f"{x:.0%}" if pct else f"{x:.{digits}f}"

    prof.heading.offset = 0
    prof.para(doc, "内部资料 · 期权策略检验 · 请勿外传", size=9, color=prof.GOLD, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=14)
    prof.para(doc, "RX383 期权策略深挖", size=24, bold=True, color=prof.NAVY, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
    who = " · ".join(x for x in [res["name"] or "未登记投顾", res["company"] or "未登记团队"] if x)
    prof.para(doc, who, size=12, color=prof.TEXT, align=WD_ALIGN_PARAGRAPH.CENTER)
    prof.para(
        doc,
        f"期权成交  {res['from']}  ~  {res['to']}      {res['n_trades']} 笔 / {res['lots']:.0f} 手      {res['n_products']} 个标的",
        size=11, color=prof.MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12,
    )
    prof.heading(doc, "一、先说结论", 1)
    supported = [t for t in res["theories"] if t["verdict"] in ("支持", "部分支持", "弱支持")]
    rejected = [t for t in res["theories"] if t["verdict"] in ("不支持", "反向")]
    prof.para(
        doc,
        f"这段样本很短，从 {res['from']} 到 {res['to']}。结论是这半个月他的期权账在做什么，不能外推成稳定的策略容量。"
        f"数据对得上的是：{ '、'.join(t['id'] for t in supported) or '没有一条理论被稳定支持' }。"
        f"对不上的是：{ '、'.join(t['id'] for t in rejected) or '没有' }。",
    )
    flips = [t for t in res["theories"] if t["verdict"] == "反向"]
    if flips:
        prof.para(doc, "标成「反向」的理论不是没有差异，是差异的方向和原假设相反。" + flips[0]["text"])
    prof.para(doc, res["vega_txt"] + res["gamma_txt"])
    prof.para(
        doc,
        f"到 {res['end_date']}，期权相对开仓价的浮动盈亏 {prof.fmt_money(res['end_floating'], True)} 元，"
        f"已平仓 {prof.fmt_money(res['end_realized'], True)} 元，减去手续费后经济盈亏 {prof.fmt_money(res['end_econ'], True)} 元。"
        f"同一段日报累计当日盈亏 {prof.fmt_money(res['broker_pnl'], True)} 元。两条线度量的不是同一件事：日报是账户现金路径，浮动是期权库存相对卖出价/买入价的盯市。",
    )
    rows = [[t["id"], t["verdict"], t["text"]] for t in res["theories"]]
    prof.add_table(doc, ["理论", "数据", "检验"], rows)
    prof.caption(doc, "表1  六条理论。分位用卖出日之前、含当日的该品种自身历史，避免用到未来。p 值是同一天里把他的选择和随机选品种做比较。")

    prof.heading(doc, "二、浮动盈亏", 1)
    prof.para(
        doc,
        f"期权持仓明细里的「持仓盈亏」合计绝对值是 {prof.fmt_money(res['broker_mtm_abs'])} 元，也就是没有盯市。"
        f"浮动盈亏改用今结算价对开仓价重估：空头 (卖出价 − 结算价) × 手数 × 合约乘数，多头相反。"
        f"能配上结算价的空头手数占 {res['marked_share']:.0%}。"
        f"用期权市值反推的乘数，和成交额反推的乘数中位数之比是 {ntext(res['mv_ratio'], 2)}（接近 1 说明乘数没有配错）。"
        "平仓盈亏字段同样是 0，已平仓改用先开先平的成交价差乘合约乘数。"
        f"有 {res['n_repaired']} 笔平仓把行权价写进了成交价、权利金为 0，这几笔改用当天或之前最近的持仓结算价；仍有 {res['n_unpriced']} 笔对不上，不计入已实现。",
    )
    prof.para(
        doc,
        f"这套经济盈亏已经是相对开仓价的全额盈亏，卖出时收进的净权利金 {prof.fmt_money(res['premium_net'], True)} 元不要再加一次。"
        "权利金是现金流入；结算价相对卖出价的差额，才是这笔卖权到今天赚了还是亏了。"
        "留仓浮动的绝对额远小于收进的权利金，说明现价仍贴着卖出价：时间价值还没有落成利润。",
    )
    prof.para(
        doc,
        "图里的橙线是还留在仓里的浮动，青线是已经平掉的盈亏，海军蓝是两者相加再减手续费。金色虚线是日报累计当日盈亏，含期货、出入金以外的账户盈亏，不含这套期权盯市。",
    )
    add_pic(doc, pics.get("floating"))
    prof.caption(doc, "图1  期权经济盈亏与日报累计盈亏。浮动是相对开仓价的库存盯市，不是经纪商字段。")
    show = res["path"].dropna(subset=["dt"]).copy()
    show["dt"] = pd.to_datetime(show["dt"])
    # keep days that are in the option book or the daily report
    table_rows = []
    for r in show.itertuples(index=False):
        table_rows.append([
            pd.Timestamp(r.dt).strftime("%m-%d"),
            prof.fmt_money(r.broker, True),
            prof.fmt_money(r.realized, True),
            prof.fmt_money(r.floating, True),
            prof.fmt_money(r.economic_net, True),
            f"{getattr(r, 'short_lots', 0) or 0:.0f}",
            f"{getattr(r, 'long_lots', 0) or 0:.0f}",
        ])
    prof.add_table(doc, ["日期", "日报累计", "已平仓", "浮动", "经济盈亏", "空头", "多头"], table_rows)
    prof.caption(doc, "表2  每个交易日的累计路径。空头、多头是当日持仓手数。经济盈亏 = 已平仓 + 浮动 − 累计手续费。")
    add_pic(doc, pics.get("product"))
    prof.caption(doc, "图2  标的贡献。负值是这套重估下的亏损，正值是盈利。")
    top = res["prod"].reindex(res["prod"]["net"].abs().sort_values(ascending=False).index).head(12)
    prod_rows = []
    for r in top.itertuples(index=False):
        prod_rows.append([
            prof.pname(r.product),
            f"{r.open_lots:.0f}",
            f"{r.short_lots:.0f}/{r.long_lots:.0f}",
            prof.fmt_money(r.realized, True),
            prof.fmt_money(r.floating, True),
            prof.fmt_money(r.net, True),
        ])
    prof.add_table(doc, ["标的", "开仓手数", "期末空/多", "已平仓", "期末浮动", "经济盈亏"], prod_rows)
    prof.caption(doc, "表3  贡献绝对值最大的标的。期末空/多是最后一天的持仓手数。")

    prof.heading(doc, "三、仓位结构", 1)
    prof.para(
        doc,
        f"开仓 {res['open_lots']:.0f} 手，其中卖出 {res['sell_lots']:.0f} 手（认购 {res['sell_call']:.0f}、认沽 {res['sell_put']:.0f}），买入 {res['buy_lots']:.0f} 手。"
        f"平仓 {res['close_lots']:.0f} 手。成交 {res['n_contracts']} 个合约、{res['n_products']} 个标的。"
        f"卖开按同一天、同一品种拆成四块，手数相加就是 {res['sell_lots']:.0f}："
        f"两边一起卖、不再买翼 {res['sell_both_only']:.0f} 手，"
        f"两边一起卖、当天又买了一翼 {res['sell_both_wing']:.0f} 手，"
        f"只卖一边、又买了同向一翼 {res['sell_one_wing']:.0f} 手，"
        f"只卖一边、没有再买 {res['sell_one_naked']:.0f} 手（认购 {res['sell_one_call']:.0f}、认沽 {res['sell_one_put']:.0f}）。"
        f"两个到期月同时出现的开仓占 {res['calendar']:.0%}，叠在这四块上面。"
        f"净权利金 {prof.fmt_money(res['premium_net'], True)} 元，手续费 {prof.fmt_money(res['fees'])} 元。"
        f"期末 {res['end_date']} 空头 {res['end_short']:.0f} 手、多头 {res['end_long']:.0f} 手，期权保证金 {prof.fmt_money(res['end_margin'])} 元。",
    )
    sc, sp = res["mny_sc"], res["mny_sp"]
    prof.para(
        doc,
        f"卖开里能配上期货价格的手数占 {res['mny_cover']:.0%}。卖认购的手数加权行权价/期货价是 {ntext(sc.get('med'), 3)}，卖认沽是 {ntext(sp.get('med'), 3)}。"
        "认购大于 1、认沽小于 1 就是虚值。离 1 越远，卖的是越虚的翅膀。"
        f"期末持仓 |delta| 中位数 {ntext(res['delta_med'], 2)}，和虚值卖权一致：单腿 delta 很小，认购和认沽叠在一起后净 delta 接近 0。",
    )
    add_pic(doc, pics.get("mny"))
    prof.caption(doc, "图3  卖开的虚实值。平值在 1。")

    prof.heading(doc, "四、高隐波才卖？", 1)
    prof.para(doc, res["theories"][1]["text"])
    prof.para(
        doc,
        f"这条检验覆盖卖开手数的 {res['iv_cover']:.0%}，用到 {res['iv_days']} 个交易日。分母是当天所有已经有至少 20 个历史观测的品种，不是只在他交易过的名字里挑。"
        "平值隐波优先用商品期权序列；没有序列的品种，用期权链上最接近平值的合约隐波。"
        + (
            f"他卖出的合约相对同一天平值隐波，平均高 {ntext(res['sell_gap'])} 个点（{res['n_sell_gap']} 笔有隐波）。认购卖出相对平值 {ntext(res['call_gap'])} 个点，认沽 {ntext(res['put_gap'])} 个点。"
            if res["n_sell_gap"]
            else "成交合约在行情库里没有逐合约隐波，卖出的翅膀比平值贵还是便宜，这一条对不上。"
        ),
    )
    add_pic(doc, pics.get("iv"))
    prof.caption(doc, "图4  卖开时该品种平值隐波的历史分位。0.5 是他自己的历史中位数。")

    prof.heading(doc, "五、曲面、期限和基差", 1)
    prof.para(doc, "曲面套看的是同一天同一标的，卖出的隐波是否系统性高于买入的隐波，以及卖出的翅膀是否比平值更贵。")
    prof.para(doc, res["theories"][2]["text"])
    prof.para(
        doc,
        f"期限结构用近月平值隐波和最远月平值隐波的差，单位是波动率百分点。他跨月开仓的日子，斜率平均 {ntext(res['cal_slope'], 2)}（{res['n_cal']} 个标的-日，历史分位 {ntext(res['cal_pct'], pct=True)}）；"
        f"只做一个月的日子，斜率平均 {ntext(res['single_slope'], 2)}（{res['n_single']} 个，分位 {ntext(res['single_pct'], pct=True)}）。"
        f"在已知近月、远月的开仓里，做多远月做空近月时斜率 {ntext(res['long_cal_slope'], 2)}（{res['n_long_cal']} 个），做空远月做多近月时 {ntext(res['short_cal_slope'], 2)}（{res['n_short_cal']} 个）。",
    )
    prof.para(doc, res["theories"][3]["text"])
    prof.para(
        doc,
        "基差这里是期货曲线，不是现货基差。商品现货基差在库里只覆盖股指。期权标的是期货，所以用近月结算价和次近月结算价：远月相对近月的升水，再按月份间隔年化。"
        f"卖开手数里能配上这条曲线的占 {res['basis_cover']:.0%}，检验用了 {res['basis_days']} 天。",
    )
    prof.para(doc, res["theories"][4]["text"])

    prof.heading(doc, "六、平仓时的市场，和期货腿", 1)
    if math.isfinite(res["hold_med"]):
        prof.para(
            doc,
            f"用先开先平把卖开和平仓配上，配上的空头 {res['n_matched_lots']:.0f} 手。手数加权持有 {res['hold_med']:.1f} 个自然日。"
            f"其中 {res['prem_down']:.0%} 的手数平仓价低于开仓价，空头在权利金上是赚的。"
            f"能同时配上开仓和平仓隐波的 {res['n_iv_lots']:.0f} 手里，平仓隐波减开仓隐波平均 {ntext(res['iv_drop'], 2)} 个点。负数表示他平在更低的隐波上。",
        )
    else:
        prof.para(doc, "样本里平仓还对不上开仓队列，持有期和隐波变化先不写。")
    prof.para(doc, res["theories"][5]["text"])
    if not res["fut"].empty:
        frows = []
        for r in res["fut"].itertuples(index=False):
            frows.append([
                pd.Timestamp(r.dt).strftime("%m-%d"),
                str(r.contract),
                str(r.bs),
                str(r.oc),
                f"{float(r.lots):.0f}",
                f"{float(r.price):.2f}",
            ])
        prof.add_table(doc, ["日期", "合约", "买卖", "开平", "手数", "价格"], frows)
        prof.caption(doc, "表4  全部期货成交。手数相对期权库存很小。")

    prof.heading(doc, "七、样本边界", 1)
    notes = [
        "期权成交从 mom_options_trade_details，持仓从 mom_options_position_details，日报从 mom_daily_reports。账户 rx383。",
        "浮动盈亏只用持仓行上的卖出价或买入价对今结算价。结算价缺失时用 raw_options_contracts_daily 的结算/收盘。合约乘数用成交额 / (成交价 × 手数) 的中位数，并落到常见乘数档。",
        "持仓盈亏字段全是 0，所以这张图不是把经纪商盈亏再画一遍。它回答的是：相对自己的开仓价，这本期权现在是浮盈还是浮亏。",
        "平值隐波、期限斜率来自 raw_commodity_option_iv_daily 和 raw_options_contracts_daily 的隐波。期货价格来自 raw_futures_contracts_daily。基差是近月对次近月，不是现货基差。",
        "历史分位从 2026-06 起算到交易当日，含当日。品种历史不足 20 天的不进入择时检验。同一天的品种之间并不独立，p 值偏乐观，只用来判断方向是否明显。",
        "样本大约三个星期。一条理论被标成「支持」，只说明这半个月的成交长这样。",
        f"生成日期 {date.today().isoformat()}。",
    ]
    for n in notes:
        bp = doc.add_paragraph(style="List Number")
        prof.add_text(bp, n, size=10, color=prof.TEXT)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_path))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    try:
        print("loading account…")
        raw = load_account(conn)
        print(
            "trades", len(raw["opt_trades"]),
            "pos", len(raw["opt_pos"]),
            "daily", len(raw["daily"]),
            "fut", len(raw["fut_trades"]),
        )
        print("loading market…")
        mkt = load_market(conn, raw["opt_trades"], raw["opt_pos"])
        print("chain", len(mkt["chain"]), "futs", len(mkt["futs"]), "civ", len(mkt["civ"]))
    finally:
        conn.close()
    print("analyzing…")
    res = analyze(raw, mkt)
    printable = {k: v for k, v in res.items() if k not in {"path", "prod", "fut", "opens", "sell_opens", "mult"}}
    printable["mult"] = res["mult"]
    printable["end_by_product"] = res["prod"].sort_values("net").to_dict(orient="records")
    (OUT / "summary.json").write_text(json.dumps(printable, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print("theories:")
    for t in res["theories"]:
        print(f"  [{t['verdict']}] {t['id']}: {t['text']}")
    print(
        f"floating={res['end_floating']:.0f} realized={res['end_realized']:.0f} "
        f"econ={res['end_econ']:.0f} broker={res['broker_pnl']:.0f} mv_ratio={res['mv_ratio']:.3f} marked={res['marked_share']:.2f}"
    )
    print("charts…")
    pics = charts(res)
    out = ROOT / "reports" / "RX383_期权策略深挖.docx"
    print("word…")
    write_doc(res, pics, out)
    print("report", out)


if __name__ == "__main__":
    main()
