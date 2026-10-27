#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_edb_commodity_inventory_daily.py
==================================
Fetch Choice/EmQuant commodity social/exchange inventory via c.edb
and upsert into raw_edb_commodity_inventory_daily.

Example:
  data = c.edb(
      "EMI02082690,EMI02082698,EMI01961310,EMI02082720,EMI01775921",
      "StartDate=2026-07-13,EndDate=2026-10-27,Ispandas=0",
  )

Usage:
  python fetch_edb_commodity_inventory_daily.py 2025-01-02 2026-10-27 --upsert
  python fetch_edb_commodity_inventory_daily.py --upsert   # last ~30d

Env: EMQ_USERNAME, EMQ_PASSWORD, DATABASE_URL
Optional: INV_EMI_CODES=EMI...,EMI... to override catalog codes.
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
INVENTORY_SERIES: list[dict] = [
    # --- already loaded (keep) ---
    {"emi_code": "EMI01801745", "product": "AL", "name_cn": "库存:铝(日)", "freq_hint": "daily", "region_hint": "cn", "priority": 10},
    {"emi_code": "EMM01787346", "product": "ZN", "name_cn": "库存:锌(日)", "freq_hint": "daily", "region_hint": "cn", "priority": 10},
    {"emi_code": "EMI02082804", "product": "CU", "name_cn": "市场库存:电解铜", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI00339785", "product": "RB", "name_cn": "国内钢铁社会库存:螺纹钢", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI00339789", "product": "HC", "name_cn": "国内钢铁社会库存:热轧", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI00069041", "product": "AL", "name_cn": "库存:铝:总计", "freq_hint": "weekly", "region_hint": "cn", "priority": 30},
    {"emi_code": "EMI00069039", "product": "ZN", "name_cn": "库存:锌", "freq_hint": "weekly", "region_hint": "cn", "priority": 30},
    {"emi_code": "EMM01500532", "product": "AL", "name_cn": "库存:铝(SHFE)", "freq_hint": "weekly", "region_hint": "shfe", "priority": 40},
    {"emi_code": "EMM00635193", "product": "AL", "name_cn": "库存小计:铝:总计", "freq_hint": "weekly", "region_hint": "cn", "priority": 45},
    {"emi_code": "EMM00635252", "product": "ZN", "name_cn": "库存:锌:总计", "freq_hint": "weekly", "region_hint": "cn", "priority": 45},
    {"emi_code": "EMM01787478", "product": "AL", "name_cn": "LME铝库存合计全球", "freq_hint": "daily", "region_hint": "lme", "priority": 80},
    {"emi_code": "EMI01801600", "product": "ZN", "name_cn": "LME锌库存合计全球", "freq_hint": "daily", "region_hint": "lme", "priority": 80},
    # --- NEW 2026-10-27 hunt ---
    {"emi_code": "EMI01961306", "product": "CU", "name_cn": "电解铜工厂库存", "freq_hint": "weekly", "region_hint": "cn", "priority": 15},
    {"emi_code": "EMI01961305", "product": "AL", "name_cn": "电解铝工厂库存", "freq_hint": "weekly", "region_hint": "cn", "priority": 15},
    {"emi_code": "EMI02082803", "product": "AL", "name_cn": "市场库存:电解铝", "freq_hint": "weekly", "region_hint": "cn", "priority": 18},
    {"emi_code": "EMI01709948", "product": "AL", "name_cn": "库存:电解铝:保税区", "freq_hint": "weekly", "region_hint": "cn", "priority": 25},
    {"emi_code": "EMM00635131", "product": "CU", "name_cn": "库存:铜:总计", "freq_hint": "weekly", "region_hint": "shfe", "priority": 40},
    {"emi_code": "EMM00635277", "product": "ZN", "name_cn": "可用库存量:锌:总计", "freq_hint": "weekly", "region_hint": "shfe", "priority": 35},
    {"emi_code": "EMI00069040", "product": "PB", "name_cn": "库存:铅", "freq_hint": "weekly", "region_hint": "shfe", "priority": 40},
    {"emi_code": "EMI01670588", "product": "NI", "name_cn": "库存:镍", "freq_hint": "weekly", "region_hint": "shfe", "priority": 40},
    {"emi_code": "EMI01670587", "product": "SN", "name_cn": "库存:锡", "freq_hint": "weekly", "region_hint": "shfe", "priority": 40},
    {"emi_code": "EMI01779731", "product": "I", "name_cn": "国内主要港口进口铁矿石库存:45港总计", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI01709949", "product": "I", "name_cn": "库存:铁矿石:46港", "freq_hint": "weekly", "region_hint": "cn", "priority": 30},
    {"emi_code": "EMI01907466", "product": "J", "name_cn": "焦炭库存:北方5港", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI00233459", "product": "JM", "name_cn": "炼焦煤库存:港口合计", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMM00635563", "product": "HC", "name_cn": "库存:热轧卷板:总计", "freq_hint": "weekly", "region_hint": "shfe", "priority": 40},
    {"emi_code": "EMI02082745", "product": "TA", "name_cn": "工厂库存:PTA", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI01781445", "product": "EG", "name_cn": "库存:乙二醇:合计", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI01765466", "product": "EG", "name_cn": "华东主港库存:乙二醇", "freq_hint": "weekly", "region_hint": "cn", "priority": 25},
    {"emi_code": "EMI01780045", "product": "MA", "name_cn": "甲醇库存:港口", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMM02502930", "product": "MA", "name_cn": "库存:甲醇:港口合计", "freq_hint": "weekly", "region_hint": "cn", "priority": 22},
    {"emi_code": "EMI02082754", "product": "SA", "name_cn": "工厂库存:纯碱", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI02082816", "product": "UR", "name_cn": "市场库存:尿素", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI02082780", "product": "UR", "name_cn": "工厂库存:尿素", "freq_hint": "weekly", "region_hint": "cn", "priority": 22},
    {"emi_code": "EMI01781439", "product": "UR", "name_cn": "库存:尿素:总计", "freq_hint": "weekly", "region_hint": "cn", "priority": 25},
    {"emi_code": "EMM01787412", "product": "RU", "name_cn": "山东:库存:天然橡胶:青岛832", "freq_hint": "daily", "region_hint": "cn", "priority": 25},
    {"emi_code": "EMM00635373", "product": "RU", "name_cn": "库存:天然橡胶:山东:青岛832", "freq_hint": "weekly", "region_hint": "shfe", "priority": 35},
    {"emi_code": "EMI01730126", "product": "FG", "name_cn": "总库存:浮法玻璃样本企业", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMM01787488", "product": "SP", "name_cn": "库存:纸浆:仓库:总计", "freq_hint": "daily", "region_hint": "shfe", "priority": 30},
    {"emi_code": "EMM00635416", "product": "FU", "name_cn": "浙江:库存:燃料油", "freq_hint": "weekly", "region_hint": "shfe", "priority": 40},
    {"emi_code": "EMM01781537", "product": "LU", "name_cn": "库存:INE低硫燃料油:总计", "freq_hint": "daily", "region_hint": "shfe", "priority": 40},
    {"emi_code": "EMI01773650", "product": "P", "name_cn": "港口库存:棕榈油:总计", "freq_hint": "weekly", "region_hint": "cn", "priority": 50},

    # --- NEW pass2 2026-10-27 ---
    {"emi_code": "EMI01874398", "product": "BU", "name_cn": "社会库存:沥青", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI01678997", "product": "BU", "name_cn": "厂家库存:沥青", "freq_hint": "weekly", "region_hint": "cn", "priority": 22},
    {"emi_code": "EMM01787316", "product": "BU", "name_cn": "库存:沥青(日)", "freq_hint": "daily", "region_hint": "shfe", "priority": 30},
    {"emi_code": "EMM00635467", "product": "BU", "name_cn": "库存:沥青(厂库):总计", "freq_hint": "weekly", "region_hint": "shfe", "priority": 40},
    {"emi_code": "EMM01787379", "product": "FU", "name_cn": "库存:燃料油(日)", "freq_hint": "daily", "region_hint": "shfe", "priority": 25},
    {"emi_code": "EMM00167655", "product": "FU", "name_cn": "库存:燃料油", "freq_hint": "weekly", "region_hint": "shfe", "priority": 35},
    {"emi_code": "EMM02502798", "product": "L", "name_cn": "社会样本仓库库存:聚乙烯", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI02082800", "product": "EB", "name_cn": "市场库存:苯乙烯", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI02082748", "product": "PX", "name_cn": "工厂库存:PX", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI02082805", "product": "BR", "name_cn": "市场库存:丁二烯", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMM02339902", "product": "SC", "name_cn": "中国港口商业原油库存指数", "freq_hint": "weekly", "region_hint": "cn", "priority": 20},
    {"emi_code": "EMI01795040", "product": "SC", "name_cn": "库存:INE原油", "freq_hint": "daily", "region_hint": "shfe", "priority": 30},
    {"emi_code": "EMM01781519", "product": "NR", "name_cn": "库存:INE20号胶:总计", "freq_hint": "daily", "region_hint": "shfe", "priority": 30},
    {"emi_code": "EMM02410033", "product": "AG", "name_cn": "库存期货:白银:总计", "freq_hint": "weekly", "region_hint": "shfe", "priority": 40},
    {"emi_code": "EMI00223866", "product": "AU", "name_cn": "黄金ETF持仓量:净持仓量(吨)", "freq_hint": "daily", "region_hint": "global", "priority": 25},
    {"emi_code": "EMI01773658", "product": "Y", "name_cn": "港口库存:豆油:总计", "freq_hint": "weekly", "region_hint": "cn", "priority": 50},

    # --- closeness 2026-10-27 ---
    {"emi_code": "EMI00339790", "product": "HC", "name_cn": "国内钢铁社会库存:冷轧", "freq_hint": "weekly", "region_hint": "cn", "priority": 25},
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
    env = os.environ.get("INV_EMI_CODES", "").strip()
    if not env:
        return list(INVENTORY_SERIES)
    wanted = {c.strip().upper() for c in env.split(",") if c.strip()}
    by = {x["emi_code"].upper(): x for x in INVENTORY_SERIES}
    out = []
    for c in wanted:
        if c in by:
            out.append(by[c])
        else:
            out.append({"emi_code": c, "product": None, "name_cn": c, "freq_hint": "unknown", "region_hint": "unk", "priority": 99})
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
                "region_hint": meta.get("region_hint") or "unk",
                "priority": int(meta.get("priority") or 50),
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
            r.get("value"), r.get("freq_hint"), r.get("region_hint") or "unk",
            int(r.get("priority") or 50), "emquant",
        ))
    if not records:
        return 0
    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO raw_edb_commodity_inventory_daily
                  (trade_date, emi_code, product, name_cn, value, freq_hint, region_hint, priority, source)
                VALUES %s
                ON CONFLICT (trade_date, emi_code) DO UPDATE SET
                  product = EXCLUDED.product,
                  name_cn = EXCLUDED.name_cn,
                  value = EXCLUDED.value,
                  freq_hint = EXCLUDED.freq_hint,
                  region_hint = EXCLUDED.region_hint,
                  priority = EXCLUDED.priority,
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
    json_out = os.environ.get("INV_JSON_OUT", "").strip()
    text = json.dumps(payload, ensure_ascii=False)
    if json_out:
        Path(json_out).write_text(text, encoding="utf-8")
        print(json.dumps({k: payload[k] for k in ("start_date","end_date","count","non_null","upserted","ok_codes","bad_codes","sample")}, ensure_ascii=False))
    else:
        print(text)


if __name__ == "__main__":
    main()
