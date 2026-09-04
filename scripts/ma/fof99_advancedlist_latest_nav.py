#!/usr/bin/env python3
"""Page through 火富牛 FundAdvancedList and write every private fund's latest NAV date.

Does not call FundMultiPrice (no 40-code credits).
"""
from __future__ import annotations

import csv
import os
import sys
import time
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SDK = ROOT / "fof99_api" / "mall_sdk"
if str(SDK) not in sys.path:
    sys.path.insert(0, str(SDK))

OUT = ROOT / "scripts" / "ma" / "fof99_advancedlist_latest_nav.csv"
PAGE_SIZE = 1000


def load_env() -> None:
    for fname in (".env.local", ".env"):
        f = ROOT / fname
        if not f.is_file():
            continue
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def load_keys() -> tuple[str, str]:
    appid = (os.environ.get("FOF99_APP_ID") or "").strip()
    appkey = (os.environ.get("FOF99_APP_KEY") or "").strip()
    key_file = ROOT / "fof99_api" / "api_key.txt"
    if (not appid or not appkey) and key_file.is_file():
        text = key_file.read_text(encoding="utf-8", errors="ignore")
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        for i, ln in enumerate(lines):
            if ln.upper() == "APPID" and i + 1 < len(lines):
                appid = appid or lines[i + 1]
            if ln.replace(" ", "") in ("API密钥", "APIKEY") and i + 1 < len(lines):
                appkey = appkey or lines[i + 1]
    if not appid or not appkey:
        raise SystemExit("FOF99_APP_ID / FOF99_APP_KEY missing")
    return appid, appkey


def parse_iso(raw: object) -> str:
    s = str(raw or "").strip()[:10]
    return s if len(s) == 10 and s[0].isdigit() else ""


def main() -> int:
    load_env()
    from fof99 import FundAdvancedList

    appid, appkey = load_keys()
    cutoff = (date.today() - timedelta(days=31)).isoformat()
    fields = [
        "register_number",
        "fund_name",
        "fund_short_name",
        "advisor",
        "price_date",
        "price_nav",
        "price_cnw",
        "price_cw_nav",
        "price_change",
        "inception_date",
        "fund_state",
        "fund_type",
        "cycle_type",
        "strategy_one",
        "strategy_two",
        "strategy_three",
    ]
    rows: list[dict] = []
    page = 1
    total = None
    while True:
        req = FundAdvancedList(appid, appkey)
        req.set_params(
            type_=1,
            fund_state=1,
            fund_type=2,
            strategy_one="不限",
            strategy_two="不限",
            strategy_three="不限",
            order="0",
            order_by="price_date",
            page=page,
            pagesize=PAGE_SIZE,
        )
        data = req.do_request(use_df=False)
        debug = req.get_debug_info() or {}
        err = debug.get("error_code")
        if err not in (0, "0", None):
            print(f"STOP page={page} error_code={err} msg={debug.get('msg')}", flush=True)
            return 1
        payload = debug.get("data")
        if isinstance(payload, dict) and total is None:
            total = payload.get("total")
            print(f"火富牛 私募证券 正常运作 total={total}", flush=True)
        if isinstance(data, list):
            chunk = data
        elif isinstance(payload, dict) and isinstance(payload.get("list"), list):
            chunk = payload["list"]
        else:
            chunk = []
        print(f"page {page} n={len(chunk)} total_so_far={len(rows) + len(chunk)}", flush=True)
        if not chunk:
            break
        rows.extend(chunk)
        if total is not None and len(rows) >= int(total):
            break
        if len(chunk) < PAGE_SIZE:
            break
        page += 1
        time.sleep(0.15)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for raw in rows:
            w.writerow({k: raw.get(k, "") for k in fields})

    with_date = [r for r in rows if parse_iso(r.get("price_date"))]
    within_1m = [r for r in with_date if parse_iso(r.get("price_date")) >= cutoff]
    print(f"wrote {OUT}", flush=True)
    print(f"funds={len(rows)}  with_price_date={len(with_date)}  within_1m(>={cutoff})={len(within_1m)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
