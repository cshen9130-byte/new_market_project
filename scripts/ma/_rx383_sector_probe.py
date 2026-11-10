# -*- coding: utf-8 -*-
"""Print RX383 sector exposure from the position files. Read only."""
import socket
import subprocess
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _rx383_combined_report as rep
import _rx383_option_strategy_report as base

END = pd.Timestamp("2026-11-03")


def _port_open(port: int = 5433) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1.5):
            return True
    except OSError:
        return False


def _ensure_tunnel() -> None:
    if _port_open():
        return
    key = Path.home() / ".ssh" / "id_ed25519_server"
    if not key.exists():
        raise SystemExit("database port 5433 is closed and the SSH key is missing")
    subprocess.Popen(
        ["ssh", "-i", str(key), "-L", "5433:127.0.0.1:5432", "-N", "-o", "ExitOnForwardFailure=yes", "root@8.154.33.143"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(40):
        time.sleep(0.4)
        if _port_open():
            return
    raise SystemExit("SSH tunnel to the database did not open")


def main() -> None:
    _ensure_tunnel()
    conn = rep.get_conn()
    try:
        raw = base.load_account(conn)
        cols = base.prof.read_sql(
            conn,
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'mom_position_details'
            ORDER BY ordinal_position
            """,
        )
    finally:
        conn.close()
    print("FUT COLS", list(cols["column_name"]))
    opt = raw["opt_pos"]
    opt = opt[opt["dt"] <= END].copy()
    opt["sector"] = opt["product"].map(base.prof.sector_of)
    opt["short"] = pd.to_numeric(opt["short_lots"], errors="coerce").fillna(0)
    opt["long"] = pd.to_numeric(opt["long_lots"], errors="coerce").fillna(0)
    opt["margin"] = pd.to_numeric(opt["margin"], errors="coerce").fillna(0)
    opt["mv"] = pd.to_numeric(opt["opt_mv"], errors="coerce").fillna(0)
    print("days", opt["dt"].nunique(), opt["dt"].min().date(), opt["dt"].max().date())
    print("products", sorted(opt["product"].unique()))
    print("unmapped", sorted(opt.loc[opt["sector"] == "其他", "product"].unique()))
    print("--- margin by sector, last day and sum of daily ---")
    daily = opt.groupby(["dt", "sector"], as_index=False).agg(short=("short", "sum"), long=("long", "sum"), margin=("margin", "sum"), mv=("mv", "sum"))
    last = daily[daily["dt"] == daily["dt"].max()]
    print(last.sort_values("margin", ascending=False).to_string(index=False))
    print("--- path ---")
    wide = daily.pivot(index="dt", columns="sector", values="margin").fillna(0)
    print(wide.round(0).to_string())
    print("--- short lots path ---")
    lots = daily.pivot(index="dt", columns="sector", values="short").fillna(0)
    print(lots.round(0).to_string())
    print("--- mv path ---")
    mv = daily.pivot(index="dt", columns="sector", values="mv").fillna(0)
    print(mv.round(0).to_string())
    print("--- non-option position contracts ---")
    raw_pos = raw["fut_pos"]
    if not raw_pos.empty:
        optish = raw_pos["contract"].map(base.prof.is_option_contract)
        plain = raw_pos[(raw_pos["dt"] <= END) & ~optish].copy()
        print("plain rows", len(plain), "contracts", sorted(plain["contract"].astype(str).unique()))
        plain["short"] = pd.to_numeric(plain["short_lots"], errors="coerce").fillna(0)
        if "保证金" in plain.columns:
            plain["margin"] = pd.to_numeric(plain["保证金"], errors="coerce").fillna(0)
            lastp = plain[plain["dt"] == plain["dt"].max()]
            print(lastp.groupby("contract")[["short", "margin"]].sum().sort_values("margin", ascending=False).head(20).to_string())
        else:
            print("no margin col on fut frame", list(plain.columns))
    fut = raw["fut_pos"]
    if not fut.empty:
        fut = fut[fut["dt"] <= END].copy()
        fut["product"] = fut["contract"].map(lambda s: "".join(c for c in str(s) if c.isalpha()).upper())
        fut["sector"] = fut["product"].map(base.prof.sector_of)
        fut["short"] = pd.to_numeric(fut["short_lots"], errors="coerce").fillna(0)
        fut["long"] = pd.to_numeric(fut["long_lots"], errors="coerce").fillna(0)
        print("--- futures short lots ---")
        print(fut.groupby(["dt", "product", "sector"])[["short", "long"]].sum().to_string())


if __name__ == "__main__":
    main()
