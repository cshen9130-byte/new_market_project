# -*- coding: utf-8 -*-
"""Contract and premium for a nonferrous name, known before the open.

Month is the front option month whose expiry is still at least four calendar
days away. The call is 10% out and the put is 14% out, snapped to the exchange
strike step, off the prior session's future. The premium is Black-76 at the
prior session's ATM, rate zero.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as rep  # noqa: E402
import _rx383_metal_model as mm  # noqa: E402
import _rx383_metal_predict as pred  # noqa: E402
import _rx383_option_strategy_report as base  # noqa: E402

STEP = {"CU": 2000.0, "AL": 100.0, "ZN": 200.0, "PB": 200.0, "NI": 2000.0, "SN": 5000.0, "AO": 50.0}
CALL_OTM = 0.10
PUT_OTM = 0.14
MONTHS = ("2611", "2612", "2701")


def _snap(x: float, step: float) -> float:
    return float(round(x / step) * step)


def front_month(product: str, day: pd.Timestamp) -> str | None:
    d = pd.Timestamp(day).date()
    for month in MONTHS:
        exp = rep.option_expiry(product, month)
        if exp is not None and (exp - d).days >= 4:
            return month
    return None


def _futures(day_min: str = "2026-10-01") -> pd.DataFrame:
    from mom_data_etl import get_conn

    conn = get_conn()
    try:
        futs = base.prof.read_sql(
            conn,
            """
            SELECT trade_date::date AS dt, contract,
                   COALESCE(clear, close)::float8 AS settl,
                   COALESCE(volume, 0)::float8 AS volume
            FROM raw_futures_contracts_daily
            WHERE trade_date BETWEEN DATE %s AND DATE '2026-11-05'
            """,
            (day_min,),
        )
    finally:
        conn.close()
    futs["dt"] = pd.to_datetime(futs["dt"]).dt.normalize()
    futs["code"] = futs["contract"].map(base.norm_code)
    futs["settl"] = pd.to_numeric(futs["settl"], errors="coerce")
    import re
    rows = []
    for r in futs.itertuples(index=False):
        m = re.match(r"^([A-Z]+?)(\d{3,4})$", str(r.code))
        if m and r.settl and r.settl > 0:
            rows.append((pd.Timestamp(r.dt), m.group(1), base.month_key(m.group(2)), float(r.settl), float(r.volume)))
    out = pd.DataFrame(rows, columns=["dt", "product", "mkey", "px", "volume"])
    return out.sort_values("volume", ascending=False).drop_duplicates(["dt", "product", "mkey"])


def _fills() -> pd.DataFrame:
    from mom_data_etl import get_conn

    conn = get_conn()
    try:
        tr = base.parse_side(base.prof.read_sql(
            conn,
            """
            SELECT "交易日期"::date AS dt, "合约" AS contract, "买/卖" AS bs, "开/平" AS oc,
                   "手数" AS lots, "成交价" AS price
            FROM mom_options_trade_details
            WHERE LOWER(TRIM("账户")) = %s
              AND "交易日期" BETWEEN DATE '2026-10-15' AND DATE '2026-11-05'
            """,
            (base.ACCOUNT,),
        ))
    finally:
        conn.close()
    tr["dt"] = pd.to_datetime(tr["dt"]).dt.normalize()
    tr["lots"] = pd.to_numeric(tr["lots"], errors="coerce").fillna(0.0)
    tr["price"] = pd.to_numeric(tr["price"], errors="coerce")
    tr = tr[tr["product"].isin(mm.METALS) & tr["is_open"] & tr["is_sell"]].copy()
    rows = []
    for key, s in tr.groupby(["dt", "product", "month", "cp", "strike"]):
        lots = float(s["lots"].sum())
        rows.append((*key, lots, float((s["price"] * s["lots"]).sum() / lots)))
    return pd.DataFrame(rows, columns=["dt", "product", "month", "cp", "strike", "lots", "px"])


def quote_name(product: str, day: pd.Timestamp, fut: pd.DataFrame, atm: float, sessions: list[pd.Timestamp]) -> list[dict]:
    """One call and one put. Empty when the future or the ATM is missing."""
    month = front_month(product, day)
    if month is None or not math.isfinite(atm) or atm <= 0:
        return []
    src = sessions[sessions.index(pd.Timestamp(day)) - 1] if pd.Timestamp(day) != sessions[0] else None
    if src is None:
        return []
    mkey = base.month_key(month)
    hit = fut[(fut["dt"] == src) & (fut["product"] == product) & (fut["mkey"] == mkey)]
    if hit.empty:
        return []
    fpx = float(hit["px"].iloc[0])
    exp = rep.option_expiry(product, month)
    tenor = (exp - pd.Timestamp(day).date()).days / 365.0
    if tenor <= 0:
        return []
    step = STEP.get(product, 100.0)
    out = []
    for cp, otm in (("C", CALL_OTM), ("P", PUT_OTM)):
        raw = fpx * (1.0 + otm) if cp == "C" else fpx * (1.0 - otm)
        strike = _snap(raw, step)
        model, _ = rep._black76(fpx, strike, atm / 100.0, tenor, cp)
        out.append({
            "product": product, "month": month, "cp": cp, "strike": strike,
            "fut": fpx, "atm": atm, "model": model, "tenor_days": tenor * 365.0,
        })
    return out


def _atm_map(metal: pd.DataFrame) -> dict[tuple, float]:
    return {
        (pd.Timestamp(r.dt), r.product): float(r.atm_iv_prev)
        for r in metal.itertuples(index=False)
        if pd.notna(r.atm_iv_prev)
    }


def score(metal: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    metal = metal.copy()
    metal["dt"] = pd.to_datetime(metal["dt"]).dt.normalize()
    sessions = list(sorted(metal["dt"].unique()))
    # sessions for the future lookback must include the day before the 15th
    fut = _futures()
    all_days = sorted(set(fut["dt"]).union(sessions))
    atm = _atm_map(metal)
    fills = _fills()
    cal = sorted(fut["dt"].unique())
    detail = []
    for r in fills.itertuples(index=False):
        q = quote_name(r.product, r.dt, fut, atm.get((pd.Timestamp(r.dt), r.product), float("nan")), cal)
        leg = next((x for x in q if x["cp"] == r.cp), None)
        if leg is None:
            detail.append({**r._asdict(), "month_ok": 0, "k_hat": float("nan"), "model": float("nan"), "otm_his": float("nan"), "otm_hat": float("nan")})
            continue
        fpx = leg["fut"]
        otm_his = (r.strike / fpx - 1.0) if r.cp == "C" else (1.0 - r.strike / fpx)
        otm_hat = (leg["strike"] / fpx - 1.0) if r.cp == "C" else (1.0 - leg["strike"] / fpx)
        exp = rep.option_expiry(r.product, leg["month"])
        tenor = (exp - pd.Timestamp(r.dt).date()).days / 365.0
        black_his, _ = rep._black76(fpx, float(r.strike), leg["atm"] / 100.0, tenor, r.cp)
        try:
            iv_his = rep._implied_vol(fpx, float(r.strike), tenor, float(r.px), r.cp) * 100.0
        except Exception:
            iv_his = float("nan")
        detail.append({
            "dt": pd.Timestamp(r.dt), "product": r.product, "month": r.month, "cp": r.cp,
            "strike": r.strike, "lots": r.lots, "px": r.px,
            "month_ok": int(r.month == leg["month"]),
            "k_hat": leg["strike"], "model": leg["model"], "black_his": black_his, "fut": fpx,
            "atm": leg["atm"], "iv_his": iv_his, "tenor_days": tenor * 365.0,
            "otm_his": otm_his, "otm_hat": otm_hat,
        })
    detail_df = pd.DataFrame(detail)
    # one row per predicted name that the open model emits
    names = pred.run(metal, pred.tape())
    pred_rows = []
    for r in names.itertuples(index=False):
        for p in r.pred:
            for leg in quote_name(p, r.dt, fut, atm.get((pd.Timestamp(r.dt), p), float("nan")), cal):
                pred_rows.append({"dt": pd.Timestamp(r.dt), "product": p, **leg})
    return detail_df, pd.DataFrame(pred_rows)


def compare_rows(metal: pd.DataFrame) -> list[list[str]]:
    """One row per name he sold: the model's call and put, and the strikes he actually sold."""
    metal = metal.copy()
    metal["dt"] = pd.to_datetime(metal["dt"]).dt.normalize()
    fut = _futures()
    cal = sorted(pd.to_datetime(fut["dt"]).unique())
    atm = _atm_map(metal)
    fills = _fills()
    rows = []
    for (dt, product), g in fills.groupby(["dt", "product"], sort=True):
        q = {leg["cp"]: leg for leg in quote_name(product, dt, fut, atm.get((pd.Timestamp(dt), product), float("nan")), cal)}
        cells = [pd.Timestamp(dt).strftime("%m-%d"), _cn(product)]
        for cp in ("C", "P"):
            hat = f"{int(q[cp]['strike'])}" if cp in q else "没有"
            sub = g[g["cp"] == cp].sort_values("strike")
            his = "、".join(f"{int(r.strike)}（{r.px:.0f}）" for r in sub.itertuples(index=False)) or "没卖"
            cells.extend([hat, his])
        rows.append(cells)
    return rows


def _cn(product: str) -> str:
    import _generate_rx319_profile_word_report as prof
    name = prof.PRODUCT_CN.get(product, product)
    return name[1:] if name.startswith("沪") else name


def main() -> None:
    metal, _, _ = mm.build()
    detail, opened = score(metal)
    print("expiry CU2611", rep.option_expiry("CU", "2611"), "CU2612", rep.option_expiry("CU", "2612"))
    print("\nHIS FILLS vs the 10/14 quote")
    for r in detail.itertuples(index=False):
        err = (r.otm_his - r.otm_hat) * 100 if r.otm_his == r.otm_his else float("nan")
        print(
            pd.Timestamp(r.dt).strftime("%m-%d"), _cn(r.product), r.month, r.cp,
            f"K{r.strike:.0f}", f"hat{r.k_hat:.0f}" if r.k_hat == r.k_hat else "hatna",
            f"month{'Y' if r.month_ok else 'N'}",
            f"otm{r.otm_his*100:.1f}" if r.otm_his == r.otm_his else "otmna",
            f"dOtm{err:+.1f}" if err == err else "dOtmna",
            f"px{r.px:.0f}", f"blackK{r.black_his:.1f}" if r.black_his == r.black_his else "blackna",
            f"atm{r.atm:.1f}", f"iv{r.iv_his:.0f}" if r.iv_his == r.iv_his else "ivna", f"dte{r.tenor_days:.0f}",
            f"ratio{(r.px/r.black_his):.2f}" if r.black_his and r.black_his == r.black_his and r.black_his > 0 else "ratio na",
        )
    ok = detail[detail["otm_his"].notna()]
    print("\nmonth", int(detail["month_ok"].sum()), "/", len(detail))
    print("median |otm error| pp", float((ok["otm_his"] - ok["otm_hat"]).abs().median() * 100))
    print("exact strike", int((ok["strike"] == ok["k_hat"]).sum()), "/", len(ok))
    step = ok["product"].map(STEP)
    one = ((ok["strike"] - ok["k_hat"]).abs() <= step + 1e-6).sum()
    print("within one step", int(one), "/", len(ok))
    both = ok[(ok["black_his"] > 0)]
    print("median px/black(his K)", float((both["px"] / both["black_his"]).median()))
    wing = ok.copy()
    wing["sigma"] = wing["atm"] + wing["cp"].map({"C": 0.0, "P": 12.0})
    # repriced below from stored fields
    ratios = []
    for r in ok.itertuples(index=False):
        sigma = (r.atm + (12.0 if r.cp == "P" else 0.0)) / 100.0
        tenor = r.tenor_days / 365.0
        model, _ = rep._black76(r.fut, float(r.strike), sigma, tenor, r.cp)
        if model > 0 and r.tenor_days >= 14:
            ratios.append((r.px / model, r.cp, r.tenor_days))
    if ratios:
        import numpy as np
        arr = np.array([x[0] for x in ratios])
        print("dte>=14 call=ATM put=ATM+12  n", len(arr), "median px/model", float(np.median(arr)), "median |err|", float(np.median(np.abs(arr - 1))))
    short = ok[ok["tenor_days"] < 14]
    print("dte<14 fills", len(short), "median iv-atm", float((short["iv_his"] - short["atm"]).median()) if len(short) else None)
    print("opened legs", len(opened))


if __name__ == "__main__":
    main()
