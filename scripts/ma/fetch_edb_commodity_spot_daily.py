#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_edb_commodity_spot_daily.py
=================================
Fetch Choice/EmQuant physical commodity spot prices via c.edb
and upsert into raw_edb_commodity_spot_daily.

Catalog: data/edb_commodity_spot_catalog.json (fallback: embedded SPOT_SERIES).

Usage:
  python fetch_edb_commodity_spot_daily.py 2024-01-02 2026-10-28 --upsert
  python fetch_edb_commodity_spot_daily.py --upsert   # last ~30d

Env: EMQ_USERNAME, EMQ_PASSWORD, DATABASE_URL
Optional: SPOT_EMI_CODES=EMI...,EMI... to override catalog codes.
         SPOT_JSON_OUT=/path/out.json
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

# Minimal embedded fallback (full list lives in data/edb_commodity_spot_catalog.json)
SPOT_SERIES: list[dict] = [
    {"emi_code": "EMI00222587", "product": "CU", "name_cn": "平均价:SMM 1#电解铜", "freq_hint": "daily", "source_hint": "SMM", "unit_hint": "元/吨", "priority": 10},
    {"emi_code": "EMI01639172", "product": "AL", "name_cn": "价格:电解铝(卓创)", "freq_hint": "daily", "source_hint": "卓创", "unit_hint": "元/吨", "priority": 10},
    {"emi_code": "EMI01778905", "product": "ZN", "name_cn": "长江有色:平均价:锌:1#", "freq_hint": "daily", "source_hint": "长江有色", "unit_hint": "元/吨", "priority": 10},
    {"emi_code": "EMI01733205", "product": "RB", "name_cn": "市场价:螺纹钢:HRB400E 20MM:均价", "freq_hint": "daily", "source_hint": "钢之家", "unit_hint": "元/吨", "priority": 10},
    {"emi_code": "EMI01725740", "product": "HC", "name_cn": "钢材基准价格:热轧板卷", "freq_hint": "daily", "source_hint": "钢之家", "unit_hint": "元/吨", "priority": 10},
    {"emi_code": "EMI01755790", "product": "TA", "name_cn": "市场价:PTA:华东", "freq_hint": "daily", "source_hint": "金联创", "unit_hint": "元/吨", "priority": 10},
    {"emi_code": "EMI01629215", "product": "MA", "name_cn": "甲醇:郑商所现货", "freq_hint": "daily", "source_hint": "郑商所", "unit_hint": "元/吨", "priority": 10},
    {"emi_code": "EMI01639686", "product": "M", "name_cn": "现货价格:豆粕", "freq_hint": "daily", "source_hint": "生意社", "unit_hint": "元/吨", "priority": 10},
    {"emi_code": "EMI01629213", "product": "SR", "name_cn": "现货价格:白糖", "freq_hint": "daily", "source_hint": "郑商所", "unit_hint": "元/吨", "priority": 10},
    {"emi_code": "EMI01629212", "product": "CF", "name_cn": "现货价格:棉花", "freq_hint": "daily", "source_hint": "郑商所", "unit_hint": "元/吨", "priority": 10},
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
                    if key and key not in os.environ:
                        os.environ[key] = val
            except Exception:
                pass


def _parse_ymd(s: str) -> str:
    s = s.strip()
    if re.match(r"^\d{8}$", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s
    raise ValueError(f"bad date: {s}")


def _norm_date(s: str) -> str | None:
    s = (s or "").strip()
    if not s:
        return None
    s = s.replace("/", "-")
    if re.match(r"^\d{8}$", s):
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else None


def _to_float(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        if v != v:  # NaN
            return None
        return float(v)
    s = str(v).strip().replace(",", "")
    if not s or s.upper() in ("None", "NULL", "NA", "N/A", "-", "--"):
        return None
    # handle Chinese 万
    mul = 1.0
    if s.endswith("万"):
        mul = 10000.0
        s = s[:-1]
    try:
        return float(s) * mul
    except Exception:
        return None


def _catalog_path() -> Path | None:
    here = Path(__file__).resolve()
    for base in (Path.cwd(), here.parent, here.parent.parent, here.parent.parent.parent):
        p = base / "data" / "edb_commodity_spot_catalog.json"
        if p.is_file():
            return p
    return None


def catalog() -> list[dict]:
    override = os.environ.get("SPOT_EMI_CODES", "").strip()
    path = _catalog_path()
    series = list(SPOT_SERIES)
    if path:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            loaded = raw.get("series") or []
            if loaded:
                series = loaded
        except Exception as e:
            sys.stderr.write(f"catalog load failed ({e}); using embedded\n")
    if not override:
        return series
    wanted = [c.strip().upper() for c in override.split(",") if c.strip()]
    by = {str(x.get("emi_code", "")).upper(): x for x in series}
    out = []
    for c in wanted:
        if c in by:
            out.append(by[c])
        else:
            out.append({
                "emi_code": c, "product": None, "name_cn": c,
                "freq_hint": "unknown", "source_hint": "unk", "unit_hint": "", "priority": 99,
            })
    return out


def _extract_rows(edb_result, meta_by_code: dict[str, dict]) -> list[dict]:
    codes = list(getattr(edb_result, "Codes", None) or [])
    dates = list(getattr(edb_result, "Dates", None) or [])
    data_map = getattr(edb_result, "Data", None) or {}
    rows: list[dict] = []

    if not codes and isinstance(data_map, dict):
        codes = list(data_map.keys())

    for code in codes:
        key = str(code)
        series = data_map.get(key, data_map.get(key.upper(), []))
        if isinstance(series, dict):
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
                "source_hint": meta.get("source_hint") or "unk",
                "unit_hint": meta.get("unit_hint") or "",
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
            r.get("value"), r.get("freq_hint"), r.get("source_hint") or "unk",
            r.get("unit_hint") or "", int(r.get("priority") or 50), "emquant",
        ))
    if not records:
        return 0
    conn = psycopg2.connect(url)
    try:
        with conn.cursor() as cur:
            execute_values(
                cur,
                """
                INSERT INTO raw_edb_commodity_spot_daily
                  (trade_date, emi_code, product, name_cn, value, freq_hint, source_hint, unit_hint, priority, source)
                VALUES %s
                ON CONFLICT (trade_date, emi_code) DO UPDATE SET
                  product = EXCLUDED.product,
                  name_cn = EXCLUDED.name_cn,
                  value = EXCLUDED.value,
                  freq_hint = EXCLUDED.freq_hint,
                  source_hint = EXCLUDED.source_hint,
                  unit_hint = EXCLUDED.unit_hint,
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
    meta = {str(x["emi_code"]).upper(): x for x in series}
    codes = [str(x["emi_code"]).upper() for x in series]

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
    batch_size = int(os.environ.get("EMQ_EDB_BATCH", "8"))
    try:
        for i in range(0, len(codes), batch_size):
            batch = codes[i:i + batch_size]
            opts = f"IsLatest=0,StartDate={start_date},EndDate={end_date}"
            sys.stderr.write(f"[{i//batch_size+1}] edb {len(batch)} codes {start_date}->{end_date}\n")
            sys.stderr.flush()
            data = c.edb(",".join(batch), opts)
            if getattr(data, "ErrorCode", 1) != 0:
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
        "ok": True,
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
    json_out = os.environ.get("SPOT_JSON_OUT", "").strip()
    text = json.dumps(payload, ensure_ascii=False)
    if json_out:
        Path(json_out).write_text(text, encoding="utf-8")
        print(json.dumps({k: payload[k] for k in (
            "ok", "start_date", "end_date", "count", "non_null", "upserted", "ok_codes", "bad_codes", "sample"
        )}, ensure_ascii=False))
    else:
        print(text)


if __name__ == "__main__":
    main()
