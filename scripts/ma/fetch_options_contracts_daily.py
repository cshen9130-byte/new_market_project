#!/usr/bin/env python3
"""
fetch_options_contracts_daily.py
=================================
Fetch daily options data for all contracts MOM has traded,
via EmQuant / Choice API (two c.csd() calls per batch).

Fields
------
  Call 1 (23 fields):
    CLOSE, OPEN, HIGH, LOW, PRECLOSE, CLEAR, PRECLEAR, CHANGE, PCTCHANGE,
    CHANGECLEAR, PCTCHANGECLEAR, HQOI, VOLUME, AMOUNT, CHANGEOI, AMPLITUDE,
    EMBLSIMPV, EMDELTA, DELTA, GAMMA, RHO, THETA, VEGA

  Call 2 (4 EM-calculated greeks):
    EMTHETA, EMGAMMA, EMVEGA, EMRHO

Usage
-----
  python fetch_options_contracts_daily.py                   # yesterday only
  python fetch_options_contracts_daily.py 20250101          # single date
  python fetch_options_contracts_daily.py 20250101 20260321 # date range (backfill)

  # Override contract list (comma-separated, for testing):
  python fetch_options_contracts_daily.py 20250101 20260321 A2605C3700.DCE,M2505C3200.DCE

Environment
-----------
  DATABASE_URL  (or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD)
  EMQ_USERNAME  / EMQ_PASSWORD

Output JSON schema
------------------
{
  "start_date": "YYYY-MM-DD",
  "end_date":   "YYYY-MM-DD",
  "contracts":  ["A2605C3700.DCE", ...],
  "count":      <int>,
  "data": [
    {
      "date":            "YYYY-MM-DD",
      "contract":        "A2605C3700.DCE",
      "close":           ...,  "open": ..., "high": ..., "low": ...,
      "preclose":        ...,  "clear": ..., "preclear": ...,
      "change":          ...,  "pct_change": ...,
      "change_clear":    ...,  "pct_change_clear": ...,
      "hqoi":            ...,  "volume": ..., "amount": ...,
      "change_oi":       ...,  "amplitude": ...,
      "impl_vol":        ...,
      "em_delta":        ...,  "delta": ...,
      "gamma":           ...,  "rho": ..., "theta": ..., "vega": ...,
      "em_theta":        ...,  "em_gamma": ..., "em_vega": ..., "em_rho": ...
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

# Call 1: price / OI / volume / implied vol / exchange-disclosed greeks
CSD_FIELDS_1 = (
    "CLOSE,OPEN,HIGH,LOW,PRECLOSE,CLEAR,PRECLEAR,CHANGE,PCTCHANGE,"
    "CHANGECLEAR,PCTCHANGECLEAR,HQOI,VOLUME,AMOUNT,CHANGEOI,"
    "AMPLITUDE,EMBLSIMPV,EMDELTA,DELTA,GAMMA,RHO,THETA,VEGA"
)
CSD_OPTS_1 = "FrIndex=8,Volatility=5,period=1,adjustflag=1,curtype=1,order=1,market=CNSESH"

# Call 2: EM-calculated greeks
CSD_FIELDS_2 = "EMTHETA,EMGAMMA,EMVEGA,EMRHO"
CSD_OPTS_2 = "FrIndex=8,Volatility=4,period=1,adjustflag=1,curtype=1,order=1,market=CNSESH"

FIELD_MAP_1: dict[str, str] = {
    "CLOSE":          "close",
    "OPEN":           "open",
    "HIGH":           "high",
    "LOW":            "low",
    "PRECLOSE":       "preclose",
    "CLEAR":          "clear",
    "PRECLEAR":       "preclear",
    "CHANGE":         "change",
    "PCTCHANGE":      "pct_change",
    "CHANGECLEAR":    "change_clear",
    "PCTCHANGECLEAR": "pct_change_clear",
    "HQOI":           "hqoi",
    "VOLUME":         "volume",
    "AMOUNT":         "amount",
    "CHANGEOI":       "change_oi",
    "AMPLITUDE":      "amplitude",
    "EMBLSIMPV":      "impl_vol",
    "EMDELTA":        "em_delta",
    "DELTA":          "delta",
    "GAMMA":          "gamma",
    "RHO":            "rho",
    "THETA":          "theta",
    "VEGA":           "vega",
}

FIELD_MAP_2: dict[str, str] = {
    "EMTHETA": "em_theta",
    "EMGAMMA": "em_gamma",
    "EMVEGA":  "em_vega",
    "EMRHO":   "em_rho",
}

ALL_API_FIELDS_1 = list(FIELD_MAP_1.keys())
ALL_API_FIELDS_2 = list(FIELD_MAP_2.keys())

# Batch size — how many contracts per c.csd() call
_BATCH_SIZE = 20


# ── Contract code normalizer ──────────────────────────────────────────────────
# Broker/CTP option codes:  'a2605C3700', 'cf2505C14800', 'io2509C3800'
# Choice API requires:      'A2605C3700.DCE', 'CF2505C14800.CZC', 'IO2509C3800.CFE'

_PRODUCT_EXCHANGE: dict[str, str] = {
    # ── DCE (大连商品交易所) ───────────────────────────────────────────────
    "A":  "DCE",  # 大豆1号
    "B":  "DCE",  # 大豆2号
    "BB": "DCE",  # 胶合板
    "BZ": "DCE",  # 丁二烯
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
    "AD": "SHF",  # 氧化铝(新)
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
    "PD": "SHF",  # 钯金
    "PL": "SHF",  # 铂金(旧)
    "PT": "SHF",  # 铂金
    "RB": "SHF",  # 螺纹钢
    "RU": "SHF",  # 天然橡胶
    "SN": "SHF",  # 锡
    "SP": "SHF",  # 纸浆
    "SS": "SHF",  # 不锈钢
    "WR": "SHF",  # 线材
    "ZN": "SHF",  # 锌
    # ── INE (上海国际能源中心) ────────────────────────────────────────────
    "EC": "INE",  # 集运欧线
    "LU": "INE",  # 低硫燃料油
    "SC": "INE",  # 原油
    # ── CZCE (郑州商品交易所) ─────────────────────────────────────────────
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
    # ── GFEX (广州期货交易所) ─────────────────────────────────────────────
    "LC": "GFE",  # 碳酸锂
    "PS": "GFE",  # 多晶硅
    "SI": "GFE",  # 工业硅
    # ── CFFEX (中国金融期货交易所) ───────────────────────────────────────
    "IC": "CFE",  # 中证500股指期货
    "IF": "CFE",  # 沪深300股指期货
    "IH": "CFE",  # 上证50股指期货
    "IM": "CFE",  # 中证1000股指期货
    "IO": "CFE",  # 沪深300股指期权
    "HO": "CFE",  # 上证50股指期权
    "MO": "CFE",  # 中证1000股指期权
    "T":  "CFE",  # 10年期国债期货
    "TF": "CFE",  # 5年期国债期货
    "TL": "CFE",  # 30年期国债期货
    "TS": "CFE",  # 2年期国债期货
}


def _normalize_contract(raw: str) -> str | None:
    """
    Convert a broker/CTP option code to Choice API format.

    Input examples :  'a2605C3700'   /  'cf2505C14800'  /  'IO2509C3800'
    Output examples:  'A2605C3700.DCE' / 'CF2505C14800.CZC' / 'IO2509C3800.CFE'
    Pass-through:     'A2605C3700.DCE' → 'A2605C3700.DCE'
    """
    code = raw.strip()
    if not code:
        return None

    # Already has exchange suffix — normalise casing only
    if "." in code:
        product_part, exch_part = code.upper().split(".", 1)
        return f"{product_part}.{exch_part}"

    # Strip non-alphanumeric (except C/P which are already caught by [A-Za-z])
    code_clean = re.sub(r"[^A-Za-z0-9]", "", code)

    # Options: letters (product) + 3-4 digits (YYMM) + C/P + digits (strike)
    m = re.match(r"^([A-Za-z]+)(\d{3,4}[CPcp]\d+)$", code_clean)
    if not m:
        return None

    product  = m.group(1).upper()
    rest     = m.group(2).upper()      # e.g. "2605C3700"
    exchange = _PRODUCT_EXCHANGE.get(product)
    if not exchange:
        return None

    return f"{product}{rest}.{exchange}"


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


# ── DB helper ─────────────────────────────────────────────────────────────────

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
    """Return sorted distinct Choice-API-format option codes from mom_options_trade_details."""
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT TRIM("合约") AS contract
                FROM mom_options_trade_details
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
        + (f", {len(skipped)} skipped: {skipped[:10]}" if skipped else "")
        + "\n"
    )
    if unique:
        sys.stderr.write(f"Sample codes: {unique[:5]}\n")
    return unique


# ── Value helpers ─────────────────────────────────────────────────────────────

def _to_float(v: object) -> float | None:
    try:
        return float(v) if v is not None else None  # type: ignore[arg-type]
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
            return [row[0] for row in s]
        except Exception:
            pass
    return s


# ── CSD parser ────────────────────────────────────────────────────────────────

def _parse_csd(
    csd_result,
    batch_codes: list[str],
    field_map: dict[str, str],
    api_fields: list[str],
) -> dict[tuple[str, str], dict]:
    """
    Parse a multi-contract c.csd() result.
    Returns dict keyed by (contract_code, date_str) → partial row dict.
    """
    dates = (
        list(getattr(csd_result, "Dates", []) or []) or
        list(getattr(csd_result, "Times", []) or []) or
        list(getattr(csd_result, "dates", []) or [])
    )
    if not dates:
        return {}

    DD = getattr(csd_result, "Data", None) or getattr(csd_result, "data", None)
    if not isinstance(DD, dict):
        return {}

    indicators = list(
        getattr(csd_result, "Indicators", None) or
        getattr(csd_result, "Fields",     None) or
        api_fields
    )
    ind_upper = [str(i).upper() for i in indicators]

    result: dict[tuple[str, str], dict] = {}

    for contract in batch_codes:
        code_data = DD.get(contract)
        if code_data is None or not isinstance(code_data, (list, tuple)):
            continue

        field_series: dict[str, list] = {}
        for api_field in api_fields:
            try:
                idx = ind_upper.index(api_field)
                raw_series = code_data[idx]
                if isinstance(raw_series, (list, tuple)):
                    field_series[api_field] = _flatten_series(raw_series)
                else:
                    field_series[api_field] = [raw_series] * len(dates)
            except (ValueError, IndexError):
                field_series[api_field] = [None] * len(dates)

        for i, d in enumerate(dates):
            date_str = _norm_date(d)
            key = (contract, date_str)
            row = result.get(key) or {"date": date_str, "contract": contract}
            for api_field, out_key in field_map.items():
                series = field_series.get(api_field, [])
                row[out_key] = _to_float(series[i] if i < len(series) else None)
            result[key] = row

    return result


# ── Batch fetcher (call 1 + call 2 merged) ────────────────────────────────────

def _fetch_one_batch(
    c_api,
    codes: list[str],
    start: str,
    end: str,
) -> list[dict]:
    """
    Fetch call 1 (main 23 fields) + call 2 (EM greeks 4 fields) for a list
    of option codes, returning merged row dicts.

    Raises ValueError (with error code in message) if call 1 fails.
    Call 2 failures are silently ignored — EM greeks left as None.
    """
    codes_str = ",".join(codes)

    # ── Call 1: main data ─────────────────────────────────────────────────
    data1 = c_api.csd(codes_str, CSD_FIELDS_1, start, end, CSD_OPTS_1)
    if data1.ErrorCode != 0:
        raise ValueError(f"({data1.ErrorCode}): {data1.ErrorMsg}")

    rows_dict = _parse_csd(data1, codes, FIELD_MAP_1, ALL_API_FIELDS_1)
    if not rows_dict:
        return []

    # ── Call 2: EM greeks (best-effort) ───────────────────────────────────
    try:
        data2 = c_api.csd(codes_str, CSD_FIELDS_2, start, end, CSD_OPTS_2)
        if data2.ErrorCode == 0:
            greek_rows = _parse_csd(data2, codes, FIELD_MAP_2, ALL_API_FIELDS_2)
            for key, greek_vals in greek_rows.items():
                if key in rows_dict:
                    rows_dict[key].update(
                        {k: v for k, v in greek_vals.items()
                         if k not in ("date", "contract")}
                    )
    except Exception:
        pass  # EM greeks are optional; main data still stored

    return list(rows_dict.values())


# ── Main ──────────────────────────────────────────────────────────────────────

def _fmt(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


def _parse_date(s: str) -> str:
    s = s.strip().replace("-", "")
    return datetime.strptime(s, "%Y%m%d").strftime("%Y-%m-%d")


def main():
    _load_env_from_files()

    today = datetime.today()
    argv  = sys.argv[1:]

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

    if manual_contracts:
        contracts = [_normalize_contract(c_) or c_ for c_ in manual_contracts]
        sys.stderr.write(f"Using {len(contracts)} manually-specified contracts\n")
    else:
        try:
            contracts = _fetch_traded_contracts()
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

    login_opts = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0"
    login = c.start(login_opts)
    if login.ErrorCode != 0:
        print(json.dumps({"error": f"EmQuant login failed: {login.ErrorMsg}"}))
        sys.exit(1)

    batches = [
        contracts[i : i + _BATCH_SIZE]
        for i in range(0, len(contracts), _BATCH_SIZE)
    ]
    total_batches = len(batches)
    all_records: list[dict] = []

    try:
        for batch_idx, batch in enumerate(batches):
            pct = int((batch_idx + 1) / total_batches * 100)
            sys.stderr.write(
                f"\r[{batch_idx+1}/{total_batches}] ({pct}%) "
                f"fetching {len(batch)} contracts {start_date} → {end_date}  "
            )
            sys.stderr.flush()

            try:
                rows = _fetch_one_batch(c, batch, start_date, end_date)
                all_records.extend(rows)
                sys.stderr.write(f"→ {len(rows)} rows\n")
            except ValueError as exc:
                err_str = str(exc)
                if "10003008" in err_str and len(batch) > 1:
                    # One bad/expired code poisons the batch — retry individually
                    sys.stderr.write(
                        f"\n[batch {batch_idx+1}] invalid code, retrying individually...\n"
                    )
                    good = bad = 0
                    for single_code in batch:
                        try:
                            rows = _fetch_one_batch(c, [single_code], start_date, end_date)
                            all_records.extend(rows)
                            good += 1
                        except Exception:
                            bad += 1
                    sys.stderr.write(
                        f"[batch {batch_idx+1}] retry: {good} ok, {bad} bad\n"
                    )
                else:
                    sys.stderr.write(f"\n[batch {batch_idx+1}] API error {exc}\n")
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
