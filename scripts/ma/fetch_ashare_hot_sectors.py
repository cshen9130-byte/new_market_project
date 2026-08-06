#!/usr/bin/env python3
"""
fetch_ashare_hot_sectors.py
===========================
Fetch A-share hot industry / concept boards via AkShare.

East Money board endpoints are frequently blocked in this environment.
Primary sources (reliable):
  industry — stock_board_industry_summary_ths()  (同花顺行业)
  concept  — stock_sector_spot(indicator="概念") (新浪概念)

Fallback (if primary fails):
  industry — stock_sector_spot(indicator="行业")
  concept  — stock_board_concept_name_em()

Output JSON:
  {
    "trade_date": "YYYY-MM-DD",
    "source": "...",
    "industry": [{ name, change_pct, amount, lead_stock, lead_change_pct, rank }],
    "concept":  [...]
  }

Usage
-----
  python fetch_ashare_hot_sectors.py
  python fetch_ashare_hot_sectors.py --top 30
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


def _today_cn() -> str:
    return datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")


def _resolve_trade_date() -> str:
    """Prefer explicit TRADE_DATE / CLI; else calendar today (CN)."""
    env = (os.environ.get("TRADE_DATE") or os.environ.get("ASHARE_HOT_SECTORS_DATE") or "").strip()
    if env:
        return env.replace("/", "-")[:10]
    return _today_cn()


def _num(v) -> float | None:
    if v is None:
        return None
    try:
        if isinstance(v, str):
            v = v.strip().replace(",", "").replace("%", "")
            if not v or v in {"--", "-", "nan", "None"}:
                return None
        x = float(v)
        if x != x:  # NaN
            return None
        return x
    except (TypeError, ValueError):
        return None


def _str(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    if not s or s in {"--", "-", "None", "nan"}:
        return None
    return s


def _pick_col(df, *candidates: str):
    cols = {str(c): c for c in df.columns}
    for name in candidates:
        if name in cols:
            return cols[name]
    return None


def _normalize_rows(rows: list[dict], top: int) -> list[dict]:
    rows = [r for r in rows if r.get("name") and r.get("change_pct") is not None]
    rows.sort(key=lambda r: r["change_pct"], reverse=True)
    out = []
    for i, r in enumerate(rows[:top], start=1):
        out.append({
            "name": r["name"],
            "change_pct": round(float(r["change_pct"]), 2),
            "amount": None if r.get("amount") is None else round(float(r["amount"]), 2),
            "lead_stock": r.get("lead_stock"),
            "lead_change_pct": (
                None if r.get("lead_change_pct") is None
                else round(float(r["lead_change_pct"]), 2)
            ),
            "rank": i,
        })
    return out


def _from_ths_industry(ak, top: int) -> tuple[list[dict], str]:
    df = ak.stock_board_industry_summary_ths()
    if df is None or df.empty:
        raise RuntimeError("empty THS industry summary")
    name_c = _pick_col(df, "板块", "板块名称", "行业")
    chg_c = _pick_col(df, "涨跌幅")
    amt_c = _pick_col(df, "总成交额", "成交额")
    lead_c = _pick_col(df, "领涨股", "领涨股票")
    lead_chg_c = _pick_col(df, "领涨股-涨跌幅", "领涨股票-涨跌幅")
    if not name_c or not chg_c:
        raise RuntimeError(f"unexpected THS industry columns: {list(df.columns)}")

    rows = []
    for _, row in df.iterrows():
        amt = _num(row.get(amt_c)) if amt_c else None
        # THS summary amount is in 亿元
        if amt is not None:
            amt = amt * 1e8
        rows.append({
            "name": _str(row.get(name_c)),
            "change_pct": _num(row.get(chg_c)),
            "amount": amt,
            "lead_stock": _str(row.get(lead_c)) if lead_c else None,
            "lead_change_pct": _num(row.get(lead_chg_c)) if lead_chg_c else None,
        })
    return _normalize_rows(rows, top), "ths_industry_summary"


def _from_sector_spot(ak, indicator: str, top: int) -> tuple[list[dict], str]:
    df = ak.stock_sector_spot(indicator=indicator)
    if df is None or df.empty:
        raise RuntimeError(f"empty sector_spot({indicator})")
    name_c = _pick_col(df, "板块", "板块名称")
    chg_c = _pick_col(df, "涨跌幅")
    amt_c = _pick_col(df, "总成交额", "成交额")
    lead_c = _pick_col(df, "股票名称", "领涨股", "领涨股票")
    lead_chg_c = _pick_col(df, "个股-涨跌幅", "领涨股-涨跌幅")
    if not name_c or not chg_c:
        raise RuntimeError(f"unexpected sector_spot columns: {list(df.columns)}")

    rows = []
    for _, row in df.iterrows():
        rows.append({
            "name": _str(row.get(name_c)),
            "change_pct": _num(row.get(chg_c)),
            "amount": _num(row.get(amt_c)) if amt_c else None,
            "lead_stock": _str(row.get(lead_c)) if lead_c else None,
            "lead_change_pct": _num(row.get(lead_chg_c)) if lead_chg_c else None,
        })
    return _normalize_rows(rows, top), f"sina_sector_spot_{indicator}"


def _from_em_board(ak, kind: str, top: int) -> tuple[list[dict], str]:
    if kind == "industry":
        df = ak.stock_board_industry_name_em()
        src = "em_industry"
    else:
        df = ak.stock_board_concept_name_em()
        src = "em_concept"
    if df is None or df.empty:
        raise RuntimeError(f"empty {src}")
    name_c = _pick_col(df, "板块名称", "板块")
    chg_c = _pick_col(df, "涨跌幅")
    lead_c = _pick_col(df, "领涨股票", "领涨股")
    lead_chg_c = _pick_col(df, "领涨股票-涨跌幅", "领涨股-涨跌幅")
    if not name_c or not chg_c:
        raise RuntimeError(f"unexpected {src} columns: {list(df.columns)}")

    rows = []
    for _, row in df.iterrows():
        rows.append({
            "name": _str(row.get(name_c)),
            "change_pct": _num(row.get(chg_c)),
            "amount": None,
            "lead_stock": _str(row.get(lead_c)) if lead_c else None,
            "lead_change_pct": _num(row.get(lead_chg_c)) if lead_chg_c else None,
        })
    return _normalize_rows(rows, top), src


def fetch_boards(top: int) -> dict:
    import akshare as ak

    sources: dict[str, str] = {}
    industry: list[dict] = []
    concept: list[dict] = []

    try:
        industry, src = _from_ths_industry(ak, top)
        sources["industry"] = src
    except Exception as e:
        sys.stderr.write(f"industry THS failed: {e}; trying sina…\n")
        try:
            industry, src = _from_sector_spot(ak, "行业", top)
            sources["industry"] = src
        except Exception as e2:
            sys.stderr.write(f"industry sina failed: {e2}; trying EM…\n")
            industry, src = _from_em_board(ak, "industry", top)
            sources["industry"] = src

    try:
        concept, src = _from_sector_spot(ak, "概念", top)
        sources["concept"] = src
    except Exception as e:
        sys.stderr.write(f"concept sina failed: {e}; trying EM…\n")
        concept, src = _from_em_board(ak, "concept", top)
        sources["concept"] = src

    return {
        "trade_date": _resolve_trade_date(),
        "source": sources,
        "industry": industry,
        "concept": concept,
        "count": {"industry": len(industry), "concept": len(concept)},
    }


def main() -> int:
    _load_env()
    parser = argparse.ArgumentParser(description="Fetch A-share hot industry/concept boards")
    parser.add_argument(
        "--top",
        type=int,
        default=100,
        help="Keep top N by change_pct (default 100; industry universe ~90)",
    )
    args = parser.parse_args()
    top = max(5, min(200, args.top))

    try:
        payload = fetch_boards(top)
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 1

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
