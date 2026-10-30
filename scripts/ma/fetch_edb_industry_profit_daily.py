#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_edb_industry_profit_daily.py
==================================
Fetch Choice/EmQuant industry / smelting / processing margins via c.edb
and upsert into raw_edb_industry_profit_daily.

Example:
  data = c.edb(
      "EMI02082690,EMI02082698,EMI01961310,EMI02082720,EMI01775921",
      "StartDate=2026-07-13,EndDate=2026-10-27,Ispandas=0",
  )

Usage:
  python fetch_edb_industry_profit_daily.py 2025-01-02 2026-10-27 --upsert
  python fetch_edb_industry_profit_daily.py --upsert   # last ~30d

Env: EMQ_USERNAME, EMQ_PASSWORD, DATABASE_URL
Optional: PROFIT_EMI_CODES=EMI...,EMI... to override catalog codes.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# Curated EMI/EMM profit/margin series mapped to futures products we trade.
# Extend this list as more Choice codes are confirmed.
PROFIT_SERIES: list[dict] = [
    {"emi_code": "EMI02082690", "product": "ZN", "name_cn": "锌冶炼利润(元/吨)", "freq_hint": "daily"},
    {"emi_code": "EMI02082698", "product": "RB", "name_cn": "毛利:螺纹钢", "freq_hint": "daily"},
    {"emi_code": "EMI01961310", "product": "AL", "name_cn": "毛利:电解铝", "freq_hint": "daily"},
    {"emi_code": "EMI02082720", "product": "TA", "name_cn": "毛利:PTA", "freq_hint": "daily"},
    {"emi_code": "EMI01775921", "product": "PF", "name_cn": "涤纶短纤聚合成本利润", "freq_hint": "weekly"},
    {"emi_code": "EMI02082699", "product": "CU", "name_cn": "毛利:电解铜", "freq_hint": "daily"},
    {"emi_code": "EMM01855422", "product": "CU", "name_cn": "现货:中国铜冶炼厂:粗炼费TC", "freq_hint": "weekly"},
    {"emi_code": "EMI02082729", "product": "HC", "name_cn": "毛利:热轧", "freq_hint": "weekly"},
    {"emi_code": "EMI02082712", "product": "V", "name_cn": "毛利:聚氯乙烯(PVC百川)", "freq_hint": "weekly"},
    {"emi_code": "EMI02082691", "product": "V", "name_cn": "毛利:聚氯乙烯(PVC百川)", "freq_hint": "weekly"},
    {"emi_code": "EMI01734485", "product": "SA", "name_cn": "理论利润:氨碱法纯碱", "freq_hint": "weekly"},
    {"emi_code": "EMI01734483", "product": "SA", "name_cn": "理论利润(双吨):联碱法纯碱", "freq_hint": "weekly"},
    {"emi_code": "EMI01732831", "product": "M", "name_cn": "全国大豆压榨毛利润", "freq_hint": "daily"},

    # --- NEW pass2 2026-10-27 ---
    {"emi_code": "EMI02082693", "product": "EB", "name_cn": "毛利:苯乙烯", "freq_hint": "weekly"},
    {"emi_code": "EMI02082702", "product": "BR", "name_cn": "毛利:丁二烯", "freq_hint": "weekly"},
    {"emi_code": "EMI02082703", "product": "PX", "name_cn": "毛利:二甲苯", "freq_hint": "weekly"},

    # --- closeness 2026-10-27 ---
    {"emi_code": "EMI02082696", "product": "SA", "name_cn": "毛利:纯碱(百川)", "freq_hint": "weekly"},

    # --- dense crush/smelting 2026-10-29 ---
    {"emi_code": "EMM01855423", "product": "CU", "name_cn": "现货:中国铜冶炼厂:精炼费(RC)", "freq_hint": "weekly"},
    {"emi_code": "EMI01793711", "product": "Y", "name_cn": "大豆压榨毛利润:全国平均(汇易)", "freq_hint": "daily"},
    {"emi_code": "EMI01793743", "product": "Y", "name_cn": "大豆压榨毛利润:进口平均(汇易)", "freq_hint": "daily"},
    {"emi_code": "EMI01793725", "product": "M", "name_cn": "大豆压榨毛利润:国产平均(汇易)", "freq_hint": "daily"},

    # --- harder 2026-10-30: SN TC daily + soy regional + steel/alumina/glass weekly ---
    {"emi_code": "EMI01762767", "product": "SN", "name_cn": "平均价:40%锡精矿加工费:云南", "freq_hint": "daily"},
    {"emi_code": "EMI01762768", "product": "SN", "name_cn": "平均价:60%锡精矿加工费:江西", "freq_hint": "daily"},
    {"emi_code": "EMI01793714", "product": "M", "name_cn": "大豆:压榨利润:天津(进口)", "freq_hint": "daily"},
    {"emi_code": "EMI01793715", "product": "M", "name_cn": "大豆:压榨利润:天津(国内)", "freq_hint": "daily"},
    {"emi_code": "EMI01793716", "product": "M", "name_cn": "大豆:压榨利润:山东(国内)", "freq_hint": "daily"},
    {"emi_code": "EMI01793718", "product": "Y", "name_cn": "大豆:压榨利润:日照(进口)", "freq_hint": "daily"},
    {"emi_code": "EMI01793720", "product": "Y", "name_cn": "大豆:压榨利润:张家港(进口)", "freq_hint": "daily"},
    {"emi_code": "EMI02082714", "product": "HC", "name_cn": "毛利:冷轧", "freq_hint": "weekly"},
    {"emi_code": "EMI02082722", "product": "RB", "name_cn": "毛利:线材", "freq_hint": "weekly"},
    {"emi_code": "EMI02082735", "product": "AL", "name_cn": "毛利:氧化铝", "freq_hint": "weekly"},
    {"emi_code": "EMI01808951", "product": "FG", "name_cn": "周平均利润:浮法玻璃", "freq_hint": "weekly"},
    {"emi_code": "EMI01709156", "product": "CU", "name_cn": "长江有色:铜精矿TC/RC平均价", "freq_hint": "weekly"},
]




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


def catalog() -> list[dict]:
    env = os.environ.get("PROFIT_EMI_CODES", "").strip()
    if not env:
        return list(PROFIT_SERIES)
    wanted = {c.strip().upper() for c in env.split(",") if c.strip()}
    by = {x["emi_code"].upper(): x for x in PROFIT_SERIES}
    out = []
    for c in wanted:
        if c in by:
            out.append(by[c])
        else:
            out.append({"emi_code": c, "product": None, "name_cn": c, "freq_hint": "unknown"})
    return out


def _extract_rows(edb_result, meta_by_code: dict[str, dict]) -> list[dict]:
    codes = list(getattr(edb_result, "Codes", None) or [])
    dates = list(getattr(edb_result, "Dates", None) or [])
    data_map = getattr(edb_result, "Data", None) or {}
    rows: list[dict] = []

    # Data shapes: {code: [vals]} or {code: [[vals]]} or {code: {field:[vals]}}
    if not codes and isinstance(data_map, dict):
        codes = list(data_map.keys())

    for code in codes:
        key = str(code)
        series = data_map.get(key, data_map.get(key.upper(), []))
        if isinstance(series, dict):
            # take first numeric list
            for v in series.values():
                if isinstance(v, (list, tuple)):
                    series = v
                    break
        if isinstance(series, list) and len(series) == 1 and isinstance(series[0], (list, tuple)):
            series = list(series[0])
        if not isinstance(series, (list, tuple)):
            continue
        meta = meta_by_code.get(key.upper(), {})
        n = min(len(dates), len(series))
        for i in range(n):
            d = _norm_date(str(dates[i]))
            if not d:
                continue
            rows.append({
                "trade_date": d,
                "emi_code": key.upper(),
                "product": meta.get("product"),
                "name_cn": meta.get("name_cn") or key.upper(),
                "value": _to_float(series[i]),
                "freq_hint": meta.get("freq_hint") or "unknown",
            })
    return rows


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
        if not r.get("trade_date") or not r.get("emi_code"):
            continue
        records.append((
            r["trade_date"], r["emi_code"], r.get("product"), r.get("name_cn"),
            r.get("value"), r.get("freq_hint"), "emquant",
        ))
    if not records:
        return 0
    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO raw_edb_industry_profit_daily
                  (trade_date, emi_code, product, name_cn, value, freq_hint, source)
                VALUES %s
                ON CONFLICT (trade_date, emi_code) DO UPDATE SET
                  product = EXCLUDED.product,
                  name_cn = EXCLUDED.name_cn,
                  value = EXCLUDED.value,
                  freq_hint = EXCLUDED.freq_hint,
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
        start_date = (today - timedelta(days=30)).isoformat()

    series = catalog()
    meta = {x["emi_code"].upper(): x for x in series}
    codes = [x["emi_code"].upper() for x in series]

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
    login = c.start(options)
    if getattr(login, "ErrorCode", 1) != 0:
        print(json.dumps({"error": f"EmQuant login failed: {getattr(login, 'ErrorMsg', login)}"}))
        sys.exit(1)
    sys.stderr.write("EmQuant: login OK\n")

    all_rows: list[dict] = []
    ok_codes = []
    bad_codes = []
    # batch to avoid huge payloads
    batch_size = int(os.environ.get("EMQ_EDB_BATCH", "8"))
    try:
        for i in range(0, len(codes), batch_size):
            batch = codes[i:i + batch_size]
            opts = f"IsLatest=0,StartDate={start_date},EndDate={end_date}"
            sys.stderr.write(f"[{i//batch_size+1}] edb {len(batch)} codes {start_date}->{end_date}\n")
            sys.stderr.flush()
            data = c.edb(",".join(batch), opts)
            if getattr(data, "ErrorCode", 1) != 0:
                # retry one-by-one
                for code in batch:
                    d1 = c.edb(code, opts)
                    if getattr(d1, "ErrorCode", 1) != 0:
                        bad_codes.append({"code": code, "error": getattr(d1, "ErrorMsg", str(d1))})
                        continue
                    rows = _extract_rows(d1, meta)
                    if not rows:
                        bad_codes.append({"code": code, "error": "empty"})
                        continue
                    all_rows.extend(rows)
                    ok_codes.append(code)
                continue
            rows = _extract_rows(data, meta)
            # figure which codes actually returned values
            got = {r["emi_code"] for r in rows}
            for code in batch:
                if code in got:
                    ok_codes.append(code)
                else:
                    bad_codes.append({"code": code, "error": "no_rows_in_batch"})
            all_rows.extend(rows)
    finally:
        try:
            c.stop()
        except Exception:
            pass

    uniq = {}
    for r in all_rows:
        uniq[(r["trade_date"], r["emi_code"])] = r
    rows = sorted(uniq.values(), key=lambda r: (r["trade_date"], r["emi_code"]))
    upserted = upsert_rows(rows) if do_upsert else 0
    non_null = sum(1 for r in rows if r.get("value") is not None)
    payload = {
        "start_date": start_date,
        "end_date": end_date,
        "requested_codes": codes,
        "ok_codes": sorted(set(ok_codes)),
        "bad_codes": bad_codes,
        "count": len(rows),
        "non_null": non_null,
        "upserted": upserted,
        "sample": rows[:8],
    }
    json_out = os.environ.get("PROFIT_JSON_OUT", "").strip()
    text = json.dumps(payload, ensure_ascii=False)
    if json_out:
        Path(json_out).write_text(text, encoding="utf-8")
        print(json.dumps({k: payload[k] for k in ("start_date","end_date","count","non_null","upserted","ok_codes","bad_codes","sample")}, ensure_ascii=False))
    else:
        print(text)


if __name__ == "__main__":
    main()
