#!/usr/bin/env python3
"""
fetch_futures_contracts_daily.py
=================================
Fetch daily OHLCV + settlement data for a given list of futures contracts
via EmQuant / Choice API.

The list of contracts is read from the PostgreSQL database
(distinct "合约" values in mom_futures_trade_details), so it always mirrors
exactly the contracts MOM actually traded.

Usage
-----
  python fetch_futures_contracts_daily.py                   # yesterday only
  python fetch_futures_contracts_daily.py 20250101          # single date
  python fetch_futures_contracts_daily.py 20250101 20260321 # date range (backfill)

  # Override contract list (comma-separated, for manual testing):
  python fetch_futures_contracts_daily.py 20250101 20260321 A2605.DCE,AG2506.SHF

Environment
-----------
  DATABASE_URL  (or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD)
  EMQ_USERNAME  / EMQ_PASSWORD

Output JSON schema
------------------
{
  "start_date": "YYYY-MM-DD",
  "end_date":   "YYYY-MM-DD",
  "contracts":  ["A2605.DCE", ...],
  "count":      <int>,
  "data": [
    {
      "date":             "YYYY-MM-DD",
      "contract":         "A2605.DCE",
      "open":             ...,
      "close":            ...,
      "high":             ...,
      "low":              ...,
      "preclose":         ...,
      "average":          ...,
      "change":           ...,
      "pct_change":       ...,
      "volume":           ...,
      "amount":           ...,
      "spread":           ...,
      "clear":            ...,
      "preclear":         ...,
      "pct_change_clear": ...,
      "change_clear":     ...,
      "hqoi":             ...,
      "change_oi":        ...,
      "amplitude":        ...,
      "mainforce":        ...,
      "uni_volume":       ...,
      "uni_amount":       ...,
      "uni_hqoi":         ...,
      "uni_change_oi":    ...,
      "change_close":     ...,
      "pct_change_close": ...
    },
    ...
  ]
}
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

# ── Field definitions ─────────────────────────────────────────────────────────

CSD_FIELDS = (
    "OPEN,CLOSE,HIGH,LOW,PRECLOSE,AVERAGE,CHANGE,PCTCHANGE,"
    "VOLUME,AMOUNT,SPREAD,CLEAR,PRECLEAR,PCTCHANGECLEAR,CHANGECLEAR,"
    "HQOI,CHANGEOI,AMPLITUDE,MAINFORCE,UNIVOLUME,UNIAMOUNT,"
    "UNIHQOI,UNICHANGEOI,CHANGECLOSE,PCTCHANGECLOSE"
)
CSD_OPTS = "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH"

# Map API field name → output dict key
FIELD_MAP: dict[str, str] = {
    "OPEN":            "open",
    "CLOSE":           "close",
    "HIGH":            "high",
    "LOW":             "low",
    "PRECLOSE":        "preclose",
    "AVERAGE":         "average",
    "CHANGE":          "change",
    "PCTCHANGE":       "pct_change",
    "VOLUME":          "volume",
    "AMOUNT":          "amount",
    "SPREAD":          "spread",
    "CLEAR":           "clear",
    "PRECLEAR":        "preclear",
    "PCTCHANGECLEAR":  "pct_change_clear",
    "CHANGECLEAR":     "change_clear",
    "HQOI":            "hqoi",
    "CHANGEOI":        "change_oi",
    "AMPLITUDE":       "amplitude",
    "MAINFORCE":       "mainforce",
    "UNIVOLUME":       "uni_volume",
    "UNIAMOUNT":       "uni_amount",
    "UNIHQOI":         "uni_hqoi",
    "UNICHANGEOI":     "uni_change_oi",
    "CHANGECLOSE":     "change_close",
    "PCTCHANGECLOSE":  "pct_change_close",
}
ALL_API_FIELDS = list(FIELD_MAP.keys())

# Batch size — how many contracts per c.csd() call
_BATCH_SIZE = 20


# ── Contract code normalizer ──────────────────────────────────────────────────
# Broker/CTP codes look like: 'a2605', 'ag2506', 'CF2501'
# Choice API requires:        'A2605.DCE', 'AG2506.SHF', 'CF2501.CZC'

_PRODUCT_EXCHANGE: dict[str, str] = {
    # ── DCE (大连商品交易所) ───────────────────────────────────────────────
    "A":  "DCE",  # 大豆1号
    "B":  "DCE",  # 大豆2号
    "BB": "DCE",  # 胶合板
    "C":  "DCE",  # 玉米
    "CS": "DCE",  # 玉米淀粉
    "EB": "DCE",  # 苯乙烯
    "EG": "DCE",  # 乙二醇
    "FB": "DCE",  # 纤维板
    "I":  "DCE",  # 铁矿石
    "J":  "DCE",  # 焦炭
    "JD": "DCE",  # 鸡蛋
    "JM": "DCE",  # 焦煤
    "L":  "DCE",  # 聚乙烯
    "LG": "DCE",  # 原木
    "LH": "DCE",  # 生猪
    "M":  "DCE",  # 豆粕
    "P":  "DCE",  # 棕榈油
    "PG": "DCE",  # LPG
    "PP": "DCE",  # 聚丙烯
    "RR": "DCE",  # 粳米
    "V":  "DCE",  # PVC
    "Y":  "DCE",  # 豆油
    # ── SHFE (上海期货交易所) ──────────────────────────────────────────────
    "AG": "SHF",  # 白银
    "AL": "SHF",  # 铝
    "AO": "SHF",  # 氧化铝
    "AU": "SHF",  # 黄金
    "BC": "SHF",  # 国际铜
    "BR": "SHF",  # 丁二烯橡胶
    "BU": "SHF",  # 沥青
    "CU": "SHF",  # 铜
    "FU": "SHF",  # 燃油
    "HC": "SHF",  # 热轧卷板
    "NI": "SHF",  # 镍
    "NR": "SHF",  # 20号胶
    "PB": "SHF",  # 铅
    "RB": "SHF",  # 螺纹钢
    "RU": "SHF",  # 天然橡胶
    "SN": "SHF",  # 锡
    "SP": "SHF",  # 纸浆
    "SS": "SHF",  # 不锈钢
    "WR": "SHF",  # 线材
    "ZN": "SHF",  # 锌
    # ── INE (上海国际能源中心, SHFE subsidiary) ────────────────────────────
    "EC": "INE",  # 集运欧线
    "LU": "INE",  # 低硫燃料油
    "SC": "INE",  # 原油
    # ── CZCE (郑州商品交易所) ──────────────────────────────────────────────
    "AP": "CZC",  # 苹果
    "CF": "CZC",  # 棉花
    "CJ": "CZC",  # 红枣
    "CY": "CZC",  # 棉纱
    "ER": "CZC",  # 早籼稻
    "FG": "CZC",  # 玻璃
    "JR": "CZC",  # 粳稻
    "LR": "CZC",  # 晚籼稻
    "MA": "CZC",  # 甲醇
    "OI": "CZC",  # 菜籽油
    "PF": "CZC",  # 短纤
    "PK": "CZC",  # 花生
    "PM": "CZC",  # 普通小麦
    "PR": "CZC",  # 瓶片
    "PX": "CZC",  # 对二甲苯
    "RI": "CZC",  # 晚籼稻(旧)
    "RM": "CZC",  # 菜籽粕
    "RO": "CZC",  # 菜籽油(旧)
    "RS": "CZC",  # 油菜籽
    "SA": "CZC",  # 纯碱
    "SF": "CZC",  # 硅铁
    "SH": "CZC",  # 烧碱
    "SM": "CZC",  # 锰硅
    "SR": "CZC",  # 白糖
    "TA": "CZC",  # PTA
    "TC": "CZC",  # 动力煤(旧)
    "UR": "CZC",  # 尿素
    "WH": "CZC",  # 强麦
    "WS": "CZC",  # 强麦2
    "ZC": "CZC",  # 动力煤
    # ── GFEX (广州期货交易所) ──────────────────────────────────────────────
    "LC": "GFE",  # 碳酸锂
    "PS": "GFE",  # 多晶硅
    "SI": "GFE",  # 工业硅
}


def _normalize_contract(raw: str) -> str | None:
    """
    Convert a broker/CTP contract code to Choice API format.

    Input examples :  'a2605'  /  'ag2506'  /  'CF2501'  /  'A2605.DCE'
    Output examples:  'A2605.DCE'  /  'AG2506.SHF'  /  'CF2501.CZC'  / pass-through
    """
    code = raw.strip()
    if not code:
        return None

    # Already has exchange suffix — normalise casing only
    if "." in code:
        product_part, exch_part = code.upper().split(".", 1)
        return f"{product_part}.{exch_part}"

    # Strip anything non-alphanumeric
    code = re.sub(r"[^A-Za-z0-9]", "", code)

    # Split into letters (product) + digits (delivery month)
    m = re.match(r"^([A-Za-z]+)(\d{3,4})$", code)
    if not m:
        return None

    product  = m.group(1).upper()
    month    = m.group(2)
    exchange = _PRODUCT_EXCHANGE.get(product)
    if not exchange:
        return None

    return f"{product}{month}.{exchange}"


# ── env / .env loader ─────────────────────────────────────────────────────────

def _load_env_from_files():
    candidates: list[Path] = []
    try:
        candidates.append(Path.cwd())
    except Exception:
        pass
    try:
        script_dir = Path(__file__).resolve().parent
        candidates.extend([script_dir, script_dir.parent, script_dir.parent.parent])
    except Exception:
        pass
    for base in candidates:
        for fname in (".env", ".env.local"):
            f = base / fname
            if f.exists() and f.is_file():
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


# ── DB helpers ────────────────────────────────────────────────────────────────

def _get_conn():
    try:
        import psycopg2  # type: ignore[import-untyped]
    except ImportError:
        sys.stderr.write("psycopg2 not installed\n")
        sys.exit(1)
    url = os.environ.get("DATABASE_URL")
    if url:
        return psycopg2.connect(url)
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", "localhost"),
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", "market_data"),
        user=os.environ.get("DB_USER", "market_user"),
        password=os.environ.get("DB_PASSWORD", ""),
    )


def _fetch_traded_contracts() -> list[str]:
    """Return sorted distinct Choice-API-format contract codes from mom_futures_trade_details."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT TRIM("合约") AS contract
                FROM mom_futures_trade_details
                WHERE "合约" IS NOT NULL AND TRIM("合约") <> ''
                ORDER BY 1
                """
            )
            raw_codes = [row[0] for row in cur.fetchall()]
    finally:
        conn.close()

    normalized: list[str] = []
    skipped:    list[str] = []
    for raw in raw_codes:
        norm = _normalize_contract(raw)
        if norm:
            normalized.append(norm)
        else:
            skipped.append(raw)

    unique = sorted(set(normalized))
    sys.stderr.write(
        f"Contracts: {len(raw_codes)} raw → {len(unique)} normalized"
        + (f", {len(skipped)} skipped: {skipped[:5]}" if skipped else "")
        + "\n"
    )
    if unique:
        sys.stderr.write(f"Sample codes: {unique[:5]}\n")
    return unique


# ── Value helpers ─────────────────────────────────────────────────────────────

def _to_float(v: object) -> float | None:
    try:
        return float(v) if v is not None else None   # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _norm_date(d: object) -> str:
    if isinstance(d, str):
        if "/" in d:
            try:
                return datetime.strptime(d, "%Y/%m/%d").strftime("%Y-%m-%d")
            except Exception:
                pass
        return d
    return getattr(d, "strftime", lambda *_: str(d))("%Y-%m-%d")


def _flatten_series(v: object) -> list:
    try:
        s = list(v)  # type: ignore[arg-type]
    except TypeError:
        return [v]
    if s and isinstance(s[0], (list, tuple)):
        try:
            return list(s[0])
        except Exception:
            pass
    return s


# ── Parser: multi-code batch c.csd() result ───────────────────────────────────

def _parse_batch(csd_result, batch_contracts: list[str]) -> list[dict]:
    """
    Parse a multi-contract c.csd() result.

    EmQuant structure (multi-code):
      Dates      : list[N]               — shared across all codes
      Indicators : list[M]               — field names
      Data       : dict[code → list[M]]  — each element is a series list[N]
    """
    dates = (
        list(getattr(csd_result, "Dates",  []) or []) or
        list(getattr(csd_result, "Times",  []) or []) or
        list(getattr(csd_result, "dates",  []) or [])
    )
    if not dates:
        sys.stderr.write(
            f"[batch] NO DATES. attrs={[a for a in dir(csd_result) if not a.startswith('_')]}\n"
        )
        return []

    DD = getattr(csd_result, "Data", None) or getattr(csd_result, "data", None)
    if not isinstance(DD, dict):
        sys.stderr.write(f"[batch] Expected dict Data, got {type(DD).__name__}\n")
        return []

    indicators = list(
        getattr(csd_result, "Indicators", None)
        or getattr(csd_result, "Fields",     None)
        or ALL_API_FIELDS
    )
    ind_upper = [str(i).upper() for i in indicators]

    sys.stderr.write(
        f"[batch] dates={len(dates)}, indicators={ind_upper[:5]}..., "
        f"Data keys ({len(DD)}): {list(DD.keys())[:5]}\n"
    )

    records: list[dict] = []

    for contract in batch_contracts:
        code_data = DD.get(contract)
        if code_data is None:
            sys.stderr.write(f"[{contract}] not in Data dict — skipped\n")
            continue
        if not isinstance(code_data, (list, tuple)):
            sys.stderr.write(f"[{contract}] unexpected code_data type: {type(code_data).__name__}\n")
            continue

        # Build per-field series list[N]
        field_series: dict[str, list] = {}
        for api_field in ALL_API_FIELDS:
            try:
                idx = ind_upper.index(api_field)
                raw = code_data[idx]
                if isinstance(raw, (list, tuple)):
                    field_series[api_field] = _flatten_series(raw)
                else:
                    field_series[api_field] = [raw] * len(dates)
            except (ValueError, IndexError):
                field_series[api_field] = [None] * len(dates)

        for i, d in enumerate(dates):
            row: dict = {"date": _norm_date(d), "contract": contract}
            for api_field, out_key in FIELD_MAP.items():
                series = field_series.get(api_field, [])
                row[out_key] = _to_float(series[i] if i < len(series) else None)
            records.append(row)

    return records


# ── Main ──────────────────────────────────────────────────────────────────────

def _fmt(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


def _parse_date(s: str) -> str:
    s = s.strip().replace("-", "")
    return datetime.strptime(s, "%Y%m%d").strftime("%Y-%m-%d")


def main():
    _load_env_from_files()

    today = datetime.today()
    argv = sys.argv[1:]

    # Positional: [start_date] [end_date] [contracts_csv]
    start_date = _parse_date(argv[0]) if len(argv) >= 1 else _fmt(today - timedelta(days=1))
    end_date   = _parse_date(argv[1]) if len(argv) >= 2 else _fmt(today)
    manual_contracts: list[str] = (
        [c.strip() for c in argv[2].split(",") if c.strip()] if len(argv) >= 3 else []
    )

    username = os.environ.get("EMQ_USERNAME")
    password = os.environ.get("EMQ_PASSWORD")
    if not username or not password:
        print(json.dumps({"error": "Missing EMQ_USERNAME/EMQ_PASSWORD"}))
        sys.exit(2)

    # Resolve contracts
    if manual_contracts:
        # Normalize manually-passed codes too
        contracts = [_normalize_contract(c_) or c_ for c_ in manual_contracts]
        sys.stderr.write(f"Using {len(contracts)} manually-specified contracts\n")
    else:
        try:
            contracts = _fetch_traded_contracts()
            sys.stderr.write(
                f"Loaded {len(contracts)} contracts from mom_futures_trade_details\n"
            )
        except Exception as exc:
            print(json.dumps({"error": f"DB lookup failed: {exc}"}))
            sys.exit(1)

    if not contracts:
        print(json.dumps({
            "start_date": start_date, "end_date": end_date,
            "contracts": [], "count": 0, "data": [],
        }))
        return

    try:
        from EmQuantAPI import c  # type: ignore[import-untyped]
    except ImportError:
        print(json.dumps({"error": "EmQuantAPI not installed"}))
        sys.exit(1)

    options = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0"
    login = c.start(options)
    if login.ErrorCode != 0:
        print(json.dumps({"error": f"EmQuant login failed: {login.ErrorMsg}"}))
        sys.exit(1)

    all_records: list[dict] = []
    batches = [
        contracts[i : i + _BATCH_SIZE]
        for i in range(0, len(contracts), _BATCH_SIZE)
    ]
    total_batches = len(batches)

    try:
        for batch_idx, batch in enumerate(batches):
            codes_str = ",".join(batch)
            pct = int((batch_idx + 1) / total_batches * 100)
            # Progress: write to stderr so it's visible but not captured as JSON
            sys.stderr.write(
                f"\r[{batch_idx+1}/{total_batches}] ({pct}%) fetching {len(batch)} contracts "
                f"{start_date} → {end_date}  "
            )
            sys.stderr.flush()
            try:
                data = c.csd(codes_str, CSD_FIELDS, start_date, end_date, CSD_OPTS)
                if data.ErrorCode != 0:
                    sys.stderr.write(
                        f"\n[batch {batch_idx+1}] API error ({data.ErrorCode}): {data.ErrorMsg}\n"
                    )
                    continue
                rows = _parse_batch(data, batch)
                sys.stderr.write(
                    f"→ {len(rows)} rows\n"
                )
                all_records.extend(rows)
            except Exception as exc:
                sys.stderr.write(f"\n[batch {batch_idx+1}] Exception: {exc}\n")
    finally:
        sys.stderr.write("\n")
        try:
            c.stop()
        except Exception:
            pass

    print(json.dumps({
        "start_date": start_date,
        "end_date":   end_date,
        "contracts":  contracts,
        "count":      len(all_records),
        "data":       all_records,
    }))


if __name__ == "__main__":
    main()
