#!/usr/bin/env python3
"""
fetch_ashare_sector_fund_flow.py
===============================
Fetch latest industry/concept fund-flow snapshot via AkShare:

  ak.stock_fund_flow_industry(symbol="即时")
  ak.stock_fund_flow_concept(symbol="即时")

Units: 流入/流出/净额 are in 亿元.

Output JSON:
  {
    trade_date, source,
    industry: [{name, inflow, outflow, net_flow, change_pct, ...}],
    concept:  [...]
  }
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def _load_env() -> None:
    for base in (Path.cwd(), Path(__file__).resolve().parent, Path(__file__).resolve().parent.parent.parent):
        for fname in (".env.local", ".env"):
            f = base / fname
            if not f.is_file():
                continue
            for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    os.environ.setdefault("TQDM_DISABLE", "1")


def _num(v):
    if v is None:
        return None
    try:
        if isinstance(v, str):
            v = v.strip().replace(",", "").replace("%", "")
            if not v or v in {"--", "-", "nan", "None"}:
                return None
        x = float(v)
        if x != x:
            return None
        return x
    except (TypeError, ValueError):
        return None


def _str(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s not in {"--", "-", "None", "nan"} else None


def _pick(df, *names):
    cols = {str(c): c for c in df.columns}
    for n in names:
        if n in cols:
            return cols[n]
    return None


def _normalize(df, top: int | None = None) -> list[dict]:
    if df is None or df.empty:
        return []
    name_c = _pick(df, "行业", "板块", "概念", "名称")
    chg_c = _pick(df, "行业-涨跌幅", "涨跌幅", "阶段涨跌幅")
    in_c = _pick(df, "流入资金", "流入")
    out_c = _pick(df, "流出资金", "流出")
    net_c = _pick(df, "净额", "净流入")
    if not name_c or not net_c:
        raise RuntimeError(f"unexpected fund-flow columns: {list(df.columns)}")

    by_name: dict[str, dict] = {}
    for _, r in df.iterrows():
        name = _str(r.get(name_c))
        net = _num(r.get(net_c))
        if not name or net is None:
            continue
        # Keep first occurrence (API list is already ranked); skip duplicates.
        if name in by_name:
            continue
        by_name[name] = {
            "name": name,
            "inflow": _num(r.get(in_c)) if in_c else None,
            "outflow": _num(r.get(out_c)) if out_c else None,
            "net_flow": net,
            "change_pct": _num(r.get(chg_c)) if chg_c else None,
        }
    rows = list(by_name.values())
    rows.sort(key=lambda x: x["net_flow"], reverse=True)
    if top is not None:
        rows = rows[:top]
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return rows


def _resolve_trade_date() -> str:
    env = (os.environ.get("TRADE_DATE") or "").strip()
    if env:
        return env.replace("/", "-")[:10]
    # Prefer latest ashare session if DB available
    try:
        import psycopg2
        url = os.environ.get("DATABASE_URL")
        conn = (
            psycopg2.connect(url)
            if url
            else psycopg2.connect(
                host=os.environ.get("DB_HOST", "localhost"),
                port=int(os.environ.get("DB_PORT", "5432")),
                dbname=os.environ.get("DB_NAME", "market_data"),
                user=os.environ.get("DB_USER", "market_user"),
                password=os.environ.get("DB_PASSWORD", ""),
            )
        )
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT MAX(trade_date)::text FROM raw_ashare_daily")
                row = cur.fetchone()
                if row and row[0]:
                    return str(row[0])[:10]
        finally:
            conn.close()
    except Exception:
        pass
    return datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")


def fetch(top: int | None = None) -> dict:
    import akshare as ak

    industry_df = ak.stock_fund_flow_industry(symbol="即时")
    concept_df = ak.stock_fund_flow_concept(symbol="即时")
    industry = _normalize(industry_df, top)
    concept = _normalize(concept_df, top)
    return {
        "trade_date": _resolve_trade_date(),
        "source": {
            "industry": "ths_fund_flow_industry_spot",
            "concept": "ths_fund_flow_concept_spot",
        },
        "unit": "yi",
        "industry": industry,
        "concept": concept,
        "count": {"industry": len(industry), "concept": len(concept)},
    }


def main() -> int:
    _load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--top", type=int, default=0, help="Keep top N by net_flow (0=all)")
    args = parser.parse_args()
    top = None if args.top <= 0 else max(10, min(400, args.top))
    try:
        payload = fetch(top)
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 1
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
