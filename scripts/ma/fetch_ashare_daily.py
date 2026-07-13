#!/usr/bin/env python3
"""
fetch_ashare_daily.py
=====================
Fetch A-share daily OHLCV + amount + turnover via Choice / EmQuant c.csd().

Fields: OPEN, CLOSE, HIGH, LOW, VOLUME, AMOUNT, TURN

Usage
-----
  python fetch_ashare_daily.py                          # last 3 months → today
  python fetch_ashare_daily.py 2026-04-13 2026-07-13    # explicit date range
  python fetch_ashare_daily.py 2026-04-13 2026-07-13 000001.SZ,600000.SH  # subset

Environment
-----------
  EMQ_USERNAME / EMQ_PASSWORD
  ASHARE_BATCH_SIZE          — codes per c.csd() call (default 100)
  ASHARE_SECTOR_CODE         — Choice sector for universe (default 001005 = 全部A股)
  ASHARE_CODES               — comma-separated override universe
  ASHARE_CODES_FILE          — file with comma/newline-separated codes

Output JSON
-----------
{
  "start_date": "YYYY-MM-DD",
  "end_date":   "YYYY-MM-DD",
  "codes":      ["000001.SZ", ...],
  "count":      <int>,
  "data": [
    {
      "date": "YYYY-MM-DD",
      "ts_code": "000001.SZ",
      "open": ..., "close": ..., "high": ..., "low": ...,
      "volume": ..., "amount": ..., "turn": ...
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

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

CSD_FIELDS = "OPEN,CLOSE,HIGH,LOW,VOLUME,AMOUNT,TURN"
CSD_OPTS = "period=1,adjustflag=1,curtype=1,order=1,market=CNSESH"

FIELD_MAP: dict[str, str] = {
    "OPEN": "open",
    "CLOSE": "close",
    "HIGH": "high",
    "LOW": "low",
    "VOLUME": "volume",
    "AMOUNT": "amount",
    "TURN": "turn",
}

ALL_API_FIELDS = list(FIELD_MAP.keys())

# Choice sector codes — tried in order until one returns codes
_sector_env = os.environ.get("ASHARE_SECTOR_CODE", "").strip()
DEFAULT_SECTOR_CODES = (
    [s.strip() for s in _sector_env.split(",") if s.strip()]
    if _sector_env
    else ["001005", "001071", "001072"]
)

_BATCH_SIZE = int(os.environ.get("ASHARE_BATCH_SIZE", "100"))
_BACKFILL_MONTHS = int(os.environ.get("ASHARE_BACKFILL_MONTHS", "3"))

# Choice / EmQuant quota or permission errors — stop immediately, do not retry
_QUOTA_ERROR_CODES = ("10001012",)


def _is_quota_error(exc: BaseException) -> bool:
    msg = str(exc)
    return any(code in msg for code in _QUOTA_ERROR_CODES) or "insufficient user access" in msg.lower()


def _quota_failure_payload(start_date: str, end_date: str, codes: list[str], detail: str) -> dict:
    return {
        "error": f"Choice API quota/access limit hit: {detail}",
        "quota_exceeded": True,
        "start_date": start_date,
        "end_date": end_date,
        "codes": codes,
        "count": 0,
        "data": [],
    }


def _load_env_from_files() -> None:
    candidates = [Path.cwd()]
    try:
        script_dir = Path(__file__).resolve().parent
        candidates.extend([script_dir, script_dir.parent, script_dir.parent.parent])
    except Exception:
        pass
    for base in candidates:
        for fname in (".env.local", ".env"):
            f = base / fname
            if f.is_file():
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


def log_callback(msg) -> int:
    try:
        msg_str = msg.decode("utf-8", errors="ignore") if isinstance(msg, bytes) else str(msg)
        if "heartbeat" in msg_str.lower():
            return 0
    except Exception:
        pass
    return 0


def _to_float(v):
    try:
        if v is None:
            return None
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, bytes):
            v = v.decode("utf-8", errors="ignore")
        s = str(v).strip().replace(",", "").replace("%", "")
        if s == "" or s.lower() in ("none", "nan"):
            return None
        return float(s)
    except Exception:
        return None


def _norm_date(d) -> str:
    if hasattr(d, "strftime"):
        return d.strftime("%Y-%m-%d")
    s = str(d).strip()
    if "/" in s:
        try:
            return datetime.strptime(s, "%Y/%m/%d").strftime("%Y-%m-%d")
        except Exception:
            pass
    if len(s) >= 10 and s[4] == "-":
        return s[:10]
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return s


def _flatten_series(s):
    if s is None:
        return []
    if isinstance(s, (list, tuple)):
        if len(s) == 1 and isinstance(s[0], (list, tuple)):
            return list(s[0])
        return list(s)
    return [s]


def _parse_csd(
    csd_result,
    batch_codes: list[str],
) -> dict[tuple[str, str], dict]:
    dates = (
        list(getattr(csd_result, "Dates", []) or [])
        or list(getattr(csd_result, "Times", []) or [])
        or list(getattr(csd_result, "dates", []) or [])
    )
    if not dates:
        return {}

    DD = getattr(csd_result, "Data", None) or getattr(csd_result, "data", None)
    if not isinstance(DD, dict):
        return {}

    indicators = list(
        getattr(csd_result, "Indicators", None)
        or getattr(csd_result, "Fields", None)
        or ALL_API_FIELDS
    )
    ind_upper = [str(i).upper() for i in indicators]

    result: dict[tuple[str, str], dict] = {}

    for code in batch_codes:
        code_data = DD.get(code)
        if code_data is None or not isinstance(code_data, (list, tuple)):
            continue

        field_series: dict[str, list] = {}
        for api_field in ALL_API_FIELDS:
            try:
                idx = ind_upper.index(api_field)
                raw_series = code_data[idx]
                field_series[api_field] = _flatten_series(raw_series)
            except (ValueError, IndexError):
                field_series[api_field] = [None] * len(dates)

        for i, d in enumerate(dates):
            date_str = _norm_date(d)
            key = (code, date_str)
            row = {"date": date_str, "ts_code": code}
            for api_field, out_key in FIELD_MAP.items():
                series = field_series.get(api_field, [])
                row[out_key] = _to_float(series[i] if i < len(series) else None)
            result[key] = row

    return result


def _load_codes_from_env_or_file() -> list[str] | None:
    raw = os.environ.get("ASHARE_CODES", "").strip()
    if raw:
        return [c.strip() for c in raw.split(",") if c.strip()]

    path = os.environ.get("ASHARE_CODES_FILE", "").strip()
    if path:
        f = Path(path)
        if f.is_file():
            text = f.read_text(encoding="utf-8", errors="ignore")
            codes = []
            for part in text.replace("\n", ",").split(","):
                c = part.strip()
                if c:
                    codes.append(c)
            return codes or None
    return None


def _extract_sector_codes(sector_result) -> list[str]:
    codes = getattr(sector_result, "Codes", None) or getattr(sector_result, "codes", None)
    if codes is None:
        data = getattr(sector_result, "Data", None)
        if isinstance(data, dict):
            codes = data.get("CODES") or data.get("codes")
        elif isinstance(data, (list, tuple)):
            codes = data
    if not codes:
        return []
    out = []
    for c in codes:
        s = c.decode("utf-8", errors="ignore") if isinstance(c, bytes) else str(c)
        s = s.strip()
        if s:
            out.append(s)
    return out


def _fetch_universe(c_api, trade_date: str) -> list[str]:
    manual = _load_codes_from_env_or_file()
    if manual:
        sys.stderr.write(f"Using {len(manual)} codes from env/file override\n")
        return manual

    all_codes: list[str] = []
    seen: set[str] = set()

    for sector_code in DEFAULT_SECTOR_CODES:
        sector_code = sector_code.strip()
        if not sector_code:
            continue
        try:
            result = c_api.sector(sector_code, trade_date, "")
            if getattr(result, "ErrorCode", 0) != 0:
                sys.stderr.write(
                    f"sector({sector_code}) error {getattr(result, 'ErrorCode', '?')}: "
                    f"{getattr(result, 'ErrorMsg', '')}\n"
                )
                continue
            batch = _extract_sector_codes(result)
            added = 0
            for code in batch:
                if code not in seen:
                    seen.add(code)
                    all_codes.append(code)
                    added += 1
            sys.stderr.write(f"sector({sector_code}): +{added} codes (total {len(all_codes)})\n")
            if len(all_codes) > 3000:
                break
        except Exception as exc:
            sys.stderr.write(f"sector({sector_code}) exception: {exc}\n")

    return all_codes


def _fetch_one_batch(c_api, codes: list[str], start: str, end: str) -> list[dict]:
    codes_str = ",".join(codes)
    data = c_api.csd(codes_str, CSD_FIELDS, start, end, CSD_OPTS)
    if getattr(data, "ErrorCode", 0) != 0:
        raise ValueError(f"({getattr(data, 'ErrorCode', '?')}): {getattr(data, 'ErrorMsg', 'csd error')}")
    rows_dict = _parse_csd(data, codes)
    return list(rows_dict.values())


def _fmt(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


def _parse_date(s: str) -> str:
    s = s.strip().replace("-", "")
    return datetime.strptime(s, "%Y%m%d").strftime("%Y-%m-%d")


def main() -> None:
    _load_env_from_files()

    today = datetime.today()
    argv = sys.argv[1:]

    if len(argv) >= 2:
        start_date = _norm_date(argv[0])
        end_date = _norm_date(argv[1])
    else:
        end_date = _fmt(today)
        start_date = _fmt(today - timedelta(days=_BACKFILL_MONTHS * 31))

    manual_codes: list[str] = (
        [c.strip() for c in argv[2].split(",") if c.strip()] if len(argv) >= 3 else []
    )

    username = os.environ.get("EMQ_USERNAME")
    password = os.environ.get("EMQ_PASSWORD")
    if not username or not password:
        print(json.dumps({"error": "Missing EMQ_USERNAME/EMQ_PASSWORD"}))
        sys.exit(2)

    try:
        import EmQuantAPI as Emq  # type: ignore
        c = Emq.c
    except Exception as e:
        print(json.dumps({"error": f"EmQuantAPI import failed: {e}"}))
        sys.exit(1)

    options = f"UserName={username},PassWord={password},TestLatency=1,ForceLogin=1"
    loginresult = c.start(options, log_callback, None)
    if loginresult.ErrorCode != 0:
        print(json.dumps({"error": f"login failed: {getattr(loginresult, 'ErrorMsg', 'unknown')}"}))
        sys.exit(3)

    try:
        if manual_codes:
            codes = manual_codes
            sys.stderr.write(f"Using {len(codes)} manually-specified codes\n")
        else:
            codes = _fetch_universe(c, end_date)
            if not codes:
                print(json.dumps({"error": "Failed to resolve A-share universe via sector()"}))
                sys.exit(4)

        batches = [codes[i : i + _BATCH_SIZE] for i in range(0, len(codes), _BATCH_SIZE)]
        total_batches = len(batches)
        all_records: list[dict] = []
        quota_hit = False

        for batch_idx, batch in enumerate(batches):
            if quota_hit:
                break
            pct = int((batch_idx + 1) / max(total_batches, 1) * 100)
            sys.stderr.write(
                f"\r[{batch_idx + 1}/{total_batches}] ({pct}%) "
                f"fetching {len(batch)} stocks {start_date} → {end_date}  "
            )
            sys.stderr.flush()
            try:
                rows = _fetch_one_batch(c, batch, start_date, end_date)
                all_records.extend(rows)
                sys.stderr.write(f"→ {len(rows)} rows\n")
            except ValueError as exc:
                if _is_quota_error(exc):
                    sys.stderr.write(f"\n[batch {batch_idx + 1}] Choice quota limit — stopping.\n")
                    print(json.dumps(_quota_failure_payload(start_date, end_date, codes, str(exc)), ensure_ascii=False))
                    return
                err_str = str(exc)
                if len(batch) > 1:
                    sys.stderr.write(f"\n[batch {batch_idx + 1}] error {exc}, retrying individually…\n")
                    good = bad = 0
                    for single in batch:
                        try:
                            rows = _fetch_one_batch(c, [single], start_date, end_date)
                            all_records.extend(rows)
                            good += 1
                        except ValueError as single_exc:
                            if _is_quota_error(single_exc):
                                sys.stderr.write("Choice quota limit — stopping.\n")
                                print(json.dumps(_quota_failure_payload(start_date, end_date, codes, str(single_exc)), ensure_ascii=False))
                                return
                            bad += 1
                        except Exception:
                            bad += 1
                    sys.stderr.write(f"[batch {batch_idx + 1}] retry: {good} ok, {bad} bad\n")
                    if good == 0 and bad > 0:
                        quota_hit = True
                else:
                    sys.stderr.write(f"\n[batch {batch_idx + 1}] API error {exc}\n")
                    if _is_quota_error(exc):
                        quota_hit = True
            except Exception as exc:
                if _is_quota_error(exc):
                    sys.stderr.write(f"\n[batch {batch_idx + 1}] Choice quota limit — stopping.\n")
                    print(json.dumps(_quota_failure_payload(start_date, end_date, codes, str(exc)), ensure_ascii=False))
                    return
                sys.stderr.write(f"\n[batch {batch_idx + 1}] Exception: {exc}\n")
    finally:
        sys.stderr.write("\n")
        try:
            c.stop()
        except Exception:
            pass

    print(
        json.dumps(
            {
                "start_date": start_date,
                "end_date": end_date,
                "codes": codes,
                "count": len(all_records),
                "data": all_records,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
