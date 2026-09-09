# -*- coding: utf-8 -*-
"""Dominant-contract calendar and prices for live-like 换月 / 展期."""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from _mom_20m_account import MULTIPLIER

PRODUCTS = tuple(sorted(MULTIPLIER, key=len, reverse=True))


def norm_contract(c: str) -> str:
    s = str(c or "").strip().upper()
    if not s:
        return ""
    return s.split(".")[0]


def product_of_contract(contract: str) -> str | None:
    root = norm_contract(contract)
    for n in (3, 2, 1):
        if len(root) > n and root[n].isdigit() and root[:n] in MULTIPLIER:
            return root[:n]
    return None


@dataclass
class RollContext:
    """Dominant contract per (date, product) and per-contract closes."""

    dominant: dict[tuple[str, str], str] = field(default_factory=dict)
    px: dict[tuple[str, str], float] = field(default_factory=dict)
    rolls: list[dict] = field(default_factory=list)

    def contract_on(self, product: str, dt: str) -> str:
        return self.dominant.get((str(dt)[:10], product), "")

    def price(self, contract: str, dt: str) -> float:
        root = norm_contract(contract)
        dt = str(dt)[:10]
        v = self.px.get((dt, root), 0.0)
        if v:
            return v
        v = self.px.get((dt, str(contract).strip().upper()), 0.0)
        return float(v) if v else 0.0

    def contract_ret(self, contract: str, start: str, end: str) -> float | None:
        a = self.price(contract, start)
        b = self.price(contract, end)
        if a > 0 and b > 0:
            return b / a - 1.0
        return None

    def rolled(self, product: str, prev_dt: str, dt: str) -> tuple[str, str] | None:
        a = self.contract_on(product, prev_dt)
        b = self.contract_on(product, dt)
        if a and b and a != b:
            return a, b
        return None


def load_roll_context(conn, start: str, end: str) -> RollContext:
    print("Loading dominant contracts and 换月 calendar…")
    px_df = pd.read_sql(
        """
        SELECT trade_date::text AS dt,
               UPPER(TRIM(contract)) AS contract,
               COALESCE(NULLIF(close::float8, 0), NULLIF(clear::float8, 0), 0)::float8 AS px,
               COALESCE(hqoi::float8, 0) AS oi,
               COALESCE(volume::float8, 0) AS vol
        FROM raw_futures_contracts_daily
        WHERE trade_date BETWEEN %s AND %s
        """,
        conn,
        params=(start, end),
    )
    ctx = RollContext()
    if px_df.empty:
        print("  raw_futures_contracts_daily empty in range")
        return ctx

    px_df["dt"] = px_df["dt"].astype(str).str.slice(0, 10)
    px_df["root"] = px_df["contract"].map(norm_contract)
    px_df["product"] = px_df["root"].map(product_of_contract)
    px_df = px_df[px_df["product"].notna() & (px_df["px"] > 0)]

    for r in px_df.itertuples(index=False):
        ctx.px[(r.dt, r.root)] = float(r.px)
        ctx.px[(r.dt, r.contract)] = float(r.px)

    ranked = (
        px_df.sort_values(["dt", "product", "oi", "vol"], ascending=[True, True, False, False])
        .groupby(["dt", "product"], as_index=False)
        .first()
    )
    for r in ranked.itertuples(index=False):
        ctx.dominant[(r.dt, r.product)] = r.root

    # Carry forward if a product misses a session
    dates = sorted(px_df["dt"].unique())
    last: dict[str, str] = {}
    for dt in dates:
        for p, c in list(last.items()):
            if (dt, p) not in ctx.dominant:
                ctx.dominant[(dt, p)] = c
        for p in {k[1] for k in ctx.dominant if k[0] == dt}:
            last[p] = ctx.dominant[(dt, p)]

    try:
        ev = pd.read_sql(
            """
            SELECT product, rollover_date::text AS dt,
                   from_contract, to_contract
            FROM raw_futures_rollover_dates
            WHERE rollover_date BETWEEN %s AND %s
            """,
            conn,
            params=(start, end),
        )
    except Exception:
        ev = pd.DataFrame()
    if not ev.empty:
        ev["dt"] = ev["dt"].astype(str).str.slice(0, 10)
        ev["product"] = ev["product"].astype(str).str.upper()
        for r in ev.itertuples(index=False):
            frm, to = norm_contract(r.from_contract), norm_contract(r.to_contract)
            if to:
                ctx.dominant[(r.dt, r.product)] = to
            if frm and to and frm != to:
                ctx.rolls.append({
                    "date": r.dt, "product": r.product,
                    "from_contract": frm, "to_contract": to, "source": "table",
                })

    # Derive roll events from OI-dominant changes
    seen = {(x["date"], x["product"], x["from_contract"], x["to_contract"]) for x in ctx.rolls}
    prev_dom: dict[str, str] = {}
    for dt in dates:
        for p in {k[1] for k in ctx.dominant if k[0] == dt}:
            cur = ctx.dominant[(dt, p)]
            old = prev_dom.get(p)
            if old and cur and old != cur:
                key = (dt, p, old, cur)
                if key not in seen:
                    ctx.rolls.append({
                        "date": dt, "product": p,
                        "from_contract": old, "to_contract": cur, "source": "oi",
                    })
                    seen.add(key)
            prev_dom[p] = cur

    print(f"  contract prices {len(ctx.px):,}  dominant cells {len(ctx.dominant):,}  roll events {len(ctx.rolls):,}")
    return ctx
