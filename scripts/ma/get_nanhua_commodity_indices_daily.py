#!/usr/bin/env python3
"""
get_nanhua_commodity_indices_daily.py
=====================================
Fetch daily OHLCV data for 80 南华单商品指数 via EmQuant / Choice API
using a single batch c.csd() call, then parse the multi-code response.

Usage
-----
  python get_nanhua_commodity_indices_daily.py                   # yesterday
  python get_nanhua_commodity_indices_daily.py 20250101          # single date
  python get_nanhua_commodity_indices_daily.py 20250101 20260321 # date range

Environment
-----------
  EMQ_USERNAME  / EMQ_PASSWORD

Output JSON schema
------------------
{
  "start_date": "YYYY-MM-DD",
  "end_date":   "YYYY-MM-DD",
  "count":      <int>,
  "data": [
    {
      "date": "YYYY-MM-DD",
      "code": "NHA.NH",
      "name": "南华大豆指数",
      "open": ..., "close": ..., "high": ..., "low": ...,
      "preclose": ..., "change": ..., "pct_change": ...,
      "volume": ..., "amount": ..., "turn": ..., "amplitude": ...
    },
    ...
  ]
}
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# ── Code list ─────────────────────────────────────────────────────────────────

NH_COMMODITY_CODES = [
    "NHA.NH",   "NHAD.NH",  "NHAG.NH",  "NHAL.NH",  "NHAO.NH",
    "NHAP.NH",  "NHAU.NH",  "NHB.NH",   "NHBB.NH",  "NHBC.NH",
    "NHBR.NH",  "NHBU.NH",  "NHBZ.NH",  "NHC.NH",   "NHCF.NH",
    "NHCJ.NH",  "NHCS.NH",  "NHCU.NH",  "NHCY.NH",  "NHEB.NH",
    "NHEC.NH",  "NHEG.NH",  "NHER.NH",  "NHFB.NH",  "NHFG.NH",
    "NHFU.NH",  "NHHC.NH",  "NHI.NH",   "NHJ.NH",   "NHJD.NH",
    "NHJM.NH",  "NHJR.NH",  "NHL.NH",   "NHLC.NH",  "NHLG.NH",
    "NHLH.NH",  "NHLR.NH",  "NHLU.NH",  "NHM.NH",   "NHME.NH",
    "NHNEI.NH", "NHNI.NH",  "NHNR.NH",  "NHOP.NH",  "NHP.NH",
    "NHPB.NH",  "NHPD.NH",  "NHPF.NH",  "NHPG.NH",  "NHPK.NH",
    "NHPL.NH",  "NHPP.NH",  "NHPR.NH",  "NHPS.NH",  "NHPT.NH",
    "NHPX.NH",  "NHRB.NH",  "NHRM.NH",  "NHRO.NH",  "NHRR.NH",
    "NHRS.NH",  "NHRU.NH",  "NHSA.NH",  "NHSC.NH",  "NHSF.NH",
    "NHSH.NH",  "NHSI.NH",  "NHSM.NH",  "NHSN.NH",  "NHSP.NH",
    "NHSR.NH",  "NHSS.NH",  "NHTA.NH",  "NHTC.NH",  "NHUR.NH",
    "NHV.NH",   "NHWR.NH",  "NHWS.NH",  "NHY.NH",   "NHZN.NH",
]

NH_COMMODITY_NAMES: dict[str, str] = {
    "NHA.NH":   "南华大豆指数",
    "NHAD.NH":  "南华铝合金期货指数",
    "NHAG.NH":  "南华白银指数",
    "NHAL.NH":  "南华沪铝指数",
    "NHAO.NH":  "南华氧化铝指数",
    "NHAP.NH":  "南华苹果指数",
    "NHAU.NH":  "南华黄金指数",
    "NHB.NH":   "南华豆二指数",
    "NHBB.NH":  "南华胶合板指数",
    "NHBC.NH":  "南华国际铜",
    "NHBR.NH":  "南华丁二烯橡胶指数",
    "NHBU.NH":  "南华沥青指数",
    "NHBZ.NH":  "南华纯苯期货指数",
    "NHC.NH":   "南华玉米指数",
    "NHCF.NH":  "南华棉一指数",
    "NHCJ.NH":  "南华红枣指数",
    "NHCS.NH":  "南华玉米淀粉指数",
    "NHCU.NH":  "南华沪铜指数",
    "NHCY.NH":  "南华棉纱指数",
    "NHEB.NH":  "南华苯乙烯指数",
    "NHEC.NH":  "南华SCFIS欧洲指数",
    "NHEG.NH":  "南华乙二醇指数",
    "NHER.NH":  "南华早籼稻指数",
    "NHFB.NH":  "南华纤维板指数",
    "NHFG.NH":  "南华玻璃指数",
    "NHFU.NH":  "南华沪燃油指数",
    "NHHC.NH":  "南华热轧卷板指数",
    "NHI.NH":   "南华铁矿石指数",
    "NHJ.NH":   "南华焦炭指数",
    "NHJD.NH":  "南华鸡蛋指数",
    "NHJM.NH":  "南华焦煤指数",
    "NHJR.NH":  "南华粳稻指数",
    "NHL.NH":   "南华塑料指数",
    "NHLC.NH":  "南华碳酸锂指数",
    "NHLG.NH":  "南华原木指数",
    "NHLH.NH":  "南华生猪指数",
    "NHLR.NH":  "南华晚籼稻指数",
    "NHLU.NH":  "南华低硫燃料油指数",
    "NHM.NH":   "南华豆粕指数",
    "NHME.NH":  "南华甲醇指数",
    "NHNEI.NH": "南华新能源指数",
    "NHNI.NH":  "南华镍指数",
    "NHNR.NH":  "南华20号胶指数",
    "NHOP.NH":  "南华胶版印刷纸指数",
    "NHP.NH":   "南华棕榈油指数",
    "NHPB.NH":  "南华铅指数",
    "NHPD.NH":  "南华钯期货指数",
    "NHPF.NH":  "南华短纤指数",
    "NHPG.NH":  "南华LPG指数",
    "NHPK.NH":  "南华花生指数",
    "NHPL.NH":  "南华丙烯期货指数",
    "NHPP.NH":  "南华聚丙烯指数",
    "NHPR.NH":  "南华瓶片指数",
    "NHPS.NH":  "南华多晶硅期货指数",
    "NHPT.NH":  "南华铂期货指数",
    "NHPX.NH":  "南华对二甲苯指数",
    "NHRB.NH":  "南华螺纹钢指数",
    "NHRM.NH":  "南华菜籽粕指数",
    "NHRO.NH":  "南华菜籽油指数",
    "NHRR.NH":  "南华粳米指数",
    "NHRS.NH":  "南华油菜籽指数",
    "NHRU.NH":  "南华橡胶指数",
    "NHSA.NH":  "南华纯碱指数",
    "NHSC.NH":  "南华原油指数",
    "NHSF.NH":  "南华硅铁指数",
    "NHSH.NH":  "南华烧碱期货指数",
    "NHSI.NH":  "南华工业硅指数",
    "NHSM.NH":  "南华锰硅指数",
    "NHSN.NH":  "南华锡指数",
    "NHSP.NH":  "南华纸浆指数",
    "NHSR.NH":  "南华郑糖指数",
    "NHSS.NH":  "南华不锈钢指数",
    "NHTA.NH":  "南华PTA指数",
    "NHTC.NH":  "南华动力煤指数",
    "NHUR.NH":  "南华尿素指数",
    "NHV.NH":   "南华PVC指数",
    "NHWR.NH":  "南华线材指数",
    "NHWS.NH":  "南华强麦指数",
    "NHY.NH":   "南华豆油指数",
    "NHZN.NH":  "南华沪锌指数",
}

FIELD_NAMES = [
    "OPEN", "CLOSE", "HIGH", "LOW", "PRECLOSE",
    "CHANGE", "PCTCHANGE", "VOLUME", "AMOUNT", "TURN", "AMPLITUDE",
]
CSD_FIELDS = ",".join(FIELD_NAMES)
CSD_OPTS   = "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH"

# Batch size — split 80 codes into chunks to avoid API timeouts
_BATCH_SIZE = 20


# ── env loader ────────────────────────────────────────────────────────────────

def _load_env_from_files():
    candidates = []
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


# ── helpers ───────────────────────────────────────────────────────────────────

def _fmt(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


def _parse_date(s: str) -> str:
    s = s.strip().replace("-", "")
    return datetime.strptime(s, "%Y%m%d").strftime("%Y-%m-%d")


def _to_float(v: object) -> float | None:
    try:
        return float(v) if v is not None else None
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
    """Unwrap potentially nested single-element lists."""
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


# ── batch response parser ─────────────────────────────────────────────────────

def parse_batch_response(csd_result, batch_codes: list[str]) -> list[dict]:
    """
    Parse a c.csd() result called with multiple codes.

    EmQuant returns:
      Dates      : list of N dates (shared across all codes)
      Indicators : list of field names ["OPEN","CLOSE",...]
      Data       : dict keyed by code  →  list of M series (one per indicator),
                   each series has N values (one per date)
                   For a single date the series may be a bare scalar instead
                   of a 1-element list.
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
        sys.stderr.write(
            f"[batch] Expected dict Data, got {type(DD).__name__}\n"
        )
        return []

    indicators = list(
        getattr(csd_result, "Indicators", None)
        or getattr(csd_result, "Fields",     None)
        or FIELD_NAMES
    )
    ind_upper = [str(i).upper() for i in indicators]

    # Debug: log once
    sys.stderr.write(
        f"[batch] len(dates)={len(dates)}, Indicators={ind_upper}, "
        f"Data keys ({len(DD)}): {list(DD.keys())[:5]}\n"
    )

    key_map = {fn: (fn.lower() if fn != "PCTCHANGE" else "pct_change") for fn in FIELD_NAMES}
    records: list[dict] = []

    for code in batch_codes:
        code_data = DD.get(code)
        if code_data is None:
            sys.stderr.write(f"[{code}] not in Data dict\n")
            continue

        # code_data is a list indexed by indicator; each element is a series over dates
        # Shape: [[open_d1, open_d2, ...], [close_d1, ...], ...]
        # For a single date it may be: [open_scalar, close_scalar, ...]
        if not isinstance(code_data, (list, tuple)):
            sys.stderr.write(f"[{code}] unexpected code_data type: {type(code_data).__name__}\n")
            continue

        # Build per-field series
        field_series: dict[str, list] = {}
        for fn in FIELD_NAMES:
            try:
                idx = ind_upper.index(fn)
                raw_series = code_data[idx]
                # raw_series may be a list of values or a single scalar
                if isinstance(raw_series, (list, tuple)):
                    field_series[fn] = _flatten_series(raw_series)
                else:
                    # scalar → replicate for every date (single-date call)
                    field_series[fn] = [raw_series] * len(dates)
            except (ValueError, IndexError):
                field_series[fn] = [None] * len(dates)

        # Build one row per date
        for i, d in enumerate(dates):
            row: dict = {
                "date": _norm_date(d),
                "code": code,
                "name": NH_COMMODITY_NAMES.get(code, ""),
            }
            for fn in FIELD_NAMES:
                series = field_series.get(fn, [])
                v = series[i] if i < len(series) else None
                row[key_map[fn]] = _to_float(v)
            records.append(row)

    return records


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    _load_env_from_files()

    today = datetime.today()
    args = sys.argv[1:]
    if args:
        start_date = _parse_date(args[0])
        end_date   = _parse_date(args[1]) if len(args) > 1 else _fmt(today)
    else:
        yesterday  = today - timedelta(days=1)
        start_date = end_date = _fmt(yesterday)

    username = os.environ.get("EMQ_USERNAME")
    password = os.environ.get("EMQ_PASSWORD")
    if not username or not password:
        print(json.dumps({"error": "Missing EMQ_USERNAME/EMQ_PASSWORD in environment"}))
        sys.exit(2)

    try:
        from EmQuantAPI import c  # type: ignore[import-untyped]
    except ImportError:
        print(json.dumps({"error": "EmQuantAPI not installed. Run: pip install emquantapi"}))
        sys.exit(1)

    options = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=0"
    login = c.start(options)
    if login.ErrorCode != 0:
        print(json.dumps({"error": f"EmQuant login failed: {login.ErrorMsg}"}))
        sys.exit(1)

    all_records: list[dict] = []

    # Split into batches to avoid API timeouts / response size limits
    batches = [
        NH_COMMODITY_CODES[i : i + _BATCH_SIZE]
        for i in range(0, len(NH_COMMODITY_CODES), _BATCH_SIZE)
    ]

    try:
        for batch_idx, batch_codes in enumerate(batches):
            codes_str = ",".join(batch_codes)
            sys.stderr.write(
                f"[batch {batch_idx+1}/{len(batches)}] fetching {len(batch_codes)} codes "
                f"{start_date} → {end_date}\n"
            )
            try:
                data = c.csd(codes_str, CSD_FIELDS, start_date, end_date, CSD_OPTS)
                if data.ErrorCode != 0:
                    sys.stderr.write(
                        f"[batch {batch_idx+1}] API error ({data.ErrorCode}): {data.ErrorMsg}\n"
                    )
                    continue
                rows = parse_batch_response(data, batch_codes)
                sys.stderr.write(
                    f"[batch {batch_idx+1}] parsed {len(rows)} rows\n"
                )
                all_records.extend(rows)
            except Exception as exc:
                sys.stderr.write(f"[batch {batch_idx+1}] Exception: {exc}\n")
    finally:
        try:
            c.stop()
        except Exception:
            pass

    print(json.dumps({
        "start_date": start_date,
        "end_date":   end_date,
        "count":      len(all_records),
        "data":       all_records,
    }))


if __name__ == "__main__":
    main()
