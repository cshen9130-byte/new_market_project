#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_futures_warehouse_receipts_daily.py
=========================================
Fetch Choice/EmQuant registered warehouse receipts (FTREGORDERVOL / 注册仓单数量)
for commodity continuous mains (e.g. AU0.SHF) and optionally upsert into Postgres.

User sample:
  c.csd("AU0.SHF","FTREGORDERVOL","2026-10-06","2026-10-27",
        "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH")

Usage:
  python fetch_futures_warehouse_receipts_daily.py 2026-10-06 2026-10-27
  python fetch_futures_warehouse_receipts_daily.py 2026-10-06 2026-10-27 --upsert
  python fetch_futures_warehouse_receipts_daily.py --upsert   # last 5 days

Env: DATABASE_URL, EMQ_USERNAME, EMQ_PASSWORD
PYTHONPATH must include EmQuantAPI (server python3 package dir).
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

CSD_FIELD = "FTREGORDERVOL"
CSD_OPTS = "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH"
_BATCH_SIZE = int(os.environ.get("EMQ_WH_BATCH", "15"))
_CSD_TIMEOUT = int(os.environ.get("EMQ_CSD_TIMEOUT", "120"))

COMMODITY_CONTINUOUS_CODES = (
    "A0.DCE,AD0.SHF,AG0.SHF,AL0.SHF,AO0.SHF,AP0.CZC,AU0.SHF,B0.DCE,BB0.DCE,BCM.INE,BR0.SHF,BU0.SHF,BZ0.DCE,"
    "C0.DCE,CF0.CZC,CJ0.CZC,CS0.DCE,CU0.SHF,CY0.CZC,EB0.DCE,ECM.INE,EG0.DCE,FB0.DCE,FG0.CZC,FU0.SHF,HC0.SHF,"
    "I0.DCE,J0.DCE,JD0.DCE,JM0.DCE,JR0.CZC,L0.DCE,LCM.GFE,LF0.DCE,LG0.DCE,LH0.DCE,LR0.CZC,LUM.INE,M0.DCE,"
    "MA0.CZC,NI0.SHF,NRM.INE,OI0.CZC,OP0.SHF,P0.DCE,PB0.SHF,PDM.GFE,PF0.CZC,PG0.DCE,PK0.CZC,PL0.CZC,PM0.CZC,"
    "PP0.DCE,PPF0.DCE,PR0.CZC,PSM.GFE,PTM.GFE,PX0.CZC,RB0.SHF,RI0.CZC,RM0.CZC,RR0.DCE,RS0.CZC,RU0.SHF,SA0.CZC,"
    "SCM.INE,SF0.CZC,SH0.CZC,SIM.GFE,SM0.CZC,SN0.SHF,SP0.SHF,SR0.CZC,SS0.SHF,TA0.CZC,UR0.CZC,V0.DCE,VF0.DCE,"
    "WH0.CZC,WR0.SHF,Y0.DCE,ZC0.CZC,ZN0.SHF,"
    "SC0.INE,LU0.INE,NR0.INE,BC0.INE"  # Choice continuous aliases (also SCM/LUM/NRM/BCM)
)


def _load_env_from_files() -> None:
    candidates = []
    try:
        candidates.append(Path.cwd())
        script_dir = Path(__file__).resolve().parent
        candidates.extend([script_dir, script_dir.parent, script_dir.parent.parent])
    except Exception:
        pass
    for base in candidates:
        for fname in (".env", ".env.local"):
            f = base / fname
            if not f.is_file():
                continue
            try:
                for line in f.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and os.environ.get(key) is None:
                        os.environ[key] = val
            except Exception:
                pass


def _to_float(v):
    try:
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return float(v)
        s = str(v).strip().replace(",", "").replace("%", "")
        if s == "" or s.lower() in ("none", "nan", "null"):
            return None
        return float(s)
    except Exception:
        return None


def _parse_ymd(s: str) -> str:
    s = s.strip().replace("/", "-")
    if re.fullmatch(r"\d{8}", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    datetime.strptime(s, "%Y-%m-%d")
    return s


def _norm_date(s: str):
    s = (s or "").strip().replace("/", "-")
    if re.fullmatch(r"\d{8}", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if not m:
        return None
    y, mo, d = m.groups()
    return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"


def product_from_wind_code(code: str) -> tuple[str, str]:
    parts = code.strip().upper().split(".")
    if len(parts) != 2:
        raise ValueError(f"bad wind_code {code!r}")
    raw, exch = parts
    if raw.endswith("0") and len(raw) >= 2:
        product = raw[:-1]
    elif raw.endswith("M") and len(raw) >= 2:
        product = raw[:-1]
    else:
        product = raw
    return product, exch


def code_list() -> list[str]:
    env = os.environ.get("WH_CODES", "").strip()
    raw = env if env else "".join(COMMODITY_CONTINUOUS_CODES)
    return [c.strip().upper() for c in raw.split(",") if c.strip()]


def _csd_call(c, codes_str: str, start_date: str, end_date: str):
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(c.csd, codes_str, CSD_FIELD, start_date, end_date, CSD_OPTS)
        return fut.result(timeout=_CSD_TIMEOUT)


def _parse_csd(data_obj, requested_codes: list[str]) -> list[dict]:
    out: list[dict] = []
    codes = list(getattr(data_obj, "Codes", None) or requested_codes)
    dates = list(getattr(data_obj, "Dates", None) or [])
    data = getattr(data_obj, "Data", None)
    if data is None:
        return out

    series_by_code: dict[str, list] = {}
    if isinstance(data, dict):
        # single-code field map
        upper_keys = {str(k).upper(): k for k in data.keys()}
        if CSD_FIELD in upper_keys and not any("." in str(k) for k in data.keys()):
            only = requested_codes[0] if requested_codes else (codes[0] if codes else None)
            if only:
                series_by_code[str(only).upper()] = list(data[upper_keys[CSD_FIELD]])
        for k, v in data.items():
            key = str(k).upper()
            if isinstance(v, dict):
                uk = {str(fk).upper(): fk for fk in v.keys()}
                if CSD_FIELD in uk:
                    series_by_code[key] = list(v[uk[CSD_FIELD]])
            elif isinstance(v, (list, tuple)) and ("." in key or key in {c.upper() for c in requested_codes}):
                series_by_code[key] = list(v)
    elif isinstance(data, (list, tuple)):
        if len(codes) == 1:
            series_by_code[str(codes[0]).upper()] = list(data)
        else:
            for i, code in enumerate(codes):
                if i < len(data):
                    series_by_code[str(code).upper()] = list(data[i]) if isinstance(data[i], (list, tuple)) else [data[i]]

    for code, vals in series_by_code.items():
        try:
            product, exchange = product_from_wind_code(code)
        except Exception:
            continue
        # EmQuant single-field: Data[code] == [[v0,v1,...]]
        if isinstance(vals, list) and len(vals) == 1 and isinstance(vals[0], (list, tuple)):
            vals = list(vals[0])
        for i, raw in enumerate(vals):
            if i >= len(dates):
                break
            d = _norm_date(str(dates[i]))
            if not d:
                continue
            out.append({
                "date": d,
                "wind_code": code,
                "product": product,
                "exchange": exchange,
                "ftregordervol": _to_float(raw),
            })
    return out


def upsert_rows(rows: list[dict]) -> int:
    try:
        import psycopg2
        from psycopg2.extras import execute_values
    except ImportError:
        print(json.dumps({"error": "psycopg2 not installed"}))
        sys.exit(1)

    url = os.environ.get("DATABASE_URL")
    if not url:
        print(json.dumps({"error": "DATABASE_URL required for --upsert"}))
        sys.exit(1)

    records = []
    for r in rows:
        if not r.get("date") or not r.get("wind_code"):
            continue
        records.append((
            r["date"], r["wind_code"], r["product"], r["exchange"], r.get("ftregordervol"), "emquant",
        ))
    if not records:
        return 0

    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO raw_futures_warehouse_receipts_daily
                  (trade_date, wind_code, product, exchange, ftregordervol, source)
                VALUES %s
                ON CONFLICT (trade_date, wind_code) DO UPDATE SET
                  product = EXCLUDED.product,
                  exchange = EXCLUDED.exchange,
                  ftregordervol = EXCLUDED.ftregordervol,
                  source = EXCLUDED.source,
                  fetched_at = NOW()
                """,
                records,
            )
        conn.commit()
    finally:
        conn.close()
    return len(records)


def main() -> None:
    _load_env_from_files()
    args = [a for a in sys.argv[1:] if a != "--upsert"]
    do_upsert = "--upsert" in sys.argv[1:]

    today = date.today()
    if len(args) >= 2:
        start_date = _parse_ymd(args[0]); end_date = _parse_ymd(args[1])
    elif len(args) == 1:
        start_date = end_date = _parse_ymd(args[0])
    else:
        end_date = today.isoformat()
        start_date = (today - timedelta(days=5)).isoformat()

    codes = code_list()
    username = os.environ.get("EMQ_USERNAME", "")
    password = os.environ.get("EMQ_PASSWORD", "")
    if not username or not password:
        print(json.dumps({"error": "EMQ_USERNAME / EMQ_PASSWORD missing"}))
        sys.exit(1)

    try:
        from EmQuantAPI import c  # type: ignore
    except ImportError as e:
        print(json.dumps({"error": f"EmQuantAPI import failed: {e}"}))
        sys.exit(1)

    options = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0"
    sys.stderr.write("EmQuant: logging in...\n"); sys.stderr.flush()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        login_future = pool.submit(c.start, options)
        try:
            login = login_future.result(timeout=60)
        except concurrent.futures.TimeoutError:
            print(json.dumps({"error": "EmQuant login timed out"})); sys.exit(1)
    if getattr(login, "ErrorCode", 1) != 0:
        print(json.dumps({"error": f"EmQuant login failed: {getattr(login, 'ErrorMsg', login)}"})); sys.exit(1)
    sys.stderr.write("EmQuant: login OK\n")

    all_rows: list[dict] = []
    batches = [codes[i:i + _BATCH_SIZE] for i in range(0, len(codes), _BATCH_SIZE)]
    try:
        for bi, batch in enumerate(batches):
            sys.stderr.write(f"[{bi+1}/{len(batches)}] FTREGORDERVOL {len(batch)} codes {start_date}->{end_date}\n")
            sys.stderr.flush()
            data = None
            try:
                data = _csd_call(c, ",".join(batch), start_date, end_date)
            except concurrent.futures.TimeoutError:
                sys.stderr.write(f"batch {bi+1} timed out; retrying singles\n")
            if data is None or getattr(data, "ErrorCode", 1) != 0:
                for code in batch:
                    try:
                        sd = _csd_call(c, code, start_date, end_date)
                        if getattr(sd, "ErrorCode", 1) != 0:
                            sys.stderr.write(f"  skip {code}: {getattr(sd, 'ErrorMsg', sd)}\n")
                            continue
                        all_rows.extend(_parse_csd(sd, [code]))
                    except Exception as ex:
                        sys.stderr.write(f"  skip {code}: {ex}\n")
                continue
            all_rows.extend(_parse_csd(data, batch))
    finally:
        try:
            c.stop()
        except Exception:
            pass

    uniq: dict[tuple[str, str], dict] = {}
    for r in all_rows:
        uniq[(r["date"], r["wind_code"])] = r
    rows = sorted(uniq.values(), key=lambda r: (r["date"], r["wind_code"]))

    upserted = upsert_rows(rows) if do_upsert else 0
    non_null = sum(1 for r in rows if r.get("ftregordervol") is not None)
    payload = {
        "start_date": start_date,
        "end_date": end_date,
        "codes": len(codes),
        "count": len(rows),
        "non_null": non_null,
        "upserted": upserted,
        "sample": rows[:5],
        "data": rows,
    }
    json_out = os.environ.get("WH_JSON_OUT", "").strip()
    text = json.dumps(payload, ensure_ascii=False)
    if json_out:
        Path(json_out).write_text(text, encoding="utf-8")
        print(json.dumps({k: payload[k] for k in ("start_date", "end_date", "codes", "count", "non_null", "upserted", "sample")}, ensure_ascii=False))
    else:
        print(text)


if __name__ == "__main__":
    main()
