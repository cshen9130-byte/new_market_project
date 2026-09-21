#!/usr/bin/env python3
"""One-credit FundPrice probe for SH724B 2026-05-22..2026-08-07. Does not write NAV."""
from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[0]
sys.path.insert(0, str(ROOT / "fof99_api" / "mall_sdk"))
sys.path.insert(0, str(ROOT / "scripts" / "ma"))

from fof99_weekly_nav_fetch import load_env, load_fof99_keys  # noqa: E402
from fof99 import FundPrice  # noqa: E402

CODE = "SH724B"
START = "2026-05-22"
END = "2026-08-07"
GAP_LO = date(2026, 5, 23)
GAP_HI = date(2026, 8, 6)


def as_rows(data) -> list[dict]:
    if data is None:
        return []
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict):
        for key in ("list", "items", "data", "price"):
            inner = data.get(key)
            if isinstance(inner, list):
                return [r for r in inner if isinstance(r, dict)]
        return [data]
    return []


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    load_env()
    appid, appkey = load_fof99_keys()
    req = FundPrice(appid, appkey)
    req.set_params(reg_code=CODE, start_date=START, end_date=END, order_by="price_date", order=1)
    data = req.do_request(use_df=False)
    debug = req.get_debug_info() or {}
    err = debug.get("error_code")
    print(json.dumps({
        "error_code": err,
        "msg": debug.get("msg"),
        "http": debug.get("status_code") or debug.get("http_status"),
    }, ensure_ascii=False))
    if err not in (0, "0", None, 0.0) or data is None:
        print("API_FAIL")
        return 1
    rows = as_rows(data)
    parsed: list[tuple[str, str]] = []
    for raw in rows:
        d = str(raw.get("price_date") or "")[:10]
        nav = raw.get("nav")
        if len(d) == 10:
            parsed.append((d, str(nav)))
    parsed.sort()
    interior = [p for p in parsed if GAP_LO <= date.fromisoformat(p[0]) <= GAP_HI]
    print(f"rows={len(parsed)} interior_gap={len(interior)}")
    print("ALL_DATES")
    for d, nav in parsed:
        tag = "GAP" if GAP_LO <= date.fromisoformat(d) <= GAP_HI else "EDGE"
        print(f"{tag}\t{d}\t{nav}")
    if not interior:
        print("NO_INTERIOR_POINTS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
